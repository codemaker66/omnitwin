import { describe, expect, it } from "vitest";
import { DRIFT_REACH_PX, DRIFT_STEP_MS, driftOffset } from "../burn-in-drift.js";

// Nothing burns in (goal 19 S8 item 14; goal 19 line 132: "a one-pixel-per-
// minute drift of the whole composition"): the wall display walks one pixel
// a minute round a small ring, so no slab edge rests on one row of pixels,
// and no step is ever more than a pixel.

describe("burn-in drift", () => {
  it("moves exactly one pixel a minute, never more", () => {
    for (let minute = 0; minute < 60; minute += 1) {
      const here = driftOffset(minute * DRIFT_STEP_MS);
      const next = driftOffset((minute + 1) * DRIFT_STEP_MS);
      expect(Math.abs(next.x - here.x) + Math.abs(next.y - here.y)).toBe(1);
    }
    expect(DRIFT_STEP_MS).toBe(60_000);
  });

  it("stays within reach of centre on both axes and holds still within a minute", () => {
    for (let minute = 0; minute < 100; minute += 1) {
      const { x, y } = driftOffset(minute * DRIFT_STEP_MS + 17);
      expect(Math.abs(x)).toBeLessThanOrEqual(DRIFT_REACH_PX);
      expect(Math.abs(y)).toBeLessThanOrEqual(DRIFT_REACH_PX);
    }
    expect(driftOffset(DRIFT_STEP_MS * 7 + 1)).toEqual(driftOffset(DRIFT_STEP_MS * 8 - 1));
    expect(DRIFT_REACH_PX).toBe(3);
  });

  it("visits every spot on the ring once before repeating", () => {
    const seen = new Set<string>();
    for (let minute = 0; minute < 24; minute += 1) {
      const { x, y } = driftOffset(minute * DRIFT_STEP_MS);
      seen.add(`${String(x)},${String(y)}`);
    }
    expect(seen.size).toBe(24);
    expect(driftOffset(24 * DRIFT_STEP_MS)).toEqual(driftOffset(0));
  });
});
