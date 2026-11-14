// ---------------------------------------------------------------------------
// Film toe — the light Neutral's toe takes out of a photograph, given back
//
// The Grand Hall is drawn from the scan's own photographs, which are already
// display-referred. Khronos PBR Neutral, the curve the hall draws through,
// subtracts up to 0.04 from every channel before its shoulder: that cancels
// the 4 % mirror reflection a lit dielectric adds, so a material's base colour
// comes out as authored. A photograph has no such reflection to cancel, so the
// same subtraction only takes light out of its darks (linear 0.05 leaves as
// 0.016).
//
// The curve cannot be changed for the photographs alone: it is one curve for
// the whole frame, and the furniture standing in the hall is lit material,
// tuned under Neutral's toe, whose colours move with it (measured on the
// planner, 14 November: with no toe anywhere the red chairs draw paler and
// pinker). So the curve stays Neutral, and a photograph adds to its own
// colour, before the curve, what the toe will take out again. `filmToe` is the
// toe the photographs then come out with: at 0.04 they add nothing and draw as
// before; at 0 they leave the curve exactly as they arrived, wherever the
// frame's own occlusion and bloom have not touched them.
//
// What reaches the curve is the material's colour after the frame's last
// stage: the planner's grade and vignette, where its pipeline draws
// (PlannerRenderPipeline), then the exposure. `sceneOutput` (scene-grade.ts)
// tells a material which of those follow the draw it is in. A draw that is not
// the view's own frame (a reflection capture, a thumbnail) adds nothing.
// ---------------------------------------------------------------------------

import { float, luminance, max, min, mix, screenUV, select, smoothstep, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { sceneGrade, sceneOutput, VIGNETTE_FALLOFF, VIGNETTE_REACH } from "./scene-grade.js";

/** Khronos PBR Neutral's own toe. */
export const NEUTRAL_TOE = 0.04;
/** The toe the hall's photographs draw with unless a view asks for another. */
export const DEFAULT_FILM_TOE: number = NEUTRAL_TOE;

/** Neutral's shoulder starts here, measured after the toe is taken (0.8 - 0.04). */
const SHOULDER_START = 0.8 - NEUTRAL_TOE;
/** How far a compressed highlight moves toward white (Neutral's own figure). */
const DESATURATION = 0.15;
/** How steeply Neutral's own toe bends: its 6.25, which is 1 / (4 x 0.04). */
const NEUTRAL_CURVATURE = 6.25;

/**
 * How steeply a toe bends under twice its depth: 1 / (4 x toe), Neutral's
 * 6.25 exactly at Neutral's toe. A toe of none bends nowhere, so the figure
 * only has to stay finite there.
 */
export function toeCurvatureFor(toe: number): number {
  return 1 / (4 * Math.max(toe, 1e-6));
}

/** The toe the photographs draw with now; their shaders read it every frame. Set it with `setFilmToe`. */
export const filmToe = uniform(DEFAULT_FILM_TOE);
/** That toe's curvature, worked out here rather than in every fragment. */
const toeCurvature = uniform(toeCurvatureFor(DEFAULT_FILM_TOE));

/** A toe held to the range the curve is defined for; the default for a value that is not a number. */
export function clampFilmToe(toe: number): number {
  return Number.isFinite(toe) ? Math.min(NEUTRAL_TOE, Math.max(0, toe)) : DEFAULT_FILM_TOE;
}

/** Sets the toe the photographs draw with. */
export function setFilmToe(toe: number): void {
  const held = clampFilmToe(toe);
  filmToe.value = held;
  toeCurvature.value = toeCurvatureFor(held);
}

/** `?toe=0.02` in a page address: a toe to look with, or null when the address asks for none. */
export function filmToeFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("toe");
  if (raw === null || raw.trim() === "") return null;
  const toe = Number(raw);
  return Number.isFinite(toe) ? clampFilmToe(toe) : null;
}

/**
 * The toe a page's photographs are to draw with, or null when they draw
 * through Neutral as it is: the address's `?toe=` if it has one, else the
 * default if that is no longer Neutral's own. Null builds the photographs'
 * materials exactly as they were before this file existed.
 */
export function photographToeFor(search: string): number | null {
  const asked = filmToeFromSearch(search);
  if (asked !== null) return asked;
  return DEFAULT_FILM_TOE === NEUTRAL_TOE ? null : DEFAULT_FILM_TOE;
}

/**
 * What a curve with this toe takes from every channel of a colour whose least
 * channel is `least`. From zero to twice the toe, the toe's bend; above it,
 * the toe. Under zero every toe gives Neutral's own answer (a negative figure:
 * light is added), which the grade's saturation can ask for in a saturated
 * colour.
 */
export function filmToeOffset(least: number, toe: number): number {
  if (least < 0) return least - NEUTRAL_CURVATURE * least * least;
  return least < 2 * toe ? least - (least * least) / (4 * toe) : toe;
}

/**
 * Neutral with its toe as a number, on plain numbers: the curve a photograph
 * comes out with at `toe`. At 0.04 it is Khronos PBR Neutral, value for value;
 * at 0 a colour whose peak is under the shoulder leaves as it arrived.
 */
export function filmCurve(colour: readonly [number, number, number], exposure: number, toe: number): [number, number, number] {
  const r = colour[0] * exposure;
  const g = colour[1] * exposure;
  const b = colour[2] * exposure;
  const offset = filmToeOffset(Math.min(r, g, b), toe);
  const lifted: [number, number, number] = [r - offset, g - offset, b - offset];
  const peak = Math.max(lifted[0], lifted[1], lifted[2]);
  if (peak < SHOULDER_START) return lifted;
  const d = 1 - SHOULDER_START;
  const newPeak = 1 - (d * d) / (peak + d - SHOULDER_START);
  const scale = newPeak / peak;
  const grey = 1 - 1 / (DESATURATION * (peak - newPeak) + 1);
  return [
    lifted[0] * scale * (1 - grey) + newPeak * grey,
    lifted[1] * scale * (1 - grey) + newPeak * grey,
    lifted[2] * scale * (1 - grey) + newPeak * grey,
  ];
}

/**
 * The light a photograph adds to every channel as it arrives at the curve, so
 * that Neutral's own toe, taken from the sum, leaves what a toe of `toe` would
 * have left. `least` is the least channel arriving, before the addition.
 * Nothing at Neutral's toe; the whole 0.04 at no toe, for a least channel of
 * 0.04 or more.
 */
export function photographLiftFor(least: number, toe: number): number {
  const arriving = Math.max(least, 0);
  // What the toe asked for leaves of the least channel.
  const kept = arriving - filmToeOffset(arriving, toe);
  // The least channel Neutral's toe turns into that.
  const fed = kept < NEUTRAL_TOE ? Math.sqrt(kept / NEUTRAL_CURVATURE) : kept + NEUTRAL_TOE;
  return fed - arriving;
}

/** What follows a material's colour on the way to the curve, on plain numbers. */
export interface OutputStage {
  /** The renderer's exposure. */
  readonly exposure: number;
  /** The grade's gain per channel; ones where no pipeline draws. */
  readonly whiteBalance: readonly [number, number, number];
  /** The grade's saturation; 1 where no pipeline draws. */
  readonly saturation: number;
  /** The vignette's shade at the fragment, 1 at the centre and where no pipeline draws. */
  readonly shade: number;
}

/** A material's colour as it arrives at the curve after `stage` (scene-grade.ts: balance, saturation, shade, then exposure). */
export function arrivingColour(colour: readonly [number, number, number], stage: OutputStage): [number, number, number] {
  const r = colour[0] * stage.whiteBalance[0];
  const g = colour[1] * stage.whiteBalance[1];
  const b = colour[2] * stage.whiteBalance[2];
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const reach = stage.exposure * stage.shade;
  return [
    (grey + (r - grey) * stage.saturation) * reach,
    (grey + (g - grey) * stage.saturation) * reach,
    (grey + (b - grey) * stage.saturation) * reach,
  ];
}

/**
 * A photograph's colour with the lift for `toe` added, on plain numbers: the
 * shader's twin, for tests and tools. An equal amount in every channel after
 * the white balance passes through the saturation unchanged, so the lift is
 * divided by the exposure, the shade and each channel's gain.
 */
export function liftedPhotograph(colour: readonly [number, number, number], stage: OutputStage, toe: number): [number, number, number] {
  const arriving = arrivingColour(colour, stage);
  const lift = photographLiftFor(Math.min(arriving[0], arriving[1], arriving[2]), toe) / (stage.exposure * stage.shade);
  return [
    colour[0] + lift / stage.whiteBalance[0],
    colour[1] + lift / stage.whiteBalance[1],
    colour[2] + lift / stage.whiteBalance[2],
  ];
}

/**
 * A photograph's colour with the lift for `filmToe` added, as shader nodes.
 * `sceneOutput` says what follows the draw this fragment is in; outside the
 * view's own frame the lift is nothing. The grade and the vignette are the
 * pipeline's own (PlannerRenderPipeline.buildPlannerPipeline), restated here:
 * the two must change together.
 */
export function photographLift(colour: Node<"vec3">): Node<"vec3"> {
  const balance = sceneGrade.whiteBalance.sub(1).mul(sceneOutput.graded).add(1);
  const saturation = mix(float(1), sceneGrade.saturation, sceneOutput.graded);
  const distance = screenUV.sub(0.5).length().mul(VIGNETTE_REACH);
  const shade = mix(float(1), float(1).sub(sceneOutput.vignette), smoothstep(VIGNETTE_FALLOFF[0], VIGNETTE_FALLOFF[1], distance));
  const reach = max(sceneOutput.exposure.mul(shade), 1e-4);
  const balanced = colour.mul(balance);
  const arriving = mix(vec3(luminance(balanced)), balanced, saturation).mul(reach);
  const least = max(min(arriving.r, min(arriving.g, arriving.b)), 0);
  const kept = select(least.lessThan(filmToe.mul(2)), least.mul(least).mul(toeCurvature), least.sub(filmToe));
  const fed = select(kept.lessThan(NEUTRAL_TOE), max(kept, 0).div(NEUTRAL_CURVATURE).sqrt(), kept.add(NEUTRAL_TOE));
  const lift = fed.sub(least).mul(sceneOutput.main).div(reach);
  return colour.add(vec3(lift).div(balance));
}
