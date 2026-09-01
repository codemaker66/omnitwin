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
 * Per-interaction tuning (feedback: spring-physics-not-tweens). The characters
 * are deliberate: a grid snap is a decisive click into place, a placement is
 * allowed one satisfying wobble, heavy stage equipment refuses to bounce.
 */
export const SPRING_PRESETS = {
  /** Snap to grid — stiff, decisive. */
  gridSettle: { stiffness: 210, damping: 20 },
  /** Playful placement bounce — wobbly, satisfying. */
  placementBounce: { stiffness: 180, damping: 12 },
  /** Camera movements — gentle, cinematic. */
  camera: { stiffness: 120, damping: 14 },
  /** Heavy stage equipment — weighty, deliberate, overdamped. */
  heavy: { stiffness: 280, damping: 120 },
} as const satisfies Record<string, SpringConfig>;

/**
 * Semi-implicit Euler spring step. Internally subdivided so a dropped frame
 * can never explode the simulation. The substep is 1/240 s because stability
 * of the velocity update requires damping·h < 2: the overdamped `heavy`
 * preset (damping 120) diverges at the display-refresh step this core
 * originally used, and a shared core must be stable for every preset it
 * ships, not just the gentle ones.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dtSeconds: number,
  config: SpringConfig,
): void {
  const MAX_STEP = 1 / 240;
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
