import { useEffect, useReducer, type ReactElement } from "react";
import { isRouteErrorResponse, useRouteError, type RouteObject } from "react-router-dom";
import { classifyError, RecoveryScreen } from "./error-boundary.js";
import { browserSaysOnline } from "./lib/online-status.js";
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
//   - a chunk can also fail for want of a network (fresh read
//     web-shell-api-3), and a reload then only swaps the page, and whatever
//     was typed on it, for the browser's own offline error. So the reload
//     goes only where it would be served: the browser says it is online
//     (navigator.onLine is false only with no network at all, and true on
//     Wi-Fi that leads nowhere) and the app's own server answers a question
//     asked past every cache. Otherwise the recovery screen says the server
//     could not be reached, the tab's one reload stays unspent for a real
//     deploy, and Sentry is not told: the device's network is not a fault in
//     the app;
//   - any other error reaches Sentry once and shows AppErrorBoundary's
//     recovery screen.
//
// Vite's own preload failure (`vite:preloadError`) takes the same one reload,
// asked for the same way, except a script's failure while optional code loads
// (loadOptional): a measurement that will not load costs only itself. It never
// prevents the default: whether a reload would be served is known only once
// the server has answered, so the import fails on into whoever asked for it.
// For a page that is the route boundary, which waits on the same answer.
// ---------------------------------------------------------------------------

const SCRIPT_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/iu;
/** Vite's own words when a page's stylesheet will not preload. */
const STYLESHEET_PRELOAD_FAILURE = /^Unable to preload CSS for /u;

/** When this tab last reloaded for a stale chunk (milliseconds since epoch). */
export const CHUNK_RELOAD_GUARD_KEY = "venviewer.chunk-reload-at";
const CHUNK_RELOAD_GUARD_MS = 60_000;
/** How long the app's own server has to answer before a reload counts as one
 *  that would not be served. A working connection answers a HEAD in well
 *  under a second; the page draws nothing while it waits. */
const ORIGIN_ANSWER_MS = 5_000;

/** The page the reload acts on: a seam for tests, the window otherwise. */
export const stalePage = {
  reload(): void { window.location.reload(); },
};

function isScriptLoadError(error: unknown): boolean {
  return error instanceof Error && SCRIPT_LOAD_FAILURE.test(error.message);
}

/** True for the errors raised when a code-split chunk will not load: the
 *  browser's own for a script, and Vite's for a page's stylesheet. */
export function isChunkLoadError(error: unknown): boolean {
  return isScriptLoadError(error) || (error instanceof Error && STYLESHEET_PRELOAD_FAILURE.test(error.message));
}

/** Whether this tab's one reload is free: none taken in the last minute, and
 *  session storage there to remember it. */
function staleChunkReloadFree(now: number): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY));
    return !(Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_GUARD_MS);
  } catch {
    return false;
  }
}

/**
 * Claim this tab's one reload for a stale chunk: true, and the guard set,
 * when none was taken in the last minute; false otherwise, and false when
 * session storage is unavailable, so a page that cannot remember never loops.
 */
export function claimStaleChunkReload(now: number = Date.now()): boolean {
  if (!staleChunkReloadFree(now)) return false;
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Whether the app's own server answers now, past every cache: whether a
 *  reload would be served. */
async function originAnswers(): Promise<boolean> {
  const question = new AbortController();
  const timer = setTimeout(() => { question.abort(); }, ORIGIN_ANSWER_MS);
  try {
    const response = await fetch("/", { method: "HEAD", cache: "no-store", signal: question.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type ReloadOutcome = "reloading" | "unserved" | "refused";

/** The question in flight, shared by Vite's listener and the route boundary,
 *  so one failure that both see asks once and reloads once. */
let pendingReload: Promise<ReloadOutcome> | null = null;

/** Reload for a stale chunk if the server answers and the tab's reload is
 *  still free; "unserved" when the server does not answer. */
function reloadIfServed(): Promise<ReloadOutcome> {
  if (pendingReload !== null) return pendingReload;
  const attempt = originAnswers().then((answered): ReloadOutcome => {
    if (!answered) return "unserved";
    if (!claimStaleChunkReload()) return "refused";
    stalePage.reload();
    return "reloading";
  });
  pendingReload = attempt;
  const settle = (): void => { if (pendingReload === attempt) pendingReload = null; };
  void attempt.then(settle, settle);
  return attempt;
}

/** How many loads of optional code are under way. */
let optionalLoads = 0;

/**
 * Loads code the page can do without (the field web vitals reporter and its
 * library, never a page): if it will not load (a blocker, offline, a deploy
 * in between), the promise rejects and the page stays as it is.
 *
 * While it loads, a script that will not load (the browser's module error)
 * takes no reload here, since the listener cannot tell whose import failed:
 * it falls to the import's own handler. For a route that is the route
 * boundary, which reloads on that same error; for this optional code it is
 * the caller's catch. A stylesheet that will not preload ("Unable to preload
 * CSS") is asked about as ever: only a page's chunk has one.
 */
export async function loadOptional<T>(load: () => Promise<T>): Promise<T> {
  optionalLoads += 1;
  try {
    return await load();
  } finally {
    optionalLoads -= 1;
  }
}

/** Vite's preload failure: the same one reload, once the server has answered,
 *  except a script's failure while optional code loads (loadOptional). */
export function installStaleChunkReload(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    if (optionalLoads > 0 && isScriptLoadError(event.payload)) return;
    if (!browserSaysOnline() || !staleChunkReloadFree(Date.now())) return;
    void reloadIfServed();
  });
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isRouteErrorResponse(value)) return new Error(`${String(value.status)} ${value.statusText}`);
  return new Error(typeof value === "string" ? value : "Unexpected route error");
}

/** "asking": the server is being asked whether a reload would be served.
 *  "unreachable": it would not, or the browser has no network at all. */
type Decision = "reload" | "report" | "unreachable" | "asking";

const ANSWERED: Readonly<Record<ReloadOutcome, Decision>> = {
  reloading: "reload",
  unserved: "unreachable",
  refused: "report",
};

// Decided once per thrown value, so a second render (StrictMode, a parent's
// update) neither asks or claims the guard again nor reports again.
const decisions = new WeakMap<object, Decision>();
const reported = new WeakSet();

function decide(key: object, error: Error): Decision {
  const known = decisions.get(key);
  if (known !== undefined) return known;
  let decision: Decision = "report";
  if (isChunkLoadError(error)) {
    if (!browserSaysOnline()) decision = "unreachable";
    else if (staleChunkReloadFree(Date.now())) decision = "asking";
  }
  decisions.set(key, decision);
  return decision;
}

/** The root route's ErrorBoundary. */
export function RouteErrorFallback(): ReactElement | null {
  const thrown = useRouteError();
  const error = asError(thrown);
  const key: object = typeof thrown === "object" && thrown !== null ? thrown : error;
  const decision = decide(key, error);
  const [, answered] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (decision === "asking") {
      let live = true;
      const record = (outcome: ReloadOutcome): void => {
        decisions.set(key, ANSWERED[outcome]);
        if (live) answered();
      };
      void reloadIfServed().then(record, () => { record("refused"); });
      return () => { live = false; };
    }
    if (decision === "report" && !reported.has(key)) {
      reported.add(key);
      void captureBoundaryError(error, { componentStack: "" });
    }
    return undefined;
  }, [decision, error, key]);

  // A reload is on its way, or may be; the recovery screen would only flash.
  if (decision === "reload" || decision === "asking") return null;
  return <RecoveryScreen error={error} kind={decision === "unreachable" ? "network" : classifyError(error)} />;
}

/** Every route under one pathless root that catches what they throw. A route
 *  with no element renders its children, so paths and matching are as before. */
export function underRouteErrorBoundary(routes: RouteObject[]): RouteObject[] {
  return [{ ErrorBoundary: RouteErrorFallback, children: routes }];
}
