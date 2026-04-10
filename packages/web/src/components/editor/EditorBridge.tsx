import { useEffect, useRef } from "react";
import { useEditorStore, type EditorObject } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import type { PlacedItem } from "../../lib/placement.js";

// ---------------------------------------------------------------------------
// EditorBridge — syncs editor-store ↔ placement-store bidirectionally
//
// Backend load → editor-store → placement-store (initial population)
// User interaction → placement-store → editor-store (for auto-save)
// ---------------------------------------------------------------------------

/**
 * Convert an EditorObject (from backend) to a PlacedItem (for the R3F scene).
 * The assetDefinitionId from the backend maps to catalogueItemId in the local
 * catalogue. For V1 we use the same string IDs.
 */
/**
 * Convert a local `EditorObject` (store state) to a `PlacedItem` (scene state).
 *
 * The placement system is the R3F scene's source of truth — it owns
 * clothed/groupId during interaction. Loading from the store populates
 * the scene; subsequent user interactions flow the other way.
 */
export function editorToPlacedItem(obj: EditorObject): PlacedItem {
  return {
    id: obj.id,
    catalogueItemId: obj.assetDefinitionId,
    x: obj.positionX,
    y: obj.positionY,
    z: obj.positionZ,
    rotationY: obj.rotationY,
    clothed: obj.clothed,
    groupId: obj.groupId,
  };
}

/**
 * Convert a PlacedItem (from user interaction) to an EditorObject (for save).
 *
 * Scene-only state (clothed, groupId) round-trips through here. The
 * placement system doesn't model rotationX/Z or scale (no tilted items, no
 * non-uniform scaling), so those flow through as zeros — when those features
 * land, this function is the place to thread them through.
 *
 * sortOrder is preserved by looking up the existing editor object so reload
 * doesn't scramble user-defined ordering. New items get sortOrder=0 here and
 * are assigned a real index by the editor store on first save.
 */
export function placedItemToEditor(item: PlacedItem, existing: EditorObject | undefined): EditorObject {
  return {
    id: item.id,
    assetDefinitionId: item.catalogueItemId,
    positionX: item.x,
    positionY: item.y,
    positionZ: item.z,
    rotationX: existing?.rotationX ?? 0,
    rotationY: item.rotationY,
    rotationZ: existing?.rotationZ ?? 0,
    scale: existing?.scale ?? 1,
    sortOrder: existing?.sortOrder ?? 0,
    clothed: item.clothed,
    groupId: item.groupId,
  };
}

/** Check if two placed-item arrays have the same IDs and positions. */
function itemsMatch(a: readonly PlacedItem[], b: readonly EditorObject[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const eb = b[i];
    if (pa === undefined || eb === undefined) return false;
    if (pa.id !== eb.id) return false;
    if (pa.x !== eb.positionX || pa.y !== eb.positionY || pa.z !== eb.positionZ) return false;
    if (pa.rotationY !== eb.rotationY) return false;
  }
  return true;
}

/**
 * EditorBridge component — renders nothing, just syncs stores.
 * Mount this inside the EditorPage, outside the Canvas.
 */
export function EditorBridge(): null {
  const editorObjects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);
  const authState = useAuthStore((s) => s.isAuthenticated);
  const isAuthenticated = useRef(authState);

  // Keep auth ref in sync so auto-save uses the correct endpoint
  useEffect(() => { isAuthenticated.current = authState; }, [authState]);

  // Track whether we're currently pushing from editor→placement to avoid feedback loops
  const syncing = useRef(false);

  // --- Editor → Placement: when editor-store loads objects from backend ---
  useEffect(() => {
    if (syncing.current) return;
    syncing.current = true;

    const currentPlaced = usePlacementStore.getState().placedItems;
    if (!itemsMatch(currentPlaced, editorObjects)) {
      // Replace placement-store items with editor-store objects
      const newItems = editorObjects.map(editorToPlacedItem);
      usePlacementStore.setState({ placedItems: newItems });
    }

    syncing.current = false;
  }, [editorObjects]);

  // --- Placement → Editor: subscribe to placement-store changes ---
  useEffect(() => {
    let prevItems = usePlacementStore.getState().placedItems;
    const unsub = usePlacementStore.subscribe((storeState) => {
      if (storeState.placedItems === prevItems) return;
      prevItems = storeState.placedItems;
      const state = { placedItems: storeState.placedItems };
      if (syncing.current || configId === null) return;
      syncing.current = true;

      const editorState = useEditorStore.getState();
      const existingById = new Map(editorState.objects.map((o) => [o.id, o]));
      const newEditorObjects = state.placedItems.map((item) => placedItemToEditor(item, existingById.get(item.id)));

      // Only update if actually different
      if (!itemsMatch(state.placedItems, editorState.objects)) {
        useEditorStore.setState({
          objects: newEditorObjects,
          isDirty: true,
        });

        // Schedule auto-save
        scheduleAutoSave(isAuthenticated.current);
      }

      syncing.current = false;
    });

    return unsub;
  }, [configId]);

  // --- Selection → Editor: sync selected IDs ---
  useEffect(() => {
    const unsub = useSelectionStore.subscribe((state) => {
      const selectedIds = state.selectedIds;
      const first = selectedIds.size > 0 ? Array.from(selectedIds)[0] : null;
      useEditorStore.setState({ selectedObjectId: first ?? null });
    });
    return unsub;
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// Auto-save debounce (separate from editor-store's internal one)
// ---------------------------------------------------------------------------

let bridgeSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave(isAuthenticated: boolean): void {
  if (bridgeSaveTimer !== null) clearTimeout(bridgeSaveTimer);
  bridgeSaveTimer = setTimeout(() => {
    const state = useEditorStore.getState();
    if (state.isDirty && !state.isSaving && state.configId !== null) {
      void state.saveToServer(isAuthenticated);
    }
  }, 3000);
}
