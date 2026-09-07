import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePlannerTopBar } from "../MobilePlannerTopBar.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("../send-layout-flow.js", () => ({ prepareLayoutForGuestEnquiry: mocks.prepare }));
vi.mock("../GuestEnquiryModal.js", () => ({ GuestEnquiryModal: () => <div data-testid="enquiry-ready" /> }));

beforeEach(() => {
  mocks.prepare.mockReset();
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "cfg-activity", isPublicPreview: true });
  useAuthStore.getState().logout();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().addObject("test-chair", 0, 0, 0);
});
afterEach(() => { cleanup(); useEditorStore.getState().reset(); });

describe("MobilePlannerTopBar activity", () => {
  it("replaces save activity with the real error control after failure", () => {
    useEditorStore.setState({ isSaving: true });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Connection lost" }); });
    expect(screen.getByRole("button", { name: "Save failed - retry" }).querySelector("[data-activity-indicator]")).toBeNull();
  });

  it.each(["ready", "blocked", "error"] as const)("stops send activity when preparation is %s", async outcome => {
    let resolveRequest: ((value: boolean) => void) | undefined;
    let rejectRequest: ((error: Error) => void) | undefined;
    const pending = new Promise<boolean>((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
    mocks.prepare.mockReturnValueOnce(pending);
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Send to Events Team" });
    fireEvent.click(send);
    expect(send.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(send).toHaveProperty("disabled", true);
    await act(async () => {
      if (outcome === "error") rejectRequest?.(new Error("Preparation failed"));
      else resolveRequest?.(outcome === "ready");
      await pending.catch(() => undefined);
    });
    expect(send.querySelector("[data-activity-indicator]")).toBeNull();
    expect(send).toHaveProperty("disabled", false);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    if (outcome === "ready") expect(screen.getByTestId("enquiry-ready")).toBeTruthy();
    else expect(screen.queryByTestId("enquiry-ready")).toBeNull();
  });
});
