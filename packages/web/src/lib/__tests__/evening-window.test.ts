import { describe, expect, it } from "vitest";
import { eveningWindow, sameVenueDay, timeAtX, venueDayOf, xAtTime } from "../evening-window.js";

// ---------------------------------------------------------------------------
// The evening's window (spec 6.2): the event's evening, about 105 px an hour,
// or the venue's whole day from 06:00 to 06:00. The sample is frame 03's
// St Andrew's Night (Sat 28 Nov 2026, GMT, so the venue's clock is UTC's).
// ---------------------------------------------------------------------------

const t = (iso: string): number => Date.parse(iso);

const SAMPLE = [
  { start: t("2026-11-28T18:30:00Z"), end: t("2026-11-28T19:15:00Z") },
  { start: t("2026-11-28T19:15:00Z"), end: t("2026-11-28T20:45:00Z") },
  { start: t("2026-11-28T20:45:00Z"), end: t("2026-11-28T21:15:00Z") },
  { start: t("2026-11-28T21:15:00Z"), end: t("2026-11-29T00:30:00Z") },
  { start: t("2026-11-29T00:30:00Z"), end: t("2026-11-29T01:15:00Z") },
];

describe("the venue's day", () => {
  it("runs from 06:00 to the next 06:00, so the small hours belong to the night before", () => {
    expect(venueDayOf(t("2026-11-29T02:00:00Z"))).toEqual({ start: t("2026-11-28T06:00:00Z"), end: t("2026-11-29T06:00:00Z") });
    expect(venueDayOf(t("2026-11-28T06:00:00Z"))).toEqual({ start: t("2026-11-28T06:00:00Z"), end: t("2026-11-29T06:00:00Z") });
    expect(sameVenueDay(t("2026-11-28T21:41:00Z"), t("2026-11-29T01:00:00Z"))).toBe(true);
    expect(sameVenueDay(t("2026-11-28T05:59:00Z"), t("2026-11-28T06:00:00Z"))).toBe(false);
  });

  it("keeps the venue's clock across the change to summer time", () => {
    // 29 Mar 2026: the clocks go forward at 01:00 GMT, so that day starts at 06:00 BST (05:00 UTC).
    expect(venueDayOf(t("2026-03-29T12:00:00Z"))).toEqual({ start: t("2026-03-29T05:00:00Z"), end: t("2026-03-30T05:00:00Z") });
    // The day before is 23 hours long on the venue's clock.
    const before = venueDayOf(t("2026-03-28T12:00:00Z"));
    expect(before).toEqual({ start: t("2026-03-28T06:00:00Z"), end: t("2026-03-29T05:00:00Z") });
  });
});

describe("the evening's window", () => {
  it("runs from the hour before the first act to the last act's end: 17:00 to 01:15 for frame 03", () => {
    const window = eveningWindow({ acts: SAMPLE, at: t("2026-11-28T21:41:00Z"), wholeDay: false });
    expect(window).toEqual({ start: t("2026-11-28T17:00:00Z"), end: t("2026-11-29T01:15:00Z"), kind: "acts" });
    // About 105 px an hour across the 868 px line of a 900 px dock.
    expect(868 / ((window.end - window.start) / 3_600_000)).toBeCloseTo(105.2, 1);
  });

  it("is at least eight hours wide, reaching later into the night first", () => {
    const short = [{ start: t("2026-11-28T19:00:00Z"), end: t("2026-11-28T22:00:00Z") }];
    expect(eveningWindow({ acts: short, at: t("2026-11-28T20:00:00Z"), wholeDay: false }))
      .toEqual({ start: t("2026-11-28T18:00:00Z"), end: t("2026-11-29T02:00:00Z"), kind: "acts" });
    // Near the day's end it reaches back instead.
    const late = [{ start: t("2026-11-29T02:00:00Z"), end: t("2026-11-29T05:30:00Z") }];
    expect(eveningWindow({ acts: late, at: t("2026-11-29T03:00:00Z"), wholeDay: false }))
      .toEqual({ start: t("2026-11-28T22:00:00Z"), end: t("2026-11-29T06:00:00Z"), kind: "acts" });
  });

  it("widens to the whole day when asked, on a day without the event's acts, and for an hour outside the evening", () => {
    const day = { start: t("2026-11-28T06:00:00Z"), end: t("2026-11-29T06:00:00Z"), kind: "day" };
    expect(eveningWindow({ acts: SAMPLE, at: t("2026-11-28T21:41:00Z"), wholeDay: true })).toEqual(day);
    expect(eveningWindow({ acts: SAMPLE, at: t("2026-11-28T08:18:00Z"), wholeDay: false })).toEqual(day);
    expect(eveningWindow({ acts: [], at: t("2026-11-28T21:41:00Z"), wholeDay: false })).toEqual(day);
    expect(eveningWindow({ acts: SAMPLE, at: t("2026-10-26T12:00:00Z"), wholeDay: false }))
      .toEqual({ start: t("2026-10-26T06:00:00Z"), end: t("2026-10-27T06:00:00Z"), kind: "day" });
  });
});

describe("a moment on the line", () => {
  const window = { start: t("2026-11-28T17:00:00Z"), end: t("2026-11-29T01:15:00Z") };

  it("maps time to x and back, held within the window", () => {
    const x = xAtTime(window, 868, t("2026-11-28T21:41:00Z"));
    // 4 h 41 min of 8 h 15 min across 868 px.
    expect(x).toBeCloseTo(492.74, 1);
    expect(timeAtX(window, 868, x)).toBeCloseTo(t("2026-11-28T21:41:00Z"), -2);
    expect(timeAtX(window, 868, -40)).toBe(window.start);
    expect(timeAtX(window, 868, 2000)).toBe(window.end);
  });
});
