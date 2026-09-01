import { describe, expect, it } from "vitest";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../springs.js";

// ---------------------------------------------------------------------------
// The shared spring core. The load-bearing claim: every ship-listed preset is
// STABLE at any frame cadence. Semi-implicit Euler's velocity update needs
// damping·h < 2 — the overdamped `heavy` preset (damping 120) is exactly the
// config that diverged at the old display-refresh substep, which is why the
// core now subdivides at 1/240 s.
// ---------------------------------------------------------------------------

function settle(state: SpringState, target: number, config: { stiffness: number; damping: number }, frameDt: number, maxFrames = 2000): number {
  let frames = 0;
  while (!isSpringSettled(state, target) && frames < maxFrames) {
    stepSpring(state, target, frameDt, config);
    frames += 1;
  }
  return frames;
}

describe("SPRING_PRESETS stability", () => {
  it.each(Object.entries(SPRING_PRESETS))("%s converges at 60 fps", (_name, config) => {
    const state: SpringState = { value: 1, velocity: 0 };
    const frames = settle(state, 0, config, 1 / 60);
    expect(frames).toBeLessThan(2000);
    expect(state.value).toBeCloseTo(0, 2);
  });

  it.each(Object.entries(SPRING_PRESETS))("%s converges at 24 fps (loaded machine)", (_name, config) => {
    const state: SpringState = { value: 1, velocity: 0 };
    const frames = settle(state, 0, config, 1 / 24);
    expect(frames).toBeLessThan(2000);
    expect(state.value).toBeCloseTo(0, 2);
  });

  it("the heavy preset never overshoots (overdamped by design)", () => {
    const state: SpringState = { value: 1, velocity: 0 };
    for (let i = 0; i < 2000 && !isSpringSettled(state, 0); i += 1) {
      stepSpring(state, 0, 1 / 60, SPRING_PRESETS.heavy);
      expect(state.value).toBeGreaterThanOrEqual(-0.001);
      expect(Number.isFinite(state.value)).toBe(true);
    }
  });

  it("frame cadence does not change where the spring lands", () => {
    const at60: SpringState = { value: 1, velocity: 0 };
    const at144: SpringState = { value: 1, velocity: 0 };
    // Same simulated second of motion, different chunkings.
    for (let i = 0; i < 60; i += 1) stepSpring(at60, 0, 1 / 60, SPRING_PRESETS.gridSettle);
    for (let i = 0; i < 144; i += 1) stepSpring(at144, 0, 1 / 144, SPRING_PRESETS.gridSettle);
    expect(at60.value).toBeCloseTo(at144.value, 3);
  });
});
