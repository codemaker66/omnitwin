import { afterEach, describe, expect, it, vi } from "vitest";
import { hallFacadeRequested } from "../hall-facade-access.js";

describe("hallFacadeRequested", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem("venviewer.hall-facade");
  });

  it("is on unless this device has turned it off (Blake, 4 November 2026)", () => {
    expect(hallFacadeRequested("")).toBe(true);
    expect(hallFacadeRequested("?sky=1")).toBe(true);
  });

  it("turns off with ?facade=0 and remembers it on this device", () => {
    expect(hallFacadeRequested("?facade=0")).toBe(false);
    expect(hallFacadeRequested("")).toBe(false);
  });

  it("turns on again with ?facade=1, remembered too", () => {
    hallFacadeRequested("?facade=0");
    expect(hallFacadeRequested("?facade=1")).toBe(true);
    expect(hallFacadeRequested("")).toBe(true);
  });

  it("ignores any other value and keeps the last choice", () => {
    hallFacadeRequested("?facade=0");
    expect(hallFacadeRequested("?facade=yes")).toBe(false);
  });

  it("stays on where this device's storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(hallFacadeRequested("")).toBe(true);
  });
});
