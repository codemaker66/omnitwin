import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configurationApi from "../../../api/configurations.js";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useToolStore } from "../../../stores/tool-store.js";
import { useMarkupStore } from "../../../stores/markup-store.js";
import { usePlannerToolKeys } from "../../../lib/planner-keymap.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";

/** The editor page's tool keys (A, D, M, V and the tools' Escapes), which reach the toolbox through the tool store. */
function ToolKeys(): null {
  usePlannerToolKeys();
  return null;
}

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
  useToolStore.getState().setTool("select");
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
  vi.restoreAllMocks();
  useEditorStore.getState().reset();
});

function renderToolbox(): void {
  render(
    <MemoryRouter>
      <ToolKeys />
      <VerticalToolbox />
    </MemoryRouter>,
  );
}

describe("VerticalToolbox undo buttons", () => {
  it("shows newer dirty, busy, failed and conflicted state immediately after a successful save", async () => {
    useEditorStore.setState({ configId: "saved", configRevision: 1, isPublicPreview: true, isDirty: true });
    vi.spyOn(configurationApi, "publicBatchSave").mockResolvedValue({ objects: [], revision: 2 });
    renderToolbox();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unsaved changes" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Layout saved" })).toBeTruthy();
    act(() => { useEditorStore.getState().addObject("a1", 1, 0, 2); });
    expect(screen.getByRole("button", { name: "Unsaved changes" })).toBeTruthy();
    act(() => { useEditorStore.setState({ isSaving: true }); });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saving…" }).querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Network failed" }); });
    expect(screen.getByRole("button", { name: "Save failed - retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save failed - retry" }).querySelector("[data-activity-indicator]")).toBeNull();
    act(() => { useEditorStore.setState({ saveConflict: { expectedRevision: 2, currentRevision: 3, message: "Changed",
      changedBy: null, changedAt: null, byYou: false, theirChange: null } }); });
    expect(screen.getByRole("button", { name: "Reload layout" })).toBeTruthy();
  });

  // A save the API refused because it would change a note this browser is not
  // shown (409 NOTE_HELD): the same save meets the same refusal.
  it.each([
    ["NOTE_HELD", "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece."],
    ["HELD_PIECE_OMITTED", "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back."],
  ])("shows a save refused over a held note in the API's own words, with no Retry (%s)", (code, refusal) => {
    useEditorStore.setState({ configId: "saved", configRevision: 1, isPublicPreview: true, isDirty: true, saveError: refusal, saveErrorCode: code });
    renderToolbox();
    const save = screen.getByRole("button", { name: refusal });
    expect(save.textContent).toBe("Unsaved");
    expect(screen.queryByRole("button", { name: /retry/iu })).toBeNull();
    expect(document.body.textContent).not.toMatch(/retry/iu);
    // Any other failed save reads as it did.
    act(() => { useEditorStore.setState({ saveError: "Network failed", saveErrorCode: "NETWORK_ERROR" }); });
    expect(screen.getByRole("button", { name: "Save failed - retry" })).toBeTruthy();
  });

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

  it("renders the draw controls as a movable and minimizable widget, in the planner's word for them", async () => {
    renderToolbox();

    fireEvent.click(screen.getByRole("button", { name: "Draw" }));

    const panel = await screen.findByTestId("markup-panel");
    expect(panel.getAttribute("data-floating-widget-id")).toBe("planner-markup-panel");
    expect(panel.textContent).toContain("Draw notes");
    expect(screen.getByRole("button", { name: "Move Draw tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize Draw tools" })).toBeTruthy();
    // QoL F-15: "Laser" is the retired name; nothing a person reads or hears says it.
    const heard = [...document.body.querySelectorAll("*")].flatMap((node) => ["aria-label", "title"].map((name) => node.getAttribute(name) ?? ""));
    expect([document.body.textContent ?? "", ...heard].join("\n")).not.toMatch(/laser/iu);
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

// ---------------------------------------------------------------------------
// Exit animations — a panel stays mounted for its exit, and a panel that was
// never open starts no timer. A stray timer outlives a test that leaves the
// planner mounted and fires after the test environment is gone.
// ---------------------------------------------------------------------------

describe("VerticalToolbox panel exits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts no exit timers for panels that were never open", () => {
    vi.useFakeTimers();
    renderToolbox();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a closing panel for its exit, then removes it", () => {
    useBookmarkStore.setState({
      bookmarks: [{
        id: "bookmark-entrance",
        name: "Entrance view",
        kind: "custom",
        position: [0, 1.7, 5],
        target: [0, 1.2, 0],
      }],
    });
    vi.useFakeTimers();
    renderToolbox();

    fireEvent.click(screen.getByRole("button", { name: "Camera Views" }));
    expect(screen.queryByTestId("camera-views-panel")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Camera Views" }));
    act(() => { vi.advanceTimersByTime(249); });
    expect(screen.queryByTestId("camera-views-panel")).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId("camera-views-panel")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T-635 N5, item 9: the rail's Delete switched to a "delete" tool that nothing
// read, so it did nothing; the Select button promised a V shortcut that no
// handler answered.
// ---------------------------------------------------------------------------
describe("VerticalToolbox Delete and the V shortcut", () => {
  function placed(id: string, groupId: string | null): import("../../../lib/placement.js").PlacedItem {
    return {
      id, catalogueItemId: "round-table-6ft", x: 0, y: 0, z: 0, rotationY: 0,
      clothed: false, clothStyle: null, tableSetting: null, groupId,
    };
  }

  it("deletes the selection and its attached chairs, and waits for a selection", () => {
    usePlacementStore.setState({
      placedItems: [placed("table", "g1"), placed("chair-1", "g1"), placed("chair-2", "g1"), placed("other", null)],
    });
    renderToolbox();
    const remove = screen.getByRole("button", { name: /^Delete/u });
    expect(remove).toHaveProperty("disabled", true);

    act(() => { useSelectionStore.getState().select("table"); });
    expect(remove).toHaveProperty("disabled", false);
    fireEvent.click(remove);

    expect(usePlacementStore.getState().placedItems.map((item) => item.id)).toEqual(["other"]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("returns to Select on V, and leaves Ctrl+V and typing alone", () => {
    renderToolbox();
    fireEvent.keyDown(window, { code: "KeyD", key: "d" });
    expect(screen.getByRole("button", { name: /^Select & Move/u }).getAttribute("aria-pressed")).not.toBe("true");

    fireEvent.keyDown(window, { code: "KeyV", key: "v", ctrlKey: true });
    expect(screen.getByRole("button", { name: /^Select & Move/u }).getAttribute("aria-pressed")).not.toBe("true");

    fireEvent.keyDown(window, { code: "KeyV", key: "v" });
    expect(screen.getByRole("button", { name: /^Select & Move/u }).getAttribute("aria-pressed")).toBe("true");
  });

  // T-671 slice 5 (F-01, F-02): one tool store. The deck's Done puts the pen
  // down through the markup store; the toolbox follows, and D takes it up again.
  it("follows the one tool store: A opens the furniture panel, Esc closes it, D picks the pen back up after Done", () => {
    renderToolbox();
    fireEvent.keyDown(window, { code: "KeyA", key: "a" });
    expect(screen.getByTestId("furniture-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Add Furniture/u }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(screen.getByRole("button", { name: /^Add Furniture/u }).getAttribute("aria-pressed")).not.toBe("true");

    fireEvent.keyDown(window, { code: "KeyD", key: "d" });
    expect(screen.getByRole("button", { name: /^Draw\b/u }).getAttribute("aria-pressed")).toBe("true");
    act(() => { useMarkupStore.getState().setActive(false); });
    expect(screen.getByRole("button", { name: /^Draw\b/u }).getAttribute("aria-pressed")).not.toBe("true");
    fireEvent.keyDown(window, { code: "KeyD", key: "d" });
    expect(screen.getByRole("button", { name: /^Draw\b/u }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("VerticalToolbox walls hint", () => {
  afterEach(() => { setPlannerFeaturesForTesting(null); });

  async function hoverWalls(hint: string): Promise<void> {
    renderToolbox();
    const walls = screen.getByRole("button", { name: "Show All Walls" });
    fireEvent.mouseEnter(walls.parentElement ?? walls);
    expect(await screen.findByText(hint)).toBeTruthy();
  }

  it("says a click on a wall toggles it while any click hides one", async () => {
    setPlannerFeaturesForTesting({ wallClickAlt: false });
    await hoverWalls("Show all walls. Click a wall to toggle it.");
  });

  it("says Alt-click once only an Alt-click hides a wall (decision 4)", async () => {
    setPlannerFeaturesForTesting({ wallClickAlt: true });
    await hoverWalls("Show all walls. Alt-click a wall to hide it.");
  });

  it("says Option-click on a Mac", async () => {
    setPlannerFeaturesForTesting({ wallClickAlt: true });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko)");
    await hoverWalls("Show all walls. Option-click a wall to hide it.");
  });
});
