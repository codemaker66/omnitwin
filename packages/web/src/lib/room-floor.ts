import type { SpaceDimensions } from "@omnitwin/types";
import { scaleForRendering, toRenderSpace } from "../constants/scale.js";
import { computeBoundingBox, isPointInPolygon } from "../data/room-geometries.js";

// ---------------------------------------------------------------------------
// A room's floor: where furniture may stand.
//
// The planner knew a room as its width and length, and took its walls to be
// the rectangle of that size centred on the origin. That is the Grand Hall.
// It is not the Robert Adam Room, whose walls run from z = −3.7 to z = +9.0
// with a lower section half the width, nor the Reception Room, which steps
// in, nor the Saloon with its alcoves (data/room-geometries): there the
// rectangle let furniture through walls and refused it on real floor (audit
// editor-save-4).
//
// This keeps furniture inside the walls the planner draws. It does not show
// that a layout in these rooms then saves. The API refuses a save (422
// PLACEMENT_OUT_OF_BOUNDS, packages/api/src/lib/placement-validation.ts) when
// any piece's centre is outside the space's STORED outline, and the stored
// outlines are not these walls: as read from production's public rooms
// endpoint on 11 November 2026 each is a plain rectangle centred on the
// origin (Grand Hall 21 m by 10 m, Saloon 12 by 7, Reception Room 13.4 by
// 11.2, Robert Adam Room 9.7 by 5.6), as the seed writes them
// (packages/api/src/db/seed.ts rectOutline). So a layout that uses a shaped
// room's real floor is still refused, until the stored outlines are
// reconciled with the drawn rooms: a change of data, and the owner's.
//
// So a room whose walls are NOT that centred rectangle carries its floor, the
// wall polygon where the room is drawn, beside its dimensions, and whatever
// decides where a piece may stand asks the floor. A room whose walls ARE the
// centred rectangle carries none and is judged by the rectangle's own
// arithmetic, unchanged to the last bit.
//
// Render space, as the room store holds its dimensions.
// ---------------------------------------------------------------------------

/** A straight stretch of wall from a to b, with the unit normal pointing into the room. */
export interface FloorEdge {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly nx: number;
  readonly nz: number;
}

/** A wall that runs along an axis, so a piece can stand flush against it. */
export interface FloorWall {
  /** "x": the wall stands at one x and runs along z. "z": at one z, along x. */
  readonly axis: "x" | "z";
  readonly at: number;
  /** The stretch it runs, along the other axis. */
  readonly from: number;
  readonly to: number;
  /** 1 with the room on the greater side of `at`, −1 with it on the lesser. */
  readonly roomSide: 1 | -1;
}

export interface RoomFloor {
  /** The walls, [x, z] corner by corner. */
  readonly outline: readonly (readonly [number, number])[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly edges: readonly FloorEdge[];
  readonly walls: readonly FloorWall[];
}

/**
 * A room as the planner's room store holds it: its render dimensions and,
 * when its walls are not the rectangle of that size centred on the origin,
 * its floor. With no floor, the walls are that rectangle.
 */
export interface PlannerRoomDimensions extends SpaceDimensions {
  readonly floor?: RoomFloor;
}

/**
 * How near a wall counts as against it: a thousandth of a millimetre. A piece
 * set exactly against a wall is inside the room, whatever the last bit of a
 * sum says.
 */
const FLUSH = 1e-6;

/** Under this, a wall's direction has no part along an axis. */
const STRAIGHT = 1e-9;

/** The floor of an outline, render space. Fewer than three corners enclose nothing. */
export function floorOfOutline(outline: readonly (readonly [number, number])[]): RoomFloor | undefined {
  if (outline.length < 3) return undefined;
  let twiceArea = 0;
  outline.forEach(([x, z], i) => {
    const [nextX, nextZ] = outline[(i + 1) % outline.length] ?? [x, z];
    twiceArea += x * nextZ - nextX * z;
  });
  if (twiceArea === 0) return undefined;
  // Counter-clockwise (x across, z up) has the room on each wall's left.
  const turn = twiceArea > 0 ? 1 : -1;
  const edges: FloorEdge[] = [];
  const walls: FloorWall[] = [];
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length] ?? [ax, az];
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length === 0) return;
    const nx = (turn * -dz) / length;
    const nz = (turn * dx) / length;
    edges.push({ ax, az, bx, bz, nx, nz });
    if (Math.abs(dx) <= STRAIGHT) walls.push({ axis: "x", at: ax, from: Math.min(az, bz), to: Math.max(az, bz), roomSide: nx > 0 ? 1 : -1 });
    else if (Math.abs(dz) <= STRAIGHT) walls.push({ axis: "z", at: az, from: Math.min(ax, bx), to: Math.max(ax, bx), roomSide: nz > 0 ? 1 : -1 });
  });
  const box = computeBoundingBox(outline);
  return { outline, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ, edges, walls };
}

/** Whether an outline is the four corners of a rectangle centred on the origin: the room the dimensions alone describe. */
function isCentredRectangle(outline: readonly (readonly [number, number])[]): boolean {
  if (outline.length !== 4) return false;
  const { minX, maxX, minZ, maxZ } = computeBoundingBox(outline);
  if (Math.abs(minX + maxX) > STRAIGHT || Math.abs(minZ + maxZ) > STRAIGHT) return false;
  const corners = new Set<string>();
  for (const [x, z] of outline) {
    if ((x !== minX && x !== maxX) || (z !== minZ && z !== maxZ)) return false;
    corners.add(`${x === minX ? "min" : "max"},${z === minZ ? "min" : "max"}`);
  }
  return corners.size === 4;
}

const floors = new WeakMap<readonly (readonly [number, number])[], RoomFloor | undefined>();

/**
 * The floor a room's wall polygon (metres) asks the planner to keep, or
 * undefined when the polygon is the rectangle centred on the origin, which
 * the room's dimensions already say. One floor per polygon, so a room opened
 * twice hands the room store the same one.
 */
export function roomFloorOf(wallPolygon: readonly (readonly [number, number])[]): RoomFloor | undefined {
  if (floors.has(wallPolygon)) return floors.get(wallPolygon);
  const floor = isCentredRectangle(wallPolygon)
    ? undefined
    : floorOfOutline(wallPolygon.map(([x, z]) => [toRenderSpace(x), toRenderSpace(z)] as const));
  floors.set(wallPolygon, floor);
  return floor;
}

/**
 * The planner's room for a wall polygon (metres) and ceiling height: the
 * render dimensions of its bounds, and its floor where the walls are not the
 * centred rectangle of that size.
 */
export function plannerRoomOf(wallPolygon: readonly (readonly [number, number])[], ceilingHeight: number): PlannerRoomDimensions {
  const box = computeBoundingBox(wallPolygon);
  const dimensions = scaleForRendering({ width: box.width, length: box.depth, height: ceilingHeight });
  const floor = roomFloorOf(wallPolygon);
  return floor === undefined ? dimensions : { ...dimensions, floor };
}

/** The middle of a floor's bounds: where a layout planned across those bounds is centred. */
export function floorCentre(floor: RoomFloor): { readonly x: number; readonly z: number } {
  return { x: (floor.minX + floor.maxX) / 2, z: (floor.minZ + floor.maxZ) / 2 };
}

/** Whether a wall passes through the box x0..x1 × z0..z1 (Liang–Barsky). */
function edgeCrossesBox(edge: FloorEdge, x0: number, x1: number, z0: number, z1: number): boolean {
  let enter = 0;
  let leave = 1;
  const clips: readonly (readonly [number, number])[] = [
    [edge.ax - edge.bx, edge.ax - x0],
    [edge.bx - edge.ax, x1 - edge.ax],
    [edge.az - edge.bz, edge.az - z0],
    [edge.bz - edge.az, z1 - edge.az],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
  }
  return enter <= leave;
}

/** Whether a wall passes through the inside of a footprint, not merely along its edge. */
function edgeThroughFootprint(edge: FloorEdge, x: number, z: number, halfW: number, halfD: number): boolean {
  const inX = Math.max(0, halfW - FLUSH);
  const inZ = Math.max(0, halfD - FLUSH);
  return edgeCrossesBox(edge, x - inX, x + inX, z - inZ, z + inZ);
}

/**
 * Whether the footprint centred at (x, z) with half-extents halfW × halfD
 * stands wholly on the floor: no wall passes through it and its centre is
 * inside the walls. Flush against a wall is inside.
 */
export function rectWithinFloor(floor: RoomFloor, x: number, z: number, halfW: number, halfD: number): boolean {
  if (x - halfW < floor.minX - FLUSH || x + halfW > floor.maxX + FLUSH) return false;
  if (z - halfD < floor.minZ - FLUSH || z + halfD > floor.maxZ + FLUSH) return false;
  for (const edge of floor.edges) {
    if (edgeThroughFootprint(edge, x, z, halfW, halfD)) return false;
  }
  return isPointInPolygon(x, z, floor.outline);
}

/** How far a point is from the nearest wall, inside the room or out. */
export function distanceToWalls(floor: RoomFloor, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const { ax, az, bx, bz } of floor.edges) {
    const dx = bx - ax;
    const dz = bz - az;
    const along = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - (ax + along * dx), z - (az + along * dz)));
  }
  return nearest;
}

/** Whether a disc stands wholly on the floor: its centre inside the walls and no wall nearer than its radius. */
export function discWithinFloor(floor: RoomFloor, x: number, z: number, radius: number): boolean {
  return isPointInPolygon(x, z, floor.outline) && distanceToWalls(floor, x, z) >= radius - FLUSH;
}

/**
 * The clearance, in metres, a laid-out group keeps from the walls at an
 * inner corner of a room's drawn floor; everywhere else it keeps the
 * layout's full band (lib/auto-fill BANQUET_CHAIR_CLEARANCE_M, 0.6 m).
 * Blake's decision, 26 November 2026: chairs may come within 15 cm of a pier
 * or step corner; 60 cm along every run of wall.
 *
 * Which vertices: an inner corner is a vertex of the drawn floor where the
 * wall turns back into the room by 45 degrees or more, an interior angle of
 * 225 degrees or more (innerCornersOf): the corner of a pier, a step, an
 * alcove's mouth or a recess. The vertices that trace a drawn curve turn by
 * less (the Robert Adam Room's curved wall by 9 to 28 degrees at each), and
 * a curve is a run of wall, so it keeps the full band.
 *
 * How far: this clearance holds for every point of the walls within one
 * band's width of an inner corner, measured straight from the corner; every
 * other point of every wall keeps the full band (bandedWalls). A ring this
 * near a corner is nearer than the band to every wall point within the band
 * less this clearance of it, so the stretch can be no shorter than that; one
 * band's width serves any clearance up to the band and lets the planner's
 * round reach this clearance across the corner.
 *
 * Set to the band itself, every wall keeps the band, as before this rule.
 */
export const INNER_CORNER_CLEARANCE_M = 0.15;

/** The least turn back into the room that makes a vertex an inner corner. */
const INNER_CORNER_TURN_RAD = Math.PI / 4;

/** The inner corners of a floor, render space: the vertices where its wall turns back into the room by 45 degrees or more. */
export function innerCornersOf(floor: RoomFloor): readonly (readonly [number, number])[] {
  const { outline } = floor;
  let twiceArea = 0;
  outline.forEach(([x, z], i) => {
    const [nextX, nextZ] = outline[(i + 1) % outline.length] ?? [x, z];
    twiceArea += x * nextZ - nextX * z;
  });
  // Counter-clockwise keeps the room on each wall's left; a turn to the right there turns back into the room.
  const turn = twiceArea > 0 ? 1 : -1;
  const corners: (readonly [number, number])[] = [];
  outline.forEach((corner, i) => {
    const before = outline[(i - 1 + outline.length) % outline.length] ?? corner;
    const after = outline[(i + 1) % outline.length] ?? corner;
    const inX = corner[0] - before[0];
    const inZ = corner[1] - before[1];
    const outX = after[0] - corner[0];
    const outZ = after[1] - corner[1];
    const cross = inX * outZ - inZ * outX;
    const angle = Math.atan2(Math.abs(cross), inX * outX + inZ * outZ);
    if (cross * turn < 0 && angle >= INNER_CORNER_TURN_RAD - STRAIGHT) corners.push(corner);
  });
  return corners;
}

/** A stretch of wall, render space, and the clearance a laid-out group keeps from it. */
export interface BandedWall {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly clearance: number;
}

const bandedWallCache = new WeakMap<RoomFloor, Map<string, readonly BandedWall[]>>();

/**
 * The floor's walls cut into stretches, each with the clearance a laid-out
 * group keeps from it (INNER_CORNER_CLEARANCE_M): `cornerClearance` within
 * `band` of an inner corner, `band` everywhere else. Render space.
 */
export function bandedWalls(floor: RoomFloor, band: number, cornerClearance: number): readonly BandedWall[] {
  const key = `${String(band)}|${String(cornerClearance)}`;
  const known = bandedWallCache.get(floor)?.get(key);
  if (known !== undefined) return known;
  const corners = band > 0 ? innerCornersOf(floor) : [];
  const stretches: BandedWall[] = [];
  for (const { ax, az, bx, bz } of floor.edges) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    // Where along this wall (0 at a, 1 at b) it lies within `band` of an inner corner.
    const near: [number, number][] = [];
    for (const [cx, cz] of corners) {
      const fx = ax - cx;
      const fz = az - cz;
      const b = 2 * (fx * dx + fz * dz);
      const c = fx * fx + fz * fz - band * band;
      const disc = b * b - 4 * lengthSq * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      const from = Math.max(0, (-b - root) / (2 * lengthSq));
      const to = Math.min(1, (-b + root) / (2 * lengthSq));
      if (to > from) near.push([from, to]);
    }
    near.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const span of near) {
      const last = merged[merged.length - 1];
      if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([span[0], span[1]]);
    }
    const stretch = (from: number, to: number, clearance: number): void => {
      stretches.push({ ax: ax + from * dx, az: az + from * dz, bx: ax + to * dx, bz: az + to * dz, clearance });
    };
    let at = 0;
    for (const [from, to] of merged) {
      if (from > at) stretch(at, from, band);
      stretch(from, to, cornerClearance);
      at = to;
    }
    if (at < 1) stretch(at, 1, band);
  }
  const byKey = bandedWallCache.get(floor) ?? new Map<string, readonly BandedWall[]>();
  byKey.set(key, stretches);
  bandedWallCache.set(floor, byKey);
  return stretches;
}

function pointToStretch(x: number, z: number, wall: BandedWall): number {
  const dx = wall.bx - wall.ax;
  const dz = wall.bz - wall.az;
  const lengthSq = dx * dx + dz * dz;
  const along = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - wall.ax) * dx + (z - wall.az) * dz) / lengthSq));
  return Math.hypot(x - (wall.ax + along * dx), z - (wall.az + along * dz));
}

/**
 * By how much a disc keeps the band from the floor's walls (bandedWalls):
 * the least, over every stretch, of its gap to the stretch less the
 * clearance the stretch asks. At least zero (to a hair) keeps it; minus
 * infinity when its centre is outside the walls.
 */
export function discBandSlack(floor: RoomFloor, x: number, z: number, radius: number, band: number, cornerClearance: number): number {
  if (!isPointInPolygon(x, z, floor.outline)) return Number.NEGATIVE_INFINITY;
  let slack = Number.POSITIVE_INFINITY;
  for (const wall of bandedWalls(floor, band, cornerClearance)) slack = Math.min(slack, pointToStretch(x, z, wall) - radius - wall.clearance);
  return slack;
}

/** Whether a disc stands on the floor with the band kept from its walls, the inner corners' clearance at them. */
export function discKeepsBand(floor: RoomFloor, x: number, z: number, radius: number, band: number, cornerClearance: number): boolean {
  return discBandSlack(floor, x, z, radius, band, cornerClearance) >= -FLUSH;
}

/** The gap from the box x ± halfW, z ± halfD to a stretch of wall: nothing when the stretch reaches it. */
function boxToStretch(x: number, z: number, halfW: number, halfD: number, wall: BandedWall): number {
  const edge: FloorEdge = { ax: wall.ax, az: wall.az, bx: wall.bx, bz: wall.bz, nx: 0, nz: 0 };
  if (edgeCrossesBox(edge, x - halfW, x + halfW, z - halfD, z + halfD)) return 0;
  // Two convex shapes apart are nearest at a corner of one.
  const toBox = (px: number, pz: number): number => Math.hypot(Math.max(0, Math.abs(px - x) - halfW), Math.max(0, Math.abs(pz - z) - halfD));
  let gap = Math.min(toBox(wall.ax, wall.az), toBox(wall.bx, wall.bz));
  for (const [cx, cz] of [[x - halfW, z - halfD], [x + halfW, z - halfD], [x + halfW, z + halfD], [x - halfW, z + halfD]] as const) {
    gap = Math.min(gap, pointToStretch(cx, cz, wall));
  }
  return gap;
}

/** By how much a footprint box keeps the band from the floor's walls, as discBandSlack; minus infinity when it is not wholly on the floor. */
export function rectBandSlack(floor: RoomFloor, x: number, z: number, halfW: number, halfD: number, band: number, cornerClearance: number): number {
  if (!rectWithinFloor(floor, x, z, halfW, halfD)) return Number.NEGATIVE_INFINITY;
  let slack = Number.POSITIVE_INFINITY;
  for (const wall of bandedWalls(floor, band, cornerClearance)) slack = Math.min(slack, boxToStretch(x, z, halfW, halfD, wall) - wall.clearance);
  return slack;
}

/** Whether a footprint box stands wholly on the floor with the band kept from its walls, the inner corners' clearance at them. */
export function rectKeepsBand(floor: RoomFloor, x: number, z: number, halfW: number, halfD: number, band: number, cornerClearance: number): boolean {
  return rectBandSlack(floor, x, z, halfW, halfD, band, cornerClearance) >= -FLUSH;
}

/** One way a footprint is through the walls: how far, and the shifts along an axis that would clear that wall. */
export interface FloorCrossing {
  readonly depth: number;
  readonly escapes: readonly { readonly axis: "x" | "z"; readonly amount: number }[];
}

/**
 * How a footprint is through the floor's walls; none when it stands wholly
 * on the floor. Each wall passing through it gives how far the footprint
 * reaches beyond that wall and the shift along each axis that brings it back
 * to the wall's line. A footprint wholly beyond the walls gives the shift
 * back inside the floor's bounds where one exists.
 */
export function floorCrossings(floor: RoomFloor, x: number, z: number, halfW: number, halfD: number): readonly FloorCrossing[] {
  if (rectWithinFloor(floor, x, z, halfW, halfD)) return [];
  const found: FloorCrossing[] = [];
  for (const edge of floor.edges) {
    if (!edgeThroughFootprint(edge, x, z, halfW, halfD)) continue;
    const inside = (x - edge.ax) * edge.nx + (z - edge.az) * edge.nz;
    const depth = halfW * Math.abs(edge.nx) + halfD * Math.abs(edge.nz) - inside;
    if (depth <= FLUSH) continue;
    const escapes: { axis: "x" | "z"; amount: number }[] = [];
    if (Math.abs(edge.nx) > STRAIGHT) escapes.push({ axis: "x", amount: depth / edge.nx });
    if (Math.abs(edge.nz) > STRAIGHT) escapes.push({ axis: "z", amount: depth / edge.nz });
    found.push({ depth, escapes });
  }
  if (found.length > 0) return found;

  // No wall passes through it and it is not inside: it stands wholly beyond the walls.
  const axes: readonly { readonly axis: "x" | "z"; readonly low: number; readonly high: number }[] = [
    { axis: "x", low: floor.minX - (x - halfW), high: x + halfW - floor.maxX },
    { axis: "z", low: floor.minZ - (z - halfD), high: z + halfD - floor.maxZ },
  ];
  for (const { axis, low, high } of axes) {
    if (low <= 0 && high <= 0) continue;
    found.push({ depth: Math.max(low, high), escapes: low > 0 && high > 0 ? [] : [{ axis, amount: low > 0 ? low : -high }] });
  }
  if (found.length > 0) return found;
  const corners: readonly (readonly [number, number])[] = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]];
  return [{ depth: Math.max(...corners.map(([dx, dz]) => distanceToWalls(floor, x + dx, z + dz))), escapes: [] }];
}

/** A pull along one axis: flush against `wall`, or no pull (`wall` null, `to` where the piece is). */
interface Pull {
  readonly to: number;
  readonly gap: number;
  readonly wall: FloorWall | null;
}

/** Whether a piece spanning from..to along a wall's run stands against the wall itself, not the line beyond its end. */
function standsAgainst(wall: FloorWall | null, from: number, to: number): boolean {
  return wall === null || (wall.to > from + FLUSH && wall.from < to - FLUSH);
}

/**
 * The walls along an axis whose line the piece's edge is within `threshold`
 * of, nearest first; on a tie the wall on the lesser side, as the rectangle's
 * rule prefers it. With `facing`, the piece's span along the walls' run, only
 * the walls it stands against there.
 */
function pullsAlong(
  floor: RoomFloor,
  axis: "x" | "z",
  centre: number,
  half: number,
  threshold: number,
  facing: readonly [number, number] | null,
): Pull[] {
  const pulls: Pull[] = [];
  for (const wall of floor.walls) {
    if (wall.axis !== axis) continue;
    if (facing !== null && !standsAgainst(wall, facing[0], facing[1])) continue;
    // As the rectangle's rule measures it: from the piece's edge on that side to the wall.
    const gap = Math.abs(wall.roomSide === -1 ? wall.at - (centre + half) : (centre - half) - wall.at);
    if (gap < threshold) pulls.push({ to: wall.at + wall.roomSide * half, gap, wall });
  }
  return pulls.sort((a, b) => a.gap - b.gap || (b.wall?.roomSide ?? 0) - (a.wall?.roomSide ?? 0));
}

/**
 * Wall snap on a floor: the footprint pulled flush against the walls it
 * faces within `threshold`, as the rectangle's rule pulls it, but only to a
 * spot where it stands wholly on the floor and against each wall that pulled
 * it. Both axes where that can be, the nearest walls first; else one axis;
 * else it stays where it is.
 *
 * A piece standing on the floor is pulled only by walls it faces where it
 * is. A piece through a wall may face a second wall only once the first has
 * pulled it back, and one hanging past a corner faces neither wall of the
 * corner, so those are offered the walls they would then stand against.
 */
export function snapToFloorWalls(
  floor: RoomFloor,
  x: number,
  z: number,
  halfW: number,
  halfD: number,
  threshold: number,
): { readonly x: number; readonly z: number } {
  let alongX = pullsAlong(floor, "x", x, halfW, threshold, [z - halfD, z + halfD]);
  let alongZ = pullsAlong(floor, "z", z, halfD, threshold, [x - halfW, x + halfW]);
  if (!rectWithinFloor(floor, x, z, halfW, halfD)) {
    const [firstX] = alongX;
    const [firstZ] = alongZ;
    if (firstX === undefined && firstZ === undefined) {
      alongX = pullsAlong(floor, "x", x, halfW, threshold, null);
      alongZ = pullsAlong(floor, "z", z, halfD, threshold, null);
    } else if (firstX === undefined && firstZ !== undefined) {
      alongX = pullsAlong(floor, "x", x, halfW, threshold, [firstZ.to - halfD, firstZ.to + halfD]);
    } else if (firstZ === undefined && firstX !== undefined) {
      alongZ = pullsAlong(floor, "z", z, halfD, threshold, [firstX.to - halfW, firstX.to + halfW]);
    }
  }
  const stayX: Pull = { to: x, gap: 0, wall: null };
  const stayZ: Pull = { to: z, gap: 0, wall: null };
  const nearestFirst = ([ax, az]: readonly [Pull, Pull], [bx, bz]: readonly [Pull, Pull]): number => ax.gap + az.gap - (bx.gap + bz.gap);
  const both = alongX.flatMap((pullX) => alongZ.map((pullZ) => [pullX, pullZ] as const)).sort(nearestFirst);
  const one = [...alongX.map((pullX) => [pullX, stayZ] as const), ...alongZ.map((pullZ) => [stayX, pullZ] as const)].sort(nearestFirst);
  for (const [pullX, pullZ] of [...both, ...one]) {
    if (!standsAgainst(pullX.wall, pullZ.to - halfD, pullZ.to + halfD)) continue;
    if (!standsAgainst(pullZ.wall, pullX.to - halfW, pullX.to + halfW)) continue;
    if (rectWithinFloor(floor, pullX.to, pullZ.to, halfW, halfD)) return { x: pullX.to, z: pullZ.to };
  }
  return { x, z };
}
