import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarResponse, VenueRequest } from "@omnitwin/types";
import type { ReactElement } from "react";
import { DayBoardPage, DayBoardSlotRequestsContext } from "../DayBoardPage.js";
import { DAY_BOARD_LEGEND, DAY_BOARD_RING_LEGEND } from "../lib/day-board-state.js";
import { boardRange, msToWallInput, wallInputToMs } from "../../diary/lib/board-time.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { CALENDAR_REUSE_MS } from "../../diary/hooks/useCalendar.js";
import { SLOT_REQUESTS_UNAVAILABLE, SlotRequestsContext } from "../../../components/requests/requests-context.js";

// ---------------------------------------------------------------------------
// Render contract for the Day Board page (goal 19 S3): lanes from the live
// calendar laid on one ruler, slabs whose VERB carries the meaning (the
// reduced-motion and colour-blind experience), the next-action line, the
// copper ring and the UNOWNED rail, the stale band that stops every breath,
// the wall register, the legend, the quiet-house empty state, and the
// error/retry path — against a mocked calendar API. A tap on a slab opens
// the slot: its sheet, its event and its request region live there.
// ---------------------------------------------------------------------------

const { getCalendarMock, getVenueMock, liveUpdate, liveConnected, resolveLayoutsMock, getSummaryMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn<(venueId: string, from: string, to: string, signal?: AbortSignal) => Promise<CalendarResponse>>(),
  getVenueMock: vi.fn(), liveUpdate: { current: null as (() => void) | null },
  liveConnected: { current: true }, resolveLayoutsMock: vi.fn(), getSummaryMock: vi.fn(),
}));

vi.mock("../../../api/hallkeeper-summary.js", () => ({
  getSheetSummary: getSummaryMock,
}));

vi.mock("../../../api/diary.js", () => ({
  getCalendar: getCalendarMock,
}));

// The setup-sheet corridor resolves event-owned references over the network;
// the page contract under test is which STATE it paints, not the resolution.
vi.mock("../../../lib/event-linked-layouts.js", () => ({
  resolveEventLinkedLayouts: resolveLayoutsMock,
}));

// The venue keeps UK time; the device reading the board is somewhere else,
// whatever zone the machine running this suite happens to keep.
vi.mock("../../../components/hallkeeper/sheet-facts.js", async () => {
  const actual = await vi.importActual<typeof import("../../../components/hallkeeper/sheet-facts.js")>("../../../components/hallkeeper/sheet-facts.js");
  return { ...actual, deviceZone: () => "America/New_York" };
});

vi.mock("../../diary/hooks/useDiaryLive.js", () => ({
  useDiaryLive: (_enabled: boolean, onUpdate: () => void) => {
    liveUpdate.current = onUpdate;
    return { connected: liveConnected.current, presence: [] };
  },
}));

// The page wears the app shell; stub its Clerk/venue/notification edges the
// same way every other shell-wearing spec does.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("../../../api/spaces.js", () => ({
  getVenue: getVenueMock,
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

/** A tap on the slab named for `title` opens the slot. */
async function openSlot(title: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${title},`, "u") }));
}

/** An open request against the dinner, nobody's yet. */
function venueRequest(overrides: Partial<VenueRequest> = {}): VenueRequest {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    venueId: VENUE,
    bookingId: "00000000-0000-4000-8000-0000000000b1",
    eventId: null,
    roomId: GRAND_HALL,
    roomName: "Grand Hall",
    kind: "chairs",
    quantity: 10,
    urgency: "soon",
    detail: null,
    requestedByUserId: "00000000-0000-4000-8000-0000000000fe",
    requestedByName: "Morag",
    requestedByRole: "hallkeeper",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"],
    ownerUserId: null,
    ownerName: null,
    state: "sent",
    outcome: null,
    outcomeNote: null,
    escalationDueAt: null,
    escalatedAt: null,
    acknowledgedAt: null,
    acceptedAt: null,
    resolvedAt: null,
    threadId: null,
    handoverToUserId: null,
    handoverToName: null,
    handedOverAt: null,
    underwayAt: null,
    reopenedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface DayRead { readonly from: string; readonly to: string }

/** The day `offset` days from today as the board asks for it: from the
 *  venue's midnight to the next, the day holding noon of that date. Worked
 *  out here from the date, not by stepping a range, so a read ahead that
 *  lands on another day's midnights would not match it. */
function dayRange(offset: number, timeZone = "Europe/London"): DayRead {
  const today = msToWallInput(Date.now(), timeZone).slice(0, 10);
  const date = new Date(Date.parse(`${today}T12:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const noon = wallInputToMs(`${date}T12:00`, timeZone);
  if (noon === null) throw new Error(`No noon on ${date}`);
  const range = boardRange(noon, "day", timeZone);
  return { from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString() };
}

/** How many times the board has asked for `day`. */
function readsOf(day: DayRead): number {
  return getCalendarMock.mock.calls.filter(([, from, to]) => from === day.from && to === day.to).length;
}

/** Today's reads answer from `queue` in turn, then with `fallback`; the days
 *  either side, read ahead, answer with a quiet day. */
function serveToday(fallback: CalendarResponse, queue: Promise<CalendarResponse>[] = []): void {
  const today = dayRange(0);
  getCalendarMock.mockImplementation((_venueId, from) =>
    from === today.from ? queue.shift() ?? Promise.resolve(fallback) : Promise.resolve(calendarFixture([])));
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: Error) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getVenueMock.mockReset();
  getVenueMock.mockResolvedValue({ id: "venue-1", name: "Trades Hall" });
  getCalendarMock.mockReset();
  resolveLayoutsMock.mockReset();
  // A summary that never arrives shows no line, which other cases expect.
  getSummaryMock.mockReset();
  getSummaryMock.mockReturnValue(new Promise(() => undefined));
  resolveLayoutsMock.mockResolvedValue({ eventName: "Chamber dinner", roomName: "Grand Hall", layouts: [], unavailableCount: 0 });
  liveUpdate.current = null;
  liveConnected.current = true;
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
  it("tells an account not connected to a venue so, without starting a calendar request", async () => {
    const user = useAuthStore.getState().user;
    if (user === null) throw new Error("Expected test user");
    useAuthStore.getState().setUser({ ...user, venueId: null });
    renderBoard();
    expect(screen.getByRole("heading", { level: 1, name: "The Day Board" })).toBeTruthy();
    expect(screen.getByText("Your account is not connected to a venue yet, so there are no bookings to show.")).toBeTruthy();
    // Nothing is reconnecting, and there is no day to step through.
    expect(screen.queryByText(/reconnecting/iu)).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(getCalendarMock).not.toHaveBeenCalled();
  });

  it("keeps its own line for a platform admin with no venue, and says nothing of reconnecting", async () => {
    const user = useAuthStore.getState().user;
    if (user === null) throw new Error("Expected test user");
    liveConnected.current = false;
    useAuthStore.getState().setUser({ ...user, role: "admin", platformRole: "admin", venueId: null });
    renderBoard();
    expect(screen.getByText(/No venue is linked to this account/u)).toBeTruthy();
    expect(screen.queryByText(/reconnecting/iu)).toBeNull();
    expect(screen.queryByTestId("venue-not-connected")).toBeNull();
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
    if (settlement === "reject") {
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      // The day stays, and the notice says the refresh did not land.
      expect(screen.getByText(/^Couldn't refresh at \d\d:\d\d\./u)).toBeTruthy();
    }
  });

  it("shows one shared status while retrying a failed background refresh and keeps the board visible", async () => {
    const queue: Promise<CalendarResponse>[] = [];
    serveToday(calendarFixture([liveBooking()]), queue);
    renderBoard();
    await screen.findByText("Chamber dinner");
    let rejectRefresh: ((reason: Error) => void) | undefined;
    let resolveRetry: ((value: CalendarResponse) => void) | undefined;
    const refresh = new Promise<CalendarResponse>((_resolve, reject) => { rejectRefresh = reject; });
    const retry = new Promise<CalendarResponse>((resolve) => { resolveRetry = resolve; });
    queue.push(refresh, retry);

    act(() => { liveUpdate.current?.(); });
    await screen.findByText("Refreshing the day’s bookings…");
    await act(async () => { rejectRefresh?.(new Error("Offline")); await refresh.catch(() => undefined); });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(readsOf(dayRange(0))).toBe(3); });

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
    const queue: Promise<CalendarResponse>[] = [];
    serveToday(calendarFixture([liveBooking()]), queue);
    renderBoard();
    await screen.findByText("Chamber dinner");
    let resolveFirst: ((value: CalendarResponse) => void) | undefined;
    let resolveSecond: ((value: CalendarResponse) => void) | undefined;
    const first = new Promise<CalendarResponse>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<CalendarResponse>((resolve) => { resolveSecond = resolve; });
    queue.push(first, second);
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(readsOf(dayRange(0))).toBe(2); });
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(readsOf(dayRange(0))).toBe(3); });
    await act(async () => { resolveFirst?.(calendarFixture([])); await first; });
    expect(screen.getByText("Refreshing the day’s bookings…")).toBeTruthy();
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    await act(async () => { resolveSecond?.(calendarFixture([liveBooking()])); await second; });
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
  });
  it("draws a lane for each room in use, with slabs whose verb carries the meaning, and names the free rooms on one line", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    });
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    // The verb is the colour-blind contract: icon, words and tone together (D3).
    expect(screen.getByText(/^LIVE · \d+ min elapsed$/u)).toBeTruthy();
    const slab = screen.getByRole("button", { name: /^Chamber dinner,/u });
    expect(slab.getAttribute("data-state")).toBe("live");
    expect(slab.getAttribute("data-motion")).toBe("live-breath");
    // A room with nothing on is a name in a line, not a lane to scroll past.
    expect(screen.queryByRole("region", { name: "Saloon" })).toBeNull();
    expect(container.querySelector(".dayboard-free")?.textContent).toBe("Also free today: Saloon.");
  });

  it("lays the day on one ruler with a NOW plaque, and places each slab by its time", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    expect(container.querySelector(".dayboard-now-plaque")?.textContent).toMatch(/^NOW\d\d:\d\d$/u);
    expect(container.querySelectorAll(".dayboard-tick-label").length).toBeGreaterThan(3);
    const slab = container.querySelector<HTMLElement>(".dayboard-slab");
    expect(slab?.style.left).toMatch(/%$/u);
    expect(slab?.style.width).toMatch(/%$/u);
    // Every breathing slab declares the epoch phase it sampled when its breath began.
    expect(slab?.style.getPropertyValue("--lt-epoch-phase-ms")).toMatch(/^\d+$/u);
  });

  it("samples a breath's phase the moment the breath begins, on the venue's minute grid (D3 law 1)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
    try {
      // Organisers are due an hour before setup: this slot's breath begins in 30 s.
      const startsAtMs = Date.now() + 60 * 60_000 + 30_000;
      const boundaryMs = startsAtMs - 60 * 60_000;
      getCalendarMock.mockResolvedValue(calendarFixture([{
        ...liveBooking(), startsAt: new Date(startsAtMs).toISOString(), endsAt: new Date(startsAtMs + 2 * 3_600_000).toISOString(),
      } as CalendarResponse["entries"][number]]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      const slab = container.querySelector<HTMLElement>(".dayboard-slab");
      expect(slab?.getAttribute("data-motion")).toBe("none");
      // Exactly to the boundary: act flushes the tick's render as it ends,
      // which is the instant the real board renders too.
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(slab?.getAttribute("data-motion")).toBe("breath-4s");
      expect(slab?.style.getPropertyValue("--lt-epoch-phase-ms")).toBe(String(boundaryMs % 60_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts this hallkeeper's next action in one line at the top, and a tap on it opens the slot", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    const line = await screen.findByRole("button", { name: /^Grand Hall · LIVE · \d+ min elapsed$/u });
    // The visible line is not a live region (its minutes tick); a hidden one says the action once.
    expect(line.closest("[role='status']")).toBeNull();
    await waitFor(() => { expect(container.querySelector(".dayboard-announcer")?.textContent).toMatch(/^Grand Hall · LIVE/u); });
    expect(container.querySelector(".dayboard-announcer")?.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(line);
    expect(screen.getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeNull();
  });

  it("says a new next action once, and not again when its minutes tick", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
      const { container } = render(
        <MemoryRouter initialEntries={["/hallkeeper/today"]}>
          <SlotRequestsContext.Provider value={{ ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests: [request] }}>
            <DayBoardPage />
          </SlotRequestsContext.Provider>
        </MemoryRouter>,
      );
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      const announcer = container.querySelector(".dayboard-announcer");
      expect(announcer?.getAttribute("aria-live")).toBe("polite");
      expect(announcer?.textContent).toMatch(/^Take: .*waiting 3 min$/u);
      // Two minutes pass: the visible line moves on, the announcement does not.
      await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
      expect(screen.getByRole("button", { name: /^Take: .*waiting [45] min$/u })).toBeTruthy();
      expect(announcer?.textContent).toMatch(/waiting 3 min$/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops every breath the instant the socket drops after it was up, and breathes again on reconnect", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    const board = container.querySelector(".dayboard");
    expect(board?.getAttribute("data-frozen")).toBe("false");
    liveConnected.current = false;
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(board?.getAttribute("data-frozen")).toBe("true"); });
    // Frozen at once; the band waits its minute.
    expect(screen.queryByText(/^Offline since/u)).toBeNull();
    liveConnected.current = true;
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(board?.getAttribute("data-frozen")).toBe("false"); });
  });

  it("keeps today's requests on the rail from another day, and a tap on one comes back to today", async () => {
    serveToday(calendarFixture([liveBooking()]));
    const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today"]}>
        <SlotRequestsContext.Provider value={{ ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests: [request] }}>
          <DayBoardPage />
        </SlotRequestsContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("Chamber dinner");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await screen.findByText("Nothing scheduled on this day.");
    // Another day has no next action of its own; the rail still carries today's request.
    expect(screen.queryByRole("button", { name: /^Take: /u })).toBeNull();
    const rail = screen.getByRole("complementary", { name: "Unowned requests" });
    expect(within(rail).getByText("Today’s requests.")).toBeTruthy();
    fireEvent.click(within(rail).getByRole("button", { name: /× 10 · Grand Hall · waiting 3 min$/u }));
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
  });

  it("rings a slot whose request nobody owns, lists it on the UNOWNED rail, and makes taking it the next action", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today"]}>
        <SlotRequestsContext.Provider value={{ ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests: [request] }}>
          <DayBoardPage />
        </SlotRequestsContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("Chamber dinner");
    const slab = screen.getByRole("button", { name: /^Chamber dinner,/u });
    expect(slab.getAttribute("data-attention")).toBe("attention");
    expect(slab.querySelector(".dayboard-ring-words")?.textContent).toBe("1 request · nobody has this · waiting 3 min");
    const rail = screen.getByRole("complementary", { name: "Unowned requests" });
    expect(within(rail).getByRole("button", { name: /× 10 · Grand Hall · waiting 3 min$/u })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Take: .*× 10 · Grand Hall · waiting 3 min$/u }));
    expect(screen.getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
  });

  it("stops every breath and says so once the socket has been down for a minute", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
    try {
      liveConnected.current = false;
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("Chamber dinner")).toBeTruthy();
      // Down for a moment is not offline: the breaths go on, the words say reconnecting.
      expect(container.querySelector(".dayboard")?.getAttribute("data-frozen")).toBe("false");
      expect(container.querySelector(".dayboard-slab")?.getAttribute("data-motion")).toBe("live-breath");
      expect(screen.queryByText(/^Offline since/u)).toBeNull();
      // Two minute boundaries pass with the socket still down.
      await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
      expect(container.querySelector(".dayboard")?.getAttribute("data-frozen")).toBe("true");
      expect(screen.getByText(/^Offline since \d\d:\d\d · reconnecting/u)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wears the wall register on ?register=wall, without the app shell or the day controls", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today?register=wall"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    expect(screen.getByRole("main", { name: "The Day Board, wall display" })).toBeTruthy();
    expect(container.querySelector(".dayboard")?.getAttribute("data-register")).toBe("wall");
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();
    // Nothing opens on the wall (D11): a slab is a group, not a button, and a tap shows no detail.
    fireEvent.click(screen.getByRole("group", { name: /^Chamber dinner,/u }));
    expect(screen.queryByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Office view" }));
    expect(container.querySelector(".dayboard")?.getAttribute("data-register")).toBe("paper");
    expect(screen.getByRole("button", { name: "Previous day" })).toBeTruthy();
  });

  it("names a booking's occasion in words, and keeps one typed as it was typed (roadmap N6)", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([{ ...liveBooking(), eventType: "corporate" } as CalendarResponse["entries"][number]]));
    const first = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await openSlot("Chamber dinner");
    expect(first.container.querySelector(".dayboard-slot-meta")?.textContent).toContain(" · Corporate event");
    first.unmount();

    getCalendarMock.mockResolvedValue(calendarFixture([{ ...liveBooking(), eventType: "Burns supper" } as CalendarResponse["entries"][number]]));
    const typed = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await openSlot("Chamber dinner");
    expect(typed.container.querySelector(".dayboard-slot-meta")?.textContent).toContain(" · Burns supper");
  });

  it("keeps a free room's lane when the room is chosen", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    fireEvent.change(screen.getByRole("combobox", { name: "Room" }), { target: { value: SALOON } });
    expect(within(screen.getByRole("region", { name: "Saloon" })).getByText("Nothing scheduled.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    expect(container.querySelector(".dayboard-free")).toBeNull();
  });

  it("moves a day at a time with the arrows and their keys, and back with Today or t (roadmap N4)", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    const day = screen.getByLabelText<HTMLInputElement>("Day");
    const today = day.value;
    const plus = (days: number): string => new Date(Date.parse(`${today}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(day.value).toBe(plus(1));
    expect(screen.getByRole("button", { name: "Today", pressed: false })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(day.value).toBe(plus(2));
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(day.value).toBe(plus(-1));
    fireEvent.keyDown(document.body, { key: "t" });
    expect(day.value).toBe(today);
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeTruthy();

    // A field keeps its own keys, and so does anything outside the board.
    fireEvent.keyDown(day, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Room" }), { key: "t" });
    expect(day.value).toBe(today);
    await waitFor(() => { expect(getCalendarMock.mock.calls.length).toBeGreaterThan(1); });
  });

  // --- The days either side, read ahead -------------------------------------

  function tomorrowsLunch(title = "Awards lunch"): CalendarResponse["entries"][number] {
    const noon = Date.parse(dayRange(1).from) + 12 * 3_600_000;
    return {
      ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b3", spaceId: SALOON, title,
      startsAt: new Date(noon).toISOString(), endsAt: new Date(noon + 3 * 3_600_000).toISOString(),
    } as CalendarResponse["entries"][number];
  }

  /** A mouse comes over the day controls: someone may step. */
  function wishToStep(): void {
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Next day" }), { pointerType: "mouse" });
  }

  it("reads what a tap steps to, and cuts no read short", async () => {
    const today = dayRange(0);
    const pending = new Map<string, (value: CalendarResponse) => void>();
    const aborted: string[] = [];
    getCalendarMock.mockImplementation((_venueId, from, _to, signal) => {
      if (from === today.from) return Promise.resolve(calendarFixture([liveBooking()]));
      return new Promise<CalendarResponse>((resolve, reject) => {
        let open = true;
        pending.set(from, (value) => { open = false; resolve(value); });
        signal?.addEventListener("abort", () => {
          if (!open) return;
          open = false;
          aborted.push(from);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    renderBoard();
    await screen.findByText("Chamber dinner");
    // A finger on Next day: contact, a moment's hold, then the press.
    const next = screen.getByRole("button", { name: "Next day" });
    fireEvent.pointerEnter(next, { pointerType: "touch" });
    fireEvent.pointerDown(next, { pointerType: "touch" });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 60); }); });
    fireEvent.pointerUp(next, { pointerType: "touch" });
    fireEvent.click(next);
    await act(async () => { await Promise.resolve(); });
    expect(aborted).toEqual([]);
    expect(readsOf(dayRange(1))).toBe(1);
    expect(readsOf(dayRange(-1))).toBe(0);
    // The step was the sign: once tomorrow lands, the days beyond it are read.
    await act(async () => { pending.get(dayRange(1).from)?.(calendarFixture([])); await Promise.resolve(); });
    await waitFor(() => { expect(readsOf(dayRange(2))).toBe(1); });
    expect(aborted).toEqual([]);
  });

  /** Chrome's answer to :focus-visible: false for the focus a tap gives, true
   *  for keyboard focus. This test browser cannot tell the two apart. */
  function focusVisible(visible: boolean): () => void {
    const matches = Object.getOwnPropertyDescriptor(Element.prototype, "matches")?.value as (this: Element, selector: string) => boolean;
    const spy = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? visible : matches.call(this, selector);
    });
    return () => { spy.mockRestore(); };
  }

  it("takes the focus a tap gives for no wish to read ahead", async () => {
    const restore = focusVisible(false);
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      renderBoard();
      await screen.findByText("Chamber dinner");
      const next = screen.getByRole("button", { name: "Next day" });
      fireEvent.pointerEnter(next, { pointerType: "touch" });
      act(() => { next.focus(); });
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
      expect(readsOf(dayRange(1)) + readsOf(dayRange(-1))).toBe(0);
    } finally {
      restore();
    }
  });

  it("takes keyboard focus on the day controls as the wish to read ahead", async () => {
    const restore = focusVisible(true);
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      renderBoard();
      await screen.findByText("Chamber dinner");
      act(() => { screen.getByRole("button", { name: "Next day" }).focus(); });
      await waitFor(() => { expect(readsOf(dayRange(1))).toBe(1); });
      expect(readsOf(dayRange(-1))).toBe(1);
    } finally {
      restore();
    }
  });

  it("counts a key step as the sign to read ahead", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    await act(async () => { await Promise.resolve(); });
    expect(getCalendarMock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => { expect(readsOf(dayRange(1))).toBe(1); });
    await waitFor(() => { expect(readsOf(dayRange(2))).toBe(1); });
  });

  it("lets the wish to step lapse, so a board left alone reads one day per Diary change again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: Date.now() });
    const flush = async (): Promise<void> => {
      for (let round = 0; round < 5; round += 1) {
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 5); }); });
      }
    };
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      renderBoard();
      await flush();
      expect(screen.getByText("Chamber dinner")).toBeTruthy();
      wishToStep();
      await flush();
      expect(readsOf(dayRange(1))).toBe(1);

      // While the wish stands, a Diary change reads today and both days ahead.
      let before = getCalendarMock.mock.calls.length;
      act(() => { liveUpdate.current?.(); });
      await flush();
      expect(getCalendarMock.mock.calls.length - before).toBe(3);

      // Past the reuse window, only today.
      act(() => { vi.advanceTimersByTime(CALENDAR_REUSE_MS + 30_000); });
      await flush();
      before = getCalendarMock.mock.calls.length;
      act(() => { liveUpdate.current?.(); });
      await flush();
      expect(getCalendarMock.mock.calls.length - before).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads nothing ahead on a board nobody steps, so a Diary change costs one read", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    for (let change = 0; change < 3; change += 1) {
      act(() => { liveUpdate.current?.(); });
      await waitFor(() => { expect(readsOf(dayRange(0))).toBe(change + 2); });
      await act(async () => { await Promise.resolve(); });
    }
    expect(readsOf(dayRange(1)) + readsOf(dayRange(-1))).toBe(0);
    expect(getCalendarMock).toHaveBeenCalledTimes(4);

    // Focus on the day controls is intent enough.
    act(() => { screen.getByRole("button", { name: "Previous day" }).focus(); });
    await waitFor(() => { expect(readsOf(dayRange(-1))).toBe(1); });
    expect(readsOf(dayRange(1))).toBe(1);
  });

  it("reads the days either side once the day is on screen, on the venue's own midnights", async () => {
    // New York's midnights: a step worked out on London's would read days
    // that ← and → never show.
    const zone = "America/New_York";
    getVenueMock.mockResolvedValue({ id: VENUE, name: "Harbour Hall", timezone: zone });
    const today = deferred<CalendarResponse>();
    getCalendarMock.mockImplementation((_venueId, from) =>
      from === dayRange(0, zone).from ? today.promise : Promise.resolve(calendarFixture([])));
    renderBoard();
    await waitFor(() => { expect(readsOf(dayRange(0, zone))).toBe(1); });
    wishToStep();
    // Nothing is read ahead while the day itself is still being read.
    expect(readsOf(dayRange(1, zone)) + readsOf(dayRange(-1, zone))).toBe(0);

    await act(async () => { today.resolve(calendarFixture([liveBooking()])); await today.promise; });
    expect(screen.getByText("Chamber dinner")).toBeTruthy();
    await waitFor(() => {
      expect(readsOf(dayRange(1, zone))).toBe(1);
      expect(readsOf(dayRange(-1, zone))).toBe(1);
    });
    expect(getCalendarMock).toHaveBeenCalledWith(VENUE, dayRange(1, zone).from, dayRange(1, zone).to, expect.any(AbortSignal));
  });

  it("steps onto a day read ahead at once, reads it again, and shows what the new read says", async () => {
    const tomorrow = dayRange(1);
    const again = deferred<CalendarResponse>();
    getCalendarMock.mockImplementation((_venueId, from) => {
      if (from !== tomorrow.from) return Promise.resolve(calendarFixture([liveBooking()]));
      return readsOf(tomorrow) === 1 ? Promise.resolve(calendarFixture([tomorrowsLunch()])) : again.promise;
    });
    renderBoard();
    await screen.findByText("Chamber dinner");
    wishToStep();
    await waitFor(() => { expect(readsOf(tomorrow)).toBe(1); });
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    // Tomorrow as it was read a moment ago, said to be refreshing.
    expect(screen.getByText("Awards lunch")).toBeTruthy();
    expect(screen.queryByText("Chamber dinner")).toBeNull();
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
    expect(screen.getByText("Refreshing the day’s bookings…")).toBeTruthy();
    expect(screen.getByText(/^Live · updated \d\d:\d\d$/u)).toBeTruthy();
    expect(readsOf(tomorrow)).toBe(2);
    // The day beyond waits for tomorrow's own read: nothing is started to
    // be cut short.
    await act(async () => { await Promise.resolve(); });
    expect(readsOf(dayRange(2))).toBe(0);

    // The lunch became a dinner since: the board says what the new read says.
    await act(async () => { again.resolve(calendarFixture([tomorrowsLunch("Awards dinner")])); await again.promise; });
    expect(screen.getByText("Awards dinner")).toBeTruthy();
    expect(screen.queryByText("Awards lunch")).toBeNull();
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
    await waitFor(() => { expect(readsOf(dayRange(2))).toBe(1); });
  });

  it("keeps a day read ahead on screen when its read on arrival fails, and says from when", async () => {
    const tomorrow = dayRange(1);
    const again = deferred<CalendarResponse>();
    getCalendarMock.mockImplementation((_venueId, from) => {
      if (from !== tomorrow.from) return Promise.resolve(calendarFixture([liveBooking()]));
      return readsOf(tomorrow) === 1 ? Promise.resolve(calendarFixture([tomorrowsLunch()])) : again.promise;
    });
    renderBoard();
    await screen.findByText("Chamber dinner");
    wishToStep();
    await waitFor(() => { expect(readsOf(tomorrow)).toBe(1); });
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await act(async () => { again.reject(new Error("Offline")); await again.promise.catch(() => undefined); });
    expect(screen.getByText("Awards lunch")).toBeTruthy();
    expect(screen.getByText(/^Couldn't refresh at \d\d:\d\d\./u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Refreshing the day’s bookings…")).toBeNull();
  });

  it("reads a day whose read ahead failed on arrival, saying it is loading rather than showing another day", async () => {
    const tomorrow = dayRange(1);
    const arrival = deferred<CalendarResponse>();
    getCalendarMock.mockImplementation((_venueId, from) => {
      if (from !== tomorrow.from) return Promise.resolve(calendarFixture([liveBooking()]));
      return readsOf(tomorrow) === 1 ? Promise.reject(new Error("Offline")) : arrival.promise;
    });
    renderBoard();
    await screen.findByText("Chamber dinner");
    wishToStep();
    await waitFor(() => { expect(readsOf(tomorrow)).toBe(1); });
    await act(async () => { await Promise.resolve(); });
    // A read ahead that fails says nothing.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Loading the day’s bookings…")).toBeTruthy();
    expect(screen.queryByText("Chamber dinner")).toBeNull();
    expect(screen.queryByText(/Nothing scheduled/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    await act(async () => { arrival.resolve(calendarFixture([tomorrowsLunch()])); await arrival.promise; });
    expect(screen.getByText("Awards lunch")).toBeTruthy();
    expect(screen.queryByText("Loading the day’s bookings…")).toBeNull();
  });

  it("forgets the days read ahead when the Diary changes, so a step reads the day rather than show it from before", async () => {
    const today = dayRange(0);
    const tomorrow = dayRange(1);
    const todayAgain = deferred<CalendarResponse>();
    const arrival = deferred<CalendarResponse>();
    getCalendarMock.mockImplementation((_venueId, from) => {
      if (from === today.from) return readsOf(today) === 1 ? Promise.resolve(calendarFixture([liveBooking()])) : todayAgain.promise;
      if (from === tomorrow.from) return readsOf(tomorrow) === 1 ? Promise.resolve(calendarFixture([tomorrowsLunch()])) : arrival.promise;
      return Promise.resolve(calendarFixture([]));
    });
    renderBoard();
    await screen.findByText("Chamber dinner");
    wishToStep();
    await waitFor(() => { expect(readsOf(tomorrow)).toBe(1); });
    await act(async () => { await Promise.resolve(); });

    // A committed Diary change can touch any day: the board reads today again,
    // and tomorrow's earlier read is no longer one to show.
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(readsOf(today)).toBe(2); });
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Loading the day’s bookings…")).toBeTruthy();
    expect(screen.queryByText("Awards lunch")).toBeNull();

    await act(async () => { arrival.resolve(calendarFixture([tomorrowsLunch("Awards dinner")])); await arrival.promise; });
    expect(screen.getByText("Awards dinner")).toBeTruthy();
  });

  it("says how fresh the day is while live updates reconnect, with a Refresh that reads it now", async () => {
    liveConnected.current = false;
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    expect(screen.getByText(/^Updated \d\d:\d\d · reconnecting…$/u)).toBeTruthy();
    const calls = readsOf(dayRange(0));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => { expect(readsOf(dayRange(0))).toBe(calls + 1); });
  });

  it("says when it last read the day while connected, with no Refresh to press", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    expect(screen.getByText(/^Live · updated \d\d:\d\d$/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("moves a slot's verb on when its room's state does, with nothing to stamp (D3)", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText(/^LIVE · \d+ min elapsed$/u);
    expect(container.querySelector(".dayboard-slab")?.getAttribute("data-state")).toBe("live");
    // The dinner ends early: the same booking, now finished.
    getCalendarMock.mockResolvedValue(calendarFixture([{
      ...liveBooking(), endsAt: new Date(Date.now() - 60_000).toISOString(),
    } as CalendarResponse["entries"][number]]));
    act(() => { liveUpdate.current?.(); });
    await screen.findByText(/^Ended \d\d:\d\d$/u);
    const slab = container.querySelector(".dayboard-slab");
    expect(slab?.getAttribute("data-state")).toBe("done");
    expect(slab?.getAttribute("data-motion")).toBe("none");
    expect(container.querySelector(".is-stamped")).toBeNull();
  });

  it("names each kind of booking in the house's own words", async () => {
    // Screens say Provisional and Confirmed; the Diary's internal words
    // (pencil, ink, prospect) never reach a hallkeeper's board. A hold says
    // so on its slab; a confirmed booking says so once opened.
    const hold = {
      ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b2", spaceId: SALOON,
      kind: "hold", state: "hold", rank: 1, title: "Awards lunch",
    } as CalendarResponse["entries"][number];
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking(), hold]));
    renderBoard();
    expect(await screen.findByText("Awards lunch")).toBeTruthy();
    expect(screen.getByText(/Provisional · 1st option/u)).toBeTruthy();
    await openSlot("Chamber dinner");
    expect(screen.getByText(/Confirmed booking/u)).toBeTruthy();
    expect(screen.queryByText(/pencil|prospect|\bink\b/iu)).toBeNull();
  });

  it("teaches the colour system in the words the slots use (roadmap N4)", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    const legend = within(await screen.findByLabelText("What the colours mean"));
    for (const entry of DAY_BOARD_LEGEND) expect(legend.getByText(entry.label)).toBeTruthy();
    for (const entry of DAY_BOARD_RING_LEGEND) expect(legend.getByText(entry.label)).toBeTruthy();
    expect(legend.getAllByText(/./u)).toHaveLength(DAY_BOARD_LEGEND.length + DAY_BOARD_RING_LEGEND.length);
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
    await openSlot("Chamber dinner");

    const link = await screen.findByRole("link", { name: /Open setup sheet/u });
    expect(link.getAttribute("href")).toBe(`/hallkeeper/${CONFIG_ID}?eventId=${EVENT_ID}`);
    expect(resolveLayoutsMock).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT_ID, spaceSlug: "grand-hall" }));
  });

  it("says under the sheet's door when setup must be done and how far it has got", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    resolveLayoutsMock.mockResolvedValue({
      eventName: "Chamber dinner", roomName: "Grand Hall", unavailableCount: 0,
      layouts: [{ configurationId: CONFIG_ID, name: "Banquet 120", spaceName: "Grand Hall" }],
    });
    // 15:00 UTC is 16:00 in Glasgow in June.
    getSummaryMock.mockResolvedValue({
      configId: CONFIG_ID, readyBy: "2026-06-12T15:00:00.000Z", eventStart: "2026-06-12T17:30:00.000Z", total: 43, checked: 12,
    });
    renderBoard();
    await openSlot("Chamber dinner");

    expect(await screen.findByText("Ready by 16:00 · 12 of 43 checked")).toBeTruthy();
    expect(getSummaryMock).toHaveBeenCalledWith(CONFIG_ID, EVENT_ID, expect.any(AbortSignal));
  });

  it("marks a finished sheet as all checked, and shows no line it could not read", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    resolveLayoutsMock.mockResolvedValue({
      eventName: "Chamber dinner", roomName: "Grand Hall", unavailableCount: 0,
      layouts: [{ configurationId: CONFIG_ID, name: "Banquet 120", spaceName: "Grand Hall" }],
    });
    getSummaryMock.mockResolvedValue({
      configId: CONFIG_ID, readyBy: null, eventStart: "2026-06-12T17:30:00.000Z", total: 43, checked: 43,
    });
    renderBoard();
    await openSlot("Chamber dinner");
    const line = await screen.findByText("Ready by not set · All 43 checked");
    expect(line.closest(".dayboard-slot-progress")?.classList.contains("is-complete")).toBe(true);
    cleanup();

    getSummaryMock.mockRejectedValue(new Error("offline"));
    renderBoard();
    await openSlot("Chamber dinner");
    await screen.findByRole("link", { name: /Open setup sheet/u });
    await waitFor(() => { expect(getSummaryMock).toHaveBeenCalledTimes(2); });
    expect(screen.queryByText(/checked$/u)).toBeNull();
  });

  it("says why there is no sheet yet and what to do instead of rendering nothing", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    renderBoard();
    await openSlot("Chamber dinner");

    expect(await screen.findByText(/No setup sheet yet for Grand Hall/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the event and link the room's layout." }).getAttribute("href"))
      .toBe(`/ops/events/${EVENT_ID}`);
  });

  it("points an unlinked booking at the Diary rather than a dead sheet link", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await openSlot("Chamber dinner");

    expect(await screen.findByText(/this booking is not linked to an event/u)).toBeTruthy();
    expect(resolveLayoutsMock).not.toHaveBeenCalled();
  });

  // --- Lane 9's mount point ------------------------------------------------

  it("reserves a request region in the open slot and renders nothing there by default", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await openSlot("Chamber dinner");
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
    await openSlot("Chamber dinner");
    expect(await screen.findByText("2 requests")).toBeTruthy();
    expect(seen[0]).toBe("Grand Hall:00000000-0000-4000-8000-0000000000b1");
  });

  it("names the venue's clock in words for a device on another, never by its IANA name", async () => {
    // The suite runs on UTC; the venue keeps UK time.
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    expect(screen.getByText(/ · UK time$/u)).toBeTruthy();
    expect(screen.queryByText(/Europe\/London/u)).toBeNull();
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
