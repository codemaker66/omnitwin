import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeviceStore } from "../../../../stores/device-store.js";
import { useArrivalStore } from "../arrival-store.js";
import { useArrivalGate } from "../use-arrival-gate.js";

// -----------------------------------------------------------------------------
// useArrivalGate (Task 12) — the single check ArrivalHero consults BEFORE the
// Canvas ever mounts. Two independent facts can block it (device tier, API
// key presence); a third preference (reduced motion) is explicitly NOT a
// block — spec §2 wants a reduced-motion visitor to still see the Hall, just
// without the flight, so this hook's only obligation there is flipping the
// arrival store's `reducedMotion` flag before GoogleTilesStage could possibly
// reach tilesReady() and read it.
//
// device-store.ts defaults to tier "low" until detection runs (see that
// file's own header), so "low" is used here as the stand-in "healthy,
// undetected" baseline — device-store.test.ts:50 establishes override("poster")
// as this repo's way of simulating a poster-tier device in tests.
// -----------------------------------------------------------------------------

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  }));
}

beforeEach(() => {
  useDeviceStore.getState().override("low");
  useArrivalStore.getState().reset();
  stubReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("useArrivalGate — blocking", () => {
  it("blocks with 'poster-tier' when the device is poster-tier, even with a valid key", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    useDeviceStore.getState().override("poster");
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBe("poster-tier");
  });

  it("blocks with 'no-key' when no API key is configured on a healthy device", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    useDeviceStore.getState().override("medium");
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBe("no-key");
  });

  it("is healthy (blocked: null) with a valid key on a non-poster tier", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    useDeviceStore.getState().override("high");
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBeNull();
  });

  it("prioritises poster-tier over a missing key when both apply", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", undefined);
    useDeviceStore.getState().override("poster");
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBe("poster-tier");
  });
});

describe("useArrivalGate — reduced motion is a flag, not a block (spec §2)", () => {
  it("stays healthy (blocked: null) under reduced motion", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubReducedMotion(true);
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBeNull();
  });

  it("sets the arrival store's reducedMotion flag when the OS prefers it", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubReducedMotion(true);
    renderHook(() => useArrivalGate());
    expect(useArrivalStore.getState().reducedMotion).toBe(true);
  });

  it("leaves reducedMotion false when the OS preference is off (contrast case)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubReducedMotion(false);
    renderHook(() => useArrivalGate());
    expect(useArrivalStore.getState().reducedMotion).toBe(false);
  });

  it("sets reducedMotion exactly once, not on every re-render", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubReducedMotion(true);
    const original = useArrivalStore.getState().setReducedMotion;
    const spy = vi.fn(original);
    useArrivalStore.setState({ setReducedMotion: spy });
    try {
      const { rerender } = renderHook(() => useArrivalGate());
      rerender();
      rerender();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      useArrivalStore.setState({ setReducedMotion: original });
    }
  });

  it("still reports 'poster-tier' when a poster-tier device also prefers reduced motion", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "AIza-test");
    stubReducedMotion(true);
    useDeviceStore.getState().override("poster");
    const { result } = renderHook(() => useArrivalGate());
    expect(result.current.blocked).toBe("poster-tier");
    // The flag is still set — reduced motion is orthogonal to the gate itself.
    expect(useArrivalStore.getState().reducedMotion).toBe(true);
  });
});
