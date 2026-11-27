import { describe, it, expect } from "vitest";
import {
  RENDER_SCALE,
  toRenderSpace,
  toRealWorld,
  scaleForRendering,
  GRAND_HALL_RENDER_DIMENSIONS,
} from "../scale.js";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import { HALL_HEIGHT, HALL_LENGTH, HALL_WIDTH } from "../../components/grand-hall/hall-spec.js";
import { computeBoundingBox, roomGeometries } from "../../data/room-geometries.js";

// ---------------------------------------------------------------------------
// RENDER_SCALE constant
// ---------------------------------------------------------------------------

describe("RENDER_SCALE", () => {
  it("is 1.0 — the scene is authored and rendered in true metres", () => {
    expect(RENDER_SCALE).toBe(1.0);
  });

  // The property that actually matters, and the one that must hold whatever
  // the factor is: a value converted to render space and back is unchanged.
  // The DB stores real metres while the store holds render space, so a lossy
  // round trip would silently drift every saved layout on each open and save.
  it("round-trips real metres through render space without drift", () => {
    for (const metres of [0, 0.45, 1.83, 10.5, 21, -3.66, 0.001]) {
      expect(toRealWorld(toRenderSpace(metres))).toBeCloseTo(metres, 10);
    }
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
  // The scanned hall (hall-spec): 21.135 m along x is the room's width here,
  // 10.59 m along z its length.
  it("has correct scaled width", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.width).toBe(HALL_LENGTH * RENDER_SCALE);
  });

  it("has correct scaled length", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.length).toBe(HALL_WIDTH * RENDER_SCALE);
  });

  it("height is NOT scaled", () => {
    expect(GRAND_HALL_RENDER_DIMENSIONS.height).toBe(HALL_HEIGHT);
  });

  it("toRealWorld recovers original width", () => {
    expect(toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.width)).toBeCloseTo(HALL_LENGTH, 10);
  });

  it("toRealWorld recovers original length", () => {
    expect(toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.length)).toBeCloseTo(HALL_WIDTH, 10);
  });

  // Before a space loads the planner shows this room; once the Grand Hall
  // loads, usePlannerRoomDimensions sizes the room from its geometry. They are
  // one room, so nothing shifts (it was 2.5 mm short at each end wall when
  // this came from the rounded public 21.14).
  it("is the room the planner sizes from the Grand Hall's geometry once it loads", () => {
    const geometry = roomGeometries["Grand Hall"];
    if (geometry === undefined) throw new Error("No Grand Hall geometry");
    const bbox = computeBoundingBox(geometry.wallPolygon);
    expect(scaleForRendering({ width: bbox.width, length: bbox.depth, height: geometry.ceilingHeight }))
      .toEqual(GRAND_HALL_RENDER_DIMENSIONS);
  });

  // The stored and published size (TRADES_HALL_GRAND_HALL_DIMENSIONS, which
  // production stores via migration 0106) is this one rounded up to the
  // centimetre, so the stored outline contains every centre the planner allows.
  it("rounds up to the stored and published Grand Hall figures", () => {
    const realWidth = toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.width);
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS.width).toBeGreaterThanOrEqual(realWidth);
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS.width - realWidth).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS.length).toBeCloseTo(toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.length), 10);
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS.height).toBe(GRAND_HALL_RENDER_DIMENSIONS.height);
  });
});
