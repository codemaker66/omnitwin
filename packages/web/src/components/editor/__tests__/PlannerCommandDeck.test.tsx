import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAssemblyRecallForTests, useAssemblyRecallStore } from "../../../floor/assembly/recall.js";
import { grandHallDinner180 } from "../../../floor/assembly/fixture.js";
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
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useMarkupStore } from "../../../stores/markup-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useAutoFillRequestStore } from "../../../stores/auto-fill-request-store.js";
import { PlannerCommandDeck } from "../PlannerCommandDeck.js";
import { GRAND_HALL_ARRIVAL } from "../../../lib/planner-room-arrival.js";
import { sampleCameraTour } from "../../../lib/camera-tour.js";

function resetPlannerStores(): void {
  resetAssemblyRecallForTests();
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
  useAutoFillRequestStore.setState({ requested: null });
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
    expect(screen.getByText("Arrange the room")).toBeDefined();

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

  it("offers poseur linen without exposing seated dinner settings", () => {
    const poseur = getCatalogueItemBySlug("poseur-table");
    expect(poseur).toBeDefined();
    if (poseur === undefined) return;
    const placed = createPlacedItem(poseur.id, 0, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.setState({ selectedIds: new Set([placed.id]) });

    render(<PlannerCommandDeck />);

    expect(screen.getByTestId("planner-command-action-ivory-cloth")).toBeDefined();
    expect(screen.queryByTestId("planner-command-action-dinner-set")).toBeNull();
  });

  it.each(["poseur-table-black", "poseur-table-white"])(
    "does not offer a second cloth for intrinsic variant %s",
    (slug) => {
      const poseur = getCatalogueItemBySlug(slug);
      expect(poseur).toBeDefined();
      if (poseur === undefined) return;
      const placed = createPlacedItem(poseur.id, 0, 0);
      usePlacementStore.setState({ placedItems: [placed] });
      useSelectionStore.setState({ selectedIds: new Set([placed.id]) });

      render(<PlannerCommandDeck />);

      expect(screen.getByText("Table selected")).toBeDefined();
      expect(screen.queryByTestId("planner-command-action-ivory-cloth")).toBeNull();
      expect(screen.queryByTestId("planner-command-action-dinner-set")).toBeNull();
      expect(screen.queryByText(/Dress, move or group/)).toBeNull();
    },
  );

  it("asks how many guests in the Guests lens before it places anything", () => {
    useRoomDimensionsStore.setState({ dimensions: { width: 40, length: 20, height: 7 } });

    render(<PlannerCommandDeck />);
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);

    fireEvent.click(screen.getByTestId("planner-command-action-auto-fill"));

    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useCockpitStore.getState().activeMode).toBe("guests");
    expect(useAutoFillRequestStore.getState().requested).toBe("dinner-rounds");
  });

  it("names the guest count it will ask about when one is set", () => {
    useCockpitStore.getState().setPlannedGuestCount(24);

    render(<PlannerCommandDeck />);
    const layOut = screen.getByTestId("planner-command-action-auto-fill");
    expect(layOut.textContent).toBe("Lay out");
    expect(layOut.getAttribute("aria-label")).toBe("Lay out tables and seats for 24 guests");
    fireEvent.click(screen.getByTestId("planner-command-action-auto-fill"));

    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useAutoFillRequestStore.getState().requested).toBe("dinner-rounds");
  });

  it("hides auto-fill once the floor has furniture", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) return;
    usePlacementStore.setState({ placedItems: [createPlacedItem(table.id, 0, 0, 0, null, 0)] });

    render(<PlannerCommandDeck />);

    expect(screen.queryByTestId("planner-command-action-auto-fill")).toBeNull();
  });

  it("names its commands in the venue's words: Lay out, Draw and Present (F-15)", () => {
    render(<PlannerCommandDeck />);
    const deck = screen.getByTestId("planner-command-deck");
    expect(screen.getByRole("button", { name: "Lay out tables and seats for your guests" }).textContent).toBe("Lay out");
    expect(screen.getByRole("button", { name: "Draw on the floor" }).textContent).toBe("Draw");
    expect(screen.getByTestId("planner-command-action-showcase").textContent).toBe("Present");
    const words = [deck.textContent ?? "", ...[...deck.querySelectorAll("[aria-label],[title]")].flatMap((node) => [node.getAttribute("aria-label") ?? "", node.getAttribute("title") ?? ""])].join(" ");
    expect(words).not.toMatch(/auto-fill|laser|showcase|cinematic/iu);
  });

  it("starts the Present tour from the command deck", () => {
    useRoomDimensionsStore.setState({ dimensions: { width: 42, length: 21, height: 7 } });

    render(<PlannerCommandDeck />);
    expect(useBookmarkStore.getState().tour).toBeNull();

    fireEvent.click(screen.getByTestId("planner-command-action-showcase"));

    const tour = useBookmarkStore.getState().tour;
    expect(tour).not.toBeNull();
    expect(tour?.legs.length).toBeGreaterThan(0);
  });

  it("launches the actual staged hall path and withdraws it for stale or unknown capture frames", () => {
    useEditorStore.setState({ configId: "demo", space: {
      id: "hall", venueId: "venue", name: "Grand Hall", slug: "grand-hall",
      widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [],
    } });
    useRoomDimensionsStore.setState({ dimensions: { width: 21, length: 10.5, height: 7 } });
    const source = { configId: "demo", spaceId: "hall", layerMode: "splat" as const,
      captureSource: "staged" as const, loadedChunks: 12, totalChunks: 12, proceduralGeometryVisible: false };
    useCockpitStore.setState({ sceneSource: source, layerMode: "splat" });
    const view = render(<PlannerCommandDeck />);
    fireEvent.click(screen.getByTestId("planner-command-action-showcase"));
    const tour = useBookmarkStore.getState().tour;
    if (tour === null) throw new Error("No staged hall tour");
    expect(sampleCameraTour(tour).position).toEqual(GRAND_HALL_ARRIVAL.position);
    expect(tour.interiorOwner?.spaceId).toBe("hall");
    useBookmarkStore.getState().clearTour();
    useCockpitStore.setState({ sceneSource: { ...source, captureSource: "package" } });
    view.rerender(<PlannerCommandDeck />);
    const present = screen.getByTestId<HTMLButtonElement>("planner-command-action-showcase");
    expect(present.disabled).toBe(true);
    // A disabled control says why, in its name and its tooltip (spec 13 rule 6).
    expect(present.getAttribute("aria-label")).toBe("Present is not ready for this view of the room yet");
    expect(present.getAttribute("title")).toBe("Present is not ready for this view of the room yet");
    fireEvent.click(screen.getByTestId("planner-command-action-showcase"));
    expect(useBookmarkStore.getState().tour).toBeNull();
    useCockpitStore.setState({ sceneSource: { ...source, configId: "another" } });
    view.rerender(<PlannerCommandDeck />);
    expect(screen.getByTestId<HTMLButtonElement>("planner-command-action-showcase").disabled).toBe(true);
  });

  describe("over the drawn Grand Hall, where the Assembly is on its stage (no capture, so no tour)", () => {
    beforeEach(() => {
      useEditorStore.setState({ configId: "demo", space: {
        id: "hall", venueId: "venue", name: "Grand Hall", slug: "grand-hall",
        widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [],
      } });
      act(() => { useAssemblyRecallStore.setState({ onStage: true }); });
    });

    it("replays the Grand Assembly from Present with a layout on the floor (Blake, 26 Oct 2026)", () => {
      usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
      render(<PlannerCommandDeck />);
      const present = screen.getByTestId<HTMLButtonElement>("planner-command-action-showcase");
      expect(present.disabled).toBe(false);
      expect(present.getAttribute("aria-label")).toBe("Present: watch the room set itself");
      fireEvent.click(present, { detail: 1 });
      expect(useAssemblyRecallStore.getState().request).toMatchObject({ configId: "demo", reason: "replay" });
      expect(useBookmarkStore.getState().tour).toBeNull();
    });

    it("says why Present waits over an empty floor, in its name and its tooltip", () => {
      render(<PlannerCommandDeck />);
      const present = screen.getByTestId<HTMLButtonElement>("planner-command-action-showcase");
      expect(present.disabled).toBe(true);
      expect(present.getAttribute("aria-label")).toBe("Present plays your layout: lay out or add furniture first");
      expect(present.getAttribute("title")).toBe("Present plays your layout: lay out or add furniture first");
    });

    it("never asks again while the show plays: a press from the keys hurries it, as the Skip does", () => {
      usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
      act(() => { useAssemblyRecallStore.setState({ active: true }); });
      render(<PlannerCommandDeck />);
      const present = (): HTMLElement => screen.getByTestId("planner-command-action-showcase");
      expect(present().getAttribute("aria-label")).toBe("Present is playing: press to hurry it");
      const before = useAssemblyRecallStore.getState().skipNonce;
      // A pointer's press was the Skip already (GrandAssembly's window listener): the click adds nothing.
      fireEvent.click(present(), { detail: 1 });
      expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: false, skipNonce: before, request: null });
      // Enter or Space: a click with no pointer behind it.
      fireEvent.click(present(), { detail: 0 });
      expect(useAssemblyRecallStore.getState().fast).toBe(true);
      expect(present().getAttribute("aria-label")).toBe("Present is hurrying: press to go to the end");
      fireEvent.click(present(), { detail: 0 });
      expect(useAssemblyRecallStore.getState()).toMatchObject({ skipNonce: before + 1, request: null });
    });
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
