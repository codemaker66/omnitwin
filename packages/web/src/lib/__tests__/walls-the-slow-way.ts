// ---------------------------------------------------------------------------
// A room's walls, judged the slow way, for tests of where furniture may stand.
//
// Nothing here is the planner's: no import from lib/room-floor, and not the
// point-in-polygon test of data/room-geometries that the planner itself
// asks. A test that judged the planner by the planner's own geometry would
// agree with it whatever it did (review of audit editor-save-4, minor 10).
// Slow and plain on purpose: a winding count, walls walked a millimetre at a
// time, a footprint's edge walked a centimetre at a time.
// ---------------------------------------------------------------------------

/** A room's walls, [x, z] corner by corner. */
export type Walls = readonly (readonly [number, number])[];

/** Each wall as its two ends. */
function wallsOf(walls: Walls): readonly (readonly [number, number, number, number])[] {
  return walls.map(([ax, az], i) => {
    const [bx, bz] = walls[(i + 1) % walls.length] ?? [ax, az];
    return [ax, az, bx, bz] as const;
  });
}

/**
 * Whether a point is inside the walls: they wind round it. Counted wall by
 * wall, +1 for a wall crossing the point's level upward with the point on its
 * left, −1 for one crossing it downward with the point on its right; a point
 * outside comes to nought.
 */
export function insideWalls(walls: Walls, x: number, z: number): boolean {
  let winding = 0;
  for (const [ax, az, bx, bz] of wallsOf(walls)) {
    const side = (bx - ax) * (z - az) - (x - ax) * (bz - az);
    if (az <= z) {
      if (bz > z && side > 0) winding += 1;
    } else if (bz <= z && side < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * Whether a footprint stands wholly inside the walls: its centre is inside,
 * every centimetre of its edge is inside, and no corner of a wall pokes into
 * it. `slack` shrinks the footprint (metres), so a piece set exactly against
 * a wall is not judged on the last bit of a sum.
 */
export function footprintInsideWalls(walls: Walls, x: number, z: number, halfW: number, halfD: number, slack: number): boolean {
  const hw = halfW - slack;
  const hd = halfD - slack;
  if (!insideWalls(walls, x, z)) return false;
  if (walls.some(([wx, wz]) => Math.abs(wx - x) < hw && Math.abs(wz - z) < hd)) return false;
  const n = Math.max(2, Math.ceil((2 * Math.max(hw, hd)) / 0.01));
  for (let i = 0; i <= n; i += 1) {
    const dx = -hw + (2 * hw * i) / n;
    const dz = -hd + (2 * hd * i) / n;
    if (!insideWalls(walls, x + dx, z - hd) || !insideWalls(walls, x + dx, z + hd)) return false;
    if (!insideWalls(walls, x - hw, z + dz) || !insideWalls(walls, x + hw, z + dz)) return false;
  }
  return true;
}

/** How far a disc's rim stands from the nearest wall: every wall walked a millimetre at a time. Negative through a wall. */
export function rimToNearestWall(walls: Walls, x: number, z: number, radius: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [ax, az, bx, bz] of wallsOf(walls)) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.001));
    for (let s = 0; s <= steps; s += 1) {
      nearest = Math.min(nearest, Math.hypot(ax + ((bx - ax) * s) / steps - x, az + ((bz - az) * s) / steps - z));
    }
  }
  return nearest - radius;
}
