/** Regression coverage for the patched native addon.
 * Exercises actual addon/TSL behavior while intercepting GPU dispatch. Separate
 * browser readback, image-guard and timing receipts establish GPU correctness,
 * visual parity and performance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, ComputeNode, Group, PerspectiveCamera, StorageBufferAttribute, Vector3, WebGPURenderer } from "three/webgpu";
import { instanceIndex, uint } from "three/tsl";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { CountingSort } from "three/addons/gpgpu/CountingSort.js";


afterEach(() => { vi.restoreAllMocks(); });

function fixture(withSh = true) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([1, 2, -5]), 3));
  geometry.setAttribute("covariance", new BufferAttribute(new Float32Array([.1, 0, 0, .1, 0, .1]), 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8Array([128, 64, 32, 255]), 4, true));
  if (withSh) {
    geometry.setAttribute("sphericalHarmonics1", new BufferAttribute(new Uint32Array([0x89838185, 0x82808481, 0x89828081]), 3));
    geometry.setAttribute("sphericalHarmonics2", new BufferAttribute(new Uint32Array([0x89808182, 0x82888481, 0x84808281, 0x87838682]), 4));
    geometry.setAttribute("sphericalHarmonics3", new BufferAttribute(new Uint32Array([0x89808182, 0x82888481, 0x84808281, 0x87838682, 0x85868788, 0x81828384]), 6));
  }
  const mesh = new GaussianSplat(geometry, { autoSort: false });
  const camera = new PerspectiveCamera();
  camera.position.set(2, 3, 4);
  // The renderer is never initialized: dispatch interception avoids acquiring a
  // real GPU and still exercises the actual addon and TSL-node construction.
  const renderer = new WebGPURenderer();
  const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
  const update = (target = renderer): boolean => {
    mesh.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    return mesh.updateSphericalHarmonics(target, camera);
  };
  return { mesh, geometry, camera, renderer, compute, update,
    cleanup: () => { mesh.removeFromParent(); camera.removeFromParent(); mesh.dispose(); geometry.dispose(); } };
}

function localCameraInput(mesh: GaussianSplat): Vector3 {
  const uniform: unknown = Reflect.get(mesh, "_localCameraPosition");
  if (typeof uniform !== "object" || uniform === null) throw new Error("Missing SH camera uniform");
  const value: unknown = Reflect.get(uniform, "value");
  if (!(value instanceof Vector3)) throw new Error("Invalid SH camera uniform");
  return value.clone();
}

function expectExactLocalCamera(mesh: GaussianSplat, camera: PerspectiveCamera): void {
  const expected = mesh.worldToLocal(camera.getWorldPosition(new Vector3()));
  expect(localCameraInput(mesh).toArray()).toEqual(expected.toArray());
}

describe("native SH position invalidation", () => {
  it("computes once, then reuses SH for unchanged and orientation-only views", () => {
    const f = fixture();
    try {
      expect(f.update()).toBe(true);
      const firstInput = localCameraInput(f.mesh).toArray();
      expect(f.update()).toBe(false);
      for (const angles of [[.3, 1.2, -.2], [-.8, -2.1, 1.4], [0, 0, 0]]) {
        const [x = 0, y = 0, z = 0] = angles;
        f.camera.rotation.set(x, y, z);
        expect(f.update()).toBe(false);
        expect(localCameraInput(f.mesh).toArray()).toEqual(firstInput);
        expectExactLocalCamera(f.mesh, f.camera);
      }
      expect(f.compute).toHaveBeenCalledOnce();
    } finally { f.cleanup(); }
  });

  it.each(["x", "y", "z"] as const)("does not hide even a tiny camera %s translation", (axis) => {
    const f = fixture();
    try {
      expect(f.update()).toBe(true);
      const before = localCameraInput(f.mesh).toArray();
      f.camera.position[axis] += 1e-8;
      expect(f.update()).toBe(true);
      expect(localCameraInput(f.mesh).toArray()).not.toEqual(before);
      expectExactLocalCamera(f.mesh, f.camera);
      expect(f.update()).toBe(false);
      expect(f.compute).toHaveBeenCalledTimes(2);
    } finally { f.cleanup(); }
  });

  it("uses camera world position when a parent moves or rotates it", () => {
    const f = fixture();
    const parent = new Group(); parent.add(f.camera);
    try {
      expect(f.update()).toBe(true);
      parent.position.set(5, -2, 1);
      expect(f.update()).toBe(true);
      expectExactLocalCamera(f.mesh, f.camera);
      parent.rotation.set(.1, .4, -.2);
      expect(f.update()).toBe(true);
      expectExactLocalCamera(f.mesh, f.camera);
      f.camera.rotation.set(.4, -.2, .8);
      expect(f.update()).toBe(false);
      expect(f.compute).toHaveBeenCalledTimes(3);
    } finally { f.cleanup(); }
  });

  it("invalidates source translation, rotation, scale and ancestor transform", () => {
    const f = fixture();
    const parent = new Group(); parent.add(f.mesh);
    try {
      expect(f.update()).toBe(true);
      const changes: Array<() => void> = [
        () => { f.mesh.position.set(-2, 4, 1); },
        () => { f.mesh.rotation.set(.1, .2, .3); },
        () => { f.mesh.scale.set(.8, 1.2, 1.5); },
        () => { parent.rotation.y = .4; },
      ];
      for (const change of changes) {
        change();
        expect(f.update()).toBe(true);
        expectExactLocalCamera(f.mesh, f.camera);
        expect(f.update()).toBe(false);
      }
      f.camera.rotateY(.5);
      expect(f.update()).toBe(false);
      expect(f.compute).toHaveBeenCalledTimes(5);
    } finally { f.cleanup(); }
  });

  it("initializes SH for a different renderer and when returning to the first", () => {
    const f = fixture();
    const other = new WebGPURenderer();
    const otherCompute = vi.spyOn(other, "compute").mockImplementation(() => undefined);
    try {
      expect(f.update()).toBe(true);
      expect(f.update(other)).toBe(true);
      expectExactLocalCamera(f.mesh, f.camera);
      expect(f.update(other)).toBe(false);
      expect(f.update()).toBe(true);
      expect(f.compute).toHaveBeenCalledTimes(2);
      expect(otherCompute).toHaveBeenCalledOnce();
    } finally { f.cleanup(); }
  });

  it("keeps WebGL SH in the vertex path while preserving exact camera input", () => {
    const f = fixture();
    const webgl = new WebGPURenderer({ forceWebGL: true });
    const webglCompute = vi.spyOn(webgl, "compute").mockImplementation(() => { throw new Error("WebGL must not dispatch SH compute"); });
    try {
      expect(f.update()).toBe(true);
      expect(f.update(webgl)).toBe(false);
      expectExactLocalCamera(f.mesh, f.camera);
      f.camera.position.y += 2;
      expect(f.update(webgl)).toBe(false);
      expectExactLocalCamera(f.mesh, f.camera);
      const translated = localCameraInput(f.mesh).toArray();
      f.camera.rotateZ(.5);
      expect(f.update(webgl)).toBe(false);
      expect(localCameraInput(f.mesh).toArray()).toEqual(translated);
      expect(webglCompute).not.toHaveBeenCalled();
      expect(f.update()).toBe(true);
      expect(f.compute).toHaveBeenCalledTimes(2);
    } finally { f.cleanup(); }
  });

  it("does not dispatch SH for a source with no higher-order coefficients", () => {
    const f = fixture(false);
    try {
      expect(f.update()).toBe(false);
      f.camera.position.x += 1;
      expect(f.update()).toBe(false);
      expect(f.compute).not.toHaveBeenCalled();
    } finally { f.cleanup(); }
  });
});

function stableReference(keys: readonly number[]): number[] {
  return keys.map((_, index) => index).sort((a, b) => (keys[a] ?? 0) - (keys[b] ?? 0) || a - b);
}

function isComputeGroup(value: unknown): value is ComputeNode[] {
  return Array.isArray(value) && value.every((node: unknown) => node instanceof ComputeNode);
}

function prefixBuffers(sort: CountingSort): [StorageBufferAttribute, StorageBufferAttribute] {
  const totals: unknown = Reflect.get(sort, "_prefixBlockTotals");
  const offsets: unknown = Reflect.get(sort, "_prefixBlockOffsets");
  if (!(totals instanceof StorageBufferAttribute) || !(offsets instanceof StorageBufferAttribute)) {
    throw new Error("Accepted parallel prefix must own totals and offset storage");
  }
  return [totals, offsets];
}

describe("native CPU fallback remains a stable exact permutation", () => {
  it("retains boundary bins and equal-bin order across first and repeated sorts", () => {
    const sort = new CountingSort(5, { binCount: 65_536 });
    try {
      const first = [3, 1, 1, 65_535, 0];
      sort.computeCPU(index => first[index] ?? 0);
      expect(Array.from(sort.orderAttribute.array)).toEqual([4, 1, 2, 0, 3]);
      const order = sort.orderAttribute.array, version = sort.orderAttribute.version;
      const second = [0, 65_535, 65_535, 1, 1];
      sort.computeCPU(index => second[index] ?? 0);
      expect(Array.from(sort.orderAttribute.array)).toEqual([0, 3, 4, 1, 2]);
      expect(sort.orderAttribute.array).toBe(order);
      expect(sort.orderAttribute.version).toBeGreaterThan(version);
    } finally { sort.dispose(); }
  });

  it("matches an independent stable key/index sort after changed distributions", () => {
    const sort = new CountingSort(1003, { binCount: 65_536 });
    try {
      const distributions = [
        Array.from({ length: 1003 }, (_, index) => (Math.imul(index, 179) >>> 0) % 65_536),
        Array.from({ length: 1003 }, (_, index) => index % 3 === 0 ? 65_535 : index % 2),
        Array<number>(1003).fill(12),
      ];
      for (const keys of distributions) {
        sort.computeCPU(index => keys[index] ?? 0);
        expect(Array.from(sort.orderAttribute.array)).toEqual(stableReference(keys));
      }
    } finally { sort.dispose(); }
  });
});

describe("accepted batched GPU submission contract", () => {
  it("submits an ordered stable group, rebuilding it when the bin function changes", () => {
    const sort = new CountingSort(5, { binCount: 65_536 });
    const renderer = new WebGPURenderer();
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    try {
      sort.setBinNode(() => instanceIndex.mod(uint(65_536)));
      sort.compute(renderer); sort.compute(renderer);
      expect(compute).toHaveBeenCalledTimes(2);
      const first = compute.mock.calls[0]?.[0], repeated = compute.mock.calls[1]?.[0];
      if (!isComputeGroup(first)) throw new Error("Accepted batch must submit actual compute nodes in one group");
      expect(repeated).toBe(first);
      // The deliberate six-dispatch composition must retain storage visibility
      // boundaries: local prefix -> block totals -> offset add -> scatter.
      // Node order/lifetime are checked here; GPU readback proves scan output.
      const expectedStages = ["CountingSortReset", "CountingSortHistogram", "CountingSortPrefixBlocks", "CountingSortPrefixTotals", "CountingSortPrefixAdd", "CountingSortScatter"];
      expect(first.map(node => node.name)).toEqual(expectedStages);
      expect(first.map(node => node.count)).toEqual([65_536, 5, 256, 1, 65_536, 5]);
      sort.setBinNode(() => uint(65_535).sub(instanceIndex.mod(uint(65_536))));
      sort.compute(renderer); sort.compute(renderer);
      const changed = compute.mock.calls[2]?.[0], changedRepeated = compute.mock.calls[3]?.[0];
      if (!isComputeGroup(changed)) throw new Error("Rebuilt batch must submit actual compute nodes");
      expect(compute).toHaveBeenCalledTimes(4);
      expect(changed).not.toBe(first);
      expect(changedRepeated).toBe(changed);
      expect(changed.map(node => node.name)).toEqual(expectedStages);
      expect(changed.map(node => node.count)).toEqual([65_536, 5, 256, 1, 65_536, 5]);
      expect(changed[1]).not.toBe(first[1]);
    } finally { sort.dispose(); }
  });
});

describe("accepted parallel prefix resource lifecycle", () => {
  it.each([1, 255, 256, 257, 65_536])("owns and releases boundary-sized storage for %i bins before shader setup", (binCount) => {
    const sort = new CountingSort(5, { binCount });
    const [totals, offsets] = prefixBuffers(sort);
    const released = [vi.fn(), vi.fn()] as const;
    totals.addEventListener("dispose", released[0]);
    offsets.addEventListener("dispose", released[1]);
    try {
      const expectedBlocks = binCount <= 256 ? 1 : binCount === 257 ? 2 : 256;
      expect(totals.array).toBeInstanceOf(Uint32Array);
      expect(offsets.array).toBeInstanceOf(Uint32Array);
      expect(totals.count).toBe(expectedBlocks);
      expect(offsets.count).toBe(expectedBlocks);
      expect(totals.array.buffer).not.toBe(offsets.array.buffer);
      expect(totals.array.buffer).not.toBe(sort.orderAttribute.array.buffer);
      expect(offsets.array.buffer).not.toBe(sort.orderAttribute.array.buffer);
      sort.enableWebGLBuffers();
      const [retainedTotals, retainedOffsets] = prefixBuffers(sort);
      expect(retainedTotals).toBe(totals);
      expect(retainedOffsets).toBe(offsets);
    } finally { sort.dispose(); }
    released.forEach(listener => { expect(listener).toHaveBeenCalledOnce(); });
  });

  it("releases all constructed compute stages and both prefix buffers at disposal", () => {
    // 257 bins exercises the partial final block while constructing real TSL.
    // Dispatch is intercepted, so this checks ownership, not prefix arithmetic.
    const sort = new CountingSort(257, { binCount: 257 });
    const renderer = new WebGPURenderer();
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    const releasedBuffers = [vi.fn(), vi.fn()] as const;
    const [totals, offsets] = prefixBuffers(sort);
    totals.addEventListener("dispose", releasedBuffers[0]);
    offsets.addEventListener("dispose", releasedBuffers[1]);
    const releasedNodes: Array<ReturnType<typeof vi.fn>> = [];
    try {
      sort.setBinNode(() => instanceIndex.mod(uint(257)));
      sort.compute(renderer);
      const group = compute.mock.calls[0]?.[0];
      if (!isComputeGroup(group)) throw new Error("Accepted prefix/batch must submit actual compute nodes");
      expect(group.map(node => node.count)).toEqual([257, 257, 2, 1, 257, 257]);
      for (const node of group) {
        const listener = vi.fn();
        node.addEventListener("dispose", listener);
        releasedNodes.push(listener);
      }
    } finally { sort.dispose(); }
    expect(releasedNodes).toHaveLength(6);
    [...releasedNodes, ...releasedBuffers].forEach(listener => { expect(listener).toHaveBeenCalledOnce(); });
  });
});

describe("accepted lazy CPU scratch ownership", () => {
  it("allocates no fallback arrays until first CPU use, then reuses them exactly", () => {
    const sort = new CountingSort(1003, { binCount: 65_536 });
    const fields = ["_cpuBins", "_cpuCounts", "_cpuOffsets"] as const;
    const renderer = new WebGPURenderer();
    vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    const scratch = (): Uint32Array[] => fields.map(field => {
      const value: unknown = Reflect.get(sort, field);
      if (!(value instanceof Uint32Array)) throw new Error(`Missing allocated fallback scratch: ${field}`);
      return value;
    });
    try {
      for (const field of fields) expect(Reflect.get(sort, field)).toBeNull();
      sort.setBinNode(() => instanceIndex.mod(uint(65_536)));
      sort.compute(renderer);
      for (const field of fields) expect(Reflect.get(sort, field)).toBeNull();
      const first = Array.from({ length: 1003 }, (_, index) => (Math.imul(index, 179) >>> 0) % 65_536);
      sort.computeCPU(index => first[index] ?? 0);
      expect(Array.from(sort.orderAttribute.array)).toEqual(stableReference(first));
      const retained = scratch();
      expect(retained.map(array => array.length)).toEqual([1003, 65_536, 65_536]);
      // Explicit synchronous fallback after PBO activation uses the same owned
      // buffers; it neither transfers nor replaces the live output storage.
      sort.enableWebGLBuffers();
      const order = sort.orderAttribute.array;
      const reverse = first.map(key => 65_535 - key);
      sort.computeCPU(index => reverse[index] ?? 0);
      expect(Array.from(sort.orderAttribute.array)).toEqual(stableReference(reverse));
      expect(sort.orderAttribute.array).toBe(order);
      scratch().forEach((array, index) => { expect(array).toBe(retained[index]); });
    } finally { sort.dispose(); }
  });
});
