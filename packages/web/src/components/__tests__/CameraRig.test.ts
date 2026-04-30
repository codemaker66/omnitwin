import { describe, it, expect } from "vitest";
import {
  computeDefaultCameraPosition,
  computeCameraTarget,
  computeDistanceLimits,
  computePanBounds,
  computeKeyboardPanDirection,
  computeEdgeScrollDirection,
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
  DAMPING_FACTOR,
  ZOOM_IMPULSE,
  ZOOM_FRICTION,
  ZOOM_VELOCITY_THRESHOLD,
  PAN_SPEED,
  EDGE_SCROLL_ZONE,
} from "../CameraRig.js";
import type { SpaceDimensions } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// computeDefaultCameraPosition
// ---------------------------------------------------------------------------

describe("computeDefaultCameraPosition", () => {
  const grandHall: SpaceDimensions = { width: 21, length: 10, height: 7 };

  it("returns a 3-element tuple", () => {
    const pos = computeDefaultCameraPosition(grandHall);
    expect(pos).toHaveLength(3);
  });

  it("places camera at eye level (1.7m)", () => {
    const pos = computeDefaultCameraPosition(grandHall);
    expect(pos[1]).toBe(1.7);
  });

  it("places camera INSIDE the room (within half of longest dimension)", () => {
    const pos = computeDefaultCameraPosition(grandHall);
    const maxHalf = Math.max(grandHall.width, grandHall.length) / 2;
    const horizontalDist = Math.sqrt(pos[0] ** 2 + pos[2] ** 2);
    expect(horizontalDist).toBeLessThan(maxHalf);
  });

  it("positions along the longest axis", () => {
    // Width (21) > length (10), so primary offset is on X axis
    const pos = computeDefaultCameraPosition(grandHall);
    expect(Math.abs(pos[0])).toBeGreaterThan(Math.abs(pos[2]));
  });

  it("positions along Z when length is longest", () => {
    const tall = computeDefaultCameraPosition({ width: 5, length: 20, height: 4 });
    expect(Math.abs(tall[2])).toBeGreaterThan(Math.abs(tall[0]));
  });

  it("distance scales with room extent", () => {
    const small = computeDefaultCameraPosition({ width: 5, length: 5, height: 3 });
    const large = computeDefaultCameraPosition({ width: 50, length: 50, height: 10 });
    const smallDist = Math.sqrt(small[0] ** 2 + small[2] ** 2);
    const largeDist = Math.sqrt(large[0] ** 2 + large[2] ** 2);
    expect(largeDist).toBeGreaterThan(smallDist);
  });

  it("returns consistent results for same input", () => {
    const a = computeDefaultCameraPosition(grandHall);
    const b = computeDefaultCameraPosition(grandHall);
    expect(a).toEqual(b);
  });

  it("keeps portrait mobile camera inside the room while raising the view", () => {
    const renderedGrandHall: SpaceDimensions = { width: 42, length: 20, height: 7 };
    const pos = computeDefaultCameraPosition(renderedGrandHall, 390 / 844);
    const maxHalf = Math.max(renderedGrandHall.width, renderedGrandHall.length) / 2;
    const horizontalDist = Math.sqrt(pos[0] ** 2 + pos[2] ** 2);

    expect(horizontalDist).toBeLessThan(maxHalf);
    expect(pos[1]).toBeGreaterThan(1.7);
  });
});

// ---------------------------------------------------------------------------
// computeCameraTarget
// ---------------------------------------------------------------------------

describe("computeCameraTarget", () => {
  it("returns room center at eye level (1.5m)", () => {
    const target = computeCameraTarget({ width: 21, length: 10, height: 7 });
    expect(target).toEqual([0, 1.5, 0]);
  });

  it("returns same target regardless of dimensions", () => {
    const target = computeCameraTarget({ width: 100, length: 50, height: 20 });
    expect(target).toEqual([0, 1.5, 0]);
  });

  it("raises the portrait mobile target enough to include ceiling detail", () => {
    const target = computeCameraTarget({ width: 42, length: 20, height: 7 }, 390 / 844);
    expect(target[0]).toBe(0);
    expect(target[1]).toBeCloseTo(2.24);
    expect(target[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDistanceLimits
// ---------------------------------------------------------------------------

describe("computeDistanceLimits", () => {
  const grandHall: SpaceDimensions = { width: 21, length: 10, height: 7 };

  it("minDistance is 1.5m (close enough to inspect furniture)", () => {
    const limits = computeDistanceLimits(grandHall);
    expect(limits.minDistance).toBe(1.5);
  });

  it("maxDistance is far enough to frame the Grand Hall from outside", () => {
    // Multiplier was bumped 1.2 → 1.6 so the portrait "hero" pose (which
    // sits beyond the room corner) isn't clamped. 21 m × 1.6 ≈ 33.6 m.
    const limits = computeDistanceLimits(grandHall);
    expect(limits.maxDistance).toBeGreaterThanOrEqual(20);
    expect(limits.maxDistance).toBeLessThanOrEqual(40);
  });

  it("maxDistance is greater than minDistance", () => {
    const limits = computeDistanceLimits(grandHall);
    expect(limits.maxDistance).toBeGreaterThan(limits.minDistance);
  });

  it("maxDistance scales with room size", () => {
    const small = computeDistanceLimits({ width: 5, length: 5, height: 3 });
    const large = computeDistanceLimits({ width: 50, length: 50, height: 20 });
    expect(large.maxDistance).toBeGreaterThan(small.maxDistance);
  });

  it("minDistance is always 1.5m regardless of room size", () => {
    const tiny = computeDistanceLimits({ width: 2, length: 2, height: 2 });
    expect(tiny.minDistance).toBe(1.5);
    expect(tiny.maxDistance).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// computePanBounds
// ---------------------------------------------------------------------------

describe("computePanBounds", () => {
  const grandHall: SpaceDimensions = { width: 21, length: 10, height: 7 };

  it("bounds extend beyond room edges (20% margin)", () => {
    const bounds = computePanBounds(grandHall);
    expect(bounds.maxX).toBeGreaterThan(grandHall.width / 2);
    expect(bounds.minX).toBeLessThan(-grandHall.width / 2);
    expect(bounds.maxZ).toBeGreaterThan(grandHall.length / 2);
    expect(bounds.minZ).toBeLessThan(-grandHall.length / 2);
  });

  it("bounds are symmetric around origin", () => {
    const bounds = computePanBounds(grandHall);
    expect(bounds.minX).toBeCloseTo(-bounds.maxX);
    expect(bounds.minZ).toBeCloseTo(-bounds.maxZ);
  });

  it("scales with room size", () => {
    const small = computePanBounds({ width: 5, length: 5, height: 3 });
    const large = computePanBounds({ width: 50, length: 50, height: 20 });
    expect(large.maxX).toBeGreaterThan(small.maxX);
    expect(large.maxZ).toBeGreaterThan(small.maxZ);
  });

  it("maxX = halfWidth + 20% margin for Grand Hall", () => {
    const bounds = computePanBounds(grandHall);
    expect(bounds.maxX).toBeCloseTo(21 / 2 + 21 * 0.2);
  });
});

// ---------------------------------------------------------------------------
// computeKeyboardPanDirection
// ---------------------------------------------------------------------------

describe("computeKeyboardPanDirection", () => {
  it("returns [0, 0] when no keys pressed", () => {
    const dir = computeKeyboardPanDirection(new Set());
    expect(dir).toEqual([0, 0]);
  });

  it("W pans forward (negative Z)", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyW"]));
    expect(dir[0]).toBe(0);
    expect(dir[1]).toBe(-1);
  });

  it("S pans backward (positive Z)", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyS"]));
    expect(dir[0]).toBe(0);
    expect(dir[1]).toBe(1);
  });

  it("A pans left (negative X)", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyA"]));
    expect(dir[0]).toBe(-1);
    expect(dir[1]).toBe(0);
  });

  it("D pans right (positive X)", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyD"]));
    expect(dir[0]).toBe(1);
    expect(dir[1]).toBe(0);
  });

  it("ArrowUp pans forward (same as W)", () => {
    const dir = computeKeyboardPanDirection(new Set(["ArrowUp"]));
    expect(dir[0]).toBe(0);
    expect(dir[1]).toBe(-1);
  });

  it("ArrowRight pans right (same as D)", () => {
    const dir = computeKeyboardPanDirection(new Set(["ArrowRight"]));
    expect(dir[0]).toBe(1);
    expect(dir[1]).toBe(0);
  });

  it("normalizes diagonal input (W+D)", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyW", "KeyD"]));
    const length = Math.sqrt(dir[0] ** 2 + dir[1] ** 2);
    expect(length).toBeCloseTo(1);
    expect(dir[0]).toBeGreaterThan(0); // right
    expect(dir[1]).toBeLessThan(0); // forward
  });

  it("opposite keys cancel out", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyW", "KeyS"]));
    expect(dir).toEqual([0, 0]);
  });

  it("ignores non-pan keys", () => {
    const dir = computeKeyboardPanDirection(new Set(["KeyQ", "Space", "KeyE"]));
    expect(dir).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// computeEdgeScrollDirection
// ---------------------------------------------------------------------------

describe("computeEdgeScrollDirection", () => {
  const vw = 1920;
  const vh = 1080;
  const zone = EDGE_SCROLL_ZONE;

  it("returns [0, 0] when mouse is in center of screen", () => {
    const dir = computeEdgeScrollDirection(960, 540, vw, vh, zone);
    expect(dir).toEqual([0, 0]);
  });

  it("scrolls left when mouse is at left edge", () => {
    const dir = computeEdgeScrollDirection(10, 540, vw, vh, zone);
    expect(dir[0]).toBe(-1);
    expect(dir[1]).toBe(0);
  });

  it("scrolls right when mouse is at right edge", () => {
    const dir = computeEdgeScrollDirection(1910, 540, vw, vh, zone);
    expect(dir[0]).toBe(1);
    expect(dir[1]).toBe(0);
  });

  it("scrolls forward when mouse is at top edge", () => {
    const dir = computeEdgeScrollDirection(960, 10, vw, vh, zone);
    expect(dir[0]).toBe(0);
    expect(dir[1]).toBe(-1);
  });

  it("scrolls backward when mouse is at bottom edge", () => {
    const dir = computeEdgeScrollDirection(960, 1070, vw, vh, zone);
    expect(dir[0]).toBe(0);
    expect(dir[1]).toBe(1);
  });

  it("normalizes diagonal edge scroll (top-left corner)", () => {
    const dir = computeEdgeScrollDirection(10, 10, vw, vh, zone);
    const length = Math.sqrt(dir[0] ** 2 + dir[1] ** 2);
    expect(length).toBeCloseTo(1);
    expect(dir[0]).toBeLessThan(0); // left
    expect(dir[1]).toBeLessThan(0); // forward
  });

  it("does not trigger at zone boundary", () => {
    // Mouse exactly at zone boundary (zone = 40, so x=40 is just outside)
    const dir = computeEdgeScrollDirection(zone, 540, vw, vh, zone);
    expect(dir).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("camera constants", () => {
  it("MIN_POLAR_ANGLE is positive (not directly overhead)", () => {
    expect(MIN_POLAR_ANGLE).toBeGreaterThan(0);
  });

  it("MAX_POLAR_ANGLE is close to but less than 90° (nearly horizontal)", () => {
    expect(MAX_POLAR_ANGLE).toBeLessThan(Math.PI / 2);
    expect(MAX_POLAR_ANGLE).toBeGreaterThan(Math.PI * 0.4);
  });

  it("MIN_POLAR_ANGLE < MAX_POLAR_ANGLE", () => {
    expect(MIN_POLAR_ANGLE).toBeLessThan(MAX_POLAR_ANGLE);
  });

  it("DAMPING_FACTOR is between 0 and 1", () => {
    expect(DAMPING_FACTOR).toBeGreaterThan(0);
    expect(DAMPING_FACTOR).toBeLessThan(1);
  });

  it("ZOOM_IMPULSE is positive and reasonable", () => {
    expect(ZOOM_IMPULSE).toBeGreaterThan(0);
    expect(ZOOM_IMPULSE).toBeLessThan(1);
  });

  it("ZOOM_FRICTION is between 0 and 1", () => {
    expect(ZOOM_FRICTION).toBeGreaterThan(0);
    expect(ZOOM_FRICTION).toBeLessThan(1);
  });

  it("ZOOM_VELOCITY_THRESHOLD is small and positive", () => {
    expect(ZOOM_VELOCITY_THRESHOLD).toBeGreaterThan(0);
    expect(ZOOM_VELOCITY_THRESHOLD).toBeLessThan(0.1);
  });

  it("PAN_SPEED is positive", () => {
    expect(PAN_SPEED).toBeGreaterThan(0);
  });

  it("EDGE_SCROLL_ZONE is positive and reasonable", () => {
    expect(EDGE_SCROLL_ZONE).toBeGreaterThan(0);
    expect(EDGE_SCROLL_ZONE).toBeLessThan(200);
  });
});
