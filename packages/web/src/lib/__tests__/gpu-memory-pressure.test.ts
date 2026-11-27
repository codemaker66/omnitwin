import { describe, expect, it } from "vitest";
import { GPU_MEMORY_PRESSURE_INTERVAL_MS, isGpuOutOfMemory, onGpuMemoryPressure, reportGpuMemoryPressure } from "../gpu-memory-pressure.js";

describe("GPU memory pressure", () => {
  it("knows a device out of memory from three's other uncaptured errors and the app's own failures", () => {
    expect(isGpuOutOfMemory({ api: "WebGPU", type: "GPUOutOfMemoryError", message: "Not enough memory left" })).toBe(true);
    expect(isGpuOutOfMemory({ api: "WebGPU", type: "GPUValidationError", message: "Invalid texture view" })).toBe(false);
    expect(isGpuOutOfMemory("Native splat sorting failed: resident worker crashed")).toBe(false);
    expect(isGpuOutOfMemory(null)).toBe(false);
  });

  it("tells a renderer's listeners at most once an interval, and only that renderer's", () => {
    const renderer = {};
    const other = {};
    const told: string[] = [];
    const stopGovernor = onGpuMemoryPressure(renderer, () => { told.push("governor"); });
    onGpuMemoryPressure(renderer, () => { told.push("detail"); });
    onGpuMemoryPressure(other, () => { told.push("other"); });

    expect(reportGpuMemoryPressure(renderer, 1_000)).toBe(true);
    // An error on every frame: the next ones within the interval tell nobody.
    expect(reportGpuMemoryPressure(renderer, 1_000 + GPU_MEMORY_PRESSURE_INTERVAL_MS - 1)).toBe(false);
    expect(told).toEqual(["governor", "detail"]);

    stopGovernor();
    expect(reportGpuMemoryPressure(renderer, 1_000 + GPU_MEMORY_PRESSURE_INTERVAL_MS)).toBe(true);
    expect(told).toEqual(["governor", "detail", "detail"]);
  });

  it("tells nobody of a renderer nothing listens to", () => {
    expect(reportGpuMemoryPressure({}, 0)).toBe(false);
  });
});
