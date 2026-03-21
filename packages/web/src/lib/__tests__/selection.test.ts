import { describe, it, expect } from "vitest";
import {
  ROTATION_SNAP_RAD,
  DRAG_THRESHOLD_PX,
  SELECTION_COLOR,
  snapRotation,
  normaliseAngle,
  computeMarqueeRect,
  isPointInRect,
  screenDistance,
} from "../selection.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("selection constants", () => {
  it("ROTATION_SNAP_RAD is 15° in radians", () => {
    expect(ROTATION_SNAP_RAD).toBeCloseTo(Math.PI / 12);
  });

  it("DRAG_THRESHOLD_PX is positive", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThan(0);
  });

  it("SELECTION_COLOR is a hex string", () => {
    expect(SELECTION_COLOR).toMatch(/^#/);
  });
});

// ---------------------------------------------------------------------------
// snapRotation
// ---------------------------------------------------------------------------

describe("snapRotation", () => {
  it("snaps 0 to 0", () => {
    expect(snapRotation(0)).toBe(0);
  });

  it("snaps exactly 15° to 15°", () => {
    expect(snapRotation(ROTATION_SNAP_RAD)).toBeCloseTo(ROTATION_SNAP_RAD);
  });

  it("snaps 7° to 0° (nearest lower)", () => {
    const sevenDeg = (7 * Math.PI) / 180;
    expect(snapRotation(sevenDeg)).toBeCloseTo(0);
  });

  it("snaps 8° to 15° (nearest upper)", () => {
    const eightDeg = (8 * Math.PI) / 180;
    expect(snapRotation(eightDeg)).toBeCloseTo(ROTATION_SNAP_RAD);
  });

  it("snaps 90° to 90°", () => {
    expect(snapRotation(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("snaps 180° to 180°", () => {
    expect(snapRotation(Math.PI)).toBeCloseTo(Math.PI);
  });

  it("snaps negative angles", () => {
    expect(snapRotation(-ROTATION_SNAP_RAD)).toBeCloseTo(-ROTATION_SNAP_RAD);
  });

  it("freeRotate returns angle unchanged", () => {
    const angle = 0.1234;
    expect(snapRotation(angle, true)).toBe(angle);
  });
});

// ---------------------------------------------------------------------------
// normaliseAngle
// ---------------------------------------------------------------------------

describe("normaliseAngle", () => {
  it("0 stays 0", () => {
    expect(normaliseAngle(0)).toBe(0);
  });

  it("PI stays PI", () => {
    expect(normaliseAngle(Math.PI)).toBeCloseTo(Math.PI);
  });

  it("2PI wraps to 0", () => {
    expect(normaliseAngle(Math.PI * 2)).toBeCloseTo(0);
  });

  it("negative angle wraps to positive", () => {
    expect(normaliseAngle(-Math.PI / 2)).toBeCloseTo(3 * Math.PI / 2);
  });

  it("large positive angle wraps", () => {
    expect(normaliseAngle(Math.PI * 4 + 0.5)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeMarqueeRect
// ---------------------------------------------------------------------------

describe("computeMarqueeRect", () => {
  it("computes rect from top-left to bottom-right drag", () => {
    const rect = computeMarqueeRect(10, 20, 100, 80);
    expect(rect.left).toBe(10);
    expect(rect.top).toBe(20);
    expect(rect.width).toBe(90);
    expect(rect.height).toBe(60);
  });

  it("handles bottom-right to top-left drag", () => {
    const rect = computeMarqueeRect(100, 80, 10, 20);
    expect(rect.left).toBe(10);
    expect(rect.top).toBe(20);
    expect(rect.width).toBe(90);
    expect(rect.height).toBe(60);
  });

  it("handles zero-size rect", () => {
    const rect = computeMarqueeRect(50, 50, 50, 50);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isPointInRect
// ---------------------------------------------------------------------------

describe("isPointInRect", () => {
  const rect = { left: 10, top: 20, width: 100, height: 50 };

  it("point inside returns true", () => {
    expect(isPointInRect(50, 40, rect)).toBe(true);
  });

  it("point at top-left corner returns true", () => {
    expect(isPointInRect(10, 20, rect)).toBe(true);
  });

  it("point at bottom-right corner returns true", () => {
    expect(isPointInRect(110, 70, rect)).toBe(true);
  });

  it("point left of rect returns false", () => {
    expect(isPointInRect(5, 40, rect)).toBe(false);
  });

  it("point above rect returns false", () => {
    expect(isPointInRect(50, 10, rect)).toBe(false);
  });

  it("point right of rect returns false", () => {
    expect(isPointInRect(115, 40, rect)).toBe(false);
  });

  it("point below rect returns false", () => {
    expect(isPointInRect(50, 75, rect)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// screenDistance
// ---------------------------------------------------------------------------

describe("screenDistance", () => {
  it("distance between same point is 0", () => {
    expect(screenDistance(10, 20, 10, 20)).toBe(0);
  });

  it("horizontal distance", () => {
    expect(screenDistance(0, 0, 3, 0)).toBe(3);
  });

  it("vertical distance", () => {
    expect(screenDistance(0, 0, 0, 4)).toBe(4);
  });

  it("3-4-5 triangle", () => {
    expect(screenDistance(0, 0, 3, 4)).toBe(5);
  });
});
