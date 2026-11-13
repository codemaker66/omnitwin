// ---------------------------------------------------------------------------
// The late reverberant tail of a room (T-700).
//
// The tail is the room's impulse response after its first reflections: noise
// whose every frequency dies away at the room's reverberation time there. A
// ConvolverNode plays it as the room's echo, so it is rendered once per room
// state and normalised to unit energy; the send gain sets how loud it is. The
// two channels are independent noise, so the echo is wide.
//
// It is synthesised by short-time overlap-add, so no band leaks into another:
// each frame is a spectrum of seeded random phases whose amplitude in every
// bin is that bin's decay at the frame's centre, exp(-6.91 t / T(f)). The
// frame is 2,048 points at 44.1 and 48 kHz and scales with the rate, so its
// bins are 21.5-23.4 Hz wide at every common rate (ruling R46). The inverse
// transform of each frame is Hann-windowed and overlap-added at a hop of a
// quarter frame, where the windows' squares sum to a constant, so independent
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
/**
 * The tail runs this long at most, however long the room rings: a cap in
 * time, so it cuts every rate at the same point of the decay (ruling R46).
 * Every surveyed room in every state needs less (tail.test.ts works out the
 * longest at test time); the plain plaster box a space with no survey gets
 * rings longer, and is cut here about 46 dB down its longest band. A 5 s tail
 * is 1.76 MB of two channels at 44.1 kHz, 1.92 MB at 48 kHz, 3.84 MB at
 * 96 kHz and 7.68 MB at 192 kHz.
 */
const MAX_SECONDS = 5;
/** A band time below this (or not a number) is treated as this, so the decay stays finite. */
const MIN_RT_S = 0.05;
/** Half the mulberry32 period apart, so the right channel's noise never repeats the left's. */
const RIGHT_SEED_OFFSET = 0x80000000;

/** The synthesis frame at 48 kHz: 2,048 points, bins 23.4 Hz wide. */
const FRAME_AT_48K = 2048;
const FRAME_RATE_HZ = 48000;
/** The frame is held to 2^-3 to 2^3 times its 48 kHz size (256 to 16,384 points), whatever the rate. */
const FRAME_OCTAVES = [-3, 3] as const;
/** Four hops to a frame: Hann windows a quarter frame apart have squares that sum to a constant. */
const HOPS_PER_FRAME = 4;
/** Each step's hops cover about this many samples of each channel (two hops at 44.1 and 48 kHz, one at 96 kHz), well inside the step limit. */
const SAMPLES_PER_STEP = 1024;
/** Phases are drawn from this many equal steps around the circle, so a phase walk is integer arithmetic. */
const PHASES = 4096;
/**
 * The transition from one band's time to the next, beyond the shorter band's
 * guard, in octaves. Narrow, so each octave holds its own time.
 */
const RAMP_OCTAVES = 0.05;

/** How a tail is framed at one rate, worked out once per render. */
interface Framing {
  readonly frame: number;
  readonly hop: number;
  /** How far each bin's phase turns in one hop at its own frequency, in phase steps per bin index. */
  readonly phasePerBinPerHop: number;
  readonly framesPerStep: number;
  /** Half the Hann main lobe, two bins, in hertz: how far a bin's energy spreads into its neighbours. */
  readonly smearHz: number;
}

/**
 * The synthesis frame at `sampleRate` (ruling R46): 2,048 x 2^round(log2(sr /
 * 48 kHz)) points, so 1,024 at 22.05 kHz, 2,048 at 44.1 and 48, 4,096 at 88.2
 * and 96 and 8,192 at 192 kHz, each bin 21.5-23.4 Hz wide, and a quarter of
 * it per hop. A frame fixed at 2,048 points made the bins 46.9 Hz wide at
 * 96 kHz; the guard between bands (timeAtFrequency) grew with them, until the
 * 250 Hz octave held none of its own time.
 */
function framing(sampleRate: number): Framing {
  const octaves = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(Math.log2(sampleRate / FRAME_RATE_HZ)) : 0;
  const frame = FRAME_AT_48K * 2 ** Math.min(FRAME_OCTAVES[1], Math.max(FRAME_OCTAVES[0], octaves));
  const hop = frame / HOPS_PER_FRAME;
  return {
    frame,
    hop,
    phasePerBinPerHop: (PHASES * hop) / frame,
    framesPerStep: Math.max(1, Math.round(SAMPLES_PER_STEP / hop)),
    smearHz: (2 * sampleRate) / frame,
  };
}

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
 * smear (half the Hann main lobe, 2 bins of the frame at `sampleRate`), and
 * the time then rises over 1/20 octave to the longer band's. A longer decay
 * leaking into a shorter band would take over that band's late decay; a
 * shorter one leaking into a longer band dies early and barely moves it.
 */
export function timeAtFrequency(hz: number, times: BandValues, sampleRate: number): number {
  return timeWithSmear(hz, times, framing(sampleRate).smearHz);
}

function timeWithSmear(hz: number, times: BandValues, smearHz: number): number {
  const octave = Math.log2(hz / OCTAVE_BANDS_HZ[0]);
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
  framed: Framing,
): Generator<number, void> {
  const { cos, sin } = phases();
  const { frame, hop, phasePerBinPerHop, framesPerStep, smearHz } = framed;
  const bins = frame / 2;
  const randomLeft = seededRandom(seed);
  const randomRight = seededRandom((seed + RIGHT_SEED_OFFSET) >>> 0);
  const window = new Float64Array(frame);
  for (let n = 0; n < frame; n += 1) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / frame);
  // Frames start one frame less a hop before the onset, so the overlap is full from the onset on.
  const firstFrame = start - frame + hop;
  const firstCentre = (firstFrame + frame / 2 - start) / sampleRate;
  const amplitude = new Float64Array(bins);
  const decayPerHop = new Float64Array(bins);
  const phaseLeft = new Int32Array(bins);
  const phaseRight = new Int32Array(bins);
  for (let k = 1; k < bins; k += 1) {
    const rate = DECAY_PER_RT / timeWithSmear((k * sampleRate) / frame, times, smearHz);
    amplitude[k] = Math.exp(-rate * firstCentre);
    decayPerHop[k] = Math.exp((-rate * hop) / sampleRate);
    phaseLeft[k] = Math.floor(randomLeft() * PHASES);
    phaseRight[k] = Math.floor(randomRight() * PHASES);
  }
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  // The setup (the window, each bin's decay and phases) is a step of its own and covers no samples: at 192 kHz it
  // and the first frame together took longer than an idle slice (ruling R72).
  yield 0;
  const length = left.length;
  let framesInStep = 0;
  for (let frameStart = firstFrame; frameStart < length; frameStart += hop) {
    re.fill(0);
    im.fill(0);
    for (let k = 1; k < bins; k += 1) {
      const turn = (k * phasePerBinPerHop) % PHASES;
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
      re[frame - k] = lr + ri;
      im[frame - k] = li - rr;
      amplitude[k] = a * (decayPerHop[k] ?? 0);
    }
    fft(re, im);
    for (let n = 0; n < frame; n += 1) {
      const i = frameStart + n;
      if (i < start || i >= length) continue;
      const w = window[n] ?? 0;
      left[i] = (left[i] ?? 0) + (re[n] ?? 0) * w;
      right[i] = (right[i] ?? 0) - (im[n] ?? 0) * w;
    }
    framesInStep += 1;
    if (framesInStep === framesPerStep) {
      yield framesInStep * hop;
      framesInStep = 0;
    }
  }
  if (framesInStep > 0) yield framesInStep * hop;
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
 * Renders the tail in steps, so it can be driven in idle slices. The first
 * step is the synthesis's setup and covers no samples; each later one covers
 * at most TAIL_STEP_SAMPLES samples of each channel (a few frames, or a chunk
 * of the normalising) and yields how many it covered. The number of steps
 * grows with the tail's length. The last call returns the finished tail,
 * identical to `renderRoomTail`'s for the same options.
 */
export function* tailSlices(
  rt: BandValues,
  options: { sampleRate: number; seed: number; onsetSeconds: number },
): Iterator<number, Stereo> {
  const { sampleRate } = options;
  const times = bandMap(rt, safeTime);
  const onset = Number.isFinite(options.onsetSeconds) ? Math.max(0, options.onsetSeconds) : 0;
  const length = Math.min(Math.floor(MAX_SECONDS * sampleRate), Math.floor((onset + LENGTH_PER_RT * Math.max(...times)) * sampleRate));
  // The first sample at or after the onset, so everything before it is silent.
  const start = Math.ceil(onset * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  yield* synthesisSteps(left, right, start, times, options.seed, sampleRate, framing(sampleRate));
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
