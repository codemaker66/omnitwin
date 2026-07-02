import { useEffect, useState } from "react";
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
function loadTileImage(url: string): Promise<HTMLImageElement | null> {
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
): Promise<CubeTexture | null> {
  const drawn = await Promise.all(
    TWIN_FACES.map(async (face) => {
      const image = await loadTileImage(`${base}/${twinTilePath(nodeId, face, lod)}`);
      return image === null ? null : { face, canvas: drawFaceCanvas(image, face, lod) };
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
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Stream a node's cubemap: 256 faces first (fast paint), then the 1024 set
 * swaps in. `base` is the bundle base including the venue segment, e.g.
 * `/twin/trades-hall`.
 */
export function useCubeTiles(nodeId: string, base: string): CubeTilesState {
  const [state, setState] = useState<CubeTilesState>({ texture: null, lod: 0 });

  useEffect(() => {
    let cancelled = false;
    let live: CubeTexture | null = null;

    setState((previous) =>
      previous.texture === null && previous.lod === 0
        ? previous
        : { texture: null, lod: 0 },
    );

    const stream = async (): Promise<void> => {
      for (const lod of TWIN_LODS) {
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
