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
// tens of KB; the 2048×1024 swaps in silently once it arrives (the pano
// simply sharpens — no spinner, no pop). Lifecycle mirrors useCubeTiles
// exactly: textures are disposed on LOD swap, node change and unmount —
// nothing leaks across a walk.
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

/** Load one LOD into an sRGB, repeat-wrapping, mipless texture (or null). */
async function buildLodTexture(
  nodeId: string,
  base: string,
  lod: TwinEquirectLod,
): Promise<Texture | null> {
  const image = await loadPanoImage(`${base}/${twinEquirectPath(nodeId, lod)}`);
  if (image === null) {
    return null;
  }
  const texture = new Texture(image);
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
