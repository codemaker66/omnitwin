import { describe, it, expect, beforeEach } from "vitest";
import { usePerfStore, type PerfMetrics } from "../perf-store.js";

const MOCK_METRICS: PerfMetrics = {
  fps: 60,
  frameTimeMs: 16.67,
  drawCalls: 42,
  triangles: 12000,
  rating: "good",
};

const DEGRADED_METRICS: PerfMetrics = {
  fps: 18,
  frameTimeMs: 55.5,
  drawCalls: 200,
  triangles: 500000,
  rating: "critical",
};

beforeEach(() => {
  usePerfStore.setState({
    metrics: { fps: 0, frameTimeMs: 0, drawCalls: 0, triangles: 0, rating: "good" },
    visible: false,
  });
});

describe("perf-store", () => {
  it("starts with zeroed metrics and hidden overlay", () => {
    const state = usePerfStore.getState();
    expect(state.metrics.fps).toBe(0);
    expect(state.metrics.drawCalls).toBe(0);
    expect(state.visible).toBe(false);
  });

  it("update() replaces the metrics snapshot", () => {
    usePerfStore.getState().update(MOCK_METRICS);
    expect(usePerfStore.getState().metrics).toEqual(MOCK_METRICS);
  });

  it("update() with degraded metrics stores the new rating", () => {
    usePerfStore.getState().update(DEGRADED_METRICS);
    expect(usePerfStore.getState().metrics.rating).toBe("critical");
    expect(usePerfStore.getState().metrics.fps).toBe(18);
  });

  it("toggle() flips overlay visibility", () => {
    expect(usePerfStore.getState().visible).toBe(false);
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(true);
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(false);
  });

  it("update() does not affect visibility", () => {
    usePerfStore.getState().toggle(); // visible = true
    usePerfStore.getState().update(MOCK_METRICS);
    expect(usePerfStore.getState().visible).toBe(true);
  });
});
