import { toRenderSpace, toRealWorld, GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import type { SpaceDimensions } from "@omnitwin/types";
import { getCatalogueItem } from "./catalogue.js";
import type { CatalogueItem } from "./catalogue.js";

// ---------------------------------------------------------------------------
// Placement — pure functions for furniture drag-and-drop
// ---------------------------------------------------------------------------

/** Grid spacing in real-world metres. Visual grid is 2 render-units apart, labelled "1m". */
export const GRID_SPACING_M = 1;

/** Grid spacing in render-space units. */
export const GRID_SPACING_RENDER = toRenderSpace(GRID_SPACING_M);

/** Placement validity colour — valid position. */
export const PLACEMENT_COLOR_VALID = "#44cc66";

/** Placement validity colour — invalid (out of bounds / collision). */
export const PLACEMENT_COLOR_INVALID = "#ee3333";

/** 3D position tuple [x, y, z]. */
export type Position3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Grid snapping
// ---------------------------------------------------------------------------

/**
 * Snaps a single coordinate to the nearest grid line.
 * Grid lines are spaced at GRID_SPACING_RENDER in render-space.
 */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SPACING_RENDER) * GRID_SPACING_RENDER;
}

/**
 * Snaps an XZ position to the nearest grid point.
 * Y is always 0 (floor level).
 */
export function snapPositionToGrid(x: number, z: number): Position3 {
  return [snapToGrid(x), 0, snapToGrid(z)];
}

// ---------------------------------------------------------------------------
// Bounds checking
// ---------------------------------------------------------------------------

/**
 * Returns true if an item placed at (x, z) in render-space fits within the
 * room bounds. Only requires the item's center to be within the room so
 * furniture (e.g. chairs) can sit flush against walls.
 *
 * @param roomDims - Current render-space room dimensions. Defaults to Grand
 *   Hall for backward compatibility with tests; production callers should
 *   always pass the active room dimensions from useRoomDimensionsStore.
 */
export function isWithinRoomBounds(
  x: number,
  z: number,
  _item: CatalogueItem,
  _rotationY: number = 0,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
): boolean {
  const halfRoomW = roomDims.width / 2;
  const halfRoomL = roomDims.length / 2;

  return (
    x >= -halfRoomW &&
    x <= halfRoomW &&
    z >= -halfRoomL &&
    z <= halfRoomL
  );
}

/**
 * Computes the axis-aligned half-extents of an item's footprint
 * after rotation around the Y axis.
 */
export function computeRotatedFootprint(
  item: CatalogueItem,
  rotationY: number,
): { readonly halfW: number; readonly halfD: number } {
  const renderW = toRenderSpace(item.width);
  const renderD = toRenderSpace(item.depth);
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return {
    halfW: (renderW * cos + renderD * sin) / 2,
    halfD: (renderW * sin + renderD * cos) / 2,
  };
}

// ---------------------------------------------------------------------------
// Platform edge snapping
// ---------------------------------------------------------------------------

/**
 * Snap threshold in render-space — how close an edge must be to trigger snap.
 * Must exceed GRID_SPACING_RENDER / 2 (= 1.0) so that grid-snapped positions
 * can always reach the flush edge alignment. 1.5 gives comfortable margin.
 */
const PLATFORM_SNAP_THRESHOLD = 1.5;

/**
 * Snaps a position so that the dragged item's edges align flush with nearby
 * platform edges. Only activates when both the dragged item and the target
 * are in the "stage" category. Edge alignment is purely XZ — height is
 * computed separately via computeSurfaceHeight.
 *
 * Returns the adjusted (x, z) position.
 */
export function snapToPlatformEdge(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
): { readonly x: number; readonly z: number } {
  if (item.category !== "stage") return { x, z };

  const { halfW: aHalfW, halfD: aHalfD } = computeRotatedFootprint(item, rotationY);

  let snappedX = x;
  let snappedZ = z;
  let bestDistX = PLATFORM_SNAP_THRESHOLD;
  let bestDistZ = PLATFORM_SNAP_THRESHOLD;

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined || otherItem.category !== "stage") continue;

    const { halfW: bHalfW, halfD: bHalfD } = computeRotatedFootprint(otherItem, other.rotationY);

    // Check X-axis edge alignment (right edge to left edge, left edge to right edge)
    const rightToLeft = (other.x - bHalfW) - (x + aHalfW); // gap between my right and their left
    const leftToRight = (x - aHalfW) - (other.x + bHalfW); // gap between their right and my left

    if (Math.abs(rightToLeft) < bestDistX) {
      bestDistX = Math.abs(rightToLeft);
      snappedX = x + rightToLeft; // shift right to close gap
    }
    if (Math.abs(leftToRight) < bestDistX) {
      bestDistX = Math.abs(leftToRight);
      snappedX = x - leftToRight; // shift left to close gap
    }

    // Check Z-axis edge alignment
    const frontToBack = (other.z - bHalfD) - (z + aHalfD);
    const backToFront = (z - aHalfD) - (other.z + bHalfD);

    if (Math.abs(frontToBack) < bestDistZ) {
      bestDistZ = Math.abs(frontToBack);
      snappedZ = z + frontToBack;
    }
    if (Math.abs(backToFront) < bestDistZ) {
      bestDistZ = Math.abs(backToFront);
      snappedZ = z - backToFront;
    }
  }

  return { x: snappedX, z: snappedZ };
}

// ---------------------------------------------------------------------------
// Wall edge snapping — snap items flush against room walls
// ---------------------------------------------------------------------------

/** Wall snap threshold — same as platform edge snap. */
const WALL_SNAP_THRESHOLD = 1.5;

/**
 * Snaps a position so that the item's edge aligns flush with the room wall
 * when close enough. Works for any item category (platforms, tables, etc).
 *
 * @param roomDims - Current render-space room dimensions. Defaults to Grand
 *   Hall for backward compatibility with tests; production callers should
 *   always pass the active room dimensions from useRoomDimensionsStore.
 *
 * Returns the adjusted (x, z) position.
 */
export function snapToWallEdge(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
): { readonly x: number; readonly z: number } {
  const halfRoomW = roomDims.width / 2;
  const halfRoomL = roomDims.length / 2;

  // For round tables with chairs, use the full chair-ring radius as the
  // extent so the outermost chair back sits flush against the wall.
  // Chair depth ~0.45m (render 0.9), gap 0.05m (render 0.1).
  const chairExtent = item.tableShape === "round"
    ? toRenderSpace(0.45 + 0.05) // chair depth + gap beyond table edge
    : 0;
  const { halfW: rawHalfW, halfD: rawHalfD } = computeRotatedFootprint(item, rotationY);
  const halfW = rawHalfW + chairExtent;
  const halfD = rawHalfD + chairExtent;

  let snappedX = x;
  let snappedZ = z;

  // Snap to right wall
  const gapRight = halfRoomW - (x + halfW);
  if (Math.abs(gapRight) < WALL_SNAP_THRESHOLD) {
    snappedX = halfRoomW - halfW;
  }
  // Snap to left wall
  const gapLeft = (x - halfW) - (-halfRoomW);
  if (Math.abs(gapLeft) < WALL_SNAP_THRESHOLD) {
    snappedX = -halfRoomW + halfW;
  }
  // Snap to far wall (positive Z)
  const gapFar = halfRoomL - (z + halfD);
  if (Math.abs(gapFar) < WALL_SNAP_THRESHOLD) {
    snappedZ = halfRoomL - halfD;
  }
  // Snap to near wall (negative Z)
  const gapNear = (z - halfD) - (-halfRoomL);
  if (Math.abs(gapNear) < WALL_SNAP_THRESHOLD) {
    snappedZ = -halfRoomL + halfD;
  }

  return { x: snappedX, z: snappedZ };
}

// ---------------------------------------------------------------------------
// Surface height — find what an item would sit on at a given XZ position
// ---------------------------------------------------------------------------

/**
 * Returns the Y coordinate an item should be placed at, given its XZ position.
 * Checks all placed platforms: if the item's centre is within a platform's
 * footprint, it sits on top of that platform (platform.y + platform.height).
 * Multiple stacked platforms are handled — returns the highest surface.
 *
 * @param x         - Candidate X position (render-space).
 * @param z         - Candidate Z position (render-space).
 * @param placedItems - All currently placed items.
 * @param excludeIds - IDs to skip (e.g. the item being placed/moved).
 * @returns The Y coordinate the item should sit at (0 = floor).
 */
export function computeSurfaceHeight(
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
): number {
  let maxSurface = 0;

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;
    // Items can be placed on stages and tables
    if (otherItem.category !== "stage" && otherItem.category !== "table") continue;

    const { halfW, halfD } = computeRotatedFootprint(otherItem, other.rotationY);

    // Check if the point (x, z) is within this surface's XZ footprint
    if (
      Math.abs(x - other.x) <= halfW &&
      Math.abs(z - other.z) <= halfD
    ) {
      const surfaceY = other.y + otherItem.height;
      if (surfaceY > maxSurface) {
        maxSurface = surfaceY;
      }
    }
  }

  return maxSurface;
}

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

/**
 * Returns true if placing an item at (x, y, z) would overlap any existing
 * placed item. Uses axis-aligned bounding box (AABB) overlap in 3D.
 *
 * Items in the same group (non-null groupId match) are excluded from
 * collision checks — grouped chairs don't collide with their own table.
 *
 * Items at different heights (non-overlapping Y ranges) do NOT collide,
 * enabling stacking platforms and placing furniture on platforms.
 *
 * @param x         - Candidate X position (render-space).
 * @param z         - Candidate Z position (render-space).
 * @param item      - The catalogue item being placed/moved.
 * @param rotationY - Item rotation around Y axis.
 * @param placedItems - All currently placed items.
 * @param excludeIds - IDs to skip (the item being dragged, plus its group).
 * @param padding   - Extra gap between items (render-space, default 0.01).
 *                    Stage items (platforms) use zero padding — they can touch.
 * @param y         - Candidate Y position (default 0 = floor).
 */
export function checkCollision(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
  padding: number = 0.01,
  y: number = 0,
): boolean {
  const { halfW: aHalfW, halfD: aHalfD } = computeRotatedFootprint(item, rotationY);
  const aBottom = y;
  const aTop = y + item.height;

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;

    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;

    // Y-axis overlap check — items at different heights don't collide
    const bBottom = other.y;
    const bTop = other.y + otherItem.height;
    // Use small tolerance (1mm) to allow items sitting flush on surfaces
    if (aBottom >= bTop - 0.001 || bBottom >= aTop - 0.001) continue;

    // Stage items (platforms) can touch/slightly overlap — negative padding
    // provides tolerance for floating point imprecision in edge snapping.
    const effectivePadding = (item.category === "stage" && otherItem.category === "stage") ? -0.05 : padding;

    const { halfW: bHalfW, halfD: bHalfD } = computeRotatedFootprint(otherItem, other.rotationY);

    // AABB overlap test — strict < means touching edges are allowed when padding=0
    const overlapX = Math.abs(x - other.x) < (aHalfW + bHalfW + effectivePadding);
    const overlapZ = Math.abs(z - other.z) < (aHalfD + bHalfD + effectivePadding);

    if (overlapX && overlapZ) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Placed object creation
// ---------------------------------------------------------------------------

/**
 * Generates a UUID for a placed object.
 * Matches the API's z.string().uuid() validation so objects can be
 * persisted without ID translation.
 */
export function generatePlacedId(): string {
  return crypto.randomUUID();
}

/** No-op — UUIDs are globally unique, no counter to reset. Kept for test compat. */
export function resetPlacedIdCounter(): void {
  // no-op
}

/** A furniture item placed in the scene. */
export interface PlacedItem {
  readonly id: string;
  readonly catalogueItemId: string;
  readonly x: number;
  /** Vertical position (floor = 0). Items on platforms sit at platform.y + platform.height. */
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  /** Whether a cloth is draped over this item (tables only). */
  readonly clothed: boolean;
  /** Group ID — items sharing a groupId move together (e.g. table + its chairs). */
  readonly groupId: string | null;
}

/**
 * Creates a PlacedItem from a catalogue item and render-space position.
 */
export function createPlacedItem(
  catalogueItemId: string,
  x: number,
  z: number,
  rotationY: number = 0,
  groupId: string | null = null,
  y: number = 0,
): PlacedItem {
  return {
    id: generatePlacedId(),
    catalogueItemId,
    x,
    y,
    z,
    rotationY,
    clothed: false,
    groupId,
  };
}

/**
 * Collects the IDs of all items in the same group as the given item,
 * including the item itself. Returns a Set for O(1) lookup.
 */
export function getGroupMemberIds(
  itemId: string,
  placedItems: readonly PlacedItem[],
): ReadonlySet<string> {
  const item = placedItems.find((p) => p.id === itemId);
  if (item === undefined || item.groupId === null) return new Set([itemId]);
  const ids = new Set<string>();
  for (const p of placedItems) {
    if (p.groupId === item.groupId) ids.add(p.id);
  }
  return ids;
}

/**
 * Returns the real-world position of a placed item for display purposes.
 * X and Z are converted from render-space to real-world metres.
 */
export function placedItemRealPosition(item: PlacedItem): { readonly x: number; readonly z: number } {
  return {
    x: toRealWorld(item.x),
    z: toRealWorld(item.z),
  };
}
