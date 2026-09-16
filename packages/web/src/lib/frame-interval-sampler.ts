// ---------------------------------------------------------------------------
// Frame intervals, kept whole.
//
// The planner's dev HUD already samples frame time (lib/perf.ts), but it keeps
// a 60-frame rolling MEAN and clamps outliers before they reach it. That is
// right for a live readout — one 400 ms stall should not make the number on
// screen leap about — and exactly wrong for a device matrix, where the stalls
// ARE the measurement. A mean of 16.7 ms says nothing about a phone that
// hitches every time somebody drags a chair.
//
// So this keeps every interval and reports the distribution: the median for
// what the room usually feels like, p95 and p99 for what it feels like at its
// worst, and counts of frames over 33/50/100 ms, because those are the ones a
// person actually notices.
//
// Nothing here reads a clock of its own. The caller supplies each timestamp,
// which keeps the module pure and testable without a browser.
// ---------------------------------------------------------------------------

/** A run of frames, as measured. No clamping, no smoothing, no decay. */
export interface FrameIntervalSample {
  readonly intervalsMs: readonly number[];
}

export interface FrameIntervalSummary {
  /** Frame intervals recorded. One fewer than frames drawn. */
  readonly samples: number;
  /** Wall-clock span the intervals cover. */
  readonly durationMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly worstMs: number;
  readonly meanMs: number;
  /**
   * Frames per second implied by the MEDIAN interval, not by the mean.
   *
   * A mean is dragged upward by a handful of long frames, so it understates a
   * scene that is usually smooth; the median says what a typical frame cost.
   * Neither is a refresh-rate claim: under `frameloop="demand"` the planner
   * deliberately draws nothing while nothing changes, so this number only
   * means anything across a window in which something was continuously moving.
   */
  readonly fpsFromMedian: number;
  readonly longFrames: {
    readonly over33ms: number;
    readonly over50ms: number;
    readonly over100ms: number;
  };
}

/** Nearest-rank percentile over an ascending array. */
function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1),
  );
  return sortedAscending[index] ?? 0;
}

function median(sortedAscending: readonly number[]): number {
  const count = sortedAscending.length;
  if (count === 0) return 0;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return sortedAscending[middle] ?? 0;
  return ((sortedAscending[middle - 1] ?? 0) + (sortedAscending[middle] ?? 0)) / 2;
}

/**
 * Reduce a run of intervals to the numbers worth writing down.
 *
 * Returns zeros for an empty run rather than throwing or inventing a rate: a
 * window in which the demand loop drew nothing is a real and reportable
 * outcome, and "no frames" must never be rendered as a frame rate.
 */
export function summariseFrameIntervals(sample: FrameIntervalSample): FrameIntervalSummary {
  const intervals = sample.intervalsMs.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, value) => sum + value, 0);
  const middle = median(sorted);
  return {
    samples: intervals.length,
    durationMs: total,
    medianMs: middle,
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    worstMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1] ?? 0,
    meanMs: intervals.length === 0 ? 0 : total / intervals.length,
    fpsFromMedian: middle > 0 ? 1000 / middle : 0,
    longFrames: {
      over33ms: intervals.filter((value) => value > 33).length,
      over50ms: intervals.filter((value) => value > 50).length,
      over100ms: intervals.filter((value) => value > 100).length,
    },
  };
}

/**
 * Is the frame-interval sampler switched on for this page load?
 *
 * Opt-in per visit via `?perf=1`, never by build flag: the point is to measure
 * the SAME bundle the user gets, on a borrowed phone, rather than a special
 * build that might not perform like the real one.
 */
export function frameSamplerRequested(search: string): boolean {
  const value = new URLSearchParams(search).get("perf");
  return value === "1" || value === "true";
}

/** Collects intervals until stopped. Bounded, so a tab left open cannot grow without limit. */
export class FrameIntervalRecorder {
  private readonly intervals: number[] = [];
  private lastFrameAtMs: number | null = null;

  constructor(private readonly maxSamples = 20_000) {}

  /**
   * Record one drawn frame. The FIRST call only establishes the origin: there
   * is no interval before the first frame, and deriving one from page load
   * would report the whole cold start as a single catastrophic frame.
   */
  frame(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const previous = this.lastFrameAtMs;
    this.lastFrameAtMs = nowMs;
    if (previous === null || nowMs < previous) return;
    if (this.intervals.length >= this.maxSamples) return;
    this.intervals.push(nowMs - previous);
  }

  /** Begin a fresh run, discarding what came before. */
  reset(): void {
    this.intervals.length = 0;
    this.lastFrameAtMs = null;
  }

  summary(): FrameIntervalSummary {
    return summariseFrameIntervals({ intervalsMs: this.intervals });
  }

  raw(): readonly number[] {
    return [...this.intervals];
  }
}
