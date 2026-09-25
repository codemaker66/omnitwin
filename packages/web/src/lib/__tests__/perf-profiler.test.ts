import { describe, expect, it } from "vitest";
import { RollingFrameProfiler, type RenderedFrameSample } from "../perf-profiler.js";

const frame = (timestampMs: number, extra: Partial<RenderedFrameSample> = {}): RenderedFrameSample => ({
  timestampMs, cpuSubmitMs: 2, drawCalls: 4, triangles: 100, ...extra,
});

describe("RollingFrameProfiler", () => {
  it("uses an elapsed twenty-second window, independent of frame rate", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    for (let at = 20; at <= 30_000; at += 20) profiler.record(frame(at));
    const metrics = profiler.snapshot(30_000);
    expect(metrics.windowSeconds).toBe(20);
    expect(metrics.sampleCount).toBe(1000);
    expect(metrics.fps).toBe(50);
    expect(metrics.frameTimeMs).toBe(20);
    expect(metrics.status).toBe("live");
  });

  it("ages all samples on idle refresh without needing another frame", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.record(frame(100));
    profiler.record(frame(200));
    expect(profiler.snapshot(1000).fps).toBe(2);
    expect(profiler.snapshot(2000).status).toBe("idle");
    const metrics = profiler.snapshot(20_201);
    expect(metrics.fps).toBe(0);
    expect(metrics.sampleCount).toBe(0);
    expect(metrics.frameP99Ms).toBeNull();
    expect(metrics.cpuSubmitMs).toBeNull();
  });

  it("retains long stalls and nearest-rank tail latency", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    for (let at = 0; at <= 980; at += 10) profiler.record(frame(at));
    profiler.record(frame(3980));
    const metrics = profiler.snapshot(4000);
    expect(metrics.frameP95Ms).toBe(10);
    expect(metrics.frameP99Ms).toBe(3000);
    expect(metrics.frameTimeMs).toBeCloseTo(3980 / 99);
  });

  it("keeps complete intervals ending inside the window even if they start before its boundary", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.record(frame(1));
    profiler.record(frame(25_001));
    const metrics = profiler.snapshot(25_002);
    expect(metrics.sampleCount).toBe(1);
    expect(metrics.frameTimeMs).toBe(25_000);
  });

  it("resets continuity and missing values remain unavailable, never synthetic zero", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.record(frame(10));
    profiler.reset(1000);
    profiler.record(frame(1010));
    const metrics = profiler.snapshot(1020);
    expect(metrics.intervalCount).toBe(0);
    expect(metrics.frameP95Ms).toBeNull();
    expect(metrics.gpuTimeMs).toBeNull();
    expect(metrics.rendererMb).toBeNull();
    expect(metrics.sortTimeMs).toBeNull();
  });

  it("averages tracked renderer bytes in MiB and native telemetry over submitted frames", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.record(frame(10, { rendererBytes: 1_048_576, splats: 200, sortTimeMs: 4, sortAgeMs: 10, sortBacklog: 0 }));
    profiler.record(frame(30, { rendererBytes: 3_145_728, splats: 400, sortTimeMs: 6, sortAgeMs: 30, sortBacklog: 2 }));
    const metrics = profiler.snapshot(40);
    expect(metrics.rendererMb).toBe(2);
    expect(metrics.splats).toBe(300);
    expect(metrics.sortTimeMs).toBe(5);
    expect(metrics.sortAgeMs).toBe(20);
    expect(metrics.sortBacklog).toBe(1);
  });

  it("averages sparse hardware samples separately and ages them out", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.recordGpu(100, 4);
    profiler.recordGpu(200, 8);
    expect(profiler.snapshot(300).gpuTimeMs).toBe(6);
    expect(profiler.snapshot(300).gpuSampleCount).toBe(2);
    expect(profiler.snapshot(20_201).gpuTimeMs).toBeNull();
  });

  it("counts genuine draws sharing a coarse clock tick without discarding their FPS", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    // A 60-draw/s workload observed through a 100ms-resolution browser clock.
    for (let tick = 1; tick <= 200; tick += 1) {
      for (let draw = 0; draw < 6; draw += 1) profiler.record(frame(tick * 100));
    }
    const metrics = profiler.snapshot(20_000);
    expect(metrics.sampleCount).toBe(1200);
    expect(metrics.fps).toBe(60);
    expect(metrics.intervalCount).toBe(1199);
    expect(metrics.frameTimeMs).toBeCloseTo(19_900 / 1199);
    expect(metrics.frameP95Ms).toBe(100);
    expect(metrics.frameP99Ms).toBe(100);
    expect(metrics.capacityLimited).toBe(false);
  });

  it("rejects malformed/backwards samples and invalid metric values", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(100);
    for (const at of [NaN, Infinity, 99]) profiler.record(frame(at));
    profiler.record(frame(110, { cpuSubmitMs: NaN, splats: -1 }));
    profiler.record(frame(109));
    profiler.recordGpu(111, -1);
    const metrics = profiler.snapshot(120);
    expect(metrics.sampleCount).toBe(1);
    expect(metrics.cpuSubmitMs).toBeNull();
    expect(metrics.splats).toBeNull();
    expect(metrics.gpuTimeMs).toBeNull();
  });

  it("reports bounded-capacity overflow rather than claiming a complete window", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    for (let at = 1; at <= 17_000; at += 1) profiler.record(frame(at));
    expect(profiler.snapshot(17_000).capacityLimited).toBe(true);
    expect(profiler.snapshot(38_000).capacityLimited).toBe(false);
  });
});
