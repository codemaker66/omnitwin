import { create } from "zustand";
import type { PlacedItem, TableClothStyle, TableSettingStyle } from "../lib/placement.js";
import {
  createPlacedItem,
  generatePlacedId,
  snapPositionToGrid,
  getGroupMemberIds,
  expandIdsToGroupMembers,
  snapToPlatformEdge,
  computeSurfaceHeight,
  snapToWallEdge,
  getPlacementViolations,
} from "../lib/placement.js";
import { getCatalogueItem, isAtMaxCount } from "../lib/catalogue.js";
import { createTableGroup, rearrangeTableGroup } from "../lib/table-group.js";
import { planBanquetLayout } from "../lib/auto-layout.js";
import { planTheatreLayout } from "../lib/theatre-layout.js";
import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { useRoomDimensionsStore } from "./room-dimensions-store.js";
import { snapToFurnitureAlignment } from "../lib/snap-guide.js";
import { computeChairBrushSummary } from "../lib/chair-brush.js";

// ---------------------------------------------------------------------------
// Placement store — manages placed furniture and ghost state. Undo/redo for
// placement changes lives on the editor-store history timeline; EditorBridge
// mirrors placedItems into editor objects (and back on undo).
// ---------------------------------------------------------------------------

export interface PlacementState {
  /** All placed furniture items. */
  readonly placedItems: readonly PlacedItem[];
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
  /** Place a row or block of chairs from a drag brush. Returns newly placed IDs. */
  readonly placeChairBrush: (
    catalogueItemId: string,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    rotationY?: number,
  ) => readonly string[];
  /** Remove a placed item by ID. */
  readonly removeItem: (id: string) => void;
  /** Remove multiple placed items by ID. */
  readonly removeItems: (ids: ReadonlySet<string>) => void;
  /** Update a placed item's position (for drag-move). */
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
  /** Apply a table cloth style to one or more placed tables. */
  readonly applyTableCloth: (ids: ReadonlySet<string>, style: TableClothStyle) => void;
  /** Apply dinner tableware to one or more placed tables. */
  readonly applyTableSetting: (ids: ReadonlySet<string>, setting: TableSettingStyle) => void;
  /** Set the hallkeeper-visible label for a placed chair/table. Empty clears. */
  readonly setItemLabel: (id: string, label: string) => void;
  /** Toggle grid snap. */
  readonly toggleSnap: () => void;
  /** Clear all placed items. */
  readonly clearAll: () => void;
  /** Place a table with auto-arranged chairs as a group. */
  readonly placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => void;
  /** Re-arrange chairs for an existing table group. */
  readonly rearrangeGroup: (tableId: string, newChairCount: number) => void;
  /**
   * Auto-fill the room with an even, circulation-safe grid of table groups for
   * a target guest count. Replaces the current layout. A target of 0 fills the
   * whole room.
   */
  readonly autoArrangeBanquet: (catalogueItemId: string, targetGuests: number, chairsPerTable: number) => void;
  /**
   * Auto-fill the room with theatre-style rows of chairs facing a stage at one
   * end. A target of 0 fills the room. Replaces the current layout.
   */
  readonly autoArrangeTheatre: (chairItemId: string, targetGuests: number) => void;
  /** Break a single item out of its group (set groupId to null). */
  readonly breakFromGroup: (id: string) => void;
  /** Move all items in the same group as the given item by a delta. */
  readonly moveGroup: (itemId: string, dx: number, dz: number) => void;
  /** Move a set of items by a uniform delta (no per-item snapping). Recomputes surface height. */
  readonly moveItemsByDelta: (ids: ReadonlySet<string>, dx: number, dz: number) => void;
  /** Group selected items and any existing group members under a new shared groupId. */
  readonly groupItems: (ids: ReadonlySet<string>) => void;
  /** Ungroup selected item groups as whole sets (set groupId to null). */
  readonly ungroupItems: (ids: ReadonlySet<string>) => void;
}

export const usePlacementStore = create<PlacementState>()((set, get) => ({
  placedItems: [],
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
      const roomDims = useRoomDimensionsStore.getState().dimensions;
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, rotationY, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catItem, rotationY, roomDims);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
      const alignmentSnap = snapToFurnitureAlignment(finalX, finalZ, catalogueItemId, rotationY, state.placedItems, new Set());
      finalX = alignmentSnap.x;
      finalZ = alignmentSnap.z;
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set());
    const item = createPlacedItem(catalogueItemId, finalX, finalZ, rotationY, null, surfaceY);
    set({ placedItems: [...state.placedItems, item] });
  },

  placeChairBrush: (
    catalogueItemId: string,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    rotationY: number = 0,
  ) => {
    const state = get();
    const catalogueItem = getCatalogueItem(catalogueItemId);
    if (catalogueItem === undefined || catalogueItem.category !== "chair") return [];

    const start = state.snapEnabled ? snapPositionToGrid(startX, startZ) : [startX, 0, startZ] as const;
    const end = state.snapEnabled ? snapPositionToGrid(endX, endZ) : [endX, 0, endZ] as const;
    const summary = computeChairBrushSummary(
      catalogueItem,
      start[0],
      start[2],
      end[0],
      end[2],
      rotationY,
    );
    if (summary.points.length <= 1) return [];

    const newItems = summary.points.map((point) => {
      const surfaceY = computeSurfaceHeight(point.x, point.z, state.placedItems, new Set());
      return createPlacedItem(catalogueItemId, point.x, point.z, point.rotationY, null, surfaceY);
    });
    if (newItems.length === 0) return [];
    set({ placedItems: [...state.placedItems, ...newItems] });
    return newItems.map((item) => item.id);
  },

  removeItem: (id: string) => {
    const state = get();
    set({ placedItems: state.placedItems.filter((item) => item.id !== id) });
  },

  removeItems: (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const state = get();
    const allIds = expandIdsToGroupMembers(ids, state.placedItems);
    set({ placedItems: state.placedItems.filter((item) => !allIds.has(item.id)) });
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
        const roomDims = useRoomDimensionsStore.getState().dimensions;
        const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, movingItem.rotationY, state.placedItems, new Set([id]));
        finalX = edgeSnap.x;
        finalZ = edgeSnap.z;
        const wallSnap = snapToWallEdge(finalX, finalZ, catItem, movingItem.rotationY, roomDims);
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
    const roomDims = useRoomDimensionsStore.getState().dimensions;
    if (catalogueItem !== undefined) {
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catalogueItem, rot, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catalogueItem, rot, roomDims);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
      const alignmentSnap = snapToFurnitureAlignment(finalX, finalZ, catalogueItemId, rot, state.placedItems, new Set());
      finalX = alignmentSnap.x;
      finalZ = alignmentSnap.z;
    }
    const surfaceY = computeSurfaceHeight(finalX, finalZ, state.placedItems, new Set());
    const pos = [finalX, surfaceY, finalZ] as const;
    let valid = true;
    let reason: string | null = null;
    if (catalogueItem === undefined) {
      valid = false;
      reason = "Unknown catalogue item";
    } else if (isAtMaxCount(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId))) {
      valid = false;
      reason = "Maximum reached for this item";
    } else {
      const violations = getPlacementViolations(pos[0], pos[2], catalogueItem, rot, state.placedItems, new Set(), surfaceY, roomDims);
      if (violations.length > 0) {
        valid = false;
        reason = violations[0]?.message ?? "Constraint warning";
      }
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
    const target = state.placedItems.find((item) => item.id === id);
    if (target === undefined) return;
    const catalogueItem = getCatalogueItem(target.catalogueItemId);
    if (catalogueItem?.category !== "table") return;
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id
          ? {
              ...item,
              clothed: !item.clothed,
              clothStyle: item.clothed ? null : "black",
            }
          : item,
      ),
    });
  },

  applyTableCloth: (ids, style) => {
    if (ids.size === 0) return;
    const state = get();
    const targetIds = new Set<string>();
    for (const item of state.placedItems) {
      if (!ids.has(item.id)) continue;
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem?.category !== "table") continue;
      if (item.clothed && item.clothStyle === style) continue;
      targetIds.add(item.id);
    }
    if (targetIds.size === 0) return;
    const placedItems = state.placedItems.map((item) => {
      if (!targetIds.has(item.id)) return item;
      return { ...item, clothed: true, clothStyle: style };
    });
    set({ placedItems });
  },

  applyTableSetting: (ids, setting) => {
    if (ids.size === 0) return;
    const state = get();
    const targetIds = new Set<string>();
    for (const item of state.placedItems) {
      if (!ids.has(item.id)) continue;
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem?.category !== "table") continue;
      if (item.tableSetting === setting) continue;
      targetIds.add(item.id);
    }
    if (targetIds.size === 0) return;
    const placedItems = state.placedItems.map((item) => {
      if (!targetIds.has(item.id)) return item;
      return { ...item, tableSetting: setting };
    });
    set({ placedItems });
  },

  setItemLabel: (id: string, label: string) => {
    const normalized = label.trim().slice(0, 80);
    const state = get();
    const current = state.placedItems.find((item) => item.id === id);
    if (current === undefined) return;
    if ((current.label ?? "") === normalized) return;
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, label: normalized } : item,
      ),
    });
  },

  toggleSnap: () => {
    set({ snapEnabled: !get().snapEnabled });
  },

  clearAll: () => {
    const state = get();
    if (state.placedItems.length === 0) return;
    set({ placedItems: [], ghostPosition: null, ghostValid: false, ghostInvalidReason: null });
  },

  placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => {
    const state = get();
    const pos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    // Apply edge + wall snap (same as placeItem) so position matches the ghost
    const catItem = getCatalogueItem(catalogueItemId);
    let finalX = pos[0];
    let finalZ = pos[2];
    if (catItem !== undefined) {
      const roomDims = useRoomDimensionsStore.getState().dimensions;
      const edgeSnap = snapToPlatformEdge(finalX, finalZ, catItem, rotationY, state.placedItems, new Set());
      finalX = edgeSnap.x;
      finalZ = edgeSnap.z;
      const wallSnap = snapToWallEdge(finalX, finalZ, catItem, rotationY, roomDims);
      finalX = wallSnap.x;
      finalZ = wallSnap.z;
      const alignmentSnap = snapToFurnitureAlignment(finalX, finalZ, catalogueItemId, rotationY, state.placedItems, new Set());
      finalX = alignmentSnap.x;
      finalZ = alignmentSnap.z;
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
    set({ placedItems: [...state.placedItems, ...adjusted] });
  },

  rearrangeGroup: (tableId: string, newChairCount: number) => {
    const state = get();
    const newItems = rearrangeTableGroup(tableId, newChairCount, state.placedItems);
    // Recompute individual surface heights for rearranged chairs
    const adjusted = newItems.map((item) => {
      const surfaceY = computeSurfaceHeight(item.x, item.z, newItems, new Set([item.id]));
      return surfaceY !== item.y ? { ...item, y: surfaceY } : item;
    });
    set({ placedItems: adjusted });
  },

  autoArrangeBanquet: (catalogueItemId: string, targetGuests: number, chairsPerTable: number) => {
    const tableItem = getCatalogueItem(catalogueItemId);
    if (tableItem === undefined || tableItem.category !== "table") return;

    const seats = Math.max(0, Math.floor(chairsPerTable));
    const dims = useRoomDimensionsStore.getState().dimensions;
    const plan = planBanquetLayout({
      // Room dimensions are render-space; the engine works in metres.
      roomWidthM: toRealWorld(dims.width),
      roomLengthM: toRealWorld(dims.length),
      tableWidthM: tableItem.width,
      tableDepthM: tableItem.depth,
      seatsPerTable: seats,
      targetGuests: targetGuests > 0 ? targetGuests : undefined,
    });
    if (plan.tables.length === 0) return;

    // Map each planned table (metres, room-centred) back to render space and
    // build a full table+chairs group at floor level.
    const placedItems: PlacedItem[] = [];
    for (const t of plan.tables) {
      const group = createTableGroup(
        catalogueItemId,
        toRenderSpace(t.xM),
        toRenderSpace(t.zM),
        t.rotationY,
        seats,
      );
      placedItems.push(...group);
    }
    if (placedItems.length === 0) return;

    set({ placedItems });
  },

  autoArrangeTheatre: (chairItemId: string, targetGuests: number) => {
    const chairItem = getCatalogueItem(chairItemId);
    if (chairItem === undefined || chairItem.category !== "chair") return;

    const dims = useRoomDimensionsStore.getState().dimensions;
    const plan = planTheatreLayout(
      // Room dimensions are render-space; the engine works in metres.
      toRealWorld(dims.width),
      toRealWorld(dims.length),
      { targetGuests: targetGuests > 0 ? targetGuests : undefined },
    );
    if (plan.seats.length === 0) return;

    // Each planned seat (metres, room-centred, facing the stage) → a floor-level
    // chair in render space. No groups — theatre chairs stand alone.
    const placedItems = plan.seats.map((s) =>
      createPlacedItem(chairItemId, toRenderSpace(s.xM), toRenderSpace(s.zM), s.rotationY, null, 0),
    );
    set({ placedItems });
  },

  breakFromGroup: (id: string) => {
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, groupId: null } : item,
      ),
    });
  },

  moveGroup: (itemId: string, dx: number, dz: number) => {
    const state = get();
    const memberIds = getGroupMemberIds(itemId, state.placedItems);
    set({
      placedItems: state.placedItems.map((item) => {
        if (!memberIds.has(item.id)) return item;
        const newX = item.x + dx;
        const newZ = item.z + dz;
        const surfaceY = computeSurfaceHeight(newX, newZ, state.placedItems, memberIds);
        return { ...item, x: newX, z: newZ, y: surfaceY };
      }),
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
    const expandedIds = expandIdsToGroupMembers(ids, state.placedItems);
    if (expandedIds.size < 2) return;
    const newGroupId = generatePlacedId();
    set({
      placedItems: state.placedItems.map((item) =>
        expandedIds.has(item.id) ? { ...item, groupId: newGroupId } : item,
      ),
    });
  },

  ungroupItems: (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const state = get();
    const expandedIds = expandIdsToGroupMembers(ids, state.placedItems);
    set({
      placedItems: state.placedItems.map((item) =>
        expandedIds.has(item.id) ? { ...item, groupId: null } : item,
      ),
    });
  },
}));
