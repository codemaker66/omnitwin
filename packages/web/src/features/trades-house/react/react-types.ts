// -----------------------------------------------------------------------------
// react-types — the reaction primitive's contract: every pokeable is a pure
// reducer with the clock injected (idle, touched, answered, tired, asleep;
// generalising convener-state.ts), and react(target, gesture) composes one
// spring, one cue, one caption and an optional aside. Imports nothing from the
// instrument; a source-grep test holds that.
// -----------------------------------------------------------------------------
import type { SpringPresetName } from "../stage/stage-manifest.js";

export type PokeableStage = "idle" | "touched" | "answered" | "tired" | "asleep";

export interface PokeableState {
  readonly stage: PokeableStage;
  /** Total pokes this scene. */
  readonly count: number;
  readonly lastPokeMs: number | null;
  /** Timestamps of the last three pokes, for the third-tap rule (-6 dB and half length within 10 s). */
  readonly recentMs: readonly number[];
  /**
   * Timestamps of the pokes inside the last sixty seconds, oldest first, at
   * most ten: the window the tired (six within 30 s) and asleep (ten within
   * 60 s) stages are counted over. Three timestamps cannot count to six, so
   * the reaction layer added this on 2026-09-06. Optional so a sibling
   * module's literal written against the first contract keeps compiling;
   * absent means empty, and the reducer always writes it.
   */
  readonly burstMs?: readonly number[];
  /**
   * Indices into the prop's `states` of the condition rows ("distinctProps:n",
   * "conditional:<id>") that have fired, so a rare stage fires once a scene.
   * Numeric rows need no memory: `count` only ever rises. Optional for the
   * same reason as `burstMs`.
   */
  readonly firedRows?: readonly number[];
}

export const IDLE_POKEABLE: PokeableState = {
  stage: "idle",
  count: 0,
  lastPokeMs: null,
  recentMs: [],
  burstMs: [],
  firedRows: [],
};

export type PokeGesture = "tap" | "press" | "sweep";

export interface PokeContext {
  readonly nowMs: number;
  /** Pokeables are inert while the scene line is actually playing and the reader has not tapped it away. */
  readonly speaking: boolean;
  /** Distinct props touched so far in the scene; rare stages key on this, never on counts. */
  readonly distinctProps: number;
  /** Persisted conditionals that are true ("conditional:<id>" rows fire on these). */
  readonly conditionals: ReadonlySet<string>;
  readonly reducedMotion: boolean;
}

export interface Reaction {
  readonly next: PokeableState;
  readonly spring: SpringPresetName;
  readonly cue: string | null;
  /** The third tap on one object within ten seconds plays at -6 dB and half length. */
  readonly cueGainDb: number;
  readonly cueHalfLength: boolean;
  readonly caption: string;
  readonly aside: string | null;
  /**
   * Index into the prop's `states`, or null when no row fired (a plain poke).
   * A plain poke between or beyond the authored counts still carries the
   * cue, caption and colour step of the prop's latest numeric row (the water
   * rings on every poke; the toll box's last row is what a bolted box does
   * when pressed), the way convener-state.ts holds its terminal line; the
   * index is null because nothing new happened. Author the last numeric row
   * as the thing's resting reply.
   */
  readonly stageRow: number | null;
  /**
   * The backing row's reduced-motion colour step (a CSS custom-property
   * value), so the stage can turn the transform into one colour change
   * without looking the row up; null when no row backs the poke.
   */
  readonly colorStep: string | null;
  /** True when the poke did nothing but return the speaking caption. */
  readonly inert: boolean;
  /** Haptic pattern in ms, Android only; 0 for none. */
  readonly hapticMs: number;
}

export const SPEAKING_CAPTION = "(he is still speaking)";
export const PER_SCENE_PLAY_BUDGET = 24;
export const MAX_VOICES = 4;
