import type { BookingState, CalendarBookingEntry, CalendarEntry } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The lifecycle changes that end a booking's claim on its date (roadmap N3).
// Each is confirmed before it runs, and the confirmation says who stands
// first on the date afterwards. The API resequences the ladder when a hold
// leaves and names the holds it promoted (`resequence.promotedToFirst`);
// this reads the same answer off the board beforehand.
// ---------------------------------------------------------------------------

export type EndingTransition = "released" | "expired" | "lost" | "cancelled";

export function isEndingTransition(state: BookingState): state is EndingTransition {
  return state === "released" || state === "expired" || state === "lost" || state === "cancelled";
}

/** The other active holds in this booking's room whose times cross it, as
 *  the board has them. */
export function contestedHolds(entries: readonly CalendarEntry[], booking: CalendarBookingEntry): readonly CalendarBookingEntry[] {
  const startMs = Date.parse(booking.startsAt);
  const endMs = Date.parse(booking.endsAt);
  return entries.filter((entry): entry is CalendarBookingEntry =>
    entry.entryType === "booking"
    && entry.id !== booking.id
    && entry.spaceId === booking.spaceId
    && entry.status === "active"
    && entry.kind === "hold"
    && Date.parse(entry.startsAt) < endMs
    && Date.parse(entry.endsAt) > startMs);
}

export type LadderAfterExit =
  /** These holds become 1st option. */
  | { readonly kind: "promoted"; readonly titles: readonly string[] }
  /** A confirmed booking leaves: these 1st options can then be confirmed. */
  | { readonly kind: "free"; readonly titles: readonly string[] }
  | { readonly kind: "none" };

const NONE: LadderAfterExit = { kind: "none" };

function lowestRank(holds: readonly CalendarBookingEntry[]): number | null {
  let lowest: number | null = null;
  for (const hold of holds) {
    if (hold.rank !== null && (lowest === null || hold.rank < lowest)) lowest = hold.rank;
  }
  return lowest;
}

/** Who stands first on the date once this booking goes. A joint 1st that
 *  leaves promotes no one, because its partners are already 1st; a hold
 *  behind the 1st option promotes no one to 1st. Unranked holds join the
 *  back of the ladder by when they were made, which the board does not
 *  carry, so they are never named here. */
export function ladderAfterExit(booking: CalendarBookingEntry, contested: readonly CalendarBookingEntry[]): LadderAfterExit {
  if (booking.kind === "ink") {
    const first = lowestRank(contested);
    return first === null ? NONE : { kind: "free", titles: contested.filter((hold) => hold.rank === first).map((hold) => hold.title) };
  }
  if (booking.kind !== "hold" || booking.rank !== 1) return NONE;
  if (contested.some((hold) => hold.rank === 1)) return NONE;
  const next = lowestRank(contested);
  return next === null ? NONE : { kind: "promoted", titles: contested.filter((hold) => hold.rank === next).map((hold) => hold.title) };
}
