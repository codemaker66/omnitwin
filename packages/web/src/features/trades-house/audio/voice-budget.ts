// -----------------------------------------------------------------------------
// voice-budget — pure polyphony and repetition state for the pokes (spec
// section 6, "the tap vocabulary"): four voices at once; the third tap on one
// cue inside ten seconds plays at -6 dB and half length; a scene has twenty-
// four full-value plays, after which the room goes quiet rather than dead.
// The clock is injected; nothing here reads the time. The engine applies this
// to the sfx bus only, so the ceremony (ui) and the beds are never refused.
// -----------------------------------------------------------------------------
import { MAX_VOICES, PER_SCENE_PLAY_BUDGET } from "../react/react-types.js";

export { MAX_VOICES, PER_SCENE_PLAY_BUDGET };

export const THIRD_TAP_WINDOW_MS = 10_000;
export const THIRD_TAP_GAIN_DB = -6;

export interface VoiceBudgetState {
  /** End times (ms) of the voices sounding now; pruned as the clock passes them. */
  readonly activeUntilMs: readonly number[];
  /** Start times (ms) of the recent plays of each cue, inside the ten-second window. */
  readonly recentByCue: Readonly<Record<string, readonly number[]>>;
  /** Full-value plays spent this scene. */
  readonly fullPlays: number;
}

export const IDLE_VOICE_BUDGET: VoiceBudgetState = { activeUntilMs: [], recentByCue: {}, fullPlays: 0 };

export type VoiceRefusal = "voices" | "budget";

export interface VoiceAdmission {
  readonly admitted: boolean;
  readonly refusal: VoiceRefusal | null;
  /** 0, or THIRD_TAP_GAIN_DB for a reduced play. */
  readonly gainDb: number;
  readonly halfLength: boolean;
  /** True when the play spent one of the scene's full-value plays. */
  readonly counted: boolean;
}

export interface VoiceVerdict {
  readonly state: VoiceBudgetState;
  readonly admission: VoiceAdmission;
}

const refused = (refusal: VoiceRefusal): VoiceAdmission => ({
  admitted: false,
  refusal,
  gainDb: 0,
  halfLength: false,
  counted: false,
});

/** Ask to sound `cueId` now for `durationMs`. The returned state is the one to keep whether or not it was admitted. */
export function admitVoice(
  state: VoiceBudgetState,
  cueId: string,
  nowMs: number,
  durationMs: number,
): VoiceVerdict {
  const activeUntilMs = state.activeUntilMs.filter((endsAt) => endsAt > nowMs);
  const pruned: VoiceBudgetState = { ...state, activeUntilMs };
  if (activeUntilMs.length >= MAX_VOICES) return { state: pruned, admission: refused("voices") };
  if (state.fullPlays >= PER_SCENE_PLAY_BUDGET) return { state: pruned, admission: refused("budget") };

  const recent = (state.recentByCue[cueId] ?? []).filter((startedAt) => nowMs - startedAt < THIRD_TAP_WINDOW_MS);
  // Two plays already inside the window: this is the third tap.
  const reduced = recent.length >= 2;
  const soundsFor = reduced ? durationMs / 2 : durationMs;
  return {
    state: {
      activeUntilMs: [...activeUntilMs, nowMs + soundsFor],
      recentByCue: { ...state.recentByCue, [cueId]: [...recent, nowMs] },
      fullPlays: state.fullPlays + (reduced ? 0 : 1),
    },
    admission: {
      admitted: true,
      refusal: null,
      gainDb: reduced ? THIRD_TAP_GAIN_DB : 0,
      halfLength: reduced,
      counted: !reduced,
    },
  };
}

/** A scene opened: the budget and the repetition memory start again; voices still sounding carry over. */
export function beginSceneBudget(state: VoiceBudgetState): VoiceBudgetState {
  return { activeUntilMs: state.activeUntilMs, recentByCue: {}, fullPlays: 0 };
}
