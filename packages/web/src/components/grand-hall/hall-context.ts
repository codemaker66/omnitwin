// ---------------------------------------------------------------------------
// The city around the Grand Hall
//
// An architect's contour model of the Merchant City, 260 m round Trades Hall:
// stacked flat layers every 3 m of height, taken from the Scottish LiDAR
// Phase 5 50 cm DSM alone (2020; Crown copyright Scottish Government and
// Fugro, OGL v3.0), in the hall's own frame (tools/grand-hall-survey/context,
// public/rooms/grand-hall/context-2020-lidar/merchant-city-v2.json). The
// hall's own block is sectioned at its floor, so the cut-away room sits in
// its building's footing with Glassford Street and the blocks across it
// beyond its windows.
//
// It is drawn as white card, the way a model maker would: warm ivory caps,
// a shade darker walls, a little darker still at the foot of each wall,
// lit by the real sun or moon with its own shadow map (the hall casts into it
// too), and dissolving into the sky's haze with distance so the model's edge
// is never seen. After dusk the card turns the night look's dark violet
// (lib/sky/night-looks.ts), its skyline brighter than its blocks so every
// building stands as a silhouette, its windows light up at random and steady,
// and the council's street lamps (hall-street-light.ts) lay amber pools on
// the pavements and a warm scallop on the wall under each lantern.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry, FrontSide, Sphere, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn, If, abs, cameraPosition, cross, dFdx, dFdy, dot, float, floor, fract, fwidth, hash, length, max, mix, normalize,
  positionWorld, sign, smoothstep, step, vec2, vec3, vec4,
} from "three/tsl";
import { hallSkyUniforms as u } from "./hall-sky-runtime.js";
import { HALL_PAVEMENT_Y } from "./hall-site.js";
import {
  LAMP_SWITCH, cardHaze, cardLight, lampOn, nightDither, poolLight, streetLightAt, streetLookUniforms, type StreetLightMaps,
} from "./hall-street-light.js";
import type { HallSun } from "./hall-sun.js";

export const CONTEXT_MODEL_URL = "/rooms/grand-hall/context-2020-lidar/merchant-city-v2.bin?r=2";

/** The model's reach from the hall's centre, metres. */
export const CONTEXT_RADIUS = 260;

/**
 * The model's cut-out for the hall (build_context.py rect_half_x, rect_front_z,
 * rect_half_z): nothing is emitted for |x| <= halfX between the street face and
 * the back, and the site's caps at the floor's level start at its edge. The
 * street face is the window wall's outer face (z -6.245, its 0.95 m from the
 * room's plane), on the model's centimetre grid 5 mm under the wall's foot.
 */
export const CITY_SITE_CUT = { halfX: 11.2, front: -6.24, back: 5.95 } as const;

const MAGIC = [0x56, 0x56, 0x43, 0x58] as const; // "VVCX"
const HEADER_BYTES = 16;
/** Coordinates outside this box mean a malformed file, metres. */
export const CONTEXT_COORDINATE_LIMIT = 320;

/**
 * The city's windows: a grid `width` m along each wall and a storey high,
 * starting `firstStorey` m above the pavement. Each window draws its values
 * from whole-number hash seeds made from its cell, its storey and its block
 * (`blockWidth` m wide), raised clear of zero by `offset` and spaced `stride`
 * apart, one seed per value. three's hash reads its seed as an unsigned
 * integer: a negative seed reads as 0, and a fraction added to a seed reads as
 * the same integer. Within the reader's limit every seed is below 2^24, where
 * a float holds whole numbers exactly.
 */
export const CITY_WINDOWS = {
  width: 2.1,
  storey: 3.2,
  firstStorey: 3.6,
  across: 613,
  blockWidth: 9,
  block: 7919,
  offset: 1_000_000,
  stride: 4,
} as const;

function fail(reason: string): never {
  throw new Error(`Grand Hall city model: ${reason}`);
}

/** Reads the packed contour model, rejecting anything malformed. */
export function parseContextModel(buffer: ArrayBuffer): BufferGeometry {
  if (buffer.byteLength < HEADER_BYTES) fail("truncated header");
  const view = new DataView(buffer);
  if (MAGIC.some((byte, i) => view.getUint8(i) !== byte)) fail("not a city model");
  const version = view.getUint32(4, true);
  if (version !== 1) fail(`version ${String(version)}`);
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  if (vertexCount === 0 || indexCount === 0 || indexCount % 3 !== 0) fail(`${String(vertexCount)} vertices, ${String(indexCount)} indices`);
  const vertexBytes = vertexCount * 6;
  const indexOffset = HEADER_BYTES + vertexBytes;
  const expected = indexOffset + indexCount * 4;
  if (buffer.byteLength !== expected) fail(`${String(buffer.byteLength)} bytes, expected ${String(expected)}`);
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) {
    const value = view.getInt16(HEADER_BYTES + i * 2, true) / 100;
    if (Math.abs(value) > CONTEXT_COORDINATE_LIMIT) fail(`coordinate ${String(value)} m`);
    positions[i] = value;
  }
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    const index = view.getUint32(indexOffset + i * 4, true);
    if (index >= vertexCount) fail(`index ${String(index)} past ${String(vertexCount)} vertices`);
    indices[i] = index;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.boundingSphere = new Sphere(new Vector3(0, 20, 0), CONTEXT_RADIUS + 60);
  return geometry;
}

/**
 * White card: caps, walls, the ground between them, and the warmer, deeper
 * face of the site where it is cut at the hall's floor (sRGB, linearised below).
 * The hall's Atelier section (hall-beyond.ts) cuts its own card from these.
 */
export const CARD = {
  cap: [0.93, 0.9, 0.85],
  wall: [0.86, 0.82, 0.76],
  ground: [0.76, 0.73, 0.68],
  section: [0.78, 0.72, 0.64],
} as const;

/** The sectioned site's reach (the builder's clamp), metres. */
const SITE_RADIUS = 45.5;

/** Lit windows: the night look's near share within this distance of the hall's centre, its full share beyond the far one, metres. */
const WINDOW_NEAR = 30;
const WINDOW_FAR = 110;

/**
 * The sun's true altitude, degrees, below which the city's windows and street
 * lamps can add light: the first lamp's switching begins here, and the
 * windows only from −3° (the city's night).
 */
export const NIGHT_WORK_BELOW = LAMP_SWITCH.highest + LAMP_SWITCH.ramp;

/** The night's own light on the pavement, which a pool's light already includes. */
const POOL_AMBIENT = 0.03;
/** A pool's light seen from 24 m or more above it, against from the street. */
const POOL_OVERVIEW = 0.5;
/** A full cut-off lantern's cone: 60° each side of straight down. */
const SCALLOP_HALF_ANGLE = Math.PI / 3;
/** A pool lies on its lamp's own ground: within this of its foot, metres (the model's levels are 3 m apart). */
const POOL_LEVEL = 0.5;
/** The height a pool's light climbs the walls beside it, metres. */
const SPILL_HEIGHT = 2;
/** The share of a pool's light on the foot of the walls beside it. */
const SPILL = 0.35;

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const card = (rgb: readonly [number, number, number]) => vec3(linear(rgb[0]), linear(rgb[1]), linear(rgb[2]));

/** The city's colour: lit card under the real sky, windows and street lamps at night, haze with distance. */
function cityColor(sun: HallSun, maps: StreetLightMaps) {
  return Fn(() => {
    const look = streetLookUniforms;
    const p = positionWorld;
    // Flat faces: the normal from the surface's own slope, turned to the camera.
    const toCamera = normalize(cameraPosition.sub(p));
    const raw = normalize(cross(dFdx(p), dFdy(p)));
    const n = raw.mul(sign(dot(raw, toCamera)).add(0.0001)).toVar();
    const cap = smoothstep(0.7, 0.9, n.y);
    const ground = step(p.y, float(HALL_PAVEMENT_Y + 0.05));
    const radial = length(vec2(p.x, p.z));
    // Caps cut at the hall's floor across the site read as the cut they are.
    const section = cap.mul(step(p.y.abs(), 0.06)).mul(step(radial, SITE_RADIUS));
    const albedo = mix(mix(mix(card(CARD.wall), card(CARD.cap), cap), card(CARD.ground), ground), card(CARD.section), section).toVar();
    // The foot of each wall a little darker, as a model's corners are.
    const heightAbove = p.y.sub(HALL_PAVEMENT_Y);
    const foot = mix(smoothstep(0.0, 9.0, heightAbove).mul(0.28).add(0.72), float(1), cap);
    // The sun by day and the moon by night through the city's own shadow map,
    // the sky's light, and after dusk the night look's (cardLight).
    const lit = albedo.mul(cardLight(n, sun.factor, ground)).mul(foot).toVar();

    // Windows and street lamps add light only after dusk (no window is lit
    // above 3° of sun below the horizon, no lamp above 2.25°), so by day the
    // city skips them: a branch on a uniform, which every fragment takes
    // alike, so the light maps and derivatives inside it stay legal.
    If(u.sunAltitude.lessThan(NIGHT_WORK_BELOW), () => {
      // After dusk some windows are lit, small, each its own brightness, mostly
      // warm and a few in the night look's accents; few near the hall, so the
      // facades it looks onto stay calm, more toward the city (by the distance
      // from the hall, never from the camera, so nothing flickers in an orbit).
      // Where a window would be smaller than a pixel its light is averaged in.
      const wall = float(1).sub(cap).mul(float(1).sub(ground));
      const along = normalize(vec3(n.z.negate(), 0, n.x).add(vec3(1e-4, 0, 0)));
      const windows = CITY_WINDOWS;
      const cellU = dot(vec2(p.x, p.z), vec2(along.x, along.z)).div(windows.width);
      const cellV = heightAbove.sub(windows.firstStorey).div(windows.storey);
      const cell = floor(vec2(cellU, cellV));
      const local = fract(vec2(cellU, cellV));
      // Whether it is lit, how brightly, its tint and its accent: four whole-number seeds.
      const seed = cell.x.add(cell.y.mul(windows.across)).add(floor(p.x.add(p.z).div(windows.blockWidth)).mul(windows.block))
        .add(windows.offset).mul(windows.stride);
      const bounds = look.windowPane;
      const pane = smoothstep(bounds.x.sub(0.02), bounds.x.add(0.02), local.x).mul(smoothstep(bounds.y.add(0.02), bounds.y.sub(0.02), local.x))
        .mul(smoothstep(bounds.z.sub(0.03), bounds.z.add(0.03), local.y)).mul(smoothstep(bounds.w.add(0.03), bounds.w.sub(0.03), local.y));
      const share = mix(look.windowNearShare, look.windowShare, smoothstep(WINDOW_NEAR, WINDOW_FAR, radial));
      const brightness = look.windowBrightness;
      const on = step(hash(seed), share).mul(hash(seed.add(1)).mul(brightness.y).add(brightness.x));
      const accent = hash(seed.add(3));
      const magenta = float(1).sub(step(look.windowMagentaShare, accent));
      const cyan = step(look.windowMagentaShare, accent).mul(float(1).sub(step(look.windowMagentaShare.add(look.windowCyanShare), accent)));
      const base = mix(look.windowWarm, look.windowCool, step(float(1).sub(look.windowCoolShare), hash(seed.add(2))));
      const tint = mix(mix(base, look.windowMagenta, magenta), look.windowCyan, cyan);
      const resolved = float(1).sub(smoothstep(0.2, 0.55, fwidth(cellU)));
      const paneArea = bounds.y.sub(bounds.x).mul(bounds.w.sub(bounds.z));
      const average = mix(share.mul(paneArea).mul(brightness.x.add(brightness.y.mul(0.5))), look.windowAverage, step(0, look.windowAverage));
      const glow = mix(average, pane.mul(on), resolved);
      lit.addAssign(tint.mul(glow).mul(wall).mul(step(0, cellV)).mul(u.night));

      // The street lamps, each lit at its own sun altitude: pools on the ground
      // each lamp stands on (never a roof or the site's cut), a scallop on the
      // wall under each lantern (where its full cut-off cone, 60° each side of
      // straight down, meets the wall), and a little of each pool's light up
      // the foot of the walls beside it.
      const light = streetLightAt(maps, p);
      const aboveFoot = p.y.sub(light.poolFoot);
      const street = cap.mul(float(1).sub(section)).mul(smoothstep(POOL_LEVEL, POOL_LEVEL * 0.6, abs(aboveFoot)));
      const pool = poolLight(light.rho);
      // Seen from high over the city the pools calm, as the lanterns' halos do,
      // so the hall stays the brightest thing in an overview.
      const overview = mix(float(1), float(POOL_OVERVIEW), smoothstep(8, 24, cameraPosition.y.sub(p.y)));
      const poolLit = max(pool.color.sub(POOL_AMBIENT), 0).mul(pool.mask).mul(overview).mul(light.poolStrength).mul(lampOn(light.poolSwitch));
      const below = light.head.y.sub(p.y);
      const toHead = light.head.sub(p);
      const across = length(vec2(toHead.x, toHead.z));
      const coneEdge = below.mul(Math.tan(SCALLOP_HALF_ANGLE)).sub(across);
      const coneWidth = fwidth(coneEdge).mul(0.75).add(0.03);
      const cone = smoothstep(coneWidth.negate(), coneWidth, coneEdge);
      const reach = length(toHead).div(look.scallopReach);
      const facing = smoothstep(0.0, 0.35, dot(vec2(n.x, n.z), vec2(toHead.x, toHead.z).div(max(across, 1e-3))));
      const wallSide = float(1).sub(cap);
      const scallop = look.scallop.mul(cone).mul(float(1).div(reach.mul(reach).add(1))).mul(facing).mul(light.hasHead).mul(lampOn(light.headSwitch));
      // The pool's light up the foot of the walls beside it, from its own ground.
      const spill = poolLit.mul(smoothstep(SPILL_HEIGHT, 0, aboveFoot)).mul(smoothstep(-0.3, 0, aboveFoot)).mul(SPILL);
      lit.addAssign(albedo.mul(poolLit.mul(street).add(scallop.add(spill).mul(wallSide))));
    });

    // The air between the eye and each block: it fills with the sky's
    // horizon colour with distance, more thickly when the sun is low, and
    // glows toward the sun, so a backlit city at golden hour stands in
    // layers of warm haze; at night it is the skyline's violet. The model's
    // far edge always dissolves.
    const haze = cardHaze(p);
    return vec4(mix(lit, haze.color, haze.amount).mul(nightDither()), 1);
  })();
}

/**
 * The city's visible material: lit in its own shader, never a shadow caster
 * itself. `maps` are the street lamps' light maps (createStreetLightMaps), "no
 * lamp" until the bake arrives.
 */
export function createContextMaterial(sun: HallSun, maps: StreetLightMaps): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.colorNode = cityColor(sun, maps);
  material.name = "grand-hall-city";
  return material;
}

/** The city's shadow stand-in (drawn only by the sun's shadow cameras). */
export function createContextCasterMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.colorNode = vec4(0, 0, 0, 1);
  material.name = "grand-hall-city-caster";
  return material;
}
