import { describe, it, expect } from "vitest";
import { sliderPercentToHeight, heightToSliderPercent } from "../SectionSlider.js";

// ---------------------------------------------------------------------------
// sliderPercentToHeight
// ---------------------------------------------------------------------------

describe("sliderPercentToHeight", () => {
  it("0% returns 0 (floor only)", () => {
    expect(sliderPercentToHeight(0, 7)).toBe(0);
  });

  it("100% returns maxHeight (full room)", () => {
    expect(sliderPercentToHeight(100, 7)).toBe(7);
  });

  it("50% returns half of maxHeight", () => {
    expect(sliderPercentToHeight(50, 7)).toBe(3.5);
  });

  it("works with different maxHeight values", () => {
    expect(sliderPercentToHeight(50, 10)).toBe(5);
  });

  it("25% returns quarter height", () => {
    expect(sliderPercentToHeight(25, 8)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// heightToSliderPercent
// ---------------------------------------------------------------------------

describe("heightToSliderPercent", () => {
  it("height 0 returns 0%", () => {
    expect(heightToSliderPercent(0, 7)).toBe(0);
  });

  it("height = maxHeight returns 100%", () => {
    expect(heightToSliderPercent(7, 7)).toBe(100);
  });

  it("half maxHeight returns 50%", () => {
    expect(heightToSliderPercent(3.5, 7)).toBe(50);
  });

  it("handles maxHeight of 0 gracefully (returns 100)", () => {
    expect(heightToSliderPercent(0, 0)).toBe(100);
  });

  it("handles negative maxHeight gracefully (returns 100)", () => {
    expect(heightToSliderPercent(0, -1)).toBe(100);
  });

  it("works with non-integer values", () => {
    expect(heightToSliderPercent(2.5, 10)).toBeCloseTo(25);
  });
});

// ---------------------------------------------------------------------------
// Round-trip consistency
// ---------------------------------------------------------------------------

describe("slider round-trip", () => {
  it("percent → height → percent is identity", () => {
    const maxHeight = 7;
    for (const percent of [0, 25, 50, 75, 100]) {
      const height = sliderPercentToHeight(percent, maxHeight);
      const result = heightToSliderPercent(height, maxHeight);
      expect(result).toBeCloseTo(percent);
    }
  });
});
