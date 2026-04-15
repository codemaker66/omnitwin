import { describe, it, expect } from "vitest";
import type { FloorPlanPoint } from "@omnitwin/types";
import {
  validatePlacementsInPolygon,
  placementOutOfBoundsBody,
  PLACEMENT_OUT_OF_BOUNDS_CODE,
} from "../lib/placement-validation.js";

// ---------------------------------------------------------------------------
// Test polygons
// ---------------------------------------------------------------------------

/**
 * L-shaped room: the bounding box is 10m × 10m, but the top-right quadrant
 * (x ∈ [4, 10], z ∈ [4, 10]) is carved out — that area is outside the
 * polygon even though it's inside the bbox.
 *
 *    z ↑
 *    10 +──────+
 *       │      │
 *    4  │   ┌──+ 10
 *       │   │  x →
 *    0  +───+
 *       0   4
 */
const L_SHAPED_ROOM: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 10 },
  { x: 0, y: 10 },
];

/** Simple square, anchored at origin: [0..10] × [0..10]. */
const SQUARE_ROOM: readonly FloorPlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

// ---------------------------------------------------------------------------
// validatePlacementsInPolygon — the regression suite that proves the
// polygon check rejects points a bbox check would accept.
// ---------------------------------------------------------------------------

describe("validatePlacementsInPolygon", () => {
  it("accepts a point comfortably inside a simple square room", () => {
    const invalid = validatePlacementsInPolygon(
      [{ positionX: 5, positionZ: 5 }],
      SQUARE_ROOM,
    );
    expect(invalid).toHaveLength(0);
  });

  it("rejects a point outside a simple square room and reports the index", () => {
    const invalid = validatePlacementsInPolygon(
      [
        { positionX: 5, positionZ: 5 },
        { positionX: 15, positionZ: 5 },
      ],
      SQUARE_ROOM,
    );
    expect(invalid).toEqual([{ index: 1, positionX: 15, positionZ: 5 }]);
  });

  it("uses positionZ (not positionY) as the polygon's y axis", () => {
    // positionY is vertical height in 3D — it must NOT affect in-polygon
    // containment. Changing positionZ crosses the boundary; changing
    // positionY alone does not.
    const outsideByZ = validatePlacementsInPolygon(
      [{ positionX: 5, positionZ: 15 }],
      SQUARE_ROOM,
    );
    expect(outsideByZ).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The headline regression: L-shaped room, bbox would have said "inside"
  // -------------------------------------------------------------------------

  it("REGRESSION: rejects a point inside the L-room's bbox but in the carved-out corner", () => {
    // (7, 7) — well inside the 10×10 bounding box, but outside the L-shape
    // because the top-right quadrant has been carved away.
    const point = { positionX: 7, positionZ: 7 };

    // Sanity check: a naive bbox test would have ACCEPTED this point.
    const bboxWouldAccept = point.positionX >= 0 && point.positionX <= 10
      && point.positionZ >= 0 && point.positionZ <= 10;
    expect(bboxWouldAccept).toBe(true);

    // The polygon check correctly rejects it.
    const invalid = validatePlacementsInPolygon([point], L_SHAPED_ROOM);
    expect(invalid).toEqual([{ index: 0, positionX: 7, positionZ: 7 }]);
  });

  it("accepts a point in the L-room's occupied arm (bottom strip, x ∈ [0..10] at z=2)", () => {
    const invalid = validatePlacementsInPolygon(
      [{ positionX: 7, positionZ: 2 }],
      L_SHAPED_ROOM,
    );
    expect(invalid).toHaveLength(0);
  });

  it("accepts a point in the L-room's occupied arm (left strip, x=2 at z=7)", () => {
    const invalid = validatePlacementsInPolygon(
      [{ positionX: 2, positionZ: 7 }],
      L_SHAPED_ROOM,
    );
    expect(invalid).toHaveLength(0);
  });

  it("rejects mixed-validity batches and lists every bad index", () => {
    const invalid = validatePlacementsInPolygon(
      [
        { positionX: 2, positionZ: 2 }, // ok (bottom arm)
        { positionX: 7, positionZ: 7 }, // BAD (carved corner)
        { positionX: 2, positionZ: 7 }, // ok (left arm)
        { positionX: 9, positionZ: 9 }, // BAD (carved corner)
        { positionX: -1, positionZ: 5 }, // BAD (outside bbox entirely)
      ],
      L_SHAPED_ROOM,
    );
    expect(invalid.map((i) => i.index)).toEqual([1, 3, 4]);
  });

  it("returns an empty list for an empty placement batch", () => {
    expect(validatePlacementsInPolygon([], SQUARE_ROOM)).toHaveLength(0);
  });

  it("rejects every placement when the polygon is degenerate (< 3 points)", () => {
    // pointInPolygon returns false for degenerate polygons; every placement
    // fails. The outline-validation on write (Zod .min(3)) prevents this
    // from ever reaching the DB — this test pins the defensive behaviour
    // if it ever did.
    const invalid = validatePlacementsInPolygon(
      [{ positionX: 0, positionZ: 0 }, { positionX: 1, positionZ: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    );
    expect(invalid.map((i) => i.index)).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Response body shape
// ---------------------------------------------------------------------------

describe("placementOutOfBoundsBody", () => {
  it("builds the canonical 422 body from an invalid list", () => {
    const body = placementOutOfBoundsBody([
      { index: 2, positionX: 7, positionZ: 7 },
    ]);
    expect(body.code).toBe(PLACEMENT_OUT_OF_BOUNDS_CODE);
    expect(body.details.invalid).toHaveLength(1);
    expect(body.details.invalid[0]).toEqual({
      index: 2,
      positionX: 7,
      positionZ: 7,
    });
  });
});
