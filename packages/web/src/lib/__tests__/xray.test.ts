import { describe, it, expect } from "vitest";
import {
  XRAY_OPACITY,
  SOLID_OPACITY,
  XRAY_FADE_DURATION,
  stepXrayOpacity,
  applyXrayOpacity,
  isXrayTransitionComplete,
} from "../xray.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("xray constants", () => {
  it("XRAY_OPACITY is between 0 and 1 exclusive", () => {
    expect(XRAY_OPACITY).toBeGreaterThan(0);
    expect(XRAY_OPACITY).toBeLessThan(1);
  });

  it("SOLID_OPACITY is 1", () => {
    expect(SOLID_OPACITY).toBe(1);
  });

  it("XRAY_FADE_DURATION is 0.2 seconds (200ms)", () => {
    expect(XRAY_FADE_DURATION).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// stepXrayOpacity
// ---------------------------------------------------------------------------

describe("stepXrayOpacity", () => {
  it("returns target immediately when already at target (enabled)", () => {
    expect(stepXrayOpacity(XRAY_OPACITY, true, 0.016)).toBe(XRAY_OPACITY);
  });

  it("returns target immediately when already at target (disabled)", () => {
    expect(stepXrayOpacity(SOLID_OPACITY, false, 0.016)).toBe(SOLID_OPACITY);
  });

  it("decreases opacity when x-ray enabled and currently solid", () => {
    const result = stepXrayOpacity(SOLID_OPACITY, true, 0.016);
    expect(result).toBeLessThan(SOLID_OPACITY);
    expect(result).toBeGreaterThanOrEqual(XRAY_OPACITY);
  });

  it("increases opacity when x-ray disabled and currently ghosted", () => {
    const result = stepXrayOpacity(XRAY_OPACITY, false, 0.016);
    expect(result).toBeGreaterThan(XRAY_OPACITY);
    expect(result).toBeLessThanOrEqual(SOLID_OPACITY);
  });

  it("reaches XRAY_OPACITY after XRAY_FADE_DURATION total delta", () => {
    // Simulate stepping from solid to x-ray over exactly 200ms
    let opacity = SOLID_OPACITY;
    const steps = 20;
    const dt = XRAY_FADE_DURATION / steps;
    for (let i = 0; i < steps; i++) {
      opacity = stepXrayOpacity(opacity, true, dt);
    }
    expect(opacity).toBeCloseTo(XRAY_OPACITY, 2);
  });

  it("reaches SOLID_OPACITY after XRAY_FADE_DURATION total delta", () => {
    let opacity = XRAY_OPACITY;
    const steps = 20;
    const dt = XRAY_FADE_DURATION / steps;
    for (let i = 0; i < steps; i++) {
      opacity = stepXrayOpacity(opacity, false, dt);
    }
    expect(opacity).toBeCloseTo(SOLID_OPACITY, 2);
  });

  it("does not overshoot below XRAY_OPACITY with large delta", () => {
    const result = stepXrayOpacity(SOLID_OPACITY, true, 10);
    expect(result).toBe(XRAY_OPACITY);
  });

  it("does not overshoot above SOLID_OPACITY with large delta", () => {
    const result = stepXrayOpacity(XRAY_OPACITY, false, 10);
    expect(result).toBe(SOLID_OPACITY);
  });

  it("handles zero delta (no change)", () => {
    expect(stepXrayOpacity(0.5, true, 0)).toBe(0.5);
  });

  it("handles mid-transition correctly", () => {
    const mid = (SOLID_OPACITY + XRAY_OPACITY) / 2;
    const down = stepXrayOpacity(mid, true, 0.016);
    expect(down).toBeLessThan(mid);
    const up = stepXrayOpacity(mid, false, 0.016);
    expect(up).toBeGreaterThan(mid);
  });

  it("is monotonic when fading to x-ray (never increases)", () => {
    let opacity = SOLID_OPACITY;
    for (let i = 0; i < 30; i++) {
      const next = stepXrayOpacity(opacity, true, 0.01);
      expect(next).toBeLessThanOrEqual(opacity);
      opacity = next;
    }
  });

  it("is monotonic when fading to solid (never decreases)", () => {
    let opacity = XRAY_OPACITY;
    for (let i = 0; i < 30; i++) {
      const next = stepXrayOpacity(opacity, false, 0.01);
      expect(next).toBeGreaterThanOrEqual(opacity);
      opacity = next;
    }
  });
});

// ---------------------------------------------------------------------------
// applyXrayOpacity
// ---------------------------------------------------------------------------

describe("applyXrayOpacity", () => {
  it("floor is always exempt — returns baseOpacity unchanged", () => {
    expect(applyXrayOpacity("floor", 1, 0.15)).toBe(1);
    expect(applyXrayOpacity("floor", 0.5, 0.15)).toBe(0.5);
  });

  it("wall-back gets multiplied by xrayFactor", () => {
    expect(applyXrayOpacity("wall-back", 1, 0.5)).toBe(0.5);
  });

  it("ceiling gets multiplied by xrayFactor", () => {
    expect(applyXrayOpacity("ceiling", 1, 0.15)).toBeCloseTo(0.15);
  });

  it("dome gets multiplied by xrayFactor", () => {
    expect(applyXrayOpacity("dome", 0.8, 0.5)).toBeCloseTo(0.4);
  });

  it("wainscot surfaces get multiplied", () => {
    expect(applyXrayOpacity("wainscot-front", 1, 0.3)).toBeCloseTo(0.3);
  });

  it("at solid opacity (1.0), surfaces unchanged", () => {
    expect(applyXrayOpacity("wall-left", 0.7, 1.0)).toBeCloseTo(0.7);
  });

  it("at zero xrayFactor, non-floor surfaces are 0", () => {
    expect(applyXrayOpacity("wall-right", 1, 0)).toBe(0);
    expect(applyXrayOpacity("ceiling", 0.5, 0)).toBe(0);
  });

  it("combines with partial base opacity", () => {
    // Wall at 60% visibility + x-ray at 50% = 30%
    expect(applyXrayOpacity("wall-front", 0.6, 0.5)).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// isXrayTransitionComplete
// ---------------------------------------------------------------------------

describe("isXrayTransitionComplete", () => {
  it("returns true when at XRAY_OPACITY and enabled", () => {
    expect(isXrayTransitionComplete(XRAY_OPACITY, true)).toBe(true);
  });

  it("returns true when at SOLID_OPACITY and disabled", () => {
    expect(isXrayTransitionComplete(SOLID_OPACITY, false)).toBe(true);
  });

  it("returns false when at SOLID_OPACITY and enabled", () => {
    expect(isXrayTransitionComplete(SOLID_OPACITY, true)).toBe(false);
  });

  it("returns false when at XRAY_OPACITY and disabled", () => {
    expect(isXrayTransitionComplete(XRAY_OPACITY, false)).toBe(false);
  });

  it("returns true when within 0.001 tolerance", () => {
    expect(isXrayTransitionComplete(XRAY_OPACITY + 0.0005, true)).toBe(true);
    expect(isXrayTransitionComplete(SOLID_OPACITY - 0.0005, false)).toBe(true);
  });

  it("returns false when just outside tolerance", () => {
    expect(isXrayTransitionComplete(XRAY_OPACITY + 0.002, true)).toBe(false);
    expect(isXrayTransitionComplete(SOLID_OPACITY - 0.002, false)).toBe(false);
  });
});
