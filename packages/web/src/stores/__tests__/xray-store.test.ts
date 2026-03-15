import { describe, it, expect, beforeEach } from "vitest";
import { useXrayStore } from "../xray-store.js";
import { XRAY_OPACITY, SOLID_OPACITY, XRAY_FADE_DURATION } from "../../lib/xray.js";

const initialState = useXrayStore.getState();

beforeEach(() => {
  useXrayStore.setState(initialState, true);
});

describe("xray-store", () => {
  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("starts with x-ray disabled", () => {
    expect(useXrayStore.getState().enabled).toBe(false);
  });

  it("starts at solid opacity", () => {
    expect(useXrayStore.getState().opacity).toBe(SOLID_OPACITY);
  });

  // -------------------------------------------------------------------------
  // toggle
  // -------------------------------------------------------------------------

  it("toggle enables x-ray", () => {
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(true);
  });

  it("double toggle returns to disabled", () => {
    useXrayStore.getState().toggle();
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(false);
  });

  it("toggle does not immediately change opacity", () => {
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().opacity).toBe(SOLID_OPACITY);
  });

  // -------------------------------------------------------------------------
  // update — fading to x-ray
  // -------------------------------------------------------------------------

  it("update returns false when no transition needed", () => {
    const result = useXrayStore.getState().update(0.016);
    expect(result).toBe(false);
  });

  it("update decreases opacity after toggle on", () => {
    useXrayStore.getState().toggle(); // enable
    useXrayStore.getState().update(0.016);
    expect(useXrayStore.getState().opacity).toBeLessThan(SOLID_OPACITY);
  });

  it("update returns true while transitioning", () => {
    useXrayStore.getState().toggle(); // enable
    const result = useXrayStore.getState().update(0.016);
    expect(result).toBe(true);
  });

  it("reaches XRAY_OPACITY after full duration", () => {
    useXrayStore.getState().toggle(); // enable
    const steps = 20;
    const dt = XRAY_FADE_DURATION / steps;
    for (let i = 0; i < steps + 5; i++) {
      useXrayStore.getState().update(dt);
    }
    expect(useXrayStore.getState().opacity).toBeCloseTo(XRAY_OPACITY, 2);
  });

  it("returns false once transition completes", () => {
    useXrayStore.getState().toggle(); // enable
    // Large step to complete instantly
    useXrayStore.getState().update(1);
    // After reaching target, next update returns false
    const result2 = useXrayStore.getState().update(0.016);
    expect(result2).toBe(false);
  });

  // -------------------------------------------------------------------------
  // update — fading back to solid
  // -------------------------------------------------------------------------

  it("fades back to solid after toggling off", () => {
    // Enable and complete transition
    useXrayStore.getState().toggle();
    useXrayStore.getState().update(1);
    expect(useXrayStore.getState().opacity).toBe(XRAY_OPACITY);

    // Disable
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(false);

    // Fade back
    useXrayStore.getState().update(1);
    expect(useXrayStore.getState().opacity).toBe(SOLID_OPACITY);
  });

  // -------------------------------------------------------------------------
  // rapid toggling
  // -------------------------------------------------------------------------

  it("handles rapid toggle mid-transition", () => {
    useXrayStore.getState().toggle(); // enable
    useXrayStore.getState().update(XRAY_FADE_DURATION / 2); // halfway
    const midOpacity = useXrayStore.getState().opacity;
    expect(midOpacity).toBeGreaterThan(XRAY_OPACITY);
    expect(midOpacity).toBeLessThan(SOLID_OPACITY);

    // Toggle back before completing
    useXrayStore.getState().toggle(); // disable
    useXrayStore.getState().update(0.016);
    expect(useXrayStore.getState().opacity).toBeGreaterThan(midOpacity);
  });

  it("opacity stays within valid range through multiple rapid toggles", () => {
    for (let i = 0; i < 10; i++) {
      useXrayStore.getState().toggle();
      useXrayStore.getState().update(0.03);
    }
    const opacity = useXrayStore.getState().opacity;
    expect(opacity).toBeGreaterThanOrEqual(XRAY_OPACITY);
    expect(opacity).toBeLessThanOrEqual(SOLID_OPACITY);
  });
});
