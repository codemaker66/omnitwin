import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { msToWallInput } from "../../../diary/lib/board-time.js";
import { nextTickMs } from "../use-board-clock.js";
import { boardDayAnchorMs, boardDayRange, nextBoardRolloverMs, soonerOf, useDayBoundaryHour } from "../board-day.js";

const settings = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../../api/operating-settings.js", () => ({
  getOperatingSettings: (venueId: string) => settings.get(venueId) as Promise<unknown>,
  updateOperatingSettings: () => Promise.reject(new Error("not in this test")),
}));

afterEach(() => { cleanup(); vi.useRealTimers(); settings.get.mockReset(); });

// The board's day (goal 19 S8 item 14, people matrix §6): a wall left on
// all night still shows yesterday's board at 03:59 when the venue's day
// boundary is 04:00, and rolls once, at 04:00 on the wall clock.

const day = (ms: number): string => msToWallInput(ms).slice(0, 10);

describe("the board's day", () => {
  it("before the boundary hour the board still shows yesterday", () => {
    // 03:59 London on 21 Jan 2026 = 03:59Z
    expect(day(boardDayAnchorMs(Date.parse("2026-01-21T03:59:00.000Z"), 4))).toBe("2026-01-20");
    expect(day(boardDayAnchorMs(Date.parse("2026-01-21T04:00:00.000Z"), 4))).toBe("2026-01-21");
  });

  it("boundary 0 is midnight, as the board rolled before S8", () => {
    expect(day(boardDayAnchorMs(Date.parse("2026-01-21T00:00:00.000Z"), 0))).toBe("2026-01-21");
    expect(day(boardDayAnchorMs(Date.parse("2026-01-20T23:59:59.000Z"), 0))).toBe("2026-01-20");
  });

  it("the next rollover is the wall clock's next 04:00, across both DST Sundays", () => {
    // 29 Mar 2026: clocks go forward at 01:00Z; 04:00 BST = 03:00Z
    expect(nextBoardRolloverMs(Date.parse("2026-03-28T12:00:00.000Z"), 4)).toBe(Date.parse("2026-03-29T03:00:00.000Z"));
    // 25 Oct 2026: clocks go back at 01:00Z; 04:00 GMT = 04:00Z
    expect(nextBoardRolloverMs(Date.parse("2026-10-24T12:00:00.000Z"), 4)).toBe(Date.parse("2026-10-25T04:00:00.000Z"));
    // Exactly at the boundary the next one is tomorrow's.
    expect(nextBoardRolloverMs(Date.parse("2026-01-21T04:00:00.000Z"), 4)).toBe(Date.parse("2026-01-22T04:00:00.000Z"));
  });

  it("the board's day runs from midnight to the next boundary hour, so the late part of the venue's day is on it", () => {
    // 00:30 on 21 Jan with boundary 4: yesterday's board, ending 04:00 today.
    const night = boardDayRange(boardDayAnchorMs(Date.parse("2026-01-21T00:30:00.000Z"), 4), 4);
    expect(msToWallInput(night.fromMs)).toBe("2026-01-20T00:00");
    expect(msToWallInput(night.toMs)).toBe("2026-01-21T04:00");
    expect(night.view).toBe("day");
    // Boundary 0 is the plain calendar day, as before S8.
    const plain = boardDayRange(Date.parse("2026-01-21T12:00:00.000Z"), 0);
    expect(msToWallInput(plain.fromMs)).toBe("2026-01-21T00:00");
    expect(msToWallInput(plain.toMs)).toBe("2026-01-22T00:00");
    // The spring Sunday is 23 hours long and the range still ends at the wall clock's 04:00.
    const spring = boardDayRange(Date.parse("2026-03-29T12:00:00.000Z"), 4);
    expect(msToWallInput(spring.toMs)).toBe("2026-03-30T04:00");
  });

  it("the boundary hour is read once settled, and a failed read is tried again rather than left at midnight", async () => {
    vi.useFakeTimers();
    settings.get.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ dayBoundaryHour: 4 });
    const hook = renderHook(() => useDayBoundaryHour("venue-1"));
    expect(hook.result.current).toBe(0);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(hook.result.current).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(hook.result.current).toBe(4);
    expect(settings.get).toHaveBeenCalledTimes(2);
  });

  it("soonerOf takes the earlier instant and tolerates no slot boundary", () => {
    expect(soonerOf(null, 10)).toBe(10);
    expect(soonerOf(5, 10)).toBe(5);
    expect(soonerOf(20, 10)).toBe(10);
  });

  it("a 26-hour wall shift: one rollover, at 04:00, and no tick finer than the minute between boundaries", () => {
    let now = Date.parse("2026-01-20T15:00:00.000Z");
    const end = now + 26 * 3_600_000;
    const days: string[] = [];
    let ticks = 0;
    while (now < end) {
      const shown = day(boardDayAnchorMs(now, 4));
      if (days[days.length - 1] !== shown) days.push(shown);
      now = nextTickMs(now, nextBoardRolloverMs(now, 4));
      ticks += 1;
    }
    expect(days).toEqual(["2026-01-20", "2026-01-21"]);
    expect(ticks).toBeLessThanOrEqual(26 * 60 + 1);
    expect(day(boardDayAnchorMs(Date.parse("2026-01-21T03:59:59.999Z"), 4))).toBe("2026-01-20");
  });
});
