import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import {
  PLANNER_TOOLBAR_COMMAND_EVENT,
  readPlannerToolbarCommand,
  type PlannerToolbarCommand,
} from "../../../lib/planner-toolbar-events.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useMarkupStore } from "../../../stores/markup-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { PlannerCommandDeck } from "../PlannerCommandDeck.js";

function resetPlannerStores(): void {
  useEditorStore.getState().reset();
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
    tour: null,
  });
  usePlacementStore.setState({
    placedItems: [],
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

  it("auto-fills the room with a banquet grid from the blank state", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    expect(table).toBeDefined();
    if (table === undefined) return;
    useRoomDimensionsStore.setState({ dimensions: { width: 40, length: 20, height: 7 } });

    render(<PlannerCommandDeck />);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);

    fireEvent.click(screen.getByTestId("planner-command-action-auto-fill"));

    const items = usePlacementStore.getState().placedItems;
    const tables = items.filter((i) => i.catalogueItemId === table.id);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("hides auto-fill once the floor has furniture", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) return;
    usePlacementStore.setState({ placedItems: [createPlacedItem(table.id, 0, 0, 0, null, 0)] });

    render(<PlannerCommandDeck />);

    expect(screen.queryByTestId("planner-command-action-auto-fill")).toBeNull();
  });

  it("starts a cinematic showcase tour from the command deck", () => {
    useRoomDimensionsStore.setState({ dimensions: { width: 42, length: 21, height: 7 } });

    render(<PlannerCommandDeck />);
    expect(useBookmarkStore.getState().tour).toBeNull();

    fireEvent.click(screen.getByTestId("planner-command-action-showcase"));

    const tour = useBookmarkStore.getState().tour;
    expect(tour).not.toBeNull();
    expect(tour?.legs.length).toBeGreaterThan(0);
  });

  it("offers undo and redo in the browse state, disabled with no history", () => {
    render(<PlannerCommandDeck />);

    const undo = screen.getByTestId<HTMLButtonElement>("planner-command-action-undo");
    const redo = screen.getByTestId<HTMLButtonElement>("planner-command-action-redo");
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
  });

  it("undoes and redoes the last layout change from the deck", () => {
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    expect(useEditorStore.getState().objects).toHaveLength(1);

    render(<PlannerCommandDeck />);

    const undo = screen.getByTestId<HTMLButtonElement>("planner-command-action-undo");
    expect(undo.disabled).toBe(false);
    expect(undo.getAttribute("aria-label")).toMatch(/^Undo/);

    fireEvent.click(undo);
    expect(useEditorStore.getState().objects).toHaveLength(0);

    const redo = screen.getByTestId<HTMLButtonElement>("planner-command-action-redo");
    expect(redo.disabled).toBe(false);
    expect(redo.getAttribute("aria-label")).toMatch(/^Redo/);

    fireEvent.click(redo);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it("keeps undo available while furniture is selected", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    expect(table).toBeDefined();
    if (table === undefined) return;

    useEditorStore.getState().addObject(table.id, 0, 0, 0);
    const placed = createPlacedItem(table.id, 0, 0, 0, null, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.setState({ selectedIds: new Set([placed.id]) });

    render(<PlannerCommandDeck />);

    expect(screen.getByText("Table selected")).toBeDefined();
    const undo = screen.getByTestId<HTMLButtonElement>("planner-command-action-undo");
    expect(undo.disabled).toBe(false);
  });
});
