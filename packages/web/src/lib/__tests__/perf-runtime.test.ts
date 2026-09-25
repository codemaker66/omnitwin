import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_PERF_METRICS, usePerfStore } from "../../stores/perf-store.js";
import {
  beginGpuProfile, endGpuProfile, profilerClipboardReport, recordRenderedFrame,
  refreshProfiler, registerProfilerRenderer, setProfilerForeground, shouldProfileFrames,
} from "../perf-runtime.js";

const sample = (timestampMs: number) => ({ timestampMs, cpuSubmitMs: 2, drawCalls: 3, triangles: 30 });
const flush = async (): Promise<void> => { for (let step = 0; step < 6; step += 1) await Promise.resolve(); };
const releases: (() => void)[] = [];
function renderer(gate: Promise<void> = Promise.resolve()) {
  const pools = {
    render: { queryOffsets: new Map<string, number>(), timestamps: new Map<string, number>() },
    compute: { queryOffsets: new Map<string, number>(), timestamps: new Map<string, number>() },
  };
  const native = { backend: {
    isWebGPUBackend: true, trackTimestamp: false, hasTimestamp: true, timestampQueryPool: pools,
    device: { features: new Set(["timestamp-query"]) },
    resolveTimestampsAsync: vi.fn(async (type: "render" | "compute") => {
      const ids = [...pools[type].queryOffsets.keys()];
      pools[type].queryOffsets.clear();
      await gate;
      ids.forEach((id) => { pools[type].timestamps.set(id, type === "render" ? 4 : 3); });
      return 999; // Last-frame aggregate must never replace the individual UID sum.
    }),
  } };
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  releases.push(registerProfilerRenderer(native, canvas, "webgpu"));
  return native;
}

beforeEach(() => {
  usePerfStore.setState({ visible: true, paused: false, metrics: INITIAL_PERF_METRICS, generation: usePerfStore.getState().generation + 1 });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  setProfilerForeground(true);
  refreshProfiler(0);
});
afterEach(() => {
  releases.splice(0).forEach((release) => { release(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("profiler runtime", () => {
  it("records actual draw calls only, freezes Pause, and starts Play without a paused interval", () => {
    recordRenderedFrame(sample(10));
    recordRenderedFrame(sample(30));
    refreshProfiler(40);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(2);
    usePerfStore.getState().togglePaused();
    const frozen = usePerfStore.getState().metrics;
    recordRenderedFrame(sample(5000));
    refreshProfiler(6000);
    expect(usePerfStore.getState().metrics).toBe(frozen);
    usePerfStore.getState().togglePaused();
    recordRenderedFrame(sample(10_000));
    refreshProfiler(10_010);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1);
    expect(usePerfStore.getState().metrics.intervalCount).toBe(0);
  });

  it("does not sample when closed or in a hidden tab, resets on foreground return", () => {
    recordRenderedFrame(sample(10));
    setProfilerForeground(false);
    expect(shouldProfileFrames()).toBe(false);
    recordRenderedFrame(sample(20));
    setProfilerForeground(true);
    recordRenderedFrame(sample(1000));
    refreshProfiler(1010);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1);
    usePerfStore.getState().toggle();
    expect(shouldProfileFrames()).toBe(false);
  });

  it("samples one hardware draw per second and sums every render/compute UID", async () => {
    const native = renderer();
    const token = beginGpuProfile(native, 10);
    expect(token).not.toBeNull();
    expect(native.backend.trackTimestamp).toBe(true);
    native.backend.timestampQueryPool.render.queryOffsets.set("r:1:f2", 0);
    native.backend.timestampQueryPool.compute.queryOffsets.set("c:1:f0", 0);
    native.backend.timestampQueryPool.compute.queryOffsets.set("c:2:f1", 2);
    endGpuProfile(token);
    expect(native.backend.trackTimestamp).toBe(false);
    await flush();
    refreshProfiler(30);
    expect(usePerfStore.getState().metrics.gpuTimeMs).toBe(10);
    expect(beginGpuProfile(native, 500)).toBeNull();
    endGpuProfile(beginGpuProfile(native, 1010));
    await flush();
  });

  it("ignores late hardware completion after reset", async () => {
    let complete: (() => void) | undefined;
    const native = renderer(new Promise<void>((resolve) => { complete = resolve; }));
    const token = beginGpuProfile(native, 10);
    native.backend.timestampQueryPool.render.queryOffsets.set("r:1:f1", 0);
    endGpuProfile(token);
    expect(beginGpuProfile(native, 2010)).toBeNull();
    usePerfStore.getState().reset();
    complete?.();
    await flush();
    refreshProfiler(3000);
    expect(usePerfStore.getState().metrics.gpuTimeMs).toBeNull();
  });

  it("never reports the old duration when query resolution fails or a draw failed", async () => {
    const native = renderer();
    native.backend.resolveTimestampsAsync.mockImplementation(() => Promise.resolve(123));
    native.backend.timestampQueryPool.render.timestamps.set("r:1:f1", 999);
    const token = beginGpuProfile(native, 10);
    native.backend.timestampQueryPool.render.queryOffsets.set("r:1:f1", 0);
    endGpuProfile(token);
    await flush();
    refreshProfiler(30);
    expect(usePerfStore.getState().metrics.gpuTimeMs).toBeNull();
    endGpuProfile(beginGpuProfile(native, 1010), false);
    await flush();
    expect(native.backend.trackTimestamp).toBe(false);
  });

  it("treats unsupported/malformed timestamp backends as unavailable", () => {
    expect(beginGpuProfile({}, 10)).toBeNull();
    const native = renderer();
    native.backend.hasTimestamp = false;
    expect(beginGpuProfile(native, 10)).toBeNull();
    expect(native.backend.trackTimestamp).toBe(false);
    expect(native.backend.resolveTimestampsAsync).not.toHaveBeenCalled();
    native.backend.hasTimestamp = true;
    native.backend.isWebGPUBackend = false;
    expect(beginGpuProfile(native, 10)).toBeNull();
  });

  it.each([
    ["missing optional feature", new Set<string>()],
    ["missing feature collection", undefined],
    ["malformed feature collection", {}],
    ["non-callable feature lookup", { has: true }],
    ["non-boolean feature result", { has: () => "yes" }],
  ])("does not enable GPU tracking with an active backend but %s", (_label, features) => {
    const native = renderer();
    Object.defineProperty(native.backend.device, "features", { value: features });
    expect(beginGpuProfile(native, 10)).toBeNull();
    expect(native.backend.trackTimestamp).toBe(false);
    expect(native.backend.resolveTimestampsAsync).not.toHaveBeenCalled();
  });

  it("does not enable GPU tracking when the rendering device is missing", () => {
    const native = renderer();
    Reflect.deleteProperty(native.backend, "device");
    expect(beginGpuProfile(native, 10)).toBeNull();
    expect(native.backend.trackTimestamp).toBe(false);
    expect(native.backend.resolveTimestampsAsync).not.toHaveBeenCalled();
  });

  it("contains a failing device-feature lookup without enabling tracking", () => {
    const native = renderer();
    Object.defineProperty(native.backend.device, "features", { value: {
      has: () => { throw new Error("Device capability unavailable"); },
    } });
    expect(beginGpuProfile(native, 10)).toBeNull();
    expect(native.backend.trackTimestamp).toBe(false);
    expect(native.backend.resolveTimestampsAsync).not.toHaveBeenCalled();
  });

  it("accepts the enabled-device set-like feature API without requiring a native Set", async () => {
    const native = renderer();
    Object.defineProperty(native.backend.device, "features", { value: {
      has: (feature: string) => feature === "timestamp-query",
    } });
    const token = beginGpuProfile(native, 10);
    expect(token).not.toBeNull();
    expect(native.backend.trackTimestamp).toBe(true);
    endGpuProfile(token, false);
    await flush();
    expect(native.backend.trackTimestamp).toBe(false);
  });

  it("copies a versioned report with explicit units and limitations", () => {
    const report = JSON.parse(profilerClipboardReport()) as { schema: string; definitions: { rendererMb: string; gpuTimeMs: string }; window: { requestedSeconds: number } };
    expect(report.schema).toBe("venviewer.profiler.v1");
    expect(report.window.requestedSeconds).toBe(20);
    expect(report.definitions.rendererMb).toContain("not total physical VRAM");
    expect(report.definitions.gpuTimeMs).toContain("timestamp");
  });
});
