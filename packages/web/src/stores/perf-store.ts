import { create } from "zustand";
import type { PerfRating } from "../lib/perf.js";

// ---------------------------------------------------------------------------
// Metrics snapshot
// ---------------------------------------------------------------------------

export interface PerfMetrics {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly rating: PerfRating;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface PerfState {
  /** Current performance metrics snapshot. */
  readonly metrics: PerfMetrics;
  /** Whether the overlay is visible. */
  readonly visible: boolean;
  /** Update metrics from the sampler. */
  readonly update: (metrics: PerfMetrics) => void;
  /** Toggle overlay visibility (backtick key). */
  readonly toggle: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_METRICS: PerfMetrics = {
  fps: 0,
  frameTimeMs: 0,
  drawCalls: 0,
  triangles: 0,
  rating: "good",
};

export const usePerfStore = create<PerfState>()((set) => ({
  metrics: INITIAL_METRICS,
  visible: false,

  update: (metrics: PerfMetrics) => {
    set({ metrics });
  },

  toggle: () => {
    set((state) => ({ visible: !state.visible }));
  },
}));
