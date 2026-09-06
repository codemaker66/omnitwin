// -----------------------------------------------------------------------------
// scheduler — the scene's random one-shots (a rope creak every 20 to 40 s,
// gulls at most twice a minute) from the manifest's `audio.oneShots`. Only
// the NEXT event per one-shot is ever scheduled, on the context clock, so a
// suspended context never accumulates a backlog and a resumed one picks up
// where it stood. The generator is seeded and deterministic: the same seed
// gives the same creaks for everyone, and Math.random() never appears where
// the fairness lint looks.
// -----------------------------------------------------------------------------
import type { OneShot } from "../stage/stage-manifest.js";
import type { QuizAudioEngine } from "./audio-types.js";
import { scheduleOnWallClock, type Schedule } from "./timers.js";

/** mulberry32: 32-bit state, uniform in [0, 1), good enough for a creak and small enough to read. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When the next event for `shot` falls, on whatever clock `nowMs` was read from. */
export function planNextOneShot(shot: OneShot, nowMs: number, random: () => number): number {
  const span = Math.max(0, shot.everyMsMax - shot.everyMsMin);
  return nowMs + shot.everyMsMin + Math.floor(random() * span);
}

export interface OneShotPlan {
  readonly cue: string;
  readonly atMs: number;
}

export interface OneShotSchedulerDeps {
  readonly seed: number;
  /** The context clock in ms. Defaults to the engine's context; 0 before unlock. */
  readonly nowMs?: () => number;
  /** The wall-clock timer; a test drives one by hand. */
  readonly schedule?: Schedule;
}

export interface OneShotScheduler {
  /** Plans one event per one-shot and arms it. Calling again replaces the plan. */
  start(oneShots: readonly OneShot[]): void;
  stop(): void;
  readonly running: boolean;
  /** The next planned event per one-shot, for tests and the poke-budget harness. */
  readonly pending: readonly OneShotPlan[];
}

/** A wall timer that lands this much before its context time waited on a stopped clock; it re-arms instead of firing. */
export const CLOCK_SLOP_MS = 20;

interface Armed {
  readonly shot: OneShot;
  atMs: number;
  cancel: (() => void) | null;
}

export function createOneShotScheduler(
  engine: Pick<QuizAudioEngine, "play" | "context">,
  deps: OneShotSchedulerDeps,
): OneShotScheduler {
  const nowMs = deps.nowMs ?? ((): number => (engine.context?.currentTime ?? 0) * 1000);
  const schedule = deps.schedule ?? scheduleOnWallClock;
  const random = createSeededRandom(deps.seed);
  let armed: Armed[] = [];

  const arm = (entry: Armed): void => {
    const delay = Math.max(0, entry.atMs - nowMs());
    entry.cancel = schedule(() => {
      entry.cancel = null;
      const now = nowMs();
      if (now < entry.atMs - CLOCK_SLOP_MS) {
        // The context clock stood still (suspended tab, interrupted route)
        // while the wall clock ran on: wait out the rest on the real clock.
        arm(entry);
        return;
      }
      engine.play(entry.shot.cue);
      entry.atMs = planNextOneShot(entry.shot, now, random);
      arm(entry);
    }, delay);
  };

  const stop = (): void => {
    for (const entry of armed) {
      if (entry.cancel !== null) entry.cancel();
      entry.cancel = null;
    }
    armed = [];
  };

  return {
    start(oneShots) {
      stop();
      const now = nowMs();
      armed = oneShots.map((shot) => ({ shot, atMs: planNextOneShot(shot, now, random), cancel: null }));
      for (const entry of armed) arm(entry);
    },
    stop,
    get running() {
      return armed.length > 0;
    },
    get pending() {
      return armed.map((entry) => ({ cue: entry.shot.cue, atMs: entry.atMs }));
    },
  };
}
