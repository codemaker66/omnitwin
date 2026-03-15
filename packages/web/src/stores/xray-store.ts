import { create } from "zustand";
import {
  SOLID_OPACITY,
  stepXrayOpacity,
  isXrayTransitionComplete,
} from "../lib/xray.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface XrayState {
  /** Whether x-ray mode is active. */
  readonly enabled: boolean;
  /** Current opacity factor (1.0 = solid, 0.15 = x-ray). Lerped each frame. */
  readonly opacity: number;
  /** Toggle x-ray mode on/off. */
  readonly toggle: () => void;
  /** Advance the opacity lerp. Returns true if still transitioning. */
  readonly update: (delta: number) => boolean;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useXrayStore = create<XrayState>()((set, get) => ({
  enabled: false,
  opacity: SOLID_OPACITY,

  toggle: () => {
    set((state) => ({ enabled: !state.enabled }));
  },

  update: (delta: number): boolean => {
    const state = get();
    if (isXrayTransitionComplete(state.opacity, state.enabled)) return false;

    const newOpacity = stepXrayOpacity(state.opacity, state.enabled, delta);
    set({ opacity: newOpacity });
    return !isXrayTransitionComplete(newOpacity, state.enabled);
  },
}));
