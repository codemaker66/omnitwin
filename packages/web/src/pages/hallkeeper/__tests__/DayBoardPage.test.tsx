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
import { SLOT_REQUESTS_UNAVAILABLE, SlotRequestsContext, type SlotRequestsApi } from "../../../components/requests/requests-context.js";
import { ApiError } from "../../../api/client.js";
import { ackEventDayOp, listPendingEventDayOps } from "../../../lib/event-day-offline-queue.js";

// ---------------------------------------------------------------------------
// Render contract for the Day Board page (goal 19 S3; the sentence first,
// T-753): the day's sentence as the headline, the next action with Take it,
// one line of counts that filter the rooms, a card per room whose slabs'
// VERB carries the meaning (the reduced-motion and colour-blind experience),
// All of today for every other slot, the panel of unclaimed requests, the
// stale band that stops every breath, the wall register, the legend, the
// quiet-house empty state, and the error/retry path — against a mocked
// calendar API. A tap on a slab opens the slot: its sheet, its event and its
// request region live there.
// ---------------------------------------------------------------------------

const { getCalendarMock, getVenueMock, liveUpdate, liveConnected, resolveLayoutsMock, getSummaryMock } = vi.hoisted(() => ({
  getCalendarMock: vi.fn<(venueId: string, from: string, to: string, signal?: AbortSignal) => Promise<CalendarResponse>>(),
  getVenueMock: vi.fn(), liveUpdate: { current: null as (() => void) | null },
  liveConnected: { current: true }, resolveLayoutsMock: vi.fn(), getSummaryMock: vi.fn(),
}));

vi.mock("../../../api/hallkeeper-summary.js", () => ({
  getSheetSummary: getSummaryMock,
}));

const settingsMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../api/operating-settings.js", () => ({
  getOperatingSettings: () => settingsMock.get() as Promise<unknown>,
  updateOperatingSettings: () => Promise.reject(new Error("not in this test")),
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
// The board reads what its rooms were seen doing and listens for new facts
// (goal 19 S5); this suite stubs both edges and feeds facts per case.
const seen = vi.hoisted(() => ({
  list: vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([])),
  record: vi.fn<(venueId: string, input: unknown) => Promise<unknown>>(),
}));
vi.mock("../../../api/observations.js", () => ({
  listVenueObservations: () => seen.list(),
  recordVenueObservation: (venueId: string, input: unknown) => seen.record(venueId, input),
}));
vi.mock("../../../lib/requests-live.js", () => ({
  subscribeRequestsLive: () => () => undefined,
  listensForFloorRequests: () => true,
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

/** Unfolds a room's All of today, where every slot but what the room is
 *  doing waits one tap away. */
function openAllOfToday(room: string): void {
  fireEvent.click(within(screen.getByRole("region", { name: room })).getByRole("button", { name: "All of today" }));
}

/** The requests lane as the provider gives it, ready, with `requests`. */
function requestsLane(requests: readonly VenueRequest[], overrides: Partial<SlotRequestsApi> = {}): SlotRequestsApi {
  return { ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests, ...overrides };
}

/** The board inside a requests lane. */
function renderWithRequests(lane: SlotRequestsApi, path = "/hallkeeper/today"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SlotRequestsContext.Provider value={lane}>
        <DayBoardPage />
      </SlotRequestsContext.Provider>
    </MemoryRouter>,
  );
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
  settingsMock.get.mockReset();
  settingsMock.get.mockResolvedValue(null);
  seen.list.mockReset();
  seen.list.mockResolvedValue([]);
  seen.record.mockReset();
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

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  // The offline queue is a module singleton: a tap one case could not send
  // must not stand on the next case's board.
  await Promise.all((await listPendingEventDayOps()).map((op) => ackEventDayOp(op.queueKey)));
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

  it("gives each room a card: its photograph, what it is doing now, the function, why it is at risk and what comes then", async () => {
    getVenueMock.mockResolvedValue({ id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow" });
    const house = [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }];
    const day = calendarFixture([
      { ...liveBooking(), guestCount: 120 } as CalendarResponse["entries"][number],
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 5, 7 * 60),
    ]);
    getCalendarMock.mockResolvedValue({
      ...day,
      turnaroundRules: house,
      conflicts: { ...day.conflicts, conflicts: [{
        id: "x", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
        entryIds: ["00000000-0000-4000-8000-0000000000c2", "00000000-0000-4000-8000-0000000000c3"],
        explanation: "5 minutes between events; this changeover needs 60.",
      }] },
    } as CalendarResponse);
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    const room = await screen.findByRole("region", { name: "Grand Hall" });
    // The room pictured empty, from the venue's own panoramas.
    await waitFor(() => { expect(room.querySelector("img")?.getAttribute("src")).toBe("/images/rooms/day-board/grand-hall-768.webp"); });
    expect(within(room).getByRole("heading", { name: "Grand Hall" })).toBeTruthy();
    // The now line: the state's dot and its words, before the function.
    const slab = within(room).getByRole("button", { name: /^Chamber dinner,/u });
    const now = slab.querySelector(".dayboard-verb");
    expect(now?.querySelector(".dayboard-dot")).not.toBeNull();
    expect(now?.textContent).toMatch(/^LIVE · \d+ min elapsed$/u);
    expect(slab.querySelector(".dayboard-slab-time")?.textContent).toMatch(/^\d\d:\d\d – \d\d:\d\d · 120 guests$/u);
    expect(now !== null && slab.querySelector(".dayboard-slab-title") !== null
      && (now.compareDocumentPosition(slab.querySelector(".dayboard-slab-title") as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    // The function line keeps its name: the title first, then everything it shows.
    expect(slab.getAttribute("aria-label")).toMatch(/^Chamber dinner, \d\d:\d\d – \d\d:\d\d · 120 guests, LIVE · \d+ min elapsed$/u);
    // Why the room is at risk, though what is at risk comes later, then what comes next.
    // (The folded line of the late bar says it too, on its own slot.)
    expect(room.querySelector(".dayboard-room-why")?.textContent).toBe("5 minutes between events; this changeover needs 60.");
    expect(room.querySelector(".dayboard-room-why")?.closest(".dayboard-slab")).toBeNull();
    expect(within(room).getByText(/^then \d\d:\d\d · Ceilidh$/u).className).toBe("dayboard-then");
    // No bar, no count of bookings, no request ring on a card.
    expect(room.querySelector(".dayboard-bar, .dayboard-ring, .dayboard-room-count")).toBeNull();
    expect(within(room).queryByText(/bookings?$/u)).toBeNull();
    // Every breathing slab declares the epoch phase it sampled when its breath began.
    expect(container.querySelector<HTMLElement>(".dayboard-slab")?.style.getPropertyValue("--lt-epoch-phase-ms")).toMatch(/^\d+$/u);
  });

  it("keeps every slot of a room one tap away under All of today, and opens each from there", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      bookingAt("00000000-0000-4000-8000-0000000000c1", GRAND_HALL, "Breakfast", -6 * 60, -5 * 60),
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 30, 7 * 60),
    ]));
    renderBoard();
    const room = await screen.findByRole("region", { name: "Grand Hall" });
    // Folded: only what the room is doing is a button.
    const fold = within(room).getByRole("button", { name: "All of today" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(within(room).getAllByRole("button").filter((button) => button.classList.contains("dayboard-slab")).map((button) => button.getAttribute("data-booking")))
      .toEqual(["00000000-0000-4000-8000-0000000000b1"]);
    openAllOfToday("Grand Hall");
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const listed = within(room).getAllByRole("listitem").map((item) => item.querySelector(".dayboard-slab-title")?.textContent);
    expect(listed).toEqual(["Breakfast", "Ceilidh", "Late bar"]);
    // Every slot of the day is reachable: the lead on the card, the rest here.
    for (const title of ["Breakfast", "Ceilidh", "Late bar"]) {
      fireEvent.click(within(room).getByRole("button", { name: new RegExp(`^${title},`, "u") }));
      expect(screen.getByRole("region", { name: `Grand Hall: ${title}` })).toBeTruthy();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
    fireEvent.click(fold);
    expect(within(room).queryByRole("button", { name: /^Ceilidh,/u })).toBeNull();
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

  it("shows what the room was seen doing on the slab, and records the next fact from the slot (goal 19 S5)", async () => {
    const seenAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const booking = liveBooking();
    seen.list.mockResolvedValue([{
      id: "00000000-0000-4000-8000-00000000f001",
      venueId: VENUE,
      bookingId: booking.id,
      spaceId: GRAND_HALL,
      kind: "doors-open",
      observedAt: seenAt,
      recordedAt: seenAt,
      actorUserId: null,
      actorName: "Elaine",
      actorRole: "hallkeeper",
      idempotencyKey: "00000000-0000-4000-8000-00000000f002",
    }]);
    seen.record.mockImplementation((venueId, input) => {
      const tap = input as { bookingId: string; kind: string; observedAt: string; idempotencyKey: string };
      return Promise.resolve({
        id: "00000000-0000-4000-8000-00000000f003",
        venueId,
        bookingId: tap.bookingId,
        spaceId: GRAND_HALL,
        kind: tap.kind,
        observedAt: tap.observedAt,
        recordedAt: tap.observedAt,
        actorUserId: null,
        actorName: "Elaine",
        actorRole: "hallkeeper",
        idempotencyKey: tap.idempotencyKey,
      });
    });
    getCalendarMock.mockResolvedValue(calendarFixture([booking]));
    renderBoard();
    await openSlot("Chamber dinner");

    // The slab's marginal line and the slot's latest fact, in the same words;
    // the slab's name carries the fact for a reader who cannot see the margin.
    expect((await screen.findByText(/^Doors open \d{2}:\d{2}$/u)).className).toBe("dayboard-slab-seen");
    expect(screen.getByRole("button", { name: /^Chamber dinner, .*, Doors open \d{2}:\d{2}$/u })).toBeTruthy();
    expect(screen.getByText(/^Doors open \d{2}:\d{2} · Elaine$/u).className).toBe("dayboard-seen-latest");
    const group = screen.getByRole("group", { name: "Record what the room is doing" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Live", "Done"]);

    fireEvent.click(within(group).getByRole("button", { name: "Live" }));
    await waitFor(() => { expect(seen.record).toHaveBeenCalledTimes(1); });
    const [venueId, input] = seen.record.mock.calls[0] as [string, { bookingId: string; kind: string; idempotencyKey: string }];
    expect(venueId).toBe(VENUE);
    expect(input.bookingId).toBe(booking.id);
    expect(input.kind).toBe("live");
    expect((await screen.findByText("Live · recorded")).className).toBe("dayboard-seen-status");
    // The next facts follow the new latest fact.
    await waitFor(() => {
      const next = within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button");
      expect(next.map((button) => button.textContent)).toEqual(["Flipping", "Done"]);
    });
  });

  it("tells the hallkeeper while the room's facts are still being read, and when they could not be (goal 19 S5)", async () => {
    const read: { fail: ((err: unknown) => void) | null } = { fail: null };
    seen.list.mockImplementation(() => new Promise((_resolve, reject) => { read.fail = reject; }));
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await openSlot("Chamber dinner");
    expect((await screen.findByText("Reading what the room was seen doing…")).closest(".dayboard-seen-latest")).not.toBeNull();
    // The read and the tap are independent: the first facts stay on offer.
    expect(within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Room set", "Doors open", "Live"]);
    act(() => { read.fail?.(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR")); });
    expect((await screen.findByText("What the room was seen doing could not be read.")).className).toBe("dayboard-seen-latest");
    expect(screen.queryByText("Nothing recorded for this room yet.")).toBeNull();
  });

  it("says so when the server refuses a tap, and offers the same facts again (goal 19 S5)", async () => {
    seen.record.mockRejectedValue(new ApiError(400, "An observation cannot be ahead of the clock.", "OBSERVED_IN_FUTURE"));
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await openSlot("Chamber dinner");
    expect((await screen.findByText("Nothing recorded for this room yet.")).className).toBe("dayboard-seen-latest");
    const group = screen.getByRole("group", { name: "Record what the room is doing" });
    fireEvent.click(within(group).getByRole("button", { name: "Live" }));
    expect((await screen.findByText("Couldn’t record live: An observation cannot be ahead of the clock.")).className).toBe("dayboard-seen-status");
    expect(within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Room set", "Doors open", "Live"]);
    expect(screen.queryByText(/waiting to send/u)).toBeNull();
  });

  it("keeps a tap the connection could not carry as this room's own, counted for this room (goal 19 S5)", async () => {
    seen.record.mockRejectedValue(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await openSlot("Chamber dinner");
    const group = await screen.findByRole("group", { name: "Record what the room is doing" });
    fireEvent.click(within(group).getByRole("button", { name: "Doors open" }));
    expect((await screen.findByText("Doors open · queued, sends when the connection is back")).className).toBe("dayboard-seen-status");
    expect((await screen.findByText(/^Doors open \d{2}:\d{2} · .+ · waiting to send$/u)).className).toBe("dayboard-seen-latest");
    expect(screen.getByText("One tap for this room waiting to send.").className).toBe("dayboard-seen-pending");
    // The slab carries the fact too, and the next facts follow it.
    expect(screen.getByText(/^Doors open \d{2}:\d{2}$/u).className).toBe("dayboard-slab-seen");
    expect(within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Live", "Done"]);
  });

  it("keeps the margin fact on a slab the clock has ended, where the verb does not say it (goal 19 S5)", async () => {
    const booking = {
      ...liveBooking(),
      startsAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    };
    const seenAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    seen.list.mockResolvedValue([{
      id: "00000000-0000-4000-8000-00000000f021",
      venueId: VENUE,
      bookingId: booking.id,
      spaceId: GRAND_HALL,
      kind: "set",
      observedAt: seenAt,
      recordedAt: seenAt,
      actorUserId: null,
      actorName: "Elaine",
      actorRole: "hallkeeper",
      idempotencyKey: "00000000-0000-4000-8000-00000000f022",
    }]);
    getCalendarMock.mockResolvedValue(calendarFixture([booking]));
    renderBoard();
    expect((await screen.findByText(/^Room set \d{2}:\d{2}$/u)).className).toBe("dayboard-slab-seen");
  });

  it("prints a finished room's fact once: the verb says it and the margin stays quiet (goal 19 S5)", async () => {
    const booking = liveBooking();
    const doneAt = new Date(Date.now() - 5 * 60_000).toISOString();
    seen.list.mockResolvedValue([{
      id: "00000000-0000-4000-8000-00000000f011",
      venueId: VENUE,
      bookingId: booking.id,
      spaceId: GRAND_HALL,
      kind: "done",
      observedAt: doneAt,
      recordedAt: doneAt,
      actorUserId: null,
      actorName: "Elaine",
      actorRole: "hallkeeper",
      idempotencyKey: "00000000-0000-4000-8000-00000000f012",
    }]);
    getCalendarMock.mockResolvedValue(calendarFixture([booking]));
    renderBoard();
    // Marked done, the room has nothing under way: its dinner is under All of today.
    expect((await screen.findByText("Done for the day.")).className).toBe("dayboard-now-free");
    openAllOfToday("Grand Hall");
    await openSlot("Chamber dinner");
    expect((await screen.findByText(/^Done \d{2}:\d{2} · Elaine$/u)).className).toBe("dayboard-seen-latest");
    // On the room the verb says it once; no margin line repeats it.
    const room = screen.getByRole("region", { name: "Grand Hall" });
    expect(within(room).getAllByText(/^Done \d{2}:\d{2}$/u).map((element) => element.className)).toEqual(["dayboard-verb-words"]);
    expect(room.querySelector(".dayboard-slab-seen")).toBeNull();
    // Nothing left to record but the clear-down.
    expect(within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Cleaned"]);
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
      expect(announcer?.textContent).toMatch(/^Take now: .*waiting 3 min$/u);
      // Two minutes pass: the visible line moves on, the announcement does not.
      await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
      expect(container.querySelector(".dayboard-next-line")?.textContent).toMatch(/waiting [45] min$/u);
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
    // Another day has no next action of its own; the panel still carries today's request.
    expect(screen.queryByRole("button", { name: "Take it" })).toBeNull();
    const rail = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(rail).getByText("Today’s requests.")).toBeTruthy();
    fireEvent.click(within(rail).getByRole("button", { name: /× 10 · Grand Hall · waiting 3 min$/u }));
    expect(screen.getByRole("button", { name: "Today", pressed: true })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
  });

  it("makes taking a request nobody has the next action, and Take it claims it through the slot's requests lane", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    const move = vi.fn<SlotRequestsApi["move"]>();
    const { container } = renderWithRequests(requestsLane([request], { move }));
    await screen.findByText("Chamber dinner");
    // The slot knows a request waits on it; the card wears no ring for it.
    const slab = screen.getByRole("button", { name: /^Chamber dinner,/u });
    expect(slab.getAttribute("data-attention")).toBe("attention");
    expect(slab.querySelector(".dayboard-ring")).toBeNull();
    const next = container.querySelector(".dayboard-next");
    expect(next?.querySelector(".dayboard-next-label")?.textContent).toBe("Take now");
    expect(next?.querySelector(".dayboard-next-line")?.textContent).toBe("Chairs × 10 · Grand Hall · waiting 3 min");
    // The line's one action is Take it; it is not repeated on the panel.
    const rail = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(rail).queryByRole("button", { name: /Chairs × 10/u })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take it" }));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(request, { to: "accepted" });
  });

  it("says Take it is working while the lane moves the request, and why when it could not, with Take it again", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const request = venueRequest({ urgency: "now", createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    const working = renderWithRequests(requestsLane([request], { busyId: request.id }));
    await screen.findByText("Chamber dinner");
    const next = working.container.querySelector<HTMLElement>(".dayboard-next");
    // Urgent, in capitals of its own, before the words.
    expect(next?.querySelector(".dayboard-next-label")?.textContent).toBe("URGENT");
    expect(next?.getAttribute("data-urgent")).toBe("true");
    const status = within(next as HTMLElement).getByRole("status");
    expect(status.textContent).toBe("Taking it…");
    expect(status.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Take it" })).toBeNull();
    working.unmount();

    const failed = renderWithRequests(requestsLane([request], {
      failure: { on: "request", requestId: request.id, message: "Graham took this first." },
    }));
    await screen.findByText("Chamber dinner");
    const alert = within(failed.container.querySelector<HTMLElement>(".dayboard-next") as HTMLElement).getByRole("alert");
    expect(alert.textContent).toBe("Graham took this first.");
    expect(alert.querySelector("[data-activity-indicator]")).toBeNull();
    expect(screen.getByRole("button", { name: "Take it" })).toBeTruthy();
  });

  it("offers no Take it to someone who may not take the request, and the line opens its slot instead", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    // Handed to Fiona: in flight, so nobody's yet, and only hers to take.
    const request = venueRequest({
      state: "handed-over", ownerUserId: "00000000-0000-4000-8000-0000000000aa", ownerName: "Graham",
      handoverToUserId: "00000000-0000-4000-8000-0000000000bb", handoverToName: "Fiona",
      createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    });
    const move = vi.fn<SlotRequestsApi["move"]>();
    renderWithRequests(requestsLane([request], { move }));
    await screen.findByText("Chamber dinner");
    expect(screen.queryByRole("button", { name: "Take it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chairs × 10 · Grand Hall · waiting 3 min" }));
    expect(screen.getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
    expect(move).not.toHaveBeenCalled();
  });

  it("lists the requests nobody has urgent first, then the longest wait, never repeating the one to take now", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
    const id = (n: number): string => `00000000-0000-4000-8000-0000000000e${String(n)}`;
    const lane = requestsLane([
      venueRequest({ id: id(1), kind: "tables", quantity: 2, createdAt: ago(5) }),
      venueRequest({ id: id(2), kind: "chairs", quantity: 6, urgency: "now", createdAt: ago(2) }),
      venueRequest({ id: id(3), kind: "cleaning", quantity: null, urgency: "now", createdAt: ago(4) }),
      venueRequest({ id: id(4), kind: "av", quantity: null, createdAt: ago(9) }),
    ]);
    const { container } = renderWithRequests(lane);
    await screen.findByText("Chamber dinner");
    // The oldest urgent one is the next action.
    expect(container.querySelector(".dayboard-next-line")?.textContent).toBe("Cleaning · Grand Hall · waiting 4 min");
    const rail = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(rail).getByRole("heading", { name: "Unclaimed requests" })).toBeTruthy();
    expect(within(rail).getByText("4 waiting")).toBeTruthy();
    const items = (): string[] => within(rail).getAllByRole("listitem").map((item) => item.textContent ?? "");
    // Urgent first while one remains, then the longest wait; never the one above.
    expect(items()).toEqual([
      "Urgent Chairs × 6 · Grand Hall · waiting 2 min",
      "Sound and screens · Grand Hall · waiting 9 min",
      "Tables × 2 · Grand Hall · waiting 5 min",
    ]);
    expect(within(rail).getByText("urgent first, then the longest wait")).toBeTruthy();
    cleanup();

    // With no urgent one left in the list, it says so in fewer words.
    renderWithRequests(requestsLane([
      venueRequest({ id: id(1), kind: "tables", quantity: 2, createdAt: ago(5) }),
      venueRequest({ id: id(4), kind: "av", quantity: null, createdAt: ago(9) }),
      venueRequest({ id: id(2), kind: "chairs", quantity: 6, urgency: "now", createdAt: ago(2) }),
    ]));
    await screen.findByText("Chamber dinner");
    const calm = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(calm).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Sound and screens · Grand Hall · waiting 9 min", "Tables × 2 · Grand Hall · waiting 5 min",
    ]);
    expect(within(calm).getByText("longest wait first")).toBeTruthy();
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
    const footer = await screen.findByLabelText("What the colours mean");
    const legend = within(footer);
    for (const entry of DAY_BOARD_LEGEND) expect(legend.getByText(entry.label)).toBeTruthy();
    for (const entry of DAY_BOARD_RING_LEGEND) expect(legend.getByText(entry.label)).toBeTruthy();
    expect(legend.getAllByText(/./u)).toHaveLength(DAY_BOARD_LEGEND.length + DAY_BOARD_RING_LEGEND.length);
    // At the foot, folded until asked for.
    const fold = screen.getByRole("button", { name: "What the colours mean" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(footer.hidden).toBe(true);
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(footer.hidden).toBe(false);
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

  it("says a house block has no sheet and points at the Diary rather than a dead sheet link", async () => {
    // Since the bind (migration 0090) every provisional and confirmed booking
    // has its event; on the board only the venue's own blocks have none.
    getCalendarMock.mockResolvedValue(calendarFixture([{
      ...liveBooking(), kind: "internal_block", state: "internal_block", title: "Floor maintenance",
    } as CalendarResponse["entries"][number]]));
    renderBoard();
    await openSlot("Floor maintenance");

    expect(await screen.findByText("A house block has no setup sheet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the block in the Diary." }).getAttribute("href")).toBe("/diary");
    expect(screen.queryByText(/link it to an event/u)).toBeNull();
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
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    expect(container.querySelector(".dayboard-overline")?.textContent).toMatch(/ · UK time$/u);
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

  it("between midnight and the boundary hour the board shows the venue's day to its end, and the new calendar day can still be opened (goal 19 S8)", async () => {
    // 00:30 London on Wed 21 Jan 2026; the venue's day ends at 04:00.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-01-21T00:30:00.000Z") });
    settingsMock.get.mockResolvedValue({ dayBoundaryHour: 4 });
    const lateBar = { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b2", title: "Late bar", startsAt: "2026-01-21T00:15:00.000Z", endsAt: "2026-01-21T02:00:00.000Z" };
    getCalendarMock.mockImplementation((_venueId, from, to) =>
      Promise.resolve(calendarFixture([lateBar].filter((entry) => entry.endsAt > from && entry.startsAt < to))));
    try {
      renderBoard();
      const settle = async (): Promise<void> => { for (let round = 0; round < 8; round += 1) await act(async () => { await Promise.resolve(); }); };
      await settle();
      // Yesterday's board, read to this morning's boundary, with the bar on it.
      expect(screen.getByText(/^Tuesday 20 January/u)).toBeTruthy();
      expect(getCalendarMock.mock.calls.some(([, from, to]) => from === "2026-01-20T00:00:00.000Z" && to === "2026-01-21T04:00:00.000Z")).toBe(true);
      expect(screen.getByText("Late bar")).toBeTruthy();
      // The calendar day that has just begun is one step ahead, not the day on screen.
      fireEvent.click(screen.getByRole("button", { name: "Next day" }));
      await settle();
      expect(screen.getByText(/^Wednesday 21 January/u)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // When the display dies, the day prints (goal 19 S8).
  it("the paper register offers Print today, which prints the board", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Print today" }));
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByText(/Printed from the Day Board; the screen is the record\./u)).toBeTruthy();
  });

  it("the wall register offers no print", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today?register=wall"]}>
        <DayBoardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Chamber dinner");
    expect(screen.queryByRole("button", { name: "Print today" })).toBeNull();
    // The wall's landmark keeps its name and the shell draws nothing round it.
    expect(screen.getByRole("main", { name: "The Day Board, wall display" })).toBeTruthy();
    expect(document.querySelector("header.dashboard-layout-header")).toBeNull();
    expect(screen.queryByRole("link", { name: "Diary" })).toBeNull();
  });

  // --- The rooms, in the desks' register (concept C) ---------------------

  /** A booking in a room at offsets from now, in minutes. */
  function bookingAt(id: string, room: string, title: string, fromMin: number, toMin: number, overrides: Partial<CalendarResponse["entries"][number]> = {}): CalendarResponse["entries"][number] {
    return {
      ...liveBooking(), id, spaceId: room, title,
      startsAt: new Date(Date.now() + fromMin * 60_000).toISOString(), endsAt: new Date(Date.now() + toMin * 60_000).toISOString(),
      ...overrides,
    } as CalendarResponse["entries"][number];
  }

  it("reads a room's day in words: what it is doing now, then what comes next, and the rest under All of today", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      bookingAt("00000000-0000-4000-8000-0000000000c1", GRAND_HALL, "Breakfast", -6 * 60, -5 * 60),
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 30, 7 * 60),
    ]));
    renderBoard();
    const room = await screen.findByRole("region", { name: "Grand Hall" });
    expect(within(room).getByRole("button", { name: /^Chamber dinner,/u }).className).toContain("is-lead");
    expect(within(room).getByText(/^then \d\d:\d\d · Ceilidh$/u)).toBeTruthy();
    // No earlier, next or later lines: the day's other slots are folded away.
    expect(within(room).queryByText(/^(Earlier|Next|Later)$/u)).toBeNull();
    openAllOfToday("Grand Hall");
    for (const title of ["Breakfast", "Ceilidh", "Late bar"]) {
      expect(within(room).getByRole("button", { name: new RegExp(`^${title},`, "u") }).className).toContain("is-line");
    }
  });

  it("heads the day with its date and the venue's time, then its sentence, the title kept for assistive technology", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-11-14T14:20:00.000Z") });
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      const request = venueRequest({ createdAt: new Date(Date.now() - 7 * 60_000).toISOString() });
      const { container } = renderWithRequests(requestsLane([request]));
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("Chamber dinner")).toBeTruthy();
      // "SATURDAY 14 NOVEMBER · 14:20" on screen, its capitals the stylesheet's.
      const overline = container.querySelector(".dayboard-overline");
      expect(overline?.querySelector(".dayboard-subtitle")?.textContent).toBe("Saturday 14 November");
      expect(overline?.querySelector(".dayboard-overline-time")?.textContent).toBe("14:20");
      // No greeting; the title is for assistive technology, the sentence for the eye.
      expect(screen.queryByText(/^Good (morning|afternoon|evening)/u)).toBeNull();
      const title = screen.getByRole("heading", { level: 1, name: "The Day Board" });
      expect(title.className).toContain("dayboard-sr");
      const sentence = container.querySelector(".dayboard-summary");
      expect(sentence?.textContent).toBe("One request has no one on it, waiting 7 min. One function is live.");
      expect(sentence?.querySelector("strong[data-tone='copper']")?.textContent).toBe("One request");
      // The day controls and how fresh the day is sit on the overline's line.
      const row = overline?.parentElement;
      expect(row?.querySelector(".dayboard-days")).not.toBeNull();
      expect(row?.querySelector(".dayboard-status")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the day in one quiet line, and a count shows only the rooms it names", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c4", SALOON, "Awards lunch", 4 * 60, 6 * 60),
    ]));
    const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    const { container } = renderWithRequests(requestsLane([request]));
    await screen.findByText("Chamber dinner");
    const counts = screen.getByRole("group", { name: "The day in numbers" });
    // What is there to count, in words; no bookings total, no requests (the panel counts them).
    expect(within(counts).getAllByRole("button").map((count) => count.textContent)).toEqual(["1 live", "1 still to come"]);
    expect(counts.textContent).not.toMatch(/Bookings|Requests|waiting/u);
    expect(container.querySelector(".dayboard-plane")).toBeNull();
    expect(screen.getByText("Two rooms in use")).toBeTruthy();

    fireEvent.click(within(counts).getByRole("button", { name: "1 live" }));
    expect(within(counts).getByRole("button", { name: "1 live", pressed: true })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Saloon" })).toBeNull();
    expect(screen.getByText("Live now in Grand Hall")).toBeTruthy();
    // The same count again lets the filter go.
    fireEvent.click(within(counts).getByRole("button", { name: "1 live", pressed: true }));
    expect(screen.getByRole("region", { name: "Saloon" })).toBeTruthy();

    // A room from the list and a count are two ways to narrow: one lets the other go.
    fireEvent.click(within(counts).getByRole("button", { name: "1 still to come" }));
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Room" }), { target: { value: GRAND_HALL } });
    expect(within(counts).getByRole("button", { name: "1 still to come", pressed: false })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    fireEvent.click(within(counts).getByRole("button", { name: "1 live" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Room" }).value).toBe("");
  });

  it("shows every room in use on the wall, whatever the office was narrowed to", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c4", SALOON, "Awards lunch", 4 * 60, 6 * 60),
    ]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    // Only the lunch is still to come, so the office shows only its room.
    fireEvent.click(within(screen.getByRole("group", { name: "The day in numbers" })).getByRole("button", { name: "1 still to come" }));
    expect(screen.getByText("Still to come in Saloon")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    // The wall says nothing of a filter and offers no way out of one: it
    // shows every room in use.
    fireEvent.click(screen.getByRole("button", { name: "Wall display" }));
    expect(screen.getByRole("main", { name: "The Day Board, wall display" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Saloon" })).toBeTruthy();
    // A room chosen from the list does not narrow the wall either. (This
    // router keeps the board mounted across the switch; the app's staff
    // shell remounts it, and the wall must not depend on that.)
    fireEvent.click(screen.getByRole("button", { name: "Office view" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Room" }), { target: { value: SALOON } });
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Wall display" }));
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Saloon" })).toBeTruthy();
  });

  it("shows today on the wall, with nothing opened, whatever day or slot the office had", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    const subtitle = (): string | null | undefined => document.querySelector(".dayboard-subtitle")?.textContent;
    const today = subtitle();
    await openSlot("Chamber dinner");
    expect(document.querySelector(".dayboard-slab.is-selected")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => { expect(subtitle()).not.toBe(today); });
    // The wall has no day controls to come back with, and opens nothing.
    fireEvent.click(screen.getByRole("button", { name: "Wall display" }));
    expect(screen.getByRole("main", { name: "The Day Board, wall display" })).toBeTruthy();
    expect(subtitle()).toBe(today);
    expect(await screen.findByRole("group", { name: /^Chamber dinner,/u })).toBeTruthy();
    expect(document.querySelector(".dayboard-slab.is-selected")).toBeNull();
  });

  it("counts every request nobody has today on the panel's heading, wherever it belongs", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    // A request on a booking that is not on today's board: on the panel, in no room.
    const elsewhere = venueRequest({ bookingId: "00000000-0000-4000-8000-0000000000ee", createdAt: new Date(Date.now() - 4 * 60_000).toISOString() });
    const other = venueRequest({ id: "00000000-0000-4000-8000-0000000000d2", bookingId: "00000000-0000-4000-8000-0000000000ef", createdAt: new Date(Date.now() - 2 * 60_000).toISOString() });
    renderWithRequests(requestsLane([elsewhere, other]));
    await screen.findByText("Chamber dinner");
    const rail = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(rail).getByText("2 waiting")).toBeTruthy();
    // The oldest is the next action; the other is listed, and the counts say nothing of either.
    expect(within(rail).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "The day in numbers" })).queryByText(/waiting|request/iu)).toBeNull();
  });

  it("says a later function's short turn-round on its line, and why it is at risk, in the words a screen reader hears", async () => {
    const house = [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }];
    const entries = [
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 5, 7 * 60),
    ];
    getCalendarMock.mockResolvedValue({ ...calendarFixture(entries), turnaroundRules: house });
    renderBoard();
    await screen.findByRole("region", { name: "Grand Hall" });
    openAllOfToday("Grand Hall");
    const lateBar = await screen.findByRole("button", { name: /^Late bar,/u });
    expect(lateBar.className).toContain("is-line");
    expect(within(lateBar).getByText("Turn-round 5 min · needs 1 h")).toBeTruthy();
    expect(lateBar.getAttribute("aria-label")).toContain(", Turn-round 5 min · needs 1 h");
    cleanup();

    // The Diary holds the pair blocking: the line says why, in its words.
    const atRisk = calendarFixture(entries);
    getCalendarMock.mockResolvedValue({
      ...atRisk,
      turnaroundRules: house,
      conflicts: { ...atRisk.conflicts, conflicts: [{
        id: "x", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
        entryIds: ["00000000-0000-4000-8000-0000000000c2", "00000000-0000-4000-8000-0000000000c3"],
        explanation: "5 minutes between events; this changeover needs 60.",
      }] },
    } as CalendarResponse);
    renderBoard();
    await screen.findByRole("region", { name: "Grand Hall" });
    openAllOfToday("Grand Hall");
    const risky = await screen.findByRole("button", { name: /^Late bar,/u });
    expect(risky.className).toContain("is-line");
    expect(within(risky).getByText("5 minutes between events; this changeover needs 60.")).toBeTruthy();
    expect(risky.getAttribute("aria-label")).toContain(", 5 minutes between events; this changeover needs 60.");
  });

  it("keeps the Diary's turnaround advice off a slot named in passing: a line says its short turn-round, never another pair's warning or one already over", async () => {
    const house = [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }];
    const id = (n: number): string => `00000000-0000-4000-8000-0000000000f${String(n)}`;
    const warning = (first: number, second: number, words: string): CalendarResponse["conflicts"]["conflicts"][number] => ({
      id: `w${String(first)}`, type: "insufficient_turnaround", severity: "warning", spaceId: GRAND_HALL,
      entryIds: [id(first), id(second)], explanation: words,
    } as CalendarResponse["conflicts"]["conflicts"][number]);
    const day = calendarFixture([
      bookingAt(id(1), GRAND_HALL, "Breakfast", -6 * 60, -5 * 60),
      bookingAt(id(2), GRAND_HALL, "Brunch", -4 * 60 - 50, -4 * 60),
      liveBooking(),
      bookingAt(id(3), GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt(id(4), GRAND_HALL, "Late bar", 5 * 60 + 5, 7 * 60),
      bookingAt(id(5), GRAND_HALL, "Last orders", 7 * 60 + 10, 8 * 60),
    ]);
    // As production sends them: every short turn-round only advised, on both
    // bookings of its pair.
    getCalendarMock.mockResolvedValue({
      ...day,
      turnaroundRules: house,
      conflicts: { ...day.conflicts, conflicts: [
        warning(1, 2, "Only 10 minutes between \"Breakfast\" and \"Brunch\"."),
        warning(3, 4, "Only 5 minutes between \"Ceilidh\" and \"Late bar\"."),
        warning(4, 5, "Only 10 minutes between \"Late bar\" and \"Last orders\"."),
      ] },
    } as CalendarResponse);
    renderBoard();
    await screen.findByRole("region", { name: "Grand Hall" });
    openAllOfToday("Grand Hall");
    const brunch = await screen.findByRole("button", { name: /^Brunch,/u });
    expect(brunch.className).toContain("is-line");
    // Over and done: nothing about its turn-round, on screen or spoken.
    expect(brunch.textContent).not.toMatch(/minutes between|Turn-round/u);
    expect(brunch.getAttribute("aria-label")).not.toMatch(/minutes between/u);
    // Later: each says its own turn-round, and no pair's advice.
    const lateBar = screen.getByRole("button", { name: /^Late bar,/u });
    expect(within(lateBar).getByText("Turn-round 5 min · needs 1 h")).toBeTruthy();
    expect(lateBar.textContent).not.toMatch(/minutes between/u);
    const lastOrders = screen.getByRole("button", { name: /^Last orders,/u });
    expect(within(lastOrders).getByText("Turn-round 10 min · needs 1 h")).toBeTruthy();
    expect(lastOrders.textContent).not.toMatch(/minutes between/u);
    expect(lastOrders.getAttribute("aria-label")).not.toMatch(/minutes between/u);
  });

  it("names what comes next past everything under way beside the lead, and keeps those under All of today", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      bookingAt("00000000-0000-4000-8000-0000000000e1", GRAND_HALL, "Exhibition", -50 * 60, 52 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000e2", GRAND_HALL, "Morning talk", -30, 60),
      bookingAt("00000000-0000-4000-8000-0000000000e3", GRAND_HALL, "Panel", -20, 40),
      bookingAt("00000000-0000-4000-8000-0000000000e4", GRAND_HALL, "Dinner", 3 * 60, 5 * 60),
    ]));
    renderBoard();
    const room = await screen.findByRole("region", { name: "Grand Hall" });
    // A talk inside the running exhibition is never "then": the dinner is.
    expect(within(room).getByText(/^then \d\d:\d\d · Dinner$/u)).toBeTruthy();
    openAllOfToday("Grand Hall");
    expect([...room.querySelectorAll(".dayboard-today-list .dayboard-slab-title")].map((title) => title.textContent))
      .toEqual(["Morning talk", "Panel", "Dinner"]);

    // The wall: the room, what it is doing and what comes then; nothing folds or opens.
    fireEvent.click(screen.getByRole("button", { name: "Wall display" }));
    const wallRoom = screen.getByRole("region", { name: "Grand Hall" });
    expect(within(wallRoom).getByRole("group", { name: /^Exhibition,/u })).toBeTruthy();
    expect(within(wallRoom).getByText(/^then \d\d:\d\d · Dinner$/u)).toBeTruthy();
    expect(within(wallRoom).queryByRole("button")).toBeNull();
    expect(wallRoom.querySelector(".dayboard-today-toggle, .dayboard-today-list")).toBeNull();
  });

  it("counts a long booking's days on the venue's day, as the heading does (goal 19 S8)", async () => {
    // 01:00 on Sunday 15 November; the venue's day ends at 04:00, so the
    // board still shows Saturday, the exhibition's third day of five.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-11-15T01:00:00.000Z") });
    settingsMock.get.mockResolvedValue({ dayBoundaryHour: 4 });
    const exhibition = { ...liveBooking(), title: "Exhibition", startsAt: "2026-11-12T10:00:00.000Z", endsAt: "2026-11-16T17:00:00.000Z" };
    getCalendarMock.mockResolvedValue(calendarFixture([exhibition]));
    try {
      renderBoard();
      for (let round = 0; round < 8; round += 1) await act(async () => { await Promise.resolve(); });
      expect(screen.getByText(/^Saturday 14 November/u)).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Exhibition,/u }).textContent).toContain("LIVE · day 3 of 5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says on the wall, in one band, the counts and the next action in words, with no request on a card", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
    ]));
    const request = venueRequest({ bookingId: "00000000-0000-4000-8000-0000000000c2", urgency: "now", createdAt: new Date(Date.now() - 7 * 60_000).toISOString() });
    const { container } = renderWithRequests(requestsLane([request]), "/hallkeeper/today?register=wall");
    await screen.findByText("Chamber dinner");
    const band = container.querySelector(".dayboard-wall-band");
    // Nothing opens on the wall: the counts are words, and so is the next action.
    expect([...(band?.querySelectorAll(".dayboard-count") ?? [])].map((count) => count.textContent)).toEqual(["1 live", "1 still to come"]);
    expect(band?.querySelector(".dayboard-next-label")?.textContent).toBe("URGENT");
    expect(band?.querySelector(".dayboard-next-line")?.textContent).toBe("Chairs × 10 · Grand Hall · waiting 7 min");
    expect(within(band as HTMLElement).queryByRole("button")).toBeNull();
    // The card says the room, what it is doing and then what; no request is counted there.
    const room = screen.getByRole("region", { name: "Grand Hall" });
    expect(within(room).getByText(/^then \d\d:\d\d · Ceilidh$/u)).toBeTruthy();
    expect(room.textContent).not.toMatch(/waiting|request/iu);
    // The day's sentence over the clock's line, the title for assistive technology.
    expect(container.querySelector(".dayboard-wall-head .dayboard-summary")?.textContent).toMatch(/^One request has no one on it/u);
    expect(screen.getByRole("heading", { level: 1, name: "The Day Board" }).className).toContain("dayboard-sr");
  });

  it("keeps the next action at the top of a phone, where the stylesheet holds it while the rooms scroll", async () => {
    const phone = vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(max-width: 760px)" || query === "(max-width: 767px)", media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      await screen.findByText("Chamber dinner");
      const next = container.querySelector(".dayboard-next");
      // day-board-css.test.ts holds this selector sticky at the top.
      expect(next?.matches(".dayboard[data-layout=\"phone\"] .dayboard-next")).toBe(true);
      // It comes before the rooms it stays above.
      const rooms = container.querySelector(".dayboard-rooms");
      expect(next !== null && rooms !== null && (next.compareDocumentPosition(rooms) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    } finally {
      phone.mockRestore();
    }
  });

  it("lists the first few requests on a narrower screen, and the rest on a press", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const requests = [1, 2, 3, 4, 5, 6].map((minutes) => venueRequest({
      id: `00000000-0000-4000-8000-0000000000e${String(minutes)}`, createdAt: new Date(Date.now() - minutes * 60_000).toISOString(),
    }));
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today"]}>
        <SlotRequestsContext.Provider value={{ ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests }}>
          <DayBoardPage />
        </SlotRequestsContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("Chamber dinner");
    const rail = screen.getByRole("complementary", { name: "Unclaimed requests" });
    expect(within(rail).getByText("6 waiting")).toBeTruthy();
    // The oldest is the one to take now; the other five wait on the panel, four at first.
    expect(within(rail).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(within(rail).getByRole("button", { name: "Show all 5" }));
    expect(within(rail).getAllByRole("listitem")).toHaveLength(5);
  });

  it("puts the requests in the forest panel beside the rooms on a wide desk, and an opened slot in their place", async () => {
    const wide = vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(min-width: 1180px)", media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
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
      await screen.findByText("Chamber dinner");
      expect(container.querySelector(".dayboard")?.getAttribute("data-layout")).toBe("desk");
      const panel = container.querySelector(".dayboard-panel");
      expect(panel?.getAttribute("data-register")).toBe("forest");
      expect(within(panel as HTMLElement).getByRole("complementary", { name: "Unclaimed requests" })).toBeTruthy();

      await openSlot("Chamber dinner");
      expect(within(panel as HTMLElement).getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
      expect(screen.queryByRole("complementary", { name: "Unclaimed requests" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close, back to the requests" }));
      expect(within(panel as HTMLElement).getByRole("complementary", { name: "Unclaimed requests" })).toBeTruthy();
    } finally {
      wide.mockRestore();
    }
  });

  it("unfolds an opened slot under its own room on a narrower screen", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c4", SALOON, "Awards lunch", 4 * 60, 6 * 60),
    ]));
    renderBoard();
    await openSlot("Awards lunch");
    const detail = screen.getByRole("region", { name: "Saloon: Awards lunch" });
    expect(detail.closest(".dayboard-room-item")?.querySelector(".dayboard-room")?.getAttribute("aria-label")).toBe("Saloon");
    fireEvent.click(within(detail).getByRole("button", { name: "Close, back to the rooms" }));
    expect(screen.queryByRole("region", { name: "Saloon: Awards lunch" })).toBeNull();
  });

  it("keeps an opened slot's room on the board when a count would hide it, so a Done says it was recorded", async () => {
    const booking = liveBooking();
    const liveAt = new Date(Date.now() - 20 * 60_000).toISOString();
    seen.list.mockResolvedValue([{
      id: "00000000-0000-4000-8000-00000000f030", venueId: VENUE, bookingId: booking.id, spaceId: GRAND_HALL, kind: "live",
      observedAt: liveAt, recordedAt: liveAt, actorUserId: null, actorName: "Elaine", actorRole: "hallkeeper", idempotencyKey: "00000000-0000-4000-8000-00000000f032",
    }]);
    seen.record.mockImplementation((venueId, input) => {
      const tap = input as { bookingId: string; kind: string; observedAt: string; idempotencyKey: string };
      return Promise.resolve({
        id: "00000000-0000-4000-8000-00000000f031", venueId, bookingId: tap.bookingId, spaceId: GRAND_HALL, kind: tap.kind,
        observedAt: tap.observedAt, recordedAt: tap.observedAt, actorUserId: null, actorName: "Elaine", actorRole: "hallkeeper", idempotencyKey: tap.idempotencyKey,
      });
    });
    getCalendarMock.mockResolvedValue(calendarFixture([booking, bookingAt("00000000-0000-4000-8000-0000000000c4", SALOON, "Awards lunch", 4 * 60, 6 * 60)]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    const counts = screen.getByRole("group", { name: "The day in numbers" });
    fireEvent.click(within(counts).getByRole("button", { name: "1 live" }));
    await openSlot("Chamber dinner");
    const group = screen.getByRole("group", { name: "Record what the room is doing" });
    fireEvent.click(within(group).getByRole("button", { name: "Done" }));
    // The dinner is done and no longer live, yet its room and slot stay.
    expect(await screen.findByText("Done · recorded")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
    expect(screen.getByText("Nothing is live")).toBeTruthy();
    // The count it was narrowed by stays, at nothing, to be let go.
    expect(within(counts).getByRole("button", { name: "0 live", pressed: true })).toBeTruthy();

    // The next action opens a room the count hides, and the slot shows.
    fireEvent.click(screen.getByRole("button", { name: "Close, back to the rooms" }));
    fireEvent.click(within(counts).getByRole("button", { name: "1 still to come" }));
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Saloon · Awards lunch/u }));
    expect(screen.getByRole("region", { name: "Saloon: Awards lunch" })).toBeTruthy();
  });

  it("links each room the sentence names to its card on a phone, and puts Take it across the next action", async () => {
    const phone = vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(max-width: 760px)" || query === "(max-width: 767px)", media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
    try {
      const atRisk = calendarFixture([
        liveBooking(),
        bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
        bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 5, 7 * 60),
      ]);
      getCalendarMock.mockResolvedValue({
        ...atRisk,
        conflicts: { ...atRisk.conflicts, conflicts: [{
          id: "x", type: "insufficient_turnaround", severity: "blocking", spaceId: GRAND_HALL,
          entryIds: ["00000000-0000-4000-8000-0000000000c2", "00000000-0000-4000-8000-0000000000c3"],
          explanation: "5 minutes between events; this changeover needs 60.",
        }] },
      } as CalendarResponse);
      const request = venueRequest({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
      const { container } = renderWithRequests(requestsLane([request]));
      await screen.findByText("Chamber dinner");
      const link = within(container.querySelector(".dayboard-summary") as HTMLElement).getByRole("link", { name: "Grand Hall" });
      const card = container.querySelector(`#${link.getAttribute("href")?.slice(1) ?? "none"}`);
      expect(card?.querySelector(".dayboard-room")?.getAttribute("aria-label")).toBe("Grand Hall");
      const scrolled = vi.fn();
      Object.defineProperty(card as HTMLElement, "scrollIntoView", { value: scrolled, configurable: true });
      fireEvent.click(link);
      expect(scrolled).toHaveBeenCalledTimes(1);
      // The keyboard and a screen reader land on the card, not only the eye.
      expect(document.activeElement).toBe(card?.querySelector(".dayboard-room"));
      // The one to take now, with Take it across the card.
      expect(within(container.querySelector(".dayboard-next") as HTMLElement).getByRole("button", { name: "Take it" }).className).toContain("dayboard-take");
    } finally {
      phone.mockRestore();
    }
  });

  it("keeps the keyboard on a slot that moves from All of today to what the room is doing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([
        bookingAt("00000000-0000-4000-8000-0000000000c5", GRAND_HALL, "Lunch", -60, 1),
        bookingAt("00000000-0000-4000-8000-0000000000c6", GRAND_HALL, "Supper", 5 * 60, 7 * 60),
      ]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      openAllOfToday("Grand Hall");
      const supper = screen.getByRole("button", { name: /^Supper,/u });
      expect(supper.className).toContain("is-line");
      act(() => { supper.focus(); });
      // The lunch ends: the supper becomes what the room will do first.
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      const moved = container.querySelector(".dayboard-slab[data-booking='00000000-0000-4000-8000-0000000000c6']");
      expect(moved?.className).toContain("is-lead");
      expect(document.activeElement).toBe(moved);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the paper register's landmark is still named for the staff shell's header", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    expect(screen.getByRole("main", { name: "The Day Board" })).toBeTruthy();
  });
});
