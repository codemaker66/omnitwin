// -----------------------------------------------------------------------------
// stage-loop — the stage's one requestAnimationFrame loop.
//
// Project law (spec section 7): one rAF loop per mounted module, springs in
// refs, parking on isSpringSettled, motion never in a store. Rather than
// five components each owning a loop, the stage runs one scheduler: a step
// registers, is called with the frame clock and the real delta, and returns
// false the frame it settles, which removes it. When the last step leaves,
// the loop parks and no frame is requested until something wakes it. The
// clock functions are injected so the scheduler is tested with a fake frame
// queue and never with timers.
// -----------------------------------------------------------------------------

/** Return true to be called next frame, false to park. */
export type StageStep = (nowMs: number, dtSeconds: number) => boolean;

export interface StageLoop {
  /** Register a step; returns its remover. Adding wakes the loop. */
  readonly add: (step: StageStep) => () => void;
  /** Inactive loops request no frames; steps keep their registration and resume on activation. */
  readonly setActive: (active: boolean) => void;
  readonly isRunning: () => boolean;
  readonly stepCount: () => number;
  /** Cancel any pending frame and drop every step. */
  readonly dispose: () => void;
}

type RequestFrame = (callback: (nowMs: number) => void) => number;
type CancelFrame = (handle: number) => void;

/** A dropped frame or a tab switch must not become one giant spring step. */
const MAX_FRAME_DT_SECONDS = 0.1;
const FIRST_FRAME_DT_SECONDS = 1 / 60;

export function createStageLoop(requestFrame: RequestFrame, cancelFrame: CancelFrame): StageLoop {
  const steps = new Set<StageStep>();
  let handle: number | null = null;
  let lastFrameMs = 0;
  let active = true;

  const frame = (nowMs: number): void => {
    handle = null;
    const dt = lastFrameMs > 0
      ? Math.min(MAX_FRAME_DT_SECONDS, Math.max(0, (nowMs - lastFrameMs) / 1000))
      : FIRST_FRAME_DT_SECONDS;
    lastFrameMs = nowMs;
    // A step may remove itself or add a sibling mid-frame; iterate a copy.
    for (const step of Array.from(steps)) {
      if (!steps.has(step)) continue;
      if (!step(nowMs, dt)) steps.delete(step);
    }
    if (steps.size > 0 && active) {
      handle = requestFrame(frame);
    } else {
      lastFrameMs = 0;
    }
  };

  const wake = (): void => {
    if (!active || handle !== null || steps.size === 0) return;
    handle = requestFrame(frame);
  };

  return {
    add(step) {
      steps.add(step);
      wake();
      return () => {
        steps.delete(step);
      };
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      if (!active && handle !== null) {
        cancelFrame(handle);
        handle = null;
        lastFrameMs = 0;
      }
      if (active) wake();
    },
    isRunning: () => handle !== null,
    stepCount: () => steps.size,
    dispose() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      steps.clear();
      lastFrameMs = 0;
    },
  };
}
