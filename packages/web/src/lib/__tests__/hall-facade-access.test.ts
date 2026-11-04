import { afterEach, describe, expect, it } from "vitest";
import { hallFacadeRequested } from "../hall-facade-access.js";

describe("hallFacadeRequested", () => {
  afterEach(() => {
    window.localStorage.removeItem("venviewer.hall-facade");
  });

  it("is off unless this device has asked for it", () => {
    expect(hallFacadeRequested("")).toBe(false);
    expect(hallFacadeRequested("?sky=1")).toBe(false);
  });

  it("turns on with ?facade=1 and remembers it on this device", () => {
    expect(hallFacadeRequested("?facade=1")).toBe(true);
    expect(hallFacadeRequested("")).toBe(true);
  });

  it("turns off again with ?facade=0, remembered too", () => {
    hallFacadeRequested("?facade=1");
    expect(hallFacadeRequested("?facade=0")).toBe(false);
    expect(hallFacadeRequested("")).toBe(false);
  });

  it("ignores any other value and keeps the last choice", () => {
    hallFacadeRequested("?facade=1");
    expect(hallFacadeRequested("?facade=yes")).toBe(true);
  });
});
