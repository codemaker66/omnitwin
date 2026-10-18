import { describe, expect, it } from "vitest";
import { DRIFT_PERIOD_MS, DRIFT_STEP_PX, driftOffset } from "../burn-in-drift.js";

// Nothing burns in (goal 19 S8 item 14): the wall display sits a few pixels
// off centre and moves to a new spot every ten minutes, through nine spots
// in a fixed order, so no slab edge rests on one row of pixels all shift.

describe("burn-in drift", () => {
  it("every offset is within the step on both axes", () => {
    for (let period = 0; period < 20; period += 1) {
      const { x, y } = driftOffset(period * DRIFT_PERIOD_MS + 17);
      expect(Math.abs(x)).toBeLessThanOrEqual(DRIFT_STEP_PX);
      expect(Math.abs(y)).toBeLessThanOrEqual(DRIFT_STEP_PX);
    }
  });

  it("holds still within a period and moves at the next", () => {
    const start = 1_760_000_400_000; // a period edge: 2,933,334 × 600,000
    expect(driftOffset(start + 1)).toEqual(driftOffset(start + DRIFT_PERIOD_MS - 1));
    expect(driftOffset(start)).not.toEqual(driftOffset(start + DRIFT_PERIOD_MS));
  });

  it("visits all nine spots once over ninety minutes", () => {
    const seen = new Set<string>();
    for (let period = 0; period < 9; period += 1) {
      const { x, y } = driftOffset(period * DRIFT_PERIOD_MS);
      seen.add(`${String(x)},${String(y)}`);
    }
    expect(seen.size).toBe(9);
    expect(DRIFT_PERIOD_MS).toBe(10 * 60_000);
    expect(DRIFT_STEP_PX).toBe(3);
  });
});
