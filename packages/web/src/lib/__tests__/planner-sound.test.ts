import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_SOUND_IDS,
  PLANNER_SOUND_RECIPES,
  hourPitchHz,
  varyRecipe,
  type PlannerSoundId,
} from "../planner-sound-recipes.js";
import { energyShareAbove, peakDbfs, renderPlannerSound, soundingLengthMs } from "../planner-sound-render.js";
import {
  PLANNER_LIMITER,
  PLANNER_SOUND_DEFAULT_LEVEL,
  PLANNER_SOUND_DEFAULT_MODE,
  PLANNER_SOUND_LEVEL_KEY,
  PLANNER_SOUND_STORAGE_KEY,
  PlannerSoundPolicy,
  SOUND_REGISTRY,
  __resetPlannerSoundForTests,
  armPlannerSound,
  getPlannerSoundSettings,
  limiterMakeupDb,
  playPlannerSound,
  setPlannerSoundMode,
  togglePlannerSoundMute,
  type PlannerSoundGate,
} from "../sound-registry.js";

// ---------------------------------------------------------------------------
// The planner's sound palette (T-671, slice 3; spec section 9). The renders
// are the samples that play, so their peak, length and silence above 5 kHz are
// measured here; then the rules (Off, Quiet, Full, the gesture, a hidden tab,
// the 45 ms gap, eight a second, a burst of three), and the engine on a
// stand-in context: what it starts, the mute's 30 ms fade, Lay out's cascade.
// ---------------------------------------------------------------------------

describe("each planner sound, rendered", () => {
  it.each(PLANNER_SOUND_IDS)("%s peaks at its level, lasts its length and says nothing above 5 kHz", (id) => {
    const recipe = PLANNER_SOUND_RECIPES[id];
    const samples = renderPlannerSound(recipe);
    expect(Math.abs(peakDbfs(samples) - recipe.peakDb), "peak at its level").toBeLessThanOrEqual(0.1);
    // Measured to the deepest its own voices fall (the snap falls to −80 dB by 40 ms).
    const floorDb = Math.min(-60, ...recipe.voices.map((voice) => (voice.kind === "tone" ? 20 * Math.log10(voice.floor ?? 0.001) : -60)));
    const length = soundingLengthMs(samples, 48000, floorDb);
    expect(length, "no shorter than its length").toBeGreaterThanOrEqual(recipe.lengthMs * 0.8);
    expect(length, "no longer than its length").toBeLessThanOrEqual(recipe.lengthMs * 1.15);
    expect(energyShareAbove(samples, 5000), "energy above 5 kHz").toBeLessThan(0.005);
    // A sound of tones alone has nothing up there at all (the snap's triangle keeps its harmonics below 5 kHz).
    if (recipe.voices.every((voice) => voice.kind === "tone")) {
      expect(energyShareAbove(samples, 5000), "a tone's energy above 5 kHz").toBeLessThan(0.00001);
    }
  });

  it("renders the same samples from the same seed", () => {
    const recipe = PLANNER_SOUND_RECIPES["planner-set-table"];
    expect(renderPlannerSound(recipe, { seed: 7 })).toEqual(renderPlannerSound(recipe, { seed: 7 }));
  });

  // Peaks only. The ear's balance (spec 9: touch sounds within 6 dB of each other, the rare
  // moments at most 6 dB above) is measured on Chromium's renders, A- and K-weighted, in the
  // slice's evidence and settled by the ear test; peaks alone do not show it.
  it("holds the set-downs' peaks within 6 dB of each other and the rare moments' peaks no more than 6 dB above them", () => {
    const setDowns = (["planner-set-table", "planner-set-chair"] as const).map((id) => PLANNER_SOUND_RECIPES[id].peakDb);
    expect(Math.max(...setDowns) - Math.min(...setDowns)).toBeLessThanOrEqual(6);
    for (const hero of ["planner-horizon", "planner-send", "planner-present", "planner-act"] as const) {
      expect(PLANNER_SOUND_RECIPES[hero].peakDb - Math.max(...setDowns), hero).toBeLessThanOrEqual(6);
    }
  });

  it("raises the hour from 330 Hz on the horizon to 660 Hz overhead", () => {
    expect(hourPitchHz(-10)).toBe(330);
    expect(hourPitchHz(0)).toBe(330);
    expect(hourPitchHz(45)).toBeCloseTo(330 * Math.SQRT2, 6);
    expect(hourPitchHz(90)).toBe(660);
  });

  it("glides the horizon up at sunrise and down at sunset", () => {
    const horizon = PLANNER_SOUND_RECIPES["planner-horizon"];
    const rising = varyRecipe(horizon, { glide: 0.05 }).voices[0];
    const setting = varyRecipe(horizon, { glide: -0.05 }).voices[0];
    expect(rising?.kind === "tone" ? rising.toHz : null).toBeCloseTo(147 * 1.05, 6);
    expect(setting?.kind === "tone" ? setting.toHz : null).toBeCloseTo(147 * 0.95, 6);
  });
});

describe("the planner palette in the registry", () => {
  it("registers every planner sound as a choice kept on this device", () => {
    for (const id of PLANNER_SOUND_IDS) {
      const definition = SOUND_REGISTRY[id];
      expect(definition.optIn).toBe("device-toggle");
      expect(definition.storageKey).toBe(PLANNER_SOUND_STORAGE_KEY);
    }
  });

  it("is off until someone chooses (decision D1 is Blake's), at the design's level", () => {
    expect(PLANNER_SOUND_DEFAULT_MODE).toBe("off");
    expect(PLANNER_SOUND_DEFAULT_LEVEL).toBe(0.6);
  });
});

describe("the rules a sound must pass", () => {
  const gate = (overrides: Partial<PlannerSoundGate> = {}): PlannerSoundGate => ({ mode: "full", armed: true, hidden: false, nowMs: 1000, ...overrides });

  it("plays nothing when off, nothing from the full set in Quiet, nothing before a gesture and nothing in a hidden tab", () => {
    const policy = new PlannerSoundPolicy();
    expect(policy.decide("planner-set-table", gate({ mode: "off" }))).toBe("off");
    expect(policy.decide("planner-lift", gate({ mode: "quiet" }))).toBe("not-in-set");
    expect(policy.decide("planner-set-table", gate({ mode: "quiet" }))).toBe("play");
    expect(policy.decide("planner-set-table", gate({ armed: false }))).toBe("not-armed");
    expect(policy.decide("planner-set-table", gate({ hidden: true }))).toBe("hidden");
  });

  it("keeps a sound at least 45 ms from itself, a refusal 600 ms and a snap to eight a second", () => {
    const policy = new PlannerSoundPolicy();
    const at = (ms: number, id: PlannerSoundId): string => policy.decide(id, gate({ nowMs: ms }));
    policy.record("planner-set-table", 0);
    expect(at(30, "planner-set-table")).toBe("too-soon");
    expect(at(46, "planner-set-table")).toBe("play");
    policy.record("planner-refuse", 0);
    expect(at(400, "planner-refuse")).toBe("too-soon");
    expect(at(601, "planner-refuse")).toBe("play");
    policy.record("planner-snap", 600);
    expect(at(700, "planner-snap")).toBe("too-soon");
    expect(at(726, "planner-snap")).toBe("play");
  });

  it("lets no more than eight play in a second", () => {
    const policy = new PlannerSoundPolicy();
    const ids = ["planner-set-table", "planner-set-chair", "planner-cue", "planner-lift", "planner-snap", "planner-measure", "planner-hour", "planner-brush", "planner-act"] as const;
    ids.forEach((id, index) => {
      const nowMs = index * 100;
      if (index < 8) {
        expect(policy.decide(id, gate({ nowMs })), id).toBe("play");
        policy.record(id, nowMs);
      } else {
        expect(policy.decide(id, gate({ nowMs }))).toBe("too-many");
      }
    });
  });

  it("keeps only the first three of a burst within 250 ms", () => {
    const policy = new PlannerSoundPolicy();
    const ids = ["planner-set-table", "planner-set-chair", "planner-cue", "planner-lift"] as const;
    ids.forEach((id, index) => {
      const nowMs = index * 50;
      const verdict = policy.decide(id, gate({ nowMs }));
      if (index < 3) {
        expect(verdict, id).toBe("play");
        policy.record(id, nowMs);
      } else {
        expect(verdict).toBe("burst");
      }
    });
    expect(policy.decide("planner-lift", gate({ nowMs: 400 }))).toBe("play");
  });
});

// A stand-in context that records what the engine builds and starts.
class FakeParam {
  value = 0;
  readonly events: string[] = [];
  setValueAtTime(value: number, at: number): this { this.value = value; this.events.push(`set ${String(value)} @${String(at)}`); return this; }
  linearRampToValueAtTime(value: number, at: number): this { this.events.push(`ramp ${String(Math.round(value * 1000) / 1000)} @${String(at)}`); return this; }
  cancelScheduledValues(at: number): this { this.events.push(`cancel @${String(at)}`); return this; }
}
class FakeNode {
  readonly connections: unknown[] = [];
  connect(node: unknown): unknown { this.connections.push(node); return node; }
  disconnect(): void { /* nothing to release */ }
}
class FakeGain extends FakeNode { readonly gain = new FakeParam(); }
class FakeBuffer {
  readonly data: Float32Array;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) { this.data = new Float32Array(length); }
  getChannelData(): Float32Array { return this.data; }
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  constructor(private readonly owner: FakeContext) { super(); }
  start(at = 0): void { this.startedAt = at; this.owner.started.push(this); }
}
class FakeConvolver extends FakeNode { buffer: FakeBuffer | null = null; normalize = true; }
class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  readonly knee = new FakeParam();
}
class FakeContext {
  state: "running" | "suspended" = "running";
  currentTime = 2;
  readonly sampleRate = 48000;
  readonly destination = new FakeNode();
  readonly started: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer { return new FakeBuffer(channels, length, rate); }
  createBufferSource(): FakeSource { return new FakeSource(this); }
  createConvolver(): FakeConvolver { return new FakeConvolver(); }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(); }
  resume(): Promise<void> { this.state = "running"; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = "suspended"; return Promise.resolve(); }
}

describe("the engine", () => {
  let context: FakeContext;
  let made = 0;
  let options: unknown[] = [];

  beforeEach(() => {
    localStorage.clear();
    __resetPlannerSoundForTests();
    context = new FakeContext();
    made = 0;
    options = [];
    // The registry's own factory makes the context, as in a browser: `new AudioContext(...)` gets the stand-in.
    vi.stubGlobal("AudioContext", function StandInAudioContext(given: unknown) {
      made += 1;
      options.push(given);
      return context;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetPlannerSoundForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("makes nothing and plays nothing while sound is off, even after a gesture", () => {
    expect(armPlannerSound()).toBe(false);
    expect(playPlannerSound("planner-set-table")).toBe(false);
    expect(made).toBe(0);
  });

  it("plays nothing before the first gesture, then plays the quiet set", () => {
    setPlannerSoundMode("quiet");
    expect(playPlannerSound("planner-set-table")).toBe(false);
    expect(armPlannerSound()).toBe(true);
    expect(options, "one context, made for interaction (spec 9)").toEqual([{ latencyHint: "interactive" }]);
    expect(playPlannerSound("planner-set-table")).toBe(true);
    expect(context.started).toHaveLength(1);
    expect(context.started[0]?.startedAt).toBe(2);
    expect(playPlannerSound("planner-lift"), "the lift is in the full set only").toBe(false);
  });

  it("takes back the limiter's makeup gain, so the palette's levels are what plays", () => {
    // Web Audio's compressor lifts everything by the inverse of its curve at 0 dBFS, to the power 0.6.
    expect(limiterMakeupDb(PLANNER_LIMITER.thresholdDb, PLANNER_LIMITER.ratio)).toBeCloseTo(6.6, 10);
    expect(limiterMakeupDb(-24, 4)).toBeCloseTo(10.8, 10);
    setPlannerSoundMode("quiet");
    armPlannerSound();
    const trim = context.gains.find((gain) => gain.connections.includes(context.destination));
    expect(trim, "the last gain before the speakers").toBeDefined();
    expect(20 * Math.log10(trim?.gain.value ?? 0)).toBeCloseTo(-6.6, 6);
  });

  it("is silent in a hidden tab", () => {
    setPlannerSoundMode("full");
    armPlannerSound();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(playPlannerSound("planner-snap")).toBe(false);
    expect(context.started).toHaveLength(0);
  });

  it("mutes with a 30 ms fade on Shift M, and brings back what was muted", () => {
    setPlannerSoundMode("full");
    armPlannerSound();
    const master = context.gains.find((gain) => gain.connections.some((node) => node instanceof FakeCompressor));
    expect(togglePlannerSoundMute()).toBe("off");
    expect(master?.gain.events).toContain("ramp 0 @2.03");
    expect(togglePlannerSoundMute()).toBe("full");
    expect(master?.gain.events.at(-1)).toBe(`ramp ${String(PLANNER_SOUND_DEFAULT_LEVEL)} @2.03`);
  });

  it("plays Lay out's brush in Quiet as three set-downs 55 ms apart, each 4 dB down", () => {
    setPlannerSoundMode("quiet");
    armPlannerSound();
    expect(playPlannerSound("planner-brush")).toBe(true);
    expect(context.started.map((source) => source.startedAt)).toEqual([2, 2.055, 2.11]);
    const levels = context.started.map((source) => {
      const gain = source.connections[0];
      return gain instanceof FakeGain ? Math.round(20 * Math.log10(gain.gain.value) * 10) / 10 : null;
    });
    expect(levels).toEqual([-4, -4, -4]);
  });

  it("sends the rare moments through the hall and keeps the touch sounds dry", () => {
    setPlannerSoundMode("quiet");
    armPlannerSound();
    playPlannerSound("planner-send");
    const sendGain = context.started[0]?.connections[0];
    expect(sendGain instanceof FakeGain ? sendGain.connections.length : 0, "dry and hall").toBe(2);
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    playPlannerSound("planner-cue");
    const cueGain = context.started[1]?.connections[0];
    expect(cueGain instanceof FakeGain ? cueGain.connections.length : 0, "dry only").toBe(1);
  });

  it("suspends the context after 20 s of silence", () => {
    vi.useFakeTimers();
    setPlannerSoundMode("quiet");
    armPlannerSound();
    playPlannerSound("planner-cue");
    vi.advanceTimersByTime(19_999);
    expect(context.state).toBe("running");
    vi.advanceTimersByTime(2);
    expect(context.state).toBe("suspended");
  });

  it("keeps the choice on this device, and works when the device keeps nothing", () => {
    setPlannerSoundMode("full");
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("full");
    __resetPlannerSoundForTests();
    expect(getPlannerSoundSettings().mode).toBe("full");
    localStorage.setItem(PLANNER_SOUND_LEVEL_KEY, "not a number");
    __resetPlannerSoundForTests();
    expect(getPlannerSoundSettings().level).toBe(PLANNER_SOUND_DEFAULT_LEVEL);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    __resetPlannerSoundForTests();
    expect(getPlannerSoundSettings()).toEqual({ mode: PLANNER_SOUND_DEFAULT_MODE, level: PLANNER_SOUND_DEFAULT_LEVEL });
  });
});
