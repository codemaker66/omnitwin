// -----------------------------------------------------------------------------
// stage-runtime — what the stage's parts share without React state.
//
// One loop (stage-loop.ts), one pointer stream, one look stream, and the two
// rects the geometry needs. The Stage root publishes; the plane stack, the
// light and the prop buttons subscribe. Samples flow through plain listener
// sets rather than state because a pointermove at 120 Hz through setState
// would re-render the narrative for every twitch of the hand; nothing here
// causes a render.
// -----------------------------------------------------------------------------
import { createContext, useContext } from "react";
import type { Look } from "./parallax.js";
import type { StagePoint, StageRect } from "./stage-geometry.js";
import { createStageLoop, type StageLoop } from "./stage-loop.js";

export interface StagePointerSample extends StagePoint {
  readonly clientX: number;
  readonly clientY: number;
  /** px/s at the moment of the event. */
  readonly speed: number;
  /** True for a mouse or pen; touch never sets a hover state. */
  readonly fine: boolean;
}

export type LookSource = "pointer" | "orientation" | "rest";
export type StagePointerListener = (sample: StagePointerSample) => void;
export type StageLookListener = (look: Look, source: LookSource) => void;

export interface StageRuntime {
  readonly loop: StageLoop;
  readonly onPointer: (listener: StagePointerListener) => () => void;
  readonly onLook: (listener: StageLookListener) => () => void;
  readonly publishPointer: (sample: StagePointerSample) => void;
  readonly publishLook: (look: Look, source: LookSource) => void;
  /** The fixed root; CSS variables for the light are written here. */
  readonly getRoot: () => HTMLElement | null;
  /** The tableau's rect in client px, or null before mount. */
  readonly getTableauRect: () => StageRect | null;
  readonly dispose: () => void;
}

export interface StageRuntimeOptions {
  readonly getRoot: () => HTMLElement | null;
  readonly getTableauRect: () => StageRect | null;
  readonly requestFrame?: (callback: (nowMs: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export function createStageRuntime(options: StageRuntimeOptions): StageRuntime {
  const requestFrame = options.requestFrame
    ?? ((callback: (nowMs: number) => void): number => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame
    ?? ((handle: number): void => { window.cancelAnimationFrame(handle); });
  const loop = createStageLoop(requestFrame, cancelFrame);
  const pointerListeners = new Set<StagePointerListener>();
  const lookListeners = new Set<StageLookListener>();

  return {
    loop,
    onPointer(listener) {
      pointerListeners.add(listener);
      return () => { pointerListeners.delete(listener); };
    },
    onLook(listener) {
      lookListeners.add(listener);
      return () => { lookListeners.delete(listener); };
    },
    publishPointer(sample) {
      for (const listener of pointerListeners) listener(sample);
    },
    publishLook(look, source) {
      for (const listener of lookListeners) listener(look, source);
    },
    getRoot: options.getRoot,
    getTableauRect: options.getTableauRect,
    dispose() {
      loop.dispose();
      pointerListeners.clear();
      lookListeners.clear();
    },
  };
}

export const StageRuntimeContext = createContext<StageRuntime | null>(null);

/** The runtime of the enclosing Stage; a stage part outside a Stage is a wiring error, said plainly. */
export function useStageRuntime(): StageRuntime {
  const runtime = useContext(StageRuntimeContext);
  if (runtime === null) {
    throw new Error("Stage parts must be rendered inside <Stage>: no StageRuntime in context.");
  }
  return runtime;
}
