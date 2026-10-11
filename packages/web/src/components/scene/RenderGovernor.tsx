import { useEffect, useRef, useState } from "react";
import { addAfterEffect, addEffect, useFrame, useThree } from "@react-three/fiber";
import { FrameGovernor, displayRateFrom, type StepKind } from "../../lib/render-governor.js";
import { nextQualityRung, type RenderProfile } from "../../lib/render-quality.js";
import { onMainDraw } from "../../lib/main-draw-clock.js";
import { getNativeRenderer, nativeRendererGpuString } from "../../lib/native-renderer.js";
import { isSoftwareRenderer } from "../grand-hall/hall-finish.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useRenderGovernorStore } from "../../stores/render-governor-store.js";

/** The governor and what it has seen, for probes in development builds. */
export interface RenderGovernorProbe {
  readonly governor: Pick<FrameGovernor, "stepsDown" | "displayRate" | "lastWindowFps" | "lastWindowCpuShare" | "windowsJudged" | "finished">;
  /** Frame updates, draws, and updates the GPU's backlog held back from drawing. */
  readonly counts: { updates: number; draws: number; heldBack: number };
}

declare global {
  interface Window {
    /** The planner's frame-rate governor, for probes in development builds. */
    __renderGovernor?: RenderGovernorProbe;
  }
}

/** Animation frames the display's rate is read from. */
const PROBE_FRAMES = 31;
/** The first read, once the planner has settled. */
const PROBE_START_MS = 3000;
/** A read the planner drew through is taken again this much later. */
const PROBE_RETRY_MS = 1500;
/** A second clean read, in case the first ran on a busy page; the faster is kept. */
const PROBE_AGAIN_MS = 8000;
const PROBE_READS = 2;

export interface RenderGovernorProps {
  /** The device's render profile, before anything is given up. */
  readonly profile: RenderProfile;
  /** The canvas's pixel ratio for the profile, before any resolution is given up. */
  readonly baseRatio: number;
  /** Switched off, it measures without giving anything up. */
  readonly enabled: boolean;
}

/**
 * Watches the planner's draws and gives up quality, a rung at a time, when the
 * device cannot hold its frame rate (lib/render-governor.ts, after Ryan Sael's
 * governor). It judges the frames a viewer sees, the main view's draws, which
 * the GPU's backlog can hold back from the frame updates. Only frames the
 * device paced count: drawn while the view is being moved, while the scene
 * animates on its own (the loop runs straight on), or after the GPU held a
 * frame back. A frame drawn for a single change, a chunk arriving, waited on
 * that change rather than the device. Each frame's CPU cost is the main
 * thread's frame work since the draw before: every frame update, drawn or
 * held back. Off on software rasterisers, where every frame is slow by nature
 * and the scene is already drawn plainly.
 */
export function RenderGovernor({ profile, baseRatio, enabled }: RenderGovernorProps): null {
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  // One governor for the visit: the quality it gives up stays given up.
  const [governor] = useState(() => new FrameGovernor());
  const counts = useRef({ updates: 0, draws: 0, heldBack: 0 });
  const software = useRef<boolean | null>(null);
  const latest = useRef({ profile, baseRatio, enabled });
  latest.current = { profile, baseRatio, enabled };

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const probe: RenderGovernorProbe = { governor, counts: counts.current };
    window.__renderGovernor = probe;
    return () => {
      if (window.__renderGovernor === probe) delete window.__renderGovernor;
    };
  }, [governor]);

  // Whether this pass of the frame loop updated the planner, and when it drew.
  const updated = useRef(false);
  const drawnAt = useRef<number | null>(null);
  useFrame(() => {
    updated.current = true;
  });
  useEffect(() => onMainDraw((startedAt) => { drawnAt.current = startedAt; }), []);

  useEffect(() => {
    const tally = counts.current;
    let passStartedAt = 0;
    let lastDrawAt: number | null = null;
    /** Main-thread frame work since the last draw, ms. */
    let workSinceDraw = 0;
    /** The loop stopped since the last draw: the next waited on something. */
    let stoppedSinceDraw = true;
    /** An update since the last draw was held back by the GPU's backlog. */
    let heldBackSinceDraw = false;
    const isSoftware = (): boolean => {
      if (software.current === null) {
        const native = getNativeRenderer(gl);
        software.current = native !== null && isSoftwareRenderer(nativeRendererGpuString(native));
      }
      return software.current;
    };
    const giveUp = (held: StepKind): boolean => {
      const { profile: current, baseRatio: ratio, enabled: governs } = latest.current;
      if (!governs) return false;
      const { given, setGiven } = useRenderGovernorStore.getState();
      const rung = nextQualityRung(current, ratio, given, held);
      if (rung === null) return false;
      setGiven([...given, rung]);
      return true;
    };
    const observe = (interval: number, workMs: number): void => {
      const judged = governor.windowsJudged;
      governor.observe(interval, workMs, giveUp);
      if (governor.windowsJudged === judged) return;
      useRenderGovernorStore.getState().setMeasured({
        displayHz: governor.displayRate,
        lastWindowFps: governor.lastWindowFps,
        cpuShare: governor.lastWindowCpuShare,
        windows: governor.windowsJudged,
      });
    };
    const unsubscribeStart = addEffect(() => { passStartedAt = performance.now(); });
    const unsubscribeEnd = addAfterEffect(() => {
      const passUpdated = updated.current;
      const drewAt = drawnAt.current;
      updated.current = false;
      drawnAt.current = null;
      if (passUpdated) {
        tally.updates += 1;
        workSinceDraw += performance.now() - passStartedAt;
        if (drewAt === null) {
          tally.heldBack += 1;
          heldBackSinceDraw = true;
        }
      }
      if (drewAt !== null) {
        tally.draws += 1;
        const paced = !stoppedSinceDraw || heldBackSinceDraw || useCockpitStore.getState().cameraInteractionActive;
        const interval = lastDrawAt === null ? null : (drewAt - lastDrawAt) / 1000;
        const work = workSinceDraw;
        lastDrawAt = drewAt;
        workSinceDraw = 0;
        stoppedSinceDraw = false;
        heldBackSinceDraw = false;
        if (interval !== null && paced && !document.hidden && !isSoftware()) observe(interval, work);
      }
      if (get().internal.frames === 0) stoppedSinceDraw = true;
    });
    return () => {
      unsubscribeStart();
      unsubscribeEnd();
    };
  }, [get, gl, governor]);

  // The display's own rate, read from a burst of animation frames while the planner draws nothing.
  useEffect(() => {
    const tally = counts.current;
    let frame = 0;
    let timer = 0;
    let reads = 0;
    const probe = (): void => {
      const updatesBefore = tally.updates;
      const stamps: number[] = [];
      const tick = (now: number): void => {
        stamps.push(now);
        if (stamps.length < PROBE_FRAMES) {
          frame = requestAnimationFrame(tick);
          return;
        }
        const hz = tally.updates === updatesBefore ? displayRateFrom(stamps) : null;
        if (hz !== null) {
          reads += 1;
          governor.setDisplayRate(Math.max(hz, governor.displayRate ?? 0));
        }
        if (reads < PROBE_READS) timer = window.setTimeout(probe, hz === null ? PROBE_RETRY_MS : PROBE_AGAIN_MS);
      };
      frame = requestAnimationFrame(tick);
    };
    timer = window.setTimeout(probe, PROBE_START_MS);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [governor]);

  return null;
}
