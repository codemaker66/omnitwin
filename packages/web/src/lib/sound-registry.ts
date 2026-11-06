import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isUnownedRequest, type VenueRequest } from "@omnitwin/types";
import {
  PLANNER_SOUND_MIN_GAP_MS,
  PLANNER_SOUND_RECIPES,
  varyRecipe,
  type PlannerSoundId,
  type PlannerSoundRecipe,
  type PlannerSoundVariation,
} from "./planner-sound-recipes.js";
import { dbToGain, renderHallImpulse, renderPlannerSound } from "./planner-sound-render.js";

// ---------------------------------------------------------------------------
// The sound registry: every sound Venviewer can make, in one place.
//
// Callers: WhenRibbon.tsx (createSnapTick and the tick preference),
// ChimeToggle.tsx and RequestsProvider.tsx (the arrival chime),
// pages/LandingPage.tsx with ContemplationAct.tsx (room tone), and the
// planner's chrome (components/planner-chrome/, the planner palette). The toolbar
// tick and click players have no caller in the app today; they are kept as
// they were in lib/toolbar-sounds.ts. No other source file may make sound
// (sound-registry.test.ts scans the source for Web Audio and audio elements,
// with the convener's recorded narration as its one named exception). This
// replaces lib/toolbar-sounds.ts, components/requests/arrival-chime.ts,
// components/editor/cockpit/when-ribbon-tick.ts and pages/landing/useRoomTone.ts.
//
// Sound is opt-in everywhere (goal 01 section 5). Each entry below names one
// sound, says how a person turns it on, and where that choice is kept. Every
// sound is played through `admit`, which refuses an id that is not listed
// here, so a new sound cannot slip in without being registered and without
// the opt-in being stated. Audio off loses nothing: no sound here is the only
// signal for anything; the words and the rings on the page carry the meaning.
// ---------------------------------------------------------------------------

export type SoundOptIn =
  /** Muted when the page loads; a control unmutes it for this page only. */
  | "session-toggle"
  /** Off until the person turns it on; the choice is kept on this device. */
  | "device-toggle";

export interface SoundDefinition {
  readonly label: string;
  readonly optIn: SoundOptIn;
  /** localStorage key for a device-level choice; null when nothing is kept. */
  readonly storageKey: string | null;
}

export const CHIME_STORAGE_KEY = "venviewer.chime-on-arrivals";
export const TICK_PREFERENCE_KEY = "venviewer.when-ribbon.tick";
/** The planner's Off · Quiet · Full, kept on this device (T-671, spec section 9). */
export const PLANNER_SOUND_STORAGE_KEY = "venviewer.planner-sound";
export const PLANNER_SOUND_LEVEL_KEY = "venviewer.planner-sound-level";

export const SOUND_REGISTRY = {
  "toolbar-tick": { label: "Toolbar arc tick", optIn: "session-toggle", storageKey: null },
  "toolbar-click": { label: "Toolbar activation click", optIn: "session-toggle", storageKey: null },
  "arrival-chime": { label: "Arrival chime on the requests board", optIn: "device-toggle", storageKey: CHIME_STORAGE_KEY },
  "snap-tick": { label: "When ribbon quarter-hour tick", optIn: "device-toggle", storageKey: TICK_PREFERENCE_KEY },
  "room-tone": { label: "Room tone on the landing page", optIn: "session-toggle", storageKey: null },
  // The planner's palette: every one chosen together, Off · Quiet · Full, on this device.
  "planner-set-table": { label: "Planner: a table set down", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-set-chair": { label: "Planner: a chair set down", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-refuse": { label: "Planner: a placement refused", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-cue": { label: "Planner: the hour crossing an act", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-horizon": { label: "Planner: the sun crossing the horizon", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-send": { label: "Planner: sent, confirmed", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-present": { label: "Planner: the evening begins", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-act": { label: "Planner: a new act while the evening plays", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-lift": { label: "Planner: a piece picked up", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-snap": { label: "Planner: a piece locking to a guide", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-measure": { label: "Planner: a measurement pinned", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-hour": { label: "Planner: the dragged hour crossing a whole hour", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
  "planner-brush": { label: "Planner: Lay out placing several pieces", optIn: "device-toggle", storageKey: PLANNER_SOUND_STORAGE_KEY },
} as const satisfies Readonly<Record<string, SoundDefinition>>;

export type SoundId = keyof typeof SOUND_REGISTRY;

export function isRegisteredSound(id: string): id is SoundId {
  return Object.prototype.hasOwnProperty.call(SOUND_REGISTRY, id);
}

export interface SoundAttempt {
  readonly id: string;
  readonly admitted: boolean;
}

const attemptListeners = new Set<(attempt: SoundAttempt) => void>();

/** Watch every attempt to play a sound, admitted or refused. Used by tests. */
export function subscribeSoundAttempts(listener: (attempt: SoundAttempt) => void): () => void {
  attemptListeners.add(listener);
  return () => { attemptListeners.delete(listener); };
}

/**
 * The one gate. Returns true only for a registered id; an unknown id makes no
 * sound and is reported to watchers as refused.
 */
function admit(id: string): id is SoundId {
  const admitted = isRegisteredSound(id);
  for (const listener of [...attemptListeners]) listener({ id, admitted });
  return admitted;
}

/**
 * Ask to play a sound by id. Only the ids in SOUND_REGISTRY are accepted; the
 * return value says whether the id was admitted (not whether the device had
 * audio). The named players below are how the app makes each sound.
 */
export function requestSound(id: string): boolean {
  return admit(id);
}

function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// --- Toolbar ticks (muted until the page unmutes them) ---------------------

let toolbarMuted = true;
let toolbarCtx: AudioContext | null = null;

function toolbarContext(): AudioContext | null {
  if (toolbarMuted) return null;
  if (toolbarCtx === null) {
    try {
      toolbarCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return toolbarCtx;
}

/** Toggle global mute for toolbar sounds. Returns new muted state. */
export function toggleToolbarMute(): boolean {
  toolbarMuted = !toolbarMuted;
  return toolbarMuted;
}

/** Returns true if toolbar sounds are muted. */
export function isToolbarMuted(): boolean {
  return toolbarMuted;
}

/** Set toolbar sound mute state directly. */
export function setToolbarMuted(value: boolean): void {
  toolbarMuted = value;
}

/**
 * A short pitched tick, used for the arc open and close stagger.
 *
 * @param frequency  Base frequency in Hz (800-1300 range).
 * @param delay      Delay in seconds before playing.
 * @param volume     Gain (0-1), default very low.
 */
export function playTick(frequency: number, delay: number = 0, volume: number = 0.04): void {
  if (!admit("toolbar-tick")) return;
  const ctx = toolbarContext();
  if (ctx === null) return;

  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}

/** Ascending tick series for arc opening; each tool a step higher. */
export function playArcOpenSound(count: number, staggerMs: number = 40): void {
  const baseFreq = 800;
  const step = 100;
  for (let i = 0; i < count; i++) {
    playTick(baseFreq + i * step, (i * staggerMs) / 1000);
  }
}

/** Descending tick series for arc closing (reverse order, slightly faster). */
export function playArcCloseSound(count: number, staggerMs: number = 35): void {
  const baseFreq = 800;
  const step = 100;
  for (let i = 0; i < count; i++) {
    const toolIndex = count - 1 - i;
    playTick(baseFreq + toolIndex * step, (i * staggerMs) / 1000);
  }
}

/**
 * A crisp activation click, a short transient at a tool-specific pitch.
 *
 * @param toolIndex  Tool position in arc (0-4), maps to pitch.
 */
export function playActivationClick(toolIndex: number): void {
  if (!admit("toolbar-click")) return;
  const ctx = toolbarContext();
  if (ctx === null) return;

  const now = ctx.currentTime;
  const freq = 2000 + toolIndex * 400;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.04);

  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}

// --- The arrival chime (goal 19 S4; opt-in, per device) --------------------
//
// One plain bell when a request lands that nobody owns and that this person
// did not raise, and one when a request is escalated to this administrator;
// never on a tick, never repeated. The AudioContext is made inside the
// toggle's own press, because browsers unlock audio on a gesture. Sound is
// not motion: reduced motion does not silence it.

const chimeListeners = new Set<() => void>();
let chimeCtx: AudioContext | null = null;

/** Whether this device chimes on arrivals. Off until somebody turns it on. */
export function isChimeEnabled(): boolean {
  try {
    return deviceStorage()?.getItem(CHIME_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setChimeEnabled(value: boolean): void {
  try {
    deviceStorage()?.setItem(CHIME_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // A full or blocked store: the setting lives for this page only.
  }
  for (const listener of [...chimeListeners]) listener();
}

export function subscribeChime(listener: () => void): () => void {
  chimeListeners.add(listener);
  return () => { chimeListeners.delete(listener); };
}

function chimeContext(): AudioContext | null {
  if (chimeCtx !== null) return chimeCtx;
  if (typeof AudioContext === "undefined") return null;
  try {
    chimeCtx = new AudioContext();
  } catch {
    return null;
  }
  return chimeCtx;
}

/** Make the context inside a gesture, so the chimes that come later may play. */
export function unlockChime(): void {
  const ctx = chimeContext();
  if (ctx !== null && ctx.state === "suspended") void ctx.resume();
}

/**
 * One plain bell, about 400 ms: a fundamental and a soft fifth above it,
 * each fading as a struck bell does. Returns false when the chime is off or
 * the device cannot play, so a caller can tell a silence from a chime.
 */
export function playArrivalChime(): boolean {
  if (!isChimeEnabled()) return false;
  if (!admit("arrival-chime")) return false;
  const ctx = chimeContext();
  if (ctx === null) return false;
  const now = ctx.currentTime;
  for (const [frequency, peak, seconds] of [[880, 0.12, 0.42], [1320, 0.05, 0.3]] as const) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + seconds);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + seconds + 0.02);
  }
  return true;
}

// WHICH ARRIVALS CHIME is a pure decision over two snapshots, so "once per
// arrival" is a fact about data rather than a hope about a timer: a request
// chimes when it is first seen, and an escalation when escalatedAt first
// appears, and the first snapshot after mount chimes for nothing at all.

/** The last snapshot as the policy remembers it: request id to escalatedAt. */
export type ChimeMemory = ReadonlyMap<string, string | null>;

export interface ChimeDecision {
  /** Requests that landed since the last snapshot, unowned, not this person's own ask. */
  readonly arrivals: readonly string[];
  /** Requests escalated to this administrator since the last snapshot. */
  readonly escalations: readonly string[];
}

export function rememberForChime(requests: readonly VenueRequest[]): ChimeMemory {
  return new Map(requests.map((request) => [request.id, request.escalatedAt]));
}

/**
 * Pure: which of the requests in a fresh snapshot chime for this person. The
 * first snapshot after mount (no memory yet) chimes for nothing, so opening
 * the board on a busy afternoon is silent; a request already known chimes
 * only when it is newly escalated and this person is an administrator; a
 * request both new and escalated chimes once, as an arrival.
 */
export function chimeWorthy(
  previous: ChimeMemory | null,
  current: readonly VenueRequest[],
  me: { readonly id: string; readonly role: string },
): ChimeDecision {
  if (previous === null) return { arrivals: [], escalations: [] };
  const arrivals: string[] = [];
  const escalations: string[] = [];
  for (const request of current) {
    if (!previous.has(request.id)) {
      if (isUnownedRequest(request) && request.requestedByUserId !== me.id) arrivals.push(request.id);
      continue;
    }
    if (me.role === "admin" && request.escalatedAt !== null && previous.get(request.id) === null) {
      escalations.push(request.id);
    }
  }
  return { arrivals, escalations };
}

/** Test seam: forget the audio context between cases. */
export function __resetChimeForTests(): void {
  chimeCtx = null;
}

// --- The When ribbon snap tick (goal 19 S6; opt-in, per device) ------------
// A soft tick each time the bar's landing snaps to a new quarter hour. Off
// until the person turns it on, remembered on this device only, and never on
// the Diary board: the ribbon is the one place a hand is on the clock.

type PreferenceStore = Pick<Storage, "getItem" | "setItem">;

export function readTickPreference(store: PreferenceStore | null = deviceStorage()): boolean {
  try {
    return store?.getItem(TICK_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeTickPreference(on: boolean, store: PreferenceStore | null = deviceStorage()): void {
  try {
    store?.setItem(TICK_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // A private window or a full store: the choice lasts for this page only.
  }
}

/** The smallest slice of Web Audio the tick needs, structurally, so a test
 *  can stand in without a cast and a real AudioContext still fits. */
export interface TickParam {
  readonly setValueAtTime: (value: number, startTime: number) => unknown;
  readonly exponentialRampToValueAtTime: (value: number, endTime: number) => unknown;
}
export interface TickOscillator {
  type: OscillatorType;
  readonly frequency: TickParam;
  connect(destination: object): unknown;
  readonly start: (when?: number) => void;
  readonly stop: (when?: number) => void;
}
export interface TickGain {
  readonly gain: TickParam;
  connect(destination: object): unknown;
}
export interface TickAudio {
  readonly currentTime: number;
  readonly destination: object;
  readonly state: AudioContextState;
  readonly createOscillator: () => TickOscillator;
  readonly createGain: () => TickGain;
  readonly resume: () => Promise<void>;
}

function defaultTickAudio(): TickAudio | null {
  if (typeof AudioContext === "undefined") return null;
  return new AudioContext();
}

/**
 * A player whose first call creates the audio context (a drag is a gesture,
 * so the browser allows it). About 40 ms of a quiet triangle wave at 1.2 kHz
 * with a fast exponential fall: a tick, not a beep.
 */
export function createSnapTick(audioFactory: () => TickAudio | null = defaultTickAudio): () => void {
  let audio: TickAudio | null | undefined;
  return () => {
    if (!admit("snap-tick")) return;
    if (audio === undefined) audio = audioFactory();
    if (audio === null) return;
    if (audio.state === "suspended") void audio.resume();
    const at = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1200, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.05, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.045);
  };
}

// --- Room tone: the acoustic of the empty hall, synthesised ----------------
//
// No audio asset ships with the page. On the first toggle we build the sound
// from nodes: looped brown noise (the air of a large room) through a low-pass
// at 220 Hz (stone walls swallow the highs), a high-pass at 40 Hz (no rumble),
// and a 0.07 Hz LFO breathing 20 % across the master gain. Volume is
// deliberately low: room tone is felt, not heard. OFF by default, never
// autoplay, fades in and out over about 1.2 s, and suspends the AudioContext
// when silent so no thread runs for a muted page.

const TONE_VOLUME = 0.055;
const FADE_SECONDS = 1.2;

interface ToneGraph {
  readonly context: AudioContext;
  readonly master: GainNode;
}

function buildToneGraph(): ToneGraph {
  const context = new AudioContext();

  // Two seconds of brown noise, looped. Brown (integrated white) reads as
  // air-in-a-large-volume rather than static.
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 220;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 40;

  // The hall breathes: a very slow LFO swings the tone gain by 20 %.
  const breath = context.createGain();
  breath.gain.value = 1;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.2;
  lfo.connect(lfoDepth);
  lfoDepth.connect(breath.gain);

  const master = context.createGain();
  master.gain.value = 0;

  source.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(breath);
  breath.connect(master);
  master.connect(context.destination);

  source.start();
  lfo.start();

  return { context, master };
}

export interface RoomTone {
  /** False when the environment has no Web Audio (toggle hidden). */
  readonly supported: boolean;
  readonly playing: boolean;
  readonly toggle: () => void;
}

export function useRoomTone(): RoomTone {
  const supported =
    typeof window !== "undefined" && typeof window.AudioContext === "function";
  const [playing, setPlaying] = useState<boolean>(false);
  const graphRef = useRef<ToneGraph | null>(null);
  // Pending fade-out suspend; cleared when a toggle-on supersedes it so a
  // stale timeout can never mute a tone the visitor just re-enabled.
  const suspendTimerRef = useRef<number | null>(null);

  const toggle = useCallback((): void => {
    if (!supported) {
      return;
    }
    if (!admit("room-tone")) return;
    if (graphRef.current === null) {
      try {
        graphRef.current = buildToneGraph();
      } catch {
        return; // Audio blocked by the environment: stay silent, stay calm.
      }
    }
    const { context, master } = graphRef.current;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    if (suspendTimerRef.current !== null) {
      window.clearTimeout(suspendTimerRef.current);
      suspendTimerRef.current = null;
    }
    if (playing) {
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      suspendTimerRef.current = window.setTimeout(() => {
        suspendTimerRef.current = null;
        // Suspend only if still silent when the fade lands.
        if (graphRef.current !== null) {
          void graphRef.current.context.suspend();
        }
      }, FADE_SECONDS * 1000 + 50);
      setPlaying(false);
    } else {
      void context.resume();
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(TONE_VOLUME, now + FADE_SECONDS);
      setPlaying(true);
    }
  }, [supported, playing]);

  useEffect(() => {
    return () => {
      if (suspendTimerRef.current !== null) {
        window.clearTimeout(suspendTimerRef.current);
        suspendTimerRef.current = null;
      }
      if (graphRef.current !== null) {
        void graphRef.current.context.close();
        graphRef.current = null;
      }
    };
  }, []);

  return { supported, playing, toggle };
}

// --- The planner's palette (T-671, spec section 9; opt-in, per device) -------
//
// Thirteen short sounds for the planner, in two sets (lib/planner-sound-recipes.ts):
// Quiet plays the set-downs, the refusal, the cue and the four rare moments
// (the horizon, Send, Present, an act); Full adds the small sounds of the hand.
// The speaker in the chrome's utilities chooses Off, Quiet or Full and a level,
// kept on this device; Shift M mutes and unmutes, the master falling away over
// 30 ms. Off until chosen, as every sound here is: Blake's decision D1 may make
// Quiet the default, and it is PLANNER_SOUND_DEFAULT_MODE alone.
//
// Each sound is rendered from its recipe by lib/planner-sound-render.ts and
// played as exactly those samples (the bus's 6 kHz low-pass is in the render):
// one gain per sound, the master, and a limiter at −12 dB (ratio 12, attack
// 3 ms, release 120 ms) with a trim after it that takes back the makeup gain a
// DynamicsCompressorNode adds to everything (+6.6 dB here, measured in
// Chromium), so the palette's levels are what plays and the limiter only
// limits. The rare moments also pass through a synthesised hall,
// 14 dB under the dry sound before their own send level. One context, made
// inside the first deliberate gesture and suspended after 20 s of silence.
// Nothing plays when Off, before a gesture or in a hidden tab; a sound waits at
// least 45 ms after itself (longer where its recipe says), no more than eight
// play in a second, and a burst keeps only its first three within 250 ms.

export type PlannerSoundMode = "off" | "quiet" | "full";

/** Quiet by default, armed only by the first deliberate gesture (Blake's D1, 25 Oct 2026). */
export const PLANNER_SOUND_DEFAULT_MODE: PlannerSoundMode = "quiet";
export const PLANNER_SOUND_DEFAULT_LEVEL = 0.6;

export const PLANNER_SOUND_MAX_PER_SECOND = 8;
export const PLANNER_SOUND_BURST_WINDOW_MS = 250;
export const PLANNER_SOUND_BURST_LIMIT = 3;
export const PLANNER_SOUND_SILENCE_SUSPEND_MS = 20_000;
export const PLANNER_SOUND_MUTE_FADE_SECONDS = 0.03;
const PLANNER_HALL_WET_DB = -14;

/** The limiter (spec 9): a hard knee at −12 dB, ratio 12, attack 3 ms, release 120 ms. */
export const PLANNER_LIMITER = { thresholdDb: -12, ratio: 12, attackSeconds: 0.003, releaseSeconds: 0.12 } as const;

/**
 * The makeup gain a hard-knee DynamicsCompressorNode adds to every signal (Web
 * Audio API, the compressor's processing: the inverse of the curve's gain at
 * 0 dBFS, to the power 0.6). For the planner's limiter it is +6.6 dB, which
 * Chromium 147 measures as 6.5999 dB under the threshold.
 */
export function limiterMakeupDb(thresholdDb: number, ratio: number): number {
  const fullRangeDb = thresholdDb + (0 - thresholdDb) / ratio;
  return -0.6 * fullRangeDb;
}

/**
 * A new compressor's detector starts from nothing, so for its first 125 ms it
 * holds a sound down (−6.8 dB at the start, measured). Offline renders start
 * each sound this long after the context, as a live one would play.
 */
const PLANNER_LIMITER_WARMUP_SECONDS = 0.25;
/** In Quiet, Lay out's brush is a cascade of at most three set-downs this far apart, each 4 dB down. */
const PLANNER_CASCADE_GAP_SECONDS = 0.055;
const PLANNER_CASCADE_LEVEL_DB = -4;

export interface PlannerSoundSettings {
  readonly mode: PlannerSoundMode;
  /** The master, 0 to 1. */
  readonly level: number;
}

function isPlannerSoundMode(value: string | null): value is PlannerSoundMode {
  return value === "off" || value === "quiet" || value === "full";
}

function readPlannerSoundSettings(): PlannerSoundSettings {
  const store = deviceStorage();
  let mode: PlannerSoundMode = PLANNER_SOUND_DEFAULT_MODE;
  let level = PLANNER_SOUND_DEFAULT_LEVEL;
  try {
    const keptMode = store?.getItem(PLANNER_SOUND_STORAGE_KEY) ?? null;
    if (isPlannerSoundMode(keptMode)) mode = keptMode;
    const keptLevel = Number(store?.getItem(PLANNER_SOUND_LEVEL_KEY) ?? Number.NaN);
    if (Number.isFinite(keptLevel)) level = Math.min(1, Math.max(0, keptLevel));
  } catch {
    // A private window or a blocked store: the defaults, for this page.
  }
  return { mode, level };
}

let plannerSettings: PlannerSoundSettings | null = null;
/** The last audible choice, so Shift M brings back what was muted. */
let plannerLastAudible: Exclude<PlannerSoundMode, "off"> = "quiet";
const plannerListeners = new Set<() => void>();

export function getPlannerSoundSettings(): PlannerSoundSettings {
  plannerSettings ??= readPlannerSoundSettings();
  return plannerSettings;
}

export function subscribePlannerSound(listener: () => void): () => void {
  plannerListeners.add(listener);
  return () => { plannerListeners.delete(listener); };
}

function keepPlannerSoundSettings(next: PlannerSoundSettings): void {
  plannerSettings = next;
  try {
    deviceStorage()?.setItem(PLANNER_SOUND_STORAGE_KEY, next.mode);
    deviceStorage()?.setItem(PLANNER_SOUND_LEVEL_KEY, String(next.level));
  } catch {
    // Kept for this page only.
  }
  for (const listener of [...plannerListeners]) listener();
}

/** The planner's sound settings, for the speaker. */
export function usePlannerSoundSettings(): PlannerSoundSettings {
  return useSyncExternalStore(subscribePlannerSound, getPlannerSoundSettings, getPlannerSoundSettings);
}

// The rules a sound must pass, kept apart from the audio so they can be tested
// against a clock of their own.

export type PlannerSoundRefusal = "off" | "not-in-set" | "not-armed" | "hidden" | "too-soon" | "too-many" | "burst";

export interface PlannerSoundGate {
  readonly mode: PlannerSoundMode;
  readonly armed: boolean;
  readonly hidden: boolean;
  readonly nowMs: number;
}

export class PlannerSoundPolicy {
  private readonly lastPlayed = new Map<PlannerSoundId, number>();
  private played: number[] = [];

  decide(id: PlannerSoundId, gate: PlannerSoundGate): PlannerSoundRefusal | "play" {
    const recipe = PLANNER_SOUND_RECIPES[id];
    if (gate.mode === "off") return "off";
    if (gate.mode === "quiet" && recipe.set === "full") return "not-in-set";
    if (!gate.armed) return "not-armed";
    if (gate.hidden) return "hidden";
    const last = this.lastPlayed.get(id);
    if (last !== undefined && gate.nowMs - last < Math.max(recipe.gapMs, PLANNER_SOUND_MIN_GAP_MS)) return "too-soon";
    this.played = this.played.filter((at) => gate.nowMs - at < 1000);
    if (this.played.length >= PLANNER_SOUND_MAX_PER_SECOND) return "too-many";
    const inBurst = this.played.filter((at) => gate.nowMs - at < PLANNER_SOUND_BURST_WINDOW_MS).length;
    if (inBurst >= PLANNER_SOUND_BURST_LIMIT) return "burst";
    return "play";
  }

  record(id: PlannerSoundId, nowMs: number, count = 1): void {
    this.lastPlayed.set(id, nowMs);
    for (let i = 0; i < count; i += 1) this.played.push(nowMs);
  }
}

// The audio itself. The context and its graph exist only once someone has
// chosen sound and made a deliberate gesture.

interface PlannerGraph {
  readonly context: BaseAudioContext;
  readonly master: GainNode;
  readonly dry: GainNode;
  readonly hall: GainNode;
}

type PlannerContextFactory = () => AudioContext | null;

const defaultPlannerContextFactory: PlannerContextFactory = () => {
  if (typeof AudioContext === "undefined") return null;
  try {
    return new AudioContext({ latencyHint: "interactive" });
  } catch {
    return null;
  }
};

let plannerContextFactory: PlannerContextFactory = defaultPlannerContextFactory;
let plannerLive: { readonly context: AudioContext; readonly graph: PlannerGraph } | null = null;
let plannerPolicy = new PlannerSoundPolicy();
let plannerSilenceTimer: number | null = null;
const plannerBufferCache = new Map<string, AudioBuffer>();

function buildPlannerGraph(context: BaseAudioContext, level: number): PlannerGraph {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = PLANNER_LIMITER.thresholdDb;
  limiter.ratio.value = PLANNER_LIMITER.ratio;
  limiter.attack.value = PLANNER_LIMITER.attackSeconds;
  limiter.release.value = PLANNER_LIMITER.releaseSeconds;
  limiter.knee.value = 0;
  // The compressor's own makeup gain, taken back.
  const trim = context.createGain();
  trim.gain.value = dbToGain(-limiterMakeupDb(PLANNER_LIMITER.thresholdDb, PLANNER_LIMITER.ratio));
  limiter.connect(trim);
  trim.connect(context.destination);
  const master = context.createGain();
  master.gain.value = level;
  master.connect(limiter);
  const dry = context.createGain();
  dry.connect(master);
  const impulse = renderHallImpulse(context.sampleRate);
  const impulseBuffer = context.createBuffer(1, impulse.length, context.sampleRate);
  impulseBuffer.getChannelData(0).set(impulse);
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = impulseBuffer;
  const wet = context.createGain();
  wet.gain.value = dbToGain(PLANNER_HALL_WET_DB);
  convolver.connect(wet);
  wet.connect(master);
  const hall = context.createGain();
  hall.connect(convolver);
  return { context, master, dry, hall };
}

function plannerBuffer(context: BaseAudioContext, recipe: PlannerSoundRecipe, cacheKey: string | null, seed: number): AudioBuffer {
  const key = cacheKey === null ? null : `${cacheKey}@${String(context.sampleRate)}`;
  const kept = key === null ? undefined : plannerBufferCache.get(key);
  if (kept !== undefined) return kept;
  const samples = renderPlannerSound(recipe, { sampleRate: context.sampleRate, seed });
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  if (key !== null) plannerBufferCache.set(key, buffer);
  return buffer;
}

/** Starts one sound on the graph at `atSeconds`, `levelDb` above or below its recipe. */
function startPlannerSound(graph: PlannerGraph, recipe: PlannerSoundRecipe, atSeconds: number, levelDb: number, cacheKey: string | null, seed: number): void {
  const { context } = graph;
  const source = context.createBufferSource();
  source.buffer = plannerBuffer(context, recipe, cacheKey, seed);
  const gain = context.createGain();
  gain.gain.value = dbToGain(levelDb);
  source.connect(gain);
  gain.connect(graph.dry);
  let send: GainNode | null = null;
  if (recipe.hallSendDb !== null) {
    send = context.createGain();
    send.gain.value = dbToGain(recipe.hallSendDb);
    gain.connect(send);
    send.connect(graph.hall);
  }
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    send?.disconnect();
  };
  source.start(atSeconds);
}

function restartPlannerSilenceTimer(): void {
  if (plannerSilenceTimer !== null) window.clearTimeout(plannerSilenceTimer);
  plannerSilenceTimer = window.setTimeout(() => {
    plannerSilenceTimer = null;
    if (plannerLive !== null && plannerLive.context.state === "running") void plannerLive.context.suspend();
  }, PLANNER_SOUND_SILENCE_SUSPEND_MS);
}

/**
 * Called inside a deliberate gesture (a press or a key): makes the context, so
 * later sounds may play. Nothing is made while sound is Off.
 */
export function armPlannerSound(): boolean {
  const { mode, level } = getPlannerSoundSettings();
  if (mode === "off") return false;
  if (plannerLive === null) {
    const context = plannerContextFactory();
    if (context === null) return false;
    plannerLive = { context, graph: buildPlannerGraph(context, level) };
  }
  if (plannerLive.context.state === "suspended") void plannerLive.context.resume();
  return true;
}

/** While mounted, the first press or key anywhere arms the planner's sound. */
export function usePlannerSoundArming(): void {
  useEffect(() => {
    const arm = (): void => { armPlannerSound(); };
    window.addEventListener("pointerdown", arm, { capture: true });
    window.addEventListener("keydown", arm, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", arm, { capture: true });
      window.removeEventListener("keydown", arm, { capture: true });
    };
  }, []);
}

function fadeMasterTo(target: number): void {
  if (plannerLive === null) return;
  const { context, graph } = plannerLive;
  const now = context.currentTime;
  graph.master.gain.cancelScheduledValues(now);
  graph.master.gain.setValueAtTime(graph.master.gain.value, now);
  graph.master.gain.linearRampToValueAtTime(target, now + PLANNER_SOUND_MUTE_FADE_SECONDS);
}

export function setPlannerSoundMode(mode: PlannerSoundMode): void {
  const current = getPlannerSoundSettings();
  if (current.mode === mode) return;
  if (mode !== "off") plannerLastAudible = mode;
  keepPlannerSoundSettings({ ...current, mode });
  fadeMasterTo(mode === "off" ? 0 : current.level);
}

export function setPlannerSoundLevel(level: number): void {
  const current = getPlannerSoundSettings();
  const clamped = Math.min(1, Math.max(0, level));
  keepPlannerSoundSettings({ ...current, level: clamped });
  if (current.mode !== "off") fadeMasterTo(clamped);
}

/** Shift M: mute, or bring back what was muted. Returns the mode now. */
export function togglePlannerSoundMute(): PlannerSoundMode {
  const { mode } = getPlannerSoundSettings();
  if (mode === "off") {
    setPlannerSoundMode(plannerLastAudible);
  } else {
    plannerLastAudible = mode;
    setPlannerSoundMode("off");
  }
  return getPlannerSoundSettings().mode;
}

function plannerSoundHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Play one of the planner's sounds. Returns whether it played: false when the
 * id is not registered, sound is off or this sound is not in the chosen set,
 * nothing has armed it, the tab is hidden, or a rate rule holds it back.
 */
export function playPlannerSound(id: PlannerSoundId, variation: PlannerSoundVariation = {}): boolean {
  if (!admit(id)) return false;
  const { mode } = getPlannerSoundSettings();
  const graph = plannerLive?.graph ?? null;
  const nowMs = performance.now();
  // In Quiet, Lay out's brush is a cascade of at most three set-downs.
  const cascade = id === "planner-brush" && mode === "quiet";
  const deciding: PlannerSoundId = cascade ? "planner-set-table" : id;
  const verdict = plannerPolicy.decide(deciding, { mode, armed: graph !== null, hidden: plannerSoundHidden(), nowMs });
  if (verdict !== "play" || graph === null || plannerLive === null) return false;
  const { context } = plannerLive;
  if (context.state === "suspended") void context.resume();
  const at = context.currentTime;
  if (cascade) {
    const setDown = PLANNER_SOUND_RECIPES["planner-set-table"];
    for (let i = 0; i < PLANNER_SOUND_BURST_LIMIT; i += 1) {
      startPlannerSound(graph, setDown, at + i * PLANNER_CASCADE_GAP_SECONDS, PLANNER_CASCADE_LEVEL_DB, "planner-set-table", 0x5eed);
    }
    plannerPolicy.record(deciding, nowMs, PLANNER_SOUND_BURST_LIMIT);
  } else {
    const recipe = PLANNER_SOUND_RECIPES[id];
    let played = recipe;
    let levelDb = 0;
    let cacheKey: string | null = id;
    if (recipe.vary !== null) {
      // Each set-down is a little different: ±3 % in pitch, ±1 dB in level.
      played = varyRecipe(recipe, { pitchScale: 1 + (Math.random() * 2 - 1) * recipe.vary.pitch });
      levelDb = (Math.random() * 2 - 1) * recipe.vary.levelDb;
      cacheKey = null;
    }
    if (variation.pitchScale !== undefined || variation.glide !== undefined) {
      played = varyRecipe(played, variation);
      cacheKey = null;
    }
    levelDb += variation.levelDb ?? 0;
    startPlannerSound(graph, played, at, levelDb, cacheKey, Math.floor(Math.random() * 0xffffffff));
    plannerPolicy.record(id, nowMs);
  }
  restartPlannerSilenceTimer();
  return true;
}

/**
 * Render one planner sound through the real chain (gain, hall, master at 1,
 * limiter and trim) in an offline context, for the recordings and the browser
 * check of its peak, length and spectrum. The sound starts once the limiter
 * has settled, as a live one does, and the samples begin there. Development
 * builds use it from /dev/planner-chrome; it makes no sound.
 */
export async function renderPlannerSoundOffline(id: PlannerSoundId, sampleRate = 48000): Promise<Float32Array> {
  if (typeof OfflineAudioContext === "undefined") throw new Error("This browser cannot render sound offline");
  const recipe = PLANNER_SOUND_RECIPES[id];
  const tailSeconds = recipe.hallSendDb === null ? 0.05 : 1.3;
  const seconds = PLANNER_LIMITER_WARMUP_SECONDS + recipe.lengthMs / 1000 + tailSeconds;
  const context = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const graph = buildPlannerGraph(context, 1);
  startPlannerSound(graph, recipe, PLANNER_LIMITER_WARMUP_SECONDS, 0, null, 0x5eed);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice(Math.round(PLANNER_LIMITER_WARMUP_SECONDS * sampleRate));
}

/** Test seams: a stand-in for the context, and a clean slate between cases. */
export function __setPlannerContextFactoryForTests(factory: PlannerContextFactory | null): void {
  plannerContextFactory = factory ?? defaultPlannerContextFactory;
}

export function __resetPlannerSoundForTests(): void {
  if (plannerSilenceTimer !== null) window.clearTimeout(plannerSilenceTimer);
  plannerSilenceTimer = null;
  plannerLive = null;
  plannerPolicy = new PlannerSoundPolicy();
  plannerSettings = null;
  plannerLastAudible = "quiet";
  plannerBufferCache.clear();
}
