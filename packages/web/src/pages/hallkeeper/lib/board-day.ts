import { useEffect, useState } from "react";
import { getOperatingSettings } from "../../../api/operating-settings.js";
import { VENUE_TIME_ZONE, msToWallInput, wallInputToMs } from "../../diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The board's day (goal 19 S8 item 14; people matrix §6 `day_boundary_hour`).
//
// A venue's day does not end at midnight: an event that runs to 02:00 is
// still today's, and the wall tablet left on all night should go on showing
// it until the house's own boundary hour (04:00 by default), then roll once.
// Everything here is wall-clock arithmetic through board-time.ts, so a DST
// Sunday lands on the clock's 04:00 and never on 04:00 UTC plus an offset.
// A venue without an operating-settings row keeps midnight, as before S8.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" moved by whole days on the calendar, never by 86,400,000 ms
 *  on the instant (a DST day is 23 or 25 hours long). */
function shiftWallDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/** An instant at 12:00 wall time on the day the board shows for `nowMs`:
 *  before the boundary hour that is still yesterday. */
export function boardDayAnchorMs(nowMs: number, dayBoundaryHour: number, timeZone: string = VENUE_TIME_ZONE): number {
  const wall = msToWallInput(nowMs, timeZone);
  const date = wall.slice(0, 10);
  const hour = Number(wall.slice(11, 13));
  const shown = hour < dayBoundaryHour ? shiftWallDate(date, -1) : date;
  return wallInputToMs(`${shown}T12:00`, timeZone) ?? nowMs;
}

/** The next instant the wall clock reads the boundary hour, strictly after
 *  `nowMs`: today's reading if still ahead, else tomorrow's. */
export function nextBoardRolloverMs(nowMs: number, dayBoundaryHour: number, timeZone: string = VENUE_TIME_ZONE): number {
  const date = msToWallInput(nowMs, timeZone).slice(0, 10);
  const face = `${String(dayBoundaryHour).padStart(2, "0")}:00`;
  const today = wallInputToMs(`${date}T${face}`, timeZone);
  if (today !== null && today > nowMs) return today;
  return wallInputToMs(`${shiftWallDate(date, 1)}T${face}`, timeZone) ?? nowMs + DAY_MS;
}

/** The earlier of a slot boundary (null when no slot has one) and the rollover. */
export function soonerOf(slotBoundaryMs: number | null, rolloverMs: number): number {
  return slotBoundaryMs === null ? rolloverMs : Math.min(slotBoundaryMs, rolloverMs);
}

/** The venue's day boundary hour from its operating settings; 0 (midnight)
 *  until they arrive, and for a venue that has none. */
export function useDayBoundaryHour(venueId: string | null): number {
  const [hour, setHour] = useState(0);
  useEffect(() => {
    if (venueId === null) return;
    let disposed = false;
    getOperatingSettings(venueId)
      .then((settings) => { if (!disposed && settings !== null) setHour(settings.dayBoundaryHour); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [venueId]);
  return hour;
}
