import type {
  CalendarBookingEntry,
  CalendarPhaseEntry,
  CalendarResponse,
  CalendarRoom,
  RequestKind,
  RequestState,
  RequestUrgency,
} from "@omnitwin/types";
import { VENUE_TIME_ZONE, formatWallTime } from "../../diary/lib/board-time.js";

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
/** How long after a request arrives the slot pulses. ONE pulse, then a steady
 *  dot for as long as the request is open: a room in use is never strobed. */
const REQUEST_PULSE_WINDOW_MS = 20_000;

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
  readonly eventId: string | null;
  readonly guestCount: number | null;
  readonly clientName: string | null;
  readonly phases: readonly CalendarPhaseEntry[];
  readonly title: string;
  readonly eventType: string | null;
  readonly kind: CalendarBookingEntry["kind"];
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  /** Earliest scheduled phase in this room, falling back to booking start.
   * This does not establish actual arrival or physical setup readiness. */
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
  /** Open requests made against THIS booking (Ship Friday slice 10). Empty
   *  when the board was derived without a requests input. */
  readonly requests: readonly DayBoardSlotRequest[];
  /** What the slot shows about those requests, or null when there are none —
   *  an empty slot carries no chrome at all. */
  readonly requestSignal: DayBoardRequestSignal | null;
}

// ---------------------------------------------------------------------------
// Requests on the slot (Ship Friday slice 10, gate line 22).
//
// The board already owns the arithmetic of the day; a request is one more
// thing that is true about a slot, so it is derived here rather than decided
// inside a component. The rule the plan fixes: ONE pulse when something
// arrives, then a steady coloured dot while it is open. Never a strobe, never
// a sound. A slot with nothing open gets no signal at all — null, not an
// empty badge — so the region on the card collapses to nothing.
// ---------------------------------------------------------------------------

export interface DayBoardSlotRequest {
  readonly id: string;
  readonly bookingId: string | null;
  readonly kind: RequestKind;
  readonly quantity: number | null;
  readonly urgency: RequestUrgency;
  readonly state: RequestState;
  /** ISO-8601 instant, as the API serialises it. */
  readonly createdAt: string;
}

export interface DayBoardRequestSignal {
  /** Everything not yet finished. */
  readonly openCount: number;
  /** Of those, the ones nobody has even said they have seen. */
  readonly waitingCount: number;
  /** At least one urgent request is still waiting. */
  readonly urgent: boolean;
  /** One pulse while the newest arrival is fresh, then nothing. */
  readonly motion: "pulse-once" | "none";
  /** The steady dot the slot holds while anything is open. */
  readonly dot: "copper" | "none";
  /** The reduced-motion experience: the words carry the whole meaning. */
  readonly label: string;
  readonly newestId: string | null;
  readonly newestAtMs: number | null;
}

function isOpenRequest(request: DayBoardSlotRequest): boolean {
  return request.state !== "resolved";
}

/**
 * What a slot says about its open requests at a given instant. Pure, so the
 * slab, the board and the tests all agree — and so "one pulse, then steady"
 * is a fact about time rather than a hope about a CSS class.
 */
export function deriveSlotRequestSignal(
  requests: readonly DayBoardSlotRequest[],
  nowMs: number,
): DayBoardRequestSignal | null {
  const open = requests.filter(isOpenRequest);
  if (open.length === 0) return null;

  const waiting = open.filter((request) => request.state === "sent");
  const newest = open.reduce<DayBoardSlotRequest | null>((latest, request) => {
    if (latest === null) return request;
    return Date.parse(request.createdAt) > Date.parse(latest.createdAt) ? request : latest;
  }, null);
  const newestAtMs = newest === null ? null : Date.parse(newest.createdAt);
  const fresh = newestAtMs !== null
    && nowMs - newestAtMs >= 0
    && nowMs - newestAtMs < REQUEST_PULSE_WINDOW_MS;

  const head = open.length === 1 ? "One request" : `${String(open.length)} requests`;
  const label = waiting.length === open.length
    ? `${head} waiting`
    : waiting.length === 0
      ? `${head} in hand`
      : `${head} · ${String(waiting.length)} waiting`;

  return {
    openCount: open.length,
    waitingCount: waiting.length,
    urgent: waiting.some((request) => request.urgency === "now"),
    motion: fresh ? "pulse-once" : "none",
    dot: "copper",
    label,
    newestId: newest?.id ?? null,
    newestAtMs,
  };
}

/** Group requests by the booking they were made against. A request with no
 *  booking belongs to no slot and is simply not on the board. */
export function groupRequestsByBooking(
  requests: readonly DayBoardSlotRequest[],
): ReadonlyMap<string, readonly DayBoardSlotRequest[]> {
  const byBooking = new Map<string, DayBoardSlotRequest[]>();
  for (const request of requests) {
    if (request.bookingId === null) continue;
    const list = byBooking.get(request.bookingId) ?? [];
    list.push(request);
    byBooking.set(request.bookingId, list);
  }
  return byBooking;
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
  timeZone: string,
): TimedState {
  const startsAtMs = Date.parse(booking.startsAt);
  const endsAtMs = Date.parse(booking.endsAt);

  if (nowMs >= endsAtMs) {
    return {
      state: "done",
      stateLabel: "Scheduled end passed",
      tone: "faded",
      motion: "none",
      countdown: `Booked until ${formatWallTime(endsAtMs, timeZone)}`,
    };
  }
  if (nowMs >= startsAtMs) {
    const remaining = minutesUntil(endsAtMs, nowMs);
    return {
      state: "in-progress",
      stateLabel: "In booked window",
      tone: "live",
      motion: "breathe-4s",
      countdown: `${formatDuration(remaining)} until booked end`,
    };
  }
  const doorsInMin = minutesUntil(startsAtMs, nowMs);
  if (doorsInMin <= IMMINENT_WINDOW_MIN) {
    return {
      state: "imminent",
      stateLabel: "Starting soon",
      tone: "amber-deep",
      motion: "pulse-2s",
      countdown: `Starts in ${String(doorsInMin)}m`,
    };
  }
  if (doorsInMin <= GUESTS_WINDOW_MIN) {
    return {
      state: "guests-due",
      stateLabel: "Starting shortly",
      tone: "amber",
      motion: "pulse-3s",
      countdown: `Starts in ${String(doorsInMin)}m`,
    };
  }
  const setupInMin = minutesUntil(setupStartsAtMs, nowMs);
  if (setupInMin <= ORGANISERS_WINDOW_MIN) {
    return {
      state: "organisers-due",
      stateLabel: setupStartsAtMs < startsAtMs ? "Phase scheduled" : "Upcoming",
      tone: "green",
      motion: "pulse-4s",
      countdown: setupInMin <= 0
        ? `First phase from ${formatWallTime(setupStartsAtMs, timeZone)}`
        : `${setupStartsAtMs < startsAtMs ? "First phase" : "Starts"} in ${String(setupInMin)}m`,
    };
  }
  return {
    state: "scheduled",
    stateLabel: "Scheduled",
    tone: "quiet",
    motion: "none",
    countdown: `Starts ${formatWallTime(startsAtMs, timeZone)}`,
  };
}

/** A hallkeeper preps rooms for things that are happening: ink, live holds,
 *  house blocks. The sales pipeline (prospects) and departed bookings
 *  (released/expired/cancelled/lost) never reach the board. */
function isBoardWorthy(entry: CalendarBookingEntry): boolean {
  return entry.status === "active" && entry.kind !== "prospect";
}

export function deriveDayBoard(
  response: CalendarResponse,
  nowMs: number,
  timeZone: string = VENUE_TIME_ZONE,
  /** Requests made against this venue's bookings. Optional: a board derived
   *  without them is exactly the board that existed before requests did. */
  requests: readonly DayBoardSlotRequest[] = [],
): DayBoard {
  const requestsByBooking = groupRequestsByBooking(requests);
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
          const bookingPhases = phases
            .filter(
              (candidate) =>
                candidate.eventId === entry.eventId && candidate.spaceId === entry.spaceId,
            )
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
          const setupStartsAtMs = bookingPhases.reduce(
              (earliest, candidate) => Math.min(earliest, Date.parse(candidate.startsAt)),
              startsAtMs,
            );

          const timed = deriveTimedState(entry, setupStartsAtMs, nowMs, timeZone);
          const slotRequests = (requestsByBooking.get(entry.id) ?? []).filter(isOpenRequest);
          const requestSignal = deriveSlotRequestSignal(slotRequests, nowMs);
          const blocking = blockingByBooking.get(entry.id);
          const timeRange = `${formatWallTime(startsAtMs, timeZone)} – ${formatWallTime(endsAtMs, timeZone)}`;

          const slot: DayBoardSlot =
            blocking !== undefined
              ? {
                  bookingId: entry.id,
                  roomId: room.id,
                  eventId: entry.eventId,
                  guestCount: entry.guestCount ?? null,
                  clientName: entry.clientName ?? null,
                  phases: bookingPhases,
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
                  requests: slotRequests,
                  requestSignal,
                }
              : {
                  bookingId: entry.id,
                  roomId: room.id,
                  eventId: entry.eventId,
                  guestCount: entry.guestCount ?? null,
                  clientName: entry.clientName ?? null,
                  phases: bookingPhases,
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
                  requests: slotRequests,
                  requestSignal,
                };
          return slot;
        });
      return { room, slots };
    });

  return { lanes };
}
