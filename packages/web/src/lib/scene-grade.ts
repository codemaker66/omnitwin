// ---------------------------------------------------------------------------
// Scene grade — the camera's eye on the planner's view
//
// A photographer in a candlelit hall sets the camera's white balance toward
// the candles, so white linen reads white rather than orange while the light
// still feels warm. The grade does the same before tone mapping: a gain per
// channel (normalised to keep brightness) and a saturation. The pipeline
// reads these uniforms; whoever owns the light (the Grand Hall's moods) sets
// them, and a scene without an owner keeps the neutral grade. The hall's
// photographs already carry their own camera's balance, so the gains are
// relative to the light they were taken in: neutral in Daylight.
// ---------------------------------------------------------------------------

import { Color } from "three";
import { float, luminance, mix, screenUV, smoothstep, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/** A per-channel gain in linear light. */
export type ChannelGain = readonly [number, number, number];

/** Uniforms the post-processing pipeline reads every frame. */
export const sceneGrade = {
  /** Per-channel gain applied in linear light before tone mapping. */
  whiteBalance: uniform(new Color(1, 1, 1)),
  /** 1 leaves colour as rendered; below 1 desaturates, above 1 enriches. */
  saturation: uniform(1),
} as const;

/**
 * The pipeline's vignette: its shade falls from 1 to (1 - strength) between
 * these distances from the frame's centre, a corner being at VIGNETTE_REACH
 * times its half-diagonal's 0.7071. Shared with a material that has to undo
 * it (lib/film-toe.ts).
 */
export const VIGNETTE_REACH = 1.4142;
export const VIGNETTE_FALLOFF = [0.35, 1.0] as const;

/**
 * The vignette's shade at this fragment, as a node: 1 at the frame's centre,
 * falling to `edge` (1 less the vignette's strength) across VIGNETTE_FALLOFF.
 */
export function vignetteShade(edge: Node<"float">): Node<"float"> {
  const distance = screenUV.sub(0.5).length().mul(VIGNETTE_REACH);
  return mix(float(1), edge, smoothstep(VIGNETTE_FALLOFF[0], VIGNETTE_FALLOFF[1], distance));
}

/**
 * The camera's eye on a colour, as nodes, in linear light: the white balance's
 * gain, the saturation about the colour's own luminance, then the vignette's
 * `shade` (null: no vignette). The planner's pipeline draws its frame through
 * this (PlannerRenderPipeline) and the hall's photographs work it back out of
 * their own colour (lib/film-toe.ts photographLift), so a stage added here
 * reaches both, and film-toe-graph.test.ts runs the one against the other.
 */
export function cameraEye(colour: Node<"vec3">, balance: Node<"color">, saturation: Node<"float">, shade: Node<"float"> | null): Node<"vec3"> {
  const balanced = colour.mul(balance);
  const graded = mix(vec3(luminance(balanced)), balanced, saturation);
  return shade === null ? graded : graded.mul(shade);
}

/**
 * What follows a material's own colour on the way to the tone curve, for a
 * material that has to know (lib/film-toe.ts: the hall's photographs add what
 * the curve's toe will take). Every draw through the native renderer declares
 * itself (lib/native-renderer.ts): the view's own frame as `main` 1 with its
 * exposure, every other draw of the scene (a reflection capture, a shadow map,
 * a thumbnail) as `main` 0. `graded` and `vignette` describe the pipeline's
 * frame around a draw and mean something only with `main`: a shadow map drawn
 * inside that frame reads them set. Each is put back when its draw ends.
 */
export const sceneOutput = {
  /** 1 while the view's own frame is drawn, 0 for every other draw of the scene. */
  main: uniform(0),
  /** The renderer's exposure for that frame. */
  exposure: uniform(1),
  /** 1 while the planner's pipeline follows the draw with the grade above. */
  graded: uniform(0),
  /** That pipeline's vignette strength, 0 without one. */
  vignette: uniform(0),
} as const;

/** Runs `draw` as the view's own frame (`main`) or as another draw of the scene, then restores what was declared. */
export function withMainDraw(main: boolean, exposure: number, draw: () => void): void {
  const previous = { main: sceneOutput.main.value, exposure: sceneOutput.exposure.value };
  sceneOutput.main.value = main ? 1 : 0;
  sceneOutput.exposure.value = exposure;
  try {
    draw();
  } finally {
    sceneOutput.main.value = previous.main;
    sceneOutput.exposure.value = previous.exposure;
  }
}

/** Runs `draw` with the pipeline's grade and a vignette of `vignette` declared as following it, then restores what was declared. */
export function withPipelineOutput(vignette: number, draw: () => void): void {
  const previous = { graded: sceneOutput.graded.value, vignette: sceneOutput.vignette.value };
  sceneOutput.graded.value = 1;
  sceneOutput.vignette.value = vignette;
  try {
    draw();
  } finally {
    sceneOutput.graded.value = previous.graded;
    sceneOutput.vignette.value = previous.vignette;
  }
}

/** `gain` scaled so that a grey keeps its luminance. */
export function normalisedGain(gain: ChannelGain, target: Color): Color {
  const luminance = 0.2126 * gain[0] + 0.7152 * gain[1] + 0.0722 * gain[2];
  if (!(luminance > 0)) return target.setRGB(1, 1, 1);
  return target.setRGB(gain[0] / luminance, gain[1] / luminance, gain[2] / luminance);
}

/** Sets the grade. */
export function setSceneGrade(gain: ChannelGain, saturation: number): void {
  normalisedGain(gain, sceneGrade.whiteBalance.value);
  sceneGrade.saturation.value = saturation;
}

/** Restores the neutral grade. */
export function resetSceneGrade(): void {
  sceneGrade.whiteBalance.value.setRGB(1, 1, 1);
  sceneGrade.saturation.value = 1;
}
