import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// drei's Html needs the R3F context; render its children straight into the
// DOM so the reason pill is queryable (same pattern as CirculationOverlay's
// tests). The three intrinsics (group/lineLoop/mesh/…) render as inert
// custom elements in happy-dom.
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { CATALOGUE_ITEMS, type CatalogueItem } from "../../../lib/catalogue.js";
import { isDiningTableItem } from "../../../lib/furniture-semantics.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { ClearanceRings } from "../ClearanceRings.js";

function diningTable(): CatalogueItem {
  const item = CATALOGUE_ITEMS.find((c) => c.category === "table" && isDiningTableItem(c));
  if (item === undefined) throw new Error("No dining table in catalogue");
  return item;
}

function place(item: CatalogueItem, id: string, x: number, z: number): PlacedItem {
  return {
    id,
    catalogueItemId: item.id,
    x, y: 0, z,
    rotationY: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

function resetStores(): void {
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
}

describe("ClearanceRings", () => {
  // Silence the expected React "unknown prop" warnings for three intrinsics.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });
  afterAll(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it("renders nothing with no selection", () => {
    const table = diningTable();
    usePlacementStore.setState({ placedItems: [place(table, "t1", 0, 0)] });
    const { container } = render(<ClearanceRings />);
    expect(container.innerHTML).toBe("");
  });

  it("a passing lone table draws its ring without a reason pill", () => {
    const table = diningTable();
    usePlacementStore.setState({ placedItems: [place(table, "t1", 0, 0)] });
    useSelectionStore.getState().select("t1");
    render(<ClearanceRings />);
    expect(screen.queryByTestId("clearance-ring-reason")).toBeNull();
  });

  it("a tight neighbour surfaces the amber reason with the named neighbour", () => {
    const table = diningTable();
    usePlacementStore.setState({
      placedItems: [
        place(table, "t1", 0, 0),
        place(table, "t2", table.width + 0.6, 0),
      ],
    });
    useSelectionStore.getState().select("t1");
    render(<ClearanceRings />);
    const reason = screen.getByTestId("clearance-ring-reason");
    expect(reason.textContent).toContain("0.60 m");
    expect(reason.textContent).toContain(table.name);
    expect(reason.textContent).toContain("0.90 m single-file");
    // Planning-grade language, never a legal egress claim.
    expect(reason.getAttribute("title")).toBe("Planning-grade clearance estimate");
  });
});
