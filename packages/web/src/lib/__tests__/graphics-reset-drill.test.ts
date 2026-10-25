import { describe, expect, it, vi } from "vitest";
import { readGraphicsResetDrill, startGraphicsResetDrill } from "../graphics-reset-drill.js";

describe("the graphics reset drill", () => {
  it("reads seconds, and whether the browser hands the context back, from ?graphicsReset", () => {
    expect(readGraphicsResetDrill("?graphicsReset=8")).toEqual({ afterMs: 8_000, handBack: true });
    expect(readGraphicsResetDrill("?space=grand-hall&graphicsReset=2.5:never")).toEqual({ afterMs: 2_500, handBack: false });
    expect(readGraphicsResetDrill("?space=grand-hall")).toBeNull();
    expect(readGraphicsResetDrill("?graphicsReset=soon")).toBeNull();
    expect(readGraphicsResetDrill("?graphicsReset=-1")).toBeNull();
    expect(readGraphicsResetDrill("?graphicsReset=9999")).toBeNull();
  });

  it("destroys a WebGPU device once the view has drawn for the asked time", () => {
    vi.useFakeTimers();
    try {
      const device = { destroy: vi.fn() };
      startGraphicsResetDrill({}, { afterMs: 3_000, handBack: true }, { device, canvas: null });
      vi.advanceTimersByTime(2_999);
      expect(device.destroy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(device.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loses a WebGL context and hands it back a second later, unless asked never to", () => {
    vi.useFakeTimers();
    try {
      const extension = { loseContext: vi.fn(), restoreContext: vi.fn() };
      const canvas = { getContext: vi.fn(() => ({ getExtension: () => extension })) };
      startGraphicsResetDrill({}, { afterMs: 1_000, handBack: true }, { device: null, canvas });
      vi.advanceTimersByTime(1_000);
      expect(extension.loseContext).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1_000);
      expect(extension.restoreContext).toHaveBeenCalledOnce();

      const never = { loseContext: vi.fn(), restoreContext: vi.fn() };
      startGraphicsResetDrill({}, { afterMs: 1_000, handBack: false }, { device: null, canvas: { getContext: () => ({ getExtension: () => never }) } });
      vi.advanceTimersByTime(60_000);
      expect(never.loseContext).toHaveBeenCalledOnce();
      expect(never.restoreContext).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs once per view however many times that view is restored, and not at all once cancelled", () => {
    vi.useFakeTimers();
    try {
      const device = { destroy: vi.fn() };
      const owner = {};
      startGraphicsResetDrill(owner, { afterMs: 1_000, handBack: true }, { device, canvas: null });
      vi.advanceTimersByTime(1_000);
      startGraphicsResetDrill(owner, { afterMs: 1_000, handBack: true }, { device, canvas: null });
      vi.advanceTimersByTime(5_000);
      expect(device.destroy).toHaveBeenCalledOnce();

      const cancelled = { destroy: vi.fn() };
      const stop = startGraphicsResetDrill({}, { afterMs: 1_000, handBack: true }, { device: cancelled, canvas: null });
      stop();
      vi.advanceTimersByTime(5_000);
      expect(cancelled.destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
