// ---------------------------------------------------------------------------
// The sky over the Grand Hall
//
// One inverted sphere around the camera, drawn first and behind everything,
// coloured per pixel from the live sky (hall-sky-runtime.ts):
//
// - the palette's gradient from horizon to zenith, warmer on the sun's side;
// - a glow around the sun, widest near the horizon at golden hour;
// - the sun's disc, limb-darkened and bright enough for the pipeline's bloom;
// - the moon, a lit sphere: its normal is rebuilt across the disc and lit by
//   the real sun's direction, so its phase and the tilt of its crescent are
//   always right, with soft maria and a whisper of earthshine;
// - stars after dusk, one per few hundred sky cells, steady (no twinkle: the
//   planner never animates on its own), thinning into the city's glow along
//   the night horizon, the night look's violet (lib/sky/night-looks.ts).
//
// Branches skip the stars by day and the moon outside its disc, so a phone
// pays little more than the gradient.
// ---------------------------------------------------------------------------

import { BackSide, SphereGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn, If, cameraPosition, clamp, cross, dot, exp, float, floor, fract, fwidth, hash, length, max, mix,
  mx_noise_float, normalize, positionWorld, pow, smoothstep, sqrt, step, vec3, vec4,
} from "three/tsl";
import { hallSkyUniforms as u } from "./hall-sky-runtime.js";
import { nightDither, streetLookUniforms } from "./hall-street-light.js";

/** Radius of the sky sphere, metres (within the camera's far plane). */
export const SKY_DOME_RADIUS = 600;
/** Angular radii, radians: the sun a little larger than life so it reads on a phone; the moon more so. */
const SUN_RADIUS = 0.0062;
const MOON_RADIUS = 0.0088;
/** Star seeds wrap below this before spreading to one per value (2^21). */
const STAR_SEED_WRAP = 2_097_152;

export function createSkyDomeGeometry(): SphereGeometry {
  return new SphereGeometry(SKY_DOME_RADIUS, 48, 24);
}

const skyColor = Fn(() => {
  const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
  const up = dir.y;
  const sun = u.sunDirection;

  // Gradient: the horizon warmer on the sun's side, blue overhead.
  const flatSun = normalize(vec3(sun.x, 0, sun.z).add(vec3(1e-4, 0, 0)));
  const flatDir = normalize(vec3(dir.x, 0, dir.z).add(vec3(1e-4, 0, 0)));
  // Clamped: rounding can take the dot of opposed unit vectors just past -1,
  // and pow of a negative base is undefined on the GPU (NaN).
  const sunSide = pow(clamp(dot(flatSun, flatDir).mul(0.5).add(0.5), 0, 1), 2.2);
  const horizon = mix(u.horizonAway, u.horizonSun, sunSide);
  // Under the night look the skyline's band reaches higher, so from the
  // street the blocks stand dark against a lighter sky, as in the references.
  const nightAir = u.night.mul(streetLookUniforms.ambientWeight);
  const height = pow(clamp(up, 0, 1), mix(float(0.42), float(0.9), nightAir));
  const sky = mix(horizon, u.zenith, height).toVar();
  // Seen past the ground's edge: the horizon's haze, darkening by day; at
  // night it stays the skyline's colour, the colour the city's haze turns, so
  // the model's edge dissolves into it seen from above.
  sky.assign(mix(sky, horizon.mul(mix(float(0.6), float(1), nightAir)), smoothstep(0.0, -0.18, up)));

  // The glow around the sun.
  const cosSun = dot(dir, sun);
  const c = max(cosSun, 0);
  const glow = pow(c, 5).mul(0.35).add(pow(c, 40).mul(0.7)).add(pow(c, 500).mul(1.6));
  sky.addAssign(u.glow.mul(u.glowStrength).mul(glow).mul(mix(1.0, 0.55, height)));

  // The city's glow under a night sky: the night look's (hall-street-light.ts),
  // strongest along the skyline and, under the look, climbing a third of the
  // way up, so the blocks stand dark against it.
  sky.addAssign(streetLookUniforms.domeGlow.mul(u.night).mul(exp(max(up, 0).mul(mix(float(-7), float(-2.5), nightAir)))));

  // Stars: a few cells in a hundred hold one, at a fixed place in the cell.
  If(u.stars.greaterThan(0.001).and(up.greaterThan(0)), () => {
    const p = dir.mul(110).add(120);
    const cell = floor(p);
    // A whole number below 2^24 (each cell index lies in 10..230).
    const seed = cell.x.add(cell.y.mul(241)).add(cell.z.mul(58081));
    // Each star's place, brightness and tint from seeds of their own: three's
    // hash reads its seed as an unsigned integer, so a fraction added to the
    // seed reads as the same one. Wrapped below 2^21 and spaced eight apart,
    // these stay below 2^24 too, where a float holds whole numbers exactly.
    const values = seed.mod(STAR_SEED_WRAP).mul(8);
    const offset = vec3(hash(values.add(1)), hash(values.add(2)), hash(values.add(3))).sub(0.5).mul(0.7);
    const d = length(fract(p).sub(0.5).sub(offset));
    const r = float(0.055);
    // At least about a pixel wide, dimmed to keep its light: no shimmer.
    const w = max(fwidth(d), 0.0001);
    const star = smoothstep(r.add(w), r.sub(w), d).mul(r.div(max(r, w)));
    const magnitude = pow(hash(values.add(4)), 5).mul(2.4).add(0.25);
    const tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.72), hash(values.add(5)));
    const shown = step(0.972, hash(seed)).mul(u.stars).mul(smoothstep(0.03, 0.3, up));
    sky.addAssign(tint.mul(star).mul(magnitude).mul(shown));
  });

  // The sun's disc, limb-darkened, set behind the horizon.
  const sunAngle = sqrt(max(float(1).sub(cosSun.mul(cosSun)), 0));
  const sunDisc = smoothstep(SUN_RADIUS * 1.12, SUN_RADIUS * 0.88, sunAngle).mul(step(0, cosSun));
  const limb = sqrt(max(float(1).sub(pow(sunAngle.div(SUN_RADIUS), 2)), 0));
  const sunBright = max(u.sunStrength, 0.08).mul(26).mul(mix(0.55, 1.0, limb));
  sky.addAssign(u.sunColor.mul(sunDisc).mul(sunBright).mul(smoothstep(-0.012, 0.004, up)));

  // The moon: a sphere lit by the sun, its dark side faintly earthlit.
  const moon = u.moonDirection;
  If(dot(dir, moon).greaterThan(Math.cos(MOON_RADIUS * 1.3)), () => {
    const right = normalize(cross(moon, vec3(0, 1, 0)).add(vec3(0, 0, 1e-4)));
    const upward = cross(right, moon);
    const px = dot(dir, right).div(MOON_RADIUS);
    const py = dot(dir, upward).div(MOON_RADIUS);
    const r2 = px.mul(px).add(py.mul(py));
    const normal = right.mul(px).add(upward.mul(py)).sub(moon.mul(sqrt(max(float(1).sub(r2), 0))));
    const lit = smoothstep(-0.04, 0.12, dot(normal, sun));
    const maria = smoothstep(0.1, 0.55, mx_noise_float(normal.mul(2.2)).mul(0.5).add(0.5));
    const albedo = mix(1.0, 0.7, maria);
    const w = max(fwidth(r2), 0.0001);
    const disc = smoothstep(float(1).add(w), float(1).sub(w), r2).mul(smoothstep(-0.01, 0.01, up));
    // Pale by day, bright at night.
    const brightness = mix(0.5, 1.7, u.stars.div(0.85));
    const face = vec3(0.96, 0.94, 0.89).mul(lit.mul(albedo).mul(brightness).add(0.018));
    sky.assign(mix(sky, sky.mul(0.82).add(face), disc));
  });

  // At night a dither of a step or so keeps the dark gradient from banding.
  return vec4(sky.mul(nightDither()), 1);
});

/** The sky's material: unlit, behind everything, never writing depth. */
export function createSkyDomeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  material.colorNode = skyColor();
  material.name = "grand-hall-sky";
  return material;
}
