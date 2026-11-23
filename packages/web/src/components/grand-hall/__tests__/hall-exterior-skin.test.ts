import { describe, expect, it } from "vitest";
import { BoxGeometry, Float32BufferAttribute, type BufferGeometry } from "three";
import { buildHallFront, DOORWAY_FILL, FRONT_DETAIL_FULL, FRONT_DETAIL_LIGHT, FRONT_PART, frontPoint, LET_IN, openingOutline, outsetLoop, type HallFrontJoin } from "../hall-exterior.js";
import { BALUSTRADES, FRONT_AXIS_X, FRONT_BAYS, FRONT_FACE_Z, FRONT_LEVELS, FRONT_PAVEMENT_Y, GROUND_OPENINGS, LINK_FACE_PROUD, TEMPLE } from "../hall-exterior-spec.js";
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
function frontOnItself(front: BufferGeometry): {
  readonly backToBack: number;
  readonly mixedFlush: readonly { readonly at: readonly number[]; readonly parts: readonly number[] }[];
  readonly contacts: readonly { readonly parts: readonly [number, number]; readonly normal: V3; readonly offset: number }[];
} {
  const part = front.getAttribute("aPart");
  const byNormal = new Map<string, Triangle[]>();
  for (const t of triangles(front)) {
    const key = t.normal.map((x) => Math.round(x * 200)).join(",");
    const list = byNormal.get(key);
    if (list === undefined) byNormal.set(key, [t]); else list.push(t);
  }
  let backToBack = 0;
  const mixedFlush: { at: readonly number[]; parts: readonly number[] }[] = [];
  const contacts: { parts: readonly [number, number]; normal: V3; offset: number }[] = [];
  for (const list of byNormal.values()) {
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b === undefined || b.offset - a.offset > ON_PLANE) break;
        if (dot(a.normal, b.normal) < 0.99995 || sharedArea(a, b) <= 1e-6) continue;
        const parts: [number, number] = [Math.round(part.getX(a.vertex)), Math.round(part.getX(b.vertex))];
        if (dot(a.facing, b.facing) < 0) {
          backToBack += 1;
          contacts.push({ parts, normal: a.normal, offset: a.offset });
          continue;
        }
        if (parts[0] !== parts[1]) {
          const [p, q, r] = a.corners;
          mixedFlush.push({ at: [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]].map((x) => Math.round((x / 3) * 1000) / 1000), parts });
        }
      }
    }
  }
  return { backToBack, mixedFlush, contacts };
}

describe("the measured front's own solids", () => {
  it.each(DETAILS)("meet one another back to back or flush in one material, never two materials on one plane ($name)", ({ detail }) => {
    const { backToBack, mixedFlush } = frontOnItself(buildHallFront(detail).geometry);
    expect(mixedFlush.slice(0, 5)).toEqual([]);
    // The touching pairs whose ties the cut pass wins (hall-exterior-material.ts CUT_EYEWARD): many, all inside the stone.
    expect(backToBack).toBeGreaterThan(0);
  });
});

interface Contact {
  readonly parts: readonly [number, number];
  readonly normal: V3;
  readonly offset: number;
  /** How far the two solids run into each other along the normal: 0 where they only touch. */
  readonly depth: number;
  /** Where, as (u, z over the pavement), to the centimetre. */
  readonly at: readonly number[];
}

/**
 * Where two of the front's solids meet on one plane, or within LET_IN of it, overlapping:
 * - `rests`: faces looking opposite ways, from the two touching (a hundredth of a millimetre apart either way is
 *   float noise) to one let into the other by less than LET_IN, so that a let-in cut back to the pull's own depth is
 *   found too. Two faces looking at each other across air are no contact. A solid thinner than LET_IN would show here
 *   as resting on itself; thinPlaces keeps every one at least twice the pull thick.
 * - `flush`: faces of two solids looking the same way, closer than LET_IN: the solid behind ends its sides on, or
 *   within the pull of, the other's face, as flush pieces' sides do at a split (crossed glazing bars, the review's K4).
 *   Faces looking into the building are left out: there the sash bars' backs lie together inside their 12 mm glass,
 *   where no two depths LET_IN apart fit, and the hall's windows look out at no glazing.
 */
function touches(front: BufferGeometry): { readonly rests: readonly Contact[]; readonly flush: readonly Contact[] } {
  const part = front.getAttribute("aPart");
  const list = triangles(front);
  const solid = solidsOf(list);
  const boxes = list.map(({ corners: [p, q, r] }): { readonly lo: V3; readonly hi: V3 } => ({
    lo: [Math.min(p[0], q[0], r[0]), Math.min(p[1], q[1], r[1]), Math.min(p[2], q[2], r[2])],
    hi: [Math.max(p[0], q[0], r[0]), Math.max(p[1], q[1], r[1]), Math.max(p[2], q[2], r[2])],
  }));
  const byNormal = new Map<string, number[]>();
  list.forEach((t, i) => {
    const key = t.normal.map((x) => Math.round(x * 200)).join(",");
    const group = byNormal.get(key);
    if (group === undefined) byNormal.set(key, [i]); else group.push(i);
  });
  const rests: Contact[] = [];
  const flush: Contact[] = [];
  // Into the building: the opposite of frontDirection(0, 0, 1), the street's way, in the planner's frame.
  const inward: V3 = [0, 0, 1];
  for (const group of byNormal.values()) {
    const sorted = [...group].sort((i, j) => (list[i]?.offset ?? 0) - (list[j]?.offset ?? 0));
    for (let x = 0; x < sorted.length; x++) {
      const i = sorted[x] ?? 0;
      const a = list[i];
      const boxA = boxes[i];
      if (a === undefined || boxA === undefined) continue;
      for (let y = x + 1; y < sorted.length; y++) {
        const j = sorted[y] ?? 0;
        const b = list[j];
        const boxB = boxes[j];
        if (b === undefined || boxB === undefined) continue;
        if (b.offset - a.offset >= LET_IN - 1e-4) break;
        if (dot(a.normal, b.normal) < 0.99995) continue;
        const opposed = dot(a.facing, b.facing) < -0.99995;
        if (!opposed && (solid[i] === solid[j] || dot(a.facing, inward) > 0.99)) continue;
        if ([0, 1, 2].some((k) => (boxA.lo[k] ?? 0) > (boxB.hi[k] ?? 0) + LET_IN || (boxB.lo[k] ?? 0) > (boxA.hi[k] ?? 0) + LET_IN)) continue;
        if (sharedArea(a, b) <= 1e-6) continue;
        const pa = Math.round(part.getX(a.vertex));
        const pb = Math.round(part.getX(b.vertex));
        const [p, q, r] = a.corners;
        const at = [FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y].map((v) => Math.round(v * 100) / 100);
        const parts: readonly [number, number] = pa <= pb ? [pa, pb] : [pb, pa];
        if (!opposed) {
          flush.push({ parts, normal: a.normal, offset: a.offset, depth: b.offset - a.offset, at });
          continue;
        }
        // A face looking along the plane's normal has its solid on the lower side, one looking against it on the
        // higher. a lies lower: looking against the normal, its solid runs up into b's by b's offset less its own;
        // looking along it, the two stand apart by as much.
        const depth = dot(a.facing, a.normal) > 0 ? a.offset - b.offset : b.offset - a.offset;
        if (depth < -1e-5) continue;
        rests.push({ parts, normal: a.normal, offset: a.offset, depth, at });
      }
    }
  }
  return { rests, flush };
}

/**
 * Where two pieces meet face to face, the face of one seen from inside ends at the outside along their meeting: on its
 * holder's outer face (a panel resting on its leaf, a bar on its glass, a frame on its jambs, sill and head), or
 * between two flush outer faces (a row's pieces, a frame built on a row). The cut pass, drawn up to half a let-in
 * toward the eye, shows it there across a fraction of a pixel that the camera's least movement deals again: dotted
 * lines down and across the pavilion doorways' white frames, and dots round the front door's panels (WebGPU, four
 * samples a pixel and no temporal blend, as phones draw; 14 Nov 2026). A let-in (LET_IN) shields it where the
 * holder's face stands in front; flush pieces must be one solid. A solid's own right-angled edge whose side faces away
 * still shows it, and so do the masonry's own joints, stone on stone, flush at a jamb or a member stacked on another:
 * those are T-725's, whose cure takes the pull away (hall-exterior-material.ts).
 */
describe("the cut pass along the seams of pieces that touch", () => {
  const { stone: STONE, glass: GLASS, paint: PAINT, timber: TIMBER, copper: COPPER, lead: LEAD, metal: METAL } = FRONT_PART;
  const pavilionDoorways = GROUND_OPENINGS.filter((opening) => opening.fill === "doorway");
  /** The front's street-facing triangles of one part whose centre lies within an opening's width, between two heights over the pavement. */
  const streetFacing = (front: BufferGeometry, part: number, u0: number, u1: number, z0: number, z1: number): number => {
    const parts = front.getAttribute("aPart");
    return triangles(front).filter((t) => {
      if (t.facing[2] > -0.99 || Math.round(parts.getX(t.vertex)) !== part) return false;
      const [p, q, r] = t.corners;
      const u = FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3;
      const z = (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y;
      return u > u0 && u < u1 && z > z0 && z < z1;
    }).length;
  };
  it("reads the front's own coordinates back from the planner's, as these tests do", () => {
    const [x, y, z] = frontPoint(1.5, 2.25, 0.3);
    expect(FRONT_AXIS_X - x).toBeCloseTo(1.5, 12);
    expect(y - FRONT_PAVEMENT_Y).toBeCloseTo(2.25, 12);
    expect(FRONT_FACE_Z - z).toBeCloseTo(0.3, 12);
  });
  /** touches() over the whole front once per build. */
  const found = new Map<string, ReturnType<typeof touches>>();
  const touchesOf = (name: string, front: BufferGeometry): ReturnType<typeof touches> => {
    const known = found.get(name);
    if (known !== undefined) return known;
    const fresh = touches(front);
    found.set(name, fresh);
    return fresh;
  };
  it.each(DETAILS)("lets every piece of paint, glass, timber, metal, copper and lead into what holds it, in every plane: none rests on another or is let in by less than LET_IN ($name)", ({ name, detail }) => {
    const front = buildHallFront(detail).geometry;
    const contacts = touchesOf(name, front).rests;
    // The detector is live in each of the front's three directions (the masonry resting on itself, T-725's), and
    // every other material is drawn.
    for (const axis of [0, 1, 2] as const) {
      expect(contacts.filter((c) => c.parts[0] === STONE && c.parts[1] === STONE && Math.abs(c.normal[axis]) > 0.99).length).toBeGreaterThan(0);
    }
    const drawn = new Set<number>();
    const parts = front.getAttribute("aPart");
    for (let i = 0; i < parts.count; i++) drawn.add(Math.round(parts.getX(i)));
    for (const part of [GLASS, PAINT, TIMBER, METAL, COPPER, LEAD]) expect(drawn.has(part)).toBe(true);
    expect(contacts.filter((c) => c.parts[0] !== STONE || c.parts[1] !== STONE).slice(0, 8)).toEqual([]);
  });
  it.each(DETAILS)("stands one of any two overlapping pieces, where either is paint, glass, timber, metal, copper or lead, at least LET_IN proud of the other, or makes them one solid ($name)", ({ name, detail }) => {
    const { flush } = touchesOf(name, buildHallFront(detail).geometry);
    // Live: the masonry's own flush overlaps (the course bands' ends on the openings' jambs, let in past them), T-725's.
    expect(flush.filter((c) => c.parts[0] === STONE && c.parts[1] === STONE).length).toBeGreaterThan(0);
    expect(flush.filter((c) => c.parts[0] !== STONE || c.parts[1] !== STONE).slice(0, 8)).toEqual([]);
  });
  it.each(DETAILS)("ends each fanlight bar in its fanlight's frame: no paint crosses a pavilion doorway's side lights ($name)", ({ detail }) => {
    const front = buildHallFront(detail).geometry;
    const parts = front.getAttribute("aPart");
    const { frame, doorHalf } = DOORWAY_FILL;
    const centre = (t: Triangle): readonly [number, number] => {
      const [p, q, r] = t.corners;
      return [FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y];
    };
    const paint = triangles(front).filter((t) => Math.round(parts.getX(t.vertex)) === PAINT);
    // The side lights' glass, a centimetre in from the frame round it, either side of each door.
    const inALight = ([u, z]: readonly [number, number]): boolean => pavilionDoorways.some((o) => {
      const off = Math.abs(u - o.u);
      return off > doorHalf + frame + 0.01 && off < o.width / 2 - frame - 0.01 && z > o.bottom + 0.56 && z < o.top - frame - 0.01;
    });
    expect(paint.filter((t) => inALight(centre(t))).length).toBe(0);
    // Live: the bars are drawn, slanting across each fanlight over its transom.
    const slanting = paint.filter((t) => t.facing.every((x) => Math.abs(x) < 0.99) && pavilionDoorways.some((o) => {
      const [u, z] = centre(t);
      return Math.abs(u - o.u) < o.width / 2 && z > o.top && z < o.top + o.rise;
    }));
    expect(slanting.length).toBeGreaterThan(0);
  });
  it.each(DETAILS)("seats each link attic window's glass inside its 63 mm skin, where the stone round it holds it ($name)", ({ detail }) => {
    const front = buildHallFront(detail).geometry;
    const parts = front.getAttribute("aPart");
    const a = BALUSTRADES.linkAttic;
    const links = FRONT_BAYS.filter((bay) => bay.kind === "link");
    const glass = triangles(front).filter((t) => {
      if (Math.round(parts.getX(t.vertex)) !== GLASS) return false;
      const [p, q, r] = t.corners;
      const u = FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3;
      const z = (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y;
      return z > a.windowBottom - 0.01 && z < a.windowTop + 0.01 && links.some((bay) => Math.abs(u - (bay.uMin + bay.uMax) / 2) < a.windowWidth / 2 + 0.01);
    });
    expect(glass.length).toBeGreaterThan(0);
    // Between the skin's back, 4 mm off the window wall's plane, and the link's face.
    const proud = glass.flatMap((t) => t.corners.map((corner) => FRONT_FACE_Z - corner[2]));
    expect(Math.min(...proud)).toBeGreaterThan(0.004);
    expect(Math.max(...proud)).toBeLessThan(LINK_FACE_PROUD);
  });
  it.each(DETAILS)("lets the course bands, the plinth and the voussoirs into the wall behind them: no stone rests on the channels' floor ($name)", ({ name, detail }) => {
    // The channels' floor is the ground floor's wall face, open between the bands (hall-exterior.ts groundFloor), as
    // the planner's z of each bay's plane. Each band's back only resting on it would end on it along every channel.
    const floorZ = (bay: (typeof FRONT_BAYS)[number]): number => FRONT_FACE_Z - (bay.kind === "temple" ? TEMPLE.podiumProud - FRONT_LEVELS.channelDepth : bay.proud);
    const inBay = (u: number, z: number, offset: number): boolean => z < FRONT_LEVELS.stringBottom
      && FRONT_BAYS.some((bay) => u > bay.uMin && u < bay.uMax && Math.abs(offset - floorZ(bay)) < 1e-4);
    const front = buildHallFront(detail).geometry;
    // Live: the channels' floor is drawn at those planes, facing the street.
    const floorFaces = triangles(front).filter((t) => {
      const [p, q, r] = t.corners;
      return t.facing[2] < -0.99 && inBay(FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y, t.offset);
    });
    expect(floorFaces.length).toBeGreaterThan(0);
    const resting = touchesOf(name, front).rests.filter((c) => c.parts[0] === STONE && c.parts[1] === STONE && Math.abs(c.normal[2]) > 0.99
      && inBay(c.at[0] ?? 0, c.at[1] ?? Infinity, c.offset));
    expect(resting.slice(0, 5)).toEqual([]);
  });
  it.each(DETAILS)("builds each row as one solid, and each pavilion doorway's frame with its row: no face of any material lies in a join ($name)", ({ detail }) => {
    const build = buildHallFront(detail);
    const list = triangles(build.geometry);
    // The rows: the shopfronts' and pavilion doorways' white frames and the pavilion attics' stone rows, split between
    // their holes; and each pavilion doorway's frame on its row along the transom. Both are drawn there.
    expect(pavilionDoorways.length).toBe(2);
    expect(build.joins.filter((join) => join.axis === "z").length).toBe(pavilionDoorways.length);
    expect(build.joins.filter((join) => join.axis === "u").length).toBeGreaterThan(pavilionDoorways.length);
    for (const opening of pavilionDoorways) {
      const [u0, u1] = [opening.u - opening.width / 2, opening.u + opening.width / 2];
      expect(streetFacing(build.geometry, PAINT, u0, u1, opening.top - 0.2, opening.top)).toBeGreaterThan(0);
      expect(streetFacing(build.geometry, PAINT, u0, u1, opening.top, opening.top + opening.rise)).toBeGreaterThan(0);
    }
    // A face of any material lying in a join's plane, within it, and looking across it: the row's sides at a split, or
    // the frame's foot along the transom, even a micrometre low (the foot's vertices sit 1e-6 under it). The
    // triangulator's slivers along the transom in the frame's own front are no such face.
    const facesIn = (join: HallFrontJoin): number => list.filter((t) => Math.abs(t.facing[join.axis === "u" ? 0 : 1]) > 0.99 && t.corners.every((corner) => {
      const [u, z, proud] = [FRONT_AXIS_X - corner[0], corner[1] - FRONT_PAVEMENT_Y, FRONT_FACE_Z - corner[2]];
      const [along, across] = join.axis === "u" ? [u, z] : [z, u];
      return Math.abs(along - join.at) < 1e-5 && across > join.from - 1e-6 && across < join.to + 1e-6 && proud > join.back - 1e-6 && proud < join.front + 1e-6;
    })).length;
    expect(build.joins.filter((join) => facesIn(join) > 0)).toEqual([]);
    // The same count finds a row's own foot on its sill and its own outer end, where it has faces, across a z plane and
    // across a u plane: each pavilion doorway's.
    for (const join of build.joins.filter((j) => j.axis === "z")) {
      const opening = pavilionDoorways.find((o) => Math.abs(o.top - join.at) < 1e-9);
      expect(opening).toBeDefined();
      expect(facesIn({ ...join, at: (opening?.bottom ?? Number.NaN) - LET_IN })).toBeGreaterThan(0);
      expect(facesIn({ axis: "u", at: join.from, from: (opening?.bottom ?? Number.NaN) - LET_IN, to: join.at, back: join.back, front: join.front })).toBeGreaterThan(0);
    }
  });
  it.each(DETAILS)("lets each fanlight's glass into what holds it at the crown: the front door's into the stone, the pavilion doorways' into their frames ($name)", ({ detail }) => {
    const front = buildHallFront(detail).geometry;
    const parts = front.getAttribute("aPart");
    const glass = triangles(front).filter((t) => Math.round(parts.getX(t.vertex)) === GLASS);
    // The highest glass of an opening's own (within its width, and no higher than 10 cm over its crown: the attics'
    // windows stand over the pavilion doorways), over the pavement.
    const glassTop = (opening: (typeof GROUND_OPENINGS)[number]): number => Math.max(...glass.filter((t) => {
      const [p, q, r] = t.corners;
      const z = (p[1] + q[1] + r[1]) / 3 - FRONT_PAVEMENT_Y;
      return Math.abs(FRONT_AXIS_X - (p[0] + q[0] + r[0]) / 3 - opening.u) < opening.width / 2 + 0.02 && z < opening.top + opening.rise + 0.1;
    }).flatMap((t) => t.corners.map((corner) => corner[1] - FRONT_PAVEMENT_Y)));
    const door = GROUND_OPENINGS.find((opening) => opening.fill === "front-door");
    expect(door).toBeDefined();
    if (door !== undefined) expect(glassTop(door)).toBeGreaterThanOrEqual(door.top + door.rise + LET_IN - 1e-5);
    // The pavilion doorways' glass stops in the frame's band round the crown, LET_IN or more from both of its edges.
    for (const opening of pavilionDoorways) {
      const crown = opening.top + opening.rise;
      expect(glassTop(opening)).toBeLessThanOrEqual(crown + 1e-5);
      expect(glassTop(opening)).toBeGreaterThanOrEqual(crown - DOORWAY_FILL.frame + LET_IN - 1e-5);
    }
  });
  it("grows a pavilion doorway's outline exactly, every edge LET_IN out and parallel, and refuses an outline it cannot grow exactly", () => {
    const opening = pavilionDoorways[0];
    expect(opening).toBeDefined();
    if (opening === undefined) return;
    const outline = openingOutline(opening.u, opening.width / 2, opening.bottom, opening.top, opening.rise);
    const grown = outsetLoop(outline, LET_IN);
    expect(grown).toHaveLength(outline.length);
    // Each grown edge's two ends lie LET_IN out along the edge's own outward normal (the outline runs counter-clockwise).
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length] ?? a;
      const [ga, gb] = [grown[i] ?? a, grown[(i + 1) % grown.length] ?? b];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [nu, nz] = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
      expect((ga[0] - a[0]) * nu + (ga[1] - a[1]) * nz).toBeCloseTo(LET_IN, 12);
      expect((gb[0] - b[0]) * nu + (gb[1] - b[1]) * nz).toBeCloseTo(LET_IN, 12);
    });
    // A notch, a doubled point and a sharp spike have no exact outset.
    expect(() => outsetLoop([[0, 0], [2, 0], [2, 2], [1, 1], [0, 2]], LET_IN)).toThrow();
    expect(() => outsetLoop([[0, 0], [1, 0], [1, 0], [1, 1], [0, 1]], LET_IN)).toThrow();
    expect(() => outsetLoop([[0, 0], [1, 0], [0.5, 0.1]], LET_IN)).toThrow();
  });
});

/**
 * Each triangle's solid: triangles joined along the edges they share. A closed solid's faces meet edge to edge; two
 * solids that touch, or are let into each other, do not. Corners are keyed on a ten-micrometre grid, which only absorbs
 * float noise (the front's largest coordinate is about 24 m, whose float32 step is 1.9 µm): each pavilion doorway's row
 * and frame are one solid by the exact edges their sides share at the transom's two ends.
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
  const weld = (p: V3): string => p.map((x) => Math.round(x * 1e5)).join(",");
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
