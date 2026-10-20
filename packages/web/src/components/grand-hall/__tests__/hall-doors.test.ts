import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Texture, type BufferGeometry } from "three";
import { HALL_CUTS, wallCutHeight } from "../GrandHallModel.js";
import { parseWallRelief, type WallRelief } from "../hall-relief.js";
import { DOOR_OUTLINES, LEAF_RELIEF_PROUD, REVEAL_SIDE_DEPTH as REVEAL_STOP, doorReliefFate, doorwayBehind, drawnRelief, insideReliefCut, leafColumn } from "../hall-walls.js";
import { wallAtlasUv } from "../hall-atlas.js";
import { sampleHallLight } from "../hall-lighting-model.js";
import { HallSectionUniforms, createDoorLeafMaterials } from "../hall-materials.js";
import { HallMoodUniforms } from "../hall-mood.js";
import { HallPhotos } from "../hall-photos.js";
import { DOOR_LINING_SET, bodyOpenings, doorRevealDepth } from "../hall-wall-body.js";
import {
  DOOR_OPEN_ANGLE,
  DOOR_WALLS,
  DoorSwing,
  DoorSwingUniforms,
  HALL_DOOR_LEAVES,
  HINGE_CLEARANCE,
  JAMB_LAP,
  LEAF_CAP_CODE,
  LEAF_LAG,
  decodeHinge,
  leafAngle,
  LEAF_THICKNESS,
  PANEL_GROOVE_OCCLUSION,
  PANEL_SINK,
  buildHallDoorGeometry,
  doorTarget,
  leafHinge,
  leafVertex,
  swingDirection,
  swingPoint,
  type HallDoorLeaf,
} from "../hall-doors.js";
import { HALL_DOORS, HALL_OPENINGS, HALL_WALLS, hallWall, wallPoint, type HallWall } from "../hall-spec.js";

type Vec3 = readonly [number, number, number];

let shipped: WallRelief | null = null;
function relief(): WallRelief {
  if (shipped === null) {
    const bytes = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
    shipped = parseWallRelief(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return shipped;
}

/** Wall-local (u, depth) of a world point. */
function local(wall: HallWall, p: Vec3): { u: number; d: number } {
  const rx = p[0] - wall.origin[0];
  const rz = p[2] - wall.origin[2];
  return { u: rx * wall.tangent[0] + rz * wall.tangent[2], d: rx * wall.normal[0] + rz * wall.normal[2] };
}

/** A relief triangle's wall-local corners. */
function cornersOf(positions: Float32Array, indices: Uint32Array, t: number): (readonly [number, number, number])[] {
  return [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0].map((i) => [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0] as const);
}

const geometry = buildHallDoorGeometry();

/** One vertex of the leaves' geometry with its hinge, atlas texel, opening and wall. */
interface LeafVertex {
  readonly key: string;
  readonly p: Vec3;
  readonly n: Vec3;
  readonly hinge: { x: number; z: number; sense: 1 | -1; code: number };
  readonly atlas: readonly [number, number];
  readonly opening: number;
  readonly wall: number;
  /** The baked occlusion (aLight.x). */
  readonly ao: number;
}

function verticesOf(key: string, g: BufferGeometry): LeafVertex[] {
  const position = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  const hinge = g.getAttribute("aHinge");
  const atlas = g.getAttribute("aAtlas");
  const opening = g.getAttribute("aOpening");
  const wall = g.getAttribute("aWall");
  const light = g.getAttribute("aLight");
  const out: LeafVertex[] = [];
  for (let i = 0; i < position.count; i++) {
    out.push({
      key,
      p: [position.getX(i), position.getY(i), position.getZ(i)],
      n: [normal.getX(i), normal.getY(i), normal.getZ(i)],
      hinge: { x: hinge.getX(i), z: hinge.getY(i), sense: hinge.getZ(i) > 0 ? 1 : -1, code: hinge.getW(i) },
      atlas: [atlas.getX(i), atlas.getY(i)],
      opening: opening.getX(i),
      wall: wall.getX(i),
      ao: light.getX(i),
    });
  }
  return out;
}

const vertices = [...geometry.geometries].flatMap(([key, g]) => verticesOf(key, g));

/** The leaf a vertex belongs to, by its hinge. */
function leafOf(v: LeafVertex): HallDoorLeaf | undefined {
  return HALL_DOOR_LEAVES.find((leaf) => {
    const h = leafHinge(leaf);
    return Math.abs(h.x - v.hinge.x) < 1e-5 && Math.abs(h.z - v.hinge.z) < 1e-5 && h.sense === v.hinge.sense && leaf.door === Math.round(v.hinge.code) % LEAF_CAP_CODE;
  });
}

const openingIndex = (id: string): number => HALL_OPENINGS.findIndex((opening) => opening.id === id);

describe("the doors' leaves, shut", () => {
  it("hangs a pair in every doorway, and the Saloon's single leaf at the end door's far face", () => {
    for (const [index, door] of HALL_DOORS.entries()) {
      const leaves = HALL_DOOR_LEAVES.filter((leaf) => leaf.door === index);
      expect(leaves.filter((leaf) => !leaf.far)).toHaveLength(2);
      expect(leaves.filter((leaf) => leaf.far)).toHaveLength(door.farLeaf === null ? 0 : 1);
    }
  });

  it("hinges each leaf at its jamb, at the hall face, the main door's at -0.03 like its twins", () => {
    for (const leaf of HALL_DOOR_LEAVES) {
      const opening = HALL_OPENINGS[leaf.opening];
      const door = HALL_DOORS[leaf.door];
      if (opening === undefined || door === undefined) throw new Error("leaf without a door");
      const jamb = leaf.sense > 0 ? opening.centre - opening.width / 2 : opening.centre + opening.width / 2;
      expect(Math.abs(leaf.hingeU - jamb), opening.id).toBeCloseTo(HINGE_CLEARANCE, 9);
      expect(leaf.face - leaf.back).toBeCloseTo(LEAF_THICKNESS, 9);
      if (leaf.far) {
        // Its Saloon face just inside the wall's far face.
        expect(leaf.back).toBeGreaterThan(-door.depth);
        expect(leaf.back).toBeLessThan(-door.depth + 0.005);
      } else {
        expect(Math.abs(leaf.face - door.leafFace)).toBeLessThanOrEqual(0.004 + 1e-9);
      }
    }
    const main = HALL_DOOR_LEAVES.filter((leaf) => HALL_OPENINGS[leaf.opening]?.id === "door-main");
    expect(main).toHaveLength(2);
    for (const leaf of main) expect(Math.abs(leaf.face + 0.03)).toBeLessThanOrEqual(0.005);
  });

  it("stands each photographed leaf's face where the scan found the shut leaves (within 5 mm of the relief's median)", () => {
    const shippedRelief = relief();
    for (const door of HALL_DOORS.filter((entry) => entry.photographed)) {
      const opening = HALL_OPENINGS[openingIndex(door.opening)];
      const mesh = opening === undefined ? undefined : shippedRelief.get(opening.wall);
      if (opening === undefined || mesh === undefined) throw new Error(door.opening);
      const depths: number[] = [];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const corners = cornersOf(mesh.positions, mesh.indices, t);
        const fate = doorReliefFate(opening.wall, corners);
        if (fate?.door.opening !== door.opening || !fate.leaf) continue;
        const [a, b, c] = corners;
        if (a === undefined || b === undefined || c === undefined) continue;
        // Inside the clear outline, under the leaves' top.
        const u = (a[0] + b[0] + c[0]) / 3;
        if (u <= fate.door.u0 || u >= fate.door.u1 || (a[1] + b[1] + c[1]) / 3 >= fate.door.top) continue;
        // The leaves' faces: turned to the room.
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(nz) / Math.hypot(nx, ny, nz) < 0.9) continue;
        depths.push((a[2] + b[2] + c[2]) / 3);
      }
      depths.sort((x, y) => x - y);
      const median = depths[Math.floor(depths.length / 2)] ?? Number.NaN;
      expect(depths.length, door.opening).toBeGreaterThan(10);
      expect(Math.abs(median - door.leafFace), door.opening).toBeLessThan(0.005);
    }
  });

  it("wears the atlas's photograph at the closed position on the doors it photographed, and none on the main door", () => {
    const photo = vertices.filter((v) => v.key === "wallPhotoGloss" || v.key === "wallPhoto");
    expect(photo.length).toBeGreaterThan(100);
    for (const v of photo) {
      const wall = HALL_WALLS[v.wall];
      if (wall === undefined) throw new Error("photo vertex off every wall");
      const { u } = local(wall, v.p);
      const [au, av] = wallAtlasUv(wall.id, u, v.p[1]);
      expect(Math.abs(v.atlas[0] - au)).toBeLessThan(2e-6);
      expect(Math.abs(v.atlas[1] - av)).toBeLessThan(2e-6);
    }
    const photographed = new Set(photo.map((v) => HALL_OPENINGS[v.opening]?.id));
    expect([...photographed].sort()).toEqual(["door-end", "door-fire-exit", "door-fireplace"]);
    // The main door and the Saloon leaf: mahogany and brass only.
    const main = vertices.filter((v) => v.opening === openingIndex("door-main"));
    expect(main.length).toBeGreaterThan(100);
    expect(main.every((v) => v.key !== "wallPhotoGloss" && v.key !== "wallPhoto")).toBe(true);
    expect(vertices.filter((v) => leafOf(v)?.far === true).every((v) => v.key !== "wallPhotoGloss" && v.key !== "wallPhoto")).toBe(true);
  });

  it("shades the modelled panels' sunk margins, and leaves the photographs' own shading alone", () => {
    const sunkRatio = (photographed: boolean): number => {
      const ratios: number[] = [];
      for (const v of vertices) {
        const leaf = leafOf(v);
        const wall = leaf === undefined ? undefined : HALL_WALLS[leaf.wall];
        if (leaf === undefined || wall === undefined || leaf.far || leaf.photographed !== photographed) continue;
        const { d } = local(wall, v.p);
        if (Math.abs(d - (leaf.face - PANEL_SINK)) > 1e-6) continue;
        const base = sampleHallLight(v.p, v.n, leaf.photographed ? "wall" : "detail").ao;
        ratios.push(v.ao / base);
      }
      expect(ratios.length).toBeGreaterThan(20);
      const first = ratios[0] ?? Number.NaN;
      return Math.max(...ratios.map((r) => Math.abs(r - first))) < 1e-6 ? first : Number.NaN;
    };
    expect(sunkRatio(false)).toBeCloseTo(1 - PANEL_GROOVE_OCCLUSION, 6);
    expect(sunkRatio(true)).toBeCloseTo(1, 6);
  });

  it("tags every vertex with its wall and its doorway, and hinges it to a leaf", () => {
    for (const v of vertices) {
      const leaf = leafOf(v);
      expect(leaf).toBeDefined();
      expect(v.wall).toBe(leaf?.wall);
      expect(v.opening).toBe(leaf?.opening);
    }
  });

  it("shows no slit when shut: each face laps behind its jamb, and the first leaf over the second", () => {
    for (const [index] of HALL_DOORS.entries()) {
      const [first, second] = HALL_DOOR_LEAVES.filter((leaf) => leaf.door === index && !leaf.far);
      const opening = first === undefined ? undefined : HALL_OPENINGS[first.opening];
      if (first === undefined || second === undefined || opening === undefined) throw new Error("pair");
      expect(first.plateU0).toBeLessThan(opening.centre - opening.width / 2);
      expect(second.plateU1).toBeGreaterThan(opening.centre + opening.width / 2);
      expect(first.plateU1).toBeGreaterThan(second.plateU0 + 0.005);
      // The lap stands clear of the second leaf's face.
      expect(second.face).toBeLessThan(first.face - 0.003);
    }
  });

  it("stays within its budget: four draws (the photograph matte and glossy, mahogany, brass), 2k triangles", () => {
    expect([...geometry.geometries.keys()].sort()).toEqual(["brass", "mahoganyDark", "wallPhoto", "wallPhotoGloss"]);
    expect(geometry.stats.triangles).toBeLessThanOrEqual(2000);
  });

  it("builds its materials", () => {
    const materials = createDoorLeafMaterials({ mahoganyDark: new Texture() }, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), new DoorSwingUniforms());
    expect([...materials.keys()].sort()).toEqual(["brass", "mahoganyDark", "wallPhoto", "wallPhotoGloss"]);
    for (const material of materials.values()) material.dispose();
  });
});

describe("the doors' leaves, open", () => {
  const open = (v: LeafVertex): Vec3 | null => leafVertex(v.p, v.hinge, HALL_CUTS.plan, DOOR_OPEN_ANGLE);

  it("swings each leaf outward: its free edge behind the wall's plane, the Saloon leaf's into the Saloon", () => {
    for (const leaf of HALL_DOOR_LEAVES) {
      const wall = HALL_WALLS[leaf.wall];
      const door = HALL_DOORS[leaf.door];
      if (wall === undefined || door === undefined) throw new Error("leaf");
      const width = Math.abs(leaf.freeU - leaf.hingeU);
      const corner = wallPoint(wall, leaf.freeU, 1, leaf.back);
      const free = local(wall, swingPoint(corner, leafHinge(leaf), DOOR_OPEN_ANGLE));
      expect(Math.abs(free.u - leaf.hingeU)).toBeLessThan(1e-9);
      expect(free.d).toBeCloseTo(leaf.back - width, 9);
      if (leaf.far) expect(free.d).toBeLessThan(-door.depth - 1);
      // Half way, it is half way round.
      const half = local(wall, swingPoint(corner, leafHinge(leaf), DOOR_OPEN_ANGLE / 2));
      expect(half.d).toBeCloseTo(leaf.back - width * Math.SQRT1_2, 9);
    }
  });

  it("lies inside its doorway once open, 5 mm or more clear of the linings, the head and the threshold", () => {
    const widths: Record<string, number> = {};
    for (const v of vertices) {
      const leaf = leafOf(v);
      const p = open(v);
      if (leaf === undefined || p === null) continue;
      const wall = HALL_WALLS[leaf.wall];
      const door = HALL_DOORS[leaf.door];
      const opening = HALL_OPENINGS[leaf.opening];
      if (wall === undefined || door === undefined || opening === undefined) throw new Error("leaf");
      const { u, d } = local(wall, p);
      expect(u, opening.id).toBeGreaterThanOrEqual(opening.centre - opening.width / 2 + 0.005);
      expect(u, opening.id).toBeLessThanOrEqual(opening.centre + opening.width / 2 - 0.005);
      expect(p[1]).toBeLessThanOrEqual(opening.head - 0.005);
      expect(p[1]).toBeGreaterThanOrEqual(0.008 + 0.002);
      if (!leaf.far) {
        expect(d, opening.id).toBeLessThan(0);
        expect(d, opening.id).toBeGreaterThanOrEqual(-door.depth + 0.005);
        widths[opening.id] = Math.max(widths[opening.id] ?? 0, Math.abs(leaf.freeU - leaf.hingeU));
      }
    }
    // Every leaf is narrower than its doorway is deep.
    for (const door of HALL_DOORS) expect(widths[door.opening] ?? 99, door.opening).toBeLessThan(door.depth);
  });

  it("clears the scanned reveal at its jamb by 5 mm once open", () => {
    const drawn = drawnRelief(relief());
    for (const leaf of HALL_DOOR_LEAVES.filter((entry) => !entry.far)) {
      const wall = HALL_WALLS[leaf.wall];
      const mesh = wall === undefined ? undefined : drawn.get(wall.id);
      if (wall === undefined || mesh === undefined) throw new Error("leaf");
      // Open, the leaf stands between these u and is no shallower than `nearest`.
      const uLow = leaf.sense > 0 ? leaf.hingeU : leaf.hingeU - LEAF_THICKNESS;
      const uHigh = leaf.sense > 0 ? leaf.hingeU + LEAF_THICKNESS : leaf.hingeU;
      // The plate's lap behind the jamb turns to stand this far in front of the leaf's back.
      const nearest = leaf.back + JAMB_LAP + HINGE_CLEARANCE;
      // The vertices the drawn relief still uses (its positions are the shipped relief's, shared).
      for (const vertex of new Set(mesh.indices)) {
        const i = vertex * 3;
        const u = mesh.positions[i] ?? 0;
        const v = mesh.positions[i + 1] ?? 0;
        const d = mesh.positions[i + 2] ?? 0;
        if (u < uLow - 0.005 || u > uHigh + 0.005 || v < leaf.foot || v > leaf.top) continue;
        expect(d, `${HALL_OPENINGS[leaf.opening]?.id ?? ""} relief at u ${u.toFixed(3)} v ${v.toFixed(2)}`).toBeGreaterThan(nearest + 0.005);
      }
    }
  });

  it("swings each pair without one leaf passing through the other: the lapping leaf trails and catches up", () => {
    // A leaf's slab in its own wall frame (u, depth): its face plate and its core behind it.
    const inside = (leaf: HallDoorLeaf, u: number, d: number, v: number): boolean => {
      const e = 5e-4;
      if (v < leaf.foot + e || v > leaf.top - e) return false;
      const plateBack = leaf.face - 0.003;
      const coreLow = Math.min(leaf.hingeU, leaf.freeU);
      const coreHigh = Math.max(leaf.hingeU, leaf.freeU);
      const inPlate = u > leaf.plateU0 + e && u < leaf.plateU1 - e && d > plateBack + e && d < leaf.face - e;
      const inCore = u > coreLow + e && u < coreHigh - e && d > leaf.back + e && d < plateBack - e;
      return inPlate || inCore;
    };
    let checked = 0;
    for (const [index] of HALL_DOORS.entries()) {
      const [first, second] = HALL_DOOR_LEAVES.filter((leaf) => leaf.door === index && !leaf.far);
      const wall = first === undefined ? undefined : HALL_WALLS[first.wall];
      if (first === undefined || second === undefined || wall === undefined) throw new Error("pair");
      for (let deg = 0; deg <= 90; deg += 0.5) {
        const theta = (deg * Math.PI) / 180;
        for (const [mover, other] of [[first, second], [second, first]] as const) {
          const moverHinge = leafHinge(mover);
          const otherHinge = leafHinge(other);
          for (const v of vertices.filter((entry) => leafOf(entry) === mover && !decodeHinge(entry.hinge.code).cap)) {
            const p = leafVertex(v.p, v.hinge, HALL_CUTS.none, theta);
            if (p === null) continue;
            // Back into the other leaf's own frame: turned back by its angle about its hinge.
            const q = swingPoint(p, otherHinge, -leafAngle(theta, decodeHinge(otherHinge.code).lag));
            const { u, d } = local(wall, q);
            checked += 1;
            expect(inside(other, u, d, q[1]), `${HALL_OPENINGS[mover.opening]?.id ?? ""} at ${String(deg)} deg (${moverHinge.sense > 0 ? "first" : "second"} leaf)`).toBe(false);
          }
        }
      }
      // The lapping leaf trails while it swings and is open with its door.
      expect(leafAngle(DOOR_OPEN_ANGLE, true)).toBeCloseTo(DOOR_OPEN_ANGLE, 12);
      expect(leafAngle(LEAF_LAG, true)).toBe(0);
      expect(leafAngle(DOOR_OPEN_ANGLE / 2, true)).toBeLessThan(DOOR_OPEN_ANGLE / 2);
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it("turns each vertex's normal with it", () => {
    for (const v of vertices.slice(0, 400)) {
      const n = swingDirection(v.n, v.hinge, DOOR_OPEN_ANGLE);
      const a = swingPoint(v.p, v.hinge, DOOR_OPEN_ANGLE);
      const b = swingPoint([v.p[0] + v.n[0] * 0.01, v.p[1] + v.n[1] * 0.01, v.p[2] + v.n[2] * 0.01], v.hinge, DOOR_OPEN_ANGLE);
      for (let k = 0; k < 3; k++) expect((b[k] ?? 0) - (a[k] ?? 0)).toBeCloseTo((n[k] ?? 0) * 0.01, 9);
    }
  });

  it("lays a section on a leaf only where the cut crosses it", () => {
    const caps = vertices.filter((v) => decodeHinge(v.hinge.code).cap);
    expect(caps.length).toBeGreaterThan(0);
    for (const v of caps) {
      expect(leafVertex(v.p, v.hinge, HALL_CUTS.none, 0)).toBeNull();
      expect(leafVertex(v.p, v.hinge, HALL_CUTS.plan, 0)).toBeNull();
      const cut = leafVertex(v.p, v.hinge, HALL_CUTS.near, DOOR_OPEN_ANGLE);
      if (v.p[1] > HALL_CUTS.near) expect(cut?.[1]).toBeCloseTo(HALL_CUTS.near, 9);
      else expect(cut).toBeNull();
    }
    // Any other vertex keeps its height.
    const plain = vertices.find((v) => !decodeHinge(v.hinge.code).cap);
    if (plain === undefined) throw new Error("no plain vertex");
    expect(leafVertex(plain.p, plain.hinge, HALL_CUTS.near, 0)?.[1]).toBe(plain.p[1]);
  });
});

describe("the doors' swing", () => {
  const cutsFor = (view: "plan" | "overview" | "walk", camera: Vec3): number[] => HALL_WALLS.map((wall) => wallCutHeight(view, wall, camera));
  const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const dir = unit([11.2, 12.6, 14.2]);
  const openingPose: Vec3 = [-1 + dir[0] * 22, dir[1] * 22, -1 + dir[2] * 22];

  it("opens every door in Plan, the door wall's three from the opening view, and none on a walk", () => {
    const targets = (cuts: readonly number[], walk: boolean): number[] => DOOR_WALLS.map((wall) => doorTarget(cuts[wall] ?? 100, walk));
    expect(targets(cutsFor("plan", [0, 30, 0]), false)).toEqual([DOOR_OPEN_ANGLE, DOOR_OPEN_ANGLE, DOOR_OPEN_ANGLE, DOOR_OPEN_ANGLE]);
    expect(targets(cutsFor("overview", openingPose), false)).toEqual([DOOR_OPEN_ANGLE, DOOR_OPEN_ANGLE, DOOR_OPEN_ANGLE, 0]);
    expect(targets(cutsFor("walk", [0, 1.6, 2.5]), true)).toEqual([0, 0, 0, 0]);
    expect(DOOR_WALLS).toEqual((["door", "door", "door", "fireplace"] as const).map((id) => HALL_WALLS.indexOf(hallWall(id))));
  });

  it("settles each door at 90 degrees on its spring, without swinging past by a degree", () => {
    const swing = new DoorSwing();
    const plan = cutsFor("plan", [0, 30, 0]);
    let frames = 0;
    let peak = 0;
    while (swing.step(plan, false, 1 / 60, () => false) && frames < 600) {
      frames += 1;
      peak = Math.max(peak, ...swing.springs.map((s) => s.value));
    }
    expect(frames).toBeLessThan(120);
    expect(peak).toBeLessThan(DOOR_OPEN_ANGLE + Math.PI / 180);
    for (let door = 0; door < HALL_DOORS.length; door++) expect(swing.angle(door)).toBe(DOOR_OPEN_ANGLE);
    // Still, it asks nothing more and does not move.
    expect(swing.step(plan, false, 1 / 60, () => { throw new Error("asked about motion while still"); })).toBe(false);
    // Half a second from shut, a door is most of the way open.
    const fresh = new DoorSwing();
    for (let k = 0; k < 30; k++) fresh.step(plan, false, 1 / 60, () => false);
    expect(fresh.angle(0)).toBeGreaterThan(DOOR_OPEN_ANGLE * 0.6);
    expect(fresh.angle(0)).toBeLessThan(DOOR_OPEN_ANGLE);
  });

  it("is at its target in the frame its target changes under reduced motion", () => {
    const swing = new DoorSwing();
    expect(swing.step(cutsFor("plan", [0, 30, 0]), false, 0, () => true)).toBe(false);
    for (let door = 0; door < HALL_DOORS.length; door++) expect(swing.angle(door)).toBe(DOOR_OPEN_ANGLE);
    expect(swing.step(cutsFor("walk", [0, 1.6, 2.5]), true, 0, () => true)).toBe(false);
    for (let door = 0; door < HALL_DOORS.length; door++) expect(swing.angle(door)).toBe(0);
  });

  it("keeps the last drawn angles for the motion vectors, and shuts and restores the doors for a capture", () => {
    const uniforms = new DoorSwingUniforms();
    uniforms.set(() => 0.4);
    uniforms.set(() => 0.7);
    expect(uniforms.previous.map((node) => node.value)).toEqual([0.4, 0.4, 0.4, 0.4]);
    expect(uniforms.values()).toEqual([0.7, 0.7, 0.7, 0.7]);
    const was = uniforms.shut();
    expect(uniforms.values()).toEqual([0, 0, 0, 0]);
    uniforms.restore(was);
    expect(uniforms.values()).toEqual([0.7, 0.7, 0.7, 0.7]);
    expect(uniforms.previous.map((node) => node.value)).toEqual([0.7, 0.7, 0.7, 0.7]);
  });
});

describe("the relief the leaves replace", () => {
  const shippedRelief = relief();
  const drawn = drawnRelief(shippedRelief);

  /** The area (m2) of a relief's triangles whose centroid passes `keep`. */
  function areaOf(mesh: { positions: Float32Array; indices: Uint32Array }, keep: (u: number, v: number, d: number) => boolean): number {
    let area = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = cornersOf(mesh.positions, mesh.indices, t);
      if (a === undefined || b === undefined || c === undefined) continue;
      if (!keep((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)) continue;
      const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    }
    return area;
  }

  it("takes the shut leaves from every doorway, and nothing stays behind where its reveal stops", () => {
    for (const outline of DOOR_OUTLINES) {
      const shipped = shippedRelief.get(outline.wall);
      const mesh = drawn.get(outline.wall);
      if (shipped === undefined || mesh === undefined) throw new Error(outline.wall);
      // Behind the reveal, near the doorway: nothing, centroid or corner.
      const behind = doorwayBehind(outline);
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const corners = cornersOf(mesh.positions, mesh.indices, t);
        const [a, b, c] = corners;
        if (a === undefined || b === undefined || c === undefined) throw new Error("triangle");
        const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        expect(insideReliefCut(centroid, behind, 1e-6), `${outline.opening} centroid ${centroid.map((x) => x.toFixed(3)).join(" ")}`).toBe(false);
        for (const corner of corners) expect(insideReliefCut(corner, behind, 1e-5)).toBe(false);
      }
      // The leaves' faces and hardware (in the outline, under their top, within LEAF_RELIEF_PROUD of
      // their face) gone; the reveals' sides at the jambs and the doorcase's head hanging in front stay.
      const inLeaves = (u: number, v: number, d: number): boolean => u > outline.u0 + 0.02 && u < outline.u1 - 0.02 && v > outline.sill && v < outline.top
        && d < outline.reveal + LEAF_RELIEF_PROUD;
      expect(areaOf(shipped, inLeaves), outline.opening).toBeGreaterThan(1);
      expect(areaOf(mesh, inLeaves), outline.opening).toBeLessThan(0.01);
    }
  });

  it("keeps the photograph round each doorway whole in front of where its reveal stops", () => {
    // The frontmost relief seen straight on, on a 5 mm grid round each doorway
    // (outside the leaves' column): where the shipped relief's frontmost
    // surface stands in front of the reveal's stop, the drawn relief's is the same.
    for (const outline of DOOR_OUTLINES) {
      const shipped = shippedRelief.get(outline.wall);
      const mesh = drawn.get(outline.wall);
      if (shipped === undefined || mesh === undefined) throw new Error(outline.wall);
      const step = 0.005;
      const gu0 = outline.u0 - 0.12;
      const nu = Math.round((outline.u1 - outline.u0 + 0.24) / step);
      const nv = Math.round((outline.head + 0.12) / step);
      const a = frontmost(shipped, gu0, step, nu, nv);
      const b = frontmost(mesh, gu0, step, nu, nv);
      const column = leafColumn(outline);
      let compared = 0;
      const lost: string[] = [];
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const u = gu0 + (i + 0.5) * step;
          const v = (j + 0.5) * step;
          const da = a[j * nu + i] ?? Number.NaN;
          if (Number.isNaN(da) || da < outline.reveal - REVEAL_STOP + 1e-3) continue;
          // Not where the leaves stand (a cell's width clear of their column).
          if (insideReliefCut([u, v, da], column, -step)) continue;
          compared += 1;
          const db = b[j * nu + i] ?? Number.NaN;
          if (Number.isNaN(db) || Math.abs(db - da) > 2e-4) lost.push(`u ${(u - outline.u0).toFixed(3)} v ${v.toFixed(3)}: ${da.toFixed(4)} -> ${db.toFixed(4)}`);
        }
      }
      expect(compared, outline.opening).toBeGreaterThan(5000);
      expect(lost.slice(0, 5), `${outline.opening}: ${String(lost.length)} of ${String(compared)}`).toEqual([]);
    }
  });

  it("draws the relief whole everywhere else, built once per relief", () => {
    let removed = 0;
    for (const [id, mesh] of shippedRelief) {
      const kept = drawn.get(id);
      if (kept === undefined) throw new Error(id);
      // The shipped vertices first, unchanged; the cuts' new points after them.
      expect(kept.positions.subarray(0, mesh.positions.length)).toEqual(mesh.positions);
      removed += areaOf(mesh, () => true) - areaOf(kept, () => true);
      if (!DOOR_OUTLINES.some((outline) => outline.wall === id)) {
        expect(kept.positions).toBe(mesh.positions);
        expect(kept.indices).toEqual(mesh.indices);
      }
    }
    // The four doorways' shut leaves, about 2 m2 each.
    expect(removed).toBeGreaterThan(6);
    expect(drawnRelief(shippedRelief)).toBe(drawn);
    expect(drawnRelief(drawn)).toBe(drawn);
  });

  it("leaves nothing standing in a doorway but the reveal's sides at its jambs and what hangs in front of the leaves", () => {
    for (const outline of DOOR_OUTLINES) {
      const mesh = drawn.get(outline.wall);
      if (mesh === undefined) throw new Error(outline.wall);
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const corners = cornersOf(mesh.positions, mesh.indices, t);
        const u = corners.reduce((sum, c) => sum + c[0], 0) / 3;
        const v = corners.reduce((sum, c) => sum + c[1], 0) / 3;
        if (u <= outline.u0 || u >= outline.u1 || v < outline.sill || v >= outline.top) continue;
        // The doorcase's head and the fire exit's sign hang more than LEAF_RELIEF_PROUD in front of the leaves.
        if (corners.every((p) => p[2] >= outline.reveal + LEAF_RELIEF_PROUD - 1e-6)) continue;
        // A reveal's side: turned into the doorway from its nearer jamb, a few centimetres from it, in front of the leaves.
        const [a, b, c] = corners;
        if (a === undefined || b === undefined || c === undefined) throw new Error("triangle");
        const n: Vec3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        const fromLow = u - outline.u0 < outline.u1 - u;
        const into = ((fromLow ? 1 : -1) * n[0]) / Math.hypot(...n);
        expect(into, `${outline.opening} at u ${(u - outline.u0).toFixed(3)} v ${v.toFixed(3)}`).toBeGreaterThan(0.7);
        expect(Math.max(...corners.map((p) => Math.min(p[0] - outline.u0, outline.u1 - p[0])))).toBeLessThan(0.045);
        for (const p of corners) expect(p[2]).toBeGreaterThanOrEqual(outline.reveal - REVEAL_STOP - 1e-6);
      }
    }
  });

  it("starts each doorway's lining just behind its leaves' face, in front of where the drawn reveal stops", () => {
    let doors = 0;
    for (const wall of HALL_WALLS) {
      for (const entry of bodyOpenings(wall)) {
        if (entry.door === null) continue;
        doors += 1;
        expect(entry.frontDepth).toBeCloseTo(doorRevealDepth(entry.door) - DOOR_LINING_SET, 9);
        // In front of where the drawn relief stops: the two overlap.
        expect(entry.frontDepth).toBeGreaterThan(doorRevealDepth(entry.door) - REVEAL_STOP);
        expect(entry.liningFrom).toBe(entry.frontDepth);
      }
    }
    expect(doors).toBe(4);
  });
});

/**
 * The frontmost relief seen straight on (the largest depth) at the centres of
 * a grid of cells (u from u0, v from 0, `step` metres), NaN where none.
 */
function frontmost(mesh: { positions: Float32Array; indices: Uint32Array }, u0: number, step: number, nu: number, nv: number): Float32Array {
  const out = new Float32Array(nu * nv).fill(Number.NaN);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = cornersOf(mesh.positions, mesh.indices, t);
    if (a === undefined || b === undefined || c === undefined) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - u0) / step - 0.5));
    const i1 = Math.min(nu - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - u0) / step - 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) / step - 0.5));
    const j1 = Math.min(nv - 1, Math.ceil(Math.max(a[1], b[1], c[1]) / step - 0.5));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const u = u0 + (i + 0.5) * step;
        const v = (j + 0.5) * step;
        const wb = ((u - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (v - a[1])) / area;
        const wc = ((b[0] - a[0]) * (v - a[1]) - (u - a[0]) * (b[1] - a[1])) / area;
        if (wb < -1e-9 || wc < -1e-9 || wb + wc > 1 + 1e-9) continue;
        const depth = a[2] + wb * (b[2] - a[2]) + wc * (c[2] - a[2]);
        const k = j * nu + i;
        const was = out[k] ?? Number.NaN;
        if (Number.isNaN(was) || depth > was) out[k] = depth;
      }
    }
  }
  return out;
}
