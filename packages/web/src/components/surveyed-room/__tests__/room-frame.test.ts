import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_WALLS } from "../../grand-hall/hall-spec.js";
import { isPointInPolygon, roomGeometries } from "../../../data/room-geometries.js";
import {
  buildRoomFrame,
  outlineArea,
  outlineBounds,
  outlineCrossing,
  outlineFault,
  outlineForPlanner,
  outlineSignedArea,
  pointOnWall,
  type PlanPoint,
} from "../room-frame.js";

interface Fixture {
  readonly room: { readonly outline: readonly PlanPoint[] };
  readonly walls: readonly { readonly id: string }[];
}

const fixture = JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
) as Fixture;
const SALOON = fixture.room.outline;

/** The Grand Hall's rectangle, wound as the tools wind outlines. */
const GRAND_HALL: readonly PlanPoint[] = [
  [HALL_HALF_LENGTH, -HALL_HALF_WIDTH],
  [-HALL_HALF_LENGTH, -HALL_HALF_WIDTH],
  [-HALL_HALF_LENGTH, HALL_HALF_WIDTH],
  [HALL_HALF_LENGTH, HALL_HALF_WIDTH],
];

/** Whether two closed polygons visit the same vertices in the same cyclic order. */
function sameCycle(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  if (a.length !== b.length) return false;
  return a.some((_, shift) => a.every((point, i) => {
    const other = b[(i + shift) % b.length];
    return other !== undefined && other[0] === point[0] && other[1] === point[1];
  }));
}

describe("surveyed room frame", () => {
  it("measures the Saloon's twelve walls to the tools' atlas strip widths", () => {
    const frame = buildRoomFrame(SALOON);
    expect(frame.walls).toHaveLength(12);
    expect(frame.walls.map((wall) => Math.ceil(wall.length * 200))).toEqual([1402, 432, 48, 1554, 39, 453, 1421, 440, 36, 1557, 46, 442]);
    expect(fixture.walls.map((wall) => wall.id)).toEqual([
      "front", "window-front-end", "window-front-return", "window", "window-rear-return", "window-rear-end",
      "rear", "fireplace-rear-end", "fireplace-rear-return", "fireplace", "fireplace-front-return", "fireplace-front-end",
    ]);
  });

  it("points every Saloon wall's normal into the room, with unit tangents and normals at right angles", () => {
    const frame = buildRoomFrame(SALOON);
    for (const wall of frame.walls) {
      const middle = pointOnWall(wall, wall.length / 2, 0);
      const label = `wall ${String(wall.index)}`;
      // The planner's own point-in-polygon test, not this module's.
      expect(isPointInPolygon(middle[0] + wall.normal[0] * 0.01, middle[2] + wall.normal[2] * 0.01, SALOON), label).toBe(true);
      expect(isPointInPolygon(middle[0] - wall.normal[0] * 0.01, middle[2] - wall.normal[2] * 0.01, SALOON), label).toBe(false);
      expect(Math.hypot(...wall.tangent)).toBeCloseTo(1, 12);
      expect(Math.hypot(...wall.normal)).toBeCloseTo(1, 12);
      expect(wall.tangent[0] * wall.normal[0] + wall.tangent[2] * wall.normal[2]).toBeCloseTo(0, 12);
    }
  });

  it("puts u = 0 at a segment's end vertex and u = length at its start", () => {
    const frame = buildRoomFrame(SALOON);
    frame.walls.forEach((wall, i) => {
      const start = SALOON[i];
      const end = SALOON[(i + 1) % SALOON.length];
      if (start === undefined || end === undefined) throw new Error("outline too short");
      expect(pointOnWall(wall, 0, 0)).toEqual([end[0], 0, end[1]]);
      const far = pointOnWall(wall, wall.length, 1.5);
      expect(far[0]).toBeCloseTo(start[0], 12);
      expect(far[1]).toBe(1.5);
      expect(far[2]).toBeCloseTo(start[1], 12);
      const proud = pointOnWall(wall, 0, 0, 0.25);
      expect(proud[0]).toBeCloseTo(end[0] + wall.normal[0] * 0.25, 12);
      expect(proud[2]).toBeCloseTo(end[1] + wall.normal[2] * 0.25, 12);
    });
  });

  it("finds the Saloon's bounds and floor area", () => {
    const frame = buildRoomFrame(SALOON);
    expect(frame.bounds).toEqual({ minX: -6.096, maxX: 6.095, minZ: -3.734, maxZ: 3.739 });
    // The 12.191 m × 7.473 m box less the four corners the window and
    // fireplace recesses leave out of it.
    const box = 12.191 * 7.473;
    const corners = 2.16 * 0.24 + 2.261 * 0.194 + 2.199 * 0.178 + 2.209 * 0.225;
    expect(frame.area).toBeCloseTo(box - corners, 9);
    expect(outlineSignedArea(SALOON)).toBeGreaterThan(0);
  });

  it("builds the Grand Hall's four walls exactly as hall-spec.ts writes them", () => {
    const frame = buildRoomFrame(GRAND_HALL);
    expect(frame.walls).toHaveLength(HALL_WALLS.length);
    for (const hall of HALL_WALLS) {
      const matches = frame.walls.filter((wall) => wall.normal.every((value, axis) => value === hall.normal[axis]));
      expect(matches, hall.id).toHaveLength(1);
      const wall = matches[0];
      if (wall === undefined) throw new Error(hall.id);
      expect(wall.origin, hall.id).toEqual(hall.origin);
      expect(wall.tangent, hall.id).toEqual(hall.tangent);
      expect(wall.normal, hall.id).toEqual(hall.normal);
      expect(wall.length, hall.id).toBe(hall.length);
    }
    expect(frame.area).toBeCloseTo(21.135 * 10.59, 9);
  });

  it("winds an outline for the planner as data/room-geometries.ts winds the Grand Hall", () => {
    const planner = outlineForPlanner(GRAND_HALL);
    const hall = roomGeometries["Grand Hall"];
    if (hall === undefined) throw new Error("no Grand Hall geometry");
    expect(outlineSignedArea(planner)).toBeLessThan(0);
    expect(sameCycle(planner, hall.wallPolygon)).toBe(true);
    // The tools' outline is left as it was.
    expect(GRAND_HALL[0]).toEqual([HALL_HALF_LENGTH, -HALL_HALF_WIDTH]);
  });

  it("refuses outlines that cannot frame a room", () => {
    expect(outlineFault([[0, 0], [1, 0]])).toMatch(/at least 3/);
    expect(outlineFault([[0, 0], [0, 0], [1, -1]])).toMatch(/segment 0 has no length/);
    // A bow tie: segments 0 and 2 cross.
    expect(outlineFault([[0, 0], [1, -1], [1, 0], [0, -1]])).toMatch(/crosses itself/);
    expect(outlineCrossing([[0, 0], [1, -1], [1, 0], [0, -1]])).toEqual([0, 2]);
    // A spike that folds back along itself.
    expect(outlineFault([[0, 0], [2, 0], [1, 0], [1, -1]])).toMatch(/crosses itself/);
    expect(outlineFault([...SALOON].reverse())).toMatch(/clockwise/);
    expect(() => buildRoomFrame([...GRAND_HALL].reverse())).toThrow(/clockwise/);
    expect(outlineFault(SALOON)).toBeNull();
  });

  it("measures area and bounds for either winding", () => {
    expect(outlineArea([...SALOON].reverse())).toBeCloseTo(outlineArea(SALOON), 12);
    expect(outlineBounds(GRAND_HALL)).toEqual({ minX: -HALL_HALF_LENGTH, maxX: HALL_HALF_LENGTH, minZ: -HALL_HALF_WIDTH, maxZ: HALL_HALF_WIDTH });
  });
});
