// ---------------------------------------------------------------------------
// The Grand Hall's day: the sun's path and when it reaches the floor
//
// For a date at Trades Hall: sunrise, sunset and the twilights (ephemeris.ts),
// the sun's path through the day for the time control to draw, and the spans
// when direct sun comes in at a window and falls on the floor. A window
// admits the sun when it stands above that window's skyline (the roofs
// across Glassford Street, hall-skyline.ts) and no further round than the
// window's reveal allows, as the hall draws it (hall-glazing.ts) and its
// sun's shadow map sees it: the straight-through limit of its outer opening's
// width over its depth from the room's plane to the outer face, about 71°
// off the wall's normal for the arches (2.7 m through 0.92-0.95 m) and 52°
// for the sashes (1.2 m through 0.92 m). (To 22 October the dial assumed a
// 0.62 m reveal, 77° and 66°, while S2 drew the measured 0.92-0.98 m: the
// times it gave and the sun the render drew disagreed at each span's ends.)
// All times are instants; the venue's clock is Europe/London.
// ---------------------------------------------------------------------------

import { sunPosition, sunTimes, type SunTimes } from "../../lib/sky/ephemeris.js";
import { msToWallInput, wallInputToMs, VENUE_TIME_ZONE } from "../../pages/diary/lib/board-time.js";
import { HALL_OBSERVER, HALL_WINDOW_BEARING } from "./hall-site.js";
import { HALL_WINDOW_SKYLINES, SKYLINE_AZIMUTH_END, SKYLINE_AZIMUTH_START, type HallWindowId } from "./hall-skyline.js";
import { HALL_GLAZING, HALL_OPENINGS, HALL_SASH_OPENING_HALF_WIDTH, HALL_WALL_THICKNESS } from "./hall-spec.js";

const MINUTE_MS = 60_000;
/** Spacing of the drawn path, minutes. */
const PATH_STEP = 10;
/** Spacing of the sun-on-the-floor search, minutes; edges are refined to the minute. */
const FLOOR_STEP = 5;

/**
 * A window's outer opening as the hall draws it (hall-glazing.ts): its width
 * (an arch's own; a sash's masonry opening) and its depth from the room's
 * plane to the outer face (the glazing's outer face, or the wall's where
 * that is nearer: hall-glazing.ts revealOuterDepth), metres.
 */
export function windowReveal(window: HallWindowId): { readonly width: number; readonly depth: number } {
  const glazing = HALL_GLAZING.find((entry) => entry.opening === window);
  const opening = HALL_OPENINGS.find((entry) => entry.id === window);
  if (glazing === undefined || opening === undefined) throw new Error(`No glazing for ${window}`);
  const width = glazing.fanlight === null ? 2 * HALL_SASH_OPENING_HALF_WIDTH : opening.width;
  const depth = -Math.max(glazing.outerDepth, -HALL_WALL_THICKNESS.window.thickness);
  return { width, depth };
}

/** How far round from the wall's normal a window's reveal still admits the sun, degrees: atan(width / depth). */
export function windowRevealLimit(window: HallWindowId): number {
  const { width, depth } = windowReveal(window);
  return (Math.atan2(width, depth) * 180) / Math.PI;
}

const WINDOW_IDS = Object.keys(HALL_WINDOW_SKYLINES) as HallWindowId[];

/** windowRevealLimit for each window, worked out once. */
const REVEAL_LIMIT: Readonly<Record<HallWindowId, number>> = {
  "arch-fireplace": windowRevealLimit("arch-fireplace"),
  "window-fireplace": windowRevealLimit("window-fireplace"),
  "arch-centre": windowRevealLimit("arch-centre"),
  "window-end": windowRevealLimit("window-end"),
  "arch-end": windowRevealLimit("arch-end"),
};

/** The venue-local midnight that begins the day containing `at`. */
export function hallDayStart(at: number): number {
  const day = msToWallInput(at, VENUE_TIME_ZONE).slice(0, 10);
  const dayMs = 1440 * MINUTE_MS;
  // A year the wall format cannot hold falls back to UTC midnight. `%` keeps
  // the sign of `at`, so before 1970 it is taken back into [0, dayMs): the
  // midnight must not come after the moment it begins.
  return wallInputToMs(`${day}T00:00`, VENUE_TIME_ZONE) ?? at - (((at % dayMs) + dayMs) % dayMs);
}

/** The venue day containing `at`: its midnight and the next one. */
export function hallDaySpan(at: number): TimeSpan {
  const start = hallDayStart(at);
  // A local day is 23–25 hours: the next midnight is found, not assumed.
  return { start, end: hallDayStart(start + 26 * 60 * MINUTE_MS) };
}

/** The skyline above a window's centre at a true azimuth, degrees; null outside the wall's half of the sky. */
export function windowSkyline(window: HallWindowId, azimuth: number): number | null {
  if (azimuth < SKYLINE_AZIMUTH_START || azimuth > SKYLINE_AZIMUTH_END) return null;
  const profile = HALL_WINDOW_SKYLINES[window];
  const position = azimuth - SKYLINE_AZIMUTH_START;
  const below = Math.floor(position);
  const a = profile[below];
  const b = profile[Math.min(below + 1, profile.length - 1)];
  if (a === undefined || b === undefined) return null;
  return a + (b - a) * (position - below);
}

/** Whether direct sun at this azimuth and apparent altitude comes in at any window. */
export function sunReachesFloor(azimuth: number, altitude: number): boolean {
  if (altitude <= 0) return false;
  const offNormal = Math.abs(((azimuth - HALL_WINDOW_BEARING + 540) % 360) - 180);
  return WINDOW_IDS.some((window) => {
    if (offNormal > REVEAL_LIMIT[window]) return false;
    const skyline = windowSkyline(window, azimuth);
    return skyline !== null && altitude > skyline;
  });
}

export interface PathSample {
  readonly at: number;
  readonly altitude: number;
  readonly azimuth: number;
}

export interface TimeSpan {
  readonly start: number;
  readonly end: number;
}

export interface HallDay {
  readonly dayStart: number;
  readonly dayEnd: number;
  readonly times: SunTimes;
  /** The sun every ten minutes from midnight to midnight. */
  readonly path: readonly PathSample[];
  /** When direct sun falls in through a window. */
  readonly sunOnFloor: readonly TimeSpan[];
}

function reachesAt(at: number): boolean {
  const sun = sunPosition(at, HALL_OBSERVER);
  return sunReachesFloor(sun.azimuth, sun.altitude);
}

/** The minute at which the answer changes between `from` (answer `was`) and `to`. */
function refine(from: number, to: number, was: boolean): number {
  let low = from;
  let high = to;
  while (high - low > MINUTE_MS) {
    const middle = Math.round((low + high) / 2 / MINUTE_MS) * MINUTE_MS;
    if (middle <= low || middle >= high) break;
    if (reachesAt(middle) === was) low = middle; else high = middle;
  }
  return high;
}

/** The day around `at` at Trades Hall. */
export function hallDay(at: number): HallDay {
  const { start: dayStart, end: dayEnd } = hallDaySpan(at);
  const path: PathSample[] = [];
  for (let time = dayStart; time <= dayEnd; time += PATH_STEP * MINUTE_MS) {
    const sun = sunPosition(time, HALL_OBSERVER);
    path.push({ at: time, altitude: sun.altitude, azimuth: sun.azimuth });
  }
  const sunOnFloor: TimeSpan[] = [];
  let open: number | null = null;
  let previous = dayStart;
  let previousLit = reachesAt(dayStart);
  if (previousLit) open = dayStart;
  for (let time = dayStart + FLOOR_STEP * MINUTE_MS; time <= dayEnd; time += FLOOR_STEP * MINUTE_MS) {
    const lit = reachesAt(time);
    if (lit !== previousLit) {
      const edge = refine(previous, time, previousLit);
      if (lit) open = edge;
      else if (open !== null) { sunOnFloor.push({ start: open, end: edge }); open = null; }
    }
    previous = time;
    previousLit = lit;
  }
  if (open !== null) sunOnFloor.push({ start: open, end: dayEnd });
  return { dayStart, dayEnd, times: sunTimes(dayStart, HALL_OBSERVER), path, sunOnFloor };
}
