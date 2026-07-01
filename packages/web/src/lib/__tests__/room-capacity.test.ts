import { describe, it, expect } from "vitest";
import { roomStyleCapacities, styleFitSummary } from "../room-capacity.js";

// Grand Hall ≈ 21 m × 10 m = 210 m².
const GRAND_HALL = 210;

describe("roomStyleCapacities", () => {
  it("gives every event style's comfortable/tight capacity, sorted most-to-fewest", () => {
    const rows = roomStyleCapacities(GRAND_HALL, null);
    expect(rows).toHaveLength(7);
    const reception = rows[0];
    expect(reception?.style).toBe("cocktail");
    expect(reception?.label).toBe("Reception (standing)");
    expect(reception?.comfortable).toBe(323); // 210 / 0.65
    expect(reception?.tight).toBe(466); // 210 / 0.45
    expect(reception?.fit).toBe("unknown"); // no guest count
    // Descending comfortable capacity.
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]?.comfortable ?? 0) >= (rows[i]?.comfortable ?? 0)).toBe(true);
    }
  });

  it("verdicts each style against a guest count", () => {
    const byStyle = new Map(roomStyleCapacities(GRAND_HALL, 150).map((r) => [r.style, r]));
    expect(byStyle.get("theatre")?.fit).toBe("fits"); // 150 ≤ 262 comfortable
    expect(byStyle.get("cabaret")?.fit).toBe("tight"); // 116 comfortable < 150 ≤ 150 tight
    expect(byStyle.get("boardroom")?.fit).toBe("over"); // 150 > 116 tight
  });

  it("is all-zero / all-over for a room with no floor area", () => {
    const rows = roomStyleCapacities(0, 100);
    expect(rows.every((r) => r.comfortable === 0 && r.tight === 0)).toBe(true);
    expect(rows.every((r) => r.fit === "over")).toBe(true);
  });
});

describe("styleFitSummary", () => {
  it("summarises which styles suit a guest count", () => {
    const summary = styleFitSummary(roomStyleCapacities(GRAND_HALL, 150), 150);
    expect(summary).toContain("150 guests");
    expect(summary).toContain("comfortable for");
    expect(summary).toContain("tight for");
    expect(summary).toContain("over for Boardroom");
  });

  it("is null without a guest count", () => {
    expect(styleFitSummary(roomStyleCapacities(GRAND_HALL, null), null)).toBeNull();
  });
});
