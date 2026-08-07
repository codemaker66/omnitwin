// ---------------------------------------------------------------------------
// The Convener — behaviour state machine
//
// Pure. The clock is a parameter, never read here, so every behaviour below is
// testable without timers, a DOM, or a rendered portrait. The view layer owns
// the listeners and the rAF; this owns what he does and what he says.
// ---------------------------------------------------------------------------

import {
  CONVENER_DOZE,
  CONVENER_DOZE_AFTER_MS,
  CONVENER_FINAL_POKE_INDEX,
  CONVENER_POKES,
  CONVENER_WAKE,
} from "./convener-lines.js";

export type ConvenerUtteranceKind = "poke" | "doze" | "wake";

export interface ConvenerUtterance {
  readonly text: string;
  readonly kind: ConvenerUtteranceKind;
  /**
   * Monotonic. Two identical consecutive lines still differ by seq, so the
   * speech bubble re-triggers instead of silently swallowing the repeat.
   */
  readonly seq: number;
}

export interface ConvenerState {
  /** Monotonic, clamped at the terminal poke. He never forgets. */
  readonly pokeCount: number;
  readonly dozing: boolean;
  readonly lastActivityMs: number;
  /** When he last woke. Guards the pointerdown→click seam (see poke case). */
  readonly lastWakeAtMs: number;
  readonly utterance: ConvenerUtterance | null;
  readonly seq: number;
}

/**
 * A poke arriving this soon after a wake is the SAME physical interaction:
 * browsers fire pointerdown/keydown (activity → wake) before click (poke),
 * so without this grace the documented "waking is free" rule is unreachable
 * from real input and the wake line is clobbered mid-sentence.
 */
export const WAKE_POKE_GRACE_MS = 900;

export type ConvenerEvent =
  /** The portrait itself was pressed. */
  | { readonly type: "poke" }
  /** Any pointer, key or touch anywhere — proof of life. */
  | { readonly type: "activity" }
  /** The idle timer fired; may or may not push him under. */
  | { readonly type: "tick" };

export function initialConvenerState(nowMs: number): ConvenerState {
  return {
    pokeCount: 0,
    dozing: false,
    lastActivityMs: nowMs,
    lastWakeAtMs: 0,
    utterance: null,
    seq: 0,
  };
}

/** The line for a given poke count, held at the terminal line thereafter. */
export function pokeLine(pokeCount: number): string {
  const index = Math.max(0, Math.min(pokeCount, CONVENER_FINAL_POKE_INDEX));
  return CONVENER_POKES[index] ?? "";
}

function speak(
  state: ConvenerState,
  text: string,
  kind: ConvenerUtteranceKind,
  nowMs: number,
  patch: Partial<ConvenerState> = {},
): ConvenerState {
  const seq = state.seq + 1;
  return {
    ...state,
    ...patch,
    lastActivityMs: nowMs,
    seq,
    utterance: { text, kind, seq },
  };
}

export function reduceConvener(
  state: ConvenerState,
  event: ConvenerEvent,
  nowMs: number,
): ConvenerState {
  switch (event.type) {
    case "poke": {
      // Waking is not a poke. Prodding a sleeping man earns the wake line, and
      // his patience is not spent on it — the escalation resumes where it was.
      if (state.dozing) {
        return speak(state, CONVENER_WAKE, "wake", nowMs, { dozing: false, lastWakeAtMs: nowMs });
      }
      // The click that follows the wake-inducing pointerdown belongs to the
      // SAME prod. Let the wake line play; the escalation waits its turn.
      if (nowMs - state.lastWakeAtMs < WAKE_POKE_GRACE_MS) return state;
      return speak(state, pokeLine(state.pokeCount), "poke", nowMs, {
        pokeCount: Math.min(state.pokeCount + 1, CONVENER_FINAL_POKE_INDEX),
      });
    }
    case "activity": {
      if (state.dozing) {
        return speak(state, CONVENER_WAKE, "wake", nowMs, { dozing: false, lastWakeAtMs: nowMs });
      }
      return { ...state, lastActivityMs: nowMs };
    }
    case "tick": {
      if (state.dozing) return state;
      if (nowMs - state.lastActivityMs < CONVENER_DOZE_AFTER_MS) return state;
      // Dozing off is not activity: lastActivityMs is left alone so the idle
      // span stays readable, and the wake path is what resets it.
      const seq = state.seq + 1;
      return {
        ...state,
        dozing: true,
        seq,
        utterance: { text: CONVENER_DOZE, kind: "doze", seq },
      };
    }
    default:
      return state;
  }
}

/** Clears a consumed utterance without disturbing anything else. */
export function clearUtterance(state: ConvenerState): ConvenerState {
  return state.utterance === null ? state : { ...state, utterance: null };
}
