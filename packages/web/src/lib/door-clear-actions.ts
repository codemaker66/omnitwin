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
// The door rule's two hand-driven moves (Blake, 27 Oct 2026: "Keep them clear
// automatically (Recommended)"):
//
//   - the end of a drag, mouse or finger alike (SelectionSystem settleDrop):
//     pieces let go in front of a door slide to the nearest clear spot, from
//     where they were let go, inside the drag's own undo step;
//   - "Move it clear" on a saved layout's notice (DoorClearNotice): a layout
//     made before the rule is never moved unasked, but one tap moves each
//     table with its chairs to free floor, as one undo step.
// ---------------------------------------------------------------------------

/** How far "Move it clear" may carry a saved layout's piece to free floor, metres. */
export const MOVE_CLEAR_REACH_M = 4;

function openRoom(spaces: readonly DoorClearSpace[]): DoorRoom {
  const dims = useRoomDimensionsStore.getState().dimensions;
  return { spaces, roomWidthM: toRealWorld(dims.width), roomLengthM: toRealWorld(dims.length) };
}

/**
 * Pieces just let go (`ids`, as the drag moved them) that stand in front of a
 * door move together to the nearest clear spot, the held piece (`heldId`) on
 * a grid point when snapping, and slide there; one line names the door.
 * Returns whether they moved.
 */
export function slideDropClearOfDoors(ids: ReadonlySet<string>, heldId: string | null): boolean {
  const spaces = useDoorClearSpaceStore.getState().spaces;
  if (spaces.length === 0 || ids.size === 0) return false;
  const placement = usePlacementStore.getState();
  const moving = placement.placedItems.filter((piece) => ids.has(piece.id));
  const held = moving.find((piece) => piece.id === heldId) ?? moving[0];
  if (held === undefined) return false;
  const slide = doorSlideForPieces(moving, placement.placedItems, openRoom(spaces), placement.snapEnabled ? GRID_SPACING_M : null, {
    anchor: { x: toRealWorld(held.x), z: toRealWorld(held.z) },
  });
  if (slide.kind !== "slide") return false;
  const dx = toRenderSpace(slide.dx);
  const dz = toRenderSpace(slide.dz);
  placement.moveItemsByDelta(ids, dx, dz);
  announceDoorSlide({ ids: [...ids], dx, dz });
  postPlacementNotice(keptClearLine(slide.doors));
  return true;
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
