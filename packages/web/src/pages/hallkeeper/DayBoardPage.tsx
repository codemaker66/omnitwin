import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bell, Clock, WifiOff } from "lucide-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { formatWallDay, formatWallTime, msToWallInput, shiftRange, wallInputToMs, type BoardRange } from "../diary/lib/board-time.js";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { CALENDAR_REUSE_MS, useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { VenueNotConnected } from "../../components/dashboard/VenueNotConnected.js";
import { deskGreeting } from "../../components/dashboard/enquiries/enquiry-desk-format.js";
import { VENUE_FLOOR_ROLES, administersVenue, awaitsVenue, hasRole } from "../../lib/role-capabilities.js";
import { clockIsCorrected, correctedNowMs, subscribeClock } from "../../lib/clock-offset.js";
import { useSlotRequests } from "../../components/requests/requests-context.js";
import { listensForFloorRequests } from "../../lib/requests-live.js";
import { useSlotObservations } from "./lib/use-slot-observations.js";
import { changesForDay, floorChangesBySlot, movedOffDay, seenWith, useFloorChanges, type SeenOnDay } from "./lib/use-floor-changes.js";
import { LeftTheDay, LeftTheDayList } from "./DayBoardChanges.js";
import { anyTurnRound, crewBySlot, crewOnPanel, turnRoundFrom, unstaffedTurnRounds, UNSTAFFED_HORIZON_MS } from "./lib/turn-round-crew.js";
import { useRotaDay } from "./lib/use-rota-day.js";
import { arrivalNotices, arrivalParts } from "./lib/supplier-notices.js";
import { useSupplierArrivals } from "./lib/use-supplier-arrivals.js";
import { ChimeToggle } from "../../components/requests/ChimeToggle.js";
import { ShiftHandover } from "../../components/requests/ShiftHandover.js";
import { PushAlertsToggle } from "../../components/requests/PushAlertsToggle.js";
import {
  DAY_BOARD_LEGEND,
  DAY_BOARD_RING_LEGEND,
  deriveDayBoard,
  type DayBoardLane,
  type NextAction,
  type UnownedRequest,
} from "./lib/day-board-state.js";
import { boardWindow, nowPlaque, rulerTicks } from "./lib/day-board-layout.js";
import {
  boardSummary,
  planeStages,
  roomDay,
  roomInFocus,
  showingLine,
  type BoardFocus,
  type SummaryPart,
} from "./lib/day-board-rooms.js";
import { boardFreshness, useBoardClock, useConnectionState } from "./lib/use-board-clock.js";
import { useVenueClock } from "./lib/use-venue-timezone.js";
import { deviceZone, zoneNote } from "../../components/hallkeeper/sheet-facts.js";
import { boardDayAnchorMs, boardDayRange, useDayBoundary } from "./lib/board-day.js";
import { useWakeLock } from "./lib/use-wake-lock.js";
import { driftOffset } from "./lib/burn-in-drift.js";
import { RoomRow, Scale, StateIcon } from "./DayBoardRooms.js";
import { SlotDetail } from "./DayBoardSlotDetail.js";
import { useSupplierForms } from "./DayBoardSuppliers.js";
import {
  DayBoardSlotRequestsContext,
  type SlotRequestsComponent,
  type SlotRequestsProps,
} from "./lib/slot-requests-contract.js";
import "../../styles/hallkeeper-register.css";
import "./day-board.css";

/** When the display dies, the day prints (S8 item 13): the paper register's
 *  one print control and the line the printed page carries. */
export const BOARD_PRINT_COPY = {
  print: "Print today",
  printDay: "Print this day",
  note: "Printed from the Day Board; the screen is the record.",
  readAt: (clock: string): string => `Read at ${clock}.`,
} as const;

/** The wall's burn-in drift as custom properties on the board's root (S8). */
interface DriftStyle extends CSSProperties {
  readonly "--lt-drift-x": string;
  readonly "--lt-drift-y": string;
}

// ---------------------------------------------------------------------------
// The Day Board (goal 19 S3; D1, D3, D9, D10, D11) — the hallkeeper's live
// view of today, in the desks' register (Blake's concept C, 10 November
// 2026). A pure projection of GET /calendar and the venue's open requests
// through deriveDayBoard, on one corrected clock; live updates arrive over
// /ws/diary (any committed change refetches: the snapshot doctrine, never
// trusted deltas).
//
// The composition, from the desks: the ivory sheet on the sage ground with
// the day's greeting, its title and one sentence of what matters; this
// hallkeeper's next action, always; the copper plane of the day's counts,
// each a filter on the rooms; then the rooms, one row each with its
// photograph, its day in words and a bar of the whole day with the present
// marked. The forest panel beside the sheet holds the requests nobody has,
// or the slot a tap opened. Narrower screens put the requests above the
// rooms and unfold an opened slot under its own room. The wall
// (`?register=wall`) frames the rooms on forest, shows room, title, state,
// time and next action only, and opens nothing (D11).
//
// Motion is the attention system (D3): a breath on the dot as the room's
// moment approaches, the live breath as the room's heartbeat and the proof
// the display is alive, a copper halo that breathes round a request's ring
// until somebody owns it. All of it is CSS on opacity and transform. Each
// breath samples its own epoch phase the moment it begins (useBreathPhase),
// so every screen breathes on the venue's minute grid, and every breath
// stops the instant the connection drops. State ticks are boundary-exact
// (useBoardClock); nothing polls.
// ---------------------------------------------------------------------------

/** Focus a keyboard gave, not the focus a tap or click gives on the way to
 *  pressing; a browser that cannot tell counts it. */
function keyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** No days read ahead: nobody has shown they may step. */
const NO_DAYS: readonly BoardRange[] = [];
/** The board before its day has landed: no lanes, one stable value. */
const NO_LANES: readonly DayBoardLane[] = [];
const DAY_MS = 86_400_000;
/** The phone: the rooms in one column, everything a thumb's width. */
const PHONE_QUERY = "(max-width: 760px)";
/** Wide enough for the sheet and the forest panel side by side, as the
 *  Enquiries desk decides it. */
const DESK_QUERY = "(min-width: 1180px)";
/** How many requests the narrow screens list before "Show all". */
const RAIL_PREVIEW = 4;

/** A calendar day on either side of `date` (YYYY-MM-DD), as the same form. */
function stepDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Keys that move the day are the board's own only when no field holds focus. */
function typingInto(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

/** Whether the screen matches a media query, read live. */
function useMatches(query: string): boolean {
  const subscribe = useCallback((listener: () => void): (() => void) => {
    if (typeof window.matchMedia !== "function") return () => undefined;
    const media = window.matchMedia(query);
    media.addEventListener("change", listener);
    return () => { media.removeEventListener("change", listener); };
  }, [query]);
  const read = useCallback((): boolean => typeof window.matchMedia === "function" && window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

// The <SlotRequests> mount point: its contract lives in
// ./lib/slot-requests-contract.ts and is re-exported here, where Lane 9's
// documented import points.
export { DayBoardSlotRequestsContext };
export type { SlotRequestsComponent, SlotRequestsProps };

const NEVER_CORRECTED = (): boolean => false;
/** A booking's id as the API gives it: safe inside an attribute selector. */
const BOOKING_ID = /^[0-9a-f-]+$/iu;

/**
 * A slot that moves between its room's lines (the next function becoming
 * what the room is doing) is drawn afresh in its new place, and a keyboard's
 * place on it would fall to the page. It is put back. A move the person made
 * fires focusout and lets the place go; a slot redrawn fires none.
 */
function useKeptSlabFocus(boardRef: RefObject<HTMLDivElement | null>): void {
  const kept = useRef<string | null>(null);
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    const onIn = (event: FocusEvent): void => {
      const slab = event.target instanceof Element ? event.target.closest<HTMLElement>(".dayboard-slab[data-booking]") : null;
      kept.current = slab?.dataset.booking ?? null;
    };
    const onOut = (): void => { kept.current = null; };
    board.addEventListener("focusin", onIn);
    board.addEventListener("focusout", onOut);
    return () => {
      board.removeEventListener("focusin", onIn);
      board.removeEventListener("focusout", onOut);
    };
  }, [boardRef]);
  useLayoutEffect(() => {
    const booking = kept.current;
    if (booking === null || !BOOKING_ID.test(booking)) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    boardRef.current?.querySelector<HTMLElement>(`.dayboard-slab[data-booking="${booking}"]`)?.focus({ preventScroll: true });
  });
}

/** Whether the corrected clock disagrees with the device by a minute or more. */
function useClockCorrected(): boolean {
  return useSyncExternalStore(subscribeClock, clockIsCorrected, NEVER_CORRECTED);
}

/** A request's line on the rail; an urgent one says so in words, not only
 *  in its colour. */
function railWords(item: UnownedRequest): ReactElement {
  return (
    <span className="dayboard-rail-words">
      {item.urgency === "now" && <><strong className="dayboard-rail-flag">Urgent</strong>{" "}</>}
      <span>{item.line}</span>
    </span>
  );
}

/** The requests nobody has: urgent first, oldest first within that. Today's,
 *  whichever day is on screen. A narrow screen lists the first few. The wall
 *  shows none of it (concept C): its plane says how many wait, its next
 *  action names the first, and each room's ring breathes until somebody
 *  owns it. */
function Rail({ unowned, today, onOpen, preview }: {
  readonly unowned: readonly UnownedRequest[];
  readonly today: boolean;
  readonly onOpen: (bookingId: string | null) => void;
  readonly preview: boolean;
}): ReactElement {
  const [all, setAll] = useState(false);
  const shown = preview && !all ? unowned.slice(0, RAIL_PREVIEW) : unowned;
  const urgent = unowned.filter((item) => item.urgency === "now").length;
  return (
    <aside className="dayboard-rail" aria-label="Unowned requests" data-count={unowned.length}>
      <p className="dayboard-rail-eyebrow">Requests nobody has</p>
      <h2 className="dayboard-rail-title">
        {unowned.length === 0 ? "Nobody is waiting." : `${String(unowned.length)} waiting`}
        {urgent > 0 && <span className="dayboard-rail-urgent">{urgent === 1 ? "1 urgent" : `${String(urgent)} urgent`}</span>}
      </h2>
      {!today && <p className="dayboard-rail-note">Today’s requests.</p>}
      {shown.length > 0 && (
        <ul className="dayboard-rail-list">
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="dayboard-rail-item"
                data-urgency={item.urgency}
                disabled={item.bookingId === null}
                onClick={() => { onOpen(item.bookingId); }}
              >
                <Bell size={14} aria-hidden="true" />
                {railWords(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && unowned.length > RAIL_PREVIEW && (
        <button type="button" className="dayboard-rail-more" aria-expanded={all} onClick={() => { setAll((open) => !open); }}>
          {all ? "Show fewer" : `Show all ${String(unowned.length)}`}
        </button>
      )}
    </aside>
  );
}

/** This hallkeeper's next action, one line at the top, always (D7). The
 *  visible line is not a live region, because its minutes tick; a hidden
 *  region says each NEW action once, assertively only when it is urgent.
 *  On the wall it is words only: nothing opens there. */
function NextActionLine({ action, urgent, onOpen, wall }: {
  readonly action: NextAction;
  readonly urgent: boolean;
  readonly onOpen: (bookingId: string | null) => void;
  readonly wall: boolean;
}): ReactElement {
  const identity = `${action.kind}:${action.requestId ?? action.bookingId ?? ""}`;
  const lineRef = useRef(action.line);
  lineRef.current = action.line;
  const [spoken, setSpoken] = useState("");
  useEffect(() => { setSpoken(lineRef.current); }, [identity]);
  return (
    <>
      <p className={`dayboard-next dayboard-next-${action.kind}`} data-urgent={urgent ? "true" : "false"}>
        {action.kind === "request" ? <Bell size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
        {action.bookingId === null || wall
          ? <span className="dayboard-next-line">{action.line}</span>
          : <button type="button" className="dayboard-next-line" onClick={() => { onOpen(action.bookingId); }}>{action.line}</button>}
      </p>
      <span className="dayboard-announcer" role="status" aria-live={urgent ? "assertive" : "polite"}>{spoken}</span>
    </>
  );
}

/** The sentence under the title, its counts in strong type. */
function Summary({ parts, focusRef }: {
  readonly parts: readonly SummaryPart[];
  /** The keyboard's place when a notice it was in leaves the page. */
  readonly focusRef: RefObject<HTMLParagraphElement>;
}): ReactElement {
  return (
    <p className="dayboard-summary" ref={focusRef} tabIndex={-1}>
      {/* A fixed sentence built afresh each render: its order is its identity. */}
      {parts.map((part, index) => (typeof part === "string"
        ? part
        : <strong key={index} data-tone={part.tone}>{part.strong}</strong>))}
    </p>
  );
}

export interface DayBoardPageProps {
  /** Lane 9's slot request surface. Overrides the context value. */
  readonly slotRequests?: SlotRequestsComponent;
}

/** The day stays on screen when a refresh does not land; it says from when
 *  once that is a different minute (the Diary's words, for the day). */
function dayRefreshFailed(at: string, readAt: string | null): string {
  return readAt === null || readAt === at
    ? `Couldn't refresh at ${at}.`
    : `Couldn't refresh at ${at}. Showing the day as it was at ${readAt}.`;
}

/** The rota could not be read: said above the rooms, with a Try again named
 *  for what it reads, which shows the read while it runs. When a read lands
 *  and the notice goes with the keyboard in it, the keyboard goes to the day,
 *  not to the document. */
function RotaNotice({ shown, readAt, reading, onRetry, focusAfter }: {
  readonly shown: boolean;
  /** When the crew still shown was read; null before any read landed. */
  readonly readAt: string | null;
  readonly reading: boolean;
  readonly onRetry: () => void;
  /** Where the keyboard goes once the notice it was in has gone. */
  readonly focusAfter: () => void;
}): ReactElement | null {
  const noticeRef = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  useEffect(() => {
    if (shown) return;
    // The notice holding the keyboard has gone: focus fell to the document.
    if (hadFocus.current && (document.activeElement === null || document.activeElement === document.body)) focusAfter();
    hadFocus.current = false;
  }, [shown, focusAfter]);
  if (!shown) return null;
  return (
    <div
      ref={noticeRef}
      className="dayboard-notice"
      role="status"
      onFocus={() => { hadFocus.current = true; }}
      onBlur={(event) => { hadFocus.current = noticeRef.current?.contains(event.relatedTarget) === true; }}
    >
      <p>{readAt === null
        ? "The rota could not be read, so who is on setup is not shown. The board tries again each minute."
        : `Who is on setup is as read at ${readAt}; the rota could not be read since. The board tries again each minute.`}</p>
      {/* Never disabled: a disabled button drops the keyboard's place to the page. */}
      <button
        type="button"
        className="dayboard-button dayboard-rota-retry"
        aria-label="Try again to read the rota"
        aria-busy={reading}
        aria-disabled={reading}
        onClick={() => { if (!reading) onRetry(); }}
      >
        {reading && <ActivityIndicator size={14} />}
        Try again
      </button>
    </div>
  );
}

export function DayBoardPage({ slotRequests }: DayBoardPageProps = {}): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const venue = useVenueClock(venueId);
  const timeZone = venue.timeZone;
  const contextSlotRequests = useContext(DayBoardSlotRequestsContext);
  const slotRequestsComponent = slotRequests ?? contextSlotRequests;
  const [searchParams, setSearchParams] = useSearchParams();
  const wall = searchParams.get("register") === "wall";
  const phone = useMatches(PHONE_QUERY);
  const wide = useMatches(DESK_QUERY);
  // The forest panel stands beside the sheet on a wide desk; elsewhere the
  // requests come before the rooms and an open slot unfolds under its room.
  const beside = wide && !wall;

  // One corrected clock (D9), ticking at the next state boundary the board
  // derives from it; the boundary and the clock meet through state, so a
  // tick is one render at the exact instant something changes.
  const [boundaryMs, setBoundaryMs] = useState<number | null>(null);
  // The venue's day boundary hour (S8). The clock already ticks on every
  // whole minute, and a rollover falls on one, so it needs no boundary of its own.
  // The hour the board's day runs to, and whether it is read yet: a supplier's
  // time after midnight is placed on the board's night only once it is.
  const boundary = useDayBoundary(venueId);
  const dayBoundaryHour = boundary.hour;
  const nowMs = useBoardClock(boundaryMs);
  const corrected = useClockCorrected();

  const [chosenDate, setSelectedDate] = useState<string | null>(null);
  const [roomId, setRoomIdState] = useState("");
  const [focus, setFocusState] = useState<BoardFocus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The office's open supplier forms, kept above the slot's panel: a panel
  // drawn afresh, when the day is read again once the venue's night hours
  // arrive, opens its form as it was left.
  const supplierForms = useSupplierForms();
  // The wall shows today, whatever day this screen had stepped to before it
  // became the wall: it has no day controls to come back with.
  const selectedDate = wall ? null : chosenDate;
  const browsingToday = selectedDate === null;
  // A count on the plane and a room from the list are two ways to narrow the
  // rooms; choosing one lets the other go, so the list never comes up empty
  // for a reason the screen does not show.
  const chooseRoom = useCallback((id: string): void => { setRoomIdState(id); setFocusState("all"); }, []);
  const chooseFocus = useCallback((next: BoardFocus): void => {
    setFocusState((current) => (current === next ? "all" : next));
    setRoomIdState("");
  }, []);

  // Today, venue-local, ending at the venue's own boundary hour (04:00 by
  // default; midnight for a venue without settings): an event running to
  // 02:00 is still today's, and an always-on wall tablet rolls once, then.
  const selectedMs = selectedDate === null ? boardDayAnchorMs(nowMs, dayBoundaryHour, timeZone) : wallInputToMs(`${selectedDate}T12:00`, timeZone) ?? nowMs;
  // The day runs to the next boundary hour, so the hours after midnight are
  // drawn and a late bar is on the board it belongs to.
  const range = useMemo(() => boardDayRange(selectedMs, dayBoundaryHour, timeZone), [selectedMs, dayBoundaryHour, timeZone]);
  // The days either side are read once this one is on screen, but only once
  // someone shows they may step (a mouse over or keyboard focus on the day
  // controls, or a step itself); the wish lapses after the reuse window, so
  // a wall left on today reads one day per Diary change.
  const [stepWishedAtMs, setStepWishedAtMs] = useState<number | null>(null);
  const wishToStep = useCallback((): void => { setStepWishedAtMs(Date.now()); }, []);
  const readingAhead = stepWishedAtMs !== null && Date.now() - stepWishedAtMs < CALENDAR_REUSE_MS;
  const neighbours = useMemo(
    () => (readingAhead ? [shiftRange(range, 1, timeZone), shiftRange(range, -1, timeZone)] : NO_DAYS),
    [readingAhead, range, timeZone],
  );
  const { data, status, error, refetch, isRefreshing, refreshFailedAtMs, readAtMs } = useCalendar(venueId, range, neighbours);
  // The office reads which screens are on (S7): the wall says so; a narrow
  // screen is a phone in a pocket; anything else is a desk. The wall is read
  // live, so a screen made a wall display after loading says so at once and
  // its alerts stop carrying a reply's words (D11).
  const [handheld] = useState<"phone" | "desk">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "phone" : "desk");
  const device: "wall" | "phone" | "desk" = wall ? "wall" : handheld;
  // The wall never sleeps (S8 item 14); phones and desks keep the system's own rule.
  useWakeLock(wall);
  // Nothing burns in: the wall sits a few pixels off centre and moves every
  // ten minutes (S8 item 14); nowMs ticks at least once a minute.
  const drift = wall ? driftOffset(nowMs) : null;
  const driftStyle: DriftStyle | undefined = drift === null ? undefined : { "--lt-drift-x": `${String(drift.x)}px`, "--lt-drift-y": `${String(drift.y)}px` };
  const live = useDiaryLive(venueId !== null, refetch, { device });
  // The calendar stamps its reads with the device clock; the board compares
  // and prints them on the corrected one (D9).
  const readAtCorrectedMs = readAtMs === null ? null : correctedNowMs(readAtMs);
  const refreshFailedCorrectedMs = refreshFailedAtMs === null ? null : correctedNowMs(refreshFailedAtMs);
  // The venue's open requests, from the one provider snapshot. A VenueRequest
  // carries every field the derivation reads.
  const requestsApi = useSlotRequests();
  // What the rooms were seen doing (S5): read by everyone who reads the
  // board, recorded from the slot by the floor; the wall stays inert.
  const observationsApi = useSlotObservations(venueId, range, listensForFloorRequests(user), user?.name ?? "");
  const shownDate = msToWallInput(selectedMs, timeZone).slice(0, 10);
  // "Today" is the board's day, so between midnight and the boundary the
  // calendar day that has just begun is one step ahead and can be opened.
  const today = msToWallInput(boardDayAnchorMs(nowMs, dayBoundaryHour, timeZone), timeZone).slice(0, 10);

  const board = useMemo(
    () => (data === null
      ? null
      : deriveDayBoard(data, nowMs, timeZone, requestsApi.requests, observationsApi.observations, dayBoundaryHour)),
    [data, nowMs, timeZone, requestsApi.requests, observationsApi.observations, dayBoundaryHour],
  );
  const nextBoundaryMs = board?.nextBoundaryMs ?? null;
  useEffect(() => { setBoundaryMs(nextBoundaryMs); }, [nextBoundaryMs]);

  const lanes = board?.lanes ?? NO_LANES;
  // What changed since the floor last looked, on the day's events: read by
  // everyone who reads the board, acknowledged from the slot by the floor.
  // The events, bookings and phases seen on this day, kept while the board is
  // open: a function moved off the day is still told here, not only where it
  // went, and a change to the same event on another day stays that day's.
  const seenDays = useRef(new Map<string, SeenOnDay>());
  const dayKey = data?.range.from ?? "";
  const seenToday = useMemo(() => {
    const seen = seenWith(seenDays.current.get(dayKey), lanes);
    seenDays.current.set(dayKey, seen);
    return seen;
  }, [lanes, dayKey]);
  const eventIds = useMemo(() => [...seenToday.events.keys()], [seenToday]);
  // Read for the board's own day: another day's changes are that day's.
  const floor = useFloorChanges(eventIds, venueId !== null, range);
  // A move reaches the board through the live calendar; its change is read
  // with it, not at the next minute.
  const refreshFloor = floor.refresh;
  useEffect(() => { if (data !== null) refreshFloor(); }, [data, refreshFloor]);
  const onBoard = useMemo(() => new Set(lanes.flatMap((lane) => lane.slots.flatMap((slot) => (slot.eventId === null ? [] : [slot.eventId])))), [lanes]);
  // A function seen on this day that has left it, with what concerns the day
  // still waiting; said as a move only when a Diary move put it elsewhere.
  const leftTheDay = useMemo(() => [...seenToday.events].flatMap(([eventId, title]) => {
    if (onBoard.has(eventId)) return [];
    const changes = changesForDay(eventId, floor.byEvent.get(eventId), seenToday);
    if (changes.length === 0) return [];
    const movedOff = changes.some((change) => seenToday.sources.has(change.sourceId) && movedOffDay(change, range));
    const truncated = floor.byEvent.get(eventId)?.truncated === true;
    return [{ eventId, title, changes, movedOff, truncated, surface: `left:${eventId}` }];
  }), [seenToday, onBoard, floor.byEvent, range]);
  // Where the keyboard goes when a notice it was in leaves the page: the
  // day's sentence, or the board's title on a day with none.
  const sentenceRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTheDay = useCallback((): void => { (sentenceRef.current ?? titleRef.current)?.focus(); }, []);
  const changesBySlot = useMemo(() => floorChangesBySlot(lanes, floor.byEvent, seenToday), [lanes, floor.byEvent, seenToday]);
  // The copper mark, on slots still to come or under way: a function that
  // has ended keeps its changes in its panel, but no longer calls for them.
  const changedBySlot = useMemo(() => {
    const ended = new Set(lanes.flatMap((lane) => lane.slots.filter((slot) => slot.state === "done").map((slot) => slot.bookingId)));
    return new Map([...changesBySlot]
      .filter(([bookingId, changes]) => changes.length > 0 && !ended.has(bookingId))
      .map(([bookingId, changes]) => [bookingId, changes.length] as const));
  }, [lanes, changesBySlot]);
  // Who is on setup for each turn-round, from the published rota: read with
  // the day, and again as the board refreshes, at most every five minutes.
  // The wall shows no crew, so it reads no rota.
  const rota = useRotaDay(venueId, range, timeZone, venueId !== null && !wall);
  const refreshRota = rota.refresh;
  useEffect(() => { if (data !== null) refreshRota(); }, [data, refreshRota]);
  // Refresh reads the day now: the bookings, and the rota with them.
  const refreshDay = useCallback(() => { refetch(); refreshRota(true); }, [refetch, refreshRota]);
  const rotaShifts = rota.shifts;
  const rotaPeople = rota.people;
  const crew = useMemo(
    () => crewBySlot(lanes, { shifts: rotaShifts, people: rotaPeople }, range, nowMs),
    [lanes, rotaShifts, rotaPeople, range, nowMs],
  );
  // Who comes to the building for each booking: the office plans them, the
  // floor marks the door. The wall shows no contacts, so it reads none.
  const suppliers = useSupplierArrivals(venueId, range, venueId !== null && !wall);
  const refreshSuppliers = suppliers.refresh;
  useEffect(() => { if (data !== null) refreshSuppliers(); }, [data, refreshSuppliers]);
  const plansSuppliers = !wall && administersVenue(user, venueId);
  // The door is marked as it happens: on today's board, never another day's.
  const marksDoor = browsingToday && !wall && user !== null && venueId !== null && user.venueId === venueId && hasRole(VENUE_FLOOR_ROLES, user.role);
  const acknowledgesChanges = !wall && user !== null && (user.role === "hallkeeper" || user.role === "staff" || user.role === "admin");
  const view = useMemo(() => boardWindow(range, lanes, nowMs, timeZone), [range, lanes, nowMs, timeZone]);
  const ticks = useMemo(() => rulerTicks(view, timeZone, phone ? 4 : 2), [view, timeZone, phone]);
  const plaque = nowPlaque(nowMs, view);

  // Live, offline or stale (D10); and every breath stops the instant the
  // socket drops after it has been up (D3 law 6), a minute before the band.
  const connection = useConnectionState(live.connected);
  const freshness = boardFreshness(nowMs, readAtCorrectedMs, connection.droppedAtMs, refreshFailedAtMs !== null);
  const frozen = freshness.kind !== "live" || (connection.everConnected && !live.connected);

  // ← Today → (roadmap N4): tomorrow's rooms are a key away, not a picker.
  // The keys are the board's while focus rests on it or on nothing.
  const boardRef = useRef<HTMLDivElement>(null);
  useKeptSlabFocus(boardRef);
  const moveDay = useCallback((days: number): void => {
    wishToStep();
    const next = stepDay(shownDate, days);
    setSelectedDate(next === today ? null : next);
  }, [shownDate, today, wishToStep]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      const onBoard = event.target === document.body || (event.target instanceof Node && boardRef.current?.contains(event.target) === true);
      if (!onBoard) return;
      if (event.key === "ArrowLeft") moveDay(-1);
      else if (event.key === "ArrowRight") moveDay(1);
      else if (event.key === "t") setSelectedDate(null);
      else if (event.key === "Escape") setSelectedId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [moveDay]);

  // An opened slot comes into view; a slot that left the day closes itself.
  // Nothing opens on the wall (D11).
  const detailRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => {
    if (wall || selectedId === null || board === null) return null;
    for (const lane of board.lanes) {
      const slot = lane.slots.find((candidate) => candidate.bookingId === selectedId);
      if (slot !== undefined) return { slot, room: lane.room };
    }
    return null;
  }, [wall, selectedId, board]);
  // Beside the sheet the panel is always in view: it starts the slot from
  // its top. Under its room the slot is brought into view once.
  const openedId = selected?.slot.bookingId ?? null;
  useEffect(() => {
    if (openedId === null) return;
    if (beside) {
      const body = panelRef.current;
      if (body !== null && typeof body.scrollTo === "function") body.scrollTo({ top: 0 });
      return;
    }
    const panel = detailRef.current;
    if (panel !== null && typeof panel.scrollIntoView === "function") panel.scrollIntoView({ block: "nearest" });
  }, [openedId, beside]);
  const openSlot = useCallback((bookingId: string | null): void => {
    if (wall) return;
    setSelectedId((current) => (bookingId === null ? current : bookingId === current ? null : bookingId));
  }, [wall]);
  // A request on the rail belongs to today: reach it from whichever day is
  // on screen.
  const openRequest = useCallback((bookingId: string | null): void => {
    if (wall || bookingId === null) return;
    setSelectedDate(null);
    setSelectedId(bookingId);
  }, [wall]);

  const zone = useMemo(() => zoneNote(timeZone, deviceZone()), [timeZone]);
  const days = useMemo(() => lanes.map(roomDay), [lanes]);
  const busyLanes = lanes.filter((lane) => lane.slots.length > 0).length;
  // The wall shows every room in use, whatever this screen was narrowed to
  // before it became the wall: it says nothing of a filter and offers no way
  // out of one, so a filter carried onto it would hide rooms from the
  // corridor with nothing on screen to say so. (In the app the switch also
  // remounts the board under the staff shell, which drops the filter; the
  // wall does not rely on that.)
  const shownRoomId = wall ? "" : roomId;
  const shownFocus: BoardFocus = wall ? "all" : focus;
  // A room with nothing on is one name in a line, not a row to scroll past;
  // a room chosen from the list keeps its row either way, and a count on
  // the plane shows only the rooms it names. The room of an open slot stays
  // whatever the filter says, so the slot never closes under a hand that is
  // using it (a Done that takes a function out of "Live").
  const focusDays = days.filter((day) => (shownRoomId === ""
    ? day.slots.length > 0 && roomInFocus(day, shownFocus)
    : day.room.id === shownRoomId));
  const shownDays = days.filter((day) => focusDays.includes(day) || day.room.id === selected?.room.id);
  const freeRooms = shownRoomId === "" && shownFocus === "all" && busyLanes > 0 ? lanes.filter((lane) => lane.slots.length === 0).map((lane) => lane.room.name) : [];
  const readAt = readAtCorrectedMs === null ? null : formatWallTime(readAtCorrectedMs, timeZone);
  const others = live.presence.filter((person) => person.userId !== user?.id).map((person) => person.name);
  // Today the plane counts every request nobody has, as the list and the
  // sentence do; another day, those on its own bookings.
  const stages = useMemo(() => planeStages(lanes, browsingToday ? board?.unowned.length : undefined), [lanes, browsingToday, board]);
  // The rooms whose slots carry the mark, in the board's order, once each,
  // with how many changes they hold between them.
  const changedRooms = useMemo(() => lanes.flatMap((lane) => {
    const ids = new Set(lane.slots
      .filter((slot) => changedBySlot.has(slot.bookingId))
      .flatMap((slot) => (changesBySlot.get(slot.bookingId) ?? []).map((change) => change.id)));
    return ids.size === 0 ? [] : [{ room: lane.room.name, count: ids.size }];
  }), [lanes, changedBySlot, changesBySlot]);
  // The turn-rounds the rota puts nobody on setup for: today, those under
  // way or due within two hours; another day, all of them.
  const unstaffed = useMemo(
    () => unstaffedTurnRounds(lanes, crew, nowMs, browsingToday ? UNSTAFFED_HORIZON_MS : Number.POSITIVE_INFINITY),
    [lanes, crew, nowMs, browsingToday],
  );
  // Today's suppliers: who is late at the door, who is due within the hour.
  // Only from a read that stands: a failed one names nobody as late.
  const supplierArrivals = suppliers.arrivals;
  const suppliersRead = suppliers.status === "ready";
  const arrivals = useMemo(() => {
    if (!browsingToday || !suppliersRead) return undefined;
    const onBoard = new Set(lanes.flatMap((lane) => lane.slots.map((slot) => slot.bookingId)));
    return arrivalParts(arrivalNotices(supplierArrivals, onBoard, nowMs), timeZone);
  }, [browsingToday, suppliersRead, lanes, supplierArrivals, nowMs, timeZone]);
  const summary = useMemo(
    () => (board === null ? null : boardSummary({ lanes: board.lanes, unowned: board.unowned, today: browsingToday, nowMs, changed: changedRooms, unstaffed, arrivals })),
    [board, browsingToday, nowMs, changedRooms, unstaffed, arrivals],
  );

  // A venue's own account not connected to one yet is told so, as on every
  // dashboard view, rather than shown a day that can never fill.
  if (awaitsVenue(user)) {
    return (
      <DashboardLayout mainLabel="The Day Board" surface="rota">
        <VenueNotConnected title="The Day Board" consequence="there are no bookings to show" />
      </DashboardLayout>
    );
  }

  const nextAction = board !== null && browsingToday && board.nextAction.kind !== "quiet" ? board.nextAction : null;
  const nextIsUrgent = nextAction?.kind === "request" && board?.unowned[0]?.urgency === "now";
  // The shown day by name, and the greeting by the clock: "Saturday 14
  // November · Good afternoon, Elaine".
  const dayName = deskGreeting(selectedMs, null, timeZone).date;
  const greeting = deskGreeting(nowMs, user?.name ?? null, timeZone).greeting;
  // The booking the open slot's turn-round runs from (past any viewing, or a
  // talk inside an exhibition): the changeover runs from its layout to this
  // one's. A viewing sets nothing, so it has no changeover of its own.
  // (Plain arithmetic, not a hook: this sits after the board's early return.)
  const previousId = selected === null || selected.slot.kind === "viewing" ? null : selected.slot.previousBookingId;
  const previousSlot = selected === null || previousId === null
    ? null
    : lanes.find((candidate) => candidate.room.id === selected.room.id)?.slots
      .find((candidate) => candidate.bookingId === previousId) ?? null;
  // A crew kept from an earlier read says when it was read.
  const rotaReadAt = rota.readAtMs === null ? null : formatWallTime(correctedNowMs(rota.readAtMs), timeZone);
  const crewNote = rota.status === "error" && rotaReadAt !== null
    ? `As read at ${rotaReadAt}; the rota could not be read since.`
    : null;
  // The open function's panel: who is on setup for its turn-round, or, before
  // the rota's first read lands, that it is being read or could not be.
  const selectedLane = selected === null ? undefined : lanes.find((lane) => lane.room.id === selected.room.id);
  const panelCrew = selected === null || selectedLane === undefined || turnRoundFrom(selectedLane, selected.slot) === null
    ? null
    : crewOnPanel(crew.get(selected.slot.bookingId), rota);
  // A rota that could not be read is said above the rooms, as what changed
  // is, on a day with a turn-round: the crew the slots and the sentence still
  // show is as last read, and before any read they show none.
  const crewNotice = (
    <RotaNotice
      shown={rota.status === "error" && anyTurnRound(lanes)}
      readAt={rotaReadAt}
      reading={rota.reading}
      onRetry={() => { refreshRota(true); }}
      focusAfter={focusTheDay}
    />
  );
  const selectedEventId = selected?.slot.eventId ?? null;
  const selectedEntry = selectedEventId === null ? undefined : floor.byEvent.get(selectedEventId);
  const selectedLast = selectedEntry?.lastAcknowledgement ?? null;
  // A slot's Got it is its own: sent, and answered, on the slot it was pressed on.
  const selectedSurface = selected?.slot.bookingId ?? "";
  const selectedChanges = selected === null || selectedEntry === undefined
    ? null
    : {
      ...selectedEntry,
      changes: [...(changesBySlot.get(selected.slot.bookingId) ?? [])],
      // The viewer's own acknowledgement (this device's before the server
      // answers, or theirs on another) reads as theirs.
      lastAcknowledgement: selectedLast !== null && (selectedLast.byUserId === null || selectedLast.byUserId === user?.id)
        ? { ...selectedLast, by: "You" }
        : selectedLast,
    };
  const detail = selected === null ? null : (
    <div ref={detailRef} className="dayboard-detail-frame">
      <SlotDetail
        key={selected.slot.bookingId}
        slot={selected.slot}
        room={selected.room}
        venueSlug={venue.slug}
        timeZone={timeZone}
        slotRequests={slotRequestsComponent}
        observations={wall ? null : observationsApi}
        onClose={() => { setSelectedId(null); }}
        closeLabel={beside ? "Close, back to the requests" : "Close, back to the rooms"}
        changes={selectedChanges}
        nowMs={nowMs}
        onAcknowledge={selectedEventId === null || !acknowledgesChanges || selectedChanges === null
          ? null
          : () => { void floor.acknowledge(selectedSurface, selectedEventId, selectedChanges.changes.map((change) => change.id)); }}
        acknowledging={floor.sending.has(selectedSurface)}
        acknowledgeNote={floor.notes.get(selectedSurface) ?? null}
        changesUnread={floor.failedSinceMs !== null}
        previous={previousSlot}
        crew={panelCrew}
        crewNote={crewNote}
        suppliers={wall ? null : {
          arrivals: suppliers.byBooking.get(selected.slot.bookingId) ?? [],
          boardDate: shownDate,
          dayBoundaryHour,
          boundary: boundary.state,
          today: browsingToday,
          canPlan: plansSuppliers,
          canMark: marksDoor,
          actions: suppliers,
          forms: supplierForms,
        }}
      />
    </div>
  );
  const rail = board === null ? null : (
    <Rail unowned={board.unowned} today={browsingToday} onOpen={openRequest} preview={!beside} />
  );

  // Honest about how fresh the day is: the socket reconnects by itself, and
  // Refresh reads the day now. With no venue there is no socket to
  // reconnect, so nothing is said of one.
  const statusLine = venueId === null ? null : (
    <div className="dayboard-status" role="status">
      <span className={`dayboard-live-dot${live.connected ? " is-connected" : ""}`} aria-hidden="true" />
      {live.connected
        ? <span>{readAt === null ? "Live" : `Live · updated ${readAt}`}</span>
        : <>
          <span>{readAt === null ? "Reconnecting…" : `Updated ${readAt} · reconnecting…`}</span>
          <button type="button" className="dayboard-refresh" onClick={refreshDay}>Refresh</button>
        </>}
      {corrected && <span className="dayboard-corrected">Clock corrected</span>}
      {others.length > 0 && <span className="dayboard-presence">Also watching: {others.join(", ")}</span>}
    </div>
  );

  // The stale band (D3, D10): the one thing that outranks every state.
  // Every breath on the board has already stopped (data-frozen).
  const staleBand = freshness.kind === "live" ? null : (
    <div className="dayboard-stale" role="status">
      <WifiOff size={16} aria-hidden="true" />
      {freshness.kind === "offline"
        ? <span>Offline since {formatWallTime(freshness.sinceMs, timeZone)} · reconnecting. Showing the day as last read; the words still stand.</span>
        : <span>Showing the day as read at {formatWallTime(freshness.readAtMs, timeZone)}.</span>}
      <button type="button" className="dayboard-refresh" onClick={refreshDay}>Refresh</button>
    </div>
  );

  // The day in counts on the copper plane. On paper each count is a filter
  // on the rooms; on the wall nothing is pressed.
  const plane = board === null || busyLanes === 0 ? null : (
    <div className="dayboard-plane ws-plane" role="group" aria-label="The day in numbers">
      {stages.map((stage) => {
        // Said as the desks say their stages: "At risk, 2"; with what the
        // count covers that its filter cannot show, when there is any.
        const spoken = `${stage.label}, ${String(stage.count)}${stage.note === null ? "" : `, ${stage.note}`}`;
        const face = (
          <>
            <b data-focus={stage.focus} data-alert={stage.focus === "risk" && stage.count > 0 ? "true" : undefined} aria-hidden="true">{String(stage.count)}</b>
            <span aria-hidden="true"><i className="dayboard-stage-dot" data-focus={stage.focus} />{stage.label}</span>
            {stage.note !== null && <small className="dayboard-stage-note" aria-hidden="true">{stage.note}</small>}
          </>
        );
        return wall
          ? <span key={stage.focus} className="dayboard-stage" data-focus={stage.focus} role="group" aria-label={spoken}>{face}</span>
          : (
            <button
              key={stage.focus}
              type="button"
              className="dayboard-stage"
              data-focus={stage.focus}
              aria-label={spoken}
              aria-pressed={stage.focus === "all" ? focus === "all" && roomId === "" : focus === stage.focus}
              onClick={() => { chooseFocus(stage.focus); }}
            >
              {face}
            </button>
          );
      })}
    </div>
  );

  const notices = (
    <>
      {venueId === null && <p className="dayboard-notice">No venue is linked to this account. Ask your venue administrator to connect your workspace.</p>}
      {venueId !== null && data === null && status === "loading" && <ActivityStatus variant="panel">Loading the day’s bookings…</ActivityStatus>}
      {venueId !== null && isRefreshing && <ActivityStatus>Refreshing the day’s bookings…</ActivityStatus>}
      {status === "error" ? (
        <div className="dayboard-notice" role="alert">
          <p>{error ?? "The board could not load."}</p>
          <button type="button" className="dayboard-button" onClick={refreshDay}>
            Try again
          </button>
        </div>
      ) : null}
      {/* A refresh that did not land keeps the day on screen and says from when. */}
      {refreshFailedCorrectedMs !== null ? (
        <div className="dayboard-notice" role="status">
          <p>{dayRefreshFailed(formatWallTime(refreshFailedCorrectedMs, timeZone), readAt)}</p>
          <button type="button" className="dayboard-button" onClick={refreshDay}>
            Try again
          </button>
        </div>
      ) : null}
      {crewNotice}
      {status !== "error" && board !== null && busyLanes === 0 && shownRoomId === "" ? (
        <p className="dayboard-notice">{selectedDate === null ? "Nothing scheduled today." : "Nothing scheduled on this day."}</p>
      ) : null}
      {/* What changed could not be read: the marks stand as last read, and say so. */}
      {floor.failedSinceMs !== null ? (
        <div className="dayboard-notice" role="status">
          <p>Couldn’t read what changed since {formatWallTime(correctedNowMs(floor.failedSinceMs), timeZone)}. The board tries again each minute; the marks are as last read.</p>
          <button type="button" className="dayboard-button" onClick={floor.refresh}>Try again</button>
        </div>
      ) : null}
      {/* A function seen on this day that has left it leaves the rooms; what
          concerns the day stays here until the floor has it. */}
      <LeftTheDayList count={leftTheDay.length} focusAfter={focusTheDay}>
        {leftTheDay.map((entry) => (
          <LeftTheDay
            key={entry.eventId}
            title={entry.title}
            movedOff={entry.movedOff}
            changes={entry.changes}
            truncated={entry.truncated}
            timeZone={timeZone}
            nowMs={nowMs}
            onAcknowledge={acknowledgesChanges
              ? () => { void floor.acknowledge(entry.surface, entry.eventId, entry.changes.map((change) => change.id)); }
              : null}
            sending={floor.sending.has(entry.surface)}
            note={floor.notes.get(entry.surface) ?? null}
          />
        ))}
      </LeftTheDayList>
    </>
  );

  const rooms = board === null || shownDays.length === 0 ? null : (
    <ol className="dayboard-rooms" data-count={shownDays.length > 6 ? "many" : "few"}>
      {shownDays.map((day) => (
        <RoomRow
          key={day.room.id}
          day={day}
          view={view}
          plaque={plaque}
          nowMs={nowMs}
          venueSlug={venue.slug}
          selectedId={wall ? null : selectedId}
          onOpen={openSlot}
          wall={wall}
          frozen={frozen}
          changed={changedBySlot}
          crew={crew}
        >
          {!beside && selected !== null && selected.room.id === day.room.id ? detail : null}
        </RoomRow>
      ))}
    </ol>
  );

  // Built from the states the board draws, in the words a slot uses; then
  // the ring and the band, the second channel.
  const legend = (
    <footer className="dayboard-legend" aria-label="What the colours mean">
      {DAY_BOARD_LEGEND.map((entry) => (
        <span key={entry.tone} className={`dayboard-chip dayboard-chip-${entry.tone}`}>
          <span className="dayboard-chip-dot" aria-hidden="true" />
          <StateIcon icon={entry.icon} size={12} />
          {entry.label}
        </span>
      ))}
      {DAY_BOARD_RING_LEGEND.map((entry) => (
        <span key={entry.key} className={`dayboard-chip dayboard-chip-ring dayboard-chip-ring-${entry.key}`}>
          <StateIcon icon={entry.icon} size={12} />
          {entry.label}
        </span>
      ))}
    </footer>
  );

  const freeLine = freeRooms.length > 0 ? (
    <p className="dayboard-free">
      <span>{selectedDate === null ? "Also free today:" : "Also free this day:"}</span> {freeRooms.join(", ")}.
    </p>
  ) : null;

  if (wall) {
    // The wall is the whole screen: the shell draws no header, nav or account
    // menu for a passer-by to touch (D11, S8), only the landmark around the
    // board. The rooms sit on ivory in a forest frame.
    return (
      <DashboardLayout mainLabel="The Day Board, wall display" chrome="none">
        <div className="dayboard-wall" data-register="forest">
          <div
            className="dayboard"
            ref={boardRef}
            style={driftStyle}
            data-register="wall"
            data-layout="wall"
            data-frozen={frozen ? "true" : "false"}
          >
            {staleBand}
            <header className="dayboard-wall-head">
              <div>
                <p className="dayboard-greeting"><span className="dayboard-subtitle">{dayName}{zone === null ? "" : ` · ${zone}`}</span></p>
                <h1 className="dayboard-title">The Day Board</h1>
              </div>
              <div className="dayboard-wall-clock">
                <b>{formatWallTime(nowMs, timeZone)}</b>
                <div className="dayboard-wall-status">
                  {statusLine}
                  <p className="dayboard-wall-foot">
                    <button type="button" className="dayboard-refresh" onClick={() => { setSearchParams({}); }}>Office view</button>
                  </p>
                </div>
              </div>
            </header>
            <div className="dayboard-wall-plane">
              {plane}
              {nextAction !== null && <NextActionLine action={nextAction} urgent={nextIsUrgent} onOpen={openSlot} wall />}
            </div>
            {notices}
            {rooms}
            {freeLine}
            {legend}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const body = (
    <div
      className="dayboard"
      ref={boardRef}
      data-register="paper"
      data-layout={beside ? "desk" : phone ? "phone" : "narrow"}
      data-frozen={frozen ? "true" : "false"}
    >
      {staleBand}
      <div className={`dayboard-desk${beside ? "" : " is-single"}`} data-register="ivory">
        <section className="dayboard-sheet" aria-labelledby="dayboard-title">
          <header className="dayboard-head">
            <div className="dayboard-headline">
              <p className="dayboard-greeting">
                <span className="dayboard-subtitle">{dayName}{zone === null ? "" : ` · ${zone}`}</span>
                <span aria-hidden="true">·</span>
                <span>{greeting}</span>
              </p>
              {statusLine}
            </div>
            <div className="dayboard-titleline">
              <h1 className="dayboard-title" id="dayboard-title" ref={titleRef} tabIndex={-1}>The Day Board</h1>
              <div
                className="dayboard-days"
                onPointerEnter={(event) => { if (event.pointerType !== "touch") wishToStep(); }}
                onFocus={(event) => { if (keyboardFocus(event.target)) wishToStep(); }}
              >
                <button type="button" aria-label="Previous day" onClick={() => { moveDay(-1); }}><ArrowLeft size={17} aria-hidden="true" /></button>
                <button type="button" aria-pressed={selectedDate === null} onClick={() => { setSelectedDate(null); }}>Today</button>
                <button type="button" aria-label="Next day" onClick={() => { moveDay(1); }}><ArrowRight size={17} aria-hidden="true" /></button>
                <label className="dayboard-day-field">
                  <span className="dayboard-sr">Day</span>
                  <input type="date" value={shownDate} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value === today ? null : event.target.value); }} />
                </label>
              </div>
            </div>
            {summary !== null && <Summary parts={summary} focusRef={sentenceRef} />}
          </header>

          {nextAction !== null && <NextActionLine action={nextAction} urgent={nextIsUrgent} onOpen={openSlot} wall={false} />}

          {/* Shown only on paper (S8 item 13): the printed day names itself. */}
          <p className="dayboard-print-note">{BOARD_PRINT_COPY.note} {formatWallDay(selectedMs, timeZone)}{readAt === null ? "" : ` ${BOARD_PRINT_COPY.readAt(readAt)}`}</p>

          {plane}
          {!beside && rail}

          {notices}

          {/* The rooms, what they show and the hours across them; a room
              can be chosen on its own from the list beside. */}
          <div className="dayboard-rooms-head">
            <div className="dayboard-rooms-line">
              {board !== null && busyLanes > 0 && (
                <p className="dayboard-showing" aria-live="polite">{roomId === "" ? showingLine(focusDays.map((day) => day.room.name), focus) : "One room, chosen from the list"}</p>
              )}
              <label className="dayboard-room-field">Room<select value={roomId} onChange={(event) => { chooseRoom(event.target.value); }}><option value="">All rooms</option>{lanes.map((lane) => <option key={lane.room.id} value={lane.room.id}>{lane.room.name}</option>)}</select></label>
            </div>
            {board !== null && shownDays.length > 0 && <Scale ticks={ticks} plaque={plaque} nowMs={nowMs} timeZone={timeZone} />}
          </div>
          {rooms}
          {freeLine}

          {/* What the board does besides showing the day: the Diary, the
              room plans, the wall, paper, sound, the shift and alerts. */}
          <div className="dayboard-tools">
            <Link to="/diary">Open Diary</Link>
            <Link to="/hallkeeper/rooms">Room plans</Link>
            <button type="button" onClick={() => { setSearchParams({ register: "wall" }); }}>Wall display</button>
            <button type="button" className="dayboard-print" onClick={() => { window.print(); }}>{selectedDate === null ? BOARD_PRINT_COPY.print : BOARD_PRINT_COPY.printDay}</button>
            {/* Opt-in, per device (D3 "Sound"): the one control that makes a sound. */}
            {venueId !== null && <ChimeToggle />}
            {venueId !== null && <ShiftHandover venueId={venueId} meId={user?.id ?? null} />}
            {venueId !== null && <PushAlertsToggle venueId={venueId} deviceKind={device} />}
          </div>
          {legend}
        </section>

        {beside && (
          <div className="dayboard-panel" data-register="forest">
            <div className="dayboard-panel-body" ref={panelRef}>{detail ?? rail}</div>
          </div>
        )}
      </div>
    </div>
  );

  return <DashboardLayout mainLabel="The Day Board" surface="desk">{body}</DashboardLayout>;
}

export default DayBoardPage;
