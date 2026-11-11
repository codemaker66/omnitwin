import {
  gangwayReviewId,
  seatBaseSlug,
  type FloorPoint,
  type GangwayReviewItem,
  type GangwaySide,
} from "@omnitwin/types";
import { closestPointOnSegment, convexPolygonClosestPoints, pointSegmentDistance } from "./circulation.js";
import { createGhostWorld, obstacleName } from "./ghost-truth.js";
import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "./catalogue.js";
import { computeRotatedFootprint, generatePlacedId, tableLabelNumber, type PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import {
  planBanquetLayout,
  rectsOverlap,
  type BanquetTablePlacement,
  type LayoutRect,
  type WallClearances,
} from "./auto-layout.js";
import { HALL_OPENINGS, type HallWallId } from "../components/grand-hall/hall-spec.js";
import { planTheatreLayout, THEATRE_SPACING, type TheatreSeatPlacement } from "./theatre-layout.js";
import {
  banquetSeatsPerTable,
  createTableGroup,
  seatCapacity,
  tableGroupPlanningFootprint,
  tableGroupPlanningRadius,
} from "./table-group.js";
import { DEFAULT_PLANNER_ROUND_TABLE_SLUG, plannerChairFor, plannerChairOrder, plannerChairSlug } from "./furniture-defaults.js";
import { chairsInStore, currentStoreStock, type UsableStock } from "./card-stock.js";
import { footprintInKeepOut } from "./door-clear-spaces.js";
import { placedFootprint } from "./keep-doors-clear.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { discWithinFloor, floorCentre, rectWithinFloor, type PlannerRoomDimensions, type RoomFloor } from "./room-floor.js";
import { countLabel } from "./count-label.js";
import type { PublishedCapacityAnswer, PublishedFormat } from "./planner-truth.js";

// ---------------------------------------------------------------------------
// auto-fill — what "Banquet rounds" or "Theatre" will place, before it does.
//
// The planner asks how many guests first, then fills. Everything a visitor
// reads about the fill comes from here, from the same plan the placement store
// executes, so the words cannot drift from what lands on the floor: the
// consequence on the button ("Place 14 tables and 140 chairs"), the spacing
// it used, and, when the room cannot take the request at that spacing, a
// plain line that says so beside the venue's own published figure. The
// planner never states a capacity of its own: the published figure, with who
// stated it and when, stays the reference (redteam fix-first 1 and 15).
//
// The 17 Oct 2026 integration check found "Banquet rounds" for 220 guests
// placing 8 tables and 64 chairs in the Grand Hall, with no explanation. The
// cause: since 7 Sep the layout had kept the comfortable 1.2 m two-way aisle
// and a 0.9 m wall band beyond each table's complete chair ring (they had been
// meant for bare table edges), set eight to a 6 ft round, and treated each
// round as a square on a straight grid. A 21 × 10.5 m room held four by two.
//
// Doors (Blake, 27 Oct 2026: "Keep them clear automatically"): a room whose
// doors are recorded passes their clear spaces (lib/door-clear-spaces,
// doorKeepOuts), and no table, chair or seat is set in one. When that leaves
// fewer seats than asked, the line says so beside the figure without them.
// ---------------------------------------------------------------------------

/**
 * The clear passage kept behind every chair, tucked in, to the next table's
 * chairs or to the wall, metres. Banquet hire guidance commonly gives 24 in
 * (0.6 m) as the minimum aisle between chairs; with the Turini chair at a 6 ft
 * round it leaves about 1.9 m between table edges, in line with the 6 ft
 * usually advised between 72 in rounds. It is above the 0.45 m the
 * circulation scale calls impassable, and it is a planning figure, not an
 * escape-route width.
 */
export const BANQUET_CHAIR_CLEARANCE_M = 0.6;

export type AutoFillStyle = "dinner-rounds" | "theatre";

export interface AutoFillStyleOption {
  readonly style: AutoFillStyle;
  readonly label: string;
  /** The venue's published format this style is read against. */
  readonly format: PublishedFormat;
}

export const AUTO_FILL_STYLES: readonly AutoFillStyleOption[] = [
  { style: "dinner-rounds", label: "Banquet rounds", format: "dinner" },
  { style: "theatre", label: "Theatre", format: "theatre" },
];

export function autoFillStyleOption(style: AutoFillStyle): AutoFillStyleOption {
  return AUTO_FILL_STYLES.find((option) => option.style === style) ?? { style, label: style, format: "dinner" };
}

/**
 * Whether a style may lay out this floor. Any style may on an empty floor.
 * With Fill over the layout (Q-10, `fillOver`), banquet rounds may on any
 * floor: they re-plan the rounds of their kind and keep everything else.
 * Theatre rows still replace the whole floor, so they wait for a clear one.
 */
export function canLayOut(style: AutoFillStyle, floorEmpty: boolean, fillOver: boolean): boolean {
  return floorEmpty || (fillOver && style === "dinner-rounds");
}

/** What laying out banquet rounds does on a floor that already has pieces. */
export const LAY_OUT_OVER_WORDS = "Re-plans the rounds and keeps everything else.";

/** Tables and chairs for a banquet, planned in metres on a room-centred origin. */
export interface BanquetFillPlan {
  readonly style: "dinner-rounds";
  readonly tableItemId: string;
  readonly round: boolean;
  readonly tables: readonly BanquetTablePlacement[];
  readonly seatsPerTable: number;
  readonly tableCount: number;
  readonly chairs: number;
  /** The guests asked for, or null to fill the room. */
  readonly guests: number | null;
  /** Seats the room takes at this spacing, whatever was asked. */
  readonly roomForSeats: number;
  readonly meetsTarget: boolean;
  /** Whether the room's door clear spaces were kept (its doors are recorded). */
  readonly doorsKeptClear: boolean;
  /** Seats the room would take at this spacing were its doors not kept clear. */
  readonly roomForSeatsIgnoringDoors: number;
}

/** A theatre seat and the chair it is set with. */
export interface TheatreFillSeat extends TheatreSeatPlacement {
  readonly chairItemId: string;
}

/** Rows of chairs facing a stage at one end, planned in metres. */
export interface TheatreFillPlan {
  readonly style: "theatre";
  /** The front rows' chair. */
  readonly chairItemId: string;
  readonly seats: readonly TheatreFillSeat[];
  readonly chairs: number;
  readonly rows: number;
  readonly guests: number | null;
  readonly roomForSeats: number;
  readonly meetsTarget: boolean;
  readonly doorsKeptClear: boolean;
  readonly roomForSeatsIgnoringDoors: number;
  /** The chairs set, front rows first, with how many of each. */
  readonly chairKinds: readonly { readonly chairItemId: string; readonly seats: number }[];
  /** Whether rows the room had space for were left unset because the hall's chairs ran out. */
  readonly chairsRanOut: boolean;
}

export type AutoFillPlan = BanquetFillPlan | TheatreFillPlan;

/** A chair Fill may set, and how many of it the hall has; null sets no limit. */
export interface ChairSupply {
  readonly item: CatalogueItem;
  readonly inStore: number | null;
}

/** What a fill keeps clear beyond its own spacing, and the chairs it may set. */
export interface FillOptions {
  /** The room's door clear spaces (lib/door-clear-spaces doorKeepOuts); none when its doors are not recorded. */
  readonly doorSpaces?: readonly LayoutRect[];
  /**
   * The chairs a theatre fill sets, in the order the hall uses them, with how
   * many it has of each (plannerChairSupply). Absent, every row is the chair
   * asked for, with no limit.
   */
  readonly chairSupply?: readonly ChairSupply[];
  /**
   * The room's floor, where its walls are not the rectangle of its size
   * centred on the origin (lib/room-floor). The layout is then planned across
   * the floor's bounds, where they stand, and a group or seat is set only
   * where it stands inside the walls with the layout's wall band kept from
   * every one of them.
   */
  readonly floor?: RoomFloor;
}

/** Where a layout planned on a room-centred origin stands in the room, metres: the middle of its floor's bounds. */
function layoutOrigin(floor: RoomFloor | undefined): { readonly xM: number; readonly zM: number } {
  if (floor === undefined) return { xM: 0, zM: 0 };
  const centre = floorCentre(floor);
  return { xM: toRealWorld(centre.x), zM: toRealWorld(centre.z) };
}

/**
 * Whether a table group at a spot (metres, in the room) stands inside the
 * floor's walls with `bandM` kept from each of them, as a layout keeps it
 * from a rectangle's: a round's ring of chairs as a disc, a rectangle's
 * bounds as they are.
 */
function groupOnFloor(
  floor: RoomFloor,
  bounds: { readonly width: number; readonly depth: number },
  radiusM: number | undefined,
  bandM: number,
): (spot: { readonly xM: number; readonly zM: number }) => boolean {
  return (spot) => (radiusM === undefined
    ? rectWithinFloor(floor, toRenderSpace(spot.xM), toRenderSpace(spot.zM), toRenderSpace(bounds.width / 2 + bandM), toRenderSpace(bounds.depth / 2 + bandM))
    : discWithinFloor(floor, toRenderSpace(spot.xM), toRenderSpace(spot.zM), toRenderSpace(radiusM + bandM)));
}

/**
 * The chairs Fill sets, in order, with how many the hall has of each (Blake,
 * 28 Oct 2026: "only use the chairs i gave you inventory for", and the Grand
 * Hall's order, pink, then checked, then red with gold legs): the event's chair
 * first, then the hall's order, each counted from the store where its figures
 * are known, else from the hall's recorded chairs (card-stock chairsInStore).
 */
export function plannerChairSupply(
  eventChairSlug: string = plannerChairSlug(),
  stock: UsableStock | null = currentStoreStock(),
): readonly ChairSupply[] {
  const supply: ChairSupply[] = [];
  for (const slug of plannerChairOrder(eventChairSlug)) {
    const item = getCatalogueItemBySlug(slug);
    if (item !== undefined && item.category === "chair") supply.push({ item, inStore: chairsInStore(item.id, stock) });
  }
  return supply;
}

/**
 * Sets each row, front first, in one kind of chair: the first in the supply's
 * order with a whole row left, so no row mixes chairs and the front rows take
 * the event's. Stops at `target` seats, or where no kind has a row left (the
 * hall's chairs ran out).
 */
function seatRowsFromSupply(
  rows: readonly (readonly TheatreSeatPlacement[])[],
  supply: readonly ChairSupply[],
  target: number | null,
): { readonly seats: TheatreFillSeat[]; readonly rows: number; readonly ranOut: boolean } {
  const left = supply.map((chair) => chair.inStore);
  const seats: TheatreFillSeat[] = [];
  let used = 0;
  for (const row of rows) {
    if (target !== null && seats.length >= target) break;
    const kind = left.findIndex((count) => count === null || count >= row.length);
    const chair = supply[kind];
    if (chair === undefined) return { seats, rows: used, ranOut: true };
    const count = left[kind];
    if (count !== null && count !== undefined) left[kind] = count - row.length;
    for (const seat of row) seats.push({ ...seat, chairItemId: chair.item.id });
    used += 1;
  }
  return { seats, rows: used, ranOut: false };
}

/** How many seats each chair took, in the order first set. */
function chairKindsOf(seats: readonly TheatreFillSeat[]): readonly { readonly chairItemId: string; readonly seats: number }[] {
  const counts = new Map<string, number>();
  for (const seat of seats) counts.set(seat.chairItemId, (counts.get(seat.chairItemId) ?? 0) + 1);
  return [...counts].map(([chairItemId, count]) => ({ chairItemId, seats: count }));
}

/** A planned layout's seats as rows, front first (planTheatreLayout lays them out a row at a time). */
function rowsOf(seats: readonly TheatreSeatPlacement[], seatsPerRow: number): TheatreSeatPlacement[][] {
  const rows: TheatreSeatPlacement[][] = [];
  for (let start = 0; start < seats.length; start += Math.max(1, seatsPerRow)) rows.push(seats.slice(start, start + seatsPerRow));
  return rows;
}

function requested(guests: number): number | null {
  return Number.isFinite(guests) && guests > 0 ? Math.floor(guests) : null;
}

/**
 * Plan a banquet of `table` groups for `guests` (0 fills the room), seating
 * `chairsPerTable` at each (never more than fit), with no group in a door's
 * clear space (`options.doorSpaces`). Null when the table is not a seated
 * dining table or the room cannot hold one group.
 */
export function planBanquetFill(
  table: CatalogueItem,
  guests: number,
  chairsPerTable: number,
  roomWidthM: number,
  roomLengthM: number,
  options: FillOptions = {},
): BanquetFillPlan | null {
  const doorSpaces = options.doorSpaces ?? [];
  if (!isDiningTableItem(table)) return null;
  const seats = Math.min(seatCapacity(table), Math.max(0, Math.floor(chairsPerTable)));
  if (seats === 0) return null;
  const occupied = tableGroupPlanningFootprint(table, seats);
  const round = table.tableShape === "round";
  const radiusM = round ? tableGroupPlanningRadius(table, seats) : undefined;
  const target = requested(guests);
  const layout = (admit: ((spot: BanquetTablePlacement) => boolean) | undefined): ReturnType<typeof planBanquetLayout> => planBanquetLayout({
    roomWidthM,
    roomLengthM,
    // Spacing runs between the backs of the chairs, tucked in.
    tableWidthM: occupied.width,
    tableDepthM: occupied.depth,
    tableRadiusM: radiusM,
    seatsPerTable: seats,
    aisleM: BANQUET_CHAIR_CLEARANCE_M,
    wallClearanceM: BANQUET_CHAIR_CLEARANCE_M,
    targetGuests: target ?? undefined,
    admit,
  });
  const doorsKeptClear = doorSpaces.length > 0;
  const clearOfDoors = doorsKeptClear ? groupClearOfDoors(table, seats, groupBounds(occupied, radiusM), doorSpaces) : undefined;
  // On a room's own floor the layout stands on the floor's bounds, and a group stands only inside its walls.
  const { floor } = options;
  const origin = layoutOrigin(floor);
  const inRoom = (spot: BanquetTablePlacement): BanquetTablePlacement => ({ ...spot, xM: spot.xM + origin.xM, zM: spot.zM + origin.zM });
  const onFloor = floor === undefined ? undefined : groupOnFloor(floor, occupied, radiusM, BANQUET_CHAIR_CLEARANCE_M);
  const admitting = (doorRule: ((spot: BanquetTablePlacement) => boolean) | undefined): ((spot: BanquetTablePlacement) => boolean) | undefined => {
    if (onFloor === undefined) return doorRule;
    return (spot) => {
      const at = inRoom(spot);
      return onFloor(at) && (doorRule === undefined || doorRule(at));
    };
  };
  const plan = layout(admitting(clearOfDoors));
  if (plan.tables.length === 0) return null;
  return {
    style: "dinner-rounds",
    tableItemId: table.id,
    round,
    tables: floor === undefined ? plan.tables : plan.tables.map(inRoom),
    seatsPerTable: seats,
    tableCount: plan.tableCount,
    chairs: plan.seatsPlanned,
    guests: target,
    roomForSeats: plan.capacityTables * seats,
    meetsTarget: plan.meetsTarget,
    doorsKeptClear,
    roomForSeatsIgnoringDoors: (doorsKeptClear ? layout(admitting(undefined)) : plan).capacityTables * seats,
  };
}

/** A group's bounds on the floor, metres: a round's square round its ring of chairs, a rectangle's own. */
function groupBounds(occupied: { readonly width: number; readonly depth: number }, radiusM: number | undefined): { readonly width: number; readonly depth: number } {
  return radiusM === undefined ? occupied : { width: Math.max(occupied.width, 2 * radiusM), depth: Math.max(occupied.depth, 2 * radiusM) };
}

/** How far past a group's bounds a chair's footprint may reach (its rotated box at the ring), metres. */
const DOOR_CHECK_MARGIN_M = 0.25;

/**
 * Whether a group of `table` set for `seats` may stand at a spot with every
 * door space clear: judged piece by piece, table and each chair, as the door
 * rule judges a laid floor (keep-doors-clear placedFootprint, door-clear-spaces
 * footprintInKeepOut), so Fill never sets a group the door notice would then
 * name, nor leaves out one whose chairs miss the door. A group whose bounds
 * stay well clear of every space is clear without being built. The seats are
 * `chairSlug`, the event's unless named (as createTableGroup sets them).
 */
export function groupClearOfDoors(
  table: CatalogueItem,
  seats: number,
  bounds: { readonly width: number; readonly depth: number },
  doorSpaces: readonly LayoutRect[],
  chairSlug?: string,
): (spot: { readonly xM: number; readonly zM: number; readonly rotationY: number }) => boolean {
  return (spot) => {
    const near: LayoutRect = { cx: spot.xM, cz: spot.zM, width: bounds.width + 2 * DOOR_CHECK_MARGIN_M, depth: bounds.depth + 2 * DOOR_CHECK_MARGIN_M };
    if (!doorSpaces.some((space) => rectsOverlap(near, space))) return true;
    const pieces = createTableGroup(table.id, toRenderSpace(spot.xM), toRenderSpace(spot.zM), spot.rotationY, seats, 0, undefined, "around", chairSlug);
    return pieces.every((piece) => {
      const footprint = placedFootprint(piece);
      return footprint === null || !doorSpaces.some((space) => footprintInKeepOut(footprint, space));
    });
  };
}

/** Whether a seat of `chair` at `seat` stands in any of `spaces`, by the door rule's own test (footprintInKeepOut). */
function seatInSpaces(chair: CatalogueItem, seat: TheatreSeatPlacement, spaces: readonly LayoutRect[]): boolean {
  const { halfW, halfD } = computeRotatedFootprint(chair, seat.rotationY);
  const footprint = { x: seat.xM, z: seat.zM, halfW: toRealWorld(halfW), halfD: toRealWorld(halfD) };
  return spaces.some((space) => footprintInKeepOut(footprint, space));
}

/**
 * The fewest seats the walls of a room's own floor may leave a theatre row.
 * A row they cut down to one or two, a lone chair in each alcove mouth at the
 * back of the Saloon, is no row: it is left out.
 */
const FLOOR_ROW_MIN_SEATS = 3;

/**
 * Whether a seat (metres, in the room) stands on the floor for every chair
 * it may be set with: the chair wholly inside the walls, and the seat the
 * rows' wall band from every wall, as the rows keep it from a rectangle's
 * back wall.
 */
function seatOnFloor(floor: RoomFloor, kinds: readonly ChairSupply[], seat: TheatreSeatPlacement): boolean {
  const x = toRenderSpace(seat.xM);
  const z = toRenderSpace(seat.zM);
  if (!discWithinFloor(floor, x, z, toRenderSpace(THEATRE_SPACING.wallClearanceM))) return false;
  return kinds.every((kind) => {
    const { halfW, halfD } = computeRotatedFootprint(kind.item, seat.rotationY);
    return rectWithinFloor(floor, x, z, halfW, halfD);
  });
}

/**
 * Plan theatre rows for `guests` (0 fills the room): of `chair`, or of the
 * chairs in `options.chairSupply`, each row one kind in the hall's order, as
 * many as the hall has. A seat in a door's clear space (`options.doorSpaces`)
 * for any of those chairs is left out, and rows are taken whole from the front
 * until the guests are seated or the chairs run out.
 */
export function planTheatreFill(
  chair: CatalogueItem,
  guests: number,
  roomWidthM: number,
  roomLengthM: number,
  options: FillOptions = {},
): TheatreFillPlan | null {
  const doorSpaces = options.doorSpaces ?? [];
  if (chair.category !== "chair") return null;
  const supply = options.chairSupply ?? [{ item: chair, inStore: null }];
  const target = requested(guests);
  const { floor } = options;
  if (doorSpaces.length === 0 && floor === undefined) {
    const plan = planTheatreLayout(roomWidthM, roomLengthM, { targetGuests: target ?? undefined });
    const set = seatRowsFromSupply(rowsOf(plan.seats, plan.seatsPerRow), supply, null);
    if (set.seats.length === 0) return null;
    const room = target === null ? plan : planTheatreLayout(roomWidthM, roomLengthM);
    return {
      style: "theatre",
      chairItemId: set.seats[0]?.chairItemId ?? chair.id,
      seats: set.seats,
      chairs: set.seats.length,
      rows: set.rows,
      guests: target,
      roomForSeats: room.seatCount,
      meetsTarget: target === null || set.seats.length >= target,
      doorsKeptClear: false,
      roomForSeatsIgnoringDoors: room.seatCount,
      chairKinds: chairKindsOf(set.seats),
      chairsRanOut: set.ranOut,
    };
  }
  const room = planTheatreLayout(roomWidthM, roomLengthM);
  // On a room's own floor the rows stand on the floor's bounds, and a seat outside its walls is left out as one in a door's space is.
  const origin = layoutOrigin(floor);
  const laid = rowsOf(room.seats, room.seatsPerRow);
  const standing = floor === undefined
    ? laid
    : laid
      .map((row) => row
        .map((seat) => ({ ...seat, xM: seat.xM + origin.xM, zM: seat.zM + origin.zM }))
        .filter((seat) => seatOnFloor(floor, supply, seat)))
      .filter((row) => row.length >= FLOOR_ROW_MIN_SEATS);
  const rows = standing
    .map((row) => row.filter((seat) => !supply.some((kind) => seatInSpaces(kind.item, seat, doorSpaces))))
    .filter((row) => row.length > 0);
  const set = seatRowsFromSupply(rows, supply, target);
  if (set.seats.length === 0) return null;
  return {
    style: "theatre",
    chairItemId: set.seats[0]?.chairItemId ?? chair.id,
    seats: set.seats,
    chairs: set.seats.length,
    rows: set.rows,
    guests: target,
    roomForSeats: rows.reduce((sum, row) => sum + row.length, 0),
    meetsTarget: target === null || set.seats.length >= target,
    doorsKeptClear: doorSpaces.length > 0,
    roomForSeatsIgnoringDoors: floor === undefined ? room.seatCount : standing.reduce((sum, row) => sum + row.length, 0),
    chairKinds: chairKindsOf(set.seats),
    chairsRanOut: set.ranOut,
  };
}

/** The fill a style places with the planner's own furniture: 6 ft rounds set
 *  for the catalogue's recorded seats (each seat the event's chair, through the
 *  table group), or rows of `rowChairSlug`, the event's chair unless named,
 *  then the hall's other chairs in its order as each runs out (plannerChairSupply,
 *  unless `options.chairSupply` names them); either clear of the room's doors
 *  (`options.doorSpaces`). */
export function planAutoFill(
  style: AutoFillStyle,
  guests: number,
  roomWidthM: number,
  roomLengthM: number,
  rowChairSlug: string = plannerChairSlug(),
  options: FillOptions = {},
): AutoFillPlan | null {
  if (style === "dinner-rounds") {
    const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
    if (table === undefined) return null;
    return planBanquetFill(table, guests, banquetSeatsPerTable(table), roomWidthM, roomLengthM, options);
  }
  const chair = getCatalogueItemBySlug(rowChairSlug);
  if (chair === undefined) return null;
  return planTheatreFill(chair, guests, roomWidthM, roomLengthM, { ...options, chairSupply: options.chairSupply ?? plannerChairSupply(rowChairSlug) });
}

// ---------------------------------------------------------------------------
// Fill the room with gangways (card-dock Q-10, B5, design (b), 25 Oct 2026)
//
// Designated gangways, kept clear chair back to chair back, run along chosen
// walls (and, in a wide room, down the middle) so that every exit opens onto
// one and they join into one route. Between other tables the planner's own
// banquet spacing holds. Seat reach adapts the guidance's "no seat more than
// seven seats from a gangway" (a rule for rows of seats) to tables: every
// table borders a gangway or is one table from one. Every way of setting the
// gangways is tried and the one that seats the most is used; the figure it
// reaches is the figure Fill states, beside the venue's published one.
// ---------------------------------------------------------------------------

/**
 * The aisle rule Fill keeps, chosen by Blake on 25 Oct 2026 ("use guidance
 * of 1.1 but allow them to place it smaller, hallkeeper or venue staff will
 * approve or deny or send adjustment"). Trades Hall is in Scotland, so the
 * Scottish guidance applies, not England's: an escape route of 1100 mm
 * where more than 100 people use it (para 244), gangways that allow ease of
 * escape for the numbers present (para 250). Between other tables, the
 * planner's banquet spacing (BANQUET_CHAIR_CLEARANCE_M). One set of
 * figures: the hall's own fire risk assessment replaces it.
 */
export const FILL_AISLE_RULE: AisleRule = {
  gangwayM: 1.1,
  betweenTablesM: BANQUET_CHAIR_CLEARANCE_M,
  wallBandM: BANQUET_CHAIR_CLEARANCE_M,
  source: "Scottish Government, Practical fire safety guidance for existing non-residential premises, chapter 7, paragraphs 244 and 250",
};

/** The aisle rule Fill keeps. One set of figures with its source, so the hall's own fire risk assessment can replace it. */
export interface AisleRule {
  /** Designated gangways: clear chair back to chair back, metres. */
  readonly gangwayM: number;
  /** Between any other two tables, chair back to chair back, metres. */
  readonly betweenTablesM: number;
  /** Kept from a wall that carries no gangway, metres. */
  readonly wallBandM: number;
  /** Where the figures come from, as the panel cites them. */
  readonly source: string;
}

/** A wall of the planner's room-centred rectangle: the low or high X wall, the low or high Z wall. */
export type RoomSide = "xMin" | "xMax" | "zMin" | "zMax";

const ROOM_SIDES: readonly RoomSide[] = ["xMin", "xMax", "zMin", "zMax"];

/** A way out of the room, by the wall it opens in. */
export interface RoomExit {
  readonly side: RoomSide;
  readonly label: string;
}

const HALL_WALL_SIDES: Readonly<Record<HallWallId, RoomSide>> = {
  fireplace: "xMin",
  end: "xMax",
  window: "zMin",
  door: "zMax",
};

/** The Grand Hall's doors, from the survey (hall-spec): three in the door wall and the fire exit beside the fireplace. */
export function grandHallExits(): readonly RoomExit[] {
  return HALL_OPENINGS
    .filter((opening) => opening.kind === "door")
    .map((opening) => ({ side: HALL_WALL_SIDES[opening.wall], label: opening.id }));
}

/** Which walls carry a gangway, and whether one runs down the middle along the room's long axis. */
export interface GangwayLayout {
  readonly sides: Readonly<Record<RoomSide, boolean>>;
  readonly spine: boolean;
}

/** Walls that meet at a corner, so gangways along them join. */
function adjacent(a: RoomSide, b: RoomSide): boolean {
  return a[0] !== b[0];
}

/**
 * Whether a layout's gangways reach every exit and join into one route.
 * With no exits known, every wall carries one, so any door in any wall
 * opens onto a gangway.
 */
export function gangwaysServeExits(layout: GangwayLayout, exits: readonly RoomExit[] | null, longAxis: "x" | "z"): boolean {
  if (exits === null || exits.length === 0) return ROOM_SIDES.every((side) => layout.sides[side]);
  if (!exits.every((exit) => layout.sides[exit.side])) return false;
  const nodes: string[] = [...ROOM_SIDES.filter((side) => layout.sides[side]), ...(layout.spine ? ["spine"] : [])];
  const spineEnds: readonly RoomSide[] = longAxis === "x" ? ["xMin", "xMax"] : ["zMin", "zMax"];
  const joined = (a: string, b: string): boolean => {
    if (a === "spine" || b === "spine") return spineEnds.includes((a === "spine" ? b : a) as RoomSide);
    return adjacent(a as RoomSide, b as RoomSide);
  };
  const reached = new Set<string>(nodes.slice(0, 1));
  for (let grew = true; grew;) {
    grew = false;
    for (const node of nodes) {
      if (reached.has(node) || ![...reached].some((other) => joined(node, other))) continue;
      reached.add(node);
      grew = true;
    }
  }
  return reached.size === nodes.length;
}

/** The floor each gangway keeps clear, metres, room-centred. */
function gangwayRects(layout: GangwayLayout, roomWidthM: number, roomLengthM: number, gangwayM: number, longAxis: "x" | "z"): readonly LayoutRect[] {
  const rects: LayoutRect[] = [];
  const { sides } = layout;
  if (sides.xMin) rects.push({ cx: -roomWidthM / 2 + gangwayM / 2, cz: 0, width: gangwayM, depth: roomLengthM });
  if (sides.xMax) rects.push({ cx: roomWidthM / 2 - gangwayM / 2, cz: 0, width: gangwayM, depth: roomLengthM });
  if (sides.zMin) rects.push({ cx: 0, cz: -roomLengthM / 2 + gangwayM / 2, width: roomWidthM, depth: gangwayM });
  if (sides.zMax) rects.push({ cx: 0, cz: roomLengthM / 2 - gangwayM / 2, width: roomWidthM, depth: gangwayM });
  if (layout.spine) {
    rects.push(longAxis === "x"
      ? { cx: 0, cz: 0, width: roomWidthM, depth: gangwayM }
      : { cx: 0, cz: 0, width: gangwayM, depth: roomLengthM });
  }
  return rects;
}

/** Clear distance from a round group (centre, radius) to a rect; negative inside it. */
function gapToRect(table: BanquetTablePlacement, radiusM: number, rect: LayoutRect): number {
  const dx = Math.max(Math.abs(table.xM - rect.cx) - rect.width / 2, 0);
  const dz = Math.max(Math.abs(table.zM - rect.cz) - rect.depth / 2, 0);
  return Math.hypot(dx, dz) - radiusM;
}

/** Neighbouring groups this close (centre to centre, as a share of one table and one aisle) have no table between them. */
const NEIGHBOUR_REACH = 1.2;

/**
 * Seat reach, adapted for tables: every table borders a gangway (no table
 * between it and the gangway, within one aisle) or is one table from one.
 */
export function seatReach(
  tables: readonly BanquetTablePlacement[],
  radiusM: number,
  aisleM: number,
  gangways: readonly LayoutRect[],
): boolean {
  const borders = tables.map((table) => gangways.some((rect) => gapToRect(table, radiusM, rect) <= aisleM + 1e-6));
  const near = (2 * radiusM + aisleM) * NEIGHBOUR_REACH;
  return tables.every((table, i) => borders[i] === true || tables.some((other, j) => (
    borders[j] === true && Math.hypot(table.xM - other.xM, table.zM - other.zM) <= near
  )));
}

export interface GangwayFillInput {
  readonly table: CatalogueItem;
  readonly seatsPerTable: number;
  /** The guests asked for; 0 fills the room. */
  readonly guests: number;
  readonly roomWidthM: number;
  readonly roomLengthM: number;
  /** The room's ways out, or null when they are not recorded. */
  readonly exits: readonly RoomExit[] | null;
  readonly rule: AisleRule;
  /** Pieces kept where they are (a top table, a dance floor, the bar): no table may stand in them. */
  readonly keepOuts?: readonly LayoutRect[];
  /** The room's door clear spaces (doorKeepOuts): no table may stand in them either. */
  readonly doorSpaces?: readonly LayoutRect[];
  /** The room's floor, where its walls are not the centred rectangle of its size (FillOptions.floor): no table stands outside them. */
  readonly floor?: RoomFloor;
}

export interface GangwayFillPlan extends BanquetFillPlan {
  readonly layout: GangwayLayout;
  /** The floor the gangways keep clear, metres, room-centred. */
  readonly gangways: readonly LayoutRect[];
  readonly rule: AisleRule;
}

/** Every way of setting gangways: each wall with or without one, then with a spine; fewest gangways first. */
function gangwayLayouts(): readonly GangwayLayout[] {
  const layouts: GangwayLayout[] = [];
  for (const spine of [false, true]) {
    for (let mask = 0; mask < 16; mask += 1) {
      const sides = { xMin: (mask & 1) !== 0, xMax: (mask & 2) !== 0, zMin: (mask & 4) !== 0, zMax: (mask & 8) !== 0 };
      layouts.push({ sides, spine });
    }
  }
  const count = (layout: GangwayLayout): number => ROOM_SIDES.filter((side) => layout.sides[side]).length + (layout.spine ? 1 : 0);
  return layouts.sort((a, b) => count(a) - count(b));
}

/** Tables in one rectangle of the room: its walls' bands as given, laid out by the banquet engine. */
function packRegion(
  input: GangwayFillInput,
  region: { readonly cx: number; readonly cz: number; readonly width: number; readonly depth: number },
  walls: WallClearances,
  radiusM: number,
  occupied: { readonly width: number; readonly depth: number },
  accept: (tables: readonly BanquetTablePlacement[]) => boolean,
  admit?: (spot: BanquetTablePlacement) => boolean,
): readonly BanquetTablePlacement[] {
  const toRoom = (table: BanquetTablePlacement): BanquetTablePlacement => ({ ...table, xM: table.xM + region.cx, zM: table.zM + region.cz });
  const shift = (tables: readonly BanquetTablePlacement[]): readonly BanquetTablePlacement[] => tables.map(toRoom);
  const plan = planBanquetLayout({
    roomWidthM: region.width,
    roomLengthM: region.depth,
    tableWidthM: occupied.width,
    tableDepthM: occupied.depth,
    tableRadiusM: radiusM,
    seatsPerTable: input.seatsPerTable,
    aisleM: input.rule.betweenTablesM,
    wallClearanceM: walls,
    keepOuts: (input.keepOuts ?? []).map((rect) => ({ ...rect, cx: rect.cx - region.cx, cz: rect.cz - region.cz })),
    admit: admit === undefined ? undefined : (spot) => admit(toRoom(spot)),
    accept: (tables) => accept(shift(tables)),
  });
  return shift(plan.tables);
}

/**
 * Fill the room with `input.table` groups for the guests (0 fills it), with
 * designated gangways to every exit, the planner's spacing between other
 * tables, and every table in reach of a gangway. Null when the table is not
 * seated dining or no layout holds a single group.
 */
export function planGangwayFill(input: GangwayFillInput): GangwayFillPlan | null {
  const { table, rule, roomWidthM, roomLengthM } = input;
  if (!isDiningTableItem(table)) return null;
  const seats = Math.min(seatCapacity(table), Math.max(0, Math.floor(input.seatsPerTable)));
  if (seats === 0) return null;
  const occupied = tableGroupPlanningFootprint(table, seats);
  const radiusM = table.tableShape === "round"
    ? tableGroupPlanningRadius(table, seats)
    : Math.hypot(occupied.width, occupied.depth) / 2;
  const longAxis = roomWidthM >= roomLengthM ? "x" : "z";
  const band = (side: RoomSide, layout: GangwayLayout): number => (layout.sides[side] ? rule.gangwayM : rule.wallBandM);
  // On a room's own floor the design stands on the floor's bounds, and a group stands only inside its walls.
  const { floor } = input;
  const origin = layoutOrigin(floor);
  const inRoom = (rect: LayoutRect): LayoutRect => (floor === undefined ? rect : { ...rect, cx: rect.cx + origin.xM, cz: rect.cz + origin.zM });
  const gangwaysOf = (layout: GangwayLayout): readonly LayoutRect[] => gangwayRects(layout, roomWidthM, roomLengthM, rule.gangwayM, longAxis).map(inRoom);
  const onFloor = floor === undefined ? undefined : groupOnFloor(floor, occupied, table.tableShape === "round" ? radiusM : undefined, rule.wallBandM);
  const admitting = (doorRule: ((spot: BanquetTablePlacement) => boolean) | undefined): ((spot: BanquetTablePlacement) => boolean) | undefined => (
    onFloor === undefined ? doorRule : (spot) => onFloor(spot) && (doorRule === undefined || doorRule(spot))
  );

  /** The way of setting the gangways that holds the most tables, each one `admit` lets stand. */
  const search = (admit: ((spot: BanquetTablePlacement) => boolean) | undefined): { readonly layout: GangwayLayout; readonly tables: readonly BanquetTablePlacement[] } | null => {
    const packing: GangwayFillInput = { ...input, seatsPerTable: seats };
    let found: { readonly layout: GangwayLayout; readonly tables: readonly BanquetTablePlacement[] } | null = null;
    for (const layout of gangwayLayouts()) {
      if (!gangwaysServeExits(layout, input.exits, longAxis)) continue;
      const gangways = gangwaysOf(layout);
      const reach = (tables: readonly BanquetTablePlacement[]): boolean => seatReach(tables, radiusM, rule.betweenTablesM, gangways);
      const walls: WallClearances = { xMin: band("xMin", layout), xMax: band("xMax", layout), zMin: band("zMin", layout), zMax: band("zMax", layout) };
      let tables: readonly BanquetTablePlacement[];
      if (!layout.spine) {
        tables = packRegion(packing, inRoom({ cx: 0, cz: 0, width: roomWidthM, depth: roomLengthM }), walls, radiusM, occupied, reach, admit);
      } else if (longAxis === "x") {
        // Two halves either side of a spine running along X; each keeps its own wall's band and nothing at the spine.
        const half = (roomLengthM - rule.gangwayM) / 2;
        const offset = (rule.gangwayM + half) / 2;
        tables = [
          ...packRegion(packing, inRoom({ cx: 0, cz: -offset, width: roomWidthM, depth: half }), { ...walls, zMax: 0 }, radiusM, occupied, reach, admit),
          ...packRegion(packing, inRoom({ cx: 0, cz: offset, width: roomWidthM, depth: half }), { ...walls, zMin: 0 }, radiusM, occupied, reach, admit),
        ];
      } else {
        const half = (roomWidthM - rule.gangwayM) / 2;
        const offset = (rule.gangwayM + half) / 2;
        tables = [
          ...packRegion(packing, inRoom({ cx: -offset, cz: 0, width: half, depth: roomLengthM }), { ...walls, xMax: 0 }, radiusM, occupied, reach, admit),
          ...packRegion(packing, inRoom({ cx: offset, cz: 0, width: half, depth: roomLengthM }), { ...walls, xMin: 0 }, radiusM, occupied, reach, admit),
        ];
      }
      if (found === null || tables.length > found.tables.length) found = { layout, tables };
    }
    return found;
  };
  const doorSpaces = input.doorSpaces ?? [];
  const doorsKeptClear = doorSpaces.length > 0;
  const bounds = groupBounds(occupied, table.tableShape === "round" ? radiusM : undefined);
  const best = search(admitting(doorsKeptClear ? groupClearOfDoors(table, seats, bounds, doorSpaces) : undefined));
  if (best === null || best.tables.length === 0) return null;
  // The figure the line sets beside it: the same search with the doors left out.
  const ignoringDoors = doorsKeptClear ? search(admitting(undefined)) : best;

  const target = requested(input.guests);
  const wanted = target === null ? best.tables.length : Math.min(best.tables.length, Math.ceil(target / seats));
  const placed = [...best.tables]
    // Nearest the middle of the layout first, wherever the room's floor puts it.
    .sort((a, b) => Math.hypot(a.xM - origin.xM, a.zM - origin.zM) - Math.hypot(b.xM - origin.xM, b.zM - origin.zM) || a.zM - b.zM || a.xM - b.xM)
    .slice(0, wanted)
    .sort((a, b) => a.zM - b.zM || a.xM - b.xM);
  return {
    style: "dinner-rounds",
    tableItemId: table.id,
    round: table.tableShape === "round",
    tables: placed,
    seatsPerTable: seats,
    tableCount: placed.length,
    chairs: placed.length * seats,
    guests: target,
    roomForSeats: best.tables.length * seats,
    meetsTarget: target === null || placed.length * seats >= target,
    doorsKeptClear,
    roomForSeatsIgnoringDoors: (ignoringDoors?.tables.length ?? 0) * seats,
    layout: best.layout,
    gangways: gangwaysOf(best.layout),
    rule,
  };
}

// ---------------------------------------------------------------------------
// Gangways a hand-made layout narrows (Blake, 25 Oct 2026): placing is never
// refused for gangway width; a gangway under the guidance is measured and
// listed for the venue's staff to approve, deny or adjust. The gangways are
// the room's designated ones, as Fill's own design sets them from its doors,
// so the review, the ghost's flag and Fill's figures always agree.
// ---------------------------------------------------------------------------

/** The room's designated gangways: Fill's design for the room with the planner's own rounds. */
export interface DesignatedGangways {
  readonly layout: GangwayLayout;
  /** Each gangway's floor, metres, room-centred, with the wall it runs along (null for a spine). */
  readonly bands: readonly { readonly side: RoomSide | null; readonly rect: LayoutRect }[];
}

const designatedCache = new Map<string, DesignatedGangways | null>();

/**
 * The designated gangways of a room (metres), or null when no layout of the
 * planner's rounds fits it. With the room's door clear spaces (`doorSpaces`),
 * the design Fill makes keeping them clear, which can set the gangways
 * differently.
 */
export function designatedGangways(
  roomWidthM: number,
  roomLengthM: number,
  exits: readonly RoomExit[] | null,
  rule: AisleRule = FILL_AISLE_RULE,
  doorSpaces: readonly LayoutRect[] = [],
  /** The room's floor, where its walls are not the centred rectangle of its size: the gangways then run along the floor's bounds, where those stand. */
  floor?: RoomFloor,
): DesignatedGangways | null {
  const doors = doorSpaces.map((space) => [space.cx, space.cz, space.width, space.depth].join(",")).join(";");
  const walls = floor === undefined ? "" : floor.outline.map(([x, z]) => `${String(x)},${String(z)}`).join(";");
  const key = [roomWidthM, roomLengthM, rule.gangwayM, rule.betweenTablesM, rule.wallBandM, exits?.map((exit) => exit.side).sort().join(",") ?? "unknown", doors, walls].join("|");
  const cached = designatedCache.get(key);
  if (cached !== undefined || designatedCache.has(key)) return cached ?? null;
  const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
  const plan = table === undefined
    ? null
    : planGangwayFill({ table, seatsPerTable: banquetSeatsPerTable(table), guests: 0, roomWidthM, roomLengthM, exits, rule, doorSpaces, floor });
  const longAxis = roomWidthM >= roomLengthM ? "x" : "z";
  // On a room's own floor each band stands where the floor's bounds do.
  const origin = layoutOrigin(floor);
  const inRoom = (rect: LayoutRect): LayoutRect => (floor === undefined ? rect : { ...rect, cx: rect.cx + origin.xM, cz: rect.cz + origin.zM });
  const result = plan === null ? null : {
    layout: plan.layout,
    bands: [
      ...ROOM_SIDES.filter((side) => plan.layout.sides[side]).map((side) => ({
        side,
        rect: inRoom(gangwayRects({ sides: { xMin: side === "xMin", xMax: side === "xMax", zMin: side === "zMin", zMax: side === "zMax" }, spine: false }, roomWidthM, roomLengthM, rule.gangwayM, longAxis)[0] ?? { cx: 0, cz: 0, width: 0, depth: 0 }),
      })),
      ...(plan.layout.spine ? [{ side: null, rect: inRoom(gangwayRects({ sides: { xMin: false, xMax: false, zMin: false, zMax: false }, spine: true }, roomWidthM, roomLengthM, rule.gangwayM, longAxis)[0] ?? { cx: 0, cz: 0, width: 0, depth: 0 }) }] : []),
    ],
  };
  designatedCache.set(key, result);
  return result;
}

/** The Grand Hall's walls as its staff name them. */
export const GRAND_HALL_WALL_NAMES: Readonly<Record<RoomSide, string>> = {
  xMin: "the fireplace wall",
  xMax: "the end wall",
  zMin: "the window wall",
  zMax: "the door wall",
};

const PLAIN_WALL_NAMES: Readonly<Record<RoomSide, string>> = { xMin: "the wall", xMax: "the wall", zMin: "the wall", zMax: "the wall" };

/** Sides of the outline drawn round a round table: exact against the walls, at most 5 mm wide of the disc anywhere else. */
const ROUND_OUTLINE_SIDES = 32;

/**
 * A placed piece's floor outline, metres, room-centred: its turned
 * rectangle, or round a round table a polygon whose edges touch the disc
 * where it faces each wall (so it never reads a gap wider than it is). The
 * one outline the review and the ghost's live aisles both measure, so they
 * never measure one gap two ways. Against the walls of a room's own floor,
 * which the live aisles do not measure, the review takes a round table as the
 * disc it is (floorWallPinches): those walls slant and turn corners, where
 * the outline would read up to 5 mm narrow.
 */
export function floorOutline(placed: PlacedItem, item: CatalogueItem): readonly FloorPoint[] {
  const scale = placed.scale ?? 1;
  const x = toRealWorld(placed.x);
  const z = toRealWorld(placed.z);
  if (item.tableShape === "round") {
    const r = (item.width * scale) / 2 / Math.cos(Math.PI / ROUND_OUTLINE_SIDES);
    return Array.from({ length: ROUND_OUTLINE_SIDES }, (_, i) => {
      const angle = ((i + 0.5) * 2 * Math.PI) / ROUND_OUTLINE_SIDES;
      return { x: x + r * Math.cos(angle), z: z + r * Math.sin(angle) };
    });
  }
  const hw = (item.width * scale) / 2;
  const hd = (item.depth * scale) / 2;
  const cos = Math.cos(placed.rotationY);
  const sin = Math.sin(placed.rotationY);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx = 0, lz = 0]) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos }));
}

/** Whether a gangway this wide is under the guidance: the one test the review, the flag and the live aisles share. */
export function underGuidance(widthM: number, rule: AisleRule = FILL_AISLE_RULE): boolean {
  return widthM < rule.gangwayM - 1e-9;
}

/**
 * Which side of a middle gangway's centre line a unit (a table with its
 * chairs, a set, a lone piece) stands on: the side the middle of all its
 * outlines, across the gangway, is on. Decided for the whole unit, never
 * piece by piece, so a chair reaching past the line still counts as its
 * table's side.
 */
export function spineSide(points: readonly FloorPoint[], spine: LayoutRect): "low" | "high" {
  const alongX = spine.width >= spine.depth;
  const across = points.map((point) => (alongX ? point.z - spine.cz : point.x - spine.cx));
  return (Math.min(...across) + Math.max(...across)) / 2 < 0 ? "low" : "high";
}

/** A point's distance from a wall of the room, metres. */
function wallDistance(side: RoomSide, point: FloorPoint, roomWidthM: number, roomLengthM: number): number {
  switch (side) {
    case "xMin": return point.x + roomWidthM / 2;
    case "xMax": return roomWidthM / 2 - point.x;
    case "zMin": return point.z + roomLengthM / 2;
    case "zMax": return roomLengthM / 2 - point.z;
  }
}

/** The floor of a gangway between two places along its run. */
function gangwayStretch(band: LayoutRect, from: number, to: number): readonly FloorPoint[] {
  if (band.width >= band.depth) {
    const lo = Math.max(from, band.cx - band.width / 2);
    const hi = Math.max(lo, Math.min(to, band.cx + band.width / 2));
    const near = band.cz - band.depth / 2;
    const far = band.cz + band.depth / 2;
    return [{ x: lo, z: near }, { x: hi, z: near }, { x: hi, z: far }, { x: lo, z: far }];
  }
  const lo = Math.max(from, band.cz - band.depth / 2);
  const hi = Math.max(lo, Math.min(to, band.cz + band.depth / 2));
  const near = band.cx - band.width / 2;
  const far = band.cx + band.width / 2;
  return [{ x: near, z: lo }, { x: near, z: hi }, { x: far, z: hi }, { x: far, z: lo }];
}

/** One pinch as measured, before it is named and given its id. */
interface Pinch {
  readonly gangway: RoomSide | "spine";
  readonly band: LayoutRect;
  readonly gangwayName: string;
  readonly sides: readonly GangwaySide[];
  readonly sideNames: readonly string[];
  readonly widthM: number;
  /** The stretch it narrows, along the gangway's run (x or z), metres room-centred. */
  readonly from: number;
  readonly to: number;
  readonly pieceIds: readonly string[];
  /** Along the walls of a room's own floor: the floor it narrows, already drawn inside those walls (floorWallPinches). */
  readonly stretch?: readonly FloorPoint[];
}

// ---------------------------------------------------------------------------
// A room's own floor (lib/room-floor): its gangways run along the walls that
// are there. Fill's design still says which sides of the room carry one.
//
// A wall is on the side of a unit (a table with its chairs, a set, a lone
// piece) the gap to it runs from. Where a piece of the unit stands in front
// of a wall, its nearest face between the wall's ends, that gap runs square
// to the wall, so the side is read from the wall's own normal, which does not
// move as the unit is nudged. A wall the unit comes nearest only at its end
// has no gangway of its own there: the gap is to the corner, which is the end
// of the wall round it too. A corner goes with whichever of its two walls the
// unit is nearer to standing in front of (cornerGoesWithNext): it is part of
// that wall's gangway where a piece of the unit stands in front of the wall,
// and a pinch of its own, on that wall's side, where none does. For a round
// unit that is the side the way from the corner to it mostly runs, and the
// corner is already with a wall when the unit comes to stand in front of it.
// So the Robert Adam Room's curve is a wall to the west of a table beside it,
// and the pier between two Saloon alcoves, its face and both its corners, is
// one wall to the east of a table in front of it. A corner's gap is listed
// once, under an id that changes at most once as its unit is carried straight
// past the corner; a unit that reaches in front of both walls of a corner has
// an item on each side, each the gangway of the wall on that side.
//
// Set against a wall (touching it, or through it) a piece is against it only
// where it meets the wall between its ends (liesAgainst). A piece that lies
// along one wall, and so reaches the end of the wall round the corner, has
// reached that wall's end and no more. There is then no way between the piece
// and the wall it lies along, so no way round the corner: the 0.00 m is that
// wall's alone. The piece is not measured to the wall round the corner, whose
// item is the gap from the unit's other pieces that stand in front of it, if
// any do, and the corner is no second pinch. A piece that touches a corner
// while lying against neither of its walls shuts the corner itself: 0.00 m
// on the side the corner goes with. Where the piece lies against a wall in
// line with one of the two, that is the one: a piece set along a wall across
// a doorway, its end at the far jamb, lies against the wall this side of the
// doorway, the wall beyond the doorway is in line with it, and the touch at
// the jamb is listed with that wall's side, not as a gangway to the unit's
// east or west.
//
// Where an item is drawn (gangwayFloor): the gangway floor inside each wall
// it narrows, between the unit's ends along that wall, and at each corner
// whose gap is its own, each kept to the room's floor. Not the floor between
// them: the mouth of an alcove the unit does not narrow is not drawn.
// ---------------------------------------------------------------------------

/** A wall of a room's own floor, metres: one straight wall whole, its ends, the unit vector along it with its length, and the unit normal into the room. */
interface FloorWallM {
  readonly ends: readonly [FloorPoint, FloorPoint];
  readonly alongX: number;
  readonly alongZ: number;
  readonly lengthM: number;
  readonly intoX: number;
  readonly intoZ: number;
}

/** How near a wall counts as against it, metres: a thousandth of a millimetre, as lib/room-floor has it. */
const AGAINST_M = 1e-6;

/** Under this two measures are one, metres: a sum's last bits never choose between them. */
const SAME_M = 1e-9;

/** How near a wall's end a touch is the corner's, metres: a piece that meets a wall only within a millimetre of its end has reached the corner, not come to lie against the wall. */
const AT_END_M = 1e-3;

/** The least floor a location is drawn on, square metres: a centimetre of wall, the guidance deep. */
const LEAST_FLOOR_M2 = 0.01;

/** The side of the square marked on the floor at a place whose own floor comes to less than that, metres. */
const MARK_M = 0.3;

/** Whether `next` begins where `wall` ends and runs the same way: two stretches of one straight wall. */
function runsOn(wall: FloorWallM, next: FloorWallM): boolean {
  return Math.hypot(next.ends[0].x - wall.ends[1].x, next.ends[0].z - wall.ends[1].z) <= AGAINST_M
    && Math.abs(wall.alongX * next.alongZ - wall.alongZ * next.alongX) <= SAME_M
    && wall.alongX * next.alongX + wall.alongZ * next.alongZ > 0;
}

/**
 * The walls of a floor in metres, corner to corner in the outline's order,
 * each straight wall whole: an outline may draw one wall as two stretches
 * that meet in line (the Robert Adam Room's west wall at z = 3.7), and the
 * joint is not a corner.
 */
function floorWallsM(floor: RoomFloor): readonly FloorWallM[] {
  const walls: FloorWallM[] = [];
  for (const edge of floor.edges) {
    const from = { x: toRealWorld(edge.ax), z: toRealWorld(edge.az) };
    const to = { x: toRealWorld(edge.bx), z: toRealWorld(edge.bz) };
    const lengthM = Math.hypot(to.x - from.x, to.z - from.z);
    const wall: FloorWallM = { ends: [from, to], alongX: (to.x - from.x) / lengthM, alongZ: (to.z - from.z) / lengthM, lengthM, intoX: edge.nx, intoZ: edge.nz };
    const last = walls[walls.length - 1];
    if (last !== undefined && runsOn(last, wall)) walls[walls.length - 1] = { ...last, ends: [last.ends[0], to], lengthM: last.lengthM + lengthM };
    else walls.push(wall);
  }
  // The outline closes, so its last wall may run on into its first.
  const first = walls[0];
  const last = walls[walls.length - 1];
  if (walls.length > 2 && first !== undefined && last !== undefined && runsOn(last, first)) {
    walls[0] = { ...last, ends: [last.ends[0], first.ends[1]], lengthM: last.lengthM + first.lengthM };
    walls.pop();
  }
  return walls;
}

/**
 * The side of a unit a wall or a corner stands on, by the greater part of the
 * way from it to the unit. A way that runs as much along x as along z counts
 * as x, to within SAME_M, so the last bits of a sum never choose the side.
 */
function sideOfWay(dx: number, dz: number): RoomSide {
  if (Math.abs(dx) >= Math.abs(dz) - SAME_M) return dx > 0 ? "xMin" : "xMax";
  return dz > 0 ? "zMin" : "zMax";
}

/** The floor of the gangway inside a wall, between two places along it (metres from its first end). */
function wallStretch(wall: FloorWallM, from: number, to: number, gangwayM: number): readonly FloorPoint[] {
  const [start] = wall.ends;
  const at = (along: number, into: number): FloorPoint => ({
    x: start.x + wall.alongX * along + wall.intoX * into,
    z: start.z + wall.alongZ * along + wall.intoZ * into,
  });
  return [at(from, 0), at(to, 0), at(to, gangwayM), at(from, gangwayM)];
}

/** A placed piece as the review measures it: its unit, its floor outline and, for a round table, the disc it is. */
interface MeasuredPiece {
  readonly placed: PlacedItem;
  readonly unit: string;
  readonly points: readonly FloorPoint[];
  /** A round table's own disc: against a wall or a corner it is measured as that, exactly, not as its outline. */
  readonly disc: { readonly x: number; readonly z: number; readonly r: number } | null;
}

/** The point of a wall `along` metres from its first end. */
function onWall(wall: FloorWallM, along: number): FloorPoint {
  const [start] = wall.ends;
  return { x: start.x + wall.alongX * along, z: start.z + wall.alongZ * along };
}

/** How far a piece stands from a straight stretch of wall, metres: 0 touching it or through it. */
function pieceToStretch(piece: MeasuredPiece, from: FloorPoint, to: FloorPoint): number {
  if (piece.disc !== null) return Math.max(0, pointSegmentDistance(piece.disc, from, to) - piece.disc.r);
  return convexPolygonClosestPoints(piece.points, [from, to]).distance;
}

/** How far a piece stands from a wall, metres: 0 touching it or through it. */
function pieceToWall(piece: MeasuredPiece, wall: FloorWallM): number {
  return pieceToStretch(piece, wall.ends[0], wall.ends[1]);
}

/**
 * Whether a piece that touches a wall, or is through it, lies against it: it
 * meets the wall somewhere between its ends, more than AT_END_M from both. One
 * that meets it only at an end has reached the corner, which is the end of the
 * wall round it too, and is not against this wall.
 */
function liesAgainst(piece: MeasuredPiece, wall: FloorWallM): boolean {
  if (wall.lengthM <= 2 * AT_END_M) return false;
  return pieceToStretch(piece, onWall(wall, AT_END_M), onWall(wall, wall.lengthM - AT_END_M)) <= AGAINST_M;
}

/** Whether a piece touches a wall within AT_END_M of an end of it: its last end, or its first. */
function touchesEnd(piece: MeasuredPiece, wall: FloorWallM, end: "first" | "last"): boolean {
  const reach = Math.min(AT_END_M, wall.lengthM);
  const [from, to] = end === "last" ? [onWall(wall, wall.lengthM - reach), wall.ends[1]] : [wall.ends[0], onWall(wall, reach)];
  return pieceToStretch(piece, from, to) <= AGAINST_M;
}

/** Whether two walls stand on one line and face the same way, as the walls either side of an alcove's mouth or a door recess do. */
function inLine(wall: FloorWallM, other: FloorWallM): boolean {
  const [start] = wall.ends;
  const [at] = other.ends;
  return wall.intoX * other.intoX + wall.intoZ * other.intoZ > 1 - SAME_M
    && Math.abs((at.x - start.x) * wall.intoX + (at.z - start.z) * wall.intoZ) <= AGAINST_M;
}

/** The point of a piece's edge nearest a point on the floor outside it. */
function nearestOfPiece(piece: MeasuredPiece, point: FloorPoint): FloorPoint {
  if (piece.disc !== null) {
    const off = Math.hypot(point.x - piece.disc.x, point.z - piece.disc.z);
    if (off <= piece.disc.r) return point;
    return { x: piece.disc.x + ((point.x - piece.disc.x) * piece.disc.r) / off, z: piece.disc.z + ((point.z - piece.disc.z) * piece.disc.r) / off };
  }
  return nearestOnOutline(piece.points, point);
}

/** The point of an outline's edge nearest a point. */
function nearestOnOutline(points: readonly FloorPoint[], point: FloorPoint): FloorPoint {
  let nearest = point;
  let least = Number.POSITIVE_INFINITY;
  points.forEach((from, i) => {
    const on = closestPointOnSegment(point, from, points[(i + 1) % points.length] ?? from);
    const off = Math.hypot(on.x - point.x, on.z - point.z);
    if (off < least) {
      least = off;
      nearest = on;
    }
  });
  return nearest;
}

/**
 * Whether a piece stands in front of a wall: the face of it nearest the
 * wall's line lies between the wall's ends, on the room's side. Its gap to the
 * wall then runs square to the wall. A piece past the wall's end, or behind
 * it (the Saloon's piers are 0.3 m thick), does not.
 */
function standsBefore(piece: MeasuredPiece, wall: FloorWallM): boolean {
  const [start] = wall.ends;
  const along = (point: FloorPoint): number => (point.x - start.x) * wall.alongX + (point.z - start.z) * wall.alongZ;
  const into = (point: FloorPoint): number => (point.x - start.x) * wall.intoX + (point.z - start.z) * wall.intoZ;
  if (piece.disc !== null) {
    const at = along(piece.disc);
    return into(piece.disc) - piece.disc.r >= -AGAINST_M && at > AGAINST_M && at < wall.lengthM - AGAINST_M;
  }
  const nearest = Math.min(...piece.points.map(into));
  if (nearest < -AGAINST_M) return false;
  const face = piece.points.filter((point) => into(point) <= nearest + SAME_M).map(along);
  return Math.max(...face) > AGAINST_M && Math.min(...face) < wall.lengthM - AGAINST_M;
}

/** How far along a line from `origin` a piece reaches, least and greatest: a round table as its disc. */
function reachAlong(piece: MeasuredPiece, origin: FloorPoint, alongX: number, alongZ: number): { readonly least: number; readonly greatest: number } {
  if (piece.disc !== null) {
    const centre = (piece.disc.x - origin.x) * alongX + (piece.disc.z - origin.z) * alongZ;
    return { least: centre - piece.disc.r, greatest: centre + piece.disc.r };
  }
  const alongs = piece.points.map((point) => (point.x - origin.x) * alongX + (point.z - origin.z) * alongZ);
  return { least: Math.min(...alongs), greatest: Math.max(...alongs) };
}

/**
 * Which of a corner's two walls the corner goes with for a unit: the one the
 * unit is nearer to standing in front of, by how far the whole unit stops
 * short of each along that wall (less than nothing where it reaches in front
 * of the wall). True for `next`, the wall that begins at the corner; false
 * for `wall`, which ends there.
 *
 * The corner's gap is listed on that wall's side: as part of the wall's own
 * gangway where a piece of the unit stands in front of it, as a pinch of its
 * own where none does. For a round unit that is the side the way from the
 * corner to it mostly runs: south of a unit more to its north than to its
 * west. Carried in a straight line the two shortfalls change evenly, so the
 * corner changes wall at most once, and it is already with a wall when the
 * unit comes to stand in front of that wall. Even shortfalls go to the wall
 * on an x side.
 */
function cornerGoesWithNext(pieces: readonly MeasuredPiece[], wall: FloorWallM, next: FloorWallM): boolean {
  let shortOfWall = Number.POSITIVE_INFINITY;
  let shortOfNext = Number.POSITIVE_INFINITY;
  for (const piece of pieces) {
    shortOfWall = Math.min(shortOfWall, reachAlong(piece, wall.ends[0], wall.alongX, wall.alongZ).least - wall.lengthM);
    shortOfNext = Math.min(shortOfNext, -reachAlong(piece, next.ends[0], next.alongX, next.alongZ).greatest);
  }
  if (Math.abs(shortOfWall - shortOfNext) <= SAME_M) {
    const ofNext = sideOfWay(next.intoX, next.intoZ);
    return ofNext === "xMin" || ofNext === "xMax";
  }
  return shortOfNext < shortOfWall;
}

/** One part of the floor a gangway is narrowed on: the gangway floor inside one wall, or at one corner. */
export interface FloorPart {
  readonly floor: readonly FloorPoint[];
  /** The two places on the walls it runs between, in the order of the walls: the one place twice at a corner. */
  readonly along: readonly [FloorPoint, FloorPoint];
}

/** Twice the floor a polygon winds round, signed: one sign each way round. */
function twiceFloor(points: readonly FloorPoint[]): number {
  let twice = 0;
  points.forEach((from, i) => {
    const to = points[(i + 1) % points.length] ?? from;
    twice += from.x * to.z - to.x * from.z;
  });
  return twice;
}

/** A polygon's corners: its points without any that repeats the one before it or stands on the line between its neighbours. */
function cornersOf(points: readonly FloorPoint[]): FloorPoint[] {
  const kept = [...points];
  let i = 0;
  while (kept.length > 2 && i < kept.length) {
    const before = kept[(i + kept.length - 1) % kept.length];
    const point = kept[i];
    const after = kept[(i + 1) % kept.length];
    if (before === undefined || point === undefined || after === undefined) break;
    const turn = (point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x);
    if (Math.abs(turn) <= SAME_M) {
      kept.splice(i, 1);
      i = 0;
    } else {
      i += 1;
    }
  }
  return kept;
}

/**
 * The room's floor inside a convex part of floor: the room's outline cut by
 * each edge of the part in turn (Sutherland and Hodgman's way), so what is
 * left is inside both. Where that is more than one piece of floor they come
 * back as one outline joined along the part's edge, there and back, which
 * winds round no floor of its own.
 */
function roomWithin(outline: readonly FloorPoint[], part: readonly FloorPoint[]): FloorPoint[] {
  const way = twiceFloor(part) >= 0 ? 1 : -1;
  let kept = [...outline];
  part.forEach((from, i) => {
    const to = part[(i + 1) % part.length] ?? from;
    // How far inside this edge a point is, by the edge's length: nothing on it, less than nothing beyond it.
    const inside = (point: FloorPoint): number => way * ((to.x - from.x) * (point.z - from.z) - (to.z - from.z) * (point.x - from.x));
    const cut: FloorPoint[] = [];
    kept.forEach((point, k) => {
      const before = kept[(k + kept.length - 1) % kept.length] ?? point;
      const here = inside(point);
      const there = inside(before);
      if ((here >= -SAME_M) !== (there >= -SAME_M)) {
        const crossing = there / (there - here);
        cut.push({ x: before.x + (point.x - before.x) * crossing, z: before.z + (point.z - before.z) * crossing });
      }
      if (here >= -SAME_M) cut.push(point);
    });
    kept = cut;
  });
  return cornersOf(kept);
}

function onTheFloor(point: FloorPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

/** A square of floor MARK_M across about a place, as much of it as is in the room: the mark of a pinch with no real floor of its own to draw. */
function markAt(at: FloorPoint, outline: readonly FloorPoint[]): readonly FloorPoint[] {
  const middle = onTheFloor(at) ? at : outline.find(onTheFloor) ?? { x: 0, z: 0 };
  const half = MARK_M / 2;
  const square = [
    { x: middle.x - half, z: middle.z - half },
    { x: middle.x + half, z: middle.z - half },
    { x: middle.x + half, z: middle.z + half },
    { x: middle.x - half, z: middle.z + half },
  ];
  const within = roomWithin(outline, square);
  return Math.abs(twiceFloor(within)) >= 2 * LEAST_FLOOR_M2 ? within : square;
}

/**
 * One part of a pinch's floor as it is drawn: as it stands where it lies
 * wholly in the room, else what of it does (the gangway inside a wall is cut
 * short where another wall stands less than the guidance in front of it);
 * and where that is no real floor, under LEAST_FLOOR_M2, a mark at its place.
 */
function partOnFloor(part: FloorPart, outline: readonly FloorPoint[]): readonly FloorPoint[] {
  const floor = part.floor.filter(onTheFloor);
  if (floor.length >= 3) {
    const within = roomWithin(outline, floor);
    const kept = Math.abs(twiceFloor(within));
    const whole = Math.abs(twiceFloor(floor));
    if (kept >= 2 * LEAST_FLOOR_M2) return whole >= 2 * LEAST_FLOOR_M2 && kept >= whole - SAME_M ? floor : within;
  }
  const [from, to] = part.along;
  return markAt({ x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }, outline);
}

/** Which corner of a polygon is nearest a place. */
function nearestCorner(points: readonly FloorPoint[], place: FloorPoint): number {
  let nearest = 0;
  let least = Number.POSITIVE_INFINITY;
  points.forEach((point, i) => {
    const off = Math.hypot(point.x - place.x, point.z - place.z);
    if (off < least) {
      least = off;
      nearest = i;
    }
  });
  return nearest;
}

/**
 * The room's corners passed going round its walls from one place on them to
 * another, the way the outline runs. None where both stand on one wall in
 * that order, or where either stands on no wall.
 */
function cornersBetween(from: FloorPoint, to: FloorPoint, outline: readonly FloorPoint[]): FloorPoint[] {
  // Which wall of the outline a place stands on, and how far along it.
  const whereOnWalls = (place: FloorPoint): { readonly wall: number; readonly along: number } | null => {
    for (const [wall, start] of outline.entries()) {
      const end = outline[(wall + 1) % outline.length] ?? start;
      const on = closestPointOnSegment(place, start, end);
      if (Math.hypot(on.x - place.x, on.z - place.z) <= AGAINST_M) return { wall, along: Math.hypot(on.x - start.x, on.z - start.z) };
    }
    return null;
  };
  const leaving = whereOnWalls(from);
  const reaching = whereOnWalls(to);
  if (leaving === null || reaching === null) return [];
  if (leaving.wall === reaching.wall && reaching.along >= leaving.along - AGAINST_M) return [];
  const passed: FloorPoint[] = [];
  for (let wall = (leaving.wall + 1) % outline.length; passed.length < outline.length; wall = (wall + 1) % outline.length) {
    const corner = outline[wall];
    if (corner !== undefined) passed.push(corner);
    if (wall === reaching.wall) break;
  }
  return passed;
}

/**
 * The floor a pinch is drawn on, as one polygon the shared rule accepts
 * (@omnitwin/types GangwayLocationSchema: three points or more), whatever its
 * parts are: each part as partOnFloor draws it, so none is without real floor
 * and none claims floor outside the room. One part is drawn as it is.
 *
 * Several, given in the order they come round the room, are drawn as one
 * outline that claims the parts and no floor between them. It goes out by the
 * room's side of each part in turn, from the place on the walls where the
 * part begins to the place where it ends, then along the room's own walls to
 * where the next begins; and it comes back along the walls all the way, the
 * same line reversed. So between two parts the outline runs there and back
 * along the walls and round no floor: the mouth of an alcove or a door recess
 * that the unit does not narrow, and open floor far from any wall, are not
 * claimed, and no line of it leaves the room.
 */
export function gangwayFloor(parts: readonly [FloorPart, ...FloorPart[]], outline: readonly FloorPoint[]): readonly FloorPoint[] {
  const [only, ...others] = parts;
  if (others.length === 0) return partOnFloor(only, outline);
  const way = twiceFloor(outline) >= 0 ? 1 : -1;
  const out: FloorPoint[] = [];
  const back: FloorPoint[] = [];
  let ended: FloorPoint | null = null;
  for (const part of parts) {
    const floor = partOnFloor(part, outline);
    const count = floor.length;
    const from = nearestCorner(floor, part.along[0]);
    const to = nearestCorner(floor, part.along[1]);
    // Round the part by the room's side of it, from where it begins on the walls to where it ends, which is
    // against the way the room's outline runs. A part at one place, or one cut so that its two places are no
    // longer neighbours, is gone all the way round from the first, the same way.
    const neighbours = from !== to && ((from + 1) % count === to || (to + 1) % count === from);
    const step = neighbours ? ((from + 1) % count === to ? -1 : 1) : twiceFloor(floor) * way > 0 ? -1 : 1;
    const round: FloorPoint[] = [];
    for (let k = 0; k < (neighbours ? count : count + 1); k += 1) {
      const point = floor[(((from + step * k) % count) + count) % count];
      if (point !== undefined) round.push(point);
    }
    const [first] = round;
    const last = round[round.length - 1];
    if (first === undefined || last === undefined) continue;
    // From the end of the part before, along the walls to the beginning of this one; and the same on the way back.
    const walls = ended === null ? [] : cornersBetween(ended, first, outline);
    out.push(...walls, ...round);
    back.unshift(last, first, ...[...walls].reverse());
    ended = last;
  }
  // Back along the walls: each part's beginning again, then the walls to the end of the one before it. The outline closes on the first beginning.
  const joined = [...out, ...back.slice(1, -1)];
  const drawn = joined.filter((point, i) => {
    const before = joined[i === 0 ? joined.length - 1 : i - 1];
    return before === undefined || Math.hypot(point.x - before.x, point.z - before.z) > SAME_M;
  });
  // Parts of the gangway floor wind one way and add up. Were they handed over as anything else and came to no floor, the first is drawn alone.
  return Math.abs(twiceFloor(drawn)) >= 2 * LEAST_FLOOR_M2 ? drawn : partOnFloor(only, outline);
}

/** One wall's gangway, or one corner's gap, as a unit narrows it: a part of the unit's pinch on that side. */
interface WallPart extends FloorPart {
  /** Where it comes round the room: its wall's place in the outline, a corner half a place after the wall it ends. */
  readonly order: number;
  readonly side: RoomSide;
  readonly widthM: number;
  readonly placed: PlacedItem;
  readonly pieceIds: readonly string[];
}

/** A unit's gangway along the walls on one side of it, on a room's own floor. */
interface WallPinch {
  readonly side: RoomSide;
  readonly unit: string;
  /** The piece of the unit nearest the walls where the gangway is narrowest. */
  readonly placed: PlacedItem;
  /** The unit's gap to the nearest of the walls and corners it is drawn at: the least from any of its pieces. */
  readonly widthM: number;
  /** The gangway floor it narrows (gangwayFloor): inside every wall on that side the unit stands in front of under the guidance, and at every corner it is nearest there. */
  readonly floor: readonly FloorPoint[];
  readonly pieceIds: readonly string[];
}

/**
 * Where a layout narrows the gangways along the walls of a room's own floor
 * under the guidance. Unit by unit, each wall's gap is the least from any
 * piece of the unit to that wall, measured exactly, leaving out a piece that
 * touches the wall only at its end (it has reached the corner, see above). A
 * wall some piece stands in front of under the guidance, or lies against, is
 * a gangway the unit narrows, on the side its normal gives; a corner the unit
 * is nearest with no piece in front of either of its walls is one too, on the
 * side of the wall the unit is nearer to standing in front of. For each unit
 * and each side that carries a gangway in the room's design (`layout`): the
 * narrowest of them, drawn on the floor of each (gangwayFloor).
 */
function floorWallPinches(
  measured: readonly MeasuredPiece[],
  floor: RoomFloor,
  layout: GangwayLayout,
  rule: AisleRule,
): readonly WallPinch[] {
  const walls = floorWallsM(floor);
  const outline = floor.outline.map(([x, z]): FloorPoint => ({ x: toRealWorld(x), z: toRealWorld(z) }));
  const units = new Map<string, MeasuredPiece[]>();
  for (const piece of measured) {
    const known = units.get(piece.unit);
    if (known === undefined) units.set(piece.unit, [piece]);
    else known.push(piece);
  }
  const pinches: WallPinch[] = [];
  for (const [unit, pieces] of units) {
    const reach = pieces.map((piece) => {
      const xs = piece.points.map((point) => point.x);
      const zs = piece.points.map((point) => point.z);
      return { minX: Math.min(...xs) - rule.gangwayM, maxX: Math.max(...xs) + rule.gangwayM, minZ: Math.min(...zs) - rule.gangwayM, maxZ: Math.max(...zs) + rule.gangwayM };
    });
    // Each wall as the unit meets it: how near the unit comes to it anywhere, and, from the pieces it is measured
    // from, its gap, the piece nearest it, whether any stands in front of it or against it, and the stretch they narrow.
    const met = walls.map((wall) => {
      const [a, b] = wall.ends;
      let nearM = Number.POSITIVE_INFINITY;
      let widthM = Number.POSITIVE_INFINITY;
      let placed: PlacedItem | null = null;
      let before = false;
      let from = wall.lengthM;
      let to = 0;
      const pieceIds: string[] = [];
      const atEnds: MeasuredPiece[] = [];
      for (const [i, piece] of pieces.entries()) {
        const bounds = reach[i];
        // A wall wholly further than the guidance from the piece's bounds narrows nothing.
        if (bounds === undefined || Math.max(a.x, b.x) < bounds.minX || Math.min(a.x, b.x) > bounds.maxX || Math.max(a.z, b.z) < bounds.minZ || Math.min(a.z, b.z) > bounds.maxZ) continue;
        const distance = pieceToWall(piece, wall);
        if (!underGuidance(distance, rule)) continue;
        nearM = Math.min(nearM, distance);
        // Touching the wall or through it, the piece is against it where it meets it between its ends. Meeting it
        // only at an end, it has reached the corner and no more: it is not measured to this wall (the corner, below).
        const against = distance <= AGAINST_M && liesAgainst(piece, wall);
        if (distance <= AGAINST_M && !against) {
          atEnds.push(piece);
          continue;
        }
        // The first of pieces equally near names the unit, so a tie between a trestle's chairs never changes it.
        if (placed === null || distance < widthM - SAME_M) placed = piece.placed;
        widthM = Math.min(widthM, distance);
        if (against || standsBefore(piece, wall)) before = true;
        for (const point of piece.points) {
          const along = Math.min(wall.lengthM, Math.max(0, (point.x - a.x) * wall.alongX + (point.z - a.z) * wall.alongZ));
          from = Math.min(from, along);
          to = Math.max(to, along);
        }
        pieceIds.push(piece.placed.id);
      }
      return nearM === Number.POSITIVE_INFINITY ? null : { nearM, widthM, placed, before, from, to, pieceIds, atEnds };
    });

    // A wall some piece stands in front of, or against, is a gangway the unit narrows, along the stretch of it its pieces narrow.
    const stretches = met.map((one): { from: number; to: number } => ({ from: one?.from ?? 0, to: one?.to ?? 0 }));
    const wallParts = walls.map((wall, i): WallPart | null => {
      const here = met[i] ?? null;
      if (here === null || !here.before || here.placed === null) return null;
      return {
        order: i,
        side: sideOfWay(wall.intoX, wall.intoZ),
        widthM: here.widthM,
        placed: here.placed,
        floor: wallStretch(wall, here.from, here.to, rule.gangwayM),
        along: [onWall(wall, here.from), onWall(wall, here.to)],
        pieceIds: here.pieceIds,
      };
    });
    // The corner where each wall ends and the next begins.
    const cornerParts = walls.map((): WallPart | null => null);
    for (const [i, wall] of walls.entries()) {
      const nextIndex = (i + 1) % walls.length;
      const next = walls[nextIndex];
      const here = met[i] ?? null;
      const there = met[nextIndex] ?? null;
      if (next === undefined || nextIndex === i || (here === null && there === null)) continue;
      const corner = wall.ends[1];
      // Pieces that touch one of the corner's walls only at this end have reached the corner. One that lies against
      // the other wall is that wall's and no part of the corner; one that lies against neither touches the corner itself.
      const reached = new Set<MeasuredPiece>([
        ...(here?.atEnds ?? []).filter((piece) => touchesEnd(piece, wall, "last")),
        ...(there?.atEnds ?? []).filter((piece) => touchesEnd(piece, next, "first")),
      ]);
      const touching = [...reached].filter((piece) => !liesAgainst(piece, wall) && !liesAgainst(piece, next));
      // The corner goes with one of its two walls; where the unit stands in front of that wall, the corner is part of
      // the wall's gangway. A piece that touches the corner while it lies against a wall in line with one of the two
      // (set along a wall across a doorway, its end at the far jamb) shuts the corner on that wall's side: the touch
      // is the end of where it lies along that line.
      const liesInLineWith = (line: FloorWallM): boolean => touching.some((piece) => walls.some((another) => another !== line && inLine(line, another) && liesAgainst(piece, another)));
      const inLineWithWall = liesInLineWith(wall);
      const inLineWithNext = liesInLineWith(next);
      const withNext = inLineWithWall === inLineWithNext ? cornerGoesWithNext(pieces, wall, next) : inLineWithNext;
      const ownIndex = withNext ? nextIndex : i;
      const own = withNext ? there : here;
      const other = withNext ? here : there;
      const taken = wallParts[ownIndex] ?? null;
      if (taken !== null) {
        // Part of that wall's gangway, which a piece touching the corner shuts there: its stretch then runs to the corner.
        const [first] = touching;
        const stretch = stretches[ownIndex];
        if (first !== undefined && stretch !== undefined) {
          const shut = withNext ? next : wall;
          if (withNext) stretch.from = 0;
          else stretch.to = shut.lengthM;
          wallParts[ownIndex] = {
            ...taken,
            widthM: 0,
            placed: taken.widthM > SAME_M ? first.placed : taken.placed,
            floor: wallStretch(shut, stretch.from, stretch.to, rule.gangwayM),
            along: [onWall(shut, stretch.from), onWall(shut, stretch.to)],
            pieceIds: [...new Set([...taken.pieceIds, ...touching.map((piece) => piece.placed.id)])],
          };
        }
        continue;
      }
      let cornerM = Number.POSITIVE_INFINITY;
      let nearest: MeasuredPiece | null = null;
      const pieceIds: string[] = [];
      for (const piece of pieces) {
        const touches = touching.includes(piece);
        if (reached.has(piece) && !touches) continue;
        const nearestPoint = nearestOfPiece(piece, corner);
        const distance = touches ? 0 : Math.hypot(nearestPoint.x - corner.x, nearestPoint.z - corner.z);
        if (!underGuidance(distance, rule)) continue;
        if (nearest === null || distance < cornerM - SAME_M) nearest = piece;
        cornerM = Math.min(cornerM, distance);
        pieceIds.push(piece.placed.id);
      }
      if (nearest === null) continue;
      // A wall nearer the unit somewhere else (its far end, or from behind) is not nearest it at this corner. The
      // other wall is asked only where the unit does not stand in front of it: there it has its own item.
      if (own !== null && own.nearM < cornerM - SAME_M) continue;
      if (other !== null && !other.before && other.nearM < cornerM - SAME_M) continue;
      const taking = withNext ? next : wall;
      const inside = (into: FloorWallM): FloorPoint => ({ x: corner.x + into.intoX * rule.gangwayM, z: corner.z + into.intoZ * rule.gangwayM });
      cornerParts[i] = { order: i + 0.5, side: sideOfWay(taking.intoX, taking.intoZ), widthM: cornerM, placed: nearest.placed, floor: [corner, inside(wall), inside(next)], along: [corner, corner], pieceIds };
    }
    // In the order of the walls: each wall, then the corner at its end.
    const parts = walls.flatMap((_, i) => [wallParts[i] ?? null, cornerParts[i] ?? null].filter((part): part is WallPart => part !== null));

    for (const side of ROOM_SIDES) {
      if (!layout.sides[side]) continue;
      const mine = parts.filter((part) => part.side === side);
      const [first] = mine;
      if (first === undefined) continue;
      const narrowest = mine.reduce((best, part) => (part.widthM < best.widthM - SAME_M ? part : best), first);
      const narrowing = new Set(mine.flatMap((part) => part.pieceIds));
      // Drawn as they come round the room, begun after the longest run of walls that holds none of them: each then follows the one before it.
      const runBefore = (k: number): number => ((mine[k]?.order ?? 0) - (mine[(k + mine.length - 1) % mine.length]?.order ?? 0) + walls.length) % walls.length;
      const begin = mine.reduce((longest, _, k) => (runBefore(k) > runBefore(longest) ? k : longest), 0);
      const [start, ...rest] = [...mine.slice(begin), ...mine.slice(0, begin)];
      pinches.push({
        side,
        unit,
        placed: narrowest.placed,
        widthM: Math.min(...mine.map((part) => part.widthM)),
        floor: gangwayFloor([start ?? first, ...rest], outline),
        pieceIds: pieces.filter((piece) => narrowing.has(piece.placed.id)).map((piece) => piece.placed.id),
      });
    }
  }
  return pinches;
}

/**
 * Every pinch where a layout narrows one of the room's designated gangways
 * under the guidance, narrowest first, as open review items: one per
 * gangway and pair either side (a wall and a table group, set or lone
 * piece; or two such units across a middle gangway), measured exactly from
 * outline to outline, located as the stretch of gangway it narrows, with the
 * id the shared rule gives it (`@omnitwin/types` gangway-review). The
 * stretch, not a single nearest point, is the location, so a tie between a
 * trestle's chairs never moves it. Room dimensions are render-space, as the
 * planner's room store holds them; locations are real metres.
 *
 * In a room that carries its own floor (`room.floor`, lib/room-floor) the
 * gangways along the walls are measured to the floor's own walls, each where
 * it stands (floorWallPinches). An item there is a unit's gangway on one side
 * of it: its width is the unit's gap, the least from any of its pieces, to
 * the nearest of the walls on that side it stands in front of and the corners
 * it is nearest there, and its location is the gangway floor inside each of
 * them, one polygon of real floor within the room (gangwayFloor): a set
 * standing along a wall with alcoves in it is drawn on every stretch of the
 * wall it narrows, and not across the alcoves' mouths. A middle gangway is
 * the design's, as in any room.
 */
export function gangwayReview(
  placedItems: readonly PlacedItem[],
  room: PlannerRoomDimensions,
  exits: readonly RoomExit[] | null,
  options: {
    readonly rule?: AisleRule;
    readonly wallNames?: Readonly<Record<RoomSide, string>>;
    /** The room's door clear spaces, as Fill keeps them, so the review judges Fill's own gangways. */
    readonly doorSpaces?: readonly LayoutRect[];
  } = {},
): readonly GangwayReviewItem[] {
  const rule = options.rule ?? FILL_AISLE_RULE;
  const names = options.wallNames ?? PLAIN_WALL_NAMES;
  const widthM = toRealWorld(room.width);
  const lengthM = toRealWorld(room.length);
  const designated = designatedGangways(widthM, lengthM, exits, rule, options.doorSpaces, room.floor);
  if (designated === null) return [];
  const world = createGhostWorld(placedItems, room);
  const unitOf = (placed: PlacedItem): string => placed.setId ?? placed.groupId ?? placed.id;
  const outlines = placedItems.flatMap((placed): MeasuredPiece[] => {
    if (!isSceneFurniturePlacement(placed)) return [];
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) return [];
    const disc = item.tableShape === "round" ? { x: toRealWorld(placed.x), z: toRealWorld(placed.z), r: (item.width * (placed.scale ?? 1)) / 2 } : null;
    return [{ placed, unit: unitOf(placed), points: floorOutline(placed, item), disc }];
  });
  const pinches = new Map<string, Pinch>();
  // One pinch per gangway and pair either side: its narrowest width, the whole stretch it narrows, every piece narrowing it.
  const note = (key: string, pinch: Pinch): void => {
    const known = pinches.get(key);
    if (known === undefined) {
      pinches.set(key, pinch);
      return;
    }
    pinches.set(key, {
      ...(pinch.widthM < known.widthM ? pinch : known),
      from: Math.min(known.from, pinch.from),
      to: Math.max(known.to, pinch.to),
      pieceIds: [...new Set([...known.pieceIds, ...pinch.pieceIds])],
    });
  };

  // On a room's own floor a gangway along a wall is measured to the walls that are there, wall by wall
  // (floorWallPinches), not to the sides of the floor's bounds: the design only says which sides carry one.
  const onFloorWalls = room.floor === undefined ? null : floorWallPinches(outlines, room.floor, designated.layout, rule);

  for (const band of designated.bands) {
    const alongX = band.rect.width >= band.rect.depth;
    const along = (point: FloorPoint): number => (alongX ? point.x : point.z);
    const side = band.side;
    if (side !== null) {
      if (onFloorWalls !== null) {
        for (const pinch of onFloorWalls) {
          if (pinch.side !== side) continue;
          const alongs = pinch.floor.map(along);
          note(`${side}|${pinch.unit}`, {
            gangway: side,
            band: band.rect,
            gangwayName: names[side],
            sides: [{ wall: side }, { unit: pinch.unit }],
            sideNames: [names[side], obstacleName(pinch.placed.id, world).label],
            widthM: pinch.widthM,
            from: Math.min(...alongs),
            to: Math.max(...alongs),
            pieceIds: pinch.pieceIds,
            stretch: pinch.floor,
          });
        }
        continue;
      }
      for (const { placed, unit, points } of outlines) {
        const distance = Math.max(0, Math.min(...points.map((point) => wallDistance(side, point, widthM, lengthM))));
        if (!underGuidance(distance, rule)) continue;
        const alongs = points.map(along);
        note(`${side}|${unit}`, {
          gangway: side,
          band: band.rect,
          gangwayName: names[side],
          sides: [{ wall: side }, { unit }],
          sideNames: [names[side], obstacleName(placed.id, world).label],
          widthM: distance,
          from: Math.min(...alongs),
          to: Math.max(...alongs),
          pieceIds: [placed.id],
        });
      }
      continue;
    }
    // A middle gangway: each unit stands on one side of it, and a pinch is any two pieces of units on
    // opposite sides closer than the guidance, outline to outline, straight across or on the slant.
    const unitPoints = new Map<string, FloorPoint[]>();
    for (const { unit, points } of outlines) {
      const known = unitPoints.get(unit);
      if (known === undefined) unitPoints.set(unit, [...points]);
      else known.push(...points);
    }
    const measured = outlines.map((outline) => {
      const alongs = outline.points.map(along);
      return { ...outline, side: spineSide(unitPoints.get(outline.unit) ?? outline.points, band.rect), from: Math.min(...alongs), to: Math.max(...alongs) };
    });
    for (const low of measured) {
      if (low.side !== "low") continue;
      for (const high of measured) {
        if (high.side !== "high" || high.unit === low.unit) continue;
        if (high.from - low.to >= rule.gangwayM || low.from - high.to >= rule.gangwayM) continue;
        const width = convexPolygonClosestPoints(low.points, high.points).distance;
        if (!underGuidance(width, rule)) continue;
        const overlapFrom = Math.max(low.from, high.from);
        const overlapTo = Math.min(low.to, high.to);
        // Side by side, the stretch they share; on the slant, the stretch between them.
        const [from, to] = overlapFrom <= overlapTo ? [overlapFrom, overlapTo] : [overlapTo, overlapFrom];
        note(`spine|${[low.unit, high.unit].sort().join("|")}`, {
          gangway: "spine",
          band: band.rect,
          gangwayName: "the middle",
          sides: [{ unit: low.unit }, { unit: high.unit }],
          sideNames: [obstacleName(low.placed.id, world).label, obstacleName(high.placed.id, world).label],
          widthM: width,
          from,
          to,
          pieceIds: [low.placed.id, high.placed.id],
        });
      }
    }
  }
  const guidance = { thresholdM: rule.gangwayM, source: rule.source };
  return [...pinches.values()]
    .sort((a, b) => a.widthM - b.widthM || a.from - b.from)
    .map((pinch) => ({
      id: gangwayReviewId(pinch.gangway, pinch.sides),
      widthM: pinch.widthM,
      guidance,
      gangway: pinch.gangwayName,
      location: { kind: "polygon" as const, points: (pinch.stretch ?? gangwayStretch(pinch.band, pinch.from, pinch.to)).map((point) => ({ ...point })) },
      pieceIds: [...pinch.pieceIds],
      sides: [...pinch.sideNames],
      status: "open" as const,
    }));
}

/** Who reads a gangway flag: a signed-in layout keeps its review (lib/gangway-review-record); a guest's preview does not. */
export type GangwayFlagReader = "signed-in" | "guest";

/**
 * The flag the ghost and the caption show, saying what happens to the
 * pinch: "Gangway 0.95 m · under the 1.1 m guidance · goes to the venue with
 * this layout"; to a guest, whose preview stores nothing, "… · the venue
 * sees this with your layout". The width is cut, never rounded, to the
 * centimetre, so a gangway under the guidance never reads as meeting it.
 */
export function gangwayFlag(widthM: number, rule: AisleRule = FILL_AISLE_RULE, reader: GangwayFlagReader = "signed-in"): string {
  const what = reader === "guest" ? "the venue sees this with your layout" : "goes to the venue with this layout";
  return `Gangway ${(Math.floor(widthM * 100 + 1e-6) / 100).toFixed(2)} m · under the ${String(rule.gangwayM)} m guidance · ${what}`;
}

// ---------------------------------------------------------------------------
// Merge, never replace (Q-10): Fill sets anew only the round groups of the
// kind it lays; every other piece stays exactly where it is, ids and all,
// and keeps the aisle rule round it as a keep-out. Rounds it sets anew reuse
// the old tables' ids, names and cloths (so their notes follow), Table 1
// first.
// ---------------------------------------------------------------------------

/**
 * The pieces Fill sets anew: every round group of the fill table's kind,
 * meaning a group of exactly one such round and its chairs, nothing else.
 * A group someone made by hand (two rounds, a round with a lectern, a
 * stray chair) is not Fill's to break up: it stays, as a keep-out.
 */
export function fillRefillIds(placedItems: readonly PlacedItem[], fillTable: CatalogueItem): ReadonlySet<string> {
  const kind = seatBaseSlug(fillTable.slug);
  const groups = new Map<string, PlacedItem[]>();
  for (const placed of placedItems) {
    if (placed.groupId === null) continue;
    const group = groups.get(placed.groupId);
    if (group === undefined) groups.set(placed.groupId, [placed]);
    else group.push(placed);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) {
    const tables = group.filter((placed) => {
      const item = getCatalogueItem(placed.catalogueItemId);
      return item !== undefined && isDiningTableItem(item);
    });
    const [table] = tables;
    const tableItem = table === undefined ? undefined : getCatalogueItem(table.catalogueItemId);
    if (tables.length !== 1 || table === undefined || tableItem === undefined) continue;
    if (tableItem.tableShape !== "round" || seatBaseSlug(tableItem.slug) !== kind) continue;
    if (group.some((placed) => placed.setId !== undefined)) continue;
    if (!group.every((placed) => placed === table || getCatalogueItem(placed.catalogueItemId)?.category === "chair")) continue;
    for (const placed of group) ids.add(placed.id);
  }
  return ids;
}

/** A room's ways out by its slug: the Grand Hall's surveyed doors; for any other room, not recorded (null), so every wall carries a gangway. */
export function roomExits(roomSlug: string | null): readonly RoomExit[] | null {
  return roomSlug === "grand-hall" ? grandHallExits() : null;
}

/** A room's walls as its staff name them, for the review's words; undefined where they are not recorded. */
export function roomWallNames(roomSlug: string | null): Readonly<Record<RoomSide, string>> | undefined {
  return roomSlug === "grand-hall" ? GRAND_HALL_WALL_NAMES : undefined;
}

/** Fill over what is placed: the plan, and the round groups it sets anew. */
export interface RoomFill {
  readonly plan: GangwayFillPlan;
  readonly refillIds: ReadonlySet<string>;
}

/**
 * Fill over a layout (Q-10), the one function the prompt's preview and the
 * store's commit both call, so what the button says is what it places:
 * only round groups of the fill table's kind are set anew; every other
 * piece stays and keeps the aisle rule round it as a keep-out, and the
 * room's door clear spaces (`input.doorSpaces`) stay clear as well.
 */
export function planRoomFill(input: Omit<GangwayFillInput, "keepOuts">, placedItems: readonly PlacedItem[]): RoomFill | null {
  const refillIds = fillRefillIds(placedItems, input.table);
  const plan = planGangwayFill({ ...input, keepOuts: fillKeepOuts(placedItems, refillIds, input.rule.betweenTablesM) });
  return plan === null ? null : { plan, refillIds };
}

/** Every kept piece as a keep-out, metres, room-centred: its footprint and the aisle round it. */
export function fillKeepOuts(placedItems: readonly PlacedItem[], refillIds: ReadonlySet<string>, aisleM: number): readonly LayoutRect[] {
  const rects: LayoutRect[] = [];
  for (const placed of placedItems) {
    if (refillIds.has(placed.id) || !isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    const { halfW, halfD } = computeRotatedFootprint(item, placed.rotationY, placed.scale);
    rects.push({
      cx: toRealWorld(placed.x),
      cz: toRealWorld(placed.z),
      width: 2 * toRealWorld(halfW) + 2 * aisleM,
      depth: 2 * toRealWorld(halfD) + 2 * aisleM,
    });
  }
  return rects;
}

/** Table N first, then the rest in reading order: the order refilled tables take their ids in. */
function refillOrder(a: PlacedItem, b: PlacedItem): number {
  const na = tableLabelNumber(a.label) ?? Number.POSITIVE_INFINITY;
  const nb = tableLabelNumber(b.label) ?? Number.POSITIVE_INFINITY;
  return (na - nb) || (a.z - b.z) || (a.x - b.x);
}

/** The pieces a fill sets anew, and their tables in the order they take the plan's spots (refillOrder). */
function refilledRounds(placedItems: readonly PlacedItem[], refillIds: ReadonlySet<string>): {
  readonly refilled: readonly PlacedItem[];
  readonly oldTables: readonly PlacedItem[];
} {
  const refilled = placedItems.filter((placed) => refillIds.has(placed.id));
  const oldTables = refilled.filter((placed) => {
    const item = getCatalogueItem(placed.catalogueItemId);
    return item !== undefined && isDiningTableItem(item);
  }).sort(refillOrder);
  return { refilled, oldTables };
}

/** A refilled round's pieces other than its table, in the order refillPieces reuses them for the plan's chairs. */
function roundSeats(refilled: readonly PlacedItem[], table: PlacedItem): readonly PlacedItem[] {
  return refilled.filter((placed) => placed.groupId === table.groupId && placed.id !== table.id);
}

/**
 * A reused piece at the standard size the plan's spacing assumed (planner-qol
 * C-X6), said outright: the editor bridge reads a missing scale as the
 * piece's old one, so leaving it out would put the old size back.
 */
function atStandardSize(piece: PlacedItem): PlacedItem {
  return piece.scale === undefined ? piece : { ...piece, scale: 1 };
}

/**
 * The round groups a fill plan sets down, reusing the refilled tables' ids,
 * names, cloths and chairs' ids in refill order; tables beyond those are new.
 * Fill sets the room with the event's chair, so a reused planner chair keeps
 * its record but becomes the chair its place was planned for (a Turini kept
 * at a wedding's Chiavari spacing would sit into its table). A chair the
 * planner never sets (a highchair, a legacy chair) was somebody's choice and
 * keeps what it is, unless it would stand in a door's clear space the plan
 * kept (`options.doorSpaces`) with the plan's own chair: there it becomes the
 * plan's chair, so the doors stay as clear as the button said. A reused
 * round, table and chairs, is set at the standard size the plan's spacing
 * assumed (C-X6). Render-space, ready for the placement store.
 */
export function refillPieces(
  placedItems: readonly PlacedItem[],
  refillIds: ReadonlySet<string>,
  plan: BanquetFillPlan,
  newId: () => string = generatePlacedId,
  options: FillOptions = {},
): readonly PlacedItem[] {
  const doorSpaces = options.doorSpaces ?? [];
  const inDoorSpace = (piece: PlacedItem): boolean => {
    const footprint = placedFootprint(piece);
    return footprint !== null && doorSpaces.some((space) => footprintInKeepOut(footprint, space));
  };
  const { refilled, oldTables } = refilledRounds(placedItems, refillIds);
  const pieces: PlacedItem[] = [];
  plan.tables.forEach((spot, i) => {
    const old = oldTables[i];
    const fresh = createTableGroup(old?.catalogueItemId ?? plan.tableItemId, toRenderSpace(spot.xM), toRenderSpace(spot.zM), spot.rotationY, plan.seatsPerTable, 0, newId);
    const [table, ...chairs] = fresh;
    if (old === undefined || table === undefined) {
      pieces.push(...fresh);
      return;
    }
    const groupId = old.groupId;
    const oldChairs = roundSeats(refilled, old);
    pieces.push({ ...atStandardSize(old), x: table.x, z: table.z, y: table.y, rotationY: table.rotationY });
    chairs.forEach((chair, c) => {
      const reuse = oldChairs[c];
      if (reuse === undefined) {
        pieces.push({ ...chair, groupId });
        return;
      }
      const reusedSlug = getCatalogueItem(reuse.catalogueItemId)?.slug;
      const placedAt = { ...atStandardSize(reuse), x: chair.x, z: chair.z, y: chair.y, rotationY: chair.rotationY };
      const converts = (reusedSlug !== undefined && plannerChairFor(reusedSlug) !== null) || inDoorSpace(placedAt);
      pieces.push(converts ? { ...placedAt, catalogueItemId: chair.catalogueItemId } : placedAt);
    });
  });
  return pieces;
}

/** What a fill over a laid floor does to the rounds already there, said before it does it (planner-qol C-02). */
export interface FillConsequence {
  /** Rounds already placed that the fill sets at another spot, keeping their names, notes and cloths. */
  readonly moved: number;
  /** Rounds already placed that keep the spot they stand on (the same fill asked for again). */
  readonly kept: number;
  /** New rounds beyond those. */
  readonly added: number;
  /** Rounds the plan has no spot for, taken away with their chairs: their names, or "a round" unnamed. */
  readonly removed: readonly string[];
  /** Of those, the ones with a note on the table or one of its chairs. */
  readonly removedWithNotes: readonly string[];
  /** Reused rounds set for fewer seats, where chairs taken away have notes: how many notes go from each. */
  readonly chairNotesGoing: readonly { readonly name: string; readonly notes: number }[];
  /** Reused rounds whose seats change to the plan's, with the seats they had. */
  readonly reseated: readonly { readonly name: string; readonly had: number }[];
  /** Reused rounds of a non-standard size, table or chairs, set back to the standard one. */
  readonly resized: readonly string[];
  readonly seatsPerTable: number;
}

/** A round with no name, as the consequence names it. */
const UNNAMED_ROUND = "a round";

/** How near its spot a reused round must already stand to count as kept: a millimetre, and no turn. */
const SAME_SPOT_M = 0.001;
const SAME_TURN_RAD = 1e-6;

/**
 * The consequence of laying `plan` over `placedItems`, as refillPieces will
 * do it: the old rounds take the plan's spots in refill order. Null when no
 * round of the fill's kind is on the floor, so there is nothing to tell.
 */
export function fillConsequence(
  placedItems: readonly PlacedItem[],
  refillIds: ReadonlySet<string>,
  plan: BanquetFillPlan,
  hasNote: (id: string) => boolean,
): FillConsequence | null {
  const { refilled, oldTables } = refilledRounds(placedItems, refillIds);
  if (oldTables.length === 0) return null;
  const nameOf = (table: PlacedItem): string => {
    const label = (table.label ?? "").trim();
    return label === "" ? UNNAMED_ROUND : label;
  };
  const seatsOf = (table: PlacedItem): readonly PlacedItem[] => roundSeats(refilled, table);
  const chairsAt = (table: PlacedItem): number => seatsOf(table)
    .filter((placed) => getCatalogueItem(placed.catalogueItemId)?.category === "chair").length;
  const reused = oldTables.slice(0, plan.tables.length);
  const removed = oldTables.slice(plan.tables.length);
  const moved = reused.filter((table, i) => {
    const spot = plan.tables[i];
    return spot === undefined
      || Math.abs(toRealWorld(table.x) - spot.xM) > SAME_SPOT_M
      || Math.abs(toRealWorld(table.z) - spot.zM) > SAME_SPOT_M
      || Math.abs(table.rotationY - spot.rotationY) > SAME_TURN_RAD;
  }).length;
  return {
    moved,
    kept: reused.length - moved,
    added: Math.max(0, plan.tables.length - oldTables.length),
    removed: removed.map(nameOf),
    removedWithNotes: removed.filter((table) => [table, ...seatsOf(table)].some((piece) => hasNote(piece.id))).map(nameOf),
    // refillPieces reuses a round's first seatsPerTable seats; the rest go.
    chairNotesGoing: reused.flatMap((table) => {
      const notes = seatsOf(table).slice(plan.seatsPerTable).filter((piece) => hasNote(piece.id)).length;
      return notes === 0 ? [] : [{ name: nameOf(table), notes }];
    }),
    reseated: reused.flatMap((table) => {
      const had = chairsAt(table);
      return had === plan.seatsPerTable ? [] : [{ name: nameOf(table), had }];
    }),
    resized: reused
      .filter((table) => [table, ...seatsOf(table).slice(0, plan.seatsPerTable)].some((piece) => (piece.scale ?? 1) !== 1))
      .map(nameOf),
    seatsPerTable: plan.seatsPerTable,
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function metres(value: number): string {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} m`;
}

/** A published format as an occasion: "a seated dinner", "theatre". */
export function occasionPhrase(format: PublishedFormat): string {
  switch (format) {
    case "dinner": return "a seated dinner";
    case "reception": return "a standing reception";
    case "theatre": return "theatre";
    case "classroom": return "classroom";
  }
}

/** The venue's published figure for a format, with who stated it and when. */
export interface PublishedFigure {
  readonly figure: number;
  readonly format: PublishedFormat;
  readonly source: string;
}

export function publishedFigureFor(published: PublishedCapacityAnswer, format: PublishedFormat): PublishedFigure | null {
  return published.kind === "published"
    ? { figure: published.capacity[format], format, source: published.source }
    : null;
}

/** "The venue publishes 180 for a seated dinner." */
export function publishedFigureLine(figure: PublishedFigure): string {
  return `The venue publishes ${String(figure.figure)} for ${occasionPhrase(figure.format)}.`;
}

/** The consequence, on the button that acts: "Place 14 tables and 140 chairs". */
export function autoFillActionLabel(plan: AutoFillPlan): string {
  if (plan.style === "theatre") return `Place ${countLabel(plan.chairs, "chair")} in ${countLabel(plan.rows, "row")}`;
  return `Place ${countLabel(plan.tableCount, "table")} and ${countLabel(plan.chairs, "chair")}`;
}

/** Fill's button over a laid floor: it seats, and may move and take away, rather than only placing. */
export function fillOverActionLabel(plan: BanquetFillPlan): string {
  return `Seat ${plan.chairs.toLocaleString("en-GB")} at ${countLabel(plan.tableCount, "table")}`;
}

/** The receipt once a fill over a laid floor has been laid; one Undo takes it back. */
export function fillOverReceipt(plan: BanquetFillPlan): string {
  return `Laid out ${countLabel(plan.tableCount, "table")}`;
}

/** "Table 3", "Table 3 and Table 5", "Table 3, Table 5 and Table 9". */
function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function sentence(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

/**
 * The consequence in the trade's words, said before the button is pressed:
 * what moves, comes and goes; notes that go with a round taken away; seats
 * reset to the plan's; sizes set back to the standard one.
 */
export function fillConsequenceLine(consequence: FillConsequence): string {
  const changes = fillChanges(consequence, "ahead");
  const sentences = [sentence(changes.length > 0 ? namesList(changes) : "keeps every round where it is")];
  const noted = consequence.removedWithNotes;
  if (noted.length > 0) {
    sentences.push(sentence(noted.length === 1
      ? `${roundsList(noted)} has a note, which goes with it`
      : `${roundsList(noted)} have notes, which go with them`));
  }
  const chairNotes = consequence.chairNotesGoing;
  if (chairNotes.length > 0) {
    const from = roundsList(chairNotes.map(({ name }) => name));
    sentences.push(sentence(chairNotes.reduce((sum, { notes }) => sum + notes, 0) === 1
      ? `a chair taken from ${from} has a note, which goes with it`
      : `chairs taken from ${from} have notes, which go with them`));
  }
  if (consequence.reseated.length > 0) {
    sentences.push(sentence(`each round is set for ${String(consequence.seatsPerTable)}: ${namesList(reseatedParts(consequence.reseated))}`));
  }
  if (consequence.resized.length > 0) {
    sentences.push(sentence(`${roundsList(consequence.resized)} ${consequence.resized.length === 1 ? "goes" : "go"} back to the standard size`));
  }
  return sentences.join(" ");
}

/** What the Guests lens says once a fill over a laid floor is laid: "Seated 30 at 3 tables: moved 3 rounds and took away 2." */
export function fillOverDoneLine(plan: BanquetFillPlan, consequence: FillConsequence): string {
  const seated = `seated ${plan.chairs.toLocaleString("en-GB")} at ${countLabel(plan.tableCount, "table")}`;
  const changes = fillChanges(consequence, "done");
  return sentence(changes.length > 0 ? `${seated}: ${namesList(changes)}` : seated);
}

/** The fill's changes to the rounds there, said before it lays ("moves 3 rounds") or after ("moved 3 rounds"). */
function fillChanges(consequence: FillConsequence, when: "ahead" | "done"): readonly string[] {
  const [moves, adds, takesAway] = when === "ahead" ? ["moves", "adds", "takes away"] : ["moved", "added", "took away"];
  return [
    consequence.moved > 0 ? `${moves} ${countLabel(consequence.moved, "round")}` : null,
    consequence.added > 0 ? `${adds} ${String(consequence.added)}` : null,
    consequence.removed.length > 0 ? `${takesAway} ${String(consequence.removed.length)}` : null,
  ].filter((part): part is string => part !== null);
}

/** Rounds named in a sentence, the unnamed counted together: "Table 3 and 2 unnamed rounds". */
function roundsList(names: readonly string[]): string {
  const unnamed = names.filter((name) => name === UNNAMED_ROUND).length;
  if (unnamed < 2) return namesList(names);
  return namesList([...names.filter((name) => name !== UNNAMED_ROUND), `${String(unnamed)} unnamed rounds`]);
}

/** "Table 4 had 12", the unnamed counted together by the seats they had: "2 unnamed rounds had 12". */
function reseatedParts(reseated: FillConsequence["reseated"]): readonly string[] {
  const parts: string[] = [];
  const unnamed = new Map<number, number>();
  for (const { name, had } of reseated) {
    if (name === UNNAMED_ROUND) unnamed.set(had, (unnamed.get(had) ?? 0) + 1);
    else parts.push(`${name} had ${String(had)}`);
  }
  for (const [had, count] of unnamed) parts.push(`${count === 1 ? UNNAMED_ROUND : `${String(count)} unnamed rounds`} had ${String(had)}`);
  return parts;
}

/** The hall's chairs as its staff name them (Blake, 26-28 Oct 2026). */
const CHAIR_WORDS: Readonly<Record<string, string>> = {
  "chiavari-chair": "the Chiavari",
  "burgess-turini-18-3": "the pink chair",
  "checked-banquet-chair": "the checked chair",
  "gallery-chair-red-gold": "the red chair with gold legs",
};

/**
 * The rows' chairs when they are more than one kind, front rows first, and
 * whether the hall's chairs ran out: " The front rows take the pink chair,
 * then the checked chair, as the hall's own chairs run." Never a count:
 * stock figures are for staff.
 */
function theatreChairWords(plan: TheatreFillPlan): string {
  const ranOut = plan.chairsRanOut ? " The hall's chairs ran out before the room did." : "";
  if (plan.chairKinds.length < 2) return ranOut;
  const names = plan.chairKinds.map(({ chairItemId }) => {
    const item = getCatalogueItem(chairItemId);
    return (item === undefined ? undefined : CHAIR_WORDS[item.slug]) ?? item?.name ?? "another chair";
  });
  const [front, ...rest] = names;
  return ` The front rows take ${front ?? "the event's chair"}, then ${rest.join(", then ")}, as the hall's own chairs run.${ranOut}`;
}

/** The spacing the fill used, in the trade's words, and the doors when it kept them clear. */
export function autoFillBasis(plan: AutoFillPlan): string {
  if (plan.style === "theatre") {
    const rows = `Rows ${metres(THEATRE_SPACING.rowPitchM)} apart, a ${metres(THEATRE_SPACING.aisleM)} centre aisle`;
    const front = `${metres(THEATRE_SPACING.stageDepthM)} clear at the front`;
    const spacing = plan.doorsKeptClear ? `${rows}, ${front} and the doors kept clear.` : `${rows} and ${front}.`;
    return `${spacing}${theatreChairWords(plan)}`;
  }
  const kind = plan.round ? "Rounds" : "Tables";
  // The door space is the venue's own figure, not the guidance's, so it follows the attribution.
  if (isGangwayFillPlan(plan)) {
    const doors = plan.doorsKeptClear ? ", and the doors kept clear" : "";
    return `${kind} of ${String(plan.seatsPerTable)}, with ${metres(plan.rule.gangwayM)} gangways to the doors and ${metres(plan.rule.betweenTablesM)} clear behind every other chair, after Scottish fire safety guidance${doors}.`;
  }
  const doors = plan.doorsKeptClear ? " and the doors kept clear" : "";
  return `${kind} of ${String(plan.seatsPerTable)}, with ${metres(BANQUET_CHAIR_CLEARANCE_M)} clear behind every chair${doors}.`;
}

/** A fill laid out with designated gangways (planGangwayFill). */
export function isGangwayFillPlan(plan: AutoFillPlan): plan is GangwayFillPlan {
  return plan.style === "dinner-rounds" && "rule" in plan;
}

/**
 * When the room cannot take the guests asked for, the plain line that says
 * so, beside the venue's own figure when it publishes one: "Room for 140 at
 * this spacing; the venue publishes 180 for a seated dinner." When keeping
 * the doors clear is what costs the seats, it says how many fit of the
 * guests asked: "Room for 100 of the 120 guests with the doors kept clear".
 * Null when the request fits.
 */
export function roomAtSpacingLine(plan: AutoFillPlan, published: PublishedFigure | null): string | null {
  if (plan.meetsTarget || plan.guests === null) return null;
  const room = plan.doorsKeptClear && plan.roomForSeatsIgnoringDoors > plan.roomForSeats
    ? `Room for ${String(plan.roomForSeats)} of the ${String(plan.guests)} guests ${plan.roomForSeatsIgnoringDoors < plan.guests ? "at this spacing " : ""}with the doors kept clear`
    : `Room for ${String(plan.roomForSeats)} at this spacing`;
  return published === null
    ? `${room}.`
    : `${room}; the venue publishes ${String(published.figure)} for ${occasionPhrase(published.format)}.`;
}

/** What the fill placed: "Placed 14 round tables and 140 chairs." */
export function autoFillPlacedLine(plan: AutoFillPlan): string {
  if (plan.style === "theatre") return `Placed ${countLabel(plan.chairs, "chair")} in ${countLabel(plan.rows, "row")}.`;
  const table = getCatalogueItem(plan.tableItemId);
  const noun = table?.tableShape === "round" ? "round table" : "table";
  return `Placed ${countLabel(plan.tableCount, noun)} and ${countLabel(plan.chairs, "chair")}.`;
}
