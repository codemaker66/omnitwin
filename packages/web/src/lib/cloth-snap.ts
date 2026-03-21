import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cloth-snap — find nearest table for cloth placement
// ---------------------------------------------------------------------------

/** Maximum distance (render-space) to snap cloth to a table. */
export const CLOTH_SNAP_DISTANCE_M = 2;
export const CLOTH_SNAP_DISTANCE_RENDER = toRenderSpace(CLOTH_SNAP_DISTANCE_M);

/**
 * Finds the nearest table to a given render-space position.
 * Returns the PlacedItem of the nearest table within maxDistance, or null.
 */
export function findNearestTable(
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  maxDistance: number,
): PlacedItem | null {
  let nearest: PlacedItem | null = null;
  let nearestDist = Infinity;

  for (const item of placedItems) {
    const catItem = getCatalogueItem(item.catalogueItemId);
    if (catItem === undefined || catItem.category !== "table") continue;

    const dx = item.x - x;
    const dz = item.z - z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < maxDistance && dist < nearestDist) {
      nearest = item;
      nearestDist = dist;
    }
  }

  return nearest;
}
