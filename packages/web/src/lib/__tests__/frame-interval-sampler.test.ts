import { describe, expect, it } from "vitest";
import {
  FrameIntervalRecorder,
  frameSamplerRequested,
  summariseFrameIntervals,
} from "../frame-interval-sampler.js";

describe("frame interval sampler", () => {
  it("reports the distribution, not a smoothed average", () => {
    // Nineteen good frames and one 200 ms stall. A rolling mean would call
    // this 25 ms and shrug; the point of the device matrix is to SEE the
    // stall, so the median stays honest and the worst frame survives.
    const intervalsMs = [...Array.from({ length: 19 }, () => 16), 200];
    const summary = summariseFrameIntervals({ intervalsMs });
    expect(summary.samples).toBe(20);
    expect(summary.medianMs).toBe(16);
    expect(summary.worstMs).toBe(200);
    expect(summary.meanMs).toBeCloseTo(25.2, 1);
    expect(summary.durationMs).toBe(504);
    expect(summary.longFrames).toEqual({ over33ms: 1, over50ms: 1, over100ms: 1 });
  });

  it("derives fps from the median, so one stall cannot understate a smooth scene", () => {
    const steady = summariseFrameIntervals({ intervalsMs: Array.from({ length: 30 }, () => 16.67) });
    expect(steady.fpsFromMedian).toBeCloseTo(60, 0);
    const withStall = summariseFrameIntervals({
      intervalsMs: [...Array.from({ length: 29 }, () => 16.67), 500],
    });
    expect(withStall.fpsFromMedian).toBeCloseTo(60, 0);
    expect(withStall.worstMs).toBe(500);
  });

  it("takes percentiles at the nearest rank", () => {
    const intervalsMs = Array.from({ length: 100 }, (_, index) => index + 1);
    const summary = summariseFrameIntervals({ intervalsMs });
    expect(summary.medianMs).toBe(50.5);
    expect(summary.p95Ms).toBe(95);
    expect(summary.p99Ms).toBe(99);
    expect(summary.worstMs).toBe(100);
  });

  it("reports zeros for a window in which nothing was drawn, never a frame rate", () => {
    // Under frameloop="demand" an idle window legitimately draws nothing.
    // That is a real result; inventing a rate from it would be a lie.
    const summary = summariseFrameIntervals({ intervalsMs: [] });
    expect(summary.samples).toBe(0);
    expect(summary.fpsFromMedian).toBe(0);
    expect(summary.medianMs).toBe(0);
    expect(summary.worstMs).toBe(0);
    expect(summary.longFrames).toEqual({ over33ms: 0, over50ms: 0, over100ms: 0 });
  });

  it("discards values that are not finite, non-negative durations", () => {
    const summary = summariseFrameIntervals({
      intervalsMs: [16, Number.NaN, -5, Number.POSITIVE_INFINITY, 16],
    });
    expect(summary.samples).toBe(2);
    expect(summary.medianMs).toBe(16);
  });

  describe("the ?perf=1 switch", () => {
    it.each(["?perf=1", "?perf=true", "?foo=bar&perf=1"])("is on for %s", (search) => {
      expect(frameSamplerRequested(search)).toBe(true);
    });
    it.each(["", "?perf=0", "?perf", "?perf=yes", "?performance=1"])("is off for %s", (search) => {
      expect(frameSamplerRequested(search)).toBe(false);
    });
  });

  describe("the recorder", () => {
    it("treats the first frame as an origin, not a frame that took all of startup", () => {
      const recorder = new FrameIntervalRecorder();
      recorder.frame(1_000);
      expect(recorder.summary().samples).toBe(0);
      recorder.frame(1_016);
      recorder.frame(1_032);
      expect(recorder.raw()).toEqual([16, 16]);
    });

    it("ignores a backwards or non-finite clock instead of recording a negative frame", () => {
      const recorder = new FrameIntervalRecorder();
      recorder.frame(1_000);
      recorder.frame(900);
      recorder.frame(916);
      expect(recorder.raw()).toEqual([16]);
      recorder.frame(Number.NaN);
      recorder.frame(932);
      expect(recorder.raw()).toEqual([16, 16]);
    });

    it("stops growing at its cap, so a tab left open overnight cannot exhaust memory", () => {
      const recorder = new FrameIntervalRecorder(3);
      for (let index = 0; index <= 10; index += 1) recorder.frame(index * 16);
      expect(recorder.raw()).toHaveLength(3);
    });

    it("starts a clean run on reset", () => {
      const recorder = new FrameIntervalRecorder();
      recorder.frame(0);
      recorder.frame(16);
      recorder.reset();
      expect(recorder.summary().samples).toBe(0);
      // The origin goes too: the first frame after a reset opens a new run
      // rather than measuring across the gap.
      recorder.frame(5_000);
      expect(recorder.summary().samples).toBe(0);
      recorder.frame(5_016);
      expect(recorder.raw()).toEqual([16]);
    });
  });
});
