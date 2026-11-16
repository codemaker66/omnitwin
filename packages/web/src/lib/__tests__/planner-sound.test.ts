import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_SOUND_IDS,
  PLANNER_SOUND_RECIPES,
  hourPitchHz,
  varyRecipe,
  type PlannerSoundId,
} from "../planner-sound-recipes.js";
import {
  energyShareAbove,
  fft,
  peakDbfs,
  renderPlannerSound,
  seededRandom,
  soundingLengthMs,
} from "../planner-sound-render.js";
import { SET_DOWN_TOUCH_DB } from "../set-down/render.js";
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
// stand-in context: what it starts and the mute's 30 ms fade. A piece set down
// is the set-down engine's own render (planner-set-down-sound.test.ts).
// ---------------------------------------------------------------------------

/** The transform as it was before its twiddle factors were cached, working each one out in its butterfly. */
function uncachedFft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0; re[i] = re[j] ?? 0; re[j] = tr;
      const ti = im[i] ?? 0; im[i] = im[j] ?? 0; im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(step * k), wi = Math.sin(step * k);
        const a = start + k, b = a + size / 2;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr; im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr; im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

describe("the fft", () => {
  // 131,072 points is above the cache's largest size, 65,536, so its factors are built afresh on every call (ruling R52).
  it.each([8, 1024, 2048, 131072])("equals the uncached formula bit for bit at %i points, on a first call and a second", (n) => {
    const random = seededRandom(n);
    const inputRe = Float64Array.from({ length: n }, () => 2 * random() - 1);
    const inputIm = Float64Array.from({ length: n }, () => 2 * random() - 1);
    const expectedRe = Float64Array.from(inputRe);
    const expectedIm = Float64Array.from(inputIm);
    uncachedFft(expectedRe, expectedIm);
    // Twice: the first call may build the table, the second reads it from the cache (or, above the cache's size, builds it again).
    for (let pass = 0; pass < 2; pass += 1) {
      const re = Float64Array.from(inputRe);
      const im = Float64Array.from(inputIm);
      fft(re, im);
      let differing = 0;
      for (let i = 0; i < n; i += 1) {
        if (!Object.is(re[i], expectedRe[i]) || !Object.is(im[i], expectedIm[i])) differing += 1;
      }
      expect(differing).toBe(0);
    }
  });
});

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
    // The cue's contact is a breath of noise, so its samples depend on the seed.
    const recipe = PLANNER_SOUND_RECIPES["planner-cue"];
    expect(renderPlannerSound(recipe, { seed: 7 })).toEqual(renderPlannerSound(recipe, { seed: 7 }));
  });

  // Peaks only. The ear's balance (spec 9: the rare moments at most 6 dB above the set-downs)
  // is measured on Chromium's renders, A- and K-weighted, in the slice's evidence and settled
  // by the ear test; peaks alone do not show it. The set-downs are the engine's, anchored at
  // its touch level (lib/set-down/render.ts).
  it("holds the rare moments' peaks no more than 6 dB above the set-downs' touch level", () => {
    for (const hero of ["planner-horizon", "planner-send", "planner-present", "planner-act"] as const) {
      expect(PLANNER_SOUND_RECIPES[hero].peakDb, hero).toBeLessThanOrEqual(SET_DOWN_TOUCH_DB + 6);
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
    for (const id of [...PLANNER_SOUND_IDS, "planner-set-down"] as const) {
      const definition = SOUND_REGISTRY[id];
      expect(definition.optIn).toBe("device-toggle");
      expect(definition.storageKey).toBe(PLANNER_SOUND_STORAGE_KEY);
    }
  });

  it("is Quiet by default, armed by the first deliberate gesture (Blake's D1, 25 Oct), at the design's level", () => {
    expect(PLANNER_SOUND_DEFAULT_MODE).toBe("quiet");
    expect(PLANNER_SOUND_DEFAULT_LEVEL).toBe(0.6);
  });
});

describe("the rules a sound must pass", () => {
  const gate = (overrides: Partial<PlannerSoundGate> = {}): PlannerSoundGate => ({ mode: "full", armed: true, hidden: false, nowMs: 1000, ...overrides });

  it("plays nothing when off, nothing from the full set in Quiet, nothing before a gesture and nothing in a hidden tab", () => {
    const policy = new PlannerSoundPolicy();
    expect(policy.decide("planner-set-down", gate({ mode: "off" }))).toBe("off");
    expect(policy.decide("planner-lift", gate({ mode: "quiet" }))).toBe("not-in-set");
    expect(policy.decide("planner-set-down", gate({ mode: "quiet" })), "a set-down is in the quiet set").toBe("play");
    expect(policy.decide("planner-set-down", gate({ armed: false }))).toBe("not-armed");
    expect(policy.decide("planner-set-down", gate({ hidden: true }))).toBe("hidden");
  });

  it("keeps a sound at least 45 ms from itself, a refusal 600 ms and a snap to eight a second", () => {
    const policy = new PlannerSoundPolicy();
    const at = (ms: number, id: PlannerSoundId | "planner-set-down"): string => policy.decide(id, gate({ nowMs: ms }));
    policy.record("planner-set-down", 0);
    expect(at(30, "planner-set-down")).toBe("too-soon");
    expect(at(46, "planner-set-down")).toBe("play");
    policy.record("planner-refuse", 0);
    expect(at(400, "planner-refuse")).toBe("too-soon");
    expect(at(601, "planner-refuse")).toBe("play");
    policy.record("planner-snap", 600);
    expect(at(700, "planner-snap")).toBe("too-soon");
    expect(at(726, "planner-snap")).toBe("play");
  });

  it("lets no more than eight play in a second", () => {
    const policy = new PlannerSoundPolicy();
    const ids = ["planner-set-down", "planner-refuse", "planner-cue", "planner-lift", "planner-snap", "planner-measure", "planner-hour", "planner-horizon", "planner-act"] as const;
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
    const ids = ["planner-set-down", "planner-refuse", "planner-cue", "planner-lift"] as const;
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
    setPlannerSoundMode("off");
    expect(armPlannerSound()).toBe(false);
    expect(playPlannerSound("planner-refuse")).toBe(false);
    expect(made).toBe(0);
  });

  it("plays nothing before the first gesture, then plays the quiet set", () => {
    setPlannerSoundMode("quiet");
    expect(playPlannerSound("planner-refuse")).toBe(false);
    expect(armPlannerSound()).toBe(true);
    expect(options, "one context, made for interaction (spec 9)").toEqual([{ latencyHint: "interactive" }]);
    expect(playPlannerSound("planner-refuse"), "Quiet includes the refusal (R82)").toBe(true);
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
