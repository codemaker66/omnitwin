// ---------------------------------------------------------------------------
// Decoding a wall detail tile (hall-detail.ts), shared by its worker
//
// A tile arrives as a 512 px WebP; the worker (hall-detail.worker.ts) decodes
// it to RGBA and builds the mip levels the detail array samples (0 to 3: the
// tiles' 8-texel gutters hold good to level 3), so the main thread only hands
// the buffers to the GPU. Each level is the 2 x 2 mean of the one above in
// linear light, as the GPU's own mip generation filters an sRGB texture.
//
// The levels' buffers go back to the worker once their tile is on the GPU
// (DetailRecycle), so a walk past a wall streams tiles without leaving 1.4 MB
// of garbage a tile on the main thread for its collector to sweep up.
// ---------------------------------------------------------------------------

/** Texels across a tile, gutters included. */
export const DETAIL_TILE_TEXELS = 512;
/** Mip levels each tile carries (512, 256, 128, 64 texels). */
export const DETAIL_LEVELS = 4;
/** Sets of level buffers the worker keeps for reuse. */
export const DETAIL_POOL_SETS = 6;

/** A request to the decoding worker: the tile's encoded bytes (transferred). */
export interface DetailDecodeRequest {
  readonly kind: "decode";
  readonly id: number;
  readonly bytes: ArrayBuffer;
}

/** A tile's level buffers handed back to the worker for its next tiles (transferred). */
export interface DetailRecycle {
  readonly kind: "recycle";
  readonly levels: readonly ArrayBuffer[];
}

export type DetailWorkerMessage = DetailDecodeRequest | DetailRecycle;

/**
 * The worker's answer: the tile's RGBA levels, largest first (transferred), or
 * why it failed; `fatal` when the worker cannot decode any tile on this
 * browser (no OffscreenCanvas or 2D context), not just this one.
 */
export type DetailDecodeResponse =
  | { readonly id: number; readonly ok: true; readonly levels: readonly ArrayBuffer[] }
  | { readonly id: number; readonly ok: false; readonly error: string; readonly fatal?: boolean };

/** Bytes of a tile's level `level`. */
export function detailLevelBytes(level: number): number {
  return (DETAIL_TILE_TEXELS >> level) ** 2 * 4;
}

/** Whether `levels` is a whole set of a tile's level buffers, each of its level's size. */
export function isDetailLevelSet(levels: readonly ArrayBuffer[]): boolean {
  return levels.length === DETAIL_LEVELS && levels.every((buffer, level) => buffer.byteLength === detailLevelBytes(level));
}

let toLinear: Float32Array | null = null;
let toSrgb: Uint8Array | null = null;
/** Steps of the linear-to-sRGB table (fine enough that the darkest codes round correctly). */
const SRGB_STEPS = 65535;

function tables(): { readonly linear: Float32Array; readonly srgb: Uint8Array } {
  if (toLinear === null || toSrgb === null) {
    const linear = new Float32Array(256);
    for (let code = 0; code < 256; code++) {
      const c = code / 255;
      linear[code] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    const srgb = new Uint8Array(SRGB_STEPS + 1);
    for (let step = 0; step <= SRGB_STEPS; step++) {
      const l = step / SRGB_STEPS;
      const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
      srgb[step] = Math.round(Math.min(1, Math.max(0, c)) * 255);
    }
    toLinear = linear;
    toSrgb = srgb;
  }
  return { linear: toLinear, srgb: toSrgb };
}

/**
 * The mip chain of a square RGBA8 sRGB image: `levels` images, the first the
 * image itself, each next the 2 x 2 mean of the one before in linear light
 * (alpha averaged as it is). Levels after the first are written into `into`
 * (by level) where it holds a buffer of the right size, otherwise into new ones.
 */
export function detailMipChain(base: Uint8Array<ArrayBuffer>, size: number, levels: number, into: readonly (Uint8Array<ArrayBuffer> | undefined)[] = []): Uint8Array<ArrayBuffer>[] {
  if (base.length !== size * size * 4) throw new Error(`A ${String(size)} px tile needs ${String(size * size * 4)} bytes, not ${String(base.length)}`);
  const { linear, srgb } = tables();
  const chain: Uint8Array<ArrayBuffer>[] = [base];
  let source = base;
  let side = size;
  for (let level = 1; level < levels && side > 1; level++) {
    const half = side >> 1;
    const given = into[level];
    const next = given !== undefined && given.length === half * half * 4 ? given : new Uint8Array(half * half * 4);
    for (let y = 0; y < half; y++) {
      const row0 = 2 * y * side * 4;
      const row1 = row0 + side * 4;
      for (let x = 0; x < half; x++) {
        const a = row0 + 8 * x;
        const b = row1 + 8 * x;
        const out = (y * half + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const mean = ((linear[source[a + channel] ?? 0] ?? 0) + (linear[source[a + 4 + channel] ?? 0] ?? 0)
            + (linear[source[b + channel] ?? 0] ?? 0) + (linear[source[b + 4 + channel] ?? 0] ?? 0)) / 4;
          next[out + channel] = srgb[Math.round(mean * SRGB_STEPS)] ?? 0;
        }
        next[out + 3] = Math.round(((source[a + 3] ?? 0) + (source[a + 7] ?? 0) + (source[b + 3] ?? 0) + (source[b + 7] ?? 0)) / 4);
      }
    }
    chain.push(next);
    source = next;
    side = half;
  }
  return chain;
}
