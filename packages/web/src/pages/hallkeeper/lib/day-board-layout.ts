import type { BoardRange } from "../../diary/lib/board-time.js";
import { VENUE_TIME_ZONE, formatWallTime, msToWallInput, wallInputToMs } from "../../diary/lib/board-time.js";
import type { DayBoardLane, DayBoardSlot } from "./day-board-state.js";

// ---------------------------------------------------------------------------
// The board's geometry (goal 19 S3, D7): one ruler across the day, a NOW
// plaque on it, slabs placed by time with their setup, live and clear-down
// segments, and dimensioned gaps between them. Every position is a fraction
// of the visible window (0 at its left edge, 1 at its right), so the same
// arithmetic lays out the wall, the office and the phone, and a test can
// check it without a DOM. Nothing here reads a clock or a time zone it was
// not given.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export interface BoardWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/** A tick on the ruler: where, and what it says. Major ticks carry a label. */
export interface RulerTick {
  readonly ms: number;
  readonly x: number;
  readonly label: string;
  readonly major: boolean;
}

export interface Span {
  readonly left: number;
  readonly width: number;
}

export interface SlabGeometry {
  readonly slab: Span;
  readonly setup: Span;
  readonly live: Span;
  readonly clearDown: Span;
}

/** The day's default working window, venue wall time. */
export const WINDOW_OPENS_HOUR = 7;
export const WINDOW_CLOSES_HOUR = 23;
/** Breathing room either side of the earliest setup and the latest clear-down. */
const WINDOW_PADDING_MS = 30 * MIN_MS;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The instant of a wall-clock hour on the range's day. */
function wallHour(range: BoardRange, hour: number, timeZone: string): number {
  const date = msToWallInput(range.fromMs + 12 * HOUR_MS, timeZone).slice(0, 10);
  const ms = wallInputToMs(`${date}T${String(Math.min(23, hour)).padStart(2, "0")}:00`, timeZone);
  return ms ?? range.fromMs + hour * HOUR_MS;
}

/**
 * The visible window: the venue's working day (07:00 to 23:00), widened to
 * hold every slot's setup and clear-down with half an hour either side, and
 * the present moment while the day is on screen, all clamped to the day.
 */
export function boardWindow(
  range: BoardRange,
  lanes: readonly DayBoardLane[],
  nowMs: number,
  timeZone: string = VENUE_TIME_ZONE,
): BoardWindow {
  let fromMs = wallHour(range, WINDOW_OPENS_HOUR, timeZone);
  let toMs = wallHour(range, WINDOW_CLOSES_HOUR, timeZone);
  for (const lane of lanes) {
    for (const slot of lane.slots) {
      fromMs = Math.min(fromMs, slot.segments.setupStartsAtMs - WINDOW_PADDING_MS);
      toMs = Math.max(toMs, slot.segments.clearDownEndsAtMs + WINDOW_PADDING_MS);
    }
  }
  if (nowMs > range.fromMs && nowMs < range.toMs) {
    fromMs = Math.min(fromMs, nowMs - WINDOW_PADDING_MS);
    toMs = Math.max(toMs, nowMs + WINDOW_PADDING_MS);
  }
  fromMs = Math.max(range.fromMs, fromMs);
  toMs = Math.min(range.toMs, toMs);
  if (toMs - fromMs < 2 * HOUR_MS) toMs = Math.min(range.toMs, fromMs + 2 * HOUR_MS);
  return { fromMs, toMs };
}

/** Where an instant sits in the window, 0 to 1, clamped. */
export function fraction(ms: number, window: BoardWindow): number {
  const span = window.toMs - window.fromMs;
  if (span <= 0) return 0;
  return clamp01((ms - window.fromMs) / span);
}

/** A span between two instants, clamped to the window; empty spans are 0 wide. */
export function span(fromMs: number, toMs: number, window: BoardWindow): Span {
  const left = fraction(fromMs, window);
  const right = fraction(Math.max(fromMs, toMs), window);
  return { left, width: Math.max(0, right - left) };
}

/**
 * Hour ticks across the window. On a wide board every hour is labelled; on a
 * narrow one every second hour, so labels never collide. The first tick is
 * the first whole hour at or after the window opens.
 */
export function rulerTicks(
  window: BoardWindow,
  timeZone: string = VENUE_TIME_ZONE,
  labelEvery: 1 | 2 = 1,
): readonly RulerTick[] {
  const ticks: RulerTick[] = [];
  const first = Math.ceil(window.fromMs / HOUR_MS) * HOUR_MS;
  for (let ms = first; ms <= window.toMs; ms += HOUR_MS) {
    const hour = Math.round((ms - first) / HOUR_MS);
    const major = hour % labelEvery === 0;
    ticks.push({ ms, x: fraction(ms, window), label: major ? formatWallTime(ms, timeZone) : "", major });
  }
  return ticks;
}

/** Where the NOW plaque sits, or null when the present is outside the window. */
export function nowPlaque(nowMs: number, window: BoardWindow): number | null {
  if (nowMs < window.fromMs || nowMs > window.toMs) return null;
  return fraction(nowMs, window);
}

/** The slab and its three segments, as fractions of the window. */
export function slabGeometry(slot: DayBoardSlot, window: BoardWindow): SlabGeometry {
  const { setupStartsAtMs, doorsAtMs, endsAtMs, clearDownEndsAtMs } = slot.segments;
  return {
    slab: span(setupStartsAtMs, clearDownEndsAtMs, window),
    setup: span(setupStartsAtMs, doorsAtMs, window),
    live: span(doorsAtMs, endsAtMs, window),
    clearDown: span(endsAtMs, clearDownEndsAtMs, window),
  };
}

/** The dimensioned gap drawn before a slot, or null for the first in a lane.
 *  Drawn from the previous slab's drawn end (its clear-down), so the words
 *  sit in the open lane rather than under the hatched strip; the dimension
 *  itself still counts from the previous booking's end (minutesOf). */
export function gapGeometry(previous: DayBoardSlot | undefined, slot: DayBoardSlot, window: BoardWindow): Span | null {
  if (previous === undefined) return null;
  return span(previous.segments.clearDownEndsAtMs, slot.segments.setupStartsAtMs, window);
}

/** How many minutes a span of the window is, for the gap's dimension. */
export function minutesOf(fromMs: number, toMs: number): number {
  return Math.max(0, Math.round((toMs - fromMs) / MIN_MS));
}
