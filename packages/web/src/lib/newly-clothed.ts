import { getCatalogueItem } from "./catalogue.js";
import { appliedTableLinenStyle } from "./furniture-semantics.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// newly-clothed — which tables play the cloth drape.
//
// A cloth drapes when someone puts it on a piece already in the layout. The
// test used to key on ids alone, so any id not seen clothed before replayed
// the drape: a save re-keys local ids to server ids, an undo restores
// deleted pieces (under their old id or a healed local one), and a layout
// switch loads a whole new set. Each arrives as an id the previous set did
// not hold, which is what tells it apart from a cloth put on in place.
// ---------------------------------------------------------------------------

const NONE: readonly string[] = [];

/** True when the piece wears a cloth laid in the scene; linen built into a variant never drapes. */
function wearsAppliedCloth(placed: PlacedItem): boolean {
  if (!isSceneFurniturePlacement(placed)) return false;
  const item = getCatalogueItem(placed.catalogueItemId);
  return item !== undefined && appliedTableLinenStyle(item, placed) !== null;
}

/**
 * Ids whose cloth should drape: pieces the previous set held unclothed that
 * the next set holds clothed. No previous set (the first render) drapes
 * nothing; a piece new to the next set never drapes, whatever brought it;
 * and a cloth that only changes colour stays put.
 */
export function newlyClothedIds(
  previous: readonly PlacedItem[] | null,
  next: readonly PlacedItem[],
): readonly string[] {
  if (previous === null || previous === next) return NONE;
  let previousById: ReadonlyMap<string, PlacedItem> | null = null;
  let ids: string[] | null = null;
  for (const [index, placed] of next.entries()) {
    const before = previous[index];
    // The store keeps unchanged pieces' objects, so a drag frame skips nearly all.
    if (before === placed || !wearsAppliedCloth(placed)) continue;
    const prior = before?.id === placed.id
      ? before
      : (previousById ??= new Map(previous.map((item) => [item.id, item]))).get(placed.id);
    if (prior === undefined || wearsAppliedCloth(prior)) continue;
    (ids ??= []).push(placed.id);
  }
  return ids ?? NONE;
}
