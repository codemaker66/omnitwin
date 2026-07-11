import { describe, expect, it } from "vitest";
import {
  VENUE_TIME_ZONE,
  boardRange,
  dayColumns,
  formatWallDay,
  formatWallTime,
  hourTicks,
  msToX,
  rangeTitle,
  shiftRange,
  snapMs,
  widthPx,
} from "../board-time.js";

// ---------------------------------------------------------------------------
// Board time math (T-493; Canon §2.10/§8) — venue-local wall-clock windows
// over UTC instants, DST-proof by construction. Europe/London 2026:
// spring forward Sun 29 Mar (01:00 GMT → 02:00 BST, a 23-hour day),
// fall back Sun 25 Oct (02:00 BST → 01:00 GMT, a 25-hour day).
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;

describe("boardRange", () => {
  it("uses Europe/London as the venue zone", () => {
    expect(VENUE_TIME_ZONE).toBe("Europe/London");
  });

  it("day view spans local midnight to local midnight (BST: 23:00Z boundaries)", () => {
    const range = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "day");
    expect(new Date(range.fromMs).toISOString()).toBe("2026-09-15T23:00:00.000Z");
    expect(new Date(range.toMs).toISOString()).toBe("2026-09-16T23:00:00.000Z");
  });

  it("the spring-forward day is 23 hours long", () => {
    const range = boardRange(Date.parse("2026-03-29T12:00:00.000Z"), "day");
    expect(new Date(range.fromMs).toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(range.toMs - range.fromMs).toBe(23 * HOUR);
  });

  it("the fall-back day is 25 hours long", () => {
    const range = boardRange(Date.parse("2026-10-25T12:00:00.000Z"), "day");
    expect(new Date(range.fromMs).toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(range.toMs - range.fromMs).toBe(25 * HOUR);
  });

  it("week view starts on the local Monday midnight", () => {
    const range = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "week");
    // Mon 14 Sep 2026, 00:00 BST = 13 Sep 23:00Z
    expect(new Date(range.fromMs).toISOString()).toBe("2026-09-13T23:00:00.000Z");
    expect(range.toMs - range.fromMs).toBe(168 * HOUR);
  });

  it("weeks containing DST transitions are 167 and 169 hours", () => {
    const spring = boardRange(Date.parse("2026-03-26T12:00:00.000Z"), "week");
    expect(spring.toMs - spring.fromMs).toBe(167 * HOUR);
    const fall = boardRange(Date.parse("2026-10-22T12:00:00.000Z"), "week");
    expect(fall.toMs - fall.fromMs).toBe(169 * HOUR);
  });

  it("month view spans the 1st to the 1st", () => {
    const range = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "month");
    expect(new Date(range.fromMs).toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(new Date(range.toMs).toISOString()).toBe("2026-09-30T23:00:00.000Z");
  });
});

describe("shiftRange", () => {
  it("moves a day window forward and back symmetrically", () => {
    const base = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "day");
    const next = shiftRange(base, 1);
    expect(new Date(next.fromMs).toISOString()).toBe("2026-09-16T23:00:00.000Z");
    const back = shiftRange(next, -1);
    expect(back.fromMs).toBe(base.fromMs);
  });

  it("crosses the spring-forward boundary without drifting", () => {
    const saturday = boardRange(Date.parse("2026-03-28T12:00:00.000Z"), "day");
    const sunday = shiftRange(saturday, 1);
    expect(sunday.toMs - sunday.fromMs).toBe(23 * HOUR);
    const monday = shiftRange(sunday, 1);
    expect(new Date(monday.fromMs).toISOString()).toBe("2026-03-29T23:00:00.000Z");
  });

  it("moves months across the year boundary", () => {
    const december = boardRange(Date.parse("2026-12-10T12:00:00.000Z"), "month");
    const january = shiftRange(december, 1);
    expect(new Date(january.fromMs).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("snapMs", () => {
  it("snaps to the nearest absolute quarter hour", () => {
    expect(snapMs(Date.parse("2026-09-16T17:07:00.000Z"), 15)).toBe(
      Date.parse("2026-09-16T17:00:00.000Z"),
    );
    expect(snapMs(Date.parse("2026-09-16T17:08:00.000Z"), 15)).toBe(
      Date.parse("2026-09-16T17:15:00.000Z"),
    );
  });

  it("supports the 1-minute fine step (Shift)", () => {
    expect(snapMs(Date.parse("2026-09-16T17:07:29.000Z"), 1)).toBe(
      Date.parse("2026-09-16T17:07:00.000Z"),
    );
    expect(snapMs(Date.parse("2026-09-16T17:07:31.000Z"), 1)).toBe(
      Date.parse("2026-09-16T17:08:00.000Z"),
    );
  });
});

describe("geometry", () => {
  it("maps instants to x offsets by pixels-per-hour", () => {
    const range = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "day");
    expect(msToX(range.fromMs + 2 * HOUR, range, 96)).toBe(192);
    expect(widthPx(range.fromMs, range.fromMs + 90 * 60_000, 96)).toBe(144);
  });
});

describe("wall-clock labels and columns", () => {
  it("formats venue-local times and days", () => {
    // 17:00Z in September is 18:00 BST on the wall.
    expect(formatWallTime(Date.parse("2026-09-19T17:00:00.000Z"))).toBe("18:00");
    expect(formatWallDay(Date.parse("2026-09-14T09:00:00.000Z"))).toContain("Mon");
  });

  it("dayColumns yields one column per local day, DST days included", () => {
    const week = boardRange(Date.parse("2026-03-26T12:00:00.000Z"), "week");
    const columns = dayColumns(week);
    expect(columns).toHaveLength(7);
    const sunday = columns[6];
    expect(sunday !== undefined && sunday.endMs - sunday.startMs).toBe(23 * HOUR);
  });

  it("hour ticks skip the nonexistent hour and repeat the folded one", () => {
    const spring = boardRange(Date.parse("2026-03-29T12:00:00.000Z"), "day");
    const springTicks = hourTicks(spring);
    expect(springTicks).toHaveLength(23);
    expect(springTicks[1]?.label).toBe("02:00");

    const fall = boardRange(Date.parse("2026-10-25T12:00:00.000Z"), "day");
    const fallTicks = hourTicks(fall);
    expect(fallTicks).toHaveLength(25);
    expect(fallTicks.filter((tick) => tick.label === "01:00")).toHaveLength(2);
  });

  it("titles the range in venue-local words", () => {
    const week = boardRange(Date.parse("2026-09-16T09:00:00.000Z"), "week");
    expect(rangeTitle(week)).toContain("14 Sep");
    const day = boardRange(Date.parse("2026-09-19T09:00:00.000Z"), "day");
    expect(rangeTitle(day)).toContain("19 Sep");
  });
});
