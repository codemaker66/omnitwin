import { getPerfBudget, ratePerformance, type PerfRating } from "./perf.js";
import type { DeviceTier } from "./device-tier.js";

export const PERF_WINDOW_MS = 20_000;
export const PERF_REFRESH_MS = 500;
const CAPACITY = 16_384;

export interface RenderedFrameSample {
  /** performance.now(), taken immediately before the successful main draw. */
  readonly timestampMs: number;
  /** Synchronous submission work, including native pre-render sorting/update. */
  readonly cpuSubmitMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  /** Three's tracked resource allocation; never presented as physical VRAM. */
  readonly rendererBytes?: number | null;
  readonly splats?: number | null;
  readonly sortTimeMs?: number | null;
  readonly sortAgeMs?: number | null;
  readonly sortBacklog?: number | null;
}

export interface PerfMetrics {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly frameP95Ms: number | null;
  readonly frameP99Ms: number | null;
  readonly cpuSubmitMs: number | null;
  readonly gpuTimeMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly splats: number | null;
  readonly rendererMb: number | null;
  readonly sortTimeMs: number | null;
  readonly sortAgeMs: number | null;
  readonly sortBacklog: number | null;
  readonly rating: PerfRating;
  readonly sampleCount: number;
  readonly intervalCount: number;
  readonly gpuSampleCount: number;
  readonly windowSeconds: number;
  readonly status: "warming" | "live" | "idle";
  readonly capacityLimited: boolean;
}

export const INITIAL_PERF_METRICS: PerfMetrics = {
  fps: 0, frameTimeMs: 0, frameP95Ms: null, frameP99Ms: null,
  cpuSubmitMs: null, gpuTimeMs: null, drawCalls: 0, triangles: 0,
  splats: null, rendererMb: null, sortTimeMs: null, sortAgeMs: null, sortBacklog: null,
  rating: "good", sampleCount: 0, intervalCount: 0, gpuSampleCount: 0,
  windowSeconds: 0, status: "warming", capacityLimited: false,
};

function measured(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : NaN;
}

/** Fixed storage: recording a frame never copies history or sorts an array.
 * Percentiles are nearest-rank over actual submitted-frame intervals. Long
 * stalls remain intact; browser pacing callbacks that did not draw never enter.
 */
export class RollingFrameProfiler {
  private readonly timestamps = new Float64Array(CAPACITY);
  private readonly columns = [
    new Float64Array(CAPACITY), new Float64Array(CAPACITY), new Float64Array(CAPACITY),
    new Float64Array(CAPACITY), new Float64Array(CAPACITY), new Float64Array(CAPACITY),
    new Float64Array(CAPACITY), new Float64Array(CAPACITY), new Float64Array(CAPACITY),
  ] as const;
  private readonly gpu: { timestampMs: number; value: number }[] = [];
  private head = 0;
  private count = 0;
  private startedAt = 0;
  private previousFrame: number | null = null;
  private overflowAt: number | null = null;

  reset(now: number): void {
    this.head = 0;
    this.count = 0;
    this.startedAt = now;
    this.previousFrame = null;
    this.overflowAt = null;
    this.gpu.length = 0;
  }

  record(sample: RenderedFrameSample): void {
    const now = sample.timestampMs;
    if (!Number.isFinite(now) || now < this.startedAt
      || (this.previousFrame !== null && now < this.previousFrame)) return;
    // Multiple genuine draws can share a coarsened performance.now() tick.
    // Count every draw; a zero interval means below clock resolution, not a
    // duplicate event. The native owner already excludes nested/pacing calls.
    this.evict(now);
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY;
      this.count -= 1;
      this.overflowAt = now;
    }
    const index = (this.head + this.count) % CAPACITY;
    this.timestamps[index] = now;
    this.columns[0][index] = this.previousFrame === null ? NaN : now - this.previousFrame;
    this.columns[1][index] = measured(sample.cpuSubmitMs);
    this.columns[2][index] = measured(sample.drawCalls);
    this.columns[3][index] = measured(sample.triangles);
    this.columns[4][index] = measured(sample.splats);
    this.columns[5][index] = measured(sample.sortTimeMs);
    this.columns[6][index] = measured(sample.sortAgeMs);
    this.columns[7][index] = measured(sample.sortBacklog);
    this.columns[8][index] = measured(sample.rendererBytes) / 1_048_576;
    this.count += 1;
    this.previousFrame = now;
  }

  recordGpu(timestampMs: number, value: number): void {
    if (Number.isFinite(timestampMs) && timestampMs >= this.startedAt && Number.isFinite(measured(value))) {
      this.gpu.push({ timestampMs, value });
    }
  }

  private evict(now: number): void {
    const cutoff = now - PERF_WINDOW_MS;
    while (this.count > 0 && (this.timestamps[this.head] ?? Infinity) <= cutoff) {
      this.head = (this.head + 1) % CAPACITY;
      this.count -= 1;
    }
    while ((this.gpu[0]?.timestampMs ?? Infinity) <= cutoff) this.gpu.shift();
  }

  snapshot(now: number, tier: DeviceTier = "medium"): PerfMetrics {
    this.evict(now);
    const sums = new Float64Array(9);
    const counts = new Uint32Array(9);
    const intervals: number[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      const index = (this.head + offset) % CAPACITY;
      for (let column = 0; column < this.columns.length; column += 1) {
        const value = this.columns[column]?.[index] ?? NaN;
        if (!Number.isFinite(value)) continue;
        sums[column] = (sums[column] ?? 0) + value;
        counts[column] = (counts[column] ?? 0) + 1;
        if (column === 0) intervals.push(value);
      }
    }
    intervals.sort((left, right) => left - right);
    const mean = (column: number): number | null => {
      const count = counts[column] ?? 0;
      return count > 0 ? (sums[column] ?? 0) / count : null;
    };
    const percentile = (fraction: number): number | null => intervals.length > 0
      ? intervals[Math.ceil(intervals.length * fraction) - 1] ?? null : null;
    const elapsed = Math.max(0, Math.min(PERF_WINDOW_MS, now - this.startedAt));
    const frameTimeMs = mean(0) ?? 0;
    const idle = this.previousFrame === null ? now - this.startedAt >= 1000 : now - this.previousFrame >= 1000;
    return {
      fps: elapsed > 0 ? this.count * 1000 / elapsed : 0,
      frameTimeMs, frameP95Ms: percentile(0.95), frameP99Ms: percentile(0.99),
      cpuSubmitMs: mean(1), gpuTimeMs: this.gpu.length > 0
        ? this.gpu.reduce((sum, sample) => sum + sample.value, 0) / this.gpu.length : null,
      drawCalls: mean(2) ?? 0, triangles: mean(3) ?? 0, splats: mean(4), rendererMb: mean(8),
      sortTimeMs: mean(5), sortAgeMs: mean(6), sortBacklog: mean(7),
      rating: ratePerformance(frameTimeMs, getPerfBudget(tier)), sampleCount: this.count,
      intervalCount: intervals.length, gpuSampleCount: this.gpu.length,
      windowSeconds: elapsed / 1000, status: idle ? "idle" : elapsed < PERF_WINDOW_MS ? "warming" : "live",
      capacityLimited: this.overflowAt !== null && now - this.overflowAt < PERF_WINDOW_MS,
    };
  }
}
