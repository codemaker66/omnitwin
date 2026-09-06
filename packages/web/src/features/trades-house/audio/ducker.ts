// -----------------------------------------------------------------------------
// ducker — a pure reducer over the voice element's events, producing the
// duck targets the engine applies to the ambience, music and sfx buses
// (spec section 6). No clock, no timers: the one time-shaped rule (a release
// held 250 ms after a pause so a src swap never lets the room breathe) is
// expressed as a hold the engine schedules on the audio clock, and a `play`
// inside that hold re-asserts the full duck, which cancels the pending
// release. The voice's `play` event fires before any sound exists, so only the
// ambience pre-ducks on it; music waits for `playing`.
// -----------------------------------------------------------------------------
import type { DuckTargets, VoiceEvent } from "./audio-types.js";

export type DuckPhase = "idle" | "preduck" | "ducked" | "waiting" | "paused";

export interface DuckerState {
  readonly phase: DuckPhase;
}

export const IDLE_DUCKER: DuckerState = { phase: "idle" };

export interface DuckCommand {
  readonly targets: DuckTargets;
  /** Milliseconds the engine waits before the targets apply. Only the pause release carries one. */
  readonly holdMs: number;
}

export interface DuckerResult {
  readonly state: DuckerState;
  /** Null when the event changes nothing audible (a repeated `playing`, a `pause` while idle). */
  readonly command: DuckCommand | null;
}

export const DUCK_RELEASED: DuckTargets = { ambienceDb: 0, musicDb: 0, sfxDb: 0 };
/** `play`: the line is coming; the room starts down before the first syllable. */
export const DUCK_PRE: DuckTargets = { ambienceDb: -3, musicDb: 0, sfxDb: 0 };
/** `playing`: he is speaking. Pokes under a reply sit at -9 dB (spec section 5). */
export const DUCK_FULL: DuckTargets = { ambienceDb: -6, musicDb: -9, sfxDb: -9 };
/** `waiting`: the line is buffering; the room comes up 3 dB so the pause is not dead air. */
export const DUCK_WAITING_LIFT_DB = 3;
export const DUCK_WAITING: DuckTargets = {
  ambienceDb: DUCK_FULL.ambienceDb + DUCK_WAITING_LIFT_DB,
  musicDb: DUCK_FULL.musicDb + DUCK_WAITING_LIFT_DB,
  sfxDb: DUCK_FULL.sfxDb + DUCK_WAITING_LIFT_DB,
};
/** A `pause` followed by a `play` inside this window is a src swap, not the end of a line. */
export const PAUSE_RELEASE_HOLD_MS = 250;

const immediate = (phase: DuckPhase, targets: DuckTargets): DuckerResult => ({
  state: { phase },
  command: { targets, holdMs: 0 },
});

const unchanged = (state: DuckerState): DuckerResult => ({ state, command: null });

export function reduceDucker(state: DuckerState, event: VoiceEvent): DuckerResult {
  switch (event) {
    case "play":
      switch (state.phase) {
        case "idle":
          return immediate("preduck", DUCK_PRE);
        case "paused":
        case "waiting":
          // A src swap, or a stall that resumed: the line is still on, so the
          // full duck returns at once and cancels any release still pending.
          return immediate("ducked", DUCK_FULL);
        case "preduck":
        case "ducked":
          return unchanged(state);
      }
      break;
    case "playing":
      return state.phase === "ducked" ? unchanged(state) : immediate("ducked", DUCK_FULL);
    case "waiting":
      switch (state.phase) {
        case "preduck":
        case "ducked":
          return immediate("waiting", DUCK_WAITING);
        case "idle":
        case "paused":
        case "waiting":
          return unchanged(state);
      }
      break;
    case "pause":
      if (state.phase === "idle" || state.phase === "paused") return unchanged(state);
      return { state: { phase: "paused" }, command: { targets: DUCK_RELEASED, holdMs: PAUSE_RELEASE_HOLD_MS } };
    case "ended":
      return state.phase === "idle" ? unchanged(state) : immediate("idle", DUCK_RELEASED);
  }
  return unchanged(state);
}
