import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import { boardRange, formatWallDay, formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { useCalendar } from "../diary/hooks/useCalendar.js";
import { useDiaryLive } from "../diary/hooks/useDiaryLive.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { deriveDayBoard, type DayBoardSlot } from "./lib/day-board-state.js";
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
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 30_000;

/** All cadences (4s, 3s, 2s, 1.5s) divide 60s, so anchoring every animation
 *  to a shared origin phase-locks each cadence family. Computed once per
 *  mount — changing it would restart every animation. */
function epochDelaySeconds(): number {
  return -(Date.now() / 1000) % 60;
}

function SlotCard({ slot }: { readonly slot: DayBoardSlot }): ReactElement {
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
          <strong>{phase.name}</strong><span>{formatWallTime(Date.parse(phase.startsAt))} – {formatWallTime(Date.parse(phase.endsAt))}</span>
        </li>)}
      </ol>}
      {slot.eventId !== null && <Link className="dayboard-open-event" to={`/ops/events/${slot.eventId}`}>Open event &amp; working documents →</Link>}
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

export function DayBoardPage(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;

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
  const selectedMs = selectedDate === null ? nowMs : wallInputToMs(`${selectedDate}T12:00`) ?? nowMs;
  const range = useMemo(() => boardRange(selectedMs, "day"), [selectedMs]);
  const { data, status, error, refetch } = useCalendar(venueId, range);
  const live = useDiaryLive(venueId !== null, refetch);

  const board = useMemo(
    () => (data === null ? null : deriveDayBoard(data, nowMs)),
    [data, nowMs],
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
            <p className="dayboard-subtitle">{formatWallDay(selectedMs)} · Europe/London</p>
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
          <label>Day<input type="date" value={msToWallInput(selectedMs).slice(0, 10)} onChange={(event) => { if (event.target.value !== "") setSelectedDate(event.target.value); }} /></label>
          <button type="button" onClick={() => { setSelectedDate(null); }}>Today</button>
          <label>Room<select value={roomId} onChange={(event) => { setRoomId(event.target.value); }}><option value="">All rooms</option>{(board?.lanes ?? []).map((lane) => <option key={lane.room.id} value={lane.room.id}>{lane.room.name}</option>)}</select></label>
          <Link to="/diary">Open Diary</Link><Link to="/hallkeeper/walkthrough">Workflow walkthrough</Link>
        </div>
        {venueId === null && <p className="dayboard-notice">No venue is linked to this account. Ask your venue administrator to connect your workspace.</p>}
        {status === "loading" && <ActivityStatus variant="panel">Loading the day’s bookings…</ActivityStatus>}

        {status === "error" ? (
          <div className="dayboard-notice" role="alert">
            <p>{error ?? "The board could not load."}</p>
            <button type="button" className="diary-button" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : null}

        {status !== "error" && board !== null && busyLanes === 0 ? (
          <p className="dayboard-notice">{selectedDate === null ? "Nothing in the diary today. A quiet house." : "Nothing in the diary on this day."}</p>
        ) : null}

        <div className="dayboard-lanes">
          {(board?.lanes ?? []).filter((lane) => roomId === "" || roomId === lane.room.id).map((lane) => (
            <section key={lane.room.id} className="dayboard-lane" aria-label={lane.room.name}>
              <h2 className="dayboard-lane-title">{lane.room.name}</h2>
              {lane.slots.length === 0 ? (
                <p className="dayboard-lane-empty">Nothing scheduled.</p>
              ) : (
                lane.slots.map((slot) => <SlotCard key={slot.bookingId} slot={slot} />)
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
