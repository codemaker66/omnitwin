import type {
  CalendarBookingEntry,
  CalendarPhaseEntry,
  CalendarResponse,
  CalendarRoom,
  CalendarTurnaroundRule,
  RequestKind,
  RequestState,
  RequestUrgency,
} from "@omnitwin/types";
import { describeRequestKind, isUnownedRequest } from "@omnitwin/types";
import { VENUE_TIME_ZONE, formatWallTime } from "../../diary/lib/board-time.js";
import { bookingStateLabel } from "../../diary/lib/board-overview.js";

// ---------------------------------------------------------------------------
// The Day Board state machine (Day Board S1; goal 19 S3 under D1, D3, D9).
//
// One pure derivation: GET /calendar + requests + ONE clock instant → per-slot
// state, the verb the slot reads aloud, its colour token and its motion, the
// phase segments of the slab, the dimensioned gap before it, the attention
// ring from its requests, the rooms an event spans, the next instant at which
// anything changes, the UNOWNED rail and this hallkeeper's next action. The
// page renders what this returns; nothing visual is decided anywhere else,
// which is what makes every boundary unit-testable.
//
// The law of time (D1): times exist only as Diary bookings and their phases.
// Setup is the booking's earliest phase in the room (or doors); doors is the
// booking's start; live ends at the booking's end; clear-down runs to the
// end plus the venue's turnaround rule, cut short by the next setup in the
// lane. Nothing here writes a time.
//
// The attention system (D3): Blake's palette, literally — green as the
// organisers are due, amber as the guests are, deep amber at the doors, red
// while live. Severity rides on cadence and a copper ring, never on colour
// alone; every state pairs an icon, a verb and a colour. The clock given to
// deriveDayBoard is the corrected one (D9); this module never reads Date.
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
  | "live"
  | "clear-down"
  | "done"
  | "exception";

/** The colour token a slot wears (`--lt-*` in day-board.css). */
export type DayBoardTone =
  | "quiet"
  | "green"
  | "amber"
  | "amber-deep"
  | "live"
  | "sage"
  | "faded"
  | "red";

/** The one ambient motion per state (D3). Every cadence divides 60 s, so one
 *  epoch phase-locks them all; the CSS owns the keyframes. */
export type DayBoardMotion = "none" | "breath-4s" | "breath-3s" | "breath-2s" | "live-breath";

/** The icon paired with every state, so colour never carries meaning alone. */
export type DayBoardIcon =
  | "clock" | "wrench" | "users" | "door-open" | "radio" | "rotate-ccw" | "check" | "alert-triangle"
  | "bell" | "user-check" | "wifi-off";

export type DayBoardException = "turnaround-at-risk" | "overrun" | "urgent-message";

/** The slab's four segments, as instants. */
export interface SlotSegments {
  readonly setupStartsAtMs: number;
  readonly doorsAtMs: number;
  readonly endsAtMs: number;
  readonly clearDownEndsAtMs: number;
  /** The venue's turnaround for this booking, or null when no rule covers it. */
  readonly turnaroundMinutes: number | null;
}

/** The dimensioned gap between the previous slot's end and this slot's setup. */
export interface LaneGap {
  readonly minutes: number;
  /** The turnaround the previous booking needs, or null when uncovered. */
  readonly neededMinutes: number | null;
  readonly short: boolean;
}

export type AttentionLevel = "attention" | "urgent" | "owned";

/** What the copper ring says about a slot's requests. */
export interface SlotAttention {
  readonly level: AttentionLevel;
  /** Everything still open on this slot. */
  readonly count: number;
  /** Of those, the ones nobody owns yet. */
  readonly unownedCount: number;
  /** The owner to name when every open request has one. */
  readonly ownerName: string | null;
  /** The oldest unowned request's arrival, for "waiting 3 min". */
  readonly waitingSinceMs: number | null;
  /** One 200 ms arrival stamp while the newest request is fresh. */
  readonly arrived: boolean;
}

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
  /** What kind of booking this is, in the house's words. A hold reads as the
   *  Diary reads it ("Provisional · 1st option"), through the Diary's own
   *  bookingStateLabel, so the two boards cannot word one hold two ways. */
  readonly bookingLabel: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  /** Earliest scheduled phase in this room, falling back to booking start.
   * This does not establish actual arrival or physical setup readiness. */
  readonly setupStartsAtMs: number;
  readonly segments: SlotSegments;
  readonly state: DayBoardState;
  readonly stateLabel: string;
  readonly tone: DayBoardTone;
  readonly motion: DayBoardMotion;
  readonly icon: DayBoardIcon;
  /** The verb the slot reads aloud: "Organisers · 48 min", "LIVE · 1 h 12 elapsed". */
  readonly countdown: string;
  /** Wall-clock range, venue-local: "13:00 – 17:00". */
  readonly timeRange: string;
  readonly exception: DayBoardException | null;
  readonly exceptionDetail: string | null;
  /** A warning-grade turnaround note that does not escalate the state. */
  readonly turnaroundWarning: string | null;
  readonly gapBefore: LaneGap | null;
  /** The other rooms this slot's event occupies on the same board. */
  readonly linkedRooms: readonly string[];
  /** The next instant at which this slot's state changes; null when nothing will. */
  readonly nextBoundaryMs: number | null;
  /** Open requests made against THIS booking (Ship Friday slice 10). Empty
   *  when the board was derived without a requests input. */
  readonly requests: readonly DayBoardSlotRequest[];
  /** What the slot shows about those requests, or null when there are none —
   *  an empty slot carries no chrome at all. */
  readonly requestSignal: DayBoardRequestSignal | null;
  /** The copper ring, or null when nothing is open. */
  readonly attention: SlotAttention | null;
}

// ---------------------------------------------------------------------------
// Requests on the slot (Ship Friday slice 10, widened by goal 19).
// ---------------------------------------------------------------------------

export interface DayBoardSlotRequest {
  readonly id: string;
  readonly bookingId: string | null;
  readonly roomId?: string;
  readonly kind: RequestKind;
  readonly quantity: number | null;
  readonly urgency: RequestUrgency;
  readonly state: RequestState;
  readonly ownerUserId?: string | null;
  readonly ownerName?: string | null;
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

function unowned(request: DayBoardSlotRequest): boolean {
  return isUnownedRequest({ state: request.state, ownerUserId: request.ownerUserId ?? null });
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

  const waiting = open.filter((request) => request.state === "sent" || request.state === "reopened");
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

/** The copper ring (D3): attention while a request is unowned, urgent while
 *  an urgent one is, owned once every open request has a person. */
export function deriveSlotAttention(
  requests: readonly DayBoardSlotRequest[],
  nowMs: number,
): SlotAttention | null {
  const open = requests.filter(isOpenRequest);
  if (open.length === 0) return null;
  const nobodyHas = open.filter(unowned);
  const urgent = nobodyHas.some((request) => request.urgency === "now");
  const newestAtMs = Math.max(...open.map((request) => Date.parse(request.createdAt)));
  const arrived = nowMs - newestAtMs >= 0 && nowMs - newestAtMs < REQUEST_PULSE_WINDOW_MS;
  const owned = open.filter((request) => !unowned(request));
  const ownerName = owned.length === 0
    ? null
    : owned.reduce((latest, request) => Date.parse(request.createdAt) > Date.parse(latest.createdAt) ? request : latest).ownerName ?? null;
  return {
    level: urgent ? "urgent" : nobodyHas.length > 0 ? "attention" : "owned",
    count: open.length,
    unownedCount: nobodyHas.length,
    ownerName,
    waitingSinceMs: nobodyHas.length === 0 ? null : Math.min(...nobodyHas.map((request) => Date.parse(request.createdAt))),
    arrived,
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

/** The board's legend: one entry per colour, each worded exactly as a slot in
 *  that state reads (D3), in the order a day runs. */
export const DAY_BOARD_LEGEND: readonly { readonly tone: DayBoardTone; readonly label: string; readonly icon: DayBoardIcon }[] = [
  { tone: "quiet", label: "Scheduled", icon: "clock" },
  { tone: "green", label: "Organisers due", icon: "wrench" },
  { tone: "amber", label: "Guests due", icon: "users" },
  { tone: "amber-deep", label: "Doors soon", icon: "door-open" },
  { tone: "live", label: "Live", icon: "radio" },
  { tone: "sage", label: "Clear-down", icon: "rotate-ccw" },
  { tone: "faded", label: "Ended", icon: "check" },
  { tone: "red", label: "Changeover at risk", icon: "alert-triangle" },
];

/** The legend's second channel: the ring a slot wears for its requests, and
 *  the band that outranks everything (D3). Worded as the ring and band are. */
export const DAY_BOARD_RING_LEGEND: readonly { readonly key: "attention" | "urgent" | "owned" | "stale"; readonly label: string; readonly icon: DayBoardIcon }[] = [
  { key: "attention", label: "Request · nobody has this", icon: "bell" },
  { key: "urgent", label: "Urgent · nobody has this", icon: "alert-triangle" },
  { key: "owned", label: "In hand", icon: "user-check" },
  { key: "stale", label: "Offline or stale", icon: "wifi-off" },
];

export interface DayBoardLane {
  readonly room: CalendarRoom;
  readonly slots: readonly DayBoardSlot[];
}

/** A request nobody owns, on the UNOWNED rail at the board's edge. */
export interface UnownedRequest {
  readonly id: string;
  readonly bookingId: string | null;
  readonly roomName: string | null;
  readonly kind: RequestKind;
  readonly quantity: number | null;
  readonly urgency: RequestUrgency;
  readonly state: RequestState;
  readonly createdAtMs: number;
  /** "Chairs × 10 · Grand Hall · waiting 3 min" */
  readonly line: string;
}

export type NextActionKind = "request" | "slot" | "quiet";

/** This hallkeeper's next action, one line at the top, always. */
export interface NextAction {
  readonly kind: NextActionKind;
  readonly line: string;
  readonly bookingId: string | null;
  readonly requestId: string | null;
}

export interface DayBoard {
  readonly lanes: readonly DayBoardLane[];
  /** The next instant at which any slot's state changes; null when none will. */
  readonly nextBoundaryMs: number | null;
  readonly unowned: readonly UnownedRequest[];
  readonly nextAction: NextAction;
}

function minutesUntil(ms: number, nowMs: number): number {
  return Math.ceil((ms - nowMs) / MIN_MS);
}

/** "48 min", "1 h 12", "2 h": the house's duration words. */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} h`;
  return `${String(hours)} h ${String(rest).padStart(2, "0")}`;
}

/** The venue's turnaround for a booking: the most specific active rule for
 *  (room, event type), ties toward the largest minutes — the server's own
 *  resolution, repeated so the slab can draw what the engine enforces. */
export function resolveTurnaroundMinutes(
  rules: readonly CalendarTurnaroundRule[] | undefined,
  spaceId: string,
  eventType: string | null,
): number | null {
  if (rules === undefined) return null;
  let best: { readonly specificity: number; readonly minutes: number } | null = null;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const roomMatch = rule.spaceId === null ? 0 : rule.spaceId === spaceId ? 2 : -1;
    const typeMatch = rule.eventType === null ? 0 : eventType !== null && rule.eventType === eventType ? 1 : -1;
    if (roomMatch < 0 || typeMatch < 0) continue;
    const specificity = roomMatch + typeMatch;
    if (best === null || specificity > best.specificity || (specificity === best.specificity && rule.minutes > best.minutes)) {
      best = { specificity, minutes: rule.minutes };
    }
  }
  return best?.minutes ?? null;
}

interface TimedState {
  readonly state: DayBoardState;
  readonly stateLabel: string;
  readonly tone: DayBoardTone;
  readonly motion: DayBoardMotion;
  readonly icon: DayBoardIcon;
  readonly countdown: string;
  readonly nextBoundaryMs: number | null;
}

function deriveTimedState(segments: SlotSegments, nowMs: number, timeZone: string): TimedState {
  const { setupStartsAtMs, doorsAtMs, endsAtMs, clearDownEndsAtMs } = segments;
  const organisersAtMs = setupStartsAtMs - ORGANISERS_WINDOW_MIN * MIN_MS;
  const guestsAtMs = doorsAtMs - GUESTS_WINDOW_MIN * MIN_MS;
  const imminentAtMs = doorsAtMs - IMMINENT_WINDOW_MIN * MIN_MS;

  if (nowMs >= clearDownEndsAtMs) {
    return {
      state: "done", stateLabel: "Ended", tone: "faded", motion: "none", icon: "check",
      countdown: `Ended ${formatWallTime(endsAtMs, timeZone)}`, nextBoundaryMs: null,
    };
  }
  if (nowMs >= endsAtMs) {
    return {
      state: "clear-down", stateLabel: "Clear-down", tone: "sage", motion: "none", icon: "rotate-ccw",
      countdown: `Clear-down · ${formatMinutes(minutesUntil(clearDownEndsAtMs, nowMs))}`, nextBoundaryMs: clearDownEndsAtMs,
    };
  }
  if (nowMs >= doorsAtMs) {
    const elapsed = Math.floor((nowMs - doorsAtMs) / MIN_MS);
    return {
      state: "live", stateLabel: "Live", tone: "live", motion: "live-breath", icon: "radio",
      countdown: `LIVE · ${formatMinutes(elapsed)} elapsed`, nextBoundaryMs: endsAtMs,
    };
  }
  if (nowMs >= imminentAtMs) {
    const minutes = minutesUntil(doorsAtMs, nowMs);
    return {
      state: "imminent", stateLabel: "Doors soon", tone: "amber-deep", motion: "breath-2s", icon: "door-open",
      countdown: minutes <= 0 ? "Doors · now" : `Doors · ${String(minutes)} min`, nextBoundaryMs: doorsAtMs,
    };
  }
  if (nowMs >= guestsAtMs) {
    return {
      state: "guests-due", stateLabel: "Guests due", tone: "amber", motion: "breath-3s", icon: "users",
      countdown: `Guests · ${String(minutesUntil(doorsAtMs, nowMs))} min`, nextBoundaryMs: imminentAtMs,
    };
  }
  if (nowMs >= organisersAtMs) {
    const setupIn = minutesUntil(setupStartsAtMs, nowMs);
    return {
      state: "organisers-due", stateLabel: "Organisers due", tone: "green", motion: "breath-4s", icon: "wrench",
      countdown: setupIn <= 0
        ? `Setting up · doors ${formatWallTime(doorsAtMs, timeZone)}`
        : `Organisers · ${String(setupIn)} min`,
      nextBoundaryMs: setupIn <= 0 ? guestsAtMs : Math.min(guestsAtMs, setupStartsAtMs),
    };
  }
  return {
    state: "scheduled", stateLabel: "Scheduled", tone: "quiet", motion: "none", icon: "clock",
    countdown: `Scheduled ${formatWallTime(doorsAtMs, timeZone)}`, nextBoundaryMs: organisersAtMs,
  };
}

/** A hallkeeper preps rooms for things that are happening: ink, live holds,
 *  house blocks. The sales pipeline (prospects) and departed bookings
 *  (released/expired/cancelled/lost) never reach the board.
 *
 *  Exported because the event-day board asks the same question of the same
 *  calendar and must get the same answer. */
export function isBoardWorthy(entry: CalendarBookingEntry): boolean {
  return entry.status === "active" && entry.kind !== "prospect";
}

function unownedLine(request: DayBoardSlotRequest, roomName: string | null, nowMs: number): string {
  const what = request.quantity === null
    ? describeRequestKind(request.kind)
    : `${describeRequestKind(request.kind)} × ${String(request.quantity)}`;
  const waiting = Math.max(0, Math.floor((nowMs - Date.parse(request.createdAt)) / MIN_MS));
  const where = roomName === null ? what : `${what} · ${roomName}`;
  return `${where} · waiting ${formatMinutes(waiting)}`;
}

/** This hallkeeper's next action: an urgent request nobody owns first, then
 *  any unowned request, then the slot nearest its next moment, then quiet. */
export function deriveNextAction(
  lanes: readonly DayBoardLane[],
  unownedRail: readonly UnownedRequest[],
  nowMs: number,
  timeZone: string = VENUE_TIME_ZONE,
): NextAction {
  const first = unownedRail[0];
  if (first !== undefined) {
    const verb = first.urgency === "now" ? "Take now" : "Take";
    return { kind: "request", line: `${verb}: ${first.line}`, bookingId: first.bookingId, requestId: first.id };
  }
  const order: Readonly<Record<DayBoardState, number>> = {
    exception: 0, imminent: 1, "guests-due": 2, "organisers-due": 3, live: 4, "clear-down": 5, scheduled: 6, done: 7,
  };
  const ranked = lanes
    .flatMap((lane) => lane.slots.map((slot) => ({ slot, room: lane.room.name })))
    .filter(({ slot }) => slot.state !== "done")
    .sort((a, b) => {
      const byState = order[a.slot.state] - order[b.slot.state];
      return byState !== 0 ? byState : a.slot.setupStartsAtMs - b.slot.setupStartsAtMs;
    });
  const next = ranked[0];
  if (next === undefined) return { kind: "quiet", line: "Nothing scheduled.", bookingId: null, requestId: null };
  const { slot, room } = next;
  if (slot.state === "scheduled") {
    const wait = minutesUntil(slot.setupStartsAtMs, nowMs);
    return {
      kind: "slot",
      line: `Next: ${room} · ${slot.title} · setup ${formatWallTime(slot.setupStartsAtMs, timeZone)} (${formatMinutes(wait)})`,
      bookingId: slot.bookingId,
      requestId: null,
    };
  }
  return { kind: "slot", line: `${room} · ${slot.countdown}`, bookingId: slot.bookingId, requestId: null };
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

  // An event spanning rooms: one slot per lane, each naming the others.
  const roomNameById = new Map(response.rooms.map((room) => [room.id, room.name]));
  const roomsByEvent = new Map<string, Set<string>>();
  for (const entry of bookings) {
    if (entry.eventId === null) continue;
    const set = roomsByEvent.get(entry.eventId) ?? new Set<string>();
    set.add(entry.spaceId);
    roomsByEvent.set(entry.eventId, set);
  }

  const sortedRooms = [...response.rooms].sort((a, b) => a.sortOrder - b.sortOrder);
  const lanes: DayBoardLane[] = sortedRooms.map((room) => {
    const entries = bookings
      .filter((entry) => entry.spaceId === room.id)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    // Setup starts, per slot, so a clear-down can be cut short by the next.
    const setupStarts = entries.map((entry) => {
      const bookingPhases = phases.filter(
        (candidate) => candidate.eventId === entry.eventId && candidate.spaceId === entry.spaceId,
      );
      return bookingPhases.reduce(
        (earliest, candidate) => Math.min(earliest, Date.parse(candidate.startsAt)),
        Date.parse(entry.startsAt),
      );
    });

    const slots = entries.map((entry, index) => {
      const startsAtMs = Date.parse(entry.startsAt);
      const endsAtMs = Date.parse(entry.endsAt);
      const bookingPhases = phases
        .filter((candidate) => candidate.eventId === entry.eventId && candidate.spaceId === entry.spaceId)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      const setupStartsAtMs = setupStarts[index] ?? startsAtMs;
      const turnaroundMinutes = resolveTurnaroundMinutes(response.turnaroundRules, room.id, entry.eventType);
      const nextSetup = setupStarts[index + 1];
      const clearDownEndsAtMs = Math.max(
        endsAtMs,
        Math.min(
          endsAtMs + (turnaroundMinutes ?? 0) * MIN_MS,
          nextSetup === undefined ? Number.POSITIVE_INFINITY : nextSetup,
        ),
      );
      const segments: SlotSegments = { setupStartsAtMs, doorsAtMs: startsAtMs, endsAtMs, clearDownEndsAtMs, turnaroundMinutes };

      const timed = deriveTimedState(segments, nowMs, timeZone);
      const slotRequests = (requestsByBooking.get(entry.id) ?? []).filter(isOpenRequest);
      const requestSignal = deriveSlotRequestSignal(slotRequests, nowMs);
      const attention = deriveSlotAttention(slotRequests, nowMs);
      const blocking = blockingByBooking.get(entry.id);
      const timeRange = `${formatWallTime(startsAtMs, timeZone)} – ${formatWallTime(endsAtMs, timeZone)}`;
      const bookingLabel = entry.kind === "hold"
        ? bookingStateLabel(entry)
        : entry.kind === "internal_block" ? "House block" : "Confirmed booking";

      const previous = entries[index - 1];
      let gapBefore: LaneGap | null = null;
      if (previous !== undefined) {
        const previousEnd = Date.parse(previous.endsAt);
        const needed = resolveTurnaroundMinutes(response.turnaroundRules, room.id, previous.eventType);
        const minutes = Math.max(0, Math.round((setupStartsAtMs - previousEnd) / MIN_MS));
        gapBefore = { minutes, neededMinutes: needed, short: needed !== null && minutes < needed };
      }

      const linkedRooms = entry.eventId === null
        ? []
        : [...(roomsByEvent.get(entry.eventId) ?? [])]
          .filter((spaceId) => spaceId !== room.id)
          .map((spaceId) => roomNameById.get(spaceId) ?? "another room");

      const base = {
        bookingId: entry.id,
        roomId: room.id,
        eventId: entry.eventId,
        guestCount: entry.guestCount ?? null,
        clientName: entry.clientName ?? null,
        phases: bookingPhases,
        title: entry.title,
        eventType: entry.eventType,
        kind: entry.kind,
        bookingLabel,
        startsAtMs,
        endsAtMs,
        setupStartsAtMs,
        segments,
        timeRange,
        gapBefore,
        linkedRooms,
        requests: slotRequests,
        requestSignal,
        attention,
      };

      const slot: DayBoardSlot = blocking !== undefined && timed.state !== "done"
        ? {
            ...base,
            state: "exception",
            stateLabel: "Changeover at risk",
            tone: "red",
            motion: "none",
            icon: "alert-triangle",
            // The verb says why, then where the room is in its day: a slab
            // that only read "Scheduled 14:20" under a red edge made the
            // reader open it to learn what was wrong.
            countdown: `Changeover at risk · ${timed.countdown}`,
            exception: "turnaround-at-risk",
            exceptionDetail: blocking,
            turnaroundWarning: null,
            nextBoundaryMs: timed.nextBoundaryMs,
          }
        : {
            ...base,
            state: timed.state,
            stateLabel: timed.stateLabel,
            tone: timed.tone,
            motion: timed.motion,
            icon: timed.icon,
            countdown: timed.countdown,
            exception: null,
            exceptionDetail: null,
            turnaroundWarning: warningByBooking.get(entry.id) ?? null,
            nextBoundaryMs: timed.nextBoundaryMs,
          };
      return slot;
    });
    return { room, slots };
  });

  const boundaries = lanes
    .flatMap((lane) => lane.slots.map((slot) => slot.nextBoundaryMs))
    .filter((ms): ms is number => ms !== null && ms > nowMs);
  const nextBoundaryMs = boundaries.length === 0 ? null : Math.min(...boundaries);

  const rail: UnownedRequest[] = requests
    .filter((request) => isOpenRequest(request) && unowned(request))
    .map((request) => {
      const roomName = request.roomId !== undefined
        ? roomNameById.get(request.roomId) ?? null
        : request.bookingId === null
          ? null
          : roomNameById.get(bookings.find((entry) => entry.id === request.bookingId)?.spaceId ?? "") ?? null;
      return {
        id: request.id,
        bookingId: request.bookingId,
        roomName,
        kind: request.kind,
        quantity: request.quantity,
        urgency: request.urgency,
        state: request.state,
        createdAtMs: Date.parse(request.createdAt),
        line: unownedLine(request, roomName, nowMs),
      };
    })
    .sort((a, b) => {
      const urgency = (value: RequestUrgency): number => (value === "now" ? 0 : value === "soon" ? 1 : 2);
      const byUrgency = urgency(a.urgency) - urgency(b.urgency);
      return byUrgency !== 0 ? byUrgency : a.createdAtMs - b.createdAtMs;
    });

  return { lanes, nextBoundaryMs, unowned: rail, nextAction: deriveNextAction(lanes, rail, nowMs, timeZone) };
}
