import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { HALL_CUTS } from "../GrandHallModel.js";
import { buildHallGeometry, buildHallThresholdGeometry, buildHallWallGeometry } from "../hall-geometry.js";
import { parseWallRelief, type WallRelief } from "../hall-relief.js";
import { buildPlinthRing } from "../hall-section.js";
import { sharedNeighbour } from "../hall-walls.js";
import {
  BODY_FINISH,
  BODY_ROLE,
  DOOR_SLOTS,
  LINTEL_RELEASE,
  OPENING_RELIEF,
  THRESHOLD_HEIGHT,
  WALL_BODY_TOP,
  bodyOpenings,
  bodyThicknessAt,
  bodyVertexHeight,
  buildWallBody,
  chainAt,
  insideHole,
  reliefVisible,
  type BodyRole,
} from "../hall-wall-body.js";
import {
  HALL_DOORS,
  HALL_OPENINGS,
  HALL_WALLS,
  HALL_WALL_STRETCHES,
  HALL_WALL_THICKNESS,
  hallDoor,
  hallWall,
  wallPoint,
  wallThicknessAt,
  type HallWall,
} from "../hall-spec.js";

type Vec3 = readonly [number, number, number];

interface Tri {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  /** The normal stored on its first vertex. */
  readonly n: Vec3;
  readonly source: string;
}

const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len = (u: Vec3): number => Math.hypot(u[0], u[1], u[2]);
const unit = (u: Vec3): Vec3 => { const l = len(u); return [u[0] / l, u[1] / l, u[2] / l]; };

function trianglesOf(geometry: BufferGeometry, source: string, keep: (uv: readonly [number, number]) => boolean = () => true): Tri[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.hasAttribute("uv") ? geometry.getAttribute("uv") : null;
  const index = geometry.getIndex();
  const count = index === null ? position.count : index.count;
  const vertex = (k: number): number => (index === null ? k : index.getX(k));
  const at = (i: number): Vec3 => [position.getX(i), position.getY(i), position.getZ(i)];
  const out: Tri[] = [];
  for (let k = 0; k < count; k += 3) {
    const [i, j, l] = [vertex(k), vertex(k + 1), vertex(k + 2)];
    if (!keep([uv?.getX(i) ?? 0, uv?.getY(i) ?? 0])) continue;
    out.push({ a: at(i), b: at(j), c: at(l), n: [normal.getX(i), normal.getY(i), normal.getZ(i)], source });
  }
  return out;
}

/** The body's triangles as the shader shows them for each wall's cut (HALL_WALLS order). */
function shownBody(geometry: BufferGeometry, cuts: readonly number[]): Tri[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const tag = geometry.getAttribute("aSection");
  const shape = geometry.getAttribute("aShape");
  const index = geometry.getIndex();
  if (index === null) throw new Error("the body is indexed");
  const cutOf = (wall: number): number => (wall < -0.5 ? 1000 : cuts[Math.round(wall)] ?? 1000);
  const moved = (i: number): Vec3 | null => {
    const cut = Math.min(cutOf(tag.getX(i)), cutOf(tag.getY(i)));
    const y = bodyVertexHeight(position.getY(i), shape.getX(i), Math.round(tag.getZ(i)) as BodyRole, cut);
    return y === null ? null : [position.getX(i), y, position.getZ(i)];
  };
  const out: Tri[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const ids = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const [a, b, c] = ids.map(moved);
    if (a === null || b === null || c === null || a === undefined || b === undefined || c === undefined) continue;
    const i0 = ids[0] ?? 0;
    const cut = Math.min(cutOf(tag.getX(i0)), cutOf(tag.getY(i0)));
    // Whatever still stands above the cut is discarded by the section's mask.
    if (Math.min(a[1], b[1], c[1]) > cut + 0.002) continue;
    if (len(cross(sub(b, a), sub(c, a))) < 1e-10) continue;
    out.push({ a, b, c, n: [normal.getX(i0), normal.getY(i0), normal.getZ(i0)], source: "body" });
  }
  return out;
}

function shippedRelief(): WallRelief {
  const file = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
  return parseWallRelief(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
}

const NONE = HALL_CUTS.none;
const ALL_NONE = [NONE, NONE, NONE, NONE];
const ALL_PLAN = [HALL_CUTS.plan, HALL_CUTS.plan, HALL_CUTS.plan, HALL_CUTS.plan];
/** The opening view: the door wall cut at the dado, the end wall part-way, the far walls whole. */
const OPENING_VIEW = [NONE, 5.96, HALL_CUTS.near, NONE];
const wallIndex = (id: HallWall["id"]): number => HALL_WALLS.findIndex((wall) => wall.id === id);

/** Wall-local (u, d) of a world point. */
function local(wall: HallWall, p: Vec3): { u: number; d: number } {
  const rx = p[0] - wall.origin[0];
  const rz = p[2] - wall.origin[2];
  return { u: rx * wall.tangent[0] + rz * wall.tangent[2], d: rx * wall.normal[0] + rz * wall.normal[2] };
}

/** Whether a triangle's projection onto two coordinates contains the point. */
function contains2(t: Tri, axes: readonly [0 | 1 | 2, 0 | 1 | 2], x: number, y: number, slack = 1e-6): boolean {
  const [i, j] = axes;
  const ax = t.a[i], ay = t.a[j], bx = t.b[i], by = t.b[j], cx = t.c[i], cy = t.c[j];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return false;
  const s = Math.sign(area);
  const edge = (px: number, py: number, qx: number, qy: number): number => s * ((qx - px) * (y - py) - (qy - py) * (x - px)) / Math.hypot(qx - px, qy - py);
  return edge(ax, ay, bx, by) >= -slack && edge(bx, by, cx, cy) >= -slack && edge(cx, cy, ax, ay) >= -slack;
}

describe("the Grand Hall's doors and walls, as measured", () => {
  it("has four doors: three in the door wall and the fire exit in the fireplace wall", () => {
    const doors = HALL_OPENINGS.filter((opening) => opening.kind === "door");
    expect(doors).toHaveLength(4);
    expect(doors.filter((opening) => opening.wall === "door")).toHaveLength(3);
    const exit = doors.find((opening) => opening.id === "door-fire-exit");
    expect(exit?.wall).toBe("fireplace");
    expect(exit?.centre).toBeCloseTo(8.53, 3);
    // Between the chimney breast and the window wall, at z -3.235.
    if (exit !== undefined) expect(wallPoint(hallWall("fireplace"), exit.centre, 1)[2]).toBeCloseTo(-3.235, 3);
    for (const door of doors) {
      expect(hallDoor(door.id)).toBeDefined();
      // Every door's head under the Plan cut and the lintels' release.
      expect(door.head).toBeLessThan(HALL_CUTS.plan);
      expect(door.head).toBeLessThan(LINTEL_RELEASE);
    }
    expect(exit?.head ?? 9).toBeLessThan(HALL_CUTS.near);
    expect(HALL_CUTS.plan).toBeLessThan(LINTEL_RELEASE);
    expect(HALL_DOORS).toHaveLength(4);
  });

  it("takes the door widths from the scan's jambs", () => {
    expect(HALL_OPENINGS.find((opening) => opening.id === "door-end")?.width).toBeCloseTo(1.1, 3);
    expect(HALL_OPENINGS.find((opening) => opening.id === "door-main")?.width).toBeCloseTo(1.45, 3);
  });

  it("states where every thickness comes from, and keeps every departure inside its wall", () => {
    for (const wall of HALL_WALLS) {
      expect(HALL_WALL_THICKNESS[wall.id].source.length).toBeGreaterThan(10);
      for (const stretch of HALL_WALL_STRETCHES[wall.id]) {
        expect(stretch.source.length).toBeGreaterThan(10);
        expect(stretch.from).toBeGreaterThanOrEqual(0);
        expect(stretch.to).toBeLessThanOrEqual(wall.length + 1e-9);
        expect(stretch.to).toBeGreaterThan(stretch.from);
        expect(wallThicknessAt(wall.id, (stretch.from + stretch.to) / 2)).toBe(stretch.thickness);
      }
    }
    for (const door of HALL_DOORS) {
      expect(door.depth).toBeGreaterThan(0.4);
      expect(door.source.length).toBeGreaterThan(10);
    }
  });
});

describe("the walls' bodies", () => {
  const body = buildWallBody();
  const rest = shownBody(body.geometry, ALL_NONE);

  it("stays within its budget: one draw for every wall's body, 6k triangles", () => {
    expect(body.stats.triangles).toBeLessThanOrEqual(6000);
    expect(body.stats.triangles).toBeGreaterThan(500);
  });

  it("winds every triangle to face along its stored normal", () => {
    for (const t of trianglesOf(body.geometry, "body")) {
      const g = cross(sub(t.b, t.a), sub(t.c, t.a));
      if (len(g) < 1e-12) continue;
      expect(dot(unit(g), t.n)).toBeGreaterThan(0.999);
    }
  });

  it("has an outer face at each wall's own thickness everywhere but through its openings", () => {
    for (const wall of HALL_WALLS) {
      const openings = bodyOpenings(wall);
      const outward: Vec3 = [-wall.normal[0], 0, -wall.normal[2]];
      const faces = rest.filter((t) => dot(t.n, outward) > 0.999);
      // Bucket the faces by u so each sample tests a few.
      const buckets = new Map<number, Tri[]>();
      for (const t of faces) {
        const us = [t.a, t.b, t.c].map((p) => local(wall, p).u);
        for (let k = Math.floor(Math.min(...us) / 0.5); k <= Math.floor(Math.max(...us) / 0.5); k++) {
          const list = buckets.get(k) ?? [];
          list.push(t);
          buckets.set(k, list);
        }
      }
      const axis: 0 | 2 = Math.abs(wall.tangent[0]) > 0.5 ? 0 : 2;
      const wrong: string[] = [];
      let samples = 0;
      for (let u = 0.025; u < wall.length; u += 0.05) {
        const thickness = bodyThicknessAt(wall, openings, u);
        for (let v = 0.025; v < WALL_BODY_TOP; v += 0.05) {
          samples += 1;
          const hole = openings.some((entry) => insideHole(entry.back, u, v));
          const p = wallPoint(wall, u, v, -thickness);
          const hit = (buckets.get(Math.floor(u / 0.5)) ?? []).some((t) => {
            const d = local(wall, t.a).d;
            return Math.abs(d + thickness) < 1e-5 && contains2(t, [axis, 1], p[axis], p[1]);
          });
          if (hit === hole) wrong.push(`${wall.id} u ${u.toFixed(3)} v ${v.toFixed(3)} ${hole ? "covered in a hole" : "open"}`);
        }
      }
      expect(samples).toBeGreaterThan(10_000);
      expect(wrong.slice(0, 5)).toEqual([]);
    }
  });

  it("caps every wall flush at the relief's top when nothing is cut", () => {
    const tops = rest.filter((t) => t.n[1] > 0.999 && Math.abs(t.a[1] - WALL_BODY_TOP) < 1e-6);
    for (const wall of HALL_WALLS) {
      const openings = bodyOpenings(wall);
      const missing: string[] = [];
      for (let u = 0.03; u < wall.length; u += 0.1) {
        const thickness = bodyThicknessAt(wall, openings, u);
        for (let d = -0.01; d > -thickness; d -= 0.05) {
          const p = wallPoint(wall, u, WALL_BODY_TOP, d);
          if (!tops.some((t) => contains2(t, [0, 2], p[0], p[2]))) missing.push(`${wall.id} ${u.toFixed(2)} ${d.toFixed(2)}`);
        }
      }
      expect(missing.slice(0, 5)).toEqual([]);
    }
    // Nothing of the body stands above the relief's top.
    for (const t of rest) expect(Math.max(t.a[1], t.b[1], t.c[1])).toBeLessThanOrEqual(WALL_BODY_TOP + 1e-6);
  });

  it("cuts each wall through its full thickness in Plan, open at every door", () => {
    const plan = shownBody(body.geometry, ALL_PLAN);
    const caps = plan.filter((t) => t.n[1] > 0.99 && Math.abs(t.a[1] - HALL_CUTS.plan) < 1e-5);
    for (const wall of HALL_WALLS) {
      const openings = bodyOpenings(wall);
      for (let u = 0.3; u < wall.length; u += 0.7) {
        if (openings.some((entry) => u > entry.front.u0 - 0.05 && u < entry.front.u1 + 0.05)) continue;
        const thickness = bodyThicknessAt(wall, openings, u);
        const covered = (d: number): boolean => { const p = wallPoint(wall, u, HALL_CUTS.plan, d); return caps.some((t) => contains2(t, [0, 2], p[0], p[2])); };
        expect(covered(-0.01)).toBe(true);
        expect(covered(-thickness + 0.01)).toBe(true);
        expect(covered(-thickness - 0.01)).toBe(false);
      }
    }
    // Every door reads from above: nothing of the body over its middle, mid-depth, at 0.6 m.
    for (const wall of HALL_WALLS) {
      for (const entry of bodyOpenings(wall)) {
        if (entry.door === null) continue;
        const p = wallPoint(wall, entry.opening.centre, 0.6, -entry.door.depth / 2);
        const above = plan.filter((t) => contains2(t, [0, 2], p[0], p[2]) && Math.max(t.a[1], t.b[1], t.c[1]) > 0.6);
        expect(above.map((t) => t.source)).toEqual([]);
      }
    }
  });

  it("opens the fire exit under the dado cut, though its head is lower", () => {
    const cuts: number[] = [NONE, NONE, NONE, NONE];
    cuts[wallIndex("fireplace")] = HALL_CUTS.near;
    const shown = shownBody(body.geometry, cuts);
    const wall = hallWall("fireplace");
    const exit = bodyOpenings(wall).find((entry) => entry.opening.id === "door-fire-exit");
    expect(exit?.door).not.toBeNull();
    if (exit === undefined || exit.door === null) return;
    const p = wallPoint(wall, exit.opening.centre, 0.6, -exit.door.depth / 2);
    expect(shown.filter((t) => contains2(t, [0, 2], p[0], p[2]) && Math.max(t.a[1], t.b[1], t.c[1]) > 0.6)).toEqual([]);
  });

  it("drops the relief over each doorway with its lintel, so the doorway reads from above", () => {
    expect(DOOR_SLOTS.map((slot) => slot.opening).sort()).toEqual(["door-end", "door-fire-exit", "door-fireplace", "door-main"]);
    for (const slot of DOOR_SLOTS) {
      const mid = (slot.u0 + slot.u1) / 2;
      const cuts: number[] = [NONE, NONE, NONE, NONE];
      // Whole walls keep the walling over their doors.
      expect(reliefVisible(slot.wall, -1, mid, slot.head + 0.3, cuts)).toBe(true);
      // Cut to Plan (or the dado, for the fire exit), the relief over the door goes; beside it and under the head it stays.
      const cut = slot.head + 0.4 < HALL_CUTS.plan ? HALL_CUTS.plan : HALL_CUTS.near;
      cuts[slot.wall] = cut;
      expect(reliefVisible(slot.wall, -1, mid, Math.min(slot.head + 0.03, cut - 0.01), cuts)).toBe(false);
      expect(reliefVisible(slot.wall, -1, mid, slot.head - 0.2, cuts)).toBe(true);
      expect(reliefVisible(slot.wall, -1, slot.u0 - 0.05, Math.min(slot.head + 0.03, cut - 0.01), cuts)).toBe(true);
      // Cut higher than the release, the walling over the door stays.
      cuts[slot.wall] = 5;
      expect(reliefVisible(slot.wall, -1, mid, slot.head + 0.3, cuts)).toBe(true);
    }
    // Relief in a corner takes the lower of its two walls' cuts.
    expect(reliefVisible(wallIndex("end"), wallIndex("door"), 10.4, 3, OPENING_VIEW)).toBe(false);
    expect(reliefVisible(wallIndex("end"), -1, 10.4, 3, OPENING_VIEW)).toBe(true);
  });

  it("keeps the lintels whole above the release, and drops them with every lower cut", () => {
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, HALL_CUTS.plan)).toBeNull();
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, HALL_CUTS.near)).toBeNull();
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, 5)).toBe(5);
    expect(bodyVertexHeight(2.35, 2.35, BODY_ROLE.lintel, 2)).toBeNull();
    expect(bodyVertexHeight(6.7, 0, BODY_ROLE.lintelJamb, 5)).toBeNull();
    expect(bodyVertexHeight(6.7, 0, BODY_ROLE.lintelJamb, HALL_CUTS.plan)).toBe(HALL_CUTS.plan);
    // A sill's top shows only while the cut lies below it.
    expect(bodyVertexHeight(0.935, 0, BODY_ROLE.capOnly, NONE)).toBeNull();
    expect(bodyVertexHeight(0.935, 0, BODY_ROLE.capOnly, 0.5)).toBe(0.5);
    // A piece wholly above the cut collapses onto its floor (and the mask discards it).
    expect(bodyVertexHeight(6.7, 3.3, BODY_ROLE.body, 1.96)).toBe(3.3);
  });

  it("stands each corner block no higher than the lower of its two walls' cuts", () => {
    const tag = body.geometry.getAttribute("aSection");
    // Four blocks, each tagged with both of its walls.
    const pairs = new Set<string>();
    for (let i = 0; i < tag.count; i++) if (tag.getY(i) >= 0) pairs.add(`${String(tag.getX(i))}-${String(tag.getY(i))}`);
    expect(pairs.size).toBe(4);
    const shown = shownBody(body.geometry, OPENING_VIEW);
    const door = hallWall("door");
    const end = hallWall("end");
    // The door/end corner block: wholly beyond both walls' planes (the walls' own end faces lie on them).
    const centre = (t: Tri): Vec3 => [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3];
    const inCorner = shown.filter((t) => local(door, centre(t)).d < -1e-4 && local(end, centre(t)).d < -1e-4);
    expect(inCorner.length).toBeGreaterThan(0);
    for (const t of inCorner) expect(Math.max(t.a[1], t.b[1], t.c[1])).toBeLessThanOrEqual(HALL_CUTS.near + 1e-6);
    // The end wall itself stands to its own cut.
    const endWall = shown.filter((t) => { const c = local(end, centre(t)); return c.d < 0 && c.u > 0.5 && c.u < 10; });
    expect(Math.max(...endWall.map((t) => Math.max(t.a[1], t.b[1], t.c[1])))).toBeCloseTo(5.96, 6);
  });

  it("lines a doorway only behind the relief, and a window only where its reveal stops", () => {
    const tag = body.geometry.getAttribute("aSection");
    const shape = body.geometry.getAttribute("aShape");
    const position = body.geometry.getAttribute("position");
    let doors = 0;
    let windows = 0;
    for (let i = 0; i < tag.count; i++) {
      const finish = Math.round(tag.getW(i));
      if (finish !== BODY_FINISH.doorLining && finish !== BODY_FINISH.windowLining) continue;
      const wall = HALL_WALLS[Math.round(tag.getX(i))];
      if (wall === undefined) continue;
      const u = local(wall, [position.getX(i), 0, position.getZ(i)]).u;
      const near = bodyOpenings(wall).find((entry) => u > entry.front.u0 - 0.01 && u < entry.front.u1 + 0.01);
      expect(near).toBeDefined();
      if (near === undefined) continue;
      expect(-shape.getY(i)).toBeLessThanOrEqual(near.liningFrom + 1e-6);
      if (finish === BODY_FINISH.doorLining) doors += 1;
      else windows += 1;
    }
    expect(doors).toBeGreaterThan(0);
    expect(windows).toBeGreaterThan(0);
  });
});

describe("the walls' bodies against the scanned relief", () => {
  const relief = shippedRelief();

  /** The relief's depth on a 1 cm grid over a box of one wall (the frontmost surface), interpolated. */
  function depthGrid(wallId: HallWall["id"], u0: number, u1: number, v0: number, v1: number): (u: number, v: number) => number {
    const mesh = relief.get(wallId);
    if (mesh === undefined) throw new Error(`no relief for ${wallId}`);
    const step = 0.01;
    const nu = Math.ceil((u1 - u0) / step) + 1;
    const nv = Math.ceil((v1 - v0) / step) + 1;
    const grid = new Float32Array(nu * nv).fill(Number.NaN);
    const { positions: p, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const pts = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0].map((i) => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0] as const);
      const [A, B, C] = pts;
      if (A === undefined || B === undefined || C === undefined) continue;
      const minU = Math.min(A[0], B[0], C[0]);
      const maxU = Math.max(A[0], B[0], C[0]);
      const minV = Math.min(A[1], B[1], C[1]);
      const maxV = Math.max(A[1], B[1], C[1]);
      if (maxU < u0 || minU > u1 || maxV < v0 || minV > v1) continue;
      const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(det) < 1e-14) continue;
      for (let i = Math.max(0, Math.ceil((minU - u0) / step)); i <= Math.min(nu - 1, Math.floor((maxU - u0) / step)); i++) {
        for (let j = Math.max(0, Math.ceil((minV - v0) / step)); j <= Math.min(nv - 1, Math.floor((maxV - v0) / step)); j++) {
          const u = u0 + i * step;
          const v = v0 + j * step;
          const wa = ((B[1] - C[1]) * (u - C[0]) + (C[0] - B[0]) * (v - C[1])) / det;
          const wb = ((C[1] - A[1]) * (u - C[0]) + (A[0] - C[0]) * (v - C[1])) / det;
          const wc = 1 - wa - wb;
          if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
          const d = wa * A[2] + wb * B[2] + wc * C[2];
          const k = j * nu + i;
          const existing = grid[k] ?? Number.NaN;
          grid[k] = Number.isNaN(existing) ? d : Math.max(existing, d);
        }
      }
    }
    const cell = (i: number, j: number): number => (i < 0 || j < 0 || i >= nu || j >= nv ? Number.NaN : grid[j * nu + i] ?? Number.NaN);
    return (u, v) => {
      const x = (u - u0) / step;
      const y = (v - v0) / step;
      const i = Math.floor(x);
      const j = Math.floor(y);
      const fx = x - i;
      const fy = y - j;
      return (cell(i, j) * (1 - fx) + cell(i + 1, j) * fx) * (1 - fy) + (cell(i, j + 1) * (1 - fx) + cell(i + 1, j + 1) * fx) * fy;
    };
  }

  /** Where the relief crosses 5 cm behind the plane along a line, as an offset outward from (u, v). */
  function crossing(depth: (u: number, v: number) => number, u: number, v: number, inwardU: number): number | null {
    let previous: readonly [number, number] | null = null;
    for (let k = -100; k <= 100; k++) {
      const s = k * 0.002;
      const d = depth(u + inwardU * s, v);
      if (Number.isNaN(d)) { previous = null; continue; }
      if (previous !== null && previous[1] >= -0.05 && d < -0.05) {
        const t = (previous[1] + 0.05) / (previous[1] - d);
        return -(previous[0] + (s - previous[0]) * t);
      }
      previous = [s, d];
    }
    return null;
  }

  const median = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  };

  it("opens each hole's jambs where the relief goes behind the wall, within 5 mm (medians)", () => {
    const corners: string[] = [];
    for (const wall of HALL_WALLS) {
      for (const entry of bodyOpenings(wall)) {
        const { front, opening } = entry;
        const head = Math.max(...front.upper.map((p) => p[1]));
        const sill = chainAt(front.lower, opening.centre);
        const depth = depthGrid(wall.id, front.u0 - 0.3, front.u1 + 0.3, Math.max(0, sill - 0.3), Math.min(6.7, head + 0.3));
        const springing = opening.kind === "arched-window" ? opening.head : head;
        const left: number[] = [];
        const right: number[] = [];
        for (let v = sill + 0.15; v < springing - 0.1; v += 0.01) {
          const l = crossing(depth, front.u0, v, 1);
          const r = crossing(depth, front.u1, v, -1);
          if (l !== null) left.push(l);
          if (r !== null) right.push(r);
        }
        const measured = OPENING_RELIEF.find((item) => item.opening === opening.id);
        if (measured !== undefined && measured.left === 0 && measured.right === 0) {
          // A door closed flush in its wall: no relief 5 cm behind the wall inside it.
          expect(left.length + right.length).toBeLessThan(20);
          continue;
        }
        for (const [side, values] of [["left", left], ["right", right]] as const) {
          // An end arch's corner-side jamb opens on into a side light: no crossing there.
          if (values.length < 20) { corners.push(`${opening.id} ${side}`); continue; }
          expect(Math.abs(median(values))).toBeLessThanOrEqual(0.005);
        }
      }
    }
    expect(corners.sort()).toEqual(["arch-end right", "arch-fireplace left", "door-end right"].sort());
  });

  it("reaches past the deepest relief in every opening before the body begins", () => {
    for (const wall of HALL_WALLS) {
      for (const entry of bodyOpenings(wall)) {
        const { front } = entry;
        const head = Math.max(...front.upper.map((p) => p[1]));
        const sill = chainAt(front.lower, entry.opening.centre);
        const depth = depthGrid(wall.id, front.u0, front.u1, sill, head);
        let deepest = 0;
        for (let u = front.u0 + 0.01; u < front.u1 - 0.01; u += 0.01) {
          for (let v = sill + 0.01; v < chainAt(front.upper, u) - 0.01; v += 0.01) {
            const d = depth(u, v);
            if (!Number.isNaN(d)) deepest = Math.min(deepest, d);
          }
        }
        expect(deepest).toBeGreaterThan(entry.frontDepth);
        expect(Math.abs(deepest - (OPENING_RELIEF.find((item) => item.opening === entry.opening.id)?.deepest ?? 0))).toBeLessThan(0.005);
      }
    }
  });

  it("finds no relief inside another wall's body or beyond its own outer face", () => {
    let inside = 0;
    for (const wall of HALL_WALLS) {
      const mesh = relief.get(wall.id);
      if (mesh === undefined) continue;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const u = mesh.positions[i] ?? 0;
        const depth = mesh.positions[i + 2] ?? 0;
        const p = wallPoint(wall, u, 0, depth);
        if (depth < -wallThicknessAt(wall.id, u) - 0.02) inside += 1;
        for (const other of HALL_WALLS) if (other !== wall && local(other, p).d < -0.02) inside += 1;
      }
    }
    // Recorded 20 October 2026 on the shipped relief: none.
    expect(inside).toBe(0);
  });

  it("gives what stands in a corner against the neighbouring wall that wall's cut too", () => {
    let shared = 0;
    let missed = 0;
    HALL_WALLS.forEach((wall, index) => {
      const mesh = relief.get(wall.id);
      if (mesh === undefined) return;
      const { positions: p, indices } = mesh;
      for (let t = 0; t < indices.length; t += 3) {
        const corners = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0].map((i) => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0] as const);
        const us = corners.map((c) => c[0]);
        const nearCorner = Math.min(Math.min(...us), wall.length - Math.max(...us));
        if (sharedNeighbour(index, wall.length, corners) >= 0) {
          shared += 1;
          // Only in a corner.
          expect(nearCorner).toBeLessThan(0.85);
        } else if (Math.max(...corners.map((c) => c[2])) > 0.4 && nearCorner < 0.3) {
          missed += 1;
        }
      }
    });
    expect(shared).toBeGreaterThan(50);
    expect(missed).toBe(0);
  });

  it("puts no two surfaces in the same plane over the same ground", () => {
    const room = buildHallGeometry();
    const walls = buildHallWallGeometry(relief);
    const thresholds = buildHallThresholdGeometry();
    const body = buildWallBody();
    const floor = room.geometries.get("floor");
    const paint = room.geometries.get("paint");
    const sills = thresholds.geometries.get("floor");
    if (floor === undefined || paint === undefined || sills === undefined) throw new Error("missing geometry");
    // The windows' outer reveals: the "paint" faces outside the glass (uv.x 1; the glazing bars are 0).
    const fixed: Tri[] = [...trianglesOf(floor, "floor"), ...trianglesOf(buildPlinthRing(), "ring"), ...trianglesOf(sills, "thresholds"), ...trianglesOf(paint, "reveals", (uv) => uv[0] > 0.5)];
    for (const [key, geometry] of walls.geometries) fixed.push(...trianglesOf(geometry, `relief-${key}`));
    for (const cuts of [ALL_NONE, ALL_PLAN, OPENING_VIEW]) {
      expect(coplanarOverlaps([...fixed, ...shownBody(body.geometry, cuts)]).slice(0, 5)).toEqual([]);
    }
  });

  it("sets the thresholds above the floor's level, through each doorway's depth", () => {
    const sills = buildHallThresholdGeometry().geometries.get("floor");
    expect(sills).toBeDefined();
    if (sills === undefined) return;
    const tops = trianglesOf(sills, "thresholds").filter((t) => t.n[1] > 0.999);
    expect(tops.length).toBe(2 * 4);
    for (const t of tops) for (const p of [t.a, t.b, t.c]) expect(p[1]).toBeCloseTo(THRESHOLD_HEIGHT, 9);
  });
});

/** Pairs from different meshes (or within the body) in one plane (0.01 deg, 1 mm) sharing over 1 cm2. */
function coplanarOverlaps(triangles: readonly Tri[]): string[] {
  const cosLimit = Math.cos((0.01 * Math.PI) / 180);
  const planes = triangles.map((t) => {
    const g = cross(sub(t.b, t.a), sub(t.c, t.a));
    if (len(g) < 1e-12) return null;
    const n = unit(g);
    return { n, k: dot(n, t.a) };
  });
  const keyOf = (n: Vec3, k: number, dk: number): string => `${String(Math.round(n[0] * 200))},${String(Math.round(n[1] * 200))},${String(Math.round(n[2] * 200))},${String(Math.round(k / 0.002) + dk)}`;
  const buckets = new Map<string, number[]>();
  planes.forEach((plane, i) => {
    if (plane === null) return;
    const key = keyOf(plane.n, plane.k, 0);
    const list = buckets.get(key) ?? [];
    list.push(i);
    buckets.set(key, list);
  });
  const out: string[] = [];
  const seen = new Set<string>();
  planes.forEach((plane, i) => {
    const ti = triangles[i];
    if (plane === null || ti === undefined) return;
    for (const dk of [-1, 0, 1]) {
      for (const j of buckets.get(keyOf(plane.n, plane.k, dk)) ?? []) {
        if (j <= i) continue;
        const tj = triangles[j];
        const other = planes[j];
        if (tj === undefined || other === null || other === undefined) continue;
        // One height field or one planar mesh never overlaps itself; the body is checked against itself.
        if (tj.source === ti.source && ti.source !== "body") continue;
        if (dot(plane.n, other.n) < cosLimit || Math.abs(plane.k - other.k) > 0.001) continue;
        const area = overlapArea(ti, tj, plane.n);
        if (area > 1e-4) {
          const key = `${ti.source}|${tj.source}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push(`${key} ${area.toFixed(5)} m2 at ${ti.a.map((c) => c.toFixed(3)).join(",")}`);
          }
        }
      }
    }
  });
  return out;
}

/** The area two coplanar triangles share. */
function overlapArea(p: Tri, q: Tri, n: Vec3): number {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = unit(cross(helper, n));
  const e2 = cross(n, e1);
  const flat = (t: Tri): [number, number][] => [t.a, t.b, t.c].map((v): [number, number] => [dot(v, e1), dot(v, e2)]);
  const ccw = (poly: [number, number][]): [number, number][] => (signedArea(poly) < 0 ? [...poly].reverse() : poly);
  let subject = ccw(flat(p));
  const clip = ccw(flat(q));
  for (let i = 0; i < clip.length && subject.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    if (a === undefined || b === undefined) continue;
    const side = (pt: [number, number]): number => (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    const next: [number, number][] = [];
    for (let k = 0; k < subject.length; k++) {
      const cur = subject[k];
      const prev = subject[(k + subject.length - 1) % subject.length];
      if (cur === undefined || prev === undefined) continue;
      const sc = side(cur);
      const sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) next.push(intersect(prev, cur, sp, sc));
        next.push(cur);
      } else if (sp >= 0) {
        next.push(intersect(prev, cur, sp, sc));
      }
    }
    subject = next;
  }
  return subject.length < 3 ? 0 : Math.abs(signedArea(subject));
}

function intersect(p: [number, number], q: [number, number], dp: number, dq: number): [number, number] {
  const t = dp / (dp - dq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

function signedArea(poly: readonly [number, number][]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a === undefined || b === undefined) continue;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}
