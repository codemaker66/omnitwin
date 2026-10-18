import { describe, expect, it } from "vitest";
import { airMass, skyPalette, sunlight } from "../sky-palette.js";

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
  it("changes smoothly through the day and night", () => {
    const flat = (altitude: number) => {
      const p = skyPalette(altitude);
      return [...p.zenith, ...p.horizonSun, ...p.horizonAway, ...p.glow, p.glowStrength, p.stars, p.cityGlow];
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
    expect(Math.max(...night.zenith)).toBeLessThan(0.02);
    expect(night.stars).toBeGreaterThan(0.5);
    expect(night.cityGlow).toBe(1);
  });
});
