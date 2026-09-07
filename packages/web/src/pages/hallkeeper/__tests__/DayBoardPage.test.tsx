import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse } from "@omnitwin/types";
import { DayBoardPage } from "../DayBoardPage.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// Render contract for the Day Board page (Day Board S1): lanes from the live
// calendar, state chips whose TEXT carries the meaning (the reduced-motion
// and colour-blind experience), the legend, the quiet-house empty state, and
// the error/retry path — against a mocked calendar API.
// ---------------------------------------------------------------------------

const { getCalendarMock, liveUpdate } = vi.hoisted(() => ({
  getCalendarMock: vi.fn(), liveUpdate: { current: null as (() => void) | null },
}));

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
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

function renderBoard(): void {
  render(
    <MemoryRouter initialEntries={["/hallkeeper/today"]}>
      <DayBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCalendarMock.mockReset();
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
      expect(screen.getByText("Nothing in the diary today. A quiet house.")).toBeTruthy();
    });
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
