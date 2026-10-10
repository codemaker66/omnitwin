// ---------------------------------------------------------------------------
// The coffered ceiling and the dome, as scanned
//
// The flat ceiling carries the avodire lattice of hexagonal coffers with its
// gilt fillets, the four chandelier roses and the great hexagonal frame
// around the dome; it is one plane whose colour is the scan's ceiling
// orthophoto. The dome is a surface of revolution on its measured profile —
// a steep band carrying the fourteen Incorporations' arms, a spherical cap
// in broad panels, the crown ring and the lowered plate the great chandelier
// hangs from — coloured by its own projection of the panoramas, unrolled by
// angle and arc length so the arms keep their proportions.
// ---------------------------------------------------------------------------

import type { MeshBuilder, V3 } from "./mesh-builder.js";
import { vec } from "./mesh-builder.js";
import type { HallBuilders } from "./hall-builders.js";
import { HALL_DOME, HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, domeHeightAt } from "./hall-spec.js";

const DOWN: V3 = [0, -1, 0];

/** Cutaway id shared by the ceiling and dome: hidden together from above. */
export const CEILING_CUT_ID = 4;

/** Texture coordinates of a ceiling point in the ceiling orthophoto. */
export function ceilingUv(x: number, z: number): [number, number] {
  // The orthophoto looks up: its columns run with planner x, its rows with z.
  return [(x + HALL_HALF_LENGTH) / (HALL_HALF_LENGTH * 2), (z + HALL_HALF_WIDTH) / (HALL_HALF_WIDTH * 2)];
}

/**
 * Emits a grid of vertices (columns × rows, row-major) and its triangles,
 * wound to face `facing` at its first cell.
 */
function grid(b: MeshBuilder, columns: number, rows: number, at: (i: number, j: number) => { readonly position: V3; readonly normal: V3; readonly uv: readonly [number, number] }, facing: (i: number, j: number) => V3): void {
  const first = b.vertices;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const vertex = at(i, j);
      b.vertex(vertex.position, vertex.normal, vertex.uv);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      const a = first + j * columns + i;
      const c = a + 1;
      const d = a + columns + 1;
      const e = a + columns;
      const pa = at(i, j).position;
      const pc = at(i + 1, j).position;
      const pe = at(i, j + 1).position;
      const winding = vec.cross(vec.sub(pc, pa), vec.sub(pe, pa));
      const toward = facing(i, j);
      if (winding[0] * toward[0] + winding[1] * toward[1] + winding[2] * toward[2] >= 0) { b.triangle(a, c, d); b.triangle(a, d, e); }
      else { b.triangle(a, d, c); b.triangle(a, e, d); }
    }
  }
}

/**
 * The flat ceiling as a ring from the dome's foot circle out to the walls,
 * so both edges are exact.
 */
function buildCeilingField(b: MeshBuilder): void {
  const segments = 192;
  const rings = 16;
  const y = HALL_HEIGHT;
  const radius = HALL_DOME.footRadius;
  const point = (i: number, k: number): V3 => {
    const theta = (i / segments) * Math.PI * 2;
    const dx = Math.cos(theta);
    const dz = Math.sin(theta);
    const t = Math.min(Math.abs(dx) > 1e-9 ? HALL_HALF_LENGTH / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-9 ? HALL_HALF_WIDTH / Math.abs(dz) : Infinity);
    const r = radius + (t - radius) * Math.pow(k / rings, 1.2);
    return [dx * r, y, dz * r];
  };
  grid(b, segments + 1, rings + 1, (i, k) => {
    const position = point(i, k);
    return { position, normal: DOWN, uv: ceilingUv(position[0], position[2]) };
  }, () => DOWN);
}

// ---------------------------------------------------------------------------
// The dome
// ---------------------------------------------------------------------------

/** The dome's profile from its foot to the centre of the plate: (radius, height). */
export function domeProfile(): [number, number][] {
  const d = HALL_DOME;
  const points: [number, number][] = [];
  // Band and cap down to the crown ring.
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const r = d.footRadius - ((d.footRadius - d.crownRadius) * i) / steps;
    points.push([r, domeHeightAt(r)]);
  }
  // The crown ring rises to its top, then steps down to the plate.
  points.push([d.plateRadius + 0.12, d.crownHeight]);
  points.push([d.plateRadius + 0.02, d.crownHeight - 0.04]);
  points.push([d.plateRadius, d.plateHeight + 0.02]);
  points.push([d.plateRadius - 0.04, d.plateHeight]);
  points.push([0, d.plateHeight]);
  return points;
}

/** Arc length along the profile at each of its points. */
function profileLengths(profile: readonly [number, number][]): number[] {
  const lengths = [0];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const c = profile[i];
    if (a === undefined || c === undefined) continue;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(c[0] - a[0], c[1] - a[1]));
  }
  return lengths;
}

export const DOME_PROFILE = domeProfile();
const DOME_LENGTHS = profileLengths(DOME_PROFILE);
/** Total arc length of the dome's profile, foot to centre. */
export const DOME_ARC = DOME_LENGTHS[DOME_LENGTHS.length - 1] ?? 1;

/**
 * Texture coordinates of the dome texture: u is the angle around the dome
 * (0 at planner +x, increasing toward +z), v the arc length from the foot.
 */
export function domeUv(theta: number, arc: number): [number, number] {
  const u = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
  return [u, 1 - arc / DOME_ARC];
}

function buildDomeShell(b: MeshBuilder): void {
  const segments = 160;
  const profile = DOME_PROFILE;
  // Inward (toward the hall) normal of the profile at each of its points, in
  // the (radius, height) plane: the travel direction turned a quarter.
  const normals: [number, number][] = profile.map((_, j) => {
    const before = profile[Math.max(0, j - 1)] ?? profile[j];
    const after = profile[Math.min(profile.length - 1, j + 1)] ?? profile[j];
    if (before === undefined || after === undefined) return [0, -1];
    const dr = after[0] - before[0];
    const dh = after[1] - before[1];
    const length = Math.hypot(dr, dh) || 1;
    const nr = -dh / length;
    const nh = dr / length;
    // Face down into the hall.
    return nh > 0 ? [-nr, -nh] : [nr, nh];
  });
  const at = (i: number, j: number): { position: V3; normal: V3; uv: readonly [number, number] } => {
    const theta = (i / segments) * Math.PI * 2;
    const [r, h] = profile[j] ?? [0, HALL_HEIGHT];
    const [nr, nh] = normals[j] ?? [0, -1];
    const uvAt = domeUv(theta, DOME_LENGTHS[j] ?? 0);
    // The seam's last column stays at u = 1 rather than wrapping to 0.
    if (i === segments) uvAt[0] = 1;
    return {
      position: [Math.cos(theta) * r, h, Math.sin(theta) * r],
      normal: vec.normalize([Math.cos(theta) * nr, nh, Math.sin(theta) * nr]),
      uv: uvAt,
    };
  };
  grid(b, segments + 1, profile.length, at, (i, j) => at(i, j).normal);
}

/** The gilt ring at the dome's foot. */
function buildDomeRing(b: MeshBuilder): void {
  const path: V3[] = [];
  const segments = 160;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    path.push([Math.cos(theta) * (HALL_DOME.footRadius + 0.02), HALL_HEIGHT - 0.035, Math.sin(theta) * (HALL_DOME.footRadius + 0.02)]);
  }
  b.tube(path, path.map(() => 0.045), 10);
}

export function buildHallCeiling(hb: HallBuilders): void {
  hb.onWall(CEILING_CUT_ID, () => {
    hb.withRole("ceiling", () => {
      buildCeilingField(hb.get("ceilingPhoto"));
    });
    hb.withRole("dome", () => {
      buildDomeShell(hb.get("domePhoto"));
      buildDomeRing(hb.get("gilt"));
    });
  });
}
