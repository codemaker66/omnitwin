import { useCallback, useEffect, useRef, useState } from "react";
import { isUnownedRequest, type VenueRequest } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The sound registry: every sound Venviewer can make, in one place.
//
// Callers: WhenRibbon.tsx (createSnapTick and the tick preference),
// ChimeToggle.tsx and RequestsProvider.tsx (the arrival chime), and
// pages/LandingPage.tsx with ContemplationAct.tsx (room tone). The toolbar
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

export const SOUND_REGISTRY = {
  "toolbar-tick": { label: "Toolbar arc tick", optIn: "session-toggle", storageKey: null },
  "toolbar-click": { label: "Toolbar activation click", optIn: "session-toggle", storageKey: null },
  "arrival-chime": { label: "Arrival chime on the requests board", optIn: "device-toggle", storageKey: CHIME_STORAGE_KEY },
  "snap-tick": { label: "When ribbon quarter-hour tick", optIn: "device-toggle", storageKey: TICK_PREFERENCE_KEY },
  "room-tone": { label: "Room tone on the landing page", optIn: "session-toggle", storageKey: null },
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
