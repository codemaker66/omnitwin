import { describe, expect, it } from "vitest";
import {
  CRAFT_ORDER,
  CRAFT_QUESTIONS,
  applyCraftQuizAnswer,
  buildCraftIntroductionMailto,
  rankCrafts,
} from "../craft-quiz-model.js";

describe("craft quiz model", () => {
  it("keeps the supplied nine-question, fourteen-Craft structure intact", () => {
    expect(CRAFT_ORDER).toHaveLength(14);
    expect(new Set(CRAFT_ORDER).size).toBe(14);
    expect(CRAFT_QUESTIONS).toHaveLength(9);
    expect(CRAFT_QUESTIONS.every((question) => question.options.length === 4)).toBe(true);
  });

  it("applies the supplied option weights without mutating prior scores", () => {
    const original = { hammermen: 1 } as const;
    const result = applyCraftQuizAnswer(original, 0, 0);

    expect(original).toEqual({ hammermen: 1 });
    expect(result.scores).toEqual({ hammermen: 3, wrights: 1 });
    expect(result.lastWeights).toEqual({ hammermen: 2, wrights: 1 });
  });

  it("rejects out-of-range questions and options", () => {
    expect(() => applyCraftQuizAnswer({}, -1, 0)).toThrow(RangeError);
    expect(() => applyCraftQuizAnswer({}, 0, 4)).toThrow(RangeError);
  });

  it("uses the final answer as the supplied tie-break before stable Craft order", () => {
    const ranking = rankCrafts(
      { hammermen: 4, wrights: 4, masons: 4 },
      { wrights: 2, masons: 1 },
    );

    expect(ranking.slice(0, 3).map(({ craftId }) => craftId)).toEqual([
      "wrights",
      "masons",
      "hammermen",
    ]);
  });

  it("builds an encoded introduction email for the selected Craft", () => {
    const href = buildCraftIntroductionMailto("hammermen");

    expect(href).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?/u);
    expect(decodeURIComponent(href)).toContain("Craft introduction — THE HAMMERMEN");
    expect(decodeURIComponent(href)).toContain("My trade or profession:");
  });
});
