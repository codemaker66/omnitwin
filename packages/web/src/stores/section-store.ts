import { create } from "zustand";
import type { BoxBounds, BoxFace } from "../lib/section-box.js";
import { getFullRoomBounds, clampBoxFace } from "../lib/section-box.js";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Section mode: "plane" = single top slice (legacy slider), "box" = 6-sided crop. */
export type SectionMode = "plane" | "box";

export interface SectionState {
  /** Current section mode. */
  readonly mode: SectionMode;
  /** Current section plane height in meters. Everything above this is clipped. */
  readonly height: number;
  /** Maximum height (room ceiling). */
  readonly maxHeight: number;
  /** Section box bounds (6-sided clipping). */
  readonly boxBounds: BoxBounds;
  /** Whether the section box is actively clipping (mode === "box"). */
  readonly boxEnabled: boolean;
  /** Set the section height (clamped to [0, maxHeight]). */
  readonly setHeight: (height: number) => void;
  /** Set the maximum height (called once when room dimensions are known). */
  readonly setMaxHeight: (maxHeight: number) => void;
  /** Set section mode. */
  readonly setMode: (mode: SectionMode) => void;
  /** Toggle box mode on/off. */
  readonly toggleBox: () => void;
  /** Set a single face of the section box. */
  readonly setBoxFace: (face: BoxFace, value: number) => void;
  /** Reset box to full room bounds. */
  readonly resetBox: () => void;
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
 * Section store — controls both the single-plane slider and the 6-sided section box.
 *
 * In "plane" mode, only the top clipping plane (Y) is active.
 * In "box" mode, all 6 faces clip the scene.
 */
export const useSectionStore = create<SectionState>()((set, get) => ({
  mode: "plane" as SectionMode,
  height: 7,
  maxHeight: 7,
  boxBounds: getFullRoomBounds(),
  boxEnabled: false,

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

  setMode: (mode: SectionMode) => {
    set({ mode, boxEnabled: mode === "box" });
  },

  toggleBox: () => {
    const state = get();
    const newMode: SectionMode = state.mode === "box" ? "plane" : "box";
    set({ mode: newMode, boxEnabled: newMode === "box" });
  },

  setBoxFace: (face: BoxFace, value: number) => {
    const state = get();
    const clamped = clampBoxFace(face, value, state.boxBounds);
    set({
      boxBounds: { ...state.boxBounds, [face]: clamped },
    });
  },

  resetBox: () => {
    set({ boxBounds: getFullRoomBounds() });
  },
}));
