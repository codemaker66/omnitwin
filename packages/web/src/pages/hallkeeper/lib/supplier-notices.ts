import type { SupplierArrival } from "@omnitwin/types";
import { formatWallTime } from "../../diary/lib/board-time.js";
import { countWord, listed, type SummaryPart } from "./day-board-rooms.js";

// ---------------------------------------------------------------------------
// What today's sentence says of suppliers (pure): who is late at the door,
// and who is due within the hour. Only arrivals for bookings on the board,
// and only those nobody has marked in. A supplier is late ten minutes after
// they were due, and stops being said once they would have left (three hours
// on, when no leaving time was given): by then it is the office's call, not
// the floor's.
// ---------------------------------------------------------------------------

export const ARRIVAL_LATE_AFTER_MS = 10 * 60_000;
export const ARRIVAL_SOON_WITHIN_MS = 60 * 60_000;
const LATE_FOR_MS = 3 * 3_600_000;

export interface ArrivalNotices {
  readonly late: readonly SupplierArrival[];
  readonly soon: readonly SupplierArrival[];
}

export function arrivalNotices(
  arrivals: readonly SupplierArrival[],
  onBoard: ReadonlySet<string>,
  nowMs: number,
): ArrivalNotices {
  const waiting = arrivals.filter((arrival) => arrival.arrivedAt === null && onBoard.has(arrival.bookingId));
  const dueMs = (arrival: SupplierArrival): number => Date.parse(arrival.arrivesAt);
  return {
    late: waiting.filter((arrival) => {
      const until = arrival.leavesBy === null ? dueMs(arrival) + LATE_FOR_MS : Date.parse(arrival.leavesBy);
      return dueMs(arrival) <= nowMs - ARRIVAL_LATE_AFTER_MS && nowMs < until;
    }),
    soon: waiting.filter((arrival) => dueMs(arrival) > nowMs - ARRIVAL_LATE_AFTER_MS && dueMs(arrival) <= nowMs + ARRIVAL_SOON_WITHIN_MS),
  };
}

/** The sentence's two clauses: the late in copper, the soon in plain strong type. */
export function arrivalParts(
  notices: ArrivalNotices,
  timeZone: string,
): { readonly late: readonly SummaryPart[]; readonly soon: readonly SummaryPart[] } {
  const time = (arrival: SupplierArrival): string => formatWallTime(Date.parse(arrival.arrivesAt), timeZone);
  const [lateOne] = notices.late;
  const [soonOne] = notices.soon;
  const late: readonly SummaryPart[] = lateOne === undefined
    ? []
    : notices.late.length === 1
      ? [{ strong: lateOne.supplierName, tone: "copper" }, ` was due at ${time(lateOne)}.`]
      : [{ strong: `${countWord(notices.late.length)} suppliers`, tone: "copper" }, ` are late: ${listed(notices.late.map((arrival) => arrival.supplierName))}.`];
  const soon: readonly SummaryPart[] = soonOne === undefined
    ? []
    : notices.soon.length === 1
      ? [{ strong: soonOne.supplierName }, ` is due at ${time(soonOne)}${soonOne.entrance === null ? "" : ` (${soonOne.entrance})`}.`]
      : [{ strong: `${countWord(notices.soon.length)} suppliers` }, " are due within the hour."];
  return { late, soon };
}
