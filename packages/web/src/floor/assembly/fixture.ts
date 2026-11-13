// ---------------------------------------------------------------------------
// A 180-seat dinner in the Grand Hall, laid out deterministically, with every
// door's clear space kept empty.
//
// Fifteen 6 ft rounds of twelve (the planner's default white-linen round and
// Turini banquet chair, chairs on the planner's own ring from
// computeChairPositions) on the hall's measured frame (hall-spec.ts: x along
// the length from the fireplace, z across from the windows to the doors,
// origin at the centre of the floor). 180 is the venue's published dinner
// capacity for the Grand Hall (trades-hall-venue-truth). Ten a round is the
// usual and stays the planner's default; twelve is the most a 6 ft round takes
// (Blake, 28 Oct 2026: "we can sit 12 a table, but 10 is the average").
//
// Each round with its chairs needs a 3.09 m circle. Eighteen rounds of ten fill
// the 21.14 x 10.59 m floor only by standing in front of all four doors, and
// every door keeps 1.5 m of clear floor in front of it, its width and 0.3 m
// past each side (Blake, 27-28 Oct: "keep firedoors clean"). So three rows:
// - six across the middle, Table 1 among them on the centre line in front of
//   the fireplace: the top table and the composition's anchor;
// - five along the windows, the corner by the fire exit left open;
// - four on the door side, two between the fireplace and main doors and two
//   between the main and end doors, each at least 0.29 m from a clear space.
// The rows leave a 0.91 m aisle from the main door (under the clock, x = 0) to
// the centre window, 0.42 m between the outer chairs and the end walls and
// 0.35 m to the long walls; chair backs between neighbouring rounds are at
// least 0.21 m apart, the 11-foot-centre standard of a full banqueting hall.
//
// Ids, groups and labels are fixed strings, so every run (the Grand Assembly
// studies, the 180-seat frame-cost runs) loads the identical layout.
// ---------------------------------------------------------------------------

import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { computeChairPositions } from "../../lib/table-group.js";
import { DEFAULT_PLANNER_ROUND_TABLE_SLUG, UNASKED_PLANNER_CHAIR_SLUG } from "../../lib/furniture-defaults.js";

/** The rows across the hall's width (z), window side first, each with its table centres along the length (x), fireplace end first. */
export const DINNER_ROWS: readonly { readonly z: number; readonly x: readonly number[] }[] = [
  { z: -3.4, x: [-5.3, -2.0, 2.0, 5.3, 8.6] },
  { z: 0, x: [-8.6, -5.3, -2.0, 2.0, 5.3, 8.6] },
  { z: 3.4, x: [-6.2, -2.85, 2.85, 6.2] },
];
/** Table 1: the top round, on the centre line in front of the fireplace. */
export const DINNER_ANCHOR = { x: -8.6, z: 0 } as const;
export const DINNER_SEATS_PER_TABLE = 12;

export interface DinnerTablePosition {
  readonly number: number;
  readonly x: number;
  readonly z: number;
}

/**
 * The fifteen table positions, numbered as a venue numbers them: Table 1 at
 * the top, then outward from it (nearest first; ties window side first, then
 * fireplace side first).
 */
export function dinnerTablePositions(): readonly DinnerTablePosition[] {
  const cells: { x: number; z: number; distance: number }[] = [];
  for (const row of DINNER_ROWS) {
    for (const x of row.x) {
      cells.push({ x, z: row.z, distance: Math.hypot(x - DINNER_ANCHOR.x, row.z - DINNER_ANCHOR.z) });
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

/** The saved layout: each table followed by its twelve chairs, Table 1 first. Its
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
