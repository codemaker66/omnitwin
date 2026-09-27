import { describe, expect, it } from "vitest";
import { daysFromToday, eventDayKicker } from "../event-day-words.js";

const LONDON = "Europe/London";
const at = (iso: string): number => Date.parse(iso);

describe("the event-day board's words for its day", () => {
  it("counts days on the venue's calendar, not the device's", () => {
    // 00:30 in Glasgow on 12 June is still 11 June in UTC.
    expect(daysFromToday("2026-06-12T18:00:00.000Z", LONDON, at("2026-06-11T23:30:00.000Z"))).toBe(0);
    expect(eventDayKicker("2026-06-12T18:00:00.000Z", LONDON, at("2026-06-11T23:30:00.000Z"))).toBe("Today's event");
    // …and 23:30 in Glasgow on 11 June is the day before.
    expect(eventDayKicker("2026-06-12T18:00:00.000Z", LONDON, at("2026-06-11T22:30:00.000Z"))).toBe("Tomorrow's event");
  });

  it("counts whole days across the clocks going back", () => {
    // The clocks go back on 25 October 2026; that day has 25 hours.
    expect(daysFromToday("2026-10-26T18:00:00.000Z", LONDON, at("2026-10-24T12:00:00.000Z"))).toBe(2);
    expect(daysFromToday("2026-10-25T23:30:00.000Z", LONDON, at("2026-10-25T00:30:00.000Z"))).toBe(0);
  });

  it("says when the event is in words a venue would use", () => {
    const now = at("2026-10-03T12:00:00.000Z");
    expect(eventDayKicker("2026-10-03T17:00:00.000Z", LONDON, now)).toBe("Today's event");
    expect(eventDayKicker("2026-10-04T17:00:00.000Z", LONDON, now)).toBe("Tomorrow's event");
    expect(eventDayKicker("2026-10-02T17:00:00.000Z", LONDON, now)).toBe("Yesterday's event");
    expect(eventDayKicker("2026-10-08T17:00:00.000Z", LONDON, now)).toBe("In 5 days");
    expect(eventDayKicker("2026-09-30T17:00:00.000Z", LONDON, now)).toBe("3 days ago");
  });

  it("says so when the event has no readable date", () => {
    expect(eventDayKicker(null, LONDON, at("2026-10-03T12:00:00.000Z"))).toBe("Date not set");
    expect(eventDayKicker("not a date", LONDON, at("2026-10-03T12:00:00.000Z"))).toBe("Date not set");
  });
});
