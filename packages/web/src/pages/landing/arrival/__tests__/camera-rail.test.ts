import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  ARRIVAL_RAIL,
  FLIGHT_DURATION_S,
  sampleRail,
  type RailKeyframe,
} from "../camera-rail.js";

const RAIL: readonly RailKeyframe[] = [
  { t: 0, position: [0, 1000, 1000], lookAt: [0, 0, 0] },
  { t: 0.5, position: [0, 400, 400], lookAt: [0, 10, 0] },
  { t: 1, position: [0, 30, 60], lookAt: [0, 12, 0] },
];

describe("sampleRail", () => {
  it("returns the first keyframe pose at t<=0 and the last at t>=1 (clamped)", () => {
    expect(sampleRail(RAIL, -0.5).position.toArray()).toEqual([0, 1000, 1000]);
    expect(sampleRail(RAIL, 0).position.toArray()).toEqual([0, 1000, 1000]);
    const end = sampleRail(RAIL, 1.7).position;
    expect(end.distanceTo(new Vector3(0, 30, 60))).toBeLessThan(1e-6);
  });

  it("descends monotonically in altitude for a descending rail", () => {
    let prevY = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 20; i += 1) {
      const y = sampleRail(RAIL, i / 20).position.y;
      expect(y).toBeLessThanOrEqual(prevY + 1e-6);
      prevY = y;
    }
  });

  it("produces a normalized quaternion that looks toward the lookAt point", () => {
    const pose = sampleRail(RAIL, 1);
    expect(
      Math.abs(
        pose.quaternion.x ** 2 + pose.quaternion.y ** 2 +
        pose.quaternion.z ** 2 + pose.quaternion.w ** 2 - 1,
      ),
    ).toBeLessThan(1e-6);
    // Camera forward is -Z rotated by the quaternion; it must point at lookAt.
    const forward = new Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
    const toTarget = new Vector3(0, 12, 0).sub(pose.position).normalize();
    expect(forward.angleTo(toTarget)).toBeLessThan(1e-4);
  });

  it("ships a real rail: 0-start, 1-end, strictly increasing t, sane duration", () => {
    const first = ARRIVAL_RAIL[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.t).toBe(0);
    }
    const last = ARRIVAL_RAIL[ARRIVAL_RAIL.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) {
      expect(last.t).toBe(1);
    }
    for (let i = 1; i < ARRIVAL_RAIL.length; i += 1) {
      const curr = ARRIVAL_RAIL[i];
      const prev = ARRIVAL_RAIL[i - 1];
      expect(curr).toBeDefined();
      expect(prev).toBeDefined();
      if (curr !== undefined && prev !== undefined) {
        expect(curr.t).toBeGreaterThan(prev.t);
      }
    }
    expect(FLIGHT_DURATION_S).toBeGreaterThan(6);
    expect(FLIGHT_DURATION_S).toBeLessThan(20);
  });
});
