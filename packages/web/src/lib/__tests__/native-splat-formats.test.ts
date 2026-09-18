import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DataUtils } from "three";
import { decodeNativePly, decodeNativeSplatBuffer, decodeSplatRecords } from "../native-splat-decode.js";
import { decodeKsplat } from "../native-splat-ksplat.js";

function ply(count: number): ArrayBuffer {
  const names = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", ...Array.from({ length: 45 }, (_, i) => `f_rest_${String(i)}`), "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${String(count)}\n${names.map((name) => `property float ${name}\n`).join("")}end_header\n`);
  const bytes = new Uint8Array(header.length + count * names.length * 4); bytes.set(header);
  const view = new DataView(bytes.buffer);
  for (let row = 0; row < count; row++) names.forEach((name, column) => {
    const value = name === "x" ? row : name === "rot_0" ? 1 : name.startsWith("f_rest") ? column / 100 : 0;
    view.setFloat32(header.length + (row * names.length + column) * 4, value, true);
  });
  return bytes.buffer;
}

function ksplat(compression: 0 | 1 | 2): ArrayBuffer {
  const scalarBytes = compression === 0 ? 4 : 2, shBytes = compression === 0 ? 4 : compression === 1 ? 2 : 1;
  const bucketBytes = compression === 0 ? 0 : 12;
  const bytes = new Uint8Array(5120 + bucketBytes + scalarBytes * 10 + 4 + 45 * shBytes), view = new DataView(bytes.buffer);
  bytes[1] = 1; view.setUint32(4, 1, true); view.setUint32(8, 1, true); view.setUint32(12, 1, true); view.setUint32(16, 1, true); view.setUint16(20, compression, true);
  view.setFloat32(36, -.5, true); view.setFloat32(40, .5, true);
  view.setUint32(4096, 1, true); view.setUint32(4100, 1, true); view.setUint16(4136, 3, true);
  if (compression > 0) {
    view.setUint32(4104, 1, true); view.setUint32(4108, 1, true); view.setFloat32(4112, 2, true); view.setUint16(4116, 12, true); view.setUint32(4120, 32767, true); view.setUint32(4128, 1, true);
    [1, 2, 3].forEach((value, axis) => { view.setFloat32(5120 + axis * 4, value, true); });
  }
  const base = 5120 + bucketBytes;
  for (let axis = 0; axis < 3; axis++) {
    if (compression === 0) view.setFloat32(base + axis * 4, axis + 1, true);
    else view.setUint16(base + axis * 2, 32767, true);
  }
  for (let slot = 3; slot < 10; slot++) {
    const value = slot < 7 ? 1 : 0;
    if (compression === 0) view.setFloat32(base + slot * 4, value, true);
    else view.setUint16(base + slot * 2, DataUtils.toHalfFloat(value), true);
  }
  bytes.set([19, 23, 71, 17], base + scalarBytes * 10);
  for (let coefficient = 0; coefficient < 45; coefficient++) {
    const offset = base + scalarBytes * 10 + 4 + coefficient * shBytes;
    if (compression === 0) view.setFloat32(offset, coefficient / 100, true);
    else if (compression === 1) view.setUint16(offset, DataUtils.toHalfFloat(coefficient / 100), true);
    else bytes[offset] = coefficient;
  }
  return bytes.buffer;
}

describe("native source format adapters", () => {
  it("assembles chunked official PLY conversion without changing any native attributes", () => {
    const bytes = ply(3), ordinary = decodeNativePly(bytes), chunked = decodeNativePly(bytes, 2);
    expect(chunked).toEqual(ordinary);
    expect(chunked.sh).toHaveLength(3);
    expect([...chunked.centers]).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(() => decodeNativePly(bytes.slice(0, -1), 2)).toThrow("payload length");
  });

  it("decodes conventional 32-byte SPLAT records and rejects invalid scale/data", () => {
    const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
    [1, 2, 3, 1, 2, 3].forEach((value, axis) => { view.setFloat32(axis * 4, value, true); });
    bytes.set([10, 20, 30, 17, 255, 128, 128, 128], 24);
    const decoded = decodeSplatRecords(bytes.buffer);
    expect([...decoded.centers]).toEqual([1, 2, 3]);
    expect([...decoded.covariances]).toEqual([1, 0, 0, 4, 0, 9]);
    expect([...decoded.colors]).toEqual([10, 20, 30, 17]);
    view.setFloat32(12, -1, true);
    expect(() => decodeSplatRecords(bytes.buffer)).toThrow("scale");
    expect(() => decodeSplatRecords(new ArrayBuffer(31))).toThrow("multiple");
  });

  it.each([0, 1, 2] as const)("decodes KSPLAT compression %i with three complete SH bands", (compression) => {
    const source = ksplat(compression), decoded = decodeKsplat(source);
    expect([...decoded.centers]).toEqual([1, 2, 3]);
    expect([...decoded.covariances]).toEqual([1, 0, 0, 1, 0, 1]);
    expect([...decoded.colors]).toEqual([19, 23, 71, 17]);
    expect(decoded.sh.map((band) => band.length)).toEqual([3, 4, 6]);
    const band3 = new Uint8Array(decoded.sh[2]!.buffer);
    // Degree3 storage starts at24 and stores7 coefficients for each RGB channel.
    const expected = [24, 31, 38].map((value) => new Uint8ClampedArray([(compression === 2 ? -.5 + value / 255 : compression === 1 ? DataUtils.fromHalfFloat(DataUtils.toHalfFloat(value / 100)) : Math.fround(value / 100)) * 128 + 128])[0]);
    expect([...band3.subarray(0, 3)]).toEqual(expected);
    expect(() => decodeKsplat(source.slice(0, -1))).toThrow("Truncated");
  });

  it("loads SPZ with the official native converter and rejects legacy RAD explicitly", async () => {
    const bytes = new Uint8Array(36), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x5053474e, true); view.setUint32(4, 2, true); view.setUint32(8, 1, true); bytes[13] = 3;
    bytes.set([8, 0, 0, 16, 0, 0, 24, 0, 0, 127, 128, 128, 128, 160, 160, 160, 128, 128, 128], 16);
    // v2:16-byte header +9 position +1 alpha +3 RGB +3scale +3rotation.
    const compressed = gzipSync(bytes.subarray(0, 35));
    const result = await decodeNativeSplatBuffer(new Uint8Array(compressed).buffer, "/real.spz");
    expect([...result.centers]).toEqual([1, 2, 3]);
    expect(result.format).toBe("spz");
    await expect(decodeNativeSplatBuffer(new ArrayBuffer(8), "/tree.rad")).rejects.toThrow("original SOG");
  });
});
