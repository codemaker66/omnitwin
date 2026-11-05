import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { GRID_SPACING_M } from "./placement.js";
import { asOneUndoStep } from "./planner-keymap.js";
import { keptClearLine, type DoorClearSpace } from "./door-clear-spaces.js";
import { doorBlockers, doorSlideForPieces, type DoorRoom } from "./keep-doors-clear.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { postPlacementNotice } from "../stores/placement-notice-store.js";
import { announceDoorSlide, useDoorClearSpaceStore } from "../stores/door-clear-space-store.js";

// ---------------------------------------------------------------------------
// The door rule's one hand-driven move. Blake, 28 Oct 2026: "let people place
// tables within the red zone but have a warning on it (an aesthetic warning of
// some kind, not something annoying or makes it look bad)". A piece placed or
// let go in front of a door stays where it was put; the floor and
// DoorClearNotice say so quietly, and the notice's "Move it clear" moves each
// table with its chairs to free floor, as one undo step.
// ---------------------------------------------------------------------------

/** How far "Move it clear" may carry a piece to free floor, metres. */
export const MOVE_CLEAR_REACH_M = 4;

function openRoom(spaces: readonly DoorClearSpace[]): DoorRoom {
  const dims = useRoomDimensionsStore.getState().dimensions;
  return { spaces, roomWidthM: toRealWorld(dims.width), roomLengthM: toRealWorld(dims.length) };
}

/**
 * Every table with its chairs (or lone piece) in front of a door moves to the
 * nearest spot clear of the doors and of every other piece, at most
 * MOVE_CLEAR_REACH_M away, one after another, as one undo step. One with no
 * such spot stays where it is, and the notice goes on naming it. Returns how
 * many moved.
 */
export function moveDoorBlockersClear(): number {
  const spaces = useDoorClearSpaceStore.getState().spaces;
  if (spaces.length === 0) return 0;
  const kept = new Set<DoorClearSpace>();
  let moved = 0;
  asOneUndoStep(() => {
    for (const blocker of doorBlockers(usePlacementStore.getState().placedItems, spaces)) {
      const placement = usePlacementStore.getState();
      const ids = new Set(blocker.ids);
      const pieces = placement.placedItems.filter((piece) => ids.has(piece.id));
      const slide = doorSlideForPieces(pieces, placement.placedItems, openRoom(spaces), placement.snapEnabled ? GRID_SPACING_M : null, {
        avoidOthers: "require",
        maxDistanceM: MOVE_CLEAR_REACH_M,
      });
      if (slide.kind !== "slide") continue;
      const dx = toRenderSpace(slide.dx);
      const dz = toRenderSpace(slide.dz);
      placement.moveItemsByDelta(ids, dx, dz);
      announceDoorSlide({ ids: blocker.ids, dx, dz });
      for (const door of slide.doors) kept.add(door);
      moved += 1;
    }
  });
  if (kept.size > 0) postPlacementNotice(keptClearLine(spaces.filter((space) => kept.has(space))));
  return moved;
}
