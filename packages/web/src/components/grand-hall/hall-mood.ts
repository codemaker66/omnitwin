// ---------------------------------------------------------------------------
// Lighting moods for the Grand Hall
//
// The room's light is stored per vertex in four channels; a mood says how
// bright and what colour each channel is, plus the sky the windows show in
// reflections and the chandeliers' glow. Moods blend continuously,
// so changing from a winter afternoon to a candlelit dinner is a tween of a
// handful of uniforms rather than a re-render of anything heavy.
// ---------------------------------------------------------------------------

import { Color } from "three";
import { uniform } from "three/tsl";
import type { ChannelGain } from "../../lib/scene-grade.js";

export type HallMoodName = "daylight" | "evening" | "candlelight";

export const HALL_MOOD_NAMES: readonly HallMoodName[] = ["daylight", "evening", "candlelight"];

export interface HallMoodSpec {
  readonly label: string;
  readonly ambient: string;
  readonly ambientIntensity: number;
  readonly chandelier: string;
  readonly chandelierIntensity: number;
  readonly daylight: string;
  readonly daylightIntensity: number;
  readonly uplight: string;
  readonly uplightIntensity: number;
  readonly skyHorizon: string;
  readonly skyIntensity: number;
  /** Brightness of lamp bulbs and their halos. */
  readonly glow: number;
  /** Renderer exposure. */
  readonly exposure: number;
  /** Environment reflections on varnish, gilt and glass. */
  readonly reflections: number;
  /**
   * The camera's white balance as a gain per channel in linear light
   * (scene-grade.ts), relative to the light the photographs were taken in.
   */
  readonly whiteBalance: ChannelGain;
  readonly saturation: number;
}

export const HALL_MOODS: Readonly<Record<HallMoodName, HallMoodSpec>> = {
  daylight: {
    label: "Daylight",
    ambient: "#f3e7d4",
    ambientIntensity: 0.36,
    chandelier: "#ffd7a1",
    chandelierIntensity: 0.42,
    daylight: "#e4ecf6",
    daylightIntensity: 1.25,
    uplight: "#ffcf86",
    uplightIntensity: 0.55,
    skyHorizon: "#eef2f4",
    skyIntensity: 1.55,
    glow: 0.55,
    exposure: 1.0,
    reflections: 0.7,
    whiteBalance: [1, 1, 1],
    saturation: 1.0,
  },
  evening: {
    label: "Evening",
    ambient: "#f2d6ae",
    ambientIntensity: 0.17,
    chandelier: "#ffcb8a",
    chandelierIntensity: 1.45,
    daylight: "#5d79b8",
    daylightIntensity: 0.32,
    uplight: "#ffc272",
    uplightIntensity: 1.15,
    skyHorizon: "#6d6f96",
    skyIntensity: 0.75,
    glow: 1.0,
    exposure: 1.06,
    reflections: 0.85,
    whiteBalance: [0.95, 1, 1.1],
    saturation: 1.02,
  },
  candlelight: {
    label: "Candlelight",
    ambient: "#d9a971",
    ambientIntensity: 0.11,
    chandelier: "#ffb766",
    chandelierIntensity: 0.52,
    daylight: "#33467a",
    daylightIntensity: 0.12,
    uplight: "#ffad55",
    uplightIntensity: 0.85,
    skyHorizon: "#2a2c4c",
    skyIntensity: 0.5,
    glow: 0.7,
    exposure: 1.12,
    reflections: 0.9,
    whiteBalance: [0.93, 1, 1.16],
    saturation: 0.98,
  },
};

const color = (hex: string): Color => new Color(hex);

/**
 * The uniform nodes the hall's materials and light rig read. Each user holds
 * its own instance; `apply` sets them from a blend of two moods.
 */
export class HallMoodUniforms {
  readonly ambient = uniform(color(HALL_MOODS.evening.ambient));
  readonly ambientIntensity = uniform(HALL_MOODS.evening.ambientIntensity);
  readonly chandelier = uniform(color(HALL_MOODS.evening.chandelier));
  readonly chandelierIntensity = uniform(HALL_MOODS.evening.chandelierIntensity);
  readonly daylight = uniform(color(HALL_MOODS.evening.daylight));
  readonly daylightIntensity = uniform(HALL_MOODS.evening.daylightIntensity);
  readonly uplight = uniform(color(HALL_MOODS.evening.uplight));
  readonly uplightIntensity = uniform(HALL_MOODS.evening.uplightIntensity);
  readonly skyHorizon = uniform(color(HALL_MOODS.evening.skyHorizon));
  readonly skyIntensity = uniform(HALL_MOODS.evening.skyIntensity);
  readonly glow = uniform(HALL_MOODS.evening.glow);
  exposure = HALL_MOODS.evening.exposure;
  reflections = HALL_MOODS.evening.reflections;
  whiteBalance: [number, number, number] = [...HALL_MOODS.evening.whiteBalance];
  saturation = HALL_MOODS.evening.saturation;

  /** Sets every uniform to `from` blended toward `to` by `t` ∈ [0, 1]. */
  apply(from: HallMoodSpec, to: HallMoodSpec, t: number): void {
    const k = Math.max(0, Math.min(1, t));
    const mixColor = (target: Color, a: string, b: string): void => { target.set(a).lerp(scratch.set(b), k); };
    const mix = (a: number, b: number): number => a + (b - a) * k;
    mixColor(this.ambient.value, from.ambient, to.ambient);
    this.ambientIntensity.value = mix(from.ambientIntensity, to.ambientIntensity);
    mixColor(this.chandelier.value, from.chandelier, to.chandelier);
    this.chandelierIntensity.value = mix(from.chandelierIntensity, to.chandelierIntensity);
    mixColor(this.daylight.value, from.daylight, to.daylight);
    this.daylightIntensity.value = mix(from.daylightIntensity, to.daylightIntensity);
    mixColor(this.uplight.value, from.uplight, to.uplight);
    this.uplightIntensity.value = mix(from.uplightIntensity, to.uplightIntensity);
    mixColor(this.skyHorizon.value, from.skyHorizon, to.skyHorizon);
    this.skyIntensity.value = mix(from.skyIntensity, to.skyIntensity);
    this.glow.value = mix(from.glow, to.glow);
    this.exposure = mix(from.exposure, to.exposure);
    this.reflections = mix(from.reflections, to.reflections);
    this.whiteBalance = [
      mix(from.whiteBalance[0], to.whiteBalance[0]),
      mix(from.whiteBalance[1], to.whiteBalance[1]),
      mix(from.whiteBalance[2], to.whiteBalance[2]),
    ];
    this.saturation = mix(from.saturation, to.saturation);
  }

  /** The live values as a spec, so a new blend starts exactly where this one is. */
  snapshot(base: HallMoodSpec): HallMoodSpec {
    return {
      ...base,
      ambient: `#${this.ambient.value.getHexString()}`,
      ambientIntensity: this.ambientIntensity.value,
      chandelier: `#${this.chandelier.value.getHexString()}`,
      chandelierIntensity: this.chandelierIntensity.value,
      daylight: `#${this.daylight.value.getHexString()}`,
      daylightIntensity: this.daylightIntensity.value,
      uplight: `#${this.uplight.value.getHexString()}`,
      uplightIntensity: this.uplightIntensity.value,
      skyHorizon: `#${this.skyHorizon.value.getHexString()}`,
      skyIntensity: this.skyIntensity.value,
      glow: this.glow.value,
      exposure: this.exposure,
      reflections: this.reflections,
      whiteBalance: [...this.whiteBalance],
      saturation: this.saturation,
    };
  }
}

const scratch = new Color();

/**
 * The longest frame a blend or an easing advances by, in seconds: long
 * enough that a slow device's steady frames still advance in real time, short
 * enough that one stalled frame (a shader compiling) cannot skip a blend.
 */
export const HALL_MAX_FRAME_STEP = 0.25;

/**
 * How far a blend or an easing advances in one frame. Its first frame does
 * not advance: on demand rendering that frame's delta is the idle gap before
 * the change, not time spent animating. Later frames advance by their own
 * duration, up to HALL_MAX_FRAME_STEP.
 */
export function hallFrameStep(delta: number, firstFrame: boolean): number {
  return firstFrame ? 0 : Math.min(Math.max(delta, 0), HALL_MAX_FRAME_STEP);
}

/** Smooth ease for mood transitions: gentle at both ends. */
export function moodEase(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
