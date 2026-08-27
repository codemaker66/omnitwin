import { useEffect } from "react";
import { useDeviceStore } from "../../../stores/device-store.js";
import { prefersReducedMotion } from "../../../twin/reduced-motion.js";
import { googleTilesApiKey } from "./arrival-config.js";
import { useArrivalStore, type ArrivalFailReason } from "./arrival-store.js";

// -----------------------------------------------------------------------------
// useArrivalGate (Task 12) — Fallback armor's single pre-flight check.
//
// ArrivalHero calls this BEFORE the <Canvas> ever mounts. Two independent
// facts can block the flight outright:
//   - device tier "poster" (software rendering — spec's own bar for "do not
//     even attempt WebGL", classifyDevice's own doc comment on device-tier.ts)
//   - no Google Tiles API key configured
// Poster tier wins when both apply: a hardware ceiling is checked first,
// since it is the more fundamental reason the flight can never run here,
// whereas a missing key is a config gap that could be fixed independently.
//
// Reduced motion is NOT a third block. Spec §2 wants a reduced-motion visitor
// to still arrive at the Hall — just without the flight — so the ONLY thing
// this hook does for that preference is flip the arrival store's own
// `reducedMotion` flag, once, before GoogleTilesStage could possibly reach
// first-idle and call tilesReady() (arrival-store.ts's tilesReady() reads
// `st.reducedMotion` at that instant to decide loading -> flight vs loading
// -> arrived directly). Task 10's ExplodedHall already reads the SAME flag
// for its own instant-explode gate — this hook is the only place that ever
// WRITES it from a live OS preference.
//
// prefersReducedMotion() is read once, on mount, not subscribed to: the
// phase-machine decision it feeds happens once, early in the visit, and
// re-reading it later could not un-fly a flight already under way. Twin's
// own consumers of this helper (see reduced-motion.ts's header) re-read it
// per gesture because THEY gate ongoing interactions; this hook gates a
// single, early phase-machine fork instead.
// -----------------------------------------------------------------------------

export interface ArrivalGateResult {
  /** Non-null when the flight must never be attempted at all. */
  readonly blocked: ArrivalFailReason | null;
}

export function useArrivalGate(): ArrivalGateResult {
  const tier = useDeviceStore((s) => s.tier);
  const apiToken = googleTilesApiKey();

  useEffect(() => {
    if (prefersReducedMotion()) {
      useArrivalStore.getState().setReducedMotion(true);
    }
  }, []);

  if (tier === "poster") {
    return { blocked: "poster-tier" };
  }
  if (apiToken === null) {
    return { blocked: "no-key" };
  }
  return { blocked: null };
}
