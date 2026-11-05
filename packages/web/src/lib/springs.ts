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
 * are deliberate: a grid snap is a decisive click into place, a placed piece
 * sets down quickly with one small dip, heavy stage equipment refuses to bounce.
 */
export const SPRING_PRESETS = {
  /**
   * Snap to grid, and a carried piece rising into the hand: a detent clicking
   * home (ζ ≈ 0.94), within 1 mm of a 0.5 m snap in 0.43 s with no visible
   * overshoot. Precise placement is critically damped (feedback: spring
   * physics); 210/20 overshot a snap by 2.2 cm.
   */
  gridSettle: { stiffness: 700, damping: 50 },
  /** Playful placement bounce — wobbly, satisfying. */
  placementBounce: { stiffness: 180, damping: 12 },
  /** Camera movements — gentle, cinematic. */
  camera: { stiffness: 120, damping: 14 },
  /** Heavy stage equipment — weighty, deliberate, overdamped. */
  heavy: { stiffness: 280, damping: 120 },
  /** The Grand Assembly's lean as a summoned piece settles: soft, two gentle swings (ζ ≈ 0.36). */
  furnitureLean: { stiffness: 230, damping: 11 },
  /** The Grand Assembly's squash as a summoned piece sets its weight down: quick and springy (ζ ≈ 0.37). */
  furnitureSquash: { stiffness: 520, damping: 17 },
  /**
   * A placed or let-go piece's lean standing upright again (ζ ≈ 0.69): one
   * small swing through, at rest in under 0.6 s, never a rocking that
   * shimmers on every drop (feedback: spring physics, precise placement).
   */
  furnitureLeanSettle: { stiffness: 230, damping: 21 },
  /** The dip as a placed or let-go piece takes its weight (ζ ≈ 0.66): one quick ~1 % dip, at rest by 0.4 s. */
  furnitureSettleSquash: { stiffness: 520, damping: 30 },
  /**
   * A piece set down onto the floor. It aims 3 cm below the floor and stops
   * at contact (lib/furniture-motion.ts), so it arrives at speed: down from
   * 5 cm in about 83 ms at about 0.65 m/s, not lowered like a crane (ζ ≈ 0.68).
   */
  furnitureSetDown: { stiffness: 420, damping: 28 },
  /**
   * A heavy door swinging open or shut on its closer: gentle, no slam and no
   * rebound (ζ ≈ 0.95), most of the way in under a second.
   */
  doorSwing: { stiffness: 36, damping: 11.4 },
  // The planner chrome's three (T-671, spec section 8). Settle times are to
  // within 2 % and under 5 %/s on a unit step, measured on this integrator.
  /** The copper underline sliding to a view, tool or workspace key, and the
   *  caption docking to an edge: a detent clicking home. ζ ≈ 0.94, settles in
   *  0.30 s, no visible overshoot. */
  detent: { stiffness: 700, damping: 50 },
  /** The hour released near a stop, a jump to an act or to Now, and the room
   *  making room for a panel: critically damped (ζ ≈ 1.0), settles in 0.59 s
   *  and never overshoots, because it happens many times a day. */
  dialGlide: { stiffness: 170, damping: 26 },
  /** A phone sheet let go of: firm, ζ ≈ 0.87, settles in 0.35 s with a 0.18 %
   *  overshoot, so it lands rather than stops. */
  sheetSettle: { stiffness: 300, damping: 30 },
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
