// ---------------------------------------------------------------------------
// The cutaway's section: the walls as a model maker would cut them
//
// When the planner looks in from above, the walls nearest the camera are cut
// down (GrandHallModel's cutaway). Each wall has a body as thick as the wall
// really is, with every window and door open through it (hall-wall-body.ts),
// all four in one mesh that the shader lowers to each wall's cut: no object
// moves from frame to frame. In front of the wall's plane the section goes on
// through the scanned relief, its room edge following every moulding the cut
// meets (the cap, hall-relief-section.ts). The whole section draws in three
// calls (the bodies, the relief's cap and the plinth ring; the doorways' oak
// thresholds draw with the floor's material in a fourth).
//
// The section's finish is a preset (SECTION_PRESETS, `?section=`): Ashlar,
// the building's own materials, by default; Atelier, the city's card model;
// Nocturne, a dark jewel box under a moulded top (hall-coping.ts). Each also
// decides the doors' leaves and what lies beyond the doors (hall-beyond.ts).
// Its faces are unlit: the room's light is baked into their colour from the
// same channels as every other surface of the hall, strongest at the room's
// side, with the sun or moon on its tops under the real sky, so a phone pays
// a little arithmetic, not the five chandeliers' lights. None reads the sun's
// shadow map or normalWorld: both put the pass's normal target out of step
// in these unlit materials, and the ambient occlusion went dark on the cut's
// tops (bodyNormal). The room's faces under the cut carry a gilt band and a
// soft shadow (hall-cut-lines.ts, hall-materials.ts).
//
// The plinth is a ring round the floor, never a slab under it. A slab a
// millimetre under the oak lost the depth test to it at scattered pixels
// (depth24 with near 0.1 and far 900 leaves only a few depth steps per
// millimetre at 20-30 m), which showed as black specks across the floor
// whenever the camera moved. Its top, at the floor's own level, covers only
// what lies outside the floor, out to the walls' outer faces, so it is the
// slab under the bodies and the floor of the firebox; its inner edge repeats
// the floor's own edge vertices, so the two meet without a crack, and a strip
// two centimetres down reaches under the floor's edge in case one opens.
// ---------------------------------------------------------------------------

import { Color, SRGBColorSpace, ShapeUtils, Vector2, type BufferGeometry, type Material, type Texture } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { attribute, bool, exp, float, fwidth, max, min, mix, positionLocal, positionWorld, smoothstep, sqrt, texture, vec2, vec3 } from "three/tsl";
import { MeshBuilder, type V3 } from "./mesh-builder.js";
import { HALL_ELEVATION, HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_OPENINGS, HALL_WALLS, HALL_WALL_THICKNESS, isWindow, type HallWall } from "./hall-spec.js";
import { BODY_FINISH, BODY_ROLE, DOOR_SLOTS, LINTEL_RELEASE, WALL_BODY_TOP, bodyOutline, buildWallBody } from "./hall-wall-body.js";
import { bakedIrradiance, scanIrradiance, type HallSectionUniforms } from "./hall-materials.js";
import type { HallMoodUniforms } from "./hall-mood.js";
import { hallSkyUniforms } from "./hall-sky-runtime.js";
import { GILT_BAND, GILT_COLOUR, GILT_MIN_PIXELS, lineCoverage } from "./hall-cut-lines.js";
import { BEYOND_ATLAS, cardLit, mahoganyGrain, relitBeyond, type HallBeyondPhotos } from "./hall-beyond.js";
import { buildCoping, createCopingMaterial } from "./hall-coping.js";
import type { HallSun } from "./hall-sun.js";
import type { HallTextures } from "./hall-textures.js";
import { HallSectionProfile, NO_SECTION, SECTION_BIN, SECTION_PROFILE_SPANS, SECTION_PROFILE_WIDTH } from "./hall-relief-section.js";

/** A wall's main thickness: how far its outer face lies behind its scanned face, metres. */
export function wallThickness(wall: HallWall): number {
  return HALL_WALL_THICKNESS[wall.id].thickness;
}

/**
 * The city model's cut-out for the hall (tools/grand-hall-survey/context/
 * build_context.py, rect_half_x and rect_half_z): nothing is emitted inside
 * it, and its caps at the floor's level start at its edge. The walls stand
 * further out than it almost everywhere (the window wall's street face at
 * z -6.245, the city's facade line at -5.915), so the ring's top reaches
 * past the cut-out only under the walls' bodies, where nothing sees it; where
 * a wall is thinner (the lobby beside the fireplace door) the ring still
 * reaches a centimetre short of the cut-out, so no hole opens beside it.
 */
export const CITY_CUTOUT = { x: 11.2, z: 5.95 } as const;
const CUTOUT_MARGIN = 0.01;

/** How far the plinth's outer faces reach below the floor, metres. */
export const PLINTH_DEPTH = 0.42;
/**
 * The strip under the floor's edge: how far it reaches in from the edge (and
 * out under the ring's top) and how far below the floor it lies. Two
 * centimetres is many depth steps at any distance the planner allows, where
 * the old slab's millimetre was a few.
 */
export const PLINTH_UNDERLAP = { reach: 0.05, drop: 0.02 } as const;
/**
 * The floor's grid cell (hall-geometry.ts, buildFloor), whose edge vertices
 * the ring repeats. The section's tests hold the two together.
 */
const FLOOR_CELL = 0.25;

const UP: V3 = [0, 1, 0];

/**
 * The ring's outline in plan (x, z), counter-clockwise seen from above: the
 * walls' outer faces and corner blocks, pushed out to a centimetre inside the
 * city's cut-out wherever a wall is thinner than that.
 */
export function plinthOutline(): [number, number][] {
  const limitX = CITY_CUTOUT.x - CUTOUT_MARGIN;
  const limitZ = CITY_CUTOUT.z - CUTOUT_MARGIN;
  return bodyOutline().map(([x, z]): [number, number] => {
    // Points on the long sides lie beyond |z| = the room's half width; on the
    // short sides beyond |x| = its half length.
    const onLongSide = Math.abs(z) > HALL_HALF_WIDTH + 1e-6 && Math.abs(x) <= HALL_HALF_LENGTH + 1e-6;
    const onShortSide = Math.abs(x) > HALL_HALF_LENGTH + 1e-6 && Math.abs(z) <= HALL_HALF_WIDTH + 1e-6;
    if (onLongSide && Math.abs(z) < limitZ) return [x, Math.sign(z) * limitZ];
    if (onShortSide && Math.abs(x) < limitX) return [Math.sign(x) * limitX, z];
    return [x, z];
  });
}

/** The ring's reach on each side: its outline's extremes. */
export function plinthExtents(): { readonly xMin: number; readonly xMax: number; readonly zMin: number; readonly zMax: number } {
  const outline = plinthOutline();
  const xs = outline.map((p) => p[0]);
  const zs = outline.map((p) => p[1]);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), zMin: Math.min(...zs), zMax: Math.max(...zs) };
}

/**
 * A point of the floor's grid, computed as the floor's own builder computes
 * it (MeshBuilder.quad over the corners quadFacing hands it, `s` across the
 * hall and `t` along it), so the ring's inner edge lands on the floor's edge
 * vertices exactly and no T-junction crack can open between them.
 */
function floorGridPoint(s: number, t: number): V3 {
  const p0: V3 = [-HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH];
  const p1: V3 = [-HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH];
  const p2: V3 = [HALL_HALF_LENGTH, 0, HALL_HALF_WIDTH];
  const p3: V3 = [HALL_HALF_LENGTH, 0, -HALL_HALF_WIDTH];
  const at = (k: 0 | 1 | 2): number => (1 - t) * ((1 - s) * p0[k] + s * p1[k]) + t * ((1 - s) * p3[k] + s * p2[k]);
  return [at(0), at(1), at(2)];
}

/** The floor's edge vertices round its rim, in order (counter-clockwise seen from above). */
function floorRim(): V3[] {
  const along = Math.max(1, Math.ceil(HALL_HALF_LENGTH * 2 / FLOOR_CELL));
  const across = Math.max(1, Math.ceil(HALL_HALF_WIDTH * 2 / FLOOR_CELL));
  const rim: V3[] = [];
  // Window side (s = 0) along t, end side (t = 1) along s, door side back, fireplace side back.
  for (let i = 0; i < along; i++) rim.push(floorGridPoint(0, i / along));
  for (let i = 0; i < across; i++) rim.push(floorGridPoint(i / across, 1));
  for (let i = along; i > 0; i--) rim.push(floorGridPoint(1, i / along));
  for (let i = across; i > 0; i--) rim.push(floorGridPoint(i / across, 0));
  return rim;
}

/** Quads between two polylines of matching stations, each wound to face along `facing`. */
function stripBetween(builder: MeshBuilder, a: readonly V3[], b: readonly V3[], facing: V3): void {
  const uv = (p: V3): readonly [number, number] => (facing[1] !== 0 ? [p[0], p[2]] : [p[0] + p[2], p[1]]);
  for (let i = 0; i + 1 < a.length; i++) {
    const p0 = a[i];
    const p1 = a[i + 1];
    const p2 = b[i + 1];
    const p3 = b[i];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
    builder.quadFacing(p0, p1, p2, p3, uv(p0), uv(p1), uv(p2), uv(p3), facing);
  }
}

/**
 * The plinth: a ring round the floor whose top lies at the floor's level only
 * outside it, out to the walls' outer faces (plinthOutline), with outer faces
 * down to PLINTH_DEPTH and no bottom. Under the floor it has only the
 * underlap, two centimetres down.
 */
export function buildPlinthRing(): BufferGeometry {
  const builder = new MeshBuilder();
  const outline = plinthOutline();
  // The top: the outline with the floor as a hole, triangulated; the hole is
  // the floor's own rim, vertex for vertex.
  const rim = floorRim();
  const contour = outline.map(([x, z]) => new Vector2(x, -z));
  const hole = rim.map((p) => new Vector2(p[0], -p[2]));
  // ShapeUtils wants the contour counter-clockwise and the hole clockwise in
  // its own plane; (x, -z) is the plan seen from above.
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  if (!ShapeUtils.isClockWise(hole)) hole.reverse();
  const triangles = ShapeUtils.triangulateShape(contour, [hole]);
  const points = [...contour, ...hole];
  const ids = points.map((p) => builder.vertex([p.x, 0, -p.y], UP, [p.x, -p.y]));
  for (const [i, j, k] of triangles) {
    const a = ids[i ?? -1];
    const b = ids[j ?? -1];
    const c = ids[k ?? -1];
    const pa = points[i ?? -1];
    const pb = points[j ?? -1];
    const pc = points[k ?? -1];
    if (a === undefined || b === undefined || c === undefined || pa === undefined || pb === undefined || pc === undefined) continue;
    // Counter-clockwise in (x, -z) faces up.
    const turn = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (Math.abs(turn) < 1e-12) continue;
    if (turn > 0) builder.triangle(a, b, c);
    else builder.triangle(a, c, b);
  }
  // The outer faces, from the top's own outer edge down.
  const ring: V3[] = outline.map(([x, z]): V3 => [x, 0, z]);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p === undefined || q === undefined) continue;
    const along: V3 = [q[0] - p[0], 0, q[2] - p[2]];
    const run = Math.hypot(along[0], along[2]);
    if (run < 1e-7) continue;
    // Counter-clockwise from above (in x and -z), the outside lies to the
    // right of each edge: (-dz, dx) in x and z.
    const outward: V3 = [-along[2] / run, 0, along[0] / run];
    stripBetween(builder, [p, q], [[p[0], -PLINTH_DEPTH, p[2]], [q[0], -PLINTH_DEPTH, q[2]]], outward);
  }
  // The underlap: a frame two centimetres down, from inside the floor's edge
  // to under the ring's top, so a ray through a crack at the edge, from
  // either side, meets the slab rather than the void.
  const { reach, drop } = PLINTH_UNDERLAP;
  const inX = HALL_HALF_LENGTH - reach;
  const inZ = HALL_HALF_WIDTH - reach;
  const outX = HALL_HALF_LENGTH + reach;
  const outZ = HALL_HALF_WIDTH + reach;
  const y = -drop;
  for (const sign of [-1, 1]) {
    stripBetween(builder, [[-outX, y, sign * inZ], [outX, y, sign * inZ]], [[-outX, y, sign * outZ], [outX, y, sign * outZ]], UP);
    stripBetween(builder, [[sign * inX, y, -inZ], [sign * inX, y, inZ]], [[sign * outX, y, -inZ], [sign * outX, y, inZ]], UP);
  }
  const geometry = builder.build();
  geometry.name = "grand-hall-plinth-ring";
  return geometry;
}

// ---------------------------------------------------------------------------
// The section's finish
// ---------------------------------------------------------------------------

export type SectionPresetName = "ashlar" | "atelier" | "nocturne";

/**
 * A section's palette, as sRGB the way a designer states it (converted to
 * linear light where the shader uses it).
 */
export interface SectionPreset {
  /** The walls' outer faces. */
  readonly outer: string;
  /** The cut's core. */
  readonly core: string;
  /** The line at the cut's room edge through plaster. */
  readonly plaster: string;
  /** The line at the cut's room edge through the dado's panelling. */
  readonly dado: string;
  /** The line at the cut's room edge through the attic panelling. */
  readonly attic: string;
  /** The cut's outer arris. */
  readonly arris: string;
  /** The gilt line on the cut's room edge (the gilt band on the room's face is the coffers' gilt in every preset). */
  readonly gilt: string;
  /** The doorways' linings. */
  readonly doorLining: string;
  /** The windows' outer reveals where the body carries them on. */
  readonly windowLining: string;
  /** How much of the room's glow reaches the outer faces (a presentation fill). */
  readonly outerGlow: number;
  /** How the section's faces are lit: as the room is ("room"), or as the city's white card under the real sky ("card"). */
  readonly light: "room" | "card";
  /**
   * The outer faces that look into the hall's neighbours (all but the street
   * front) wear those spaces' own finishes as photographed beyond the doors.
   */
  readonly interiorFaces: boolean;
  /** The end and main doors' linings wear their photographs (project-beyond.py). */
  readonly liningPhotos: boolean;
  /** A moulded top on the cut (hall-coping.ts): a presentation device, not part of the building. */
  readonly coping: boolean;
  /** The doors' leaves: as photographed ("room"), or in card with their panels scored ("card"). */
  readonly leaves: "room" | "card";
  /** What shows past the open doors (hall-beyond.ts). */
  readonly beyond: "photographs" | "first-floor" | "pools";
}

/**
 * Ashlar (the default): the building's own materials. The street front is
 * polished ashlar, the pale sandstone of Glassford Street, with no joints (no
 * photograph of the facade gives its coursing; the colour is art direction
 * until one does). The other outer faces look into the building and wear its
 * finishes as photographed beyond the doors (INTERIOR_FACES). The cut is a
 * warm stone core with a lime-plaster line at the room edge, or the panelling
 * where the cut passes through it (the dado's mahogany #5c3132; the attic's
 * oak, the atlas's median #734c1c); the end and main doorways are lined with
 * their photographs, the others in mahogany as the panoramas show them.
 * Beyond the doors: the floors as photographed (hall-beyond.ts).
 *
 * Atelier: an architect's card model like the city, in the city's own card
 * (hall-context.ts CARD: walls 0.86/0.82/0.76, the cut 0.78/0.72/0.64 sRGB),
 * lit as the city is, the doors' leaves in card with their panels scored, the
 * whole first floor beyond in card (the 2010 plan), a gilt line on the cut's
 * room edge.
 *
 * Nocturne: a dark jewel box, ebonised (linear 0.012/0.009/0.007), its cut
 * under a moulded top of dark polished stone with gilt lines (a presentation
 * device), warm pools of light past the doors.
 */
export const SECTION_PRESETS: Readonly<Record<SectionPresetName, SectionPreset>> = {
  ashlar: {
    outer: "#c9bca3", core: "#c4b496", plaster: "#ece4d6", dado: "#5c3132", attic: "#734c1c",
    arris: "#fff3dc", gilt: GILT_COLOUR, doorLining: "#5c3132", windowLining: "#b4a58c", outerGlow: 0.04,
    light: "room", interiorFaces: true, liningPhotos: true, coping: false, leaves: "room", beyond: "photographs",
  },
  atelier: {
    outer: "#dbd1c2", core: "#c7b8a3", plaster: "#c7b8a3", dado: "#c7b8a3", attic: "#c7b8a3",
    arris: "#a58350", gilt: GILT_COLOUR, doorLining: "#dbd1c2", windowLining: "#dbd1c2", outerGlow: 0.05,
    light: "card", interiorFaces: false, liningPhotos: false, coping: false, leaves: "card", beyond: "first-floor",
  },
  nocturne: {
    outer: "#1d1814", core: "#1d1814", plaster: "#a58350", dado: "#a58350", attic: "#a58350",
    arris: "#a58350", gilt: GILT_COLOUR, doorLining: "#1d1814", windowLining: "#1d1814", outerGlow: 0.02,
    light: "room", interiorFaces: false, liningPhotos: false, coping: true, leaves: "room", beyond: "pools",
  },
};

/**
 * The outer faces Ashlar dresses as the spaces they look into, as photographed
 * (sRGB, the colour the panoramas give under the scan's light, relit like
 * every photograph): the F.16 corridor's face of the door wall, an aubergine
 * dado to 1.2 m under a gilt band and a pale wall above (scan_075, 076 and
 * 018, x -2.4 to -1.3 and 1.3 to 2.4); the Saloon's face, its Spanish mahogany
 * panelling (scan_049 and 050, x 10 to 11). Nothing beyond the end and
 * fireplace walls was surveyed: they take the corridor's wall, as art
 * direction. The dado's height is the Saloon's, measured on the scan
 * (beyond-doors.json); the corridor's agrees within the scan's noise. The
 * dado is its panel fields' colour, the 25th percentile of brightness (below
 * the varnish's highlights, which read pink once relit); the wall its median.
 */
export const INTERIOR_FACES = {
  corridorDado: [109, 64, 67],
  corridorWall: [111, 105, 98],
  saloonPanelling: [41, 19, 6],
  dadoTop: 1.2,
  /** The gilt band over the corridor's dado. */
  band: 0.06,
  /** The Saloon begins at its west face, planner x. */
  saloonFrom: 7.45,
} as const;

function isSectionPreset(value: string): value is SectionPresetName {
  return value === "ashlar" || value === "atelier" || value === "nocturne";
}

/** The preset `?section=` names, or `ashlar`. Nothing is remembered. */
export function parseSectionPreset(search: string | null | undefined): SectionPresetName {
  const value = new URLSearchParams(search ?? "").get("section");
  return value !== null && isSectionPreset(value) ? value : "ashlar";
}

/** The width of the cut's room-edge line, and of its outer arris, metres. */
export const SECTION_LINE = 0.015;
export const SECTION_ARRIS = 0.006;
/**
 * The cut's light: the room's ambient, its chandeliers' and the sky it sees
 * once the ceiling is lifted, with the sun or moon under the real sky. The
 * chandeliers light the cut most at the room's side, falling off into the
 * wall from its plane over CAP_FALLOFF (exp(-d / 0.4 m)), from CAP_GLOW_FAR +
 * CAP_GLOW_EDGE at the plane (and over the relief in front of it) toward
 * CAP_GLOW_FAR, so the far walls' tops, whose room edges face away from the
 * chandeliers' real positions, never fall dark (lit by their real positions
 * they did, S3a). Measured from the plane, not from the relief's surface: a
 * falloff from the surface stepped wherever a pilaster or a board stood out.
 * The outer faces see the sky and a little of the room's glow.
 */
export const CAP_GLOW_EDGE = 0.33;
export const CAP_GLOW_FAR = 0.1;
export const CAP_FALLOFF = 0.4;
/**
 * The gilt line on the cut's room edge, the top of the gilt band on the
 * room's face (hall-cut-lines.ts): 8 mm of the coffers' gilt (GILT_BAND),
 * never under 1.5 px (GILT_MIN_PIXELS), twice as bright as the gilt's
 * average colour in the same light, as a gilded arris catches it: at the
 * average alone the line read as the oak floor beyond it.
 */
const GILT_SHEEN = 2;
const CAP_SKY = 0.35;
const OUTER_SKY = 0.5;
/** Upright faces of the cut (the walls' ends, steps in their outer faces) take this share of the cut's light. */
const UPRIGHT_SHARE = 0.7;
/** A window reveal's share of the sky, as hall-materials.ts gives the reveals. */
const REVEAL_SKY_VIEW = 0.5;

/** capGlowShare, in the shader. */
function capGlowNode(fromPlane: Node<"float">): Node<"float"> {
  return exp(max(fromPlane, float(0)).div(-CAP_FALLOFF)).mul(CAP_GLOW_EDGE).add(CAP_GLOW_FAR);
}

/** The chandeliers' share of the cut's light `fromPlane` metres behind the wall's plane (the shader's rule, for tests). */
export function capGlowShare(fromPlane: number): number {
  return CAP_GLOW_FAR + CAP_GLOW_EDGE * Math.exp(-Math.max(0, fromPlane) / CAP_FALLOFF);
}

const linear = (hex: string) => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

/**
 * The cut's light on an up-facing top `fromPlane` metres behind the wall's
 * plane: the room's ambient, the chandeliers falling off from it, the sky
 * over the lifted ceiling, and, under the real sky, the sun or moon on a level
 * face (its irradiance times the sine of its height, with no shadow, as on a
 * model standing in the light). Unlit arithmetic.
 */
function cutTopLight(mood: HallMoodUniforms, sunlit: boolean, fromPlane: Node<"float">): Node<"vec3"> {
  const sky = mood.skyHorizon.rgb.mul(mood.skyIntensity);
  const glow = mood.chandelier.rgb.mul(mood.chandelierIntensity);
  const share = exp(max(fromPlane, float(0)).div(-CAP_FALLOFF)).mul(CAP_GLOW_EDGE).add(CAP_GLOW_FAR);
  const light = mood.ambient.rgb.mul(mood.ambientIntensity).add(glow.mul(share)).add(sky.mul(CAP_SKY));
  if (!sunlit) return light;
  return light.add(hallSkyUniforms.lightRadiance.mul(max(hallSkyUniforms.lightDirection.y, float(0))));
}

/** Wall-local u (along the wall from its origin) of a world point, for wall index `wall` (HALL_WALLS order). */
function wallU(wall: Node<"float">, point: Node<"vec3">): Node<"float"> {
  const along = (index: number): Node<"float"> => {
    const w = HALL_WALLS[index];
    if (w === undefined) return float(0);
    return point.x.sub(w.origin[0]).mul(w.tangent[0]).add(point.z.sub(w.origin[2]).mul(w.tangent[2]));
  };
  return wall.lessThan(0.5).select(along(0), wall.lessThan(1.5).select(along(1), wall.lessThan(2.5).select(along(2), along(3))));
}

/** How far a world point lies behind wall `wall`'s plane (HALL_WALLS order), metres: positive outside the room. */
function wallBehind(wall: Node<"float">, point: Node<"vec3">): Node<"float"> {
  const behind = (index: number): Node<"float"> => {
    const w = HALL_WALLS[index];
    if (w === undefined) return float(0);
    return point.x.sub(w.origin[0]).mul(w.normal[0]).add(point.z.sub(w.origin[2]).mul(w.normal[2])).negate();
  };
  return wall.lessThan(0.5).select(behind(0), wall.lessThan(1.5).select(behind(1), wall.lessThan(2.5).select(behind(2), behind(3))));
}

/** How far the relief stands proud at wall `wall`'s cut at wall-local `u` (hall-relief-section.ts), filtered between centimetres. */
function proudAt(profile: Texture, wall: Node<"float">, u: Node<"float">): Node<"float"> {
  const offset = (index: number): Node<"float"> => float(SECTION_PROFILE_SPANS[index]?.offset ?? 0);
  const bins = (index: number): Node<"float"> => float(SECTION_PROFILE_SPANS[index]?.bins ?? 1);
  const start = wall.lessThan(0.5).select(offset(0), wall.lessThan(1.5).select(offset(1), wall.lessThan(2.5).select(offset(2), offset(3))));
  const count = wall.lessThan(0.5).select(bins(0), wall.lessThan(1.5).select(bins(1), wall.lessThan(2.5).select(bins(2), bins(3))));
  // Texel i's centre lies (i + 0.5) bins along the wall; stay within the wall's own texels.
  const texel = min(max(u.div(SECTION_BIN), float(0.5)), count.sub(0.5));
  return texture(profile, vec2(start.add(texel).div(SECTION_PROFILE_WIDTH), 0.5)).r;
}

/**
 * What turns a distance in from the relief's surface measured square to the
 * wall into one measured square to the section's edge: where the profile turns
 * (a pilaster's side, a board's end) the distance across the wall overstates
 * it, and a line drawn by it thinned and faded there, leaving gaps. The slope
 * is taken over 4 cm, so it changes smoothly.
 */
function edgeScale(profile: Texture, wall: Node<"float">, u: Node<"float">): Node<"float"> {
  const reach = 2 * SECTION_BIN;
  const slope = proudAt(profile, wall, u.add(reach)).sub(proudAt(profile, wall, u.sub(reach))).div(2 * reach);
  return float(1).div(sqrt(slope.mul(slope).add(1)));
}

/** Each wall's cut, by its index (HALL_WALLS order; -1: none). */
function cutOfWall(section: HallSectionUniforms, wall: Node<"float">): Node<"float"> {
  const [c0, c1, c2, c3] = section.cuts;
  return wall.lessThan(-0.5).select(float(1000),
    wall.lessThan(0.5).select(c0, wall.lessThan(1.5).select(c1, wall.lessThan(2.5).select(c2, c3))));
}

/**
 * The colour of the cut's room line at the cut's height: the dado's mahogany
 * where the cut passes through the panelling (at or below its top), the
 * attic's oak above the cornice, lime plaster between.
 */
function sectionLineColour(preset: SectionPreset, height: Node<"float">): Node<"vec3"> {
  const dado = height.lessThan(HALL_ELEVATION.dadoTop + 0.02);
  const attic = height.greaterThan(HALL_ELEVATION.corniceTop - 0.02);
  return dado.select(linear(preset.dado), attic.select(linear(preset.attic), linear(preset.plaster)));
}

/**
 * The cut's top, the same rule for the body's top and the relief's cap (so
 * where the two overlap, a centimetre behind the wall's plane, they draw the
 * same colour): from the room's side, the gilt line on the true room edge
 * (`edge` metres in from the relief's surface at the cut, square to the wall;
 * times `edgeScaled`, square to the section's edge), the room line
 * (the panelling's or the plaster's own material, out over the relief and
 * 15 mm into the wall: `line` metres behind the plane, or behind the relief's
 * surface where that lies behind the plane, 0 in front), the stone core with
 * its faint grain, and the outer arris (`toOuter`, the body only). Lit by
 * `lighting`, `fromPlane` metres behind the wall's plane.
 */
function cutTopColour(
  preset: SectionPreset, lighting: Lighting, height: Node<"float">,
  fromPlane: Node<"float">, line: Node<"float">, edge: Node<"float">, edgeScaled: Node<"float">, toOuter: Node<"float"> | null,
): Node<"vec3"> {
  // A faint grain in the stone, in world space so it never swims as the cut moves.
  const p = positionWorld;
  const grain = p.x.mul(41).add(p.z.mul(7).sin().mul(3)).sin().mul(p.z.mul(37).add(p.x.mul(5).sin().mul(2)).sin()).mul(0.035);
  const core = linear(preset.core).mul(grain.add(1));
  const lined = mix(core, sectionLineColour(preset, height), lineCoverage(line, SECTION_LINE));
  const finished = toOuter === null ? lined : mix(lined, linear(preset.arris), lineCoverage(toOuter, SECTION_ARRIS));
  return mix(lighting(finished, fromPlane), lighting(linear(preset.gilt), fromPlane).mul(GILT_SHEEN), lineCoverage(edge, GILT_BAND, edgeScaled, GILT_MIN_PIXELS));
}

/**
 * How a section face takes its light: an albedo in, the lit colour out,
 * `fromPlane` metres behind its wall's plane (for the room's falloff).
 */
type Lighting = (albedo: Node<"vec3">, fromPlane: Node<"float">) => Node<"vec3">;

/** The room's light (cutTopLight), or the city's card light (hall-beyond.ts cardLit) on an up-facing top. */
function topLighting(preset: SectionPreset, mood: HallMoodUniforms, sunlit: boolean, sun: HallSun | null): Lighting {
  if (preset.light === "card") {
    // The city's card light, and the room's own glow on the cut, most at the room's side, as on Ashlar's.
    const glow = mood.chandelier.rgb.mul(mood.chandelierIntensity);
    return (albedo, fromPlane) => cardLit(albedo, vec3(0, 1, 0), sunlit ? sun : null, mood, float(0), false)
      .add(albedo.mul(glow).mul(capGlowNode(fromPlane)));
  }
  return (albedo, fromPlane) => albedo.mul(cutTopLight(mood, sunlit, fromPlane));
}

/** What the body's faces may draw beyond the preset's own colours. */
export interface WallBodyExtras {
  /** The real sun and moon (the card's light under the real sky), or null. */
  readonly sun?: HallSun | null;
  /** The room's painted mahogany (the Saloon's panelling on Ashlar's interior faces). */
  readonly textures?: HallTextures | null;
  /** The beyond's photographs (the end and main doors' linings on Ashlar). */
  readonly beyond?: HallBeyondPhotos | null;
}

/**
 * A body face's normal in the world: its geometry's own (the bodies are drawn
 * where they are built, untransformed). Read from the attribute rather than
 * through normalWorld, which brought the pass's normal target, and with it the
 * ambient occlusion, out of step on the cut's tops (occlusion 0.36 there).
 */
const bodyNormal = (): Node<"vec3"> => attribute("normal", "vec3");

/** An sRGB colour stated 0-255, in linear light. */
function srgb255(rgb: readonly [number, number, number]): Node<"vec3"> {
  const c = new Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace);
  return vec3(c.r, c.g, c.b);
}

/**
 * Ashlar's outer faces (INTERIOR_FACES): the street front stays the polished
 * ashlar lit by the sky (`street`); every other face is the space it looks
 * into, as photographed and relit for the mood like the spaces beyond the
 * doors: on the door wall's corridor side an aubergine dado under a gilt band
 * and a pale wall above, on its Saloon side the Saloon's mahogany panelling
 * (the room's painted grain carrying the photographed colour), beyond the end
 * and fireplace walls the corridor's wall.
 */
function interiorFaceColour(mood: HallMoodUniforms, street: Node<"vec3">, textures: HallTextures | null): Node<"vec3"> {
  const n = bodyNormal();
  const p = positionWorld;
  const f = INTERIOR_FACES;
  const doorSide = n.z.greaterThan(0.5);
  const saloon = doorSide.and(p.x.greaterThanEqual(f.saloonFrom));
  const height = p.y;
  const band = height.greaterThanEqual(f.dadoTop).and(height.lessThan(f.dadoTop + f.band));
  // The band's edges a little darker, as a moulded frame round its gilt.
  const inBand = height.sub(f.dadoTop).div(f.band);
  const bandShade = mix(float(0.55), float(1), smoothstep(0.0, 0.18, inBand).mul(float(1).sub(smoothstep(0.82, 1.0, inBand))));
  const gilt = linear(GILT_COLOUR).mul(0.85).mul(bandShade);
  const corridor = height.lessThan(f.dadoTop).select(srgb255(f.corridorDado), band.select(gilt, srgb255(f.corridorWall)));
  const grain = textures === null ? float(1) : mahoganyGrain(textures, vec2(p.x.add(p.z), p.y).mul(1.6));
  const panelling = srgb255(f.saloonPanelling).mul(grain);
  const interior = doorSide.select(saloon.select(panelling, corridor), srgb255(f.corridorWall));
  return n.z.lessThan(-0.5).select(street, relitBeyond(interior, mood, vec3(0, 0, 0)));
}

/** A doorway's lining as photographed (BEYOND_ATLAS.linings), and whether this fragment has one. */
function liningPhoto(beyond: HallBeyondPhotos): { readonly colour: Node<"vec3">; readonly has: Node<"bool"> } {
  const p = positionWorld;
  const n = bodyNormal();
  const doorWall = float(HALL_WALLS.findIndex((wall) => wall.id === "door"));
  const u = wallU(doorWall, p);
  const t = wallBehind(doorWall, p);
  let colour: Node<"vec3"> = vec3(0, 0, 0);
  let has: Node<"bool"> = bool(false);
  for (const lining of BEYOND_ATLAS.linings) {
    const width = lining.u1 - lining.u0;
    const inside = u.greaterThan(lining.u0 - 0.03).and(u.lessThan(lining.u1 + 0.03)).and(t.greaterThan(-0.01)).and(t.lessThan(lining.depth + 0.01))
      .and(p.y.lessThan(lining.head + 0.01));
    // Which face: the jamb at u0 faces along the door wall's tangent (-x), the head down, the jamb at u1 back (+x).
    const low = n.x.lessThan(-0.5);
    const head = n.y.lessThan(-0.5);
    const faces = low.or(head).or(n.x.greaterThan(0.5));
    const s = head.select(u.sub(lining.u0).add(lining.head), low.select(p.y, float(2 * lining.head + width).sub(p.y)));
    const column = t.mul(lining.ppm).clamp(0.5, lining.rect[2] - 0.5).add(lining.rect[0]);
    const row = s.mul(lining.ppm).clamp(0.5, lining.rect[3] - 0.5).add(lining.rect[1]);
    const photo = beyond.sample(vec2(column.div(BEYOND_ATLAS.size[0]), float(1).sub(row.div(BEYOND_ATLAS.size[1])))).rgb;
    const shown = mix(srgb255(lining.median), photo, beyond.mix);
    colour = inside.and(faces).select(shown, colour);
    has = has.or(inside.and(faces));
  }
  return { colour, has };
}

/**
 * The bodies' material. Each vertex rises no higher than its wall's cut (the
 * lower of two walls' at a corner) and no lower than the floor of its piece
 * of walling; lintels, the piers' sides over doors and the tops of the
 * walling under openings come and go with the cut (hall-wall-body.ts,
 * bodyVertexHeight); what still stands above the cut is discarded.
 *
 * Light, baked into the colour from the mood: the cut by the room's ambient,
 * its chandeliers most at the room's side, the sky above the lifted ceiling
 * and the sun or moon (cutTopLight); the outer faces by the sky and a little
 * of the room's glow; the linings by the room's baked channels. The cut's
 * room edge carries a gilt line, out at the relief's surface where the relief
 * stands proud at the cut (hall-relief-section.ts).
 */
export function createWallBodyMaterial(
  section: HallSectionUniforms, mood: HallMoodUniforms, preset: SectionPreset, profile: Texture, sunlit = false, extras: WallBodyExtras = {},
): MeshBasicNodeMaterial {
  const sun = extras.sun ?? null;
  const card = preset.light === "card";
  const lighting = topLighting(preset, mood, sunlit, sun);
  const roomGlow = mood.chandelier.rgb.mul(mood.chandelierIntensity);
  // Card faces take the city's light without its shadow map: the map's node
  // reads normalWorld (its normal offset), which, as in bodyNormal, put the
  // pass's normal target out of step and the occlusion black on the cut's tops.
  const cardOf = (albedo: Node<"vec3">): Node<"vec3"> => cardLit(albedo, bodyNormal(), sunlit ? sun : null, mood, float(1), false).add(albedo.mul(roomGlow).mul(preset.outerGlow));
  const material = new MeshBasicNodeMaterial({ fog: false });
  const tag = attribute("aSection", "vec4");
  const shape = attribute("aShape", "vec3");
  const cut = min(cutOfWall(section, tag.x), cutOfWall(section, tag.y));
  const role = tag.z;
  const released = cut.lessThan(LINTEL_RELEASE);
  const y = positionLocal.y;
  const hiddenLintel = role.greaterThan(BODY_ROLE.lintel - 0.5).and(role.lessThan(BODY_ROLE.lintel + 0.5)).and(released);
  const hiddenJamb = role.greaterThan(BODY_ROLE.lintelJamb - 0.5).and(role.lessThan(BODY_ROLE.lintelJamb + 0.5)).and(released.not());
  const hiddenCap = role.greaterThan(BODY_ROLE.capOnly - 0.5).and(cut.greaterThanEqual(y.sub(1e-4)));
  const hidden = hiddenLintel.or(hiddenJamb).or(hiddenCap);
  const clamped = vec3(positionLocal.x, max(min(y, cut), shape.x), positionLocal.z);
  // A collapsed vertex goes to one point far below the floor, so its faces have no area.
  material.positionNode = hidden.select(vec3(0, -50, 0), clamped);
  const isTop = tag.w.greaterThan(BODY_FINISH.cap - 0.5).and(tag.w.lessThan(BODY_FINISH.cap + 0.5));

  const height = positionWorld.y;
  const sky = mood.skyHorizon.rgb.mul(mood.skyIntensity);
  const glow = mood.chandelier.rgb.mul(mood.chandelierIntensity);
  const outside = sky.mul(OUTER_SKY).add(glow.mul(preset.outerGlow));
  const room = bakedIrradiance(mood);
  const finish = tag.w;
  // The outer faces: a soft darkening at their foot, as a model's walls take it.
  const foot = mix(float(0.7), float(1), smoothstep(0, 1.6, height));
  const street = linear(preset.outer).mul(outside).mul(foot);
  const outer = card ? cardOf(linear(preset.outer)) : preset.interiorFaces ? interiorFaceColour(mood, street, extras.textures ?? null) : street;
  // The cut (cutTopColour). Where the relief stands proud at the cut, the
  // room's edge, and the gilt line on it, lie out at its surface on the cap
  // (createSectionCapMaterial); a wall that is not cut ends at its plane.
  const fromRoom = shape.y;
  const toOuter = shape.z;
  const sliced = proudAt(profile, tag.x, wallU(tag.x, positionWorld));
  const proud = cut.lessThan(WALL_BODY_TOP).and(sliced.greaterThan(NO_SECTION + 0.5)).select(sliced, float(0));
  // Where the relief lies behind the wall's plane at the cut (the frieze, the
  // attic panelling, set back), the top in front of it is air: it goes, and
  // the room line and the gilt start at the relief's surface.
  const line = fromRoom.add(min(proud, float(0)));
  const edgeScaled = cut.lessThan(WALL_BODY_TOP).select(edgeScale(profile, tag.x, wallU(tag.x, positionWorld)), float(1));
  const cap = cutTopColour(preset, lighting, height, fromRoom, line, fromRoom.add(proud), edgeScaled, toOuter);
  // A corner block's top: no room edge, an arris along both outer edges.
  const p = positionWorld;
  const grain = p.x.mul(41).add(p.z.mul(7).sin().mul(3)).sin().mul(p.z.mul(37).add(p.x.mul(5).sin().mul(2)).sin()).mul(0.035);
  const core = linear(preset.core).mul(grain.add(1));
  const cornerArris = max(lineCoverage(fromRoom, SECTION_ARRIS), lineCoverage(toOuter, SECTION_ARRIS));
  // Its light by how far it lies behind the nearer of its two walls' planes,
  // which is each wall's own measure where the block meets that wall's top.
  const cornerFromRoom = max(wallBehind(tag.x, positionWorld), wallBehind(tag.y, positionWorld));
  const cornerCap = lighting(mix(core, linear(preset.arris), cornerArris), cornerFromRoom);
  const plainLining = card ? cardOf(linear(preset.doorLining)) : linear(preset.doorLining).mul(room);
  const beyond = extras.beyond ?? null;
  let doorLining = plainLining;
  if (preset.liningPhotos && beyond !== null && !card) {
    // The end and main doors' linings as photographed, relit like the hall's photographs.
    const photo = liningPhoto(beyond);
    const k = float(0.06);
    doorLining = photo.has.select(photo.colour.mul(room.add(k).div(scanIrradiance().add(k))), plainLining);
  }
  const windowLining = card ? cardOf(linear(preset.windowLining))
    : linear(preset.windowLining).mul(room.add(mood.daylight.rgb.mul(mood.daylightIntensity).mul(REVEAL_SKY_VIEW)));
  // Upright faces of the cut take the core's colour without the grain (it
  // would streak down them), and no sun (they face sideways).
  const upright = card
    ? cardOf(linear(preset.core)).add(linear(preset.core).mul(roomGlow).mul(capGlowNode(fromRoom)).mul(UPRIGHT_SHARE))
    : linear(preset.core).mul(cutTopLight(mood, false, fromRoom)).mul(UPRIGHT_SHARE);
  const pick = (code: number) => finish.greaterThan(code - 0.5).and(finish.lessThan(code + 0.5));
  material.maskNode = positionWorld.y.lessThanEqual(cut.add(0.002)).and(isTop.and(line.lessThan(-1e-4)).not());
  material.colorNode = pick(BODY_FINISH.outer).select(outer,
    pick(BODY_FINISH.cap).select(cap,
      pick(BODY_FINISH.doorLining).select(doorLining,
        pick(BODY_FINISH.windowLining).select(windowLining,
          pick(BODY_FINISH.cornerCap).select(cornerCap, upright)))));
  material.name = "grand-hall-wall-body";
  return material;
}

/** The windows (all in the window wall), whose clear outlines the cap leaves open. */
const WINDOW_OUTLINES = HALL_OPENINGS.filter((opening) => isWindow(opening));

/**
 * The relief's section (hall-relief-section.ts): the cap's quads laid in each
 * wall's cut plane and clipped to how far the relief stands proud there, so
 * the section meets the relief's surface over every moulding. It is the body's
 * top carried on (cutTopColour): the room line's own material (the dado's
 * mahogany, the plaster, the attic's oak, by the cut's height), lit as at the
 * wall's plane, with the gilt line on its room edge. None
 * in a window's clear outline (the curtains are cloth, with air behind them),
 * none over a doorway once its lintel has gone, none on a wall that is not
 * cut. It reaches a centimetre over the body's top, in the same plane and
 * colour as the body's room line there, so no crack can open between them.
 * Its edge is a hard test where the pass smooths edges itself (desktops'
 * temporal resolve, tablets' FXAA), and alpha to coverage where the pass is
 * multisampled (phones).
 */
export function createSectionCapMaterial(
  section: HallSectionUniforms, mood: HallMoodUniforms, preset: SectionPreset, profile: Texture, sunlit = false, multisampled = false, sun: HallSun | null = null,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ fog: false });
  const cap = attribute("aCap", "vec3");
  const wall = cap.x;
  const u = cap.y;
  const depth = cap.z;
  const cut = cutOfWall(section, wall);
  const live = cut.lessThan(WALL_BODY_TOP).and(cut.greaterThan(0.01));
  // A wall that is not cut has no section: its quads collapse to one point far below the floor.
  material.positionNode = live.select(vec3(positionLocal.x, cut, positionLocal.z), vec3(0, -50, 0));
  const proud = proudAt(profile, wall, u);
  let inWindow: Node<"bool"> = bool(false);
  for (const opening of WINDOW_OUTLINES) {
    const half = opening.width / 2;
    const across = u.sub(opening.centre);
    const rise = opening.kind === "arched-window" ? sqrt(max(float(half * half).sub(across.mul(across)), float(0))) : float(0);
    inWindow = inWindow.or(wall.lessThan(0.5).and(across.abs().lessThanEqual(half))
      .and(cut.greaterThanEqual(opening.sill)).and(cut.lessThanEqual(rise.add(opening.head))));
  }
  let overDoor: Node<"bool"> = bool(false);
  for (const slot of DOOR_SLOTS) {
    overDoor = overDoor.or(wall.greaterThan(slot.wall - 0.5).and(wall.lessThan(slot.wall + 0.5))
      .and(u.greaterThan(slot.u0)).and(u.lessThan(slot.u1)).and(cut.greaterThan(slot.head)).and(cut.lessThan(LINTEL_RELEASE)));
  }
  // How far inside the section this point lies, from the relief's surface.
  const inside = proud.sub(depth);
  const solid = proud.greaterThan(NO_SECTION + 0.5).and(inWindow.not()).and(overDoor.not());
  if (multisampled) {
    // three's alpha to coverage ramps the alpha from the alpha test up over one
    // pixel; a test at 0 keeps the ramp centred on the relief's surface (at 0.5
    // it drew the edge half a pixel in, over the gilt line).
    const coverage = inside.div(max(fwidth(inside), float(1e-5))).add(0.5).clamp(0, 1);
    material.opacityNode = solid.select(coverage, float(0));
    material.alphaTestNode = float(0);
    material.alphaToCoverage = true;
  } else {
    material.maskNode = solid.and(inside.greaterThanEqual(0));
  }
  // The body's top carried on over the relief: behind the plane (its first
  // centimetre, over the body) as the body draws it there; in front, the
  // room line's material lit as at the plane, with the gilt line on its edge.
  const fromPlane = max(depth.negate(), float(0));
  const line = fromPlane.add(min(proud, float(0)));
  material.colorNode = cutTopColour(preset, topLighting(preset, mood, sunlit, sun), positionWorld.y, fromPlane, line, inside, edgeScale(profile, wall, u), null);
  material.name = "grand-hall-section-cap";
  return material;
}

export interface HallSection {
  /** Every wall's body, cut in the shader (hall-wall-body.ts). */
  readonly body: BufferGeometry;
  readonly plinth: BufferGeometry;
  /** The relief's section at each wall's cut, read by the cap and the body's light (hall-relief-section.ts). */
  readonly profile: HallSectionProfile;
  readonly materials: { readonly body: Material; readonly plinth: Material; readonly cap: Material };
  /** Nocturne's moulded top on the cut (hall-coping.ts), or null. */
  readonly coping: { readonly geometry: BufferGeometry; readonly material: Material } | null;
  dispose(): void;
}

export interface HallSectionOptions {
  readonly preset?: SectionPreset;
  /** Lit by the real sun and moon (GrandHallModel's `sunlit`): the cut's tops take their light. */
  readonly sunlit?: boolean;
  /** The scene pass is multisampled (a phone's profile): the cap's edge uses alpha to coverage, the moulded top fakes its glint. */
  readonly multisampled?: boolean;
  /** The real sun and moon's light and shadow (Atelier's card), when lit by them. */
  readonly sun?: HallSun | null;
  /** The room's painted textures (the Saloon's panelling on Ashlar's interior faces). */
  readonly textures?: HallTextures | null;
  /** The beyond's photographs (Ashlar's photographed linings). */
  readonly beyond?: HallBeyondPhotos | null;
}

/** The walls' bodies, the relief's section and the plinth, with their materials (and Nocturne's moulded top). */
export function createHallSection(section: HallSectionUniforms, mood: HallMoodUniforms, options: HallSectionOptions = {}): HallSection {
  const preset = options.preset ?? SECTION_PRESETS.ashlar;
  const sunlit = options.sunlit ?? false;
  const sun = options.sun ?? null;
  const { geometry: body } = buildWallBody();
  const plinth = buildPlinthRing();
  const profile = new HallSectionProfile();
  const bodyMaterial = createWallBodyMaterial(section, mood, preset, profile.texture, sunlit, { sun, textures: options.textures ?? null, beyond: options.beyond ?? null });
  const capMaterial = createSectionCapMaterial(section, mood, preset, profile.texture, sunlit, options.multisampled ?? false, sun);
  const plinthMaterial = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  plinthMaterial.colorNode = vec3(0.022, 0.016, 0.012);
  plinthMaterial.name = "grand-hall-plinth";
  const coping = preset.coping
    ? { geometry: buildCoping().geometry, material: createCopingMaterial(section, mood, options.multisampled ?? false) }
    : null;
  return {
    body,
    plinth,
    profile,
    materials: { body: bodyMaterial, plinth: plinthMaterial, cap: capMaterial },
    coping,
    dispose: () => {
      coping?.geometry.dispose();
      coping?.material.dispose();
      body.dispose();
      plinth.dispose();
      profile.dispose();
      bodyMaterial.dispose();
      capMaterial.dispose();
      plinthMaterial.dispose();
    },
  };
}
