import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { DashboardLayout, type DashboardView } from "../DashboardLayout.js";
import { InventoryNavigationGuard } from "../inventory/InventoryNavigationGuard.js";

const mocks = vi.hoisted(() => ({ venue: vi.fn(), signOut: vi.fn(), bypass: vi.fn(), notifications: vi.fn() }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: mocks.signOut }) }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.venue }));
vi.mock("../../../api/notifications.js", () => ({ listNotifications: mocks.notifications }));
vi.mock("../../../lib/e2e-auth-bypass.js", () => ({ isE2EAuthBypassEnabled: mocks.bypass }));
vi.mock("../../shared/ToastContainer.js", () => ({ ToastContainer: () => null }));
vi.mock("../NotificationCenter.js", () => ({ NotificationCenter: () => <button type="button">No unread notifications</button> }));

const admin: AuthUser = {
  id: "admin-1", name: "Elaine Campbell", email: "elaine@example.test",
  role: "admin", platformRole: "none", venueId: "venue-a",
};
const routers: ReturnType<typeof createMemoryRouter>[] = [];

function GuardedCorrection({ save }: { readonly save: () => Promise<void> }): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const [owned, setOwned] = useState("210");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saveCorrection = async (): Promise<void> => {
    setBusy(true);
    try { await save(); setOwned("200"); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  if (user === null) return <h1>Signed out</h1>;
  return <DashboardLayout activeView="inventory"><div id="inventory-correction">
    <InventoryNavigationGuard dirty={owned !== "200"} busy={busy} />
    <label>Owned<input disabled={busy} value={owned} onChange={(event) => { setOwned(event.target.value); }} /></label>
    <button type="button" disabled={busy} onClick={() => { void saveCorrection(); }}>Save correction</button>
    {failed ? <p role="alert">Save failed</p> : null}
  </div></DashboardLayout>;
}

function renderGuardedShell(save: () => Promise<void> = () => Promise.resolve()): void {
  const router = createMemoryRouter([{ path: "/dashboard", element: <GuardedCorrection save={save} /> }], {
    initialEntries: ["/dashboard?view=inventory"],
  });
  routers.push(router);
  render(<RouterProvider router={router} />);
}

function CurrentRoute(): React.ReactElement {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

function renderShell({ path = "/dashboard?view=inventory", onViewChange }: {
  readonly path?: string;
  readonly onViewChange?: (view: DashboardView) => void;
} = {}): void {
  render(<MemoryRouter initialEntries={[path]}><DashboardLayout activeView="inventory" onViewChange={onViewChange}>
    <h1>Inventory workspace</h1><button type="button">Workspace action</button><CurrentRoute />
  </DashboardLayout></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.venue.mockResolvedValue({ name: "Trades Hall" });
  mocks.notifications.mockResolvedValue([]);
  mocks.signOut.mockResolvedValue(undefined);
  mocks.bypass.mockReturnValue(false);
  useAuthStore.getState().setUser(admin);
});
afterEach(() => { cleanup(); for (const router of routers.splice(0)) router.dispose(); useAuthStore.getState().setUser(null); });

describe("DashboardLayout navigation", () => {
  it("keeps the primary destinations immediate and secondary destinations behind More", async () => {
    const onViewChange = vi.fn();
    renderShell({ onViewChange });
    expect(await screen.findByText("Trades Hall")).toBeDefined();
    expect(screen.getByRole("link", { name: "Plan" }).getAttribute("href")).toBe("/plan");
    expect(screen.getByRole("link", { name: "Diary" }).getAttribute("href")).toBe("/diary");
    expect(screen.getByRole("link", { name: "Hallkeeper" }).getAttribute("href")).toBe("/hallkeeper");
    expect(screen.getByRole("button", { name: "Inventory" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Enquiries" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Messages" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "No unread notifications" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Venue Settings" }));
    expect(onViewChange).toHaveBeenCalledWith("settings");
    expect(screen.getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("routes a secondary destination when the shell is used outside DashboardPage", async () => {
    renderShell({ path: "/diary" });
    await screen.findByText("Trades Hall");
    expect(screen.getByRole("link", { name: "Diary" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Enquiries" }));
    expect(screen.getByLabelText("Current route").textContent).toBe("/dashboard?view=enquiries");
  });

  it("dismisses the disclosure on Escape and returns focus to its trigger", async () => {
    renderShell();
    await screen.findByText("Trades Hall");
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    screen.getByRole("button", { name: "Enquiries" }).focus();
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
  });

  it("dismisses on outside focus and never leaves both disclosures open", async () => {
    renderShell();
    await screen.findByText("Trades Hall");
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    act(() => { screen.getByRole("button", { name: "Workspace action" }).focus(); });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeDefined();
    fireEvent.pointerDown(screen.getByRole("main"));
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
  });

  // Venue stock is a venue-administration surface: admin and manager only
  // (goal 18 §6 decision 6b took the hallkeeper's edit). The platform tools
  // stay behind platformRole regardless of venue role.
  it.each(["staff", "hallkeeper", "planner", "sales", "caterer"])("preserves the venue inventory and platform boundaries for %s", async (role) => {
    useAuthStore.getState().setUser({ ...admin, role });
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.queryByRole("button", { name: "Inventory" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Capture Factory" })).toBeNull();
    // A caterer is event-scoped: the venue dashboard offers it nothing.
    if (role === "caterer") expect(screen.queryByRole("button", { name: "Enquiries" })).toBeNull();
  });

  it("offers a venue manager the stock the API lets it write", async () => {
    useAuthStore.getState().setUser({ ...admin, role: "manager" });
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.getByRole("button", { name: "Inventory" })).toBeDefined();
  });

  it("offers sales the tabs its APIs admit, and neither stock nor the CRM pipeline", async () => {
    useAuthStore.getState().setUser({ ...admin, role: "sales" });
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.queryByRole("button", { name: "Inventory" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    // Proposals reads routes this branch widened to canManageCommercial, so
    // sales can open it.
    expect(screen.getByRole("button", { name: "Proposals" })).toBeDefined();
    // Pipeline reads api/crm.js, still staff-only until Lane 7 (PR #24).
    expect(screen.queryByRole("button", { name: "Pipeline" })).toBeNull();
    // Analytics is held back from sales until #24 lands (ANALYTICS_ROLES).
    expect(screen.queryByRole("button", { name: "Executive Analytics" })).toBeNull();
    // Client Search reads /clients, which gates on canManageVenue — sales is
    // refused there, so the tab is not offered.
    expect(screen.queryByRole("button", { name: "Client Search" })).toBeNull();
    // The pending-review queue takes the review state machine's role set.
    expect(screen.queryByRole("button", { name: "Pending Reviews" })).toBeNull();
  });

  it("preserves platform tools without granting venue stock authority", async () => {
    useAuthStore.getState().setUser({ ...admin, role: "staff", platformRole: "admin" });
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.queryByRole("button", { name: "Inventory" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "Admin" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Capture Factory" })).toBeDefined();
  });

  it("signs out of both Clerk and the local auth store", async () => {
    renderShell();
    await screen.findByText("Trades Hall");
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    expect(screen.getByText("elaine@example.test")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("keeps local fixture sign-out independent from Clerk", async () => {
    mocks.bypass.mockReturnValue(true);
    renderShell();
    await screen.findByText("Trades Hall");
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("discards a prior venue response and clears the old identity while switching venues", async () => {
    let resolveOld: ((value: { name: string }) => void) | undefined;
    mocks.venue.mockImplementation((venueId: string) => venueId === "venue-a"
      ? new Promise<{ name: string }>((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ name: "Current venue" }));
    renderShell();
    expect(screen.getByText("Opening venue…")).toBeDefined();
    act(() => { useAuthStore.getState().setUser({ ...admin, venueId: "venue-b" }); });
    expect(await screen.findByText("Current venue")).toBeDefined();
    await act(async () => { resolveOld?.({ name: "Old venue" }); await Promise.resolve(); });
    expect(screen.queryByText("Old venue")).toBeNull();
    await waitFor(() => { expect(screen.queryByText("Opening venue…")).toBeNull(); });
  });

  it.each([false, true])("guards the entire sign-out action and restores the stock field (local fixture: %s)", async (localFixture) => {
    mocks.bypass.mockReturnValue(localFixture);
    renderGuardedShell();
    await screen.findByText("Trades Hall");
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("dialog", { name: "Sign out with an unfinished correction?" });
    expect(useAuthStore.getState().user).toEqual(admin);
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByLabelText("Owned")); });
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and sign out" }));
    expect(await screen.findByRole("heading", { name: "Signed out" })).toBeDefined();
    expect(mocks.signOut).toHaveBeenCalledTimes(localFixture ? 0 : 1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("holds both auth changes until the in-flight stock save is confirmed", async () => {
    let confirm: (() => void) | undefined;
    const saved = new Promise<void>((resolve) => { confirm = resolve; });
    renderGuardedShell(() => saved);
    await screen.findByText("Trades Hall");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("dialog", { name: "Saving your stock correction" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Discard and sign out" }).disabled).toBe(true);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(admin);
    await act(async () => { confirm?.(); await saved; });
    expect(await screen.findByRole("heading", { name: "Signed out" })).toBeDefined();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("retains auth and the dirty correction after an unsuccessful held save", async () => {
    let rejectSave: ((reason: Error) => void) | undefined;
    const saved = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    renderGuardedShell(() => saved);
    await screen.findByText("Trades Hall");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    fireEvent.click(screen.getByRole("button", { name: "Account: Elaine Campbell" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("dialog", { name: "Saving your stock correction" });
    await act(async () => { rejectSave?.(new Error("Network unavailable")); await saved.catch(() => undefined); });
    await screen.findByRole("dialog", { name: "Sign out with an unfinished correction?" });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(admin);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByLabelText("Owned")); });
    expect(screen.getByLabelText<HTMLInputElement>("Owned").value).toBe("210");
  });
});

// ---------------------------------------------------------------------------
// The unread count belongs on the row you can see
//
// NotificationCenter renders its badge inside the More popover, which is
// `hidden` until opened — so "unread count on the visible nav" was not met:
// nothing on screen said a change had landed. The chip below sits in the nav
// landmark itself.
//
// happy-dom applies no CSS, so these cases pin the STRUCTURE the widths rely
// on rather than a rendered layout: the chip is inside <nav>, it is reachable
// while the popover is closed (a `hidden` subtree is out of the accessibility
// tree, which is exactly why the badge was not), and the popover's own
// contents stay where they were. The widths are set because the nav is a grid
// row of its own below 960px and a flex row above it, and the chip must live
// on both.
// ---------------------------------------------------------------------------
describe("unread notifications on the visible nav", () => {
  const widths = [390, 1366];
  const unread = [
    { id: "n-1", readAt: null },
    { id: "n-2", readAt: null },
    { id: "n-3", readAt: "2026-09-16T08:00:00.000Z" },
  ];

  function atWidth(width: number, run: () => Promise<void>): Promise<void> {
    const previous = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.dispatchEvent(new Event("resize"));
    return run().finally(() => {
      if (previous === undefined) return;
      Object.defineProperty(window, "innerWidth", previous);
    });
  }

  for (const width of widths) {
    it(`shows the unread count in the nav row at ${String(width)}px, without opening anything`, async () => {
      mocks.notifications.mockResolvedValue(unread);
      await atWidth(width, async () => {
        renderShell();
        const chip = await screen.findByRole("button", { name: "Notifications: 2 unread" });
        const navigation = screen.getByRole("navigation", { name: "Staff dashboard" });
        expect(navigation.contains(chip)).toBe(true);
        expect(chip.getAttribute("aria-expanded")).toBe("false");
        // The popover — and the badge inside it — is still closed.
        expect(screen.queryByRole("button", { name: "No unread notifications" })).toBeNull();
        expect(mocks.notifications).toHaveBeenCalledWith("unread", 20);
      });
    });
  }

  it("opens the notifications popover from the chip and leaves its contents alone", async () => {
    mocks.notifications.mockResolvedValue(unread);
    renderShell();
    const chip = await screen.findByRole("button", { name: "Notifications: 2 unread" });
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "No unread notifications" })).toBeDefined();
    expect(screen.getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chip);
    expect(screen.queryByRole("button", { name: "No unread notifications" })).toBeNull();
  });

  it("re-reads the count when the popover closes, because reading happens inside it", async () => {
    mocks.notifications.mockResolvedValue(unread);
    renderShell();
    await screen.findByRole("button", { name: "Notifications: 2 unread" });
    expect(mocks.notifications).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    mocks.notifications.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^Notifications:/u })).toBeNull(); });
    expect(mocks.notifications).toHaveBeenCalledTimes(2);
  });

  it("shows no chip when there is nothing unread, and none when the call fails", async () => {
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.queryByRole("button", { name: /^Notifications:/u })).toBeNull();
    cleanup();
    mocks.notifications.mockRejectedValue(new Error("notifications unavailable"));
    renderShell();
    await screen.findByText("Trades Hall");
    expect(screen.queryByRole("button", { name: /^Notifications:/u })).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toBeDefined();
  });
});
