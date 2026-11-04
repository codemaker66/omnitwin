import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRICK_MOTION_QUICK,
  BRICK_MOTION_SLOW,
  IMPACT_POINT,
  computeBrickProgress,
  easeHeavyLanding,
} from "../brick-wall.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import {
  stepWallAssemblyOpacity,
  stepWallClickTimeline,
  wallClickBrickMotion,
  wallClickSeconds,
} from "../surface-visibility-group.js";

// ---------------------------------------------------------------------------
// Blake's decision 4, `wallsQuick`: a clicked wall comes down, or goes back
// up, in 450 ms rather than 5 s, and at once under reduced motion. The bricks
// and the wall's own surface read one clock, so they stay together.
// ---------------------------------------------------------------------------

function reducedMotion(on: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query === "(prefers-reduced-motion: reduce)" }));
}

/** Seconds a 60 Hz frame loop takes to carry a clicked wall from `from` to `to`. */
function secondsAt60Hz(from: number, to: 0 | 1): number {
  let value = from;
  let frames = 0;
  while (value !== to && frames < 1_000) {
    value = stepWallAssemblyOpacity(value, to, 1 / 60);
    frames += 1;
  }
  return frames / 60;
}

afterEach(() => {
  setPlannerFeaturesForTesting(null);
  vi.unstubAllGlobals();
});

describe("wallsQuick off: today's brick-down", () => {
  it("takes 5 s with today's throw, reduced motion or not", () => {
    expect(wallClickSeconds()).toBe(5);
    reducedMotion(true);
    expect(wallClickSeconds()).toBe(5);
    expect(wallClickBrickMotion()).toBe(BRICK_MOTION_SLOW);
  });

  it("steps a clicked wall at today's rate", () => {
    expect(secondsAt60Hz(1, 0)).toBeCloseTo(5, 1);
  });
});

describe("wallsQuick on: a wall toggle is a moment, not a wait", () => {
  it("takes a wall down in 450 ms, and puts it back in 450 ms, at 60 Hz", () => {
    setPlannerFeaturesForTesting({ wallsQuick: true });
    reducedMotion(false);
    for (const [from, to] of [[1, 0], [0, 1]] as const) {
      const seconds = secondsAt60Hz(from, to);
      expect(seconds, `${String(from)} to ${String(to)}`).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(seconds, `${String(from)} to ${String(to)}`).toBeLessThanOrEqual(0.45 + 1 / 60 + 1e-9);
    }
  });

  it("takes it, and brings it back, at once under reduced motion", () => {
    setPlannerFeaturesForTesting({ wallsQuick: true });
    reducedMotion(true);
    expect(wallClickSeconds()).toBe(0);
    expect(stepWallAssemblyOpacity(1, 0, 1 / 60)).toBe(0);
    expect(stepWallAssemblyOpacity(0, 1, 1 / 60)).toBe(1);
  });

  it("never jumps after a long frame: one step is at most 0.1 s of the 450 ms", () => {
    expect(stepWallClickTimeline(1, 0, 10, 0.45)).toBeCloseTo(1 - 0.1 / 0.45, 9);
    expect(stepWallClickTimeline(0.5, 0.5, 1 / 60, 0.45)).toBe(0.5);
  });

  it("throws each block 0.6 m over 225 ms, so it falls rather than flickers, and has every block at rest by 450 ms", () => {
    setPlannerFeaturesForTesting({ wallsQuick: true });
    const motion = wallClickBrickMotion();
    expect(motion).toBe(BRICK_MOTION_QUICK);
    const flightSeconds = 0.45 * (1 - motion.staggerSpan);
    expect(flightSeconds).toBeCloseTo(0.225, 9);
    // The approach to impact is quadratic; today's 2.2 m throw squeezed into
    // 450 ms would average about 41 m/s over it.
    expect(motion.scatterDistance / (flightSeconds * IMPACT_POINT)).toBeLessThan(5);
    for (const stagger of [0, 0.25, 0.5, 0.75, 1]) {
      expect(computeBrickProgress(0, stagger, motion.staggerSpan)).toBe(0);
      expect(easeHeavyLanding(computeBrickProgress(1, stagger, motion.staggerSpan))).toBe(1);
    }
  });
});
