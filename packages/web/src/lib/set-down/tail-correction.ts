// ---------------------------------------------------------------------------
// Correcting the tail's band times for the leak between bands (T-677).
//
// Each band of the tail is noise through the octave band-pass of
// `octaveBandpass`. Neighbouring bands overlap: about -10 dB of each
// neighbour's energy falls within a band's own octave, so a band measures long
// when its neighbour rings longer (and short when it rings shorter). Measured
// offline over 30 seeds, the uncorrected tail read +5 % at 250 Hz, +6 % at
// 4 kHz and +21 % at 8 kHz.
//
// The leak is fixed by the filters alone, so it is modelled rather than
// measured: the share of band j's energy inside band k's octave is the
// integral of their two power responses. A band's Schroeder decay is then the
// sum of each band's exponential at its share, and its T20 is read from that
// curve as `schroederT20` reads a signal. The synthesis times are solved so
// that each band's modelled T20 is its target. Offline, the model matched the
// measured bias within about half a percent in every band.
// ---------------------------------------------------------------------------

import { biquadCoefficients } from "../planner-sound-render.js";
import { OCTAVE_Q } from "./analysis.js";
import { OCTAVE_BANDS_HZ, bandMap, type BandValues } from "./bands.js";

/** Each band's energy at band k's measurement, and the power of one band of uniform noise. */
export interface BandLeakage {
  /** `weights[k][j]`: the share of band j's energy inside band k's octave (unnormalised). */
  readonly weights: readonly (readonly number[])[];
  /** The mean square of uniform noise in [-1, 1] after one band's filter. */
  readonly bandPower: BandValues;
}

/** Points of the log-spaced frequency grid the responses are integrated over. */
const GRID_POINTS = 1024;
const GRID_LOW_HZ = 20;
/** Uniform noise in [-1, 1] has a mean square of 1/3. */
const UNIFORM_POWER = 1 / 3;
/** 2 x ln(1000): the energy decay of 60 dB over the reverberation time. */
const ENERGY_DECAY_PER_RT = 13.8155;
/** Points on the modelled decay, over the first half of the longest time. */
const DECAY_POINTS = 120;
const FIT_TOP_DB = -5;
const FIT_BOTTOM_DB = -25;
const ITERATIONS = 8;
/**
 * A band's synthesis time stays within these multiples of its target. Past
 * them, a neighbour's leak dominates the band's late decay, and shortening the
 * band further makes it measure longer: 8 kHz below a long 4 kHz reaches its
 * best, about +6 %, near 0.8 of its target.
 */
const MIN_FACTOR = 0.8;
const MAX_FACTOR = 1.25;

/** The power response |H|^2 of two cascaded band-pass stages at angular frequency `w`. */
function bandPowerAt(centreHz: number, w: number, sampleRate: number): number {
  const c = biquadCoefficients("bandpass", centreHz, OCTAVE_Q, sampleRate);
  const cos1 = Math.cos(w), cos2 = Math.cos(2 * w), sin1 = Math.sin(w), sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const stage = (nr * nr + ni * ni) / (dr * dr + di * di);
  return stage * stage;
}

const leakageCache = new Map<number, BandLeakage>();

/** The leak between bands at `sampleRate`, from the filters' responses; computed once per rate. */
export function bandLeakage(sampleRate: number): BandLeakage {
  const cached = leakageCache.get(sampleRate);
  if (cached !== undefined) return cached;
  const bands = OCTAVE_BANDS_HZ.length;
  const weights = Array.from({ length: bands }, () => new Array<number>(bands).fill(0));
  const integral = new Array<number>(bands).fill(0);
  const response = new Array<number>(bands).fill(0);
  const low = Math.log(GRID_LOW_HZ);
  const high = Math.log(sampleRate / 2);
  for (let n = 0; n < GRID_POINTS; n += 1) {
    const hz = Math.exp(low + ((high - low) * (n + 0.5)) / GRID_POINTS);
    const dHz = (hz * (high - low)) / GRID_POINTS;
    const w = (2 * Math.PI * hz) / sampleRate;
    for (let k = 0; k < bands; k += 1) response[k] = bandPowerAt(OCTAVE_BANDS_HZ[k] ?? 1000, w, sampleRate);
    for (let k = 0; k < bands; k += 1) {
      const rk = response[k] ?? 0;
      integral[k] = (integral[k] ?? 0) + rk * dHz;
      const row = weights[k];
      if (row === undefined) continue;
      for (let j = 0; j < bands; j += 1) row[j] = (row[j] ?? 0) + rk * (response[j] ?? 0) * dHz;
    }
  }
  // White noise spreads its mean square evenly from 0 Hz to Nyquist.
  const bandPower = bandMap([0, 0, 0, 0, 0, 0, 0], (_, k) => (UNIFORM_POWER * 2 * (integral[k] ?? 0)) / sampleRate);
  const leakage: BandLeakage = { weights, bandPower };
  leakageCache.set(sampleRate, leakage);
  return leakage;
}

/** The T20 of a decay made of each band's exponential at its weight, read as `schroederT20` reads one. */
export function modelledT20(weights: readonly number[], times: readonly number[]): number {
  const longest = Math.max(...times);
  const tEnd = 0.5 * longest;
  const schroeder = (t: number): number => {
    let sum = 0;
    for (let j = 0; j < weights.length; j += 1) {
      const time = times[j] ?? longest;
      sum += (weights[j] ?? 0) * (time / ENERGY_DECAY_PER_RT) * Math.exp((-ENERGY_DECAY_PER_RT * t) / time);
    }
    return sum;
  };
  const total = schroeder(0);
  if (!(total > 0)) return 0;
  let count = 0, sumT = 0, sumDb = 0, sumTT = 0, sumTDb = 0;
  for (let g = 0; g <= DECAY_POINTS; g += 1) {
    const t = (tEnd * g) / DECAY_POINTS;
    const db = 10 * Math.log10(schroeder(t) / total);
    if (db > FIT_TOP_DB) continue;
    if (db < FIT_BOTTOM_DB) break;
    count += 1;
    sumT += t;
    sumDb += db;
    sumTT += t * t;
    sumTDb += t * db;
  }
  if (count < 2) return 0;
  const slope = (count * sumTDb - sumT * sumDb) / (count * sumTT - sumT * sumT);
  return slope < 0 ? -60 / slope : 0;
}

/**
 * The time to synthesise each band at, so that each band measures its target
 * through `octaveBandpass`: fixed-point steps of time × target ÷ modelled,
 * each held within 0.8–1.25 of the target.
 */
export function synthesisTimes(targets: BandValues, sampleRate: number): BandValues {
  const { weights } = bandLeakage(sampleRate);
  let times: BandValues = targets;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const current = times;
    times = bandMap(current, (time, k) => {
      const target = targets[k] ?? time;
      const modelled = modelledT20(weights[k] ?? [], current);
      if (!(modelled > 0)) return time;
      return Math.min(MAX_FACTOR * target, Math.max(MIN_FACTOR * target, (time * target) / modelled));
    });
  }
  return times;
}
