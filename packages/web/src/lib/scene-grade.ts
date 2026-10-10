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
import { uniform } from "three/tsl";

/** A per-channel gain in linear light. */
export type ChannelGain = readonly [number, number, number];

/** Uniforms the post-processing pipeline reads every frame. */
export const sceneGrade = {
  /** Per-channel gain applied in linear light before tone mapping. */
  whiteBalance: uniform(new Color(1, 1, 1)),
  /** 1 leaves colour as rendered; below 1 desaturates, above 1 enriches. */
  saturation: uniform(1),
} as const;

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
