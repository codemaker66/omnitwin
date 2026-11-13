import { describe, expect, it } from "vitest";
import { nextWallClockReading, quietHoursEndAfter, wallClockAt, withinQuietHours } from "../services/escalation-clock.js";

const QUIET = { start: "22:00", end: "07:00" } as const;

/** An instant from a Europe/London wall-clock reading, by offset. */
function london(iso: string, offsetHours: 0 | 1): number {
  return Date.parse(`${iso}${offsetHours === 1 ? "+01:00" : "Z"}`);
}

describe("quiet hours on the venue's clock", () => {
  it("22:00 to 07:00 holds 22:00, 23:30 and 06:59, not 07:00 or 21:59 (October, BST)", () => {
    expect(withinQuietHours(london("2026-10-16T22:00", 1), QUIET)).toBe(true);
    expect(withinQuietHours(london("2026-10-16T23:30", 1), QUIET)).toBe(true);
    expect(withinQuietHours(london("2026-10-17T06:59", 1), QUIET)).toBe(true);
    expect(withinQuietHours(london("2026-10-17T07:00", 1), QUIET)).toBe(false);
    expect(withinQuietHours(london("2026-10-16T21:59", 1), QUIET)).toBe(false);
    expect(withinQuietHours(london("2026-10-16T12:00", 1), QUIET)).toBe(false);
  });

  it("reads the wall clock, not UTC: 22:30 BST is 21:30Z and still quiet; 06:30Z in January is quiet too", () => {
    expect(withinQuietHours(Date.parse("2026-10-16T21:30:00Z"), QUIET)).toBe(true);
    expect(withinQuietHours(Date.parse("2026-01-16T06:30:00Z"), QUIET)).toBe(true);
    expect(withinQuietHours(Date.parse("2026-01-16T07:00:00Z"), QUIET)).toBe(false);
  });

  it("a window inside one day, and no window when start equals end", () => {
    expect(withinQuietHours(london("2026-06-01T13:00", 1), { start: "12:00", end: "14:00" })).toBe(true);
    expect(withinQuietHours(london("2026-06-01T14:00", 1), { start: "12:00", end: "14:00" })).toBe(false);
    expect(withinQuietHours(london("2026-06-01T03:00", 1), { start: "03:00", end: "03:00" })).toBe(false);
  });

  it("the end of quiet hours is the next 07:00 on the wall, today or tomorrow, and now when not quiet", () => {
    const at2310 = london("2026-10-16T23:10", 1);
    expect(quietHoursEndAfter(at2310, QUIET)).toBe(london("2026-10-17T07:00", 1));
    const at0630 = london("2026-10-17T06:30", 1);
    expect(quietHoursEndAfter(at0630, QUIET)).toBe(london("2026-10-17T07:00", 1));
    const noon = london("2026-10-17T12:00", 1);
    expect(quietHoursEndAfter(noon, QUIET)).toBe(noon);
  });

  it("crosses the October DST Sunday on wall-clock hours: quiet at 23:10 on 24 Oct ends at 07:00 GMT on the 25th, 8 h 50 later", () => {
    const saturdayNight = london("2026-10-24T23:10", 1);
    const end = quietHoursEndAfter(saturdayNight, QUIET);
    expect(end).toBe(Date.parse("2026-10-25T07:00:00Z"));
    expect((end - saturdayNight) / 3_600_000).toBeCloseTo(8 + 50 / 60, 5);
    expect(wallClockAt(end).minuteOfDay).toBe(7 * 60);
  });

  it("crosses the March DST Sunday: quiet at 23:10 on 28 Mar ends at 07:00 BST on the 29th, 6 h 50 later", () => {
    const saturdayNight = Date.parse("2026-03-28T23:10:00Z");
    const end = quietHoursEndAfter(saturdayNight, QUIET);
    expect(end).toBe(Date.parse("2026-03-29T06:00:00Z"));
    expect((end - saturdayNight) / 3_600_000).toBeCloseTo(6 + 50 / 60, 5);
  });

  it("a reading that is now is now, to the minute", () => {
    const sharp = london("2026-10-17T07:00", 1);
    expect(nextWallClockReading(sharp + 30_000, "07:00")).toBe(sharp);
  });
});
