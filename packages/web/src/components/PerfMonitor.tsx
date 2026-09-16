import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import type { Camera, Scene, WebGLRenderer } from "three";
import { useDeviceStore } from "../stores/device-store.js";
import { usePerfStore } from "../stores/perf-store.js";
import { FrameIntervalRecorder, type FrameIntervalSummary } from "../lib/frame-interval-sampler.js";

declare global {
  interface Window {
    /**
     * The planner's perf bridge, published by {@link PerfMonitor}.
     *
     * `gl`/`scene`/`camera` are DEV-only handles for console experiments and
     * are absent from production builds. The frame-interval sampler is the
     * part that has to work on a borrowed phone against the real bundle, so it
     * appears whenever `?perf=1` is on the URL, in any build — and only then.
     */
    __venPerf?: {
      readonly gl?: WebGLRenderer;
      readonly scene?: Scene;
      readonly camera?: Camera;
      /** Discard everything recorded so far and start a fresh run. */
      readonly sample?: () => void;
      /** The distribution so far. Safe mid-run; does not stop the recording. */
      readonly summary?: () => FrameIntervalSummary;
      /** Every interval, in order, for anyone who wants the raw trace. */
      readonly raw?: () => readonly number[];
    };
  }
}
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
export function PerfMonitor({ sampleFrames = false }: {
  /** `?perf=1`: record every frame interval for the device matrix. */
  readonly sampleFrames?: boolean;
} = {}): null {
  const { gl, scene, camera } = useThree();
  const samplesRef = useRef<readonly number[]>([]);
  const frameCountRef = useRef(0);
  const recorderRef = useRef<FrameIntervalRecorder | null>(null);
  if (sampleFrames && recorderRef.current === null) recorderRef.current = new FrameIntervalRecorder();

  // One bridge, two audiences.
  //
  // The renderer/scene/camera handles are for console experiments during
  // development and stay behind import.meta.env.DEV, so a production bundle
  // never hands out the live scene graph. The sampler is published whenever it
  // was asked for, because a device matrix measured on a debug build would be
  // measuring the wrong thing — it has to be the bundle the guest gets.
  useEffect(() => {
    const recorder = recorderRef.current;
    window.__venPerf = {
      ...(import.meta.env.DEV ? { gl, scene, camera } : {}),
      ...(recorder === null ? {} : {
        sample: () => { recorder.reset(); },
        summary: () => recorder.summary(),
        raw: () => recorder.raw(),
      }),
    };
    return () => { delete window.__venPerf; };
  }, [gl, scene, camera]);

  useFrame((_state, delta) => {
    // Raw and unclamped, on its own clock: the HUD's average below deliberately
    // discards the long frames this is here to catch.
    recorderRef.current?.frame(performance.now());
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
