import { beforeAll, describe, expect, it } from "vitest";
import { fft, seededRandom } from "../../planner-sound-render.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../bands.js";
import { referenceDinner, roomAcousticsFor, roomState } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, UNCALIBRATED, isRoomSlug, type RoomAcoustics, type RoomSlug } from "../rooms.js";
import {
  TAIL_STEP_SAMPLES,
  renderRoomTail,
  tailOnsetSeconds,
  tailSlices,
  timeAtFrequency,
  type Stereo,
} from "../tail.js";
import { octaveDecays, sameSamples, type BandDecay } from "./set-down-kit.js";

const RATE = 48000;
/** The rates every room's decay is held at (ruling R46): a laptop's, the default, and a 96 kHz interface's. */
const RATES = [44100, 48000, 96000] as const;
type Rate = (typeof RATES)[number];
const RT: BandValues = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2];
const OPTIONS = { sampleRate: RATE, seed: 7, onsetSeconds: 0.03 } as const;
/** Seeds per room at each rate; each seed is read in both channels. */
const SEEDS: Readonly<Record<Rate, number>> = { 44100: 10, 48000: 10, 96000: 10 };
const MID_BANDS = [1, 2, 3, 4, 5] as const; // 250 Hz to 4 kHz
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
 * How far the reader's mean over 20 readings of synthetic noise may stray from the known time. Measured: within
 * 1.4 % in every octave of both alternations at 48 kHz, and the same readings at 96 kHz, where the frame and the
 * noise both double (the proof runs at 48 kHz only: at 96 kHz it costs 30 s). One reading alone scatters far more
 * where an octave holds few time-frequency cells (a 0.4 s decay reads -38..+36 % at 125 Hz, -15..+11 % at 500 Hz,
 * -9..+9 % at 2 kHz): the scatter of any measurement of noise, not a fault of the reader.
 */
const READER_MEAN_BOUND = 0.03;
/**
 * How far a band's mean over its realisations may stray from its target (ruling R52): from 250 Hz to 8 kHz the
 * measured bias (2.9 % at most) plus a margin, 5 %; the 125 Hz octave, read from about seven bins, within 10 %.
 * Seeds 1-10 put the 96 kHz Saloon's 125 Hz at +4.6 % (empty) and +5.0 % (laid); seeds 1-40 put it at +0.3 % and
 * +0.6 %, each within 1.4 % of standard error: sampling, not a bias.
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

/** Each band's T20 error (read ÷ target − 1), one per channel read. */
function errorsOf(decays: readonly (readonly BandDecay[])[], rt: BandValues): readonly (readonly number[])[] {
  return OCTAVE_BANDS_HZ.map((_, band) => decays.map((channel) => (channel[band]?.t20 ?? 0) / (rt[band] ?? 1) - 1));
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

describe("the octave reader (ruling R53)", () => {
  it.each([48000] as const)(
    "reads a known decay in every octave of synthetic noise at %i Hz, 0.4 s octaves between 3 s ones and 3 s between 0.4 s, its mean over 20 readings within 3 %",
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
        errorsOf(decays, times).forEach((each, band) => {
          expect(Math.abs(mean(each)), `${String(OCTAVE_BANDS_HZ[band])} Hz of ${times.join("/")}`).toBeLessThan(READER_MEAN_BOUND);
        });
      }
    },
    120_000,
  );
});

/**
 * The rooms whose 125 Hz and 250 Hz are held on their mean over the
 * realisations, not per seed; their per-seed bound is not met, their mean is.
 * - The Reception Room and the galleries (R22): their lowest two bands ring
 *   under about a second, so those octaves hold only a few dozen
 *   time-frequency cells over the T20 fit, and one noise realisation scatters
 *   there well beyond ±10 % (±20 % at 125 Hz), as any noise-based measurement
 *   would. See Task 4's report, round 2.
 * - The Robert Adam Room (R41): its T(f) steps steeply from 125 Hz up to
 *   250 Hz, and under that step one realisation's T20 at 250 Hz spreads like
 *   a single ISO 3382 measurement (Task 7's report, fix round 1).
 * - The Saloon (T-700): read from inside the octave, its 125 Hz (1.04 s
 *   empty, 0.99 s laid) holds about seven bins, and one realisation reads
 *   -28..+22 % (the reader's own scatter: a 1.8 s octave there reads -20..+19 %
 *   on synthetic noise of a known decay); its 250 Hz (1.37 s) sits on a step
 *   from 1.04 s to 2.12 s at 500 Hz and reads down to -14 % in one realisation
 *   at 96 kHz. Its means are within 2.1 % at 250 Hz and 5.7 % at 125 Hz.
 */
const LOW_BAND_SPREAD_ROOMS: readonly RoomSlug[] = ["reception-room", "north-gallery", "south-gallery", "robert-adam-room", "saloon"];

/**
 * The room states whose 500 Hz is held on its mean, not per seed (T-700): laid
 * for dinner, the Reception Room and the galleries ring 0.81-0.85 s there, and
 * read from the octave's inner bins one realisation strays to 11-12 % at 48 kHz,
 * the reader's own scatter for so short a decay in that octave (a 0.4 s decay
 * at 500 Hz reads -15..+11 % on synthetic noise, its mean within 1.5 %).
 */
const MID_SPREAD_STATES: readonly string[] = ["reception-room, laid for dinner", "north-gallery, laid for dinner", "south-gallery, laid for dinner"];

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

const measured = new Map<string, readonly (readonly number[])[]>();
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
      measured.set(key, errorsOf(decays, rt));
    }
  }, 600_000);

  const errors = (c: { readonly rt: BandValues; readonly rate: Rate }): readonly (readonly number[])[] => measured.get(keyOf(c.rt, c.rate)) ?? [];

  it.each(CASES)("holds 500 Hz to 4 kHz within ten percent for every seed and channel at $rate Hz (500 Hz on its mean where it rings under 0.9 s): $name", (c) => {
    for (const band of MID_BANDS) {
      if (band === 1 || (band === 2 && MID_SPREAD_STATES.includes(c.name))) continue;
      const each = errors(c)[band] ?? [];
      expect(each).toHaveLength(2 * SEEDS[c.rate]);
      for (const error of each) expect(Math.abs(error), `${String(OCTAVE_BANDS_HZ[band])} Hz`).toBeLessThan(0.1);
    }
  });

  it.each(CASES)("holds 8 kHz within twenty percent for every seed and channel at $rate Hz: $name", (c) => {
    const each = errors(c)[6] ?? [];
    expect(each).toHaveLength(2 * SEEDS[c.rate]);
    for (const error of each) expect(Math.abs(error)).toBeLessThan(0.2);
  });

  it.each(CASES.filter((c) => c.slug === null || !LOW_BAND_SPREAD_ROOMS.includes(c.slug)))(
    "holds 250 Hz within ten percent and 125 Hz within twenty for every seed and channel at $rate Hz: $name",
    (c) => {
      for (const error of errors(c)[1] ?? []) expect(Math.abs(error), "250 Hz").toBeLessThan(0.1);
      for (const error of errors(c)[0] ?? []) expect(Math.abs(error), "125 Hz").toBeLessThan(0.2);
    },
  );

  it.each(CASES)("holds each band's mean over its realisations on target, 250 Hz to 8 kHz within five percent and 125 Hz within ten, at $rate Hz: $name", (c) => {
    const each = errors(c);
    OCTAVE_BANDS_HZ.forEach((hz, band) => {
      expect(Math.abs(mean(each[band] ?? [Number.NaN])), `${String(hz)} Hz`).toBeLessThan(band === 0 ? MEAN_BOUND_125_HZ : MEAN_BOUND);
    });
  });

  it.each([48000, 96000] as const)(
    "holds alternating 0.4 s and 3 s octaves, both phases, each within ten percent on its mean over 20 readings at %i Hz: no octave's decay leaks into its neighbours' (ruling R53)",
    (rate) => {
      for (const times of ALTERNATIONS) {
        const decays: (readonly BandDecay[])[] = [];
        for (const seed of TEN_SEEDS) {
          const rendered = renderRoomTail(times, { ...OPTIONS, sampleRate: rate, seed });
          decays.push(...octaveDecays(rendered.left, rendered.right, rate));
        }
        errorsOf(decays, times).forEach((each, band) => {
          expect(Math.abs(mean(each)), `${String(OCTAVE_BANDS_HZ[band])} Hz of ${times.join("/")}`).toBeLessThan(0.1);
        });
      }
    },
    120_000,
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
    // The plain plaster box a space with no survey gets is such a room: it rings about 6.5 s.
    const box = roomState(roomAcousticsFor(null), []).rt;
    for (const rings of [[6, 7, 8, 8, 7, 6, 5] as const, box]) {
      expect(Math.max(...rings)).toBeGreaterThan(5 / 1.2);
      for (const [rate, bytes] of [[44100, 1_764_000], [48000, 1_920_000], [96000, 3_840_000]] as const) {
        const long = renderRoomTail(rings, { ...OPTIONS, sampleRate: rate });
        expect(long.left.length).toBe(5 * rate);
        expect(long.left.byteLength + long.right.byteLength).toBe(bytes);
        expect(Math.abs(energy(long.left) - 1)).toBeLessThanOrEqual(1e-3);
      }
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

describe("tailSlices", () => {
  it.each(RATES)("works in bounded steps at %i Hz and returns the same tail as renderRoomTail", (rate) => {
    const whole = rate === RATE ? tail : renderRoomTail(RT, { ...OPTIONS, sampleRate: rate });
    const slices = tailSlices(RT, { ...OPTIONS, sampleRate: rate });
    const steps: number[] = [];
    let step = slices.next();
    while (step.done !== true) {
      steps.push(step.value);
      step = slices.next();
    }
    const sliced: Stereo = step.value;
    expect(steps.length).toBeGreaterThanOrEqual(7);
    for (const samples of steps) {
      expect(samples).toBeGreaterThan(0);
      expect(samples).toBeLessThanOrEqual(TAIL_STEP_SAMPLES);
    }
    expect(TAIL_STEP_SAMPLES).toBe(8192);
    expect(sliced.sampleRate).toBe(rate);
    expect(sameSamples(sliced.left, whole.left)).toBe(true);
    expect(sameSamples(sliced.right, whole.right)).toBe(true);
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
