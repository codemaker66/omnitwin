// The effective tier: min(GPU class, phone cap). An "Apple GPU" phone at
// 390x844 with a coarse pointer runs medium; a desktop with a fine pointer
// keeps high. The hook feeds the pure function from the device store and the
// window, once per mount.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyDevice, getQualitySettings } from "../../../../lib/device-tier.js";
import { useDeviceStore } from "../../../../stores/device-store.js";
import type { StageTierInput } from "../run-types.js";
import {
  effectiveTier,
  minTier,
  PHONE_CAP_MAX_MEMORY_GB,
  PHONE_CAP_MAX_WIDTH_PX,
  phoneCap,
  readStageTierInput,
  useEffectiveTier,
  useStageStore,
  type StageWindow,
} from "../stage-store.js";

const APPLE_GPU = "Apple GPU";
const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)";

function phoneWindow(innerWidth = 390): StageWindow {
  return { innerWidth, matchMedia: (query) => ({ matches: query === "(pointer: coarse)" }) };
}

function desktopWindow(innerWidth = 1920): StageWindow {
  return { innerWidth, matchMedia: (query) => ({ matches: query === "(pointer: fine)" }) };
}

function input(overrides: Partial<StageTierInput>): StageTierInput {
  return {
    classifiedTier: "high",
    coarsePointer: false,
    innerWidth: 1920,
    maxTouchPoints: 0,
    deviceMemoryGb: 16,
    ...overrides,
  };
}

function resetStores(): void {
  useDeviceStore.setState({ tier: "low", quality: getQualitySettings("low"), gpuRenderer: null, detected: false });
  useStageStore.setState({ sceneIndex: 0, effectiveTier: "low", tierResolved: false });
}

describe("effectiveTier (pure)", () => {
  it("an Apple GPU phone at 390x844 with a coarse pointer resolves to medium", () => {
    expect(classifyDevice(APPLE_GPU)).toBe("high");
    const facts = readStageTierInput(classifyDevice(APPLE_GPU), phoneWindow(390), { maxTouchPoints: 5 });
    expect(facts).toEqual({ classifiedTier: "high", coarsePointer: true, innerWidth: 390, maxTouchPoints: 5, deviceMemoryGb: null });
    expect(effectiveTier(facts)).toBe("medium");
  });

  it("a desktop with a fine pointer keeps high", () => {
    const facts = readStageTierInput(classifyDevice(RTX), desktopWindow(1920), { maxTouchPoints: 0, deviceMemory: 32 });
    expect(facts.coarsePointer).toBe(false);
    expect(effectiveTier(facts)).toBe("high");
  });

  it("a touchscreen laptop with real memory and a fine pointer keeps high", () => {
    expect(effectiveTier(input({ maxTouchPoints: 10, deviceMemoryGb: 8, innerWidth: 1280 }))).toBe("high");
  });

  it("a wide coarse-pointer tablet with small memory is capped; without a memory report it is not", () => {
    expect(effectiveTier(input({ coarsePointer: true, innerWidth: 1024, maxTouchPoints: 5, deviceMemoryGb: PHONE_CAP_MAX_MEMORY_GB }))).toBe("medium");
    expect(effectiveTier(input({ coarsePointer: true, innerWidth: 1024, maxTouchPoints: 5, deviceMemoryGb: null }))).toBe("high");
    expect(effectiveTier(input({ coarsePointer: true, innerWidth: 1024, maxTouchPoints: 5, deviceMemoryGb: 8 }))).toBe("high");
  });

  it("the width rule is strict at 980 and needs the coarse pointer", () => {
    expect(effectiveTier(input({ coarsePointer: true, innerWidth: PHONE_CAP_MAX_WIDTH_PX - 1 }))).toBe("medium");
    expect(effectiveTier(input({ coarsePointer: true, innerWidth: PHONE_CAP_MAX_WIDTH_PX }))).toBe("high");
    expect(effectiveTier(input({ coarsePointer: false, innerWidth: 390 }))).toBe("high");
  });

  it("is a minimum: a low or poster class stays where it is under the cap", () => {
    expect(effectiveTier(input({ classifiedTier: "low", coarsePointer: true, innerWidth: 390 }))).toBe("low");
    expect(effectiveTier(input({ classifiedTier: "poster", coarsePointer: true, innerWidth: 390 }))).toBe("poster");
    expect(effectiveTier(input({ classifiedTier: "medium", coarsePointer: true, innerWidth: 390 }))).toBe("medium");
    expect(minTier("high", "medium")).toBe("medium");
    expect(minTier("poster", "high")).toBe("poster");
    expect(phoneCap({ coarsePointer: false, innerWidth: 390, maxTouchPoints: 0, deviceMemoryGb: 2 })).toBeNull();
  });

  it("readStageTierInput copes with a window that has no matchMedia", () => {
    const facts = readStageTierInput("high", { innerWidth: 800 }, { maxTouchPoints: 0 });
    expect(facts.coarsePointer).toBe(false);
    expect(facts.deviceMemoryGb).toBeNull();
  });
});

describe("useEffectiveTier (hook)", () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("probes once on the first render, caps the phone, and records the tier in both stores", () => {
    const probe = vi.fn(() => APPLE_GPU);
    const { result } = renderHook(() =>
      useEffectiveTier({ probe, win: phoneWindow(390), nav: { maxTouchPoints: 5 } }),
    );
    expect(result.current).toBe("medium");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(useDeviceStore.getState().detected).toBe(true);
    expect(useDeviceStore.getState().tier).toBe("high");
    expect(useStageStore.getState().effectiveTier).toBe("medium");
    expect(useStageStore.getState().tierResolved).toBe(true);
  });

  it("a desktop with a fine pointer keeps high", () => {
    const { result } = renderHook(() =>
      useEffectiveTier({ probe: () => RTX, win: desktopWindow(1920), nav: { maxTouchPoints: 0, deviceMemory: 32 } }),
    );
    expect(result.current).toBe("high");
    expect(useStageStore.getState().effectiveTier).toBe("high");
  });

  it("trusts a device store that has already detected and never probes", () => {
    useDeviceStore.getState().override("medium");
    const probe = vi.fn(() => RTX);
    const { result } = renderHook(() =>
      useEffectiveTier({ probe, win: desktopWindow(1920), nav: { maxTouchPoints: 0 } }),
    );
    expect(probe).not.toHaveBeenCalled();
    expect(result.current).toBe("medium");
  });

  it("with no window or navigator the GPU class stands alone", () => {
    const { result } = renderHook(() => useEffectiveTier({ probe: () => APPLE_GPU, win: null, nav: null }));
    expect(result.current).toBe("high");
  });

  it("a probe that finds no WebGL leaves the store's tier in charge", () => {
    const { result } = renderHook(() => useEffectiveTier({ probe: () => null, win: desktopWindow(), nav: { maxTouchPoints: 0 } }));
    expect(result.current).toBe("low");
    expect(useDeviceStore.getState().detected).toBe(false);
  });
});
