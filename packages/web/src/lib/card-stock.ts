import { listVenueInventory, type VenueInventoryData } from "../api/venue-inventory.js";
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
// Blake's B2 (25 Oct 2026): the figure is a hard limit, so none left refuses.
// ---------------------------------------------------------------------------

/** Usable stock by catalogue id: only pieces the store has a record for. */
export type UsableStock = ReadonlyMap<string, number>;

/** Usable stock from the staff inventory list. */
export function usableStock(inventory: VenueInventoryData): UsableStock {
  const usable = new Map<string, number>();
  for (const { catalogue, stock } of inventory.items) {
    if (stock === null) continue;
    usable.set(catalogue.id, stock.status === "retired"
      ? 0
      : Math.max(0, stock.ownedQuantity - stock.damagedQuantity - stock.unavailableQuantity));
  }
  return usable;
}

/** The staff route's usable stock for a venue. Call it for staff only: the route refuses everyone else. */
export async function loadUsableStock(venueId: string, signal?: AbortSignal): Promise<UsableStock> {
  return usableStock(await listVenueInventory(venueId, signal));
}

/** How many of each catalogue piece a layout holds. */
export function placedCounts(placedItems: readonly PlacedItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const placed of placedItems) {
    if (!isSceneFurniturePlacement(placed)) continue;
    counts.set(placed.catalogueItemId, (counts.get(placed.catalogueItemId) ?? 0) + 1);
  }
  return counts;
}

/** The catalogue pieces one of this card puts down, by count. */
export function cardNeeds(params: CardParams): ReadonlyMap<string, number> {
  let next = 0;
  const pieces = stampSetup(params, { x: 0, z: 0 }, 0, () => `need-${String((next += 1))}`);
  return placedCounts(pieces);
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
  for (const [assetId, need] of needs) {
    const usable = stock.get(assetId);
    if (usable === undefined) return null;
    whole = Math.min(whole, Math.floor(Math.max(0, usable - (placed.get(assetId) ?? 0)) / need));
  }
  return whole;
}

/** Blake's B2, hard: whether setting this card down would need more than the store holds. Unknown stock never refuses. */
export function storeRefuses(params: CardParams, stock: UsableStock | null, placed: ReadonlyMap<string, number>): boolean {
  if (stock === null) return false;
  const figure = cardStoreFigure(params, stock, placed);
  return figure !== null && figure < 1;
}
