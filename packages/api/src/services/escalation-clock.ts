// ---------------------------------------------------------------------------
// Quiet hours on the venue's clock (goal 19 S7, D8).
//
// No escalation email leaves between the venue's quiet-hours start and end,
// read on the venue's wall clock (Europe/London unless told otherwise), so
// the two DST Sundays move with the clock on the wall and not with UTC. The
// in-product copy never sleeps; only email waits. A start after its end
// runs past midnight (22:00 to 07:00); equal start and end means no quiet
// hours at all.
// ---------------------------------------------------------------------------

export interface QuietHours {
  /** "HH:MM" on a 24-hour clock. */
  readonly start: string;
  readonly end: string;
}

export const VENUE_TIME_ZONE = "Europe/London";

const MINUTES_PER_DAY = 24 * 60;

function minutesOfClock(face: string): number {
  return Number.parseInt(face.slice(0, 2), 10) * 60 + Number.parseInt(face.slice(3, 5), 10);
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly minuteOfDay: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    partFormatters.set(zone, formatter);
  }
  return formatter;
}

/** The venue's wall clock at this instant. */
export function wallClockAt(nowMs: number, zone: string = VENUE_TIME_ZONE): WallClock {
  const parts = new Map(formatterFor(zone).formatToParts(new Date(nowMs)).map((part) => [part.type, part.value]));
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number.parseInt(parts.get(type) ?? "0", 10);
  return { year: read("year"), month: read("month"), day: read("day"), minuteOfDay: read("hour") * 60 + read("minute") };
}

/** Whether this instant falls inside the venue's quiet hours. The start
 *  minute is inside, the end minute is outside, so 22:00 to 07:00 holds
 *  22:00 and 06:59 and not 07:00. */
export function withinQuietHours(nowMs: number, quiet: QuietHours, zone: string = VENUE_TIME_ZONE): boolean {
  const start = minutesOfClock(quiet.start);
  const end = minutesOfClock(quiet.end);
  if (start === end) return false;
  const minute = wallClockAt(nowMs, zone).minuteOfDay;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

/** The instant the venue's wall clock next reads a given "HH:MM" at or
 *  after `nowMs` (today if still ahead, else tomorrow), found by stepping
 *  minute by minute from a UTC guess, so a DST fold or gap on the day lands
 *  on the wall-clock reading itself rather than an arithmetic offset. */
export function nextWallClockReading(nowMs: number, face: string, zone: string = VENUE_TIME_ZONE): number {
  const target = minutesOfClock(face);
  const today = wallClockAt(nowMs, zone);
  if (today.minuteOfDay === target) return nowMs - (nowMs % 60_000);
  // Start from the UTC midnight guess of the wall-clock date and walk
  // forward one minute at a time until the wall clock reads the target.
  // At most two days of minutes; the wall clock passes every reading at
  // least once in that span, DST folds and gaps included.
  const guess = Date.UTC(today.year, today.month - 1, today.day) - 3 * 3_600_000;
  const limit = guess + 2 * MINUTES_PER_DAY * 60_000;
  for (let candidate = Math.max(guess, nowMs - (nowMs % 60_000)); candidate <= limit; candidate += 60_000) {
    if (candidate >= nowMs && wallClockAt(candidate, zone).minuteOfDay === target) return candidate;
  }
  throw new Error(`No wall-clock reading ${face} within two days of ${new Date(nowMs).toISOString()} in ${zone}`);
}

/** When the quiet hours this instant sits in end: the next wall-clock
 *  reading of the end time. Outside quiet hours, the instant itself. */
export function quietHoursEndAfter(nowMs: number, quiet: QuietHours, zone: string = VENUE_TIME_ZONE): number {
  if (!withinQuietHours(nowMs, quiet, zone)) return nowMs;
  return nextWallClockReading(nowMs, quiet.end, zone);
}
