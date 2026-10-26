import { create } from "zustand";
import type { AutoFillStyle } from "../lib/auto-fill.js";

// ---------------------------------------------------------------------------
// Auto-fill request — the command deck's Auto-fill opens the Guests lens with
// "How many guests?" already asked for that style. The lens takes the request
// once (take) and clears it, so reopening the lens later does not re-ask.
// ---------------------------------------------------------------------------

interface AutoFillRequestState {
  readonly requested: AutoFillStyle | null;
  readonly request: (style: AutoFillStyle) => void;
  /** Read the pending request and clear it. */
  readonly take: () => AutoFillStyle | null;
}

export const useAutoFillRequestStore = create<AutoFillRequestState>()((set, get) => ({
  requested: null,
  request: (style) => { set({ requested: style }); },
  take: () => {
    const style = get().requested;
    if (style !== null) set({ requested: null });
    return style;
  },
}));
