import { useEffect, useState } from "react";
import { LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import {
  TWIN_EQUIRECT_LODS,
  twinEquirectPath,
  type TwinEquirectLod,
} from "@omnitwin/types";

// -----------------------------------------------------------------------------
// useEquirectTexture — streams one scan node's world-frame equirect pano into
// a THREE.Texture, preview first. The 512×256 paints the sphere within a few
// tens of KB; the 4096×2048 full swaps in silently once it arrives (the pano
// simply sharpens — no spinner, no pop). Lifecycle mirrors useCubeTiles
// exactly: textures are disposed on LOD swap, node change and unmount —
// nothing leaks across a walk.
//
// Hop smoothness: where the platform provides createImageBitmap, the full
// pano is decoded OFF the main thread (fetch → blob → bitmap) so the swap
// never hitches the look springs; environments without it (happy-dom, old
// engines) keep the plain Image path unchanged. Pair with useTwinPrefetch,
// which cache-warms neighbour panos so travel starts from the HTTP cache.
//
// Sampling setup: the PanoStage equirect shader computes u from atan2, so
// wrapS is RepeatWrapping (the winding seam samples continuously) and
// mipmaps are OFF (LinearFilter) — the az branch cut would otherwise smear a
// derivative-picked low mip down one seam column.
// -----------------------------------------------------------------------------

export interface EquirectTextureState {
  readonly texture: Texture | null;
  /** 0 = nothing loaded yet; otherwise the LOD currently applied. */
  readonly lod: 0 | TwinEquirectLod;
}

/**
 * Load one pano image. Resolves null on error; never rejects. Under happy-dom
 * the Image callbacks simply never fire, so the promise stays pending forever
 * — the hook treats that as "still loading" and the effect's cancel flag keeps
 * teardown safe, so tests without real image loading cannot throw.
 */
function loadPanoImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Decode a pano off the main thread where possible. `imageOrientation:
 * "flipY"` + `texture.flipY = false` is upload-equivalent to the classic
 * Image path (three flips HTMLImageElement uploads itself) — the shader sees
 * identical texels either way. Returns null on any failure so the caller
 * falls back to the Image path.
 */
async function loadPanoBitmap(url: string): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function" || typeof fetch !== "function") {
    return null;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await createImageBitmap(blob, { imageOrientation: "flipY" });
  } catch {
    return null;
  }
}

/** Load one LOD into an sRGB, repeat-wrapping, mipless texture (or null). */
async function buildLodTexture(
  nodeId: string,
  base: string,
  lod: TwinEquirectLod,
): Promise<Texture | null> {
  const url = `${base}/${twinEquirectPath(nodeId, lod)}`;
  // Capability check happens BEFORE any await: without the bitmap path the
  // Image must be constructed synchronously with the effect (the test suite
  // pins that timing, and it keeps first paint one microtask earlier).
  const canBitmap =
    typeof createImageBitmap === "function" && typeof fetch === "function";
  const bitmap = canBitmap ? await loadPanoBitmap(url) : null;
  const source = bitmap ?? (await loadPanoImage(url));
  if (source === null) {
    return null;
  }
  const texture = new Texture(source);
  if (bitmap !== null) {
    texture.flipY = false; // orientation already baked by createImageBitmap
  }
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Stream a node's equirect pano: 512 preview first (fast paint), then the
 * 2048 full set swaps in. `base` is the bundle base including the venue
 * segment, e.g. `/twin/trades-hall`.
 */
export function useEquirectTexture(nodeId: string, base: string): EquirectTextureState {
  const [state, setState] = useState<EquirectTextureState>({ texture: null, lod: 0 });

  useEffect(() => {
    let cancelled = false;
    let live: Texture | null = null;

    setState((previous) =>
      previous.texture === null && previous.lod === 0
        ? previous
        : { texture: null, lod: 0 },
    );

    const stream = async (): Promise<void> => {
      for (const lod of TWIN_EQUIRECT_LODS) {
        const texture = await buildLodTexture(nodeId, base, lod);
        if (cancelled) {
          texture?.dispose();
          return;
        }
        if (texture === null) {
          continue;
        }
        live?.dispose();
        live = texture;
        setState({ texture, lod });
      }
    };

    void stream();

    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [nodeId, base]);

  return state;
}
