// ---------------------------------------------------------------------------
// The Grand Hall's stored size, from the hall's laser scan
//
// The Matterport E57 capture of 11 July 2026 measures the Grand Hall's
// panelled interior at 21.135 m along x (the fireplace wall to the far end
// wall) by 10.59 m along z (the window wall to the door wall), about ±2 cm
// (packages/web/src/components/grand-hall/hall-spec.ts, HALL_LENGTH and
// HALL_WIDTH; tools/grand-hall-survey/README.md records the method). The
// planner draws the hall at this size and, since #391, places and bounds
// every piece on the same 21.135 x 10.59 m outline
// (packages/web/src/data/room-geometries.ts), which the stored outline below
// contains. A layout save refuses any piece centred outside the stored outline
// (lib/placement-validation.ts), so the stored room must contain every centre
// the planner lets a person place. Blake, 11 November 2026: "Use the
// measurements captured from the lidar /e57 data".
//
// spaces.width_m and spaces.length_m are numeric(6,2) and are the outline's x
// and y extents (db/schema.ts), so the hall's length is widthM here and its
// width lengthM. 21.135 is stored as 21.14: rounded up, so the room never
// shrinks.
//
// heightM is the hall's clear height: the scan's floor to the underside of the
// coffered ceiling, 6.70 m (hall-spec.ts, HALL_HEIGHT), the ceiling over about
// 85% of the floor. The dome rises from a gilt ring 3.32 m in radius at the
// centre of that ceiling to its crown at 8.93 m (hall-spec.ts, HALL_DOME). It
// is described as the dome, never as the room's height: a room called 8.93 m
// high promises headroom that only its centre has. Production stored 7.00 m,
// which is neither. Blake, 11 November 2026: "Remember the height will change
// based on if it's measuring the dome or the regular ceiling. Do what you
// think is best."
//
// Migration *_grand_hall_e57_interior writes these to production's row; the
// seed builds local and test databases from them.
// ---------------------------------------------------------------------------

export const GRAND_HALL_E57_INTERIOR = { widthM: 21.14, lengthM: 10.59, heightM: 6.7 } as const;
