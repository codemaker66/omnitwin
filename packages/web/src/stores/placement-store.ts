import { create } from "zustand";
import type { PlacedItem } from "../lib/placement.js";
import {
  createPlacedItem,
  generatePlacedId,
  snapPositionToGrid,
  isWithinRoomBounds,
  checkCollision,
  getGroupMemberIds,
  snapToPlatformEdge,
  computeSurfaceHeight,
  snapToWallEdge,
} from "../lib/placement.js";
import { getCatalogueItem, isAtMaxCount } from "../lib/catalogue.js";
import { createTableGroup, rearrangeTableGroup } from "../lib/table-group.js";

// ---------------------------------------------------------------------------
// Placement store — manages placed furniture, ghost state, undo/redo history
// ---------------------------------------------------------------------------

/** Maximum number of undo snapshots to retain. */
const MAX_UNDO_DEPTH = 50;

export interface PlacementState {
  /** All placed furniture items. */
  readonly placedItems: readonly PlacedItem[];
  /** Undo history — previous placedItems snapshots. */
  readonly undoStack: readonly (readonly PlacedItem[])[];
  /** Redo history — snapshots pushed when undo is used. */
  readonly redoStack: readonly (readonly PlacedItem[])[];
  /** Render-space position of the ghost cursor. Null when not placing. */
  readonly ghostPosition: readonly [number, number, number] | null;
  /** Ghost rotation around Y axis in radians. */
  readonly ghostRotation: number;
  /** Whether the current ghost position is valid for placement. */
  readonly ghostValid: boolean;
  /** Human-readable reason the ghost position is invalid, or null if valid. */
  readonly ghostInvalidReason: string | null;
  /** Snap-to-grid enabled (default true). */
  readonly snapEnabled: boolean;

  /** Place the currently selected catalogue item at the ghost position. */
  readonly placeItem: (catalogueItemId: string, x: number, z: number, rotationY?: number) => void;
  /** Remove a placed item by ID. */
  readonly removeItem: (id: string) => void;
  /** Remove multiple placed items by ID. */
  readonly removeItems: (ids: ReadonlySet<string>) => void;
  /** Save undo snapshot before starting a drag-move (call once at drag start). */
  readonly beginDragMove: () => void;
  /** Update a placed item's position (for drag-move). No undo push — call beginDragMove first. */
  readonly moveItem: (id: string, x: number, z: number) => void;
  /** Update a placed item's rotation. */
  readonly rotateItem: (id: string, rotationY: number) => void;
  /** Update ghost position and validity. */
  readonly updateGhost: (x: number, z: number, catalogueItemId: string) => void;
  /** Rotate ghost by a delta (radians). */
  readonly rotateGhost: (delta: number) => void;
  /** Clear ghost (stop placing). */
  readonly clearGhost: () => void;
  /** Toggle cloth on/off for a placed item (tables only). */
  readonly toggleCloth: (id: string) => void;
  /** Toggle grid snap. */
  readonly toggleSnap: () => void;
  /** Clear all placed items. */
  readonly clearAll: () => void;
  /** Undo the last action that changed placedItems. */
  readonly undo: () => void;
  /** Redo the last undone action. */
  readonly redo: () => void;
  /** Whether undo is available. */
  readonly canUndo: () => boolean;
  /** Whether redo is available. */
  readonly canRedo: () => boolean;
  /** Place a table with auto-arranged chairs as a group. */
  readonly placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => void;
  /** Re-arrange chairs for an existing table group. */
  readonly rearrangeGroup: (tableId: string, newChairCount: number) => void;
  /** Break a single item out of its group (set groupId to null). */
  readonly breakFromGroup: (id: string) => void;
  /** Move all items in the same group as the given item by a delta. */
  readonly moveGroup: (itemId: string, dx: number, dz: number) => void;
  /** Move a set of items by a uniform delta (no per-item snapping). Recomputes surface height. */
  readonly moveItemsByDelta: (ids: ReadonlySet<string>, dx: number, dz: number) => void;
  /** Group selected items together under a new shared groupId. */
  readonly groupItems: (ids: ReadonlySet<string>) => void;
  /** Ungroup all selected items (set groupId to null). */
  readonly ungroupItems: (ids: ReadonlySet<string>) => void;
}

/** Push the current placedItems onto the undo stack (capped at MAX_UNDO_DEPTH). Clears redo. */
function pushUndo(state: PlacementState): { undoStack: readonly (readonly PlacedItem[])[]; redoStack: readonly (readonly PlacedItem[])[] } {
  const stack = [...state.undoStack, state.placedItems];
  const capped = stack.length > MAX_UNDO_DEPTH ? stack.slice(stack.length - MAX_UNDO_DEPTH) : stack;
  return { undoStack: capped, redoStack: [] };
}

export const usePlacementStore = create<PlacementState>()((set, get) => ({
  placedItems: [],
  undoStack: [],
  redoStack: [],
  ghostPosition: null,
  ghostRotation: 0,
  ghostValid: false,
  ghostInvalidReason: null,
  snapEnabled: true,

  placeItem: (catalogueItemId: string, x: number, z: number, rotationY: number = 0) => {
    const state = get();
    // Enforce inventory limits
    if (isAtMaxCount(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId))) return;
    const pos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    // Apply platform edge snapping (fixes bug where placeItem lost edge snap)
    const catItem = getCatalogueItem(catalogueItemId);
    let finalX = pos[0];
    let finalZ = pos[2];
    if (catItem !== undefined) {
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, rotationY, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catItem, rotationY);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set());
    const item = createPlacedItem(catalogueItemId, finalX, finalZ, rotationY, null, surfaceY);
    set({ placedItems: [...state.placedItems, item], ...pushUndo(state) });
  },

  removeItem: (id: string) => {
    const state = get();
    set({
      placedItems: state.placedItems.filter((item) => item.id !== id),
      ...pushUndo(state),
    });
  },

  removeItems: (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const state = get();
    // Expand selection to include all group members (e.g. deleting a table also deletes its chairs)
    const allIds = new Set<string>();
    for (const id of ids) {
      for (const memberId of getGroupMemberIds(id, state.placedItems)) {
        allIds.add(memberId);
      }
    }
    set({
      placedItems: state.placedItems.filter((item) => !allIds.has(item.id)),
      ...pushUndo(state),
    });
  },

  beginDragMove: () => {
    const state = get();
    set(pushUndo(state));
  },

  moveItem: (id: string, x: number, z: number) => {
    const state = get();
    const gridPos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    // Apply platform edge snapping when moving stage items
    const movingItem = state.placedItems.find((p) => p.id === id);
    let finalX = gridPos[0];
    let finalZ = gridPos[2];
    if (movingItem !== undefined) {
      const catItem = getCatalogueItem(movingItem.catalogueItemId);
      if (catItem !== undefined) {
        const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, movingItem.rotationY, state.placedItems, new Set([id]));
        finalX = edgeSnap.x;
        finalZ = edgeSnap.z;
        const wallSnap = snapToWallEdge(finalX, finalZ, catItem, movingItem.rotationY);
        finalX = wallSnap.x;
        finalZ = wallSnap.z;
      }
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set([id]));
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, x: finalX, z: finalZ, y: surfaceY } : item,
      ),
    });
  },

  rotateItem: (id: string, rotationY: number) => {
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, rotationY } : item,
      ),
      ...pushUndo(state),
    });
  },

  updateGhost: (x: number, z: number, catalogueItemId: string) => {
    const state = get();
    const rot = state.ghostRotation;
    const gridPos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    const catalogueItem = getCatalogueItem(catalogueItemId);
    // Edge snap + wall snap first (XZ only), then compute surface height
    let finalX = gridPos[0];
    let finalZ = gridPos[2];
    if (catalogueItem !== undefined) {
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catalogueItem, rot, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catalogueItem, rot);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set());
    const pos = [finalX, surfaceY, finalZ] as const;
    let valid = true;
    let reason: string | null = null;
    if (catalogueItem === undefined) {
      valid = false;
    } else if (!isWithinRoomBounds(pos[0], pos[2], catalogueItem, rot)) {
      valid = false;
      reason = "Outside room bounds";
    } else if (checkCollision(pos[0], pos[2], catalogueItem, rot, state.placedItems, new Set(), 0.01, surfaceY)) {
      valid = false;
      reason = "Overlaps existing furniture";
    } else if (isAtMaxCount(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId))) {
      valid = false;
      reason = "Maximum reached for this item";
    }
    set({ ghostPosition: pos, ghostValid: valid, ghostInvalidReason: reason });
  },

  rotateGhost: (delta: number) => {
    set((state) => ({ ghostRotation: state.ghostRotation + delta }));
  },

  clearGhost: () => {
    set({ ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null });
  },

  toggleCloth: (id: string) => {
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, clothed: !item.clothed } : item,
      ),
      ...pushUndo(state),
    });
  },

  toggleSnap: () => {
    set({ snapEnabled: !get().snapEnabled });
  },

  clearAll: () => {
    const state = get();
    if (state.placedItems.length === 0) return;
    set({ placedItems: [], ghostPosition: null, ghostValid: false, ...pushUndo(state) });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    if (previous === undefined) return;
    set({
      placedItems: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, state.placedItems],
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    if (next === undefined) return;
    set({
      placedItems: next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, state.placedItems],
    });
  },

  canUndo: () => {
    return get().undoStack.length > 0;
  },

  canRedo: () => {
    return get().redoStack.length > 0;
  },

  placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => {
    const state = get();
    const pos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    // Apply edge + wall snap (same as placeItem) so position matches the ghost
    const catItem = getCatalogueItem(catalogueItemId);
    let finalX = pos[0];
    let finalZ = pos[2];
    if (catItem !== undefined) {
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, rotationY, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catItem, rotationY);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set());
    const group = createTableGroup(catalogueItemId, finalX, finalZ, rotationY, chairCount, surfaceY);
    if (group.length === 0) return;
    // Recompute individual surface heights for each chair — chairs off the
    // platform edge should sit at floor level, not float at platform height.
    const adjusted = group.map((item) => {
      const chairY = computeSurfaceHeight(item.x, item.z, state.placedItems, new Set());
      return chairY !== item.y ? { ...item, y: chairY } : item;
    });
    set({ placedItems: [...state.placedItems, ...adjusted], ...pushUndo(state) });
  },

  rearrangeGroup: (tableId: string, newChairCount: number) => {
    const state = get();
    const newItems = rearrangeTableGroup(tableId, newChairCount, state.placedItems);
    // Recompute individual surface heights for rearranged chairs
    const adjusted = newItems.map((item) => {
      const surfaceY = computeSurfaceHeight(item.x, item.z, newItems, new Set([item.id]));
      return surfaceY !== item.y ? { ...item, y: surfaceY } : item;
    });
    set({ placedItems: adjusted, ...pushUndo(state) });
  },

  breakFromGroup: (id: string) => {
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, groupId: null } : item,
      ),
      ...pushUndo(state),
    });
  },

  moveGroup: (itemId: string, dx: number, dz: number) => {
    const state = get();
    pushUndo(state);
    const memberIds = getGroupMemberIds(itemId, state.placedItems);
    set({
      placedItems: state.placedItems.map((item) => {
        if (!memberIds.has(item.id)) return item;
        const newX = item.x + dx;
        const newZ = item.z + dz;
        const surfaceY = computeSurfaceHeight(newX, newZ, state.placedItems, memberIds);
        return { ...item, x: newX, z: newZ, y: surfaceY };
      }),
      redoStack: [],
    });
  },

  moveItemsByDelta: (ids: ReadonlySet<string>, dx: number, dz: number) => {
    if (ids.size === 0) return;
    const state = get();
    set({
      placedItems: state.placedItems.map((item) => {
        if (!ids.has(item.id)) return item;
        const newX = item.x + dx;
        const newZ = item.z + dz;
        const surfaceY = computeSurfaceHeight(newX, newZ, state.placedItems, ids);
        return { ...item, x: newX, z: newZ, y: surfaceY };
      }),
    });
  },

  groupItems: (ids: ReadonlySet<string>) => {
    if (ids.size < 2) return;
    const state = get();
    const newGroupId = generatePlacedId();
    set({
      placedItems: state.placedItems.map((item) =>
        ids.has(item.id) ? { ...item, groupId: newGroupId } : item,
      ),
      ...pushUndo(state),
    });
  },

  ungroupItems: (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        ids.has(item.id) ? { ...item, groupId: null } : item,
      ),
      ...pushUndo(state),
    });
  },
}));
