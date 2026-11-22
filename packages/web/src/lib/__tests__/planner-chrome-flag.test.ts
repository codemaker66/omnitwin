import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountedPlannerChrome, PLANNER_CHROME_STORAGE_KEY, plannerChromeRequested, setMountedPlannerChrome } from "../planner-chrome-flag.js";

// ---------------------------------------------------------------------------
// The new chrome behind one flag (T-671, slice 6): `?chrome=v2` turns it on
// and this device remembers it until `?chrome=v1`; slice 21 flips the default.
// ---------------------------------------------------------------------------

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  setMountedPlannerChrome(null);
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
    // The whole object is stood in for, as planner-features.test.ts does. A spy on the page's own storage object
    // outlives restoreAllMocks here: storage stayed refused for every test after this one.
    const storage = window.localStorage;
    const refuse = (): never => { throw new Error("blocked"); };
    Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: refuse, setItem: refuse, removeItem: refuse } });
    try {
      expect(plannerChromeRequested("?chrome=v2")).toBe("v2");
      expect(plannerChromeRequested("")).toBe("v1");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    }
    // And the page's own storage is back, with nothing written to it meanwhile.
    expect(window.localStorage.getItem(PLANNER_CHROME_STORAGE_KEY)).toBeNull();
  });
});

// What is mounted is asked of the page that mounted it, never of the address or the device's memory at the moment of
// asking: another tab can change that memory, and this page keeps the chrome it opened with.
describe("the chrome that is mounted", () => {
  it("is today's where no page has said", () => {
    expect(mountedPlannerChrome()).toBe("v1");
  });

  it("is what the page said, until the page takes it back", () => {
    setMountedPlannerChrome("hud");
    expect(mountedPlannerChrome()).toBe("hud");
    setMountedPlannerChrome("v2");
    expect(mountedPlannerChrome()).toBe("v2");
    setMountedPlannerChrome(null);
    expect(mountedPlannerChrome()).toBe("v1");
  });

  it("does not follow the device's memory or the address", () => {
    setMountedPlannerChrome("v1");
    window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "hud");
    expect(plannerChromeRequested("")).toBe("hud");
    expect(mountedPlannerChrome()).toBe("v1");
    expect(plannerChromeRequested("?chrome=v2")).toBe("v2");
    expect(mountedPlannerChrome()).toBe("v1");
  });
});
