import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import {
  __resetEquirectRegistryForTests,
  resolveEquirectMaxLod,
  useEquirectTexture,
  type EquirectMaxLod,
} from "../useEquirectTexture.js";

// -----------------------------------------------------------------------------
// useEquirectTexture — unit tests with the same manually-triggered Image mock
// as useCubeTiles.test.ts (happy-dom never loads real images). Pins the
// streaming order (512 preview → 4096 base → 8192 zoom tier when allowed),
// the maxLod ceiling (8192 is NEVER requested at the default), the
// upgrade-in-place rule (raising maxLod keeps the live texture on stage),
// the sampling setup the equirect shader depends on (sRGB, RepeatWrapping u,
// mipless linear filtering), and disposal on LOD swap, node change and
// unmount. The capability × zoom-intent gate is a pure-function table test.
// -----------------------------------------------------------------------------

/** Stand-in for the browser Image: records instances, loads only on demand. */
class MockImage {
  static instances: MockImage[] = [];
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    MockImage.instances.push(this);
  }
}

const BASE = "/twin/trades-hall";

function imagesFor(lod: 512 | 4096 | 8192): MockImage[] {
  return MockImage.instances.filter((image) =>
    image.src.endsWith(`equirect_${String(lod)}.webp`),
  );
}

/** Fire onload for every pending image of one LOD and flush the microtasks. */
async function completeLod(lod: 512 | 4096 | 8192): Promise<void> {
  await act(async () => {
    for (const image of imagesFor(lod)) {
      image.onload?.();
    }
    await Promise.resolve();
  });
}

describe("useEquirectTexture", () => {
  beforeEach(() => {
    // Textures are shared module state by design (the registry) — cold-start
    // every test so fetch-order assertions see their own loads.
    __resetEquirectRegistryForTests();
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
    // happy-dom ships fetch/createImageBitmap; pin them off so the suite
    // exercises the classic Image path its mock was built around. The
    // bitmap fast path gets its own dedicated test below.
    vi.stubGlobal("createImageBitmap", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prefers the off-thread bitmap path when the platform provides it", async () => {
    const previewBitmap = { width: 512, height: 256, close: vi.fn() };
    const baseBitmap = { width: 4096, height: 2048, close: vi.fn() };
    const bitmaps = [
      previewBitmap,
      baseBitmap,
    ];
    const blob = new Blob(["x"]);
    vi.stubGlobal("createImageBitmap", vi.fn().mockImplementation(() =>
      Promise.resolve(bitmaps.shift()),
    ));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }),
    );

    const { result, unmount } = renderHook(() => useEquirectTexture("scan_000", BASE));
    await waitFor(() => {
      expect(result.current.lod).toBe(4096);
    });

    // Decode ran through fetch → createImageBitmap; the Image mock was never
    // touched, and the pre-flipped bitmap disables three's upload flip.
    expect(MockImage.instances).toHaveLength(0);
    expect(result.current.texture?.flipY).toBe(false);
    expect(result.current.texture?.colorSpace).toBe(SRGBColorSpace);
    // Preview ImageBitmap closed on the 4096 swap; the live bitmap closes on
    // final release as well as Three's GPU texture.
    expect(previewBitmap.close).toHaveBeenCalledTimes(1);
    expect(baseBitmap.close).not.toHaveBeenCalled();
    unmount();
    expect(bitmaps).toHaveLength(0);
    expect(baseBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight bitmap fetch on unmount without falling back to Image", async () => {
    let requestedSignal: AbortSignal | undefined;
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }));

    const { unmount } = renderHook(() => useEquirectTexture("scan_abort", BASE));
    await waitFor(() => { expect(requestedSignal).toBeDefined(); });
    unmount();

    await waitFor(() => { expect(requestedSignal?.aborted).toBe(true); });
    await act(async () => { await Promise.resolve(); });
    expect(MockImage.instances).toHaveLength(0);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent consumers and closes shared bitmaps only after final release", async () => {
    const previewBitmap = { width: 512, height: 256, close: vi.fn() };
    const baseBitmap = { width: 4096, height: 2048, close: vi.fn() };
    const bitmaps = [previewBitmap, baseBitmap];
    const blob = new Blob(["x"]);
    vi.stubGlobal("createImageBitmap", vi.fn().mockImplementation(() =>
      Promise.resolve(bitmaps.shift()),
    ));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => ({
      first: useEquirectTexture("scan_shared", BASE),
      second: useEquirectTexture("scan_shared", BASE),
    }));
    await waitFor(() => {
      expect(result.current.first.lod).toBe(4096);
      expect(result.current.second.lod).toBe(4096);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // one request per LOD, not per hook
    expect(result.current.first.texture).toBe(result.current.second.texture);
    expect(previewBitmap.close).toHaveBeenCalledTimes(1);
    expect(baseBitmap.close).not.toHaveBeenCalled();

    unmount();
    expect(baseBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("streams the 512 preview first, then swaps to the 4096 base — and never requests 8192 at the default maxLod", async () => {
    const { result } = renderHook(() => useEquirectTexture("scan_000", BASE));

    // Exactly the preview loads first — anonymous CORS, correct pano URL.
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0]?.src).toBe(`${BASE}/tiles/scan_000/equirect_512.webp`);
    expect(MockImage.instances[0]?.crossOrigin).toBe("anonymous");
    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);

    await completeLod(512);
    await waitFor(() => {
      expect(result.current.lod).toBe(512);
    });
    const preview = result.current.texture;
    expect(preview).toBeInstanceOf(Texture);

    // Sampling setup the equirect shader depends on.
    expect(preview?.colorSpace).toBe(SRGBColorSpace);
    expect(preview?.wrapS).toBe(RepeatWrapping);
    expect(preview?.minFilter).toBe(LinearFilter);
    expect(preview?.magFilter).toBe(LinearFilter);
    expect(preview?.generateMipmaps).toBe(false);

    // Only after the preview is live does the base pano start.
    expect(MockImage.instances).toHaveLength(2);
    expect(MockImage.instances[1]?.src).toBe(`${BASE}/tiles/scan_000/equirect_4096.webp`);

    await completeLod(4096);
    await waitFor(() => {
      expect(result.current.lod).toBe(4096);
    });
    expect(result.current.texture).not.toBe(preview);

    // The ladder stops at the 4096 ceiling: no 8192 request ever went out.
    expect(MockImage.instances).toHaveLength(2);
    expect(imagesFor(8192)).toHaveLength(0);
  });

  it("streams 512 → 4096 → 8192 in order under maxLod 8192", async () => {
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { result } = renderHook(() => useEquirectTexture("scan_000", BASE, 8192));

    await completeLod(512);
    await waitFor(() => {
      expect(result.current.lod).toBe(512);
    });

    await completeLod(4096);
    await waitFor(() => {
      expect(result.current.lod).toBe(4096);
    });
    const basePano = result.current.texture;

    // The zoom tier follows ONLY after the base has landed.
    expect(MockImage.instances).toHaveLength(3);
    expect(MockImage.instances[2]?.src).toBe(`${BASE}/tiles/scan_000/equirect_8192.webp`);

    await completeLod(8192);
    await waitFor(() => {
      expect(result.current.lod).toBe(8192);
    });
    expect(result.current.texture).not.toBe(basePano);
    // Both superseded textures (512, then 4096) were released on swap.
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("keeps the live 4096 on stage when maxLod rises mid-node, then swaps to 8192", async () => {
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { result, rerender } = renderHook(
      ({ maxLod }: { maxLod: EquirectMaxLod }) =>
        useEquirectTexture("scan_000", BASE, maxLod),
      { initialProps: { maxLod: 4096 as EquirectMaxLod } },
    );

    await completeLod(512);
    await completeLod(4096);
    await waitFor(() => {
      expect(result.current.lod).toBe(4096);
    });
    const basePano = result.current.texture;
    expect(MockImage.instances).toHaveLength(2);

    // Zoom intent arrives: the upgrade must NOT reset the stream — the base
    // stays live (no blur-down) and exactly one new request goes out.
    rerender({ maxLod: 8192 });
    expect(result.current.lod).toBe(4096);
    expect(result.current.texture).toBe(basePano);
    expect(dispose).toHaveBeenCalledTimes(1); // only the 512 → 4096 swap
    await waitFor(() => {
      expect(MockImage.instances).toHaveLength(3);
    });
    expect(MockImage.instances[2]?.src).toBe(`${BASE}/tiles/scan_000/equirect_8192.webp`);

    await completeLod(8192);
    await waitFor(() => {
      expect(result.current.lod).toBe(8192);
    });
    expect(result.current.texture).not.toBe(basePano);
    expect(dispose).toHaveBeenCalledTimes(2); // the 4096 released on swap
  });

  it("disposes the previous texture when the node changes and restarts at 512", async () => {
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { result, rerender } = renderHook(
      ({ nodeId }) => useEquirectTexture(nodeId, BASE),
      { initialProps: { nodeId: "scan_000" } },
    );

    await completeLod(512);
    await waitFor(() => {
      expect(result.current.lod).toBe(512);
    });
    expect(dispose).not.toHaveBeenCalled();

    await completeLod(4096);
    await waitFor(() => {
      expect(result.current.lod).toBe(4096);
    });
    // The preview texture is released the moment the full swap lands.
    expect(dispose).toHaveBeenCalledTimes(1);

    rerender({ nodeId: "scan_001" });
    // Node change releases the live full texture and resets the state.
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);

    const fresh = MockImage.instances.slice(2);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.src).toBe(`${BASE}/tiles/scan_001/equirect_512.webp`);
  });

  it("disposes the live texture on unmount", async () => {
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { result, unmount } = renderHook(() => useEquirectTexture("scan_002", BASE));

    await completeLod(512);
    await waitFor(() => {
      expect(result.current.lod).toBe(512);
    });
    expect(dispose).not.toHaveBeenCalled();

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("stays inert when image callbacks never fire (happy-dom guard)", () => {
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { result, unmount } = renderHook(() => useEquirectTexture("scan_003", BASE));

    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);
    expect(() => {
      unmount();
    }).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("resolveEquirectMaxLod", () => {
  it("grants 8192 only when zoom intent AND texture capability meet", () => {
    // capability × intent table — the device row must dominate.
    expect(resolveEquirectMaxLod(16384, true)).toBe(8192);
    expect(resolveEquirectMaxLod(8192, true)).toBe(8192);
    expect(resolveEquirectMaxLod(8192, false)).toBe(4096);
    expect(resolveEquirectMaxLod(4096, true)).toBe(4096); // GPU can't take it
    expect(resolveEquirectMaxLod(4096, false)).toBe(4096);
    expect(resolveEquirectMaxLod(2048, true)).toBe(4096);
  });

  it("withholds 8192 from a device that cannot afford the 134 MB (finding [32])", () => {
    // Capable GPU + zoom intent, but the device gate denies it.
    expect(resolveEquirectMaxLod(16384, true, false)).toBe(4096);
    expect(resolveEquirectMaxLod(16384, true, true)).toBe(8192);
    // The default keeps the two-arg capability × intent contract intact.
    expect(resolveEquirectMaxLod(16384, true)).toBe(8192);
  });
});
