// ---------------------------------------------------------------------------
// The opt-in tick (goal 19 S6; goal 01 §5: every sound is opt-in).
//
// A soft tick each time the bar's landing snaps to a new quarter hour. Off
// until the person turns it on, remembered on this device only, and never on
// the Diary board: the ribbon is the one place a hand is on the clock.
// ---------------------------------------------------------------------------

export const TICK_PREFERENCE_KEY = "venviewer.when-ribbon.tick";

type PreferenceStore = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): PreferenceStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTickPreference(store: PreferenceStore | null = safeStorage()): boolean {
  try {
    return store?.getItem(TICK_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeTickPreference(on: boolean, store: PreferenceStore | null = safeStorage()): void {
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

function defaultAudio(): TickAudio | null {
  if (typeof AudioContext === "undefined") return null;
  return new AudioContext();
}

/**
 * A player whose first call creates the audio context (a drag is a gesture,
 * so the browser allows it). About 40 ms of a quiet triangle wave at 1.2 kHz
 * with a fast exponential fall: a tick, not a beep.
 */
export function createSnapTick(audioFactory: () => TickAudio | null = defaultAudio): () => void {
  let audio: TickAudio | null | undefined;
  return () => {
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
