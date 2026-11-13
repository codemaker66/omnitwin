import { getCatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import type { PlannerSoundId } from "../planner-sound-recipes.js";

// ---------------------------------------------------------------------------
// Which sound a placement makes on the planner HUD (design spec, "Motion and
// sound"): one sound for each act of setting down, never one per piece.
//
// The placement store announces every piece a person has just set down, all
// at once (stores/placement-store.ts, subscribeFurniturePlaced). A table set
// down with its chairs is one set, sharing a group, and lands as one set-down;
// a lone chair lands as a chair; many sets at once (Lay out, a paste, the seats
// a shortfall needed) are the brush, which Quiet plays as a short cascade
// (lib/sound-registry.ts).
// ---------------------------------------------------------------------------

/** The sound for one placement of `ids`, or null when none of them is in the room. */
export function placementSound(ids: readonly string[], placedItems: readonly PlacedItem[]): PlannerSoundId | null {
  const wanted = new Set(ids);
  const pieces = placedItems.filter((item) => wanted.has(item.id));
  if (pieces.length === 0) return null;
  const sets = new Set(pieces.map((item) => item.groupId ?? item.id));
  if (sets.size > 1) return "planner-brush";
  const [only] = pieces;
  if (pieces.length === 1 && only !== undefined && getCatalogueItem(only.catalogueItemId)?.category === "chair") return "planner-set-chair";
  return "planner-set-table";
}
