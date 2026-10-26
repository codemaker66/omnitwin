import { afterEach, describe, expect, it, vi } from "vitest";
import { assemblyRequested } from "../flag.js";

afterEach(() => {
  window.localStorage.removeItem("venviewer.assembly");
  vi.restoreAllMocks();
});

describe("the Grand Assembly flag", () => {
  it("is off unless a device asks for it", () => {
    expect(assemblyRequested("")).toBeNull();
    expect(assemblyRequested("?assembly=unfolding")).toBeNull();
  });

  it("turns on with ?assembly=accio and is remembered on this device", () => {
    expect(assemblyRequested("?assembly=accio")).toBe("accio");
    expect(assemblyRequested("")).toBe("accio");
    expect(assemblyRequested("?sky=1")).toBe("accio");
  });

  it("turns off again with ?assembly=off (or 0) and forgets it", () => {
    assemblyRequested("?assembly=accio");
    expect(assemblyRequested("?assembly=off")).toBeNull();
    expect(assemblyRequested("")).toBeNull();
    assemblyRequested("?assembly=accio");
    expect(assemblyRequested("?assembly=0")).toBeNull();
    expect(assemblyRequested("")).toBeNull();
  });

  it("still answers when the device's storage is unavailable", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(assemblyRequested("?assembly=accio")).toBe("accio");
    expect(assemblyRequested("")).toBeNull();
  });
});
