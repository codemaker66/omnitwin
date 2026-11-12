import { describe, expect, it } from "vitest";
import { boardDayOf, supplierTimes } from "../supplier-times.js";

// ---------------------------------------------------------------------------
// A supplier's times on the board's day: the board runs to 04:00 the next
// morning, so the small hours are the night after; a leaving time before the
// arrival is the morning after it; a time the clocks skip is named.
// ---------------------------------------------------------------------------

const TZ = "Europe/London";
const ms = (iso: string): number => Date.parse(iso);

describe("boardDayOf", () => {
  it("puts the hours before the boundary on the day before", () => {
    expect(boardDayOf(ms("2026-11-15T00:30:00.000Z"), 4, TZ)).toBe("2026-11-14");
    expect(boardDayOf(ms("2026-11-15T03:59:00.000Z"), 4, TZ)).toBe("2026-11-14");
    expect(boardDayOf(ms("2026-11-15T04:00:00.000Z"), 4, TZ)).toBe("2026-11-15");
    // A venue without a boundary keeps the calendar day.
    expect(boardDayOf(ms("2026-11-15T00:30:00.000Z"), 0, TZ)).toBe("2026-11-15");
  });

  it("reads the venue's clock, not UTC, in summer", () => {
    // 23:30 UTC on 14 June is 00:30 BST on the 15th: still the 14th's night.
    expect(boardDayOf(ms("2026-06-14T23:30:00.000Z"), 4, TZ)).toBe("2026-06-14");
    // 03:30 UTC is 04:30 BST: the 15th's own day.
    expect(boardDayOf(ms("2026-06-15T03:30:00.000Z"), 4, TZ)).toBe("2026-06-15");
  });
});

describe("supplierTimes", () => {
  it("puts a time on the board's date, and one before the boundary on the night after", () => {
    expect(supplierTimes("11:00", "", "2026-11-14", 4, TZ)).toEqual({ arrivesMs: ms("2026-11-14T11:00:00.000Z"), leavesMs: null, skipped: null });
    expect(supplierTimes("00:30", "02:00", "2026-11-14", 4, TZ)).toEqual({
      arrivesMs: ms("2026-11-15T00:30:00.000Z"), leavesMs: ms("2026-11-15T02:00:00.000Z"), skipped: null,
    });
    // The boundary hour itself is the board's own morning.
    expect(supplierTimes("04:00", "", "2026-11-14", 4, TZ)?.arrivesMs).toBe(ms("2026-11-14T04:00:00.000Z"));
    expect(supplierTimes("00:30", "", "2026-11-14", 0, TZ)?.arrivesMs).toBe(ms("2026-11-14T00:30:00.000Z"));
  });

  it("reads a leaving time before the arrival as the morning after it", () => {
    expect(supplierTimes("20:30", "00:45", "2026-11-14", 4, TZ)?.leavesMs).toBe(ms("2026-11-15T00:45:00.000Z"));
    expect(supplierTimes("22:00", "05:00", "2026-11-14", 4, TZ)?.leavesMs).toBe(ms("2026-11-15T05:00:00.000Z"));
    expect(supplierTimes("09:00", "17:00", "2026-11-14", 4, TZ)?.leavesMs).toBe(ms("2026-11-14T17:00:00.000Z"));
  });

  it("reads summer times on British Summer Time", () => {
    expect(supplierTimes("19:00", "00:30", "2026-06-13", 4, TZ)).toEqual({
      arrivesMs: ms("2026-06-13T18:00:00.000Z"), leavesMs: ms("2026-06-13T23:30:00.000Z"), skipped: null,
    });
  });

  it("is nothing without a readable arrival time", () => {
    expect(supplierTimes("", "", "2026-11-14", 4, TZ)).toBeNull();
    expect(supplierTimes("7pm", "", "2026-11-14", 4, TZ)).toBeNull();
    expect(supplierTimes("19:00", "late", "2026-11-14", 4, TZ)).toBeNull();
  });

  it("names a time the clocks skip, and the time it would be kept as", () => {
    // Sunday 28 March 2027: 01:00 GMT becomes 02:00 BST.
    expect(supplierTimes("20:00", "01:30", "2027-03-27", 4, TZ)).toEqual({
      arrivesMs: ms("2027-03-27T20:00:00.000Z"),
      leavesMs: ms("2027-03-28T01:30:00.000Z"),
      skipped: { field: "leaves", typed: "01:30", stored: "02:30" },
    });
    expect(supplierTimes("01:30", "", "2027-03-27", 4, TZ)?.skipped).toEqual({ field: "arrives", typed: "01:30", stored: "02:30" });
    expect(supplierTimes("20:00", "02:30", "2027-03-27", 4, TZ)?.skipped).toBeNull();
  });

  it("takes the second 01:30 on the night the clocks go back, as the clock reads it", () => {
    // Sunday 25 October 2026: 01:30 happens twice; the second is GMT.
    expect(supplierTimes("20:30", "01:30", "2026-10-24", 4, TZ)).toEqual({
      arrivesMs: ms("2026-10-24T19:30:00.000Z"), leavesMs: ms("2026-10-25T01:30:00.000Z"), skipped: null,
    });
  });
});
