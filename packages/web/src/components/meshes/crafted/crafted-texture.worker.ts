// ---------------------------------------------------------------------------
// The crafted furniture textures' painter, off the main thread
//
// Each request names one map (crafted-texture-recipes.ts); the answer carries
// its RGBA pixels, the buffer transferred, so the main thread neither paints
// nor copies. The damask's and the parquet's two maps share one evaluation of
// their figure here, as they do on the main thread, since both are painted by
// this one worker.
// ---------------------------------------------------------------------------

import {
  isCraftedTextureId,
  paintCraftedTexture,
  type CraftedTexturePaintAnswer,
  type CraftedTexturePaintRequest,
} from "./crafted-texture-recipes.js";

type PainterScope = typeof self & {
  onmessage: ((event: MessageEvent<CraftedTexturePaintRequest>) => void) | null;
  postMessage: (message: CraftedTexturePaintAnswer, transfer?: Transferable[]) => void;
};

const scope = self as PainterScope;

scope.onmessage = (event: MessageEvent<CraftedTexturePaintRequest>) => {
  const { id, texture } = event.data;
  if (!isCraftedTextureId(texture)) {
    scope.postMessage({ id, ok: false, error: `Not a crafted texture: ${String(texture)}` });
    return;
  }
  try {
    const pixels = paintCraftedTexture(texture);
    scope.postMessage({ id, ok: true, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
