import { create } from "zustand";

// ---------------------------------------------------------------------------
// Whether the new chrome's caption is on screen (T-671 slice 11′).
//
// The caption names the selected piece, so while it shows, the room's
// nameplate over that piece steps aside (PlacedFurniture). Where the caption
// steps aside itself (a card in hand, Walk, a view-only layout), the plate
// names the piece again. Only the caption writes here; today's planner has
// no caption, so its plates are as they were.
// ---------------------------------------------------------------------------

interface CaptionPresenceState {
  readonly shown: boolean;
  readonly setShown: (shown: boolean) => void;
}

export const useCaptionPresenceStore = create<CaptionPresenceState>()((set) => ({
  shown: false,
  setShown: (shown) => { set({ shown }); },
}));
