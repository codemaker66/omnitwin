import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneOutliner } from "../SceneOutliner.js";
import { SelectedFurnitureInspector } from "../SelectedFurnitureInspector.js";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../../../lib/placement.js";
import { createTableGroup } from "../../../../lib/table-group.js";
import { referenceSceneEntries, referenceSceneSummary } from "../../../../lib/reference-scene-model.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useSelectionStore } from "../../../../stores/selection-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { PLANNER_TOOLBAR_COMMAND_EVENT, readPlannerToolbarCommand } from "../../../../lib/planner-toolbar-events.js";
import { EditorBridge, placedItemToEditor } from "../../EditorBridge.js";

function catalogueId(slug: string): string {
  const catalogue = getCatalogueItemBySlug(slug);
  if (catalogue === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return catalogue.id;
}

function fixture(): { readonly items: readonly PlacedItem[]; readonly table: PlacedItem; readonly other: PlacedItem } {
  const group = createTableGroup(catalogueId("round-table-6ft"), 0, 0, 0, 8);
  const table = group[0];
  if (table === undefined) throw new Error("Missing table fixture");
  const other = createPlacedItem(catalogueId("banquet-chair"), 7, 3);
  const items = [...group, other];
  usePlacementStore.setState({ placedItems: items, snapEnabled: false });
  return { items, table, other };
}

function changeNumber(label: string, value: string): void {
  const control = screen.getByRole("spinbutton", { name: label });
  fireEvent.change(control, { target: { value } });
  fireEvent.blur(control);
}

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  usePlacementStore.setState({ placedItems: [], snapEnabled: false });
  useSelectionStore.getState().clearSelection();
});
afterEach(() => {
  cleanup();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SceneOutliner", () => {
  it("keeps generated row identities stable when saved objects arrive in another order", () => {
    const { items, table } = fixture();
    const anotherTable = createPlacedItem(table.catalogueItemId, 4, 4);
    const supplied = [...items, anotherTable];
    const before = [...supplied];
    const rows = referenceSceneEntries(supplied);
    expect(referenceSceneEntries([...supplied].reverse())).toEqual(rows);
    expect(supplied).toEqual(before);
    expect(new Set(rows.filter((entry) => entry.category === "table").map((entry) => entry.label)).size).toBe(2);
  });

  it("counts18tables144chairs and18groups without counting dressing applicators as furniture", () => {
    const items = Array.from({ length: 18 }, (_, index) => createTableGroup(catalogueId("round-table-6ft"), index * 3, 0, 0, 8)).flat();
    const applicator = createPlacedItem(catalogueId("white-table-cloth"), 0, 0);
    const entries = referenceSceneEntries([...items, applicator]);
    expect(referenceSceneSummary(entries)).toEqual({ objects: 162, tables: 18, chairs: 144, groups: 18 });
  });

  it("selects all9members from a table row, leaves another chair unselected and does not select on mount", () => {
    const { table, other } = fixture();
    render(<SceneOutliner />);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    const label = referenceSceneEntries(usePlacementStore.getState().placedItems).find((entry) => entry.item.id === table.id)?.label;
    if (label === undefined) throw new Error("Missing table label");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(useSelectionStore.getState().selectedIds.size).toBe(9);
    expect(useSelectionStore.getState().selectedIds.has(other.id)).toBe(false);
  });

  it("searches authored labels and exposes an honest empty result", () => {
    const { items, table } = fixture();
    usePlacementStore.setState({ placedItems: items.map((item) => item.id === table.id ? { ...item, label: "Family table" } : item) });
    render(<SceneOutliner />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "family" } });
    expect(screen.getByRole("button", { name: /Family table/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Banquet Chair/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "not in this room" } });
    expect(screen.getByText("No matching objects.")).toBeDefined();
  });

  it("shows preview objects rather than current saved counts and locks selection and add", () => {
    fixture();
    useLayoutTimelinePreviewStore.getState().showScheduleGap("No phase here");
    render(<SceneOutliner />);
    expect(screen.getByText("0 tables · 0 chairs · 0 groups")).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add furniture" }).disabled).toBe(true);
    expect(screen.getByText("Room preview unavailable")).toBeDefined();
    expect(screen.queryByText("Frozen room outline")).toBeNull();
  });
});

describe("SelectedFurnitureInspector", () => {
  it("shows included cake cloth without invented colour or dining controls", () => {
    const cake = createPlacedItem(catalogueId("cake-cutting-table"), 0, 0);
    usePlacementStore.setState({ placedItems: [cake] });
    useSelectionStore.getState().select(cake.id);
    render(<SelectedFurnitureInspector />);
    expect(screen.getByText("Included cloth · catalogue variant")).toBeDefined();
    expect(screen.getByText("Approximate planning dimensions · confirm before final setup.")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Table linen" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Table place settings" })).toBeNull();
  });

  it("offers the existing catalogue command without inventing a selection", () => {
    fixture();
    const listener = vi.fn((event: Event) => { expect(readPlannerToolbarCommand(event)).toBe("open-furniture"); });
    window.addEventListener(PLANNER_TOOLBAR_COMMAND_EVENT, listener);
    render(<SelectedFurnitureInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Add furniture" }));
    expect(listener).toHaveBeenCalledOnce();
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    window.removeEventListener(PLANNER_TOOLBAR_COMMAND_EVENT, listener);
  });

  it("reports8actuallyplacedchairs, not the table's possible capacity", () => {
    const { table } = fixture();
    useSelectionStore.getState().select(table.id);
    render(<SelectedFurnitureInspector />);
    expect(screen.getByText("Placed chairs").nextElementSibling?.textContent).toBe("8");
    expect(screen.queryByText(/Clearance/)).toBeNull();
  });

  it("moves the full group uniformly, leaves the other item unchanged and clears selection without deletion", () => {
    const { items, table, other } = fixture();
    useSelectionStore.getState().select(table.id);
    render(<SelectedFurnitureInspector />);
    changeNumber("X (m)", "0.462");
    const moved = usePlacementStore.getState().placedItems;
    for (const item of moved) {
      const original = items.find((candidate) => candidate.id === item.id);
      if (original === undefined) throw new Error("Missing original");
      expect(item.x - original.x).toBeCloseTo(item.id === other.id ? 0 : 0.462, 8);
      expect(item.z).toBe(original.z);
    }
    fireEvent.click(screen.getByRole("button", { name: "Clear furniture selection" }));
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(usePlacementStore.getState().placedItems).toHaveLength(10);
  });

  it("preserves relative piece rotation/scale and rejects invalid scale input", () => {
    const { items, table, other } = fixture();
    useSelectionStore.getState().select(table.id);
    render(<SelectedFurnitureInspector />);
    changeNumber("Piece rotation (°)", "45");
    changeNumber("Piece scale (%)", "120");
    for (const item of usePlacementStore.getState().placedItems) {
      const original = items.find((candidate) => candidate.id === item.id);
      if (original === undefined) throw new Error("Missing original");
      expect(item.rotationY - original.rotationY).toBeCloseTo(item.id === other.id ? 0 : Math.PI / 4, 8);
      expect(item.scale ?? 1).toBeCloseTo(item.id === other.id ? 1 : 1.2, 8);
      expect([item.x, item.z]).toEqual([original.x, original.z]);
    }
    const beforeInvalid = usePlacementStore.getState().placedItems;
    changeNumber("Piece scale (%)", "0");
    expect(usePlacementStore.getState().placedItems).toBe(beforeInvalid);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("applies and removes linen/settings through real table commands, then removes the whole group", () => {
    const { table, other } = fixture();
    useSelectionStore.getState().select(table.id);
    render(<SelectedFurnitureInspector />);
    fireEvent.change(screen.getByRole("combobox", { name: "Table linen" }), { target: { value: "white" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Table place settings" }), { target: { value: "dinner" } });
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === table.id)).toMatchObject({ clothStyle: "white", tableSetting: "dinner" });
    fireEvent.change(screen.getByRole("combobox", { name: "Table linen" }), { target: { value: "none" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Table place settings" }), { target: { value: "none" } });
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === table.id)).toMatchObject({ clothed: false, clothStyle: null, tableSetting: null });
    fireEvent.click(screen.getByRole("button", { name: "Remove 9 objects" }));
    expect(usePlacementStore.getState().placedItems).toEqual([other]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("replaces all editing controls with the preview lock", () => {
    const { table } = fixture();
    useSelectionStore.getState().select(table.id);
    render(<SelectedFurnitureInspector />);
    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("Not scheduled"); });
    expect(screen.getByText("Editing is paused")).toBeDefined();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("records independent numerical edits in real EditorBridge history and supports one-step Undo", () => {
    vi.useFakeTimers();
    const { items, table } = fixture();
    useEditorStore.setState({ configId: "00000000-0000-4000-8000-000000000001", objects: items.map((item) => placedItemToEditor(item, undefined)) });
    useSelectionStore.getState().select(table.id);
    render(<><EditorBridge /><SelectedFurnitureInspector /></>);
    changeNumber("X (m)", "0.5");
    changeNumber("Z (m)", "0.25");
    expect(useEditorStore.getState().history.past).toHaveLength(2);
    act(() => { useEditorStore.getState().undo(); });
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === table.id)).toMatchObject({ x: 0.5, z: 0 });
    act(() => { useEditorStore.getState().undo(); });
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === table.id)).toMatchObject({ x: 0, z: 0 });
  });
});
