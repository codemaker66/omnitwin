// -----------------------------------------------------------------------------
// interruptions — what the platform does to a running context, answered
// (spec section 6). A phone call, a route change or an autoplay policy
// suspends the context: resume on `statechange`, and if that is refused
// outside a gesture, on the next pointerdown. A hidden tab: the beds hold at
// silence and come back on return. AirPods mid-run change the output's
// sample rate: the engine rebuilds on a fresh context from the bytes it kept,
// and this adapter re-binds to the new one. Detach with the returned
// function; every listener is removed.
// -----------------------------------------------------------------------------
import type { MixerContext, QuizAudioEngine } from "./audio-types.js";

export interface InterruptionTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface InterruptionEnv {
  readonly document: InterruptionTarget & { readonly visibilityState: DocumentVisibilityState };
  readonly window: InterruptionTarget;
}

const noop = (): undefined => undefined;

export function attachInterruptions(
  engine: Pick<QuizAudioEngine, "rebuild" | "setBedsHeld">,
  context: MixerContext,
  env: InterruptionEnv = { document, window },
): () => void {
  let current = context;
  let sampleRate = context.sampleRate;
  let pointerArmed = false;
  let rebuilding = false;
  let detached = false;

  const resumeIfNeeded = (): void => {
    if (current.state === "running" || current.state === "closed") return;
    void current.resume().catch(noop);
  };

  const onPointerDown = (): void => {
    pointerArmed = false;
    if (detached) return;
    resumeIfNeeded();
    checkSampleRate();
  };

  const armPointer = (): void => {
    if (pointerArmed) return;
    pointerArmed = true;
    env.window.addEventListener("pointerdown", onPointerDown, { once: true, passive: true });
  };

  const rebind = (next: MixerContext): void => {
    current.removeEventListener("statechange", onStateChange);
    current = next;
    sampleRate = next.sampleRate;
    next.addEventListener("statechange", onStateChange);
    if (next.state !== "running") armPointer();
  };

  const checkSampleRate = (): void => {
    if (rebuilding || current.sampleRate === sampleRate) return;
    rebuilding = true;
    void engine
      .rebuild()
      .then((next) => {
        if (detached || next === null) return;
        rebind(next);
      })
      .catch(noop)
      .finally(() => {
        rebuilding = false;
      });
  };

  function onStateChange(): void {
    if (detached) return;
    checkSampleRate();
    if (current.state === "running" || current.state === "closed") return;
    resumeIfNeeded();
    armPointer();
  }

  const onVisibilityChange = (): void => {
    if (detached) return;
    if (env.document.visibilityState === "hidden") {
      engine.setBedsHeld(true);
      return;
    }
    engine.setBedsHeld(false);
    checkSampleRate();
    resumeIfNeeded();
    if (current.state !== "running") armPointer();
  };

  current.addEventListener("statechange", onStateChange);
  env.document.addEventListener("visibilitychange", onVisibilityChange);
  if (current.state !== "running") armPointer();

  return () => {
    detached = true;
    current.removeEventListener("statechange", onStateChange);
    env.document.removeEventListener("visibilitychange", onVisibilityChange);
    if (pointerArmed) env.window.removeEventListener("pointerdown", onPointerDown);
    pointerArmed = false;
  };
}
