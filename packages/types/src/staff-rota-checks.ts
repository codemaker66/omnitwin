import type {
  RotaIssueCode,
  RotaIssueSeverity,
  RotaKeptWarning,
  RotaShiftStatus,
  RotaSkill,
  StaffUnavailabilityReason,
} from "./staff-rota.js";

// ---------------------------------------------------------------------------
// Working-time checks for the staff rota (T-637 slice B). Pure.
//
// Given one person and their shifts, say in plain words where the week falls
// short of the Working Time Regulations 1998, the Licensing (Scotland) Act
// 2005 and the right-to-work rules. The API is the authority: it runs these
// over a person's last seventeen weeks and refuses the two legal blocks. The
// web renders what the API sends.
//
// Every day, clock time and week here is the venue's, read through Intl with
// an explicit zone. Nothing reads a UTC wall clock: that is how the hallkeeper
// sheet came to show an 18:00 start as 19:00 all summer.
//
// Planning support, not legal advice. Where the regulations offer a choice,
// the default applies: a week runs Monday to Sunday (reg 11(6)), night work
// for an under-18 is 22:00 to 06:00 (reg 6A), and the 48-hour average is
// taken over 17 weeks (reg 4(3)).
// ---------------------------------------------------------------------------

export const ROTA_DEFAULT_TIME_ZONE = "Europe/London";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// ---------------------------------------------------------------------------
// The venue's clock
// ---------------------------------------------------------------------------

/** The venue's zone when it is a real IANA zone; Europe/London otherwise. */
export function resolveRotaTimeZone(timeZone: string | null | undefined): string {
  if (timeZone === null || timeZone === undefined || timeZone.trim() === "") return ROTA_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return ROTA_DEFAULT_TIME_ZONE;
  }
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = wallFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateParts(date: string): readonly [number, number, number] {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

/** The venue's calendar date for an instant, as YYYY-MM-DD. */
export function rotaLocalDate(ms: number, timeZone: string): string {
  const wall = wallClock(ms, timeZone);
  return `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** Minutes past the venue's midnight, 0–1439. */
export function rotaMinuteOfDay(ms: number, timeZone: string): number {
  const wall = wallClock(ms, timeZone);
  return wall.hour * 60 + wall.minute;
}

function offsetMs(ms: number, timeZone: string): number {
  const wall = wallClock(ms, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - (ms - (ms % MINUTE_MS));
}

/**
 * The instant at which the venue's clock reads `minuteOfDay` on `date`.
 * Minutes past 1440 run into the next day. A time the clocks skip in spring
 * maps just past the change; a time that happens twice in autumn resolves to
 * the second, both deterministically.
 */
export function rotaInstant(date: string, minuteOfDay: number, timeZone: string): number {
  const [year, month, day] = dateParts(date);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  return wallAsUtc - offsetMs(firstGuess, timeZone);
}

/** Calendar arithmetic on YYYY-MM-DD, free of any zone. */
export function addRotaDays(date: string, days: number): string {
  const [year, month, day] = dateParts(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(moved.getUTCFullYear())}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** 0 for Monday through 6 for Sunday. */
export function rotaWeekdayIndex(date: string): number {
  const [year, month, day] = dateParts(date);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week holding `date`. */
export function rotaMondayOf(date: string): string {
  return addRotaDays(date, -rotaWeekdayIndex(date));
}

/** The week holding an instant, by the venue's calendar. */
export function rotaWeekStartOf(ms: number, timeZone: string): string {
  return rotaMondayOf(rotaLocalDate(ms, timeZone));
}

/** A week's instants: Monday 00:00 to the next Monday 00:00 on the venue's
 *  clock, so a week with a clock change is 167 or 169 hours long. */
export function rotaWeekBounds(weekStart: string, timeZone: string): { readonly fromMs: number; readonly toMs: number } {
  return { fromMs: rotaInstant(weekStart, 0, timeZone), toMs: rotaInstant(addRotaDays(weekStart, 7), 0, timeZone) };
}

/** The seven dates of a week, Monday first. */
export function rotaWeekDates(weekStart: string): readonly string[] {
  return Array.from({ length: 7 }, (_, index) => addRotaDays(weekStart, index));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "Saturday". */
export function rotaWeekdayName(date: string): string {
  return WEEKDAYS[rotaWeekdayIndex(date)] ?? "";
}

/** "10 October". */
export function rotaDayMonth(date: string): string {
  const [, month, day] = dateParts(date);
  return `${String(day)} ${MONTHS[month - 1] ?? ""}`;
}

/** "10 October 2026". */
export function rotaDayMonthYear(date: string): string {
  const [year] = dateParts(date);
  return `${rotaDayMonth(date)} ${String(year)}`;
}

/** "Saturday 10 October". */
export function rotaLongDay(date: string): string {
  return `${rotaWeekdayName(date)} ${rotaDayMonth(date)}`;
}

/** "08:00", on the venue's clock. */
export function rotaClock(ms: number, timeZone: string): string {
  const wall = wallClock(ms, timeZone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** "9 hours", "9 hours 30 minutes", "1 hour", "45 minutes". */
export function rotaDurationWords(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts = [
    hours === 0 ? null : `${String(hours)} ${hours === 1 ? "hour" : "hours"}`,
    rest === 0 ? null : `${String(rest)} ${rest === 1 ? "minute" : "minutes"}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "no time" : parts.join(" ");
}

/** "9 h", "9 h 30", "45 min": for tight places. */
export function rotaDurationShort(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${pad(rest)}`;
}

/** How a shift in each role reads in a sentence: "Saturday's set-up". */
export const ROTA_ROLE_NOUNS: Readonly<Record<RotaSkill, string>> = {
  setup: "set-up",
  bar: "bar shift",
  duty_manager: "duty manager shift",
  first_aid: "first-aid cover",
  av: "AV shift",
};

/** Whole hours of notice before a shift starts; none once it has started. */
export function rotaNoticeHours(changedAtMs: number, startsAtMs: number): number {
  return Math.max(0, Math.floor((startsAtMs - changedAtMs) / HOUR_MS));
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface RotaCheckPerson {
  readonly displayName: string;
  /** Only for someone under 18: the day they turn 18. */
  readonly turns18On: string | null;
  readonly barTrainedOn: string | null;
  readonly rightToWorkCheckedOn: string | null;
  readonly rightToWorkExpiresOn: string | null;
  readonly workingTimeOptOut: boolean;
}

export interface RotaCheckShift {
  readonly id: string;
  readonly role: RotaSkill;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly status: RotaShiftStatus;
}

export interface RotaCheckAbsence {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: StaffUnavailabilityReason;
}

export interface RotaCheckInput {
  readonly person: RotaCheckPerson;
  /** The person's shifts around the ones being judged. Cancelled shifts are
   *  ignored; for the 48-hour average, pass the 16 weeks before as well. */
  readonly shifts: readonly RotaCheckShift[];
  readonly absences: readonly RotaCheckAbsence[];
  readonly timeZone: string;
}

export interface RotaFinding {
  readonly code: RotaIssueCode;
  readonly severity: RotaIssueSeverity;
  readonly message: string;
  readonly short: string;
}

interface Timed {
  readonly shift: RotaCheckShift;
  readonly start: number;
  readonly end: number;
  /** Working minutes: the shift less its break. */
  readonly work: number;
  /** The venue's date the shift starts on. */
  readonly date: string;
  readonly week: string;
  readonly young: boolean;
}

/** Under 18 on the venue's date `date`. */
export function rotaIsUnder18On(turns18On: string | null, date: string): boolean {
  return turns18On !== null && date < turns18On;
}

const ADULT_REST_MINUTES = 11 * 60;
const YOUNG_REST_MINUTES = 12 * 60;
const ADULT_BREAK_AFTER = 6 * 60;
const ADULT_BREAK = 20;
const YOUNG_BREAK_AFTER = 4 * 60 + 30;
const YOUNG_BREAK = 30;
const ADULT_WEEKLY_REST_MINUTES = 24 * 60;
const YOUNG_WEEKLY_REST_MINUTES = 48 * 60;
const YOUNG_DAY_MINUTES = 8 * 60;
const YOUNG_WEEK_MINUTES = 40 * 60;
const AVERAGE_WEEKS = 17;
const AVERAGE_LIMIT_MINUTES = 48 * 60;

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/** Each of the venue's windows [from, to) on the days a shift touches. */
function touchesWindow(item: Timed, fromMinute: number, toMinute: number, timeZone: string): boolean {
  const firstDay = addRotaDays(rotaLocalDate(item.start, timeZone), -1);
  const lastDay = rotaLocalDate(item.end, timeZone);
  for (let day = firstDay; day <= lastDay; day = addRotaDays(day, 1)) {
    const windowStart = rotaInstant(day, fromMinute, timeZone);
    const windowEnd = rotaInstant(day, toMinute, timeZone);
    if (overlaps(item.start, item.end, windowStart, windowEnd)) return true;
  }
  return false;
}

function absenceWords(absence: RotaCheckAbsence, timeZone: string): string {
  const start = Date.parse(absence.startsAt);
  const end = Date.parse(absence.endsAt);
  const startDate = rotaLocalDate(start, timeZone);
  const wholeDays = rotaMinuteOfDay(start, timeZone) === 0 && rotaMinuteOfDay(end, timeZone) === 0;
  if (wholeDays) {
    const lastDate = addRotaDays(rotaLocalDate(end, timeZone), -1);
    return lastDate === startDate ? `on ${rotaLongDay(startDate)}` : `from ${rotaLongDay(startDate)} to ${rotaLongDay(lastDate)}`;
  }
  const endDate = rotaLocalDate(end, timeZone);
  return endDate === startDate
    ? `on ${rotaLongDay(startDate)}, ${rotaClock(start, timeZone)} to ${rotaClock(end, timeZone)}`
    : `from ${rotaLongDay(startDate)} ${rotaClock(start, timeZone)} to ${rotaLongDay(endDate)} ${rotaClock(end, timeZone)}`;
}

function averageWords(minutes: number): string {
  const hours = Math.round(minutes / 6) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * Every finding for each of the person's shifts, keyed by shift id. A shift
 * with nothing to say has no entry.
 */
export function checkRotaWorkingTime(input: RotaCheckInput): ReadonlyMap<string, readonly RotaFinding[]> {
  const { person, timeZone } = input;
  const name = person.displayName;
  const found = new Map<string, RotaFinding[]>();
  const add = (shiftId: string, finding: RotaFinding): void => {
    const list = found.get(shiftId);
    if (list === undefined) found.set(shiftId, [finding]);
    else list.push(finding);
  };

  const timed: Timed[] = input.shifts
    .filter((shift) => shift.status !== "cancelled")
    .map((shift) => {
      const start = Date.parse(shift.startsAt);
      const end = Date.parse(shift.endsAt);
      const date = rotaLocalDate(start, timeZone);
      return {
        shift, start, end, date,
        week: rotaMondayOf(date),
        work: Math.max(0, (end - start) / MINUTE_MS - shift.breakMinutes),
        young: rotaIsUnder18On(person.turns18On, date),
      };
    })
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start || left.shift.id.localeCompare(right.shift.id));

  const label = (item: Timed): string => `${rotaWeekdayName(item.date)}'s ${ROTA_ROLE_NOUNS[item.shift.role]}`;
  const span = (item: Timed): string => `${rotaClock(item.start, timeZone)} to ${rotaClock(item.end, timeZone)}`;

  // Rest between working days (reg 10, as gov.uk puts it: finish at 20:00,
  // start no earlier than 07:00 the next day). A split shift within one day
  // is one working day, so its gap is not the daily rest. A working day is
  // the venue's date a shift starts on; a late finish counts to that day.
  const workingDays = [...new Set(timed.map((item) => item.date))];
  for (const [index, date] of workingDays.entries()) {
    const previousDate = workingDays[index - 1];
    if (previousDate === undefined) continue;
    const before = timed.filter((item) => item.date === previousDate);
    const first = timed.find((item) => item.date === date);
    const lastBefore = before.reduce<Timed | undefined>((latest, item) => latest === undefined || item.end > latest.end ? item : latest, undefined);
    if (first === undefined || lastBefore === undefined) continue;
    const gap = (first.start - lastBefore.end) / MINUTE_MS;
    // Overlapping shifts are a double booking, said below.
    if (gap < 0) continue;
    const needed = first.young ? YOUNG_REST_MINUTES : ADULT_REST_MINUTES;
    if (gap < needed) {
      const neededWords = first.young ? `${String(needed / 60)} are needed for someone under 18` : `${String(needed / 60)} are needed`;
      add(first.shift.id, {
        code: "short_rest", severity: "warning",
        message: `${name} would have ${rotaDurationWords(gap)} between ${label(lastBefore)} and ${label(first)}; ${neededWords}.`,
        short: `${rotaDurationShort(gap)} rest before; ${String(needed / 60)} needed`,
      });
    }
  }

  for (const [index, current] of timed.entries()) {
    const { shift } = current;

    // Two shifts at once.
    const clash = timed.slice(0, index).find((earlier) => earlier.end > current.start);
    if (clash !== undefined) {
      add(shift.id, {
        code: "double_booked", severity: "warning",
        message: `${name} is also on ${label(clash)}, ${span(clash)}.`,
        short: "Overlaps another shift",
      });
    }

    // The rest break within the shift.
    const breakAfter = current.young ? YOUNG_BREAK_AFTER : ADULT_BREAK_AFTER;
    const breakNeeded = current.young ? YOUNG_BREAK : ADULT_BREAK;
    if (current.work > breakAfter && shift.breakMinutes < breakNeeded) {
      const has = shift.breakMinutes === 0 ? "no break" : `a ${String(shift.breakMinutes)}-minute break`;
      const rule = current.young
        ? `as ${name} is under 18, ${String(breakNeeded)} minutes are needed over ${rotaDurationWords(breakAfter)}`
        : `${String(breakNeeded)} minutes are needed over ${rotaDurationWords(breakAfter)}`;
      add(shift.id, {
        code: "no_break", severity: "warning",
        message: `${name}'s ${ROTA_ROLE_NOUNS[shift.role]} on ${rotaWeekdayName(current.date)} runs ${rotaDurationWords((current.end - current.start) / MINUTE_MS)} with ${has}; ${rule}.`,
        short: shift.breakMinutes === 0 ? `No break; ${String(breakNeeded)} min needed` : `Break ${String(shift.breakMinutes)} min; ${String(breakNeeded)} needed`,
      });
    }

    // Under 18: never midnight to 04:00, and 22:00 to 06:00 only with care.
    if (current.young) {
      if (touchesWindow(current, 0, 4 * 60, timeZone)) {
        add(shift.id, {
          code: "young_small_hours", severity: "block",
          message: `${name} is under 18, so cannot work between midnight and 04:00. This shift runs ${span(current)}.`,
          short: "Under 18: not midnight to 04:00",
        });
      } else if (touchesWindow(current, 22 * 60, 30 * 60, timeZone)) {
        add(shift.id, {
          code: "young_night", severity: "warning",
          message: `${name} is under 18 and this shift runs ${span(current)}. Work between 22:00 and 06:00 is for when no adult can do it, with an adult supervising and the rest given back.`,
          short: "Late or early for an under-18",
        });
      }
    }

    // The right to work, before anything is published.
    if (person.rightToWorkCheckedOn === null) {
      if (shift.status === "draft") {
        add(shift.id, {
          code: "right_to_work_missing", severity: "block",
          message: `${name} has no right-to-work check recorded, so this shift cannot be published until one is.`,
          short: "No right-to-work check",
        });
      }
    } else if (person.rightToWorkExpiresOn !== null && current.date > person.rightToWorkExpiresOn) {
      add(shift.id, {
        code: "right_to_work_expired", severity: "warning",
        message: `${name}'s right-to-work check ran to ${rotaDayMonthYear(person.rightToWorkExpiresOn)}; a follow-up check is needed before this shift.`,
        short: "Right to work has expired",
      });
    }

    // Bar training before anyone sells alcohol.
    if (shift.role === "bar") {
      if (person.barTrainedOn === null) {
        add(shift.id, {
          code: "bar_training", severity: "warning",
          message: `${name} has no bar training recorded. Anyone who sells alcohol needs it first.`,
          short: "No bar training recorded",
        });
      } else if (person.barTrainedOn > current.date) {
        add(shift.id, {
          code: "bar_training", severity: "warning",
          message: `${name}'s bar training is recorded for ${rotaDayMonthYear(person.barTrainedOn)}, after this shift. Anyone who sells alcohol needs it first.`,
          short: "Bar training comes after this",
        });
      }
    }

    // Leave, or a time they said they cannot work.
    const away = input.absences.find((absence) =>
      overlaps(current.start, current.end, Date.parse(absence.startsAt), Date.parse(absence.endsAt)));
    if (away !== undefined) {
      add(shift.id, {
        code: "unavailable", severity: "warning",
        message: away.reason === "leave"
          ? `${name} is on leave ${absenceWords(away, timeZone)}.`
          : `${name} is marked unavailable ${absenceWords(away, timeZone)}.`,
        short: away.reason === "leave" ? "On leave" : "Marked unavailable",
      });
    }
  }

  // Day and week totals land on the last shift of the day or week: the one
  // that tips it over when the week is built in order.
  const lastOf = (items: readonly Timed[]): Timed | undefined => items[items.length - 1];

  const byDay = new Map<string, Timed[]>();
  const byWeek = new Map<string, Timed[]>();
  for (const item of timed) {
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
    byWeek.set(item.week, [...(byWeek.get(item.week) ?? []), item]);
  }

  for (const [date, items] of byDay) {
    const last = lastOf(items);
    if (last === undefined || !last.young) continue;
    const total = items.reduce((sum, item) => sum + item.work, 0);
    if (total > YOUNG_DAY_MINUTES) {
      add(last.shift.id, {
        code: "young_long_day", severity: "warning",
        message: `${name} is under 18, so should work no more than 8 hours a day; ${rotaWeekdayName(date)}'s shifts come to ${rotaDurationWords(total)}.`,
        short: "Over 8 hours in a day",
      });
    }
  }

  for (const [week, items] of byWeek) {
    const last = lastOf(items);
    if (last === undefined) continue;
    const young = items.some((item) => item.young);

    if (young) {
      const total = items.reduce((sum, item) => sum + item.work, 0);
      if (total > YOUNG_WEEK_MINUTES) {
        add(last.shift.id, {
          code: "young_long_week", severity: "warning",
          message: `${name} is under 18, so should work no more than 40 hours a week; the week of ${rotaDayMonth(week)} comes to ${rotaDurationWords(total)}.`,
          short: "Over 40 hours this week",
        });
      }
    }

    // A day off: the longest stretch without work inside the week.
    const { fromMs, toMs } = rotaWeekBounds(week, timeZone);
    const inWeek = timed
      .filter((item) => overlaps(item.start, item.end, fromMs, toMs))
      .map((item) => [Math.max(item.start, fromMs), Math.min(item.end, toMs)] as const);
    let longest = 0;
    let cursor = fromMs;
    for (const [start, end] of inWeek) {
      longest = Math.max(longest, start - cursor);
      cursor = Math.max(cursor, end);
    }
    longest = Math.max(longest, toMs - cursor);
    const neededRest = young ? YOUNG_WEEKLY_REST_MINUTES : ADULT_WEEKLY_REST_MINUTES;
    if (longest / MINUTE_MS < neededRest) {
      const hours = String(neededRest / 60);
      add(last.shift.id, {
        code: "no_day_off", severity: "warning",
        message: young
          ? `${name} would not have ${hours} hours off in the week of ${rotaDayMonth(week)}, as under-18s need; the longest break is ${rotaDurationWords(longest / MINUTE_MS)}.`
          : `${name} would not have ${hours} hours off in the week of ${rotaDayMonth(week)}; the longest break is ${rotaDurationWords(longest / MINUTE_MS)}.`,
        short: `No ${hours} hours off this week`,
      });
    }

    // The 48-hour average over the 17 weeks to this one.
    if (!person.workingTimeOptOut) {
      const firstWeek = addRotaDays(week, -7 * (AVERAGE_WEEKS - 1));
      const total = timed
        .filter((item) => item.week >= firstWeek && item.week <= week)
        .reduce((sum, item) => sum + item.work, 0);
      const average = total / AVERAGE_WEEKS;
      if (average > AVERAGE_LIMIT_MINUTES) {
        add(last.shift.id, {
          code: "long_average", severity: "warning",
          message: `${name}'s hours would average ${averageWords(average)} a week over the 17 weeks to ${rotaDayMonth(addRotaDays(week, 6))}; the limit is 48 unless ${name} opts out in writing.`,
          short: `Averages ${averageWords(average)} hours a week`,
        });
      }
    }
  }

  return found;
}

/**
 * The findings that stop a shift being saved at all: an under-18 between
 * midnight and 04:00. The right-to-work block stops publishing only, so a
 * week can be planned while the check is arranged.
 */
export function rotaSaveBlocks(findings: readonly RotaFinding[]): readonly RotaFinding[] {
  return findings.filter((finding) => finding.code === "young_small_hours");
}

/** The findings that stop a shift being published. */
export function rotaPublishBlocks(findings: readonly RotaFinding[]): readonly RotaFinding[] {
  return findings.filter((finding) => finding.severity === "block");
}

/** Attach each kept warning to its finding. A block is never kept. */
export function withKeptWarnings(
  findings: readonly RotaFinding[],
  kept: readonly RotaKeptWarning[],
): readonly (RotaFinding & { readonly kept: RotaKeptWarning | null })[] {
  return findings.map((finding) => ({
    ...finding,
    kept: finding.severity === "block" ? null : kept.find((entry) => entry.code === finding.code) ?? null,
  }));
}

/** Days apart, for tests and callers that reason in days. */
export const ROTA_DAY_MS = DAY_MS;
