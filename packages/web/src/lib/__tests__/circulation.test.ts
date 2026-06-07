import { describe, it, expect } from "vitest";
import {
  footprintCorners,
  pointSegmentDistance,
  closestPointOnSegment,
  polygonCentroid,
  convexPolygonsOverlap,
  convexPolygonDistance,
  convexPolygonClosestPoints,
  computeCirculation,
  circulationBandLabel,
  bandForGap,
  CIRCULATION_AISLE,
  type FurnitureFootprint,
  type CirculationBand,
} from "../circulation.js";

function box(
  id: string,
  cx: number,
  cz: number,
  width = 1,
  depth = 1,
  rotation = 0,
): FurnitureFootprint {
  return { id, label: id, cx, cz, width, depth, rotation };
}

describe("footprintCorners", () => {
  it("returns the 4 axis-aligned corners for an unrotated box", () => {
    const corners = footprintCorners(box("a", 0, 0, 2, 1));
    const xs = corners.map((c) => c.x).sort((p, q) => p - q);
    const zs = corners.map((c) => c.z).sort((p, q) => p - q);
    expect(corners).toHaveLength(4);
    expect(xs[0]).toBeCloseTo(-1, 6);
    expect(xs[3]).toBeCloseTo(1, 6);
    expect(zs[0]).toBeCloseTo(-0.5, 6);
    expect(zs[3]).toBeCloseTo(0.5, 6);
  });

  it("swaps effective extents when rotated 90°", () => {
    const corners = footprintCorners(box("a", 0, 0, 2, 1, Math.PI / 2));
    const xs = corners.map((c) => c.x);
    const zs = corners.map((c) => c.z);
    // A 2(wide)×1(deep) box rotated 90° becomes 1 along X, 2 along Z.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 6);
  });
});

describe("pointSegmentDistance", () => {
  it("measures perpendicular distance to a segment", () => {
    expect(pointSegmentDistance({ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(1, 6);
  });
  it("clamps to the nearest endpoint past the segment", () => {
    expect(pointSegmentDistance({ x: 3, z: 0 }, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(2, 6);
  });
  it("handles a degenerate (zero-length) segment", () => {
    expect(pointSegmentDistance({ x: 3, z: 4 }, { x: 0, z: 0 }, { x: 0, z: 0 })).toBeCloseTo(5, 6);
  });
});

describe("convexPolygonsOverlap", () => {
  it("detects overlapping boxes", () => {
    const a = footprintCorners(box("a", 0, 0));
    const b = footprintCorners(box("b", 0.5, 0));
    expect(convexPolygonsOverlap(a, b)).toBe(true);
  });
  it("treats edge-touching boxes as overlapping", () => {
    const a = footprintCorners(box("a", 0, 0));
    const b = footprintCorners(box("b", 1, 0)); // right edge of A == left edge of B at x=0.5
    expect(convexPolygonsOverlap(a, b)).toBe(true);
  });
  it("detects clearly separated boxes", () => {
    const a = footprintCorners(box("a", 0, 0));
    const b = footprintCorners(box("b", 2, 0));
    expect(convexPolygonsOverlap(a, b)).toBe(false);
  });
});

describe("closestPointOnSegment", () => {
  it("returns the perpendicular foot when it lands inside the segment", () => {
    const c = closestPointOnSegment({ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 });
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.z).toBeCloseTo(0, 6);
  });
  it("clamps to the nearest endpoint when the projection falls outside", () => {
    const c = closestPointOnSegment({ x: 3, z: 0 }, { x: -1, z: 0 }, { x: 1, z: 0 });
    expect(c.x).toBeCloseTo(1, 6);
    expect(c.z).toBeCloseTo(0, 6);
  });
  it("returns the shared endpoint for a degenerate segment", () => {
    const c = closestPointOnSegment({ x: 3, z: 4 }, { x: 2, z: 2 }, { x: 2, z: 2 });
    expect(c.x).toBeCloseTo(2, 6);
    expect(c.z).toBeCloseTo(2, 6);
  });
});

describe("polygonCentroid", () => {
  it("averages the vertices of an unrotated box back to its centre", () => {
    const c = polygonCentroid(footprintCorners(box("a", 3, -2, 2, 4)));
    expect(c.x).toBeCloseTo(3, 6);
    expect(c.z).toBeCloseTo(-2, 6);
  });
});

describe("convexPolygonClosestPoints", () => {
  it("reports the axis-aligned witnesses of the gap between two boxes", () => {
    // 1×1 boxes centred 2 apart on X → gap 1.0 between the facing edges at
    // x = 0.5 and x = 1.5, at the same z.
    const r = convexPolygonClosestPoints(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 2, 0)));
    expect(r.distance).toBeCloseTo(1, 6);
    expect(r.pointA.x).toBeCloseTo(0.5, 6);
    expect(r.pointB.x).toBeCloseTo(1.5, 6);
    expect(r.pointA.z).toBeCloseTo(r.pointB.z, 6);
  });
  it("reports the corner witnesses of a diagonal gap", () => {
    const r = convexPolygonClosestPoints(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 2, 2)));
    expect(r.distance).toBeCloseTo(Math.SQRT2, 6);
    expect(r.pointA.x).toBeCloseTo(0.5, 6);
    expect(r.pointA.z).toBeCloseTo(0.5, 6);
    expect(r.pointB.x).toBeCloseTo(1.5, 6);
    expect(r.pointB.z).toBeCloseTo(1.5, 6);
  });
  it("falls back to centroids with distance 0 when the boxes overlap", () => {
    const r = convexPolygonClosestPoints(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 0.5, 0)));
    expect(r.distance).toBe(0);
    expect(r.pointA.x).toBeCloseTo(0, 6);
    expect(r.pointB.x).toBeCloseTo(0.5, 6);
  });
});

describe("convexPolygonDistance", () => {
  it("is 0 for overlapping boxes", () => {
    expect(convexPolygonDistance(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 0.5, 0)))).toBe(0);
  });
  it("measures the axis-aligned gap between two boxes", () => {
    // 1×1 boxes centred 2 apart → 1.0 m clear gap.
    expect(convexPolygonDistance(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 2, 0)))).toBeCloseTo(1, 6);
  });
  it("measures the diagonal corner-to-corner gap", () => {
    // Closest corners (0.5,0.5) and (1.5,1.5) → √2.
    expect(convexPolygonDistance(footprintCorners(box("a", 0, 0)), footprintCorners(box("b", 2, 2)))).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("computeCirculation", () => {
  it("returns an open report with fewer than two footprints", () => {
    const r = computeCirculation([box("a", 0, 0)]);
    expect(r.band).toBe("open");
    expect(r.tightestGapM).toBeNull();
    expect(r.pairCount).toBe(0);
  });

  it("reports a comfortable band for a ~1 m table aisle", () => {
    const r = computeCirculation([box("a", 0, 0), box("b", 2, 0)]);
    expect(r.tightestGapM).toBeCloseTo(1, 6);
    expect(r.band).toBe("comfortable"); // [0.9, 1.2)
    expect(r.tightestPair?.aId).toBe("a");
    expect(r.tightestPair?.bId).toBe("b");
    // Witness points sit on the facing edges of the two footprints.
    expect(r.tightestPair?.pointA.x).toBeCloseTo(0.5, 6);
    expect(r.tightestPair?.pointB.x).toBeCloseTo(1.5, 6);
  });

  it("reports generous when every gap clears the comfortable width", () => {
    const r = computeCirculation([box("a", 0, 0), box("b", 2.5, 0)]);
    expect(r.band).toBe("generous"); // gap 1.5 ≥ 1.2
    expect(r.tightCount).toBe(0);
    expect(r.blockedCount).toBe(0);
  });

  it("flags a tight aisle and counts it", () => {
    const r = computeCirculation([box("a", 0, 0), box("b", 1.6, 0)]); // gap 0.6
    expect(r.band).toBe("tight"); // [0.45, 0.9)
    expect(r.tightCount).toBe(1);
    expect(r.blockedCount).toBe(0);
  });

  it("flags blocked circulation for overlapping or near-touching tables", () => {
    const overlap = computeCirculation([box("a", 0, 0), box("b", 0.4, 0)]); // overlap → 0
    expect(overlap.band).toBe("blocked");
    expect(overlap.blockedCount).toBe(1);
    expect(overlap.tightestGapM).toBe(0);
  });

  it("surfaces the single tightest pair across many tables", () => {
    const r = computeCirculation([
      box("a", 0, 0),
      box("b", 2, 0), // gap to a: 1.0
      box("c", 3.7, 0), // gap to b: 0.7 (tight) — the tightest; gap to a: 2.7
    ]);
    expect(r.pairCount).toBe(3);
    expect(r.tightestGapM).toBeCloseTo(0.7, 6);
    expect(r.band).toBe("tight");
    expect(new Set([r.tightestPair?.aId, r.tightestPair?.bId])).toEqual(new Set(["b", "c"]));
  });
});

describe("computeCirculation problemGaps", () => {
  it("is empty when every aisle clears the comfortable width", () => {
    const r = computeCirculation([box("a", 0, 0), box("b", 2.5, 0)]); // gap 1.5
    expect(r.problemGaps).toHaveLength(0);
  });

  it("collects every sub-comfortable pair, sorted tightest-first", () => {
    // a—b gap 0.6 (tight), b—c gap 0.4-overlap→0 (blocked), a—c far (clear).
    const r = computeCirculation([
      box("a", 0, 0),
      box("b", 1.6, 0), // gap to a = 0.6 (tight)
      box("c", 2.0, 0), // gap to b = 0 (overlap → blocked); gap to a = 1.0 (clear)
    ]);
    expect(r.problemGaps).toHaveLength(2);
    // Sorted tightest-first: the blocked 0 gap leads, then the 0.6 tight gap.
    expect(r.problemGaps[0]?.gapM).toBeCloseTo(0, 6);
    expect(r.problemGaps[1]?.gapM).toBeCloseTo(0.6, 6);
    // problemGaps[0] coincides with the headline tightest pair.
    expect(r.problemGaps[0]?.gapM).toBe(r.tightestGapM);
    expect(new Set([r.problemGaps[0]?.aId, r.problemGaps[0]?.bId])).toEqual(new Set(["b", "c"]));
  });

  it("counts match the problem list (tightCount + blockedCount === problemGaps.length)", () => {
    const r = computeCirculation([box("a", 0, 0), box("b", 1.6, 0), box("c", 2.0, 0)]);
    expect(r.tightCount + r.blockedCount).toBe(r.problemGaps.length);
  });
});

describe("bandForGap", () => {
  it("maps a single gap to the right band", () => {
    expect(bandForGap(null)).toBe("open");
    expect(bandForGap(1.5)).toBe("generous");
    expect(bandForGap(1.0)).toBe("comfortable");
    expect(bandForGap(0.6)).toBe("tight");
    expect(bandForGap(0.2)).toBe("blocked");
    expect(bandForGap(0)).toBe("blocked");
  });
  it("treats the band thresholds as inclusive lower bounds", () => {
    expect(bandForGap(CIRCULATION_AISLE.comfortableM)).toBe("generous");
    expect(bandForGap(CIRCULATION_AISLE.tightM)).toBe("comfortable");
    expect(bandForGap(CIRCULATION_AISLE.blockedM)).toBe("tight");
  });
});

describe("circulationBandLabel", () => {
  const FORBIDDEN = [
    "production ready", "approved for occupancy", "survey-grade",
    "photoreal digital twin", "legally compliant", "certified safe", "fire approved",
  ];
  const bands: CirculationBand[] = ["open", "generous", "comfortable", "tight", "blocked"];

  it("produces a SAFE label for every band", () => {
    for (const band of bands) {
      const label = circulationBandLabel(band);
      expect(label.length).toBeGreaterThan(0);
      const lower = label.toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
