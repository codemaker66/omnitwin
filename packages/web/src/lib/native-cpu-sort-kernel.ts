import { CountingSort } from "three/addons/gpgpu/CountingSort.js";
import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { validCpuSortParameters } from "./native-cpu-sort-protocol.js";

/** The official native CPU counting sort, evaluated off the main thread. */
export class NativeCpuSortKernel {
  private readonly sort: CountingSort;

  constructor(private readonly centers: Float32Array) {
    if (centers.length === 0 || centers.length % 3 !== 0 || !centers.every(Number.isFinite)) {
      throw new Error("Native sort positions are invalid");
    }
    this.sort = new CountingSort(centers.length / 3, { binCount: 65_536 });
  }

  compute(parameters: GaussianSplatCpuSortRequest, recycled?: Uint32Array): Uint32Array {
    if (!validCpuSortParameters(parameters)) throw new Error("Native sort camera parameters are invalid");
    const matrix = parameters.modelViewMatrix;
    const x = matrix[2] ?? 0, y = matrix[6] ?? 0, z = matrix[10] ?? 0, offset = matrix[14] ?? 0;
    const range = Math.max(parameters.farDepth - parameters.nearDepth, 0.0001);
    const scale = (parameters.binCount - 1) / Math.log1p(range);
    this.sort.computeCPU((index: number) => {
      const position = index * 3;
      const depth = -(x * (this.centers[position] ?? 0) + y * (this.centers[position + 1] ?? 0)
        + z * (this.centers[position + 2] ?? 0) + offset);
      const bin = Math.min(parameters.binCount - 1,
        Math.max(0, Math.floor(Math.log1p(Math.max(0, depth - parameters.nearDepth)) * scale)));
      return parameters.binCount - 1 - bin;
    });
    // The native order buffer remains attached. Only this exchange buffer moves
    // between threads, and the main thread returns it after copying the result.
    const count = this.centers.length / 3;
    const output = recycled?.length === count ? recycled : new Uint32Array(count);
    output.set(this.sort.orderAttribute.array);
    return output;
  }

  dispose(): void { this.sort.dispose(); }
}
