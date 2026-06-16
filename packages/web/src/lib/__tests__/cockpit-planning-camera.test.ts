import { describe, expect, it } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import { MAX_POLAR_ANGLE, MIN_POLAR_ANGLE } from "../camera-rig.js";
import {
  PLANNING_POLAR_ANGLE,
  azimuthOf,
  planningCameraGoal,
  sphericalPosition,
  type Vec3,
} from "../cockpit-planning-camera.js";

const GRAND_HALL: SpaceDimensions = { width: 42, length: 21, height: 7 };

describe("PLANNING_POLAR_ANGLE", () => {
  it("is a gentle elevated pitch within the orbit limits", () => {
    expect(PLANNING_POLAR_ANGLE).toBeGreaterThan(MIN_POLAR_ANGLE);
    expect(PLANNING_POLAR_ANGLE).toBeLessThan(MAX_POLAR_ANGLE);
  });
});

describe("sphericalPosition", () => {
  it("places a horizontal (polar π/2) camera out along +Z at azimuth 0", () => {
    const p = sphericalPosition([0, 0, 0], 10, Math.PI / 2, 0);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(10, 6);
  });

  it("places a straight-down (polar 0) camera directly above the target", () => {
    const p = sphericalPosition([0, 0, 0], 10, 0, 0);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(10, 6);
    expect(p[2]).toBeCloseTo(0, 6);
  });

  it("offsets from a non-origin target and swings to +X at azimuth π/2", () => {
    const p = sphericalPosition([1, 2, 3], 10, Math.PI / 2, Math.PI / 2);
    expect(p[0]).toBeCloseTo(11, 6);
    expect(p[1]).toBeCloseTo(2, 6);
    expect(p[2]).toBeCloseTo(3, 6);
  });
});

describe("azimuthOf", () => {
  it("reads 0 looking from +Z and π/2 looking from +X", () => {
    expect(azimuthOf([0, 0, 10], [0, 0, 0])).toBeCloseTo(0, 6);
    expect(azimuthOf([10, 0, 0], [0, 0, 0])).toBeCloseTo(Math.PI / 2, 6);
  });

  it("falls back to a slight angle when the camera is directly overhead", () => {
    expect(azimuthOf([0, 10, 0], [0, 0, 0])).toBeCloseTo(-0.2, 6);
  });
});

describe("planningCameraGoal", () => {
  it("recentres on the room and lifts to an elevated, framed planning pose", () => {
    const goal = planningCameraGoal(GRAND_HALL, [0, 5, 10], [0, 0.7, 0], 1.78, 55);

    // Target recentres on the room (landscape: low centre-of-room height).
    expect(goal.target[0]).toBeCloseTo(0, 6);
    expect(goal.target[1]).toBeCloseTo(0.7, 6);
    expect(goal.target[2]).toBeCloseTo(0, 6);

    // Lifted well above the floor and pulled back along +Z (azimuth 0 preserved).
    expect(goal.position[1]).toBeGreaterThan(15);
    expect(goal.position[0]).toBeCloseTo(0, 4);
    expect(goal.position[2]).toBeGreaterThan(10);

    // The pitch from the target matches the planning polar angle.
    const dx = goal.position[0] - goal.target[0];
    const dy = goal.position[1] - goal.target[1];
    const dz = goal.position[2] - goal.target[2];
    const polar = Math.atan2(Math.hypot(dx, dz), dy);
    expect(polar).toBeCloseTo(PLANNING_POLAR_ANGLE, 4);
  });

  it("preserves the viewer's azimuth so it lifts in place rather than spinning", () => {
    // Viewer looking from the +X side → the framed pose stays on the +X side.
    const goal = planningCameraGoal(GRAND_HALL, [10, 5, 0], [0, 0.7, 0], 1.78, 55);
    expect(goal.position[0]).toBeGreaterThan(10);
    expect(goal.position[2]).toBeCloseTo(0, 4);
  });

  it("keeps the framing distance within the orbit distance limits", () => {
    const goal = planningCameraGoal(GRAND_HALL, [0, 5, 10], [0, 0.7, 0], 1.78, 55);
    const d = (a: Vec3, b: Vec3): number =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const distance = d(goal.position, goal.target);
    // Grand Hall limits: min 1.5, max max(15, 42*1.6)=67.2.
    expect(distance).toBeGreaterThan(1.5);
    expect(distance).toBeLessThan(67.2);
  });
});
