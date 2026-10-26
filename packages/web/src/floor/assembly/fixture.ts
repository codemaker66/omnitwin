// ---------------------------------------------------------------------------
// A 180-seat dinner in the Grand Hall, laid out deterministically.
//
// Eighteen 6 ft rounds of ten (the planner's default white-linen round and
// Turini banquet chair, chairs on the planner's own ring from
// computeChairPositions), three rows of six on the hall's measured frame
// (hall-spec.ts: x along the length from the fireplace, z across from the
// windows to the doors, origin at the centre of the floor).
//
// The hall is at capacity with 180 in rounds of ten: each round with its
// chairs needs a 3.09 m circle, so only a 6 x 3 grid fits the 21.14 x 10.59 m
// floor. The grid leaves a 0.91 m aisle from the main door (under the clock,
// x = 0) to the centre window, 0.42 m between the outer chairs and the end
// walls and 0.35 m to the long walls; chair backs between neighbouring rounds
// are 0.21 m (across the length) and 0.31 m (across the width) apart, the
// 11-foot-centre standard of a full banqueting hall. There is no room for a
// separate long top table as well, so Table 1, the round on the centre line in
// front of the fireplace, is the top table and the composition's anchor.
//
// Ids, groups and labels are fixed strings, so every run (the Grand Assembly
// studies, the 180-seat frame-cost runs) loads the identical layout.
// ---------------------------------------------------------------------------

import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { computeChairPositions } from "../../lib/table-group.js";
import { DEFAULT_PLANNER_ROUND_TABLE_SLUG, UNASKED_PLANNER_CHAIR_SLUG } from "../../lib/furniture-defaults.js";

/** Table centres across the hall's length (x), fireplace end first. */
export const DINNER_COLUMNS_X = [-8.6, -5.3, -2.0, 2.0, 5.3, 8.6] as const;
/** Table centres across its width (z), window side first. */
export const DINNER_ROWS_Z = [-3.4, 0, 3.4] as const;
/** Table 1: the top round, on the centre line in front of the fireplace. */
export const DINNER_ANCHOR = { x: -8.6, z: 0 } as const;
export const DINNER_SEATS_PER_TABLE = 10;

export interface DinnerTablePosition {
  readonly number: number;
  readonly x: number;
  readonly z: number;
}

/**
 * The eighteen table positions, numbered as a venue numbers them: Table 1 at
 * the top, then outward from it (nearest first; ties window side first, then
 * fireplace side first).
 */
export function dinnerTablePositions(): readonly DinnerTablePosition[] {
  const cells: { x: number; z: number; distance: number }[] = [];
  for (const x of DINNER_COLUMNS_X) {
    for (const z of DINNER_ROWS_Z) {
      cells.push({ x, z, distance: Math.hypot(x - DINNER_ANCHOR.x, z - DINNER_ANCHOR.z) });
    }
  }
  cells.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  return cells.map((cell, index) => ({ number: index + 1, x: cell.x, z: cell.z }));
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Table n's id; its chairs are `${tableId}-seat-NN` and its group `ga-group-NN`. */
export function dinnerTableId(number: number): string {
  return `ga-table-${twoDigits(number)}`;
}

/** The saved layout: each table followed by its ten chairs, Table 1 first. Its
 *  chair is fixed, not the event's, so every run loads the identical layout. */
export function grandHallDinner180(): PlacedItem[] {
  const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
  const chair = getCatalogueItemBySlug(UNASKED_PLANNER_CHAIR_SLUG);
  if (table === undefined || chair === undefined) {
    throw new Error("The planner's default round table and chair are missing from the catalogue");
  }
  const items: PlacedItem[] = [];
  for (const position of dinnerTablePositions()) {
    const tableId = dinnerTableId(position.number);
    const groupId = `ga-group-${twoDigits(position.number)}`;
    items.push({
      id: tableId,
      catalogueItemId: table.id,
      label: `Table ${String(position.number)}`,
      x: position.x,
      y: 0,
      z: position.z,
      rotationY: 0,
      clothed: false,
      clothStyle: null,
      tableSetting: null,
      groupId,
    });
    const seats = computeChairPositions(position.x, position.z, table, 0, DINNER_SEATS_PER_TABLE, undefined, chair);
    if (seats.length !== DINNER_SEATS_PER_TABLE) {
      throw new Error(`A ${table.slug} seats ${String(seats.length)}, not ${String(DINNER_SEATS_PER_TABLE)}`);
    }
    seats.forEach((seat, index) => {
      items.push({
        id: `${tableId}-seat-${twoDigits(index + 1)}`,
        catalogueItemId: chair.id,
        label: "",
        x: seat.x,
        y: 0,
        z: seat.z,
        rotationY: seat.rotationY,
        clothed: false,
        clothStyle: null,
        tableSetting: null,
        groupId,
      });
    });
  }
  return items;
}
