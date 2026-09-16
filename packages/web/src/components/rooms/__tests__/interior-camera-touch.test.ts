import { describe, expect, it } from "vitest";
import {
  floorPointFromTap,
  glideTargetFromTap,
  isHoldGesture,
  isTapGesture,
  ndcForPoint,
  pinchDistance,
  pinchForwardMetres,
  HOLD_TO_WALK_MS,
  PINCH_TRAVEL_M,
  TAP_MAX_MS,
} from "../interior-camera-touch.js";
import { moveOnFloorPlane, type Bounds, type CameraState } from "../interior-camera.js";

// ---------------------------------------------------------------------------
// The feel of walking a room with a finger, as arithmetic.
//
// Every function here is numbers in and numbers out, which is the point: what
// a tap resolves to, how far a pinch carries and when a press becomes a hold
// can all be pinned without a canvas, a GPU or a real finger. What a finger
// does to the LIVE component is InteriorCamera.test.tsx's job.
// ---------------------------------------------------------------------------

const EYE = 1.6;
const FOV = 48;
const WIDE: Bounds = { min: [-20, 0.5, -20], max: [20, 3, 20] };
const ROOM: Bounds = { min: [-5, 0.5, -5], max: [5, 3, 5] };

function standing(over: Partial<CameraState> = {}): CameraState {
  return { position: [0, EYE, 0], yaw: 0, pitch: 0, ...over };
}

describe("ndcForPoint", () => {
  it("puts the top-left corner at (-1, 1) and the centre at the origin", () => {
    expect(ndcForPoint({ x: 0, y: 0 }, 400, 800)).toEqual({ x: -1, y: 1 });
    expect(ndcForPoint({ x: 200, y: 400 }, 400, 800)).toEqual({ x: 0, y: 0 });
    expect(ndcForPoint({ x: 400, y: 800 }, 400, 800)).toEqual({ x: 1, y: -1 });
  });

  it("returns null for a canvas with no area, rather than dividing by nothing", () => {
    expect(ndcForPoint({ x: 10, y: 10 }, 0, 800)).toBeNull();
    expect(ndcForPoint({ x: 10, y: 10 }, 400, 0)).toBeNull();
  });
});

describe("floorPointFromTap", () => {
  it("keeps the eye where it was: a tap is a place to stand, not to fall to", () => {
    const floor = floorPointFromTap(standing(), { x: 0, y: -0.8 }, FOV, 16 / 9, 0);
    expect(floor?.[1]).toBe(EYE);
  });

  it("sends a tap below the horizon straight ahead, along -z at yaw zero", () => {
    // -z is forward at yaw 0, which is the convention moveOnFloorPlane uses.
    const floor = floorPointFromTap(standing(), { x: 0, y: -0.5 }, FOV, 16 / 9, 0);
    expect(floor).not.toBeNull();
    expect(floor?.[0]).toBeCloseTo(0, 6);
    expect(floor?.[2] ?? 0).toBeLessThan(0);
  });

  it("agrees with moveOnFloorPlane about where forward is, at any yaw", () => {
    // The tap and the walk must not disagree about the heading, or tapping the
    // floor ahead would send the viewer sideways.
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4]) {
      const floor = floorPointFromTap(standing({ yaw }), { x: 0, y: -0.5 }, FOV, 16 / 9, 0);
      expect(floor).not.toBeNull();
      const travelled = Math.hypot(floor?.[0] ?? 0, floor?.[2] ?? 0);
      const walked = moveOnFloorPlane([0, EYE, 0], yaw, travelled, 0);

      expect(floor?.[0] ?? 0).toBeCloseTo(walked[0], 6);
      expect(floor?.[2] ?? 0).toBeCloseTo(walked[2], 6);
    }
  });

  it("puts the floor further away as the tap rises toward the horizon", () => {
    const near = floorPointFromTap(standing(), { x: 0, y: -0.9 }, FOV, 16 / 9, 0);
    const far = floorPointFromTap(standing(), { x: 0, y: -0.3 }, FOV, 16 / 9, 0);

    expect(Math.abs(far?.[2] ?? 0)).toBeGreaterThan(Math.abs(near?.[2] ?? 0));
  });

  it("reaches the floor at the distance the pitch implies when looking down", () => {
    // Looking down by 0.3 rad from an eye of 1.6 m puts the centre of the
    // screen on the floor 1.6 / tan(0.3) metres ahead.
    const floor = floorPointFromTap(standing({ pitch: -0.3 }), { x: 0, y: 0 }, FOV, 16 / 9, 0);
    expect(floor?.[2] ?? 0).toBeCloseTo(-EYE / Math.tan(0.3), 6);
  });

  it("refuses a tap on the ceiling, on the horizon, or behind the viewer", () => {
    // A tap that cannot reach the floor is not a destination. Pretending it is
    // would fling the viewer backwards through a wall.
    expect(floorPointFromTap(standing(), { x: 0, y: 0.5 }, FOV, 16 / 9, 0)).toBeNull();
    expect(floorPointFromTap(standing(), { x: 0, y: 0 }, FOV, 16 / 9, 0)).toBeNull();
    expect(floorPointFromTap(standing({ pitch: 0.6 }), { x: 0, y: 0 }, FOV, 16 / 9, 0)).toBeNull();
  });

  it("refuses a canvas with no aspect at all", () => {
    expect(floorPointFromTap(standing(), { x: 0, y: -0.5 }, FOV, 0, 0)).toBeNull();
    expect(floorPointFromTap(standing(), { x: 0, y: -0.5 }, FOV, Number.NaN, 0)).toBeNull();
  });

  it("refuses to take a viewer already below the floor upwards through it", () => {
    const below = floorPointFromTap(
      { position: [0, -1, 0], yaw: 0, pitch: 0 },
      { x: 0, y: -0.5 },
      FOV,
      16 / 9,
      0,
    );
    expect(below).toBeNull();
  });
});

describe("glideTargetFromTap", () => {
  it("holds a distant tap inside the room", () => {
    // The Grand Hall is long; a tap near the horizon resolves tens of metres
    // out. Containment is what keeps the viewer off the plaster.
    const held = glideTargetFromTap(standing(), { x: 0, y: -0.2 }, FOV, 16 / 9, ROOM);
    expect(held).not.toBeNull();
    expect(held?.[2] ?? 0).toBeGreaterThanOrEqual(-4.5);
    expect(held?.[1]).toBe(EYE);
  });

  it("leaves a tap that already lands inside the room where it fell", () => {
    const free = glideTargetFromTap(standing(), { x: 0, y: -0.5 }, FOV, 16 / 9, WIDE);
    const floor = floorPointFromTap(standing(), { x: 0, y: -0.5 }, FOV, 16 / 9, 0);

    expect(free).toEqual(floor);
  });

  it("passes a refusal through rather than inventing a destination", () => {
    expect(glideTargetFromTap(standing(), { x: 0, y: 0.5 }, FOV, 16 / 9, ROOM)).toBeNull();
  });
});

describe("pinchDistance", () => {
  it("is the plain separation of two contacts", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});

describe("pinchForwardMetres", () => {
  it("moves forward as the fingers spread, the way spreading enlarges a map", () => {
    expect(pinchForwardMetres(200, 240, 400)).toBeCloseTo((40 / 400) * PINCH_TRAVEL_M, 6);
  });

  it("moves back as they close, by the same amount", () => {
    expect(pinchForwardMetres(240, 200, 400)).toBeCloseTo(-(40 / 400) * PINCH_TRAVEL_M, 6);
  });

  it("means the same distance on a phone and on a tablet", () => {
    // Scaled by the canvas width, so a quarter of the screen is a quarter of
    // the travel whatever the screen is.
    expect(pinchForwardMetres(0, 100, 400)).toBeCloseTo(pinchForwardMetres(0, 200, 800), 6);
  });

  it("never teleports anyone on one coarse or synthetic event", () => {
    // The same guard wheelStepMetres needs: a hundred pixels of spread
    // reported in a single step must not cross the room.
    expect(pinchForwardMetres(0, 4000, 400)).toBeLessThanOrEqual(1);
    expect(pinchForwardMetres(4000, 0, 400)).toBeGreaterThanOrEqual(-1);
  });

  it("does nothing when nothing changed, or when there is no canvas to scale by", () => {
    expect(pinchForwardMetres(200, 200, 400)).toBe(0);
    expect(pinchForwardMetres(0, 100, 0)).toBe(0);
    expect(pinchForwardMetres(Number.NaN, 100, 400)).toBe(0);
  });
});

describe("isTapGesture and isHoldGesture", () => {
  const THRESHOLD = 5;

  it("calls a short, still contact a tap", () => {
    expect(isTapGesture(100, 0, THRESHOLD)).toBe(true);
    expect(isTapGesture(TAP_MAX_MS, THRESHOLD, THRESHOLD)).toBe(true);
  });

  it("refuses a contact that lingered or wandered", () => {
    expect(isTapGesture(TAP_MAX_MS + 1, 0, THRESHOLD)).toBe(false);
    expect(isTapGesture(100, THRESHOLD + 1, THRESHOLD)).toBe(false);
  });

  it("calls a long, still contact a hold", () => {
    expect(isHoldGesture(HOLD_TO_WALK_MS, 0, THRESHOLD)).toBe(true);
    expect(isHoldGesture(HOLD_TO_WALK_MS + 500, THRESHOLD, THRESHOLD)).toBe(true);
  });

  it("refuses a hold that travelled: that is a look", () => {
    expect(isHoldGesture(HOLD_TO_WALK_MS, THRESHOLD + 1, THRESHOLD)).toBe(false);
    expect(isHoldGesture(HOLD_TO_WALK_MS - 1, 0, THRESHOLD)).toBe(false);
  });

  it("leaves no gesture that is neither a tap nor a hold", () => {
    // One threshold decides both halves on purpose. A contact that never moved
    // is always exactly one of the two, whatever its duration, so there is no
    // window in which a finger does nothing at all.
    for (const elapsed of [0, 1, 100, TAP_MAX_MS - 1, TAP_MAX_MS, HOLD_TO_WALK_MS, 5_000]) {
      const tap = isTapGesture(elapsed, 0, THRESHOLD);
      const hold = isHoldGesture(elapsed, 0, THRESHOLD);
      expect(tap || hold).toBe(true);
    }
  });
});
