import { describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Matrix4, OrthographicCamera, StorageBufferAttribute, WebGPURenderer } from "three/webgpu";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { CountingSort } from "three/addons/gpgpu/CountingSort.js";
import { mergeNativeSplatSources, nativeSplatLargestStorageBuffer } from "../native-splat-merge.js";

function fixture(count: number, limit = Infinity) {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3), covariance = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (i % 5) * .1; positions[i * 3 + 2] = -5 - i * .01;
    covariance[i * 6] = .0001; covariance[i * 6 + 3] = .0001; covariance[i * 6 + 5] = .0001;
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("covariance", new BufferAttribute(covariance, 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true));
  for (const [degree, words] of [[1, 3], [2, 4], [3, 6]] as const) {
    // A nonzero-offset source view proves no assumption about ArrayBuffer start.
    const backing = new Uint32Array(count * words + 4).fill(0xdeadbeef);
    const values = backing.subarray(2, 2 + count * words);
    for (let i = 0; i < values.length; i++) values[i] = (Math.imul(i + 17 * degree, 2654435761) ^ 0x80808080) >>> 0;
    geometry.setAttribute(`sphericalHarmonics${String(degree)}`, new BufferAttribute(values, words));
  }
  const mesh = new GaussianSplat(geometry, { autoSort: false, maxStorageBufferBindingSize: limit });
  return { geometry, mesh, cleanup: () => { mesh.dispose(); geometry.dispose(); } };
}

function internal(mesh: GaussianSplat, key: string): unknown {
  const buffers: unknown = Reflect.get(mesh, "_buffers");
  if (typeof buffers !== "object" || buffers === null) throw new Error("Missing native storage buffers");
  return Reflect.get(buffers, key);
}

function attribute(mesh: GaussianSplat, key: string): StorageBufferAttribute {
  const result = internal(mesh, key);
  if (!(result instanceof StorageBufferAttribute)) throw new Error(`Missing storage attribute ${key}`);
  return result;
}

describe("exact contiguous SH3 storage ranges", () => {
  it.each([2, 3, 4, 7, 16, 17, 256, 257])("preserves all packed words and CPU backing for %i splats", (count) => {
    const f = fixture(count, count * 16);
    try {
      const source = f.geometry.getAttribute("sphericalHarmonics3").array;
      if (!(source instanceof Uint32Array)) throw new Error("Invalid fixture");
      const original = source.slice();
      const head = attribute(f.mesh, "sphericalHarmonics3Attribute").array;
      const tail = attribute(f.mesh, "sphericalHarmonics3TailAttribute").array;
      const split = Math.ceil(count / 2);
      expect(internal(f.mesh, "sphericalHarmonics3SplitCount")).toBe(split);
      expect(head.buffer).toBe(source.buffer); expect(tail.buffer).toBe(source.buffer);
      expect(head.byteOffset).toBe(source.byteOffset);
      expect(tail.byteOffset).toBe(source.byteOffset + split * 24);
      expect(head.byteLength + tail.byteLength).toBe(source.byteLength);
      expect(Math.max(head.byteLength, tail.byteLength)).toBeLessThanOrEqual(count * 16);
      for (let i = 0; i < count; i++) for (let word = 0; word < 6; word++) {
        const actual = i < split ? head[i * 6 + word] : tail[(i - split) * 6 + word];
        expect(actual).toBe(source[i * 6 + word]);
      }
      expect(source).toEqual(original);
      expect(f.mesh.geometry.instanceCount).toBe(count);
    } finally { f.cleanup(); }
  });

  it("keeps the original single binding when it fits or the backend is unrestricted", () => {
    for (const limit of [4 * 24, Infinity]) {
      const f = fixture(4, limit);
      try {
        expect(attribute(f.mesh, "sphericalHarmonics3Attribute").array).toBe(f.geometry.getAttribute("sphericalHarmonics3").array);
        expect(internal(f.mesh, "sphericalHarmonics3TailRead")).toBeUndefined();
        expect(internal(f.mesh, "sphericalHarmonics3SplitCount")).toBeUndefined();
      } finally { f.cleanup(); }
    }
  });

  it("disposes both independently uploaded range attributes exactly once without disposing source geometry", () => {
    const f = fixture(3, 48);
    const head = attribute(f.mesh, "sphericalHarmonics3Attribute"), tail = attribute(f.mesh, "sphericalHarmonics3TailAttribute");
    const headDisposed = vi.spyOn(head, "dispose"), tailDisposed = vi.spyOn(tail, "dispose"), sourceDisposed = vi.spyOn(f.geometry, "dispose");
    f.mesh.dispose(); f.mesh.dispose();
    expect(headDisposed).toHaveBeenCalledOnce(); expect(tailDisposed).toHaveBeenCalledOnce();
    expect(sourceDisposed).not.toHaveBeenCalled();
    expect(f.geometry.getAttribute("sphericalHarmonics3").array.byteLength).toBe(72);
    f.geometry.dispose();
  });

  it("enables both PBO ranges and preserves capture sort ownership in the WebGL fallback", () => {
    const f = fixture(3, 48);
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const camera = new OrthographicCamera(-2, 2, 2, -2, -10, 10), capture = camera.clone();
    capture.rotateY(Math.PI); camera.updateMatrixWorld(true); capture.updateMatrixWorld(true);
    f.mesh.updateMatrixWorld(true);
    try {
      expect(f.mesh.updateSphericalHarmonics(renderer, camera)).toBe(false);
      for (const name of ["sphericalHarmonics3Read", "sphericalHarmonics3TailRead"]) {
        const node = internal(f.mesh, name);
        if (typeof node !== "object" || node === null) throw new Error("Missing storage node");
        expect(Reflect.get(node, "isPBO")).toBe(true);
      }
      const sort: unknown = Reflect.get(f.mesh, "_sort");
      if (!(sort instanceof CountingSort)) throw new Error("Missing global sort");
      f.mesh.updateSort(renderer, camera);
      const order = sort.orderAttribute.array.slice();
      const head = attribute(f.mesh, "sphericalHarmonics3Attribute").array;
      const tail = attribute(f.mesh, "sphericalHarmonics3TailAttribute").array;
      expect(() => f.mesh.withSynchronousSort(renderer, capture, () => {
        expect(attribute(f.mesh, "sphericalHarmonics3Attribute").array).toBe(head);
        expect(attribute(f.mesh, "sphericalHarmonics3TailAttribute").array).toBe(tail);
        throw new Error("capture failed");
      })).toThrow("capture failed");
      expect(sort.orderAttribute.array).toEqual(order);
      expect(attribute(f.mesh, "sphericalHarmonics3Attribute").array).toBe(head);
      expect(attribute(f.mesh, "sphericalHarmonics3TailAttribute").array).toBe(tail);
    } finally { f.cleanup(); }
  });

  it("rejects a cap below complete center/covariance or indivisible one-splat storage", () => {
    expect(() => fixture(3, 47)).toThrow("binding size");
    expect(() => fixture(1, 16)).toThrow("binding size");
    for (const limit of [0, -1, NaN]) expect(() => fixture(2, limit)).toThrow("binding size");
  });
});

describe("native preflight mirrors the exact SH3 layout", () => {
  it("accepts a whole SH3 source whose old 24-byte binding exceeded the cap", () => {
    const f = fixture(4);
    try {
      const source = f.geometry.getAttribute("sphericalHarmonics3").array.slice();
      const merged = mergeNativeSplatSources([{ geometry: f.geometry, matrix: new Matrix4(), maxSh: 3 }], 64);
      expect(merged.geometry.getAttribute("position").count).toBe(4);
      expect(merged.geometry.getAttribute("sphericalHarmonics3").array).toEqual(source);
      merged.geometry.dispose();
      expect(() => mergeNativeSplatSources([{ geometry: f.geometry, matrix: new Matrix4(), maxSh: 3 }], 63)).toThrow("coarser complete capture level");
    } finally { f.cleanup(); }
  });

  it("proves the 128 MiB boundary arithmetically without allocating large test geometry", () => {
    const cap = 128 * 1024 * 1024;
    expect(nativeSplatLargestStorageBuffer(6_030_980, 3, null)).toBe(144_743_520);
    expect(nativeSplatLargestStorageBuffer(6_030_980, 3, cap)).toBe(96_495_680);
    expect(nativeSplatLargestStorageBuffer(8_388_608, 3, cap)).toBe(cap);
    expect(nativeSplatLargestStorageBuffer(8_388_609, 3, cap)).toBeGreaterThan(cap);
    expect(nativeSplatLargestStorageBuffer(1, 3, 16)).toBe(24);
    expect(nativeSplatLargestStorageBuffer(3, 3, 48)).toBe(48);
    expect(nativeSplatLargestStorageBuffer(3, 2, 48)).toBe(48);
  });
});
