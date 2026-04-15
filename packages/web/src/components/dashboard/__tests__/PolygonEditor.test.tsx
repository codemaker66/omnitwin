import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { FloorPlanPoint } from "@omnitwin/types";
import { PolygonEditor } from "../PolygonEditor.js";

// ---------------------------------------------------------------------------
// Test harness: controlled wrapper that exposes the latest polygon value as
// JSON on a data-testid so we can assert on onChange behaviour across
// multi-step interactions.
// ---------------------------------------------------------------------------

function TestHarness({ initial }: { initial: readonly FloorPlanPoint[] }): React.ReactElement {
  const [value, setValue] = useState<readonly FloorPlanPoint[]>(initial);
  return (
    <>
      <div data-testid="harness-value">{JSON.stringify(value)}</div>
      <PolygonEditor value={value} onChange={setValue} />
    </>
  );
}

function readValue(container: HTMLElement): readonly FloorPlanPoint[] {
  const node = container.querySelector("[data-testid='harness-value']");
  if (node === null) return [];
  const text = node.textContent;
  if (text === "") return [];
  return JSON.parse(text) as readonly FloorPlanPoint[];
}

/** Returns the i-th point or throws if absent. Keeps test code terse
 *  without reaching for non-null assertions (which the lint config bans). */
function at(points: readonly FloorPlanPoint[], i: number): FloorPlanPoint {
  const p = points[i];
  if (p === undefined) throw new Error(`expected a point at index ${String(i)}`);
  return p;
}

// happy-dom's getBoundingClientRect returns zeros, so clientX/Y === canvas
// coords — there's no stubbing needed and the math in PolygonEditor
// (rect.left === 0, rect.top === 0) is the identity. We pick coords in the
// 400×400 canvas space directly.

const RECTANGLE_10X10: readonly FloorPlanPoint[] = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

describe("PolygonEditor", () => {
  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Initial render
  // -------------------------------------------------------------------------

  it("renders the editor scaffold and readout", () => {
    const { getByTestId } = render(<TestHarness initial={[]} />);
    expect(getByTestId("polygon-editor")).toBeDefined();
    expect(getByTestId("polygon-readout").textContent).toMatch(/need\s+3\s+more/i);
  });

  it("renders no <polygon> when the value is empty", () => {
    const { container } = render(<TestHarness initial={[]} />);
    expect(container.querySelector("[data-testid='polygon-shape']")).toBeNull();
  });

  it("renders a <polygon> once the value has ≥ 3 points", () => {
    const { getByTestId } = render(<TestHarness initial={RECTANGLE_10X10} />);
    expect(getByTestId("polygon-shape")).toBeDefined();
  });

  it("renders one vertex handle per point", () => {
    const { container } = render(<TestHarness initial={RECTANGLE_10X10} />);
    expect(container.querySelectorAll("[data-testid^='polygon-vertex-']").length).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Click-to-add
  // -------------------------------------------------------------------------

  it("appends a vertex when the user clicks on empty canvas", () => {
    const { container, getByRole } = render(<TestHarness initial={[]} />);
    const svg = getByRole("application");

    // Empty viewport is 12m square centred on origin, so canvas centre
    // (200, 200) maps to world (0, 0).
    fireEvent.mouseDown(svg, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);

    const after = readValue(container);
    expect(after).toHaveLength(1);
    expect(at(after, 0).x).toBeCloseTo(0, 5);
    expect(at(after, 0).y).toBeCloseTo(0, 5);
  });

  it("builds a 3-point polygon through three successive clicks", () => {
    const { container, getByRole, getByTestId } = render(<TestHarness initial={[]} />);
    const svg = getByRole("application");

    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseUp(svg);
    fireEvent.mouseDown(svg, { button: 0, clientX: 250, clientY: 150 });
    fireEvent.mouseUp(svg);
    fireEvent.mouseDown(svg, { button: 0, clientX: 200, clientY: 250 });
    fireEvent.mouseUp(svg);

    expect(readValue(container)).toHaveLength(3);
    // Once the polygon has ≥ 3 points, the closed <polygon> shape renders.
    expect(getByTestId("polygon-shape")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Drag to reposition
  // -------------------------------------------------------------------------

  it("moves a vertex on mousedown+mousemove+mouseup at its canvas location", () => {
    const { container, getByRole } = render(<TestHarness initial={RECTANGLE_10X10} />);
    const svg = getByRole("application");

    // 10×10 polygon → viewport 13m → scale 360/13 ≈ 27.692 px/m.
    // World (-5, -5) → canvas (200 - 5*27.692, 200 - 5*27.692) ≈ (61.54, 61.54).
    const scale = (400 - 40) / 13;
    const vx = 200 - 5 * scale;
    const vy = 200 - 5 * scale;

    fireEvent.mouseDown(svg, { button: 0, clientX: vx, clientY: vy });
    // Drag to canvas (100, 100) → the viewport is frozen during drag, so
    // the world mapping continues to use size=13 centred on origin.
    fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(svg);

    const after = readValue(container);
    expect(after).toHaveLength(4);
    // First vertex should have moved (not identical to the original (-5, -5)).
    expect(at(after, 0).x).not.toBe(-5);
    expect(at(after, 0).y).not.toBe(-5);
    // World coords: (100 - 200) / 27.69 = -3.611 — both axes move by the same
    // amount since we dragged symmetrically.
    expect(at(after, 0).x).toBeCloseTo((100 - 200) / scale, 2);
    expect(at(after, 0).y).toBeCloseTo((100 - 200) / scale, 2);
  });

  it("preserves vertex DOM identity across a drag (stable React key)", () => {
    // Regression: the previous key included canvas coordinates, so React
    // unmounted and remounted the circle on every mousemove — wasteful
    // and a smell that future expensive children (drei labels, refs)
    // would silently churn. Index-based key is the only stable identifier.
    const { container, getByRole, getByTestId } = render(<TestHarness initial={RECTANGLE_10X10} />);
    const svg = getByRole("application");

    const before = getByTestId("polygon-vertex-0");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 120, clientY: 120 });
    fireEvent.mouseMove(svg, { clientX: 140, clientY: 140 });
    fireEvent.mouseMove(svg, { clientX: 160, clientY: 160 });
    fireEvent.mouseUp(svg);
    const after = container.querySelector("[data-testid='polygon-vertex-0']");
    // Same DOM node — React reused it instead of remounting on each tick.
    expect(after).toBe(before);
  });

  it("does not move any vertex when the user clicks far from every handle", () => {
    // Click on empty canvas with a non-empty polygon → appends a new vertex,
    // does NOT move an existing one.
    const { container, getByRole } = render(<TestHarness initial={RECTANGLE_10X10} />);
    const svg = getByRole("application");
    fireEvent.mouseDown(svg, { button: 0, clientX: 200, clientY: 200 }); // world (0, 0)
    fireEvent.mouseUp(svg);

    const after = readValue(container);
    expect(after).toHaveLength(5);
    // Original four points are preserved in order.
    expect(after.slice(0, 4)).toEqual(RECTANGLE_10X10);
    // New point is at world origin.
    expect(at(after, 4).x).toBeCloseTo(0, 5);
    expect(at(after, 4).y).toBeCloseTo(0, 5);
  });

  // -------------------------------------------------------------------------
  // Right-click to delete (min-3-point guard)
  // -------------------------------------------------------------------------

  it("deletes a vertex on right-click when polygon has > 3 points", () => {
    // 5-point pentagon-ish shape so we can drop one and stay ≥ 3.
    const initial: readonly FloorPlanPoint[] = [
      { x: -4, y: -4 },
      { x: 4, y: -4 },
      { x: 5, y: 0 },
      { x: 4, y: 4 },
      { x: -4, y: 4 },
    ];
    const { container, getByRole } = render(<TestHarness initial={initial} />);
    const svg = getByRole("application");

    // Viewport: bbox minX=-4, maxX=5, centreX=0.5; bbox minY=-4, maxY=4, centreY=0.
    // sizeM = max(12, 9*1.3) = 12. scale = 360/12 = 30.
    // World (5, 0) → canvas (200 + (5 - 0.5)*30, 200 + (0 - 0)*30) = (335, 200).
    fireEvent.contextMenu(svg, { clientX: 335, clientY: 200 });

    const after = readValue(container);
    expect(after).toHaveLength(4);
    // The (5, 0) vertex is gone; the other four survive in their original order.
    expect(after).toEqual([initial[0], initial[1], initial[3], initial[4]]);
  });

  it("REFUSES to delete a vertex when doing so would leave < 3 points", () => {
    // Triangle — deleting any vertex would drop below the min-3 threshold.
    const triangle: readonly FloorPlanPoint[] = [
      { x: -3, y: -3 },
      { x: 3, y: -3 },
      { x: 0, y: 3 },
    ];
    const { container, getByRole } = render(<TestHarness initial={triangle} />);
    const svg = getByRole("application");

    // Viewport: bbox 6×6, sizeM = max(12, 6*1.3) = 12. scale = 360/12 = 30.
    // Vertex (-3, -3) is at canvas (200 - 90, 200 - 90) = (110, 110).
    fireEvent.contextMenu(svg, { clientX: 110, clientY: 110 });

    const after = readValue(container);
    expect(after).toHaveLength(3);
    expect(after).toEqual(triangle);
  });

  it("does not delete on right-click when there's no vertex under the cursor", () => {
    const { container, getByRole } = render(<TestHarness initial={RECTANGLE_10X10} />);
    const svg = getByRole("application");

    // Dead centre of the polygon — no vertex within the hit radius.
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 200 });

    expect(readValue(container)).toEqual(RECTANGLE_10X10);
  });

  // -------------------------------------------------------------------------
  // Reset / Clear convenience
  // -------------------------------------------------------------------------

  it("Reset to rectangle seeds a 4-point square centred on the origin", () => {
    const { container, getByTestId } = render(<TestHarness initial={[]} />);
    fireEvent.click(getByTestId("polygon-reset-rectangle"));

    const after = readValue(container);
    expect(after).toHaveLength(4);
    // Centred on origin → opposite corners are negatives of each other.
    expect(at(after, 0).x).toBeCloseTo(-at(after, 2).x, 5);
    expect(at(after, 0).y).toBeCloseTo(-at(after, 2).y, 5);
  });

  it("Clear empties the polygon", () => {
    const { container, getByTestId } = render(<TestHarness initial={RECTANGLE_10X10} />);
    fireEvent.click(getByTestId("polygon-clear"));
    expect(readValue(container)).toHaveLength(0);
  });

  it("Clear is disabled when the polygon is already empty", () => {
    const { getByTestId } = render(<TestHarness initial={[]} />);
    expect((getByTestId("polygon-clear") as HTMLButtonElement).disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Bounding-box readout
  // -------------------------------------------------------------------------

  it("reports the bounding box of the current polygon", () => {
    const { getByTestId } = render(<TestHarness initial={RECTANGLE_10X10} />);
    const readout = getByTestId("polygon-readout").textContent;
    expect(readout).toMatch(/10\.00m.*×.*10\.00m/);
    expect(readout).toMatch(/4\s+vertices/i);
  });

  // -------------------------------------------------------------------------
  // Disabled mode
  // -------------------------------------------------------------------------

  it("ignores mouse events and disables buttons when disabled", () => {
    const { container, getByRole, getByTestId } = render(
      <TestHarnessDisabled initial={RECTANGLE_10X10} />,
    );
    const svg = getByRole("application");
    fireEvent.mouseDown(svg, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.contextMenu(svg, { clientX: 50, clientY: 50 });
    expect(readValue(container)).toEqual(RECTANGLE_10X10);
    expect((getByTestId("polygon-reset-rectangle") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("polygon-clear") as HTMLButtonElement).disabled).toBe(true);
  });
});

function TestHarnessDisabled({ initial }: { initial: readonly FloorPlanPoint[] }): React.ReactElement {
  const [value, setValue] = useState<readonly FloorPlanPoint[]>(initial);
  return (
    <>
      <div data-testid="harness-value">{JSON.stringify(value)}</div>
      <PolygonEditor value={value} onChange={setValue} disabled />
    </>
  );
}
