import { create } from "zustand";
import type { JourneyStepId } from "../lib/hud/journey.js";

// ---------------------------------------------------------------------------
// The planner HUD's own state (docs/superpowers/specs/2026-11-13-planner-hud-design.md):
// which sheet is open (one at a time) and whether this plan has been sent.
// Everything about the layout itself stays in the planner's existing stores.
// ---------------------------------------------------------------------------

/** A journey step's sheet, the whole catalogue, or the view station's further tools. */
export type HudSheet = JourneyStepId | "more" | "tools";

interface PlannerHudState {
  readonly sheet: HudSheet | null;
  /** The plan went to the events team from this screen. */
  readonly sent: boolean;
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
  readonly markSent: () => void;
  /** A new layout: nothing open, nothing sent. */
  readonly reset: () => void;
}

export const usePlannerHudStore = create<PlannerHudState>()((set, get) => ({
  sheet: null,
  sent: false,
  firstOpenDone: false,
  finishFirstOpen: () => { if (!get().firstOpenDone) set({ firstOpenDone: true }); },
  openSheet: (sheet) => { set({ sheet }); },
  toggleSheet: (sheet) => { set({ sheet: get().sheet === sheet ? null : sheet }); },
  closeSheet: () => { if (get().sheet !== null) set({ sheet: null }); },
  markSent: () => { set({ sent: true }); },
  reset: () => { set({ sheet: null, sent: false }); },
}));
