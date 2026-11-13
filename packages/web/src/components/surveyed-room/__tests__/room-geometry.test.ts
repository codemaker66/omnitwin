import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { wallAtlasUv } from "../../grand-hall/hall-atlas.js";
import { ceilingUv } from "../../grand-hall/hall-ceiling.js";
import { buildHallWallGeometry, floorUv } from "../../grand-hall/hall-geometry.js";
import { parseWallRelief } from "../../grand-hall/hall-relief.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WALLS, hallWall, wallPoint } from "../../grand-hall/hall-spec.js";
import { parseReliefContainer, type ReliefMesh } from "../relief-container.js";
import { roomAtlasUv } from "../room-atlas.js";
import { buildRoomFrame, outlineArea, pointOnWall, type PlanPoint, type RoomFrame, type Vec3 } from "../room-frame.js";
import {
  buildCeilingGeometry,
  buildFloorGeometry,
  buildRoomGeometry,
  buildWallGeometry,
  buildWallsGeometry,
  overheadUv,
  RoomGeometryError,
  surfaceBounds,
  triangulateOutline,
  type SurfaceGeometry,
  type WallsGeometry,
} from "../room-geometry.js";
import { parseSurveyRecord, type SurveyRecord } from "../survey-record.js";
import { GRAND_HALL_WALL_ORDER, grandHallFile, grandHallRecord } from "./fixtures/grand-hall-record.js";

const SALOON: SurveyRecord = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const SALOON_FRAME = buildRoomFrame(SALOON.room.outline);

function vertex(surface: Pick<SurfaceGeometry, "positions">, index: number): Vec3 {
  const { positions } = surface;
  return [positions[index * 3] ?? Number.NaN, positions[index * 3 + 1] ?? Number.NaN, positions[index * 3 + 2] ?? Number.NaN];
}

function uvAt(surface: Pick<SurfaceGeometry, "uvs">, index: number): [number, number] {
  return [surface.uvs[index * 2] ?? Number.NaN, surface.uvs[index * 2 + 1] ?? Number.NaN];
}

function normalAt(surface: Pick<SurfaceGeometry, "normals">, index: number): Vec3 {
  const { normals } = surface;
  return [normals[index * 3] ?? Number.NaN, normals[index * 3 + 1] ?? Number.NaN, normals[index * 3 + 2] ?? Number.NaN];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Each triangle's corners and its face normal by the right-hand rule: three's front is the side it points to. */
function triangles(surface: Pick<SurfaceGeometry, "positions" | "indices">, start = 0, count = surface.indices.length): { corners: [Vec3, Vec3, Vec3]; normal: Vec3 }[] {
  const out: { corners: [Vec3, Vec3, Vec3]; normal: Vec3 }[] = [];
  for (let t = start; t < start + count; t += 3) {
    const a = vertex(surface, surface.indices[t] ?? -1);
    const b = vertex(surface, surface.indices[t + 1] ?? -1);
    const c = vertex(surface, surface.indices[t + 2] ?? -1);
    out.push({ corners: [a, b, c], normal: cross(sub(b, a), sub(c, a)) });
  }
  return out;
}

/** Whether (x, z) lies inside an outline, by counting crossings of a ray along +x. */
function inside(outline: readonly PlanPoint[], x: number, z: number): boolean {
  let within = false;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i] ?? [0, 0];
    const [x1, z1] = outline[(i + 1) % outline.length] ?? [0, 0];
    if ((z0 > z) !== (z1 > z) && x < x0 + ((z - z0) / (z1 - z0)) * (x1 - x0)) within = !within;
  }
  return within;
}

/** The area of a surface's triangles, each as seen along `axis`. */
function facingArea(surface: Pick<SurfaceGeometry, "positions" | "indices">, axis: Vec3): number {
  return triangles(surface).reduce((sum, { normal }) => sum + dot(normal, axis) / 2, 0);
}

describe("a surveyed room's flat walls (no relief)", () => {
  const walls = buildWallsGeometry(SALOON, SALOON_FRAME, null);

  it("draws each of the Saloon's twelve walls as one quad to its height, in record order", () => {
    expect(walls.runs).toHaveLength(12);
    expect(walls.runs.map((run) => run.id)).toEqual(SALOON.walls.map((wall) => wall.id));
    expect(walls.runs.every((run) => !run.measured && run.vertexCount === 4 && run.indexCount === 6)).toBe(true);
    expect(walls.positions).toHaveLength(12 * 4 * 3);
    expect(walls.indices).toHaveLength(12 * 6);
    walls.runs.forEach((run, index) => {
      expect(run.wall).toBe(index);
      expect(run.vertexStart).toBe(index * 4);
      expect(run.indexStart).toBe(index * 6);
    });
  });

  it("winds every triangle to face the room: its front looks along the wall's normal, into the outline", () => {
    for (const run of walls.runs) {
      const frame = SALOON_FRAME.walls[run.wall];
      if (frame === undefined) throw new Error("no frame");
      for (const { corners, normal } of triangles(walls, run.indexStart, run.indexCount)) {
        const length = Math.hypot(...normal);
        expect(length, run.id).toBeGreaterThan(0);
        // Square to the wall, and pointing the way its frame's normal does.
        expect(dot(normal, frame.normal) / length, run.id).toBeCloseTo(1, 6);
        // A step off the triangle along its front is inside the room; a step behind it is not.
        const centre: Vec3 = [(corners[0][0] + corners[1][0] + corners[2][0]) / 3, 0, (corners[0][2] + corners[1][2] + corners[2][2]) / 3];
        const step = 0.02;
        expect(inside(SALOON.room.outline, centre[0] + (normal[0] / length) * step, centre[2] + (normal[2] / length) * step), run.id).toBe(true);
        expect(inside(SALOON.room.outline, centre[0] - (normal[0] / length) * step, centre[2] - (normal[2] / length) * step), run.id).toBe(false);
      }
    }
  });

  it("stands each wall on its outline segment, from the floor to its height", () => {
    walls.runs.forEach((run) => {
      const frame = SALOON_FRAME.walls[run.wall];
      const wall = SALOON.walls[run.wall];
      if (frame === undefined || wall === undefined) throw new Error("no wall");
      // u = 0 is the segment's end vertex, u = length its start: left to right seen from inside.
      expect(vertex(walls, run.vertexStart)).toEqual([Math.fround(frame.end[0]), 0, Math.fround(frame.end[1])]);
      expect(vertex(walls, run.vertexStart + 1)).toEqual([Math.fround(frame.start[0]), 0, Math.fround(frame.start[1])]);
      expect(vertex(walls, run.vertexStart + 2)).toEqual([Math.fround(frame.start[0]), Math.fround(wall.height), Math.fround(frame.start[1])]);
      expect(vertex(walls, run.vertexStart + 3)).toEqual([Math.fround(frame.end[0]), Math.fround(wall.height), Math.fround(frame.end[1])]);
      for (let i = 0; i < 4; i++) {
        expect(normalAt(walls, run.vertexStart + i)).toEqual(frame.normal.map(Math.fround));
        expect([walls.wallNormals[(run.vertexStart + i) * 2], walls.wallNormals[(run.vertexStart + i) * 2 + 1]]).toEqual([Math.fround(frame.normal[0]), Math.fround(frame.normal[2])]);
      }
    });
    const bounds = surfaceBounds(walls);
    expect(bounds.min).toEqual([Math.fround(SALOON_FRAME.bounds.minX), 0, Math.fround(SALOON_FRAME.bounds.minZ)]);
    expect(bounds.max).toEqual([Math.fround(SALOON_FRAME.bounds.maxX), Math.fround(5.515), Math.fround(SALOON_FRAME.bounds.maxZ)]);
  });

  it("takes each wall's corners from its own strip of the atlas", () => {
    // The rear wall's strip starts at texel (0, 1119) of the 4096 x 2304 atlas, 200 texels a metre,
    // its top row at v = 5.535 m.
    const rear = walls.runs.find((run) => run.id === "rear");
    if (rear === undefined) throw new Error("no rear wall");
    const row = (v: number): number => 1 - (1119 + (5.535 - v) * 200) / 2304;
    const [u0, v0] = uvAt(walls, rear.vertexStart);
    expect(u0).toBe(0);
    expect(v0).toBeCloseTo(row(0), 6);
    const [u1, v1] = uvAt(walls, rear.vertexStart + 2);
    // The wall is its outline segment's length, 7.101 m: 1420.2 texels along its 1421-texel strip.
    expect(u1).toBeCloseTo((7.101 * 200) / 4096, 6);
    expect(v1).toBeCloseTo(row(5.515), 6);
    // Every wall's texels stay inside its own strip.
    walls.runs.forEach((run) => {
      const [x, y, w, h] = SALOON.walls[run.wall]?.atlas ?? [0, 0, 0, 0];
      for (let i = 0; i < run.vertexCount; i++) {
        const [s, t] = uvAt(walls, run.vertexStart + i);
        expect(s * 4096, run.id).toBeGreaterThanOrEqual(x - 1e-3);
        expect(s * 4096, run.id).toBeLessThanOrEqual(x + w + 1e-3);
        expect((1 - t) * 2304, run.id).toBeGreaterThanOrEqual(y - 1e-3);
        expect((1 - t) * 2304, run.id).toBeLessThanOrEqual(y + h + 1e-3);
      }
    });
  });
});

describe("a surveyed room's wall from its relief", () => {
  const frame = SALOON_FRAME.walls[6];
  const wall = SALOON.walls[6];
  if (frame === undefined || wall === undefined) throw new Error("no rear wall");
  /** A flat field with one point standing 0.3 m proud of it at (2, 1). */
  const relief: ReliefMesh = {
    id: "rear",
    positions: Float32Array.from([0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 3, 0, 2, 1, 0.3]),
    indices: Uint32Array.from([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
  };

  it("places (u, v, depth) on the wall's frame and colours it at (u, v) whatever its depth", () => {
    const built = buildWallGeometry(frame, wall, SALOON.atlas, relief);
    expect(built.measured).toBe(true);
    expect(built.wall).toBe(6);
    expect(built.indices).toEqual(relief.indices);
    for (let i = 0; i < 5; i++) {
      const [u, v, depth] = [relief.positions[i * 3] ?? 0, relief.positions[i * 3 + 1] ?? 0, relief.positions[i * 3 + 2] ?? 0];
      expect(vertex(built, i)).toEqual(pointOnWall(frame, u, v, depth).map(Math.fround));
      expect(uvAt(built, i)).toEqual(roomAtlasUv(SALOON.atlas, wall, u, v).map(Math.fround));
    }
    // The proud point stands into the room: further along the wall's normal than the wall's face.
    expect(dot(sub(vertex(built, 4), vertex(built, 0)), frame.normal)).toBeCloseTo(0.3, 6);
    // Every face looks into the room, and the corners' normals lean away from the proud point.
    for (const { normal } of triangles(built)) expect(dot(normal, frame.normal)).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      expect(Math.hypot(...normalAt(built, i))).toBeCloseTo(1, 6);
      expect(dot(normalAt(built, i), frame.normal)).toBeGreaterThan(0.9);
    }
    expect(dot(normalAt(built, 4), frame.normal)).toBeCloseTo(1, 2);
  });

  it("refuses a relief wound the other way, which would draw as nothing", () => {
    const reversed: ReliefMesh = { ...relief, indices: Uint32Array.from([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]) };
    expect(() => buildWallGeometry(frame, wall, SALOON.atlas, reversed)).toThrow(RoomGeometryError);
    expect(() => buildWallGeometry(frame, wall, SALOON.atlas, reversed)).toThrow(/wall "rear"'s relief is wound clockwise seen from the room/);
  });

  it("draws the walls that have an entry from it and the rest flat", () => {
    const walls = buildWallsGeometry(SALOON, SALOON_FRAME, new Map([["rear", relief]]));
    expect(walls.runs.filter((run) => run.measured).map((run) => run.id)).toEqual(["rear"]);
    const rear = walls.runs[6];
    if (rear === undefined) throw new Error("no rear run");
    expect(rear.vertexCount).toBe(5);
    expect(rear.indexCount).toBe(12);
    // The shared arrays' indices point at the wall's own vertices.
    for (let i = 0; i < rear.indexCount; i++) {
      const index = walls.indices[rear.indexStart + i] ?? -1;
      expect(index).toBeGreaterThanOrEqual(rear.vertexStart);
      expect(index).toBeLessThan(rear.vertexStart + rear.vertexCount);
    }
    expect(walls.positions.length / 3).toBe(11 * 4 + 5);
    expect(Math.max(...walls.indices)).toBe(walls.positions.length / 3 - 1);
  });

  it("refuses a record whose walls are not the outline's segments", () => {
    const short = { ...SALOON, walls: SALOON.walls.slice(0, 11) };
    expect(() => buildWallsGeometry(short, SALOON_FRAME, null)).toThrow(/11 walls but the outline frames 12/);
  });
});

describe("triangulating an outline", () => {
  const shapes: readonly (readonly [string, readonly PlanPoint[]])[] = [
    ["the Saloon (twelve corners, four of them reflex)", SALOON.room.outline],
    ["a rectangle", [[2, -1], [-2, -1], [-2, 1], [2, 1]]],
    ["an L", [[3, 0], [0, 0], [0, 3], [1, 3], [1, 1], [3, 1]]],
    ["a U, whose mouth an ear must not close", [[4, -3], [0, -3], [0, 0], [4, 0], [4, -1], [1, -1], [1, -2], [4, -2]]],
    ["a square with a vertex on a straight run", [[1, -1], [0, -1], [-1, -1], [-1, 1], [1, 1], [1, 0]]],
    ["a comb", [[6, 0], [5, 0], [5, 2], [4, 2], [4, 0], [3, 0], [3, 2], [2, 2], [2, 0], [1, 0], [1, 2], [0, 2], [0, 3], [6, 3]]],
  ];

  it.each(shapes)("covers %s exactly, with triangles wound as the outline and none outside it", (_name, outline) => {
    // The shapes are wound as the tools wind outlines (the frame refuses any other).
    buildRoomFrame(outline);
    const indices = triangulateOutline(outline);
    expect(indices.length % 3).toBe(0);
    let area = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [outline[indices[t] ?? -1], outline[indices[t + 1] ?? -1], outline[indices[t + 2] ?? -1]];
      if (a === undefined || b === undefined || c === undefined) throw new Error("an index left the outline");
      const twice = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      expect(twice).toBeGreaterThan(0);
      area += twice / 2;
      expect(inside(outline, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)).toBe(true);
    }
    expect(area).toBeCloseTo(outlineArea(outline), 9);
  });

  it("uses every corner of the Saloon, in ten triangles", () => {
    const indices = triangulateOutline(SALOON.room.outline);
    expect(indices).toHaveLength(10 * 3);
    expect(new Set(indices).size).toBe(12);
  });
});

describe("a surveyed room's floor", () => {
  const floor = buildFloorGeometry(SALOON, SALOON_FRAME);

  it("is the outline at y = 0, facing up, with the outline's area though it is not convex", () => {
    expect(floor.positions).toHaveLength(12 * 3);
    SALOON.room.outline.forEach(([x, z], i) => {
      expect(vertex(floor, i)).toEqual([Math.fround(x), 0, Math.fround(z)]);
      expect(normalAt(floor, i)).toEqual([0, 1, 0]);
    });
    for (const { normal } of triangles(floor)) {
      expect(normal[1]).toBeGreaterThan(0);
      expect(Math.abs(normal[0])).toBe(0);
      expect(Math.abs(normal[2])).toBe(0);
    }
    expect(facingArea(floor, [0, 1, 0])).toBeCloseTo(SALOON_FRAME.area, 4);
    // Its bounding rectangle, 12.191 m by 7.473 m, less its four corners, where the end stretches
    // of the two long walls stand in from their middles: 2.16 x 0.24, 2.261 x 0.194, 2.199 x 0.178
    // and 2.209 x 0.225 m.
    const corners = 2.16 * 0.24 + 2.261 * 0.194 + 2.199 * 0.178 + 2.209 * 0.225;
    expect(SALOON_FRAME.area).toBeCloseTo(12.191 * 7.473 - corners, 9);
    expect(SALOON_FRAME.area).toBeCloseTo(89.257862, 6);
  });

  it("lays its photograph over floor.extent: columns along +x, the top row at the highest z", () => {
    const { extent } = SALOON.floor;
    expect(overheadUv(extent, extent.x[0], extent.z[0])).toEqual([0, 0]);
    expect(overheadUv(extent, extent.x[1], extent.z[1])).toEqual([1, 1]);
    // The outline's first corner, (6.095, 3.514): the image's last column, 225 mm below its top row.
    const [s, t] = uvAt(floor, 0);
    expect(s).toBe(1);
    expect(t).toBeCloseTo(1 - 0.225 / 7.473, 6);
    for (let i = 0; i < 12; i++) {
      const [x, z] = SALOON.room.outline[i] ?? [0, 0];
      expect(uvAt(floor, i)).toEqual(overheadUv(extent, x, z).map(Math.fround));
      expect(uvAt(floor, i)[0]).toBeGreaterThanOrEqual(0);
      expect(uvAt(floor, i)[0]).toBeLessThanOrEqual(1);
      expect(uvAt(floor, i)[1]).toBeGreaterThanOrEqual(0);
      expect(uvAt(floor, i)[1]).toBeLessThanOrEqual(1);
    }
  });
});

describe("a surveyed room's ceiling", () => {
  it("without a relief is the outline at the room's ceiling height, facing down", () => {
    const flat = buildCeilingGeometry(SALOON, SALOON_FRAME, null);
    expect(flat.measured).toBe(false);
    expect(flat.positions).toHaveLength(12 * 3);
    SALOON.room.outline.forEach(([x, z], i) => {
      expect(vertex(flat, i)).toEqual([Math.fround(x), Math.fround(5.515), Math.fround(z)]);
      expect(normalAt(flat, i)).toEqual([0, -1, 0]);
      expect(uvAt(flat, i)).toEqual(overheadUv(SALOON.ceiling.extent, x, z).map(Math.fround));
    });
    for (const { normal } of triangles(flat)) expect(normal[1]).toBeLessThan(0);
    expect(facingArea(flat, [0, -1, 0])).toBeCloseTo(SALOON_FRAME.area, 4);
  });

  /** A 2 m square of ceiling over (x, z), one corner a coffer 0.2 m above the reference and one 0.1 m below. */
  const relief: ReliefMesh = {
    id: "ceiling",
    positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, -0.2, -1, 1, 0.1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };

  it("from its relief takes u as x, v as z and depth down from the reference height, facing down", () => {
    const built = buildCeilingGeometry(SALOON, SALOON_FRAME, relief);
    expect(built.measured).toBe(true);
    expect(vertex(built, 0)).toEqual([-1, Math.fround(5.515), -1]);
    expect(vertex(built, 1)).toEqual([1, Math.fround(5.515), -1]);
    // Depth is positive towards the room: a negative depth is higher than the reference.
    expect(vertex(built, 2)).toEqual([1, Math.fround(5.515 + 0.2), 1]);
    expect(vertex(built, 3)).toEqual([-1, Math.fround(5.515 - 0.1), 1]);
    for (const { normal } of triangles(built)) expect(normal[1]).toBeLessThan(0);
    for (let i = 0; i < 4; i++) {
      expect(normalAt(built, i)[1]).toBeLessThan(-0.9);
      expect(Math.hypot(...normalAt(built, i))).toBeCloseTo(1, 6);
      const [x, , z] = vertex(built, i);
      expect(uvAt(built, i)).toEqual(overheadUv(SALOON.ceiling.extent, x, z).map(Math.fround));
    }
  });

  it("refuses a ceiling relief wound clockwise seen from below", () => {
    const reversed: ReliefMesh = { ...relief, indices: Uint32Array.from([0, 2, 1, 0, 3, 2]) };
    expect(() => buildCeilingGeometry(SALOON, SALOON_FRAME, reversed)).toThrow(/the ceiling's relief is wound clockwise seen from the room/);
  });

  it("is flat where the record describes no relief, whatever it is handed", () => {
    const { relief: _described, ...ceiling } = SALOON.ceiling;
    const built = buildCeilingGeometry({ ...SALOON, ceiling }, SALOON_FRAME, relief);
    expect(built.measured).toBe(false);
  });
});

describe("a whole room", () => {
  it("builds the Saloon's three surfaces, closed at the walls' feet and heads when all is flat", () => {
    const room = buildRoomGeometry(SALOON, SALOON_FRAME, { walls: null, ceiling: null });
    const bounds = surfaceBounds(room.walls, room.ceiling, room.floor);
    expect(bounds.min[1]).toBe(0);
    expect(bounds.max[1]).toBe(Math.fround(5.515));
    expect(surfaceBounds(room.floor).max[1]).toBe(0);
    expect(surfaceBounds(room.ceiling).min[1]).toBe(Math.fround(5.515));
    expect(surfaceBounds(room.floor).min).toEqual(surfaceBounds(room.walls).min);
  });
});

// ---------------------------------------------------------------------------
// The one real survey in the repository: the Grand Hall's shipped relief,
// through the room-driven path, against the hall's own code.
// ---------------------------------------------------------------------------

describe("the Grand Hall's shipped relief through the room-driven path", () => {
  const record = grandHallRecord();
  const frame: RoomFrame = buildRoomFrame(record.room.outline);
  const buffer = grandHallFile("walls-relief.bin");
  const relief = parseReliefContainer(buffer, { maxEntries: 4, label: "Grand Hall walls relief" });
  const walls: WallsGeometry = buildWallsGeometry(record, frame, relief);

  it("frames the hall's four walls exactly as hall-spec.ts does", () => {
    expect(record.walls.map((wall) => wall.id)).toEqual(GRAND_HALL_WALL_ORDER);
    frame.walls.forEach((wallFrame, index) => {
      const id = GRAND_HALL_WALL_ORDER[index];
      if (id === undefined) throw new Error("no wall");
      const hall = hallWall(id);
      expect(wallFrame.origin, id).toEqual(hall.origin);
      expect(wallFrame.tangent, id).toEqual(hall.tangent);
      expect(wallFrame.normal, id).toEqual(hall.normal);
      expect(wallFrame.length, id).toBe(hall.length);
    });
  });

  it("places every vertex where wallPoint does and colours it where wallAtlasUv does", () => {
    let compared = 0;
    let worstUv = 0;
    for (const run of walls.runs) {
      const id = GRAND_HALL_WALL_ORDER[run.wall];
      const mesh = relief.get(run.id);
      if (id === undefined || mesh === undefined) throw new Error("no wall");
      expect(run.measured).toBe(true);
      expect(run.vertexCount).toBe(mesh.positions.length / 3);
      expect(run.indexCount).toBe(mesh.indices.length);
      const hall = hallWall(id);
      for (let i = 0; i < run.vertexCount; i++) {
        const [u, v, depth] = [mesh.positions[i * 3] ?? 0, mesh.positions[i * 3 + 1] ?? 0, mesh.positions[i * 3 + 2] ?? 0];
        const expected = wallPoint(hall, u, v, depth).map(Math.fround);
        const actual = vertex(walls, run.vertexStart + i);
        if (!(Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]) && Object.is(actual[2], expected[2]))) {
          throw new Error(`${id} vertex ${String(i)}: ${actual.join(", ")} is not ${expected.join(", ")}`);
        }
        const [s, t] = uvAt(walls, run.vertexStart + i);
        const [hs, ht] = wallAtlasUv(id, u, v);
        worstUv = Math.max(worstUv, Math.abs(s - hs), Math.abs(t - ht));
        compared++;
      }
    }
    // Every vertex of the file: 8,883 + 2,597 + 3,453 + 2,980.
    expect(compared).toBe(17913);
    // The same arithmetic, stored as 32-bit floats: half a unit in the last place of a number below 1.
    expect(worstUv).toBeLessThanOrEqual(2 ** -25);
  });

  it("faces the room: each wall's relief, seen along its normal, covers its rectangle once", () => {
    let total = 0;
    let away = 0;
    for (const run of walls.runs) {
      const wallFrame = frame.walls[run.wall];
      if (wallFrame === undefined) throw new Error("no frame");
      let seen = 0;
      let folded = 0;
      for (const { normal } of triangles(walls, run.indexStart, run.indexCount)) {
        total++;
        const facing = dot(normal, wallFrame.normal) / 2;
        seen += facing;
        if (facing < 0) {
          away++;
          folded -= facing;
        }
      }
      // Front faces less back faces, as the wall's photograph saw them: the wall's own rectangle.
      expect(seen, run.id).toBeCloseTo(wallFrame.length * HALL_HEIGHT, 2);
      // Simplifying the height field left slivers folded back on its steps: under 0.2% of each wall.
      expect(folded / seen, run.id).toBeLessThan(0.002);
    }
    expect(total).toBe(35185);
    // Measured 13 November 2026: about 1.5% of the 35,185 triangles are such slivers.
    expect(away / total).toBeLessThan(0.02);
    for (let i = 0; i < walls.normals.length / 3; i++) {
      const length = Math.hypot(...normalAt(walls, i));
      if (Math.abs(length - 1) > 1e-5) throw new Error(`normal ${String(i)} has length ${String(length)}`);
    }
  });

  it("stays in the hall's envelope: the relief's own depth range about each wall's plane", () => {
    const bounds = surfaceBounds(walls);
    // The file's depth range is -1.0 to 0.9 m (behind and in front of the plaster plane).
    expect(bounds.min[0]).toBeGreaterThanOrEqual(-HALL_HALF_LENGTH - 1.0001);
    expect(bounds.max[0]).toBeLessThanOrEqual(HALL_HALF_LENGTH + 1.0001);
    expect(bounds.min[2]).toBeGreaterThanOrEqual(-HALL_HALF_WIDTH - 1.0001);
    expect(bounds.max[2]).toBeLessThanOrEqual(HALL_HALF_WIDTH + 1.0001);
    expect(bounds.min[1]).toBe(0);
    expect(bounds.max[1]).toBe(Math.fround(HALL_HEIGHT));
    // The windows' glass lies behind the window wall's plane (z below -half the width).
    expect(bounds.min[2]).toBeLessThan(-HALL_HALF_WIDTH - 0.2);
  });

  it("agrees with the hall's own wall builder wherever the two draw the same relief", () => {
    // The hall draws its relief cut along its doorways (drawnRelief), split between two materials
    // and by neighbour and opening, with points added where a cut's plane crosses a triangle. What
    // is comparable: every vertex the hall kept from the file, and every triangle it kept whole.
    const hall = buildHallWallGeometry(parseWallRelief(buffer));
    const mine = new Map<string, number>();
    const key = (wall: number, p: Vec3): string => `${String(wall)}:${String(p[0])},${String(p[1])},${String(p[2])}`;
    for (const run of walls.runs) {
      for (let i = 0; i < run.vertexCount; i++) mine.set(key(run.wall, vertex(walls, run.vertexStart + i)), run.vertexStart + i);
    }
    const myTriangles = new Set<string>();
    for (let t = 0; t < walls.indices.length; t += 3) {
      const [a, b, c] = [walls.indices[t] ?? -1, walls.indices[t + 1] ?? -1, walls.indices[t + 2] ?? -1];
      // Each rotation of a triangle is the same triangle with the same front.
      myTriangles.add(`${String(a)},${String(b)},${String(c)}`).add(`${String(b)},${String(c)},${String(a)}`).add(`${String(c)},${String(a)},${String(b)}`);
    }
    const mineIndexOfHallWall = (hallIndex: number): number => GRAND_HALL_WALL_ORDER.indexOf(HALL_WALLS[hallIndex]?.id ?? "window");
    let hallVertices = 0;
    let shared = 0;
    let worstUv = 0;
    let hallTriangles = 0;
    let wholeTriangles = 0;
    let sameTriangles = 0;
    let sameNormals = 0;
    const matched = new Set<number>();
    for (const geometry of hall.geometries.values()) {
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const atlas = geometry.getAttribute("aAtlas");
      const wallOf = geometry.getAttribute("aWall");
      const index = geometry.getIndex();
      if (index === null) throw new Error("the hall's walls are indexed");
      const twin: number[] = [];
      for (let i = 0; i < position.count; i++) {
        hallVertices++;
        const found = mine.get(key(mineIndexOfHallWall(wallOf.getX(i)), [position.getX(i), position.getY(i), position.getZ(i)]));
        twin.push(found ?? -1);
        if (found === undefined) continue;
        shared++;
        matched.add(found);
        const [s, t] = uvAt(walls, found);
        worstUv = Math.max(worstUv, Math.abs(s - atlas.getX(i)), Math.abs(t - atlas.getY(i)));
        if (dot(normalAt(walls, found), [normal.getX(i), normal.getY(i), normal.getZ(i)]) > 0.9999) sameNormals++;
      }
      for (let t = 0; t < index.count; t += 3) {
        hallTriangles++;
        const [a, b, c] = [twin[index.getX(t)] ?? -1, twin[index.getX(t + 1)] ?? -1, twin[index.getX(t + 2)] ?? -1];
        if (a < 0 || b < 0 || c < 0) continue;
        wholeTriangles++;
        if (myTriangles.has(`${String(a)},${String(b)},${String(c)}`)) sameTriangles++;
      }
    }
    // Measured 13 November 2026: of the hall's 19,938 vertices (it copies a vertex per material,
    // neighbour and opening), 19,246 stand bit for bit where one of this path's 17,913 does, on the
    // same wall; the other 692 are points its doorway cuts made. 196 of this path's vertices have no
    // twin: the relief inside the doorways, which the hall's modelled doors replace.
    expect(shared / hallVertices).toBeGreaterThan(0.95);
    expect(matched.size / (walls.positions.length / 3)).toBeGreaterThan(0.98);
    // At every shared vertex the atlas coordinate is the same 32-bit number.
    expect(worstUv).toBe(0);
    // Of the hall's 35,099 triangles, the 34,600 whose corners all came from the file are each one
    // of this path's, wound the same way: what faces the room there faces it here.
    expect(wholeTriangles / hallTriangles).toBeGreaterThan(0.97);
    expect(sameTriangles).toBe(wholeTriangles);
    // The vertex normals agree too (19,033 of the 19,246 within a degree), except beside the
    // doorways, where the hall's normals leave out the triangles it cut away.
    expect(sameNormals / shared).toBeGreaterThan(0.97);
  });

  it("lays the hall's floor and ceiling photographs as the hall's own code does", () => {
    for (const [x, z] of [[-HALL_HALF_LENGTH, -HALL_HALF_WIDTH], [HALL_HALF_LENGTH, HALL_HALF_WIDTH], [3.2, -1.7], [-8.05, 4.4]] as const) {
      const [fs, ft] = overheadUv(record.floor.extent, x, z);
      expect(fs).toBeCloseTo(floorUv(x, z)[0], 12);
      expect(ft).toBeCloseTo(floorUv(x, z)[1], 12);
      const [cs, ct] = overheadUv(record.ceiling.extent, x, z);
      expect(cs).toBeCloseTo(ceilingUv(x, z)[0], 12);
      expect(ct).toBeCloseTo(ceilingUv(x, z)[1], 12);
    }
  });

  it("builds the whole room in a few milliseconds, so nothing needs slicing", () => {
    const started = performance.now();
    const room = buildRoomGeometry(record, frame, { walls: relief, ceiling: null });
    const spent = performance.now() - started;
    expect(room.walls.indices.length / 3).toBe(35185);
    expect(room.floor.indices.length / 3).toBe(2);
    // Generous for a loaded machine: the build is arithmetic on 17,913 vertices.
    expect(spent).toBeLessThan(500);
  });
});
