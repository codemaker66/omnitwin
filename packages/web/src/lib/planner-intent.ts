import { useEffect, useMemo, useRef, type FocusEvent, type PointerEvent } from "react";

// ---------------------------------------------------------------------------
// Fetches the planner's code for the next page when someone reaches for a Plan
// link (T-685): the intent preloading X Engineering added to x.com. A pointer
// that comes to rest on the link for 100 ms counts, as do keyboard focus and a
// press; a link that merely scrolls under a still pointer does not, because
// only a moving pointer starts the wait. The Plan links are whole-page loads,
// so the files go to the browser's cache for the planner page to find.
//
// index.html defines the fetch (home-route-preload-plugin.ts). In development
// it does not exist, and this does nothing.
// ---------------------------------------------------------------------------

export const PLANNER_INTENT_REST_MS = 100;

export function prefetchPlanner(): void {
  window.__vvPlannerPrefetch?.();
}

export interface PlannerIntentHandlers {
  readonly onPointerMove: (event: PointerEvent<HTMLAnchorElement>) => void;
  readonly onPointerLeave: () => void;
  readonly onPointerDown: () => void;
  readonly onFocus: (event: FocusEvent<HTMLAnchorElement>) => void;
}

/** Handlers to spread on a link to the planner. */
export function usePlannerIntent(): PlannerIntentHandlers {
  const rest = useRef<number | null>(null);
  useEffect(() => () => {
    if (rest.current !== null) window.clearTimeout(rest.current);
  }, []);
  return useMemo(() => {
    const cancel = (): void => {
      if (rest.current !== null) window.clearTimeout(rest.current);
      rest.current = null;
    };
    return {
      // Each move restarts the wait, so only a pointer at rest counts. A touch
      // has no hover; its press is the intent.
      onPointerMove: (event) => {
        if (event.pointerType === "touch") return;
        cancel();
        rest.current = window.setTimeout(() => {
          rest.current = null;
          prefetchPlanner();
        }, PLANNER_INTENT_REST_MS);
      },
      onPointerLeave: cancel,
      onPointerDown: () => {
        cancel();
        prefetchPlanner();
      },
      onFocus: () => { prefetchPlanner(); },
    };
  }, []);
}
