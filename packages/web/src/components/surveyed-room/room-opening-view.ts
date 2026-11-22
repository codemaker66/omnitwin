// ---------------------------------------------------------------------------
// The planner's opening view of a surveyed room
//
// The planner opens every room on one composition (lib/camera-rig.ts): high
// over the room and a little off its centre, looking down at a point just
// above the floor, from a height worked out from the room's data. There the
// camera stands above a surveyed room and inside its outline, so it is in
// front of every wall and all of them are drawn, to their full height,
// splayed outwards by the perspective. From the planner's own height the
// Saloon's walls ran off every edge of the frame, and the corners of its
// floor with them (seen 15 November 2026). Its data is not what made it
// tight: the planner's Saloon is 13.1 m by 6.9 m, longer than the surveyed
// one, and its own opening does not hold that floor's corners either.
//
// So a surveyed room opens on the same composition from further back: the
// planner's own direction and target for the room's data, and the camera
// moved out along that line until the room as surveyed is in frame, from its
// floor to its walls' tops. Never nearer than the planner's own opening, and
// never further than the camera's own limit for the room, which is as far as
// a hand can zoom out.
//
// CameraRig takes a room's own opening pose on landscape screens only
// (`defaultPose`, as the Grand Hall's), so the frame is fitted at the
// narrowest of those and a wider screen only has more to either side. A
// portrait screen keeps the planner's interior angle. Nothing here is read by
// a room drawn any other way.
//
// Plain numbers in the planner's frame; no renderer.
// ---------------------------------------------------------------------------

import type { SpaceDimensions } from "@omnitwin/types";
import { computeCameraTarget, computeDefaultCameraPosition, computeDistanceLimits } from "../../lib/camera-rig.js";
import type { Vec3 } from "./room-frame.js";
import { surfaceBounds, type RoomGeometry } from "./room-geometry.js";

/** The narrowest screen CameraRig gives a room its own opening pose on (width over height). */
export const OPENING_POSE_MIN_ASPECT = 1.2;
/** How much of the frame's half-width and half-height is kept clear around the room. */
export const OPENING_FRAME_MARGIN = 0.05;

/** A camera pose, as CameraRig's `defaultPose` takes one. */
export interface RoomOpeningPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by];

/**
 * The opening pose for a surveyed room: the planner's own for `dimensions`
 * (the room's data), from as far back along its line of sight as puts the
 * room's drawn walls and floor in frame for a camera of `fovDeg` (vertical).
 * The ceiling is left out: it is not drawn from above (room-visibility.ts).
 */
export function surveyedRoomOpeningPose(room: Pick<RoomGeometry, "walls" | "floor">, dimensions: SpaceDimensions, fovDeg: number): RoomOpeningPose {
  const target = computeCameraTarget(dimensions, OPENING_POSE_MIN_ASPECT);
  const own = computeDefaultCameraPosition(dimensions, OPENING_POSE_MIN_ASPECT);
  const back = sub(own, target);
  const ownDistance = Math.hypot(...back);
  const plannersOwn: RoomOpeningPose = { position: own, target };
  if (!(ownDistance > 0)) return plannersOwn;
  const forward = scale(back, -1 / ownDistance);
  // A line of sight straight down has no side to call right; the planner's own never is, for a room with a size.
  const sideways = cross(forward, [0, 1, 0]);
  const sidewaysLength = Math.hypot(...sideways);
  if (!(sidewaysLength > 1e-9)) return plannersOwn;
  const right = scale(sideways, 1 / sidewaysLength);
  const up = cross(right, forward);

  const tanV = Math.tan((fovDeg * Math.PI) / 360) * (1 - OPENING_FRAME_MARGIN);
  const tanH = tanV * OPENING_POSE_MIN_ASPECT;
  const { min, max } = surfaceBounds(room.walls, room.floor);
  // With the camera `d` back from the target, a point `depth` beyond the target along the line of
  // sight is `depth + d` from the camera, and is in frame while its offsets across and up are within
  // that distance times the frame's half-angles' tangents.
  let needed = ownDistance;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const fromTarget = sub([x, y, z], target);
        const depth = dot(fromTarget, forward);
        needed = Math.max(needed, Math.abs(dot(fromTarget, right)) / tanH - depth, Math.abs(dot(fromTarget, up)) / tanV - depth);
      }
    }
  }
  // As far as the camera may go for this room (CameraRig holds it there), and never nearer than the planner's own.
  const distance = Math.min(needed, computeDistanceLimits(dimensions).maxDistance);
  if (!(distance > ownDistance) || !Number.isFinite(distance)) return plannersOwn;
  const offset = scale(forward, -distance);
  return { position: [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]], target };
}
