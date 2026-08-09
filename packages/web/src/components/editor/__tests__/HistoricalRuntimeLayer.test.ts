import { describe, expect, it, vi } from "vitest";
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
