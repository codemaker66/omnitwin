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

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureBoundaryErrorMock.mockClear();
  window.sessionStorage.clear();
  reload = vi.spyOn(stalePage, "reload").mockImplementation(() => undefined);
  // React and React Router report caught errors on the console; keep the run quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
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
  });

  it("does not reload again while the guard is fresh: the recovery screen shows and Sentry hears of it", async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now() - 5_000));
    open("/chunk");

    expect(await screen.findByTestId("error-boundary-network", undefined, LOAD_WAIT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(RAW_PAGE)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1);
  });

  it("reloads again for a later deploy, once the guard is over a minute old", async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now() - 120_000));
    open("/chunk");

    await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); }, LOAD_WAIT);
  });

  it("recognises the chunk failures of Chrome, Safari and Firefox, and nothing else", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("Vite's preload failure", () => {
  it("reloads once, and lets a second failure inside the minute through to the route boundary", () => {
    const target = new EventTarget() as Window;
    installStaleChunkReload(target);

    const first = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    const second = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
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
