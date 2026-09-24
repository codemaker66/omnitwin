import { lazy, useEffect, type ComponentType, type ReactElement, type ReactNode } from "react";
import type { Window as HappyWindow } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import type { AuthUser } from "../../../stores/auth-store.js";

// Guarded pages request their code while the account check runs, but only the
// guard decides whether they render or fetch. These tests drive the actual
// application route table: a guarded page wired to the wrong preload, or not
// wired at all, fails the load-before-authorization assertions below.
//
// Vitest keeps a mocked module across resetModules(), so each mock exposes its
// component through a getter: every router instance's lazy loader reads it
// once when its import resolves, which records that load for this test.

const probe = vi.hoisted(() => ({
  loaded: [] as string[],
  rendered: [] as string[],
  fetched: [] as string[],
  sessionHint: false,
  /** Keeps the Clerk provider suspended until released. */
  providerReady: Promise.resolve(),
}));

function pageModule(name: string): Record<string, ComponentType> {
  function Page(): ReactElement {
    probe.rendered.push(name);
    useEffect(() => { probe.fetched.push(name); }, []);
    return <h1>{`${name} ready`}</h1>;
  }
  return Object.defineProperty({}, name, {
    enumerable: true,
    get: () => {
      probe.loaded.push(name);
      return Page;
    },
  });
}

function PassThrough({ children }: { readonly children?: ReactNode }): ReactNode {
  return children;
}

vi.mock("../ClerkRouteProvider.js", () => ({
  get ClerkRouteProvider() {
    probe.loaded.push("ClerkRouteProvider");
    const ready = probe.providerReady;
    const Provided = lazy(async () => {
      await ready;
      return { default: PassThrough };
    });
    return function ClerkRouteProvider({ children }: { readonly children: ReactNode }): ReactElement {
      return <Provided>{children}</Provided>;
    };
  },
}));
vi.mock("../../../lib/clerk-session-hint.js", () => ({ hasLikelyClerkSession: () => probe.sessionHint }));
vi.mock("../../../pages/LoginPage.js", () => ({ LoginPage: () => <div>Sign in page</div> }));
vi.mock("../../../pages/hallkeeper/DayBoardPage.js", () => pageModule("DayBoardPage"));
vi.mock("../../../pages/hallkeeper/HallkeeperRoomPlansPage.js", () => pageModule("HallkeeperRoomPlansPage"));
vi.mock("../../../pages/hallkeeper/HallkeeperWalkthroughPage.js", () => pageModule("HallkeeperWalkthroughPage"));
vi.mock("../../../pages/HallkeeperPage.js", () => pageModule("HallkeeperPage"));
vi.mock("../../../pages/diary/DiaryBoardPage.js", () => pageModule("DiaryBoardPage"));
vi.mock("../../../pages/DashboardPage.js", () => pageModule("DashboardPage"));
vi.mock("../../../pages/OpsHandoffPage.js", () => pageModule("OpsHandoffPage"));
vi.mock("../../../pages/EventDayOpsPage.js", () => pageModule("EventDayOpsPage"));
vi.mock("../../../pages/ClientEventPage.js", () => pageModule("ClientEventPage"));
vi.mock("../../../pages/EventArchitectPage.js", () => pageModule("EventArchitectPage"));
vi.mock("../../../pages/TradesHallAssetStatusPage.js", () => pageModule("TradesHallAssetStatusPage"));
vi.mock("../../../pages/CaptureIntakePage.js", () => pageModule("CaptureIntakePage"));
vi.mock("../../../pages/EditorPage.js", () => pageModule("EditorPage"));

type Access = Pick<AuthUser, "role" | "platformRole">;

interface GuardedRoute {
  readonly path: string;
  readonly page: string;
  readonly allowed: Access;
}

interface DeniedRoute extends GuardedRoute {
  /** A signed-in account the guard turns away, and the heading it sees. */
  readonly denied: Access;
  readonly heading: string;
}

const client: Access = { role: "client", platformRole: "none" };
const planner: Access = { role: "planner", platformRole: "none" };
const DENIED: readonly DeniedRoute[] = [
  { path: "/hallkeeper/today", page: "DayBoardPage", allowed: { role: "hallkeeper", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/hallkeeper/rooms", page: "HallkeeperRoomPlansPage", allowed: planner, denied: client, heading: "Access needed" },
  { path: "/hallkeeper/walkthrough", page: "HallkeeperWalkthroughPage", allowed: { role: "staff", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/hallkeeper/config-1", page: "HallkeeperPage", allowed: { role: "hallkeeper", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/diary", page: "DiaryBoardPage", allowed: { role: "staff", platformRole: "none" }, denied: planner, heading: "Access needed" },
  { path: "/dashboard", page: "DashboardPage", allowed: { role: "executive", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/ops/handoff/pack-1", page: "OpsHandoffPage", allowed: { role: "admin", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/ops/events/event-1", page: "EventDayOpsPage", allowed: { role: "hallkeeper", platformRole: "none" }, denied: planner, heading: "Access needed" },
  { path: "/event-architect", page: "EventArchitectPage", allowed: { role: "staff", platformRole: "none" }, denied: client, heading: "Access needed" },
  { path: "/event-architect/runs/run-1", page: "EventArchitectPage", allowed: { role: "client", platformRole: "admin" }, denied: planner, heading: "Access needed" },
  { path: "/dev/assets/rooms", page: "TradesHallAssetStatusPage", allowed: { role: "admin", platformRole: "admin" }, denied: { role: "admin", platformRole: "none" }, heading: "Platform access needed" },
  { path: "/dev/capture-intake", page: "CaptureIntakePage", allowed: { role: "admin", platformRole: "admin" }, denied: { role: "staff", platformRole: "admin" }, heading: "Access needed" },
];
// Every signed-in account may open its own client event page.
const GUARDED: readonly GuardedRoute[] = [...DENIED, { path: "/events/event-1", page: "ClientEventPage", allowed: client }];

const browserSettings = window.happyDOM.settings as typeof window.happyDOM.settings
  & Pick<HappyWindow["happyDOM"]["settings"], "disableCSSFileLoading" | "handleDisabledFileLoadingAsSuccess">;
const previousCssLoading = browserSettings.disableCSSFileLoading;
const previousDisabledLoading = browserSettings.handleDisabledFileLoadingAsSuccess;

// The real router attaches a font stylesheet with the first cockpit chunk;
// network fonts are unrelated to route admission and must not escape here.
beforeAll(() => {
  browserSettings.disableCSSFileLoading = true;
  browserSettings.handleDisabledFileLoadingAsSuccess = true;
});
afterAll(() => {
  browserSettings.disableCSSFileLoading = previousCssLoading;
  browserSettings.handleDisabledFileLoadingAsSuccess = previousDisabledLoading;
});

type AuthStore = typeof import("../../../stores/auth-store.js").useAuthStore;
let authStore: AuthStore;
let routes: RouteObject[];
let disposeApp: () => void = () => undefined;
const mountedRouters: ReturnType<typeof createMemoryRouter>[] = [];

// Fresh router module per case, so no lazy page is already loaded.
beforeEach(async () => {
  vi.resetModules();
  probe.loaded.length = 0;
  probe.rendered.length = 0;
  probe.fetched.length = 0;
  probe.sessionHint = false;
  probe.providerReady = Promise.resolve();
  const [app, auth] = await Promise.all([import("../../../router.js"), import("../../../stores/auth-store.js")]);
  authStore = auth.useAuthStore;
  routes = app.router.routes;
  disposeApp = () => { app.router.dispose(); };
});

afterEach(() => {
  cleanup();
  for (const memoryRouter of mountedRouters.splice(0)) memoryRouter.dispose();
  disposeApp();
});

function account(access: Access): AuthUser {
  return { id: "actor", name: "Actor", email: "actor@example.test", venueId: "venue", ...access };
}

function show(path: string): ReturnType<typeof createMemoryRouter> {
  const memoryRouter = createMemoryRouter(routes, { initialEntries: [path] });
  mountedRouters.push(memoryRouter);
  render(<RouterProvider router={memoryRouter} />);
  return memoryRouter;
}

describe.each(GUARDED)("guarded route $path", (route) => {
  it("loads the page's code while access is checked, then renders it only once authorized", async () => {
    authStore.setState({ user: null, isAuthenticated: false, isLoading: true, accessStatus: "checking" });
    show(route.path);
    expect(await screen.findByText("Checking access…")).toBeTruthy();
    await vi.waitFor(() => { expect(probe.loaded).toEqual(["ClerkRouteProvider", route.page]); });
    expect(screen.getByText("Checking access…")).toBeTruthy();
    expect(probe.rendered).toEqual([]);
    expect(probe.fetched).toEqual([]);

    act(() => { authStore.getState().setUser(account(route.allowed)); });
    expect(await screen.findByRole("heading", { name: `${route.page} ready` })).toBeTruthy();
    expect(probe.fetched).toEqual([route.page]);
    // Preload and render shared one import.
    expect(probe.loaded).toEqual(["ClerkRouteProvider", route.page]);
  });

  it("sends a signed-out visitor to sign in without rendering or fetching the page", async () => {
    authStore.getState().logout();
    const memoryRouter = show(route.path);
    expect(await screen.findByText("Sign in page")).toBeTruthy();
    expect(memoryRouter.state.location.pathname).toBe("/login");
    expect(probe.rendered).toEqual([]);
    expect(probe.fetched).toEqual([]);
  });
});

describe.each(DENIED)("denied route $path", (route) => {
  it("shows a denied account the same state without rendering or fetching the page", async () => {
    authStore.getState().setUser(account(route.denied));
    show(route.path);
    expect((await screen.findByRole("alert")).textContent).toContain(route.heading);
    await vi.waitFor(() => { expect(probe.loaded).toContain(route.page); });
    expect(screen.getByRole("alert").textContent).toContain(route.heading);
    expect(probe.rendered).toEqual([]);
    expect(probe.fetched).toEqual([]);
  });
});

describe("planner route code", () => {
  it("keeps a guest's planner Clerk-free", async () => {
    authStore.setState({ user: null, isAuthenticated: false, isLoading: true, accessStatus: "signed_out" });
    show("/plan");
    expect(await screen.findByRole("heading", { name: "EditorPage ready" })).toBeTruthy();
    expect(probe.loaded).toEqual(["EditorPage"]);
  });

  it("loads a signed-in planner's page before the Clerk provider is ready, provider first", async () => {
    let releaseProvider: () => void = () => undefined;
    probe.providerReady = new Promise((resolve) => { releaseProvider = resolve; });
    probe.sessionHint = true;
    authStore.setState({ user: null, isAuthenticated: false, isLoading: true, accessStatus: "signed_out" });
    show("/plan/config-1");
    await vi.waitFor(() => { expect(probe.loaded).toEqual(["ClerkRouteProvider", "EditorPage"]); });
    expect(probe.rendered).toEqual([]);
    act(() => { releaseProvider(); });
    expect(await screen.findByRole("heading", { name: "EditorPage ready" })).toBeTruthy();
    expect(probe.loaded).toEqual(["ClerkRouteProvider", "EditorPage"]);
  });
});
