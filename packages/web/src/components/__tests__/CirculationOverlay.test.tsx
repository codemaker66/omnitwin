import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// drei's Html needs the R3F context (useThree) which isn't available without a
// real Canvas; render its children straight into the DOM so the badge is
// queryable. The three intrinsics (group/lineSegments/mesh/…) render as inert
// custom elements in happy-dom.
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: { readonly size: { readonly width: number; readonly height: number } }) => T): T =>
    selector({ size: { width: 1440, height: 900 } }),
  useFrame: () => undefined,
}));

import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";
import { useAssemblyRecallStore } from "../../floor/assembly/recall.js";
import {
  CirculationOverlay,
  MAX_RENDERED_CIRCULATION_SEGMENTS,
  circulationDotMaterial,
  circulationLineMaterial,
  shouldRenderCirculationOverlay,
  worldPerPixel,
} from "../CirculationOverlay.js";

function resetStore(): void {
  usePlacementStore.setState({
    placedItems: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useDoorClearSpaceStore.getState().setCarrying(false);
  useAssemblyRecallStore.setState({ active: false });
}

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`fixture ${slug} missing`);
  return item.id;
}

/** Two rounds 1 m apart, centre to centre: a pinch the overlay always draws. */
function twoRoundsInAPinch(): void {
  const round = catalogueId("round-table-6ft");
  usePlacementStore.setState({ placedItems: [createPlacedItem(round, 0, 0, 0), createPlacedItem(round, 2, 0, 0)] });
}

function shown(): boolean {
  return screen.queryByLabelText(/Tightest furniture clearance/) !== null;
}

describe("CirculationOverlay: when it shows", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    resetStore();
    twoRoundsInAPinch();
  });
  afterEach(() => {
    cleanup();
    resetStore();
    warn.mockClear();
    error.mockClear();
  });

  it("draws nothing on a layout at rest", () => {
    render(<CirculationOverlay />);
    expect(shown()).toBe(false);
  });

  it("draws while a piece is selected, carried or in hand", () => {
    const [first] = usePlacementStore.getState().placedItems;
    if (first === undefined) throw new Error("fixture layout missing");
    useSelectionStore.getState().select(first.id);
    const { unmount } = render(<CirculationOverlay />);
    expect(shown(), "selected").toBe(true);
    unmount();

    useSelectionStore.getState().clearSelection();
    useDoorClearSpaceStore.getState().setCarrying(true);
    const carried = render(<CirculationOverlay />);
    expect(shown(), "carried").toBe(true);
    carried.unmount();

    useDoorClearSpaceStore.getState().setCarrying(false);
    useCatalogueStore.getState().selectItem(catalogueId("round-table-6ft"));
    render(<CirculationOverlay />);
    expect(shown(), "in hand").toBe(true);
  });

  it("draws nothing while a cloth dresses the tables, which moves no furniture", () => {
    useCatalogueStore.getState().selectItem(catalogueId("white-table-cloth"));
    render(<CirculationOverlay />);
    expect(shown()).toBe(false);
  });

  it("draws nothing while the hall assembles, even over a selection", () => {
    const [first] = usePlacementStore.getState().placedItems;
    if (first === undefined) throw new Error("fixture layout missing");
    useSelectionStore.getState().select(first.id);
    useAssemblyRecallStore.setState({ active: true });
    render(<CirculationOverlay />);
    expect(shown()).toBe(false);
  });
});

describe("CirculationOverlay: light on the floor", () => {
  it("lays its lines and dots on the floor, depth-tested and leaving the floor's normal to the occlusion", () => {
    const line = circulationLineMaterial("#c8553d", true);
    const dot = circulationDotMaterial("#c8553d");
    for (const material of [line, dot]) {
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.transparent).toBe(true);
      expect(material.mrtNode).not.toBeNull();
    }
    line.dispose();
    dot.dispose();
  });

  it("sizes a dot in pixels: a perspective camera by the dot's depth, an orthographic one by its frustum", () => {
    const perspective = new PerspectiveCamera(50, 1, 0.1, 100);
    perspective.position.set(0, 10, 0);
    perspective.lookAt(0, 0, 0);
    perspective.updateMatrixWorld();
    const atTen = worldPerPixel(perspective, 900, new Vector3(0, 0, 0));
    expect(atTen).toBeCloseTo((2 * 10 * Math.tan((50 * Math.PI) / 360)) / 900, 9);
    // Twice as deep, twice the world size for the same pixels.
    expect(worldPerPixel(perspective, 900, new Vector3(0, -10, 0))).toBeCloseTo(2 * atTen, 9);

    const orthographic = new OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
    orthographic.zoom = 2;
    expect(worldPerPixel(orthographic, 600, new Vector3(3, 0, 1))).toBeCloseTo(12 / (2 * 600), 9);
  });
});

describe("CirculationOverlay while the layout is being edited", () => {
  // Silence the expected React "unknown prop" warnings for the three intrinsics.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    resetStore();
    // Any selection is an edit; the overlay draws the whole layout's clearances, whichever is selected.
    useSelectionStore.getState().select("a-selected-piece");
  });
  afterEach(() => {
    cleanup();
    resetStore();
  });
  afterEach(() => {
    warn.mockClear();
    error.mockClear();
  });

  it("renders nothing with fewer than two planning footprints", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({ placedItems: [createPlacedItem(roundTable.id, 0, 0, 0)] });

    render(<CirculationOverlay />);

    expect(screen.queryByLabelText(/Tightest furniture clearance/)).toBeNull();
  });

  it("ignores chairs — two chairs alone draw no aisle", () => {
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (chair === undefined) throw new Error("fixture chair missing");
    usePlacementStore.setState({
      placedItems: [createPlacedItem(chair.id, 0, 0, 0), createPlacedItem(chair.id, 1, 0, 0)],
    });

    render(<CirculationOverlay />);

    expect(screen.queryByLabelText(/Tightest furniture clearance/)).toBeNull();
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

    const badge = screen.getByLabelText(/Tightest furniture clearance/);
    expect(badge.textContent).toMatch(/\d\.\d m/);
  });

  it("labels a table-to-mic-stand gap as furniture clearance", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    const micStand = getCatalogueItemBySlug("mic-stand");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    if (micStand === undefined) throw new Error("fixture mic stand missing");
    usePlacementStore.setState({
      placedItems: [
        createPlacedItem(roundTable.id, 0, 0, 0),
        createPlacedItem(micStand.id, 4, 0, 0),
      ],
    });

    render(<CirculationOverlay />);

    expect(screen.getByLabelText(/Tightest furniture clearance/)).toBeDefined();
    expect(screen.queryByLabelText(/table aisle/i)).toBeNull();
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

    const { container } = render(<CirculationOverlay />);

    const primaries = screen.getAllByLabelText(/Tightest furniture clearance/);
    expect(primaries).toHaveLength(1); // exactly one headline aisle
    expect(screen.queryByLabelText(/Secondary furniture clearance/)).toBeNull();
    expect(container.querySelectorAll("linesegments").length).toBeGreaterThanOrEqual(2);
  });

  it("caps rendered aisle markers so dense invalid layouts do not mount unbounded Html projections", () => {
    const roundTable = getCatalogueItemBySlug("round-table-6ft");
    if (roundTable === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({
      placedItems: Array.from({ length: 14 }, (_, index) =>
        createPlacedItem(roundTable.id, index * 1.6, 0, 0),
      ),
    });

    const { container } = render(<CirculationOverlay />);

    expect(container.querySelectorAll("linesegments").length).toBeLessThanOrEqual(
      MAX_RENDERED_CIRCULATION_SEGMENTS,
    );
    expect(screen.getAllByLabelText(/Tightest furniture clearance/)).toHaveLength(1);
    expect(screen.queryByLabelText(/Secondary furniture clearance/)).toBeNull();
  });

  it("does not mount 3D circulation annotations on mobile and tablet planner canvases", () => {
    expect(shouldRenderCirculationOverlay(390)).toBe(false);
    expect(shouldRenderCirculationOverlay(768)).toBe(false);
    expect(shouldRenderCirculationOverlay(1024)).toBe(false);
    expect(shouldRenderCirculationOverlay(1440)).toBe(true);
  });
});
