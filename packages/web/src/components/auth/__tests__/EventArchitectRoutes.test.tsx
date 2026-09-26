import type { ReactNode } from "react";
import type { Window as HappyWindow } from "happy-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { router } from "../../../router.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { ApiError } from "../../../api/client.js";

const { mountTool, getProjection } = vi.hoisted(() => ({ mountTool: vi.fn(), getProjection: vi.fn() }));
vi.mock("../ClerkRouteProvider.js", () => ({
  ClerkRouteProvider: ({ children }: { readonly children: ReactNode }) => children,
}));
// The provider is stubbed above, so the denial screen's "Use another account"
// needs Clerk's hook stubbed with it.
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn() }) }));
vi.mock("../../../pages/EventArchitectPage.js", () => ({
  EventArchitectPage: () => { mountTool(); return <div>Event Architect engine</div>; },
}));
vi.mock("../../../api/client-event-schedule.js", () => ({ getClientEventSchedule: getProjection }));
vi.mock("../../../pages/LoginPage.js", () => ({ LoginPage: () => <div>Sign in page</div> }));

// Use the actual application's route elements, rather than wrapping a fixture
// in the desired guard: an omitted alias guard must fail this regression.
const routes = router.routes.filter(route => ["/event-architect", "/event-architect/runs/:runId", "/events/:eventId", "/login"].includes(route.path ?? ""));
const mountedRouters: ReturnType<typeof createMemoryRouter>[] = [];
const paths = ["/event-architect", "/event-architect/runs/00000000-0000-4000-8000-000000000001"];
const browserSettings = window.happyDOM.settings as typeof window.happyDOM.settings
  & Pick<HappyWindow["happyDOM"]["settings"], "disableCSSFileLoading" | "handleDisabledFileLoadingAsSuccess">;
const previousCssLoading = browserSettings.disableCSSFileLoading;
const previousDisabledLoading = browserSettings.handleDisabledFileLoadingAsSuccess;

// The real router attaches a font stylesheet on lazy arrival; network fonts
// are unrelated to route admission and must not escape this isolated test.
beforeAll(async () => {
  browserSettings.disableCSSFileLoading = true;
  browserSettings.handleDisabledFileLoadingAsSuccess = true;
  // Preload the real lazy page so initial module transformation does not
  // consume the assertion window for these route-admission checks.
  await import("../../../pages/ClientEventPage.js");
});

function seed(role: string, platformRole: "none" | "admin" = "none") {
  useAuthStore.getState().setUser({ id: "actor", name: "Actor", email: "actor@example.test", role, platformRole, venueId: "venue" });
}
function show(path: string) {
  const memoryRouter = createMemoryRouter(routes, { initialEntries: [path] });
  mountedRouters.push(memoryRouter);
  render(<RouterProvider router={memoryRouter} />);
  return memoryRouter;
}

afterEach(() => {
  cleanup();
  for (const memoryRouter of mountedRouters.splice(0)) memoryRouter.dispose();
  useAuthStore.getState().logout();
  mountTool.mockClear();
  getProjection.mockReset();
});

describe("client event page route admission", () => {
  const eventId = "00000000-0000-4000-8000-000000000002";
  const venueId = "00000000-0000-4000-8000-000000000003";
  const path = `/events/${eventId}`;
  const schedule = {
    event: { id: eventId, venueId, name: "Your planning event", eventType: null, status: "in_planning",
      startsAt: null, endsAt: null, guestCount: 20 },
    venue: { id: venueId, name: "Your venue", timezone: "Europe/London" }, scheduleState: "working", phases: [], layouts: [],
  };

  it.each([
    { role: "client", platformRole: "none" }, { role: "planner", platformRole: "none" },
    { role: "manager", platformRole: "admin" }, { role: "caterer", platformRole: "admin" },
  ] as const)("admits $role with platform role $platformRole to its server projection", async actor => {
    seed(actor.role, actor.platformRole);
    getProjection.mockResolvedValue(schedule);
    show(path);
    expect(await screen.findByRole("heading", { name: "Your planning event" })).toBeTruthy();
    expect(getProjection).toHaveBeenCalledWith(eventId, undefined, expect.any(AbortSignal));
    expect(mountTool).not.toHaveBeenCalled();
  });

  it("uses the unavailable state when the server denies an unsupported role", async () => {
    seed("caterer");
    getProjection.mockRejectedValue(new ApiError(404, "Event unavailable", "NOT_FOUND"));
    show(path);
    expect((await screen.findByRole("alert")).textContent).toContain("This event is not available to your account");
    expect(getProjection).toHaveBeenCalledTimes(1);
    expect(mountTool).not.toHaveBeenCalled();
  });

  it("keeps signed-out visitors at sign-in without fetching a projection", async () => {
    useAuthStore.getState().logout();
    const memoryRouter = show(path);
    expect(await screen.findByText("Sign in page")).toBeTruthy();
    expect(memoryRouter.state.location.pathname).toBe("/login");
    expect(getProjection).not.toHaveBeenCalled();
  });

  it("waits for authentication before fetching the projection", async () => {
    seed("client");
    useAuthStore.getState().setLoading(true);
    show(path);
    expect(await screen.findByText("Checking access…")).toBeTruthy();
    expect(getProjection).not.toHaveBeenCalled();
  });
});
afterAll(() => {
  router.dispose();
  browserSettings.disableCSSFileLoading = previousCssLoading;
  browserSettings.handleDisabledFileLoadingAsSuccess = previousDisabledLoading;
});

describe.each(paths)("Event Architect route %s", path => {
  it.each(["client", "planner"])("denies %s before mounting the internal tool", async role => {
    seed(role);
    show(path);
    expect((await screen.findByRole("alert")).textContent).toContain("Access needed");
    expect(mountTool).not.toHaveBeenCalled();
  });

  it.each(["staff", "admin", "hallkeeper", "platform"])("admits current %s authority", async role => {
    if (role === "platform") seed("client", "admin");
    else seed(role);
    show(path);
    expect(await screen.findByText("Event Architect engine")).toBeTruthy();
    expect(mountTool).toHaveBeenCalled();
  });

  it("waits for authentication before mounting a cached staff tool", async () => {
    seed("staff");
    useAuthStore.getState().setLoading(true);
    show(path);
    expect(await screen.findByText("Checking access…")).toBeTruthy();
    expect(mountTool).not.toHaveBeenCalled();
  });

  it("unmounts the tool immediately after the account becomes a customer", async () => {
    seed("staff");
    show(path);
    expect(await screen.findByText("Event Architect engine")).toBeTruthy();
    act(() => { seed("planner"); });
    expect(screen.queryByText("Event Architect engine")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Access needed");
  });
});
