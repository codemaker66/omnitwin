import { create } from "zustand";

// ---------------------------------------------------------------------------
// A request for the caption to take the keyboard's focus (approved spec §11;
// QoL B-X2). A key that selects one piece (] and [, lib/planner-keymap.ts)
// asks; the caption for the selection (v2's, lane C) takes focus when it is
// showing that piece, then clears the request. Nothing here moves focus.
// ---------------------------------------------------------------------------

export interface CaptionFocusRequest {
  /** The piece the caption should be showing. */
  readonly pieceId: string;
  /** New with every request, so the same piece asked for twice is asked for twice. */
  readonly nonce: number;
}

interface CaptionFocusState {
  readonly request: CaptionFocusRequest | null;
  readonly requestCaptionFocus: (pieceId: string) => void;
  /** The caption took focus, or the request no longer applies. */
  readonly clearCaptionFocus: () => void;
}

export const useCaptionFocusStore = create<CaptionFocusState>()((set) => ({
  request: null,
  requestCaptionFocus: (pieceId) => {
    set((state) => ({ request: { pieceId, nonce: (state.request?.nonce ?? 0) + 1 } }));
  },
  clearCaptionFocus: () => {
    set({ request: null });
  },
}));
