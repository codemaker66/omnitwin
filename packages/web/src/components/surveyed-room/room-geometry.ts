// ---------------------------------------------------------------------------
// A surveyed room's surfaces, as plain typed arrays
//
// Built from the record (survey-record.ts), the outline's frame
// (room-frame.ts) and the measured reliefs (relief-container.ts), with no
// renderer: positions in the planner frame, unit normals, texture coordinates
// and indices, ready to become one geometry per surface.
//
//   - A wall is its relief entry placed on its frame: (u, v, depth) goes to
//     origin + tangent·u + up·v + normal·depth, as the Grand Hall's walls are
//     (grand-hall/hall-walls.ts), and takes its colour from the wall atlas at
//     (u, v) whatever its depth: the elevations were photographed along the
//     wall's normal (room-atlas.ts). Without a relief entry it is one flat
//     quad to the wall's height.
//   - The ceiling is its relief, u = planner x, v = planner z and depth
//     measured down from the reference height; or, without one, the outline
//     at the room's ceiling height. Its photograph covers `ceiling.extent`.
//   - The floor is the outline, triangulated (an outline need not be convex)
//     at y = 0. Its photograph covers `floor.extent`.
//
// Every triangle faces the room: counter-clockwise seen from inside it, which
// is three's front face. Drawn front faces only, a wall or the ceiling is
// seen from inside and vanishes from outside, so a camera orbiting the room
// looks into it. The tools wind a relief counter-clockwise seen from the room
// (a wall) or from below (a ceiling); a relief wound the other way would draw
// as nothing at all, so it is refused here with its name.
//
// Overhead photographs have their columns along planner +x and their rows
// from planner +z: the image's top row, texture v = 1, is the extent's
// highest z (survey-record.ts OVERHEAD_ORIENTATION; the Grand Hall's floorUv
// and ceilingUv are the same rule).
// ---------------------------------------------------------------------------

import type { ReliefMesh } from "./relief-container.js";
import { roomAtlasUv } from "./room-atlas.js";
import { outlineArea, type PlanPoint, type RoomFrame, type Vec3, type WallFrame } from "./room-frame.js";
import type { SurveyAtlas, SurveyExtent, SurveyRecord, SurveyWall } from "./survey-record.js";

/** One drawn surface. */
export interface SurfaceGeometry {
  /** Planner position per vertex (x, y, z), metres. */
  readonly positions: Float32Array;
  /** Unit normal per vertex, towards the room. */
  readonly normals: Float32Array;
  /** Texture coordinates per vertex (origin bottom-left, as three samples). */
  readonly uvs: Float32Array;
  /** Three per triangle, counter-clockwise seen from the room. */
  readonly indices: Uint32Array;
}

/** One wall of the outline. */
export interface WallGeometry extends SurfaceGeometry {
  /** Index of the wall in the record, and of its outline segment. */
  readonly wall: number;
  readonly id: string;
  /** Whether it is the measured relief; false for the flat fallback. */
  readonly measured: boolean;
}

/** Where one wall lies in the walls' shared arrays. */
export interface WallRun {
  readonly wall: number;
  readonly id: string;
  readonly measured: boolean;
  readonly vertexStart: number;
  readonly vertexCount: number;
  readonly indexStart: number;
  readonly indexCount: number;
}

/** Every wall in one set of arrays, so the walls are one draw. */
export interface WallsGeometry extends SurfaceGeometry {
  /**
   * Each vertex's own wall's normal, (x, z): the direction its photograph was
   * taken along, by which a material tells the faces the photograph saw
   * edge-on (room-materials.ts).
   */
  readonly wallNormals: Float32Array;
  /** Each wall's run of the arrays, in record order. */
  readonly runs: readonly WallRun[];
}

export interface CeilingGeometry extends SurfaceGeometry {
  /** Whether it is the measured relief; false for the flat ceiling. */
  readonly measured: boolean;
}

export interface RoomGeometry {
  readonly walls: WallsGeometry;
  readonly ceiling: CeilingGeometry;
  readonly floor: SurfaceGeometry;
}

/** A room's measured reliefs, as read from its files. */
export interface RoomReliefs {
  /** The walls' entries by relief id; null draws every wall flat. */
  readonly walls: ReadonlyMap<string, ReliefMesh> | null;
  /** The ceiling's entry; null draws the ceiling flat at the room's height. */
  readonly ceiling: ReliefMesh | null;
}

/** A surface that cannot be built from what the record and its files give. */
export class RoomGeometryError extends Error {
  constructor(message: string) {
    super(`Surveyed room geometry: ${message}`);
    this.name = "RoomGeometryError";
  }
}

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];

/** Where a relief's (u, v, depth) lies in the planner frame: origin + u·U + v·V + depth·D. */
interface ReliefPlacement {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly depth: Vec3;
}

/**
 * A relief placed in the planner frame, with area-weighted vertex normals.
 * Refuses one whose triangles, taken together, face away from the room.
 */
function placeRelief(mesh: ReliefMesh, place: ReliefPlacement, uvOf: (u: number, v: number) => readonly [number, number], label: string): SurfaceGeometry {
  const local = mesh.positions;
  const indices = mesh.indices;
  const count = local.length / 3;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const { origin, u: U, v: V, depth: D } = place;
  for (let i = 0; i < count; i++) {
    const u = local[i * 3] ?? 0;
    const v = local[i * 3 + 1] ?? 0;
    const depth = local[i * 3 + 2] ?? 0;
    positions[i * 3] = origin[0] + U[0] * u + V[0] * v + D[0] * depth;
    positions[i * 3 + 1] = origin[1] + U[1] * u + V[1] * v + D[1] * depth;
    positions[i * 3 + 2] = origin[2] + U[2] * u + V[2] * v + D[2] * depth;
    const [s, t] = uvOf(u, v);
    uvs[i * 2] = s;
    uvs[i * 2 + 1] = t;
  }
  // Each triangle's (u, v, depth) cross product: its area and the way it
  // faces. Its depth part is twice the triangle's area as the photograph saw
  // it, positive when it is wound counter-clockwise seen from the room. A
  // simplified height field keeps a few slivers folded back on its steps
  // (1.5% of the Grand Hall's triangles, 0.1% of its relief by area), so the winding is judged on
  // the whole: the parts add up to the surface seen once from the room.
  const sums = new Float64Array(count * 3);
  let facing = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = (indices[t] ?? 0) * 3;
    const b = (indices[t + 1] ?? 0) * 3;
    const c = (indices[t + 2] ?? 0) * 3;
    const abU = (local[b] ?? 0) - (local[a] ?? 0);
    const abV = (local[b + 1] ?? 0) - (local[a + 1] ?? 0);
    const abD = (local[b + 2] ?? 0) - (local[a + 2] ?? 0);
    const acU = (local[c] ?? 0) - (local[a] ?? 0);
    const acV = (local[c + 1] ?? 0) - (local[a + 1] ?? 0);
    const acD = (local[c + 2] ?? 0) - (local[a + 2] ?? 0);
    const nU = abV * acD - abD * acV;
    const nV = abD * acU - abU * acD;
    const nD = abU * acV - abV * acU;
    facing += nD;
    for (const k of [a, b, c]) {
      sums[k] = (sums[k] ?? 0) + nU;
      sums[k + 1] = (sums[k + 1] ?? 0) + nV;
      sums[k + 2] = (sums[k + 2] ?? 0) + nD;
    }
  }
  if (indices.length > 0 && !(facing > 0)) {
    throw new RoomGeometryError(`${label} is wound clockwise seen from the room, so none of it would be drawn; the tools wind a relief counter-clockwise seen from the room`);
  }
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const nU = sums[i * 3] ?? 0;
    const nV = sums[i * 3 + 1] ?? 0;
    const nD = sums[i * 3 + 2] ?? 0;
    const length = Math.hypot(nU, nV, nD);
    // A vertex no triangle uses, or whose triangles cancel, faces as its surface does.
    const k: Vec3 = length > 1e-12 ? [nU / length, nV / length, nD / length] : [0, 0, 1];
    normals[i * 3] = U[0] * k[0] + V[0] * k[1] + D[0] * k[2];
    normals[i * 3 + 1] = U[1] * k[0] + V[1] * k[1] + D[1] * k[2];
    normals[i * 3 + 2] = U[2] * k[0] + V[2] * k[1] + D[2] * k[2];
  }
  return { positions, normals, uvs, indices: Uint32Array.from(indices) };
}

/** A wall's strip in the atlas: what places a wall-local point in the atlas's image. */
export type AtlasPlacement = Pick<SurveyAtlas, "size" | "ppm" | "vRange">;

/**
 * One wall: its relief on its frame, coloured from the atlas by projection
 * along the wall's normal; without a relief, one flat quad to its height.
 */
export function buildWallGeometry(
  frame: WallFrame, wall: Pick<SurveyWall, "id" | "height" | "atlas">, atlas: AtlasPlacement, relief: ReliefMesh | null,
): WallGeometry {
  const uvOf = (u: number, v: number): readonly [number, number] => roomAtlasUv(atlas, wall, u, v);
  if (relief === null) {
    // The segment's own two vertices, at the floor and at the wall's height: exactly the corners
    // the floor and its neighbours have, counter-clockwise seen from the room (u = 0 at the end vertex).
    const corners: readonly (readonly [PlanPoint, number, number])[] = [
      [frame.end, 0, 0], [frame.start, frame.length, 0], [frame.start, frame.length, wall.height], [frame.end, 0, wall.height],
    ];
    const positions = new Float32Array(12);
    const normals = new Float32Array(12);
    const uvs = new Float32Array(8);
    corners.forEach(([[x, z], u, v], i) => {
      positions.set([x, v, z], i * 3);
      normals.set(frame.normal, i * 3);
      uvs.set(uvOf(u, v), i * 2);
    });
    return { positions, normals, uvs, indices: Uint32Array.from([0, 1, 2, 0, 2, 3]), wall: frame.index, id: wall.id, measured: false };
  }
  const place: ReliefPlacement = { origin: frame.origin, u: frame.tangent, v: UP, depth: frame.normal };
  return { ...placeRelief(relief, place, uvOf, `wall "${wall.id}"'s relief`), wall: frame.index, id: wall.id, measured: true };
}

/** Every wall of the record, in one set of arrays. */
export function buildWallsGeometry(
  record: Pick<SurveyRecord, "walls" | "atlas">, frame: RoomFrame, relief: ReadonlyMap<string, ReliefMesh> | null,
): WallsGeometry {
  if (record.walls.length !== frame.walls.length) {
    throw new RoomGeometryError(`the record has ${String(record.walls.length)} walls but the outline frames ${String(frame.walls.length)}`);
  }
  const built = record.walls.map((wall, index): { readonly wall: WallGeometry; readonly normal: Vec3 } => {
    const wallFrame = frame.walls[index];
    if (wallFrame === undefined) throw new RoomGeometryError(`wall "${wall.id}" has no outline segment`);
    return { wall: buildWallGeometry(wallFrame, wall, record.atlas, relief?.get(wall.reliefId) ?? null), normal: wallFrame.normal };
  });
  const vertexTotal = built.reduce((sum, { wall }) => sum + wall.positions.length / 3, 0);
  const indexTotal = built.reduce((sum, { wall }) => sum + wall.indices.length, 0);
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const wallNormals = new Float32Array(vertexTotal * 2);
  const indices = new Uint32Array(indexTotal);
  const runs: WallRun[] = [];
  let vertexStart = 0;
  let indexStart = 0;
  for (const { wall, normal } of built) {
    const vertexCount = wall.positions.length / 3;
    positions.set(wall.positions, vertexStart * 3);
    normals.set(wall.normals, vertexStart * 3);
    uvs.set(wall.uvs, vertexStart * 2);
    for (let i = 0; i < vertexCount; i++) {
      wallNormals[(vertexStart + i) * 2] = normal[0];
      wallNormals[(vertexStart + i) * 2 + 1] = normal[2];
    }
    for (let i = 0; i < wall.indices.length; i++) indices[indexStart + i] = (wall.indices[i] ?? 0) + vertexStart;
    runs.push({ wall: wall.wall, id: wall.id, measured: wall.measured, vertexStart, vertexCount, indexStart, indexCount: wall.indices.length });
    vertexStart += vertexCount;
    indexStart += wall.indices.length;
  }
  return { positions, normals, uvs, indices, wallNormals, runs };
}

/** Texture coordinates of planner (x, z) in an overhead photograph covering `extent`. */
export function overheadUv(extent: SurveyExtent, x: number, z: number): [number, number] {
  const [x0, x1] = extent.x;
  const [z0, z1] = extent.z;
  // Columns run with planner x; the image's top row (v = 1) is the highest z.
  return [(x - x0) / (x1 - x0), (z - z0) / (z1 - z0)];
}

/**
 * Whether a → b → c turns left seen from above (the way an outline winds),
 * as twice the triangle's area: positive for a left turn.
 */
function turn(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
}

/** Twice-areas at or below this are a straight run, not a corner (square metres). */
const STRAIGHT = 1e-10;

/**
 * An outline cut into triangles by clipping ears: indices into the outline,
 * three per triangle, each counter-clockwise seen from above like the outline
 * itself. The outline is a simple polygon and need not be convex. A vertex on
 * a straight run joins no triangle of its own.
 */
export function triangulateOutline(outline: readonly PlanPoint[]): Uint32Array {
  const at = (index: number): PlanPoint => {
    const point = outline[index];
    if (point === undefined) throw new RoomGeometryError("the outline lost a vertex while being triangulated");
    return point;
  };
  const remaining = outline.map((_, index) => index);
  const triangles: number[] = [];
  const corner = (k: number): readonly [number, number, number] => {
    const count = remaining.length;
    return [remaining[(k + count - 1) % count] ?? 0, remaining[k] ?? 0, remaining[(k + 1) % count] ?? 0];
  };
  while (remaining.length > 3) {
    let clipped = false;
    for (let k = 0; k < remaining.length && !clipped; k++) {
      const [ia, ib, ic] = corner(k);
      const a = at(ia);
      const b = at(ib);
      const c = at(ic);
      // An ear is a left turn that holds no other vertex, inside it or on its edge.
      if (turn(a, b, c) <= STRAIGHT) continue;
      const holdsAnother = remaining.some((j) => {
        if (j === ia || j === ib || j === ic) return false;
        const p = at(j);
        return turn(a, b, p) >= -STRAIGHT && turn(b, c, p) >= -STRAIGHT && turn(c, a, p) >= -STRAIGHT;
      });
      if (holdsAnother) continue;
      triangles.push(ia, ib, ic);
      remaining.splice(k, 1);
      clipped = true;
    }
    if (clipped) continue;
    // No ear left to clip: a vertex on a straight run can go without a triangle.
    const straight = remaining.findIndex((_, k) => {
      const [ia, ib, ic] = corner(k);
      return Math.abs(turn(at(ia), at(ib), at(ic))) <= STRAIGHT;
    });
    if (straight === -1) throw new RoomGeometryError("the outline could not be triangulated (it is not a simple polygon wound counter-clockwise)");
    remaining.splice(straight, 1);
  }
  const [ia, ib, ic] = corner(1);
  if (remaining.length === 3 && turn(at(ia), at(ib), at(ic)) > STRAIGHT) triangles.push(ia, ib, ic);
  let covered = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    covered += turn(at(triangles[t] ?? 0), at(triangles[t + 1] ?? 0), at(triangles[t + 2] ?? 0)) / 2;
  }
  const area = outlineArea(outline);
  if (Math.abs(covered - area) > 1e-9 * Math.max(1, area)) {
    throw new RoomGeometryError(`the outline's triangles cover ${covered.toFixed(6)} m² of its ${area.toFixed(6)} m²`);
  }
  return Uint32Array.from(triangles);
}

/** The outline as a flat surface at height `y`, facing up or down. */
function outlineSurface(outline: readonly PlanPoint[], y: number, facing: "up" | "down", extent: SurveyExtent): SurfaceGeometry {
  const count = outline.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const normal = facing === "up" ? UP : DOWN;
  outline.forEach(([x, z], i) => {
    positions.set([x, y, z], i * 3);
    normals.set(normal, i * 3);
    uvs.set(overheadUv(extent, x, z), i * 2);
  });
  const indices = triangulateOutline(outline);
  if (facing === "down") {
    // Seen from below, the outline's own winding runs clockwise: turn each triangle over.
    for (let t = 0; t < indices.length; t += 3) {
      const second = indices[t + 1] ?? 0;
      indices[t + 1] = indices[t + 2] ?? 0;
      indices[t + 2] = second;
    }
  }
  return { positions, normals, uvs, indices };
}

/** The floor: the outline at y = 0, facing up, under its photograph's extent. */
export function buildFloorGeometry(record: Pick<SurveyRecord, "floor">, frame: Pick<RoomFrame, "outline">): SurfaceGeometry {
  return outlineSurface(frame.outline, 0, "up", record.floor.extent);
}

/**
 * The ceiling: its measured relief, or without one the outline at the room's
 * ceiling height; facing down, under its photograph's extent.
 */
export function buildCeilingGeometry(
  record: Pick<SurveyRecord, "ceiling" | "room">, frame: Pick<RoomFrame, "outline">, relief: ReliefMesh | null,
): CeilingGeometry {
  const { extent } = record.ceiling;
  const described = record.ceiling.relief;
  if (relief === null || described === undefined) {
    return { ...outlineSurface(frame.outline, record.room.ceilingHeight, "down", extent), measured: false };
  }
  // u = planner x, v = planner z, and depth is measured down from the reference height.
  const place: ReliefPlacement = { origin: [0, described.reference, 0], u: [1, 0, 0], v: [0, 0, 1], depth: DOWN };
  return { ...placeRelief(relief, place, (x, z) => overheadUv(extent, x, z), "the ceiling's relief"), measured: true };
}

/** Every surface of a room. */
export function buildRoomGeometry(record: SurveyRecord, frame: RoomFrame, reliefs: RoomReliefs): RoomGeometry {
  return {
    walls: buildWallsGeometry(record, frame, reliefs.walls),
    ceiling: buildCeilingGeometry(record, frame, reliefs.ceiling),
    floor: buildFloorGeometry(record, frame),
  };
}

export interface SurfaceBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The box holding every vertex of the surfaces given. */
export function surfaceBounds(...surfaces: readonly Pick<SurfaceGeometry, "positions">[]): SurfaceBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of surfaces) {
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      const value = positions[i] ?? 0;
      if (value < (min[axis] ?? 0)) min[axis] = value;
      if (value > (max[axis] ?? 0)) max[axis] = value;
    }
  }
  return { min, max };
}
