// ---------------------------------------------------------------------------
// The Grand Hall's light at an instant
//
// Given a moment, where the sun and moon stand over Trades Hall, what colour
// the sky is, and how the hall itself is lit: one continuous mood blended from
// keyframes on the sun's altitude. Full daylight is exactly the light the scan
// was made in (HALL_MOODS.daylight), so the photographs show as captured; as
// the sun lowers the daylight warms into golden hour, cools into the blue hour
// after sunset and gives way to the chandeliers and frieze lights at night,
// when the tables' candles are lit.
//
// Pure: the planner calls it every frame while the time is being dragged.
// ---------------------------------------------------------------------------

import { moonPosition, sunPosition } from "../../lib/sky/ephemeris.js";
import { skyPalette, sunlight, type Rgb, type SkyPalette } from "../../lib/sky/sky-palette.js";
import { HALL_MOODS, mixMoodSpec, type HallMoodSpec } from "./hall-mood.js";
import { HALL_OBSERVER, HALL_WINDOW_BEARING, hallDirection } from "./hall-site.js";

/** Low sun: warm daylight through the windows, the chandeliers starting to tell. */
const GOLDEN: HallMoodSpec = {
  label: "Golden hour",
  ambient: "#f4dcc0",
  ambientIntensity: 0.3,
  chandelier: "#ffd29a",
  chandelierIntensity: 0.72,
  daylight: "#f3d4aa",
  daylightIntensity: 1.02,
  uplight: "#ffca80",
  uplightIntensity: 0.75,
  skyHorizon: "#f2cd9c",
  skyIntensity: 1.25,
  glow: 0.75,
  exposure: 1.02,
  reflections: 0.75,
  whiteBalance: [1.02, 1, 0.95],
  saturation: 1.04,
  candles: 0.15,
};

/** The blue hour after sunset: Evening, with the window light a little rosier. */
const DUSK: HallMoodSpec = { ...HALL_MOODS.evening, label: "Dusk", daylight: "#6a72ad", daylightIntensity: 0.36 };

/** Night: the house lights and candles against a dark city sky. */
const NIGHT: HallMoodSpec = {
  ...HALL_MOODS.evening,
  label: "Night",
  ambient: "#e9cfa8",
  ambientIntensity: 0.15,
  daylight: "#26324f",
  daylightIntensity: 0.08,
  skyHorizon: "#262b44",
  skyIntensity: 0.45,
  exposure: 1.12,
  whiteBalance: [0.93, 1, 1.14],
  candles: 0.75,
};

/** Mood keyframes by the sun's true altitude, highest first. */
const MOOD_KEYS: readonly { readonly altitude: number; readonly spec: HallMoodSpec }[] = [
  { altitude: 18, spec: HALL_MOODS.daylight },
  { altitude: 4, spec: GOLDEN },
  { altitude: -3, spec: DUSK },
  { altitude: -10, spec: NIGHT },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The hall's mood for the sun's true altitude in degrees. */
export function hallMoodForSun(trueAltitude: number): HallMoodSpec {
  const first = MOOD_KEYS[0];
  const last = MOOD_KEYS[MOOD_KEYS.length - 1];
  if (first === undefined || last === undefined) return HALL_MOODS.daylight;
  if (trueAltitude >= first.altitude) return first.spec;
  if (trueAltitude <= last.altitude) return last.spec;
  for (let index = 0; index < MOOD_KEYS.length - 1; index++) {
    const upper = MOOD_KEYS[index];
    const lower = MOOD_KEYS[index + 1];
    if (upper === undefined || lower === undefined) continue;
    if (trueAltitude <= upper.altitude && trueAltitude >= lower.altitude) {
      const t = smoothstep(upper.altitude, lower.altitude, trueAltitude);
      return mixMoodSpec(upper.spec, lower.spec, t);
    }
  }
  return last.spec;
}

export interface CelestialBody {
  /** Unit vector toward the body in the hall's frame. */
  readonly direction: readonly [number, number, number];
  /** Apparent altitude and compass bearing, degrees. */
  readonly altitude: number;
  readonly azimuth: number;
  /** Colour of its light, brightest channel 1. */
  readonly color: Rgb;
  /** Strength of its direct light, relative to the overhead sun. */
  readonly strength: number;
}

export interface HallSky {
  readonly at: number;
  readonly sun: CelestialBody & {
    /** True altitude, degrees (the moods and twilights key on it). */
    readonly trueAltitude: number;
    /** 0–1: how squarely the sun stands before the window wall. */
    readonly facingWindows: number;
  };
  readonly moon: CelestialBody & {
    readonly illuminated: number;
    readonly waxing: boolean;
  };
  readonly palette: SkyPalette;
  readonly mood: HallMoodSpec;
  /**
   * Where the city's night light comes from, a horizontal unit vector in the
   * hall's frame: the moon once it stands about 5° up, otherwise George
   * Square, 342° true and some 190 m away, the densest cluster of the
   * council's street lamps round the hall.
   */
  readonly nightGlow: readonly [number, number, number];
}

/** Moonlight: cool, and far fainter than sun, lifted for the dark-adapted eye. */
const MOON_COLOR: Rgb = [0.62, 0.72, 0.9];
const MOON_STRENGTH = 0.07;

/** True bearing of George Square from the hall, degrees. */
const SQUARE_BEARING = 342;

/** The night glow's direction: George Square, giving way to the moon as it rises from 3° to 7°. */
export function nightGlowDirection(moonAzimuth: number, moonAltitude: number): [number, number, number] {
  const square = hallDirection(SQUARE_BEARING, 0, [0, 0, 0]);
  const moon = hallDirection(moonAzimuth, 0, [0, 0, 0]);
  const t = smoothstep(3, 7, moonAltitude);
  const x = square[0] + (moon[0] - square[0]) * t;
  const z = square[2] + (moon[2] - square[2]) * t;
  const length = Math.hypot(x, z);
  // Opposite bearings pass through zero half-way: keep the square's then.
  return length < 1e-6 ? square : [x / length, 0, z / length];
}

/** Where the sun and moon are and how the hall is lit at epoch milliseconds `at`. */
export function hallSkyAt(at: number): HallSky {
  const sun = sunPosition(at, HALL_OBSERVER);
  const moon = moonPosition(at, HALL_OBSERVER);
  const light = sunlight(sun.altitude);
  const sunDirection = hallDirection(sun.azimuth, sun.altitude, [0, 0, 0]);
  const moonDirection = hallDirection(moon.azimuth, moon.altitude, [0, 0, 0]);
  const offWindows = ((sun.azimuth - HALL_WINDOW_BEARING + 540) % 360) - 180;
  // The moon lights the room only once the sky is dark enough to see by it.
  const night = smoothstep(-2, -9, sun.trueAltitude);
  const moonStrength = MOON_STRENGTH * moon.illuminated * smoothstep(-1, 10, moon.altitude) * night;
  return {
    at,
    sun: {
      direction: sunDirection,
      altitude: sun.altitude,
      trueAltitude: sun.trueAltitude,
      azimuth: sun.azimuth,
      color: light.color,
      strength: light.strength,
      facingWindows: Math.max(0, Math.cos(offWindows * Math.PI / 180)),
    },
    moon: {
      direction: moonDirection,
      altitude: moon.altitude,
      azimuth: moon.azimuth,
      color: MOON_COLOR,
      strength: moonStrength,
      illuminated: moon.illuminated,
      waxing: moon.waxing,
    },
    palette: skyPalette(sun.trueAltitude),
    mood: hallMoodForSun(sun.trueAltitude),
    nightGlow: nightGlowDirection(moon.azimuth, moon.altitude),
  };
}
