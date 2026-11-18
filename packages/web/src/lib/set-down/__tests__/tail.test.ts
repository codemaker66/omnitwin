import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { fft, seededRandom } from "../../planner-sound-render.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../bands.js";
import { referenceDinner, roomState } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, UNCALIBRATED, isRoomSlug, type RoomAcoustics, type RoomSlug } from "../rooms.js";
import {
  TAIL_STEP_SAMPLES,
  renderRoomTail,
  tailFrameSize,
  tailOnsetSeconds,
  tailSlices,
  timeAtFrequency,
  type Stereo,
} from "../tail.js";
import { decayScatter, octaveDecays, sameSamples, type BandDecay } from "./set-down-kit.js";

const RATE = 48000;
/** The rates every room's decay is held at (ruling R46): a laptop's, the default, and a 96 kHz interface's. */
const RATES = [44100, 48000, 96000] as const;
type Rate = (typeof RATES)[number];
const RT: BandValues = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2];
const OPTIONS = { sampleRate: RATE, seed: 7, onsetSeconds: 0.03 } as const;
/** Seeds per room at each rate; each seed is read in both channels. */
const SEEDS: Readonly<Record<Rate, number>> = { 44100: 10, 48000: 10, 96000: 10 };
/**
 * Bands alternating 0.4 s and 3 s, in both phases: each octave's neighbours ring 7.5 times longer or shorter, and
 * between them every octave is once a short one between long ones (ruling R53).
 */
const ALTERNATIONS: readonly BandValues[] = [
  [0.4, 3, 0.4, 3, 0.4, 3, 0.4],
  [3, 0.4, 3, 0.4, 3, 0.4, 3],
];
const TEN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/**
 * One reading of a decay of noise scatters by sigma_D (decayScatter: ISO 3382-2's form, from the octave's
 * bandwidth as read and its time), far more where an octave holds few time-frequency cells: sigma_D is 24 % for a
 * 0.4 s decay read from the 125 Hz octave's seven bins and 2 % for the same decay at 8 kHz. Every reading's decay
 * rate stays within four of it (rulings R67 and R93; readingSigmas), whatever the room.
 */
const READING_SIGMAS = 4;
/** The readings of one band scatter no more than this many sigma_D over their realisations: frame, modulation or decorrelation faults would widen it. */
const SCATTER_SIGMAS = 1.5;
/** The reader's mean over 20 readings of synthetic noise stays within this many standard errors, sigma_D / root 20, of the known time. */
const READER_MEAN_STANDARD_ERRORS = 3;
/**
 * How far a band's mean over its realisations may stray from its target (ruling R52): from 250 Hz to 8 kHz the
 * worst mean over the merged rooms' times (2.1 %, the Reception Room laid at 250 Hz, 96 kHz) plus a margin, 5 %; the 125 Hz
 * octave, read from about seven bins, within 10 %. Seeds 1-10 put the 96 kHz Saloon's 125 Hz at +5.4 % (empty) and +6.3 %
 * (laid), each within 1.8 standard errors; seeds 1-40 put it at +0.7 % and +1.1 %: sampling, not a bias.
 */
const MEAN_BOUND = 0.05;
const MEAN_BOUND_125_HZ = 0.1;

const tail = renderRoomTail(RT, OPTIONS);

function energy(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return sum;
}

function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i] ?? 0;
    meanB += b[i] ?? 0;
  }
  meanA /= n;
  meanB /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (a[i] ?? 0) - meanA;
    const y = (b[i] ?? 0) - meanB;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return ab / Math.sqrt(aa * bb);
}

function room(volumeM3: number, areaM2: number): RoomAcoustics {
  return {
    slug: "test-room",
    volumeM3,
    surfaces: [
      { material: "oak-boards-joists", areaM2: areaM2 / 2, role: "floor" },
      { material: "plaster-masonry", areaM2: areaM2 / 2, role: "wall" },
    ],
    calibration: UNCALIBRATED,
    source: "test",
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const centre = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - centre) ** 2, 0) / Math.max(1, values.length - 1));
}

/**
 * One band's readings: each T20 read, one per channel read; its target; each T20's error (read ÷ target − 1), which
 * the mean and scatter checks hold; and sigma_D for that band, time and rate.
 */
interface BandReadings {
  readonly t20s: readonly number[];
  readonly target: number;
  readonly errors: readonly number[];
  readonly sigma: number;
}

function readingsOf(decays: readonly (readonly BandDecay[])[], rt: BandValues): readonly BandReadings[] {
  return OCTAVE_BANDS_HZ.map((_, band) => {
    const target = rt[band] ?? 1;
    const t20s = decays.map((channel) => channel[band]?.t20 ?? 0);
    return {
      t20s,
      target,
      errors: t20s.map((t20) => t20 / target - 1),
      sigma: decayScatter(decays[0]?.[band]?.bandwidthHz ?? 0, target),
    };
  });
}

/**
 * How far one reading lies from its target, in sigma_D, measured on the decay rate: |target ÷ T20 − 1| ÷ sigma_D,
 * and infinitely far for a failed read, a T20 that is not a finite positive number (ruling R93, after #416's review,
 * NA2).
 *
 * T20 is −60 dB over a fitted slope, so where an octave holds few cells its error is skewed upward while the slope's
 * is near-symmetric: over 600 readings of the alternating 0.4 s band at 125 Hz the T20 error ran −1.75 to +3.90
 * sigma_D and the rate error within ±2.99 (the review's probe). Held on T, four sigma_D was in effect a one-sided
 * two-sigma bound in rate, and a failed read (an error of −100 %) passed it once sigma_D topped 25 %. Held on the
 * rate, four sigma_D means the same on both sides, and a failed read never passes. The rate's error cannot fall
 * below −1, so the bound refuses a long T20 only while four sigma_D is under 1: expectBandWithin requires that.
 */
function readingSigmas(t20: number, target: number, sigma: number): number {
  return Number.isFinite(t20) && t20 > 0 ? Math.abs(target / t20 - 1) / sigma : Number.POSITIVE_INFINITY;
}

/**
 * Every reading of one band a decay, its rate within READING_SIGMAS sigma_D of its target's, on a band whose
 * READING_SIGMAS sigma_D is under 1, so the bound holds on both sides (readingSigmas).
 */
function expectBandWithin({ t20s, target, sigma }: BandReadings, label: string): void {
  expect(READING_SIGMAS * sigma, `${label}: four sigma_D under 1, or no long T20 is refused`).toBeLessThan(1);
  for (const t20 of t20s) {
    const at = `${label}: T20 ${t20.toFixed(3)} s for ${String(target)} s, sigma_D ${(100 * sigma).toFixed(1)} %`;
    expect(t20, at).toBeGreaterThan(0);
    expect(readingSigmas(t20, target, sigma), at).toBeLessThan(READING_SIGMAS);
  }
}

/** Every band's readings within the bound, labelled with the band. */
function expectEachWithin(readings: readonly BandReadings[], label: string): void {
  readings.forEach((band, index) => {
    expectBandWithin(band, `${String(OCTAVE_BANDS_HZ[index])} Hz${label}`);
  });
}

/**
 * Exponentially decaying noise with a known time in each octave, made without
 * the tail's synthesis: Gaussian noise drawn on the bins strictly inside each
 * octave of one long transform, each octave then times its own
 * exp(-6.91 t / T), and the sum faded in over 10 ms. The reader is proved on
 * it before it reads a tail.
 */
function decayingNoise(times: BandValues, sampleRate: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  let n = 1;
  while (n < (1.2 * Math.max(...times) + 0.05) * sampleRate) n <<= 1;
  const out = new Float64Array(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  OCTAVE_BANDS_HZ.forEach((hz, band) => {
    re.fill(0);
    im.fill(0);
    const low = Math.floor(((hz / Math.SQRT2) * n) / sampleRate) + 1;
    const high = Math.min(n / 2 - 1, Math.ceil((hz * Math.SQRT2 * n) / sampleRate) - 1);
    for (let k = low; k <= high; k += 1) {
      // Box-Muller: a complex Gaussian at each bin, and its mirror, so the transform is real.
      const radius = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12)));
      const angle = 2 * Math.PI * random();
      re[k] = radius * Math.cos(angle);
      im[k] = radius * Math.sin(angle);
      re[n - k] = re[k] ?? 0;
      im[n - k] = -(im[k] ?? 0);
    }
    fft(re, im);
    const rate = 6.91 / ((times[band] ?? 1) * sampleRate);
    for (let i = 0; i < n; i += 1) out[i] = (out[i] ?? 0) + (re[i] ?? 0) * Math.exp(-rate * i);
  });
  const fade = Math.round(0.01 * sampleRate);
  for (let i = 0; i < fade; i += 1) out[i] = (out[i] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade));
  return Float32Array.from(out);
}

describe("one reading's distance from its target (ruling R93)", () => {
  /** sigma_D of a 0.4 s decay read from the 125 Hz octave's seven bins at 48 kHz (41.0 Hz): 23.7 %. */
  const sigma = decayScatter(7 * (48000 / 8192), 0.4);

  it("never passes a failed read, however wide the band's scatter: a T20 of 0, not a number, or infinite", () => {
    for (const wide of [sigma, 0.3, 0.5]) {
      for (const failed of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(readingSigmas(failed, 0.4, wide), `T20 ${String(failed)} at sigma_D ${String(wide)}`).toBeGreaterThanOrEqual(READING_SIGMAS);
      }
    }
  });

  it("refuses an absurdly long T20 wherever four sigma_D is under 1, as every band read here is (expectBandWithin checks it)", () => {
    // The rate's error cannot fall below −1, so where four sigma_D reaches 1 (sigma_D of 25 %, a 125 Hz band under
    // about 0.36 s) no finite T20 above the target is refused: expectBandWithin requires four sigma_D under 1.
    expect(READING_SIGMAS * sigma).toBeLessThan(1);
    for (const long of [100, 1000, 1e6]) expect(readingSigmas(long * 0.4, 0.4, sigma), `${String(long)} x the target`).toBeGreaterThanOrEqual(READING_SIGMAS);
  });

  it("puts the alternating band's 3.90 sigma_D T20 (0.769 s for 0.4 s) about two sigma_D out in rate, and readings as far above and below the target's rate the same distance out", () => {
    expect(readingSigmas(0.769, 0.4, sigma)).toBeCloseTo(2.03, 1);
    expect(readingSigmas(0.4 / (1 - 0.48), 0.4, sigma)).toBeCloseTo(readingSigmas(0.4 / (1 + 0.48), 0.4, sigma), 12);
  });
});

describe("the octave reader (rulings R53, R67)", () => {
  // At 96 kHz the reader's frame and this noise both double, and it reads the same values (measured); the proof runs
  // at 48 kHz only, as at 96 kHz it costs 30 s.
  it.each([48000] as const)(
    "reads a known decay in every octave of synthetic noise at %i Hz, 0.4 s between 3 s and 3 s between 0.4 s: its mean over 20 readings within three standard errors (sigma_D / root 20), each reading within four sigma_D",
    (rate) => {
      for (const times of ALTERNATIONS) {
        const decays: (readonly BandDecay[])[] = [];
        for (const seed of TEN_SEEDS) decays.push(...octaveDecays(decayingNoise(times, rate, seed), decayingNoise(times, rate, seed + 100), rate));
        for (const channel of decays) {
          channel.forEach((decay, band) => {
            // Every octave is read from bins of its own, the 125 Hz one included, and every reading is a decay.
            expect(decay.bins, `${String(OCTAVE_BANDS_HZ[band])} Hz`).toBeGreaterThanOrEqual(5);
            expect(decay.t20, `${String(OCTAVE_BANDS_HZ[band])} Hz`).toBeGreaterThan(0);
          });
        }
        const readings = readingsOf(decays, times);
        readings.forEach(({ errors, sigma }, band) => {
          const standardError = sigma / Math.sqrt(errors.length);
          expect(Math.abs(mean(errors)) / standardError, `${String(OCTAVE_BANDS_HZ[band])} Hz of ${times.join("/")}`).toBeLessThan(READER_MEAN_STANDARD_ERRORS);
        });
        expectEachWithin(readings, ` of ${times.join("/")}`);
      }
    },
    120_000,
  );
});

interface Profile {
  readonly name: string;
  readonly slug: RoomSlug | null;
  readonly rt: BandValues;
}

const PROFILES: readonly Profile[] = [
  { name: "the test hall", slug: null, rt: RT },
  ...Object.keys(ROOM_ACOUSTICS).filter(isRoomSlug).flatMap((slug): Profile[] => [
    { name: `${slug}, empty`, slug, rt: roomState(ROOM_ACOUSTICS[slug], []).rt },
    { name: `${slug}, laid for dinner`, slug, rt: roomState(ROOM_ACOUSTICS[slug], referenceDinner(slug)).rt },
  ]),
];

const CASES = RATES.flatMap((rate) => PROFILES.map((profile) => ({ ...profile, rate })));

const measured = new Map<string, readonly BandReadings[]>();
const keyOf = (rt: BandValues, rate: Rate): string => `${String(rate)}|${rt.join(",")}`;

describe("renderRoomTail's decay in every band, read from inside each octave", () => {
  beforeAll(() => {
    // Rooms with the same times (the two galleries) are measured once at each rate.
    for (const { rt, rate } of CASES) {
      const key = keyOf(rt, rate);
      if (measured.has(key)) continue;
      const decays: (readonly BandDecay[])[] = [];
      for (let seed = 1; seed <= SEEDS[rate]; seed += 1) {
        const rendered = renderRoomTail(rt, { ...OPTIONS, sampleRate: rate, seed });
        decays.push(...octaveDecays(rendered.left, rendered.right, rate));
      }
      measured.set(key, readingsOf(decays, rt));
    }
  }, 600_000);

  const readings = (c: { readonly rt: BandValues; readonly rate: Rate }): readonly BandReadings[] => measured.get(keyOf(c.rt, c.rate)) ?? [];

  it.each(CASES)("holds every reading of every band within four sigma_D of its target, the scatter ISO 3382-2 expects of one decay of noise, at $rate Hz: $name", (c) => {
    const each = readings(c);
    expect(each).toHaveLength(OCTAVE_BANDS_HZ.length);
    for (const band of each) expect(band.errors).toHaveLength(2 * SEEDS[c.rate]);
    expectEachWithin(each, "");
  });

  it.each(CASES)("scatters no more than 1.5 sigma_D in any band over its realisations (no frame, modulation or decorrelation fault) at $rate Hz: $name", (c) => {
    readings(c).forEach(({ errors, sigma }, band) => {
      expect(standardDeviation(errors) / sigma, `${String(OCTAVE_BANDS_HZ[band])} Hz`).toBeLessThanOrEqual(SCATTER_SIGMAS);
    });
  });

  it.each(CASES)("holds each band's mean over its realisations on target, 250 Hz to 8 kHz within five percent and 125 Hz within ten, at $rate Hz: $name", (c) => {
    readings(c).forEach(({ errors }, band) => {
      expect(Math.abs(mean(errors.length > 0 ? errors : [Number.NaN])), `${String(OCTAVE_BANDS_HZ[band])} Hz`).toBeLessThan(band === 0 ? MEAN_BOUND_125_HZ : MEAN_BOUND);
    });
  });

  it.each([48000, 96000] as const)(
    "holds alternating 0.4 s and 3 s octaves, both phases, each within ten percent on its mean over 20 readings and every reading within four sigma_D at %i Hz: no octave's decay leaks into its neighbours' (ruling R53)",
    (rate) => {
      for (const times of ALTERNATIONS) {
        const decays: (readonly BandDecay[])[] = [];
        for (const seed of TEN_SEEDS) {
          const rendered = renderRoomTail(times, { ...OPTIONS, sampleRate: rate, seed });
          decays.push(...octaveDecays(rendered.left, rendered.right, rate));
        }
        const each = readingsOf(decays, times);
        each.forEach(({ errors }, band) => {
          expect(Math.abs(mean(errors)), `${String(OCTAVE_BANDS_HZ[band])} Hz of ${times.join("/")}`).toBeLessThan(0.1);
        });
        expectEachWithin(each, ` of ${times.join("/")}`);
      }
    },
    120_000,
  );
});

/** The rates the frame rule is held at (ruling R93): telephone and hands-free rates, the common ones and a studio's. */
const FRAME_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 64000, 88200, 96000, 192000] as const;

describe("the tail's synthesis frame (rulings R46 and R93)", () => {
  it.each(FRAME_RATES)("keeps the bins at %i Hz no wider than 48 kHz's 23.4 Hz, on the smallest frame that does", (rate) => {
    expect(rate / tailFrameSize(rate)).toBeLessThanOrEqual(23.5);
    // Half the frame would make them wider than 48 kHz's.
    expect(rate / (tailFrameSize(rate) / 2)).toBeGreaterThan(48000 / 2048);
  });

  it("keeps 44.1, 48, 88.2 and 96 kHz on the frames R46 gave them, and gives 8, 16, 32 and 64 kHz 15.6 Hz bins", () => {
    expect([44100, 48000, 88200, 96000].map(tailFrameSize)).toEqual([2048, 2048, 4096, 4096]);
    expect([8000, 16000, 32000, 64000].map((rate) => rate / tailFrameSize(rate))).toEqual([15.625, 15.625, 15.625, 15.625]);
  });
});

/**
 * Rates between the common ones. Rounding the frame's exponent to the nearest gave them 31.25 Hz bins, which left the
 * 250 Hz octave two bins of its own time instead of four and read the Reception Room's 250 Hz decay 5.3 % short at
 * 32 kHz empty, and 6.6 % laid for dinner (#416's review, NA3; ruling R93).
 */
const OFF_GRID_RATES = [32000, 64000] as const;
const OFF_GRID_CASES = OFF_GRID_RATES.flatMap((rate) => PROFILES.map((profile) => ({ ...profile, rate })));
/** OCTAVE_BANDS_HZ[1]. */
const BAND_250_HZ = 1;

describe("renderRoomTail's 250 Hz decay at 32 and 64 kHz (ruling R93)", () => {
  const offGrid = new Map<string, BandReadings>();
  const offGridKey = (rt: BandValues, rate: number): string => `${String(rate)}|${rt.join(",")}`;

  beforeAll(() => {
    for (const { rt, rate } of OFF_GRID_CASES) {
      const key = offGridKey(rt, rate);
      if (offGrid.has(key)) continue;
      const decays: (readonly BandDecay[])[] = [];
      for (const seed of TEN_SEEDS) {
        const rendered = renderRoomTail(rt, { ...OPTIONS, sampleRate: rate, seed });
        decays.push(...octaveDecays(rendered.left, rendered.right, rate));
      }
      const band = readingsOf(decays, rt)[BAND_250_HZ];
      if (band !== undefined) offGrid.set(key, band);
    }
  }, 600_000);

  it.each(OFF_GRID_CASES)(
    "holds the 250 Hz octave to R67's bounds at $rate Hz, each reading within four sigma_D in rate, its scatter within 1.5 sigma_D and its mean within five percent: $name",
    (c) => {
      const band = offGrid.get(offGridKey(c.rt, c.rate));
      expect(band?.t20s).toHaveLength(2 * TEN_SEEDS.length);
      if (band === undefined) return;
      expectBandWithin(band, "250 Hz");
      expect(standardDeviation(band.errors) / band.sigma, "250 Hz scatter").toBeLessThanOrEqual(SCATTER_SIGMAS);
      expect(Math.abs(mean(band.errors)), "250 Hz mean").toBeLessThan(MEAN_BOUND);
    },
  );
});

describe("renderRoomTail", () => {
  it("decorrelates the two channels", () => {
    expect(Math.abs(correlation(tail.left, tail.right))).toBeLessThan(0.2);
  });

  it("has unit energy in each channel", () => {
    expect(Math.abs(energy(tail.left) - 1)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(energy(tail.right) - 1)).toBeLessThanOrEqual(1e-3);
  });

  it("is silent before its onset", () => {
    const onsetSamples = OPTIONS.onsetSeconds * RATE;
    for (const channel of [tail.left, tail.right]) {
      for (let i = 0; i < onsetSamples; i += 1) expect(channel[i]).toBe(0);
      // And not silent just after it.
      let after = 0;
      for (let i = Math.ceil(onsetSamples); i < onsetSamples + RATE * 0.05; i += 1) after += (channel[i] ?? 0) ** 2;
      expect(after).toBeGreaterThan(0);
    }
  });

  it("fades in over its first 10 ms", () => {
    const start = Math.ceil(OPTIONS.onsetSeconds * RATE);
    const rms = (channel: Float32Array, from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += (channel[i] ?? 0) ** 2;
      return Math.sqrt(sum / (to - from));
    };
    // The first 2 ms sit well below the 2 ms just after the fade.
    expect(rms(tail.left, start, start + 96)).toBeLessThan(0.25 * rms(tail.left, start + 480, start + 576));
  });

  it("runs 1.2 x its longest time after the onset", () => {
    expect(tail.sampleRate).toBe(RATE);
    expect(tail.left.length).toBe(tail.right.length);
    expect(tail.left.length).toBe(Math.floor((OPTIONS.onsetSeconds + 1.2 * Math.max(...RT)) * RATE));
  });

  it("reaches 1.2 x the longest band's time of any surveyed room's state at 44.1, 48 and 96 kHz, uncut (ruling R46)", () => {
    // Every surveyed room, empty and laid for dinner, worked out at test time, so the check follows the rooms' data
    // as it changes. An empty room rings longest; the laid ones are here anyway.
    const states = Object.keys(ROOM_ACOUSTICS).filter(isRoomSlug).flatMap((slug) => [
      { acoustics: ROOM_ACOUSTICS[slug], rt: roomState(ROOM_ACOUSTICS[slug], []).rt },
      { acoustics: ROOM_ACOUSTICS[slug], rt: roomState(ROOM_ACOUSTICS[slug], referenceDinner(slug)).rt },
    ]);
    const longest = states.reduce((a, b) => (Math.max(...b.rt) > Math.max(...a.rt) ? b : a));
    const onsetSeconds = tailOnsetSeconds(longest.acoustics);
    for (const rate of RATES) {
      const longestTail = renderRoomTail(longest.rt, { sampleRate: rate, seed: 1, onsetSeconds });
      expect(longestTail.left.length, `${String(rate)} Hz`).toBe(Math.floor((onsetSeconds + 1.2 * Math.max(...longest.rt)) * rate));
    }
  });

  it("stops at five seconds however long the room rings, the same at every rate: within 2 MB at 44.1 and 48 kHz, 3.84 MB at 96 kHz", () => {
    const rings: BandValues = [6, 7, 8, 8, 7, 6, 5];
    for (const [rate, bytes] of [[44100, 1_764_000], [48000, 1_920_000], [96000, 3_840_000]] as const) {
      const long = renderRoomTail(rings, { ...OPTIONS, sampleRate: rate });
      expect(long.left.length).toBe(5 * rate);
      expect(long.left.byteLength + long.right.byteLength).toBe(bytes);
      expect(Math.abs(energy(long.left) - 1)).toBeLessThanOrEqual(1e-3);
    }
  });

  it("renders the same samples for the same seed and different ones for another", () => {
    const short: BandValues = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
    const first = renderRoomTail(short, OPTIONS);
    const same = renderRoomTail(short, OPTIONS);
    const other = renderRoomTail(short, { ...OPTIONS, seed: 8 });
    expect(sameSamples(same.left, first.left)).toBe(true);
    expect(sameSamples(same.right, first.right)).toBe(true);
    expect(sameSamples(other.left, first.left)).toBe(false);
  });

  it("stays finite for a zero or invalid time", () => {
    const odd = renderRoomTail([0, Number.NaN, -1, 1, 1, 1, 1], OPTIONS);
    expect(odd.left.every((s) => Number.isFinite(s))).toBe(true);
    expect(odd.right.every((s) => Number.isFinite(s))).toBe(true);
  });
});

describe("timeAtFrequency", () => {
  it("is each band's own time at its centre, and holds the end bands' beyond them", () => {
    OCTAVE_BANDS_HZ.forEach((hz, band) => {
      expect(timeAtFrequency(hz, RT, RATE)).toBe(RT[band]);
    });
    expect(timeAtFrequency(40, RT, RATE)).toBe(RT[0]);
    expect(timeAtFrequency(16000, RT, RATE)).toBe(RT[6]);
  });

  it("keeps the shorter band's time just past a shared edge, then rises to the longer one's", () => {
    // 125 Hz (0.45 s) meets 250 Hz (1.03 s) at 177 Hz, as in the galleries.
    const steep: BandValues = [0.45, 1.03, 0.84, 0.6, 0.43, 0.38, 0.32];
    expect(timeAtFrequency(180, steep, RATE)).toBe(0.45);
    expect(timeAtFrequency(270, steep, RATE)).toBe(1.03);
    let previous = 0;
    for (let hz = 177; hz <= 270; hz += 1) {
      const time = timeAtFrequency(hz, steep, RATE);
      expect(time).toBeGreaterThanOrEqual(previous);
      previous = time;
    }
  });

  it("guards each edge by the same width in hertz at 96 kHz as at 48 kHz, its frame scaled with the rate (ruling R46)", () => {
    const steep: BandValues = [0.45, 1.03, 0.84, 0.6, 0.43, 0.38, 0.32];
    for (let hz = 60; hz <= 12000; hz *= 1.01) expect(timeAtFrequency(hz, steep, 96000)).toBe(timeAtFrequency(hz, steep, 48000));
    // The 250 Hz octave keeps its own time at its centre, which a fixed 2,048-point frame took from it at 96 kHz.
    expect(timeAtFrequency(250, steep, 96000)).toBe(1.03);
  });
});

/**
 * SHA-256 of each channel's float32 bytes of the test hall's tail (RT, seed 7, a 30 ms onset) at each rate: a
 * reference for what the synthesis renders that does not come from the code under test (ruling R93, after #416's
 * review, NA5). Taken from tail.ts as #416 merged it (bfc4705a); NA3's frame rule keeps these rates' frames, and
 * these bytes with them. A change to the synthesis that is meant to change the tail updates these and says why.
 */
const TAIL_SHA256: Readonly<Record<Rate, { readonly left: string; readonly right: string }>> = {
  44100: { left: "164b4ba346571a0a70271b289d2bfca4ee0fe32522a53867a21a866bb28e16af", right: "0b650113d2769db177d4b5e7a88400d4788dacb782923c973a1e60ddfa25f41e" },
  48000: { left: "a58678fe8a8766676a8f50033a4743c7507ada10c69df55df15ce4b04e09a940", right: "76d80fc5f3519d2862d15e839d58c66b68f59ec858f531a60a3ddbf3b04cd069" },
  96000: { left: "ceac14f618733ef714634f05c90cc6824d0ded68e5080ae4dd205135a7297f51", right: "44a9db47f069c783f932b86085c92bb00ce3ad45be4f1134fa472a623587048b" },
};

function sha256(samples: Float32Array): string {
  return createHash("sha256").update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)).digest("hex");
}

describe("tailSlices", () => {
  it.each(RATES)("works in bounded steps at %i Hz, the setup in steps of its own (two at 96 kHz), and renders the pinned tail with another tail's steps between its own", (rate) => {
    const whole = rate === RATE ? tail : renderRoomTail(RT, { ...OPTIONS, sampleRate: rate });
    const slices = tailSlices(RT, { ...OPTIONS, sampleRate: rate });
    // Another tail at the same rate, stepped between this one's steps: any state the two shared, even per frame size,
    // would show in either.
    const otherTimes = ALTERNATIONS[0] ?? RT;
    const otherOptions = { sampleRate: rate, seed: 3, onsetSeconds: 0.05 };
    const other = tailSlices(otherTimes, otherOptions);
    const steps: number[] = [];
    let step = slices.next();
    let otherStep = other.next();
    while (step.done !== true) {
      steps.push(step.value);
      if (otherStep.done !== true) otherStep = other.next();
      step = slices.next();
    }
    while (otherStep.done !== true) otherStep = other.next();
    const sliced: Stereo = step.value;
    expect(steps.length).toBeGreaterThanOrEqual(7);
    // The first steps set the synthesis up, one for each 1,024 bins of its frame, and cover no samples (ruling R72):
    // one at 44.1 and 48 kHz (1,024 bins), two at 96 kHz (2,048). Every later step covers some.
    const setupSteps = steps.findIndex((samples) => samples > 0);
    expect(setupSteps).toBe(rate === 96000 ? 2 : 1);
    for (const samples of steps.slice(setupSteps)) {
      expect(samples).toBeGreaterThan(0);
      expect(samples).toBeLessThanOrEqual(TAIL_STEP_SAMPLES);
    }
    expect(TAIL_STEP_SAMPLES).toBe(8192);
    expect(sliced.sampleRate).toBe(rate);
    expect(sha256(sliced.left)).toBe(TAIL_SHA256[rate].left);
    expect(sha256(sliced.right)).toBe(TAIL_SHA256[rate].right);
    expect(sha256(whole.left)).toBe(TAIL_SHA256[rate].left);
    expect(sha256(whole.right)).toBe(TAIL_SHA256[rate].right);
    const otherWhole = renderRoomTail(otherTimes, otherOptions);
    expect(sameSamples(otherStep.value.left, otherWhole.left)).toBe(true);
    expect(sameSamples(otherStep.value.right, otherWhole.right)).toBe(true);
  });
});

describe("tailOnsetSeconds", () => {
  it("is the mean free path over the speed of sound", () => {
    expect(tailOnsetSeconds(room(1000, 600))).toBeCloseTo((4 * 1000) / 600 / 343, 9);
  });

  it("clamps to 12-80 ms", () => {
    expect(tailOnsetSeconds(room(1, 600))).toBe(0.012);
    expect(tailOnsetSeconds(room(1e6, 600))).toBe(0.08);
    expect(tailOnsetSeconds(room(1000, 0))).toBe(0.08);
  });

  it("gives every surveyed room an onset in range", () => {
    for (const acoustics of Object.values(ROOM_ACOUSTICS)) {
      const onset = tailOnsetSeconds(acoustics);
      expect(onset).toBeGreaterThanOrEqual(0.012);
      expect(onset).toBeLessThanOrEqual(0.08);
    }
  });
});
