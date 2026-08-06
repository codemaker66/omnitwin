import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATALOGUE_ITEMS } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../../stores/furniture-inspection-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
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

const PREVIEW_FRAME = {
  id: "frame-1",
  eventId: "00000000-0000-4000-8000-0000000000e1",
  eventName: "Test Wedding",
  phaseId: "phase-1",
  phaseName: "Dinner",
  startsAt: "2026-08-04T18:00:00.000Z",
  endsAt: "2026-08-04T22:00:00.000Z",
} as const;

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
  useLayoutTimelinePreviewStore.getState().clear();
});

describe("selectedGeneratedFurniture", () => {
  it.each(GENERATED_FURNITURE_SLUGS)(
    "resolves one selected registered %s proxy",
    (slug) => {
      const placed = createPlacedItem(catalogueId(slug), 1, 2);

      expect(selectedGeneratedFurniture([placed], new Set([placed.id]))?.slug)
        .toBe(slug);
    },
  );

  it("rejects unsupported and multi-item selections", () => {
    const chair = createPlacedItem(catalogueId("banquet-chair"), 1, 2);
    const unsupported = createPlacedItem(catalogueId("projector-screen"), 3, 4);

    expect(selectedGeneratedFurniture([chair, unsupported], new Set([unsupported.id])))
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
});

describe("GeneratedFurnitureProxyBadge", () => {
  it("discloses generated proxies whenever supported furniture is present", () => {
    usePlacementStore.setState({
      placedItems: [
        ...GENERATED_FURNITURE_SLUGS.map((slug, index) => (
          createPlacedItem(catalogueId(slug), index * 2, 0)
        )),
      ],
    });
    render(<GeneratedFurnitureProxyBadge />);
    expect(screen.getByTestId("generated-furniture-proxy-badge").textContent)
      .toBe("AI-generated furniture proxies · planning only");
  });

  // The provenance badge is an honesty contract, not decoration: if generated
  // geometry is on screen the disclosure must be too. A timeline phase preview
  // hides the saved layout and renders the preview frame's items instead, so
  // the badge has to follow the preview set — counting placedItems there would
  // disclose a scene nobody is looking at, or disclose nothing at all.
  it("follows the preview frame's items, not the saved layout, during a phase preview", () => {
    const savedChair = createPlacedItem(catalogueId("banquet-chair"), 0, 0);
    const previewTable = createPlacedItem(catalogueId("round-table-6ft"), 4, 4);
    const previewDanceFloor = createPlacedItem(catalogueId("dancefloor-panel"), 6, 6);
    usePlacementStore.setState({ placedItems: [savedChair] });
    act(() => {
      useLayoutTimelinePreviewStore.getState().settle(
        PREVIEW_FRAME,
        [previewTable, previewDanceFloor],
      );
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.getByTestId("generated-furniture-proxy-badge").textContent)
      .toBe("AI-generated furniture proxies · planning only");
  });

  it("stays silent when the preview frame contains no generated proxy", () => {
    // A saved layout full of proxies must NOT keep the badge on screen while a
    // preview of a proxy-free layout is showing.
    usePlacementStore.setState({
      placedItems: GENERATED_FURNITURE_SLUGS.map((slug, index) => (
        createPlacedItem(catalogueId(slug), index * 2, 0)
      )),
    });
    act(() => {
      useLayoutTimelinePreviewStore.getState().settle(
        PREVIEW_FRAME,
        [createPlacedItem(catalogueId("projector-screen"), 1, 1)],
      );
    });

    render(<GeneratedFurnitureProxyBadge />);

    expect(screen.queryByTestId("generated-furniture-proxy-badge")).toBeNull();
  });
});
