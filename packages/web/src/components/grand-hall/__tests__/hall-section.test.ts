import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { buildHallGeometry } from "../hall-geometry.js";
import { PLINTH_DEPTH, PLINTH_UNDERLAP, buildPlinthRing, createHallSection, plinthExtents, wallThickness } from "../hall-section.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALLS, HALL_WALL_THICKNESS, hallWall } from "../hall-spec.js";

type Vec3 = readonly [number, number, number];

interface Triangle {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  /** The normal stored on the triangle's first vertex (the ring's faces are flat). */
  readonly normal: Vec3;
}

/**
 * The city model's cut-out for the hall: nothing is emitted inside it, and its
 * caps at the floor's level start just beyond it
 * (tools/grand-hall-survey/context/build_context.py, rect_half_x and rect_half_z).
 */
const CITY_CUTOUT = [11.2, 5.95] as const;

const L = HALL_HALF_LENGTH;
const W = HALL_HALF_WIDTH;
/** The ring reaches each wall's outer face or a centimetre inside the city's cut-out, whichever is nearer. */
const EXTENTS = plinthExtents();
const reach = (id: "window" | "door" | "fireplace" | "end", half: number, limit: number): number =>
  Math.min(half + HALL_WALL_THICKNESS[id].thickness, limit - 0.01);

function trianglesOf(geometry: BufferGeometry): Triangle[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const at = (i: number): Vec3 => [position.getX(i), position.getY(i), position.getZ(i)];
  const count = index === null ? position.count : index.count;
  const vertex = (k: number): number => (index === null ? k : index.getX(k));
  const out: Triangle[] = [];
  for (let k = 0; k < count; k += 3) {
    const [i, j, l] = [vertex(k), vertex(k + 1), vertex(k + 2)];
    out.push({ a: at(i), b: at(j), c: at(l), normal: [normal.getX(i), normal.getY(i), normal.getZ(i)] });
  }
  return out;
}

const centroid = (t: Triangle): Vec3 => [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3];
const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const insideFloor = (x: number, z: number): boolean => Math.abs(x) < L - 1e-6 && Math.abs(z) < W - 1e-6;

/** Whether (x, z) lies in the triangle's plan, within `slack` metres. */
function covers(t: Triangle, x: number, z: number, slack = 1e-6): boolean {
  const area = (t.b[0] - t.a[0]) * (t.c[2] - t.a[2]) - (t.b[2] - t.a[2]) * (t.c[0] - t.a[0]);
  if (Math.abs(area) < 1e-12) return false;
  const s = Math.sign(area);
  const edges: readonly (readonly [Vec3, Vec3])[] = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
  return edges.every(([p, q]) => s * ((q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0])) >= -slack * Math.hypot(q[0] - p[0], q[2] - p[2]));
}

describe("the plinth round the Grand Hall's floor", () => {
  const ring = buildPlinthRing();
  const triangles = trianglesOf(ring);
  const tops = triangles.filter((t) => t.normal[1] > 0.999 && t.a[1] === 0 && t.b[1] === 0 && t.c[1] === 0);

  it("puts nothing under the floor within a centimetre and a half of it", () => {
    const under = triangles.filter((t) => { const [x, , z] = centroid(t); return insideFloor(x, z); });
    // Only the underlap reaches under the floor...
    expect(under.length).toBeGreaterThan(0);
    for (const t of under) {
      // ...two centimetres down, where the depth buffer separates it from the oak at any distance.
      expect(Math.max(t.a[1], t.b[1], t.c[1])).toBeLessThanOrEqual(-0.015);
      expect(Math.min(t.a[1], t.b[1], t.c[1])).toBeCloseTo(-PLINTH_UNDERLAP.drop, 6);
    }
    // No vertex at the floor's own level lies inside the floor.
    for (const t of tops) for (const p of [t.a, t.b, t.c]) expect(insideFloor(p[0], p[2])).toBe(false);
  });

  it("covers the band from the room's planes to its outer edge at the floor's level", () => {
    let sampled = 0;
    const missing: string[] = [];
    for (let x = EXTENTS.xMin; x <= EXTENTS.xMax + 1e-9; x += 0.05) {
      for (let z = EXTENTS.zMin; z <= EXTENTS.zMax + 1e-9; z += 0.05) {
        if (Math.abs(x) <= L && Math.abs(z) <= W) continue;
        sampled += 1;
        if (!tops.some((t) => covers(t, x, z))) missing.push(`${x.toFixed(3)},${z.toFixed(3)}`);
      }
    }
    expect(sampled).toBeGreaterThan(10_000);
    expect(missing.slice(0, 5)).toEqual([]);
  });

  it("ends at the walls' outer faces or inside the city's cut-out, whichever is nearer, and stands PLINTH_DEPTH deep", () => {
    ring.computeBoundingBox();
    const box = ring.boundingBox;
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.max.x).toBeCloseTo(reach("end", L, CITY_CUTOUT[0]), 5);
    expect(box.min.x).toBeCloseTo(-reach("fireplace", L, CITY_CUTOUT[0]), 5);
    expect(box.max.z).toBeCloseTo(reach("door", W, CITY_CUTOUT[1]), 5);
    expect(box.min.z).toBeCloseTo(-reach("window", W, CITY_CUTOUT[1]), 5);
    expect(box.max.y).toBe(0);
    expect(box.min.y).toBeCloseTo(-PLINTH_DEPTH, 6);
    expect(Math.max(box.max.x, -box.min.x)).toBeLessThan(CITY_CUTOUT[0]);
    expect(Math.max(box.max.z, -box.min.z)).toBeLessThan(CITY_CUTOUT[1]);
  });

  it("gives each wall's body its own thickness, its skin reaching its neighbours' outer faces", () => {
    const section = createHallSection();
    try {
      section.pieces.forEach((piece, index) => {
        const thickness = wallThickness(piece.wall);
        expect(thickness).toBe(HALL_WALL_THICKNESS[piece.wall.id].thickness);
        piece.skin.computeBoundingBox();
        const skin = piece.skin.boundingBox;
        expect(skin).not.toBeNull();
        if (skin === null) return;
        // The skin lies half the thickness behind the body's centre, which
        // lies half behind the room's plane: on the wall's outer face.
        expect(skin.min.z).toBeCloseTo(-thickness / 2, 6);
        const middle = [piece.wall.origin[0] + piece.wall.tangent[0] * piece.wall.length / 2, piece.wall.origin[2] + piece.wall.tangent[2] * piece.wall.length / 2];
        const behind = Math.hypot(piece.centre[0] - (middle[0] ?? 0), piece.centre[1] - (middle[1] ?? 0));
        expect(behind).toBeCloseTo(thickness / 2, 6);
        // Along the wall (local x from its middle) it reaches the outer face
        // of the wall before it at u = 0 and of the next one at its end.
        const before = HALL_WALLS[(index + 3) % 4];
        const after = HALL_WALLS[(index + 1) % 4];
        if (before === undefined || after === undefined) return;
        expect(skin.min.x).toBeCloseTo(-piece.wall.length / 2 - wallThickness(before), 6);
        expect(skin.max.x).toBeCloseTo(piece.wall.length / 2 + wallThickness(after), 6);
      });
      // The window wall's skin is where its windows' outer reveals end.
      expect(wallThickness(hallWall("window"))).toBe(0.95);
    } finally {
      section.dispose();
    }
  });

  it("meets the floor's edge on the floor's own vertices, so no crack opens between them", () => {
    const floor = buildHallGeometry().geometries.get("floor");
    expect(floor).toBeDefined();
    if (floor === undefined) return;
    const fp = floor.getAttribute("position");
    let maxX = 0;
    let maxZ = 0;
    for (let i = 0; i < fp.count; i++) { maxX = Math.max(maxX, Math.abs(fp.getX(i))); maxZ = Math.max(maxZ, Math.abs(fp.getZ(i))); }
    const key = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`;
    const floorEdge = new Set<string>();
    for (let i = 0; i < fp.count; i++) {
      const [x, y, z] = [fp.getX(i), fp.getY(i), fp.getZ(i)];
      if (Math.abs(x) === maxX || Math.abs(z) === maxZ) floorEdge.add(key(x, y, z));
    }
    const rp = ring.getAttribute("position");
    const ringEdge = new Set<string>();
    for (let i = 0; i < rp.count; i++) {
      const [x, y, z] = [rp.getX(i), rp.getY(i), rp.getZ(i)];
      if (y === 0 && Math.abs(x) <= maxX && Math.abs(z) <= maxZ) ringEdge.add(key(x, y, z));
    }
    // 85 cells along the hall and 43 across: every one of the floor's edge vertices, bit for bit, and no other.
    expect(floorEdge.size).toBe(2 * (85 + 43));
    expect([...ringEdge].sort()).toEqual([...floorEdge].sort());
  });

  it("winds every triangle to face along its normal, and turns no face down", () => {
    for (const t of triangles) {
      expect(dot(cross(sub(t.b, t.a), sub(t.c, t.a)), t.normal)).toBeGreaterThan(0);
      expect(t.normal[1]).toBeGreaterThan(-0.5);
    }
  });

  it("turns its sides outward, on its outer edges, below the floor's level", () => {
    const sides = triangles.filter((t) => Math.abs(t.normal[1]) < 1e-6);
    expect(sides.length).toBeGreaterThan(0);
    for (const t of sides) {
      const [x, y, z] = centroid(t);
      const acrossX = Math.abs(t.normal[0]) > 0.5;
      const edge = acrossX ? (x > 0 ? EXTENTS.xMax : EXTENTS.xMin) : (z > 0 ? EXTENTS.zMax : EXTENTS.zMin);
      expect(acrossX ? x : z).toBeCloseTo(edge, 5);
      expect(Math.sign(acrossX ? x : z)).toBe(Math.sign(acrossX ? t.normal[0] : t.normal[2]));
      expect(y).toBeLessThan(0);
    }
  });

  it("is one light mesh", () => {
    expect(triangles.length).toBeLessThan(1500);
  });
});
