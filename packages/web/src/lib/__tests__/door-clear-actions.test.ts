import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { subscribeDoorSlides, useDoorClearSpaceStore, type DoorSlideEvent } from "../../stores/door-clear-space-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem, resetPlacedIdCounter, type PlacedItem } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { planAutoFill } from "../auto-fill.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../door-clear-spaces.js";
import { doorBlockers, placedFootprint } from "../keep-doors-clear.js";
import { moveDoorBlockersClear, slideDropClearOfDoors } from "../door-clear-actions.js";

// The Grand Hall, 21 × 10.5 m, with its four doors' clear spaces (the main
// door's x −1.02 to 1.03 from z 3.795 to the wall).

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}
const ROUND = id("round-table-6ft-white");
const CHAIR = id("burgess-turini-18-3");

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tableAt(x: number, z: number): PlacedItem {
  const table = placed().find((piece) => piece.catalogueItemId === ROUND && Math.abs(piece.x - x) < 1e-6 && Math.abs(piece.z - z) < 1e-6);
  if (table === undefined) throw new Error(`no round at (${String(x)}, ${String(z)})`);
  return table;
}

/** Whether any two pieces of different groups overlap, by the planner's footprints. */
function anyOverlap(pieces: readonly PlacedItem[]): boolean {
  const boxes = pieces.map((piece) => ({ piece, footprint: placedFootprint(piece) }));
  return boxes.some((a, i) => boxes.some((b, j) => j > i && a.footprint !== null && b.footprint !== null
    && (a.piece.groupId === null || a.piece.groupId !== b.piece.groupId)
    && Math.abs(a.footprint.x - b.footprint.x) < a.footprint.halfW + b.footprint.halfW - 1e-3
    && Math.abs(a.footprint.z - b.footprint.z) < a.footprint.halfD + b.footprint.halfD - 1e-3));
}

let slides: DoorSlideEvent[] = [];
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  resetPlacedIdCounter();
  usePlacementStore.setState({ placedItems: [], snapEnabled: true });
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  usePlacementNoticeStore.getState().dismiss();
  slides = [];
  unsubscribe = subscribeDoorSlides((event) => { slides.push(event); });
});

afterEach(() => {
  unsubscribe();
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementNoticeStore.getState().dismiss();
});

describe("a drag let go in front of a door", () => {
  it("slides the table and its chairs back to the nearest clear grid point, and names the door", () => {
    // At (0, 3) the chairs facing the main door reach z 4.5; at (0, 2) they stop at 3.545.
    const group = createTableGroup(ROUND, 0, 3, 0, 10);
    usePlacementStore.setState({ placedItems: group });
    const table = group.find((piece) => piece.catalogueItemId === ROUND);
    expect(slideDropClearOfDoors(new Set(group.map((piece) => piece.id)), table?.id ?? null)).toBe(true);
    expect(tableAt(0, 2).groupId).toBe(table?.groupId);
    expect(doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(slides.map((slide) => [slide.ids.length, slide.dx, slide.dz])).toEqual([[11, 0, -1]]);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
  });

  it("leaves a drop clear of every door where it is", () => {
    const group = createTableGroup(ROUND, 0, 0, 0, 10);
    usePlacementStore.setState({ placedItems: group });
    expect(slideDropClearOfDoors(new Set(group.map((piece) => piece.id)), null)).toBe(false);
    expect(slides).toEqual([]);
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });

  it("does nothing in a room whose doors are not recorded", () => {
    useDoorClearSpaceStore.getState().setRoomSpaces(null);
    const group = createTableGroup(ROUND, 0, 3, 0, 10);
    usePlacementStore.setState({ placedItems: group });
    expect(slideDropClearOfDoors(new Set(group.map((piece) => piece.id)), null)).toBe(false);
    expect(placed()).toEqual(group);
  });
});

describe("moving a saved layout's pieces clear of the doors", () => {
  it("moves each table with its chairs, and each lone piece, to free floor clear of the doors", () => {
    usePlacementStore.setState({
      placedItems: [...createTableGroup(ROUND, 0, 3, 0, 10), createPlacedItem(CHAIR, 8.8, 4.8, 0), ...createTableGroup(ROUND, 0, -1, 0, 10)],
    });
    expect(moveDoorBlockersClear()).toBe(2);
    expect(doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(anyOverlap(placed())).toBe(false);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the end door and the main door clear.");
  });

  it("leaves a table with no free floor nearby where it is, and still names it", () => {
    // The Grand Hall's full stagger of rounds without the doors kept: every
    // round's neighbours stand 0.6 m off, so the four in front of a door have
    // nowhere free to go.
    const plan = planAutoFill("dinner-rounds", 0, 21, 10.5);
    if (plan === null || plan.style !== "dinner-rounds") throw new Error("no fill");
    usePlacementStore.setState({ placedItems: plan.tables.flatMap((table) => createTableGroup(ROUND, table.xM, table.zM, 0, 10)) });
    const was = new Map(placed().map((piece) => [piece.id, `${String(piece.x)},${String(piece.z)}`]));
    const before = doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES).length;
    const moved = moveDoorBlockersClear();
    expect(before).toBe(4);
    // Some had nowhere free to go: those stay exactly where they stood, and are still named.
    expect(moved).toBeLessThan(before);
    const stayed = doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES);
    expect(stayed).toHaveLength(before - moved);
    const now = new Map(placed().map((piece) => [piece.id, `${String(piece.x)},${String(piece.z)}`]));
    for (const id of stayed.flatMap((blocker) => blocker.ids)) expect(now.get(id)).toBe(was.get(id));
    expect(anyOverlap(placed())).toBe(false);
  });
});
