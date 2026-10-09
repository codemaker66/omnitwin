// ---------------------------------------------------------------------------
// The hall's five chandeliers
//
// As scanned: the great gilt foliate chandelier hanging from the dome's
// plate, and four smaller gilt scroll chandeliers on the ceiling roses. Each
// style is built once around its own origin, then copied into place, so all
// five draw in four calls: gilt frames, crystals, candle sleeves and bulbs.
// Bulb positions are returned for the glow halos.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { MeshBuilder, vec, type V2, type V3 } from "./mesh-builder.js";
import { HALL_CHANDELIERS, type ChandelierStyle, type HallChandelier } from "./hall-spec.js";

export type ChandelierPart = "frame" | "crystal" | "candle" | "bulb";

export interface ChandelierSet {
  readonly geometries: ReadonlyMap<ChandelierPart, BufferGeometry>;
  /** World positions of every bulb, for halos. */
  readonly bulbs: readonly V3[];
  readonly triangles: number;
}

interface PartBuilders {
  readonly frame: MeshBuilder;
  readonly crystal: MeshBuilder;
  readonly candle: MeshBuilder;
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

/** An arm sweeping from the stem out to a candle, rotated to `angle`. */
function arm(b: MeshBuilder, angle: number, control: readonly [V2, V2, V2, V2], radius: number): V3 {
  const [p0, p1, p2, p3] = control;
  const path: V3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const [r, y] = bezier(p0, p1, p2, p3, i / steps);
    path.push([Math.cos(angle) * r, y, Math.sin(angle) * r]);
  }
  b.tube(path, path.map((_, index) => radius * (1 - 0.35 * (index / steps))), 6);
  return [Math.cos(angle) * p3[0], p3[1], Math.sin(angle) * p3[0]];
}

/** Candle cup, wax sleeve and flame bulb at an arm's end. */
function candle(parts: PartBuilders, tip: V3, bulbs: V3[], scale = 1): void {
  parts.frame.lathe(tip, [[0, -0.02 * scale], [0.024 * scale, -0.016 * scale], [0.05 * scale, 0], [0.052 * scale, 0.008 * scale], [0.02 * scale, 0.014 * scale], [0, 0.016 * scale]], 10);
  const sleeveBase = vec.add(tip, [0, 0.012 * scale, 0]);
  parts.candle.lathe(sleeveBase, [[0, 0], [0.015 * scale, 0], [0.015 * scale, 0.1 * scale], [0.012 * scale, 0.106 * scale], [0, 0.108 * scale]], 8);
  const flame = vec.add(sleeveBase, [0, 0.108 * scale, 0]);
  parts.bulb.lathe(flame, [[0, 0], [0.012 * scale, 0.006 * scale], [0.016 * scale, 0.02 * scale], [0.012 * scale, 0.036 * scale], [0.004 * scale, 0.05 * scale], [0, 0.056 * scale]], 8);
  bulbs.push(vec.add(flame, [0, 0.024 * scale, 0]));
}

/** A faceted crystal (an elongated octahedron) with flat normals. */
function crystal(b: MeshBuilder, centre: V3, width: number, length: number, twist = 0): void {
  const top: V3 = vec.add(centre, [0, length / 2, 0]);
  const bottom: V3 = vec.add(centre, [0, -length / 2, 0]);
  const ring: V3[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = twist + (i / 4) * Math.PI * 2;
    ring.push(vec.add(centre, [Math.cos(angle) * width / 2, length * 0.08, Math.sin(angle) * width / 2]));
  }
  for (let i = 0; i < 4; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % 4];
    if (a === undefined || c === undefined) continue;
    b.polygon([top, c, a], [[0.5, 1], [1, 0.5], [0, 0.5]]);
    b.polygon([bottom, a, c], [[0.5, 0], [0, 0.5], [1, 0.5]]);
  }
}

/** Small leaves along a scroll: gilt cones splayed outward. */
function leaves(frame: MeshBuilder, at: V3, angle: number, size: number): void {
  for (const side of [-1, 1] as const) {
    const direction = angle + side * 0.5;
    const tip: V3 = vec.add(at, [Math.cos(direction) * size, size * 0.5, Math.sin(direction) * size]);
    frame.tube([at, vec.add(at, vec.scale(vec.sub(tip, at), 0.5)), tip], [size * 0.18, size * 0.22, 0.002], 5);
  }
}

/** A ring of lamps on short arms around a vertical axis at (cx, cz). */
function lampRing(parts: PartBuilders, bulbs: V3[], centre: V3, count: number, reach: number, rise: number, phase: number, scale: number): void {
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const tip = arm(parts.frame, angle, [[0.03, 0], [reach * 0.45, -rise * 0.6], [reach * 0.85, -rise * 0.2], [reach, rise]], 0.009 * scale);
    candle(parts, vec.add(tip, centre), bulbs, scale);
  }
}

/**
 * The great chandelier under the dome: a gilt foliate fitting on a long stem,
 * a crown of lamps, an upper ring, three satellite branches each ringed with
 * lamps, and a lower ring over a pendant finial.
 */
function buildGiltLeaf(parts: PartBuilders, bulbs: V3[]): void {
  const { frame } = parts;
  frame.lathe([0, 0, 0], [
    [0, -0.78], [0.018, -0.76], [0.04, -0.68], [0.03, -0.6], [0.07, -0.5], [0.1, -0.4], [0.08, -0.3], [0.05, -0.22],
    [0.11, -0.14], [0.13, -0.06], [0.09, 0.02], [0.05, 0.1], [0.08, 0.22], [0.12, 0.34], [0.09, 0.46], [0.05, 0.56],
    [0.07, 0.68], [0.1, 0.8], [0.07, 0.92], [0.045, 1.0], [0.06, 1.1], [0.08, 1.18], [0.05, 1.26], [0.03, 1.36], [0.02, 1.45], [0, 1.46],
  ], 16);
  const ring = (centre: V3, count: number, reach: number, rise: number, phase: number, scale: number): void => {
    const local = newParts();
    const localBulbs: V3[] = [];
    lampRing(local, localBulbs, [0, 0, 0], count, reach, rise, phase, scale);
    place(parts.frame, local.frame, 1, centre);
    place(parts.candle, local.candle, 1, centre);
    place(parts.bulb, local.bulb, 1, centre);
    for (const bulb of localBulbs) bulbs.push(vec.add(bulb, centre));
  };
  ring([0, 1.06, 0], 8, 0.22, 0.06, 0, 1.0);
  ring([0, 0.56, 0], 8, 0.38, 0.08, Math.PI / 8, 1.1);
  ring([0, -0.2, 0], 6, 0.3, 0.07, Math.PI / 6, 1.0);
  // Three satellite branches, each a scrolled bough to its own lamp cluster.
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + (k / 3) * Math.PI * 2;
    const tip = arm(frame, angle, [[0.08, 0.16], [0.3, -0.12], [0.55, -0.02], [0.62, 0.22]], 0.022);
    for (const t of [0.35, 0.6, 0.85]) {
      const [r, y] = bezier([0.08, 0.16], [0.3, -0.12], [0.55, -0.02], [0.62, 0.22], t);
      leaves(frame, [Math.cos(angle) * r, y, Math.sin(angle) * r], angle, 0.07);
    }
    frame.lathe(tip, [[0, -0.32], [0.02, -0.3], [0.045, -0.22], [0.03, -0.12], [0.05, -0.02], [0.03, 0.1], [0.04, 0.22], [0.02, 0.3], [0, 0.32]], 10);
    ring(vec.add(tip, [0, 0.12, 0]), 7, 0.18, 0.05, angle, 1.0);
    ring(vec.add(tip, [0, -0.12, 0]), 5, 0.14, 0.04, angle + 0.3, 0.95);
  }
  // Leaf collars on the stem.
  for (const y of [0.3, 0.86, 1.22]) {
    for (let i = 0; i < 6; i++) leaves(frame, [0, y, 0], (i / 6) * Math.PI * 2, 0.08);
  }
}

/**
 * The four fittings on the ceiling roses: gilt scrolls in two tiers of lamps
 * (six above, eight below) round a leafy column, with a few crystal drops.
 */
function buildScrollChandelier(parts: PartBuilders, bulbs: V3[]): void {
  const { frame } = parts;
  const glass = parts.crystal;
  frame.lathe([0, 0, 0], [
    [0, -0.79], [0.015, -0.77], [0.035, -0.7], [0.025, -0.62], [0.06, -0.52], [0.08, -0.42], [0.06, -0.32], [0.04, -0.22],
    [0.07, -0.12], [0.09, -0.04], [0.06, 0.06], [0.035, 0.16], [0.05, 0.28], [0.07, 0.4], [0.05, 0.52], [0.03, 0.62],
    [0.045, 0.7], [0.025, 0.76], [0, 0.78],
  ], 14);
  const place3 = (local: PartBuilders, localBulbs: V3[], centre: V3): void => {
    place(parts.frame, local.frame, 1, centre);
    place(parts.candle, local.candle, 1, centre);
    place(parts.bulb, local.bulb, 1, centre);
    for (const bulb of localBulbs) bulbs.push(vec.add(bulb, centre));
  };
  const upper = newParts();
  const upperBulbs: V3[] = [];
  lampRing(upper, upperBulbs, [0, 0, 0], 6, 0.36, 0.1, 0, 1.0);
  place3(upper, upperBulbs, [0, 0.16, 0]);
  const lower = newParts();
  const lowerBulbs: V3[] = [];
  lampRing(lower, lowerBulbs, [0, 0, 0], 8, 0.5, 0.1, Math.PI / 8, 1.0);
  place3(lower, lowerBulbs, [0, -0.16, 0]);
  // A cage of S-scrolls from the column's head down to the lower tier.
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI / 8 + (i / 8) * Math.PI * 2;
    const path: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const r = 0.06 + 0.36 * Math.sin(t * Math.PI * 0.85) + 0.05 * Math.sin(t * Math.PI * 3);
      const y = 0.6 - 0.72 * t;
      path.push([Math.cos(angle) * r, y, Math.sin(angle) * r]);
    }
    frame.tube(path, path.map(() => 0.008), 5);
    const mid = path[6];
    if (mid !== undefined) leaves(frame, mid, angle, 0.06);
  }
  // Crystal drops under the lower lamps and a pendant at the foot.
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI / 8 + (i / 8) * Math.PI * 2;
    crystal(glass, [Math.cos(angle) * 0.42, -0.3, Math.sin(angle) * 0.42], 0.03, 0.08, angle);
  }
  crystal(glass, [0, -0.86, 0], 0.06, 0.14, 0.3);
}

/** Copies a builder's output into `target` with a uniform scale and offset. */
function place(target: MeshBuilder, source: MeshBuilder, scale: number, offset: V3): void {
  const data = source.arrays();
  const base = target.vertices;
  for (let i = 0; i < data.positions.length / 3; i++) {
    const position: V3 = [
      (data.positions[i * 3] ?? 0) * scale + offset[0],
      (data.positions[i * 3 + 1] ?? 0) * scale + offset[1],
      (data.positions[i * 3 + 2] ?? 0) * scale + offset[2],
    ];
    const normal: V3 = [data.normals[i * 3] ?? 0, data.normals[i * 3 + 1] ?? 1, data.normals[i * 3 + 2] ?? 0];
    target.vertex(position, normal, [data.uvs[i * 2] ?? 0, data.uvs[i * 2 + 1] ?? 0]);
  }
  for (let i = 0; i < data.indices.length; i += 3) {
    target.triangle(base + (data.indices[i] ?? 0), base + (data.indices[i + 1] ?? 0), base + (data.indices[i + 2] ?? 0));
  }
}

function newParts(): PartBuilders {
  return { frame: new MeshBuilder(), crystal: new MeshBuilder(), candle: new MeshBuilder(), bulb: new MeshBuilder() };
}

/** Chain or rod from the ceiling to the chandelier, with a canopy rose. */
function suspension(frame: MeshBuilder, chandelier: HallChandelier, top: number): void {
  const [x, y, z] = chandelier.position;
  const start: V3 = [x, chandelier.suspension - 0.02, z];
  const end: V3 = [x, y + top, z];
  frame.tube([start, end], [0.012, 0.012], 6);
  // Chain links suggested by beads along the rod.
  const length = start[1] - end[1];
  for (let k = 1; k < Math.floor(length / 0.12); k++) {
    frame.lathe([x, end[1] + k * 0.12 - 0.02, z], [[0, 0], [0.018, 0.01], [0.018, 0.03], [0, 0.04]], 6);
  }
  frame.lathe([x, chandelier.suspension - 0.12, z], [[0, 0], [0.05, 0.01], [0.1, 0.06], [0.11, 0.1], [0.08, 0.115], [0, 0.12]], 14);
}

export function buildChandeliers(): ChandelierSet {
  const combined = newParts();
  const bulbs: V3[] = [];
  const templates = new Map<ChandelierStyle, { parts: PartBuilders; bulbs: V3[]; top: number }>();
  const giltBulbs: V3[] = [];
  const gilt = newParts();
  buildGiltLeaf(gilt, giltBulbs);
  templates.set("gilt-leaf", { parts: gilt, bulbs: giltBulbs, top: 1.46 });
  const scrollBulbs: V3[] = [];
  const scroll = newParts();
  buildScrollChandelier(scroll, scrollBulbs);
  templates.set("crystal", { parts: scroll, bulbs: scrollBulbs, top: 0.78 });

  for (const chandelier of HALL_CHANDELIERS) {
    const template = templates.get(chandelier.style);
    if (template === undefined) continue;
    const offset = chandelier.position;
    for (const key of ["frame", "crystal", "candle", "bulb"] as const) place(combined[key], template.parts[key], 1, offset);
    for (const bulb of template.bulbs) bulbs.push(vec.add(bulb, offset));
    suspension(combined.frame, chandelier, template.top);
  }

  const geometries = new Map<ChandelierPart, BufferGeometry>();
  let triangles = 0;
  for (const key of ["frame", "crystal", "candle", "bulb"] as const) {
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
