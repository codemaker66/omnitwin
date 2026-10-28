import { describe, expect, it } from "vitest";
import { octaveBandpass, schroederT20 } from "../analysis.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../bands.js";
import { contentsAbsorption, reverberationTimes } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, UNCALIBRATED, type RoomAcoustics } from "../rooms.js";
import { TAIL_STEP_SAMPLES, renderRoomTail, tailOnsetSeconds, tailSlices, type Stereo } from "../tail.js";
import { bandLeakage, modelledT20, synthesisTimes } from "../tail-correction.js";

const RATE = 48000;
const RT: BandValues = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2];
const OPTIONS = { sampleRate: RATE, seed: 7, onsetSeconds: 0.03 } as const;

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

/** Each band's T20 error (measured ÷ target − 1) for seeds 1–10, both channels. */
const seedErrors: readonly (readonly number[])[] = (() => {
  const errors: number[][] = OCTAVE_BANDS_HZ.map(() => []);
  for (let seed = 1; seed <= 10; seed += 1) {
    const rendered = renderRoomTail(RT, { ...OPTIONS, seed });
    for (const channel of [rendered.left, rendered.right]) {
      OCTAVE_BANDS_HZ.forEach((hz, band) => {
        const filtered = octaveBandpass(channel, hz, RATE);
        // A silent band would read 0 and hide a fault in the decay.
        expect(energy(filtered)).toBeGreaterThan(1e-4);
        errors[band]?.push(schroederT20(filtered, RATE) / (RT[band] ?? 1) - 1);
      });
    }
  }
  return errors;
})();

describe("renderRoomTail", () => {
  it.each(OCTAVE_BANDS_HZ.slice(1, 6).map((hz, k) => ({ hz, band: k + 1 })))(
    "rings for its target time at $hz Hz within ten percent, for 10 seeds in both channels",
    ({ band }) => {
      const errors = seedErrors[band] ?? [];
      expect(errors).toHaveLength(20);
      for (const error of errors) {
        expect(error).toBeGreaterThan(-0.1);
        expect(error).toBeLessThan(0.1);
      }
    },
  );

  it("rings for its target time at 8 kHz within 15 % on average over the 10 seeds", () => {
    const errors = seedErrors[6] ?? [];
    expect(errors).toHaveLength(20);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });

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

  it("is no longer than 1.2 x its longest time after the onset, and within 2 MB", () => {
    expect(tail.sampleRate).toBe(RATE);
    expect(tail.left.length).toBe(tail.right.length);
    expect(tail.left.length / RATE).toBeLessThanOrEqual(1.2 * Math.max(...RT) + OPTIONS.onsetSeconds);
    expect(tail.left.byteLength + tail.right.byteLength).toBeLessThanOrEqual(2_000_000);
  });

  it("keeps within 2 MB however long the room rings", () => {
    const long = renderRoomTail([6, 7, 8, 8, 7, 6, 5], OPTIONS);
    expect(long.left.byteLength + long.right.byteLength).toBeLessThanOrEqual(2_000_000);
    expect(Math.abs(energy(long.left) - 1)).toBeLessThanOrEqual(1e-3);
  });

  it("renders the same samples for the same seed and different ones for another", () => {
    const short: BandValues = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
    const first = renderRoomTail(short, OPTIONS);
    const same = renderRoomTail(short, OPTIONS);
    const other = renderRoomTail(short, { ...OPTIONS, seed: 8 });
    expect(Array.from(same.left)).toEqual(Array.from(first.left));
    expect(Array.from(other.left)).not.toEqual(Array.from(first.left));
  });

  it("stays finite for a zero or invalid time", () => {
    const odd = renderRoomTail([0, Number.NaN, -1, 1, 1, 1, 1], OPTIONS);
    expect(odd.left.every((s) => Number.isFinite(s))).toBe(true);
    expect(odd.right.every((s) => Number.isFinite(s))).toBe(true);
  });
});

describe("tailSlices", () => {
  it("works in bounded steps and returns the same tail as renderRoomTail", () => {
    const slices = tailSlices(RT, { ...OPTIONS });
    const steps: number[] = [];
    let step = slices.next();
    while (step.done !== true) {
      steps.push(step.value);
      step = slices.next();
    }
    const sliced: Stereo = step.value;
    expect(steps.length).toBeGreaterThanOrEqual(7);
    // The first step only corrects the band times; every other one does samples.
    expect(steps[0]).toBe(0);
    for (const samples of steps.slice(1)) {
      expect(samples).toBeGreaterThan(0);
      expect(samples).toBeLessThanOrEqual(TAIL_STEP_SAMPLES);
    }
    expect(TAIL_STEP_SAMPLES).toBe(8192);
    // Each band's noise runs to 1.25 x its own synthesis time after the onset
    // (or the buffer's end), in both channels; then each channel is measured
    // and scaled.
    const start = Math.ceil(OPTIONS.onsetSeconds * RATE);
    const bandSamples = synthesisTimes(RT, RATE).reduce(
      (sum, t) => sum + Math.min(tail.left.length - start, Math.ceil(1.25 * t * RATE)),
      0,
    );
    expect(steps.reduce((a, b) => a + b, 0)).toBe(2 * bandSamples + 4 * tail.left.length);
    expect(sliced.sampleRate).toBe(RATE);
    expect(sliced.left.length).toBe(tail.left.length);
    let mismatches = 0;
    for (let i = 0; i < tail.left.length; i += 1) {
      if (sliced.left[i] !== tail.left[i] || sliced.right[i] !== tail.right[i]) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});

describe("synthesisTimes", () => {
  it("leaves a room that rings the same in every band as it is", () => {
    const flat: BandValues = [2, 2, 2, 2, 2, 2, 2];
    for (const time of synthesisTimes(flat, RATE)) expect(time).toBeCloseTo(2, 2);
  });

  it("shortens a band whose neighbour rings longer, within 0.8-1.25 of its target", () => {
    const times = synthesisTimes(RT, RATE);
    // 4 kHz (2.0 s) sits beside 2 kHz (2.7 s), so it is made shorter to measure 2.0 s.
    expect(times[5]).toBeLessThan(RT[5]);
    for (const acoustics of Object.values(ROOM_ACOUSTICS)) {
      const target = reverberationTimes(acoustics, contentsAbsorption([]));
      synthesisTimes(target, RATE).forEach((time, band) => {
        expect(time).toBeGreaterThanOrEqual(0.8 * (target[band] ?? 0) - 1e-12);
        expect(time).toBeLessThanOrEqual(1.25 * (target[band] ?? 0) + 1e-12);
      });
    }
  });

  it("models each band's T20 from the leak between bands", () => {
    const { weights } = bandLeakage(RATE);
    // Measured offline: the uncorrected tail reads +6 % at 4 kHz and +21 % at 8 kHz.
    expect(modelledT20(weights[5] ?? [], RT) / RT[5]).toBeGreaterThan(1.04);
    expect(modelledT20(weights[6] ?? [], RT) / RT[6]).toBeGreaterThan(1.15);
    expect(modelledT20(weights[3] ?? [], [2, 2, 2, 2, 2, 2, 2])).toBeCloseTo(2, 2);
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
