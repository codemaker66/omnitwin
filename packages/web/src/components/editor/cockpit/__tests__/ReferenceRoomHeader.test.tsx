import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { ReferenceRoomHeader } from "../ReferenceRoomHeader.js";

const originalSave = useEditorStore.getState().saveToServer;
const save = vi.fn<typeof originalSave>().mockResolvedValue(true);
const originalReload = useEditorStore.getState().reloadAfterConflict;
const reload = vi.fn<typeof originalReload>().mockResolvedValue(undefined);

beforeEach(() => {
  save.mockClear();
  reload.mockClear();
  useEditorStore.setState({ configId: "cfg-demo", space: null, isSaving: false, isDirty: true, saveError: null, saveConflict: null, saveToServer: save, reloadAfterConflict: reload });
  useAuthStore.setState({ isAuthenticated: true });
  useLayoutTimelinePreviewStore.getState().clear();
});
afterEach(() => {
  cleanup();
  useEditorStore.setState({ saveToServer: originalSave, reloadAfterConflict: originalReload, saveConflict: null });
  useLayoutTimelinePreviewStore.getState().clear();
});

function showHeader(): void {
  render(<MemoryRouter><ReferenceRoomHeader /></MemoryRouter>);
}

describe("ReferenceRoomHeader", () => {
  it("checks the live preview lock even before React replaces the prior click handler", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: { expectedRevision: 1, currentRevision: 2, message: "Changed" } });
    showHeader();
    const recovery = screen.getByRole("button", { name: "Reload layout" });
    act(() => {
      useLayoutTimelinePreviewStore.getState().showPending("Loading phase");
      // Both actions are in one batch: the button still has its old closure.
      fireEvent.click(recovery);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reloads a conflicted layout instead of resending a stale revision, respecting preview lock", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: { expectedRevision: 1, currentRevision: 2, message: "Changed" } });
    showHeader();
    expect(screen.getByRole("status").textContent).toBe("Reload layout");
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledWith(true);
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses the current authentication route and real save action", () => {
    showHeader();
    expect(screen.getByRole("link", { name: "Venviewer diary" }).getAttribute("href")).toBe("/diary");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenCalledWith(true);
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    expect(screen.getByRole("link", { name: "Venviewer home" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenLastCalledWith(false);
  });

  it("shows pending and failed save states without claiming success or allowing duplicate saves", () => {
    showHeader();
    act(() => { useEditorStore.setState({ isSaving: true }); });
    const pending = screen.getByRole("button", { name: "Saving layout" });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.querySelector("[data-activity-indicator]")).not.toBeNull();
    fireEvent.click(pending);
    expect(save).not.toHaveBeenCalled();
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Offline" }); });
    expect(screen.getByRole("status").textContent).toBe("Retry save");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("prevents saving a frozen phase preview or absent configuration", () => {
    showHeader();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading saved phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); useEditorStore.setState({ configId: null, isDirty: false }); });
    fireEvent.click(screen.getByRole("button", { name: "No saved layout" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("No saved layout");
  });
});
