// ---------------------------------------------------------------------------
// Selection — pure functions for selection, rotation snap, and marquee
// ---------------------------------------------------------------------------

/** Rotation snap increment in radians (15°). */
export const ROTATION_SNAP_RAD = Math.PI / 12;

/** Minimum drag distance (pixels) before a click becomes a drag. Prevents accidental drags. */
export const DRAG_THRESHOLD_PX = 5;

/** Selection highlight colour. */
export const SELECTION_COLOR = "#4499ff";

// ---------------------------------------------------------------------------
// Rotation snapping
// ---------------------------------------------------------------------------

/**
 * Snaps a rotation angle to the nearest increment of ROTATION_SNAP_RAD (15°).
 * If `freeRotate` is true, returns the angle unchanged (Shift override).
 */
export function snapRotation(radians: number, freeRotate: boolean = false): number {
  if (freeRotate) return radians;
  return Math.round(radians / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
}

/**
 * Normalises an angle to the range [0, 2π).
 */
export function normaliseAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  const result = radians % twoPi;
  return result < 0 ? result + twoPi : result;
}

// ---------------------------------------------------------------------------
// Marquee rectangle
// ---------------------------------------------------------------------------

/** A 2D screen-space rectangle. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Computes the bounding rectangle from two screen-space corners.
 * Handles any drag direction (top-left to bottom-right, bottom-right to top-left, etc.).
 */
export function computeMarqueeRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): ScreenRect {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/**
 * Returns true if a screen-space point is inside a ScreenRect.
 */
export function isPointInRect(
  px: number,
  py: number,
  rect: ScreenRect,
): boolean {
  return (
    px >= rect.left &&
    px <= rect.left + rect.width &&
    py >= rect.top &&
    py <= rect.top + rect.height
  );
}

/**
 * Computes the Euclidean distance between two screen-space points.
 * Used to check if a pointer move exceeds DRAG_THRESHOLD_PX.
 */
export function screenDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
