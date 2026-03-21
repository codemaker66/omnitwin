import { describe, it, expect } from "vitest";
import {
  pointInPolygon,
  distanceToEdge,
  distanceToPoint,
  circleInPolygon,
  rectInPolygon,
  lineIntersectsRect,
  generateGridPoints,
} from "../geometry.js";
import type { FloorPlanPoint } from "../../space.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** 10×10 square polygon, origin at (0,0). */
const SQUARE: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** L-shaped polygon. */
const L_SHAPE: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 10 },
  { x: 0, y: 10 },
];

/** Triangle. */
const TRIANGLE: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 10 },
];

// ---------------------------------------------------------------------------
// pointInPolygon
// ---------------------------------------------------------------------------

describe("pointInPolygon", () => {
  it("returns true for a point inside a square", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true);
  });

  it("returns true for a point inside near a corner", () => {
    expect(pointInPolygon({ x: 0.1, y: 0.1 }, SQUARE)).toBe(true);
  });

  it("returns false for a point outside the square", () => {
    expect(pointInPolygon({ x: -1, y: 5 }, SQUARE)).toBe(false);
  });

  it("returns false for a point far outside", () => {
    expect(pointInPolygon({ x: 100, y: 100 }, SQUARE)).toBe(false);
  });

  it("returns true for a point inside L-shape", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, L_SHAPE)).toBe(true);
  });

  it("returns false for a point in the cutout of L-shape", () => {
    expect(pointInPolygon({ x: 7, y: 7 }, L_SHAPE)).toBe(false);
  });

  it("returns true for a point inside the triangle", () => {
    expect(pointInPolygon({ x: 5, y: 3 }, TRIANGLE)).toBe(true);
  });

  it("returns false for a point outside the triangle", () => {
    expect(pointInPolygon({ x: 1, y: 9 }, TRIANGLE)).toBe(false);
  });

  it("returns false for a degenerate polygon with fewer than 3 points", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it("returns false for an empty polygon", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// distanceToPoint
// ---------------------------------------------------------------------------

describe("distanceToPoint", () => {
  it("returns 0 for identical points", () => {
    expect(distanceToPoint({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(0);
  });

  it("returns correct distance for 3-4-5 triangle", () => {
    expect(distanceToPoint({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("returns correct distance along X axis", () => {
    expect(distanceToPoint({ x: 0, y: 0 }, { x: 7, y: 0 })).toBe(7);
  });

  it("returns correct distance along Y axis", () => {
    expect(distanceToPoint({ x: 0, y: 0 }, { x: 0, y: 11 })).toBe(11);
  });

  it("is symmetric", () => {
    const a: FloorPlanPoint = { x: 1, y: 2 };
    const b: FloorPlanPoint = { x: 4, y: 6 };
    expect(distanceToPoint(a, b)).toBe(distanceToPoint(b, a));
  });
});

// ---------------------------------------------------------------------------
// distanceToEdge
// ---------------------------------------------------------------------------

describe("distanceToEdge", () => {
  it("returns distance to nearest edge for point at center of square", () => {
    // Center of 10×10 square → 5m to any edge
    expect(distanceToEdge({ x: 5, y: 5 }, SQUARE)).toBe(5);
  });

  it("returns distance to nearest edge for off-center point", () => {
    // (1, 5) → 1m to left edge
    expect(distanceToEdge({ x: 1, y: 5 }, SQUARE)).toBeCloseTo(1, 10);
  });

  it("returns 0 for point on edge", () => {
    expect(distanceToEdge({ x: 0, y: 5 }, SQUARE)).toBeCloseTo(0, 10);
  });

  it("returns 0 for point at corner", () => {
    expect(distanceToEdge({ x: 0, y: 0 }, SQUARE)).toBeCloseTo(0, 10);
  });

  it("returns distance for point outside polygon", () => {
    // (-1, 5) → 1m to left edge
    expect(distanceToEdge({ x: -1, y: 5 }, SQUARE)).toBeCloseTo(1, 10);
  });

  it("returns Infinity for polygon with fewer than 2 points", () => {
    expect(distanceToEdge({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// circleInPolygon
// ---------------------------------------------------------------------------

describe("circleInPolygon", () => {
  it("returns true for a small circle at the center of the square", () => {
    expect(circleInPolygon({ x: 5, y: 5 }, 1, SQUARE)).toBe(true);
  });

  it("returns true for a circle that exactly fits", () => {
    // radius 5 at center of 10×10 square — edge distance is exactly 5
    expect(circleInPolygon({ x: 5, y: 5 }, 5, SQUARE)).toBe(true);
  });

  it("returns false for a circle that exceeds the polygon", () => {
    expect(circleInPolygon({ x: 5, y: 5 }, 6, SQUARE)).toBe(false);
  });

  it("returns false for a circle centered too close to edge", () => {
    // (1, 5) with radius 2 → goes past the left edge
    expect(circleInPolygon({ x: 1, y: 5 }, 2, SQUARE)).toBe(false);
  });

  it("returns false if center is outside polygon", () => {
    expect(circleInPolygon({ x: -1, y: 5 }, 0.5, SQUARE)).toBe(false);
  });

  it("returns true for tiny circle inside L-shape", () => {
    expect(circleInPolygon({ x: 2, y: 2 }, 0.5, L_SHAPE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rectInPolygon
// ---------------------------------------------------------------------------

describe("rectInPolygon", () => {
  it("returns true for a small rect at center", () => {
    expect(rectInPolygon({ x: 5, y: 5 }, 2, 2, 0, SQUARE)).toBe(true);
  });

  it("returns false for a rect that extends past edge", () => {
    expect(rectInPolygon({ x: 0.5, y: 5 }, 2, 2, 0, SQUARE)).toBe(false);
  });

  it("returns true for a rotated rect that fits", () => {
    // Small rect at center, 45° rotation — should still fit in 10×10 square
    expect(rectInPolygon({ x: 5, y: 5 }, 2, 2, Math.PI / 4, SQUARE)).toBe(true);
  });

  it("returns false for a large rotated rect that no longer fits", () => {
    // 14×2 rect at center, 45° rotation — half-diagonal ≈ 7.07, exceeds 5m to edge
    expect(rectInPolygon({ x: 5, y: 5 }, 14, 2, Math.PI / 4, SQUARE)).toBe(false);
  });

  it("returns false for rect exceeding polygon (boundary not inside)", () => {
    // Corners land exactly on polygon edges — pointInPolygon returns false for boundary
    expect(rectInPolygon({ x: 5, y: 5 }, 10, 10, 0, SQUARE)).toBe(false);
  });

  it("returns true for rect slightly smaller than polygon", () => {
    expect(rectInPolygon({ x: 5, y: 5 }, 9.9, 9.9, 0, SQUARE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lineIntersectsRect
// ---------------------------------------------------------------------------

describe("lineIntersectsRect", () => {
  it("returns true for line passing through rect", () => {
    expect(lineIntersectsRect(
      { x: 0, y: 5 }, { x: 10, y: 5 },
      { x: 5, y: 5 }, 4, 4, 0,
    )).toBe(true);
  });

  it("returns false for line that misses rect", () => {
    expect(lineIntersectsRect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 5, y: 5 }, 2, 2, 0,
    )).toBe(false);
  });

  it("returns true for line that starts inside rect", () => {
    expect(lineIntersectsRect(
      { x: 5, y: 5 }, { x: 20, y: 5 },
      { x: 5, y: 5 }, 4, 4, 0,
    )).toBe(true);
  });

  it("handles rotated rect correctly", () => {
    // Line along y=0 should miss a rect at (5,5) rotated 45°
    // The rect is 2×2 rotated 45° at center (5,5) — extends roughly 1.41 in each direction
    expect(lineIntersectsRect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 5, y: 5 }, 2, 2, Math.PI / 4,
    )).toBe(false);
  });

  it("returns true for line tangent to rect edge", () => {
    // Rect 4×4 at (5,5) → edges at x=3..7, y=3..7
    // Line from (3,0) to (3,10) touches left edge
    expect(lineIntersectsRect(
      { x: 3, y: 0 }, { x: 3, y: 10 },
      { x: 5, y: 5 }, 4, 4, 0,
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateGridPoints
// ---------------------------------------------------------------------------

describe("generateGridPoints", () => {
  it("generates points inside the polygon", () => {
    const points = generateGridPoints(SQUARE, 2, 2);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(pointInPolygon(p, SQUARE)).toBe(true);
    }
  });

  it("generates correct count for simple grid", () => {
    // 10×10 square, spacing 5×5 → grid starts at 2.5,2.5 → candidates at (2.5,2.5), (2.5,7.5), (7.5,2.5), (7.5,7.5)
    const points = generateGridPoints(SQUARE, 5, 5);
    expect(points.length).toBe(4);
  });

  it("returns empty for degenerate polygon", () => {
    expect(generateGridPoints([], 2, 2)).toEqual([]);
  });

  it("returns empty for zero spacing", () => {
    expect(generateGridPoints(SQUARE, 0, 2)).toEqual([]);
  });

  it("returns empty for negative spacing", () => {
    expect(generateGridPoints(SQUARE, -1, 2)).toEqual([]);
  });

  it("excludes points outside L-shape cutout", () => {
    const points = generateGridPoints(L_SHAPE, 2, 2);
    for (const p of points) {
      expect(pointInPolygon(p, L_SHAPE)).toBe(true);
    }
    // No points should be in the cutout area (x>5, y>5)
    const inCutout = points.filter((p) => p.x > 5 && p.y > 5);
    expect(inCutout.length).toBe(0);
  });

  it("generates points inside a triangle", () => {
    const points = generateGridPoints(TRIANGLE, 2, 2);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(pointInPolygon(p, TRIANGLE)).toBe(true);
    }
  });
});
