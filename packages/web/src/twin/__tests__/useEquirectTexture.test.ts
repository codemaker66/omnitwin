import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import { useEquirectTexture } from "../useEquirectTexture.js";

// -----------------------------------------------------------------------------
// useEquirectTexture — unit tests with the same manually-triggered Image mock
// as useCubeTiles.test.ts (happy-dom never loads real images). Pins the
// streaming order (512 preview before 2048 full), the sampling setup the
// equirect shader depends on (sRGB, RepeatWrapping u, mipless linear
// filtering), and disposal on LOD swap, node change and unmount.
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

function imagesFor(lod: 512 | 2048): MockImage[] {
  return MockImage.instances.filter((image) =>
    image.src.endsWith(`equirect_${String(lod)}.webp`),
  );
}

/** Fire onload for every pending image of one LOD and flush the microtasks. */
async function completeLod(lod: 512 | 2048): Promise<void> {
  await act(async () => {
    for (const image of imagesFor(lod)) {
      image.onload?.();
    }
    await Promise.resolve();
  });
}

describe("useEquirectTexture", () => {
  beforeEach(() => {
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams the 512 preview first, then swaps to the 2048 full pano", async () => {
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

    // Only after the preview is live does the full pano start.
    expect(MockImage.instances).toHaveLength(2);
    expect(MockImage.instances[1]?.src).toBe(`${BASE}/tiles/scan_000/equirect_2048.webp`);

    await completeLod(2048);
    await waitFor(() => {
      expect(result.current.lod).toBe(2048);
    });
    expect(result.current.texture).not.toBe(preview);
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

    await completeLod(2048);
    await waitFor(() => {
      expect(result.current.lod).toBe(2048);
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
