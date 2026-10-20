// ---------------------------------------------------------------------------
// The relief's own section: the cut through the mouldings
//
// Where the cutaway cuts a wall, its body's top (hall-wall-body.ts) is the
// section from the wall's plane out to its outer face. In front of the plane
// stands the scanned relief: the dado rail, the pilasters, the doorcases, the
// deacons' boards, the chimneypiece. A model maker's cut goes through those
// too, so the section reaches out to wherever the relief's surface stands at
// the cut's height.
//
// The relief is a height field (how far each point of the wall stands proud,
// for every u along it and v up it), so that outline is a profile: for each
// centimetre of u, how far the relief stands proud at the cut. ReliefSlicer
// cuts the relief at a height on the CPU, from a bucket index of the
// triangles that cross it; HallSectionProfile keeps the four walls' profiles
// for their current cuts in one row of a half-float texture and slices a wall
// again only when its cut has moved a millimetre or more. The cap
// (buildSectionCap) is a strip of quads that its shader lays in each wall's
// cut plane and clips to the profile, so the section meets the relief's
// surface wherever the cut lies, at any height, from any side.
//
// Why not paint the relief's back faces, the usual way to cap a cut? They
// fill the section only where a ray inside the relief leaves it again through
// the relief's surface: from a camera beyond the cut wall (the opening view)
// all of it, but from Plan, looking down from over the room, rays inside the
// relief travel toward the wall and pass into the body instead: 3-22% of the
// section's pixels per wall (S3b, backface_reach.py on the S3a Plan frame).
// The cap is the section itself: flat, facing up, at the cut.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from "three";
import type { WallRelief, WallReliefMesh } from "./hall-relief.js";
import { HALL_WALLS, wallPoint } from "./hall-spec.js";
import { sharedNeighbour } from "./hall-walls.js";

/** Metres of u per texel of the profile. */
export const SECTION_BIN = 0.01;
/** A profile's value where the relief has no section. */
export const NO_SECTION = -1;
/** A wall's cut has to move this far before its profile is cut again, metres. */
export const SECTION_RESLICE = 0.001;
/** The cap reaches this far behind the wall's plane, over the body's top, so no crack opens between them. */
export const CAP_OVERLAP = 0.01;
/** The cap's quads span this much of u each, as deep as the relief stands proud anywhere in that span. */
const CAP_CHUNK = 0.25;
/** Texels left empty between walls in the profile's row, so filtering never mixes two walls. */
const PROFILE_GAP = 2;
/** Height of the slicer's buckets, metres. */
const BUCKET = 0.05;

/** Where each wall's profile sits in the texture's one row. */
export interface ProfileSpan {
  readonly offset: number;
  readonly bins: number;
}

export const SECTION_PROFILE_SPANS: readonly ProfileSpan[] = (() => {
  const spans: ProfileSpan[] = [];
  let offset = PROFILE_GAP;
  for (const wall of HALL_WALLS) {
    const bins = Math.ceil(wall.length / SECTION_BIN);
    spans.push({ offset, bins });
    offset += bins + PROFILE_GAP;
  }
  return spans;
})();

/** The profile texture's width: every wall's bins and the gaps between them. */
export const SECTION_PROFILE_WIDTH = (SECTION_PROFILE_SPANS[SECTION_PROFILE_SPANS.length - 1]?.offset ?? 0)
  + (SECTION_PROFILE_SPANS[SECTION_PROFILE_SPANS.length - 1]?.bins ?? 0) + PROFILE_GAP;

interface WallSlices {
  /** Wall-local u, v and depth of every vertex. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Per triangle, the neighbouring wall it stands in a corner against (hall-walls.ts sharedNeighbour), or -1. */
  readonly neighbour: Int8Array;
  /** Triangles by height: bucket k's triangles are items[start[k]..start[k + 1]). */
  readonly start: Uint32Array;
  readonly items: Uint32Array;
}

function indexWall(wallIndex: number, mesh: WallReliefMesh): WallSlices {
  const wall = HALL_WALLS[wallIndex];
  if (wall === undefined) throw new Error(`No wall ${String(wallIndex)}`);
  const { positions, indices } = mesh;
  const triangles = indices.length / 3;
  const neighbour = new Int8Array(triangles);
  const lows = new Int32Array(triangles);
  const highs = new Int32Array(triangles);
  let buckets = 1;
  for (let t = 0; t < triangles; t++) {
    const corners: [number, number, number][] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k] ?? 0;
      const corner: [number, number, number] = [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0];
      corners.push(corner);
      lo = Math.min(lo, corner[1]);
      hi = Math.max(hi, corner[1]);
    }
    neighbour[t] = sharedNeighbour(wallIndex, wall.length, corners);
    const low = Math.max(0, Math.floor(lo / BUCKET));
    const high = Math.max(0, Math.floor(hi / BUCKET));
    lows[t] = low;
    highs[t] = high;
    buckets = Math.max(buckets, high + 1);
  }
  const start = new Uint32Array(buckets + 1);
  for (let t = 0; t < triangles; t++) {
    for (let k = lows[t] ?? 0; k <= (highs[t] ?? 0); k++) start[k + 1] = (start[k + 1] ?? 0) + 1;
  }
  for (let k = 0; k < buckets; k++) start[k + 1] = (start[k + 1] ?? 0) + (start[k] ?? 0);
  const items = new Uint32Array(start[buckets] ?? 0);
  const fill = start.slice(0, buckets);
  for (let t = 0; t < triangles; t++) {
    for (let k = lows[t] ?? 0; k <= (highs[t] ?? 0); k++) {
      const at = fill[k] ?? 0;
      items[at] = t;
      fill[k] = at + 1;
    }
  }
  return { positions, indices, neighbour, start, items };
}

/** Raises `out`'s bins along the segment (u0, d0)-(u1, d1) to its depth, and the bins holding its ends to theirs. */
function rasterise(out: Float32Array, ua: number, da: number, ub: number, db: number): void {
  const last = out.length - 1;
  const [u0, d0, u1, d1] = ua <= ub ? [ua, da, ub, db] : [ub, db, ua, da];
  const raise = (i: number, d: number): void => {
    if (i < 0 || i > last) return;
    if (d > (out[i] ?? NO_SECTION)) out[i] = d;
  };
  raise(Math.floor(u0 / SECTION_BIN), d0);
  raise(Math.floor(u1 / SECTION_BIN), d1);
  const span = u1 - u0;
  const first = Math.max(0, Math.ceil(u0 / SECTION_BIN - 0.5));
  const end = Math.min(last, Math.floor(u1 / SECTION_BIN - 0.5));
  for (let i = first; i <= end; i++) {
    const centre = (i + 0.5) * SECTION_BIN;
    const t = span > 1e-9 ? (centre - u0) / span : 0;
    raise(i, d0 + (d1 - d0) * t);
  }
}

/**
 * Cuts the scanned relief at a height. A wall's profile holds, for each
 * SECTION_BIN of u, how far its relief stands proud at that height (NO_SECTION
 * where none of it crosses there). Relief standing in a corner against the
 * neighbouring wall is cut at the lower of the two walls' cuts (as the walls'
 * mask cuts it, hall-materials.ts), so it joins this wall's section only while
 * the neighbour is cut no lower; when the neighbour is cut lower, the
 * neighbour's own relief of the same corner joins its section.
 */
export class ReliefSlicer {
  private readonly walls: (WallSlices | null)[];

  constructor(relief: WallRelief) {
    this.walls = HALL_WALLS.map((wall, index) => {
      const mesh = relief.get(wall.id);
      return mesh === undefined ? null : indexWall(index, mesh);
    });
  }

  /** Whether wall `wallIndex` has relief to cut. */
  has(wallIndex: number): boolean {
    return (this.walls[wallIndex] ?? null) !== null;
  }

  /**
   * Wall `wallIndex`'s profile at height `height`, with every wall's cut in
   * `cuts` (HALL_WALLS order), written into `out` (one value per bin).
   */
  slice(wallIndex: number, height: number, cuts: readonly number[], out: Float32Array = new Float32Array(SECTION_PROFILE_SPANS[wallIndex]?.bins ?? 0)): Float32Array {
    out.fill(NO_SECTION);
    const slices = this.walls[wallIndex] ?? null;
    if (slices === null) return out;
    const { positions: p, indices, neighbour, start, items } = slices;
    const bucket = Math.floor(height / BUCKET);
    if (bucket < 0 || bucket + 1 >= start.length) return out;
    const from = start[bucket] ?? 0;
    const to = start[bucket + 1] ?? 0;
    const crossing = [0, 0, 0, 0];
    for (let n = from; n < to; n++) {
      const t = items[n] ?? 0;
      const shared = neighbour[t] ?? -1;
      if (shared >= 0 && (cuts[shared] ?? Infinity) < height) continue;
      const a = indices[t * 3] ?? 0;
      const b = indices[t * 3 + 1] ?? 0;
      const c = indices[t * 3 + 2] ?? 0;
      let found = 0;
      for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
        const vi = p[i * 3 + 1] ?? 0;
        const vj = p[j * 3 + 1] ?? 0;
        if ((vi > height) === (vj > height) || found > 2) continue;
        const s = (height - vi) / (vj - vi);
        crossing[found] = (p[i * 3] ?? 0) + s * ((p[j * 3] ?? 0) - (p[i * 3] ?? 0));
        crossing[found + 1] = (p[i * 3 + 2] ?? 0) + s * ((p[j * 3 + 2] ?? 0) - (p[i * 3 + 2] ?? 0));
        found += 2;
      }
      if (found < 4) continue;
      rasterise(out, crossing[0] ?? 0, crossing[1] ?? 0, crossing[2] ?? 0, crossing[3] ?? 0);
    }
    return out;
  }
}

/** A profile's depth at wall-local `u`, filtered between bins as the shader's texture sample is. */
export function profileDepthAt(profile: Float32Array, u: number): number {
  const x = u / SECTION_BIN - 0.5;
  const i = Math.max(0, Math.min(profile.length - 1, Math.floor(x)));
  const j = Math.max(0, Math.min(profile.length - 1, i + 1));
  const t = Math.max(0, Math.min(1, x - i));
  return (profile[i] ?? NO_SECTION) * (1 - t) + (profile[j] ?? NO_SECTION) * t;
}

/**
 * The four walls' sections at their current cuts, as one row of a
 * half-float texture the section's shaders read (SECTION_PROFILE_SPANS). A
 * wall is cut again only when its cut has moved SECTION_RESLICE or more, or a
 * neighbour's cut has crossed it (which decides where the corners' shared
 * relief belongs); a wall that is not cut keeps its last profile, unread.
 */
export class HallSectionProfile {
  readonly texture: DataTexture;
  private slicer: ReliefSlicer | null = null;
  private readonly profiles = SECTION_PROFILE_SPANS.map((span) => new Float32Array(span.bins).fill(NO_SECTION));
  /** The cut each wall was last sliced at, and which walls stood lower then (a bit each). */
  private readonly sliced = HALL_WALLS.map(() => ({ height: Number.NaN, lower: -1 }));
  private readonly data: Uint16Array;

  constructor() {
    this.data = new Uint16Array(SECTION_PROFILE_WIDTH).fill(DataUtils.toHalfFloat(NO_SECTION));
    this.texture = new DataTexture(this.data, SECTION_PROFILE_WIDTH, 1, RedFormat, HalfFloatType);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.name = "grand-hall-section-profile";
    this.texture.needsUpdate = true;
  }

  /** The relief to cut (null: the walls are flat photographs, and the body is the whole section). */
  setRelief(relief: WallRelief | null): void {
    this.slicer = relief === null ? null : new ReliefSlicer(relief);
    for (const entry of this.sliced) { entry.height = Number.NaN; entry.lower = -1; }
    for (const profile of this.profiles) profile.fill(NO_SECTION);
    this.data.fill(DataUtils.toHalfFloat(NO_SECTION));
    this.texture.needsUpdate = true;
  }

  /** A wall's profile as last cut (for tests and probes). */
  profile(wallIndex: number): Float32Array | undefined {
    return this.profiles[wallIndex];
  }

  /**
   * Cuts again each wall whose cut (`cuts`, HALL_WALLS order) lies under `top`
   * and has moved, and marks the texture for upload. Returns whether anything
   * changed.
   */
  update(cuts: readonly number[], top: number): boolean {
    const slicer = this.slicer;
    if (slicer === null) return false;
    let changed = false;
    for (let index = 0; index < HALL_WALLS.length; index++) {
      const height = cuts[index] ?? Infinity;
      if (!(height > 0 && height < top) || !slicer.has(index)) continue;
      let lower = 0;
      for (let k = 0; k < HALL_WALLS.length; k++) if ((cuts[k] ?? Infinity) < height) lower |= 1 << k;
      const last = this.sliced[index];
      const profile = this.profiles[index];
      const span = SECTION_PROFILE_SPANS[index];
      if (last === undefined || profile === undefined || span === undefined) continue;
      if (Math.abs(height - last.height) < SECTION_RESLICE && lower === last.lower) continue;
      slicer.slice(index, height, cuts, profile);
      for (let i = 0; i < span.bins; i++) this.data[span.offset + i] = DataUtils.toHalfFloat(profile[i] ?? NO_SECTION);
      last.height = height;
      last.lower = lower;
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
    return changed;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/**
 * The section's cap: per wall, a strip of quads lying flat (at y = 0 here;
 * the shader lays them in the wall's cut plane), from CAP_OVERLAP behind the
 * wall's plane out to a centimetre beyond the furthest the relief stands
 * proud anywhere in each CAP_CHUNK of u. Spans where the relief never stands
 * proud get none. Each vertex carries `aCap`: its wall, u and depth.
 */
export function buildSectionCap(relief: WallRelief): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const caps: number[] = [];
  const indices: number[] = [];
  HALL_WALLS.forEach((wall, wallIndex) => {
    const mesh = relief.get(wall.id);
    if (mesh === undefined) return;
    const chunks = Math.ceil(wall.length / CAP_CHUNK);
    const proud = new Float32Array(chunks).fill(-Infinity);
    const { positions: p, indices: tri } = mesh;
    for (let t = 0; t < tri.length; t += 3) {
      let u0 = Infinity;
      let u1 = -Infinity;
      let reach = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = tri[t + k] ?? 0;
        u0 = Math.min(u0, p[i * 3] ?? 0);
        u1 = Math.max(u1, p[i * 3] ?? 0);
        reach = Math.max(reach, p[i * 3 + 2] ?? 0);
      }
      const c0 = Math.max(0, Math.floor(u0 / CAP_CHUNK));
      const c1 = Math.min(chunks - 1, Math.floor(u1 / CAP_CHUNK));
      for (let c = c0; c <= c1; c++) proud[c] = Math.max(proud[c] ?? -Infinity, reach);
    }
    // The walls' frames all have tangent x normal pointing down, so (u, depth)
    // runs clockwise seen from above: wind each quad the other way to face up.
    for (let c = 0; c < chunks; c++) {
      const reach = proud[c] ?? -Infinity;
      if (reach < 0.002) continue;
      const ua = c * CAP_CHUNK;
      const ub = Math.min(wall.length, (c + 1) * CAP_CHUNK);
      const outer = reach + 0.01;
      const base = positions.length / 3;
      for (const [u, d] of [[ua, -CAP_OVERLAP], [ub, -CAP_OVERLAP], [ub, outer], [ua, outer]] as const) {
        const point = wallPoint(wall, u, 0, d);
        positions.push(point[0], 0, point[2]);
        normals.push(0, 1, 0);
        caps.push(wallIndex, u, d);
      }
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("aCap", new BufferAttribute(new Float32Array(caps), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "grand-hall-section-cap";
  return geometry;
}

const capCache = new WeakMap<WallRelief, BufferGeometry>();

/** The section's cap for a relief, built once and shared by every canvas. */
export function sectionCapGeometry(relief: WallRelief): BufferGeometry {
  let geometry = capCache.get(relief);
  if (geometry === undefined) {
    geometry = buildSectionCap(relief);
    capCache.set(relief, geometry);
  }
  return geometry;
}
