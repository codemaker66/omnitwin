import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarBookingEntry, CalendarEntry, CalendarResponse } from "@omnitwin/types";
import { DiaryBoardPage } from "../DiaryBoardPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { welcomeStorageKey } from "../lib/welcome.js";

// ---------------------------------------------------------------------------
// Render contract for the Diary Board (T-493): lanes, blocks, conflict rail
// with honest checks, the needs-attention tray, role-gated read-only chip,
// and the error/retry path — against a mocked diary API.
// ---------------------------------------------------------------------------

const {
  getCalendarMock,
  moveBookingMock,
  createBookingMock,
  updateBookingMock,
  transitionBookingMock,
  convertEnquiryMock,
  listEnquiriesMock,
} = vi.hoisted(() => ({
  getCalendarMock: vi.fn(),
  moveBookingMock: vi.fn(),
  createBookingMock: vi.fn(),
  updateBookingMock: vi.fn(),
  transitionBookingMock: vi.fn(),
  convertEnquiryMock: vi.fn(),
  listEnquiriesMock: vi.fn(),
}));

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
  moveBooking: moveBookingMock,
  createBooking: createBookingMock,
  updateBooking: updateBookingMock,
  transitionBooking: transitionBookingMock,
  convertEnquiry: convertEnquiryMock,
}));

vi.mock("../../../api/enquiries.js", () => ({
  listEnquiries: listEnquiriesMock,
}));

// The board now wears the app shell (DashboardLayout), which renders a Clerk
// sign-out and fetches the venue name for its topbar. In production /diary is
// withClerk()-wrapped so both are real; here they are stubbed so this file
// keeps testing the BOARD rather than the chrome around it.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("../../../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));

vi.mock("../../../components/dashboard/NotificationCenter.js", () => ({
  NotificationCenter: () => null,
}));
// The shell reads the unread count for the nav chip; this suite does not
// exercise notifications, so the edge is stubbed like the rest of them.
vi.mock("../../../api/notifications.js", () => ({
  listNotifications: () => Promise.resolve([]),
  getUnreadNotificationCount: () => Promise.resolve(0),
}));

// Presence is mutable so a test can put THIS user in the roster, and the
// page's live-change callback is kept so a test can deliver a colleague's
// change (T-619).
const { liveState } = vi.hoisted(() => ({
  liveState: {
    presence: [] as readonly { userId: string; name: string; role: string }[],
    onChange: null as (() => void) | null,
  },
}));

vi.mock("../hooks/useDiaryLive.js", () => ({
  useDiaryLive: (_enabled: boolean, onChange: () => void) => {
    liveState.onChange = onChange;
    return { connected: true, presence: liveState.presence };
  },
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const STAFF_USER_ID = "00000000-0000-4000-8000-0000000000ff";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000b2";
const INK_ID = "00000000-0000-4000-8000-0000000000c1";
const HOLD_ID = "00000000-0000-4000-8000-0000000000c2";

function fixture(): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T23:00:00.000Z" },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries: [
      {
        entryType: "booking",
        id: INK_ID,
        spaceId: GRAND_HALL,
        kind: "ink",
        status: "active",
        state: "ink",
        title: "Chamber dinner",
        eventType: "dinner",
        startsAt: "2026-09-18T17:00:00.000Z",
        endsAt: "2026-09-18T22:00:00.000Z",
        rank: null,
        jointFlag: false,
        decisionAt: null,
        ownerUserId: null,
        nextAction: null,
        nextActionDueAt: null,
        eventId: null,
        seriesId: null,
      },
      {
        entryType: "booking",
        id: HOLD_ID,
        spaceId: GRAND_HALL,
        kind: "hold",
        status: "active",
        state: "hold",
        title: "MacLeod wedding",
        eventType: "wedding",
        startsAt: "2026-09-18T18:00:00.000Z",
        endsAt: "2026-09-18T23:00:00.000Z",
        rank: 1,
        jointFlag: false,
        decisionAt: "2026-12-01T12:00:00.000Z",
        ownerUserId: null,
        nextAction: "Call Fiona MacLeod.",
        nextActionDueAt: "2026-07-01T09:00:00.000Z",
        eventId: null,
        seriesId: null,
      },
    ],
    conflicts: {
      conflicts: [
        {
          id: `hold_overlap:${INK_ID}:${HOLD_ID}`,
          type: "hold_overlap",
          severity: "warning",
          spaceId: GRAND_HALL,
          entryIds: [INK_ID, HOLD_ID],
          explanation:
            '"MacLeod wedding" (1st option) is provisional for a time "Chamber dinner" has confirmed. It cannot be confirmed while that booking stands; release it or offer another date.',
        },
      ],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: {
          status: "not_checked",
          uncoveredPairCount: 1,
          detail:
            "No active turnaround rule covers these spaces yet — 1 occupancy gaps are not checked.",
        },
      },
    },
  };
}

function setUser(role: string): void {
  useAuthStore.setState({
    user: {
      id: STAFF_USER_ID,
      email: "staff@test.com",
      role,
      platformRole: "none",
      venueId: VENUE,
      name: "Test Staff",
    },
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

const OTHER_VENUE = "00000000-0000-4000-8000-000000000002";

function trayEnquiry(index: number, state: string): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    venueId: VENUE, spaceId: GRAND_HALL, configurationId: null, userId: null,
    guestEmail: null, guestPhone: null, guestName: null, state,
    name: `Enquiry ${String(index)}`, email: "guest@example.com", preferredDate: null,
    eventType: "dinner", estimatedGuests: 40, message: null,
    createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z",
  };
}

function trayEnquiryNames(): string[] {
  return [...document.querySelectorAll(".diary-tray-enquiry .diary-tray-item-title")].map((node) => node.textContent ?? "");
}

/** Opens the View menu (roadmap N3's reduced toolbar) and presses one of
 *  its buttons. */
function pressInViewMenu(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  fireEvent.click(screen.getByRole("button", { name }));
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/diary?view=week&date=2026-09-16"]}>
      <DiaryBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCalendarMock.mockResolvedValue(fixture());
  listEnquiriesMock.mockResolvedValue([
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      venueId: VENUE,
      spaceId: GRAND_HALL,
      configurationId: null,
      userId: null,
      guestEmail: null,
      guestPhone: null,
      guestName: "Fiona MacLeod",
      state: "submitted",
      name: "Fiona MacLeod",
      email: "fiona@example.com",
      preferredDate: "2026-09-19",
      eventType: "wedding",
      estimatedGuests: 120,
      message: null,
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z",
    },
  ]);
  setUser("staff");
  liveState.presence = [{ userId: "presence-1", name: "Elaine", role: "hallkeeper" }];
  liveState.onChange = null;
  // Most tests exercise a returning coordinator — the first-run welcome has
  // its own dedicated tests below.
  window.localStorage.setItem(welcomeStorageKey(STAFF_USER_ID), "1");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
});

describe("DiaryBoardPage", () => {
  it("keeps move activity until all overlapping writes settle, including failure", async () => {
    let resolveFirst: (() => void) | undefined;
    let rejectSecond: ((reason: Error) => void) | undefined;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<void>((_resolve, reject) => { rejectSecond = reject; });
    moveBookingMock.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    const move = (): void => {
      fireEvent.keyDown(block, { key: " " });
      fireEvent.keyDown(block, { key: "ArrowRight" });
      fireEvent.keyDown(block, { key: " " });
    };
    move();
    move();
    expect(moveBookingMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saving booking moves…").closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(async () => { resolveFirst?.(); await first; });
    expect(screen.getByText("Saving booking moves…")).toBeTruthy();
    await act(async () => { rejectSecond?.(new Error("Offline")); await second.catch(() => undefined); });
    expect(screen.queryByText("Saving booking moves…")).toBeNull();
    expect(screen.getByText(/could not be saved/)).toBeTruthy();
  });

  it("shows activity for Undo until its write finishes", async () => {
    let resolveUndo: (() => void) | undefined;
    const response = new Promise<void>((resolve) => { resolveUndo = resolve; });
    moveBookingMock.mockReset().mockResolvedValueOnce({}).mockReturnValueOnce(response);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: " " });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    fireEvent.keyDown(block, { key: " " });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(screen.getByText("Saving booking moves…")).toBeTruthy();
    await act(async () => { resolveUndo?.(); await response; });
    expect(screen.queryByText("Saving booking moves…")).toBeNull();
  });

  it("distinguishes pending and failed enquiry loads from an empty result and retries", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    const response = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
    listEnquiriesMock.mockReturnValue(response);
    renderPage();
    await screen.findByText("Loading open enquiries…");
    expect(screen.queryByText("No open enquiries right now.")).toBeNull();
    await act(async () => { rejectRequest?.(new Error("Offline")); await response.catch(() => undefined); });
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(screen.queryByText("No open enquiries right now.")).toBeNull();
    expect(screen.getByText(/Enquiries could not be refreshed/)).toBeTruthy();
    listEnquiriesMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry enquiries" }));
    expect(await screen.findByText("No open enquiries right now.")).toBeTruthy();
    expect(screen.queryByText(/Enquiries could not be refreshed/)).toBeNull();
  });

  it("preserves loaded enquiries during refresh and after its failure", async () => {
    getCalendarMock.mockImplementation(() => Promise.resolve(fixture()));
    renderPage();
    await screen.findByText("Fiona MacLeod");
    await waitFor(() => { expect(screen.queryByText("Loading open enquiries…")).toBeNull(); });
    let rejectRequest: ((reason: Error) => void) | undefined;
    const response = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
    listEnquiriesMock.mockReturnValue(response);
    // The reload is an explicit act — Refresh — not a side effect of moving
    // the board (T-619).
    pressInViewMenu("Refresh");
    await screen.findByText("Loading open enquiries…");
    expect(screen.getByText("Fiona MacLeod")).toBeTruthy();
    await act(async () => { rejectRequest?.(new Error("Offline")); await response.catch(() => undefined); });
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(screen.getByText("Fiona MacLeod")).toBeTruthy();
    expect(screen.getByText(/Enquiries could not be refreshed/)).toBeTruthy();
  });

  it("asks the API for exactly the open states, newest first, for this board's venue", async () => {
    let resolveRequest: ((rows: unknown[]) => void) | undefined;
    listEnquiriesMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    renderPage();
    const loading = await screen.findByText("Loading open enquiries…");
    expect(loading.closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(listEnquiriesMock).toHaveBeenCalledWith(
      { states: ["submitted", "under_review"], order: "created_desc", venueId: VENUE, limit: 51 },
      expect.any(AbortSignal),
    );
    await act(async () => { resolveRequest?.([trayEnquiry(1, "submitted"), trayEnquiry(2, "under_review")]); await Promise.resolve(); });
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(trayEnquiryNames()).toEqual(["Enquiry 1", "Enquiry 2"]);
    expect(screen.queryByText(/newest open enquiries/)).toBeNull();
  });

  it("leaves access requests and Venviewer enquiries out of the tray: they ask for no room", async () => {
    listEnquiriesMock.mockResolvedValue([
      trayEnquiry(1, "submitted"),
      { ...trayEnquiry(2, "submitted"), name: "Access ask", eventType: "venue-access" },
      { ...trayEnquiry(3, "under_review"), name: "Pricing ask", eventType: "venue-enquiry" },
      trayEnquiry(4, "under_review"),
    ]);
    renderPage();
    await waitFor(() => { expect(trayEnquiryNames()).toEqual(["Enquiry 1", "Enquiry 4"]); });
  });

  it("keeps the server's newest-first order and says when more open enquiries exist", async () => {
    listEnquiriesMock.mockResolvedValue(Array.from({ length: 51 }, (_, index) => trayEnquiry(index, "submitted")));
    renderPage();
    expect(await screen.findByText("Showing the 50 newest open enquiries. Older ones are not listed here.")).toBeTruthy();
    expect(trayEnquiryNames()).toEqual(Array.from({ length: 50 }, (_, index) => `Enquiry ${String(index)}`));
  });

  it("cancels the previous venue's request and never shows its late response", async () => {
    let resolveOld: ((rows: unknown[]) => void) | undefined;
    listEnquiriesMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    renderPage();
    await waitFor(() => { expect(listEnquiriesMock).toHaveBeenCalledTimes(1); });
    const oldSignal = listEnquiriesMock.mock.calls[0]?.[1] as AbortSignal;
    expect(oldSignal.aborted).toBe(false);

    listEnquiriesMock.mockResolvedValue([{ ...trayEnquiry(7, "submitted"), venueId: OTHER_VENUE, name: "Other venue slip" }]);
    act(() => {
      const current = useAuthStore.getState().user;
      if (current !== null) useAuthStore.setState({ user: { ...current, venueId: OTHER_VENUE } });
    });
    expect(oldSignal.aborted).toBe(true);
    expect(listEnquiriesMock).toHaveBeenLastCalledWith(expect.objectContaining({ venueId: OTHER_VENUE }), expect.any(AbortSignal));
    expect(await screen.findByText("Other venue slip")).toBeTruthy();

    await act(async () => { resolveOld?.([{ ...trayEnquiry(8, "submitted"), name: "Stale first-venue slip" }]); await Promise.resolve(); });
    expect(screen.queryByText("Stale first-venue slip")).toBeNull();
    expect(screen.getByText("Other venue slip")).toBeTruthy();
  });
  it("renders lanes, blocks, and the legend from the calendar response", async () => {
    renderPage();
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(screen.getByText("Saloon")).toBeDefined();
    expect(screen.getByText("Chamber dinner")).toBeDefined();
    // The hold appears both as a lane block and as a tray item — by design.
    expect(screen.getAllByText("MacLeod wedding").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".diary-legend-item.is-ink")?.textContent).toBe("Confirmed");
    expect(screen.getByText(/Planning support only/)).toBeDefined();
  });

  it("surfaces conflict explanations and the honest turnaround status", async () => {
    renderPage();
    const warning = await screen.findByText("Warning");
    fireEvent.click(warning);
    expect(warning.closest("details")?.open).toBe(true);
    expect(
      await screen.findByText(/for a time "Chamber dinner" has confirmed/),
    ).toBeDefined();
    fireEvent.click(screen.getByText("What was checked"));
    expect(screen.getByText("Turnaround gaps: not checked").closest("details")?.open).toBe(true);
  });

  it("lists overdue pencils in the needs-attention tray", async () => {
    renderPage();
    expect(await screen.findByText("Needs attention")).toBeDefined();
    expect(screen.getByText(/Overdue next action: Call Fiona MacLeod\./)).toBeDefined();
  });

  it("shows the read-only chip for hallkeeper", async () => {
    setUser("hallkeeper");
    renderPage();
    expect(await screen.findByText(/Read-only/)).toBeDefined();
  });

  it("does not show the read-only chip for staff", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  it("recovers from a load failure via retry", async () => {
    getCalendarMock.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("The diary could not load.")).toBeDefined();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    // The failed read and its retry are both this week; any later reads are
    // its neighbours, read ahead.
    const weeks = getCalendarMock.mock.calls.map((call) => String(call[1]));
    expect(weeks.slice(0, 2)).toEqual(["2026-09-13T23:00:00.000Z", "2026-09-13T23:00:00.000Z"]);
  });

  it("keyboard-moves a pencil with Space and PATCHes the snapped window (review P2 coverage)", async () => {
    moveBookingMock.mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: " " }); // lift (Space; Enter opens the drawer)
    fireEvent.keyDown(block, { key: "ArrowRight" }); // +15 minutes
    fireEvent.keyDown(block, { key: " " }); // drop → commit
    // The page PATCHes the full snapshot (undo symmetry); the API treats an
    // unchanged spaceId as a no-op.
    expect(moveBookingMock).toHaveBeenCalledWith(HOLD_ID, {
      spaceId: GRAND_HALL,
      startsAt: "2026-09-18T18:15:00.000Z",
      endsAt: "2026-09-18T23:15:00.000Z",
    });
    expect(await screen.findByText("Moved MacLeod wedding.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("restores the board and says so when a move fails to save", async () => {
    moveBookingMock.mockRejectedValue(new Error("boom"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: " " });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    fireEvent.keyDown(block, { key: " " });
    expect(await screen.findByText(/could not be saved/)).toBeDefined();
  });

  it("Enter opens the booking drawer prefilled from the block (T-495)", async () => {
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: "Enter" });
    const drawer = await screen.findByRole("dialog", { name: "Booking details" });
    expect(drawer).toBeDefined();
    expect(screen.getByDisplayValue("MacLeod wedding")).toBeDefined();
    // The pencil's lifecycle actions come from the shared matrix.
    expect(screen.getByRole("button", { name: "Confirm it" })).toBeDefined();
  });

  it("converts an open enquiry through the drawer (T-496)", async () => {
    convertEnquiryMock.mockResolvedValue({ title: "Fiona MacLeod — wedding" });
    renderPage();
    const convert = await screen.findByRole("button", { name: "Hold a date…" });
    convert.click();
    const drawer = await screen.findByRole("dialog", { name: "Hold a date for this enquiry" });
    expect(drawer).toBeDefined();
    expect(screen.getByDisplayValue("Fiona MacLeod — wedding")).toBeDefined();
    expect(screen.getByText(/enquiry stays in review/)).toBeDefined();
  });

  it("shows the live presence chip from the channel (T-497)", async () => {
    renderPage();
    expect(await screen.findByText(/Live · 1/)).toBeDefined();
  });

  it("retargeting the drawer without closing starts a fresh form (review P1)", async () => {
    renderPage();
    // Open the edit drawer on the pencil…
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: "Enter" });
    expect(await screen.findByDisplayValue("MacLeod wedding")).toBeDefined();
    // …then jump straight to "New booking" without closing. The create form
    // must not inherit the edit form's fields.
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    expect(await screen.findByRole("dialog", { name: "New booking" })).toBeDefined();
    expect(screen.queryByDisplayValue("MacLeod wedding")).toBeNull();
  });

  it("keeps the drawer open while a save is in flight — Escape and Close wait (review P2)", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    updateBookingMock.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          resolveSave = resolvePromise;
        }),
    );
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    fireEvent.keyDown(block, { key: "Enter" });
    const title = await screen.findByDisplayValue("MacLeod wedding");
    fireEvent.change(title, { target: { value: "MacLeod ceilidh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    // The PATCH is now pending: Escape must not tear the drawer down.
    const drawer = screen.getByRole("dialog", { name: "Booking details" });
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Booking details" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
    resolveSave?.({ title: "MacLeod ceilidh" });
    expect(await screen.findByText("Saved MacLeod ceilidh.")).toBeDefined();
  });

  it("greets a first-time coordinator once, and dismissal persists (T-520)", async () => {
    window.localStorage.removeItem(welcomeStorageKey(STAFF_USER_ID));
    const first = renderPage();
    const panel = await screen.findByRole("dialog", { name: "Using the Diary" });
    expect(panel).toBeDefined();
    expect(screen.getByText(/Provisional holds may overlap/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open Diary" }));
    expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
    first.unmount();

    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
  });

  it("a dismissed welcome never reopens on auth churn, even when storage writes fail (review P2)", async () => {
    window.localStorage.removeItem(welcomeStorageKey(STAFF_USER_ID));
    // Kiosk/private-browsing mode: persistence is denied.
    const denied = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      renderPage();
      await screen.findByRole("dialog", { name: "Using the Diary" });
      fireEvent.click(screen.getByRole("button", { name: "Open Diary" }));
      expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
      // Clerk sync replaces the user OBJECT (same identity, new reference) —
      // the panel must stay closed for the rest of the session.
      setUser("staff");
      await screen.findByText("Grand Hall");
      expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
    } finally {
      denied.mockRestore();
    }
  });

  it("the header reopens the welcome any time; Escape closes it (T-520)", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
    pressInViewMenu("How the Diary works");
    const panel = screen.getByRole("dialog", { name: "Using the Diary" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();
  });

  it("tells an unassigned account that it has no venue", () => {
    useAuthStore.setState({
      user: {
        id: "00000000-0000-4000-8000-0000000000fe",
        email: "new@test.com",
        role: "staff",
        platformRole: "none",
        venueId: null,
        name: "New Staff",
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    renderPage();
    expect(screen.getByText(/no venue assigned/)).toBeDefined();
    expect(getCalendarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-619 — the timetable (Lane 5) on master's board: the tray reads once,
// create-in-context, shortcuts that stay off a surface being typed into, a
// presence count of other people, the retired month board's deep links, the
// write roles, and the venue-wide decisions list the Diary opens with.
// ---------------------------------------------------------------------------

/** Pins Date only; timers stay real so the page's own effects still run. */
function pinDate(iso: string): () => void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(iso));
  return () => { vi.useRealTimers(); };
}

describe("DiaryBoardPage — the tray reads once (T-619)", () => {
  it("reads open enquiries once and does not re-read them when the board moves", async () => {
    getCalendarMock.mockImplementation(() => Promise.resolve(fixture()));
    renderPage();
    await screen.findByText("Fiona MacLeod");
    expect(listEnquiriesMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => { expect(getCalendarMock.mock.calls.length).toBeGreaterThan(1); });
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await waitFor(() => { expect(getCalendarMock.mock.calls.length).toBeGreaterThan(2); });
    expect(listEnquiriesMock).toHaveBeenCalledTimes(1);
  });

  it("reloads the board and the tray when a colleague's change arrives live", async () => {
    getCalendarMock.mockImplementation(() => Promise.resolve(fixture()));
    renderPage();
    await screen.findByText("Fiona MacLeod");
    // The board's own week; its neighbours are read ahead as well.
    const readsOfThisWeek = (): number => getCalendarMock.mock.calls.filter((call) => call[1] === "2026-09-13T23:00:00.000Z").length;
    const before = readsOfThisWeek();
    expect(listEnquiriesMock).toHaveBeenCalledTimes(1);
    act(() => { liveState.onChange?.(); });
    await waitFor(() => { expect(listEnquiriesMock).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(readsOfThisWeek()).toBe(before + 1); });
  });

  it("reloads the tray after a drawer save", async () => {
    updateBookingMock.mockResolvedValue({ title: "MacLeod ceilidh" });
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Provisional/ });
    await waitFor(() => { expect(listEnquiriesMock).toHaveBeenCalledTimes(1); });
    fireEvent.keyDown(block, { key: "Enter" });
    fireEvent.change(await screen.findByDisplayValue("MacLeod wedding"), { target: { value: "MacLeod ceilidh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved MacLeod ceilidh.")).toBeDefined();
    await waitFor(() => { expect(listEnquiriesMock).toHaveBeenCalledTimes(2); });
  });
});

describe("DiaryBoardPage — create in context (T-619)", () => {
  it("seeds New booking with the day being looked at, not the range's first instant", async () => {
    // The board shows the week of 14 Sep; "now" is inside it, on the 16th.
    const restore = pinDate("2026-09-16T10:00:00.000Z");
    try {
      renderPage();
      await screen.findByText("Grand Hall");
      fireEvent.click(screen.getByRole("button", { name: "New booking" }));
      const drawer = screen.getByRole("dialog", { name: "New booking" });
      expect(within(drawer).getByDisplayValue("2026-09-16T17:00")).toBeTruthy();
      expect(within(drawer).getByDisplayValue("Grand Hall")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("opens the drawer on an empty overview square's room and day", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    // One control per room-day square, named for what it will make.
    const cells = screen.getAllByRole("button", { name: /^New booking — Saloon, / });
    expect(cells).toHaveLength(7);
    fireEvent.click(cells[0] as HTMLElement);
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    expect(within(drawer).getByDisplayValue("Saloon")).toBeTruthy();
    expect(within(drawer).getByDisplayValue("2026-09-14T17:00")).toBeTruthy();
  });

  it("opens the drawer at the instant clicked on an empty lane, snapped to the quarter hour", async () => {
    render(
      <MemoryRouter initialEntries={["/diary?view=day&date=2026-09-16"]}>
        <DiaryBoardPage />
      </MemoryRouter>,
    );
    const lane = await screen.findByRole("button", { name: /^New booking — Saloon, / });
    // happy-dom lays nothing out, so the lane starts at x = 0; the day view
    // is 96 px an hour, so x = 980 is 10:12:30, which snaps to 10:15.
    fireEvent.click(lane, { detail: 1, clientX: 980, clientY: 10 });
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    expect(within(drawer).getByDisplayValue("Saloon")).toBeTruthy();
    expect(within(drawer).getByDisplayValue("2026-09-16T10:15")).toBeTruthy();
    // The house window's length (six hours) is kept as the duration.
    expect(within(drawer).getByDisplayValue("2026-09-16T16:15")).toBeTruthy();
  });

  it("falls back to the shown day when the lane control is reached from the keyboard", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    const lane = await screen.findByRole("button", { name: /^New booking — Grand Hall, / });
    // detail 0 is exactly what Enter or Space on a <button> produces; a time
    // must never come from a clientX the keyboard could not supply.
    fireEvent.click(lane, { detail: 0 });
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    expect(within(drawer).getByDisplayValue("Grand Hall")).toBeTruthy();
    expect(within(drawer).getByDisplayValue("2026-09-16T17:00")).toBeTruthy();
  });

  it("names the day the lane control will pick, not the range it sits in", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    const lane = await screen.findByRole("button", { name: /^New booking — Grand Hall, / });
    const label = lane.getAttribute("aria-label") ?? "";
    expect(label).not.toMatch(/Week of|Fortnight of/u);
    expect(label).toContain("Click the lane for a particular time.");
  });

  it("offers no create control to a read-only role", async () => {
    setUser("hallkeeper");
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("button", { name: /^New booking — / })).toBeNull();
    expect(screen.queryByRole("button", { name: "New booking" })).toBeNull();
  });

  it.each(["manager", "sales"])("offers the %s the controls the API lets them use", async (role) => {
    setUser(role);
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByRole("button", { name: "New booking" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^New booking — / }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });
});

describe("DiaryBoardPage — shortcuts, presence and retired views (T-619)", () => {
  it("does not re-range the board from a letter typed into the drawer's Room select", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    const room = within(drawer).getByLabelText("Room");
    room.focus();
    fireEvent.keyDown(room, { key: "d" });
    expect(screen.getByRole("dialog", { name: "New booking" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("holds board shortcuts while the drawer is open, even from the page body", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("still re-ranges from a board shortcut once no drawer is open", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.keyDown(window, { key: "d" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Day" }).getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("counts other people in the presence chip, never yourself", async () => {
    liveState.presence = [
      { userId: STAFF_USER_ID, name: "Test Staff", role: "staff" },
      { userId: "presence-1", name: "Elaine", role: "hallkeeper" },
    ];
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByText("Live · 1")).toBeTruthy();
  });

  it("says only Live when you are the only person on the board", async () => {
    liveState.presence = [{ userId: STAFF_USER_ID, name: "Test Staff", role: "staff" }];
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText(/Live · /)).toBeNull();
  });

  it("lands an old ?view=month deep link on the week that date falls in, and ignores m", async () => {
    render(
      <MemoryRouter initialEntries={["/diary?view=month&date=2026-09-16"]}>
        <DiaryBoardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Grand Hall");
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Month" })).toBeNull();
    // The board's own read comes first; its neighbours are read ahead after.
    const requested = getCalendarMock.mock.calls[0] as [string, string, string] | undefined;
    expect(requested?.[1]).toBe("2026-09-13T23:00:00.000Z");
    expect(requested?.[2]).toBe("2026-09-20T23:00:00.000Z");
    fireEvent.keyDown(window, { key: "m" });
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("DiaryBoardPage — decisions due, venue-wide (T-619)", () => {
  const OVERDUE_ID = "00000000-0000-4000-8000-0000000000d1";
  const SOON_ID = "00000000-0000-4000-8000-0000000000d2";

  function decisionHold(overrides: Partial<CalendarBookingEntry> & Pick<CalendarBookingEntry, "id" | "title">): CalendarBookingEntry {
    return {
      entryType: "booking",
      spaceId: SALOON,
      kind: "hold",
      status: "active",
      state: "hold",
      eventType: "wedding",
      startsAt: "2027-03-20T15:00:00.000Z",
      endsAt: "2027-03-20T23:00:00.000Z",
      rank: 2,
      jointFlag: false,
      decisionAt: "2026-09-15T12:00:00.000Z",
      ownerUserId: "00000000-0000-4000-8000-0000000000aa",
      ownerName: "Fiona Coordinator",
      nextAction: "Call the couple.",
      nextActionDueAt: "2026-10-01T09:00:00.000Z",
      eventId: null,
      seriesId: null,
      ...overrides,
    };
  }

  function withDecisions(): CalendarResponse {
    return {
      ...fixture(),
      decisionsDue: {
        holds: [
          decisionHold({ id: OVERDUE_ID, title: "Hartley wedding" }),
          decisionHold({
            id: SOON_ID,
            title: "Guild dinner",
            spaceId: GRAND_HALL,
            startsAt: "2026-11-14T18:00:00.000Z",
            endsAt: "2026-11-14T23:00:00.000Z",
            rank: 1,
            jointFlag: true,
            decisionAt: "2026-09-18T12:00:00.000Z",
            ownerUserId: null,
            ownerName: null,
          }),
        ],
        total: 2,
      },
    };
  }

  it("lists provisional holds from any week, overdue first, in Blake's words", async () => {
    getCalendarMock.mockResolvedValue(withDecisions());
    const restore = pinDate("2026-09-16T10:00:00.000Z");
    try {
      renderPage();
      const panel = await screen.findByRole("region", { name: /Decisions due/ });
      const overdue = within(panel).getByRole("heading", { name: /Overdue/ }).closest("div");
      const soon = within(panel).getByRole("heading", { name: /Next 7 days/ }).closest("div");
      if (overdue === null || soon === null) throw new Error("expected both groups");
      // A hold next March, whose decision was due yesterday, is on this week's board.
      expect(within(overdue).getByText("Hartley wedding")).toBeTruthy();
      expect(within(overdue).getByText("Saloon · Sat 20 Mar 2027")).toBeTruthy();
      expect(within(overdue).getByText("2nd option · Fiona Coordinator")).toBeTruthy();
      // ICU's en-GB short September is "Sept" in current data, "Sep" in older.
      expect(within(overdue).getByText(/^Decision was due Tue 15 Sept?$/u)).toBeTruthy();
      expect(within(soon).getByText("Guild dinner")).toBeTruthy();
      expect(within(soon).getByText("Joint 1st · No owner")).toBeTruthy();
      expect(within(soon).getByText(/^Decide by Fri 18 Sept?$/u)).toBeTruthy();
      expect(panel.textContent ?? "").not.toMatch(/pencil|ink|ladder|prospect/iu);
    } finally {
      restore();
    }
  });

  it("opens a listed hold in the drawer without moving the board, and gives focus back", async () => {
    getCalendarMock.mockResolvedValue(withDecisions());
    renderPage();
    const row = await screen.findByRole("button", { name: /Hartley wedding/ });
    const title = document.querySelector(".diary-range-title")?.textContent;
    // The board reads its own week and its neighbours ahead, whenever those
    // land; no read reaches next March, where the hold is.
    const holdMs = Date.parse("2027-03-20T15:00:00.000Z");
    const readsOfTheHoldsDate = (): number => getCalendarMock.mock.calls.filter((call) =>
      Date.parse(String(call[1])) <= holdMs && Date.parse(String(call[2])) > holdMs).length;
    row.focus();
    fireEvent.click(row);
    const drawer = await screen.findByRole("dialog", { name: "Booking details" });
    expect(within(drawer).getByDisplayValue("Hartley wedding")).toBeTruthy();
    expect(within(drawer).getByText("Fiona Coordinator")).toBeTruthy();
    expect(document.querySelector(".diary-range-title")?.textContent).toBe(title);
    expect(readsOfTheHoldsDate()).toBe(0);
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(document.activeElement).toBe(row); });
  });

  it("leaves overdue decisions to the list rather than repeating them in Needs attention", async () => {
    const response = withDecisions();
    getCalendarMock.mockResolvedValue({
      ...response,
      entries: response.entries.map((entry) =>
        entry.id === HOLD_ID && entry.entryType === "booking" ? { ...entry, decisionAt: "2026-09-01T12:00:00.000Z" } : entry,
      ),
    });
    renderPage();
    await screen.findByRole("region", { name: /Decisions due/ });
    const tray = screen.getByRole("region", { name: "Needs attention" });
    expect(within(tray).getByText(/Overdue next action: Call Fiona MacLeod\./)).toBeTruthy();
    expect(within(tray).queryByText(/decision date has passed/)).toBeNull();
  });

  it("keeps the in-range decision reason, and shows no list, for an older API that sends none", async () => {
    getCalendarMock.mockResolvedValue({
      ...fixture(),
      entries: fixture().entries.map((entry) =>
        entry.id === HOLD_ID && entry.entryType === "booking" ? { ...entry, decisionAt: "2026-09-01T12:00:00.000Z" } : entry,
      ),
    });
    renderPage();
    const tray = await screen.findByRole("region", { name: "Needs attention" });
    expect(screen.queryByRole("region", { name: /Decisions due/ })).toBeNull();
    expect(within(tray).getByText(/decision date has passed/)).toBeTruthy();
  });

  it("says plainly when no decision is due", async () => {
    getCalendarMock.mockResolvedValue({ ...fixture(), decisionsDue: { holds: [], total: 0 } });
    renderPage();
    const panel = await screen.findByRole("region", { name: /Decisions due/ });
    expect(within(panel).getByText("No decision dates in the next 7 days.")).toBeTruthy();
  });
});

describe("DiaryBoardPage — a finger scrolls the tray, a long press lifts a slip (T-619)", () => {
  async function timelineSlip(): Promise<HTMLElement> {
    renderPage();
    await screen.findByText("Fiona MacLeod");
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const slip = screen.getByText("Fiona MacLeod").closest("li");
    if (slip === null) throw new Error("expected the enquiry slip");
    return slip;
  }

  afterEach(() => { vi.useRealTimers(); });

  it("lifts only after the press has rested, holding the scroll from the first touch", async () => {
    const slip = await timelineSlip();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const add = vi.spyOn(document, "addEventListener");
    fireEvent.pointerDown(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 200 });
    // Registered at the touch, non-passive, before anything is lifted.
    expect(add.mock.calls.find(([type]) => type === "touchmove")?.[2]).toMatchObject({ passive: false });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
    act(() => { vi.advanceTimersByTime(399); });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.querySelector(".diary-enquiry-ghost")).not.toBeNull();
    expect(slip.classList.contains("is-lifted")).toBe(true);
    add.mockRestore();
  });

  it("abandons a press that travels, so a scroll never turns into a lift", async () => {
    const slip = await timelineSlip();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerDown(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 230 });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
    expect(slip.classList.contains("is-lifted")).toBe(false);
  });

  it("lifts nothing from a press that stopped the tray gliding: the browser keeps that touch", async () => {
    const slip = await timelineSlip();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const remove = vi.spyOn(document, "removeEventListener");
    fireEvent.pointerDown(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 200 });
    // Chromium dispatches the touchstart of a touch that lands on a glide
    // uncancelable, and the first touchmove with it.
    document.dispatchEvent(new Event("touchstart", { cancelable: false, bubbles: true }));
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
    expect(slip.classList.contains("is-lifted")).toBe(false);
    expect(remove.mock.calls.some(([type]) => type === "touchmove"), "the press gave the scroll back").toBe(true);
    remove.mockRestore();
  });

  it("lets a quick tap go without lifting anything", async () => {
    const slip = await timelineSlip();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerDown(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 200 });
    act(() => { vi.advanceTimersByTime(150); });
    fireEvent.pointerUp(slip, { pointerType: "touch", pointerId: 7, clientX: 300, clientY: 200 });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(document.querySelector(".diary-enquiry-ghost")).toBeNull();
  });
});

describe("DiaryBoardPage — the board stays steady (roadmap N3)", () => {
  const NEXT_WEEK = "2026-09-20T23:00:00.000Z";

  function later<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => { throw new Error("Promise not initialised"); };
    const promise = new Promise<T>((settle) => { resolve = settle; });
    return { promise, resolve };
  }

  /** The fixture's bookings a week on, as the next week's read returns them. */
  function nextWeekFixture(): CalendarResponse {
    const base = fixture();
    const weekOn = (iso: string): string => new Date(Date.parse(iso) + 7 * 86_400_000).toISOString();
    return {
      ...base,
      range: { from: NEXT_WEEK, to: "2026-09-27T23:00:00.000Z" },
      entries: base.entries.map((entry) => ({ ...entry, startsAt: weekOn(entry.startsAt), endsAt: weekOn(entry.endsAt) })),
      conflicts: { ...base.conflicts, conflicts: [] },
    };
  }

  function readsOf(from: string): number {
    return getCalendarMock.mock.calls.filter((call) => call[1] === from).length;
  }

  it("keeps the rooms while a later week is on its way, and claims nothing about its bookings", async () => {
    const next = later<CalendarResponse>();
    getCalendarMock.mockImplementation((_venue: string, from: string) => (from === NEXT_WEEK ? next.promise : Promise.resolve(fixture())));
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    // The rooms and the new week's days stand, and the board says what it is doing.
    expect(screen.getByText("Grand Hall")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Fri 25 Sept in Day view" })).toBeDefined();
    expect(screen.getByText("Opening the week of Mon, 21 Sept 2026…")).toBeDefined();
    expect(screen.queryByText("Opening the diary…")).toBeNull();
    expect(screen.getByRole("region", { name: "Booking overview" }).getAttribute("aria-busy")).toBe("true");
    // Nothing is said about bookings not yet read: no counts, no "none", no
    // conflicts, and nowhere offered to put a new one.
    expect(screen.queryByRole("button", { name: /^Chamber dinner — / })).toBeNull();
    for (const count of document.querySelectorAll(".diary-overview-room small")) {
      expect(count.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.queryByText("No bookings in this range.")).toBeNull();
    expect(screen.queryByText("No overdue next actions in this range.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Conflicts" })).toBeNull();
    expect(document.querySelector(".diary-overview-new")).toBeNull();

    await act(async () => { next.resolve(nextWeekFixture()); await next.promise; });
    expect(await screen.findByRole("button", { name: /^Chamber dinner — .*Fri 25 Sept/ })).toBeDefined();
    expect(screen.queryByText(/^Opening the week of/)).toBeNull();
    expect(screen.getByRole("region", { name: "Booking overview" }).getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("region", { name: "Conflicts" })).toBeDefined();
  });

  it("keeps the bookings when a refresh fails, and says when it last read them", async () => {
    let now = Date.parse("2026-09-16T08:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    // This week's neighbours are read ahead first, so the failure below is the refresh's own.
    await waitFor(() => { expect(getCalendarMock).toHaveBeenCalledTimes(3); });
    now += 3 * 60_000;
    getCalendarMock.mockRejectedValueOnce(new Error("offline"));
    pressInViewMenu("Refresh");

    // Venue time: 08:00 UTC is 09:00 in Glasgow in September.
    const notice = await screen.findByText("Couldn't refresh at 09:03. Showing the Diary as it was at 09:00.");
    expect(screen.getByRole("button", { name: /^Chamber dinner — / })).toBeDefined();
    expect(screen.queryByText("The diary could not load.")).toBeNull();

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(screen.queryByText(/^Couldn't refresh/u)).toBeNull(); });
    expect(screen.getByRole("button", { name: /^Chamber dinner — / })).toBeDefined();
  });

  it("opens a week already read ahead at once, and reads it again", async () => {
    getCalendarMock.mockImplementation((_venue: string, from: string) => Promise.resolve(from === NEXT_WEEK ? nextWeekFixture() : fixture()));
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    await waitFor(() => { expect(readsOf(NEXT_WEEK)).toBe(1); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByRole("button", { name: /^Chamber dinner — .*Fri 25 Sept/ })).toBeDefined();
    expect(screen.queryByText(/^Opening the week of/u)).toBeNull();
    await waitFor(() => { expect(readsOf(NEXT_WEEK)).toBe(2); });
  });

  it("says a week could not be read where its bookings would be, and keeps the rooms' side", async () => {
    getCalendarMock.mockImplementation((_venue: string, from: string) => (
      from === NEXT_WEEK ? Promise.reject(new Error("offline")) : Promise.resolve(fixture())));
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The week of Mon, 21 Sept 2026 could not be read.");
    expect(screen.queryByText("The diary could not load.")).toBeNull();
    expect(screen.getByRole("region", { name: "Needs attention" })).toBeDefined();

    getCalendarMock.mockImplementation(() => Promise.resolve(nextWeekFixture()));
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Chamber dinner — .*Fri 25 Sept/ })).toBeDefined();
  });
});

describe("DiaryBoardPage — ending a booking asks first (roadmap N3)", () => {
  it("cannot cancel a confirmed booking without saying first who can then be confirmed", async () => {
    transitionBookingMock.mockResolvedValue({ booking: { title: "Chamber dinner" }, promotedToFirst: [] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner — / }));
    const drawer = await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Cancel the booking…" }));
    expect(transitionBookingMock).not.toHaveBeenCalled();

    // The 1st option is the fixture's own: MacLeod wedding, on the same room and evening.
    const question = within(drawer).getByRole("group", { name: "Cancel Chamber dinner?" });
    expect(within(question).getByText(
      "Grand Hall, Fri 18 Sept 18:00–23:00: the confirmed booking ends. MacLeod wedding, 1st option, can then be confirmed. Nothing is sent to the client.",
    )).toBeDefined();
    fireEvent.click(within(question).getByRole("button", { name: "Cancel the booking" }));

    expect(await screen.findByText("Cancelled Chamber dinner. MacLeod wedding, 1st option, can now be confirmed.")).toBeDefined();
    expect(transitionBookingMock).toHaveBeenCalledWith(INK_ID, "cancelled", undefined);
  });
});

describe("DiaryBoardPage — Needs attention, venue-wide (roadmap N3)", () => {
  const HARTLEY_ID = "00000000-0000-4000-8000-0000000000e1";
  const GUILD_ID = "00000000-0000-4000-8000-0000000000e2";

  function attentionHold(overrides: Partial<CalendarBookingEntry> & Pick<CalendarBookingEntry, "id" | "title">): CalendarBookingEntry {
    return {
      entryType: "booking",
      spaceId: SALOON,
      kind: "hold",
      status: "active",
      state: "hold",
      eventType: "wedding",
      startsAt: "2027-03-20T15:00:00.000Z",
      endsAt: "2027-03-20T23:00:00.000Z",
      rank: 1,
      jointFlag: false,
      decisionAt: null,
      ownerUserId: "00000000-0000-4000-8000-0000000000aa",
      ownerName: "Fiona Coordinator",
      nextAction: "Call the Hartleys about the menu.",
      nextActionDueAt: "2026-09-15T09:00:00.000Z",
      eventId: null,
      seriesId: null,
      ...overrides,
    };
  }

  function withAttention(holds: readonly CalendarBookingEntry[], total = holds.length): CalendarResponse {
    return { ...fixture(), decisionsDue: { holds: [], total: 0 }, nextActionsDue: { holds: [...holds], total } };
  }

  it("lists next actions overdue and due this week across the venue, and opens one where it stands", async () => {
    getCalendarMock.mockResolvedValue(withAttention([
      attentionHold({ id: HARTLEY_ID, title: "Hartley wedding" }),
      attentionHold({
        id: GUILD_ID, title: "Guild dinner", spaceId: GRAND_HALL, startsAt: "2026-11-14T18:00:00.000Z", endsAt: "2026-11-14T23:00:00.000Z",
        nextAction: null, nextActionDueAt: "2026-09-18T09:00:00.000Z", ownerUserId: null, ownerName: null,
      }),
    ]));
    const restore = pinDate("2026-09-16T10:00:00.000Z");
    try {
      renderPage();
      const panel = await screen.findByRole("region", { name: "Needs attention" });
      const overdue = within(panel).getByRole("heading", { name: /^Overdue/u }).closest("div") as HTMLElement;
      const soon = within(panel).getByRole("heading", { name: /^Next 7 days/u }).closest("div") as HTMLElement;
      // A hold next March, whose next action was due yesterday, is on this week's board.
      expect(within(overdue).getByText("Saloon · Sat 20 Mar 2027")).toBeDefined();
      expect(within(overdue).getByText("Call the Hartleys about the menu.")).toBeDefined();
      expect(within(overdue).getByText(/^Was due Tue 15 Sept? · Fiona Coordinator$/u)).toBeDefined();
      expect(within(soon).getByText("No next action written.")).toBeDefined();
      expect(within(soon).getByText(/^Due Fri 18 Sept? · No owner$/u)).toBeDefined();
      expect(within(panel).queryByText("No overdue next actions in this range.")).toBeNull();

      const title = document.querySelector(".diary-range-title")?.textContent;
      fireEvent.click(within(overdue).getByRole("button", { name: /Hartley wedding/u }));
      const drawer = await screen.findByRole("dialog", { name: "Booking details" });
      expect(within(drawer).getByDisplayValue("Hartley wedding")).toBeTruthy();
      expect(document.querySelector(".diary-range-title")?.textContent).toBe(title);
    } finally {
      restore();
    }
  });

  it("says nothing is due only when the venue's list says so, keeps the range's holds with no option, and says when it is capped", async () => {
    const unranked = { ...fixture().entries[1], rank: null } as CalendarBookingEntry;
    getCalendarMock.mockResolvedValue({ ...withAttention([]), entries: [fixture().entries[0], unranked] as CalendarEntry[] });
    renderPage();
    const panel = await screen.findByRole("region", { name: "Needs attention" });
    await waitFor(() => { expect(within(panel).getByRole("heading", { name: /^No option yet/u })).toBeDefined(); });
    expect(within(panel).getByText("This provisional hold has no option yet — give it one.")).toBeDefined();
    expect(within(panel).queryByText("No next actions due in the next 7 days.")).toBeNull();
    cleanup();

    getCalendarMock.mockResolvedValue(withAttention([]));
    renderPage();
    expect(await screen.findByText("No next actions due in the next 7 days.")).toBeDefined();
    cleanup();

    getCalendarMock.mockResolvedValue(withAttention([attentionHold({ id: HARTLEY_ID, title: "Hartley wedding" })], 60));
    renderPage();
    expect(await screen.findByText("Showing the 1 most urgent of 60.")).toBeDefined();
  });

  it("keeps an older server's range list, and says it covers only the range", async () => {
    getCalendarMock.mockResolvedValue({ ...fixture(), entries: [fixture().entries[0]] as CalendarEntry[] });
    renderPage();
    expect(await screen.findByText("No overdue next actions in this range.")).toBeDefined();
  });
});

describe("DiaryBoardPage — a new hold's place on its ladder (roadmap N3)", () => {
  it("gives a new hold the next place on the date's ladder, and says what already holds the time", async () => {
    render(
      <MemoryRouter initialEntries={["/diary?view=day&date=2026-09-18"]}>
        <DiaryBoardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /^MacLeod wedding — / });
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    // The Grand Hall's evening, where MacLeod wedding is 1st option.
    expect(within(drawer).getByDisplayValue("2026-09-18T17:00")).toBeTruthy();
    expect(within(drawer).getByRole<HTMLInputElement>("spinbutton", { name: "Option" }).value).toBe("2");
    expect(within(drawer).getByText(
      "Chamber dinner is confirmed then; a hold cannot be confirmed while it stands. Held then: MacLeod wedding (1st option).",
    )).toBeDefined();
    // A free room takes the 1st place.
    fireEvent.change(within(drawer).getByLabelText("Room"), { target: { value: SALOON } });
    expect(within(drawer).getByRole<HTMLInputElement>("spinbutton", { name: "Option" }).value).toBe("1");
    expect(within(drawer).getByText("Nothing else holds the Saloon then.")).toBeDefined();
  });
});

describe("DiaryBoardPage — the reduced toolbar (roadmap N3)", () => {
  it("keeps New booking beside the title, and what changes how the board is read in View", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    const heading = screen.getByRole("heading", { level: 1, name: "The Diary" }).parentElement as HTMLElement;
    expect(within(heading).getByRole("button", { name: "New booking" }).getAttribute("aria-keyshortcuts")).toBe("N");
    expect(screen.getByRole("button", { name: "Earlier" }).getAttribute("title")).toBe("Earlier ([)");
    expect(screen.getByRole("button", { name: "Later" }).getAttribute("title")).toBe("Later (])");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Show released & cancelled" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("checkbox", { name: "Show released & cancelled" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDefined();
  });

  it("answers o, ? and n, and no letter reaches behind the guide", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.keyDown(window, { key: "o" });
    expect(screen.getByRole("button", { name: "Timeline" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "o" });
    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "?" });
    const guide = screen.getByRole("dialog", { name: "Using the Diary" });
    expect(within(guide).getByText("Go to a date")).toBeDefined();
    // Behind the guide, n neither opens a booking nor moves the board.
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.queryByRole("dialog", { name: "New booking" })).toBeNull();
    expect(screen.getByText("Week of Mon, 14 Sept 2026")).toBeDefined();
    fireEvent.keyDown(guide, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Using the Diary" })).toBeNull();

    fireEvent.keyDown(window, { key: "n" });
    expect(await screen.findByRole("dialog", { name: "New booking" })).toBeDefined();
  });
});

describe("DiaryBoardPage — Go to date (roadmap N3)", () => {
  /** The answer as shown: its day, then each room with its lines. */
  function goToAnswer(): { readonly day: string; readonly rooms: readonly (readonly [string, readonly string[]])[] } | null {
    const answer = document.querySelector(".diary-goto-answer");
    const day = answer?.querySelector(".diary-goto-day")?.textContent ?? null;
    if (answer === null || day === null) return null;
    return {
      day,
      rooms: Array.from(answer.querySelectorAll(".diary-goto-room")).map((room) => [
        room.querySelector("dt")?.textContent ?? "",
        Array.from(room.querySelectorAll("dd")).map((line) => line.textContent ?? ""),
      ] as const),
    };
  }

  it("goes to the week of a date as it was said, and answers per room", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.keyDown(window, { key: "g" });
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    await waitFor(() => { expect(document.activeElement).toBe(field); });
    fireEvent.change(field, { target: { value: "5 Jun 27" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    // The board reads the week of Saturday 5 June 2027, Monday 31 May onwards.
    await waitFor(() => {
      expect(getCalendarMock.mock.calls.some((call) => call[1] === "2027-05-30T23:00:00.000Z")).toBe(true);
    });
    expect(await screen.findByText("Week of Mon, 31 May 2027")).toBeDefined();
    await waitFor(() => {
      expect(goToAnswer()).toEqual({ day: "Sat, 5 Jun 2027", rooms: [["Grand Hall", ["Free"]], ["Saloon", ["Free"]]] });
    });
  });

  it("names what each room holds on a day the board has read", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.click(screen.getByRole("button", { name: "Go to date" }));
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    fireEvent.change(field, { target: { value: "18/09/2026" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    // The confirmed dinner has the evening, so the 1st option it overlaps is left out.
    await waitFor(() => {
      expect(goToAnswer()).toEqual({
        day: "Fri, 18 Sept 2026",
        rooms: [["Grand Hall", ["Confirmed, Chamber dinner, 18:00–23:00"]], ["Saloon", ["Free"]]],
      });
    });
  });

  it("names a hold by its own place on the ladder, with its time and decision date", async () => {
    const withoutTheDinner = fixture();
    getCalendarMock.mockResolvedValue({
      ...withoutTheDinner,
      entries: withoutTheDinner.entries.filter((entry) => entry.id !== INK_ID),
      conflicts: { ...withoutTheDinner.conflicts, conflicts: [] },
    });
    renderPage();
    await screen.findByRole("button", { name: /^MacLeod wedding — / });
    fireEvent.keyDown(window, { key: "g" });
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    fireEvent.change(field, { target: { value: "Fri 18 Sept 2026" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => { expect(goToAnswer()?.rooms[0]?.[0]).toBe("Grand Hall"); });
    // It ends at midnight, so the board's own label names both days.
    expect(goToAnswer()?.rooms[0]?.[1]).toEqual([
      expect.stringMatching(/^1st option MacLeod wedding, 18 Sept? 19:00 – 19 Sept? 00:00, decides Tue 1 Dec( 2026)?$/u),
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the words are not a date, and leaves the board where it is", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.keyDown(window, { key: "g" });
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    fireEvent.change(field, { target: { value: "next Thursday-ish" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect((await screen.findByRole("alert")).textContent).toBe("The Diary cannot read that as a date. Try 5 Jun 27 or 05/06/2027.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Week of Mon, 14 Sept 2026")).toBeDefined();
  });

  it("goes to the date, and says so when the weekday said with it is another", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.keyDown(window, { key: "g" });
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    fireEvent.change(field, { target: { value: "Fri 5 Jun 27" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect((await screen.findByRole("alert")).textContent).toBe("That date is a Saturday, not a Friday.");
    expect(field.getAttribute("aria-invalid")).toBe("false");
    await waitFor(() => { expect(goToAnswer()?.day).toBe("Sat, 5 Jun 2027"); });
    // New words put the hint back.
    fireEvent.change(field, { target: { value: "Sat 5 Jun 27" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("As you would say it: 5 Jun 27, 05/06/2027 or 5th June.")).toBeDefined();
  });

  it("closes with Escape and gives focus back to its button", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.click(screen.getByRole("button", { name: "Go to date" }));
    const field = await screen.findByRole("textbox", { name: "Go to date" });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("textbox", { name: "Go to date" })).toBeNull(); });
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go to date" })); });
  });

  it("moves the range with [ and ]", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    fireEvent.keyDown(window, { key: "]" });
    expect(await screen.findByText("Week of Mon, 21 Sept 2026")).toBeDefined();
    fireEvent.keyDown(window, { key: "[" });
    fireEvent.keyDown(window, { key: "[" });
    expect(await screen.findByText("Week of Mon, 7 Sept 2026")).toBeDefined();
  });

  it("opens on an enquiry slip's date from its tile, and gives focus back to the tile on closing", async () => {
    listEnquiriesMock.mockResolvedValue([{ ...trayEnquiry(2, "submitted"), name: "Law Society", preferredDate: "2027-06-05" }]);
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    const tile = await screen.findByRole("button", { name: "Show Saturday 5 June 2027 on the board" });
    tile.focus();
    fireEvent.click(tile);

    await waitFor(() => {
      expect(getCalendarMock.mock.calls.some((call) => call[1] === "2027-05-30T23:00:00.000Z")).toBe(true);
    });
    expect(await screen.findByText("Week of Mon, 31 May 2027")).toBeDefined();
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Go to date" });
    expect(field.value).toBe("Sat 5 Jun 2027");
    await waitFor(() => { expect(document.activeElement).toBe(field); });
    await waitFor(() => {
      expect(goToAnswer()).toEqual({ day: "Sat, 5 Jun 2027", rooms: [["Grand Hall", ["Free"]], ["Saloon", ["Free"]]] });
    });

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => { expect(document.activeElement).toBe(tile); });
    expect(screen.queryByRole("textbox", { name: "Go to date" })).toBeNull();
  });
});

describe("DiaryBoardPage — enquiry slips carry their date (roadmap N3)", () => {
  /** Each slip as read: its tile's words, whether the tile can be pressed,
   *  and the line under the name. */
  function slips(): { readonly name: string; readonly tile: string; readonly pressable: boolean; readonly past: boolean; readonly line: string }[] {
    return Array.from(document.querySelectorAll(".diary-tray-enquiry")).map((slip) => {
      const tile = slip.querySelector(".diary-slip-date");
      return {
        name: slip.querySelector(".diary-tray-item-title")?.textContent ?? "",
        tile: Array.from(tile?.children ?? []).map((part) => part.textContent ?? "").join(" "),
        pressable: tile?.tagName === "BUTTON",
        past: tile?.classList.contains("is-past") ?? false,
        line: slip.querySelector(".diary-tray-item-reason")?.textContent ?? "",
      };
    });
  }

  it("shows each enquiry's date as a tile, the year only when it is not this one, and how far off it is", async () => {
    const restore = pinDate("2026-09-16T09:00:00.000Z");
    try {
      listEnquiriesMock.mockResolvedValue([
        { ...trayEnquiry(1, "submitted"), name: "Fiona MacLeod", preferredDate: "2026-09-19", eventType: "wedding", estimatedGuests: 120 },
        { ...trayEnquiry(2, "submitted"), name: "Law Society", preferredDate: "2027-06-05" },
        { ...trayEnquiry(3, "submitted"), name: "Kerr anniversary", preferredDate: null, estimatedGuests: null },
        { ...trayEnquiry(4, "submitted"), name: "Spring ceilidh", preferredDate: "2026-04-11" },
      ]);
      renderPage();
      await screen.findByText("Law Society");
      expect(slips()).toEqual([
        { name: "Fiona MacLeod", tile: "Sat 19 Sep", pressable: true, past: false, line: "wedding · 120 guests · in 3 days" },
        { name: "Law Society", tile: "Sat 5 Jun \u201927", pressable: true, past: false, line: "dinner · 40 guests · in 8 months" },
        { name: "Kerr anniversary", tile: "Date TBC", pressable: false, past: false, line: "dinner · date to be confirmed" },
        { name: "Spring ceilidh", tile: "Sat 11 Apr", pressable: true, past: true, line: "dinner · 40 guests · date has passed" },
      ]);
      // The tile's words are read as one date, not as "Sat", "19", "Sep".
      expect(screen.getByRole("button", { name: "Show Saturday 19 September 2026 on the board" })).toBeDefined();
      expect(document.querySelector(".diary-slip-date.is-open")?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      restore();
    }
  });
});

describe("DiaryBoardPage — contested dates, venue-wide (roadmap N3)", () => {
  function contestedEntry(overrides: Partial<CalendarBookingEntry> & Pick<CalendarBookingEntry, "id" | "title">): CalendarBookingEntry {
    return {
      entryType: "booking", spaceId: SALOON, kind: "hold", status: "active", state: "hold", eventType: "wedding",
      startsAt: "2027-03-20T15:00:00.000Z", endsAt: "2027-03-20T23:00:00.000Z", rank: 1, jointFlag: false,
      decisionAt: "2026-10-02T12:00:00.000Z", ownerUserId: "00000000-0000-4000-8000-0000000000aa",
      ownerName: "Fiona Coordinator", nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, ...overrides,
    };
  }
  const FIRST = contestedEntry({ id: "00000000-0000-4000-8000-0000000000f1", title: "Hartley wedding" });
  const SECOND = contestedEntry({
    id: "00000000-0000-4000-8000-0000000000f2", title: "Guild dinner", rank: 2, startsAt: "2027-03-20T17:00:00.000Z",
    decisionAt: "2026-09-10T12:00:00.000Z", ownerUserId: null, ownerName: null,
  });
  const DINNER = contestedEntry({
    id: "00000000-0000-4000-8000-0000000000f3", title: "Law Society dinner", spaceId: GRAND_HALL, kind: "ink", state: "ink",
    rank: null, decisionAt: null, startsAt: "2026-11-14T18:00:00.000Z", endsAt: "2026-11-14T23:00:00.000Z",
  });
  const BEHIND = contestedEntry({
    id: "00000000-0000-4000-8000-0000000000f4", title: "Kerr reception", spaceId: GRAND_HALL,
    startsAt: "2026-11-14T17:00:00.000Z", endsAt: "2026-11-14T22:00:00.000Z",
  });

  function withContested(): CalendarResponse {
    return {
      ...fixture(),
      contested: {
        dates: [
          { spaceId: GRAND_HALL, startsAt: BEHIND.startsAt, endsAt: DINNER.endsAt, bookings: [DINNER, BEHIND] },
          { spaceId: SALOON, startsAt: FIRST.startsAt, endsAt: FIRST.endsAt, bookings: [FIRST, SECOND] },
        ],
        total: 3,
      },
    };
  }

  /** Each card as read: its heading, then each booking's lines. */
  function cards(): { readonly when: string; readonly ladder: string[][] }[] {
    return Array.from(document.querySelectorAll(".diary-contested-date")).map((card) => ({
      when: card.querySelector(".diary-contested-when")?.textContent ?? "",
      ladder: Array.from(card.querySelectorAll(".diary-contested-booking")).map((row) =>
        Array.from(row.children).map((line) => line.textContent ?? "")),
    }));
  }

  it("lists each contested date with its ladder, the confirmed booking first, in Blake's words", async () => {
    getCalendarMock.mockResolvedValue(withContested());
    const restore = pinDate("2026-09-16T10:00:00.000Z");
    try {
      renderPage();
      const panel = await screen.findByRole("region", { name: "Contested dates" });
      expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("Contested dates 3");
      expect(cards()).toEqual([
        { when: "Grand Hall · Sat 14 Nov", ladder: [
          ["Law Society dinner", "Confirmed · Fiona Coordinator", "18:00–23:00"],
          ["Kerr reception", "1st option · Fiona Coordinator", "17:00–22:00", "Decide by Fri 2 Oct"],
        ] },
        { when: "Saloon · Sat 20 Mar 2027", ladder: [
          ["Hartley wedding", "1st option · Fiona Coordinator", "15:00–23:00", "Decide by Fri 2 Oct"],
          ["Guild dinner", "2nd option · No owner", "17:00–23:00", "Decision was due Thu 10 Sept"],
        ] },
      ]);
      expect(within(panel).getByText("Showing the 2 soonest of 3.")).toBeDefined();
    } finally {
      restore();
    }
  });

  it("opens a contested booking where it stands, without moving the board, and gives focus back", async () => {
    getCalendarMock.mockResolvedValue(withContested());
    renderPage();
    const panel = await screen.findByRole("region", { name: "Contested dates" });
    const row = within(panel).getByRole("button", { name: /Guild dinner/ });
    const title = document.querySelector(".diary-range-title")?.textContent;
    row.focus();
    fireEvent.click(row);
    const drawer = await screen.findByRole("dialog", { name: "Booking details" });
    expect(within(drawer).getByDisplayValue("Guild dinner")).toBeTruthy();
    expect(document.querySelector(".diary-range-title")?.textContent).toBe(title);
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(document.activeElement).toBe(row); });
  });

  it("says when nothing is contested, and shows no list for an older API that sends none", async () => {
    getCalendarMock.mockResolvedValue({ ...fixture(), contested: { dates: [], total: 0 } });
    const view = renderPage();
    const panel = await screen.findByRole("region", { name: "Contested dates" });
    expect(within(panel).getByText("No date in the year ahead is wanted by more than one booking.")).toBeDefined();
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("Contested dates");
    view.unmount();
    getCalendarMock.mockResolvedValue(fixture());
    renderPage();
    await screen.findByRole("button", { name: /^Chamber dinner — / });
    expect(screen.queryByRole("region", { name: "Contested dates" })).toBeNull();
  });
});
