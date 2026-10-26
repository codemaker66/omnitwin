import { msToWallInput, wallInputToMs, VENUE_TIME_ZONE } from "../pages/diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The evening's window (T-674, v2 slice 10; spec 6.2): which hours the line
// shows, and where on it a moment sits.
//
// The venue's day runs from 06:00 to the next 06:00 on its own clock, so the
// small hours belong to the night before: a Ceilidh that ends at 01:15 is
// still the evening of the 28th. The line shows the event's evening, from an
// hour before its first act (on the hour) to its last act's end (on the
// quarter), at least eight hours wide, so it reads at about 105 px an hour
// across the dock. Whole day widens it to 06:00–06:00; a day without the
// event's acts, or an hour outside them, shows the whole day too. Every time
// is an instant (epoch ms); Europe/London's offsets are whole hours, so the
// clock's hours and quarters turn with UTC's.
// ---------------------------------------------------------------------------

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** The hour the venue's day begins at (its small hours belong to the night before). */
export const VENUE_DAY_START_HOUR = 6;

/** The narrowest evening the line shows, hours: about 105 px an hour across a 900 px dock. */
export const EVENING_MIN_HOURS = 8;

/** The lead before the first act, before it is taken back to the hour. */
const LEAD_MS = HOUR_MS;

export interface TimeWindow {
  readonly start: number;
  readonly end: number;
}

export interface EveningWindow extends TimeWindow {
  /** The event's evening, or a whole day (asked for, or without acts on this day). */
  readonly kind: "acts" | "day";
}

/** Anything with a start and an end (an act). */
export interface Timed {
  readonly start: number;
  readonly end: number;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function dayAfter(day: string): string {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return day;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

/** The venue's day containing `at`: 06:00 to the next 06:00 on the venue's clock. */
export function venueDayOf(at: number): TimeWindow {
  const startHour = `${String(VENUE_DAY_START_HOUR).padStart(2, "0")}:00`;
  // The wall day of the moment six hours earlier is the day this one belongs to.
  const day = msToWallInput(at - VENUE_DAY_START_HOUR * HOUR_MS, VENUE_TIME_ZONE).slice(0, 10);
  const start = wallInputToMs(`${day}T${startHour}`, VENUE_TIME_ZONE);
  const end = wallInputToMs(`${dayAfter(day)}T${startHour}`, VENUE_TIME_ZONE);
  if (start === null || end === null) {
    // A year the wall format cannot hold: a plain 24 hours round the moment.
    const base = at - (((at % (24 * HOUR_MS)) + 24 * HOUR_MS) % (24 * HOUR_MS));
    return { start: base, end: base + 24 * HOUR_MS };
  }
  return { start, end };
}

/** Whether two moments fall in the same venue day. */
export function sameVenueDay(a: number, b: number): boolean {
  return venueDayOf(a).start === venueDayOf(b).start;
}

function floorTo(time: number, step: number): number {
  return Math.floor(time / step) * step;
}

function ceilTo(time: number, step: number): number {
  return Math.ceil(time / step) * step;
}

/** The acts that belong to the venue day containing `at`. */
export function actsOnDayOf<T extends Timed>(acts: readonly T[], at: number): T[] {
  const day = venueDayOf(at);
  return acts.filter((act) => act.start >= day.start && act.start < day.end);
}

/**
 * The window the line shows for the hour `at`: the event's evening when the
 * hour is in it, else the whole venue day.
 */
export function eveningWindow({ acts, at, wholeDay }: {
  readonly acts: readonly Timed[];
  readonly at: number;
  readonly wholeDay: boolean;
}): EveningWindow {
  const day = venueDayOf(at);
  const today = actsOnDayOf(acts, at);
  if (wholeDay || today.length === 0) return { ...day, kind: "day" };
  const first = Math.min(...today.map((act) => act.start));
  const last = Math.max(...today.map((act) => Math.max(act.end, act.start)));
  let start = Math.max(day.start, floorTo(first - LEAD_MS, HOUR_MS));
  let end = Math.min(day.end, ceilTo(last, 15 * MINUTE_MS));
  const least = EVENING_MIN_HOURS * HOUR_MS;
  if (end - start < least) end = Math.min(day.end, start + least);
  if (end - start < least) start = Math.max(day.start, end - least);
  // An hour outside the evening (sunrise, a key past its end) shows the whole day.
  if (at < start || at > end) return { ...day, kind: "day" };
  return { start, end, kind: "acts" };
}

/** Where a moment sits across a line `width` px wide (not clamped). */
export function xAtTime(window: TimeWindow, width: number, time: number): number {
  const span = window.end - window.start;
  return span <= 0 ? 0 : ((time - window.start) / span) * width;
}

/** The moment at `x` px across a line `width` px wide, held within the window. */
export function timeAtX(window: TimeWindow, width: number, x: number): number {
  const share = width <= 0 ? 0 : Math.max(0, Math.min(1, x / width));
  return window.start + share * (window.end - window.start);
}

/** A moment to the whole minute. */
export function toMinute(time: number): number {
  return Math.round(time / MINUTE_MS) * MINUTE_MS;
}

/** A moment held within a window. */
export function clampToWindow(window: TimeWindow, time: number): number {
  return Math.max(window.start, Math.min(window.end, time));
}
