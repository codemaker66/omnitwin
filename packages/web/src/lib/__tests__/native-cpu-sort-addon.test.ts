import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, OrthographicCamera, WebGPURenderer } from "three/webgpu";
import { CountingSort } from "three/addons/gpgpu/CountingSort.js";
import { GaussianSplat, type GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";

function fixture() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, -5, 0, 0, -7]), 3));
  geometry.setAttribute("covariance", new BufferAttribute(new Float32Array([0.0001, 0, 0, 0.0001, 0, 0.0001, 0.0001, 0, 0, 0.0001, 0, 0.0001]), 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8Array(8).fill(255), 4, true));
  const requests: GaussianSplatCpuSortRequest[] = [];
  const mesh = new GaussianSplat(geometry, { cpuSort: (request) => { requests.push(request); } });
  const renderer = new WebGPURenderer({ forceWebGL: true });
  const camera = new OrthographicCamera(-2, 2, 2, -2, -10, 10);
  const capture = camera.clone();
  capture.rotateY(Math.PI);
  camera.updateMatrixWorld(true);
  capture.updateMatrixWorld(true);
  if (!("_sort" in mesh) || !(mesh._sort instanceof CountingSort)) throw new Error("Native CountingSort is missing");
  const sort = mesh._sort;
  return { geometry, mesh, renderer, camera, capture, requests, sort, cleanup: () => { mesh.dispose(); geometry.dispose(); } };
}

describe("native addon CPU sort ownership", () => {
  it("dispatches immutable camera snapshots without synchronously sorting", () => {
    const f = fixture();
    try {
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(true);
      expect(f.requests).toHaveLength(1);
      const first = f.requests[0];
      if (first === undefined) throw new Error("Missing request");
      const original = [...first.modelViewMatrix];
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.modelViewMatrix)).toBe(true);
      expect(first.binCount).toBe(65_536);
      expect(Number.isFinite(first.nearDepth) && first.farDepth > first.nearDepth).toBe(true);
      expect(Array.from(f.sort.orderAttribute.array)).toEqual([0, 1]);
      expect(f.mesh.updateSort(f.renderer, f.capture)).toBe(true);
      expect(f.requests).toHaveLength(2);
      expect(first.modelViewMatrix).toEqual(original);
      expect(f.requests[1]?.modelViewMatrix).not.toEqual(original);
    } finally { f.cleanup(); }
  });

  it("copies completed order without detaching storage and dirties the WebGL PBO", () => {
    const f = fixture();
    try {
      const buffer = f.sort.orderAttribute.array;
      const version = f.sort.orderAttribute.version;
      const pbo = { needsUpdate: false };
      Object.defineProperty(f.sort.orderAttribute, "pbo", { configurable: true, value: pbo });
      const result = new Uint32Array([1, 0]);
      f.mesh.applySortOrder(result);
      result.fill(0);
      expect(f.sort.orderAttribute.array).toBe(buffer);
      expect(Array.from(buffer)).toEqual([1, 0]);
      expect(f.sort.orderAttribute.version).toBeGreaterThan(version);
      expect(pbo.needsUpdate).toBe(true);
      expect(() => { f.mesh.applySortOrder(new Uint32Array(1)); }).toThrow("splat count");
      expect(Array.from(buffer)).toEqual([1, 0]);
    } finally { f.cleanup(); }
  });

  it("draws the capture camera's order and restores main order and dispatch state", () => {
    const f = fixture();
    try {
      f.mesh.updateSort(f.renderer, f.camera);
      f.mesh.applySortOrder(new Uint32Array([1, 0]));
      const result = f.mesh.withSynchronousSort(f.renderer, f.capture, () => {
        expect(Array.from(f.sort.orderAttribute.array)).toEqual([0, 1]);
        expect(f.requests).toHaveLength(1);
        expect(f.mesh.updateSort(f.renderer, f.capture)).toBe(false);
        return "captured";
      });
      expect(result).toBe("captured");
      expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
      expect(f.mesh.updateSort(f.renderer, f.capture)).toBe(true);
      expect(f.requests).toHaveLength(2);
    } finally { f.cleanup(); }
  });

  it("preserves WebGL's padded backing while applying and restoring logical orders", () => {
    const f = fixture();
    try {
      f.mesh.updateSort(f.renderer, f.camera);
      // WebGL's PBO upload replaces the array with texture-sized storage;
      // attribute.count and CountingSort.count remain the logical point count.
      const padded = new Uint32Array([0, 1, 123, 456]);
      f.sort.orderAttribute.array = padded;
      expect(f.sort.orderAttribute.count).toBe(2);
      expect(f.sort.count).toBe(2);
      const pbo = { needsUpdate: false };
      Object.defineProperty(f.sort.orderAttribute, "pbo", { configurable: true, value: pbo });
      f.mesh.applySortOrder(new Uint32Array([1, 0]));
      expect(f.sort.orderAttribute.array).toBe(padded);
      expect(Array.from(padded)).toEqual([1, 0, 123, 456]);
      expect(pbo.needsUpdate).toBe(true);
      expect(() => { f.mesh.applySortOrder(new Uint32Array(4)); }).toThrow("splat count");
      f.mesh.withSynchronousSort(f.renderer, f.capture, () => {
        expect(Array.from(padded)).toEqual([0, 1, 123, 456]);
        pbo.needsUpdate = false;
      });
      expect(f.sort.orderAttribute.array).toBe(padded);
      expect(Array.from(padded)).toEqual([1, 0, 123, 456]);
      expect(pbo.needsUpdate).toBe(true);
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
    } finally { f.cleanup(); }
  });

  it("restores nested capture scopes and thrown draws", () => {
    const f = fixture();
    try {
      f.mesh.updateSort(f.renderer, f.camera);
      f.mesh.applySortOrder(new Uint32Array([1, 0]));
      expect(() => f.mesh.withSynchronousSort(f.renderer, f.capture, () => {
        expect(Array.from(f.sort.orderAttribute.array)).toEqual([0, 1]);
        f.mesh.withSynchronousSort(f.renderer, f.camera, () => {
          expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
        });
        expect(Array.from(f.sort.orderAttribute.array)).toEqual([0, 1]);
        throw new Error("capture draw failed");
      })).toThrow("capture draw failed");
      expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
      expect(f.requests).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("rejects asynchronous capture callbacks and restores main order immediately", async () => {
    const f = fixture();
    try {
      f.mesh.updateSort(f.renderer, f.camera);
      f.mesh.applySortOrder(new Uint32Array([1, 0]));
      expect(() => f.mesh.withSynchronousSort(f.renderer, f.capture, () => Promise.resolve())).toThrow("synchronous");
      expect(() => f.mesh.withSynchronousSort(f.renderer, f.capture, () => Promise.reject(new Error("async draw failed")))).toThrow("synchronous");
      await Promise.resolve();
      expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
    } finally { f.cleanup(); }
  });

  it("keeps its camera direction when a dispatcher sorts another mesh reentrantly", () => {
    const f = fixture(), other = fixture();
    try {
      f.mesh.cpuSort = (request) => {
        f.requests.push(request);
        other.mesh.updateSort(other.renderer, other.capture);
      };
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(true);
      expect(other.requests).toHaveLength(1);
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
      expect(f.requests).toHaveLength(1);
    } finally { f.cleanup(); other.cleanup(); }
  });

  it("updates a newly posed capture camera before its first synchronous sort", () => {
    const f = fixture();
    try {
      f.mesh.updateSort(f.renderer, f.camera);
      f.mesh.applySortOrder(new Uint32Array([1, 0]));
      f.capture.rotateY(Math.PI);
      f.mesh.withSynchronousSort(f.renderer, f.capture, () => {
        expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
      });
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(false);
    } finally { f.cleanup(); }
  });

  it("keeps default synchronous sorting and rejects updates after disposal", () => {
    const f = fixture();
    try {
      f.mesh.cpuSort = null;
      expect(f.mesh.updateSort(f.renderer, f.camera)).toBe(true);
      expect(Array.from(f.sort.orderAttribute.array)).toEqual([1, 0]);
      expect(f.requests).toHaveLength(0);
      f.mesh.dispose();
      expect(() => { f.mesh.applySortOrder(new Uint32Array([0, 1])); }).toThrow("disposal");
      expect(() => { f.mesh.withSynchronousSort(f.renderer, f.capture, () => undefined); }).toThrow("disposal");
    } finally { f.cleanup(); }
  });

  it("leaves WebGPU capture dispatch alone", () => {
    const f = fixture();
    try {
      const renderer = new WebGPURenderer();
      expect(f.mesh.withSynchronousSort(renderer, f.capture, () => "drawn")).toBe("drawn");
      expect(f.requests).toHaveLength(0);
    } finally { f.cleanup(); }
  });
});
