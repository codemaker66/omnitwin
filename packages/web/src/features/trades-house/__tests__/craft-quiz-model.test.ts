import { describe, expect, it } from "vitest";
import {
  AXIS_KEYS,
  type AxisTotals,
  type AxisVector,
  CRAFT_AXIS_PROFILES,
  CRAFT_ORDER,
  CRAFT_QUESTIONS,
  ZERO_AXIS_TOTALS,
  ZERO_CRAFT_QUIZ_PROGRESS,
  ZERO_WORLD_TALLY,
  CRAFT_WORLD_HOMES,
  worldAffinity,
  type CraftQuizProgress,
  applyCraftQuizAnswer,
  buildCraftIntroductionMailto,
  craftAffinity,
  rankCrafts,
} from "../craft-quiz-model.js";

const asProgress = (
  totals: AxisTotals,
  lastAxes: AxisVector = {},
  world = ZERO_WORLD_TALLY,
): CraftQuizProgress => ({ totals, lastAxes, world });

describe("craft quiz model", () => {
  it("keeps the twelve-scene, fourteen-Craft structure intact", () => {
    expect(CRAFT_ORDER).toHaveLength(14);
    expect(new Set(CRAFT_ORDER).size).toBe(14);
    expect(CRAFT_QUESTIONS).toHaveLength(12);
    expect(CRAFT_QUESTIONS.every((question) => question.options.length === 4)).toBe(true);
    expect(Object.keys(CRAFT_AXIS_PROFILES)).toHaveLength(14);
  });

  it("accumulates the chosen option's axes without mutating the prior totals", () => {
    const original = { ...ZERO_AXIS_TOTALS, a1: 1 };
    const before = asProgress(original);
    const result = applyCraftQuizAnswer(before, 0, 0);

    // Derived from the model, not transcribed from it. This test is about the
    // prior totals staying untouched; pinning a literal vector made it fail
    // every time the writing changed, which taught us nothing about mutation.
    const applied: AxisVector = CRAFT_QUESTIONS[0]?.options[0]?.axes ?? {};
    expect(original).toEqual({ a1: 1, a2: 0, a3: 0, a4: 0, a5: 0 });
    expect(result.totals).toEqual({
      ...ZERO_AXIS_TOTALS,
      ...Object.fromEntries(AXIS_KEYS.map((k) => [k, (k === "a1" ? 1 : 0) + (applied[k] ?? 0)])),
    });
    expect(result.lastAxes).toEqual(applied);
    // The world tally moves with it, and only for the world the answer lives in.
    const home = CRAFT_QUESTIONS[0]?.options[0]?.world;
    expect(before.world).toEqual(ZERO_WORLD_TALLY);
    expect(result.world[home ?? "hammermen"]).toBe(1);
    expect(Object.values(result.world).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("rejects out-of-range questions and options", () => {
    expect(() => applyCraftQuizAnswer(ZERO_CRAFT_QUIZ_PROGRESS, -1, 0)).toThrow(RangeError);
    expect(() => applyCraftQuizAnswer(ZERO_CRAFT_QUIZ_PROGRESS, 0, 4)).toThrow(RangeError);
    expect(() => applyCraftQuizAnswer(ZERO_CRAFT_QUIZ_PROGRESS, CRAFT_QUESTIONS.length, 0)).toThrow(RangeError);
  });

  it("scores a Craft's own direction as a perfect match", () => {
    expect(craftAffinity(CRAFT_AXIS_PROFILES.masons, "masons")).toBeCloseTo(1, 10);
    expect(craftAffinity(CRAFT_AXIS_PROFILES.masons, "gardeners")).toBeLessThan(0);
  });

  it("scores nothing when no answer has been given yet", () => {
    expect(craftAffinity(ZERO_AXIS_TOTALS, "hammermen")).toBe(0);
  });

  // Emphasis must not decide the sort: someone who answers timidly and someone
  // who answers vehemently in the same direction belong to the same Craft.
  it("ranks by direction, not by how hard somebody answered", () => {
    const quiet = { a1: 1, a2: 1, a3: 1, a4: -3, a5: 0 };
    const loud = { a1: 4, a2: 4, a3: 4, a4: -12, a5: 0 };

    expect(rankCrafts(asProgress(quiet))[0]?.craftId).toBe(rankCrafts(asProgress(loud))[0]?.craftId);
    expect(rankCrafts(asProgress(quiet))[0]?.score).toBeCloseTo(rankCrafts(asProgress(loud))[0]?.score ?? -1, 10);
  });

  it("breaks ties toward the Craft the final answer pointed at", () => {
    const towardWrights = rankCrafts(asProgress({ a1: 0, a2: 0, a3: 0, a4: 0, a5: 1 }, { a5: 3 }));
    expect(towardWrights[0]?.craftId).toBe("wrights");
  });

  it("returns every Craft in every ranking, best first", () => {
    const ranking = rankCrafts(asProgress({ a1: 2, a2: 1, a3: 0, a4: -1, a5: 1 }));

    expect(ranking).toHaveLength(14);
    expect(new Set(ranking.map(({ craftId }) => craftId)).size).toBe(14);
    for (let index = 1; index < ranking.length; index += 1) {
      expect(ranking[index - 1]?.score).toBeGreaterThanOrEqual(ranking[index]?.score ?? Infinity);
    }
  });

  it("builds an encoded introduction email for the selected Craft", () => {
    const href = buildCraftIntroductionMailto("hammermen");

    expect(href).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?/u);
    expect(decodeURIComponent(href)).toContain("Craft introduction — THE HAMMERMEN");
    expect(decodeURIComponent(href)).toContain("My trade or profession:");
  });
});

describe("the world channel", () => {
  it("gives every Craft three or four homes among the forty-eight answers", () => {
    for (const craftId of Object.keys(CRAFT_WORLD_HOMES) as (keyof typeof CRAFT_WORLD_HOMES)[]) {
      expect(CRAFT_WORLD_HOMES[craftId], craftId).toBeGreaterThanOrEqual(3);
      expect(CRAFT_WORLD_HOMES[craftId], craftId).toBeLessThanOrEqual(4);
    }
    expect(Object.values(CRAFT_WORLD_HOMES).reduce((a, b) => a + b, 0)).toBe(48);
  });

  it("offers four DIFFERENT worlds in every scene — never two answers from one Craft", () => {
    for (const [index, question] of CRAFT_QUESTIONS.entries()) {
      expect(new Set(question.options.map((o) => o.world)).size, `scene ${String(index + 1)}`).toBe(4);
    }
  });

  it("measures the share of a Craft's world walked through, so four homes are no advantage over three", () => {
    expect(worldAffinity(ZERO_WORLD_TALLY, "gardeners")).toBe(0);
    const full = { ...ZERO_WORLD_TALLY, gardeners: CRAFT_WORLD_HOMES.gardeners };
    expect(worldAffinity(full, "gardeners")).toBe(1);
    const half = { ...ZERO_WORLD_TALLY, coopers: CRAFT_WORLD_HOMES.coopers / 3 };
    expect(worldAffinity(half, "coopers")).toBeCloseTo(1 / 3, 10);
  });

  it("lets a consistent world decide between two Crafts the axes cannot separate", () => {
    // Masons and Weavers point within 0.79 of each other. A respondent whose
    // temperament sits exactly between them is sorted by which world they chose.
    const between = {
      a1: CRAFT_AXIS_PROFILES.masons.a1 + CRAFT_AXIS_PROFILES.weavers.a1,
      a2: CRAFT_AXIS_PROFILES.masons.a2 + CRAFT_AXIS_PROFILES.weavers.a2,
      a3: CRAFT_AXIS_PROFILES.masons.a3 + CRAFT_AXIS_PROFILES.weavers.a3,
      a4: CRAFT_AXIS_PROFILES.masons.a4 + CRAFT_AXIS_PROFILES.weavers.a4,
      a5: CRAFT_AXIS_PROFILES.masons.a5 + CRAFT_AXIS_PROFILES.weavers.a5,
    };
    const walkedMasons = asProgress(between, {}, { ...ZERO_WORLD_TALLY, masons: 3 });
    const walkedWeavers = asProgress(between, {}, { ...ZERO_WORLD_TALLY, weavers: 3 });
    expect(rankCrafts(walkedMasons)[0]?.craftId).toBe("masons");
    expect(rankCrafts(walkedWeavers)[0]?.craftId).toBe("weavers");
  });
});
