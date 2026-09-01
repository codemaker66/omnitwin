import type {
  CalendarBookingEntry,
  CalendarPhaseEntry,
  CalendarResponse,
  CalendarRoom,
} from "@omnitwin/types";
import { formatWallTime } from "../../diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The Day Board state machine (Day Board S1; plan:
// docs/plan/hallkeeper-day-board-plan.md).
//
// One pure derivation: GET /calendar + a clock instant → per-slot state,
// tone, cadence and label copy. The page renders what this returns and CSS
// animates it; nothing visual is decided anywhere else, which is what makes
// the 60/30/10-minute boundaries and the exception priority unit-testable.
//
// Colour discipline (the design decision the plan flags): the countdown ramp
// runs green → amber → deep amber as arrival approaches, an event IN
// PROGRESS is a calm claret LIVE, and RED is reserved exclusively for
// exceptions — a changeover at risk today; overrun and urgent messages when
// later slices add their signals. A four-hour red pulse would numb the one
// colour that must always mean "look now".
//
// Labels are load-bearing: under prefers-reduced-motion the pulses stop and
// the text carries the whole meaning, and every state stays legible without
// colour (state word + countdown + wall-clock range on every slot).
// ---------------------------------------------------------------------------

const MIN_MS = 60_000;
const ORGANISERS_WINDOW_MIN = 60;
const GUESTS_WINDOW_MIN = 30;
const IMMINENT_WINDOW_MIN = 10;

export type DayBoardState =
  | "scheduled"
  | "organisers-due"
  | "guests-due"
  | "imminent"
  | "in-progress"
  | "done"
  | "exception";

export type DayBoardTone =
  | "quiet"
  | "green"
  | "amber"
  | "amber-deep"
  | "live"
  | "faded"
  | "red";

/** Cadence names only — CSS owns the keyframes, and all pulses of the same
 *  cadence are phase-locked by a shared epoch on the board root. */
export type DayBoardMotion =
  | "none"
  | "pulse-4s"
  | "pulse-3s"
  | "pulse-2s"
  | "breathe-4s"
  | "pulse-fast";

export type DayBoardException = "turnaround-at-risk" | "overrun" | "urgent-message";

export interface DayBoardSlot {
  readonly bookingId: string;
  readonly roomId: string;
  readonly title: string;
  readonly eventType: string | null;
  readonly kind: CalendarBookingEntry["kind"];
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  /** Earliest phase opening for this booking's event in this room — the
   *  moment organisers appear. Falls back to doors when no phases exist. */
  readonly setupStartsAtMs: number;
  readonly state: DayBoardState;
  readonly stateLabel: string;
  readonly tone: DayBoardTone;
  readonly motion: DayBoardMotion;
  /** The chip's countdown/status text — the reduced-motion experience. */
  readonly countdown: string;
  /** Wall-clock range, venue-local: "13:00 – 17:00". */
  readonly timeRange: string;
  readonly exception: DayBoardException | null;
  readonly exceptionDetail: string | null;
  /** A warning-grade turnaround note that does not escalate the state. */
  readonly turnaroundWarning: string | null;
}

export interface DayBoardLane {
  readonly room: CalendarRoom;
  readonly slots: readonly DayBoardSlot[];
}

export interface DayBoard {
  readonly lanes: readonly DayBoardLane[];
}

function minutesUntil(ms: number, nowMs: number): number {
  return Math.ceil((ms - nowMs) / MIN_MS);
}

function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, totalMinutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest)}m`;
}

interface TimedState {
  readonly state: DayBoardState;
  readonly stateLabel: string;
  readonly tone: DayBoardTone;
  readonly motion: DayBoardMotion;
  readonly countdown: string;
}

function deriveTimedState(
  booking: CalendarBookingEntry,
  setupStartsAtMs: number,
  nowMs: number,
): TimedState {
  const startsAtMs = Date.parse(booking.startsAt);
  const endsAtMs = Date.parse(booking.endsAt);

  if (nowMs >= endsAtMs) {
    return {
      state: "done",
      stateLabel: "Done",
      tone: "faded",
      motion: "none",
      countdown: `Ended · ${formatWallTime(endsAtMs)}`,
    };
  }
  if (nowMs >= startsAtMs) {
    const remaining = minutesUntil(endsAtMs, nowMs);
    return {
      state: "in-progress",
      stateLabel: "Live",
      tone: "live",
      motion: "breathe-4s",
      countdown: `Live · ${formatDuration(remaining)} left`,
    };
  }
  const doorsInMin = minutesUntil(startsAtMs, nowMs);
  if (doorsInMin <= IMMINENT_WINDOW_MIN) {
    return {
      state: "imminent",
      stateLabel: "Guests imminent",
      tone: "amber-deep",
      motion: "pulse-2s",
      countdown: `Guests · ${String(doorsInMin)}m`,
    };
  }
  if (doorsInMin <= GUESTS_WINDOW_MIN) {
    return {
      state: "guests-due",
      stateLabel: "Guests due",
      tone: "amber",
      motion: "pulse-3s",
      countdown: `Guests · ${String(doorsInMin)}m`,
    };
  }
  const setupInMin = minutesUntil(setupStartsAtMs, nowMs);
  if (setupInMin <= ORGANISERS_WINDOW_MIN) {
    return {
      state: "organisers-due",
      stateLabel: "Organisers due",
      tone: "green",
      motion: "pulse-4s",
      countdown: `Organisers · ${String(setupInMin)}m`,
    };
  }
  return {
    state: "scheduled",
    stateLabel: "Scheduled",
    tone: "quiet",
    motion: "none",
    countdown: `Doors · ${formatWallTime(startsAtMs)}`,
  };
}

/** A hallkeeper preps rooms for things that are happening: ink, live holds,
 *  house blocks. The sales pipeline (prospects) and departed bookings
 *  (released/expired/cancelled/lost) never reach the board. */
function isBoardWorthy(entry: CalendarBookingEntry): boolean {
  return entry.status === "active" && entry.kind !== "prospect";
}

export function deriveDayBoard(response: CalendarResponse, nowMs: number): DayBoard {
  const bookings: CalendarBookingEntry[] = [];
  const phases: CalendarPhaseEntry[] = [];
  for (const entry of response.entries) {
    if (entry.entryType === "booking") {
      if (isBoardWorthy(entry)) bookings.push(entry);
    } else {
      phases.push(entry);
    }
  }

  // Blocking turnaround conflicts flag BOTH slots of the pair; warnings ride
  // along as detail without escalating the state.
  const blockingByBooking = new Map<string, string>();
  const warningByBooking = new Map<string, string>();
  for (const conflict of response.conflicts.conflicts) {
    if (conflict.type !== "insufficient_turnaround") continue;
    const target = conflict.severity === "blocking" ? blockingByBooking : warningByBooking;
    for (const entryId of conflict.entryIds) {
      target.set(entryId, conflict.explanation);
    }
  }

  const lanes: DayBoardLane[] = [...response.rooms]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((room) => {
      const slots = bookings
        .filter((entry) => entry.spaceId === room.id)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .map((entry) => {
          const startsAtMs = Date.parse(entry.startsAt);
          const endsAtMs = Date.parse(entry.endsAt);
          const setupStartsAtMs = phases
            .filter(
              (candidate) =>
                candidate.eventId === entry.eventId && candidate.spaceId === entry.spaceId,
            )
            .reduce(
              (earliest, candidate) => Math.min(earliest, Date.parse(candidate.startsAt)),
              startsAtMs,
            );

          const timed = deriveTimedState(entry, setupStartsAtMs, nowMs);
          const blocking = blockingByBooking.get(entry.id);
          const timeRange = `${formatWallTime(startsAtMs)} – ${formatWallTime(endsAtMs)}`;

          const slot: DayBoardSlot =
            blocking !== undefined
              ? {
                  bookingId: entry.id,
                  roomId: room.id,
                  title: entry.title,
                  eventType: entry.eventType,
                  kind: entry.kind,
                  startsAtMs,
                  endsAtMs,
                  setupStartsAtMs,
                  state: "exception",
                  stateLabel: "Changeover at risk",
                  tone: "red",
                  motion: "pulse-fast",
                  countdown: timed.countdown,
                  timeRange,
                  exception: "turnaround-at-risk",
                  exceptionDetail: blocking,
                  turnaroundWarning: null,
                }
              : {
                  bookingId: entry.id,
                  roomId: room.id,
                  title: entry.title,
                  eventType: entry.eventType,
                  kind: entry.kind,
                  startsAtMs,
                  endsAtMs,
                  setupStartsAtMs,
                  state: timed.state,
                  stateLabel: timed.stateLabel,
                  tone: timed.tone,
                  motion: timed.motion,
                  countdown: timed.countdown,
                  timeRange,
                  exception: null,
                  exceptionDetail: null,
                  turnaroundWarning: warningByBooking.get(entry.id) ?? null,
                };
          return slot;
        });
      return { room, slots };
    });

  return { lanes };
}
