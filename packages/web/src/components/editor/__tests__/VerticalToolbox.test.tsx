import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";

// ---------------------------------------------------------------------------
// VerticalToolbox undo/redo — must drive the editor-store history timeline
// (the single undo timeline shared with the command deck, the 2D blueprint
// toolbar, and the keyboard shortcuts), not a private snapshot stack.
// ---------------------------------------------------------------------------

beforeEach(() => {
  window.localStorage.clear();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [] });
  useSelectionStore.getState().clearSelection();
  useBookmarkStore.setState({
    bookmarks: [],
    pendingNavigationId: null,
    activeReferenceId: null,
    transition: null,
    tour: null,
    nextId: 1,
  });
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
  it("renders the first-visit planner coach as a movable widget with a real catalogue action", async () => {
    renderToolbox();

    const coach = screen.getByTestId("planner-onboarding-widget");
    expect(coach.getAttribute("data-floating-widget-id")).toBe("planner-onboarding");
    expect(screen.getByRole("button", { name: "Move Planner start" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize Planner start" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open furniture" }));

    expect(await screen.findByTestId("furniture-panel")).toBeTruthy();
    expect(screen.queryByTestId("planner-onboarding-widget")).toBeNull();
  });

  it("renders the laser diagram controls as a movable and minimizable widget", async () => {
    renderToolbox();

    fireEvent.click(screen.getByRole("button", { name: "Laser Diagram" }));

    const panel = await screen.findByTestId("markup-panel");
    expect(panel.getAttribute("data-floating-widget-id")).toBe("planner-markup-panel");
    expect(panel.textContent).toContain("Draw notes");
    expect(screen.getByRole("button", { name: "Move Laser diagram" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize Laser diagram" })).toBeTruthy();
  });

  it("renders camera views as a movable widget and still requests bookmark navigation", async () => {
    useBookmarkStore.setState({
      bookmarks: [{
        id: "bookmark-entrance",
        name: "Entrance view",
        kind: "custom",
        position: [0, 1.7, 5],
        target: [0, 1.2, 0],
      }],
    });
    renderToolbox();

    fireEvent.click(screen.getByRole("button", { name: "Camera Views" }));

    const panel = await screen.findByTestId("camera-views-panel");
    expect(panel.getAttribute("data-floating-widget-id")).toBe("planner-camera-views");
    expect(screen.getByRole("button", { name: "Move Camera views" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize Camera views" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Entrance view/u }));

    expect(useBookmarkStore.getState().pendingNavigationId).toBe("bookmark-entrance");
  });

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
