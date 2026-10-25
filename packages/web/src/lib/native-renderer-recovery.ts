/**
 * When and how a native view gets its graphics back after the browser takes
 * them away: a driver reset, the OS reclaiming memory from a backgrounded tab,
 * a laptop switching graphics card.
 *
 * Two ways back. A *swap* puts a fresh renderer on the same canvas and keeps
 * everything else exactly as it was: the scene graph, the camera, the walk,
 * the selection and every decoded splat, which the new device receives again
 * from the CPU copies the scene already holds. A *remount* replaces the canvas
 * as well, which is the only way back from a WebGL context the browser never
 * returns; it costs the scene's own state, so it is the last resort.
 *
 * This module is the policy only (no GPU, no React): NativeCanvas performs the
 * attempts and shows the phases.
 */

export type NativeLossApi = "WebGPU" | "WebGL";
export type NativeRestoreMode = "swap" | "remount";

export type NativeRecoveryPhase =
  | { readonly kind: "running" }
  /** Reported the moment a loss arrives, before recovery has decided how to restore. */
  | { readonly kind: "lost" }
  | { readonly kind: "waiting"; readonly for: "visible" | "context" }
  | { readonly kind: "restoring"; readonly attempt: number }
  | { readonly kind: "failed"; readonly error: Error };

/** Delay before each attempt. The first is immediate; a GPU process needs a moment to come back. */
export const NATIVE_RECOVERY_BACKOFF_MS: readonly number[] = [0, 1_000, 3_000];
/** An attempt still unsettled after this long (a context that cannot be created, say) has failed. */
export const NATIVE_RECOVERY_ATTEMPT_TIMEOUT_MS = 15_000;
/** How long a visible page waits for the browser to hand a lost WebGL context back. */
export const NATIVE_RECOVERY_CONTEXT_WAIT_MS = 4_000;
/** This many losses inside the window means the device is not coming back; stop asking. */
export const NATIVE_RECOVERY_LOSS_LIMIT = 3;
export const NATIVE_RECOVERY_LOSS_WINDOW_MS = 60_000;

export interface NativeRecoveryEnvironment {
  readonly visible: () => boolean;
  /** Calls `listener` whenever the page becomes visible; returns the unsubscribe. */
  readonly onVisible: (listener: () => void) => () => void;
  /** Returns the cancel. */
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  readonly now: () => number;
}

export interface NativeRendererRecoveryOptions {
  /** Performs one attempt; resolves once the new renderer has drawn its scene. */
  readonly restore: (mode: NativeRestoreMode, attempt: number) => Promise<void>;
  readonly onPhase: (phase: NativeRecoveryPhase) => void;
  readonly environment?: NativeRecoveryEnvironment;
}

export interface NativeRendererRecovery {
  /** The device or context is gone. Repeated reports of the same loss coalesce. */
  lost(api: NativeLossApi): void;
  /** The browser fired `webglcontextrestored` on the canvas. */
  contextRestored(): void;
  /** A person asked for the view again: forget the losses and start over. */
  reset(): void;
  dispose(): void;
}

function browserEnvironment(): NativeRecoveryEnvironment {
  return {
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    onVisible: (listener) => {
      if (typeof document === "undefined") return () => undefined;
      const changed = (): void => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", changed);
      return () => { document.removeEventListener("visibilitychange", changed); };
    },
    setTimer: (callback, ms) => {
      const handle = setTimeout(callback, ms);
      return () => { clearTimeout(handle); };
    },
    now: () => performance.now(),
  };
}

type Stage = "running" | "pending" | "waiting" | "attempting" | "backoff" | "failed";

export function createNativeRendererRecovery({
  restore, onPhase, environment = browserEnvironment(),
}: NativeRendererRecoveryOptions): NativeRendererRecovery {
  let stage: Stage = "running";
  let api: NativeLossApi = "WebGPU";
  let contextHandedBack = false;
  let attempt = 0;
  /** A loss reported while an attempt was in flight: that attempt's success is not to be trusted. */
  let compromised = false;
  let generation = 0;
  let disposed = false;
  let losses: number[] = [];
  let cancelTimer: (() => void) | null = null;
  let stopWatchingVisibility: (() => void) | null = null;

  const report = (phase: NativeRecoveryPhase): void => { if (!disposed) onPhase(phase); };
  const clearWaits = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    stopWatchingVisibility?.();
    stopWatchingVisibility = null;
  };
  const fail = (error: Error): void => {
    clearWaits();
    stage = "failed";
    report({ kind: "failed", error });
  };
  const maxAttempts = NATIVE_RECOVERY_BACKOFF_MS.length;
  const modeFor = (next: number): NativeRestoreMode => {
    if (api === "WebGL") return next === 1 && contextHandedBack ? "swap" : "remount";
    return next < maxAttempts ? "swap" : "remount";
  };

  function attemptNow(mode: NativeRestoreMode): void {
    clearWaits();
    attempt += 1;
    stage = "attempting";
    compromised = false;
    const owner = ++generation;
    const number = attempt;
    report({ kind: "restoring", attempt: number });
    cancelTimer = environment.setTimer(() => {
      cancelTimer = null;
      if (owner !== generation) return;
      // Abandon it: a late settle of this attempt changes nothing.
      generation++;
      retryAfter(new Error("The graphics device did not come back in time"));
    }, NATIVE_RECOVERY_ATTEMPT_TIMEOUT_MS);
    let outcome: Promise<void>;
    try {
      outcome = restore(mode, number);
    } catch (error: unknown) {
      outcome = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    outcome.then(() => {
      if (owner !== generation) return;
      clearWaits();
      if (compromised) {
        retryAfter(new Error("The graphics device was lost again while the view was restoring"));
        return;
      }
      stage = "running";
      report({ kind: "running" });
    }, (error: unknown) => {
      if (owner !== generation) return;
      clearWaits();
      retryAfter(error instanceof Error ? error : new Error(String(error)));
    });
  }

  function retryAfter(error: Error): void {
    if (attempt >= maxAttempts) { fail(error); return; }
    stage = "backoff";
    cancelTimer = environment.setTimer(() => { cancelTimer = null; proceed(); }, NATIVE_RECOVERY_BACKOFF_MS[attempt] ?? 0);
  }

  function proceed(): void {
    if (disposed) return;
    clearWaits();
    if (!environment.visible()) {
      // A backgrounded page is exactly when the browser withholds graphics;
      // asking now would fail or be taken away again.
      stage = "waiting";
      report({ kind: "waiting", for: "visible" });
      stopWatchingVisibility = environment.onVisible(() => { proceed(); });
      return;
    }
    if (api === "WebGL" && attempt === 0 && !contextHandedBack) {
      // A WebGL canvas can only be drawn again once the browser restores its
      // context; a context that never returns needs a new canvas.
      stage = "waiting";
      report({ kind: "waiting", for: "context" });
      cancelTimer = environment.setTimer(() => {
        cancelTimer = null;
        // Hidden since the wait began: the browser may well hand the context
        // back once shown, so wait for that rather than replace the canvas.
        if (!environment.visible()) proceed();
        else attemptNow("remount");
      }, NATIVE_RECOVERY_CONTEXT_WAIT_MS);
      return;
    }
    attemptNow(modeFor(attempt + 1));
  }

  return {
    lost(lostApi) {
      if (disposed || stage === "failed") return;
      if (stage === "pending" || stage === "waiting" || stage === "backoff") return;
      const now = environment.now();
      losses = losses.filter((at) => now - at < NATIVE_RECOVERY_LOSS_WINDOW_MS);
      losses.push(now);
      if (losses.length >= NATIVE_RECOVERY_LOSS_LIMIT) {
        generation++;
        fail(new Error("The graphics device keeps resetting"));
        return;
      }
      if (stage === "attempting") { compromised = true; return; }
      api = lostApi;
      contextHandedBack = false;
      attempt = 0;
      stage = "pending";
      report({ kind: "lost" });
      const owner = generation;
      void Promise.resolve().then(() => { if (owner === generation && stage === "pending") proceed(); });
    },
    contextRestored() {
      contextHandedBack = true;
      if (stage === "waiting" && cancelTimer !== null && attempt === 0) attemptNow("swap");
    },
    reset() {
      generation++;
      clearWaits();
      losses = [];
      attempt = 0;
      stage = "running";
      report({ kind: "running" });
    },
    dispose() {
      disposed = true;
      generation++;
      clearWaits();
    },
  };
}
