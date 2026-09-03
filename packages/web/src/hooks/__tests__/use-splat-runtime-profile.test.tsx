import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSplatRuntimeProfile } from "../use-splat-runtime-profile.js";
import { useDeviceStore } from "../../stores/device-store.js";
import { getQualitySettings } from "../../lib/device-tier.js";
import { SPLAT_RUNTIME_PROFILES } from "../../lib/splat-runtime-profile.js";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)";

function resetDeviceStore(): void {
  useDeviceStore.setState({
    tier: "low",
    quality: getQualitySettings("low"),
    gpuRenderer: null,
    detected: false,
  });
}

describe("useSplatRuntimeProfile", () => {
  beforeEach(() => {
    resetDeviceStore();
    delete window.__splatRuntimeProfile;
  });

  afterEach(() => {
    // Without globals, Testing Library does not unmount between tests; a hook
    // left mounted would re-detect the GPU the moment the store is reset.
    cleanup();
    delete window.__splatRuntimeProfile;
  });

  it("classifies the device from the probe on the FIRST render and records it in the store", () => {
    const probe = vi.fn(() => RTX);
    const { result } = renderHook(() => useSplatRuntimeProfile({ probe, allowOverrides: false }));

    expect(result.current.tier).toBe("high");
    expect(result.current.lodSplatCount).toBe(SPLAT_RUNTIME_PROFILES.high.lodSplatCount);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(useDeviceStore.getState().detected).toBe(true);
    expect(useDeviceStore.getState().tier).toBe("high");
    expect(useDeviceStore.getState().gpuRenderer).toBe(RTX);
  });

  it("trusts a store that has already detected and never probes again", () => {
    useDeviceStore.getState().detect("Intel(R) Iris(R) Xe Graphics");
    const probe = vi.fn(() => RTX);
    const { result } = renderHook(() => useSplatRuntimeProfile({ probe }));

    expect(result.current.tier).toBe("medium");
    expect(probe).not.toHaveBeenCalled();
  });

  it("keeps the store's safe fallback tier when the probe finds no GPU", () => {
    const probe = vi.fn((): string | null => null);
    const { result } = renderHook(() => useSplatRuntimeProfile({ probe }));

    expect(result.current.tier).toBe("low");
    expect(useDeviceStore.getState().detected).toBe(false);
  });

  it("applies query overrides only when the caller allows them", () => {
    const denied = renderHook(() =>
      useSplatRuntimeProfile({ probe: () => RTX, search: "?splat=sort:50", allowOverrides: false }));
    expect(denied.result.current.minSortIntervalMs).toBe(SPLAT_RUNTIME_PROFILES.high.minSortIntervalMs);
    expect(denied.result.current.source).toBe("tier");

    const allowed = renderHook(() =>
      useSplatRuntimeProfile({ probe: () => RTX, search: "?splat=sort:50", allowOverrides: true }));
    expect(allowed.result.current.minSortIntervalMs).toBe(50);
    expect(allowed.result.current.source).toBe("override");
  });

  it("returns the same profile object across re-renders so renderer effects do not re-run", () => {
    const { result, rerender } = renderHook(() => useSplatRuntimeProfile({ probe: () => RTX }));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("publishes the profile on window while mounted when asked, and removes it on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useSplatRuntimeProfile({ probe: () => RTX, publish: true }));
    expect(window.__splatRuntimeProfile).toBe(result.current);
    unmount();
    expect(window.__splatRuntimeProfile).toBeUndefined();
  });

  it("does not touch window when publishing is off", () => {
    renderHook(() => useSplatRuntimeProfile({ probe: () => RTX, publish: false }));
    expect(window.__splatRuntimeProfile).toBeUndefined();
  });
});
