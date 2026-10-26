import { seatBaseSlug } from "@omnitwin/types";
import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { footprintBounds, selectionUnits } from "./placement-edit.js";
import { tableLabelNumber, type PlacedItem } from "./placement.js";
import { DANCE_FLOOR_PANEL_SLUG, danceFloorGrid, describeCard } from "./setup-cards.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// Walking the room by keyboard (approved spec §11; QoL B-X2). ] and [ step
// through the tables by their numbers, then row by row through any table
// without one; from a piece of another kind they step through that kind,
// row by row; Shift ] and Shift [ step through everything, row by row.
//
// A stop is what a person thinks of as one piece: a table with its chairs,
// a run of trestles, a dance floor's panels, a lone piece. The walk selects
// its table (its lowest-numbered), else its first piece, as a click would.
// Each end wraps round to the other.
// ---------------------------------------------------------------------------

/** The kind every dining table's stop answers to, whatever its model. */
export const TABLE_KIND = "table";

/** Stops whose middles lie within this of a row's first, front to back, share the row. */
const ROW_METRES = 0.9;

export interface WalkStop {
  /** The piece the walk selects. */
  readonly pieceId: string;
  /** Every piece in the stop. */
  readonly pieces: readonly PlacedItem[];
  /** TABLE_KIND for a dining table's stop, else its piece's model, whatever its cloth. */
  readonly kind: string;
  /** The "Table N" it answers to, or null. */
  readonly number: number | null;
  /** Where it stands, render-space: its tables' middle, else its footprint's. */
  readonly x: number;
  readonly z: number;
}

/** Where the last walk stood: the order it stepped through and where in it, so a walk goes on from a stop just removed. */
export interface WalkCursor {
  readonly order: readonly string[];
  readonly at: number;
}

function isDiningTable(piece: PlacedItem): boolean {
  const item = getCatalogueItem(piece.catalogueItemId);
  return item !== undefined && isDiningTableItem(item);
}

function isChair(piece: PlacedItem): boolean {
  return getCatalogueItem(piece.catalogueItemId)?.category === "chair";
}

function kindOf(piece: PlacedItem): string {
  const item = getCatalogueItem(piece.catalogueItemId);
  return item === undefined ? piece.catalogueItemId : seatBaseSlug(item.slug);
}

function numberOf(piece: PlacedItem): number | null {
  return tableLabelNumber(piece.label);
}

function stopOf(unit: readonly PlacedItem[]): WalkStop | null {
  const tables = unit.filter(isDiningTable);
  if (tables.length > 0) {
    const [head] = [...tables].sort((a, b) => (numberOf(a) ?? Infinity) - (numberOf(b) ?? Infinity));
    if (head === undefined) return null;
    return {
      pieceId: head.id,
      pieces: unit,
      kind: TABLE_KIND,
      number: numberOf(head),
      x: tables.reduce((sum, table) => sum + table.x, 0) / tables.length,
      z: tables.reduce((sum, table) => sum + table.z, 0) / tables.length,
    };
  }
  const [head] = unit;
  const bounds = footprintBounds(unit);
  if (head === undefined || bounds === null) return null;
  return {
    pieceId: head.id,
    pieces: unit,
    kind: kindOf(head),
    number: null,
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

/** Every stop in the room: each set, each group, each lone piece of furniture. */
export function walkStops(placedItems: readonly PlacedItem[]): readonly WalkStop[] {
  return selectionUnits(placedItems.filter((piece) => isSceneFurniturePlacement(piece)))
    .flatMap((unit) => {
      const stop = stopOf(unit);
      return stop === null ? [] : [stop];
    });
}

/** Stops in rows across the room, front to back along its length, each row left to right. */
function inRows(stops: readonly WalkStop[]): readonly WalkStop[] {
  const tolerance = toRenderSpace(ROW_METRES);
  const rows: WalkStop[][] = [];
  for (const stop of [...stops].sort((a, b) => a.z - b.z || a.x - b.x)) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (row === undefined || first === undefined || stop.z - first.z > tolerance) rows.push([stop]);
    else row.push(stop);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * The order a walk steps through one kind (null: every kind). Tables go by
 * their numbers, then row by row where a table has no number.
 */
export function walkOrder(stops: readonly WalkStop[], kind: string | null): readonly WalkStop[] {
  const walked = kind === null ? stops : stops.filter((stop) => stop.kind === kind);
  if (kind !== TABLE_KIND) return inRows(walked);
  const numbered = walked.filter((stop) => stop.number !== null).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return [...numbered, ...inRows(walked.filter((stop) => stop.number === null))];
}

/** The kind ] and [ step through: the first selected piece's stop's, or tables with nothing selected. */
export function walkKind(stops: readonly WalkStop[], selectedIds: ReadonlySet<string>): string {
  return stops.find((stop) => stop.pieces.some((piece) => selectedIds.has(piece.id)))?.kind ?? TABLE_KIND;
}

/** From a stop the last walk chose and that has since gone: the next one still standing, the way the walk goes. */
function resume(order: readonly WalkStop[], step: 1 | -1, cursor: WalkCursor): WalkStop | null {
  const byId = new Map(order.map((stop) => [stop.pieceId, stop]));
  if (byId.has(cursor.order[cursor.at] ?? "")) return null;
  for (let i = cursor.at + step; i >= 0 && i < cursor.order.length; i += step) {
    const stop = byId.get(cursor.order[i] ?? "");
    if (stop !== undefined) return stop;
  }
  return null;
}

/**
 * The stop one `step` along: after the selection's last stop in the order
 * (before its first, going back); with nothing selected, on from where a
 * stop the last walk chose was removed, else the first (the last, going
 * back). Null with nothing to walk.
 */
export function walkStep(
  order: readonly WalkStop[],
  step: 1 | -1,
  selectedIds: ReadonlySet<string>,
  cursor: WalkCursor | null,
): WalkStop | null {
  const count = order.length;
  if (count === 0) return null;
  const held = order.flatMap((stop, i) => (stop.pieces.some((piece) => selectedIds.has(piece.id)) ? [i] : []));
  if (held.length > 0) {
    const from = step > 0 ? Math.max(...held) : Math.min(...held);
    return order[(from + step + count) % count] ?? null;
  }
  const resumed = cursor === null ? null : resume(order, step, cursor);
  return resumed ?? (step > 0 ? order[0] : order[count - 1]) ?? null;
}

function seatWords(seats: number): string {
  return seats === 1 ? "1 seat" : `${String(seats)} seats`;
}

/** A stop aloud: "Table 4, Round of 10, 10 seats", "Dance floor, 4.6 m square", "Lectern". */
export function stopWords(stop: WalkStop): string {
  const head = stop.pieces.find((piece) => piece.id === stop.pieceId);
  const item = head === undefined ? undefined : getCatalogueItem(head.catalogueItemId);
  const label = (head?.label ?? "").trim();
  const name = item?.name ?? "Piece";
  if (stop.kind === TABLE_KIND) {
    const seats = stop.pieces.filter(isChair).length;
    const tables = stop.pieces.filter(isDiningTable);
    const trestles = tables.every((table) => (getCatalogueItem(table.catalogueItemId)?.slug ?? "").startsWith("trestle"));
    const what = item?.tableShape === "round" && seats > 0
      ? `Round of ${String(seats)}`
      : tables.length > 1 ? `${String(tables.length)} ${trestles ? "trestles" : "tables"}` : name;
    return [label, what, seatWords(seats)].filter((part) => part !== "").join(", ");
  }
  if (item?.slug === DANCE_FLOOR_PANEL_SLUG) {
    const grid = danceFloorGrid(stop.pieces);
    if (grid !== null) return `Dance floor, ${describeCard({ card: "dance-floor", cols: grid.cols, rows: grid.rows }).size}`;
  }
  const more = stop.pieces.length > 1 ? `${String(stop.pieces.length)} pieces` : "";
  return [label === name ? "" : label, name, more].filter((part) => part !== "").join(", ");
}
