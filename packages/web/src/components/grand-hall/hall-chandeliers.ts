// ---------------------------------------------------------------------------
// The hall's five chandeliers
//
// As photographed (the 11 July panoramas, 8K): gilt brass fittings of
// acanthus scrollwork carrying bare round globes. The great chandelier under
// the dome hangs in three tiers of arms (8, 12 and 16 globes) round a turned
// baluster stem; the four on the ceiling roses carry two tiers (6 and 10).
// Each arm is an S-scroll out from the stem ending in a cast cup and globe,
// with a C-curl at its elbow and acanthus leaves where it springs and bends.
//
// Each style is built once around its own origin and copied into place, so
// all five draw in two calls: the gilt and the globes. Globe positions are
// returned for whatever wants to light from them.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { MeshBuilder, vec, type V2, type V3 } from "./mesh-builder.js";
import { HALL_CHANDELIERS, type ChandelierStyle, type HallChandelier } from "./hall-spec.js";

export type ChandelierPart = "frame" | "bulb";

export interface ChandelierSet {
  readonly geometries: ReadonlyMap<ChandelierPart, BufferGeometry>;
  /** World positions of every globe. */
  readonly bulbs: readonly V3[];
  readonly triangles: number;
}

interface PartBuilders {
  readonly frame: MeshBuilder;
  readonly bulb: MeshBuilder;
}

/** A point on a cubic Bézier curve in the (radius, height) plane. */
function bezier(p0: V2, p1: V2, p2: V2, p3: V2, t: number): V2 {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** A point of the (radius, height) plane turned to `angle` about the stem. */
function radial(point: V2, angle: number, centre: V3): V3 {
  return [centre[0] + Math.cos(angle) * point[0], centre[1] + point[1], centre[2] + Math.sin(angle) * point[0]];
}

/**
 * An acanthus leaf: a curled blade with lobed edges, double sided. `along`
 * points from base to tip, `out` is the side the blade's face looks to.
 */
function acanthus(frame: MeshBuilder, base: V3, along: V3, out: V3, length: number, width: number): void {
  const axis = vec.normalize(along);
  const face = vec.normalize(out);
  const side = vec.normalize(vec.cross(axis, face));
  const steps = 7;
  const left: number[] = [];
  const right: number[] = [];
  const spine: number[] = [];
  const backLeft: number[] = [];
  const backRight: number[] = [];
  const backSpine: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // The blade curls outward toward its tip.
    const curl = Math.sin(t * Math.PI * 0.5) * length * 0.35;
    const centre = vec.add(vec.add(base, vec.scale(axis, t * length)), vec.scale(face, curl));
    const lobes = 1 + 0.32 * Math.max(0, Math.sin(t * Math.PI * 5));
    const half = width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)), 0.75) * lobes;
    // The edges stand forward of the spine, cupping the leaf.
    const cup = vec.scale(face, half * 0.35);
    const l = vec.add(vec.add(centre, vec.scale(side, half)), cup);
    const r = vec.add(vec.sub(centre, vec.scale(side, half)), cup);
    const normal = vec.normalize(vec.add(face, vec.scale(axis, -0.3)));
    const back = vec.scale(normal, -1);
    left.push(frame.vertex(l, normal, [0, t]));
    right.push(frame.vertex(r, normal, [1, t]));
    spine.push(frame.vertex(centre, normal, [0.5, t]));
    backLeft.push(frame.vertex(l, back, [0, t]));
    backRight.push(frame.vertex(r, back, [1, t]));
    backSpine.push(frame.vertex(centre, back, [0.5, t]));
  }
  for (let i = 0; i < steps; i++) {
    const [l0, l1, s0, s1, r0, r1] = [left[i], left[i + 1], spine[i], spine[i + 1], right[i], right[i + 1]];
    const [bl0, bl1, bs0, bs1, br0, br1] = [backLeft[i], backLeft[i + 1], backSpine[i], backSpine[i + 1], backRight[i], backRight[i + 1]];
    if (l0 === undefined || l1 === undefined || s0 === undefined || s1 === undefined || r0 === undefined || r1 === undefined) continue;
    if (bl0 === undefined || bl1 === undefined || bs0 === undefined || bs1 === undefined || br0 === undefined || br1 === undefined) continue;
    frame.triangle(s0, l0, l1); frame.triangle(s0, l1, s1);
    frame.triangle(s0, s1, r1); frame.triangle(s0, r1, r0);
    frame.triangle(bs0, bl1, bl0); frame.triangle(bs0, bs1, bl1);
    frame.triangle(bs0, br1, bs1); frame.triangle(bs0, br0, br1);
  }
}

/** A cast cup (bobeche) and a round globe on top of an arm's tip. */
function globe(parts: PartBuilders, tip: V3, bulbs: V3[], size: number): void {
  parts.frame.lathe(tip, [
    [0, -0.012 * size], [0.012 * size, -0.01 * size], [0.03 * size, 0.002 * size],
    [0.036 * size, 0.012 * size], [0.02 * size, 0.018 * size], [0.012 * size, 0.026 * size], [0, 0.028 * size],
  ], 10);
  const centre = vec.add(tip, [0, 0.062 * size, 0]);
  const radius = 0.036 * size;
  const ring: V2[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  parts.bulb.lathe(centre, ring, 12);
  bulbs.push(centre);
}

/** A C-curl hanging from `at`: a tightening spiral in the arm's plane. */
function curl(frame: MeshBuilder, at: V2, angle: number, centre: V3, size: number, sense: 1 | -1): void {
  const path: V3[] = [];
  const radii: number[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const turn = t * Math.PI * 1.6;
    const r = size * (1 - 0.72 * t);
    const point: V2 = [at[0] + sense * Math.sin(turn) * r * 0.55, at[1] - (1 - Math.cos(turn)) * r * 0.75];
    path.push(radial(point, angle, centre));
    radii.push(0.0075 * (1 - 0.55 * t) + 0.002);
  }
  frame.tube(path, radii, 6);
}

interface TierSpec {
  /** Height of the tier's root on the stem, local metres. */
  readonly height: number;
  readonly arms: number;
  /** How far out the globes sit, metres. */
  readonly reach: number;
  /** Rise (or fall) of the arm's tip above its root. */
  readonly rise: number;
  readonly phase: number;
  /** Scale of cups, globes, curls and leaves. */
  readonly size: number;
  readonly thickness: number;
}

/** One tier: S-scroll arms out from the stem, each ending in a globe. */
function tier(parts: PartBuilders, bulbs: V3[], centre: V3, spec: TierSpec): void {
  for (let i = 0; i < spec.arms; i++) {
    const angle = spec.phase + (i / spec.arms) * Math.PI * 2;
    const p0: V2 = [0.05, spec.height];
    const p1: V2 = [spec.reach * 0.45, spec.height - spec.reach * 0.42];
    const p2: V2 = [spec.reach * 0.92, spec.height - spec.reach * 0.2 + spec.rise * 0.3];
    const p3: V2 = [spec.reach, spec.height + spec.rise];
    const path: V3[] = [];
    const radii: number[] = [];
    const steps = 16;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      path.push(radial(bezier(p0, p1, p2, p3, t), angle, centre));
      radii.push(spec.thickness * (1 - 0.4 * t));
    }
    parts.frame.tube(path, radii, 6, true);
    const tip = path[path.length - 1];
    if (tip !== undefined) globe(parts, tip, bulbs, spec.size);
    // The elbow: a C-curl under the scroll's lowest point, and leaves.
    const elbow = bezier(p0, p1, p2, p3, 0.42);
    curl(parts.frame, elbow, angle, centre, 0.085 * spec.size, 1);
    const outward: V3 = [Math.cos(angle), 0, Math.sin(angle)];
    const elbowWorld = radial(elbow, angle, centre);
    acanthus(parts.frame, elbowWorld, vec.add(outward, [0, 0.9, 0]), vec.add(outward, [0, -0.2, 0]), 0.075 * spec.size, 0.05 * spec.size);
    // A leaf where the arm springs from the stem.
    acanthus(parts.frame, radial(p0, angle, centre), vec.add(outward, [0, -0.6, 0]), outward, 0.06 * spec.size, 0.042 * spec.size);
  }
}

/** A turned baluster stem from a lathe profile, with leaf collars. */
function stem(frame: MeshBuilder, profile: readonly V2[], collars: readonly number[], centre: V3, leaves: number, size: number): void {
  frame.lathe(centre, profile, 16);
  for (const y of collars) {
    for (let i = 0; i < leaves; i++) {
      const angle = (i / leaves) * Math.PI * 2;
      const outward: V3 = [Math.cos(angle), 0, Math.sin(angle)];
      acanthus(frame, vec.add(centre, [outward[0] * 0.05, y, outward[2] * 0.05]), [outward[0] * 0.5, 1, outward[2] * 0.5], outward, 0.11 * size, 0.07 * size);
    }
  }
}

/** The great chandelier under the dome: three tiers round a tall baluster. */
function buildDomeChandelier(parts: PartBuilders, bulbs: V3[]): void {
  const origin: V3 = [0, 0, 0];
  stem(parts.frame, [
    [0, -0.8], [0.016, -0.79], [0.035, -0.72], [0.026, -0.64], [0.07, -0.54], [0.105, -0.44], [0.09, -0.34], [0.05, -0.27],
    [0.12, -0.2], [0.14, -0.12], [0.1, -0.04], [0.05, 0.04], [0.07, 0.12], [0.1, 0.2], [0.075, 0.3], [0.045, 0.38],
    [0.065, 0.48], [0.085, 0.58], [0.06, 0.68], [0.04, 0.76], [0.055, 0.86], [0.07, 0.94], [0.045, 1.02], [0.03, 1.12], [0.02, 1.2], [0, 1.21],
  ], [-0.3, 0.32, 0.92], origin, 8, 1.15);
  tier(parts, bulbs, origin, { height: 0.66, arms: 8, reach: 0.34, rise: 0.12, phase: 0, size: 1, thickness: 0.011 });
  tier(parts, bulbs, origin, { height: 0.2, arms: 12, reach: 0.6, rise: 0.12, phase: Math.PI / 12, size: 1.08, thickness: 0.013 });
  tier(parts, bulbs, origin, { height: -0.22, arms: 16, reach: 0.82, rise: 0.16, phase: Math.PI / 16, size: 1.15, thickness: 0.015 });
}

/** The four fittings on the ceiling roses: two tiers round a shorter stem. */
function buildRoseChandelier(parts: PartBuilders, bulbs: V3[]): void {
  const origin: V3 = [0, 0, 0];
  stem(parts.frame, [
    [0, -0.79], [0.014, -0.77], [0.032, -0.7], [0.024, -0.62], [0.058, -0.52], [0.078, -0.42], [0.058, -0.32], [0.038, -0.24],
    [0.07, -0.14], [0.09, -0.06], [0.062, 0.04], [0.036, 0.14], [0.05, 0.26], [0.066, 0.38], [0.048, 0.5], [0.03, 0.6],
    [0.044, 0.68], [0.026, 0.76], [0, 0.78],
  ], [-0.38, 0.3], origin, 6, 0.95);
  tier(parts, bulbs, origin, { height: 0.12, arms: 6, reach: 0.34, rise: 0.1, phase: 0, size: 0.95, thickness: 0.01 });
  tier(parts, bulbs, origin, { height: -0.2, arms: 10, reach: 0.56, rise: 0.12, phase: Math.PI / 10, size: 1.0, thickness: 0.012 });
}

/** Copies a builder's output into `target` with an offset. */
function place(target: MeshBuilder, source: MeshBuilder, offset: V3): void {
  const data = source.arrays();
  const base = target.vertices;
  for (let i = 0; i < data.positions.length / 3; i++) {
    const position: V3 = [
      (data.positions[i * 3] ?? 0) + offset[0],
      (data.positions[i * 3 + 1] ?? 0) + offset[1],
      (data.positions[i * 3 + 2] ?? 0) + offset[2],
    ];
    const normal: V3 = [data.normals[i * 3] ?? 0, data.normals[i * 3 + 1] ?? 1, data.normals[i * 3 + 2] ?? 0];
    target.vertex(position, normal, [data.uvs[i * 2] ?? 0, data.uvs[i * 2 + 1] ?? 0]);
  }
  for (let i = 0; i < data.indices.length; i += 3) {
    target.triangle(base + (data.indices[i] ?? 0), base + (data.indices[i + 1] ?? 0), base + (data.indices[i + 2] ?? 0));
  }
}

function newParts(): PartBuilders {
  return { frame: new MeshBuilder(), bulb: new MeshBuilder() };
}

/** The rod from the ceiling (or the dome's plate) to the fitting, with a canopy. */
function suspension(frame: MeshBuilder, chandelier: HallChandelier, top: number): void {
  const [x, y, z] = chandelier.position;
  const start: V3 = [x, chandelier.suspension - 0.02, z];
  const end: V3 = [x, y + top, z];
  frame.tube([start, end], [0.011, 0.011], 8);
  // Cast knops along the rod.
  const length = start[1] - end[1];
  for (let k = 1; k < Math.floor(length / 0.32); k++) {
    frame.lathe([x, end[1] + k * 0.32 - 0.03, z], [[0, 0], [0.022, 0.008], [0.026, 0.03], [0.022, 0.052], [0, 0.06]], 10);
  }
  frame.lathe([x, chandelier.suspension - 0.13, z], [[0, 0], [0.05, 0.01], [0.1, 0.06], [0.12, 0.1], [0.09, 0.118], [0, 0.125]], 18);
}

export function buildChandeliers(): ChandelierSet {
  const combined = newParts();
  const bulbs: V3[] = [];
  const templates = new Map<ChandelierStyle, { parts: PartBuilders; bulbs: V3[]; top: number }>();
  const domeParts = newParts();
  const domeBulbs: V3[] = [];
  buildDomeChandelier(domeParts, domeBulbs);
  templates.set("gilt-leaf", { parts: domeParts, bulbs: domeBulbs, top: 1.21 });
  // The spec names the rose fittings' style "crystal"; as photographed they
  // are gilt scrollwork with globes, drawn so.
  const roseParts = newParts();
  const roseBulbs: V3[] = [];
  buildRoseChandelier(roseParts, roseBulbs);
  templates.set("crystal", { parts: roseParts, bulbs: roseBulbs, top: 0.78 });

  for (const chandelier of HALL_CHANDELIERS) {
    const template = templates.get(chandelier.style);
    if (template === undefined) continue;
    const offset = chandelier.position;
    place(combined.frame, template.parts.frame, offset);
    place(combined.bulb, template.parts.bulb, offset);
    for (const bulb of template.bulbs) bulbs.push(vec.add(bulb, offset));
    suspension(combined.frame, chandelier, template.top);
  }

  const geometries = new Map<ChandelierPart, BufferGeometry>();
  let triangles = 0;
  for (const key of ["frame", "bulb"] as const) {
    const builder = combined[key];
    if (builder.vertices === 0) continue;
    triangles += builder.triangles;
    geometries.set(key, builder.build());
  }
  return { geometries, bulbs, triangles };
}

let cached: ChandelierSet | null = null;

export function hallChandeliers(): ChandelierSet {
  cached ??= buildChandeliers();
  return cached;
}
