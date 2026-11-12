import { afterEach, describe, expect, it, vi } from "vitest";
import { MEASUREMENT_DECLINED_KEY, measurementDeclined, setMeasurementDeclined } from "../measurement-choice.js";

// ---------------------------------------------------------------------------
// "Don't measure my visits" (T-685): the privacy page's way to object to the
// page-speed measurements, kept in this browser; for this visit where the
// browser will not keep it; and never measuring where storage is refused.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  setMeasurementDeclined(false);
  window.localStorage.clear();
});

describe("the measurement choice", () => {
  it("measures by default, until the visitor says not to", () => {
    expect(measurementDeclined()).toBe(false);
  });

  it("keeps the choice in this browser, says it did, and forgets it when undone", () => {
    expect(setMeasurementDeclined(true)).toBe(true);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBe("1");
    expect(measurementDeclined()).toBe(true);
    expect(setMeasurementDeclined(false)).toBe(true);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBeNull();
    expect(measurementDeclined()).toBe(false);
  });

  it("honours a choice stored on an earlier visit", () => {
    window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    expect(measurementDeclined()).toBe(true);
  });

  // Spies on the instance: happy-dom's Storage.prototype is not what
  // window.localStorage calls (as flag.test.ts and planner-chrome-flag.test.ts).
  it("still honours the choice for this visit where storage fails, as in a private window", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(() => { setMeasurementDeclined(true); }).not.toThrow();
    expect(measurementDeclined()).toBe(true);
  });

  it("never measures a browser that will not let the site read its storage at all", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(measurementDeclined()).toBe(true);
  });

  it("says when the browser would not keep the choice (storage full): it holds for this visit only", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(setMeasurementDeclined(true)).toBe(false);
    expect(measurementDeclined()).toBe(true);
    // Nothing was kept, so the next visit is measured unless the visitor says again.
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBeNull();
  });
});
