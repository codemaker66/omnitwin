import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GuestsLensPanel } from "../GuestsLensPanel.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, groupId: null,
  }));
}
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];

beforeEach(() => {
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  // Render-space 42 × 20 → real 21 × 10 = 210 m² (comfortable 140 for rounds).
  useRoomDimensionsStore.getState().setDimensions({ width: 42, length: 20, height: 7 });
});

afterEach(() => { cleanup(); });

describe("GuestsLensPanel", () => {
  it("renders the seat + comfort sections, prompting for a guest count when none is set", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-lens-panel")).toBeTruthy();
    expect(screen.getByText("Guests & seating")).toBeTruthy();
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("No guest count");
    expect(screen.getByTestId("guests-comfort-chip")).toBeTruthy();
  });

  it("writes the shared guest count and reports exact seating", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    fireEvent.change(screen.getByTestId("guests-count"), { target: { value: "80" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(80);
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("Every guest seated");
    expect(screen.getByTestId("guests-seat-summary").textContent).toMatch(/Exactly 80 seats for 80 guests/);
    expect(screen.getByText(/140 · seated dinner on round tables/)).toBeTruthy();
  });

  it("flags a seat shortfall when guests exceed placed seats", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("Short 40");
    expect(screen.getByTestId("guests-seat-summary").textContent).toMatch(/Short 40 seats for 120 guests/);
  });

  it("flags over comfortable capacity for a packed headcount", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(220);
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-comfort-chip").textContent).toBe("Over capacity");
  });

  it("compares room capacity across every event style with a live fit verdict", () => {
    useCockpitStore.getState().setPlannedGuestCount(150);
    render(<GuestsLensPanel />);
    // 210 m²: Theatre comfortably seats 150; Boardroom is over.
    expect(screen.getByTestId("guests-style-cocktail")).toBeTruthy();
    expect(screen.getByTestId("guests-style-fit-theatre").textContent).toBe("Comfortable");
    expect(screen.getByTestId("guests-style-fit-boardroom").textContent).toBe("Over");
    expect(screen.getByTestId("guests-style-summary").textContent).toMatch(/150 guests/);
  });

  it("lists per-style capacities without fit chips until a guest count is set", () => {
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-style-theatre")).toBeTruthy();
    expect(screen.queryByTestId("guests-style-fit-theatre")).toBeNull();
    expect(screen.getByTestId("guests-style-summary").textContent).toMatch(/Set a guest count/);
  });
});
