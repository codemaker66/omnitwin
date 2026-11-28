import type { BookingKind, RotaPerson, RotaShift } from "@omnitwin/types";
import type { DayBoardLane, DayBoardSlot } from "./day-board-state.js";

// ---------------------------------------------------------------------------
// Who is on for a turn-round (pure).
//
// A turn-round is the time the board shows between one booking leaving a
// room and the next one's setup starting there (its doors, when it has no
// setup of its own): the room is cleared and readied in between. The crew
// for it is the published setup shifts that belong to it and are on for it.
// - A shift that names a room belongs to that room only.
// - A shift that names only an event belongs to that event's turn-rounds, in
//   whichever room: a wedding's crew strikes its ceremony. It counts on each
//   of them at once, as a whole-house shift does, and the panel says so.
// - A shift with neither covers the whole house, and says so.
// While a turn-round is still to come or under way, a hand counts only when
// on for at least fifteen minutes of what is left of it (all of it, when less
// is left): someone who has gone home, or who leaves as it starts, is not
// counted. Once it is over, everyone who was on is listed. A shift nobody
// fills yet is counted, not named.
//
// On a day the rota plans no setup at all the board says nothing about crew,
// rather than calling every turn-round unstaffed. Before the rota's first
// read lands, a function's panel says it is being read, or could not be.
// ---------------------------------------------------------------------------

/** How long a hand must be on for what is left of a turn-round to count. */
export const CREW_MIN_OVERLAP_MS = 15 * 60_000;

/** How far ahead today's sentence looks for a turn-round nobody is on:
 *  near enough to matter now, far enough to call someone in. */
export const UNSTAFFED_HORIZON_MS = 2 * 3_600_000;

export interface TurnRoundWindow {
  readonly roomId: string;
  /** The events of the booking leaving and the booking coming in. */
  readonly eventIds: readonly (string | null)[];
  readonly startMs: number;
  readonly endMs: number;
}

export interface CrewSpan {
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

/** What a hand is rostered for: this room; an event of the turn-round, in
 *  whichever room it turns (named as the rota names it, when it does); or the
 *  whole house. The last two count on every turn-round they reach at once,
 *  though a person is in one room at a time. */
export type HandRostered =
  | { readonly kind: "room" }
  | { readonly kind: "event"; readonly eventName: string | null }
  | { readonly kind: "house" };

export interface TurnRoundHand {
  readonly name: string;
  /** Their shifts on the turn-round, joined where they meet. */
  readonly spans: readonly CrewSpan[];
  /** As narrowly as any of their shifts on it says. */
  readonly rostered: HandRostered;
}

export interface TurnRoundCrew {
  /** The people on for it, by when they start. */
  readonly hands: readonly TurnRoundHand[];
  /** Setup shifts for it that nobody fills yet. */
  readonly unfilled: number;
  /** The turn-round itself: the booking before ends; this one's setup starts. */
  readonly startMs: number;
  readonly endMs: number;
  /** Over by the time it was worked out: everyone who was on is listed. */
  readonly over: boolean;
}

/** What the board reads of the rota. */
export interface RotaRead {
  readonly shifts: readonly RotaShift[];
  readonly people: readonly RotaPerson[];
}

function isSetup(shift: RotaShift): boolean {
  return shift.status === "published" && shift.role === "setup";
}

function belongs(shift: RotaShift, window: TurnRoundWindow): boolean {
  if (shift.spaceId !== null) return shift.spaceId === window.roomId;
  if (shift.eventId !== null) return window.eventIds.includes(shift.eventId);
  return true;
}

const IN_ROOM: HandRostered = { kind: "room" };
const WHOLE_HOUSE: HandRostered = { kind: "house" };

/** What a shift that belongs to a turn-round rosters its hand for. */
function rosteredBy(shift: RotaShift): HandRostered {
  if (shift.spaceId !== null) return IN_ROOM;
  if (shift.eventId === null) return WHOLE_HOUSE;
  const eventName = shift.eventName?.trim() ?? "";
  return { kind: "event", eventName: eventName === "" ? null : eventName };
}

const BREADTH: Readonly<Record<HandRostered["kind"], number>> = { room: 0, event: 1, house: 2 };

/** The narrower of two: a room over an event over the whole house; of two
 *  events, the first that has a name. */
function narrower(known: HandRostered, next: HandRostered): HandRostered {
  if (BREADTH[next.kind] !== BREADTH[known.kind]) return BREADTH[next.kind] < BREADTH[known.kind] ? next : known;
  return known.kind === "event" && known.eventName === null ? next : known;
}

/** Whether a shift is on for the turn-round, as it stands at `nowMs`. */
function onFor(startsAtMs: number, endsAtMs: number, window: TurnRoundWindow, nowMs: number): boolean {
  const over = nowMs >= window.endMs;
  const from = over ? window.startMs : Math.max(nowMs, window.startMs);
  const left = window.endMs - from;
  // A turn-round with no time to it (setup due as the booking before ends):
  // whoever is on at that moment.
  if (left <= 0) return startsAtMs <= from && endsAtMs > from;
  if (over) return startsAtMs < window.endMs && endsAtMs > window.startMs;
  const overlap = Math.min(endsAtMs, window.endMs) - Math.max(startsAtMs, from);
  return overlap >= Math.min(CREW_MIN_OVERLAP_MS, left);
}

function joinSpans(spans: readonly CrewSpan[]): CrewSpan[] {
  const sorted = [...spans].sort((a, b) => a.startsAtMs - b.startsAtMs);
  const joined: CrewSpan[] = [];
  for (const span of sorted) {
    const last = joined[joined.length - 1];
    if (last !== undefined && span.startsAtMs <= last.endsAtMs) {
      joined[joined.length - 1] = { startsAtMs: last.startsAtMs, endsAtMs: Math.max(last.endsAtMs, span.endsAtMs) };
    } else {
      joined.push(span);
    }
  }
  return joined;
}

/** The setup crew rostered for a turn-round, as it stands at `nowMs`. */
export function turnRoundCrew(
  window: TurnRoundWindow,
  shifts: readonly RotaShift[],
  people: readonly RotaPerson[],
  nowMs: number,
): TurnRoundCrew {
  const names = new Map(people.map((person) => [person.id, person.displayName]));
  const on = shifts.filter((shift) => isSetup(shift)
    && belongs(shift, window)
    && onFor(Date.parse(shift.startsAt), Date.parse(shift.endsAt), window, nowMs));
  const byPerson = new Map<string, TurnRoundHand>();
  for (const shift of on) {
    if (shift.staffMemberId === null) continue;
    const name = names.get(shift.staffMemberId);
    if (name === undefined) continue;
    const span = { startsAtMs: Date.parse(shift.startsAt), endsAtMs: Date.parse(shift.endsAt) };
    const rostered = rosteredBy(shift);
    const known = byPerson.get(shift.staffMemberId);
    byPerson.set(shift.staffMemberId, known === undefined
      ? { name, spans: [span], rostered }
      : { name, spans: [...known.spans, span], rostered: narrower(known.rostered, rostered) });
  }
  const hands = [...byPerson.values()]
    .map((hand) => ({ ...hand, spans: joinSpans(hand.spans) }))
    .sort((a, b) => (a.spans[0]?.startsAtMs ?? 0) - (b.spans[0]?.startsAtMs ?? 0) || a.name.localeCompare(b.name));
  return {
    hands,
    unfilled: on.filter((shift) => shift.staffMemberId === null).length,
    startMs: window.startMs,
    endMs: window.endMs,
    over: nowMs >= window.endMs,
  };
}

/** Whether the rota plans setup on the day shown: a published setup shift that touches it. */
export function rostersSetup(shifts: readonly RotaShift[], range: { readonly fromMs: number; readonly toMs: number }): boolean {
  return shifts.some((shift) => isSetup(shift)
    && Date.parse(shift.startsAt) < range.toMs
    && Date.parse(shift.endsAt) > range.fromMs);
}

/** What a turn-round leads into that needs setting: a confirmed or provisional function. */
const FUNCTIONS: ReadonlySet<BookingKind> = new Set<BookingKind>(["ink", "hold"]);

const NO_CREW: ReadonlyMap<string, TurnRoundCrew> = new Map();

/**
 * The booking a function's turn-round runs from: the one before it in its
 * room. Null for a viewing or a house block, which is no function to set,
 * and for a function with nothing before it.
 */
export function turnRoundFrom(lane: DayBoardLane, slot: DayBoardSlot): DayBoardSlot | null {
  if (!FUNCTIONS.has(slot.kind) || slot.previousBookingId === null) return null;
  return lane.slots.find((candidate) => candidate.bookingId === slot.previousBookingId) ?? null;
}

/** Whether the board has a turn-round into a function, so a crew to tell. */
export function anyTurnRound(lanes: readonly DayBoardLane[]): boolean {
  return lanes.some((lane) => lane.slots.some((slot) => turnRoundFrom(lane, slot) !== null));
}

/**
 * The crew for each turn-round on the board, by the booking it leads to: a
 * function whose turn-round runs from a booking before it in its room. A
 * viewing or a house block is no function to set, so it has none. Empty on
 * a day the rota plans no setup.
 */
export function crewBySlot(
  lanes: readonly DayBoardLane[],
  rota: RotaRead,
  range: { readonly fromMs: number; readonly toMs: number },
  nowMs: number,
): ReadonlyMap<string, TurnRoundCrew> {
  if (!rostersSetup(rota.shifts, range)) return NO_CREW;
  const crew = new Map<string, TurnRoundCrew>();
  for (const lane of lanes) {
    for (const slot of lane.slots) {
      const previous = turnRoundFrom(lane, slot);
      if (previous === null) continue;
      crew.set(slot.bookingId, turnRoundCrew({
        roomId: lane.room.id,
        eventIds: [previous.eventId, slot.eventId],
        startMs: previous.endsAtMs,
        endMs: Math.max(previous.endsAtMs, slot.setupStartsAtMs),
      }, rota.shifts, rota.people, nowMs));
    }
  }
  return crew;
}

/**
 * The room of each turn-round with nobody on setup, in the board's order:
 * those whose setup is still ahead and that begin by `nowMs + horizonMs`.
 * Today looks two hours ahead; another day, a planning view, looks at all of
 * them. A provisional booking may not happen, so its turn-round is not said;
 * a changeover already at risk is said by the risk, as its slot says it.
 */
export function unstaffedTurnRounds(
  lanes: readonly DayBoardLane[],
  crew: ReadonlyMap<string, TurnRoundCrew>,
  nowMs: number,
  horizonMs: number = Number.POSITIVE_INFINITY,
): readonly string[] {
  return lanes.flatMap((lane) => lane.slots
    .filter((slot) => {
      const found = crew.get(slot.bookingId);
      return found !== undefined && slot.kind === "ink" && slot.exception === null && found.hands.length === 0
        && nowMs < slot.setupStartsAtMs && found.startMs <= nowMs + horizonMs;
    })
    .map(() => lane.room.name));
}

/** The slab's words: "2 on setup", "nobody on setup". */
export function crewWords(crew: TurnRoundCrew): string {
  return crew.hands.length === 0 ? "nobody on setup" : `${String(crew.hands.length)} on setup`;
}

/** What a function's panel says of the crew for its turn-round. */
export type CrewOnPanel =
  | { readonly kind: "read"; readonly crew: TurnRoundCrew }
  | { readonly kind: "reading" }
  | { readonly kind: "unread" };

/**
 * What a function's panel says of its turn-round's crew: who is on it, as the
 * rota was last read; before any read has landed, that the rota is being read
 * or could not be; nothing once a read shows the day plans no setup.
 */
export function crewOnPanel(
  crew: TurnRoundCrew | undefined,
  rota: { readonly status: "idle" | "loading" | "ready" | "error"; readonly readAtMs: number | null },
): CrewOnPanel | null {
  if (crew !== undefined) return { kind: "read", crew };
  if (rota.readAtMs !== null) return null;
  if (rota.status === "loading") return { kind: "reading" };
  if (rota.status === "error") return { kind: "unread" };
  return null;
}
