import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbToGain } from "../planner-sound-render.js";
import type { Stereo } from "../set-down/tail.js";
import {
  PLANNER_LIMITER_WARMUP_SECONDS,
  PLANNER_ROOM_CROSSFADE_SECONDS,
  PLANNER_ROOM_RELEASE_SECONDS,
  PLANNER_SOUND_SILENCE_SUSPEND_MS,
  __resetPlannerSoundForTests,
  armPlannerSound,
  beginSetDownBatch,
  clearPlannerRoomTail,
  logSetDownDrop,
  plannerAudioClock,
  setPlannerRoomTail,
  setPlannerSoundMode,
  subscribePlannerSoundArmed,
  wakePlannerSound,
  type SetDownVoice,
} from "../sound-registry.js";

// ---------------------------------------------------------------------------
// The registry plays set-downs through the room (T-700, Task 13). A landing's
// voices are admitted as one batch; each voice is a unit-gain stereo render
// through its level, a dry gain for its distance into the master and a send,
// never scaled by distance, into the room bus (R57, R58). The room bus feeds
// the room's own tail, cross-faded when it changes (R62). Nothing starts
// before the limiter has warmed up (R63), a long session eases the level
// (R26), a suspended context is woken and played on its resumed clock (Review
// Focus 1), and ?soundtap=1 keeps a log of what played.
// ---------------------------------------------------------------------------

interface ParamEvent {
  readonly kind: "set" | "ramp" | "cancel";
  readonly value: number;
  readonly at: number;
}

class FakeParam {
  /** A GainNode's gain starts at 1. */
  value = 1;
  readonly events: ParamEvent[] = [];
  setValueAtTime(value: number, at: number): this { this.value = value; this.events.push({ kind: "set", value, at }); return this; }
  linearRampToValueAtTime(value: number, at: number): this { this.events.push({ kind: "ramp", value, at }); return this; }
  cancelScheduledValues(at: number): this { this.events.push({ kind: "cancel", value: Number.NaN, at }); return this; }
}

class FakeNode {
  readonly connections: unknown[] = [];
  /** What each disconnect() let go of: a node, or "all". */
  readonly disconnections: unknown[] = [];
  connect<T>(node: T): T { this.connections.push(node); return node; }
  disconnect(node?: unknown): void { this.disconnections.push(node ?? "all"); }
}

class FakeGain extends FakeNode { readonly gain = new FakeParam(); }

class FakeBuffer {
  private readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
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

class FakeStreamDestination extends FakeNode { readonly stream = {}; }

class FakeContext {
  /** "interrupted" is Safari's: a call or another app took the audio. */
  state: "running" | "suspended" | "interrupted" = "running";
  currentTime = 1;
  outputLatency: number | undefined = 0.012;
  baseLatency: number | undefined = 0.005;
  readonly destination = new FakeNode();
  readonly started: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly convolvers: FakeConvolver[] = [];
  readonly streams: FakeStreamDestination[] = [];
  resumes = 0;
  private answerResume: (() => void) | null = null;
  private refuseResume: ((reason: Error) => void) | null = null;
  constructor(readonly sampleRate = 48000) {}
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer { return new FakeBuffer(channels, length, rate); }
  createBufferSource(): FakeSource { return new FakeSource(this); }
  createConvolver(): FakeConvolver { const convolver = new FakeConvolver(); this.convolvers.push(convolver); return convolver; }
  createDynamicsCompressor(): FakeCompressor { return new FakeCompressor(); }
  createMediaStreamDestination(): FakeStreamDestination { const stream = new FakeStreamDestination(); this.streams.push(stream); return stream; }
  /** The device answers when the test says so (finishResume). */
  resume(): Promise<void> {
    this.resumes += 1;
    return new Promise((resolve, reject) => {
      this.answerResume = () => { this.state = "running"; resolve(); };
      this.refuseResume = reject;
    });
  }
  /** The device answers the pending resume; its clock runs on from where it stopped, `advance` later. */
  finishResume(advance = 0): void {
    this.currentTime += advance;
    this.answerResume?.();
    this.answerResume = null;
    this.refuseResume = null;
  }
  /** The device refuses the pending resume. */
  failResume(): void {
    this.refuseResume?.(new Error("the device would not resume"));
    this.answerResume = null;
    this.refuseResume = null;
  }
  suspend(): Promise<void> { this.state = "suspended"; return Promise.resolve(); }
}

/** A short stereo signal whose two channels differ, so a copy can be checked sample for sample. */
function stereo(sampleRate: number, seed: number, length = 64): Stereo {
  const left = Float32Array.from({ length }, (_, i) => Math.sin((i + 1) * seed) / 4);
  const right = Float32Array.from({ length }, (_, i) => Math.cos((i + 1) * seed) / 4);
  return { left, right, sampleRate };
}

function voice(overrides: Partial<SetDownVoice> = {}): SetDownVoice {
  return { render: { ...stereo(48000, 1), onsetSeconds: 0 }, startAt: 1.1, levelDb: 0, directGain: 1, send: 0.8, ...overrides };
}

function levelDbOf(source: FakeSource): number {
  const level = source.connections[0];
  if (!(level instanceof FakeGain)) throw new Error("a voice's source feeds its level gain");
  return 20 * Math.log10(level.gain.value);
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

let context: FakeContext;
let nowMs = 10_000;

beforeEach(() => {
  localStorage.clear();
  __resetPlannerSoundForTests();
  context = new FakeContext();
  nowMs = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  vi.stubGlobal("AudioContext", function StandInAudioContext() {
    return context;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetPlannerSoundForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

function master(): FakeGain {
  const found = context.gains.find((gain) => gain.connections.some((node) => node instanceof FakeCompressor));
  if (found === undefined) throw new Error("no master: the context is not armed");
  return found;
}

/** The gain that feeds `convolver`: for a room tail, the room bus. */
function feeding(convolver: FakeConvolver | undefined): FakeGain {
  const found = context.gains.find((gain) => convolver !== undefined && gain.connections.includes(convolver));
  if (found === undefined) throw new Error("nothing feeds that convolver");
  return found;
}

function fadeAfter(convolver: FakeConvolver | undefined): FakeGain {
  const fade = convolver?.connections[0];
  if (!(fade instanceof FakeGain)) throw new Error("a room convolver feeds its fade");
  return fade;
}

describe("a batch of set-downs", () => {
  it("is refused before the first gesture, when sound is off, and for no voices", () => {
    expect(beginSetDownBatch(1), "Quiet by default, but nothing armed yet").toBeNull();
    armPlannerSound();
    expect(beginSetDownBatch(0)).toBeNull();
    setPlannerSoundMode("off");
    expect(beginSetDownBatch(1)).toBeNull();
    expect(context.started).toHaveLength(0);
  });

  it("starts each voice as a two-channel source at its startAt, through its level, a dry gain to the master and a send to the room bus", () => {
    armPlannerSound();
    expect(setPlannerRoomTail(stereo(48000, 7, 256), "grand-hall/empty")).toBe(true);
    const roomBus = feeding(context.convolvers[1]);
    const batch = beginSetDownBatch(3);
    expect(batch).not.toBeNull();
    const voices = [
      voice({ render: { ...stereo(48000, 2), onsetSeconds: 0 }, startAt: 1.011, levelDb: 0, directGain: 0.5, send: 0.8288978 }),
      voice({ render: { ...stereo(48000, 3), onsetSeconds: 0.004 }, startAt: 1.1, levelDb: -1, directGain: 1 / 3, send: 0.8288978 }),
      voice({ render: { ...stereo(48000, 4), onsetSeconds: 0 }, startAt: 1.2, levelDb: -2, directGain: 1, send: 0.9793057 }),
    ];
    for (const played of voices) expect(batch?.play(played)).toBe(true);
    expect(context.started.map((source) => source.startedAt)).toEqual([1.011, 1.1, 1.2]);
    voices.forEach((played, index) => {
      const source = context.started[index];
      expect(source?.startedAt ?? 0, "never before the limiter has warmed up").toBeGreaterThanOrEqual(PLANNER_LIMITER_WARMUP_SECONDS);
      expect(source?.buffer?.numberOfChannels).toBe(2);
      expect(source?.buffer?.getChannelData(0)).toEqual(played.render.left);
      expect(source?.buffer?.getChannelData(1)).toEqual(played.render.right);
      expect(source?.connections).toHaveLength(1);
      const level = source?.connections[0];
      if (!(level instanceof FakeGain)) throw new Error("the source feeds its level gain");
      expect(level.gain.value).toBeCloseTo(dbToGain(played.levelDb), 12);
      expect(level.connections).toHaveLength(2);
      const dry = level.connections.find((node) => node instanceof FakeGain && node.connections.includes(master()));
      const send = level.connections.find((node) => node instanceof FakeGain && node.connections.includes(roomBus));
      if (!(dry instanceof FakeGain) || !(send instanceof FakeGain)) throw new Error("the level feeds a dry gain to the master and a send to the room bus");
      expect(dry.gain.value, "the distance falls on the dry gain alone (R57)").toBe(played.directGain);
      expect(send.gain.value, "the send is the room's (R58)").toBe(played.send);
      if (played.directGain !== 1) {
        expect(Math.abs(send.gain.value - played.send * played.directGain), "the send is never scaled by distance").toBeGreaterThan(0.1);
      }
    });
  });

  it("holds a cascade in the limiter's first 0.25 s back as a whole, keeping its spacing, as the page does (R63, R75)", () => {
    // A Lay out pressed just after arming: the first contact at context time 0.1,
    // a 4.7 ms lead, and voices 0, 95 and 190 ms on, each played at its own contact.
    context.currentTime = 0.1;
    armPlannerSound();
    const batch = beginSetDownBatch(3);
    const lead = 0.0047;
    for (const offset of [0, 0.095, 0.19]) {
      context.currentTime = 0.1 + offset;
      nowMs += offset * 1000;
      expect(batch?.play(voice({ startAt: context.currentTime + lead }))).toBe(true);
    }
    expect(PLANNER_LIMITER_WARMUP_SECONDS).toBe(0.25);
    // page.ts: now = max(currentTime, 0.25) = 0.25, then start = now + lead + offset.
    const starts = context.started.map((source) => source.startedAt ?? Number.NaN);
    expect(starts).toHaveLength(3);
    [0.2547, 0.3497, 0.4447].forEach((expected, index) => { expect(starts[index]).toBeCloseTo(expected, 9); });
  });

  it("measures a made-suspended context's warm-up once its first resume settles, so a slow resume keeps the cascade's spacing (R63, R75)", async () => {
    // Safari makes the context suspended, and its clock stands at 0 until the
    // first resume settles. The same Lay out: a 4.7 ms lead and voices 0, 95
    // and 190 ms on, each played at its own contact, on the frozen clock.
    context.state = "suspended";
    context.currentTime = 0;
    armPlannerSound();
    const batch = beginSetDownBatch(3);
    const lead = 0.0047;
    for (const offset of [0, 0.095, 0.19]) {
      nowMs = 10_000 + offset * 1000;
      expect(batch?.play(voice({ startAt: context.currentTime + lead }))).toBe(true);
    }
    expect(context.started, "nothing is scheduled on a stopped clock").toHaveLength(0);
    // A slow first resume: it settles 300 ms after the first contact, the clock 4 ms on.
    nowMs = 10_300;
    context.finishResume(0.004);
    await flushPromises();
    // As the page on a running clock: max(currentTime, 0.25) + lead + offset.
    const starts = context.started.map((source) => source.startedAt ?? Number.NaN);
    expect(starts).toHaveLength(3);
    [0.2547, 0.3497, 0.4447].forEach((expected, index) => { expect(starts[index]).toBeCloseTo(expected, 9); });
  });

  it("keeps the spacing when a made-suspended context's resume settles mid-batch, for the voices played after it too", async () => {
    context.state = "suspended";
    context.currentTime = 0;
    armPlannerSound();
    const batch = beginSetDownBatch(3);
    const lead = 0.0047;
    for (const offset of [0, 0.095]) {
      nowMs = 10_000 + offset * 1000;
      expect(batch?.play(voice({ startAt: context.currentTime + lead }))).toBe(true);
    }
    nowMs = 10_150;
    context.finishResume(0.004);
    await flushPromises();
    // The third contact, 40 ms after the resume, on the running clock.
    nowMs = 10_190;
    context.currentTime = 0.044;
    expect(batch?.play(voice({ startAt: context.currentTime + lead }))).toBe(true);
    const starts = context.started.map((source) => source.startedAt ?? Number.NaN);
    expect(starts).toHaveLength(3);
    [0.2547, 0.3497, 0.4447].forEach((expected, index) => { expect(starts[index]).toBeCloseTo(expected, 9); });
  });

  it("adds no warm-up for the wait when the clock had passed 0.25 s before it stopped: each voice keeps what is left of its lead, as before", async () => {
    context.currentTime = 0.3;
    armPlannerSound();
    context.state = "interrupted";
    const batch = beginSetDownBatch(2);
    expect(batch?.play(voice({ startAt: 0.3047 }))).toBe(true);
    nowMs += 900;
    expect(batch?.play(voice({ startAt: 0.3047 }))).toBe(true);
    nowMs += 100;
    context.finishResume();
    await flushPromises();
    expect(context.started.map((source) => source.startedAt)).toEqual([0.3, 0.3]);
  });

  it("keeps the warm-up floor for a voice aimed before it on a context already past it", () => {
    context.currentTime = 0;
    armPlannerSound();
    context.currentTime = 0.3;
    expect(beginSetDownBatch(1)?.play(voice({ startAt: 0.2 }))).toBe(true);
    expect(context.started.map((source) => source.startedAt)).toEqual([0.25]);
  });

  it("refuses a second batch 30 ms after the first: a set-down waits 45 ms after itself", () => {
    armPlannerSound();
    expect(beginSetDownBatch(1)).not.toBeNull();
    nowMs += 30;
    expect(beginSetDownBatch(1)).toBeNull();
    nowMs += 16;
    expect(beginSetDownBatch(1), "46 ms after the first").not.toBeNull();
  });

  it("counts a batch as its voices, so after a batch of eight nothing more plays within the second", () => {
    armPlannerSound();
    expect(beginSetDownBatch(8)).not.toBeNull();
    nowMs += 300;
    expect(beginSetDownBatch(1), "too many in a second").toBeNull();
    nowMs += 701;
    expect(beginSetDownBatch(1), "a second and a millisecond after the eight").not.toBeNull();
  });

  /** How many of `count` voices a batch admitted now will play. */
  function admitted(count: number): number {
    const batch = beginSetDownBatch(count);
    let played = 0;
    while (batch?.play(voice({ startAt: 1.1 + played * 0.1 })) === true) played += 1;
    return played;
  }

  it("admits no more than eight plays in a second across batches: 2, then 8 at 46 ms, plays 6 of the 8", () => {
    armPlannerSound();
    expect(admitted(2)).toBe(2);
    nowMs += 46;
    expect(admitted(8)).toBe(6);
    expect(context.started).toHaveLength(8);
  });

  it("admits no more than eight plays in a second across batches: 7, then 8 at 251 ms, plays 1 of the 8", () => {
    armPlannerSound();
    expect(admitted(7)).toBe(7);
    nowMs += 251;
    expect(admitted(8)).toBe(1);
    expect(context.started).toHaveLength(8);
    nowMs += 100;
    expect(beginSetDownBatch(1), "eight in the last second").toBeNull();
  });

  it("plays its own count, at most eight, for 1.5 s", () => {
    armPlannerSound();
    const batch = beginSetDownBatch(12);
    const played = Array.from({ length: 9 }, (_, index) => batch?.play(voice({ startAt: 1.1 + index * 0.1 })));
    expect(played).toEqual([true, true, true, true, true, true, true, true, false]);
    nowMs += 2000;
    const later = beginSetDownBatch(2);
    expect(later?.play(voice())).toBe(true);
    nowMs += 1501;
    expect(later?.play(voice()), "the batch has lapsed").toBe(false);
  });

  it("is refused in a hidden tab, and a batch stops playing when the tab is hidden", () => {
    armPlannerSound();
    const batch = beginSetDownBatch(2);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(batch?.play(voice())).toBe(false);
    nowMs += 1000;
    expect(beginSetDownBatch(1)).toBeNull();
    visibility.mockReturnValue("visible");
    expect(beginSetDownBatch(1)).not.toBeNull();
    expect(context.started).toHaveLength(0);
  });

  it("stops playing when sound is turned off mid-batch", () => {
    armPlannerSound();
    const batch = beginSetDownBatch(3);
    expect(batch?.play(voice({ startAt: 1.1 }))).toBe(true);
    setPlannerSoundMode("off");
    expect(batch?.play(voice({ startAt: 1.2 }))).toBe(false);
    expect(context.started).toHaveLength(1);
  });

  it("eases a long session's set-downs to under -2.9 dB by the 31st, never more than 1 dB from one voice to the next (R26)", () => {
    armPlannerSound();
    for (let play = 1; play <= 31; play += 1) {
      nowMs += 1000;
      const batch = beginSetDownBatch(1);
      expect(batch, `batch ${String(play)}`).not.toBeNull();
      expect(batch?.play(voice({ levelDb: 0 }))).toBe(true);
    }
    const levels = context.started.map(levelDbOf);
    expect(levels).toHaveLength(31);
    expect(levels.slice(0, 20).every((db) => Math.abs(db) < 1e-9), "nothing changes for the first 20").toBe(true);
    expect(levels[30]).toBeLessThan(-2.9);
    for (let i = 1; i < levels.length; i += 1) {
      expect(Math.abs((levels[i] ?? 0) - (levels[i - 1] ?? 0))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("a suspended context", () => {
  it("is woken once however often it is asked, and a wake plays nothing", () => {
    armPlannerSound();
    context.state = "suspended";
    wakePlannerSound();
    wakePlannerSound();
    expect(context.resumes).toBe(1);
    expect(context.started).toHaveLength(0);
  });

  it("is not woken before the first gesture, or when sound is off", () => {
    wakePlannerSound();
    armPlannerSound();
    context.state = "suspended";
    setPlannerSoundMode("off");
    wakePlannerSound();
    expect(context.resumes).toBe(0);
  });

  it("restarts the 20 s silence timer on a wake", () => {
    vi.useFakeTimers();
    armPlannerSound();
    expect(beginSetDownBatch(1)?.play(voice())).toBe(true);
    vi.advanceTimersByTime(15_000);
    wakePlannerSound();
    vi.advanceTimersByTime(PLANNER_SOUND_SILENCE_SUSPEND_MS - 5_000);
    expect(context.state, "20 s after the play, but 15 s after the wake").toBe("running");
    vi.advanceTimersByTime(5_001);
    expect(context.state).toBe("suspended");
  });

  it("plays a set-down that lands while it sleeps once the resume settles, on the resumed clock (Review Focus 1)", async () => {
    armPlannerSound();
    context.state = "suspended";
    wakePlannerSound();
    const batch = beginSetDownBatch(2);
    expect(batch?.play(voice({ startAt: 1.011 })), "admitted while the context wakes").toBe(true);
    expect(context.resumes, "the play waits on the wake's resume").toBe(1);
    expect(context.started, "nothing is scheduled on a stopped clock").toHaveLength(0);
    nowMs += 5;
    context.finishResume(0.004);
    await flushPromises();
    expect(context.started).toHaveLength(1);
    // Aimed 11 ms ahead; 5 ms went on waking, so it starts 6 ms after the resumed clock.
    expect(context.started[0]?.startedAt).toBeCloseTo(1.004 + 0.006, 9);
    expect(context.started[0]?.startedAt ?? 0).toBeGreaterThanOrEqual(context.currentTime);
  });

  it("starts a set-down at once on the resumed clock when the wake took longer than its lead", async () => {
    armPlannerSound();
    context.state = "suspended";
    expect(beginSetDownBatch(1)?.play(voice({ startAt: 1.011 }))).toBe(true);
    expect(context.resumes, "a play wakes the context itself").toBe(1);
    nowMs += 30;
    context.finishResume(0.004);
    await flushPromises();
    expect(context.started.map((source) => source.startedAt)).toEqual([1.004]);
  });

  it("drops a waiting set-down if sound is turned off before the context answers, and logs it as a miss", async () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    context.state = "suspended";
    expect(beginSetDownBatch(1)?.play(voice({ startAt: 1.011 }))).toBe(true);
    setPlannerSoundMode("off");
    context.finishResume();
    await flushPromises();
    expect(context.started).toHaveLength(0);
    expect(window.__venSoundTap?.log).toEqual([expect.objectContaining({ startAt: 1.011, miss: "off" })]);
  });

  it("drops a waiting set-down if the tab is hidden when the context answers, and logs it as a miss", async () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    context.state = "suspended";
    expect(beginSetDownBatch(1)?.play(voice({ startAt: 1.011 }))).toBe(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    context.finishResume();
    await flushPromises();
    expect(context.started).toHaveLength(0);
    expect(window.__venSoundTap?.log).toEqual([expect.objectContaining({ startAt: 1.011, miss: "hidden" })]);
  });

  it("drops a set-down that waited longer than its batch's 1.5 s for the context, and logs it as a miss", async () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    context.state = "suspended";
    const batch = beginSetDownBatch(2);
    expect(batch?.play(voice({ startAt: 1.011 }))).toBe(true);
    nowMs += 1000;
    expect(batch?.play(voice({ startAt: 1.2 }))).toBe(true);
    nowMs += 501;
    context.finishResume();
    await flushPromises();
    expect(context.started.map((source) => source.startedAt), "the second waited 0.501 s and still plays").toHaveLength(1);
    expect(window.__venSoundTap?.log).toEqual([
      expect.objectContaining({ startAt: 1.011, miss: "expired" }),
      expect.not.objectContaining({ miss: expect.anything() }),
    ]);
  });

  it("drops the waiting set-downs when the device refuses to resume, and logs each as a miss", async () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    context.state = "suspended";
    const batch = beginSetDownBatch(2);
    expect(batch?.play(voice({ startAt: 1.011 }))).toBe(true);
    expect(batch?.play(voice({ startAt: 1.1 }))).toBe(true);
    context.failResume();
    await flushPromises();
    expect(context.started).toHaveLength(0);
    expect(window.__venSoundTap?.log.map((entry) => entry.miss)).toEqual(["resume-rejected", "resume-rejected"]);
  });
});

describe("the room's tail", () => {
  it("is refused before the first gesture", () => {
    expect(setPlannerRoomTail(stereo(48000, 1), "grand-hall/empty")).toBe(false);
    expect(context.convolvers).toHaveLength(0);
  });

  it("goes on its own convolver beside the palette's hall, cross-faded over 0.1 s, the old one let go after 0.15 s (R62)", () => {
    vi.useFakeTimers();
    armPlannerSound();
    expect(context.convolvers, "the palette's own hall").toHaveLength(1);
    const first = stereo(48000, 5, 128);
    expect(setPlannerRoomTail(first, "grand-hall/empty")).toBe(true);
    const firstConvolver = context.convolvers[1];
    expect(firstConvolver?.normalize).toBe(false);
    expect(firstConvolver?.buffer?.numberOfChannels).toBe(2);
    expect(firstConvolver?.buffer?.getChannelData(0)).toEqual(first.left);
    expect(firstConvolver?.buffer?.getChannelData(1)).toEqual(first.right);
    const firstFade = fadeAfter(firstConvolver);
    expect(firstFade.gain.value, "the first tail is in at once").toBe(1);
    expect(firstFade.connections).toContain(master());
    const roomBus = feeding(firstConvolver);

    context.currentTime = 3;
    expect(setPlannerRoomTail(stereo(48000, 6, 128), "saloon/empty")).toBe(true);
    const secondConvolver = context.convolvers[2];
    expect(secondConvolver?.normalize).toBe(false);
    expect(roomBus.connections).toContain(secondConvolver);
    const secondFade = fadeAfter(secondConvolver);
    expect(secondFade.connections).toContain(master());
    expect(PLANNER_ROOM_CROSSFADE_SECONDS).toBe(0.1);
    expect(PLANNER_ROOM_RELEASE_SECONDS).toBe(0.15);
    expect(secondFade.gain.events.map((event) => [event.kind, event.value])).toEqual([["set", 0], ["ramp", 1]]);
    expect(secondFade.gain.events[0]?.at).toBe(3);
    expect(secondFade.gain.events[1]?.at).toBeCloseTo(3.1, 12);
    const firstRamp = firstFade.gain.events.filter((event) => event.kind === "ramp");
    expect(firstRamp.map((event) => event.value)).toEqual([0]);
    expect(firstRamp[0]?.at).toBeCloseTo(3.1, 12);

    vi.advanceTimersByTime(149);
    expect(firstConvolver?.disconnections).toEqual([]);
    expect(roomBus.disconnections).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(roomBus.disconnections).toEqual([firstConvolver]);
    expect(firstConvolver?.disconnections).toEqual(["all"]);
    expect(firstFade.disconnections).toEqual(["all"]);
    expect(secondConvolver?.disconnections).toEqual([]);
    expect(secondFade.disconnections).toEqual([]);
  });

  it("swaps the tail at once while the context is suspended, with no fade or timer on its stopped clock", () => {
    vi.useFakeTimers();
    armPlannerSound();
    expect(setPlannerRoomTail(stereo(48000, 5, 128), "grand-hall/empty")).toBe(true);
    const firstConvolver = context.convolvers[1];
    const firstFade = fadeAfter(firstConvolver);
    const roomBus = feeding(firstConvolver);
    context.state = "suspended";
    expect(setPlannerRoomTail(stereo(48000, 6, 128), "saloon/empty")).toBe(true);
    const secondFade = fadeAfter(context.convolvers[2]);
    expect(secondFade.gain.value, "the new tail is in at once").toBe(1);
    expect(secondFade.gain.events, "no ramp on a stopped clock").toEqual([]);
    expect(firstFade.gain.events).toEqual([]);
    expect(roomBus.disconnections, "the old tail is let go at once").toEqual([firstConvolver]);
    expect(firstConvolver?.disconnections).toEqual(["all"]);
    expect(firstFade.disconnections).toEqual(["all"]);
    expect(vi.getTimerCount(), "no release timer").toBe(0);
  });

  it("takes the tail off the bus, fading it out over the cross-fade, so the room is dry until the next tail, which goes in at once", () => {
    vi.useFakeTimers();
    expect(() => { clearPlannerRoomTail(); }, "nothing to clear before the first gesture").not.toThrow();
    armPlannerSound();
    clearPlannerRoomTail();
    expect(context.convolvers, "no tail yet: nothing to clear").toHaveLength(1);
    expect(setPlannerRoomTail(stereo(48000, 5, 128), "grand-hall/empty")).toBe(true);
    const firstConvolver = context.convolvers[1];
    const firstFade = fadeAfter(firstConvolver);
    const roomBus = feeding(firstConvolver);
    context.currentTime = 4;
    clearPlannerRoomTail();
    const ramp = firstFade.gain.events.filter((event) => event.kind === "ramp");
    expect(ramp.map((event) => event.value)).toEqual([0]);
    expect(ramp[0]?.at).toBeCloseTo(4 + PLANNER_ROOM_CROSSFADE_SECONDS, 12);
    vi.advanceTimersByTime(PLANNER_ROOM_RELEASE_SECONDS * 1000);
    expect(roomBus.disconnections).toEqual([firstConvolver]);
    expect(firstFade.disconnections).toEqual(["all"]);
    // The next tail finds the bus dry: in at once, nothing to cross-fade from.
    expect(setPlannerRoomTail(stereo(48000, 6, 128), "saloon/empty")).toBe(true);
    const secondFade = fadeAfter(context.convolvers[2]);
    expect(secondFade.gain.value).toBe(1);
    expect(secondFade.gain.events).toEqual([]);
  });

  it("takes the tail off at once while the context is suspended", () => {
    vi.useFakeTimers();
    armPlannerSound();
    expect(setPlannerRoomTail(stereo(48000, 5, 128), "grand-hall/empty")).toBe(true);
    const firstConvolver = context.convolvers[1];
    const roomBus = feeding(firstConvolver);
    context.state = "suspended";
    clearPlannerRoomTail();
    expect(roomBus.disconnections).toEqual([firstConvolver]);
    expect(vi.getTimerCount(), "no release timer on a stopped clock").toBe(0);
  });

  it("refuses a tail at another rate than the context's and keeps the one it has", () => {
    armPlannerSound();
    expect(setPlannerRoomTail(stereo(48000, 5), "grand-hall/empty")).toBe(true);
    const kept = context.convolvers[1];
    expect(setPlannerRoomTail(stereo(44100, 6), "grand-hall/dressed")).toBe(false);
    expect(context.convolvers).toHaveLength(2);
    expect(fadeAfter(kept).gain.events, "no fade begins").toEqual([]);
    expect(kept?.disconnections).toEqual([]);
  });
});

describe("the clock, arming and the tap", () => {
  it("reports no clock before arming, then the output's latency, else the base latency, else 0, and the rate", () => {
    expect(plannerAudioClock()).toBeNull();
    armPlannerSound();
    context.currentTime = 4.5;
    expect(plannerAudioClock()).toEqual({ currentTime: 4.5, outputLatency: 0.012, sampleRate: 48000 });
    context.outputLatency = 0;
    expect(plannerAudioClock()?.outputLatency).toBe(0.005);
    context.outputLatency = undefined;
    expect(plannerAudioClock()?.outputLatency, "a browser without outputLatency").toBe(0.005);
    context.baseLatency = Number.NaN;
    expect(plannerAudioClock()?.outputLatency).toBe(0);
  });

  it("tells its listeners the context's rate once, when the context is made", () => {
    context = new FakeContext(44100);
    const heard: number[] = [];
    const stop = subscribePlannerSoundArmed((sampleRate) => { heard.push(sampleRate); });
    try {
      armPlannerSound();
      armPlannerSound();
      expect(heard).toEqual([44100]);
    } finally {
      stop();
    }
  });

  it("tells a listener added after arming the rate at once, in the subscribe call", () => {
    context = new FakeContext(44100);
    armPlannerSound();
    const heard: number[] = [];
    const stop = subscribePlannerSoundArmed((sampleRate) => { heard.push(sampleRate); });
    expect(heard, "synchronously, before subscribe returns").toEqual([44100]);
    armPlannerSound();
    expect(heard, "once").toEqual([44100]);
    stop();
  });

  it("tells an unsubscribed listener nothing", () => {
    const heard: number[] = [];
    const stop = subscribePlannerSoundArmed((sampleRate) => { heard.push(sampleRate); });
    stop();
    armPlannerSound();
    expect(heard).toEqual([]);
  });

  describe("a listener that throws (R86, as the landings' listeners)", () => {
    const failure = new Error("a listener failed");

    it("is reported, not thrown, when it hears the rate in the subscribe call, and its caller still gets the unsubscribe", () => {
      const reportError = vi.fn();
      vi.stubGlobal("reportError", reportError);
      armPlannerSound();
      let stop: unknown = null;
      expect(() => { stop = subscribePlannerSoundArmed(() => { throw failure; }); }).not.toThrow();
      expect(typeof stop).toBe("function");
      expect(reportError).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith(failure);
      if (typeof stop === "function") stop();
    });

    it("is reported, not thrown, when the first gesture makes the context: the listeners after it hear the rate, and arming finishes", () => {
      const reportError = vi.fn();
      vi.stubGlobal("reportError", reportError);
      context.state = "suspended";
      const heard: number[] = [];
      const stopThrowing = subscribePlannerSoundArmed(() => { throw failure; });
      const stop = subscribePlannerSoundArmed((sampleRate) => { heard.push(sampleRate); });
      try {
        expect(armPlannerSound()).toBe(true);
        expect(heard).toEqual([48000]);
        expect(reportError).toHaveBeenCalledOnce();
        expect(reportError).toHaveBeenCalledWith(failure);
        expect(context.resumes, "arming went on to resume the context").toBe(1);
        expect(plannerAudioClock()).not.toBeNull();
      } finally {
        stopThrowing();
        stop();
      }
    });

    it("throws the error again on a microtask where the page has no reportError", () => {
      armPlannerSound();
      const queued: (() => void)[] = [];
      vi.stubGlobal("reportError", undefined);
      vi.stubGlobal("queueMicrotask", (task: () => void) => { queued.push(task); });
      let stop: () => void = () => {};
      try {
        stop = subscribePlannerSoundArmed(() => { throw failure; });
      } finally {
        vi.unstubAllGlobals();
      }
      stop();
      expect(queued).toHaveLength(1);
      const [rethrow] = queued;
      expect(() => { rethrow?.(); }).toThrow(failure);
    });
  });

  it("forgets every listener when the tests reset it", () => {
    const heard: number[] = [];
    subscribePlannerSoundArmed((sampleRate) => { heard.push(sampleRate); });
    __resetPlannerSoundForTests();
    armPlannerSound();
    expect(heard).toEqual([]);
  });

  it("resumes the context on arming in any state but running, Safari's interrupted too", () => {
    context.state = "interrupted";
    expect(armPlannerSound()).toBe(true);
    expect(context.resumes, "made interrupted").toBe(1);
    context.finishResume();
    armPlannerSound();
    expect(context.resumes, "running: nothing to resume").toBe(1);
    // A call takes the audio; the next gesture brings it back.
    context.state = "interrupted";
    armPlannerSound();
    expect(context.resumes).toBe(2);
  });

  it("asks for the ambient audio session where the browser has one", () => {
    const session = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", { value: session, configurable: true });
    try {
      expect(armPlannerSound()).toBe(true);
      expect(session.type).toBe("ambient");
    } finally {
      Reflect.deleteProperty(navigator, "audioSession");
    }
  });

  it("arms where the browser has no audio session", () => {
    expect("audioSession" in navigator).toBe(false);
    expect(armPlannerSound()).toBe(true);
  });

  it("keeps a tap of every voice played with ?soundtap=1", () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    const tap = window.__venSoundTap;
    expect(tap).toBeDefined();
    expect(context.streams).toHaveLength(1);
    expect(master().connections).toContain(context.streams[0]);
    expect(typeof tap?.record).toBe("function");
    const batch = beginSetDownBatch(2);
    batch?.play(voice({ startAt: 1.1, directGain: 0.5, tap: { slug: "chiavari-chair", surface: "oak-floor", rtMid: 2.1, contactMs: 83.3 } }));
    batch?.play(voice({ startAt: 1.2 }));
    expect(tap?.log).toHaveLength(2);
    expect(tap?.log[0]).toMatchObject({ startAt: 1.1, levelDb: 0, directGain: 0.5, send: 0.8, slug: "chiavari-chair", surface: "oak-floor", rtMid: 2.1, contactMs: 83.3 });
    expect(tap?.log[1]).toMatchObject({ startAt: 1.2 });
  });

  it("logs how the scene played each voice, and every landing it dropped, with ?soundtap=1 (R78, R80, R87, R89)", () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    const tap = window.__venSoundTap;
    expect(tap?.drops).toEqual([]);
    const batch = beginSetDownBatch(1);
    batch?.play(voice({ tap: { slug: "chiavari-chair", surface: "oak-floor", rtMid: 2.1, contactMs: 1016.7, played: "late", workMs: 31.5 } }));
    expect(tap?.log[0]).toMatchObject({ played: "late", workMs: 31.5, contactMs: 1016.7 });
    logSetDownDrop({ drop: "not-loaded" });
    logSetDownDrop({ drop: "too-late", slug: "chiavari-chair", contactMs: 1033.3, workMs: 61 });
    expect(tap?.drops).toEqual([{ drop: "not-loaded" }, { drop: "too-late", slug: "chiavari-chair", contactMs: 1033.3, workMs: 61 }]);
    expect(tap?.log, "a dropped landing is never a played voice").toHaveLength(1);
  });

  it("logs each voice's render onset and the output's latency, with ?soundtap=1, so R80's window can be checked from the tap", () => {
    window.history.replaceState(null, "", "/plan/stub?soundtap=1");
    armPlannerSound();
    const batch = beginSetDownBatch(2);
    batch?.play(voice({ render: { ...stereo(48000, 1), onsetSeconds: 0.004 }, tap: { slug: "chiavari-chair", surface: "oak-floor", rtMid: 2.1, contactMs: 83.3 } }));
    expect(window.__venSoundTap?.log[0]).toMatchObject({ onsetSeconds: 0.004, outputLatency: 0.012 });
    context.outputLatency = undefined;
    batch?.play(voice({ render: { ...stereo(48000, 1), onsetSeconds: 0.03 } }));
    expect(window.__venSoundTap?.log[1], "no output latency: the base latency, as the clock reads it").toMatchObject({ onsetSeconds: 0.03, outputLatency: 0.005 });
  });

  it("drops nothing on the floor without the flag: a dropped landing is simply not logged", () => {
    window.history.replaceState(null, "", "/plan/stub");
    expect(() => { logSetDownDrop({ drop: "gone" }); }).not.toThrow();
    armPlannerSound();
    expect(() => { logSetDownDrop({ drop: "undone" }); }).not.toThrow();
    expect(window.__venSoundTap).toBeUndefined();
  });

  it("has no tap without the flag", () => {
    window.history.replaceState(null, "", "/plan/stub");
    armPlannerSound();
    expect(window.__venSoundTap).toBeUndefined();
    expect(context.streams).toHaveLength(0);
  });
});
