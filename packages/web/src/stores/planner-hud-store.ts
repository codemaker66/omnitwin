import { create } from "zustand";
import type { JourneyStepId } from "../lib/hud/journey.js";
import { useEditorStore } from "./editor-store.js";

// ---------------------------------------------------------------------------
// The planner HUD's own state (docs/superpowers/specs/2026-11-13-planner-hud-design.md):
// which sheet is open (one at a time) and which layout has gone to the events
// team from this screen. Everything about the layout itself stays in the
// planner's existing stores.
// ---------------------------------------------------------------------------

/** A journey step's sheet, the whole catalogue, or the view station's further tools. */
export type HudSheet = JourneyStepId | "more" | "tools";

interface PlannerHudState {
  readonly sheet: HudSheet | null;
  /**
   * The layout that went to the events team from this screen, by its id. Kept
   * by id, not as a yes or no, so another layout opened on the same page is
   * not called sent because that one was (usePlanSent).
   */
  readonly sentLayoutId: string | null;
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
  sentLayoutId: null,
  firstOpenDone: false,
  finishFirstOpen: () => { if (!get().firstOpenDone) set({ firstOpenDone: true }); },
  openSheet: (sheet) => { set({ sheet }); },
  toggleSheet: (sheet) => { set({ sheet: get().sheet === sheet ? null : sheet }); },
  closeSheet: () => { if (get().sheet !== null) set({ sheet: null }); },
  markSent: (layoutId) => { set({ sentLayoutId: layoutId }); },
}));

/** Whether the layout on screen is the one that went to the events team from here. */
export function usePlanSent(): boolean {
  const layoutId = useEditorStore((state) => state.configId);
  return usePlannerHudStore((state) => state.sentLayoutId !== null && state.sentLayoutId === layoutId);
}
