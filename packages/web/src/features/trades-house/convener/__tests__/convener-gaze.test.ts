import { describe, expect, it } from "vitest";
import {
  GAZE_FOLLOW_OMEGA,
  GAZE_MAX_DX,
  GAZE_MAX_DY,
  type GazeRect,
  type SpringState,
  gazeTargetForPointer,
  isSpringSettled,
  nextBlinkDelayMs,
  nextWanderDelayMs,
  stepCriticallyDampedSpring,
  wanderTarget,
} from "../convener-gaze.js";

const RECT: GazeRect = { left: 100, top: 100, width: 300, height: 470 };
const CENTER_X = 250;
const EYELINE_Y = 100 + 470 * 0.45;

describe("gazeTargetForPointer", () => {
  it("looks straight ahead at a pointer dead on the eyeline", () => {
    const target = gazeTargetForPointer(RECT, CENTER_X, EYELINE_Y);
    expect(target.dx).toBeCloseTo(0);
    expect(target.dy).toBeCloseTo(0);
  });

  it("looks toward the pointer, softened by the divisors", () => {
    const target = gazeTargetForPointer(RECT, CENTER_X + 120, EYELINE_Y + 80);
    expect(target.dx).toBeCloseTo(2);
    expect(target.dy).toBeCloseTo(1);
  });

  it("clamps to the tiny travel that keeps him painterly", () => {
    const far = gazeTargetForPointer(RECT, CENTER_X + 5_000, EYELINE_Y + 5_000);
    expect(far.dx).toBe(GAZE_MAX_DX);
    expect(far.dy).toBe(GAZE_MAX_DY);
    const farLeft = gazeTargetForPointer(RECT, CENTER_X - 5_000, EYELINE_Y - 5_000);
    expect(farLeft.dx).toBe(-GAZE_MAX_DX);
    expect(farLeft.dy).toBe(-GAZE_MAX_DY);
  });
});

describe("stepCriticallyDampedSpring", () => {
  const at = (value: number, velocity = 0): SpringState => ({ value, velocity });

  function settle(state: SpringState, target: number, steps: number, dt: number): SpringState {
    let next = state;
    for (let i = 0; i < steps; i += 1) {
      next = stepCriticallyDampedSpring(next, target, dt, GAZE_FOLLOW_OMEGA);
    }
    return next;
  }

  it("converges on the target", () => {
    const settled = settle(at(0), 4, 120, 1 / 60);
    expect(settled.value).toBeCloseTo(4, 2);
    expect(Math.abs(settled.velocity)).toBeLessThan(0.01);
  });

  it("never overshoots from rest — eyes that wobble read as drunk", () => {
    let state = at(0);
    for (let i = 0; i < 240; i += 1) {
      state = stepCriticallyDampedSpring(state, 4, 1 / 60, GAZE_FOLLOW_OMEGA);
      expect(state.value).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("survives a tab-switch dt spike without exploding", () => {
    const spiked = stepCriticallyDampedSpring(at(0), 4, 2.5, GAZE_FOLLOW_OMEGA);
    expect(spiked.value).toBeGreaterThan(3.99);
    expect(spiked.value).toBeLessThanOrEqual(4 + 1e-9);
    expect(Number.isFinite(spiked.velocity)).toBe(true);
  });

  it("settles in roughly 4/omega seconds — the half-beat lag that reads alive", () => {
    const settleSeconds = 4 / GAZE_FOLLOW_OMEGA;
    const steps = Math.ceil(settleSeconds * 60);
    const nearlyThere = settle(at(0), 4, steps, 1 / 60);
    expect(Math.abs(nearlyThere.value - 4)).toBeLessThan(0.4);
    const halfway = settle(at(0), 4, Math.floor(steps / 4), 1 / 60);
    expect(Math.abs(halfway.value - 4)).toBeGreaterThan(0.4);
  });

  it("returns the state unchanged for a non-positive dt", () => {
    const state = at(1, 2);
    expect(stepCriticallyDampedSpring(state, 4, 0, GAZE_FOLLOW_OMEGA)).toBe(state);
    expect(stepCriticallyDampedSpring(state, 4, -1, GAZE_FOLLOW_OMEGA)).toBe(state);
  });

  it("reports settled only within epsilon of the target at rest", () => {
    expect(isSpringSettled(at(4), 4)).toBe(true);
    expect(isSpringSettled(at(3.9), 4)).toBe(false);
    expect(isSpringSettled(at(4, 0.5), 4)).toBe(false);
  });
});

describe("idle schedules", () => {
  it("keeps blink delays inside the human band", () => {
    expect(nextBlinkDelayMs(() => 0)).toBe(1_900);
    expect(nextBlinkDelayMs(() => 1)).toBe(5_200);
    expect(nextBlinkDelayMs(() => 0.5)).toBeCloseTo(3_550);
  });

  it("keeps wander delays inside the original band", () => {
    expect(nextWanderDelayMs(() => 0)).toBe(2_400);
    expect(nextWanderDelayMs(() => 1)).toBe(6_400);
  });

  it("abandons half its wander impulses — old men are like that", () => {
    expect(wanderTarget(() => 0.49)).toBeNull();
    const committed = wanderTarget(() => 0.5);
    expect(committed).not.toBeNull();
  });

  it("wanders within a smaller envelope than a direct stare", () => {
    const values = [0.9, 0.1, 0.99];
    let call = 0;
    const rng = (): number => values[call++ % values.length] ?? 0.5;
    const target = wanderTarget(rng);
    expect(target).not.toBeNull();
    if (target === null) return;
    expect(Math.abs(target.dx)).toBeLessThanOrEqual(3);
    expect(Math.abs(target.dy)).toBeLessThanOrEqual(2);
  });
});
