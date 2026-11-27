import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bell, Clock, WifiOff } from "lucide-react";
import { useAuthStore } from "../../stores/auth-store.js";
import { formatWallDay, formatWallTime, msToWallInput, shiftRange, wallInputToMs, type BoardRange } from "../diary/lib/board-time.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { CALENDAR_REUSE_MS, useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { VenueNotConnected } from "../../components/dashboard/VenueNotConnected.js";
import { deskGreeting } from "../../components/dashboard/enquiries/enquiry-desk-format.js";
import { awaitsVenue } from "../../lib/role-capabilities.js";
import { clockIsCorrected, correctedNowMs, subscribeClock } from "../../lib/clock-offset.js";
import { mayTakeRequest, projectRequest, stepWords, useSlotRequests } from "../../components/requests/requests-context.js";
import { listensForFloorRequests } from "../../lib/requests-live.js";
import { useSlotObservations } from "./lib/use-slot-observations.js";
import { ChimeToggle } from "../../components/requests/ChimeToggle.js";
import { ShiftHandover } from "../../components/requests/ShiftHandover.js";
import { PushAlertsToggle } from "../../components/requests/PushAlertsToggle.js";
import {
  DAY_BOARD_LEGEND,
  DAY_BOARD_RING_LEGEND,
  REQUEST_PULSE_WINDOW_MS,
  deriveDayBoard,
  type DayBoardLane,
  type NextAction,
  type UnownedRequest,
} from "./lib/day-board-state.js";
import {
  boardSummary,
  dayCounts,
  roomDay,
  roomInFocus,
  showingLine,
  type BoardFocus,
  type DayCount,
  type SummaryPart,
} from "./lib/day-board-rooms.js";
import { boardFreshness, useBoardClock, useBreathPhase, useConnectionState } from "./lib/use-board-clock.js";
import { useVenueClock } from "./lib/use-venue-timezone.js";
import { deviceZone, zoneNote } from "../../components/hallkeeper/sheet-facts.js";
import { boardDayAnchorMs, boardDayRange, useDayBoundaryHour } from "./lib/board-day.js";
import { useWakeLock } from "./lib/use-wake-lock.js";
import { driftOffset } from "./lib/burn-in-drift.js";
import { RoomCard, StateIcon, roomAnchor } from "./DayBoardRooms.js";
import { SlotDetail } from "./DayBoardSlotDetail.js";
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
// view of today, the sentence first (direction A, chosen 22 November 2026,
// T-753). A pure projection of GET /calendar and the venue's open requests
// through deriveDayBoard, on one corrected clock; live updates arrive over
// /ws/diary (any committed change refetches: the snapshot doctrine, never
// trusted deltas).
//
// The composition, in the desks' register: on the ivory sheet an overline
// with the day and the venue's time, the day controls and how fresh the day
// is beside it; the day's sentence as the headline; this hallkeeper's next
// action with Take it when it is a request they may take; one quiet line of
// counts, each a filter on the rooms; then a card per room, in the venue's
// order, two to a row, each with the room pictured empty, what it is doing
// now, the function, why it is at risk, what comes then, and All of today
// for every other slot. The forest panel beside the sheet holds the requests
// nobody has, or the slot a tap opened. Narrower screens put the requests
// above the rooms and unfold an opened slot under its own room. The wall
// (`?register=wall`) frames the cards on forest, says the counts and the
// next action in words, and opens nothing (D11).
//
// Motion is the attention system (D3): a breath on the dot as the room's
// moment approaches, live's ink ring breathing as the room's heartbeat and
// the proof the display is alive, and a copper halo round the next action
// while it is a request nobody owns. All of it is CSS on opacity and
// transform. Each breath samples its own epoch phase the moment it begins
// (useBreathPhase), so every screen breathes on the venue's minute grid, and
// every breath stops the instant the connection drops. State ticks are
// boundary-exact (useBoardClock); nothing polls.
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
/** How many requests the panel lists before "Show all". */
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
 * A slot that moves on its room's card (the next function becoming what the
 * room is doing) is drawn afresh in its new place, and a keyboard's place on
 * it would fall to the page. It is put back. A move the person made fires
 * focusout and lets the place go; a slot redrawn fires none.
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

/** A request's line on the panel; an urgent one says so in words, not only
 *  in its colour. */
function railWords(item: UnownedRequest): ReactElement {
  return (
    <span className="dayboard-rail-words">
      {item.urgency === "now" && <><strong className="dayboard-rail-flag">Urgent</strong>{" "}</>}
      <span>{item.line}</span>
    </span>
  );
}

/** The requests nobody has, today's whichever day is on screen: urgent
 *  first, then the longest wait, as the note under the heading says. The one
 *  the next action already names is not listed again. The first few show,
 *  then the rest on a press. The wall shows none of it: its band names the
 *  first. */
function Rail({ unowned, excludeId, today, onOpen }: {
  readonly unowned: readonly UnownedRequest[];
  /** The request the next action names, or null. */
  readonly excludeId: string | null;
  readonly today: boolean;
  readonly onOpen: (bookingId: string | null) => void;
}): ReactElement {
  const [all, setAll] = useState(false);
  const listed = excludeId === null ? unowned : unowned.filter((item) => item.id !== excludeId);
  const shown = all ? listed : listed.slice(0, RAIL_PREVIEW);
  const urgent = unowned.filter((item) => item.urgency === "now").length;
  const urgentListed = listed.some((item) => item.urgency === "now");
  return (
    <aside className="dayboard-rail" aria-label="Unclaimed requests" data-count={unowned.length}>
      <h2 className="dayboard-rail-title">Unclaimed requests</h2>
      <p className="dayboard-rail-count">
        <span>{unowned.length === 0 ? "Nobody is waiting." : `${String(unowned.length)} waiting`}</span>
        {urgent > 0 && <span className="dayboard-rail-urgent">{urgent === 1 ? "1 urgent" : `${String(urgent)} urgent`}</span>}
      </p>
      {listed.length > 0 && <p className="dayboard-rail-note">{urgentListed ? "urgent first, then the longest wait" : "longest wait first"}</p>}
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
      {listed.length > RAIL_PREVIEW && (
        <button type="button" className="dayboard-rail-more" aria-expanded={all} onClick={() => { setAll((open) => !open); }}>
          {all ? "Show fewer" : `Show all ${String(listed.length)}`}
        </button>
      )}
    </aside>
  );
}

/** What Take it can do for the request the next action names. */
interface TakeOffer {
  /** This person may take it now: the ladder allows it, and a handover in
   *  flight is theirs. The server decides again. */
  readonly can: boolean;
  /** The lane is moving it. */
  readonly busy: boolean;
  /** This person's press waits in the offline queue. */
  readonly waiting: boolean;
  /** Why the last press on it could not be done, or null. */
  readonly failed: string | null;
  readonly take: () => void;
}

/** This hallkeeper's next action, one line at the top, always (D7): a
 *  label ("URGENT" for an urgent request, "Take now" for any other), the
 *  words, and Take it when this person may take the request; otherwise the
 *  words open the slot. The visible line is not a live region, because its
 *  minutes tick; a hidden region says each NEW action once, assertively only
 *  when it is urgent. A request nobody has keeps the attention system's
 *  halo on the line's mark. On the wall it is words only: nothing opens
 *  there. */
function NextActionLine({ action, offer, arrived, frozen, onOpen, wall }: {
  readonly action: NextAction;
  readonly offer: TakeOffer | null;
  readonly arrived: boolean;
  readonly frozen: boolean;
  readonly onOpen: (bookingId: string | null) => void;
  readonly wall: boolean;
}): ReactElement {
  const identity = `${action.kind}:${action.requestId ?? action.bookingId ?? ""}`;
  const lineRef = useRef(action.line);
  lineRef.current = action.line;
  const [spoken, setSpoken] = useState("");
  useEffect(() => { setSpoken(lineRef.current); }, [identity]);
  const wordsId = useId();
  const level = action.kind !== "request" ? "none" : action.urgent ? "urgent" : "attention";
  // The halo's breath samples its phase the moment it begins (D3 law 1).
  const phase = useBreathPhase(`${level}|${frozen ? "frozen" : "live"}`);
  const takes = !wall && offer !== null && offer.can && !offer.busy;
  const busy = !wall && offer !== null && offer.busy;
  const opens = !wall && action.bookingId !== null && !takes && !busy;
  return (
    <>
      <div className={`dayboard-next dayboard-next-${action.kind}`} data-urgent={action.urgent ? "true" : "false"}>
        {/* Keyed to the request, so a new one remounts the mark and its one
            arrival stamp plays once. */}
        <span
          key={action.requestId ?? "steady"}
          className="dayboard-next-mark"
          data-level={level}
          data-arrived={arrived ? "true" : "false"}
          style={{ "--lt-epoch-phase-ms": String(phase) } as CSSProperties}
        >
          {action.kind === "request" ? <Bell size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
        </span>
        {action.label !== null && <strong className="dayboard-next-label">{action.label}</strong>}
        {opens
          ? <button type="button" className="dayboard-next-line" onClick={() => { onOpen(action.bookingId); }}>{action.words}</button>
          : <span className="dayboard-next-line" id={wordsId}>{action.words}</span>}
        {takes && (
          <button type="button" className="dayboard-take" aria-describedby={wordsId} onClick={offer.take}>Take it</button>
        )}
        {busy && <ActivityStatus className="dayboard-next-working">Taking it…</ActivityStatus>}
        {!wall && offer !== null && offer.waiting && !offer.busy && (
          <span className="dayboard-next-waiting">{`Waiting to send: ${stepWords({ to: "accepted" })}`}</span>
        )}
        {!wall && offer !== null && offer.failed !== null && !offer.busy && (
          <p className="dayboard-next-error" role="alert">{offer.failed}</p>
        )}
      </div>
      <span className="dayboard-announcer" role="status" aria-live={action.urgent ? "assertive" : "polite"}>{spoken}</span>
    </>
  );
}

/** The day's sentence, the headline: its counts in strong type. On a phone
 *  each room it names takes the reader to that room's card. */
function Summary({ parts, linkRooms }: { readonly parts: readonly SummaryPart[]; readonly linkRooms: boolean }): ReactElement {
  const named = (text: string, roomId: string | undefined, key: number): ReactNode => {
    if (!linkRooms || roomId === undefined) return text;
    const anchor = roomAnchor(roomId);
    return (
      <a
        key={key}
        className="dayboard-summary-room"
        href={`#${anchor}`}
        onClick={(event) => {
          event.preventDefault();
          const card = document.getElementById(anchor);
          card?.scrollIntoView({ block: "start" });
          // The reader goes where the link points: the keyboard and a screen
          // reader land on the room's card, not only the eye.
          card?.querySelector<HTMLElement>(".dayboard-room")?.focus({ preventScroll: true });
        }}
      >
        {text}
      </a>
    );
  };
  return (
    <p className="dayboard-summary">
      {/* A fixed sentence built afresh each render: its order is its identity. */}
      {parts.map((part, index) => {
        if (typeof part === "string") return part;
        if ("room" in part) return named(part.room, part.roomId, index);
        return <strong key={index} data-tone={part.tone}>{named(part.strong, part.roomId, index)}</strong>;
      })}
    </p>
  );
}

/** The day in one quiet line of counts: "2 at risk · 3 live · 1 setting up ·
 *  7 still to come". A count shows when there is something to count, or
 *  while it narrows the rooms, so it can be let go. On paper each count is a
 *  filter on the rooms; on the wall nothing is pressed. */
function Counts({ stages, focus, wall, onChoose }: {
  readonly stages: readonly DayCount[];
  readonly focus: BoardFocus;
  readonly wall: boolean;
  readonly onChoose: (focus: BoardFocus) => void;
}): ReactElement | null {
  const shown = stages.filter((stage) => stage.count > 0 || (!wall && focus === stage.focus));
  if (shown.length === 0) return null;
  return (
    <div className="dayboard-counts" role="group" aria-label="The day in numbers">
      {shown.map((stage, index) => {
        const number = String(stage.count);
        const face = (
          <>
            <i className="dayboard-count-dot" data-focus={stage.focus} aria-hidden="true" />
            <b>{number}</b>{stage.words.slice(number.length)}
          </>
        );
        return (
          <Fragment key={stage.focus}>
            {index > 0 && <span className="dayboard-count-sep" aria-hidden="true">·</span>}
            {wall
              ? <span className="dayboard-count" data-focus={stage.focus}>{face}</span>
              : (
                <button
                  type="button"
                  className="dayboard-count"
                  data-focus={stage.focus}
                  data-alert={stage.focus === "risk" && stage.count > 0 ? "true" : undefined}
                  aria-pressed={focus === stage.focus}
                  onClick={() => { onChoose(stage.focus); }}
                >
                  {face}
                </button>
              )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** What the colours mean, built from the states the board draws, in the
 *  words a slot uses; then the second channel, the request and the band. At
 *  the foot of the office board, folded until asked for; along the wall's
 *  foot, always shown, since nothing opens there. */
function Legend({ wall }: { readonly wall: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const footer = (
    <footer className="dayboard-legend" id={id} aria-label="What the colours mean" hidden={!wall && !open}>
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
  if (wall) return footer;
  return (
    <div className="dayboard-legend-fold">
      <button
        type="button"
        className="dayboard-legend-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => { setOpen((shown) => !shown); }}
      >
        What the colours mean
      </button>
      {footer}
    </div>
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
  const dayBoundaryHour = useDayBoundaryHour(venueId);
  const nowMs = useBoardClock(boundaryMs);
  const corrected = useClockCorrected();

  const [chosenDate, setSelectedDate] = useState<string | null>(null);
  const [roomId, setRoomIdState] = useState("");
  const [focus, setFocusState] = useState<BoardFocus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The wall shows today, whatever day this screen had stepped to before it
  // became the wall: it has no day controls to come back with.
  const selectedDate = wall ? null : chosenDate;
  const browsingToday = selectedDate === null;
  // A count and a room from the list are two ways to narrow the rooms;
  // choosing one lets the other go, so the list never comes up empty for a
  // reason the screen does not show.
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
  // read and a late function is on the board it belongs to.
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
  // A request on the panel belongs to today: reach it from whichever day is
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
  // A room with nothing on is one name in a line, not a card to scroll past;
  // a room chosen from the list keeps its card either way, and a count shows
  // only the rooms it names. The room of an open slot stays whatever the
  // filter says, so the slot never closes under a hand that is using it (a
  // Done that takes a function out of "live").
  const focusDays = days.filter((day) => (shownRoomId === ""
    ? day.slots.length > 0 && roomInFocus(day, shownFocus)
    : day.room.id === shownRoomId));
  const shownDays = days.filter((day) => focusDays.includes(day) || day.room.id === selected?.room.id);
  const freeRooms = shownRoomId === "" && shownFocus === "all" && busyLanes > 0 ? lanes.filter((lane) => lane.slots.length === 0).map((lane) => lane.room.name) : [];
  const readAt = readAtCorrectedMs === null ? null : formatWallTime(readAtCorrectedMs, timeZone);
  const others = live.presence.filter((person) => person.userId !== user?.id).map((person) => person.name);
  const stages = useMemo(() => dayCounts(lanes), [lanes]);
  const summary = useMemo(
    () => (board === null ? null : boardSummary({ lanes: board.lanes, unowned: board.unowned, today: browsingToday, nowMs })),
    [board, browsingToday, nowMs],
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
  // The request the next action names, from the lane's own snapshot: Take it
  // moves it there, as "I’ll do it" does on the slot.
  const nextRequest = nextAction?.kind === "request"
    ? requestsApi.requests.find((request) => request.id === nextAction.requestId) ?? null
    : null;
  const meId = user?.id ?? null;
  let offer: TakeOffer | null = null;
  if (nextRequest !== null) {
    const steps = requestsApi.waitingSteps(nextRequest.id);
    const projected = projectRequest(nextRequest, steps, meId);
    const failure = requestsApi.failure;
    offer = {
      can: mayTakeRequest(nextRequest, projected.state, meId, user?.platformRole === "admin"),
      busy: requestsApi.busyId === nextRequest.id,
      waiting: steps.some((step) => step.authorUserId === meId),
      failed: failure?.on === "request" && failure.requestId === nextRequest.id ? failure.message : null,
      take: () => { requestsApi.move(nextRequest, { to: "accepted" }); },
    };
  }
  const nextCreatedAtMs = nextAction?.kind === "request"
    ? board?.unowned.find((request) => request.id === nextAction.requestId)?.createdAtMs ?? null
    : null;
  const nextArrived = nextCreatedAtMs !== null && nowMs - nextCreatedAtMs >= 0 && nowMs - nextCreatedAtMs < REQUEST_PULSE_WINDOW_MS;
  const nextLine = nextAction === null ? null : (
    <NextActionLine action={nextAction} offer={offer} arrived={nextArrived} frozen={frozen} onOpen={openSlot} wall={wall} />
  );
  // The shown day by name: "Saturday 14 November", the overline's capitals the stylesheet's.
  const dayName = deskGreeting(selectedMs, null, timeZone).date;
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
      />
    </div>
  );
  const rail = board === null ? null : (
    <Rail unowned={board.unowned} excludeId={nextAction?.requestId ?? null} today={browsingToday} onOpen={openRequest} />
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
          <button type="button" className="dayboard-refresh" onClick={refetch}>Refresh</button>
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
      <button type="button" className="dayboard-refresh" onClick={refetch}>Refresh</button>
    </div>
  );

  const counts = board === null || busyLanes === 0 ? null : (
    <Counts stages={stages} focus={focus} wall={wall} onChoose={chooseFocus} />
  );

  const notices = (
    <>
      {venueId === null && <p className="dayboard-notice">No venue is linked to this account. Ask your venue administrator to connect your workspace.</p>}
      {venueId !== null && data === null && status === "loading" && <ActivityStatus variant="panel">Loading the day’s bookings…</ActivityStatus>}
      {venueId !== null && isRefreshing && <ActivityStatus>Refreshing the day’s bookings…</ActivityStatus>}
      {status === "error" ? (
        <div className="dayboard-notice" role="alert">
          <p>{error ?? "The board could not load."}</p>
          <button type="button" className="dayboard-button" onClick={refetch}>
            Try again
          </button>
        </div>
      ) : null}
      {/* A refresh that did not land keeps the day on screen and says from when. */}
      {refreshFailedCorrectedMs !== null ? (
        <div className="dayboard-notice" role="status">
          <p>{dayRefreshFailed(formatWallTime(refreshFailedCorrectedMs, timeZone), readAt)}</p>
          <button type="button" className="dayboard-button" onClick={refetch}>
            Try again
          </button>
        </div>
      ) : null}
      {status !== "error" && board !== null && busyLanes === 0 && shownRoomId === "" ? (
        <p className="dayboard-notice">{selectedDate === null ? "Nothing scheduled today." : "Nothing scheduled on this day."}</p>
      ) : null}
    </>
  );

  const rooms = board === null || shownDays.length === 0 ? null : (
    <ol className="dayboard-rooms" data-count={shownDays.length > 6 ? "many" : "few"}>
      {shownDays.map((day) => (
        <RoomCard
          key={day.room.id}
          day={day}
          nowMs={nowMs}
          timeZone={timeZone}
          venueSlug={venue.slug}
          today={browsingToday}
          selectedId={wall ? null : selectedId}
          onOpen={openSlot}
          wall={wall}
          frozen={frozen}
        >
          {!beside && selected !== null && selected.room.id === day.room.id ? detail : null}
        </RoomCard>
      ))}
    </ol>
  );

  const freeLine = freeRooms.length > 0 ? (
    <p className="dayboard-free">
      <span>{selectedDate === null ? "Also free today:" : "Also free this day:"}</span> {freeRooms.join(", ")}.
    </p>
  ) : null;

  // The day and, today, the venue's time: "SATURDAY 14 NOVEMBER · 14:20".
  const overline = (
    <p className="dayboard-overline">
      <span className="dayboard-subtitle">{dayName}</span>
      {browsingToday && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="dayboard-overline-time">{formatWallTime(nowMs, timeZone)}</span>
        </>
      )}
      {zone !== null && <span className="dayboard-zone"> · {zone}</span>}
    </p>
  );

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
              <div className="dayboard-wall-lead">
                {overline}
                <h1 className="dayboard-title dayboard-sr">The Day Board</h1>
                {summary !== null && <Summary parts={summary} linkRooms={false} />}
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
            {(counts !== null || nextLine !== null) && (
              <div className="dayboard-wall-band">
                {counts}
                {nextLine}
              </div>
            )}
            {notices}
            {rooms}
            {freeLine}
            <Legend wall />
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
            <div className="dayboard-overline-row">
              {overline}
              <div className="dayboard-head-tools">
                <div
                  className="dayboard-days"
                  onPointerEnter={(event) => { if (event.pointerType !== "touch") wishToStep(); }}
                  onFocus={(event) => { if (keyboardFocus(event.target)) wishToStep(); }}
                >
                  <button type="button" aria-label="Previous day" onClick={() => { moveDay(-1); }}><ArrowLeft size={16} aria-hidden="true" /></button>
                  <button type="button" aria-pressed={selectedDate === null} onClick={() => { setSelectedDate(null); }}>Today</button>
                  <button type="button" aria-label="Next day" onClick={() => { moveDay(1); }}><ArrowRight size={16} aria-hidden="true" /></button>
                  <label className="dayboard-day-field">
                    <span className="dayboard-sr">Day</span>
                    <input type="date" value={shownDate} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value === today ? null : event.target.value); }} />
                  </label>
                </div>
                {statusLine}
              </div>
            </div>
            <h1 className="dayboard-title dayboard-sr" id="dayboard-title">The Day Board</h1>
            {summary !== null && <Summary parts={summary} linkRooms={phone} />}
          </header>

          {nextLine}

          {/* Shown only on paper (S8 item 13): the printed day names itself. */}
          <p className="dayboard-print-note">{BOARD_PRINT_COPY.note} {formatWallDay(selectedMs, timeZone)}{readAt === null ? "" : ` ${BOARD_PRINT_COPY.readAt(readAt)}`}</p>

          {counts}
          {!beside && rail}

          {notices}

          {/* The rooms, and which of them the counts or the list beside show. */}
          {board !== null && busyLanes > 0 && (
            <div className="dayboard-rooms-head">
              <p className="dayboard-showing" aria-live="polite">{roomId === "" ? showingLine(focusDays.map((day) => day.room.name), focus) : "One room, chosen from the list"}</p>
              <label className="dayboard-room-field">Room<select value={roomId} onChange={(event) => { chooseRoom(event.target.value); }}><option value="">All rooms</option>{lanes.map((lane) => <option key={lane.room.id} value={lane.room.id}>{lane.room.name}</option>)}</select></label>
            </div>
          )}
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
          <Legend wall={false} />
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
