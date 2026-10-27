// ---------------------------------------------------------------------------
// The windows' glazing: panes of real glass, painted bars, outer reveals
//
// Under the real sky (?sky=1) the walls' photographs open where the atlas
// marks glass (hall-materials.ts), and the drawn city and sky show through.
// What stands in that opening is built here, from the measured glazing
// (HALL_GLAZING, hall-spec.ts):
//
//   - Panes: one sheet of glass per window at the relief's glass plane, which
//     reflects the room it looks into: the room's own captured environment
//     (hall-capture.ts), box-projected onto the room so the chandeliers and
//     curtains stay where they hang as the camera moves, weighted by the
//     Fresnel reflectance of single glazing (two faces of soda-lime glass;
//     single glazing assumed, no source rules secondary glazing out; the
//     strength is checked against panorama scan_042, S2's measure 3). It
//     writes no depth and leaves the normal and velocity targets alone, so
//     ambient occlusion and temporal anti-aliasing see the street behind it.
//   - Bars: the sashes' stiles, rails and glazing bars, and the arched
//     windows' round heads and fanlights, as painted geometry with the room's
//     baked light, so they stand in front of the city and cast their shadows
//     into the sun's patches on the floor.
//   - Outer reveals: the opening from the glass out to the wall's outer face,
//     painted next to the glass (the sash box) and stone beyond.
//
// Everything is tagged as the window wall's, so the cutaway cuts it with the
// wall. The bars and reveals take hall-materials.ts's "paint"; the panes
// take createGlassMaterial below.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry, FrontSide, ShapeUtils, Vector2, type Texture, type Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, cameraPosition, dot, float, max, min, mrt, normalize, output, pmremTexture, positionWorld, pow, reflect, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import type { MeshBuilder, V2, V3 } from "./mesh-builder.js";
import type { HallBuilders } from "./hall-builders.js";
import { wallAtlasUv } from "./hall-atlas.js";
import type { HallPhotos } from "./hall-photos.js";
import type { HallSectionUniforms } from "./hall-materials.js";
import {
  HALL_GLAZING,
  HALL_GLAZING_SECTION,
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  HALL_HEIGHT,
  HALL_LIGHT_HALF_WIDTH,
  HALL_OPENINGS,
  HALL_SASH_OPENING_HALF_WIDTH,
  HALL_WALL_THICKNESS,
  hallWall,
  wallPoint,
  type HallFanlight,
  type HallGlazing,
  type HallWall,
} from "./hall-spec.js";

/** The window wall's index in HALL_WALLS (its cut and its atlas strip). */
export const WINDOW_WALL_INDEX = 0;

/** How far the painted sash box reaches out from the glass before the stone, metres. */
export const SASH_BOX_DEPTH = 0.06;

/** Segments of a semicircle: the round heads and the petal (1.5 mm chords), and the ring (1.6 mm). */
const ARC_SEGMENTS = 12;
const RING_SEGMENTS = 24;
const HOLE_SEGMENTS = 8;
/** Segments of a fanlight pane's semicircle. */
const PANE_SEGMENTS = 24;

const DEG = Math.PI / 180;

/** A point on the window wall's plane, wall-local (u, v). */
export type WallPoint2 = readonly [number, number];
type Point = WallPoint2;

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point, s: number): Point => [a[0] * s, a[1] * s];
const polar = (centre: Point, radius: number, degrees: number): Point =>
  [centre[0] + radius * Math.cos(degrees * DEG), centre[1] + radius * Math.sin(degrees * DEG)];

/** The world direction of a wall-local (du, dv). */
function wallDirection(wall: HallWall, d: Point): V3 {
  return [wall.tangent[0] * d[0], d[1], wall.tangent[2] * d[0]];
}

function at(wall: HallWall, p: Point, depth: number): V3 {
  return wallPoint(wall, p[0], p[1], depth);
}

/**
 * The faces a painted member shows: a straight member from `a` to `z` (its
 * centreline on the wall), `width` across, standing from the glass (`back`)
 * to `front` toward the room: its face and its two sides. No back: it stands
 * against the glass.
 */
function straightMember(b: MeshBuilder, wall: HallWall, a: Point, z: Point, width: number, back: number, front: number): void {
  const along: Point = [z[0] - a[0], z[1] - a[1]];
  const length = Math.hypot(along[0], along[1]);
  if (length < 1e-4) return;
  const unit = scale(along, 1 / length);
  const across: Point = [-unit[1], unit[0]];
  const half = scale(across, width / 2);
  const a0 = add(a, scale(half, -1));
  const a1 = add(a, half);
  const z0 = add(z, scale(half, -1));
  const z1 = add(z, half);
  const uv: V2 = [0, 0];
  b.quadFacing(at(wall, a0, front), at(wall, z0, front), at(wall, z1, front), at(wall, a1, front), uv, uv, uv, uv, wall.normal);
  b.quadFacing(at(wall, a0, back), at(wall, z0, back), at(wall, z0, front), at(wall, a0, front), uv, uv, uv, uv, wallDirection(wall, scale(across, -1)));
  b.quadFacing(at(wall, a1, back), at(wall, z1, back), at(wall, z1, front), at(wall, a1, front), uv, uv, uv, uv, wallDirection(wall, across));
}

/** A curved member: an arc of `radius` about `centre` from `from` to `to` degrees, `width` across. */
function arcMember(b: MeshBuilder, wall: HallWall, centre: Point, radius: number, from: number, to: number, width: number, back: number, front: number): void {
  const steps = Math.max(2, Math.ceil(ARC_SEGMENTS * Math.abs(to - from) / 180));
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  const uv: V2 = [0, 0];
  for (let i = 0; i < steps; i++) {
    const t0 = from + (to - from) * (i / steps);
    const t1 = from + (to - from) * ((i + 1) / steps);
    const i0 = polar(centre, inner, t0);
    const i1 = polar(centre, inner, t1);
    const o0 = polar(centre, outer, t0);
    const o1 = polar(centre, outer, t1);
    const mid = (t0 + t1) / 2;
    const outward: Point = [Math.cos(mid * DEG), Math.sin(mid * DEG)];
    b.quadFacing(at(wall, i0, front), at(wall, i1, front), at(wall, o1, front), at(wall, o0, front), uv, uv, uv, uv, wall.normal);
    b.quadFacing(at(wall, i0, back), at(wall, i1, back), at(wall, i1, front), at(wall, i0, front), uv, uv, uv, uv, wallDirection(wall, scale(outward, -1)));
    b.quadFacing(at(wall, o0, back), at(wall, o1, back), at(wall, o1, front), at(wall, o0, front), uv, uv, uv, uv, wallDirection(wall, outward));
  }
}

/**
 * The fanlight's pierced ring: its face from the inner rim to the outer, with
 * the round piercings open, and its two curved sides.
 */
function pierceRing(b: MeshBuilder, wall: HallWall, centre: Point, fan: HallFanlight, back: number, front: number): void {
  const { width } = HALL_GLAZING_SECTION.fanlight;
  const inner = fan.ringInner - width / 2;
  const outer = fan.ringOuter + width / 2;
  const steps = RING_SEGMENTS;
  const contour: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = polar(centre, outer, (180 * i) / steps);
    contour.push(new Vector2(p[0], p[1]));
  }
  for (let i = steps; i >= 0; i--) {
    const p = polar(centre, inner, (180 * i) / steps);
    contour.push(new Vector2(p[0], p[1]));
  }
  const middle = (fan.ringInner + fan.ringOuter) / 2;
  const holes: Vector2[][] = [];
  for (let angle = fan.holes.first; angle < 180; angle += fan.holes.step) {
    const c = polar(centre, middle, angle);
    const hole: Vector2[] = [];
    for (let k = 0; k < HOLE_SEGMENTS; k++) {
      const p = polar(c, fan.holes.radius, (360 * k) / HOLE_SEGMENTS);
      hole.push(new Vector2(p[0], p[1]));
    }
    holes.push(hole);
  }
  const triangles = ShapeUtils.triangulateShape(contour, holes);
  const points = [...contour, ...holes.flat()];
  const ids = points.map((p) => b.vertex(at(wall, [p.x, p.y], front), wall.normal, [0, 0]));
  for (const [i, j, k] of triangles) {
    if (i === undefined || j === undefined || k === undefined) continue;
    const a = ids[i];
    const c = ids[j];
    const d = ids[k];
    const pa = points[i];
    const pc = points[j];
    const pd = points[k];
    if (a === undefined || c === undefined || d === undefined || pa === undefined || pc === undefined || pd === undefined) continue;
    // On the window wall (u along +x, v up, facing +z) a triangle faces the
    // room when it turns counter-clockwise in (u, v).
    const turn = (pc.x - pa.x) * (pd.y - pa.y) - (pc.y - pa.y) * (pd.x - pa.x);
    if (turn >= 0) b.triangle(a, c, d);
    else b.triangle(a, d, c);
  }
  const uv: V2 = [0, 0];
  for (let i = 0; i < steps; i++) {
    const t0 = (180 * i) / steps;
    const t1 = (180 * (i + 1)) / steps;
    const outward: Point = [Math.cos(((t0 + t1) / 2) * DEG), Math.sin(((t0 + t1) / 2) * DEG)];
    const i0 = polar(centre, inner, t0);
    const i1 = polar(centre, inner, t1);
    const o0 = polar(centre, outer, t0);
    const o1 = polar(centre, outer, t1);
    b.quadFacing(at(wall, i0, back), at(wall, i1, back), at(wall, i1, front), at(wall, i0, front), uv, uv, uv, uv, wallDirection(wall, scale(outward, -1)));
    b.quadFacing(at(wall, o0, back), at(wall, o1, back), at(wall, o1, front), at(wall, o0, front), uv, uv, uv, uv, wallDirection(wall, outward));
  }
}

type Section = { readonly width: number; readonly depth: number };

/** The members of one window. */
function buildWindowBars(b: MeshBuilder, wall: HallWall, glazing: HallGlazing): void {
  const back = glazing.glassDepth;
  const { bar, rail, frame, fanlight: fan } = HALL_GLAZING_SECTION;
  const left = glazing.centre - HALL_LIGHT_HALF_WIDTH;
  const right = glazing.centre + HALL_LIGHT_HALF_WIDTH;
  const { sill, top } = glazing;
  // The stiles and the bottom rail frame the light; they stand a centimetre
  // inside its edge, over the atlas's glass where it meets the frame.
  const inset = 0.01;
  const stileLeft = left + frame.width / 2 - inset;
  const stileRight = right - frame.width / 2 + inset;
  straightMember(b, wall, [stileLeft, sill], [stileLeft, top], frame.width, back, back + frame.depth);
  straightMember(b, wall, [stileRight, sill], [stileRight, top], frame.width, back, back + frame.depth);
  const insideLeft = stileLeft + frame.width / 2;
  const insideRight = stileRight - frame.width / 2;
  const bottom = sill + frame.width / 2;
  straightMember(b, wall, [insideLeft, bottom], [insideRight, bottom], frame.width, back, back + frame.depth);
  // Horizontal members run whole between the stiles, over the crossings; the
  // vertical bars stop at each of them, so no two faces share a plane.
  const verticals = [...glazing.verticals].sort((p, q) => p - q);
  const horizontals: (readonly [number, Section])[] = [...glazing.bars.map((v): readonly [number, Section] => [v, bar]), [glazing.rail, rail]];
  horizontals.sort((p, q) => p[0] - q[0]);
  for (const [v, section] of horizontals) straightMember(b, wall, [insideLeft, v], [insideRight, v], section.width, back, back + section.depth);
  // A sash window's head rail; an arched window's transom over its side
  // panes, from the stiles to the centre light's bars.
  const head = glazing.fanlight === null ? top - frame.width / 2 : top;
  const headSection: Section = glazing.fanlight === null ? frame : rail;
  const leftBar = verticals[0] ?? glazing.centre;
  const rightBar = verticals[verticals.length - 1] ?? glazing.centre;
  const headSpans: readonly Point[] = glazing.fanlight === null
    ? [[insideLeft, insideRight]]
    : [[insideLeft, leftBar - bar.width / 2], [rightBar + bar.width / 2, insideRight]];
  for (const [u0, u1] of headSpans) straightMember(b, wall, [u0, head], [u1, head], headSection.width, back, back + headSection.depth);
  // The vertical bars run from the bottom rail up, broken at each horizontal
  // member; on an arched window the round head carries on from them.
  const stops: number[] = [sill + frame.width];
  for (const [v, section] of horizontals) stops.push(v - section.width / 2, v + section.width / 2);
  stops.push(glazing.fanlight === null ? head - headSection.width / 2 : top);
  for (const u of verticals) {
    for (let i = 0; i + 1 < stops.length; i += 2) {
      const v0 = stops[i];
      const v1 = stops[i + 1];
      if (v0 === undefined || v1 === undefined || v1 - v0 < 1e-3) continue;
      straightMember(b, wall, [u, v0], [u, v1], bar.width, back, back + bar.depth);
    }
  }
  const f = glazing.fanlight;
  if (f === null) return;
  const centre: Point = [glazing.centre, top];
  // The centre light's round head, springing from its two bars.
  arcMember(b, wall, centre, f.roundHead, 0, 180, rail.width, back, back + rail.depth);
  // The fanlight: lower radials, the pierced ring, upper radials, the centre petal.
  for (const angle of f.lowerRadials) {
    straightMember(b, wall, polar(centre, f.roundHead + rail.width / 2, angle), polar(centre, f.ringInner - fan.width / 2, angle), fan.width, back, back + fan.depth);
  }
  pierceRing(b, wall, centre, f, back, back + fan.depth);
  for (const angle of f.upperRadials) {
    // Each upper radial ends where the petal springs, f.upperEnd above the transom.
    const end = polar(centre, f.upperEnd / Math.sin(angle * DEG), angle);
    straightMember(b, wall, polar(centre, f.ringOuter + fan.width / 2, angle), end, fan.width, back, back + fan.depth);
  }
  arcMember(b, wall, [glazing.centre, top + f.petal.at], f.petal.radius, 0, 180, fan.width, back, back + fan.depth);
}

/** Every window's glazing bars, as the window wall's painted detail. */
export function buildGlazingBars(hb: HallBuilders): void {
  const wall = hallWall("window");
  hb.onWall(WINDOW_WALL_INDEX, () => {
    hb.withRole("detail", () => {
      for (const glazing of HALL_GLAZING) buildWindowBars(hb.get("paint"), wall, glazing);
    });
  });
}

/** A sash window's masonry opening beyond its glass: half its width (hall-spec.ts HALL_SASH_OPENING_HALF_WIDTH). */
export const SASH_OPENING_HALF_WIDTH = HALL_SASH_OPENING_HALF_WIDTH;

/**
 * A window's outline beyond its glass on the wall, counter-clockwise seen
 * from the room, where its outer reveal runs. A sash window's masonry opening
 * hugs its sashes; an arched window's is the whole round-headed opening, its
 * sashes flanked by side lights behind the columns and curtains (the 8K
 * panoramas show them), so through its glass the street opens to the full
 * arch rather than to a jamb at the sash's edge.
 */
export function glazingOutline(glazing: HallGlazing): Point[] {
  const opening = HALL_OPENINGS.find((candidate) => candidate.id === glazing.opening);
  if (glazing.fanlight === null || opening === undefined) {
    const left = glazing.centre - SASH_OPENING_HALF_WIDTH;
    const right = glazing.centre + SASH_OPENING_HALF_WIDTH;
    return [[left, glazing.sill], [right, glazing.sill], [right, glazing.top], [left, glazing.top]];
  }
  const half = opening.width / 2;
  const outline: Point[] = [[opening.centre - half, glazing.sill], [opening.centre + half, glazing.sill]];
  const springing: Point = [opening.centre, opening.head];
  for (let i = 0; i <= PANE_SEGMENTS; i++) outline.push(polar(springing, half, (180 * i) / PANE_SEGMENTS));
  return outline;
}

/**
 * Where a window's reveal ends: its own outer face, or the wall's skin where
 * that is nearer the room (the arches' bays stand 2.6 cm proud of it, which
 * the section's single outer plane cannot show yet).
 */
export function revealOuterDepth(glazing: HallGlazing): number {
  return Math.max(glazing.outerDepth, -HALL_WALL_THICKNESS.window.thickness);
}

/**
 * An opening's outer reveal: every edge of `outline` (wall-local, counter-
 * clockwise seen from the room) extruded from `fromDepth` (the glass) out to
 * `toDepth` (the outer face), facing into the opening. The first
 * SASH_BOX_DEPTH beyond the glass is the painted sash box, the rest stone;
 * the faces' uv marks them as outside the glass (u 1) and as stone (v 1),
 * which the "paint" material reads.
 */
export function buildOuterReveal(b: MeshBuilder, wall: HallWall, outline: readonly Point[], fromDepth: number, toDepth: number): void {
  const box = Math.max(toDepth, fromDepth - SASH_BOX_DEPTH);
  const layers: readonly (readonly [number, number, number])[] = box > toDepth + 1e-4
    ? [[fromDepth, box, 0], [box, toDepth, 1]]
    : [[fromDepth, toDepth, 0]];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    if (p === undefined || q === undefined) continue;
    const along: Point = [q[0] - p[0], q[1] - p[1]];
    const length = Math.hypot(along[0], along[1]);
    if (length < 1e-5) continue;
    // Counter-clockwise: the opening lies to the left of each edge.
    const inward: Point = [-along[1] / length, along[0] / length];
    for (const [near, far, stone] of layers) {
      const uv: V2 = [1, stone];
      b.quadFacing(at(wall, p, near), at(wall, q, near), at(wall, q, far), at(wall, p, far), uv, uv, uv, uv, wallDirection(wall, inward));
    }
  }
}

/** Every window's outer reveal, as the window wall's painted detail. */
export function buildGlazingReveals(hb: HallBuilders): void {
  const wall = hallWall("window");
  hb.onWall(WINDOW_WALL_INDEX, () => {
    hb.withRole("detail", () => {
      for (const glazing of HALL_GLAZING) buildOuterReveal(hb.get("paint"), wall, glazingOutline(glazing), glazing.glassDepth, revealOuterDepth(glazing));
    });
  });
}

/**
 * The panes: one sheet of glass per window over its whole light (and
 * fanlight), at the relief's glass plane, facing the room. Each vertex
 * carries its texel in the wall atlas (`aAtlas`), whose alpha marks where the
 * photograph shows glass: the pane shows only there, never over the sash
 * frame or the curtains the photograph keeps.
 */
export function buildGlazingPanes(): BufferGeometry {
  const wall = hallWall("window");
  const positions: number[] = [];
  const normals: number[] = [];
  const atlas: number[] = [];
  const indices: number[] = [];
  const vertex = (p: Point, depth: number): number => {
    const world = at(wall, p, depth);
    positions.push(world[0], world[1], world[2]);
    normals.push(wall.normal[0], wall.normal[1], wall.normal[2]);
    const [au, av] = wallAtlasUv("window", p[0], p[1]);
    atlas.push(au, av);
    return positions.length / 3 - 1;
  };
  // Counter-clockwise in (u, v) faces the room on the window wall.
  for (const glazing of HALL_GLAZING) {
    const depth = glazing.glassDepth;
    const left = glazing.centre - HALL_LIGHT_HALF_WIDTH;
    const right = glazing.centre + HALL_LIGHT_HALF_WIDTH;
    const a = vertex([left, glazing.sill], depth);
    const b = vertex([right, glazing.sill], depth);
    const c = vertex([right, glazing.top], depth);
    const d = vertex([left, glazing.top], depth);
    indices.push(a, b, c, a, c, d);
    if (glazing.fanlight === null) continue;
    const centre: Point = [glazing.centre, glazing.top];
    const hub = vertex(centre, depth);
    let previous = vertex(polar(centre, glazing.fanlight.radius, 0), depth);
    for (let i = 1; i <= PANE_SEGMENTS; i++) {
      const next = vertex(polar(centre, glazing.fanlight.radius, (180 * i) / PANE_SEGMENTS), depth);
      indices.push(hub, previous, next);
      previous = next;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("aAtlas", new BufferAttribute(new Float32Array(atlas), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "grand-hall-glazing-panes";
  return geometry;
}

/**
 * Runs `capture` (the room's reflections being captured on a private stage,
 * without the city or the sky) with the glass closed: the photographed glass
 * back in the walls and the panes hidden, else the reflections would show the
 * void through every window and the panes would reflect themselves. Both are
 * restored afterwards, also when the capture throws.
 */
export function withGlazingClosed<T>(glazing: { readonly open: { value: number } }, panes: { visible: boolean } | null, capture: () => T): T {
  const open = glazing.open.value;
  const shown = panes?.visible ?? false;
  glazing.open.value = 0;
  if (panes !== null) panes.visible = false;
  try {
    return capture();
  } finally {
    glazing.open.value = open;
    if (panes !== null) panes.visible = shown;
  }
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

export type GlassPresetName = "physical" | "clear" | "lustre";

export interface GlassPreset {
  /** Each face's reflectance at normal incidence. */
  readonly f0: number;
  /** Scales the reflection (1: as the physics gives it). */
  readonly reflectance: number;
  /** The reflection's blur (PMREM roughness). */
  readonly roughness: number;
}

/**
 * How the glass reflects. `physical` is single glazing: two faces of glass
 * (index 1.5, 4% each), 7.7% at normal incidence, rising with Schlick's
 * Fresnel toward grazing; `clear` halves it to show more of the street,
 * `lustre` mirrors the lit room more strongly at night.
 */
export const GLASS_PRESETS: Readonly<Record<GlassPresetName, GlassPreset>> = {
  physical: { f0: 0.04, reflectance: 1, roughness: 0.03 },
  clear: { f0: 0.04, reflectance: 0.5, roughness: 0.03 },
  lustre: { f0: 0.04, reflectance: 1.6, roughness: 0.02 },
};

function isGlassPreset(value: string): value is GlassPresetName {
  return value === "physical" || value === "clear" || value === "lustre";
}

/** The preset `?glass=` names, or `physical`. Nothing is remembered. */
export function parseGlassPreset(search: string | null | undefined): GlassPresetName {
  const value = new URLSearchParams(search ?? "").get("glass");
  return value !== null && isGlassPreset(value) ? value : "physical";
}

/** One face's Fresnel reflectance (Schlick) at `cosine` of the angle from its normal. */
export function schlick(f0: number, cosine: number): number {
  const c = Math.max(0, Math.min(1, cosine));
  return f0 + (1 - f0) * (1 - c) ** 5;
}

/** A sheet's reflectance from one face's `single` (light bouncing between its two faces, none absorbed). */
export function sheetReflectance(single: number): number {
  return (2 * single) / (1 + single);
}

/** The room's box, onto which the panes' reflections are projected. */
const ROOM_MIN = vec3(-HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH);
const ROOM_MAX = vec3(HALL_HALF_LENGTH, HALL_HEIGHT, HALL_HALF_WIDTH);
/** The glass's own transmission, apart from its reflection (single glazing assumed; its type is not sourced). */
export const GLASS_TRANSMISSION = 0.97;
/** A faint green in what the glass reflects, as old glass gives. */
const REFLECTION_TINT = vec3(0.96, 0.985, 0.975);

export interface GlassMaterialOptions {
  /** The room's captured environment (it stays the same object across captures). */
  readonly environment: Texture;
  /** Where the environment was captured. */
  readonly capturePoint: Vector3;
  readonly photos: HallPhotos;
  readonly section: HallSectionUniforms;
  readonly preset: GlassPreset;
}

export interface GlassMaterial {
  readonly material: MeshBasicNodeMaterial;
  /**
   * The reflection's strength over the room's own light as captured: 1, the
   * physics of the glass alone (the moods' `reflections` dims the varnish and
   * gilt as art direction, never the glass).
   */
  readonly intensity: { value: number };
}

/**
 * The panes' glass: the room's reflection over whatever lies behind, with
 * premultiplied alpha, so the street keeps (1 - R) of itself (less the glass's
 * own absorption) and the room adds R of its own light.
 */
export function createGlassMaterial(options: GlassMaterialOptions): GlassMaterial {
  const { preset } = options;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: FrontSide, fog: false, premultipliedAlpha: true });
  const intensity = uniform(1);
  const normal = vec3(0, 0, 1);
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const cosine = max(dot(normal, toEye), 0);
  const single = float(preset.f0).add(float(1 - preset.f0).mul(pow(float(1).sub(cosine), 5)));
  const reflectance = single.mul(2).div(single.add(1)).mul(preset.reflectance).min(1);
  // The reflected ray, carried to where it leaves the room's box, then seen
  // from the capture point: the reflection lands on the room's own surfaces.
  const ray = reflect(toEye.negate(), normal);
  // Never divide by zero: each component kept at least 1e-4 from it, signed.
  const safe = vec3(
    ray.x.abs().max(1e-4).mul(ray.x.sign().add(0.5).sign()),
    ray.y.abs().max(1e-4).mul(ray.y.sign().add(0.5).sign()),
    ray.z.abs().max(1e-4).mul(ray.z.sign().add(0.5).sign()),
  );
  const far = max(ROOM_MAX.sub(positionWorld).div(safe), ROOM_MIN.sub(positionWorld).div(safe));
  const distance = min(min(far.x, far.y), far.z).max(0);
  const hit = positionWorld.add(ray.mul(distance));
  const direction = normalize(hit.sub(vec3(options.capturePoint.x, options.capturePoint.y, options.capturePoint.z)));
  const room = pmremTexture(options.environment, direction, float(preset.roughness)).rgb.mul(intensity).mul(REFLECTION_TINT);
  // Only where the photograph shows glass (the atlas's alpha, 128/255 there).
  const glass = float(1).sub(smoothstep(0.62, 0.8, options.photos.sample("walls", attribute("aAtlas", "vec2")).a));
  // The material premultiplies its colour by its alpha (premultipliedAlpha),
  // so the colour given is the reflection over the sheet's opacity.
  const opacity = reflectance.add(float(1).sub(reflectance).mul(1 - GLASS_TRANSMISSION));
  material.colorNode = vec4(room.mul(reflectance).div(opacity.max(1e-4)), opacity.mul(glass));
  // Cut with the window wall.
  material.maskNode = positionWorld.y.lessThan(options.section.cuts[WINDOW_WALL_INDEX]);
  // The normal and velocity targets keep what lies behind (alpha 0 under the
  // pipeline's blend for them), so occlusion and the temporal resolve see the
  // street through the glass, not the glass.
  material.mrtNode = mrt({ output, normal: vec4(0, 0, 0, 0), velocity: vec4(0, 0, 0, 0) });
  material.name = "grand-hall-glass";
  return { material, intensity };
}
