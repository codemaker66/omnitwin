import { describe, expect, it } from "vitest";
import { toRenderSpace } from "../../../constants/scale.js";
import { buildInkSegments, INK_FLOOR_LIFT } from "../InkArchitectureLayer.js";

// CARD A2: the blueprint ink layer is the planner's first paint. The segment
// builder is pure — polygon (metres) + ceiling height in, render-space line
// segment positions out — so the geometry is testable without a canvas.

const SQUARE: readonly (readonly [number, number])[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function triples(positions: Float32Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push([positions[i] ?? NaN, positions[i + 1] ?? NaN, positions[i + 2] ?? NaN]);
  }
  return out;
}

describe("buildInkSegments", () => {
  it("draws floor loop, ceiling loop, and corner verticals for a closed polygon", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    // 4 edges → 4 floor + 4 ceiling + 4 vertical segments, 2 vertices each,
    // 3 floats per vertex.
    expect(positions.length).toBe(12 * 2 * 3);
  });

  it("maps metres into render space and lifts the floor loop off the slab", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    const points = triples(positions);
    // The buffer stores 32-bit floats — compare against fround'd expectations.
    const ceilingY = Math.fround(toRenderSpace(3.2));
    const lift = Math.fround(INK_FLOOR_LIFT);

    // Every vertex sits on the floor lift or the ceiling plane.
    for (const [, y] of points.map((p) => [p[0], p[1]] as const)) {
      expect(y === lift || y === ceilingY).toBe(true);
    }

    // The far corner (10 m, 10 m) lands at render-space (20, 20).
    const corner = Math.fround(toRenderSpace(10));
    expect(points.some(([x, , z]) => x === corner && z === corner)).toBe(true);
  });

  it("connects each corner's floor and ceiling with a vertical", () => {
    const positions = buildInkSegments(SQUARE, 3.2);
    const points = triples(positions);
    const ceilingY = Math.fround(toRenderSpace(3.2));
    const lift = Math.fround(INK_FLOOR_LIFT);
    const corner = Math.fround(toRenderSpace(10));

    const floorCorner = points.some(([x, y, z]) => x === corner && y === lift && z === corner);
    const ceilingCorner = points.some(([x, y, z]) => x === corner && y === ceilingY && z === corner);
    expect(floorCorner).toBe(true);
    expect(ceilingCorner).toBe(true);
  });

  it("returns no segments for degenerate polygons", () => {
    expect(buildInkSegments([], 3).length).toBe(0);
    expect(buildInkSegments([[0, 0]], 3).length).toBe(0);
    expect(buildInkSegments([[0, 0], [5, 0]], 3).length).toBe(0);
  });
});
