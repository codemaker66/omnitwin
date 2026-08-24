import { describe, expect, it, vi } from "vitest";
import { Matrix4 } from "three";
import {
  decodeHistoricalRuntimePackage,
  disposeHistoricalRuntimeResource,
  historicalRuntimePresentationCanAcknowledge,
  historicalRuntimeShouldRetainCacheWindow,
  historicalRuntimeTimelineBlendHasDistinctResources,
  historicalRuntimeTimelineBlendOpacities,
  type HistoricalRuntimeMesh,
} from "../HistoricalRuntimeLayer.js";
import { historicalRuntimeBindingFixture } from "../../../test-utils/historical-runtime-binding.js";
import {
  historicalRuntimeCapturedVisualKey,
  historicalRuntimeCrossfadeAllowed,
  historicalRuntimeResourceKey,
} from "../../../lib/historical-runtime-cache.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
  };
}

describe("decodeHistoricalRuntimePackage lifecycle", () => {
  it("submits direct ArrayBuffer bytes, stays invisible while initialized is pending, and disposes once after stale settlement", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const bytes = new ArrayBuffer(3);
    const initialized = deferred<HistoricalRuntimeMesh>();
    const dispose = vi.fn();
    const mesh: HistoricalRuntimeMesh = {
      visible: true,
      opacity: 1,
      matrixAutoUpdate: true,
      matrix: new Matrix4(),
      matrixWorldNeedsUpdate: false,
      initialized: initialized.promise,
      numSplats: 3,
      dispose,
    };
    const createMesh = vi.fn<(
      asset: { readonly bytes: ArrayBuffer },
      maxSplats: number,
    ) => HistoricalRuntimeMesh>(() => mesh);
    const controller = new AbortController();

    const decoding = decodeHistoricalRuntimePackage(
      binding,
      [{ member, bytes }],
      controller.signal,
      createMesh,
    );
    expect(createMesh).toHaveBeenCalledWith(
      expect.objectContaining({ bytes }),
      4_000_001,
    );
    expect(mesh.visible).toBe(false);
    expect(mesh.opacity).toBe(0);
    expect(dispose).not.toHaveBeenCalled();

    controller.abort();
    initialized.resolve(mesh);
    const resource = await decoding;
    expect(dispose).not.toHaveBeenCalled();
    disposeHistoricalRuntimeResource(resource);
    disposeHistoricalRuntimeResource(resource);
    expect(dispose).toHaveBeenCalledOnce();
    expect(mesh.visible).toBe(false);
    expect(mesh.opacity).toBe(0);
    expect(resource.splatCount).toBe(3);
  });

  it("requests remaining-budget-plus-one and disposes a synthetic over-budget decode", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const dispose = vi.fn();
    const initialized = deferred<HistoricalRuntimeMesh>();
    const mesh: HistoricalRuntimeMesh = {
      visible: true,
      opacity: 1,
      matrixAutoUpdate: true,
      matrix: new Matrix4(),
      matrixWorldNeedsUpdate: false,
      initialized: initialized.promise,
      numSplats: 3,
      dispose,
    };
    initialized.resolve(mesh);
    const createMesh = vi.fn<(
      asset: { readonly bytes: ArrayBuffer },
      maxSplats: number,
    ) => HistoricalRuntimeMesh>(() => mesh);

    await expect(decodeHistoricalRuntimePackage(
      binding,
      [{ member, bytes: new ArrayBuffer(3) }],
      new AbortController().signal,
      createMesh,
      2,
    )).rejects.toThrow("exceeds this viewer's splat budget");
    expect(createMesh).toHaveBeenCalledWith(expect.any(Object), 3);
    expect(dispose).toHaveBeenCalledOnce();
    expect(mesh.visible).toBe(false);
    expect(mesh.opacity).toBe(0);
  });
});

describe("historical runtime framebuffer acknowledgement", () => {
  it("acknowledges B after an A to B crossfade settles without requiring the keyed group ref again", () => {
    expect(historicalRuntimePresentationCanAcknowledge({
      candidateKey: null,
      attachedKey: "binding-B",
      groupAttached: true,
    })).toBe(false);
    expect(historicalRuntimePresentationCanAcknowledge({
      candidateKey: "binding-B",
      attachedKey: "binding-B",
      groupAttached: true,
    })).toBe(true);
  });
});

describe("timeline-owned historical runtime blend", () => {
  it("keeps a shared endpoint runtime as one fully opaque resource", () => {
    expect(historicalRuntimeTimelineBlendHasDistinctResources("runtime:a", "runtime:a")).toBe(false);
    expect(historicalRuntimeTimelineBlendHasDistinctResources("runtime:a", "runtime:b")).toBe(true);
    expect(historicalRuntimeTimelineBlendHasDistinctResources(null, "runtime:b")).toBe(false);
  });

  it("never crossfades distinct snapshots or package IDs with identical captured content", () => {
    const from = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const to = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: from.runtimePackageContentDigest,
      sizeBytes: 3,
    });
    const fromKey = historicalRuntimeResourceKey(from);
    const toKey = historicalRuntimeResourceKey(to);
    expect(from.bindingId).not.toBe(to.bindingId);
    expect(from.runtimePackageId).not.toBe(to.runtimePackageId);
    expect(toKey).toBe(fromKey);
    expect(historicalRuntimeTimelineBlendHasDistinctResources(fromKey, toKey)).toBe(false);

    const memberAlias = historicalRuntimeBindingFixture({
      bindingId: "13111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "24222222-2222-4222-8222-222222222222",
      runtimePackageId: "68666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: from.runtimePackageContentDigest,
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      fileName: "grand-hall-alias.sog",
      sizeBytes: 3,
    });
    expect(historicalRuntimeResourceKey(memberAlias)).not.toBe(fromKey);
    expect(historicalRuntimeCapturedVisualKey(memberAlias))
      .toBe(historicalRuntimeCapturedVisualKey(from));
    for (const [transitionFrom, transitionTo] of [
      [from, memberAlias],
      [memberAlias, from],
      [to, memberAlias],
    ] as const) {
      expect(historicalRuntimeCrossfadeAllowed({
        from: transitionFrom,
        to: transitionTo,
        sameEnvelope: true,
        reducedMotion: false,
        combinedByteBudget: 1_024,
        fromSplatCount: 1,
        toSplatCount: 1,
        combinedSplatBudget: 10,
      })).toBe(false);
    }
  });

  it("tracks the timeline progress exactly instead of starting an independent clock", () => {
    expect(historicalRuntimeTimelineBlendOpacities(0)).toEqual({ from: 1, to: 0 });
    expect(historicalRuntimeTimelineBlendOpacities(0.25)).toEqual({ from: 0.75, to: 0.25 });
    expect(historicalRuntimeTimelineBlendOpacities(0.5)).toEqual({ from: 0.5, to: 0.5 });
    expect(historicalRuntimeTimelineBlendOpacities(1)).toEqual({ from: 0, to: 1 });
  });

  it("clamps non-finite and out-of-range scrub input", () => {
    expect(historicalRuntimeTimelineBlendOpacities(Number.NaN)).toEqual({ from: 1, to: 0 });
    expect(historicalRuntimeTimelineBlendOpacities(-1)).toEqual({ from: 1, to: 0 });
    expect(historicalRuntimeTimelineBlendOpacities(2)).toEqual({ from: 0, to: 1 });
  });
});

describe("Day/Week historical runtime cache handoff", () => {
  it("retains only a pending null-frame range", () => {
    expect(historicalRuntimeShouldRetainCacheWindow({ previewMode: "unavailable", hasActiveFrame: false })).toBe(true);
    expect(historicalRuntimeShouldRetainCacheWindow({ previewMode: "unavailable", hasActiveFrame: true })).toBe(false);
    expect(historicalRuntimeShouldRetainCacheWindow({ previewMode: "schedule-gap", hasActiveFrame: false })).toBe(false);
    expect(historicalRuntimeShouldRetainCacheWindow({ previewMode: "inactive", hasActiveFrame: false })).toBe(false);
  });
});
