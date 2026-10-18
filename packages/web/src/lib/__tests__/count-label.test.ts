import { describe, expect, it } from "vitest";
import { countLabel, countNoun } from "../count-label.js";

// Integration check, 17 Oct 2026: "Procedural preview · 1 issues".
describe("countLabel", () => {
  it("uses the singular for exactly one", () => {
    expect(countLabel(1, "issue")).toBe("1 issue");
    expect(countLabel(1, "known issue")).toBe("1 known issue");
    expect(countLabel(1, "round table")).toBe("1 round table");
  });

  it("uses the plural for none and for many", () => {
    expect(countLabel(0, "issue")).toBe("0 issues");
    expect(countLabel(2, "seat")).toBe("2 seats");
  });

  it("takes an irregular plural", () => {
    expect(countLabel(1, "person", "people")).toBe("1 person");
    expect(countLabel(3, "person", "people")).toBe("3 people");
  });

  it("sets large numbers with the British thousands separator", () => {
    expect(countLabel(1200, "guest")).toBe("1,200 guests");
  });
});

describe("countNoun", () => {
  it("returns the noun alone", () => {
    expect(countNoun(1, "hotspot")).toBe("hotspot");
    expect(countNoun(4, "hotspot")).toBe("hotspots");
  });
});
