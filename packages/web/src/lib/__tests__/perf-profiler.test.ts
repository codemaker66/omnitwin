import { describe, expect, it } from "vitest";
import { classifyBottleneck, RollingFrameProfiler, type RenderedFrameSample } from "../perf-profiler.js";

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

  it("splits GPU draw and compute, counting a draw without compute as zero compute", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.recordGpu(100, 3, 1);
    profiler.recordGpu(1100, 5);
    const metrics = profiler.snapshot(1200);
    expect(metrics.gpuRenderMs).toBe(4);
    expect(metrics.gpuComputeMs).toBe(0.5);
    expect(metrics.gpuTimeMs).toBe(4.5);
    profiler.recordGpu(1300, 2, Number.NaN);
    expect(profiler.snapshot(1400).gpuSampleCount).toBe(2);
  });

  it("reports the latest drawn-splat sample in the window and ages it out", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    profiler.record(frame(10, { splats: 6_000_000 }));
    expect(profiler.snapshot(20).drawnSplats).toBeNull();
    profiler.recordDrawnSplats(100, 2_000_000);
    profiler.recordDrawnSplats(1100, 1_800_000);
    expect(profiler.snapshot(1200).drawnSplats).toBe(1_800_000);
    expect(profiler.snapshot(1200).splats).toBe(6_000_000);
    expect(profiler.snapshot(21_101).drawnSplats).toBeNull();
  });

  it("counts long tasks in the window with their worst and total duration", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    expect(profiler.snapshot(10)).toMatchObject({ longTaskCount: 0, longTaskWorstMs: null, longTaskTotalMs: 0 });
    profiler.recordLongTask(500, 60);
    profiler.recordLongTask(900, 140);
    expect(profiler.snapshot(1000)).toMatchObject({ longTaskCount: 2, longTaskWorstMs: 140, longTaskTotalMs: 200 });
    expect(profiler.snapshot(20_600)).toMatchObject({ longTaskCount: 1, longTaskWorstMs: 140, longTaskTotalMs: 140 });
    profiler.reset(21_000);
    expect(profiler.snapshot(21_010).longTaskCount).toBe(0);
  });

  it("names the resource that sets the frame time", () => {
    expect(classifyBottleneck(10, 1, 8, false)).toEqual({ kind: "gpu", busyPct: 80 });
    expect(classifyBottleneck(10, 7, 2, false)).toEqual({ kind: "cpu", busyPct: 70 });
    expect(classifyBottleneck(16.7, 1, 4, false).kind).toBe("headroom");
    expect(classifyBottleneck(10, null, null, false).kind).toBe("unknown");
  });

  it("never claims headroom when one side was not measured", () => {
    // WebGL has no GPU timestamps: a light CPU says nothing about the GPU.
    expect(classifyBottleneck(10, 3, null, false)).toEqual({ kind: "unknown", busyPct: 30 });
    expect(classifyBottleneck(10, 7, null, false)).toEqual({ kind: "cpu", busyPct: 70 });
    expect(classifyBottleneck(10, null, 8, false)).toEqual({ kind: "gpu", busyPct: 80 });
    expect(classifyBottleneck(10, null, 3, false)).toEqual({ kind: "unknown", busyPct: 30 });
  });

  it("measures the busy share against the rendering cadence, not on-demand pauses", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    // Two bursts of 5 ms frames with a 1.5 s on-demand pause between them.
    for (let at = 5; at <= 500; at += 5) profiler.record(frame(at, { cpuSubmitMs: 1 }));
    for (let at = 2000; at <= 2500; at += 5) profiler.record(frame(at, { cpuSubmitMs: 1 }));
    profiler.recordGpu(2400, 4);
    const metrics = profiler.snapshot(2505);
    expect(metrics.frameTimeMs).toBeGreaterThan(10);
    expect(metrics.bottleneck).toEqual({ kind: "gpu", busyPct: 80 });
  });

  it("keeps the remaining bottleneck cases", () => {
    expect(classifyBottleneck(10, 5, 9, true).kind).toBe("idle");
    expect(classifyBottleneck(5, 1, 20, false).busyPct).toBe(100);
  });

  it("classifies the live window and passes the heap figure through", () => {
    const profiler = new RollingFrameProfiler();
    profiler.reset(0);
    for (let at = 10; at <= 1000; at += 10) profiler.record(frame(at, { cpuSubmitMs: 1 }));
    profiler.recordGpu(500, 8, 1);
    const metrics = profiler.snapshot(1005, "high", 512);
    expect(metrics.bottleneck).toEqual({ kind: "gpu", busyPct: 90 });
    expect(metrics.jsHeapMb).toBe(512);
    expect(profiler.snapshot(1005).jsHeapMb).toBeNull();
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
