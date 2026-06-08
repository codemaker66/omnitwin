import { toRenderSpace } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import { createPlacedItem, generatePlacedId } from "./placement.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// Table group — geometry-driven seating arrangement
//
// Chairs are placed so they never overlap each other or the table: round
// tables space seats by equal arc; rectangular tables space seats by a fixed
// comfortable pitch along the long sides and (when needed) the heads. Requested
// counts above what the table can physically hold are clamped to the geometric
// capacity rather than crammed in on top of one another.
//
// All capacity maths is in real-world METRES; positions are emitted in
// render-space (× RENDER_SCALE on X/Z) to drop straight into the scene.
// ---------------------------------------------------------------------------

/** Gap between table edge and chair center (real-world metres). */
const CHAIR_GAP_M = 0.05;

/** Comfortable centre-to-centre spacing per seated cover (real-world metres).
 *  A common banquet planning figure; also the minimum that keeps the 0.45 m
 *  banquet chairs from overlapping. */
const SEAT_PITCH_M = 0.6;

/** Stable developer slug for the banquet chair; saved objects use the UUID catalogue ID. */
const CHAIR_SLUG = "banquet-chair";

/** Seats that physically fit around a round table without overlap: the chair
 *  ring circumference divided by the seat pitch. */
function roundSeatCapacity(table: CatalogueItem, chair: CatalogueItem): number {
  const ringRadiusM = table.width / 2 + chair.depth / 2 + CHAIR_GAP_M;
  return Math.max(0, Math.floor((2 * Math.PI * ringRadiusM) / SEAT_PITCH_M));
}

/** Seats that fit around a rectangular table: both long sides plus both heads,
 *  each axis holding floor(length / pitch) covers. Width is treated as the long
 *  (side-seating) axis — true for every banquet/trestle table in the catalogue. */
function rectSeatCapacity(table: CatalogueItem): number {
  const perSide = Math.max(0, Math.floor(table.width / SEAT_PITCH_M));
  const perEnd = Math.max(0, Math.floor(table.depth / SEAT_PITCH_M));
  return 2 * perSide + 2 * perEnd;
}

/**
 * Maximum seats that fit around a table without chairs overlapping. Drives the
 * seating dialog's ceiling and clamps `computeChairPositions`.
 */
export function seatCapacity(table: CatalogueItem): number {
  if (table.tableShape === null) return 0;
  const chair = getCatalogueItemBySlug(CHAIR_SLUG);
  if (chair === undefined) return 0;
  return table.tableShape === "round" ? roundSeatCapacity(table, chair) : rectSeatCapacity(table);
}

// ---------------------------------------------------------------------------
// Chair position computation (pure)
// ---------------------------------------------------------------------------

export interface ChairPlacement {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

/**
 * Computes chair positions arranged around a table.
 *
 * Round tables: chairs in a circle, all facing inward.
 * Rectangular tables: chairs along the two long sides, facing inward.
 *
 * @param tableX      - Table center X (render-space).
 * @param tableZ      - Table center Z (render-space).
 * @param tableItem   - The catalogue entry for the table.
 * @param tableRotY   - Table rotation around Y (radians).
 * @param chairCount  - Number of chairs to place.
 * @returns Array of chair positions and rotations (render-space).
 */
export function computeChairPositions(
  tableX: number,
  tableZ: number,
  tableItem: CatalogueItem,
  tableRotY: number,
  chairCount: number,
): readonly ChairPlacement[] {
  if (chairCount <= 0) return [];

  const chairItem = getCatalogueItemBySlug(CHAIR_SLUG);
  if (chairItem === undefined) return [];

  // Never place more chairs than physically fit — clamp rather than overlap.
  const count = Math.min(Math.floor(chairCount), seatCapacity(tableItem));
  if (count <= 0) return [];

  if (tableItem.tableShape === "round") {
    return computeRoundChairPositions(tableX, tableZ, tableItem, count, chairItem);
  }
  return computeRectChairPositions(tableX, tableZ, tableItem, tableRotY, count, chairItem);
}

function computeRoundChairPositions(
  cx: number,
  cz: number,
  table: CatalogueItem,
  count: number,
  chair: CatalogueItem,
): readonly ChairPlacement[] {
  const tableRadius = toRenderSpace(table.width) / 2;
  const chairHalfDepth = toRenderSpace(chair.depth) / 2;
  const gap = toRenderSpace(CHAIR_GAP_M);
  const dist = tableRadius + chairHalfDepth + gap;

  const chairs: ChairPlacement[] = [];
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    const angle = i * angleStep - Math.PI / 2; // Start from front
    chairs.push({
      x: cx + Math.cos(angle) * dist,
      z: cz + Math.sin(angle) * dist,
      rotationY: Math.PI / 2 - angle, // Face inward (-Z toward center)
    });
  }

  return chairs;
}

function computeRectChairPositions(
  cx: number,
  cz: number,
  table: CatalogueItem,
  tableRotY: number,
  count: number,
  chair: CatalogueItem,
): readonly ChairPlacement[] {
  // Per-axis seat counts the table can hold without overlap (width = the long,
  // side-seating axis; depth = the heads). `count` is already clamped to the
  // total capacity by computeChairPositions, so the allocations below fit.
  const perSide = Math.max(0, Math.floor(table.width / SEAT_PITCH_M));
  const perEnd = Math.max(0, Math.floor(table.depth / SEAT_PITCH_M));

  // Fill the long sides first (most natural banquet seating), balanced
  // front/back, then spill onto the heads.
  const sideTotal = Math.min(count, 2 * perSide);
  const frontCount = Math.ceil(sideTotal / 2);
  const backCount = sideTotal - frontCount;
  const endTotal = Math.min(count - sideTotal, 2 * perEnd);
  const leftCount = Math.ceil(endTotal / 2);
  const rightCount = endTotal - leftCount;

  const pitch = toRenderSpace(SEAT_PITCH_M);
  const halfW = toRenderSpace(table.width) / 2;
  const halfD = toRenderSpace(table.depth) / 2;
  const chairHalfDepth = toRenderSpace(chair.depth) / 2;
  const gap = toRenderSpace(CHAIR_GAP_M);
  const sideOffset = halfD + chairHalfDepth + gap; // chairs sit beyond the ±Z edges
  const endOffset = halfW + chairHalfDepth + gap; // chairs sit beyond the ±X ends

  const cos = Math.cos(tableRotY);
  const sin = Math.sin(tableRotY);
  const chairs: ChairPlacement[] = [];

  // Local-frame facings (a chair at rotationY 0 faces −Z): +Z = π, −Z = 0,
  // +X = π/2, −X = −π/2. Each row is centred so seats are pitch-spaced and
  // symmetric about the table centre — guaranteeing no overlap.
  const pushRow = (
    k: number,
    axis: "x" | "z",
    fixedOffset: number,
    facing: number,
  ): void => {
    for (let i = 0; i < k; i += 1) {
      const slot = (i - (k - 1) / 2) * pitch;
      const localX = axis === "x" ? slot : fixedOffset;
      const localZ = axis === "x" ? fixedOffset : slot;
      chairs.push({
        x: cx + localX * cos - localZ * sin,
        z: cz + localX * sin + localZ * cos,
        rotationY: tableRotY + facing,
      });
    }
  };

  pushRow(frontCount, "x", -sideOffset, Math.PI); // front long side (−Z), faces +Z
  pushRow(backCount, "x", sideOffset, 0); // back long side (+Z), faces −Z
  pushRow(leftCount, "z", -endOffset, Math.PI / 2); // left head (−X), faces +X
  pushRow(rightCount, "z", endOffset, -Math.PI / 2); // right head (+X), faces −X

  return chairs;
}

// ---------------------------------------------------------------------------
// Group creation — produces PlacedItem[] for table + chairs
// ---------------------------------------------------------------------------

/**
 * Creates a full table group: one table + N chairs arranged around it.
 * All items share the same groupId.
 *
 * @param y - Vertical position (e.g. on top of a platform). Default 0.
 * @returns Array of PlacedItems (table first, then chairs).
 */
export function createTableGroup(
  catalogueItemId: string,
  tableX: number,
  tableZ: number,
  tableRotationY: number,
  chairCount: number,
  y: number = 0,
): readonly PlacedItem[] {
  const tableItem = getCatalogueItem(catalogueItemId);
  if (tableItem === undefined || tableItem.tableShape === null) return [];
  const chairItem = getCatalogueItemBySlug(CHAIR_SLUG);
  if (chairItem === undefined) return [];

  const groupId = generatePlacedId(); // Reuse ID generator for group IDs

  const table = createPlacedItem(catalogueItemId, tableX, tableZ, tableRotationY, groupId, y);

  const chairPositions = computeChairPositions(tableX, tableZ, tableItem, tableRotationY, chairCount);
  const chairs = chairPositions.map((pos) =>
    createPlacedItem(chairItem.id, pos.x, pos.z, pos.rotationY, groupId, y),
  );

  return [table, ...chairs];
}

/**
 * Re-arranges chairs for an existing table group with a new chair count.
 * Keeps the table (preserving its id, groupId, and clothed state), replaces
 * all chairs. Reuses existing chair IDs for slots 0..min(old,new)-1 so the
 * batch-save diff is minimal and DB records are not unnecessarily orphaned.
 */
export function rearrangeTableGroup(
  tableId: string,
  newChairCount: number,
  placedItems: readonly PlacedItem[],
): readonly PlacedItem[] {
  const table = placedItems.find((p) => p.id === tableId);
  if (table === undefined || table.groupId === null) return [...placedItems];

  const tableItem = getCatalogueItem(table.catalogueItemId);
  if (tableItem === undefined || tableItem.tableShape === null) return [...placedItems];
  const chairItem = getCatalogueItemBySlug(CHAIR_SLUG);
  if (chairItem === undefined) return [...placedItems];

  const groupId = table.groupId;
  const others = placedItems.filter((p) => p.groupId !== groupId);

  // Compute new chair positions without creating a fresh groupId
  const chairPositions = computeChairPositions(
    table.x, table.z, tableItem, table.rotationY, newChairCount,
  );

  // Reuse existing chair IDs where available to avoid orphaning DB records
  const existingChairs = placedItems.filter((p) => p.groupId === groupId && p.id !== table.id);

  const newChairs: PlacedItem[] = chairPositions.map((pos, i) => ({
    id: existingChairs[i]?.id ?? generatePlacedId(),
    catalogueItemId: chairItem.id,
    label: existingChairs[i]?.label ?? "",
    x: pos.x,
    y: table.y,
    z: pos.z,
    rotationY: pos.rotationY,
    groupId,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
  }));

  return [...others, table, ...newChairs];
}
