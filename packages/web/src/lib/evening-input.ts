import { MINUTE_MS } from "./evening-window.js";

// ---------------------------------------------------------------------------
// The hour chip in the hand (T-674, v2 slice 10; spec 6.2, 11).
//
// Drag the chip sideways to scrub without opening the evening: a pixel is
// two minutes, or ten seconds with Shift held. Scroll over it to turn the
// hour fifteen minutes a notch, or one minute with Shift. A mouse wheel's
// notch is about 100 px of scroll; a trackpad's small deltas add up to one.
// Up and right are later.
// ---------------------------------------------------------------------------

/** How far the pointer must travel before a press on the chip becomes a scrub. */
export const CHIP_DRAG_THRESHOLD_PX = 4;

const COARSE_MS_PER_PX = 2 * MINUTE_MS;
const FINE_MS_PER_PX = 10_000;

/** The time a sideways drag of `dx` px moves the hour by. */
export function chipScrubMs(dx: number, fine: boolean): number {
  return dx * (fine ? FINE_MS_PER_PX : COARSE_MS_PER_PX);
}

/** The scrubbed hour, to the minute (or to ten seconds when fine). */
export function chipScrubbedHour(startAt: number, dx: number, fine: boolean): number {
  const step = fine ? FINE_MS_PER_PX : MINUTE_MS;
  return Math.round((startAt + chipScrubMs(dx, fine)) / step) * step;
}

export const WHEEL_STEP_MS = 15 * MINUTE_MS;
export const WHEEL_FINE_STEP_MS = MINUTE_MS;

/** A wheel notch's scroll, px. */
const NOTCH_PX = 100;
/** A single event this big is a mouse wheel's notch, however far short of 100 it falls. */
const MOUSE_NOTCH_PX = 50;
const LINE_PX = 33;

export interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
}

/** The scroll as pixels toward later (up and right), along whichever axis moved most (Shift turns a wheel sideways). */
export function wheelPixels(event: WheelLike, pageHeight: number): number {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageHeight : 1;
  const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  return (sideways ? event.deltaX : -event.deltaY) * scale;
}

/** Whole notches in a scroll so far, and what is left toward the next. */
export function wheelNotches(carried: number, pixels: number): { readonly notches: number; readonly rest: number } {
  if (Math.abs(pixels) >= MOUSE_NOTCH_PX) {
    return { notches: Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / NOTCH_PX)), rest: 0 };
  }
  // A change of direction starts afresh.
  const total = Math.sign(carried) !== 0 && Math.sign(carried) !== Math.sign(pixels) ? pixels : carried + pixels;
  // `|| 0` keeps a part-notch backwards from reading as −0.
  const notches = Math.trunc(total / NOTCH_PX) || 0;
  return { notches, rest: total - notches * NOTCH_PX };
}

/** The hour turned by a number of notches, on the step's own grid (19:41 a notch on is 19:45). */
export function turnedHour(at: number, notches: number, fine: boolean): number {
  if (notches === 0) return at;
  const step = fine ? WHEEL_FINE_STEP_MS : WHEEL_STEP_MS;
  const onGrid = notches > 0 ? Math.floor(at / step) * step : Math.ceil(at / step) * step;
  return onGrid + notches * step;
}
