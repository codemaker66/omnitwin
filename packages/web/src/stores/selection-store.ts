import { create } from "zustand";

// ---------------------------------------------------------------------------
// Selection store — manages selected furniture items
// ---------------------------------------------------------------------------

export interface SelectionState {
  /** IDs of currently selected placed items. */
  readonly selectedIds: ReadonlySet<string>;
  /** Whether a marquee drag is active. */
  readonly marqueeActive: boolean;
  /** Marquee start point (screen coords). Null when not dragging. */
  readonly marqueeStart: { readonly x: number; readonly y: number } | null;
  /** Marquee current end point (screen coords). Null when not dragging. */
  readonly marqueeEnd: { readonly x: number; readonly y: number } | null;
  /** Marquee world-space start (floor plane XZ). Null when not dragging. */
  readonly marqueeWorldStart: { readonly x: number; readonly z: number } | null;
  /** Marquee world-space end (floor plane XZ). Null when not dragging. */
  readonly marqueeWorldEnd: { readonly x: number; readonly z: number } | null;

  /** Select a single item (replaces current selection). */
  readonly select: (id: string) => void;
  /** Toggle an item's selection (Shift+click). */
  readonly toggleSelect: (id: string) => void;
  /** Add multiple items to selection (marquee). */
  readonly selectMultiple: (ids: readonly string[]) => void;
  /** Clear all selection. */
  readonly clearSelection: () => void;
  /** Check if an item is selected. */
  readonly isSelected: (id: string) => boolean;
  /** Start marquee drag (screen + world coords). */
  readonly startMarquee: (x: number, y: number, worldX: number, worldZ: number) => void;
  /** Update marquee end point (screen + world coords). */
  readonly updateMarquee: (x: number, y: number, worldX: number, worldZ: number) => void;
  /** End marquee drag. */
  readonly endMarquee: () => void;
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  selectedIds: new Set<string>(),
  marqueeActive: false,
  marqueeStart: null,
  marqueeEnd: null,
  marqueeWorldStart: null,
  marqueeWorldEnd: null,

  select: (id: string) => {
    set({ selectedIds: new Set([id]) });
  },

  toggleSelect: (id: string) => {
    const state = get();
    const next = new Set(state.selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({ selectedIds: next });
  },

  selectMultiple: (ids: readonly string[]) => {
    set({ selectedIds: new Set(ids) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set<string>() });
  },

  isSelected: (id: string) => {
    return get().selectedIds.has(id);
  },

  startMarquee: (x: number, y: number, worldX: number, worldZ: number) => {
    set({
      marqueeActive: true,
      marqueeStart: { x, y },
      marqueeEnd: { x, y },
      marqueeWorldStart: { x: worldX, z: worldZ },
      marqueeWorldEnd: { x: worldX, z: worldZ },
    });
  },

  updateMarquee: (x: number, y: number, worldX: number, worldZ: number) => {
    set({
      marqueeEnd: { x, y },
      marqueeWorldEnd: { x: worldX, z: worldZ },
    });
  },

  endMarquee: () => {
    set({
      marqueeActive: false,
      marqueeStart: null,
      marqueeEnd: null,
      marqueeWorldStart: null,
      marqueeWorldEnd: null,
    });
  },
}));
