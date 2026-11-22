import { VENUE_TIME_ZONE, msToWallInput } from "../../diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The board's day as a date, without React or the network (board-day.ts holds
// the hook that reads the venue's boundary hour). Pure, so the state machine,
// which the request surface and the event-day page also read, can count a
// long booking's days on the board's day and not the calendar's.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" moved by whole days on the calendar, never by 86,400,000 ms
 *  on the instant (a DST day is 23 or 25 hours long). */
export function shiftWallDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/** The date of the board's day that holds `ms`, venue-local: before the
 *  boundary hour that is still the calendar day before. Boundary 0 is the
 *  plain calendar date. */
export function boardDate(ms: number, dayBoundaryHour: number, timeZone: string = VENUE_TIME_ZONE): string {
  const wall = msToWallInput(ms, timeZone);
  const date = wall.slice(0, 10);
  const hour = Number(wall.slice(11, 13));
  return hour < dayBoundaryHour ? shiftWallDate(date, -1) : date;
}
