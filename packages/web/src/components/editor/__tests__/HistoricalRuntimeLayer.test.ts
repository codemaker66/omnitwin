import { afterEach, describe, expect, it, vi } from "vitest";
import { Matrix4 } from "three";
import {
  decodeHistoricalRuntimePackage,
  disposeHistoricalRuntimeResource,
  historicalRuntimePresentationCanAcknowledge,
  historicalRuntimeTimelineBlendHasDistinctResources,
  historicalRuntimeTimelineBlendOpacities,
  type HistoricalRuntimeMesh,
} from "../HistoricalRuntimeLayer.js";
import { historicalRuntimeBindingFixture } from "../../../test-utils/historical-runtime-binding.js";
import {
  HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE,
  HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("decodeHistoricalRuntimePackage lifecycle", () => {
  it("submits direct ArrayBuffer bytes, stays invisible while initialized is pending, and aborts with immediate disposal", async () => {
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

    const rejected = expect(decoding).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    initialized.resolve(mesh);
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mesh.visible).toBe(false);
    expect(mesh.opacity).toBe(0);
  });

  it("bounds a never-settling Spark initialization and disposes its mesh", async () => {
    vi.useFakeTimers();
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const dispose = vi.fn();
    const mesh: HistoricalRuntimeMesh = {
      visible: true,
      opacity: 1,
      matrixAutoUpdate: true,
      matrix: new Matrix4(),
      matrixWorldNeedsUpdate: false,
      initialized: new Promise<HistoricalRuntimeMesh>(() => undefined),
      numSplats: 3,
      dispose,
    };
    const decoding = decodeHistoricalRuntimePackage(
      binding,
      [{ member, bytes: new ArrayBuffer(3) }],
      new AbortController().signal,
      () => mesh,
      4_000_000,
      25,
    );
    const rejected = expect(decoding).rejects.toThrow(
      HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE,
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    expect(mesh.visible).toBe(false);
    expect(mesh.opacity).toBe(0);
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

  it("attempts every unique mesh once and sanitizes a throwing disposal", () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const firstDispose = vi.fn(() => {
      throw new Error("C:\\private\\capture.sog?token=raw-secret");
    });
    const secondDispose = vi.fn();
    const first: HistoricalRuntimeMesh = {
      visible: true,
      opacity: 1,
      matrixAutoUpdate: true,
      matrix: new Matrix4(),
      matrixWorldNeedsUpdate: false,
      initialized: new Promise<HistoricalRuntimeMesh>(() => undefined),
      numSplats: 1,
      dispose: firstDispose,
    };
    const second: HistoricalRuntimeMesh = {
      ...first,
      matrix: new Matrix4(),
      dispose: secondDispose,
    };
    const resource = {
      binding,
      meshes: [first, first, second],
      splatCount: 2,
      disposed: false,
    };
    const quarantine = vi.fn();

    let surfaced: Error | null = null;
    try {
      disposeHistoricalRuntimeResource(resource, quarantine);
    } catch (error: unknown) {
      surfaced = error instanceof Error ? error : null;
    }
    expect(surfaced?.message).toBe(HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE);
    expect(surfaced?.message).not.toContain("raw-secret");
    expect(quarantine).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
    expect(resource.disposed).toBe(true);

    expect(() => { disposeHistoricalRuntimeResource(resource, quarantine); }).not.toThrow();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
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

  it("treats package aliases of identical scoped bytes as one endpoint in both directions", () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const alias = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      sizeBytes: 1,
    });
    const firstKey = historicalRuntimeResourceKey(first);
    const aliasKey = historicalRuntimeResourceKey(alias);

    expect(firstKey).toBe(aliasKey);
    expect(historicalRuntimeTimelineBlendHasDistinctResources(firstKey, aliasKey)).toBe(false);
    expect(historicalRuntimeTimelineBlendHasDistinctResources(aliasKey, firstKey)).toBe(false);
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
