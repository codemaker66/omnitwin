import { describe, expect, it } from "vitest";
import type { PlacedItem } from "../../../lib/placement.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES, type FloorRect } from "../../../lib/door-clear-spaces.js";
import { doorBlockers, doorsBlockedByAny, placedFootprint } from "../../../lib/keep-doors-clear.js";
import { grandHallDinner180 } from "../fixture.js";

// ---------------------------------------------------------------------------
// The Grand Assembly's dinner, as it loads today, keeps every Grand Hall door
// clear by the planner's own door rule (Blake, 28 Oct 2026: "keep firedoors
// clean"): no piece stands in a door's clear space, so the floor never glows
// and the door notice never speaks over the demo. Judged piece by piece, as
// the notice and the floor judge a layout.
// ---------------------------------------------------------------------------

const layout: readonly PlacedItem[] = grandHallDinner180();

/** How far a piece's footprint stands from a clear space, metres; 0 when they meet or overlap. */
function gapToSpace(piece: PlacedItem, rect: FloorRect): number {
  const footprint = placedFootprint(piece);
  if (footprint === null) return Number.POSITIVE_INFINITY;
  const dx = Math.max(rect.minX - (footprint.x + footprint.halfW), (footprint.x - footprint.halfW) - rect.maxX, 0);
  const dz = Math.max(rect.minZ - (footprint.z + footprint.halfD), (footprint.z - footprint.halfD) - rect.maxZ, 0);
  return Math.hypot(dx, dz);
}

describe("the live Grand Assembly dinner and the Grand Hall's doors", () => {
  it("leaves every door's clear space empty", () => {
    expect(GRAND_HALL_DOOR_CLEAR_SPACES).toHaveLength(4);
    expect(doorsBlockedByAny(layout, GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(doorBlockers(layout, GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
  });

  it("stands at least 0.29 m from every clear space, as the fixture says", () => {
    const nearest = Math.min(...layout.flatMap((piece) => GRAND_HALL_DOOR_CLEAR_SPACES.map((space) => gapToSpace(piece, space.rect))));
    expect(nearest).toBeGreaterThanOrEqual(0.29);
  });
});
