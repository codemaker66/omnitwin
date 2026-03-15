import { describe, it, expect, beforeEach } from "vitest";
import { useXrayStore } from "../../stores/xray-store.js";
import { XRAY_OPACITY, SOLID_OPACITY, applyXrayOpacity } from "../../lib/xray.js";

// ---------------------------------------------------------------------------
// These tests verify XrayToggle's integration with the store and the
// applyXrayOpacity function used in GrandHallRoom + BrickWall useFrame loops.
// The component itself is an R3F controller — we test the store interactions
// and opacity math that the component drives.
// ---------------------------------------------------------------------------

const initialState = useXrayStore.getState();

beforeEach(() => {
  useXrayStore.setState(initialState, true);
});

describe("XrayToggle store integration", () => {
  it("X key toggle: store starts disabled, toggle enables", () => {
    expect(useXrayStore.getState().enabled).toBe(false);
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(true);
  });

  it("full flow: toggle → update to completion → opacity at XRAY_OPACITY", () => {
    useXrayStore.getState().toggle();
    // Simulate enough frames to complete the 200ms transition
    for (let i = 0; i < 30; i++) {
      useXrayStore.getState().update(0.016);
    }
    expect(useXrayStore.getState().opacity).toBeCloseTo(XRAY_OPACITY, 2);
  });

  it("toggle off → update to completion → opacity back at SOLID_OPACITY", () => {
    // Enable and complete
    useXrayStore.getState().toggle();
    useXrayStore.getState().update(1);
    expect(useXrayStore.getState().opacity).toBe(XRAY_OPACITY);

    // Disable and complete
    useXrayStore.getState().toggle();
    useXrayStore.getState().update(1);
    expect(useXrayStore.getState().opacity).toBe(SOLID_OPACITY);
  });
});

describe("applyXrayOpacity in rendering context", () => {
  it("floor always returns base opacity regardless of xray state", () => {
    expect(applyXrayOpacity("floor", 1, XRAY_OPACITY)).toBe(1);
    expect(applyXrayOpacity("floor", 0.5, XRAY_OPACITY)).toBe(0.5);
  });

  it("ceiling opacity is multiplied by xray factor", () => {
    // Ceiling visible + xray active = ghosted
    expect(applyXrayOpacity("ceiling", 1, XRAY_OPACITY)).toBeCloseTo(XRAY_OPACITY);
    // Ceiling hidden + xray = still hidden
    expect(applyXrayOpacity("ceiling", 0, XRAY_OPACITY)).toBe(0);
  });

  it("wall opacity is multiplied by xray factor", () => {
    // Wall at full visibility + xray active
    expect(applyXrayOpacity("wall-back", 1, XRAY_OPACITY)).toBeCloseTo(XRAY_OPACITY);
    // Wall at 50% visibility + xray at 50%
    expect(applyXrayOpacity("wall-front", 0.5, 0.5)).toBeCloseTo(0.25);
  });

  it("dome opacity is multiplied by xray factor", () => {
    expect(applyXrayOpacity("dome", 1, XRAY_OPACITY)).toBeCloseTo(XRAY_OPACITY);
  });

  it("wainscoting follows xray factor", () => {
    expect(applyXrayOpacity("wainscot-left", 1, XRAY_OPACITY)).toBeCloseTo(XRAY_OPACITY);
  });

  it("at solid opacity (no xray), surfaces unchanged", () => {
    expect(applyXrayOpacity("wall-back", 0.8, SOLID_OPACITY)).toBeCloseTo(0.8);
    expect(applyXrayOpacity("ceiling", 1, SOLID_OPACITY)).toBe(1);
    expect(applyXrayOpacity("dome", 1, SOLID_OPACITY)).toBe(1);
  });
});

describe("xray with wall visibility interaction", () => {
  it("hidden wall (opacity 0) stays hidden even without xray", () => {
    expect(applyXrayOpacity("wall-front", 0, SOLID_OPACITY)).toBe(0);
  });

  it("hidden wall stays hidden with xray active", () => {
    expect(applyXrayOpacity("wall-front", 0, XRAY_OPACITY)).toBe(0);
  });

  it("partially visible wall gets further reduced by xray", () => {
    // Wall at 60% from auto-visibility, xray at 15%
    const result = applyXrayOpacity("wall-left", 0.6, XRAY_OPACITY);
    expect(result).toBeCloseTo(0.6 * XRAY_OPACITY);
    expect(result).toBeLessThan(0.1);
  });
});
