import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EvidenceLensPanel } from "../EvidenceLensPanel.js";
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
  useRoomDimensionsStore.getState().setDimensions({ width: 42, length: 20, height: 7 }); // real 21×10
});

afterEach(() => { cleanup(); });

describe("EvidenceLensPanel", () => {
  it("renders the three purpose-fit checks", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(80);
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-lens-panel")).toBeTruthy();
    expect(screen.getByText("Layout evidence")).toBeTruthy();
    expect(screen.getByTestId("evidence-status-seating").textContent).toBe("Pass");
    expect(screen.getByTestId("evidence-status-comfort").textContent).toBe("Pass");
    expect(screen.getByTestId("evidence-status-egress").textContent).toBe("Review");
    expect(screen.getByTestId("evidence-check-egress").textContent).toMatch(/escape routes/);
  });

  it("flags a seat shortfall as Review", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-status-seating").textContent).toBe("Review");
    expect(screen.getByTestId("evidence-check-seating").textContent).toMatch(/Short 40 seats/);
  });

  it("is informational with nothing placed and no guest count", () => {
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-status-seating").textContent).toBe("Info");
    expect(screen.getByTestId("evidence-status-egress").textContent).toBe("Info");
    expect(screen.getByText(/Add a guest count to assess/)).toBeTruthy();
  });
});
