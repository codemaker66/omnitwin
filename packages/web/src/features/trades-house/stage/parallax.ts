// -----------------------------------------------------------------------------
// parallax — the pure half of the plane stack's motion.
//
// The reader's look is a point in -1..1 about the tableau's centre, from the
// pointer on fine-pointer devices or from the phone's tilt. Each plane moves
// against the look by its depth: the nearest plane (depth 1) by the full
// 7 px amplitude, the horizon by nothing, which is what makes a flat stack
// read as a place with air in it. The springs that carry the look live in
// PlaneStack; this file has no state so the numbers can be tested cold.
// -----------------------------------------------------------------------------
import { clampUnit, type StageRect } from "./stage-geometry.js";

/** Amplitude at depth 1 (spec section 1: 7 px on `camera` 120/14). */
export const PARALLAX_AMPLITUDE_PX = 7;

/** Degrees of left-right tilt (gamma) that reach the full look on a phone. */
export const TILT_FULL_GAMMA_DEG = 30;
/** Degrees of front-back tilt (beta) away from the resting hold that reach the full look. */
export const TILT_FULL_BETA_DEG = 25;

export interface Look {
  /** -1 (looking left) .. 1 (looking right). */
  readonly lx: number;
  /** -1 (looking up) .. 1 (looking down). */
  readonly ly: number;
}

export const LOOK_AT_REST: Look = { lx: 0, ly: 0 };

export interface ParallaxOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * The px translation of a plane at `depth` for a given look. Planes move
 * against the look: look right and the near bank slides left, as it would
 * past a window. The horizon (depth 0) never moves, so the far skyline is
 * the fixed thing the near things move against.
 */
export function parallaxOffset(depth: number, look: Look): ParallaxOffset {
  const d = depth < 0 ? 0 : depth > 1 ? 1 : depth;
  return {
    x: -clampUnit(look.lx) * PARALLAX_AMPLITUDE_PX * d,
    y: -clampUnit(look.ly) * PARALLAX_AMPLITUDE_PX * d,
  };
}

/** The transform string for a plane wrapper; `translate3d` so it stays on the compositor. */
export function parallaxTransform(offset: ParallaxOffset): string {
  return `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)`;
}

/** A client-space pointer to a look about the tableau's centre; null when the rect has no area. */
export function pointerToLook(clientX: number, clientY: number, rect: StageRect): Look | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    lx: clampUnit(((clientX - rect.left) / rect.width) * 2 - 1),
    ly: clampUnit(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}

/**
 * A DeviceOrientation reading to a look. Gamma is the phone's left-right
 * roll; beta its front-back pitch, taken relative to how the reader was
 * holding it when the scene opened (`restBeta`), because a phone read in bed
 * and a phone read at a table rest at different pitches and both should
 * start looking straight at the port.
 */
export function orientationToLook(gamma: number, beta: number, restBeta: number): Look {
  return {
    lx: clampUnit(gamma / TILT_FULL_GAMMA_DEG),
    ly: clampUnit((beta - restBeta) / TILT_FULL_BETA_DEG),
  };
}

/** Pointer speed in px/s from two samples; 0 when the clock did not advance. */
export function pointerSpeed(dx: number, dy: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  return Math.hypot(dx, dy) / (dtMs / 1000);
}

/**
 * The speed decays between events so a resting pointer reads as still. The
 * factor mirrors useCursorLight's `1 - dt * 6`, clamped so a long frame can
 * never flip the sign.
 */
export function decaySpeed(speed: number, dtSeconds: number): number {
  return speed * Math.max(0, 1 - dtSeconds * 6);
}
