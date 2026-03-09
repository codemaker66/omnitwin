// ---------------------------------------------------------------------------
// Performance monitoring utilities — pure functions, fully testable
// ---------------------------------------------------------------------------

import type { DeviceTier } from "./device-tier.js";

// ---------------------------------------------------------------------------
// Performance rating
// ---------------------------------------------------------------------------

export type PerfRating = "good" | "warning" | "critical";

export const RATING_COLORS: Record<PerfRating, string> = {
  good: "#4caf50",
  warning: "#ff9800",
  critical: "#f44336",
};

// ---------------------------------------------------------------------------
// Performance budget per device tier
// ---------------------------------------------------------------------------

export interface PerfBudget {
  readonly targetFrameTimeMs: number;
  readonly warningThresholdMs: number;
  readonly criticalThresholdMs: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
}

const PERF_BUDGETS: Record<DeviceTier, PerfBudget> = {
  poster: {
    targetFrameTimeMs: 33.33,
    warningThresholdMs: 50,
    criticalThresholdMs: 100,
    maxDrawCalls: 10,
    maxTriangles: 0,
  },
  low: {
    targetFrameTimeMs: 33.33,
    warningThresholdMs: 50,
    criticalThresholdMs: 100,
    maxDrawCalls: 50,
    maxTriangles: 20_000,
  },
  medium: {
    targetFrameTimeMs: 16.67,
    warningThresholdMs: 33.33,
    criticalThresholdMs: 66.67,
    maxDrawCalls: 100,
    maxTriangles: 80_000,
  },
  high: {
    targetFrameTimeMs: 16.67,
    warningThresholdMs: 33.33,
    criticalThresholdMs: 66.67,
    maxDrawCalls: 200,
    maxTriangles: 250_000,
  },
};

/**
 * Returns performance budget thresholds for a given device tier.
 */
export function getPerfBudget(tier: DeviceTier): PerfBudget {
  return PERF_BUDGETS[tier];
}

// ---------------------------------------------------------------------------
// Frame time / FPS conversion
// ---------------------------------------------------------------------------

/**
 * Converts frame time in milliseconds to frames per second.
 * Returns 0 for non-positive frame times.
 */
export function frameTimeToFps(frameTimeMs: number): number {
  if (frameTimeMs <= 0) return 0;
  return 1000 / frameTimeMs;
}

// ---------------------------------------------------------------------------
// Performance rating
// ---------------------------------------------------------------------------

/**
 * Rates performance based on frame time against budget thresholds.
 * - "good": at or below warning threshold
 * - "warning": above warning but at or below critical threshold
 * - "critical": above critical threshold
 */
export function ratePerformance(frameTimeMs: number, budget: PerfBudget): PerfRating {
  if (frameTimeMs <= budget.warningThresholdMs) return "good";
  if (frameTimeMs <= budget.criticalThresholdMs) return "warning";
  return "critical";
}

// ---------------------------------------------------------------------------
// Rolling average sampling
// ---------------------------------------------------------------------------

/** Maximum frame time to accept (ms). Longer gaps are idle pauses, not useful for averaging. */
const MAX_FRAME_TIME_MS = 1000;

/** Number of samples in the rolling average window. */
export const PERF_SAMPLE_COUNT = 60;

/** How many frames between store updates (reduces overhead). */
export const UPDATE_INTERVAL = 10;

/**
 * Clamps a frame time to a valid range.
 * Negative values become 0; values above 1000ms are capped (idle gaps in demand mode).
 */
export function clampFrameTime(frameTimeMs: number): number {
  return Math.min(Math.max(0, frameTimeMs), MAX_FRAME_TIME_MS);
}

/**
 * Adds a sample to the rolling window, dropping the oldest if at capacity.
 * The sample is clamped to prevent idle-gap outliers from skewing the average.
 */
export function addSample(
  samples: readonly number[],
  newSample: number,
  maxSamples: number,
): readonly number[] {
  const clamped = clampFrameTime(newSample);
  if (samples.length >= maxSamples) {
    return [...samples.slice(1), clamped];
  }
  return [...samples, clamped];
}

/**
 * Computes the arithmetic mean of a sample array.
 * Returns 0 for an empty array.
 */
export function computeAverage(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) {
    sum += s;
  }
  return sum / samples.length;
}

// ---------------------------------------------------------------------------
// Metric formatting for display
// ---------------------------------------------------------------------------

/**
 * Formats FPS as a rounded integer string.
 */
export function formatFps(fps: number): string {
  return Math.round(fps).toString();
}

/**
 * Formats frame time in milliseconds with one decimal place.
 */
export function formatFrameTime(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

/**
 * Formats a triangle count with K/M suffixes for readability.
 */
export function formatTriangles(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Formats a draw call count as a plain string.
 */
export function formatDrawCalls(calls: number): string {
  return calls.toString();
}

/** Keyboard code for the overlay toggle key (backtick). */
export const TOGGLE_KEY = "Backquote";
