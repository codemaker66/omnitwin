import { useDeviceStore } from "../stores/device-store.js";
import { usePerfStore } from "../stores/perf-store.js";
import { RollingFrameProfiler, type RenderedFrameSample } from "./perf-profiler.js";

let profiler: RollingFrameProfiler | null = null;
let generation = -1;
let foreground = true;
interface RegisteredRenderer { readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly backend: string }
const renderers = new Map<object, RegisteredRenderer>();
let activeRenderer: object | null = null;

/** NativeCanvas registers on readiness and releases on disposal. Selection is
 * outside the draw hot path; small preview canvases cannot contaminate the main
 * view. A route/backend replacement always starts a fresh measurement window. */
export function registerProfilerRenderer(renderer: object, canvas: HTMLCanvasElement | OffscreenCanvas, backend: string): () => void {
  renderers.set(renderer, { canvas, backend });
  selectProfilerRenderer();
  return () => {
    renderers.delete(renderer);
    selectProfilerRenderer();
  };
}

function selectProfilerRenderer(): void {
  let selected: object | null = null;
  let largest = 0;
  for (const [renderer, { canvas }] of renderers) {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) continue;
    const bounds = canvas.getBoundingClientRect();
    const area = Math.max(0, Math.min(bounds.right, window.innerWidth) - Math.max(0, bounds.left))
      * Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(0, bounds.top));
    if (area <= largest) continue;
    const style = getComputedStyle(canvas);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    selected = renderer;
    largest = area;
  }
  if (activeRenderer === selected) return;
  activeRenderer = selected;
  usePerfStore.getState().reset();
}

/** Cheap gate for the native draw owner. Disabled profiling does no timing,
 * renderer inspection, timestamp queries, or history allocation. */
export function shouldProfileFrames(renderer?: object): boolean {
  const state = usePerfStore.getState();
  return state.visible && !state.paused && foreground
    && (typeof document === "undefined" || document.visibilityState !== "hidden")
    && (renderer === undefined || renderer === activeRenderer);
}

function currentProfiler(now: number): RollingFrameProfiler {
  const state = usePerfStore.getState();
  profiler ??= new RollingFrameProfiler();
  if (generation !== state.generation) {
    generation = state.generation;
    profiler.reset(now);
  }
  return profiler;
}

/** Called only after a successful main render; skipped pacing callbacks and
 * offscreen/export renders must never call this function. */
export function recordRenderedFrame(sample: RenderedFrameSample, renderer?: object): void {
  if (!shouldProfileFrames(renderer)) return;
  currentProfiler(sample.timestampMs).record(sample);
}

/** Wall-clock refresh continues while an open profiler's scene is idle, so old
 * frames age out and FPS cannot remain stuck at a previous moving value. */
export function refreshProfiler(now = performance.now()): void {
  if (!shouldProfileFrames()) return;
  selectProfilerRenderer();
  usePerfStore.getState().update(currentProfiler(now).snapshot(now, useDeviceStore.getState().tier, jsHeapMb()));
}

/** Hidden-tab time never becomes a spurious slow frame on return. Resuming
 * deliberately starts a fresh window, as do Play, Reset and reopening. */
export function setProfilerForeground(value: boolean): void {
  if (foreground === value) return;
  foreground = value;
  if (value && usePerfStore.getState().visible && !usePerfStore.getState().paused) {
    usePerfStore.getState().reset();
  }
}

interface TimestampPool {
  readonly queryOffsets: Map<unknown, unknown>;
  readonly timestamps: Map<unknown, unknown>;
}
interface TimestampBackend {
  trackTimestamp: boolean;
  readonly hasTimestamp: boolean;
  readonly timestampQueryPool: object;
  resolveTimestampsAsync(type: "render" | "compute"): Promise<unknown>;
}

interface GpuOwner { pending: boolean; sampledAt: number }
const gpuOwners = new WeakMap<object, GpuOwner>();
interface EnabledGpuFeatures { has(feature: string): unknown }
function isEnabledGpuFeatures(value: unknown): value is EnabledGpuFeatures {
  return typeof value === "object" && value !== null
    && "has" in value && typeof value.has === "function";
}

/** Opaque token: the native owner must finish it even if its draw fails. */
export interface GpuProfileToken {
  readonly backend: TimestampBackend;
  readonly owner: GpuOwner;
  readonly generation: number;
  readonly timestampMs: number;
}

function timestampBackend(renderer: unknown): TimestampBackend | null {
  if (typeof renderer !== "object" || renderer === null || !("backend" in renderer)) return null;
  const backend: unknown = renderer.backend;
  if (typeof backend !== "object" || backend === null
    // Three r186's WebGL query pool substitutes lastValue under a fresh UID
    // after disjoint/context-loss/query errors. It exposes no validity flag,
    // so only WebGPU timings can be reported honestly through this API.
    || !("isWebGPUBackend" in backend) || backend.isWebGPUBackend !== true
    || !("trackTimestamp" in backend) || typeof backend.trackTimestamp !== "boolean"
    || !("hasTimestamp" in backend) || backend.hasTimestamp !== true
    || !("timestampQueryPool" in backend) || typeof backend.timestampQueryPool !== "object" || backend.timestampQueryPool === null
    || !("resolveTimestampsAsync" in backend) || typeof backend.resolveTimestampsAsync !== "function") return null;
  // r186's WebGPU hasTimestamp getter always returns true. The active device,
  // not its adapter/backend marker, must have enabled this optional feature.
  if (!("device" in backend) || typeof backend.device !== "object" || backend.device === null
    || !("features" in backend.device) || !isEnabledGpuFeatures(backend.device.features)
    || backend.device.features.has("timestamp-query") !== true) return null;
  return backend as TimestampBackend;
}

function timestampPool(backend: TimestampBackend, type: "render" | "compute"): TimestampPool | null {
  const pools = backend.timestampQueryPool;
  const pool: unknown = type in pools ? Reflect.get(pools, type) : null;
  if (typeof pool !== "object" || pool === null
    || !("queryOffsets" in pool) || !(pool.queryOffsets instanceof Map)
    || !("timestamps" in pool) || !(pool.timestamps instanceof Map)) return null;
  return { queryOffsets: pool.queryOffsets, timestamps: pool.timestamps };
}

/** At most one sampled draw per second. Three r186 timestamps cover GPU render
 * and compute passes, unlike queue completion (which is never used here).
 * Guards are intentional: @types/three does not describe these backend fields.
 */
export function beginGpuProfile(renderer: unknown, timestampMs: number): GpuProfileToken | null {
  if (!shouldProfileFrames(typeof renderer === "object" && renderer !== null ? renderer : undefined)) return null;
  let backend: TimestampBackend | null = null;
  try {
    backend = timestampBackend(renderer);
    if (backend === null || backend.trackTimestamp) return null;
    let owner = gpuOwners.get(backend);
    if (owner === undefined) {
      owner = { pending: false, sampledAt: -Infinity };
      gpuOwners.set(backend, owner);
    }
    if (owner.pending || timestampMs - owner.sampledAt < 1000) return null;
    // Three returns its previous duration when query resolution fails. Clearing
    // only completed results lets us reject that stale result by UID below.
    for (const type of ["render", "compute"] as const) timestampPool(backend, type)?.timestamps.clear();
    currentProfiler(timestampMs);
    owner.pending = true;
    owner.sampledAt = timestampMs;
    backend.trackTimestamp = true;
    return { backend, owner, timestampMs, generation: usePerfStore.getState().generation };
  } catch {
    // Diagnostic capability failure must never affect the scene draw.
    if (backend !== null) backend.trackTimestamp = false;
    return null;
  }
}

/** Always pair with beginGpuProfile in finally. Failed draws drain/release
 * queries without publishing timings. Async results cannot cross Reset/Pause.
 */
export function endGpuProfile(token: GpuProfileToken | null, successful = true): void {
  if (token === null) return;
  const { backend, owner } = token;
  const pending: Promise<{ type: "render" | "compute"; duration: number | null }>[] = [];
  try {
    for (const type of ["render", "compute"] as const) {
      const pool = timestampPool(backend, type);
      if (pool === null || pool.queryOffsets.size === 0) continue;
      const ids = [...pool.queryOffsets.keys()];
      // Resolve begins synchronously while tracking is enabled. Collection is
      // disabled below before another draw can enqueue any timestamp queries.
      pending.push(Promise.resolve(backend.resolveTimestampsAsync(type)).then(() => {
        let duration = 0;
        for (const id of ids) {
          const value = pool.timestamps.get(id);
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { type, duration: null };
          duration += value;
        }
        return { type, duration };
      }, () => ({ type, duration: null })));
    }
  } catch {
    successful = false;
  } finally {
    backend.trackTimestamp = false;
  }
  const publish = successful;
  void Promise.all(pending).then((durations) => {
    if (!publish || durations.length === 0 || durations.some((entry) => entry.duration === null)
      || token.generation !== usePerfStore.getState().generation || !shouldProfileFrames()) return;
    // A sampled draw without compute passes (no sort or lighting update) costs 0 compute.
    let render = 0, compute = 0;
    for (const entry of durations) {
      if (entry.type === "render") render += entry.duration ?? 0;
      else compute += entry.duration ?? 0;
    }
    currentProfiler(token.timestampMs).recordGpu(token.timestampMs, render, compute);
  }).finally(() => { owner.pending = false; });
}

const drawnSamplers = new WeakMap<object, { pending: boolean; sampledAt: number }>();

/** At most one read per second of how many splats the GPU sort left in the
 * draw. The read is asynchronous; a Reset or Pause meanwhile discards it. */
export function sampleDrawnSplats(renderer: object, timestampMs: number, read: () => Promise<number | null>): void {
  if (!shouldProfileFrames(renderer)) return;
  let owner = drawnSamplers.get(renderer);
  if (owner === undefined) { owner = { pending: false, sampledAt: -Infinity }; drawnSamplers.set(renderer, owner); }
  if (owner.pending || timestampMs - owner.sampledAt < 1000) return;
  owner.pending = true;
  owner.sampledAt = timestampMs;
  const sampler = owner;
  const generationAtRead = usePerfStore.getState().generation;
  let reading: Promise<number | null>;
  try { reading = read(); } catch { sampler.pending = false; return; }
  void reading.then((count) => {
    if (count === null || generationAtRead !== usePerfStore.getState().generation || !shouldProfileFrames(renderer)) return;
    currentProfiler(timestampMs).recordDrawnSplats(timestampMs, count);
  }, () => undefined).finally(() => { sampler.pending = false; });
}

let longTaskObserver: PerformanceObserver | null = null;

/** Long tasks are observed only while the panel is open and running. */
export function setLongTaskObservation(active: boolean): void {
  if (!active) {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    return;
  }
  if (longTaskObserver !== null || typeof PerformanceObserver === "undefined"
    || !PerformanceObserver.supportedEntryTypes.includes("longtask")) return;
  longTaskObserver = new PerformanceObserver((list) => {
    if (!shouldProfileFrames()) return;
    for (const entry of list.getEntries()) {
      const ended = entry.startTime + entry.duration;
      currentProfiler(ended).recordLongTask(ended, entry.duration);
    }
  });
  longTaskObserver.observe({ type: "longtask" });
}

/** Chrome's non-standard heap figure; unavailable elsewhere. */
function jsHeapMb(): number | null {
  const memory: unknown = typeof performance !== "undefined" && "memory" in performance ? Reflect.get(performance, "memory") : null;
  const used: unknown = typeof memory === "object" && memory !== null ? Reflect.get(memory, "usedJSHeapSize") : null;
  return typeof used === "number" && Number.isFinite(used) ? used / 1_048_576 : null;
}

/** Portable, versioned clipboard payload with units and collection limits. */
export function profilerClipboardReport(): string {
  const state = usePerfStore.getState();
  const active = activeRenderer === null ? undefined : renderers.get(activeRenderer);
  const bounds = active?.canvas instanceof HTMLCanvasElement ? active.canvas.getBoundingClientRect() : null;
  const deviceMemory: unknown = typeof navigator !== "undefined" && "deviceMemory" in navigator ? navigator.deviceMemory : null;
  return JSON.stringify({
    schema: "venviewer.profiler.v2", capturedAt: new Date().toISOString(),
    window: { requestedSeconds: 20, capturedSeconds: state.metrics.windowSeconds, paused: state.paused },
    device: {
      tier: useDeviceStore.getState().tier, gpuRenderer: useDeviceStore.getState().gpuRenderer,
      devicePixelRatio: globalThis.devicePixelRatio,
      logicalCpuCount: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : null,
      deviceMemoryGbEstimate: typeof deviceMemory === "number" ? deviceMemory : null,
    },
    renderer: {
      backend: active?.backend ?? null, registeredCanvasCount: renderers.size,
      backingWidth: active?.canvas.width ?? null, backingHeight: active?.canvas.height ?? null,
      cssWidth: bounds?.width ?? null, cssHeight: bounds?.height ?? null,
    },
    metrics: state.metrics,
    definitions: {
      fps: "Successful main render submissions per wall-clock second, including idle time; not compositor presentation FPS",
      frameTimeMs: "Mean complete interval ending in the window between actual main render submissions; may start before window boundary; long stalls retained",
      frameP95Ms: "Nearest-rank 95th percentile of main render intervals",
      frameP99Ms: "Nearest-rank 99th percentile of main render intervals",
      cpuSubmitMs: "Synchronous main render scope including native scene updates; excludes other browser CPU work",
      gpuTimeMs: "Mean sampled WebGPU render plus compute timestamp durations; at most one sampled draw per second; excludes queue and presentation delay; unavailable on WebGL because its query API does not expose disjoint validity",
      gpuRenderMs: "Render-pass share of gpuTimeMs: drawing splats, meshes and the output pass",
      gpuComputeMs: "Compute-pass share of gpuTimeMs: the splat depth sort and view-dependent lighting; 0 for sampled draws that dispatched none",
      bottleneck: "Busiest of CPU submission and GPU time as a share of the mean frame interval; below 60% the frame rate is set by pacing (display refresh or on-demand rendering), not by work",
      drawnSplats: "Splats the latest GPU sort kept in the draw after conservative culling, read back at most once per second; WebGL draws every loaded splat",
      splats: "Loaded splats in the active draw (before culling)",
      jsHeapMb: "Chrome's used JavaScript heap at the latest refresh; unavailable in other browsers",
      longTaskCount: "Main-thread tasks over 50 ms that ended in the window; longTaskWorstMs and longTaskTotalMs describe them",
      triangles: "Three's CPU-side count; indirect splat draws are counted at their loaded, not drawn, size",
      rendererMb: "Mean MiB of Three-tracked renderer resources; not total physical VRAM",
      sortTimeMs: "Mean reported completed sort duration at submitted frames; null if unavailable",
      sortAgeMs: "Mean age of active order at submitted frames; null if unavailable",
      missing: "null means unavailable; hidden-tab time excluded by starting a new window on return",
    },
  }, null, 2);
}
