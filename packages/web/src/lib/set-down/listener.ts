// ---------------------------------------------------------------------------
// Where a set-down is heard from (T-700).
//
// The planner's camera is often far from the landing, and in Plan and Room
// views above the ceiling, so the ear is not the camera. It stands at a
// standing listener's height, 1.6 m, for every voice (ruling R61), on the
// landing's line towards the camera, 2-6 m from the landing: near enough to
// hear the piece, far enough not to be in it. Walking, it is the walker.
// Before reflections are worked out it is kept inside the drawn room (R19),
// and the direct sound falls as 1/r beyond 2 m (R18).
// ---------------------------------------------------------------------------

import type { RoomGeometry } from "../../data/room-geometries.js";
import { lateralAzimuth, type Vec3 } from "./reflections.js";

/** A standing listener's ear (ruling R61). */
export const EAR_HEIGHT_M = 1.6;
/** The direct sound's gain is 1 at this distance and falls as 1/r beyond it. */
export const REFERENCE_DISTANCE_M = 2;
/** How near and how far from the landing the ear stands. */
export const EAR_REACH_M: { readonly min: number; readonly max: number } = { min: 2, max: 6 };

/** A listener's ear, and the direction to its right (lateralAzimuth's convention). */
export interface Ear {
  readonly position: Vec3;
  readonly right: Vec3;
}

/** How far inside the walls, floor and ceiling the ear is kept (R19). */
const EAR_INSET_M = 0.3;
const EPSILON = 1e-9;
/** A clamped ear counts as inset when it is this close to 0.3 m, so rounding never rejects the wall's own inset line. */
const INSET_TOLERANCE_M = 1e-9;

/** The level part of `right`, made unit length; +z when it has none. */
function levelRight(right: Vec3): Vec3 {
  const length = Math.hypot(right.x, right.z);
  if (!(length > EPSILON) || !Number.isFinite(length)) return { x: 0, y: 0, z: 1 };
  return { x: right.x / length, y: 0, z: right.z / length };
}

/**
 * Where the set-down at `landing` is heard from. Walking, the ear is the
 * camera at 1.6 m. Otherwise it stands at 1.6 m on the level line from the
 * landing towards the camera, as far along it as puts the ear `reach` from
 * the landing, where `reach` is the camera's distance held to
 * `reach.min`-`reach.max`. Its right is the camera's, made level.
 */
export function earFor(
  camera: { readonly position: Vec3; readonly right: Vec3 },
  landing: Vec3,
  walking: boolean,
  reach: { readonly min: number; readonly max: number } = EAR_REACH_M,
): Ear {
  const right = levelRight(camera.right);
  const at = camera.position;
  if (walking) return { position: { x: at.x, y: EAR_HEIGHT_M, z: at.z }, right };
  const away = Math.hypot(at.x - landing.x, at.y - landing.y, at.z - landing.z);
  const held = Math.min(Math.max(away, reach.min), reach.max);
  const along = Math.sqrt(Math.max(0, held ** 2 - (EAR_HEIGHT_M - landing.y) ** 2));
  const flat = Math.hypot(at.x - landing.x, at.z - landing.z);
  // A camera straight above the landing gives no direction: the ear stands over the landing.
  const k = flat > 1e-6 ? along / flat : 0;
  return { position: { x: landing.x + (at.x - landing.x) * k, y: EAR_HEIGHT_M, z: landing.z + (at.z - landing.z) * k }, right };
}

// --- Keeping the ear inside the drawn room -------------------------------------------------------

type Outline = RoomGeometry["wallPolygon"];

interface Point {
  readonly x: number;
  readonly z: number;
}

/** A wall of the outline, and its line moved 0.3 m into the room. */
interface Wall {
  readonly a: Point;
  readonly b: Point;
  readonly insetA: Point;
  readonly insetB: Point;
}

function wallsOf(outline: Outline): readonly Wall[] {
  // The outline's winding says which side of each wall the room is on.
  let twiceArea = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a !== undefined && b !== undefined) twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  const inward = twiceArea >= 0 ? 1 : -1;
  const walls: Wall[] = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a === undefined || b === undefined) continue;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const span = Math.hypot(ex, ez);
    if (!(span > EPSILON)) continue;
    const nx = (-ez / span) * inward * EAR_INSET_M;
    const nz = (ex / span) * inward * EAR_INSET_M;
    walls.push({
      a: { x: a[0], z: a[1] },
      b: { x: b[0], z: b[1] },
      insetA: { x: a[0] + nx, z: a[1] + nz },
      insetB: { x: b[0] + nx, z: b[1] + nz },
    });
  }
  return walls;
}

/** The point of segment a-b nearest `p`. */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const span2 = ex * ex + ez * ez;
  const t = span2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / span2)) : 0;
  return { x: a.x + t * ex, z: a.z + t * ez };
}

/** Whether `p` is inside the outline, by the even-odd rule. */
function insideOutline(outline: Outline, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[i];
    const b = outline[j];
    if (a === undefined || b === undefined) continue;
    if (a[1] > p.z !== b[1] > p.z && p.x < ((b[0] - a[0]) * (p.z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** How far `p` is inside the room from its nearest wall: negative outside. */
function clearance(outline: Outline, walls: readonly Wall[], p: Point): number {
  let nearest = Infinity;
  for (const wall of walls) {
    const q = nearestOnSegment(p, wall.a, wall.b);
    nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z));
  }
  return insideOutline(outline, p) ? nearest : -nearest;
}

/** Where segments a0-a1 and b0-b1 cross, or null. */
function crossing(a0: Point, a1: Point, b0: Point, b1: Point): Point | null {
  const rx = a1.x - a0.x;
  const rz = a1.z - a0.z;
  const sx = b1.x - b0.x;
  const sz = b1.z - b0.z;
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < EPSILON) return null;
  const qx = b0.x - a0.x;
  const qz = b0.z - a0.z;
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { x: a0.x + t * rx, z: a0.z + t * rz };
}

/**
 * The point nearest `p` that is inside the outline and at least 0.3 m from
 * every wall: `p` itself if it is. Otherwise the answer lies on the edge of
 * that inset region, which is made of the walls' lines moved 0.3 m in, the
 * corners where two of those lines cross, and arcs of 0.3 m round the inward
 * corners. Each piece's point nearest `p` is a candidate, and the nearest
 * candidate that is truly 0.3 m in wins. In an outline nowhere 0.6 m wide, the
 * candidate farthest in stands in.
 */
function insetInto(outline: Outline, p: Point): Point {
  const walls = wallsOf(outline);
  if (walls.length < 3 || clearance(outline, walls, p) >= EAR_INSET_M) return p;
  const candidates: Point[] = [];
  for (const wall of walls) candidates.push(nearestOnSegment(p, wall.insetA, wall.insetB));
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const one = walls[i];
      const other = walls[j];
      if (one === undefined || other === undefined) continue;
      const corner = crossing(one.insetA, one.insetB, other.insetA, other.insetB);
      if (corner !== null) candidates.push(corner);
    }
  }
  for (const wall of walls) {
    const away = Math.hypot(p.x - wall.a.x, p.z - wall.a.z);
    if (away > EPSILON) candidates.push({ x: wall.a.x + ((p.x - wall.a.x) * EAR_INSET_M) / away, z: wall.a.z + ((p.z - wall.a.z) * EAR_INSET_M) / away });
  }
  let best: Point | null = null;
  let bestDistance = Infinity;
  let deepest: Point = p;
  let deepestClearance = -Infinity;
  for (const candidate of candidates) {
    const inset = clearance(outline, walls, candidate);
    if (inset > deepestClearance) {
      deepest = candidate;
      deepestClearance = inset;
    }
    if (inset < EAR_INSET_M - INSET_TOLERANCE_M) continue;
    const distance = Math.hypot(candidate.x - p.x, candidate.z - p.z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ?? deepest;
}

/**
 * The ear moved inside the drawn room before reflections are worked out
 * (R19): to the nearest point inside the outline at least 0.3 m from every
 * wall, and between 0.3 m and 0.3 m under the ceiling (half the ceiling's
 * height under a ceiling lower than 0.6 m). An ear already there, an ear
 * with no room (null), and an ear whose position is not a number are left as
 * they are.
 */
export function clampEarToRoom(ear: Ear, geometry: RoomGeometry | null): Ear {
  const { position } = ear;
  if (geometry === null || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return ear;
  const ceiling = geometry.ceilingHeight;
  let y = position.y;
  if (Number.isFinite(ceiling)) {
    y = ceiling < 2 * EAR_INSET_M ? ceiling / 2 : Math.min(ceiling - EAR_INSET_M, Math.max(EAR_INSET_M, position.y));
  }
  const floor = insetInto(geometry.wallPolygon, position);
  if (floor.x === position.x && y === position.y && floor.z === position.z) return ear;
  return { position: { x: floor.x, y, z: floor.z }, right: ear.right };
}

/**
 * The direct sound from `source` at `ear`: its gain, 1 within 2 m and falling
 * as 1/r beyond (the render is made at gain 1 and this goes on the voice's dry
 * gain, ruling R57), its lateral angle (R18), and its length.
 */
export function directPath(ear: Ear, source: Vec3): { readonly gain: number; readonly azimuthRad: number; readonly distanceM: number } {
  const toward: Vec3 = { x: source.x - ear.position.x, y: source.y - ear.position.y, z: source.z - ear.position.z };
  const distanceM = Math.hypot(toward.x, toward.y, toward.z);
  return {
    gain: Math.min(1, REFERENCE_DISTANCE_M / Math.max(distanceM, 1e-6)),
    azimuthRad: lateralAzimuth(toward, ear.right),
    distanceM,
  };
}
