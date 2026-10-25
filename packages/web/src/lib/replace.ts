import { seatBaseSlug } from "@omnitwin/types";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { createGhostWorld, judgeGhost, obstacleAt, refusalChip, type GhostObstacle, type GhostWorld } from "./ghost-truth.js";
import { footprintBounds, selectionUnits, wholeSelection } from "./placement-edit.js";
import { generatePlacedId, settleMovedOnSurfaces, type PlacedItem } from "./placement.js";
import {
  cardMainItem,
  cardParamsFor,
  stampSetup,
  trestleRange,
  type CardParams,
  type RoundCardParams,
  type TableColourway,
} from "./setup-cards.js";
import { rearrangeTableGroup } from "./table-group.js";

// ---------------------------------------------------------------------------
// Replace (card-dock spec §8.2, Q-16): a card dropped on a selection, or the
// caption's Replace…, as one plan whose preview is its result. A table group
// is a table and its chairs; a set (a Top or Long table's trestles) is one
// table of several trestles.
//
//   a table → a table      of another colourway or the same footprint: in
//                          place, same turn, each table's chairs kept and
//                          re-ringed; ids kept, so cloth and note stay (a
//                          set re-clothes every trestle)
//   tables → Long table    one run per row, along the selection's longer
//                          axis, as long as the row in whole trestles
//                          (rounded down, but never below a set's two: the
//                          spec leaves a shorter row open, and the overlap
//                          judge refuses a run that will not fit); the most
//                          common cloth; each old table's note to the
//                          nearest new table, prefixed with its old name
//   tables → Round of N    a round at each table's centre: a round in place,
//                          re-ringed; any other table (a set counts as one)
//                          becomes a round there in its cloth, keeping its
//                          first table's id, name and note
//   chairs → a chair       the model swapped in place
//   anything else          one of the card at the selection's centre
//
// Refused, with the reason, when the result would take a piece past the
// store's stock (options.store, Blake's B2), or overlap anything not being
// replaced, or itself. The caller commits it as one undo step.
// ---------------------------------------------------------------------------

export interface ReplaceNote {
  /** The table whose note moves. */
  readonly fromId: string;
  /** The table it moves to. */
  readonly toId: string;
  /** Written before the note, so it still says whose it was: "Table 3: ". */
  readonly prefix: string;
}

export interface ReplacePlan {
  /** Placed pieces that go. */
  readonly removeIds: ReadonlySet<string>;
  /** Pieces that come, or change in place (keeping their ids). */
  readonly add: readonly PlacedItem[];
  readonly seatsBefore: number;
  readonly seatsAfter: number;
  /** The consequence chip: "Replace 4 rounds with 2 long tables · 40 seats become 48 · cloth kept · notes move to the new tables". */
  readonly sentence: string;
  /** The receipt: "Replaced 4 rounds with 2 long tables". */
  readonly receipt: string;
  readonly notes: readonly ReplaceNote[];
}

export type ReplaceResult =
  | { readonly ok: true; readonly plan: ReplacePlan }
  | { readonly ok: false; readonly obstacle: GhostObstacle | null; readonly reason: string };

export interface ReplaceOptions {
  /** Ids for every new piece, so the preview and the commit name them alike. */
  readonly newId?: () => string;
  /** Whether a placed piece carries a note (the editor's), so notes are named only when there are any. */
  readonly hasNote?: (id: string) => boolean;
  /**
   * The store's word on the change (lib/card-stock storeShortfall with its
   * words, for staff): why it would take a piece past stock, or null.
   */
  readonly store?: (change: { readonly removeIds: ReadonlySet<string>; readonly add: readonly PlacedItem[] }) => string | null;
}

interface Unit {
  readonly pieces: readonly PlacedItem[];
  /** Its dining tables: one for a table group, every trestle of a set. */
  readonly tables: readonly PlacedItem[];
}

function itemOf(piece: PlacedItem): CatalogueItem | undefined {
  return getCatalogueItem(piece.catalogueItemId);
}

function isChair(piece: PlacedItem): boolean {
  return itemOf(piece)?.category === "chair";
}

function isTable(piece: PlacedItem): boolean {
  const item = itemOf(piece);
  return item !== undefined && isDiningTableItem(item);
}

function unitsOf(pieces: readonly PlacedItem[]): readonly Unit[] {
  return selectionUnits(pieces).map((unit) => ({ pieces: unit, tables: unit.filter(isTable) }));
}

/** Where a unit stands: the middle of its tables. */
function unitCentre(unit: Unit): { readonly x: number; readonly z: number } {
  const count = Math.max(1, unit.tables.length);
  return {
    x: unit.tables.reduce((sum, table) => sum + table.x, 0) / count,
    z: unit.tables.reduce((sum, table) => sum + table.z, 0) / count,
  };
}

/** A table's cloth, read from its catalogue variant. */
function colourwayOf(piece: PlacedItem): TableColourway {
  const slug = itemOf(piece)?.slug ?? "";
  if (slug.endsWith("-white")) return "white";
  if (slug.endsWith("-black")) return "black";
  if (slug.endsWith("-wooden")) return "wood";
  return "bare";
}

/** The cloth most of these tables wear (the first seen, on a tie). */
function mostCommonColourway(tables: readonly PlacedItem[]): TableColourway {
  const counts = new Map<TableColourway, number>();
  for (const table of tables) counts.set(colourwayOf(table), (counts.get(colourwayOf(table)) ?? 0) + 1);
  let best: TableColourway = "white";
  let most = 0;
  for (const [colourway, count] of counts) {
    if (count > most) {
      best = colourway;
      most = count;
    }
  }
  return best;
}

function oneCloth(tables: readonly PlacedItem[]): boolean {
  return new Set(tables.map(colourwayOf)).size <= 1;
}

const CLOTH_WORDS: Readonly<Record<TableColourway, string>> = {
  white: "white cloths",
  black: "black cloths",
  wood: "wooden tops",
  bare: "no cloths",
};

/** A round's cloth for a table's: rounds come white, black or bare. */
function roundCloth(colourway: TableColourway): TableColourway {
  return colourway === "wood" ? "bare" : colourway;
}

/** Whether a table can become this one in place: the same table in another cloth, or one of the same footprint. */
function swapsInPlace(table: PlacedItem, into: CatalogueItem): boolean {
  const item = itemOf(table);
  if (item === undefined) return false;
  if (seatBaseSlug(item.slug) === seatBaseSlug(into.slug)) return true;
  return item.tableShape === into.tableShape && Math.abs(item.width - into.width) < 0.01 && Math.abs(item.depth - into.depth) < 0.01;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** How a sentence names a group of units: "4 rounds", "2 long tables", "10 chairs", "3 pieces". */
function nameUnits(units: readonly Unit[], card?: CardParams): string {
  if (card?.card === "long-table") return plural(units.length, "long table", "long tables");
  if (units.length > 0 && units.every((unit) => unit.tables.length === 1 && unit.tables.every((table) => itemOf(table)?.tableShape === "round"))) {
    return plural(units.length, "round", "rounds");
  }
  if (units.length > 0 && units.every((unit) => unit.tables.length > 0)) return plural(units.length, "table", "tables");
  const pieces = units.flatMap((unit) => unit.pieces);
  if (pieces.length > 0 && pieces.every(isChair)) return plural(pieces.length, "chair", "chairs");
  return plural(units.length, "piece", "pieces");
}

function seats(pieces: readonly PlacedItem[]): number {
  return pieces.filter(isChair).length;
}

/**
 * A unit's tables made into another table in place, each keeping its id, its
 * turn and its own chairs, re-ringed (to `seatCount` when given, else as many
 * as it had); new chairs take ids from `newId`.
 */
function swapTables(unit: Unit, into: CatalogueItem, seatCount: number | null, newId: () => string): readonly PlacedItem[] {
  let pieces: readonly PlacedItem[] = unit.pieces;
  for (const table of unit.tables) {
    const chairs = pieces.filter((piece) => piece.groupId === table.groupId && piece.id !== table.id && isChair(piece)).length;
    pieces = pieces.map((piece) => (piece.id === table.id ? { ...piece, catalogueItemId: into.id } : piece));
    pieces = rearrangeTableGroup(table.id, seatCount ?? chairs, pieces, newId);
  }
  return pieces;
}

/**
 * A unit as a round at its centre, in its cloth, keeping its first table's
 * id and name (so that table's note stays); its other tables' notes move.
 */
function roundAt(unit: Unit, card: RoundCardParams, newId: () => string, hasNote: (id: string) => boolean): { readonly add: readonly PlacedItem[]; readonly notes: readonly ReplaceNote[] } {
  const [first, ...rest] = unit.tables;
  const stamped = stampSetup({ ...card, colourway: roundCloth(mostCommonColourway(unit.tables)) }, unitCentre(unit), 0, newId);
  const add = first === undefined
    ? stamped
    : stamped.map((piece) => (isTable(piece) ? { ...piece, id: first.id, ...(first.label === undefined ? {} : { label: first.label }) } : piece));
  return { add, notes: notesToNearest(rest, add, hasNote) };
}

/** Tables in rows across the selection's long axis: each row's units within one trestle's length of the first. */
function rows(units: readonly Unit[], alongX: boolean, tolerance: number): readonly (readonly Unit[])[] {
  const across = (unit: Unit): number => (alongX ? unitCentre(unit).z : unitCentre(unit).x);
  const sorted = [...units].sort((a, b) => across(a) - across(b));
  const grouped: Unit[][] = [];
  for (const unit of sorted) {
    const last = grouped[grouped.length - 1];
    const first = last?.[0];
    if (last === undefined || first === undefined || across(unit) - across(first) > tolerance) grouped.push([unit]);
    else last.push(unit);
  }
  return grouped;
}

/** Tables to long tables: one run per row, the row's length in whole trestles, the most common cloth. */
function longTablesFor(units: readonly Unit[], newId: () => string): { readonly add: readonly PlacedItem[]; readonly runs: number; readonly colourway: TableColourway } | null {
  const tables = units.flatMap((unit) => unit.tables);
  const bounds = footprintBounds(units.flatMap((unit) => unit.pieces));
  if (tables.length === 0 || bounds === null) return null;
  const alongX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  const colourway = mostCommonColourway(tables);
  const trestle = cardMainItem({ card: "long-table", trestles: 1, colourway });
  if (trestle === undefined) return null;
  const range = trestleRange("long-table");
  const add: PlacedItem[] = [];
  let runs = 0;
  for (const row of rows(units, alongX, trestle.width)) {
    const rowBounds = footprintBounds(row.flatMap((unit) => unit.pieces));
    if (rowBounds === null) continue;
    const length = alongX ? rowBounds.maxX - rowBounds.minX : rowBounds.maxZ - rowBounds.minZ;
    const trestles = Math.max(range.min, Math.min(range.max, Math.floor(length / trestle.width + 1e-9)));
    const params = cardParamsFor("long-table", { trestles, colourway });
    if (params === null) continue;
    const middle = alongX ? (rowBounds.minX + rowBounds.maxX) / 2 : (rowBounds.minZ + rowBounds.maxZ) / 2;
    const line = row.reduce((sum, unit) => sum + (alongX ? unitCentre(unit).z : unitCentre(unit).x), 0) / row.length;
    const origin = alongX ? { x: middle, z: line } : { x: line, z: middle };
    add.push(...stampSetup(params, origin, alongX ? 0 : Math.PI / 2, newId));
    runs += 1;
  }
  return { add, runs, colourway };
}

/** What a removed table was called, for its moved note's prefix. */
function oldName(table: PlacedItem): string {
  const label = table.label?.trim() ?? "";
  if (label !== "") return label;
  const item = itemOf(table);
  return item?.tableShape === "round" ? "Round" : item?.name ?? "Table";
}

/** Each removed table's note to the nearest new table, prefixed with its old name. */
function notesToNearest(removed: readonly PlacedItem[], added: readonly PlacedItem[], hasNote: (id: string) => boolean): readonly ReplaceNote[] {
  const targets = added.filter(isTable);
  return removed.filter((table) => isTable(table) && hasNote(table.id)).flatMap((table) => {
    let nearest: PlacedItem | undefined;
    for (const target of targets) {
      if (target.id === table.id) continue;
      if (nearest === undefined || Math.hypot(target.x - table.x, target.z - table.z) < Math.hypot(nearest.x - table.x, nearest.z - table.z)) nearest = target;
    }
    return nearest === undefined ? [] : [{ fromId: table.id, toId: nearest.id, prefix: `${oldName(table)}: ` }];
  });
}

function refused(obstacle: GhostObstacle | null): ReplaceResult {
  return { ok: false, obstacle, reason: refusalChip(obstacle) };
}

/**
 * The replacement of the selection (made whole) by this card, or a refusal
 * with its reason when the store cannot cover it or the result would overlap
 * anything not replaced.
 */
export function planReplace(selectedIds: ReadonlySet<string>, card: CardParams, world: GhostWorld, options: ReplaceOptions = {}): ReplaceResult {
  const newId = options.newId ?? generatePlacedId;
  const hasNote = options.hasNote ?? (() => false);
  const selection = wholeSelection(selectedIds, world.placedItems);
  const cardItem = cardMainItem(card);
  if (selection.length === 0 || cardItem === undefined) return refused(null);
  const units = unitsOf(selection);
  const sourceTables = units.flatMap((unit) => unit.tables);
  const allTables = units.every((unit) => unit.tables.length > 0);

  let add: readonly PlacedItem[];
  let newUnits: readonly Unit[] | null = null;
  let cloth: string | null = null;
  let notes: readonly ReplaceNote[] = [];

  if (selection.every(isChair) && cardItem.category === "chair") {
    add = selection.map((chair) => ({ ...chair, catalogueItemId: cardItem.id }));
  } else if (allTables && card.card === "long-table") {
    const runs = longTablesFor(units, newId);
    if (runs === null) return refused(null);
    add = runs.add;
    newUnits = Array.from({ length: runs.runs }, () => ({ pieces: [], tables: [] }));
    cloth = oneCloth(sourceTables) ? "cloth kept" : `${CLOTH_WORDS[runs.colourway]}, the most common`;
    notes = notesToNearest(sourceTables, add, hasNote);
  } else if (allTables && card.card === "round") {
    const roundCard = card;
    const made = units.map((unit) => {
      const [only] = unit.tables;
      const round = cardMainItem({ ...roundCard, colourway: roundCloth(mostCommonColourway(unit.tables)) });
      return unit.tables.length === 1 && only !== undefined && round !== undefined && swapsInPlace(only, round)
        ? { add: swapTables(unit, round, roundCard.seats, newId), notes: [] }
        : roundAt(unit, roundCard, newId, hasNote);
    });
    add = made.flatMap((each) => each.add);
    notes = made.flatMap((each) => each.notes);
    cloth = units.every((unit) => oneCloth(unit.tables)) ? "cloth kept" : null;
  } else if (allTables && card.card === "piece" && isDiningTableItem(cardItem) && sourceTables.every((table) => swapsInPlace(table, cardItem))) {
    add = units.flatMap((unit) => swapTables(unit, cardItem, null, newId));
  } else {
    const bounds = footprintBounds(selection);
    if (bounds === null) return refused(null);
    add = stampSetup(card, { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }, 0, newId);
  }
  const kept = new Set(add.map((piece) => piece.id));
  const removeIds = new Set(selection.filter((piece) => !kept.has(piece.id)).map((piece) => piece.id));
  const selectionIds = new Set(selection.map((piece) => piece.id));
  const stays = world.placedItems.filter((piece) => !selectionIds.has(piece.id));
  // Each new piece stands on what stays under it (a dance floor, a stage): judged, and set down, at that height.
  add = settleMovedOnSurfaces(add, stays);

  // The store first (B2, hard), then the floor: judged against everything that stays, the other new pieces included.
  const shortfall = options.store?.({ removeIds, add }) ?? null;
  if (shortfall !== null) return { ok: false, obstacle: null, reason: shortfall };
  const after = createGhostWorld([...stays, ...add], world.room);
  for (const unit of selectionUnits(add)) {
    const own = new Set(unit.map((piece) => piece.id));
    if (judgeGhost(unit, after, { excludeIds: own }).state !== "fits") return refused(obstacleAt(unit, after, own));
  }

  const before = nameUnits(units);
  const afterName = nameUnits(newUnits ?? unitsOf(add), card);
  const seatsBefore = seats(selection);
  const seatsAfter = seats(add);
  const parts = [`Replace ${before} with ${afterName}`, `${String(seatsBefore)} seats become ${String(seatsAfter)}`];
  if (cloth !== null) parts.push(cloth);
  if (notes.length > 0) parts.push("notes move to the new tables");
  return {
    ok: true,
    plan: {
      removeIds,
      add,
      seatsBefore,
      seatsAfter,
      sentence: parts.join(" · "),
      receipt: `Replaced ${before} with ${afterName}`,
      notes,
    },
  };
}
