import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../hooks/useDiaryLive.js", () => ({
  useDiaryLive: () => ({
    connected: true,
    presence: [{ userId: "presence-1", name: "Elaine", role: "hallkeeper" }],
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
    expect(
      await screen.findByText(/pencils a slot already inked by "Chamber dinner"/),
    ).toBeDefined();
    expect(screen.getByText("Turnaround gaps: not checked")).toBeDefined();
  });

  it("lists overdue pencils in the needs-attention tray", async () => {
    renderPage();
    expect(await screen.findByText("Needs attention")).toBeDefined();
    expect(screen.getByText(/Overdue next action: Call Fiona MacLeod\./)).toBeDefined();
  });

  it("shows the read-only chip for hallkeeper", async () => {
    setUser("hallkeeper");
    renderPage();
    expect(await screen.findByText(/Read-only view/)).toBeDefined();
  });

  it("does not show the read-only chip for staff", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByText(/Read-only view/)).toBeNull();
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
    expect(screen.getByText(/enquiry itself stays where it is/)).toBeDefined();
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
    const panel = await screen.findByRole("dialog", { name: "The Diary, in one minute" });
    expect(panel).toBeDefined();
    expect(screen.getByText(/option ladder/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Take me to the diary" }));
    expect(screen.queryByRole("dialog", { name: "The Diary, in one minute" })).toBeNull();
    first.unmount();

    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("dialog", { name: "The Diary, in one minute" })).toBeNull();
  });

  it("the header reopens the welcome any time; Escape closes it (T-520)", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("dialog", { name: "The Diary, in one minute" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How the Diary works" }));
    const panel = screen.getByRole("dialog", { name: "The Diary, in one minute" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "The Diary, in one minute" })).toBeNull();
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
