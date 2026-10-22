// ---------------------------------------------------------------------------
// The street at night round the Grand Hall
//
// Glasgow City Council's own street lamps (positions from its open Lighting
// Columns layer, OGL v3.0), placed on the city model by
// tools/grand-hall-survey/context/bake_street_light.py: wall brackets snapped
// to the model's walls 8 m over the pavement, columns on its ground, Trades
// Hall's two door lanterns from our facade survey. The bake also writes two
// small light maps over the city (street-light-v2.bin), so the city's shader
// lights pools, wall scallops and the foot of each wall with one filtered and
// one exact texel read and no loop over lamps:
//
//   pool map, filtered   R  the distance to the nearest pool this point can see, metres (24 at most)
//                        G  that pool's lamp's switching altitude
//                        B  that lamp's foot, the ground its pool lies on
//                        A  the pool's strength
//   head map, exact      R  the nearest head this point can see: its switching altitude
//                        GB that head, relative to the texel's centre
//                        A  that head's height
//
// on a grid warped by asinh (about half a metre a texel at the hall, 2.3 m at
// the model's edge). The lamps themselves are white card fittings in one
// draw, their lenses lit; a halo marks each lantern so a chain of them fades
// into the haze, and on larger screens a cone of light hangs under each in
// the air. Every colour comes from the night look (lib/sky/night-looks.ts)
// through uniforms, so a look changes nothing but values.
//
// The lamps light as the sun sinks through dusk, each at its own altitude
// between −3.6° and −2.4° (the street's photocells do not agree to the
// second), its pool, its scallop, its lens, halo and cone together, so
// dragging the dial through dusk lights the street lamp by lamp. Nothing
// animates on its own.
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, DoubleSide, FrontSide,
  InstancedBufferAttribute, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoColorSpace, RGBAFormat, Sphere,
  UnsignedByteType, Vector2, Vector3, Vector4,
} from "three";
import { MeshBasicNodeMaterial, SpriteNodeMaterial, type Node, type TextureNode } from "three/webgpu";
import {
  Discard, Fn, abs, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, ivec2, length, log, max, mix, modelWorldMatrix,
  mrt, normalWorld, normalize, output, positionLocal, positionWorld, pow, screenCoordinate, select, smoothstep, sqrt, step,
  texture, textureLoad, uniform, uv, vec2, vec3, vec4, vertexStage,
} from "three/tsl";
import { activeStreetNightLook, type StreetNightLook } from "../../lib/sky/night-looks.js";
import type { Rgb } from "../../lib/sky/sky-palette.js";
import { hallSkyUniforms as sky } from "./hall-sky-runtime.js";
import { MeshBuilder, vec, type V3 } from "./mesh-builder.js";
import type { HallSun } from "./hall-sun.js";

export const STREET_LIGHT_URL = "/rooms/grand-hall/context-2020-lidar/street-light-v2.bin?r=1";
export const STREET_LAMPS_URL = "/rooms/grand-hall/context-2020-lidar/street-lamps-v2.json?r=1";

/** Coordinates outside this box mean a malformed file, metres (as the city model's). */
const COORDINATE_LIMIT = 320;

// ---------------------------------------------------------------- switching

/**
 * When the street lamps light: each at its own sun altitude between `lowest`
 * and `highest` (degrees, the sun's true altitude), over `ramp` either side.
 */
export const LAMP_SWITCH = { lowest: -3.6, highest: -2.4, ramp: 0.15 } as const;

function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A lamp's light, 0–1, for the sun's true altitude: what the shaders' `lampOn` computes. */
export function lampLight(sunAltitude: number, switchAltitude: number): number {
  return smoothstepNumber(switchAltitude + LAMP_SWITCH.ramp, switchAltitude - LAMP_SWITCH.ramp, sunAltitude);
}

/**
 * Dusk on the card: from 1.5° to 4.5° of sun below the horizon the city's
 * light from the sky falls to the look's dusk share (night-looks.ts), before
 * the night's own light takes over from −3° to −10°. Above −1.5° the day's
 * light is untouched.
 */
export const DUSK_SPAN = { from: -1.5, to: -4.5 } as const;

/** Dusk's share, 0–1, for the sun's true altitude: what the shaders' `duskShare` computes. */
export function duskShareAt(sunAltitude: number): number {
  return smoothstepNumber(DUSK_SPAN.from, DUSK_SPAN.to, sunAltitude);
}

/** Whether any street lamp is lit (or lighting) at this sun altitude. */
export function anyLampLit(sunAltitude: number): boolean {
  return sunAltitude < LAMP_SWITCH.highest + LAMP_SWITCH.ramp;
}

// ---------------------------------------------------------------- the look

const color = (rgb: Rgb): Color => new Color(rgb[0], rgb[1], rgb[2]);

/** A look's values as the shaders read them. */
function lookValues(look: StreetNightLook) {
  return {
    colors: {
      domeGlow: color(look.domeGlow),
      wallLit: color(look.ambient?.wallLit ?? [0, 0, 0]),
      wallShadow: color(look.ambient?.wallShadow ?? [0, 0, 0]),
      roof: color(look.ambient?.roof ?? [0, 0, 0]),
      ground: color(look.ambient?.ground ?? [0, 0, 0]),
      poolCore: color(look.pool.core),
      poolEdge: color(look.pool.edge),
      /** The pool's rim: its edge tinted by the look's rim. */
      poolRim: color([look.pool.edge[0] * look.pool.rim[0], look.pool.edge[1] * look.pool.rim[1], look.pool.edge[2] * look.pool.rim[2]]),
      scallop: color(look.scallop),
      beam: color(look.beam.color),
      lens: color(look.lens),
      halo: color(look.halo),
      windowWarm: color(look.windows.warm),
      windowCool: color(look.windows.cool),
      windowMagenta: color(look.windows.magenta),
      windowCyan: color(look.windows.cyan),
      facadeOffice: color(look.facades.office),
      facadeHome: color(look.facades.home),
      facadePub: color(look.facades.pub),
      facadeBar: color(look.facades.bar),
      facadeGlassGreen: color(look.facades.glassGreen),
      facadeSignTeal: color(look.facades.signTeal),
      facadeSignViolet: color(look.facades.signViolet),
      facadeSignGreen: color(look.facades.signGreen),
    },
    numbers: {
      hazeReach: look.hazeReach,
      duskWall: look.dusk.wall,
      duskRoof: look.dusk.roof,
      duskAir: look.dusk.air,
      /** 1 when the look lights the card itself at night, 0 to keep the sky's own ambient. */
      ambientWeight: look.ambient === null ? 0 : 1,
      lampsOn: look.lamps ? 1 : 0,
      poolRadius: look.pool.radius,
      poolSoftness: look.pool.softness,
      scallopReach: look.scallopReach,
      beamReach: look.beam.reach,
      windowShare: look.windows.share,
      windowNearShare: look.windows.nearShare,
      windowCoolShare: look.windows.coolShare,
      windowMagentaShare: look.windows.magentaShare,
      windowCyanShare: look.windows.cyanShare,
      /** A fixed light for windows too small to see, or −1 to take it from the share, pane and brightness. */
      windowAverage: look.windows.average ?? -1,
      facadeOfficeShare: look.facades.officeShare,
      facadeHomeShare: look.facades.homeShare,
      facadeCurtainShare: look.facades.curtainShare,
      facadeCurtain: look.facades.curtain,
      facadeSpill: look.facades.spill,
    },
    pane: new Vector4(...look.windows.pane),
    brightness: new Vector2(...look.windows.brightness),
  };
}

type LookValues = ReturnType<typeof lookValues>;

function lookUniforms(values: LookValues) {
  const c = values.colors;
  const n = values.numbers;
  return {
    domeGlow: uniform(c.domeGlow), wallLit: uniform(c.wallLit), wallShadow: uniform(c.wallShadow), roof: uniform(c.roof),
    ground: uniform(c.ground), poolCore: uniform(c.poolCore), poolEdge: uniform(c.poolEdge), poolRim: uniform(c.poolRim),
    scallop: uniform(c.scallop), beam: uniform(c.beam), lens: uniform(c.lens), halo: uniform(c.halo),
    windowWarm: uniform(c.windowWarm), windowCool: uniform(c.windowCool), windowMagenta: uniform(c.windowMagenta),
    windowCyan: uniform(c.windowCyan),
    facadeOffice: uniform(c.facadeOffice), facadeHome: uniform(c.facadeHome), facadePub: uniform(c.facadePub), facadeBar: uniform(c.facadeBar),
    facadeGlassGreen: uniform(c.facadeGlassGreen), facadeSignTeal: uniform(c.facadeSignTeal), facadeSignViolet: uniform(c.facadeSignViolet),
    facadeSignGreen: uniform(c.facadeSignGreen),
    hazeReach: uniform(n.hazeReach), duskWall: uniform(n.duskWall), duskRoof: uniform(n.duskRoof), duskAir: uniform(n.duskAir),
    ambientWeight: uniform(n.ambientWeight), lampsOn: uniform(n.lampsOn),
    poolRadius: uniform(n.poolRadius), poolSoftness: uniform(n.poolSoftness), scallopReach: uniform(n.scallopReach), beamReach: uniform(n.beamReach),
    windowShare: uniform(n.windowShare), windowNearShare: uniform(n.windowNearShare), windowCoolShare: uniform(n.windowCoolShare),
    windowMagentaShare: uniform(n.windowMagentaShare), windowCyanShare: uniform(n.windowCyanShare),
    windowAverage: uniform(n.windowAverage),
    facadeOfficeShare: uniform(n.facadeOfficeShare), facadeHomeShare: uniform(n.facadeHomeShare),
    facadeCurtainShare: uniform(n.facadeCurtainShare), facadeCurtain: uniform(n.facadeCurtain), facadeSpill: uniform(n.facadeSpill),
    windowPane: uniform(values.pane),
    windowBrightness: uniform(values.brightness),
  };
}

/** The night look's values, read by the city, the sky and the lamps. */
export const streetLookUniforms = lookUniforms(lookValues(activeStreetNightLook()));

/** Shows another night look: values only, nothing recompiles. */
export function applyStreetLook(look: StreetNightLook): void {
  const values = lookValues(look);
  const u = streetLookUniforms;
  for (const [key, value] of Object.entries(values.colors) as [keyof LookValues["colors"], Color][]) u[key].value.copy(value);
  for (const [key, value] of Object.entries(values.numbers) as [keyof LookValues["numbers"], number][]) u[key].value = value;
  u.windowPane.value.copy(values.pane);
  u.windowBrightness.value.copy(values.brightness);
}

// ---------------------------------------------------------------- the light maps

/** The baked light maps' header and texels (street-light-v2.bin). */
export interface StreetLightField {
  readonly size: number;
  /** The warp's scale and the maps' reach from the hall's centre, metres. */
  readonly warp: number;
  readonly extent: number;
  /** The pool distance's range, 0..poolRange m, and the head offset's, ±headRange m. */
  readonly poolRange: number;
  readonly headRange: number;
  /** Heights and feet: yMin..yMax as 1..255. */
  readonly yMin: number;
  readonly yMax: number;
  /** Switching altitudes, degrees: switchMin..switchMax as 0..255. */
  readonly switchMin: number;
  readonly switchMax: number;
  /** The door lanterns' pools against the street lamps', and every pool's stretch along the street. */
  readonly doorPoolScale: number;
  readonly poolStretch: number;
  readonly lampCount: number;
  /** size × size RGBA8 each, row by row from z = −extent, each row from x = −extent. */
  readonly poolTexels: Uint8Array;
  readonly headTexels: Uint8Array;
}

const LIGHT_MAGIC = [0x56, 0x56, 0x53, 0x4c] as const; // "VVSL"
const LIGHT_VERSION = 2;
const LIGHT_HEADER_BYTES = 56;

function fail(reason: string): never {
  throw new Error(`Grand Hall street light: ${reason}`);
}

function within(value: number, low: number, high: number, name: string): number {
  if (!Number.isFinite(value) || value < low || value > high) fail(`${name} ${String(value)} outside ${String(low)}..${String(high)}`);
  return value;
}

/** Reads the packed light maps, rejecting anything malformed. */
export function parseStreetLight(buffer: ArrayBuffer): StreetLightField {
  if (buffer.byteLength < LIGHT_HEADER_BYTES) fail("truncated header");
  const view = new DataView(buffer);
  if (LIGHT_MAGIC.some((byte, i) => view.getUint8(i) !== byte)) fail("not a street light map");
  const version = view.getUint32(4, true);
  if (version !== LIGHT_VERSION) fail(`version ${String(version)}`);
  const size = view.getUint32(8, true);
  if (size < 1 || size > 2048 || (size & (size - 1)) !== 0) fail(`size ${String(size)}`);
  const mapBytes = size * size * 4;
  const expected = LIGHT_HEADER_BYTES + mapBytes * 2;
  if (buffer.byteLength !== expected) fail(`${String(buffer.byteLength)} bytes, expected ${String(expected)}`);
  const f = (offset: number): number => view.getFloat32(offset, true);
  const warp = within(f(12), 1, COORDINATE_LIMIT, "warp");
  const extent = within(f(16), 1, COORDINATE_LIMIT, "extent");
  const poolRange = within(f(20), 1, 64, "pool range");
  const headRange = within(f(24), 1, 64, "head range");
  const yMin = within(f(28), -COORDINATE_LIMIT, COORDINATE_LIMIT, "lowest height");
  const yMax = within(f(32), yMin + 1, COORDINATE_LIMIT, "highest height");
  // The lamps light within dusk, never by day nor after it.
  const switchMin = within(f(36), LAMP_SWITCH.lowest, LAMP_SWITCH.highest, "earliest switching");
  const switchMax = within(f(40), switchMin, LAMP_SWITCH.highest, "latest switching");
  const doorPoolScale = within(f(44), 0.05, 1, "door pool scale");
  const poolStretch = within(f(48), 1, 4, "pool stretch");
  const lampCount = within(view.getUint32(52, true), 0, 10_000, "lamp count");
  return {
    size, warp, extent, poolRange, headRange, yMin, yMax, switchMin, switchMax, doorPoolScale, poolStretch, lampCount,
    poolTexels: new Uint8Array(buffer, LIGHT_HEADER_BYTES, mapBytes),
    headTexels: new Uint8Array(buffer, LIGHT_HEADER_BYTES + mapBytes, mapBytes),
  };
}

/** The maps' texture coordinate (0..1) of a coordinate along x or z, metres. */
export function warpCoordinate(x: number, field: Pick<StreetLightField, "warp" | "extent">): number {
  return (Math.asinh(x / field.warp) / Math.asinh(field.extent / field.warp) + 1) / 2;
}

/** The coordinate, metres, at a texture coordinate: warpCoordinate's inverse. */
export function unwarpCoordinate(u: number, field: Pick<StreetLightField, "warp" | "extent">): number {
  return field.warp * Math.sinh((u * 2 - 1) * Math.asinh(field.extent / field.warp));
}

/** The maps' frame in the shader: the warp, the maps' size and their channels' ranges. */
export const streetLightFieldUniforms = {
  warp: uniform(60),
  /** 1 / asinh(extent / warp). */
  warpScale: uniform(1 / Math.asinh(260 / 60)),
  size: uniform(1),
  poolRange: uniform(24),
  headRange: uniform(16),
  yMin: uniform(-6),
  ySpan: uniform(32),
  switchMin: uniform(-3.6),
  switchSpan: uniform(1.2),
};

type StreetLightFrame = Omit<StreetLightField, "poolTexels" | "headTexels">;

/** Points the shader's frame at loaded maps. */
export function applyStreetLightField(field: StreetLightFrame): void {
  const u = streetLightFieldUniforms;
  u.warp.value = field.warp;
  u.warpScale.value = 1 / Math.asinh(field.extent / field.warp);
  u.size.value = field.size;
  u.poolRange.value = field.poolRange;
  u.headRange.value = field.headRange;
  u.yMin.value = field.yMin;
  u.ySpan.value = field.yMax - field.yMin;
  u.switchMin.value = field.switchMin;
  u.switchSpan.value = field.switchMax - field.switchMin;
}

/** The frame of the one-texel "no lamp" maps. */
const NO_LAMP_FIELD: StreetLightFrame = {
  size: 1, warp: 60, extent: 260, poolRange: 24, headRange: 16, yMin: -6, yMax: 26, switchMin: -3.6, switchMax: -2.4,
  doorPoolScale: 0.4, poolStretch: 1.3, lampCount: 0,
};

/** Points the shader's frame back at the "no lamp" maps. */
export function resetStreetLightField(): void {
  applyStreetLightField(NO_LAMP_FIELD);
}

function poolTexture(texels: Uint8Array, size: number): DataTexture {
  const map = new DataTexture(texels, size, size, RGBAFormat, UnsignedByteType);
  // Trilinear and anisotropic, so pool edges stay crisp near and smooth far, and along the street.
  map.anisotropy = 8;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.colorSpace = NoColorSpace;
  map.flipY = false;
  map.needsUpdate = true;
  return map;
}

function headTexture(texels: Uint8Array, size: number): DataTexture {
  // Read texel by texel: a filtered offset would blend two lamps' heads into one between them.
  const map = new DataTexture(texels, size, size, RGBAFormat, UnsignedByteType);
  map.minFilter = NearestFilter;
  map.magFilter = NearestFilter;
  map.generateMipmaps = false;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.colorSpace = NoColorSpace;
  map.flipY = false;
  map.needsUpdate = true;
  return map;
}

/** The two maps as textures. */
export function createStreetLightTextures(field: StreetLightField): { pool: DataTexture; head: DataTexture } {
  const pool = poolTexture(field.poolTexels, field.size);
  pool.name = "grand-hall-street-pools";
  const head = headTexture(field.headTexels, field.size);
  head.name = "grand-hall-street-heads";
  return { pool, head };
}

/**
 * One texel of each map saying "no lamp here" (no pool within range, no
 * head), in the real maps' formats and filters, so the city compiles once
 * against them and the real maps, when they arrive, only change the textures
 * bound.
 */
export function createNoLampTextures(): { pool: DataTexture; head: DataTexture } {
  const pool = poolTexture(new Uint8Array([255, 0, 0, 0]), 1);
  pool.name = "grand-hall-street-pools-none";
  const head = headTexture(new Uint8Array([0, 128, 128, 0]), 1);
  head.name = "grand-hall-street-heads-none";
  return { pool, head };
}

/** The texture nodes every read of the maps goes through; set their values to swap the maps. */
export interface StreetLightMaps {
  readonly pool: TextureNode;
  readonly head: TextureNode;
}

export function createStreetLightMaps(): StreetLightMaps {
  const none = createNoLampTextures();
  return { pool: texture(none.pool), head: texture(none.head) };
}

/** What the light maps say at a world position: the pool there and the nearest head. */
export function streetLightAt(maps: StreetLightMaps, p: Node<"vec3">) {
  const u = streetLightFieldUniforms;
  const xz = vec2(p.x, p.z);
  // asinh(x / w) as log((x + r) / w), r = √(x² + w²): r also gives the warp's slope.
  const r = sqrt(xz.mul(xz).add(u.warp.mul(u.warp)));
  const at = log(xz.add(r).div(u.warp)).mul(u.warpScale).mul(0.5).add(0.5);
  const pool = texture(maps.pool, at);
  const rho = pool.r.mul(u.poolRange);
  const poolSwitch = pool.g.mul(u.switchSpan).add(u.switchMin);
  const poolFoot = pool.b.mul(255).sub(1).div(254).mul(u.ySpan).add(u.yMin);
  // The head's texel, read exactly; its centre from the point itself and the
  // warp's slope there (within a few millimetres across a texel), plus the
  // texel's exact offset, whichever side of the texel the point stands.
  const cell = clamp(floor(at.mul(u.size)), 0, u.size.sub(1));
  const texel = textureLoad(maps.head, ivec2(cell));
  const centre = xz.add(cell.add(0.5).div(u.size).sub(at).mul(r).mul(2).div(u.warpScale));
  const headXz = centre.add(texel.gb.mul(2).sub(1).mul(u.headRange));
  const headY = texel.a.mul(255).sub(1).div(254).mul(u.ySpan).add(u.yMin);
  const hasHead = step(0.5 / 255, texel.a);
  const headSwitch = texel.r.mul(u.switchSpan).add(u.switchMin);
  return { rho, poolSwitch, poolFoot, poolStrength: pool.a, head: vec3(headXz.x, headY, headXz.y), hasHead, headSwitch };
}

// ---------------------------------------------------------------- card light

/** Dusk's share now, 0–1 (duskShareAt's twin): one node, so a material works it out once. */
export const duskShare: Node<"float"> = smoothstep(DUSK_SPAN.from, DUSK_SPAN.to, sky.sunAltitude);

/**
 * The light on the white card model at a point with normal `n`: the sun by
 * day and the moon by night through the city's shadow map, the sky's light,
 * and after dusk the night look's: walls facing the city's glow (the moon, or
 * George Square's lamps) a dusky violet, walls away from it darker, roofs and
 * ground their own. Through dusk the sky's light on the card falls first
 * (DUSK_SPAN), walls most, so the blocks stand darker than the sky before the
 * night's light comes. Shared by the city and the lamp fittings.
 */
export function cardLight(n: Node<"vec3">, shadowFactor: Node<"float">, ground: Node<"float">): Node<"vec3"> {
  const look = streetLookUniforms;
  const nightCard = sky.night.mul(look.ambientWeight);
  const facing = max(dot(n, sky.lightDirection), 0);
  const daylight = sky.sunColor.mul(sky.sunStrength).mul(1.1);
  // Under the night look the moon's own light gives way to the look's: it
  // still models the blocks, at a third of its strength.
  const moonlight = sky.moonColor.mul(sky.moonStrength).mul(1.6).mul(mix(float(1), float(0.35), nightCard));
  const direct = daylight.add(moonlight).mul(facing).mul(shadowFactor);
  // The sky's light, brightest from above, and the sun's warmth bounced up
  // from the streets onto the walls.
  const skyLight = mix(sky.horizonAway, sky.zenith, 0.45);
  const bounce = vec3(0.6, 0.46, 0.33).mul(sky.sunStrength).mul(0.5);
  const cap = smoothstep(0.7, 0.9, n.y);
  const dusk = mix(float(1), mix(look.duskWall, look.duskRoof, cap), duskShare);
  const dayAmbient = mix(bounce.add(skyLight.mul(0.5)), skyLight.mul(0.95), n.y.mul(0.5).add(0.5)).mul(dusk);
  const glowSide = smoothstep(-0.55, 0.75, dot(vec2(n.x, n.z), vec2(sky.nightGlowDirection.x, sky.nightGlowDirection.z)));
  const wall = mix(look.wallShadow, look.wallLit, glowSide);
  const nightAmbient = mix(mix(wall, look.roof, cap), look.ground, ground.mul(cap));
  return direct.add(mix(dayAmbient, nightAmbient, nightCard));
}

/**
 * How far the air reaches (metres to about two thirds thick) for the sun now:
 * 230 m by day, thickening to 100 m round sunset for golden hour's layers of
 * haze, clearing again as the sun sinks 4° below the horizon (the low air is
 * in the earth's shadow and lit only by the sky), and the night look's after.
 */
function airReach(): Node<"float"> {
  const sunUp = sky.sunDirection.y;
  const golden = smoothstep(0.42, 0.0, sunUp).mul(smoothstep(-0.07, 0.0, sunUp));
  return mix(mix(float(230), float(100), golden), streetLookUniforms.hazeReach, sky.night);
}

/** The air's share between the camera and a point `distance` metres away, with the reach scaled by `reachScale`. */
export function airAt(distance: Node<"float">, reachScale: number): Node<"float"> {
  return float(1).sub(exp(max(distance.sub(16), 0).div(airReach().mul(reachScale).negate())));
}

/**
 * The air between the camera and a point: how much of it there is (`air`
 * with distance, `edge` at the model's rim, `amount` the two together) and
 * its colour.
 */
export function cardHaze(p: Node<"vec3">) {
  const look = streetLookUniforms;
  const toCamera = cameraPosition.sub(p);
  const distance = length(toCamera);
  const view = toCamera.negate().div(max(distance, 1e-4));
  const air = airAt(distance, 1);
  const edge = smoothstep(170, 255, length(vec2(p.x, p.z)));
  const flatSun = normalize(vec3(sky.sunDirection.x, 0, sky.sunDirection.z).add(vec3(1e-4, 0, 0)));
  const flatView = normalize(vec3(view.x, 0, view.z).add(vec3(1e-4, 0, 0)));
  // Clamped: rounding can take the dot of opposed unit vectors just past -1,
  // and pow of a negative base is undefined on the GPU (NaN).
  const horizon = mix(sky.horizonAway, sky.horizonSun, pow(clamp(dot(flatSun, flatView).mul(0.5).add(0.5), 0, 1), 2.2));
  const toward = pow(max(dot(view, sky.sunDirection), 0), 6);
  const dayColor = horizon.mul(0.94).add(sky.glow.mul(sky.glowStrength).mul(toward).mul(0.6));
  // At night the model's far edge dissolves into the skyline's colour (the
  // horizon and the city's glow, as the sky below the horizon is), while the
  // air between turns a dimmer violet, so even distant blocks stay darker than
  // the sky behind them. Through dusk the air between dims first, by the
  // look's dusk share. By day the two are the same.
  const night = sky.night.mul(look.ambientWeight);
  const duskAir = mix(float(1), look.duskAir, duskShare);
  const airColor = mix(dayColor.mul(duskAir), horizon.add(look.domeGlow.mul(0.5)), night);
  const edgeColor = mix(dayColor, horizon.add(look.domeGlow), night);
  const thick = air.mul(0.88);
  const amount = max(thick, edge);
  const color = mix(airColor, edgeColor, edge.div(thick.add(edge).add(1e-4)));
  return { air, edge, amount, color, distance };
}

/**
 * A screen-space dither of about ±3% at night (interleaved gradient noise,
 * fixed per pixel so it never crawls): about one 8-bit step at the dark
 * violet's display level, enough to keep its gradients from banding.
 */
export function nightDither(): Node<"float"> {
  const noise = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
  return noise.sub(0.5).mul(0.06).mul(sky.night).add(1);
}

/** Whether a lamp switching at `switchAltitude` is lit, 0–1, for the sun's true altitude now (lampLight's twin). */
export function lampOn(switchAltitude: Node<"float">): Node<"float"> {
  return smoothstep(switchAltitude.add(LAMP_SWITCH.ramp), switchAltitude.sub(LAMP_SWITCH.ramp), sky.sunAltitude).mul(streetLookUniforms.lampsOn);
}

/** Light pools on the ground at a point `rho` metres from a pool's centre (street lamps' own scale). */
export function poolLight(rho: Node<"float">): { mask: Node<"float">; color: Node<"vec3"> } {
  const look = streetLookUniforms;
  const r = rho.div(look.poolRadius);
  const w = r.fwidth().mul(0.75);
  const inner = float(1).sub(max(look.poolSoftness, w));
  const mask = float(1).sub(r.mul(r).mul(0.3)).mul(smoothstep(w.add(1), inner, r)).max(0);
  const body = mix(look.poolCore, look.poolEdge, smoothstep(0.35, 1, r));
  // The last few per cent toward crimson, as the references' pool rims.
  const rim = mix(body, look.poolRim, smoothstep(0.86, 0.95, r));
  return { mask, color: rim };
}

// ---------------------------------------------------------------- the lamps

export type StreetLampKind = "bracket" | "column" | "door";
export type StreetLampHeightSource = "facade-photo" | "lidar" | "default" | "model-wall";
/**
 * Whether the lamp's fitting is drawn: "cut" where the hall's section cuts its
 * wall or column away, "low-wall" where the model drew its wall too low to
 * carry it. Either way its light stays.
 */
export type StreetLampFitting = "drawn" | "cut" | "low-wall";

export interface StreetLamp {
  readonly id: string;
  readonly objectid: number | null;
  readonly kind: StreetLampKind;
  /** The lantern's centre in the hall's frame, metres. */
  readonly head: readonly [number, number, number];
  readonly footY: number;
  /** The lamp's throw, a horizontal unit vector (x, z): out from its wall, or away from the nearest building. */
  readonly heading: readonly [number, number];
  /** The bracket's or arm's reach from its wall or pole, metres. */
  readonly reach: number;
  readonly fitting: StreetLampFitting;
  readonly heightSource: StreetLampHeightSource;
  /** The sun's true altitude at which it lights, degrees. */
  readonly switchAltitude: number;
}

const coordinate = z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT);
const unitComponent = z.number().finite().min(-1.001).max(1.001);

const lampSchema = z.object({
  id: z.string().regex(/^(gcc:\d{1,9}|trades-hall:[a-z-]{1,40})$/u),
  objectid: z.number().int().positive().nullable(),
  source: z.enum(["gcc-ogl", "facade-survey"]),
  kind: z.enum(["bracket", "column", "door"]),
  head: z.tuple([coordinate, coordinate, coordinate]),
  foot_y: coordinate,
  heading: z.tuple([unitComponent, unitComponent]).refine(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 0.01, "is not a unit vector"),
  reach: z.number().finite().min(0).max(5),
  fitting: z.enum(["drawn", "cut", "low-wall"]),
  height_source: z.enum(["facade-photo", "lidar", "default", "model-wall"]),
  switch_altitude: z.number().finite().min(LAMP_SWITCH.lowest).max(LAMP_SWITCH.highest),
  snap_shift: z.number().finite().min(0).max(60),
}).strict();

const lampsSchema = z.object({
  schema: z.literal("venviewer.street-light.v2"),
  licence: z.object({ attribution: z.string().min(1), licence: z.literal("Open Government Licence v3.0") }),
  counts: z.object({
    lamps: z.number().int().nonnegative(),
    bracket: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    door: z.number().int().nonnegative(),
  }),
  lamps: z.array(lampSchema).max(10_000),
});

/** Reads the lamp table, checking it against itself and against the light maps it was baked with. */
export function parseStreetLamps(json: unknown, field: Pick<StreetLightField, "lampCount">): StreetLamp[] {
  const parsed = lampsSchema.safeParse(json);
  if (!parsed.success) {
    fail(`lamp table: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  const { counts, lamps } = parsed.data;
  if (lamps.length !== counts.lamps || lamps.length !== field.lampCount) {
    fail(`${String(lamps.length)} lamps, the table counts ${String(counts.lamps)} and the map ${String(field.lampCount)}`);
  }
  for (const kind of ["bracket", "column", "door"] as const) {
    const found = lamps.filter((lamp) => lamp.kind === kind).length;
    if (found !== counts[kind]) fail(`${String(found)} ${kind}s, the table counts ${String(counts[kind])}`);
  }
  if (new Set(lamps.map((lamp) => lamp.id)).size !== lamps.length) fail("a lamp id twice");
  return lamps.map((lamp) => ({
    id: lamp.id,
    objectid: lamp.objectid,
    kind: lamp.kind,
    head: lamp.head,
    footY: lamp.foot_y,
    heading: lamp.heading,
    reach: lamp.reach,
    fitting: lamp.fitting,
    heightSource: lamp.height_source,
    switchAltitude: lamp.switch_altitude,
  }));
}

/** The lamps whose fittings are drawn: all but those the model cannot carry (their light stays). */
export function drawnLamps(lamps: readonly StreetLamp[]): StreetLamp[] {
  return lamps.filter((lamp) => lamp.fitting === "drawn");
}

/**
 * The fittings, modelled from our station-145 panorama of Glassford Street:
 * the council's flat paddle lantern (about 0.65 × 0.28 × 0.07 m) on a short
 * arm, either from a 0.5 m wall plate (rising about 12°) or from a pole. Trades
 * Hall's door lanterns are small boxes, 0.256 m wide (facade survey), under a
 * cap, their panes glowing more softly than a street lantern.
 */
export const FITTING = {
  head: [0.65, 0.07, 0.28],
  plate: [0.03, 0.5, 0.14],
  armRise: 12,
  armThickness: 0.05,
  poleRadius: [0.085, 0.06],
  poleSegments: 8,
  door: { width: 0.256, height: 0.59, bracket: 0.3, cap: [0.32, 0.05, 0.32], pane: 0.45 },
} as const;

/** One lamp's frame: its throw (`out`), the horizontal across it (`side`) and up. */
function lampFrame(lamp: StreetLamp): { out: V3; side: V3; up: V3 } {
  const out: V3 = [lamp.heading[0], 0, lamp.heading[1]];
  const up: V3 = [0, 1, 0];
  return { out, side: vec.normalize(vec.cross(up, out)), up };
}

/** A box with any orientation: centre, three unit axes and their full lengths. Its faces point outward. */
function orientedBox(
  builder: MeshBuilder, centre: V3, axes: readonly [V3, V3, V3], size: readonly [number, number, number],
  onFace?: (axis: number, sign: number) => void,
): void {
  for (let axis = 0; axis < 3; axis++) {
    const a = axes[axis];
    const b = axes[(axis + 1) % 3];
    const c = axes[(axis + 2) % 3];
    const ha = (size[axis] ?? 0) / 2;
    const hb = (size[(axis + 1) % 3] ?? 0) / 2;
    const hc = (size[(axis + 2) % 3] ?? 0) / 2;
    if (a === undefined || b === undefined || c === undefined) continue;
    for (const sign of [1, -1]) {
      onFace?.(axis, sign);
      const face = vec.add(centre, vec.scale(a, ha * sign));
      const corner = (s: number, t: number): V3 => vec.add(face, vec.add(vec.scale(b, hb * s), vec.scale(c, hc * t)));
      builder.quadFacing(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), [0, 0], [1, 0], [1, 1], [0, 1], vec.scale(a, sign));
    }
  }
}

/** A tapered pole, open at both ends, from `base` up `height` metres. */
function pole(builder: MeshBuilder, base: V3, height: number, radii: readonly [number, number], segments: number): void {
  const ring = (y: number, r: number): number[] => Array.from({ length: segments + 1 }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    const normal: V3 = [Math.cos(angle), 0, Math.sin(angle)];
    return builder.vertex([base[0] + normal[0] * r, base[1] + y, base[2] + normal[2] * r], normal, [i / segments, y]);
  });
  const bottom = ring(0, radii[0]);
  const top = ring(height, radii[1]);
  for (let i = 0; i < segments; i++) {
    const a = bottom[i]; const b = bottom[i + 1]; const c = top[i + 1]; const d = top[i];
    if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
    builder.triangle(a, c, b);
    builder.triangle(a, d, c);
  }
}

/** A square arm from `from` to `to`. */
function armBetween(builder: MeshBuilder, from: V3, to: V3, side: V3): void {
  const along = vec.sub(to, from);
  const span = Math.hypot(along[0], along[1], along[2]);
  if (span < 1e-3) return;
  const axis = vec.scale(along, 1 / span);
  const normal = vec.normalize(vec.cross(side, axis));
  orientedBox(builder, vec.add(from, vec.scale(along, 0.5)), [axis, normal, side], [span, FITTING.armThickness, FITTING.armThickness]);
}

/**
 * Every drawn lamp's fitting, merged into one mesh for one draw. Each vertex
 * carries `lens` (how brightly it glows: 1 on a street lantern's underside, a
 * door lantern's panes softer, 0 on card) and `switchAltitude`, its lamp's.
 * Every lit face is a whole quad, its uv 0..1, so the shader can leave it a
 * card frame.
 */
export function buildFittingGeometry(lamps: readonly StreetLamp[]): BufferGeometry {
  const state = { lens: 0, switchAltitude: -3 };
  const builder = new MeshBuilder({
    extraSize: 2,
    extra: () => [state.lens, state.switchAltitude],
    extraLayout: [{ name: "lens", size: 1 }, { name: "switchAltitude", size: 1 }],
  });
  const [headLength, headThickness, headWidth] = FITTING.head;
  for (const lamp of drawnLamps(lamps)) {
    state.switchAltitude = lamp.switchAltitude;
    state.lens = 0;
    const { out, side, up } = lampFrame(lamp);
    const head: V3 = [lamp.head[0], lamp.head[1], lamp.head[2]];
    if (lamp.kind === "door") {
      // The lantern: four softly lit panes between a card base and a wider card cap, on a short bracket.
      const { width, height, bracket, cap, pane } = FITTING.door;
      orientedBox(builder, head, [out, up, side], [width, height, width], (axis) => { state.lens = axis === 1 ? 0 : pane; });
      state.lens = 0;
      orientedBox(builder, vec.add(head, [0, height / 2 + cap[1] / 2, 0]), [out, up, side], cap);
      const arm = bracket - width / 2;
      orientedBox(builder, vec.add(head, vec.add(vec.scale(out, -(width / 2 + arm / 2)), [0, height * 0.3, 0])), [out, up, side],
        [arm, FITTING.armThickness, FITTING.armThickness]);
      continue;
    }
    // The paddle, its underside the lens.
    orientedBox(builder, head, [out, up, side], [headLength, headThickness, headWidth], (axis, sign) => { state.lens = axis === 1 && sign < 0 ? 1 : 0; });
    state.lens = 0;
    const innerEnd = vec.add(head, vec.scale(out, -headLength / 2));
    if (lamp.kind === "bracket") {
      // The wall plate at the wall, and the arm rising from it to the paddle.
      const wallPoint = vec.add(head, vec.scale(out, -lamp.reach));
      const rise = Math.tan((FITTING.armRise * Math.PI) / 180) * (lamp.reach - headLength / 2);
      const root = vec.add(wallPoint, [0, -rise, 0]);
      orientedBox(builder, vec.add(root, vec.scale(out, FITTING.plate[0] / 2)), [out, up, side], FITTING.plate);
      armBetween(builder, root, innerEnd, side);
    } else {
      // A pole behind the lantern by its arm's reach, and the arm across to it.
      const poleBase = vec.add([lamp.head[0], lamp.footY, lamp.head[2]], vec.scale(out, -lamp.reach));
      pole(builder, poleBase, lamp.head[1] + 0.06 - lamp.footY, FITTING.poleRadius, FITTING.poleSegments);
      armBetween(builder, [poleBase[0], lamp.head[1] + 0.03, poleBase[2]], innerEnd, side);
    }
  }
  const geometry = builder.build();
  geometry.boundingSphere = streetBoundingSphere();
  return geometry;
}

/** The light's cone in the air: open, 16 segments, 35° half-angle, leaning 15° along the throw. */
export const BEAM = { segments: 16, halfAngle: 35, lean: 15 } as const;

/**
 * The cones under every drawn street lamp, merged into one mesh. Each vertex
 * carries `along`, 0 at the lens and 1 where the cone's axis meets the lamp's
 * ground, `switchAltitude`, its lamp's, and `apex`, its lens, where the vertex
 * shader folds a cone that is out of reach or unlit so it draws no pixel.
 * Door lanterns throw none.
 */
export function buildBeamGeometry(lamps: readonly StreetLamp[]): BufferGeometry {
  const state = { along: 0, switchAltitude: -3, apex: [0, 0, 0] as V3 };
  const builder = new MeshBuilder({
    extraSize: 5,
    extra: () => [state.along, state.switchAltitude, state.apex[0], state.apex[1], state.apex[2]],
    extraLayout: [{ name: "along", size: 1 }, { name: "switchAltitude", size: 1 }, { name: "apex", size: 3 }],
  });
  const lean = (BEAM.lean * Math.PI) / 180;
  const half = (BEAM.halfAngle * Math.PI) / 180;
  for (const lamp of drawnLamps(lamps)) {
    if (lamp.kind === "door") continue;
    state.switchAltitude = lamp.switchAltitude;
    const { out, side } = lampFrame(lamp);
    const axis = vec.normalize([out[0] * Math.sin(lean), -Math.cos(lean), out[2] * Math.sin(lean)]);
    const across = vec.normalize(vec.cross(axis, side));
    const apex: V3 = [lamp.head[0], lamp.head[1] - FITTING.head[1] / 2, lamp.head[2]];
    state.apex = apex;
    const reach = Math.max(0.5, (apex[1] - lamp.footY) / Math.cos(lean));
    const radius = reach * Math.tan(half);
    const end = vec.add(apex, vec.scale(axis, reach));
    const rimAt = (k: number): { rim: V3; normal: V3 } => {
      const angle = (k / BEAM.segments) * Math.PI * 2;
      const outward = vec.add(vec.scale(side, Math.cos(angle)), vec.scale(across, Math.sin(angle)));
      return {
        rim: vec.add(end, vec.scale(outward, radius)),
        normal: vec.normalize(vec.sub(vec.scale(outward, Math.cos(half)), vec.scale(axis, Math.sin(half)))),
      };
    };
    for (let i = 0; i < BEAM.segments; i++) {
      const a = rimAt(i);
      const b = rimAt(i + 1);
      state.along = 0;
      const top = builder.vertex(apex, rimAt(i + 0.5).normal, [0.5, 0]);
      state.along = 1;
      const left = builder.vertex(a.rim, a.normal, [0, 1]);
      const right = builder.vertex(b.rim, b.normal, [1, 1]);
      builder.triangle(top, right, left);
    }
  }
  const geometry = builder.build();
  geometry.boundingSphere = streetBoundingSphere();
  return geometry;
}

/** Each drawn lamp's halo: where its lens is and when it lights, one instance each. */
export function haloInstances(lamps: readonly StreetLamp[]): { heads: Float32Array; switchAltitudes: Float32Array; count: number } {
  const drawn = drawnLamps(lamps);
  const heads = new Float32Array(drawn.length * 3);
  const switchAltitudes = new Float32Array(drawn.length);
  drawn.forEach((lamp, index) => {
    heads.set([lamp.head[0], lamp.head[1] - (lamp.kind === "door" ? 0 : FITTING.head[1] / 2), lamp.head[2]], index * 3);
    switchAltitudes[index] = lamp.switchAltitude;
  });
  return { heads, switchAltitudes, count: drawn.length };
}

/**
 * The halos' own geometry: three's sprite quad (centred, uv 0..1) with each
 * lamp's lens and switching altitude as per-instance attributes, so disposing
 * it frees every buffer the halos use (three's shared sprite quad is never
 * disposed).
 */
export function buildHaloGeometry(lamps: readonly StreetLamp[]): BufferGeometry {
  const instances = haloInstances(lamps);
  const geometry = new BufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setAttribute("haloHead", new InstancedBufferAttribute(instances.heads, 3));
  geometry.setAttribute("haloSwitch", new InstancedBufferAttribute(instances.switchAltitudes, 1));
  geometry.boundingSphere = streetBoundingSphere();
  return geometry;
}

/** A bounding sphere for everything the lamps draw: the whole model's reach. */
export function streetBoundingSphere(): Sphere {
  return new Sphere(new Vector3(0, 10, 0), COORDINATE_LIMIT + 40);
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** White card, as the city's caps (sRGB 0.93, 0.9, 0.85, linearised). */
const CARD_WHITE = [linear(0.93), linear(0.9), linear(0.85)] as const;

/**
 * A street lantern's lens seen from below: dark seen side-on (the cosine of
 * the angle from straight down at most the first value) and full from the
 * second (about 66° from straight down) and under.
 */
export const LENS_CUT_OFF = [0.02, 0.4] as const;

/** A lit face's glow across its uv: the pane, inside a thin card frame. */
function paneMask(): Node<"float"> {
  const at = uv();
  const frame = 0.12;
  return smoothstep(0, frame, at.x).mul(smoothstep(1, 1 - frame, at.x)).mul(smoothstep(0, frame, at.y)).mul(smoothstep(1, 1 - frame, at.y));
}

/**
 * The fittings' material: white card lit as the city is (a dark violet
 * silhouette by night), fading into the same haze, with the lens lit once its
 * lamp is. Fittings cast no shadows.
 */
export function createFittingMaterial(sun: HallSun): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.colorNode = Fn(() => {
    const p = positionWorld;
    const albedo = vec3(...CARD_WHITE);
    const lit = albedo.mul(cardLight(normalize(normalWorld), sun.factor, float(0)));
    const haze = cardHaze(p);
    const body = mix(lit, haze.color, haze.amount);
    const glow = attribute<"float">("lens", "float");
    // A street lantern's full cut-off optic sends its light down, none above
    // the horizontal: seen from the side its lens dims, so a far lantern seen
    // nearly edge-on reads as a warm line under its halo rather than a hot
    // dash a pixel thick that the anti-aliasing cannot hold still. A door
    // lantern's panes (lens under 1) glow every way.
    const n = normalize(normalWorld);
    const sideOn = smoothstep(LENS_CUT_OFF[0], LENS_CUT_OFF[1], dot(n, normalize(cameraPosition.sub(p))));
    const cutOff = mix(float(1), sideOn, step(0.99, glow));
    const lens = streetLookUniforms.lens.mul(glow).mul(paneMask()).mul(cutOff)
      .mul(lampOn(attribute<"float">("switchAltitude", "float")))
      .mul(float(1).sub(airAt(haze.distance, 1.6)));
    return vec4(body.add(lens).mul(nightDither()), 1);
  })();
  material.name = "grand-hall-street-lamps";
  return material;
}

/**
 * Additive light in a pass with other targets: the scene pass blends only its
 * colour, and every other target takes what a surface writes. Left alone, a
 * cone would write its own normal, and the half-size ambient occlusion,
 * upsampled, would draw a dark line round every cone and halo. So the light
 * writes a normal facing the camera with no occlusion weight: the surface
 * behind it keeps its colour, without occlusion there and without noise.
 * `output` keeps the colour where the pass has no other targets; velocity
 * is the light's own. Both discard the pixels they add nothing to, so they
 * overwrite the other targets only where they shine.
 */
export function lightOnlyOutput() {
  return mrt({ output, normal: vec4(0.5, 0.5, 1, 0) });
}

/**
 * The cones' material: additive, depth-tested, both faces at half strength.
 * A cone whose lens is `range` metres or more from the camera, or whose lamp
 * is dark, folds to its lens in the vertex shader and draws nothing; its fade
 * with distance and the air in front of it are worked out once a vertex.
 */
export function createBeamMaterial(range: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const apex = attribute<"vec3">("apex", "vec3");
  const apexWorld = modelWorldMatrix.mul(vec4(apex, 1)).xyz;
  const apexDistance = length(cameraPosition.sub(apexWorld));
  const on = lampOn(attribute<"float">("switchAltitude", "float"));
  material.positionNode = select(apexDistance.lessThan(range).and(on.greaterThan(0.001)), positionLocal, apex);
  // Per cone, in the vertex shader: lit, near enough, and seen through the air.
  const fade = vertexStage(on.mul(smoothstep(range, range * 0.75, apexDistance)).mul(float(1).sub(airAt(apexDistance, 1.6))));
  material.colorNode = Fn(() => {
    const look = streetLookUniforms;
    const toCamera = cameraPosition.sub(positionWorld);
    const distance = length(toCamera);
    const t = attribute<"float">("along", "float").div(max(look.beamReach, 0.05));
    Discard(t.greaterThanEqual(1));
    const down = pow(float(1).sub(clamp(t, 0, 1)), 1.5);
    const edgeOn = pow(abs(dot(normalize(normalWorld), toCamera.div(max(distance, 1e-4)))), 1.5);
    const near = smoothstep(1.5, 4, distance);
    return vec4(look.beam.mul(down.mul(edgeOn).mul(0.5).mul(near).mul(fade)), 1);
  })();
  material.mrtNode = lightOnlyOutput();
  material.name = "grand-hall-street-beams";
  return material;
}

/**
 * The halos (on buildHaloGeometry): a soft point on each lit lantern at least
 * 0.9 m across and 3 pixels on screen (`pixelAngle`, the angle a CSS pixel
 * spans, set each frame), drawn 0.6 m toward the camera so the wall behind
 * does not cut it, fully bright from the street and at a third from the high
 * orbit so the hall stays the brightest thing in view.
 */
export function createHaloMaterial(pixelAngle: Node<"float">): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const head = attribute<"vec3">("haloHead", "vec3");
  const switchAltitude = attribute<"float">("haloSwitch", "float");
  const toCamera = cameraPosition.sub(head);
  const distance = length(toCamera);
  material.positionNode = head.add(toCamera.div(max(distance, 1e-4)).mul(0.6));
  // A dark lantern's halo folds to nothing in the vertex shader.
  const on = lampOn(switchAltitude);
  const size = max(float(0.9), distance.mul(pixelAngle).mul(3)).mul(step(0.001, on));
  material.scaleNode = vec2(size, size);
  // Per lantern, in the vertex shader: lit, seen from below or above, through the air.
  const fromAbove = mix(float(1), float(0.35), smoothstep(0.0, 0.6, toCamera.y.div(max(distance, 1e-4))));
  const strength = vertexStage(fromAbove.mul(float(1).sub(airAt(distance, 1.6))).mul(on));
  material.colorNode = Fn(() => {
    const r = length(uv().sub(0.5)).mul(2);
    Discard(r.greaterThanEqual(1));
    const profile = exp(r.mul(r).mul(-5)).mul(smoothstep(1, 0.7, r));
    return vec4(streetLookUniforms.halo.mul(profile.mul(strength)), 1);
  })();
  material.mrtNode = lightOnlyOutput();
  material.name = "grand-hall-street-halos";
  return material;
}

/** A geometry's triangle count. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return index === null ? geometry.getAttribute("position").count / 3 : index.count / 3;
}
