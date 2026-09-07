import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  tableSetting: null, chairStyle: null, centerpiece: null,
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
  it("keeps review controls out of the closed disclosure and preserves the unchecked choice across collapse", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "draft", availableTransitions: ["submitted"], internalDemoReviewEligible: true });
    render(<SubmitForReviewPanel />);
    const summary = await screen.findByRole("button", { name: /^Review saved plan:/u });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox", { name: /Notify team/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit for Approval" })).toBeNull();
    fireEvent.click(summary);
    const choice = screen.getByRole("checkbox", { name: /Notify team/u });
    fireEvent.click(choice);
    fireEvent.keyDown(choice, { key: "Escape" });
    expect(summary).toBe(document.activeElement);
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox", { name: /Notify team/u })).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByRole("checkbox", { name: /Notify team/u })).toHaveProperty("checked", false);
    act(() => { enterCrossPhasePreview(); });
    expect(screen.getByRole("checkbox", { name: /Notify team/u })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Exit preview to submit" })).toHaveProperty("disabled", true);
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(screen.getByRole("checkbox", { name: /Notify team/u })).toHaveProperty("checked", false);
  });

  it("submits an eligible internal demo using the explicit unchecked choice", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "draft", availableTransitions: ["submitted"], internalDemoReviewEligible: true });
    mocks.submitForReview.mockResolvedValue({ reviewStatus: "submitted", notificationPolicy: "suppressed_demo" });
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    const choice = await screen.findByRole("checkbox", { name: /Notify team/u });
    expect(choice).toHaveProperty("checked", true);
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Submit for Approval" }));
    await waitFor(() => { expect(mocks.submitForReview).toHaveBeenCalledWith(CONFIG_ID, undefined, false); });
    expect(screen.getByRole("status").textContent).toContain("notifications were suppressed");
  });

  it("does not claim suppression when the server did not confirm it", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "draft", availableTransitions: ["submitted"], internalDemoReviewEligible: true });
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Notify team/u }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for Approval" }));
    await waitFor(() => { expect(mocks.submitForReview).toHaveBeenCalled(); });
    expect(screen.queryByText(/notifications were suppressed/u)).toBeNull();
  });

  it("clears the suppressed-submit confirmation when withdrawing before a later ordinary draft submission", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "draft", availableTransitions: ["submitted"], internalDemoReviewEligible: true });
    mocks.submitForReview.mockResolvedValueOnce({ reviewStatus: "submitted", notificationPolicy: "suppressed_demo" });
    const withdrawal = deferred<string>();
    mocks.withdrawReview.mockReturnValueOnce(withdrawal.promise);
    const panel = render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Notify team/u }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for Approval" }));
    await screen.findByText(/notifications were suppressed/u);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.queryByText(/notifications were suppressed/u)).toBeNull();
    await act(async () => { withdrawal.resolve("withdrawn"); await withdrawal.promise; });
    expect(screen.getByRole("button", { name: "Review saved plan: Withdrawn" })).toBeTruthy();
    expect(screen.queryByText(/notifications were suppressed/u)).toBeNull();
    panel.unmount();
    // The actual withdrawal route closes the review. A later draft is loaded
    // separately; do not invent a withdrawn-to-draft API transition here.
    mocks.submitForReview.mockResolvedValueOnce({ reviewStatus: "submitted", notificationPolicy: "team_requested" });
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for Approval" }));
    await screen.findByRole("button", { name: "Withdraw" });
    expect(mocks.submitForReview).toHaveBeenLastCalledWith(CONFIG_ID, undefined, true);
    expect(screen.queryByText(/notifications were suppressed/u)).toBeNull();
  });

  it("does not apply an older withdrawal after navigating A to B to A", async () => {
    const withdrawal = deferred<string>();
    mocks.withdrawReview.mockReturnValueOnce(withdrawal.promise);
    mocks.getAvailableTransitions.mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["withdrawn"] });
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    act(() => {
      useEditorStore.getState().reset();
      useEditorStore.setState({ configId: "22222222-2222-4222-8222-222222222222", objects: [object], isPublicPreview: false });
    });
    await screen.findByRole("button", { name: "Review saved plan: Draft" });
    act(() => {
      useEditorStore.getState().reset();
      useEditorStore.setState({ configId: CONFIG_ID, objects: [object], isPublicPreview: false });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Review saved plan: Draft" }));
    await act(async () => { withdrawal.resolve("withdrawn"); await withdrawal.promise; });
    expect(screen.getByRole("button", { name: "Submit for Approval" })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review saved plan: Withdrawn" })).toBeNull();
  });

  it("does not submit into a replacement editing session after saving", async () => {
    const saving = deferred<boolean>();
    mocks.flushAutoSave.mockReturnValueOnce(saving.promise);
    const submitting = submitConfigurationForReview(CONFIG_ID, false);
    useEditorStore.getState().reset();
    useEditorStore.setState({ configId: CONFIG_ID, objects: [object], isPublicPreview: false });
    saving.resolve(true);
    await expect(submitting).rejects.toThrow(/open layout changed/u);
    expect(mocks.submitForReview).not.toHaveBeenCalled();
  });

  it("releases its busy state after a same-ID reload supersedes a pending submission", async () => {
    const pending = deferred<{ reviewStatus: string; notificationPolicy: string }>();
    mocks.submitForReview.mockReturnValueOnce(pending.promise);
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit for Approval" }));
    await waitFor(() => { expect(mocks.submitForReview).toHaveBeenCalled(); });
    await act(async () => {
      useEditorStore.getState().reset();
      useEditorStore.setState({ configId: CONFIG_ID, objects: [object], isPublicPreview: false });
      pending.resolve({ reviewStatus: "submitted", notificationPolicy: "suppressed_demo" });
      await pending.promise;
    });
    expect(screen.getByRole("button", { name: "Submit for Approval" })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/notifications were suppressed/u)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["desktop", "mobile"] as const)("does not open the %s enquiry modal after the original editor session was replaced", async (surface) => {
    const save = deferred<boolean>();
    mocks.flushAutoSave.mockReturnValueOnce(save.promise);
    render(surface === "desktop" ? <SaveSendPanel /> : <MobilePlannerTopBar mode="3d" onModeChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    await act(async () => {
      useEditorStore.getState().reset();
      // Returning to the same ID is still a new editing session.
      useEditorStore.setState({ configId: CONFIG_ID, objects: [object], isPublicPreview: false });
      save.resolve(true);
      await save.promise;
    });
    expect(screen.queryByTestId("guest-enquiry-modal")).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Events Team" }).hasAttribute("disabled")).toBe(false);
  });

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
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
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
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    await screen.findByRole("button", { name: "Withdraw" });
    act(() => { enterCrossPhasePreview(); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit preview to withdraw" }).hasAttribute("disabled"))
        .toBe(true);
    });
  });

  it("scopes the saved plan's approval instead of approving a different phase preview", async () => {
    mocks.getAvailableTransitions.mockResolvedValueOnce({
      configurationId: CONFIG_ID,
      currentStatus: "approved",
      availableTransitions: [],
    });
    render(<SubmitForReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Review saved plan:/u }));
    await screen.findByText("Approved");
    act(() => { enterCrossPhasePreview(); });
    expect(screen.queryByText("Approved")).toBeNull();
    expect(screen.getByText("Saved plan: Approved")).toBeTruthy();
  });
});
