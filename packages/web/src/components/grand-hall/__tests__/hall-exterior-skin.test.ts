import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { buildHallFront, FRONT_DETAIL_FULL } from "../hall-exterior.js";
import { buildWallBody } from "../hall-wall-body.js";

// The front stands against the window wall's body. A face of the front lying on one of the body's planes,
// over one of its faces, fights it for the same depth wherever a cut shows the section: the temple's
// entablature, on the wall's own plane, against its outer face. Every face of the front keeps off the
// body's planes where the two overlap (SKIN_GAP, hall-exterior.ts).

type V3 = readonly [number, number, number];
interface Triangle {
  readonly corners: readonly [V3, V3, V3];
  /** The plane's normal, one sign per plane (so faces back to back share it). */
  readonly normal: V3;
  readonly offset: number;
  /** The way the face itself looks. */
  readonly facing: V3;
  /** Its first corner's vertex, for the face's attributes. */
  readonly vertex: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Within this of a plane counts as on it, metres: half the skin's gap. */
const ON_PLANE = 0.002;

function triangles(geometry: BufferGeometry): Triangle[] {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index === null ? position.count : index.count;
  const at = (k: number): number => (index === null ? k : index.getX(k));
  const out: Triangle[] = [];
  for (let k = 0; k + 2 < count; k += 3) {
    const corners = [at(k), at(k + 1), at(k + 2)].map((i) => [position.getX(i), position.getY(i), position.getZ(i)] as V3) as [V3, V3, V3];
    const c = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    const length = Math.hypot(...c);
    if (length < 1e-9) continue;
    const facing: V3 = [c[0] / length, c[1] / length, c[2] / length];
    // One sign per plane, so faces back to back compare as one plane.
    const lead = Math.abs(facing[0]) > 1e-6 ? facing[0] : Math.abs(facing[1]) > 1e-6 ? facing[1] : facing[2];
    const normal: V3 = lead < 0 ? [-facing[0], -facing[1], -facing[2]] : facing;
    out.push({ corners, normal, offset: dot(normal, corners[0]), facing, vertex: at(k) });
  }
  return out;
}

/** The area two triangles on one plane share (Sutherland-Hodgman, in the plane's own axes). */
function sharedArea(a: Triangle, b: Triangle): number {
  const n = a.normal;
  const u0 = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
  const ul = Math.hypot(...u0);
  const u: V3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v = cross(n, u);
  const flat = (p: V3): [number, number] => [dot(p, u), dot(p, v)];
  const signedArea = (q: readonly (readonly [number, number])[]): number => q.reduce((sum, p, i) => {
    const r = q[(i + 1) % q.length] ?? p;
    return sum + p[0] * r[1] - r[0] * p[1];
  }, 0) / 2;
  let poly: (readonly [number, number])[] = a.corners.map(flat);
  const clip = b.corners.map(flat);
  const turn = Math.sign(signedArea(clip)) || 1;
  for (let i = 0; i < clip.length && poly.length > 0; i++) {
    const e0 = clip[i] ?? [0, 0];
    const e1 = clip[(i + 1) % clip.length] ?? [0, 0];
    const side = (p: readonly [number, number]): number => turn * ((e1[0] - e0[0]) * (p[1] - e0[1]) - (e1[1] - e0[1]) * (p[0] - e0[0]));
    const kept: [number, number][] = [];
    for (let j = 0; j < poly.length; j++) {
      const s = poly[j] ?? [0, 0];
      const e = poly[(j + 1) % poly.length] ?? [0, 0];
      const ss = side(s);
      const se = side(e);
      const cut = (): [number, number] => { const t = ss / (ss - se); return [s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]; };
      if (se >= 0) {
        if (ss < 0) kept.push(cut());
        kept.push([e[0], e[1]]);
      } else if (ss >= 0) kept.push(cut());
    }
    poly = kept;
  }
  return poly.length < 3 ? 0 : Math.abs(signedArea(poly));
}

/** The front's faces lying on a body face's plane and overlapping it by more than a square millimetre. */
function frontOnBody(front: BufferGeometry, body: BufferGeometry): { readonly at: readonly number[]; readonly area: number }[] {
  const bodyFaces = triangles(body);
  const found: { at: readonly number[]; area: number }[] = [];
  for (const f of triangles(front)) {
    for (const b of bodyFaces) {
      if (Math.abs(f.offset - b.offset) > ON_PLANE || dot(f.normal, b.normal) < 0.99995) continue;
      const area = sharedArea(f, b);
      if (area > 1e-6) {
        const [p, q, r] = f.corners;
        found.push({ at: [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]].map((x) => Math.round((x / 3) * 1000) / 1000), area });
      }
    }
  }
  return found;
}

describe("the measured front against the window wall's body", () => {
  it("keeps every face off the body's planes where the two overlap", () => {
    const overlaps = frontOnBody(buildHallFront(FRONT_DETAIL_FULL).geometry, buildWallBody().geometry);
    expect(overlaps.slice(0, 5)).toEqual([]);
  });
});

/**
 * Every pair of the front's own faces lying on one plane and overlapping: either back to back (two
 * blocks touching, inside the stone; where a cut shows them, one is seen from inside, and the cut pass,
 * drawn a hair toward the eye, wins the tie), or flush. Flush faces of one material draw alike; flush
 * faces of two materials would fight on the front's outside, where nothing covers them.
 */
function frontOnItself(front: BufferGeometry): { readonly backToBack: number; readonly mixedFlush: readonly { readonly at: readonly number[]; readonly parts: readonly number[] }[] } {
  const part = front.getAttribute("aPart");
  const byNormal = new Map<string, Triangle[]>();
  for (const t of triangles(front)) {
    const key = t.normal.map((x) => Math.round(x * 200)).join(",");
    const list = byNormal.get(key);
    if (list === undefined) byNormal.set(key, [t]); else list.push(t);
  }
  let backToBack = 0;
  const mixedFlush: { at: readonly number[]; parts: readonly number[] }[] = [];
  for (const list of byNormal.values()) {
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b === undefined || b.offset - a.offset > ON_PLANE) break;
        if (dot(a.normal, b.normal) < 0.99995 || sharedArea(a, b) <= 1e-6) continue;
        if (dot(a.facing, b.facing) < 0) { backToBack += 1; continue; }
        const parts = [Math.round(part.getX(a.vertex)), Math.round(part.getX(b.vertex))];
        if (parts[0] !== parts[1]) {
          const [p, q, r] = a.corners;
          mixedFlush.push({ at: [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]].map((x) => Math.round((x / 3) * 1000) / 1000), parts });
        }
      }
    }
  }
  return { backToBack, mixedFlush };
}

describe("the measured front's own solids", () => {
  it("meet one another back to back or flush in one material, never two materials on one plane", () => {
    const { backToBack, mixedFlush } = frontOnItself(buildHallFront(FRONT_DETAIL_FULL).geometry);
    expect(mixedFlush.slice(0, 5)).toEqual([]);
    // The touching pairs whose ties the cut pass wins (hall-exterior-material.ts CUT_EYEWARD): many, all inside the stone.
    expect(backToBack).toBeGreaterThan(0);
  });
});
