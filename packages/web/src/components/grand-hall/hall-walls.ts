// ---------------------------------------------------------------------------
// The hall's walls, as scanned
//
// Each wall is its measured relief (hall-relief.ts) coloured by its
// orthophoto in the wall atlas, so everything on the walls — the panelled
// dado, the pilasters and their capitals, the doorcases and the clock, the
// portraits in their frames, the deacons' boards, the chimneypiece, the
// curtains in the windows and the glazing behind them — stands where the scan
// found it. Faces take their colour from the atlas by projection along the
// wall's normal, which is how the orthophotos were made. The varnished dado
// and attic panelling are glossy; the plaster and the frieze between them are
// matte.
//
// The doors' leaves are modelled (hall-doors.ts), so they can swing open in
// the cutaway: the relief inside each doorway (the closed leaves the atlas
// photographed, and the main door's recess, closed where the scan saw it
// open) is never drawn (drawnRelief), only the reveals at its jambs. Until
// the relief arrives each wall is a flat photograph, open at its doors.
// ---------------------------------------------------------------------------

import { vec, type MeshBuilder, type V3 } from "./mesh-builder.js";
import type { HallBuilders, HallMaterialKey } from "./hall-builders.js";
import type { WallRelief, WallReliefMesh } from "./hall-relief.js";
import { doorRevealDepth } from "./hall-wall-body.js";
import { HALL_DOORS, HALL_ELEVATION, HALL_OPENINGS, HALL_WALLS, wallPoint, type HallWall, type HallWallId } from "./hall-spec.js";

const E = HALL_ELEVATION;

/**
 * The relief a door's modelled leaves replace, cut away along the doorway's
 * own lines (drawnRelief) rather than by whole triangles, which left slots
 * beside the jambs where a walk saw the night through the wall:
 *
 *   - The shut leaves: every triangle reaching into the leaves' column (the
 *     doorway's clear outline up to LEAF_COLUMN_RISE over the leaves' top,
 *     no more than LEAF_RELIEF_PROUD in front of their face) but the
 *     reveal's sides (faces turned into the doorway, n.u over 0.7 from their
 *     jamb, within REVEAL_SIDE of it) loses what it holds there; the
 *     modelled leaves stand there. The leaves' hardware stands at most
 *     5.3 cm proud of them (the end door's closers; knobs 3.4 cm, the fire
 *     exit's bar 4.8 cm); the doorcases' heads hang 8 cm and more proud over
 *     the leaves' tops, and the fire exit's sign 13 cm, and stay.
 *   - Every triangle reaching into the doorway (between its jambs, under its
 *     head) loses what lies there behind where its reveal stops
 *     (doorRevealDepth, less REVEAL_SIDE_DEPTH): the joint between a shut
 *     leaf's edge and its frame, which the scan saw 9.5 cm deep a centimetre
 *     inside the jamb's line, and the main door's recess, so nothing stands
 *     where an open leaf turns or the body's lining runs. Beyond the jambs
 *     and over the head the relief stays whole: there the body has no face
 *     of its own (the relief is its face), so a hole would see through it.
 *
 * What stays is the photograph in front of those lines: the architrave, the
 * reveal's first centimetres and the doorcase's head, as the walk saw them.
 */
export const DOOR_RELIEF_HEAD = 0.01;
export const REVEAL_SIDE = 0.02;
export const REVEAL_SIDE_DEPTH = 0.005;
export const LEAF_COLUMN_RISE = 0.002;
export const LEAF_RELIEF_PROUD = 0.06;

/** A doorway's clear outline on its wall, up to where its leaves' relief stops, and where its reveal stops. */
export interface DoorOutline {
  readonly opening: string;
  readonly wall: HallWallId;
  readonly u0: number;
  readonly u1: number;
  readonly sill: number;
  readonly top: number;
  readonly head: number;
  readonly reveal: number;
}

export const DOOR_OUTLINES: readonly DoorOutline[] = HALL_DOORS.flatMap((door) => {
  const opening = HALL_OPENINGS.find((candidate) => candidate.id === door.opening);
  if (opening === undefined) return [];
  return [{
    opening: door.opening, wall: opening.wall, u0: opening.centre - opening.width / 2, u1: opening.centre + opening.width / 2,
    sill: opening.sill, top: door.leafTop - DOOR_RELIEF_HEAD, head: opening.head, reveal: doorRevealDepth(door),
  }];
});

/** A wall-local (u, v, depth) point. */
type Corner = readonly [number, number, number];

/** A half-space of wall-local space: sign x (p[axis] - at) > 0. */
export interface ReliefHalfSpace {
  readonly axis: 0 | 1 | 2;
  readonly at: number;
  readonly sign: 1 | -1;
}

/** A box of wall-local space (the intersection of its half-spaces) that the drawn relief keeps nothing of. */
export type ReliefCut = readonly ReliefHalfSpace[];

/** What a doorway takes from a relief triangle near it: the leaves' column (shut leaves only) and the doorway behind its reveal. */
export interface DoorReliefFate {
  readonly door: DoorOutline;
  /** The triangle reaches into the leaves' column and is not a reveal's side: it loses what it holds there. */
  readonly leaf: boolean;
  readonly cuts: readonly ReliefCut[];
}

/** The leaves' column: their whole width and height, from behind them to LEAF_RELIEF_PROUD in front. */
export function leafColumn(door: DoorOutline): ReliefCut {
  return [
    { axis: 0, at: door.u0, sign: 1 }, { axis: 0, at: door.u1, sign: -1 },
    { axis: 1, at: door.top + DOOR_RELIEF_HEAD + LEAF_COLUMN_RISE, sign: -1 },
    { axis: 2, at: door.reveal + LEAF_RELIEF_PROUD, sign: -1 },
  ];
}

/** The doorway (between its jambs, under its head) behind where its reveal stops. */
export function doorwayBehind(door: DoorOutline): ReliefCut {
  return [
    { axis: 0, at: door.u0, sign: 1 }, { axis: 0, at: door.u1, sign: -1 },
    { axis: 1, at: door.head, sign: -1 }, { axis: 2, at: door.reveal - REVEAL_SIDE_DEPTH, sign: -1 },
  ];
}

/** Whether a wall-local point lies inside a cut (strictly, by `slack`). */
export function insideReliefCut(p: Corner, cut: ReliefCut, slack = 0): boolean {
  return cut.every((h) => h.sign * (p[h.axis] - h.at) > slack);
}

/**
 * What the doorway near a relief triangle (wall-local corners) takes from it,
 * or null: none near it, or it misses both of the doorway's cuts.
 */
export function doorReliefFate(wall: HallWallId, corners: readonly Corner[]): DoorReliefFate | null {
  const [a, b, c] = corners;
  if (a === undefined || b === undefined || c === undefined) return null;
  const door = DOOR_OUTLINES.find((outline) => outline.wall === wall
    && corners.some((p) => p[0] > outline.u0 - REVEAL_SIDE && p[0] < outline.u1 + REVEAL_SIDE && p[1] < outline.head + REVEAL_SIDE));
  if (door === undefined) return null;
  const column = leafColumn(door);
  let leaf = touchesCut(corners, column);
  if (leaf) {
    // A reveal's side faces into the doorway, away from its own jamb (a shut
    // leaf's edge, turned to the frame, faces the other way); it keeps what
    // it holds in the leaves' column. Whatever else reaches into the column
    // (the leaves' faces, the architrave's edge) loses it there.
    const u = (a[0] + b[0] + c[0]) / 3;
    const n = vec.cross(vec.sub(b, a), vec.sub(c, a));
    const length = Math.hypot(n[0], n[1], n[2]);
    const fromLow = Math.abs(u - door.u0) < Math.abs(door.u1 - u);
    const intoDoorway = length > 1e-12 && (fromLow ? n[0] : -n[0]) / length > 0.7;
    const nearJamb = Math.min(Math.abs(u - door.u0), Math.abs(door.u1 - u)) < REVEAL_SIDE;
    leaf = !(intoDoorway && nearJamb);
  }
  const cuts = [...(leaf ? [column] : []), doorwayBehind(door)].filter((cut) => touchesCut(corners, cut));
  return cuts.length === 0 ? null : { door, leaf, cuts };
}

/** Whether a convex polygon reaches inside a cut: no one of its half-spaces has the polygon wholly outside. */
function touchesCut(polygon: readonly Corner[], cut: ReliefCut): boolean {
  return cut.every((h) => polygon.some((p) => h.sign * (p[h.axis] - h.at) > 1e-9));
}

/** A convex polygon split by a half-space: its part inside and its part outside (points on the plane go to both). */
function splitPolygon(polygon: readonly Corner[], h: ReliefHalfSpace): { inside: Corner[]; outside: Corner[] } {
  const inside: Corner[] = [];
  const outside: Corner[] = [];
  const side = (p: Corner): number => h.sign * (p[h.axis] - h.at);
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] ?? p;
    const fp = side(p);
    const fq = side(q);
    if (fp >= 0) inside.push(p);
    if (fp <= 0) outside.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const t = fp / (fp - fq);
      const x: Corner = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      inside.push(x);
      outside.push(x);
    }
  });
  return { inside, outside };
}

/** Twice a polygon's area. */
function doubleArea(polygon: readonly Corner[]): number {
  const first = polygon[0];
  if (first === undefined) return 0;
  let sum: Corner = [0, 0, 0];
  for (let i = 1; i + 1 < polygon.length; i++) {
    const b = polygon[i] ?? first;
    const c = polygon[i + 1] ?? first;
    sum = vec.add(sum, vec.cross(vec.sub(b, first), vec.sub(c, first)));
  }
  return Math.hypot(sum[0], sum[1], sum[2]);
}

/** The pieces of a convex polygon outside a cut (each convex). */
export function subtractReliefCut(polygon: readonly Corner[], cut: ReliefCut): Corner[][] {
  const kept: Corner[][] = [];
  let inside: Corner[] = [...polygon];
  for (const h of cut) {
    if (inside.length < 3) break;
    const split = splitPolygon(inside, h);
    if (split.outside.length >= 3 && doubleArea(split.outside) > 1e-10) kept.push(split.outside);
    inside = split.inside;
  }
  return kept;
}

const drawnCache = new WeakMap<WallRelief, WallRelief>();
const drawnReliefs = new WeakSet<WallRelief>();

/**
 * The relief as the hall draws it: without what the doors' modelled leaves
 * replace and what an open leaf turns through (doorReliefFate), so a leaf
 * never shares a surface with its photographed twin and an open doorway is
 * clear. A triangle a doorway cuts is clipped along the cut's planes (its
 * pieces keep their shared corners and add the points the planes make), so
 * the photograph in front of them stays whole. The walls, the section's
 * slicer and its cap all take this; built once per relief.
 */
export function drawnRelief(relief: WallRelief): WallRelief {
  if (drawnReliefs.has(relief)) return relief;
  const cached = drawnCache.get(relief);
  if (cached !== undefined) return cached;
  const out = new Map<HallWallId, WallReliefMesh>();
  for (const [id, mesh] of relief) {
    const { positions, indices } = mesh;
    const corner = (i: number): Corner => [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0];
    const kept: number[] = [];
    const added: number[] = [];
    let next = positions.length / 3;
    for (let t = 0; t < indices.length; t += 3) {
      const ids = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
      const corners = ids.map(corner);
      const fate = doorReliefFate(id, corners);
      if (fate === null) {
        kept.push(...ids);
        continue;
      }
      // The original corners keep their indices; the planes' new points are added.
      const known = new Map<Corner, number>(corners.map((p, k) => [p, ids[k] ?? 0]));
      let pieces: Corner[][] = [corners];
      for (const cut of fate.cuts) pieces = pieces.flatMap((piece) => subtractReliefCut(piece, cut));
      for (const piece of pieces) {
        const index = piece.map((p) => {
          const existing = known.get(p);
          if (existing !== undefined) return existing;
          added.push(p[0], p[1], p[2]);
          known.set(p, next);
          next += 1;
          return next - 1;
        });
        for (let k = 1; k + 1 < piece.length; k++) {
          // A fan over points the planes made on one line has empty triangles: they are left out.
          if (doubleArea([piece[0] ?? corners[0] ?? [0, 0, 0], piece[k] ?? [0, 0, 0], piece[k + 1] ?? [0, 0, 0]]) <= 1e-12) continue;
          kept.push(index[0] ?? 0, index[k] ?? 0, index[k + 1] ?? 0);
        }
      }
    }
    const all = new Float32Array(positions.length + added.length);
    all.set(positions);
    all.set(added, positions.length);
    out.set(id, { wall: id, positions: added.length === 0 ? positions : all, indices: Uint32Array.from(kept) });
  }
  drawnCache.set(relief, out);
  drawnReliefs.add(out);
  return out;
}

/**
 * Relief that stands out from its wall in a corner, against the neighbouring
 * wall, belongs to that wall as much as to its own: each wall's depth map saw
 * the side of whatever stands in the corner (at the door wall's two corners,
 * the doorcases' sides and the radiator case, up to 0.79 m proud). A triangle
 * reaching further from its own wall than SHARED_REACH_MARGIN beyond its
 * nearest point's distance from the neighbour's plane, and more than
 * SHARED_MIN_PROUD in all, takes the lower of the two walls' cuts, so it
 * never stands above a neighbour cut lower than its own wall (Blake's
 * overview, 19 October: a doorcase's side left standing over the cut door
 * wall). Panelling and boards near a corner (under 0.2 m proud, further from
 * the neighbour than that) keep their own wall's cut.
 */
export const SHARED_MIN_PROUD = 0.1;
export const SHARED_REACH_MARGIN = 0.05;

/**
 * The neighbouring wall a relief triangle shares (its index in HALL_WALLS), or
 * -1. `corners` are its wall-local (u, v, depth) points.
 */
export function sharedNeighbour(wallIndex: number, wallLength: number, corners: readonly (readonly [number, number, number])[]): number {
  const proud = Math.max(...corners.map((c) => c[2]));
  if (proud <= SHARED_MIN_PROUD) return -1;
  // The wall before this one meets its start (u = 0), the next its end.
  const fromStart = Math.min(...corners.map((c) => c[0]));
  const fromEnd = Math.min(...corners.map((c) => wallLength - c[0]));
  const count = HALL_WALLS.length;
  if (fromStart <= fromEnd && proud > fromStart + SHARED_REACH_MARGIN) return (wallIndex + count - 1) % count;
  if (fromEnd < fromStart && proud > fromEnd + SHARED_REACH_MARGIN) return (wallIndex + 1) % count;
  return -1;
}

/**
 * The window or door (its index in HALL_OPENINGS) whose clear outline holds
 * wall-local (u, v) on `wall`, or -1: the rectangle from its sill to its head,
 * with an arched window's semicircular head above (radius half its width).
 * Each relief triangle is tagged by its centroid (`aOpening`), so the cutaway
 * can treat what stands in an opening (curtains, glass, a door's leaves)
 * differently from the walling round it.
 */
export function openingAt(wall: HallWallId, u: number, v: number): number {
  return HALL_OPENINGS.findIndex((opening) => {
    if (opening.wall !== wall) return false;
    const half = opening.width / 2;
    const across = u - opening.centre;
    if (Math.abs(across) > half || v < opening.sill) return false;
    const rise = opening.kind === "arched-window" ? Math.sqrt(Math.max(0, half * half - across * across)) : 0;
    return v <= opening.head + rise;
  });
}

/** Whether wall-local height `v` is in the varnished panelling (dado or attic). */
export function isPanelling(v: number): boolean {
  return v < E.dadoTop + 0.02 || v > E.corniceTop - 0.02;
}

/** The material for a wall face centred at height `v` (the doors' photographed leaves take it too, hall-doors.ts). */
export function wallMaterial(v: number): HallMaterialKey {
  return isPanelling(v) ? "wallPhotoGloss" : "wallPhoto";
}

export function buildHallWalls(hb: HallBuilders, relief: WallRelief | null): void {
  const drawn = relief === null ? null : drawnRelief(relief);
  HALL_WALLS.forEach((wall, index) => {
    hb.onWall(index, () => {
      hb.withRole("wall", () => {
        const mesh = drawn?.get(wall.id);
        if (mesh === undefined) flatWall(hb, wall);
        else reliefWall(hb, wall, index, mesh);
      });
    });
  });
}

/** A rectangle on the wall at `depth`, facing into the room. */
function wallRect(b: MeshBuilder, wall: HallWall, u0: number, u1: number, v0: number, v1: number, depth: number, cell = 0): void {
  if (u1 - u0 < 1e-5 || v1 - v0 < 1e-5) return;
  b.quadFacing(wallPoint(wall, u0, v0, depth), wallPoint(wall, u1, v0, depth), wallPoint(wall, u1, v1, depth), wallPoint(wall, u0, v1, depth),
    [u0, v0], [u1, v0], [u1, v1], [u0, v1], wall.normal, cell);
}

/** The wall as a flat photograph, shown until its relief arrives, open where its doors' leaves stand. */
function flatWall(hb: HallBuilders, wall: HallWall): void {
  const doors = DOOR_OUTLINES.filter((door) => door.wall === wall.id);
  const bands: readonly (readonly [number, number])[] = [[0, E.dadoTop], [E.dadoTop, E.corniceTop], [E.corniceTop, E.ceiling]];
  for (const [v0, v1] of bands) {
    const builder = hb.get(wallMaterial((v0 + v1) / 2));
    // Each band split at the leaves' tops, with the doorways left open below them.
    const splits = [v0, ...doors.map((door) => door.top).filter((top) => top > v0 && top < v1), v1].sort((p, q) => p - q);
    for (let k = 0; k + 1 < splits.length; k++) {
      const lo = splits[k] ?? v0;
      const hi = splits[k + 1] ?? v1;
      let u = 0;
      for (const door of doors.filter((entry) => entry.top >= hi - 1e-9).sort((p, q) => p.u0 - q.u0)) {
        wallRect(builder, wall, u, door.u0, lo, hi, 0, 0.35);
        u = door.u1;
      }
      wallRect(builder, wall, u, wall.length, lo, hi, 0, 0.35);
    }
  }
}

/** The wall's measured relief, split between the glossy and matte photographs. */
function reliefWall(hb: HallBuilders, wall: HallWall, wallIndex: number, mesh: WallReliefMesh): void {
  const { positions, indices } = mesh;
  const count = positions.length / 3;
  const local = (i: number): readonly [number, number, number] => [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0];
  const world: V3[] = [];
  for (let i = 0; i < count; i++) {
    const [u, v, depth] = local(i);
    world.push(wallPoint(wall, u, v, depth));
  }
  // Area-weighted vertex normals: every face of the relief looks into the room.
  const sums = new Float64Array(count * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] ?? 0;
    const b = indices[t + 1] ?? 0;
    const c = indices[t + 2] ?? 0;
    const pa = world[a];
    const pb = world[b];
    const pc = world[c];
    if (pa === undefined || pb === undefined || pc === undefined) continue;
    const n = vec.cross(vec.sub(pb, pa), vec.sub(pc, pa));
    for (const k of [a, b, c]) {
      sums[k * 3] = (sums[k * 3] ?? 0) + n[0];
      sums[k * 3 + 1] = (sums[k * 3 + 1] ?? 0) + n[1];
      sums[k * 3 + 2] = (sums[k * 3 + 2] ?? 0) + n[2];
    }
  }
  const normalOf = (i: number): V3 => {
    const n: V3 = [sums[i * 3] ?? 0, sums[i * 3 + 1] ?? 0, sums[i * 3 + 2] ?? 0];
    return Math.hypot(n[0], n[1], n[2]) > 1e-12 ? vec.normalize(n) : wall.normal;
  };
  // Each material's builder gets its own copy of the vertices it uses, and a
  // triangle shared with a neighbouring wall, or lying in an opening, its own
  // copies again (they carry that wall's cut, or the opening, too).
  const remaps = new Map<string, Int32Array>();
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0] as const;
    const centreU = (local(corners[0])[0] + local(corners[1])[0] + local(corners[2])[0]) / 3;
    const centreV = (local(corners[0])[1] + local(corners[1])[1] + local(corners[2])[1]) / 3;
    const key = wallMaterial(centreV);
    const neighbour = sharedNeighbour(wallIndex, wall.length, corners.map(local));
    const opening = openingAt(wall.id, centreU, centreV);
    const builder = hb.get(key);
    const remapKey = `${key}:${String(neighbour)}:${String(opening)}`;
    let remap = remaps.get(remapKey);
    if (remap === undefined) {
      remap = new Int32Array(count).fill(-1);
      remaps.set(remapKey, remap);
    }
    const target = remap;
    hb.withNeighbour(neighbour, () => { hb.withOpening(opening, () => {
      const ids = corners.map((i) => {
        const existing = target[i] ?? -1;
        if (existing >= 0) return existing;
        const [u, v] = local(i);
        const created = builder.vertex(world[i] ?? wallPoint(wall, u, v), normalOf(i), [u, v]);
        target[i] = created;
        return created;
      });
      builder.triangle(ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0);
    }); });
  }
}
