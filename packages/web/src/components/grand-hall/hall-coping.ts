// ---------------------------------------------------------------------------
// Nocturne's moulded top: a coping laid on the cut, a presentation device
//
// The Nocturne section (hall-section.ts SECTION_PRESETS) dresses the cut with
// a moulded top: 60 mm of dark polished stone standing on the section and
// projecting 30 mm beyond both faces of the wall, an ovolo rounding into its
// top on each side over a short fillet, a gilt line along each crest and a warm
// glint of the chandeliers in the polish. It is not part of the building (a
// model maker's flourish), and the frames that show it say so.
//
// Like the bodies (hall-wall-body.ts), it never moves on the CPU: every vertex
// carries its wall (and on a corner block its neighbour) and its height above
// the cut, and the shader sets it on the lower of its walls' cuts, no higher
// than the walls' top. Where the cut passes through a window or a door, or
// over a doorway whose walling has gone (LINTEL_RELEASE), the top is not
// drawn, so every opening reads as it does without it. Runs follow each
// wall's own thickness (HALL_WALL_THICKNESS, HALL_WALL_STRETCHES, the
// doorways' depths); the short walls' runs stop short of the long walls'
// projections, so no two tops share a plane, and the four corner blocks get
// their own square tops.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry, Color } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { attribute, bool, cameraPosition, dot, float, max, min, mix, normalize, positionLocal, positionWorld, pow, reflect, sqrt, vec3 } from "three/tsl";
import { HALL_CHANDELIERS, HALL_WALLS, HALL_WALL_STRETCHES, wallPoint, type HallWall } from "./hall-spec.js";
import { DOOR_SLOTS, LINTEL_RELEASE, WALL_BODY_TOP, bodyOpenings, bodyThicknessAt, chainAt, type BodyOpening } from "./hall-wall-body.js";
import type { HallSectionUniforms } from "./hall-materials.js";
import type { HallMoodUniforms } from "./hall-mood.js";
import { GILT_COLOUR, GILT_MIN_PIXELS, lineCoverage } from "./hall-cut-lines.js";
import type { V3 } from "./mesh-builder.js";

/** The moulded top's section, metres: its height, its projection beyond each face, the fillet under each ovolo. */
export const COPING = { height: 0.06, projection: 0.03, fillet: 0.022 } as const;
/** The ovolo's radius: from the fillet to the top. */
const OVOLO = COPING.height - COPING.fillet;
/** Segments round each ovolo. */
const OVOLO_SEGMENTS = 4;
/** The gilt lines along the top's crests, where each ovolo rounds into it: 5 mm, never under GILT_MIN_PIXELS. */
export const COPING_GILT = 0.005;
/** The stone (sRGB): dark polished, a little warm, a shade lighter than the ebonised body under it. */
export const COPING_STONE = "#2b2522";

/** A run of the top along one wall at one thickness: wall-local u from `u0` to `u1`. */
export interface CopingRun {
  readonly wall: number;
  readonly u0: number;
  readonly u1: number;
  /** The wall's thickness there: the outer face lies this far behind its plane. */
  readonly thickness: number;
}

/** The short walls (end, fireplace) stop their runs this far from the corners, inside the long walls' projections. */
const SHORT_WALL_INSET = COPING.projection;

/** Each wall's runs, merged wherever its thickness holds. */
export function copingRuns(): CopingRun[] {
  const runs: CopingRun[] = [];
  HALL_WALLS.forEach((wall, index) => {
    const openings = bodyOpenings(wall);
    const inset = index === 1 || index === 3 ? SHORT_WALL_INSET : 0;
    const stations = new Set<number>([inset, wall.length - inset]);
    for (const stretch of HALL_WALL_STRETCHES[wall.id]) { stations.add(stretch.from); stations.add(stretch.to); }
    for (const entry of openings) if (entry.door !== null) { stations.add(entry.back.u0); stations.add(entry.back.u1); }
    const us = [...stations].filter((u) => u >= inset - 1e-9 && u <= wall.length - inset + 1e-9).sort((a, b) => a - b);
    let current: CopingRun | null = null;
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i] ?? 0;
      const u1 = us[i + 1] ?? 0;
      if (u1 - u0 < 1e-6) continue;
      const thickness = bodyThicknessAt(wall, openings, (u0 + u1) / 2);
      if (current !== null && Math.abs(current.thickness - thickness) < 1e-9) {
        current = { wall: current.wall, u0: current.u0, u1, thickness: current.thickness };
      } else {
        if (current !== null) runs.push(current);
        current = { wall: index, u0, u1, thickness };
      }
    }
    if (current !== null) runs.push(current);
  });
  return runs;
}

/** The section across a run, (depth into the room, height above the cut): up the room side, over the top, down the outer side. */
export function copingProfile(thickness: number): (readonly [number, number])[] {
  const p = COPING.projection;
  const out: (readonly [number, number])[] = [[p, 0], [p, COPING.fillet]];
  for (let k = 1; k <= OVOLO_SEGMENTS; k++) {
    const a = (Math.PI / 2) * (k / OVOLO_SEGMENTS);
    out.push([p - OVOLO + OVOLO * Math.cos(a), COPING.fillet + OVOLO * Math.sin(a)]);
  }
  const back = -thickness - p;
  for (let k = OVOLO_SEGMENTS; k >= 1; k--) {
    const a = (Math.PI / 2) * (k / OVOLO_SEGMENTS);
    out.push([back + OVOLO - OVOLO * Math.cos(a), COPING.fillet + OVOLO * Math.sin(a)]);
  }
  out.push([back, COPING.fillet], [back, 0]);
  return out;
}

interface Writer {
  readonly positions: number[];
  readonly normals: number[];
  readonly coping: number[];
  /** Metres in from the top's room-side and outer edges (its crests, where the gilt lines run), along the section. */
  readonly edges: number[];
  readonly indices: number[];
}

/** Far from any crest: faces with no gilt line (the ends, the corner blocks). */
const NO_EDGE = 1;

/** One vertex: its plan position, its normal, its walls and its height above the cut. */
function push(w: Writer, p: V3, n: V3, wallA: number, wallB: number, height: number, edges: readonly [number, number] = [NO_EDGE, NO_EDGE]): number {
  const id = w.positions.length / 3;
  w.positions.push(p[0], height, p[2]);
  w.normals.push(n[0], n[1], n[2]);
  w.coping.push(wallA, wallB, height, 0);
  w.edges.push(edges[0], edges[1]);
  return id;
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A quad a-b-c-d wound so its face points along `n`, `e1` and `e2` its edges from a to b and from a to d. */
function quadAlong(w: Writer, ids: readonly [number, number, number, number], e1: V3, e2: V3, n: V3): void {
  const [a, b, c, d] = ids;
  if (dot3(cross(e1, e2), n) >= 0) w.indices.push(a, b, c, a, c, d);
  else w.indices.push(a, c, b, a, d, c);
}

/** A run along `wall` from u0 to u1: its profile swept along the wall, capped at both ends. */
function writeRun(w: Writer, wall: HallWall, wallIndex: number, run: CopingRun): void {
  const profile = copingProfile(run.thickness);
  const tangent: V3 = [wall.tangent[0], 0, wall.tangent[2]];
  const toRoom: V3 = [wall.normal[0], 0, wall.normal[2]];
  const at = (u: number, d: number): V3 => wallPoint(wall, u, 0, d);
  for (let i = 0; i + 1 < profile.length; i++) {
    const p = profile[i];
    const q = profile[i + 1];
    if (p === undefined || q === undefined) continue;
    // Outward in the (depth, height) plane: the profile runs up the room side and down the
    // outer side, so outward is (dh, -dd) normalised.
    const dd = q[0] - p[0];
    const dh = q[1] - p[1];
    const l = Math.hypot(dd, dh);
    const n: V3 = [(toRoom[0] * dh) / l, -dd / l, (toRoom[2] * dh) / l];
    // Signed metres from each crest across the section: 0 on the crest, positive over the top.
    const roomCrest = COPING.projection - OVOLO;
    const outerCrest = -run.thickness - COPING.projection + OVOLO;
    const edgesOf = (d: number): [number, number] => [roomCrest - d, d - outerCrest];
    const ids = [
      push(w, at(run.u0, p[0]), n, wallIndex, -1, p[1], edgesOf(p[0])),
      push(w, at(run.u1, p[0]), n, wallIndex, -1, p[1], edgesOf(p[0])),
      push(w, at(run.u1, q[0]), n, wallIndex, -1, q[1], edgesOf(q[0])),
      push(w, at(run.u0, q[0]), n, wallIndex, -1, q[1], edgesOf(q[0])),
    ] as const;
    quadAlong(w, ids, tangent, [toRoom[0] * dd, dh, toRoom[2] * dd], n);
  }
  // End caps: the profile (convex) fanned from its first point, facing out of the run at each end.
  for (const [u, sign] of [[run.u0, -1], [run.u1, 1]] as const) {
    const n: V3 = [tangent[0] * sign, 0, tangent[2] * sign];
    const ids = profile.map(([d, h]) => push(w, at(u, d), n, wallIndex, -1, h));
    const first = ids[0];
    const firstPoint = profile[0];
    if (first === undefined || firstPoint === undefined) continue;
    for (let i = 1; i + 1 < ids.length; i++) {
      const b = ids[i];
      const c = ids[i + 1];
      const pb = profile[i];
      const pc = profile[i + 1];
      if (b === undefined || c === undefined || pb === undefined || pc === undefined) continue;
      const e1: V3 = [toRoom[0] * (pb[0] - firstPoint[0]), pb[1] - firstPoint[1], toRoom[2] * (pb[0] - firstPoint[0])];
      const e2: V3 = [toRoom[0] * (pc[0] - firstPoint[0]), pc[1] - firstPoint[1], toRoom[2] * (pc[0] - firstPoint[0])];
      if (dot3(cross(e1, e2), n) >= 0) w.indices.push(first, b, c);
      else w.indices.push(first, c, b);
    }
  }
}

/**
 * A corner block's square top: in wall A's frame, from A's end out to the
 * neighbouring wall's outer face and its projection, and from A's outer
 * projection to A's room-side projection; it takes the lower of the two
 * walls' cuts. A slab as high as the moulding, its sides plain.
 */
function writeCorner(w: Writer, a: HallWall, ai: number, bi: number, ta: number, tb: number): void {
  const p = COPING.projection;
  const h = COPING.height;
  const c0 = wallPoint(a, a.length, 0, -ta - p);
  const c1 = wallPoint(a, a.length + tb + p, 0, -ta - p);
  const c2 = wallPoint(a, a.length + tb + p, 0, p);
  const c3 = wallPoint(a, a.length, 0, p);
  const up: V3 = [0, 1, 0];
  const top = [push(w, c0, up, ai, bi, h), push(w, c1, up, ai, bi, h), push(w, c2, up, ai, bi, h), push(w, c3, up, ai, bi, h)] as const;
  quadAlong(w, top, [c1[0] - c0[0], 0, c1[2] - c0[2]], [c3[0] - c0[0], 0, c3[2] - c0[2]], up);
  const corners = [c0, c1, c2, c3];
  const mid: V3 = [(c0[0] + c2[0]) / 2, 0, (c0[2] + c2[2]) / 2];
  corners.forEach((p0, i) => {
    const p1 = corners[(i + 1) % 4];
    if (p1 === undefined) return;
    const ex = p1[0] - p0[0];
    const ez = p1[2] - p0[2];
    const l = Math.hypot(ex, ez);
    let n: V3 = [ez / l, 0, -ex / l];
    if ((p0[0] - mid[0]) * n[0] + (p0[2] - mid[2]) * n[2] < 0) n = [-n[0], 0, -n[2]];
    const ids = [push(w, p0, n, ai, bi, 0), push(w, p1, n, ai, bi, 0), push(w, p1, n, ai, bi, h), push(w, p0, n, ai, bi, h)] as const;
    quadAlong(w, ids, [ex, 0, ez], [0, h, 0], n);
  });
}

export interface CopingGeometry {
  readonly geometry: BufferGeometry;
  readonly triangles: number;
}

/** The moulded top over every wall and corner block, in one geometry. Heights are above the cut (the shader places them). */
export function buildCoping(): CopingGeometry {
  const w: Writer = { positions: [], normals: [], coping: [], edges: [], indices: [] };
  for (const run of copingRuns()) {
    const wall = HALL_WALLS[run.wall];
    if (wall !== undefined) writeRun(w, wall, run.wall, run);
  }
  HALL_WALLS.forEach((a, ai) => {
    const bi = (ai + 1) % HALL_WALLS.length;
    const b = HALL_WALLS[bi];
    if (b === undefined) return;
    writeCorner(w, a, ai, bi, bodyThicknessAt(a, bodyOpenings(a), a.length - 1e-3), bodyThicknessAt(b, bodyOpenings(b), 1e-3));
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(w.positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(w.normals), 3));
  geometry.setAttribute("aCoping", new BufferAttribute(new Float32Array(w.coping), 4));
  geometry.setAttribute("aCopingEdge", new BufferAttribute(new Float32Array(w.edges), 2));
  geometry.setIndex(w.indices);
  geometry.computeBoundingBox();
  // The shader raises every vertex onto its cut: the bounds hold the walls' whole height.
  const box = geometry.boundingBox;
  if (box !== null) { box.min.y = 0; box.max.y = WALL_BODY_TOP + COPING.height; }
  geometry.computeBoundingSphere();
  geometry.name = "grand-hall-coping";
  return { geometry, triangles: w.indices.length / 3 };
}

// ---------------------------------------------------------------------------
// The shader's rules
// ---------------------------------------------------------------------------

/** Where a wall's moulded top stands for its cut: on the cut, no higher than the walls' top. */
export function copingBase(cut: number): number {
  return Math.min(cut, WALL_BODY_TOP);
}

/** An opening's front hole's lower edge and its upper edge at `u` (a flat head, or an arch's crown). */
function holeEdges(opening: BodyOpening, u: number): { readonly lower: number; readonly upper: number } {
  return { lower: chainAt(opening.front.lower, u), upper: chainAt(opening.front.upper, u) };
}

/**
 * Whether the top shows at wall-local `u` on wall `wall` (HALL_WALLS index)
 * for its `cut`: not where the cut passes through an opening (its outline,
 * widened to the relief's footprint), nor over a doorway once its walling has
 * gone. (The shader's rule; its arches' crowns are circles through the same
 * springing and span.)
 */
export function copingShown(wall: number, u: number, cut: number): boolean {
  const entry = HALL_WALLS[wall];
  if (entry === undefined) return false;
  for (const opening of bodyOpenings(entry)) {
    const { lower, upper } = holeEdges(opening, u);
    if (u > opening.front.u0 && u < opening.front.u1 && cut > lower && cut < upper) return false;
  }
  return !(cut < LINTEL_RELEASE && DOOR_SLOTS.some((slot) => slot.wall === wall && u > slot.u0 && u < slot.u1));
}

function cutOfWall(section: HallSectionUniforms, wall: Node<"float">): Node<"float"> {
  const [c0, c1, c2, c3] = section.cuts;
  return wall.lessThan(-0.5).select(float(1000),
    wall.lessThan(0.5).select(c0, wall.lessThan(1.5).select(c1, wall.lessThan(2.5).select(c2, c3))));
}

function wallLocalU(index: number, p: Node<"vec3">): Node<"float"> {
  const w = HALL_WALLS[index];
  if (w === undefined) return float(0);
  return p.x.sub(w.origin[0]).mul(w.tangent[0]).add(p.z.sub(w.origin[2]).mul(w.tangent[2]));
}

/** copingShown, in the shader, for wall `index` (a constant) at the fragment. */
function shownOn(index: number, cut: Node<"float">, p: Node<"vec3">): Node<"bool"> {
  const wall = HALL_WALLS[index];
  if (wall === undefined) return bool(true);
  const u = wallLocalU(index, p);
  let hidden: Node<"bool"> = bool(false);
  for (const opening of bodyOpenings(wall)) {
    const hole = opening.front;
    const lower = float(chainAt(hole.lower, (hole.u0 + hole.u1) / 2));
    const half = (hole.u1 - hole.u0) / 2;
    const centre = (hole.u0 + hole.u1) / 2;
    const springing = Math.min(...hole.upper.map((point) => point[1]));
    const crown = Math.max(...hole.upper.map((point) => point[1]));
    const across = u.sub(centre);
    const upper = opening.opening.kind === "arched-window"
      ? sqrt(max(float(half * half).sub(across.mul(across)), float(0))).mul((crown - springing) / half).add(springing)
      : float(crown);
    hidden = hidden.or(u.greaterThan(hole.u0).and(u.lessThan(hole.u1)).and(cut.greaterThan(lower)).and(cut.lessThan(upper)));
  }
  for (const slot of DOOR_SLOTS.filter((entry) => entry.wall === index)) {
    hidden = hidden.or(cut.lessThan(LINTEL_RELEASE).and(u.greaterThan(slot.u0)).and(u.lessThan(slot.u1)));
  }
  return hidden.not();
}

function linearOf(hex: string): Node<"vec3"> {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/**
 * The moulded top's material: dark polished stone in the room's light (more
 * on its top than its sides), a gilt line along each of the top's crests,
 * and a warm glint of the chandeliers in the polish. Desktops take the glint
 * from the room's own reflections and lights (a physical surface, rough 0.16);
 * phones (`fakeGlint`) draw it as a highlight toward the dome's fitting
 * without the five lights. Hidden on a walk (the ceiling in place).
 */
export function createCopingMaterial(section: HallSectionUniforms, mood: HallMoodUniforms, fakeGlint: boolean): MeshBasicNodeMaterial | MeshStandardNodeMaterial {
  const tag = attribute("aCoping", "vec4");
  const cut = min(cutOfWall(section, tag.x), cutOfWall(section, tag.y));
  const base = min(cut, float(WALL_BODY_TOP));
  const walk = section.cuts[4].greaterThan(50);
  const p = positionWorld;
  // Each wall's own openings; a corner block (two walls) has none.
  let shown: Node<"bool"> = bool(true);
  HALL_WALLS.forEach((_wall, index) => {
    const onThis = tag.x.greaterThan(index - 0.5).and(tag.x.lessThan(index + 0.5)).and(tag.y.lessThan(-0.5));
    shown = shown.and(onThis.not().or(shownOn(index, cut, p)));
  });
  // The geometry's own normal (untransformed mesh), not normalWorld (hall-beyond.ts geometryNormal).
  const n = attribute("normal", "vec3");
  const stone = linearOf(COPING_STONE);
  const gilt = linearOf(GILT_COLOUR);
  const light = mood.ambient.rgb.mul(mood.ambientIntensity)
    .add(mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(0.35))
    .add(mood.skyHorizon.rgb.mul(mood.skyIntensity).mul(0.25))
    .mul(mix(float(0.55), float(1), max(n.y, float(0))));
  // The gilt lines along the top's two crests, where each ovolo rounds into it.
  const edges = attribute("aCopingEdge", "vec2");
  const line = max(lineCoverage(edges.x.abs(), COPING_GILT, float(1), GILT_MIN_PIXELS), lineCoverage(edges.y.abs(), COPING_GILT, float(1), GILT_MIN_PIXELS));
  const lit = mix(stone.mul(light), gilt.mul(light).mul(2.2), line);
  const position = walk.select(vec3(0, -50, 0), vec3(positionLocal.x, base.add(tag.z), positionLocal.z));
  if (fakeGlint) {
    const material = new MeshBasicNodeMaterial({ fog: false });
    const dome = HALL_CHANDELIERS[0]?.position ?? [0, 4.75, 0];
    const toLamp = normalize(vec3(dome[0], dome[1], dome[2]).sub(p));
    const view = normalize(cameraPosition.sub(p));
    const glint = pow(max(dot(reflect(view.negate(), n), toLamp), float(0)), 40).mul(0.9);
    material.colorNode = lit.add(mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(glint).mul(mood.glow.mul(0.5).add(0.5)));
    material.positionNode = position;
    material.maskNode = shown.and(cut.greaterThan(0.01));
    material.name = "grand-hall-coping";
    return material;
  }
  const material = new MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0, fog: false });
  material.colorNode = mix(stone, gilt, line);
  material.emissiveNode = lit;
  material.roughnessNode = mix(float(0.12), float(0.3), line);
  material.metalnessNode = line;
  material.positionNode = position;
  material.maskNode = shown.and(cut.greaterThan(0.01));
  material.name = "grand-hall-coping";
  return material;
}
