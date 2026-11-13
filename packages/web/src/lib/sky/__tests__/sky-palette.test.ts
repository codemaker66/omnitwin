import { describe, expect, it } from "vitest";
import { STREET_NIGHT_LOOKS, STREET_NIGHT_LOOK_NAMES } from "../night-looks.js";
import { airMass, nightFor, skyPalette, sunlight, type Rgb } from "../sky-palette.js";

const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("sunlight through the atmosphere", () => {
  it("is white overhead and reddens toward the horizon", () => {
    const high = sunlight(89.9);
    expect(high.color[0]).toBeCloseTo(1, 2);
    expect(high.color[2]).toBeCloseTo(1, 2);
    expect(high.strength).toBeCloseTo(1, 2);
    const low = sunlight(3);
    expect(low.color[0]).toBe(1);
    expect(low.color[1]).toBeLessThan(0.75);
    expect(low.color[2]).toBeLessThan(low.color[1]);
  });

  it("weakens steadily as the sun sinks and is gone once the disc has set", () => {
    let previous = sunlight(90).strength;
    for (let altitude = 89; altitude >= -1; altitude -= 0.5) {
      const strength = sunlight(altitude).strength;
      expect(strength).toBeLessThanOrEqual(previous + 1e-9);
      previous = strength;
    }
    expect(sunlight(-1).strength).toBe(0);
  });

  it("uses the Kasten–Young air mass (about 1 overhead, about 38 on the horizon)", () => {
    expect(airMass(90)).toBeCloseTo(1, 3);
    expect(airMass(0)).toBeGreaterThan(36);
    expect(airMass(0)).toBeLessThan(40);
  });
});

describe("the sky's palette", () => {
  it.each(STREET_NIGHT_LOOK_NAMES)("changes smoothly through the day and night in the %s look", (name) => {
    const look = STREET_NIGHT_LOOKS[name];
    const flat = (altitude: number) => {
      const p = skyPalette(altitude, look);
      // (The street lamps' own span is short by design: tested below.)
      return [...p.zenith, ...p.horizonSun, ...p.horizonAway, ...p.glow, p.glowStrength, p.stars, p.cityGlow, p.night];
    };
    let previous = flat(70);
    for (let altitude = 70; altitude >= -30; altitude -= 0.05) {
      const current = flat(altitude);
      const step = Math.max(...current.map((value, index) => Math.abs(value - (previous[index] ?? value))));
      expect(step).toBeLessThan(0.02);
      previous = current;
    }
  });

  it("is blue overhead by day, dark by night, with stars only after dusk", () => {
    const day = skyPalette(40);
    expect(day.zenith[2]).toBeGreaterThan(day.zenith[0]);
    expect(day.stars).toBe(0);
    const night = skyPalette(-20);
    // Dark by luminance: the night looks lift the zenith's blue a little (to
    // 0.026 in Evocative) so the tone mapper does not crush it to black.
    expect(luminance(night.zenith)).toBeLessThan(0.02);
    expect(night.stars).toBeGreaterThan(0.5);
    expect(night.cityGlow).toBe(1);
  });

  it.each(STREET_NIGHT_LOOK_NAMES.filter((name) => name !== "off"))("has a violet night horizon in the %s look, the skyline lighter than its zenith", (name) => {
    const look = STREET_NIGHT_LOOKS[name];
    // −12° bridges the blue hour's navy and the night; from −18° it is night.
    for (const altitude of [-12, -18, -30]) {
      const night = skyPalette(altitude, look);
      for (const horizon of [night.horizonSun, night.horizonAway]) {
        expect(horizon[2]).toBeGreaterThan(horizon[1]);
        expect(luminance(horizon)).toBeGreaterThan(luminance(night.zenith));
        if (altitude === -12) continue;
        // Red and blue both over green: violet to magenta, never navy.
        expect(horizon[0]).toBeGreaterThan(horizon[1]);
        if (name !== "noir") expect(horizon[2]).toBeGreaterThan(horizon[0]);
      }
    }
  });

  it.each(STREET_NIGHT_LOOK_NAMES)("never brightens as the sun sinks on from the blue hour in the %s look", (name) => {
    const look = STREET_NIGHT_LOOKS[name];
    // A lit city's sky levels off after nautical twilight; it may hold, never brighten.
    let previous = skyPalette(-8, look);
    for (let altitude = -8.25; altitude >= -20; altitude -= 0.25) {
      const p = skyPalette(altitude, look);
      for (const key of ["zenith", "horizonSun", "horizonAway"] as const) {
        expect(luminance(p[key]), `${key} at ${String(altitude)}°`).toBeLessThanOrEqual(luminance(previous[key]) + 1e-6);
      }
      previous = p;
    }
    // ...and the night is darker than the end of nautical twilight, a little.
    const twelve = skyPalette(-12, look);
    const eighteen = skyPalette(-18, look);
    for (const key of ["zenith", "horizonSun", "horizonAway"] as const) expect(luminance(eighteen[key])).toBeLessThan(luminance(twelve[key]));
  });

  it("keeps the day's sky in every look: only the night's two keyframes differ", () => {
    for (const altitude of [40, 12, 0, -3, -8]) {
      const reference = skyPalette(altitude, STREET_NIGHT_LOOKS.evocative);
      for (const name of STREET_NIGHT_LOOK_NAMES) expect(skyPalette(altitude, STREET_NIGHT_LOOKS[name])).toEqual(reference);
    }
  });
});

describe("the city's night span", () => {
  it("brings the city's night from 3° to 10° below the horizon, the hall's Dusk-to-Night span", () => {
    expect(nightFor(-1.5)).toBe(0);
    expect(nightFor(-3)).toBe(0);
    expect(nightFor(-10)).toBe(1);
    expect(nightFor(-6.5)).toBeCloseTo(0.5, 6);
    let previous = 0;
    for (let altitude = -2; altitude >= -11; altitude -= 0.01) {
      const value = nightFor(altitude);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(skyPalette(-7).night).toBe(nightFor(-7));
    expect(skyPalette(-7).cityGlow).toBe(nightFor(-7));
  });
});
