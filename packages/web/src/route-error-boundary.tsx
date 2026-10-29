import { useEffect, type ReactElement } from "react";
import { isRouteErrorResponse, useRouteError, type RouteObject } from "react-router-dom";
import { RecoveryScreen } from "./error-boundary.js";
import { captureBoundaryError } from "./observability/sentry.js";

// ---------------------------------------------------------------------------
// Route errors (release audit web-auth-routing-1). React Router catches what
// a route throws while rendering, and a lazy page whose chunk will not load,
// in a boundary of its own. Without one of ours it showed its raw
// "Unexpected Application Error!" page with a minified stack and no way on,
// and neither AppErrorBoundary nor Sentry heard of it. Every route now sits
// under one pathless root whose ErrorBoundary is RouteErrorFallback:
//
//   - a stale chunk after a deploy ("Failed to fetch dynamically imported
//     module") reloads the page once, so the new build's chunks are asked
//     for. A sessionStorage guard stops a second reload within a minute; a
//     failure inside that minute is real, and goes the way of any other;
//   - any other error reaches Sentry once and shows AppErrorBoundary's
//     recovery screen.
//
// Vite's own preload failure (`vite:preloadError`) takes the same one reload.
// ---------------------------------------------------------------------------

const CHUNK_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/iu;

/** When this tab last reloaded for a stale chunk (milliseconds since epoch). */
export const CHUNK_RELOAD_GUARD_KEY = "venviewer.chunk-reload-at";
const CHUNK_RELOAD_GUARD_MS = 60_000;

/** The page the reload acts on: a seam for tests, the window otherwise. */
export const stalePage = {
  reload(): void { window.location.reload(); },
};

/** True for the errors browsers raise when a code-split chunk will not load. */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_FAILURE.test(error.message);
}

/**
 * Claim this tab's one reload for a stale chunk: true, and the guard set,
 * when none was taken in the last minute; false otherwise, and false when
 * session storage is unavailable, so a page that cannot remember never loops.
 */
export function claimStaleChunkReload(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Vite's preload failure: the same one reload, before the import rejects. */
export function installStaleChunkReload(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    if (!claimStaleChunkReload()) return;
    event.preventDefault();
    stalePage.reload();
  });
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isRouteErrorResponse(value)) return new Error(`${String(value.status)} ${value.statusText}`);
  return new Error(typeof value === "string" ? value : "Unexpected route error");
}

// Decided once per thrown value, so a second render (StrictMode, a parent's
// update) neither claims the guard again nor reports again.
const decisions = new WeakMap<object, "reload" | "report">();
const reported = new WeakSet();

function decide(key: object, error: Error): "reload" | "report" {
  const known = decisions.get(key);
  if (known !== undefined) return known;
  const decision = isChunkLoadError(error) && claimStaleChunkReload() ? "reload" : "report";
  decisions.set(key, decision);
  return decision;
}

/** The root route's ErrorBoundary. */
export function RouteErrorFallback(): ReactElement | null {
  const thrown = useRouteError();
  const error = asError(thrown);
  const key: object = typeof thrown === "object" && thrown !== null ? thrown : error;
  const decision = decide(key, error);

  useEffect(() => {
    if (decision === "reload") {
      stalePage.reload();
      return;
    }
    if (reported.has(key)) return;
    reported.add(key);
    void captureBoundaryError(error, { componentStack: "" });
  }, [decision, error, key]);

  // A reload is on its way; the recovery screen would only flash.
  if (decision === "reload") return null;
  return <RecoveryScreen error={error} />;
}

/** Every route under one pathless root that catches what they throw. A route
 *  with no element renders its children, so paths and matching are as before. */
export function underRouteErrorBoundary(routes: RouteObject[]): RouteObject[] {
  return [{ ErrorBoundary: RouteErrorFallback, children: routes }];
}
