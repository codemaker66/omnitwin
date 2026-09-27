import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SaveErrorToast } from "../pages/EditorPage.js";
import { useEditorStore } from "../stores/editor-store.js";
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
