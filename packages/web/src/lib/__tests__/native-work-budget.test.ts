import { afterEach, describe, expect, it, vi } from "vitest";
import { browserNativeWorkBudget, nativeWorkBudget } from "../native-work-budget.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("native scheduling capabilities", () => {
  it.each([
    { logicalCores: 8, memoryGiB: 2 },
    { logicalCores: 8, memoryGiB: 4 },
    { logicalCores: 2, memoryGiB: 8 },
    { logicalCores: 4, memoryGiB: 8 },
    { logicalCores: 4 },
  ])("bounds decode allocations on constrained capabilities: %j", (capabilities) => {
    expect(nativeWorkBudget(capabilities).decodeWorkers).toBe(1);
  });

  it.each([
    {}, { logicalCores: 8 }, { logicalCores: 16, memoryGiB: 8 },
    { logicalCores: NaN, memoryGiB: Infinity },
    { logicalCores: 0, memoryGiB: -1 },
  ])("retains bounded established concurrency for unknown/roomy capabilities: %j", (capabilities) => {
    expect(nativeWorkBudget(capabilities)).toEqual({ decodeWorkers: 2, reason: "balanced" });
  });

  it("contains only scheduling decisions, independent of graphics quality tiers", () => {
    expect(nativeWorkBudget({ logicalCores: 16, memoryGiB: 4 })).toEqual({ decodeWorkers: 1, reason: "limited-memory" });
    expect(nativeWorkBudget({ logicalCores: 2 })).toEqual({ decodeWorkers: 1, reason: "limited-cpu" });
  });

  it.each([undefined, NaN, Infinity, 0, -1])("bounds overlapping allocations for explicit touch input with unknown memory %s", (memoryGiB) => {
    expect(nativeWorkBudget({
      logicalCores: 6, ...(memoryGiB === undefined ? {} : { memoryGiB }),
      primaryCoarsePointer: true, primaryHover: false,
    })).toEqual({ decodeWorkers: 1, reason: "touch-memory-unknown" });
  });

  it.each([
    { logicalCores: 6, memoryGiB: 8, primaryCoarsePointer: true, primaryHover: false },
    { logicalCores: 6, primaryCoarsePointer: false, primaryHover: false },
    { logicalCores: 6, primaryCoarsePointer: true, primaryHover: true },
    { logicalCores: 6, primaryCoarsePointer: true },
    { logicalCores: 6, primaryHover: false },
    { logicalCores: 8, primaryCoarsePointer: true, primaryHover: false },
    { logicalCores: 5.5, primaryCoarsePointer: true, primaryHover: false },
    { logicalCores: NaN, primaryCoarsePointer: true, primaryHover: false },
  ])("does not infer a constrained phone from incomplete or inapplicable hints: %j", (capabilities) => {
    expect(nativeWorkBudget(capabilities)).toEqual({ decodeWorkers: 2, reason: "balanced" });
  });

  it("reads explicit coarse/no-hover browser capabilities without a user-agent model guess", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" || query === "(hover: none)" }));
    expect(browserNativeWorkBudget()).toEqual({ decodeWorkers: 1, reason: "touch-memory-unknown" });
  });

  it.each([undefined, () => ({ matches: false }), () => { throw new Error("Unavailable"); }])("retains two workers when media-query support is absent or unknown", (matchMedia) => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(browserNativeWorkBudget()).toEqual({ decodeWorkers: 2, reason: "balanced" });
  });

  it("does not query touch input when valid memory already selects the budget", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("navigator", { hardwareConcurrency: 6, deviceMemory: 8 });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(browserNativeWorkBudget()).toEqual({ decodeWorkers: 2, reason: "balanced" });
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
