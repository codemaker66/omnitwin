import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_NavigationContext,
  useLocation,
  useNavigate,
  useSearchParams,
  type NavigateOptions,
} from "react-router-dom";

// ---------------------------------------------------------------------------
// useLiveSearchParams — search-param writes that build on the address as it
// stands now, not as some earlier render saw it.
//
// React Router's setSearchParams(fn) hands fn the params of the render that
// created it. Its documentation says so: "Multiple calls to setSearchParams
// in the same tick will not build on the prior value." Navigations also
// render inside a transition, so a callback from an older render (a frame
// loop, a handler that makes two writes, an effect behind a pending render)
// copies an address that has already moved on and puts the old value back.
// The twin lost dives that way: a dive wrote ?node= and then ?mode= from the
// same copy, so the walk snapped back to the node it had left (found on
// 18 October 2026).
//
// latest() reads the router's own location at call time: the data router's
// state, or the history a Memory, Browser or Hash router passes in as its
// navigator. write() navigates to new params, skipping a write that changes
// nothing, and skipping every write once the router has moved to another
// page, where it would pull the visitor back to the page they are leaving.
// Both read live state, so a stale copy of either is still safe to call.
// ---------------------------------------------------------------------------

export interface LiveSearchParams {
  /** The params of the render: what the page shows. */
  readonly searchParams: URLSearchParams;
  /** A fresh copy of this page's params as the router holds them now. */
  readonly latest: () => URLSearchParams;
  /** Navigate to these params, unless that changes nothing or the page is being left. */
  readonly write: (params: URLSearchParams, options?: NavigateOptions) => void;
}

interface Address {
  readonly pathname: string;
  readonly search: string;
}

function isAddress(value: unknown): value is Address {
  return typeof value === "object" && value !== null
    && "pathname" in value && typeof value.pathname === "string"
    && "search" in value && typeof value.search === "string";
}

/** React Router's basename rule: the path inside the app, or null outside it. */
function insideBasename(pathname: string, basename: string): string | null {
  if (basename === "/") return pathname;
  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) return null;
  const start = basename.endsWith("/") ? basename.length - 1 : basename.length;
  const next = pathname.charAt(start);
  if (next !== "" && next !== "/") return null;
  return pathname.slice(start) || "/";
}

export function useLiveSearchParams(): LiveSearchParams {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { basename, navigator } = useContext(UNSAFE_NavigationContext);

  // The page's own address as last committed. A custom navigator keeps no
  // location of its own, so this is also the fallback reading.
  const committed = useRef<Address>(location);
  useLayoutEffect(() => {
    committed.current = location;
  }, [location]);

  /** The router's address now, inside the basename; null when outside it. */
  const routerAddress = useCallback((): Address | null => {
    const history: unknown = navigator;
    const raw = dataRouter !== null
      ? dataRouter.router.state.location
      : typeof history === "object" && history !== null && "location" in history && isAddress(history.location)
        ? history.location
        : null;
    if (raw === null) return committed.current;
    const pathname = insideBasename(raw.pathname, basename);
    return pathname === null ? null : { pathname, search: raw.search };
  }, [basename, dataRouter, navigator]);

  /** This page's address now; null once the router has moved to another page. */
  const pageAddress = useCallback((): Address | null => {
    const address = routerAddress();
    return address !== null && address.pathname === committed.current.pathname ? address : null;
  }, [routerAddress]);

  const latest = useCallback(
    (): URLSearchParams => new URLSearchParams((pageAddress() ?? committed.current).search),
    [pageAddress],
  );

  const write = useCallback(
    (params: URLSearchParams, options?: NavigateOptions): void => {
      const address = pageAddress();
      if (address === null) return;
      const next = params.toString();
      if (next === new URLSearchParams(address.search).toString()) return;
      void navigate(`?${next}`, options);
    },
    [navigate, pageAddress],
  );

  return { searchParams, latest, write };
}
