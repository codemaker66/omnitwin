// ---------------------------------------------------------------------------
// Board time math (T-493; Canon §2.10/§8).
//
// Pure functions mapping venue-local wall-clock windows onto UTC instants.
// All arithmetic runs on epoch milliseconds; wall-clock reads go through Intl
// with an explicit time zone, so Europe/London DST transitions produce
// honest 23/25-hour days instead of silent drift.
//
// The venue zone is a constant for now: GET /calendar does not carry
// venues.timezone yet and the deployment is single-venue (Trades Hall).
// When multi-venue lands, thread the zone through these helpers — every
// function already accepts it as a parameter.
// ---------------------------------------------------------------------------

export const VENUE_TIME_ZONE = "Europe/London";

export type BoardView = "day" | "week" | "month";

export interface BoardRange {
  readonly view: BoardView;
  readonly fromMs: number;
  readonly toMs: number;
}

export interface DayColumn {
  readonly startMs: number;
  readonly endMs: number;
  readonly label: string;
  readonly isWeekend: boolean;
}

export interface HourTick {
  readonly ms: number;
  readonly label: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface WallParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function wallParts(ms: number, timeZone: string): WallParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: read("weekday"),
  };
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const wall = wallParts(ms, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - ms;
}

/** The instant at which the given wall-clock midnight occurs in the zone.
 *  Converges in two steps; DST-fold ambiguity resolves to the later offset,
 *  which is irrelevant for the midnights this module asks for (London never
 *  shifts at midnight). */
function instantForWall(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day);
  const firstGuess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - zoneOffsetMs(firstGuess, timeZone);
}

function localMidnight(ms: number, timeZone: string): number {
  const wall = wallParts(ms, timeZone);
  return instantForWall(wall.year, wall.month, wall.day, timeZone);
}

function nextLocalMidnight(midnightMs: number, timeZone: string): number {
  // A local day is 23–25 hours; +26h always lands inside the following day.
  return localMidnight(midnightMs + 26 * HOUR_MS, timeZone);
}

function previousLocalMidnight(midnightMs: number, timeZone: string): number {
  return localMidnight(midnightMs - 12 * HOUR_MS, timeZone);
}

export function boardRange(
  anchorMs: number,
  view: BoardView,
  timeZone: string = VENUE_TIME_ZONE,
): BoardRange {
  if (view === "day") {
    const fromMs = localMidnight(anchorMs, timeZone);
    return { view, fromMs, toMs: nextLocalMidnight(fromMs, timeZone) };
  }
  if (view === "week") {
    let monday = localMidnight(anchorMs, timeZone);
    for (let i = 0; i < 6 && wallParts(monday, timeZone).weekday !== "Mon"; i += 1) {
      monday = previousLocalMidnight(monday, timeZone);
    }
    let toMs = monday;
    for (let i = 0; i < 7; i += 1) toMs = nextLocalMidnight(toMs, timeZone);
    return { view, fromMs: monday, toMs };
  }
  const wall = wallParts(anchorMs, timeZone);
  const fromMs = instantForWall(wall.year, wall.month, 1, timeZone);
  const nextYear = wall.month === 12 ? wall.year + 1 : wall.year;
  const nextMonth = wall.month === 12 ? 1 : wall.month + 1;
  return { view, fromMs, toMs: instantForWall(nextYear, nextMonth, 1, timeZone) };
}

export function shiftRange(
  range: BoardRange,
  direction: 1 | -1,
  timeZone: string = VENUE_TIME_ZONE,
): BoardRange {
  const anchor = direction === 1 ? range.toMs + MINUTE_MS : range.fromMs - MINUTE_MS;
  return boardRange(anchor, range.view, timeZone);
}

/** Snap to the nearest absolute step. London's offsets are whole hours, so
 *  epoch-relative rounding equals wall-clock quarter alignment. */
export function snapMs(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MINUTE_MS;
  return Math.round(ms / step) * step;
}

export function msToX(ms: number, range: BoardRange, pxPerHour: number): number {
  return ((ms - range.fromMs) / HOUR_MS) * pxPerHour;
}

export function widthPx(startMs: number, endMs: number, pxPerHour: number): number {
  return ((endMs - startMs) / HOUR_MS) * pxPerHour;
}

const displayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let formatter = displayFormatterCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", options);
    displayFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatWallTime(ms: number, timeZone: string = VENUE_TIME_ZONE): string {
  return cachedFormatter(`time:${timeZone}`, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

export function formatWallDay(ms: number, timeZone: string = VENUE_TIME_ZONE): string {
  return cachedFormatter(`day:${timeZone}`, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(ms));
}

function formatWallDayFull(ms: number, timeZone: string): string {
  return cachedFormatter(`dayfull:${timeZone}`, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

export function dayColumns(
  range: BoardRange,
  timeZone: string = VENUE_TIME_ZONE,
): readonly DayColumn[] {
  const columns: DayColumn[] = [];
  let cursor = range.fromMs;
  while (cursor < range.toMs) {
    const end = Math.min(nextLocalMidnight(cursor, timeZone), range.toMs);
    const weekday = wallParts(cursor, timeZone).weekday;
    columns.push({
      startMs: cursor,
      endMs: end,
      label: formatWallDay(cursor, timeZone),
      isWeekend: weekday === "Sat" || weekday === "Sun",
    });
    cursor = end;
  }
  return columns;
}

export function hourTicks(
  range: BoardRange,
  timeZone: string = VENUE_TIME_ZONE,
): readonly HourTick[] {
  const ticks: HourTick[] = [];
  for (let ms = range.fromMs; ms < range.toMs; ms += HOUR_MS) {
    ticks.push({ ms, label: formatWallTime(ms, timeZone) });
  }
  return ticks;
}

export function rangeTitle(range: BoardRange, timeZone: string = VENUE_TIME_ZONE): string {
  if (range.view === "day") return formatWallDayFull(range.fromMs, timeZone);
  if (range.view === "week") return `Week of ${formatWallDayFull(range.fromMs, timeZone)}`;
  return cachedFormatter(`month:${timeZone}`, {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(range.fromMs));
}
