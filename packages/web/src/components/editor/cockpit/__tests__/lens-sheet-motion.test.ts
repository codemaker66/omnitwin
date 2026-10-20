import { describe, expect, it } from "vitest";
import { isSpringSettled, stepSpring, type SpringState } from "../../../../lib/springs.js";
import {
  LENS_SHEET_SPRING,
  lensSheetDragOffset,
  lensSheetScrimOpacity,
  resolveLensSheetRelease,
} from "../lens-sheet-motion.js";

describe("lens sheet release", () => {
  it("closes a slow drag past 30% of the sheet", () => {
    expect(resolveLensSheetRelease({ offsetPx: 151, velocityPxPerS: 0, sheetHeightPx: 500 })).toBe("close");
    expect(resolveLensSheetRelease({ offsetPx: 149, velocityPxPerS: 0, sheetHeightPx: 500 })).toBe("open");
  });

  it("needs at least 96 px on a short sheet, so a nudge never closes it", () => {
    expect(resolveLensSheetRelease({ offsetPx: 60, velocityPxPerS: 0, sheetHeightPx: 160 })).toBe("open");
    expect(resolveLensSheetRelease({ offsetPx: 96, velocityPxPerS: 0, sheetHeightPx: 160 })).toBe("close");
  });

  it("closes a quick downward flick from a short distance", () => {
    expect(resolveLensSheetRelease({ offsetPx: 20, velocityPxPerS: 1200, sheetHeightPx: 500 })).toBe("close");
  });

  it("does not treat a flick as closing when the sheet has not moved down", () => {
    expect(resolveLensSheetRelease({ offsetPx: 0, velocityPxPerS: 1200, sheetHeightPx: 500 })).toBe("open");
  });

  it("keeps the sheet open when a long drag ends moving back up", () => {
    expect(resolveLensSheetRelease({ offsetPx: 300, velocityPxPerS: -500, sheetHeightPx: 500 })).toBe("open");
  });
});

describe("lens sheet drag", () => {
  it("follows the finger 1:1 downward", () => {
    expect(lensSheetDragOffset(0)).toBe(0);
    expect(lensSheetDragOffset(137)).toBe(137);
  });

  it("gives a little upward and then stops", () => {
    expect(lensSheetDragOffset(-50)).toBeCloseTo(-9);
    expect(lensSheetDragOffset(-1000)).toBe(-24);
  });
});

describe("lens sheet scrim", () => {
  it("is full when the sheet is seated and gone when it is away", () => {
    expect(lensSheetScrimOpacity(0, 500)).toBe(1);
    expect(lensSheetScrimOpacity(250, 500)).toBe(0.5);
    expect(lensSheetScrimOpacity(500, 500)).toBe(0);
  });

  it("stays within 0 to 1 when the sheet is pulled past either end", () => {
    expect(lensSheetScrimOpacity(-20, 500)).toBe(1);
    expect(lensSheetScrimOpacity(900, 500)).toBe(0);
  });

  it("does not divide by an unmeasured height", () => {
    expect(lensSheetScrimOpacity(0, 0)).toBe(1);
    expect(lensSheetScrimOpacity(10, 0)).toBe(0);
  });
});

describe("lens sheet spring", () => {
  interface Run {
    /** Seconds until within 2 px of the target: what the eye reads as arrived. */
    readonly arrivedSeconds: number;
    /** Seconds until the loop stops (0.5 px and 0.5 px/s). */
    readonly settledSeconds: number;
    readonly overshootPx: number;
  }

  function run(from: number, to: number, velocity = 0): Run {
    const state: SpringState = { value: from, velocity };
    let seconds = 0;
    let arrivedSeconds = Number.POSITIVE_INFINITY;
    let overshootPx = 0;
    while (!isSpringSettled(state, to, 0.5) && seconds < 3) {
      stepSpring(state, to, 1 / 60, LENS_SHEET_SPRING);
      seconds += 1 / 60;
      if (arrivedSeconds === Number.POSITIVE_INFINITY && Math.abs(state.value - to) < 2) arrivedSeconds = seconds;
      const past = to >= from ? state.value - to : to - state.value;
      overshootPx = Math.max(overshootPx, past);
    }
    return { arrivedSeconds, settledSeconds: seconds, overshootPx };
  }

  it("rises from below a phone screen and is seated in under half a second", () => {
    const { arrivedSeconds, settledSeconds } = run(724, 0);
    expect(arrivedSeconds).toBeLessThan(0.45);
    expect(settledSeconds).toBeLessThan(0.75);
  });

  it("arrives without a visible bounce", () => {
    const { overshootPx } = run(724, 0);
    expect(overshootPx).toBeLessThan(1);
  });

  it("carries a released flick into the exit without bouncing back into view", () => {
    const { arrivedSeconds, settledSeconds, overshootPx } = run(60, 724, 2400);
    expect(arrivedSeconds).toBeLessThan(0.45);
    expect(settledSeconds).toBeLessThan(0.75);
    expect(overshootPx).toBeLessThan(24);
  });
});
