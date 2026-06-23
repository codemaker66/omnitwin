import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CostsLensPanel } from "../CostsLensPanel.js";
import { useCostStore } from "../../../../stores/cost-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";

// Clear the shared lighting rig so the layout-only assertions are not perturbed
// by the starter rig's lighting hire line (the rig path is asserted explicitly).
beforeEach(() => { useLightingRigStore.getState().clear(); });

afterEach(() => {
  cleanup();
  useCostStore.getState().reset();
  useCockpitStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useLightingRigStore.getState().reset();
});

describe("CostsLensPanel", () => {
  it("renders the scenario with the room-hire-only estimate by default", () => {
    render(<CostsLensPanel />);
    expect(screen.getByTestId("costs-lens-panel")).toBeTruthy();
    expect(screen.getByText("Cost scenario")).toBeTruthy();
    // Default room hire £750, margin 0, empty layout → total £750.00.
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£750\.00/);
    expect(screen.getByText(/not a quote/i)).toBeTruthy();
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
    expect(screen.getByText(/from guest count/i)).toBeTruthy();
  });

  it("margin control writes the percent into the store", () => {
    render(<CostsLensPanel />);
    fireEvent.change(screen.getByTestId("cost-margin"), { target: { value: "10" } });
    expect(useCostStore.getState().marginPercent).toBe(10);
  });

  it("adds a lighting hire line from the Lighting lens rig", () => {
    useLightingRigStore.getState().setCount("par", 18); // 18 fixtures × £35 default
    render(<CostsLensPanel />);
    expect(screen.getByText("Lighting hire")).toBeTruthy();
    // £750 room hire + 18 × £35 = £630 → £1,380.00
    expect(screen.getByTestId("cost-total").textContent).toMatch(/£1,380\.00/);
  });
});
