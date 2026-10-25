import { seatBaseSlug, seatsFor } from "@omnitwin/types";
import { getCatalogueItemBySlug, type CatalogueItem } from "./catalogue.js";
import { plannerFeatureEnabled } from "./planner-features.js";

// ---------------------------------------------------------------------------
// The cards' definitions (card-dock spec §5–§6; slices E0).
//
// A card is either a setup, which sets down several catalogue pieces as one
// step (a round with its chairs, a dance floor of panels, a run of trestles),
// or a single catalogue piece. This module names them, sizes them and counts
// their seats from one set of parameters, so the rail, the catalogue, the
// ghost's tag and the stepper all read the same words. Laying the pieces out
// is `stampSetup`'s job (slice E1).
// ---------------------------------------------------------------------------

export type SetupCardId = "round" | "dance-floor" | "top-table" | "long-table";

/** A single catalogue piece as a card, by its slug: `piece:bar-counter`. */
export type PieceCardId = `piece:${string}`;

export type CardId = SetupCardId | PieceCardId;

/** The cloth or finish a setup's tables wear. */
export type TableColourway = "white" | "black" | "wood" | "bare";

export interface RoundCardParams {
  readonly card: "round";
  readonly seats: number;
  readonly colourway: TableColourway;
}

export interface DanceFloorCardParams {
  readonly card: "dance-floor";
  /** Panels across the floor's width (x before turning). */
  readonly cols: number;
  /** Panels along its depth (z before turning). */
  readonly rows: number;
}

export interface TrestleRunCardParams {
  /** Top table seats one side of the run; Long table seats both. */
  readonly card: "top-table" | "long-table";
  readonly trestles: number;
  readonly colourway: TableColourway;
}

export interface PieceCardParams {
  readonly card: "piece";
  readonly slug: string;
  /** The covers a dining table is set for; null for anything not seated dining. */
  readonly seats: number | null;
}

export type CardParams = RoundCardParams | DanceFloorCardParams | TrestleRunCardParams | PieceCardParams;

/** What a card says about itself: the rail's name, its size line and the seats it adds. */
export interface CardFace {
  readonly name: string;
  readonly size: string;
  readonly seats: number;
}

export const SETUP_CARD_IDS: readonly SetupCardId[] = ["round", "top-table", "long-table", "dance-floor"];

const ROUND_TABLE_SLUGS: Readonly<Partial<Record<TableColourway, string>>> = {
  white: "round-table-6ft-white",
  black: "round-table-6ft-black",
  bare: "round-table-6ft",
};

const TRESTLE_SLUGS: Readonly<Partial<Record<TableColourway, string>>> = {
  white: "trestle-6ft-white",
  black: "trestle-6ft-black",
  wood: "trestle-6ft-wooden",
  bare: "trestle-6ft",
};

/** The colourways each setup offers, in the order C cycles them. */
export const CARD_COLOURWAYS: Readonly<Record<"round" | "top-table" | "long-table", readonly TableColourway[]>> = {
  round: ["white", "black", "bare"],
  "top-table": ["white", "black", "wood", "bare"],
  "long-table": ["white", "black", "wood", "bare"],
};

export const DANCE_FLOOR_PANEL_SLUG = "dancefloor-panel";

/** Panels a side: a 5 × 5 floor (4.6 m square) to start, 2 to 12 a side. */
export const DANCE_FLOOR_PANELS = { default: 5, min: 2, max: 12 } as const;

/** Chairs a 6 ft trestle takes in a run: Top table seats one side, Long table both (spec §6). */
export const SEATS_PER_TRESTLE = { "top-table": 3, "long-table": 6 } as const;

/**
 * Trestles in a run. Until Top table and Long table are built as sets
 * (`tableSets`, Q-08b), each card sets down one trestle through
 * `placeTableGroup` (spec §5).
 */
export function trestleRange(card: "top-table" | "long-table"): { readonly default: number; readonly min: number; readonly max: number } {
  if (!plannerFeatureEnabled("tableSets")) return { default: 1, min: 1, max: 1 };
  return card === "top-table" ? { default: 4, min: 2, max: 6 } : { default: 4, min: 2, max: 10 };
}

export function isSetupCardId(id: string): id is SetupCardId {
  return (SETUP_CARD_IDS as readonly string[]).includes(id);
}

export function pieceCardId(slug: string): PieceCardId {
  return `piece:${slug}`;
}

/** The catalogue slug a piece card names, or null for a setup card. */
export function pieceCardSlug(id: CardId): string | null {
  return id.startsWith("piece:") ? id.slice("piece:".length) : null;
}

export function cardIdOf(params: CardParams): CardId {
  return params.card === "piece" ? pieceCardId(params.slug) : params.card;
}

function clamp(value: number, range: { readonly min: number; readonly max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function colourwayFor(card: "round" | "top-table" | "long-table", asked: TableColourway | undefined): TableColourway {
  const offered = CARD_COLOURWAYS[card];
  return asked !== undefined && offered.includes(asked) ? asked : offered[0] ?? "white";
}

/** Parameters as they may be asked for: any card's fields, all optional. */
export type CardParamsRequest = Partial<{
  readonly seats: number;
  readonly cols: number;
  readonly rows: number;
  readonly trestles: number;
  readonly colourway: TableColourway;
}>;

/** A card's parameters as a request, to change one field and keep the rest. */
export function cardParamsRequest(params: CardParams): CardParamsRequest {
  switch (params.card) {
    case "round": return { seats: params.seats, colourway: params.colourway };
    case "dance-floor": return { cols: params.cols, rows: params.rows };
    case "top-table":
    case "long-table": return { trestles: params.trestles, colourway: params.colourway };
    case "piece": return params.seats === null ? {} : { seats: params.seats };
  }
}

/**
 * A card's parameters: its defaults, then what is asked, held inside its
 * ranges. `rememberedSeats` (by seat base slug) carries the last count chosen
 * for a table this session. Null for a piece the catalogue does not hold.
 */
export function cardParamsFor(
  id: CardId,
  asked: CardParamsRequest = {},
  rememberedSeats: Readonly<Record<string, number>> = {},
): CardParams | null {
  const slug = pieceCardSlug(id);
  if (slug !== null) {
    if (getCatalogueItemBySlug(slug) === undefined) return null;
    const range = seatsFor({ slug });
    return {
      card: "piece",
      slug,
      seats: range === null ? null : clamp(asked.seats ?? rememberedSeats[seatBaseSlug(slug)] ?? range.default, range),
    };
  }
  switch (id) {
    case "round": {
      const range = seatsFor({ slug: "round-table-6ft" });
      const fallback = range?.default ?? 10;
      return {
        card: "round",
        seats: range === null ? fallback : clamp(asked.seats ?? rememberedSeats["round-table-6ft"] ?? fallback, range),
        colourway: colourwayFor("round", asked.colourway),
      };
    }
    case "dance-floor":
      return {
        card: "dance-floor",
        cols: clamp(asked.cols ?? DANCE_FLOOR_PANELS.default, DANCE_FLOOR_PANELS),
        rows: clamp(asked.rows ?? DANCE_FLOOR_PANELS.default, DANCE_FLOOR_PANELS),
      };
    case "top-table":
    case "long-table": {
      const range = trestleRange(id);
      return {
        card: id,
        trestles: clamp(asked.trestles ?? range.default, range),
        colourway: colourwayFor(id, asked.colourway),
      };
    }
  }
  return null;
}

/** The catalogue piece the ghost is built around: the table, the panel, the trestle, or the piece itself. */
export function cardMainSlug(params: CardParams): string {
  switch (params.card) {
    case "round": return ROUND_TABLE_SLUGS[params.colourway] ?? "round-table-6ft-white";
    case "dance-floor": return DANCE_FLOOR_PANEL_SLUG;
    case "top-table":
    case "long-table": return TRESTLE_SLUGS[params.colourway] ?? "trestle-6ft-white";
    case "piece": return params.slug;
  }
}

/** The catalogue piece behind a card, when the catalogue holds it. */
export function cardMainItem(params: CardParams): CatalogueItem | undefined {
  return getCatalogueItemBySlug(cardMainSlug(params));
}

/** The seats setting this card down adds: the ghost tag's "+10 seats". */
export function seatsInHand(params: CardParams): number {
  switch (params.card) {
    case "round": return params.seats;
    case "dance-floor": return 0;
    case "top-table":
    case "long-table": return params.trestles * SEATS_PER_TRESTLE[params.card];
    case "piece": return params.seats ?? 0;
  }
}

/** Card copy: metres to one place, "4.6"; whole figures plainly, "2". */
function cardMetres(metres: number): string {
  const tenths = Math.round(metres * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

function pieceSize(item: CatalogueItem): string {
  return item.tableShape === "round"
    ? `${cardMetres(item.width)} m round`
    : `${cardMetres(item.width)} × ${cardMetres(item.depth)} m`;
}

/** The card's name, size line and the seats it adds, from its parameters. */
export function describeCard(params: CardParams): CardFace {
  const seats = seatsInHand(params);
  switch (params.card) {
    case "round":
      // The 6 ft round is known by its 1.83 m, so it keeps two places.
      return { name: `Round of ${String(params.seats)}`, size: "1.83 m round", seats };
    case "dance-floor": {
      const panel = getCatalogueItemBySlug(DANCE_FLOOR_PANEL_SLUG)?.width ?? 0.91;
      const width = cardMetres(params.cols * panel);
      const depth = cardMetres(params.rows * panel);
      return { name: "Dance floor", size: params.cols === params.rows ? `${width} m square` : `${width} × ${depth} m`, seats };
    }
    case "top-table":
    case "long-table": {
      const trestle = cardMainItem(params)?.width ?? 1.83;
      return { name: params.card === "top-table" ? "Top table" : "Long table", size: `${cardMetres(params.trestles * trestle)} m`, seats };
    }
    case "piece": {
      const item = getCatalogueItemBySlug(params.slug);
      return { name: item?.name ?? params.slug, size: item === undefined ? "" : pieceSize(item), seats };
    }
  }
}

/**
 * One step of + or −: seats at a round or a dining piece, a panel each way
 * on a dance floor, a trestle on a run. At a limit it returns the same
 * object, so a caller can tell nothing changed.
 */
export function stepCardParams(params: CardParams, delta: 1 | -1): CardParams {
  switch (params.card) {
    case "round": {
      const range = seatsFor({ slug: "round-table-6ft" });
      const seats = range === null ? params.seats : clamp(params.seats + delta, range);
      return seats === params.seats ? params : { ...params, seats };
    }
    case "dance-floor": {
      const cols = clamp(params.cols + delta, DANCE_FLOOR_PANELS);
      const rows = clamp(params.rows + delta, DANCE_FLOOR_PANELS);
      return cols === params.cols && rows === params.rows ? params : { ...params, cols, rows };
    }
    case "top-table":
    case "long-table": {
      const trestles = clamp(params.trestles + delta, trestleRange(params.card));
      return trestles === params.trestles ? params : { ...params, trestles };
    }
    case "piece": {
      const range = seatsFor({ slug: params.slug });
      if (params.seats === null || range === null) return params;
      const seats = clamp(params.seats + delta, range);
      return seats === params.seats ? params : { ...params, seats };
    }
  }
}
