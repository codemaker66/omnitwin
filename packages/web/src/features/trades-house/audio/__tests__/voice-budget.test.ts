import { describe, expect, it } from "vitest";
import {
  IDLE_VOICE_BUDGET,
  MAX_VOICES,
  PER_SCENE_PLAY_BUDGET,
  THIRD_TAP_GAIN_DB,
  THIRD_TAP_WINDOW_MS,
  admitVoice,
  beginSceneBudget,
  type VoiceBudgetState,
} from "../voice-budget.js";

const DURATION = 300;

/** Play `cueId` `times` times, `gapMs` apart, starting at `fromMs`; returns the final state. */
function playRun(state: VoiceBudgetState, cueId: string, times: number, fromMs: number, gapMs: number): VoiceBudgetState {
  let next = state;
  for (let i = 0; i < times; i += 1) {
    next = admitVoice(next, cueId, fromMs + i * gapMs, DURATION).state;
  }
  return next;
}

describe("voice budget", () => {
  it("carries the contract's numbers: four voices, twenty-four plays, ten seconds, minus six", () => {
    expect(MAX_VOICES).toBe(4);
    expect(PER_SCENE_PLAY_BUDGET).toBe(24);
    expect(THIRD_TAP_WINDOW_MS).toBe(10_000);
    expect(THIRD_TAP_GAIN_DB).toBe(-6);
  });

  it("admits the first play at full value and counts it", () => {
    const { state, admission } = admitVoice(IDLE_VOICE_BUDGET, "chain-swing", 1_000, DURATION);
    expect(admission).toEqual({ admitted: true, refusal: null, gainDb: 0, halfLength: false, counted: true });
    expect(state.fullPlays).toBe(1);
    expect(state.activeUntilMs).toEqual([1_300]);
    expect(state.recentByCue).toEqual({ "chain-swing": [1_000] });
  });

  it("plays the third tap on one cue inside ten seconds at -6 dB and half length, uncounted", () => {
    const twice = playRun(IDLE_VOICE_BUDGET, "water-plunk", 2, 0, 1_000);
    const third = admitVoice(twice, "water-plunk", 2_000, DURATION);
    expect(third.admission).toEqual({ admitted: true, refusal: null, gainDb: -6, halfLength: true, counted: false });
    expect(third.state.fullPlays).toBe(2);
    // Half length sounds for half the time.
    expect(third.state.activeUntilMs).toContain(2_000 + DURATION / 2);
    // A different cue in the same ten seconds is untouched by the rule.
    expect(admitVoice(third.state, "chain-swing", 2_100, DURATION).admission.halfLength).toBe(false);
  });

  it("forgets taps that fall out of the window, so a patient fourth tap is full again", () => {
    const three = playRun(IDLE_VOICE_BUDGET, "water-plunk", 3, 0, 1_000);
    const later = admitVoice(three, "water-plunk", 2_000 + THIRD_TAP_WINDOW_MS, DURATION);
    expect(later.admission.halfLength).toBe(false);
    expect(later.admission.gainDb).toBe(0);
    expect(later.state.recentByCue["water-plunk"]).toEqual([2_000 + THIRD_TAP_WINDOW_MS]);
  });

  it("holds four voices at once and admits again when one ends", () => {
    let state = IDLE_VOICE_BUDGET;
    for (const cue of ["a", "b", "c", "d"]) {
      const verdict = admitVoice(state, cue, 0, DURATION);
      expect(verdict.admission.admitted).toBe(true);
      state = verdict.state;
    }
    const fifth = admitVoice(state, "e", 100, DURATION);
    expect(fifth.admission.admitted).toBe(false);
    expect(fifth.admission.refusal).toBe("voices");
    // The refusal changed no memory.
    expect(fifth.state.fullPlays).toBe(4);
    expect(fifth.state.recentByCue["e"]).toBeUndefined();
    const afterOneEnds = admitVoice(fifth.state, "e", DURATION, DURATION);
    expect(afterOneEnds.admission.admitted).toBe(true);
    expect(afterOneEnds.state.activeUntilMs).toEqual([DURATION * 2]);
  });

  it("refuses every play after the twenty-fourth full-value play until the scene begins again", () => {
    let state = IDLE_VOICE_BUDGET;
    // Twelve cues, two full-value taps each, spaced so nothing overlaps and nothing is a third tap.
    for (let i = 0; i < PER_SCENE_PLAY_BUDGET; i += 1) {
      const verdict = admitVoice(state, `cue-${String(i % 12)}`, i * 1_000, DURATION);
      expect(verdict.admission.counted).toBe(true);
      state = verdict.state;
    }
    expect(state.fullPlays).toBe(PER_SCENE_PLAY_BUDGET);
    const refused = admitVoice(state, "cue-0", 30_000, DURATION);
    expect(refused.admission.admitted).toBe(false);
    expect(refused.admission.refusal).toBe("budget");
    // A tap that would have been reduced is refused too: the room is quiet, not merely softer.
    const reducedToo = admitVoice(state, "cue-0", 12_500, DURATION);
    expect(reducedToo.admission.admitted).toBe(false);
    const fresh = admitVoice(beginSceneBudget(refused.state), "cue-0", 30_000, DURATION);
    expect(fresh.admission.admitted).toBe(true);
    expect(fresh.state.fullPlays).toBe(1);
  });

  it("beginSceneBudget keeps the voices still sounding and drops the repetition memory", () => {
    const state = playRun(IDLE_VOICE_BUDGET, "chain-swing", 3, 0, 50);
    const next = beginSceneBudget(state);
    expect(next.activeUntilMs).toEqual(state.activeUntilMs);
    expect(next.recentByCue).toEqual({});
    expect(next.fullPlays).toBe(0);
  });

  it("is pure: the input state is never mutated", () => {
    const state: VoiceBudgetState = { activeUntilMs: [500], recentByCue: { a: [0] }, fullPlays: 1 };
    admitVoice(state, "a", 100, DURATION);
    admitVoice(state, "b", 100, DURATION);
    beginSceneBudget(state);
    expect(state).toEqual({ activeUntilMs: [500], recentByCue: { a: [0] }, fullPlays: 1 });
    expect(IDLE_VOICE_BUDGET).toEqual({ activeUntilMs: [], recentByCue: {}, fullPlays: 0 });
  });
});
