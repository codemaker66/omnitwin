import type { EditorObject } from "../stores/editor-store.js";
import { getCatalogueItem } from "./catalogue.js";
import { sameObjectState } from "./layout-live/live-document.js";

// ---------------------------------------------------------------------------
// What changed between two versions of a layout, as pieces a sentence can be
// written from ("She moved Tables 3 and 4 and added a lectern"). The words
// belong to the surface; this module supplies only the facts: nouns, the
// objects' own labels, and which kind of change each piece had.
//
// Every object that differs is filed exactly once, so the four lists add up
// to the number of objects that differ (changedBetween). An object both moved
// and changed otherwise is filed under moved: position is what a person
// notices first in a room.
// ---------------------------------------------------------------------------

export interface ChangedPiece {
  /** "table" for any table, else the catalogue name in lower case, else "item". */
  readonly noun: string;
  /** The object's own label ("Table 3") when it has one; never invented. */
  readonly label: string | null;
}

export interface LayoutChangeSummary {
  /** Present before and after, with a different position or rotation. */
  readonly moved: readonly ChangedPiece[];
  /** Present only after. */
  readonly added: readonly ChangedPiece[];
  /** Present only before (labelled as it was). */
  readonly removed: readonly ChangedPiece[];
  /** Present before and after, in place, with anything else different:
   *  cloth, setting, chairs, centrepiece, size, label, note, grouping, or
   *  the piece itself swapped. */
  readonly restyled: readonly ChangedPiece[];
}

/** The plain noun for a placed piece: tables are "table" whatever their size. */
export function nounFor(object: EditorObject | undefined): string {
  if (object === undefined) return "item";
  const item = getCatalogueItem(object.assetDefinitionId);
  if (item === undefined) return "item";
  return item.tableShape !== null ? "table" : item.name.toLowerCase();
}

function pieceOf(object: EditorObject): ChangedPiece {
  const label = (object.label ?? "").trim();
  return { noun: nounFor(object), label: label.length === 0 ? null : label };
}

function movedBetween(before: EditorObject, after: EditorObject): boolean {
  // Compare the transform alone through the same tolerance every other
  // comparison of layouts uses, so float noise never reads as a move.
  return !sameObjectState(before, {
    ...before,
    positionX: after.positionX,
    positionY: after.positionY,
    positionZ: after.positionZ,
    rotationX: after.rotationX,
    rotationY: after.rotationY,
    rotationZ: after.rotationZ,
  });
}

/** What `after` did to `before`, object by object (matched by id), in
 *  document order: `after`'s order, then removed objects in `before`'s. */
export function summariseLayoutChange(
  before: readonly EditorObject[],
  after: readonly EditorObject[],
): LayoutChangeSummary {
  const beforeById = new Map(before.map((object) => [object.id, object]));
  const afterIds = new Set<string>();
  const moved: ChangedPiece[] = [];
  const added: ChangedPiece[] = [];
  const restyled: ChangedPiece[] = [];
  for (const object of after) {
    afterIds.add(object.id);
    const prior = beforeById.get(object.id);
    if (prior === undefined) {
      added.push(pieceOf(object));
    } else if (movedBetween(prior, object)) {
      moved.push(pieceOf(object));
    } else if (!sameObjectState(prior, object)) {
      restyled.push(pieceOf(object));
    }
  }
  const removed = before.filter((object) => !afterIds.has(object.id)).map(pieceOf);
  return { moved, added, removed, restyled };
}
