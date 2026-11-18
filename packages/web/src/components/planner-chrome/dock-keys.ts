import { useMemo } from "react";
import { KEY_PRIORITY, letter, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHallViewStore, type HallViewPreset } from "../../stores/hall-view-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// The dock's own keys (T-671 slice 8′; card-dock spec §12, Blake's B7): Shift
// 1 · 2 · 3 move between Plan, Room and Walk (plain digits belong to the
// cards), and L opens or closes Lay out. Through the one keyboard owner.
// ---------------------------------------------------------------------------

export const VIEW_ORDER: readonly HallViewPreset[] = ["plan", "room", "walk"];

/** Moves to a view; Walk pressed again while walking stands up into Room. */
export function chooseView(view: HallViewPreset): void {
  const walking = useCockpitStore.getState().walkMode;
  useHallViewStore.getState().requestView(view === "walk" && walking ? "room" : view);
}

export function toggleLayOut(): void {
  const chrome = usePlannerChromeStore.getState();
  if (chrome.right === "lay-out") chrome.close("right");
  else chrome.open("right", "lay-out");
}

/** Binds the dock's keys while it is mounted; the views only where the room has them. */
export function useDockKeys(viewsReady: boolean): void {
  const bindings = useMemo((): KeyBinding[] => [
    ...VIEW_ORDER.map((view, index): KeyBinding => ({
      keys: [{ code: `Digit${String(index + 1)}`, shift: true }],
      priority: KEY_PRIORITY.planner,
      when: () => viewsReady,
      run: () => { chooseView(view); },
    })),
    { keys: letter("l"), priority: KEY_PRIORITY.planner, run: () => { toggleLayOut(); } },
  ], [viewsReady]);
  usePlannerKeyBindings(bindings);
}
