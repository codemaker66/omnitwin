import { eq } from "drizzle-orm";
import { pointInPolygon, type FloorPlanPoint } from "@omnitwin/types";
import { spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Placement validation — does a 3D-space (x, y, z) position fall inside the
// 2D polygonal outline of the room?
//
// Coordinate mapping: placed-object positions are 3D where `positionY` is
// vertical height and `positionZ` is floor-plan depth. The space outline is
// 2D in floor-plan coordinates where the polygon's `y` axis is depth. So
// the containment check is:
//
//     pointInPolygon({ x: positionX, y: positionZ }, outline)
//
// `positionY` (height) is orthogonal to the floor plan and doesn't affect
// containment — it lets objects be stacked or suspended vertically without
// leaving the room footprint.
//
// Why the polygon, not a bounding box: bbox is a necessary-but-not-sufficient
// test. For non-convex rooms (L-shaped, galleries with wings, the Trades Hall
// saloon's stage alcove) the bbox includes exterior wall corners that are
// not part of the floor. `pointInPolygon` via ray-casting correctly rejects
// those; the bbox does not.
// ---------------------------------------------------------------------------

export interface PlacementCandidate {
  readonly positionX: number;
  readonly positionZ: number;
}

export interface InvalidPlacement {
  readonly index: number;
  readonly positionX: number;
  readonly positionZ: number;
}

/**
 * Returns the list of placements whose (x, z) lies outside the polygon.
 * `index` is the position of the placement in the input array — preserved
 * so batch callers can report exactly which rows failed.
 */
export function validatePlacementsInPolygon(
  placements: readonly PlacementCandidate[],
  outline: readonly FloorPlanPoint[],
): readonly InvalidPlacement[] {
  const invalid: InvalidPlacement[] = [];
  for (const [index, p] of placements.entries()) {
    if (!pointInPolygon({ x: p.positionX, y: p.positionZ }, outline)) {
      invalid.push({ index, positionX: p.positionX, positionZ: p.positionZ });
    }
  }
  return invalid;
}

/**
 * Loads the floor-plan outline for a space. Returns `null` if the space
 * doesn't exist (e.g. soft-deleted or bad id), so the caller can return
 * the right 404 for its context.
 *
 * The outline column is jsonb; the shape is guaranteed by the write-path
 * Zod validation in `routes/spaces.ts` and the bbox-invariant migration
 * (0007_polygon_bbox_invariant), so an unchecked cast is safe at read time.
 */
export async function loadSpacePolygon(
  db: Database,
  spaceId: string,
): Promise<readonly FloorPlanPoint[] | null> {
  const [row] = await db.select({ outline: spaces.floorPlanOutline })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (row === undefined) return null;
  return row.outline as readonly FloorPlanPoint[];
}

// ---------------------------------------------------------------------------
// Standard 422 response body — shared by every write path so the admin UI
// and public editor parse a single shape.
// ---------------------------------------------------------------------------

export const PLACEMENT_OUT_OF_BOUNDS_CODE = "PLACEMENT_OUT_OF_BOUNDS";

export interface PlacementOutOfBoundsResponse {
  readonly error: string;
  readonly code: typeof PLACEMENT_OUT_OF_BOUNDS_CODE;
  readonly details: { readonly invalid: readonly InvalidPlacement[] };
}

export function placementOutOfBoundsBody(
  invalid: readonly InvalidPlacement[],
): PlacementOutOfBoundsResponse {
  return {
    error: "One or more placements fall outside the space's floor plan.",
    code: PLACEMENT_OUT_OF_BOUNDS_CODE,
    details: { invalid },
  };
}
