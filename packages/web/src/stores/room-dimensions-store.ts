import { create } from "zustand";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import type { PlannerRoomDimensions } from "../lib/room-floor.js";

// ---------------------------------------------------------------------------
// Room Dimensions Store — current render-space room dimensions
//
// Updated by App.tsx whenever the active space changes.
// Read by placement-store and visibility-store to perform correct
// bounds checking, wall snapping, and wall fade calculations for
// whatever room is currently loaded (Grand Hall, Saloon, etc).
// ---------------------------------------------------------------------------

interface RoomDimensionsState {
  /**
   * Current room dimensions in render-space (metres × RENDER_SCALE for XZ, real metres for Y),
   * with the room's floor when its walls are not the rectangle of that size centred on the
   * origin (lib/room-floor): bounds, wall snap and the automatic layouts keep to it.
   */
  readonly dimensions: PlannerRoomDimensions;
  /** Replace dimensions when the active space changes. */
  readonly setDimensions: (dims: PlannerRoomDimensions) => void;
}

export const useRoomDimensionsStore = create<RoomDimensionsState>()((set) => ({
  dimensions: GRAND_HALL_RENDER_DIMENSIONS,
  setDimensions: (dims: PlannerRoomDimensions) => {
    set({ dimensions: dims });
  },
}));
