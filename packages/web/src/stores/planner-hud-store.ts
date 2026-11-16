import { create } from "zustand";
import type { JourneyStepId } from "../lib/hud/journey.js";
import { useEditorStore } from "./editor-store.js";

// ---------------------------------------------------------------------------
// The planner HUD's own state (docs/superpowers/specs/2026-11-13-planner-hud-design.md):
// which sheet is open (one at a time) and which layouts have gone to the events
// team from this screen. Everything about the layout itself stays in the
// planner's existing stores.
// ---------------------------------------------------------------------------

/** A journey step's sheet, the whole catalogue, or the view station's further tools. */
export type HudSheet = JourneyStepId | "more" | "tools";

/**
 * Where this device remembers which layouts it has sent. Without it, a page
 * opened again says "Send to the events team" for a plan that has already
 * gone, and invites a second enquiry. Ids only: nothing of the enquiry itself.
 */
export const HUD_SENT_STORAGE_KEY = "venviewer.hud-sent-layouts.v1";
/** As many as are remembered; the newest are kept. */
export const HUD_SENT_REMEMBERED = 24;

function readSent(): readonly string[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(HUD_SENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(kept)) return [];
    return kept.filter((id): id is string => typeof id === "string" && id !== "").slice(-HUD_SENT_REMEMBERED);
  } catch {
    // No storage, or not a list: nothing is remembered, and the screen works as it did before.
    return [];
  }
}

function writeSent(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(HUD_SENT_STORAGE_KEY, JSON.stringify(ids));
  } catch { /* remembering is a convenience */ }
}

interface PlannerHudState {
  readonly sheet: HudSheet | null;
  /**
   * The layouts that went to the events team from this device, by their ids,
   * oldest first. Kept by id, not as a yes or no, so another layout opened on
   * the same page is not called sent because that one was (usePlanSent).
   */
  readonly sentLayoutIds: readonly string[];
  /**
   * The first screen ("What are you planning?") has been answered or put
   * aside. Kept for the page, not the layout: once someone has said "an empty
   * hall", a new layout does not ask again until the page is opened afresh.
   */
  readonly firstOpenDone: boolean;
  readonly finishFirstOpen: () => void;
  readonly openSheet: (sheet: HudSheet) => void;
  /** The same sheet again closes it; another replaces it. */
  readonly toggleSheet: (sheet: HudSheet) => void;
  readonly closeSheet: () => void;
  /** The events team has this layout: said only once an enquiry for it has arrived. */
  readonly markSent: (layoutId: string) => void;
}

export const usePlannerHudStore = create<PlannerHudState>()((set, get) => ({
  sheet: null,
  sentLayoutIds: readSent(),
  firstOpenDone: false,
  finishFirstOpen: () => { if (!get().firstOpenDone) set({ firstOpenDone: true }); },
  openSheet: (sheet) => { set({ sheet }); },
  toggleSheet: (sheet) => { set({ sheet: get().sheet === sheet ? null : sheet }); },
  closeSheet: () => { if (get().sheet !== null) set({ sheet: null }); },
  markSent: (layoutId) => {
    if (layoutId === "") return;
    // The device's list is read afresh, so a layout sent from another tab meanwhile is kept by this one's write.
    const others = new Set([...readSent(), ...get().sentLayoutIds].filter((id) => id !== layoutId));
    const next = [...others, layoutId].slice(-HUD_SENT_REMEMBERED);
    writeSent(next);
    set({ sentLayoutIds: next });
  },
}));

/** Whether the layout on screen is one that went to the events team from this device. */
export function usePlanSent(): boolean {
  const layoutId = useEditorStore((state) => state.configId);
  return usePlannerHudStore((state) => layoutId !== null && state.sentLayoutIds.includes(layoutId));
}
