import { create } from "zustand";
import type { GhostVerdict } from "../lib/ghost-truth.js";

// ---------------------------------------------------------------------------
// The ghost's last verdict (card-dock Q-05, behind truthfulGhost): what the
// set in hand shows (components/GhostSet.tsx), so setting it down judges
// with the same history, its 0.02 m hysteresis included, and a click never
// places what the ghost showed refused. Null with nothing in hand.
// ---------------------------------------------------------------------------

interface GhostVerdictState {
  readonly verdict: GhostVerdict | null;
  readonly setVerdict: (verdict: GhostVerdict | null) => void;
}

export const useGhostVerdictStore = create<GhostVerdictState>()((set) => ({
  verdict: null,
  setVerdict: (verdict) => {
    set({ verdict });
  },
}));
