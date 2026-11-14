import { getCatalogueItem } from "./catalogue.js";
import { placedFootprint } from "./keep-doors-clear.js";
import { createGroupMemberIdsLookup, type PlacedItem } from "./placement.js";

// ---------------------------------------------------------------------------
// The mark on the floor round what is chosen (the planner HUD).
//
// A chosen piece is shown in the hall itself, not by a plate pointing at it:
// one thin line on the floor round the piece and everything that moves with
// it. A round table and its chairs get a ring; anything else gets its outline
// squared to the room. Measured here, in metres; drawn by ChosenMarks.
// ---------------------------------------------------------------------------

/** How far outside the pieces the line runs, metres. */
export const CHOSEN_MARK_MARGIN_M = 0.14;

export type ChosenMark =
  | { readonly kind: "ring"; readonly key: string; readonly x: number; readonly z: number; readonly radius: number }
  | { readonly kind: "frame"; readonly key: string; readonly x: number; readonly z: number; readonly halfW: number; readonly halfD: number };

/**
 * One mark for each chosen piece with its set (a table with its chairs, a run
 * of trestles), in the order they were chosen. Pieces of one set chosen
 * together share one mark.
 */
export function chosenMarks(selectedIds: ReadonlySet<string>, placedItems: readonly PlacedItem[]): readonly ChosenMark[] {
  if (selectedIds.size === 0) return [];
  const byId = new Map<string, PlacedItem>();
  for (const piece of placedItems) if (!byId.has(piece.id)) byId.set(piece.id, piece);
  const membersOf = createGroupMemberIdsLookup(placedItems);
  const marked = new Set<string>();
  const marks: ChosenMark[] = [];

  for (const id of selectedIds) {
    if (marked.has(id) || !byId.has(id)) continue;
    const members = [...membersOf(id)].flatMap((memberId) => {
      const piece = byId.get(memberId);
      const footprint = piece === undefined ? null : placedFootprint(piece);
      return piece === undefined || footprint === null ? [] : [{ piece, footprint }];
    });
    for (const member of members) marked.add(member.piece.id);
    marked.add(id);
    if (members.length === 0) continue;

    // A round table (with or without its chairs) is ringed about its own centre.
    const round = members.find(({ piece }) => getCatalogueItem(piece.catalogueItemId)?.tableShape === "round");
    if (round !== undefined) {
      const { x, z } = round.footprint;
      const reach = Math.max(...members.map(({ footprint }) => (
        Math.hypot(footprint.x - x, footprint.z - z) + (footprint === round.footprint
          ? Math.max(footprint.halfW, footprint.halfD)
          : Math.min(footprint.halfW, footprint.halfD))
      )));
      marks.push({ kind: "ring", key: round.piece.id, x, z, radius: reach + CHOSEN_MARK_MARGIN_M });
      continue;
    }

    const minX = Math.min(...members.map(({ footprint }) => footprint.x - footprint.halfW));
    const maxX = Math.max(...members.map(({ footprint }) => footprint.x + footprint.halfW));
    const minZ = Math.min(...members.map(({ footprint }) => footprint.z - footprint.halfD));
    const maxZ = Math.max(...members.map(({ footprint }) => footprint.z + footprint.halfD));
    marks.push({
      kind: "frame",
      key: members[0]?.piece.id ?? id,
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      halfW: (maxX - minX) / 2 + CHOSEN_MARK_MARGIN_M,
      halfD: (maxZ - minZ) / 2 + CHOSEN_MARK_MARGIN_M,
    });
  }
  return marks;
}
