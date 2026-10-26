import { seatsFor } from "@omnitwin/types";
import { toRenderSpace, toRealWorld } from "../constants/scale.js";
import type { CatalogueItem } from "./catalogue.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import { createPlacedItem, generatePlacedId, computeRotatedFootprint } from "./placement.js";
import type { PlacedItem } from "./placement.js";
import { normalizeFurnitureScale } from "./furniture-scale.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { isPlannerChair, plannerChairSlug } from "./furniture-defaults.js";

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

type ChairFootprint = Pick<CatalogueItem, "width" | "depth">;

function seatPitch(chair: ChairFootprint): number {
  return Math.max(SEAT_PITCH_M, chair.width + CHAIR_GAP_M);
}

/** Conservative capacity from centre spacing and the complete chair corners. */
function roundSeatCapacity(table: CatalogueItem, chair: ChairFootprint, scale: number): number {
  const innerRadiusM = (table.width * scale) / 2 + CHAIR_GAP_M;
  const ringRadiusM = innerRadiusM + chair.depth / 2;
  const pitchCapacity = Math.floor((2 * Math.PI * ringRadiusM) / seatPitch(chair));
  // A chair's nearest corners subtend the largest angle. Keeping its rectangle
  // inside one angular sector prevents overlap, including for deep/scaled chairs
  // whose centre-ring arc alone would allow their inner corners to intersect.
  const cornerCapacity = Math.floor(Math.PI / Math.atan2(chair.width / 2, innerRadiusM));
  return Math.max(0, Math.min(pitchCapacity, cornerCapacity));
}

/** Seats that fit around a rectangular table: both long sides plus both heads,
 *  each axis holding floor(length / pitch) covers. Width is treated as the long
 *  (side-seating) axis — true for every banquet/trestle table in the catalogue. */
function rectSeatCapacity(table: CatalogueItem, chair: ChairFootprint, scale: number): number {
  const perSide = Math.max(0, Math.floor((table.width * scale) / seatPitch(chair)));
  const perEnd = Math.max(0, Math.floor((table.depth * scale) / seatPitch(chair)));
  return 2 * perSide + 2 * perEnd;
}

/**
 * Maximum seats that fit around a table without chairs overlapping. Drives the
 * seating dialog's ceiling and clamps `computeChairPositions`.
 */
export function seatCapacity(table: CatalogueItem, scale?: number, chairFootprint?: ChairFootprint): number {
  if (!isDiningTableItem(table) || table.tableShape === null) return 0;
  const chair = chairFootprint ?? getCatalogueItemBySlug(plannerChairSlug());
  if (chair === undefined) return 0;
  const resolvedScale = normalizeFurnitureScale(scale);
  return table.tableShape === "round"
    ? roundSeatCapacity(table, chair, resolvedScale)
    : rectSeatCapacity(table, chair, resolvedScale);
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
  tableScale?: number,
  chairFootprint?: ChairFootprint,
): readonly ChairPlacement[] {
  if (chairCount <= 0) return [];

  const chairItem = chairFootprint ?? getCatalogueItemBySlug(plannerChairSlug());
  if (chairItem === undefined) return [];

  // Never place more chairs than physically fit — clamp rather than overlap.
  const resolvedScale = normalizeFurnitureScale(tableScale);
  const count = Math.min(Math.floor(chairCount), seatCapacity(tableItem, resolvedScale, chairItem));
  if (count <= 0) return [];

  if (tableItem.tableShape === "round") {
    return computeRoundChairPositions(
      tableX,
      tableZ,
      tableItem,
      count,
      chairItem,
      resolvedScale,
    );
  }
  return computeRectChairPositions(
    tableX,
    tableZ,
    tableItem,
    tableRotY,
    count,
    chairItem,
    resolvedScale,
  );
}

function computeRoundChairPositions(
  cx: number,
  cz: number,
  table: CatalogueItem,
  count: number,
  chair: ChairFootprint,
  tableScale: number,
): readonly ChairPlacement[] {
  const tableRadius = (toRenderSpace(table.width) * tableScale) / 2;
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
  chair: ChairFootprint,
  tableScale: number,
): readonly ChairPlacement[] {
  // Per-axis seat counts the table can hold without overlap (width = the long,
  // side-seating axis; depth = the heads). `count` is already clamped to the
  // total capacity by computeChairPositions, so the allocations below fit.
  const perSide = Math.max(0, Math.floor((table.width * tableScale) / seatPitch(chair)));
  const perEnd = Math.max(0, Math.floor((table.depth * tableScale) / seatPitch(chair)));

  // Fill the long sides first (most natural banquet seating), balanced
  // front/back, then spill onto the heads.
  const sideTotal = Math.min(count, 2 * perSide);
  const frontCount = Math.ceil(sideTotal / 2);
  const backCount = sideTotal - frontCount;
  const endTotal = Math.min(count - sideTotal, 2 * perEnd);
  const leftCount = Math.ceil(endTotal / 2);
  const rightCount = endTotal - leftCount;

  const pitch = toRenderSpace(seatPitch(chair));
  const halfW = (toRenderSpace(table.width) * tableScale) / 2;
  const halfD = (toRenderSpace(table.depth) * tableScale) / 2;
  const chairHalfDepth = toRenderSpace(chair.depth) / 2;
  const gap = toRenderSpace(CHAIR_GAP_M);
  const sideOffset = halfD + chairHalfDepth + gap; // chairs sit beyond the ±Z edges
  const endOffset = halfW + chairHalfDepth + gap; // chairs sit beyond the ±X ends

  const cos = Math.cos(tableRotY);
  const sin = Math.sin(tableRotY);
  const chairs: ChairPlacement[] = [];

  // Local-frame facings (a chair at rotationY 0 faces −Z): +Z = π, −Z = 0,
  // +X = −π/2, −X = π/2. Each row is centred so seats are pitch-spaced and
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
        x: cx + localX * cos + localZ * sin,
        z: cz - localX * sin + localZ * cos,
        rotationY: tableRotY + facing,
      });
    }
  };

  pushRow(frontCount, "x", -sideOffset, Math.PI); // front long side (−Z), faces +Z
  pushRow(backCount, "x", sideOffset, 0); // back long side (+Z), faces −Z
  pushRow(leftCount, "z", -endOffset, -Math.PI / 2); // left head (−X), faces +X
  pushRow(rightCount, "z", endOffset, Math.PI / 2); // right head (+X), faces −X

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
 * @param chairSlug - The chair each seat gets; the event's (plannerChairSlug) unless named.
 * @returns Array of PlacedItems (table first, then chairs).
 */
export function createTableGroup(
  catalogueItemId: string,
  tableX: number,
  tableZ: number,
  tableRotationY: number,
  chairCount: number,
  y: number = 0,
  newId: () => string = generatePlacedId,
  chairSide: "around" | "back" = "around",
  chairSlug: string = plannerChairSlug(),
): readonly PlacedItem[] {
  const tableItem = getCatalogueItem(catalogueItemId);
  if (
    tableItem === undefined
    || !isDiningTableItem(tableItem)
    || tableItem.tableShape === null
  ) return [];
  const chairItem = getCatalogueItemBySlug(chairSlug);
  if (chairItem === undefined) return [];

  const groupId = newId(); // Reuse ID generator for group IDs

  const table = createPlacedItem(catalogueItemId, tableX, tableZ, tableRotationY, groupId, y, newId());

  // The chairs are spaced by the chair they are, not by whichever the event would set.
  const chairPositions = chairSide === "back"
    ? computeSideChairPositions(tableX, tableZ, tableItem, tableRotationY, chairCount, undefined, chairItem)
    : computeChairPositions(tableX, tableZ, tableItem, tableRotationY, chairCount, undefined, chairItem);
  const chairs = chairPositions.map((pos) =>
    createPlacedItem(chairItem.id, pos.x, pos.z, pos.rotationY, groupId, y, newId()),
  );

  return [table, ...chairs];
}

/**
 * Chairs along one long side of a rectangular table only: the back (+Z
 * before turning), facing the table, as a top table seats its guests to look
 * out over the room. Centred, pitch-spaced, never more than the side holds.
 */
export function computeSideChairPositions(
  tableX: number,
  tableZ: number,
  tableItem: CatalogueItem,
  tableRotY: number,
  chairCount: number,
  tableScale?: number,
  chairFootprint?: ChairFootprint,
): readonly ChairPlacement[] {
  if (!isDiningTableItem(tableItem) || tableItem.tableShape !== "rectangular" || chairCount <= 0) return [];
  const chair = chairFootprint ?? getCatalogueItemBySlug(plannerChairSlug());
  if (chair === undefined) return [];
  const scale = normalizeFurnitureScale(tableScale);
  const perSide = Math.max(0, Math.floor((tableItem.width * scale) / seatPitch(chair)));
  const count = Math.min(Math.floor(chairCount), perSide);
  const pitch = toRenderSpace(seatPitch(chair));
  const offset = (toRenderSpace(tableItem.depth) * scale) / 2 + toRenderSpace(chair.depth) / 2 + toRenderSpace(CHAIR_GAP_M);
  const cos = Math.cos(tableRotY);
  const sin = Math.sin(tableRotY);
  const chairs: ChairPlacement[] = [];
  for (let i = 0; i < count; i += 1) {
    const localX = (i - (count - 1) / 2) * pitch;
    chairs.push({
      x: tableX + localX * cos + offset * sin,
      z: tableZ - localX * sin + offset * cos,
      rotationY: tableRotY,
    });
  }
  return chairs;
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
  if (
    tableItem === undefined
    || !isDiningTableItem(tableItem)
    || tableItem.tableShape === null
  ) return [...placedItems];
  const chairItem = getCatalogueItemBySlug(newSeatChairSlug(table, placedItems));
  if (chairItem === undefined) return [...placedItems];

  const groupId = table.groupId;
  // New slots take the table's own chair. Existing slots retain their exact
  // asset identity, including groups mixing legacy, imported and scaled chairs.
  // Only this table's own chairs are re-rung: a group made with Group can hold
  // other tables and their chairs, and any other piece, which all stay.
  const existingChairs = tableOwnChairs(table, placedItems);
  const replaced = new Set([table.id, ...existingChairs.map((chair) => chair.id)]);
  const others = placedItems.filter((p) => !replaced.has(p.id));

  const footprint = tableGroupChairFootprint(table, placedItems, newChairCount > existingChairs.length);

  // Compute new chair positions without creating a fresh groupId; a top
  // table's trestle keeps its chairs along its back.
  const chairPositions = tableChairSide(table, placedItems) === "back"
    ? computeSideChairPositions(table.x, table.z, tableItem, table.rotationY, newChairCount, table.scale, footprint)
    : computeChairPositions(
      table.x,
      table.z,
      tableItem,
      table.rotationY,
      newChairCount,
      table.scale,
      footprint,
    );

  const newChairs: PlacedItem[] = chairPositions.map((pos, i) => ({
    ...(existingChairs[i] ?? createPlacedItem(chairItem.id, pos.x, pos.z, pos.rotationY, groupId, table.y)),
    x: pos.x,
    y: table.y,
    z: pos.z,
    rotationY: pos.rotationY,
    groupId,
  }));

  return [...others, table, ...newChairs];
}

/**
 * The chairs that belong to `table`: the chairs of its group nearer to it
 * than to any other dining table of the group (a tie goes to the table placed
 * first). A table group holds one table, but a group made with Group can hold
 * several, each with its own chairs.
 */
export function tableOwnChairs(table: PlacedItem, placedItems: readonly PlacedItem[]): readonly PlacedItem[] {
  if (table.groupId === null) return [];
  const group = placedItems.filter((p) => p.groupId === table.groupId && isSceneFurniturePlacement(p));
  const tables = diningTablesAmong(group);
  const chairs = group.filter((p) => p.id !== table.id && getCatalogueItem(p.catalogueItemId)?.category === "chair");
  if (tables.length <= 1) return chairs;
  return chairs.filter((chair) => {
    let owner = tables[0];
    let nearest = Infinity;
    for (const candidate of tables) {
      const distance = Math.hypot(candidate.x - chair.x, candidate.z - chair.z);
      if (distance < nearest) {
        nearest = distance;
        owner = candidate;
      }
    }
    return owner?.id === table.id;
  });
}

/** The dining tables among placed pieces. */
export function diningTablesAmong(pieces: readonly PlacedItem[]): readonly PlacedItem[] {
  return pieces.filter((p) => {
    const item = getCatalogueItem(p.catalogueItemId);
    return item !== undefined && isDiningTableItem(item) && isSceneFurniturePlacement(p);
  });
}

/**
 * The pieces with the groups holding `ids` broken (Ungroup, Ctrl Shift G),
 * no table broken from its chairs: each dining table keeps its own chairs
 * (tableOwnChairs) in a group of their own, the old group where it held one
 * table, and every other piece leaves. The same array when nothing would
 * change: a lone table with its own chairs, which keeps them.
 */
export function ungroupedKeepingTables(
  ids: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
  newId: () => string = generatePlacedId,
): readonly PlacedItem[] {
  const groupIds = new Set(placedItems.filter((p) => ids.has(p.id) && p.groupId !== null).map((p) => p.groupId));
  const next = new Map<string, string | null>();
  for (const groupId of groupIds) {
    const members = placedItems.filter((p) => p.groupId === groupId);
    const tables = diningTablesAmong(members);
    for (const [i, table] of tables.entries()) {
      const keep = tables.length === 1 || i === 0 ? groupId : newId();
      next.set(table.id, keep);
      for (const chair of tableOwnChairs(table, placedItems)) next.set(chair.id, keep);
    }
    for (const member of members) if (!next.has(member.id)) next.set(member.id, null);
  }
  if ([...next].every(([id, groupId]) => placedItems.find((p) => p.id === id)?.groupId === groupId)) return placedItems;
  return placedItems.map((p) => {
    const groupId = next.get(p.id);
    return groupId === undefined || groupId === p.groupId ? p : { ...p, groupId };
  });
}

/**
 * The chair a new seat at this table gets. A table keeps its own chairs: a new
 * seat is the planner's chair most of its seats already are (the first seen,
 * on a tie), so a seat added to a Turini round at a wedding is a Turini. A
 * table with none of the planner's chairs (no chairs, or only legacy and
 * imported ones, which are kept but never copied) takes the event's
 * (plannerChairSlug).
 */
export function newSeatChairSlug(table: PlacedItem, placedItems: readonly PlacedItem[]): string {
  const counts = new Map<string, number>();
  for (const placed of placedItems) {
    if (table.groupId === null || placed.groupId !== table.groupId || placed.id === table.id || !isSceneFurniturePlacement(placed)) continue;
    const catalogue = getCatalogueItem(placed.catalogueItemId);
    if (catalogue?.category !== "chair" || !isPlannerChair(catalogue.slug)) continue;
    counts.set(catalogue.slug, (counts.get(catalogue.slug) ?? 0) + 1);
  }
  let chosen: string | null = null;
  let most = 0;
  for (const [slug, count] of counts) {
    if (count > most) {
      chosen = slug;
      most = count;
    }
  }
  return chosen ?? plannerChairSlug();
}

/** Conservative dimensions of saved chairs, including the chair new slots get (newSeatChairSlug). */
export function tableGroupChairFootprint(
  table: PlacedItem,
  placedItems: readonly PlacedItem[],
  includeNewChairs: boolean,
): ChairFootprint {
  const newChair = includeNewChairs ? getCatalogueItemBySlug(newSeatChairSlug(table, placedItems)) : undefined;
  const footprint = {
    width: newChair?.width ?? 0,
    depth: newChair?.depth ?? 0,
  };
  for (const placed of tableOwnChairs(table, placedItems)) {
    const catalogue = getCatalogueItem(placed.catalogueItemId);
    if (catalogue?.category !== "chair") continue;
    const scale = normalizeFurnitureScale(placed.scale);
    footprint.width = Math.max(footprint.width, catalogue.width * scale);
    footprint.depth = Math.max(footprint.depth, catalogue.depth * scale);
  }
  return footprint;
}

/**
 * Where a placed table's chairs sit: all along its back (a top table's
 * trestle, computeSideChairPositions), or round it. Read from the chairs
 * themselves, so a saved layout needs no field for it.
 */
export function tableChairSide(table: PlacedItem, placedItems: readonly PlacedItem[]): "around" | "back" {
  const item = getCatalogueItem(table.catalogueItemId);
  if (item?.tableShape !== "rectangular" || table.groupId === null) return "around";
  const sin = Math.sin(table.rotationY);
  const cos = Math.cos(table.rotationY);
  let chairs = 0;
  // Its own chairs (tableOwnChairs): another table of a group made with Group keeps its own side.
  for (const placed of tableOwnChairs(table, placedItems)) {
    // The chair's offset from the table in the table's own frame (+Z is its back).
    if ((placed.x - table.x) * sin + (placed.z - table.z) * cos <= 0) return "around";
    chairs += 1;
  }
  return chairs > 0 ? "back" : "around";
}

/** Editing retains existing assets; an increased count must also fit the chairs new seats get (newSeatChairSlug). */
export function tableGroupSeatCapacity(table: PlacedItem, placedItems: readonly PlacedItem[]): number {
  const catalogue = getCatalogueItem(table.catalogueItemId);
  if (catalogue === undefined) return 0;
  if (tableChairSide(table, placedItems) === "back") {
    return computeSideChairPositions(0, 0, catalogue, 0, Number.MAX_SAFE_INTEGER, table.scale, tableGroupChairFootprint(table, placedItems, true)).length;
  }
  const existingCount = tableOwnChairs(table, placedItems).length;
  const existingCapacity = seatCapacity(catalogue, table.scale, tableGroupChairFootprint(table, placedItems, false));
  const expandedCapacity = seatCapacity(catalogue, table.scale, tableGroupChairFootprint(table, placedItems, true));
  return Math.max(Math.min(existingCount, existingCapacity), expandedCapacity > existingCount ? expandedCapacity : 0);
}

/** Complete occupied envelope in metres, so layout aisles run between chair backs. */
export function tableGroupPlanningFootprint(table: CatalogueItem, chairCount: number, chairSlug: string = plannerChairSlug()): ChairFootprint {
  let halfWidth = toRenderSpace(table.width) / 2;
  let halfDepth = toRenderSpace(table.depth) / 2;
  const chair = getCatalogueItemBySlug(chairSlug);
  if (chair !== undefined) {
    for (const position of computeChairPositions(0, 0, table, 0, chairCount, undefined, chair)) {
      const extent = computeRotatedFootprint(chair, position.rotationY);
      halfWidth = Math.max(halfWidth, Math.abs(position.x) + extent.halfW);
      halfDepth = Math.max(halfDepth, Math.abs(position.z) + extent.halfD);
    }
  }
  return { width: toRealWorld(halfWidth * 2), depth: toRealWorld(halfDepth * 2) };
}

/**
 * Radius in metres of a round table group: from the table's centre to the
 * outer corners of its chairs. Chairs around a round table face its centre,
 * so each back edge sits at the table's radius + the gap + the chair's depth,
 * and its corners half a chair-width either side. Layout spacing between
 * rounds is measured between these circles.
 */
export function tableGroupPlanningRadius(table: CatalogueItem, chairCount: number, chairSlug: string = plannerChairSlug()): number {
  const tableRadius = table.width / 2;
  const chair = getCatalogueItemBySlug(chairSlug);
  if (chair === undefined || table.tableShape !== "round" || chairCount <= 0) return tableRadius;
  return Math.max(tableRadius, Math.hypot(tableRadius + CHAIR_GAP_M + chair.depth, chair.width / 2));
}

/**
 * The seats a dining table is set for at a banquet: `seatsFor`'s default
 * (seat truth, card-dock spec §17.2), never more than fit around it. A table
 * seat truth does not know is set for as many as fit.
 */
export function banquetSeatsPerTable(table: CatalogueItem): number {
  const fit = seatCapacity(table);
  if (fit === 0) return 0;
  return Math.max(1, Math.min(fit, seatsFor(table)?.default ?? fit));
}

/**
 * The stepper's range at a table: seat truth's range, held to what
 * physically fits (`physicalMax`, from seatCapacity or tableGroupSeatCapacity),
 * and the count it starts at. A table seat truth does not know runs 1 to fit.
 */
export function chairCountRange(table: CatalogueItem, physicalMax: number): { readonly min: number; readonly max: number; readonly initial: number } {
  const fit = Math.max(0, Math.floor(physicalMax));
  if (fit === 0) return { min: 0, max: 0, initial: 0 };
  const seats = seatsFor(table);
  if (seats === null) return { min: 1, max: fit, initial: fit };
  const max = Math.min(seats.max, fit);
  const min = Math.min(seats.min, max);
  return { min, max, initial: Math.min(max, Math.max(min, seats.default)) };
}
