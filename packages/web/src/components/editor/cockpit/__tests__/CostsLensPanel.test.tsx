import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { CostsLensPanel } = await import("../CostsLensPanel.js");
const { useCostStore } = await import("../../../../stores/cost-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useLightingRigStore } = await import("../../../../stores/lighting-rig-store.js");
const fixtures = await import("./planner-truth-fixtures.js");

beforeEach(() => {
  venue.status = "trades-hall";
  useLightingRigStore.getState().reset();
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});

afterEach(() => {
  cleanup();
  useCostStore.getState().reset();
  useCockpitStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useLightingRigStore.getState().reset();
  fixtures.resetPlannerTruth();
});

function panelText(): string {
  return screen.getByTestId("costs-lens-panel").textContent ?? "";
}

describe("CostsLensPanel — clients and visitors never see an example price", () => {
  it("offers a visitor the events team's quote and no price at all", () => {
    useCockpitStore.getState().setPlannedGuestCount(100);
    useLightingRigStore.getState().setCount("par", 18);
    render(<CostsLensPanel />);
    expect(panelText()).not.toContain("£");
    expect(screen.queryByTestId("cost-total")).toBeNull();
    expect(screen.queryByTestId("cost-room-hire")).toBeNull();
    const ask = screen.getByTestId("costs-quote-ask");
    expect(ask.textContent).toBe("Ask us for a quote");
    expect(ask.getAttribute("href")).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?/);
  });

  it("carries the plan's own numbers, VAT and compulsory charges into the drafted question", () => {
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<CostsLensPanel />);
    const href = decodeURIComponent(screen.getByTestId("costs-quote-ask").getAttribute("href") ?? "");
    expect(href).toContain("Could you quote for 120 guests in the Grand Hall, including VAT and any compulsory charges?");
    expect(href).toContain("/plan/config-1");
  });

  it("shows a signed-in client the same quote view", () => {
    fixtures.viewAsClient();
    render(<CostsLensPanel />);
    expect(screen.getByTestId("costs-quote")).toBeTruthy();
    expect(panelText()).not.toContain("£");
    expect(panelText()).not.toMatch(/example/i);
  });

  it("treats another venue's floor team as a client here", () => {
    fixtures.viewAsStaff();
    fixtures.openRoom(fixtures.plannerRoom("grand-hall", "Grand Hall", "venue-elsewhere"));
    venue.status = "other";
    render(<CostsLensPanel />);
    expect(screen.getByTestId("costs-quote")).toBeTruthy();
    expect(panelText()).not.toContain("£");
  });

  it("tells a visitor who to ask when the venue publishes no address", () => {
    venue.status = "other";
    fixtures.openRoom(fixtures.plannerRoom("grand-hall", "Grand Hall", "venue-elsewhere"));
    render(<CostsLensPanel />);
    expect(screen.queryByTestId("costs-quote-ask")).toBeNull();
    expect(screen.getByTestId("costs-quote-next").textContent).toBe("Ask the venue's events team when you send your enquiry.");
  });
});

describe("CostsLensPanel — venue staff keep the example scenario, marked as examples", () => {
  beforeEach(() => { fixtures.viewAsStaff(); });

  it("marks every rate as an example, not the venue's price", () => {
    render(<CostsLensPanel />);
    expect(screen.getByText("Cost scenario")).toBeTruthy();
    expect(screen.getByTestId("cost-example-note").textContent).toBe("Example rates, not the venue's prices. Replace them with real figures to plan.");
    // Example room hire £750, margin 0, empty layout, empty rig → £750.00.
    expect(screen.getByTestId("cost-total").textContent).toMatch(/Total at example rates/);
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£750\.00/);
    expect(screen.getByText(/not a quote/i)).toBeTruthy();
  });

  it("adds no lighting hire for fixtures nobody added", () => {
    render(<CostsLensPanel />);
    expect(screen.queryByText("Lighting hire")).toBeNull();
  });

  it("re-totals when a rate is edited", () => {
    render(<CostsLensPanel />);
    fireEvent.change(screen.getByTestId("cost-room-hire"), { target: { value: "1000" } });
    expect(useCostStore.getState().roomHireMinor).toBe(100000);
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£1,000\.00/);
  });

  it("adds the catering line from the planner's guest count (shared with Flow)", () => {
    useCockpitStore.getState().setPlannedGuestCount(100);
    render(<CostsLensPanel />);
    expect(screen.getByText("Catering")).toBeTruthy();
    // £750 room hire + 100 covers × £45 = £5,250.00
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£5,250\.00/);
    expect(screen.getAllByText(/from guest count/i).length).toBeGreaterThan(0);
  });

  it("margin control writes the percent into the store", () => {
    render(<CostsLensPanel />);
    fireEvent.change(screen.getByTestId("cost-margin"), { target: { value: "10" } });
    expect(useCostStore.getState().marginPercent).toBe(10);
  });

  it("adds a lighting hire line only for fixtures someone put in the rig", () => {
    useLightingRigStore.getState().setCount("par", 18); // 18 fixtures × £35 example
    render(<CostsLensPanel />);
    expect(screen.getByText("Lighting hire")).toBeTruthy();
    // £750 room hire + 18 × £35 = £630 → £1,380.00
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£1,380\.00/);
  });
});
