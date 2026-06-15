import { getCatalogueItem } from "./catalogue.js";
import type { PlacedItem } from "./placement.js";
import type { SeatingCounts } from "./layout-capacity.js";

// ---------------------------------------------------------------------------
// Seating counts from a placed layout — the single source of truth for the
// round/banquet/chair tallies that feed inferSeatingStyle and the capacity
// engine. Extracted from PlannerSpatialHud so the planner HUD, the enquiry
// modal, and any other surface all derive seating the same way (T-429).
// ---------------------------------------------------------------------------

/**
 * Tally round tables, banquet (rectangular) tables, and chairs from a placed
 * layout. Unknown catalogue ids are skipped (defensive — a stale id never
 * inflates a count).
 */
export function seatingCountsFromPlacedItems(
  placedItems: readonly PlacedItem[],
): SeatingCounts {
  let roundTables = 0;
  let banquetTables = 0;
  let chairs = 0;

  for (const placed of placedItems) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;

    if (item.category === "chair") chairs += 1;
    if (item.category === "table") {
      if (item.tableShape === "round") roundTables += 1;
      if (item.tableShape === "rectangular") banquetTables += 1;
    }
  }

  return { roundTables, banquetTables, chairs };
}
