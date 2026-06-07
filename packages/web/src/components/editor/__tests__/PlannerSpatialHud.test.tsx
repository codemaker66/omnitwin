import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { GRAND_HALL_RENDER_DIMENSIONS, RENDER_SCALE } from "../../../constants/scale.js";
import { computeCapacityIntelligence, inferSeatingStyle, comfortBandLabel } from "../../../lib/layout-capacity.js";
import { computeCirculation, circulationBandLabel, type FurnitureFootprint } from "../../../lib/circulation.js";
import { PlannerSpatialHud } from "../PlannerSpatialHud.js";

function resetStore(): void {
  usePlacementStore.setState({
    placedItems: [],
    undoStack: [],
    redoStack: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
}

describe("PlannerSpatialHud", () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it("summarizes the current layout with real counts", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const trestle = getCatalogueItemBySlug("trestle-6ft");
    const chair = getCatalogueItemBySlug("banquet-chair");
    expect(roundTable).toBeDefined();
    expect(trestle).toBeDefined();
    expect(chair).toBeDefined();
    if (roundTable === undefined || trestle === undefined || chair === undefined) return;

    usePlacementStore.setState({
      placedItems: [
        { ...createPlacedItem(roundTable.id, 0, 0, 0), clothed: true, clothStyle: "white", tableSetting: "dinner" },
        createPlacedItem(trestle.id, 2, 0, 0),
        createPlacedItem(chair.id, 0.5, 0.5, 0),
        createPlacedItem(chair.id, -0.5, 0.5, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByTestId("planner-spatial-hud")).toBeDefined();
    expect(screen.getByText("1 round table")).toBeDefined();
    expect(screen.getByText("1 trestle")).toBeDefined();
    expect(screen.getByText("2 chairs")).toBeDefined();
    expect(screen.getByText("1 table dressed")).toBeDefined();
  });

  it("renders a neutral empty-state capacity caption", () => {
    render(<PlannerSpatialHud />);

    expect(screen.getByText("Start placing furniture to build capacity")).toBeDefined();
    expect(screen.getByText("No dressed tables yet")).toBeDefined();
  });

  it("counts staged objects separately from chairs and tables", () => {
    const platform = getCatalogueItemBySlug("platform");
    expect(platform).toBeDefined();
    if (platform === undefined) return;
    usePlacementStore.setState({ placedItems: [createPlacedItem(platform.id, 0, 0, 0)] });

    render(<PlannerSpatialHud />);

    expect(screen.getByText("1 object")).toBeDefined();
  });

  it("reports area-based comfortable capacity with a planning-grade disclosure", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const chair = getCatalogueItemBySlug("banquet-chair");
    expect(roundTable).toBeDefined();
    expect(chair).toBeDefined();
    if (roundTable === undefined || chair === undefined) return;

    // 30 × 20 render units → 15m × 10m real → 150 m² of floor.
    useRoomDimensionsStore.setState({ dimensions: { width: 30, length: 20, height: 7 } });
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(chair.id, 0.5, 0.5, 0),
        createPlacedItem(chair.id, -0.5, 0.5, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    const style = inferSeatingStyle({ roundTables: 1, banquetTables: 0, chairs: 2 });
    const cap = computeCapacityIntelligence((30 / RENDER_SCALE) * (20 / RENDER_SCALE), 2, style);

    // Capacity comes from real floor area (floor(150 / 1.5) = 100), not a hardcoded constant.
    expect(cap.comfortableCapacity).toBe(100);
    expect(screen.getByText(`/ ${cap.comfortableCapacity.toLocaleString("en-GB")}`)).toBeDefined();
    expect(screen.getByText(comfortBandLabel(cap.band))).toBeDefined();
    expect(screen.getByText((content) => content.includes("m²/guest"))).toBeDefined();
    expect(
      screen.getByText("Planning-grade estimate · not a legal or fire capacity · human review required"),
    ).toBeDefined();
  });

  it("reports the tightest table aisle from real placed geometry", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    expect(roundTable).toBeDefined();
    if (roundTable === undefined) return;

    // Two round tables 8 render units apart on X → 4 m centre-to-centre.
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(roundTable.id, 8, 0, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    // Mirror the component's footprint mapping: render units ÷ RENDER_SCALE = m.
    const footprints: FurnitureFootprint[] = [0, 8].map((renderX, i) => ({
      id: `t${String(i)}`,
      label: roundTable.name,
      cx: renderX / RENDER_SCALE,
      cz: 0,
      width: roundTable.width,
      depth: roundTable.depth,
      rotation: 0,
    }));
    const circ = computeCirculation(footprints);
    expect(circ.band).not.toBe("open");
    expect(circ.tightestGapM).not.toBeNull();
    if (circ.tightestGapM === null) return;
    const gap = circ.tightestGapM;

    expect(
      screen.getByText((content) =>
        content.includes("Tightest table aisle") &&
        content.includes(`${gap.toFixed(1)} m`) &&
        content.includes(circulationBandLabel(circ.band)),
      ),
    ).toBeDefined();
  });

  it("flags the count of pinch points when several aisles fall below comfortable", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    expect(roundTable).toBeDefined();
    if (roundTable === undefined) return;

    // Three tables packed in a tight row → more than one sub-comfortable aisle.
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(roundTable.id, 2, 0, 0),
        createPlacedItem(roundTable.id, 4, 0, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByText(/\d+ aisles below comfortable/)).toBeDefined();
  });
});
