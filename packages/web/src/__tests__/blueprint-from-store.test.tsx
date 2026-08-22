import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlueprintPage } from "../pages/BlueprintPage.js";
import { useEditorStore } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// BlueprintFromStore — the 2D paper view of the live editor store.
// The canvas toolbar's undo/redo buttons must drive the same editor-store
// history as the 3D view, so a change made in 3D can be undone from 2D
// and vice versa (one timeline across both views).
// ---------------------------------------------------------------------------

beforeEach(() => {
  useEditorStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

describe("BlueprintFromStore undo toolbar", () => {
  it("renders the canonical mic stand with a truthful floor-equipment label", () => {
    const micStand = CANONICAL_ASSETS.find((asset) => asset.slug === "mic-stand");
    expect(micStand).toBeDefined();
    if (micStand === undefined) return;
    useEditorStore.getState().addObject(micStand.id, 0, 0, 0);

    render(<BlueprintPage source="editor-store" />);

    expect(screen.getAllByText("Mic stand").length).toBeGreaterThan(0);
    expect(screen.getByText("MIC STAND · 0.5×0.5M")).toBeTruthy();
    expect(screen.queryByText(/MIC STAND.*SEAT/i)).toBeNull();
  });

  it("disables undo and redo when the editor history is empty", () => {
    render(<BlueprintPage source="editor-store" />);

    const undo = screen.getByTitle<HTMLButtonElement>("Undo (⌘Z)");
    const redo = screen.getByTitle<HTMLButtonElement>("Redo (⌘⇧Z)");
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
  });

  it("undoes and redoes editor-store changes from the 2D toolbar", () => {
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    expect(useEditorStore.getState().objects).toHaveLength(1);

    render(<BlueprintPage source="editor-store" />);

    const undo = screen.getByTitle<HTMLButtonElement>("Undo (⌘Z)");
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(useEditorStore.getState().objects).toHaveLength(0);

    const redo = screen.getByTitle<HTMLButtonElement>("Redo (⌘⇧Z)");
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });
});

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

describe("direct blueprint routes", () => {
  it("enters the shared planner policy gate before requesting a saved 2D view", () => {
    render(
      <MemoryRouter initialEntries={["/blueprint/config-1"]}>
        <Routes>
          <Route path="/blueprint/:configId" element={<BlueprintPage source="route" />} />
          <Route path="/plan/:configId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location").textContent).toBe("/plan/config-1?view=2d");
    expect(screen.queryByText("Grand Hall")).toBeNull();
  });

  it("routes the unscoped demo entry through planner room resolution", () => {
    render(
      <MemoryRouter initialEntries={["/blueprint"]}>
        <Routes>
          <Route path="/blueprint" element={<BlueprintPage source="route" />} />
          <Route path="/plan" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location").textContent).toBe("/plan?view=2d");
    expect(screen.queryByText("Grand Hall")).toBeNull();
  });
});
