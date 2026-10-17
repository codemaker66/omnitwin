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
// is never seen. After dusk its windows light up, warm and a few cool, at
// random and steady.
// ---------------------------------------------------------------------------

import { BufferAttribute, BufferGeometry, FrontSide, Sphere, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn, cameraPosition, clamp, cross, dFdx, dFdy, dot, exp, float, floor, fract, fwidth, hash, length, max, mix, normalize,
  positionWorld, pow, sign, smoothstep, step, vec2, vec3, vec4,
} from "three/tsl";
import { hallSkyUniforms as u } from "./hall-sky-runtime.js";
import { HALL_PAVEMENT_Y } from "./hall-site.js";
import type { HallSun } from "./hall-sun.js";

export const CONTEXT_MODEL_URL = "/rooms/grand-hall/context-2020-lidar/merchant-city-v2.bin?r=1";

/** The model's reach from the hall's centre, metres. */
export const CONTEXT_RADIUS = 260;

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
 */
const CARD = {
  cap: [0.93, 0.9, 0.85],
  wall: [0.86, 0.82, 0.76],
  ground: [0.76, 0.73, 0.68],
  section: [0.78, 0.72, 0.64],
} as const;

/** The sectioned site's reach (the builder's clamp), metres. */
const SITE_RADIUS = 45.5;

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const card = (rgb: readonly [number, number, number]) => vec3(linear(rgb[0]), linear(rgb[1]), linear(rgb[2]));

/** The city's colour: lit card under the real sky, windows at night, haze with distance. */
function cityColor(sun: HallSun) {
  return Fn(() => {
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
    const albedo = mix(mix(mix(card(CARD.wall), card(CARD.cap), cap), card(CARD.ground), ground), card(CARD.section), section);
    // The foot of each wall a little darker, as a model's corners are.
    const heightAbove = p.y.sub(HALL_PAVEMENT_Y);
    const foot = mix(smoothstep(0.0, 9.0, heightAbove).mul(0.28).add(0.72), float(1), cap);

    // Direct light, the sun by day and the moon by night, through the city's
    // own shadow map, each at its own strength.
    const facing = max(dot(n, u.lightDirection), 0);
    const daylight = u.sunColor.mul(u.sunStrength).mul(1.1);
    const moonlight = u.moonColor.mul(u.moonStrength).mul(1.6);
    const direct = daylight.add(moonlight).mul(facing).mul(sun.factor);
    // The sky's light, brightest from above, and the sun's warmth bounced
    // up from the streets onto the walls.
    const sky = mix(u.horizonAway, u.zenith, 0.45);
    const bounce = vec3(0.6, 0.46, 0.33).mul(u.sunStrength).mul(0.5);
    const ambient = mix(bounce.add(sky.mul(0.5)), sky.mul(0.95), n.y.mul(0.5).add(0.5));
    const lit = albedo.mul(direct.add(ambient)).mul(foot).toVar();

    // After dusk about one window in seven is lit, small, mostly warm and each
    // its own brightness;
    // where a window would be smaller than a pixel its light is averaged in.
    const wall = float(1).sub(cap).mul(float(1).sub(ground));
    const along = normalize(vec3(n.z.negate(), 0, n.x).add(vec3(1e-4, 0, 0)));
    const windows = CITY_WINDOWS;
    const cellU = dot(vec2(p.x, p.z), vec2(along.x, along.z)).div(windows.width);
    const cellV = heightAbove.sub(windows.firstStorey).div(windows.storey);
    const cell = floor(vec2(cellU, cellV));
    const local = fract(vec2(cellU, cellV));
    // Whether it is lit, how brightly and its tint: three whole-number seeds.
    const seed = cell.x.add(cell.y.mul(windows.across)).add(floor(p.x.add(p.z).div(windows.blockWidth)).mul(windows.block))
      .add(windows.offset).mul(windows.stride);
    const pane = smoothstep(0.38, 0.42, local.x).mul(smoothstep(0.62, 0.58, local.x))
      .mul(smoothstep(0.34, 0.4, local.y)).mul(smoothstep(0.68, 0.62, local.y));
    const on = step(hash(seed), 0.14).mul(hash(seed.add(1)).mul(0.65).add(0.35));
    const tint = mix(vec3(1.0, 0.66, 0.36), vec3(0.8, 0.86, 1.0), step(0.86, hash(seed.add(2))));
    const resolved = float(1).sub(smoothstep(0.2, 0.55, fwidth(cellU)));
    const glow = mix(float(0.012), pane.mul(on), resolved);
    lit.addAssign(tint.mul(glow).mul(wall).mul(step(0, cellV)).mul(u.cityGlow).mul(0.6));

    // The air between the eye and each block: it fills with the sky's
    // horizon colour with distance, more thickly when the sun is low, and
    // glows toward the sun, so a backlit city at golden hour stands in
    // layers of warm haze. The model's far edge always dissolves.
    const view = toCamera.negate();
    const distance = length(p.sub(cameraPosition));
    const lowSun = smoothstep(0.42, 0.0, u.sunDirection.y);
    const reach = mix(float(230), float(100), lowSun);
    const air = float(1).sub(exp(max(distance.sub(16), 0).div(reach.negate())));
    const edge = smoothstep(170, 255, radial);
    const haze = max(air.mul(0.88), edge);
    const flatSun = normalize(vec3(u.sunDirection.x, 0, u.sunDirection.z).add(vec3(1e-4, 0, 0)));
    const flatView = normalize(vec3(view.x, 0, view.z).add(vec3(1e-4, 0, 0)));
    // Clamped: rounding can take the dot of opposed unit vectors just past
    // -1, and pow of a negative base is undefined on the GPU (NaN).
    const horizon = mix(u.horizonAway, u.horizonSun, pow(clamp(dot(flatSun, flatView).mul(0.5).add(0.5), 0, 1), 2.2));
    const toward = pow(max(dot(view, u.sunDirection), 0), 6);
    const hazeColor = horizon.mul(0.94).add(u.glow.mul(u.glowStrength).mul(toward).mul(0.6));
    return vec4(mix(lit, hazeColor, haze), 1);
  })();
}

/** The city's visible material: lit in its own shader, never a shadow caster itself. */
export function createContextMaterial(sun: HallSun): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.colorNode = cityColor(sun);
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
