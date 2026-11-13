import { create } from "zustand";

// ---------------------------------------------------------------------------
// Placement notice — one plain line about the placement just attempted, shown
// near the floor (PlacementNotice) when a tap could not place anything, or a
// receipt for one that did. A new line replaces the last; each clears itself
// after PLACEMENT_NOTICE_MS.
//
// This is the engine's one channel for such lines, whichever chrome is on
// screen: a receipt the planner can take back is posted with `undo`, and a
// chrome with a receipt host (v2's, lane C) offers Undo beside it; v1 shows
// the words alone.
// ---------------------------------------------------------------------------

export interface PlacementNotice {
  readonly id: number;
  readonly text: string;
  /** A receipt for a change one Undo takes back ("Pasted 3 tables from the Grand Hall"). */
  readonly undo?: true;
}

/** How a line is posted: `undo` for a receipt one Undo takes back. */
export interface PlacementNoticeOptions {
  readonly undo?: boolean;
}

interface PlacementNoticeState {
  readonly notice: PlacementNotice | null;
  /** Show `text`, replacing any line already showing. */
  readonly post: (text: string, options?: PlacementNoticeOptions) => void;
  /** Clear the line (only `id`'s line, when given). */
  readonly dismiss: (id?: number) => void;
}

/** Long enough to read a sentence twice, then the floor is clear again. */
export const PLACEMENT_NOTICE_MS = 6000;

let noticeCounter = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function clearNoticeTimer(): void {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
}

export const usePlacementNoticeStore = create<PlacementNoticeState>()((set, get) => ({
  notice: null,
  post: (text, options = {}) => {
    noticeCounter += 1;
    const id = noticeCounter;
    clearNoticeTimer();
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (get().notice?.id === id) set({ notice: null });
    }, PLACEMENT_NOTICE_MS);
    set({ notice: options.undo === true ? { id, text, undo: true } : { id, text } });
  },
  dismiss: (id) => {
    const current = get().notice;
    if (current === null || (id !== undefined && current.id !== id)) return;
    clearNoticeTimer();
    set({ notice: null });
  },
}));

/** Post a placement notice from outside React; `undo` for a receipt one Undo takes back. */
export function postPlacementNotice(text: string, options?: PlacementNoticeOptions): void {
  usePlacementNoticeStore.getState().post(text, options);
}
