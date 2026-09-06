// -----------------------------------------------------------------------------
// audio-types — the mixer's contract. The voice keeps its own media element
// and clock (convener-voice.ts); everything else is one AudioContext created
// inside the BEGIN gesture, four gain buses into a crash-guard compressor,
// beds as looped element pairs, cues decoded once. Everything fails silent,
// never broken.
// -----------------------------------------------------------------------------
import type { BedMix, BusName, Cue } from "../stage/stage-manifest.js";

export type { BedMix, BusName, Cue };

// The slice of Web Audio the mixer touches, named so a test can hand the
// engine a fake: happy-dom has no AudioContext, and the lint forbids
// `as unknown as AudioContext`. A real AudioContext satisfies MixerContext
// structurally; createBrowserAudioDeps() in audio-engine.ts is where that is
// checked by the compiler.

export interface MixerParam {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

export interface MixerNode {
  connect(destination: MixerNode): unknown;
  disconnect(): void;
}

export interface MixerGain extends MixerNode {
  readonly gain: MixerParam;
}

export interface MixerBuffer {
  readonly length: number;
  readonly duration: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number): void;
}

export interface MixerSource extends MixerNode {
  buffer: MixerBuffer | null;
  loop: boolean;
  readonly detune: MixerParam;
  onended: ((event: Event) => void) | null;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface MixerCompressor extends MixerNode {
  readonly threshold: MixerParam;
  readonly knee: MixerParam;
  readonly ratio: MixerParam;
}

export interface MixerContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: MixerNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): MixerGain;
  createBufferSource(): MixerSource;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MixerBuffer;
  createDynamicsCompressor(): MixerCompressor;
  decodeAudioData(audioData: ArrayBuffer): Promise<MixerBuffer>;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

export interface CuePlayOptions {
  readonly gainDb?: number;
  readonly detuneCents?: number;
  /** Play only the first half (the third-tap rule). */
  readonly halfLength?: boolean;
}

export interface DuckTargets {
  readonly ambienceDb: number;
  readonly musicDb: number;
  readonly sfxDb: number;
}

export type VoiceEvent = "play" | "playing" | "waiting" | "pause" | "ended";

export interface PlayLogEntry {
  readonly cueId: string;
  readonly atMs: number;
  readonly bus: BusName;
}

export interface QuizAudioEngine {
  readonly unlocked: boolean;
  readonly enabled: boolean;
  /** The live context: null before unlock and after dispose. The interruption adapter watches it; the perf harness reads its clock. */
  readonly context: MixerContext | null;
  /** Create or resume the context inside a user gesture; plays the one-sample silent buffer for iOS. */
  unlock(): Promise<boolean>;
  setEnabled(on: boolean): void;
  /** Fetch and decode; keeps the encoded bytes so a sample-rate rebuild never refetches. */
  loadCues(cues: readonly Cue[], signal?: AbortSignal): Promise<void>;
  /** Returns false when the cue is unknown, the engine is disabled, or the voice budget refuses. */
  play(cueId: string, options?: CuePlayOptions): boolean;
  /** Set the six bed gains; the engine crossfades over about 1.5 s. */
  setBed(mix: BedMix): void;
  /** A hidden tab: the beds fade to silence and the requested mix is kept for the return. */
  setBedsHeld(held: boolean): void;
  /** Apply duck targets (from the pure ducker) with setTargetAtTime. */
  duck(targets: DuckTargets): void;
  /** Feed the voice element's events so the ducker can react. */
  onVoiceEvent(event: VoiceEvent): void;
  /** A scene opened: the per-scene voice budget starts again. Sounding voices carry over. */
  beginScene(): void;
  /**
   * The output's sample rate changed (AirPods mid-run): close, build the graph on
   * a fresh context, re-decode every cue from its retained bytes and restart the
   * beds at the requested mix. Resolves the new context, or null when it cannot.
   */
  rebuild(): Promise<MixerContext | null>;
  /** Decoded audio resident in memory: frames × channels × 4 bytes, summed. */
  readonly residentBytes: number;
  readonly playLog: readonly PlayLogEntry[];
  dispose(): void;
}

/**
 * Bus gains in dB. Their linear sum must stay at or below -3 dBFS, so four
 * full-scale buses cannot clip by construction and the compressor is only a
 * crash guard (bus-table.test.ts holds this). The first draft of this table
 * (-14, -12, -9, -12) summed to 1.057, which is +0.48 dBFS, and was corrected
 * on 2026-09-06: these sum to 0.694, which is -3.17 dBFS. The hierarchy is
 * kept: the pokes (sfx) are the hottest, music and the ceremony (ui) sit
 * 4 dB under them, the beds (ambience) are felt rather than heard.
 */
export const BUS_GAIN_DB: Readonly<Record<BusName, number>> = {
  ambience: -18,
  music: -16,
  sfx: -12,
  ui: -16,
};
