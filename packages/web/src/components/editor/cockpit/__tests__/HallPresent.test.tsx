import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAssemblyRecallForTests, useAssemblyRecallStore } from "../../../../floor/assembly/recall.js";
import { grandHallDinner180 } from "../../../../floor/assembly/fixture.js";
import { useBookmarkStore } from "../../../../stores/bookmark-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../../stores/room-dimensions-store.js";
import { PRESENT_NOT_READY } from "../../planner-present.js";
import { HallPresent } from "../HallPresent.js";
import { HallViewSheetControls } from "../CanvasLayerControls.js";

// The Grand Hall's venue reads as Trades Hall without a network request.
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

const GRAND_HALL = {
  id: "space-grand-hall", venueId: "venue-trades-hall", name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

/** The words written under Present, which its button points to. */
function lineUnder(button: HTMLElement): string {
  const id = button.getAttribute("aria-describedby");
  return id === null ? "" : document.getElementById(id)?.textContent ?? "";
}

function layoutOnTheFloor(): void {
  usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
}

beforeEach(() => {
  resetAssemblyRecallForTests();
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "config-a", space: GRAND_HALL });
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, activeReferenceId: null, pendingNavigationId: null });
  usePlacementStore.setState({ placedItems: [] });
  useRoomDimensionsStore.setState({ dimensions: { width: 21, length: 10.5, height: 7 } });
});

afterEach(() => {
  cleanup();
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
  useBookmarkStore.setState({ tour: null });
  useEditorStore.getState().reset();
});

describe("Present in a phone's View sheet", () => {
  it("is the Grand Hall sheet's last row, after its views and lights", () => {
    render(<HallViewSheetControls onViewChosen={() => undefined} />);
    const buttons = within(screen.getByTestId("hall-view-sheet")).getAllByRole("button");
    expect(buttons[buttons.length - 1]?.textContent).toBe("Present");
  });

  it("replays the Assembly over the drawn hall's layout, then steps the sheet aside", () => {
    layoutOnTheFloor();
    act(() => { useAssemblyRecallStore.setState({ onStage: true }); });
    const presented = vi.fn();
    render(<HallPresent onPresented={presented} />);
    const present = screen.getByRole("button", { name: "Present" });
    expect(lineUnder(present)).toBe("Watch the room set itself");
    fireEvent.click(present, { detail: 1 });
    expect(useAssemblyRecallStore.getState().request).toMatchObject({ configId: "config-a", reason: "replay" });
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it("writes why it can't beneath it, where a touch screen shows no tooltip, and leaves the sheet open", () => {
    // The Grand Hall in the combined view with no capture to tour, and the Assembly off its stage.
    layoutOnTheFloor();
    const presented = vi.fn();
    render(<HallPresent onPresented={presented} />);
    const present = screen.getByRole<HTMLButtonElement>("button", { name: "Present" });
    expect(present.disabled).toBe(true);
    expect(lineUnder(present)).toBe(PRESENT_NOT_READY);
    expect(screen.getByText(PRESENT_NOT_READY)).toBeTruthy();
    fireEvent.click(present, { detail: 1 });
    expect(presented).not.toHaveBeenCalled();
    expect(useAssemblyRecallStore.getState().request).toBeNull();
  });

  it("plays the room's tour where there is one, then steps the sheet aside", () => {
    act(() => { useCockpitStore.setState({ layerMode: "mesh" }); });
    const presented = vi.fn();
    render(<HallPresent onPresented={presented} />);
    const present = screen.getByRole("button", { name: "Present" });
    expect(lineUnder(present)).toBe("Play the room as your guests will see it");
    fireEvent.click(present, { detail: 1 });
    expect(useBookmarkStore.getState().tour).not.toBeNull();
    expect(presented).toHaveBeenCalledTimes(1);
  });

  it("hurries a show under way from the keys and leaves the sheet where it is", () => {
    layoutOnTheFloor();
    act(() => { useAssemblyRecallStore.setState({ onStage: true, active: true }); });
    const presented = vi.fn();
    render(<HallPresent onPresented={presented} />);
    const present = screen.getByRole("button", { name: "Present" });
    expect(lineUnder(present)).toBe("The room is setting itself");
    fireEvent.click(present, { detail: 0 });
    expect(useAssemblyRecallStore.getState()).toMatchObject({ fast: true, request: null });
    expect(presented).not.toHaveBeenCalled();
  });
});
