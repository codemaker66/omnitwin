import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { CountingSort } from "three/addons/gpgpu/CountingSort.js";
import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { NativeCpuSortKernel } from "../native-cpu-sort-kernel.js";

const BIN_COUNT = 65_536;

function request(overrides: Partial<GaussianSplatCpuSortRequest> = {}): GaussianSplatCpuSortRequest {
  return { modelViewMatrix: new Matrix4().elements, nearDepth: 0.1, farDepth: 1401, binCount: BIN_COUNT, ...overrides };
}

/** Actual pinned addon CPU sort with the existing native kernel's depth key.
 * This reference retains its own histogram, exclusive scan and stable scatter. */
function reference(centers: Float32Array, parameters: GaussianSplatCpuSortRequest): Uint32Array {
  const sort = new CountingSort(centers.length / 3, { binCount: BIN_COUNT });
  const matrix = parameters.modelViewMatrix;
  const x = matrix[2] ?? 0, y = matrix[6] ?? 0, z = matrix[10] ?? 0, offset = matrix[14] ?? 0;
  const scale = (parameters.binCount - 1) / Math.log1p(Math.max(parameters.farDepth - parameters.nearDepth, 0.0001));
  try {
    sort.computeCPU((index: number) => {
      const position = index * 3;
      const depth = -(x * (centers[position] ?? 0) + y * (centers[position + 1] ?? 0)
        + z * (centers[position + 2] ?? 0) + offset);
      const bin = Math.min(parameters.binCount - 1,
        Math.max(0, Math.floor(Math.log1p(Math.max(0, depth - parameters.nearDepth)) * scale)));
      return parameters.binCount - 1 - bin;
    });
    return new Uint32Array(sort.orderAttribute.array);
  } finally { sort.dispose(); }
}

function positions(depths: readonly number[]): Float32Array {
  return Float32Array.from(depths.flatMap((depth) => [0, 0, -depth]));
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}

function expectPermutation(order: Uint32Array): void {
  const seen = new Uint8Array(order.length);
  for (const index of order) {
    expect(index).toBeLessThan(order.length);
    expect(seen[index]).toBe(0);
    seen[index] = 1;
  }
  expect(seen.every((value) => value === 1)).toBe(true);
}

describe("direct native CPU sort is equivalent to the pinned addon", () => {
  it.each([1, 2, 255, 256, 257, 4099, 65_537])("matches the complete stable permutation for %i seeded splats across camera changes", (count) => {
    const random = generator(0x87362 + count);
    const centers = Float32Array.from({ length: count * 3 }, () => (random() - 0.5) * 3000);
    const source = centers.slice();
    const kernel = new NativeCpuSortKernel(centers);
    let recycle = new Uint32Array(count);
    try {
      for (let view = 0; view < 5; view++) {
        const camera = new Matrix4().compose(
          new Vector3((random() - .5) * 20, (random() - .5) * 20, (random() - .5) * 20),
          new Quaternion().setFromEuler(new Euler(random() * 4, random() * 4, random() * 4)),
          new Vector3(1, 1, 1),
        ).invert();
        const parameters = request({ modelViewMatrix: camera.elements, nearDepth: view % 2 ? -1600 : .1, farDepth: 1700 });
        const actual = kernel.compute(parameters, recycle);
        expect(actual).toBe(recycle);
        expect(actual).toEqual(reference(centers, parameters));
        expect(centers).toEqual(source);
        recycle = actual;
      }
      expectPermutation(recycle);
    } finally { kernel.dispose(); }
  });

  it("keeps original source order when every splat shares a bucket", () => {
    const centers = positions(Array.from({ length: 513 }, () => 5.25));
    const kernel = new NativeCpuSortKernel(centers);
    try {
      expect(kernel.compute(request())).toEqual(Uint32Array.from({ length: 513 }, (_, i) => i));
    } finally { kernel.dispose(); }
  });

  it("keeps stable ties at both clamped ends and exact near/far bounds", () => {
    const centers = positions([0, .5, 1, 2, 100, 101, 150, 2, 0, 100]);
    const parameters = request({ nearDepth: 1, farDepth: 100 });
    const kernel = new NativeCpuSortKernel(centers);
    try {
      const order = kernel.compute(parameters);
      expect(order).toEqual(new Uint32Array([4, 5, 6, 9, 3, 7, 0, 1, 2, 8]));
      expect(order).toEqual(reference(centers, parameters));
    } finally { kernel.dispose(); }
  });

  it("matches negative orthographic near depths and the minimum depth span", () => {
    const sets = [
      { centers: positions([-20, -10, -9.9, 0, 10, 1400, -10]), parameters: request({ nearDepth: -10, farDepth: 1401 }) },
      { centers: positions([-.001, 0, 1e-8, 1e-7, 1e-6, 1e-5, .001]), parameters: request({ nearDepth: 0, farDepth: 1e-7 }) },
    ];
    for (const { centers, parameters } of sets) {
      const kernel = new NativeCpuSortKernel(centers);
      try { const actual = kernel.compute(parameters); expect(actual).toEqual(reference(centers, parameters)); expectPermutation(actual); }
      finally { kernel.dispose(); }
    }
  });

  it("matches values on both sides of log bucket boundaries after Float32 source rounding", () => {
    const nearDepth = -4, farDepth = 1500, scale = (BIN_COUNT - 1) / Math.log1p(farDepth - nearDepth);
    const depths = [0, 1, 2, 127, 255, 256, 1024, 32767, 65534, 65535].flatMap((bucket) => {
      const depth = Math.expm1(bucket / scale) + nearDepth;
      const epsilon = Math.max(1e-7, Math.abs(depth) * 1e-6);
      return [depth + epsilon, depth, depth - epsilon, depth];
    });
    const centers = positions(depths), parameters = request({ nearDepth, farDepth });
    const kernel = new NativeCpuSortKernel(centers);
    try { const actual = kernel.compute(parameters); expect(actual).toEqual(reference(centers, parameters)); expectPermutation(actual); }
    finally { kernel.dispose(); }
  });

  it("recycles an offset exchange view without modifying its surrounding bytes", () => {
    const centers = positions([2, 4, 1, 3]);
    const storage = new Uint32Array([777, 0, 0, 0, 0, 888]), exchange = storage.subarray(1, 5);
    const kernel = new NativeCpuSortKernel(centers);
    try {
      expect(kernel.compute(request(), exchange)).toBe(exchange);
      expect(storage).toEqual(new Uint32Array([777, 1, 3, 0, 2, 888]));
      const fresh = kernel.compute(request(), new Uint32Array(3));
      expect(fresh).toEqual(exchange);
      expect(fresh).not.toBe(exchange);
    } finally { kernel.dispose(); }
  });

  it("retains no reference to transferred exchange storage and supports its round trip", () => {
    const centers = positions([2, 4, 1, 3]), original = centers.slice();
    const kernel = new NativeCpuSortKernel(centers);
    try {
      const first = kernel.compute(request());
      const transferred = structuredClone(first, { transfer: [first.buffer] });
      expect(first.byteLength).toBe(0);
      const turned = request({ modelViewMatrix: new Matrix4().makeRotationY(Math.PI).elements });
      const next = kernel.compute(turned, transferred);
      expect(next).toBe(transferred);
      expect(next).toEqual(reference(centers, turned));
      expect(centers).toEqual(original);
    } finally { kernel.dispose(); }
  });

  it("does not scatter through a recycled view aliasing retained source positions", () => {
    const centers = positions([2, 4, 1, 3]), source = centers.slice();
    const alias = new Uint32Array(centers.buffer, 0, 4), kernel = new NativeCpuSortKernel(centers);
    try {
      const actual = kernel.compute(request(), alias);
      expect(actual.buffer).not.toBe(centers.buffer);
      expect(actual).toEqual(reference(centers, request()));
      expect(centers).toEqual(source);
    } finally { kernel.dispose(); }
  });

  it("rejects overflowed computed ranges and depths before touching exchange storage", () => {
    const centers = positions([1, 2]), kernel = new NativeCpuSortKernel(centers);
    const exchange = new Uint32Array([777, 888]);
    try {
      expect(() => kernel.compute(request({ nearDepth: -Number.MAX_VALUE, farDepth: Number.MAX_VALUE }), exchange)).toThrow(/depth range/);
      const matrix = new Matrix4().elements;
      matrix[10] = Number.MAX_VALUE;
      expect(() => kernel.compute(request({ modelViewMatrix: matrix }), exchange)).toThrow(/computed depth/);
      expect(exchange).toEqual(new Uint32Array([777, 888]));
      expect(kernel.compute(request(), exchange)).toEqual(reference(centers, request()));
    } finally { kernel.dispose(); }
  });

  it("does not retain histogram offsets or overwrite earlier nonrecycled results", () => {
    const centers = positions([2, 4, 1, 3]), kernel = new NativeCpuSortKernel(centers);
    try {
      const first = kernel.compute(request()), saved = first.slice();
      const opposite = request({ modelViewMatrix: new Matrix4().makeRotationY(Math.PI).elements, nearDepth: -10 });
      expect(kernel.compute(opposite)).toEqual(reference(centers, opposite));
      expect(kernel.compute(request())).toEqual(saved);
      expect(first).toEqual(saved);
    } finally { kernel.dispose(); }
  });

  it("rejects malformed geometry and camera inputs before sorting", () => {
    for (const bad of [new Float32Array(), new Float32Array(4), new Float32Array([NaN, 0, 0]), new Float32Array([0, Infinity, 0])]) {
      expect(() => new NativeCpuSortKernel(bad)).toThrow(/positions/);
    }
    const kernel = new NativeCpuSortKernel(positions([1]));
    try {
      for (const bad of [request({ farDepth: Infinity }), request({ nearDepth: 5, farDepth: 5 }), request({ binCount: 4096 }), request({ modelViewMatrix: [1, 2] }), request({ modelViewMatrix: Array<number>(16).fill(NaN) })]) {
        expect(() => kernel.compute(bad)).toThrow(/parameters/);
      }
    } finally { kernel.dispose(); }
  });

  it("disposes idempotently and cannot sort released worker geometry", () => {
    const centers = positions([1, 2, 3]), kernel = new NativeCpuSortKernel(centers);
    kernel.compute(request());
    kernel.dispose(); kernel.dispose();
    expect(() => kernel.compute(request())).toThrow(/disposed/);
    expect(centers).toEqual(positions([1, 2, 3]));
  });
});
