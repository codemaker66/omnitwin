import { GRAND_HALL_RENDER_DIMENSIONS, toRealWorld } from "../constants/scale.js";

// ---------------------------------------------------------------------------
// Section Box — pure functions for 6-sided clipping
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounding box defined by min/max on each axis.
 * All values are in render-space metres.
 */
export interface BoxBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Which face of the section box. */
export type BoxFace = "minX" | "maxX" | "minY" | "maxY" | "minZ" | "maxZ";

/** All six faces. */
export const BOX_FACES: readonly BoxFace[] = [
  "minX", "maxX", "minY", "maxY", "minZ", "maxZ",
] as const;

/** Minimum size of the box on any axis (render-space metres). Prevents collapsing to zero. */
export const MIN_BOX_EXTENT = 0.5;

/**
 * Returns the full room bounds (section box fully open = no clipping visible).
 */
export function getFullRoomBounds(): BoxBounds {
  const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
  return {
    minX: -width / 2,
    maxX: width / 2,
    minY: 0,
    maxY: height,
    minZ: -length / 2,
    maxZ: length / 2,
  };
}

/**
 * Clamps a proposed box bound value to valid range, ensuring the box
 * never inverts (min > max) and maintains MIN_BOX_EXTENT.
 */
export function clampBoxFace(
  face: BoxFace,
  value: number,
  current: BoxBounds,
): number {
  const room = getFullRoomBounds();

  switch (face) {
    case "minX":
      return Math.max(room.minX, Math.min(value, current.maxX - MIN_BOX_EXTENT));
    case "maxX":
      return Math.min(room.maxX, Math.max(value, current.minX + MIN_BOX_EXTENT));
    case "minY":
      return Math.max(room.minY, Math.min(value, current.maxY - MIN_BOX_EXTENT));
    case "maxY":
      return Math.min(room.maxY, Math.max(value, current.minY + MIN_BOX_EXTENT));
    case "minZ":
      return Math.max(room.minZ, Math.min(value, current.maxZ - MIN_BOX_EXTENT));
    case "maxZ":
      return Math.min(room.maxZ, Math.max(value, current.minZ + MIN_BOX_EXTENT));
  }
}

/**
 * Converts a box face value from render-space to real-world metres for display.
 */
export function boxValueToReal(face: BoxFace, value: number): number {
  // Y axis is not scaled
  if (face === "minY" || face === "maxY") return value;
  // X and Z axes are scaled
  return toRealWorld(value);
}

/**
 * Converts a face value to a slider percentage (0–100) within its valid range.
 */
export function faceToPercent(face: BoxFace, value: number): number {
  const room = getFullRoomBounds();
  let min: number;
  let max: number;

  switch (face) {
    case "minX": case "maxX":
      min = room.minX; max = room.maxX; break;
    case "minY": case "maxY":
      min = room.minY; max = room.maxY; break;
    case "minZ": case "maxZ":
      min = room.minZ; max = room.maxZ; break;
  }

  if (max === min) return 0;
  return ((value - min) / (max - min)) * 100;
}

/**
 * Converts a slider percentage (0–100) back to a face value in render-space.
 */
export function percentToFace(face: BoxFace, percent: number): number {
  const room = getFullRoomBounds();
  let min: number;
  let max: number;

  switch (face) {
    case "minX": case "maxX":
      min = room.minX; max = room.maxX; break;
    case "minY": case "maxY":
      min = room.minY; max = room.maxY; break;
    case "minZ": case "maxZ":
      min = room.minZ; max = room.maxZ; break;
  }

  return min + (percent / 100) * (max - min);
}

/**
 * Human-readable label for each box face.
 */
export function faceLabel(face: BoxFace): string {
  switch (face) {
    case "minX": return "Left";
    case "maxX": return "Right";
    case "minY": return "Bottom";
    case "maxY": return "Top";
    case "minZ": return "Back";
    case "maxZ": return "Front";
  }
}
