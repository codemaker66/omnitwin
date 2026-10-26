// ---------------------------------------------------------------------------
// What the Grand Hall's windows look onto at night
//
// From its five windows the hall looks across Glassford Street at the
// frontage opposite (76 Glassford Street with the Blane Valley bar under it,
// the Bacchus building, the houses south of them) and down Garth Street to
// the building that closes it on Hutcheson Street. The city model carries
// their massing but no openings, so at night they filled the hall's windows
// as dark violet. Our own panoramas show the openings:
// tools/grand-hall-survey/context/facade-survey.json reads them off the walls
// and bake_facade_lights.py places them on the model (facade-lights-v1.json).
//
// Here they light after dusk, in one additive draw: offices a floor at a time
// and homes one by one, by their seeds against the night look's shares
// (curtains, blinds and the odd dark office by a second seed), the bar's arches and door and the Bacchus's glazing lit from
// inside, the signs as photographed at blue hour, and the pavement before each
// lit shopfront. Every colour and share is the night look's (night-looks.ts)
// through uniforms, so a look changes nothing but values. Where the survey
// reaches, the city's random windows give way to these (surveyedWall).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide } from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  Fn, abs, attribute, cameraPosition, cross, dFdx, dFdy, dot, exp, float, fract, fwidth, length, max, min, mix, normalize, positionWorld,
  pow, select, sin, smoothstep, step, uv, vec2, vec3, vec4,
} from "three/tsl";
import { hallSkyUniforms as sky } from "./hall-sky-runtime.js";
import { airAt, duskShare, lightOnlyOutput, streetLookUniforms } from "./hall-street-light.js";

export const FACADE_LIGHTS_URL = "/rooms/grand-hall/context-2020-lidar/facade-lights-v1.json?r=1";

/** Coordinates outside this box mean a malformed file, metres (as the city model's). */
const COORDINATE_LIMIT = 320;

export const FACADE_KINDS = ["window", "shop", "door", "sign", "spill"] as const;
export type FacadeKind = (typeof FACADE_KINDS)[number];
/** What lights each feature, in the order the shader numbers them. */
export const FACADE_LIGHT_CLASSES = ["office", "home", "pub", "bar", "glass-green", "sign-teal", "sign-violet", "sign-green"] as const;
export type FacadeLightClass = (typeof FACADE_LIGHT_CLASSES)[number];

export interface FacadeLight {
  readonly id: string;
  readonly kind: FacadeKind;
  readonly light: FacadeLightClass;
  /** A window's use: offices and homes light by their own shares. */
  readonly use: "office" | "home" | null;
  /** Two numbers in [0, 1) from a hash of the id: whether it lights (against its share) and its curtains. */
  readonly seed: number;
  readonly variant: number;
  /** The quad: its centre and two half-extent vectors (along its wall and up it, or out across the pavement). */
  readonly centre: readonly [number, number, number];
  readonly along: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /**
   * A long sign or shopfront is placed in pieces that follow the wall: where
   * this piece starts along the whole and the whole's length, metres, so the
   * shader draws one frame and one row of letters across them.
   */
  readonly span: readonly [number, number];
}

/**
 * The walls the survey reads, as boxes in plan (x and z, metres): where the
 * city's random windows give way to the surveyed ones. The Bacchus building's
 * upper windows inside the first are blind, so it shows no window there at all.
 */
export const FACADE_SURVEYED_WALLS = [
  { id: "glassford-east", x: [-18.5, 23.5], z: [-26.5, -23.0] },
  { id: "garth-north", x: [-6.8, -4.4], z: [-57.5, -32.0] },
  { id: "garth-end", x: [-8.5, 8.5], z: [-84.5, -81.0] },
] as const satisfies readonly { id: string; x: readonly [number, number]; z: readonly [number, number] }[];

function fail(reason: string): never {
  throw new Error(`Grand Hall facade lights: ${reason}`);
}

const coordinate = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT);
const halfExtent = z.number().min(-10).max(10);

const lightSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}:[a-z0-9.:-]{1,40}$/u),
  kind: z.enum(FACADE_KINDS),
  light: z.enum(FACADE_LIGHT_CLASSES),
  use: z.enum(["office", "home"]).optional(),
  seed: z.number().min(0).lt(1),
  variant: z.number().min(0).lt(1),
  centre: z.tuple([coordinate, coordinate, coordinate]),
  along: z.tuple([halfExtent, halfExtent, halfExtent]),
  up: z.tuple([halfExtent, halfExtent, halfExtent]),
  span: z.tuple([z.number().min(0).max(40), z.number().positive().max(40)]),
}).strict();

const count = z.number().int().nonnegative();
const fileSchema = z.object({
  schema: z.literal("venviewer.facade-lights.v1"),
  licence: z.object({ panoramas: z.string().min(1), model: z.string().min(1), note: z.string().min(1) }),
  counts: z.object({
    window: count, shop: count, door: count, sign: count, spill: count, lights: count, dropped: count, blind: count, clipped: count,
  }),
  lights: z.array(lightSchema).max(4000),
});

type V3 = readonly [number, number, number];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3): number => Math.sqrt(dot3(a, a));

/** Whether a point (x, z) lies on a surveyed wall. */
export function onSurveyedWall(x: number, zCoordinate: number): boolean {
  return FACADE_SURVEYED_WALLS.some((wall) => x >= wall.x[0] && x <= wall.x[1] && zCoordinate >= wall.z[0] && zCoordinate <= wall.z[1]);
}

/** Reads the baked facade lights, checking them against themselves and against the surveyed walls. */
export function parseFacadeLights(json: unknown): FacadeLight[] {
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    fail(parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "));
  }
  const { counts, lights } = parsed.data;
  if (lights.length !== counts.lights) fail(`${String(lights.length)} lights, the file counts ${String(counts.lights)}`);
  for (const kind of FACADE_KINDS) {
    const found = lights.filter((light) => light.kind === kind).length;
    if (found !== counts[kind]) fail(`${String(found)} of kind ${kind}, the file counts ${String(counts[kind])}`);
  }
  if (new Set(lights.map((light) => light.id)).size !== lights.length) fail("a light's id twice");
  return lights.map((light) => {
    const { id, kind, along, up, centre } = light;
    if ((kind === "window") !== (light.use !== undefined)) fail(`${id}: a window and only a window has a use`);
    const a = norm3(along);
    const u = norm3(up);
    if (a < 0.05 || u < 0.05) fail(`${id}: smaller than 10 cm`);
    if (Math.abs(dot3(along, up)) > 1e-3 * a * u) fail(`${id}: its sides are not square`);
    if (Math.abs(along[1]) > 1e-6) fail(`${id}: it does not run level along its wall`);
    // A piece lies within its whole.
    const [start, length] = light.span;
    if (start + 2 * a > length + 1e-3) fail(`${id}: a piece past the end of its whole`);
    // A window, shopfront, door or sign stands upright on its wall; a spill lies flat on the pavement.
    const upright = Math.abs(up[0]) < 1e-6 && Math.abs(up[2]) < 1e-6 && up[1] > 0;
    if (kind === "spill" ? Math.abs(up[1]) > 1e-6 : !upright) fail(`${id}: ${kind === "spill" ? "not flat" : "not upright"}`);
    // A spill lies out on the pavement; its foot, at the shopfront, is on the wall.
    const foot = kind === "spill" ? [centre[0] - up[0], centre[2] - up[2]] as const : [centre[0], centre[2]] as const;
    if (!onSurveyedWall(foot[0], foot[1])) fail(`${id}: off the surveyed walls`);
    return { ...light, use: light.use ?? null };
  });
}

/** A light class's number in the shader. */
export function lightClassIndex(light: FacadeLightClass): number {
  return FACADE_LIGHT_CLASSES.indexOf(light);
}

/**
 * Every light as a quad, merged for one draw. Each vertex carries its quad's
 * uv (0..1, v from the bottom, or from the wall for a spill), `facadeKind` and
 * `facadeLight` (their indices), `facadeSeed` (seed, variant) and
 * `facadeSize` (the quad's width and height, metres) and `facadeSpan` (where
 * a piece starts along its whole, and the whole's length), so the shader can
 * draw frames, bars, curtains and letters in metres.
 */
export function buildFacadeLightGeometry(lights: readonly FacadeLight[]): BufferGeometry {
  const n = lights.length;
  const position = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const kinds = new Float32Array(n * 4);
  const classes = new Float32Array(n * 4);
  const seeds = new Float32Array(n * 8);
  const sizes = new Float32Array(n * 8);
  const spans = new Float32Array(n * 8);
  const index = new Uint32Array(n * 6);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  lights.forEach((light, q) => {
    const { centre, along, up } = light;
    corners.forEach(([s, t], k) => {
      const v = q * 4 + k;
      for (let axis = 0; axis < 3; axis++) position[v * 3 + axis] = (centre[axis] ?? 0) + s * (along[axis] ?? 0) + t * (up[axis] ?? 0);
      uvs.set([(s + 1) / 2, (t + 1) / 2], v * 2);
      kinds[v] = FACADE_KINDS.indexOf(light.kind);
      classes[v] = lightClassIndex(light.light);
      seeds.set([light.seed, light.variant], v * 2);
      sizes.set([2 * norm3(along), 2 * norm3(up)], v * 2);
      spans.set(light.span, v * 2);
    });
    index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("facadeKind", new BufferAttribute(kinds, 1));
  geometry.setAttribute("facadeLight", new BufferAttribute(classes, 1));
  geometry.setAttribute("facadeSeed", new BufferAttribute(seeds, 2));
  geometry.setAttribute("facadeSize", new BufferAttribute(sizes, 2));
  geometry.setAttribute("facadeSpan", new BufferAttribute(spans, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** 1 on a surveyed wall, 0 elsewhere: where the city's random windows give way to the surveyed ones. */
export function surveyedWall(p: Node<"vec3">): Node<"float"> {
  let inside: Node<"float"> = float(0);
  for (const wall of FACADE_SURVEYED_WALLS) {
    const box = step(wall.x[0], p.x).mul(step(p.x, wall.x[1])).mul(step(wall.z[0], p.z)).mul(step(p.z, wall.z[1]));
    inside = max(inside, box);
  }
  return inside;
}

/** The pane inside a frame `frame` metres wide, anti-aliased to a pixel. */
function inset(fromEdge: Node<"vec2">, pixel: Node<"vec2">, frame: number): Node<"float"> {
  return smoothstep(pixel.x.negate(), pixel.x, fromEdge.x.sub(frame)).mul(smoothstep(pixel.y.negate(), pixel.y, fromEdge.y.sub(frame)));
}

/** A stripe pattern about 1, `depth` deep, fading to 1 once its period spans under four pixels. */
function stripes(metres: Node<"float">, pixel: Node<"float">, period: number, depth: number): Node<"float"> {
  const wave = sin(metres.mul((Math.PI * 2) / period)).mul(depth);
  return float(1).add(wave.mul(smoothstep(period / 2, period / 4, pixel)));
}

/** A light on the pavement seen from high over the city calms, as the pools do, so the hall stays the brightest thing. */
const SPILL_OVERVIEW = 0.6;
/**
 * How much of the sky a dark window's glass shows over the wall it is set in:
 * the glass's reflectance alone would add it to the wall's own light, where in
 * truth it replaces a dark room, so a little more.
 */
const GLASS_SHOWS = 1.6;

/**
 * The facade lights' material: additive, depth-tested, both faces, lit as
 * dusk falls (duskShare), dimmed by the air as the lamps' lenses are. Its
 * light writes no normal or occlusion of its own (lightOnlyOutput).
 */
export function createFacadeLightMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  material.colorNode = Fn(() => {
    const look = streetLookUniforms;
    const kind = attribute<"float">("facadeKind", "float");
    const cls = attribute<"float">("facadeLight", "float");
    const seeds = attribute<"vec2">("facadeSeed", "vec2");
    const size = attribute<"vec2">("facadeSize", "vec2");
    const span = attribute<"vec2">("facadeSpan", "vec2");
    const at = uv();
    const metres = at.mul(size);
    // Across a piece of a long sign, the frame and the letters run on along the whole.
    const alongWhole = span.x.add(metres.x);
    const fromEdge = vec2(min(alongWhole, span.y.sub(alongWhole)), min(metres.y, size.y.sub(metres.y)));
    const pixel = max(fwidth(metres), vec2(0.004, 0.004));
    const is = (code: number, value: Node<"float">): Node<"bool"> => abs(value.sub(code)).lessThan(0.5);

    const colour = select(is(0, cls), look.facadeOffice, select(is(1, cls), look.facadeHome, select(is(2, cls), look.facadePub,
      select(is(3, cls), look.facadeBar, select(is(4, cls), look.facadeGlassGreen, select(is(5, cls), look.facadeSignTeal,
        select(is(6, cls), look.facadeSignViolet, look.facadeSignGreen)))))));

    // A window: lit when its seed is under its use's share, each a little
    // brighter or dimmer than the next, inside a 6 cm frame. An office behind
    // blinds, brightest under its ceiling lights; a home lamplit from below,
    // its sash's meeting rail across the middle, or its curtains drawn from
    // both sides (each covering a sixth to two fifths of the width) with the
    // light through them dimmer and folded, and a bright gap between.
    const isOffice = is(0, cls);
    const share = select(isOffice, look.facadeOfficeShare, look.facadeHomeShare);
    // An office's seed is its floor's (offices light a floor at a time); on a lit floor about one room in six stays dark.
    const room = select(isOffice, step(fract(seeds.y.mul(7.31)), float(0.82)), float(1));
    const on = step(seeds.x, share).mul(room);
    const lit = on.mul(fract(seeds.y.mul(31.7)).mul(0.5).add(0.75));
    const pane = inset(fromEdge, pixel, 0.06);
    const rail = smoothstep(pixel.y.negate(), pixel.y, abs(metres.y.sub(size.y.mul(0.5))).sub(0.025)).mul(0.6).add(0.4);
    const office = stripes(metres.y, pixel.y, 0.09, 0.12).mul(mix(float(0.72), float(1), at.y)).mul(rail);
    const curtained = step(seeds.y, look.facadeCurtainShare);
    const cover = fract(seeds.y.mul(17.3)).mul(0.22).add(0.16);
    const soft = pixel.x.div(size.x).add(0.01);
    const curtain = max(smoothstep(cover.add(soft), cover.sub(soft), at.x), smoothstep(float(1).sub(cover).sub(soft), float(1).sub(cover).add(soft), at.x))
      .mul(curtained);
    const drawn = mix(rail, stripes(metres.x, pixel.x, 0.11, 0.18).mul(look.facadeCurtain), curtain);
    const home = mix(float(1), float(0.82), at.y).mul(drawn);
    const window = select(isOffice, office, home).mul(pane).mul(lit);
    // A dark window is glass: it shows the night sky behind the viewer, as
    // single glazing does (Schlick, 4% head-on, most at a glance), so a
    // street's unlit windows still read as windows, seen along it.
    const toEye = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalize(cross(dFdx(positionWorld), dFdy(positionWorld))), toEye));
    const fresnel = pow(float(1).sub(facing), 5).mul(0.96).add(0.04);
    const skyColour = mix(sky.horizonAway, sky.zenith, 0.35).add(look.domeGlow.mul(0.65));
    const darkGlass = skyColour.mul(fresnel).mul(pane).mul(rail).mul(float(1).sub(on)).mul(GLASS_SHOWS);

    // Glazing lit from inside, brightest under its ceiling, inside its frame. The
    // pub's windows are round-headed (a half circle on the full width, their
    // transom at its springing) with a mullion down the middle.
    const radius = span.y.mul(0.5);
    const springing = size.y.sub(radius);
    const roundHead = smoothstep(pixel.x.negate(), pixel.x, radius.sub(0.04).sub(length(vec2(alongWhole, metres.y).sub(vec2(radius, springing)))));
    const isPub = is(2, cls);
    const arch = select(isPub.and(metres.y.greaterThan(springing)), roundHead, float(1));
    const bar = (where: Node<"float">, along: Node<"float">, px: Node<"float">): Node<"float"> =>
      smoothstep(px.negate(), px, abs(along.sub(where)).sub(0.02)).mul(0.65).add(0.35);
    const glazing = select(isPub, bar(springing, metres.y, pixel.y).mul(bar(radius, alongWhole, pixel.x)), float(1));
    const shop = mix(float(0.8), float(1), at.y).mul(inset(fromEdge, pixel, 0.04)).mul(arch).mul(glazing);
    // A lit fascia glows evenly, brighter under its lamps at the top; backlit
    // letters (the bar's violet) read as a row of neon glyphs, one to each
    // 0.63 m (seven to "bacchus"), each an outlined rounded box with its glow.
    const board = mix(float(0.85), float(1), at.y).mul(inset(fromEdge, pixel, 0.015));
    const pitch = 0.63;
    const cell = vec2(fract(alongWhole.div(pitch)).sub(0.5).mul(pitch), metres.y.sub(size.y.mul(0.5)));
    const box = vec2(pitch * 0.3, size.y.mul(0.3));
    const outside = length(max(abs(cell).sub(box), vec2(0, 0)));
    const stroke = smoothstep(pixel.x.mul(1.5).add(0.035), pixel.x.mul(0.5), abs(outside.sub(0.06)));
    const letters = stroke.add(exp(outside.mul(-14)).mul(0.25)).mul(inset(fromEdge, pixel, 0.01));
    const sign = select(is(6, cls), letters, board);
    // The pavement before a shopfront: brightest at its foot, falling away across the pavement, soft at its ends.
    const toCamera = cameraPosition.sub(positionWorld);
    const fromAbove = mix(float(1), float(SPILL_OVERVIEW), smoothstep(8, 24, toCamera.y));
    const spill = exp(at.y.mul(-2.8)).mul(smoothstep(0, 0.2, at.x)).mul(smoothstep(1, 0.8, at.x)).mul(look.facadeSpill).mul(fromAbove);

    const isWindow = kind.lessThan(0.5);
    const pattern = select(isWindow, window, select(is(3, kind), sign, select(kind.greaterThan(3.5), spill, shop)));
    const glass = select(isWindow, darkGlass, vec3(0, 0, 0));
    const air = float(1).sub(airAt(length(toCamera), 1.6));
    return vec4(colour.mul(pattern).add(glass).mul(duskShare).mul(air), 1);
  })();
  material.mrtNode = lightOnlyOutput();
  material.name = "grand-hall-facade-lights";
  return material;
}
