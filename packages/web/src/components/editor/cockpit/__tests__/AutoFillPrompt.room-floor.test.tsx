// The Fill prompt in a room whose walls are not a box round the origin (audit
// editor-save-4): the Robert Adam Room. What the button says is what lands,
// and all of it lands inside the walls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../../constants/scale.js";
import { roomGeometries } from "../../../../data/room-geometries.js";
import { getCatalogueItem } from "../../../../lib/catalogue.js";
import { computeRotatedFootprint } from "../../../../lib/placement.js";
import type { PublishedCapacityAnswer } from "../../../../lib/planner-truth.js";
import { plannerRoomOf, rectWithinFloor } from "../../../../lib/room-floor.js";
import { useDoorClearSpaceStore } from "../../../../stores/door-clear-space-store.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../../stores/room-dimensions-store.js";
import { AutoFillPrompt } from "../AutoFillPrompt.js";
import { openRoom, plannerRoom } from "./planner-truth-fixtures.js";

const UNPUBLISHED: PublishedCapacityAnswer = { kind: "not-published" };

const robertAdam = roomGeometries["Robert Adam Room"];
if (robertAdam === undefined) throw new Error("no Robert Adam Room geometry");
const ROOM = plannerRoomOf(robertAdam.wallPolygon, robertAdam.ceilingHeight);

function askFor(guests: number): void {
  fireEvent.change(screen.getByTestId("auto-fill-guests"), { target: { value: String(guests) } });
}

/** Placed pieces any of whose footprint is outside the room's walls. */
function outsideTheWalls(): number {
  const { floor } = ROOM;
  if (floor === undefined) throw new Error("the Robert Adam Room has a floor of its own");
  return usePlacementStore.getState().placedItems.filter((piece) => {
    const item = getCatalogueItem(piece.catalogueItemId);
    if (item === undefined) return true;
    const { halfW, halfD } = computeRotatedFootprint(item, piece.rotationY, piece.scale);
    return !rectWithinFloor(floor, piece.x, piece.z, halfW, halfD);
  }).length;
}

beforeEach(() => {
  // As the room hook leaves the stores for this room: its floor with its size, and no recorded doors.
  useRoomDimensionsStore.setState({ dimensions: ROOM });
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  openRoom(plannerRoom("robert-adam-room", "Robert Adam Room"));
});

afterEach(() => {
  cleanup();
  openRoom(null);
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
});

describe("Fill's prompt in the Robert Adam Room", () => {
  it("says how many rounds the room takes inside its walls, and places exactly those", () => {
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={UNPUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(60);
    expect(screen.getByTestId("auto-fill-short").textContent).toBe("Room for 40 at this spacing.");
    expect(screen.getByTestId("auto-fill-place").textContent).toBe("Place 4 tables and 40 chairs");
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    expect(usePlacementStore.getState().placedItems).toHaveLength(44);
    expect(outsideTheWalls()).toBe(0);
    expect(onPlaced).toHaveBeenCalledTimes(1);
  });

  it("says how many chairs its rows take inside the walls, and places exactly those", () => {
    render(<AutoFillPrompt style="theatre" published={UNPUBLISHED} onPlaced={vi.fn()} onCancel={vi.fn()} />);
    askFor(60);
    expect(screen.getByTestId("auto-fill-place").textContent).toBe("Place 64 chairs in 4 rows");
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    expect(usePlacementStore.getState().placedItems).toHaveLength(64);
    expect(outsideTheWalls()).toBe(0);
  });
});
