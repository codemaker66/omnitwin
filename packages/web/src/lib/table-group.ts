import { toRenderSpace } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import { createPlacedItem, generatePlacedId } from "./placement.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// Table group — auto-arrange chairs around a table
// ---------------------------------------------------------------------------

/** Gap between table edge and chair center (real-world metres). */
const CHAIR_GAP_M = 0.05;

/** Stable developer slug for the banquet chair; saved objects use the UUID catalogue ID. */
const CHAIR_SLUG = "banquet-chair";

/** Maximum chairs for a round table (limited by physical space). */
export const MAX_CHAIRS_ROUND = 12;

/** Maximum chairs for a rectangular table (per long side). */
export const MAX_CHAIRS_RECT = 20;

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

  if (tableItem.tableShape === "round") {
    return computeRoundChairPositions(tableX, tableZ, tableItem, chairCount, chairItem);
  }
  return computeRectChairPositions(tableX, tableZ, tableItem, tableRotY, chairCount, chairItem);
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
  const halfW = toRenderSpace(table.width) / 2;
  const halfD = toRenderSpace(table.depth) / 2;
  const chairHalfDepth = toRenderSpace(chair.depth) / 2;
  const gap = toRenderSpace(CHAIR_GAP_M);
  const offset = halfD + chairHalfDepth + gap;

  // Distribute chairs evenly along both long sides
  const perSide = Math.ceil(count / 2);
  const chairSpacing = toRenderSpace(table.width) / (perSide + 1);

  const chairs: ChairPlacement[] = [];
  const cos = Math.cos(tableRotY);
  const sin = Math.sin(tableRotY);
  let placed = 0;

  // Front side (negative Z in local space)
  for (let i = 0; i < perSide && placed < count; i++) {
    const localX = -halfW + chairSpacing * (i + 1);
    const localZ = -offset;
    chairs.push({
      x: cx + localX * cos - localZ * sin,
      z: cz + localX * sin + localZ * cos,
      rotationY: tableRotY + Math.PI, // Face toward table (-Z toward +Z local)
    });
    placed++;
  }

  // Back side (positive Z in local space)
  for (let i = 0; i < perSide && placed < count; i++) {
    const localX = -halfW + chairSpacing * (i + 1);
    const localZ = offset;
    chairs.push({
      x: cx + localX * cos - localZ * sin,
      z: cz + localX * sin + localZ * cos,
      rotationY: tableRotY, // Face toward table (-Z toward -Z local)
    });
    placed++;
  }

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
  }));

  return [...others, table, ...newChairs];
}
