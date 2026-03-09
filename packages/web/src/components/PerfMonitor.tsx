import { useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useDeviceStore } from "../stores/device-store.js";
import { usePerfStore } from "../stores/perf-store.js";
import {
  getPerfBudget,
  frameTimeToFps,
  ratePerformance,
  addSample,
  computeAverage,
  clampFrameTime,
  PERF_SAMPLE_COUNT,
  UPDATE_INTERVAL,
} from "../lib/perf.js";

/**
 * Performance sampler — runs inside Canvas, collects frame timing and
 * WebGL renderer stats, pushes snapshots to the perf Zustand store.
 *
 * Only rendered in dev mode (conditional in App.tsx).
 * Renders nothing — this is a side-effect-only component.
 */
export function PerfMonitor(): null {
  const { gl } = useThree();
  const samplesRef = useRef<readonly number[]>([]);
  const frameCountRef = useRef(0);

  useFrame((_state, delta) => {
    const frameTimeMs = clampFrameTime(delta * 1000);
    samplesRef.current = addSample(samplesRef.current, frameTimeMs, PERF_SAMPLE_COUNT);
    frameCountRef.current += 1;

    // Only push to store every N frames to reduce overhead
    if (frameCountRef.current % UPDATE_INTERVAL !== 0) return;

    const avgFrameTime = computeAverage(samplesRef.current);
    const fps = frameTimeToFps(avgFrameTime);
    const tier = useDeviceStore.getState().tier;
    const budget = getPerfBudget(tier);
    const rating = ratePerformance(avgFrameTime, budget);

    const renderInfo = gl.info.render;

    usePerfStore.getState().update({
      fps,
      frameTimeMs: avgFrameTime,
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
      rating,
    });
  });

  return null;
}
