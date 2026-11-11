// ---------------------------------------------------------------------------
// The Grand Hall's stored floor, from the hall's laser scan
//
// The Matterport E57 capture of 11 July 2026 measures the Grand Hall's
// panelled interior at 21.135 m along x (the fireplace wall to the far end
// wall) by 10.59 m along z (the window wall to the door wall), about ±2 cm
// (packages/web/src/components/grand-hall/hall-spec.ts, HALL_LENGTH and
// HALL_WIDTH; tools/grand-hall-survey/README.md records the method). The
// planner's 3D model is drawn at this size; its placement check uses the
// hand-drawn 21 x 10.5 m polygon, which this contains. A layout save refuses
// any piece centred outside the stored outline (lib/placement-validation.ts),
// so the stored room must contain every centre the planner lets a person
// place. Blake, 11 November 2026: "Use the measurements captured from the
// lidar /e57 data".
//
// spaces.width_m and spaces.length_m are numeric(6,2) and are the outline's x
// and y extents (db/schema.ts), so the hall's length is widthM here and its
// width lengthM. 21.135 is stored as 21.14: rounded up, so the room never
// shrinks. Height is not here. The scan's 6.7 m is the underside of the
// coffered ceiling, with the dome above it, and which of those height_m means
// is still open.
//
// Migration *_grand_hall_e57_interior writes these to production's row; the
// seed builds local and test databases from them.
// ---------------------------------------------------------------------------

export const GRAND_HALL_E57_INTERIOR = { widthM: 21.14, lengthM: 10.59 } as const;
