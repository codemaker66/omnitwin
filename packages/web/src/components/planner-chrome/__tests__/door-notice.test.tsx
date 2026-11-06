import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createTableGroup } from "../../../lib/table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../../lib/door-clear-spaces.js";

// The door rule in the new chrome (lane E, T-679; Blake, 28 Oct 2026: "let
// people place tables within the red zone but have a warning on it"). The
// room and the slate are stood in for: this is about where the notice sits.
vi.mock("../RoomStage.js", () => ({ RoomStage: () => <div data-testid="room-stand-in" /> }));
vi.mock("../Slate.js", () => ({ Slate: () => <div data-testid="slate-stand-in" /> }));
vi.mock("../../editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../../editor/LayoutLiveLayer.js", () => ({ useLayoutLiveRoom: () => undefined }));

const { PlannerChromeV2 } = await import("../PlannerChromeV2.js");

const ROUND_ITEM = getCatalogueItemBySlug("round-table-6ft-white");
if (ROUND_ITEM === undefined) throw new Error("The planner's white 6 ft round is missing from the catalogue");
const ROUND = ROUND_ITEM.id;

beforeEach(() => {
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  useDoorClearSpaceStore.getState().setCarrying(false);
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [] });
});

afterEach(() => {
  cleanup();
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementStore.setState({ placedItems: [] });
});

function zone(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-pc-zone="${name}"]`);
  if (found === null) throw new Error(`no ${name} zone`);
  return found;
}

describe("the door notice in the new chrome", () => {
  it("names a saved layout's table in front of a door in the line above the dock, apart from the slate", () => {
    usePlacementStore.setState({
      placedItems: createTableGroup(ROUND, 0, 3, 0, 10).map((piece) => (piece.catalogueItemId === ROUND ? { ...piece, label: "Table 4" } : piece)),
    });
    render(<PlannerChromeV2 />);
    expect(within(zone("above-dock")).getByTestId("door-clear-notice-line").textContent).toBe("Table 4 is in front of the main door.");
    expect(within(zone("above-dock")).getByRole("button", { name: "Move it clear" })).toBeTruthy();
    expect(within(zone("slate")).queryByTestId("door-clear-notice")).toBeNull();
  });

  it("says nothing while every door is clear", () => {
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, 0, 0, 10)] });
    render(<PlannerChromeV2 />);
    expect(within(zone("above-dock")).queryByTestId("door-clear-notice")).toBeNull();
  });
});
