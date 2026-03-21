import { toRealWorld, GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import type { Point3 } from "./measurement.js";

// ---------------------------------------------------------------------------
// Tape measure guidelines — pure functions
// ---------------------------------------------------------------------------

/** Guideline colour — subtle blue, architectural drafting feel. */
export const GUIDELINE_COLOR = "#5080b0";

/** Guideline colour when hovered or selected for deletion. */
export const GUIDELINE_COLOR_HOVER = "#ee4444";

/** Dash pattern: [dash length, gap length] in render-space metres. */
export const GUIDELINE_DASH = 0.3;
export const GUIDELINE_GAP = 0.15;

/** Small Y offset above the floor to avoid z-fighting with grid. */
export const GUIDELINE_Y = 0.005;

/** Wall axis identifiers. */
export type WallAxis = "x" | "z";

/** Which wall was clicked: front/back are Z-aligned, left/right are X-aligned. */
export interface WallHit {
  /** Which axis the guideline runs along (perpendicular to the wall). */
  readonly axis: WallAxis;
  /** The coordinate along the guideline axis where the wall was clicked. */
  readonly position: number;
  /** The fixed coordinate on the wall's own axis. */
  readonly wallCoord: number;
}

/** A persisted guideline across the floor. */
export interface GuidelineData {
  readonly id: number;
  /** Axis the guideline runs along. "x" = horizontal line at fixed Z, "z" = vertical line at fixed X. */
  readonly axis: WallAxis;
  /** The fixed coordinate (X for axis="z", Z for axis="x"). */
  readonly fixedCoord: number;
  /** Real-world distance from the wall to its opposite wall at this guideline. */
  readonly realDistance: number;
  /** Start point in render space [x, y, z]. */
  readonly start: Point3;
  /** End point in render space [x, y, z]. */
  readonly end: Point3;
}

// ---------------------------------------------------------------------------
// Wall detection
// ---------------------------------------------------------------------------

/**
 * Determines which wall a hit point belongs to, based on proximity to room edges.
 * Returns null if the hit point is not close enough to any wall (e.g. floor/ceiling hit).
 *
 * The threshold for "close to a wall" is generous (1.5m render space) to allow
 * clicking on the wall surface even at oblique angles.
 */
export function detectWallHit(
  hitPoint: Point3,
  hitObjectName: string,
): WallHit | null {
  // Only trigger on wall surfaces
  if (!hitObjectName.startsWith("wall-") && !hitObjectName.startsWith("wainscot-")) {
    return null;
  }

  const x = hitPoint[0];
  const z = hitPoint[2];

  // Determine which wall based on object name
  const wallName = hitObjectName.replace("wainscot-", "wall-");

  switch (wallName) {
    case "wall-left":
      // Left wall at x = -halfWidth. Guideline runs along X axis at fixed Z.
      return { axis: "x", position: x, wallCoord: z };
    case "wall-right":
      // Right wall at x = +halfWidth. Guideline runs along X axis at fixed Z.
      return { axis: "x", position: x, wallCoord: z };
    case "wall-back":
      // Back wall at z = -halfLength. Guideline runs along Z axis at fixed X.
      return { axis: "z", position: z, wallCoord: x };
    case "wall-front":
      // Front wall at z = +halfLength. Guideline runs along Z axis at fixed X.
      return { axis: "z", position: z, wallCoord: x };
    default:
      return null;
  }
}

/**
 * Computes a floor guideline from a wall hit.
 *
 * The guideline runs perpendicular to the wall, across the full width/length
 * of the room, at the Z (or X) coordinate where the user clicked.
 */
export function computeGuideline(
  wallHit: WallHit,
  id: number,
): GuidelineData {
  const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
  const halfWidth = width / 2;
  const halfLength = length / 2;

  if (wallHit.axis === "x") {
    // Line runs along X from -halfWidth to +halfWidth, at fixed Z = wallCoord
    const start: Point3 = [-halfWidth, GUIDELINE_Y, wallHit.wallCoord];
    const end: Point3 = [halfWidth, GUIDELINE_Y, wallHit.wallCoord];
    const realDistance = toRealWorld(width);
    return { id, axis: "x", fixedCoord: wallHit.wallCoord, realDistance, start, end };
  }

  // Line runs along Z from -halfLength to +halfLength, at fixed X = wallCoord
  const start: Point3 = [wallHit.wallCoord, GUIDELINE_Y, -halfLength];
  const end: Point3 = [wallHit.wallCoord, GUIDELINE_Y, halfLength];
  const realDistance = toRealWorld(length);
  return { id, axis: "z", fixedCoord: wallHit.wallCoord, realDistance, start, end };
}

/**
 * Computes the real-world offset from a wall edge to the guideline position.
 *
 * For left/right walls (axis="x"): distance from the nearest X wall edge.
 * For front/back walls (axis="z"): distance from the nearest Z wall edge.
 */
export function computeWallOffset(wallHit: WallHit): number {
  const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
  const halfWidth = width / 2;
  const halfLength = length / 2;

  if (wallHit.axis === "x") {
    // Distance from nearest X edge to the hit Z coordinate → actually, the
    // guideline is at wallHit.wallCoord on Z axis. Offset from nearest Z wall.
    const distFromBack = wallHit.wallCoord + halfLength;
    const distFromFront = halfLength - wallHit.wallCoord;
    return toRealWorld(Math.min(distFromBack, distFromFront));
  }

  // Guideline at wallHit.wallCoord on X axis. Offset from nearest X wall.
  const distFromLeft = wallHit.wallCoord + halfWidth;
  const distFromRight = halfWidth - wallHit.wallCoord;
  return toRealWorld(Math.min(distFromLeft, distFromRight));
}

/**
 * Formats a guideline label showing the room-spanning distance.
 */
export function formatGuidelineLabel(realDistance: number): string {
  return `${realDistance.toFixed(2)}m`;
}
