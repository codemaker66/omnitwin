// ---------------------------------------------------------------------------
// The first reflections off a room's walls, floor and ceiling (T-677).
//
// The image-source method: a sound reflected by a flat surface arrives as if
// from the source's mirror image behind it. First order mirrors the source in
// each wall edge of the room's outline (kept only where the bounce lands on
// that edge), the floor and the ceiling. In a rectangular room the second
// order adds floor and ceiling with each wall, and each pair of opposite
// walls; in any other outline each real wall bounce gains its floor partner
// (wall and floor). Each reflection's delay and gain are relative to the direct sound,
// so the renderer mixes them in behind it.
// ---------------------------------------------------------------------------

import type { RoomGeometry } from "../../data/room-geometries.js";
import { AIR_ATTENUATION_PER_M, SURFACE_ABSORPTION, type SurfaceMaterialId } from "./acoustic-data.js";
import { bandMap, type BandValues } from "./bands.js";
import type { RoomAcoustics, RoomSurface } from "./rooms.js";

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export interface Reflection {
  /** Seconds after the direct sound. */
  readonly delaySeconds: number;
  /** Amplitude per band, relative to the direct path's. */
  readonly gain: BandValues;
  /** Left (negative) or right (positive) of the ear, in radians, with the direct sound ahead. */
  readonly azimuthRad: number;
  readonly order: 1 | 2;
}

/** A room as its reflections see it: its outline and one material each for walls, floor and ceiling. */
export interface ReflectionRoom {
  readonly geometry: RoomGeometry;
  readonly wall: SurfaceMaterialId;
  readonly floor: SurfaceMaterialId;
  readonly ceiling: SurfaceMaterialId;
}

/** A first-order wall bounce: the edge it comes off, where it lands, and the source's image. */
export interface WallReflection {
  readonly edge: number;
  readonly point: Vec3;
  readonly image: Vec3;
}

type Polygon = RoomGeometry["wallPolygon"];
type Ear = { readonly position: Vec3; readonly right: Vec3 };

interface EdgeLine {
  /** The edge's start. */
  readonly ax: number;
  readonly az: number;
  /** From its start to its end. */
  readonly ex: number;
  readonly ez: number;
  /** Its unit normal in the floor plane. */
  readonly nx: number;
  readonly nz: number;
}

const SPEED_OF_SOUND_M_PER_S = 343;
const EPSILON = 1e-9;
/** How far from square a corner may be and still count as a rectangle's, as a cosine. */
const RIGHT_ANGLE_TOLERANCE = 1e-6;

/** What a room reflects as when its survey names no surface of a role. */
const FALLBACK_MATERIAL: Readonly<Record<"floor" | "wall" | "ceiling", SurfaceMaterialId>> = {
  floor: "oak-boards-joists",
  wall: "plaster-masonry",
  ceiling: "plaster-lath",
};

function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** The edge from vertex `i` to the next, or null when it has no length. */
function edgeLine(polygon: Polygon, i: number): EdgeLine | null {
  const a = polygon[i];
  const b = polygon[(i + 1) % polygon.length];
  if (a === undefined || b === undefined) return null;
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const span = Math.hypot(ex, ez);
  if (span < EPSILON) return null;
  return { ax: a[0], az: a[1], ex, ez, nx: -ez / span, nz: ex / span };
}

/** How far `p` is from the edge's line, signed by side. */
function sideOf(line: EdgeLine, p: Vec3): number {
  return (p.x - line.ax) * line.nx + (p.z - line.az) * line.nz;
}

/** `p` mirrored in the vertical plane through edge `i`, or null for an edge with no length. */
function mirrorInEdge(p: Vec3, polygon: Polygon, i: number): Vec3 | null {
  const line = edgeLine(polygon, i);
  if (line === null) return null;
  const d = sideOf(line, p);
  return { x: p.x - 2 * d * line.nx, y: p.y, z: p.z - 2 * d * line.nz };
}

/** `p` mirrored in the horizontal plane at height `y`. */
function mirrorInHeight(p: Vec3, y: number): Vec3 {
  return { x: p.x, y: 2 * y - p.y, z: p.z };
}

/**
 * The first-order wall bounces, walking the outline's edges in order. An edge
 * counts only when the source and the ear are on the same side of its line
 * and the bounce lands within the edge itself.
 */
export function wallReflections(polygon: Polygon, source: Vec3, ear: Vec3): readonly WallReflection[] {
  const found: WallReflection[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const line = edgeLine(polygon, i);
    if (line === null) continue;
    const sourceSide = sideOf(line, source);
    const earSide = sideOf(line, ear);
    if (sourceSide * earSide < 0 || Math.abs(sourceSide + earSide) < EPSILON) continue;
    // From the ear towards the image, the edge's line is crossed this fraction of the way.
    const s = earSide / (sourceSide + earSide);
    const image = { x: source.x - 2 * sourceSide * line.nx, y: source.y, z: source.z - 2 * sourceSide * line.nz };
    const point = {
      x: ear.x + s * (image.x - ear.x),
      y: ear.y + s * (image.y - ear.y),
      z: ear.z + s * (image.z - ear.z),
    };
    const along = ((point.x - line.ax) * line.ex + (point.z - line.az) * line.ez) / (line.ex ** 2 + line.ez ** 2);
    if (along < 0 || along > 1) continue;
    found.push({ edge: i, point, image });
  }
  return found;
}

/** Whether the outline is a rectangle: four edges meeting at right angles. */
function isRectangle(polygon: Polygon): boolean {
  if (polygon.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const a = edgeLine(polygon, i);
    const b = edgeLine(polygon, (i + 1) % 4);
    if (a === null || b === null) return false;
    const cosine = (a.ex * b.ex + a.ez * b.ez) / (Math.hypot(a.ex, a.ez) * Math.hypot(b.ex, b.ez));
    if (Math.abs(cosine) > RIGHT_ANGLE_TOLERANCE) return false;
  }
  return true;
}

/** Whether `p` lies inside a convex outline, or on its edge. */
function insideConvex(polygon: Polygon, p: Vec3): boolean {
  let cx = 0, cz = 0;
  for (const [x, z] of polygon) {
    cx += x;
    cz += z;
  }
  const centre = { x: cx / polygon.length, y: 0, z: cz / polygon.length };
  for (let i = 0; i < polygon.length; i += 1) {
    const line = edgeLine(polygon, i);
    if (line === null) return false;
    if (sideOf(line, p) * sideOf(line, centre) < 0) return false;
  }
  return true;
}

/**
 * The lateral angle of `direction` as heard by an ear facing level and square
 * to `right` (ahead is up × right): sin(azimuth) is exactly the unit
 * direction's part along the unit right, positive to the right. A direction
 * behind the ear reads beyond ±90°, mirrored about the ear's axis. A zero
 * right is taken as +x, and a zero direction reads 0.
 */
export function lateralAzimuth(direction: Vec3, right: Vec3): number {
  const rightLength = length(right);
  const r = rightLength > EPSILON ? scale(right, 1 / rightLength) : { x: 1, y: 0, z: 0 };
  const directionLength = length(direction);
  if (directionLength <= EPSILON) return 0;
  const d = scale(direction, 1 / directionLength);
  // Rounding can carry the cosine a hair past 1.
  const side = Math.min(1, Math.max(-1, dot(d, r)));
  const lateral = Math.asin(side);
  let ahead: Vec3 = { x: r.z, y: 0, z: -r.x };
  if (length(ahead) <= EPSILON) ahead = { x: 0, y: 0, z: -1 };
  if (dot(d, ahead) >= 0) return lateral;
  return side >= 0 ? Math.PI - lateral : -Math.PI - lateral;
}

/**
 * The first and second reflections of `source` as heard at `ear`. Gains are
 * the path ratio (direct ÷ reflected length), times √(1 − α) per bounce in each
 * band, times the air's loss over the extra path. Azimuth is the image's
 * `lateralAzimuth` from the ear.
 *
 * An image counts only where its bounce is real: a wall's when the source and
 * the ear are on the same side of it and the bounce lands between floor and
 * ceiling, the floor's and ceiling's when both are
 * between the two, and a rectangle's second bounces when both are inside the
 * room. Outside a rectangle, each real wall bounce has its floor partner (wall
 * and floor) when both are between floor and ceiling: for a source on the
 * floor it arrives with its wall bounce. Any other image is dropped, never
 * reshaped.
 */
export function earlyReflections(room: ReflectionRoom, source: Vec3, ear: Ear): readonly Reflection[] {
  if (!isFiniteVec(source) || !isFiniteVec(ear.position) || !isFiniteVec(ear.right)) return [];
  const polygon = room.geometry.wallPolygon;
  const height = room.geometry.ceilingHeight;
  const direct = length(sub(source, ear.position));
  const reflections: Reflection[] = [];

  const add = (image: Vec3 | null, bounces: readonly SurfaceMaterialId[], order: 1 | 2): void => {
    if (image === null) return;
    const towards = sub(image, ear.position);
    const path = length(towards);
    // An image at the ear itself has no direction to arrive from.
    if (path <= EPSILON) return;
    const extra = path - direct;
    const ratio = direct / path;
    const gain = bandMap(AIR_ATTENUATION_PER_M, (m, band) => {
      let reflectance = 1;
      for (const material of bounces) {
        reflectance *= Math.sqrt(Math.max(0, 1 - (SURFACE_ABSORPTION[material][band] ?? 0)));
      }
      return ratio * reflectance * Math.exp((-m * extra) / 2);
    });
    reflections.push({
      delaySeconds: extra / SPEED_OF_SOUND_M_PER_S,
      gain,
      azimuthRad: lateralAzimuth(towards, ear.right),
      order,
    });
  };

  const betweenFloorAndCeiling = (p: Vec3): boolean => p.y >= 0 && p.y <= height;
  const heightsValid = betweenFloorAndCeiling(source) && betweenFloorAndCeiling(ear.position);
  const rectangle = isRectangle(polygon);

  for (const bounce of wallReflections(polygon, source, ear.position)) {
    // A bounce above the ceiling or below the floor is off the wall.
    if (!betweenFloorAndCeiling(bounce.point)) continue;
    add(bounce.image, [room.wall], 1);
    // Every wall bounce also comes back by way of the floor. A rectangle's second order below pairs each wall
    // with the floor already; any other outline pairs each real wall bounce here, so its walls keep their level
    // against a source standing on the floor (whose own floor image joins the direct sound).
    if (!rectangle && heightsValid) add(mirrorInHeight(bounce.image, 0), [room.wall, room.floor], 2);
  }
  if (heightsValid) {
    add(mirrorInHeight(source, 0), [room.floor], 1);
    add(mirrorInHeight(source, height), [room.ceiling], 1);
  }

  if (rectangle && heightsValid && insideConvex(polygon, source) && insideConvex(polygon, ear.position)) {
    for (let i = 0; i < 4; i += 1) {
      const image = mirrorInEdge(source, polygon, i);
      if (image === null) continue;
      add(mirrorInHeight(image, 0), [room.wall, room.floor], 2);
      add(mirrorInHeight(image, height), [room.wall, room.ceiling], 2);
    }
    for (const [i, j] of [[0, 2], [1, 3]] as const) {
      const viaI = mirrorInEdge(source, polygon, i);
      const viaJ = mirrorInEdge(source, polygon, j);
      add(viaI === null ? null : mirrorInEdge(viaI, polygon, j), [room.wall, room.wall], 2);
      add(viaJ === null ? null : mirrorInEdge(viaJ, polygon, i), [room.wall, room.wall], 2);
    }
  }
  return reflections;
}

/** The material covering the most area among `surfaces` of `role`, summed across entries. */
function largestOf(surfaces: readonly RoomSurface[], role: "floor" | "wall" | "ceiling"): SurfaceMaterialId {
  const areas = new Map<SurfaceMaterialId, number>();
  for (const surface of surfaces) {
    if (surface.role !== role) continue;
    areas.set(surface.material, (areas.get(surface.material) ?? 0) + surface.areaM2);
  }
  let best: SurfaceMaterialId = FALLBACK_MATERIAL[role];
  let bestArea = -Infinity;
  for (const [material, area] of areas) {
    if (area > bestArea) {
      best = material;
      bestArea = area;
    }
  }
  return best;
}

/** The reflection room for a surveyed room drawn as `geometry`: the largest material of each role. */
export function reflectionRoomFor(acoustics: RoomAcoustics, geometry: RoomGeometry): ReflectionRoom {
  return {
    geometry,
    wall: largestOf(acoustics.surfaces, "wall"),
    floor: largestOf(acoustics.surfaces, "floor"),
    ceiling: largestOf(acoustics.surfaces, "ceiling"),
  };
}
