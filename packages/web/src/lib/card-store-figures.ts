import { listVenueInventory, type VenueInventoryData } from "../api/venue-inventory.js";
import { cardNeeds, stockIdentity, wholeCardsLeft, type UsableStock } from "./card-stock.js";
import type { CardParams } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// The store's figures on the cards, for staff (card-dock spec §17.1, Q-14):
// usable stock read from the existing staff route, and how many more of a
// card it allows. The counting and Blake's B2 limit stay in lib/card-stock.ts,
// which today's planner uses too; only the new chrome shows a figure, so this
// and the route's client load with it (T-671).
// ---------------------------------------------------------------------------

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
