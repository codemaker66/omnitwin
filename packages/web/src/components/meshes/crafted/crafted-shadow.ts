import { BufferAttribute, BufferGeometry } from "three";
import type { AoBox } from "./crafted-ao.js";
import { normalizeAttributes, type Vec3 } from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Shadow casters for crafted furniture
//
// The sun's and the moon's shadow of a piece is cast by a few closed boxes
// (its legs, rails, seat, top), not by what is seen: a chair casts with a
// few hundred triangles instead of several thousand, and its turned and
// draped surfaces never shadow themselves into acne. The boxes are the same
// ones the occlusion bake reads (crafted-ao.ts), set in by a few millimetres,
// so the caster stands inside the surfaces that receive its shadow and a lit
// face is never shadowed by its own stand-in.
//
// A box thinner than `minimum` is thickened to it: a leg thinner than the
// shadow map's texel would flicker in and out of the map as the sun moves.
// ---------------------------------------------------------------------------

export interface CasterOptions {
  /** How far each face is set in from the box it stands for, metres. */
  readonly inset?: number;
  /** The least thickness any box keeps, metres. */
  readonly minimum?: number;
}

/** Where a piece meets the floor: a foot's centre in plan and the reach of its contact shade, metres. */
export interface FootContact {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * A soft dark spot on the floor under each foot (the `contact` material):
 * the shade a foot casts on the boards right round itself, which no shadow
 * map is fine enough to draw, so every leg reads as standing on the floor in
 * any light. Flat quads a hair above the floor, UVs 0..1 across each.
 */
export function contactSpots(feet: readonly FootContact[], lift = 0.0012): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  feet.forEach((foot, i) => {
    const base = i * 4;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      positions.push(foot.x + (u - 0.5) * 2 * foot.radius, lift, foot.z + (v - 0.5) * 2 * foot.radius);
      uvs.push(u, v);
      normals.push(0, 1, 0);
    }
    // Facing up: (+x, then +z) turns clockwise seen from above, so wind 0, 2, 1.
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return normalizeAttributes(geometry);
}

/**
 * A closed upright cylinder (a round table in its cloth, a poseur's cover):
 * from `bottom` to `top`, `segments` round, radius `bottomRadius` widening or
 * narrowing to `topRadius`, already set in by the caller.
 */
export function casterCylinder(bottomRadius: number, topRadius: number, bottom: number, top: number, segments = 24): BufferGeometry {
  const positions: number[] = [0, bottom, 0, 0, top, 0];
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * bottomRadius, bottom, Math.sin(a) * bottomRadius);
    positions.push(Math.cos(a) * topRadius, top, Math.sin(a) * topRadius);
  }
  for (let i = 0; i < segments; i += 1) {
    const b0 = 2 + i * 2;
    const t0 = b0 + 1;
    const b1 = 2 + ((i + 1) % segments) * 2;
    const t1 = b1 + 1;
    // Wound outward: (t0 − b0) × (b1 − b0) points away from the axis, the
    // bottom cap down and the top cap up.
    indices.push(b0, t0, b1, b1, t0, t1);
    indices.push(0, b0, b1);
    indices.push(1, t1, t0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return normalizeAttributes(geometry);
}

/** A closed geometry of `boxes`, set in by `inset`: what a piece casts its shadow with. */
export function casterGeometry(boxes: readonly AoBox[], options: CasterOptions = {}): BufferGeometry {
  const inset = options.inset ?? 0.003;
  const minimum = options.minimum ?? 0.008;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const box of boxes) {
    const axes = box.axes.map((axis) => {
      const half = Math.hypot(axis[0], axis[1], axis[2]);
      const target = Math.max(minimum / 2, half - inset);
      const k = half > 1e-9 ? target / half : 0;
      return [axis[0] * k, axis[1] * k, axis[2] * k] as Vec3;
    });
    const [a, b, c] = axes;
    if (a === undefined || b === undefined || c === undefined) continue;
    const base = positions.length / 3;
    for (let i = 0; i < 8; i += 1) {
      const sa = i & 1 ? 1 : -1;
      const sb = i & 2 ? 1 : -1;
      const sc = i & 4 ? 1 : -1;
      positions.push(
        box.centre[0] + a[0] * sa + b[0] * sb + c[0] * sc,
        box.centre[1] + a[1] * sa + b[1] * sb + c[1] * sc,
        box.centre[2] + a[2] * sa + b[2] * sb + c[2] * sc,
      );
    }
    // Twelve triangles. Each quad below winds inward for right-handed axes
    // (−a's 0→2→6 turns b into c, and b × c = a), so a right-handed box
    // takes them reversed and a left-handed one (negative triple product) as
    // written: either way every face winds outward.
    const handed = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const faces = [
      [0, 2, 6, 4], [1, 5, 7, 3], // −a, +a
      [0, 4, 5, 1], [2, 3, 7, 6], // −b, +b
      [0, 1, 3, 2], [4, 6, 7, 5], // −c, +c
    ];
    for (const [p, q, r, s] of faces) {
      if (p === undefined || q === undefined || r === undefined || s === undefined) continue;
      if (handed >= 0) indices.push(base + p, base + r, base + q, base + p, base + s, base + r);
      else indices.push(base + p, base + q, base + r, base + p, base + r, base + s);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  // Shared corners give smooth normals, which the shadow pass never reads.
  geometry.computeVertexNormals();
  return normalizeAttributes(geometry);
}
