import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATALOGUE_ITEMS } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../../stores/furniture-inspection-store.js";
import type { PlannerLayerPolicy } from "../../../../lib/planner-layer-composition.js";

// Stand in for the real panels so this stays a routing test, not a render test.
vi.mock("../FlowLensPanel.js", () => ({ FlowLensPanel: () => <div data-testid="flow-panel-mock" /> }));
vi.mock("../CostsLensPanel.js", () => ({ CostsLensPanel: () => <div data-testid="costs-panel-mock" /> }));
vi.mock("../ShareLensPanel.js", () => ({ ShareLensPanel: () => <div data-testid="share-panel-mock" /> }));
vi.mock("../GuestsLensPanel.js", () => ({ GuestsLensPanel: () => <div data-testid="guests-panel-mock" /> }));
vi.mock("../OpsLensPanel.js", () => ({ OpsLensPanel: () => <div data-testid="ops-panel-mock" /> }));
vi.mock("../EvidenceLensPanel.js", () => ({ EvidenceLensPanel: () => <div data-testid="evidence-panel-mock" /> }));
vi.mock("../LightingLensPanel.js", () => ({ LightingLensPanel: () => <div data-testid="lighting-panel-mock" /> }));
vi.mock("../PowerLensPanel.js", () => ({ PowerLensPanel: () => <div data-testid="power-panel-mock" /> }));
vi.mock("../RiggingLensPanel.js", () => ({ RiggingLensPanel: () => <div data-testid="rigging-panel-mock" /> }));
vi.mock("../AVLensPanel.js", () => ({ AVLensPanel: () => <div data-testid="av-panel-mock" /> }));
vi.mock("../CockpitTruthRail.js", () => ({ CockpitTruthRail: () => <div data-testid="truth-rail-mock" /> }));

const { CockpitRightDock, panelForMode } = await import("../CockpitRightDock.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");

const CONFIGURABLE_POLICY: PlannerLayerPolicy = {
  kind: "configurable",
  effectiveMode: "hybrid",
  controlsLocked: false,
};
const CAPTURED_ONLY_POLICY: PlannerLayerPolicy = {
  kind: "captured-only",
  effectiveMode: "splat",
  controlsLocked: true,
};

function catalogueId(slug: string): string {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item.id;
}

afterEach(() => {
  cleanup();
  useCockpitStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
});

describe("panelForMode (registry)", () => {
  it("returns a panel for a registered lens and null otherwise", () => {
    expect(panelForMode("flow")).not.toBeNull();
    expect(panelForMode("costs")).not.toBeNull();
    expect(panelForMode("share")).not.toBeNull();
    expect(panelForMode("guests")).not.toBeNull();
    expect(panelForMode("ops")).not.toBeNull();
    expect(panelForMode("evidence")).not.toBeNull();
    expect(panelForMode("lighting")).not.toBeNull();
    expect(panelForMode("power")).not.toBeNull();
    expect(panelForMode("rigging")).not.toBeNull();
    expect(panelForMode("av")).not.toBeNull();
    expect(panelForMode("design")).toBeNull();
  });
});

describe("CockpitRightDock", () => {
  it("falls back to the Truth rail when the active lens has no panel", () => {
    useCockpitStore.getState().setMode("design");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("truth-rail-mock")).toBeTruthy();
    expect(screen.queryByTestId("flow-panel-mock")).toBeNull();
  });

  it("renders the registered panel for the flow lens", () => {
    useCockpitStore.getState().setMode("flow");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("flow-panel-mock")).toBeTruthy();
    expect(screen.queryByTestId("truth-rail-mock")).toBeNull();
  });

  it("routes one selected generated proxy to the inspection dock in Design", () => {
    const placed = createPlacedItem(catalogueId("bar-counter"), 0, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.getState().select(placed.id);
    useCockpitStore.getState().setMode("design");

    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);

    expect(screen.getByTestId("furniture-inspection-dock")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bar" })).toBeTruthy();
    expect(screen.queryByTestId("truth-rail-mock")).toBeNull();
  });

  it("keeps registered lens panels authoritative over generated selection", () => {
    const placed = createPlacedItem(catalogueId("bar-counter"), 0, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.getState().select(placed.id);
    useCockpitStore.getState().setMode("flow");

    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);

    expect(screen.getByTestId("flow-panel-mock")).toBeTruthy();
    expect(screen.queryByTestId("furniture-inspection-dock")).toBeNull();
  });

  it("closes presentation-only inspection when leaving Design", () => {
    const placed = createPlacedItem(catalogueId("platform"), 0, 0);
    usePlacementStore.setState({ placedItems: [placed] });
    useSelectionStore.getState().select(placed.id);
    useCockpitStore.getState().setMode("design");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated parts" }));
    useFurnitureInspectionStore.getState().setExplodeProgress(0.7);

    act(() => {
      useCockpitStore.getState().setMode("flow");
    });

    expect(screen.getByTestId("flow-panel-mock")).toBeTruthy();
    expect(useFurnitureInspectionStore.getState()).toMatchObject({
      inspectedPlacedItemId: null,
      selectedGeneratedPartId: null,
      explodeProgress: 0,
    });
  });

  it("renders the Costs panel for the costs lens", () => {
    useCockpitStore.getState().setMode("costs");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("costs-panel-mock")).toBeTruthy();
  });

  it("renders the Share panel for the share lens", () => {
    useCockpitStore.getState().setMode("share");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("share-panel-mock")).toBeTruthy();
  });

  it("renders the Guests panel for the guests lens", () => {
    useCockpitStore.getState().setMode("guests");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("guests-panel-mock")).toBeTruthy();
  });

  it("renders the Ops panel for the ops lens", () => {
    useCockpitStore.getState().setMode("ops");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("ops-panel-mock")).toBeTruthy();
  });

  it("renders the Evidence panel for the evidence lens", () => {
    useCockpitStore.getState().setMode("evidence");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("evidence-panel-mock")).toBeTruthy();
  });

  it("renders the Lighting panel for the lighting lens", () => {
    useCockpitStore.getState().setMode("lighting");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("lighting-panel-mock")).toBeTruthy();
  });

  it("renders the Power panel for the power lens", () => {
    useCockpitStore.getState().setMode("power");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("power-panel-mock")).toBeTruthy();
  });

  it("renders the Rigging panel for the rigging lens", () => {
    useCockpitStore.getState().setMode("rigging");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("rigging-panel-mock")).toBeTruthy();
  });

  it("renders the AV panel for the av lens", () => {
    useCockpitStore.getState().setMode("av");
    render(<CockpitRightDock layerPolicy={CONFIGURABLE_POLICY} />);
    expect(screen.getByTestId("av-panel-mock")).toBeTruthy();
  });

  it("renders only the source notice when operational geometry is unavailable", () => {
    useCockpitStore.getState().setMode("flow");
    render(<CockpitRightDock layerPolicy={CAPTURED_ONLY_POLICY} />);

    expect(screen.getByTestId("operational-geometry-unavailable-dock")).toBeTruthy();
    expect(screen.getByText(/Furniture fit, capacity, guest flow, route clearance/)).toBeTruthy();
    expect(screen.queryByTestId("flow-panel-mock")).toBeNull();
    expect(screen.queryByTestId("truth-rail-mock")).toBeNull();
  });

  it("does not label an identity-pending non-Grand-Hall room as Grand Hall", () => {
    render(<CockpitRightDock layerPolicy={{
      kind: "identity-pending",
      effectiveMode: "hybrid",
      controlsLocked: true,
    }} />);

    expect(screen.getByText("Identity resolving")).toBeTruthy();
    expect(screen.queryByText("Grand Hall")).toBeNull();
    expect(screen.queryByText(/captured visual inspection/i)).toBeNull();
  });
});
