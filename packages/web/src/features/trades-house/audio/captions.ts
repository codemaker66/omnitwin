// -----------------------------------------------------------------------------
// captions — the store behind the one aria-live="polite" region (spec section
// 6 and law 10). Captions are coalesced: the first in a quiet spell shows at
// once, so a single poke reads in the same frame as its spring and cue; any
// that follow inside 750 ms are held and only the last one is published when
// the window closes, so a poke storm reads as one caption every 750 ms rather
// than a screen reader interrupted twenty times. While the voice plays the
// region is silent: the line is the feedback, and a caption over it would
// talk across him. The timer is injected; nothing here reads the clock.
// -----------------------------------------------------------------------------
import { scheduleOnWallClock, type Schedule } from "./timers.js";

export const CAPTION_DEBOUNCE_MS = 750;

export interface CaptionSnapshot {
  readonly text: string;
  /** Increments on every publish, so an identical caption twice still re-announces. */
  readonly seq: number;
}

export interface CaptionStoreDeps {
  /** The wall-clock timer; a test drives one by hand. */
  readonly schedule?: Schedule;
}

export interface CaptionStore {
  announce(text: string): void;
  setVoicePlaying(playing: boolean): void;
  readonly voicePlaying: boolean;
  /**
   * `subscribe` and `getSnapshot` are function-typed properties, not methods:
   * `useSyncExternalStore` calls them unbound, so they must not depend on
   * `this` (and declaring them as methods trips
   * `@typescript-eslint/unbound-method` at every call site).
   */
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CaptionSnapshot;
  dispose(): void;
}

const EMPTY: CaptionSnapshot = { text: "", seq: 0 };

export function createCaptionStore(deps: CaptionStoreDeps = {}): CaptionStore {
  const schedule = deps.schedule ?? scheduleOnWallClock;
  const listeners = new Set<() => void>();
  let snapshot: CaptionSnapshot = EMPTY;
  /** Cancels the open quiet window, or null when none is open. */
  let quietWindow: (() => void) | null = null;
  let held: string | null = null;
  let voicePlaying = false;
  let disposed = false;

  const publish = (text: string): void => {
    snapshot = { text, seq: snapshot.seq + 1 };
    for (const listener of [...listeners]) listener();
  };

  const closeWindow = (): void => {
    quietWindow = null;
    if (held === null) return;
    const text = held;
    held = null;
    publish(text);
    quietWindow = schedule(closeWindow, CAPTION_DEBOUNCE_MS);
  };

  return {
    announce(text) {
      if (disposed || voicePlaying) return;
      if (quietWindow !== null) {
        held = text;
        return;
      }
      publish(text);
      quietWindow = schedule(closeWindow, CAPTION_DEBOUNCE_MS);
    },
    setVoicePlaying(playing) {
      voicePlaying = playing;
      // A caption held for the window's close would arrive under the line: dropped.
      if (playing) held = null;
    },
    get voicePlaying() {
      return voicePlaying;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    dispose() {
      disposed = true;
      if (quietWindow !== null) quietWindow();
      quietWindow = null;
      held = null;
      listeners.clear();
    },
  };
}
