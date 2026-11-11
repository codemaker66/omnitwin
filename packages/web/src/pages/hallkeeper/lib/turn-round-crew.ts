import type { RotaPerson, RotaShift } from "@omnitwin/types";
import type { DayBoardLane } from "./day-board-state.js";

// ---------------------------------------------------------------------------
// Who is on for a turn-round (pure).
//
// A turn-round runs from the booking before leaving a room to this booking's
// doors: the room is cleared and set again in between. The crew for it is the
// published setup shifts that overlap that time and belong to it: shifts in
// that room, shifts for either booking's event, and setup shifts with neither
// room nor event, which cover the whole house. A shift nobody fills yet is
// counted, not named. A rota with no setup shifts at all is not used for
// setup, and the board then says nothing about crew rather than "nobody".
// ---------------------------------------------------------------------------

export interface TurnRoundWindow {
  readonly roomId: string;
  /** The events of the booking leaving and the booking coming in. */
  readonly eventIds: readonly (string | null)[];
  readonly startMs: number;
  readonly endMs: number;
}

export interface TurnRoundHand {
  readonly name: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export interface TurnRoundCrew {
  /** The people on shift for it, by when they start. */
  readonly hands: readonly TurnRoundHand[];
  /** Setup shifts for it that nobody fills yet. */
  readonly unfilled: number;
  /** The turn-round itself: the booking before ends, this one's doors open. */
  readonly startMs: number;
  readonly endMs: number;
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
  if (shift.spaceId === window.roomId) return true;
  if (shift.eventId !== null && window.eventIds.includes(shift.eventId)) return true;
  return shift.spaceId === null && shift.eventId === null;
}

/** The setup crew rostered for a turn-round. */
export function turnRoundCrew(
  window: TurnRoundWindow,
  shifts: readonly RotaShift[],
  people: readonly RotaPerson[],
): TurnRoundCrew {
  const names = new Map(people.map((person) => [person.id, person.displayName]));
  const covering = shifts.filter((shift) => isSetup(shift)
    && Date.parse(shift.startsAt) < window.endMs
    && Date.parse(shift.endsAt) > window.startMs
    && belongs(shift, window));
  // One line a person, from their earliest shift to their latest end.
  const named = new Map<string, TurnRoundHand>();
  for (const shift of covering) {
    if (shift.staffMemberId === null) continue;
    const name = names.get(shift.staffMemberId);
    if (name === undefined) continue;
    const startsAtMs = Date.parse(shift.startsAt);
    const endsAtMs = Date.parse(shift.endsAt);
    const known = named.get(shift.staffMemberId);
    named.set(shift.staffMemberId, known === undefined
      ? { name, startsAtMs, endsAtMs }
      : { name, startsAtMs: Math.min(known.startsAtMs, startsAtMs), endsAtMs: Math.max(known.endsAtMs, endsAtMs) });
  }
  return {
    hands: [...named.values()].sort((a, b) => a.startsAtMs - b.startsAtMs || a.name.localeCompare(b.name)),
    unfilled: covering.filter((shift) => shift.staffMemberId === null).length,
    startMs: window.startMs,
    endMs: window.endMs,
  };
}

/** Whether the rota plans setup at all in what it holds. */
export function rostersSetup(shifts: readonly RotaShift[]): boolean {
  return shifts.some(isSetup);
}

const NO_CREW: ReadonlyMap<string, TurnRoundCrew> = new Map();

/**
 * The crew for each turn-round on the board, by the booking it leads to: a
 * function whose turn-round runs from a booking before it in its room. A
 * viewing or a house block is no function to set, so it has none. Empty
 * when the rota plans no setup.
 */
export function crewBySlot(lanes: readonly DayBoardLane[], rota: RotaRead): ReadonlyMap<string, TurnRoundCrew> {
  if (!rostersSetup(rota.shifts)) return NO_CREW;
  const crew = new Map<string, TurnRoundCrew>();
  for (const lane of lanes) {
    for (const slot of lane.slots) {
      if (slot.kind === "viewing" || slot.eventId === null || slot.previousBookingId === null) continue;
      const previous = lane.slots.find((candidate) => candidate.bookingId === slot.previousBookingId);
      if (previous === undefined) continue;
      crew.set(slot.bookingId, turnRoundCrew({
        roomId: lane.room.id,
        eventIds: [previous.eventId, slot.eventId],
        startMs: previous.endsAtMs,
        endMs: slot.startsAtMs,
      }, rota.shifts, rota.people));
    }
  }
  return crew;
}

/** How far ahead today's sentence looks for a turn-round nobody is on:
 *  near enough to matter now, far enough to call someone in. */
export const UNSTAFFED_HORIZON_MS = 2 * 3_600_000;

/**
 * The room of each turn-round with nobody on setup, in the board's order:
 * those not yet over that begin by `nowMs + horizonMs`. Today looks two
 * hours ahead; another day, a planning view, looks at all of them. A
 * changeover already at risk is said by the risk, as its slot says it.
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
      return found !== undefined && slot.exception === null && found.hands.length === 0
        && found.endMs > nowMs && found.startMs <= nowMs + horizonMs;
    })
    .map(() => lane.room.name));
}

/** The slab's words: "2 on setup", "nobody on setup". */
export function crewWords(crew: TurnRoundCrew): string {
  return crew.hands.length === 0 ? "nobody on setup" : `${String(crew.hands.length)} on setup`;
}
