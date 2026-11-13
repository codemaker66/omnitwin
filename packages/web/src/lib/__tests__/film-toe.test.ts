import { describe, expect, it } from "vitest";
import { CustomToneMapping } from "three";
import {
  DEFAULT_FILM_TOE, NEUTRAL_TOE, clampFilmToe, filmCurve, filmToe, filmToeFromSearch, filmToeOffset,
  photographToneMapping, registerPhotographToneMapping, setFilmToe,
} from "../film-toe.js";

type Colour = [number, number, number];

/** A stand-in for a renderer's node library: one curve per tone-mapping constant, first one kept. */
function fakeNativeRenderer(): { readonly isWebGPURenderer: true; readonly library: { addToneMapping(curve: unknown, type: number): void; getToneMappingFunction(type: number): unknown } } {
  const curves = new Map<number, unknown>();
  return {
    isWebGPURenderer: true,
    library: {
      addToneMapping(curve: unknown, type: number): void { if (!curves.has(type)) curves.set(type, curve); },
      getToneMappingFunction(type: number): unknown { return curves.get(type) ?? null; },
    },
  };
}

/** Khronos PBR Neutral as three r186 writes it (nodes/display/ToneMappingFunctions.js), on plain numbers. */
function khronosNeutral(colour: Colour, exposure: number): Colour {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  let [r, g, b] = [colour[0] * exposure, colour[1] * exposure, colour[2] * exposure];
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset; g -= offset; b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < startCompression) return [r, g, b];
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  const mixBy = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [r * scale * (1 - mixBy) + newPeak * mixBy, g * scale * (1 - mixBy) + newPeak * mixBy, b * scale * (1 - mixBy) + newPeak * mixBy];
}

/** A small seeded generator, so a failure names the same colours every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const EXPOSURES = [1, 1.06, 1.3] as const; // the hall's Daylight, Evening and Candlelight

describe("the photographed room's film toe", () => {
  it("is Khronos PBR Neutral, value for value, at Neutral's toe", () => {
    const next = seeded(20261113);
    let worst = 0;
    for (let i = 0; i < 20000; i += 1) {
      // Scene colours from black to well past the shoulder, darks sampled densely.
      const colour: Colour = [next() ** 2 * 1.6, next() ** 2 * 1.6, next() ** 2 * 1.6];
      for (const exposure of EXPOSURES) {
        const ours = filmCurve(colour, exposure, NEUTRAL_TOE);
        const theirs = khronosNeutral(colour, exposure);
        worst = Math.max(worst, Math.abs(ours[0] - theirs[0]), Math.abs(ours[1] - theirs[1]), Math.abs(ours[2] - theirs[2]));
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("draws with Neutral's toe by default, so the hall's look does not move until a toe is chosen", () => {
    expect(DEFAULT_FILM_TOE).toBe(NEUTRAL_TOE);
  });

  it("leaves a colour under the shoulder exactly as it arrived at toe 0, in every mood", () => {
    const next = seeded(7);
    for (let i = 0; i < 20000; i += 1) {
      for (const exposure of EXPOSURES) {
        const limit = 0.799 / exposure;
        const colour: Colour = [next() * limit, next() * limit, next() * limit];
        const out = filmCurve(colour, exposure, 0);
        expect(out[0]).toBe(colour[0] * exposure);
        expect(out[1]).toBe(colour[1] * exposure);
        expect(out[2]).toBe(colour[2] * exposure);
      }
    }
  });

  it("gives back the darks Neutral took: linear 0.05 leaves as 0.05 at toe 0 and about 0.016 at Neutral's", () => {
    expect(filmCurve([0.05, 0.05, 0.05], 1, 0)[0]).toBe(0.05);
    expect(filmCurve([0.05, 0.05, 0.05], 1, NEUTRAL_TOE)[0]).toBeCloseTo(0.015625, 12);
  });

  it("never brightens a colour under every toe's shoulder as the toe deepens, and never takes more than the toe", () => {
    // In the shoulder Neutral mixes a highlight toward white by an amount that
    // moves with the toe, so a dark channel of a bright colour may rise there.
    // The shoulder starts at 0.8 less the toe after the toe is taken, and a
    // saturated colour gives up almost none of it, so a peak under 0.76 is the
    // range every toe up to Neutral's leaves to the toe alone.
    const next = seeded(99);
    for (let i = 0; i < 5000; i += 1) {
      const colour: Colour = [next() * 0.759, next() * 0.759, next() * 0.759];
      const shallow = filmCurve(colour, 1, 0);
      const middle = filmCurve(colour, 1, 0.02);
      const deep = filmCurve(colour, 1, NEUTRAL_TOE);
      for (const channel of [0, 1, 2] as const) {
        expect(middle[channel]).toBeLessThanOrEqual(shallow[channel] + 1e-12);
        expect(deep[channel]).toBeLessThanOrEqual(middle[channel] + 1e-12);
      }
      const least = Math.min(colour[0], colour[1], colour[2]);
      expect(filmToeOffset(least, 0.02)).toBeLessThanOrEqual(0.02);
      expect(filmToeOffset(least, 0.02)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never brightens a grey as the toe deepens, on either side of the shoulder", () => {
    for (let grey = 0; grey <= 1.6; grey += 0.01) {
      const shallow = filmCurve([grey, grey, grey], 1, 0)[0];
      const middle = filmCurve([grey, grey, grey], 1, 0.02)[0];
      const deep = filmCurve([grey, grey, grey], 1, NEUTRAL_TOE)[0];
      expect(middle).toBeLessThanOrEqual(shallow + 1e-12);
      expect(deep).toBeLessThanOrEqual(middle + 1e-12);
    }
  });

  it("meets its two branches without a step where the least channel is twice the toe", () => {
    for (const toe of [0.01, 0.02, NEUTRAL_TOE]) {
      expect(filmToeOffset(2 * toe - 1e-9, toe)).toBeCloseTo(toe, 9);
      expect(filmToeOffset(2 * toe, toe)).toBe(toe);
    }
    expect(filmToeOffset(0.5, 0)).toBe(0);
    expect(filmToeOffset(0, 0)).toBe(0);
  });

  it("lets a saturated colour into the shoulder below a peak of 0.8 at Neutral's toe, and never at toe 0", () => {
    const saturated: Colour = [0.79, 0.3, 0.0004];
    expect(filmCurve(saturated, 1, 0)).toEqual(saturated);
    const atNeutral = filmCurve(saturated, 1, NEUTRAL_TOE);
    expect(atNeutral[0]).toBeLessThan(0.79 - filmToeOffset(0.0004, NEUTRAL_TOE));
  });

  it("starts the shoulder at an incoming peak of 0.8 for a colour whose least channel clears twice the toe", () => {
    for (const toe of [0, 0.02, NEUTRAL_TOE]) {
      const under = filmCurve([0.79, 0.5, 0.5], 1, toe);
      expect(under[0]).toBeCloseTo(0.79 - filmToeOffset(0.5, toe), 12);
      const over = filmCurve([0.9, 0.5, 0.5], 1, toe);
      expect(over[0]).toBeLessThan(0.9 - filmToeOffset(0.5, toe));
      expect(over[0]).toBeLessThan(1);
    }
  });

  it("reads a toe from a page address and holds it to the curve's range", () => {
    expect(filmToeFromSearch("?toe=0.02")).toBe(0.02);
    expect(filmToeFromSearch("?sky=1&toe=0")).toBe(0);
    expect(filmToeFromSearch("?toe=9")).toBe(NEUTRAL_TOE);
    expect(filmToeFromSearch("?toe=-1")).toBe(0);
    expect(filmToeFromSearch("?toe=dark")).toBeNull();
    expect(filmToeFromSearch("?toe=")).toBeNull();
    expect(filmToeFromSearch("?sky=1")).toBeNull();
    expect(filmToeFromSearch("")).toBeNull();
  });

  it("falls back to the default for a toe that is not a number", () => {
    expect(clampFilmToe(Number.NaN)).toBe(DEFAULT_FILM_TOE);
    expect(clampFilmToe(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FILM_TOE);
    expect(clampFilmToe(0.03)).toBe(0.03);
  });

  it("holds the toe the shader reads to the curve's range", () => {
    setFilmToe(0.02);
    expect(filmToe.value).toBe(0.02);
    setFilmToe(1);
    expect(filmToe.value).toBe(NEUTRAL_TOE);
    setFilmToe(DEFAULT_FILM_TOE);
    expect(filmToe.value).toBe(DEFAULT_FILM_TOE);
  });

  it("registers the curve as a renderer's custom tone mapping, and again without replacing it", () => {
    const renderer = fakeNativeRenderer();
    expect(registerPhotographToneMapping(renderer)).toBe(true);
    expect(renderer.library.getToneMappingFunction(CustomToneMapping)).toBe(photographToneMapping);
    expect(registerPhotographToneMapping(renderer)).toBe(true);
  });

  it("leaves a renderer with no node library on its own curve", () => {
    expect(registerPhotographToneMapping({})).toBe(false);
    expect(registerPhotographToneMapping({ isWebGPURenderer: false })).toBe(false);
  });

  it("does not claim a custom tone mapping that another curve already holds", () => {
    const renderer = fakeNativeRenderer();
    renderer.library.addToneMapping(() => null, CustomToneMapping);
    expect(registerPhotographToneMapping(renderer)).toBe(false);
  });
});
