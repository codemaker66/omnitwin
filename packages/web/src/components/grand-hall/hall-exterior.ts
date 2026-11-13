// ---------------------------------------------------------------------------
// The Glassford Street front, built
//
// Trades Hall's front as solid masonry from its measured specification
// (hall-exterior-spec.ts), in the planner's frame: the channelled ground
// floor with its plinth, its seven openings under their voussoirs and their
// shopfronts and doors; the string course; the principal floor's walls with
// the hall's own five windows open through them exactly where the room has
// them, the other windows glazed; the four Ionic columns, the entablature and
// pediment; the balustrades, attics and rosette band; the sculpted arms as a
// massing; the drum, the green dome, the lantern and the flagpole.
//
// Every piece is a closed solid, so the cutaway can cut the front as it cuts
// the walls: the material discards what stands above the window wall's cut
// and draws the solid's inside as the section (hall-exterior-material.ts).
// Each triangle carries what it is made of (`aPart`, FRONT_PART) for the
// material to colour as the section's finish asks.
//
// The build is a generator that yields between its pieces (hall-slices.ts),
// so it runs a frame's spare time at a time beside the city's arrival.
// ---------------------------------------------------------------------------

import { ShapeUtils, Vector2, type BufferGeometry } from "three";
import { MeshBuilder, vec, type V2, type V3 } from "./mesh-builder.js";
import { drain, type Steps } from "./hall-slices.js";
import { HALL_HALF_LENGTH, HALL_OPENINGS, HALL_WALL_THICKNESS, isWindow, type HallOpening } from "./hall-spec.js";
import {
  BALUSTRADES, DOME, DOORWAY_SETBACK, DOWNPIPES, END_BAY_WINDOWS, FREE_WALL_DEPTH, FRONT_AXIS_X, FRONT_BAYS, FRONT_DOOR, FRONT_FACE_Z,
  FRONT_HALF_WIDTH, FRONT_LEVELS, FRONT_PAVEMENT_Y, GROUND_OPENINGS, GROUND_WALL_DEPTH, LINK_FACE_PROUD, PRINCIPAL_WINDOWS, SCULPTURE,
  TEMPLE, type FrontBay, type GroundOpening,
} from "./hall-exterior-spec.js";

/** What each triangle is made of, as the material's `aPart` channel. */
export const FRONT_PART = { stone: 0, glass: 1, paint: 2, timber: 3, copper: 4, lead: 5, metal: 6 } as const;
export type FrontPartName = keyof typeof FRONT_PART;

/**
 * A lathe profile turning by more than this at a point is a corner there
 * (radians): the drum's and the pipes' rims and a torus's foot (78-105°) stay
 * sharp, and the profiles' coarse curves (a torus's 17-40° steps) stay round.
 */
const LATHE_CREASE = Math.PI / 3;

/** The planner's position of a point on the front: `u` along it, `z` over the pavement, `proud` out from the wall. */
export function frontPoint(u: number, z: number, proud: number): V3 {
  return [FRONT_AXIS_X - u, z + FRONT_PAVEMENT_Y, FRONT_FACE_Z - proud];
}

/** A direction in the front's frame, in the planner's. */
function frontDirection(du: number, dz: number, dproud: number): V3 {
  return [-du, dz, -dproud];
}

/** Planner y of a height over the pavement. */
export function frontY(z: number): number {
  return z + FRONT_PAVEMENT_Y;
}

/** Height over the pavement of a planner y. */
export function frontZ(y: number): number {
  return y - FRONT_PAVEMENT_Y;
}

/**
 * The window wall's body reaches this far along x each way (its own length
 * and the end walls' corners, hall-wall-body.ts bodyOutline): in front of it
 * the front is a skin on the surveyed wall; beyond it, a wall of its own.
 */
export const ROOM_BODY_HALF_X = HALL_HALF_LENGTH + HALL_WALL_THICKNESS.end.thickness;

/** The skin's back stands this far out from the wall's face, so the two never fight for the same depth. */
const SKIN_GAP = 0.004;

/**
 * How far a piece is let into what holds it (a pane into its frame, a pipe
 * into the pavement, a pole into its pedestal), so its end never lies on that
 * holder's own face in another material, where the two would fight for the same depth.
 */
export const LET_IN = 0.005;

/** How far back from a bay's face shopfronts, doors and their glass stand (I: a reveal of a stone's depth). */
const FILL_SETBACK = 0.26;

function signedArea(loop: readonly V2[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a === undefined || b === undefined) continue;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** The loop turned counter-clockwise (`ccw`) or clockwise, as plain 2D. */
function orient(loop: readonly V2[], ccw: boolean): V2[] {
  const counter = signedArea(loop) > 0;
  return counter === ccw ? [...loop] : [...loop].reverse();
}

/** Points along an arc about (cu, cz) from angle a0 to a1 (radians from +u), both ends included. */
export function arcPoints(cu: number, cz: number, radius: number, a0: number, a1: number, segments: number): V2[] {
  const points: V2[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = a0 + ((a1 - a0) * i) / segments;
    points.push([cu + radius * Math.cos(angle), cz + radius * Math.sin(angle)]);
  }
  return points;
}

/** An arch's circle: its radius and centre height for a span's half width and the crown's rise over the springing. */
export function archCircle(halfWidth: number, rise: number, springing: number): { readonly radius: number; readonly centreZ: number } {
  const radius = (halfWidth * halfWidth + rise * rise) / (2 * rise);
  return { radius, centreZ: springing + rise - radius };
}

/**
 * An opening's outline in (u, z), counter-clockwise: its square part from
 * `bottom` to `top`, and over a round or segmental head its arch.
 */
export function openingOutline(u: number, halfWidth: number, bottom: number, top: number, rise: number, segments = 16): V2[] {
  const points: V2[] = [[u - halfWidth, bottom], [u + halfWidth, bottom], [u + halfWidth, top]];
  if (rise > 1e-6) {
    const { radius, centreZ } = archCircle(halfWidth, rise, top);
    const half = Math.asin(Math.min(1, halfWidth / radius));
    for (let i = 1; i < segments; i++) {
      const angle = Math.PI / 2 - half + (2 * half * i) / segments;
      points.push([u + radius * Math.cos(angle), centreZ + radius * Math.sin(angle)]);
    }
  }
  points.push([u - halfWidth, top]);
  return points;
}

/**
 * The part of an arched head above `springing + inset`, set in from the arch
 * by `inset` on the arch's own circle (a fanlight's glass inside its frame):
 * concentric, so it never crosses the arch it sits in.
 */
export function insetArchOutline(u: number, halfWidth: number, rise: number, springing: number, inset: number, segments = 14): V2[] {
  const { radius, centreZ } = archCircle(halfWidth, rise, springing);
  const inner = radius - inset;
  const foot = springing + inset;
  const half = Math.sqrt(Math.max(0, inner * inner - (foot - centreZ) * (foot - centreZ)));
  if (inner <= 0 || half <= 0) return [];
  const a0 = Math.atan2(foot - centreZ, half);
  return arcPoints(u, centreZ, inner, a0, Math.PI - a0, segments);
}

/**
 * A surround open at the foot: the band between two of openingOutline's
 * outlines that share their bottom line (a door's moulded arch, a window's
 * architrave standing on its sill), as one simple polygon. A hole touching
 * its outline's edge is no polygon at all to a triangulator.
 */
export function bandOutline(outer: readonly V2[], inner: readonly V2[]): V2[] {
  const [outerLeft, ...outerRest] = outer;
  const [innerLeft, ...innerRest] = inner;
  if (outerLeft === undefined || innerLeft === undefined) return [];
  // Up the outer right side, over, down to the outer foot; across to the inner foot; up, over and down the inner.
  return [...outerRest, outerLeft, innerLeft, ...[...innerRest].reverse()];
}

/** The hall's windows, by id, with their openings in the front's frame (room). */
export interface HallWindowHole {
  readonly opening: HallOpening;
  /** Centre along the front. */
  readonly u: number;
  readonly halfWidth: number;
  /** Sill and head (where an arched window's head springs), over the pavement. */
  readonly bottom: number;
  readonly top: number;
  /** An arched window's semicircle over its head; 0 for a sash. */
  readonly rise: number;
}

/** The five windows of the hall's window wall, where the front opens round them. */
export function hallWindowHoles(): HallWindowHole[] {
  return HALL_OPENINGS.filter((opening) => opening.wall === "window" && isWindow(opening)).map((opening) => {
    // The window wall runs from x = −HALL_HALF_LENGTH; `centre` is along it.
    const x = -HALL_HALF_LENGTH + opening.centre;
    const arched = opening.kind === "arched-window";
    // An arch opens straight through the wall; a sash's reveal narrows to its opening in the front (plan).
    const halfWidth = arched ? opening.width / 2 : Math.min(opening.width, PRINCIPAL_WINDOWS.pedimented.exteriorWidth) / 2;
    return {
      opening,
      u: FRONT_AXIS_X - x,
      halfWidth,
      bottom: frontZ(opening.sill),
      top: frontZ(opening.head),
      rise: arched ? opening.width / 2 : 0,
    };
  });
}

/** The u-intervals [from, to] a set of blocking intervals leaves of [lo, hi]. */
export function openIntervals(lo: number, hi: number, blocked: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...blocked].filter(([a, b]) => b > lo && a < hi).sort((p, q) => p[0] - q[0]);
  const open: [number, number][] = [];
  let cursor = lo;
  for (const [a, b] of sorted) {
    if (a > cursor + 1e-4) open.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, b);
    if (cursor >= hi) break;
  }
  if (cursor < hi - 1e-4) open.push([cursor, hi]);
  return open;
}

/** How wide an opening and its voussoirs block a course at height z, each side of its centre (0 where they do not reach). */
export function blockedHalfWidth(opening: GroundOpening, z: number): number {
  const half = opening.width / 2;
  if (z < opening.bottom - 1e-6) return 0;
  if (z <= opening.top) return half;
  if (opening.head === "flat") {
    if (z > opening.top + FLAT_ARCH_HEIGHT) return 0;
    return flatArchHalf(opening, z);
  }
  const { radius, centreZ } = archCircle(half, opening.rise, opening.top);
  const outer = radius + opening.ringWidth;
  const dz = z - centreZ;
  if (Math.abs(dz) > outer) return 0;
  return Math.sqrt(outer * outer - dz * dz);
}

/** A flat arch's height over its opening (P: 3.072 m to 3.823 m in the end bays). */
const FLAT_ARCH_HEIGHT = 0.751;
/** How far its springers sit out over the jambs at the soffit (I). */
const FLAT_ARCH_SPRINGER = 0.06;

/**
 * A flat arch's half width at height z: its splayed voussoirs rise from just
 * outside the jambs at the soffit to the arch's full width at its top (P:
 * 3.327 m over a 2.39 m opening, so the opening's half width plus ringWidth).
 */
function flatArchHalf(opening: GroundOpening, z: number): number {
  const soffit = opening.width / 2 + FLAT_ARCH_SPRINGER;
  const top = opening.width / 2 + opening.ringWidth;
  const t = Math.min(1, Math.max(0, (z - opening.top) / FLAT_ARCH_HEIGHT));
  return soffit + (top - soffit) * t;
}

class FrontBuilder {
  readonly mesh: MeshBuilder;
  private current: number = FRONT_PART.stone;

  constructor() {
    this.mesh = new MeshBuilder({ extraSize: 1, extraName: "aPart", extra: () => [this.current] });
  }

  as(part: FrontPartName): this {
    this.current = FRONT_PART[part];
    return this;
  }

  /** A box between two values of u, z and proud. */
  box(u0: number, u1: number, z0: number, z1: number, p0: number, p1: number): void {
    const a = frontPoint(Math.min(u0, u1), Math.min(z0, z1), Math.min(p0, p1));
    const b = frontPoint(Math.max(u0, u1), Math.max(z0, z1), Math.max(p0, p1));
    const size: V3 = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])];
    if (size[0] < 1e-4 || size[1] < 1e-4 || size[2] < 1e-4) return;
    this.mesh.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], size);
  }

  /** Triangles over points with one normal, each wound to face it. */
  private facet(points: readonly V3[], triangles: readonly (readonly number[])[], normal: V3): void {
    const ids = points.map((point) => this.mesh.vertex(point, normal, [point[0] + point[2], point[1]]));
    for (const triangle of triangles) {
      const [a, b, c] = triangle;
      if (a === undefined || b === undefined || c === undefined) continue;
      const pa = points[a];
      const pb = points[b];
      const pc = points[c];
      const ia = ids[a];
      const ib = ids[b];
      const ic = ids[c];
      if (pa === undefined || pb === undefined || pc === undefined || ia === undefined || ib === undefined || ic === undefined) continue;
      const n = vec.cross(vec.sub(pb, pa), vec.sub(pc, pa));
      if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= 0) this.mesh.triangle(ia, ib, ic);
      else this.mesh.triangle(ia, ic, ib);
    }
  }

  /** The sides round a loop in (u, z), from `back` to `front`, each facing out of the solid. */
  private ring(loop: readonly V2[], back: number, front: number): void {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (a === undefined || b === undefined) continue;
      const du = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(du, dz);
      if (length < 1e-6) continue;
      const normal = vec.normalize(frontDirection(dz / length, -du / length, 0));
      this.mesh.quadFacing(
        frontPoint(a[0], a[1], back), frontPoint(b[0], b[1], back), frontPoint(b[0], b[1], front), frontPoint(a[0], a[1], front),
        [0, 0], [length, 0], [length, 1], [0, 1], normal,
      );
    }
  }

  /**
   * A slab: an outline in (u, z) with holes, from `back` to `front` (proud).
   * Closed: both faces, the outline's sides (unless a neighbour meets it there)
   * and every hole's reveal.
   */
  slab(outline: readonly V2[], holes: readonly (readonly V2[])[], back: number, front: number, sides = true): void {
    if (front - back < 1e-5) return;
    const contour = orient(outline, true);
    const loops = holes.map((hole) => orient(hole, false));
    const triangles = ShapeUtils.triangulateShape(
      contour.map(([u, z]) => new Vector2(u, z)),
      loops.map((loop) => loop.map(([u, z]) => new Vector2(u, z))),
    );
    const flat = [...contour, ...loops.flat()];
    this.facet(flat.map(([u, z]) => frontPoint(u, z, front)), triangles, frontDirection(0, 0, 1));
    this.facet(flat.map(([u, z]) => frontPoint(u, z, back)), triangles, frontDirection(0, 0, -1));
    if (sides) this.ring(contour, back, front);
    for (const loop of loops) this.ring(loop, back, front);
  }

  /**
   * A rectangular slab from u0 to u1 and z0 to z1 with holes in a row, as one
   * slab per hole, split halfway between neighbouring holes. Holes side by side
   * share their sills and heads exactly, and the triangulator drops points it
   * finds collinear across them, which tears the faces from their reveals.
   */
  rowSlab(u0: number, u1: number, z0: number, z1: number, holes: readonly (readonly V2[])[], back: number, front: number): void {
    const spans = holes.map((hole) => ({ hole, from: Math.min(...hole.map(([u]) => u)), to: Math.max(...hole.map(([u]) => u)) })).sort((a, b) => a.from - b.from);
    let start = u0;
    spans.forEach((span, i) => {
      const next = spans[i + 1];
      const end = next === undefined ? u1 : (span.to + next.from) / 2;
      this.slab([[start, z0], [end, z0], [end, z1], [start, z1]], [span.hole], back, front);
      start = end;
    });
    if (spans.length === 0) this.slab([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [], back, front);
  }

  /** A closed profile in (proud, z) run along the front from u0 to u1, capped at both ends. */
  run(u0: number, u1: number, profile: readonly V2[]): void {
    const loop = orient(profile, true);
    const [from, to] = u0 < u1 ? [u0, u1] : [u1, u0];
    if (to - from < 1e-5) return;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (a === undefined || b === undefined) continue;
      const dp = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dp, dz);
      if (length < 1e-6) continue;
      const normal = vec.normalize(frontDirection(0, -dp / length, dz / length));
      this.mesh.quadFacing(
        frontPoint(from, a[1], a[0]), frontPoint(to, a[1], a[0]), frontPoint(to, b[1], b[0]), frontPoint(from, b[1], b[0]),
        [0, 0], [to - from, 0], [to - from, length], [0, length], normal,
      );
    }
    const triangles = ShapeUtils.triangulateShape(loop.map(([p, z]) => new Vector2(p, z)), []);
    this.facet(loop.map(([p, z]) => frontPoint(from, z, p)), triangles, frontDirection(-1, 0, 0));
    this.facet(loop.map(([p, z]) => frontPoint(to, z, p)), triangles, frontDirection(1, 0, 0));
  }

  /**
   * A solid of revolution about a vertical axis at (u, proud): `profile` is
   * (radius, z over the pavement), pole to pole. Its corners stay sharp (a
   * drum's rim, a shaft's foot) and its curves smooth (LATHE_CREASE).
   */
  lathe(u: number, proud: number, profile: readonly V2[], segments: number): void {
    this.mesh.lathe(frontPoint(u, 0, proud), profile, segments, 1, 1, 0, LATHE_CREASE);
  }

  /** A short cylinder whose axis runs out from the wall (a volute's eye, a patera, a rosette). */
  disc(u: number, z: number, back: number, front: number, radius: number, segments = 12): void {
    this.mesh.tube([frontPoint(u, z, back), frontPoint(u, z, front)], [radius, radius], segments, true);
  }
}

// ---------------------------------------------------------------- pieces

/** Course bands across [lo, hi] over a bay's face, broken by its openings. */
function courses(front: FrontBuilder, lo: number, hi: number, face: number, openings: readonly GroundOpening[]): void {
  const { plinthTop, courses: count, courseHeight, channelWidth, channelDepth } = FRONT_LEVELS;
  front.as("stone");
  for (let i = 0; i < count; i++) {
    const z0 = plinthTop + i * courseHeight + channelWidth / 2;
    const z1 = plinthTop + (i + 1) * courseHeight - channelWidth / 2;
    const blocked = openings.map((opening): [number, number] => {
      const half = Math.max(blockedHalfWidth(opening, z0), blockedHalfWidth(opening, (z0 + z1) / 2), blockedHalfWidth(opening, z1));
      return [opening.u - half, opening.u + half];
    }).filter(([a, b]) => b > a);
    for (const [a, b] of openIntervals(lo, hi, blocked)) front.box(a, b, z0, z1, face - channelDepth, face);
  }
}

/** The voussoirs round a ground-floor opening, standing in the course bands' plane. */
function voussoirs(front: FrontBuilder, opening: GroundOpening, face: number): void {
  const { channelWidth, channelDepth } = FRONT_LEVELS;
  const back = face - channelDepth;
  const proud = face + 0.012;
  front.as("stone");
  const half = opening.width / 2;
  const count = opening.voussoirs;
  if (opening.head === "flat") {
    const soffit = flatArchHalf(opening, opening.top);
    const crown = flatArchHalf(opening, opening.top + FLAT_ARCH_HEIGHT);
    const spread = crown / soffit;
    for (let i = 0; i < count; i++) {
      // Joints radiate from below the soffit: each stone's sides run from its share of the soffit to its share of the top.
      // Flush: no raised keystone (the photographs' audit).
      const s0 = -soffit + (2 * soffit * i) / count + channelWidth / 2;
      const s1 = -soffit + (2 * soffit * (i + 1)) / count - channelWidth / 2;
      front.slab([
        [opening.u + s0, opening.top], [opening.u + s1, opening.top],
        [opening.u + s1 * spread, opening.top + FLAT_ARCH_HEIGHT], [opening.u + s0 * spread, opening.top + FLAT_ARCH_HEIGHT],
      ], [], back, proud);
    }
    return;
  }
  const { radius, centreZ } = archCircle(half, opening.rise, opening.top);
  const span = Math.asin(Math.min(1, half / radius));
  const a0 = Math.PI / 2 - span;
  const a1 = Math.PI / 2 + span;
  for (let i = 0; i < count; i++) {
    const gap = channelWidth / 2 / radius;
    const from = a0 + ((a1 - a0) * i) / count + gap;
    const to = a0 + ((a1 - a0) * (i + 1)) / count - gap;
    const inner = arcPoints(opening.u, centreZ, radius, from, to, 3);
    const outer = arcPoints(opening.u, centreZ, radius + opening.ringWidth, to, from, 3);
    const key = i === Math.floor(count / 2);
    front.slab([...inner, ...outer], [], back, proud + (key ? 0.03 : 0));
  }
}

/** A white shopfront: three lights over a panelled stall riser, set back in its opening (P: modern joinery). */
function shopfront(front: FrontBuilder, opening: GroundOpening, face: number): void {
  const half = opening.width / 2;
  const bottom = opening.bottom;
  const top = opening.top;
  const back = face - FILL_SETBACK - 0.07;
  const frontFace = face - FILL_SETBACK;
  const frame = 0.085;
  const riser = 0.62;
  const lights: V2[][] = [];
  const clear = (opening.width - 2 * frame - 2 * 0.07) / 3;
  for (let i = 0; i < 3; i++) {
    const l0 = opening.u - half + frame + i * (clear + 0.07);
    lights.push([[l0, bottom + riser], [l0 + clear, bottom + riser], [l0 + clear, top - frame], [l0, top - frame]]);
  }
  front.as("paint").rowSlab(opening.u - half, opening.u + half, bottom, top, lights, back, frontFace);
  // The stall riser's panels, a little proud of the frame.
  for (let i = 0; i < 3; i++) {
    const l0 = opening.u - half + frame + i * (clear + 0.07);
    front.box(l0 + 0.05, l0 + clear - 0.05, bottom + 0.09, bottom + riser - 0.08, frontFace, frontFace + 0.015);
  }
  front.as("glass");
  for (const light of lights) {
    const [[a, b], , [c, d]] = [light[0] ?? [0, 0], light[1] ?? [0, 0], light[2] ?? [0, 0]];
    front.box(a, c, b, d, back + 0.02, back + 0.035);
  }
  // Anything above a square shopfront's head up to the arch is the lintel's stone.
  if (opening.head === "segmental") {
    front.as("stone").slab(openingOutline(opening.u, half, top, top + 1e-3, opening.rise).slice(2), [], back - 0.2, face - 0.04);
  }
}

/** A pavilion's arched doorway: a glazed door between side lights under a fanlight, all in white (P). */
function doorway(front: FrontBuilder, opening: GroundOpening, face: number): void {
  const half = opening.width / 2;
  const back = face - DOORWAY_SETBACK - 0.07;
  const frontFace = face - DOORWAY_SETBACK;
  const frame = 0.08;
  const door = 1.014 / 2;
  const transom = opening.top;
  const holes: V2[][] = [];
  // Side lights each side of the door, and the door's own glazed panels.
  holes.push([[opening.u - half + frame, opening.bottom + 0.55], [opening.u - door - frame, opening.bottom + 0.55], [opening.u - door - frame, transom - frame], [opening.u - half + frame, transom - frame]]);
  holes.push([[opening.u + door + frame, opening.bottom + 0.55], [opening.u + half - frame, opening.bottom + 0.55], [opening.u + half - frame, transom - frame], [opening.u + door + frame, transom - frame]]);
  holes.push([[opening.u - door + 0.1, opening.bottom + 1.0], [opening.u + door - 0.1, opening.bottom + 1.0], [opening.u + door - 0.1, transom - 0.2], [opening.u - door + 0.1, transom - 0.2]]);
  // The door and its side lights below the transom; the fanlight over it, its bars radiating from a hub.
  const { radius, centreZ } = archCircle(half, opening.rise, transom);
  front.as("paint").rowSlab(opening.u - half, opening.u + half, opening.bottom, transom, holes, back, frontFace);
  front.slab(openingOutline(opening.u, half, transom, transom + 1e-3, opening.rise).slice(2), [insetArchOutline(opening.u, half, opening.rise, transom, frame)], back, frontFace);
  // Radiating bars across the fanlight (P: about 12 round a half-rosette hub).
  const bars = 12;
  for (let i = 1; i < bars; i++) {
    const angle = Math.PI * (i / bars);
    const r0 = 0.16;
    const r1 = Math.max(r0 + 0.05, radius - frame - 0.02);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    front.mesh.tube([frontPoint(opening.u + r0 * c, centreZ + r0 * s + (transom - centreZ), frontFace - 0.03), frontPoint(opening.u + r1 * c, centreZ + r1 * s, frontFace - 0.03)], [0.012, 0.012], 4, true);
  }
  // The hub's back let into the glass, and the glass into the frame round it.
  front.disc(opening.u, transom + 0.02, frontFace - 0.05 + LET_IN, frontFace - 0.01, 0.16, 12);
  front.as("glass");
  front.box(opening.u - half + LET_IN, opening.u + half - LET_IN, opening.bottom + 0.5, transom + opening.rise, back + 0.02, back + 0.035);
}

/** The front door: a pair of dark panelled leaves under a fanlight, in the podium's moulded arch (P). */
function frontDoor(front: FrontBuilder, opening: GroundOpening, face: number): void {
  const half = opening.width / 2;
  const back = face - FILL_SETBACK - 0.08;
  const frontFace = face - FILL_SETBACK - 0.02;
  const transom = opening.top;
  front.as("timber");
  front.box(opening.u - half, opening.u - 0.006, opening.bottom, transom - 0.06, back, frontFace);
  front.box(opening.u + 0.006, opening.u + half, opening.bottom, transom - 0.06, back, frontFace);
  // Raised panels on each leaf.
  for (const side of [-1, 1] as const) {
    const l0 = side < 0 ? opening.u - half + 0.1 : opening.u + 0.1;
    const l1 = side < 0 ? opening.u - 0.1 : opening.u + half - 0.1;
    front.box(l0, l1, opening.bottom + 0.2, opening.bottom + 1.0, frontFace, frontFace + 0.018);
    front.box(l0, l1, opening.bottom + 1.15, transom - 0.25, frontFace, frontFace + 0.018);
  }
  front.as("paint");
  front.box(opening.u - half, opening.u + half, transom - 0.06, transom + 0.04, back, frontFace + 0.01);
  // The fanlight's frame: the head above the transom bar, its glass set in 7 cm on the arch's own circle.
  front.slab(insetArchOutline(opening.u, half, opening.rise, transom, 0.04, 16), [insetArchOutline(opening.u, half, opening.rise, transom, 0.11, 14)], back, frontFace);
  const { radius, centreZ } = archCircle(half, opening.rise, transom);
  for (let i = 1; i < 10; i++) {
    const angle = Math.PI * (i / 10);
    const r1 = radius - 0.08;
    front.mesh.tube([frontPoint(opening.u + 0.14 * Math.cos(angle), transom + 0.06 + 0.14 * Math.sin(angle), frontFace - 0.02), frontPoint(opening.u + r1 * Math.cos(angle), centreZ + r1 * Math.sin(angle), frontFace - 0.02)], [0.01, 0.01], 4, true);
  }
  // The glass let into the transom bar under it and the stone each side, never resting on the frame's foot.
  front.as("glass");
  front.box(opening.u - half - LET_IN, opening.u + half + LET_IN, transom + 0.04 - LET_IN, transom + opening.rise, back + 0.02, back + 0.035);
  // The moulded arch round the door, its keystone plaque, and the bracket lamps (P).
  front.as("stone");
  const band = FRONT_DOOR.archBand;
  const outer = openingOutline(opening.u, half + band, opening.bottom, transom, opening.rise + band, 18);
  const inner = openingOutline(opening.u, half, opening.bottom, transom, opening.rise, 18);
  front.slab(bandOutline(outer, inner), [], face - 0.02, face + 0.06);
  front.disc(opening.u, FRONT_DOOR.plaqueZ, face + 0.04, face + 0.1, FRONT_DOOR.plaqueDiameter / 2, 16);
  // The two bracket lamps beside the door are the city's street lamps (street-lamps-v3.json,
  // kind "door"), drawn and lit with every other lamp at the podium's face.
}

/** A cornice's profile in (proud, z): from the wall at `bottom`, out to `projection` by `top` (a cyma, a corona, a cymatium). */
function corniceProfile(face: number, bottom: number, top: number, projection: number, back: number): V2[] {
  const h = top - bottom;
  return [
    [back, bottom], [face, bottom], [face + projection * 0.12, bottom + h * 0.18], [face + projection * 0.45, bottom + h * 0.4],
    [face + projection * 0.8, bottom + h * 0.48], [face + projection * 0.82, bottom + h * 0.72], [face + projection, bottom + h * 0.8],
    [face + projection, top], [back, top],
  ];
}

/**
 * A balustrade between u0 and u1: plinth, balusters and coping, its face at
 * `face`. A blind one's balusters stand engaged against a sunk panel.
 */
function balustrade(front: FrontBuilder, u0: number, u1: number, bottom: number, top: number, face: number, count: number, segments: number, blind = false): void {
  const depth = 0.34;
  const plinth = Math.min(0.2, (top - bottom) * 0.2);
  const coping = Math.min(0.14, (top - bottom) * 0.13);
  front.as("stone");
  front.box(u0, u1, bottom, bottom + plinth, face - depth, face);
  front.box(u0 - 0.02, u1 + 0.02, top - coping, top, face - depth - 0.02, face + 0.03);
  if (blind) front.box(u0, u1, bottom + plinth, top - coping, face - depth, face - depth * 0.55);
  const clear = top - coping - (bottom + plinth);
  const pitch = (u1 - u0) / count;
  const r = Math.min(pitch * 0.38, clear * 0.15);
  const profile: V2[] = [
    [0, 0], [r * 0.82, 0], [r * 0.82, clear * 0.08], [r * 0.6, clear * 0.13], [r * 0.95, clear * 0.36], [r, clear * 0.46],
    [r * 0.62, clear * 0.66], [r * 0.42, clear * 0.8], [r * 0.62, clear * 0.86], [r * 0.82, clear * 0.92], [r * 0.82, clear], [0, clear],
  ];
  for (let i = 0; i < count; i++) {
    const u = u0 + pitch * (i + 0.5);
    front.lathe(u, face - depth / 2, profile.map(([pr, pz]): V2 => [pr, pz + bottom + plinth]), segments);
  }
}

/** A window glazed in the front's own plane (not one of the hall's): a hole's glass and white sash bars, `panes` columns by rows. */
function glazedWindow(front: FrontBuilder, u: number, halfWidth: number, bottom: number, top: number, face: number, panes: readonly [number, number]): void {
  const back = face - 0.2;
  front.as("glass");
  front.box(u - halfWidth, u + halfWidth, bottom, top, back, back + 0.012);
  front.as("paint");
  const bar = 0.03;
  const [columns, rows] = panes;
  for (let i = 1; i < columns; i++) {
    const bu = u - halfWidth + (2 * halfWidth * i) / columns;
    front.box(bu - bar / 2, bu + bar / 2, bottom, top, back + 0.012, back + 0.05);
  }
  for (let j = 1; j < rows; j++) {
    const bz = bottom + ((top - bottom) * j) / rows;
    front.box(u - halfWidth, u + halfWidth, bz - bar / 2, bz + bar / 2, back + 0.012, back + 0.05);
  }
  front.box(u - halfWidth, u + halfWidth, bottom, bottom + 0.06, back + 0.012, back + 0.06);
  front.box(u - halfWidth, u + halfWidth, top - 0.05, top, back + 0.012, back + 0.06);
}

/** One Ionic column on its Attic base, its shaft with entasis, its capital with volutes (P; proportions I). */
function ionicColumn(front: FrontBuilder, u: number, proud: number, segments: number): void {
  const t = TEMPLE;
  const r0 = t.diameterLower / 2;
  const r1 = t.diameterUpper / 2;
  const plinthHeight = t.baseHeight * 0.38;
  const shaftBottom = t.columnBottom + t.baseHeight;
  const shaftTop = t.columnTop - t.capitalHeight;
  // The base's square plinth, held inside the podium's face (plan: 0.34 m from the axis to the portico's line).
  const plinthHalf = Math.min(r0 * 1.38, t.podiumProud - proud - 0.01);
  front.as("stone");
  front.box(u - plinthHalf, u + plinthHalf, t.columnBottom, t.columnBottom + plinthHeight, proud - plinthHalf, proud + plinthHalf);
  // The Attic base's lower torus, scotia and upper torus, no wider than its plinth.
  const base = Math.min(r0 * 1.34, plinthHalf);
  const torus: V2[] = [
    [0, t.columnBottom + plinthHeight], [base * 0.97, t.columnBottom + plinthHeight], [base, t.columnBottom + plinthHeight + 0.05],
    [r0 + (base - r0) * 0.35, t.columnBottom + plinthHeight + 0.1], [r0 + (base - r0) * 0.5, t.columnBottom + plinthHeight + 0.14], [r0 * 1.04, shaftBottom], [0, shaftBottom],
  ];
  front.lathe(u, proud, torus, segments);
  // Entasis: straight for the lower third, then a gentle taper to the neck.
  const shaft: V2[] = [[0, shaftBottom]];
  const rings = 8;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const taper = s < 1 / 3 ? 0 : Math.sin(((s - 1 / 3) / (2 / 3)) * Math.PI / 2);
    shaft.push([r0 + (r1 - r0) * taper, shaftBottom + (shaftTop - shaftBottom) * s]);
  }
  shaft.push([0, shaftTop]);
  front.lathe(u, proud, shaft, segments);
  // The capital: an astragal and echinus, the volutes' cushion, an abacus.
  const echinus: V2[] = [[0, shaftTop], [r1 * 1.08, shaftTop], [r1 * 1.08, shaftTop + 0.05], [r1 * 1.2, shaftTop + 0.16], [r1 * 1.28, shaftTop + 0.24], [0, shaftTop + 0.24]];
  front.lathe(u, proud, echinus, segments);
  const cushionTop = t.columnTop - 0.07;
  front.box(u - r0 * 1.3, u + r0 * 1.3, shaftTop + 0.2, cushionTop, proud - r0 * 1.05, proud + r0 * 1.05);
  for (const side of [-1, 1] as const) {
    front.disc(u + side * r0 * 1.12, shaftTop + 0.16, proud + r0 * 0.95, proud + r0 * 1.12, 0.12, 14);
    front.disc(u + side * r0 * 1.12, shaftTop + 0.16, proud - r0 * 1.12, proud - r0 * 0.95, 0.12, 14);
  }
  front.box(u - r0 * 1.38, u + r0 * 1.38, cushionTop, t.columnTop, proud - r0 * 1.38, proud + r0 * 1.38);
}

/** The arms on the attic (P, descriptive): pedestal, cartouche and its finial, two reclining figures, as a massing. */
function sculpture(front: FrontBuilder): void {
  const s = SCULPTURE;
  front.as("stone");
  front.box(-s.halfWidth, s.halfWidth, TEMPLE.atticTop, s.pedestalTop, s.backProud, s.frontProud);
  const mid = (s.backProud + s.frontProud) / 2;
  front.slab([[-s.cartoucheWidth / 2, s.cartoucheBottom], [s.cartoucheWidth / 2, s.cartoucheBottom], [s.cartoucheWidth / 2, s.cartoucheTop - 0.2], [0, s.cartoucheTop], [-s.cartoucheWidth / 2, s.cartoucheTop - 0.2]], [], mid - 0.18, mid + 0.18);
  front.box(-0.42, 0.42, s.pedestalTop, s.cartoucheBottom, mid - 0.25, mid + 0.25);
  front.lathe(0, mid, [[0, s.cartoucheTop], [0.12, s.cartoucheTop + 0.06], [0.16, s.cartoucheTop + 0.3], [0.06, s.finialTop - 0.05], [0, s.finialTop]], 10);
  // Each figure reclines along the pedestal, its head raised beside the cartouche and its feet out at the end.
  for (const side of [-1, 1] as const) {
    const head = side < 0 ? s.figureHeadLeft : s.figureHeadRight;
    const feet = side * (s.halfWidth - 0.05);
    front.slab([
      [feet, s.pedestalTop], [side * 0.45, s.pedestalTop], [side * 0.48, head], [side * 0.75, head - 0.15], [feet, s.pedestalTop + 0.3],
    ], [], mid - 0.3, mid + 0.25);
  }
}

/** The drum, the dome and its 24 ribs, the lantern, its finial and the flagpole (L, P). */
function domeGroup(front: FrontBuilder, segments: number): void {
  const d = DOME;
  const proud = -d.behindFace;
  front.as("lead");
  front.lathe(d.u, proud, [[0, d.drumBase], [d.drumRadius, d.drumBase], [d.drumRadius, d.drumCorniceBottom], [0, d.drumCorniceBottom]], segments);
  front.as("stone");
  front.lathe(d.u, proud, [
    [0, d.drumCorniceBottom], [d.drumRadius + 0.02, d.drumCorniceBottom], [d.drumRadius + 0.08, d.drumCorniceBottom + 0.1],
    [d.drumCorniceRadius, d.drumCorniceBottom + 0.18], [d.drumCorniceRadius, d.drumCorniceTop], [0, d.drumCorniceTop],
  ], segments);
  front.as("copper");
  const dome: V2[] = [[0, d.drumCorniceTop]];
  const steps = 14;
  const startZ = d.drumCorniceTop;
  const top = d.lanternBase;
  for (let i = 0; i <= steps; i++) {
    const z = startZ + ((top - startZ) * i) / steps;
    const r = Math.sqrt(Math.max(0, d.domeRadius * d.domeRadius - (z - d.domeSpring) * (z - d.domeSpring)));
    dome.push([Math.max(d.lanternRadius, r), z]);
  }
  dome.push([0, top]);
  front.lathe(d.u, proud, dome, segments);
  // Ribs along the dome's meridians, a little proud of its skin.
  for (let k = 0; k < d.ribs; k++) {
    const angle = (2 * Math.PI * k) / d.ribs;
    const path: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const z = startZ + ((top - startZ - 0.25) * i) / 8;
      const r = Math.sqrt(Math.max(0, d.domeRadius * d.domeRadius - (z - d.domeSpring) * (z - d.domeSpring))) + 0.02;
      const point = frontPoint(d.u + r * Math.cos(angle), z, proud + r * Math.sin(angle));
      path.push(point);
    }
    front.mesh.tube(path, path.map(() => 0.035), 4, true);
  }
  front.lathe(d.u, proud, [
    [0, d.lanternBase], [d.lanternRadius, d.lanternBase], [d.lanternRadius, d.lanternCorniceBottom], [d.lanternCorniceRadius, d.lanternCorniceBottom + 0.12],
    [d.lanternCorniceRadius, d.lanternCorniceTop], [d.lanternRadius * 0.9, d.lanternCorniceTop + 0.12], [d.lanternRadius * 0.55, d.cupolaTop - 0.25],
    [0.12, d.cupolaTop - 0.05], [0.06, d.cupolaTop], [0, d.cupolaTop],
  ], Math.max(12, segments / 2));
  front.lathe(d.u, proud, arcPoints(0, d.finialTip - 0.13, 0.13, -Math.PI / 2, Math.PI / 2, 8).map(([r, z]): V2 => [Math.max(0, r), z]), 10);
  front.as("paint");
  const pole = d.flagpoleDiameter / 2;
  // Let into the pedestal it stands on.
  const foot = d.flagpoleBase - LET_IN;
  front.lathe(d.flagpoleU, -d.flagpoleBehindFace, [[0, foot], [pole, foot], [pole * 0.6, d.flagpoleTop], [0, d.flagpoleTop]], 8);
}

/** The ground floor of one bay: plinth, wall, courses, openings and their fill. */
function groundFloor(front: FrontBuilder, bay: FrontBay, face: number, openings: readonly GroundOpening[]): void {
  const { plinthTop, plinthProud, channelDepth, stringBottom } = FRONT_LEVELS;
  const holes = openings.map((opening) => openingOutline(opening.u, opening.width / 2, opening.bottom, opening.top, opening.head === "flat" ? 0 : opening.rise));
  front.as("stone");
  // The wall behind the channelled courses: its full depth to the hall's floor (every opening lies below it),
  // and from there to the string course only as deep as the window wall's body leaves it.
  const split = Math.min(FLOOR_Z, stringBottom);
  front.slab([[bay.uMin, 0], [bay.uMax, 0], [bay.uMax, split], [bay.uMin, split]], holes, wallBack(bay, 0), face - channelDepth);
  front.slab([[bay.uMin, split], [bay.uMax, split], [bay.uMax, stringBottom], [bay.uMin, stringBottom]], [], wallBack(bay, split), face - channelDepth);
  // The plinth, broken where a door comes down through it.
  const blocked = openings.filter((opening) => opening.bottom < plinthTop).map((opening): [number, number] => [opening.u - opening.width / 2, opening.u + opening.width / 2]);
  for (const [a, b] of openIntervals(bay.uMin, bay.uMax, blocked)) front.box(a, b, 0, plinthTop, face - channelDepth, face + plinthProud);
  courses(front, bay.uMin, bay.uMax, face, openings);
  for (const opening of openings) {
    voussoirs(front, opening, face);
    if (opening.fill === "shopfront") shopfront(front, opening, face);
    else if (opening.fill === "doorway") doorway(front, opening, face);
    else frontDoor(front, opening, face);
  }
}

/** The principal floor's wall of one bay, from the string course to the entablature, open where the hall's windows are. */
function principalWall(front: FrontBuilder, bay: FrontBay, face: number, back: number, holes: readonly (readonly V2[])[]): void {
  const { stringTop, architraveBottom } = FRONT_LEVELS;
  front.as("stone").slab([[bay.uMin, stringTop], [bay.uMax, stringTop], [bay.uMax, architraveBottom], [bay.uMin, architraveBottom]], holes, back, face);
}

/** The hall's floor, over the pavement: above it the window wall's body stands behind the front. */
const FLOOR_Z = frontZ(0);

/** Whether a bay stands in front of the window wall's body (as the pavilions, links and temple front do). */
function onTheBody(bay: FrontBay): boolean {
  const xFar = Math.max(Math.abs(FRONT_AXIS_X - bay.uMin), Math.abs(FRONT_AXIS_X - bay.uMax));
  return xFar <= ROOM_BODY_HALF_X + 0.15;
}

/**
 * How far back a bay's wall reaches at height z over the pavement: a skin
 * on the window wall's body wherever that stands behind it (above the hall's
 * floor, in front of the room), and the wall's full depth elsewhere.
 */
function wallBack(bay: FrontBay, z: number): number {
  if (onTheBody(bay) && z >= FLOOR_Z - 1e-6) return SKIN_GAP;
  return (onTheBody(bay) ? -GROUND_WALL_DEPTH : -FREE_WALL_DEPTH) + SKIN_GAP;
}

/** What the build makes: the front's geometry and how big it is. */
export interface HallFrontBuild {
  readonly geometry: BufferGeometry;
  readonly triangles: number;
}

/** How finely the front's round things are drawn: a phone's finish takes fewer segments. */
export interface HallFrontDetail {
  readonly columnSegments: number;
  readonly balusterSegments: number;
  readonly domeSegments: number;
}

export const FRONT_DETAIL_FULL: HallFrontDetail = { columnSegments: 24, balusterSegments: 8, domeSegments: 48 };
export const FRONT_DETAIL_LIGHT: HallFrontDetail = { columnSegments: 14, balusterSegments: 6, domeSegments: 32 };

/** Builds the front piece by piece, yielding between pieces. */
export function* hallFrontSteps(detail: HallFrontDetail = FRONT_DETAIL_FULL): Steps<HallFrontBuild> {
  const front = new FrontBuilder();
  const windows = hallWindowHoles();
  const levels = FRONT_LEVELS;

  for (const bay of FRONT_BAYS) {
    const openings = GROUND_OPENINGS.filter((opening) => opening.u > bay.uMin && opening.u < bay.uMax);
    const temple = bay.kind === "temple";
    // The channelled blocks stand out from the wall's plane by their channels' depth, so the channels lie in
    // the plane of the wall above (I) and never behind it; the temple front's ground floor is its podium.
    const groundFace = temple ? TEMPLE.podiumProud : bay.proud + levels.channelDepth;
    groundFloor(front, bay, groundFace, openings);
    // The string course, as deep as each bay's face; over the podium it is the podium's own top member.
    const stringBack = wallBack(bay, levels.stringBottom);
    const stringTop = temple ? TEMPLE.podiumTop : levels.stringTop;
    const stringOut = groundFace + (temple ? TEMPLE.podiumTopProud : levels.stringProud);
    front.as("stone").run(bay.uMin, bay.uMax, [[stringBack, levels.stringBottom], [stringOut, levels.stringBottom], [stringOut, stringTop], [stringBack, stringTop]]);
    yield;

    const back = wallBack(bay, levels.stringTop);
    const holes: V2[][] = [];
    const mine = windows.filter((window) => window.u > bay.uMin && window.u < bay.uMax);
    for (const window of mine) holes.push(openingOutline(window.u, window.halfWidth, window.bottom, window.top, window.rise));
    if (bay.kind === "end-bay") {
      const side = Math.sign(bay.uMin + bay.uMax);
      const u = side * END_BAY_WINDOWS.u;
      const e = END_BAY_WINDOWS;
      holes.push(openingOutline(u, e.glassWidth / 2, levels.sill, e.glassTop, 0));
      holes.push(openingOutline(u, e.mezzanineGlassWidth / 2, e.mezzanineGlassBottom, e.mezzanineGlassTop, 0));
    }
    principalWall(front, bay, bay.proud, back, holes);
    // A surround set into the wall by `depth`, but never into the window wall's body behind a skin.
    const seat = (depth: number): number => Math.max(back, bay.proud - depth);

    // The hall's windows: stone sills under them, and their surrounds.
    for (const window of mine) {
      front.as("stone");
      front.box(window.u - window.halfWidth - 0.12, window.u + window.halfWidth + 0.12, window.bottom - 0.14, window.bottom, seat(0.05), bay.proud + 0.13);
      if (window.rise > 0) {
        // A Venetian window's archivolt round its fanlight, and imposts at the springing.
        const v = PRINCIPAL_WINDOWS.venetian;
        const outer = openingOutline(window.u, window.halfWidth + v.recessBand, window.top, window.top + 1e-3, window.rise + v.recessBand, 18).slice(2);
        const inner = openingOutline(window.u, window.halfWidth, window.top, window.top + 1e-3, window.rise, 18).slice(2);
        front.slab([...outer, ...[...inner].reverse()], [], seat(0.02), bay.proud + 0.05);
        for (const side of [-1, 1] as const) {
          front.box(window.u + side * window.halfWidth - 0.06 * side, window.u + side * (window.halfWidth + v.recessBand), window.top - 0.16, window.top, seat(0.02), bay.proud + 0.07);
        }
      } else {
        // A link's pedimented window: architrave, consoles, pediment, and the bronze griffin panel over it.
        const p = PRINCIPAL_WINDOWS.pedimented;
        const half = window.halfWidth;
        const band = (p.architraveWidth - 2 * half) / 2;
        front.slab(
          bandOutline(openingOutline(window.u, half + band, window.bottom, window.top + band, 0), openingOutline(window.u, half, window.bottom, window.top, 0)),
          [], seat(0.02), bay.proud + 0.06,
        );
        for (const side of [-1, 1] as const) {
          front.box(window.u + side * (half + band), window.u + side * (half + band + p.consoleWidth), p.consoleBottom, p.consoleTop, bay.proud, bay.proud + 0.16);
        }
        const ped = p.pedimentWidth / 2;
        front.box(window.u - ped, window.u + ped, p.consoleTop, p.pedimentBase, bay.proud, bay.proud + 0.2);
        front.slab([[window.u - ped, p.pedimentBase], [window.u + ped, p.pedimentBase], [window.u, p.pedimentApex]], [], bay.proud, bay.proud + 0.18);
        front.as("metal");
        front.box(window.u - p.panelWidth / 2, window.u + p.panelWidth / 2, p.panelBottom, p.panelTop, bay.proud, bay.proud + 0.025);
      }
    }
    if (bay.kind === "end-bay") {
      const side = Math.sign(bay.uMin + bay.uMax);
      const u = side * END_BAY_WINDOWS.u;
      const e = END_BAY_WINDOWS;
      front.as("stone");
      front.slab(bandOutline(openingOutline(u, e.architraveWidth / 2, levels.sill, e.architraveTop, 0), openingOutline(u, e.glassWidth / 2, levels.sill, e.glassTop, 0)), [], bay.proud - 0.02, bay.proud + 0.06);
      front.box(u - e.architraveWidth / 2 - 0.1, u + e.architraveWidth / 2 + 0.1, levels.sill - 0.12, levels.sill, bay.proud - 0.02, bay.proud + 0.12);
      for (const s of [-1, 1] as const) front.box(u + s * e.architraveWidth / 2, u + s * (e.architraveWidth / 2 + 0.2), e.consoleBottom, e.consoleTop, bay.proud, bay.proud + 0.15);
      front.run(u - e.corniceWidth / 2, u + e.corniceWidth / 2, corniceProfile(bay.proud, e.corniceBottom, e.corniceTop, 0.18, bay.proud - 0.02));
      front.slab(openingOutline(u, e.mezzanineFrameWidth / 2, e.mezzanineFrameBottom, e.mezzanineFrameTop, 0), [openingOutline(u, e.mezzanineGlassWidth / 2, e.mezzanineGlassBottom, e.mezzanineGlassTop, 0)], bay.proud - 0.02, bay.proud + 0.05);
      glazedWindow(front, u, e.glassWidth / 2, levels.sill, e.glassTop, bay.proud, [3, 4]);
      glazedWindow(front, u, e.mezzanineGlassWidth / 2, e.mezzanineGlassBottom, e.mezzanineGlassTop, bay.proud, [3, 2]);
    }
    yield;

    // The main entablature: architrave and frieze, and the cornice standing out over them.
    front.as("stone");
    front.box(bay.uMin, bay.uMax, levels.architraveBottom, levels.friezeTop, back, bay.proud + 0.05);
    front.run(bay.uMin, bay.uMax, corniceProfile(bay.proud + 0.05, levels.friezeTop, levels.corniceTop, levels.corniceProjection, back));
    if (bay.kind === "pavilion") {
      const centre = (bay.uMin + bay.uMax) / 2;
      for (const du of BALUSTRADES.pavilionPaterae.du) {
        front.disc(centre + du * Math.sign(centre), BALUSTRADES.pavilionPaterae.z, bay.proud + 0.05, bay.proud + 0.08, BALUSTRADES.pavilionPaterae.diameter / 2, 12);
      }
    }
    yield;

    // Above the main cornice: each part's own upper storey.
    const upperFace = bay.proud;
    if (bay.kind === "end-bay") {
      balustrade(front, bay.uMin + 0.05, bay.uMax - 0.05, BALUSTRADES.endBay.bottom, BALUSTRADES.endBay.top, upperFace - 0.05, BALUSTRADES.endBay.balusters, detail.balusterSegments);
    } else if (bay.kind === "link") {
      const a = BALUSTRADES.linkAttic;
      const centre = (bay.uMin + bay.uMax) / 2;
      front.as("stone").slab([[bay.uMin, levels.corniceTop], [bay.uMax, levels.corniceTop], [bay.uMax, a.corniceBottom], [bay.uMin, a.corniceBottom]], [openingOutline(centre, a.windowWidth / 2, a.windowBottom, a.windowTop, 0)], back, upperFace);
      glazedWindow(front, centre, a.windowWidth / 2, a.windowBottom, a.windowTop, upperFace, [3, 2]);
      front.as("stone").run(bay.uMin, bay.uMax, corniceProfile(upperFace, a.corniceBottom, a.corniceTop, 0.2, back));
      balustrade(front, bay.uMin, bay.uMax, BALUSTRADES.link.bottom, BALUSTRADES.link.top, upperFace - 0.05, BALUSTRADES.link.balusters, detail.balusterSegments);
    } else if (bay.kind === "pavilion") {
      const a = BALUSTRADES.pavilionAttic;
      const centre = (bay.uMin + bay.uMax) / 2;
      const windowsUpper = [openingOutline(centre, a.centreWidth / 2, a.windowBottom, a.windowTop, 0), openingOutline(centre - a.sideU, a.sideWidth / 2, a.windowBottom, a.windowTop, 0), openingOutline(centre + a.sideU, a.sideWidth / 2, a.windowBottom, a.windowTop, 0)];
      front.as("stone").rowSlab(bay.uMin, bay.uMax, levels.corniceTop, a.corniceBottom, windowsUpper, back, upperFace);
      glazedWindow(front, centre, a.centreWidth / 2, a.windowBottom, a.windowTop, upperFace, [3, 2]);
      glazedWindow(front, centre - a.sideU, a.sideWidth / 2, a.windowBottom, a.windowTop, upperFace, [1, 2]);
      glazedWindow(front, centre + a.sideU, a.sideWidth / 2, a.windowBottom, a.windowTop, upperFace, [1, 2]);
      front.as("stone").run(bay.uMin - 0.3, bay.uMax + 0.3, corniceProfile(upperFace, a.corniceBottom, a.corniceTop, 0.3, back));
      // The parapet: solid dies between three groups of balusters, under a coping.
      front.box(bay.uMin, bay.uMax, a.corniceTop, a.parapetPlinthTop, upperFace - 0.36, upperFace - 0.04);
      front.box(bay.uMin - 0.02, bay.uMax + 0.02, a.copingBottom, a.top, upperFace - 0.38, upperFace);
      const groups = a.groups.map((group) => {
        const width = group.balusters * a.pitch;
        return { from: centre + group.du - width / 2, to: centre + group.du + width / 2, count: group.balusters };
      });
      for (const [from, to] of openIntervals(bay.uMin, bay.uMax, groups.map((group): [number, number] => [group.from, group.to]))) {
        front.box(from, to, a.parapetPlinthTop, a.copingBottom, upperFace - 0.36, upperFace - 0.04);
      }
      for (const group of groups) balustrade(front, group.from, group.to, a.parapetPlinthTop - 0.001, a.copingBottom + 0.001, upperFace - 0.04, group.count, detail.balusterSegments, true);
    } else {
      // The temple front: its back wall continues up behind the pediment to the attic.
      front.as("stone").box(bay.uMin, bay.uMax, levels.corniceTop, TEMPLE.atticBottom, back, upperFace);
    }
    yield;
  }

  // The temple front: four columns and the responds behind each pair, their entablature and pediment, the rosette attic.
  const t = TEMPLE;
  for (const u of t.columnU) ionicColumn(front, u, t.columnAxisProud, detail.columnSegments);
  front.as("stone");
  for (const pair of [[t.columnU[0], t.columnU[1]], [t.columnU[2], t.columnU[3]]] as const) {
    const centre = (pair[0] + pair[1]) / 2;
    front.box(centre - t.respondHalfWidth, centre + t.respondHalfWidth, t.podiumTop, t.columnTop, LINK_FACE_PROUD, t.respondProud);
  }
  // The rainwater pipes down the links' corners, let into the pavement.
  front.as("metal");
  for (const u of DOWNPIPES.u) {
    front.lathe(u, DOWNPIPES.proud, [[0, -LET_IN], [DOWNPIPES.radius, -LET_IN], [DOWNPIPES.radius, DOWNPIPES.top], [0, DOWNPIPES.top]], 8);
  }
  yield;
  front.as("stone");
  // The entablature and pediment are a skin on the window wall's body, as every bay is (wallBack): their
  // back on the wall's own plane fought its outer face where a cut shows the section.
  front.box(-t.entablatureHalfWidth, t.entablatureHalfWidth, t.entablatureBottom, t.entablatureFriezeTop, SKIN_GAP, t.entablatureProud);
  front.run(-t.entablatureHalfWidth - 0.05, t.entablatureHalfWidth + 0.05, corniceProfile(t.entablatureProud, t.entablatureFriezeTop, t.entablatureTop, t.pedimentCorniceProud - t.entablatureProud, SKIN_GAP));
  // The frieze's paterae over the outer columns (P).
  for (const u of [-t.columnU[3], t.columnU[3]]) front.disc(u, 10.502, t.entablatureProud, t.entablatureProud + 0.03, 0.18, 12);
  const ph = t.pedimentHalfWidth;
  front.slab([[-ph + 0.3, t.entablatureTop], [ph - 0.3, t.entablatureTop], [0, t.pedimentApex - t.rakingCorniceDepth]], [], SKIN_GAP, t.entablatureProud - 0.04);
  // The raking cornices, one up each side to the apex, standing on the entablature's cornice (the pediment's
  // level member). Cut as one ring round the tympanum, the ring's foot was a millimetre's sliver, thinner than
  // the cut's pull toward the eye (hall-exterior-material.ts CUT_EYEWARD_MAX): its underside drew over its top.
  front.slab([[-ph, t.entablatureTop], [-ph + 0.42, t.entablatureTop], [0, t.pedimentApex - t.rakingCorniceDepth], [0, t.pedimentApex]], [], SKIN_GAP, t.pedimentCorniceProud);
  front.slab([[ph - 0.42, t.entablatureTop], [ph, t.entablatureTop], [0, t.pedimentApex], [0, t.pedimentApex - t.rakingCorniceDepth]], [], SKIN_GAP, t.pedimentCorniceProud);
  front.box(-t.atticHalfWidth, t.atticHalfWidth, t.atticBottom, t.atticCorniceBottom, -0.2, 0.02);
  front.box(-t.atticHalfWidth - 0.04, t.atticHalfWidth + 0.04, t.atticBottom, t.atticBaseTop, -0.2, 0.08);
  front.run(-t.atticHalfWidth - 0.08, t.atticHalfWidth + 0.08, corniceProfile(0.02, t.atticCorniceBottom, t.atticTop, 0.14, -0.2));
  const half = (t.rosetteCount - 1) / 2;
  for (let i = 0; i < t.rosetteCount; i++) {
    const u = (i - half) * t.rosettePitch;
    const zc = (t.rosetteBottom + t.rosetteTop) / 2;
    const r = t.rosetteOctagon / 2;
    const octagon: V2[] = [];
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      octagon.push([u + r * Math.cos(a), zc + r * Math.sin(a)]);
    }
    front.slab(octagon, [], 0.02, 0.04);
    front.disc(u, zc, 0.04, 0.075, t.rosetteDiameter / 2, 10);
  }
  yield;

  sculpture(front);
  domeGroup(front, detail.domeSegments);
  yield;

  return { geometry: front.mesh.build(), triangles: front.mesh.triangles };
}

/** Builds the whole front at once (tests, and anything that needs it now). */
export function buildHallFront(detail: HallFrontDetail = FRONT_DETAIL_FULL): HallFrontBuild {
  return drain(hallFrontSteps(detail));
}

/** The front's extent in plan, planner x and z, for the city's cut and the tests. */
export function frontFootprint(): { readonly xMin: number; readonly xMax: number; readonly zMin: number; readonly zMax: number } {
  const xs = [frontPoint(-FRONT_HALF_WIDTH, 0, 0)[0], frontPoint(FRONT_HALF_WIDTH, 0, 0)[0]];
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    zMin: FRONT_FACE_Z - TEMPLE.pedimentCorniceProud,
    zMax: FRONT_FACE_Z + GROUND_WALL_DEPTH,
  };
}
