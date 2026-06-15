import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitMinimap } from "../CockpitMinimap.js";

function resetStores(): void {
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
}

beforeEach(resetStores);
afterEach(() => { cleanup(); resetStores(); });

describe("CockpitMinimap", () => {
  it("renders the plan-view inset with the SAFE planning-overview note", () => {
    render(<CockpitMinimap />);
    expect(screen.getByText("Plan view")).toBeTruthy();
    expect(screen.getByText(/Planning overview · click to recentre/)).toBeTruthy();
  });

  it("plots a dot for each placed item", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({
      placedItems: [createPlacedItem(table.id, 0, 0, 0), createPlacedItem(table.id, 4, 0, 0)],
    });
    const { container } = render(<CockpitMinimap />);
    expect(container.querySelectorAll(".cockpit-minimap__dot")).toHaveLength(2);
  });

  it("requests a camera recentre when the plan is clicked", () => {
    render(<CockpitMinimap />);
    expect(useCockpitStore.getState().focusRequest).toBeNull();
    fireEvent.click(screen.getByLabelText(/Recentre the planner camera/), { clientX: 10, clientY: 12 });
    const focus = useCockpitStore.getState().focusRequest;
    expect(focus).not.toBeNull();
    expect(focus?.nonce).toBe(1);
    expect(Number.isFinite(focus?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(focus?.z ?? NaN)).toBe(true);
  });
});
