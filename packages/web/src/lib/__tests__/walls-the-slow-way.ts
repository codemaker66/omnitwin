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

// ---------------------------------------------------------------------------
// A unit of furniture (a table with its chairs, a set, a lone piece) measured
// to the walls one wall at a time, for tests of the gangway review. Still
// nothing of the planner's: the pieces come in as plain shapes, and a wall is
// walked a millimetre at a time.
// ---------------------------------------------------------------------------

/** A straight wall, end to end: [ax, az, bx, bz]. */
export type Wall = readonly [number, number, number, number];

/**
 * A piece's shape on the floor: a disc, or a box turned about its centre. The
 * turn is about the upright axis, the way the scene turns a piece: the box's
 * own (lx, lz) stands at (lx cos + lz sin, −lx sin + lz cos) from its centre.
 */
export type Shape =
  | { readonly kind: "disc"; readonly x: number; readonly z: number; readonly radius: number }
  | { readonly kind: "box"; readonly x: number; readonly z: number; readonly halfW: number; readonly halfD: number; readonly turn: number };

/** A room's walls, with stretches that join end to end and run the same way taken as one wall. */
export function straightWalls(walls: Walls): readonly Wall[] {
  const all: Wall[] = wallsOf(walls).filter(([ax, az, bx, bz]) => ax !== bx || az !== bz);
  let joinedOne = true;
  while (joinedOne && all.length > 1) {
    joinedOne = false;
    for (let i = 0; i < all.length; i += 1) {
      const next = (i + 1) % all.length;
      const first = all[i];
      const second = all[next];
      if (first === undefined || second === undefined) continue;
      const [ax, az, bx, bz] = first;
      const [cx, cz, dx, dz] = second;
      const meet = Math.hypot(bx - cx, bz - cz) < 1e-9;
      const turn = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      const onward = (bx - ax) * (dx - cx) + (bz - az) * (dz - cz);
      if (!meet || Math.abs(turn) > 1e-9 || onward <= 0) continue;
      all[i] = [ax, az, dx, dz];
      all.splice(next, 1);
      joinedOne = true;
      break;
    }
  }
  return all;
}

/** The point of a shape nearest a point, and how far off it is: nought with the point inside the shape. */
export function nearestOnShape(shape: Shape, px: number, pz: number): { readonly x: number; readonly z: number; readonly gap: number } {
  if (shape.kind === "disc") {
    const off = Math.hypot(px - shape.x, pz - shape.z);
    if (off <= shape.radius) return { x: px, z: pz, gap: 0 };
    return { x: shape.x + ((px - shape.x) * shape.radius) / off, z: shape.z + ((pz - shape.z) * shape.radius) / off, gap: off - shape.radius };
  }
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  // The point in the box's own frame, held to the box, then stood back in the room.
  const lx = (px - shape.x) * cos - (pz - shape.z) * sin;
  const lz = (px - shape.x) * sin + (pz - shape.z) * cos;
  const hx = Math.min(shape.halfW, Math.max(-shape.halfW, lx));
  const hz = Math.min(shape.halfD, Math.max(-shape.halfD, lz));
  return { x: shape.x + hx * cos + hz * sin, z: shape.z - hx * sin + hz * cos, gap: Math.hypot(lx - hx, lz - hz) };
}

/** How far a unit, any of its pieces, stands from a point. */
export function unitToPoint(pieces: readonly Shape[], px: number, pz: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const piece of pieces) nearest = Math.min(nearest, nearestOnShape(piece, px, pz).gap);
  return nearest;
}

/** Where a unit comes nearest one wall: the gap, the place on the wall, and the place on the unit. */
export interface NearestOnWall {
  readonly gap: number;
  readonly x: number;
  readonly z: number;
  readonly pieceX: number;
  readonly pieceZ: number;
}

/**
 * How far a unit, any of its pieces, stands from one wall: the wall walked a
 * millimetre at a time, every piece measured from each step. The first of
 * equal steps is kept, so the place is the earliest along the wall.
 */
export function unitToWallEveryStep(pieces: readonly Shape[], wall: Wall): NearestOnWall {
  const [ax, az, bx, bz] = wall;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.001));
  let best: NearestOnWall = { gap: Number.POSITIVE_INFINITY, x: ax, z: az, pieceX: ax, pieceZ: az };
  for (let s = 0; s <= steps; s += 1) {
    const x = ax + ((bx - ax) * s) / steps;
    const z = az + ((bz - az) * s) / steps;
    for (const piece of pieces) {
      const near = nearestOnShape(piece, x, z);
      if (near.gap < best.gap) best = { gap: near.gap, x, z, pieceX: near.x, pieceZ: near.z };
    }
  }
  return best;
}

/**
 * The same answer as unitToWallEveryStep, sooner, for a sweep of many units:
 * the same millimetre steps, but first only every tenth. A step's gap differs
 * from its neighbour's by no more than the millimetre between them, so the
 * nearest step of all is within a centimetre of a tenth step whose gap is
 * within a centimetre of the nearest tenth step's: only those stretches are
 * walked whole. The slow way's own test holds the two to the same answers.
 */
export function unitToWall(pieces: readonly Shape[], wall: Wall): NearestOnWall {
  const [ax, az, bx, bz] = wall;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.001));
  const gapAt = (s: number): number => unitToPoint(pieces, ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
  const tenths: { readonly s: number; readonly gap: number }[] = [];
  for (let s = 0; s <= steps; s += 10) tenths.push({ s, gap: gapAt(s) });
  if (steps % 10 !== 0) tenths.push({ s: steps, gap: gapAt(steps) });
  const nearestTenth = Math.min(...tenths.map((tenth) => tenth.gap));
  const walked = new Set<number>();
  for (const tenth of tenths) {
    if (tenth.gap > nearestTenth + 0.0101) continue;
    for (let s = Math.max(0, tenth.s - 10); s <= Math.min(steps, tenth.s + 10); s += 1) walked.add(s);
  }
  let best: NearestOnWall = { gap: Number.POSITIVE_INFINITY, x: ax, z: az, pieceX: ax, pieceZ: az };
  for (const s of [...walked].sort((a, b) => a - b)) {
    const x = ax + ((bx - ax) * s) / steps;
    const z = az + ((bz - az) * s) / steps;
    for (const piece of pieces) {
      const near = nearestOnShape(piece, x, z);
      if (near.gap < best.gap) best = { gap: near.gap, x, z, pieceX: near.x, pieceZ: near.z };
    }
  }
  return best;
}

/** How far a point is from a straight stretch between two points. */
function pointToStretch(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const lengthSquared = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
  const along = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / lengthSquared));
  return Math.hypot(px - (ax + along * (bx - ax)), pz - (az + along * (bz - az)));
}

/** How much of a wall the edges of an outline lie along, metres: an edge counts where both its ends are on the wall's line. */
export function lengthAlongWall(outline: Walls, wall: Wall): number {
  const [ax, az, bx, bz] = wall;
  const length = Math.hypot(bx - ax, bz - az);
  if (length === 0) return 0;
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  let total = 0;
  for (const [px, pz, qx, qz] of wallsOf(outline)) {
    const offP = Math.abs((px - ax) * uz - (pz - az) * ux);
    const offQ = Math.abs((qx - ax) * uz - (qz - az) * ux);
    if (offP > 1e-6 || offQ > 1e-6) continue;
    const alongP = (px - ax) * ux + (pz - az) * uz;
    const alongQ = (qx - ax) * ux + (qz - az) * uz;
    total += Math.max(0, Math.min(Math.max(alongP, alongQ), length) - Math.max(Math.min(alongP, alongQ), 0));
  }
  return total;
}

/** Whether a point is inside an outline or within `slack` of its edge. */
export function onOrInside(outline: Walls, x: number, z: number, slack: number): boolean {
  if (insideWalls(outline, x, z)) return true;
  return wallsOf(outline).some(([ax, az, bx, bz]) => pointToStretch(x, z, ax, az, bx, bz) <= slack);
}

/** The floor an outline encloses, square metres. */
export function areaOf(outline: Walls): number {
  let twice = 0;
  for (const [ax, az, bx, bz] of wallsOf(outline)) twice += ax * bz - bx * az;
  return Math.abs(twice) / 2;
}
