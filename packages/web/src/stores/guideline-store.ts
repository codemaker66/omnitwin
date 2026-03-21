import { create } from "zustand";
import type { GuidelineData, WallHit } from "../lib/guideline.js";
import { computeGuideline } from "../lib/guideline.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuidelineState {
  /** Whether the tape measure tool is active (listening for wall clicks). */
  readonly active: boolean;
  /** All placed guidelines. */
  readonly guidelines: readonly GuidelineData[];
  /** Auto-increment ID counter. */
  readonly nextId: number;
  /** Activate the tape measure tool. */
  readonly activate: () => void;
  /** Deactivate the tape measure tool. */
  readonly deactivate: () => void;
  /** Toggle tool active/inactive. */
  readonly toggle: () => void;
  /** Place a guideline from a wall hit. */
  readonly placeGuideline: (wallHit: WallHit) => void;
  /** Remove a guideline by ID. */
  readonly removeGuideline: (id: number) => void;
  /** Clear all guidelines. */
  readonly clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGuidelineStore = create<GuidelineState>()((set, get) => ({
  active: false,
  guidelines: [],
  nextId: 1,

  activate: () => {
    set({ active: true });
  },

  deactivate: () => {
    set({ active: false });
  },

  toggle: () => {
    set((state) => ({ active: !state.active }));
  },

  placeGuideline: (wallHit: WallHit) => {
    const state = get();
    if (!state.active) return;

    const guideline = computeGuideline(wallHit, state.nextId);
    set({
      guidelines: [...state.guidelines, guideline],
      nextId: state.nextId + 1,
    });
  },

  removeGuideline: (id: number) => {
    const state = get();
    set({
      guidelines: state.guidelines.filter((g) => g.id !== id),
    });
  },

  clearAll: () => {
    set({ guidelines: [] });
  },
}));
