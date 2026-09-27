import { venueDay } from "../components/hallkeeper/sheet-facts.js";

// ---------------------------------------------------------------------------
// The event-day board's words for when its event is (roadmap N4). The board
// said "Today's event" whatever the date, so a board opened the day before,
// or kept open past midnight, told the room the wrong day. Days are counted
// on the venue's calendar, not the device's.
// ---------------------------------------------------------------------------

/** Whole days from the venue's today to the event's day, or null when the
 *  event has no readable date. */
export function daysFromToday(iso: string | null, timeZone: string, nowMs: number): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const midnight = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);
  return Math.round((midnight(venueDay(ms, timeZone)) - midnight(venueDay(nowMs, timeZone))) / 86_400_000);
}

/** The board's kicker: "Today's event", "Tomorrow's event", "Yesterday's
 *  event", "In 5 days" or "3 days ago". */
export function eventDayKicker(iso: string | null, timeZone: string, nowMs: number): string {
  const days = daysFromToday(iso, timeZone, nowMs);
  if (days === null) return "Date not set";
  if (days === 0) return "Today's event";
  if (days === 1) return "Tomorrow's event";
  if (days === -1) return "Yesterday's event";
  return days > 0 ? `In ${String(days)} days` : `${String(-days)} days ago`;
}
