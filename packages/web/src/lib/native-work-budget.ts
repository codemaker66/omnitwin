/** Scheduling limits only. These never change source points, SH, pixels or lighting. */
export interface NativeDeviceCapabilities {
  readonly logicalCores?: number;
  /** Browser-reported approximate memory, not physical RAM or available memory. */
  readonly memoryGiB?: number;
  /** Primary input characteristics, never a physical performance/device class. */
  readonly primaryCoarsePointer?: boolean;
  readonly primaryHover?: boolean;
}

export interface NativeWorkBudget {
  readonly decodeWorkers: 1 | 2;
  readonly reason: "limited-memory" | "limited-cpu" | "touch-memory-unknown" | "balanced";
}

/** Leave capacity for input, rendering and the scene's independent sort worker.
 * Unknown capabilities retain two workers except the explicit touch/no-hover,
 * <=6 reported-processor, unknown-memory fallback. This bounds overlapping
 * decoder allocations without inferring physical RAM or performance from input.
 * Jobs include fetch as well as decode: one worker can lengthen complete-load
 * time. Every selected source still loads with identical data and rendering.
 */
export function nativeWorkBudget(capabilities: NativeDeviceCapabilities): NativeWorkBudget {
  const memory = capabilities.memoryGiB;
  const knownMemory = memory !== undefined && Number.isFinite(memory) && memory > 0;
  if (knownMemory && memory <= 4) {
    return { decodeWorkers: 1, reason: "limited-memory" };
  }
  const cores = capabilities.logicalCores;
  const knownCores = cores !== undefined && Number.isSafeInteger(cores) && cores > 0;
  if (knownCores && cores <= 4) {
    return { decodeWorkers: 1, reason: "limited-cpu" };
  }
  if (!knownMemory && knownCores && cores <= 6
    && capabilities.primaryCoarsePointer === true && capabilities.primaryHover === false) {
    return { decodeWorkers: 1, reason: "touch-memory-unknown" };
  }
  return { decodeWorkers: 2, reason: "balanced" };
}

export function browserNativeWorkBudget(): NativeWorkBudget {
  if (typeof navigator === "undefined") return nativeWorkBudget({});
  const memory: unknown = "deviceMemory" in navigator ? navigator.deviceMemory : undefined;
  const capabilities: NativeDeviceCapabilities = {
    logicalCores: navigator.hardwareConcurrency,
    ...(typeof memory === "number" ? { memoryGiB: memory } : {}),
  };
  const budget = nativeWorkBudget(capabilities);
  // Most devices need no media-query work. Only this bounded fallback uses
  // interaction hints, and missing/unsupported queries must remain unknown.
  if (budget.decodeWorkers === 1 || (typeof memory === "number" && Number.isFinite(memory) && memory > 0)
    || !Number.isSafeInteger(capabilities.logicalCores) || (capabilities.logicalCores ?? 0) <= 4 || (capabilities.logicalCores ?? 0) > 6
    || typeof window === "undefined" || typeof window.matchMedia !== "function") return budget;
  try {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    if (!coarse || !noHover) return budget;
    return nativeWorkBudget({ ...capabilities, primaryCoarsePointer: true, primaryHover: false });
  } catch {
    return budget;
  }
}
