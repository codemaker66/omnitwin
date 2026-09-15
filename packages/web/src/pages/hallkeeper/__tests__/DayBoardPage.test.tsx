import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
import type { ReactElement } from "react";
import { DayBoardPage, DayBoardSlotRequestsContext } from "../DayBoardPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// Render contract for the Day Board page (Day Board S1): lanes from the live
// calendar, state chips whose TEXT carries the meaning (the reduced-motion
// and colour-blind experience), the legend, the quiet-house empty state, and
// the error/retry path — against a mocked calendar API.
// ---------------------------------------------------------------------------

const { getCalendarMock, liveUpdate, resolveLayoutsMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn(), liveUpdate: { current: null as (() => void) | null },
  resolveLayoutsMock: vi.fn(),
}));

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
}));

// The setup-sheet corridor resolves event-owned references over the network;
// the page contract under test is which STATE it paints, not the resolution.
vi.mock("../../../lib/event-linked-layouts.js", () => ({
  resolveEventLinkedLayouts: resolveLayoutsMock,
}));

vi.mock("../../diary/hooks/useDiaryLive.js", () => ({
  useDiaryLive: (_enabled: boolean, onUpdate: () => void) => {
    liveUpdate.current = onUpdate;
    return { connected: true, presence: [] };
  },
}));

// The page wears the app shell; stub its Clerk/venue/notification edges the
// same way every other shell-wearing spec does.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("../../../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));
vi.mock("../../../components/dashboard/NotificationCenter.js", () => ({
  NotificationCenter: () => null,
}));

const VENUE = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const CONFIG_ID = "00000000-0000-4000-8000-0000000000c1";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";

function calendarFixture(entries: CalendarResponse["entries"]): CalendarResponse {
  return {
    venueId: VENUE,
    range: {
      from: new Date(Date.now() - 12 * 3_600_000).toISOString(),
      to: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries,
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
  };
}

function liveBooking(): CalendarResponse["entries"][number] {
  return {
    entryType: "booking",
    id: "00000000-0000-4000-8000-0000000000b1",
    spaceId: GRAND_HALL,
    kind: "ink",
    status: "active",
    state: "ink",
    title: "Chamber dinner",
    eventType: "dinner",
    startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
  } as CalendarResponse["entries"][number];
}

function bookingWithEvent(): CalendarResponse["entries"][number] {
  return { ...liveBooking(), eventId: EVENT_ID } as CalendarResponse["entries"][number];
}

function renderBoard(): void {
  render(
    <MemoryRouter initialEntries={["/hallkeeper/today"]}>
      <DayBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCalendarMock.mockReset();
  resolveLayoutsMock.mockReset();
  resolveLayoutsMock.mockResolvedValue({ eventName: "Chamber dinner", roomName: "Grand Hall", layouts: [], unavailableCount: 0 });
  liveUpdate.current = null;
  useAuthStore.getState().setUser({
    id: "00000000-0000-4000-8000-0000000000ff",
    email: "keeper@tradeshall.co.uk",
    role: "hallkeeper",
    platformRole: "none",
    venueId: VENUE,
    name: "Elaine",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().logout();
});

describe("DayBoardPage", () => {
  it("keeps an unassigned account static without starting a calendar request", async () => {
    const user = useAuthStore.getState().user;
    if (user === null) throw new Error("Expected test user");
    useAuthStore.getState().setUser({ ...user, venueId: null });
    renderBoard();
    expect(screen.getByText(/No venue is linked to this account/u)).toBeTruthy();
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(getCalendarMock).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("keeps the board visible during a refresh until it %ss", async (settlement) => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    let resolveRefresh: ((value: CalendarResponse) => void) | undefined;
    let rejectRefresh: ((reason: Error) => void) | undefined;
    const response = new Promise<CalendarResponse>((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
    getCalendarMock.mockReturnValue(response);
    act(() => { liveUpdate.current?.(); });
    const activity = await screen.findByText("Refreshing the day’s bookings…");
    expect(activity.closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    await act(async () => {
      if (settlement === "resolve") resolveRefresh?.(calendarFixture([liveBooking()]));
      else rejectRefresh?.(new Error("Offline"));
      await response.catch(() => undefined);
    });
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    if (settlement === "reject") expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows one shared status while retrying a failed background refresh and keeps the board visible", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    let rejectRefresh: ((reason: Error) => void) | undefined;
    let resolveRetry: ((value: CalendarResponse) => void) | undefined;
    const refresh = new Promise<CalendarResponse>((_resolve, reject) => { rejectRefresh = reject; });
    const retry = new Promise<CalendarResponse>((resolve) => { resolveRetry = resolve; });
    getCalendarMock.mockReturnValueOnce(refresh).mockReturnValueOnce(retry);

    act(() => { liveUpdate.current?.(); });
    await screen.findByText("Refreshing the day’s bookings…");
    await act(async () => { rejectRefresh?.(new Error("Offline")); await refresh.catch(() => undefined); });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(getCalendarMock).toHaveBeenCalledTimes(3); });

    const sharedStatuses = screen.getAllByRole("status").filter((status) => status.querySelector("[data-activity-indicator]") !== null);
    expect(sharedStatuses).toHaveLength(1);
    expect(sharedStatuses[0]?.textContent).toBe("Refreshing the day’s bookings…");
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();

    await act(async () => { resolveRetry?.(calendarFixture([liveBooking()])); await retry; });
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
  });

  it("does not let a superseded refresh retire the current request's activity", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    let resolveFirst: ((value: CalendarResponse) => void) | undefined;
    let resolveSecond: ((value: CalendarResponse) => void) | undefined;
    const first = new Promise<CalendarResponse>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<CalendarResponse>((resolve) => { resolveSecond = resolve; });
    getCalendarMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(getCalendarMock).toHaveBeenCalledTimes(2); });
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(getCalendarMock).toHaveBeenCalledTimes(3); });
    await act(async () => { resolveFirst?.(calendarFixture([])); await first; });
    expect(screen.getByText("Refreshing the day’s bookings…")).toBeTruthy();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    await act(async () => { resolveSecond?.(calendarFixture([liveBooking()])); await second; });
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
  });
  it("renders a lane per room with live state chips whose text carries the meaning", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    });
    expect(screen.getByRole("region", { name: "Saloon" })).toBeTruthy();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    // The chip text is the reduced-motion / colour-blind contract.
    expect(screen.getByText(/until booked end$/u)).toBeTruthy();
    expect(screen.getByText("Nothing scheduled.")).toBeTruthy();
  });

  it("teaches the colour system: the legend names every meaning in words", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await waitFor(() => {
      expect(screen.getByLabelText("What the colours mean")).toBeTruthy();
    });
    for (const label of ["First phase due", "Booking starts soon", "Needs attention"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("a day with nothing in the diary says so plainly", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([]));
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Nothing scheduled today.")).toBeTruthy();
    });
  });

  // --- The setup-sheet corridor (Ship Friday gate line 20) -----------------
  // The board must reach the room's sheet WITHOUT a compiled handoff pack,
  // and must say plainly when it cannot, with the next action attached.

  it("reaches the room's setup sheet from the slot, carrying the event", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    resolveLayoutsMock.mockResolvedValue({
      eventName: "Chamber dinner", roomName: "Grand Hall", unavailableCount: 0,
      layouts: [{ configurationId: CONFIG_ID, name: "Banquet 120", spaceName: "Grand Hall" }],
    });
    renderBoard();

    const link = await screen.findByRole("link", { name: /Open setup sheet/u });
    expect(link.getAttribute("href")).toBe(`/hallkeeper/${CONFIG_ID}?eventId=${EVENT_ID}`);
    expect(resolveLayoutsMock).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT_ID, spaceSlug: "grand-hall" }));
  });

  it("says why there is no sheet yet and what to do instead of rendering nothing", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    renderBoard();

    expect(await screen.findByText(/No setup sheet yet for Grand Hall/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the event and link the room's layout." }).getAttribute("href"))
      .toBe(`/ops/events/${EVENT_ID}`);
  });

  it("points an unlinked booking at the Diary rather than a dead sheet link", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();

    expect(await screen.findByText(/this booking is not linked to an event/u)).toBeTruthy();
    expect(resolveLayoutsMock).not.toHaveBeenCalled();
  });

  // --- Lane 9's mount point ------------------------------------------------

  it("reserves a request region per slot and renders nothing there by default", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    const region = document.querySelector("[data-slot-requests]");
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe("");
  });

  it("mounts the request surface with the slot's identity when one is supplied", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    const seen: string[] = [];
    function SlotRequests(props: { readonly bookingId: string; readonly roomName: string }): ReactElement {
      seen.push(`${props.roomName}:${props.bookingId}`);
      return <span>2 requests</span>;
    }
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today"]}>
        <DayBoardSlotRequestsContext.Provider value={SlotRequests}>
          <DayBoardPage />
        </DayBoardSlotRequestsContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("2 requests")).toBeTruthy();
    expect(seen[0]).toBe("Grand Hall:00000000-0000-4000-8000-0000000000b1");
  });

  it("names the venue's own timezone rather than a hard-coded one", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    expect(screen.getByText(/Europe\/London/u)).toBeTruthy();
  });

  it("a failed load shows the error and a retry that refetches", async () => {
    getCalendarMock.mockRejectedValueOnce(new Error("network down"));
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(getCalendarMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByText("Chamber dinner")).toBeTruthy();
    });
  });
});
