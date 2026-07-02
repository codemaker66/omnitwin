import { describe, expect, it } from "vitest";
import { Euler, PerspectiveCamera } from "three";
import {
  LOOK_SENSITIVITY,
  MAX_PITCH_RAD,
  clampPitch,
  dragToYawPitch,
  lookStateFromCamera,
} from "../WalkControls.js";

// -----------------------------------------------------------------------------
// WalkControls — pure-helper tests per the plan (Task 8). The R3F wiring
// (pointer/wheel/pinch listeners, spring-settled camera writes) is covered by
// Task 11's e2e; here we pin the math the component is built on.
// -----------------------------------------------------------------------------

describe("dragToYawPitch", () => {
  it("maps drag-right to +yaw and drag-down to +pitch (grab-the-world)", () => {
    const { dYaw, dPitch } = dragToYawPitch(120, 80);
    expect(dYaw).toBeCloseTo(120 * LOOK_SENSITIVITY, 10);
    expect(dPitch).toBeCloseTo(80 * LOOK_SENSITIVITY, 10);
    expect(dYaw).toBeGreaterThan(0);
    expect(dPitch).toBeGreaterThan(0);
  });

  it("maps drag-left/drag-up to negative deltas", () => {
    const { dYaw, dPitch } = dragToYawPitch(-50, -30);
    expect(dYaw).toBeCloseTo(-50 * LOOK_SENSITIVITY, 10);
    expect(dPitch).toBeCloseTo(-30 * LOOK_SENSITIVITY, 10);
  });

  it("scales linearly with an explicit sensitivity", () => {
    expect(dragToYawPitch(10, 20, 0.01)).toEqual({ dYaw: 0.1, dPitch: 0.2 });
    expect(dragToYawPitch(10, 20, 0.02).dYaw).toBeCloseTo(0.2, 10);
  });

  it("is zero for a zero drag", () => {
    expect(dragToYawPitch(0, 0)).toEqual({ dYaw: 0, dPitch: 0 });
  });
});

describe("clampPitch", () => {
  it("clamps to exactly ±85 degrees in radians", () => {
    expect(MAX_PITCH_RAD).toBeCloseTo((85 * Math.PI) / 180, 10);
    expect(clampPitch(Math.PI)).toBe(MAX_PITCH_RAD);
    expect(clampPitch(-Math.PI)).toBe(-MAX_PITCH_RAD);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(MAX_PITCH_RAD);
  });

  it("passes in-range pitches through untouched", () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(0.5)).toBe(0.5);
    expect(clampPitch(-1.2)).toBe(-1.2);
    expect(clampPitch(MAX_PITCH_RAD)).toBe(MAX_PITCH_RAD);
  });
});

describe("lookStateFromCamera", () => {
  it("round-trips yaw/pitch through a real camera quaternion (YXZ)", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.quaternion.setFromEuler(new Euler(0.4, 1.2, 0, "YXZ"));
    const look = lookStateFromCamera(camera);
    expect(look.yaw).toBeCloseTo(1.2, 6);
    expect(look.pitch).toBeCloseTo(0.4, 6);
  });

  it("round-trips negative yaw and pitch (looking down and behind)", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.quaternion.setFromEuler(new Euler(-0.9, -1.4, 0, "YXZ"));
    const look = lookStateFromCamera(camera);
    expect(look.yaw).toBeCloseTo(-1.4, 6);
    expect(look.pitch).toBeCloseTo(-0.9, 6);
  });

  it("reads a fresh, forward-facing camera as zero look", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    const look = lookStateFromCamera(camera);
    expect(look.yaw).toBeCloseTo(0, 10);
    expect(look.pitch).toBeCloseTo(0, 10);
  });
});
