import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlacementStore } from "../placement-store.js";
import { usePlacementNoticeStore } from "../placement-notice-store.js";
import { subscribeDoorSlides, useDoorClearSpaceStore, type DoorSlideEvent } from "../door-clear-space-store.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";
import { computeSurfaceHeight, createPlacedItem, resetPlacedIdCounter, type PlacedItem } from "../../lib/placement.js";
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

describe("a set slid clear of a door", () => {
  it("keeps a piece standing on its set's riser, settled on the riser where it lands", () => {
    const deckItem = getCatalogueItemBySlug("staging-deck-6x4");
    const lecternItem = getCatalogueItemBySlug("lectern");
    if (deckItem === undefined || lecternItem === undefined) throw new Error("no deck or lectern");
    // In the main door's space (from z 3.795), the lectern on the deck.
    const deck = createPlacedItem(deckItem.id, 0, 4.2, 0, null, 0);
    const onDeck = computeSurfaceHeight(0, 4.2, lecternItem, [deck], new Set());
    expect(onDeck).toBeGreaterThan(0);
    usePlacementStore.getState().placeSetup([deck, createPlacedItem(lecternItem.id, 0, 4.2, 0, null, onDeck)]);
    expect(slides).toHaveLength(1);
    expect(blocked()).toBe(0);
    expect(pieceOf(lecternItem.id).y).toBeCloseTo(onDeck, 9);
    expect(pieceOf(deckItem.id).y).toBe(0);
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

describe("a piece set down in front of a door slides clear", () => {
  it("takes a round set down at the main door back to the nearest clear grid point, and names the door", () => {
    // (0, 3.4) snaps to (0, 3), then flush to the door wall at z 3.691: its
    // chairs reach the wall. At (0, 2) they stop at z 3.545.
    usePlacementStore.getState().placeTableGroup(ROUND, 0, 3.4, 0, 10);
    const table = pieceOf(ROUND);
    expect([table.x, table.z]).toEqual([expect.closeTo(0, 9), expect.closeTo(2, 9)]);
    expect(blocked()).toBe(0);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
    expect(slides).toHaveLength(1);
    expect(slides[0]?.ids).toHaveLength(11);
    expect(slides[0]?.dz).toBeCloseTo(-1.691, 3);
  });

  it("moves a lone chair at the end door to the nearest clear grid point", () => {
    // (8.0, 4.8) snaps to (8, 5), flush to the wall at z 4.96, inside the end
    // door's space. Straight back to (8, 4) is still inside it, and (7, 5)
    // would cross the wall: (7, 4) is the nearest grid point clear.
    usePlacementStore.getState().placeItem(CHAIR, 8, 4.8, 0);
    const chair = pieceOf(CHAIR);
    expect([chair.x, chair.z]).toEqual([expect.closeTo(7, 9), expect.closeTo(4, 9)]);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the end door clear.");
  });

  it("leaves the brushed chairs out of a door's space", () => {
    const ids = usePlacementStore.getState().placeChairBrush(CHAIR, -3, 4, 3, 4, 0);
    expect(ids.length).toBeGreaterThan(0);
    expect(blocked()).toBe(0);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
  });

  it("sets a piece down where it was asked in a room whose doors are not recorded", () => {
    useDoorClearSpaceStore.getState().setRoomSpaces(null);
    usePlacementStore.getState().placeTableGroup(ROUND, 0, 3.4, 0, 10);
    expect(pieceOf(ROUND).z).toBeCloseTo(3.691, 3);
    expect(slides).toHaveLength(0);
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });
});
