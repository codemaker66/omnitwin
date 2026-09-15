import { inventoryPictureSource } from "./InventoryPicture.js";
import type { VenueInventoryItem } from "../../../api/venue-inventory.js";

// ---------------------------------------------------------------------------
// Which item the inventory opens on
//
// Opening on the catalogue's first item showed an unrecorded row with nothing
// to look at — a screen that reads as broken on arrival. Prefer an item that
// has both recorded stock and a picture, then stock alone, then a picture
// alone, and only then the first row. Order within a band is the caller's
// (the API returns category, then name, then id), so this stays stable.
// ---------------------------------------------------------------------------

function score(item: VenueInventoryItem): number {
  const hasStock = item.stock !== null;
  const hasPicture = inventoryPictureSource(item.catalogue.name, item.catalogue.id) !== null;
  if (hasStock && hasPicture) return 3;
  if (hasStock) return 2;
  if (hasPicture) return 1;
  return 0;
}

/**
 * The catalogue id the panel should select, or null when there is nothing to
 * select. `current` wins whenever it is still present, so a refresh never
 * moves the user off the item they are working on.
 */
export function openingInventoryItemId(
  items: readonly VenueInventoryItem[],
  current: string | null = null,
): string | null {
  if (current !== null && items.some((item) => item.catalogue.id === current)) return current;
  let best: VenueInventoryItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    const value = score(item);
    if (value > bestScore) {
      best = item;
      bestScore = value;
    }
  }
  return best?.catalogue.id ?? null;
}
