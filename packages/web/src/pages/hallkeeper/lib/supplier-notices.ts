import type { SupplierArrival } from "@omnitwin/types";
import { formatWallTime } from "../../diary/lib/board-time.js";
import { countWord, listed, type SummaryPart } from "./day-board-rooms.js";

// ---------------------------------------------------------------------------
// What today's sentence says of suppliers (pure): who is late at the door,
// and who is due within the hour. Only arrivals for bookings on the board,
// and only those nobody has marked in. A supplier is late ten minutes after
// they were due, and stops being said once they would have left (three hours
// on, when no leaving time was given): by then it is the office's call, not
// the floor's. The panel's door line uses the same rule, so the two agree.
// ---------------------------------------------------------------------------

export const ARRIVAL_LATE_AFTER_MS = 10 * 60_000;
export const ARRIVAL_SOON_WITHIN_MS = 60 * 60_000;
const LATE_FOR_MS = 3 * 3_600_000;
/** Past this many, a clause counts the suppliers instead of naming them. */
const NAMED_AT_MOST = 3;

export interface ArrivalNotices {
  readonly late: readonly SupplierArrival[];
  readonly soon: readonly SupplierArrival[];
}

/** Nobody has marked them in ten minutes after they were due, and they would not yet have left. */
export function isLateAtDoor(arrival: SupplierArrival, nowMs: number): boolean {
  if (arrival.arrivedAt !== null) return false;
  const dueMs = Date.parse(arrival.arrivesAt);
  const untilMs = arrival.leavesBy === null ? dueMs + LATE_FOR_MS : Date.parse(arrival.leavesBy);
  return dueMs <= nowMs - ARRIVAL_LATE_AFTER_MS && nowMs < untilMs;
}

export function arrivalNotices(
  arrivals: readonly SupplierArrival[],
  onBoard: ReadonlySet<string>,
  nowMs: number,
): ArrivalNotices {
  const waiting = arrivals.filter((arrival) => arrival.arrivedAt === null && onBoard.has(arrival.bookingId));
  return {
    late: waiting.filter((arrival) => isLateAtDoor(arrival, nowMs)),
    soon: waiting.filter((arrival) => {
      const dueMs = Date.parse(arrival.arrivesAt);
      return dueMs >= nowMs && dueMs <= nowMs + ARRIVAL_SOON_WITHIN_MS;
    }),
  };
}

/** A clause's last words with one full stop, even after a name that ends in one ("… Co."). */
function closed(words: string): string {
  return words.endsWith(".") ? words : `${words}.`;
}

/** The sentence's two clauses: the late in copper, the soon in plain strong type. */
export function arrivalParts(
  notices: ArrivalNotices,
  timeZone: string,
): { readonly late: readonly SummaryPart[]; readonly soon: readonly SummaryPart[] } {
  const time = (arrival: SupplierArrival): string => formatWallTime(Date.parse(arrival.arrivesAt), timeZone);
  const names = (arrivals: readonly SupplierArrival[]): string => listed(arrivals.map((arrival) => arrival.supplierName));
  const [lateOne] = notices.late;
  const [soonOne] = notices.soon;
  const late: readonly SummaryPart[] = lateOne === undefined
    ? []
    : notices.late.length === 1
      ? [{ strong: lateOne.supplierName, tone: "copper" }, ` is late: due at ${time(lateOne)}.`]
      : [{ strong: `${countWord(notices.late.length)} suppliers`, tone: "copper" },
        notices.late.length > NAMED_AT_MOST ? " are late." : closed(` are late: ${names(notices.late)}`)];
  const soon: readonly SummaryPart[] = soonOne === undefined
    ? []
    : notices.soon.length === 1
      ? [{ strong: soonOne.supplierName }, ` is due at ${time(soonOne)}${soonOne.entrance === null ? "" : ` (${soonOne.entrance})`}.`]
      : [{ strong: `${countWord(notices.soon.length)} suppliers` }, " are due within the hour."];
  return { late, soon };
}
