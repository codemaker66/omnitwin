// ---------------------------------------------------------------------------
// Shared helpers for the set-down render tests and the listening renders: one
// way to build an input, one loudness measure (the renderer's own, ruling R45),
// so every render is measured like with like, and one reader of a tail's decay
// in each octave (ruling R53).
// ---------------------------------------------------------------------------

import { fft } from "../../planner-sound-render.js";
import { bandEnergy, momentaryMaxLoudness } from "../analysis.js";
import { OCTAVE_BANDS_HZ } from "../bands.js";
import { bodyFor } from "../bodies.js";
import type { Reflection } from "../reflections.js";
import { renderSetDown, type SetDownInput, type SetDownRender } from "../render.js";
import { surfaceResponse, type SurfaceKind } from "../surfaces.js";

export const SR = 48000;

export interface SetDownOptions {
  readonly room?: string;
  readonly seed?: number;
  readonly speed?: number;
  readonly kind?: SetDownInput["kind"];
  readonly clothed?: boolean;
  readonly gain?: number;
  readonly azimuthRad?: number;
  readonly reflections?: readonly Reflection[];
  readonly scale?: number;
  /** The rate to render at, SR unless given. */
  readonly sampleRate?: number;
}

/** The input for `slug` set down with every foot on `surface` (resolved for `room`, the Grand Hall unless given), dry, centred and at full level. */
export function inputFor(slug: string, surface: SurfaceKind, options: SetDownOptions = {}): SetDownInput {
  const body = bodyFor(slug, options.scale);
  const response = surfaceResponse(surface, options.room ?? "grand-hall");
  return {
    body,
    surfaces: body.feet.map(() => response),
    speed: options.speed ?? 1,
    kind: options.kind ?? "drop",
    clothed: options.clothed ?? false,
    direct: { gain: options.gain ?? 1, azimuthRad: options.azimuthRad ?? 0 },
    reflections: options.reflections ?? [],
    seed: options.seed ?? 1,
    sampleRate: options.sampleRate ?? SR,
  };
}

export function setDown(slug: string, surface: SurfaceKind, options: SetDownOptions = {}): SetDownRender {
  return renderSetDown(inputFor(slug, surface, options));
}

/** A render's loudness as the renderer levels it: the momentary loudness at its loudest, over the whole render (ruling R45). */
export function loudness(render: SetDownRender): number {
  return momentaryMaxLoudness(render.left, render.right, render.sampleRate);
}

export function energy(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return sum;
}

/** The share of a render's first `ms` milliseconds that lies above `hz`: how much click a landing has. */
export function clickShare(samples: Float32Array, ms: number, hz: number, sampleRate: number = SR): number {
  const head = samples.subarray(0, Math.round((ms / 1000) * sampleRate));
  const total = energy(head);
  return total > 0 ? bandEnergy(head, sampleRate, hz, sampleRate / 2) / total : 0;
}

/** Whether two channels hold the same samples, bit for bit: a bytewise compare (ruling R52), not an element-by-element deep equality. */
export function sameSamples(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

// --- Reading a decay in each octave (ruling R53) ------------------------------

/** The 4-term Blackman-Harris window's coefficients (Harris 1978): its sidelobes lie 92 dB down. */
const BLACKMAN_HARRIS = [0.35875, 0.48829, 0.14128, 0.01168] as const;
/** Its main lobe's half-width, in bins: a tone reaches no bin further away than this above its sidelobes. */
const BLACKMAN_HARRIS_HALF_LOBE_BINS = 4;
/** The reader's bins are this wide at most, so even the 125 Hz octave keeps several bins between its inset edges. */
const READER_BIN_HZ = 6;
/** Frames are an eighth of a frame apart. */
const READER_HOPS_PER_FRAME = 8;
/** The T20 fit's range on the backward-integrated decay, dB. */
const T20_FROM_DB = -5;
const T20_TO_DB = -25;

/**
 * One octave's decay as read: its T20 in seconds (0 if the decay never spans -5 to -25 dB), how many bins it was
 * read from, and the bandwidth those bins span in hertz (bins x bin width), the B of a reading's expected scatter.
 */
export interface BandDecay {
  readonly t20: number;
  readonly bins: number;
  readonly bandwidthHz: number;
}

/**
 * The scatter of one T20 reading of a decay of noise, as a fraction of its time T:
 * sigma_D / T = 0.88 root((1 + 1.90 / n) / (N B T)), for a bandwidth B in hertz, n = 10 for an integrated impulse
 * response and N = 1 decay averaged (ISO 3382-2:2008, after Davy, Dunn and Dubout, Acustica, 1979; ruling R67).
 * A band read from no bins has no scatter to scale by: it throws, rather than return Infinity and pass every check.
 */
export function decayScatter(bandwidthHz: number, seconds: number): number {
  if (!(bandwidthHz > 0) || !(seconds > 0)) throw new Error(`decayScatter: a band of ${String(bandwidthHz)} Hz over ${String(seconds)} s has no scatter to read`);
  const n = 10;
  const decays = 1;
  return 0.88 * Math.sqrt((1 + 1.9 / n) / (decays * bandwidthHz * seconds));
}

/** The T20 of an energy series, one value per frame `step` seconds apart: Schroeder's backward integral, a line fitted from -5 to -25 dB. */
function framesT20(series: Float64Array, step: number): number {
  const decay = new Float64Array(series.length);
  let running = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    running += series[i] ?? 0;
    decay[i] = running;
  }
  const total = decay[0] ?? 0;
  if (!(total > 0)) return 0;
  let count = 0, sumT = 0, sumDb = 0, sumTT = 0, sumTDb = 0;
  for (let i = 0; i < decay.length; i += 1) {
    const db = 10 * Math.log10(Math.max((decay[i] ?? 0) / total, 1e-300));
    if (db > T20_FROM_DB) continue;
    if (db < T20_TO_DB) break;
    const t = i * step;
    count += 1;
    sumT += t;
    sumDb += db;
    sumTT += t * t;
    sumTDb += t * db;
  }
  if (count < 2) return 0;
  const denominator = count * sumTT - sumT * sumT;
  if (denominator === 0) return 0;
  const slope = (count * sumTDb - sumT * sumDb) / denominator;
  return slope < 0 ? -60 / slope : 0;
}

/**
 * Each octave's T20 in both channels of a tail, read without a filter
 * (ruling R53): a Blackman-Harris short-time spectrum, each octave's energy
 * summed over only the bins strictly inside it and inset from both of its
 * edges by the window's main-lobe half-width, so a neighbouring octave's decay
 * reaches those bins only through sidelobes 92 dB down. Each octave's energy
 * per frame is integrated backwards (Schroeder) and a line is fitted from -5
 * to -25 dB and extended to -60 dB.
 *
 * The frame is the shortest power of two whose bins are at most 6 Hz wide
 * (8,192 points at 44.1 and 48 kHz, 16,384 at 96 kHz), so the 125 Hz octave,
 * 88-177 Hz, keeps about seven bins between its inset edges. The two channels
 * share each transform (left + j right). Returns [left, right], each in the
 * order of OCTAVE_BANDS_HZ.
 */
export function octaveDecays(left: Float32Array, right: Float32Array, sampleRate: number): readonly [readonly BandDecay[], readonly BandDecay[]] {
  let frame = 1;
  while (sampleRate / frame > READER_BIN_HZ) frame <<= 1;
  const hop = frame / READER_HOPS_PER_FRAME;
  const binHz = sampleRate / frame;
  const window = new Float64Array(frame);
  for (let n = 0; n < frame; n += 1) {
    const x = (2 * Math.PI * n) / frame;
    window[n] = BLACKMAN_HARRIS[0] - BLACKMAN_HARRIS[1] * Math.cos(x) + BLACKMAN_HARRIS[2] * Math.cos(2 * x) - BLACKMAN_HARRIS[3] * Math.cos(3 * x);
  }
  // Each octave's bins: strictly inside it, and the main lobe's half-width in from each edge.
  const ranges = OCTAVE_BANDS_HZ.map((hz) => ({
    first: Math.floor(hz / Math.SQRT2 / binHz) + BLACKMAN_HARRIS_HALF_LOBE_BINS + 1,
    last: Math.min(frame / 2 - 1, Math.ceil((hz * Math.SQRT2) / binHz) - BLACKMAN_HARRIS_HALF_LOBE_BINS - 1),
  }));
  const length = Math.max(left.length, right.length);
  // Frame f is centred on sample f * hop.
  const frames = Math.floor((length - 1) / hop) + 1;
  const leftEnergy = ranges.map(() => new Float64Array(frames));
  const rightEnergy = ranges.map(() => new Float64Array(frames));
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop - frame / 2;
    for (let n = 0; n < frame; n += 1) {
      const i = start + n;
      const w = window[n] ?? 0;
      re[n] = i >= 0 && i < left.length ? (left[i] ?? 0) * w : 0;
      im[n] = i >= 0 && i < right.length ? (right[i] ?? 0) * w : 0;
    }
    fft(re, im);
    ranges.forEach(({ first, last }, band) => {
      let l = 0;
      let r = 0;
      for (let k = first; k <= last; k += 1) {
        // Z = L + jR, so L(k) = (Z(k) + conj Z(N - k)) / 2 and R(k) = (Z(k) - conj Z(N - k)) / 2j.
        const zr = re[k] ?? 0, zi = im[k] ?? 0, mr = re[frame - k] ?? 0, mi = im[frame - k] ?? 0;
        l += (zr + mr) ** 2 + (zi - mi) ** 2;
        r += (zr - mr) ** 2 + (zi + mi) ** 2;
      }
      const leftBand = leftEnergy[band];
      const rightBand = rightEnergy[band];
      if (leftBand !== undefined) leftBand[f] = l;
      if (rightBand !== undefined) rightBand[f] = r;
    });
  }
  const read = (perBand: readonly Float64Array[]): readonly BandDecay[] =>
    perBand.map((series, band) => {
      const range = ranges[band];
      const bins = range === undefined ? 0 : Math.max(0, range.last - range.first + 1);
      return { t20: framesT20(series, hop / sampleRate), bins, bandwidthHz: bins * binHz };
    });
  return [read(leftEnergy), read(rightEnergy)];
}
