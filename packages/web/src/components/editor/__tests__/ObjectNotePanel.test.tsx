import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EditorObject } from "../../../stores/editor-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { ObjectNotePanel } from "../ObjectNotePanel.js";

const object: EditorObject = {
  id: "object-with-note",
  assetDefinitionId: "asset-chair",
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scale: 1,
  sortOrder: 0,
  clothed: false,
  clothStyle: null,
  tableSetting: null,
  groupId: null,
  notes: "Saved note",
};

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useEditorStore.setState({ objects: [object], selectedObjectId: object.id });
});

afterEach(() => {
  cleanup();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
});

describe("ObjectNotePanel timeline isolation", () => {
  it("hides during preview without discarding an in-progress draft", () => {
    render(<ObjectNotePanel />);
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "Unsaved planner draft" } });
    expect(screen.getByRole("button", { name: "Save Note" })).toBeTruthy();

    act(() => {
      useLayoutTimelinePreviewStore.getState().showScheduleGap("No room phase is scheduled now.");
    });
    expect(screen.queryByRole("region", { name: "Object note editor" })).toBeNull();
    expect(useEditorStore.getState().objects[0]?.notes).toBe("Saved note");

    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Unsaved planner draft");
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));
    expect(useEditorStore.getState().objects[0]?.notes).toBe("Unsaved planner draft");
  });
});
