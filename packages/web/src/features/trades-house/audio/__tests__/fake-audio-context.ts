// A fake of the slice of Web Audio the mixer touches (MixerContext), because
// happy-dom has no AudioContext. It records what the engine schedules, in the
// shape a test can read: gain automation events per param, source starts and
// stops, connections, decodes. Time never advances on its own; a test sets
// `currentTime` and fires `end()` on a source the way the audio thread would.
import type { Cue, Provenance } from "../../stage/stage-manifest.js";
import type { AudioEngineDeps } from "../audio-engine.js";
import type {
  MixerBuffer,
  MixerCompressor,
  MixerContext,
  MixerGain,
  MixerNode,
  MixerParam,
  MixerSource,
} from "../audio-types.js";
import type { Schedule } from "../timers.js";

export interface ParamEvent {
  readonly kind: "set" | "target" | "curve";
  readonly value: number;
  readonly time: number;
  readonly tau?: number;
  readonly duration?: number;
}

export class FakeParam implements MixerParam {
  value: number;
  events: ParamEvent[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): this {
    this.events.push({ kind: "set", value, time: startTime });
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    this.events.push({ kind: "target", value: target, time: startTime, tau: timeConstant });
    return this;
  }

  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): this {
    this.events.push({ kind: "curve", value: values[values.length - 1] ?? this.value, time: startTime, duration });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    this.events = this.events.filter((event) => event.time < cancelTime);
    return this;
  }

  /** The last automation event still scheduled. */
  get last(): ParamEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

export class FakeNode implements MixerNode {
  readonly connections: MixerNode[] = [];

  connect(destination: MixerNode): MixerNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class FakeGain extends FakeNode implements MixerGain {
  readonly gain = new FakeParam(1);
}

export class FakeCompressor extends FakeNode implements MixerCompressor {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
}

export class FakeBuffer implements MixerBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }

  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0): void {
    this.getChannelData(channelNumber).set(source, bufferOffset);
  }
}

export interface SourceStart {
  readonly when: number;
  readonly offset: number;
  readonly duration: number | null;
}

export class FakeSource extends FakeNode implements MixerSource {
  buffer: MixerBuffer | null = null;
  loop = false;
  readonly detune = new FakeParam(0);
  onended: ((event: Event) => void) | null = null;
  readonly starts: SourceStart[] = [];
  readonly stops: number[] = [];

  start(when = 0, offset = 0, duration?: number): void {
    this.starts.push({ when, offset, duration: duration ?? null });
  }

  stop(when = 0): void {
    this.stops.push(when);
  }

  /** The audio thread reached the end of the buffer: fire onended as a browser would. */
  end(): void {
    this.onended?.(new Event("ended"));
  }
}

export class FakeAudioContext implements MixerContext {
  currentTime = 0;
  sampleRate: number;
  state: AudioContextState = "suspended";
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly decoded: ArrayBuffer[] = [];
  resumeCalls = 0;
  /** Frames every decode yields; a test raises it to model a bed or encoder padding. */
  decodedFrames = 4800;
  /** "ramp" fills each decoded sample with its own index, so a trim can be read back. */
  decodeFill: "zero" | "ramp" = "zero";
  decodeRejects = false;
  resumeRejects = false;
  sourceThrows = false;
  private readonly listeners = new Set<() => void>();

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeRejects) return Promise.reject(new Error("no gesture"));
    if (this.state !== "closed") this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = "closed";
    this.fireStateChange();
    return Promise.resolve();
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    if (this.sourceThrows) throw new Error("no source");
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }

  createDynamicsCompressor(): FakeCompressor {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }

  decodeAudioData(audioData: ArrayBuffer): Promise<MixerBuffer> {
    this.decoded.push(audioData);
    if (this.decodeRejects) return Promise.reject(new Error("undecodable"));
    const buffer = new FakeBuffer(1, this.decodedFrames, this.sampleRate);
    if (this.decodeFill === "ramp") {
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = i;
    }
    return Promise.resolve(buffer);
  }

  addEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Move the state and fire statechange, as the platform does. */
  setState(state: AudioContextState): void {
    this.state = state;
    this.fireStateChange();
  }

  fireStateChange(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** The bus gains in BUS_NAMES order: the graph creates them first. */
  get buses(): FakeGain[] {
    return this.gains.slice(0, 4);
  }
}

export const TEST_PROVENANCE: Provenance = {
  kind: "G",
  tool: "ElevenLabs sound-generation v1",
  prompt: "a short test cue",
  licence: "test fixture",
  fetchedOn: "2026-09-06",
  touchedBy: "audio tests",
};

export function makeCue(id: string, overrides: Partial<Omit<Cue, "id">> = {}): Cue {
  return {
    id,
    file: `/trades-house-media/stage/${id}.mp3`,
    durationMs: 300,
    expectedSamples: null,
    gainDb: -6,
    bus: "sfx",
    caption: `[${id}]`,
    loop: false,
    provenance: TEST_PROVENANCE,
    ...overrides,
  };
}

export interface FakeRig {
  readonly deps: AudioEngineDeps;
  readonly contexts: FakeAudioContext[];
  readonly fetched: string[];
  /** The most recently created context. */
  context(): FakeAudioContext;
}

export interface FakeRigOptions {
  readonly createThrows?: boolean;
  readonly decodedFrames?: number;
  readonly resumeRejects?: boolean;
}

export function fakeRig(options: FakeRigOptions = {}): FakeRig {
  const contexts: FakeAudioContext[] = [];
  const fetched: string[] = [];
  return {
    contexts,
    fetched,
    context() {
      const latest = contexts[contexts.length - 1];
      if (latest === undefined) throw new Error("no context has been created");
      return latest;
    },
    deps: {
      createContext: () => {
        if (options.createThrows === true) throw new Error("Web Audio refused");
        const context = new FakeAudioContext();
        context.decodedFrames = options.decodedFrames ?? context.decodedFrames;
        context.resumeRejects = options.resumeRejects === true;
        contexts.push(context);
        return context;
      },
      fetchBytes: (url) => {
        fetched.push(url);
        if (url.includes("missing")) return Promise.reject(new Error("404"));
        return Promise.resolve(new ArrayBuffer(16));
      },
    },
  };
}

/** Let the engine's decode chain (then, catch, finally) and any other microtasks settle. */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Sources carrying decoded audio, as opposed to the one-frame silent buffer that banks the gesture. */
export function audibleSources(context: FakeAudioContext): FakeSource[] {
  return context.sources.filter((source) => source.buffer !== null && source.buffer.length > 1);
}

/** The gain node a source feeds. */
export function gainAfter(source: FakeSource): FakeGain {
  const [gain] = source.connections;
  if (!(gain instanceof FakeGain)) throw new Error("the source is not connected to a gain");
  return gain;
}

export interface ManualClock {
  readonly nowMs: () => number;
  readonly schedule: Schedule;
  /** Run the wall clock forward, firing timers in order; the context clock follows unless stalled. */
  advance(ms: number): void;
  /** Freeze the context clock while the wall clock runs (a suspended context). */
  stalled: boolean;
}

/** A hand-driven wall clock plus a context clock, for the scheduler and the caption store. */
export function manualClock(): ManualClock {
  let wallMs = 0;
  let contextMs = 0;
  let queue: { readonly at: number; readonly fn: () => void }[] = [];
  const clock: ManualClock = {
    stalled: false,
    nowMs: () => contextMs,
    schedule: (callback, ms) => {
      const entry = { at: wallMs + ms, fn: callback };
      queue.push(entry);
      return () => {
        queue = queue.filter((other) => other !== entry);
      };
    },
    advance(ms) {
      const end = wallMs + ms;
      for (;;) {
        const due = [...queue].filter((entry) => entry.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        queue = queue.filter((entry) => entry !== due);
        if (!clock.stalled) contextMs += due.at - wallMs;
        wallMs = due.at;
        due.fn();
      }
      if (!clock.stalled) contextMs += end - wallMs;
      wallMs = end;
    },
  };
  return clock;
}
