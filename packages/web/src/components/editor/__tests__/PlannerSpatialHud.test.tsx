import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradesHallVenueStatus } from "../../../hooks/use-trades-hall-venue.js";
import * as plannerTruth from "../cockpit/__tests__/planner-truth-fixtures.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { GRAND_HALL_RENDER_DIMENSIONS, RENDER_SCALE } from "../../../constants/scale.js";
import { computeCapacityIntelligence, inferSeatingStyle, comfortBandLabel } from "../../../lib/layout-capacity.js";
import { computeCirculation, circulationBandLabel, type FurnitureFootprint } from "../../../lib/circulation.js";
import { PlannerSpatialHud } from "../PlannerSpatialHud.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

function resetStore(): void {
  venue.status = "trades-hall";
  plannerTruth.resetPlannerTruth();
  usePlacementStore.setState({
    placedItems: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  useCockpitStore.getState().reset();
}

describe("PlannerSpatialHud", () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetStore();
  });

  it("uses the shared movable, minimizable floating widget frame", () => {
    const { container } = render(<PlannerSpatialHud />);

    const root = container.querySelector<HTMLElement>("[data-floating-widget-id='planner-spatial-hud']");
    expect(root).not.toBeNull();
    expect(screen.getByRole("button", { name: "Move Layout intelligence" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reset Layout intelligence position" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Minimize Layout intelligence" }));

    expect(root?.getAttribute("data-minimized")).toBe("true");
    expect(screen.getByText("Grade D")).toBeDefined();
  });

  it("auto-compacts layout intelligence while the camera is moving", () => {
    useCockpitStore.getState().setCameraInteractionActive(true);

    const { container } = render(<PlannerSpatialHud />);

    const root = container.querySelector<HTMLElement>("[data-floating-widget-id='planner-spatial-hud']");
    const body = container.querySelector<HTMLElement>(".vv-floating-widget__body");

    expect(root?.getAttribute("data-auto-compact")).toBe("true");
    expect(root?.getAttribute("data-minimized")).toBe("false");
    expect(body?.hasAttribute("hidden")).toBe(true);
    expect(screen.getByText("Grade D")).toBeDefined();
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
    expect(screen.getByText("Scenario-ready layout")).toBeDefined();
    expect(screen.getByText(/2 seats can feed a revenue scenario/i)).toBeDefined();
  });

  it("renders a neutral empty-state capacity caption", () => {
    render(<PlannerSpatialHud />);

    expect(screen.getByText("Start placing furniture to build capacity")).toBeDefined();
    expect(screen.getByText("No dressed tables yet")).toBeDefined();
    expect(screen.getByText("No quote linked")).toBeDefined();
  });

  it("does not report a clothed poseur as a dining round or dressed dining table", () => {
    const poseur = getCatalogueItemBySlug("poseur-table-black");
    expect(poseur).toBeDefined();
    if (poseur === undefined) return;
    usePlacementStore.setState({
      placedItems: [{
        ...createPlacedItem(poseur.id, 0, 0),
        clothed: true,
        clothStyle: "black",
      }],
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByText("0 round tables")).toBeDefined();
    expect(screen.getByText("No dressed tables yet")).toBeDefined();
    expect(screen.getByTestId("planner-spatial-hud").getAttribute("data-has-layout")).toBe("false");
  });

  it("counts staged objects separately from chairs and tables", () => {
    const platform = getCatalogueItemBySlug("platform");
    expect(platform).toBeDefined();
    if (platform === undefined) return;
    usePlacementStore.setState({ placedItems: [createPlacedItem(platform.id, 0, 0, 0)] });

    render(<PlannerSpatialHud />);

    expect(screen.getByText("1 object")).toBeDefined();
  });

  it("counts a visitor's seats against the venue's published figure, with who stated it", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (roundTable === undefined || chair === undefined) throw new Error("catalogue items missing");
    plannerTruth.openRoom(plannerTruth.plannerRoom());
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(chair.id, 0.5, 0.5, 0),
        createPlacedItem(chair.id, -0.5, 0.5, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    const panel = screen.getByTestId("planner-capacity-panel");
    expect(panel.textContent).toContain("/ 180");
    expect(screen.getByTestId("planner-capacity-caption").textContent).toBe("Published 180 for dinner");
    expect(screen.getByTestId("planner-capacity-source").textContent).toBe("Published guide · Trades Hall · 9 Jul 2026");
    // The Grand Hall's 220.5 m² at generic spacing would read 147; a visitor never sees it.
    expect(panel.textContent).not.toMatch(/\b147\b|generic spacing|comfortable|within/i);
  });

  it("says plainly when a visitor's seats are above the published figure", () => {
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (chair === undefined) throw new Error("catalogue items missing");
    plannerTruth.openRoom(plannerTruth.plannerRoom());
    usePlacementStore.setState({
      placedItems: Array.from({ length: 260 }, (_, i) => createPlacedItem(chair.id, (i % 20) * 0.6, Math.floor(i / 20) * 0.6, 0)),
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByTestId("planner-capacity-caption").textContent).toBe("260 seats placed; the venue publishes 250 for theatre.");
    expect(screen.getByTestId("planner-capacity-panel").textContent).toContain("The events team will say what is possible.");
  });

  it("shows a visitor seats alone in a room with no published figure", () => {
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (chair === undefined) throw new Error("catalogue items missing");
    venue.status = "other";
    plannerTruth.openRoom(plannerTruth.plannerRoom("grand-hall", "Grand Hall", "venue-elsewhere"));
    usePlacementStore.setState({ placedItems: [createPlacedItem(chair.id, 0, 0, 0)] });

    render(<PlannerSpatialHud />);

    const panel = screen.getByTestId("planner-capacity-panel");
    expect(panel.textContent).not.toContain("/ ");
    expect(screen.getByTestId("planner-capacity-caption").textContent).toBe("No published capacity for this room");
  });

  it("shows honest work while the venue is being read", () => {
    venue.status = "reading";
    plannerTruth.openRoom(plannerTruth.plannerRoom());
    render(<PlannerSpatialHud />);
    expect(screen.getByTestId("planner-capacity-caption").querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("reports area-based arithmetic to venue staff, labelled as an estimate at generic spacing", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const chair = getCatalogueItemBySlug("banquet-chair");
    expect(roundTable).toBeDefined();
    expect(chair).toBeDefined();
    if (roundTable === undefined || chair === undefined) return;
    plannerTruth.viewAsStaff();
    plannerTruth.openRoom(plannerTruth.plannerRoom());

    // 15m × 10m real → 150 m² of floor. The scene is in true metres now, so
    // the store holds the real figures directly; this fixture previously
    // carried the doubled 30 × 20 render units.
    useRoomDimensionsStore.setState({ dimensions: { width: 15, length: 10, height: 7 } });
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(chair.id, 0.5, 0.5, 0),
        createPlacedItem(chair.id, -0.5, 0.5, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    const style = inferSeatingStyle({ roundTables: 1, banquetTables: 0, chairs: 2 });
    // Real floor area, matching the dimensions set above. Deriving it from
    // the store's own numbers keeps the expectation and the fixture from
    // drifting apart — they previously did, via stale render-space literals.
    const cap = computeCapacityIntelligence(15 * 10, 2, style);

    // Capacity comes from real floor area (floor(150 / 1.5) = 100), not a hardcoded constant.
    expect(cap.comfortableCapacity).toBe(100);
    expect(screen.getByText(`/ ${cap.comfortableCapacity.toLocaleString("en-GB")}`)).toBeDefined();
    expect(screen.getByText(comfortBandLabel(cap.band))).toBeDefined();
    expect(screen.getByText((content) => content.includes("m²/guest") && content.includes("at generic spacing"))).toBeDefined();
    expect(screen.getByTestId("planner-capacity-disclosure").textContent).toBe(
      "Estimate at generic spacing · venue staff only · not the venue's published figure",
    );
    expect(screen.getByTestId("planner-capacity-panel").textContent).not.toMatch(/\bwithin\b/i);
  });

  it("reports the tightest furniture clearance from real placed geometry", () => {
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
        content.includes("Tightest furniture clearance") &&
        content.includes(`${gap.toFixed(1)} m`) &&
        content.includes(circulationBandLabel(circ.band)),
      ),
    ).toBeDefined();
  });

  it("reports a table-to-mic-stand gap without calling it a table aisle", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const micStand = getCatalogueItemBySlug("mic-stand");
    expect(roundTable).toBeDefined();
    expect(micStand).toBeDefined();
    if (roundTable === undefined || micStand === undefined) return;

    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(micStand.id, 4, 0, 0),
      ],
    });

    render(<PlannerSpatialHud />);

    expect(screen.getByText(/Tightest furniture clearance/)).toBeDefined();
    expect(screen.queryByText(/table aisle/i)).toBeNull();
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

    expect(screen.getByText(/\d+ clearances below comfortable/)).toBeDefined();
  });

  it("shows a starter layout grade with nothing placed", () => {
    render(<PlannerSpatialHud />);

    const panel = screen.getByTestId("planner-layout-grade");
    expect(panel).toBeDefined();
    expect(panel.textContent).toContain("/100");
    expect(panel.textContent).toMatch(/start placing furniture to grade/i);
  });

  it("grades a placed layout with a band, score, and recommendation", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    expect(roundTable).toBeDefined();
    if (roundTable === undefined) return;

    // Two well-separated dressed tables → an assessable, decent grade.
    usePlacementStore.setState({
      placedItems: [
        { ...createPlacedItem(roundTable.id, 0, 0, 0), clothed: true, clothStyle: "white" },
        { ...createPlacedItem(roundTable.id, 10, 0, 0), clothed: true, clothStyle: "white" },
      ],
    });

    render(<PlannerSpatialHud />);

    const panel = screen.getByTestId("planner-layout-grade");
    expect(panel.textContent).toContain("/100");
    // Aria-label carries the band + score for screen readers.
    expect(panel.getAttribute("aria-label")).toMatch(/Layout grade [SABCD], \d+ out of 100/);
  });

  it("uses the compact grade-card structure for long recommendation copy", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    expect(roundTable).toBeDefined();
    if (roundTable === undefined) return;

    usePlacementStore.setState({
      placedItems: Array.from({ length: 18 }, (_, i) =>
        createPlacedItem(roundTable.id, i * 8, 0, 0),
      ),
    });

    render(<PlannerSpatialHud />);

    const panel = screen.getByTestId("planner-layout-grade");
    expect(panel.querySelector(".planner-spatial-hud__grade-row")).not.toBeNull();
    expect(panel.querySelector(".planner-spatial-hud__grade-badge")).not.toBeNull();
    expect(panel.querySelector(".planner-spatial-hud__grade-headline")).not.toBeNull();
    const recommendation = panel.querySelector(".planner-spatial-hud__grade-recommendation");
    expect(recommendation).not.toBeNull();
    expect(recommendation?.textContent).toContain("18 tables are undressed");
  });
});
