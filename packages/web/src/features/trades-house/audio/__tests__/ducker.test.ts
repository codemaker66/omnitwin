import { describe, expect, it } from "vitest";
import {
  DUCK_FULL,
  DUCK_PRE,
  DUCK_RELEASED,
  DUCK_WAITING,
  DUCK_WAITING_LIFT_DB,
  IDLE_DUCKER,
  PAUSE_RELEASE_HOLD_MS,
  reduceDucker,
  type DuckerState,
} from "../ducker.js";

const after = (...events: Parameters<typeof reduceDucker>[1][]): DuckerState =>
  events.reduce((state, event) => reduceDucker(state, event).state, IDLE_DUCKER);

describe("ducker", () => {
  it("pre-ducks the ambience alone on play, because the play event fires before any sound exists", () => {
    const result = reduceDucker(IDLE_DUCKER, "play");
    expect(result.state.phase).toBe("preduck");
    expect(result.command).toEqual({ targets: DUCK_PRE, holdMs: 0 });
    expect(DUCK_PRE.musicDb).toBe(0);
    expect(DUCK_PRE.sfxDb).toBe(0);
    expect(DUCK_PRE.ambienceDb).toBeLessThan(0);
  });

  it("ducks music (and the pokes) on playing, and does not re-apply on a repeated playing", () => {
    const first = reduceDucker(after("play"), "playing");
    expect(first.state.phase).toBe("ducked");
    expect(first.command).toEqual({ targets: DUCK_FULL, holdMs: 0 });
    expect(DUCK_FULL.musicDb).toBeLessThan(DUCK_PRE.musicDb);
    expect(reduceDucker(first.state, "playing").command).toBeNull();
  });

  it("un-ducks 3 dB on waiting and returns to the full duck when playing resumes", () => {
    const waiting = reduceDucker(after("play", "playing"), "waiting");
    expect(waiting.state.phase).toBe("waiting");
    expect(waiting.command?.targets).toEqual(DUCK_WAITING);
    expect(DUCK_WAITING.ambienceDb).toBe(DUCK_FULL.ambienceDb + DUCK_WAITING_LIFT_DB);
    expect(DUCK_WAITING.musicDb).toBe(DUCK_FULL.musicDb + DUCK_WAITING_LIFT_DB);
    expect(DUCK_WAITING.sfxDb).toBe(DUCK_FULL.sfxDb + DUCK_WAITING_LIFT_DB);
    expect(DUCK_WAITING_LIFT_DB).toBe(3);
    const back = reduceDucker(waiting.state, "playing");
    expect(back.state.phase).toBe("ducked");
    expect(back.command?.targets).toEqual(DUCK_FULL);
  });

  it("holds the release 250 ms after a pause, so a src swap never lets the room breathe", () => {
    const paused = reduceDucker(after("play", "playing"), "pause");
    expect(paused.state.phase).toBe("paused");
    expect(paused.command).toEqual({ targets: DUCK_RELEASED, holdMs: PAUSE_RELEASE_HOLD_MS });
    expect(PAUSE_RELEASE_HOLD_MS).toBe(250);
  });

  it("a play after a pause re-asserts the full duck at once, which is what cancels the held release", () => {
    const swapped = reduceDucker(after("play", "playing", "pause"), "play");
    expect(swapped.state.phase).toBe("ducked");
    expect(swapped.command).toEqual({ targets: DUCK_FULL, holdMs: 0 });
  });

  it("releases fully and immediately on ended, from any phase", () => {
    for (const phase of [after("play"), after("play", "playing"), after("play", "playing", "waiting"), after("play", "playing", "pause")]) {
      const ended = reduceDucker(phase, "ended");
      expect(ended.state.phase).toBe("idle");
      expect(ended.command).toEqual({ targets: DUCK_RELEASED, holdMs: 0 });
    }
  });

  it("ignores events that change nothing audible", () => {
    expect(reduceDucker(IDLE_DUCKER, "pause").command).toBeNull();
    expect(reduceDucker(IDLE_DUCKER, "ended").command).toBeNull();
    expect(reduceDucker(IDLE_DUCKER, "waiting").command).toBeNull();
    expect(reduceDucker(after("play"), "play").command).toBeNull();
    expect(reduceDucker(after("play", "playing", "pause"), "pause").command).toBeNull();
  });

  it("is pure: the same state and event give the same result and the inputs are untouched", () => {
    const state: DuckerState = { phase: "ducked" };
    const a = reduceDucker(state, "pause");
    const b = reduceDucker(state, "pause");
    expect(a).toEqual(b);
    expect(state).toEqual({ phase: "ducked" });
    expect(IDLE_DUCKER).toEqual({ phase: "idle" });
  });
});
