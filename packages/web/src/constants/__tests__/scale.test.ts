import { describe, it, expect } from "vitest";
import {
  RENDER_SCALE,
  toRenderSpace,
  toRealWorld,
  scaleForRendering,
  GRAND_HALL_RENDER_DIMENSIONS,
} from "../scale.js";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// RENDER_SCALE constant
// ---------------------------------------------------------------------------

describe("RENDER_SCALE", () => {
  it("is 2.0", () => {
    expect(RENDER_SCALE).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// toRenderSpace
// ---------------------------------------------------------------------------

describe("toRenderSpace", () => {
  it("multiplies by RENDER_SCALE", () => {
    expect(toRenderSpace(1)).toBe(RENDER_SCALE);
    expect(toRenderSpace(5)).toBe(5 * RENDER_SCALE);
  });

  it("returns 0 for 0", () => {
    expect(toRenderSpace(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(toRenderSpace(-3)).toBe(-3 * RENDER_SCALE);
  });

  it("handles fractional values", () => {
    expect(toRenderSpace(0.5)).toBeCloseTo(0.5 * RENDER_SCALE);
  });
});

// ---------------------------------------------------------------------------
// toRealWorld
// ---------------------------------------------------------------------------

describe("toRealWorld", () => {
  it("divides by RENDER_SCALE", () => {
    expect(toRealWorld(RENDER_SCALE)).toBe(1);
    expect(toRealWorld(10)).toBe(10 / RENDER_SCALE);
  });

  it("returns 0 for 0", () => {
    expect(toRealWorld(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(toRealWorld(-6)).toBe(-6 / RENDER_SCALE);
  });

  it("round-trips with toRenderSpace", () => {
    const original = 7.35;
    expect(toRealWorld(toRenderSpace(original))).toBeCloseTo(original);
  });

  it("round-trips with toRenderSpace for negative values", () => {
    const original = -2.5;
    expect(toRealWorld(toRenderSpace(original))).toBeCloseTo(original);
  });
});

// ---------------------------------------------------------------------------
// scaleForRendering
// ---------------------------------------------------------------------------

describe("scaleForRendering", () => {
  it("scales width and length but not height", () => {
    const dims = { width: 10, length: 5, height: 3 };
    const scaled = scaleForRendering(dims);
    expect(scaled.width).toBe(10 * RENDER_SCALE);
    expect(scaled.length).toBe(5 * RENDER_SCALE);
    expect(scaled.height).toBe(3);
  });

  it("uses toRenderSpace internally (consistent results)", () => {
    const dims = { width: 21, length: 10, height: 7 };
    const scaled = scaleForRendering(dims);
    expect(scaled.width).toBe(toRenderSpace(21));
    expect(scaled.length).toBe(toRenderSpace(10));
    expect(scaled.height).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// GRAND_HALL_RENDER_DIMENSIONS
// ---------------------------------------------------------------------------

describe("GRAND_HALL_RENDER_DIMENSIONS", () => {
  it("has correct scaled width", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.width).toBe(
      TRADES_HALL_GRAND_HALL_DIMENSIONS.width * RENDER_SCALE,
    );
  });

  it("has correct scaled length", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.length).toBe(
      TRADES_HALL_GRAND_HALL_DIMENSIONS.length * RENDER_SCALE,
    );
  });

  it("height is NOT scaled", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.height).toBe(
      TRADES_HALL_GRAND_HALL_DIMENSIONS.height,
    );
  });

  it("toRealWorld recovers original width", () => {
    expect(toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.width)).toBeCloseTo(
      TRADES_HALL_GRAND_HALL_DIMENSIONS.width,
    );
  });

  it("toRealWorld recovers original length", () => {
    expect(toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.length)).toBeCloseTo(
      TRADES_HALL_GRAND_HALL_DIMENSIONS.length,
    );
  });
});
