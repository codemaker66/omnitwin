import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PlacementNotice } from "../PlacementNotice.js";
import { PLACEMENT_NOTICE_MS, usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { capReachedLine } from "../../../lib/placement-cap.js";

const LINE = capReachedLine(4);

beforeEach(() => {
  usePlacementNoticeStore.getState().dismiss();
  useCatalogueStore.getState().clearSelection();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  usePlacementNoticeStore.getState().dismiss();
});

describe.each([
  { label: "desktop", mobile: false, className: "placement-notice" },
  { label: "phone", mobile: true, className: "placement-notice is-mobile" },
])("PlacementNotice ($label)", ({ mobile, className }) => {
  it("keeps a polite status region mounted and puts the line in it", () => {
    render(<PlacementNotice mobile={mobile} />);
    const region = screen.getByTestId("placement-notice-region");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.className).toBe(className);
    expect(region.textContent).toBe("");

    act(() => { usePlacementNoticeStore.getState().post(LINE); });
    expect(screen.getByTestId("placement-notice").textContent)
      .toBe("The venue has 4 of these, and all 4 are placed; move one to use it elsewhere.");
  });

  it("clears itself after a few seconds", () => {
    vi.useFakeTimers();
    render(<PlacementNotice mobile={mobile} />);
    act(() => { usePlacementNoticeStore.getState().post(LINE); });
    act(() => { vi.advanceTimersByTime(PLACEMENT_NOTICE_MS - 1); });
    expect(screen.queryByTestId("placement-notice")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId("placement-notice")).toBeNull();
  });

  it("clears when the piece is put down or another is chosen", () => {
    useCatalogueStore.getState().selectItem("platform-narrow");
    render(<PlacementNotice mobile={mobile} />);
    act(() => { usePlacementNoticeStore.getState().post(LINE); });
    expect(screen.queryByTestId("placement-notice")).not.toBeNull();
    act(() => { useCatalogueStore.getState().clearSelection(); });
    expect(screen.queryByTestId("placement-notice")).toBeNull();
  });
});

describe("placement notice store", () => {
  it("replaces the last line with a new one and keeps the newest timer", () => {
    vi.useFakeTimers();
    usePlacementNoticeStore.getState().post("First");
    act(() => { vi.advanceTimersByTime(PLACEMENT_NOTICE_MS - 100); });
    usePlacementNoticeStore.getState().post("Second");
    act(() => { vi.advanceTimersByTime(200); });
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Second");
    act(() => { vi.advanceTimersByTime(PLACEMENT_NOTICE_MS); });
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });

  it("dismisses only the line it was asked to", () => {
    usePlacementNoticeStore.getState().post("Kept");
    const id = usePlacementNoticeStore.getState().notice?.id ?? -1;
    usePlacementNoticeStore.getState().dismiss(id + 1);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept");
    usePlacementNoticeStore.getState().dismiss(id);
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });
});
