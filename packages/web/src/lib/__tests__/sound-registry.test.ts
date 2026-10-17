import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  __resetChimeForTests,
  createSnapTick,
  isChimeEnabled,
  isRegisteredSound,
  playActivationClick,
  playArcOpenSound,
  playArrivalChime,
  readTickPreference,
  requestSound,
  setChimeEnabled,
  setToolbarMuted,
  SOUND_REGISTRY,
  subscribeSoundAttempts,
  type SoundAttempt,
} from "../sound-registry.js";

// Every sound is registered, opt-in and off by default, and nothing makes a
// sound outside the registry.

class CountingAudioContext {
  static started = 0;
  readonly currentTime = 0;
  readonly state = "running";
  readonly destination = {};
  resume(): Promise<void> { return Promise.resolve(); }
  createGain(): { gain: { setValueAtTime(): void; linearRampToValueAtTime(): void; exponentialRampToValueAtTime(): void }; connect(): void } {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  createOscillator(): { type: OscillatorType; frequency: { setValueAtTime(): void; exponentialRampToValueAtTime(): void }; connect(): void; start(): void; stop(): void } {
    return { type: "sine", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() { CountingAudioContext.started += 1; }, stop() {} };
  }
}

let attempts: SoundAttempt[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  CountingAudioContext.started = 0;
  attempts = [];
  unsubscribe = subscribeSoundAttempts((attempt) => { attempts.push(attempt); });
  __resetChimeForTests();
  setToolbarMuted(true);
  vi.stubGlobal("AudioContext", CountingAudioContext);
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the registry gate", () => {
  it("refuses an id that is not registered and reports it", () => {
    expect(requestSound("rogue-beep")).toBe(false);
    expect(isRegisteredSound("rogue-beep")).toBe(false);
    expect(isRegisteredSound("toString")).toBe(false);
    expect(attempts).toEqual([{ id: "rogue-beep", admitted: false }]);
  });

  it("admits each registered id", () => {
    for (const id of Object.keys(SOUND_REGISTRY)) expect(requestSound(id)).toBe(true);
  });

  it("states how each sound is turned on, and every device-level choice has a key", () => {
    for (const definition of Object.values(SOUND_REGISTRY)) {
      expect(["session-toggle", "device-toggle"]).toContain(definition.optIn);
      if (definition.optIn === "device-toggle") expect(definition.storageKey).not.toBeNull();
    }
  });

  it("only ever plays registered ids, and every player is silent until opted in", () => {
    expect(isChimeEnabled()).toBe(false);
    expect(readTickPreference()).toBe(false);
    expect(playArrivalChime()).toBe(false);
    playArcOpenSound(3);
    playActivationClick(1);
    expect(CountingAudioContext.started).toBe(0);

    setToolbarMuted(false);
    setChimeEnabled(true);
    playArcOpenSound(3);
    playActivationClick(1);
    expect(playArrivalChime()).toBe(true);
    createSnapTick(() => new CountingAudioContext())();

    expect(CountingAudioContext.started).toBeGreaterThan(0);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((attempt) => attempt.admitted && isRegisteredSound(attempt.id))).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.id))).toEqual(
      new Set(["toolbar-tick", "toolbar-click", "arrival-chime", "snap-tick"]),
    );
  });
});

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      found.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

describe("no sound outside the registry", () => {
  it("keeps Web Audio inside lib/sound-registry.ts", () => {
    const srcRoot = join(__dirname, "..", "..");
    const registry = join("lib", "sound-registry.ts");
    const offenders = sourceFiles(srcRoot)
      .filter((file) => relative(srcRoot, file) !== registry)
      .filter((file) => /\b(AudioContext|createOscillator|createBufferSource|webkitAudioContext)\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
