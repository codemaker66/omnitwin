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
  withTableNumbers,
} from "../lib/placement.js";
import { plannerFeatureEnabled } from "../lib/planner-features.js";
import { DANCE_FLOOR_PANELS, cardIsWholeSet, resizeDanceFloor, type ResizeAnchor } from "../lib/setup-cards.js";
import { getCatalogueItem, isAtMaxCount } from "../lib/catalogue.js";
import { createTableGroup, rearrangeTableGroup, tableGroupChairFootprint } from "../lib/table-group.js";
import { planBanquetFill, planTheatreFill, type BanquetFillPlan, type TheatreFillPlan } from "../lib/auto-fill.js";
import { applySeatShortfallFix, type SeatShortfallFixResult } from "../lib/seat-shortfall.js";
import { capReachedFor, capReachedLine } from "../lib/placement-cap.js";
import { postPlacementNotice } from "./placement-notice-store.js";
import { toRealWorld, toRenderSpace } from "../constants/scale.js";
import { useRoomDimensionsStore } from "./room-dimensions-store.js";
import { useCatalogueStore } from "./catalogue-store.js";
import { createGhostWorld, judgeGhost, refusalChip } from "../lib/ghost-truth.js";
import { snapToFurnitureAlignment } from "../lib/snap-guide.js";
import { computeChairBrushSummary } from "../lib/chair-brush.js";
import {
  canApplyTableLinenToItem,
  isDiningTableItem,
} from "../lib/furniture-semantics.js";
import {
  isSceneFurniturePlacement,
  isTableDressingApplicator,
} from "../lib/table-dressing.js";
import { isLayoutTimelineMutationLocked } from "../lib/layout-timeline-preview-lock.js";

// ---------------------------------------------------------------------------
// Placement store — manages placed furniture and ghost state. Undo/redo for
// placement changes lives on the editor-store history timeline; EditorBridge
// mirrors placedItems into editor objects (and back on undo).
// ---------------------------------------------------------------------------

function candidateSurfaceHeight(
  catalogueItemId: string,
  x: number,
  z: number,
  placedItems: readonly PlacedItem[],
  excludeIds: ReadonlySet<string>,
): number {
  const candidate = getCatalogueItem(catalogueItemId);
  if (candidate === undefined) return 0;
  return computeSurfaceHeight(x, z, candidate, placedItems, excludeIds);
}

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
  /** Set several items' rotations in one batch (rotate tool, scrub). */
  readonly rotateItemsTo: (rotations: ReadonlyMap<string, number>) => void;
  /** Set several items' uniform scales in one batch (scale tool, scrub). */
  readonly scaleItemsTo: (scales: ReadonlyMap<string, number>) => void;
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
  /** Remove the tableware from a placed dining table. */
  readonly clearTableSetting: (id: string) => void;
  /** Set the hallkeeper-visible label for a placed chair/table. Empty clears. */
  readonly setItemLabel: (id: string, label: string) => void;
  /** Toggle grid snap. */
  readonly toggleSnap: () => void;
  /** Clear all placed items. */
  readonly clearAll: () => void;
  /** Place a table with auto-arranged chairs as a group. */
  readonly placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => void;
  /**
   * Sets a card's stamped set down exactly as it stands (the ghost's
   * resolved pose; no snapping), as one undo step: every piece settled on
   * the surface under it, new tables numbered (tableNumbers). Refused, with
   * a notice, when any piece is at the venue's cap. The ids placed.
   */
  readonly placeSetup: (pieces: readonly PlacedItem[]) => readonly string[];
  /**
   * An edit set down as one write, so one undo step (Line up, Move, Replace;
   * lib/placement-edit, lib/replace): the pieces in `removeIds` go, each
   * piece of `add` already placed changes in place (keeping its id), and the
   * rest join, exactly as they stand. Tables that join are numbered, and a
   * table changed in place is numbered on its first edit (tableNumbers).
   * Refused, with a notice, when it would take any kind of piece past the
   * venue's cap. The ids of the pieces that changed or joined.
   */
  readonly applyEdit: (edit: { readonly removeIds?: ReadonlySet<string>; readonly add: readonly PlacedItem[] }) => readonly string[];
  /**
   * A placed dance floor set to `cols` × `rows` whole panels (2 to 12 a
   * side), the anchored edge holding still, as one undo step (Q-08a): the
   * panels in place keep their ids, new ones join the floor's group. False
   * when the group is not one floor's grid, the size is unchanged, or the
   * venue's cap refuses the panels it adds.
   */
  readonly resizeArea: (groupId: string, cols: number, rows: number, anchor?: ResizeAnchor) => boolean;
  /** Re-arrange chairs for an existing table group. */
  readonly rearrangeGroup: (tableId: string, newChairCount: number) => void;
  /**
   * Auto-fill the room with an even, circulation-safe arrangement of table
   * groups for a target guest count, at the banquet spacing (lib/auto-fill).
   * Replaces the current layout. A target of 0 fills the whole room. Returns
   * what it placed, including the seats the room takes at this spacing, or
   * null when it placed nothing.
   */
  readonly autoArrangeBanquet: (catalogueItemId: string, targetGuests: number, chairsPerTable: number) => BanquetFillPlan | null;
  /**
   * Auto-fill the room with theatre-style rows of chairs facing a stage at one
   * end. A target of 0 fills the room. Replaces the current layout. Returns
   * what it placed, or null when it placed nothing.
   */
  readonly autoArrangeTheatre: (chairItemId: string, targetGuests: number) => TheatreFillPlan | null;
  /**
   * Add the seats the floor is short of the guest count, in one step: chairs
   * at the tables while they have room, otherwise tables like those placed
   * (lib/seat-shortfall). Returns what it added, or null when nothing could be.
   */
  readonly fillSeatShortfall: (guests: number) => SeatShortfallFixResult | null;
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

/**
 * Furniture a person has just placed — a piece, a table with its chairs, a
 * row of chairs, an arranged room — as distinct from furniture loaded,
 * restored or undone. The planner's motion layer lands these gently.
 */
type FurniturePlacedListener = (ids: readonly string[]) => void;

const furniturePlacedListeners = new Set<FurniturePlacedListener>();

/** Hear each placement's new ids. Returns the unsubscribe. */
export function subscribeFurniturePlaced(listener: FurniturePlacedListener): () => void {
  furniturePlacedListeners.add(listener);
  return () => { furniturePlacedListeners.delete(listener); };
}

function announcePlaced(ids: readonly string[]): void {
  if (ids.length === 0) return;
  for (const listener of furniturePlacedListeners) listener(ids);
}

/** The venue's cap a change would pass, counting every kind of piece before and after it: its notice, or null. */
function capPassedBy(before: readonly PlacedItem[], after: readonly PlacedItem[]): string | null {
  const count = (items: readonly PlacedItem[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.catalogueItemId, (counts.get(item.catalogueItemId) ?? 0) + 1);
    return counts;
  };
  const was = count(before);
  for (const [catalogueItemId, now] of count(after)) {
    if (now <= (was.get(catalogueItemId) ?? 0)) continue;
    // One fewer than there would be is already at the cap: the last one passes it.
    const atCap = capReachedFor(catalogueItemId, Array.from({ length: now - 1 }, () => catalogueItemId));
    if (atCap !== null) return atCap;
  }
  return null;
}

/** New tables take the lowest free numbers (Q-46), behind tableNumbers. */
function numberNew(placedItems: readonly PlacedItem[], pieces: readonly PlacedItem[]): readonly PlacedItem[] {
  return plannerFeatureEnabled("tableNumbers") ? withTableNumbers(placedItems, pieces) : pieces;
}

/** A table placed before numbering is numbered the first time it is moved or its seats change (Q-46). */
function numberEdited(items: readonly PlacedItem[], editedIds: ReadonlySet<string>): readonly PlacedItem[] {
  if (!plannerFeatureEnabled("tableNumbers")) return items;
  const edited = items.filter((item) => editedIds.has(item.id));
  const numbered = withTableNumbers(items.filter((item) => !editedIds.has(item.id)), edited);
  if (numbered === edited) return items;
  const byId = new Map(numbered.map((item) => [item.id, item]));
  return items.map((item) => byId.get(item.id) ?? item);
}

export const usePlacementStore = create<PlacementState>()((set, get) => ({
  placedItems: [],
  ghostPosition: null,
  ghostRotation: 0,
  ghostValid: false,
  ghostInvalidReason: null,
  snapEnabled: true,

  placeItem: (catalogueItemId: string, x: number, z: number, rotationY: number = 0) => {
    if (isLayoutTimelineMutationLocked()) return;
    // Cloths and place settings are contextual tools applied by
    // PlacementGhost. They are not physical catalogue objects and must never
    // be persisted as standalone PlacedItems through this lower-level API.
    if (isTableDressingApplicator(catalogueItemId)) return;
    const state = get();
    // Enforce inventory limits, and say why nothing was placed.
    const atCap = capReachedFor(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId));
    if (atCap !== null) {
      postPlacementNotice(atCap);
      return;
    }
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
    const surfaceY = candidateSurfaceHeight(
      catalogueItemId,
      finalX,
      finalZ,
      state.placedItems,
      new Set(),
    );
    const [item] = numberNew(state.placedItems, [createPlacedItem(catalogueItemId, finalX, finalZ, rotationY, null, surfaceY)]);
    if (item === undefined) return;
    set({ placedItems: [...state.placedItems, item] });
    announcePlaced([item.id]);
  },

  placeChairBrush: (
    catalogueItemId: string,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    rotationY: number = 0,
  ) => {
    if (isLayoutTimelineMutationLocked()) return [];
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
      const surfaceY = candidateSurfaceHeight(
        catalogueItemId,
        point.x,
        point.z,
        state.placedItems,
        new Set(),
      );
      return createPlacedItem(catalogueItemId, point.x, point.z, point.rotationY, null, surfaceY);
    });
    if (newItems.length === 0) return [];
    set({ placedItems: [...state.placedItems, ...newItems] });
    const ids = newItems.map((item) => item.id);
    announcePlaced(ids);
    return ids;
  },

  removeItem: (id: string) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    set({ placedItems: state.placedItems.filter((item) => item.id !== id) });
  },

  removeItems: (ids: ReadonlySet<string>) => {
    if (isLayoutTimelineMutationLocked()) return;
    if (ids.size === 0) return;
    const state = get();
    const allIds = expandIdsToGroupMembers(ids, state.placedItems);
    set({ placedItems: state.placedItems.filter((item) => !allIds.has(item.id)) });
  },

  moveItem: (id: string, x: number, z: number) => {
    if (isLayoutTimelineMutationLocked()) return;
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
        const edgeSnap = snapToPlatformEdge(
          finalX,
          finalZ,
          catItem,
          movingItem.rotationY,
          state.placedItems,
          new Set([id]),
          movingItem.scale,
        );
        finalX = edgeSnap.x;
        finalZ = edgeSnap.z;
        const wallSnap = snapToWallEdge(
          finalX,
          finalZ,
          catItem,
          movingItem.rotationY,
          roomDims,
          movingItem.scale,
          movingItem.groupId === null ? undefined : tableGroupChairFootprint(movingItem, state.placedItems, false),
        );
        finalX = wallSnap.x;
        finalZ = wallSnap.z;
      }
    }
    const surfaceY = movingItem === undefined
      ? 0
      : candidateSurfaceHeight(
          movingItem.catalogueItemId,
          finalX,
          finalZ,
          state.placedItems,
          new Set([id]),
        );
    set({
      placedItems: numberEdited(state.placedItems.map((item) =>
        item.id === id ? { ...item, x: finalX, z: finalZ, y: surfaceY } : item,
      ), new Set([id])),
    });
  },

  rotateItem: (id: string, rotationY: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    set({
      placedItems: numberEdited(state.placedItems.map((item) =>
        item.id === id ? { ...item, rotationY } : item,
      ), new Set([id])),
    });
  },

  // One set() per gesture frame for the whole selection — N items must never
  // cost N React batches (the lesson the Q/E rotation path already encodes).
  rotateItemsTo: (rotations: ReadonlyMap<string, number>) => {
    if (rotations.size === 0) return;
    const state = get();
    set({
      placedItems: numberEdited(state.placedItems.map((item) => {
        const rotationY = rotations.get(item.id);
        return rotationY === undefined ? item : { ...item, rotationY };
      }), new Set(rotations.keys())),
    });
  },

  scaleItemsTo: (scales: ReadonlyMap<string, number>) => {
    if (scales.size === 0) return;
    const state = get();
    set({
      placedItems: numberEdited(state.placedItems.map((item) => {
        const scale = scales.get(item.id);
        return scale === undefined ? item : { ...item, scale };
      }), new Set(scales.keys())),
    });
  },

  updateGhost: (x: number, z: number, catalogueItemId: string) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    const rot = state.ghostRotation;
    const gridPos = state.snapEnabled ? snapPositionToGrid(x, z) : [x, 0, z] as const;
    const catalogueItem = getCatalogueItem(catalogueItemId);
    // Edge snap + wall snap first (XZ only), then compute surface height
    let finalX = gridPos[0];
    let finalZ = gridPos[2];
    const roomDims = useRoomDimensionsStore.getState().dimensions;
    // A card's whole set (setupCards) takes the grid only: the edge, wall and line snaps are one
    // piece's, and would pull the set's chairs through a wall. The truthful ghost pushes the set clear.
    const card = plannerFeatureEnabled("setupCards") ? useCatalogueStore.getState().cardParams : null;
    const wholeSet = card !== null && cardIsWholeSet(card);
    if (catalogueItem !== undefined && !wholeSet) {
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
    const surfaceY = catalogueItem === undefined
      ? 0
      : computeSurfaceHeight(finalX, finalZ, catalogueItem, state.placedItems, new Set());
    const pos = [finalX, surfaceY, finalZ] as const;
    let valid = true;
    let reason: string | null = null;
    if (catalogueItem === undefined) {
      valid = false;
      reason = "Unknown catalogue item";
    } else if (isAtMaxCount(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId))) {
      valid = false;
      reason = capReachedLine(catalogueItem.maxCount ?? 0);
    } else {
      const violations = getPlacementViolations(pos[0], pos[2], catalogueItem, rot, state.placedItems, new Set(), surfaceY, roomDims);
      if (violations.length > 0) {
        valid = false;
        reason = violations[0]?.message ?? "Constraint warning";
      }
    }
    // A pointer moving within a grid cell snaps to the ghost's own spot: no write, no frame of work for its readers.
    const current = state.ghostPosition;
    if (current !== null && current[0] === pos[0] && current[1] === pos[1] && current[2] === pos[2]
      && state.ghostValid === valid && state.ghostInvalidReason === reason) return;
    set({ ghostPosition: pos, ghostValid: valid, ghostInvalidReason: reason });
  },

  rotateGhost: (delta: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    set((state) => ({ ghostRotation: state.ghostRotation + delta }));
  },

  clearGhost: () => {
    if (isLayoutTimelineMutationLocked()) return;
    set({ ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null });
  },

  toggleCloth: (id: string) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    const target = state.placedItems.find((item) => item.id === id);
    if (target === undefined) return;
    const catalogueItem = getCatalogueItem(target.catalogueItemId);
    if (catalogueItem === undefined || !canApplyTableLinenToItem(catalogueItem)) return;
    set({
      placedItems: numberEdited(state.placedItems.map((item) =>
        item.id === id
          ? {
              ...item,
              clothed: !item.clothed,
              clothStyle: item.clothed ? null : "black",
            }
          : item,
      ), new Set([id])),
    });
  },

  applyTableCloth: (ids, style) => {
    if (isLayoutTimelineMutationLocked()) return;
    if (ids.size === 0) return;
    const state = get();
    const targetIds = new Set<string>();
    for (const item of state.placedItems) {
      if (!ids.has(item.id)) continue;
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem === undefined || !canApplyTableLinenToItem(catalogueItem)) continue;
      if (item.clothed && item.clothStyle === style) continue;
      targetIds.add(item.id);
    }
    if (targetIds.size === 0) return;
    const placedItems = state.placedItems.map((item) => {
      if (!targetIds.has(item.id)) return item;
      return { ...item, clothed: true, clothStyle: style };
    });
    set({ placedItems: numberEdited(placedItems, targetIds) });
  },

  applyTableSetting: (ids, setting) => {
    if (isLayoutTimelineMutationLocked()) return;
    if (ids.size === 0) return;
    const state = get();
    const targetIds = new Set<string>();
    for (const item of state.placedItems) {
      if (!ids.has(item.id)) continue;
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem === undefined || !isDiningTableItem(catalogueItem)) continue;
      if (item.tableSetting === setting) continue;
      targetIds.add(item.id);
    }
    if (targetIds.size === 0) return;
    const placedItems = state.placedItems.map((item) => {
      if (!targetIds.has(item.id)) return item;
      return { ...item, tableSetting: setting };
    });
    set({ placedItems: numberEdited(placedItems, targetIds) });
  },

  clearTableSetting: (id: string) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    const target = state.placedItems.find((item) => item.id === id);
    if (target === undefined || target.tableSetting === null) return;
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, tableSetting: null } : item,
      ),
    });
  },

  setItemLabel: (id: string, label: string) => {
    if (isLayoutTimelineMutationLocked()) return;
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
    if (isLayoutTimelineMutationLocked()) return;
    set({ snapEnabled: !get().snapEnabled });
  },

  clearAll: () => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    if (state.placedItems.length === 0) return;
    set({ placedItems: [], ghostPosition: null, ghostValid: false, ghostInvalidReason: null });
  },

  placeTableGroup: (catalogueItemId: string, x: number, z: number, rotationY: number, chairCount: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    if (isTableDressingApplicator(catalogueItemId)) return;
    const state = get();
    const atCap = capReachedFor(catalogueItemId, state.placedItems.map((p) => p.catalogueItemId));
    if (atCap !== null) {
      postPlacementNotice(atCap);
      return;
    }
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
    const surfaceY = candidateSurfaceHeight(
      catalogueItemId,
      finalX,
      finalZ,
      state.placedItems,
      new Set(),
    );
    const group = createTableGroup(catalogueItemId, finalX, finalZ, rotationY, chairCount, surfaceY);
    if (group.length === 0) return;
    // Recompute individual surface heights for each chair — chairs off the
    // platform edge should sit at floor level, not float at platform height.
    const adjusted = group.map((item) => {
      const chairY = candidateSurfaceHeight(
        item.catalogueItemId,
        item.x,
        item.z,
        state.placedItems,
        new Set(),
      );
      return chairY !== item.y ? { ...item, y: chairY } : item;
    });
    const numbered = numberNew(state.placedItems, adjusted);
    set({ placedItems: [...state.placedItems, ...numbered] });
    announcePlaced(numbered.map((item) => item.id));
  },

  placeSetup: (pieces: readonly PlacedItem[]) => {
    if (isLayoutTimelineMutationLocked() || pieces.length === 0) return [];
    const state = get();
    // The venue's caps, for every kind of piece the set holds.
    const counted = state.placedItems.map((p) => p.catalogueItemId);
    for (const piece of pieces) {
      const atCap = capReachedFor(piece.catalogueItemId, counted);
      if (atCap !== null) {
        postPlacementNotice(atCap);
        return [];
      }
      counted.push(piece.catalogueItemId);
    }
    // As they stand: a card's set comes settled where it was judged (lib/place-in-hand), a copy at its original's heights.
    const numbered = numberNew(state.placedItems, pieces);
    set({ placedItems: [...state.placedItems, ...numbered] });
    const ids = numbered.map((piece) => piece.id);
    announcePlaced(ids);
    return ids;
  },

  applyEdit: ({ removeIds = new Set<string>(), add }) => {
    if (isLayoutTimelineMutationLocked() || (removeIds.size === 0 && add.length === 0)) return [];
    const state = get();
    const kept = state.placedItems.filter((piece) => !removeIds.has(piece.id));
    const keptIds = new Set(kept.map((piece) => piece.id));
    const changes = new Map(add.filter((piece) => keptIds.has(piece.id)).map((piece) => [piece.id, piece]));
    const joining = add.filter((piece) => !keptIds.has(piece.id));
    const changed = kept.map((piece) => changes.get(piece.id) ?? piece);
    const atCap = capPassedBy(state.placedItems, [...changed, ...joining]);
    if (atCap !== null) {
      postPlacementNotice(atCap);
      return [];
    }
    const edited = numberEdited(changed, new Set(changes.keys()));
    const numbered = numberNew(edited, joining);
    set({ placedItems: [...edited, ...numbered] });
    announcePlaced(numbered.map((piece) => piece.id));
    return [...changes.keys(), ...numbered.map((piece) => piece.id)];
  },

  resizeArea: (groupId: string, cols: number, rows: number, anchor?: ResizeAnchor) => {
    if (isLayoutTimelineMutationLocked()) return false;
    const state = get();
    const panels = state.placedItems.filter((piece) => piece.groupId === groupId);
    const side = (n: number): number => Math.min(DANCE_FLOOR_PANELS.max, Math.max(DANCE_FLOOR_PANELS.min, Math.round(n)));
    const resized = resizeDanceFloor(panels, side(cols), side(rows), anchor);
    if (resized === null) return false;
    if (resized.length === panels.length && resized.every((piece) => panels.includes(piece))) return false;
    const kept = new Set(panels.map((piece) => piece.id));
    const added = resized.filter((piece) => !kept.has(piece.id));
    // The venue's cap for each panel added, counted against everything that stays.
    const counted = [
      ...state.placedItems.filter((piece) => piece.groupId !== groupId),
      ...resized.filter((piece) => kept.has(piece.id)),
    ].map((piece) => piece.catalogueItemId);
    for (const piece of added) {
      const atCap = capReachedFor(piece.catalogueItemId, counted);
      if (atCap !== null) {
        postPlacementNotice(atCap);
        return false;
      }
      counted.push(piece.catalogueItemId);
    }
    // A floor grown through a wall or into a piece is refused with the ghost's reason, never moved (Q-05).
    const others = state.placedItems.filter((piece) => piece.groupId !== groupId);
    const verdict = judgeGhost(resized, createGhostWorld(others, useRoomDimensionsStore.getState().dimensions));
    if (verdict.state !== "fits") {
      postPlacementNotice(refusalChip(verdict.obstacle));
      return false;
    }
    set({ placedItems: [...state.placedItems.filter((piece) => piece.groupId !== groupId), ...resized] });
    announcePlaced(added.map((piece) => piece.id));
    return true;
  },

  rearrangeGroup: (tableId: string, newChairCount: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    const newItems = rearrangeTableGroup(tableId, newChairCount, state.placedItems);
    // Recompute individual surface heights for rearranged chairs
    const adjusted = newItems.map((item) => {
      if (!isSceneFurniturePlacement(item)) return item;
      const surfaceY = candidateSurfaceHeight(
        item.catalogueItemId,
        item.x,
        item.z,
        newItems,
        new Set([item.id]),
      );
      return surfaceY !== item.y ? { ...item, y: surfaceY } : item;
    });
    set({ placedItems: numberEdited(adjusted, new Set([tableId])) });
  },

  autoArrangeBanquet: (catalogueItemId: string, targetGuests: number, chairsPerTable: number) => {
    if (isLayoutTimelineMutationLocked()) return null;
    const tableItem = getCatalogueItem(catalogueItemId);
    if (tableItem === undefined || !isDiningTableItem(tableItem)) return null;
    const state = get();

    const dims = useRoomDimensionsStore.getState().dimensions;
    // Room dimensions are render-space; the plan works in metres. Spacing runs
    // between the backs of the chairs (lib/auto-fill).
    const plan = planBanquetFill(tableItem, targetGuests, chairsPerTable, toRealWorld(dims.width), toRealWorld(dims.length));
    if (plan === null) return null;

    // Map each planned table (metres, room-centred) back to render space and
    // build a full table+chairs group at floor level.
    const placedItems: PlacedItem[] = [];
    for (const t of plan.tables) {
      const group = createTableGroup(
        catalogueItemId,
        toRenderSpace(t.xM),
        toRenderSpace(t.zM),
        t.rotationY,
        plan.seatsPerTable,
      );
      placedItems.push(...group);
    }
    if (placedItems.length === 0) return null;

    const retainedApplicators = state.placedItems.filter(
      (item) => !isSceneFurniturePlacement(item),
    );
    const numbered = numberNew(retainedApplicators, placedItems);
    set({ placedItems: [...retainedApplicators, ...numbered] });
    announcePlaced(numbered.map((item) => item.id));
    return plan;
  },

  autoArrangeTheatre: (chairItemId: string, targetGuests: number) => {
    if (isLayoutTimelineMutationLocked()) return null;
    const chairItem = getCatalogueItem(chairItemId);
    if (chairItem === undefined || chairItem.category !== "chair") return null;

    const dims = useRoomDimensionsStore.getState().dimensions;
    // Room dimensions are render-space; the plan works in metres.
    const plan = planTheatreFill(chairItem, targetGuests, toRealWorld(dims.width), toRealWorld(dims.length));
    if (plan === null) return null;

    // Each planned seat (metres, room-centred, facing the stage) → a floor-level
    // chair in render space. No groups — theatre chairs stand alone.
    const placedItems = plan.seats.map((s) =>
      createPlacedItem(chairItemId, toRenderSpace(s.xM), toRenderSpace(s.zM), s.rotationY, null, 0),
    );
    const retainedApplicators = get().placedItems.filter(
      (item) => !isSceneFurniturePlacement(item),
    );
    set({ placedItems: [...retainedApplicators, ...placedItems] });
    announcePlaced(placedItems.map((item) => item.id));
    return plan;
  },

  fillSeatShortfall: (guests: number) => {
    if (isLayoutTimelineMutationLocked()) return null;
    const dims = useRoomDimensionsStore.getState().dimensions;
    const fix = applySeatShortfallFix({
      placedItems: get().placedItems,
      guests,
      roomWidthM: toRealWorld(dims.width),
      roomLengthM: toRealWorld(dims.length),
    });
    if (fix === null) return null;
    // One write, so the editor history records one step and one undo takes it back.
    set({ placedItems: [...fix.placedItems] });
    announcePlaced(fix.addedIds);
    return fix;
  },

  breakFromGroup: (id: string) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    set({
      placedItems: state.placedItems.map((item) =>
        item.id === id ? { ...item, groupId: null } : item,
      ),
    });
  },

  moveGroup: (itemId: string, dx: number, dz: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    const state = get();
    const memberIds = getGroupMemberIds(itemId, state.placedItems);
    set({
      placedItems: numberEdited(state.placedItems.map((item) => {
        if (!memberIds.has(item.id)) return item;
        const newX = item.x + dx;
        const newZ = item.z + dz;
        const surfaceY = candidateSurfaceHeight(
          item.catalogueItemId,
          newX,
          newZ,
          state.placedItems,
          memberIds,
        );
        return { ...item, x: newX, z: newZ, y: surfaceY };
      }), memberIds),
    });
  },

  moveItemsByDelta: (ids: ReadonlySet<string>, dx: number, dz: number) => {
    if (isLayoutTimelineMutationLocked()) return;
    if (ids.size === 0) return;
    const state = get();
    // Moving items can only land on items that stay put. Filtering those once
    // keeps a large multi-item drag linear instead of rescanning the whole
    // layout for every moving item (30 ms per pointer move at 1,287 items).
    const stationary = state.placedItems.filter((item) => !ids.has(item.id));
    set({
      placedItems: numberEdited(state.placedItems.map((item) => {
        if (!ids.has(item.id)) return item;
        const newX = item.x + dx;
        const newZ = item.z + dz;
        const surfaceY = candidateSurfaceHeight(
          item.catalogueItemId,
          newX,
          newZ,
          stationary,
          ids,
        );
        return { ...item, x: newX, z: newZ, y: surfaceY };
      }), ids),
    });
  },

  groupItems: (ids: ReadonlySet<string>) => {
    if (isLayoutTimelineMutationLocked()) return;
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
    if (isLayoutTimelineMutationLocked()) return;
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
