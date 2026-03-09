import { describe, it, expect, beforeEach } from "vitest";
import {
  getPerfBudget,
  frameTimeToFps,
  ratePerformance,
  clampFrameTime,
  addSample,
  computeAverage,
  formatFps,
  formatFrameTime,
  formatTriangles,
  formatDrawCalls,
  PERF_SAMPLE_COUNT,
  UPDATE_INTERVAL,
  RATING_COLORS,
  TOGGLE_KEY,
  type PerfBudget,
  type PerfRating,
} from "../perf.js";
import type { DeviceTier } from "../device-tier.js";
import { usePerfStore } from "../../stores/perf-store.js";

// ---------------------------------------------------------------------------
// getPerfBudget
// ---------------------------------------------------------------------------

describe("getPerfBudget", () => {
  const tiers: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

  for (const tier of tiers) {
    it(`returns valid budget for ${tier} tier`, () => {
      const budget = getPerfBudget(tier);
      expect(budget.targetFrameTimeMs).toBeGreaterThan(0);
      expect(budget.warningThresholdMs).toBeGreaterThan(0);
      expect(budget.criticalThresholdMs).toBeGreaterThan(0);
      expect(budget.maxDrawCalls).toBeGreaterThanOrEqual(0);
      expect(budget.maxTriangles).toBeGreaterThanOrEqual(0);
    });
  }

  it("thresholds are ordered: target < warning < critical", () => {
    for (const tier of tiers) {
      const budget = getPerfBudget(tier);
      expect(budget.targetFrameTimeMs).toBeLessThan(budget.warningThresholdMs);
      expect(budget.warningThresholdMs).toBeLessThan(budget.criticalThresholdMs);
    }
  });

  it("maxDrawCalls increases with tier", () => {
    const poster = getPerfBudget("poster").maxDrawCalls;
    const low = getPerfBudget("low").maxDrawCalls;
    const medium = getPerfBudget("medium").maxDrawCalls;
    const high = getPerfBudget("high").maxDrawCalls;
    expect(poster).toBeLessThan(low);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("maxTriangles matches quality settings progression", () => {
    const poster = getPerfBudget("poster").maxTriangles;
    const low = getPerfBudget("low").maxTriangles;
    const medium = getPerfBudget("medium").maxTriangles;
    const high = getPerfBudget("high").maxTriangles;
    expect(poster).toBeLessThan(low);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("poster and low target 30fps (33.33ms)", () => {
    expect(getPerfBudget("poster").targetFrameTimeMs).toBeCloseTo(33.33, 0);
    expect(getPerfBudget("low").targetFrameTimeMs).toBeCloseTo(33.33, 0);
  });

  it("medium and high target 60fps (16.67ms)", () => {
    expect(getPerfBudget("medium").targetFrameTimeMs).toBeCloseTo(16.67, 0);
    expect(getPerfBudget("high").targetFrameTimeMs).toBeCloseTo(16.67, 0);
  });
});

// ---------------------------------------------------------------------------
// frameTimeToFps
// ---------------------------------------------------------------------------

describe("frameTimeToFps", () => {
  it("converts 16.67ms to ~60fps", () => {
    expect(frameTimeToFps(16.67)).toBeCloseTo(60, 0);
  });

  it("converts 33.33ms to ~30fps", () => {
    expect(frameTimeToFps(33.33)).toBeCloseTo(30, 0);
  });

  it("returns 0 for zero frame time", () => {
    expect(frameTimeToFps(0)).toBe(0);
  });

  it("returns 0 for negative frame time", () => {
    expect(frameTimeToFps(-10)).toBe(0);
  });

  it("converts 8.33ms to ~120fps", () => {
    expect(frameTimeToFps(8.33)).toBeCloseTo(120, 0);
  });
});

// ---------------------------------------------------------------------------
// ratePerformance
// ---------------------------------------------------------------------------

describe("ratePerformance", () => {
  const budget: PerfBudget = {
    targetFrameTimeMs: 16.67,
    warningThresholdMs: 33.33,
    criticalThresholdMs: 66.67,
    maxDrawCalls: 100,
    maxTriangles: 80_000,
  };

  it("returns 'good' when frame time is within warning threshold", () => {
    expect(ratePerformance(16.67, budget)).toBe("good");
  });

  it("returns 'good' at exactly the warning threshold", () => {
    expect(ratePerformance(33.33, budget)).toBe("good");
  });

  it("returns 'warning' just above warning threshold", () => {
    expect(ratePerformance(33.34, budget)).toBe("warning");
  });

  it("returns 'warning' at exactly the critical threshold", () => {
    expect(ratePerformance(66.67, budget)).toBe("warning");
  });

  it("returns 'critical' above critical threshold", () => {
    expect(ratePerformance(66.68, budget)).toBe("critical");
  });

  it("returns 'good' for zero frame time", () => {
    expect(ratePerformance(0, budget)).toBe("good");
  });
});

// ---------------------------------------------------------------------------
// clampFrameTime
// ---------------------------------------------------------------------------

describe("clampFrameTime", () => {
  it("passes through normal values", () => {
    expect(clampFrameTime(16.67)).toBe(16.67);
  });

  it("clamps negative to 0", () => {
    expect(clampFrameTime(-5)).toBe(0);
  });

  it("clamps values above 1000ms to 1000", () => {
    expect(clampFrameTime(5000)).toBe(1000);
  });

  it("passes through 0", () => {
    expect(clampFrameTime(0)).toBe(0);
  });

  it("passes through exactly 1000ms", () => {
    expect(clampFrameTime(1000)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// addSample
// ---------------------------------------------------------------------------

describe("addSample", () => {
  it("adds to empty array", () => {
    const result = addSample([], 16.67, 5);
    expect(result).toEqual([16.67]);
  });

  it("adds to non-full array", () => {
    const result = addSample([10, 20], 30, 5);
    expect(result).toEqual([10, 20, 30]);
  });

  it("drops oldest when at capacity", () => {
    const result = addSample([10, 20, 30], 40, 3);
    expect(result).toEqual([20, 30, 40]);
  });

  it("clamps negative values", () => {
    const result = addSample([], -10, 5);
    expect(result).toEqual([0]);
  });

  it("clamps values above 1000ms", () => {
    const result = addSample([], 5000, 5);
    expect(result).toEqual([1000]);
  });

  it("maintains immutability (returns new array)", () => {
    const original = [10, 20];
    const result = addSample(original, 30, 5);
    expect(result).not.toBe(original);
    expect(original).toEqual([10, 20]);
  });
});

// ---------------------------------------------------------------------------
// computeAverage
// ---------------------------------------------------------------------------

describe("computeAverage", () => {
  it("returns 0 for empty array", () => {
    expect(computeAverage([])).toBe(0);
  });

  it("returns the value for single-element array", () => {
    expect(computeAverage([42])).toBe(42);
  });

  it("computes correct average for multiple values", () => {
    expect(computeAverage([10, 20, 30])).toBeCloseTo(20);
  });

  it("handles identical values", () => {
    expect(computeAverage([16.67, 16.67, 16.67])).toBeCloseTo(16.67);
  });
});

// ---------------------------------------------------------------------------
// formatFps
// ---------------------------------------------------------------------------

describe("formatFps", () => {
  it("rounds to integer", () => {
    expect(formatFps(59.94)).toBe("60");
  });

  it("formats zero", () => {
    expect(formatFps(0)).toBe("0");
  });

  it("rounds down when below .5", () => {
    expect(formatFps(29.4)).toBe("29");
  });
});

// ---------------------------------------------------------------------------
// formatFrameTime
// ---------------------------------------------------------------------------

describe("formatFrameTime", () => {
  it("formats with one decimal place and ms suffix", () => {
    expect(formatFrameTime(16.67)).toBe("16.7ms");
  });

  it("formats zero", () => {
    expect(formatFrameTime(0)).toBe("0.0ms");
  });

  it("formats large values", () => {
    expect(formatFrameTime(100.5)).toBe("100.5ms");
  });
});

// ---------------------------------------------------------------------------
// formatTriangles
// ---------------------------------------------------------------------------

describe("formatTriangles", () => {
  it("shows plain number below 1000", () => {
    expect(formatTriangles(500)).toBe("500");
  });

  it("shows K suffix for thousands", () => {
    expect(formatTriangles(12_345)).toBe("12.3K");
  });

  it("shows M suffix for millions", () => {
    expect(formatTriangles(1_234_567)).toBe("1.2M");
  });

  it("formats zero", () => {
    expect(formatTriangles(0)).toBe("0");
  });

  it("shows K suffix at exactly 1000", () => {
    expect(formatTriangles(1000)).toBe("1.0K");
  });

  it("shows M suffix at exactly 1000000", () => {
    expect(formatTriangles(1_000_000)).toBe("1.0M");
  });
});

// ---------------------------------------------------------------------------
// formatDrawCalls
// ---------------------------------------------------------------------------

describe("formatDrawCalls", () => {
  it("formats as plain string", () => {
    expect(formatDrawCalls(42)).toBe("42");
  });

  it("formats zero", () => {
    expect(formatDrawCalls(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("PERF_SAMPLE_COUNT", () => {
  it("is a positive integer", () => {
    expect(PERF_SAMPLE_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(PERF_SAMPLE_COUNT)).toBe(true);
  });
});

describe("UPDATE_INTERVAL", () => {
  it("is a positive integer", () => {
    expect(UPDATE_INTERVAL).toBeGreaterThan(0);
    expect(Number.isInteger(UPDATE_INTERVAL)).toBe(true);
  });

  it("is less than PERF_SAMPLE_COUNT", () => {
    expect(UPDATE_INTERVAL).toBeLessThan(PERF_SAMPLE_COUNT);
  });
});

describe("RATING_COLORS", () => {
  it("has valid hex colours for all ratings", () => {
    const ratings: readonly PerfRating[] = ["good", "warning", "critical"];
    for (const rating of ratings) {
      expect(RATING_COLORS[rating]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("all colours are distinct", () => {
    const colors = new Set(Object.values(RATING_COLORS));
    expect(colors.size).toBe(3);
  });
});

describe("TOGGLE_KEY", () => {
  it("is a non-empty string", () => {
    expect(TOGGLE_KEY.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// usePerfStore (Zustand store)
// ---------------------------------------------------------------------------

describe("usePerfStore", () => {
  beforeEach(() => {
    usePerfStore.setState({
      metrics: { fps: 0, frameTimeMs: 0, drawCalls: 0, triangles: 0, rating: "good" },
      visible: false,
    });
  });

  it("defaults to invisible", () => {
    expect(usePerfStore.getState().visible).toBe(false);
  });

  it("defaults to zero metrics with good rating", () => {
    const { metrics } = usePerfStore.getState();
    expect(metrics.fps).toBe(0);
    expect(metrics.frameTimeMs).toBe(0);
    expect(metrics.drawCalls).toBe(0);
    expect(metrics.triangles).toBe(0);
    expect(metrics.rating).toBe("good");
  });

  it("update() sets metrics", () => {
    usePerfStore.getState().update({
      fps: 60,
      frameTimeMs: 16.67,
      drawCalls: 42,
      triangles: 12_345,
      rating: "good",
    });
    const { metrics } = usePerfStore.getState();
    expect(metrics.fps).toBe(60);
    expect(metrics.drawCalls).toBe(42);
    expect(metrics.triangles).toBe(12_345);
  });

  it("toggle() flips visible from false to true", () => {
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(true);
  });

  it("toggle() twice restores original visibility", () => {
    usePerfStore.getState().toggle();
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(false);
  });

  it("update() replaces previous metrics completely", () => {
    usePerfStore.getState().update({
      fps: 60,
      frameTimeMs: 16.67,
      drawCalls: 42,
      triangles: 80_000,
      rating: "good",
    });
    usePerfStore.getState().update({
      fps: 15,
      frameTimeMs: 66.67,
      drawCalls: 300,
      triangles: 500_000,
      rating: "critical",
    });
    const { metrics } = usePerfStore.getState();
    expect(metrics.fps).toBe(15);
    expect(metrics.rating).toBe("critical");
    expect(metrics.triangles).toBe(500_000);
  });
});
