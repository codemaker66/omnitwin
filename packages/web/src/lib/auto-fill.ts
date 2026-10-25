import {
  gangwayReviewId,
  seatBaseSlug,
  type FloorPoint,
  type GangwayReviewItem,
  type GangwaySide,
  type SpaceDimensions,
} from "@omnitwin/types";
import { createGhostWorld, obstacleName } from "./ghost-truth.js";
import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "./catalogue.js";
import { computeRotatedFootprint, generatePlacedId, tableLabelNumber, type PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import {
  planBanquetLayout,
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
import { DEFAULT_PLANNER_CHAIR_SLUG, DEFAULT_PLANNER_ROUND_TABLE_SLUG } from "./furniture-defaults.js";
import { isDiningTableItem } from "./furniture-semantics.js";
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
}

/** Rows of chairs facing a stage at one end, planned in metres. */
export interface TheatreFillPlan {
  readonly style: "theatre";
  readonly chairItemId: string;
  readonly seats: readonly TheatreSeatPlacement[];
  readonly chairs: number;
  readonly rows: number;
  readonly guests: number | null;
  readonly roomForSeats: number;
  readonly meetsTarget: boolean;
}

export type AutoFillPlan = BanquetFillPlan | TheatreFillPlan;

function requested(guests: number): number | null {
  return Number.isFinite(guests) && guests > 0 ? Math.floor(guests) : null;
}

/**
 * Plan a banquet of `table` groups for `guests` (0 fills the room), seating
 * `chairsPerTable` at each (never more than fit). Null when the table is not
 * a seated dining table or the room cannot hold one group.
 */
export function planBanquetFill(
  table: CatalogueItem,
  guests: number,
  chairsPerTable: number,
  roomWidthM: number,
  roomLengthM: number,
): BanquetFillPlan | null {
  if (!isDiningTableItem(table)) return null;
  const seats = Math.min(seatCapacity(table), Math.max(0, Math.floor(chairsPerTable)));
  if (seats === 0) return null;
  const occupied = tableGroupPlanningFootprint(table, seats);
  const round = table.tableShape === "round";
  const target = requested(guests);
  const plan = planBanquetLayout({
    roomWidthM,
    roomLengthM,
    // Spacing runs between the backs of the chairs, tucked in.
    tableWidthM: occupied.width,
    tableDepthM: occupied.depth,
    tableRadiusM: round ? tableGroupPlanningRadius(table, seats) : undefined,
    seatsPerTable: seats,
    aisleM: BANQUET_CHAIR_CLEARANCE_M,
    wallClearanceM: BANQUET_CHAIR_CLEARANCE_M,
    targetGuests: target ?? undefined,
  });
  if (plan.tables.length === 0) return null;
  return {
    style: "dinner-rounds",
    tableItemId: table.id,
    round,
    tables: plan.tables,
    seatsPerTable: seats,
    tableCount: plan.tableCount,
    chairs: plan.seatsPlanned,
    guests: target,
    roomForSeats: plan.capacityTables * seats,
    meetsTarget: plan.meetsTarget,
  };
}

/** Plan theatre rows of `chair` for `guests` (0 fills the room). */
export function planTheatreFill(
  chair: CatalogueItem,
  guests: number,
  roomWidthM: number,
  roomLengthM: number,
): TheatreFillPlan | null {
  if (chair.category !== "chair") return null;
  const target = requested(guests);
  const plan = planTheatreLayout(roomWidthM, roomLengthM, { targetGuests: target ?? undefined });
  if (plan.seats.length === 0) return null;
  const room = target === null ? plan : planTheatreLayout(roomWidthM, roomLengthM);
  return {
    style: "theatre",
    chairItemId: chair.id,
    seats: plan.seats,
    chairs: plan.seatCount,
    rows: plan.rows,
    guests: target,
    roomForSeats: room.seatCount,
    meetsTarget: target === null || plan.seatCount >= target,
  };
}

/** The fill a style places with the planner's own furniture: 6 ft rounds set
 *  for the catalogue's recorded seats, or Turini chairs in rows. */
export function planAutoFill(
  style: AutoFillStyle,
  guests: number,
  roomWidthM: number,
  roomLengthM: number,
): AutoFillPlan | null {
  if (style === "dinner-rounds") {
    const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
    if (table === undefined) return null;
    return planBanquetFill(table, guests, banquetSeatsPerTable(table), roomWidthM, roomLengthM);
  }
  const chair = getCatalogueItemBySlug(DEFAULT_PLANNER_CHAIR_SLUG);
  return chair === undefined ? null : planTheatreFill(chair, guests, roomWidthM, roomLengthM);
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
): readonly BanquetTablePlacement[] {
  const shift = (tables: readonly BanquetTablePlacement[]): readonly BanquetTablePlacement[] =>
    tables.map((table) => ({ ...table, xM: table.xM + region.cx, zM: table.zM + region.cz }));
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

  let best: { readonly layout: GangwayLayout; readonly tables: readonly BanquetTablePlacement[] } | null = null;
  for (const layout of gangwayLayouts()) {
    if (!gangwaysServeExits(layout, input.exits, longAxis)) continue;
    const gangways = gangwayRects(layout, roomWidthM, roomLengthM, rule.gangwayM, longAxis);
    const reach = (tables: readonly BanquetTablePlacement[]): boolean => seatReach(tables, radiusM, rule.betweenTablesM, gangways);
    const walls: WallClearances = { xMin: band("xMin", layout), xMax: band("xMax", layout), zMin: band("zMin", layout), zMax: band("zMax", layout) };
    let tables: readonly BanquetTablePlacement[];
    if (!layout.spine) {
      tables = packRegion({ ...input, seatsPerTable: seats }, { cx: 0, cz: 0, width: roomWidthM, depth: roomLengthM }, walls, radiusM, occupied, reach);
    } else if (longAxis === "x") {
      // Two halves either side of a spine running along X; each keeps its own wall's band and nothing at the spine.
      const half = (roomLengthM - rule.gangwayM) / 2;
      const offset = (rule.gangwayM + half) / 2;
      tables = [
        ...packRegion({ ...input, seatsPerTable: seats }, { cx: 0, cz: -offset, width: roomWidthM, depth: half }, { ...walls, zMax: 0 }, radiusM, occupied, reach),
        ...packRegion({ ...input, seatsPerTable: seats }, { cx: 0, cz: offset, width: roomWidthM, depth: half }, { ...walls, zMin: 0 }, radiusM, occupied, reach),
      ];
    } else {
      const half = (roomWidthM - rule.gangwayM) / 2;
      const offset = (rule.gangwayM + half) / 2;
      tables = [
        ...packRegion({ ...input, seatsPerTable: seats }, { cx: -offset, cz: 0, width: half, depth: roomLengthM }, { ...walls, xMax: 0 }, radiusM, occupied, reach),
        ...packRegion({ ...input, seatsPerTable: seats }, { cx: offset, cz: 0, width: half, depth: roomLengthM }, { ...walls, xMin: 0 }, radiusM, occupied, reach),
      ];
    }
    if (best === null || tables.length > best.tables.length) best = { layout, tables };
  }
  if (best === null || best.tables.length === 0) return null;

  const target = requested(input.guests);
  const wanted = target === null ? best.tables.length : Math.min(best.tables.length, Math.ceil(target / seats));
  const placed = [...best.tables]
    .sort((a, b) => Math.hypot(a.xM, a.zM) - Math.hypot(b.xM, b.zM) || a.zM - b.zM || a.xM - b.xM)
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
    layout: best.layout,
    gangways: gangwayRects(best.layout, roomWidthM, roomLengthM, rule.gangwayM, longAxis),
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

/** The designated gangways of a room (metres), or null when no layout of the planner's rounds fits it. */
export function designatedGangways(roomWidthM: number, roomLengthM: number, exits: readonly RoomExit[] | null, rule: AisleRule = FILL_AISLE_RULE): DesignatedGangways | null {
  const key = [roomWidthM, roomLengthM, rule.gangwayM, rule.betweenTablesM, rule.wallBandM, exits?.map((exit) => exit.side).sort().join(",") ?? "unknown"].join("|");
  const cached = designatedCache.get(key);
  if (cached !== undefined || designatedCache.has(key)) return cached ?? null;
  const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
  const plan = table === undefined
    ? null
    : planGangwayFill({ table, seatsPerTable: banquetSeatsPerTable(table), guests: 0, roomWidthM, roomLengthM, exits, rule });
  const longAxis = roomWidthM >= roomLengthM ? "x" : "z";
  const result = plan === null ? null : {
    layout: plan.layout,
    bands: [
      ...ROOM_SIDES.filter((side) => plan.layout.sides[side]).map((side) => ({
        side,
        rect: gangwayRects({ sides: { xMin: side === "xMin", xMax: side === "xMax", zMin: side === "zMin", zMax: side === "zMax" }, spine: false }, roomWidthM, roomLengthM, rule.gangwayM, longAxis)[0] ?? { cx: 0, cz: 0, width: 0, depth: 0 },
      })),
      ...(plan.layout.spine ? [{ side: null, rect: gangwayRects({ sides: { xMin: false, xMax: false, zMin: false, zMax: false }, spine: true }, roomWidthM, roomLengthM, rule.gangwayM, longAxis)[0] ?? { cx: 0, cz: 0, width: 0, depth: 0 } }] : []),
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

/** A placed piece's floor shape, metres: a disc for a round table, else its turned rectangle's corners. */
function floorShape(placed: PlacedItem, item: CatalogueItem): { readonly disc: { readonly x: number; readonly z: number; readonly r: number } | null; readonly corners: readonly { readonly x: number; readonly z: number }[] } {
  const scale = placed.scale ?? 1;
  const x = toRealWorld(placed.x);
  const z = toRealWorld(placed.z);
  if (item.tableShape === "round") return { disc: { x, z, r: (item.width * scale) / 2 }, corners: [] };
  const hw = (item.width * scale) / 2;
  const hd = (item.depth * scale) / 2;
  const cos = Math.cos(placed.rotationY);
  const sin = Math.sin(placed.rotationY);
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx = 0, lz = 0]) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos }));
  return { disc: null, corners };
}

/** A shape's nearest reach toward a wall: its least distance from that wall, the point, and where along the wall it is. */
function reachTowards(shape: ReturnType<typeof floorShape>, side: RoomSide, roomWidthM: number, roomLengthM: number): { readonly distance: number; readonly along: number; readonly point: FloorPoint; readonly wallPoint: FloorPoint } {
  const points = shape.disc === null
    ? shape.corners
    : [{ x: shape.disc.x - shape.disc.r, z: shape.disc.z }, { x: shape.disc.x + shape.disc.r, z: shape.disc.z }, { x: shape.disc.x, z: shape.disc.z - shape.disc.r }, { x: shape.disc.x, z: shape.disc.z + shape.disc.r }];
  let best: { distance: number; point: FloorPoint } = { distance: Number.POSITIVE_INFINITY, point: { x: 0, z: 0 } };
  for (const point of points) {
    const distance = side === "xMin" ? point.x + roomWidthM / 2
      : side === "xMax" ? roomWidthM / 2 - point.x
      : side === "zMin" ? point.z + roomLengthM / 2
      : roomLengthM / 2 - point.z;
    if (distance < best.distance) best = { distance, point: { x: point.x, z: point.z } };
  }
  const { point } = best;
  const wallPoint = side === "xMin" ? { x: -roomWidthM / 2, z: point.z }
    : side === "xMax" ? { x: roomWidthM / 2, z: point.z }
    : side === "zMin" ? { x: point.x, z: -roomLengthM / 2 }
    : { x: point.x, z: roomLengthM / 2 };
  // Where along the wall: the piece's centre, which moves smoothly, not a corner a tie might swap.
  const centre = shape.disc ?? {
    x: shape.corners.reduce((sum, corner) => sum + corner.x, 0) / Math.max(1, shape.corners.length),
    z: shape.corners.reduce((sum, corner) => sum + corner.z, 0) / Math.max(1, shape.corners.length),
  };
  const along = side === "xMin" || side === "xMax" ? centre.z + roomLengthM / 2 : centre.x + roomWidthM / 2;
  return { distance: Math.max(0, best.distance), along, point, wallPoint };
}

/** One pinch as measured, before it is named and given its id. */
interface Pinch {
  readonly gangway: RoomSide | "spine";
  readonly gangwayName: string;
  readonly sides: readonly GangwaySide[];
  readonly sideNames: readonly string[];
  readonly widthM: number;
  readonly atM: number;
  readonly from: FloorPoint;
  readonly to: FloorPoint;
  readonly pieceIds: readonly string[];
}

/**
 * Every pinch where a layout narrows one of the room's designated gangways
 * under the guidance, narrowest first, as open review items: one per
 * gangway and table group (or set, or lone piece), measured exactly to its
 * nearest point, with the id the shared rule gives it
 * (`@omnitwin/types` gangway-review). Room dimensions are render-space, as
 * the planner's room store holds them; locations are real metres.
 */
export function gangwayReview(
  placedItems: readonly PlacedItem[],
  room: SpaceDimensions,
  exits: readonly RoomExit[] | null,
  options: { readonly rule?: AisleRule; readonly wallNames?: Readonly<Record<RoomSide, string>> } = {},
): readonly GangwayReviewItem[] {
  const rule = options.rule ?? FILL_AISLE_RULE;
  const names = options.wallNames ?? PLAIN_WALL_NAMES;
  const widthM = toRealWorld(room.width);
  const lengthM = toRealWorld(room.length);
  const designated = designatedGangways(widthM, lengthM, exits, rule);
  if (designated === null) return [];
  const world = createGhostWorld(placedItems, room);
  const shapes = placedItems.flatMap((placed) => {
    if (!isSceneFurniturePlacement(placed)) return [];
    const item = getCatalogueItem(placed.catalogueItemId);
    return item === undefined ? [] : [{ placed, shape: floorShape(placed, item) }];
  });
  const unitOf = (placed: PlacedItem): string => placed.setId ?? placed.groupId ?? placed.id;
  const pinches = new Map<string, Pinch>();
  // The narrowest point of each gangway's pinch by one unit, with every piece of that unit narrowing it.
  const note = (key: string, pinch: Pinch): void => {
    const known = pinches.get(key);
    const pieceIds = [...new Set([...(known?.pieceIds ?? []), ...pinch.pieceIds])];
    pinches.set(key, known === undefined || pinch.widthM < known.widthM ? { ...pinch, pieceIds } : { ...known, pieceIds });
  };

  for (const band of designated.bands) {
    if (band.side !== null) {
      const side = band.side;
      for (const { placed, shape } of shapes) {
        const reach = reachTowards(shape, side, widthM, lengthM);
        if (reach.distance >= rule.gangwayM - 1e-9) continue;
        note(`${side}|${unitOf(placed)}`, {
          gangway: side,
          gangwayName: names[side],
          sides: [{ wall: side }, { unit: unitOf(placed) }],
          sideNames: [names[side], obstacleName(placed.id, world).label],
          widthM: reach.distance,
          atM: reach.along,
          from: reach.wallPoint,
          to: reach.point,
          pieceIds: [placed.id],
        });
      }
      continue;
    }
    // A spine: the gap across it, between pieces either side of its centre line.
    const alongX = band.rect.width >= band.rect.depth;
    const across = (point: FloorPoint): number => (alongX ? point.z - band.rect.cz : point.x - band.rect.cx);
    const extent = (shape: ReturnType<typeof floorShape>): { readonly lo: number; readonly hi: number; readonly from: number; readonly to: number } => {
      const points = shape.disc === null ? shape.corners : [
        { x: shape.disc.x - shape.disc.r, z: shape.disc.z - shape.disc.r }, { x: shape.disc.x + shape.disc.r, z: shape.disc.z + shape.disc.r },
      ];
      const acrossValues = points.map(across);
      const alongValues = points.map((point) => (alongX ? point.x : point.z));
      return { lo: Math.min(...acrossValues), hi: Math.max(...acrossValues), from: Math.min(...alongValues), to: Math.max(...alongValues) };
    };
    const measured = shapes.map(({ placed, shape }) => ({ placed, box: extent(shape) }));
    const at = (alongM: number, acrossM: number): FloorPoint => (alongX
      ? { x: alongM, z: band.rect.cz + acrossM }
      : { x: band.rect.cx + acrossM, z: alongM });
    for (const low of measured) {
      if (low.box.hi > rule.gangwayM / 2 || low.box.hi < -rule.gangwayM) continue;
      for (const high of measured) {
        if (unitOf(high.placed) === unitOf(low.placed)) continue;
        if (high.box.lo < -rule.gangwayM / 2 || high.box.lo > rule.gangwayM) continue;
        if (high.box.lo < low.box.hi || high.box.to < low.box.from || high.box.from > low.box.to) continue;
        const gap = high.box.lo - low.box.hi;
        if (gap >= rule.gangwayM - 1e-9) continue;
        const middle = (Math.max(low.box.from, high.box.from) + Math.min(low.box.to, high.box.to)) / 2;
        note(`spine|${unitOf(low.placed)}|${unitOf(high.placed)}`, {
          gangway: "spine",
          gangwayName: "the middle",
          sides: [{ unit: unitOf(low.placed) }, { unit: unitOf(high.placed) }],
          sideNames: [obstacleName(low.placed.id, world).label, obstacleName(high.placed.id, world).label],
          widthM: gap,
          atM: middle + (alongX ? widthM : lengthM) / 2,
          from: at(middle, low.box.hi),
          to: at(middle, high.box.lo),
          pieceIds: [low.placed.id, high.placed.id],
        });
      }
    }
  }
  const guidance = { thresholdM: rule.gangwayM, source: rule.source };
  return [...pinches.values()]
    .sort((a, b) => a.widthM - b.widthM)
    .map((pinch) => ({
      id: gangwayReviewId(pinch.gangway, pinch.atM, pinch.sides),
      widthM: pinch.widthM,
      guidance,
      gangway: pinch.gangwayName,
      location: { kind: "segment" as const, from: pinch.from, to: pinch.to },
      pieceIds: pinch.pieceIds,
      sides: [...pinch.sideNames],
      status: "open" as const,
    }));
}

/** The flag the ghost and the caption show: "Gangway 0.95 m · under the 1.1 m guidance · the venue will review". */
export function gangwayFlag(widthM: number, rule: AisleRule = FILL_AISLE_RULE): string {
  return `Gangway ${(Math.round(widthM * 100) / 100).toFixed(2)} m · under the ${String(rule.gangwayM)} m guidance · the venue will review`;
}

// ---------------------------------------------------------------------------
// Merge, never replace (Q-10): Fill sets anew only the round groups of the
// kind it lays; every other piece stays exactly where it is, ids and all,
// and keeps the aisle rule round it as a keep-out. Rounds it sets anew reuse
// the old tables' ids, names and cloths (so their notes follow), Table 1
// first.
// ---------------------------------------------------------------------------

/** The pieces Fill sets anew: every group whose table is a round of the fill table's kind, with its chairs. */
export function fillRefillIds(placedItems: readonly PlacedItem[], fillTable: CatalogueItem): ReadonlySet<string> {
  const kind = seatBaseSlug(fillTable.slug);
  const groups = new Set<string>();
  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined || placed.groupId === null || placed.setId !== undefined || !isDiningTableItem(item)) continue;
    if (item.tableShape === "round" && seatBaseSlug(item.slug) === kind) groups.add(placed.groupId);
  }
  return new Set(placedItems.filter((placed) => placed.groupId !== null && groups.has(placed.groupId)).map((placed) => placed.id));
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

/**
 * The round groups a fill plan sets down, reusing the refilled tables' ids,
 * names, cloths and chairs' ids in refill order; tables beyond those are new.
 * Render-space, ready for the placement store.
 */
export function refillPieces(
  placedItems: readonly PlacedItem[],
  refillIds: ReadonlySet<string>,
  plan: BanquetFillPlan,
  newId: () => string = generatePlacedId,
): readonly PlacedItem[] {
  const refilled = placedItems.filter((placed) => refillIds.has(placed.id));
  const oldTables = refilled.filter((placed) => {
    const item = getCatalogueItem(placed.catalogueItemId);
    return item !== undefined && isDiningTableItem(item);
  }).sort(refillOrder);
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
    const oldChairs = refilled.filter((placed) => placed.groupId === groupId && placed.id !== old.id);
    pieces.push({ ...old, x: table.x, z: table.z, y: table.y, rotationY: table.rotationY });
    chairs.forEach((chair, c) => {
      const reuse = oldChairs[c];
      pieces.push(reuse === undefined ? { ...chair, groupId } : { ...reuse, x: chair.x, z: chair.z, y: chair.y, rotationY: chair.rotationY });
    });
  });
  return pieces;
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

/** The spacing the fill used, in the trade's words. */
export function autoFillBasis(plan: AutoFillPlan): string {
  if (plan.style === "theatre") {
    return `Rows ${metres(THEATRE_SPACING.rowPitchM)} apart, a ${metres(THEATRE_SPACING.aisleM)} centre aisle and ${metres(THEATRE_SPACING.stageDepthM)} clear at the front.`;
  }
  const kind = plan.round ? "Rounds" : "Tables";
  return `${kind} of ${String(plan.seatsPerTable)}, with ${metres(BANQUET_CHAIR_CLEARANCE_M)} clear behind every chair.`;
}

/**
 * When the room cannot take the guests asked for at this spacing, the plain
 * line that says so, beside the venue's own figure when it publishes one:
 * "Room for 140 at this spacing; the venue publishes 180 for a seated dinner."
 * Null when the request fits.
 */
export function roomAtSpacingLine(plan: AutoFillPlan, published: PublishedFigure | null): string | null {
  if (plan.meetsTarget || plan.guests === null) return null;
  const room = `Room for ${String(plan.roomForSeats)} at this spacing`;
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
