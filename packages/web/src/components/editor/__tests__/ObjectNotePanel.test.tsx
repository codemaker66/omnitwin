import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NOTE_SAVE_DELAY_MS, ObjectNotePanel, noteTargetFor } from "../ObjectNotePanel.js";
import { placedItemToEditor } from "../EditorBridge.js";
import { createPlacedItem, type PlacedItem } from "../../../lib/placement.js";
import { createTableGroup } from "../../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useActionLogStore } from "../../../stores/action-log-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function DockFixture(): React.ReactElement {
  const mode = useCockpitStore((state) => state.activeMode);
  const preview = useLayoutTimelinePreviewStore((state) => state.mode);
  return <>{mode === "design" && preview === "inactive" && <div id="reference-object-notes" />}<ObjectNotePanel embedded /></>;
}

function load(items: readonly PlacedItem[]): void {
  useEditorStore.setState({ objects: items.map((item) => placedItemToEditor(item, undefined)) });
}

function noteOf(id: string): string | undefined {
  return useEditorStore.getState().objects.find((object) => object.id === id)?.notes;
}

function field(container: HTMLElement): HTMLTextAreaElement {
  const note = container.querySelector("textarea");
  if (note === null) throw new Error("Missing note input");
  return note;
}

let firstTable: PlacedItem;
let secondTable: PlacedItem;

beforeEach(() => {
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useSelectionStore.getState().clearSelection();
  const round = catalogueId("round-table-6ft");
  firstTable = createPlacedItem(round, 0, 0);
  secondTable = createPlacedItem(round, 4, 0);
  load([firstTable, secondTable]);
  useSelectionStore.getState().select(firstTable.id);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useLayoutTimelinePreviewStore.getState().clear();
  useSelectionStore.getState().clearSelection();
  useEditorStore.getState().reset();
});

describe("docked ObjectNotePanel", () => {
  it("keeps one note surface in the inspector, in the venue's words, with no save button", () => {
    const { container } = render(<DockFixture />);
    const region = screen.getByRole("region", { name: "Dressing and note for the hallkeeper", hidden: true });
    expect(region.closest("#reference-object-notes")).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="Dressing and note for the hallkeeper"]')).toHaveLength(1);
    fireEvent.click(screen.getByText("Notes and styling details"));
    expect(screen.getByRole("textbox", { name: "Note for the hallkeeper" })).toBe(field(container));
    expect(container.textContent).not.toMatch(/planner note|save note|SAVED/u);
    expect(screen.queryByRole("button", { name: /save/iu })).toBeNull();
  });

  it("saves as you type, 400 ms after the last key, through the real editor action, once per pause", () => {
    vi.useFakeTimers();
    const write = vi.spyOn(useEditorStore.getState(), "setObjectNotes");
    const { container } = render(<DockFixture />);
    fireEvent.change(field(container), { target: { value: "V" } });
    act(() => { vi.advanceTimersByTime(NOTE_SAVE_DELAY_MS - 100); });
    fireEvent.change(field(container), { target: { value: "VIP, needs HDMI" } });
    act(() => { vi.advanceTimersByTime(NOTE_SAVE_DELAY_MS - 1); });
    expect(noteOf(firstTable.id)).toBe("");
    expect(screen.getByTestId("object-note-status").textContent).toBe("Saving…");
    act(() => { vi.advanceTimersByTime(1); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(noteOf(firstTable.id)).toBe("VIP, needs HDMI");
    act(() => { useEditorStore.setState({ isDirty: false }); });
    expect(screen.getByTestId("object-note-status").textContent).toBe("Saved · prints on the function sheet");
  });

  it("writes the typed note to its own table when the selection changes before the pause (B-04, C-14)", () => {
    const { container } = render(<DockFixture />);
    fireEvent.change(field(container), { target: { value: "Table for the speakers" } });
    act(() => { useSelectionStore.getState().select(secondTable.id); });
    expect(noteOf(firstTable.id)).toBe("Table for the speakers");
    expect(noteOf(secondTable.id)).toBe("");
    expect(field(container).value).toBe("");
  });

  it("writes the typed note at once on blur, on deselect and on unmount", () => {
    const view = render(<DockFixture />);
    fireEvent.change(field(view.container), { target: { value: "Blurred" } });
    fireEvent.blur(field(view.container));
    expect(noteOf(firstTable.id)).toBe("Blurred");
    fireEvent.change(field(view.container), { target: { value: "Deselected" } });
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(noteOf(firstTable.id)).toBe("Deselected");
    act(() => { useSelectionStore.getState().select(secondTable.id); });
    fireEvent.change(field(view.container), { target: { value: "Unmounted" } });
    view.unmount();
    expect(noteOf(secondTable.id)).toBe("Unmounted");
  });

  it("files a group's note on its table even when a chair comes first in the selection", () => {
    const group = createTableGroup(catalogueId("round-table-6ft"), 0, 0, 0, 4);
    const table = group[0];
    const chair = group[1];
    if (table === undefined || chair === undefined) throw new Error("Missing group fixture");
    load([...group.slice(1), table]);
    act(() => { useSelectionStore.getState().selectMultiple([chair.id, ...group.slice(2).map((item) => item.id), table.id]); });
    const { container } = render(<DockFixture />);
    fireEvent.change(field(container), { target: { value: "Bride's parents" } });
    fireEvent.blur(field(container));
    expect(noteOf(table.id)).toBe("Bride's parents");
    expect(noteOf(chair.id)).toBe("");
  });

  it("takes no note with two tables selected, and says why", () => {
    act(() => { useSelectionStore.getState().selectMultiple([firstTable.id, secondTable.id]); });
    const { container } = render(<DockFixture />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByTestId("object-note-refusal").textContent).toBe("Several tables are selected. Select one table to write its note.");
  });

  it("takes no note with several pieces and no table, and says so", () => {
    const chairId = catalogueId("banquet-chair");
    const chairs = [createPlacedItem(chairId, 0, 0), createPlacedItem(chairId, 1, 0)];
    load(chairs);
    act(() => { useSelectionStore.getState().selectMultiple(chairs.map((chair) => chair.id)); });
    const { container } = render(<DockFixture />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByTestId("object-note-refusal").textContent).toBe("There is no table in this selection. Select a table to write its note.");
  });

  it("keeps a draft across lens changes and a phase preview, and writes it once the preview ends", () => {
    const { container } = render(<DockFixture />);
    fireEvent.change(field(container), { target: { value: "Keep this draft" } });
    act(() => { useCockpitStore.getState().setMode("flow"); });
    expect(container.querySelector("textarea")).toBeNull();
    act(() => { useCockpitStore.getState().setMode("design"); });
    expect(field(container).value).toBe("Keep this draft");
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Reading phase"); });
    expect(container.querySelector("textarea")).toBeNull();
    expect(noteOf(firstTable.id)).toBe("");
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(field(container).value).toBe("Keep this draft");
    expect(noteOf(firstTable.id)).toBe("Keep this draft");
  });

  it("never says saved while the browser is offline with the note unsent", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { container } = render(<DockFixture />);
    act(() => { window.dispatchEvent(new Event("offline")); });
    fireEvent.change(field(container), { target: { value: "Gluten-free starter" } });
    fireEvent.blur(field(container));
    expect(screen.getByTestId("object-note-status").textContent).toBe("Offline · not saved yet");
  });

  it("records one note edit per typing burst, through the one recorded path, with no log write of its own", () => {
    vi.useFakeTimers();
    useActionLogStore.getState().beginLog("00000000-0000-4000-8000-000000000001");
    const append = vi.spyOn(useActionLogStore.getState(), "append");
    const { container } = render(<DockFixture />);
    for (const text of ["N", "Nu", "Nut", "Nut-free"]) {
      fireEvent.change(field(container), { target: { value: text } });
      act(() => { vi.advanceTimersByTime(100); });
    }
    act(() => { vi.advanceTimersByTime(NOTE_SAVE_DELAY_MS); });
    expect(noteOf(firstTable.id)).toBe("Nut-free");
    expect(useEditorStore.getState().history.past.filter((entry) => entry.label === "Edit note")).toHaveLength(1);
    // The open entry is not in the log until a later gesture or save seals it.
    expect(append).not.toHaveBeenCalled();
  });
});

describe("noteTargetFor", () => {
  it("prefers the table already holding a note in a set sharing one group, and has no target with nothing selected", () => {
    const round = catalogueId("round-table-6ft");
    const a = { ...placedItemToEditor(createPlacedItem(round, 0, 0), undefined), groupId: "set-1" };
    const b = { ...placedItemToEditor(createPlacedItem(round, 2, 0), undefined), groupId: "set-1", notes: "Top table" };
    expect(noteTargetFor([a, b], new Set([a.id]))).toEqual({ kind: "piece", id: b.id });
    expect(noteTargetFor([a, b], new Set())).toBeNull();
  });
});
