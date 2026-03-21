import { computeRotatedFootprint } from "./placement.js";
import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// Snap alignment guides — pure functions
// ---------------------------------------------------------------------------
// Computes temporary alignment lines that appear when dragging/placing
// furniture near other items. Shows center-to-center and edge-to-edge
// alignment like PowerPoint/Figma smart guides.
// ---------------------------------------------------------------------------

/** Proximity threshold (render-space) to trigger a snap guide. */
export const SNAP_GUIDE_THRESHOLD = 0.3;

/** Guide colour — orange, distinct from blue tape-measure guidelines. */
export const SNAP_GUIDE_COLOR = "#ff8800";

/** Y offset above floor — slightly above tape-measure guidelines (0.005). */
export const SNAP_GUIDE_Y = 0.006;

/** Dash pattern for the guide lines. */
export const SNAP_GUIDE_DASH = 0.2;
export const SNAP_GUIDE_GAP = 0.1;

/** Margin to extend lines past item edges for visual clarity. */
const LINE_MARGIN = 0.5;

/** Which axis the guide line runs along. */
export type SnapAxis = "x" | "z";

/** Whether the alignment is center-to-center or edge-to-edge. */
export type SnapKind = "center" | "edge";

/** A single active snap guide line rendered on the floor. */
export interface SnapGuide {
  /** Axis the guide line runs along: "x" = horizontal, "z" = vertical. */
  readonly axis: SnapAxis;
  /** What type of alignment this represents. */
  readonly kind: SnapKind;
  /** The fixed coordinate where alignment occurs (X for axis="z", Z for axis="x"). */
  readonly coord: number;
  /** Start of the line segment along the running axis. */
  readonly start: number;
  /** End of the line segment along the running axis. */
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Computes snap alignment guides for an item being dragged/placed.
 *
 * Checks center-to-center and edge-to-edge alignment against all placed
 * items (excluding those in `excludeIds`). Returns an array of guide lines.
 */
export function computeSnapGuides(
  dragX: number,
  dragZ: number,
  dragItemId: string,
  dragRotationY: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
): readonly SnapGuide[] {
  const dragItem = getCatalogueItem(dragItemId);
  if (dragItem === undefined) return [];

  const { halfW: dHalfW, halfD: dHalfD } = computeRotatedFootprint(dragItem, dragRotationY);

  // Dragged item's key coordinates
  const dLeftX = dragX - dHalfW;
  const dRightX = dragX + dHalfW;
  const dBackZ = dragZ - dHalfD;
  const dFrontZ = dragZ + dHalfD;

  const raw: SnapGuide[] = [];

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;

    const { halfW: oHalfW, halfD: oHalfD } = computeRotatedFootprint(otherItem, other.rotationY);

    const oLeftX = other.x - oHalfW;
    const oRightX = other.x + oHalfW;
    const oBackZ = other.z - oHalfD;
    const oFrontZ = other.z + oHalfD;

    // Z-axis range for X-aligned guides (line runs along Z connecting the two items)
    const zMin = Math.min(dragZ, other.z) - LINE_MARGIN;
    const zMax = Math.max(dragZ, other.z) + LINE_MARGIN;

    // X-axis range for Z-aligned guides (line runs along X connecting the two items)
    const xMin = Math.min(dragX, other.x) - LINE_MARGIN;
    const xMax = Math.max(dragX, other.x) + LINE_MARGIN;

    // --- X-coordinate alignment (guide line runs along Z at fixed X) ---

    // Center-center X
    if (Math.abs(dragX - other.x) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "z", kind: "center", coord: other.x, start: zMin, end: zMax });
    }
    // Left-left edge
    if (Math.abs(dLeftX - oLeftX) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "z", kind: "edge", coord: oLeftX, start: zMin, end: zMax });
    }
    // Right-right edge
    if (Math.abs(dRightX - oRightX) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "z", kind: "edge", coord: oRightX, start: zMin, end: zMax });
    }
    // Left-right edge
    if (Math.abs(dLeftX - oRightX) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "z", kind: "edge", coord: oRightX, start: zMin, end: zMax });
    }
    // Right-left edge
    if (Math.abs(dRightX - oLeftX) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "z", kind: "edge", coord: oLeftX, start: zMin, end: zMax });
    }

    // --- Z-coordinate alignment (guide line runs along X at fixed Z) ---

    // Center-center Z
    if (Math.abs(dragZ - other.z) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "x", kind: "center", coord: other.z, start: xMin, end: xMax });
    }
    // Back-back edge
    if (Math.abs(dBackZ - oBackZ) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "x", kind: "edge", coord: oBackZ, start: xMin, end: xMax });
    }
    // Front-front edge
    if (Math.abs(dFrontZ - oFrontZ) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "x", kind: "edge", coord: oFrontZ, start: xMin, end: xMax });
    }
    // Back-front edge
    if (Math.abs(dBackZ - oFrontZ) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "x", kind: "edge", coord: oFrontZ, start: xMin, end: xMax });
    }
    // Front-back edge
    if (Math.abs(dFrontZ - oBackZ) < SNAP_GUIDE_THRESHOLD) {
      raw.push({ axis: "x", kind: "edge", coord: oBackZ, start: xMin, end: xMax });
    }
  }

  return deduplicateGuides(raw);
}

// ---------------------------------------------------------------------------
// Deduplication — merge guides at the same coordinate
// ---------------------------------------------------------------------------

/** Epsilon for treating two coordinates as the same guide. */
const DEDUP_EPSILON = 0.05;

/**
 * Merges guides that share the same axis and coord (within epsilon)
 * by extending the line to cover the union range.
 */
export function deduplicateGuides(guides: readonly SnapGuide[]): readonly SnapGuide[] {
  if (guides.length <= 1) return guides;

  const merged: SnapGuide[] = [];

  for (const g of guides) {
    let found = false;
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (m !== undefined && m.axis === g.axis && Math.abs(m.coord - g.coord) < DEDUP_EPSILON) {
        merged[i] = {
          axis: m.axis,
          kind: m.kind === "center" || g.kind === "center" ? "center" : "edge",
          coord: m.coord,
          start: Math.min(m.start, g.start),
          end: Math.max(m.end, g.end),
        };
        found = true;
        break;
      }
    }
    if (!found) {
      merged.push({ ...g });
    }
  }

  return merged;
}
