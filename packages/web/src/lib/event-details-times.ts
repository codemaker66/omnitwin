import { msToWallInput, VENUE_TIME_ZONE, wallInputToMs } from "../pages/diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// Event details' times, always in Glasgow time (T-674 slice 19; lens C-16).
//
// v1 read and wrote its deadlines and door times in the browser's zone, so a
// client in New York typing 18:00 saved 23:00 at the hall. Every time here is
// read and written in the venue's zone, Europe/London, whatever the device
// says, through the Diary's own wall-clock maths (board-time.ts).
//
// An act's start is typed as a clock time ("18:45") on the event's day. The
// venue's day runs 06:00 to 06:00, as the evening draws it, so a time before
// 06:00 belongs to the small hours after the event's day ("00:30" after a
// 19:00 dinner is the next morning).
// ---------------------------------------------------------------------------

export const GLASGOW_TIME_ZONE = VENUE_TIME_ZONE;

/** The venue's day starts at this hour; earlier clock times are the small hours after it. */
export const VENUE_DAY_START_HOUR = 6;

const MINUTE_MS = 60_000;

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: GLASGOW_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: GLASGOW_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric",
});

function readMs(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "18:45" in Glasgow time, or null for no or an unreadable time. */
export function glasgowClock(iso: string | null | undefined): string | null {
  const ms = readMs(iso);
  return ms === null ? null : CLOCK_FORMAT.format(new Date(ms));
}

/** "Sat 28 Nov 2026" in Glasgow, or null. */
export function glasgowDay(iso: string | null | undefined): string | null {
  const ms = readMs(iso);
  return ms === null ? null : DAY_FORMAT.format(new Date(ms)).replace(",", "");
}

/** A `datetime-local` value showing this instant in Glasgow time ("" for none). */
export function glasgowWallInput(iso: string | null | undefined): string {
  const ms = readMs(iso);
  return ms === null ? "" : msToWallInput(ms, GLASGOW_TIME_ZONE);
}

/**
 * A `datetime-local` value read as Glasgow time, as an ISO instant. Empty or
 * unreadable input returns the fallback unchanged (v1's rule): a cleared or
 * half-typed field never moves a saved time to now.
 */
export function fromGlasgowWallInput(value: string, fallback: string): string {
  if (value === "") return fallback;
  const ms = wallInputToMs(value, GLASGOW_TIME_ZONE);
  return ms === null ? fallback : new Date(ms).toISOString();
}

/** Minutes after midnight for a typed clock time: "18:45", "18.45", "1845" and "9:05" all read. */
export function parseClock(text: string): number | null {
  const cleaned = text.trim().replace(/\s+/g, "");
  const match = /^(\d{1,2})[:.h]?(\d{2})$/.exec(cleaned);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

interface WallDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The venue day an instant belongs to (06:00 to 06:00), as Glasgow's calendar date. */
function venueDayOf(ms: number): WallDate {
  const wall = msToWallInput(ms, GLASGOW_TIME_ZONE);
  const hour = Number(wall.slice(11, 13));
  const date = { year: Number(wall.slice(0, 4)), month: Number(wall.slice(5, 7)), day: Number(wall.slice(8, 10)) };
  if (hour >= VENUE_DAY_START_HOUR) return date;
  const before = new Date(Date.UTC(date.year, date.month - 1, date.day) - 24 * 60 * MINUTE_MS);
  return { year: before.getUTCFullYear(), month: before.getUTCMonth() + 1, day: before.getUTCDate() };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function wallOn(day: WallDate, minutes: number, nextDay: boolean): number | null {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day) + (nextDay ? 24 * 60 * MINUTE_MS : 0));
  const wall = `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return wallInputToMs(wall, GLASGOW_TIME_ZONE);
}

/**
 * The instant for a clock time on the event's venue day, in Glasgow time.
 * `anchorIso` is the act's own start when it has one, else the event's start;
 * with neither there is no day to put the time on and the answer is null.
 */
export function startOnVenueDay(minutes: number, anchorIso: string | null): string | null {
  const anchor = readMs(anchorIso);
  if (anchor === null) return null;
  const ms = wallOn(venueDayOf(anchor), minutes, minutes < VENUE_DAY_START_HOUR * 60);
  return ms === null ? null : new Date(ms).toISOString();
}

/** An instant this many minutes after another. */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();
}

/**
 * Where a new set-up deadline or door time starts (lens C-16: never v1's
 * "tomorrow 16:30 in the browser's zone"). With the event's start known, two
 * hours before it; otherwise 16:30 Glasgow time on the next venue day.
 */
export function defaultLeadTime(eventStartIso: string | null, now: Date, minutesBefore = 120): string {
  const start = readMs(eventStartIso);
  if (start !== null) return new Date(start - minutesBefore * MINUTE_MS).toISOString();
  const ms = wallOn(venueDayOf(now.getTime()), 16 * 60 + 30, true);
  return new Date(ms ?? now.getTime()).toISOString();
}

/** "1 h 30 min", "45 min", "2 h". */
export function durationWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
