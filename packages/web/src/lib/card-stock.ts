import { listVenueInventory, type VenueInventoryData } from "../api/venue-inventory.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import { stampSetup, type CardParams } from "./setup-cards.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// Store figures on the cards, for staff (card-dock spec §17.1, Q-14).
//
// The figure comes from the existing staff route, GET /venues/:venueId/inventory
// (authenticated, inventory-read only), so there is no new endpoint and no
// figure ever reaches a client or a guest. Usable stock is the domain's own
// rule (venue-inventory-availability: owned − damaged − unavailable, nothing
// when retired), without hires until an event window is known (Q-28). A
// card's figure is how many more of it the store allows beyond what this
// layout already holds: the fewest whole cards any of its pieces allows (a
// Round of 10 needs a round and ten chairs; Top table and Long table share
// the trestles). A piece with no stock record gives no figure at all.
//
// The store counts tables, not cloths: a round in a white cloth is one of the
// hall's 6 ft rounds, so every count here is by stock identity (stockIdentity).
//
// Blake's B2 (25 Oct 2026): stock is a hard limit. Wherever a piece has a
// record, nothing may take the layout past it: a card set down (storeRefuses),
// and every other change that adds pieces (storeShortfall: Replace,
// Duplicate, Paste, a table's chairs stepped up). Unknown stock never refuses.
// ---------------------------------------------------------------------------

/** Usable stock by stock identity (a catalogue id): only pieces the store has a record for. */
export type UsableStock = ReadonlyMap<string, number>;

/**
 * Pieces the store counts under another catalogue entry. Clothed tables count
 * as their bare table: a cloth is dressing, not a table. The Burgess Turini
 * 18/3 the planner sets counts as the venue's pink chair, the same chair
 * (Blake, 26 Oct 2026), whose record the stock import writes. Nothing else is
 * pooled. A wooden-top trestle is not assumed to be a 6 ft trestle, because a
 * guessed pooled count is what the stock import refuses to make
 * (api/src/scripts/import-venue-stock.ts).
 */
const COUNTED_AS: ReadonlyMap<string, string> = new Map([
  ["round-table-6ft-white", "round-table-6ft"],
  ["round-table-6ft-black", "round-table-6ft"],
  ["trestle-6ft-white", "trestle-6ft"],
  ["trestle-6ft-black", "trestle-6ft"],
  ["trestle-4ft-white", "trestle-4ft"],
  ["trestle-4ft-black", "trestle-4ft"],
  ["burgess-turini-18-3", "pink-chair"],
]);

/** The catalogue id the store counts a piece under: a clothed table's bare table, the Turini's pink chair, else the piece itself. */
export function stockIdentity(catalogueItemId: string): string {
  const slug = getCatalogueItem(catalogueItemId)?.slug;
  const countedAs = slug === undefined ? undefined : COUNTED_AS.get(slug);
  return (countedAs === undefined ? undefined : getCatalogueItemBySlug(countedAs)?.id) ?? catalogueItemId;
}

/**
 * Usable stock from the staff inventory list, by stock identity. A bare
 * table's own record is its count; with none, the largest record among its
 * clothed variants stands for it (records of the same tables under two
 * names are never added together, which could invent tables).
 */
export function usableStock(inventory: VenueInventoryData): UsableStock {
  const own = new Map<string, number>();
  for (const { catalogue, stock } of inventory.items) {
    if (stock === null) continue;
    own.set(catalogue.id, stock.status === "retired"
      ? 0
      : Math.max(0, stock.ownedQuantity - stock.damagedQuantity - stock.unavailableQuantity));
  }
  const usable = new Map<string, number>();
  for (const [assetId, count] of own) {
    const identity = stockIdentity(assetId);
    if (identity === assetId) usable.set(identity, count);
    else if (!own.has(identity)) usable.set(identity, Math.max(usable.get(identity) ?? 0, count));
  }
  return usable;
}

/** The staff route's usable stock for a venue. Call it for staff only: the route refuses everyone else. */
export async function loadUsableStock(venueId: string, signal?: AbortSignal): Promise<UsableStock> {
  return usableStock(await listVenueInventory(venueId, signal));
}

/** How many of each stock identity a layout holds. */
export function placedCounts(placedItems: readonly PlacedItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const placed of placedItems) {
    if (!isSceneFurniturePlacement(placed)) continue;
    const identity = stockIdentity(placed.catalogueItemId);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

/** The stock one of this card takes, by stock identity. */
export function cardNeeds(params: CardParams): ReadonlyMap<string, number> {
  let next = 0;
  const pieces = stampSetup(params, { x: 0, z: 0 }, 0, () => {
    next += 1;
    return `need-${String(next)}`;
  });
  return placedCounts(pieces);
}

/** Whole cards a piece's stock still allows: what is left over what one card takes. */
function wholeCardsLeft(usable: number, placed: number, need: number): number {
  return Math.floor(Math.max(0, usable - placed) / need);
}

/**
 * How many more of this card the store allows beyond what the layout holds:
 * the fewest whole cards any of its pieces allows, never below 0. Null when
 * a piece it needs has no stock record (no record, no figure).
 */
export function cardStoreFigure(params: CardParams, stock: UsableStock, placed: ReadonlyMap<string, number>): number | null {
  const needs = cardNeeds(params);
  if (needs.size === 0) return null;
  let whole = Number.POSITIVE_INFINITY;
  for (const [identity, need] of needs) {
    const usable = stock.get(identity);
    if (usable === undefined) return null;
    whole = Math.min(whole, wholeCardsLeft(usable, placed.get(identity) ?? 0, need));
  }
  return whole;
}

/**
 * Blake's B2, hard: whether setting this card down would take any piece with
 * a stock record past it. A piece with no record cannot refuse, but it does
 * not lift the limit on the pieces that have one. Unknown stock never refuses.
 */
export function storeRefuses(params: CardParams, stock: UsableStock | null, placed: ReadonlyMap<string, number>): boolean {
  if (stock === null) return false;
  for (const [identity, need] of cardNeeds(params)) {
    const usable = stock.get(identity);
    if (usable !== undefined && wholeCardsLeft(usable, placed.get(identity) ?? 0, need) < 1) return true;
  }
  return false;
}

/** A piece a change would take past its usable stock. */
export interface StoreShortfall {
  /** The stock identity (a catalogue id). */
  readonly catalogueItemId: string;
  readonly usable: number;
  /** How many the layout would then hold. */
  readonly needed: number;
}

/** What a change does to the layout: pieces that go, and pieces that come or change in place (keeping their ids). */
export interface LayoutChange {
  readonly removeIds?: ReadonlySet<string>;
  readonly add: readonly PlacedItem[];
}

/**
 * The first piece this change would take past its usable stock (B2, hard),
 * or null. For every change that adds pieces: Replace, Duplicate, Paste, a
 * table's chairs stepped up. Only a piece the change adds more of can refuse,
 * so a layout already over (stock recorded lower since it was laid out) stays
 * editable; a piece with no record never refuses, nor does unknown stock.
 */
export function storeShortfall(stock: UsableStock | null, placedItems: readonly PlacedItem[], change: LayoutChange): StoreShortfall | null {
  if (stock === null) return null;
  const changedIds = new Set(change.add.map((piece) => piece.id));
  const kept = placedItems.filter((piece) => change.removeIds?.has(piece.id) !== true && !changedIds.has(piece.id));
  return storeShortfallBetween(stock, placedItems, [...kept, ...change.add]);
}

/**
 * The first piece taking the layout from `before` to `after` would take past
 * its usable stock, or null: storeShortfall for a change given as the whole
 * layout after it (a store action's write).
 */
export function storeShortfallBetween(stock: UsableStock | null, before: readonly PlacedItem[], after: readonly PlacedItem[]): StoreShortfall | null {
  if (stock === null) return null;
  const was = placedCounts(before);
  for (const [identity, count] of placedCounts(after)) {
    const usable = stock.get(identity);
    if (usable !== undefined && count > usable && count > (was.get(identity) ?? 0)) {
      return { catalogueItemId: identity, usable, needed: count };
    }
  }
  return null;
}

let stockSource: () => UsableStock | null = () => null;

/**
 * Where every adding commit reads the store's stock (B2, hard): the cards
 * store registers its reading as it loads stock for staff (lane C), so the
 * placement store refuses any write past it, whichever control made it.
 * Unknown until a reading is registered, and unknown never refuses. Returns
 * the way to take the reading away again.
 */
export function registerStoreStock(read: () => UsableStock | null): () => void {
  stockSource = read;
  return () => {
    if (stockSource === read) stockSource = () => null;
  };
}

/** The store's usable stock as the planner knows it now, or null when unknown (a guest, or not yet loaded). */
export function currentStoreStock(): UsableStock | null {
  return stockSource();
}

/** The refusal's words, in the planner's name for the piece: "Velvet Banquet Chair: 40 in store, this needs 48". */
export function storeShortfallWords(shortfall: StoreShortfall): string {
  const name = getCatalogueItem(shortfall.catalogueItemId)?.name ?? "This piece";
  return `${name}: ${String(shortfall.usable)} in store, this needs ${String(shortfall.needed)}`;
}
