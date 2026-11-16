import { describe, expect, it } from "vitest";
import { BoxGeometry, Float32BufferAttribute, type BufferGeometry } from "three";
import { buildHallFront, FRONT_DETAIL_FULL, FRONT_DETAIL_LIGHT, FRONT_PART, frontPoint, LET_IN } from "../hall-exterior.js";
import { GROUND_OPENINGS } from "../hall-exterior-spec.js";
import { CUT_EYEWARD, CUT_EYEWARD_MAX } from "../hall-exterior-material.js";
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

const signedArea = (q: readonly (readonly [number, number])[]): number => q.reduce((sum, p, i) => {
  const r = q[(i + 1) % q.length] ?? p;
  return sum + p[0] * r[1] - r[0] * p[1];
}, 0) / 2;

/**
 * Where two triangles overlap seen along the unit direction `n`: a polygon in two unit directions `u` and `v`
 * across it (Sutherland-Hodgman).
 */
function overlapAlong(n: V3, a: Triangle, b: Triangle): { readonly poly: readonly (readonly [number, number])[]; readonly u: V3; readonly v: V3 } {
  const u0 = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
  const ul = Math.hypot(...u0);
  const u: V3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v = cross(n, u);
  const flat = (p: V3): [number, number] => [dot(p, u), dot(p, v)];
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
  return { poly, u, v };
}

/** The area two triangles on one plane share. */
function sharedArea(a: Triangle, b: Triangle): number {
  const { poly } = overlapAlong(a.normal, a, b);
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

/** Both builds the planner draws: a computer's, and a phone's with fewer segments to its round things. */
const DETAILS = [{ name: "full", detail: FRONT_DETAIL_FULL }, { name: "light, as phones draw it", detail: FRONT_DETAIL_LIGHT }];

describe("the measured front against the window wall's body", () => {
  it.each(DETAILS)("keeps every face off the body's planes where the two overlap ($name)", ({ detail }) => {
    const overlaps = frontOnBody(buildHallFront(detail).geometry, buildWallBody().geometry);
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
  it.each(DETAILS)("meet one another back to back or flush in one material, never two materials on one plane ($name)", ({ detail }) => {
    const { backToBack, mixedFlush } = frontOnItself(buildHallFront(detail).geometry);
    expect(mixedFlush.slice(0, 5)).toEqual([]);
    // The touching pairs whose ties the cut pass wins (hall-exterior-material.ts CUT_EYEWARD): many, all inside the stone.
    expect(backToBack).toBeGreaterThan(0);
  });
});

/**
 * Each triangle's solid: triangles joined along shared edges, their corners welded to a micrometre. A closed
 * solid's faces meet edge to edge; two solids that touch, or are let into each other, do not.
 */
function solidsOf(list: readonly Triangle[]): number[] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    for (let node = i; parent[node] !== root;) {
      const next = parent[node] ?? root;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const weld = (p: V3): string => p.map((x) => Math.round(x * 1e6)).join(",");
  const owner = new Map<string, number>();
  list.forEach((t, i) => {
    const keys = t.corners.map(weld);
    for (let e = 0; e < 3; e++) {
      const a = keys[e] ?? "";
      const b = keys[(e + 1) % 3] ?? "";
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = owner.get(edge);
      if (other === undefined) owner.set(edge, i);
      else parent[find(i)] = find(other);
    }
  });
  return list.map((_, i) => find(i));
}

/** Two faces of one solid within this of looking opposite ways are its two sides: 10°, under the front's sharpest edge (16°). */
const OPPOSED = Math.cos((10 * Math.PI) / 180);

interface ThinPlace {
  readonly mm: number;
  readonly at: readonly number[];
  readonly part: number;
}

/**
 * How far behind a's plane b's lies, along a's normal, at each corner of the area the two share seen along it:
 * the least, where, and the mean (null where they share none). Taken from a's own plane, the gap between faces a
 * fraction of a degree out of parallel reads true however far they stand from the origin; the difference of the
 * two planes' offsets from the origin does not (it read the dome's ribs, 49.5 mm across, as 8.4 mm).
 */
function gapBehind(a: Triangle, b: Triangle): { readonly least: number; readonly mean: number; readonly at: V3 } | null {
  const n = a.facing;
  const { poly, u, v } = overlapAlong(n, a, b);
  if (poly.length < 3 || Math.abs(signedArea(poly)) <= 1e-6) return null;
  const h = dot(n, a.corners[0]);
  const across = dot(n, b.facing);
  let least = Infinity;
  let sum = 0;
  let at: V3 = a.corners[0];
  for (const [s, t] of poly) {
    const q: V3 = [u[0] * s + v[0] * t + n[0] * h, u[1] * s + v[1] * t + n[1] * h, u[2] * s + v[2] * t + n[2] * h];
    const gap = dot(sub(q, b.corners[0]), b.facing) / across;
    sum += gap;
    if (gap < least) {
      least = gap;
      at = q;
    }
  }
  return { least, mean: sum / poly.length, at };
}

/**
 * Where one of the front's solids is thinner than `least`: two of its faces looking opposite ways (OPPOSED),
 * the solid between them and one over the other, closer than that. A pair whose mean gap is under 1e-5 m (float
 * noise) is two solids touching (frontOnItself), and a pair whose mean gap is negative is two faces looking at
 * each other across air: both are left out. Only faces near each other are compared, through a grid of
 * quarter-metre cells over their bounds.
 */
function thinPlaces(front: BufferGeometry, least: number): ThinPlace[] {
  const part = front.getAttribute("aPart");
  const list = triangles(front);
  const solid = solidsOf(list);
  const cellOf = (x: number): number => Math.floor(x / 0.25);
  const boxes = list.map(({ corners: [p, q, r] }): { readonly lo: V3; readonly hi: V3 } => ({
    lo: [Math.min(p[0], q[0], r[0]) - least, Math.min(p[1], q[1], r[1]) - least, Math.min(p[2], q[2], r[2]) - least],
    hi: [Math.max(p[0], q[0], r[0]) + least, Math.max(p[1], q[1], r[1]) + least, Math.max(p[2], q[2], r[2]) + least],
  }));
  const cells = (box: { readonly lo: V3; readonly hi: V3 }, visit: (key: number) => void): void => {
    for (let x = cellOf(box.lo[0]); x <= cellOf(box.hi[0]); x++) {
      for (let y = cellOf(box.lo[1]); y <= cellOf(box.hi[1]); y++) {
        for (let z = cellOf(box.lo[2]); z <= cellOf(box.hi[2]); z++) visit(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512));
      }
    }
  };
  const grid = new Map<number, number[]>();
  boxes.forEach((box, i) => {
    cells(box, (key) => {
      const bucket = grid.get(key);
      if (bucket === undefined) grid.set(key, [i]); else bucket.push(i);
    });
  });
  const met = new Int32Array(list.length).fill(-1);
  const found: ThinPlace[] = [];
  list.forEach((a, i) => {
    const box = boxes[i];
    if (box === undefined) return;
    cells(box, (key) => {
      for (const j of grid.get(key) ?? []) {
        if (j <= i || met[j] === i) continue;
        met[j] = i;
        const b = list[j];
        const other = boxes[j];
        if (b === undefined || other === undefined || solid[i] !== solid[j] || dot(a.facing, b.facing) > -OPPOSED) continue;
        if (other.lo[0] > box.hi[0] || other.lo[1] > box.hi[1] || other.lo[2] > box.hi[2]) continue;
        if (other.hi[0] < box.lo[0] || other.hi[1] < box.lo[1] || other.hi[2] < box.lo[2]) continue;
        // Read from each face's plane in turn. Positions are single precision: a hundredth of a millimetre
        // either way is the same thickness.
        for (const [from, to] of [[a, b], [b, a]] as const) {
          const gap = gapBehind(from, to);
          if (gap === null || gap.mean <= 1e-5 || gap.least >= least - 1e-5) continue;
          found.push({
            mm: Math.round(gap.least * 1e5) / 100,
            at: gap.at.map((x) => Math.round(x * 1000) / 1000),
            part: Math.round(part.getX(from.vertex)),
          });
        }
      }
    });
  });
  return found;
}

/** The pavilion doorways' crowns, in the planner's frame. */
const DOORWAY_CROWNS = GROUND_OPENINGS.filter((opening) => opening.fill === "doorway").map((opening) => frontPoint(opening.u, opening.top + opening.rise, 0));
const atADoorwayCrown = (place: ThinPlace): boolean =>
  DOORWAY_CROWNS.some(([x, y]) => Math.abs((place.at[0] ?? 0) - x) < 0.05 && Math.abs((place.at[1] ?? 0) - y) < 0.01);

describe("the measured front's solids against the cut's pull", () => {
  it.each(DETAILS)("keep twice the pull between faces looking opposite ways across them, and over the pavilion doorways' crowns, the one exception, more than the pull ($name)", ({ detail }) => {
    // The cut pass draws each solid's far side up to CUT_EYEWARD_MAX toward the eye (hall-exterior-material.ts).
    // A solid thinner than that would show its far side, in the cut's colour, over its own near side. At twice
    // the pull it keeps half its thickness in hand against the depth buffer's rounding far off. (The pediment's
    // raking cornice, cut as one ring round the tympanum, had a millimetre's sliver along its foot.)
    const thin = thinPlaces(buildHallFront(detail).geometry, 2 * CUT_EYEWARD_MAX);
    expect(thin.filter((place) => !atADoorwayCrown(place)).slice(0, 5)).toEqual([]);
    // The ground floor's wall stops at the hall's floor, as surveyed 4 mm over each pavilion doorway's crown: the
    // stone between the wall's level top and the arch's facets either side of the crown, each 3.5° off level. It
    // shows only from below, through the arch's soffit. The orbit always looks at least 3.6° down and its frame
    // reaches 27.5° above its centre, so no ray it draws rises more than about 24°, and each crosses at least
    // 9.9 mm of that stone, about four times the pull. From at or above the pavement it is more than four times,
    // and more than a depth step beyond the pull out past the far plane; from below the pavement, which only the
    // mouse's and two fingers' pans reach, it is a depth step beyond the pull to about 110 m.
    const crowns = thin.filter(atADoorwayCrown);
    expect(crowns.length).toBeGreaterThan(0);
    expect(Math.min(...crowns.map((place) => place.mm)) / 1000).toBeGreaterThan(CUT_EYEWARD_MAX);
  });

  it("measures each gap from one face's own plane, so faces a fraction of a degree out of parallel read true far from the origin", () => {
    // A copper slab 49.5 mm thick, a dome rib's width, 17 m up, one side turned 0.2° out of parallel. The
    // difference of its two sides' plane offsets from the origin comes to about -10 mm.
    const slab = new BoxGeometry(0.0495, 1, 1);
    const position = slab.getAttribute("position");
    const turn = Math.tan((0.2 * Math.PI) / 180);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setXYZ(i, x > 0 ? x + turn * y : x, y + 17, position.getZ(i));
    }
    slab.setAttribute("aPart", new Float32BufferAttribute(new Array<number>(position.count).fill(FRONT_PART.copper), 1));
    // Thinnest along the turned side's lower edge: 49.5 mm less half a metre's turn.
    expect(Math.min(...thinPlaces(slab, 0.06).map((place) => place.mm))).toBeCloseTo(49.5 - 500 * turn, 1);
  });
});

describe("the cut's tie-break against the pieces let into their holders", () => {
  it("draws the cut toward the eye by at most half a let-in, a share of its distance out to 10 m", () => {
    // A piece's end let LET_IN into its holder lies that far behind the holder's own face, and the thinnest
    // glass is 12 mm thick: the cut, drawn at most CUT_EYEWARD_MAX toward the eye, never reaches either.
    expect(CUT_EYEWARD_MAX).toBeLessThanOrEqual(LET_IN / 2);
    expect(CUT_EYEWARD * 10).toBeCloseTo(CUT_EYEWARD_MAX, 9);
  });
});
