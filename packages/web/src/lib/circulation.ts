// ---------------------------------------------------------------------------
// circulation — planning-grade aisle-clearance intelligence.
//
// Answers "can people actually walk between the tables?" from the real placed
// geometry. Each piece of furniture is modelled as an oriented bounding box
// (OBB) footprint on the floor plane; the engine computes the EXACT minimum
// distance between every pair of footprints (true convex-polygon distance, not
// an axis-aligned approximation) and reports the tightest aisle plus how many
// gaps fall below planning-grade walkway widths.
//
// SAFE LANGUAGE: every number here is a PLANNING-GRADE circulation estimate. It
// is NOT a legal egress route, NOT a fire-code aisle width, and NOT a
// survey-grade measurement. Human review is required before any circulation
// claim reaches a client. The labels below stay strictly inside that
// vocabulary.
// ---------------------------------------------------------------------------

/** A point on the floor plane, metres. `x` is world-X, `z` is world-Z. */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** A furniture piece as an oriented box footprint on the floor, metres. */
export interface FurnitureFootprint {
  readonly id: string;
  readonly label: string;
  /** Centre of the footprint, metres. */
  readonly cx: number;
  readonly cz: number;
  /** Size before rotation, metres (width = X, depth = Z). */
  readonly width: number;
  readonly depth: number;
  /** Rotation about the vertical axis, radians. */
  readonly rotation: number;
}

// Planning-grade walkway guidance (metres). Common event-planning rules of
// thumb for circulation between furniture — NOT regulatory egress widths.
export const CIRCULATION_AISLE = {
  /** A comfortable two-way / service walkway. */
  comfortableM: 1.2,
  /** Minimum single-file walkway still inside planning guidance. */
  tightM: 0.9,
  /** Below this a gap is effectively impassable. */
  blockedM: 0.45,
} as const;

export type CirculationBand = "open" | "generous" | "comfortable" | "tight" | "blocked";

export interface CirculationGap {
  readonly aId: string;
  readonly bId: string;
  readonly aLabel: string;
  readonly bLabel: string;
  /** Minimum clear distance between the two footprints, metres. */
  readonly gapM: number;
  /** Closest point on footprint `a` (witness of the gap), metres. */
  readonly pointA: Vec2;
  /** Closest point on footprint `b` (witness of the gap), metres. */
  readonly pointB: Vec2;
}

export interface CirculationReport {
  /** Number of footprint pairs evaluated. */
  readonly pairCount: number;
  /** Tightest gap between any two footprints, or null with fewer than 2. */
  readonly tightestGapM: number | null;
  /** The pair that produced `tightestGapM`, or null with fewer than 2. */
  readonly tightestPair: CirculationGap | null;
  /**
   * Every pair whose gap falls below the comfortable single-file width
   * (`tightM`) — i.e. the tight and blocked aisles — sorted tightest-first.
   * `tightestPair` is the first entry when this list is non-empty. The whole
   * list is what lets the planner see *every* pinch point, not just the worst.
   */
  readonly problemGaps: readonly CirculationGap[];
  /** Gaps in [blockedM, tightM) — passable but below comfortable. */
  readonly tightCount: number;
  /** Gaps below blockedM (including overlaps at 0). */
  readonly blockedCount: number;
  readonly band: CirculationBand;
}

// ---------------------------------------------------------------------------
// Geometry primitives — exact for convex polygons.
// ---------------------------------------------------------------------------

/** The four corners of a footprint's oriented box, world-space, metres. */
export function footprintCorners(f: FurnitureFootprint): readonly Vec2[] {
  const hw = f.width / 2;
  const hd = f.depth / 2;
  const cos = Math.cos(f.rotation);
  const sin = Math.sin(f.rotation);
  const local: readonly [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([lx, lz]) => ({
    x: f.cx + lx * cos - lz * sin,
    z: f.cz + lx * sin + lz * cos,
  }));
}

/** The point on segment `a`–`b` closest to `p` (clamped to the endpoints). */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  if (lenSq === 0) return { x: a.x, z: a.z };
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, z: a.z + t * abz };
}

/** Shortest distance from point `p` to segment `a`–`b`. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const c = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - c.x, p.z - c.z);
}

/** Centroid (mean of vertices) of a polygon, metres. */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let sx = 0;
  let sz = 0;
  for (const v of poly) {
    sx += v.x;
    sz += v.z;
  }
  const n = poly.length === 0 ? 1 : poly.length;
  return { x: sx / n, z: sz / n };
}

/**
 * Separating Axis Theorem overlap test for two convex polygons. Returns true
 * when they intersect (including touching). Axes are the edge normals of both
 * polygons.
 */
export function convexPolygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      if (p1 === undefined || p2 === undefined) continue;
      // Edge normal (perpendicular to the edge).
      const axisX = -(p2.z - p1.z);
      const axisZ = p2.x - p1.x;
      const [minA, maxA] = projectPolygon(a, axisX, axisZ);
      const [minB, maxB] = projectPolygon(b, axisX, axisZ);
      if (maxA < minB || maxB < minA) return false; // separating axis found
    }
  }
  return true;
}

function projectPolygon(poly: readonly Vec2[], axisX: number, axisZ: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of poly) {
    const proj = v.x * axisX + v.z * axisZ;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return [min, max];
}

/** Exact minimum distance plus the witness points realizing it. */
export interface PolygonClosest {
  /** Minimum clear distance, metres. 0 when the polygons overlap or touch. */
  readonly distance: number;
  /** Closest point on polygon `a`. */
  readonly pointA: Vec2;
  /** Closest point on polygon `b`. */
  readonly pointB: Vec2;
}

/**
 * Exact closest points between two convex polygons. When they overlap or
 * touch the distance is 0 and the witnesses fall back to the centroids (no
 * single closest pair exists inside an overlap). Otherwise the witnesses are
 * the true closest vertex/edge points — for convex polygons the global minimum
 * is always realized by a vertex of one against an edge of the other.
 */
export function convexPolygonClosestPoints(a: readonly Vec2[], b: readonly Vec2[]): PolygonClosest {
  if (convexPolygonsOverlap(a, b)) {
    return { distance: 0, pointA: polygonCentroid(a), pointB: polygonCentroid(b) };
  }
  let min = Infinity;
  let pointA: Vec2 = a[0] ?? { x: 0, z: 0 };
  let pointB: Vec2 = b[0] ?? { x: 0, z: 0 };
  // (vertices of `from`) against (edges of `into`). `aIsVertex` tracks which
  // polygon owns the vertex so the witness pair is reported a-then-b.
  for (const { from, into, aIsVertex } of [
    { from: a, into: b, aIsVertex: true },
    { from: b, into: a, aIsVertex: false },
  ] as const) {
    for (const v of from) {
      for (let i = 0; i < into.length; i += 1) {
        const e1 = into[i];
        const e2 = into[(i + 1) % into.length];
        if (e1 === undefined || e2 === undefined) continue;
        const cp = closestPointOnSegment(v, e1, e2);
        const d = Math.hypot(v.x - cp.x, v.z - cp.z);
        if (d < min) {
          min = d;
          if (aIsVertex) {
            pointA = v;
            pointB = cp;
          } else {
            pointA = cp;
            pointB = v;
          }
        }
      }
    }
  }
  return { distance: min, pointA, pointB };
}

/**
 * Exact minimum distance between two convex polygons. 0 when they overlap or
 * touch; otherwise the closest vertex-to-edge distance (which, for convex
 * polygons, is the true separation).
 */
export function convexPolygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  return convexPolygonClosestPoints(a, b).distance;
}

// ---------------------------------------------------------------------------
// Circulation report
// ---------------------------------------------------------------------------

/** Classify a single clear gap (metres) into a circulation band. null → open. */
export function bandForGap(gapM: number | null): CirculationBand {
  if (gapM === null) return "open";
  if (gapM >= CIRCULATION_AISLE.comfortableM) return "generous";
  if (gapM >= CIRCULATION_AISLE.tightM) return "comfortable";
  if (gapM >= CIRCULATION_AISLE.blockedM) return "tight";
  return "blocked";
}

/**
 * Compute the circulation report for a set of footprints. Evaluates the exact
 * minimum gap between every pair and summarises the tightest aisle.
 */
export function computeCirculation(footprints: readonly FurnitureFootprint[]): CirculationReport {
  if (footprints.length < 2) {
    return {
      pairCount: 0,
      tightestGapM: null,
      tightestPair: null,
      problemGaps: [],
      tightCount: 0,
      blockedCount: 0,
      band: "open",
    };
  }

  const corners = footprints.map(footprintCorners);
  let tightestGapM = Infinity;
  let tightestPair: CirculationGap | null = null;
  const problemGaps: CirculationGap[] = [];
  let tightCount = 0;
  let blockedCount = 0;
  let pairCount = 0;

  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      const a = footprints[i];
      const b = footprints[j];
      const ca = corners[i];
      const cb = corners[j];
      if (a === undefined || b === undefined || ca === undefined || cb === undefined) continue;
      pairCount += 1;
      const closest = convexPolygonClosestPoints(ca, cb);
      const gapM = closest.distance;

      if (gapM < CIRCULATION_AISLE.blockedM) blockedCount += 1;
      else if (gapM < CIRCULATION_AISLE.tightM) tightCount += 1;

      const gap: CirculationGap = {
        aId: a.id,
        bId: b.id,
        aLabel: a.label,
        bLabel: b.label,
        gapM,
        pointA: closest.pointA,
        pointB: closest.pointB,
      };

      // Every aisle below the comfortable single-file width is a pinch point.
      if (gapM < CIRCULATION_AISLE.tightM) problemGaps.push(gap);

      if (gapM < tightestGapM) {
        tightestGapM = gapM;
        tightestPair = gap;
      }
    }
  }

  // Tightest-first so problemGaps[0] is the headline pinch point and the rest
  // are the secondary ones the overlay marks subtly. Stable sort keeps ties in
  // discovery order, so problemGaps[0] coincides with tightestPair.
  problemGaps.sort((p, q) => p.gapM - q.gapM);

  const tightest = tightestPair === null ? null : tightestGapM;
  return {
    pairCount,
    tightestGapM: tightest,
    tightestPair,
    problemGaps,
    tightCount,
    blockedCount,
    band: bandForGap(tightest),
  };
}

/** SAFE, human-readable summary of a circulation band. Never a legal claim. */
export function circulationBandLabel(band: CirculationBand): string {
  switch (band) {
    case "open":
      return "Add a second table to assess circulation";
    case "generous":
      return "Generous walkways between tables";
    case "comfortable":
      return "Comfortable walkways between tables";
    case "tight":
      return "Tight walkways — review circulation";
    case "blocked":
      return "Tables too close to pass between — venue review required";
  }
}
