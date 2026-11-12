import { describe, it, expect } from "vitest";
import * as roomCapacity from "../room-capacity.js";
import { roomStyleEstimates } from "../room-capacity.js";
import { HALL_LENGTH, HALL_WIDTH } from "../../components/grand-hall/hall-spec.js";

// The Grand Hall's floor as the red team quoted it, at its old hand-drawn
// 21 m × 10.5 m = 220.5 m² (redteam fix-first 1). The planner now opens the
// hall at its scanned 21.135 m × 10.59 m = 223.8 m² (SCANNED_GRAND_HALL).
const GRAND_HALL = 220.5;
const SCANNED_GRAND_HALL = HALL_LENGTH * HALL_WIDTH;

describe("roomStyleEstimates", () => {
  it("gives floor area ÷ generic spacing for every style, most to fewest", () => {
    const rows = roomStyleEstimates(GRAND_HALL);
    expect(rows).toHaveLength(7);
    expect(rows[0]?.style).toBe("cocktail");
    expect(rows[0]?.label).toBe("Reception (standing)");
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]?.estimate ?? 0) >= (rows[i]?.estimate ?? 0)).toBe(true);
    }
  });

  it("reproduces the arithmetic the red team quoted: 339 standing, 147 dinner, 275 theatre", () => {
    const byStyle = new Map(roomStyleEstimates(GRAND_HALL).map((row) => [row.style, row.estimate]));
    expect(byStyle.get("cocktail")).toBe(339); // 220.5 / 0.65
    expect(byStyle.get("dinner-rounds")).toBe(147); // 220.5 / 1.5
    expect(byStyle.get("theatre")).toBe(275); // 220.5 / 0.8
  });

  it("gives the scanned hall's arithmetic room-capacity.ts states: 344 standing, never 497", () => {
    const rows = roomStyleEstimates(SCANNED_GRAND_HALL);
    const byStyle = new Map(rows.map((row) => [row.style, row.estimate]));
    expect(byStyle.get("cocktail")).toBe(344); // 223.82 / 0.65
    expect(byStyle.get("dinner-rounds")).toBe(149); // 223.82 / 1.5
    expect(byStyle.get("theatre")).toBe(279); // 223.82 / 0.8
    // 497 standing at the 0.45 m² minimum is not produced here either.
    expect(rows.some((row) => row.estimate === 497)).toBe(false);
  });

  it("carries no verdict and no count at the minimum allowance", () => {
    for (const row of roomStyleEstimates(GRAND_HALL)) {
      expect(Object.keys(row).sort()).toEqual(["estimate", "label", "style"]);
    }
    // 490 standing at the 0.45 m² minimum was the most dangerous figure; it is
    // no longer produced anywhere in this module.
    expect(roomStyleEstimates(GRAND_HALL).some((row) => row.estimate === 490)).toBe(false);
    expect(Object.keys(roomCapacity)).not.toContain("styleFitSummary");
    expect(Object.keys(roomCapacity)).not.toContain("styleFitLabel");
  });

  it("is all-zero for a room with no floor area", () => {
    expect(roomStyleEstimates(0).every((row) => row.estimate === 0)).toBe(true);
  });
});
