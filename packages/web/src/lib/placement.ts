import { toRenderSpace, toRealWorld, GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import type { LayoutSnapshotAssetDefinition, SpaceDimensions } from "@omnitwin/types";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import { DEFAULT_PLANNER_CHAIR_SLUG } from "./furniture-defaults.js";
import type { CatalogueItem } from "./catalogue.js";
import { normalizeFurnitureScale } from "./furniture-scale.js";
import {
  canRestOnFurnitureSurface,
  isDiningTableItem,
} from "./furniture-semantics.js";
import {
  isSceneFurniturePlacement,
  isTableDressingApplicatorSlug,
} from "./table-dressing.js";

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
 * Computes the axis-aligned half-extents of an item's footprint
 * after rotation around the Y axis.
 */
export function computeRotatedFootprint(
  item: CatalogueItem,
  rotationY: number,
  scale?: number,
): { readonly halfW: number; readonly halfD: number } {
  const resolvedScale = normalizeFurnitureScale(scale);
  const renderW = toRenderSpace(item.width) * resolvedScale;
  const renderD = toRenderSpace(item.depth) * resolvedScale;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return {
    halfW: (renderW * cos + renderD * sin) / 2,
    halfD: (renderW * sin + renderD * cos) / 2,
  };
}

function scaledFurnitureHeight(
  item: Pick<CatalogueItem, "height">,
  scale?: number,
): number {
  return item.height * normalizeFurnitureScale(scale);
}

function furnitureVerticalInterval(
  item: Pick<CatalogueItem, "height">,
  y: number,
  scale?: number,
): { readonly bottom: number; readonly top: number } {
  return {
    bottom: y,
    top: y + scaledFurnitureHeight(item, scale),
  };
}

/**
 * Returns true if an item placed at (x, z) in render-space fits within the
 * room bounds using its rotated footprint, not only its centre point.
 *
 * @param roomDims - Current render-space room dimensions. Defaults to Grand
 *   Hall for backward compatibility with tests; production callers should
 *   always pass the active room dimensions from useRoomDimensionsStore.
 */
export function isWithinRoomBounds(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number = 0,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
  scale?: number,
): boolean {
  const halfRoomW = roomDims.width / 2;
  const halfRoomL = roomDims.length / 2;
  const { halfW, halfD } = computeRotatedFootprint(item, rotationY, scale);

  return (
    x - halfW >= -halfRoomW &&
    x + halfW <= halfRoomW &&
    z - halfD >= -halfRoomL &&
    z + halfD <= halfRoomL
  );
}

export type PlacementViolationKind = "outside_room" | "overlap";

export interface PlacementViolation {
  readonly kind: PlacementViolationKind;
  readonly message: string;
  readonly itemId?: string;
}

export type TableClothStyle = "black" | "white";
export type TableSettingStyle = "dinner";

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
  scale?: number,
): { readonly x: number; readonly z: number } {
  if (item.category !== "stage") return { x, z };

  const { halfW: aHalfW, halfD: aHalfD } = computeRotatedFootprint(item, rotationY, scale);

  let snappedX = x;
  let snappedZ = z;
  let bestDistX = PLATFORM_SNAP_THRESHOLD;
  let bestDistZ = PLATFORM_SNAP_THRESHOLD;

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined || otherItem.category !== "stage") continue;

    const { halfW: bHalfW, halfD: bHalfD } = computeRotatedFootprint(
      otherItem,
      other.rotationY,
      other.scale,
    );

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
  scale?: number,
  chairFootprint: Pick<CatalogueItem, "width" | "depth"> | undefined = getCatalogueItemBySlug(DEFAULT_PLANNER_CHAIR_SLUG),
): { readonly x: number; readonly z: number } {
  const halfRoomW = roomDims.width / 2;
  const halfRoomL = roomDims.length / 2;

  // Include rotated chair corners, not just the centre of each outer back.
  // Existing groups pass their largest scaled chair width and depth.
  const reserveChairs = isDiningTableItem(item) && item.tableShape === "round";
  const chairExtent = reserveChairs ? toRenderSpace((chairFootprint?.depth ?? 0) + 0.05) : 0;
  const chairHalfWidth = reserveChairs ? toRenderSpace(chairFootprint?.width ?? 0) / 2 : 0;
  const { halfW: rawHalfW, halfD: rawHalfD } = computeRotatedFootprint(item, rotationY, scale);
  const halfW = Math.hypot(rawHalfW + chairExtent, chairHalfWidth);
  const halfD = Math.hypot(rawHalfD + chairExtent, chairHalfWidth);

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
 * Checks candidate-compatible support surfaces under the candidate's centre.
 * Stages support floor equipment and stage stacking; tables support only
 * explicitly table-mountable AV. Returns the highest compatible surface.
 *
 * @param x         - Candidate X position (render-space).
 * @param z         - Candidate Z position (render-space).
 * @param candidate - Catalogue item being placed or moved.
 * @param placedItems - All currently placed items.
 * @param excludeIds - IDs to skip (e.g. the item being placed/moved).
 * @returns The Y coordinate the item should sit at (0 = floor).
 */
export function computeSurfaceHeight(
  x: number,
  z: number,
  candidate: CatalogueItem,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
): number {
  if (isTableDressingApplicatorSlug(candidate.slug)) return 0;
  let maxSurface = 0;

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    if (!isSceneFurniturePlacement(other)) continue;
    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;
    if (!canRestOnFurnitureSurface(candidate, otherItem)) continue;

    const { halfW, halfD } = computeRotatedFootprint(otherItem, other.rotationY, other.scale);

    // Check if the point (x, z) is within this surface's XZ footprint
    if (
      Math.abs(x - other.x) <= halfW &&
      Math.abs(z - other.z) <= halfD
    ) {
      const surfaceY = other.y + scaledFurnitureHeight(otherItem, other.scale);
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
  scale?: number,
): boolean {
  if (isTableDressingApplicatorSlug(item.slug)) return false;
  const { halfW: aHalfW, halfD: aHalfD } = computeRotatedFootprint(item, rotationY, scale);
  const { bottom: aBottom, top: aTop } = furnitureVerticalInterval(item, y, scale);

  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    if (!isSceneFurniturePlacement(other)) continue;

    const otherItem = getCatalogueItem(other.catalogueItemId);
    if (otherItem === undefined) continue;

    // Y-axis overlap check — items at different heights don't collide
    const { bottom: bBottom, top: bTop } = furnitureVerticalInterval(
      otherItem,
      other.y,
      other.scale,
    );
    // Use small tolerance (1mm) to allow items sitting flush on surfaces
    if (aBottom >= bTop - 0.001 || bBottom >= aTop - 0.001) continue;

    // Stage items (platforms) can touch/slightly overlap — negative padding
    // provides tolerance for floating point imprecision in edge snapping.
    const effectivePadding = (item.category === "stage" && otherItem.category === "stage") ? -0.05 : padding;

    const { halfW: bHalfW, halfD: bHalfD } = computeRotatedFootprint(
      otherItem,
      other.rotationY,
      other.scale,
    );

    // AABB overlap test — strict < means touching edges are allowed when padding=0
    const overlapX = Math.abs(x - other.x) < (aHalfW + bHalfW + effectivePadding);
    const overlapZ = Math.abs(z - other.z) < (aHalfD + bHalfD + effectivePadding);

    if (overlapX && overlapZ) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Placement violations — room bounds plus the overlap rule
// ---------------------------------------------------------------------------

/**
 * One item's planning geometry at one pose: its centre, rotated X/Z
 * half-extents (computeRotatedFootprint) and scaled vertical interval.
 * Resolving it once per item lets a layout-wide sweep compare pairs without
 * recomputing trigonometry for every pair.
 */
export interface PlacementBody {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
  readonly bottom: number;
  readonly top: number;
  /** Stage items (platforms) may touch and slightly overlap each other. */
  readonly stage: boolean;
}

export function placementBody(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  y: number,
  scale?: number,
): PlacementBody {
  const { halfW, halfD } = computeRotatedFootprint(item, rotationY, scale);
  const { bottom, top } = furnitureVerticalInterval(item, y, scale);
  return { x, z, halfW, halfD, bottom, top, stage: item.category === "stage" };
}

/**
 * The overlap rule of the placement violations: does candidate `a` overlap
 * placed item `b`? getPlacementViolations and the layout-wide sweep
 * (createPlacementOverlapIndex) both decide overlaps here and nowhere else.
 */
export function placementBodiesOverlap(a: PlacementBody, b: PlacementBody): boolean {
  // Items at different heights don't collide; the 1mm tolerance lets items
  // sit flush on surfaces.
  if (a.bottom >= b.top - 0.001 || b.bottom >= a.top - 0.001) return false;
  // Stage items (platforms) can touch/slightly overlap — negative padding
  // provides tolerance for floating point imprecision in edge snapping.
  const effectivePadding = a.stage && b.stage ? -0.05 : 0;
  // Strict < means touching edges are allowed.
  const overlapX = Math.abs(a.x - b.x) < (a.halfW + b.halfW + effectivePadding);
  const overlapZ = Math.abs(a.z - b.z) < (a.halfD + b.halfD + effectivePadding);
  return overlapX && overlapZ;
}

/**
 * The catalogue item a placed row presents to the overlap rule, or undefined
 * when the rule ignores the row: a retained dressing-applicator row, or an
 * asset missing from the catalogue.
 */
function overlapTargetItem(placed: PlacedItem): CatalogueItem | undefined {
  if (!isSceneFurniturePlacement(placed)) return undefined;
  return getCatalogueItem(placed.catalogueItemId);
}

function placedItemBody(placed: PlacedItem, item: CatalogueItem): PlacementBody {
  return placementBody(placed.x, placed.z, item, placed.rotationY, placed.y, placed.scale);
}

export function getPlacementViolations(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
  y: number = 0,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
  scale?: number,
): readonly PlacementViolation[] {
  if (isTableDressingApplicatorSlug(item.slug)) return [];
  const violations: PlacementViolation[] = [];

  if (!isWithinRoomBounds(x, z, item, rotationY, roomDims, scale)) {
    violations.push({
      kind: "outside_room",
      message: "Furniture footprint crosses the room boundary",
    });
  }

  const body = placementBody(x, z, item, rotationY, y, scale);
  for (const other of placedItems) {
    if (excludeIds.has(other.id)) continue;
    const otherItem = overlapTargetItem(other);
    if (otherItem === undefined) continue;
    if (placementBodiesOverlap(body, placedItemBody(other, otherItem))) {
      violations.push({
        kind: "overlap",
        message: `Overlaps ${otherItem.name}`,
        itemId: other.id,
      });
    }
  }

  return violations;
}

/**
 * Whether getPlacementViolations would report anything for this pose, with
 * the overlap scan answered by `overlapIndex` — built over the same placed
 * items — instead of a pass over every item. Same parameters, defaults and
 * rules; only the unreachable pairs are skipped.
 */
export function hasPlacementViolation(
  x: number,
  z: number,
  item: CatalogueItem,
  rotationY: number,
  overlapIndex: PlacementOverlapIndex,
  excludeIds: ReadonlySet<string>,
  y: number = 0,
  roomDims: SpaceDimensions = GRAND_HALL_RENDER_DIMENSIONS,
  scale?: number,
): boolean {
  if (isTableDressingApplicatorSlug(item.slug)) return false;
  if (!isWithinRoomBounds(x, z, item, rotationY, roomDims, scale)) return true;
  return overlapIndex.overlapsAny(placementBody(x, z, item, rotationY, y, scale), excludeIds);
}

// ---------------------------------------------------------------------------
// Overlap broadphase — a uniform grid for layout-wide sweeps
//
// A full-layout violation sweep asks "does this item overlap anything?" for
// every item, and the planner re-runs it on every drag frame. Scanning every
// other item makes that O(n²) — hundreds of milliseconds for a thousand-item
// banquet. The grid answers each query from the few cells an item's
// footprint touches.
//
// Why no overlapping pair is ever skipped. Every gridded body is registered in
// each cell of floor((x ∓ halfW) / cell) × floor((z ∓ halfD) / cell). The
// vertical test and group exclusions only remove pairs, so take a pair that
// passes the X test, fl(|a.x − b.x|) < fl(fl(a.halfW + b.halfW) + padding)
// with padding ≤ 0 and, say, a.x ≥ b.x. IEEE-754 rounding is monotonic, so
// the right side is ≤ fl(a.halfW + b.halfW) and the exact difference must be
// below the exact sum: a.x − a.halfW < b.x + b.halfW. Rounding, division by
// the positive cell size and Math.floor all preserve that order, so a's first
// cell is at or before b's last one; b.x − b.halfW ≤ a.x + a.halfW likewise
// orders b's first cell before a's last. The two cell ranges intersect in X,
// the same holds in Z, and the pair meets in a shared bucket. Bodies the grid
// cannot hold — NaN, negative or infinite extents, cells beyond ±2^30, or
// more than OVERLAP_MAX_CELLS_PER_BODY cells — are compared with everything.
// ---------------------------------------------------------------------------

/**
 * Cell edge of the grid: one metre, so a chair touches 1–4 cells and a cell
 * holds a handful of items. Correctness does not depend on it; speed does.
 */
const OVERLAP_CELL_SIZE = toRenderSpace(1);
/** Larger bodies are compared with every item rather than gridded. */
const OVERLAP_MAX_CELLS_PER_BODY = 256;
/** Cell coordinates within this bound stay exact integers when stepped. */
const OVERLAP_MAX_CELL_COORD = 2 ** 30;
/**
 * Bucket keys pack each cell coordinate modulo 2^15 into one small integer.
 * Distinct cells 2^15 cells apart may share a bucket, which only adds pairs
 * for the exact rule to reject; one cell never maps to two buckets.
 */
const OVERLAP_KEY_BITS = 15;
const OVERLAP_KEY_MASK = (1 << OVERLAP_KEY_BITS) - 1;

interface OverlapCellRange {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** Grid cells the body's footprint touches, or null if it cannot be gridded. */
function overlapCellRange(body: PlacementBody): OverlapCellRange | null {
  // NaN and negative extents fail here, non-finite cells at the bound check.
  if (!(body.halfW >= 0 && body.halfD >= 0)) return null;
  const x0 = Math.floor((body.x - body.halfW) / OVERLAP_CELL_SIZE);
  const x1 = Math.floor((body.x + body.halfW) / OVERLAP_CELL_SIZE);
  const z0 = Math.floor((body.z - body.halfD) / OVERLAP_CELL_SIZE);
  const z1 = Math.floor((body.z + body.halfD) / OVERLAP_CELL_SIZE);
  if (!(
    x0 >= -OVERLAP_MAX_CELL_COORD && x1 <= OVERLAP_MAX_CELL_COORD
    && z0 >= -OVERLAP_MAX_CELL_COORD && z1 <= OVERLAP_MAX_CELL_COORD
  )) return null;
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > OVERLAP_MAX_CELLS_PER_BODY) return null;
  return { x0, x1, z0, z1 };
}

function overlapCellKey(cellX: number, cellZ: number): number {
  return ((cellX & OVERLAP_KEY_MASK) << OVERLAP_KEY_BITS) | (cellZ & OVERLAP_KEY_MASK);
}

interface OverlapEntry {
  readonly id: string;
  readonly body: PlacementBody;
  /** Position in the index, for per-query de-duplication. */
  readonly slot: number;
}

export interface PlacementOverlapIndex {
  /**
   * True when `body` overlaps (placementBodiesOverlap) any indexed item whose
   * id is not in `excludeIds` — the verdict of getPlacementViolations'
   * overlap scan over the same items, visiting only nearby ones.
   */
  readonly overlapsAny: (body: PlacementBody, excludeIds: ReadonlySet<string>) => boolean;
}

/**
 * Indexes every item the overlap rule can hit (scene furniture with a known
 * catalogue asset) in O(n). Build it once per layout snapshot; it does not
 * observe later changes to `placedItems`.
 */
export function createPlacementOverlapIndex(
  placedItems: readonly PlacedItem[],
): PlacementOverlapIndex {
  const entries: OverlapEntry[] = [];
  const unbounded: OverlapEntry[] = [];
  const cells = new Map<number, OverlapEntry[]>();

  for (const placed of placedItems) {
    const item = overlapTargetItem(placed);
    if (item === undefined) continue;
    const body = placedItemBody(placed, item);
    const entry: OverlapEntry = { id: placed.id, body, slot: entries.length };
    entries.push(entry);
    const range = overlapCellRange(body);
    if (range === null) {
      unbounded.push(entry);
      continue;
    }
    for (let cellX = range.x0; cellX <= range.x1; cellX += 1) {
      for (let cellZ = range.z0; cellZ <= range.z1; cellZ += 1) {
        const key = overlapCellKey(cellX, cellZ);
        const bucket = cells.get(key);
        if (bucket === undefined) cells.set(key, [entry]);
        else bucket.push(entry);
      }
    }
  }

  // Items spanning several of the query's cells are tested once per query.
  const visitedStamp = new Uint32Array(entries.length);
  let stamp = 0;

  function overlapsAny(body: PlacementBody, excludeIds: ReadonlySet<string>): boolean {
    if (stamp === 0xffffffff) {
      visitedStamp.fill(0);
      stamp = 0;
    }
    stamp += 1;
    const range = overlapCellRange(body);
    if (range === null) {
      for (const entry of entries) {
        if (placementBodiesOverlap(body, entry.body) && !excludeIds.has(entry.id)) return true;
      }
      return false;
    }
    for (let cellX = range.x0; cellX <= range.x1; cellX += 1) {
      for (let cellZ = range.z0; cellZ <= range.z1; cellZ += 1) {
        const bucket = cells.get(overlapCellKey(cellX, cellZ));
        if (bucket === undefined) continue;
        for (const entry of bucket) {
          if (visitedStamp[entry.slot] === stamp) continue;
          visitedStamp[entry.slot] = stamp;
          if (placementBodiesOverlap(body, entry.body) && !excludeIds.has(entry.id)) return true;
        }
      }
    }
    for (const entry of unbounded) {
      if (placementBodiesOverlap(body, entry.body) && !excludeIds.has(entry.id)) return true;
    }
    return false;
  }

  return { overlapsAny };
}

// ---------------------------------------------------------------------------
// Placed object creation
// ---------------------------------------------------------------------------

/**
 * Generates a UUID for a placed object.
 * New scene objects are client-local until the batch save returns database
 * row IDs. The `local-` prefix lets editorToBatch omit the ID so the API
 * inserts instead of treating the object as an update to a non-existent row.
 */
export function generatePlacedId(): string {
  return `local-${crypto.randomUUID()}`;
}

/** No-op — UUIDs are globally unique, no counter to reset. Kept for test compat. */
export function resetPlacedIdCounter(): void {
  // no-op
}

/** A furniture item placed in the scene. */
export interface PlacedItem {
  readonly id: string;
  readonly catalogueItemId: string;
  /** Hallkeeper-visible seat/table label authored from the planner. */
  readonly label?: string;
  readonly x: number;
  /** Vertical position (floor = 0). Items on platforms sit at the platform's scaled visible top. */
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  /**
   * Uniform scale, round-tripped from `EditorObject.scale`.
   * Defaults to 1 when omitted (items created directly by the placement store).
   * Rendering and X/Z planning footprints share `normalizeFurnitureScale`.
   */
  readonly scale?: number;
  /** Canonical geometry witness used only when a historical asset is absent from today's catalogue. */
  readonly embeddedAssetDefinition?: LayoutSnapshotAssetDefinition;
  /** Whether a cloth is draped over this item (tables only). */
  readonly clothed: boolean;
  /** Cloth colour/style draped over this table. Null when not clothed. */
  readonly clothStyle: TableClothStyle | null;
  /** Tableware placed on this table. Null when no table setting is applied. */
  readonly tableSetting: TableSettingStyle | null;
  /** DRESSING (C2): chair style dressed around this table. */
  readonly chairStyle?: string | null;
  /** DRESSING (C2): the centrepiece on this table. */
  readonly centerpiece?: string | null;
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
    label: "",
    x,
    y,
    z,
    rotationY,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
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
  if (item === undefined) return new Set([itemId]);
  if (!isSceneFurniturePlacement(item)) return new Set();
  if (item.groupId === null) return new Set([itemId]);
  const ids = new Set<string>();
  for (const p of placedItems) {
    if (p.groupId === item.groupId && isSceneFurniturePlacement(p)) ids.add(p.id);
  }
  return ids;
}

/**
 * getGroupMemberIds for any id of one layout, from a single O(n) pass rather
 * than an O(n) scan per call. Returns the same sets (same members, same
 * order); members of one group share one set, so treat results as read-only.
 */
export function createGroupMemberIdsLookup(
  placedItems: readonly PlacedItem[],
): (itemId: string) => ReadonlySet<string> {
  // getGroupMemberIds resolves an id to its FIRST matching row.
  const firstById = new Map<string, PlacedItem>();
  const membersByGroup = new Map<string, Set<string>>();
  for (const placed of placedItems) {
    if (!firstById.has(placed.id)) firstById.set(placed.id, placed);
    if (placed.groupId === null || !isSceneFurniturePlacement(placed)) continue;
    const members = membersByGroup.get(placed.groupId);
    if (members === undefined) membersByGroup.set(placed.groupId, new Set([placed.id]));
    else members.add(placed.id);
  }
  return (itemId) => {
    const item = firstById.get(itemId);
    if (item === undefined) return new Set([itemId]);
    if (!isSceneFurniturePlacement(item)) return new Set();
    if (item.groupId === null) return new Set([itemId]);
    return membersByGroup.get(item.groupId) ?? new Set();
  };
}

/**
 * Expands an arbitrary set of item IDs to include every member of each
 * selected item's group. Ctrl+G/ungroup/delete actions use this so table
 * rings do not get split by a partial selection.
 */
export function expandIdsToGroupMembers(
  ids: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const id of ids) {
    for (const memberId of getGroupMemberIds(id, placedItems)) {
      expanded.add(memberId);
    }
  }
  return expanded;
}

/**
 * Up to about one table group of selected ids, scanning the layout per id is
 * cheaper than building the group lookup (measured crossover ≈ 11 ids at
 * 88–1,287 items). Past it the per-id scans grow quadratically: 20 ms per
 * pointer move for a 1,287-item select-all drag.
 */
export const DRAG_GROUP_SCAN_MAX_IDS = 12;

/**
 * Every item a furniture drag moves: the dragged item's group first, then the
 * group of each selected id, in that order. Seeding from the dragged item
 * keeps a table ring intact when selection state lags a pointer frame or holds
 * only part of the group.
 */
export function dragMovingIds(
  draggedId: string,
  selectedIds: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
): ReadonlySet<string> {
  const groupMemberIds = selectedIds.size > DRAG_GROUP_SCAN_MAX_IDS
    ? createGroupMemberIdsLookup(placedItems)
    : (itemId: string) => getGroupMemberIds(itemId, placedItems);
  const moving = new Set<string>(groupMemberIds(draggedId));
  for (const selectedId of selectedIds) {
    for (const memberId of groupMemberIds(selectedId)) moving.add(memberId);
  }
  return moving;
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
