import { describe, expect, it } from "vitest";
import { openingInventoryItemId } from "../inventory-opening-item.js";
import type { VenueInventoryItem } from "../../../../api/venue-inventory.js";

// The Chiavari chair is one of the catalogue names with a bundled
// illustration; "Servery Unit" and "Lectern" have neither an illustration nor
// a model preview, so they stand in for picture-less rows.
const CHIAVARI = "a0000000-0000-4000-8000-000000000001";
const SERVERY = "a0000000-0000-4000-8000-000000000002";
const LECTERN = "a0000000-0000-4000-8000-000000000003";

function item(id: string, name: string, recorded: boolean): VenueInventoryItem {
  return {
    catalogue: { id, name, category: "other" },
    stock: recorded
      ? {
          venueId: "b0000000-0000-4000-8000-000000000001",
          assetDefinitionId: id,
          revision: 1,
          ownedQuantity: 12,
          damagedQuantity: 0,
          unavailableQuantity: 0,
          hires: [],
          storageLocation: null,
          status: "active",
          effectiveAt: "2026-09-15T09:00:00.000Z",
        }
      : null,
  };
}

describe("openingInventoryItemId", () => {
  it("prefers an item that has both recorded stock and a picture", () => {
    const items = [
      item(SERVERY, "Servery Unit", true),
      item(LECTERN, "Lectern", false),
      item(CHIAVARI, "Chiavari Wedding Chair", true),
    ];
    expect(openingInventoryItemId(items)).toBe(CHIAVARI);
  });

  it("falls back to recorded stock when nothing pictured has any", () => {
    const items = [
      item(LECTERN, "Lectern", false),
      item(SERVERY, "Servery Unit", true),
      item(CHIAVARI, "Chiavari Wedding Chair", false),
    ];
    expect(openingInventoryItemId(items)).toBe(SERVERY);
  });

  it("falls back to a pictured item when no stock is recorded anywhere", () => {
    const items = [
      item(LECTERN, "Lectern", false),
      item(CHIAVARI, "Chiavari Wedding Chair", false),
    ];
    expect(openingInventoryItemId(items)).toBe(CHIAVARI);
  });

  it("takes the first item when nothing has stock or a picture", () => {
    const items = [item(LECTERN, "Lectern", false), item(SERVERY, "Servery Unit", false)];
    expect(openingInventoryItemId(items)).toBe(LECTERN);
  });

  it("keeps the current selection so a refresh never moves the user", () => {
    const items = [item(CHIAVARI, "Chiavari Wedding Chair", true), item(LECTERN, "Lectern", false)];
    expect(openingInventoryItemId(items, LECTERN)).toBe(LECTERN);
  });

  it("re-chooses when the current selection has gone and returns null when empty", () => {
    const items = [item(CHIAVARI, "Chiavari Wedding Chair", true)];
    expect(openingInventoryItemId(items, SERVERY)).toBe(CHIAVARI);
    expect(openingInventoryItemId([], SERVERY)).toBeNull();
  });
});
