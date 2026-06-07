import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// drei's Html needs the R3F context (useThree) which isn't available without a
// real Canvas; render its children straight into the DOM so the badge is
// queryable. The three intrinsics (group/lineSegments/mesh/…) render as inert
// custom elements in happy-dom.
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { CirculationOverlay } from "../CirculationOverlay.js";

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
}

describe("CirculationOverlay", () => {
  // Silence the expected React "unknown prop" warnings for the three intrinsics.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    resetStore();
  });
  afterEach(() => {
    warn.mockClear();
    error.mockClear();
  });

  it("renders nothing with fewer than two tables", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({ placedItems: [createPlacedItem(roundTable.id, 0, 0, 0)] });

    render(<CirculationOverlay />);

    expect(screen.queryByLabelText(/Tightest table aisle/)).toBeNull();
  });

  it("ignores chairs — two chairs alone draw no aisle", () => {
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (chair === undefined) throw new Error("fixture chair missing");
    usePlacementStore.setState({
      placedItems: [createPlacedItem(chair.id, 0, 0, 0), createPlacedItem(chair.id, 1, 0, 0)],
    });

    render(<CirculationOverlay />);

    expect(screen.queryByLabelText(/Tightest table aisle/)).toBeNull();
  });

  it("draws a labelled aisle once two tables share the floor", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(roundTable.id, 8, 0, 0),
      ],
    });

    render(<CirculationOverlay />);

    const badge = screen.getByLabelText(/Tightest table aisle/);
    expect(badge.textContent).toMatch(/\d\.\d m/);
  });

  it("surfaces every pinch point: one prominent primary plus subtle secondaries", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    // Three tables packed in a tight row (render x 0, 2, 4 → metre centres 0, 1, 2):
    // every consecutive pair is well below the comfortable width, so there is
    // more than one pinch point to surface.
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(roundTable.id, 2, 0, 0),
        createPlacedItem(roundTable.id, 4, 0, 0),
      ],
    });

    render(<CirculationOverlay />);

    const primaries = screen.getAllByLabelText(/Tightest table aisle/);
    const secondaries = screen.getAllByLabelText(/Secondary table aisle/);
    expect(primaries).toHaveLength(1); // exactly one headline aisle
    expect(secondaries.length).toBeGreaterThanOrEqual(1); // the rest marked subtly
  });
});
