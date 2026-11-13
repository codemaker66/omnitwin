import { type FilterSpec, type NoiseVoice, type PlannerSoundRecipe, type ToneVoice } from "./planner-sound-recipes.js";

// ---------------------------------------------------------------------------
// Rendering the planner's sounds in plain arithmetic (T-671, spec section 9).
//
// Every planner sound is rendered here, sample by sample, from its recipe: the
// tones on their pitch paths, the noise through its filter, every voice on its
// envelope, and the whole through the bus's gentle 6 kHz low-pass. The
// registry plays exactly these samples, so the tests measure what a person
// hears: its peak, its length and its silence above 5 kHz. The filters are the
// biquads the Web Audio specification defines (the RBJ cookbook), and the
// noise is seeded, so a render is the same every time.
// ---------------------------------------------------------------------------

/** The bus every planner sound passes through (spec 9: low-pass 6 kHz, Q 0.5). */
export const BUS_LOWPASS: FilterSpec = { type: "lowpass", hz: 6000, q: 0.5 };

const DB_FLOOR = 0.001;
/** Coefficients of a swept filter are recomputed this often (in samples). */
const SWEEP_BLOCK = 16;
/**
 * A band-pass biquad falls only 6 dB an octave, so white noise's top octaves
 * would hiss past the bus. Every noise voice also passes this ceiling, which
 * keeps it below 5 kHz (spec 9) without touching the contact or the brush,
 * both of which sit well under it.
 */
export const NOISE_CEILING: FilterSpec = { type: "lowpass", hz: 3500, q: 0.71 };

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-12));
}

/** A small, fast, seeded generator (mulberry32), so noise renders the same every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Coefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** A biquad's coefficients as the Web Audio specification computes them (normalised by a0). */
export function biquadCoefficients(type: FilterSpec["type"], hz: number, q: number, sampleRate: number): Coefficients {
  const w0 = (2 * Math.PI * Math.min(hz, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  if (type === "bandpass") {
    // Constant 0 dB peak gain, as Web Audio's "bandpass".
    return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  }
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Filters `samples` in place; a sweep moves the frequency exponentially from its start to its end. */
export function applyFilter(samples: Float32Array, filter: FilterSpec, sampleRate: number): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let c = biquadCoefficients(filter.type, filter.hz, filter.q, sampleRate);
  const sweep = filter.toHz !== undefined && filter.toHz !== filter.hz;
  for (let i = 0; i < samples.length; i += 1) {
    if (sweep && i % SWEEP_BLOCK === 0) {
      const progress = samples.length <= 1 ? 1 : i / (samples.length - 1);
      const hz = filter.hz * ((filter.toHz ?? filter.hz) / filter.hz) ** progress;
      c = biquadCoefficients(filter.type, hz, filter.q, sampleRate);
    }
    const x0 = samples[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    samples[i] = y0;
  }
}

/** Nothing in the palette sounds above 5 kHz (spec 9), so a triangle keeps only its harmonics below it. */
const TONE_CEILING_HZ = 5000;

function toneSample(wave: ToneVoice["wave"], phase: number, hz: number, sampleRate: number): number {
  if (wave === "sine") return Math.sin(2 * Math.PI * phase);
  // A band-limited triangle: its odd harmonics below the palette's ceiling (and Nyquist).
  let sum = 0;
  for (let k = 1; k * hz < Math.min(TONE_CEILING_HZ, sampleRate / 2); k += 2) {
    const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
    sum += (sign * Math.sin(2 * Math.PI * k * phase)) / (k * k);
  }
  return (8 / (Math.PI * Math.PI)) * sum;
}

function renderTone(voice: ToneVoice, out: Float32Array, sampleRate: number): void {
  const start = Math.round(((voice.startMs ?? 0) / 1000) * sampleRate);
  const attack = (voice.attackMs / 1000) * sampleRate;
  const decay = (voice.decayMs / 1000) * sampleRate;
  const length = Math.min(out.length - start, Math.ceil(attack + decay));
  if (length <= 0) return;
  const floor = voice.floor ?? DB_FLOOR;
  const peak = dbToGain(voice.peakDb);
  const glide = ((voice.glideMs ?? 0) / 1000) * sampleRate;
  const buffer = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i += 1) {
    const hz = voice.toHz !== undefined && glide > 0
      ? voice.hz * (voice.toHz / voice.hz) ** Math.min(1, i / glide)
      : voice.hz;
    const envelope = i < attack ? i / attack : floor ** ((i - attack) / decay);
    buffer[i] = toneSample(voice.wave, phase, hz, sampleRate) * envelope * peak;
    phase += hz / sampleRate;
    if (phase >= 1) phase -= Math.floor(phase);
  }
  if (voice.filter !== undefined) applyFilter(buffer, voice.filter, sampleRate);
  for (let i = 0; i < length; i += 1) out[start + i] = (out[start + i] ?? 0) + (buffer[i] ?? 0);
}

function renderNoise(voice: NoiseVoice, out: Float32Array, sampleRate: number, random: () => number): void {
  const start = Math.round(((voice.startMs ?? 0) / 1000) * sampleRate);
  const length = Math.min(out.length - start, Math.ceil((voice.lengthMs / 1000) * sampleRate));
  if (length <= 0) return;
  const attack = Math.max(1, (voice.attackMs / 1000) * sampleRate);
  const buffer = new Float32Array(length);
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    const white = random() * 2 - 1;
    if (voice.colour === "brown") {
      brown = (brown + 0.02 * white) / 1.02;
      buffer[i] = brown * 3.5;
    } else {
      buffer[i] = white;
    }
  }
  applyFilter(buffer, voice.filter, sampleRate);
  if (voice.colour === "white") applyFilter(buffer, NOISE_CEILING, sampleRate);
  // The voice's level is the level of what the filter lets through.
  let filteredPeak = 0;
  for (const sample of buffer) filteredPeak = Math.max(filteredPeak, Math.abs(sample));
  const makeup = filteredPeak > 0 ? dbToGain(voice.peakDb) / filteredPeak : 0;
  const fall = Math.max(1, length - attack);
  for (let i = 0; i < length; i += 1) {
    const envelope = i < attack ? i / attack : DB_FLOOR ** ((i - attack) / fall);
    out[start + i] = (out[start + i] ?? 0) + (buffer[i] ?? 0) * makeup * envelope;
  }
}

export interface RenderOptions {
  readonly sampleRate?: number;
  /** Seeds the noise; the same seed renders the same samples. */
  readonly seed?: number;
  /** Run the bus's 6 kHz low-pass (on for everything that plays). */
  readonly bus?: boolean;
  /**
   * Set the finished sound's peak to its recipe's level (on for everything
   * that plays). The voices keep their balance; the level column of spec 9 is
   * the sound's peak, so the sum, not each voice, is held to it.
   */
  readonly normalise?: boolean;
}

/** The samples of one sound, dry, as it leaves the bus: mono, at `sampleRate`, peaking at its level. */
export function renderPlannerSound(recipe: PlannerSoundRecipe, options: RenderOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? 48000;
  const random = seededRandom(options.seed ?? 0x5eed);
  let lengthMs = recipe.lengthMs;
  for (const voice of recipe.voices) {
    const end = (voice.startMs ?? 0) + (voice.kind === "tone" ? voice.attackMs + voice.decayMs : voice.lengthMs);
    lengthMs = Math.max(lengthMs, end);
  }
  const out = new Float32Array(Math.ceil((lengthMs / 1000) * sampleRate) + 1);
  for (const voice of recipe.voices) {
    if (voice.kind === "tone") renderTone(voice, out, sampleRate);
    else renderNoise(voice, out, sampleRate, random);
  }
  if (options.bus !== false) applyFilter(out, BUS_LOWPASS, sampleRate);
  if (options.normalise !== false) {
    let peak = 0;
    for (const sample of out) peak = Math.max(peak, Math.abs(sample));
    const scale = peak > 0 ? dbToGain(recipe.peakDb) / peak : 0;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * scale;
  }
  return out;
}

/**
 * The hall's answer: about 1.2 s of noise falling away, darkened as a large
 * room darkens it. A convolver plays the rare moments through it, well under
 * the dry sound (spec 9).
 */
export function renderHallImpulse(sampleRate = 48000, seconds = 1.2): Float32Array {
  const random = seededRandom(0x4a11);
  const length = Math.ceil(seconds * sampleRate);
  const impulse = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    impulse[i] = (random() * 2 - 1) * DB_FLOOR ** t;
  }
  applyFilter(impulse, { type: "lowpass", hz: 3200, toHz: 900, q: 0.71 }, sampleRate);
  // Unit energy, so the send level alone sets how much hall there is.
  let energy = 0;
  for (const sample of impulse) energy += sample * sample;
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < length; i += 1) impulse[i] = (impulse[i] ?? 0) * scale;
  return impulse;
}

// --- Measuring a render ------------------------------------------------------

export function peakDbfs(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return gainToDb(peak);
}

/** How long it sounds: until the last moment it is within `floorDb` of its own peak (−60 dB unless its recipe falls further). */
export function soundingLengthMs(samples: Float32Array, sampleRate = 48000, floorDb = -60): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const threshold = peak * dbToGain(floorDb);
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (Math.abs(samples[i] ?? 0) > threshold) return ((i + 1) / sampleRate) * 1000;
  }
  return 0;
}

/** In-place radix-2 FFT over a power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
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

/** The share of a sound's energy above `hz` (0 to 1), from one windowless transform of the whole render. */
export function energyShareAbove(samples: Float32Array, hz: number, sampleRate = 48000): number {
  let n = 1;
  while (n < samples.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(samples);
  fft(re, im);
  let above = 0, total = 0;
  const cutoffBin = Math.floor((hz / sampleRate) * n);
  for (let k = 1; k <= n / 2; k += 1) {
    const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    total += power;
    if (k >= cutoffBin) above += power;
  }
  return total > 0 ? above / total : 0;
}
