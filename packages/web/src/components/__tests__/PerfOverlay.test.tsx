import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { usePerfStore } from "../../stores/perf-store.js";
import { PerfOverlay } from "../PerfOverlay.js";
import { TOGGLE_KEY } from "../../lib/perf.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setVisible(visible: boolean): void {
  usePerfStore.setState({ visible });
}

function setMetrics(overrides: Partial<{
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  rating: "good" | "warning" | "critical";
}>): void {
  usePerfStore.setState({
    visible: true,
    metrics: {
      fps: 0,
      frameTimeMs: 0,
      drawCalls: 0,
      triangles: 0,
      rating: "good",
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PerfOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    usePerfStore.setState({
      metrics: { fps: 0, frameTimeMs: 0, drawCalls: 0, triangles: 0, rating: "good" },
      visible: false,
    });
  });

  it("renders nothing when not visible", () => {
    const { container } = render(<PerfOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay when visible", () => {
    setVisible(true);
    const { getByTestId } = render(<PerfOverlay />);
    expect(getByTestId("perf-overlay")).toBeDefined();
  });

  it("displays FPS value", () => {
    setMetrics({ fps: 60, frameTimeMs: 16.67 });
    const { getByTestId } = render(<PerfOverlay />);
    const text = getByTestId("perf-overlay").textContent;
    expect(text).toContain("60");
    expect(text).toContain("FPS");
  });

  it("displays frame time with ms suffix", () => {
    setMetrics({ frameTimeMs: 16.67 });
    const { getByTestId } = render(<PerfOverlay />);
    const text = getByTestId("perf-overlay").textContent;
    expect(text).toContain("16.7ms");
  });

  it("displays draw call count", () => {
    setMetrics({ drawCalls: 42 });
    const { getByTestId } = render(<PerfOverlay />);
    const text = getByTestId("perf-overlay").textContent;
    expect(text).toContain("42");
    expect(text).toContain("draws");
  });

  it("displays triangle count with K suffix", () => {
    setMetrics({ triangles: 12_345 });
    const { getByTestId } = render(<PerfOverlay />);
    const text = getByTestId("perf-overlay").textContent;
    expect(text).toContain("12.3K");
    expect(text).toContain("tris");
  });

  it("toggles visibility on backtick keypress", () => {
    const { container, rerender } = render(<PerfOverlay />);
    expect(container.innerHTML).toBe("");

    // Press backtick to show
    document.dispatchEvent(new KeyboardEvent("keydown", { code: TOGGLE_KEY }));
    rerender(<PerfOverlay />);
    expect(container.innerHTML).not.toBe("");

    // Press backtick again to hide
    document.dispatchEvent(new KeyboardEvent("keydown", { code: TOGGLE_KEY }));
    rerender(<PerfOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("ignores non-toggle keys", () => {
    const { container, rerender } = render(<PerfOverlay />);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    rerender(<PerfOverlay />);
    expect(container.innerHTML).toBe("");
  });
});
