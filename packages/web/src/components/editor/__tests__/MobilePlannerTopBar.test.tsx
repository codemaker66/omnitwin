import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePlannerTopBar } from "../MobilePlannerTopBar.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), listLinks: vi.fn() }));
vi.mock("../send-layout-flow.js", () => ({ prepareLayoutForGuestEnquiry: mocks.prepare }));
// The sheet's view-only links read the plan's working links; no network here.
vi.mock("../../../api/plan-view.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/plan-view.js")>(),
  listPlanViewLinks: mocks.listLinks,
}));
vi.mock("../GuestEnquiryModal.js", () => ({ GuestEnquiryModal: () => <div data-testid="enquiry-ready" /> }));

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.listLinks.mockReset();
  mocks.listLinks.mockResolvedValue([]);
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

// Fix-first item 11: phones have no Share lens, so a guest plan offers its PDF
// and a view-only link beside Send. The sheet is real; only requests are stubbed.
describe("MobilePlannerTopBar plan as a PDF", () => {
  it("offers a guest plan as a PDF in a labelled sheet, and closes on Escape", () => {
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    const open = screen.getByRole("button", { name: "Send your plan" });
    expect(open.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByRole("button", { name: "Send to Events Team" })).toBeTruthy();

    fireEvent.click(open);
    const sheet = screen.getByRole("dialog", { name: "Send your plan" });
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(sheet.textContent).toMatch(/no prices/u);
    expect(sheet.textContent).toMatch(/drawn by a visitor and not reviewed by the venue/u);
    expect(screen.getByTestId("visitor-pdf-prepare").textContent).toBe("Prepare the PDF");
    // Beside the PDF, the same plan as a view-only link (as on the Share lens).
    expect(screen.getByTestId("visitor-link-make").textContent).toBe("Copy a view-only link");
    expect(mocks.prepare).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Send your plan" })).toBeNull();
  });

  it("closes when the backdrop is tapped but not when the sheet is", () => {
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Send your plan" }));
    fireEvent.click(screen.getByRole("dialog", { name: "Send your plan" }));
    expect(screen.getByRole("dialog", { name: "Send your plan" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("visitor-pdf-sheet-backdrop"));
    expect(screen.queryByRole("dialog", { name: "Send your plan" })).toBeNull();
  });

  it("is not offered for a plan saved to an account", () => {
    useEditorStore.setState({ isPublicPreview: false });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send your plan" })).toBeNull();
  });

  // The guest enquiry route accepts only a guest's draft (public preview); a plan
  // saved to an account goes to the venue through its review instead (QoL E-01).
  it("does not offer the guest enquiry for a plan saved to an account", () => {
    useEditorStore.setState({ isPublicPreview: false });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
  });

  it("is not offered before anything is placed", () => {
    useEditorStore.setState({ objects: [] });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send your plan" })).toBeNull();
  });

  it("waits for the room timeline preview to end", () => {
    useLayoutTimelinePreviewStore.setState({ mode: "unavailable" });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    const open = screen.getByRole("button", { name: "Send your plan" });
    expect(open).toHaveProperty("disabled", true);
    fireEvent.click(open);
    expect(screen.queryByRole("dialog", { name: "Send your plan" })).toBeNull();
  });
});

describe("MobilePlannerTopBar identity", () => {
  const RECEPTION = {
    id: "space-reception", venueId: "venue", name: "Reception Room", slug: "reception-room",
    widthM: "13.4", lengthM: "11.2", heightM: "3.2", floorPlanOutline: [],
  };

  it("shows the room and layout the server actually returned", () => {
    useEditorStore.setState({ space: RECEPTION, configId: "cfg-ceilidh", configName: "Ceilidh long tables" });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.getByTestId("mobile-planner-room-name").textContent).toBe("Reception Room");
    expect(screen.getByTestId("mobile-planner-layout-name").textContent).toBe("Ceilidh long tables");
  });

  it("never guesses the flagship's names while the room or layout is still loading", () => {
    useEditorStore.setState({ space: null, configId: "cfg-loading", configName: null });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.queryByText("Grand Hall")).toBeNull();
    expect(screen.queryByText("Banquet Draft")).toBeNull();
    expect(screen.getByTestId("mobile-planner-room-name").textContent).toBe("Loading room…");
    expect(screen.getByTestId("mobile-planner-layout-name").textContent).toBe("Loading layout…");
  });

  it("calls a draft that has never been saved what it is", () => {
    useEditorStore.setState({ space: RECEPTION, configId: null, configName: null });
    render(<MobilePlannerTopBar mode="3d" onModeChange={vi.fn()} />);
    expect(screen.getByTestId("mobile-planner-layout-name").textContent).toBe("Unsaved layout");
  });
});
