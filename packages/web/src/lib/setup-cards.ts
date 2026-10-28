import { seatBaseSlug, seatsFor } from "@omnitwin/types";
import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { plannerChairSlug } from "./furniture-defaults.js";
import { createPlacedItem, generatePlacedId, type PlacedItem } from "./placement.js";
import { plannerFeatureEnabled } from "./planner-features.js";
import { createTableGroup } from "./table-group.js";

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

/**
 * Whether a card sets down a whole set rather than one piece alone: every
 * card but a piece with no seats. A set takes the grid only as it follows the
 * pointer; one piece also takes the single piece's edge, wall and line snaps.
 */
export function cardIsWholeSet(params: CardParams): boolean {
  return params.card !== "piece" || seatsInHand(params) > 0;
}

/**
 * Whether the card in hand is set down as a card, its whole stamp in one
 * step with no chair dialog: a set card (Round, Top table, Long table, Dance
 * floor) always, from v2's rail as from v1's list (Q-07, Q-13); a piece card
 * once the card dock is on (setupCards), a dining table's only once its
 * seats ride on the card (seatsOnTheCard), else the old way, through the
 * chair dialog. The ghost, the snaps and the commit all ask this.
 */
export function placesAsCard(params: CardParams): boolean {
  if (params.card !== "piece") return true;
  if (!plannerFeatureEnabled("setupCards")) return false;
  // A dining table from v1's list keeps its chair dialog until its seats ride on the card (Q-07, Q-12).
  return params.seats === null || plannerFeatureEnabled("seatsOnTheCard");
}

/**
 * Whether the card in hand is judged with every body, before the drop and
 * at the commit (the truthful ghost, Q-05): a set card always, as the card
 * dock's own, from v2's rail as from v1's list; a piece card behind
 * truthfulGhost.
 */
export function judgesCard(params: CardParams): boolean {
  return params.card !== "piece" || plannerFeatureEnabled("truthfulGhost");
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

// ---------------------------------------------------------------------------
// Stamping: the pieces a card sets down (spec §6, Q-08a)
//
// The ghost draws exactly what `stampSetup` returns and the commit places
// exactly that, so preview and result never differ. A table and its chairs
// share one groupId; a dance floor is one group with no table; a run of
// trestles gives each trestle its own group with its own chairs, bound into
// one set by setId so each trestle's chairs still re-ring on their own.
// Positions are render-space, turned about the stamp's origin.
// ---------------------------------------------------------------------------

export interface StampOrigin {
  readonly x: number;
  readonly z: number;
  /** The surface the set stands on (0 is the floor). */
  readonly y?: number;
}

/** A local offset (before turning) as a world offset, by the planner's convention for chairs round a table. */
function turned(localX: number, localZ: number, rotationY: number): { readonly x: number; readonly z: number } {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { x: localX * cos + localZ * sin, z: -localX * sin + localZ * cos };
}

/** A world offset as a local one: the inverse of `turned`. */
function unturned(dx: number, dz: number, rotationY: number): { readonly x: number; readonly z: number } {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

function stampPiece(item: CatalogueItem, seats: number | null, origin: StampOrigin, rotationY: number, newId: () => string, chairSlug: string): readonly PlacedItem[] {
  const y = origin.y ?? 0;
  if (seats !== null && seats > 0 && isDiningTableItem(item)) {
    return createTableGroup(item.id, origin.x, origin.z, rotationY, seats, y, newId, "around", chairSlug);
  }
  return [createPlacedItem(item.id, origin.x, origin.z, rotationY, null, y, newId())];
}

function stampDanceFloor(params: DanceFloorCardParams, origin: StampOrigin, rotationY: number, newId: () => string): readonly PlacedItem[] {
  const panel = getCatalogueItemBySlug(DANCE_FLOOR_PANEL_SLUG);
  if (panel === undefined) return [];
  const size = toRenderSpace(panel.width);
  const groupId = newId();
  const panels: PlacedItem[] = [];
  for (let row = 0; row < params.rows; row += 1) {
    for (let col = 0; col < params.cols; col += 1) {
      const offset = turned((col - (params.cols - 1) / 2) * size, (row - (params.rows - 1) / 2) * size, rotationY);
      panels.push(createPlacedItem(panel.id, origin.x + offset.x, origin.z + offset.z, rotationY, groupId, origin.y ?? 0, newId()));
    }
  }
  return panels;
}

function stampTrestleRun(params: TrestleRunCardParams, origin: StampOrigin, rotationY: number, newId: () => string, chairSlug: string): readonly PlacedItem[] {
  const trestle = cardMainItem(params);
  if (trestle === undefined) return [];
  const length = toRenderSpace(trestle.width);
  const setId = params.trestles > 1 ? newId() : undefined;
  const side = params.card === "top-table" ? "back" : "around";
  const pieces: PlacedItem[] = [];
  for (let i = 0; i < params.trestles; i += 1) {
    const offset = turned((i - (params.trestles - 1) / 2) * length, 0, rotationY);
    const group = createTableGroup(
      trestle.id,
      origin.x + offset.x,
      origin.z + offset.z,
      rotationY,
      SEATS_PER_TRESTLE[params.card],
      origin.y ?? 0,
      newId,
      side,
      chairSlug,
    );
    pieces.push(...(setId === undefined ? group : group.map((piece) => ({ ...piece, setId }))));
  }
  return pieces;
}

/**
 * The pieces this card sets down at this pose (spec §6). `newId` lets the
 * ghost keep the same ids frame to frame; the commit takes fresh ones. Seats
 * get the event's chair (plannerChairSlug) unless `chairSlug` names one.
 */
export function stampSetup(
  params: CardParams,
  origin: StampOrigin,
  rotationY: number,
  newId: () => string = generatePlacedId,
  chairSlug: string = plannerChairSlug(),
): readonly PlacedItem[] {
  switch (params.card) {
    case "round":
    case "piece": {
      const item = cardMainItem(params);
      return item === undefined ? [] : stampPiece(item, params.seats, origin, rotationY, newId, chairSlug);
    }
    case "dance-floor": return stampDanceFloor(params, origin, rotationY, newId);
    case "top-table":
    case "long-table": return stampTrestleRun(params, origin, rotationY, newId, chairSlug);
  }
}

// ---------------------------------------------------------------------------
// A placed dance floor: read its grid back, and resize it in whole panels.
// ---------------------------------------------------------------------------

export interface DanceFloorGrid {
  readonly cols: number;
  readonly rows: number;
  /** The floor's centre (render-space). */
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly rotationY: number;
}

/** Panels this far (render units) from a whole-panel position still count as on the grid. */
const GRID_TOLERANCE = 0.01;

interface PanelCell {
  readonly piece: PlacedItem;
  readonly col: number;
  readonly row: number;
}

function panelCells(panels: readonly PlacedItem[]): { readonly cells: readonly PanelCell[]; readonly size: number; readonly first: PlacedItem } | null {
  const first = panels[0];
  const panel = getCatalogueItemBySlug(DANCE_FLOOR_PANEL_SLUG);
  if (first === undefined || panel === undefined) return null;
  const size = toRenderSpace(panel.width);
  const cells: PanelCell[] = [];
  for (const piece of panels) {
    if (piece.catalogueItemId !== panel.id && piece.catalogueItemId !== panel.slug) return null;
    const local = unturned(piece.x - first.x, piece.z - first.z, first.rotationY);
    const col = Math.round(local.x / size);
    const row = Math.round(local.z / size);
    if (Math.abs(local.x - col * size) > GRID_TOLERANCE || Math.abs(local.z - row * size) > GRID_TOLERANCE) return null;
    cells.push({ piece, col, row });
  }
  return { cells, size, first };
}

/** The whole grid a dance floor's panels form, or null when they do not form one. */
export function danceFloorGrid(panels: readonly PlacedItem[]): DanceFloorGrid | null {
  const read = panelCells(panels);
  if (read === null) return null;
  const cols = read.cells.map((cell) => cell.col);
  const rows = read.cells.map((cell) => cell.row);
  const col0 = Math.min(...cols);
  const row0 = Math.min(...rows);
  const width = Math.max(...cols) - col0 + 1;
  const depth = Math.max(...rows) - row0 + 1;
  const filled = new Set(read.cells.map((cell) => `${String(cell.col)},${String(cell.row)}`));
  if (filled.size !== read.cells.length || filled.size !== width * depth) return null;
  const centre = turned((col0 + (width - 1) / 2) * read.size, (row0 + (depth - 1) / 2) * read.size, read.first.rotationY);
  return {
    cols: width,
    rows: depth,
    x: read.first.x + centre.x,
    z: read.first.z + centre.z,
    y: read.first.y,
    rotationY: read.first.rotationY,
  };
}

/** Which edge holds still as a floor is resized: −1 its low side, 1 its high side, 0 its centre. */
export interface ResizeAnchor {
  readonly x: -1 | 0 | 1;
  readonly z: -1 | 0 | 1;
}

/**
 * The dance floor resized to `cols` × `rows` whole panels, as `resizeArea`
 * commits it: the anchored edge holds still, panels already in place keep
 * their ids, and new panels take the group's. Null when the panels do not
 * form one grid.
 */
export function resizeDanceFloor(
  panels: readonly PlacedItem[],
  cols: number,
  rows: number,
  anchor: ResizeAnchor = { x: 0, z: 0 },
  newId: () => string = generatePlacedId,
): readonly PlacedItem[] | null {
  const read = panelCells(panels);
  const grid = danceFloorGrid(panels);
  if (read === null || grid === null) return null;
  const nextCols = Math.min(DANCE_FLOOR_PANELS.max, Math.max(DANCE_FLOOR_PANELS.min, Math.round(cols)));
  const nextRows = Math.min(DANCE_FLOOR_PANELS.max, Math.max(DANCE_FLOOR_PANELS.min, Math.round(rows)));
  const col0 = Math.min(...read.cells.map((cell) => cell.col));
  const row0 = Math.min(...read.cells.map((cell) => cell.row));
  // The new grid's first cell, in the old grid's cells: anchored low, high or about the centre.
  const startCol = anchor.x === -1 ? col0 : anchor.x === 1 ? col0 + grid.cols - nextCols : col0 + (grid.cols - nextCols) / 2;
  const startRow = anchor.z === -1 ? row0 : anchor.z === 1 ? row0 + grid.rows - nextRows : row0 + (grid.rows - nextRows) / 2;

  const byCell = new Map(read.cells.map((cell) => [`${String(cell.col)},${String(cell.row)}`, cell.piece]));
  const kept = new Set<string>();
  const slots: { readonly col: number; readonly row: number; readonly piece: PlacedItem | undefined }[] = [];
  for (let row = 0; row < nextRows; row += 1) {
    for (let col = 0; col < nextCols; col += 1) {
      const atCol = startCol + col;
      const atRow = startRow + row;
      const piece = Number.isInteger(atCol) && Number.isInteger(atRow) ? byCell.get(`${String(atCol)},${String(atRow)}`) : undefined;
      if (piece !== undefined) kept.add(piece.id);
      slots.push({ col: atCol, row: atRow, piece });
    }
  }
  // A panel already in its cell stays exactly as it is. Panels the new grid
  // leaves are reused for its new cells before any new id is taken.
  const spare = read.cells.map((cell) => cell.piece).filter((piece) => !kept.has(piece.id));
  return slots.map((slot) => {
    if (slot.piece !== undefined) return slot.piece;
    const offset = turned(slot.col * read.size, slot.row * read.size, read.first.rotationY);
    const base = spare.shift() ?? { ...read.first, id: newId() };
    return { ...base, x: read.first.x + offset.x, z: read.first.z + offset.z, y: grid.y, rotationY: grid.rotationY, groupId: read.first.groupId };
  });
}

/** A dance floor drawn by press-drag: its panels a side and its centre, render-space. */
export interface DrawnDanceFloor {
  readonly cols: number;
  readonly rows: number;
  readonly x: number;
  readonly z: number;
}

/**
 * A dance floor drawn by press-drag (Q-08a): whole panels from the press to
 * the pointer, 2 to 12 a side, its near corner held at the press, turned as
 * the piece in hand is turned. Null until the drag is half a panel long, so
 * a click is still a click.
 */
export function drawnDanceFloor(
  start: { readonly x: number; readonly z: number },
  end: { readonly x: number; readonly z: number },
  rotationY: number,
): DrawnDanceFloor | null {
  const panel = getCatalogueItemBySlug(DANCE_FLOOR_PANEL_SLUG);
  if (panel === undefined) return null;
  const size = toRenderSpace(panel.width);
  const local = unturned(end.x - start.x, end.z - start.z, rotationY);
  if (Math.max(Math.abs(local.x), Math.abs(local.z)) < size / 2) return null;
  const cols = clamp(Math.abs(local.x) / size, DANCE_FLOOR_PANELS);
  const rows = clamp(Math.abs(local.z) / size, DANCE_FLOOR_PANELS);
  const towards = (value: number): number => (value < 0 ? -1 : 1);
  const centre = turned((towards(local.x) * cols * size) / 2, (towards(local.z) * rows * size) / 2, rotationY);
  return { cols, rows, x: start.x + centre.x, z: start.z + centre.z };
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
