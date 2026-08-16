import { create } from "zustand";

export interface FurnitureInspectionState {
  /** Placed furniture currently shown in the inspection presentation. */
  readonly inspectedPlacedItemId: string | null;
  /** Generated mesh part highlighted in the inspection presentation. */
  readonly selectedGeneratedPartId: string | null;
  /** Normalized generated-part displacement, from collapsed (0) to fully exploded (1). */
  readonly explodeProgress: number;
  /** Open a fresh inspection for one placed furniture item. */
  readonly openInspection: (placedItemId: string) => void;
  /** Close the inspection and discard all presentation-only state. */
  readonly closeInspection: () => void;
  /** Select a generated mesh part, or clear part selection with null. */
  readonly selectGeneratedPart: (generatedPartId: string | null) => void;
  /** Set normalized explode progress. Values outside [0, 1] are clamped. */
  readonly setExplodeProgress: (progress: number) => void;
  /** Toggle between collapsed and fully exploded presentation states. */
  readonly toggleExploded: () => void;
}

const CLOSED_INSPECTION = {
  inspectedPlacedItemId: null,
  selectedGeneratedPartId: null,
  explodeProgress: 0,
} as const;

function clampExplodeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Ephemeral furniture-inspection presentation state.
 *
 * This store intentionally has no persistence middleware and no dependency on
 * editor or placement state. Inspection controls therefore cannot enter saved
 * planner data, autosave, or undo history.
 */
export const useFurnitureInspectionStore = create<FurnitureInspectionState>()((set, get) => ({
  ...CLOSED_INSPECTION,

  openInspection: (placedItemId) => {
    set({
      inspectedPlacedItemId: placedItemId,
      selectedGeneratedPartId: null,
      explodeProgress: 0,
    });
  },

  closeInspection: () => {
    set(CLOSED_INSPECTION);
  },

  selectGeneratedPart: (generatedPartId) => {
    if (get().inspectedPlacedItemId === null) return;
    set({ selectedGeneratedPartId: generatedPartId });
  },

  setExplodeProgress: (progress) => {
    if (get().inspectedPlacedItemId === null) return;
    set({ explodeProgress: clampExplodeProgress(progress) });
  },

  toggleExploded: () => {
    const state = get();
    if (state.inspectedPlacedItemId === null) return;
    set({ explodeProgress: state.explodeProgress === 0 ? 1 : 0 });
  },
}));
