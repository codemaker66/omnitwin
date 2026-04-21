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
//
// **Why the `syncing` ref:** the two effects below are mutually triggering
// — editor-store updates push into placement-store, and the placement-store
// subscription pushes the result back into editor-store. Without a guard,
// every commit would bounce between them indefinitely. The ref is set
// synchronously before each push and cleared synchronously after, so any
// store emission that arrives mid-push is recognised as a self-echo and
// ignored. `itemsMatch` is a secondary guard so a benign no-op write
// doesn't trigger an unnecessary auto-save schedule.
//
// **Concurrency model — single-instance assumption.** EditorBridge is
// designed to be mounted exactly once. The `syncing` ref lives on a
// component instance, so a second mounted instance would have its own
// ref and the cross-instance feedback loop would not be guarded. To make
// that regression loud rather than silent, we assert mount uniqueness
// at mount time via a module-level counter — a misconfigured second
// mount throws synchronously instead of producing mysterious sync drift.
//
// **Ordering between the two effects.** The placement→editor effect
// uses `usePlacementStore.subscribe`, which fires synchronously inside
// the placement-store mutation. The editor→placement effect uses
// React's `useEffect`, which fires after commit. So:
//   - placement mutation → subscribe handler → editor-store write →
//     React reconciles → editor→placement effect runs → itemsMatch
//     short-circuits because the placement-store already matches.
//   - editor mutation → React reconciles → editor→placement effect →
//     placement-store write → subscribe handler runs → syncing=true
//     short-circuits.
// Both paths converge to a steady state in one round-trip.
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
    notes: existing?.notes ?? "",
  };
}

/** Check if two placed-item arrays have the same state across all mutable fields. */
function itemsMatch(a: readonly PlacedItem[], b: readonly EditorObject[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const eb = b[i];
    if (pa === undefined || eb === undefined) return false;
    if (pa.id !== eb.id) return false;
    if (pa.x !== eb.positionX || pa.y !== eb.positionY || pa.z !== eb.positionZ) return false;
    if (pa.rotationY !== eb.rotationY) return false;
    if (pa.clothed !== eb.clothed) return false;
    if (pa.groupId !== eb.groupId) return false;
  }
  return true;
}

// Module-level mount counter — see the concurrency-model comment above.
// React StrictMode mounts every component twice in development; the
// second mount runs cleanup before the second mount-effect, so the
// steady-state count is still 1. We only flag when the count exceeds 1
// AFTER a real mount cycle.
let mountedInstances = 0;

/** Test-only: reset the counter between tests so each renders cleanly. */
export function __resetEditorBridgeMountCountForTests(): void {
  mountedInstances = 0;
}

/**
 * EditorBridge component — renders nothing, just syncs stores.
 * Mount this inside the EditorPage, outside the Canvas.
 *
 * Singleton: mount exactly one instance per page. A second concurrent
 * instance throws because the syncing ref is per-instance and a second
 * mount would silently drop sync events.
 */
export function EditorBridge(): null {
  const editorObjects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);
  const authState = useAuthStore((s) => s.isAuthenticated);
  const isAuthenticated = useRef(authState);

  useEffect(() => {
    mountedInstances += 1;
    if (mountedInstances > 1) {
      // Don't throw — that would white-screen the editor on a dev mistake.
      // Loud-warn instead so the regression is obvious in any console
      // (browser dev tools, server-side log, CI test output) without
      // taking the user offline.
      // eslint-disable-next-line no-console
      console.error(
        "VenViewer: EditorBridge mounted more than once (" + String(mountedInstances) + " instances). " +
        "The bridge owns the editor↔placement sync ref; a second instance silently " +
        "loses cross-instance updates. Move EditorBridge to a single mount point " +
        "(typically EditorPage).",
      );
    }
    return () => { mountedInstances = Math.max(0, mountedInstances - 1); };
  }, []);

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

  // --- Cleanup: cancel pending auto-save on unmount to prevent timer leaks (F26) ---
  useEffect(() => {
    return () => {
      if (bridgeSaveTimer !== null) {
        clearTimeout(bridgeSaveTimer);
        bridgeSaveTimer = null;
      }
    };
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

/**
 * Cancel the pending auto-save debounce timer and immediately flush any
 * dirty state to the server. Punch list #32: called by SaveSendPanel before
 * opening the enquiry modal so the venue receives the latest layout, not a
 * 3-second-stale one.
 *
 * Returns a promise that resolves when the save completes (or immediately
 * if nothing is dirty).
 */
export async function flushAutoSave(): Promise<void> {
  if (bridgeSaveTimer !== null) {
    clearTimeout(bridgeSaveTimer);
    bridgeSaveTimer = null;
  }
  const state = useEditorStore.getState();
  if (state.isDirty && !state.isSaving && state.configId !== null) {
    await state.saveToServer(useAuthStore.getState().isAuthenticated);
  }
}
