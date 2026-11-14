import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FILM_TOE, NEUTRAL_TOE, arrivingColour, clampFilmToe, filmCurve, filmToe, filmToeFromSearch, filmToeOffset,
  liftedPhotograph, photographLiftFor, photographToeFor, setFilmToe, toeCurvatureFor, type OutputStage,
} from "../film-toe.js";
import { normalisedGain, sceneOutput, withMainDraw, withPipelineOutput } from "../scene-grade.js";
import { withNativeComposedFrame, withNativeRenderScope } from "../native-renderer.js";
import { Color, PerspectiveCamera, RenderTarget, Scene } from "three";

type Colour = [number, number, number];

/** Khronos PBR Neutral as three r186 writes it (nodes/display/ToneMappingFunctions.js), on plain numbers. */
function khronosNeutral(colour: readonly [number, number, number], exposure: number): Colour {
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

function worstGap(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

const EXPOSURES = [1, 1.06, 1.3] as const; // the hall's Daylight, Evening and Candlelight
const TOES = [0, 0.01, 0.02, 0.03, NEUTRAL_TOE] as const;

/** What follows a material where no pipeline draws: the exposure alone. */
function plainStage(exposure: number): OutputStage {
  return { exposure, whiteBalance: [1, 1, 1], saturation: 1, shade: 1 };
}

/** A stage as the planner's pipeline makes one: a normalised white balance, a mood's saturation, a vignette's shade. */
function pipelineStage(next: () => number): OutputStage {
  const gain = normalisedGain([0.8 + next() * 0.5, 0.9 + next() * 0.2, 0.75 + next() * 0.5], new Color());
  return {
    exposure: EXPOSURES[Math.floor(next() * EXPOSURES.length)] ?? 1,
    whiteBalance: [gain.r, gain.g, gain.b],
    saturation: 0.96 + next() * 0.08,
    shade: 0.78 + next() * 0.22,
  };
}

describe("Neutral with its toe as a number", () => {
  it("is Khronos PBR Neutral, value for value, at Neutral's toe", () => {
    const next = seeded(20261113);
    let worst = 0;
    for (let i = 0; i < 20000; i += 1) {
      // Scene colours from black to well past the shoulder, darks sampled densely.
      const colour: Colour = [next() ** 2 * 1.6, next() ** 2 * 1.6, next() ** 2 * 1.6];
      for (const exposure of EXPOSURES) worst = Math.max(worst, worstGap(filmCurve(colour, exposure, NEUTRAL_TOE), khronosNeutral(colour, exposure)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("gives a colour the grade pushed under zero Neutral's own answer at every toe", () => {
    // The planner's grade saturates in linear light (Evening: 1.02), which
    // takes a zero channel of a saturated colour under zero before the curve.
    const next = seeded(422);
    let worst = 0;
    let underZero = 0;
    for (let i = 0; i < 20000; i += 1) {
      const colour: Colour = [next() * 1.3 - 0.1, next() * 1.3 - 0.1, next() * 1.3 - 0.1];
      const least = Math.min(colour[0], colour[1], colour[2]);
      if (least < 0) underZero += 1;
      for (const exposure of EXPOSURES) {
        worst = Math.max(worst, worstGap(filmCurve(colour, exposure, NEUTRAL_TOE), khronosNeutral(colour, exposure)));
        if (least < 0) worst = Math.max(worst, worstGap(filmCurve(colour, exposure, 0), khronosNeutral(colour, exposure)));
      }
    }
    expect(underZero).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-12);
  });

  it("draws with Neutral's toe by default, so the hall's look does not move until a toe is chosen", () => {
    expect(DEFAULT_FILM_TOE).toBe(NEUTRAL_TOE);
  });

  it("leaves a colour under the shoulder exactly as it arrived at toe 0, in every mood", () => {
    const next = seeded(7);
    for (let i = 0; i < 20000; i += 1) {
      for (const exposure of EXPOSURES) {
        const limit = 0.759 / exposure;
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

  it("never brightens a colour in range as the toe deepens, and never takes more than the toe", () => {
    const next = seeded(99);
    for (let i = 0; i < 5000; i += 1) {
      const colour: Colour = [next() * 1.4, next() * 1.4, next() * 1.4];
      const shallow = filmCurve(colour, 1, 0);
      const middle = filmCurve(colour, 1, 0.02);
      const deep = filmCurve(colour, 1, NEUTRAL_TOE);
      // The shoulder mixes a highlight toward white by an amount that moves with
      // its peak, so only colours under it at every toe are compared channel by channel.
      if (Math.max(colour[0], colour[1], colour[2]) < 0.759) {
        for (const channel of [0, 1, 2] as const) {
          expect(middle[channel]).toBeLessThanOrEqual(shallow[channel] + 1e-12);
          expect(deep[channel]).toBeLessThanOrEqual(middle[channel] + 1e-12);
        }
      }
      const least = Math.min(colour[0], colour[1], colour[2]);
      expect(filmToeOffset(least, 0.02)).toBeLessThanOrEqual(0.02);
      expect(filmToeOffset(least, 0.02)).toBeGreaterThanOrEqual(0);
    }
  });

  it("meets its branches without a step at twice the toe and at zero", () => {
    for (const toe of [0.01, 0.02, NEUTRAL_TOE]) {
      expect(filmToeOffset(2 * toe - 1e-9, toe)).toBeCloseTo(toe, 9);
      expect(filmToeOffset(2 * toe, toe)).toBe(toe);
    }
    for (const toe of TOES) {
      expect(filmToeOffset(0, toe)).toBe(0);
      expect(Math.abs(filmToeOffset(-1e-9, toe))).toBeLessThan(2e-9);
      expect(Math.abs(filmToeOffset(1e-9, toe))).toBeLessThan(2e-9);
    }
    expect(filmToeOffset(0.5, 0)).toBe(0);
  });

  it("starts the shoulder where Neutral does, after the toe is taken, at every toe", () => {
    for (const toe of TOES) {
      const under = filmCurve([0.75 + toe, 0.5, 0.5], 1, toe);
      expect(under[0]).toBeCloseTo(0.75, 12);
      const over = filmCurve([0.9, 0.5, 0.5], 1, toe);
      expect(over[0]).toBeLessThan(0.9 - toe);
      expect(over[0]).toBeLessThan(1);
    }
  });

  it("bends with Neutral's own 6.25 at Neutral's toe, and stays finite with no toe", () => {
    expect(toeCurvatureFor(NEUTRAL_TOE)).toBe(6.25);
    expect(toeCurvatureFor(0.02)).toBeCloseTo(12.5, 12);
    expect(Number.isFinite(toeCurvatureFor(0))).toBe(true);
  });
});

describe("the light a photograph adds for the toe to take", () => {
  it("is nothing at Neutral's toe and the whole toe with none, above the toe's bend", () => {
    for (const least of [0, 0.001, 0.02, 0.04, 0.079, 0.08, 0.3, 0.9]) {
      expect(Math.abs(photographLiftFor(least, NEUTRAL_TOE))).toBeLessThan(1e-15);
    }
    for (const least of [0.04, 0.05, 0.3, 0.9]) expect(photographLiftFor(least, 0)).toBeCloseTo(NEUTRAL_TOE, 15);
    expect(photographLiftFor(0, 0)).toBe(0);
    expect(photographLiftFor(-0.01, 0)).toBe(0);
  });

  it("never darkens, never adds more than the toe, and adds more as the toe shallows", () => {
    const next = seeded(31);
    for (let i = 0; i < 20000; i += 1) {
      const least = next() ** 2 * 1.2;
      let previous = Number.POSITIVE_INFINITY;
      for (const toe of TOES) {
        const lift = photographLiftFor(least, toe);
        expect(lift).toBeGreaterThanOrEqual(-1e-15);
        expect(lift).toBeLessThanOrEqual(NEUTRAL_TOE + 1e-15);
        expect(lift).toBeLessThanOrEqual(previous + 1e-15);
        previous = lift;
      }
    }
  });

  it("makes Neutral leave what a curve with the asked toe would have left, with no pipeline", () => {
    const next = seeded(14);
    let worst = 0;
    for (let i = 0; i < 20000; i += 1) {
      const colour: Colour = [next() ** 2 * 1.4, next() ** 2 * 1.4, next() ** 2 * 1.4];
      for (const exposure of EXPOSURES) {
        const stage = plainStage(exposure);
        for (const toe of TOES) {
          const shown = khronosNeutral(arrivingColour(liftedPhotograph(colour, stage, toe), stage), 1);
          worst = Math.max(worst, worstGap(shown, filmCurve(colour, exposure, toe)));
        }
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("does so through the planner's grade and vignette too, in every mood", () => {
    const next = seeded(2027);
    let worst = 0;
    let underZero = 0;
    for (let i = 0; i < 20000; i += 1) {
      const stage = pipelineStage(next);
      const colour: Colour = [next() ** 2 * 1.2, next() ** 2 * 1.2, next() ** 2 * 1.2];
      const arriving = arrivingColour(colour, stage);
      if (Math.min(arriving[0], arriving[1], arriving[2]) < 0) underZero += 1;
      for (const toe of TOES) {
        const shown = khronosNeutral(arrivingColour(liftedPhotograph(colour, stage, toe), stage), 1);
        worst = Math.max(worst, worstGap(shown, filmCurve(arriving, 1, toe)));
      }
    }
    // The grade's saturation takes some of these under zero, where the lift is nothing and Neutral answers alone.
    expect(underZero).toBeGreaterThan(50);
    expect(worst).toBeLessThan(1e-12);
  });

  it("at no toe a photograph under the shoulder is on the screen what arrived at the curve", () => {
    const next = seeded(5);
    for (let i = 0; i < 5000; i += 1) {
      const stage = pipelineStage(next);
      const colour: Colour = [next() * 0.4, next() * 0.4, next() * 0.4];
      const arriving = arrivingColour(colour, stage);
      if (Math.min(arriving[0], arriving[1], arriving[2]) < 0 || Math.max(arriving[0], arriving[1], arriving[2]) >= 0.759) continue;
      const shown = khronosNeutral(arrivingColour(liftedPhotograph(colour, stage, 0), stage), 1);
      expect(worstGap(shown, arriving)).toBeLessThan(1e-12);
    }
  });
});

describe("the toe a view asks for", () => {
  afterEach(() => { setFilmToe(DEFAULT_FILM_TOE); });

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

  it("leaves the photographs' materials as they were for a view that asks for nothing", () => {
    expect(photographToeFor("")).toBeNull();
    expect(photographToeFor("?sky=1")).toBeNull();
    expect(photographToeFor("?toe=dark")).toBeNull();
    expect(photographToeFor("?toe=0")).toBe(0);
    expect(photographToeFor("?toe=0.02")).toBe(0.02);
    // Asked for by name, even Neutral's own toe builds the lift, so a comparison can step through every toe on one page.
    expect(photographToeFor("?toe=0.04")).toBe(NEUTRAL_TOE);
  });

  it("falls back to the default for a toe that is not a number", () => {
    expect(clampFilmToe(Number.NaN)).toBe(DEFAULT_FILM_TOE);
    expect(clampFilmToe(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FILM_TOE);
    expect(clampFilmToe(0.03)).toBe(0.03);
  });

  it("holds the toe the shaders read to the curve's range", () => {
    setFilmToe(0.02);
    expect(filmToe.value).toBe(0.02);
    setFilmToe(1);
    expect(filmToe.value).toBe(NEUTRAL_TOE);
    setFilmToe(-3);
    expect(filmToe.value).toBe(0);
  });
});

describe("what a material is told follows its draw", () => {
  const resting = { main: 0, exposure: 1, graded: 0, vignette: 0 };
  const read = (): typeof resting => ({
    main: sceneOutput.main.value, exposure: sceneOutput.exposure.value, graded: sceneOutput.graded.value, vignette: sceneOutput.vignette.value,
  });

  it("rests at a draw that adds nothing: not the view's frame, no grade, no vignette", () => {
    expect(read()).toEqual(resting);
  });

  it("declares the view's own frame and its exposure for the length of the draw, and restores them if it throws", () => {
    let during: typeof resting | null = null;
    withMainDraw(true, 1.3, () => { during = read(); });
    expect(during).toEqual({ main: 1, exposure: 1.3, graded: 0, vignette: 0 });
    expect(read()).toEqual(resting);
    expect(() => { withMainDraw(true, 1.06, () => { throw new Error("lost"); }); }).toThrow("lost");
    expect(read()).toEqual(resting);
  });

  it("declares the pipeline's grade and vignette for the length of its frame, and restores them if it throws", () => {
    let during: typeof resting | null = null;
    withPipelineOutput(0.22, () => { during = read(); });
    expect(during).toEqual({ main: 0, exposure: 1, graded: 1, vignette: 0.22 });
    expect(read()).toEqual(resting);
    expect(() => { withPipelineOutput(0.22, () => { throw new Error("lost"); }); }).toThrow("lost");
    expect(read()).toEqual(resting);
  });

  it("calls a draw to the canvas the view's frame, and a draw into a target (a reflection capture) not", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    let target: RenderTarget | null = null;
    const renderer = { getRenderTarget: () => target, toneMappingExposure: 1.06 };
    const capture = new RenderTarget(1, 1);
    const seen: number[] = [];
    withNativeRenderScope(renderer, scene, camera, () => { seen.push(sceneOutput.main.value, sceneOutput.exposure.value); });
    target = capture;
    withNativeRenderScope(renderer, scene, camera, () => { seen.push(sceneOutput.main.value); });
    expect(seen).toEqual([1, 1.06, 0]);
    expect(read()).toEqual(resting);
    capture.dispose();
  });

  it("inside a composed frame calls the scene's own pass the view's frame, and the passes around it not", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const quad = new Scene();
    const renderer = { getRenderTarget: (): RenderTarget | null => null, toneMappingExposure: 1.3 };
    const seen: Record<string, number> = {};
    withNativeComposedFrame(renderer, scene, camera, () => {
      // The pipeline draws the canvas with a quad; the scene and its shadow map are drawn nested in it.
      withNativeRenderScope(renderer, quad, camera, () => {
        withNativeRenderScope(renderer, scene, camera, () => {
          seen["scene pass"] = sceneOutput.main.value;
          withNativeRenderScope(renderer, scene, new PerspectiveCamera(), () => { seen["shadow map"] = sceneOutput.main.value; });
          seen["scene pass after"] = sceneOutput.main.value;
        });
        withNativeRenderScope(renderer, new Scene(), camera, () => { seen["post pass"] = sceneOutput.main.value; });
      });
    });
    expect(seen).toEqual({ "scene pass": 1, "shadow map": 0, "scene pass after": 1, "post pass": 0 });
    expect(read()).toEqual(resting);
  });
});
