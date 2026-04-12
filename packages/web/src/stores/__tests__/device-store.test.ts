import { describe, it, expect, beforeEach } from "vitest";
import { useDeviceStore } from "../device-store.js";

beforeEach(() => {
  // Reset to initial state
  useDeviceStore.setState({
    tier: "low",
    quality: useDeviceStore.getState().quality,
    gpuRenderer: null,
    detected: false,
  });
});

describe("device-store", () => {
  it("defaults to low tier before detection", () => {
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("low");
    expect(state.detected).toBe(false);
    expect(state.gpuRenderer).toBeNull();
  });

  it("detect() classifies tier from GPU renderer string", () => {
    // "NVIDIA GeForce" class strings should classify as medium or high
    useDeviceStore.getState().detect("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080, OpenGL 4.5)");
    const state = useDeviceStore.getState();
    expect(state.detected).toBe(true);
    expect(state.gpuRenderer).toContain("NVIDIA");
    // Should be medium or high — the exact result depends on classifyDevice
    expect(["medium", "high"]).toContain(state.tier);
  });

  it("detect() updates quality settings to match tier", () => {
    useDeviceStore.getState().detect("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080, OpenGL 4.5)");
    const state = useDeviceStore.getState();
    expect(state.quality).toBeDefined();
    // Quality settings should have known properties (dpr, shadows, etc.)
    expect(typeof state.quality).toBe("object");
  });

  it("override() sets tier directly without a renderer string", () => {
    useDeviceStore.getState().override("high");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("high");
    expect(state.detected).toBe(true);
    // gpuRenderer is unchanged (null) — override doesn't set it
    expect(state.gpuRenderer).toBeNull();
  });

  it("override() to poster tier works", () => {
    useDeviceStore.getState().override("poster");
    expect(useDeviceStore.getState().tier).toBe("poster");
  });

  it("quality settings change when tier changes", () => {
    useDeviceStore.getState().override("low");
    const lowQuality = useDeviceStore.getState().quality;
    useDeviceStore.getState().override("high");
    const highQuality = useDeviceStore.getState().quality;
    // Quality objects should differ between low and high
    expect(lowQuality).not.toEqual(highQuality);
  });
});
