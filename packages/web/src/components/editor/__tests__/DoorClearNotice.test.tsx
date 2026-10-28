import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DoorClearNotice } from "../DoorClearNotice.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useAssemblyRecallStore } from "../../../floor/assembly/recall.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createTableGroup } from "../../../lib/table-group.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../../lib/door-clear-spaces.js";
import { doorBlockers } from "../../../lib/keep-doors-clear.js";

// ---------------------------------------------------------------------------
// A layout saved before the door rule (Blake, 27 Oct 2026: "Keep them clear
// automatically (Recommended)") is never moved by itself: a quiet notice
// names the table and the door, with one tap to move it clear.
// ---------------------------------------------------------------------------

const ROUND_ITEM = getCatalogueItemBySlug("round-table-6ft-white");
// A missing round must fail the file, not make "every door is clear" pass on an unknown id.
if (ROUND_ITEM === undefined) throw new Error("The planner's white 6 ft round is missing from the catalogue");
const ROUND = ROUND_ITEM.id;

/**
 * The Grand Assembly's 180-seat demo dinner as it stood on 28 Oct 2026
 * (floor/assembly/fixture.ts dinnerTablePositions): 18 rounds of ten, metres.
 * Frozen here, so rebuilding that dinner clear of the doors (L3) leaves this
 * test's saved-before-the-rule layout as it was.
 */
const DINNER_28_OCT: readonly { readonly table: number; readonly x: number; readonly z: number }[] = [
  { table: 1, x: -8.6, z: 0 }, { table: 2, x: -5.3, z: 0 }, { table: 3, x: -8.6, z: -3.4 },
  { table: 4, x: -8.6, z: 3.4 }, { table: 5, x: -5.3, z: -3.4 }, { table: 6, x: -5.3, z: 3.4 },
  { table: 7, x: -2, z: 0 }, { table: 8, x: -2, z: -3.4 }, { table: 9, x: -2, z: 3.4 },
  { table: 10, x: 2, z: 0 }, { table: 11, x: 2, z: -3.4 }, { table: 12, x: 2, z: 3.4 },
  { table: 13, x: 5.3, z: 0 }, { table: 14, x: 5.3, z: -3.4 }, { table: 15, x: 5.3, z: 3.4 },
  { table: 16, x: 8.6, z: 0 }, { table: 17, x: 8.6, z: -3.4 }, { table: 18, x: 8.6, z: 3.4 },
];

function dinner28Oct(): PlacedItem[] {
  return DINNER_28_OCT.flatMap(({ table, x, z }) => createTableGroup(ROUND, x, z, 0, 10)
    .map((piece) => (piece.catalogueItemId === ROUND ? { ...piece, label: `Table ${String(table)}` } : piece)));
}

function blockers(): number {
  return doorBlockers(usePlacementStore.getState().placedItems, GRAND_HALL_DOOR_CLEAR_SPACES).length;
}

beforeEach(() => {
  usePlacementStore.setState({ placedItems: [], snapEnabled: true });
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  useDoorClearSpaceStore.getState().setCarrying(false);
  useCatalogueStore.getState().clearSelection();
  useAssemblyRecallStore.setState({ active: false });
  usePlacementNoticeStore.getState().dismiss();
});

afterEach(() => {
  cleanup();
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementNoticeStore.getState().dismiss();
});

describe("the notice on a layout with a table in front of a door", () => {
  it("says nothing while every door is clear", () => {
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, -1, 0, 10)] });
    render(<DoorClearNotice />);
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
  });

  it("names the table and the door, and moves it clear in one tap", () => {
    usePlacementStore.setState({ placedItems: createTableGroup(ROUND, 0, 3, 0, 10).map((piece) => (
      piece.catalogueItemId === ROUND ? { ...piece, label: "Table 4" } : piece
    )) });
    render(<DoorClearNotice />);
    expect(screen.getByTestId("door-clear-notice-line").textContent).toBe("Table 4 stands in front of the main door.");
    fireEvent.click(screen.getByRole("button", { name: "Move it clear" }));
    expect(blockers()).toBe(0);
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
  });

  it("keeps out of the way while a piece is carried or placed, and during the hall's assembly", () => {
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, 3, 0, 10)] });
    render(<DoorClearNotice />);
    expect(screen.getByTestId("door-clear-notice")).toBeTruthy();
    act(() => { useDoorClearSpaceStore.getState().setCarrying(true); });
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
    act(() => { useDoorClearSpaceStore.getState().setCarrying(false); });
    act(() => { useCatalogueStore.getState().selectItem(ROUND); });
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
    act(() => { useCatalogueStore.getState().clearSelection(); });
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
  });

  it("names the Grand Assembly dinner's rounds in front of the doors, and says when there is no free floor for them", () => {
    // The 180-seat demo dinner Blake saw: 18 rounds wall to wall, 0.18 to
    // 0.28 m apart. Table 18 stands in front of the end door, Tables 9 and 12
    // either side of the main door, Table 4 in front of the fireplace door and
    // Table 3 in front of the fire exit; none has free floor to go to.
    usePlacementStore.setState({ placedItems: dinner28Oct() });
    render(<DoorClearNotice />);
    expect(screen.getByTestId("door-clear-notice-line").textContent)
      .toBe("Table 18 stands in front of the end door, and 4 more in front of the main door, the fireplace door and the fire exit.");
    fireEvent.click(screen.getByRole("button", { name: "Move them clear" }));
    expect(blockers()).toBe(5);
    expect(screen.getByTestId("door-clear-notice-stuck").textContent)
      .toBe("There is no free floor near them. Make room beside them, or move them by hand.");
  });

  it("claims nothing in a room whose doors are not recorded", () => {
    useDoorClearSpaceStore.getState().setRoomSpaces(null);
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, 3, 0, 10)] });
    render(<DoorClearNotice />);
    expect(screen.queryByTestId("door-clear-notice")).toBeNull();
  });
});
