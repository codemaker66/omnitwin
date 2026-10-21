// ---------------------------------------------------------------------------
// The live sky over the Grand Hall
//
// HallSkyDriver publishes the sky for the moment shown (hall-sky.ts) here,
// once per frame while the time moves. The sky dome, the sun's light and the
// room's materials read these uniforms directly, so a dragged sun reaches
// every surface in the same frame without React re-rendering anything.
// `version` lets frame loops notice a change; `moving` is true while the time
// is still travelling (a drag, or the sun sweeping to a chosen hour), when
// work that only matters at rest — recapturing reflections, re-rendering the
// sun's shadows at full quality — can wait.
// ---------------------------------------------------------------------------

import { Color, Vector3 } from "three";
import { uniform } from "three/tsl";
import type { HallSky } from "./hall-sky.js";

export const hallSkyUniforms = {
  /** Unit vector toward the sun in the hall's frame (below the horizon at night). */
  sunDirection: uniform(new Vector3(0, 1, 0)),
  /** Direct sunlight's colour and strength (0 once the disc has set). */
  sunColor: uniform(new Color(1, 1, 1)),
  sunStrength: uniform(0),
  moonDirection: uniform(new Vector3(0, -1, 0)),
  moonColor: uniform(new Color(0.62, 0.72, 0.9)),
  moonStrength: uniform(0),
  /** The sky's palette (sky-palette.ts). */
  zenith: uniform(new Color()),
  horizonSun: uniform(new Color()),
  horizonAway: uniform(new Color()),
  glow: uniform(new Color()),
  glowStrength: uniform(0),
  stars: uniform(0),
  cityGlow: uniform(0),
  /** The city's night, 0 above −3° of sun to 1 by −10° (sky-palette.ts). */
  night: uniform(0),
  /** The sun's true altitude, degrees (each street lamp switches at its own). */
  sunAltitude: uniform(90),
  /**
   * Where the night's light comes from across the city, a horizontal unit
   * vector: the moon while it stands more than about 5° up, otherwise the
   * glow of George Square, the densest cluster of street lamps round the hall.
   */
  nightGlowDirection: uniform(new Vector3(0, 0, 1)),
  /**
   * The light the sun's shadow map is drawn for — the sun by day, the moon
   * at night (HallSunLight): unit vector toward it, and its direct
   * irradiance in the room's baked-light units.
   */
  lightDirection: uniform(new Vector3(0, 1, 0)),
  lightRadiance: uniform(new Color(0, 0, 0)),
} as const;

export const hallSkyState: { sky: HallSky | null; version: number; moving: boolean } = {
  sky: null,
  version: 0,
  moving: false,
};

/** Publishes the sky for the moment shown; `moving` while the time still travels. */
export function publishHallSky(sky: HallSky, moving: boolean): void {
  const u = hallSkyUniforms;
  u.sunDirection.value.set(...sky.sun.direction);
  u.sunColor.value.setRGB(...sky.sun.color);
  u.sunStrength.value = sky.sun.strength;
  u.moonDirection.value.set(...sky.moon.direction);
  u.moonColor.value.setRGB(...sky.moon.color);
  u.moonStrength.value = sky.moon.strength;
  u.zenith.value.setRGB(...sky.palette.zenith);
  u.horizonSun.value.setRGB(...sky.palette.horizonSun);
  u.horizonAway.value.setRGB(...sky.palette.horizonAway);
  u.glow.value.setRGB(...sky.palette.glow);
  u.glowStrength.value = sky.palette.glowStrength;
  u.stars.value = sky.palette.stars;
  u.cityGlow.value = sky.palette.cityGlow;
  u.night.value = sky.palette.night;
  u.sunAltitude.value = sky.sun.trueAltitude;
  u.nightGlowDirection.value.set(...sky.nightGlow);
  hallSkyState.sky = sky;
  hallSkyState.moving = moving;
  hallSkyState.version += 1;
}

/** No sky is driving the hall (its moods light it as before). */
export function clearHallSky(): void {
  hallSkyState.sky = null;
  hallSkyState.moving = false;
  hallSkyState.version += 1;
}
