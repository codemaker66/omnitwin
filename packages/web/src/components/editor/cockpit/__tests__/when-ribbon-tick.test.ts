import { describe, expect, it, vi } from "vitest";
import {
  createSnapTick,
  readTickPreference,
  TICK_PREFERENCE_KEY,
  writeTickPreference,
  type TickAudio,
  type TickGain,
  type TickOscillator,
} from "../../../../lib/sound-registry.js";

// The opt-in tick (goal 19 S6): off until asked for, remembered on the device,
// one audio context made lazily on the first snap.

function memoryStore(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> & { readonly data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

function fakeAudio(state: AudioContextState = "running") {
  const frequencySet = vi.fn();
  const gainSet = vi.fn();
  const gainRamp = vi.fn();
  const start = vi.fn();
  const stop = vi.fn();
  const oscillator: TickOscillator = {
    type: "sine",
    frequency: { setValueAtTime: frequencySet, exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    start,
    stop,
  };
  const gain: TickGain = { gain: { setValueAtTime: gainSet, exponentialRampToValueAtTime: gainRamp }, connect: vi.fn() };
  const createOscillator = vi.fn(() => oscillator);
  const resume = vi.fn(() => Promise.resolve());
  const audio: TickAudio = { currentTime: 1.5, destination: {}, state, createOscillator, createGain: () => gain, resume };
  return { audio, oscillator, createOscillator, frequencySet, gainRamp, start, stop, resume };
}

describe("the tick preference", () => {
  it("is off by default, on only when the device says so, and survives a store that throws", () => {
    expect(readTickPreference(memoryStore())).toBe(false);
    expect(readTickPreference(memoryStore({ [TICK_PREFERENCE_KEY]: "on" }))).toBe(true);
    expect(readTickPreference(memoryStore({ [TICK_PREFERENCE_KEY]: "off" }))).toBe(false);
    expect(readTickPreference(null)).toBe(false);
    expect(readTickPreference({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })).toBe(false);
  });

  it("is written as on or off, and a refusing store is tolerated", () => {
    const store = memoryStore();
    writeTickPreference(true, store);
    expect(store.data[TICK_PREFERENCE_KEY]).toBe("on");
    writeTickPreference(false, store);
    expect(store.data[TICK_PREFERENCE_KEY]).toBe("off");
    expect(() => { writeTickPreference(true, { getItem: () => null, setItem: () => { throw new Error("full"); } }); }).not.toThrow();
  });
});

describe("createSnapTick", () => {
  it("makes the audio context once, on the first tick, and plays a short quiet triangle", () => {
    const made = fakeAudio();
    const factory = vi.fn(() => made.audio);
    const tick = createSnapTick(factory);
    expect(factory).not.toHaveBeenCalled();
    tick();
    tick();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(made.createOscillator).toHaveBeenCalledTimes(2);
    expect(made.oscillator.type).toBe("triangle");
    expect(made.frequencySet).toHaveBeenCalledWith(1200, 1.5);
    expect(made.gainRamp).toHaveBeenCalledWith(0.05, 1.502);
    expect(made.start).toHaveBeenCalledWith(1.5);
    expect(made.stop).toHaveBeenCalledWith(1.545);
    expect(made.resume).not.toHaveBeenCalled();
  });

  it("wakes a suspended context and stays silent where there is no audio at all", () => {
    const made = fakeAudio("suspended");
    createSnapTick(() => made.audio)();
    expect(made.resume).toHaveBeenCalledTimes(1);
    const silent = createSnapTick(() => null);
    expect(() => { silent(); silent(); }).not.toThrow();
  });
});
