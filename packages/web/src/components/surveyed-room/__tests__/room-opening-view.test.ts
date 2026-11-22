import { readFileSync } from "node:fs";
import path from "node:path";
import type { SpaceDimensions } from "@omnitwin/types";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { scaleForRendering } from "../../../constants/scale.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../../data/room-geometries.js";
import { computeCameraTarget, computeDefaultCameraPosition, computeDistanceLimits } from "../../../lib/camera-rig.js";
import { buildRoomFrame } from "../room-frame.js";
import { buildRoomGeometry, surfaceBounds, type RoomGeometry, type SurfaceGeometry } from "../room-geometry.js";
import { OPENING_FRAME_MARGIN, OPENING_POSE_MIN_ASPECT, surveyedRoomOpeningPose, type RoomOpeningPose } from "../room-opening-view.js";
import { parseSurveyRecord } from "../survey-record.js";

const SALOON = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const FRAME = buildRoomFrame(SALOON.room.outline);
/** The Saloon as surveyed, 12.191 m by 7.473 m, its walls flat to 5.515 m. */
const ROOM: RoomGeometry = buildRoomGeometry(SALOON, FRAME, { walls: null, ceiling: null });
const FOV = 55;

/** The size the planner works from for a room, as PlannerScene's own hook reads it from the room's data. */
function plannerDimensions(name: string): SpaceDimensions {
  const geometry = resolveRoomGeometry({ name, heightM: "5.4", floorPlanOutline: [] });
  if (geometry === null) throw new Error(`the planner has no ${name}`);
  const bounds = computeBoundingBox(geometry.wallPolygon);
  return scaleForRendering({ width: bounds.width, length: bounds.depth, height: geometry.ceilingHeight });
}
const SALOON_DATA = plannerDimensions("Saloon");

/** The eight corners of the box that holds the surfaces given. */
function corners(...surfaces: readonly Pick<SurfaceGeometry, "positions">[]): Vector3[] {
  const { min, max } = surfaceBounds(...surfaces);
  return [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => new Vector3(x, y, z))));
}

/**
 * How far the furthest of `points` lies from the frame's centre, as shares of
 * its half-width and half-height, by three's own camera.
 */
function reach(pose: RoomOpeningPose, points: readonly Vector3[], aspect: number): { across: number; up: number } {
  const camera = new PerspectiveCamera(FOV, aspect, 0.1, 200);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateMatrixWorld(true);
  const seen = points.map((point) => point.clone().project(camera));
  // Every one in front of the camera: behind it, a point's place in the frame would mean nothing.
  for (const point of seen) expect(point.z).toBeLessThan(1);
  return { across: Math.max(...seen.map((point) => Math.abs(point.x))), up: Math.max(...seen.map((point) => Math.abs(point.y))) };
}

const distance = (pose: RoomOpeningPose): number => new Vector3(...pose.position).distanceTo(new Vector3(...pose.target));
const IN_FRAME = 1 - OPENING_FRAME_MARGIN;

describe("the planner's opening view of a surveyed room", () => {
  const plannersOwn: RoomOpeningPose = {
    position: computeDefaultCameraPosition(SALOON_DATA, OPENING_POSE_MIN_ASPECT),
    target: computeCameraTarget(SALOON_DATA, OPENING_POSE_MIN_ASPECT),
  };
  const pose = surveyedRoomOpeningPose(ROOM, SALOON_DATA, FOV);

  it("is not the planner's own, which runs the Saloon's walls off the frame and its floor's corners with them", () => {
    // The planner's Saloon is its hand-drawn outline's box, 13.1 m by 6.9 m under 5.4 m, and opens from 11.65 m.
    expect([SALOON_DATA.width, SALOON_DATA.length, SALOON_DATA.height].map((metres) => metres.toFixed(3))).toEqual(["13.100", "6.900", "5.400"]);
    expect(distance(plannersOwn)).toBeCloseTo(11.653, 3);
    // From there the surveyed room's walls reach twice the frame's half-height, and its floor's corners are outside it.
    expect(reach(plannersOwn, corners(ROOM.walls, ROOM.floor), 16 / 9).up).toBeCloseTo(2.085, 2);
    expect(reach(plannersOwn, corners(ROOM.floor), 16 / 9).up).toBeCloseTo(1.21, 2);
  });

  it("looks the planner's own way at the planner's own target, from further back", () => {
    expect(pose.target).toEqual(plannersOwn.target);
    const own = new Vector3(...plannersOwn.position).sub(new Vector3(...plannersOwn.target)).normalize();
    const mine = new Vector3(...pose.position).sub(new Vector3(...pose.target)).normalize();
    expect(mine.distanceTo(own)).toBeLessThan(1e-12);
    expect(distance(pose)).toBeCloseTo(19.366, 2);
  });

  it.each([
    ["the narrowest landscape screen the pose is used on", OPENING_POSE_MIN_ASPECT],
    ["a 3:2 laptop", 3 / 2],
    ["a 16:9 screen", 16 / 9],
    ["a 21:9 screen", 21 / 9],
  ])("holds the room as surveyed in frame, floor to wall tops, on %s", (_name, aspect) => {
    const { across, up } = reach(pose, corners(ROOM.walls, ROOM.floor), aspect);
    expect(across).toBeLessThanOrEqual(IN_FRAME + 1e-9);
    // Fitted, not merely far: the room comes to the margin on the axis that binds, here its height on the screen.
    expect(up).toBeCloseTo(IN_FRAME, 6);
  });

  it("stays within the camera's limit for the room, so the rig applies it as given", () => {
    expect(distance(pose)).toBeLessThanOrEqual(computeDistanceLimits(SALOON_DATA).maxDistance);
    // A room whose data is much smaller than its survey would need the camera past its limit: it is held at the limit.
    const small: SpaceDimensions = { width: 6, length: 4, height: 3 };
    const held = surveyedRoomOpeningPose(ROOM, small, FOV);
    expect(distance(held)).toBeCloseTo(computeDistanceLimits(small).maxDistance, 9);
    expect(reach(held, corners(ROOM.walls, ROOM.floor), 16 / 9).up).toBeGreaterThan(1);
  });

  it("is never nearer than the planner's own opening", () => {
    // A room whose data is far larger than its survey: the planner's own opening already holds it, and is kept.
    const large: SpaceDimensions = { width: 40, length: 30, height: 5.4 };
    const far = surveyedRoomOpeningPose(ROOM, large, FOV);
    expect(far.position).toEqual(computeDefaultCameraPosition(large, OPENING_POSE_MIN_ASPECT));
    expect(far.target).toEqual(computeCameraTarget(large, OPENING_POSE_MIN_ASPECT));
    expect(reach(far, corners(ROOM.walls, ROOM.floor), OPENING_POSE_MIN_ASPECT).up).toBeLessThan(IN_FRAME);
  });

  it("frames the walls as built, their relief included", () => {
    // The rear wall's relief standing 0.9 m behind its plane, as a window's recess does: further back again.
    const rear = SALOON.walls[6];
    if (rear === undefined) throw new Error("no rear wall");
    const recessed = buildRoomGeometry(SALOON, FRAME, {
      walls: new Map([[rear.reliefId, {
        id: rear.reliefId,
        positions: Float32Array.from([0, 0, -0.9, rear.length, 0, -0.9, rear.length, 5.515, -0.9, 0, 5.515, -0.9]),
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      }]]),
      ceiling: null,
    });
    expect(surfaceBounds(recessed.walls).min[0]).toBeCloseTo(-6.996, 5);
    const deeper = surveyedRoomOpeningPose(recessed, SALOON_DATA, FOV);
    expect(distance(deeper)).toBeGreaterThan(distance(pose));
    const { across, up } = reach(deeper, corners(recessed.walls, recessed.floor), OPENING_POSE_MIN_ASPECT);
    expect(Math.max(across, up)).toBeCloseTo(IN_FRAME, 6);
  });
});
