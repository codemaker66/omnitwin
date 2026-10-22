// ---------------------------------------------------------------------------
// The wall detail tiles' decoder (hall-detail.ts), off the main thread
//
// Each decode message carries one tile's WebP bytes; the answer carries its
// RGBA mip levels (hall-detail-decode.ts), every buffer transferred, so the
// main thread neither decodes nor copies. Once a tile is on the GPU its
// buffers come back (a recycle message) and the next tiles are decoded into
// them. The canvas reads the image as encoded: no colour conversion, no
// premultiplication.
// ---------------------------------------------------------------------------

import {
  DETAIL_LEVELS, DETAIL_POOL_SETS, DETAIL_TILE_TEXELS, detailMipChain, isDetailLevelSet,
  type DetailDecodeResponse, type DetailWorkerMessage,
} from "./hall-detail-decode.js";

type DetailWorkerScope = typeof self & {
  onmessage: ((event: MessageEvent<DetailWorkerMessage>) => void) | null;
  postMessage: (message: DetailDecodeResponse, transfer: Transferable[]) => void;
};

const scope = self as DetailWorkerScope;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
/** Level buffers handed back by the main thread, whole sets only. */
const pool: ArrayBuffer[][] = [];

async function decode(bytes: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>[]> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/webp" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    if (bitmap.width !== DETAIL_TILE_TEXELS || bitmap.height !== DETAIL_TILE_TEXELS) {
      throw new Error(`A detail tile is ${String(bitmap.width)} x ${String(bitmap.height)}, not ${String(DETAIL_TILE_TEXELS)}`);
    }
    canvas ??= new OffscreenCanvas(DETAIL_TILE_TEXELS, DETAIL_TILE_TEXELS);
    context ??= canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (context === null) throw new Error("No 2D context in the detail worker");
    context.clearRect(0, 0, DETAIL_TILE_TEXELS, DETAIL_TILE_TEXELS);
    context.drawImage(bitmap, 0, 0);
    const reused = pool.pop()?.map((buffer) => new Uint8Array(buffer)) ?? [];
    const base = reused[0] ?? new Uint8Array(DETAIL_TILE_TEXELS * DETAIL_TILE_TEXELS * 4);
    base.set(context.getImageData(0, 0, DETAIL_TILE_TEXELS, DETAIL_TILE_TEXELS).data);
    return detailMipChain(base, DETAIL_TILE_TEXELS, DETAIL_LEVELS, reused);
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (event: MessageEvent<DetailWorkerMessage>) => {
  const message = event.data;
  if (message.kind === "recycle") {
    if (isDetailLevelSet(message.levels) && pool.length < DETAIL_POOL_SETS) pool.push([...message.levels]);
    return;
  }
  const { id, bytes } = message;
  decode(bytes).then((levels) => {
    const buffers = levels.map((level) => level.buffer);
    scope.postMessage({ id, ok: true, levels: buffers }, buffers);
  }, (reason: unknown) => {
    scope.postMessage({ id, ok: false, error: reason instanceof Error ? reason.message : String(reason) }, []);
  });
};
