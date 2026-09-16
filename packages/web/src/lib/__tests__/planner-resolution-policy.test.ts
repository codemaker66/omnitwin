import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PLANNER_PIXEL_RATIO,
  MOTION_PLANNER_PIXEL_RATIO,
  nativePlannerPixelRatio,
  plannerPixelRatioForMotion,
  rawDevicePixelRatio,
  readNativePlannerPixelRatio,
  subscribeNativePlannerPixelRatio,
} from "../planner-resolution-policy.js";

describe("planner native resolution policy", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([0.8, 1, 1.25, 1.5, 2])("preserves the reported native ratio %s at or below the ceiling", (ratio) => {
    expect(nativePlannerPixelRatio(ratio)).toBe(ratio);
  });

  // Above 2 the extra fragments buy nothing the eye can find at arm's length,
  // and cost gaussian sorting and fill on every frame.
  it.each([2.5, 3, 4])("clamps the reported native ratio %s to the resting ceiling", (ratio) => {
    expect(nativePlannerPixelRatio(ratio)).toBe(MAX_PLANNER_PIXEL_RATIO);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("uses CSS resolution when the reported ratio %s is invalid", (ratio) => {
    expect(nativePlannerPixelRatio(ratio)).toBe(1);
  });

  it("leaves the display's own ratio unclamped for the resolution query", () => {
    // The query must watch the REAL density: a 3x panel told to watch
    // "(resolution: 2dppx)" would never match, never re-arm, and so would
    // never notice a move to a 1x monitor.
    expect(rawDevicePixelRatio(3)).toBe(3);
    expect(rawDevicePixelRatio(0)).toBe(1);
  });

  it("drops to the motion floor while the camera moves and restores on settle", () => {
    expect(plannerPixelRatioForMotion(3, true)).toBe(MOTION_PLANNER_PIXEL_RATIO);
    expect(plannerPixelRatioForMotion(2, true)).toBe(MOTION_PLANNER_PIXEL_RATIO);
    expect(plannerPixelRatioForMotion(3, false)).toBe(MAX_PLANNER_PIXEL_RATIO);
    expect(plannerPixelRatioForMotion(2, false)).toBe(2);
  });

  it("never RAISES a low-density display to the motion floor", () => {
    // Upscaling a 1x panel to 1.5 would make moving the camera cost more than
    // holding it still, on exactly the machines that can least afford it.
    expect(plannerPixelRatioForMotion(1, true)).toBe(1);
    expect(plannerPixelRatioForMotion(1.25, true)).toBe(1.25);
    expect(plannerPixelRatioForMotion(1, false)).toBe(1);
  });

  it("rearms the display-density observer and removes both listeners on unmount", () => {
    const first = window.matchMedia("(resolution: 1dppx)");
    const second = window.matchMedia("(resolution: 2dppx)");
    const removeFirst = vi.spyOn(first, "removeEventListener");
    const removeSecond = vi.spyOn(second, "removeEventListener");
    const addSecond = vi.spyOn(second, "addEventListener");
    const match = vi.spyOn(window, "matchMedia").mockReturnValueOnce(first).mockReturnValue(second);
    const notify = vi.fn();
    const unsubscribe = subscribeNativePlannerPixelRatio(notify);
    expect(match).toHaveBeenCalledWith(`(resolution: ${String(readNativePlannerPixelRatio())}dppx)`);
    first.dispatchEvent(new Event("change"));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(removeFirst).toHaveBeenCalledWith("change", expect.any(Function));
    expect(addSecond).toHaveBeenCalledWith("change", expect.any(Function));
    unsubscribe();
    expect(removeSecond).toHaveBeenCalledWith("change", expect.any(Function));
    second.dispatchEvent(new Event("change"));
    window.dispatchEvent(new Event("resize"));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
