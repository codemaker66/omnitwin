import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANNER_CHROME_STORAGE_KEY, plannerChromeRequested } from "../planner-chrome-flag.js";

// ---------------------------------------------------------------------------
// The new chrome behind one flag (T-671, slice 6): `?chrome=v2` turns it on
// and this device remembers it until `?chrome=v1`; slice 21 flips the default.
// ---------------------------------------------------------------------------

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the planner chrome flag", () => {
  it("is today's chrome until asked", () => {
    expect(plannerChromeRequested("")).toBe("v1");
    expect(plannerChromeRequested("?code=abc")).toBe("v1");
  });

  it("turns the new chrome on and remembers it on this device", () => {
    expect(plannerChromeRequested("?chrome=v2")).toBe("v2");
    expect(window.localStorage.getItem(PLANNER_CHROME_STORAGE_KEY)).toBe("v2");
    expect(plannerChromeRequested("")).toBe("v2");
  });

  it("turns it off again, and remembers that", () => {
    plannerChromeRequested("?chrome=v2");
    expect(plannerChromeRequested("?chrome=v1")).toBe("v1");
    expect(plannerChromeRequested("")).toBe("v1");
  });

  it("ignores a value it does not know", () => {
    plannerChromeRequested("?chrome=v2");
    expect(plannerChromeRequested("?chrome=v3")).toBe("v2");
    window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "nonsense");
    expect(plannerChromeRequested("")).toBe("v1");
  });

  it("still answers the address when storage is refused", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(plannerChromeRequested("?chrome=v2")).toBe("v2");
    expect(plannerChromeRequested("")).toBe("v1");
  });
});
