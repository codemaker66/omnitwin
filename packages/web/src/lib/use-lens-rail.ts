import { useLayoutEffect } from "react";
import { useAuthStore } from "../stores/auth-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import type { CockpitMode } from "./cockpit-modes.js";
import { lensesFor, shownLens, type LensRail } from "./cockpit-lenses.js";
import { plannerFeatures } from "./planner-features.js";

/** The lens rail for whoever is viewing, as the auth store and the keys stand now. */
export function useLensRail(): LensRail {
  const keys = plannerFeatures();
  // Every rail is a constant, so the selector's answer is stable until it changes.
  return useAuthStore((auth) => lensesFor(auth, keys));
}

/** The lens the cockpit shows: the active one if this viewer's rail offers it, else Design. */
export function useShownLens(): CockpitMode {
  const lensRail = useLensRail();
  const active = useCockpitStore((state) => state.activeMode);
  return shownLens(active, lensRail);
}

/**
 * Mount once, in the cockpit. Tells the store which lenses this viewer may
 * open, so `setMode` refuses the rest from any caller (a shortcut, the phone's
 * More sheet), and an active lens the viewer can no longer see goes back to
 * Design in the same commit, before the browser paints.
 */
export function useOfferViewerLenses(): void {
  const lensRail = useLensRail();
  useLayoutEffect(() => {
    useCockpitStore.getState().offerModes(lensRail.modes);
  }, [lensRail]);
}
