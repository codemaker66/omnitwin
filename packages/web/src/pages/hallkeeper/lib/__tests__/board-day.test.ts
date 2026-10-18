import { describe, expect, it } from "vitest";
import { msToWallInput } from "../../../diary/lib/board-time.js";
import { nextTickMs } from "../use-board-clock.js";
import { boardDayAnchorMs, nextBoardRolloverMs, soonerOf } from "../board-day.js";

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
