import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem } from "../../../lib/placement.js";
import {
  PLANNER_TOOLBAR_COMMAND_EVENT,
  readPlannerToolbarCommand,
  type PlannerToolbarCommand,
} from "../../../lib/planner-toolbar-events.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useMarkupStore } from "../../../stores/markup-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { PlannerCommandDeck } from "../PlannerCommandDeck.js";

function resetPlannerStores(): void {
  useCatalogueStore.setState({
    drawerOpen: false,
    selectedItemId: null,
    activeCategory: "table",
    dragActive: false,
  });
  useMarkupStore.setState({
    active: false,
    strokes: [],
    draftStroke: null,
    selectedColor: "gold",
    selectedWidth: 0.034,
    nextStrokeIndex: 1,
  });
  useBookmarkStore.setState({
    bookmarks: [],
    transition: null,
    nextId: 1,
    pendingNavigationId: null,
    activeReferenceId: null,
  });
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
  useSelectionStore.setState({
    selectedIds: new Set<string>(),
    activeGuides: [],
    marqueeActive: false,
    marqueeStart: null,
    marqueeEnd: null,
    marqueeWorldStart: null,
    marqueeWorldEnd: null,
  });
}

describe("PlannerCommandDeck", () => {
  beforeEach(resetPlannerStores);
  afterEach(() => {
    cleanup();
    resetPlannerStores();
  });

  it("requests the catalogue from the empty planning state", () => {
    const commands: PlannerToolbarCommand[] = [];
    window.addEventListener(PLANNER_TOOLBAR_COMMAND_EVENT, (event) => {
      const command = readPlannerToolbarCommand(event);
      if (command !== null) commands.push(command);
    });
    render(<PlannerCommandDeck />);

    expect(screen.getByTestId("planner-command-deck")).toBeDefined();
    expect(screen.getByText("Build the room from the floor")).toBeDefined();

    fireEvent.click(screen.getByTestId("planner-command-action-open-catalogue"));

    expect(commands).toEqual(["open-furniture"]);
  });

  it("requests laser diagram mode", () => {
    const commands: PlannerToolbarCommand[] = [];
    window.addEventListener(PLANNER_TOOLBAR_COMMAND_EVENT, (event) => {
      const command = readPlannerToolbarCommand(event);
      if (command !== null) commands.push(command);
    });
    render(<PlannerCommandDeck />);

    fireEvent.click(screen.getByTestId("planner-command-action-draw"));
    expect(commands).toEqual(["open-markup"]);
  });

  it("surfaces table dressing commands for selected tables", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    expect(table).toBeDefined();
    if (table === undefined) return;

    const placed = createPlacedItem(table.id, 0, 0, 0, null, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.setState({ selectedIds: new Set([placed.id]) });

    render(<PlannerCommandDeck />);

    expect(screen.getByText("Table selected")).toBeDefined();

    fireEvent.click(screen.getByTestId("planner-command-action-ivory-cloth"));
    expect(usePlacementStore.getState().placedItems[0]?.clothStyle).toBe("white");

    fireEvent.click(screen.getByTestId("planner-command-action-dinner-set"));
    expect(usePlacementStore.getState().placedItems[0]?.tableSetting).toBe("dinner");

    fireEvent.click(screen.getByTestId("planner-command-action-delete"));
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });
});
