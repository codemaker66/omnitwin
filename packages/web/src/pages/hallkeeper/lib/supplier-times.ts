import { addRotaDays } from "@omnitwin/types";
import { msToWallInput, wallInputToMs } from "../../diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// A supplier's times on the board's day (T-692), pure.
//
// The board's day runs from its date's midnight to the next date's boundary
// hour (04:00 at Trades Hall), so a time typed for it before that hour is in
// the small hours after it: the DJ in at 00:30 is the next date's 00:30. A
// leaving time before the arrival is the morning after it. Every time is read
// on the venue's clock. A time the clock skips (01:30 on the night the clocks
// go forward) is named, never stored as another time without saying so.
// ---------------------------------------------------------------------------

/** The board's day an instant falls on: before the boundary hour, the date before. */
export function boardDayOf(ms: number, dayBoundaryHour: number, timeZone: string): string {
  const wall = msToWallInput(ms, timeZone);
  const date = wall.slice(0, 10);
  return Number(wall.slice(11, 13)) < dayBoundaryHour ? addRotaDays(date, -1) : date;
}

export interface SupplierTimes {
  readonly arrivesMs: number;
  readonly leavesMs: number | null;
  /** A typed time the venue's clock skips that night, and the time it would be stored as. */
  readonly skipped: { readonly field: "arrives" | "leaves"; readonly typed: string; readonly stored: string } | null;
}

const CLOCK = /^\d{2}:\d{2}$/u;

/** Where a typed "HH:MM" lands on `date`, and what the clock would read there. */
function onDate(date: string, clock: string, timeZone: string): { readonly ms: number; readonly reads: string } | null {
  const ms = wallInputToMs(`${date}T${clock}`, timeZone);
  if (ms === null) return null;
  const wall = msToWallInput(ms, timeZone);
  return { ms, reads: wall === `${date}T${clock}` ? clock : wall.slice(11, 16) };
}

/**
 * The "HH:MM" times typed for the board's day `boardDay` as instants, or null
 * when the arrival time is missing or either cannot be read. With no leaving
 * time, `leavesMs` is null.
 */
export function supplierTimes(
  arrives: string,
  leaves: string,
  boardDay: string,
  dayBoundaryHour: number,
  timeZone: string,
): SupplierTimes | null {
  if (!CLOCK.test(arrives) || (leaves !== "" && !CLOCK.test(leaves))) return null;
  const boundary = `${String(dayBoundaryHour).padStart(2, "0")}:00`;
  const date = arrives < boundary ? addRotaDays(boardDay, 1) : boardDay;
  const arrival = onDate(date, arrives, timeZone);
  if (arrival === null) return null;
  const arrivalSkipped = arrival.reads === arrives ? null : { field: "arrives" as const, typed: arrives, stored: arrival.reads };
  if (leaves === "") return { arrivesMs: arrival.ms, leavesMs: null, skipped: arrivalSkipped };
  const sameDate = onDate(date, leaves, timeZone);
  const leaving = sameDate !== null && sameDate.ms > arrival.ms ? sameDate : onDate(addRotaDays(date, 1), leaves, timeZone);
  if (leaving === null) return null;
  const leavingSkipped = leaving.reads === leaves ? null : { field: "leaves" as const, typed: leaves, stored: leaving.reads };
  return { arrivesMs: arrival.ms, leavesMs: leaving.ms, skipped: arrivalSkipped ?? leavingSkipped };
}
