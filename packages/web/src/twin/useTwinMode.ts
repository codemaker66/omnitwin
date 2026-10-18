import { useCallback, useEffect } from "react";
import { useLiveSearchParams } from "../hooks/use-live-search-params.js";

// -----------------------------------------------------------------------------
// useTwinMode — the walk ⇄ dollhouse ⇄ plan mode machine (Phase 2, Task 5).
//
// The URL (?mode=) is the machine's single source of truth: mode is DERIVED
// from the search params on every render, never mirrored into component
// state. useTwinWalk writes ?node= into the same address, so both hooks build
// each write on the address as it stands at that moment (useLiveSearchParams)
// and each preserves the other's key, even when a dive makes both writes in
// one handler or a hop lands from a frame loop started renders ago.
//
// History contract: entering or leaving dollhouse pushes exactly one entry
// (the browser back button is the natural "surface from the dollhouse");
// walk ⇄ plan switches replace so mode-shopping never floods history. Absent
// param = walk (the canonical spelling); an invalid value — or ANY value when
// the bundle carries no mesh — clamps to walk and canonicalises the URL with
// a replace, mirroring useTwinWalk's ?node= canonicalisation.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase2-dollhouse.md (Task 5).
// -----------------------------------------------------------------------------

export type TwinMode = "walk" | "dollhouse" | "plan";

export interface TwinModeState {
  readonly mode: TwinMode;
  readonly setMode: (mode: TwinMode) => void;
}

/** Parse ?mode= — anything but a mesh-backed dollhouse/plan is a walk. */
function parseMode(param: string | null, hasMesh: boolean): TwinMode {
  return hasMesh && (param === "dollhouse" || param === "plan") ? param : "walk";
}

export function useTwinMode(hasMesh: boolean): TwinModeState {
  const { searchParams, latest, write } = useLiveSearchParams();
  const param = searchParams.get("mode");
  const mode = parseMode(param, hasMesh);

  // Canonicalise: walk is spelt by ABSENCE. A present param that parses to
  // walk (invalid value, explicit "walk", or a mesh-less bundle) is dropped
  // without adding history, preserving every other param (?node= included).
  // A newer address that already chose a real mode is left to its render.
  useEffect(() => {
    if (param === null || parseMode(param, hasMesh) !== "walk") {
      return;
    }
    const params = latest();
    const now = params.get("mode");
    if (now !== null && parseMode(now, hasMesh) === "walk") {
      params.delete("mode");
      write(params, { replace: true });
    }
  }, [param, hasMesh, latest, write]);

  const setMode = useCallback(
    (next: TwinMode) => {
      if (!hasMesh && next !== "walk") {
        return;
      }
      // Decided from the address as it stands, which a pending navigation
      // may already have moved past this render's mode.
      const params = latest();
      const current = parseMode(params.get("mode"), hasMesh);
      if (next === current) {
        return;
      }
      if (next === "walk") {
        params.delete("mode");
      } else {
        params.set("mode", next);
      }
      // Crossing the dollhouse boundary is a navigation (push once); every
      // other switch is a view tweak (replace).
      const crossesDollhouse = (current === "dollhouse") !== (next === "dollhouse");
      write(params, { replace: !crossesDollhouse });
    },
    [hasMesh, latest, write],
  );

  return { mode, setMode };
}
