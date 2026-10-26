import { useMemo } from "react";
import { KEY_PRIORITY, letter, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// History's key (T-674 slice 15; spec 4.2, 11): H opens History in the left
// zone and H again closes it, through the one keyboard owner. The slate's
// menu item and holding Undo (lane C) call the same toggle.
// ---------------------------------------------------------------------------

/** Opens History in the left zone, or closes it when it is open there. */
export function toggleHistory(): void {
  const chrome = usePlannerChromeStore.getState();
  if (chrome.left === "history") chrome.close("left");
  else chrome.open("left", "history");
}

/** Binds H for as long as the chrome is mounted (History's panel may be shut). */
export function useHistoryKeys(): void {
  const bindings = useMemo((): KeyBinding[] => [
    { keys: letter("h"), priority: KEY_PRIORITY.planner, run: () => { toggleHistory(); } },
  ], []);
  usePlannerKeyBindings(bindings);
}
