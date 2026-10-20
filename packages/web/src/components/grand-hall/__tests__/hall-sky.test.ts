import { describe, expect, it } from "vitest";
import { Color } from "three";
import { HALL_MOODS } from "../hall-mood.js";
import { HALL_WINDOW_BEARING, compassPoint, hallBearing, hallDirection } from "../hall-site.js";
import { hallMoodForSun, hallSkyAt } from "../hall-sky.js";

describe("the hall's bearings", () => {
  it("points the window wall's outward normal (−z) to 101.1° true, and +x along Glassford Street", () => {
    const out: [number, number, number] = [0, 0, 0];
    const window = hallDirection(HALL_WINDOW_BEARING, 0, out);
    expect(window[0]).toBeCloseTo(0, 9);
    expect(window[2]).toBeCloseTo(-1, 9);
    const along = hallDirection(HALL_WINDOW_BEARING + 90, 0, [0, 0, 0]);
    expect(along[0]).toBeCloseTo(1, 9);
    const back = hallDirection(HALL_WINDOW_BEARING + 180, 0, [0, 0, 0]);
    expect(back[2]).toBeCloseTo(1, 9);
    const overhead = hallDirection(37, 90, [0, 0, 0]);
    expect(overhead[1]).toBeCloseTo(1, 9);
  });

  it("reads a direction's bearing back and names it", () => {
    for (const bearing of [0, 45, 101.1, 180, 291.5, 359]) {
      const d = hallDirection(bearing, 20, [0, 0, 0]);
      expect(hallBearing(d[0], d[2])).toBeCloseTo(bearing, 6);
    }
    // 101.1° is 11.1° from east and 11.4° from east-south-east.
    expect(compassPoint(HALL_WINDOW_BEARING)).toBe("east");
    expect(compassPoint(112.5)).toBe("east-south-east");
    expect(compassPoint(359)).toBe("north");
  });

  it("keeps the room's own geometry (hall-spec.ts): facing the fireplace (−x), the windows are on the right", () => {
    // Facing −x and turning right (clockwise seen from above) faces −z.
    const fireplace = hallBearing(-1, 0);
    const right = (fireplace + 90) % 360;
    expect(right).toBeCloseTo(HALL_WINDOW_BEARING, 6);
  });
});

describe("the hall's light through the day", () => {
  it("is exactly the scan's light while the sun is high", () => {
    expect(hallMoodForSun(30)).toBe(HALL_MOODS.daylight);
    expect(hallMoodForSun(18)).toBe(HALL_MOODS.daylight);
  });

  it("changes without a jump from noon to midnight", () => {
    const channels = (altitude: number): number[] => {
      const mood = hallMoodForSun(altitude);
      const c = (hex: string) => new Color(hex).toArray();
      return [
        ...c(mood.daylight), mood.daylightIntensity, ...c(mood.chandelier), mood.chandelierIntensity,
        ...c(mood.ambient), mood.ambientIntensity, mood.exposure, mood.candles, ...mood.whiteBalance,
      ];
    };
    let previous = channels(40);
    for (let altitude = 40; altitude >= -25; altitude -= 0.05) {
      const current = channels(altitude);
      const step = Math.max(...current.map((value, index) => Math.abs(value - (previous[index] ?? value))));
      expect(step).toBeLessThan(0.02);
      previous = current;
    }
  });

  it("lights the candles and leans on the chandeliers at night", () => {
    const night = hallMoodForSun(-20);
    expect(night.candles).toBeGreaterThan(0.5);
    expect(night.daylightIntensity).toBeLessThan(0.15);
    expect(night.chandelierIntensity).toBeGreaterThan(HALL_MOODS.daylight.chandelierIntensity);
  });

  it("puts a midsummer morning's sun before the windows, and midnight's below the floor", () => {
    // 21 June 2026, 10:00 BST: the sun stands in the south-east, 45° up.
    const morning = hallSkyAt(Date.UTC(2026, 5, 21, 9));
    expect(morning.sun.direction[2]).toBeLessThan(0);
    expect(morning.sun.direction[1]).toBeGreaterThan(0.6);
    expect(morning.sun.strength).toBeGreaterThan(0.6);
    expect(morning.sun.facingWindows).toBeGreaterThan(0.8);
    expect(morning.mood).toBe(HALL_MOODS.daylight);
    const midnight = hallSkyAt(Date.UTC(2026, 11, 21, 0));
    expect(midnight.sun.direction[1]).toBeLessThan(0);
    expect(midnight.sun.strength).toBe(0);
    expect(midnight.palette.stars).toBeGreaterThan(0.5);
  });

  it("lights the room by a full moon only when it is up and the sky is dark", () => {
    // Full moon 3 January 2026 (10:02 UTC): up through that night.
    const fullMoonNight = hallSkyAt(Date.UTC(2026, 0, 3, 23));
    expect(fullMoonNight.moon.illuminated).toBeGreaterThan(0.97);
    expect(fullMoonNight.moon.altitude).toBeGreaterThan(20);
    expect(fullMoonNight.moon.strength).toBeGreaterThan(0.05);
    const fullMoonDay = hallSkyAt(Date.UTC(2026, 0, 3, 12));
    expect(fullMoonDay.moon.strength).toBe(0);
  });
});
