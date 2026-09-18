import type { BufferGeometry } from "three";
import { SPZLoader } from "three/addons/loaders/SPZLoader.js";
import { ZSTDDecoder } from "three/addons/libs/zstddec.module.js";
import { assertSplatCount, nativeValue } from "./native-splat-data.js";

const SPZ_MAGIC = 0x5053474e;
const MAX_SPZ_BYTES = 2 * 1024 * 1024 * 1024;
const SH_VECTORS = [0, 3, 8, 15, 24] as const;

interface SpzHeader {
  readonly version: number;
  readonly count: number;
  readonly flags: number;
  readonly streamSizes: readonly number[];
}

function readHeader(bytes: Uint8Array, compressedV4: boolean): SpzHeader {
  if (bytes.byteLength < (compressedV4 ? 20 : 16)) throw new Error("Truncated SPZ header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SPZ_MAGIC) throw new Error("Invalid SPZ magic.");
  const version = view.getUint32(4, true);
  if (compressedV4 ? version !== 4 : version < 1 || version > 3) throw new Error("Unsupported SPZ version.");
  const count = view.getUint32(8, true);
  assertSplatCount(count);
  const degree = view.getUint8(12), fractionalBits = view.getUint8(13), flags = view.getUint8(14);
  if (degree >= SH_VECTORS.length) throw new Error("Unsupported SPZ spherical harmonics degree.");
  if (version !== 1 && fractionalBits > 24) throw new Error("Invalid SPZ position precision.");
  // Upstream skips the child arrays and special tree-opacity encoding, which
  // would draw both parent and leaf Gaussians. Ordinary SPZ v1–4 remain supported.
  if ((flags & 0x80) !== 0) {
    throw new Error("LOD-tree SPZ is not supported by native rendering. Select a leaf-only SPZ, SOG or PLY source.");
  }
  const streamSizes = [count * 3 * (version === 1 ? 2 : 3), count, count * 3, count * 3,
    count * (version >= 3 ? 4 : 3), count * nativeValue(SH_VECTORS[degree]) * 3];
  return { version, count, flags, streamSizes };
}

/** Stream decompression stops at the validated header's exact payload length.
 * Passing compressed input to upstream parse() would inflate without a limit. */
async function inflateSpz(buffer: ArrayBuffer, signal?: AbortSignal): Promise<Uint8Array> {
  const source = new Uint8Array(buffer);
  let offset = 0;
  const input = new ReadableStream<Uint8Array>({
    pull(controller) {
      signal?.throwIfAborted();
      if (offset === source.length) controller.close();
      else {
        const end = Math.min(offset + 65536, source.length);
        controller.enqueue(source.subarray(offset, end));
        offset = end;
      }
    },
  });
  const reader = input.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  const header = new Uint8Array(16);
  let loaded = 0, expected: number | null = null;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (loaded < header.length) header.set(value.subarray(0, header.length - loaded), loaded);
      loaded += value.length;
      if (expected === null && loaded >= header.length) {
        const parsed = readHeader(header, false);
        expected = 16 + parsed.streamSizes.reduce((sum, size) => sum + size, 0)
          + ((parsed.flags & 0x80) !== 0 ? parsed.count * 6 : 0);
      }
      if (loaded > (expected ?? header.length) || loaded > MAX_SPZ_BYTES) {
        throw new Error("SPZ decompressed payload exceeds its declared size or safety limit.");
      }
      chunks.push(value);
    }
    if (expected === null || loaded !== expected) throw new Error("SPZ payload length does not match its header.");
    const bytes = new Uint8Array(loaded);
    let written = 0;
    for (const chunk of chunks) { bytes.set(chunk, written); written += chunk.length; }
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Restrict allocations before calling Three's otherwise unchecked v4 decoder. */
function validateV4(bytes: Uint8Array): void {
  const header = readHeader(bytes, true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const streams = view.getUint8(15), toc = view.getUint32(16, true);
  const requiredSizes = header.streamSizes.filter((size) => size > 0);
  if (streams < requiredSizes.length || streams > 16 || toc < 20 || toc > 1048576
    || toc + streams * 16 > bytes.byteLength) throw new Error("Invalid SPZ v4 stream table.");
  let offset = toc + streams * 16;
  for (let index = 0; index < streams; index++) {
    const compressed = Number(view.getBigUint64(toc + index * 16, true));
    const decoded = Number(view.getBigUint64(toc + index * 16 + 8, true));
    if (!Number.isSafeInteger(compressed) || compressed <= 0 || compressed > bytes.byteLength - offset
      || !Number.isSafeInteger(decoded) || decoded <= 0 || decoded > MAX_SPZ_BYTES
      || (index < requiredSizes.length && decoded !== requiredSizes[index])) {
      throw new Error("Invalid SPZ v4 compressed or decompressed stream length.");
    }
    offset += compressed;
  }
  if (offset !== bytes.byteLength) throw new Error("SPZ v4 payload length does not match its stream table.");
}

class BoundedZstdDecoder extends ZSTDDecoder {
  override decode(bytes: Uint8Array, expected = 0): Uint8Array {
    if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_SPZ_BYTES) {
      throw new Error("Invalid SPZ ZSTD output size.");
    }
    const decoded = super.decode(bytes, expected);
    if (decoded.byteLength !== expected) throw new Error("SPZ ZSTD payload length does not match its header.");
    return decoded;
  }
}

/** Ordinary (non-LOD-tree) SPZ v1–4, using Three's native attribute conversion
 * after bounded input decoding. Tree sources need explicit leaf-only conversion. */
export async function decodeBoundedSpz(buffer: ArrayBuffer, signal?: AbortSignal): Promise<BufferGeometry> {
  signal?.throwIfAborted();
  if (buffer.byteLength > MAX_SPZ_BYTES) throw new Error("SPZ source exceeds 2 GiB.");
  const bytes = new Uint8Array(buffer);
  const loader = new SPZLoader();
  if (bytes.length >= 4 && new DataView(buffer).getUint32(0, true) === SPZ_MAGIC) {
    validateV4(bytes);
    const decoder = new BoundedZstdDecoder();
    await decoder.init();
    signal?.throwIfAborted();
    return loader.parseRawSPZV4(bytes, decoder);
  }
  const raw = await inflateSpz(buffer, signal);
  signal?.throwIfAborted();
  return loader.parseRawSPZ(raw);
}
