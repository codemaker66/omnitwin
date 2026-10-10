// ---------------------------------------------------------------------------
// The hall's five chandeliers
//
// As scanned on 11 July 2026, measured against a metric grid in the
// panoramas of stations scan_024, scan_029, scan_032 and scan_043: pale
// silver-gilt foliate fittings on dark bronze stems, white flame bulbs hanging
// beneath petal cups, and no crystal. Both kinds hang six satellite clusters
// on S-scrolls round a leafy column. The great one under the dome reaches from
// 3.85 m to a crown of uplighters at 6.5 m and 1.8 m across; the four on the
// ceiling roses reach from 3.58 m to a crown of scrolls at 5.25 m and 1.3 m
// across. Each kind is built once round its own origin, then copied into
// place, so all five draw in three calls: gilt, bronze and bulbs. Bulb
// positions are returned for the glow halos.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { MeshBuilder, vec, type V2, type V3 } from "./mesh-builder.js";
import { HALL_CHANDELIERS, type ChandelierStyle, type HallChandelier } from "./hall-spec.js";

export type ChandelierPart = "gilt" | "bronze" | "bulb";

const PARTS: readonly ChandelierPart[] = ["gilt", "bronze", "bulb"];

export interface ChandelierSet {
  readonly geometries: ReadonlyMap<ChandelierPart, BufferGeometry>;
  /** World positions of every bulb, for halos. */
  readonly bulbs: readonly V3[];
  readonly triangles: number;
}

type PartBuilders = Readonly<Record<ChandelierPart, MeshBuilder>>;

/** Control points of a cubic Bézier curve in the (radius, height) plane. */
type Curve = readonly [V2, V2, V2, V2];

/** A tier of lamps on arms springing from a column. */
interface Tier {
  /** Height where the arms leave the column. */
  readonly y: number;
  readonly count: number;
  /** The lamps' distance from the column. */
  readonly reach: number;
  /** How far each arm dips before rising to its lamp, which hangs this far above `y`. */
  readonly rise: number;
  readonly phase: number;
  readonly scale: number;
}

/** A ring of acanthus leaves round a column. */
interface Collar {
  readonly y: number;
  readonly radius: number;
  readonly count: number;
  readonly length: number;
  readonly phase: number;
  /** The leaves' slope: negative springs downward, positive upward. */
  readonly lift: number;
}

/**
 * Clusters hung round the column: each a leafy rosette with its own ring of
 * lamps, hanging on a short rod from the hooked end of a scroll arm.
 */
interface Satellites {
  readonly count: number;
  readonly phase: number;
  /** Distance of each cluster's axis from the column. */
  readonly radius: number;
  /** The scroll from the column out to the hook each cluster hangs from. */
  readonly arm: Curve;
  /** The arm's strap thickness. */
  readonly armSize: number;
  /** Each rosette's body about its own axis, as (radius, height) from foot to head. */
  readonly body: readonly V2[];
  readonly tiers: readonly Tier[];
  readonly collars: readonly Collar[];
}

const ORIGIN: V3 = [0, 0, 0];

/** Bearings of the satellites, measured from beneath: the dome fitting's at scan_043, the fireplace-window rose's at scan_032 (the four roses share it). */
const DOME_PHASE = 0.147;
const ROSE_PHASE = 0.47;

function bezier([p0, p1, p2, p3]: Curve, t: number): V2 {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** The direction of a curve at its end, in the (radius, height) plane. */
function endTangent([, , p2, p3]: Curve): V2 {
  const dr = p3[0] - p2[0];
  const dy = p3[1] - p2[1];
  const length = Math.hypot(dr, dy) || 1;
  return [dr / length, dy / length];
}

function around(angle: number, [r, y]: V2): V3 {
  return [Math.cos(angle) * r, y, Math.sin(angle) * r];
}

/**
 * A flat strap of metal along `path`, as the fittings' scrolls are bent from:
 * `width` across the vertical plane at `angle` that the path lies in,
 * `thickness` within it, both narrowing by `taper` toward the end. Each face
 * carries its own vertices, so the strap shades flat.
 */
function strap(b: MeshBuilder, path: readonly V3[], angle: number, width: number, thickness: number, taper: number): void {
  const across: V3 = [-Math.sin(angle), 0, Math.cos(angle)];
  const last = path.length - 1;
  let previous: number[] | null = null;
  for (let j = 0; j <= last; j++) {
    const point = path[j];
    if (point === undefined) continue;
    const tangent = vec.normalize(vec.sub(path[Math.min(last, j + 1)] ?? point, path[Math.max(0, j - 1)] ?? point));
    const inPlane = vec.normalize(vec.cross(tangent, across));
    const scale = 1 - taper * (j / Math.max(1, last));
    const halfWidth = width * 0.5 * scale;
    const halfThickness = thickness * 0.5 * scale;
    const corner = (u: number, v: number): V3 => vec.add(point, vec.add(vec.scale(across, u * halfWidth), vec.scale(inPlane, v * halfThickness)));
    const corners: readonly V3[] = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
    const normals: readonly V3[] = [inPlane, vec.scale(across, -1), vec.scale(inPlane, -1), across];
    const v = j / Math.max(1, last);
    const ring: number[] = [];
    for (let f = 0; f < 4; f++) {
      const from = corners[f];
      const to = corners[(f + 1) % 4];
      const normal = normals[f];
      if (from === undefined || to === undefined || normal === undefined) continue;
      ring.push(b.vertex(from, normal, [f / 4, v]), b.vertex(to, normal, [(f + 1) / 4, v]));
    }
    if (previous !== null) {
      for (let f = 0; f < 4; f++) {
        const a0 = previous[f * 2];
        const a1 = previous[f * 2 + 1];
        const b0 = ring[f * 2];
        const b1 = ring[f * 2 + 1];
        if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) continue;
        b.triangle(a0, a1, b1);
        b.triangle(a0, b1, b0);
      }
    }
    previous = ring;
  }
}

/** A strap along `curve` in the vertical plane through `centre` at `angle`, `size` thick; returns its end. */
function scroll(b: MeshBuilder, centre: V3, angle: number, curve: Curve, size: number, steps = 9): V3 {
  const path: V3[] = [];
  for (let i = 0; i <= steps; i++) path.push(vec.add(centre, around(angle, bezier(curve, i / steps))));
  strap(b, path, angle, size * 2.2, size, 0.3);
  return vec.add(centre, around(angle, curve[3]));
}

/**
 * A volute: a strap curled into a shrinking spiral in the vertical plane at
 * `angle`, starting at `start` along `tangent` (a direction in the (radius,
 * height) plane). `over` turns it as a strap heading outward turns upward,
 * curling over itself; otherwise it turns under.
 */
function curl(b: MeshBuilder, start: V3, angle: number, tangent: V2, radius: number, turns: number, size: number, over: boolean): void {
  const outward: V3 = [Math.cos(angle), 0, Math.sin(angle)];
  const turn = over ? 1 : -1;
  // Turning with increasing phase φ, a point moves along (−sin φ, cos φ).
  const phase0 = over ? Math.atan2(-tangent[0], tangent[1]) : Math.atan2(tangent[0], -tangent[1]);
  const centre = vec.sub(start, vec.add(vec.scale(outward, Math.cos(phase0) * radius), [0, Math.sin(phase0) * radius, 0]));
  const steps = Math.max(6, Math.round(turns * 8));
  const path: V3[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const phase = phase0 + turn * t * turns * Math.PI * 2;
    const r = radius * (1 - 0.7 * t);
    path.push(vec.add(centre, vec.add(vec.scale(outward, Math.cos(phase) * r), [0, Math.sin(phase) * r, 0])));
  }
  strap(b, path, angle, size * 2.2, size, 0.4);
}

/** A flat facet through `points` (a triangle or convex quad), wound to face along `normal`. */
function facet(b: MeshBuilder, points: readonly V3[], normal: V3): void {
  const [p0, p1, p2] = points;
  if (p0 === undefined || p1 === undefined || p2 === undefined) return;
  const winding = vec.cross(vec.sub(p1, p0), vec.sub(p2, p0));
  const ordered = winding[0] * normal[0] + winding[1] * normal[1] + winding[2] * normal[2] >= 0 ? points : [...points].reverse();
  b.polygon(ordered, ordered.map((_, index) => [index / points.length, 0]), normal);
}

/**
 * An acanthus leaf: an oval blade from `base` along `direction`, its edges
 * turned back and its spine curling over toward the tip by `droop`. Both
 * faces are drawn, as a thin leaf of metal shows both, each with its own
 * normal; the blade closes to a point at its base and tip.
 */
function leaf(b: MeshBuilder, base: V3, direction: V3, length: number, width: number, droop: number): void {
  const along = vec.normalize(direction);
  const crossUp = vec.cross(along, [0, 1, 0]);
  const side = Math.hypot(crossUp[0], crossUp[1], crossUp[2]) < 1e-4 ? [1, 0, 0] as V3 : vec.normalize(crossUp);
  const face = vec.normalize(vec.cross(side, along));
  const steps = length < 0.07 ? 3 : 4;
  // The spine is an arc turning from `along` toward the leaf's back.
  const bend = Math.max(1e-3, droop * 2.2);
  const radius = length / bend;
  const left: V3[] = [];
  const right: V3[] = [];
  const normals: V3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = bend * t;
    const spine = vec.add(base, vec.add(vec.scale(along, radius * Math.sin(a)), vec.scale(face, -radius * (1 - Math.cos(a)))));
    const normal = vec.normalize(vec.add(vec.scale(face, Math.cos(a)), vec.scale(along, Math.sin(a))));
    const half = width * 0.5 * Math.pow(Math.sin(Math.PI * t), 0.6) * (1 - 0.3 * t);
    const turnedBack = vec.scale(normal, -half * 0.4);
    left.push(vec.add(vec.add(spine, vec.scale(side, half)), turnedBack));
    right.push(vec.add(vec.add(spine, vec.scale(side, -half)), turnedBack));
    normals.push(normal);
  }
  for (let i = 0; i < steps; i++) {
    const l0 = left[i];
    const l1 = left[i + 1];
    const r0 = right[i];
    const r1 = right[i + 1];
    const n0 = normals[i];
    const n1 = normals[i + 1];
    if (l0 === undefined || l1 === undefined || r0 === undefined || r1 === undefined || n0 === undefined || n1 === undefined) continue;
    // The base and the tip close to a point: those segments are triangles.
    const points = i === 0 ? [r0, l1, r1] : i === steps - 1 ? [r0, l0, l1] : [r0, l0, l1, r1];
    const normal = vec.normalize(vec.add(n0, n1));
    facet(b, points, normal);
    facet(b, points, vec.scale(normal, -1));
  }
}

/** A collar of leaves round the column through `centre`. */
function collar(b: MeshBuilder, centre: V3, { y, radius, count, length, phase, lift }: Collar): void {
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    leaf(b, vec.add(centre, around(angle, [radius, y])), [Math.cos(angle), lift, Math.sin(angle)], length, length * 0.55, 0.7);
  }
}

/**
 * A lamp at an arm's tip: a cup of petals opening downward, a few leaves
 * round it and a white flame bulb hanging beneath.
 */
function lamp(parts: PartBuilders, tip: V3, bulbs: V3[], angle: number, scale: number): void {
  const s = scale;
  parts.gilt.lathe(tip, [[0, -0.022 * s], [0.03 * s, -0.024 * s], [0.036 * s, -0.019 * s], [0.026 * s, -0.006 * s], [0.011 * s, 0.006 * s], [0, 0.012 * s]], 6);
  for (let k = 0; k < 3; k++) {
    const a = angle + (k - 1) * 1.6;
    leaf(parts.gilt, vec.add(tip, [0, -0.004 * s, 0]), [Math.cos(a), -0.9, Math.sin(a)], 0.05 * s, 0.032 * s, 0.25);
  }
  parts.bulb.lathe(tip, [[0, -0.088 * s], [0.008 * s, -0.078 * s], [0.016 * s, -0.06 * s], [0.018 * s, -0.044 * s], [0.013 * s, -0.03 * s], [0, -0.024 * s]], 6);
  bulbs.push(vec.add(tip, [0, -0.055 * s, 0]));
}

/**
 * A tier of lamps on scrolled arms springing from the column through
 * `centre`: each arm dips, then rises to its cup, with acanthus at its elbow
 * and a volute curling beneath.
 */
function tier(parts: PartBuilders, bulbs: V3[], centre: V3, { y, count, reach, rise, phase, scale }: Tier): void {
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const curve: Curve = [[0.03, y], [reach * 0.4, y - rise * 0.9], [reach * 0.82, y - rise * 0.4], [reach, y + rise]];
    const tip = scroll(parts.gilt, centre, angle, curve, 0.012 * scale);
    const [er, ey] = bezier(curve, 0.45);
    const elbow = vec.add(centre, around(angle, [er, ey]));
    for (let k = 0; k < 3; k++) {
      const a = angle + (k - 1) * 0.9;
      leaf(parts.gilt, elbow, [Math.cos(a), k === 1 ? 0.9 : 0.2, Math.sin(a)], 0.07 * scale, 0.045 * scale, 0.8);
    }
    const [vr, vy] = bezier(curve, 0.62);
    curl(parts.gilt, vec.add(centre, around(angle, [vr, vy])), angle, [0, -1], 0.035 * scale, 1.25, 0.006 * scale, false);
    lamp(parts, tip, bulbs, angle, scale);
  }
}

/** Hangs `design.count` satellite clusters round the column, each with a pair of leaves along its arm. */
function satellites(parts: PartBuilders, bulbs: V3[], design: Satellites): void {
  const { gilt } = parts;
  for (let k = 0; k < design.count; k++) {
    const angle = design.phase + (k / design.count) * Math.PI * 2;
    const hook = scroll(gilt, ORIGIN, angle, design.arm, design.armSize, 12);
    curl(gilt, hook, angle, endTangent(design.arm), 0.045, 1.2, design.armSize * 0.85, false);
    const root = design.arm[0];
    curl(gilt, around(angle, [root[0] + 0.03, root[1] - 0.01]), angle, [1, -0.4], 0.045, 1.2, design.armSize * 0.7, false);
    for (const t of [0.3, 0.62]) {
      const at = around(angle, bezier(design.arm, t));
      for (const side of [-1, 1] as const) {
        const a = angle + side * 0.9;
        leaf(gilt, at, [Math.cos(a), 0.45, Math.sin(a)], 0.09, 0.055, 0.8);
      }
    }
    const axis = around(angle, [design.radius, 0]);
    const head = design.body[design.body.length - 1]?.[1] ?? 0;
    gilt.tube([hook, vec.add(axis, [0, head, 0])], [0.006, 0.006], 4);
    gilt.lathe(vec.add(axis, [0, (hook[1] + head) / 2 - 0.02, 0]), [[0, 0], [0.014, 0.008], [0.016, 0.02], [0.012, 0.032], [0, 0.04]], 6);
    gilt.lathe(axis, design.body, 8);
    for (const spec of design.tiers) tier(parts, bulbs, axis, { ...spec, phase: angle + spec.phase });
    for (const spec of design.collars) collar(gilt, axis, { ...spec, phase: angle + spec.phase });
  }
}

/**
 * A ring of C-scrolls round the column, each ending in a volute and leafed
 * halfway: the scrollwork that makes a fitting's basket and crown.
 */
function scrollRing(b: MeshBuilder, count: number, phase: number, curve: Curve, size: number, curlRadius: number, over: boolean, leafLength: number): void {
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const end = scroll(b, ORIGIN, angle, curve, size, 10);
    curl(b, end, angle, endTangent(curve), curlRadius, 1.2, size * 0.85, over);
    const middle = bezier(curve, 0.5);
    for (const side of [-1, 1] as const) {
      const a = angle + side * 0.7;
      leaf(b, around(angle, middle), [Math.cos(a), 0.3, Math.sin(a)], leafLength, leafLength * 0.6, 0.7);
    }
  }
}

/** Uplighters round the dome fitting's crown: short cans splayed outward. */
function uplighters(gilt: MeshBuilder, count: number, phase: number, base: V2, top: V2, radius: number): void {
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const foot = around(angle, base);
    gilt.tube([around(angle, [0.03, base[1] - 0.04]), foot], [0.008, 0.008], 4);
    gilt.tube([foot, around(angle, top)], [radius * 0.8, radius], 8, true);
  }
}

/**
 * The great chandelier under the dome, about its body's centre (4.75 m): a
 * leafy column from a basket of scrolls and a drop finial up to a crown of
 * ten uplighters, six tiers of lamps, and six rosettes of six lamps each
 * hanging 0.7 m out at 4.83 m. Its 74 bulbs hang from 4.35 m to 6.05 m, as
 * the scan's do.
 */
function buildDomeChandelier(parts: PartBuilders, bulbs: V3[]): void {
  const { gilt } = parts;
  const satellitePhase = DOME_PHASE;
  gilt.lathe(ORIGIN, [
    [0, -0.9], [0.012, -0.895], [0.02, -0.875], [0.022, -0.855], [0.015, -0.835], [0.008, -0.81],
    [0.012, -0.79], [0.03, -0.765], [0.034, -0.745], [0.02, -0.715],
    [0.04, -0.68], [0.07, -0.62], [0.085, -0.55], [0.075, -0.48], [0.055, -0.42], [0.04, -0.38],
    [0.035, -0.3], [0.06, -0.22], [0.045, -0.15], [0.03, -0.05], [0.05, 0.05], [0.07, 0.12], [0.05, 0.2],
    [0.03, 0.3], [0.045, 0.4], [0.03, 0.5], [0.028, 0.62], [0.05, 0.72], [0.06, 0.8], [0.04, 0.9],
    [0.028, 1.0], [0.045, 1.1], [0.055, 1.2], [0.035, 1.3], [0.03, 1.4],
    [0.06, 1.45], [0.1, 1.5], [0.11, 1.53], [0.05, 1.56], [0.03, 1.62], [0.02, 1.72], [0, 1.74],
  ], 14);
  tier(parts, bulbs, ORIGIN, { y: -0.4, count: 8, reach: 0.34, rise: 0.05, phase: Math.PI / 8, scale: 0.9 });
  tier(parts, bulbs, ORIGIN, { y: -0.13, count: 6, reach: 0.2, rise: 0.05, phase: satellitePhase, scale: 0.9 });
  tier(parts, bulbs, ORIGIN, { y: 0.125, count: 6, reach: 0.44, rise: 0.08, phase: satellitePhase + Math.PI / 6, scale: 1 });
  tier(parts, bulbs, ORIGIN, { y: 0.507, count: 6, reach: 0.26, rise: 0.04, phase: satellitePhase, scale: 0.85 });
  tier(parts, bulbs, ORIGIN, { y: 0.97, count: 6, reach: 0.37, rise: 0.05, phase: satellitePhase + Math.PI / 6, scale: 0.9 });
  tier(parts, bulbs, ORIGIN, { y: 1.3, count: 6, reach: 0.4, rise: 0.05, phase: satellitePhase, scale: 0.9 });
  satellites(parts, bulbs, {
    count: 6,
    phase: satellitePhase,
    radius: 0.7,
    arm: [[0.05, 0.64], [0.3, 0.72], [0.56, 0.7], [0.7, 0.6]],
    armSize: 0.011,
    body: [
      [0, -0.02], [0.012, -0.015], [0.02, 0], [0.03, 0.04], [0.045, 0.1], [0.04, 0.16], [0.025, 0.22],
      [0.03, 0.28], [0.02, 0.33], [0.01, 0.36], [0, 0.365],
    ],
    tiers: [{ y: 0.08, count: 6, reach: 0.19, rise: 0.05, phase: Math.PI / 6, scale: 0.85 }],
    collars: [
      { y: 0.3, radius: 0.02, count: 6, length: 0.09, phase: 0, lift: -0.7 },
      { y: 0.2, radius: 0.03, count: 8, length: 0.11, phase: Math.PI / 8, lift: 0.5 },
      { y: 0.12, radius: 0.04, count: 8, length: 0.1, phase: 0, lift: -0.3 },
      { y: 0.04, radius: 0.035, count: 6, length: 0.09, phase: Math.PI / 6, lift: 0.8 },
      { y: 0, radius: 0.015, count: 5, length: 0.06, phase: Math.PI / 5, lift: -0.8 },
    ],
  });
  // The basket of C-scrolls round the foot of the column, and the lace of
  // scrolls rising under the crown.
  scrollRing(gilt, 12, 0, [[0.04, -0.74], [0.15, -0.76], [0.25, -0.58], [0.21, -0.38]], 0.011, 0.045, true, 0.09);
  scrollRing(gilt, 8, Math.PI / 8, [[0.04, -0.5], [0.16, -0.52], [0.3, -0.36], [0.27, -0.16]], 0.01, 0.04, true, 0.09);
  scrollRing(gilt, 8, 0, [[0.04, 0.82], [0.3, 0.86], [0.32, 1.12], [0.12, 1.42]], 0.01, 0.04, false, 0.1);
  scrollRing(gilt, 8, Math.PI / 8, [[0.04, 0.5], [0.26, 0.5], [0.34, 0.78], [0.2, 0.98]], 0.01, 0.04, true, 0.1);
  scrollRing(gilt, 8, 0, [[0.04, 1.02], [0.22, 1.02], [0.3, 1.22], [0.18, 1.36]], 0.009, 0.035, true, 0.09);
  uplighters(gilt, 10, 0, [0.12, 1.52], [0.2, 1.72], 0.024);
  for (const spec of [
    { y: -0.72, radius: 0.03, count: 8, length: 0.13, phase: 0, lift: 1.3 },
    { y: -0.6, radius: 0.07, count: 10, length: 0.12, phase: Math.PI / 10, lift: -0.6 },
    { y: -0.48, radius: 0.07, count: 10, length: 0.15, phase: 0, lift: 0.6 },
    { y: -0.3, radius: 0.045, count: 10, length: 0.17, phase: 0, lift: 0.5 },
    { y: -0.08, radius: 0.04, count: 8, length: 0.16, phase: Math.PI / 8, lift: -0.4 },
    { y: 0.12, radius: 0.06, count: 10, length: 0.18, phase: Math.PI / 10, lift: 0.1 },
    { y: 0.32, radius: 0.04, count: 8, length: 0.16, phase: 0, lift: -0.3 },
    { y: 0.45, radius: 0.04, count: 8, length: 0.15, phase: Math.PI / 8, lift: 0.5 },
    { y: 0.64, radius: 0.04, count: 8, length: 0.15, phase: 0, lift: -0.5 },
    { y: 0.8, radius: 0.06, count: 10, length: 0.17, phase: Math.PI / 10, lift: 0.2 },
    { y: 1.1, radius: 0.045, count: 8, length: 0.15, phase: 0, lift: -0.3 },
    { y: 1.25, radius: 0.05, count: 8, length: 0.13, phase: Math.PI / 8, lift: 0.6 },
    { y: 1.46, radius: 0.08, count: 10, length: 0.11, phase: Math.PI / 10, lift: 1.0 },
  ]) collar(gilt, ORIGIN, spec);
}

/**
 * The four fittings on the ceiling roses, about their body's centre
 * (4.45 m): a slim vase column from a basket of scrolls up to a crown of six
 * C-scrolls, three tiers of lamps, and six rosettes of three lamps each
 * hanging 0.5 m out at 4.42 m. Their 35 bulbs hang from 3.75 m to 4.65 m,
 * as the scan's do.
 */
function buildRoseChandelier(parts: PartBuilders, bulbs: V3[]): void {
  const { gilt } = parts;
  const satellitePhase = ROSE_PHASE;
  gilt.lathe(ORIGIN, [
    [0, -0.87], [0.01, -0.865], [0.016, -0.85], [0.018, -0.83], [0.012, -0.81], [0.007, -0.79],
    [0.01, -0.775], [0.024, -0.755], [0.026, -0.735], [0.016, -0.715],
    [0.03, -0.69], [0.055, -0.63], [0.065, -0.57], [0.055, -0.5], [0.04, -0.45], [0.03, -0.42],
    [0.028, -0.35], [0.045, -0.28], [0.035, -0.2], [0.024, -0.1], [0.04, -0.02], [0.05, 0.05], [0.035, 0.12],
    [0.022, 0.22], [0.03, 0.32], [0.022, 0.42], [0.036, 0.5], [0.045, 0.56], [0.03, 0.62], [0.022, 0.7],
    [0.03, 0.76], [0.016, 0.8], [0, 0.81],
  ], 12);
  tier(parts, bulbs, ORIGIN, { y: 0.2, count: 6, reach: 0.3, rise: 0.05, phase: satellitePhase + Math.PI / 6, scale: 0.9 });
  tier(parts, bulbs, ORIGIN, { y: -0.553, count: 8, reach: 0.32, rise: 0.05, phase: Math.PI / 8, scale: 0.85 });
  tier(parts, bulbs, ORIGIN, { y: -0.689, count: 3, reach: 0.14, rise: 0.03, phase: 0, scale: 0.75 });
  satellites(parts, bulbs, {
    count: 6,
    phase: satellitePhase,
    radius: 0.5,
    arm: [[0.04, 0.46], [0.2, 0.52], [0.4, 0.5], [0.5, 0.4]],
    armSize: 0.01,
    body: [
      [0, -0.1], [0.01, -0.095], [0.016, -0.08], [0.024, -0.04], [0.035, 0.02], [0.03, 0.08], [0.02, 0.14],
      [0.024, 0.19], [0.012, 0.235], [0, 0.24],
    ],
    tiers: [{ y: -0.036, count: 3, reach: 0.14, rise: 0.05, phase: 0, scale: 0.8 }],
    collars: [
      { y: 0.2, radius: 0.015, count: 5, length: 0.07, phase: 0, lift: -0.7 },
      { y: 0.12, radius: 0.025, count: 6, length: 0.09, phase: Math.PI / 6, lift: 0.5 },
      { y: 0.05, radius: 0.03, count: 6, length: 0.08, phase: 0, lift: -0.3 },
      { y: -0.02, radius: 0.025, count: 5, length: 0.07, phase: Math.PI / 5, lift: 0.8 },
      { y: -0.08, radius: 0.012, count: 4, length: 0.05, phase: Math.PI / 4, lift: -0.8 },
    ],
  });
  scrollRing(gilt, 6, satellitePhase + Math.PI / 6, [[0.03, -0.72], [0.14, -0.72], [0.22, -0.58], [0.18, -0.42]], 0.009, 0.035, true, 0.09);
  scrollRing(gilt, 6, satellitePhase + Math.PI / 6, [[0.03, 0.6], [0.05, 0.78], [0.2, 0.82], [0.26, 0.7]], 0.01, 0.03, false, 0.09);
  scrollRing(gilt, 6, satellitePhase, [[0.03, 0.4], [0.22, 0.42], [0.28, 0.12], [0.16, -0.08]], 0.009, 0.035, true, 0.09);
  scrollRing(gilt, 6, satellitePhase + Math.PI / 6, [[0.03, -0.12], [0.2, -0.12], [0.27, -0.32], [0.2, -0.46]], 0.009, 0.035, true, 0.08);
  for (const spec of [
    { y: -0.66, radius: 0.03, count: 8, length: 0.16, phase: 0, lift: 1.0 },
    { y: -0.48, radius: 0.045, count: 8, length: 0.14, phase: Math.PI / 8, lift: -0.3 },
    { y: -0.28, radius: 0.035, count: 8, length: 0.14, phase: 0, lift: 0.4 },
    { y: -0.08, radius: 0.04, count: 8, length: 0.14, phase: Math.PI / 8, lift: -0.3 },
    { y: 0.1, radius: 0.04, count: 8, length: 0.14, phase: 0, lift: 0.3 },
    { y: 0.3, radius: 0.03, count: 8, length: 0.13, phase: Math.PI / 8, lift: -0.4 },
    { y: 0.48, radius: 0.035, count: 8, length: 0.13, phase: 0, lift: 0.3 },
    { y: 0.66, radius: 0.03, count: 8, length: 0.11, phase: Math.PI / 8, lift: 0.8 },
  ]) collar(gilt, ORIGIN, spec);
}

function newParts(): PartBuilders {
  return { gilt: new MeshBuilder(), bronze: new MeshBuilder(), bulb: new MeshBuilder() };
}

/**
 * The dark bronze stem from the ceiling (or the dome's plate) down to the
 * fitting's head at `top` above its centre: a canopy, a rod with knops, and
 * on the roses a foliate section of scrolls just above the crown.
 */
function suspension(bronze: MeshBuilder, chandelier: HallChandelier, top: number): void {
  const [x, y, z] = chandelier.position;
  const head = y + top;
  bronze.tube([[x, chandelier.suspension - 0.02, z], [x, head, z]], [0.012, 0.012], 6);
  const length = chandelier.suspension - head;
  for (let k = 1; k < Math.floor(length / 0.3); k++) {
    bronze.lathe([x, head + k * 0.3, z], [[0, -0.03], [0.02, -0.02], [0.024, 0], [0.02, 0.02], [0, 0.03]], 8);
  }
  bronze.lathe([x, chandelier.suspension - 0.12, z], [[0, 0], [0.05, 0.01], [0.1, 0.06], [0.11, 0.1], [0.08, 0.115], [0, 0.12]], 14);
  if (chandelier.style !== "scroll") return;
  const centre: V3 = [x, head, z];
  bronze.lathe(centre, [[0.02, 0], [0.04, 0.06], [0.03, 0.16], [0.045, 0.3], [0.03, 0.42], [0.02, 0.55], [0.03, 0.6], [0, 0.62]], 10);
  for (let i = 0; i < 4; i++) {
    const angle = ROSE_PHASE + (i / 4) * Math.PI * 2;
    const cage: Curve = [[0.02, 0.02], [0.16, 0.12], [0.1, 0.4], [0.02, 0.52]];
    scroll(bronze, centre, angle, cage, 0.008, 10);
    curl(bronze, vec.add(centre, around(angle, [0.03, 0.04])), angle, [1, 0.2], 0.03, 1.1, 0.007, false);
  }
}

export function buildChandeliers(): ChandelierSet {
  const combined = newParts();
  const bulbs: V3[] = [];
  const templates = new Map<ChandelierStyle, { parts: PartBuilders; bulbs: V3[]; top: number }>();
  const domeBulbs: V3[] = [];
  const dome = newParts();
  buildDomeChandelier(dome, domeBulbs);
  templates.set("gilt-leaf", { parts: dome, bulbs: domeBulbs, top: 1.74 });
  const roseBulbs: V3[] = [];
  const rose = newParts();
  buildRoseChandelier(rose, roseBulbs);
  templates.set("scroll", { parts: rose, bulbs: roseBulbs, top: 0.81 });

  for (const chandelier of HALL_CHANDELIERS) {
    const template = templates.get(chandelier.style);
    if (template === undefined) continue;
    const offset = chandelier.position;
    for (const key of PARTS) combined[key].merge(template.parts[key], offset);
    for (const bulb of template.bulbs) bulbs.push(vec.add(bulb, offset));
    suspension(combined.bronze, chandelier, template.top);
  }

  const geometries = new Map<ChandelierPart, BufferGeometry>();
  let triangles = 0;
  for (const key of PARTS) {
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
