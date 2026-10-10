import { afterEach, describe, expect, it } from "vitest";
import {
  CLOCK_CORRECTED_THRESHOLD_MS,
  __resetClockForTests,
  clockIsCorrected,
  clockOffsetMs,
  clockSampleCount,
  correctedNowMs,
  observeServerNow,
  subscribeClock,
} from "../clock-offset.js";

// Goal 19 D9 — the one corrected clock: a median of the last five offsets,
// so a late frame cannot swing it, and a plain word when the device is far
// out.

afterEach(() => { __resetClockForTests(); });

describe("the corrected clock", () => {
  it("is the device's clock until the server has spoken", () => {
    expect(clockOffsetMs()).toBe(0);
    expect(correctedNowMs(1_000)).toBe(1_000);
    expect(clockSampleCount()).toBe(0);
    expect(clockIsCorrected()).toBe(false);
  });

  it("takes the median of the last five offsets, so one late frame cannot swing it", () => {
    for (const offset of [100, 120, 110]) observeServerNow(10_000 + offset, 10_000);
    expect(clockOffsetMs()).toBe(110);
    // A frame delayed by a second lands with a wild offset…
    observeServerNow(10_000 + 1_100, 10_000);
    // …and the median barely moves.
    expect(clockOffsetMs()).toBe(115);
    observeServerNow(10_000 + 105, 10_000);
    expect(clockOffsetMs()).toBe(110);
    // Only the last five count.
    for (const offset of [500, 500, 500, 500, 500]) observeServerNow(10_000 + offset, 10_000);
    expect(clockSampleCount()).toBe(5);
    expect(clockOffsetMs()).toBe(500);
    expect(correctedNowMs(20_000)).toBe(20_500);
  });

  it("says the clock was corrected only when the device is more than a minute out", () => {
    observeServerNow(10_000 + CLOCK_CORRECTED_THRESHOLD_MS, 10_000);
    expect(clockIsCorrected()).toBe(false);
    observeServerNow(10_000 + CLOCK_CORRECTED_THRESHOLD_MS + 1, 10_000);
    observeServerNow(10_000 + CLOCK_CORRECTED_THRESHOLD_MS + 1, 10_000);
    expect(clockIsCorrected()).toBe(true);
    __resetClockForTests();
    // A device running fast: the server's clock is behind it by more than a minute.
    observeServerNow(1_000_000 - CLOCK_CORRECTED_THRESHOLD_MS - 5_000, 1_000_000);
    expect(clockIsCorrected()).toBe(true);
  });

  it("ignores a frame without a usable clock", () => {
    observeServerNow(0, 10_000);
    observeServerNow(Number.NaN, 10_000);
    observeServerNow(10_000, Number.NaN);
    expect(clockSampleCount()).toBe(0);
  });

  it("tells a listener about every observation, until it leaves", () => {
    let heard = 0;
    const leave = subscribeClock(() => { heard += 1; });
    observeServerNow(10_050, 10_000);
    observeServerNow(10_050, 10_000);
    expect(heard).toBe(2);
    leave();
    observeServerNow(10_050, 10_000);
    expect(heard).toBe(2);
  });
});
