import { afterEach, describe, expect, it } from "vitest";
import { gpuReading, isWeakDesktopGpu, probeGpu, readGpu, resetGpuProbeForTests, type GpuAdapterFacts } from "../gpu-class.js";

const adapter = (facts: Partial<GpuAdapterFacts>): Parameters<typeof isWeakDesktopGpu>[0] => ({
  api: "webgpu",
  adapter: { vendor: "", architecture: "", description: "", fallback: false, ...facts },
});

describe("isWeakDesktopGpu", () => {
  it("counts Intel's integrated graphics weak and its Arc cards not", () => {
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "gen-9" }))).toBe(true);
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "gen-12lp" }))).toBe(true);
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "xe-lpg" }))).toBe(true);
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "xe-hpg" }))).toBe(false);
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "gen-12hp" }))).toBe(false);
    expect(isWeakDesktopGpu(adapter({ vendor: "intel", architecture: "", description: "Intel(R) Arc(TM) A770 Graphics" }))).toBe(false);
  });

  it("goes by the adapter's description where the browser gives one", () => {
    expect(isWeakDesktopGpu(adapter({ vendor: "", description: "Intel(R) UHD Graphics 620" }))).toBe(true);
    expect(isWeakDesktopGpu(adapter({ vendor: "amd", architecture: "rdna-2", description: "AMD Radeon(TM) Graphics" }))).toBe(true);
    expect(isWeakDesktopGpu(adapter({ vendor: "amd", architecture: "rdna-2", description: "" }))).toBe(false);
    expect(isWeakDesktopGpu(adapter({ vendor: "amd", architecture: "rdna-3", description: "AMD Radeon RX 7900 XTX" }))).toBe(false);
  });

  it("leaves discrete and Apple graphics on the desktop profile", () => {
    expect(isWeakDesktopGpu(adapter({ vendor: "nvidia", architecture: "lovelace" }))).toBe(false);
    expect(isWeakDesktopGpu(adapter({ vendor: "apple", architecture: "metal-3" }))).toBe(false);
  });

  it("counts a software adapter and WebGL2 weak, and an unanswered probe not", () => {
    expect(isWeakDesktopGpu(adapter({ vendor: "google", architecture: "swiftshader", fallback: true }))).toBe(true);
    expect(isWeakDesktopGpu({ api: "webgl2" })).toBe(true);
    expect(isWeakDesktopGpu({ api: "unknown" })).toBe(false);
  });
});

describe("readGpu", () => {
  it("asks for the adapter that draws (high performance) and reads its facts", async () => {
    const asked: unknown[] = [];
    const gpu = { requestAdapter: (options: unknown) => {
      asked.push(options);
      return Promise.resolve({ info: { vendor: "intel", architecture: "gen-12lp", description: "", isFallbackAdapter: false } });
    } };
    await expect(readGpu(gpu, true)).resolves.toEqual({ api: "webgpu", adapter: { vendor: "intel", architecture: "gen-12lp", description: "", fallback: false } });
    expect(asked).toEqual([{ powerPreference: "high-performance" }]);
  });

  it("reads a fallback adapter from its info or, in older browsers, the adapter itself", async () => {
    const older = { requestAdapter: () => Promise.resolve({ isFallbackAdapter: true }) };
    await expect(readGpu(older, true)).resolves.toMatchObject({ api: "webgpu", adapter: { fallback: true } });
  });

  it("reads WebGL2 when there is no WebGPU or no adapter, and unknown without either", async () => {
    await expect(readGpu(undefined, true)).resolves.toEqual({ api: "webgl2" });
    await expect(readGpu(undefined, false)).resolves.toEqual({ api: "unknown" });
    const none = { requestAdapter: () => Promise.resolve(null) };
    await expect(readGpu(none, true)).resolves.toEqual({ api: "webgl2" });
    await expect(readGpu(none, false)).resolves.toEqual({ api: "unknown" });
  });

  it("gives up as unknown on an adapter that fails or does not answer in time", async () => {
    const failing = { requestAdapter: () => Promise.reject(new Error("no")) };
    await expect(readGpu(failing, true)).resolves.toEqual({ api: "unknown" });
    const silent = { requestAdapter: () => new Promise<null>(() => undefined) };
    await expect(readGpu(silent, true, 5)).resolves.toEqual({ api: "unknown" });
  });
});

describe("probeGpu", () => {
  afterEach(() => {
    resetGpuProbeForTests();
    Reflect.deleteProperty(navigator, "gpu");
  });

  it("asks once per page and answers unknown until the adapter has", async () => {
    let asked = 0;
    Object.defineProperty(navigator, "gpu", { configurable: true, value: { requestAdapter: () => {
      asked += 1;
      return Promise.resolve({ info: { vendor: "nvidia", architecture: "lovelace" } });
    } } });
    const first = probeGpu();
    expect(probeGpu()).toBe(first);
    expect(gpuReading()).toEqual({ api: "unknown" });
    await first;
    expect(gpuReading()).toMatchObject({ api: "webgpu", adapter: { vendor: "nvidia" } });
    expect(asked).toBe(1);
  });
});
