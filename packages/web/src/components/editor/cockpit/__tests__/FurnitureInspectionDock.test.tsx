import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATALOGUE_ITEMS } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../../stores/furniture-inspection-store.js";
import { GENERATED_FURNITURE_SLUGS, type GeneratedFurnitureSlug } from "../../../meshes/generated/generatedFurnitureRegistry.js";
import {
  FurnitureInspectionDock,
  GeneratedFurnitureProxyBadge,
  selectedGeneratedFurniture,
  type SelectedGeneratedFurniture,
} from "../FurnitureInspectionDock.js";

function catalogueId(slug: string): string {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item.id;
}

/**
 * A selection the dock is handed directly: since T-675 every catalogue piece
 * is drawn crafted, so no placed item resolves to a generated proxy, but the
 * dock itself still behaves as it did for one.
 */
function generatedSelection(slug: GeneratedFurnitureSlug, x: number): SelectedGeneratedFurniture {
  const catalogueItem = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (catalogueItem === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return { placed: createPlacedItem(catalogueItem.id, x, 0), catalogueItem, slug };
}

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
});

describe("selectedGeneratedFurniture", () => {
  it.each([...GENERATED_FURNITURE_SLUGS])("offers no generated-part controls for %s, which is drawn crafted", (slug) => {
    const placed = createPlacedItem(catalogueId(slug), 1, 2);
    expect(placed.catalogueItemId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(selectedGeneratedFurniture([placed], new Set([placed.id]))).toBeNull();
  });

  it("rejects unsupported, missing, and multi-item selections", () => {
    const chair = createPlacedItem(catalogueId("banquet-chair"), 1, 2);
    const unsupported = createPlacedItem(catalogueId("black-table-cloth"), 3, 4);

    expect(selectedGeneratedFurniture([chair, unsupported], new Set([unsupported.id])))
      .toBeNull();
    expect(selectedGeneratedFurniture([chair, unsupported], new Set(["missing-id"])))
      .toBeNull();
    expect(selectedGeneratedFurniture([chair, unsupported], new Set([chair.id, unsupported.id])))
      .toBeNull();
  });
});

describe("FurnitureInspectionDock", () => {
  it("keeps explode and part selection in presentation-only inspection state", () => {
    const selection = generatedSelection("round-table-6ft", 0);
    const placed = selection.placed;

    render(<FurnitureInspectionDock selection={selection} />);
    expect(screen.getByText("Planning visual — not measured venue evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated parts" }));

    expect(useFurnitureInspectionStore.getState().inspectedPlacedItemId).toBe(placed.id);
    const range = screen.getByRole("slider", { name: "Explode assembly" });
    fireEvent.change(range, { target: { value: "0.42" } });
    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0.42);
    expect(screen.getByText("42%")).toBeTruthy();

    act(() => {
      useFurnitureInspectionStore.getState().selectGeneratedPart("frame-crossbar");
    });
    expect(screen.getByText("Frame Crossbar")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse assembly" }));
    expect(useFurnitureInspectionStore.getState().explodeProgress).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Exit inspection" }));
    expect(useFurnitureInspectionStore.getState().inspectedPlacedItemId).toBeNull();
  });

  it("clears an active presentation when selection moves to another generated item", () => {
    const firstSelection = generatedSelection("platform-narrow", 0);
    const secondSelection = generatedSelection("lectern", 2);
    const view = render(<FurnitureInspectionDock selection={firstSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated parts" }));
    act(() => {
      useFurnitureInspectionStore.getState().setExplodeProgress(0.6);
    });

    view.rerender(<FurnitureInspectionDock selection={secondSelection} />);

    expect(useFurnitureInspectionStore.getState()).toMatchObject({
      inspectedPlacedItemId: null,
      selectedGeneratedPartId: null,
      explodeProgress: 0,
    });
  });
});

describe("GeneratedFurnitureProxyBadge", () => {
  it("stays absent for every catalogue piece, each drawn crafted rather than by an AI-generated stand-in", () => {
    usePlacementStore.setState({
      placedItems: CATALOGUE_ITEMS.map((item, index) => createPlacedItem(item.id, index * 2, 0)),
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.queryByTestId("generated-furniture-proxy-badge")).toBeNull();
  });
});
