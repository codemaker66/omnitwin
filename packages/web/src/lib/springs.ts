// -----------------------------------------------------------------------------
// springs — the shared spring-physics core.
//
// House rule: springs, never tweens, for anything that moves in response to
// input. Promoted out of pages/landing/rite-motion.ts (The Rite's motion core)
// when the twin walkthrough became the second consumer; rite-motion re-exports
// everything here so existing landing imports are untouched. Pure and
// allocation-free — callers own the SpringState objects and feed real
// frame-clock deltas.
// -----------------------------------------------------------------------------

export interface SpringConfig {
  /** Restoring force per unit displacement (1/s²). */
  readonly stiffness: number;
  /** Velocity damping (1/s). */
  readonly damping: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Semi-implicit Euler spring step. Stable at display refresh dt (≤ ~33 ms);
 * larger dts are internally subdivided so a dropped frame can never explode
 * the simulation.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dtSeconds: number,
  config: SpringConfig,
): void {
  const MAX_STEP = 1 / 30;
  let remaining = Math.min(dtSeconds, 0.25); // clamp tab-switch pauses
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP);
    const accel =
      config.stiffness * (target - state.value) - config.damping * state.velocity;
    state.velocity += accel * dt;
    state.value += state.velocity * dt;
    remaining -= dt;
  }
}

/** True once the spring has visually settled (used to stop rAF loops). */
export function isSpringSettled(
  state: SpringState,
  target: number,
  epsilon = 0.001,
): boolean {
  return (
    Math.abs(state.value - target) < epsilon &&
    Math.abs(state.velocity) < epsilon
  );
}
