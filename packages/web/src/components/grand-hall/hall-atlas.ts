// ---------------------------------------------------------------------------
// The wall atlas — the hall's four walls, photographed from the scan
//
// Each wall's elevation is an orthophoto made by projecting the 8K panoramas
// from the scan's 49 stations onto the measured wall surfaces (see
// tools/grand-hall-survey). The four orthophotos share one square image:
//
//   ┌──────────── window wall ────────────┐
//   ├───────────── door wall ─────────────┤
//   ├──── end wall ────┬─ fireplace wall ─┤
//   └──────────────────┴──────────────────┘
//
// Every wall face in the model takes its colour from here by planar
// projection along the wall's normal: (u, v) in wall-local metres maps to one
// texel whatever the face's depth, which is how the orthophotos were made.
// ---------------------------------------------------------------------------

import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALLS, type HallWallId } from "./hall-spec.js";

/** Square atlas side, in texels. */
export const WALL_ATLAS_SIZE = 4096;
/** Texels per metre: the end walls fill half the atlas width exactly. */
export const WALL_ATLAS_PPM = (WALL_ATLAS_SIZE / 2) / (HALL_HALF_WIDTH * 2);
/** Heights each wall's strip covers, bottom to top. */
export const WALL_ATLAS_V_MIN = -0.02;
export const WALL_ATLAS_V_MAX = 6.72;
/** Height of one wall's strip, in texels. */
export const WALL_ATLAS_ROW = Math.ceil((WALL_ATLAS_V_MAX - WALL_ATLAS_V_MIN) * WALL_ATLAS_PPM);

/** Top-left texel of each wall's strip (image rows count down from the top). */
export const WALL_ATLAS_ORIGIN: Readonly<Record<HallWallId, readonly [number, number]>> = {
  window: [0, 0],
  door: [0, WALL_ATLAS_ROW],
  end: [0, WALL_ATLAS_ROW * 2],
  fireplace: [WALL_ATLAS_SIZE / 2, WALL_ATLAS_ROW * 2],
};

/** Texture coordinates (origin bottom-left, as three samples) of a wall-local point. */
export function wallAtlasUv(wall: HallWallId, u: number, v: number): [number, number] {
  const [x0, y0] = WALL_ATLAS_ORIGIN[wall];
  const px = x0 + u * WALL_ATLAS_PPM;
  const py = y0 + (WALL_ATLAS_V_MAX - v) * WALL_ATLAS_PPM;
  return [px / WALL_ATLAS_SIZE, 1 - py / WALL_ATLAS_SIZE];
}

/**
 * Atlas coordinates of a world point on (or near) wall `index` in HALL_WALLS,
 * by projecting it onto the wall along the wall's normal.
 */
export function atlasUvForPoint(index: number, point: readonly [number, number, number]): [number, number] {
  const wall = HALL_WALLS[index];
  if (wall === undefined) return [-1, -1];
  const u = (point[0] - wall.origin[0]) * wall.tangent[0] + (point[2] - wall.origin[2]) * wall.tangent[2];
  return wallAtlasUv(wall.id, u, point[1]);
}

/** Half-extents used to check that every strip fits its slot. */
export const WALL_ATLAS_FITS = Math.ceil(HALL_HALF_LENGTH * 2 * WALL_ATLAS_PPM) <= WALL_ATLAS_SIZE
  && WALL_ATLAS_ROW * 3 <= WALL_ATLAS_SIZE;
