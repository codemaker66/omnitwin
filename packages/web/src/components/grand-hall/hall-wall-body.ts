// ---------------------------------------------------------------------------
// The walls' bodies: each wall cut as a model maker would, through its real
// thickness, with every window and door open through it
//
// Pure: no renderer. Each wall's body is a solid from the room's plane (where
// the scanned relief stands) out to its outer face, as thick as the wall is
// (HALL_WALL_THICKNESS, with the door wall's measured departures in
// HALL_WALL_STRETCHES), from the floor to the relief's own top (6.70 m, where
// the attic panelling meets the ceiling). Every opening goes through it:
//
//   - In front, from the room's plane back to two centimetres behind the
//     deepest relief inside a window, the hole is the relief's own footprint
//     there (OPENING_RELIEF, measured on walls-relief.bin): the scanned
//     reveals and curtains line it, so the body puts no face there (two
//     surfaces would fight for the same pixels). In a doorway the hole goes
//     back to just behind its leaves' face (doorRevealDepth less
//     DOOR_LINING_SET: the leaves are modelled, hall-doors.ts, and the drawn
//     relief stops there, hall-walls.ts), DOOR_FRAME wider than the doorway
//     each side, so a face toward the room stands behind every chink the
//     scanned reveal leaves at the jambs.
//   - Behind, out to the outer face, the hole is the opening itself: a
//     window's masonry opening, lined by its painted and stone outer reveal
//     (hall-glazing.ts) and by the body only where that reveal stops short of
//     the outer face; a doorway, lined by jambs and a head of its own.
//
// The cutaway lowers a wall by moving its body's vertices in the shader, never
// by moving objects: every vertex carries its wall (and, at the four outer
// corners, the neighbouring wall), its role and the floor of the piece of
// wall it belongs to, and rises no higher than the cut (bodyVertexHeight
// mirrors the rule). The body is built of pieces with upright sides, so the
// clamp keeps their outlines exact; a top face clamped to the cut becomes the
// section. Over each door the walling (its lintel) drops away whenever the
// wall is cut to Plan height or lower, so every doorway reads from above, the
// fire exit's head 5 cm under the dado cut too.
//
// The doorways' oak thresholds (buildThresholds) lie 8 mm above the floor's
// level: the plinth ring and, beyond the city model's cut-out, the city's own
// caps lie at y = 0 under them, and 8 mm is several depth steps at any
// distance the planner allows.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry } from "three";
import { sampleHallLight } from "./hall-lighting-model.js";
import { glazingOutline, revealOuterDepth } from "./hall-glazing.js";
import type { HallBuilders } from "./hall-builders.js";
import type { V3 } from "./mesh-builder.js";
import {
  HALL_ELEVATION,
  HALL_OPENINGS,
  HALL_WALLS,
  HALL_WALL_STRETCHES,
  hallDoor,
  hallGlazing,
  wallPoint,
  wallThicknessAt,
  type HallDoor,
  type HallOpening,
  type HallWall,
} from "./hall-spec.js";

/** The top of every wall's body: the relief's own top (its v range ends at 6.70 m). */
export const WALL_BODY_TOP = 6.7;

/**
 * A wall cut at or below this height loses the walling over its doors, so
 * every doorway reads from above: Plan (3.12 m) and the dado cut (1.92 m)
 * both lie below it. A wall cut higher, while the cutaway eases or for a
 * camera standing high outside it, keeps its real lintels rather than
 * opening slots over the doors.
 */
export const LINTEL_RELEASE = 3.5;

/** How far behind the deepest relief in an opening its body's lining begins. */
export const RELIEF_CLEARANCE = 0.02;

/** The doorways' thresholds stand this far above the floor's level. */
export const THRESHOLD_HEIGHT = 0.008;

/** What a vertex does as the cut moves (bodyVertexHeight). */
export const BODY_ROLE = { body: 0, lintel: 1, lintelJamb: 2, capOnly: 3 } as const;
export type BodyRole = (typeof BODY_ROLE)[keyof typeof BODY_ROLE];

/** Which finish a face takes (hall-section.ts colours them). */
export const BODY_FINISH = { outer: 0, cap: 1, doorLining: 2, windowLining: 3, section: 4, cornerCap: 5 } as const;
export type BodyFinish = (typeof BODY_FINISH)[keyof typeof BODY_FINISH];

/**
 * The scanned relief's footprint at each opening (where it lies more than
 * 5 cm behind the wall's plane): how far its edges stand outside the
 * opening's outline (HALL_OPENINGS) at each jamb, the head and the sill, and
 * the deepest relief inside it, metres. Measured on the shipped
 * walls-relief.bin (1 cm depth maps, the -5 cm crossing found along each
 * edge's normal, medians; 20 October 2026). The end arches' corner-side
 * jambs open into side lights that run on to the wall's corner; they take
 * their other jamb's figure, so the body keeps its corner.
 * __tests__/hall-wall-body.test.ts measures them again on the relief.
 */
export interface OpeningRelief {
  readonly opening: string;
  readonly left: number;
  readonly right: number;
  readonly head: number;
  readonly sill: number;
  readonly deepest: number;
}

export const OPENING_RELIEF: readonly OpeningRelief[] = [
  { opening: "arch-fireplace", left: 0.016, right: 0.016, head: 0.047, sill: 0.058, deepest: -0.9028 },
  { opening: "window-fireplace", left: 0.037, right: 0.036, head: 0.007, sill: 0.05, deepest: -0.8148 },
  { opening: "arch-centre", left: 0.063, right: 0.062, head: 0.15, sill: -0.017, deepest: -0.5724 },
  { opening: "window-end", left: 0.03, right: 0.037, head: 0.043, sill: 0.006, deepest: -0.8187 },
  { opening: "arch-end", left: 0.03, right: 0.03, head: 0.078, sill: 0.01, deepest: -0.9008 },
  { opening: "door-end", left: 0.006, right: 0.004, head: 0, sill: 0, deepest: -0.0874 },
  { opening: "door-main", left: 0.012, right: 0.016, head: 0.004, sill: 0, deepest: -0.3 },
  { opening: "door-fireplace", left: 0, right: 0, head: 0, sill: 0, deepest: -0.0427 },
  { opening: "door-fire-exit", left: 0, right: 0, head: 0, sill: 0, deepest: -0.0228 },
];

export function openingRelief(id: string): OpeningRelief {
  const relief = OPENING_RELIEF.find((entry) => entry.opening === id);
  if (relief === undefined) throw new Error(`No relief footprint for opening ${id}`);
  return relief;
}

/** A wall-local point (u along the wall, v up). */
export type UV = readonly [number, number];

/**
 * A hole through the wall's elevation, monotone in u: its lower and upper
 * edges as polylines from u0 to u1.
 */
export interface Hole {
  readonly u0: number;
  readonly u1: number;
  readonly lower: readonly UV[];
  readonly upper: readonly UV[];
}

/** A polyline's height at `u` (it runs in increasing u). */
export function chainAt(chain: readonly UV[], u: number): number {
  const first = chain[0];
  if (first === undefined) return 0;
  if (u <= first[0]) return first[1];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    if (a === undefined || b === undefined) continue;
    if (u <= b[0]) return b[0] - a[0] < 1e-12 ? b[1] : a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return chain[chain.length - 1]?.[1] ?? first[1];
}

/** Whether wall-local (u, v) lies inside the hole. */
export function insideHole(hole: Hole, u: number, v: number): boolean {
  return u > hole.u0 && u < hole.u1 && v > chainAt(hole.lower, u) && v < chainAt(hole.upper, u);
}

/** A window's masonry opening: the outline its outer reveal runs round (hall-glazing.ts). */
function windowBackHole(opening: HallOpening): Hole {
  const glazing = hallGlazing(opening.id);
  if (glazing === undefined) throw new Error(`No glazing for window ${opening.id}`);
  const outline = glazingOutline(glazing);
  const us = outline.map((p) => p[0]);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const sill = Math.min(...outline.map((p) => p[1]));
  // The outline runs (left, sill), (right, sill), then up the right jamb and
  // back over the top from right to left; the upper chain is that run reversed.
  const top = outline.slice(2).map((p): UV => [p[0], p[1]]).reverse();
  return { u0, u1, lower: [[u0, sill], [u1, sill]], upper: top };
}

/** A doorway's opening through the wall. */
function doorBackHole(opening: HallOpening): Hole {
  const u0 = opening.centre - opening.width / 2;
  const u1 = opening.centre + opening.width / 2;
  return { u0, u1, lower: [[u0, opening.sill], [u1, opening.sill]], upper: [[u0, opening.head], [u1, opening.head]] };
}

/**
 * The relief's footprint at the wall's plane: the opening's outline moved out
 * to where the relief goes behind the plane (OPENING_RELIEF), never inside the
 * hole behind it. An arch's head is a half-ellipse sampled at the masonry
 * arch's own u stations, so the two holes share their pieces' sides.
 */
function frontHole(opening: HallOpening, back: Hole, margin = 0): Hole {
  const relief = openingRelief(opening.id);
  const half = opening.width / 2;
  const u0 = Math.min(opening.centre - half - Math.max(relief.left, margin), back.u0);
  const u1 = Math.max(opening.centre + half + Math.max(relief.right, margin), back.u1);
  const sill = Math.min(opening.sill - relief.sill, chainAt(back.lower, opening.centre));
  if (opening.kind !== "arched-window") {
    const head = Math.max(opening.head + Math.max(relief.head, margin), ...back.upper.map((p) => p[1]));
    return { u0, u1, lower: [[u0, sill], [u1, sill]], upper: [[u0, head], [u1, head]] };
  }
  const rise = half + relief.head;
  const headAt = (u: number): number => {
    const reach = u < opening.centre ? opening.centre - u0 : u1 - opening.centre;
    const x = (u - opening.centre) / reach;
    return opening.head + rise * Math.sqrt(Math.max(0, 1 - x * x));
  };
  const stations = uniqueSorted([u0, ...back.upper.map((p) => p[0]), u1], 1e-9);
  const upper = stations.map((u): UV => [u, Math.max(headAt(u), u >= back.u0 && u <= back.u1 ? chainAt(back.upper, u) : -Infinity)]);
  return { u0, u1, lower: [[u0, sill], [u1, sill]], upper };
}

/**
 * Where a doorway's lining starts: this far behind its leaves' face (the
 * drawn relief's reveal stops 5 mm behind it, hall-walls.ts, so the two
 * overlap and no slit opens between them while the doors stand open).
 */
export const DOOR_LINING_SET = 0.002;

/**
 * Beside a doorway's jambs and over its head the body stands back to its
 * lining's start this far out (a face toward the room there, behind the
 * doorcase): wherever the scanned relief leaves a chink, at the leaves'
 * corners, where the reveal's edge turns and under the fire exit's sign, the
 * walk sees that face and not into the wall. On the shipped relief the
 * chinks reach up to 3.3 cm beyond a jamb.
 */
export const DOOR_FRAME = 0.04;

/**
 * Where a doorway's scanned reveal stops: at its leaves' hall face. The
 * relief behind it (the shut leaves, and the main door's recess, closed where
 * the scan saw it open) gives way to the modelled leaves (hall-doors.ts) and
 * the body's lining.
 */
export function doorRevealDepth(door: HallDoor): number {
  return door.leafFace;
}

/** An opening as the body cuts it. */
export interface BodyOpening {
  readonly opening: HallOpening;
  /** The hole from the room's plane to `frontDepth`: the relief's footprint (a doorway's at least DOOR_FRAME beside its jambs). */
  readonly front: Hole;
  /** The relief's own footprint at the plane (OPENING_RELIEF). */
  readonly footprint: Hole;
  /** The opening through the rest of the wall. */
  readonly back: Hole;
  /**
   * Where the front hole gives way to the back one (negative): a window's
   * just behind its deepest relief; a doorway's DOOR_LINING_SET behind its
   * leaves' face (doorRevealDepth), its lining overlapping the drawn reveal.
   */
  readonly frontDepth: number;
  /** Behind this depth the body lines the opening itself (a window's reveal stops there). */
  readonly liningFrom: number;
  readonly door: HallDoor | null;
}

/** The openings in `wall`, as the body cuts them. */
export function bodyOpenings(wall: HallWall): BodyOpening[] {
  return HALL_OPENINGS.filter((opening) => opening.wall === wall.id).map((opening) => {
    const door = opening.kind === "door" ? hallDoor(opening.id) ?? null : null;
    const back = door !== null ? doorBackHole(opening) : windowBackHole(opening);
    const footprint = frontHole(opening, back);
    const front = door !== null ? frontHole(opening, back, DOOR_FRAME) : footprint;
    const frontDepth = door !== null ? doorRevealDepth(door) - DOOR_LINING_SET : openingRelief(opening.id).deepest - RELIEF_CLEARANCE;
    const glazing = hallGlazing(opening.id);
    const liningFrom = door !== null || glazing === undefined ? frontDepth : Math.min(frontDepth, revealOuterDepth(glazing));
    return { opening, front, footprint, back, frontDepth, liningFrom, door };
  });
}

/** How far the body reaches behind the wall's plane at `u`: a doorway's own depth inside it. */
export function bodyThicknessAt(wall: HallWall, openings: readonly BodyOpening[], u: number): number {
  for (const entry of openings) {
    if (entry.door !== null && u > entry.back.u0 - 1e-9 && u < entry.back.u1 + 1e-9) return entry.door.depth;
  }
  return wallThicknessAt(wall.id, u);
}

/**
 * Over each doorway, the relief that the section's mask drops with the lintel
 * (hall-materials.ts sectionMask): from the relief's footprint's jambs, above
 * its head. In plan (x, z): the wall's origin and tangent, so u is
 * (p - origin) . tangent.
 */
export interface DoorSlot {
  readonly opening: string;
  readonly wall: number;
  readonly origin: readonly [number, number];
  readonly tangent: readonly [number, number];
  readonly u0: number;
  readonly u1: number;
  readonly head: number;
}

export const DOOR_SLOTS: readonly DoorSlot[] = HALL_WALLS.flatMap((wall, index) =>
  bodyOpenings(wall).filter((entry) => entry.door !== null).map((entry): DoorSlot => ({
    opening: entry.opening.id,
    wall: index,
    origin: [wall.origin[0], wall.origin[2]],
    tangent: [wall.tangent[0], wall.tangent[2]],
    u0: entry.footprint.u0,
    u1: entry.footprint.u1,
    head: Math.max(...entry.footprint.upper.map((p) => p[1])),
  })));

// ---------------------------------------------------------------------------
// The shaders' rules, mirrored for tests
// ---------------------------------------------------------------------------

/**
 * Whether a relief fragment of wall `wall` at wall-local (u, y) shows, for
 * each wall's cut (HALL_WALLS order): below its wall's cut (the lower of its
 * and `neighbour`'s, for relief standing in a corner against that wall), and
 * not over a doorway once the lintel there has gone (sectionMask).
 */
export function reliefVisible(wall: number, neighbour: number, u: number, y: number, cuts: readonly number[]): boolean {
  const own = cuts[wall] ?? 1000;
  const cut = neighbour < 0 ? own : Math.min(own, cuts[neighbour] ?? 1000);
  if (y >= cut) return false;
  const overDoor = DOOR_SLOTS.some((slot) => slot.wall === wall && u > slot.u0 && u < slot.u1 && y > slot.head);
  return !(overDoor && own < LINTEL_RELEASE);
}

/**
 * Where a body vertex stands for a cut: no higher than the cut (the lower
 * of its two walls' at a corner) and no lower than the floor of its piece of
 * wall (a piece wholly above the cut collapses onto its floor, which the
 * section's mask then discards). Lintels vanish once the cut is at or under
 * LINTEL_RELEASE; the pier's side over a door (lintelJamb) shows only then; a
 * cap-only face (the top of the walling under an opening, where the relief or
 * a reveal already stands) exists only while the cut lies below it.
 * Returns null where the vertex is collapsed away.
 */
export function bodyVertexHeight(y: number, base: number, role: BodyRole, cut: number): number | null {
  const released = cut < LINTEL_RELEASE;
  if (role === BODY_ROLE.lintel && released) return null;
  if (role === BODY_ROLE.lintelJamb && !released) return null;
  if (role === BODY_ROLE.capOnly && cut >= y - 1e-4) return null;
  return Math.max(Math.min(y, cut), base);
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

interface Interval {
  readonly b0: number;
  readonly b1: number;
  readonly t0: number;
  readonly t1: number;
  /** Its bottom is a hole's head (a soffit) rather than the floor. */
  readonly underHole: boolean;
  /** Its top is a hole's sill rather than the wall's top. */
  readonly overHole: boolean;
  readonly lintel: boolean;
}

interface Column {
  readonly ua: number;
  readonly ub: number;
  readonly thickness: number;
  readonly opening: BodyOpening | null;
  /** Per depth layer: the walling in this column (empty where the layer lies beyond the wall). */
  readonly layers: readonly (readonly Interval[])[];
}

interface Accumulator {
  readonly positions: number[];
  readonly normals: number[];
  readonly light: number[];
  readonly section: number[];
  readonly shape: number[];
  readonly indices: number[];
}

interface FaceStyle {
  readonly wallA: number;
  readonly wallB: number;
  readonly role: BodyRole;
  readonly finish: BodyFinish;
}

/** One vertex of a face: where it stands, its piece's floor, and its two distances (aShape). */
interface FaceVertex {
  readonly p: V3;
  readonly base: number;
  readonly fromRoom: number;
  readonly toOuter: number;
  /** Where its light is sampled (inside the room), and the normal it is sampled for. */
  readonly lightAt: V3;
  readonly lightNormal: V3;
}

interface LightPoint {
  readonly at: V3;
  readonly normal: V3;
}

const UP: V3 = [0, 1, 0];
const NO_LIGHT = [1, 0, 0, 0] as const;

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
function norm(a: V3): V3 { const l = length(a); return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l]; }

/** The unique values, sorted ascending, merged within `tolerance`. */
function uniqueSorted(values: readonly number[], tolerance = 1e-6): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || value - last > tolerance) out.push(value);
  }
  return out;
}

/**
 * A convex face, wound to face `facing` and fanned from a true corner.
 * Collinear points stay (they are neighbouring faces' corners, so the two
 * share every vertex along an edge); degenerate fans are skipped.
 */
function emitFace(acc: Accumulator, vertices: readonly FaceVertex[], facing: V3, style: FaceStyle, lit: boolean): void {
  const points: FaceVertex[] = [];
  for (const vertex of vertices) {
    const last = points[points.length - 1];
    if (last !== undefined && length(sub(vertex.p, last.p)) < 1e-7) continue;
    points.push(vertex);
  }
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (points.length > 1 && firstPoint !== undefined && lastPoint !== undefined && length(sub(firstPoint.p, lastPoint.p)) < 1e-7) points.pop();
  if (points.length < 3) return;
  // Newell's normal decides the winding.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]?.p;
    const b = points[(i + 1) % points.length]?.p;
    if (a === undefined || b === undefined) continue;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (Math.hypot(nx, ny, nz) < 1e-10) return;
  const ordered = dot([nx, ny, nz], facing) >= 0 ? points : [...points].reverse();
  const normal = norm(facing);
  let apex = 0;
  for (let i = 0; i < ordered.length; i++) {
    const prev = ordered[(i + ordered.length - 1) % ordered.length]?.p;
    const here = ordered[i]?.p;
    const next = ordered[(i + 1) % ordered.length]?.p;
    if (prev === undefined || here === undefined || next === undefined) continue;
    if (length(cross(sub(here, prev), sub(next, here))) > 1e-9) { apex = i; break; }
  }
  const rotated = [...ordered.slice(apex), ...ordered.slice(0, apex)];
  const ids = rotated.map((vertex) => {
    const id = acc.positions.length / 3;
    acc.positions.push(vertex.p[0], vertex.p[1], vertex.p[2]);
    acc.normals.push(normal[0], normal[1], normal[2]);
    if (lit) {
      const sample = sampleHallLight(vertex.lightAt, vertex.lightNormal, "wall");
      acc.light.push(sample.ao, sample.chandelier, sample.daylight, sample.uplight);
    } else {
      acc.light.push(...NO_LIGHT);
    }
    acc.section.push(style.wallA, style.wallB, style.role, style.finish);
    acc.shape.push(vertex.base, vertex.fromRoom, vertex.toOuter);
    return id;
  });
  const apexId = ids[0];
  const apexPoint = rotated[0]?.p;
  if (apexId === undefined || apexPoint === undefined) return;
  for (let i = 1; i + 1 < ids.length; i++) {
    const b = rotated[i]?.p;
    const c = rotated[i + 1]?.p;
    const ib = ids[i];
    const ic = ids[i + 1];
    if (b === undefined || c === undefined || ib === undefined || ic === undefined) continue;
    if (length(cross(sub(b, apexPoint), sub(c, apexPoint))) < 1e-10) continue;
    acc.indices.push(apexId, ib, ic);
  }
}

/** The walling of one column in one layer, given the hole there (or none). */
function columnIntervals(ua: number, ub: number, hole: Hole | null, lintel: boolean): Interval[] {
  const full: Interval = { b0: 0, b1: 0, t0: WALL_BODY_TOP, t1: WALL_BODY_TOP, underHole: false, overHole: false, lintel: false };
  const mid = (ua + ub) / 2;
  if (hole === null || mid <= hole.u0 || mid >= hole.u1) return [full];
  const lo0 = chainAt(hole.lower, ua);
  const lo1 = chainAt(hole.lower, ub);
  const hi0 = chainAt(hole.upper, ua);
  const hi1 = chainAt(hole.upper, ub);
  const out: Interval[] = [];
  if (Math.max(lo0, lo1) > 1e-6) out.push({ b0: 0, b1: 0, t0: lo0, t1: lo1, underHole: false, overHole: true, lintel: false });
  if (Math.min(hi0, hi1) < WALL_BODY_TOP - 1e-6) out.push({ b0: hi0, b1: hi1, t0: WALL_BODY_TOP, t1: WALL_BODY_TOP, underHole: true, overHole: false, lintel });
  return out;
}

/** 1D intervals [lo, hi] at one u. */
type Span = readonly [number, number];

function spansOf(intervals: readonly Interval[], end: "a" | "b"): Span[] {
  return intervals.map((iv): Span => (end === "a" ? [iv.b0, iv.t0] : [iv.b1, iv.t1])).filter((s) => s[1] - s[0] > 1e-7);
}

/** `a` minus `b`, as spans. */
function subtractSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  let pieces: Span[] = [...a];
  for (const [lo, hi] of b) {
    const next: Span[] = [];
    for (const [p, q] of pieces) {
      if (hi <= p + 1e-7 || lo >= q - 1e-7) { next.push([p, q]); continue; }
      if (lo > p + 1e-7) next.push([p, lo]);
      if (hi < q - 1e-7) next.push([hi, q]);
    }
    pieces = next;
  }
  return pieces.filter((s) => s[1] - s[0] > 1e-6);
}

/** `a` intersected with `b`. */
function intersectSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const [p, q] of a) {
    for (const [r, s] of b) {
      const lo = Math.max(p, r);
      const hi = Math.min(q, s);
      if (hi - lo > 1e-6) out.push([lo, hi]);
    }
  }
  return out;
}

/** Where a piece of walling stands in the room, for its light. */
function roomPoint(wall: HallWall, u: number, v: number): V3 {
  return wallPoint(wall, Math.max(0.05, Math.min(wall.length - 0.05, u)), Math.max(0.15, Math.min(6.5, v)), 0.05);
}

/** The height the section's light is sampled at: the dado cut, where the near walls rest. */
const CAP_LIGHT_HEIGHT = HALL_ELEVATION.dadoTop - 0.03;

/** One wall's columns and the depths of the layers they share. */
interface WallPlan {
  readonly openings: readonly BodyOpening[];
  readonly columns: readonly Column[];
  readonly depths: readonly number[];
}

function planWall(wall: HallWall): WallPlan {
  const openings = bodyOpenings(wall);
  // Columns: every station of every hole, and every change of thickness.
  const stations: number[] = [0, wall.length];
  for (const entry of openings) {
    for (const hole of [entry.front, entry.back]) {
      stations.push(hole.u0, hole.u1);
      for (const [u] of [...hole.lower, ...hole.upper]) stations.push(u);
    }
  }
  for (const stretch of HALL_WALL_STRETCHES[wall.id]) stations.push(stretch.from, stretch.to);
  const us = uniqueSorted(stations.filter((u) => u >= -1e-9 && u <= wall.length + 1e-9).map((u) => Math.max(0, Math.min(wall.length, u))));
  const spans: (readonly [number, number])[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const ua = us[i] ?? 0;
    const ub = us[i + 1] ?? 0;
    if (ub - ua > 1e-7) spans.push([ua, ub]);
  }
  const thicknesses = spans.map(([ua, ub]) => bodyThicknessAt(wall, openings, (ua + ub) / 2));
  // Depth layers shared by every column, so neighbouring faces share their corners.
  const depths = uniqueSorted([0, ...thicknesses.map((t) => -t), ...openings.flatMap((entry) => [entry.frontDepth, entry.liningFrom])]).reverse();
  const columns = spans.map(([ua, ub], i): Column => {
    const mid = (ua + ub) / 2;
    const thickness = thicknesses[i] ?? wallThicknessAt(wall.id, mid);
    const opening = openings.find((entry) => mid > entry.front.u0 && mid < entry.front.u1) ?? null;
    const layers: Interval[][] = [];
    for (let j = 0; j + 1 < depths.length; j++) {
      const bottom = depths[j + 1] ?? 0;
      if (bottom < -thickness - 1e-7) { layers.push([]); continue; }
      const hole = opening === null ? null : bottom >= opening.frontDepth - 1e-7 ? opening.front : opening.back;
      layers.push(columnIntervals(ua, ub, hole, opening !== null && opening.door !== null));
    }
    return { ua, ub, thickness, opening, layers };
  });
  return { openings, columns, depths };
}

function buildWall(acc: Accumulator, wall: HallWall, wallIndex: number, plan: WallPlan): void {
  const { columns, depths } = plan;
  const tangent: V3 = [wall.tangent[0], 0, wall.tangent[2]];
  const backward: V3 = [-tangent[0], 0, -tangent[2]];
  const outward: V3 = [-wall.normal[0], 0, -wall.normal[2]];
  const inward: V3 = [wall.normal[0], 0, wall.normal[2]];
  const at = (u: number, v: number, d: number): V3 => wallPoint(wall, u, v, d);
  const liningAllowed = (opening: BodyOpening | null, top: number): boolean => opening !== null && top <= opening.liningFrom + 1e-7;
  const liningFinish = (opening: BodyOpening): BodyFinish => (opening.door !== null ? BODY_FINISH.doorLining : BODY_FINISH.windowLining);
  const vertex = (u: number, v: number, d: number, base: number, thickness: number, light: LightPoint): FaceVertex => ({
    p: at(u, v, d), base, fromRoom: -d, toOuter: thickness + d, lightAt: light.at, lightNormal: light.normal,
  });
  const capLight = (u: number): LightPoint => ({ at: roomPoint(wall, u, CAP_LIGHT_HEIGHT), normal: UP });
  const wallLight = (u: number, v: number): LightPoint => ({ at: roomPoint(wall, u, v), normal: inward });
  const style = (role: BodyRole, finish: BodyFinish): FaceStyle => ({ wallA: wallIndex, wallB: -1, role, finish });

  columns.forEach((column, ci) => {
    const { ua, ub, thickness, opening } = column;
    column.layers.forEach((intervals, j) => {
      const top = depths[j] ?? 0;
      const bottom = depths[j + 1] ?? 0;
      const lining = liningAllowed(opening, top);
      for (const iv of intervals) {
        // The top of each piece: the wall's top (the section, once cut), or the
        // sill under an opening.
        const topRole: BodyRole = iv.lintel ? BODY_ROLE.lintel : !iv.overHole || lining ? BODY_ROLE.body : BODY_ROLE.capOnly;
        const topFinish: BodyFinish = iv.overHole && lining && opening !== null ? liningFinish(opening) : BODY_FINISH.cap;
        const topNormal = norm([-(iv.t1 - iv.t0) * tangent[0], ub - ua, -(iv.t1 - iv.t0) * tangent[2]]);
        const lightTop = (u: number, v: number): LightPoint => (topFinish === BODY_FINISH.cap ? capLight(u) : wallLight(u, v));
        emitFace(acc, [
          vertex(ua, iv.t0, top, iv.b0, thickness, lightTop(ua, iv.t0)),
          vertex(ub, iv.t1, top, iv.b1, thickness, lightTop(ub, iv.t1)),
          vertex(ub, iv.t1, bottom, iv.b1, thickness, lightTop(ub, iv.t1)),
          vertex(ua, iv.t0, bottom, iv.b0, thickness, lightTop(ua, iv.t0)),
        ], topNormal, style(topRole, topFinish), true);
        // A soffit over an opening, only where the body lines it.
        if (iv.underHole && lining && opening !== null) {
          const down = norm([(iv.b1 - iv.b0) * tangent[0], -(ub - ua), (iv.b1 - iv.b0) * tangent[2]]);
          emitFace(acc, [
            vertex(ua, iv.b0, top, iv.b0, thickness, wallLight(ua, iv.b0)),
            vertex(ub, iv.b1, top, iv.b1, thickness, wallLight(ub, iv.b1)),
            vertex(ub, iv.b1, bottom, iv.b1, thickness, wallLight(ub, iv.b1)),
            vertex(ua, iv.b0, bottom, iv.b0, thickness, wallLight(ua, iv.b0)),
          ], down, style(iv.lintel ? BODY_ROLE.lintel : BODY_ROLE.body, liningFinish(opening)), true);
        }
      }
      // The outer face, in the layer that ends at this column's thickness.
      if (Math.abs(bottom + thickness) < 1e-7) {
        const neighbourStops = (index: number, end: "a" | "b"): number[] => {
          const other = columns[index];
          if (other === undefined || Math.abs(other.thickness - thickness) > 1e-7) return [];
          return spansOf(other.layers[j] ?? [], end).flat();
        };
        const leftStops = neighbourStops(ci - 1, "b");
        const rightStops = neighbourStops(ci + 1, "a");
        for (const iv of intervals) {
          const rightSide = rightStops.filter((v) => v > iv.b1 + 1e-7 && v < iv.t1 - 1e-7).sort((p, q) => p - q);
          const leftSide = leftStops.filter((v) => v > iv.b0 + 1e-7 && v < iv.t0 - 1e-7).sort((p, q) => q - p);
          emitFace(acc, [
            vertex(ua, iv.b0, bottom, iv.b0, thickness, wallLight(ua, iv.b0)),
            vertex(ub, iv.b1, bottom, iv.b1, thickness, wallLight(ub, iv.b1)),
            ...rightSide.map((v) => vertex(ub, v, bottom, iv.b1, thickness, wallLight(ub, v))),
            vertex(ub, iv.t1, bottom, iv.b1, thickness, wallLight(ub, iv.t1)),
            vertex(ua, iv.t0, bottom, iv.b0, thickness, wallLight(ua, iv.t0)),
            ...leftSide.map((v) => vertex(ua, v, bottom, iv.b0, thickness, wallLight(ua, v))),
          ], outward, style(iv.lintel ? BODY_ROLE.lintel : BODY_ROLE.body, BODY_FINISH.outer), false);
        }
      }
      // Where the relief's footprint gives way to the opening behind it, the
      // walling round the smaller hole faces the room: in a doorway, a step
      // of its lining, in front of the scanned reveal's last few millimetres.
      const next = column.layers[j + 1];
      if (next !== undefined && next.length > 0 && opening !== null && Math.abs(bottom - opening.frontDepth) < 1e-7) {
        const { front, back } = opening;
        const mid = (ua + ub) / 2;
        const door = opening.door !== null;
        // Each piece: its lower and upper edge at both ends, the floor of the
        // walling it faces from, and whether that walling is a lintel.
        const pieces: { lo: readonly [number, number]; hi: readonly [number, number]; base: readonly [number, number]; lintel: boolean }[] = [];
        if (mid > back.u0 && mid < back.u1) {
          const fLo: [number, number] = [chainAt(front.lower, ua), chainAt(front.lower, ub)];
          const bLo: [number, number] = [chainAt(back.lower, ua), chainAt(back.lower, ub)];
          const bHi: [number, number] = [chainAt(back.upper, ua), chainAt(back.upper, ub)];
          const fHi: [number, number] = [chainAt(front.upper, ua), chainAt(front.upper, ub)];
          if (Math.max(bLo[0] - fLo[0], bLo[1] - fLo[1]) > 1e-6) pieces.push({ lo: fLo, hi: bLo, base: [0, 0], lintel: false });
          if (Math.max(fHi[0] - bHi[0], fHi[1] - bHi[1]) > 1e-6 && Math.min(bHi[0], bHi[1]) < WALL_BODY_TOP - 1e-6) pieces.push({ lo: bHi, hi: fHi, base: bHi, lintel: door });
        } else {
          pieces.push({ lo: [chainAt(front.lower, ua), chainAt(front.lower, ub)], hi: [chainAt(front.upper, ua), chainAt(front.upper, ub)], base: [0, 0], lintel: false });
        }
        for (const piece of pieces) {
          emitFace(acc, [
            vertex(ua, piece.lo[0], bottom, piece.base[0], thickness, wallLight(ua, piece.lo[0])),
            vertex(ub, piece.lo[1], bottom, piece.base[1], thickness, wallLight(ub, piece.lo[1])),
            vertex(ub, piece.hi[1], bottom, piece.base[1], thickness, wallLight(ub, piece.hi[1])),
            vertex(ua, piece.hi[0], bottom, piece.base[0], thickness, wallLight(ua, piece.hi[0])),
          ], inward, style(piece.lintel ? BODY_ROLE.lintel : BODY_ROLE.body, door ? BODY_FINISH.doorLining : BODY_FINISH.section), true);
        }
      }
    });
  });

  // Upright faces between columns: jambs, the steps of the outer face, the
  // wall's ends, and the piers' sides over a door once its lintel goes.
  for (let k = 0; k <= columns.length; k++) {
    const left = columns[k - 1];
    const right = columns[k];
    const u = right?.ua ?? left?.ub ?? 0;
    for (let j = 0; j + 1 < depths.length; j++) {
      const top = depths[j] ?? 0;
      const bottom = depths[j + 1] ?? 0;
      const leftIntervals = left?.layers[j] ?? [];
      const rightIntervals = right?.layers[j] ?? [];
      const leftSpans = spansOf(leftIntervals, "b");
      const rightSpans = spansOf(rightIntervals, "a");
      const sides = [
        { owner: left, ownerIntervals: leftIntervals, ownerSpans: leftSpans, end: "b" as const, other: right, otherIntervals: rightIntervals, otherSpans: rightSpans, facing: tangent },
        { owner: right, ownerIntervals: rightIntervals, ownerSpans: rightSpans, end: "a" as const, other: left, otherIntervals: leftIntervals, otherSpans: leftSpans, facing: backward },
      ];
      for (const side of sides) {
        const { owner, ownerIntervals, ownerSpans, end, other, otherIntervals, otherSpans, facing } = side;
        if (owner === undefined) continue;
        const otherOpening = other?.opening ?? null;
        for (const span of subtractSpans(ownerSpans, otherSpans)) {
          const piece = ownerIntervals.find((iv) => {
            const [lo, hi] = end === "a" ? [iv.b0, iv.t0] : [iv.b1, iv.t1];
            return span[0] >= lo - 1e-7 && span[1] <= hi + 1e-7;
          });
          const base = piece === undefined ? 0 : end === "a" ? piece.b0 : piece.b1;
          // What the face looks into: an opening's hole in the neighbouring
          // column, or nothing (the wall's end, or a step in its outer face).
          const intoHole = other !== undefined && otherIntervals.length > 0 && otherOpening !== null;
          if (intoHole && !liningAllowed(otherOpening, top)) continue;
          const finish: BodyFinish = intoHole ? liningFinish(otherOpening) : BODY_FINISH.section;
          emitFace(acc, [
            vertex(u, span[0], top, base, owner.thickness, wallLight(u, span[0])),
            vertex(u, span[1], top, base, owner.thickness, wallLight(u, span[1])),
            vertex(u, span[1], bottom, base, owner.thickness, wallLight(u, span[1])),
            vertex(u, span[0], bottom, base, owner.thickness, wallLight(u, span[0])),
          ], facing, style(piece?.lintel === true ? BODY_ROLE.lintel : BODY_ROLE.body, finish), true);
        }
        // A pier's side above a doorway, shown once the lintel goes.
        if (other !== undefined && otherOpening !== null && otherOpening.door !== null) {
          const lintelSpans = spansOf(otherIntervals.filter((iv) => iv.lintel), end === "a" ? "b" : "a");
          const solid = spansOf(ownerIntervals.filter((iv) => !iv.lintel), end);
          for (const span of intersectSpans(lintelSpans, solid)) {
            emitFace(acc, [
              vertex(u, span[0], top, 0, owner.thickness, wallLight(u, span[0])),
              vertex(u, span[1], top, 0, owner.thickness, wallLight(u, span[1])),
              vertex(u, span[1], bottom, 0, owner.thickness, wallLight(u, span[1])),
              vertex(u, span[0], bottom, 0, owner.thickness, wallLight(u, span[0])),
            ], facing, style(BODY_ROLE.lintelJamb, BODY_FINISH.section), true);
          }
        }
      }
    }
  }
}

/**
 * The corner blocks: where two walls' bodies meet beyond the room's corner,
 * a block as deep as each wall there, which stands no higher than the lower
 * of the two walls' cuts.
 */
function buildCorners(acc: Accumulator, plans: readonly WallPlan[]): void {
  HALL_WALLS.forEach((a, ai) => {
    const bi = (ai + 1) % HALL_WALLS.length;
    const b = HALL_WALLS[bi];
    const planA = plans[ai];
    const planB = plans[bi];
    if (b === undefined || planA === undefined || planB === undefined) return;
    const ta = planA.columns[planA.columns.length - 1]?.thickness ?? wallThicknessAt(a.id, a.length);
    const tb = planB.columns[0]?.thickness ?? wallThicknessAt(b.id, 0);
    // In wall A's frame: past its end by s (up to wall B's thickness), d behind its plane.
    const light = roomPoint(a, a.length, CAP_LIGHT_HEIGHT);
    const fv = (s: number, v: number, d: number): FaceVertex => ({
      p: wallPoint(a, a.length + s, v, d), base: 0, fromRoom: tb - s, toOuter: ta + d, lightAt: light, lightNormal: UP,
    });
    const styleOf = (finish: BodyFinish): FaceStyle => ({ wallA: ai, wallB: bi, role: BODY_ROLE.body, finish });
    const outwardA: V3 = [-a.normal[0], 0, -a.normal[2]];
    const outwardB: V3 = [-b.normal[0], 0, -b.normal[2]];
    emitFace(acc, [fv(0, 0, -ta), fv(tb, 0, -ta), fv(tb, WALL_BODY_TOP, -ta), fv(0, WALL_BODY_TOP, -ta)], outwardA, styleOf(BODY_FINISH.outer), false);
    emitFace(acc, [fv(tb, 0, 0), fv(tb, 0, -ta), fv(tb, WALL_BODY_TOP, -ta), fv(tb, WALL_BODY_TOP, 0)], outwardB, styleOf(BODY_FINISH.outer), false);
    // The top, with every corner the neighbouring walls' tops have on its edges.
    const depthsA = planA.depths.filter((d) => d < -1e-7 && d > -ta + 1e-7);
    const depthsB = planB.depths.filter((d) => d < -1e-7 && d > -tb + 1e-7);
    emitFace(acc, [
      fv(tb, WALL_BODY_TOP, -ta),
      fv(0, WALL_BODY_TOP, -ta),
      ...[...depthsA].sort((p, q) => p - q).map((d) => fv(0, WALL_BODY_TOP, d)),
      fv(0, WALL_BODY_TOP, 0),
      ...[...depthsB].sort((p, q) => q - p).map((d) => fv(-d, WALL_BODY_TOP, 0)),
      fv(tb, WALL_BODY_TOP, 0),
    ], UP, styleOf(BODY_FINISH.cornerCap), true);
  });
}

export interface WallBodyStats {
  readonly vertices: number;
  readonly triangles: number;
}

export interface WallBody {
  readonly geometry: BufferGeometry;
  readonly stats: WallBodyStats;
}

/** Every wall's body and the four corner blocks, in one geometry. */
export function buildWallBody(): WallBody {
  const acc: Accumulator = { positions: [], normals: [], light: [], section: [], shape: [], indices: [] };
  const plans = HALL_WALLS.map((wall) => planWall(wall));
  HALL_WALLS.forEach((wall, index) => {
    const plan = plans[index];
    if (plan !== undefined) buildWall(acc, wall, index, plan);
  });
  buildCorners(acc, plans);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(acc.positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(acc.normals), 3));
  geometry.setAttribute("aLight", new BufferAttribute(new Float32Array(acc.light), 4));
  geometry.setAttribute("aSection", new BufferAttribute(new Float32Array(acc.section), 4));
  geometry.setAttribute("aShape", new BufferAttribute(new Float32Array(acc.shape), 3));
  geometry.setIndex(acc.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "grand-hall-wall-body";
  return { geometry, stats: { vertices: acc.positions.length / 3, triangles: acc.indices.length / 3 } };
}

/**
 * The plan outline of the walls' outer faces, counter-clockwise from above,
 * round the four corner blocks: what the plinth ring reaches out to.
 */
export function bodyOutline(): [number, number][] {
  const out: [number, number][] = [];
  HALL_WALLS.forEach((wall) => {
    const plan = planWall(wall);
    for (const column of plan.columns) {
      for (const u of [column.ua, column.ub]) {
        const p = wallPoint(wall, u, 0, -column.thickness);
        const last = out[out.length - 1];
        if (last === undefined || Math.hypot(last[0] - p[0], last[1] - p[2]) > 1e-7) out.push([p[0], p[2]]);
      }
    }
    // Round the corner block at the wall's end.
    const index = HALL_WALLS.indexOf(wall);
    const next = HALL_WALLS[(index + 1) % HALL_WALLS.length];
    if (next === undefined) return;
    const ta = plan.columns[plan.columns.length - 1]?.thickness ?? 0;
    const tb = planWall(next).columns[0]?.thickness ?? 0;
    const corner = wallPoint(wall, wall.length + tb, 0, -ta);
    out.push([corner[0], corner[2]]);
  });
  // The polygon is wound as the walls run seen from the room; return it
  // counter-clockwise seen from above (+y): signed area in (x, -z) positive.
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const q = out[(i + 1) % out.length];
    if (p === undefined || q === undefined) continue;
    area += p[0] * -q[1] - q[0] * -p[1];
  }
  return area >= 0 ? out : out.reverse();
}

/**
 * The doorways' oak thresholds: a board through each doorway's whole depth,
 * THRESHOLD_HEIGHT above the floor, with its two edges. They take the floor's
 * own drawn oak and baked light (role "floor", no wall), so they are never
 * cut.
 */
export function buildThresholds(hb: HallBuilders): void {
  hb.withRole("floor", () => {
    const floor = hb.get("floor");
    for (const wall of HALL_WALLS) {
      for (const entry of bodyOpenings(wall)) {
        if (entry.door === null) continue;
        const { u0, u1 } = entry.back;
        const depth = entry.door.depth;
        const h = THRESHOLD_HEIGHT;
        const p = (u: number, v: number, d: number): V3 => wallPoint(wall, u, v, d);
        const a = p(u0, h, 0);
        const b = p(u1, h, 0);
        const c = p(u1, h, -depth);
        const d = p(u0, h, -depth);
        floor.quadFacing(a, b, c, d, [a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [d[0], d[2]], UP);
        // Its front edge, facing the room, and its back edge.
        floor.quadFacing(p(u0, 0, 0), p(u1, 0, 0), p(u1, h, 0), p(u0, h, 0), [u0, 0], [u1, 0], [u1, h], [u0, h], [wall.normal[0], 0, wall.normal[2]]);
        floor.quadFacing(p(u0, 0, -depth), p(u1, 0, -depth), p(u1, h, -depth), p(u0, h, -depth), [u0, 0], [u1, 0], [u1, h], [u0, h], [-wall.normal[0], 0, -wall.normal[2]]);
      }
    }
  });
}
