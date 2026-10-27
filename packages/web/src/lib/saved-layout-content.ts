import type { EditorObject } from "../stores/editor-store.js";
import { getCatalogueItem } from "./catalogue.js";

// ---------------------------------------------------------------------------
// Whether the server already holds a document (QoL D-X2).
//
// A save sent as the planner hides or closes may land after the page is gone,
// so the page never hears back: the copy this device kept still says it was
// edited from the older revision. When the layout opens again the server is a
// revision ahead, and on revision numbers alone that reads as someone else's
// change, a conflict to settle. Comparing what the two hold settles it
// instead: the same pieces, placed and dressed the same, is the same layout.
//
// Positions and scale are stored to the millimetre (numeric(8,3), (5,3)) and
// turns to five places (numeric(8,5)), so a kept value matches the stored one
// within half a unit of that precision. A piece placed since the last save
// has a local id here and the id the server gave it there, so those pair by
// what they are. Sort order says nothing about the room and is not compared.
// ---------------------------------------------------------------------------

const METRE_TOLERANCE = 0.0005 + 1e-7;
const TURN_TOLERANCE = 0.000005 + 1e-9;

function within(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** The catalogue id the save sends for a piece (editorToBatch's rule). */
function savedAsset(object: EditorObject): string {
  return getCatalogueItem(object.assetDefinitionId)?.id ?? object.assetDefinitionId;
}

/** A cloth's style as the server keeps it: none without a cloth, black by default. */
function savedCloth(object: EditorObject): string | null {
  return object.clothed ? object.clothStyle ?? "black" : null;
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** One piece as it would be stored, against one as it is stored. */
export function sameSavedPiece(kept: EditorObject, stored: EditorObject): boolean {
  return savedAsset(kept) === savedAsset(stored)
    && within(kept.positionX, stored.positionX, METRE_TOLERANCE)
    && within(kept.positionY, stored.positionY, METRE_TOLERANCE)
    && within(kept.positionZ, stored.positionZ, METRE_TOLERANCE)
    && within(kept.rotationX, stored.rotationX, TURN_TOLERANCE)
    && within(kept.rotationY, stored.rotationY, TURN_TOLERANCE)
    && within(kept.rotationZ, stored.rotationZ, TURN_TOLERANCE)
    && within(kept.scale, stored.scale, METRE_TOLERANCE)
    && kept.clothed === stored.clothed
    && savedCloth(kept) === savedCloth(stored)
    && kept.tableSetting === stored.tableSetting
    && trimmedOrNull(kept.chairStyle) === trimmedOrNull(stored.chairStyle)
    && trimmedOrNull(kept.centerpiece) === trimmedOrNull(stored.centerpiece)
    && kept.groupId === stored.groupId
    && (kept.label ?? "").trim() === (stored.label ?? "").trim()
    && kept.notes === stored.notes;
}

/**
 * True when the server's document holds exactly the kept one: every piece
 * the server knew is there unchanged, nothing else is, and each piece placed
 * since (a local id) is matched by a stored piece of its own.
 */
export function serverHoldsLayout(
  kept: readonly EditorObject[],
  stored: readonly EditorObject[],
  isLocalId: (id: string) => boolean,
): boolean {
  return matchSavedLayout(kept, stored, isLocalId) !== null;
}

/**
 * The same comparison, answering which stored piece each piece placed since
 * became (local id → the server's id); null when the server holds something
 * else.
 */
export function matchSavedLayout(
  kept: readonly EditorObject[],
  stored: readonly EditorObject[],
  isLocalId: (id: string) => boolean,
): ReadonlyMap<string, string> | null {
  if (kept.length !== stored.length) return null;
  const storedById = new Map(stored.map((object) => [object.id, object]));
  const unclaimed = new Set(stored.map((object) => object.id));
  const placedSince: EditorObject[] = [];
  for (const object of kept) {
    if (isLocalId(object.id)) {
      placedSince.push(object);
      continue;
    }
    const match = storedById.get(object.id);
    if (match === undefined || !sameSavedPiece(object, match)) return null;
    unclaimed.delete(object.id);
  }
  const placed = new Map<string, string>();
  for (const object of placedSince) {
    const match = [...unclaimed].find((id) => {
      const candidate = storedById.get(id);
      return candidate !== undefined && sameSavedPiece(object, candidate);
    });
    if (match === undefined) return null;
    unclaimed.delete(match);
    placed.set(object.id, match);
  }
  return unclaimed.size === 0 ? placed : null;
}
