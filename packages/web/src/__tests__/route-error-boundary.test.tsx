import { lazy, type ErrorInfo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

const captureBoundaryErrorMock = vi.hoisted(() =>
  vi.fn<(error: Error, info: ErrorInfo) => Promise<void>>(() => Promise.resolve()),
);

vi.mock("../observability/sentry.js", () => ({
  captureBoundaryError: captureBoundaryErrorMock,
}));

const {
  CHUNK_RELOAD_GUARD_KEY,
  RouteErrorFallback,
  installStaleChunkReload,
  isChunkLoadError,
  loadOptional,
  stalePage,
  underRouteErrorBoundary,
} = await import("../route-error-boundary.js");

// ---------------------------------------------------------------------------
// Route render errors and stale chunks (release audit web-auth-routing-1).
// A memory router built with the app's own wrapping helper: /chunk is a lazy
// page whose import rejects as a browser's does after a deploy, /boom throws
// while rendering. Neither may meet React Router's raw "Unexpected Application
// Error!" page; each reaches the recovery screen, Sentry hears of a real
// failure once, and a stale chunk reloads the page exactly once.
// ---------------------------------------------------------------------------

const RAW_PAGE = "Unexpected Application Error!";
const LOAD_WAIT = { timeout: 5_000 } as const;

function staleChunk(): Promise<{ default: () => null }> {
  return Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://venviewer.com/assets/EditorPage-3f9a1c.js"));
}

function Boom(): null {
  throw new Error("The seating plan could not be drawn");
}

function testRoutes(): RouteObject[] {
  // A fresh lazy each time: React keeps a rejected lazy's result.
  const StalePage = lazy(staleChunk);
  return [
    { path: "/chunk", element: <StalePage /> },
    { path: "/boom", element: <Boom /> },
    { path: "/", element: <p>Home</p> },
  ];
}

function open(path: string, routes: RouteObject[] = underRouteErrorBoundary(testRoutes())): void {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

/** A page whose code will not load, failing as `failure` says. */
function failingRoutes(failure: () => Error): RouteObject[] {
  const Failing = lazy(() => Promise.reject(failure()));
  return [
    { path: "/failing", element: <Failing /> },
    { path: "/", element: <p>Home</p> },
  ];
}

function guard(): string | null {
  return window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);
}

/** Long enough for a report sent from an effect to have gone, if one were. */
function settled(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 50); });
}

let reload: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;
/** The browser's own word on whether it has a network. */
let onLine: ReturnType<typeof vi.spyOn>;
/** The network, as the reload's question to the app's own server meets it:
 *  answered by default, as after a deploy. */
const origin = vi.fn<typeof fetch>();

beforeEach(() => {
  captureBoundaryErrorMock.mockClear();
  window.sessionStorage.clear();
  reload = vi.spyOn(stalePage, "reload").mockImplementation(() => undefined);
  onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  origin.mockReset();
  origin.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
  vi.stubGlobal("fetch", origin);
  // React and React Router report caught errors on the console; keep the run quiet.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the route error boundary", () => {
  it("is needed: without it React Router shows its raw error page", async () => {
    open("/boom", testRoutes());
    expect(await screen.findByText(RAW_PAGE, undefined, LOAD_WAIT)).toBeTruthy();
  });

  it("shows the recovery screen for a render error and reports it once", async () => {
    open("/boom");

    expect(await screen.findByTestId("error-boundary-render", undefined, LOAD_WAIT)).toBeTruthy();
    expect(screen.queryByText(RAW_PAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Reload Page" })).toBeTruthy();
    expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1);
    expect(captureBoundaryErrorMock.mock.calls[0]?.[0].message).toBe("The seating plan could not be drawn");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once for a stale chunk and sets the guard, without reporting", async () => {
    open("/chunk");

    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
    expect(Number(window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY))).toBeGreaterThan(0);
    expect(screen.queryByText(RAW_PAGE)).toBeNull();
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
    // Only once the app's own server has answered, past any cache.
    expect(origin).toHaveBeenCalledTimes(1);
    expect(origin).toHaveBeenCalledWith("/", expect.objectContaining({ method: "HEAD", cache: "no-store" }));
  });

  it("does not reload again while the guard is fresh: the recovery screen shows and Sentry hears of it", async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now() - 5_000));
    open("/chunk");

    expect(await screen.findByTestId("error-boundary-network", undefined, LOAD_WAIT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(RAW_PAGE)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    // A reload the guard refuses needs no question to the server.
    expect(origin).not.toHaveBeenCalled();
    // The fallback reports from an effect, and the lazy import's rejection
    // commits outside act(), so the screen can be drawn a moment before the
    // report is sent (#410's CI, 12 Nov 2026). Wait for it; still exactly once.
    await vi.waitFor(() => { expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
  });

  it("reloads again for a later deploy, once the guard is over a minute old", async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now() - 120_000));
    open("/chunk");

    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
  });

  it("recognises the chunk failures of Chrome, Safari, Firefox and Vite's stylesheet preload, and nothing else", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("Vite's preload failure", () => {
  it("reloads once when the app's own server answers, and lets a second failure inside the minute through", async () => {
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);

    const first = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(first);
    // Whether a reload would be served is known only once the server has
    // answered, so the import goes on to fail into whoever asked for it; a
    // page's route boundary waits on the same answer and draws nothing.
    expect(first.defaultPrevented).toBe(false);
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
    expect(origin).toHaveBeenCalledWith("/", expect.objectContaining({ method: "HEAD", cache: "no-store" }));

    const second = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(second);
    await settled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    expect(origin).toHaveBeenCalledTimes(1);
  });

  it("shares one question to the server and one reload with the page's route boundary", async () => {
    let answer: (response: Response) => void = () => undefined;
    origin.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);
    target.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    open("/chunk");
    // The route boundary has the failure while the question is still out.
    await vi.waitFor(() => { expect(consoleError).toHaveBeenCalled(); }, LOAD_WAIT);
    await settled();
    expect(screen.queryByRole("alert")).toBeNull();

    answer(new Response(null, { status: 200 }));
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
    await settled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(origin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
  });

  /** Vite's event: its helper puts the failure in `payload`, then throws it
   *  unless a listener prevents the default. */
  function preloadError(payload: Error): Event {
    return Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });
  }

  it("reloads nothing for optional code that will not load: its import just rejects", async () => {
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);
    const blocked = new TypeError("Failed to fetch dynamically imported module: https://venviewer.com/assets/web-vitals-3f9a1c.js");
    const during = preloadError(blocked);
    // As Vite's preload helper does when a chunk will not load: the event, then the rejection.
    const load = loadOptional(() => {
      target.dispatchEvent(during);
      return Promise.reject(blocked);
    });
    await expect(load).rejects.toBe(blocked);
    expect(during.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    // Once it has settled, a failed preload is a stale chunk again (reloaded
    // once the app's own server has answered).
    target.dispatchEvent(preloadError(new TypeError("Importing a module script failed.")));
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
  });

  it("still reloads for a stylesheet that will not preload while optional code loads, once the server answers: only a page has one", async () => {
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);
    let settle: () => void = () => undefined;
    const load = loadOptional(() => new Promise<void>((resolve) => { settle = resolve; }));
    const css = preloadError(new Error("Unable to preload CSS for /assets/RoomsHomePage-3f9a1c.css"));
    target.dispatchEvent(css);
    // The import fails on into the page's route boundary, which knows this error.
    expect(css.defaultPrevented).toBe(false);
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
    settle();
    await load;
  });
});

// ---------------------------------------------------------------------------
// Fresh read web-shell-api-3. A chunk fails to load for want of a network as
// well as after a deploy. A reload then only swaps the page, and whatever was
// typed on it, for the browser's own offline error. The reload goes only where
// it would be served: the browser says it is online and the app's own server
// answers (navigator.onLine is true on Wi-Fi that leads nowhere). Otherwise
// the failure lands on the recovery screen in its words for a network failure,
// and the tab's one reload stays unspent for a real deploy once the network
// is back. The device's network is not a fault in the app: Sentry is not told.
// ---------------------------------------------------------------------------

describe("a chunk that cannot load for want of a network", () => {
  const failures: readonly (readonly [string, () => Error])[] = [
    ["Chrome", () => new TypeError("Failed to fetch dynamically imported module: https://venviewer.com/assets/DiaryBoardPage-3f9a1c.js")],
    ["Safari", () => new TypeError("Importing a module script failed.")],
    ["Firefox", () => new TypeError("error loading dynamically imported module: https://venviewer.com/assets/DiaryBoardPage-3f9a1c.js")],
    ["Vite's stylesheet preload", () => new Error("Unable to preload CSS for /assets/DiaryBoardPage-3f9a1c.css")],
  ];

  it.each(failures)("offline (%s): no reload, the network recovery screen, the guard unspent", async (_source, failure) => {
    onLine.mockReturnValue(false);
    open("/failing", underRouteErrorBoundary(failingRoutes(failure)));

    expect(await screen.findByTestId("error-boundary-network", undefined, LOAD_WAIT)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Couldn't reach the server" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    await settled();
    expect(reload).not.toHaveBeenCalled();
    expect(guard()).toBeNull();
    expect(origin).not.toHaveBeenCalled();
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
  });

  it("offline, Vite's preload failure lets the import fail on, without a reload, and leaves the guard unspent", async () => {
    onLine.mockReturnValue(false);
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);

    const event = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(event);
    await settled();

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(guard()).toBeNull();
    expect(origin).not.toHaveBeenCalled();
  });

  it("online but the app's server does not answer (Wi-Fi that leads nowhere): one question, no reload, the network recovery screen, the guard unspent", async () => {
    let fail: (error: Error) => void = () => undefined;
    origin.mockImplementation(() => new Promise<Response>((_resolve, reject) => { fail = reject; }));
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);
    target.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    open("/chunk");
    await vi.waitFor(() => { expect(consoleError).toHaveBeenCalled(); }, LOAD_WAIT);
    await settled();

    fail(new TypeError("Failed to fetch"));
    expect(await screen.findByTestId("error-boundary-network", undefined, LOAD_WAIT)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Couldn't reach the server" })).toBeTruthy();
    await settled();
    expect(reload).not.toHaveBeenCalled();
    expect(guard()).toBeNull();
    expect(origin).toHaveBeenCalledTimes(1);
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
  });

  it("online but the server answers with an error page: no reload, the network recovery screen, the guard unspent", async () => {
    origin.mockResolvedValue(new Response(null, { status: 503 }));
    open("/chunk");

    expect(await screen.findByTestId("error-boundary-network", undefined, LOAD_WAIT)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(guard()).toBeNull();
  });

  it("online but the server never answers: the question gives up after five seconds, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | null = null;
    origin.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? null;
      signal?.addEventListener("abort", () => { reject(new DOMException("The question was abandoned", "AbortError")); });
    }));
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);
    target.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    await vi.advanceTimersByTimeAsync(4_999);
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    expect(guard()).toBeNull();
  });

  it("a stylesheet that will not preload after a deploy reloads once, as a script does", async () => {
    open("/failing", underRouteErrorBoundary(failingRoutes(() => new Error("Unable to preload CSS for /assets/DiaryBoardPage-3f9a1c.css"))));

    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
    expect(Number(guard())).toBeGreaterThan(0);
    await settled();
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
  });
});

describe("the application's route table", () => {
  it("puts every route under one root with the route error boundary", async () => {
    const { router } = await import("../router.js");
    try {
      expect(router.routes).toHaveLength(1);
      const root = router.routes[0];
      expect(root?.path).toBeUndefined();
      expect(root?.hasErrorBoundary).toBe(true);
      const paths = (root?.children ?? []).map((route) => route.path);
      expect(paths).toEqual(expect.arrayContaining(["/", "*", "/plan/:code", "/proposal-share/:token", "/plan-view/:token"]));
      expect(paths.length).toBeGreaterThan(40);
    } finally {
      router.dispose();
    }
  });

  it("names RouteErrorFallback as that boundary", () => {
    const [root] = underRouteErrorBoundary([{ path: "/", element: <p>Home</p> }]);
    expect(root?.ErrorBoundary).toBe(RouteErrorFallback);
    expect(root?.children?.map((route) => route.path)).toEqual(["/"]);
  });
});
