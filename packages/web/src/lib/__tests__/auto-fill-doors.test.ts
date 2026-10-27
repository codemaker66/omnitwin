import { describe, expect, it } from "vitest";
import {
  autoFillBasis,
  planAutoFill,
  roomAtSpacingLine,
  type AutoFillPlan,
  type PublishedFigure,
} from "../auto-fill.js";
import { getCatalogueItem } from "../catalogue.js";
import { computeRotatedFootprint } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES, doorKeepOuts, footprintInSpace, type Footprint } from "../door-clear-spaces.js";
import { PUBLISHED_CAPACITY_LABEL } from "../planner-truth.js";

// The Grand Hall as the planner opens it (21 × 10.5 m) with its four doors'
// clear spaces. The counts are worked by hand:
//
// Banquet rounds (6 ft rounds of ten, 0.6 m behind every chair): the 14-round
// stagger has its door-side row's rounds at x −8.34, 0 and 8.34, in front of
// the fireplace, main and end doors, and its window row's x −8.34 round
// reaches x −9.90, into the fire exit's space (to −9.0675). The 5 × 2 grid at
// z ±1.86 reaches z 3.42 (the spaces start at 3.795) and x −9.00, so its ten
// rounds clear every door: 10 rounds, 100 seats, against 14 and 140.
//
// Theatre (Turini chairs 0.42 × 0.58, rows of 14 facing the fireplace end,
// 20 rows): the door-side block's two outer chairs, at z 4.11 and 3.59, reach
// z 4.32 and 3.80, into a door's space in the rows at x −8.1 (fireplace
// door), −0.9, 0 and 0.9 (main door), 8.1 and 9.0 (end door): 12 of 280.

const HALL_W = 21;
const HALL_L = 10.5;
const DOORS = doorKeepOuts(GRAND_HALL_DOOR_CLEAR_SPACES);
const DINNER: PublishedFigure = { figure: 180, format: "dinner", source: PUBLISHED_CAPACITY_LABEL };
const THEATRE: PublishedFigure = { figure: 250, format: "theatre", source: PUBLISHED_CAPACITY_LABEL };

function plan(style: "dinner-rounds" | "theatre", guests: number, doors = DOORS): AutoFillPlan {
  const planned = planAutoFill(style, guests, HALL_W, HALL_L, doors);
  if (planned === null) throw new Error(`no ${style} plan`);
  return planned;
}

/** Every piece the store would place for a plan, as the planner's overlap rule sees it. */
function placedFootprints(planned: AutoFillPlan): readonly Footprint[] {
  const footprints: Footprint[] = [];
  const add = (catalogueItemId: string, x: number, z: number, rotationY: number): void => {
    const item = getCatalogueItem(catalogueItemId);
    if (item === undefined) throw new Error(`no catalogue item ${catalogueItemId}`);
    const { halfW, halfD } = computeRotatedFootprint(item, rotationY);
    footprints.push({ x, z, halfW, halfD });
  };
  if (planned.style === "theatre") {
    for (const seat of planned.seats) add(planned.chairItemId, seat.xM, seat.zM, seat.rotationY);
  } else {
    for (const table of planned.tables) {
      for (const piece of createTableGroup(planned.tableItemId, table.xM, table.zM, table.rotationY, planned.seatsPerTable)) {
        add(piece.catalogueItemId, piece.x, piece.z, piece.rotationY);
      }
    }
  }
  return footprints;
}

function inAnyDoorSpace(footprints: readonly Footprint[]): number {
  return footprints.filter((footprint) => GRAND_HALL_DOOR_CLEAR_SPACES.some((space) => footprintInSpace(footprint, space))).length;
}

describe("Banquet rounds keep the Grand Hall's doors clear", () => {
  it("sets no table or chair in front of a door", () => {
    const filled = plan("dinner-rounds", 0);
    expect(filled.style === "dinner-rounds" ? filled.tableCount : null).toBe(10);
    expect(inAnyDoorSpace(placedFootprints(filled))).toBe(0);
  });

  it("would have set chairs in front of the doors without the rule", () => {
    // The check above can fail: the room's full stagger blocks them.
    expect(inAnyDoorSpace(placedFootprints(plan("dinner-rounds", 0, [])))).toBeGreaterThan(0);
  });

  it("says how many fit with the doors kept clear, of the guests asked", () => {
    const filled = plan("dinner-rounds", 120);
    expect(filled.roomForSeats).toBe(100);
    expect(roomAtSpacingLine(filled, DINNER))
      .toBe("Room for 100 of the 120 guests with the doors kept clear; the venue publishes 180 for a seated dinner.");
  });

  it("says when the spacing and the doors both limit the room", () => {
    expect(roomAtSpacingLine(plan("dinner-rounds", 180), DINNER))
      .toBe("Room for 100 of the 180 guests at this spacing with the doors kept clear; the venue publishes 180 for a seated dinner.");
  });

  it("says nothing more when the doors cost no seat asked for", () => {
    expect(roomAtSpacingLine(plan("dinner-rounds", 90), DINNER)).toBeNull();
  });

  it("names the doors in the spacing it used", () => {
    expect(autoFillBasis(plan("dinner-rounds", 90))).toBe("Rounds of 10, with 0.6 m clear behind every chair and the doors kept clear.");
  });

  it("claims nothing about doors in a room whose doors are not recorded", () => {
    const filled = plan("dinner-rounds", 120, []);
    expect(autoFillBasis(filled)).toBe("Rounds of 10, with 0.6 m clear behind every chair.");
    expect(roomAtSpacingLine(filled, DINNER)).toBeNull();
    expect(roomAtSpacingLine(plan("dinner-rounds", 180, []), DINNER))
      .toBe("Room for 140 at this spacing; the venue publishes 180 for a seated dinner.");
  });
});

describe("Theatre rows keep the Grand Hall's doors clear", () => {
  it("leaves the chairs in front of the doors out", () => {
    const filled = plan("theatre", 0);
    expect(filled.chairs).toBe(268);
    expect(inAnyDoorSpace(placedFootprints(filled))).toBe(0);
  });

  it("adds a row to reach the guests asked when the doors take seats", () => {
    const filled = plan("theatre", 250);
    expect(filled.style === "theatre" ? [filled.rows, filled.chairs] : null).toEqual([19, 256]);
  });

  it("says how many fit with the doors kept clear", () => {
    expect(roomAtSpacingLine(plan("theatre", 280), THEATRE))
      .toBe("Room for 268 of the 280 guests with the doors kept clear; the venue publishes 250 for theatre.");
  });

  it("names the doors in the spacing it used", () => {
    expect(autoFillBasis(plan("theatre", 100)))
      .toBe("Rows 0.9 m apart, a 1.1 m centre aisle, 2.4 m clear at the front and the doors kept clear.");
  });
});
