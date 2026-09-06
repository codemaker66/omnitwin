// The rows fire at the stated counts and conditions, the speaking and third-tap
// rules hold, and a rare row is reached by looking around, never by drumming.
// Every fixture passes PropSchema, so the shapes here are the manifest's.
import { describe, expect, it } from "vitest";
import { PropSchema, type Prop, type StageRow } from "../../stage/stage-manifest.js";
import { WORLD_LEXICON } from "../../__tests__/world-lexicon.js";
import { POKE_HAPTIC_MS } from "../haptics.js";
import { ASLEEP_AT, THIRD_TAP_WINDOW_MS } from "../pokeable-reducer.js";
import {
  ASLEEP_CAPTION,
  heldRow,
  isThirdTap,
  parseRowCondition,
  pickRow,
  PLAIN_POKE_CAPTION,
  PLAIN_POKE_SPRING,
  react,
  STILL_SPRING,
  THIRD_TAP_GAIN_DB,
} from "../react.js";
import {
  IDLE_POKEABLE,
  SPEAKING_CAPTION,
  type PokeableState,
  type PokeContext,
  type PokeGesture,
  type Reaction,
} from "../react-types.js";

const SECOND = 1_000;

function row(at: StageRow["at"], cue: string | null, caption: string, extra: Partial<StageRow> = {}): StageRow {
  return {
    at,
    spring: "placementBounce",
    cue,
    caption,
    reducedMotion: { colorStep: `--step-${String(at)}`, caption: caption.replace(/\]$/u, ", still]") },
    ...extra,
  };
}

function prop(id: string, states: readonly StageRow[]): Prop {
  return PropSchema.parse({ id, label: `the ${id.replace(/-/gu, " ")}`, box: { x: 10, y: 60, w: 6, h: 6 }, states });
}

const TOLL_BOX = prop("toll-box", [
  row(1, "toll-lid", "[the lid lifts]"),
  row(2, "toll-coin", "[a coin turns over]"),
  row(3, "toll-coins", "[the coins shift]"),
  row(4, "toll-bolt", "[a bolt slides across]", { spring: "heavy", aside: "He has seen the box before." }),
]);

const APPLE_CORE = prop("apple-core", [
  row(1, "apple-turn", "[the apple core turns]"),
  row(4, null, "[it sinks]"),
]);

const SWALLOW = prop("swallow", [
  row(1, "swallow-wings", "[the swallow leaves]"),
  row("distinctProps:3", "swallow-wings", "[the swallow comes back, once]"),
]);

const CHAIN = prop("port-chain", [
  row(1, "chain-swing", "[the chain swings]", { spring: "camera" }),
  row("conditional:chain-swing", "chain-swing", "[the chain is still swinging from before]", { spring: "camera" }),
]);

/** Rows 1 and 2 numeric with a distinctProps row between them, to test precedence. */
const CROWDED = prop("crowded", [
  row(1, "a", "[one]"),
  row("distinctProps:1", "b", "[two, rare]"),
  row(2, "c", "[three]"),
]);

const LATE_START = prop("late-start", [row(2, "late", "[it answers on the second]")]);

function ctx(nowMs: number, overrides: Partial<PokeContext> = {}): PokeContext {
  return { nowMs, speaking: false, distinctProps: 0, conditionals: new Set(), reducedMotion: false, ...overrides };
}

interface Run {
  readonly reactions: Reaction[];
  readonly state: PokeableState;
}

/** Pokes a prop at the given instants with the given context overrides per poke. */
function pokeAt(
  target: Prop,
  instants: readonly number[],
  overrides: (index: number) => Partial<PokeContext> = () => ({}),
  gesture: PokeGesture = "tap",
  from: PokeableState = IDLE_POKEABLE,
): Run {
  const reactions: Reaction[] = [];
  let state = from;
  instants.forEach((t, index) => {
    const reaction = react(target, state, ctx(t, overrides(index)), gesture);
    reactions.push(reaction);
    state = reaction.next;
  });
  return { reactions, state };
}

function every(n: number, stepMs: number, startMs = 0): number[] {
  return Array.from({ length: n }, (_, i) => startMs + i * stepMs);
}

describe("react: rows fire at the stated counts", () => {
  it("the toll box: lid, coin, coins, bolt, on pokes one to four", () => {
    const { reactions } = pokeAt(TOLL_BOX, every(4, 20 * SECOND));
    expect(reactions.map((r) => r.stageRow)).toEqual([0, 1, 2, 3]);
    expect(reactions.map((r) => r.cue)).toEqual(["toll-lid", "toll-coin", "toll-coins", "toll-bolt"]);
    expect(reactions.map((r) => r.caption)).toEqual([
      "[the lid lifts]", "[a coin turns over]", "[the coins shift]", "[a bolt slides across]",
    ]);
    expect(reactions.map((r) => r.spring)).toEqual(["placementBounce", "placementBounce", "placementBounce", "heavy"]);
    expect(reactions.map((r) => r.aside)).toEqual([null, null, null, "He has seen the box before."]);
    expect(reactions.every((r) => !r.inert && r.hapticMs === POKE_HAPTIC_MS)).toBe(true);
    expect(reactions.map((r) => r.colorStep)).toEqual(["--step-1", "--step-2", "--step-3", "--step-4"]);
  });

  it("beyond the last authored count the thing repeats its last row, with no row index and no aside", () => {
    const { reactions } = pokeAt(TOLL_BOX, every(6, 20 * SECOND));
    const fifth = reactions[4];
    const sixth = reactions[5];
    expect(fifth?.stageRow).toBeNull();
    expect(fifth?.cue).toBe("toll-bolt");
    expect(fifth?.caption).toBe("[a bolt slides across]");
    expect(fifth?.spring).toBe("heavy");
    expect(fifth?.aside).toBeNull();
    expect(fifth?.colorStep).toBe("--step-4");
    expect(sixth?.cue).toBe("toll-bolt");
  });

  it("between authored counts the latest row repeats: the apple core turns until the fourth poke sinks it", () => {
    const { reactions } = pokeAt(APPLE_CORE, every(5, 20 * SECOND));
    expect(reactions.map((r) => r.stageRow)).toEqual([0, null, null, 1, null]);
    expect(reactions.map((r) => r.cue)).toEqual(["apple-turn", "apple-turn", "apple-turn", null, null]);
    expect(reactions[4]?.caption).toBe("[it sinks]");
  });

  it("a poke no row backs is the spring alone, and says so", () => {
    const { reactions } = pokeAt(LATE_START, [0, 20 * SECOND]);
    expect(reactions[0]?.stageRow).toBeNull();
    expect(reactions[0]?.cue).toBeNull();
    expect(reactions[0]?.caption).toBe(PLAIN_POKE_CAPTION);
    expect(reactions[0]?.spring).toBe(PLAIN_POKE_SPRING);
    expect(reactions[0]?.colorStep).toBeNull();
    expect(reactions[0]?.hapticMs).toBe(POKE_HAPTIC_MS);
    expect(reactions[1]?.stageRow).toBe(0);
  });

  it("heldRow is the latest numeric row at or below the count", () => {
    expect(heldRow(APPLE_CORE, 0)).toBeNull();
    expect(heldRow(APPLE_CORE, 1)).toBe(0);
    expect(heldRow(APPLE_CORE, 3)).toBe(0);
    expect(heldRow(APPLE_CORE, 4)).toBe(1);
    expect(heldRow(APPLE_CORE, 40)).toBe(1);
  });
});

describe("react: the speaking rule", () => {
  it("while he speaks a poke is inert: the speaking caption, no cue, no haptic, the same state", () => {
    const state = pokeAt(TOLL_BOX, [0]).state;
    const reaction = react(TOLL_BOX, state, ctx(20 * SECOND, { speaking: true }), "tap");
    expect(reaction.inert).toBe(true);
    expect(reaction.caption).toBe(SPEAKING_CAPTION);
    expect(reaction.cue).toBeNull();
    expect(reaction.hapticMs).toBe(0);
    expect(reaction.stageRow).toBeNull();
    expect(reaction.aside).toBeNull();
    expect(reaction.spring).toBe(STILL_SPRING);
    expect(reaction.next).toBe(state);
  });
});

describe("react: the third-tap rule", () => {
  it("the third poke on one thing inside ten seconds plays at -6 dB and half length", () => {
    const { reactions } = pokeAt(TOLL_BOX, [0, SECOND, 2 * SECOND]);
    expect(reactions[0]?.cueGainDb).toBe(0);
    expect(reactions[0]?.cueHalfLength).toBe(false);
    expect(reactions[1]?.cueGainDb).toBe(0);
    expect(reactions[2]?.cueGainDb).toBe(THIRD_TAP_GAIN_DB);
    expect(reactions[2]?.cueHalfLength).toBe(true);
  });

  it("a third poke outside the ten seconds plays at full value", () => {
    const { reactions } = pokeAt(TOLL_BOX, [0, SECOND, SECOND + THIRD_TAP_WINDOW_MS + 1]);
    expect(reactions[2]?.cueGainDb).toBe(0);
    expect(reactions[2]?.cueHalfLength).toBe(false);
  });

  it("the fourth inside the window is still quieter; a rest restores the value", () => {
    const { reactions } = pokeAt(TOLL_BOX, [0, SECOND, 2 * SECOND, 3 * SECOND, 30 * SECOND]);
    expect(reactions[3]?.cueHalfLength).toBe(true);
    expect(reactions[4]?.cueHalfLength).toBe(false);
  });

  it("isThirdTap reads the new state's last three", () => {
    expect(isThirdTap({ ...IDLE_POKEABLE, recentMs: [0, SECOND] })).toBe(false);
    expect(isThirdTap({ ...IDLE_POKEABLE, recentMs: [0, SECOND, THIRD_TAP_WINDOW_MS] })).toBe(true);
    expect(isThirdTap({ ...IDLE_POKEABLE, recentMs: [0, SECOND, THIRD_TAP_WINDOW_MS + 1] })).toBe(false);
  });
});

describe("react: distinctProps rows", () => {
  it("the swallow comes back once three distinct things have been touched, and only once", () => {
    const distinct = [0, 2, 3, 5];
    const { reactions, state } = pokeAt(SWALLOW, every(4, 20 * SECOND), (i) => ({ distinctProps: distinct[i] ?? 0 }));
    expect(reactions[0]?.stageRow).toBe(0);
    expect(reactions[1]?.stageRow).toBeNull();
    expect(reactions[1]?.caption).toBe("[the swallow leaves]");
    expect(reactions[2]?.stageRow).toBe(1);
    expect(reactions[2]?.caption).toBe("[the swallow comes back, once]");
    expect(reactions[3]?.stageRow).toBeNull();
    expect(reactions[3]?.caption).toBe("[the swallow leaves]");
    expect(state.firedRows).toEqual([1]);
  });

  it("drumming the swallow alone never brings it back", () => {
    const { reactions } = pokeAt(SWALLOW, every(8, 2 * SECOND));
    expect(reactions.every((r) => r.stageRow !== 1)).toBe(true);
    expect(reactions.every((r) => r.caption !== "[the swallow comes back, once]")).toBe(true);
  });

  it("when several rows are satisfied the highest wins and the rare one waits its turn", () => {
    const { reactions } = pokeAt(CROWDED, every(3, 20 * SECOND), () => ({ distinctProps: 1 }));
    expect(reactions[0]?.stageRow).toBe(1);
    expect(reactions[1]?.stageRow).toBe(2);
    expect(reactions[2]?.stageRow).toBeNull();
    expect(reactions[2]?.cue).toBe("c");
  });

  it("the row that fires on the first poke: distinctProps beats a numeric row below it", () => {
    const first = react(CROWDED, IDLE_POKEABLE, ctx(0, { distinctProps: 1 }), "tap");
    expect(first.stageRow).toBe(1);
    const then = react(CROWDED, first.next, ctx(20 * SECOND, { distinctProps: 1 }), "tap");
    expect(then.stageRow).toBe(2);
  });
});

describe("react: conditional rows", () => {
  it("fires once when the persisted fact holds, then holds the numeric row", () => {
    const holds = { conditionals: new Set(["chain-swing"]) };
    const { reactions } = pokeAt(CHAIN, every(3, 20 * SECOND), () => holds);
    expect(reactions[0]?.stageRow).toBe(1);
    expect(reactions[0]?.caption).toBe("[the chain is still swinging from before]");
    expect(reactions[1]?.stageRow).toBeNull();
    expect(reactions[1]?.caption).toBe("[the chain swings]");
    expect(reactions[1]?.spring).toBe("camera");
  });

  it("does not fire when the fact does not hold", () => {
    const { reactions } = pokeAt(CHAIN, [0]);
    expect(reactions[0]?.stageRow).toBe(0);
  });
});

describe("react: asleep", () => {
  it("the tenth poke inside a minute sleeps it: the asleep caption, no cue, no haptic, the still spring", () => {
    const { reactions } = pokeAt(TOLL_BOX, every(ASLEEP_AT + 1, SECOND));
    const tenth = reactions[ASLEEP_AT - 1];
    const eleventh = reactions[ASLEEP_AT];
    expect(tenth?.next.stage).toBe("asleep");
    expect(tenth?.caption).toBe(ASLEEP_CAPTION);
    expect(tenth?.cue).toBeNull();
    expect(tenth?.hapticMs).toBe(0);
    expect(tenth?.spring).toBe(STILL_SPRING);
    expect(tenth?.stageRow).toBeNull();
    expect(tenth?.inert).toBe(false);
    expect(eleventh?.caption).toBe(ASLEEP_CAPTION);
  });
});

describe("react: reduced motion, gestures and parsing", () => {
  it("reduced motion swaps in the row's still caption and keeps the cue", () => {
    const reaction = react(TOLL_BOX, IDLE_POKEABLE, ctx(0, { reducedMotion: true }), "tap");
    expect(reaction.caption).toBe("[the lid lifts, still]");
    expect(reaction.cue).toBe("toll-lid");
    expect(reaction.colorStep).toBe("--step-1");
  });

  it("a tap or press ticks for 8 ms; a sweep never buzzes", () => {
    expect(react(TOLL_BOX, IDLE_POKEABLE, ctx(0), "tap").hapticMs).toBe(POKE_HAPTIC_MS);
    expect(react(TOLL_BOX, IDLE_POKEABLE, ctx(0), "press").hapticMs).toBe(POKE_HAPTIC_MS);
    expect(react(TOLL_BOX, IDLE_POKEABLE, ctx(0), "sweep").hapticMs).toBe(0);
  });

  it("parseRowCondition reads the manifest's forms and refuses anything else", () => {
    expect(parseRowCondition(3)).toEqual({ kind: "count", n: 3 });
    expect(parseRowCondition("distinctProps:3")).toEqual({ kind: "distinctProps", n: 3 });
    expect(parseRowCondition("conditional:chain-swing")).toEqual({ kind: "conditional", id: "chain-swing" });
    expect(parseRowCondition("distinctProps:x")).toEqual({ kind: "never" });
    expect(parseRowCondition("conditional:")).toEqual({ kind: "never" });
    expect(parseRowCondition("random:1")).toEqual({ kind: "never" });
  });

  it("pickRow returns null when nothing is satisfied", () => {
    const answered = pokeAt(TOLL_BOX, every(5, 20 * SECOND)).state;
    expect(pickRow(TOLL_BOX, answered, ctx(0))).toBeNull();
  });
});

describe("react: the fairness lint on the layer's own captions", () => {
  const SCENE_ONE_WORLDS = ["hammermen", "gardeners", "tailors", "cordiners"] as const;

  it.each([ASLEEP_CAPTION, PLAIN_POKE_CAPTION, SPEAKING_CAPTION])("%s carries no world word of scene 1", (caption) => {
    for (const world of SCENE_ONE_WORLDS) {
      for (const pattern of WORLD_LEXICON[world]) {
        expect(caption).not.toMatch(pattern);
      }
    }
    expect(caption.length).toBeLessThanOrEqual(140);
  });
});
