import { describe, expect, it } from "vitest";
import { deltaTSeconds, moonEcliptic, moonIllumination, moonPosition, sunEquatorial, sunPosition, sunTimes } from "../ephemeris.js";

const JD_UNIX_EPOCH = 2_440_587.5;

/** The UT instant whose Julian ephemeris day is `jde`, as the module converts it. */
function instantAtJde(jde: number, year: number): number {
  return (jde - JD_UNIX_EPOCH) * 86_400_000 - deltaTSeconds(year) * 1000;
}

/** Signed difference of two angles in degrees, in (−180, 180]. */
function angleDelta(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

describe("the sun's position", () => {
  it("matches Meeus's worked example 25.a (1992 October 13, 0h TD)", () => {
    const sun = sunEquatorial(instantAtJde(2_448_908.5, 1992));
    expect(Math.abs(angleDelta(sun.longitude, 199.90895))).toBeLessThan(0.002);
    expect(Math.abs(angleDelta(sun.rightAscension, 198.38083))).toBeLessThan(0.003);
    expect(sun.declination).toBeCloseTo(-7.78507, 2);
    expect(sun.distanceAu).toBeCloseTo(0.99766, 4);
  });

  it("matches NREL's solar position reference (Golden, Colorado, 17 October 2003)", () => {
    // Reda & Andreas, Solar Position Algorithm (NREL/TP-560-34302), table A4.1:
    // 12:30:30 local (UTC−7), topocentric zenith 50.11162°, azimuth 194.34024°.
    // The reference refracts at 820 hPa; this model at 1010 hPa sits about 0.004°
    // higher, and leaves out the sun's 0.002° parallax.
    const at = Date.UTC(2003, 9, 17, 19, 30, 30);
    const sun = sunPosition(at, { latitude: 39.742476, longitude: -105.1786 });
    expect(Math.abs(90 - sun.altitude - 50.11162)).toBeLessThan(0.03);
    expect(Math.abs(angleDelta(sun.azimuth, 194.34024))).toBeLessThan(0.03);
  });

  it("stands due south at solar noon and climbs to the latitude's noon altitude", () => {
    const glasgow = { latitude: 55.8593, longitude: -4.2491 };
    const times = sunTimes(Date.UTC(2026, 5, 20, 23), glasgow);
    const noon = sunPosition(times.solarNoon, glasgow);
    expect(Math.abs(angleDelta(noon.azimuth, 180))).toBeLessThan(0.05);
    // 90° − 55.86° + 23.44° = 57.58°, plus about 0.01° of refraction.
    expect(times.noonAltitude).toBeCloseTo(57.59, 1);
  });
});

describe("the sun's day in Glasgow, against the published almanac", () => {
  // timeanddate.com, "Sunrise and sunset times in Glasgow", June and December
  // 2026 (read 16 October 2026). Local clock times; the site rounds to the
  // minute, so a minute and a quarter is allowed.
  const glasgow = { latitude: 55.865, longitude: -4.2576 };
  const tolerance = 75_000;
  const close = (actual: number | null, expected: number) => {
    expect(actual).not.toBeNull();
    expect(Math.abs((actual ?? 0) - expected)).toBeLessThan(tolerance);
  };

  it("on midsummer's day (BST)", () => {
    const times = sunTimes(Date.UTC(2026, 5, 20, 23), glasgow);
    close(times.sunrise, Date.UTC(2026, 5, 21, 3, 31));
    close(times.sunset, Date.UTC(2026, 5, 21, 21, 6));
    close(times.civilDawn, Date.UTC(2026, 5, 21, 2, 29));
    close(times.civilDusk, Date.UTC(2026, 5, 21, 22, 8));
    close(times.solarNoon, Date.UTC(2026, 5, 21, 12, 18));
    // The sun never sinks 12° below the horizon: nautical twilight all night.
    expect(times.nauticalDawn).toBeNull();
    expect(times.astronomicalDusk).toBeNull();
  });

  it("on midwinter's day (GMT)", () => {
    const times = sunTimes(Date.UTC(2026, 11, 21), glasgow);
    close(times.sunrise, Date.UTC(2026, 11, 21, 8, 45));
    close(times.sunset, Date.UTC(2026, 11, 21, 15, 44));
    close(times.civilDawn, Date.UTC(2026, 11, 21, 7, 58));
    close(times.civilDusk, Date.UTC(2026, 11, 21, 16, 31));
    close(times.nauticalDawn, Date.UTC(2026, 11, 21, 7, 9));
    close(times.nauticalDusk, Date.UTC(2026, 11, 21, 17, 20));
    close(times.astronomicalDawn, Date.UTC(2026, 11, 21, 6, 23));
    close(times.astronomicalDusk, Date.UTC(2026, 11, 21, 18, 6));
    close(times.solarNoon, Date.UTC(2026, 11, 21, 12, 15));
  });

  it("on 12 December (GMT)", () => {
    const times = sunTimes(Date.UTC(2026, 11, 12), glasgow);
    close(times.sunrise, Date.UTC(2026, 11, 12, 8, 38));
    close(times.sunset, Date.UTC(2026, 11, 12, 15, 42));
    close(times.civilDusk, Date.UTC(2026, 11, 12, 16, 29));
    close(times.astronomicalDawn, Date.UTC(2026, 11, 12, 6, 17));
  });
});

describe("the moon", () => {
  it("matches Meeus's worked example 47.a (1992 April 12, 0h TD)", () => {
    const moon = moonEcliptic(instantAtJde(2_448_724.5, 1992));
    // Apparent longitude 133.167265° (geometric 133.162655° plus nutation).
    expect(Math.abs(angleDelta(moon.longitude, 133.167265))).toBeLessThan(0.01);
    expect(moon.latitude).toBeCloseTo(-3.229126, 2);
    expect(Math.abs(moon.distanceKm - 368409.7)).toBeLessThan(30);
    expect(Math.abs(angleDelta(moon.rightAscension, 134.68847))).toBeLessThan(0.015);
    expect(moon.declination).toBeCloseTo(13.768368, 1);
  });

  it("matches Meeus's worked example 48.a: 0.6786 of the disc lit", () => {
    expect(moonIllumination(instantAtJde(2_448_724.5, 1992)).illuminated).toBeCloseTo(0.6786, 2);
  });

  it("is full, new and half lit at the published 2026 phases", () => {
    // timeanddate.com, "Moon Phases 2026" for Glasgow (UTC from the local times).
    expect(moonIllumination(Date.UTC(2026, 0, 3, 10, 2)).illuminated).toBeGreaterThan(0.998);
    expect(moonIllumination(Date.UTC(2026, 0, 18, 19, 52)).illuminated).toBeLessThan(0.004);
    expect(moonIllumination(Date.UTC(2026, 9, 10, 15, 50)).illuminated).toBeLessThan(0.004);
    const quarter = moonIllumination(Date.UTC(2026, 9, 18, 16, 12));
    expect(quarter.illuminated).toBeCloseTo(0.5, 1);
    expect(quarter.waxing).toBe(true);
    expect(moonIllumination(Date.UTC(2026, 9, 25)).waxing).toBe(true);
    expect(moonIllumination(Date.UTC(2026, 10, 1)).waxing).toBe(false);
  });

  it("rises in the north-east as the midwinter full moon should", () => {
    // The full moon of 3 January stands opposite the sun: risen by 17:00 UTC,
    // low in the north-east, at a distance inside the lunar orbit's range.
    const glasgow = { latitude: 55.8593, longitude: -4.2491 };
    const evening = moonPosition(Date.UTC(2026, 0, 3, 17), glasgow);
    expect(evening.altitude).toBeGreaterThan(0);
    expect(evening.azimuth).toBeGreaterThan(30);
    expect(evening.azimuth).toBeLessThan(90);
    expect(evening.distanceKm).toBeGreaterThan(356_000);
    expect(evening.distanceKm).toBeLessThan(407_000);
  });
});
