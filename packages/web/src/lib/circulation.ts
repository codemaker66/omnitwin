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
}

export interface CirculationReport {
  /** Number of footprint pairs evaluated. */
  readonly pairCount: number;
  /** Tightest gap between any two footprints, or null with fewer than 2. */
  readonly tightestGapM: number | null;
  /** The pair that produced `tightestGapM`, or null with fewer than 2. */
  readonly tightestPair: CirculationGap | null;
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

/** Shortest distance from point `p` to segment `a`–`b`. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projZ = a.z + t * abz;
  return Math.hypot(p.x - projX, p.z - projZ);
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

/**
 * Exact minimum distance between two convex polygons. 0 when they overlap or
 * touch; otherwise the closest vertex-to-edge distance (which, for convex
 * polygons, is the true separation).
 */
export function convexPolygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (convexPolygonsOverlap(a, b)) return 0;
  let min = Infinity;
  for (const [poly, other] of [[a, b], [b, a]] as const) {
    for (const v of poly) {
      for (let i = 0; i < other.length; i += 1) {
        const e1 = other[i];
        const e2 = other[(i + 1) % other.length];
        if (e1 === undefined || e2 === undefined) continue;
        const d = pointSegmentDistance(v, e1, e2);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

// ---------------------------------------------------------------------------
// Circulation report
// ---------------------------------------------------------------------------

function bandForGap(tightestGapM: number | null): CirculationBand {
  if (tightestGapM === null) return "open";
  if (tightestGapM >= CIRCULATION_AISLE.comfortableM) return "generous";
  if (tightestGapM >= CIRCULATION_AISLE.tightM) return "comfortable";
  if (tightestGapM >= CIRCULATION_AISLE.blockedM) return "tight";
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
      tightCount: 0,
      blockedCount: 0,
      band: "open",
    };
  }

  const corners = footprints.map(footprintCorners);
  let tightestGapM = Infinity;
  let tightestPair: CirculationGap | null = null;
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
      const gapM = convexPolygonDistance(ca, cb);

      if (gapM < CIRCULATION_AISLE.blockedM) blockedCount += 1;
      else if (gapM < CIRCULATION_AISLE.tightM) tightCount += 1;

      if (gapM < tightestGapM) {
        tightestGapM = gapM;
        tightestPair = { aId: a.id, bId: b.id, aLabel: a.label, bLabel: b.label, gapM };
      }
    }
  }

  const tightest = tightestPair === null ? null : tightestGapM;
  return {
    pairCount,
    tightestGapM: tightest,
    tightestPair,
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
      return "Tables too close to pass between — review (not a legal egress check)";
  }
}
