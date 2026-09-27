import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "@omnitwin/types";
import { boardRange } from "../board-time.js";
import { dayOpeningMs } from "../day-opening.js";

const HOUR = 3_600_000;
// Saturday 19 September at the venue (BST): 23:00 UTC the evening before.
const SATURDAY = boardRange(Date.parse("2026-09-19T12:00:00.000Z"), "day");

function booking(id: string, startsAt: string, endsAt: string): CalendarEntry {
  return {
    entryType: "booking", id, spaceId: "00000000-0000-4000-8000-0000000000a1", kind: "hold", status: "active", state: "hold",
    title: id, eventType: null, startsAt, endsAt, rank: 1, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  };
}

describe("dayOpeningMs", () => {
  it("opens today an hour before the current time", () => {
    const now = Date.parse("2026-09-19T15:20:00.000Z");
    expect(dayOpeningMs(SATURDAY, [], now)).toBe(now - HOUR);
  });

  it("opens another day an hour before its first booking or phase", () => {
    const now = Date.parse("2026-09-16T08:00:00.000Z");
    const wedding = booking("MacLeod wedding", "2026-09-19T13:00:00.000Z", "2026-09-19T22:30:00.000Z");
    expect(dayOpeningMs(SATURDAY, [wedding], now)).toBe(Date.parse("2026-09-19T12:00:00.000Z"));
    const setUp: CalendarEntry = {
      entryType: "phase", id: "set-up", spaceId: "00000000-0000-4000-8000-0000000000a1", eventId: "00000000-0000-4000-8000-0000000000e1",
      eventName: "MacLeod wedding", name: "Set-up", startsAt: "2026-09-19T09:00:00.000Z", endsAt: "2026-09-19T12:00:00.000Z", sortOrder: 0,
    };
    expect(dayOpeningMs(SATURDAY, [wedding, setUp], now)).toBe(Date.parse("2026-09-19T08:00:00.000Z"));
  });

  it("opens at midnight when the night before runs into the day, and never before the day", () => {
    const now = Date.parse("2026-09-16T08:00:00.000Z");
    const lateNight = booking("Friday wedding", "2026-09-18T14:00:00.000Z", "2026-09-19T00:00:00.000Z");
    expect(dayOpeningMs(SATURDAY, [lateNight], now)).toBe(SATURDAY.fromMs);
    expect(dayOpeningMs(SATURDAY, [], SATURDAY.fromMs + 20 * 60_000)).toBe(SATURDAY.fromMs);
  });

  it("opens an empty day at the working morning", () => {
    // 07:00 BST: an hour before 08:00.
    expect(dayOpeningMs(SATURDAY, [], Date.parse("2026-09-16T08:00:00.000Z"))).toBe(Date.parse("2026-09-19T06:00:00.000Z"));
  });
});
