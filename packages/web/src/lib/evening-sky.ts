import { Color } from "three";
import type { HallMoodName } from "../components/grand-hall/hall-mood.js";
import { HALL_OBSERVER, compassPoint } from "../components/grand-hall/hall-site.js";
import { formatWallTime } from "../pages/diary/lib/board-time.js";
import { SUN_EVENT_ALTITUDE, moonPosition, sunPosition, type Observer } from "./sky/ephemeris.js";
import { skyPalette, type Rgb } from "./sky/sky-palette.js";
import { HOUR_MS, MINUTE_MS, type TimeWindow } from "./evening-window.js";

// ---------------------------------------------------------------------------
// The evening's sky (T-674, v2 slice 10; spec 6.2): what is up over the hall
// at an hour, said plainly, and the band of sky the evening draws above its
// horizon.
//
// The sun and moon come from the product's ephemeris for the hall's place;
// the band's colours are the product's own sky palette, keyed on the sun's
// true altitude (lib/sky/sky-palette.ts), turned from the renderer's linear
// light into the screen's sRGB. Stars show where the palette allows them;
// the city's warm glow lies along the horizon by night. The moon's path is
// drawn where it is up. All of it is a pure function of time.
// ---------------------------------------------------------------------------

export interface BodyReading {
  /** Degrees above the horizon as seen (refraction included). */
  readonly altitude: number;
  /** Compass bearing, degrees. */
  readonly azimuth: number;
  readonly up: boolean;
}

export interface SkyReading {
  readonly sun: BodyReading & { readonly trueAltitude: number };
  readonly moon: BodyReading & { readonly illuminated: number; readonly waxing: boolean };
}

/** The sun counts as up while its upper limb clears the horizon, as sunrise and sunset are reckoned. */
function sunUp(trueAltitude: number): boolean {
  return trueAltitude > SUN_EVENT_ALTITUDE.horizon;
}

/** The sun and the moon over the hall at a moment. */
export function skyAt(at: number, observer: Observer = HALL_OBSERVER): SkyReading {
  const sun = sunPosition(at, observer);
  const moon = moonPosition(at, observer);
  return {
    sun: { altitude: sun.altitude, trueAltitude: sun.trueAltitude, azimuth: sun.azimuth, up: sunUp(sun.trueAltitude) },
    moon: { altitude: moon.altitude, azimuth: moon.azimuth, up: moon.altitude > 0, illuminated: moon.illuminated, waxing: moon.waxing },
  };
}

export type Body = "sun" | "moon";

/** How far above its horizon a body is, in the sense its rising is reckoned by. */
function heightOf(body: Body, at: number, observer: Observer): number {
  if (body === "sun") return sunPosition(at, observer).trueAltitude - SUN_EVENT_ALTITUDE.horizon;
  return moonPosition(at, observer).altitude;
}

const SEARCH_STEP_MS = 10 * MINUTE_MS;

/** The instant between `low` (where the body is `upAtLow`) and `high` where it crosses its horizon, to the second. */
function bisect(body: Body, low: number, high: number, upAtLow: boolean, observer: Observer): number {
  let a = low;
  let b = high;
  while (b - a > 1000) {
    const middle = (a + b) / 2;
    if ((heightOf(body, middle, observer) > 0) === upAtLow) a = middle; else b = middle;
  }
  return (a + b) / 2;
}

export interface BodyEvents {
  readonly rises: readonly number[];
  readonly sets: readonly number[];
}

/**
 * When a body rises and sets within a window, as the first and the last whole
 * minutes it is up (so a time on the line, a hand settled on it and the
 * sentence all show it up, as v1's dial named sunrise and sunset).
 */
export function bodyEvents(window: TimeWindow, body: Body, observer: Observer = HALL_OBSERVER): BodyEvents {
  const rises: number[] = [];
  const sets: number[] = [];
  let previousTime = window.start;
  let previous = heightOf(body, previousTime, observer) > 0;
  while (previousTime < window.end) {
    const time = Math.min(previousTime + SEARCH_STEP_MS, window.end);
    const now = heightOf(body, time, observer) > 0;
    if (now !== previous) {
      const edge = bisect(body, previousTime, time, previous, observer);
      if (now) rises.push(Math.ceil(edge / MINUTE_MS) * MINUTE_MS);
      else sets.push(Math.floor(edge / MINUTE_MS) * MINUTE_MS);
    }
    previousTime = time;
    previous = now;
  }
  return { rises, sets };
}

/** The next moonrise after a moment, within a day. */
export function moonRiseAfter(from: number, observer: Observer = HALL_OBSERVER): number | null {
  return bodyEvents({ start: from, end: from + 24 * HOUR_MS }, "moon", observer).rises[0] ?? null;
}

export interface SkyWordsOptions {
  /** The next moonrise, for a night with the moon still down. */
  readonly moonrise: number | null;
  /** When the sun falls in at the windows today, if the hour is near it. */
  readonly floor?: TimeWindow | null;
  /** The phone's shorter form ("10° up, east-north-east"). */
  readonly compact?: boolean;
}

function percentLit(reading: SkyReading): number {
  return Math.round(reading.moon.illuminated * 100);
}

function degreesUp(altitude: number): string {
  return String(Math.max(0, Math.round(altitude)));
}

/** One plain sentence about what is up: "Moon 75% lit, 10° up in the east-north-east". */
export function skySentence(reading: SkyReading, { moonrise, floor = null, compact = false }: SkyWordsOptions): string {
  const where = (azimuth: number): string => (compact ? `, ${compassPoint(azimuth)}` : ` in the ${compassPoint(azimuth)}`);
  if (reading.sun.up) {
    const sun = `Sun ${degreesUp(reading.sun.altitude)}° up${where(reading.sun.azimuth)}`;
    return floor === null || compact ? sun : `${sun} · on the floor ${formatWallTime(floor.start)} to ${formatWallTime(floor.end)}`;
  }
  if (reading.moon.up) return `Moon ${String(percentLit(reading))}% lit, ${degreesUp(reading.moon.altitude)}° up${where(reading.moon.azimuth)}`;
  if (moonrise !== null) return `Moon ${String(percentLit(reading))}% lit, rises at ${formatWallTime(moonrise)}`;
  return "Sun and moon below the horizon";
}

/** The same for a screen reader: "moon 75% lit, 10 degrees up". */
export function skySpoken(reading: SkyReading, { moonrise }: Pick<SkyWordsOptions, "moonrise">): string {
  if (reading.sun.up) return `sun ${degreesUp(reading.sun.altitude)} degrees up`;
  if (reading.moon.up) return `moon ${String(percentLit(reading))}% lit, ${degreesUp(reading.moon.altitude)} degrees up`;
  if (moonrise !== null) return `moon ${String(percentLit(reading))}% lit, rises at ${formatWallTime(moonrise)}`;
  return "sun and moon below the horizon";
}

/** What the hour chip shows: the sun by day; by night the moon in its phase, drawn in line while it is down. */
export type ChipGlyph =
  | { readonly kind: "sun" }
  | { readonly kind: "moon"; readonly lit: number; readonly waxing: boolean; readonly risen: boolean };

export function chipGlyph(reading: SkyReading): ChipGlyph {
  if (reading.sun.up) return { kind: "sun" };
  return { kind: "moon", lit: reading.moon.illuminated, waxing: reading.moon.waxing, risen: reading.moon.up };
}

/**
 * The hall's light for the sun's true altitude, where the real sky does not
 * light the room: daylight while the sun stands above 6°, evening through
 * golden hour and civil twilight, candlelight once it is 6° down.
 */
export function moodForSun(trueAltitude: number): HallMoodName {
  if (trueAltitude > SUN_EVENT_ALTITUDE.golden) return "daylight";
  if (trueAltitude > SUN_EVENT_ALTITUDE.civil) return "evening";
  return "candlelight";
}

/** A colour from the renderer's linear light, as the screen shows it. */
function screenColour(rgb: Rgb): string {
  return `#${new Color(rgb[0], rgb[1], rgb[2]).getHexString()}`;
}

export interface BandStop {
  /** 0 at the window's start, 1 at its end. */
  readonly offset: number;
  readonly zenith: string;
  readonly horizon: string;
  /** The city's glow along the horizon, 0–1. */
  readonly city: number;
}

/** The sky across the window, sampled evenly: overhead, at the horizon, and the city's glow. */
export function skyBand(window: TimeWindow, samples = 32): BandStop[] {
  const stops: BandStop[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const offset = index / samples;
    const time = window.start + (window.end - window.start) * offset;
    const palette = skyPalette(sunPosition(time, HALL_OBSERVER).trueAltitude);
    stops.push({ offset, zenith: screenColour(palette.zenith), horizon: screenColour(palette.horizonSun), city: palette.cityGlow });
  }
  return stops;
}

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly opacity: number;
}

/** The stars the palette allows, scattered the same way every time (a seeded draw). */
export function skyStars(window: TimeWindow, width: number, height: number, count = 90, seed = 11): Star[] {
  let state = seed;
  const draw = (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const stars: Star[] = [];
  for (let index = 0; index < count; index += 1) {
    const share = draw();
    const y = 6 + draw() * height * 0.74;
    const r = draw() < 0.15 ? 1.05 : 0.65;
    const glint = 0.25 + draw() * 0.5;
    const time = window.start + (window.end - window.start) * share;
    const visible = skyPalette(sunPosition(time, HALL_OBSERVER).trueAltitude).stars;
    if (visible > 0.05) stars.push({ x: share * width, y, r, opacity: Math.round(visible * glint * 100) / 100 });
  }
  return stars;
}

export interface PathPoint {
  readonly t: number;
  /** Degrees above the horizon. */
  readonly alt: number;
}

/** A body's apparent altitude at a moment. */
export function altitudeOf(body: Body, at: number): number {
  return body === "sun" ? sunPosition(at, HALL_OBSERVER).altitude : moonPosition(at, HALL_OBSERVER).altitude;
}

/** Where a body crosses the horizon between two samples on either side of it. */
function horizonPoint(below: PathPoint, above: PathPoint): PathPoint {
  const share = below.alt / (below.alt - above.alt);
  return { t: below.t + (above.t - below.t) * share, alt: 0 };
}

/** A body's path across the window where it is up, as runs of points; a run starts and ends on the horizon where it crosses it. */
export function bodyRuns(window: TimeWindow, body: Body, step: number = 5 * MINUTE_MS): PathPoint[][] {
  const runs: PathPoint[][] = [];
  let run: PathPoint[] | null = null;
  let previous: PathPoint | null = null;
  let time = window.start;
  for (;;) {
    const point = { t: time, alt: altitudeOf(body, time) };
    if (point.alt >= 0) {
      if (run === null) {
        run = previous !== null && previous.alt < 0 ? [horizonPoint(previous, point)] : [];
        runs.push(run);
      }
      run.push(point);
    } else if (run !== null && previous !== null) {
      run.push(horizonPoint(point, previous));
      run = null;
    }
    previous = point;
    if (time >= window.end) break;
    time = Math.min(time + step, window.end);
  }
  return runs;
}

/** A run split at the hour: the part travelled and the part ahead, both through the body's place now. */
export function splitRun(run: readonly PathPoint[], at: number, altitudeNow: number): { done: PathPoint[]; ahead: PathPoint[] } {
  const done = run.filter((point) => point.t <= at);
  const ahead = run.filter((point) => point.t > at);
  const first = run[0];
  const last = run[run.length - 1];
  if (first !== undefined && last !== undefined && at >= first.t && at <= last.t) {
    const here = { t: at, alt: Math.max(0, altitudeNow) };
    done.push(here);
    ahead.unshift(here);
  }
  return { done, ahead };
}

/** The highest the sun stands within the window, degrees. */
export function sunHighest(window: TimeWindow): number {
  let highest = -90;
  for (let time = window.start; time <= window.end; time += 15 * MINUTE_MS) {
    highest = Math.max(highest, sunPosition(time, HALL_OBSERVER).altitude);
  }
  return highest;
}

/** Pixels per degree for a sky `height` px tall: 35° fill it, unless the sun climbs higher. */
export function degreesScale(height: number, sunTop: number): number {
  const natural = (height - 2) / 35;
  return sunTop > 35 ? (height - 16) / sunTop : natural;
}
