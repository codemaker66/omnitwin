// ---------------------------------------------------------------------------
// The cut's lines: what a model maker draws where a wall is cut
//
// Where the cutaway cuts a wall, three things mark the cut (hall-section.ts,
// hall-materials.ts):
//
//   - a gilt band on the room's face just under the cut, 8 mm deep in the
//     coffers' measured gilt (#a58350), so the gilt follows every moulding the
//     cut passes through in elevation: the dado rail, the doorcases, the
//     boards, the pilasters, the chimneypiece;
//   - beneath it a soft shadow, at most 35% darker, fading over 4 cm;
//   - on the section itself, its lines (the room edge, the outer arris).
//
// A line narrower than a pixel falls between pixels and flickers as the
// camera moves, and phones have no temporal smoothing. So every line is drawn
// at least LINE_MIN_PIXELS wide, box-filtered over a pixel, and dimmed in
// proportion when it has been widened, so the light it carries stays the same
// and a distant line does not brighten. The pure functions here are the
// shaders' rules, for the tests.
// ---------------------------------------------------------------------------

import { float, fwidth, max, min } from "three/tsl";
import type { Node } from "three/webgpu";

/** A line is never drawn thinner than this many pixels. */
export const LINE_MIN_PIXELS = 0.75;

/** The gilt band under the cut: 8 mm deep, in the coffers' measured gilt (sRGB). */
export const GILT_BAND = 0.008;
export const GILT_COLOUR = "#a58350";
const GILT_HALF = GILT_BAND / 2;

/** The soft shadow under the gilt band: how far it reaches down the room's face, and how much darker it starts. */
export const CUT_SHADOW = { reach: 0.04, strength: 0.35 } as const;

/**
 * The gilt band's half-width, metres, where one pixel spans `pixel` metres of
 * height (the shader's fwidth): 4 mm, or 0.75 px when that is wider.
 */
export function giltHalfWidth(pixel: number): number {
  return Math.max(GILT_HALF, LINE_MIN_PIXELS * Math.abs(pixel));
}

/** The gilt band's strength: 1 at its true width, less in proportion once widened, so it carries the same light. */
export function giltIntensity(pixel: number): number {
  return GILT_HALF / giltHalfWidth(pixel);
}

/**
 * How much darker the room's face is `below` metres under the gilt band's
 * lower edge: CUT_SHADOW.strength there, fading softly (quadratically) to 0
 * at CUT_SHADOW.reach.
 */
export function cutShadow(below: number): number {
  const t = Math.max(0, Math.min(1, below / CUT_SHADOW.reach));
  return CUT_SHADOW.strength * (1 - t) * (1 - t);
}

/**
 * How much of a pixel lies within `edge` of the line's start: the area of a
 * box one pixel wide (`pixel` metres) on the near side of `edge`, a linear
 * ramp. Summed down a column of pixels it carries the same total wherever
 * the edge falls between them, so a moving line keeps a steady weight (a
 * smoothstep ramp does not quite).
 */
function boxCoverage(distance: Node<"float">, edge: Node<"float">, pixel: Node<"float">): Node<"float"> {
  return min(max(edge.add(pixel.mul(0.5)).sub(distance).div(pixel), float(0)), float(1));
}

/** The gilt is never drawn under twice that: its half-width is at least LINE_MIN_PIXELS (giltHalfWidth). */
export const GILT_MIN_PIXELS = 2 * LINE_MIN_PIXELS;

/**
 * 1 within `width` of an edge, box-filtered over one pixel and never under
 * `minPixels` wide (LINE_MIN_PIXELS unless given); widened, it is dimmed in
 * proportion. The distance from the edge, metres, is `across` times `scale`
 * (1 unless given): the pixel's size is scaled with it, never differentiated
 * through `scale`, so a scale that steps from texel to texel does not bead
 * the line. With `dim` false it is widened without dimming: a band of
 * material, not a line of light.
 */
export function lineCoverage(across: Node<"float">, width: number, scale: Node<"float"> = float(1), minPixels = LINE_MIN_PIXELS, dim = true): Node<"float"> {
  const pixel = max(fwidth(across).mul(scale), float(1e-5));
  const drawn = max(float(width), pixel.mul(minPixels));
  const coverage = boxCoverage(across.mul(scale), drawn, pixel);
  // A band of material (the cut's plaster) is widened whole; a line of light is dimmed as it widens.
  return dim ? coverage.mul(float(width).div(drawn)) : coverage;
}

export interface CutEdge {
  /** How much of the gilt band covers this fragment (0-1, already dimmed where widened). */
  readonly gilt: Node<"float">;
  /** What the room's face is multiplied by under the band (1 less the shadow). */
  readonly shade: Node<"float">;
}

/**
 * The gilt band and its shadow on a room face `below` metres under the cut,
 * measured on the world's height (`height`), so the band keeps to the cut's
 * level over every moulding. `active` is 1 where the wall is cut and the face
 * is walling (not cloth or glass in a window), 0 elsewhere.
 */
export function cutEdge(below: Node<"float">, height: Node<"float">, active: Node<"float">): CutEdge {
  const pixel = max(fwidth(height), float(1e-5));
  const half = max(float(GILT_HALF), pixel.mul(LINE_MIN_PIXELS));
  const band = half.mul(2);
  const gilt = boxCoverage(below, band, pixel).mul(float(GILT_HALF).div(half)).mul(active);
  const t = min(max(below.sub(band).div(CUT_SHADOW.reach), float(0)), float(1));
  const fall = float(1).sub(t);
  const shade = float(1).sub(fall.mul(fall).mul(CUT_SHADOW.strength).mul(active));
  return { gilt, shade };
}
