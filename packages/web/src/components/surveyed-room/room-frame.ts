// ---------------------------------------------------------------------------
// A surveyed room's frame, from its measured outline
//
// The planner frame (tools/surveyed-rooms/README.md, "Frames and conventions"):
// metres, y up, origin at the centre of the room's floor, floor at y = 0. The
// outline is the wall faces' corners in planner (x, z), counter-clockwise seen
// from above (turning from +x towards -z). Segment i runs from vertex i to
// vertex i + 1, the last closing the loop, with the room on its left.
//
// Along a wall, u runs left to right as you face the wall from inside, so
// u = 0 is at the segment's END vertex (i + 1) and u = length at vertex i; v is
// height above the floor and depth is positive towards the room. A point on a
// wall is origin + tangent·u + up·v + normal·depth, as the Grand Hall's walls
// are (HallWall in components/grand-hall/hall-spec.ts).
//
// data/room-geometries.ts winds its polygons the other way, so an outline is
// reversed for the planner (outlineForPlanner).
// ---------------------------------------------------------------------------

/** A point in the planner's floor plane, (x, z) in metres. */
export type PlanPoint = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** One wall of the outline, seen from inside the room. */
export interface WallFrame {
  /** Index of the outline segment (and of the record's wall). */
  readonly index: number;
  /** Vertex i: where u = length. */
  readonly start: PlanPoint;
  /** Vertex i + 1: where u = 0. */
  readonly end: PlanPoint;
  /** The u = 0 point on the floor. */
  readonly origin: Vec3;
  /** Unit vector of increasing u. */
  readonly tangent: Vec3;
  /** Unit horizontal vector into the room. */
  readonly normal: Vec3;
  readonly length: number;
}

export interface OutlineBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface RoomFrame {
  readonly outline: readonly PlanPoint[];
  /** One per outline segment, in order. */
  readonly walls: readonly WallFrame[];
  readonly bounds: OutlineBounds;
  /** Floor area inside the outline, square metres. */
  readonly area: number;
}

function vertex(outline: readonly PlanPoint[], index: number): PlanPoint {
  const point = outline[((index % outline.length) + outline.length) % outline.length];
  if (point === undefined) throw new Error("Surveyed room outline: no vertices");
  return point;
}

/** Turns -0 into 0, so a frame compares equal to one written by hand. */
function tidy(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Shoelace area of the outline, positive for the tools' winding
 * (counter-clockwise seen from above, from +x towards -z).
 */
export function outlineSignedArea(outline: readonly PlanPoint[]): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = vertex(outline, i);
    const [x1, z1] = vertex(outline, i + 1);
    twice += x1 * z0 - x0 * z1;
  }
  return twice / 2;
}

/** Floor area enclosed by the outline, square metres. */
export function outlineArea(outline: readonly PlanPoint[]): number {
  return Math.abs(outlineSignedArea(outline));
}

export function outlineBounds(outline: readonly PlanPoint[]): OutlineBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of outline) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Length of segment i (vertex i to vertex i + 1). */
export function segmentLength(outline: readonly PlanPoint[], index: number): number {
  const [x0, z0] = vertex(outline, index);
  const [x1, z1] = vertex(outline, index + 1);
  return Math.hypot(x1 - x0, z1 - z0);
}

function cross(o: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function onSegment(p: PlanPoint, q: PlanPoint, r: PlanPoint): boolean {
  return Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0])
    && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
}

/** Whether segments pq and rs cross or touch. */
function segmentsMeet(p: PlanPoint, q: PlanPoint, r: PlanPoint, s: PlanPoint): boolean {
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(r, s, p)) || (d2 === 0 && onSegment(r, s, q))
    || (d3 === 0 && onSegment(p, q, r)) || (d4 === 0 && onSegment(p, q, s));
}

/**
 * The first pair of segments that cross, touch or fold back over each other,
 * or null for a simple outline.
 */
export function outlineCrossing(outline: readonly PlanPoint[]): readonly [number, number] | null {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    // Neighbours share a vertex; they meet wrongly only by doubling back.
    const p = vertex(outline, i);
    const q = vertex(outline, i + 1);
    const r = vertex(outline, i + 2);
    const along = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]);
    if (cross(p, q, r) === 0 && along < 0) return [i, (i + 1) % n];
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(vertex(outline, i), vertex(outline, i + 1), vertex(outline, j), vertex(outline, j + 1))) return [i, j];
    }
  }
  return null;
}

/** Why an outline cannot frame a room, or null when it can. */
export function outlineFault(outline: readonly PlanPoint[]): string | null {
  if (outline.length < 3) return `has ${String(outline.length)} vertices; a room needs at least 3`;
  for (const [x, z] of outline) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return "has a vertex that is not a finite number";
  }
  for (let i = 0; i < outline.length; i++) {
    if (segmentLength(outline, i) === 0) return `segment ${String(i)} has no length (vertices ${String(i)} and ${String((i + 1) % outline.length)} coincide)`;
  }
  const crossing = outlineCrossing(outline);
  if (crossing !== null) return `crosses itself: segments ${String(crossing[0])} and ${String(crossing[1])} meet`;
  if (outlineSignedArea(outline) <= 0) return "is clockwise seen from above; the tools wind outlines counter-clockwise (from +x towards -z)";
  return null;
}

/** The frame of segment `index`. */
export function wallFrame(outline: readonly PlanPoint[], index: number): WallFrame {
  const start = vertex(outline, index);
  const end = vertex(outline, index + 1);
  const length = segmentLength(outline, index);
  if (!(length > 0)) throw new Error(`Surveyed room outline: segment ${String(index)} has no length`);
  const dx = (end[0] - start[0]) / length;
  const dz = (end[1] - start[1]) / length;
  return {
    index,
    start,
    end,
    origin: [end[0], 0, end[1]],
    // u grows from the end vertex back towards the start.
    tangent: [tidy(-dx), 0, tidy(-dz)],
    // The room is on the left of the segment's direction, seen from above.
    normal: [tidy(dz), 0, tidy(-dx)],
    length,
  };
}

/** The frame of every wall, with the outline's bounds and area; throws on an outline that cannot frame a room. */
export function buildRoomFrame(outline: readonly PlanPoint[]): RoomFrame {
  const fault = outlineFault(outline);
  if (fault !== null) throw new Error(`Surveyed room outline ${fault}`);
  return {
    outline,
    walls: outline.map((_, index) => wallFrame(outline, index)),
    bounds: outlineBounds(outline),
    area: outlineArea(outline),
  };
}

/** Planner position of a wall-local point; `depth` is measured into the room. */
export function pointOnWall(wall: WallFrame, u: number, v: number, depth = 0): [number, number, number] {
  return [
    wall.origin[0] + wall.tangent[0] * u + wall.normal[0] * depth,
    v,
    wall.origin[2] + wall.tangent[2] * u + wall.normal[2] * depth,
  ];
}

/** The outline wound as data/room-geometries.ts winds its polygons (reversed). */
export function outlineForPlanner(outline: readonly PlanPoint[]): [number, number][] {
  return outline.map(([x, z]): [number, number] => [x, z]).reverse();
}
