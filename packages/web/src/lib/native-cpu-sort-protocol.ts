import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";

export type NativeCpuSortCommand = {
  readonly type: "sort";
  readonly geometryId: number;
  readonly requestId: number;
  readonly parameters: GaussianSplatCpuSortRequest;
  readonly centers?: Float32Array;
  readonly recycle?: Uint32Array;
} | { readonly type: "drop"; readonly geometryId: number };

export type NativeCpuSortResponse = {
  readonly type: "sorted";
  readonly geometryId: number;
  readonly requestId: number;
  readonly order: Uint32Array;
} | {
  readonly type: "error";
  readonly geometryId: number;
  readonly requestId: number;
  readonly message: string;
};

/** A scene retains at most two draws and builds one replacement at a time. */
export const NATIVE_CPU_SORT_GEOMETRY_LIMIT = 3;
/** An unresponsive worker must fail the source instead of wedging its loading state. */
export const NATIVE_CPU_SORT_TIMEOUT_MS = 30_000;

export function validCpuSortParameters(value: GaussianSplatCpuSortRequest): boolean {
  return value.modelViewMatrix.length === 16 && value.modelViewMatrix.every(Number.isFinite)
    && Number.isFinite(value.nearDepth) && Number.isFinite(value.farDepth)
    && value.farDepth > value.nearDepth && value.binCount === 65_536;
}
