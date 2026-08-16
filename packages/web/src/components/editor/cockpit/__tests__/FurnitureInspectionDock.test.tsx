import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATALOGUE_ITEMS } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../../stores/furniture-inspection-store.js";
import { GENERATED_FURNITURE_SLUGS } from "../../../meshes/generated/generatedFurnitureRegistry.js";
import {
  FurnitureInspectionDock,
  GeneratedFurnitureProxyBadge,
  selectedGeneratedFurniture,
} from "../FurnitureInspectionDock.js";

function catalogueId(slug: string): string {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item.id;
}

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
});

describe("selectedGeneratedFurniture", () => {
  it.each(GENERATED_FURNITURE_SLUGS)(
    "resolves a UUID-backed selected %s proxy",
    (slug) => {
      const placed = createPlacedItem(catalogueId(slug), 1, 2);

      expect(placed.catalogueItemId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(selectedGeneratedFurniture([placed], new Set([placed.id]))?.slug)
        .toBe(slug);
    },
  );

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
    const placed = createPlacedItem(catalogueId("round-table-6ft"), 0, 0);
    const selection = selectedGeneratedFurniture([placed], new Set([placed.id]));
    if (selection === null) throw new Error("expected generated table selection");

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
    const first = createPlacedItem(catalogueId("platform"), 0, 0);
    const second = createPlacedItem(catalogueId("bar-counter"), 2, 0);
    const firstSelection = selectedGeneratedFurniture([first], new Set([first.id]));
    const secondSelection = selectedGeneratedFurniture([second], new Set([second.id]));
    if (firstSelection === null || secondSelection === null) {
      throw new Error("expected generated selection fixtures");
    }
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
  it("stays absent when no generated proxy is placed", () => {
    usePlacementStore.setState({
      placedItems: [createPlacedItem(catalogueId("black-table-cloth"), 0, 0)],
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.queryByTestId("generated-furniture-proxy-badge")).toBeNull();
  });

  it("discloses one generated stand-in", () => {
    usePlacementStore.setState({
      placedItems: [createPlacedItem(catalogueId("platform"), 0, 0)],
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.getByTestId("generated-furniture-proxy-badge").textContent)
      .toBe("AI-generated furniture proxy · visual stand-in · not measured");
  });

  it("discloses plural generated stand-ins across the registered batch", () => {
    usePlacementStore.setState({
      placedItems: GENERATED_FURNITURE_SLUGS.map((slug, index) => (
        createPlacedItem(catalogueId(slug), index * 2, 0)
      )),
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.getByTestId("generated-furniture-proxy-badge").textContent)
      .toBe("AI-generated furniture proxies · visual stand-ins · not measured");
  });
});
