import { create } from "zustand";
import { INITIAL_PERF_METRICS, type PerfMetrics } from "../lib/perf-profiler.js";
export type { PerfMetrics } from "../lib/perf-profiler.js";
export { INITIAL_PERF_METRICS } from "../lib/perf-profiler.js";

// ---------------------------------------------------------------------------
// Metrics snapshot
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface PerfState {
  /** Current performance metrics snapshot. */
  readonly metrics: PerfMetrics;
  /** Whether the overlay is visible. */
  readonly visible: boolean;
  readonly paused: boolean;
  /** Invalidates queued GPU results and starts a fresh window. */
  readonly generation: number;
  /** Update metrics from the sampler. */
  readonly update: (metrics: Pick<PerfMetrics, "fps" | "frameTimeMs" | "drawCalls" | "triangles" | "rating"> & Partial<PerfMetrics>) => void;
  /** Toggle overlay visibility (backtick key). */
  readonly toggle: () => void;
  readonly togglePaused: () => void;
  readonly reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePerfStore = create<PerfState>()((set) => ({
  metrics: INITIAL_PERF_METRICS,
  visible: false,
  paused: false,
  generation: 0,

  update: (metrics) => {
    set({ metrics: { ...INITIAL_PERF_METRICS, ...metrics } });
  },

  toggle: () => {
    set((state) => ({
      visible: !state.visible, paused: false, generation: state.generation + 1,
      metrics: state.visible ? state.metrics : INITIAL_PERF_METRICS,
    }));
  },
  togglePaused: () => { set((state) => ({
    paused: !state.paused, generation: state.generation + 1,
    metrics: state.paused ? INITIAL_PERF_METRICS : state.metrics,
  })); },
  reset: () => { set((state) => ({ metrics: INITIAL_PERF_METRICS, generation: state.generation + 1 })); },
}));
