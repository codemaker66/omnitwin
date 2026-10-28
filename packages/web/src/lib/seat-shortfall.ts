import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { computeRotatedFootprint, generatePlacedId, type PlacedItem } from "./placement.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { seatingCountsFromPlacedItems } from "./seating-counts.js";
import {
  banquetSeatsPerTable,
  createTableGroup,
  rearrangeTableGroup,
  tableGroupPlanningFootprint,
  tableGroupPlanningRadius,
  tableGroupSeatCapacity,
  tableOwnChairs,
} from "./table-group.js";
import { BANQUET_CHAIR_CLEARANCE_M, groupClearOfDoors } from "./auto-fill.js";
import type { LayoutRect } from "./auto-layout.js";
import { countLabel } from "./count-label.js";

// ---------------------------------------------------------------------------
// seat-shortfall — the one-tap answer to "Short 16 seats for 80 guests".
//
// When the chairs on the floor fall short of the planner's guest count, the
// Guests and Share lenses offer one action, worked out here:
//
//   - "Add 16 chairs at the tables" when the tables on the floor can take
//     them, spread evenly, never past the seats a table is set for at a
//     banquet (the catalogue's recorded count: 10 at a 6 ft round);
//   - "Add tables for 16" when those tables are full, set like the ones
//     already there, in free floor at the banquet spacing (0.6 m clear
//     behind every chair, to the next chairs, any other furniture or a wall),
//     never in a door's clear space;
//   - nothing to tap when neither fits, so the lens can say so plainly.
//
// It only ever adds: the existing tables keep their places and their chairs
// keep their identity (rearrangeTableGroup reuses them). The placement store
// writes the result in one step, so one undo takes it back.
// ---------------------------------------------------------------------------

export type SeatShortfallOffer =
  /** `chairs` more chairs at `tables` of the tables on the floor. */
  | { readonly kind: "chairs"; readonly short: number; readonly guests: number; readonly chairs: number; readonly tables: number; readonly seatsPerTable: number }
  /** `tables` new tables like those on the floor, with `chairs` chairs between them. */
  | { readonly kind: "tables"; readonly short: number; readonly guests: number; readonly chairs: number; readonly tables: number; readonly tableItemId: string; readonly round: boolean }
  /** The tables are full and the room has no space for another at this spacing
   *  (`doorsKeptClear` when only the doors' clear spaces would have had room). */
  | { readonly kind: "no-room"; readonly short: number; readonly guests: number; readonly doorsKeptClear?: true };

export interface SeatShortfallInput {
  readonly placedItems: readonly PlacedItem[];
  /** The planner's guest count, or null. */
  readonly guests: number | null;
  /** The room's interior, metres. */
  readonly roomWidthM: number;
  readonly roomLengthM: number;
  /** The chair new tables are set with; the event's (plannerChairSlug) unless named. */
  readonly chairSlug?: string;
  /** The room's door clear spaces (lib/door-clear-spaces doorKeepOuts): no new table stands in one. */
  readonly doorSpaces?: readonly LayoutRect[];
}

export interface SeatShortfallFixResult {
  readonly offer: Exclude<SeatShortfallOffer, { readonly kind: "no-room" }>;
  readonly placedItems: readonly PlacedItem[];
  /** Ids of every chair and table the fix added. */
  readonly addedIds: readonly string[];
}

/** Candidate spacing for new tables on the floor, metres. */
const SPOT_STEP_M = 0.25;
const EPS = 1e-9;

interface SeatedTable {
  readonly placed: PlacedItem;
  readonly item: CatalogueItem;
  readonly chairs: number;
  /** Seats this table may be set for: its banquet seats, never past what fits. */
  readonly limit: number;
}

function seatedTables(placedItems: readonly PlacedItem[]): SeatedTable[] {
  const tables: SeatedTable[] = [];
  for (const placed of placedItems) {
    if (!isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined || !isDiningTableItem(item) || item.tableShape === null) continue;
    // Its own chairs: a group made with Group can hold other tables and theirs.
    const chairs = tableOwnChairs(placed, placedItems).length;
    const limit = Math.min(banquetSeatsPerTable(item), tableGroupSeatCapacity(placed, placedItems));
    tables.push({ placed, item, chairs, limit });
  }
  return tables;
}

/** Spread `count` chairs over the tables, one at a time to the table with the
 *  fewest chairs that still has room. Returns the chairs each table gains. */
function spreadChairs(tables: readonly SeatedTable[], count: number): number[] {
  const gains = tables.map(() => 0);
  for (let added = 0; added < count; added += 1) {
    let pick = -1;
    let pickSeated = Number.POSITIVE_INFINITY;
    tables.forEach((table, index) => {
      const seated = table.chairs + (gains[index] ?? 0);
      if (seated >= table.limit) return;
      if (seated < pickSeated) {
        pick = index;
        pickSeated = seated;
      }
    });
    if (pick === -1) break;
    gains[pick] = (gains[pick] ?? 0) + 1;
  }
  return gains;
}

/** The kind of table there is most of on the floor (the first seen on a tie). */
function commonestTable(tables: readonly SeatedTable[]): CatalogueItem | null {
  const counts = new Map<string, { readonly item: CatalogueItem; count: number }>();
  for (const table of tables) {
    const entry = counts.get(table.item.id);
    if (entry === undefined) counts.set(table.item.id, { item: table.item, count: 1 });
    else entry.count += 1;
  }
  let best: { readonly item: CatalogueItem; readonly count: number } | null = null;
  for (const entry of counts.values()) if (best === null || entry.count > best.count) best = entry;
  return best?.item ?? null;
}

interface Obstacle { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number }
interface Spot { readonly x: number; readonly z: number }

/** Free spots (metres, room-centred) for up to `wanted` new groups of `table`
 *  set for `seats`, clear of everything on the floor and of each other by the
 *  banquet spacing, nearest the middle of the room first. */
function freeTableSpots(input: SeatShortfallInput, table: CatalogueItem, seats: number, wanted: number): Spot[] {
  if (wanted <= 0) return [];
  const clearance = BANQUET_CHAIR_CLEARANCE_M;
  const round = table.tableShape === "round";
  const footprint = tableGroupPlanningFootprint(table, seats, input.chairSlug);
  const radius = round ? tableGroupPlanningRadius(table, seats, input.chairSlug) : 0;
  const hw = round ? radius : footprint.width / 2;
  const hd = round ? radius : footprint.depth / 2;

  const obstacles: Obstacle[] = [];
  for (const placed of input.placedItems) {
    if (!isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    const extent = computeRotatedFootprint(item, placed.rotationY, placed.scale);
    obstacles.push({
      x: toRealWorld(placed.x),
      z: toRealWorld(placed.z),
      hw: toRealWorld(extent.halfW),
      hd: toRealWorld(extent.halfD),
    });
  }

  // Gap between the new group and a box: a circle measures to the box's
  // nearest point; a rectangle by its separation on each axis.
  const gapTo = (x: number, z: number, o: Obstacle): number => {
    const dx = Math.abs(x - o.x);
    const dz = Math.abs(z - o.z);
    if (round) return Math.hypot(Math.max(0, dx - o.hw), Math.max(0, dz - o.hd)) - radius;
    const gx = dx - (hw + o.hw);
    const gz = dz - (hd + o.hd);
    return gx > 0 && gz > 0 ? Math.hypot(gx, gz) : Math.max(gx, gz);
  };

  const spanX = input.roomWidthM / 2 - clearance - hw;
  const spanZ = input.roomLengthM / 2 - clearance - hd;
  if (spanX < 0 || spanZ < 0) return [];
  const candidates: Spot[] = [];
  const stepsX = Math.floor(spanX / SPOT_STEP_M + EPS);
  const stepsZ = Math.floor(spanZ / SPOT_STEP_M + EPS);
  for (let i = -stepsX; i <= stepsX; i += 1) {
    for (let j = -stepsZ; j <= stepsZ; j += 1) candidates.push({ x: i * SPOT_STEP_M, z: j * SPOT_STEP_M });
  }
  candidates.sort((a, b) => (Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)) || (a.z - b.z) || (a.x - b.x));

  // Judged as Fill and the door notice judge it: each piece of the new group,
  // table and chairs (auto-fill groupClearOfDoors), never the group's bounds.
  const doorSpaces = input.doorSpaces ?? [];
  const clearOfDoors = doorSpaces.length === 0
    ? null
    : groupClearOfDoors(table, seats, { width: 2 * hw, depth: 2 * hd }, doorSpaces, input.chairSlug);
  const inDoorSpace = (spot: Spot): boolean => clearOfDoors !== null && !clearOfDoors({ xM: spot.x, zM: spot.z, rotationY: 0 });

  const spots: Spot[] = [];
  for (const candidate of candidates) {
    if (spots.length >= wanted) break;
    if (inDoorSpace(candidate)) continue;
    if (obstacles.some((o) => gapTo(candidate.x, candidate.z, o) < clearance - EPS)) continue;
    const spaced = spots.every((spot) => (round
      ? Math.hypot(candidate.x - spot.x, candidate.z - spot.z) >= 2 * radius + clearance - EPS
      : Math.abs(candidate.x - spot.x) >= 2 * hw + clearance - EPS || Math.abs(candidate.z - spot.z) >= 2 * hd + clearance - EPS));
    if (spaced) spots.push(candidate);
  }
  return spots;
}

function shortfallOf(input: SeatShortfallInput): { readonly guests: number; readonly short: number } | null {
  if (input.guests === null || !Number.isFinite(input.guests) || input.guests <= 0) return null;
  const guests = Math.floor(input.guests);
  const short = guests - seatingCountsFromPlacedItems(input.placedItems).chairs;
  return short > 0 ? { guests, short } : null;
}

interface Planned {
  readonly offer: SeatShortfallOffer;
  readonly tables: readonly SeatedTable[];
  readonly spots: readonly Spot[];
}

function planShortfall(input: SeatShortfallInput): Planned | null {
  const need = shortfallOf(input);
  if (need === null) return null;
  const tables = seatedTables(input.placedItems);
  // A layout with no dining table on the floor (rows of chairs, a standing
  // reception) gets no table fix here.
  if (tables.length === 0) return null;
  const { guests, short } = need;
  const spare = tables.reduce((sum, table) => sum + Math.max(0, table.limit - table.chairs), 0);
  const chairsOffer = (count: number): Planned => ({
    offer: {
      kind: "chairs",
      short,
      guests,
      chairs: count,
      tables: spreadChairs(tables, count).filter((gain) => gain > 0).length,
      seatsPerTable: Math.max(...tables.map((t) => t.limit)),
    },
    tables,
    spots: [],
  });
  if (spare >= short) return chairsOffer(short);

  const table = commonestTable(tables);
  const seats = table === null ? 0 : banquetSeatsPerTable(table, input.chairSlug);
  const tablesNeeded = seats > 0 ? Math.ceil(short / seats) : 0;
  const spots = table === null || seats === 0 ? [] : freeTableSpots(input, table, seats, tablesNeeded);
  const tablesOffer = (item: CatalogueItem, count: number, chairs: number): Planned => ({
    offer: { kind: "tables", short, guests, chairs, tables: count, tableItemId: item.id, round: item.tableShape === "round" },
    tables,
    spots: spots.slice(0, count),
  });
  if (table !== null && spots.length > 0 && spots.length >= tablesNeeded) return tablesOffer(table, tablesNeeded, short);
  const partialTableSeats = Math.min(short, spots.length * seats);
  if (spare > 0 && spare >= partialTableSeats) return chairsOffer(spare);
  if (table !== null && spots.length > 0) return tablesOffer(table, spots.length, partialTableSeats);
  // Say so when the doors' clear spaces are what leave no room.
  const doorsKeptClear = table !== null && seats > 0 && (input.doorSpaces ?? []).length > 0
    && freeTableSpots({ ...input, doorSpaces: [] }, table, seats, 1).length > 0;
  return { offer: { kind: "no-room", short, guests, ...(doorsKeptClear ? { doorsKeptClear } : {}) }, tables, spots: [] };
}

/** The one action to offer for a seat shortfall, or null when nothing is short. Pure. */
export function seatShortfallOffer(input: SeatShortfallInput): SeatShortfallOffer | null {
  return planShortfall(input)?.offer ?? null;
}

/** Apply the offered fix. Returns the new layout and what was added, or null
 *  when there is nothing to add. Pure: the store writes it in one step. */
export function applySeatShortfallFix(input: SeatShortfallInput): SeatShortfallFixResult | null {
  const planned = planShortfall(input);
  if (planned === null) return null;
  const { offer } = planned;
  if (offer.kind === "no-room") return null;
  const before = new Set(input.placedItems.map((item) => item.id));
  let items: PlacedItem[] = [...input.placedItems];

  if (offer.kind === "chairs") {
    const gains = spreadChairs(planned.tables, offer.chairs);
    planned.tables.forEach((table, index) => {
      const gain = gains[index] ?? 0;
      if (gain === 0) return;
      const tableId = table.placed.id;
      if (table.placed.groupId === null) {
        // A table placed on its own takes a group so its chairs move with it.
        const groupId = generatePlacedId();
        items = items.map((item) => (item.id === tableId ? { ...item, groupId } : item));
      }
      items = [...rearrangeTableGroup(tableId, table.chairs + gain, items)];
    });
  } else {
    const base = Math.floor(offer.chairs / offer.tables);
    const extra = offer.chairs % offer.tables;
    planned.spots.slice(0, offer.tables).forEach((spot, index) => {
      const chairs = base + (index < extra ? 1 : 0);
      items.push(...createTableGroup(offer.tableItemId, toRenderSpace(spot.x), toRenderSpace(spot.z), 0, chairs, 0, undefined, "around", input.chairSlug));
    });
  }

  const addedIds = items.filter((item) => !before.has(item.id)).map((item) => item.id);
  if (addedIds.length === 0) return null;
  return { offer, placedItems: items, addedIds };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The action: "Add 16 chairs at the tables" / "Add tables for 16". Null when
 *  there is nothing to tap. */
export function seatShortfallActionLabel(offer: SeatShortfallOffer): string | null {
  switch (offer.kind) {
    case "chairs": return `Add ${countLabel(offer.chairs, "chair")} at the tables`;
    case "tables": return `Add tables for ${String(offer.chairs)}`;
    case "no-room": return null;
  }
}

/** What the action will do, said before it is done. */
export function seatShortfallDetail(offer: SeatShortfallOffer): string {
  switch (offer.kind) {
    case "chairs":
      return `Spread over ${countLabel(offer.tables, "table")}, up to ${String(offer.seatsPerTable)} at each.`;
    case "tables":
      return `${countLabel(offer.tables, offer.round ? "round table" : "table")} with ${countLabel(offer.chairs, "chair")}, ${String(BANQUET_CHAIR_CLEARANCE_M)} m clear behind every chair.`;
    case "no-room":
      return offer.doorsKeptClear === true
        ? "The tables are full, and there is no room for another at this spacing with the doors kept clear."
        : "The tables are full, and there is no room for another at this spacing.";
  }
}

/** What the action did: "Added 16 chairs at 8 tables." */
export function seatShortfallDoneLine(offer: SeatShortfallFixResult["offer"]): string {
  return offer.kind === "chairs"
    ? `Added ${countLabel(offer.chairs, "chair")} at ${countLabel(offer.tables, "table")}.`
    : `Added ${countLabel(offer.tables, "table")} and ${countLabel(offer.chairs, "chair")}.`;
}
