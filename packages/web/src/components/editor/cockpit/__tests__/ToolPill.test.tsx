import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";
import { useToolStore } from "../../../../stores/tool-store.js";
import { useMeasurementStore } from "../../../../stores/measurement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { ToolPill } from "../ToolPill.js";

// ---------------------------------------------------------------------------
// The pill: five hands, one brass active state, a tabular value chip that
// scrubs. Store-level behaviour (measure mirroring) is pinned in
// tool-store.test.ts; here the DOM contract — buttons, pressed states, the
// chip's readout and its scrub — is what renders for the planner.
// ---------------------------------------------------------------------------

function placeTable(id: string, rotationY = 0, scale?: number): PlacedItem {
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("round-table-6ft catalogue item missing");
  return {
    id,
    catalogueItemId: table.id,
    x: 2, y: 0, z: 3,
    rotationY,
    ...(scale === undefined ? {} : { scale }),
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

function resetStores(): void {
  useToolStore.setState({ activeTool: "select", liveValue: null });
  useMeasurementStore.setState({ active: false, pendingPoint: null, measurements: [], nextId: 1 });
  useSelectionStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.setState({ walkMode: false });
}

beforeAll(() => {
  // happy-dom has no pointer-capture; the scrub only needs them to exist.
  for (const [name, impl] of [
    ["setPointerCapture", (): void => undefined],
    ["releasePointerCapture", (): void => undefined],
    ["hasPointerCapture", (): boolean => true],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { value: impl, configurable: true });
  }
});

beforeEach(resetStores);
afterEach(() => {
  cleanup();
  resetStores();
});

describe("ToolPill", () => {
  it("renders the five hands with Select pressed", () => {
    render(<ToolPill />);
    const pill = screen.getByTestId("planner-tool-pill");
    expect(pill).toBeTruthy();
    for (const id of ["select", "move", "rotate", "scale", "measure"]) {
      expect(screen.getByTestId(`planner-tool-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId("planner-tool-select").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("planner-tool-move").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking a hand takes it — pressed state follows the store", () => {
    render(<ToolPill />);
    fireEvent.click(screen.getByTestId("planner-tool-rotate"));
    expect(useToolStore.getState().activeTool).toBe("rotate");
    expect(screen.getByTestId("planner-tool-rotate").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("planner-tool-select").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking Measure arms the tape", () => {
    render(<ToolPill />);
    fireEvent.click(screen.getByTestId("planner-tool-measure"));
    expect(useMeasurementStore.getState().active).toBe(true);
  });

  it("walk mode hides the pill — the hands belong to the plan view", () => {
    useCockpitStore.setState({ walkMode: true });
    render(<ToolPill />);
    expect(screen.queryByTestId("planner-tool-pill")).toBeNull();
  });

  it("no chip without a value to show", () => {
    render(<ToolPill />);
    expect(screen.queryByTestId("planner-tool-value")).toBeNull();
  });

  it("Rotate + a selected table → the chip reads its rotation, tabular", () => {
    usePlacementStore.setState({ placedItems: [placeTable("t1", Math.PI / 2)] });
    useSelectionStore.getState().select("t1");
    useToolStore.getState().setTool("rotate");
    render(<ToolPill />);
    expect(screen.getByTestId("planner-tool-value").textContent).toBe("90°");
  });

  it("Scale + a selected table → the chip reads its multiplier", () => {
    usePlacementStore.setState({ placedItems: [placeTable("t1", 0, 1.25)] });
    useSelectionStore.getState().select("t1");
    useToolStore.getState().setTool("scale");
    render(<ToolPill />);
    expect(screen.getByTestId("planner-tool-value").textContent).toBe("×1.25");
  });

  it("Measure shows the last tape length", () => {
    useToolStore.getState().setTool("measure");
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([3, 0, 4]);
    render(<ToolPill />);
    expect(screen.getByTestId("planner-tool-value").textContent).toBe("5.00 m");
  });

  it("scrubbing the chip rotates the selection in fine steps", () => {
    usePlacementStore.setState({ placedItems: [placeTable("t1", 0)] });
    useSelectionStore.getState().select("t1");
    useToolStore.getState().setTool("rotate");
    render(<ToolPill />);

    const chip = screen.getByTestId("planner-tool-value");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 190 }); // +90 px → +45°
    const item = usePlacementStore.getState().placedItems[0];
    expect(item?.rotationY).toBeCloseTo(Math.PI / 4, 6);
    expect(screen.getByTestId("planner-tool-value").textContent).toBe("45°");

    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 190 });
    expect(useToolStore.getState().liveValue).toBeNull();
  });

  it("scrubbing in Scale writes clamped hundredth steps", () => {
    usePlacementStore.setState({ placedItems: [placeTable("t1", 0, 1)] });
    useSelectionStore.getState().select("t1");
    useToolStore.getState().setTool("scale");
    render(<ToolPill />);

    const chip = screen.getByTestId("planner-tool-value");
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 140 }); // +40 px → +0.20
    const item = usePlacementStore.getState().placedItems[0];
    expect(item?.scale).toBeCloseTo(1.2, 6);
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 140 });
  });
});
