// ---------------------------------------------------------------------------
// The late reverberant tail of a room (T-677).
//
// The tail is the room's impulse response after its first reflections: in
// each octave band, noise that dies away at that band's reverberation time.
// A ConvolverNode plays it as the room's echo, so it is rendered once per room
// state and normalised to unit energy; the send gain sets how loud it is.
// The two channels are independent noise, so the echo is wide.
//
// It is rendered in small steps so it can be driven in idle slices: no step
// touches more than TAIL_STEP_SAMPLES samples of one channel.
// ---------------------------------------------------------------------------

import { biquadCoefficients, seededRandom } from "../planner-sound-render.js";
import { OCTAVE_Q } from "./analysis.js";
import { OCTAVE_BANDS_HZ, bandMap, type BandValues } from "./bands.js";
import type { RoomAcoustics } from "./rooms.js";
import { bandLeakage, synthesisTimes } from "./tail-correction.js";

/** Two channels of samples at one rate. */
export interface Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

/** The most samples of one channel any step of `tailSlices` processes (about 4 ms on a mid-range phone). */
export const TAIL_STEP_SAMPLES = 8192;

const SPEED_OF_SOUND_M_PER_S = 343;
const ONSET_MIN_S = 0.012;
const ONSET_MAX_S = 0.08;
/** ln(1000): a decay of 60 dB in amplitude over the reverberation time. */
const DECAY_PER_RT = 6.91;
/** The buffer runs this many times the longest reverberation time, to -72 dB, so T20 is never truncated. */
const LENGTH_PER_RT = 1.2;
/** Each band's noise stops this many times its own time after the onset, below -75 dB. */
const BAND_LENGTH_PER_RT = 1.25;
const FADE_IN_S = 0.01;
/** The window each band's running power is measured over, to hold it steady. */
const POWER_WINDOW_S = 0.02;
/** The running power is never taken below this, so the division stays finite. */
const MIN_POWER = 1e-30;
/** The tail's two channels together stay within 2 MB. */
const MAX_BYTES = 2_000_000;
/** A band time below this (or not a number) is treated as this, so the decay stays finite. */
const MIN_RT_S = 0.05;
/** Half the mulberry32 period apart, so the right channel's noise never repeats the left's. */
const RIGHT_SEED_OFFSET = 0x80000000;

/** Where the late tail begins: the mean free path 4V/S over the speed of sound, clamped to 12-80 ms. */
export function tailOnsetSeconds(room: RoomAcoustics): number {
  let area = 0;
  for (const surface of room.surfaces) area += surface.areaM2;
  const onset = (4 * room.volumeM3) / area / SPEED_OF_SOUND_M_PER_S;
  if (!Number.isFinite(onset)) return ONSET_MAX_S;
  return Math.min(ONSET_MAX_S, Math.max(ONSET_MIN_S, onset));
}

function safeTime(t: number): number {
  return Number.isFinite(t) && t > MIN_RT_S ? t : MIN_RT_S;
}

/**
 * Adds one band of decaying noise from `random` into `channel` from `start`,
 * a step at a time, yielding the samples each step processed. The noise runs
 * through the same two band-pass stages as `octaveBandpass`, with their state
 * carried across steps (each stage's output held at float precision, as that
 * function's in-place filtering does), so the band is the same as filtering
 * it all at once. It stops 1.25 times its own time after the onset.
 *
 * Band-limited noise swells and fades at random over tens of milliseconds,
 * and those swells scatter a band's decay by several percent from one seed to
 * the next. So each band is held at its expected power (`expectedPower`, the
 * mean square of the filtered noise): it is divided by its running power over
 * the last 20 ms and scaled back to that mean. The fine grain of the noise
 * stays; the band keeps the share of energy white noise would give it.
 */
function* bandSteps(
  channel: Float32Array,
  start: number,
  centreHz: number,
  rt: number,
  expectedPower: number,
  random: () => number,
  sampleRate: number,
): Generator<number, void> {
  const length = Math.min(channel.length - start, Math.ceil(BAND_LENGTH_PER_RT * rt * sampleRate));
  if (length <= 0) return;
  const c = biquadCoefficients("bandpass", centreHz, OCTAVE_Q, sampleRate);
  const decayStep = Math.exp(-DECAY_PER_RT / (rt * sampleRate));
  const fadeSamples = Math.max(1, Math.round(FADE_IN_S * sampleRate));
  const powerPole = Math.exp(-1 / (POWER_WINDOW_S * sampleRate));
  let ax1 = 0, ax2 = 0, ay1 = 0, ay2 = 0;
  let bx1 = 0, bx2 = 0, by1 = 0, by2 = 0;
  let envelope = 1;
  let power = expectedPower;
  for (let from = 0; from < length; from += TAIL_STEP_SAMPLES) {
    const to = Math.min(length, from + TAIL_STEP_SAMPLES);
    for (let i = from; i < to; i += 1) {
      const x = Math.fround(2 * random() - 1);
      const ya = c.b0 * x + c.b1 * ax1 + c.b2 * ax2 - c.a1 * ay1 - c.a2 * ay2;
      ax2 = ax1; ax1 = x; ay2 = ay1; ay1 = ya;
      const u = Math.fround(ya);
      const yb = c.b0 * u + c.b1 * bx1 + c.b2 * bx2 - c.a1 * by1 - c.a2 * by2;
      bx2 = bx1; bx1 = u; by2 = by1; by1 = yb;
      const band = Math.fround(yb);
      power = powerPole * power + (1 - powerPole) * band * band;
      const steady = band * Math.sqrt(expectedPower / Math.max(power, MIN_POWER));
      const fade = i < fadeSamples ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples) : 1;
      channel[start + i] = (channel[start + i] ?? 0) + steady * envelope * fade;
      envelope *= decayStep;
    }
    yield to - from;
  }
}

/** Scales `channel` to unit energy, a step at a time: one pass to measure, one to scale. */
function* normaliseSteps(channel: Float32Array): Generator<number, void> {
  let energy = 0;
  for (let from = 0; from < channel.length; from += TAIL_STEP_SAMPLES) {
    const to = Math.min(channel.length, from + TAIL_STEP_SAMPLES);
    for (let i = from; i < to; i += 1) energy += (channel[i] ?? 0) ** 2;
    yield to - from;
  }
  if (energy <= 0) return;
  const scale = 1 / Math.sqrt(energy);
  for (let from = 0; from < channel.length; from += TAIL_STEP_SAMPLES) {
    const to = Math.min(channel.length, from + TAIL_STEP_SAMPLES);
    for (let i = from; i < to; i += 1) channel[i] = (channel[i] ?? 0) * scale;
    yield to - from;
  }
}

/**
 * Renders the tail in steps, so it can be driven in idle slices. Each step
 * works on at most TAIL_STEP_SAMPLES samples of one band in one channel (or,
 * at the end, of one channel's normalising) and yields how many it processed.
 * The number of steps grows with the tail's length. The last call returns
 * the finished tail, identical to `renderRoomTail`'s for the same options.
 */
export function* tailSlices(
  rt: BandValues,
  options: { sampleRate: number; seed: number; onsetSeconds: number },
): Iterator<number, Stereo> {
  const { sampleRate } = options;
  const targets = bandMap(rt, safeTime);
  const onset = Number.isFinite(options.onsetSeconds) ? Math.max(0, options.onsetSeconds) : 0;
  const maxSamples = Math.floor(MAX_BYTES / (2 * Float32Array.BYTES_PER_ELEMENT));
  const length = Math.min(maxSamples, Math.floor((onset + LENGTH_PER_RT * Math.max(...targets)) * sampleRate));
  // The first sample at or after the onset, so everything before it is silent.
  const start = Math.ceil(onset * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const randomLeft = seededRandom(options.seed);
  const randomRight = seededRandom((options.seed + RIGHT_SEED_OFFSET) >>> 0);
  // The first step processes no samples: it corrects the band times for the
  // leak between bands, so each band measures its target.
  const times = synthesisTimes(targets, sampleRate);
  const { bandPower } = bandLeakage(sampleRate);
  yield 0;
  for (let band = 0; band < OCTAVE_BANDS_HZ.length; band += 1) {
    const hz = OCTAVE_BANDS_HZ[band] ?? 1000;
    const time = times[band] ?? MIN_RT_S;
    const power = bandPower[band] ?? 0;
    yield* bandSteps(left, start, hz, time, power, randomLeft, sampleRate);
    yield* bandSteps(right, start, hz, time, power, randomRight, sampleRate);
  }
  yield* normaliseSteps(left);
  yield* normaliseSteps(right);
  return { left, right, sampleRate };
}

/** The whole tail at once: `tailSlices` run to the end. */
export function renderRoomTail(
  rt: BandValues,
  options: { readonly sampleRate: number; readonly seed: number; readonly onsetSeconds: number },
): Stereo {
  const slices = tailSlices(rt, { ...options });
  for (;;) {
    const step = slices.next();
    if (step.done === true) return step.value;
  }
}
