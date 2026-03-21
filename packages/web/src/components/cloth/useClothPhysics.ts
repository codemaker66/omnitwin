// ---------------------------------------------------------------------------
// useClothPhysics — pure computation functions for cloth vertex displacement
// ---------------------------------------------------------------------------
// Tracks cursor velocity, computes displacement intensity, rotation speed.
// All functions are pure and testable without React or Three.js.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Smoothing factor for velocity EMA (0 = no smoothing, 1 = frozen). */
export const VELOCITY_SMOOTHING = 0.85;

/** How quickly displacement intensity ramps up with speed. */
const DISPLACEMENT_RAMP = 0.3;

/** Maximum displacement intensity (0-1). */
const MAX_DISPLACEMENT = 1.0;

/** How quickly displacement decays when cursor stops (units/sec). */
const DISPLACEMENT_DECAY = 3.0;

/** How quickly displacement grows when cursor moves (units/sec). */
const DISPLACEMENT_GROW = 5.0;

/** Base Y-axis rotation speed in rad/sec. */
const BASE_ROTATION_SPEED = 0.2;

/** Extra rotation speed per unit of cursor speed. */
const VELOCITY_ROTATION_FACTOR = 0.15;

/** Default hover height in render units (cursor attachment point). */
export const CLOTH_HOVER_HEIGHT = 3.0;

/** How far edges hang below center (catenary sag) in render units. */
export const CLOTH_EDGE_SAG = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClothPhysicsState {
  /** Smoothed world-space velocity [x, y, z]. */
  readonly velocity: readonly [number, number, number];
  /** Speed magnitude (length of velocity vector). */
  readonly speed: number;
  /** Displacement intensity 0-1, drives wave amplitude. */
  readonly displacement: number;
  /** Current Y-axis rotation in radians. */
  readonly rotationY: number;
  /** Accumulated time for wave animation (seconds). */
  readonly time: number;
}

// ---------------------------------------------------------------------------
// Pure computation functions
// ---------------------------------------------------------------------------

/**
 * Compute smoothed velocity from position delta.
 * Uses exponential moving average: new = old * s + raw * (1 - s).
 */
export function computeSmoothedVelocity(
  prevVelocity: readonly [number, number, number],
  rawVelocity: readonly [number, number, number],
  smoothing: number,
): [number, number, number] {
  const inv = 1 - smoothing;
  return [
    prevVelocity[0] * smoothing + rawVelocity[0] * inv,
    prevVelocity[1] * smoothing + rawVelocity[1] * inv,
    prevVelocity[2] * smoothing + rawVelocity[2] * inv,
  ];
}

/**
 * Compute the Euclidean length of a 3D vector.
 */
export function vectorLength(v: readonly [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Update displacement intensity based on current speed.
 * Grows quickly when moving, decays smoothly when stopped.
 */
export function updateDisplacement(
  current: number,
  speed: number,
  dt: number,
): number {
  const target = Math.min(speed * DISPLACEMENT_RAMP, MAX_DISPLACEMENT);
  if (target > current) {
    return Math.min(current + DISPLACEMENT_GROW * dt, target);
  }
  return Math.max(current - DISPLACEMENT_DECAY * dt, target);
}

/**
 * Update Y-axis rotation: base rate + velocity bonus.
 */
export function updateRotation(
  current: number,
  speed: number,
  dt: number,
): number {
  const rate = BASE_ROTATION_SPEED + speed * VELOCITY_ROTATION_FACTOR;
  return current + rate * dt;
}

/**
 * Compute catenary-like drape height for a vertex at a given
 * normalized distance from center (0 = center, 1 = edge).
 *
 * Center sits at hoverHeight, edges sag down by sagAmount.
 * Uses quadratic approximation of catenary: y = h - sag * r^2.
 */
export function computeDrapeHeight(
  normalizedRadius: number,
  hoverHeight: number,
  sagAmount: number,
): number {
  const r = Math.min(Math.max(normalizedRadius, 0), 1);
  return hoverHeight - sagAmount * r * r;
}

/**
 * Compute wave displacement for a single vertex.
 *
 * Three superimposed waves create natural-looking fabric ripple:
 * 1. Primary: radiates outward from center (the main billow)
 * 2. Secondary: angular ripple (fabric fold lines)
 * 3. Tertiary: velocity-driven turbulence (fast-move chaos)
 *
 * Edges ripple more than center (the "held from middle" effect).
 */
export function computeWaveDisplacement(
  normalizedRadius: number,
  angle: number,
  time: number,
  displacement: number,
  speed: number,
): number {
  if (displacement < 0.001) return 0;

  // Primary wave: radiates outward from center
  const primaryAmp = 0.15 * displacement;
  const primary = Math.sin(normalizedRadius * 3.0 * Math.PI - time * 4.0) * primaryAmp;

  // Secondary wave: angular ripple (fabric folds)
  const secondaryAmp = 0.08 * displacement;
  const secondary = Math.sin(angle * 5.0 + time * 2.0) * secondaryAmp * normalizedRadius;

  // Tertiary: velocity-driven turbulence
  const turbAmp = 0.06 * Math.min(speed * 0.2, 1.0) * displacement;
  const turbulence = Math.sin(normalizedRadius * 7.0 - time * 6.0 + angle * 3.0) * turbAmp;

  // Edges ripple more than center (quadratic edge factor)
  const edgeFactor = normalizedRadius * normalizedRadius;

  return (primary + secondary + turbulence) * (0.3 + 0.7 * edgeFactor);
}
