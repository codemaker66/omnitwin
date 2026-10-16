import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";
import type { CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));
// The change-history section reads the recorded trail; it has its own suite.
vi.mock("../../../../api/action-log.js", () => ({
  getActionLog: () => Promise.resolve({ entries: [], nextAfter: 0 }),
}));

const { EvidenceLensPanel } = await import("../EvidenceLensPanel.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useRoomDimensionsStore } = await import("../../../../stores/room-dimensions-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { CATALOGUE_ITEMS } = await import("../../../../lib/catalogue.js");
const fixtures = await import("./planner-truth-fixtures.js");

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
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];

function panelText(): string {
  return screen.getByTestId("evidence-lens-panel").textContent ?? "";
}

beforeEach(() => {
  venue.status = "trades-hall";
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useRoomDimensionsStore.getState().setDimensions({ width: 42, length: 20, height: 7 }); // real 21×10
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});

afterEach(() => { cleanup(); fixtures.resetPlannerTruth(); });

describe("EvidenceLensPanel — what is recorded, never a pass", () => {
  it("states the published figure for the layout with who stated it, and no Pass chip", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(80);
    render(<EvidenceLensPanel />);
    expect(screen.getByText("Layout evidence")).toBeTruthy();
    expect(screen.getByTestId("evidence-status-seating").textContent).toBe("Noted");
    expect(screen.getByTestId("evidence-status-capacity").textContent).toBe("Noted");
    expect(screen.getByTestId("evidence-check-capacity").textContent).toContain("Published 180 for dinner.");
    expect(screen.getByTestId("evidence-source-capacity").textContent).toBe("Published guide · Trades Hall · 9 Jul 2026");
    expect(panelText()).not.toMatch(/\bpass\b/i);
  });

  it("shows escape routes and the room's maximum as not recorded, asking the events team", () => {
    useCockpitStore.getState().setPlannedGuestCount(80);
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-check-escape-routes-status").textContent).toBe("Not recorded");
    expect(screen.getByTestId("evidence-check-escape-routes").textContent).toContain("fire risk assessment");
    const ask = screen.getByTestId("evidence-check-escape-routes-ask");
    expect(ask.textContent).toBe("Ask the events team");
    expect(decodeURIComponent(ask.getAttribute("href") ?? "")).toContain("What does the fire risk assessment allow in the Grand Hall");
  });

  it("names the hallkeeper for venue staff", () => {
    fixtures.viewAsStaff();
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-check-escape-routes-ask").textContent).toBe("Ask the hallkeeper");
  });

  it("quotes no England or US code for a Glasgow building", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(300);
    render(<EvidenceLensPanel />);
    expect(panelText()).not.toMatch(/\b(ADB|Approved Document|NFPA|BS 9999)\b/);
    expect(panelText()).not.toMatch(/\d+ mm total clear exit width/);
  });

  it("puts a count above the published figure up for review, with the person to ask", () => {
    usePlacementStore.setState({ placedItems: withChairs(200) });
    useCockpitStore.getState().setPlannedGuestCount(200);
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-status-capacity").textContent).toBe("Review");
    expect(screen.getByTestId("evidence-check-capacity").textContent).toContain("200 guests is more than the published 180 for dinner.");
    expect(screen.getByTestId("evidence-ask-capacity").textContent).toBe("Ask the events team");
  });

  it("flags a seat shortfall as Review", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-status-seating").textContent).toBe("Review");
    expect(screen.getByTestId("evidence-check-seating").textContent).toMatch(/Short 40 seats/);
  });

  it("asks for seating before reading a layout against the published figures", () => {
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-check-capacity").textContent).toContain("Add seating to read the layout against the published figures.");
    expect(screen.getByTestId("evidence-summary").textContent).toContain("1 not recorded");
  });

  it("shows another venue's room as having no published capacity here", () => {
    venue.status = "other";
    fixtures.openRoom(fixtures.plannerRoom("grand-hall", "Grand Hall", "venue-elsewhere"));
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-check-capacity-status").textContent).toBe("Not recorded");
    expect(panelText()).not.toContain("180");
  });

  it("shows honest work while the venue is being read", () => {
    venue.status = "reading";
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-check-capacity").querySelector("[data-activity-indicator]")).not.toBeNull();
  });
});
