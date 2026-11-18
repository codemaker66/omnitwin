import { captionModel, type CaptionModel } from "../../lib/caption-model.js";
import { plannerFeatureEnabled } from "../../lib/planner-features.js";
import { KEY_PRIORITY, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// Put back in store (card-dock spec §8). Removing a piece says so above the
// dock, with Undo, whether the caption's Remove did it or Delete, so the key
// and the button never disagree. The planner's own Delete and Backspace
// (lib/planner-keymap) do the removing, with their gesture cancel; this layer
// sits just above them, notes what is about to go, hands the key on, and
// says so once it has gone. When nothing went (a previewed act holds the
// layout), nothing is said.
// ---------------------------------------------------------------------------

/** The receipt: "Table 8 put back in store". */
export function putBackWords(model: Pick<CaptionModel, "label" | "name">): string {
  return `${model.label ?? model.name} put back in store`;
}

export function postPutBack(model: Pick<CaptionModel, "label" | "name">): void {
  usePlannerChromeStore.getState().postReceipt(putBackWords(model), { undo: true });
}

const PUT_BACK_KEYS: readonly KeyBinding[] = [{
  keys: [{ code: "Delete" }, { code: "Backspace" }],
  // Just above the selection's own Delete, which always does the removing.
  priority: KEY_PRIORITY.selection + 1,
  when: () => useSelectionStore.getState().selectedIds.size > 0,
  run: () => {
    const ids = new Set(useSelectionStore.getState().selectedIds);
    const model = captionModel(ids, usePlacementStore.getState().placedItems, plannerFeatureEnabled);
    if (model !== null) {
      // The planner's Delete runs as soon as this hands the key on; by the next microtask it is done.
      queueMicrotask(() => {
        if (!usePlacementStore.getState().placedItems.some((piece) => ids.has(piece.id))) postPutBack(model);
      });
    }
    return false;
  },
}];

/** Mount once, with the caption. */
export function usePutBackKeys(): void {
  usePlannerKeyBindings(PUT_BACK_KEYS);
}
