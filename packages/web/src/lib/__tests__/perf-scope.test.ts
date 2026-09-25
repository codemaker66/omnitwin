import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_PERF_METRICS, usePerfStore } from "../../stores/perf-store.js";
import { profilerClipboardReport, recordRenderedFrame, refreshProfiler, registerProfilerRenderer, shouldProfileFrames } from "../perf-runtime.js";

const releases: (() => void)[] = [];
function attach(width: number, height: number) {
  const renderer = {};
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, height));
  const release = registerProfilerRenderer(renderer, canvas, "webgpu");
  releases.push(release);
  return { renderer, canvas, release };
}
const sample = (timestampMs: number) => ({ timestampMs, cpuSubmitMs: 3, drawCalls: 5, triangles: 50 });

beforeEach(() => {
  usePerfStore.setState({ visible: true, paused: false, metrics: INITIAL_PERF_METRICS, generation: usePerfStore.getState().generation + 1 });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  releases.splice(0).forEach((release) => { release(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("profiler canvas ownership", () => {
  it("selects the largest visible canvas and excludes thumbnail frames", () => {
    const thumbnail = attach(100, 100);
    const main = attach(600, 400);
    expect(shouldProfileFrames(thumbnail.renderer)).toBe(false);
    expect(shouldProfileFrames(main.renderer)).toBe(true);
    recordRenderedFrame(sample(10), thumbnail.renderer);
    recordRenderedFrame(sample(20), main.renderer);
    refreshProfiler(30);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1);
  });

  it("starts a fresh window when the active renderer is disposed", () => {
    const thumbnail = attach(100, 100);
    const main = attach(600, 400);
    recordRenderedFrame(sample(10), main.renderer);
    refreshProfiler(20);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1);
    main.release();
    expect(shouldProfileFrames(main.renderer)).toBe(false);
    expect(shouldProfileFrames(thumbnail.renderer)).toBe(true);
    recordRenderedFrame(sample(100), thumbnail.renderer);
    refreshProfiler(110);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1);
    expect(usePerfStore.getState().metrics.intervalCount).toBe(0);
  });

  it("omits detached or invisible canvases when the wall-clock refresh reselects", () => {
    const main = attach(600, 400);
    main.canvas.style.visibility = "hidden";
    refreshProfiler(10);
    expect(shouldProfileFrames(main.renderer)).toBe(false);
    main.canvas.style.visibility = "visible";
    refreshProfiler(20);
    expect(shouldProfileFrames(main.renderer)).toBe(true);
    main.canvas.remove();
    refreshProfiler(30);
    expect(shouldProfileFrames(main.renderer)).toBe(false);
  });

  it("includes reproducible renderer dimensions and backend in the copied report", () => {
    attach(600, 400);
    const report = JSON.parse(profilerClipboardReport()) as { renderer: { backend: string; backingWidth: number; cssWidth: number; registeredCanvasCount: number } };
    expect(report.renderer).toMatchObject({ backend: "webgpu", backingWidth: 1200, cssWidth: 600, registeredCanvasCount: 1 });
  });

  it("rejects late and unregistered renderer samples after the last canvas is disposed", () => {
    const main = attach(600, 400);
    main.release();
    expect(shouldProfileFrames(main.renderer)).toBe(false);
    expect(shouldProfileFrames({})).toBe(false);
    recordRenderedFrame(sample(10), main.renderer);
    refreshProfiler(20);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(0);
  });
});
