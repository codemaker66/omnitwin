// ---------------------------------------------------------------------------
// Film toe — how deep the photographed room's tone curve cuts into its darks
//
// The Grand Hall is drawn from the scan's own photographs, which are already
// display-referred. Khronos PBR Neutral, the curve the hall used, subtracts
// up to 0.04 from every channel before its shoulder: that cancels the 4 %
// mirror reflection a lit dielectric adds, so a material's base colour comes
// out as authored. A photograph has no such reflection to cancel, so the same
// subtraction only takes light out of its darks (linear 0.05 leaves as 0.016).
//
// This curve is Neutral with the depth of that subtraction as a number, the
// toe: at 0.04 it is Neutral, value for value; at 0 a colour whose peak is
// under 0.8 leaves exactly as it arrived, so Daylight is the photograph. The
// shoulder starts at 0.8 less the toe, measured after the toe is taken, as in
// Neutral: a grey gives up the whole toe and meets it at an incoming 0.8,
// while a saturated colour gives up almost none and meets it a little sooner
// (from 0.76 at Neutral's toe). The renderer calls the curve through its usual
// tone-mapping path, after the pipeline's grade and vignette and with the
// mood's exposure, which is where a toe is exact for every mood.
//
// The grade's saturation can take a channel of a saturated colour under zero.
// Neutral answers such a colour by adding light (its quadratic, run below
// zero), so this curve gives that answer in proportion to the toe: all of it
// at Neutral's toe, where the two then agree for every colour, and none at
// toe 0, where every colour under the shoulder is left alone.
// ---------------------------------------------------------------------------

import { CustomToneMapping } from "three";
import { float, max, min, mix, select, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { getNativeRenderer } from "./native-renderer.js";

/** Khronos PBR Neutral's own toe. */
export const NEUTRAL_TOE = 0.04;
/** The toe the hall draws with unless a view asks for another. */
export const DEFAULT_FILM_TOE = NEUTRAL_TOE;

/** The shoulder starts at this less the toe, after the toe is taken (Neutral: 0.8 - 0.04). */
const SHOULDER_PEAK = 0.8;
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

/** The toe the curve draws with now; the shader reads it every frame. Set it with `setFilmToe`. */
export const filmToe = uniform(DEFAULT_FILM_TOE);
/** That toe's curvature, worked out here so the default draws with Neutral's own 6.25 exactly. */
const toeCurvature = uniform(toeCurvatureFor(DEFAULT_FILM_TOE));

/** A toe held to the range the curve is defined for; the default for a value that is not a number. */
export function clampFilmToe(toe: number): number {
  return Number.isFinite(toe) ? Math.min(NEUTRAL_TOE, Math.max(0, toe)) : DEFAULT_FILM_TOE;
}

/** Sets the toe the curve draws with. */
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
 * What the curve takes from every channel of a colour whose least channel is
 * `least`. Under zero it is Neutral's own answer in proportion to the toe (a
 * negative figure: light is added); from zero to twice the toe, the toe's bend.
 */
export function filmToeOffset(least: number, toe: number): number {
  if (least < 0) return (toe / NEUTRAL_TOE) * (least - NEUTRAL_CURVATURE * least * least);
  return least < 2 * toe ? least - (least * least) / (4 * toe) : toe;
}

/** The curve on plain numbers: the shader's twin, for tests and tools. */
export function filmCurve(colour: readonly [number, number, number], exposure: number, toe: number): [number, number, number] {
  const r = colour[0] * exposure;
  const g = colour[1] * exposure;
  const b = colour[2] * exposure;
  const offset = filmToeOffset(Math.min(r, g, b), toe);
  const lifted: [number, number, number] = [r - offset, g - offset, b - offset];
  const start = SHOULDER_PEAK - toe;
  const peak = Math.max(lifted[0], lifted[1], lifted[2]);
  if (peak < start) return lifted;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const scale = newPeak / peak;
  const grey = 1 - 1 / (DESATURATION * (peak - newPeak) + 1);
  return [
    lifted[0] * scale * (1 - grey) + newPeak * grey,
    lifted[1] * scale * (1 - grey) + newPeak * grey,
    lifted[2] * scale * (1 - grey) + newPeak * grey,
  ];
}

/**
 * The curve as shader nodes, each step in the order three's own Neutral takes
 * it (nodes/display/ToneMappingFunctions.js), so the default toe computes what
 * Neutral computes, step for step. Every branch is computed and one is chosen,
 * so the guards below only keep an unchosen branch finite.
 */
function curveNodes(colour: Node<"vec3">, exposure: Node<"float">): Node<"vec3"> {
  const exposed = colour.mul(exposure);
  const least = min(exposed.r, min(exposed.g, exposed.b));
  const square = least.mul(least);
  const underZero = least.sub(square.mul(NEUTRAL_CURVATURE)).mul(filmToe.div(NEUTRAL_TOE));
  const withinToe = least.sub(square.mul(toeCurvature));
  const bend = select(least.lessThan(float(0)), underZero, withinToe);
  const offset = select(least.lessThan(filmToe.mul(2)), bend, filmToe);
  const lifted = exposed.sub(offset);
  const start = float(SHOULDER_PEAK).sub(filmToe);
  const peak = max(lifted.r, max(lifted.g, lifted.b));
  const d = float(1).sub(start);
  const newPeak = float(1).sub(d.mul(d).div(max(peak.add(d.sub(start)), 1e-4)));
  const rolled = lifted.mul(newPeak.div(max(peak, 1e-4)));
  const grey = float(1).sub(float(1).div(float(DESATURATION).mul(peak.sub(newPeak)).add(1)));
  return select(peak.lessThan(start), lifted, mix(rolled, vec3(newPeak), grey));
}

/**
 * The curve in the shape a renderer's node library keeps: it is called with
 * the scene colour's rgb and the exposure, as the renderer calls its own curves.
 */
export function photographToneMapping(colour: Node, exposure: Node): Node {
  if (!isColourNode(colour) || !isExposureNode(exposure)) return colour;
  return curveNodes(colour, exposure);
}

/** Whether a value is a shader node at all, read as three marks every node. */
function isShaderNode(node: object): boolean {
  const flag: unknown = Reflect.get(node, "isNode");
  return flag === true;
}

// The node library declares its curves on untyped nodes, while the renderer
// always calls one with the scene colour's rgb and its exposure
// (ToneMappingNode.setup): these two predicates state that for the compiler.
function isColourNode(node: Node): node is Node<"vec3"> {
  return isShaderNode(node);
}

function isExposureNode(node: Node): node is Node<"float"> {
  return isShaderNode(node);
}

/**
 * Registers the curve with a renderer's node library as its custom tone
 * mapping. True when the renderer now draws `CustomToneMapping` with this
 * curve; false for a renderer with no node library, which keeps Neutral.
 */
export function registerPhotographToneMapping(renderer: object): boolean {
  const native = getNativeRenderer(renderer);
  if (native === null) return false;
  if (native.library.getToneMappingFunction(CustomToneMapping) === null) {
    native.library.addToneMapping(photographToneMapping, CustomToneMapping);
  }
  return native.library.getToneMappingFunction(CustomToneMapping) === photographToneMapping;
}
