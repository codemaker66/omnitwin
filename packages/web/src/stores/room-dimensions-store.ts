import { create } from "zustand";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";

// ---------------------------------------------------------------------------
// Room Dimensions Store — current render-space room dimensions
//
// Updated by App.tsx whenever the active space changes.
// Read by placement-store and visibility-store to perform correct
// bounds checking, wall snapping, and wall fade calculations for
// whatever room is currently loaded (Grand Hall, Saloon, etc).
// ---------------------------------------------------------------------------

interface RoomDimensionsState {
  /** Current room dimensions in render-space (metres × RENDER_SCALE for XZ, real metres for Y). */
  readonly dimensions: SpaceDimensions;
  /** Replace dimensions when the active space changes. */
  readonly setDimensions: (dims: SpaceDimensions) => void;
}

export const useRoomDimensionsStore = create<RoomDimensionsState>()((set) => ({
  dimensions: GRAND_HALL_RENDER_DIMENSIONS,
  setDimensions: (dims: SpaceDimensions) => {
    set({ dimensions: dims });
  },
}));
