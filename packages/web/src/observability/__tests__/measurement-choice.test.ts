import { afterEach, describe, expect, it, vi } from "vitest";
import { MEASUREMENT_DECLINED_KEY, measurementDeclined, setMeasurementDeclined } from "../measurement-choice.js";

// ---------------------------------------------------------------------------
// "Don't measure my visits" (T-685): the privacy page's way to object to the
// page-speed timings, kept on this device; for this visit where storage fails.
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

  it("keeps the choice on this device, and forgets it when undone", () => {
    setMeasurementDeclined(true);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBe("1");
    expect(measurementDeclined()).toBe(true);
    setMeasurementDeclined(false);
    expect(window.localStorage.getItem(MEASUREMENT_DECLINED_KEY)).toBeNull();
    expect(measurementDeclined()).toBe(false);
  });

  it("honours a choice stored on an earlier visit", () => {
    window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    expect(measurementDeclined()).toBe(true);
  });

  it("still honours the choice for this visit where storage fails, as in a private window", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(() => { setMeasurementDeclined(true); }).not.toThrow();
    expect(measurementDeclined()).toBe(true);
  });
});
