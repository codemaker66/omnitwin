import { create } from "zustand";

// ---------------------------------------------------------------------------
// Placement notice — one plain line about the placement just attempted, shown
// near the floor (PlacementNotice) when a tap could not place anything. A new
// line replaces the last; each clears itself after PLACEMENT_NOTICE_MS.
// ---------------------------------------------------------------------------

export interface PlacementNotice {
  readonly id: number;
  readonly text: string;
}

interface PlacementNoticeState {
  readonly notice: PlacementNotice | null;
  /** Show `text`, replacing any line already showing. */
  readonly post: (text: string) => void;
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
  post: (text) => {
    noticeCounter += 1;
    const id = noticeCounter;
    clearNoticeTimer();
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (get().notice?.id === id) set({ notice: null });
    }, PLACEMENT_NOTICE_MS);
    set({ notice: { id, text } });
  },
  dismiss: (id) => {
    const current = get().notice;
    if (current === null || (id !== undefined && current.id !== id)) return;
    clearNoticeTimer();
    set({ notice: null });
  },
}));

/** Post a placement notice from outside React. */
export function postPlacementNotice(text: string): void {
  usePlacementNoticeStore.getState().post(text);
}
