import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRoomFrame, type PlanPoint } from "../room-frame.js";
import { ceilingShown, packShownWalls, RETURN_MAX_LENGTH, roomPlanes, wallsShown, type RoomPlanes } from "../room-visibility.js";
import { parseSurveyRecord } from "../survey-record.js";

const SALOON = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const SALOON_PLANES = roomPlanes(buildRoomFrame(SALOON.room.outline), SALOON.room.ceilingHeight);
const SALOON_IDS = SALOON.walls.map((wall) => wall.id);

/** The walls drawn for a camera at (x, z), by index. */
function drawn(planes: RoomPlanes, x: number, z: number): number[] {
  const shown = new Uint8Array(planes.walls.length);
  wallsShown(planes, x, z, shown);
  return [...shown].flatMap((flag, wall) => (flag === 1 ? [wall] : []));
}

/** The Saloon's walls not drawn for a camera at (x, z), by id. */
function gone(x: number, z: number): string[] {
  const shown = drawn(SALOON_PLANES, x, z);
  return SALOON_IDS.filter((_, wall) => !shown.includes(wall));
}

/** A 4 m by 2 m room about the origin: walls 0 at -z (looking +z), 1 at -x, 2 at +z, 3 at +x. */
const BOX: readonly PlanPoint[] = [[2, -1], [-2, -1], [-2, 1], [2, 1]];
const BOX_PLANES = roomPlanes(buildRoomFrame(BOX), 3);

describe("which walls the camera's side lets it see", () => {
  it("draws every wall for a camera inside the room, wherever it stands", () => {
    expect(drawn(BOX_PLANES, 0, 0)).toEqual([0, 1, 2, 3]);
    expect(drawn(BOX_PLANES, 1.99, -0.99)).toEqual([0, 1, 2, 3]);
    expect(gone(0, 0)).toEqual([]);
    expect(gone(-2, 2.5)).toEqual([]);
  });

  it("takes from a camera inside the room only the walls turned from it: beyond a bay, that bay's nearer returns", () => {
    // In the +x end of the Saloon, past both bays: an outline need not be convex, and each return there faces away.
    expect(gone(5.9, -3.3)).toEqual(["window-front-return", "fireplace-front-return"]);
  });

  it("takes away the wall the camera is behind, and both walls of a corner it stands beyond", () => {
    expect(drawn(BOX_PLANES, 0, -6)).toEqual([1, 2, 3]);
    expect(drawn(BOX_PLANES, 9, 0)).toEqual([0, 1, 2]);
    expect(drawn(BOX_PLANES, 9, 6)).toEqual([0, 1]);
    // However far along a wall's plane the camera is, it is that plane which decides.
    expect(drawn(BOX_PLANES, 40, -1.5)).toEqual([1, 2]);
  });

  it("draws a wall the camera is exactly on the plane of, and not one it is a millimetre behind", () => {
    // Edge-on, a wall's flat face covers nothing and its relief's sides are seen truly.
    expect(drawn(BOX_PLANES, 0, -1)).toContain(0);
    expect(drawn(BOX_PLANES, 0, -1.001)).not.toContain(0);
    expect(drawn(BOX_PLANES, 2, 0)).toContain(3);
    expect(drawn(BOX_PLANES, 2.001, 0)).not.toContain(3);
  });

  it("decides by the wall's plane whatever stands proud of it: in front, among its relief, the wall is drawn", () => {
    // 0.3 m into the room from the window wall's plane, where a pier or a shutter case would stand.
    const z = -3.734 + 0.3;
    expect(gone(0, z)).not.toContain("window");
    expect(gone(0, -3.734 - 0.001)).toContain("window");
  });

  it("takes the whole window side of the Saloon from outside it, its bay's returns included", () => {
    // The returns face along the side, towards each other: by their own planes the camera is in front of both.
    expect(gone(0, -10)).toEqual(["window-front-end", "window-front-return", "window", "window-rear-return", "window-rear-end"]);
    expect(gone(0, 10)).toEqual(["fireplace-rear-end", "fireplace-rear-return", "fireplace", "fireplace-front-return", "fireplace-front-end"]);
  });

  it("takes an end wall of the Saloon from beyond it, and only the returns that are turned from the camera", () => {
    // From beyond the +x end: the returns facing -x are behind their own planes; those facing +x are seen, as their neighbours are.
    expect(gone(15, 0)).toEqual(["front", "window-front-return", "fireplace-front-return"]);
    expect(gone(-15, 0)).toEqual(["window-rear-return", "rear", "fireplace-rear-return"]);
  });

  it("takes two sides from beyond a corner, with every return of the side that has gone", () => {
    expect(gone(15, -10)).toEqual(["front", "window-front-end", "window-front-return", "window", "window-rear-return", "window-rear-end", "fireplace-front-return"]);
  });

  it("keeps a return while either of its neighbours is drawn: standing in the bay, the window wall and both returns", () => {
    // Between the end walls' plane (z = -3.494) and the window wall's (z = -3.734): inside the bay.
    expect(gone(0, -3.6)).toEqual(["window-front-end", "window-rear-end"]);
  });

  it("keeps a long wall whose neighbours have both gone: it is a wall of the room, not a strip", () => {
    // An L: the arm along +x is closed by wall 5 (x = 3) and its side is wall 4 (z = 1, 2 m long), next to wall 3 (x = 1).
    const ell: readonly PlanPoint[] = [[3, 0], [0, 0], [0, 3], [1, 3], [1, 1], [3, 1]];
    const planes = roomPlanes(buildRoomFrame(ell), 3);
    // From beyond the arm's end, level with the arm: walls 3 and 5 are behind, wall 4 between them faces the camera.
    expect(drawn(planes, 8, 0.5)).toEqual([0, 1, 2, 4]);
  });

  it("takes a return between two walls that have gone, and keeps the short walls of a recess the camera stands in", () => {
    // A side stepped twice by 0.3 m: two short returns (walls 1 and 3) either side of a short wall (2, 0.5 m).
    const stepped: readonly PlanPoint[] = [[4, 0], [1, 0], [1, -0.3], [0.5, -0.3], [0.5, 0], [-4, 0], [-4, 3], [4, 3]];
    const frame = buildRoomFrame(stepped);
    expect(frame.walls.slice(1, 4).every((wall) => wall.length <= RETURN_MAX_LENGTH)).toBe(true);
    const planes = roomPlanes(frame, 3);
    // From outside the stepped side, to the left of the step: walls 0, 2 and 4 are behind.
    // Wall 1 faces the camera between two walls that have gone, so it goes; wall 3 is turned from the camera.
    expect(drawn(planes, -2, -5)).toEqual([5, 6, 7]);
    // From inside the step's own recess, wall 2 is in front: its returns stay, each with a neighbour drawn.
    expect(drawn(planes, 0.75, -0.1)).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it("marks as short only walls of RETURN_MAX_LENGTH or less: the Saloon's four returns", () => {
    expect(SALOON_IDS.filter((_, wall) => SALOON_PLANES.walls[wall]?.short === true)).toEqual([
      "window-front-return", "window-rear-return", "fireplace-rear-return", "fireplace-front-return",
    ]);
    expect(RETURN_MAX_LENGTH).toBe(0.6);
  });

  it("answers the same for the same camera, keeping nothing between calls", () => {
    const first = drawn(SALOON_PLANES, 15, -10);
    drawn(SALOON_PLANES, 0, 0);
    expect(drawn(SALOON_PLANES, 15, -10)).toEqual(first);
  });
});

describe("whether the ceiling is drawn", () => {
  it("is drawn from below and level with it, and not from above", () => {
    expect(SALOON_PLANES.ceiling).toBe(5.515);
    expect(ceilingShown(SALOON_PLANES, 1.6)).toBe(true);
    expect(ceilingShown(SALOON_PLANES, 5.515)).toBe(true);
    expect(ceilingShown(SALOON_PLANES, 5.516)).toBe(false);
    expect(ceilingShown(SALOON_PLANES, 12)).toBe(false);
  });
});

describe("packing the walls that are drawn", () => {
  const indices = Uint32Array.from([0, 1, 2, 10, 11, 12, 13, 14, 15, 20, 21, 22]);
  const runs = [{ indexStart: 0, indexCount: 3 }, { indexStart: 3, indexCount: 6 }, { indexStart: 9, indexCount: 3 }];

  it("writes the drawn walls' indices run after run, and says how many", () => {
    const target = new Uint32Array(12);
    expect(packShownWalls(indices, runs, [1, 0, 1], target)).toBe(6);
    expect([...target.subarray(0, 6)]).toEqual([0, 1, 2, 20, 21, 22]);
    expect(packShownWalls(indices, runs, [0, 1, 0], target)).toBe(6);
    expect([...target.subarray(0, 6)]).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("writes every wall when all are drawn and nothing when none is, leaving the walls as built untouched", () => {
    const target = new Uint32Array(12);
    expect(packShownWalls(indices, runs, [1, 1, 1], target)).toBe(12);
    expect([...target]).toEqual([...indices]);
    expect(packShownWalls(indices, runs, [0, 0, 0], target)).toBe(0);
    expect([...indices]).toEqual([0, 1, 2, 10, 11, 12, 13, 14, 15, 20, 21, 22]);
  });
});
