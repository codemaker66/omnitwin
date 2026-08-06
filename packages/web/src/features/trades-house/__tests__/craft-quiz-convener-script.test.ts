// ---------------------------------------------------------------------------
// The Convener's quiz script — content integrity
//
// The type system already refuses a voiceless option (convenerLine is
// required). These tests hold the SCRIPT to performance standards: no line
// repeated, no line that trails off, none so long the typewriter outstays
// its welcome between questions.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CRAFT_QUESTIONS } from "../craft-quiz-model.js";

const ALL_LINES = CRAFT_QUESTIONS.flatMap((question) =>
  question.options.map((option) => ({
    line: option.convenerLine,
    where: `${question.prompt} → ${option.title}`,
  })),
);

describe("the Convener's option reactions", () => {
  it("gives every one of the 36 options a spoken reaction", () => {
    expect(ALL_LINES).toHaveLength(36);
    for (const { line, where } of ALL_LINES) {
      expect(line.trim().length, where).toBeGreaterThan(0);
    }
  });

  it("never repeats himself — every reaction is unique", () => {
    const unique = new Set(ALL_LINES.map(({ line }) => line));
    expect(unique.size).toBe(ALL_LINES.length);
  });

  it("keeps each line short enough that the typewriter never drags", () => {
    // 160 chars at 52cps ≈ 3.1s of typing — the ceiling before reacting to
    // an answer starts to feel like being detained by an elderly relative.
    for (const { line, where } of ALL_LINES) {
      expect(line.length, where).toBeLessThanOrEqual(160);
    }
  });

  it("finishes every sentence — he performs, he doesn't trail off", () => {
    for (const { line, where } of ALL_LINES) {
      expect(/[.!?…]$/u.test(line), `${where}: "${line}"`).toBe(true);
    }
  });
});
