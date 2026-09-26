import { describe, expect, it } from "vitest";
import { markInitials, markInk } from "../venue-mark.js";

describe("venue mark", () => {
  it("puts dark ink on light and middling colours, and paper on dark ones", () => {
    expect(markInk("#c98a5b")).toBe("dark");
    expect(markInk("#f2eddd")).toBe("dark");
    expect(markInk("#264337")).toBe("light");
    expect(markInk("#000000")).toBe("light");
  });

  it("falls back to dark ink for anything that is not a six-digit colour", () => {
    expect(markInk("gold")).toBe("dark");
    expect(markInk("#fff")).toBe("dark");
  });

  it("takes the first letters of the first two words, or two letters of one word", () => {
    expect(markInitials("Trades Hall Glasgow")).toBe("TH");
    expect(markInitials("  trades   hall ")).toBe("TH");
    expect(markInitials("Merchants")).toBe("ME");
    expect(markInitials("   ")).toBe("V");
  });
});
