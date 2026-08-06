// -----------------------------------------------------------------------------
// The Convener's voice — runtime playback, synced to the typewriter.
//
// Every line is pre-generated (scripts/convener-voice/generate.mjs), so this
// module never calls an API: it fetches one manifest, then plays static mp3s.
//
// The synchronisation is the point. Each manifest entry carries a start time in
// milliseconds for EVERY character of the line, so the typewriter does not run
// on a guessed characters-per-second rate that drifts further with every
// sentence — it reads the audio element's own clock and shows exactly the
// characters he has already said. If the audio stalls to buffer, the text waits
// with it, because they share one clock rather than two that agree at the start.
// -----------------------------------------------------------------------------

const MANIFEST_URL = "/trades-house-media/voice/manifest.json";
const AUDIO_BASE = "/trades-house-media/voice/";
const MUTE_KEY = "venviewer:convener-voice:muted:v1";

export interface ConvenerVoiceLine {
  readonly file: string;
  readonly speechText: string;
  /** One entry per character of speechText; ascending. */
  readonly charStartTimesMs: readonly number[];
}

interface ManifestEntry {
  readonly displayText?: string;
  readonly speechText?: string;
  readonly file?: string;
  readonly charStartTimesMs?: readonly number[] | null;
}

interface ManifestShape {
  readonly entries?: Readonly<Record<string, ManifestEntry>>;
}

/**
 * How many characters have been spoken by `elapsedMs`.
 *
 * Binary search rather than a scan: this runs every animation frame for the
 * length of every line, and a 340-character reveal scanned linearly at 60fps is
 * work we can simply not do. Exported for tests — it is the one piece of real
 * logic here, and the piece a wrong answer from would desynchronise everything.
 */
export function charsSpokenBy(
  charStartTimesMs: readonly number[],
  elapsedMs: number,
): number {
  let low = 0;
  let high = charStartTimesMs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const at = charStartTimesMs[mid];
    if (at !== undefined && at <= elapsedMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

let manifestPromise: Promise<ReadonlyMap<string, ConvenerVoiceLine>> | null = null;

/**
 * Loads and indexes the manifest once per page. Indexed by BOTH the display and
 * speech text: they are identical today, and the split exists so a line whose
 * Scots spelling trips the TTS can be spoken differently from how it is
 * written. A caller holding either string must still find the audio.
 */
export function loadConvenerVoice(): Promise<ReadonlyMap<string, ConvenerVoiceLine>> {
  manifestPromise ??= fetch(MANIFEST_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`voice manifest ${String(response.status)}`);
      return (await response.json()) as ManifestShape;
    })
    .then((manifest) => {
      const index = new Map<string, ConvenerVoiceLine>();
      for (const entry of Object.values(manifest.entries ?? {})) {
        const { file, speechText, charStartTimesMs } = entry;
        // A line without timings would fall back to the rate-based typewriter
        // anyway, so it is not worth indexing — skipping keeps the runtime free
        // of half-usable entries.
        if (
          file === undefined
          || speechText === undefined
          || charStartTimesMs === undefined
          || charStartTimesMs === null
          || charStartTimesMs.length === 0
        ) {
          continue;
        }
        const line: ConvenerVoiceLine = { file, speechText, charStartTimesMs };
        index.set(speechText, line);
        if (entry.displayText !== undefined) index.set(entry.displayText, line);
      }
      return index as ReadonlyMap<string, ConvenerVoiceLine>;
    })
    // A missing or malformed manifest must not break the quiz: an empty index
    // means every say() takes the silent path it took before voice existed.
    .catch(() => new Map<string, ConvenerVoiceLine>() as ReadonlyMap<string, ConvenerVoiceLine>);
  return manifestPromise;
}

/** Test seam — lets a suite install a known index without a network round trip. */
export function __setConvenerVoiceIndexForTests(
  index: ReadonlyMap<string, ConvenerVoiceLine> | null,
): void {
  manifestPromise = index === null ? null : Promise.resolve(index);
}

export function isConvenerVoiceMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false; // Private mode or blocked storage: audible, not broken.
  }
}

export function setConvenerVoiceMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // The preference simply does not persist. Not worth an error.
  }
}

/**
 * Owns exactly ONE audio element for the whole session, swapping its `src` per
 * line. That is not an optimisation — it is the only shape iOS allows. Safari
 * grants playback permission per element on a user gesture, so a fresh
 * `new Audio()` per line would be blocked for every line after the first tap.
 */
export class ConvenerVoicePlayer {
  private readonly audio: HTMLAudioElement | null;
  private unlocked = false;

  constructor() {
    this.audio = typeof Audio === "function" ? new Audio() : null;
    if (this.audio !== null) this.audio.preload = "auto";
  }

  get supported(): boolean {
    return this.audio !== null;
  }

  /**
   * Call inside a real user gesture (the BEGIN tap). Playing and immediately
   * pausing a muted element is the standard way to bank Safari's permission
   * before any line actually needs to be heard.
   */
  unlock(): void {
    const audio = this.audio;
    if (audio === null || this.unlocked) return;
    this.unlocked = true;
    const wasMuted = audio.muted;
    audio.muted = true;
    void audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = wasMuted;
      })
      .catch(() => {
        audio.muted = wasMuted; // Blocked anyway; the silent path still works.
      });
  }

  /** Warms the browser cache for a line we are about to need. */
  preload(line: ConvenerVoiceLine): void {
    if (this.audio === null) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "audio";
    link.href = AUDIO_BASE + line.file;
    document.head.append(link);
  }

  /**
   * Starts a line. Resolves the element so the caller can read `currentTime` as
   * the typewriter clock; returns null when audio is unavailable or refused, in
   * which case the caller falls back to the rate-based typewriter.
   */
  async play(line: ConvenerVoiceLine): Promise<HTMLAudioElement | null> {
    const audio = this.audio;
    if (audio === null) return null;
    audio.pause();
    audio.src = AUDIO_BASE + line.file;
    audio.currentTime = 0;
    try {
      await audio.play();
      return audio;
    } catch {
      return null;
    }
  }

  stop(): void {
    this.audio?.pause();
  }

  dispose(): void {
    const audio = this.audio;
    if (audio === null) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

// ---------------------------------------------------------------------------
// One player per SESSION, not per mount.
//
// Two things force this. The unlock has to happen on the BEGIN tap, when the
// portrait is not mounted at all — it renders only on the question screen. And
// Safari's permission belongs to the element, so a player owned by the portrait
// would be destroyed and recreated (locked, silent) on every remount, including
// the compact/wide switch. The element must outlive the component.
// ---------------------------------------------------------------------------
let sessionPlayer: ConvenerVoicePlayer | null = null;

export function getConvenerVoicePlayer(): ConvenerVoicePlayer {
  sessionPlayer ??= new ConvenerVoicePlayer();
  return sessionPlayer;
}

/** Call synchronously inside the BEGIN tap, before any state change. */
export function unlockConvenerVoice(): void {
  getConvenerVoicePlayer().unlock();
}

// ---------------------------------------------------------------------------
// How many times this visitor has finished the quiz before.
//
// It buys exactly one line — he greets a returning face — but that line is the
// difference between a page and somebody who remembers you. Stored as a count
// rather than a flag so a third visit could one day differ from a second.
// ---------------------------------------------------------------------------
const RUNS_KEY = "venviewer:convener-quiz:runs:v1";

export function completedRuns(): number {
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // No memory available: he simply greets everyone as new.
  }
}

export function recordCompletedRun(): void {
  try {
    window.localStorage.setItem(RUNS_KEY, String(completedRuns() + 1));
  } catch {
    // Nothing worth an error. He forgets, that is all.
  }
}

/** Test seam — drops the singleton so each suite starts from silence. */
export function __resetConvenerVoiceForTests(): void {
  sessionPlayer?.dispose();
  sessionPlayer = null;
  manifestPromise = null;
  try { window.localStorage.removeItem(RUNS_KEY); } catch { /* nothing to clear */ }
}
