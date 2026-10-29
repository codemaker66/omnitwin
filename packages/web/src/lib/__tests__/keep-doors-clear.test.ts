import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../door-clear-spaces.js";
import {
  DOOR_FLOOR_BLOCKED,
  DOOR_FLOOR_FAINT,
  doorBlockedLine,
  doorBlockers,
  doorFloorStrengths,
  doorSlideForPieces,
  doorsBlockedByAny,
  placedFootprint,
} from "../keep-doors-clear.js";

// The Grand Hall (21 × 10.5 m) with its four doors' clear spaces: the main
// door's from z 3.795 to the wall, x −1.02 to 1.03; the end door's x 7.97 to
// 9.67; the fire exit's x to −9.0675, z −4.065 to −2.405 (hall-spec).

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}
const ROUND = id("round-table-6ft-white");
const CHAIR = id("burgess-turini-18-3");
const HALL = { spaces: GRAND_HALL_DOOR_CLEAR_SPACES, roomWidthM: 21, roomLengthM: 10.5 } as const;

function round(x: number, z: number, label?: string): PlacedItem[] {
  return createTableGroup(ROUND, x, z, 0, 10).map((piece) => (
    label !== undefined && piece.catalogueItemId === ROUND ? { ...piece, label } : piece
  ));
}

describe("a placed piece's footprint", () => {
  it("is the planner's rotated footprint, in metres", () => {
    // The Turini chair is 0.42 m wide and 0.58 m deep.
    expect(placedFootprint(createPlacedItem(CHAIR, 1, 2, 0))).toEqual({ x: 1, z: 2, halfW: 0.21, halfD: 0.29 });
  });

  it("is nothing for a cloth waiting to be laid", () => {
    expect(placedFootprint(createPlacedItem(id("black-table-cloth"), 0, 4.5, 0))).toBeNull();
  });
});

describe("sliding a table and its chairs clear of a door", () => {
  it("moves the whole group back from the main door by whole metres on the grid", () => {
    // At z 3 the chairs facing the door reach about 4.5; at z 2 they stop short of 3.795.
    const group = round(0, 3);
    const slide = doorSlideForPieces(group, group, HALL, 1);
    expect(slide.kind === "slide" ? [slide.dx, slide.dz, slide.doors.map((door) => door.id)] : null).toEqual([0, -1, ["door-main"]]);
  });

  it("leaves a group well clear of every door alone", () => {
    const group = round(0, -1);
    expect(doorSlideForPieces(group, group, HALL, 1)).toEqual({ kind: "clear" });
  });
});

describe("how strongly each door's space shows on the floor", () => {
  const spaces = GRAND_HALL_DOOR_CLEAR_SPACES;
  const main = spaces.filter((space) => space.id === "door-main");
  const shown = (strengths: ReadonlyMap<string, number>): readonly (readonly [string, number])[] => [...strengths];

  it("shows every space faintly while a piece is placed or carried, and the one it enters fully", () => {
    expect(shown(doorFloorStrengths({ spaces, placing: true, carrying: false, entered: main }))).toEqual([
      ["door-end", DOOR_FLOOR_FAINT], ["door-main", 1], ["door-fireplace", DOOR_FLOOR_FAINT], ["door-fire-exit", DOOR_FLOOR_FAINT],
    ]);
    expect(shown(doorFloorStrengths({ spaces, placing: false, carrying: true, entered: [] })).every(([, strength]) => strength === DOOR_FLOOR_FAINT)).toBe(true);
  });

  it("keeps the floor clear of them otherwise, except a door something already blocks", () => {
    expect(shown(doorFloorStrengths({ spaces, placing: false, carrying: false, entered: [] })).every(([, strength]) => strength === 0)).toBe(true);
    expect(doorFloorStrengths({ spaces, placing: false, carrying: false, entered: main }).get("door-main")).toBe(DOOR_FLOOR_BLOCKED);
    expect(doorFloorStrengths({ spaces, placing: false, carrying: false, entered: main }).get("door-end")).toBe(0);
  });
});

describe("pieces already in front of a door", () => {
  const chairAtEndDoor = createPlacedItem(CHAIR, 8.8, 4.8, 0);
  const chairAtFireExit = createPlacedItem(CHAIR, -10.2, -3.2, 0);

  it("finds each table with its chairs, and each lone piece, by the doors' order", () => {
    const layout = [...round(0, 3), chairAtEndDoor, ...round(0, -2)];
    const blockers = doorBlockers(layout, GRAND_HALL_DOOR_CLEAR_SPACES);
    expect(blockers.map((blocker) => [blocker.name, blocker.doors.map((door) => door.id)])).toEqual([
      ["a chair", ["door-end"]],
      ["a round table", ["door-main"]],
    ]);
    expect(blockers[1]?.ids).toHaveLength(11);
  });

  it("names a numbered table by its number", () => {
    expect(doorBlockers(round(0, 3, "Table 4"), GRAND_HALL_DOOR_CLEAR_SPACES)[0]?.name).toBe("Table 4");
  });

  it("finds nothing in a room whose doors are not recorded", () => {
    expect(doorBlockers(round(0, 3), [])).toEqual([]);
  });

  it("lists the doors anything stands in front of, in the room's order", () => {
    const layout = [...round(0, 3), chairAtEndDoor, ...round(0, -2)];
    expect(doorsBlockedByAny(layout, GRAND_HALL_DOOR_CLEAR_SPACES).map((door) => door.id)).toEqual(["door-end", "door-main"]);
    expect(doorsBlockedByAny(round(0, -2), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
  });

  it("says which table stands in front of which door", () => {
    expect(doorBlockedLine(doorBlockers(round(0, 3), GRAND_HALL_DOOR_CLEAR_SPACES), GRAND_HALL_DOOR_CLEAR_SPACES))
      .toBe("A round table is in front of the main door.");
    expect(doorBlockedLine(doorBlockers(round(0, 3, "Table 4"), GRAND_HALL_DOOR_CLEAR_SPACES), GRAND_HALL_DOOR_CLEAR_SPACES))
      .toBe("Table 4 is in front of the main door.");
  });

  it("names both of two, and counts the rest past the first", () => {
    expect(doorBlockedLine(doorBlockers([...round(0, 3), chairAtEndDoor], GRAND_HALL_DOOR_CLEAR_SPACES), GRAND_HALL_DOOR_CLEAR_SPACES))
      .toBe("A chair is in front of the end door, and a round table in front of the main door.");
    expect(doorBlockedLine(doorBlockers([...round(0, 3), chairAtEndDoor, chairAtFireExit], GRAND_HALL_DOOR_CLEAR_SPACES), GRAND_HALL_DOOR_CLEAR_SPACES))
      .toBe("A chair is in front of the end door, and 2 more in front of the main door and the fire exit.");
  });
});
