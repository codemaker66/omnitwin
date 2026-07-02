import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// -----------------------------------------------------------------------------
// useTwinMode — the walk ⇄ dollhouse ⇄ plan mode machine (Phase 2, Task 5).
//
// The URL (?mode=) is the machine's single source of truth: mode is DERIVED
// from useSearchParams on every render, never mirrored into component state,
// so this hook can never fight useTwinWalk's ?node= writes — both sides use
// the functional setSearchParams form and copy the previous params, so each
// preserves the other's key.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("mode");
  const mode = parseMode(param, hasMesh);

  // Canonicalise: walk is spelt by ABSENCE. A present param that parses to
  // walk (invalid value, explicit "walk", or a mesh-less bundle) is dropped
  // without adding history, preserving every other param (?node= included).
  useEffect(() => {
    if (param !== null && parseMode(param, hasMesh) === "walk") {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("mode");
          return next;
        },
        { replace: true },
      );
    }
  }, [param, hasMesh, setSearchParams]);

  const setMode = useCallback(
    (next: TwinMode) => {
      if (next === mode || (!hasMesh && next !== "walk")) {
        return;
      }
      // Crossing the dollhouse boundary is a navigation (push once); every
      // other switch is a view tweak (replace).
      const crossesDollhouse = (mode === "dollhouse") !== (next === "dollhouse");
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === "walk") {
            params.delete("mode");
          } else {
            params.set("mode", next);
          }
          return params;
        },
        { replace: !crossesDollhouse },
      );
    },
    [mode, hasMesh, setSearchParams],
  );

  return { mode, setMode };
}
