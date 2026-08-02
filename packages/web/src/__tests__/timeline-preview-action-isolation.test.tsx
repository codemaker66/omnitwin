import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { EditorObject } from "../stores/editor-store.js";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";

const mocks = vi.hoisted(() => ({
  flushAutoSave: vi.fn<() => Promise<boolean>>(),
  captureOrthographic: vi.fn<() => string | null>(),
  updatePublicThumbnail: vi.fn<() => Promise<void>>(),
  getAvailableTransitions: vi.fn(),
  submitForReview: vi.fn(),
  withdrawReview: vi.fn(),
}));

vi.mock("../components/editor/EditorBridge.js", () => ({
  flushAutoSave: mocks.flushAutoSave,
}));

vi.mock("../lib/ortho-capture.js", () => ({
  captureOrthographic: mocks.captureOrthographic,
}));

vi.mock("../api/configurations.js", () => ({
  updatePublicThumbnail: mocks.updatePublicThumbnail,
}));

vi.mock("../api/configuration-reviews.js", () => ({
  getAvailableTransitions: mocks.getAvailableTransitions,
  submitForReview: mocks.submitForReview,
  withdrawReview: mocks.withdrawReview,
}));

vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => false,
}));

vi.mock("../components/shared/FloatingWidgetFrame.js", () => ({
  FloatingWidgetFrame: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/editor/GuestEnquiryModal.js", () => ({
  GuestEnquiryModal: () => <div data-testid="guest-enquiry-modal" />,
}));

const { useEditorStore } = await import("../stores/editor-store.js");
const originalClearSaveError = useEditorStore.getState().clearSaveError;
const originalSaveToServer = useEditorStore.getState().saveToServer;
const { useLayoutTimelinePreviewStore } = await import("../stores/layout-timeline-preview-store.js");
const { prepareLayoutForGuestEnquiry } = await import("../components/editor/send-layout-flow.js");
const { SaveSendPanel } = await import("../components/editor/SaveSendPanel.js");
const { MobilePlannerTopBar } = await import("../components/editor/MobilePlannerTopBar.js");
const {
  SubmitForReviewPanel,
  submitConfigurationForReview,
  withdrawConfigurationReview,
} = await import("../components/editor/SubmitForReviewPanel.js");

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const object: EditorObject = {
  id: "object-1",
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
  notes: "",
};

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve) => { resolvePromise = resolve; }),
    resolve: (value) => { resolvePromise?.(value); },
  };
}

function enterCrossPhasePreview(): void {
  useLayoutTimelinePreviewStore.getState().settle({
    id: "event-b:phase-party",
    eventId: "event-b",
    eventName: "Charity Gala",
    phaseId: "phase-party",
    phaseName: "Evening party",
    startsAt: "2026-07-18T22:00:00.000Z",
    endsAt: "2026-07-18T23:30:00.000Z",
    venueRuntime: {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
      spaceName: "Frozen Grand Hall",
    },
  }, []);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useEditorStore.setState({
    configId: CONFIG_ID,
    objects: [object],
    isPublicPreview: false,
  });
  mocks.flushAutoSave.mockResolvedValue(true);
  mocks.captureOrthographic.mockReturnValue("data:image/png;base64,preview");
  mocks.updatePublicThumbnail.mockResolvedValue();
  mocks.getAvailableTransitions.mockResolvedValue({
    configurationId: CONFIG_ID,
    currentStatus: "draft",
    availableTransitions: ["submitted"],
  });
  mocks.submitForReview.mockResolvedValue({ reviewStatus: "submitted" });
  mocks.withdrawReview.mockResolvedValue("withdrawn");
});

afterEach(() => {
  cleanup();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useEditorStore.setState({
    clearSaveError: originalClearSaveError,
    saveToServer: originalSaveToServer,
  });
});

describe("timeline preview action isolation", () => {
  it("guest enquiry fails closed before autosave, capture, upload, or handoff", async () => {
    enterCrossPhasePreview();

    await expect(prepareLayoutForGuestEnquiry(CONFIG_ID)).resolves.toBe(false);
    expect(mocks.flushAutoSave).not.toHaveBeenCalled();
    expect(mocks.captureOrthographic).not.toHaveBeenCalled();
    expect(mocks.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it("guest enquiry rechecks the lock after an in-flight autosave", async () => {
    const save = deferred<boolean>();
    mocks.flushAutoSave.mockReturnValueOnce(save.promise);
    const preparing = prepareLayoutForGuestEnquiry(CONFIG_ID);
    expect(mocks.flushAutoSave).toHaveBeenCalledTimes(1);

    enterCrossPhasePreview();
    save.resolve(true);

    await expect(preparing).resolves.toBe(false);
    expect(mocks.captureOrthographic).not.toHaveBeenCalled();
    expect(mocks.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it("review submit and withdraw helpers make no mutation call while preview is active", async () => {
    enterCrossPhasePreview();

    await expect(submitConfigurationForReview(CONFIG_ID)).rejects.toThrow(/Exit the room timeline preview/u);
    await expect(withdrawConfigurationReview(CONFIG_ID)).rejects.toThrow(/Exit the room timeline preview/u);
    expect(mocks.flushAutoSave).not.toHaveBeenCalled();
    expect(mocks.captureOrthographic).not.toHaveBeenCalled();
    expect(mocks.updatePublicThumbnail).not.toHaveBeenCalled();
    expect(mocks.submitForReview).not.toHaveBeenCalled();
    expect(mocks.withdrawReview).not.toHaveBeenCalled();
  });

  it("review submit rechecks the lock after an in-flight autosave", async () => {
    const save = deferred<boolean>();
    mocks.flushAutoSave.mockReturnValueOnce(save.promise);
    const submitting = submitConfigurationForReview(CONFIG_ID);
    expect(mocks.flushAutoSave).toHaveBeenCalledTimes(1);

    enterCrossPhasePreview();
    save.resolve(true);

    await expect(submitting).rejects.toThrow(/Exit the room timeline preview/u);
    expect(mocks.captureOrthographic).not.toHaveBeenCalled();
    expect(mocks.updatePublicThumbnail).not.toHaveBeenCalled();
    expect(mocks.submitForReview).not.toHaveBeenCalled();
  });

  it("keeps desktop and mobile Send visible but disabled in a cross-phase preview", () => {
    const desktop = render(<SaveSendPanel />);
    act(() => { enterCrossPhasePreview(); });
    const desktopSend = screen.getByRole("button", { name: "Send to Events Team" });
    expect(desktopSend.hasAttribute("disabled")).toBe(true);
    expect(desktopSend.textContent).toBe("Exit preview to send");
    desktop.unmount();

    render(<MobilePlannerTopBar mode="3d" onModeChange={() => undefined} />);
    const mobileSend = screen.getByRole("button", { name: "Send to Events Team" });
    expect(mobileSend.hasAttribute("disabled")).toBe(true);
    expect(mobileSend.textContent).toBe("Exit preview");
    expect(screen.getByTestId("mobile-planner-room-name").textContent).toBe("Frozen Grand Hall");
    expect(screen.getByTestId("mobile-planner-layout-name").textContent).toBe("Frozen phase preview");
    expect(screen.queryByText("Banquet Draft")).toBeNull();
  });

  it("does not borrow the live room title when frozen room authority is unavailable", () => {
    useLayoutTimelinePreviewStore.getState().showPending("Loading the room timeline…");
    render(<MobilePlannerTopBar mode="3d" onModeChange={() => undefined} />);

    expect(screen.getByTestId("mobile-planner-room-name").textContent).toBe("Room unavailable");
    expect(screen.getByTestId("mobile-planner-layout-name").textContent)
      .toBe("Room preview unavailable");
    expect(screen.queryByText("Banquet Draft")).toBeNull();
  });

  it("keeps mobile save recovery and 2D mode locked without clearing local state", () => {
    const clearSaveError = vi.fn();
    const saveToServer = vi.fn();
    const onModeChange = vi.fn();
    useEditorStore.setState({
      saveError: "offline",
      saveConflict: null,
      clearSaveError,
      saveToServer,
    });
    enterCrossPhasePreview();
    render(<MobilePlannerTopBar mode="3d" onModeChange={onModeChange} />);

    const retry = screen.getByRole("button", { name: "Save failed - retry" });
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(retry.textContent).toBe("Exit preview to retry");
    retry.click();
    expect(clearSaveError).not.toHaveBeenCalled();
    expect(saveToServer).not.toHaveBeenCalled();

    const twoDimensional = screen.getByRole("button", { name: "2D" });
    expect(twoDimensional.hasAttribute("disabled")).toBe(true);
    twoDimensional.click();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("disables both submit and withdraw affordances during preview", async () => {
    const submitted = render(<SubmitForReviewPanel />);
    await screen.findByRole("button", { name: "Submit for Approval" });
    act(() => { enterCrossPhasePreview(); });
    expect(screen.getByRole("button", { name: "Exit preview to submit" }).hasAttribute("disabled"))
      .toBe(true);
    submitted.unmount();

    useLayoutTimelinePreviewStore.getState().clear();
    mocks.getAvailableTransitions.mockResolvedValueOnce({
      configurationId: CONFIG_ID,
      currentStatus: "submitted",
      availableTransitions: ["withdrawn"],
    });
    render(<SubmitForReviewPanel />);
    await screen.findByRole("button", { name: "Withdraw" });
    act(() => { enterCrossPhasePreview(); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit preview to withdraw" }).hasAttribute("disabled"))
        .toBe(true);
    });
  });
});
