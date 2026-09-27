import type { CalendarBookingEntry, CalendarEntry } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Where a new hold would stand on its date's ladder (roadmap N3: "the default
// rank follows the ladder"). The API stores the option a hold is given, so a
// new hold that defaulted to 1st where a 1st option already stood made two
// 1st options. The drawer asks this instead, from the board's own read.
// ---------------------------------------------------------------------------

export type LadderPlace =
  /** The board has not read the whole time, so it suggests no place it
   *  cannot vouch for. */
  | { readonly kind: "unread" }
  | {
      readonly kind: "read";
      /** The next place: one behind the lowest-placed hold, or 1st. */
      readonly rank: number;
      /** The active holds crossing the room and time, in ladder order;
       *  unranked holds last. */
      readonly holds: readonly CalendarBookingEntry[];
      /** Confirmed bookings crossing it, which a hold cannot be confirmed
       *  over while they stand. */
      readonly confirmed: readonly CalendarBookingEntry[];
    };

const UNRANKED = Number.MAX_SAFE_INTEGER;

export function ladderPlace(
  entries: readonly CalendarEntry[],
  read: { readonly fromMs: number; readonly toMs: number } | null,
  spaceId: string,
  startMs: number,
  endMs: number,
): LadderPlace {
  if (read === null || startMs < read.fromMs || endMs > read.toMs) return { kind: "unread" };
  const crossing = entries.filter((entry): entry is CalendarBookingEntry =>
    entry.entryType === "booking" && entry.spaceId === spaceId && entry.status === "active"
    && Date.parse(entry.startsAt) < endMs && Date.parse(entry.endsAt) > startMs);
  const holds = crossing
    .filter((entry) => entry.kind === "hold")
    .sort((a, b) => (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED)
      || Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const ranks = holds.map((hold) => hold.rank).filter((rank): rank is number => rank !== null);
  return {
    kind: "read",
    rank: ranks.length === 0 ? 1 : Math.max(...ranks) + 1,
    holds,
    confirmed: crossing.filter((entry) => entry.kind === "ink"),
  };
}
