import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_NavigationContext,
  useLocation,
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
// The router itself knows the current address. A data router's state (or, while
// a navigation is pending, the place it is going) and a declarative router's
// history both change the moment a navigation is made, so an edit reads the
// address there, decides from it whether to write and how (push or replace),
// and changes only its own keys. React Router has no public read for this; the
// contexts below are its own (InventoryNavigationGuard uses the data-router one
// to tell which kind of router it is under). The rendered params remain the
// fallback for a router that exposes neither.
//
// An edit made after the visitor has left the tour's page, as a hop that lands
// while the next page's chunk is still loading would, is dropped: the tour's
// keys do not belong in another page's address.
// -----------------------------------------------------------------------------

/**
 * Change some keys of the query as it stands now, and say how to navigate:
 * the options for the write, or null to leave the address as it is.
 */
export type EditSearchParams = (
  edit: (params: URLSearchParams) => NavigateOptions | null,
) => void;

interface Address {
  readonly pathname: string;
  readonly search: string;
}

/** A declarative router's navigator is its history, which knows where it is. */
function historyAddress(navigator: object): Address | null {
  if (!("location" in navigator)) {
    return null;
  }
  const { location } = navigator;
  return typeof location === "object" &&
    location !== null &&
    "pathname" in location &&
    typeof location.pathname === "string" &&
    "search" in location &&
    typeof location.search === "string"
    ? { pathname: location.pathname, search: location.search }
    : null;
}

/** The router's own pathnames carry its basename; rendered ones do not. */
function withBasename(basename: string, pathname: string): string {
  return basename === "/" ? pathname : `${basename.replace(/\/+$/u, "")}${pathname}`;
}

export function useTwinSearchParams(): readonly [URLSearchParams, EditSearchParams] {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { basename, navigator } = useContext(UNSAFE_NavigationContext);

  // The newest committed render: the page the tour stands on, its params for
  // the fallback, and a setter from the current router hooks.
  const latest = useRef({ pathname, searchParams, setSearchParams });
  useLayoutEffect(() => {
    latest.current = { pathname, searchParams, setSearchParams };
  });

  const editSearchParams = useCallback<EditSearchParams>(
    (edit) => {
      const rendered = latest.current;
      let now: Address;
      if (dataRouter !== null) {
        const { location, navigation } = dataRouter.router.state;
        now = navigation.location ?? location;
      } else {
        now = historyAddress(navigator) ?? {
          pathname: withBasename(basename, rendered.pathname),
          search: `?${rendered.searchParams.toString()}`,
        };
      }
      if (now.pathname !== withBasename(basename, rendered.pathname)) {
        return;
      }
      const params = new URLSearchParams(now.search);
      const options = edit(params);
      if (options !== null) {
        rendered.setSearchParams(params, options);
      }
    },
    [basename, dataRouter, navigator],
  );

  return [searchParams, editSearchParams] as const;
}
