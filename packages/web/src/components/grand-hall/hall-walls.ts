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
// The main door stood open during the scan, so its leaves are modelled: a
// closed pair of panelled mahogany leaves set in the relief's recess. Until
// the relief arrives each wall is a flat photograph.
// ---------------------------------------------------------------------------

import { vec, type MeshBuilder, type V3 } from "./mesh-builder.js";
import type { HallBuilders, HallMaterialKey } from "./hall-builders.js";
import type { WallRelief, WallReliefMesh } from "./hall-relief.js";
import { HALL_ELEVATION, HALL_OPENINGS, HALL_WALLS, wallPoint, type HallOpening, type HallWall } from "./hall-spec.js";

const E = HALL_ELEVATION;
const UP: V3 = [0, 1, 0];

/** The opening whose leaves are modelled (open in the scan). */
export const MODELLED_DOOR = "door-main";
/** Depth of the main door's recess in the relief, and of its leaves. */
const DOOR_RECESS = -0.3;
const LEAF_PLANE = -0.27;

/** Whether wall-local height `v` is in the varnished panelling (dado or attic). */
export function isPanelling(v: number): boolean {
  return v < E.dadoTop + 0.02 || v > E.corniceTop - 0.02;
}

/** The material for a wall face centred at height `v`. */
function wallMaterial(v: number): HallMaterialKey {
  return isPanelling(v) ? "wallPhotoGloss" : "wallPhoto";
}

export function buildHallWalls(hb: HallBuilders, relief: WallRelief | null): void {
  HALL_WALLS.forEach((wall, index) => {
    hb.onWall(index, () => {
      hb.withRole("wall", () => {
        const mesh = relief?.get(wall.id);
        if (mesh === undefined) flatWall(hb, wall);
        else reliefWall(hb, wall, mesh);
      });
      hb.withRole("detail", () => {
        for (const opening of HALL_OPENINGS) {
          if (opening.wall === wall.id && opening.id === MODELLED_DOOR) buildDoorLeaves(hb, wall, opening);
        }
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

/** The wall as a flat photograph, shown until its relief arrives. */
function flatWall(hb: HallBuilders, wall: HallWall): void {
  const bands: readonly (readonly [number, number])[] = [[0, E.dadoTop], [E.dadoTop, E.corniceTop], [E.corniceTop, E.ceiling]];
  for (const [v0, v1] of bands) wallRect(hb.get(wallMaterial((v0 + v1) / 2)), wall, 0, wall.length, v0, v1, 0, 0.35);
}

/** The wall's measured relief, split between the glossy and matte photographs. */
function reliefWall(hb: HallBuilders, wall: HallWall, mesh: WallReliefMesh): void {
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
  // Each material's builder gets its own copy of the vertices it uses.
  const remaps = new Map<HallMaterialKey, Int32Array>();
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0] as const;
    const centreV = (local(corners[0])[1] + local(corners[1])[1] + local(corners[2])[1]) / 3;
    const key = wallMaterial(centreV);
    const builder = hb.get(key);
    let remap = remaps.get(key);
    if (remap === undefined) {
      remap = new Int32Array(count).fill(-1);
      remaps.set(key, remap);
    }
    const target = remap;
    const ids = corners.map((i) => {
      const existing = target[i] ?? -1;
      if (existing >= 0) return existing;
      const [u, v] = local(i);
      const created = builder.vertex(world[i] ?? wallPoint(wall, u, v), normalOf(i), [u, v]);
      target[i] = created;
      return created;
    });
    builder.triangle(ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0);
  }
}

/** The main door's closed leaves: two panelled mahogany leaves and their knobs. */
function buildDoorLeaves(hb: HallBuilders, wall: HallWall, opening: HallOpening): void {
  const mahogany = hb.get("mahoganyDark");
  const half = opening.width / 2;
  // The back of the recess, behind the leaves' meeting gap.
  wallRect(mahogany, wall, opening.centre - half, opening.centre + half, 0, opening.head, DOOR_RECESS + 0.005);
  for (const leaf of [0, 1]) {
    const lu0 = opening.centre - half + leaf * half + 0.004;
    const lu1 = lu0 + half - 0.008;
    wallRect(mahogany, wall, lu0, lu1, 0, opening.head, LEAF_PLANE, 0.5);
    const stile = Math.min(0.11, half * 0.18);
    for (const [r0, r1] of [[0.18, 0.95], [1.08, opening.head - 0.16]] as const) {
      raisedPanel(mahogany, wall, lu0 + stile, lu1 - stile, r0, r1, LEAF_PLANE, 0.016, 0.04);
    }
  }
  const brass = hb.get("brass");
  for (const u of [opening.centre - 0.06, opening.centre + 0.06]) {
    brass.lathe(wallPoint(wall, u, 1.02, LEAF_PLANE + 0.05), [[0, -0.025], [0.022, -0.022], [0.026, 0], [0.022, 0.022], [0, 0.025]], 10);
  }
}

/** A raised and fielded panel: a bevelled border rising to a flat field. */
function raisedPanel(b: MeshBuilder, wall: HallWall, u0: number, u1: number, v0: number, v1: number, base: number, raise: number, bevel: number): void {
  const fu0 = u0 + bevel;
  const fu1 = u1 - bevel;
  const fv0 = v0 + bevel;
  const fv1 = v1 - bevel;
  const top = base + raise;
  if (fu1 <= fu0 || fv1 <= fv0) {
    wallRect(b, wall, u0, u1, v0, v1, top);
    return;
  }
  wallRect(b, wall, fu0, fu1, fv0, fv1, top);
  const P = (u: number, v: number, depth: number): V3 => wallPoint(wall, u, v, depth);
  const lean = (direction: V3): V3 => vec.normalize(vec.add(vec.scale(wall.normal, bevel), vec.scale(direction, raise)));
  b.quadFacing(P(u0, v0, base), P(u1, v0, base), P(fu1, fv0, top), P(fu0, fv0, top),
    [u0, v0], [u1, v0], [fu1, fv0], [fu0, fv0], lean([0, -1, 0]));
  b.quadFacing(P(fu0, fv1, top), P(fu1, fv1, top), P(u1, v1, base), P(u0, v1, base),
    [fu0, fv1], [fu1, fv1], [u1, v1], [u0, v1], lean(UP));
  b.quadFacing(P(u0, v0, base), P(fu0, fv0, top), P(fu0, fv1, top), P(u0, v1, base),
    [u0, v0], [fu0, fv0], [fu0, fv1], [u0, v1], lean(vec.scale(wall.tangent, -1)));
  b.quadFacing(P(fu1, fv0, top), P(u1, v0, base), P(u1, v1, base), P(fu1, fv1, top),
    [fu1, fv0], [u1, v0], [u1, v1], [fu1, fv1], lean(wall.tangent));
}
