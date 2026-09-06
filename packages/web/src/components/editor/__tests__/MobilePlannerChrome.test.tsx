import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { ObjectNotePanel } from "../ObjectNotePanel.js";
import { placedItemToEditor } from "../EditorBridge.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createTableGroup } from "../../../lib/table-group.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => true,
  useIsCoarsePointer: () => false,
}));

function Fixture({ view = "3d" }: { readonly view?: "3d" | "2d" }): React.ReactElement {
  const preview = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  return <MemoryRouter>
    {view === "3d" && !preview && <VerticalToolbox />}
    <ObjectNotePanel mobile viewMode={view} />
  </MemoryRouter>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("omnitwin_onboarding_seen", "1");
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useCatalogueStore.getState().clearSelection();
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing table fixture");
  const group = createTableGroup(table.id, 0, 0, 0, 8);
  // Arrival order from saved objects can place a chair before its table.
  const reordered = [...group.slice(1), ...group.slice(0, 1)];
  usePlacementStore.setState({ placedItems: reordered, snapEnabled: false });
  useSelectionStore.setState({ selectedIds: new Set(reordered.map((item) => item.id)) });
  useEditorStore.setState({ objects: reordered.map((item) => placedItemToEditor(item, undefined)), selectedObjectId: reordered[0]?.id ?? null });
});
afterEach(() => { cleanup(); useLayoutTimelinePreviewStore.getState().clear(); useSelectionStore.getState().clearSelection(); useEditorStore.getState().reset(); });

describe("mobile planner chrome", () => {
  it("reattaches the same unsaved table note after cancelling a catalogue placement", () => {
    const { container } = render(<Fixture />);
    const note = container.querySelector("textarea");
    if (note === null) throw new Error("Missing note input");
    fireEvent.change(note, { target: { value: "Keep this table draft after cancel" } });
    const selection = [...useSelectionStore.getState().selectedIds];
    const chair = getCatalogueItemBySlug("banquet-chair");
    if (chair === undefined) throw new Error("Missing chair fixture");
    act(() => { useCatalogueStore.getState().selectItem(chair.id); });
    expect(screen.queryByTestId("mobile-object-sheet")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("mobile-object-sheet")).toBeTruthy();
    expect(container.querySelector("#mobile-object-notes textarea")?.getAttribute("aria-label")).toBe("Planner note");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Keep this table draft after cancel");
    expect([...useSelectionStore.getState().selectedIds]).toEqual(selection);
    expect(useEditorStore.getState().objects.every((item) => item.notes === "")).toBe(true);
  });

  it("keeps the nine-object group labelled as its table with eight placed chairs and notes inside the action sheet", () => {
    const { container } = render(<Fixture />);
    const sheet = screen.getByTestId("mobile-object-sheet");
    expect(within(sheet).getByText(getCatalogueItemBySlug("round-table-6ft")?.name ?? "")).toBeTruthy();
    expect(within(sheet).getByText("8 chairs placed · 9 objects selected")).toBeTruthy();
    const note = screen.getByRole("region", { name: "Selected object dressing and note", hidden: true });
    expect(note.closest("#mobile-object-notes")).not.toBeNull();
    expect(note.style.position).toBe("static");
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    const disclosure = sheet.querySelector("details");
    expect(disclosure?.open).toBe(false);
    for (const name of ["Done", "Rotate", "Delete", "View"]) {
      const action = screen.getByRole("button", { name });
      expect(action.closest("details")).toBeNull();
    }
    fireEvent.click(screen.getByText("Notes and styling details"));
    const input = container.querySelector("textarea");
    if (input === null) throw new Error("Missing note input");
    fireEvent.change(input, { target: { value: "Table for the speakers" } });
    fireEvent.click(screen.getByText("Save Note"));
    const tableId = usePlacementStore.getState().placedItems.at(-1)?.id;
    expect(useEditorStore.getState().objects.find((item) => item.id === tableId)?.notes).toBe("Table for the speakers");
    expect(useEditorStore.getState().objects.filter((item) => item.id !== tableId).every((item) => item.notes === "")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("preserves the unsaved note across 3D/2D, a lens change and read-only preview, with no editing surface during preview", () => {
    const { container, rerender } = render(<Fixture />);
    const note = container.querySelector("textarea");
    if (note === null) throw new Error("Missing note input");
    fireEvent.change(note, { target: { value: "Keep the table draft" } });
    rerender(<Fixture view="2d" />);
    expect(container.querySelector("textarea")?.value).toBe("Keep the table draft");
    act(() => { useCockpitStore.getState().setMode("flow"); });
    rerender(<Fixture />);
    expect(container.querySelector("textarea")?.value).toBe("Keep the table draft");
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Reading phase"); });
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByTestId("mobile-object-sheet")).toBeNull();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(container.querySelector("textarea")?.value).toBe("Keep the table draft");
    expect(useEditorStore.getState().objects.every((item) => item.notes === "")).toBe(true);
  });
});
