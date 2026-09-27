import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { occasionLabel, type HallkeeperSheetSummary } from "@omnitwin/types";
import { getSheetSummary } from "../../api/hallkeeper-summary.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { boardRange, formatWallDay, formatWallTime, msToWallInput, shiftRange, wallInputToMs } from "../diary/lib/board-time.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { resolveEventLinkedLayouts, type LinkedLayoutChoice } from "../../lib/event-linked-layouts.js";
import { DAY_BOARD_LEGEND, deriveDayBoard, type DayBoardSlot, type DayBoardState } from "./lib/day-board-state.js";
import { describeSlotSheet, sheetProgressLine, type SlotSheetState } from "./lib/day-board-sheet.js";
import { useVenueTimezone } from "./lib/use-venue-timezone.js";
import { deviceZone, zoneNote } from "../../components/hallkeeper/sheet-facts.js";
import {
  DayBoardSlotRequestsContext,
  type SlotRequestsComponent,
  type SlotRequestsProps,
} from "./lib/slot-requests-contract.js";
import "../../styles/hallkeeper-register.css";
import "./day-board.css";

// ---------------------------------------------------------------------------
// The Day Board (Day Board S1; docs/plan/hallkeeper-day-board-plan.md) —
// the hallkeeper's live view of today. A pure projection of GET /calendar
// through deriveDayBoard plus one shared clock; live updates arrive over the
// existing /ws/diary channel (any committed diary change refetches — the
// snapshot doctrine, never trusted deltas).
//
// Motion contract (roadmap N4): nothing on the board moves but one 320 ms
// stamp on a slot's chip when that room's state moves on, never on first
// drawing and never under reduced motion. A board watched all day must not
// keep something moving in the corner of the eye; the words carry the state.
// The clock ticks state at 30s granularity.
//
// Two things a slot carries beyond its own state (Ship Friday, lines 20-21):
//   - the door to the room's setup sheet, resolved from the booking's event
//     rather than from a compiled handoff pack (see lib/day-board-sheet.ts);
//   - a <SlotRequests> mount point owned by the conversation lane. This page
//     never fetches or renders request state itself; it only reserves the
//     place on the card and hands over the slot's identity.
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 30_000;
const DAY_MS = 86_400_000;

/** A calendar day on either side of `date` (YYYY-MM-DD), as the same form. */
function stepDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Keys that move the day are the board's own only when no field holds focus. */
function typingInto(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

// The <SlotRequests> mount point: its contract lives in
// ./lib/slot-requests-contract.ts and is re-exported here, where Lane 9's
// documented import points.
export { DayBoardSlotRequestsContext };
export type { SlotRequestsComponent, SlotRequestsProps };

interface SlotSheetResult {
  readonly status: "loading" | "ready" | "error";
  readonly state: SlotSheetState | null;
  readonly error: string | null;
}

/**
 * Resolve the slot's setup-sheet door. One resolution per event+room; the
 * `isCurrent` guard is the same superseded-request discipline the planner
 * bootstrap uses, so a board that rolls over midnight (or a room filter
 * change) can never paint a stale room's layouts onto a slot.
 */
function useSlotSheet(eventId: string | null, roomSlug: string, roomName: string): SlotSheetResult {
  const [layouts, setLayouts] = useState<readonly LinkedLayoutChoice[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId === null) {
      setLayouts([]);
      setUnavailable(0);
      setError(null);
      return;
    }
    let current = true;
    setLayouts(null);
    setError(null);
    void resolveEventLinkedLayouts({ eventId, spaceSlug: roomSlug, isCurrent: () => current })
      .then((resolved) => {
        if (!current) return;
        setLayouts(resolved.layouts);
        setUnavailable(resolved.unavailableCount);
      })
      .catch(() => {
        if (!current) return;
        setError("The setup sheet link could not be checked.");
      });
    return () => { current = false; };
  }, [eventId, roomSlug]);

  if (error !== null) return { status: "error", state: null, error };
  if (layouts === null) return { status: "loading", state: null, error: null };
  return {
    status: "ready",
    state: describeSlotSheet({ eventId, roomName, layouts, unavailableCount: unavailable }),
    error: null,
  };
}

const SUMMARY_REFRESH_MS = 60_000;

/**
 * A sheet's ready-by time and rows checked, read now and each minute while
 * the board is in view. A failed read keeps the last line it had; before any
 * read lands there is no line at all, rather than a guess.
 */
function useSheetSummary(configId: string, eventId: string | null): HallkeeperSheetSummary | null {
  const key = `${configId}:${eventId ?? ""}`;
  const [summary, setSummary] = useState<{ readonly key: string; readonly value: HallkeeperSheetSummary } | null>(null);
  useEffect(() => {
    let reading: AbortController | null = null;
    const read = (): void => {
      if (typeof document !== "undefined" && document.hidden) return;
      reading?.abort();
      const current = new AbortController();
      reading = current;
      void getSheetSummary(configId, eventId, current.signal)
        .then((value) => { if (!current.signal.aborted) setSummary({ key, value }); })
        .catch(() => {
          // Keep the last line; the next minute reads again.
        });
    };
    read();
    const timer = window.setInterval(read, SUMMARY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      reading?.abort();
    };
  }, [configId, eventId, key]);
  return summary?.key === key ? summary.value : null;
}

/** Under the sheet's door: "Ready by 16:00 · 12 of 43 checked", with a thin
 *  bar that turns sage when every row is checked. */
function SheetProgress({ configId, eventId, timeZone }: {
  readonly configId: string;
  readonly eventId: string | null;
  readonly timeZone: string;
}): ReactElement | null {
  const summary = useSheetSummary(configId, eventId);
  if (summary === null) return null;
  const complete = summary.total > 0 && summary.checked === summary.total;
  return (
    <p className={`dayboard-slot-progress${complete ? " is-complete" : ""}`}>
      <span className="dayboard-slot-progress-words">
        {complete && <Check size={14} aria-hidden="true" />}
        {sheetProgressLine(summary, timeZone)}
      </span>
      {summary.total > 0 && (
        <span className="dayboard-slot-progress-bar" aria-hidden="true">
          <span style={{ width: `${String(Math.round(summary.checked / summary.total * 100))}%` }} />
        </span>
      )}
    </p>
  );
}

function SlotSheetLink({ eventId, roomSlug, roomName, timeZone }: {
  readonly eventId: string | null;
  readonly roomSlug: string;
  readonly roomName: string;
  readonly timeZone: string;
}): ReactElement {
  const result = useSlotSheet(eventId, roomSlug, roomName);

  if (result.status === "loading") {
    return (
      <div className="dayboard-slot-sheet">
        <ActivityStatus>Finding this room’s setup sheet…</ActivityStatus>
      </div>
    );
  }

  if (result.status === "error" || result.state === null) {
    return (
      <div className="dayboard-slot-sheet">
        <p className="dayboard-slot-sheet-note">{result.error ?? "The setup sheet link could not be checked."}</p>
      </div>
    );
  }

  const state = result.state;
  return (
    <div className="dayboard-slot-sheet">
      {state.kind === "one" && (
        <>
          <Link className="dayboard-open-sheet" to={state.href}>
            {state.label}<span className="dayboard-slot-sheet-layout">{state.layoutName}</span>
          </Link>
          <SheetProgress configId={state.configurationId} eventId={state.eventId} timeZone={timeZone} />
        </>
      )}
      {state.kind === "many" && (
        <>
          <p className="dayboard-slot-sheet-note">{roomName} has more than one linked layout.</p>
          <ul className="dayboard-sheet-choices">
            {state.choices.map((choice) => (
              <li key={choice.configurationId}>
                <Link className="dayboard-open-sheet" to={choice.href}>{choice.name}</Link>
                <SheetProgress configId={choice.configurationId} eventId={state.eventId} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </>
      )}
      {(state.kind === "no-event" || state.kind === "no-layout") && (
        <>
          <p className="dayboard-slot-sheet-note">{state.message}</p>
          {state.kind === "no-layout"
            ? <Link className="dayboard-open-event" to={`/ops/events/${state.eventId}`}>{state.nextAction}</Link>
            : <Link className="dayboard-open-event" to="/diary">{state.nextAction}</Link>}
        </>
      )}
    </div>
  );
}

function SlotCard({ slot, room, timeZone, slotRequests: SlotRequests, stamped }: {
  readonly slot: DayBoardSlot;
  readonly room: { readonly id: string; readonly name: string; readonly slug: string };
  readonly timeZone: string;
  readonly slotRequests: SlotRequestsComponent | null;
  /** The room's state moved on since the board last drew it. */
  readonly stamped: boolean;
}): ReactElement {
  return (
    <article
      className={`dayboard-slot dayboard-tone-${slot.tone}`}
      data-state={slot.state}
    >
      <div className="dayboard-slot-head">
        <span className="dayboard-slot-time">{slot.timeRange}</span>
        {/* A new key plays the stamp once, as the Enquiries desk's chips do. */}
        <span key={stamped ? slot.state : "still"} className={`dayboard-chip dayboard-chip-${slot.tone}${stamped ? " is-stamped" : ""}`}>
          <span className="dayboard-chip-dot" aria-hidden="true" />
          {slot.countdown}
        </span>
      </div>
      <h3 className="dayboard-slot-title">{slot.title}</h3>
      <p className="dayboard-slot-meta">
        <span className="dayboard-slot-state">{slot.stateLabel}</span>
        {occasionLabel(slot.eventType) !== null ? <span> · {occasionLabel(slot.eventType)}</span> : null}
      </p>
      <p className="dayboard-slot-meta">{slot.bookingLabel}{slot.guestCount !== null ? ` · ${String(slot.guestCount)} guests` : ""}</p>
      {slot.phases.length > 0 && <ol className="dayboard-phases" aria-label="Planned event phases">
        {slot.phases.map((phase, index) => <li key={phase.id} data-colour={index % 6}>
          <strong>{phase.name}</strong><span>{formatWallTime(Date.parse(phase.startsAt), timeZone)} – {formatWallTime(Date.parse(phase.endsAt), timeZone)}</span>
        </li>)}
      </ol>}
      <SlotSheetLink eventId={slot.eventId} roomSlug={room.slug} roomName={room.name} timeZone={timeZone} />
      {slot.eventId !== null && <Link className="dayboard-open-event" to={`/ops/events/${slot.eventId}`}>Open event &amp; working documents →</Link>}
      {/* Lane 9's mount point. Reserved region, props only; the board never
          reads or writes request state. */}
      <div className="dayboard-slot-requests" data-slot-requests={slot.bookingId}>
        {SlotRequests !== null && (
          <SlotRequests
            bookingId={slot.bookingId}
            eventId={slot.eventId}
            roomId={room.id}
            roomName={room.name}
            startsAtMs={slot.startsAtMs}
            endsAtMs={slot.endsAtMs}
          />
        )}
      </div>
      {slot.exceptionDetail !== null ? (
        <p className="dayboard-slot-alert" role="alert">
          {slot.exceptionDetail}
        </p>
      ) : null}
      {slot.turnaroundWarning !== null ? (
        <p className="dayboard-slot-warning">{slot.turnaroundWarning}</p>
      ) : null}
    </article>
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
  const timeZone = useVenueTimezone(venueId);
  const contextSlotRequests = useContext(DayBoardSlotRequestsContext);
  const slotRequestsComponent = slotRequests ?? contextSlotRequests;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Today, venue-local; the range re-derives when the clock crosses
  // midnight, so an always-on wall tablet rolls to the new day by itself.
  const selectedMs = selectedDate === null ? nowMs : wallInputToMs(`${selectedDate}T12:00`, timeZone) ?? nowMs;
  const range = useMemo(() => boardRange(selectedMs, "day", timeZone), [selectedMs, timeZone]);
  // The days either side are read once this one is on screen, so ← and →
  // show them at once. A day shown from that read is read again on arrival
  // and replaced by what the new read says, as the Diary's ranges are.
  const neighbours = useMemo(() => [shiftRange(range, 1, timeZone), shiftRange(range, -1, timeZone)], [range, timeZone]);
  const { data, status, error, refetch, isRefreshing, refreshFailedAtMs, readAtMs } = useCalendar(venueId, range, neighbours);
  const live = useDiaryLive(venueId !== null, refetch);
  const shownDate = msToWallInput(selectedMs, timeZone).slice(0, 10);
  const today = msToWallInput(nowMs, timeZone).slice(0, 10);

  const board = useMemo(
    () => (data === null ? null : deriveDayBoard(data, nowMs, timeZone)),
    [data, nowMs, timeZone],
  );

  // ← Today → (roadmap N4): tomorrow's rooms are a key away, not a picker.
  // The keys are the board's while focus rests on it or on nothing: a menu
  // in the header keeps its own arrows.
  const boardRef = useRef<HTMLDivElement>(null);
  const moveDay = useCallback((days: number): void => {
    const next = stepDay(shownDate, days);
    setSelectedDate(next === today ? null : next);
  }, [shownDate, today]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      const onBoard = event.target === document.body || (event.target instanceof Node && boardRef.current?.contains(event.target) === true);
      if (!onBoard) return;
      if (event.key === "ArrowLeft") moveDay(-1);
      else if (event.key === "ArrowRight") moveDay(1);
      else if (event.key === "t") setSelectedDate(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [moveDay]);

  // A slot whose room moved on since the last drawing plays one stamp; the
  // first drawing of a day is still. Worked out once per board, so a render
  // for anything else (a neighbouring day's read landing) cannot cut it short.
  const drawn = useRef(new Map<string, DayBoardState>());
  const moved = useMemo(() => {
    const changed = new Set<string>();
    for (const lane of board?.lanes ?? []) {
      for (const slot of lane.slots) {
        const before = drawn.current.get(slot.bookingId);
        if (before !== undefined && before !== slot.state) changed.add(slot.bookingId);
      }
    }
    return changed;
  }, [board]);
  useEffect(() => {
    for (const lane of board?.lanes ?? []) {
      for (const slot of lane.slots) drawn.current.set(slot.bookingId, slot.state);
    }
  }, [board]);

  const zone = useMemo(() => zoneNote(timeZone, deviceZone()), [timeZone]);
  const busyLanes = board?.lanes.filter((lane) => lane.slots.length > 0).length ?? 0;
  // A room with nothing on is one name in a line, not a lane to scroll past;
  // a room chosen from the filter keeps its lane either way.
  const shownLanes = (board?.lanes ?? []).filter((lane) => (roomId === "" ? lane.slots.length > 0 : lane.room.id === roomId));
  const freeRooms = roomId === "" && busyLanes > 0 ? (board?.lanes ?? []).filter((lane) => lane.slots.length === 0).map((lane) => lane.room.name) : [];
  const readAt = readAtMs === null ? null : formatWallTime(readAtMs, timeZone);

  return (
    <DashboardLayout mainLabel="The Day Board">
      <div className="dayboard" ref={boardRef}>
        <header className="dayboard-header">
          <div>
            <h1 className="dayboard-title">The Day Board</h1>
            <p className="dayboard-subtitle">{formatWallDay(selectedMs, timeZone)}{zone === null ? "" : ` · ${zone}`}</p>
          </div>
          {/* Honest about how fresh the day is: the socket reconnects by
              itself, and Refresh reads the day now. */}
          <div className="dayboard-status" role="status">
            <span
              className={`dayboard-live-dot${live.connected ? " is-connected" : ""}`}
              aria-hidden="true"
            />
            {live.connected
              ? <span>{readAt === null ? "Live" : `Live · updated ${readAt}`}</span>
              : <>
                <span>{readAt === null ? "Reconnecting…" : `Updated ${readAt} · reconnecting…`}</span>
                {venueId !== null && <button type="button" className="dayboard-refresh" onClick={refetch}>Refresh</button>}
              </>}
          </div>
        </header>
        <div className="dayboard-controls">
          <div className="dayboard-days">
            <button type="button" aria-label="Previous day" onClick={() => { moveDay(-1); }}><ArrowLeft size={18} aria-hidden="true" /></button>
            <label className="dayboard-day-field">Day<input type="date" value={shownDate} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value === today ? null : event.target.value); }} /></label>
            <button type="button" aria-pressed={selectedDate === null} onClick={() => { setSelectedDate(null); }}>Today</button>
            <button type="button" aria-label="Next day" onClick={() => { moveDay(1); }}><ArrowRight size={18} aria-hidden="true" /></button>
          </div>
          <label>Room<select value={roomId} onChange={(event) => { setRoomId(event.target.value); }}><option value="">All rooms</option>{(board?.lanes ?? []).map((lane) => <option key={lane.room.id} value={lane.room.id}>{lane.room.name}</option>)}</select></label>
          <Link to="/diary">Open Diary</Link><Link to="/hallkeeper/rooms">Room plans</Link>
        </div>
        {venueId === null && <p className="dayboard-notice">No venue is linked to this account. Ask your venue administrator to connect your workspace.</p>}
        {venueId !== null && data === null && status === "loading" && <ActivityStatus variant="panel">Loading the day’s bookings…</ActivityStatus>}
        {venueId !== null && isRefreshing && <ActivityStatus>Refreshing the day’s bookings…</ActivityStatus>}

        {status === "error" ? (
          <div className="dayboard-notice" role="alert">
            <p>{error ?? "The board could not load."}</p>
            <button type="button" className="diary-button" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : null}
        {/* A refresh that did not land keeps the day on screen and says from when. */}
        {refreshFailedAtMs !== null ? (
          <div className="dayboard-notice" role="status">
            <p>{dayRefreshFailed(formatWallTime(refreshFailedAtMs, timeZone), readAt)}</p>
            <button type="button" className="diary-button" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : null}

        {status !== "error" && board !== null && busyLanes === 0 && roomId === "" ? (
          <p className="dayboard-notice">{selectedDate === null ? "Nothing scheduled today." : "Nothing scheduled on this day."}</p>
        ) : null}

        <div className="dayboard-lanes">
          {shownLanes.map((lane) => (
            <section key={lane.room.id} className="dayboard-lane" aria-label={lane.room.name}>
              <h2 className="dayboard-lane-title">{lane.room.name}</h2>
              {lane.slots.length === 0 ? (
                <p className="dayboard-lane-empty">Nothing scheduled.</p>
              ) : (
                lane.slots.map((slot) => (
                  <SlotCard
                    key={slot.bookingId}
                    slot={slot}
                    room={lane.room}
                    timeZone={timeZone}
                    slotRequests={slotRequestsComponent}
                    stamped={moved.has(slot.bookingId)}
                  />
                ))
              )}
            </section>
          ))}
        </div>
        {freeRooms.length > 0 && <p className="dayboard-free">
          <span>{selectedDate === null ? "Also free today:" : "Also free this day:"}</span> {freeRooms.join(", ")}.
        </p>}

        {/* Built from the states the board draws, in the words a slot uses. */}
        <footer className="dayboard-legend" aria-label="What the colours mean">
          {DAY_BOARD_LEGEND.map((entry) => (
            <span key={entry.tone} className={`dayboard-chip dayboard-chip-${entry.tone}`}>
              <span className="dayboard-chip-dot" aria-hidden="true" />
              {entry.label}
            </span>
          ))}
        </footer>
      </div>
    </DashboardLayout>
  );
}

export default DayBoardPage;
