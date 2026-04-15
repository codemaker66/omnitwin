import { describe, it, expect } from "vitest";
import { classifyZoneV2, zoneSortKey, type RoomDimensions } from "../services/spatial-classifier-v2.js";

// ---------------------------------------------------------------------------
// Grand Hall test dimensions — 21m wide × 10m long, origin at centre.
// x ranges [-10.5, 10.5], z ranges [-5, 5].
// ---------------------------------------------------------------------------
const GRAND_HALL: RoomDimensions = { widthM: 21, lengthM: 10 };

describe("classifyZoneV2 — cardinal walls", () => {
  it("tags the top strip (low nz) as North wall", () => {
    expect(classifyZoneV2(0, -4.5, GRAND_HALL)).toBe("North wall");
    expect(classifyZoneV2(5, -4.8, GRAND_HALL)).toBe("North wall");
  });

  it("tags the bottom strip (high nz) as South wall", () => {
    expect(classifyZoneV2(0, 4.5, GRAND_HALL)).toBe("South wall");
  });

  it("tags the right strip (high nx) as East wall", () => {
    expect(classifyZoneV2(10, 0, GRAND_HALL)).toBe("East wall");
  });

  it("tags the left strip (low nx) NOT in the entrance slice as West wall", () => {
    // Low nx, upper half of the room (nz < 0.7 * 0.8 = 0.56 → NOT entrance)
    expect(classifyZoneV2(-10, -2, GRAND_HALL)).toBe("West wall");
  });
});

describe("classifyZoneV2 — entrance precedence", () => {
  it("places a low-nx + south-back point in Entrance, not West wall", () => {
    // Entrance condition: nx < 0.15 AND nz > 0.8 * 0.7 = 0.56
    // So nx=-9 (nx≈0.07), nz=3 (nz≈0.8) → Entrance
    expect(classifyZoneV2(-9, 3, GRAND_HALL)).toBe("Entrance");
  });

  it("picks West wall when low-nx but not in the entrance band", () => {
    expect(classifyZoneV2(-9, -1, GRAND_HALL)).toBe("West wall");
  });
});

describe("classifyZoneV2 — Centre vs Perimeter", () => {
  it("origin is Centre", () => {
    expect(classifyZoneV2(0, 0, GRAND_HALL)).toBe("Centre");
  });

  it("a point just inside the perimeter band is Perimeter", () => {
    // PERIMETER_X_INNER = 0.25 — so nx = 0.2 (x ≈ -6.3) is Perimeter
    expect(classifyZoneV2(-6.3, 0, GRAND_HALL)).toBe("Perimeter");
  });

  it("a point well inside the centre inner box is Centre", () => {
    expect(classifyZoneV2(0, 1, GRAND_HALL)).toBe("Centre");
  });
});

describe("classifyZoneV2 — boundary handling", () => {
  it("never throws for points at the exact wall", () => {
    expect(() => classifyZoneV2(10.5, 5, GRAND_HALL)).not.toThrow();
  });

  it("handles zero-sized room defensively (division, not NaN zones)", () => {
    // Degenerate input — the classifier shouldn't crash even if widthM=0.
    const result = classifyZoneV2(0, 0, { widthM: 0, lengthM: 10 });
    expect(typeof result).toBe("string");
  });
});

describe("zoneSortKey — walk order", () => {
  it("Entrance comes before any wall", () => {
    expect(zoneSortKey("Entrance")).toBeLessThan(zoneSortKey("North wall"));
    expect(zoneSortKey("Entrance")).toBeLessThan(zoneSortKey("West wall"));
  });

  it("Centre comes last (hallkeeper finishes in the middle)", () => {
    const all: ReturnType<typeof zoneSortKey>[] = [
      zoneSortKey("Entrance"),
      zoneSortKey("North wall"),
      zoneSortKey("West wall"),
      zoneSortKey("East wall"),
      zoneSortKey("South wall"),
      zoneSortKey("Perimeter"),
      zoneSortKey("Centre"),
    ];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a !== undefined && b !== undefined) expect(a).toBeLessThan(b);
      }
    }
  });
});
