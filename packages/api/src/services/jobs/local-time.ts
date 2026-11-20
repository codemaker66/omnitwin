import { wallClockAt } from "../escalation-clock.js";

// ---------------------------------------------------------------------------
// The job list (T-702): a time on a venue's own clock, as an instant.
//
// `nextLocalTime` is pure: no database, no clock of its own. It reads a zone's
// wall clock through `wallClockAt` (Intl.DateTimeFormat) and never steps
// minute by minute across days. For one local date it works out which
// instants the wall clock reads the wanted time at, from the zone's offset
// either side of that date, so the two clock-change days come out right:
//
//   - a time that happens twice (clocks go back) is its FIRST occurrence;
//   - a time that does not exist (clocks go forward) is the first instant
//     after the gap.
//
// One run per local date: the answer for a date is a single instant, so a
// daily job does not fire at both passes through a repeated hour.
// ---------------------------------------------------------------------------

const CLOCK_FACE = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** The local date of `after` and the two after it. A whole date missing from a zone's calendar is the only reason to need the third. */
const DATES_TO_TRY = 3;

/** The zone's wall clock at this instant, read as if it were UTC, to the minute. */
function wallAsUtcMs(instantMs: number, zone: string): number {
  const wall = wallClockAt(instantMs, zone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, 0, wall.minuteOfDay);
}

/** How far the zone's wall clock is ahead of UTC at this instant. */
function offsetMs(instantMs: number, zone: string): number {
  return wallAsUtcMs(instantMs, zone) - Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
}

/**
 * The first instant at which the zone's wall clock reads `wallMs` (a wall time
 * written as if it were UTC). The offset a day either side of the date is the
 * offset before and after any change on that date, and each gives one
 * candidate instant: a candidate is real if the clock reads the wanted time
 * there. Both real means the time happens twice, and the earlier is wanted.
 * Neither real means the time is in the gap, so the answer is the change
 * itself, found by halving the span between the two candidates.
 */
function firstReadingOfWall(wallMs: number, zone: string): number {
  const before = offsetMs(wallMs - DAY_MS, zone);
  const after = offsetMs(wallMs + DAY_MS, zone);
  const candidates = [...new Set([before, after])]
    .map((offset) => wallMs - offset)
    .filter((candidate) => wallAsUtcMs(candidate, zone) === wallMs)
    .sort((left, right) => left - right);
  const first = candidates[0];
  if (first !== undefined) return first;

  let low = Math.min(wallMs - before, wallMs - after);
  let high = Math.max(wallMs - before, wallMs - after);
  const offsetBeforeChange = offsetMs(low, zone);
  if (offsetMs(high, zone) === offsetBeforeChange) {
    throw new Error(`The zone "${zone}" has no instant for the wall time on that date`);
  }
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / (2 * MINUTE_MS)) * MINUTE_MS;
    if (offsetMs(middle, zone) === offsetBeforeChange) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * The first instant strictly after `after` at which the zone's wall clock reads
 * `hhmm` ("09:00"). A time that does not exist that day (clocks go forward)
 * becomes the first instant after the gap; a time that happens twice (clocks
 * go back) is its first occurrence. Throws on a malformed time, an unknown
 * zone or an invalid instant.
 */
export function nextLocalTime(after: Date, hhmm: string, timeZone: string): Date {
  const face = CLOCK_FACE.exec(hhmm);
  if (face === null) throw new Error("The time of day must be written HH:MM on a 24-hour clock");
  const hours = Number.parseInt(face[1] ?? "", 10);
  const minutes = Number.parseInt(face[2] ?? "", 10);
  const afterMs = after.getTime();
  if (Number.isNaN(afterMs)) throw new Error("The instant to look after is not a date");

  // An unknown zone is refused here: Intl throws a RangeError for it.
  const today = wallClockAt(afterMs, timeZone);
  for (let dayIndex = 0; dayIndex < DATES_TO_TRY; dayIndex += 1) {
    const wallMs = Date.UTC(today.year, today.month - 1, today.day + dayIndex, hours, minutes);
    const instant = firstReadingOfWall(wallMs, timeZone);
    if (instant > afterMs) return new Date(instant);
  }
  throw new Error(`The zone "${timeZone}" has no ${hhmm} within three days of the given instant`);
}
