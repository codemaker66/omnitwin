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

// ---------------------------------------------------------------------------
// The planner chrome's three springs (T-671, spec section 8). "Settles" is the
// spec's own definition: the last moment a unit step is more than 2 % from
// its target or moving faster than 5 % a second, stepped by this core.
// ---------------------------------------------------------------------------

interface StepResponse {
  readonly settleSeconds: number;
  readonly overshootPercent: number;
}

function unitStep(config: { stiffness: number; damping: number }, fps = 240): StepResponse {
  const state: SpringState = { value: 0, velocity: 0 };
  const dt = 1 / fps;
  let peak = 0;
  let lastOutside = 0;
  for (let frame = 1; frame <= fps * 4; frame += 1) {
    stepSpring(state, 1, dt, config);
    peak = Math.max(peak, state.value);
    if (Math.abs(state.value - 1) > 0.02 || Math.abs(state.velocity) > 0.05) lastOutside = frame * dt;
  }
  return { settleSeconds: lastOutside, overshootPercent: (peak - 1) * 100 };
}

describe("the planner chrome's springs", () => {
  it("detent clicks home within 0.32 s with no visible overshoot (under 0.5 %)", () => {
    const step = unitStep(SPRING_PRESETS.detent);
    expect(step.settleSeconds).toBeLessThanOrEqual(0.32);
    expect(step.overshootPercent).toBeLessThan(0.5);
  });

  it("dialGlide never overshoots, because the room makes room for a panel many times a day", () => {
    const step = unitStep(SPRING_PRESETS.dialGlide);
    expect(step.overshootPercent).toBeLessThanOrEqual(1e-6);
    expect(step.settleSeconds).toBeLessThanOrEqual(0.65);
  });

  it("sheetSettle lands a released sheet within 0.4 s, overshooting it by under 0.5 %", () => {
    const step = unitStep(SPRING_PRESETS.sheetSettle);
    expect(step.settleSeconds).toBeLessThanOrEqual(0.4);
    expect(step.overshootPercent).toBeLessThan(0.5);
  });

  it("each keeps its character at a loaded machine's 60 fps", () => {
    for (const name of ["detent", "dialGlide", "sheetSettle"] as const) {
      const at240 = unitStep(SPRING_PRESETS[name], 240);
      const at60 = unitStep(SPRING_PRESETS[name], 60);
      expect(Math.abs(at60.settleSeconds - at240.settleSeconds), name).toBeLessThan(0.03);
      expect(Math.abs(at60.overshootPercent - at240.overshootPercent), name).toBeLessThan(0.05);
    }
  });
});
