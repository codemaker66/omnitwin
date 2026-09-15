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
import { useMarkupStore } from "../../../stores/markup-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

const media = vi.hoisted(() => ({ narrow: true, coarse: false }));

vi.mock("../../../hooks/use-media-query.js", () => ({
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));

function Fixture({ view = "3d" }: { readonly view?: "3d" | "2d" }): React.ReactElement {
  const preview = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  return <MemoryRouter>
    {view === "3d" && !preview && <VerticalToolbox />}
    <ObjectNotePanel mobile viewMode={view} />
  </MemoryRouter>;
}

beforeEach(() => {
  media.narrow = true; media.coarse = false;
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

  it.each([
    { label: "fresh narrow phone", narrow: true, coarse: false },
    { label: "fresh wide coarse-pointer screen", narrow: false, coarse: true },
  ])("opens Flow from More on a $label without changing the plan or camera mode", ({ narrow, coarse }) => {
    media.narrow = narrow; media.coarse = coarse;
    useSelectionStore.getState().clearSelection();
    useCockpitStore.getState().setWalkMode(true);
    useCockpitStore.getState().setLayerMode("splat");
    render(<Fixture />);
    const more = screen.getByRole("button", { name: "More" });
    const placements = usePlacementStore.getState().placedItems;
    const selection = useSelectionStore.getState().selectedIds;
    const catalogueSelection = useCatalogueStore.getState().selectedItemId;
    const objects = useEditorStore.getState().objects;
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const lenses = screen.getByRole("group", { name: "Planner lenses" });
    expect(within(lenses).getByRole("button", { name: "Design" }).getAttribute("aria-pressed")).toBe("true");
    const flow = within(lenses).getByRole("button", { name: "Flow" });
    expect(flow.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(flow);
    expect(useCockpitStore.getState().activeMode).toBe("flow");
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    expect(usePlacementStore.getState().placedItems).toBe(placements);
    expect(useSelectionStore.getState().selectedIds).toBe(selection);
    expect(useCatalogueStore.getState().selectedItemId).toBe(catalogueSelection);
    expect(useEditorStore.getState().objects).toBe(objects);
    expect(screen.queryByTestId("mobile-more-sheet")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Flow" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Design" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("closes the lens choices with Escape and restores More focus without choosing a lens", () => {
    useSelectionStore.getState().clearSelection();
    render(<Fixture />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    const flow = screen.getByRole("button", { name: "Flow" });
    flow.focus();
    fireEvent.keyDown(flow, { key: "Escape" });
    expect(screen.queryByTestId("mobile-more-sheet")).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(useCockpitStore.getState().activeMode).toBe("design");
  });

  it("keeps the drawing tool active when a lens is chosen", () => {
    useSelectionStore.getState().clearSelection();
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    expect(useMarkupStore.getState().active).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    expect(useMarkupStore.getState().active).toBe(true);
    expect(screen.getByRole("button", { name: "Draw" }).getAttribute("aria-pressed")).toBe("true");
  });
});
