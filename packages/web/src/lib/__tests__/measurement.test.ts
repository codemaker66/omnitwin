import { describe, it, expect } from "vitest";
import {
  FIRE_EXIT_MINIMUM_M,
  MEASUREMENT_COLOR_OK,
  MEASUREMENT_COLOR_WARNING,
  computeRealDistance,
  computeRenderDistance,
  formatDistance,
  isBelowFireExit,
  getMeasurementColor,
  computeMidpoint,
  type Point3,
} from "../measurement.js";
import { RENDER_SCALE } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("measurement constants", () => {
  it("FIRE_EXIT_MINIMUM_M is 1.05m", () => {
    expect(FIRE_EXIT_MINIMUM_M).toBe(1.05);
  });

  it("ok colour is green", () => {
    expect(MEASUREMENT_COLOR_OK).toMatch(/^#/);
  });

  it("warning colour is red", () => {
    expect(MEASUREMENT_COLOR_WARNING).toMatch(/^#/);
  });

  it("colours are distinct", () => {
    expect(MEASUREMENT_COLOR_OK).not.toBe(MEASUREMENT_COLOR_WARNING);
  });
});

// ---------------------------------------------------------------------------
// computeRealDistance
// ---------------------------------------------------------------------------

describe("computeRealDistance", () => {
  it("returns 0 for same point", () => {
    const p: Point3 = [1, 2, 3];
    expect(computeRealDistance(p, p)).toBe(0);
  });

  it("returns correct real distance along X axis (scaled)", () => {
    // X is scaled: render dx=4, real = 4 / RENDER_SCALE
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [4, 0, 0];
    expect(computeRealDistance(a, b)).toBeCloseTo(4 / RENDER_SCALE);
  });

  it("returns correct real distance along Y axis (NOT scaled)", () => {
    // Y is NOT scaled: render dy=6, real = 6
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [0, 6, 0];
    expect(computeRealDistance(a, b)).toBeCloseTo(6);
  });

  it("returns correct real distance along Z axis (scaled)", () => {
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [0, 0, 10];
    expect(computeRealDistance(a, b)).toBeCloseTo(10 / RENDER_SCALE);
  });

  it("returns correct 3D diagonal with non-uniform scaling", () => {
    // dx=4 (scaled→2), dy=3 (unscaled→3), dz=0
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [4, 3, 0];
    const realDx = 4 / RENDER_SCALE;
    const realDy = 3; // not scaled
    expect(computeRealDistance(a, b)).toBeCloseTo(Math.sqrt(realDx * realDx + realDy * realDy));
  });

  it("is symmetric (a→b equals b→a)", () => {
    const a: Point3 = [1, 2, 3];
    const b: Point3 = [4, 6, 8];
    expect(computeRealDistance(a, b)).toBeCloseTo(computeRealDistance(b, a));
  });
});

// ---------------------------------------------------------------------------
// computeRenderDistance
// ---------------------------------------------------------------------------

describe("computeRenderDistance", () => {
  it("returns raw render-space distance (no scale division)", () => {
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [3, 4, 0];
    expect(computeRenderDistance(a, b)).toBeCloseTo(5);
  });

  it("returns 0 for same point", () => {
    const p: Point3 = [5, 5, 5];
    expect(computeRenderDistance(p, p)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  it("formats 1.0 as '1.00m'", () => {
    expect(formatDistance(1.0)).toBe("1.00m");
  });

  it("formats 0.5 as '0.50m'", () => {
    expect(formatDistance(0.5)).toBe("0.50m");
  });

  it("formats 12.345 as '12.35m' (rounded)", () => {
    expect(formatDistance(12.345)).toBe("12.35m");
  });

  it("formats 0 as '0.00m'", () => {
    expect(formatDistance(0)).toBe("0.00m");
  });

  it("formats large distance", () => {
    expect(formatDistance(100)).toBe("100.00m");
  });
});

// ---------------------------------------------------------------------------
// isBelowFireExit
// ---------------------------------------------------------------------------

describe("isBelowFireExit", () => {
  it("returns true for 1.04m (below 1.05m)", () => {
    expect(isBelowFireExit(1.04)).toBe(true);
  });

  it("returns false for 1.05m (exactly at minimum)", () => {
    expect(isBelowFireExit(1.05)).toBe(false);
  });

  it("returns false for 1.06m (above minimum)", () => {
    expect(isBelowFireExit(1.06)).toBe(false);
  });

  it("returns true for 0", () => {
    expect(isBelowFireExit(0)).toBe(true);
  });

  it("returns false for large distance", () => {
    expect(isBelowFireExit(10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMeasurementColor
// ---------------------------------------------------------------------------

describe("getMeasurementColor", () => {
  it("returns warning colour below fire exit minimum", () => {
    expect(getMeasurementColor(0.5)).toBe(MEASUREMENT_COLOR_WARNING);
  });

  it("returns ok colour at fire exit minimum", () => {
    expect(getMeasurementColor(1.05)).toBe(MEASUREMENT_COLOR_OK);
  });

  it("returns ok colour above minimum", () => {
    expect(getMeasurementColor(5)).toBe(MEASUREMENT_COLOR_OK);
  });
});

// ---------------------------------------------------------------------------
// computeMidpoint
// ---------------------------------------------------------------------------

describe("computeMidpoint", () => {
  it("returns midpoint of two points", () => {
    const a: Point3 = [0, 0, 0];
    const b: Point3 = [4, 6, 8];
    expect(computeMidpoint(a, b)).toEqual([2, 3, 4]);
  });

  it("returns the point itself when both points are the same", () => {
    const p: Point3 = [3, 5, 7];
    expect(computeMidpoint(p, p)).toEqual([3, 5, 7]);
  });

  it("handles negative coordinates", () => {
    const a: Point3 = [-2, -4, -6];
    const b: Point3 = [2, 4, 6];
    expect(computeMidpoint(a, b)).toEqual([0, 0, 0]);
  });
});
