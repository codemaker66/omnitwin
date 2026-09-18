import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import decodeWebp, { init } from "@jsquash/webp/decode.js";
import { decodeSogArchive, inspectSogWebp, type SplatImage } from "../native-splat-sog.js";
import { nativeDataToGeometry } from "../native-splat-data.js";

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

async function archive(meta: unknown, images: ReadonlyMap<string, Uint8Array>): Promise<ArrayBuffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, level: 0 });
  await writer.add("meta.json", new Uint8ArrayReader(new TextEncoder().encode(JSON.stringify(meta))));
  for (const [name, bytes] of images) await writer.add(name, new Uint8ArrayReader(bytes));
  return arrayBuffer(await writer.close());
}

function fixture(version: 1 | 2, withSh = false) {
  const images = new Map<string, Uint8Array>(), decoded = new Map<number, SplatImage>();
  function image(name: string, rgba: readonly number[], width = 1): string[] {
    const id = images.size + 1, bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("RIFF")); view.setUint32(4, 20, true);
    bytes.set(new TextEncoder().encode("WEBPVP8L"), 8); view.setUint32(16, 7, true);
    bytes[20] = 0x2f; view.setUint32(21, width - 1, true); bytes[25] = id;
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) data.set(rgba, x * 4);
    images.set(name, bytes); decoded.set(id, { width, height: 1, data }); return [name];
  }
  const book = Array.from({ length: 256 }, () => 0);
  const meta: Record<string, unknown> = {
    ...(version === 2 ? { version, count: 1 } : {}), antialias: false,
    means: { shape: [1, 3], mins: [0, 0, 0], maxs: [Math.log(2), 0, 0], files: [...image("lower.webp", [255, 0, 0, 255]), ...image("upper.webp", [255, 0, 0, 255])] },
    scales: { files: image("scale.webp", [0, 0, 0, 255]), ...(version === 2 ? { codebook: book } : { mins: [0, 0, 0], maxs: [0, 0, 0] }) },
    quats: { files: image("quat.webp", [128, 128, 128, 252]) },
    sh0: { files: image("color.webp", [0, 0, 0, 17]), ...(version === 2 ? { codebook: book } : { mins: [0, 0, 0, 0], maxs: [0, 0, 0, 0] }) },
  };
  if (withSh) meta.shN = { files: [...image("palette.webp", [255, 0, 128, 255], 192), ...image("labels.webp", [0, 0, 0, 255])], ...(version === 2 ? { bands: 1, count: 1, codebook: book } : { mins: -.5, maxs: .5, shape: [1, 9] }) };
  return { meta, images, decode: (bytes: ArrayBuffer) => Promise.resolve(decoded.get(new Uint8Array(bytes)[25]!)!) };
}

describe("native SOG data adapter", () => {
  beforeAll(async () => {
    // libwebp's binding only uses ImageData as a typed RGBA container; no canvas.
    vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(resolve(dirname(require.resolve("@jsquash/webp/decode.js")), "codec/dec/webp_dec.wasm"));
    await init(await WebAssembly.compile(arrayBuffer(wasm)));
  });

  it("matches independent Pillow/NumPy samples from the real Reception SH3 capture", async () => {
    const reference = JSON.parse(readFileSync(resolve("src/lib/__tests__/native-splat-reference.json"), "utf8")) as {
      sourceSha256: string; count: number; shDegree: number;
      samples: { index: number; position: number[]; covariance: number[]; color: number[]; sh: number[] }[];
    };
    const bytes = readFileSync(resolve("public/splats/reception/env.sog"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(reference.sourceSha256);
    const result = await decodeSogArchive(arrayBuffer(bytes), decodeWebp);
    expect(result.centers.length / 3).toBe(reference.count);
    expect(result.sh.length).toBe(reference.shDegree);
    for (const sample of reference.samples) {
      sample.position.forEach((value, axis) => { expect(result.centers[sample.index * 3 + axis]).toBeCloseTo(value, 5); });
      sample.covariance.forEach((value, axis) => { expect(result.covariances[sample.index * 6 + axis]).toBeCloseTo(value, 5); });
      expect([...result.colors.subarray(sample.index * 4, sample.index * 4 + 4)]).toEqual(sample.color);
      const sh = result.sh.flatMap((band, degree) => {
        const stride = [12, 16, 24][degree]!;
        return [...new Uint8Array(band.buffer, sample.index * stride, [9, 15, 21][degree])];
      });
      expect(sh).toEqual(sample.sh);
    }
    const geometry = nativeDataToGeometry(result);
    expect(geometry.getAttribute("sphericalHarmonics3").itemSize).toBe(6);
    expect(geometry.boundingBox?.isEmpty()).toBe(false);
    expect(geometry.userData.nativeSplat).toEqual({ format: "sog", count: 3604, shDegree: 3 });
    geometry.dispose();
  });

  it.each([1, 2] as const)("decodes SOG v%i position, covariance, alpha and all declared SH bands", async (version) => {
    const source = fixture(version, true);
    const data = await decodeSogArchive(await archive(source.meta, source.images), source.decode);
    expect([...data.centers]).toEqual([1, 0, 0]);
    expect(data.covariances[0]).toBeCloseTo(1, 6);
    expect([...data.colors]).toEqual([128, 128, 128, version === 2 ? 17 : 128]);
    expect(data.sh).toHaveLength(1);
    expect([...new Uint8Array(data.sh[0]!.buffer).subarray(0, 3)]).toEqual(version === 2 ? [128, 128, 128] : [192, 64, 128]);
  });

  it("rejects unsafe archive references and unsupported counts before image decoding", async () => {
    const source = fixture(2);
    source.meta.count = 16_777_217;
    const decode = vi.fn(source.decode);
    await expect(decodeSogArchive(await archive(source.meta, source.images), decode)).rejects.toThrow("Splat count");
    expect(decode).not.toHaveBeenCalled();
    source.meta.count = 1;
    (source.meta.quats as { files: string[] }).files = ["../outside.webp"];
    await expect(decodeSogArchive(await archive(source.meta, source.images), decode)).rejects.toThrow("safe files");
  });

  it("rejects corrupt palettes, mismatched images and cancellation", async () => {
    const source = fixture(2, true);
    (source.meta.shN as { bands: number }).bands = 3;
    const bytes = await archive(source.meta, source.images);
    await expect(decodeSogArchive(bytes, source.decode)).rejects.toThrow("degree");
    await expect(decodeSogArchive(bytes, () => Promise.resolve({ width: 2, height: 1, data: new Uint8ClampedArray(8) }))).rejects.toThrow("dimensions");
    const controller = new AbortController(); controller.abort();
    await expect(decodeSogArchive(bytes, source.decode, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects lossy or oversized WebP before invoking libwebp", () => {
    const source = fixture(2);
    const bytes = new Uint8Array(source.images.get("lower.webp")!);
    bytes.set(new TextEncoder().encode("VP8 "), 12);
    expect(() => inspectSogWebp(bytes)).toThrow("lossless");
    bytes.set(new TextEncoder().encode("VP8L"), 12);
    new DataView(bytes.buffer).setUint32(21, 0x0fffffff, true);
    expect(() => inspectSogWebp(bytes)).toThrow("image size");
  });
});
