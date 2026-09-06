// Every stage by its stated condition, and none by any other. The clock is a
// number handed in; no timer runs here.
import { describe, expect, it } from "vitest";
import {
  ANSWERED_AT,
  ASLEEP_AT,
  effectiveStage,
  hasWoken,
  RECENT_KEEP,
  reducePoke,
  TIRED_AT,
  WAKE_AFTER_MS,
} from "../pokeable-reducer.js";
import { IDLE_POKEABLE, type PokeableState, type PokeContext } from "../react-types.js";

function ctx(nowMs: number, overrides: Partial<PokeContext> = {}): PokeContext {
  return {
    nowMs,
    speaking: false,
    distinctProps: 0,
    conditionals: new Set(),
    reducedMotion: false,
    ...overrides,
  };
}

/** Pokes at the given instants, in order; returns every state on the way. */
function pokeAt(instants: readonly number[], from: PokeableState = IDLE_POKEABLE): PokeableState[] {
  const states: PokeableState[] = [];
  let state = from;
  for (const t of instants) {
    state = reducePoke(state, ctx(t));
    states.push(state);
  }
  return states;
}

function last<T>(items: readonly T[]): T {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error("no states");
  return item;
}

function every(n: number, stepMs: number, startMs = 0): number[] {
  return Array.from({ length: n }, (_, i) => startMs + i * stepMs);
}

const SECOND = 1_000;

describe("pokeable-reducer: the stated conditions", () => {
  it("the first poke touches; the second answers", () => {
    const [first, second] = pokeAt([0, 5 * SECOND]);
    expect(first?.stage).toBe("touched");
    expect(first?.count).toBe(1);
    expect(first?.lastPokeMs).toBe(0);
    expect(first?.recentMs).toEqual([0]);
    expect(second?.stage).toBe("answered");
    expect(second?.count).toBe(ANSWERED_AT);
  });

  it("the sixth poke inside thirty seconds tires it", () => {
    const states = pokeAt(every(TIRED_AT, SECOND));
    expect(states[TIRED_AT - 2]?.stage).toBe("answered");
    expect(states[TIRED_AT - 1]?.stage).toBe("tired");
  });

  it("the tenth poke inside a minute puts it to sleep", () => {
    const states = pokeAt(every(ASLEEP_AT, SECOND));
    expect(states[ASLEEP_AT - 2]?.stage).toBe("tired");
    expect(states[ASLEEP_AT - 1]?.stage).toBe("asleep");
  });

  it("asleep keys on its own window: ten inside a minute sleeps even when no six fell inside thirty seconds", () => {
    // Every 6.5 s: the tenth lands at 58.5 s (ten within the minute), while
    // any thirty-second span holds at most five.
    const states = pokeAt(every(ASLEEP_AT, 6_500));
    expect(states.some((s) => s.stage === "tired")).toBe(false);
    expect(last(states).stage).toBe("asleep");
  });

  it("wakes after twenty seconds of quiet, and the waking poke is an ordinary poke", () => {
    const asleep = last(pokeAt(every(ASLEEP_AT, SECOND)));
    const sleptAt = asleep.lastPokeMs ?? 0;
    expect(hasWoken(asleep, sleptAt + WAKE_AFTER_MS - 1)).toBe(false);
    expect(hasWoken(asleep, sleptAt + WAKE_AFTER_MS)).toBe(true);

    const woken = reducePoke(asleep, ctx(sleptAt + WAKE_AFTER_MS));
    expect(woken.stage).toBe("answered");
    expect(woken.count).toBe(ASLEEP_AT + 1);
    expect(woken.burstMs).toEqual([sleptAt + WAKE_AFTER_MS]);
  });

  it("a plane can see it awake before anyone pokes it again", () => {
    const asleep = last(pokeAt(every(ASLEEP_AT, SECOND)));
    const sleptAt = asleep.lastPokeMs ?? 0;
    expect(effectiveStage(asleep, sleptAt + SECOND)).toBe("asleep");
    expect(effectiveStage(asleep, sleptAt + WAKE_AFTER_MS)).toBe("answered");
    const awake = last(pokeAt([0, SECOND]));
    expect(effectiveStage(awake, 10 * SECOND)).toBe("answered");
  });

  it("a poke before the quiet keeps it asleep, is still counted, and restarts the quiet", () => {
    const asleep = last(pokeAt(every(ASLEEP_AT, SECOND)));
    const sleptAt = asleep.lastPokeMs ?? 0;
    const prodded = reducePoke(asleep, ctx(sleptAt + 15 * SECOND));
    expect(prodded.stage).toBe("asleep");
    expect(prodded.count).toBe(ASLEEP_AT + 1);
    expect(prodded.lastPokeMs).toBe(sleptAt + 15 * SECOND);
    // The quiet is measured from that prod, not from the original sleep.
    const tooSoon = reducePoke(prodded, ctx(sleptAt + 15 * SECOND + WAKE_AFTER_MS - 1));
    expect(tooSoon.stage).toBe("asleep");
    const woken = reducePoke(prodded, ctx(sleptAt + 15 * SECOND + WAKE_AFTER_MS));
    expect(woken.stage).toBe("answered");
  });

  it("after waking, the old burst is forgotten: it takes a fresh ten to sleep again", () => {
    const asleep = last(pokeAt(every(ASLEEP_AT, SECOND)));
    const wakeAt = (asleep.lastPokeMs ?? 0) + WAKE_AFTER_MS;
    const again = pokeAt(every(ASLEEP_AT, SECOND, wakeAt), asleep);
    expect(again[ASLEEP_AT - 2]?.stage).not.toBe("asleep");
    expect(again[ASLEEP_AT - 1]?.stage).toBe("asleep");
  });

  it("a tired thing rests back to answered", () => {
    const tired = last(pokeAt(every(TIRED_AT, SECOND)));
    expect(tired.stage).toBe("tired");
    const rested = reducePoke(tired, ctx(60 * SECOND));
    expect(rested.stage).toBe("answered");
  });
});

describe("pokeable-reducer: not by drumming, not by patience", () => {
  it("six pokes spread wider than the window never tire it", () => {
    const states = pokeAt(every(TIRED_AT, 7 * SECOND));
    expect(last(states).stage).toBe("answered");
  });

  it("a patient reader who pokes every seven seconds all scene long never tires or sleeps it, however many pokes", () => {
    const states = pokeAt(every(100, 7 * SECOND));
    expect(last(states).count).toBe(100);
    expect(states.every((s) => s.stage === "touched" || s.stage === "answered")).toBe(true);
  });

  it("the count alone never sleeps it", () => {
    // Every 6.7 s nine pokes span 60.3 s, so no minute ever holds ten.
    const states = pokeAt(every(40, 6_700));
    expect(states.every((s) => s.stage !== "asleep")).toBe(true);
  });
});

describe("pokeable-reducer: the bookkeeping", () => {
  it("speaking leaves the state untouched, the same object", () => {
    const state = last(pokeAt([0, SECOND]));
    expect(reducePoke(state, ctx(2 * SECOND, { speaking: true }))).toBe(state);
  });

  it("recentMs keeps the last three", () => {
    const state = last(pokeAt(every(5, SECOND)));
    expect(state.recentMs).toHaveLength(RECENT_KEEP);
    expect(state.recentMs).toEqual([2 * SECOND, 3 * SECOND, 4 * SECOND]);
  });

  it("burstMs holds only the last minute and never more than the sleep count", () => {
    const slow = last(pokeAt(every(6, 20 * SECOND)));
    expect(slow.burstMs).toEqual([40 * SECOND, 60 * SECOND, 80 * SECOND, 100 * SECOND]);
    const fast = last(pokeAt(every(ASLEEP_AT, SECOND)));
    expect(fast.burstMs).toHaveLength(ASLEEP_AT);
  });

  it("the clock is injected: the same intervals at any epoch give the same stages", () => {
    // Six fast (tired at the sixth), four more inside the minute (asleep at
    // the tenth), then one 37 s later: past the twenty seconds of quiet, so
    // it wakes.
    const intervals = [0, 1, 2, 3, 4, 5, 20, 21, 22, 23, 60].map((s) => s * SECOND);
    const atZero = pokeAt(intervals).map((s) => s.stage);
    const atEpoch = pokeAt(intervals.map((t) => t + 1_757_000_000_000)).map((s) => s.stage);
    expect(atEpoch).toEqual(atZero);
    expect(atZero).toEqual([
      "touched", "answered", "answered", "answered", "answered", "tired",
      "tired", "tired", "tired", "asleep", "answered",
    ]);
  });

  it("a literal written against the first contract (no burstMs, no firedRows) reduces cleanly", () => {
    const first: PokeableState = { stage: "touched", count: 1, lastPokeMs: 0, recentMs: [0] };
    const next = reducePoke(first, ctx(SECOND));
    expect(next.stage).toBe("answered");
    expect(next.burstMs).toEqual([SECOND]);
    expect(next.firedRows).toEqual([]);
  });

  it("firedRows is carried, never touched, by the reducer", () => {
    const state: PokeableState = { ...IDLE_POKEABLE, firedRows: [1] };
    expect(reducePoke(state, ctx(0)).firedRows).toEqual([1]);
  });
});
