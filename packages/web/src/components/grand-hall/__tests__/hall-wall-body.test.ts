import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { HALL_CUTS } from "../GrandHallModel.js";
import { buildHallGeometry, buildHallThresholdGeometry, buildHallWallGeometry } from "../hall-geometry.js";
import { parseWallRelief, type WallRelief } from "../hall-relief.js";
import { SECTION_PRESETS, buildPlinthRing, elevationFinish } from "../hall-section.js";
import { REVEAL_SIDE_DEPTH, drawnRelief, sharedNeighbour } from "../hall-walls.js";
import { DOOR_WALLS, buildHallDoorGeometry, doorTarget, leafVertex, swingDirection } from "../hall-doors.js";
import { sashExtent, type SashExtent } from "../hall-glazing.js";
import {
  BAY_BOARDS,
  BAY_BOARD_CLEARANCE,
  BAY_FRONT,
  BAY_LINING_SET,
  BAY_SLOTS,
  BODY_FINISH,
  BODY_ROLE,
  DOOR_SLOTS,
  LINTEL_RELEASE,
  OPENING_RELIEF,
  THRESHOLD_HEIGHT,
  WALL_BODY_TOP,
  bayClearFrom,
  bodyOpenings,
  bodyThicknessAt,
  bodyVertexHeight,
  buildWallBody,
  chainAt,
  inClearedBay,
  insideHole,
  isBayRole,
  reliefVisible,
  type BaySlot,
  type BodyOpening,
  type BodyRole,
} from "../hall-wall-body.js";
import {
  HALL_DOORS,
  HALL_OPENINGS,
  HALL_WALLS,
  HALL_WALL_STRETCHES,
  HALL_WALL_THICKNESS,
  hallDoor,
  hallGlazing,
  hallWall,
  wallPoint,
  wallThicknessAt,
  type HallGlazing,
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

/**
 * The body's triangles as the shader shows them for each wall's cut
 * (HALL_WALLS order), without the real sky unless `sky`; `roles` keeps only
 * the triangles of the roles it accepts.
 */
function shownBody(geometry: BufferGeometry, cuts: readonly number[], options: { readonly sky?: boolean; readonly roles?: (role: BodyRole) => boolean } = {}): Tri[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const tag = geometry.getAttribute("aSection");
  const shape = geometry.getAttribute("aShape");
  const index = geometry.getIndex();
  if (index === null) throw new Error("the body is indexed");
  const cutOf = (wall: number): number => (wall < -0.5 ? 1000 : cuts[Math.round(wall)] ?? 1000);
  const roleOf = (i: number): BodyRole => Math.round(tag.getZ(i)) as BodyRole;
  const moved = (i: number): Vec3 | null => {
    const cut = Math.min(cutOf(tag.getX(i)), cutOf(tag.getY(i)));
    const y = bodyVertexHeight(position.getY(i), shape.getX(i), roleOf(i), cut, shape.getY(i), options.sky ?? false);
    return y === null ? null : [position.getX(i), y, position.getZ(i)];
  };
  const out: Tri[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const ids = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    if (options.roles !== undefined && !options.roles(roleOf(ids[0] ?? 0))) continue;
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

/** The doors' leaves as the shader shows them for each wall's cut: swung to their doors' targets, cut. */
function shownLeaves(geometry: BufferGeometry, cuts: readonly number[]): Tri[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const hingeAttribute = geometry.getAttribute("aHinge");
  const index = geometry.getIndex();
  if (index === null) throw new Error("the leaves are indexed");
  const out: Tri[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const ids = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const i0 = ids[0] ?? 0;
    const sense: 1 | -1 = hingeAttribute.getZ(i0) > 0 ? 1 : -1;
    const hinge = { x: hingeAttribute.getX(i0), z: hingeAttribute.getY(i0), sense, code: hingeAttribute.getW(i0) };
    const door = Math.round(hinge.code) % 4;
    const cut = cuts[DOOR_WALLS[door] ?? -1] ?? 1000;
    const angle = doorTarget(cut, false);
    const [a, b, c] = ids.map((i) => leafVertex([position.getX(i), position.getY(i), position.getZ(i)], hinge, cut, angle));
    if (a === null || b === null || c === null || a === undefined || b === undefined || c === undefined) continue;
    // Above the cut, discarded (doorLeafMask).
    if (Math.min(a[1], b[1], c[1]) > cut + 0.002) continue;
    if (len(cross(sub(b, a), sub(c, a))) < 1e-10) continue;
    const n = swingDirection([normal.getX(i0), normal.getY(i0), normal.getZ(i0)], hinge, angle);
    out.push({ a, b, c, n, source: `leaf ${hinge.x.toFixed(3)},${hinge.z.toFixed(3)}` });
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
/** Each wall's cut with the window wall at `cut` and the rest whole. */
const windowWallAt = (cut: number): number[] => ALL_NONE.map((none, index) => (index === wallIndex("window") ? cut : none));
/** The overview from Glassford Street: the window wall cut at the dado, the end wall part-way. */
const GLASSFORD_STREET = ALL_NONE.map((none, index) => (index === wallIndex("window") ? HALL_CUTS.near : index === wallIndex("end") ? 5.96 : none));

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
    // `reveal` (aShape.y) means nothing for these roles: their distance from the room's plane.
    const fromRoom = 0.4;
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, HALL_CUTS.plan, fromRoom)).toBeNull();
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, HALL_CUTS.near, fromRoom)).toBeNull();
    expect(bodyVertexHeight(6.7, 2.35, BODY_ROLE.lintel, 5, fromRoom)).toBe(5);
    expect(bodyVertexHeight(2.35, 2.35, BODY_ROLE.lintel, 2, fromRoom)).toBeNull();
    expect(bodyVertexHeight(6.7, 0, BODY_ROLE.lintelJamb, 5, fromRoom)).toBeNull();
    expect(bodyVertexHeight(6.7, 0, BODY_ROLE.lintelJamb, HALL_CUTS.plan, fromRoom)).toBe(HALL_CUTS.plan);
    // A sill's top shows only while the cut lies below it.
    expect(bodyVertexHeight(0.935, 0, BODY_ROLE.capOnly, NONE, fromRoom)).toBeNull();
    expect(bodyVertexHeight(0.935, 0, BODY_ROLE.capOnly, 0.5, fromRoom)).toBe(0.5);
    // A piece wholly above the cut collapses onto its floor (and the mask discards it).
    expect(bodyVertexHeight(6.7, 3.3, BODY_ROLE.body, 1.96, fromRoom)).toBe(3.3);
    expect(bodyVertexHeight(6.7, 3.3, BODY_ROLE.body, 1.96, 0)).toBe(3.3);
  });

  it("shows a cleared bay's faces only while the cut lies below the height they carry, and its back only without the real sky", () => {
    // A board laid at 0.96 m over a footprint's sill at 0.89 m, in a bay whose window's head is 3.305 m.
    const [board, sill, head] = [0.96, 0.89, 3.305];
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, NONE, head)).toBeNull();
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, head, head)).toBeNull();
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, head - 0.01, head)).toBe(board);
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, HALL_CUTS.near, head)).toBe(board);
    // Between the sill and the board, the board lies at the cut; under the sill, on the sill (above the cut, discarded).
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, 0.93, head)).toBe(0.93);
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, 0.5, head)).toBe(sill);
    // The daylit back: the same rule without the real sky, never with it.
    expect(bodyVertexHeight(2.5, sill, BODY_ROLE.bayBacking, HALL_CUTS.plan, head)).toBe(2.5);
    expect(bodyVertexHeight(2.5, sill, BODY_ROLE.bayBacking, HALL_CUTS.plan, head, true)).toBeNull();
    expect(bodyVertexHeight(2.5, sill, BODY_ROLE.bayBacking, NONE, head)).toBeNull();
    // The sky changes nothing else.
    expect(bodyVertexHeight(board, sill, BODY_ROLE.bay, HALL_CUTS.plan, head, true)).toBe(board);
    expect(bodyVertexHeight(6.7, 0, BODY_ROLE.body, HALL_CUTS.plan, 0.3, true)).toBe(HALL_CUTS.plan);
  });

  it("finishes as the section only faces that stand upright, square to their wall, which Ashlar alone draws as masonry in elevation", () => {
    expect(elevationFinish(SECTION_PRESETS.ashlar)).toBe(BODY_FINISH.section);
    expect(elevationFinish(SECTION_PRESETS.atelier)).toBeNull();
    expect(elevationFinish(SECTION_PRESETS.nocturne)).toBeNull();
    const tag = body.geometry.getAttribute("aSection");
    const normal = body.geometry.getAttribute("normal");
    let faces = 0;
    for (let i = 0; i < tag.count; i++) {
      if (Math.round(tag.getW(i)) !== BODY_FINISH.section) continue;
      faces += 1;
      expect(Math.abs(normal.getY(i))).toBeLessThan(1e-6);
      // A wall's end, a step in its outer face, a pier's side: u never changes across it (masonrySection's `endOn`).
      const wall = HALL_WALLS[Math.round(tag.getX(i))];
      if (wall === undefined) throw new Error("a section face without its wall");
      expect(Math.abs(normal.getX(i) * wall.tangent[0] + normal.getZ(i) * wall.tangent[2])).toBeGreaterThan(0.999);
    }
    expect(faces).toBeGreaterThan(0);
  });

  it("shows the end wall's end above the window wall's dado cut as the section, from its room edge to its outer face", () => {
    const end = hallWall("end");
    const e = wallIndex("end");
    const cut = 5.96;
    const position = body.geometry.getAttribute("position");
    const normal = body.geometry.getAttribute("normal");
    const tag = body.geometry.getAttribute("aSection");
    const shape = body.geometry.getAttribute("aShape");
    const back: Vec3 = [-end.tangent[0], 0, -end.tangent[2]];
    let top = 0;
    let room = Infinity;
    let deepest = 0;
    let outer = Infinity;
    for (let i = 0; i < tag.count; i++) {
      if (Math.round(tag.getX(i)) !== e || tag.getY(i) >= 0) continue;
      if (Math.abs(local(end, [position.getX(i), 0, position.getZ(i)]).u) > 1e-5) continue;
      if (dot([normal.getX(i), normal.getY(i), normal.getZ(i)], back) < 0.999) continue;
      expect(Math.round(tag.getW(i))).toBe(BODY_FINISH.section);
      const y = bodyVertexHeight(position.getY(i), shape.getX(i), Math.round(tag.getZ(i)) as BodyRole, cut, shape.getY(i));
      if (y !== null) top = Math.max(top, y);
      room = Math.min(room, shape.getY(i));
      deepest = Math.max(deepest, shape.getY(i));
      outer = Math.min(outer, shape.getZ(i));
    }
    expect(top).toBeCloseTo(cut, 5);
    expect(room).toBeCloseTo(0, 5);
    expect(deepest).toBeCloseTo(wallThicknessAt("end", 0), 5);
    expect(outer).toBeCloseTo(0, 5);
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
  const drawn = drawnRelief(relief);

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
        // The relief's own footprint (a doorway's hole is wider, DOOR_FRAME).
        const { footprint: front, opening } = entry;
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
        const front = entry.footprint;
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
        // The measure holds on the shipped relief.
        expect(Math.abs(deepest - (OPENING_RELIEF.find((item) => item.opening === entry.opening.id)?.deepest ?? 0))).toBeLessThan(0.005);
        if (entry.door === null) {
          expect(deepest).toBeGreaterThan(entry.frontDepth);
          continue;
        }
        // A doorway: its leaves' relief is not drawn (hall-doors.ts replaces it), and nothing of the
        // drawn relief inside it lies more than REVEAL_SIDE_DEPTH behind the leaves' face; the
        // lining starts in front of that, so the two overlap.
        const reveal = entry.door.leafFace - REVEAL_SIDE_DEPTH;
        expect(entry.frontDepth).toBeGreaterThan(reveal);
        const mesh = drawn.get(wall.id);
        if (mesh === undefined) throw new Error(wall.id);
        const { positions: p, indices } = mesh;
        for (let t = 0; t < indices.length; t += 3) {
          const c = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0].map((i): Vec3 => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0]);
          const [a, b, d] = c;
          if (a === undefined || b === undefined || d === undefined) continue;
          const u = (a[0] + b[0] + d[0]) / 3;
          const v = (a[1] + b[1] + d[1]) / 3;
          if (u <= entry.back.u0 || u >= entry.back.u1 || v >= entry.opening.head) continue;
          for (const q of c) expect(q[2], `${entry.opening.id} at u ${u.toFixed(3)} v ${v.toFixed(2)}`).toBeGreaterThanOrEqual(reveal - 1e-6);
        }
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
    // The glazing bars, which a cleared bay's board and sill meet. (Against the scanned relief, one bar face in
    // arch-fireplace, at x -9.212, y 3.286, lies within a millimetre of a scanned face over 2.4 cm2, the bars having been
    // measured on the scan: the bars are checked against everything but the relief.)
    const bars = trianglesOf(paint, "bars", (uv) => uv[0] < 0.5);
    const unscanned = fixed.filter((t) => !t.source.startsWith("relief-"));
    // The doors' leaves, shut on a walk and swung open wherever their wall is cut.
    const doors = buildHallDoorGeometry();
    // Every bay cleared: Plan, the overview from Glassford Street, and cuts between the bays' sills and their boards.
    for (const cuts of [ALL_NONE, ALL_PLAN, OPENING_VIEW, GLASSFORD_STREET, windowWallAt(0.95), windowWallAt(0.92)]) {
      const leaves = [...doors.geometries.values()].flatMap((geometry) => shownLeaves(geometry, cuts));
      expect(leaves.length).toBeGreaterThan(500);
      const shown = shownBody(body.geometry, cuts);
      expect(coplanarOverlaps([...fixed, ...shown, ...leaves]).slice(0, 5)).toEqual([]);
      expect(coplanarOverlaps([...unscanned, ...bars, ...shown]).slice(0, 5)).toEqual([]);
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

describe("a walk at each door", () => {
  const relief = shippedRelief();
  const walls = buildHallWallGeometry(relief);
  const body = shownBody(buildWallBody().geometry, ALL_NONE);
  const sills = buildHallThresholdGeometry().geometries.get("floor");
  const leaves = [...buildHallDoorGeometry().geometries.values()].flatMap((geometry) => shownLeaves(geometry, ALL_NONE));
  const scene: Tri[] = [...body, ...leaves, ...(sills === undefined ? [] : trianglesOf(sills, "thresholds"))];
  for (const [key, geometry] of walls.geometries) scene.push(...trianglesOf(geometry, `relief-${key}`));

  /**
   * Rays from an eye 2.8 m in front of a door (straight on, and 1.2 m to
   * either side) through a 6 mm grid on the wall's plane over the doorway
   * and 10 cm round it: each must meet a surface facing it (what the GPU
   * draws: every hall material culls back faces) before it is through the
   * wall's depth. A ray that gets through looks at the sky behind the wall.
   */
  it("sees the doorcase, the reveals and the shut leaves, never through the wall", () => {
    const escapes: string[] = [];
    for (const door of HALL_DOORS) {
      const opening = HALL_OPENINGS.find((entry) => entry.id === door.opening);
      const wall = opening === undefined ? undefined : hallWall(opening.wall);
      if (opening === undefined || wall === undefined) throw new Error(door.opening);
      const u0 = opening.centre - opening.width / 2 - 0.1;
      const u1 = opening.centre + opening.width / 2 + 0.1;
      const top = opening.head + 0.1;
      // Only what lies near the doorway can be met first.
      const near = scene.filter((t) => [t.a, t.b, t.c].some((p) => {
        const { u, d } = local(wall, p);
        return u > u0 - 1.2 && u < u1 + 1.2 && p[1] < top + 0.8 && d > -door.depth - 0.3 && d < 1.5;
      }));
      for (const side of [0, -1.2, 1.2]) {
        const eyeU = opening.centre + side;
        const eye = wallPoint(wall, eyeU, 1.6, 2.8);
        // Each triangle binned by where the eye sees it on the wall's plane (2 cm cells).
        const cell = 0.02;
        const columns = Math.ceil((u1 - u0) / cell) + 1;
        const bins = new Map<number, Tri[]>();
        for (const t of near) {
          const seen = [t.a, t.b, t.c].map((p) => {
            const { u, d } = local(wall, p);
            const s = 2.8 / (2.8 - d);
            return [eyeU + (u - eyeU) * s, 1.6 + (p[1] - 1.6) * s] as const;
          });
          const iu0 = Math.max(0, Math.floor((Math.min(...seen.map((q) => q[0])) - u0) / cell));
          const iu1 = Math.min(columns - 1, Math.floor((Math.max(...seen.map((q) => q[0])) - u0) / cell));
          const iv0 = Math.max(0, Math.floor(Math.min(...seen.map((q) => q[1])) / cell));
          const iv1 = Math.min(Math.ceil(top / cell), Math.floor(Math.max(...seen.map((q) => q[1])) / cell));
          for (let iu = iu0; iu <= iu1; iu++) {
            for (let iv = iv0; iv <= iv1; iv++) {
              const key = iv * columns + iu;
              const list = bins.get(key);
              if (list === undefined) bins.set(key, [t]);
              else list.push(t);
            }
          }
        }
        let lost = 0;
        let worst = "";
        for (let u = u0; u <= u1; u += 0.006) {
          for (let v = 0.03; v <= top; v += 0.006) {
            const aim = wallPoint(wall, u, v, 0);
            const dir = unit(sub(aim, eye));
            const hit = firstFrontHit(eye, dir, bins.get(Math.floor(v / cell) * columns + Math.floor((u - u0) / cell)) ?? []);
            const through = hit === null || local(wall, [eye[0] + dir[0] * hit, eye[1] + dir[1] * hit, eye[2] + dir[2] * hit]).d < -door.depth + 0.01;
            if (through) {
              lost += 1;
              worst = `u ${(u - opening.centre).toFixed(3)} from the centre, v ${v.toFixed(3)}`;
            }
          }
        }
        if (lost > 0) escapes.push(`${door.opening} from ${String(side)} m: ${String(lost)} rays, e.g. ${worst}`);
      }
    }
    expect(escapes).toEqual([]);
  });
});

/** Distance along a ray to the first triangle facing it (Moller-Trumbore, back faces culled), or null. */
function firstFrontHit(origin: Vec3, dir: Vec3, triangles: readonly Tri[]): number | null {
  let best: number | null = null;
  for (const t of triangles) {
    const e1 = sub(t.b, t.a);
    const e2 = sub(t.c, t.a);
    const p = cross(dir, e2);
    const det = dot(e1, p);
    // Counter-clockwise seen from the ray's origin, the face looks at it.
    if (det <= 1e-12) continue;
    const s = sub(origin, t.a);
    const bu = dot(s, p) / det;
    if (bu < -1e-7 || bu > 1 + 1e-7) continue;
    const q = cross(s, e1);
    const bv = dot(dir, q) / det;
    if (bv < -1e-7 || bu + bv > 1 + 1e-7) continue;
    const distance = dot(e2, q) / det;
    if (distance > 1e-4 && (best === null || distance < best)) best = distance;
  }
  return best;
}

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

/** The part of a triangle at or under a height (what the section's mask keeps of it). */
function clipBelow(t: Tri, cut: number): Tri[] {
  const points = [t.a, t.b, t.c];
  const kept: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const p = points[i];
    const q = points[(i + 1) % 3];
    if (p === undefined || q === undefined) continue;
    const pIn = p[1] <= cut;
    if (pIn) kept.push(p);
    if (pIn !== q[1] <= cut) {
      const s = (cut - p[1]) / (q[1] - p[1]);
      kept.push([p[0] + (q[0] - p[0]) * s, cut, p[2] + (q[2] - p[2]) * s]);
    }
  }
  const out: Tri[] = [];
  const first = kept[0];
  for (let k = 1; first !== undefined && k + 1 < kept.length; k++) {
    const b = kept[k];
    const c = kept[k + 1];
    if (b !== undefined && c !== undefined) out.push({ a: first, b, c, n: t.n, source: t.source });
  }
  return out;
}

describe("a window's bay, as the cut clears it", () => {
  const body = buildWallBody();
  const windowWall = wallIndex("window");
  const wall = hallWall("window");
  const inward: Vec3 = [wall.normal[0], 0, wall.normal[2]];
  const along: Vec3 = [wall.tangent[0], 0, wall.tangent[2]];
  const windows = bodyOpenings(wall).filter((entry) => entry.door === null);
  /**
   * A cut between every bay's footprint sill (0.857-0.929 m) and its board
   * (0.935-0.995 m): the overview's, from a camera about 1.55 m high outside
   * the window wall.
   */
  const LOW = 0.95;
  const tag = body.geometry.getAttribute("aSection");
  const shape = body.geometry.getAttribute("aShape");
  const position = body.geometry.getAttribute("position");
  const normal = body.geometry.getAttribute("normal");
  const glazingTriangles = (() => {
    const paint = buildHallGeometry().geometries.get("paint");
    if (paint === undefined) throw new Error("no glazing");
    return trianglesOf(paint, "glazing");
  })();

  /** Window `id`'s bay: how the body cuts it, its slot, its glazing and its sash. */
  function bay(id: string): { entry: BodyOpening; slot: BaySlot; glazing: HallGlazing; sash: SashExtent } {
    const entry = windows.find((item) => item.opening.id === id);
    const slot = BAY_SLOTS.find((item) => item.opening === id);
    const glazing = hallGlazing(id);
    if (entry === undefined || slot === undefined || glazing === undefined) throw new Error(id);
    return { entry, slot, glazing, sash: sashExtent(glazing) };
  }

  interface BayVertex { readonly u: number; readonly d: number; readonly y: number; readonly base: number; readonly reveal: number; readonly role: number; readonly finish: number; readonly n: Vec3 }

  /** The body's vertices of a cleared bay's faces in window `id`'s bay, wall-local. */
  function bayVertices(id: string): BayVertex[] {
    const { slot } = bay(id);
    const out: BayVertex[] = [];
    for (let i = 0; i < tag.count; i++) {
      const role = Math.round(tag.getZ(i));
      if (!isBayRole(role) || Math.round(tag.getX(i)) !== windowWall) continue;
      const q = local(wall, [position.getX(i), 0, position.getZ(i)]);
      if (q.u < slot.u0 - 1e-5 || q.u > slot.u1 + 1e-5) continue;
      out.push({ u: q.u, d: q.d, y: position.getY(i), base: shape.getX(i), reveal: shape.getY(i), role, finish: Math.round(tag.getW(i)), n: [normal.getX(i), normal.getY(i), normal.getZ(i)] });
    }
    return out;
  }

  /** Whether every corner of a triangle lies in window `id`'s bay along the wall. */
  const inBay = (id: string) => (t: Tri): boolean => {
    const { slot } = bay(id);
    return [t.a, t.b, t.c].every((p) => { const u = local(wall, p).u; return u > slot.u0 - 1e-5 && u < slot.u1 + 1e-5; });
  };

  it("keeps a bay for each of the five windows, out to its linings beyond the relief's footprint", () => {
    expect(BAY_SLOTS.map((slot) => slot.opening).sort()).toEqual(["arch-centre", "arch-end", "arch-fireplace", "window-end", "window-fireplace"]);
    for (const slot of BAY_SLOTS) {
      const { entry, glazing } = bay(slot.opening);
      const { opening } = entry;
      expect(slot.wall).toBe(windowWall);
      expect(slot.u0).toBeCloseTo(entry.front.u0 - BAY_LINING_SET, 9);
      expect(slot.u1).toBeCloseTo(entry.front.u1 + BAY_LINING_SET, 9);
      expect(slot.u0).toBeLessThan(opening.centre - opening.width / 2);
      expect(slot.u1).toBeGreaterThan(opening.centre + opening.width / 2);
      expect(slot.clearFrom).toBe(bayClearFrom(opening));
      expect(slot.clearFrom).toBeCloseTo(Math.max(opening.sill, BAY_BOARDS[opening.id] ?? Number.NaN) + BAY_BOARD_CLEARANCE, 9);
      expect(slot.head).toBe(opening.head);
      // The glass plane the scan saw stays: from at least 2 cm in front of the modelled glass.
      expect(slot.glass).toBeLessThan(-glazing.glassDepth - 0.02);
      expect(slot.glass).toBeGreaterThan(-glazing.glassDepth - 0.1);
    }
  });

  it("gives the shader each bay's frame: u along the window wall, depth behind its plane", () => {
    for (const slot of BAY_SLOTS) {
      for (const [u, behind] of [[slot.u0 + 0.1, 0.3], [slot.u1 - 0.1, -0.01]] as const) {
        const p = wallPoint(wall, u, 1.5, -behind);
        const dx = p[0] - slot.origin[0];
        const dz = p[2] - slot.origin[1];
        expect(dx * slot.tangent[0] + dz * slot.tangent[1]).toBeCloseTo(u, 9);
        expect(-(dx * slot.normal[0] + dz * slot.normal[1])).toBeCloseTo(behind, 9);
      }
    }
  });

  it("clears the curtains above the board once the wall is cut through the window, and keeps the board, the glass and the wall round it", () => {
    for (const cut of [HALL_CUTS.near, HALL_CUTS.plan]) {
      const cuts = windowWallAt(cut);
      for (const slot of BAY_SLOTS) {
        const mid = (slot.u0 + slot.u1) / 2;
        const curtain = Math.min(cut - 0.05, slot.clearFrom + 0.4);
        expect(reliefVisible(windowWall, -1, mid, curtain, cuts, 0.3)).toBe(false);
        // At the bay's mouth, where the curtains come forward to the plane.
        expect(reliefVisible(windowWall, -1, mid, curtain, cuts, BAY_FRONT + 0.005)).toBe(false);
        // Out to the linings.
        expect(reliefVisible(windowWall, -1, slot.u0 + 0.005, curtain, cuts, 0.3)).toBe(false);
        // The board, the glass the scan saw, the architrave in front of the plane and the wall beyond the linings stay.
        expect(reliefVisible(windowWall, -1, mid, slot.clearFrom - 0.03, cuts, 0.3)).toBe(true);
        expect(reliefVisible(windowWall, -1, mid, curtain, cuts, slot.glass + 0.01)).toBe(true);
        expect(reliefVisible(windowWall, -1, mid, curtain, cuts, BAY_FRONT - 0.03)).toBe(true);
        expect(reliefVisible(windowWall, -1, slot.u0 - 0.005, curtain, cuts, 0.3)).toBe(true);
        expect(reliefVisible(windowWall, -1, slot.u0 - 0.05, curtain, cuts, 0.3)).toBe(true);
      }
    }
  });

  it("leaves every bay whole on a walk and while its wall stands above the window's head", () => {
    for (const slot of BAY_SLOTS) {
      const mid = (slot.u0 + slot.u1) / 2;
      expect(reliefVisible(windowWall, -1, mid, 1.5, ALL_NONE, 0.3)).toBe(true);
      expect(inClearedBay(windowWall, mid, slot.head - 0.1, 0.3, slot.head)).toBe(false);
      expect(inClearedBay(windowWall, mid, slot.head - 0.1, 0.3, slot.head + 0.2)).toBe(false);
      expect(inClearedBay(windowWall, mid, slot.head - 0.1, 0.3, slot.head - 0.01)).toBe(true);
      // Another wall's relief at the same place along its wall is never a bay's.
      expect(inClearedBay(wallIndex("door"), mid, 1.5, 0.3, HALL_CUTS.near)).toBe(false);
    }
  });

  it("finds each window's board where the scanned relief's up-facing faces gather, within 5 mm, under the height the clearing starts at", () => {
    const mesh = shippedRelief().get("window");
    if (mesh === undefined) throw new Error("no relief for the window wall");
    const { positions: p, indices } = mesh;
    for (const opening of HALL_OPENINGS.filter((item) => item.wall === "window")) {
      const half = opening.width / 2;
      const from = opening.sill - 0.25;
      const bins = new Array<number>(60).fill(0);
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0].map((i): Vec3 => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0]);
        if (a === undefined || b === undefined || c === undefined) continue;
        const n = cross(sub(b, a), sub(c, a));
        const area = len(n) / 2;
        // Up-facing, in the bay behind the plane, across the window's width.
        if (area < 1e-12 || n[1] / (2 * area) < 0.85) continue;
        if (Math.abs((a[0] + b[0] + c[0]) / 3 - opening.centre) >= half - 0.04 || (a[2] + b[2] + c[2]) / 3 >= -0.1) continue;
        const bin = Math.floor(((a[1] + b[1] + c[1]) / 3 - from) / 0.01);
        if (bin >= 0 && bin < bins.length) bins[bin] = (bins[bin] ?? 0) + area;
      }
      const largest = Math.max(...bins);
      let top = -1;
      bins.forEach((value, bin) => { if (value >= largest * 0.25) top = bin; });
      const measured = from + (top + 1) * 0.01;
      expect(Math.abs(measured - (BAY_BOARDS[opening.id] ?? Number.NaN)), opening.id).toBeLessThanOrEqual(0.005);
      // The clearing keeps the scanned board whole.
      expect(measured, opening.id).toBeLessThan(bay(opening.id).slot.clearFrom - 0.005);
    }
  });

  it("builds none of a bay's faces on a walk, nor while its wall stands above the window's head, and every bay's once cut below it", () => {
    const bayFaces = (cuts: readonly number[], sky = false): Tri[] => shownBody(body.geometry, cuts, { sky, roles: isBayRole });
    expect(bayFaces(ALL_NONE)).toEqual([]);
    expect(bayFaces(ALL_NONE, true)).toEqual([]);
    expect(bayFaces(OPENING_VIEW)).toEqual([]);
    // Cut between the sashes' heads (3.305 m) and the arches' springing (3.76 m): the arches' bays alone.
    const between = bayFaces(windowWallAt(3.5));
    const cuts = [0.92, LOW, HALL_CUTS.near, HALL_CUTS.plan];
    const cleared = cuts.map((cut) => bayFaces(windowWallAt(cut)));
    for (const slot of BAY_SLOTS) {
      const mine = inBay(slot.opening);
      const { front } = bay(slot.opening).entry;
      expect(between.some(mine)).toBe(slot.head > 3.5);
      // Under its footprint's sill (window-end's 0.929 m, at 0.92) a bay lies wholly above the cut.
      cleared.forEach((shown, k) => {
        const cut = cuts[k] ?? 0;
        const count = shown.filter(mine).length;
        if (cut > chainAt(front.lower, slot.u0)) expect(count, `${slot.opening} at ${String(cut)}`).toBeGreaterThan(10);
        else expect(count, `${slot.opening} at ${String(cut)}`).toBe(0);
      });
    }
    // Every bay face lies in a bay.
    for (const t of cleared.flat()) expect(BAY_SLOTS.some((slot) => inBay(slot.opening)(t))).toBe(true);
  });

  it("lines each cleared bay in mahogany either side, set into the wall beyond its relief's footprint, from its sill to its head", () => {
    for (const entry of windows) {
      const { front, frontDepth, opening } = entry;
      for (const [u, facing] of [[front.u0 - BAY_LINING_SET, 1], [front.u1 + BAY_LINING_SET, -1]] as const) {
        const lining = bayVertices(opening.id).filter((v) => Math.abs(v.u - u) < 1e-5 && Math.abs(dot(v.n, along)) > 0.999);
        expect(lining, `${opening.id} at ${u.toFixed(3)}`).toHaveLength(4);
        for (const v of lining) {
          expect(v.role).toBe(BODY_ROLE.bay);
          expect(v.finish).toBe(BODY_FINISH.bayLining);
          // Facing into the bay, along the wall toward the window.
          expect(dot(v.n, along)).toBeCloseTo(facing, 6);
          expect(v.reveal).toBeCloseTo(opening.head, 5);
          expect(v.base).toBeCloseTo(chainAt(front.lower, u), 5);
        }
        expect(Math.min(...lining.map((v) => v.y))).toBeCloseTo(chainAt(front.lower, u), 5);
        expect(Math.max(...lining.map((v) => v.y))).toBeCloseTo(chainAt(front.upper, u), 5);
        expect(Math.max(...lining.map((v) => v.d))).toBeCloseTo(0, 5);
        expect(Math.min(...lining.map((v) => v.d))).toBeCloseTo(frontDepth, 5);
      }
    }
  });

  it("closes each bay's back corners, from its linings to the walling round its masonry opening", () => {
    for (const entry of windows) {
      const { front, frontDepth, opening } = entry;
      const back = bayVertices(opening.id).filter((v) => v.role === BODY_ROLE.bay && dot(v.n, inward) > 0.999);
      for (const [ua, ub] of [[front.u0 - BAY_LINING_SET, front.u0], [front.u1, front.u1 + BAY_LINING_SET]] as const) {
        const strip = back.filter((v) => v.u > ua - 1e-5 && v.u < ub + 1e-5);
        expect(strip, `${opening.id} ${ua.toFixed(3)}-${ub.toFixed(3)}`).toHaveLength(4);
        for (const v of strip) {
          expect(v.finish).toBe(BODY_FINISH.bayLining);
          expect(v.d).toBeCloseTo(frontDepth, 5);
          expect(v.reveal).toBeCloseTo(opening.head, 5);
        }
        expect(Math.min(...strip.map((v) => v.u))).toBeCloseTo(ua, 5);
        expect(Math.max(...strip.map((v) => v.u))).toBeCloseTo(ub, 5);
      }
      // The walling's own face at the bay's back begins at the footprint's jambs, in the same mahogany.
      let walling = 0;
      for (let i = 0; i < tag.count; i++) {
        if (Math.round(tag.getX(i)) !== windowWall || Math.round(tag.getZ(i)) !== BODY_ROLE.body || Math.round(tag.getW(i)) !== BODY_FINISH.bayLining) continue;
        const q = local(wall, [position.getX(i), 0, position.getZ(i)]);
        if (Math.abs(q.d - frontDepth) > 1e-5 || q.u < front.u0 - 1e-5 || q.u > front.u1 + 1e-5) continue;
        expect(dot([normal.getX(i), normal.getY(i), normal.getZ(i)], inward)).toBeGreaterThan(0.999);
        if (Math.abs(q.u - front.u0) < 1e-5 || Math.abs(q.u - front.u1) < 1e-5) walling += 1;
      }
      expect(walling, opening.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("lines the back of every bay round its masonry opening in mahogany, and nowhere else", () => {
    let faces = 0;
    for (let i = 0; i < tag.count; i++) {
      if (Math.round(tag.getZ(i)) !== BODY_ROLE.body || Math.round(tag.getW(i)) !== BODY_FINISH.bayLining) continue;
      faces += 1;
      expect(Math.round(tag.getX(i))).toBe(windowWall);
      const q = local(wall, [position.getX(i), 0, position.getZ(i)]);
      const entry = windows.find((item) => q.u > item.front.u0 - 1e-5 && q.u < item.front.u1 + 1e-5);
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect(q.d).toBeCloseTo(entry.frontDepth, 5);
      expect(dot([normal.getX(i), normal.getY(i), normal.getZ(i)], inward)).toBeGreaterThan(0.999);
    }
    expect(faces).toBeGreaterThan(0);
  });

  it("lays each board at the cut while the cut lies between its footprint's sill and the board, at the board above it, and leaves no hole in the bay's floor", () => {
    const holes: string[] = [];
    for (const cut of [0.92, LOW, HALL_CUTS.near, HALL_CUTS.plan]) {
      const ups = [...shownBody(body.geometry, windowWallAt(cut)), ...glazingTriangles.flatMap((t) => clipBelow(t, cut))]
        .filter((t) => t.n[1] > 0.99 && Math.max(t.a[1], t.b[1], t.c[1]) <= cut + 0.002);
      for (const entry of windows) {
        const { front, frontDepth, opening } = entry;
        const { slot, glazing, sash } = bay(opening.id);
        const near = ups.filter((t) => [t.a, t.b, t.c].some((p) => { const q = local(wall, p); return q.u > slot.u0 - 0.3 && q.u < slot.u1 + 0.3 && q.d > frontDepth - 0.3; }));
        const boardAt = Math.min(cut, slot.clearFrom);
        for (let u = slot.u0 + 0.004; u < slot.u1; u += 0.02) {
          for (let d = -0.004; d > frontDepth; d -= 0.02) {
            const p = wallPoint(wall, u, 0, d);
            const under = near.filter((t) => contains2(t, [0, 2], p[0], p[2]));
            const highest = (list: readonly Tri[]): number => Math.max(-Infinity, ...list.map((t) => (t.a[1] + t.b[1] + t.c[1]) / 3));
            const floor = highest(under);
            // Nothing under the cut is ever lower than the glazing's sill (or the cut, under it): no hole into the body.
            if (floor < Math.min(cut, glazing.sill) - 1e-5) holes.push(`${opening.id} cut ${String(cut)} u ${u.toFixed(3)} d ${d.toFixed(3)}: ${floor.toFixed(3)}`);
            // The board itself, inside the footprint: in front of the sash across the masonry opening, to the bay's back beside it.
            const inOpening = u > entry.back.u0 + 1e-5 && u < entry.back.u1 - 1e-5;
            const onBoard = u > front.u0 + 1e-5 && u < front.u1 - 1e-5 && (!inOpening || d > sash.roomFace + 1e-5);
            if (onBoard && Math.abs(floor - boardAt) > 1e-5) holes.push(`${opening.id} cut ${String(cut)} u ${u.toFixed(3)} d ${d.toFixed(3)}: board at ${floor.toFixed(3)}, not ${boardAt.toFixed(3)}`);
            // Behind the sash's room face, across the opening, the body's floor: the glazing's sill (or the cut, under it), under the
            // sash's members, and behind the glass the outer reveal's sill (or, while the cut lies under it, the body's).
            const sill = Math.min(cut, glazing.sill);
            const own = highest(under.filter((t) => t.source === (d > glazing.glassDepth || cut < glazing.sill ? "body" : "glazing")));
            if (inOpening && d < sash.roomFace - 1e-5 && Math.abs(own - sill) > 1e-5) {
              holes.push(`${opening.id} cut ${String(cut)} u ${u.toFixed(3)} d ${d.toFixed(3)}: behind the sash's face at ${own.toFixed(3)}, not ${sill.toFixed(3)}`);
            }
          }
        }
      }
    }
    expect(holes.slice(0, 8)).toEqual([]);
  });

  it("ends each board at the sash's room face across the masonry opening, so it never meets the glass or a rail's top, and at the bay's back beside it", () => {
    for (const entry of windows) {
      const { back, frontDepth, opening } = entry;
      const { slot, glazing, sash } = bay(opening.id);
      const level = bayVertices(opening.id).filter((v) => v.n[1] > 0.999);
      const board = level.filter((v) => Math.abs(v.y - slot.clearFrom) < 1e-5);
      for (const v of board) expect(v.reveal).toBeCloseTo(slot.head, 5);
      expect(Math.min(...board.map((v) => v.u))).toBeCloseTo(slot.u0, 5);
      expect(Math.max(...board.map((v) => v.u))).toBeCloseTo(slot.u1, 5);
      expect(Math.max(...board.map((v) => v.d))).toBeCloseTo(0, 5);
      // In Plan, the board's triangles across the masonry opening stop at the sash's room face; beside it, at the bay's back.
      const planks = shownBody(body.geometry, windowWallAt(HALL_CUTS.plan), { roles: isBayRole })
        .filter((t) => inBay(opening.id)(t) && t.n[1] > 0.999 && Math.abs(t.a[1] - slot.clearFrom) < 1e-5)
        .map((t) => { const qs = [t.a, t.b, t.c].map((p) => local(wall, p)); return { u: (qs[0]?.u ?? 0) / 3 + (qs[1]?.u ?? 0) / 3 + (qs[2]?.u ?? 0) / 3, d: Math.min(...qs.map((q) => q.d)) }; });
      const across = planks.filter((t) => t.u > back.u0 && t.u < back.u1);
      const beside = planks.filter((t) => (t.u > entry.front.u0 && t.u < back.u0) || (t.u > back.u1 && t.u < entry.front.u1));
      expect(across.length).toBeGreaterThan(0);
      expect(beside.length).toBeGreaterThan(0);
      expect(Math.min(...across.map((t) => t.d))).toBeCloseTo(sash.roomFace, 5);
      expect(Math.min(...beside.map((t) => t.d))).toBeCloseTo(frontDepth, 5);
      // Behind the sash's face the floor lies at the glazing's sill, under the bottom rail and on to the glass
      // (always, while the bay is cleared), and behind the glass only while the cut lies under that sill.
      const sill = level.filter((v) => Math.abs(v.y - glazing.sill) < 1e-5);
      const underSash = sill.filter((v) => Math.abs(v.reveal - slot.head) < 1e-5);
      const behindGlass = sill.filter((v) => Math.abs(v.reveal - glazing.sill) < 1e-5);
      expect(underSash).toHaveLength(4);
      expect(behindGlass).toHaveLength(4);
      expect(sill).toHaveLength(8);
      for (const v of underSash) expect(v.d > glazing.glassDepth - 1e-5 && v.d < sash.roomFace + 1e-5).toBe(true);
      for (const v of behindGlass) expect(v.d > frontDepth - 1e-5 && v.d < glazing.glassDepth + 1e-5).toBe(true);
      for (const v of sill) expect(v.u > back.u0 - 1e-5 && v.u < back.u1 + 1e-5).toBe(true);
      // No board lies in the plane of a rail's top: it stops in front of the sash.
      expect(sash.roomFace).toBeGreaterThan(glazing.glassDepth);
      expect(sash.roomFace).toBeLessThan(0);
      expect(sash.u0).toBeGreaterThan(back.u0);
      expect(sash.u1).toBeLessThan(back.u1);
      // The step down at the sash's room face, closed along it and at either end.
      const risers = bayVertices(opening.id).filter((v) => Math.abs(v.n[1]) < 1e-5 && v.y > glazing.sill - 1e-5 && v.y < slot.clearFrom + 1e-5
        && (Math.abs(v.d - sash.roomFace) < 1e-5 || Math.abs(v.u - back.u0) < 1e-5 || Math.abs(v.u - back.u1) < 1e-5) && v.d < sash.roomFace + 1e-5 && v.d > glazing.glassDepth - 1e-5);
      expect(risers.length).toBe(12);
      for (const v of risers) expect(v.finish).toBe(BODY_FINISH.bayLining);
    }
  });

  it("draws a cleared bay's back, the daylit window over its masonry opening, only without the real sky", () => {
    const backs = (sky: boolean): Tri[] => shownBody(body.geometry, windowWallAt(HALL_CUTS.plan), { sky, roles: (role) => role === BODY_ROLE.bayBacking });
    expect(backs(true)).toEqual([]);
    const shown = backs(false);
    for (const entry of windows) {
      const { back, frontDepth, opening } = entry;
      const { glazing } = bay(opening.id);
      const mine = shown.filter(inBay(opening.id));
      let area = 0;
      for (const t of mine) {
        for (const p of [t.a, t.b, t.c]) expect(local(wall, p).d).toBeCloseTo(frontDepth, 5);
        expect(dot(t.n, inward)).toBeGreaterThan(0.999);
        area += len(cross(sub(t.b, t.a), sub(t.c, t.a))) / 2;
      }
      // The masonry opening, from the glazing's sill up to the cut (under every head and springing).
      expect(area, opening.id).toBeCloseTo((back.u1 - back.u0) * (HALL_CUTS.plan - glazing.sill), 5);
    }
    for (let i = 0; i < tag.count; i++) {
      if (Math.round(tag.getZ(i)) === BODY_ROLE.bayBacking) expect(Math.round(tag.getW(i))).toBe(BODY_FINISH.bayBacking);
      if (Math.round(tag.getW(i)) === BODY_FINISH.bayBacking) expect(Math.round(tag.getZ(i))).toBe(BODY_ROLE.bayBacking);
    }
  });

  /**
   * Rays from Plan's eye (HallViewDirector) and from two overviews high over
   * the room, along the window wall either way, through a 2.5 cm grid over
   * each cleared bay's open top at the cut, without the real sky and with
   * none of the scanned relief (as if the clearing took all of it): each must
   * meet a surface facing it (every hall material culls back faces) before it
   * passes the bay's back. A ray that gets past it looks into the wall or out
   * at the void beyond.
   */
  it("never lets a ray through a cleared bay into the wall or out past its back, the relief all gone", () => {
    const eyes: readonly Vec3[] = [[0, 21.5, 2.3], [-7, 8, 3], [7, 8, 3]];
    const escapes: string[] = [];
    for (const cut of [0.92, LOW, HALL_CUTS.near, HALL_CUTS.plan]) {
      const shown = [...shownBody(body.geometry, windowWallAt(cut)), ...glazingTriangles.flatMap((t) => clipBelow(t, cut))];
      for (const entry of windows) {
        const { frontDepth, opening } = entry;
        const { slot } = bay(opening.id);
        const near = shown.filter((t) => {
          const qs = [t.a, t.b, t.c].map((p) => local(wall, p));
          return Math.max(...qs.map((q) => q.u)) > slot.u0 - 0.1 && Math.min(...qs.map((q) => q.u)) < slot.u1 + 0.1
            && Math.max(...qs.map((q) => q.d)) > frontDepth - 0.1 && Math.min(...qs.map((q) => q.d)) < 0.1;
        });
        for (const eye of eyes) {
          let lost = 0;
          let worst = "";
          for (let u = slot.u0 + 0.004; u < slot.u1; u += 0.025) {
            for (let d = -0.004; d > frontDepth; d -= 0.025) {
              const aim = wallPoint(wall, u, cut, d);
              const dir = unit(sub(aim, eye));
              const hit = firstFrontHit(eye, dir, near);
              const at = hit === null ? null : local(wall, [eye[0] + dir[0] * hit, 0, eye[2] + dir[2] * hit]);
              if (at === null || at.d < frontDepth - 0.002) {
                lost += 1;
                worst = `u ${u.toFixed(3)} d ${d.toFixed(3)}${at === null ? ", nothing met" : `, met at d ${at.d.toFixed(3)}`}`;
              }
            }
          }
          if (lost > 0) escapes.push(`${opening.id} cut ${String(cut)} from ${eye.join(",")}: ${String(lost)} rays, e.g. ${worst}`);
        }
      }
    }
    expect(escapes).toEqual([]);
  });
});
