import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_NavigationContext,
  useSearchParams,
  type NavigateOptions,
} from "react-router-dom";

// -----------------------------------------------------------------------------
// useTwinSearchParams — every write to the tour's query starts from where the
// router is NOW.
//
// The query has two owners: the walk writes ?node=, the mode writes ?mode=.
// React Router 7 hands a functional setSearchParams updater the params of the
// render that created the setter, not the router's current ones, so a write
// made from an older closure rebuilds the whole query from an address the
// visitor has since changed and silently drops what changed. Measured on
// master (26 Oct 2026, T-674): a hop that landed a second after a switch to
// Dollhouse wrote ?node= without ?mode= and put the visitor back in the walk;
// the dive's two writes in one tick put the old viewpoint back.
//
// The router itself always knows the current address: a data router's state
// and a declarative router's history both update synchronously when a
// navigation without loaders is made, and the tour's routes have none. So an
// edit reads the address from the router at the moment it is made and
// changes only its own keys. React Router has no public read for this; the
// contexts below are its own (InventoryNavigationGuard reads the data-router
// one the same way). The rendered params remain the fallback for a router
// that exposes neither.
// -----------------------------------------------------------------------------

/** Change some keys of the query, leaving every other key as it stands now. */
export type EditSearchParams = (
  edit: (params: URLSearchParams) => void,
  options?: NavigateOptions,
) => void;

/** A declarative router's navigator is its history, which knows where it is. */
function historySearch(navigator: object): string | null {
  if (!("location" in navigator)) {
    return null;
  }
  const { location } = navigator;
  return typeof location === "object" &&
    location !== null &&
    "search" in location &&
    typeof location.search === "string"
    ? location.search
    : null;
}

export function useTwinSearchParams(): readonly [URLSearchParams, EditSearchParams] {
  const [searchParams, setSearchParams] = useSearchParams();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { navigator } = useContext(UNSAFE_NavigationContext);

  // The newest committed setter and params, for the fallback and so a write
  // from an old closure still navigates through the current router hooks.
  const latest = useRef({ searchParams, setSearchParams });
  useLayoutEffect(() => {
    latest.current = { searchParams, setSearchParams };
  });

  const editSearchParams = useCallback<EditSearchParams>(
    (edit, options) => {
      const now =
        dataRouter?.router.state.location.search ??
        historySearch(navigator) ??
        latest.current.searchParams.toString();
      const next = new URLSearchParams(now);
      edit(next);
      latest.current.setSearchParams(next, options);
    },
    [dataRouter, navigator],
  );

  return [searchParams, editSearchParams] as const;
}
