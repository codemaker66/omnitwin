import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhaseLayoutRuntimeAvailableBinding } from "@omnitwin/types";
import type { VerifiedHistoricalRuntimeAsset } from "../../api/historical-runtime-assets.js";
import {
  HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
  HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
  HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
  HISTORICAL_RUNTIME_MAX_MEMBERS,
  HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
  HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS,
  HistoricalRuntimeCache,
  historicalRuntimeBindingKey,
  historicalRuntimeCombinedSplatsWithinBudget,
  historicalRuntimeCrossfadeAllowed,
  historicalRuntimeDecodedSplatsWithinViewerBudget,
  historicalRuntimeResourceCanRender,
  historicalRuntimeRemainingAdjacentSplatBudget,
  historicalRuntimeViewerCapacity,
} from "../historical-runtime-cache.js";
import { historicalRuntimeBindingFixture } from "../../test-utils/historical-runtime-binding.js";

interface TestResource {
  readonly id: string;
  visible: boolean;
  disposeCount: number;
}

function verifiedAsset(binding: PhaseLayoutRuntimeAvailableBinding): VerifiedHistoricalRuntimeAsset {
  const member = binding.visualAssets[0];
  if (member === undefined) throw new Error("Fixture member missing");
  return { member, bytes: new ArrayBuffer(Math.min(member.sizeBytes, 8)) };
}

function resource(id: string): TestResource {
  return { id, visible: false, disposeCount: 0 };
}

function cacheWith(params: {
  readonly fetchMember?: (
    binding: PhaseLayoutRuntimeAvailableBinding,
  ) => Promise<VerifiedHistoricalRuntimeAsset>;
  readonly decode?: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    signal: AbortSignal,
  ) => Promise<TestResource>;
}) {
  const fetchMember = vi.fn(async (binding: PhaseLayoutRuntimeAvailableBinding) =>
    params.fetchMember?.(binding) ?? verifiedAsset(binding));
  const decode = vi.fn(async (
    binding: PhaseLayoutRuntimeAvailableBinding,
    _assets: readonly VerifiedHistoricalRuntimeAsset[],
    signal: AbortSignal,
  ) => params.decode?.(binding, signal) ?? resource(binding.bindingId));
  const dispose = vi.fn((value: TestResource) => {
    value.visible = false;
    value.disposeCount += 1;
  });
  return {
    cache: new HistoricalRuntimeCache<TestResource>({ fetchMember, decode, dispose }),
    fetchMember,
    decode,
    dispose,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HistoricalRuntimeCache", () => {
  it("deduplicates one immutable binding fetch and decode", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const harness = cacheWith({});
    harness.cache.setWindow({ active: binding, adjacent: null, decodeAdjacent: false });
    harness.cache.setWindow({ active: binding, adjacent: null, decodeAdjacent: false });

    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(binding))?.status)
        .toBe("ready");
    });
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    harness.cache.clear();
  });

  it("fetches the selected package before its adjacent prefetch", async () => {
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const started: string[] = [];
    const finishFetch = new Map<string, () => void>();
    const harness = cacheWith({
      fetchMember: (binding) => new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
        started.push(binding.bindingId);
        finishFetch.set(binding.bindingId, () => { resolve(verifiedAsset(binding)); });
      }),
    });

    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => { expect(started).toEqual([active.bindingId]); });
    finishFetch.get(active.bindingId)?.();
    await vi.waitFor(() => {
      expect(started).toEqual([active.bindingId, adjacent.bindingId]);
    });
    finishFetch.get(adjacent.bindingId)?.();
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(active))?.status)
        .toBe("ready");
    });
    harness.cache.clear();
  });

  it("runs only one package decoder at a time", async () => {
    const first = historicalRuntimeBindingFixture({
      bindingId: "11111111-1111-4111-8111-111111111111",
      runtimePackageId: "66666666-6666-4666-8666-666666666666",
      sizeBytes: 1,
    });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const resolvers: Array<(value: TestResource) => void> = [];
    let activeDecoders = 0;
    let maxActiveDecoders = 0;
    const harness = cacheWith({
      decode: (binding) => new Promise<TestResource>((resolve) => {
        activeDecoders += 1;
        maxActiveDecoders = Math.max(maxActiveDecoders, activeDecoders);
        resolvers.push((value) => {
          activeDecoders -= 1;
          resolve(value);
        });
        void binding;
      }),
    });
    harness.cache.setWindow({ active: first, adjacent: second, decodeAdjacent: true });
    await vi.waitFor(() => { expect(resolvers).toHaveLength(1); });
    resolvers[0]?.(resource("first"));
    await vi.waitFor(() => { expect(resolvers).toHaveLength(2); });
    resolvers[1]?.(resource("second"));
    await vi.waitFor(() => { expect(harness.decode).toHaveBeenCalledTimes(2); });
    expect(maxActiveDecoders).toBe(1);
    harness.cache.clear();
  });

  it("bounds rapid A to B to C verification and drops aborted queued work before fetch", async () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const third = historicalRuntimeBindingFixture({
      bindingId: "13111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "24222222-2222-4222-8222-222222222222",
      runtimePackageId: "68666666-6666-4666-8666-666666666666",
      assetVersionId: "97999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const started: string[] = [];
    const verificationResolvers = new Map<string, () => void>();
    let inFlight = 0;
    let maxInFlight = 0;
    const harness = cacheWith({
      fetchMember: (binding) => new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
        started.push(binding.bindingId);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        verificationResolvers.set(binding.bindingId, () => {
          inFlight -= 1;
          resolve(verifiedAsset(binding));
        });
      }),
    });

    harness.cache.setWindow({ active: first, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => { expect(started).toEqual([first.bindingId]); });
    harness.cache.setWindow({ active: second, adjacent: null, decodeAdjacent: false });
    harness.cache.setWindow({ active: third, adjacent: null, decodeAdjacent: false });
    expect(started).toEqual([first.bindingId]);

    verificationResolvers.get(first.bindingId)?.();
    await vi.waitFor(() => { expect(started).toContain(third.bindingId); });
    expect(started).not.toContain(second.bindingId);
    verificationResolvers.get(third.bindingId)?.();
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(third))?.status)
        .toBe("ready");
    });
    expect(maxInFlight).toBe(1);
    harness.cache.clear();
  });

  it("keeps an aborted decoder's resource invisible, then disposes it exactly once after settlement", async () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const settleIgnoredAbort: { current: ((value: TestResource) => void) | null } = {
      current: null,
    };
    const staleResource = resource("stale");
    const harness = cacheWith({
      decode: (binding) => binding.bindingId === first.bindingId
        ? new Promise<TestResource>((resolve) => { settleIgnoredAbort.current = resolve; })
        : Promise.resolve(resource("second")),
    });
    harness.cache.setWindow({ active: first, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => { expect(settleIgnoredAbort.current).not.toBeNull(); });
    harness.cache.setWindow({ active: second, adjacent: null, decodeAdjacent: false });
    expect(staleResource.visible).toBe(false);
    const settle = settleIgnoredAbort.current;
    if (settle === null) throw new Error("Ignored-abort decoder did not start");
    settle(staleResource);
    await vi.waitFor(() => { expect(staleResource.disposeCount).toBe(1); });
    expect(harness.dispose).toHaveBeenCalledWith(staleResource);
    expect(harness.cache.getSnapshot().records.has(historicalRuntimeBindingKey(first))).toBe(false);
    harness.cache.clear();
    expect(staleResource.disposeCount).toBe(1);
  });

  it("recreates a failed binding generation and succeeds on explicit reselection", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    let attempt = 0;
    const harness = cacheWith({
      decode: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error("decode failed"));
        return Promise.resolve(resource("retry-ready"));
      },
    });
    harness.cache.setWindow({ active: binding, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(binding))?.status)
        .toBe("error");
    });
    harness.cache.setWindow({ active: binding, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(binding))?.status)
        .toBe("ready");
    });
    expect(harness.decode).toHaveBeenCalledTimes(2);
    expect(harness.fetchMember).toHaveBeenCalledTimes(2);
    harness.cache.clear();
  });

  it("does not fetch or decode an active package over the supported byte budget", async () => {
    const base = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const firstMember = base.visualAssets[0];
    if (firstMember === undefined) throw new Error("Fixture member missing");
    const oversized: PhaseLayoutRuntimeAvailableBinding = {
      ...base,
      visualAssets: [{
        ...firstMember,
        sizeBytes: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET + 1,
      }],
    };
    const harness = cacheWith({});
    harness.cache.setWindow({ active: oversized, adjacent: null, decodeAdjacent: false });
    await Promise.resolve();
    expect(harness.fetchMember).not.toHaveBeenCalled();
    expect(harness.decode).not.toHaveBeenCalled();
    expect(harness.cache.getSnapshot().records.size).toBe(0);
  });

  it("does not fetch a synthetic package with more than the hard member cap", async () => {
    const base = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const firstMember = base.visualAssets[0];
    if (firstMember === undefined) throw new Error("Fixture member missing");
    const tooManyMembers: PhaseLayoutRuntimeAvailableBinding = {
      ...base,
      visualAssets: Array.from({ length: HISTORICAL_RUNTIME_MAX_MEMBERS + 1 }, (_, index) => ({
        ...firstMember,
        memberIndex: index,
        fileName: `synthetic-${String(index)}.sog`,
      })),
    };
    const harness = cacheWith({});

    harness.cache.setWindow({ active: tooManyMembers, adjacent: null, decodeAdjacent: false });
    await Promise.resolve();

    expect(harness.fetchMember).not.toHaveBeenCalled();
    expect(harness.decode).not.toHaveBeenCalled();
    expect(harness.cache.getSnapshot().records.size).toBe(0);
  });

  it("does not fetch an adjacent package when its combined bytes exceed the budget", async () => {
    const active = historicalRuntimeBindingFixture({
      memberSizeBytes: Array.from({ length: 4 }, () => 15 * 1_024 * 1_024),
    });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      memberSizeBytes: [14 * 1_024 * 1_024, 13 * 1_024 * 1_024, 13 * 1_024 * 1_024],
    });
    const harness = cacheWith({});
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    await vi.waitFor(() => { expect(harness.decode).toHaveBeenCalledOnce(); });
    expect(harness.fetchMember).toHaveBeenCalledTimes(active.visualAssets.length);
    expect(harness.fetchMember.mock.calls.every(([binding]) =>
      binding.bindingId === active.bindingId,
    )).toBe(true);
    expect(harness.cache.getSnapshot().records.has(historicalRuntimeBindingKey(adjacent))).toBe(false);
    harness.cache.clear();
  });

  it("expires verified-only adjacent bytes instead of retaining them indefinitely", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const harness = cacheWith({});
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("verified");
    });
    await vi.advanceTimersByTimeAsync(HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS);
    expect(harness.cache.getSnapshot().records.has(historicalRuntimeBindingKey(adjacent))).toBe(false);
    harness.cache.clear();
  });

  it("does not expire an adjacent package while its scheduled decode is still running", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    let finishAdjacentDecode = (_value: TestResource): void => {
      throw new Error("Adjacent decode was not started");
    };
    const harness = cacheWith({
      decode: (binding) => binding.bindingId === active.bindingId
        ? Promise.resolve(resource("active"))
        : new Promise<TestResource>((resolve) => { finishAdjacentDecode = resolve; }),
    });

    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("verified");
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("decoding");
    });
    await vi.advanceTimersByTimeAsync(HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS + 1);
    expect(harness.cache.getSnapshot().records.has(historicalRuntimeBindingKey(adjacent))).toBe(true);
    finishAdjacentDecode(resource("adjacent"));
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("ready");
    });
    harness.cache.clear();
  });

  it("does not expire an adjacent package while its decode waits behind the active package", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    let adjacentFetchStarted = false;
    let finishAdjacentFetch = (): void => {
      throw new Error("Adjacent fetch was not started");
    };
    let finishActiveDecode = (_value: TestResource): void => {
      throw new Error("Active decode was not started");
    };
    const harness = cacheWith({
      fetchMember: (binding) => {
        if (binding.bindingId === active.bindingId) {
          return Promise.resolve(verifiedAsset(binding));
        }
        adjacentFetchStarted = true;
        return new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
          finishAdjacentFetch = () => { resolve(verifiedAsset(binding)); };
        });
      },
      decode: (binding) => binding.bindingId === active.bindingId
        ? new Promise<TestResource>((resolve) => { finishActiveDecode = resolve; })
        : Promise.resolve(resource("adjacent")),
    });

    harness.cache.setWindow({ active, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.decode).toHaveBeenCalledOnce();
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(adjacentFetchStarted).toBe(true);
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    finishAdjacentFetch();
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("verified");
    });

    await vi.advanceTimersByTimeAsync(HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS + 1);
    expect(harness.cache.getSnapshot().records.has(historicalRuntimeBindingKey(adjacent))).toBe(true);
    expect(harness.decode).toHaveBeenCalledOnce();

    finishActiveDecode(resource("active"));
    await vi.waitFor(() => {
      expect(harness.cache.getSnapshot().records.get(historicalRuntimeBindingKey(adjacent))?.status)
        .toBe("ready");
    });
    expect(harness.decode).toHaveBeenCalledTimes(2);
    harness.cache.clear();
  });
});

describe("historicalRuntimeCrossfadeAllowed", () => {
  it("requires the same room, envelope, exact transform, budget, and motion permission", () => {
    const from = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const to = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const base = {
      from,
      to,
      sameEnvelope: true,
      reducedMotion: false,
      combinedByteBudget: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
      fromSplatCount: 1_000_000,
      toSplatCount: 1_000_000,
      combinedSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    };
    expect(historicalRuntimeCrossfadeAllowed(base)).toBe(true);
    expect(historicalRuntimeCrossfadeAllowed({ ...base, sameEnvelope: false })).toBe(false);
    expect(historicalRuntimeCrossfadeAllowed({ ...base, reducedMotion: true })).toBe(false);
    expect(historicalRuntimeCrossfadeAllowed({ ...base, combinedByteBudget: 1 })).toBe(false);
    expect(historicalRuntimeCrossfadeAllowed({
      ...base,
      toSplatCount: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    })).toBe(false);
    expect(historicalRuntimeCrossfadeAllowed({
      ...base,
      to: { ...to, transformArtifactDigest: "0".repeat(64) },
    })).toBe(false);
  });
});

describe("historical runtime synthetic viewer capacity policy", () => {
  it("disables adjacency and lowers active budgets on low-memory and mobile viewers", () => {
    expect(historicalRuntimeViewerCapacity({ deviceMemoryGb: 4, mobile: false })).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      allowAdjacent: false,
    });
    expect(historicalRuntimeViewerCapacity({ deviceMemoryGb: 16, mobile: true })).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      allowAdjacent: false,
    });
    expect(historicalRuntimeViewerCapacity({ deviceMemoryGb: 16, mobile: false })).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      allowAdjacent: true,
    });
  });

  it("fails closed when a decoded desktop resource exceeds a later mobile policy", () => {
    expect(historicalRuntimeDecodedSplatsWithinViewerBudget(
      2_000_000,
      HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    )).toBe(true);
    expect(historicalRuntimeDecodedSplatsWithinViewerBudget(
      2_000_000,
      HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
    )).toBe(false);
  });

  it("keeps adjacent decode within the combined resident cap", () => {
    expect(historicalRuntimeRemainingAdjacentSplatBudget({
      activeSplatCount: undefined,
      viewerSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      combinedResidentSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    })).toBe(0);
    expect(historicalRuntimeRemainingAdjacentSplatBudget({
      activeSplatCount: 3_500_000,
      viewerSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      combinedResidentSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    })).toBe(500_000);
    expect(historicalRuntimeCombinedSplatsWithinBudget(
      3_500_000,
      500_000,
      HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    )).toBe(true);
    expect(historicalRuntimeCombinedSplatsWithinBudget(
      3_500_000,
      500_001,
      HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    )).toBe(false);
  });
});

describe("historicalRuntimeResourceCanRender", () => {
  it("synchronously rejects A-ready when B is selected but still loading or unavailable", () => {
    const resourceA = resource("A");
    expect(historicalRuntimeResourceCanRender({
      displayKey: "binding-A",
      activeKey: "binding-A",
      activeStatus: "ready",
      displayedResource: resourceA,
      activeResource: resourceA,
    })).toBe(true);
    expect(historicalRuntimeResourceCanRender({
      displayKey: "binding-A",
      activeKey: "binding-B",
      activeStatus: "fetching",
      displayedResource: resourceA,
      activeResource: null,
    })).toBe(false);
    expect(historicalRuntimeResourceCanRender({
      displayKey: "binding-A",
      activeKey: null,
      activeStatus: null,
      displayedResource: resourceA,
      activeResource: null,
    })).toBe(false);
  });
});
