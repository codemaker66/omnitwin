import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPZLoader } from "three/addons/loaders/SPZLoader.js";
import { ZSTDDecoder } from "three/addons/libs/zstddec.module.js";
import { decodeNativeSplatBuffer } from "../native-splat-decode.js";
import { MAX_NATIVE_SPLATS } from "../native-splat-data.js";

function legacySpz(version = 2, count = 1): Uint8Array {
  const stride = (version === 1 ? 6 : 9) + 1 + 3 + 3 + (version === 3 ? 4 : 3);
  const bytes = new Uint8Array(16 + stride);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x5053474e, true);
  view.setUint32(4, version, true);
  view.setUint32(8, count, true);
  bytes[13] = 3;
  return bytes;
}

// Standard single-segment ZSTD frame with one raw final block. This fixture is
// independent of the native decoder and requires no compression dependency.
function rawZstd(bytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(9 + bytes.length);
  frame.set([0x28, 0xb5, 0x2f, 0xfd, 0x20, bytes.length]);
  const block = (bytes.length << 3) | 1;
  frame.set([block & 255, block >>> 8, block >>> 16], 6);
  frame.set(bytes, 9);
  return frame;
}

function version4(): ArrayBuffer {
  const streams = [
    new Uint8Array([8, 0, 0, 16, 0, 0, 24, 0, 0]), new Uint8Array([127]),
    new Uint8Array([128, 128, 128]), new Uint8Array([160, 160, 160]),
    new Uint8Array([0, 0, 0, 192]),
  ];
  const compressed = streams.map(rawZstd);
  const bytes = new Uint8Array(20 + 16 * streams.length + compressed.reduce((sum, value) => sum + value.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x5053474e, true);
  view.setUint32(4, 4, true);
  view.setUint32(8, 1, true);
  bytes[13] = 3;
  bytes[15] = streams.length;
  view.setUint32(16, 20, true);
  let offset = 20 + 16 * streams.length;
  compressed.forEach((stream, index) => {
    view.setBigUint64(20 + index * 16, BigInt(stream.length), true);
    view.setBigUint64(28 + index * 16, BigInt(stream.length - 9), true);
    bytes.set(stream, offset);
    offset += stream.length;
  });
  return bytes.buffer;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("bounded native SPZ decoding", () => {
  it.each([1, 2, 3])("keeps official SPZ v%i geometry conversion", async (version) => {
    const input = new Uint8Array(gzipSync(legacySpz(version))).buffer;
    const parsed = await decodeNativeSplatBuffer(input, "/capture.spz");
    expect(parsed.centers.length).toBe(3);
    expect(parsed.format).toBe("spz");
  });

  it("keeps official SPZ v4 ZSTD conversion with independently constructed frames", async () => {
    const parsed = await decodeNativeSplatBuffer(version4(), "/capture.spz");
    expect([...parsed.centers]).toEqual([1, 2, 3]);
    expect([...parsed.covariances]).toEqual([1, 0, 0, 1, 0, 1]);
    expect(parsed.colors[3]).toBe(127);
  });

  it("rejects a gzip expansion beyond its declared payload before geometry allocation", async () => {
    const bytes = new Uint8Array(1024 * 1024);
    bytes.set(legacySpz());
    const parse = vi.spyOn(SPZLoader.prototype, "parseRawSPZ");
    await expect(decodeNativeSplatBuffer(new Uint8Array(gzipSync(bytes)).buffer, "/bomb.spz"))
      .rejects.toThrow("exceeds its declared size");
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects oversized gzip point counts from the first decoded header", async () => {
    const parse = vi.spyOn(SPZLoader.prototype, "parseRawSPZ");
    const bytes = legacySpz(2, MAX_NATIVE_SPLATS + 1);
    await expect(decodeNativeSplatBuffer(new Uint8Array(gzipSync(bytes)).buffer, "/count.spz"))
      .rejects.toThrow("Splat count");
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects oversized v4 counts before initializing the ZSTD decoder", async () => {
    const bytes = version4();
    new DataView(bytes).setUint32(8, MAX_NATIVE_SPLATS + 1, true);
    const initialize = vi.spyOn(ZSTDDecoder.prototype, "init");
    await expect(decodeNativeSplatBuffer(bytes, "/count.spz")).rejects.toThrow("Splat count");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("rejects malformed v4 tables and output sizes before ZSTD allocation", async () => {
    const initialize = vi.spyOn(ZSTDDecoder.prototype, "init");
    for (const change of [
      (view: DataView) => { view.setUint32(16, 0xfffffff0, true); },
      (view: DataView) => { view.setBigUint64(20, 2n ** 63n, true); },
      (view: DataView) => { view.setBigUint64(28, 0xffffffffn, true); },
      (view: DataView) => { view.setUint8(15, 1); },
      (view: DataView) => { view.setUint8(12, 255); },
    ]) {
      const bytes = version4();
      change(new DataView(bytes));
      await expect(decodeNativeSplatBuffer(bytes, "/malformed.spz")).rejects.toThrow();
    }
    expect(initialize).not.toHaveBeenCalled();
  });

  it("rejects a ZSTD frame whose actual decoded output differs from the validated table", async () => {
    const bytes = version4();
    // First raw block claims eight bytes although the stream table requires nine.
    new Uint8Array(bytes)[126] = 65;
    await expect(decodeNativeSplatBuffer(bytes, "/malformed.spz")).rejects.toThrow("ZSTD payload length");
  });

  it("preserves cancellation before decompression", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(decodeNativeSplatBuffer(version4(), "/cancel.spz", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects SPZ LOD trees before decoding parent and leaf records together", async () => {
    const parse = vi.spyOn(SPZLoader.prototype, "parseRawSPZ");
    const initialize = vi.spyOn(ZSTDDecoder.prototype, "init");
    const legacy = legacySpz();
    legacy[14] = 0x80;
    await expect(decodeNativeSplatBuffer(new Uint8Array(gzipSync(legacy)).buffer, "/tree.spz"))
      .rejects.toThrow("leaf-only SPZ");
    const v4 = version4();
    new Uint8Array(v4)[14] = 0x80;
    await expect(decodeNativeSplatBuffer(v4, "/tree-v4.spz")).rejects.toThrow("leaf-only SPZ");
    expect(parse).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });
});
