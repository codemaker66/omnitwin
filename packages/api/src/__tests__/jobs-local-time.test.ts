import { describe, expect, it } from "vitest";
import { computeHoldReminderInstants } from "../services/hold-hygiene.js";
import { nextLocalTime } from "../services/jobs/local-time.js";

// T-702, times on the venue's clock. nextLocalTime is pure: no database and no
// clock of its own. In 2027 the United Kingdom's clocks change on Sunday 28
// March (01:00 becomes 02:00) and Sunday 31 October (02:00 becomes 01:00).

function at(after: string, hhmm: string, zone: string): string {
  return nextLocalTime(new Date(after), hhmm, zone).toISOString();
}

describe("jobs: nextLocalTime", () => {
  it("09:00 in London across the spring change", () => {
    expect(at("2027-03-27T09:00:00Z", "09:00", "Europe/London")).toBe("2027-03-28T08:00:00.000Z");
    expect(at("2027-03-28T08:00:00Z", "09:00", "Europe/London")).toBe("2027-03-29T08:00:00.000Z");
  });

  it("09:00 in London across the autumn change", () => {
    expect(at("2027-10-30T08:00:00Z", "09:00", "Europe/London")).toBe("2027-10-31T09:00:00.000Z");
    expect(at("2027-10-31T09:00:00Z", "09:00", "Europe/London")).toBe("2027-11-01T09:00:00.000Z");
  });

  it("a time that does not exist becomes the first instant after the gap", () => {
    expect(at("2027-03-28T00:00:00Z", "01:30", "Europe/London")).toBe("2027-03-28T01:00:00.000Z");
  });

  it("a time that happens twice is its first occurrence", () => {
    expect(at("2027-10-30T23:30:00Z", "01:30", "Europe/London")).toBe("2027-10-31T00:30:00.000Z");
  });

  it("is strictly after, and refuses a malformed time or zone", () => {
    expect(at("2027-06-01T08:00:00Z", "09:00", "Europe/London")).toBe("2027-06-02T08:00:00.000Z");
    expect(() => nextLocalTime(new Date(), "9am", "Europe/London")).toThrow();
    expect(() => nextLocalTime(new Date(), "09:00", "Mars/Olympus")).toThrow();
  });

  it("pins what hold reminders do today: seven days before is exactly 168 hours", () => {
    const decision = new Date("2027-03-29T08:00:00Z");                    // 09:00 in London, the day after the change
    const sevenDays = computeHoldReminderInstants(decision).find((instant) => instant.daysBefore === 7);
    expect(sevenDays?.at.toISOString()).toBe("2027-03-22T08:00:00.000Z"); // 08:00 by London's clock, an hour early
  });

  it("refuses every malformed time", () => {
    for (const bad of ["9am", "24:00", "09:60", "9:00", "09:0", "09:00:00", " 09:00", "09:00 ", "", "ab:cd", "-1:00"]) {
      expect(() => nextLocalTime(new Date("2027-06-01T00:00:00Z"), bad, "UTC")).toThrow();
    }
  });

  it("refuses an invalid instant", () => {
    expect(() => nextLocalTime(new Date(Number.NaN), "09:00", "UTC")).toThrow();
  });

  it("is strictly after even by a fraction of a second, and from the very minute", () => {
    expect(at("2027-06-01T08:00:00.000Z", "09:00", "Europe/London")).toBe("2027-06-02T08:00:00.000Z");
    expect(at("2027-06-01T07:59:59.999Z", "09:00", "Europe/London")).toBe("2027-06-01T08:00:00.000Z");
    expect(at("2027-06-01T08:00:00.001Z", "09:00", "Europe/London")).toBe("2027-06-02T08:00:00.000Z");
  });

  it("a gap time already passed that day gives the next day's, not the same gap again", () => {
    // 01:15 UTC on 28 March is 02:15 in London: the gap's first instant (01:00 UTC) is already behind.
    expect(at("2027-03-28T01:15:00Z", "01:30", "Europe/London")).toBe("2027-03-29T00:30:00.000Z");
  });

  it("a time that happens twice gives one run for that date, not a second at its repeat", () => {
    // 00:45 UTC on 31 October is 01:45 in London, after the first 01:30 and before the second (01:30 UTC).
    expect(at("2027-10-31T00:45:00Z", "01:30", "Europe/London")).toBe("2027-11-01T01:30:00.000Z");
  });

  it("the whole hour that is missing and the whole hour that repeats", () => {
    expect(at("2027-03-28T00:00:00Z", "01:00", "Europe/London")).toBe("2027-03-28T01:00:00.000Z");
    expect(at("2027-03-28T00:00:00Z", "01:59", "Europe/London")).toBe("2027-03-28T01:00:00.000Z");
    expect(at("2027-03-28T00:00:00Z", "02:00", "Europe/London")).toBe("2027-03-28T01:00:00.000Z");
    expect(at("2027-03-28T00:00:00Z", "00:59", "Europe/London")).toBe("2027-03-28T00:59:00.000Z");
    expect(at("2027-03-28T00:00:00Z", "03:00", "Europe/London")).toBe("2027-03-28T02:00:00.000Z");
    expect(at("2027-10-30T23:00:00Z", "01:00", "Europe/London")).toBe("2027-10-31T00:00:00.000Z");
    expect(at("2027-10-30T23:00:00Z", "02:00", "Europe/London")).toBe("2027-10-31T02:00:00.000Z");
  });

  it("midnight and the last minute of the day", () => {
    expect(at("2027-06-01T12:00:00Z", "00:00", "Europe/London")).toBe("2027-06-01T23:00:00.000Z");
    expect(at("2027-06-01T12:00:00Z", "23:59", "Europe/London")).toBe("2027-06-01T22:59:00.000Z");
    expect(at("2027-12-31T23:59:00Z", "00:00", "Europe/London")).toBe("2028-01-01T00:00:00.000Z");
  });

  it("carries over a month end, a year end and a leap day", () => {
    expect(at("2027-12-31T10:00:00Z", "09:00", "UTC")).toBe("2028-01-01T09:00:00.000Z");
    expect(at("2028-02-28T10:00:00Z", "09:00", "UTC")).toBe("2028-02-29T09:00:00.000Z");
    expect(at("2028-02-29T10:00:00Z", "09:00", "UTC")).toBe("2028-03-01T09:00:00.000Z");
  });

  it("UTC has no clock changes", () => {
    expect(at("2027-03-27T09:00:00Z", "09:00", "UTC")).toBe("2027-03-28T09:00:00.000Z");
    expect(at("2027-03-28T09:00:00Z", "09:00", "UTC")).toBe("2027-03-29T09:00:00.000Z");
    expect(at("2027-03-28T08:59:00Z", "09:00", "UTC")).toBe("2027-03-28T09:00:00.000Z");
    expect(at("2027-10-31T00:00:00Z", "01:30", "UTC")).toBe("2027-10-31T01:30:00.000Z");
  });

  it("New York, west of UTC: the spring change on 14 March and the autumn change on 7 November", () => {
    // 09:00 is 14:00 UTC in winter (-5) and 13:00 UTC in summer (-4).
    expect(at("2027-03-13T14:00:00Z", "09:00", "America/New_York")).toBe("2027-03-14T13:00:00.000Z");
    expect(at("2027-03-14T13:00:00Z", "09:00", "America/New_York")).toBe("2027-03-15T13:00:00.000Z");
    expect(at("2027-11-06T13:00:00Z", "09:00", "America/New_York")).toBe("2027-11-07T14:00:00.000Z");
    // 02:30 does not exist on 14 March: 02:00 becomes 03:00 at 07:00 UTC.
    expect(at("2027-03-14T00:00:00Z", "02:30", "America/New_York")).toBe("2027-03-14T07:00:00.000Z");
    // 01:30 happens twice on 7 November: first at 05:30 UTC (-4), then at 06:30 UTC (-5).
    expect(at("2027-11-07T00:00:00Z", "01:30", "America/New_York")).toBe("2027-11-07T05:30:00.000Z");
    // The wall date is the zone's, not UTC's: 04:00 UTC on 14 March is 23:00 on 13 March in New York.
    expect(at("2027-03-14T04:00:00Z", "23:00", "America/New_York")).toBe("2027-03-15T03:00:00.000Z");
  });

  it("Sydney, east of UTC, whose clock changes fall the other way round in the year", () => {
    // Forward on 3 October (02:00 becomes 03:00, +10 to +11); back on 4 April (03:00 becomes 02:00, +11 to +10).
    expect(at("2027-10-01T22:00:00Z", "09:00", "Australia/Sydney")).toBe("2027-10-01T23:00:00.000Z");
    expect(at("2027-10-01T23:00:00Z", "09:00", "Australia/Sydney")).toBe("2027-10-02T22:00:00.000Z");
    expect(at("2027-10-02T00:00:00Z", "02:30", "Australia/Sydney")).toBe("2027-10-02T16:00:00.000Z");
    expect(at("2027-04-03T12:00:00Z", "02:30", "Australia/Sydney")).toBe("2027-04-03T15:30:00.000Z");
    expect(at("2027-04-03T00:00:00Z", "09:00", "Australia/Sydney")).toBe("2027-04-03T23:00:00.000Z");
    expect(at("2027-04-03T23:00:00Z", "09:00", "Australia/Sydney")).toBe("2027-04-04T23:00:00.000Z");
  });

  it("a zone whose clock moves by half an hour", () => {
    // Lord Howe: +10:30 in winter, +11 in summer; at 02:00 on 3 October the clock jumps to 02:30.
    expect(at("2027-10-02T00:00:00Z", "02:15", "Australia/Lord_Howe")).toBe("2027-10-02T15:30:00.000Z");
    expect(at("2027-10-02T00:00:00Z", "09:00", "Australia/Lord_Howe")).toBe("2027-10-02T22:00:00.000Z");
  });

  it("a zone with a half-hour offset and no changes", () => {
    expect(at("2027-06-01T00:00:00Z", "09:00", "Asia/Kolkata")).toBe("2027-06-01T03:30:00.000Z");
  });
});
