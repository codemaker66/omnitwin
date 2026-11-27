import { afterEach, describe, expect, it, vi } from "vitest";
import { assemblyMode } from "../flag.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem("venviewer.assembly");
});

describe("when the Grand Assembly plays", () => {
  it("plays the first time a layout opens, by default", () => {
    expect(assemblyMode("")).toBe("first");
    expect(assemblyMode("?assembly=unfolding")).toBe("first");
  });

  it("plays on every open with ?assembly=accio, remembered on this device", () => {
    expect(assemblyMode("?assembly=accio")).toBe("always");
    expect(assemblyMode("")).toBe("always");
    expect(assemblyMode("?sky=1")).toBe("always");
  });

  it("turns off with ?assembly=off (or 0), remembered, and back to the default with ?assembly=on", () => {
    expect(assemblyMode("?assembly=off")).toBe("off");
    expect(assemblyMode("")).toBe("off");
    expect(assemblyMode("?assembly=on")).toBe("first");
    expect(assemblyMode("")).toBe("first");
    expect(assemblyMode("?assembly=0")).toBe("off");
    expect(assemblyMode("?assembly=1")).toBe("first");
  });

  it("still answers when the device's storage is unavailable", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(assemblyMode("?assembly=accio")).toBe("always");
    expect(assemblyMode("?assembly=off")).toBe("off");
    expect(assemblyMode("")).toBe("first");
  });
});
