// The device is in New York for this whole file: every answer must still be Glasgow time (lens C-16).
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import {
  defaultLeadTime,
  durationWords,
  fromGlasgowWallInput,
  glasgowClock,
  glasgowDay,
  glasgowWallInput,
  parseClock,
  startOnVenueDay,
} from "../event-details-times.js";

describe("Event details' times are Glasgow time on any device", () => {
  it("runs on a device whose own zone is not Glasgow's", () => {
    // 18:00 on the device is 23:00 UTC in November: the zone this file set took effect.
    expect(new Date("2026-11-28T18:00").toISOString()).toBe("2026-11-28T23:00:00.000Z");
  });

  it("stores 18:00 typed in New York as 18:00 Glasgow, in winter and in summer", () => {
    expect(fromGlasgowWallInput("2026-11-28T18:00", "")).toBe("2026-11-28T18:00:00.000Z");
    expect(fromGlasgowWallInput("2026-06-13T18:00", "")).toBe("2026-06-13T17:00:00.000Z");
  });

  it("shows a stored time back as Glasgow wall time", () => {
    expect(glasgowWallInput("2026-06-13T17:00:00.000Z")).toBe("2026-06-13T18:00");
    expect(glasgowClock("2026-06-13T17:00:00.000Z")).toBe("18:00");
    expect(glasgowClock("2026-11-28T23:30:00.000Z")).toBe("23:30");
    expect(glasgowDay("2026-11-28T19:00:00.000Z")).toBe("Sat 28 Nov 2026");
  });

  it("keeps the saved time when the field is cleared or half typed (v1's rule)", () => {
    expect(fromGlasgowWallInput("", "2026-11-28T16:30:00.000Z")).toBe("2026-11-28T16:30:00.000Z");
    expect(fromGlasgowWallInput("2026-11-2", "2026-11-28T16:30:00.000Z")).toBe("2026-11-28T16:30:00.000Z");
    expect(glasgowClock(null)).toBeNull();
    expect(glasgowWallInput("not a time")).toBe("");
  });
});

describe("an act's start, typed as a clock time", () => {
  it("reads the ways people type a time", () => {
    expect(parseClock("18:45")).toBe(18 * 60 + 45);
    expect(parseClock("18.45")).toBe(18 * 60 + 45);
    expect(parseClock("1845")).toBe(18 * 60 + 45);
    expect(parseClock(" 9:05 ")).toBe(9 * 60 + 5);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("18:4")).toBeNull();
    expect(parseClock("6pm")).toBeNull();
  });

  it("goes on the event's day, and the small hours after it belong to the same evening", () => {
    const dinner = "2026-11-28T19:00:00.000Z";
    expect(startOnVenueDay(21 * 60, dinner)).toBe("2026-11-28T21:00:00.000Z");
    expect(startOnVenueDay(30, dinner)).toBe("2026-11-29T00:30:00.000Z");
    // An act already in the small hours moved to 23:00 stays on the same evening.
    expect(startOnVenueDay(23 * 60, "2026-11-29T00:30:00.000Z")).toBe("2026-11-28T23:00:00.000Z");
    // Summer: Glasgow is an hour ahead of UTC.
    expect(startOnVenueDay(18 * 60, "2026-06-13T17:00:00.000Z")).toBe("2026-06-13T17:00:00.000Z");
  });

  it("has no day to put the time on without an act's or the event's start", () => {
    expect(startOnVenueDay(18 * 60, null)).toBeNull();
  });
});

describe("where a new deadline or door time starts (never tomorrow 16:30 in the device's zone)", () => {
  it("is two hours before the event when its start is known", () => {
    expect(defaultLeadTime("2026-11-28T19:00:00.000Z", new Date("2026-10-26T12:00:00Z"))).toBe("2026-11-28T17:00:00.000Z");
  });

  it("is 16:30 Glasgow time the next venue day otherwise", () => {
    expect(defaultLeadTime(null, new Date("2026-10-26T12:00:00Z"))).toBe("2026-10-27T16:30:00.000Z");
    expect(defaultLeadTime(null, new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-02T15:30:00.000Z");
  });
});

describe("durations in words", () => {
  it("says hours and minutes plainly", () => {
    expect(durationWords(45)).toBe("45 min");
    expect(durationWords(120)).toBe("2 h");
    expect(durationWords(90)).toBe("1 h 30 min");
  });
});
