import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "./catalogue.js";
import { planBanquetLayout, type BanquetTablePlacement } from "./auto-layout.js";
import { planTheatreLayout, THEATRE_SPACING, type TheatreSeatPlacement } from "./theatre-layout.js";
import {
  banquetSeatsPerTable,
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
