import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ObjectNotePanel } from "../ObjectNotePanel.js";
import { placedItemToEditor } from "../EditorBridge.js";
import { createPlacedItem } from "../../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

function DockFixture(): React.ReactElement {
  const mode = useCockpitStore((state) => state.activeMode);
  const preview = useLayoutTimelinePreviewStore((state) => state.mode);
  return <>{mode === "design" && preview === "inactive" && <div id="reference-object-notes" />}<ObjectNotePanel embedded /></>;
}
beforeEach(() => {
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  const item = getCatalogueItemBySlug("round-table-6ft");
  if (item === undefined) throw new Error("Missing table fixture");
  const placed = createPlacedItem(item.id, 0, 0);
  useEditorStore.setState({ selectedObjectId: placed.id, objects: [placedItemToEditor(placed, undefined)] });
});
afterEach(() => { cleanup(); useLayoutTimelinePreviewStore.getState().clear(); useEditorStore.getState().reset(); });

describe("docked ObjectNotePanel", () => {
  it("keeps one note surface in the inspector and saves through the real editor action", () => {
    const { container } = render(<DockFixture />);
    const region = screen.getByRole("region", { name: "Selected object dressing and note", hidden: true });
    expect(region.closest("#reference-object-notes")).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="Selected object dressing and note"]')).toHaveLength(1);
    fireEvent.click(screen.getByText("Notes and styling details"));
    const note = container.querySelector("textarea");
    if (note === null) throw new Error("Missing note input");
    fireEvent.change(note, { target: { value: "Table for the speakers" } });
    fireEvent.click(screen.getByText("Save Note"));
    expect(useEditorStore.getState().objects[0]?.notes).toBe("Table for the speakers");
  });

  it("preserves an unsaved note across lens and phase-preview changes", () => {
    const { container } = render(<DockFixture />);
    const note = container.querySelector("textarea");
    if (note === null) throw new Error("Missing note input");
    fireEvent.change(note, { target: { value: "Keep this draft" } });
    act(() => { useCockpitStore.getState().setMode("flow"); });
    expect(container.querySelector("textarea")).toBeNull();
    act(() => { useCockpitStore.getState().setMode("design"); });
    expect(container.querySelector("textarea")?.value).toBe("Keep this draft");
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Reading phase"); });
    expect(container.querySelector("textarea")).toBeNull();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(container.querySelector("textarea")?.value).toBe("Keep this draft");
    expect(useEditorStore.getState().objects[0]?.notes).toBe("");
  });
});
