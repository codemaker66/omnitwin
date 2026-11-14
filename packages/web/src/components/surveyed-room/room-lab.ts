// ---------------------------------------------------------------------------
// The surveyed-room lab's query and camera poses
//
// /dev/surveyed-room (pages/SurveyedRoomLabPage.tsx, development builds only)
// shows one surveyed room from a public folder. What it is asked for, and
// where its camera stands, are worked out here without a renderer.
//
// Poses are made from the room's own outline, so they fit any room:
//
//   overview  outside and above a corner, looking in through the near walls
//   plan      straight down from above (the ceiling faces down, so it is
//             not in the way)
//   eye       standing inside near the +x end, looking along the room
//   ceiling   standing in the middle, looking straight up
//   floor     under the ceiling in the middle, looking straight down
//   a number  facing that wall (its index in the record) square on from
//             inside, which is how a wall's strip of the atlas is checked;
//             a wall's id does the same
// ---------------------------------------------------------------------------

import { pointOnWall, type RoomFrame, type Vec3 } from "./room-frame.js";
import type { SurveyedRoomEntry } from "./room-registry.js";

export interface RoomLabQuery {
  /** The room asked for, or null when the query does not name one. */
  readonly entry: SurveyedRoomEntry | null;
  /** Why the query names no room, in words for the page. */
  readonly problem: string | null;
  /** A photograph quality forced by `?photos=`, or null for the device's own. */
  readonly photoQuality: number | null;
}

/** A public folder on this origin: a path of plain segments, nothing that climbs or leaves. */
const PUBLIC_FOLDER = /^(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

/** Reads `?base=<public folder>&r=<revision>[&photos=full|half]`. */
export function parseRoomLabQuery(search: string): RoomLabQuery {
  const params = new URLSearchParams(search);
  const photos = params.get("photos");
  const photoQuality = photos === "half" ? 0.5 : photos === "full" ? 1 : null;
  const none = (problem: string): RoomLabQuery => ({ entry: null, problem, photoQuality });
  const asked = params.get("base");
  if (asked === null || asked === "") return none("Add ?base=<public folder>&r=<revision>, for example ?base=/rooms/saloon/survey-2026-07-11&r=1.");
  const base = asked.replace(/\/+$/, "");
  if (!PUBLIC_FOLDER.test(base)) return none(`"${asked}" is not a public folder: give a path on this site, such as /rooms/saloon/survey-2026-07-11.`);
  const r = params.get("r") ?? "1";
  const revision = Number(r);
  if (!/^[1-9][0-9]*$/.test(r) || !Number.isSafeInteger(revision)) return none(`"${r}" is not a revision: give a whole number from 1.`);
  return { entry: { base, revision }, problem: null, photoQuality };
}

export interface RoomPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical field of view, degrees. */
  readonly fov: number;
}

export const ROOM_POSE_NAMES = ["overview", "plan", "eye", "ceiling", "floor"] as const;
export type RoomPoseName = (typeof ROOM_POSE_NAMES)[number];

/** A person's eye height, metres. */
const EYE = 1.6;
/** Offsets a camera looking straight up or down from its target, so its heading is defined. */
const NUDGE = 0.01;

/** The named poses for a room of this outline and ceiling height. */
export function roomPoses(frame: Pick<RoomFrame, "bounds">, ceilingHeight: number): Readonly<Record<RoomPoseName, RoomPose>> {
  const { minX, maxX, minZ, maxZ } = frame.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const spanX = maxX - minX;
  const reach = Math.hypot(spanX, maxZ - minZ);
  return {
    overview: { position: [cx + reach * 0.55, ceilingHeight + reach * 0.6, cz + reach * 0.65], target: [cx, ceilingHeight * 0.3, cz], fov: 40 },
    plan: { position: [cx, ceilingHeight + reach * 1.2, cz + NUDGE], target: [cx, 0, cz], fov: 42 },
    eye: { position: [cx + spanX * 0.35, Math.min(EYE, ceilingHeight * 0.6), cz], target: [cx - spanX * 0.3, ceilingHeight * 0.45, cz], fov: 62 },
    ceiling: { position: [cx, Math.min(1.2, ceilingHeight * 0.3), cz + NUDGE], target: [cx, ceilingHeight, cz], fov: 70 },
    floor: { position: [cx, ceilingHeight * 0.8, cz + NUDGE], target: [cx, 0, cz], fov: 70 },
  };
}

/** Facing wall `index` square on from inside the room, or null for no such wall. */
export function wallPose(frame: Pick<RoomFrame, "walls">, index: number, ceilingHeight: number): RoomPose | null {
  const wall = frame.walls[index];
  if (wall === undefined) return null;
  // Far enough back to see a long wall's middle, near enough that a short return fills the view.
  const back = Math.min(4.5, Math.max(1.5, wall.length * 0.9));
  const [x, , z] = pointOnWall(wall, wall.length / 2, 0, back);
  const [tx, , tz] = pointOnWall(wall, wall.length / 2, 0);
  return { position: [x, Math.min(EYE, ceilingHeight * 0.6), z], target: [tx, ceilingHeight * 0.45, tz], fov: 62 };
}

/**
 * The pose asked for: one of ROOM_POSE_NAMES, a wall's index (a number, or
 * digits) or a wall's id. Null when it is none of them.
 */
export function resolveRoomPose(
  frame: Pick<RoomFrame, "bounds" | "walls">, ceilingHeight: number, wallIds: readonly string[], asked: string | number,
): RoomPose | null {
  if (typeof asked === "number") return Number.isInteger(asked) ? wallPose(frame, asked, ceilingHeight) : null;
  const named = ROOM_POSE_NAMES.find((name) => name === asked);
  if (named !== undefined) return roomPoses(frame, ceilingHeight)[named];
  if (/^[0-9]+$/.test(asked)) return wallPose(frame, Number(asked), ceilingHeight);
  const byId = wallIds.indexOf(asked);
  return byId === -1 ? null : wallPose(frame, byId, ceilingHeight);
}
