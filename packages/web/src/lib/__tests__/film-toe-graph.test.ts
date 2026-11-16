import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { float, uniform } from "three/tsl";
import { DEFAULT_FILM_TOE, NEUTRAL_TOE, filmCurve, liftedPhotograph, photographLift, setFilmToe } from "../film-toe.js";
import { cameraEye, resetSceneGrade, sceneGrade, sceneOutput, vignetteShade } from "../scene-grade.js";
import { THREE_NEUTRAL_SOURCE, THREE_NEUTRAL_VERSION, khronosNeutral } from "./khronos-neutral.js";
import { nodeValue, type Fragment, type NodeValue } from "./node-values.js";

// ---------------------------------------------------------------------------
// The film toe's shader graph, run on numbers.
//
// film-toe.test.ts proves the arithmetic on plain-number twins. This file ties
// the twins to what actually ships: three's own Neutral (by its source text),
// the lift's own node graph (photographLift), and the pipeline's own grade and
// vignette (scene-grade.ts cameraEye, which the pipeline draws through). A
// three that changes its Neutral, an edit to the lift's nodes, or a stage added
// to the camera's eye that the lift does not undo, each fails a test here.
// ---------------------------------------------------------------------------

type Colour = [number, number, number];

/** A small seeded generator, so a failure names the same colours every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function triple(value: NodeValue): Colour {
  if (typeof value === "number" || value.length !== 3) throw new Error("the node did not give a colour");
  const [r, g, b] = value;
  if (r === undefined || g === undefined || b === undefined) throw new Error("the node did not give a colour");
  return [r, g, b];
}

function scalar(value: NodeValue): number {
  if (typeof value !== "number") throw new Error("the node did not give a number");
  return value;
}

const worstGap = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? Number.NaN))));
const times = (colour: Colour, factor: number): Colour => [colour[0] * factor, colour[1] * factor, colour[2] * factor];

// One graph of each kind, built once: every input is a uniform, set for each sample.
const colour = uniform(new Vector3());
const lifted = photographLift(colour);
// As the pipeline calls the camera's eye (PlannerRenderPipeline buildPlannerPipeline): its own balance and
// saturation, and the vignette's shade at 1 less the profile's strength, or none for a profile without one.
const edge = uniform(1);
const shade = vignetteShade(edge);
const eyeOnLifted = cameraEye(lifted, sceneGrade.whiteBalance, sceneGrade.saturation, shade);
const eyeOnBare = cameraEye(colour, sceneGrade.whiteBalance, sceneGrade.saturation, shade);
const eyeOnLiftedNoVignette = cameraEye(lifted, sceneGrade.whiteBalance, sceneGrade.saturation, null);
const eyeOnBareNoVignette = cameraEye(colour, sceneGrade.whiteBalance, sceneGrade.saturation, null);
// The shade the lift itself works with, from what the pipeline declares.
const declaredShade = vignetteShade(float(1).sub(sceneOutput.vignette));

interface Sample {
  readonly colour: Colour;
  readonly fragment: Fragment;
  readonly exposure: number;
  readonly gain: Colour;
  readonly saturation: number;
  readonly vignette: number;
}

const EXPOSURES = [1, 1.06, 1.3] as const;
const TOES = [0, 0.01, 0.02, 0.03, NEUTRAL_TOE] as const;

/** A colour weighted toward the darks, where the toe acts, somewhere on the screen, under a mood's grade. */
function sample(random: () => number): Sample {
  const level = random() ** 2 * 1.1;
  return {
    colour: [level * (0.4 + random()), level * (0.3 + random() * 0.9), level * (0.1 + random() * 0.8)],
    fragment: { screenUV: [random(), random()] },
    exposure: EXPOSURES[Math.floor(random() * EXPOSURES.length)] ?? 1,
    gain: [0.85 + random() * 0.3, 0.9 + random() * 0.2, 0.8 + random() * 0.4],
    saturation: 0.9 + random() * 0.2,
    vignette: random() < 0.25 ? 0 : 0.1 + random() * 0.25,
  };
}

/** Sets every uniform the graphs read, as the draw of a pipeline's frame (or a plain one) would declare them. */
function declare(given: Sample, toe: number, pipeline: boolean, main = true): void {
  colour.value.set(given.colour[0], given.colour[1], given.colour[2]);
  sceneGrade.whiteBalance.value.setRGB(given.gain[0], given.gain[1], given.gain[2]);
  sceneGrade.saturation.value = given.saturation;
  sceneOutput.main.value = main ? 1 : 0;
  sceneOutput.exposure.value = given.exposure;
  sceneOutput.graded.value = pipeline ? 1 : 0;
  sceneOutput.vignette.value = pipeline ? given.vignette : 0;
  edge.value = 1 - given.vignette;
  setFilmToe(toe);
}

afterEach(() => {
  resetSceneGrade();
  sceneOutput.main.value = 0;
  sceneOutput.exposure.value = 1;
  sceneOutput.graded.value = 0;
  sceneOutput.vignette.value = 0;
  setFilmToe(DEFAULT_FILM_TOE);
});

describe("three's own Neutral", () => {
  it("still reads as it did when the plain-number port was taken from it", () => {
    const root = path.join(path.dirname(createRequire(import.meta.url).resolve("three")), "..");
    const manifest: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? String(manifest.version) : "unknown";
    const source = readFileSync(path.join(root, "src/nodes/display/ToneMappingFunctions.js"), "utf8");
    const found = /export const neutralToneMapping = \/\*@__PURE__\*\/ Fn\( \( \[ color, exposure \] \) => \{([\s\S]*?)\n\} \)\.setLayout/.exec(source);
    const body = (found?.[1] ?? "neutralToneMapping was not found where it used to be").replace(/\s+/g, " ").trim();
    expect(body, `three ${version}'s Neutral no longer reads as at ${THREE_NEUTRAL_VERSION}: read khronosNeutral (khronos-neutral.ts) and lib/film-toe.ts against it again`).toBe(THREE_NEUTRAL_SOURCE);
  });
});

describe("the lift's own node graph", () => {
  it("is its plain-number twin: every toe, under a pipeline's grade and vignette and without one", () => {
    const random = seeded(20261115);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const given = sample(random);
      for (const toe of TOES) {
        for (const pipeline of [true, false]) {
          declare(given, toe, pipeline);
          const twin = liftedPhotograph(given.colour, {
            exposure: given.exposure,
            whiteBalance: pipeline ? given.gain : [1, 1, 1],
            saturation: pipeline ? given.saturation : 1,
            shade: scalar(nodeValue(declaredShade, given.fragment)),
          }, toe);
          worst = Math.max(worst, worstGap(triple(nodeValue(lifted, given.fragment)), twin));
        }
      }
    }
    expect(worst).toBeLessThan(1e-10);
  });

  it("through the pipeline's own eye and then Neutral, leaves what the curve with the asked toe would have left", () => {
    // The lifted photograph goes the way the frame does: the camera's eye as the pipeline calls it, the
    // exposure, three's Neutral. The bare photograph through the same eye and the curve with the asked toe
    // must be the same colour. A stage added to the eye that the lift does not undo breaks this.
    const random = seeded(7011);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const given = sample(random);
      const vignetted = given.vignette > 0;
      for (const toe of TOES) {
        declare(given, toe, true);
        const arrivingLifted = times(triple(nodeValue(vignetted ? eyeOnLifted : eyeOnLiftedNoVignette, given.fragment)), given.exposure);
        const arrivingBare = times(triple(nodeValue(vignetted ? eyeOnBare : eyeOnBareNoVignette, given.fragment)), given.exposure);
        worst = Math.max(worst, worstGap(khronosNeutral(arrivingLifted, 1), filmCurve(arrivingBare, 1, toe)));
      }
    }
    expect(worst).toBeLessThan(1e-10);
  });

  it("drawn plainly, with no pipeline after it, does the same through the exposure alone", () => {
    const random = seeded(4222);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const given = sample(random);
      for (const toe of TOES) {
        declare(given, toe, false);
        const shown = khronosNeutral(times(triple(nodeValue(lifted, given.fragment)), given.exposure), 1);
        worst = Math.max(worst, worstGap(shown, filmCurve(given.colour, given.exposure, toe)));
      }
    }
    expect(worst).toBeLessThan(1e-10);
  });

  it("adds nothing at Neutral's own toe, and nothing at any toe outside the view's own frame", () => {
    const random = seeded(99);
    let atNeutral = 0;
    let offFrame = 0;
    for (let i = 0; i < 400; i++) {
      const given = sample(random);
      declare(given, NEUTRAL_TOE, true);
      atNeutral = Math.max(atNeutral, worstGap(triple(nodeValue(lifted, given.fragment)), given.colour));
      // A reflection capture, a shadow map, the plan thumbnail: declared, but not the view's own frame.
      declare(given, 0, true, false);
      offFrame = Math.max(offFrame, worstGap(triple(nodeValue(lifted, given.fragment)), given.colour));
    }
    expect(atNeutral).toBeLessThan(1e-12);
    expect(offFrame).toBe(0);
  });
});
