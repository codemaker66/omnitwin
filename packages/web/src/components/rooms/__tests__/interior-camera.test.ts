import { describe, expect, it } from "vitest";
import {
  clampPitch,
  maxPitchUpFor,
  MAX_PITCH_DOWN,
  lookSensitivity,
  containPosition,
  isContained,
  isSettled,
  lookTarget,
  MAX_PITCH,
  moveOnFloorPlane,
  shortestAngleTo,
  smoothAngleTowards,
  smoothTowards,
  WALL_INSET_M,
  type Bounds,
  type Vec3,
  wheelStepMetres,
} from "../interior-camera.js";

/** Reception's real walked region, scene metres. */
const ROOM: Bounds = { min: [-4.85, 1.27, -6.2], max: [4.85, 2.47, 6.2] };

describe("smoothTowards", () => {
  it("settles in the same wall-clock time whatever the frame rate", () => {
    // The whole point: a filter that depends on frame rate reads as lag on a
    // slow machine and twitchiness on a fast one.
    const run = (dt: number): number => {
      let x = 0;
      for (let t = 0; t < 0.5; t += dt) x = smoothTowards(x, 1, 0.1, dt);
      return x;
    };
    expect(run(1 / 30)).toBeCloseTo(run(1 / 144), 2);
  });

  it("never overshoots, however long the frame", () => {
    expect(smoothTowards(0, 1, 0.1, 10)).toBeLessThanOrEqual(1);
  });

  it("jumps straight there when asked for no smoothing", () => {
    expect(smoothTowards(0, 1, 0, 0.016)).toBe(1);
  });
});

describe("shortestAngleTo", () => {
  it("turns the short way around the wrap", () => {
    expect(shortestAngleTo(-3.0, 3.0)).toBeLessThan(0);
    expect(Math.abs(shortestAngleTo(-3.0, 3.0))).toBeLessThan(Math.PI);
  });

  it("is zero for the same angle", () => {
    expect(shortestAngleTo(1.2, 1.2)).toBeCloseTo(0, 9);
  });
});

describe("smoothAngleTowards", () => {
  it("does not spin the long way round when crossing the wrap", () => {
    const next = smoothAngleTowards(-3.1, 3.1, 0.1, 0.016);
    // Going the short way takes it further negative, past -PI, not up through 0.
    expect(next).toBeLessThan(-3.1);
  });
});

describe("clampPitch", () => {
  it("stops short of straight up, where a capture has no data", () => {
    expect(clampPitch(Math.PI / 2)).toBeLessThan(Math.PI / 2);
    expect(clampPitch(Math.PI / 2)).toBe(MAX_PITCH);
    expect(clampPitch(-Math.PI)).toBe(-MAX_PITCH_DOWN);
  });

  it("leaves a level look alone", () => {
    expect(clampPitch(0)).toBe(0);
  });

  it("honours a room's own limit when given one", () => {
    expect(clampPitch(1.2, 0.35)).toBe(0.35);
  });
});

describe("maxPitchUpFor", () => {
  it("barely lets you look up in a low room", () => {
    // Robert Adam's ceiling is 2.18 m, so roughly half a metre of headroom.
    expect(maxPitchUpFor(0.5)).toBeLessThan(0.4);
  });

  it("opens right up under a dome", () => {
    expect(maxPitchUpFor(9)).toBe(MAX_PITCH);
  });

  it("still allows some upward look in a room with almost no headroom", () => {
    expect(maxPitchUpFor(0.01)).toBeGreaterThan(0);
  });
});

describe("lookSensitivity", () => {
  it("keeps the point under the finger under the finger", () => {
    // Dragging the full width of the canvas should turn the view by exactly
    // the horizontal field of view.
    const width = 1280;
    const perPixel = lookSensitivity(48, 16 / 9, width);
    const fovV = (48 * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (16 / 9));
    expect(perPixel * width).toBeCloseTo(fovH, 6);
  });

  it("turns less per pixel on a wider canvas", () => {
    expect(lookSensitivity(48, 16 / 9, 2560)).toBeLessThan(lookSensitivity(48, 16 / 9, 1280));
  });

  it("does not divide by a zero-width canvas", () => {
    expect(lookSensitivity(48, 1.5, 0)).toBe(0);
  });
});

describe("containPosition", () => {
  it("keeps the camera inside the walked room", () => {
    const out: Vec3 = [50, 1.9, 50];
    const held = containPosition(out, ROOM);
    expect(isContained(held, ROOM)).toBe(true);
    expect(held[0]).toBeLessThan(ROOM.max[0]);
  });

  it("holds a person's width off the wall", () => {
    const held = containPosition([99, 1.9, 0], ROOM);
    expect(ROOM.max[0] - held[0]).toBeCloseTo(WALL_INSET_M, 5);
  });

  it("leaves a position that is already inside untouched", () => {
    const inside: Vec3 = [0, 1.9, 0];
    expect(containPosition(inside, ROOM)).toEqual(inside);
  });

  it("cannot invert a room narrower than twice the inset", () => {
    const tight: Bounds = { min: [-0.2, 1.4, -0.2], max: [0.2, 1.5, 0.2] };
    const held = containPosition([9, 9, 9], tight);
    expect(held[0]).toBeGreaterThanOrEqual(tight.min[0]);
    expect(held[0]).toBeLessThanOrEqual(tight.max[0]);
    expect(Number.isFinite(held[1])).toBe(true);
  });

  it("holds every room in the building, from any starting point", () => {
    const rooms: Bounds[] = [
      { min: [-5.05, 2.4, -9.95], max: [5.05, 3.6, 9.95] },   // grand hall
      { min: [-2.0, 0.82, -1.95], max: [2.0, 2.02, 1.95] },    // lady convenor's
      { min: [-9.7, 1.01, -9.0], max: [9.7, 2.21, 9.0] },      // robert adam
    ];
    for (const room of rooms) {
      for (const start of [[999, 999, 999], [-999, -999, -999]] as Vec3[]) {
        expect(isContained(containPosition(start, room), room)).toBe(true);
      }
    }
  });
});

describe("moveOnFloorPlane", () => {
  it("keeps height while walking, however steeply you are looking", () => {
    const moved = moveOnFloorPlane([0, 1.9, 0], 0.4, 1, 0);
    expect(moved[1]).toBe(1.9);
  });

  it("walks the way you are facing", () => {
    // Facing yaw = 0 looks down -Z, so forward must decrease Z.
    const moved = moveOnFloorPlane([0, 1.9, 0], 0, 1, 0);
    expect(moved[2]).toBeLessThan(0);
    expect(moved[0]).toBeCloseTo(0, 6);
  });

  it("strafes across the facing, not along it", () => {
    const moved = moveOnFloorPlane([0, 1.9, 0], 0, 0, 1);
    expect(moved[0]).toBeGreaterThan(0);
    expect(moved[2]).toBeCloseTo(0, 6);
  });
});

describe("isSettled", () => {
  const at = (position: Vec3, yaw = 0, pitch = 0): { position: Vec3; yaw: number; pitch: number } =>
    ({ position, yaw, pitch });

  it("is settled when it has arrived", () => {
    expect(isSettled(at([1, 2, 3]), at([1, 2, 3]))).toBe(true);
  });

  it("is not settled while still travelling", () => {
    expect(isSettled(at([0, 2, 3]), at([1, 2, 3]))).toBe(false);
  });

  it("is not settled while still turning, even in place", () => {
    expect(isSettled(at([1, 2, 3], 0), at([1, 2, 3], 0.5))).toBe(false);
  });

  it("measures a turn across the wrap the short way, not as a full circle", () => {
    // Either side of PI is a hair apart, not a whole revolution. Measuring it
    // naively would keep asking for frames forever, chasing a turn that has
    // already arrived.
    const justUnder = -Math.PI + 0.0001;
    const justOver = Math.PI - 0.0001;
    expect(isSettled(at([0, 0, 0], justUnder), at([0, 0, 0], justOver))).toBe(true);
  });

  it("is still not settled for a genuinely different heading", () => {
    expect(isSettled(at([0, 0, 0], -3.0), at([0, 0, 0], 3.0))).toBe(false);
  });
});

describe("lookTarget", () => {
  it("looks along -Z at rest, matching the scene's facing", () => {
    const target = lookTarget({ position: [0, 1.9, 0], yaw: 0, pitch: 0 });
    expect(target[2]).toBeCloseTo(-1, 5);
    expect(target[1]).toBeCloseTo(1.9, 5);
  });

  it("raises the look when pitched up, without moving the eye", () => {
    const target = lookTarget({ position: [0, 1.9, 0], yaw: 0, pitch: 0.5 });
    expect(target[1]).toBeGreaterThan(1.9);
  });
});

// ---------------------------------------------------------------------------
// The wheel.
//
// It used to step a fixed 0.55 m per EVENT, whatever the event said. A mouse
// notch is one event, so a mouse felt right; a trackpad sends a stream of tiny
// ones, so a single flick sent 25 events and carried the viewer 11.3 m across
// the room into the far corner (measured on the live walk, 2026-09-04).
// ---------------------------------------------------------------------------
describe("wheelStepMetres", () => {
  const STEP = 0.55;

  it("moves one step forward for one mouse notch, which is what a notch always did", () => {
    expect(wheelStepMetres(-100, 0, STEP)).toBeCloseTo(STEP, 6);
    expect(wheelStepMetres(100, 0, STEP)).toBeCloseTo(-STEP, 6);
  });

  it("moves a trackpad's flick in proportion, so twenty-five tiny events are one notch, not twenty-five", () => {
    const flick = Array.from({ length: 25 }, () => wheelStepMetres(-4, 0, STEP));
    const travelled = flick.reduce((sum, step) => sum + step, 0);
    expect(travelled).toBeCloseTo(STEP, 6);
    expect(travelled).toBeLessThan(1);
  });

  it("never lets one event move more than a notch, however large the delta claims to be", () => {
    expect(wheelStepMetres(-4000, 0, STEP)).toBeCloseTo(STEP, 6);
    expect(wheelStepMetres(4000, 0, STEP)).toBeCloseTo(-STEP, 6);
  });

  it("reads the delta in the units the event declares: lines and pages, not only pixels", () => {
    expect(wheelStepMetres(-3, 1, STEP)).toBeCloseTo(STEP, 6);
    expect(wheelStepMetres(-1.5, 1, STEP)).toBeCloseTo(STEP / 2, 6);
    expect(wheelStepMetres(-1, 2, STEP)).toBeCloseTo(STEP, 6);
  });

  it("stands still for a sideways or empty scroll", () => {
    expect(wheelStepMetres(0, 0, STEP)).toBe(0);
  });
});
