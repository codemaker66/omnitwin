// -----------------------------------------------------------------------------
// pokeable-reducer — the pure life of one thing on the stage: idle, touched,
// answered, tired, asleep. It generalises convener-state.ts (the man who
// dozes and wakes) to every pokeable. The clock is a parameter, so every
// behaviour is testable without timers; nothing here imports the instrument,
// and a source-grep test holds that. react.ts composes the reaction from the
// state this returns; the SVG planes read it to draw.
//
// The stages, by their stated conditions and nothing else:
//   idle      nothing has touched it this scene
//   touched   the first poke
//   answered  from the second poke
//   tired     from the sixth poke inside thirty seconds
//   asleep    from the tenth poke inside a minute; it wakes after twenty
//             seconds of quiet, and the poke that finds it awake is a poke
//             like any other
// Tired and asleep are counted over a sliding window, never over the total,
// so a patient reader who pokes a thing every few seconds all scene long
// never tires it: only drumming does.
// -----------------------------------------------------------------------------
import type { PokeableStage, PokeableState, PokeContext } from "./react-types.js";

/** The second poke: the thing has been answered, not merely touched. */
export const ANSWERED_AT = 2;
/** The sixth poke inside thirty seconds: tired. */
export const TIRED_AT = 6;
export const TIRED_WINDOW_MS = 30_000;
/** The tenth poke inside a minute: asleep. */
export const ASLEEP_AT = 10;
export const ASLEEP_WINDOW_MS = 60_000;
/** Twenty seconds without a poke and a sleeping thing wakes. */
export const WAKE_AFTER_MS = 20_000;
/** How many timestamps `recentMs` keeps: the third-tap rule needs three. */
export const RECENT_KEEP = 3;
/** The third tap on one thing inside this window plays at -6 dB and half length (react.ts). */
export const THIRD_TAP_WINDOW_MS = 10_000;

function countWithin(timestamps: readonly number[], nowMs: number, windowMs: number): number {
  let n = 0;
  for (const t of timestamps) {
    if (nowMs - t <= windowMs) n += 1;
  }
  return n;
}

/** True when a sleeping thing has had its twenty seconds of quiet. */
export function hasWoken(state: PokeableState, nowMs: number): boolean {
  return (
    state.stage === "asleep" &&
    state.lastPokeMs !== null &&
    nowMs - state.lastPokeMs >= WAKE_AFTER_MS
  );
}

/**
 * The stage as a plane should draw it now. A sleeping thing that has had its
 * quiet is awake before anyone pokes it again, and the plane can show that
 * without a store write; every other stage is what the last poke left.
 */
export function effectiveStage(state: PokeableState, nowMs: number): PokeableStage {
  return hasWoken(state, nowMs) ? "answered" : state.stage;
}

/**
 * One poke. Returns the same object while the scene line plays (a poke then
 * is inert, and react.ts answers with the speaking caption). Otherwise the
 * count and the last-three timestamps advance on every poke, sleeping or not,
 * because a poke is a poke and the count is honest; only an awake thing adds
 * to the burst window, because sleep is measured from the last poke and only
 * quiet ends it.
 */
export function reducePoke(state: PokeableState, ctx: PokeContext): PokeableState {
  if (ctx.speaking) return state;
  const nowMs = ctx.nowMs;
  const count = state.count + 1;
  const recentMs = [...state.recentMs, nowMs].slice(-RECENT_KEEP);
  const woken = hasWoken(state, nowMs);

  if (state.stage === "asleep" && !woken) {
    return { ...state, count, lastPokeMs: nowMs, recentMs };
  }

  // Waking resets the burst: the quiet was real, and the thing must not fall
  // straight back asleep on the strength of pokes it already slept off.
  const priorBurst = woken
    ? []
    : (state.burstMs ?? []).filter((t) => nowMs - t <= ASLEEP_WINDOW_MS);
  const burstMs = [...priorBurst, nowMs].slice(-ASLEEP_AT);

  let stage: PokeableStage;
  if (burstMs.length >= ASLEEP_AT) {
    // Every entry is inside the minute, so the length is the count within it.
    stage = "asleep";
  } else if (countWithin(burstMs, nowMs, TIRED_WINDOW_MS) >= TIRED_AT) {
    stage = "tired";
  } else if (count >= ANSWERED_AT) {
    stage = "answered";
  } else {
    stage = "touched";
  }

  return {
    stage,
    count,
    lastPokeMs: nowMs,
    recentMs,
    burstMs,
    firedRows: state.firedRows ?? [],
  };
}
