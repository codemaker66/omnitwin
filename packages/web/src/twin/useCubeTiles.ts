import { useEffect, useRef, useState } from "react";
import { CubeTexture, SRGBColorSpace } from "three";
import {
  TWIN_FACES,
  TWIN_LODS,
  twinTilePath,
  type TwinFace,
  type TwinLod,
} from "@omnitwin/types";
import { FACE_TO_CUBE } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// useCubeTiles — streams one scan node's six cubemap faces into a
// THREE.CubeTexture, low LOD first. The 256 set paints the sphere within a
// few tens of KB; the 1024 set swaps in silently once it arrives (the pano
// simply sharpens — no spinner, no pop). Each face is drawn through a 2D
// canvas so the FACE_TO_CUBE calibration (quarter-turns, then flips) is
// baked into the texture,
// and the canvases are slotted into WebGL's fixed [px,nx,py,ny,pz,nz] order
// per the FACE_TO_CUBE targets. Textures are disposed on LOD swap, node
// change, and unmount — nothing leaks across a walk.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 7).
// -----------------------------------------------------------------------------

export interface CubeTilesState {
  readonly texture: CubeTexture | null;
  /** 0 = nothing loaded yet; otherwise the LOD currently applied. */
  readonly lod: 0 | TwinLod;
  readonly settled: boolean;
}

const textureRefs = new WeakMap<CubeTexture, number>();

function releaseCubeTexture(texture: CubeTexture): void {
  const remaining = (textureRefs.get(texture) ?? 1) - 1;
  if (remaining > 0) textureRefs.set(texture, remaining);
  else {
    textureRefs.delete(texture);
    texture.dispose();
  }
}

/** The rendered tier survives until its replacement uploads successfully. */
export function retainCubeTexture(texture: CubeTexture): () => void {
  textureRefs.set(texture, (textureRefs.get(texture) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCubeTexture(texture);
  };
}

/** WebGL cube face order — [px, nx, py, ny, pz, nz]. */
const CUBE_SLOT_INDEX: Record<
  "px" | "nx" | "py" | "ny" | "pz" | "nz",
  0 | 1 | 2 | 3 | 4 | 5
> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/**
 * Load one tile image. Resolves null on error; never rejects. Under happy-dom
 * the Image callbacks simply never fire, so the promise stays pending forever
 * — the hook treats that as "still loading" and the effect's cancel flag keeps
 * teardown safe, so tests without real image loading cannot throw.
 */
function loadTileImage(url: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    let settled = false;
    const finish = (value: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const abort = (): void => {
      image.src = "";
      finish(null);
    };
    image.onload = () => { finish(image); };
    image.onerror = () => { finish(null); };
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

/** Draw one face tile onto a canvas, applying the FACE_TO_CUBE calibration. */
function drawFaceCanvas(
  image: HTMLImageElement,
  face: TwinFace,
  lod: TwinLod,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = lod;
  canvas.height = lod;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  const mapping = FACE_TO_CUBE[face];
  // Clockwise quarter-turns about the face centre — exact for square faces.
  if (mapping.rotateQuarters !== 0) {
    context.translate(lod / 2, lod / 2);
    context.rotate((mapping.rotateQuarters * Math.PI) / 2);
    context.translate(-lod / 2, -lod / 2);
  }
  if (mapping.flipX) {
    context.translate(lod, 0);
    context.scale(-1, 1);
  }
  if (mapping.flipY) {
    context.translate(0, lod);
    context.scale(1, -1);
  }
  context.drawImage(image, 0, 0, lod, lod);
  return canvas;
}

/**
 * Load all six faces of one LOD and assemble them into an sRGB CubeTexture.
 * Returns null if any face fails — the caller keeps whatever LOD is live.
 */
async function buildLodTexture(
  nodeId: string,
  base: string,
  lod: TwinLod,
  signal: AbortSignal,
): Promise<CubeTexture | null> {
  const drawn = await Promise.all(
    TWIN_FACES.map(async (face) => {
      const image = await loadTileImage(`${base}/${twinTilePath(nodeId, face, lod)}`, signal);
      if (image === null || signal.aborted) return null;
      try {
        return { face, canvas: drawFaceCanvas(image, face, lod) };
      } catch {
        return null;
      }
    }),
  );

  const slots = new Map<number, HTMLCanvasElement>();
  for (const entry of drawn) {
    if (entry !== null && entry.canvas !== null) {
      slots.set(CUBE_SLOT_INDEX[FACE_TO_CUBE[entry.face].target], entry.canvas);
    }
  }

  const ordered: HTMLCanvasElement[] = [];
  for (let slot = 0; slot < 6; slot += 1) {
    const canvas = slots.get(slot);
    if (canvas === undefined) {
      return null;
    }
    ordered.push(canvas);
  }

  const texture = new CubeTexture(ordered);
  textureRefs.set(texture, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Stream a node's cubemap: 256 faces first (fast paint), then the 1024 set
 * swaps in. `base` is the bundle base including the venue segment, e.g.
 * `/twin/trades-hall`.
 */
export function useCubeTiles(nodeId: string, base: string, retryKey = 0): CubeTilesState {
  const [state, setState] = useState<CubeTilesState>({ texture: null, lod: 0, settled: false });
  const slotRef = useRef<{ key: string; live: CubeTexture | null; lod: 0 | TwinLod }>({
    key: "", live: null, lod: 0,
  });
  const requestRef = useRef("");
  const requestKey = JSON.stringify([base, nodeId, retryKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const key = JSON.stringify([base, nodeId]);
    const slot = slotRef.current;
    requestRef.current = requestKey;
    if (slot.key !== key) {
      if (slot.live !== null) releaseCubeTexture(slot.live);
      slot.key = key;
      slot.live = null;
      slot.lod = 0;
    }
    setState({ texture: slot.live, lod: slot.lod, settled: false });

    const stream = async (): Promise<void> => {
      for (const lod of TWIN_LODS) {
        if (lod <= slot.lod) continue;
        const texture = await buildLodTexture(nodeId, base, lod, controller.signal).catch(() => null);
        if (cancelled || slot.key !== key) {
          if (texture !== null) releaseCubeTexture(texture);
          return;
        }
        if (texture === null) {
          continue;
        }
        if (slot.live !== null) releaseCubeTexture(slot.live);
        slot.live = texture;
        slot.lod = lod;
        setState({ texture, lod, settled: false });
      }
      if (!cancelled && slot.key === key) {
        setState({ texture: slot.live, lod: slot.lod, settled: true });
      }
    };

    void stream();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nodeId, base, retryKey, requestKey]);

  useEffect(() => {
    const slot = slotRef.current;
    return () => {
      if (slot.live !== null) releaseCubeTexture(slot.live);
      slot.live = null;
      slot.key = "";
      slot.lod = 0;
    };
  }, []);

  if (slotRef.current.key !== JSON.stringify([base, nodeId])) {
    return { texture: null, lod: 0, settled: false };
  }
  return requestRef.current === requestKey ? state : { ...state, settled: false };
}
