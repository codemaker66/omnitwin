import { RENDER_SCALE } from "../constants/scale.js";

// ---------------------------------------------------------------------------
// Measurement tool — pure functions
// ---------------------------------------------------------------------------

/** Fire exit minimum clearance in real metres (UK Building Regulations). */
export const FIRE_EXIT_MINIMUM_M = 1.05;

/** Colour for measurements that meet fire exit clearance. */
export const MEASUREMENT_COLOR_OK = "#22cc44";

/** Colour for measurements below fire exit minimum. */
export const MEASUREMENT_COLOR_WARNING = "#ee2222";

/** A 3D point as a tuple. */
export type Point3 = readonly [number, number, number];

/**
 * Computes the Euclidean distance between two 3D points in render space,
 * then converts to real-world metres.
 *
 * X and Z axes are scaled by RENDER_SCALE (floor area inflation).
 * Y axis is NOT scaled (wall height stays at real-world value).
 * We un-scale each axis separately before computing the distance.
 */
export function computeRealDistance(a: Point3, b: Point3): number {
  const dx = (b[0] - a[0]) / RENDER_SCALE; // X scaled
  const dy = b[1] - a[1];                   // Y not scaled
  const dz = (b[2] - a[2]) / RENDER_SCALE; // Z scaled
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes the raw render-space distance between two 3D points.
 * Used for positioning the label midpoint (no scale conversion needed).
 */
export function computeRenderDistance(a: Point3, b: Point3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Formats a distance in metres for display.
 * Shows 2 decimal places (centimetre precision).
 */
export function formatDistance(metres: number): string {
  return `${metres.toFixed(2)}m`;
}

/**
 * Returns true if the distance is below fire exit minimum clearance.
 */
export function isBelowFireExit(metres: number): boolean {
  return metres < FIRE_EXIT_MINIMUM_M;
}

/**
 * Returns the appropriate colour for a measurement based on distance.
 */
export function getMeasurementColor(metres: number): string {
  return isBelowFireExit(metres) ? MEASUREMENT_COLOR_WARNING : MEASUREMENT_COLOR_OK;
}

/**
 * Computes the midpoint between two 3D points (for label positioning).
 */
export function computeMidpoint(a: Point3, b: Point3): Point3 {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];
}
