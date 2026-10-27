// ---------------------------------------------------------------------------
// The late reverberant tail of a room (T-677).
//
// The tail is the room's impulse response after its first reflections: in
// each octave band, noise that dies away at that band's reverberation time.
// A ConvolverNode plays it as the room's echo, so it is rendered once per room
// state and normalised to unit energy; the send gain sets how loud it is.
// The two channels are independent noise, so the echo is wide.
// ---------------------------------------------------------------------------

import { seededRandom } from "../planner-sound-render.js";
import { octaveBandpass } from "./analysis.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "./bands.js";
import type { RoomAcoustics } from "./rooms.js";

/** Two channels of samples at one rate. */
export interface Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

const SPEED_OF_SOUND_M_PER_S = 343;
const ONSET_MIN_S = 0.012;
const ONSET_MAX_S = 0.08;
/** ln(1000): a decay of 60 dB in amplitude over the reverberation time. */
const DECAY_PER_RT = 6.91;
/** The tail runs this many times its longest reverberation time, to -72 dB, so T20 is never truncated. */
const LENGTH_PER_RT = 1.2;
const FADE_IN_S = 0.01;
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
 * Adds one band of decaying noise from `random` into `channel`, starting at
 * `start`. The band stops at 1.2 times its own time (-72 dB), so a short band
 * costs less to render than the longest.
 */
function addBand(
  channel: Float32Array,
  start: number,
  centreHz: number,
  rt: number,
  random: () => number,
  sampleRate: number,
): void {
  const length = Math.min(channel.length - start, Math.ceil(LENGTH_PER_RT * rt * sampleRate));
  if (length <= 0) return;
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i += 1) noise[i] = 2 * random() - 1;
  const band = octaveBandpass(noise, centreHz, sampleRate);
  const step = Math.exp(-DECAY_PER_RT / (rt * sampleRate));
  const fadeSamples = Math.max(1, Math.round(FADE_IN_S * sampleRate));
  let envelope = 1;
  for (let i = 0; i < length; i += 1) {
    const fade = i < fadeSamples ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples) : 1;
    channel[start + i] = (channel[start + i] ?? 0) + (band[i] ?? 0) * envelope * fade;
    envelope *= step;
  }
}

function normalise(channel: Float32Array): void {
  let energy = 0;
  for (let i = 0; i < channel.length; i += 1) energy += (channel[i] ?? 0) ** 2;
  if (energy <= 0) return;
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < channel.length; i += 1) channel[i] = (channel[i] ?? 0) * scale;
}

/**
 * Renders the tail one band at a time, so it can be driven in idle slices.
 * Each step renders one band of both channels and yields the fraction done
 * (1/7 … 7/7); the step after the last normalises and returns the tail.
 */
export function* tailSlices(
  rt: BandValues,
  options: { sampleRate: number; seed: number; onsetSeconds: number },
): Iterator<number, Stereo> {
  const { sampleRate } = options;
  const times = rt.map(safeTime);
  const onset = Number.isFinite(options.onsetSeconds) ? Math.max(0, options.onsetSeconds) : 0;
  const maxSamples = Math.floor(MAX_BYTES / (2 * Float32Array.BYTES_PER_ELEMENT));
  const length = Math.min(maxSamples, Math.floor((onset + LENGTH_PER_RT * Math.max(...times)) * sampleRate));
  // The first sample at or after the onset, so everything before it is silent.
  const start = Math.ceil(onset * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const randomLeft = seededRandom(options.seed);
  const randomRight = seededRandom((options.seed + RIGHT_SEED_OFFSET) >>> 0);
  for (let band = 0; band < OCTAVE_BANDS_HZ.length; band += 1) {
    const hz = OCTAVE_BANDS_HZ[band] ?? 1000;
    const time = times[band] ?? MIN_RT_S;
    addBand(left, start, hz, time, randomLeft, sampleRate);
    addBand(right, start, hz, time, randomRight, sampleRate);
    yield (band + 1) / OCTAVE_BANDS_HZ.length;
  }
  normalise(left);
  normalise(right);
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
