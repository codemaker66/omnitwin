// ---------------------------------------------------------------------------
// Which of a surveyed room's surfaces the camera's side lets it see
//
// Every face of a surveyed room looks into the room and only front faces are
// drawn, so a flat wall vanishes from behind by itself. Its relief does not:
// seen from outside and above, where the planner's cameras usually are, the
// tops of a cornice, the sides of a pier and the returns of a bay still face
// the camera and float as ribbons where the wall should be gone. So whole
// surfaces are taken away by the side the camera is on:
//
//   - A wall is drawn while the camera is on its plane or in front of it,
//     and not drawn once the camera is behind it. The plane is the wall's
//     outline segment, depth 0 of its relief, whatever stands proud of it.
//   - A short wall (a bay's return, RETURN_MAX_LENGTH or less) is also not
//     drawn while the camera is behind both of its neighbours' planes: it
//     faces along the walls that have gone and would stand alone as a strip.
//   - The ceiling is not drawn while the camera is above its height.
//
// The plain shell decides the same way (stores/visibility-store.ts): by the
// camera's signed distance from each wall's plane, the wall gone once the
// camera is at or past it. What does not carry over is its fade (these are
// opaque photographs in the scene pass, which has no blending to fade them
// with), its four walls named by compass side (a surveyed room has one plane
// a wall, as many as its outline has segments) and its Cut and Full modes (a
// surveyed wall has no body to show from behind).
//
// Edge cases, on purpose:
//
//   - A camera exactly on a plane sees that wall edge-on: its flat face has
//     no area either way and its relief's sides are seen truly, so it is
//     drawn. The rule keeps no state, so a still camera never flickers.
//   - A wall pops as the camera crosses its plane. That is where the wall is
//     edge-on and its face covers nothing on screen; what is left to pop is
//     its relief's profile.
//   - A camera behind a wall's plane but inside the room (an outline need not
//     be convex) loses nothing: every face of that wall is turned from it.
//   - A camera inside a recess deeper than the wall's plane (a window's
//     reveal) is behind that plane, and the wall goes. The planner's cameras
//     do not stand there.
//
// No renderer here: plain numbers in the room's own frame.
// ---------------------------------------------------------------------------

import type { RoomFrame } from "./room-frame.js";
import type { WallRun } from "./room-geometry.js";

/**
 * The longest wall, in metres, that is taken away with its neighbours: at
 * this width a wall standing alone to the ceiling reads as a strip, not as a
 * wall. The Saloon's bay returns are 0.18 m to 0.24 m.
 */
export const RETURN_MAX_LENGTH = 0.6;

/** One wall's plane, as the rule reads it. */
export interface WallPlane {
  /** The wall's unit normal into the room, (x, z). */
  readonly nx: number;
  readonly nz: number;
  /** The normal's dot product with any point of the wall's plane. */
  readonly offset: number;
  /** Whether it is short enough to go with its neighbours (RETURN_MAX_LENGTH). */
  readonly short: boolean;
}

export interface RoomPlanes {
  /** One per wall, in record order. */
  readonly walls: readonly WallPlane[];
  /** The ceiling's height: where its relief's depth is measured from, or a flat ceiling's own. */
  readonly ceiling: number;
}

/** The planes of a room's walls and ceiling, from its outline's frame. */
export function roomPlanes(frame: Pick<RoomFrame, "walls">, ceilingHeight: number): RoomPlanes {
  return {
    walls: frame.walls.map((wall): WallPlane => ({
      nx: wall.normal[0],
      nz: wall.normal[2],
      offset: wall.normal[0] * wall.origin[0] + wall.normal[2] * wall.origin[2],
      short: wall.length <= RETURN_MAX_LENGTH,
    })),
    ceiling: ceilingHeight,
  };
}

/** Whether a point (x, z) of the room's frame is on a wall's plane or on the room's side of it. */
function inFront(plane: WallPlane, x: number, z: number): boolean {
  return plane.nx * x + plane.nz * z - plane.offset >= 0;
}

/**
 * Marks each wall drawn (1) or not (0) for a camera at (x, z) in the room's
 * frame, into `shown`, which holds one flag a wall.
 */
export function wallsShown(planes: RoomPlanes, x: number, z: number, shown: Uint8Array): void {
  const { walls } = planes;
  const count = walls.length;
  for (let i = 0; i < count; i++) {
    const wall = walls[i];
    if (wall === undefined || !inFront(wall, x, z)) {
      shown[i] = 0;
      continue;
    }
    if (wall.short && count > 2) {
      // Gone by their own planes: a neighbour cannot have gone as a return itself, which would need this wall behind its own.
      const before = walls[(i + count - 1) % count];
      const after = walls[(i + 1) % count];
      if (before !== undefined && after !== undefined && !inFront(before, x, z) && !inFront(after, x, z)) {
        shown[i] = 0;
        continue;
      }
    }
    shown[i] = 1;
  }
}

/** Whether the ceiling is drawn for a camera at height `y`: from below it, or level with it. */
export function ceilingShown(planes: RoomPlanes, y: number): boolean {
  return y <= planes.ceiling;
}

/**
 * Writes the indices of the walls marked shown into `target`, run after run
 * in record order, and returns how many were written: drawn from its start
 * for that many indices, `target` draws exactly those walls. `indices` is
 * every wall's indices as built (room-geometry.ts) and is left as it is.
 */
export function packShownWalls(
  indices: Uint32Array, runs: readonly Pick<WallRun, "indexStart" | "indexCount">[], shown: ArrayLike<number>, target: Uint32Array,
): number {
  let written = 0;
  runs.forEach((run, wall) => {
    if (shown[wall] !== 1) return;
    target.set(indices.subarray(run.indexStart, run.indexStart + run.indexCount), written);
    written += run.indexCount;
  });
  return written;
}
