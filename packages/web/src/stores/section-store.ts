import { create } from "zustand";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface SectionState {
  /** Current section plane height in meters. Everything above this is clipped. */
  readonly height: number;
  /** Maximum height (room ceiling). */
  readonly maxHeight: number;
  /** Set the section height (clamped to [0, maxHeight]). */
  readonly setHeight: (height: number) => void;
  /** Set the maximum height (called once when room dimensions are known). */
  readonly setMaxHeight: (maxHeight: number) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Clamps a value between min and max. */
export function clampHeight(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Section plane store for the wall-clipping slider.
 *
 * Height represents the Y position of a horizontal clipping plane.
 * Everything above this height is clipped away, progressively revealing
 * a top-down planning view as the slider is dragged down.
 *
 * Defaults to 7m (Grand Hall ceiling height) — full walls visible on load.
 */
export const useSectionStore = create<SectionState>()((set, get) => ({
  height: 7,
  maxHeight: 7,

  setHeight: (height: number) => {
    const { maxHeight } = get();
    set({ height: clampHeight(height, 0, maxHeight) });
  },

  setMaxHeight: (maxHeight: number) => {
    set((state) => ({
      maxHeight,
      height: clampHeight(state.height, 0, maxHeight),
    }));
  },
}));
