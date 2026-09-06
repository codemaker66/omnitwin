// -----------------------------------------------------------------------------
// Lantern — the quiz's raw-WebGL compositor, grown from
// pages/landing/FlameCanvas.tsx and keeping its discipline: one canvas, one
// program, a CSS fallback always beneath it, a rAF loop that runs only while
// the scene is active and the tab visible, and every GL object released on
// cleanup. Never Three.js.
//
// The Lantern is the back plane of the tableau: for "river-gate" it paints
// every pixel (sky and river) and puts the flame, its halo and the moths at
// the first light. A silhouette plane drawn above it must leave the lantern's
// glass open so the flame shows, and may thin its fill near the bracket so
// the halo reads on the wall.
//
// Motion state lives in refs, never in React state: the flame intensity is a
// SpringState kicked by gutter() and stepped with lib/springs on the
// FlameCanvas preset; ripples are a ring buffer of eight stamped on the
// Lantern's own clock. Under reduced motion the shader pins its motion clock
// and the loop parks whenever nothing is changing, waking for a handle call.
// -----------------------------------------------------------------------------
import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../../../lib/springs.js";
import type { StageLight } from "../stage/stage-manifest.js";
import {
  createLanternBudget,
  dprForFill,
  LANTERN_DEFAULT_MAX_DPR,
  lanternFillMegapixels,
  stepLanternBudget,
} from "./lantern-budget.js";
import {
  acquireLanternContext,
  createLanternProgram,
  MAX_LIGHT_UNIFORMS,
  packLights,
  packRipples,
  presetFor,
  type LanternFrame,
  type LanternProgram,
} from "./lantern-program.js";
import { MAX_RIPPLES, type LanternHandle, type LanternProps, type LanternRipple } from "./lantern-types.js";
import "./lantern.css";

/** FlameCanvas's flameIntensity preset: underdamped, so a guttered flame rights itself with a wobble. */
const FLAME_SPRING: SpringConfig = { stiffness: 60, damping: 9 };
/** Velocity per unit strength: a full-strength poke dips the flame to about a fifth before it recovers. */
const GUTTER_KICK = 7;
/** The shader stops drawing a ring after this; the buffer drops it a little later. */
const RIPPLE_LIFE_S = 3;
const INTENSITY_MIN = 0.05;
const INTENSITY_MAX = 1.15;

export interface LanternComponentProps extends LanternProps {
  /** The DPR ceiling: 1.5 by default; the stage passes 2 on high tier. */
  readonly maxDpr?: number;
}

interface LanternState {
  readonly pointer: Float32Array;
  readonly lights: Float32Array;
  lightCount: number;
  readonly ripples: LanternRipple[];
  readonly rippleBuffer: Float32Array;
  dusk: number;
  readonly intensity: SpringState;
  reducedMotion: boolean;
  /** Set by every handle call so a parked loop under reduced motion draws once more. */
  dirty: boolean;
}

function createLanternState(): LanternState {
  return {
    pointer: new Float32Array(4),
    lights: new Float32Array(MAX_LIGHT_UNIFORMS * 4),
    lightCount: 0,
    ripples: [],
    rippleBuffer: new Float32Array(MAX_RIPPLES * 3),
    dusk: 0,
    intensity: { value: 1, velocity: 0 },
    reducedMotion: false,
    dirty: true,
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

type FallbackStyle = CSSProperties & { readonly "--lantern-x": string; readonly "--lantern-y": string };

function fallbackStyleFor(first: StageLight | undefined): FallbackStyle | undefined {
  if (first === undefined) {
    return undefined;
  }
  const pct = (v: number): string => `${String(Math.round(clamp01(v) * 1000) / 10)}%`;
  return { "--lantern-x": pct(first.x), "--lantern-y": pct(first.y) };
}

export function Lantern({
  program,
  active,
  reducedMotion,
  lights,
  onHandle,
  className,
  maxDpr = LANTERN_DEFAULT_MAX_DPR,
}: LanternComponentProps): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<LanternState | null>(null);
  stateRef.current ??= createLanternState();
  const state = stateRef.current;
  const onHandleRef = useRef(onHandle);

  useEffect(() => {
    onHandleRef.current = onHandle;
  });

  useEffect(() => {
    state.lightCount = packLights(lights, state.lights);
    state.dirty = true;
  }, [state, lights]);

  useEffect(() => {
    state.reducedMotion = reducedMotion;
    state.dirty = true;
  }, [state, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const preset = presetFor(program);
    if (canvas === null) {
      return;
    }
    if (preset === null) {
      // "none", or a beat not built yet: the fallback is the whole picture.
      canvas.style.display = "none";
      return;
    }
    if (!active) {
      return;
    }

    const context = acquireLanternContext(canvas, preset.opaque);
    if (context === null) {
      canvas.style.display = "none"; // the CSS fallback stays visible
      return;
    }
    const { gl } = context;
    let glProgram: LanternProgram | null = createLanternProgram(gl, preset);
    if (glProgram === null) {
      canvas.style.display = "none";
      return;
    }

    let budget = createLanternBudget(window.devicePixelRatio, maxDpr);
    let cssWidth = 0;
    let cssHeight = 0;
    let currentDpr = budget.dpr;
    let rafId: number | null = null;
    let last = 0;
    const start = performance.now();
    const clock = (): number => (performance.now() - start) / 1000;

    const resize = (): void => {
      cssWidth = canvas.clientWidth;
      cssHeight = canvas.clientHeight;
      currentDpr = Math.min(budget.dpr, dprForFill(cssWidth, cssHeight, budget.dpr));
      const width = Math.max(1, Math.round(cssWidth * currentDpr));
      const height = Math.max(1, Math.round(cssHeight * currentDpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const rippleAlive = (now: number): boolean =>
      state.ripples.some((ripple) => now - ripple.startedAt < RIPPLE_LIFE_S + 0.5);

    // Under reduced motion the picture is still, so a frame is owed only
    // while something is actually changing: a handle call, the flame
    // righting itself, a ring fading.
    const needsFrame = (): boolean =>
      !state.reducedMotion ||
      state.dirty ||
      !isSpringSettled(state.intensity, 1, 0.002) ||
      rippleAlive(clock());

    const frame = (now: number): void => {
      rafId = null;
      if (glProgram === null || gl.isContextLost()) {
        return;
      }
      const dtMs = last > 0 ? now - last : 1000 / 60;
      last = now;
      budget = stepLanternBudget(budget, dtMs);
      resize();
      stepSpring(state.intensity, 1, dtMs / 1000, FLAME_SPRING);
      state.dirty = false;

      const time = clock();
      for (let i = state.ripples.length - 1; i >= 0; i -= 1) {
        const ripple = state.ripples[i];
        if (ripple !== undefined && time - ripple.startedAt > RIPPLE_LIFE_S + 0.5) {
          state.ripples.splice(i, 1);
        }
      }
      const rippleCount = packRipples(state.ripples, state.rippleBuffer);
      const uniforms: LanternFrame = {
        width: canvas.width,
        height: canvas.height,
        time,
        dusk: state.dusk,
        lanternIntensity: Math.min(Math.max(state.intensity.value, INTENSITY_MIN), INTENSITY_MAX),
        pointer: state.pointer,
        lights: state.lights,
        lightCount: state.lightCount,
        ripples: state.rippleBuffer,
        rippleCount,
        reducedMotion: state.reducedMotion,
        particles: budget.particles,
      };
      glProgram.draw(uniforms);

      if (!document.hidden && needsFrame()) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        last = 0;
      }
    };

    const wake = (): void => {
      if (rafId === null && !document.hidden && glProgram !== null) {
        last = 0;
        rafId = window.requestAnimationFrame(frame);
      }
    };

    const park = (): void => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
        last = 0;
      }
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        park();
      } else {
        wake();
      }
    };

    const onContextLost = (event: Event): void => {
      event.preventDefault(); // ask the browser to restore rather than abandon
      park();
      glProgram?.dispose();
      glProgram = null;
    };

    const onContextRestored = (): void => {
      glProgram = createLanternProgram(gl, preset);
      if (glProgram === null) {
        canvas.style.display = "none";
        return;
      }
      state.dirty = true;
      wake();
    };

    const handle: LanternHandle = {
      programId: program,
      setPointer(x, y, speed): void {
        const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
        state.pointer[0] = x;
        state.pointer[1] = y;
        state.pointer[2] = Math.max(0, speed);
        state.pointer[3] = inside ? 1 : 0;
        state.dirty = true;
        wake();
      },
      gutter(strength): void {
        state.intensity.velocity -= clamp01(strength) * GUTTER_KICK;
        state.dirty = true;
        wake();
      },
      ripple(x, y): void {
        const ripple: LanternRipple = { x: clamp01(x), y: clamp01(y), startedAt: clock() };
        if (state.ripples.length < MAX_RIPPLES) {
          state.ripples.push(ripple);
        } else {
          // The buffer is full: the oldest ring gives way.
          let oldest = 0;
          for (let i = 1; i < state.ripples.length; i += 1) {
            const candidate = state.ripples[i];
            const current = state.ripples[oldest];
            if (candidate !== undefined && current !== undefined && candidate.startedAt < current.startedAt) {
              oldest = i;
            }
          }
          state.ripples[oldest] = ripple;
        }
        state.dirty = true;
        wake();
      },
      setDusk(value): void {
        state.dusk = clamp01(value);
        state.dirty = true;
        wake();
      },
      setLights(next): void {
        state.lightCount = packLights(next, state.lights);
        state.dirty = true;
        wake();
      },
      get fillMegapixels(): number {
        return lanternFillMegapixels(cssWidth, cssHeight, currentDpr);
      },
      get degraded(): boolean {
        return budget.degraded;
      },
    };

    canvas.style.display = "";
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    state.dirty = true;
    wake();
    onHandleRef.current?.(handle);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      park();
      glProgram?.dispose();
      glProgram = null;
      // Deliberately no loseContext(): under StrictMode's double-invoke,
      // getContext() would then hand back the same, now dead, context. The
      // browser reclaims it with the canvas when the plane truly unmounts.
      onHandleRef.current?.(null);
    };
  }, [state, program, active, maxDpr]);

  if (program === "none") {
    return null;
  }

  const fallbackClass = reducedMotion ? "lantern-fallback lantern-fallback--still" : "lantern-fallback";
  const canvasClass = className === undefined ? "lantern-canvas" : `lantern-canvas ${className}`;

  return (
    <>
      <div className={fallbackClass} style={fallbackStyleFor(lights[0])} aria-hidden data-testid="lantern-fallback" />
      <canvas
        key={program}
        ref={canvasRef}
        className={canvasClass}
        aria-hidden
        data-testid="lantern-canvas"
        data-program={program}
      />
    </>
  );
}
