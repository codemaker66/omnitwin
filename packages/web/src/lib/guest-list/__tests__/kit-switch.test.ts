import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIT_PARAM, KIT_STORAGE_KEY, kitRequested } from "../kit-switch.js";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

describe("the planner's kit switch", () => {
  it("names its address parameter and its storage key", () => {
    expect(KIT_PARAM).toBe("kit");
    expect(KIT_STORAGE_KEY).toBe("venviewer.planners-kit");
  });

  it("is off until asked for, then remembered on this device", () => {
    expect(kitRequested("")).toBe(false);
    expect(kitRequested("?kit=on")).toBe(true);
    expect(window.localStorage.getItem(KIT_STORAGE_KEY)).toBe("on");
    expect(kitRequested("")).toBe(true);
    expect(kitRequested("?kit=off")).toBe(false);
    expect(window.localStorage.getItem(KIT_STORAGE_KEY)).toBeNull();
    expect(kitRequested("")).toBe(false);
  });

  it("ignores any other value and leaves what is remembered alone", () => {
    expect(kitRequested("?kit=maybe")).toBe(false);
    kitRequested("?kit=on");
    expect(kitRequested("?kit=maybe")).toBe(true);
    expect(kitRequested("?sheet=1")).toBe(true);
  });

  it("works when storage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("storage refused"); });
    expect(() => kitRequested("?kit=on")).not.toThrow();
    expect(kitRequested("?kit=on")).toBe(true);
    expect(kitRequested("")).toBe(false);
    expect(kitRequested("?kit=off")).toBe(false);
  });

  it("works when only the storage calls throw", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("full"); });
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(kitRequested("?kit=on")).toBe(true);
    expect(kitRequested("")).toBe(false);
    expect(kitRequested("?kit=off")).toBe(false);
  });
});
