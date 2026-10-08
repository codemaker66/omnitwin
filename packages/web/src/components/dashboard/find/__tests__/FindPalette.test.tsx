import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResults } from "../../../../api/clients.js";
import { useAuthStore, type AuthUser } from "../../../../stores/auth-store.js";
import { DashboardLayout, forgetKnownVenueNames } from "../../DashboardLayout.js";

// ---------------------------------------------------------------------------
// Find in the staff header (T-635, roadmap Tier A #8), as a person uses it:
// Ctrl/⌘K or the header's button, a name, a date or a page, the arrow keys
// and Enter, and the place it opens.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ search: vi.fn(), venue: vi.fn() }));
vi.mock("../../../../api/clients.js", () => ({ searchClients: mocks.search }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn() }) }));
vi.mock("../../../../api/spaces.js", () => ({ getVenue: mocks.venue }));
vi.mock("../../../../api/notifications.js", () => ({ getUnreadNotificationCount: () => Promise.resolve(0) }));
vi.mock("../../../../lib/requests-live.js", () => ({ listensForFloorRequests: () => false, subscribeRequestsLive: () => () => undefined }));
vi.mock("../../NotificationCenter.js", () => ({ NotificationCenter: () => null }));
vi.mock("../../../shared/ToastContainer.js", () => ({ ToastContainer: () => null }));

const AILSA = "00000000-0000-4000-8000-000000009511";
const DEAL = "00000000-0000-4000-8000-000000009531";
const LAYOUT = "00000000-0000-4000-8000-000000009571";
const NOTHING: SearchResults = { users: [], guestLeads: [], configurations: [], contacts: [], accounts: [], deals: [], proposals: [] };
const HENDERSON: SearchResults = {
  ...NOTHING,
  contacts: [{ id: AILSA, name: "Ailsa Henderson", email: "ailsa@example.test", phone: null, accountName: "Henderson Family" }],
  deals: [{ id: DEAL, title: "Wedding reception, 5 June", stage: "proposal_sent", preferredDate: "2027-06-05", guestCount: 160, contactName: "Ailsa Henderson" }],
  configurations: [{ id: LAYOUT, name: "Henderson rounds", spaceName: "Grand Hall", userName: "Ailsa Henderson", createdAt: "2026-09-01T10:00:00.000Z" }],
};

function person(role: string): AuthUser {
  return { id: `${role}-1`, name: "Catherine Tait", email: "catherine@example.test", role, platformRole: "none", venueId: "venue-a" };
}

function Route(): React.ReactElement {
  const location = useLocation();
  return <output aria-label="Route">{location.pathname}{location.search}</output>;
}

function renderShell(children: React.ReactNode = <p>Workspace</p>): void {
  render(
    <MemoryRouter initialEntries={["/dashboard?view=enquiries"]}>
      <DashboardLayout activeView="enquiries" mainLabel="Enquiries">{children}</DashboardLayout>
      <Route />
    </MemoryRouter>,
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function openFind(): HTMLElement {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.getByRole("dialog", { name: "Find" });
}

function field(): HTMLInputElement {
  const input = screen.getByRole("combobox", { name: "Find" });
  if (!(input instanceof HTMLInputElement)) throw new Error("expected Find's field");
  return input;
}

function activeOption(): string | null {
  const id = field().getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id)?.getAttribute("aria-label") ?? null;
}

function route(): string | null {
  return screen.getByRole("status", { name: "Route" }).textContent;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 10:00 in Glasgow on Wednesday 7 October 2026.
  vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
  mocks.venue.mockResolvedValue({ id: "venue-a", name: "Trades Hall Glasgow" });
  mocks.search.mockResolvedValue(NOTHING);
  useAuthStore.setState({ user: person("staff"), isAuthenticated: true, isLoading: false, error: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  forgetKnownVenueNames();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
});

describe("Find in the staff header", () => {
  it("opens with Ctrl+K or ⌘K from anywhere, a field included, closes on the same keys or Escape, and hands focus back", () => {
    renderShell(<input aria-label="A note" />);
    const note = screen.getByRole("textbox", { name: "A note" });
    note.focus();
    fireEvent.keyDown(note, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();

    const button = screen.getByRole("button", { name: "Find" });
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("names its keys on the header's button", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Find" }).getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
  });

  it("never opens over another dialog", () => {
    renderShell(<div role="dialog" aria-modal="true" aria-label="Hold a date"><button type="button">Save</button></div>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
  });

  it("lists the header's own pages before anything is typed, and opens a page by a team's word with Enter", () => {
    renderShell();
    const find = openFind();
    const pages = within(find).getAllByRole("option").map((option) => option.getAttribute("aria-label")?.split(",")[0]);
    expect(pages).toEqual(["Plan", "Diary", "Hallkeeper", "Rota", "Enquiries", "Pipeline", "Pending reviews",
      "Executive analytics", "Proposals", "Clients", "Reference loadouts", "Venue settings"]);
    fireEvent.change(field(), { target: { value: "quotes" } });
    expect(activeOption()).toBe("Proposals, page, Proposals and their versions");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
    expect(route()).toBe("/dashboard?view=proposals");
  });

  it("answers a date with the Diary on that day, room by room", () => {
    renderShell();
    openFind();
    fireEvent.change(field(), { target: { value: "14 nov" } });
    expect(activeOption()).toBe("Saturday 14 November 2026, See each room in the Diary");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(route()).toBe("/diary?date=2026-11-14&goto=2026-11-14");
  });

  it("searches clients once typing settles, says so while it does, and opens the client on the Clients desk", async () => {
    const answer = deferred<SearchResults>();
    mocks.search.mockReturnValue(answer.promise);
    renderShell();
    openFind();
    for (const value of ["h", "he", "hen", "henderson"]) fireEvent.change(field(), { target: { value } });
    // Until the answer comes, Enter would take the person to the Clients desk.
    expect(activeOption()).toBe("Search clients for “henderson”, See everything found on the Clients desk");
    await waitFor(() => { expect(mocks.search).toHaveBeenCalledTimes(1); });
    expect(mocks.search).toHaveBeenCalledWith("henderson");
    expect(screen.getByText("Searching clients…")).toBeDefined();
    await act(async () => { answer.resolve(HENDERSON); await answer.promise; });
    expect(screen.queryByText("Searching clients…")).toBeNull();
    // The best finding is first, and Enter opens it.
    expect(activeOption()).toBe("Ailsa Henderson, contact, Henderson Family · ailsa@example.test");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(activeOption()).toMatch(/^Wedding reception, 5 June, deal/u);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(route()).toBe(`/dashboard?view=search&q=henderson&client=contact%3A${AILSA}`);
  });

  it("keeps the row the person moved to while findings arrive", async () => {
    const answer = deferred<SearchResults>();
    mocks.search.mockReturnValue(answer.promise);
    renderShell();
    openFind();
    // "deals" finds the Pipeline by a team's word, then the search row.
    fireEvent.change(field(), { target: { value: "deals" } });
    expect(activeOption()).toBe("Pipeline, page, Deals by their next step");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(activeOption()).toBe("Search clients for “deals”, See everything found on the Clients desk");
    await waitFor(() => { expect(mocks.search).toHaveBeenCalledTimes(1); });
    await act(async () => { answer.resolve(HENDERSON); await answer.promise; });
    expect(within(screen.getByRole("listbox", { name: "Found" })).getByRole("option", { name: /^Ailsa Henderson/u })).toBeDefined();
    expect(activeOption()).toBe("Search clients for “deals”, See everything found on the Clients desk");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(route()).toBe("/dashboard?view=search&q=deals");
  });

  it("never shows an earlier query's answer", async () => {
    const first = deferred<SearchResults>();
    const second = deferred<SearchResults>();
    mocks.search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderShell();
    openFind();
    fireEvent.change(field(), { target: { value: "hend" } });
    await waitFor(() => { expect(mocks.search).toHaveBeenCalledWith("hend"); });
    fireEvent.change(field(), { target: { value: "mcdonald" } });
    await waitFor(() => { expect(mocks.search).toHaveBeenCalledWith("mcdonald"); });
    await act(async () => { second.resolve(NOTHING); await second.promise; });
    await act(async () => { first.resolve(HENDERSON); await first.promise; });
    expect(screen.queryByRole("option", { name: /^Ailsa Henderson/u })).toBeNull();
    expect(screen.getByText("No clients found for “mcdonald”.")).toBeDefined();
  });

  it("says a failed search plainly, keeps everything else working, and tries again on request", async () => {
    mocks.search.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(HENDERSON);
    renderShell();
    openFind();
    fireEvent.change(field(), { target: { value: "henderson" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Clients could not be searched.");
    expect(screen.getByRole("option", { name: /^Search clients for “henderson”/u })).toBeDefined();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("option", { name: /^Ailsa Henderson/u })).toBeDefined();
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(field());
  });

  it("opens a layout in the planner in a new tab, as the Clients desk does", async () => {
    mocks.search.mockResolvedValue(HENDERSON);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderShell();
    openFind();
    fireEvent.change(field(), { target: { value: "henderson" } });
    fireEvent.click(await screen.findByRole("option", { name: /^Henderson rounds, layout, opens in a new tab/u }));
    expect(open).toHaveBeenCalledWith(`/plan/${LAYOUT}`, "_blank", "noopener,noreferrer");
    expect(route()).toBe("/dashboard?view=enquiries");
    open.mockRestore();
  });

  it("offers sales dates and pages, and never searches the clients its role is refused", async () => {
    useAuthStore.setState({ user: person("sales") });
    renderShell();
    openFind();
    expect(field().getAttribute("placeholder")).toBe("A date or a page");
    expect(screen.getByText("Dates and pages.")).toBeDefined();
    fireEvent.change(field(), { target: { value: "henderson" } });
    expect(screen.getByText("Nothing found for “henderson”.")).toBeDefined();
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: /Clients/u })).toBeNull();
  });

  it("tells a hallkeeper it finds people and layouts, not the commercial record", () => {
    useAuthStore.setState({ user: person("hallkeeper") });
    renderShell();
    openFind();
    expect(screen.getByText("Dates, pages, people and layouts, by a near spelling too.")).toBeDefined();
  });
});
