// ---------------------------------------------------------------------------
// A turn of its own for each round in the room
//
// Eighteen rounds in one cloth would hang the same folds, and show the
// damask's figure at the same bearing, on every table. A round table looks the
// same at any turn about its centre, so each crafted one (the catalogue's
// round tables: the rounds, the cake table, the café table and the poseurs) is
// drawn turned by an angle of its own. Only its look changes: its chairs, its
// place settings and its saved rotation keep the turn the planner gave it.
//
// The angle comes from the table's group (a round and its chairs), whose id
// is made in the browser and saved with the table as it is. A piece's own id
// is no seed: a save replaces a new piece's `local-` id with the server's
// (stores/editor-store), so its angle would jump at the first autosave. A
// group's id survives a save, a reload and a move, every co-editor sees the
// same one, and a copy takes a new one. A round on its own has no group and
// keeps the planner's turn.
// ---------------------------------------------------------------------------

import { getCatalogueItem } from "../../../lib/catalogue.js";
import { isCraftedFurnitureSlug } from "../../../lib/crafted-furniture.js";
import type { PlacedItem } from "../../../lib/placement.js";

/**
 * FNV-1a over the id, then murmur3's finaliser, as a fraction of a turn in
 * [0, 1). The finaliser spreads ids a character apart ("group-1", "group-2")
 * round the whole circle; FNV-1a alone leaves them a degree or two apart.
 */
function turnFraction(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** The turn a placed piece is drawn with beyond its own, radians in [0, 2π): 0 unless it is a crafted round table in a group. */
export function craftedTurn(placed: Pick<PlacedItem, "catalogueItemId" | "groupId">): number {
  if (placed.groupId === null) return 0;
  const item = getCatalogueItem(placed.catalogueItemId);
  if (item === undefined || item.tableShape !== "round" || !isCraftedFurnitureSlug(item.slug)) return 0;
  return turnFraction(placed.groupId) * 2 * Math.PI;
}

/** The turn a placed piece's own body is drawn at: the planner's, and the round's own. */
export function drawnRotationY(placed: Pick<PlacedItem, "catalogueItemId" | "groupId" | "rotationY">): number {
  return placed.rotationY + craftedTurn(placed);
}
