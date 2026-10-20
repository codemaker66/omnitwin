// ---------------------------------------------------------------------------
// The cutaway's section: the walls as a model maker would cut them
//
// When the planner looks in from above, the walls nearest the camera are cut
// down (GrandHallModel's cutaway). Each wall has a body as thick as the wall
// really is, with every window and door open through it (hall-wall-body.ts),
// all four in one mesh that the shader lowers to each wall's cut: no object
// moves from frame to frame, and the whole section draws in two calls (the
// bodies and the plinth ring; the doorways' oak thresholds draw with the
// floor's material in a third).
//
// The section's finish is a preset (SECTION_PRESETS, `?section=`): Ashlar,
// the building's own materials, by default. Its faces are unlit: the room's
// light is baked into their colour from the same channels as every other
// surface of the hall, so a phone pays a little arithmetic, not the five
// chandeliers' lights.
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

import { Color, ShapeUtils, Vector2, type BufferGeometry, type Material } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { attribute, float, fwidth, max, min, mix, positionLocal, positionWorld, smoothstep, vec3 } from "three/tsl";
import { MeshBuilder, type V3 } from "./mesh-builder.js";
import { HALL_ELEVATION, HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALL_THICKNESS, type HallWall } from "./hall-spec.js";
import { BODY_FINISH, BODY_ROLE, LINTEL_RELEASE, bodyOutline, buildWallBody } from "./hall-wall-body.js";
import { bakedIrradiance, type HallSectionUniforms } from "./hall-materials.js";
import type { HallMoodUniforms } from "./hall-mood.js";

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
  /** The doorways' linings. */
  readonly doorLining: string;
  /** The windows' outer reveals where the body carries them on. */
  readonly windowLining: string;
  /** How much of the room's glow reaches the outer faces (a presentation fill). */
  readonly outerGlow: number;
}

/**
 * Ashlar (the default): the building's own materials. Polished ashlar
 * outside, the pale sandstone of the Glassford Street front, with no joints
 * (no photograph of the facade gives its coursing; the colour is art
 * direction until one does); the cut a warm stone core
 * with a lime-plaster line at the room edge, or the panelling where the cut
 * passes through it (the dado's mahogany #5c3132; the attic's oak, the atlas's
 * median #734c1c); doorways lined in mahogany as the panoramas show them.
 * Atelier and Nocturne carry their palettes only for now (an architect's
 * card model like the city; a dark jewel box), completed in a later slice.
 */
export const SECTION_PRESETS: Readonly<Record<SectionPresetName, SectionPreset>> = {
  ashlar: {
    outer: "#c9bca3", core: "#c4b496", plaster: "#ece4d6", dado: "#5c3132", attic: "#734c1c",
    arris: "#fff3dc", doorLining: "#5c3132", windowLining: "#b4a58c", outerGlow: 0.04,
  },
  atelier: {
    outer: "#dbd1c2", core: "#c7b8a3", plaster: "#c7b8a3", dado: "#c7b8a3", attic: "#c7b8a3",
    arris: "#a58350", doorLining: "#dbd1c2", windowLining: "#dbd1c2", outerGlow: 0.05,
  },
  nocturne: {
    outer: "#1d1814", core: "#2a2420", plaster: "#a58350", dado: "#a58350", attic: "#a58350",
    arris: "#a58350", doorLining: "#1d1814", windowLining: "#1d1814", outerGlow: 0.02,
  },
};

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
 * A line is never drawn thinner than this many pixels: narrower, it would
 * fall between pixels and flicker as the camera moves (phones have no
 * temporal smoothing). Widened, it is dimmed in proportion, so a distant line
 * does not brighten.
 */
const LINE_MIN_PIXELS = 0.75;
/**
 * The cut's light: the room's ambient, this share of the chandeliers' (the
 * cut is a presentation surface, lit like the model on a table under the
 * room's own light, wherever it stands), and the sky it sees once the
 * ceiling is lifted. The outer faces see the sky too.
 */
const CAP_GLOW = 0.35;
const CAP_SKY = 0.35;
const OUTER_SKY = 0.5;
/** Upright faces of the cut (the walls' ends, steps in their outer faces) take this share of the cut's light. */
const UPRIGHT_SHARE = 0.7;
/** A window reveal's share of the sky, as hall-materials.ts gives the reveals. */
const REVEAL_SKY_VIEW = 0.5;

const linear = (hex: string) => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

/** 1 within `width` of an edge (`distance` from it), anti-aliased and never under LINE_MIN_PIXELS wide. */
function edgeLine(distance: Node<"float">, width: number): Node<"float"> {
  const pixel = max(fwidth(distance), float(1e-5));
  const drawn = max(float(width), pixel.mul(LINE_MIN_PIXELS));
  const line = float(1).sub(smoothstep(drawn.sub(pixel.mul(0.5)), drawn.add(pixel.mul(0.5)), distance));
  return line.mul(float(width).div(drawn));
}

/**
 * The bodies' material. Each vertex rises no higher than its wall's cut (the
 * lower of two walls' at a corner) and no lower than the floor of its piece
 * of walling; lintels, the piers' sides over doors and the tops of the
 * walling under openings come and go with the cut (hall-wall-body.ts,
 * bodyVertexHeight); what still stands above the cut is discarded.
 *
 * Light, baked into the colour from the mood: the cut by the room's ambient,
 * its chandeliers and the sky above the lifted ceiling; the outer faces by
 * the sky and a little of the room's glow; the linings by the room's baked
 * channels.
 */
export function createWallBodyMaterial(section: HallSectionUniforms, mood: HallMoodUniforms, preset: SectionPreset): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ fog: false });
  const tag = attribute("aSection", "vec4");
  const shape = attribute("aShape", "vec3");
  const [c0, c1, c2, c3] = section.cuts;
  const cutOf = (wall: typeof tag.x) => wall.lessThan(-0.5).select(float(1000),
    wall.lessThan(0.5).select(c0, wall.lessThan(1.5).select(c1, wall.lessThan(2.5).select(c2, c3))));
  const cut = min(cutOf(tag.x), cutOf(tag.y));
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
  material.maskNode = positionWorld.y.lessThanEqual(cut.add(0.002));

  const height = positionWorld.y;
  const sky = mood.skyHorizon.rgb.mul(mood.skyIntensity);
  const glow = mood.chandelier.rgb.mul(mood.chandelierIntensity);
  const cutLight = mood.ambient.rgb.mul(mood.ambientIntensity).add(glow.mul(CAP_GLOW)).add(sky.mul(CAP_SKY));
  const outside = sky.mul(OUTER_SKY).add(glow.mul(preset.outerGlow));
  const room = bakedIrradiance(mood);
  const finish = tag.w;
  // The outer faces: a soft darkening at their foot, as a model's walls take it.
  const foot = mix(float(0.7), float(1), smoothstep(0, 1.6, height));
  const outer = linear(preset.outer).mul(outside).mul(foot);
  // The cut, from the room edge: the room's line, the core, the outer arris.
  const fromRoom = shape.y;
  const toOuter = shape.z;
  const roomLine = edgeLine(fromRoom, SECTION_LINE);
  const arris = edgeLine(toOuter, SECTION_ARRIS);
  const dado = height.lessThan(HALL_ELEVATION.dadoTop + 0.02);
  const attic = height.greaterThan(HALL_ELEVATION.corniceTop - 0.02);
  const edgeColour = dado.select(linear(preset.dado), attic.select(linear(preset.attic), linear(preset.plaster)));
  // A faint grain in the stone, in world space so it never swims as the cut moves.
  const p = positionWorld;
  const grain = p.x.mul(41).add(p.z.mul(7).sin().mul(3)).sin().mul(p.z.mul(37).add(p.x.mul(5).sin().mul(2)).sin()).mul(0.035);
  const core = linear(preset.core).mul(grain.add(1));
  const cap = mix(mix(core, edgeColour, roomLine), linear(preset.arris), arris).mul(cutLight);
  // A corner block's top: no room edge, an arris along both outer edges.
  const cornerArris = max(edgeLine(fromRoom, SECTION_ARRIS), edgeLine(toOuter, SECTION_ARRIS));
  const cornerCap = mix(core, linear(preset.arris), cornerArris).mul(cutLight);
  const doorLining = linear(preset.doorLining).mul(room);
  const windowLining = linear(preset.windowLining).mul(room.add(mood.daylight.rgb.mul(mood.daylightIntensity).mul(REVEAL_SKY_VIEW)));
  // Upright faces of the cut take the core's colour without the grain (it would streak down them).
  const upright = linear(preset.core).mul(cutLight).mul(UPRIGHT_SHARE);
  const pick = (code: number) => finish.greaterThan(code - 0.5).and(finish.lessThan(code + 0.5));
  material.colorNode = pick(BODY_FINISH.outer).select(outer,
    pick(BODY_FINISH.cap).select(cap,
      pick(BODY_FINISH.doorLining).select(doorLining,
        pick(BODY_FINISH.windowLining).select(windowLining,
          pick(BODY_FINISH.cornerCap).select(cornerCap, upright)))));
  material.name = "grand-hall-wall-body";
  return material;
}

export interface HallSection {
  /** Every wall's body, cut in the shader (hall-wall-body.ts). */
  readonly body: BufferGeometry;
  readonly plinth: BufferGeometry;
  readonly materials: { readonly body: Material; readonly plinth: Material };
  dispose(): void;
}

/** The walls' bodies and the plinth, with their materials. */
export function createHallSection(section: HallSectionUniforms, mood: HallMoodUniforms, preset: SectionPreset = SECTION_PRESETS.ashlar): HallSection {
  const { geometry: body } = buildWallBody();
  const plinth = buildPlinthRing();
  const bodyMaterial = createWallBodyMaterial(section, mood, preset);
  const plinthMaterial = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  plinthMaterial.colorNode = vec3(0.022, 0.016, 0.012);
  plinthMaterial.name = "grand-hall-plinth";
  return {
    body,
    plinth,
    materials: { body: bodyMaterial, plinth: plinthMaterial },
    dispose: () => {
      body.dispose();
      plinth.dispose();
      bodyMaterial.dispose();
      plinthMaterial.dispose();
    },
  };
}
