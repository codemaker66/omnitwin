import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { createGhostWorld, judgeGhost, obstacleAt, refusalChip, type GhostObstacle, type GhostWorld } from "./ghost-truth.js";
import { footprintBounds, wholeSelection } from "./placement-edit.js";
import { generatePlacedId, type PlacedItem } from "./placement.js";
import {
  cardMainItem,
  cardMainSlug,
  cardParamsFor,
  stampSetup,
  trestleRange,
  type CardParams,
  type TableColourway,
} from "./setup-cards.js";
import { rearrangeTableGroup } from "./table-group.js";

// ---------------------------------------------------------------------------
// Replace (card-dock spec §8.2, Q-16): a card dropped on a selection, or the
// caption's Replace…, as one plan whose preview is its result:
//
//   a table → a table      in place, same turn; its chairs re-ringed; its
//                          id kept, so its cloth and note stay with it
//   tables → Long table    one run per row, along the selection's longer
//                          axis, as long as the row in whole trestles
//                          (rounded down); the most common cloth; each old
//                          table's note to the nearest new table, prefixed
//                          with its old name
//   tables → Round of N    a round at each table's centre, in place
//   chairs → a chair       the model swapped in place
//   anything else          one of the card at the selection's centre
//
// Refused, with the reason, when the result would overlap anything not
// being replaced, or itself. The caller commits it as one undo step.
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
  readonly newId?: () => string;
  /** Whether a placed piece carries a note (the editor's), so notes are named only when there are any. */
  readonly hasNote?: (id: string) => boolean;
}

interface Unit {
  readonly pieces: readonly PlacedItem[];
  /** The unit's dining table, when it has one. */
  readonly table: PlacedItem | null;
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

function unitsOf(selection: readonly PlacedItem[]): readonly Unit[] {
  const byKey = new Map<string, PlacedItem[]>();
  for (const piece of selection) {
    const key = piece.setId ?? piece.groupId ?? piece.id;
    const unit = byKey.get(key);
    if (unit === undefined) byKey.set(key, [piece]);
    else unit.push(piece);
  }
  return [...byKey.values()].map((pieces) => ({ pieces, table: pieces.find(isTable) ?? null }));
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

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** How a sentence names a group of units: "4 rounds", "2 long tables", "10 chairs", "3 pieces". */
function nameUnits(units: readonly Unit[], card?: CardParams): string {
  if (card?.card === "long-table") return plural(units.length, "long table", "long tables");
  if (units.length > 0 && units.every((unit) => unit.table !== null && itemOf(unit.table)?.tableShape === "round")) {
    return plural(units.length, "round", "rounds");
  }
  if (units.length > 0 && units.every((unit) => unit.table !== null)) return plural(units.length, "table", "tables");
  const pieces = units.flatMap((unit) => unit.pieces);
  if (pieces.length > 0 && pieces.every(isChair)) return plural(pieces.length, "chair", "chairs");
  return plural(units.length, "piece", "pieces");
}

function seats(pieces: readonly PlacedItem[]): number {
  return pieces.filter(isChair).length;
}

/** A table group set again round a different (or re-clothed) table, in place: its id and chairs kept, re-ringed. */
function swapTable(unit: Unit, tableSlug: string, seatCount: number | null, world: GhostWorld): readonly PlacedItem[] {
  const table = unit.table;
  const item = getCatalogueItem(tableSlug);
  if (table === null || item === undefined) return unit.pieces;
  const swapped: PlacedItem = { ...table, catalogueItemId: item.id };
  const chairs = unit.pieces.filter((piece) => piece !== table && isChair(piece));
  const ownIds = new Set(unit.pieces.map((piece) => piece.id));
  const others = world.placedItems.filter((piece) => !ownIds.has(piece.id));
  const otherIds = new Set(others.map((piece) => piece.id));
  const reseated = rearrangeTableGroup(swapped.id, seatCount ?? chairs.length, [...others, swapped, ...chairs]);
  return reseated.filter((piece) => !otherIds.has(piece.id));
}

/** Tables in rows across the selection's long axis: each row's tables within one trestle's length of the first. */
function rows(tables: readonly PlacedItem[], alongX: boolean, tolerance: number): readonly (readonly PlacedItem[])[] {
  const across = (piece: PlacedItem): number => (alongX ? piece.z : piece.x);
  const sorted = [...tables].sort((a, b) => across(a) - across(b));
  const grouped: PlacedItem[][] = [];
  for (const table of sorted) {
    const last = grouped[grouped.length - 1];
    const first = last?.[0];
    if (last === undefined || first === undefined || across(table) - across(first) > tolerance) grouped.push([table]);
    else last.push(table);
  }
  return grouped;
}

/** Tables to long tables: one run per row, the row's length in whole trestles, the most common cloth. */
function longTablesFor(units: readonly Unit[], newId: () => string): { readonly add: readonly PlacedItem[]; readonly runs: number } | null {
  const tables = units.flatMap((unit) => (unit.table === null ? [] : [unit.table]));
  const bounds = footprintBounds(units.flatMap((unit) => unit.pieces));
  if (tables.length === 0 || bounds === null) return null;
  const alongX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  const colourway = mostCommonColourway(tables);
  const trestle = cardMainItem({ card: "long-table", trestles: 1, colourway });
  if (trestle === undefined) return null;
  const range = trestleRange("long-table");
  const add: PlacedItem[] = [];
  let runs = 0;
  for (const row of rows(tables, alongX, trestle.width)) {
    const rowUnits = units.filter((unit) => unit.table !== null && row.includes(unit.table));
    const rowBounds = footprintBounds(rowUnits.flatMap((unit) => unit.pieces));
    if (rowBounds === null) continue;
    const length = alongX ? rowBounds.maxX - rowBounds.minX : rowBounds.maxZ - rowBounds.minZ;
    const trestles = Math.max(range.min, Math.min(range.max, Math.floor(length / trestle.width + 1e-9)));
    const params = cardParamsFor("long-table", { trestles, colourway });
    if (params === null) continue;
    const middle = alongX ? (rowBounds.minX + rowBounds.maxX) / 2 : (rowBounds.minZ + rowBounds.maxZ) / 2;
    const line = row.reduce((sum, table) => sum + (alongX ? table.z : table.x), 0) / row.length;
    const origin = alongX ? { x: middle, z: line } : { x: line, z: middle };
    add.push(...stampSetup(params, origin, alongX ? 0 : Math.PI / 2, newId));
    runs += 1;
  }
  return { add, runs };
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
 * with its reason when the result would overlap anything not replaced.
 */
export function planReplace(selectedIds: ReadonlySet<string>, card: CardParams, world: GhostWorld, options: ReplaceOptions = {}): ReplaceResult {
  const newId = options.newId ?? generatePlacedId;
  const hasNote = options.hasNote ?? (() => false);
  const selection = wholeSelection(selectedIds, world.placedItems);
  const cardItem = cardMainItem(card);
  if (selection.length === 0 || cardItem === undefined) return refused(null);
  const units = unitsOf(selection);
  const allTables = units.every((unit) => unit.table !== null);

  let removeIds = new Set<string>();
  let add: readonly PlacedItem[] = [];
  let newUnits: readonly Unit[] = [];
  let clothKept = false;
  let notes: readonly ReplaceNote[] = [];

  if (selection.every(isChair) && cardItem.category === "chair") {
    add = selection.map((chair) => ({ ...chair, catalogueItemId: cardItem.id }));
    newUnits = unitsOf(add);
  } else if (allTables && card.card === "long-table") {
    const runs = longTablesFor(units, newId);
    if (runs === null) return refused(null);
    removeIds = new Set(selection.map((piece) => piece.id));
    add = runs.add;
    newUnits = Array.from({ length: runs.runs }, () => ({ pieces: [], table: null }));
    clothKept = true;
    notes = notesToNearest(selection, add, hasNote);
  } else if (allTables && (card.card === "round" || (card.card === "piece" && isDiningTableItem(cardItem)))) {
    add = units.flatMap((unit) => {
      const table = unit.table;
      // A round keeps each table's cloth (rounds come white, black or bare); a chosen piece is the cloth asked for.
      const cloth = table === null ? "white" : colourwayOf(table);
      const slug = card.card === "round" ? cardMainSlug({ ...card, colourway: cloth === "wood" ? "bare" : cloth }) : cardMainSlug(card);
      return swapTable(unit, slug, card.card === "round" ? card.seats : null, world);
    });
    const kept = new Set(add.map((piece) => piece.id));
    removeIds = new Set(selection.filter((piece) => !kept.has(piece.id)).map((piece) => piece.id));
    newUnits = unitsOf(add);
    clothKept = card.card === "round";
  } else {
    const bounds = footprintBounds(selection);
    if (bounds === null) return refused(null);
    removeIds = new Set(selection.map((piece) => piece.id));
    add = stampSetup(card, { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }, 0, newId);
    newUnits = unitsOf(add);
  }

  // Judged against everything that stays, the other new pieces included.
  const selectionIds = new Set(selection.map((piece) => piece.id));
  const after = createGhostWorld([...world.placedItems.filter((piece) => !selectionIds.has(piece.id)), ...add], world.room);
  for (const unit of unitsOf(add)) {
    const own = new Set(unit.pieces.map((piece) => piece.id));
    if (judgeGhost(unit.pieces, after, { excludeIds: own }).state !== "fits") return refused(obstacleAt(unit.pieces, after, own));
  }

  const before = nameUnits(units);
  const afterName = nameUnits(newUnits, card);
  const seatsBefore = seats(selection);
  const seatsAfter = seats(add);
  const parts = [`Replace ${before} with ${afterName}`, `${String(seatsBefore)} seats become ${String(seatsAfter)}`];
  if (clothKept) parts.push("cloth kept");
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
