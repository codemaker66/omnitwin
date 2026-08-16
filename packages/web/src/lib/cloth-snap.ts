import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import {
  canApplyTableLinenToItem,
  isDiningTableItem,
} from "./furniture-semantics.js";
import type { PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// cloth-snap — find nearest table for cloth placement
// ---------------------------------------------------------------------------

/** Maximum distance (render-space) to snap cloth to a table. */
export const CLOTH_SNAP_DISTANCE_M = 2;
export const CLOTH_SNAP_DISTANCE_RENDER = toRenderSpace(CLOTH_SNAP_DISTANCE_M);

/**
 * Finds the nearest table eligible for the requested dressing workflow.
 * Intrinsic-cloth variants are not eligible for a second linen overlay.
 */
function findNearestEligibleTable(
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  maxDistance: number,
  diningOnly: boolean,
): PlacedItem | null {
  let nearest: PlacedItem | null = null;
  let nearestDist = Infinity;

  for (const item of placedItems) {
    const catItem = getCatalogueItem(item.catalogueItemId);
    if (catItem === undefined || catItem.category !== "table") continue;
    if (diningOnly && !isDiningTableItem(catItem)) continue;
    if (!diningOnly && !canApplyTableLinenToItem(catItem)) continue;

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

export function findNearestTable(
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  maxDistance: number,
): PlacedItem | null {
  return findNearestEligibleTable(x, z, placedItems, maxDistance, false);
}

/** Dinner settings target seated dining tables, never standing poseurs. */
export function findNearestDiningTable(
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  maxDistance: number,
): PlacedItem | null {
  return findNearestEligibleTable(x, z, placedItems, maxDistance, true);
}
