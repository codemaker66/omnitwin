import { describe, expect, it } from "vitest";
import {
  CRAFT_AXIS_PROFILES,
  CRAFT_ORDER,
  CRAFT_QUESTIONS,
  ZERO_AXIS_TOTALS,
  applyCraftQuizAnswer,
  buildCraftIntroductionMailto,
  craftAffinity,
  rankCrafts,
} from "../craft-quiz-model.js";

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
    const result = applyCraftQuizAnswer(original, 0, 0);

    expect(original).toEqual({ a1: 1, a2: 0, a3: 0, a4: 0, a5: 0 });
    // Q1 option 1 is a1+2 a4-1 a5+1.
    expect(result.totals).toEqual({ a1: 3, a2: 0, a3: 0, a4: -1, a5: 1 });
    expect(result.lastAxes).toEqual({ a1: 2, a4: -1, a5: 1 });
  });

  it("rejects out-of-range questions and options", () => {
    expect(() => applyCraftQuizAnswer(ZERO_AXIS_TOTALS, -1, 0)).toThrow(RangeError);
    expect(() => applyCraftQuizAnswer(ZERO_AXIS_TOTALS, 0, 4)).toThrow(RangeError);
    expect(() => applyCraftQuizAnswer(ZERO_AXIS_TOTALS, CRAFT_QUESTIONS.length, 0)).toThrow(RangeError);
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

    expect(rankCrafts(quiet)[0]?.craftId).toBe(rankCrafts(loud)[0]?.craftId);
    expect(rankCrafts(quiet)[0]?.score).toBeCloseTo(rankCrafts(loud)[0]?.score ?? -1, 10);
  });

  it("breaks ties toward the Craft the final answer pointed at", () => {
    const towardWrights = rankCrafts({ a1: 0, a2: 0, a3: 0, a4: 0, a5: 1 }, { a5: 3 });
    expect(towardWrights[0]?.craftId).toBe("wrights");
  });

  it("returns every Craft in every ranking, best first", () => {
    const ranking = rankCrafts({ a1: 2, a2: 1, a3: 0, a4: -1, a5: 1 });

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
