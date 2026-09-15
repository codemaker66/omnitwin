import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import { boardRange, formatWallDay, formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { resolveEventLinkedLayouts, type LinkedLayoutChoice } from "../../lib/event-linked-layouts.js";
import { deriveDayBoard, type DayBoardSlot } from "./lib/day-board-state.js";
import { describeSlotSheet, type SlotSheetState } from "./lib/day-board-sheet.js";
import { useVenueTimezone } from "./lib/use-venue-timezone.js";
import "../../styles/hallkeeper-register.css";
import "./day-board.css";

// ---------------------------------------------------------------------------
// The Day Board (Day Board S1; docs/plan/hallkeeper-day-board-plan.md) —
// the hallkeeper's live view of today. A pure projection of GET /calendar
// through deriveDayBoard plus one shared clock; live updates arrive over the
// existing /ws/diary channel (any committed diary change refetches — the
// snapshot doctrine, never trusted deltas).
//
// Motion contract: every pulse is CSS keyframes on transform/opacity only,
// phase-locked via a single epoch custom property set ONCE per mount — all
// slots of a cadence breathe together, which reads calm where free-running
// pulses read as noise. The clock ticks state at 30s granularity and never
// re-renders per animation frame. prefers-reduced-motion stops the pulses;
// the countdown text already carries the full meaning.
//
// Two things a slot carries beyond its own state (Ship Friday, lines 20-21):
//   - the door to the room's setup sheet, resolved from the booking's event
//     rather than from a compiled handoff pack (see lib/day-board-sheet.ts);
//   - a <SlotRequests> mount point owned by the conversation lane. This page
//     never fetches or renders request state itself; it only reserves the
//     place on the card and hands over the slot's identity.
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 30_000;

/** All cadences (4s, 3s, 2s, 1.5s) divide 60s, so anchoring every animation
 *  to a shared origin phase-locks each cadence family. Computed once per
 *  mount — changing it would restart every animation. */
function epochDelaySeconds(): number {
  return -(Date.now() / 1000) % 60;
}

// ---------------------------------------------------------------------------
// <SlotRequests> mount point (owned by Lane 9 — requests and the flashing
// slot). The Day Board reserves the region and supplies the slot's identity;
// the conversation lane supplies the component. Two ways in, so that lane
// does not need a router change to land:
//
//   1. <DayBoardSlotRequestsContext.Provider value={SlotRequests}> anywhere
//      above the board, or
//   2. <DayBoardPage slotRequests={SlotRequests} /> at the route.
//
// The prop wins when both are present. The default is null: the region
// renders nothing at all, so an unmounted lane costs no chrome and no space.
// The contract is deliberately props-only — no callbacks back into the board
// — so a request surface can never drive the board's own refetch loop.
// ---------------------------------------------------------------------------

export interface SlotRequestsProps {
  readonly bookingId: string;
  readonly eventId: string | null;
  readonly roomId: string;
  readonly roomName: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export type SlotRequestsComponent = ComponentType<SlotRequestsProps>;

export const DayBoardSlotRequestsContext = createContext<SlotRequestsComponent | null>(null);

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

function SlotSheetLink({ eventId, roomSlug, roomName }: {
  readonly eventId: string | null;
  readonly roomSlug: string;
  readonly roomName: string;
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
        <Link className="dayboard-open-sheet" to={state.href}>
          {state.label}<span className="dayboard-slot-sheet-layout">{state.layoutName}</span>
        </Link>
      )}
      {state.kind === "many" && (
        <>
          <p className="dayboard-slot-sheet-note">{roomName} has more than one linked layout.</p>
          <ul className="dayboard-sheet-choices">
            {state.choices.map((choice) => (
              <li key={choice.configurationId}>
                <Link className="dayboard-open-sheet" to={choice.href}>{choice.name}</Link>
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

function SlotCard({ slot, room, timeZone, slotRequests: SlotRequests }: {
  readonly slot: DayBoardSlot;
  readonly room: { readonly id: string; readonly name: string; readonly slug: string };
  readonly timeZone: string;
  readonly slotRequests: SlotRequestsComponent | null;
}): ReactElement {
  return (
    <article
      className={`dayboard-slot dayboard-tone-${slot.tone}`}
      data-motion={slot.motion}
      data-state={slot.state}
    >
      <div className="dayboard-slot-head">
        <span className="dayboard-slot-time">{slot.timeRange}</span>
        <span className={`dayboard-chip dayboard-chip-${slot.tone}`} data-motion={slot.motion}>
          <span className="dayboard-chip-dot" aria-hidden="true" />
          {slot.countdown}
        </span>
      </div>
      <h3 className="dayboard-slot-title">{slot.title}</h3>
      <p className="dayboard-slot-meta">
        <span className="dayboard-slot-state">{slot.stateLabel}</span>
        {slot.eventType !== null ? <span> · {slot.eventType}</span> : null}
      </p>
      <p className="dayboard-slot-meta">{slot.kind === "hold" ? "Pencilled hold" : slot.kind === "internal_block" ? "House block" : "Confirmed booking"}{slot.guestCount !== null ? ` · ${String(slot.guestCount)} guests` : ""}</p>
      {slot.phases.length > 0 && <ol className="dayboard-phases" aria-label="Planned event phases">
        {slot.phases.map((phase, index) => <li key={phase.id} data-colour={index % 6}>
          <strong>{phase.name}</strong><span>{formatWallTime(Date.parse(phase.startsAt), timeZone)} – {formatWallTime(Date.parse(phase.endsAt), timeZone)}</span>
        </li>)}
      </ol>}
      <SlotSheetLink eventId={slot.eventId} roomSlug={room.slug} roomName={room.name} />
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
  const { data, status, error, refetch, isRefreshing } = useCalendar(venueId, range);
  const live = useDiaryLive(venueId !== null, refetch);

  const board = useMemo(
    () => (data === null ? null : deriveDayBoard(data, nowMs, timeZone)),
    [data, nowMs, timeZone],
  );

  // Set once per mount: re-writing this would restart every CSS animation.
  const epochRef = useRef<number>(epochDelaySeconds());

  const busyLanes = board?.lanes.filter((lane) => lane.slots.length > 0).length ?? 0;

  return (
    <DashboardLayout mainLabel="The Day Board">
      <div
        className="dayboard"
        style={{ "--dayboard-epoch": `${String(epochRef.current)}s` } as React.CSSProperties}
      >
        <header className="dayboard-header">
          <div>
            <h1 className="dayboard-title">The Day Board</h1>
            <p className="dayboard-subtitle">{formatWallDay(selectedMs, timeZone)} · {timeZone}</p>
          </div>
          <div className="dayboard-status">
            <span
              className={`dayboard-live-dot${live.connected ? " is-connected" : ""}`}
              aria-hidden="true"
            />
            <span>{live.connected ? "Live updates" : "Live updates disconnected"}</span>
          </div>
        </header>
        <div className="dayboard-controls">
          <label>Day<input type="date" value={msToWallInput(selectedMs, timeZone).slice(0, 10)} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value); }} /></label>
          <button type="button" onClick={() => { setSelectedDate(null); }}>Today</button>
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

        {status !== "error" && board !== null && busyLanes === 0 ? (
          <p className="dayboard-notice">{selectedDate === null ? "Nothing scheduled today." : "Nothing scheduled on this day."}</p>
        ) : null}

        <div className="dayboard-lanes">
          {(board?.lanes ?? []).filter((lane) => roomId === "" || roomId === lane.room.id).map((lane) => (
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
                  />
                ))
              )}
            </section>
          ))}
        </div>

        <footer className="dayboard-legend" aria-label="What the colours mean">
          <span className="dayboard-chip dayboard-chip-green">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            First phase due
          </span>
          <span className="dayboard-chip dayboard-chip-amber">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            Booking starts soon
          </span>
          <span className="dayboard-chip dayboard-chip-live">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            Scheduled event
          </span>
          <span className="dayboard-chip dayboard-chip-red">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            Needs attention
          </span>
        </footer>
      </div>
    </DashboardLayout>
  );
}

export default DayBoardPage;
