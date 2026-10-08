import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResults } from "../../../../api/clients.js";
import { useAuthStore, type AuthUser } from "../../../../stores/auth-store.js";
import { DashboardLayout, forgetKnownVenueNames } from "../../DashboardLayout.js";
import type { FindLocalRow, FindSource } from "../find-model.js";

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

/** The router's own navigate, for a test to move the address as a page would. */
let navigateTo: ((to: string, options?: { readonly replace?: boolean }) => void) | null = null;
function Navigator(): null {
  const navigate = useNavigate();
  navigateTo = (to, options) => { void navigate(to, options); };
  return null;
}

function renderShell(children: React.ReactNode = <p>Workspace</p>, { path = "/dashboard?view=enquiries", findSource }: {
  readonly path?: string;
  readonly findSource?: FindSource;
} = {}): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardLayout activeView="enquiries" mainLabel="Enquiries" findSource={findSource}>{children}</DashboardLayout>
      <Route />
      <Navigator />
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

  it("offers no client search to an account not connected to its venue, which the API would refuse", async () => {
    useAuthStore.setState({ user: { ...person("staff"), venueId: null } });
    renderShell();
    openFind();
    expect(field().getAttribute("placeholder")).toBe("A date or a page");
    fireEvent.change(field(), { target: { value: "henderson" } });
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("keeps the cursor in its field when anything but its field or buttons is pressed", () => {
    renderShell();
    openFind();
    // A press that is not prevented would move focus off the field, and the
    // next keystroke would fall to the page behind.
    expect(fireEvent.mouseDown(screen.getByText(/^Dates, pages, people/u))).toBe(false);
    expect(fireEvent.mouseDown(screen.getAllByRole("option")[0] as HTMLElement)).toBe(false);
    expect(fireEvent.mouseDown(field())).toBe(true);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Close Find" }))).toBe(true);
  });

  it("is put away by a press that begins and ends on the backdrop, on its click, never by a press that only ends there", () => {
    renderShell();
    const find = openFind();
    const backdrop = find.parentElement as HTMLElement;
    // A drag out of the sheet that ends on the backdrop keeps Find.
    fireEvent.pointerDown(field());
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
    // The press alone does nothing yet, so a tap cannot fall through to the page.
    fireEvent.pointerDown(backdrop);
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
  });

  it("stays open while a page keeps its own address up to date, and goes when the person moves", () => {
    renderShell();
    openFind();
    act(() => { navigateTo?.("/dashboard?view=enquiries&proposal=1", { replace: true }); });
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
    act(() => { navigateTo?.("/diary"); });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
  });

  it("opens from the K key on a layout without Latin letters, and leaves Dvorak's Ctrl+T alone", () => {
    renderShell();
    // Dvorak: the physical K key types "t".
    fireEvent.keyDown(window, { key: "t", code: "KeyK", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
    // Russian: the physical K key types "л".
    fireEvent.keyDown(window, { key: "л", code: "KeyK", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
  });

  it("leaves Escape to an input method that is composing", () => {
    renderShell();
    openFind();
    fireEvent.keyDown(field(), { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog", { name: "Find" })).toBeDefined();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
  });

  it("keeps the Diary's zoom when a date is found on the Diary", () => {
    renderShell(<p>Workspace</p>, { path: "/diary?view=day&date=2026-10-07" });
    openFind();
    fireEvent.change(field(), { target: { value: "14 nov" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(route()).toBe("/diary?date=2026-11-14&goto=2026-11-14&view=day");
  });

  it("says when nothing is found in a region that was already there", () => {
    useAuthStore.setState({ user: person("sales") });
    renderShell();
    openFind();
    const region = screen.getAllByRole("status").find((element) => element.classList.contains("find__said"));
    expect(region?.textContent).toBe("");
    fireEvent.change(field(), { target: { value: "zzzz" } });
    expect(region?.isConnected).toBe(true);
    expect(region?.textContent).toBe("Nothing found for “zzzz”.");
  });

  it("reads a page's own findings again when the page says they changed, while Find is open", () => {
    let rows: readonly FindLocalRow[] = [];
    const listeners = new Set<() => void>();
    const source: FindSource = {
      label: "On the board",
      find: (query) => (query.length < 2 ? [] : rows.filter((row) => row.title.toLowerCase().includes(query.toLowerCase()))),
      pick: vi.fn(),
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    useAuthStore.setState({ user: person("sales") });
    renderShell(<p>Workspace</p>, { findSource: source });
    openFind();
    fireEvent.change(field(), { target: { value: "fraser" } });
    expect(screen.queryByRole("option", { name: /^Fraser wedding/u })).toBeNull();
    // The board's week arrives while Find is open.
    rows = [{ id: "booking:b1", title: "Fraser wedding", detail: "Grand Hall · 13:00", kind: "Booking" }];
    act(() => { for (const listener of listeners) listener(); });
    expect(screen.getByRole("option", { name: "Fraser wedding, booking, Grand Hall · 13:00" })).toBeDefined();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(listeners.size).toBe(0);
  });
});
