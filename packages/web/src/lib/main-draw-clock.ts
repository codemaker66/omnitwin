// ---------------------------------------------------------------------------
// The main view's draws, as they happen
//
// NativeCanvas paces its automatic main-view draws by the GPU's progress
// (native-frame-pacer.ts): a frame update whose GPU work would queue behind
// unfinished frames updates the scene but draws nothing, and the draw follows
// once the GPU catches up. The frames a viewer sees are the draws, not the
// updates, so the frame-rate governor listens for them here.
// ---------------------------------------------------------------------------

/** Called with the time (performance.now(), ms) a main-view draw began. */
export type MainDrawListener = (startedAtMs: number) => void;

const listeners = new Set<MainDrawListener>();

/** Listens for successful main-view draws; returns the unsubscribe. */
export function onMainDraw(listener: MainDrawListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called by NativeCanvas after each successful automatic main-view draw. */
export function noteMainDraw(startedAtMs: number): void {
  for (const listener of listeners) listener(startedAtMs);
}
