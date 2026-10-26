// ---------------------------------------------------------------------------
// What draws the planner, asked before its canvas exists
//
// The desktop render profile is tuned on an RTX 4090. An office PC, or a
// laptop on its integrated graphics, would start on it too: occlusion with 12
// samples, temporal anti-aliasing and no pixel budget, and at a pixel ratio of
// 1 the frame-rate governor has no resolution left to give up (F-X4,
// planner-qol's CR, 26 Oct 2026). The browser's adapter says whose graphics
// draw (vendor, architecture); a browser without WebGPU draws through WebGL2,
// the slower path.
//
// The probe asks for an adapter as NativeCanvas does (high performance, so a
// laptop with two GPUs answers for the one that draws) and is read once, when
// the planner mounts. A profile chosen after the first frame would build and
// compile the scene twice, on the devices least able to afford it, so a probe
// still unanswered then leaves the device on the desktop profile.
// ---------------------------------------------------------------------------

export interface GpuAdapterFacts {
  readonly vendor: string;
  readonly architecture: string;
  readonly description: string;
  /** A software adapter (SwiftShader and its kind). */
  readonly fallback: boolean;
}

export type GpuReading =
  | { readonly api: "webgpu"; readonly adapter: GpuAdapterFacts }
  | { readonly api: "webgl2" }
  | { readonly api: "unknown" };

/** How long the probe waits for an adapter before leaving the device as it is, ms. */
export const GPU_PROBE_TIMEOUT_MS = 400;

/**
 * Intel's discrete cards: architectures ending in HPG ("high performance
 * graphics"), or an Arc card's model (A770, B580). "Intel(R) Arc(TM) Graphics"
 * without one is the integrated graphics of Meteor Lake and after (Xe-LPG).
 */
const INTEL_DISCRETE_ARCHITECTURE = /hpg|12hp|alchemist|battlemage/iu;
const INTEL_DISCRETE_MODEL = /\barc\b.*\b[ab]\d{3}\b/iu;
/** Adapter descriptions of integrated graphics, where the browser gives one ("Radeon Vega 8 Graphics" is an APU's). */
const INTEGRATED_DESCRIPTION = /intel.*(?:uhd|hd graphics|iris)|radeon\(tm\) graphics|radeon vega \d+ graphics/iu;

/**
 * Whether a desktop (a fine pointer) should start on the office profile:
 * integrated Intel graphics or AMD's integrated Radeon where the adapter names
 * it, a software adapter, or no WebGPU at all.
 */
export function isWeakDesktopGpu(reading: GpuReading): boolean {
  if (reading.api === "webgl2") return true;
  if (reading.api !== "webgpu") return false;
  const { vendor, architecture, description, fallback } = reading.adapter;
  if (fallback || INTEGRATED_DESCRIPTION.test(description)) return true;
  return /intel/iu.test(vendor) && !INTEL_DISCRETE_ARCHITECTURE.test(architecture) && !INTEL_DISCRETE_MODEL.test(description);
}

interface ProbeAdapter {
  readonly info?: { readonly vendor?: string; readonly architecture?: string; readonly description?: string; readonly isFallbackAdapter?: boolean };
  readonly isFallbackAdapter?: boolean;
}

interface ProbeGpu {
  requestAdapter(options: { powerPreference: "high-performance" }): Promise<ProbeAdapter | null>;
}

function isProbeGpu(value: unknown): value is ProbeGpu {
  return typeof value === "object" && value !== null && "requestAdapter" in value && typeof value.requestAdapter === "function";
}

const browserGpu = (): unknown => (typeof navigator === "undefined" ? undefined : (navigator as { readonly gpu?: unknown }).gpu);
const browserWebgl2 = (): boolean => typeof WebGL2RenderingContext !== "undefined";

/** Reads the browser's graphics: its adapter's facts, WebGL2 only, or unknown (no answer in time). */
export async function readGpu(gpu: unknown = browserGpu(), webgl2 = browserWebgl2(), timeoutMs = GPU_PROBE_TIMEOUT_MS): Promise<GpuReading> {
  if (!isProbeGpu(gpu)) return webgl2 ? { api: "webgl2" } : { api: "unknown" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => { timer = setTimeout(() => { resolve("late"); }, timeoutMs); });
  try {
    const adapter = await Promise.race([gpu.requestAdapter({ powerPreference: "high-performance" }), late]);
    if (adapter === "late") return { api: "unknown" };
    // No adapter: three falls back to WebGL2, where there is one.
    if (adapter === null) return webgl2 ? { api: "webgl2" } : { api: "unknown" };
    const info = adapter.info ?? {};
    return { api: "webgpu", adapter: {
      vendor: info.vendor ?? "", architecture: info.architecture ?? "", description: info.description ?? "",
      fallback: info.isFallbackAdapter === true || adapter.isFallbackAdapter === true,
    } };
  } catch {
    return { api: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

let settled: GpuReading | null = null;
let probing: Promise<GpuReading> | null = null;
const listeners = new Set<() => void>();

function settle(reading: GpuReading): GpuReading {
  settled = reading;
  for (const listener of [...listeners]) listener();
  return reading;
}

/**
 * Starts the probe once per page (repeat calls share it). Without WebGPU it
 * answers at once; otherwise within GPU_PROBE_TIMEOUT_MS.
 */
export function probeGpu(): Promise<GpuReading> {
  if (probing !== null) return probing;
  const gpu = browserGpu();
  probing = isProbeGpu(gpu)
    ? readGpu(gpu).then(settle)
    : Promise.resolve(settle(browserWebgl2() ? { api: "webgl2" } : { api: "unknown" }));
  return probing;
}

/** Whether the probe has answered: useSyncExternalStore's snapshot, with subscribeGpuProbe. */
export function gpuProbeSettled(): boolean {
  return settled !== null;
}

export function subscribeGpuProbe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The probe's answer if it has come, else unknown. */
export function gpuReading(): GpuReading {
  return settled ?? { api: "unknown" };
}

/** Tests: forget the page's probe. */
export function resetGpuProbeForTests(): void {
  settled = null;
  probing = null;
  listeners.clear();
}
