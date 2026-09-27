import type { CalendarBookingEntry, CalendarEntry, CalendarRoom } from "@omnitwin/types";
import { msToWallInput } from "./board-time.js";

// ---------------------------------------------------------------------------
// Go to date (roadmap N3, "Finding dates"). A booker types a date the way it
// was said on the phone ("5 Jun 27", "the 5th of June", "05/06/2027") and
// the board goes there and answers per room: "Grand Hall — Free", "Saloon —
// 1st option Fraser wedding, 13:00–23:00, decides Mon 12 Oct".
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const WEEKDAYS: Readonly<Record<string, number>> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** A weekday before the date ("Sat 5 Jun", "Friday the 5th of June"),
 *  spelled as people write them, so "wedding 5 June" names no weekday. */
const WEEKDAY_FIRST = /^(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\.? /u;

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A two-digit year is this century's; a missing one is the next such day
 *  on or after today. */
function withYear(day: number, month: number, year: string | undefined, today: string): string | null {
  if (year !== undefined) return iso(year.length === 2 ? 2000 + Number(year) : Number(year), month, day);
  const thisYear = Number(today.slice(0, 4));
  const candidate = iso(thisYear, month, day);
  if (candidate !== null && candidate >= today) return candidate;
  // 29 Feb in a year without one looks ahead to the next that has it.
  for (let year = thisYear + 1; year <= thisYear + 8; year += 1) {
    const next = iso(year, month, day);
    if (next !== null) return next;
  }
  return null;
}

/** Lower case, single-spaced, without commas or "the" and "of". */
function plainWords(input: string): string {
  return input.toLowerCase().replace(/,/gu, " ").replace(/\bthe\b|\bof\b/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * The venue-local date ("YYYY-MM-DD") the words name, or null. `today` is
 * the venue's own date, "YYYY-MM-DD". Days come before months, the British
 * way: 05/06/27 is the 5th of June.
 */
export function parseGoToDate(input: string, today: string): string | null {
  const words = plainWords(input);
  if (words.length === 0) return null;
  if (words === "today") return today;
  if (words === "tomorrow") {
    const [y, m, d] = today.split("-").map(Number);
    const next = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1));
    return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  // The date decides, not the weekday said with it (see saidWeekday).
  const named = words.replace(WEEKDAY_FIRST, "");
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(named);
  if (isoMatch !== null) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/u.exec(named);
  if (numeric !== null) return withYear(Number(numeric[1]), Number(numeric[2]), numeric[3], today);
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}|\d{2}))?$/u.exec(named);
  if (dayFirst !== null) {
    const month = MONTHS[dayFirst[2] ?? ""];
    return month === undefined ? null : withYear(Number(dayFirst[1]), month, dayFirst[3], today);
  }
  const monthFirst = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}|\d{2}))?$/u.exec(named);
  if (monthFirst !== null) {
    const month = MONTHS[monthFirst[1] ?? ""];
    return month === undefined ? null : withYear(Number(monthFirst[2]), month, monthFirst[3], today);
  }
  return null;
}

/** The weekday said before the date (0 is Sunday), or null. When it is not
 *  the date's own weekday the booker is told, since one of the two was
 *  misheard. */
export function saidWeekday(input: string): number | null {
  const match = WEEKDAY_FIRST.exec(plainWords(input));
  return match === null ? null : WEEKDAYS[(match[1] ?? "").slice(0, 3)] ?? null;
}

/** What one room holds on the day sought, before it is put into words. */
export interface RoomAnswer {
  readonly roomId: string;
  readonly room: string;
  /** What holds the room that day, by start time: confirmed bookings, the
   *  holds no confirmed booking overlaps (each with its own place on its
   *  ladder), and house blocks. None when the room is free. */
  readonly bookings: readonly CalendarBookingEntry[];
  /** On a free day, the interest only there is, by title. */
  readonly interest: readonly string[];
  /** On a free day, when the night before's event ends in the small hours. */
  readonly freeFromMs: number | null;
}

/** The latest hour of the morning at which the night before's event may
 *  still be finishing without taking the day. */
const SMALL_HOURS_END = "06:00";

const UNRANKED = Number.MAX_SAFE_INTEGER;

function overlaps(a: CalendarBookingEntry, b: CalendarBookingEntry): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt);
}

/**
 * What each room holds on one day. An event that began the day before and
 * ends by 06:00 is that night running late: it does not take the day, and a
 * room with nothing else is free from when it ends. A hold that a confirmed
 * booking overlaps is left out, since the confirmed booking has that time.
 */
export function roomsOnDay(
  entries: readonly CalendarEntry[],
  rooms: readonly CalendarRoom[],
  day: { readonly startMs: number; readonly endMs: number },
): readonly RoomAnswer[] {
  const date = msToWallInput(day.startMs).slice(0, 10);
  const lateNight = (entry: CalendarBookingEntry): boolean => {
    if (Date.parse(entry.startsAt) >= day.startMs) return false;
    const end = msToWallInput(Date.parse(entry.endsAt));
    return end.slice(0, 10) === date && end.slice(11, 16) <= SMALL_HOURS_END;
  };
  return rooms.map((room): RoomAnswer => {
    const inRoom = entries.filter((entry): entry is CalendarBookingEntry =>
      entry.entryType === "booking" && entry.spaceId === room.id && entry.status === "active"
      && Date.parse(entry.startsAt) < day.endMs && Date.parse(entry.endsAt) > day.startMs);
    const that = inRoom.filter((entry) => !lateNight(entry));
    const confirmed = that.filter((entry) => entry.kind === "ink");
    const bookings = that
      .filter((entry) => entry.kind === "ink" || entry.kind === "internal_block"
        || (entry.kind === "hold" && !confirmed.some((ink) => overlaps(ink, entry))))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
        || (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED) || a.id.localeCompare(b.id));
    if (bookings.length > 0) return { roomId: room.id, room: room.name, bookings, interest: [], freeFromMs: null };
    // Interest only never holds the room, so it never makes it free later.
    const ends = inRoom.filter((entry) => entry.kind !== "prospect" && lateNight(entry)).map((entry) => Date.parse(entry.endsAt));
    return {
      roomId: room.id,
      room: room.name,
      bookings,
      interest: that.filter((entry) => entry.kind === "prospect").map((entry) => entry.title),
      freeFromMs: ends.length === 0 ? null : Math.max(...ends),
    };
  });
}
