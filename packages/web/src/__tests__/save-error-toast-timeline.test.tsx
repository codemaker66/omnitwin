import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { SaveErrorToast } from "../pages/EditorPage.js";
import { useEditorStore, type EditorObject } from "../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../stores/layout-timeline-preview-store.js";

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  vi.restoreAllMocks();
});

describe("SaveErrorToast says where unsaved changes are", () => {
  it("promises no safety it does not have and names the two ways it saves", () => {
    render(<SaveErrorToast message="offline" isAuthenticated conflict={null} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("Your changes are held in this tab until they save: press Retry, or your next change will try again.");
    expect(text).not.toMatch(/safe|we'll try again/u);
  });
});

// A save the API refuses because it would change a note this browser is not
// shown (409 NOTE_HELD, packages/api routes/public-configs.ts in #389). The
// toast said "press Retry", and retrying sends the same save to the same
// refusal. It shows the API's own words instead, as they come.
describe("SaveErrorToast for a save refused over a note this browser is not shown", () => {
  const REFUSAL = "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece.";
  const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";

  function table(id: string, label: string, notes = ""): EditorObject {
    return {
      id, assetDefinitionId: ROUND, label, notes, positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: 0, clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
    };
  }

  /** A guest plan read without its notes, each table holding one; `tables` carry whatever the person wrote on them here. */
  function refuseSaveOf(tables: readonly EditorObject[]): void {
    useEditorStore.setState({
      configId: "plan-with-held-notes", isPublicPreview: true, notesIncluded: false,
      baseObjects: tables.map((piece) => ({ ...piece, notes: "", noteHeld: true })),
      objects: tables,
      isDirty: true, saveError: REFUSAL, saveErrorCode: "NOTE_HELD",
    });
  }

  it("shows the API's words as they came and offers no Retry, which could not succeed", () => {
    refuseSaveOf([table("t3", "Table 3"), table("t4", "Table 4")]);
    render(<SaveErrorToast message={REFUSAL} isAuthenticated={false} conflict={null} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain(REFUSAL);
    expect(text).not.toMatch(/press Retry|will try again|Couldn't save/u);
    expect(screen.queryByRole("button", { name: /Retry/u })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("names the piece when the person's words stand over a held note on one piece", () => {
    refuseSaveOf([table("t3", "Table 3", "TEST ONLY typed over"), table("t4", "Table 4")]);
    render(<SaveErrorToast message={REFUSAL} isAuthenticated={false} conflict={null} />);
    expect(screen.getByRole("status").textContent).toContain(`Table 3: ${REFUSAL}`);
  });

  it("names no piece when it cannot tell which: their words stand over held notes on two", () => {
    refuseSaveOf([table("t3", "Table 3", "TEST ONLY typed over"), table("t4", "Table 4", "TEST ONLY and here")]);
    render(<SaveErrorToast message={REFUSAL} isAuthenticated={false} conflict={null} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain(REFUSAL);
    expect(text).not.toContain(`: ${REFUSAL}`);
  });

  it("shows the API's words the same way, with no Retry, for a save refused because it leaves out a piece holding such a note", () => {
    const omitted = "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back.";
    refuseSaveOf([table("t3", "Table 3", "TEST ONLY typed over"), table("t4", "Table 4")]);
    useEditorStore.setState({ saveError: omitted, saveErrorCode: "HELD_PIECE_OMITTED" });
    render(<SaveErrorToast message={omitted} isAuthenticated={false} conflict={null} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain(omitted);
    expect(text).not.toMatch(/press Retry|will try again|Couldn't save/u);
    // This refusal is not about words the person wrote, so no piece is named before it.
    expect(text).not.toContain("Table 3");
    expect(screen.queryByRole("button", { name: /Retry/u })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("keeps the way to the newer version while a choice between versions waits", () => {
    refuseSaveOf([table("t3", "Table 3", "TEST ONLY typed over")]);
    render(<SaveErrorToast message={REFUSAL} isAuthenticated={false} conflict={{ expectedRevision: 5, currentRevision: 6 }} />);
    expect(screen.getByRole("status").textContent).toContain(`Table 3: ${REFUSAL}`);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/u })).toBeNull();
  });

  it("says what it always said for any other failed save", () => {
    useEditorStore.setState({ configId: "plan", isDirty: true, saveError: "Network error", saveErrorCode: "NETWORK_ERROR" });
    render(<SaveErrorToast message="Network error" isAuthenticated={false} conflict={null} />);
    expect(screen.getByRole("status").textContent).toContain("Couldn't save — Network error. Your changes are held in this tab until they save: press Retry, or your next change will try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("SaveErrorToast timeline isolation", () => {
  it("keeps the save warning intact and disables retry during preview", () => {
    const clearSaveError = vi.fn();
    const saveToServer = vi.fn(() => Promise.resolve(true));
    useEditorStore.setState({ clearSaveError, saveToServer });
    useLayoutTimelinePreviewStore.getState().showScheduleGap("No room phase is scheduled now.");

    render(<SaveErrorToast message="offline" isAuthenticated conflict={null} />);
    const retry = screen.getByRole("button", { name: "Exit preview to retry" });
    expect(retry.hasAttribute("disabled")).toBe(true);
    fireEvent.click(retry);
    expect(clearSaveError).not.toHaveBeenCalled();
    expect(saveToServer).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn't save/u)).toBeTruthy();

    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(clearSaveError).toHaveBeenCalledTimes(1);
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("disables conflict reload during preview", () => {
    const reloadAfterConflict = vi.fn(() => Promise.resolve());
    useEditorStore.setState({ reloadAfterConflict });
    useLayoutTimelinePreviewStore.getState().showScheduleGap("No room phase is scheduled now.");

    render(
      <SaveErrorToast
        message="revision conflict"
        isAuthenticated
        conflict={{ expectedRevision: 1, currentRevision: 2 }}
      />,
    );
    const reload = screen.getByRole("button", { name: "Exit preview to reload" });
    expect(reload.hasAttribute("disabled")).toBe(true);
    fireEvent.click(reload);
    expect(reloadAfterConflict).not.toHaveBeenCalled();
  });
});
