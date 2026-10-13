// ---------------------------------------------------------------------------
// Grand Hall light — a precomputed illumination model for the static room
//
// The room never moves, so its light is computed once per vertex when the
// geometry is built, and the GPU only mixes four stored channels with the
// current mood's colours. That keeps every frame free of per-light shading
// cost on phones while the room still shows what makes the real hall read:
// pools of chandelier light on the floor and the avodire ceiling, the frieze's
// warm uplight, daylight falling from the Glassford Street windows, and soft
// darkening into corners. The same channels relight the scan's photographs
// (hall-materials.ts), so they need the right shape more than absolute scale.
//
// Channels (all dimensionless, roughly 0–1.5):
//   ao          — ambient occlusion from the room's concave edges
//   chandelier  — Lambert irradiance from the five chandeliers
//   daylight    — irradiance from the windows' glazed lights as area lights
//   uplight     — the LED strip hidden on the ledge under the frieze
//
// The model ignores occlusion by furniture (lit live by HallLightRig) and by
// the room itself, which is close to convex.
// ---------------------------------------------------------------------------

import {
  HALL_CHANDELIERS,
  HALL_ELEVATION,
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  HALL_HEIGHT,
  HALL_OPENINGS,
  hallWall,
  isWindow,
  openingHeadAt,
  openingTop,
  wallPoint,
  type HallChandelier,
  type HallOpening,
} from "./hall-spec.js";

export type Vec3 = readonly [number, number, number];

export interface HallLightSample {
  readonly ao: number;
  readonly chandelier: number;
  readonly daylight: number;
  readonly uplight: number;
}

/** Where a vertex sits, so the model can treat ceiling and dome kindly. */
export type HallSurfaceRole = "floor" | "wall" | "ceiling" | "dome" | "detail";

export const CHANDELIER_POWER = 4.2;
/** Softens the inverse-square pole so a ceiling rose right above a chandelier
 *  is bright without burning out. Acts like the fitting's physical size. */
const CHANDELIER_SOFT_RADIUS = 0.85;
/** Chandeliers throw more light down than up: the arms and shades cut some of
 *  the upward hemisphere. */
const CHANDELIER_UPWARD_FRACTION = 0.7;

const DAYLIGHT_RADIANCE = 0.62;
const UPLIGHT_POWER = 0.42;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------------------
// Ambient occlusion from concave edges
// ---------------------------------------------------------------------------

/** Occlusion from one concave edge at distance `d`: 1 far away, darker near. */
function edgeOcclusion(distance: number, strength: number, reach: number): number {
  return 1 - strength * Math.exp(-Math.max(0, distance) / reach);
}

/**
 * Ambient occlusion at a point inside the room. Distances to the floor, the
 * ceiling and the four walls stand in for the solid angle those surfaces hide;
 * corners multiply. The dado rail and frieze cornice add their shadow lines.
 */
export function hallAmbientOcclusion(point: Vec3, normal: Vec3, role: HallSurfaceRole): number {
  const [x, y, z] = point;
  const toWestWall = x + HALL_HALF_LENGTH;
  const toEastWall = HALL_HALF_LENGTH - x;
  const toNorthWall = z + HALL_HALF_WIDTH;
  const toSouthWall = HALL_HALF_WIDTH - z;
  const toFloor = y;
  const toCeiling = HALL_HEIGHT - y;

  let ao = 1;
  // A surface is not occluded by the plane it lies in: skip the edge whose
  // distance is measured along its own normal.
  const facingFloor = normal[1] > 0.7;
  const facingCeiling = normal[1] < -0.7;
  const facingX = Math.abs(normal[0]) > 0.7;
  const facingZ = Math.abs(normal[2]) > 0.7;

  if (!facingFloor) ao *= edgeOcclusion(toFloor, 0.34, 0.42);
  if (!facingCeiling && role !== "dome") ao *= edgeOcclusion(toCeiling, 0.3, 0.55);
  if (!facingX) {
    ao *= edgeOcclusion(toWestWall, 0.3, 0.5);
    ao *= edgeOcclusion(toEastWall, 0.3, 0.5);
  }
  if (!facingZ) {
    ao *= edgeOcclusion(toNorthWall, 0.3, 0.5);
    ao *= edgeOcclusion(toSouthWall, 0.3, 0.5);
  }

  if (role === "wall" || role === "detail") {
    // Bevels and moulding facets: faces tilted away from the room's axes sit
    // in the shadow of the surfaces they turn from, and faces turned down
    // lose the light that comes from above.
    const alignment = Math.max(Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2]));
    ao *= 0.6 + 0.4 * alignment * alignment;
    if (normal[1] < -0.25) ao *= 0.82;
  }
  if (role === "wall") {
    // Shadow lines under the dado's cap rail, the frieze ledge and the
    // cornice, and the darker head of the attic panelling.
    const belowRail = HALL_ELEVATION.dadoTop - y;
    if (belowRail > 0) ao *= 1 - 0.16 * Math.exp(-belowRail / 0.06);
    const belowLedge = HALL_ELEVATION.ledgeBottom - y;
    if (belowLedge > 0 && y > HALL_ELEVATION.dadoTop) ao *= 1 - 0.18 * Math.exp(-belowLedge / 0.05);
    const belowCornice = HALL_ELEVATION.inscriptionTop - y;
    if (belowCornice > 0 && y > HALL_ELEVATION.friezeTop) ao *= 1 - 0.18 * Math.exp(-belowCornice / 0.05);
    const belowCeiling = HALL_HEIGHT - y;
    if (y > HALL_ELEVATION.corniceTop) ao *= 1 - 0.22 * Math.exp(-belowCeiling / 0.16);
  }
  if (role === "dome") {
    // The dome's drum shades the shallow crown less than its springing.
    const rise = Math.max(0, y - HALL_HEIGHT);
    ao *= 0.86 + 0.14 * clamp01(rise / 1.6);
  }
  return clamp01(ao);
}

// ---------------------------------------------------------------------------
// Chandeliers as soft point lights
// ---------------------------------------------------------------------------

/** Relative output of a chandelier: the great gilt one carries about twice the lamps. */
export function chandelierScale(chandelier: HallChandelier): number {
  return chandelier.style === "gilt-leaf" ? 1.45 : 1.0;
}

/** Each chandelier's position and power, read once: the bake samples them for every vertex. */
const CHANDELIER_SOURCES: readonly { readonly x: number; readonly y: number; readonly z: number; readonly power: number }[] =
  HALL_CHANDELIERS.map((chandelier) => {
    const scale = chandelierScale(chandelier);
    return { x: chandelier.position[0], y: chandelier.position[1], z: chandelier.position[2], power: CHANDELIER_POWER * scale * scale };
  });

export function hallChandelierIrradiance(point: Vec3, normal: Vec3): number {
  const [px, py, pz] = point;
  const [nx, ny, nz] = normal;
  let total = 0;
  for (const source of CHANDELIER_SOURCES) {
    const tx = source.x - px;
    const ty = source.y - py;
    const tz = source.z - pz;
    const distanceSq = tx * tx + ty * ty + tz * tz;
    const distance = Math.sqrt(distanceSq);
    if (distance < 1e-4) continue;
    const cosine = (nx * tx + ny * ty + nz * tz) / distance;
    if (cosine <= 0) continue;
    // Light leaving the chandelier upward is partly blocked by its own frame.
    const upward = -ty / distance > 0 ? CHANDELIER_UPWARD_FRACTION : 1;
    total += (source.power * upward * cosine) / (distanceSq + CHANDELIER_SOFT_RADIUS * CHANDELIER_SOFT_RADIUS);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Windows as Lambertian area lights (Lambert's polygon formula)
// ---------------------------------------------------------------------------

/**
 * The glazed light of a window as a convex polygon on the wall face: a sash
 * window's whole opening, or an arched window's central round-headed sash
 * (its bay is blind plaster either side, behind the curtains).
 */
export function openingApertures(opening: HallOpening, segments = 8): Vec3[][] {
  const wall = hallWall(opening.wall);
  const half = opening.width / 2;
  if (opening.kind !== "arched-window") {
    return [[
      wallPoint(wall, opening.centre - half, opening.sill),
      wallPoint(wall, opening.centre + half, opening.sill),
      wallPoint(wall, opening.centre + half, opening.head),
      wallPoint(wall, opening.centre - half, opening.head),
    ]];
  }
  const sashHalf = 0.55;
  const springing = openingTop(opening) - 0.09 - sashHalf;
  const sash: Vec3[] = [
    wallPoint(wall, opening.centre - sashHalf, opening.sill),
    wallPoint(wall, opening.centre + sashHalf, opening.sill),
  ];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI;
    sash.push(wallPoint(wall, opening.centre + Math.cos(angle) * sashHalf, springing + Math.sin(angle) * sashHalf));
  }
  return [sash];
}

/**
 * Clips a polygon to the half-space in front of a receiving surface, so an
 * emitter that straddles the receiver's horizon contributes only the part the
 * receiver can see (Sutherland–Hodgman against one plane).
 */
export function clipPolygonToHemisphere(polygon: readonly Vec3[], point: Vec3, normal: Vec3): Vec3[] {
  const result: Vec3[] = [];
  const epsilon = 1e-5;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    if (current === undefined || next === undefined) continue;
    const dc = dot(sub(current, point), normal) - epsilon;
    const dn = dot(sub(next, point), normal) - epsilon;
    if (dc >= 0) result.push(current);
    if ((dc >= 0) !== (dn >= 0)) {
      const t = dc / (dc - dn);
      result.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
        current[2] + (next[2] - current[2]) * t,
      ]);
    }
  }
  return result;
}

/**
 * The form factor from a receiving point to a uniformly bright polygon lying
 * in front of it, by Lambert's formula F = 1/2π · Σ θᵢ (n · γᵢ). Irradiance is
 * the emitter's radiance × π × F. The polygon is clipped to the receiver's
 * hemisphere first, so any orientation is safe.
 */
export function polygonFormFactor(point: Vec3, normal: Vec3, polygon: readonly Vec3[]): number {
  return flatFormFactor(point[0], point[1], point[2], normal[0], normal[1], normal[2], flatten(polygon));
}

/** A polygon's vertices as flat x, y, z triples. */
function flatten(polygon: readonly Vec3[]): Float64Array {
  const flat = new Float64Array(polygon.length * 3);
  polygon.forEach((vertex, index) => { flat.set(vertex, index * 3); });
  return flat;
}

/** The clipped polygon, reused: one clip emits at most two vertices per edge. */
let clipped = new Float64Array(3 * 32);

/**
 * polygonFormFactor's arithmetic on flat coordinates, allocating nothing:
 * the bake runs it for every vertex against every window, where the tuple
 * version's garbage cost more than its arithmetic.
 */
function flatFormFactor(px: number, py: number, pz: number, nx: number, ny: number, nz: number, polygon: Float64Array): number {
  const count = polygon.length / 3;
  if (clipped.length < count * 6) clipped = new Float64Array(count * 6);
  // Clip to the receiver's hemisphere (Sutherland–Hodgman against one plane).
  const epsilon = 1e-5;
  let visible = 0;
  for (let i = 0; i < count; i++) {
    const c = i * 3;
    const n = ((i + 1) % count) * 3;
    const cx = polygon[c] ?? 0, cy = polygon[c + 1] ?? 0, cz = polygon[c + 2] ?? 0;
    const qx = polygon[n] ?? 0, qy = polygon[n + 1] ?? 0, qz = polygon[n + 2] ?? 0;
    const dc = (cx - px) * nx + (cy - py) * ny + (cz - pz) * nz - epsilon;
    const dn = (qx - px) * nx + (qy - py) * ny + (qz - pz) * nz - epsilon;
    if (dc >= 0) {
      clipped[visible * 3] = cx; clipped[visible * 3 + 1] = cy; clipped[visible * 3 + 2] = cz;
      visible += 1;
    }
    if ((dc >= 0) !== (dn >= 0)) {
      const t = dc / (dc - dn);
      clipped[visible * 3] = cx + (qx - cx) * t;
      clipped[visible * 3 + 1] = cy + (qy - cy) * t;
      clipped[visible * 3 + 2] = cz + (qz - cz) * t;
      visible += 1;
    }
  }
  if (visible < 3) return 0;
  let sum = 0;
  for (let i = 0; i < visible; i++) {
    const a = i * 3;
    const b = ((i + 1) % visible) * 3;
    const ax = (clipped[a] ?? 0) - px, ay = (clipped[a + 1] ?? 0) - py, az = (clipped[a + 2] ?? 0) - pz;
    const bx = (clipped[b] ?? 0) - px, by = (clipped[b + 1] ?? 0) - py, bz = (clipped[b + 2] ?? 0) - pz;
    const la = Math.sqrt(ax * ax + ay * ay + az * az);
    const lb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cosTheta = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
    const theta = Math.acos(cosTheta);
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const lc = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (lc < 1e-9) continue;
    sum += theta * ((nx * cx + ny * cy + nz * cz) / lc);
  }
  // The winding is not known in advance; a form factor is never negative.
  return Math.min(1, Math.abs(sum) / (2 * Math.PI));
}

const APERTURES: readonly Float64Array[] = HALL_OPENINGS
  .filter(isWindow)
  .flatMap((opening) => openingApertures(opening))
  .map(flatten);

/** Converts the windows' summed form factor to the stored channel's scale. */
const DAYLIGHT_GAIN = DAYLIGHT_RADIANCE * 4;

export function hallDaylightIrradiance(point: Vec3, normal: Vec3): number {
  // Points on the window wall itself see no window face.
  if (point[2] <= -HALL_HALF_WIDTH + 1e-3) return 0;
  const [px, py, pz] = point;
  const [nx, ny, nz] = normal;
  let total = 0;
  for (const aperture of APERTURES) total += flatFormFactor(px, py, pz, nx, ny, nz, aperture);
  return total * DAYLIGHT_GAIN;
}

// ---------------------------------------------------------------------------
// The frieze's concealed uplight
// ---------------------------------------------------------------------------

/**
 * A warm LED strip hidden on the ledge under the frieze washes the frieze
 * and its lettered band, falling off with height and spilling a little onto
 * the attic panelling and the ceiling's margin.
 */
export function hallUplightIrradiance(point: Vec3, normal: Vec3, role: HallSurfaceRole): number {
  const [x, y, z] = point;
  const base = HALL_ELEVATION.friezeBottom;
  if (y < base - 0.02) return 0;
  const toWall = Math.min(
    x + HALL_HALF_LENGTH,
    HALL_HALF_LENGTH - x,
    z + HALL_HALF_WIDTH,
    HALL_HALF_WIDTH - z,
  );
  const proximity = Math.exp(-toWall / (role === "wall" ? 0.25 : 0.7));
  const height = y - base;
  const falloff = Math.exp(-height / 1.0) * (1 - Math.exp(-(height + 0.02) / 0.05));
  const facing = role === "wall" ? 1 : Math.max(0, -normal[1]) * 0.55 + 0.2;
  return UPLIGHT_POWER * 4 * proximity * falloff * facing;
}

// ---------------------------------------------------------------------------
// Combined sample
// ---------------------------------------------------------------------------

export function sampleHallLight(point: Vec3, normal: Vec3, role: HallSurfaceRole): HallLightSample {
  return {
    ao: hallAmbientOcclusion(point, normal, role),
    chandelier: Math.max(0, hallChandelierIrradiance(point, normal)),
    daylight: Math.max(0, hallDaylightIrradiance(point, normal)),
    uplight: Math.max(0, hallUplightIrradiance(point, normal, role)),
  };
}

/** Whether a wall-local point lies inside an opening's clear outline. */
export function isInsideOpening(opening: HallOpening, u: number, v: number): boolean {
  if (v < opening.sill) return false;
  const head = openingHeadAt(opening, u);
  return head !== null && v <= head;
}
