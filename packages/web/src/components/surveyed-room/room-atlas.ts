// ---------------------------------------------------------------------------
// A surveyed room's wall atlas
//
// Every wall's elevation photograph is one strip of a shared image. The
// record gives the image's size, its texels per metre, the heights each strip
// covers (vRange, bottom to top) and each wall's strip by its top-left texel,
// image rows counting down. A wall-local (u, v) maps to one texel whatever
// the depth of the surface there, which is how the elevations were made: the
// same arithmetic as the Grand Hall's wallAtlasUv (grand-hall/hall-atlas.ts).
// ---------------------------------------------------------------------------

import type { SurveyAtlas, SurveyWall } from "./survey-record.js";

/** Texture coordinates (origin bottom-left, as three samples) of a wall-local point. */
export function roomAtlasUv(
  atlas: Pick<SurveyAtlas, "size" | "ppm" | "vRange">,
  wall: Pick<SurveyWall, "atlas">,
  u: number,
  v: number,
): [number, number] {
  const [x0, y0] = wall.atlas;
  const [width, height] = atlas.size;
  const vMax = atlas.vRange[1];
  const px = x0 + u * atlas.ppm;
  const py = y0 + (vMax - v) * atlas.ppm;
  return [px / width, 1 - py / height];
}
