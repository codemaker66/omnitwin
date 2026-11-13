import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRoomFrame, type PlanPoint } from "../room-frame.js";
import { parseRoomLabQuery, resolveRoomPose, ROOM_POSE_NAMES, roomPoses, wallPose } from "../room-lab.js";
import { parseSurveyRecord } from "../survey-record.js";

const SALOON = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const FRAME = buildRoomFrame(SALOON.room.outline);
const HEIGHT = SALOON.room.ceilingHeight;
const IDS = SALOON.walls.map((wall) => wall.id);

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

describe("the surveyed-room lab's query", () => {
  it("reads the survey's folder and revision", () => {
    expect(parseRoomLabQuery("?base=/rooms/saloon/survey-2026-07-11&r=3")).toEqual({
      entry: { base: "/rooms/saloon/survey-2026-07-11", revision: 3 }, problem: null, photoQuality: null,
    });
    // Revision 1 when left out; a trailing slash is not part of the folder.
    expect(parseRoomLabQuery("?base=/rooms/saloon/survey-2026-07-11/").entry).toEqual({ base: "/rooms/saloon/survey-2026-07-11", revision: 1 });
  });

  it("takes a photograph size when asked for one", () => {
    expect(parseRoomLabQuery("?base=/rooms/a&photos=half").photoQuality).toBe(0.5);
    expect(parseRoomLabQuery("?base=/rooms/a&photos=full").photoQuality).toBe(1);
    expect(parseRoomLabQuery("?base=/rooms/a&photos=huge").photoQuality).toBeNull();
  });

  it("says how to ask when no folder is given", () => {
    const query = parseRoomLabQuery("");
    expect(query.entry).toBeNull();
    expect(query.problem).toMatch(/^Add \?base=<public folder>&r=<revision>/);
  });

  it.each([
    "https://example.com/rooms/saloon",
    "//example.com/rooms/saloon",
    "rooms/saloon",
    "/rooms/../secrets",
    "/rooms/saloon?x=1",
    "/rooms/sal oon",
    "/",
  ])("refuses %s as a folder: only a plain path on this site", (base) => {
    const query = parseRoomLabQuery(`?base=${encodeURIComponent(base)}`);
    expect(query.entry).toBeNull();
    expect(query.problem).toMatch(/is not a public folder/);
  });

  it.each(["0", "-1", "1.5", "two", "1e3", ""])("refuses %s as a revision", (r) => {
    const query = parseRoomLabQuery(`?base=/rooms/saloon&r=${r}`);
    expect(query.entry).toBeNull();
    expect(query.problem).toMatch(/is not a revision/);
  });
});

describe("the surveyed-room lab's poses", () => {
  const poses = roomPoses(FRAME, HEIGHT);
  const { minX, maxX, minZ, maxZ } = FRAME.bounds;

  it("stands the overview and the plan outside the room and the walk poses inside it", () => {
    expect(Object.keys(poses)).toEqual([...ROOM_POSE_NAMES]);
    expect(inside(SALOON.room.outline, poses.overview.position[0], poses.overview.position[2])).toBe(false);
    expect(poses.overview.position[1]).toBeGreaterThan(HEIGHT);
    expect(poses.plan.position[1]).toBeGreaterThan(HEIGHT);
    for (const name of ["eye", "ceiling", "floor"] as const) {
      const [x, y, z] = poses[name].position;
      expect(inside(SALOON.room.outline, x, z), name).toBe(true);
      expect(y, name).toBeGreaterThan(0);
      expect(y, name).toBeLessThan(HEIGHT);
    }
    // Every pose looks at a point inside the room's box.
    for (const name of ROOM_POSE_NAMES) {
      const [x, y, z] = poses[name].target;
      expect(x).toBeGreaterThanOrEqual(minX);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(z).toBeGreaterThanOrEqual(minZ);
      expect(z).toBeLessThanOrEqual(maxZ);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT);
    }
    // Looking straight up or down, the camera is a hair off its target so its heading is defined.
    expect(poses.plan.position[2]).not.toBe(poses.plan.target[2]);
    expect(poses.ceiling.target[1]).toBe(HEIGHT);
    expect(poses.floor.target[1]).toBe(0);
  });

  it("faces each wall square on from the room's side of it", () => {
    FRAME.walls.forEach((wall, index) => {
      const pose = wallPose(FRAME, index, HEIGHT);
      if (pose === null) throw new Error("no pose");
      const toWall = [pose.target[0] - pose.position[0], pose.target[2] - pose.position[2]] as const;
      const distance = Math.hypot(...toWall);
      // Along the wall's normal, looking against it, between 1.5 m and 4.5 m back.
      expect((toWall[0] * wall.normal[0] + toWall[1] * wall.normal[2]) / distance, wall.index.toString()).toBeCloseTo(-1, 9);
      expect(distance).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(distance).toBeLessThanOrEqual(4.5 + 1e-9);
      // It looks at the middle of the wall.
      expect(Math.hypot(pose.target[0] - (wall.start[0] + wall.end[0]) / 2, pose.target[2] - (wall.start[1] + wall.end[1]) / 2)).toBeCloseTo(0, 9);
    });
    expect(wallPose(FRAME, 12, HEIGHT)).toBeNull();
    expect(wallPose(FRAME, -1, HEIGHT)).toBeNull();
  });

  it("resolves a name, a wall's index as a number or as digits, or a wall's id", () => {
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, "plan")).toEqual(poses.plan);
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, 3)).toEqual(wallPose(FRAME, 3, HEIGHT));
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, "3")).toEqual(wallPose(FRAME, 3, HEIGHT));
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, "fireplace")).toEqual(wallPose(FRAME, 9, HEIGHT));
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, "nowhere")).toBeNull();
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, 40)).toBeNull();
    expect(resolveRoomPose(FRAME, HEIGHT, IDS, 2.5)).toBeNull();
  });
});
