import { toRealWorld } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { countLabel } from "./count-label.js";
import type { PlacedItem } from "./placement.js";
import { referenceCategoryLabel, type ReferenceSceneEntry, type ReferenceSceneSummary } from "./reference-scene-model.js";
import { sceneFurniturePlacements } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// The names v1's "On the floor" list and its inspector give each piece.
//
// A piece the planner has named (metadata.displayLabel, "Table 7") keeps that
// name. Every other piece is numbered within its kind ("Table 3", "Chair 12")
// in reading order across the floor: front to back in 1 m bands, then left to
// right. That order is a fact of the floor, so a save (which re-mints local
// ids as server ids) and a reload (whose row order is not guaranteed) give
// the same numbers. Never by id, never zero-padded, and never a number an
// authored name of the same kind already uses.
//
// Numbers are taken when the set of pieces changes (one added, removed,
// renamed or regrouped, or re-identified by a save) and kept while pieces
// only move, so "Table 3" does not change hands in the middle of a drag, and
// the list and the inspector always agree.
// ---------------------------------------------------------------------------

export interface FloorName {
  /** The full name: "Table 3 · Round Table (6ft)", or the authored name. */
  readonly label: string;
  /** The row's name: "Table 3", or the authored name. */
  readonly shortLabel: string;
}

const ROW_BAND_M = 1;
const CACHE_LIMIT = 4;

function kindName(category: string, catalogueName: string | undefined): string {
  if (category === "table") return "Table";
  if (category === "chair") return "Chair";
  return catalogueName ?? "Piece";
}

function structuralKey(items: readonly PlacedItem[]): string {
  return items.map((item) => `${item.id}\u0001${item.catalogueItemId}\u0001${item.label ?? ""}\u0001${item.groupId ?? ""}`).join("\u0002");
}

interface Piece {
  readonly item: PlacedItem;
  readonly index: number;
  readonly catalogueName: string | undefined;
  readonly authored: string;
  readonly band: number;
  readonly kind: string;
}

function computeFloorNames(items: readonly PlacedItem[]): ReadonlyMap<string, FloorName> {
  const pieces: readonly Piece[] = sceneFurniturePlacements(items).map((item, index) => {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    return {
      item,
      index,
      catalogueName: catalogue?.name,
      authored: item.label?.trim() ?? "",
      band: Math.round(toRealWorld(item.z) / ROW_BAND_M),
      kind: kindName(catalogue?.category ?? "other", catalogue?.name),
    };
  });
  const names = new Map<string, FloorName>();
  const byKind = new Map<string, Piece[]>();
  for (const piece of pieces) {
    if (piece.authored.length > 0) {
      names.set(piece.item.id, { label: piece.authored, shortLabel: piece.authored });
      continue;
    }
    const unnamed = byKind.get(piece.kind);
    if (unnamed === undefined) byKind.set(piece.kind, [piece]);
    else unnamed.push(piece);
  }
  for (const [kind, unnamed] of byKind) {
    const prefix = `${kind.toLocaleLowerCase("en-GB")} `;
    const taken = new Set<number>();
    for (const piece of pieces) {
      const authored = piece.authored.toLocaleLowerCase("en-GB");
      const digits = authored.startsWith(prefix) ? authored.slice(prefix.length).trim() : "";
      if (/^\d+$/u.test(digits)) taken.add(Number(digits));
    }
    const ordered = [...unnamed].sort((a, b) => a.band - b.band
      || a.item.x - b.item.x
      || a.item.catalogueItemId.localeCompare(b.item.catalogueItemId)
      || a.index - b.index);
    let next = 1;
    for (const piece of ordered) {
      while (taken.has(next)) next += 1;
      const shortLabel = `${kind} ${String(next)}`;
      next += 1;
      const detail = piece.catalogueName !== undefined && piece.catalogueName !== kind ? ` · ${piece.catalogueName}` : "";
      names.set(piece.item.id, { label: `${shortLabel}${detail}`, shortLabel });
    }
  }
  return names;
}

const cache = new Map<string, ReadonlyMap<string, FloorName>>();

/** The name of every piece on the floor, keyed by id (see the header). */
export function floorNames(items: readonly PlacedItem[]): ReadonlyMap<string, FloorName> {
  const key = structuralKey(items);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const names = computeFloorNames(items);
  cache.set(key, names);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return names;
}

/** The list's entries under their floor names. */
export function withFloorNames(
  entries: readonly ReferenceSceneEntry[],
  names: ReadonlyMap<string, FloorName>,
): readonly ReferenceSceneEntry[] {
  return entries.map((entry) => {
    const name = names.get(entry.item.id);
    return name === undefined ? entry : { ...entry, label: name.label, shortLabel: name.shortLabel };
  });
}

/** Rows in name order, numbers counted as numbers ("Table 2" before "Table 10"). */
export function inFloorNameOrder(entries: readonly ReferenceSceneEntry[]): readonly ReferenceSceneEntry[] {
  return [...entries].sort((a, b) => a.shortLabel.localeCompare(b.shortLabel, "en-GB", { numeric: true, sensitivity: "base" }));
}

/** "1 table · 10 chairs"; staff also see "· 1 group". Clients never see groups. */
export function floorSummaryLine(summary: ReferenceSceneSummary, staff: boolean): string {
  const line = `${countLabel(summary.tables, "table")} · ${countLabel(summary.chairs, "chair")}`;
  return staff && summary.groups > 0 ? `${line} · ${countLabel(summary.groups, "group")}` : line;
}

/** A kind's heading in the list, in the venue's words. */
export function floorCategoryLabel(category: string): string {
  const label = referenceCategoryLabel(category);
  return label === "Other objects" ? "Other pieces" : label;
}
