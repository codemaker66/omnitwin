import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { PlannerSpatialHud } from "../PlannerSpatialHud.js";

function resetStore(): void {
  usePlacementStore.setState({
    placedItems: [],
    undoStack: [],
    redoStack: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
}

describe("PlannerSpatialHud", () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it("summarizes the current layout with real counts", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const trestle = getCatalogueItemBySlug("trestle-6ft");
    const chair = getCatalogueItemBySlug("banquet-chair");
    expect(roundTable).toBeDefined();
    expect(trestle).toBeDefined();
    expect(chair).toBeDefined();
    if (roundTable === undefined || trestle === undefined || chair === undefined) return;

    usePlacementStore.setState({
      placedItems: [
        { ...createPlacedItem(roundTable.id, 0, 0, 0), clothed: true, clothStyle: "white", tableSetting: "dinner" },
        createPlacedItem(trestle.id, 2, 0, 0),
        createPlacedItem(chair.id, 0.5, 0.5, 0),
        createPlacedItem(chair.id, -0.5, 0.5, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByTestId("planner-spatial-hud")).toBeDefined();
    expect(screen.getByText("1 round table")).toBeDefined();
    expect(screen.getByText("1 trestle")).toBeDefined();
    expect(screen.getByText("2 chairs")).toBeDefined();
    expect(screen.getByText("1 table dressed")).toBeDefined();
  });

  it("renders a neutral empty-state capacity caption", () => {
    render(<PlannerSpatialHud />);

    expect(screen.getByText("Start placing furniture to build capacity")).toBeDefined();
    expect(screen.getByText("No dressed tables yet")).toBeDefined();
  });

  it("counts staged objects separately from chairs and tables", () => {
    const platform = getCatalogueItemBySlug("platform");
    expect(platform).toBeDefined();
    if (platform === undefined) return;
    usePlacementStore.setState({ placedItems: [createPlacedItem(platform.id, 0, 0, 0)] });

    render(<PlannerSpatialHud />);

    expect(screen.getByText("1 object")).toBeDefined();
  });
});
