import { useEffect, useMemo } from "react";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../constants/scale.js";
import { computeBoundingBox, resolveRoomGeometry } from "../data/room-geometries.js";
import { useSectionStore } from "../stores/section-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { useDoorClearSpaceStore } from "../stores/door-clear-space-store.js";
import { useModelledGrandHall } from "../components/grand-hall/hall-space.js";
import { roomDoorClearSpaces } from "../lib/door-clear-spaces.js";

// ---------------------------------------------------------------------------
// The planner's room size, shared by today's editor (App) and the new
// chrome's room stage (T-671). Both read the loaded space, render at its
// size, and tell the section, bookmark and room-size stores, and the door
// store which doors keep a clear space: the Grand Hall's surveyed doors when
// the room is drawn as the Grand Hall (the same test as its model), none in
// a room whose doors are not recorded.
// ---------------------------------------------------------------------------

// The Grand Hall until a space is loaded (runs once, at module load).
useSectionStore.getState().setMaxHeight(GRAND_HALL_RENDER_DIMENSIONS.height);
useBookmarkStore.getState().initialize(GRAND_HALL_RENDER_DIMENSIONS);

/**
 * Render dimensions from the loaded space's room geometry, falling back to the
 * Grand Hall with no space loaded; the stores that need them are kept in step.
 */
export function usePlannerRoomDimensions(): SpaceDimensions {
  const space = useEditorStore((s) => s.space);
  const dimensions = useMemo(() => {
    if (space === null) return GRAND_HALL_RENDER_DIMENSIONS;

    const geom = resolveRoomGeometry(space);
    if (geom !== null) {
      const bbox = computeBoundingBox(geom.wallPolygon);
      return scaleForRendering({
        width: bbox.width,
        length: bbox.depth,
        height: geom.ceilingHeight,
      });
    }

    // Defensive: no polygon available (shouldn't happen post Prompt 7,
    // which makes floor-plan outlines required on every space write).
    return scaleForRendering({
      width: parseFloat(space.widthM),
      length: parseFloat(space.lengthM),
      height: parseFloat(space.heightM),
    });
  }, [space]);

  const { width, length, height } = dimensions;
  useEffect(() => {
    useSectionStore.getState().setMaxHeight(height);
    useBookmarkStore.getState().initialize({ width, length, height });
    useRoomDimensionsStore.getState().setDimensions({ width, length, height });
  }, [width, length, height]);

  const grandHall = useModelledGrandHall();
  useEffect(() => {
    useDoorClearSpaceStore.getState().setRoomSpaces(roomDoorClearSpaces(grandHall ? "grand-hall" : null));
  }, [grandHall]);

  return dimensions;
}
