import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// VerticalToolbox undo/redo — must drive the editor-store history timeline
// (the single undo timeline shared with the command deck, the 2D blueprint
// toolbar, and the keyboard shortcuts), not a private snapshot stack.
// ---------------------------------------------------------------------------

beforeEach(() => {
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});

function renderToolbox(): void {
  render(
    <MemoryRouter>
      <VerticalToolbox />
    </MemoryRouter>,
  );
}

describe("VerticalToolbox undo buttons", () => {
  it("disables undo and redo while the editor history is empty", () => {
    renderToolbox();

    const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
    const redo = screen.getByRole<HTMLButtonElement>("button", { name: "Redo" });
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
  });

  it("undoes the last editor-store change from the toolbar", () => {
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    renderToolbox();

    const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(useEditorStore.getState().objects).toHaveLength(0);
  });

  it("redoes an undone editor-store change from the toolbar", () => {
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    useEditorStore.getState().undo();
    renderToolbox();

    const redo = screen.getByRole<HTMLButtonElement>("button", { name: "Redo" });
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it("restores the captured selection when undoing, matching the keyboard + command deck", () => {
    // Place an item, select it, then move it — the move records [id] as the
    // selection to restore to. Deselect, then undo the move from the toolbar:
    // the toolbar must re-select what the store captured, NOT force-clear it.
    // (The store's HistoryIdAdapter remaps ids, so no dead id is restored.)
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    const placed = useEditorStore.getState().objects.at(0);
    expect(placed).toBeDefined();
    const id = placed?.id ?? "";
    useSelectionStore.getState().select(id);
    useEditorStore.getState().updateObject(id, { positionX: 3 });
    useSelectionStore.getState().clearSelection();
    renderToolbox();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect([...useSelectionStore.getState().selectedIds]).toEqual([id]);
  });
});
