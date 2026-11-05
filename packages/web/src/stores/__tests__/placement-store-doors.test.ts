import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlacementStore } from "../placement-store.js";
import { usePlacementNoticeStore } from "../placement-notice-store.js";
import { subscribeDoorSlides, useDoorClearSpaceStore, type DoorSlideEvent } from "../door-clear-space-store.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createTableGroup } from "../../lib/table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../lib/door-clear-spaces.js";
import { doorBlockers } from "../../lib/keep-doors-clear.js";

// The Grand Hall as the planner opens it, 21 × 10.5 m, with its four doors'
// clear spaces (the main door's x −1.02 to 1.03 from z 3.795; the end
// door's x 7.97 to 9.67). Snapping is on: a piece set down goes to the 1 m
// grid, then flush to a wall within 1.5 m of it.

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}
const ROUND = id("round-table-6ft-white");
const CHAIR = id("burgess-turini-18-3");

function blocked(): number {
  return doorBlockers(usePlacementStore.getState().placedItems, GRAND_HALL_DOOR_CLEAR_SPACES).length;
}

function pieceOf(catalogueItemId: string): PlacedItem {
  const piece = usePlacementStore.getState().placedItems.find((item) => item.catalogueItemId === catalogueItemId);
  if (piece === undefined) throw new Error(`nothing placed of ${catalogueItemId}`);
  return piece;
}

let slides: DoorSlideEvent[] = [];
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  resetPlacedIdCounter();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
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

// Blake, 28 Oct 2026: "keep firedoors clean. let people place tables within the
// red zone but have a warning on it (an aesthetic warning of some kind, not
// something annoying or makes it look bad)". What a person places stays where
// it was put; the floor and DoorClearNotice name the door, and nothing slides.
describe("a piece placed by hand in front of a door stays where it was put", () => {
  function doorsNamed(): readonly (readonly string[])[] {
    return doorBlockers(usePlacementStore.getState().placedItems, GRAND_HALL_DOOR_CLEAR_SPACES).map((blocker) => blocker.doors.map((door) => door.id));
  }

  it("leaves a round set down at the main door there", () => {
    // (0, 3.4) snaps to (0, 3), then flush to the door wall at z 3.691.
    usePlacementStore.getState().placeTableGroup(ROUND, 0, 3.4, 0, 10);
    expect(pieceOf(ROUND).z).toBeCloseTo(3.691, 3);
    expect(doorsNamed()).toEqual([["door-main"]]);
    expect(slides).toEqual([]);
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });

  it("leaves a lone chair at the end door there", () => {
    usePlacementStore.getState().placeItem(CHAIR, 8, 4.8, 0);
    expect(doorsNamed()).toEqual([["door-end"]]);
    expect(slides).toEqual([]);
  });

  it("leaves a card's set where it was set down", () => {
    usePlacementStore.getState().placeSetup(createTableGroup(ROUND, 0, 3.5, 0, 10));
    expect(pieceOf(ROUND).z).toBe(3.5);
    expect(doorsNamed()).toEqual([["door-main"]]);
    expect(slides).toEqual([]);
  });

  it("leaves an edit's pieces where it put them", () => {
    usePlacementStore.getState().placeSetup(createTableGroup(ROUND, 0, 0, 0, 10));
    const moved = usePlacementStore.getState().placedItems.map((piece) => ({ ...piece, z: piece.z + 3.5 }));
    usePlacementStore.getState().applyEdit({ add: moved });
    expect(pieceOf(ROUND).z).toBe(3.5);
    expect(doorsNamed()).toEqual([["door-main"]]);
    expect(slides).toEqual([]);
  });
});

describe("automatic layouts keep the doors clear", () => {
  it("lays out banquet rounds with nothing in front of a door", () => {
    const plan = usePlacementStore.getState().autoArrangeBanquet(ROUND, 0, 10);
    expect([plan?.tableCount, plan?.doorsKeptClear]).toEqual([10, true]);
    expect(blocked()).toBe(0);
  });

  it("lays out theatre rows with the seats in front of the doors left out", () => {
    const plan = usePlacementStore.getState().autoArrangeTheatre(CHAIR, 0);
    expect(plan?.chairs).toBe(268);
    expect(blocked()).toBe(0);
  });

  it("sets theatre rows past one kind's stock in the hall's chairs, front rows the event's, each within what the hall owns", () => {
    // Blake, 28 Oct 2026: "for the grand hall we normally use the pink chair, then the checked chair, then the red with gold legs chair."
    const plan = usePlacementStore.getState().autoArrangeTheatre(CHAIR, 250);
    expect(plan?.meetsTarget).toBe(true);
    const placed = usePlacementStore.getState().placedItems;
    expect(placed).toHaveLength(plan?.chairs ?? -1);
    const counts = new Map<string, number>();
    for (const piece of placed) counts.set(piece.catalogueItemId, (counts.get(piece.catalogueItemId) ?? 0) + 1);
    const owned = new Map([[CHAIR, 120], [id("checked-banquet-chair"), 106], [id("gallery-chair-red-gold"), 107]]);
    expect([...counts.keys()].every((chairId) => owned.has(chairId))).toBe(true);
    for (const [chairId, count] of counts) expect(count).toBeLessThanOrEqual(owned.get(chairId) ?? 0);
    expect(counts.size).toBeGreaterThan(1);
    expect(placed[0]?.catalogueItemId).toBe(CHAIR);
    expect(blocked()).toBe(0);
  });

  it("adds the tables a guest count is short of clear of the doors", () => {
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, -0.75, 0, 10)] });
    const fix = usePlacementStore.getState().fillSeatShortfall(20);
    expect(fix?.offer.kind).toBe("tables");
    expect(blocked()).toBe(0);
  });

  it("keeps no doors in a room whose doors are not recorded, and says nothing of them", () => {
    useDoorClearSpaceStore.getState().setRoomSpaces(null);
    const plan = usePlacementStore.getState().autoArrangeBanquet(ROUND, 0, 10);
    expect([plan?.tableCount, plan?.doorsKeptClear]).toEqual([14, false]);
  });
});

describe("the chair brush, laying a row itself, keeps the doors clear", () => {
  it("leaves the brushed chairs out of a door's space", () => {
    const ids = usePlacementStore.getState().placeChairBrush(CHAIR, -3, 4, 3, 4, 0);
    expect(ids.length).toBeGreaterThan(0);
    expect(blocked()).toBe(0);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
  });
});
