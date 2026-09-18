import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, OrthographicCamera, PerspectiveCamera, WebGPURenderer, type Camera } from "three/webgpu";
import { CountingSort } from "three/addons/gpgpu/CountingSort.js";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";

function sortDepths(depths: readonly number[], camera: Camera): number[] {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(depths.flatMap((depth) => [0, 0, -depth])), 3));
  geometry.setAttribute("covariance", new BufferAttribute(new Float32Array(depths.flatMap(() => [0.0001, 0, 0, 0.0001, 0, 0.0001])), 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8Array(depths.length * 4).fill(255), 4, true));
  const mesh = new GaussianSplat(geometry);
  // Constructing the native WebGL backend selects the actual CPU sorting path.
  // No renderer init/context/device or mocked sorting implementation is needed.
  const renderer = new WebGPURenderer({ forceWebGL: true });
  try {
    camera.updateMatrixWorld(true);
    expect(mesh.updateSort(renderer, camera)).toBe(true);
    if (!("_sort" in mesh) || !(mesh._sort instanceof CountingSort)) throw new Error("Native sort instance is missing");
    const order = Array.from(mesh._sort.orderAttribute.array);
    expect([...order].sort((a, b) => a - b)).toEqual(depths.map((_, index) => index));
    return order;
  } finally {
    mesh.dispose();
    geometry.dispose();
  }
}

describe("native Gaussian depth order with distant environment splats", () => {
  it("orders centimetre-separated room surfaces despite a kilometre-distant environment", () => {
    // Near surface is intentionally first in source order. A coarse shared bin
    // incorrectly retains that order, showing background color through walls.
    expect(sortDepths([5, 5.01, 1400], new PerspectiveCamera(60, 1, 0.1, 2000))).toEqual([2, 1, 0]);
  });

  it.each([
    { near: 0, depths: [0.001, 0.002, 1400], expected: [2, 1, 0] },
    { near: -10, depths: [-4.99, -4.98, 1400], expected: [2, 1, 0] },
    { near: -10, depths: [1000, 0.001, 500, -4, -3.99, 5.01, 5, 1e9], expected: [7, 0, 2, 5, 6, 1, 4, 3] },
  ])("keeps finite monotonic order for orthographic near=$near and extreme ranges", ({ near, depths, expected }) => {
    expect(sortDepths(depths, new OrthographicCamera(-2, 2, 2, -2, near, 2e9))).toEqual(expected);
  });
});
