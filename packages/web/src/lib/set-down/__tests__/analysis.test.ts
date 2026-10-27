import { describe, expect, it } from "vitest";
import { seededRandom } from "../../planner-sound-render.js";
import { OCTAVE_BANDS_HZ, bandMap, type BandValues } from "../bands.js";
import {
  bandEnergy,
  kWeightedLoudness,
  octaveBandpass,
  onsetTimesMs,
  schroederT20,
  spectralCentroidHz,
} from "../analysis.js";

const RATE = 48000;

function sine(hz: number, seconds: number, amplitude = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

function energy(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return sum;
}

describe("bands", () => {
  it("lists the seven octave bands from 125 Hz to 8 kHz", () => {
    expect([...OCTAVE_BANDS_HZ]).toEqual([125, 250, 500, 1000, 2000, 4000, 8000]);
  });

  it("maps a value in each band, passing the band index", () => {
    const values: BandValues = [1, 2, 3, 4, 5, 6, 7];
    expect(bandMap(values, (v, i) => v * 10 + i)).toEqual([10, 21, 32, 43, 54, 65, 76]);
  });
});

describe("schroederT20", () => {
  it("reads 1.5 s from seeded noise that falls 60 dB in 1.5 s", () => {
    const random = seededRandom(7);
    const samples = new Float32Array(Math.round(2.5 * RATE));
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = (random() * 2 - 1) * Math.exp((-6.91 * i) / RATE / 1.5);
    }
    const t = schroederT20(samples, RATE);
    expect(Math.abs(t - 1.5) / 1.5).toBeLessThan(0.03);
  });

  it("returns 0 for silence instead of NaN", () => {
    expect(schroederT20(new Float32Array(4800), RATE)).toBe(0);
  });
});

describe("octaveBandpass", () => {
  it("keeps over 90 % of a 1 kHz sine and under 3 % of a 125 Hz sine at the 1 kHz band", () => {
    const tone = sine(1000, 0.5);
    const kept = energy(octaveBandpass(tone, 1000, RATE)) / energy(tone);
    expect(kept).toBeGreaterThan(0.9);
    const low = sine(125, 0.5);
    const leaked = energy(octaveBandpass(low, 1000, RATE)) / energy(low);
    expect(leaked).toBeLessThan(0.03);
  });

  it("leaves its input untouched", () => {
    const tone = sine(1000, 0.05);
    const copy = Float32Array.from(tone);
    octaveBandpass(tone, 1000, RATE);
    expect(tone).toEqual(copy);
  });
});

describe("bandEnergy", () => {
  it("finds a sine's whole energy in the band that holds it and none elsewhere", () => {
    const tone = sine(1000, 0.25);
    const total = energy(tone);
    expect(bandEnergy(tone, RATE, 700, 1400) / total).toBeGreaterThan(0.99);
    expect(bandEnergy(tone, RATE, 2000, 4000) / total).toBeLessThan(0.001);
  });
});

describe("spectralCentroidHz", () => {
  it("puts a 2 kHz sine's centroid at 2000 Hz", () => {
    expect(spectralCentroidHz(sine(2000, 0.25), RATE)).toBeCloseTo(2000, -1);
    expect(Math.abs(spectralCentroidHz(sine(2000, 0.25), RATE) - 2000)).toBeLessThan(40);
  });

  it("is 0 for silence", () => {
    expect(spectralCentroidHz(new Float32Array(1024), RATE)).toBe(0);
  });
});

describe("onsetTimesMs", () => {
  it("finds two clicks 20 ms apart", () => {
    const samples = new Float32Array(Math.round(0.1 * RATE));
    for (const ms of [0, 20]) {
      const start = Math.round((ms / 1000) * RATE);
      samples[start] = 0.8;
      samples[start + 1] = -0.5;
      samples[start + 2] = 0.2;
    }
    const onsets = onsetTimesMs(samples, RATE);
    expect(onsets).toHaveLength(2);
    expect(Math.abs((onsets[0] ?? 99) - 0)).toBeLessThanOrEqual(1);
    expect(Math.abs((onsets[1] ?? 99) - 20)).toBeLessThanOrEqual(1);
  });

  it("finds nothing in silence", () => {
    expect(onsetTimesMs(new Float32Array(4800), RATE)).toEqual([]);
  });
});

describe("kWeightedLoudness", () => {
  it("reads a 1 kHz sine at -20 dBFS in both channels as -20 dB, give or take 1", () => {
    const tone = sine(1000, 1, 0.1);
    const level = kWeightedLoudness(tone, tone, RATE);
    expect(Math.abs(level - -20)).toBeLessThan(1);
  });

  it("reads the same sine at 100 Hz at least 0.5 dB lower", () => {
    const high = kWeightedLoudness(sine(1000, 1, 0.1), sine(1000, 1, 0.1), RATE);
    const low = kWeightedLoudness(sine(100, 1, 0.1), sine(100, 1, 0.1), RATE);
    expect(high - low).toBeGreaterThanOrEqual(0.5);
  });

  it("ignores samples below -70 dB, so a long quiet tail does not dilute a short sound", () => {
    const burst = sine(1000, 0.2, 0.1);
    const padded = new Float32Array(RATE * 2);
    padded.set(burst);
    expect(Math.abs(kWeightedLoudness(padded, padded, RATE) - kWeightedLoudness(burst, burst, RATE))).toBeLessThan(0.5);
  });
});
