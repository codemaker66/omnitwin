import { afterEach, describe, expect, it, vi } from "vitest";
import { nativePlannerPixelRatio, readNativePlannerPixelRatio, subscribeNativePlannerPixelRatio } from "../planner-resolution-policy.js";

describe("planner native resolution policy", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([0.8, 1, 1.25, 1.5, 2, 3, 4])("preserves the reported native ratio %s", (ratio) => {
    expect(nativePlannerPixelRatio(ratio)).toBe(ratio);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("uses CSS resolution when the reported ratio %s is invalid", (ratio) => {
    expect(nativePlannerPixelRatio(ratio)).toBe(1);
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
