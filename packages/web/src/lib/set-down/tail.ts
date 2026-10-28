// ---------------------------------------------------------------------------
// The late reverberant tail of a room (T-677).
//
// The tail is the room's impulse response after its first reflections: noise
// whose every frequency dies away at the room's reverberation time there. A
// ConvolverNode plays it as the room's echo, so it is rendered once per room
// state and normalised to unit energy; the send gain sets how loud it is. The
// two channels are independent noise, so the echo is wide.
//
// It is synthesised by short-time overlap-add, so no band leaks into another:
// each 2,048-point frame is a spectrum of seeded random phases whose amplitude
// in every bin is that bin's decay at the frame's centre, exp(-6.91 t / T(f)).
// The inverse transform of each frame is Hann-windowed and overlap-added at a
// hop of 512, where the windows' squares sum to a constant, so independent
// frames add to a steady level.
//
// It is rendered in small steps so it can be driven in idle slices: no step
// covers more than TAIL_STEP_SAMPLES samples of one channel.
// ---------------------------------------------------------------------------

import { fft, seededRandom } from "../planner-sound-render.js";
import { OCTAVE_BANDS_HZ, bandMap, type BandValues } from "./bands.js";
import type { RoomAcoustics } from "./rooms.js";

/** Two channels of samples at one rate. */
export interface Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

/** The most samples of one channel any step of `tailSlices` covers. */
export const TAIL_STEP_SAMPLES = 8192;

const SPEED_OF_SOUND_M_PER_S = 343;
const ONSET_MIN_S = 0.012;
const ONSET_MAX_S = 0.08;
/** ln(1000): a decay of 60 dB in amplitude over the reverberation time. */
const DECAY_PER_RT = 6.91;
/** The buffer runs this many times the longest reverberation time, to -72 dB, so T20 is never truncated. */
const LENGTH_PER_RT = 1.2;
const FADE_IN_S = 0.01;
/** The tail's two channels together stay within 2 MB. */
const MAX_BYTES = 2_000_000;
/** A band time below this (or not a number) is treated as this, so the decay stays finite. */
const MIN_RT_S = 0.05;
/** Half the mulberry32 period apart, so the right channel's noise never repeats the left's. */
const RIGHT_SEED_OFFSET = 0x80000000;

const FRAME = 2048;
const HOP = 512;
/** Frames per step: their hops cover 1,024 samples of each channel, well inside the step limit. */
const FRAMES_PER_STEP = 2;
/** Phases are drawn from this many equal steps around the circle, so a phase walk is integer arithmetic. */
const PHASES = 4096;
/** How far each bin's phase turns in one hop at its own frequency, in phase steps per bin index. */
const PHASE_PER_BIN_PER_HOP = (PHASES * HOP) / FRAME;
/**
 * The transition from one band's time to the next, beyond the shorter band's
 * guard, in octaves. Narrow, so each octave holds its own time.
 */
const RAMP_OCTAVES = 0.05;

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

let phaseTable: { readonly cos: Float64Array; readonly sin: Float64Array } | null = null;

function phases(): { readonly cos: Float64Array; readonly sin: Float64Array } {
  if (phaseTable !== null) return phaseTable;
  const cos = new Float64Array(PHASES);
  const sin = new Float64Array(PHASES);
  for (let i = 0; i < PHASES; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / PHASES);
    sin[i] = Math.sin((2 * Math.PI * i) / PHASES);
  }
  phaseTable = { cos, sin };
  return phaseTable;
}

/**
 * The reverberation time at `hz`, interpolated in log-frequency between the
 * octave-band times and held beyond 125 Hz and 8 kHz.
 *
 * Each band keeps its own time across its octave. Where two bands meet, the
 * shorter one keeps its time past the shared edge by the frame's spectral
 * smear (half the Hann main lobe, 2 bins), and the time then rises over
 * 1/20 octave to the longer band's. A longer decay leaking into a shorter
 * band would take over that band's late decay; a shorter one leaking into a
 * longer band dies early and barely moves it.
 */
export function timeAtFrequency(hz: number, times: BandValues, sampleRate: number): number {
  const octave = Math.log2(hz / OCTAVE_BANDS_HZ[0]);
  const smearHz = (2 * sampleRate) / FRAME;
  let shortest = Infinity;
  for (let band = 0; band < OCTAVE_BANDS_HZ.length; band += 1) {
    const time = times[band] ?? MIN_RT_S;
    const below = octave < band;
    const heldBeyondEnd = (band === 0 && octave < 0) || (band === OCTAVE_BANDS_HZ.length - 1 && octave > band);
    const distance = heldBeyondEnd ? 0 : Math.abs(octave - band);
    const edgeHz = OCTAVE_BANDS_HZ[0] * 2 ** (below ? band - 0.5 : band + 0.5);
    const guard = Math.log2(1 + smearHz / edgeHz);
    const over = distance - (0.5 + guard);
    if (over <= 0) {
      shortest = Math.min(shortest, time);
    } else if (over < RAMP_OCTAVES) {
      const weight = 0.5 + 0.5 * Math.cos((Math.PI * over) / RAMP_OCTAVES);
      shortest = Math.min(shortest, time / weight);
    }
  }
  return shortest;
}

/**
 * Synthesises both channels a few frames at a time, yielding the samples of
 * each channel the step's hops covered. Each frame packs the left and right
 * spectra into one complex transform (left + j·right, both conjugate
 * symmetric), so one inverse transform gives both channels.
 *
 * Each bin's phase walks by a random quarter turn either way from one frame to
 * the next (on top of its own frequency's turn over the hop), from seeded
 * random starts. Adjacent overlapping frames then add without the random
 * cancellation that independent phases bring, so the decay is steadier from
 * seed to seed; the walk still decorrelates frames a few hops apart.
 */
function* synthesisSteps(
  left: Float32Array,
  right: Float32Array,
  start: number,
  times: BandValues,
  seed: number,
  sampleRate: number,
): Generator<number, void> {
  const { cos, sin } = phases();
  const bins = FRAME / 2;
  const randomLeft = seededRandom(seed);
  const randomRight = seededRandom((seed + RIGHT_SEED_OFFSET) >>> 0);
  const window = new Float64Array(FRAME);
  for (let n = 0; n < FRAME; n += 1) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FRAME);
  // Frames start one frame less a hop before the onset, so the overlap is full from the onset on.
  const firstFrame = start - FRAME + HOP;
  const firstCentre = (firstFrame + FRAME / 2 - start) / sampleRate;
  const amplitude = new Float64Array(bins);
  const decayPerHop = new Float64Array(bins);
  const phaseLeft = new Int32Array(bins);
  const phaseRight = new Int32Array(bins);
  for (let k = 1; k < bins; k += 1) {
    const rate = DECAY_PER_RT / timeAtFrequency((k * sampleRate) / FRAME, times, sampleRate);
    amplitude[k] = Math.exp(-rate * firstCentre);
    decayPerHop[k] = Math.exp((-rate * HOP) / sampleRate);
    phaseLeft[k] = Math.floor(randomLeft() * PHASES);
    phaseRight[k] = Math.floor(randomRight() * PHASES);
  }
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const length = left.length;
  let framesInStep = 0;
  for (let frameStart = firstFrame; frameStart < length; frameStart += HOP) {
    re.fill(0);
    im.fill(0);
    for (let k = 1; k < bins; k += 1) {
      const turn = (k * PHASE_PER_BIN_PER_HOP) % PHASES;
      const l = (phaseLeft[k] = ((phaseLeft[k] ?? 0) + turn + (randomLeft() < 0.5 ? PHASES / 4 : (3 * PHASES) / 4)) % PHASES);
      const r = (phaseRight[k] = ((phaseRight[k] ?? 0) + turn + (randomRight() < 0.5 ? PHASES / 4 : (3 * PHASES) / 4)) % PHASES);
      const a = amplitude[k] ?? 0;
      const lr = a * (cos[l] ?? 0), li = a * (sin[l] ?? 0);
      const rr = a * (cos[r] ?? 0), ri = a * (sin[r] ?? 0);
      // Z = L + jR at bin k, and its mirror conj(L) + j conj(R) at N - k. The
      // inverse transform is taken as the conjugate of the forward transform of
      // conj(Z): its real part is the left channel and minus its imaginary part
      // the right (each scaled by N, which the normalising removes).
      re[k] = lr - ri;
      im[k] = -(li + rr);
      re[FRAME - k] = lr + ri;
      im[FRAME - k] = li - rr;
      amplitude[k] = a * (decayPerHop[k] ?? 0);
    }
    fft(re, im);
    for (let n = 0; n < FRAME; n += 1) {
      const i = frameStart + n;
      if (i < start || i >= length) continue;
      const w = window[n] ?? 0;
      left[i] = (left[i] ?? 0) + (re[n] ?? 0) * w;
      right[i] = (right[i] ?? 0) - (im[n] ?? 0) * w;
    }
    framesInStep += 1;
    if (framesInStep === FRAMES_PER_STEP) {
      yield framesInStep * HOP;
      framesInStep = 0;
    }
  }
  if (framesInStep > 0) yield framesInStep * HOP;
}

/** Fades the first 10 ms after the onset in, then scales `channel` to unit energy, a step at a time. */
function* finishSteps(channel: Float32Array, start: number, sampleRate: number): Generator<number, void> {
  const fadeSamples = Math.max(1, Math.round(FADE_IN_S * sampleRate));
  for (let i = 0; i < fadeSamples && start + i < channel.length; i += 1) {
    channel[start + i] = (channel[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples));
  }
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
 * covers at most TAIL_STEP_SAMPLES samples of each channel (a few frames, or
 * a chunk of the normalising) and yields how many it covered. The number of
 * steps grows with the tail's length. The last call returns the finished
 * tail, identical to `renderRoomTail`'s for the same options.
 */
export function* tailSlices(
  rt: BandValues,
  options: { sampleRate: number; seed: number; onsetSeconds: number },
): Iterator<number, Stereo> {
  const { sampleRate } = options;
  const times = bandMap(rt, safeTime);
  const onset = Number.isFinite(options.onsetSeconds) ? Math.max(0, options.onsetSeconds) : 0;
  const maxSamples = Math.floor(MAX_BYTES / (2 * Float32Array.BYTES_PER_ELEMENT));
  const length = Math.min(maxSamples, Math.floor((onset + LENGTH_PER_RT * Math.max(...times)) * sampleRate));
  // The first sample at or after the onset, so everything before it is silent.
  const start = Math.ceil(onset * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  yield* synthesisSteps(left, right, start, times, options.seed, sampleRate);
  yield* finishSteps(left, start, sampleRate);
  yield* finishSteps(right, start, sampleRate);
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
