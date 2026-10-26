import { useCallback, useEffect } from "react";
import { useTwinSearchParams } from "./twin-search-params.js";

// -----------------------------------------------------------------------------
// useTwinMode — the walk ⇄ dollhouse ⇄ plan mode machine (Phase 2, Task 5).
//
// The URL (?mode=) is the machine's single source of truth: mode is DERIVED
// from the search params on every render, never mirrored into component
// state. It shares the query with useTwinWalk's ?node=, and both write
// through useTwinSearchParams, which edits the address as the router holds it
// at that moment, so neither write can drop the other's key. (React Router's
// functional setSearchParams form cannot promise that: its updater sees the
// params of the render that made the setter, which T-674 measured going
// stale under a hop landing and the dive.)
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
  const [searchParams, editSearchParams] = useTwinSearchParams();
  const param = searchParams.get("mode");
  const mode = parseMode(param, hasMesh);

  // Canonicalise: walk is spelt by ABSENCE. A present param that parses to
  // walk (invalid value, explicit "walk", or a mesh-less bundle) is dropped
  // without adding history, preserving every other param (?node= included).
  useEffect(() => {
    if (param !== null && parseMode(param, hasMesh) === "walk") {
      editSearchParams((params) => {
        const now = params.get("mode");
        if (now === null || parseMode(now, hasMesh) !== "walk") {
          return null; // the address moved on before this ran
        }
        params.delete("mode");
        return { replace: true };
      });
    }
  }, [param, hasMesh, editSearchParams]);

  // Decided from the address as it stands when the visitor asks, not from
  // the last render: two quick presses must not both read the old mode, which
  // would replace the first press's history entry or push a second one.
  const setMode = useCallback(
    (next: TwinMode) => {
      editSearchParams((params) => {
        const now = parseMode(params.get("mode"), hasMesh);
        if (next === now || (!hasMesh && next !== "walk")) {
          return null;
        }
        if (next === "walk") {
          params.delete("mode");
        } else {
          params.set("mode", next);
        }
        // Crossing the dollhouse boundary is a navigation (push once); every
        // other switch is a view tweak (replace).
        const crossesDollhouse = (now === "dollhouse") !== (next === "dollhouse");
        return { replace: !crossesDollhouse };
      });
    },
    [hasMesh, editSearchParams],
  );

  return { mode, setMode };
}
