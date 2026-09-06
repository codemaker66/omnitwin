// -----------------------------------------------------------------------------
// spring-loop — one requestAnimationFrame loop per component, parked when its
// springs settle.
//
// The house rule (lib/springs.ts): springs, never tweens, stepped with real
// frame deltas, and the loop stops itself so an idle stage costs nothing.
// Every ceremony component owns exactly one of these; the loop calls back
// with the frame's timestamp (the rAF clock the beats are stamped from) and
// the clamped delta, and keeps running only while the callback says so.
// Motion state lives in the caller's refs, never in React state or a store.
// -----------------------------------------------------------------------------

export interface FrameLoop {
  /** Start the loop if it is parked; a no-op while it runs. */
  wake(): void;
  /** Cancel any pending frame. Safe to call twice; the loop may be woken again. */
  stop(): void;
  readonly running: boolean;
}

/** A tab that was hidden hands back a huge delta; the springs get a frame, not a leap. */
const MAX_FRAME_SECONDS = 0.05;
const FIRST_FRAME_SECONDS = 1 / 60;

/**
 * `onFrame(nowMs, dtSeconds)` returns true to be called again next frame and
 * false to park. The first frame after a wake sees a nominal 60 fps delta
 * because there is no previous timestamp to measure from.
 */
export function createFrameLoop(onFrame: (nowMs: number, dtSeconds: number) => boolean): FrameLoop {
  let rafId: number | null = null;
  let lastMs: number | null = null;

  const frame = (nowMs: number): void => {
    rafId = null;
    const dt = lastMs === null
      ? FIRST_FRAME_SECONDS
      : Math.min(MAX_FRAME_SECONDS, Math.max(0, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    if (onFrame(nowMs, dt)) {
      rafId = requestAnimationFrame(frame);
    } else {
      lastMs = null;
    }
  };

  return {
    wake(): void {
      rafId ??= requestAnimationFrame(frame);
    },
    stop(): void {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastMs = null;
    },
    get running(): boolean {
      return rafId !== null;
    },
  };
}
