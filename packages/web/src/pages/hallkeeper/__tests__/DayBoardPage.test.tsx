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
import { ApiError } from "../../../api/client.js";
import { ackEventDayOp, listPendingEventDayOps } from "../../../lib/event-day-offline-queue.js";

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
  acknowledgeEventPlanChange: (eventId: string, input: { changeId: string }) => floor.acknowledge(eventId, input),
}));
// What changed since the floor last looked: the board's one read, and the
// acknowledgement, fed per case.
const floor = vi.hoisted(() => ({
  awaiting: vi.fn<(eventIds: readonly string[]) => Promise<unknown[]>>(() => Promise.resolve([])),
  acknowledge: vi.fn<(eventId: string, input: { changeId: string }) => Promise<unknown>>(() => Promise.resolve({})),
}));
vi.mock("../../../api/plan-changes.js", () => ({
  getAwaitingAcknowledgement: (eventIds: readonly string[]) => floor.awaiting(eventIds),
}));
// What moves at a changeover, fed per case.
const changeoverMock = vi.hoisted(() => vi.fn<(input: { from: string; to: string }) => Promise<unknown>>());
vi.mock("../../../api/changeover.js", () => ({
  getChangeover: (input: { from: string; to: string }) => changeoverMock(input),
}));
// Who is on setup for each turn-round, from the published rota: a week with
// no setup planned unless a case feeds one.
const rotaMock = vi.hoisted(() => vi.fn<(venueId: string, start: string | null) => Promise<unknown>>());
vi.mock("../../../api/rota.js", () => ({
  getRotaWeek: (venueId: string, start: string | null) => rotaMock(venueId, start),
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

const JAMIE = "00000000-0000-4000-8000-0000000000f1";

/** A published rota week: Jamie on the venue's team, and these shifts. */
function rotaWeek(start: string, shifts: readonly Record<string, unknown>[]): unknown {
  return {
    venueId: VENUE, timeZone: "Europe/London", weekStart: start, from: new Date().toISOString(), to: new Date().toISOString(), access: "read",
    people: [{ id: JAMIE, displayName: "Jamie", employmentType: "casual", skills: ["setup"], isActive: true, hasAccount: true }],
    records: [], unavailability: [], rooms: [], accounts: [],
    shifts: shifts.map((shift, index) => ({
      id: `00000000-0000-4000-8000-00000000050${String(index)}`, venueId: VENUE, staffMemberId: JAMIE, role: "setup",
      breakMinutes: 0, eventId: null, eventName: null, spaceId: GRAND_HALL, spaceName: "Grand Hall", note: null, status: "published",
      revision: 1, publishedAt: null, cancelledAt: null, cancellationNoticeHours: null, updatedAt: new Date().toISOString(),
      updatedByName: null, issues: [], ...shift,
    })),
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
  settingsMock.get.mockReset();
  settingsMock.get.mockResolvedValue(null);
  seen.list.mockReset();
  seen.list.mockResolvedValue([]);
  seen.record.mockReset();
  floor.awaiting.mockReset();
  floor.awaiting.mockResolvedValue([]);
  floor.acknowledge.mockReset();
  floor.acknowledge.mockResolvedValue({});
  changeoverMock.mockReset();
  rotaMock.mockReset();
  rotaMock.mockImplementation((_venueId, start) => Promise.resolve(rotaWeek(start ?? "", [])));
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

  it("lays the day on one ruler with a NOW plaque, and places each slot on its room's bar by its time", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
    await screen.findByText("Chamber dinner");
    expect(container.querySelector(".dayboard-now-plaque")?.textContent).toMatch(/^NOW\d\d:\d\d$/u);
    expect(container.querySelectorAll(".dayboard-tick-label").length).toBeGreaterThan(3);
    // The bar is a picture of the words above it, so it is not read aloud.
    const bar = within(screen.getByRole("region", { name: "Grand Hall" })).getByText((_, element) => element?.classList.contains("dayboard-bar") === true);
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    const segment = bar.querySelector<HTMLElement>(".dayboard-seg");
    expect(segment?.style.left).toMatch(/%$/u);
    expect(segment?.style.width).toMatch(/%$/u);
    expect(bar.querySelector<HTMLElement>(".dayboard-bar-now")?.style.left).toMatch(/%$/u);
    // Every breathing slab declares the epoch phase it sampled when its breath began.
    const slab = container.querySelector<HTMLElement>(".dayboard-slab");
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

  it("reads a room's day in words: what finished earlier, what it is doing, what is next and what comes after", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      bookingAt("00000000-0000-4000-8000-0000000000c1", GRAND_HALL, "Breakfast", -6 * 60, -5 * 60),
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c2", GRAND_HALL, "Ceilidh", 3 * 60, 5 * 60),
      bookingAt("00000000-0000-4000-8000-0000000000c3", GRAND_HALL, "Late bar", 5 * 60 + 30, 7 * 60),
    ]));
    renderBoard();
    const room = await screen.findByRole("region", { name: "Grand Hall" });
    expect(within(room).getByText("4 bookings")).toBeTruthy();
    const kinds = (title: string): string => within(room).getByRole("button", { name: new RegExp(`^${title},`, "u") }).className;
    expect(kinds("Breakfast")).toContain("is-line");
    expect(kinds("Chamber dinner")).toContain("is-lead");
    expect(kinds("Ceilidh")).toContain("is-next");
    expect(kinds("Late bar")).toContain("is-line");
    expect(within(room).getAllByText(/^(Earlier|Next|Later)$/u).map((label) => label.textContent)).toEqual(["Earlier", "Next", "Later"]);
    // Each slot is on the room's bar too, drawn and not read aloud.
    expect(room.querySelectorAll(".dayboard-bar .dayboard-seg")).toHaveLength(4);
  });

  it("greets the hallkeeper by name over the day, and says what matters in one sentence", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
    const request = venueRequest({ createdAt: new Date(Date.now() - 7 * 60_000).toISOString() });
    render(
      <MemoryRouter initialEntries={["/hallkeeper/today"]}>
        <SlotRequestsContext.Provider value={{ ...SLOT_REQUESTS_UNAVAILABLE, status: "ready", requests: [request] }}>
          <DayBoardPage />
        </SlotRequestsContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("Chamber dinner");
    expect(screen.getByText(/^Good (morning|afternoon|evening), Elaine$/u)).toBeTruthy();
    const sentence = document.querySelector(".dayboard-summary");
    expect(sentence?.textContent).toBe("One request has no one on it, waiting 7 min. One function is live.");
    expect(sentence?.querySelector("strong[data-tone='copper']")?.textContent).toBe("One request");
  });

  it("counts the day on the copper plane, and a count shows only the rooms it names", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([
      liveBooking(),
      bookingAt("00000000-0000-4000-8000-0000000000c4", SALOON, "Awards lunch", 4 * 60, 6 * 60),
    ]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    const plane = screen.getByRole("group", { name: "The day in numbers" });
    // Said as the desks say their stages.
    expect(within(plane).getAllByRole("button").map((stage) => stage.getAttribute("aria-label"))).toEqual([
      "At risk, 0", "Requests waiting, 0", "Live, 1", "Setting up, 0", "Still to come, 1", "Bookings, 2",
    ]);
    expect(within(plane).getByRole("button", { name: "Bookings, 2", pressed: true })).toBeTruthy();
    expect(screen.getByText("Two rooms in use")).toBeTruthy();

    fireEvent.click(within(plane).getByRole("button", { name: "Live, 1" }));
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Saloon" })).toBeNull();
    expect(screen.getByText("Live now in Grand Hall")).toBeTruthy();
    // The same count again lets the filter go.
    fireEvent.click(within(plane).getByRole("button", { name: "Live, 1", pressed: true }));
    expect(screen.getByRole("region", { name: "Saloon" })).toBeTruthy();

    // A room from the list and a count are two ways to narrow: one lets the other go.
    fireEvent.click(within(plane).getByRole("button", { name: "Still to come, 1" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Room" }), { target: { value: GRAND_HALL } });
    expect(within(plane).getByRole("button", { name: "Still to come, 1", pressed: false })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall" })).toBeTruthy();
    fireEvent.click(within(plane).getByRole("button", { name: "Bookings, 2" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Room" }).value).toBe("");
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
    const rail = screen.getByRole("complementary", { name: "Unowned requests" });
    expect(within(rail).getByRole("heading", { name: "6 waiting" })).toBeTruthy();
    expect(within(rail).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(within(rail).getByRole("button", { name: "Show all 6" }));
    expect(within(rail).getAllByRole("listitem")).toHaveLength(6);
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
      expect(within(panel as HTMLElement).getByRole("complementary", { name: "Unowned requests" })).toBeTruthy();

      await openSlot("Chamber dinner");
      expect(within(panel as HTMLElement).getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
      expect(screen.queryByRole("complementary", { name: "Unowned requests" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close, back to the requests" }));
      expect(within(panel as HTMLElement).getByRole("complementary", { name: "Unowned requests" })).toBeTruthy();
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
    const plane = screen.getByRole("group", { name: "The day in numbers" });
    fireEvent.click(within(plane).getByRole("button", { name: "Live, 1" }));
    await openSlot("Chamber dinner");
    const group = screen.getByRole("group", { name: "Record what the room is doing" });
    fireEvent.click(within(group).getByRole("button", { name: "Done" }));
    // The dinner is done and no longer live, yet its room and slot stay.
    expect(await screen.findByText("Done · recorded")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Grand Hall: Chamber dinner" })).toBeTruthy();
    expect(screen.getByText("Nothing is live")).toBeTruthy();

    // The next action opens a room the count hides, and the slot shows.
    fireEvent.click(screen.getByRole("button", { name: "Close, back to the rooms" }));
    fireEvent.click(within(plane).getByRole("button", { name: "Still to come, 1" }));
    expect(screen.queryByRole("region", { name: "Grand Hall" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Saloon · Awards lunch/u }));
    expect(screen.getByRole("region", { name: "Saloon: Awards lunch" })).toBeTruthy();
  });

  it("leans the NOW plaque inward at the evening's end, so it never runs past the sheet", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-01-21T22:45:00.000Z") });
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([liveBooking()]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      expect(container.querySelector(".dayboard-now")?.getAttribute("data-edge")).toBe("end");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the keyboard on a slot that moves from Next to what the room is doing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
    try {
      getCalendarMock.mockResolvedValue(calendarFixture([
        bookingAt("00000000-0000-4000-8000-0000000000c5", GRAND_HALL, "Lunch", -60, 1),
        bookingAt("00000000-0000-4000-8000-0000000000c6", GRAND_HALL, "Supper", 5 * 60, 7 * 60),
      ]));
      const { container } = render(<MemoryRouter initialEntries={["/hallkeeper/today"]}><DayBoardPage /></MemoryRouter>);
      for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); });
      const supper = screen.getByRole("button", { name: /^Supper,/u });
      expect(supper.className).toContain("is-next");
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

const CHANGE_ID = "00000000-0000-4000-8000-0000000000d1";

function timesMoved(minutesAgo: number, id = CHANGE_ID, sourceId = EVENT_ID): Record<string, unknown> {
  return {
    id, eventId: EVENT_ID, venueId: VENUE, configurationId: null, proposalId: null, handoffPackId: null,
    actorUserId: null, actorRole: "staff", actorLabel: "Diary desk", sourceKind: "event", sourceId,
    title: "Times moved",
    summary: "Grand Hall: Sat 14 Nov, 18:00 – 23:00 to Sat 14 Nov, 19:00 – Sun 15 Nov, 00:00.",
    beforeSummary: "Grand Hall, Sat 14 Nov, 18:00 – 23:00",
    afterSummary: "Grand Hall, Sat 14 Nov, 19:00 – Sun 15 Nov, 00:00",
    affectedSurfaces: ["timings"], audienceRoles: ["staff", "hallkeeper"], riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

type Waiting = { readonly eventId: string; readonly changes: readonly Record<string, unknown>[]; readonly lastAcknowledgement: unknown };

/** The API as the board meets it: it remembers what the floor acknowledged. */
function serve(entries: readonly Waiting[]): void {
  const acknowledged = new Set<string>();
  floor.awaiting.mockImplementation(() => Promise.resolve(entries.map((entry) => ({
    ...entry,
    changes: entry.changes.filter((change) => !acknowledged.has(String(change["id"]))),
    lastAcknowledgement: entry.changes.some((change) => acknowledged.has(String(change["id"])))
      ? { at: new Date().toISOString(), by: "Elaine", byUserId: "00000000-0000-4000-8000-0000000000ff" }
      : entry.lastAcknowledgement,
  }))));
  floor.acknowledge.mockImplementation((_eventId, input) => {
    acknowledged.add(input.changeId);
    return Promise.resolve({});
  });
}

/** Each read of the calendar is a fresh answer, as it is over the network. */
function calendarOf(entries: () => CalendarResponse["entries"]): void {
  const first = calendarFixture(entries());
  getCalendarMock.mockImplementation(() => Promise.resolve({ ...first, entries: entries() }));
}

describe("DayBoardPage: what changed since the floor last looked", () => {
  it("marks the slot whose event has a change to read, and says so in the day's sentence", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    renderBoard();
    const slab = await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u });
    expect(within(slab).getByText("Changed")).toBeTruthy();
    expect(floor.awaiting).toHaveBeenCalledWith([EVENT_ID]);
    await waitFor(() => { expect(screen.getByText(/has a change to read\./u).closest("p")?.textContent).toContain("Grand Hall has a change to read."); });
  });

  it("opens the change with Got it as the panel's one cream button, and puts it in hand for the floor", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    serve([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u }));
    const section = await screen.findByRole("region", { name: "What changed" });
    expect(within(section).getByText("Times moved")).toBeTruthy();
    expect(within(section).getByText("Grand Hall, Sat 14 Nov, 18:00 – 23:00")).toBeTruthy();
    expect(within(section).getByText("Grand Hall, Sat 14 Nov, 19:00 – Sun 15 Nov, 00:00")).toBeTruthy();
    const gotIt = within(section).getByRole("button", { name: "Got it" });
    expect(gotIt.className).toContain("is-primary");
    // The facts to record wait their turn: one cream button on the panel.
    const facts = within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button");
    expect(facts.some((button) => button.className.includes("is-primary"))).toBe(false);

    act(() => { gotIt.focus(); });
    fireEvent.click(gotIt);
    await waitFor(() => { expect(floor.acknowledge).toHaveBeenCalledWith(EVENT_ID, { changeId: CHANGE_ID }); });
    const seenBy = await screen.findByText(/^Changes seen by you, \d{2}:\d{2}\.$/u);
    expect(screen.queryByRole("region", { name: "What changed" })).toBeNull();
    expect(document.activeElement).toBe(seenBy);
    // In hand: the mark leaves the slot, and the facts take the cream button back.
    expect(screen.queryByText("Changed")).toBeNull();
    const after = within(screen.getByRole("group", { name: "Record what the room is doing" })).getAllByRole("button");
    expect(after[0]?.className).toContain("is-primary");
  });

  it("acknowledges several changes oldest first with one button", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    const older = timesMoved(50, "00000000-0000-4000-8000-0000000000d2");
    serve([{ eventId: EVENT_ID, changes: [timesMoved(5), older], lastAcknowledgement: null }]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*2 changes to read/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Got all 2" }));
    await waitFor(() => { expect(floor.acknowledge).toHaveBeenCalledTimes(2); });
    expect(floor.acknowledge.mock.calls.map(([, input]) => input.changeId)).toEqual(["00000000-0000-4000-8000-0000000000d2", CHANGE_ID]);
  });

  it("keeps the change waiting when the acknowledgement does not go through, and says so", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    floor.acknowledge.mockRejectedValue(new Error("the connection dropped"));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u }));
    const gotIt = await screen.findByRole("button", { name: "Got it" });
    act(() => { gotIt.focus(); });
    fireEvent.click(gotIt);
    expect(await screen.findByText("Couldn’t send that: the connection dropped. Try again.")).toBeTruthy();
    // Never disabled, so the keyboard's place stays on it through a failed send.
    expect(screen.getByRole("button", { name: "Got it" }).hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByText("Changed")).toBeTruthy();
  });

  it("says when what changed could not be read, on the board and in the panel", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockRejectedValue(new Error("502"));
    renderBoard();
    expect(await screen.findByText(/^Couldn’t read what changed since \d{2}:\d{2}\. The board tries again each minute; the marks are as last read\.$/u)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,/u }));
    expect(await screen.findByText("What changed could not be read just now.")).toBeTruthy();
    // Try again reads now.
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "What changed" })).toBeTruthy();
    expect(screen.queryByText(/^Couldn’t read what changed/u)).toBeNull();
  });

  it("reads what changed again when the day moves, not a minute later", async () => {
    calendarOf(() => [bookingWithEvent()]);
    renderBoard();
    await screen.findByText("Chamber dinner");
    await waitFor(() => { expect(floor.awaiting).toHaveBeenCalled(); });
    const before = floor.awaiting.mock.calls.length;
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(1)], lastAcknowledgement: null }]);
    act(() => { liveUpdate.current?.(); });
    expect(await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u })).toBeTruthy();
    expect(floor.awaiting.mock.calls.length).toBeGreaterThan(before);
  });

  it("tells the day a function moved off it, until the floor has it", async () => {
    let moved = false;
    calendarOf(() => (moved ? [] : [bookingWithEvent()]));
    renderBoard();
    await screen.findByText("Chamber dinner");
    // The dinner is moved to tomorrow: it leaves today's rooms, and its move waits.
    moved = true;
    serve([{ eventId: EVENT_ID, changes: [{ ...timesMoved(1), summary: "Grand Hall: 1 day later.",
      beforeSummary: "Grand Hall, Sat 14 Nov, 18:00 – 23:00", afterSummary: "Grand Hall, Sun 15 Nov, 18:00 – 23:00" }], lastAcknowledgement: null }]);
    act(() => { liveUpdate.current?.(); });
    const notice = await screen.findByText((_, element) => element?.tagName === "P"
      && element.textContent === "Chamber dinner · Times moved: now Grand Hall, Sun 15 Nov, 18:00 – 23:00");
    expect(floor.awaiting).toHaveBeenLastCalledWith([EVENT_ID]);
    const box = notice.closest(".dayboard-moved-off");
    if (!(box instanceof HTMLElement)) throw new Error("expected the moved-off notice");
    fireEvent.click(within(box).getByRole("button", { name: "Got it" }));
    await waitFor(() => { expect(floor.acknowledge).toHaveBeenCalledWith(EVENT_ID, { changeId: CHANGE_ID }); });
    await waitFor(() => { expect(document.querySelector(".dayboard-moved-off")).toBeNull(); });
  });

  it("reads again after Got it, and clears a failure once the waiting changes are different", async () => {
    calendarOf(() => [bookingWithEvent()]);
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    floor.acknowledge.mockRejectedValueOnce(new Error("the connection dropped"));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));
    expect(await screen.findByText("Couldn’t send that: the connection dropped. Try again.")).toBeTruthy();
    // A colleague has it on another device, and a new change arrives: the old failure says nothing about it.
    serve([{ eventId: EVENT_ID, changes: [timesMoved(1, "00000000-0000-4000-8000-0000000000d9")], lastAcknowledgement: null }]);
    act(() => { liveUpdate.current?.(); });
    await waitFor(() => { expect(screen.queryByText(/^Couldn’t send that/u)).toBeNull(); });
    const calls = floor.awaiting.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => { expect(floor.awaiting.mock.calls.length).toBeGreaterThan(calls); });
  });

  it("shows a manager the change to read with no button, as the API takes it only from the floor", async () => {
    const user = useAuthStore.getState().user;
    if (user === null) throw new Error("Expected test user");
    useAuthStore.getState().setUser({ ...user, role: "manager" });
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [timesMoved(20)], lastAcknowledgement: null }]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*a change to read/u }));
    const section = await screen.findByRole("region", { name: "What changed" });
    expect(within(section).queryByRole("button")).toBeNull();
  });

  it("says a move once: the Was and Now lines, not the sentence too", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [
      timesMoved(20),
      { ...timesMoved(10, "00000000-0000-4000-8000-0000000000d3"), title: "Event plan updated",
        summary: "Chamber dinner: guests 80 to 96; hours now Sat 14 Nov, 19:00 – 23:00.", beforeSummary: "80 guests", afterSummary: "96 guests",
        affectedSurfaces: ["guest_count", "timings"] },
    ], lastAcknowledgement: null }]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,.*2 changes to read/u }));
    const section = await screen.findByRole("region", { name: "What changed" });
    expect(within(section).queryByText(/^Grand Hall: Sat 14 Nov/u)).toBeNull();
    // An event edit keeps its sentence: an older row's Was and Now carry only
    // the guests, so the hours would be lost without it.
    expect(within(section).getByText("Chamber dinner: guests 80 to 96; hours now Sat 14 Nov, 19:00 – 23:00.")).toBeTruthy();
    expect(within(section).getByText("96 guests")).toBeTruthy();
  });

  it("shows a moved booking's change on that booking alone, and an edit to the event on each of its rooms", async () => {
    const dinner = "00000000-0000-4000-8000-0000000000b2";
    getCalendarMock.mockResolvedValue(calendarFixture([
      bookingWithEvent(),
      { ...bookingWithEvent(), id: dinner, spaceId: SALOON, title: "Chamber dinner · Saloon" } as CalendarResponse["entries"][number],
    ]));
    serve([{ eventId: EVENT_ID, changes: [
      timesMoved(20, "00000000-0000-4000-8000-0000000000d4", dinner),
      timesMoved(10, "00000000-0000-4000-8000-0000000000d5", EVENT_ID),
    ], lastAcknowledgement: null }]);
    renderBoard();
    expect(await screen.findByRole("button", { name: /^Chamber dinner · Saloon,.*2 changes to read/u })).toBeTruthy();
    const hall = screen.getByRole("button", { name: /^Chamber dinner, .*a change to read/u });
    fireEvent.click(hall);
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));
    // Only what the Grand Hall's slot showed: the Saloon's own move still waits.
    await waitFor(() => { expect(floor.acknowledge).toHaveBeenCalledTimes(1); });
    expect(floor.acknowledge).toHaveBeenCalledWith(EVENT_ID, { changeId: "00000000-0000-4000-8000-0000000000d5" });
    expect(await screen.findByRole("button", { name: /^Chamber dinner · Saloon,.*a change to read/u })).toBeTruthy();
  });

  it("says who has the changes once someone on the floor acknowledged them", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture([bookingWithEvent()]));
    floor.awaiting.mockResolvedValue([{ eventId: EVENT_ID, changes: [], lastAcknowledgement: { at: new Date(Date.now() - 30 * 60_000).toISOString(), by: "Jamie at the door", byUserId: "00000000-0000-4000-8000-0000000000aa" } }]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Chamber dinner,/u }));
    expect(await screen.findByText(/^Changes seen by Jamie at the door, \d{2}:\d{2}\.$/u)).toBeTruthy();
    expect(screen.queryByText("Changed")).toBeNull();
  });
});

describe("DayBoardPage: who is on setup for a turn-round", () => {
  const at = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

  function day(): CalendarResponse["entries"] {
    return [
      { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b7", title: "Lunch", eventId: "00000000-0000-4000-8000-0000000000e7", startsAt: at(-240), endsAt: at(-180) },
      { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b8", title: "Dinner", eventId: "00000000-0000-4000-8000-0000000000e8", startsAt: at(60), endsAt: at(300) },
    ] as CalendarResponse["entries"];
  }

  it("names who is on setup on the dinner's turn-round, on its slot and in its panel", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    rotaMock.mockImplementation((_venueId, start) => Promise.resolve(rotaWeek(start ?? "", [{ startsAt: at(-60), endsAt: at(90) }])));
    renderBoard();
    const dinner = await screen.findByRole("button", { name: /^Dinner,/u });
    await waitFor(() => { expect(dinner.textContent).toContain("Turn-round 4 h · 1 on setup"); });
    fireEvent.click(dinner);
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(within(section).getByText(/^On setup: Jamie \d{2}:\d{2}–\d{2}:\d{2}\.$/u)).toBeTruthy();
    expect(document.querySelector(".dayboard-summary")?.textContent ?? "").not.toContain("nobody on setup");
  });

  it("says plainly when the rota plans setup but puts nobody on the dinner's turn-round", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    // Setup is planned this week, in another room only.
    rotaMock.mockImplementation((_venueId, start) => Promise.resolve(rotaWeek(start ?? "", [
      { spaceId: SALOON, spaceName: "Saloon", startsAt: at(-60), endsAt: at(90) },
      { staffMemberId: null, startsAt: at(0), endsAt: at(60) },
    ])));
    renderBoard();
    const dinner = await screen.findByRole("button", { name: /^Dinner,/u });
    await waitFor(() => { expect(dinner.textContent).toContain("Turn-round 4 h · nobody on setup"); });
    expect(document.querySelector(".dayboard-summary")?.textContent).toContain("Grand Hall’s turn-round has nobody on setup.");
    fireEvent.click(dinner);
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(within(section).getByText("Nobody is on setup for this turn-round. One setup shift is still to fill.")).toBeTruthy();
  });

  it("says nothing about crew when the rota plans no setup at all", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    renderBoard();
    const dinner = await screen.findByRole("button", { name: /^Dinner,/u });
    await waitFor(() => { expect(rotaMock).toHaveBeenCalled(); });
    expect(dinner.textContent).toContain("Turn-round 4 h");
    expect(dinner.textContent).not.toContain("on setup");
    fireEvent.click(dinner);
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(within(section).queryByText(/on setup/u)).toBeNull();
  });
});

describe("DayBoardPage: what moves at a changeover", () => {
  const LUNCH_EVENT = "00000000-0000-4000-8000-0000000000e7";
  const DINNER_EVENT = "00000000-0000-4000-8000-0000000000e8";
  const LUNCH_LAYOUT = "00000000-0000-4000-8000-0000000000c7";
  const DINNER_LAYOUT = "00000000-0000-4000-8000-0000000000c8";

  function day(): CalendarResponse["entries"] {
    const at = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
    return [
      { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b7", title: "Lunch", eventId: LUNCH_EVENT, startsAt: at(-240), endsAt: at(-180) },
      { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b8", title: "Dinner", eventId: DINNER_EVENT, startsAt: at(60), endsAt: at(300) },
    ] as CalendarResponse["entries"];
  }

  function layouts(byEvent: Record<string, readonly string[]>): void {
    resolveLayoutsMock.mockImplementation((input: { eventId: string }) => Promise.resolve({
      eventName: "", roomName: "Grand Hall", unavailableCount: 0,
      layouts: (byEvent[input.eventId] ?? []).map((configurationId) => ({ configurationId, name: `Layout ${configurationId.slice(-2)}`, spaceName: "Grand Hall" })),
    }));
  }

  it("lists what goes back to store, what comes from it and what stays, from the lunch's layout to the dinner's", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    layouts({ [LUNCH_EVENT]: [LUNCH_LAYOUT], [DINNER_EVENT]: [DINNER_LAYOUT] });
    changeoverMock.mockResolvedValue({
      from: { configId: LUNCH_LAYOUT, name: "Lunch layout", guests: 60, hasPlan: false },
      to: { configId: DINNER_LAYOUT, name: "Dinner layout", guests: 120, hasPlan: true },
      items: [
        { name: "Trestle", category: "table", phase: "furniture", isAccessory: false, before: 8, after: 0, zones: [] },
        { name: "6ft Round Table", category: "table", phase: "furniture", isAccessory: false, before: 0, after: 12, zones: [{ zone: "Centre", before: 0, after: 12 }] },
      ],
      plan: null,
    });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Dinner,/u }));
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(await within(section).findByText("8 × Trestle")).toBeTruthy();
    expect(within(section).getByText("12 × 6ft Round Table")).toBeTruthy();
    // The lunch's sheet was frozen without a plan: the list says what it can't.
    expect(within(section).getByText("The sheet for Lunch has no plan, so moves within each part of the room aren’t shown.")).toBeTruthy();
    expect(changeoverMock).toHaveBeenCalledWith({ from: LUNCH_LAYOUT, to: DINNER_LAYOUT, fromEventId: LUNCH_EVENT, toEventId: DINNER_EVENT });
    // The dinner's layouts are read once, for its sheet link and the changeover.
    expect(resolveLayoutsMock.mock.calls.filter(([input]) => (input as { eventId: string }).eventId === DINNER_EVENT)).toHaveLength(1);
  });

  it("runs the dinner's changeover from the lunch, past a viewing in between, and gives the viewing none", async () => {
    const at = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
    const [lunch, dinner] = day();
    getCalendarMock.mockResolvedValue(calendarFixture([
      lunch,
      { ...liveBooking(), id: "00000000-0000-4000-8000-0000000000b9", title: "Show-round", kind: "viewing", state: "viewing", eventId: null, startsAt: at(-120), endsAt: at(-90) },
      dinner,
    ] as CalendarResponse["entries"]));
    layouts({ [LUNCH_EVENT]: [LUNCH_LAYOUT], [DINNER_EVENT]: [DINNER_LAYOUT] });
    changeoverMock.mockResolvedValue({
      from: { configId: LUNCH_LAYOUT, name: "Lunch layout", guests: 60, hasPlan: true },
      to: { configId: DINNER_LAYOUT, name: "Dinner layout", guests: 120, hasPlan: true },
      items: [{ name: "Trestle", category: "table", phase: "furniture", isAccessory: false, before: 8, after: 0, zones: [] }],
      plan: { staysPut: 0, moved: [], fromStore: [], toStore: [{ name: "Trestle", category: "table", count: 8 }], movedIds: [], fromStoreIds: [], toStoreFootprints: [] },
    });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Dinner,/u }));
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(await within(section).findByText("8 × Trestle")).toBeTruthy();
    expect(changeoverMock).toHaveBeenCalledWith({ from: LUNCH_LAYOUT, to: DINNER_LAYOUT, fromEventId: LUNCH_EVENT, toEventId: DINNER_EVENT });
    fireEvent.click(screen.getByRole("button", { name: /^Show-round,/u }));
    await screen.findByRole("region", { name: /Grand Hall: Show-round/u });
    expect(screen.queryByRole("region", { name: /^Changeover/u })).toBeNull();
  });

  it("offers Try again when the layouts could not be checked, and then works it out", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    layouts({ [LUNCH_EVENT]: [LUNCH_LAYOUT], [DINNER_EVENT]: [DINNER_LAYOUT] });
    resolveLayoutsMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    changeoverMock.mockResolvedValue({
      from: { configId: LUNCH_LAYOUT, name: "Lunch layout", guests: 60, hasPlan: true },
      to: { configId: DINNER_LAYOUT, name: "Dinner layout", guests: 120, hasPlan: true },
      items: [{ name: "Trestle", category: "table", phase: "furniture", isAccessory: false, before: 8, after: 0, zones: [] }],
      plan: { staysPut: 0, moved: [], fromStore: [], toStore: [{ name: "Trestle", category: "table", count: 8 }], movedIds: [], fromStoreIds: [], toStoreFootprints: [] },
    });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Dinner,/u }));
    const section = await screen.findByRole("region", { name: "Changeover from Lunch" });
    expect(await within(section).findByText("What moves could not be worked out just now.")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Try again" }));
    expect(await within(section).findByText("8 × Trestle")).toBeTruthy();
  });

  it("says nothing moves when the dinner keeps the lunch's layout, without asking", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    layouts({ [LUNCH_EVENT]: [LUNCH_LAYOUT], [DINNER_EVENT]: [LUNCH_LAYOUT] });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Dinner,/u }));
    expect(await screen.findByText("The same layout as Lunch: nothing moves.")).toBeTruthy();
    expect(changeoverMock).not.toHaveBeenCalled();
  });

  it("says plainly when the booking before has no layout for the room", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    layouts({ [DINNER_EVENT]: [DINNER_LAYOUT] });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Dinner,/u }));
    expect(await screen.findByText("Lunch has no layout for this room yet, so what moves can’t be worked out until it has one.")).toBeTruthy();
    expect(changeoverMock).not.toHaveBeenCalled();
  });

  it("has no changeover for the first booking of the day in its room", async () => {
    getCalendarMock.mockResolvedValue(calendarFixture(day()));
    layouts({ [LUNCH_EVENT]: [LUNCH_LAYOUT], [DINNER_EVENT]: [DINNER_LAYOUT] });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Lunch,/u }));
    await screen.findByRole("region", { name: /Grand Hall: Lunch/u });
    expect(screen.queryByRole("region", { name: /^Changeover/u })).toBeNull();
  });
});
