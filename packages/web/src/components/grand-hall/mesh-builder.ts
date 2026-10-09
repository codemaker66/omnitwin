// ---------------------------------------------------------------------------
// MeshBuilder — accumulates indexed triangles with per-vertex extras
//
// The hall's walls come from the scan's relief; the rest of the room (floor,
// ceiling, dome, chandeliers, the main door's leaves) is generated from the
// measured spec: quads, boxes, profiles swept along a line, lathes and grids.
// This builder collects them into flat typed arrays that become one
// BufferGeometry per material, so the whole room draws in a few calls. An
// optional per-vertex callback stores extra attributes (baked light, ambient
// occlusion) alongside position, normal and uv.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry } from "three";

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

/** Computes extra per-vertex data from a vertex's position and normal. */
export type VertexExtra = (position: V3, normal: V3) => readonly number[];

export interface MeshBuilderOptions {
  /** Width of the extra data per vertex (0 for none). */
  readonly extraSize?: number;
  /** Fills the extra data; required when extraSize > 0. */
  readonly extra?: VertexExtra;
  /** Attribute name for the extra data. */
  readonly extraName?: string;
  /**
   * Splits the extra data into several named attributes, in order. Sizes
   * must add up to extraSize. Overrides extraName.
   */
  readonly extraLayout?: readonly { readonly name: string; readonly size: number }[];
}

function normalize(v: V3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-12) return [0, 1, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function crossV(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subV(a: V3, b: V3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addV(a: V3, b: V3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleV(a: V3, s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export const vec = { normalize, cross: crossV, sub: subV, add: addV, scale: scaleV };

/** Growable float storage without per-push allocation. */
class FloatList {
  private data: Float32Array;
  length = 0;
  constructor(initial = 1024) { this.data = new Float32Array(initial); }
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  view(): Float32Array { return this.data.slice(0, this.length); }
}

class IndexList {
  private data: Uint32Array;
  length = 0;
  constructor(initial = 1024) { this.data = new Uint32Array(initial); }
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  view(): Uint32Array { return this.data.slice(0, this.length); }
}

export class MeshBuilder {
  private readonly positions = new FloatList();
  private readonly normals = new FloatList();
  private readonly uvs = new FloatList();
  private readonly extras = new FloatList();
  private readonly indices = new IndexList();
  private readonly extraSize: number;
  private readonly extraFn: VertexExtra | undefined;
  private readonly extraName: string;
  private readonly extraLayout: readonly { readonly name: string; readonly size: number }[] | undefined;
  private vertexCount = 0;

  constructor(options: MeshBuilderOptions = {}) {
    this.extraSize = options.extraSize ?? 0;
    this.extraFn = options.extra;
    this.extraName = options.extraName ?? "aLight";
    this.extraLayout = options.extraLayout;
    if (this.extraSize > 0 && this.extraFn === undefined) throw new Error("MeshBuilder: extra callback required");
    if (this.extraLayout !== undefined && this.extraLayout.reduce((sum, entry) => sum + entry.size, 0) !== this.extraSize) {
      throw new Error("MeshBuilder: extra layout must cover extraSize");
    }
  }

  get vertices(): number { return this.vertexCount; }
  get triangles(): number { return this.indices.length / 3; }

  /** Adds one vertex and returns its index. */
  vertex(position: V3, normal: V3, uv: V2): number {
    this.positions.push(position[0]); this.positions.push(position[1]); this.positions.push(position[2]);
    this.normals.push(normal[0]); this.normals.push(normal[1]); this.normals.push(normal[2]);
    this.uvs.push(uv[0]); this.uvs.push(uv[1]);
    if (this.extraSize > 0 && this.extraFn !== undefined) {
      const values = this.extraFn(position, normal);
      for (let i = 0; i < this.extraSize; i++) this.extras.push(values[i] ?? 0);
    }
    return this.vertexCount++;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a); this.indices.push(b); this.indices.push(c);
  }

  /**
   * A planar quad from four corners in counter-clockwise order as seen from
   * the side its normal faces. Subdivides into a grid when `cell` is given so
   * per-vertex light can vary across large surfaces.
   */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, uv0: V2, uv1: V2, uv2: V2, uv3: V2, cell = 0, normalOverride?: V3): void {
    const normal = normalOverride ?? normalize(crossV(subV(p1, p0), subV(p3, p0)));
    const widthLength = Math.hypot(...subV(p1, p0));
    const heightLength = Math.hypot(...subV(p3, p0));
    const nu = cell > 0 ? Math.max(1, Math.ceil(widthLength / cell)) : 1;
    const nv = cell > 0 ? Math.max(1, Math.ceil(heightLength / cell)) : 1;
    const base: number[] = [];
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        // Bilinear interpolation of the four corners.
        const position: V3 = [
          (1 - t) * ((1 - s) * p0[0] + s * p1[0]) + t * ((1 - s) * p3[0] + s * p2[0]),
          (1 - t) * ((1 - s) * p0[1] + s * p1[1]) + t * ((1 - s) * p3[1] + s * p2[1]),
          (1 - t) * ((1 - s) * p0[2] + s * p1[2]) + t * ((1 - s) * p3[2] + s * p2[2]),
        ];
        const uv: V2 = [
          (1 - t) * ((1 - s) * uv0[0] + s * uv1[0]) + t * ((1 - s) * uv3[0] + s * uv2[0]),
          (1 - t) * ((1 - s) * uv0[1] + s * uv1[1]) + t * ((1 - s) * uv3[1] + s * uv2[1]),
        ];
        base.push(this.vertex(position, normal, uv));
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base[j * row + i];
        const b = base[j * row + i + 1];
        const c = base[(j + 1) * row + i + 1];
        const d = base[(j + 1) * row + i];
        if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
        this.triangle(a, b, c);
        this.triangle(a, c, d);
      }
    }
  }

  /**
   * A planar quad whose winding is chosen so its face points along `facing`,
   * whatever order the corners arrive in. Corner uvs follow their corners.
   */
  quadFacing(p0: V3, p1: V3, p2: V3, p3: V3, uv0: V2, uv1: V2, uv2: V2, uv3: V2, facing: V3, cell = 0): void {
    const winding = crossV(subV(p1, p0), subV(p3, p0));
    const dotFacing = winding[0] * facing[0] + winding[1] * facing[1] + winding[2] * facing[2];
    const normal = normalize(facing);
    if (dotFacing >= 0) this.quad(p0, p1, p2, p3, uv0, uv1, uv2, uv3, cell, normal);
    else this.quad(p0, p3, p2, p1, uv0, uv3, uv2, uv1, cell, normal);
  }

  /**
   * A rectangle on a plane described by an origin, two in-plane axes and their
   * extents. UVs are metres along the axes, offset by `uvOrigin`.
   */
  rect(origin: V3, uAxis: V3, vAxis: V3, uLength: number, vLength: number, cell = 0, uvOrigin: V2 = [0, 0], uvScale: V2 = [1, 1]): void {
    const p0 = origin;
    const p1 = addV(origin, scaleV(uAxis, uLength));
    const p2 = addV(p1, scaleV(vAxis, vLength));
    const p3 = addV(origin, scaleV(vAxis, vLength));
    const u0 = uvOrigin[0] * uvScale[0];
    const v0 = uvOrigin[1] * uvScale[1];
    const u1 = (uvOrigin[0] + uLength) * uvScale[0];
    const v1 = (uvOrigin[1] + vLength) * uvScale[1];
    this.quad(p0, p1, p2, p3, [u0, v0], [u1, v0], [u1, v1], [u0, v1], cell);
  }

  /** A convex polygon fanned from its first vertex, with one normal. */
  polygon(points: readonly V3[], uvs: readonly V2[], normalOverride?: V3): void {
    if (points.length < 3) return;
    const first = points[0];
    const second = points[1];
    const third = points[2];
    if (first === undefined || second === undefined || third === undefined) return;
    const normal = normalOverride ?? normalize(crossV(subV(second, first), subV(third, first)));
    const indices = points.map((point, index) => this.vertex(point, normal, uvs[index] ?? [0, 0]));
    const origin = indices[0];
    if (origin === undefined) return;
    for (let i = 1; i < indices.length - 1; i++) {
      const b = indices[i];
      const c = indices[i + 1];
      if (b !== undefined && c !== undefined) this.triangle(origin, b, c);
    }
  }

  /**
   * An axis-aligned box rotated about Y around its centre. `faces` selects
   * which faces to emit (+x, -x, +y, -y, +z, -z). UVs are metres.
   */
  box(centre: V3, size: V3, rotationY = 0, faces = 0b111111, cell = 0): void {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const toWorld = (x: number, y: number, z: number): V3 => [
      centre[0] + x * cos + z * sin,
      centre[1] + y,
      centre[2] - x * sin + z * cos,
    ];
    const axisX: V3 = [cos, 0, -sin];
    const axisZ: V3 = [sin, 0, cos];
    const up: V3 = [0, 1, 0];
    // +x face
    if (faces & 0b100000) this.rect(toWorld(hx, -hy, hz), scaleV(axisZ, -1), up, size[2], size[1], cell);
    // -x face
    if (faces & 0b010000) this.rect(toWorld(-hx, -hy, -hz), axisZ, up, size[2], size[1], cell);
    // +y face
    if (faces & 0b001000) this.rect(toWorld(-hx, hy, hz), axisX, scaleV(axisZ, -1), size[0], size[2], cell);
    // -y face
    if (faces & 0b000100) this.rect(toWorld(-hx, -hy, -hz), axisX, axisZ, size[0], size[2], cell);
    // +z face
    if (faces & 0b000010) this.rect(toWorld(-hx, -hy, hz), axisX, up, size[0], size[1], cell);
    // -z face
    if (faces & 0b000001) this.rect(toWorld(hx, -hy, -hz), scaleV(axisX, -1), up, size[0], size[1], cell);
  }

  /**
   * Sweeps a 2D profile along a straight segment. Profile points are
   * (out, up) offsets: `out` along `outAxis`, `up` along +Y. Each consecutive
   * profile pair becomes one strip; normals are flat per strip. End caps are
   * optional so mitred runs can meet.
   */
  sweep(start: V3, end: V3, outAxis: V3, profile: readonly V2[], caps = false, uvPerMetre = 1): void {
    const along = subV(end, start);
    const runLength = Math.hypot(along[0], along[1], along[2]);
    if (runLength < 1e-6) return;
    const alongUnit = scaleV(along, 1 / runLength);
    let travelled = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i];
      const b = profile[i + 1];
      if (a === undefined || b === undefined) continue;
      const offsetA = addV(scaleV(outAxis, a[0]), [0, a[1], 0]);
      const offsetB = addV(scaleV(outAxis, b[0]), [0, b[1], 0]);
      const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const p0 = addV(start, offsetA);
      const p1 = addV(end, offsetA);
      const p2 = addV(end, offsetB);
      const p3 = addV(start, offsetB);
      // Orient so the strip faces outward (away from the wall, or upward).
      const normal = normalize(crossV(alongUnit, subV(offsetB, offsetA)));
      const outward = normal[0] * outAxis[0] + normal[2] * outAxis[2] + normal[1] * 0.5 >= 0;
      const u0 = 0;
      const u1 = runLength * uvPerMetre;
      const v0 = travelled * uvPerMetre;
      const v1 = (travelled + segment) * uvPerMetre;
      if (outward) this.quad(p0, p1, p2, p3, [u0, v0], [u1, v0], [u1, v1], [u0, v1], 0, normal);
      else this.quad(p0, p3, p2, p1, [u0, v0], [u0, v1], [u1, v1], [u1, v0], 0, scaleV(normal, -1));
      travelled += segment;
    }
    if (!caps) return;
    for (const [point, direction] of [[start, scaleV(alongUnit, -1)], [end, alongUnit]] as const) {
      const ring = profile.map((p) => addV(point, addV(scaleV(outAxis, p[0]), [0, p[1], 0])));
      const back = addV(point, [0, 0, 0]);
      const capPoints: V3[] = [back, ...ring];
      const uvs: V2[] = capPoints.map((p) => [p[0] + p[2], p[1]]);
      // Fan from the wall-side point; flip to face along the run's direction.
      const normal = normalize(direction);
      const indices = capPoints.map((p, index) => this.vertex(p, normal, uvs[index] ?? [0, 0]));
      for (let i = 1; i < indices.length - 1; i++) {
        const a = indices[0];
        const b = indices[i];
        const c = indices[i + 1];
        if (a === undefined || b === undefined || c === undefined) continue;
        const check = normalize(crossV(subV(capPoints[i] ?? back, back), subV(capPoints[i + 1] ?? back, back)));
        const facing = check[0] * normal[0] + check[1] * normal[1] + check[2] * normal[2];
        if (facing >= 0) this.triangle(a, b, c);
        else this.triangle(a, c, b);
      }
    }
  }

  /**
   * A surface of revolution about the Y axis through `centre`. `profile` is a
   * list of (radius, height) pairs from bottom to top; smooth normals.
   */
  lathe(centre: V3, profile: readonly V2[], segments: number, scaleX = 1, scaleZ = 1, phase = 0): void {
    const rings: number[][] = [];
    for (let j = 0; j < profile.length; j++) {
      const point = profile[j];
      if (point === undefined) continue;
      const prev = profile[Math.max(0, j - 1)] ?? point;
      const next = profile[Math.min(profile.length - 1, j + 1)] ?? point;
      // Profile tangent → outward normal in the (r, y) plane.
      const dr = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const tangentLength = Math.hypot(dr, dy) || 1;
      const nr = dy / tangentLength;
      const ny = -dr / tangentLength;
      const ring: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = phase + (i / segments) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const position: V3 = [centre[0] + cos * point[0] * scaleX, centre[1] + point[1], centre[2] + sin * point[0] * scaleZ];
        const normal = normalize([cos * nr / Math.max(scaleX, 1e-6), ny, sin * nr / Math.max(scaleZ, 1e-6)]);
        ring.push(this.vertex(position, normal, [i / segments, j / Math.max(1, profile.length - 1)]));
      }
      rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const lower = rings[j];
      const upper = rings[j + 1];
      if (lower === undefined || upper === undefined) continue;
      for (let i = 0; i < segments; i++) {
        const a = lower[i];
        const b = lower[i + 1];
        const c = upper[i + 1];
        const d = upper[i];
        if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
        // Counter-clockwise seen from outside.
        this.triangle(a, c, b);
        this.triangle(a, d, c);
      }
    }
  }

  /**
   * A tube along a polyline with a circular cross-section (for chandelier arms,
   * chair spindles). `radii` gives the radius at each path point.
   */
  tube(path: readonly V3[], radii: readonly number[], radialSegments: number, closedEnds = false): void {
    if (path.length < 2) return;
    const rings: number[][] = [];
    let previousNormal: V3 | null = null;
    for (let j = 0; j < path.length; j++) {
      const point = path[j];
      if (point === undefined) continue;
      const prev = path[Math.max(0, j - 1)] ?? point;
      const next = path[Math.min(path.length - 1, j + 1)] ?? point;
      const tangent = normalize(subV(next, prev));
      // Parallel-transport a reference normal along the path.
      let reference: V3 = previousNormal ?? (Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
      const side = normalize(crossV(tangent, reference));
      reference = normalize(crossV(side, tangent));
      previousNormal = reference;
      const radius = radii[j] ?? radii[radii.length - 1] ?? 0.01;
      const ring: number[] = [];
      for (let i = 0; i <= radialSegments; i++) {
        const angle = (i / radialSegments) * Math.PI * 2;
        const normal = normalize(addV(scaleV(reference, Math.cos(angle)), scaleV(side, Math.sin(angle))));
        ring.push(this.vertex(addV(point, scaleV(normal, radius)), normal, [i / radialSegments, j / (path.length - 1)]));
      }
      rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const lower = rings[j];
      const upper = rings[j + 1];
      if (lower === undefined || upper === undefined) continue;
      for (let i = 0; i < radialSegments; i++) {
        const a = lower[i];
        const b = lower[i + 1];
        const c = upper[i + 1];
        const d = upper[i];
        if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
        this.triangle(a, b, c);
        this.triangle(a, c, d);
      }
    }
    if (!closedEnds) return;
    const first = path[0];
    const last = path[path.length - 1];
    const firstRing = rings[0];
    const lastRing = rings[rings.length - 1];
    if (first === undefined || last === undefined || firstRing === undefined || lastRing === undefined) return;
    const startTangent = normalize(subV(path[1] ?? last, first));
    const endTangent = normalize(subV(last, path[path.length - 2] ?? first));
    const startCentre = this.vertex(first, scaleV(startTangent, -1), [0.5, 0]);
    const endCentre = this.vertex(last, endTangent, [0.5, 1]);
    for (let i = 0; i < radialSegments; i++) {
      const a = firstRing[i];
      const b = firstRing[i + 1];
      if (a !== undefined && b !== undefined) this.triangle(startCentre, b, a);
      const c = lastRing[i];
      const d = lastRing[i + 1];
      if (c !== undefined && d !== undefined) this.triangle(endCentre, c, d);
    }
  }

  /** Appends another builder's output (same extra layout). */
  merge(other: MeshBuilder): void {
    const offset = this.vertexCount;
    const data = other.arrays();
    for (let i = 0; i < data.positions.length; i++) this.positions.push(data.positions[i] ?? 0);
    for (let i = 0; i < data.normals.length; i++) this.normals.push(data.normals[i] ?? 0);
    for (let i = 0; i < data.uvs.length; i++) this.uvs.push(data.uvs[i] ?? 0);
    if (this.extraSize > 0) {
      for (let i = 0; i < data.extras.length; i++) this.extras.push(data.extras[i] ?? 0);
    }
    for (let i = 0; i < data.indices.length; i++) this.indices.push((data.indices[i] ?? 0) + offset);
    this.vertexCount += data.positions.length / 3;
  }

  arrays(): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; extras: Float32Array; indices: Uint32Array } {
    return {
      positions: this.positions.view(),
      normals: this.normals.view(),
      uvs: this.uvs.view(),
      extras: this.extras.view(),
      indices: this.indices.view(),
    };
  }

  build(): BufferGeometry {
    const data = this.arrays();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
    geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
    if (this.extraSize > 0 && this.extraLayout === undefined) geometry.setAttribute(this.extraName, new BufferAttribute(data.extras, this.extraSize));
    if (this.extraSize > 0 && this.extraLayout !== undefined) {
      let offset = 0;
      for (const entry of this.extraLayout) {
        const values = new Float32Array(this.vertexCount * entry.size);
        for (let v = 0; v < this.vertexCount; v++) {
          for (let k = 0; k < entry.size; k++) values[v * entry.size + k] = data.extras[v * this.extraSize + offset + k] ?? 0;
        }
        geometry.setAttribute(entry.name, new BufferAttribute(values, entry.size));
        offset += entry.size;
      }
    }
    const needs32 = this.vertexCount > 65535;
    geometry.setIndex(new BufferAttribute(needs32 ? data.indices : Uint16Array.from(data.indices), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
