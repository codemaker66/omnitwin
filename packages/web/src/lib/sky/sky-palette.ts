// -----------------------------------------------------------------------------
// sky-palette — the colours of the sky and of sunlight for a sun altitude.
//
// The sky's structure is physical: blue overhead, brighter and warmer toward
// the sun, the anti-solar horizon cooler and, once the sun has set, the pink
// band above the earth's shadow (the "belt of Venus"); then the blue hour, and
// a city night whose low sky glows warm with street light. The colours
// themselves are art-directed keyframes on the sun's true altitude, read from
// photographs of clear Scottish skies, because a planner should look like the
// best evening of the year rather than the average one.
//
// Sunlight's colour comes from the atmosphere it crosses: Rayleigh and
// aerosol extinction at three wavelengths along the Kasten–Young air mass,
// normalised to the sun overhead, so it whitens by noon and reddens toward
// the horizon on its own.
//
// The night's two keyframes (−12° and −18°) come from the street's night look
// (night-looks.ts): a dark violet over the Merchant City rather than a navy.
// `night` follows the sun with them, from −3° to −10°, the hall's own
// Dusk-to-Night mood: it carries the city's night light, windows, haze and
// the sky's city glow. The street lamps light round the hall's −3° Dusk mood,
// each at its own altitude (hall-street-light.ts).
// -----------------------------------------------------------------------------

import { Color } from "three";
import { activeStreetNightLook, type StreetNightLook } from "./night-looks.js";

/** A colour in the renderer's linear working space. */
export type Rgb = readonly [number, number, number];

export interface SkyPalette {
  /** Straight up. */
  readonly zenith: Rgb;
  /** On the horizon below the sun. */
  readonly horizonSun: Rgb;
  /** On the horizon away from the sun. */
  readonly horizonAway: Rgb;
  /** The glow around the sun's disc (or where it has set). */
  readonly glow: Rgb;
  /** How strongly the glow shows, 0–1. */
  readonly glowStrength: number;
  /** Stars' visibility, 0–1 (the city's glow caps it). */
  readonly stars: number;
  /** The city's glow along the night horizon, 0–1 (the night span). */
  readonly cityGlow: number;
  /** The city's night, 0 above −3° of sun and 1 by −10° (the hall's Dusk-to-Night mood). */
  readonly night: number;
}

interface Keyframe {
  readonly altitude: number;
  readonly zenith: string;
  readonly horizonSun: string;
  readonly horizonAway: string;
  readonly glow: string;
  readonly glowStrength: number;
}

/** Keyframes by the sun's true altitude from day to the blue hour, highest first (sRGB hex). */
const DAY_KEYFRAMES: readonly Keyframe[] = [
  { altitude: 50, zenith: "#2c6bc6", horizonSun: "#d6e5f3", horizonAway: "#cddff0", glow: "#fff7e8", glowStrength: 0.55 },
  { altitude: 25, zenith: "#3474c9", horizonSun: "#dbe6f0", horizonAway: "#cfdeee", glow: "#fff1dc", glowStrength: 0.6 },
  { altitude: 12, zenith: "#447ec8", horizonSun: "#e8ddc8", horizonAway: "#c9d7e7", glow: "#ffe5b8", glowStrength: 0.7 },
  { altitude: 5, zenith: "#5383c2", horizonSun: "#f2c999", horizonAway: "#c1cee1", glow: "#ffd18e", glowStrength: 0.85 },
  { altitude: 1.5, zenith: "#5a7db6", horizonSun: "#f5a56b", horizonAway: "#bbbbd3", glow: "#ffb16b", glowStrength: 1 },
  { altitude: -1, zenith: "#4c67a1", horizonSun: "#ee8657", horizonAway: "#b5a2c2", glow: "#ff9459", glowStrength: 1 },
  { altitude: -3, zenith: "#3a5089", horizonSun: "#d67056", horizonAway: "#9288b0", glow: "#f07b4f", glowStrength: 0.85 },
  { altitude: -5, zenith: "#2b3d71", horizonSun: "#a5625f", horizonAway: "#5f6792", glow: "#c46b50", glowStrength: 0.6 },
  { altitude: -8, zenith: "#1b2a53", horizonSun: "#5b4b64", horizonAway: "#303b63", glow: "#6b4b56", glowStrength: 0.35 },
];

const keyframeCache = new Map<StreetNightLook, readonly Keyframe[]>();

/** The day's keyframes and the look's night: −12° and −18°. */
function keyframesFor(look: StreetNightLook): readonly Keyframe[] {
  let frames = keyframeCache.get(look);
  if (frames === undefined) {
    frames = [
      ...DAY_KEYFRAMES,
      { altitude: -12, ...look.sky12, glow: "#2f2b41", glowStrength: 0.15 },
      { altitude: -18, ...look.sky18, glow: "#1c1e2f", glowStrength: 0 },
    ];
    keyframeCache.set(look, frames);
  }
  return frames;
}

const scratchA = new Color();
const scratchB = new Color();

function mixHex(a: string, b: string, t: number): Rgb {
  scratchA.set(a);
  scratchB.set(b);
  scratchA.lerp(scratchB, t);
  return [scratchA.r, scratchA.g, scratchA.b];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The two keyframes around an altitude and the smoothed share of the lower one. */
function bracket(sunAltitude: number, keyframes: readonly Keyframe[]): { upper: Keyframe; lower: Keyframe; t: number } {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined) throw new Error("sky palette has no keyframes");
  if (sunAltitude >= first.altitude) return { upper: first, lower: first, t: 0 };
  if (sunAltitude <= last.altitude) return { upper: last, lower: last, t: 0 };
  for (let index = 0; index < keyframes.length - 1; index++) {
    const a = keyframes[index];
    const b = keyframes[index + 1];
    if (a === undefined || b === undefined) continue;
    if (sunAltitude <= a.altitude && sunAltitude >= b.altitude) {
      // Smooth within each span so the colours change without corners.
      return { upper: a, lower: b, t: smoothstep(0, 1, (a.altitude - sunAltitude) / (a.altitude - b.altitude)) };
    }
  }
  return { upper: last, lower: last, t: 0 };
}

/** The city's night for the sun's true altitude: 0 above −3°, 1 by −10°. */
export function nightFor(sunAltitude: number): number {
  return smoothstep(-3, -10, sunAltitude);
}

/** The sky's palette for the sun's true altitude in degrees, in a night look. */
export function skyPalette(sunAltitude: number, look: StreetNightLook = activeStreetNightLook()): SkyPalette {
  const { upper, lower, t } = bracket(sunAltitude, keyframesFor(look));
  const night = nightFor(sunAltitude);
  return {
    zenith: mixHex(upper.zenith, lower.zenith, t),
    horizonSun: mixHex(upper.horizonSun, lower.horizonSun, t),
    horizonAway: mixHex(upper.horizonAway, lower.horizonAway, t),
    glow: mixHex(upper.glow, lower.glow, t),
    glowStrength: upper.glowStrength + (lower.glowStrength - upper.glowStrength) * t,
    stars: smoothstep(-7, -15, sunAltitude) * 0.85,
    cityGlow: night,
    night,
  };
}

/**
 * Vertical optical depth at 680, 550 and 440 nm: Rayleigh (Bucholtz 1995, sea
 * level) plus an urban aerosol of Ångström β 0.08, α 1.3.
 */
const OPTICAL_DEPTH: Rgb = [0.041 + 0.132, 0.097 + 0.174, 0.243 + 0.233];

/** Kasten & Young (1989) relative air mass for an apparent altitude in degrees. */
export function airMass(altitude: number): number {
  const h = Math.max(altitude, -0.5);
  return 1 / (Math.sin(h * Math.PI / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

export interface Sunlight {
  /** Colour normalised so the brightest channel is 1. */
  readonly color: Rgb;
  /** Luminous strength relative to the sun overhead, 0–1. */
  readonly strength: number;
}

/** The colour and strength of direct sunlight at an apparent altitude in degrees. */
export function sunlight(altitude: number): Sunlight {
  if (altitude <= -0.8) return { color: [1, 0.45, 0.2], strength: 0 };
  const m = airMass(altitude);
  const transmit: [number, number, number] = [
    Math.exp(-OPTICAL_DEPTH[0] * (m - 1)),
    Math.exp(-OPTICAL_DEPTH[1] * (m - 1)),
    Math.exp(-OPTICAL_DEPTH[2] * (m - 1)),
  ];
  const peak = Math.max(transmit[0], transmit[1], transmit[2]);
  const color: Rgb = [transmit[0] / peak, transmit[1] / peak, transmit[2] / peak];
  // Luminance relative to the overhead sun, faded across the horizon so the
  // light leaves with the disc.
  const luminance = 0.2126 * transmit[0] + 0.7152 * transmit[1] + 0.0722 * transmit[2];
  return { color, strength: luminance * smoothstep(-0.8, 0.6, altitude) };
}
