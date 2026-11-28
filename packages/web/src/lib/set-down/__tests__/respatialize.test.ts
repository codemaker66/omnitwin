import { describe, expect, it } from "vitest";
import { renderSetDown } from "../render.js";
import { AS_RENDERED_SIDE, panGains, playsAsRendered, respatializeSetDown } from "../respatialize.js";
import { inputFor } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// A variant moved to where its piece lands (T-700, rulings R104 and R107):
// un-panned on the engine's own law, which recovers a direct-only render
// exactly, and panned to the landing's angle; moved only when the pan differs.
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
    const moved = respatializeSetDown(left, -0.9, 1.1);
    expect(moved.left).toHaveLength(right.left.length);
    expect(relativeError(moved.left, right.left)).toBeLessThan(1e-6);
    expect(relativeError(moved.right, right.right)).toBeLessThan(1e-6);
    expect(moved.sampleRate).toBe(right.sampleRate);
  });

  it("moves only the pan: the samples the room's send takes keep their level (the dry gain is the landing's, R57)", () => {
    const mono = Float32Array.from({ length: 64 }, (_, n) => Math.sin(n / 3) * 0.2);
    const [fromLeft, fromRight] = panGains(-0.6);
    const render = { left: mono.map((s) => fromLeft * s), right: mono.map((s) => fromRight * s), sampleRate: 48000 };
    const moved = respatializeSetDown(render, -0.6, 0.7);
    const [toLeft, toRight] = panGains(0.7);
    for (let n = 0; n < mono.length; n++) {
      expect(moved.left[n] ?? Number.NaN).toBeCloseTo(toLeft * (mono[n] ?? 0), 6);
      expect(moved.right[n] ?? Number.NaN).toBeCloseTo(toRight * (mono[n] ?? 0), 6);
    }
    // The equal-power law keeps the samples' power at every angle.
    const power = (l: Float32Array, r: Float32Array): number => l.reduce((sum, s, n) => sum + s * s + (r[n] ?? 0) ** 2, 0);
    expect(power(moved.left, moved.right)).toBeCloseTo(power(render.left, render.right), 6);
  });

  it("leaves the render it moves as it was", () => {
    const render = { left: new Float32Array([0.1, 0.2]), right: new Float32Array([0.3, 0.4]), sampleRate: 48000 };
    respatializeSetDown(render, 0, 1);
    expect([...render.left]).toEqual([Math.fround(0.1), Math.fround(0.2)]);
    expect([...render.right]).toEqual([Math.fround(0.3), Math.fround(0.4)]);
  });
});

describe("playsAsRendered (R107): the pan, which is all a move changes", () => {
  const side = Math.sin(0.3);
  it.each([
    ["the same angle", 0.3, true],
    ["the mirror behind the ear, which pans alike", Math.PI - 0.3, true],
    ["a pan just inside sin 0.2 to the right", Math.asin(side + AS_RENDERED_SIDE - 1e-9), true],
    ["a pan past sin 0.2 to the right", Math.asin(side + AS_RENDERED_SIDE + 1e-6), false],
    ["a pan past sin 0.2 to the left", Math.asin(side - AS_RENDERED_SIDE - 1e-6), false],
    ["the far side", -0.3, false],
  ])("%s", (_name, heardAzimuthRad, asRendered) => {
    expect(playsAsRendered(0.3, heardAzimuthRad)).toBe(asRendered);
  });

  it.each([
    ["just behind on the left and just behind on the right, round the ear", -Math.PI + 0.05, Math.PI - 0.05],
    ["hard right, and 0.6 rad in front of it", Math.PI / 2, Math.PI / 2 - 0.6],
  ])("plays as rendered: %s", (_name, renderedAzimuthRad, heardAzimuthRad) => {
    expect(playsAsRendered(renderedAzimuthRad, heardAzimuthRad)).toBe(true);
  });

  it("allows a pan within sin 0.2", () => {
    expect(AS_RENDERED_SIDE).toBeCloseTo(Math.sin(0.2), 15);
  });
});
