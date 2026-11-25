import { describe, expect, it } from "vitest";
import { renderSetDown } from "../render.js";
import { AS_RENDERED_AZIMUTH_RAD, AS_RENDERED_GAIN_DB, panGains, playsAsRendered, respatializeSetDown } from "../respatialize.js";
import { inputFor } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// A variant moved to where its piece lands (T-700, ruling R104): un-panned on
// the engine's own law, which recovers a direct-only render exactly, and
// panned to the landing's angle, at the landing's level.
// ---------------------------------------------------------------------------

/** The largest difference between two channels, against the larger's peak. */
function relativeError(a: Float32Array, b: Float32Array): number {
  let peak = 0;
  let worst = 0;
  for (let n = 0; n < Math.max(a.length, b.length); n++) {
    peak = Math.max(peak, Math.abs(a[n] ?? 0), Math.abs(b[n] ?? 0));
    worst = Math.max(worst, Math.abs((a[n] ?? 0) - (b[n] ?? 0)));
  }
  return worst / peak;
}

describe("respatializeSetDown (R104)", () => {
  it("recovers a direct-only render exactly and pans it to the landing's side", () => {
    const left = renderSetDown(inputFor("chiavari-chair", "oak-parquet", { azimuthRad: -0.9, seed: 4 }));
    const right = renderSetDown(inputFor("chiavari-chair", "oak-parquet", { azimuthRad: 1.1, seed: 4 }));
    const moved = respatializeSetDown(left, { gain: 0.5, azimuthRad: -0.9 }, { gain: 0.5, azimuthRad: 1.1 });
    expect(moved.left).toHaveLength(right.left.length);
    expect(relativeError(moved.left, right.left)).toBeLessThan(1e-6);
    expect(relativeError(moved.right, right.right)).toBeLessThan(1e-6);
    expect(moved.sampleRate).toBe(right.sampleRate);
  });

  it("plays the moved copy at the landing's level: its dry gain, so the samples the room's send takes keep their level", () => {
    const mono = Float32Array.from({ length: 64 }, (_, n) => Math.sin(n / 3) * 0.2);
    const [fromLeft, fromRight] = panGains(-0.6);
    const render = { left: mono.map((s) => fromLeft * s), right: mono.map((s) => fromRight * s), sampleRate: 48000 };
    const moved = respatializeSetDown(render, { gain: 0.8, azimuthRad: -0.6 }, { gain: 0.3, azimuthRad: 0.7 });
    const [toLeft, toRight] = panGains(0.7);
    expect(moved.directGain).toBe(0.3);
    for (let n = 0; n < mono.length; n++) {
      // Heard: the dry gain times the moved samples is a direct-only render at the landing's angle and gain.
      expect(moved.directGain * (moved.left[n] ?? 0)).toBeCloseTo(0.3 * toLeft * (mono[n] ?? 0), 6);
      expect(moved.directGain * (moved.right[n] ?? 0)).toBeCloseTo(0.3 * toRight * (mono[n] ?? 0), 6);
    }
    // The equal-power law keeps the samples' power at every angle.
    const power = (l: Float32Array, r: Float32Array): number => l.reduce((sum, s, n) => sum + s * s + (r[n] ?? 0) ** 2, 0);
    expect(power(moved.left, moved.right)).toBeCloseTo(power(render.left, render.right), 6);
  });

  it("leaves the render it moves as it was", () => {
    const render = { left: new Float32Array([0.1, 0.2]), right: new Float32Array([0.3, 0.4]), sampleRate: 48000 };
    respatializeSetDown(render, { gain: 1, azimuthRad: 0 }, { gain: 0.5, azimuthRad: 1 });
    expect([...render.left]).toEqual([Math.fround(0.1), Math.fround(0.2)]);
    expect([...render.right]).toEqual([Math.fround(0.3), Math.fround(0.4)]);
  });
});

describe("playsAsRendered (R104)", () => {
  const at = { gain: 0.5, azimuthRad: 0.3 };
  it.each([
    ["the same direct sound", 0.3, 0.5, true],
    ["just inside 0.2 rad", 0.3 + AS_RENDERED_AZIMUTH_RAD - 1e-9, 0.5, true],
    ["past 0.2 rad", 0.3 + AS_RENDERED_AZIMUTH_RAD + 1e-6, 0.5, false],
    ["past 0.2 rad the other way", 0.3 - AS_RENDERED_AZIMUTH_RAD - 1e-6, 0.5, false],
    ["just inside 1.5 dB louder", 0.3, 0.5 * 10 ** ((AS_RENDERED_GAIN_DB - 0.01) / 20), true],
    ["past 1.5 dB louder", 0.3, 0.5 * 10 ** ((AS_RENDERED_GAIN_DB + 0.01) / 20), false],
    ["past 1.5 dB softer", 0.3, 0.5 * 10 ** (-(AS_RENDERED_GAIN_DB + 0.01) / 20), false],
  ])("%s", (_name, azimuthRad, gain, asRendered) => {
    expect(playsAsRendered(at, { gain, azimuthRad })).toBe(asRendered);
  });

  it("measures the angle round the ear: just behind on the left and just behind on the right are 0.1 rad apart", () => {
    expect(playsAsRendered({ gain: 0.5, azimuthRad: Math.PI - 0.05 }, { gain: 0.5, azimuthRad: -Math.PI + 0.05 })).toBe(true);
    expect(playsAsRendered({ gain: 0.5, azimuthRad: Math.PI - 0.15 }, { gain: 0.5, azimuthRad: -Math.PI + 0.15 })).toBe(false);
  });
});
