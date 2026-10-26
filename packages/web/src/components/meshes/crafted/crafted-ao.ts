import { BufferAttribute, type BufferGeometry } from "three";
import type { Vec3 } from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Ambient occlusion baked into crafted furniture
//
// Phones and tablets draw without screen-space occlusion (render-quality.ts),
// so the creases that make a chair read as solid (under the seat, where a
// rail meets a leg, inside a cloth's folds, the floor round a foot) are
// baked into each piece as a per-vertex `ao` attribute, which the materials
// apply to their ambient and reflected light only (crafted-materials.ts).
//
// Computed when a piece is built, with no download and no ray casting:
//   - Each piece describes itself to the bake as a few boxes (its legs,
//     rails, seat). A box's occlusion of a vertex is exact: the
//     cosine-weighted solid angle of the faces it turns to the vertex,
//     clipped to the vertex's horizon (Lambert's polygon formula).
//   - The floor occludes what faces it, more the closer it is.
//   - Folded cloth occludes itself in its valleys: the surface's offset
//     from a smoothed copy of itself (a cavity term).
// Vertices a centimetre apart facing the same way share one evaluation, so
// a chair of six thousand vertices bakes in a few milliseconds.
// ---------------------------------------------------------------------------

/** An oriented box: its centre and three half-axes (each the half-extent along that edge). */
export interface AoBox {
  readonly centre: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
  /** Parts built from this box skip it when they are baked (a leg never occludes itself). */
  readonly tag?: string;
}

/** An axis-aligned box from its size and centre. */
export function aoBox(size: Vec3, centre: Vec3, tag?: string): AoBox {
  return {
    centre,
    axes: [[size[0] / 2, 0, 0], [0, size[1] / 2, 0], [0, 0, size[2] / 2]],
    ...(tag === undefined ? {} : { tag }),
  };
}

/** A square rod of side `thickness` from `a` to `b`, as a box (a leg, a rail, a spindle). */
export function aoRod(a: Vec3, b: Vec3, thickness: number, tag?: string): AoBox {
  const along: Vec3 = [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, (b[2] - a[2]) / 2];
  const length = Math.hypot(along[0], along[1], along[2]) || 1;
  const u: Vec3 = [along[0] / length, along[1] / length, along[2] / length];
  // Any vector not parallel to the rod, for the two sides.
  const helper: Vec3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const side = normalised(cross(u, helper));
  const other = cross(u, side);
  const half = thickness / 2;
  return {
    centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    axes: [along, scale(side, half), scale(other, half)],
    ...(tag === undefined ? {} : { tag }),
  };
}

export interface FloorOcclusion {
  /** Occlusion where the floor fills the whole view, 0 to 1 (the floor's own bounce keeps it below 1). */
  readonly strength: number;
  /** Height above which the floor no longer occludes, metres. */
  readonly range: number;
}

export interface CavityOcclusion {
  /** Smoothing passes over the surface: more passes find wider valleys. */
  readonly passes: number;
  /** Occlusion per metre a vertex lies inside its smoothed surface. */
  readonly perMetre: number;
}

export interface OcclusionOptions {
  readonly boxes?: readonly AoBox[];
  /** Tags of the boxes that stand for the part being baked. */
  readonly self?: readonly string[];
  /** How much of the boxes' occlusion to apply, 0 to 1. */
  readonly strength?: number;
  readonly floor?: FloorOcclusion;
  readonly cavity?: CavityOcclusion;
  /** The darkest the bake goes, so no crease turns black. */
  readonly floorValue?: number;
}

/** What a piece standing on the floor usually wants from it. */
export const STANDING_FLOOR: FloorOcclusion = { strength: 0.55, range: 0.32 };

/** A chair's: its seat's underside stands about 0.4 m over the boards, still in the floor's shade. */
export const CHAIR_FLOOR: FloorOcclusion = { strength: 0.6, range: 0.52 };

/** Vertices closer than this, facing the same way, share one evaluation (metres). */
const SHARE_CELL = 0.01;
/** Normals within about 11° of each other count as facing the same way. */
const NORMAL_STEPS = 8;

/**
 * Writes an `ao` attribute (1 open, lower occluded) to `geometry` from the
 * occluders described; returns the geometry. Expects its normals in place.
 */
export function occlude(geometry: BufferGeometry, options: OcclusionOptions): BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const count = position.count;
  const values = new Float32Array(count).fill(1);
  const self = new Set(options.self ?? []);
  const boxes = packBoxes((options.boxes ?? []).filter((box) => box.tag === undefined || !self.has(box.tag)));
  const strength = options.strength ?? 1;
  const cavity = options.cavity === undefined ? null : cavityDepths(geometry, options.cavity.passes);
  const shared = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const px = position.getX(index);
    const py = position.getY(index);
    const pz = position.getZ(index);
    const nx = normal.getX(index);
    const ny = normal.getY(index);
    const nz = normal.getZ(index);
    const key = shareKey(px, py, pz, nx, ny, nz);
    let open = shared.get(key);
    if (open === undefined) {
      open = 1;
      for (let box = 0; box < boxes.count; box += 1) {
        const blocked = boxOcclusion(boxes, box, px, py, pz, nx, ny, nz);
        if (blocked > 0) open *= 1 - Math.min(1, blocked) * strength;
      }
      if (options.floor !== undefined) open *= 1 - floorOcclusion(py, ny, options.floor.range) * options.floor.strength;
      shared.set(key, open);
    }
    if (cavity !== null && options.cavity !== undefined) {
      const inside = cavity[index] ?? 0;
      open *= 1 - Math.min(0.6, Math.max(0, inside) * options.cavity.perMetre);
    }
    values[index] = Math.max(options.floorValue ?? 0.22, open);
  }
  geometry.setAttribute("ao", new BufferAttribute(values, 1));
  return geometry;
}

/** Marks every vertex of `geometry` open (parts the bake leaves alone still carry the attribute). */
export function unoccluded(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("ao", new BufferAttribute(new Float32Array(count).fill(1), 1));
  return geometry;
}

/** One integer for a vertex's centimetre cell and the octant-quantised direction it faces. */
function shareKey(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  const cx = Math.round(px / SHARE_CELL) & 1023;
  const cy = Math.round(py / SHARE_CELL) & 1023;
  const cz = Math.round(pz / SHARE_CELL) & 1023;
  // Octahedral projection of the normal onto a small grid.
  const l = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let ox = nx / l;
  let oy = nz / l;
  if (ny < 0) {
    const fx = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
    const fy = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1);
    ox = fx;
    oy = fy;
  }
  const qx = Math.round((ox * 0.5 + 0.5) * NORMAL_STEPS);
  const qy = Math.round((oy * 0.5 + 0.5) * NORMAL_STEPS);
  const qs = ny < 0 ? 1 : 0;
  return ((((cx * 1024 + cy) * 1024 + cz) * (NORMAL_STEPS + 1) + qx) * (NORMAL_STEPS + 1) + qy) * 2 + qs;
}

// ---------------------------------------------------------------------------
// Boxes: Lambert's formula over each face turned toward the vertex
// ---------------------------------------------------------------------------

/** Floats per face: its outward normal, a point on it, then four corners. */
const FACE_STRIDE = 18;
/** Floats per box: its bounding sphere (centre, radius), then six faces. */
const BOX_STRIDE = 4 + 6 * FACE_STRIDE;

interface PackedBoxes {
  readonly count: number;
  readonly data: Float64Array;
}

function packBoxes(boxes: readonly AoBox[]): PackedBoxes {
  const data = new Float64Array(boxes.length * BOX_STRIDE);
  boxes.forEach((box, b) => {
    const base = b * BOX_STRIDE;
    const axes = box.axes;
    data[base] = box.centre[0];
    data[base + 1] = box.centre[1];
    data[base + 2] = box.centre[2];
    data[base + 3] = axes.reduce((sum, axis) => sum + Math.hypot(axis[0], axis[1], axis[2]), 0);
    let face = 0;
    for (let k = 0; k < 3; k += 1) {
      const axis = axes[k];
      const u = axes[(k + 1) % 3];
      const v = axes[(k + 2) % 3];
      if (axis === undefined || u === undefined || v === undefined) continue;
      const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      for (const sign of [1, -1]) {
        const at = base + 4 + face * FACE_STRIDE;
        data[at] = (axis[0] / length) * sign;
        data[at + 1] = (axis[1] / length) * sign;
        data[at + 2] = (axis[2] / length) * sign;
        const cx = box.centre[0] + axis[0] * sign;
        const cy = box.centre[1] + axis[1] * sign;
        const cz = box.centre[2] + axis[2] * sign;
        data[at + 3] = cx;
        data[at + 4] = cy;
        data[at + 5] = cz;
        // Corners round the face (the form factor is taken unsigned, so either winding serves).
        const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        corners.forEach(([su, sv], c) => {
          data[at + 6 + c * 3] = cx + u[0] * su + v[0] * sv;
          data[at + 7 + c * 3] = cy + u[1] * su + v[1] * sv;
          data[at + 8 + c * 3] = cz + u[2] * su + v[2] * sv;
        });
        face += 1;
      }
    }
  });
  return { count: boxes.length, data };
}

/** How far a box's occlusion is still worth computing, in bounding radii from its centre. */
const BOX_REACH = 9;

function boxOcclusion(boxes: PackedBoxes, box: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  const d = boxes.data;
  const base = box * BOX_STRIDE;
  const dx = (d[base] ?? 0) - px;
  const dy = (d[base + 1] ?? 0) - py;
  const dz = (d[base + 2] ?? 0) - pz;
  const radius = d[base + 3] ?? 0;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared > radius * radius * BOX_REACH * BOX_REACH) return 0;
  // Wholly behind the vertex's horizon.
  if (dx * nx + dy * ny + dz * nz < -radius) return 0;
  let total = 0;
  for (let face = 0; face < 6; face += 1) {
    const at = base + 4 + face * FACE_STRIDE;
    // Only faces turned toward the vertex: together they cover the box's outline once.
    const toward = (px - (d[at + 3] ?? 0)) * (d[at] ?? 0) + (py - (d[at + 4] ?? 0)) * (d[at + 1] ?? 0) + (pz - (d[at + 5] ?? 0)) * (d[at + 2] ?? 0);
    if (toward <= 1e-6) continue;
    total += faceFormFactor(d, at + 6, px, py, pz, nx, ny, nz);
  }
  return total;
}

/** Clipped corners, relative to the vertex: at most five from a quad. */
const clipped = new Float64Array(8 * 3);

/**
 * The cosine-weighted fraction of the hemisphere round `n` at `p` that the
 * quad starting at `data[at]` covers: Lambert's formula after clipping the
 * quad to the hemisphere (Sutherland–Hodgman against n·w ≥ ε).
 */
function faceFormFactor(data: Float64Array, at: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  const epsilon = 1e-5;
  let kept = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = at + i * 3;
    const b = at + ((i + 1) % 4) * 3;
    const ax = (data[a] ?? 0) - px;
    const ay = (data[a + 1] ?? 0) - py;
    const az = (data[a + 2] ?? 0) - pz;
    const bx = (data[b] ?? 0) - px;
    const by = (data[b + 1] ?? 0) - py;
    const bz = (data[b + 2] ?? 0) - pz;
    const da = ax * nx + ay * ny + az * nz - epsilon;
    const db = bx * nx + by * ny + bz * nz - epsilon;
    if (da >= 0) {
      clipped[kept * 3] = ax;
      clipped[kept * 3 + 1] = ay;
      clipped[kept * 3 + 2] = az;
      kept += 1;
    }
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      clipped[kept * 3] = ax + (bx - ax) * t;
      clipped[kept * 3 + 1] = ay + (by - ay) * t;
      clipped[kept * 3 + 2] = az + (bz - az) * t;
      kept += 1;
    }
  }
  if (kept < 3) return 0;
  let sum = 0;
  for (let i = 0; i < kept; i += 1) {
    const j = (i + 1) % kept;
    const ax = clipped[i * 3] ?? 0;
    const ay = clipped[i * 3 + 1] ?? 0;
    const az = clipped[i * 3 + 2] ?? 0;
    const bx = clipped[j * 3] ?? 0;
    const by = clipped[j * 3 + 1] ?? 0;
    const bz = clipped[j * 3 + 2] ?? 0;
    const la = Math.sqrt(ax * ax + ay * ay + az * az);
    const lb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const lc = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (lc < 1e-12) continue;
    // The edge's angle from its sine and cosine, steadier than acos near 0.
    const gamma = Math.atan2(lc, ax * bx + ay * by + az * bz);
    sum += (gamma * (cx * nx + cy * ny + cz * nz)) / lc;
  }
  return Math.abs(sum) / (2 * Math.PI);
}

// ---------------------------------------------------------------------------
// The floor: the cosine-weighted share of directions that meet it within range
// ---------------------------------------------------------------------------

const FLOOR_TABLE_HEIGHTS = 24;
const FLOOR_TABLE_NORMALS = 24;
let floorTable: Float32Array | null = null;

function buildFloorTable(): Float32Array {
  const table = new Float32Array((FLOOR_TABLE_HEIGHTS + 1) * (FLOOR_TABLE_NORMALS + 1));
  // Directions over the sphere, evenly spread (a Fibonacci lattice).
  const samples = 1024;
  const directions: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < samples; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / samples;
    const r = Math.sqrt(1 - y * y);
    directions.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  for (let hi = 0; hi <= FLOOR_TABLE_HEIGHTS; hi += 1) {
    const x = hi / FLOOR_TABLE_HEIGHTS;
    for (let ni = 0; ni <= FLOOR_TABLE_NORMALS; ni += 1) {
      const ny = -1 + (2 * ni) / FLOOR_TABLE_NORMALS;
      const nx = Math.sqrt(Math.max(0, 1 - ny * ny));
      let weight = 0;
      let blocked = 0;
      for (const d of directions) {
        const cosine = d[0] * nx + d[1] * ny;
        if (cosine <= 0) continue;
        weight += cosine;
        // A direction meets the floor within range when it falls steeper than height/range.
        if (d[1] < 0 && -d[1] > x) blocked += cosine;
      }
      table[hi * (FLOOR_TABLE_NORMALS + 1) + ni] = weight > 0 ? blocked / weight : 0;
    }
  }
  return table;
}

/** The floor's occlusion of a point `height` above it whose normal has vertical component `ny`. */
export function floorOcclusion(height: number, ny: number, range: number): number {
  if (height >= range) return 0;
  floorTable ??= buildFloorTable();
  const table = floorTable;
  const hf = (Math.max(0, height) / range) * FLOOR_TABLE_HEIGHTS;
  const nf = ((Math.max(-1, Math.min(1, ny)) + 1) / 2) * FLOOR_TABLE_NORMALS;
  const h0 = Math.min(FLOOR_TABLE_HEIGHTS - 1, Math.floor(hf));
  const n0 = Math.min(FLOOR_TABLE_NORMALS - 1, Math.floor(nf));
  const th = hf - h0;
  const tn = nf - n0;
  const row = FLOOR_TABLE_NORMALS + 1;
  const at = (h: number, k: number): number => table[h * row + k] ?? 0;
  const top = at(h0, n0) * (1 - tn) + at(h0, n0 + 1) * tn;
  const bottom = at(h0 + 1, n0) * (1 - tn) + at(h0 + 1, n0 + 1) * tn;
  return top * (1 - th) + bottom * th;
}

// ---------------------------------------------------------------------------
// Cavities: how far each vertex sits inside a smoothed copy of its surface
// ---------------------------------------------------------------------------

/** Depth of each vertex below its smoothed surface, along its normal (positive inside a valley). */
function cavityDepths(geometry: BufferGeometry, passes: number): Float32Array {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const count = position.count;
  // Vertices on a UV seam are duplicated: weld them by position for the smoothing.
  const weld = new Int32Array(count);
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    weld[i] = first ?? i;
  }
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  const link = (a: number, b: number): void => {
    const wa = weld[a] ?? a;
    const wb = weld[b] ?? b;
    if (wa === wb) return;
    neighbours[wa]?.push(wb);
    neighbours[wb]?.push(wa);
  };
  const index = geometry.index;
  if (index !== null) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      link(a, b); link(b, c); link(c, a);
    }
  }
  let current = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    current[i * 3] = position.getX(i);
    current[i * 3 + 1] = position.getY(i);
    current[i * 3 + 2] = position.getZ(i);
  }
  let next = new Float32Array(current);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      if ((weld[i] ?? i) !== i) continue;
      const list = neighbours[i] ?? [];
      if (list.length === 0) continue;
      let sx = 0; let sy = 0; let sz = 0;
      for (const j of list) { sx += current[j * 3] ?? 0; sy += current[j * 3 + 1] ?? 0; sz += current[j * 3 + 2] ?? 0; }
      const k = 1 / list.length;
      // Half a step toward the neighbours' mean keeps the smoothing stable.
      next[i * 3] = ((current[i * 3] ?? 0) + sx * k) / 2;
      next[i * 3 + 1] = ((current[i * 3 + 1] ?? 0) + sy * k) / 2;
      next[i * 3 + 2] = ((current[i * 3 + 2] ?? 0) + sz * k) / 2;
    }
    [current, next] = [next, current];
  }
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const w = weld[i] ?? i;
    const dx = (current[w * 3] ?? 0) - position.getX(i);
    const dy = (current[w * 3 + 1] ?? 0) - position.getY(i);
    const dz = (current[w * 3 + 2] ?? 0) - position.getZ(i);
    // A valley's smoothed surface lies outward of it, along its normal.
    depths[i] = dx * normal.getX(i) + dy * normal.getY(i) + dz * normal.getZ(i);
  }
  return depths;
}

// ---------------------------------------------------------------------------

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function normalised(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}
