import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { INITIAL_PERF_METRICS, usePerfStore, type PerfMetrics } from "../../stores/perf-store.js";
import { PerfOverlay } from "../PerfOverlay.js";
import { TOGGLE_KEY } from "../../lib/perf.js";

vi.mock("../../lib/perf-runtime.js", () => ({
  refreshProfiler: vi.fn(), setProfilerForeground: vi.fn(),
  profilerClipboardReport: vi.fn(() => JSON.stringify({ schema: "venviewer.profiler.v1" })),
}));

function setMetrics(overrides: Partial<PerfMetrics> = {}): void {
  usePerfStore.setState({ visible: true, metrics: { ...INITIAL_PERF_METRICS, intervalCount: 3, ...overrides } });
}

beforeEach(() => {
  usePerfStore.setState({ metrics: INITIAL_PERF_METRICS, visible: false, paused: false, generation: 0 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PerfOverlay", () => {
  it("offers a touch-accessible launcher without a closed sampling panel", () => {
    const view = render(<PerfOverlay />);
    expect(view.queryByTestId("perf-overlay")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Open performance profiler" }));
    expect(view.getByTestId("perf-overlay")).toBeDefined();
  });

  it("displays exactly twelve meaningful statistics, averages and missing values", () => {
    setMetrics({ fps: 60, frameTimeMs: 16.67, drawCalls: 42, triangles: 12_345 });
    const view = render(<PerfOverlay />);
    expect(view.container.querySelectorAll("dt").length).toBe(12);
    expect(view.getByText("Rendered FPS")).toBeDefined();
    expect(view.getByText("60.0")).toBeDefined();
    expect(view.getByText("16.7ms")).toBeDefined();
    expect(view.getByText("42")).toBeDefined();
    expect(view.getByText("12.3K")).toBeDefined();
    expect(view.getByText("Tracked memory")).toBeDefined();
    expect(view.getByText(/unavailable$/)).toBeDefined();
  });

  it("pauses, resumes with a fresh window and resets while preserving pause", () => {
    setMetrics({ sampleCount: 1200, fps: 60 });
    const view = render(<PerfOverlay />);
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    expect(usePerfStore.getState().paused).toBe(true);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(1200);
    fireEvent.click(view.getByRole("button", { name: "Reset" }));
    expect(usePerfStore.getState().metrics.sampleCount).toBe(0);
    expect(usePerfStore.getState().paused).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Play" }));
    expect(usePerfStore.getState().paused).toBe(false);
    expect(usePerfStore.getState().metrics.sampleCount).toBe(0);
  });

  it("copies portable JSON with clear success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setMetrics();
    const view = render(<PerfOverlay />);
    fireEvent.click(view.getByRole("button", { name: "Copy report" }));
    await waitFor(() => { expect(view.getByText("Report copied as JSON.")).toBeDefined(); });
    expect(writeText).toHaveBeenCalledWith('{"schema":"venviewer.profiler.v1"}');
  });

  it("shows clipboard denial and allows retry rather than claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setMetrics();
    const view = render(<PerfOverlay />);
    fireEvent.click(view.getByRole("button", { name: "Copy report" }));
    await waitFor(() => { expect(view.getByText(/Clipboard unavailable or permission denied/)).toBeDefined(); });
    expect(view.getByRole("button", { name: "Copy report" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows a working indicator during clipboard completion", async () => {
    let resolve: (() => void) | undefined;
    vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>((done) => { resolve = done; }) } });
    setMetrics();
    const view = render(<PerfOverlay />);
    fireEvent.click(view.getByRole("button", { name: "Copy report" }));
    expect(view.getByRole("button", { name: "Copying…" }).getAttribute("aria-busy")).toBe("true");
    resolve?.();
    await waitFor(() => { expect(view.getByText("Report copied as JSON.")).toBeDefined(); });
  });

  it("toggles with backtick and closes with Escape", () => {
    const view = render(<PerfOverlay />);
    fireEvent.keyDown(document, { code: TOGGLE_KEY });
    expect(view.queryByTestId("perf-overlay")).not.toBeNull();
    fireEvent.keyDown(document, { code: "Escape" });
    expect(view.queryByTestId("perf-overlay")).toBeNull();
  });

  it("ignores typing, repeating, modified, and unrelated keys", () => {
    const view = render(<><input aria-label="Name" /><PerfOverlay /></>);
    fireEvent.keyDown(view.getByRole("textbox"), { code: TOGGLE_KEY });
    fireEvent.keyDown(document, { code: TOGGLE_KEY, repeat: true });
    fireEvent.keyDown(document, { code: TOGGLE_KEY, ctrlKey: true });
    fireEvent.keyDown(document, { code: "KeyA" });
    expect(view.queryByTestId("perf-overlay")).toBeNull();
  });
});
