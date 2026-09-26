import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { validCpuSortParameters } from "./native-cpu-sort-protocol.js";

const BIN_COUNT = 65_536;

/** Stable native depth buckets, evaluated off the main thread without GPU-only
 * storage. Quantization and source order within equal buckets match CountingSort.
 * Only the completed exchange array transfers; retained positions/bins stay owned. */
export class NativeCpuSortKernel {
  private centers: Float32Array;
  private bins: Uint32Array;
  private counts = new Uint32Array(BIN_COUNT);
  private offsets = new Uint32Array(BIN_COUNT);
  private disposed = false;

  constructor(centers: Float32Array) {
    if (centers.length === 0 || centers.length % 3 !== 0 || !centers.every(Number.isFinite)) {
      throw new Error("Native sort positions are invalid");
    }
    this.centers = centers;
    this.bins = new Uint32Array(centers.length / 3);
  }

  compute(parameters: GaussianSplatCpuSortRequest, recycled?: Uint32Array): Uint32Array {
    if (this.disposed) throw new Error("Native sort kernel is disposed");
    if (!validCpuSortParameters(parameters)) throw new Error("Native sort camera parameters are invalid");
    const matrix = parameters.modelViewMatrix;
    const x = matrix[2] ?? 0, y = matrix[6] ?? 0, z = matrix[10] ?? 0, offset = matrix[14] ?? 0;
    const range = Math.max(parameters.farDepth - parameters.nearDepth, 0.0001);
    if (!Number.isFinite(range)) throw new Error("Native sort depth range is invalid");
    const scale = (parameters.binCount - 1) / Math.log1p(range);
    const nearDepth = parameters.nearDepth;
    const centers = this.centers, bins = this.bins, counts = this.counts, offsets = this.offsets;
    const count = bins.length;
    // The pool returns a trusted exchange, but the kernel must never scatter
    // through a caller-provided alias of positions or retained scratch storage.
    const output = recycled?.length === count && recycled.buffer !== centers.buffer
      && recycled.buffer !== bins.buffer && recycled.buffer !== counts.buffer && recycled.buffer !== offsets.buffer
      ? recycled : new Uint32Array(count);
    counts.fill(0);

    for (let index = 0; index < count; index++) {
      const position = index * 3;
      // Keep the existing floating-point operation order and log1p quantization.
      const depth = -(x * (centers[position] ?? 0) + y * (centers[position + 1] ?? 0)
        + z * (centers[position + 2] ?? 0) + offset);
      if (!Number.isFinite(depth)) throw new Error("Native sort computed depth is invalid");
      const bucket = Math.min(parameters.binCount - 1,
        Math.max(0, Math.floor(Math.log1p(Math.max(0, depth - nearDepth)) * scale)));
      const bin = parameters.binCount - 1 - bucket;
      bins[index] = bin;
      counts[bin] = (counts[bin] ?? 0) + 1;
    }

    let sum = 0;
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      offsets[bin] = sum;
      sum += counts[bin] ?? 0;
    }

    // Forward scatter preserves source order in every tied depth bucket. Write
    // directly into the exchange buffer instead of copying a second full order.
    for (let index = 0; index < count; index++) {
      const bin = bins[index] ?? 0;
      const destination = offsets[bin] ?? 0;
      output[destination] = index;
      offsets[bin] = destination + 1;
    }
    return output;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.centers = new Float32Array(0);
    this.bins = new Uint32Array(0);
    this.counts = new Uint32Array(0);
    this.offsets = new Uint32Array(0);
  }
}
