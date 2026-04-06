import { useEffect, useRef } from "react";
import { useEditorStore, type EditorObject } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
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
function editorToPlaced(obj: EditorObject): PlacedItem {
  return {
    id: obj.id,
    catalogueItemId: obj.assetDefinitionId,
    x: obj.positionX,
    y: obj.positionY,
    z: obj.positionZ,
    rotationY: obj.rotationY,
    clothed: false,
    groupId: null,
  };
}

/**
 * Convert a PlacedItem (from user interaction) to an EditorObject (for save).
 */
function placedToEditor(item: PlacedItem): EditorObject {
  return {
    id: item.id,
    assetDefinitionId: item.catalogueItemId,
    positionX: item.x,
    positionY: item.y,
    positionZ: item.z,
    rotationX: 0,
    rotationY: item.rotationY,
    rotationZ: 0,
    scale: 1,
    sortOrder: 0,
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
  const isAuthenticated = useRef(false);

  // Track whether we're currently pushing from editor→placement to avoid feedback loops
  const syncing = useRef(false);

  // --- Editor → Placement: when editor-store loads objects from backend ---
  useEffect(() => {
    if (syncing.current) return;
    syncing.current = true;

    const currentPlaced = usePlacementStore.getState().placedItems;
    if (!itemsMatch(currentPlaced, editorObjects)) {
      // Replace placement-store items with editor-store objects
      const newItems = editorObjects.map(editorToPlaced);
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
      const newEditorObjects = state.placedItems.map(placedToEditor);

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
