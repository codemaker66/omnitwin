import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { DashboardLayout, PersistentStaffShell, forgetKnownVenueNames } from "../DashboardLayout.js";
import { ProtectedRoute } from "../../auth/ProtectedRoute.js";

// ---------------------------------------------------------------------------
// The persistent staff shell (roadmap N2): the header is drawn once and stays
// while the staff pages beneath it change. Each page still wears
// <DashboardLayout>, which inside the shell hands its frame up rather than
// drawing a second header.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ venue: vi.fn(), unreadCount: vi.fn(), signOut: vi.fn() }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: mocks.signOut }) }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.venue }));
vi.mock("../../../api/notifications.js", () => ({ getUnreadNotificationCount: mocks.unreadCount }));
// The bypass keeps the shell's live inbox channel shut (no socket server
// here); the second flag is what a harness with a real API would raise.
vi.mock("../../../lib/e2e-auth-bypass.js", () => ({ isE2EAuthBypassEnabled: () => true, isE2ELiveSocketEnabled: () => false }));
vi.mock("../NotificationCenter.js", () => ({ NotificationCenter: () => null }));

const staff: AuthUser = {
  id: "staff-1", name: "Fiona Coordinator", email: "fiona@example.test",
  role: "staff", platformRole: "none", venueId: "venue-a",
};
const routers: ReturnType<typeof createMemoryRouter>[] = [];

function Desk(): React.ReactElement {
  return <DashboardLayout activeView="enquiries" onViewChange={vi.fn()} surface="desk">
    <h1>The desk</h1>
    <Link to="/diary">Open the Diary here</Link>
  </DashboardLayout>;
}

function Diary(): React.ReactElement {
  return <DashboardLayout mainLabel="The Diary"><h1>The board</h1></DashboardLayout>;
}

/** A page that puts focus where its work starts, as the Diary's hold drawer does. */
function Hold(): React.ReactElement {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  return <DashboardLayout mainLabel="The Diary"><label>Title<input ref={titleRef} /></label></DashboardLayout>;
}

function openShell(path: string): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([{
    element: <PersistentStaffShell />,
    children: [
      { path: "/dashboard", element: <Desk /> },
      { path: "/diary", element: <Diary /> },
      { path: "/diary/hold", element: <Hold /> },
      { path: "/dev/tools", element: <ProtectedRoute allowedRoles={["admin"]}><h1>Admin tools</h1></ProtectedRoute> },
    ],
  }], { initialEntries: [path] });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  forgetKnownVenueNames();
  mocks.venue.mockResolvedValue({ id: "venue-a", name: "Trade's Hall of Glasgow" });
  mocks.unreadCount.mockResolvedValue(3);
  useAuthStore.setState({ user: staff, isAuthenticated: true, isLoading: false, error: null, accessStatus: "ready" });
});

afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null, accessStatus: "signed_out" });
});

describe("the persistent staff shell", () => {
  it("keeps one header while the pages beneath it change, naming each page's workspace", async () => {
    const router = openShell("/dashboard?view=enquiries");
    expect(await screen.findByRole("heading", { name: "The desk" })).toBeDefined();
    const header = document.querySelector("header.dashboard-layout-header");
    expect(header).not.toBeNull();
    expect(await screen.findByLabelText("Notifications: 3 unread")).toBeDefined();
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("Enquiries");
    expect(document.querySelector(".dashboard-layout-main--desk")).not.toBeNull();

    await act(async () => { await router.navigate("/diary"); });
    expect(await screen.findByRole("heading", { name: "The board" })).toBeDefined();
    // The same element, not a new header drawn over the old one.
    expect(document.querySelector("header.dashboard-layout-header")).toBe(header);
    expect(document.querySelectorAll("header.dashboard-layout-header")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("The Diary");
    expect(document.querySelector(".dashboard-layout-main--desk")).toBeNull();
    expect(document.querySelector(".dashboard-layout-main--diary")).not.toBeNull();
    await waitFor(() => { expect(document.title).toBe("The Diary · Trade's Hall of Glasgow — Venviewer"); });
    // The unread count stays on the row, read once rather than again per page.
    expect(screen.getByLabelText("Notifications: 3 unread")).toBeDefined();
    expect(mocks.unreadCount).toHaveBeenCalledTimes(1);
    expect(mocks.venue).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the new page's workspace when a link leaves it on the old one", async () => {
    openShell("/dashboard?view=enquiries");
    await screen.findByRole("heading", { name: "The desk" });
    const diaryLink = screen.getByRole("link", { name: "Diary" });
    diaryLink.focus();
    fireEvent.click(diaryLink);
    expect(await screen.findByRole("heading", { name: "The board" })).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("main")); });
  });

  it("moves focus to the workspace when the pressed link left with the old page", async () => {
    openShell("/dashboard?view=enquiries");
    fireEvent.click(await screen.findByRole("link", { name: "Open the Diary here" }));
    expect(await screen.findByRole("heading", { name: "The board" })).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("main")); });
  });

  it("leaves focus where the new page put it", async () => {
    const router = openShell("/dashboard?view=enquiries");
    await screen.findByRole("heading", { name: "The desk" });
    screen.getByRole("link", { name: "Diary" }).focus();
    await act(async () => { await router.navigate("/diary/hold"); });
    const title = await screen.findByLabelText("Title");
    await waitFor(() => { expect(document.activeElement).toBe(title); });
  });

  it("says a refusal inside the workspace, under the header, with no second main landmark", async () => {
    openShell("/dev/tools");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Access needed");
    expect(screen.getByRole("link", { name: "Back to Venviewer" }).getAttribute("href")).toBe("/");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("Workspace access denied");
    expect(document.querySelector("header.dashboard-layout-header")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Admin tools" })).toBeNull();
  });
});

describe("a page on its own", () => {
  it("still draws its own header outside the shell", async () => {
    const router = createMemoryRouter([{ path: "/diary", element: <Diary /> }], { initialEntries: ["/diary"] });
    routers.push(router);
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "The board" })).toBeDefined();
    expect(document.querySelectorAll("header.dashboard-layout-header")).toHaveLength(1);
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("The Diary");
  });
});
