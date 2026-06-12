import { describe, expect, it } from "vitest";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../money-input.js";

describe("parsePoundsToMinor", () => {
  it("parses whole pounds, one decimal, and two decimals exactly", () => {
    expect(parsePoundsToMinor("12")).toBe(1200);
    expect(parsePoundsToMinor("12.5")).toBe(1250);
    expect(parsePoundsToMinor("12.50")).toBe(1250);
    expect(parsePoundsToMinor("0.01")).toBe(1);
    expect(parsePoundsToMinor("0")).toBe(0);
  });

  it("never goes through floating point — the 0.29 trap parses exactly", () => {
    // parseFloat("0.29") * 100 === 28.999999999999996 — the precise failure
    // mode this parser exists to prevent.
    expect(parsePoundsToMinor("0.29")).toBe(29);
    expect(parsePoundsToMinor("1.13")).toBe(113);
    expect(parsePoundsToMinor("19.99")).toBe(1999);
  });

  it("accepts a £ prefix and surrounding whitespace", () => {
    expect(parsePoundsToMinor("£120.50")).toBe(12050);
    expect(parsePoundsToMinor("  45 ")).toBe(4500);
  });

  it("rejects ambiguous or malformed input", () => {
    for (const bad of ["", "abc", "12.345", "-5", "1,000", "12.", ".50", "£", "12 50", "1e3"]) {
      expect(parsePoundsToMinor(bad)).toBeNull();
    }
  });

  it("caps at seven pound digits and parses the ceiling exactly", () => {
    expect(parsePoundsToMinor("9999999.99")).toBe(999999999);
    expect(parsePoundsToMinor("12345678")).toBeNull();
  });
});

describe("formatMinorAsCurrency", () => {
  it("formats integer minor units for display", () => {
    expect(formatMinorAsCurrency(1250)).toBe("£12.50");
    expect(formatMinorAsCurrency(0)).toBe("£0.00");
    expect(formatMinorAsCurrency(265000)).toBe("£2,650.00");
  });
});
