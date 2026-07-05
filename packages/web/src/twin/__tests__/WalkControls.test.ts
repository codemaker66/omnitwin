import { describe, expect, it } from "vitest";
import { Euler, PerspectiveCamera } from "three";
import {
  FLICK_MAX_SPEED_PX_S,
  FLICK_MIN_SPEED_PX_S,
  FLICK_REST_DECAY_MS,
  LOOK_SENSITIVITY,
  MAX_PITCH_RAD,
  clampPitch,
  dragToYawPitch,
  flickVelocity,
  lookStateFromCamera,
  type FlickSample,
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

describe("flickVelocity", () => {
  /** A steady 60 Hz leftward drag: −16 px every 16 ms (−1000 px/s). */
  function steadyDrag(count: number, endT: number): FlickSample[] {
    const samples: FlickSample[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = endT - (count - 1 - i) * 16;
      samples.push({ t, x: -16 * i, y: 0 });
    }
    return samples;
  }

  it("recovers the true velocity of a steady 60 Hz drag released promptly", () => {
    const samples = steadyDrag(8, 1000);
    const { vx, vy } = flickVelocity(samples, 1000);
    expect(vx).toBeCloseTo(-1000, 0);
    expect(vy).toBe(0);
  });

  it("decays momentum for a rest between the last move and release", () => {
    const samples = steadyDrag(8, 1000);
    const prompt = flickVelocity(samples, 1000).vx;
    const rested = flickVelocity(samples, 1000 + FLICK_REST_DECAY_MS).vx;
    // One decay constant of rest keeps ~1/e of the momentum.
    expect(Math.abs(rested)).toBeCloseTo(Math.abs(prompt) / Math.E, 0);
  });

  it("returns zero after a long hold before release (iOS rule)", () => {
    const samples = steadyDrag(8, 1000);
    expect(flickVelocity(samples, 1450)).toEqual({ vx: 0, vy: 0 });
  });

  it("returns zero when the drag itself was slower than the flick floor", () => {
    // 2 px per 16 ms = 125 px/s — under FLICK_MIN_SPEED_PX_S.
    const samples: FlickSample[] = [
      { t: 968, x: 0, y: 0 },
      { t: 984, x: 2, y: 0 },
      { t: 1000, x: 4, y: 0 },
    ];
    expect(FLICK_MIN_SPEED_PX_S).toBeGreaterThan(125);
    expect(flickVelocity(samples, 1000)).toEqual({ vx: 0, vy: 0 });
  });

  it("clamps a wild flick to the ceiling, preserving direction", () => {
    // 160 px per 16 ms = 10 000 px/s, diagonal.
    const samples: FlickSample[] = [
      { t: 984, x: 0, y: 0 },
      { t: 1000, x: 160, y: 160 },
    ];
    const { vx, vy } = flickVelocity(samples, 1000);
    const speed = Math.hypot(vx, vy);
    expect(speed).toBeCloseTo(FLICK_MAX_SPEED_PX_S, 6);
    expect(vx).toBeGreaterThan(0);
    expect(vy).toBeGreaterThan(0);
    expect(vx).toBeCloseTo(vy, 6);
  });

  it("weights recent motion over old motion (direction reversal)", () => {
    // Fast rightward start, then a firm leftward finish — the release must
    // glide LEFT.
    const samples: FlickSample[] = [
      { t: 900, x: 0, y: 0 },
      { t: 916, x: 40, y: 0 },
      { t: 932, x: 80, y: 0 },
      { t: 948, x: 60, y: 0 },
      { t: 964, x: 40, y: 0 },
      { t: 980, x: 20, y: 0 },
      { t: 996, x: 0, y: 0 },
    ];
    expect(flickVelocity(samples, 1000).vx).toBeLessThan(0);
  });

  it("survives a mid-flick event-loop hiccup with momentum intact", () => {
    // 60 Hz drag with one 60 ms delivery gap whose displacement coalesced —
    // a hard sampling window would zero this; the low-pass must not.
    const samples: FlickSample[] = [
      { t: 880, x: 0, y: 0 },
      { t: 896, x: -16, y: 0 },
      { t: 912, x: -32, y: 0 },
      { t: 972, x: -92, y: 0 }, // 60 ms gap, 60 px coalesced (−1000 px/s)
      { t: 988, x: -108, y: 0 },
    ];
    const { vx } = flickVelocity(samples, 1000);
    expect(vx).toBeLessThan(-700);
  });

  it("yields zero for empty and single-sample buffers", () => {
    expect(flickVelocity([], 1000)).toEqual({ vx: 0, vy: 0 });
    expect(flickVelocity([{ t: 990, x: 5, y: 5 }], 1000)).toEqual({ vx: 0, vy: 0 });
  });

  it("maps px/s to rad/s through the same sensitivity as the drag", () => {
    // The component hands vx/vy to dragToYawPitch — pin that equivalence.
    const { dYaw } = dragToYawPitch(-1000, 0);
    expect(dYaw).toBeCloseTo(-1000 * LOOK_SENSITIVITY, 10);
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
