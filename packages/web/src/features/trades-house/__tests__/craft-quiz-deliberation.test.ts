// -----------------------------------------------------------------------------
// The Deliberation: the mechanics, and the same content gates the twelve scenes
// had to pass. A bespoke pair-breaker that names a Craft, points away from its
// own world, or reads as Latinate is worse than no breaker — it would teach a
// visitor the trick at exactly the moment they are paying most attention.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CRAFT_AXIS_PROFILES,
  CRAFT_ORDER,
  ZERO_CRAFT_QUIZ_PROGRESS,
  ZERO_WORLD_TALLY,
  craftAffinity,
  rankCrafts,
  type AxisTotals,
  type CraftId,
  type CraftQuizProgress,
} from "../craft-quiz-model.js";
import {
  CRAFT_DELIBERATIONS,
  CRAFT_WORLD_LINES,
  DELIBERATION_FRAME,
  DELIBERATION_REPLY,
  DELIBERATION_THRESHOLD,
  DELIBERATION_WEIGHT,
  HUNG_THRESHOLD,
  applyDeliberation,
  deliberate,
  pairKey,
  verdict,
  worldLineAgreement,
} from "../craft-quiz-deliberation.js";
import { CRAFT_NAMES, WORLD_LEXICON, longestSentenceWords } from "./world-lexicon.js";

const totalsOf = (craftId: CraftId): AxisTotals => ({ ...CRAFT_AXIS_PROFILES[craftId] });
const progressAt = (totals: AxisTotals, world = ZERO_WORLD_TALLY): CraftQuizProgress => ({ totals, lastAxes: {}, world });

/** A respondent sitting exactly between two Crafts on temperament, worlds even. */
function between(a: CraftId, b: CraftId): CraftQuizProgress {
  const ta = totalsOf(a); const tb = totalsOf(b);
  return progressAt({ a1: ta.a1 + tb.a1, a2: ta.a2 + tb.a2, a3: ta.a3 + tb.a3, a4: ta.a4 + tb.a4, a5: ta.a5 + tb.a5 });
}

describe("when he asks one more thing", () => {
  it("stays quiet when the verdict is clear", () => {
    const clear = progressAt(totalsOf("gardeners"), { ...ZERO_WORLD_TALLY, gardeners: 3 });
    const [first, second] = rankCrafts(clear);
    expect((first?.score ?? 0) - (second?.score ?? 0)).toBeGreaterThanOrEqual(DELIBERATION_THRESHOLD);
    expect(deliberate(clear)).toBeNull();
  });

  it("asks when the top two are within the threshold, and asks about THAT pair", () => {
    const asked = deliberate(between("masons", "weavers"));
    expect(asked).not.toBeNull();
    expect([...(asked?.pair ?? [])].sort()).toEqual(["masons", "weavers"]);
  });

  it("uses the bespoke scene where one exists, and composes one where it does not", () => {
    const authored = deliberate(between("masons", "weavers"));
    expect(authored?.authored).toBe(true);
    expect(authored?.scene).not.toBe(DELIBERATION_FRAME);
    // Gardeners and Barbers are close by geometry (0.54) but not among the twelve.
    const composed = deliberate(between("gardeners", "barbers"));
    expect(composed?.authored).toBe(false);
    expect(composed?.scene).toBe(DELIBERATION_FRAME);
    expect(composed?.options.map((o) => o.world).sort()).toEqual(["barbers", "gardeners"]);
  });

  it("weighs the deciding answer more than an ordinary one, on both channels", () => {
    const close = between("masons", "weavers");
    const asked = deliberate(close);
    if (asked === null) throw new Error("expected a deliberation");
    const after = applyDeliberation(close, asked, 0);
    const picked = asked.options[0];
    expect(after.world[picked.world] - close.world[picked.world]).toBe(DELIBERATION_WEIGHT);
    expect(after.totals.a1 - close.totals.a1).toBeCloseTo(DELIBERATION_WEIGHT * (picked.axes.a1 ?? 0), 10);
    expect(close.world[picked.world]).toBe(0);
  });

  it("lets the deciding answer actually decide, for every bespoke pair, both ways", () => {
    // Start between the pair (the arithmetic midpoint is not always "close"
    // under cosine, so the scene is applied directly rather than via
    // deliberate()); whichever answer is taken, that Craft must win.
    for (const scene of CRAFT_DELIBERATIONS) {
      const [a, b] = scene.pair;
      const close = between(a, b);
      const asked = { ...scene, authored: true };
      for (const pick of [0, 1] as const) {
        const chosenWorld = asked.options[pick].world;
        const [winner] = rankCrafts(applyDeliberation(close, asked, pick));
        expect(winner?.craftId, `${a}/${b} picking ${chosenWorld}`).toBe(chosenWorld);
      }
    }
  });

  it("reports a hung verdict only when the top two are still within a hair", () => {
    expect(verdict(between("masons", "weavers")).hung).toBe(true);
    expect(verdict(progressAt(totalsOf("dyers"), { ...ZERO_WORLD_TALLY, dyers: 3 })).hung).toBe(false);
    expect(HUNG_THRESHOLD).toBeLessThan(DELIBERATION_THRESHOLD);
  });

  it("canonicalises pairs so lookup cannot depend on which Craft came first", () => {
    expect(pairKey("weavers", "masons")).toEqual(pairKey("masons", "weavers"));
    expect(pairKey("masons", "weavers")).toEqual(["masons", "weavers"]);
  });
});

describe("the twelve bespoke scenes", () => {
  it("cover twelve distinct pairs, each with exactly one answer per Craft of the pair", () => {
    expect(CRAFT_DELIBERATIONS).toHaveLength(12);
    const keys = new Set(CRAFT_DELIBERATIONS.map((s) => pairKey(s.pair[0], s.pair[1]).join("/")));
    expect(keys.size).toBe(12);
    for (const scene of CRAFT_DELIBERATIONS) {
      expect(scene.options).toHaveLength(2);
      expect(scene.options.map((o) => o.world).sort()).toEqual([...scene.pair].sort());
    }
  });

  it("never point an answer away from its own Craft — the channels agree here too", () => {
    const bad: string[] = [];
    for (const scene of CRAFT_DELIBERATIONS) {
      for (const option of scene.options) {
        const totals: AxisTotals = { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, ...option.axes } as AxisTotals;
        const agreement = craftAffinity(totals, option.world);
        if (agreement < 0.55) bad.push(`${scene.pair.join("/")} "${option.lead}" vs ${option.world} = ${agreement.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("put a word of the Craft's own world in every answer — a lay reader can make the guess", () => {
    const mute: string[] = [];
    for (const scene of CRAFT_DELIBERATIONS) {
      for (const option of scene.options) {
        const text = `${option.lead} ${option.body}`;
        if (!WORLD_LEXICON[option.world].some((p) => p.test(text))) mute.push(`${scene.pair.join("/")} "${option.lead}" says nothing of the ${option.world}`);
      }
    }
    expect(mute).toEqual([]);
  });

  it("name no Craft anywhere, and neither does the frame or the reply", () => {
    const leaks: string[] = [];
    for (const scene of CRAFT_DELIBERATIONS) {
      if (CRAFT_NAMES.test(scene.scene)) leaks.push(`${scene.pair.join("/")} scene`);
      for (const option of scene.options) {
        if (CRAFT_NAMES.test(`${option.lead} ${option.body} ${option.cost} ${option.ledger}`)) leaks.push(`${scene.pair.join("/")} "${option.lead}"`);
      }
    }
    if (CRAFT_NAMES.test(DELIBERATION_FRAME)) leaks.push("frame");
    if (CRAFT_NAMES.test(DELIBERATION_REPLY)) leaks.push("reply");
    expect(leaks).toEqual([]);
  });

  it("stay plain — no sentence past thirty words — and each answer names its price and its ledger line", () => {
    const long: string[] = [];
    for (const scene of CRAFT_DELIBERATIONS) {
      if (longestSentenceWords(scene.scene) > 30) long.push(`${scene.pair.join("/")} scene ${String(longestSentenceWords(scene.scene))}w`);
      for (const option of scene.options) {
        const words = longestSentenceWords(`${option.body} ${option.cost}`);
        if (words > 30) long.push(`${scene.pair.join("/")} "${option.lead}" ${String(words)}w`);
        expect(option.cost.length, `${scene.pair.join("/")} "${option.lead}" has no cost`).toBeGreaterThan(20);
        expect(option.ledger.startsWith("In the end,"), `${option.lead} ledger`).toBe(true);
      }
    }
    expect(long).toEqual([]);
  });
});

describe("the fourteen world lines", () => {
  it("exist for every Craft and point at it", () => {
    for (const craftId of CRAFT_ORDER) {
      expect(CRAFT_WORLD_LINES[craftId].body.length, craftId).toBeGreaterThan(40);
      expect(worldLineAgreement(craftId), `${craftId} world line points elsewhere`).toBeGreaterThan(0.55);
    }
  });

  it("are legible to a stranger, name no Craft, and stay plain", () => {
    const problems: string[] = [];
    for (const craftId of CRAFT_ORDER) {
      const line = CRAFT_WORLD_LINES[craftId];
      const text = `${line.lead} ${line.body}`;
      if (!WORLD_LEXICON[craftId].some((p) => p.test(text))) problems.push(`${craftId}: no world word`);
      if (CRAFT_NAMES.test(`${text} ${line.cost}`)) problems.push(`${craftId}: names a Craft`);
      if (longestSentenceWords(`${line.body} ${line.cost}`) > 30) problems.push(`${craftId}: a sentence over thirty words`);
    }
    expect(problems).toEqual([]);
  });

  it("compose a deliberation for close pairs that have no bespoke scene", () => {
    let composed = 0;
    for (let i = 0; i < CRAFT_ORDER.length; i += 1) {
      for (let j = i + 1; j < CRAFT_ORDER.length; j += 1) {
        const a = CRAFT_ORDER[i]; const b = CRAFT_ORDER[j];
        if (a === undefined || b === undefined) continue;
        const asked = deliberate(between(a, b));
        if (asked === null) continue;
        expect(asked.options).toHaveLength(2);
        if (!asked.authored) composed += 1;
      }
    }
    expect(composed).toBeGreaterThan(0);
  });

  it("treats an untouched slate as a tie, which it is", () => {
    expect(deliberate(ZERO_CRAFT_QUIZ_PROGRESS)).not.toBeNull();
  });
});
