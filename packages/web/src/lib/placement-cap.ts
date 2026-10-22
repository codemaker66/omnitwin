import { getCatalogueItem, isAtMaxCount } from "./catalogue.js";

// ---------------------------------------------------------------------------
// placement-cap — why tapping Add did nothing.
//
// Some pieces exist in a fixed number at the venue (a catalogue maxCount).
// Placing another used to return silently, so a tap on the floor did nothing
// at all (redteam fix-first 15: "placement-store.ts:150 returns silently on
// isAtMaxCount"). The line below says why, in the venue's terms, and what to
// do instead: the pieces are already on the floor, so move one.
// ---------------------------------------------------------------------------

/** "The venue has 4 of these, and all 4 are placed; move one to use it elsewhere." */
export function capReachedLine(maxCount: number): string {
  if (maxCount <= 0) return "The venue has none of these to place.";
  if (maxCount === 1) return "The venue has one of these, and it is already placed; move it to use it elsewhere.";
  return `The venue has ${String(maxCount)} of these, and all ${String(maxCount)} are placed; move one to use it elsewhere.`;
}

/** The line for a catalogue item already at its cap among the placed items,
 *  or null while more can be placed. */
export function capReachedFor(catalogueItemId: string, placedCatalogueIds: readonly string[]): string | null {
  const item = getCatalogueItem(catalogueItemId);
  if (item === undefined || item.maxCount === null) return null;
  return isAtMaxCount(catalogueItemId, placedCatalogueIds) ? capReachedLine(item.maxCount) : null;
}
