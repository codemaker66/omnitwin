import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useAuthStore } from "../../stores/auth-store.js";
import { boardRange, formatWallDay } from "../diary/lib/board-time.js";
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
  const range = useMemo(() => boardRange(nowMs, "day"), [nowMs]);
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
            <p className="dayboard-subtitle">{formatWallDay(nowMs)}</p>
          </div>
          <div className="dayboard-status">
            <span
              className={`dayboard-live-dot${live.connected ? " is-connected" : ""}`}
              aria-hidden="true"
            />
            <span>{live.connected ? "Live" : "Reconnecting…"}</span>
          </div>
        </header>

        {status === "error" ? (
          <div className="dayboard-notice" role="alert">
            <p>{error ?? "The board could not load."}</p>
            <button type="button" className="diary-button" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : null}

        {status !== "error" && board !== null && busyLanes === 0 ? (
          <p className="dayboard-notice">Nothing in the diary today. A quiet house.</p>
        ) : null}

        <div className="dayboard-lanes">
          {(board?.lanes ?? []).map((lane) => (
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
            Organisers due
          </span>
          <span className="dayboard-chip dayboard-chip-amber">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            Guests due
          </span>
          <span className="dayboard-chip dayboard-chip-live">
            <span className="dayboard-chip-dot" aria-hidden="true" />
            Live
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
