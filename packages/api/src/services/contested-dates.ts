import type { CalendarBookingEntry } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Contested dates (roadmap N3): the rooms and times more than one live
// booking wants, counted as the conflict engine counts a hold overlap —
// provisional holds crossing each other, or a hold crossing a confirmed
// booking. Bookings that cross in a chain (A with B, B with C) are one
// contested time, so a date is listed once with its whole ladder. Pure: the
// calendar route feeds it the rows its query found, and tests feed it cases.
//
// A booking that crosses no hold takes part in no chain, so the dates found
// among the contested bookings alone are the same dates: the route groups
// lean rows to find them, then fetches full entries for those it shows.
// ---------------------------------------------------------------------------

/** What grouping reads of a booking. */
export type ContestableBooking = Pick<CalendarBookingEntry, "id" | "spaceId" | "kind" | "status" | "startsAt" | "endsAt" | "rank">;

export interface ContestedGroup<T extends ContestableBooking> {
  readonly spaceId: string;
  /** The earliest start and latest end of the bookings in contest. */
  readonly startsAt: string;
  readonly endsAt: string;
  /** Confirmed bookings first, then the holds in ladder order. */
  readonly bookings: T[];
}

const UNRANKED = Number.MAX_SAFE_INTEGER;

function byId(a: ContestableBooking, b: ContestableBooking): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Confirmed bookings first, then holds by their place on the ladder
 *  (unranked last), then by start. */
function ladderOrder(a: ContestableBooking, b: ContestableBooking): number {
  const confirmedFirst = (entry: ContestableBooking): number => (entry.kind === "ink" ? 0 : 1);
  return confirmedFirst(a) - confirmedFirst(b)
    || (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED)
    || Date.parse(a.startsAt) - Date.parse(b.startsAt)
    || byId(a, b);
}

function contested(group: readonly ContestableBooking[]): boolean {
  const holds = group.filter((entry) => entry.kind === "hold").length;
  return holds >= 2 || (holds >= 1 && group.length > holds);
}

/** The contested dates among these bookings, soonest first. Only active holds
 *  and confirmed bookings take part; every other kind and state is ignored. */
export function contestedDates<T extends ContestableBooking>(entries: readonly T[]): ContestedGroup<T>[] {
  const bySpace = new Map<string, T[]>();
  for (const entry of entries) {
    if (entry.status !== "active" || (entry.kind !== "hold" && entry.kind !== "ink")) continue;
    const room = bySpace.get(entry.spaceId);
    if (room === undefined) bySpace.set(entry.spaceId, [entry]);
    else room.push(entry);
  }

  const dates: ContestedGroup<T>[] = [];
  for (const [spaceId, rows] of bySpace) {
    const sorted = [...rows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || byId(a, b));
    let group: T[] = [];
    let groupEndMs = Number.NEGATIVE_INFINITY;
    const close = (): void => {
      if (group.length < 2 || !contested(group)) return;
      const first = group[0];
      if (first === undefined) return;
      dates.push({
        spaceId,
        startsAt: first.startsAt,
        endsAt: new Date(groupEndMs).toISOString(),
        bookings: [...group].sort(ladderOrder),
      });
    };
    for (const entry of sorted) {
      const startMs = Date.parse(entry.startsAt);
      const endMs = Date.parse(entry.endsAt);
      // Half-open times: one that starts as another ends does not cross it.
      if (group.length > 0 && startMs < groupEndMs) {
        group.push(entry);
        groupEndMs = Math.max(groupEndMs, endMs);
      } else {
        close();
        group = [entry];
        groupEndMs = endMs;
      }
    }
    close();
  }

  return dates.sort((a, b) =>
    Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.spaceId < b.spaceId ? -1 : a.spaceId > b.spaceId ? 1 : 0));
}
