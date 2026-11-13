import { create } from "zustand";
import type { JourneyStepId } from "../lib/hud/journey.js";

// ---------------------------------------------------------------------------
// The planner HUD's own state (docs/superpowers/specs/2026-11-13-planner-hud-design.md):
// which sheet is open (one at a time), whether this plan has been sent, and
// the skin the screen wears. Everything about the layout itself stays in the
// planner's existing stores.
// ---------------------------------------------------------------------------

/** The looks the HUD can wear; Blake chooses the default from these (13 Nov 2026). */
export type HudSkin = "honours" | "gilded" | "lacquer" | "ivory" | "oculus";

export const HUD_SKINS: readonly HudSkin[] = ["honours", "gilded", "lacquer", "ivory", "oculus"];

export const HUD_SKIN_STORAGE_KEY = "venviewer.planner-hud-skin";

const DEFAULT_HUD_SKIN: HudSkin = "honours";

function isHudSkin(value: string | null): value is HudSkin {
  return HUD_SKINS.some((skin) => skin === value);
}

/** The skin this device asks for: `?skin=` (remembered here), else the last one chosen, else the default. */
export function hudSkinRequested(search: string): HudSkin {
  const asked = new URLSearchParams(search).get("skin");
  if (isHudSkin(asked)) {
    try { window.localStorage.setItem(HUD_SKIN_STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked;
  }
  try {
    const remembered = window.localStorage.getItem(HUD_SKIN_STORAGE_KEY);
    return isHudSkin(remembered) ? remembered : DEFAULT_HUD_SKIN;
  } catch {
    return DEFAULT_HUD_SKIN;
  }
}

/** A journey step's sheet, the whole catalogue, or the view station's further tools. */
export type HudSheet = JourneyStepId | "more" | "tools";

interface PlannerHudState {
  readonly sheet: HudSheet | null;
  /** The plan went to the events team from this screen. */
  readonly sent: boolean;
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
  openSheet: (sheet) => { set({ sheet }); },
  toggleSheet: (sheet) => { set({ sheet: get().sheet === sheet ? null : sheet }); },
  closeSheet: () => { if (get().sheet !== null) set({ sheet: null }); },
  markSent: () => { set({ sent: true }); },
  reset: () => { set({ sheet: null, sent: false }); },
}));
