import { create } from "zustand";
import type { QualityRung } from "../lib/render-quality.js";

// ---------------------------------------------------------------------------
// Render governor store — the rungs of quality given up on this device
//
// The frame-rate governor (lib/render-governor.ts) gives up quality, a rung at
// a time, when the device cannot hold its frame rate; the planner's scene
// applies what has been given up and the profiler names it. Nothing is given
// back for the rest of the visit, so the view never pumps.
// ---------------------------------------------------------------------------

/** What the governor has measured on this device, for the profiler's report. */
export interface RenderGovernorMeasure {
  /** The display's refresh rate as judged, or null before it is probed. */
  readonly displayHz: number | null;
  /** Frames a second over the last window of frames the device paced. */
  readonly lastWindowFps: number | null;
  /** Share of that window's frame time spent on frame work on the main thread: high when the CPU holds frames up. */
  readonly cpuShare: number | null;
  readonly windows: number;
}

interface RenderGovernorState {
  /** The rungs given up so far, in order. */
  readonly given: readonly QualityRung[];
  readonly measured: RenderGovernorMeasure | null;
  readonly setGiven: (given: readonly QualityRung[]) => void;
  readonly setMeasured: (measured: RenderGovernorMeasure) => void;
}

export const useRenderGovernorStore = create<RenderGovernorState>()((set) => ({
  given: [],
  measured: null,
  setGiven: (given) => {
    set({ given });
  },
  setMeasured: (measured) => {
    set({ measured });
  },
}));
