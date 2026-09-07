import { describe, expect, it } from "vitest";
import type { CalendarBookingEntry, CalendarEntry, CalendarPhaseEntry } from "@omnitwin/types";
import { bookingStateLabel, bookingTimeLabel, entriesForDay, firstVisibleDay } from "../board-overview.js";
import { boardRange, dayColumns, type DayColumn } from "../board-time.js";

const SPACE = "00000000-0000-4000-8000-000000000001";
const OTHER_SPACE = "00000000-0000-4000-8000-000000000002";
const HOUR = 3_600_000;

function booking(id: string, overrides: Partial<CalendarBookingEntry> = {}): CalendarBookingEntry {
  return {
    entryType: "booking", id, spaceId: SPACE, kind: "ink", status: "active", state: "ink",
    title: "Short room booking", eventType: null,
    startsAt: "2026-09-07T08:00:00.000Z", endsAt: "2026-09-07T08:15:00.000Z",
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
    ...overrides,
  };
}

function dayAt(iso: string): DayColumn {
  const day = dayColumns(boardRange(Date.parse(iso), "day"))[0];
  if (day === undefined) throw new Error("Expected a venue-local day");
  return day;
}

describe("overview day membership", () => {
  it("keeps short overlapping bookings and standalone phases, ordered without mutating the input", () => {
    const later = booking("c", { startsAt: "2026-09-07T08:05:00.000Z" });
    const second = booking("b");
    const first = booking("a");
    const phase: CalendarPhaseEntry = {
      entryType: "phase", id: "phase", spaceId: SPACE,
      eventId: "00000000-0000-4000-8000-000000000003", eventName: "Setup-only event",
      name: "Setup", startsAt: "2026-09-07T07:30:00.000Z", endsAt: "2026-09-07T07:45:00.000Z", sortOrder: 0,
    };
    const entries: readonly CalendarEntry[] = [later, second, phase, first, booking("other", { spaceId: OTHER_SPACE })];
    expect(entriesForDay(entries, SPACE, dayAt("2026-09-07T12:00:00Z"))).toEqual([phase, first, second, later]);
    expect(entries.map((entry) => entry.id)).toEqual(["c", "b", "phase", "a", "other"]);
  });

  it("excludes touching midnight boundaries but includes actual overnight continuations", () => {
    const monday = dayAt("2026-09-07T12:00:00Z");
    const tuesday = dayAt("2026-09-08T12:00:00Z");
    const endingAtMidnight = booking("ends", {
      startsAt: "2026-09-07T22:30:00Z", endsAt: "2026-09-07T23:00:00Z",
    });
    const overnight = booking("overnight", {
      startsAt: "2026-09-07T22:45:00Z", endsAt: "2026-09-07T23:15:00Z",
    });
    const startingAtMidnight = booking("starts", {
      startsAt: "2026-09-07T23:00:00Z", endsAt: "2026-09-07T23:30:00Z",
    });
    const entries = [startingAtMidnight, overnight, endingAtMidnight];
    expect(entriesForDay(entries, SPACE, monday)).toEqual([endingAtMidnight, overnight]);
    expect(entriesForDay(entries, SPACE, tuesday)).toEqual([overnight, startingAtMidnight]);
    expect(overnight.endsAt).toBe("2026-09-07T23:15:00Z");
  });

  it.each([
    { anchor: "2026-03-26T12:00:00Z", weekHours: 167, sundayHours: 23 },
    { anchor: "2026-10-22T12:00:00Z", weekHours: 169, sundayHours: 25 },
  ])("covers exactly seven venue days in the $weekHours-hour DST week", ({ anchor, weekHours, sundayHours }) => {
    const range = boardRange(Date.parse(anchor), "week");
    const days = dayColumns(range);
    expect(days).toHaveLength(7);
    expect(range.toMs - range.fromMs).toBe(weekHours * HOUR);
    const sunday = days[6];
    if (sunday === undefined) throw new Error("Expected Sunday");
    expect(sunday.endMs - sunday.startMs).toBe(sundayHours * HOUR);
    const spanning = booking("whole-week", {
      startsAt: new Date(range.fromMs).toISOString(), endsAt: new Date(range.toMs).toISOString(),
    });
    expect(days.map((day) => entriesForDay([spanning], SPACE, day).length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(entriesForDay([spanning], SPACE, dayAt(new Date(range.toMs + 12 * HOUR).toISOString()))).toEqual([]);
    expect(firstVisibleDay(spanning, range)).toBe(range.fromMs);
  });

  it("includes both real occurrences of the folded London hour without merging distinct bookings", () => {
    const first = booking("first", { startsAt: "2026-10-25T00:15:00Z", endsAt: "2026-10-25T00:30:00Z" });
    const second = booking("second", { startsAt: "2026-10-25T01:15:00Z", endsAt: "2026-10-25T01:30:00Z" });
    expect(entriesForDay([second, first], SPACE, dayAt("2026-10-25T12:00:00Z"))).toEqual([first, second]);
  });
});

describe("overview focus anchors", () => {
  const week = boardRange(Date.parse("2026-09-07T12:00:00Z"), "week");

  it("anchors a continuation that began before the visible week to its first visible cell", () => {
    const continuing = booking("continued", { startsAt: "2026-09-06T20:00:00Z", endsAt: "2026-09-08T01:00:00Z" });
    expect(firstVisibleDay(continuing, week)).toBe(week.fromMs);
  });

  it("anchors an overnight booking to its starting local day, not to its second card", () => {
    const overnight = booking("overnight", { startsAt: "2026-09-08T22:45:00Z", endsAt: "2026-09-08T23:15:00Z" });
    expect(firstVisibleDay(overnight, week)).toBe(Date.parse("2026-09-07T23:00:00Z"));
  });

  it.each([
    { startsAt: "2026-09-06T21:00:00Z", endsAt: "2026-09-06T23:00:00Z" },
    { startsAt: "2026-09-13T23:00:00Z", endsAt: "2026-09-14T01:00:00Z" },
  ])("gives no focus anchor to an entry outside or just touching the range: $startsAt", (interval) => {
    expect(firstVisibleDay(booking("outside", interval), week)).toBeNull();
  });

  it("retains a spanning booking across eight days at a month boundary without adding the end day", () => {
    const month = boardRange(Date.parse("2026-10-15T12:00:00Z"), "month");
    const spanning = booking("eight-days", { startsAt: "2026-09-30T23:00:00Z", endsAt: "2026-10-08T23:00:00Z" });
    const visibleDays = dayColumns(month).filter((day) => entriesForDay([spanning], SPACE, day).length > 0);
    expect(visibleDays).toHaveLength(8);
    expect(firstVisibleDay(spanning, month)).toBe(Date.parse("2026-09-30T23:00:00Z"));
    expect(visibleDays.at(-1)?.endMs).toBe(Date.parse("2026-10-08T23:00:00Z"));
  });
});

describe("overview exact labels", () => {
  it("shows both exact venue-local times for a fifteen-minute booking", () => {
    expect(bookingTimeLabel(booking("short"))).toBe("09:00–09:15");
  });

  it.each([
    { startsAt: "2026-10-25T00:30:00Z", endsAt: "2026-10-25T01:30:00Z", label: "01:30 BST–01:30 GMT" },
    { startsAt: "2026-03-29T00:30:00Z", endsAt: "2026-03-29T01:30:00Z", label: "00:30 GMT–02:30 BST" },
  ])("disambiguates a real one-hour booking across the London clock change: $startsAt", ({ startsAt, endsAt, label }) => {
    expect(Date.parse(endsAt) - Date.parse(startsAt)).toBe(HOUR);
    expect(bookingTimeLabel({ startsAt, endsAt })).toBe(label);
  });

  it("uses the local date to label a UTC-midnight crossing that remains one venue day", () => {
    expect(bookingTimeLabel({ startsAt: "2026-09-06T23:45:00Z", endsAt: "2026-09-07T00:15:00Z" })).toBe("00:45–01:15");
  });

  it("names both dates for an overnight booking whose UTC date does not change", () => {
    expect(bookingTimeLabel({ startsAt: "2026-09-07T22:45:00Z", endsAt: "2026-09-07T23:15:00Z" }))
      .toBe("7 Sept 23:45 – 8 Sept 00:15");
  });

  it.each([
    { kind: "ink", rank: null, jointFlag: false, label: "Confirmed" },
    { kind: "internal_block", rank: null, jointFlag: false, label: "House block" },
    { kind: "prospect", rank: null, jointFlag: false, label: "Prospect · never blocks" },
    { kind: "hold", rank: null, jointFlag: false, label: "Pencilled · unranked" },
    { kind: "hold", rank: 1, jointFlag: true, label: "Pencilled · joint first" },
    { kind: "hold", rank: 2, jointFlag: false, label: "Pencilled · option 2" },
  ] as const)("keeps the commitment distinction: $label", ({ kind, rank, jointFlag, label }) => {
    expect(bookingStateLabel(booking("state", { kind, state: kind, rank, jointFlag }))).toBe(label);
  });

  it.each([
    { status: "cancelled", label: "Cancelled" },
    { status: "released", label: "Released" },
    { status: "expired", label: "Expired" },
    { status: "lost", label: "Lost" },
  ] as const)("preserves the real historical exit status: $status", ({ status, label }) => {
    expect(bookingStateLabel(booking("history", { kind: "hold", status, state: status }))).toBe(label);
  });
});
