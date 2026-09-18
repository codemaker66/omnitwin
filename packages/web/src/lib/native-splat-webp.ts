import decode, { init } from "@jsquash/webp/decode.js";
import wasmUrl from "@jsquash/webp/codec/dec/webp_dec.wasm?url";
import type { SplatImage } from "./native-splat-sog.js";

let initialized: Promise<void> | undefined;

/** libwebp RGBA bytes: no canvas, premultiplication or color-space conversion. */
export async function decodeSplatWebp(buffer: ArrayBuffer): Promise<SplatImage> {
  initialized ??= init({ locateFile: () => wasmUrl });
  await initialized;
  return decode(buffer);
}
