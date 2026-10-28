import { applyFilter, biquadCoefficients, fft } from "../planner-sound-render.js";

// ---------------------------------------------------------------------------
// Measuring a render (T-677).
//
// The set-down engine is tuned and tested by measurement, never by ear alone:
// how long a room rings, how much of a sound sits in each octave, where its
// brightness lies, when it starts and how loud it seems. These are the tools
// the later tasks' tests read. All are plain arithmetic over samples.
// ---------------------------------------------------------------------------

/** The Q of the octave band-pass: two cascaded stages of 1.414 span about an octave. */
const OCTAVE_Q = 1.414;

/** Smallest power of two that holds `length` samples. */
function powerOfTwoAtLeast(length: number): number {
  let n = 1;
  while (n < length) n <<= 1;
  return n;
}

/** The part of `samples` within an octave of `centreHz`: two cascaded RBJ band-passes, on a copy. */
export function octaveBandpass(samples: Float32Array, centreHz: number, sampleRate: number): Float32Array {
  const out = Float32Array.from(samples);
  const stage = { type: "bandpass", hz: centreHz, q: OCTAVE_Q } as const;
  applyFilter(out, stage, sampleRate);
  applyFilter(out, stage, sampleRate);
  return out;
}

/** The order of each edge of the steep octave band-pass. */
const STEEP_ORDER = 24;

/** The Q of each biquad of an even-order Butterworth filter, from its pole angles. */
function butterworthQs(order: number): readonly number[] {
  return Array.from({ length: order / 2 }, (_, k) => 1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * order))));
}

/** An RBJ high-pass biquad at `hz` (Web Audio's "highpass"), normalised by a0. */
function highpassCoefficients(hz: number, q: number, sampleRate: number) {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Runs one biquad over `x` in place, in double precision. */
function runBiquadInPlace(
  x: Float64Array,
  c: { readonly b0: number; readonly b1: number; readonly b2: number; readonly a1: number; readonly a2: number },
): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const x0 = x[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/**
 * The part of `samples` within the octave about `centreHz`, cut far more
 * steeply than `octaveBandpass`: a 24th-order Butterworth high-pass at the
 * octave's lower edge (centre ÷ √2) and a 24th-order low-pass at its upper
 * edge (centre × √2), each a cascade of biquads, run in double precision on a
 * copy. Each edge is 3 dB down; half an octave beyond it the cut is about
 * 72 dB. It reads a band's decay without its neighbours' decays leaking in.
 */
export function octaveBandpassSteep(samples: Float32Array, centreHz: number, sampleRate: number): Float32Array {
  const x = Float64Array.from(samples);
  const qs = butterworthQs(STEEP_ORDER);
  for (const q of qs) runBiquadInPlace(x, highpassCoefficients(centreHz / Math.SQRT2, q, sampleRate));
  for (const q of qs) runBiquadInPlace(x, biquadCoefficients("lowpass", centreHz * Math.SQRT2, q, sampleRate));
  return Float32Array.from(x);
}

/**
 * The reverberation time in seconds, read as T20: a straight line through the
 * Schroeder (backward-integrated) decay between -5 and -25 dB, extended to
 * -60 dB. Returns 0 when the decay never spans that range (silence, or a sound
 * that stops too soon to measure).
 */
export function schroederT20(samples: Float32Array, sampleRate: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  // The backward-integrated energy at each sample.
  const decay = new Float64Array(n);
  let running = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const s = samples[i] ?? 0;
    running += s * s;
    decay[i] = running;
  }
  const total = decay[0] ?? 0;
  if (total <= 0) return 0;
  // Least-squares line through the points between -5 and -25 dB.
  let count = 0, sumT = 0, sumDb = 0, sumTT = 0, sumTDb = 0;
  for (let i = 0; i < n; i += 1) {
    const db = 10 * Math.log10(Math.max((decay[i] ?? 0) / total, 1e-30));
    if (db > -5) continue;
    if (db < -25) break;
    const t = i / sampleRate;
    count += 1;
    sumT += t;
    sumDb += db;
    sumTT += t * t;
    sumTDb += t * db;
  }
  if (count < 2) return 0;
  const denominator = count * sumTT - sumT * sumT;
  if (denominator === 0) return 0;
  const slope = (count * sumTDb - sumT * sumDb) / denominator; // dB per second, negative
  return slope < 0 ? -60 / slope : 0;
}

/** The power of each bin up to Nyquist, from one transform of `samples` (Hann-windowed when `window` is set). */
function powerSpectrum(samples: Float32Array, window: boolean): { readonly power: Float64Array; readonly n: number } {
  const n = powerOfTwoAtLeast(Math.max(samples.length, 2));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const length = samples.length;
  for (let i = 0; i < length; i += 1) {
    const w = window && length > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1)) : 1;
    re[i] = (samples[i] ?? 0) * w;
  }
  fft(re, im);
  const power = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k += 1) power[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
  return { power, n };
}

/**
 * The energy of `samples` between `loHz` (inclusive) and `hiHz` (exclusive), in
 * the units of the sum of squared samples: over the whole spectrum it equals
 * that sum (Parseval), so a band's share is its value over the total.
 */
export function bandEnergy(samples: Float32Array, sampleRate: number, loHz: number, hiHz: number): number {
  if (samples.length === 0) return 0;
  const { power, n } = powerSpectrum(samples, false);
  const loBin = Math.max(0, Math.ceil((loHz / sampleRate) * n));
  const hiBin = Math.min(n / 2 + 1, Math.ceil((hiHz / sampleRate) * n));
  let sum = 0;
  for (let k = loBin; k < hiBin; k += 1) {
    // Bins between DC and Nyquist stand for a positive and a negative frequency.
    const weight = k === 0 || k === n / 2 ? 1 : 2;
    sum += weight * (power[k] ?? 0);
  }
  return sum / n;
}

/** The power-weighted mean frequency in Hz (0 for silence), read through a Hann window so a tone's leakage stays symmetric. */
export function spectralCentroidHz(samples: Float32Array, sampleRate: number): number {
  if (samples.length < 2) return 0;
  const { power, n } = powerSpectrum(samples, true);
  let weighted = 0, total = 0;
  for (let k = 1; k <= n / 2; k += 1) {
    const p = power[k] ?? 0;
    weighted += p * ((k * sampleRate) / n);
    total += p;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * The power-weighted mean frequency of the whole render, in Hz (0 for
 * silence), read unwindowed: the spectral centroid of a sound that starts at
 * its loudest and dies away by its own end, so it needs no window.
 * spectralCentroidHz's Hann window over the whole buffer weights its middle,
 * where only the slowest tail is left, and all but hides the landing itself.
 */
export function brightnessHz(samples: Float32Array, sampleRate: number): number {
  if (samples.length < 2) return 0;
  const { power, n } = powerSpectrum(samples, false);
  let weighted = 0, total = 0;
  for (let k = 1; k <= n / 2; k += 1) {
    const p = power[k] ?? 0;
    weighted += p * ((k * sampleRate) / n);
    total += p;
  }
  return total > 0 ? weighted / total : 0;
}

/** The envelope is the peak of each millisecond. */
const ONSET_BLOCK_MS = 1;
/** A block starts a sound when it is this far above the average of the blocks before it. */
const ONSET_JUMP_DB = 12;
const ONSET_LOOKBACK_BLOCKS = 3;
/** Blocks this far below the loudest are never an onset (the noise floor). */
const ONSET_FLOOR_DB = -60;

/**
 * Where sounds begin, in milliseconds: the start of every 1 ms block whose peak
 * is 12 dB above the average of the 3 ms before it. A sound that is still
 * rising does not start again within those 3 ms.
 */
export function onsetTimesMs(samples: Float32Array, sampleRate: number): readonly number[] {
  const blockLength = Math.max(1, Math.round((ONSET_BLOCK_MS / 1000) * sampleRate));
  const blocks = Math.ceil(samples.length / blockLength);
  const envelope = new Float64Array(blocks);
  let loudest = 0;
  for (let b = 0; b < blocks; b += 1) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * blockLength);
    for (let i = b * blockLength; i < end; i += 1) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    envelope[b] = peak;
    loudest = Math.max(loudest, peak);
  }
  if (loudest === 0) return [];
  const floor = loudest * 10 ** (ONSET_FLOOR_DB / 20);
  const jump = 10 ** (ONSET_JUMP_DB / 20);
  const onsets: number[] = [];
  let lastOnsetBlock = -ONSET_LOOKBACK_BLOCKS - 1;
  for (let b = 0; b < blocks; b += 1) {
    const level = envelope[b] ?? 0;
    if (level <= floor || b - lastOnsetBlock <= ONSET_LOOKBACK_BLOCKS) continue;
    let before = 0;
    for (let k = 1; k <= ONSET_LOOKBACK_BLOCKS; k += 1) before += b - k >= 0 ? (envelope[b - k] ?? 0) : 0;
    before /= ONSET_LOOKBACK_BLOCKS;
    if (level >= before * jump) {
      onsets.push(b * ONSET_BLOCK_MS);
      lastOnsetBlock = b;
    }
  }
  return onsets;
}

// --- ITU-R BS.1770 K-weighting ----------------------------------------------

interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Stage 1: the head-related high shelf (about +4 dB above 2 kHz), computed for any sample rate. */
function kShelf(sampleRate: number): Biquad {
  const f0 = 1681.974450955533, gainDb = 3.999843853973347, q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** Stage 2: the revised low-frequency B-curve, a high-pass near 38 Hz. */
function kHighPass(sampleRate: number): Biquad {
  const f0 = 38.13547087602444, q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

function runBiquad(input: ArrayLike<number>, c: Biquad): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** A channel through the two BS.1770 K-weighting stages, in double precision. */
export function kWeighted(channel: ArrayLike<number>, sampleRate: number): Float64Array {
  return runBiquad(runBiquad(channel, kShelf(sampleRate)), kHighPass(sampleRate));
}

const kWeight = kWeighted;

/** Samples whose K-weighted power (both channels summed) is below -70 dB do not count. */
export const LOUDNESS_GATE = 1e-7;
/** What a render with nothing above the gate reads as. */
const SILENT_DB = -120;

/**
 * How loud a sound seems, in dB: both channels through the two BS.1770
 * K-weighting stages, then the mean of the summed squared samples, taken only
 * over the samples above -70 dB, so a long quiet tail does not dilute a short
 * sound. A 1 kHz sine at -20 dBFS in both channels reads about -20 dB.
 */
export function kWeightedLoudness(left: Float32Array, right: Float32Array, sampleRate: number): number {
  const l = kWeight(left, sampleRate);
  const r = kWeight(right, sampleRate);
  const length = Math.min(l.length, r.length);
  let sum = 0, counted = 0;
  for (let i = 0; i < length; i += 1) {
    const power = (l[i] ?? 0) ** 2 + (r[i] ?? 0) ** 2;
    if (power < LOUDNESS_GATE) continue;
    sum += power;
    counted += 1;
  }
  return counted > 0 ? 10 * Math.log10(sum / counted) : SILENT_DB;
}
