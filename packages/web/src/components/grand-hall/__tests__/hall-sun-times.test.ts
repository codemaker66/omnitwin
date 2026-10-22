import { describe, expect, it } from "vitest";
import { hallDay, hallDaySpan, hallDayStart, sunReachesFloor, windowReveal, windowRevealLimit, windowSkyline } from "../hall-sun-times.js";

const minutes = (ms: number) => Math.round(ms / 60_000);

describe("the Grand Hall's day", () => {
  it("begins at the venue's own midnight, BST or GMT", () => {
    expect(hallDayStart(Date.UTC(2026, 5, 21, 12))).toBe(Date.UTC(2026, 5, 20, 23));
    expect(hallDayStart(Date.UTC(2026, 11, 21, 12))).toBe(Date.UTC(2026, 11, 21, 0));
    // A minute past local midnight in summer is still the new day.
    expect(hallDayStart(Date.UTC(2026, 5, 20, 23, 1))).toBe(Date.UTC(2026, 5, 20, 23));
  });

  it("never begins a day after the moment, even in a year the wall format cannot hold", () => {
    // Year 202 is before the epoch and reads as "202-10-17", which the wall
    // parser refuses, so the UTC fallback answers: it must not round forward.
    for (const at of [Date.UTC(202, 9, 17, 12), Date.UTC(202, 9, 17, 23, 59), Date.UTC(12000, 3, 2, 6)]) {
      const start = hallDayStart(at);
      expect(start).toBeLessThanOrEqual(at);
      expect(at - start).toBeLessThan(86_400_000);
    }
  });

  it("spans the venue's day: 23 hours when the clocks go forward, 25 when they go back", () => {
    const spring = hallDaySpan(Date.UTC(2026, 2, 29, 12));
    expect(spring).toEqual({ start: Date.UTC(2026, 2, 29, 0), end: Date.UTC(2026, 2, 29, 23) });
    const autumn = hallDaySpan(Date.UTC(2026, 9, 25, 12));
    expect(autumn).toEqual({ start: Date.UTC(2026, 9, 24, 23), end: Date.UTC(2026, 9, 26, 0) });
    // The next midnight belongs to the next day.
    expect(hallDaySpan(autumn.end).start).toBe(autumn.end);
  });

  it("reads the measured skylines: the blocks across Glassford Street and the Garth Street gap", () => {
    expect(windowSkyline("arch-centre", 100)).toBeCloseTo(10.2, 1);
    expect(windowSkyline("arch-centre", 70)).toBeGreaterThan(17);
    expect(windowSkyline("arch-centre", 5)).toBeNull();
    // The sun low in the gap comes in; the same sun behind the blocks does not.
    expect(sunReachesFloor(100, 12)).toBe(true);
    expect(sunReachesFloor(70, 12)).toBe(false);
    // Too far round for the reveals, whatever its height.
    expect(sunReachesFloor(185, 50)).toBe(false);
  });

  // The windows' sun-clearance times computed independently from the same
  // LiDAR skylines with the NOAA solar algorithm (research of 16 October 2026,
  // reveal-limited): about 07:46 BST at midsummer; at the March equinox from
  // 07:38 GMT (the centre arch, through the Garth Street gap); and a few
  // minutes at most at midwinter. The mornings end when the sun has gone round
  // past the widest arch's reveal as the hall draws it (70.9 degrees off the
  // wall's normal, 2.67 m through 0.924 m): by the NOAA spreadsheet formulas
  // (22 October 2026) azimuth 172.0 degrees at 13:01 BST at midsummer and
  // 11:58 GMT at the equinox (12:15 and 12:19 with the 0.62 m reveal the dial
  // assumed before; review F3).
  it("lets the sun onto the floor through the summer morning", () => {
    const day = hallDay(Date.UTC(2026, 5, 21, 12));
    const first = day.sunOnFloor[0];
    const last = day.sunOnFloor[day.sunOnFloor.length - 1];
    expect(first).toBeDefined();
    expect(Math.abs(minutes((first?.start ?? 0) - Date.UTC(2026, 5, 21, 6, 46)))).toBeLessThan(12);
    expect(Math.abs(minutes((last?.end ?? 0) - Date.UTC(2026, 5, 21, 12, 1)))).toBeLessThan(12);
  });

  it("lets it in for a shorter morning at the equinox", () => {
    const day = hallDay(Date.UTC(2026, 2, 20, 12));
    const first = day.sunOnFloor[0];
    const last = day.sunOnFloor[day.sunOnFloor.length - 1];
    expect(Math.abs(minutes((first?.start ?? 0) - Date.UTC(2026, 2, 20, 7, 38)))).toBeLessThan(12);
    expect(Math.abs(minutes((last?.end ?? 0) - Date.UTC(2026, 2, 20, 11, 58)))).toBeLessThan(12);
  });

  it("stops the sun where the reveal as drawn stops it: a ray through each window's outer opening", () => {
    // A sun ray entering at one jamb of the outer opening, `degrees` off the wall's normal, still
    // reaches the room's plane within the opening only while degrees < atan(width / depth).
    for (const window of ["arch-fireplace", "window-fireplace", "arch-centre", "window-end", "arch-end"] as const) {
      const { width, depth } = windowReveal(window);
      const limit = windowRevealLimit(window);
      const lands = (degrees: number): boolean => width - depth * Math.tan((degrees * Math.PI) / 180) > 0;
      expect(lands(limit - 0.2)).toBe(true);
      expect(lands(limit + 0.2)).toBe(false);
      expect(depth).toBeGreaterThan(0.9);
    }
    expect(windowRevealLimit("arch-centre")).toBeCloseTo(70.9, 1);
    expect(windowRevealLimit("window-end")).toBeCloseTo(52.4, 1);
  });

  it("keeps the low midwinter sun behind the roofs", () => {
    const day = hallDay(Date.UTC(2026, 11, 21, 12));
    const lit = day.sunOnFloor.reduce((sum, span) => sum + span.end - span.start, 0);
    expect(minutes(lit)).toBeLessThan(15);
  });

  it("draws the sun's path from midnight to midnight", () => {
    const day = hallDay(Date.UTC(2026, 5, 21, 12));
    expect(day.path[0]?.at).toBe(day.dayStart);
    expect(day.path.length).toBeGreaterThan(140);
    const highest = Math.max(...day.path.map((sample) => sample.altitude));
    expect(highest).toBeGreaterThan(57);
    expect(highest).toBeLessThan(58);
  });
});
