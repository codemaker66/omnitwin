import { create } from "zustand";
import type { FurnitureCategory } from "@omnitwin/types";
import { CATALOGUE_CATEGORIES } from "../lib/catalogue.js";

// ---------------------------------------------------------------------------
// Catalogue drawer state
// ---------------------------------------------------------------------------

export interface CatalogueState {
  /** Whether the catalogue drawer is open. */
  readonly drawerOpen: boolean;
  /** Currently selected catalogue item ID (ready for placement). Null if none. */
  readonly selectedItemId: string | null;
  /** Active category tab in the drawer. */
  readonly activeCategory: FurnitureCategory;
  /** Whether user is actively dragging an item from the shop bar. */
  readonly dragActive: boolean;

  /** Open the catalogue drawer. */
  readonly openDrawer: () => void;
  /** Close the drawer and clear selection. */
  readonly closeDrawer: () => void;
  /** Toggle drawer open/closed. */
  readonly toggleDrawer: () => void;
  /** Select a catalogue item for placement. */
  readonly selectItem: (id: string) => void;
  /** Begin drag from shop bar. */
  readonly startDrag: (id: string) => void;
  /** End drag (place or cancel). */
  readonly endDrag: () => void;
  /** Clear the current selection (cancel placement). */
  readonly clearSelection: () => void;
  /** Switch the active category tab. */
  readonly setCategory: (category: FurnitureCategory) => void;
}

export const useCatalogueStore = create<CatalogueState>()((set, get) => ({
  drawerOpen: false,
  selectedItemId: null,
  activeCategory: CATALOGUE_CATEGORIES[0] ?? "table",
  dragActive: false,

  openDrawer: () => {
    set({ drawerOpen: true });
  },

  closeDrawer: () => {
    set({ drawerOpen: false, selectedItemId: null, dragActive: false });
  },

  toggleDrawer: () => {
    const state = get();
    if (state.drawerOpen) {
      set({ drawerOpen: false, selectedItemId: null, dragActive: false });
    } else {
      set({ drawerOpen: true });
    }
  },

  selectItem: (id: string) => {
    set({ selectedItemId: id });
  },

  startDrag: (id: string) => {
    set({ selectedItemId: id, dragActive: true });
  },

  endDrag: () => {
    set({ selectedItemId: null, dragActive: false });
  },

  clearSelection: () => {
    set({ selectedItemId: null, dragActive: false });
  },

  setCategory: (category: FurnitureCategory) => {
    set({ activeCategory: category });
  },
}));
