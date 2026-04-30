import { describe, it, expect } from "vitest";
import {
  detectWallHit,
  computeGuideline,
  computeWallOffset,
  formatGuidelineLabel,
  GUIDELINE_COLOR,
  GUIDELINE_COLOR_HOVER,
  GUIDELINE_DASH,
  GUIDELINE_GAP,
  GUIDELINE_Y,
} from "../guideline.js";
import type { WallHit } from "../guideline.js";
import type { Point3 } from "../measurement.js";
import { GRAND_HALL_RENDER_DIMENSIONS, RENDER_SCALE } from "../../constants/scale.js";

const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
const halfWidth = width / 2;
const halfLength = length / 2;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("guideline constants", () => {
  it("exports a blue guideline colour", () => {
    expect(GUIDELINE_COLOR).toBe("#5080b0");
  });

  it("exports a red hover colour", () => {
    expect(GUIDELINE_COLOR_HOVER).toBe("#ee4444");
  });

  it("exports positive dash and gap sizes", () => {
    expect(GUIDELINE_DASH).toBeGreaterThan(0);
    expect(GUIDELINE_GAP).toBeGreaterThan(0);
  });

  it("exports a small positive Y offset", () => {
    expect(GUIDELINE_Y).toBeGreaterThan(0);
    expect(GUIDELINE_Y).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// detectWallHit
// ---------------------------------------------------------------------------

describe("detectWallHit", () => {
  it("returns null for floor surface", () => {
    const point: Point3 = [0, 0, 0];
    expect(detectWallHit(point, "floor")).toBeNull();
  });

  it("returns null for ceiling surface", () => {
    const point: Point3 = [0, 7, 0];
    expect(detectWallHit(point, "ceiling")).toBeNull();
  });

  it("returns null for dome surface", () => {
    const point: Point3 = [0, 8, 0];
    expect(detectWallHit(point, "dome")).toBeNull();
  });

  it("detects wall-left → axis x", () => {
    const point: Point3 = [-halfWidth, 3, 2];
    const result = detectWallHit(point, "wall-left");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("x");
    expect(result?.wallCoord).toBe(2);
  });

  it("detects wall-right → axis x", () => {
    const point: Point3 = [halfWidth, 3, -3];
    const result = detectWallHit(point, "wall-right");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("x");
    expect(result?.wallCoord).toBe(-3);
  });

  it("detects wall-back → axis z", () => {
    const point: Point3 = [5, 2, -halfLength];
    const result = detectWallHit(point, "wall-back");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("z");
    expect(result?.wallCoord).toBe(5);
  });

  it("detects wall-front → axis z", () => {
    const point: Point3 = [-4, 1, halfLength];
    const result = detectWallHit(point, "wall-front");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("z");
    expect(result?.wallCoord).toBe(-4);
  });

  it("detects wainscot surfaces (treats as parent wall)", () => {
    const point: Point3 = [-halfWidth, 0.5, 1];
    const result = detectWallHit(point, "wainscot-left");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("x");
    expect(result?.wallCoord).toBe(1);
  });

  it("detects wainscot-front → axis z", () => {
    const point: Point3 = [3, 0.5, halfLength];
    const result = detectWallHit(point, "wainscot-front");
    expect(result).not.toBeNull();
    expect(result?.axis).toBe("z");
    expect(result?.wallCoord).toBe(3);
  });

  it("returns null for unknown surface names", () => {
    const point: Point3 = [0, 0, 0];
    expect(detectWallHit(point, "some-object")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeGuideline
// ---------------------------------------------------------------------------

describe("computeGuideline", () => {
  it("creates an X-axis guideline from left/right wall hit", () => {
    const wallHit: WallHit = { axis: "x", position: -halfWidth, wallCoord: 3 };
    const g = computeGuideline(wallHit, 42);

    expect(g.id).toBe(42);
    expect(g.axis).toBe("x");
    expect(g.fixedCoord).toBe(3);
    // Line runs from -halfWidth to +halfWidth at z=3
    expect(g.start[0]).toBe(-halfWidth);
    expect(g.start[2]).toBe(3);
    expect(g.end[0]).toBe(halfWidth);
    expect(g.end[2]).toBe(3);
    // Y at guideline height
    expect(g.start[1]).toBe(GUIDELINE_Y);
    expect(g.end[1]).toBe(GUIDELINE_Y);
    // Real distance = render width / RENDER_SCALE
    expect(g.realDistance).toBeCloseTo(width / RENDER_SCALE);
  });

  it("creates a Z-axis guideline from front/back wall hit", () => {
    const wallHit: WallHit = { axis: "z", position: -halfLength, wallCoord: -5 };
    const g = computeGuideline(wallHit, 7);

    expect(g.id).toBe(7);
    expect(g.axis).toBe("z");
    expect(g.fixedCoord).toBe(-5);
    // Line runs from -halfLength to +halfLength at x=-5
    expect(g.start[0]).toBe(-5);
    expect(g.start[2]).toBe(-halfLength);
    expect(g.end[0]).toBe(-5);
    expect(g.end[2]).toBe(halfLength);
    // Real distance = render length / RENDER_SCALE
    expect(g.realDistance).toBeCloseTo(length / RENDER_SCALE);
  });

  it("guideline real distance matches room dimension", () => {
    // X-axis guideline should show real room width
    const xHit: WallHit = { axis: "x", position: 0, wallCoord: 0 };
    const xG = computeGuideline(xHit, 1);
    expect(xG.realDistance).toBeCloseTo(21); // 21m real width

    // Z-axis guideline should show real room length
    const zHit: WallHit = { axis: "z", position: 0, wallCoord: 0 };
    const zG = computeGuideline(zHit, 2);
    expect(zG.realDistance).toBeCloseTo(length / RENDER_SCALE);
  });
});

// ---------------------------------------------------------------------------
// computeWallOffset
// ---------------------------------------------------------------------------

describe("computeWallOffset", () => {
  it("computes offset from nearest Z wall for X-axis guideline", () => {
    // wallCoord = 0 means center → offset = halfLength / RENDER_SCALE
    const hit: WallHit = { axis: "x", position: 0, wallCoord: 0 };
    expect(computeWallOffset(hit)).toBeCloseTo(halfLength / RENDER_SCALE);
  });

  it("computes offset from nearest Z wall near back wall", () => {
    // wallCoord = -halfLength + 2 → distance from back = 2 render metres
    const hit: WallHit = { axis: "x", position: 0, wallCoord: -halfLength + 2 };
    expect(computeWallOffset(hit)).toBeCloseTo(2 / RENDER_SCALE);
  });

  it("computes offset from nearest X wall for Z-axis guideline", () => {
    // wallCoord = 0 means center → offset = halfWidth / RENDER_SCALE
    const hit: WallHit = { axis: "z", position: 0, wallCoord: 0 };
    expect(computeWallOffset(hit)).toBeCloseTo(halfWidth / RENDER_SCALE);
  });

  it("computes offset near left wall", () => {
    // wallCoord = -halfWidth + 4 → distance from left = 4 render metres
    const hit: WallHit = { axis: "z", position: 0, wallCoord: -halfWidth + 4 };
    expect(computeWallOffset(hit)).toBeCloseTo(4 / RENDER_SCALE);
  });
});

// ---------------------------------------------------------------------------
// formatGuidelineLabel
// ---------------------------------------------------------------------------

describe("formatGuidelineLabel", () => {
  it("formats distance with 2 decimal places", () => {
    expect(formatGuidelineLabel(10)).toBe("10.00m");
    expect(formatGuidelineLabel(3.456)).toBe("3.46m");
    expect(formatGuidelineLabel(0.5)).toBe("0.50m");
  });
});
