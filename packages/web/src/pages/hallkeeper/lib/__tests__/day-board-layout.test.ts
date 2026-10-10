import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import { boardRange } from "../../../diary/lib/board-time.js";
import { deriveDayBoard } from "../day-board-state.js";
import {
  boardWindow,
  fraction,
  gapGeometry,
  minutesOf,
  nowPlaque,
  rulerTicks,
  slabGeometry,
} from "../day-board-layout.js";
import { boardFreshness, nextTickMs, OFFLINE_AFTER_MS, STALE_AFTER_MS } from "../use-board-clock.js";

// Goal 19 S3 — the board's geometry and its clock, without a DOM: the window
// holds the working day and every slot, the ruler's ticks fall on the hours,
// the NOW plaque sits where the corrected clock says, a slab's segments add
// up, the gap between two slots is dimensioned, the next tick is exact, and
// the stale band knows offline from stale.

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const TZ = "Europe/London";
/** 13:00 on a summer Wednesday in Glasgow. */
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = boardRange(NOW, "day", TZ);

function response(entries: CalendarResponse["entries"] = []): CalendarResponse {
  return {
    venueId: VENUE,
    range: { from: new Date(DAY.fromMs).toISOString(), to: new Date(DAY.toMs).toISOString() },
    rooms: [{ id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries,
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
    turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }],
  };
}

function booking(id: string, startOffsetMin: number, endOffsetMin: number): CalendarResponse["entries"][number] {
  return {
    entryType: "booking", id, spaceId: GRAND_HALL, kind: "ink", status: "active", state: "ink", title: "Dinner",
    eventType: "dinner", startsAt: new Date(NOW + startOffsetMin * MIN).toISOString(), endsAt: new Date(NOW + endOffsetMin * MIN).toISOString(),
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  } as CalendarResponse["entries"][number];
}

describe("the window", () => {
  it("is the working day, 07:00 to 23:00, on an empty board", () => {
    const window = boardWindow(DAY, [], NOW, TZ);
    expect(window.fromMs).toBe(DAY.fromMs + 7 * HOUR);
    expect(window.toMs).toBe(DAY.fromMs + 23 * HOUR);
  });

  it("widens to hold an early setup and a late clear-down, half an hour either side, inside the day", () => {
    const board = deriveDayBoard(response([booking("a", -8 * 60, -7 * 60), booking("b", 9 * 60 + 30, 10 * 60 + 30)]), NOW, TZ);
    const window = boardWindow(DAY, board.lanes, NOW, TZ);
    // 05:00 setup → 04:30; 23:30 end + 60 clear-down = 00:30 next day → clamped to midnight.
    expect(window.fromMs).toBe(NOW - 8 * HOUR - 30 * MIN);
    expect(window.toMs).toBe(DAY.toMs);
  });

  it("keeps the present moment in view while the day is on screen", () => {
    const lateNow = DAY.fromMs + 23 * HOUR + 30 * MIN;
    const window = boardWindow(DAY, [], lateNow, TZ);
    expect(window.toMs).toBe(DAY.toMs);
    expect(nowPlaque(lateNow, window)).not.toBeNull();
    // Another day entirely: the plaque is off the board.
    expect(nowPlaque(DAY.toMs + HOUR, window)).toBeNull();
  });
});

describe("the ruler and the plaque", () => {
  it("ticks on every whole hour from the first in the window, labelled in wall time", () => {
    const window = boardWindow(DAY, [], NOW, TZ);
    const ticks = rulerTicks(window, TZ, 1);
    expect(ticks[0]?.label).toBe("07:00");
    expect(ticks[0]?.x).toBe(0);
    expect(ticks[ticks.length - 1]?.label).toBe("23:00");
    expect(ticks).toHaveLength(17);
    const narrow = rulerTicks(window, TZ, 2);
    expect(narrow.filter((tick) => tick.major)).toHaveLength(9);
    expect(narrow[1]?.label).toBe("");
  });

  it("places the plaque at the corrected instant's fraction of the window", () => {
    const window = { fromMs: NOW - 2 * HOUR, toMs: NOW + 6 * HOUR };
    expect(nowPlaque(NOW, window)).toBeCloseTo(0.25, 6);
    expect(fraction(NOW - 3 * HOUR, window)).toBe(0);
    expect(fraction(NOW + 9 * HOUR, window)).toBe(1);
  });
});

describe("slabs and gaps", () => {
  it("lays a slab from setup to the end of clear-down, in three segments that add up", () => {
    const board = deriveDayBoard(response([booking("a", 60, 180)]), NOW, TZ);
    const slot = board.lanes[0]?.slots[0];
    if (slot === undefined) throw new Error("no slot");
    const window = { fromMs: NOW, toMs: NOW + 8 * HOUR };
    const geometry = slabGeometry(slot, window);
    expect(geometry.slab.left).toBeCloseTo(1 / 8, 6);
    expect(geometry.slab.width).toBeCloseTo(3 / 8, 6); // 2 h live + 1 h clear-down
    expect(geometry.setup.width).toBe(0); // no phase: setup is doors
    expect(geometry.live.width).toBeCloseTo(2 / 8, 6);
    expect(geometry.clearDown.width).toBeCloseTo(1 / 8, 6);
    expect(geometry.setup.width + geometry.live.width + geometry.clearDown.width).toBeCloseTo(geometry.slab.width, 6);
  });

  it("dimensions the gap from the first's end to the second's setup, drawn from the first slab's drawn end", () => {
    const board = deriveDayBoard(response([booking("a", 0, 60), booking("b", 120, 180)]), NOW, TZ);
    const [first, second] = board.lanes[0]?.slots ?? [];
    if (first === undefined || second === undefined) throw new Error("two slots expected");
    const window = { fromMs: NOW, toMs: NOW + 4 * HOUR };
    expect(gapGeometry(undefined, first, window)).toBeNull();
    // The hour of turnaround fills the whole gap: the first slab's clear-down
    // runs to the second's setup, so there is no open lane to draw in.
    const gap = gapGeometry(first, second, window);
    expect(gap?.left).toBeCloseTo(0.5, 6);
    expect(gap?.width).toBe(0);
    expect(minutesOf(first.endsAtMs, second.segments.setupStartsAtMs)).toBe(60);
    expect(second.gapBefore).toEqual({ minutes: 60, neededMinutes: 60, short: false });
  });

  it("draws a longer gap in the open lane after the clear-down, keeping the full dimension", () => {
    const board = deriveDayBoard(response([booking("a", 0, 60), booking("b", 180, 240)]), NOW, TZ);
    const [first, second] = board.lanes[0]?.slots ?? [];
    if (first === undefined || second === undefined) throw new Error("two slots expected");
    const window = { fromMs: NOW, toMs: NOW + 4 * HOUR };
    const gap = gapGeometry(first, second, window);
    // Clear-down ends at 02:00; setup at 03:00: the words sit in that hour.
    expect(gap?.left).toBeCloseTo(0.5, 6);
    expect(gap?.width).toBeCloseTo(0.25, 6);
    expect(minutesOf(first.endsAtMs, second.segments.setupStartsAtMs)).toBe(120);
    expect(second.gapBefore).toEqual({ minutes: 120, neededMinutes: 60, short: false });
  });
});

describe("the clock", () => {
  it("ticks at the next boundary or the next whole minute, whichever is sooner, never now", () => {
    const now = Date.parse("2026-09-16T12:00:20.000Z");
    expect(nextTickMs(now, null)).toBe(Date.parse("2026-09-16T12:01:00.000Z"));
    expect(nextTickMs(now, now + 15_000)).toBe(now + 15_000);
    expect(nextTickMs(now, now + 90_000)).toBe(Date.parse("2026-09-16T12:01:00.000Z"));
    expect(nextTickMs(now, now - 1)).toBe(Date.parse("2026-09-16T12:01:00.000Z"));
    const onTheMinute = Date.parse("2026-09-16T12:01:00.000Z");
    expect(nextTickMs(onTheMinute, null)).toBe(onTheMinute + 60_000);
  });

  it("knows live from offline from stale, lets offline explain stale, and never calls a quiet afternoon stale", () => {
    expect(boardFreshness(NOW, NOW - 10_000, null)).toEqual({ kind: "live" });
    expect(boardFreshness(NOW, NOW - 10_000, NOW - OFFLINE_AFTER_MS + 1)).toEqual({ kind: "live" });
    expect(boardFreshness(NOW, NOW - 10_000, NOW - OFFLINE_AFTER_MS)).toEqual({ kind: "offline", sinceMs: NOW - OFFLINE_AFTER_MS });
    // The socket is up and nothing has changed for an hour: still live.
    expect(boardFreshness(NOW, NOW - 60 * MIN, null)).toEqual({ kind: "live" });
    // Down for ten seconds with a read two minutes old: stale, not yet offline.
    expect(boardFreshness(NOW, NOW - STALE_AFTER_MS, NOW - 10_000)).toEqual({ kind: "stale", readAtMs: NOW - STALE_AFTER_MS });
    // The last refresh failed: the day on screen is as old as it is.
    expect(boardFreshness(NOW, NOW - STALE_AFTER_MS, null, true)).toEqual({ kind: "stale", readAtMs: NOW - STALE_AFTER_MS });
    expect(boardFreshness(NOW, NOW - STALE_AFTER_MS, NOW - OFFLINE_AFTER_MS)).toEqual({ kind: "offline", sinceMs: NOW - OFFLINE_AFTER_MS });
    expect(boardFreshness(NOW, null, null)).toEqual({ kind: "live" });
  });
});
