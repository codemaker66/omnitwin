import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
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
  listOpenEnquiriesMock,
} = vi.hoisted(() => ({
  getCalendarMock: vi.fn(),
  moveBookingMock: vi.fn(),
  createBookingMock: vi.fn(),
  updateBookingMock: vi.fn(),
  transitionBookingMock: vi.fn(),
  convertEnquiryMock: vi.fn(),
  listOpenEnquiriesMock: vi.fn(),
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
  listOpenEnquiries: listOpenEnquiriesMock,
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

// Presence is mutable so a test can put THIS user in the roster and check
// the count still speaks about other people (T-619).
const { presenceState } = vi.hoisted(() => ({
  presenceState: {
    rows: [{ userId: "presence-1", name: "Elaine", role: "hallkeeper" }] as readonly {
      userId: string; name: string; role: string;
    }[],
  },
}));

vi.mock("../hooks/useDiaryLive.js", () => ({
  useDiaryLive: () => ({
    connected: true,
    presence: presenceState.rows,
  }),
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
            '"MacLeod wedding" (1st option) pencils a slot already inked by "Chamber dinner" — the pencil cannot convert while the ink stands; release it or offer another date.',
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

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/diary?view=week&date=2026-09-16"]}>
      <DiaryBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCalendarMock.mockResolvedValue(fixture());
  listOpenEnquiriesMock.mockResolvedValue([
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
  presenceState.rows = [{ userId: "presence-1", name: "Elaine", role: "hallkeeper" }];
  // Most tests exercise a returning coordinator — the first-run welcome has
  // its own dedicated tests below.
  window.localStorage.setItem(welcomeStorageKey(STAFF_USER_ID), "1");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
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
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
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
    listOpenEnquiriesMock.mockReturnValue(response);
    renderPage();
    await screen.findByText("Loading open enquiries…");
    expect(screen.queryByText("No open enquiries right now.")).toBeNull();
    await act(async () => { rejectRequest?.(new Error("Offline")); await response.catch(() => undefined); });
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(screen.queryByText("No open enquiries right now.")).toBeNull();
    expect(screen.getByText(/Enquiries could not be refreshed/)).toBeTruthy();
    listOpenEnquiriesMock.mockResolvedValue([]);
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
    listOpenEnquiriesMock.mockReturnValue(response);
    // The reload is now an explicit act — Refresh — rather than a side
    // effect of moving the board (T-619).
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Loading open enquiries…");
    expect(screen.getByText("Fiona MacLeod")).toBeTruthy();
    await act(async () => { rejectRequest?.(new Error("Offline")); await response.catch(() => undefined); });
    expect(screen.queryByText("Loading open enquiries…")).toBeNull();
    expect(screen.getByText("Fiona MacLeod")).toBeTruthy();
    expect(screen.getByText(/Enquiries could not be refreshed/)).toBeTruthy();
  });

  // Gate line 17 (T-619): the tray reads every OPEN enquiry once, and a
  // board move is not a reason to read it again. Before this, panning a week
  // re-fetched the whole enquiry list — a round trip per interaction, for
  // data that cannot have changed.
  it("reads open enquiries once and does not re-read them when the board moves", async () => {
    getCalendarMock.mockImplementation(() => Promise.resolve(fixture()));
    renderPage();
    await screen.findByText("Fiona MacLeod");
    expect(listOpenEnquiriesMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => { expect(getCalendarMock.mock.calls.length).toBeGreaterThan(1); });
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await waitFor(() => { expect(getCalendarMock.mock.calls.length).toBeGreaterThan(2); });
    expect(listOpenEnquiriesMock).toHaveBeenCalledTimes(1);
  });
  it("renders lanes, blocks, and the legend from the calendar response", async () => {
    renderPage();
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(screen.getByText("Saloon")).toBeDefined();
    expect(screen.getByText("Chamber dinner")).toBeDefined();
    // The hold appears both as a lane block and as a tray item — by design.
    expect(screen.getAllByText("MacLeod wedding").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Inked — confirmed")).toBeDefined();
    expect(screen.getByText(/Planning support only/)).toBeDefined();
  });

  it("surfaces conflict explanations and the honest turnaround status", async () => {
    renderPage();
    const warning = await screen.findByText("Warning");
    fireEvent.click(warning);
    expect(warning.closest("details")?.open).toBe(true);
    expect(
      await screen.findByText(/pencils a slot already inked by "Chamber dinner"/),
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
    expect(getCalendarMock).toHaveBeenCalledTimes(2);
  });

  it("keyboard-moves a pencil with Space and PATCHes the snapped window (review P2 coverage)", async () => {
    moveBookingMock.mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
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
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
    fireEvent.keyDown(block, { key: " " });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    fireEvent.keyDown(block, { key: " " });
    expect(await screen.findByText(/could not be saved/)).toBeDefined();
  });

  it("Enter opens the booking drawer prefilled from the block (T-495)", async () => {
    renderPage();
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
    fireEvent.keyDown(block, { key: "Enter" });
    const drawer = await screen.findByRole("dialog", { name: "Booking details" });
    expect(drawer).toBeDefined();
    expect(screen.getByDisplayValue("MacLeod wedding")).toBeDefined();
    // The pencil's lifecycle actions come from the shared matrix.
    expect(screen.getByRole("button", { name: "Ink it" })).toBeDefined();
  });

  it("converts an open enquiry through the drawer (T-496)", async () => {
    convertEnquiryMock.mockResolvedValue({ title: "Fiona MacLeod — wedding" });
    renderPage();
    const convert = await screen.findByRole("button", { name: "Pencil in…" });
    convert.click();
    const drawer = await screen.findByRole("dialog", { name: "Pencil in this enquiry" });
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
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
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
    const block = await screen.findByRole("button", { name: /MacLeod wedding — Pencil/ });
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
    expect(screen.getByText(/Pencils may overlap/)).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: "How the Diary works" }));
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
// T-619 — the timetable slice. Create-in-context, shortcuts that stay off a
// surface the coordinator is typing into, a presence count that means other
// people, and the retired month board's deep links.
// ---------------------------------------------------------------------------

describe("DiaryBoardPage — create in context (T-619)", () => {
  it("seeds New booking with the day being looked at, not the range's first instant", async () => {
    // The board is anchored on the week of 16 Sep; "now" sits inside it, so
    // the drawer should open on 16 Sep, NOT on the Monday the range starts.
    vi.setSystemTime(Date.parse("2026-09-16T10:00:00.000Z"));
    renderPage();
    await screen.findByText("Grand Hall");
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    // Queried by the value the coordinator actually sees, which keeps these
    // assertions free of DOM casts the lint rules (rightly) dislike.
    expect(within(drawer).getByDisplayValue("2026-09-16T17:00")).toBeTruthy();
    expect(within(drawer).getByDisplayValue("Grand Hall")).toBeTruthy();
    vi.useRealTimers();
  });

  it("opens the drawer prefilled from an empty overview cell's room and day", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    // Every room/day square carries its own create control, named for what
    // it will make — that name IS the contract with the coordinator. One per
    // day of the week, so the first is the Monday the range opens on.
    const cells = screen.getAllByRole("button", { name: /^New booking — Saloon, / });
    expect(cells).toHaveLength(7);
    fireEvent.click(cells[0] as HTMLElement);
    const drawer = screen.getByRole("dialog", { name: "New booking" });
    // The clicked ROOM, and the clicked DAY at the house's default evening
    // hour — not the room the venue happens to sort first, and not "now".
    expect(within(drawer).getByDisplayValue("Saloon")).toBeTruthy();
    expect(within(drawer).getByDisplayValue("2026-09-14T17:00")).toBeTruthy();
  });

  it("offers no create affordance to a read-only role", async () => {
    setUser("hallkeeper");
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("button", { name: /^New booking — / })).toBeNull();
    expect(screen.queryByRole("button", { name: "New booking" })).toBeNull();
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
    // "d" is the board's Day shortcut and a <select>'s type-ahead. The
    // select wins: the drawer must not have the ground moved under it.
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
    presenceState.rows = [
      { userId: STAFF_USER_ID, name: "Test Staff", role: "staff" },
      { userId: "presence-1", name: "Elaine", role: "hallkeeper" },
    ];
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByText("Live · 1")).toBeTruthy();
  });

  it("says only Live when you are the only person on the board", async () => {
    presenceState.rows = [{ userId: STAFF_USER_ID, name: "Test Staff", role: "staff" }];
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText(/Live · /)).toBeNull();
  });

  it("lands an old ?view=month deep link on the week that anchor falls in", async () => {
    render(
      <MemoryRouter initialEntries={["/diary?view=month&date=2026-09-16"]}>
        <DiaryBoardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Grand Hall");
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Month" })).toBeNull();
  });
});
