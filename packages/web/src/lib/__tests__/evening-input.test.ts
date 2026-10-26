import { describe, expect, it } from "vitest";
import { chipScrubbedHour, turnedHour, wheelNotches, wheelPixels } from "../evening-input.js";

// ---------------------------------------------------------------------------
// The hour chip in the hand (spec 6.2, 11): 1 px = 2 min (Shift 10 s);
// 15 min a wheel notch (Shift 1 min); up and right are later.
// ---------------------------------------------------------------------------

const t = (iso: string): number => Date.parse(iso);
const AT = t("2026-11-28T19:30:00Z");

describe("dragging the chip", () => {
  it("moves two minutes a pixel, to the minute", () => {
    expect(chipScrubbedHour(AT, 30, false)).toBe(t("2026-11-28T20:30:00Z"));
    expect(chipScrubbedHour(AT, -15, false)).toBe(t("2026-11-28T19:00:00Z"));
  });

  it("moves ten seconds a pixel with Shift", () => {
    expect(chipScrubbedHour(AT, 6, true)).toBe(t("2026-11-28T19:31:00Z"));
    expect(chipScrubbedHour(AT, 1, true)).toBe(t("2026-11-28T19:30:10Z"));
  });
});

describe("scrolling over the chip", () => {
  it("reads up and right as later, along the axis that moved most", () => {
    expect(wheelPixels({ deltaX: 0, deltaY: -100, deltaMode: 0 }, 800)).toBe(100);
    expect(wheelPixels({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800)).toBe(-100);
    // Shift turns a wheel sideways in Chrome on Windows.
    expect(wheelPixels({ deltaX: 100, deltaY: 0, deltaMode: 0 }, 800)).toBe(100);
    expect(wheelPixels({ deltaX: 0, deltaY: -3, deltaMode: 1 }, 800)).toBe(99);
  });

  it("counts a mouse's notch as one, and adds a trackpad's small deltas up to one", () => {
    expect(wheelNotches(0, 100)).toEqual({ notches: 1, rest: 0 });
    expect(wheelNotches(0, 120)).toEqual({ notches: 1, rest: 0 });
    expect(wheelNotches(0, -240)).toEqual({ notches: -2, rest: 0 });
    let carried = 0;
    let notches = 0;
    for (let index = 0; index < 10; index += 1) {
      const result = wheelNotches(carried, 12);
      carried = result.rest;
      notches += result.notches;
    }
    expect(notches).toBe(1);
    expect(carried).toBe(20);
    // Turning back starts afresh.
    expect(wheelNotches(40, -10)).toEqual({ notches: 0, rest: -10 });
  });

  it("turns 15 minutes a notch on the quarter, or a minute with Shift", () => {
    expect(turnedHour(t("2026-11-28T19:41:00Z"), 1, false)).toBe(t("2026-11-28T19:45:00Z"));
    expect(turnedHour(t("2026-11-28T19:45:00Z"), 1, false)).toBe(t("2026-11-28T20:00:00Z"));
    expect(turnedHour(t("2026-11-28T19:41:00Z"), -1, false)).toBe(t("2026-11-28T19:30:00Z"));
    expect(turnedHour(t("2026-11-28T19:41:30Z"), 1, true)).toBe(t("2026-11-28T19:42:00Z"));
    expect(turnedHour(AT, 0, false)).toBe(AT);
  });
});
