// The Fill prompt over a layout (card-dock Q-10; fillKeepOuts): it states the figure the gangway
// design reaches in the room it is in, beside the venue's published one, and the spacing in the
// trade's words, from the same plan the store will lay.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../../constants/scale.js";
import type { PublishedCapacityAnswer } from "../../../../lib/planner-truth.js";
import { setPlannerFeaturesForTesting } from "../../../../lib/planner-features.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../../stores/room-dimensions-store.js";
import { AutoFillPrompt } from "../AutoFillPrompt.js";
import { openRoom, plannerRoom } from "./planner-truth-fixtures.js";

const PUBLISHED: PublishedCapacityAnswer = {
  kind: "published",
  capacity: { theatre: 250, classroom: 120, dinner: 180, reception: 300 },
  source: "Trades Hall's published capacities",
};

function askFor(guests: number): void {
  fireEvent.change(screen.getByTestId("auto-fill-guests"), { target: { value: String(guests) } });
}

beforeEach(() => {
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  openRoom(plannerRoom("grand-hall", "Grand Hall"));
  setPlannerFeaturesForTesting({ fillKeepOuts: true });
});

afterEach(() => {
  cleanup();
  openRoom(null);
  setPlannerFeaturesForTesting(null);
});

describe("Fill's prompt over a layout", () => {
  it("states 110 seats with rounds of 10 beside the 180 the venue publishes, with the gangways in the trade's words", () => {
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={vi.fn()} onCancel={vi.fn()} />);
    askFor(180);
    expect(screen.getByTestId("auto-fill-short").textContent).toBe("Room for 110 at this spacing; the venue publishes 180 for a seated dinner.");
    expect(screen.getByTestId("auto-fill-basis").textContent).toBe("Rounds of 10, with 1.1 m gangways to the doors and 0.6 m clear behind every other chair, after Scottish fire safety guidance.");
  });

  it("places what its button says, as one write", () => {
    const onPlaced = vi.fn();
    render(<AutoFillPrompt style="dinner-rounds" published={PUBLISHED} onPlaced={onPlaced} onCancel={vi.fn()} />);
    askFor(80);
    const label = screen.getByTestId("auto-fill-place").textContent ?? "";
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    const tables = new Set(usePlacementStore.getState().placedItems.map((piece) => piece.groupId)).size;
    expect(label).toBe(`Place ${String(tables)} tables and ${String(usePlacementStore.getState().placedItems.length - tables)} chairs`);
    expect(onPlaced).toHaveBeenCalledTimes(1);
  });
});
