import { NativeCpuSortKernel } from "./native-cpu-sort-kernel.js";
import { NATIVE_CPU_SORT_GEOMETRY_LIMIT, type NativeCpuSortCommand, type NativeCpuSortResponse } from "./native-cpu-sort-protocol.js";

const kernels = new Map<number, NativeCpuSortKernel>();
const scope = self;
scope.onmessage = (event: MessageEvent<NativeCpuSortCommand>): void => {
  const message = event.data;
  if (message.type === "drop") {
    kernels.get(message.geometryId)?.dispose();
    kernels.delete(message.geometryId);
    return;
  }
  try {
    let kernel = kernels.get(message.geometryId);
    if (kernel === undefined) {
      if (!(message.centers instanceof Float32Array) || kernels.size >= NATIVE_CPU_SORT_GEOMETRY_LIMIT) {
        throw new Error("Native sort geometry is missing or exceeds the resident limit");
      }
      kernel = new NativeCpuSortKernel(message.centers);
      kernels.set(message.geometryId, kernel);
    }
    const order = kernel.compute(message.parameters, message.recycle);
    const response: NativeCpuSortResponse = { type: "sorted", geometryId: message.geometryId, requestId: message.requestId, order };
    scope.postMessage(response, { transfer: [order.buffer] });
  } catch (reason: unknown) {
    const response: NativeCpuSortResponse = { type: "error", geometryId: message.geometryId,
      requestId: message.requestId, message: reason instanceof Error ? reason.message : String(reason) };
    scope.postMessage(response);
  }
};
