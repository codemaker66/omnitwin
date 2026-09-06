// -----------------------------------------------------------------------------
// audio-engine — the mixer (spec section 6; Appendix A section 6).
//
// One AudioContext, created inside the BEGIN gesture (latencyHint
// "interactive") with a one-sample silent buffer started for iOS; four gain
// buses at BUS_GAIN_DB into a DynamicsCompressorNode that exists only as a
// crash guard for a stuck loop (knee 0, threshold -6, ratio 12; it is not a
// limiter) into the destination. Cues are fetched once and decoded once, and
// the encoded bytes are kept so a sample-rate rebuild never refetches. Beds
// are loop cues played as two overlapping sources with an equal-power
// crossfade at the seam, never loopStart/loopEnd, and their six gains cross-
// fade over about 1.5 s. Everything time-shaped is scheduled on the audio
// clock: the duck release's 250 ms hold, the bed fade-outs and stops, the
// seam. No JS timer lives here.
//
// Every failure is caught. Whatever the platform refuses, the engine stays
// usable and silent: play() returns false, setBed() does nothing audible, and
// the quiz goes on. The voice is not in this graph; it keeps its own element
// and clock in convener-voice.ts and only its events arrive here.
// -----------------------------------------------------------------------------
import { BUS_NAMES, type BedMix, type BusName, type Cue } from "../stage/stage-manifest.js";
import {
  BUS_GAIN_DB,
  type CuePlayOptions,
  type DuckTargets,
  type MixerBuffer,
  type MixerCompressor,
  type MixerContext,
  type MixerGain,
  type MixerSource,
  type PlayLogEntry,
  type QuizAudioEngine,
  type VoiceEvent,
} from "./audio-types.js";
import { IDLE_DUCKER, reduceDucker, type DuckerState } from "./ducker.js";
import { dbToLinear } from "./gain.js";
import { decodeCue } from "./sprite-loader.js";
import { IDLE_VOICE_BUDGET, admitVoice, beginSceneBudget, type VoiceBudgetState } from "./voice-budget.js";

export interface AudioEngineDeps {
  /** Called once, inside the gesture, by unlock(); again by rebuild(). */
  readonly createContext: () => MixerContext;
  readonly fetchBytes: (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
}

/** The real thing: a fresh AudioContext at interactive latency and fetch() for the bytes. */
export function createBrowserAudioDeps(): AudioEngineDeps {
  return {
    createContext: () => new AudioContext({ latencyHint: "interactive" }),
    fetchBytes: async (url, signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`audio ${String(response.status)} ${url}`);
      return response.arrayBuffer();
    },
  };
}

export type BedName = keyof BedMix;

export const BED_NAMES = ["water", "wind", "fire", "room", "voices", "night"] as const satisfies readonly BedName[];

/** The loop cue each bed element plays, when the scene's manifest carries it. */
export const BED_CUE_IDS: Readonly<Record<BedName, string>> = {
  water: "bed-water",
  wind: "bed-wind",
  fire: "bed-fire",
  room: "bed-room",
  voices: "bed-voices",
  night: "bed-night",
};

export const SILENT_BED: BedMix = { water: 0, wind: 0, fire: 0, room: 0, voices: 0, night: 0 };

/** setTargetAtTime is 95% of the way at three time constants: 0.5 s is the "about 1.5 s" bed crossfade. */
export const BED_FADE_TAU_S = 0.5;
export const BED_FADE_S = 1.5;
/** The equal-power seam between a bed's two sources; never more than a quarter of the loop. */
export const BED_SEAM_S = 1;
/** A duck lands fast and lets go slowly, so the room never pumps under his consonants. */
export const DUCK_ATTACK_TAU_S = 0.05;
export const DUCK_RELEASE_TAU_S = 0.3;

const COMPRESSOR = { knee: 0, threshold: -6, ratio: 12 } as const;

const FADE_STEPS = 33;
const FADE_IN = Float32Array.from({ length: FADE_STEPS }, (_, i) => Math.sin((Math.PI / 2) * (i / (FADE_STEPS - 1))));
const FADE_OUT = Float32Array.from({ length: FADE_STEPS }, (_, i) => Math.cos((Math.PI / 2) * (i / (FADE_STEPS - 1))));

interface LoadedCue {
  readonly cue: Cue;
  readonly bytes: ArrayBuffer;
  buffer: MixerBuffer | null;
  decoding: Promise<void> | null;
}

interface Graph {
  readonly context: MixerContext;
  readonly buses: Readonly<Record<BusName, MixerGain>>;
  readonly compressor: MixerCompressor;
}

interface BedLoop {
  readonly gain: MixerGain;
  /** Stop both sources at `at` (after the fade) and free the nodes when they end. */
  stop(at: number): void;
}

function buildGraph(context: MixerContext): Graph {
  const compressor = context.createDynamicsCompressor();
  compressor.knee.value = COMPRESSOR.knee;
  compressor.threshold.value = COMPRESSOR.threshold;
  compressor.ratio.value = COMPRESSOR.ratio;
  compressor.connect(context.destination);
  const bus = (name: BusName): MixerGain => {
    const gain = context.createGain();
    gain.gain.value = dbToLinear(BUS_GAIN_DB[name]);
    gain.connect(compressor);
    return gain;
  };
  return {
    context,
    compressor,
    buses: { ambience: bus("ambience"), music: bus("music"), sfx: bus("sfx"), ui: bus("ui") },
  };
}

/** iOS banks the gesture on the first sound the context actually starts: one silent frame. */
function bankGesture(context: MixerContext): void {
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.start(0);
}

/**
 * A bed as a chain of overlapping sources: each starts one seam before the
 * previous one ends, fades in on a sine while the other fades out on a
 * cosine (equal power, so the sum never dips), and when a source ends it
 * launches the one after next, so two are always scheduled and never more.
 */
function startBedLoop(context: MixerContext, buffer: MixerBuffer, bus: MixerGain): BedLoop {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(bus);
  const seam = Math.min(BED_SEAM_S, buffer.duration / 4);
  const period = buffer.duration - seam;
  let live: MixerSource[] = [];
  let stopped = false;

  const launch = (at: number, fadeIn: boolean): void => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const fade = context.createGain();
    fade.gain.value = fadeIn ? 0 : 1;
    if (fadeIn) fade.gain.setValueCurveAtTime(FADE_IN, at, seam);
    fade.gain.setValueCurveAtTime(FADE_OUT, at + period, seam);
    source.connect(fade);
    fade.connect(gain);
    source.onended = () => {
      source.disconnect();
      fade.disconnect();
      live = live.filter((other) => other !== source);
      if (!stopped) launch(at + 2 * period, true);
    };
    source.start(at);
    live.push(source);
  };

  const now = context.currentTime;
  launch(now, false);
  launch(now + period, true);

  return {
    gain,
    stop(at) {
      stopped = true;
      let remaining = live.length;
      for (const source of live) {
        source.onended = () => {
          source.disconnect();
          remaining -= 1;
          if (remaining === 0) gain.disconnect();
        };
        source.stop(at);
      }
      live = [];
    },
  };
}

export function createQuizAudioEngine(deps: AudioEngineDeps): QuizAudioEngine {
  let graph: Graph | null = null;
  let unlocked = false;
  let enabled = false;
  // Annotated `boolean`, not inferred `false`: it is flipped in dispose(), a
  // different closure, which the flow analysis cannot see from the reads here.
  let disposed: boolean = false;
  /**
   * Read the flag through a call at any point that follows an `await`. Control
   * flow analysis keeps `disposed` narrowed to `false` past an earlier guard
   * even though the await gives dispose() a chance to run, so a bare re-check
   * reads as dead code to the compiler and to the linter while being the very
   * check that keeps a disposed engine from decoding into a closed context.
   */
  const isDisposed = (): boolean => disposed;
  let held = false;
  const cues = new Map<string, LoadedCue>();
  const beds = new Map<BedName, BedLoop>();
  let requestedMix: BedMix = SILENT_BED;
  const playLog: PlayLogEntry[] = [];
  let budget: VoiceBudgetState = IDLE_VOICE_BUDGET;
  let ducker: DuckerState = IDLE_DUCKER;
  /** The last duck offset commanded per bus, to choose attack or release. */
  const duckDb: Record<BusName, number> = { ambience: 0, music: 0, sfx: 0, ui: 0 };

  const nowMs = (): number => (graph === null ? 0 : Math.round(graph.context.currentTime * 1000));

  const effectiveMix = (): BedMix => (enabled && !held && graph !== null ? requestedMix : SILENT_BED);

  const applyBeds = (): void => {
    if (graph === null) return;
    const { context, buses } = graph;
    const mix = effectiveMix();
    const now = context.currentTime;
    for (const name of BED_NAMES) {
      const target = mix[name];
      const running = beds.get(name);
      if (target > 0) {
        if (running !== undefined) {
          running.gain.gain.setTargetAtTime(target, now, BED_FADE_TAU_S);
          continue;
        }
        const loaded = cues.get(BED_CUE_IDS[name]);
        if (loaded === undefined || loaded.buffer === null) continue; // not landed yet: it fades in when it does
        try {
          const loop = startBedLoop(context, loaded.buffer, buses[loaded.cue.bus]);
          loop.gain.gain.setTargetAtTime(target, now, BED_FADE_TAU_S);
          beds.set(name, loop);
        } catch {
          // The platform refused a node: this bed stays silent, the rest play.
        }
      } else if (running !== undefined) {
        running.gain.gain.setTargetAtTime(0, now, BED_FADE_TAU_S);
        running.stop(now + BED_FADE_S);
        beds.delete(name);
      }
    }
  };

  const stopBedsNow = (): void => {
    if (graph !== null) {
      const now = graph.context.currentTime;
      for (const loop of beds.values()) {
        try {
          loop.stop(now);
        } catch {
          // Already stopped or the context is gone: nothing to free.
        }
      }
    }
    beds.clear();
  };

  const ensureDecoded = (loaded: LoadedCue): Promise<void> => {
    if (graph === null || loaded.buffer !== null) return Promise.resolve();
    if (loaded.decoding !== null) return loaded.decoding;
    const context = graph.context;
    loaded.decoding = decodeCue(context, loaded.bytes, loaded.cue.expectedSamples)
      .then((buffer) => {
        // Still the registered entry, and still the context it was decoded for.
        if (cues.get(loaded.cue.id) === loaded && graph?.context === context) {
          loaded.buffer = buffer;
          applyBeds();
        }
      })
      .catch(() => {
        // Undecodable: the cue stays silent and the engine stays up.
      })
      .finally(() => {
        loaded.decoding = null;
      });
    return loaded.decoding;
  };

  const decodeAll = (): Promise<void> =>
    Promise.all([...cues.values()].map(ensureDecoded)).then(() => undefined);

  /**
   * Opens the context and returns the graph it built, rather than a boolean:
   * the callers need the graph itself, and a side-effect-plus-flag signature
   * leaves the compiler nothing to narrow `graph` with after the call.
   */
  const openContext = (): Graph | null => {
    try {
      const context = deps.createContext();
      graph = buildGraph(context);
      bankGesture(context);
      return graph;
    } catch {
      graph = null;
      return null;
    }
  };

  const applyDuck = (targets: DuckTargets, holdMs: number): void => {
    if (graph === null) return;
    const now = graph.context.currentTime;
    const at = now + holdMs / 1000;
    const offsets: readonly (readonly [BusName, number])[] = [
      ["ambience", targets.ambienceDb],
      ["music", targets.musicDb],
      ["sfx", targets.sfxDb],
    ];
    for (const [bus, offsetDb] of offsets) {
      const param = graph.buses[bus].gain;
      const tau = offsetDb < duckDb[bus] ? DUCK_ATTACK_TAU_S : DUCK_RELEASE_TAU_S;
      try {
        // Cancelling from now drops a release still waiting out its hold; an
        // approach already under way keeps going until the new one starts.
        param.cancelScheduledValues(now);
        param.setTargetAtTime(dbToLinear(BUS_GAIN_DB[bus] + offsetDb), at, tau);
      } catch {
        // A param that refuses automation keeps its level; nothing else changes.
      }
      duckDb[bus] = offsetDb;
    }
  };

  const play = (cueId: string, options: CuePlayOptions = {}): boolean => {
    if (disposed || !enabled || graph === null) return false;
    const loaded = cues.get(cueId);
    if (loaded === undefined || loaded.buffer === null || loaded.cue.loop) return false;
    const { context, buses } = graph;
    const { cue } = loaded;
    let gainDb = cue.gainDb + (options.gainDb ?? 0);
    let halfLength = options.halfLength === true;
    if (cue.bus === "sfx") {
      const verdict = admitVoice(budget, cueId, nowMs(), cue.durationMs);
      budget = verdict.state;
      if (!verdict.admission.admitted) return false;
      gainDb += verdict.admission.gainDb;
      halfLength = halfLength || verdict.admission.halfLength;
    }
    try {
      const source = context.createBufferSource();
      source.buffer = loaded.buffer;
      const detuneCents = options.detuneCents ?? 0;
      if (detuneCents !== 0) {
        try {
          source.detune.value = detuneCents;
        } catch {
          // No detune on this engine: the cue plays in tune.
        }
      }
      const gain = context.createGain();
      gain.gain.value = dbToLinear(gainDb);
      source.connect(gain);
      gain.connect(buses[cue.bus]);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      const at = context.currentTime;
      if (halfLength) source.start(at, 0, loaded.buffer.duration / 2);
      else source.start(at);
      playLog.push({ cueId, atMs: nowMs(), bus: cue.bus });
      return true;
    } catch {
      return false;
    }
  };

  const loadCues = (list: readonly Cue[], signal?: AbortSignal): Promise<void> =>
    Promise.all(
      list.map(async (cue) => {
        if (disposed) return;
        const existing = cues.get(cue.id);
        if (existing !== undefined && existing.cue.file === cue.file) {
          await ensureDecoded(existing);
          return;
        }
        let bytes: ArrayBuffer;
        try {
          bytes = await deps.fetchBytes(cue.file, signal);
        } catch {
          return; // A missing file is a silent cue, not a broken quiz.
        }
        if (isDisposed() || signal?.aborted === true) return;
        const loaded: LoadedCue = { cue, bytes, buffer: null, decoding: null };
        cues.set(cue.id, loaded);
        await ensureDecoded(loaded);
      }),
    ).then(() => undefined);

  const unlock = async (): Promise<boolean> => {
    if (disposed) return false;
    let active = graph;
    if (active === null) {
      active = openContext();
      if (active === null) return false;
      unlocked = true;
      void decodeAll();
    }
    const context = active.context;
    try {
      await context.resume();
    } catch {
      // Refused outside a gesture: the interruption adapter resumes on the next pointerdown.
    }
    return context.state === "running";
  };

  const rebuild = async (): Promise<MixerContext | null> => {
    if (disposed || graph === null) return null;
    const old = graph;
    stopBedsNow();
    graph = null;
    try {
      await old.context.close();
    } catch {
      // A context that will not close is abandoned to the collector.
    }
    for (const loaded of cues.values()) {
      loaded.buffer = null;
      loaded.decoding = null;
    }
    const reopened = openContext();
    if (reopened === null) return null;
    for (const bus of BUS_NAMES) duckDb[bus] = 0;
    ducker = IDLE_DUCKER;
    await decodeAll();
    applyBeds();
    return reopened.context;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopBedsNow();
    if (graph !== null) {
      void graph.context.close().catch(() => undefined);
      graph = null;
    }
    cues.clear();
    playLog.length = 0;
    unlocked = false;
  };

  return {
    get unlocked() {
      return unlocked;
    },
    get enabled() {
      return enabled;
    },
    get context() {
      return graph?.context ?? null;
    },
    unlock,
    setEnabled(on) {
      enabled = on;
      applyBeds();
    },
    loadCues,
    play,
    setBed(mix) {
      requestedMix = mix;
      applyBeds();
    },
    setBedsHeld(nextHeld) {
      held = nextHeld;
      applyBeds();
    },
    duck(targets) {
      applyDuck(targets, 0);
    },
    onVoiceEvent(event: VoiceEvent) {
      const result = reduceDucker(ducker, event);
      ducker = result.state;
      if (result.command !== null) applyDuck(result.command.targets, result.command.holdMs);
    },
    beginScene() {
      budget = beginSceneBudget(budget);
    },
    rebuild,
    get residentBytes() {
      let bytes = 0;
      for (const loaded of cues.values()) {
        if (loaded.buffer !== null) bytes += loaded.buffer.length * loaded.buffer.numberOfChannels * 4;
      }
      return bytes;
    },
    get playLog() {
      return playLog;
    },
    dispose,
  };
}
