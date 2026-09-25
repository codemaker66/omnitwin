import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { NATIVE_CPU_SORT_GEOMETRY_LIMIT, NATIVE_CPU_SORT_TIMEOUT_MS, validCpuSortParameters, type NativeCpuSortCommand, type NativeCpuSortResponse } from "./native-cpu-sort-protocol.js";

export interface NativeCpuSortWorker {
  postMessage(message: NativeCpuSortCommand, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface NativeCpuSortHandle {
  readonly firstSort: Promise<void>;
  readonly request: (parameters: GaussianSplatCpuSortRequest) => void;
  /** Main-thread pose age, measured worker compute duration and queued work. */
  readonly stats: (now: number) => NativeCpuSortStats | null;
  dispose(): void;
}

export interface NativeCpuSortStats {
  readonly sortTimeMs: number | null;
  readonly sortAgeMs: number | null;
  /** This registration's in-flight request plus its coalesced pending pose. */
  readonly sortBacklog: number;
}

interface PendingSort {
  readonly parameters: GaussianSplatCpuSortRequest;
  /** performance.now() in the main thread; never compared with worker clocks. */
  readonly requestedAtMs: number;
}

/** Existing consumers may return nothing; guarded scenes return acceptance. */
type ApplySortOrder = ((order: Uint32Array) => void) | ((order: Uint32Array) => boolean);

interface Registration {
  readonly id: number;
  readonly centers: Float32Array;
  readonly apply: ApplySortOrder;
  readonly error: (error: Error) => void;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  initialized: boolean;
  pending: PendingSort | null;
  recycle: Uint32Array | undefined;
  appliedRequestAtMs: number | null;
  durationMs: number | null;
}

function responseFrom(value: unknown): NativeCpuSortResponse {
  if (typeof value !== "object" || value === null || !("geometryId" in value) || !("requestId" in value)
    || !Number.isSafeInteger(value.geometryId) || !Number.isSafeInteger(value.requestId) || !("type" in value)) {
    throw new Error("Native sort worker returned an invalid response");
  }
  if (value.type === "sorted" && "order" in value && value.order instanceof Uint32Array
    && typeof value.geometryId === "number" && typeof value.requestId === "number") {
    const durationMs: unknown = "durationMs" in value ? value.durationMs : undefined;
    if (durationMs !== undefined && (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0)) {
      throw new Error("Native sort worker returned an invalid duration");
    }
    return { type: "sorted", geometryId: value.geometryId, requestId: value.requestId, order: value.order,
      ...(typeof durationMs === "number" ? { durationMs } : {}) };
  }
  if (value.type === "error" && "message" in value && typeof value.message === "string"
    && typeof value.geometryId === "number" && typeof value.requestId === "number") {
    return { type: "error", geometryId: value.geometryId, requestId: value.requestId, message: value.message };
  }
  throw new Error("Native sort worker returned an invalid response");
}

/** One worker per native scene. There is one dispatched job and at most one
 * coalesced newest pose for each of the scene's bounded resident snapshots. */
export class NativeCpuSortPool {
  private readonly registrations = new Map<number, Registration>();
  private worker: NativeCpuSortWorker | null = null;
  private nextGeometry = 0;
  private nextRequest = 0;
  private inflight: { readonly registration: Registration; readonly requestId: number; readonly requestedAtMs: number } | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private failure: Error | null = null;
  private disposed = false;

  constructor(
    private readonly createWorker: () => NativeCpuSortWorker = () => new Worker(new URL("./native-cpu-sort-worker.ts", import.meta.url), { type: "module" }),
    private readonly now: () => number = () => performance.now(),
  ) {}

  register(centers: Float32Array, apply: ApplySortOrder, onError: (error: Error) => void): NativeCpuSortHandle {
    if (this.disposed || this.failure !== null) throw this.failure ?? new Error("Native sort worker is disposed");
    if (this.registrations.size >= NATIVE_CPU_SORT_GEOMETRY_LIMIT) throw new Error("Native sort resident limit exceeded");
    if (centers.length === 0 || centers.length % 3 !== 0) throw new Error("Native sort positions are invalid");
    let resolve!: () => void, reject!: (error: Error) => void;
    const firstSort = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
    // Disposal may happen before buildNext reaches its await. The original
    // promise still rejects for that await, without an unhandled-rejection race.
    void firstSort.catch(() => undefined);
    const registration: Registration = { id: ++this.nextGeometry, centers, apply, error: onError, resolve, reject,
      initialized: false, pending: null, recycle: undefined, appliedRequestAtMs: null, durationMs: null };
    this.registrations.set(registration.id, registration);
    return {
      firstSort,
      request: (parameters) => {
        if (this.registrations.get(registration.id) !== registration || this.disposed || this.failure !== null) return;
        if (!validCpuSortParameters(parameters)) { this.fail(new Error("Native sort camera parameters are invalid")); return; }
        registration.pending = { parameters: { ...parameters, modelViewMatrix: [...parameters.modelViewMatrix] }, requestedAtMs: this.now() };
        this.pump();
      },
      stats: (now) => {
        if (this.registrations.get(registration.id) !== registration || this.disposed || this.failure !== null) return null;
        const requestedAt = registration.appliedRequestAtMs;
        return {
          sortTimeMs: registration.durationMs,
          sortAgeMs: requestedAt !== null && Number.isFinite(now) && Number.isFinite(requestedAt) && now >= requestedAt ? now - requestedAt : null,
          sortBacklog: (this.inflight?.registration === registration ? 1 : 0) + (registration.pending !== null ? 1 : 0),
        };
      },
      dispose: () => {
        if (!this.registrations.delete(registration.id)) return;
        registration.pending = null;
        registration.recycle = undefined;
        registration.reject(new DOMException("Native sort cancelled", "AbortError"));
        if (registration.initialized) this.worker?.postMessage({ type: "drop", geometryId: registration.id }, []);
        // A running calculation may finish, but can no longer apply or invalidate.
        // Its timeout still bounds it and the next job starts after its receipt.
      },
    };
  }

  private pump(): void {
    if (this.inflight !== null || this.disposed || this.failure !== null) return;
    const registration = [...this.registrations.values()].find((entry) => entry.pending !== null);
    if (registration?.pending === null || registration === undefined) return;
    const { parameters, requestedAtMs } = registration.pending;
    registration.pending = null;
    try {
      if (this.worker === null) {
        this.worker = this.createWorker();
        this.worker.onmessage = (event) => { this.receive(event.data); };
        this.worker.onerror = (event) => { event.preventDefault(); this.fail(new Error(event.message || "Native sort worker failed")); };
        this.worker.onmessageerror = () => { this.fail(new Error("Native sort worker response could not be read")); };
      }
      const requestId = ++this.nextRequest;
      this.inflight = { registration, requestId, requestedAtMs };
      const centers = registration.initialized ? undefined : registration.centers.slice();
      const recycle = registration.recycle;
      registration.recycle = undefined;
      const transfer: Transferable[] = [];
      if (centers !== undefined) transfer.push(centers.buffer);
      if (recycle !== undefined) transfer.push(recycle.buffer);
      const command: NativeCpuSortCommand = { type: "sort", geometryId: registration.id, requestId, parameters,
        ...(centers === undefined ? {} : { centers }), ...(recycle === undefined ? {} : { recycle }) };
      registration.initialized = true;
      this.timeout = setTimeout(() => { this.fail(new Error("Native sort worker timed out")); }, NATIVE_CPU_SORT_TIMEOUT_MS);
      this.worker.postMessage(command, transfer);
    } catch (reason: unknown) { this.fail(reason instanceof Error ? reason : new Error(String(reason))); }
  }

  private receive(value: unknown): void {
    if (this.disposed || this.failure !== null) return;
    try {
      const response = responseFrom(value), job = this.inflight;
      if (job === null || response.requestId !== job.requestId || response.geometryId !== job.registration.id) {
        throw new Error("Native sort worker returned an unexpected generation");
      }
      if (this.timeout !== null) clearTimeout(this.timeout);
      this.timeout = null; this.inflight = null;
      const registration = job.registration;
      if (this.registrations.get(registration.id) === registration) {
        if (response.type === "error") throw new Error(response.message);
        if (response.order.length !== registration.centers.length / 3) throw new Error("Native sort worker returned an incomplete order");
        // Apply completed work even when a newer pose is pending; otherwise
        // continuous input can starve sorting indefinitely. The pending pose wins next.
        const applied = registration.apply(response.order);
        if (this.registrations.get(registration.id) === registration) {
          // Stale scene/version guards may refuse an order. Preserve the prior
          // displayed pose's age without changing readiness or buffer scheduling.
          if (applied !== false) {
            registration.appliedRequestAtMs = job.requestedAtMs;
            registration.durationMs = response.durationMs ?? null;
          }
          registration.recycle = response.order;
          registration.resolve();
          this.registrations.delete(registration.id);
          this.registrations.set(registration.id, registration); // Fair service between resident snapshots.
        }
      }
      this.pump();
    } catch (reason: unknown) { this.fail(reason instanceof Error ? reason : new Error(String(reason))); }
  }

  private fail(error: Error): void {
    if (this.disposed || this.failure !== null) return;
    this.failure = error;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null; this.inflight = null;
    this.worker?.terminate(); this.worker = null;
    const failed = [...this.registrations.values()];
    this.registrations.clear();
    for (const registration of failed) {
      registration.pending = null; registration.recycle = undefined;
      registration.reject(error);
    }
    for (const registration of failed) {
      // Consumer error handlers must not strand another snapshot's initial
      // readiness promise or retain ownership after the worker has failed.
      try { registration.error(error); } catch { /* The worker failure is already settled for every owner. */ }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null; this.inflight = null;
    this.worker?.terminate(); this.worker = null;
    for (const registration of this.registrations.values()) registration.reject(new DOMException("Native sort cancelled", "AbortError"));
    this.registrations.clear();
  }
}
