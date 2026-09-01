// ---------------------------------------------------------------------------
// Planner tools — the pure model behind the tool pill.
//
// Five explicit hands: Select, Move, Rotate, Scale, Measure. Select and Move
// share drag semantics (direct manipulation is the point — a separate Move
// tool exists so the intent can be declared, not because dragging should ever
// stop working in Select). Rotate and Scale turn what used to be
// keyboard-only (Q/E) or entirely absent into drags around the object's own
// centre. Measure is the existing two-click tape, promoted into the pill.
//
// Everything here is geometry and formatting — no store reads, no React —
// so the drag maths and the readout strings are testable to the millimetre.
// ---------------------------------------------------------------------------

import { snapRotation } from "./selection.js";

export type PlannerTool = "select" | "move" | "rotate" | "scale" | "measure";

export interface PlannerToolMeta {
  readonly id: PlannerTool;
  readonly label: string;
  /** One-line tooltip. Mentions a key only where a real binding exists. */
  readonly hint: string;
}

/**
 * Pill order. No new letter shortcuts: digits jump to bookmarks, WASD pans
 * the camera, Q/E nudge rotation — the planner's keyboard is already spoken
 * for. M (measure) and Escape (back to Select) are the only bindings, both
 * pre-existing behaviours routed through the tool store.
 */
export const PLANNER_TOOLS: readonly PlannerToolMeta[] = [
  { id: "select", label: "Select", hint: "Select — click, shift-click, or drag a box" },
  { id: "move", label: "Move", hint: "Move — drag furniture; settles onto the grid" },
  { id: "rotate", label: "Rotate", hint: "Rotate — drag around the piece; 15° steps, Shift for free" },
  { id: "scale", label: "Scale", hint: "Scale — drag outward from the centre; Shift for free" },
  { id: "measure", label: "Measure", hint: "Measure — two clicks lay a tape in metres (M)" },
] as const;

// ---------------------------------------------------------------------------
// Rotate-by-drag
// ---------------------------------------------------------------------------

export interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

/** Inside this radius of the centre the pointer angle is numerically garbage. */
const DEGENERATE_RADIUS_M = 0.12;

/** Pointer angle around a centre, matching three.js rotationY convention
 *  (positive = counter-clockwise seen from above, zero facing +Z). */
function angleAround(centre: FloorPoint, p: FloorPoint): number {
  return Math.atan2(p.x - centre.x, p.z - centre.z);
}

/**
 * Rotation for the current drag frame: the angular delta the pointer has
 * swept around the object's centre, applied to the rotation the object had
 * when grabbed. Snaps to 15° unless `free` (Shift). Degenerate grabs — the
 * pointer at the centre of the object — return the initial rotation rather
 * than a random angle.
 */
export function rotationFromDrag(
  centre: FloorPoint,
  grab: FloorPoint,
  current: FloorPoint,
  initialRotation: number,
  free: boolean = false,
): number {
  const grabDist = Math.hypot(grab.x - centre.x, grab.z - centre.z);
  const currentDist = Math.hypot(current.x - centre.x, current.z - centre.z);
  if (grabDist < DEGENERATE_RADIUS_M || currentDist < DEGENERATE_RADIUS_M) {
    return initialRotation;
  }
  const delta = angleAround(centre, current) - angleAround(centre, grab);
  return snapRotation(initialRotation + delta, free);
}

// ---------------------------------------------------------------------------
// Scale-by-drag
// ---------------------------------------------------------------------------

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;
export const SCALE_SNAP_STEP = 0.05;

export function clampScale(scale: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
}

/**
 * Uniform scale for the current drag frame: the ratio of the pointer's
 * distance from the centre now versus at grab, applied to the scale the
 * object had when grabbed. Snaps to 5% steps unless `free` (Shift); always
 * clamped to the range the footprint engine can stand behind.
 */
export function scaleFromDrag(
  centre: FloorPoint,
  grab: FloorPoint,
  current: FloorPoint,
  initialScale: number,
  free: boolean = false,
): number {
  const grabDist = Math.hypot(grab.x - centre.x, grab.z - centre.z);
  if (grabDist < DEGENERATE_RADIUS_M) return clampScale(initialScale);
  const currentDist = Math.hypot(current.x - centre.x, current.z - centre.z);
  const raw = initialScale * (currentDist / grabDist);
  const snapped = free ? raw : Math.round(raw / SCALE_SNAP_STEP) * SCALE_SNAP_STEP;
  return clampScale(snapped);
}

// ---------------------------------------------------------------------------
// Scrubbing — dragging the value chip itself.
//
// The drag gestures snap coarsely (15°, 5%) because snapping during direct
// manipulation reads as decisiveness. The scrub is the fine instrument: 1°
// and 1% steps, a Figma/Blender-style horizontal drag on the number.
// ---------------------------------------------------------------------------

/** Degrees per horizontal pixel while scrubbing the rotation readout. */
const SCRUB_DEG_PER_PX = 0.5;
/** Scale units per horizontal pixel while scrubbing the scale readout. */
const SCRUB_SCALE_PER_PX = 0.005;

export function scrubRotation(initialRotation: number, dxPx: number): number {
  const deltaRad = (dxPx * SCRUB_DEG_PER_PX * Math.PI) / 180;
  const raw = initialRotation + deltaRad;
  // 1° steps: fine enough to feel continuous, coarse enough to land on
  // numbers a human would write down.
  const step = Math.PI / 180;
  return Math.round(raw / step) * step;
}

export function scrubScale(initialScale: number, dxPx: number): number {
  const raw = initialScale + dxPx * SCRUB_SCALE_PER_PX;
  return clampScale(Math.round(raw * 100) / 100);
}

// ---------------------------------------------------------------------------
// Readout formatting — tabular, metric.
// ---------------------------------------------------------------------------

/** "135°" — normalised to [0°, 360°), integer degrees. */
export function formatDegrees(radians: number): string {
  const deg = (radians * 180) / Math.PI;
  const normalised = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(normalised)}°`;
}

/** "×1.25" — two decimals, always signed as a multiplier. */
export function formatScale(scale: number): string {
  return `×${scale.toFixed(2)}`;
}

/** "3.20 m" — two decimals, metres. */
export function formatMetres(metres: number): string {
  return `${metres.toFixed(2)} m`;
}
