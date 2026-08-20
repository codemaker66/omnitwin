export interface SparkRendererWorkerLifecycle {
  readonly queue: readonly unknown[] | null;
  readonly messages: Readonly<Record<number, unknown>>;
}

export interface SparkRendererPagerLifecycle {
  autoDrive: boolean;
  numFetchers: number;
  readonly fetchers: readonly unknown[];
}

interface DisposableResource {
  dispose: () => void;
}

export interface SparkRendererLifecycle {
  autoUpdate: boolean;
  enableDriveLod: boolean;
  enableLodFetching: boolean;
  readonly geometry: DisposableResource;
  lodDirty: boolean;
  readonly lodWorker: SparkRendererWorkerLifecycle | null;
  readonly material: DisposableResource;
  onDirty?: () => void;
  readonly pager?: SparkRendererPagerLifecycle;
  sortDirty: boolean;
  readonly sorting: boolean;
  readonly sortWorker: SparkRendererWorkerLifecycle | null;
  sortTimeoutId: number;
  updateTimeoutId: number;
  visible: boolean;
  dispose: () => void;
}

export type SparkRendererDisposeOutcome = "drained" | "deferred";
export type SparkRendererAdmissionState = "available" | "quarantined";

export interface SparkRendererAdmissionLease {
  readonly release: () => void;
  readonly quarantine: () => void;
}

export class SparkRendererAdmissionGate {
  readonly #occupiedCanvases = new WeakSet();
  readonly #listeners = new Set<() => void>();
  #quarantined = false;

  readonly getSnapshot = (): SparkRendererAdmissionState => (
    this.#quarantined ? "quarantined" : "available"
  );

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  quarantine(): void {
    if (this.#quarantined) return;
    this.#quarantined = true;
    for (const listener of this.#listeners) listener();
  }

  acquire(canvasKey: object): SparkRendererAdmissionLease | null {
    if (this.#quarantined || this.#occupiedCanvases.has(canvasKey)) return null;
    this.#occupiedCanvases.add(canvasKey);
    let settled = false;

    const settle = (quarantine: boolean): void => {
      if (settled) return;
      settled = true;
      this.#occupiedCanvases.delete(canvasKey);
      if (quarantine) {
        this.quarantine();
      } else {
        for (const listener of this.#listeners) listener();
      }
    };

    return {
      release: () => { settle(false); },
      quarantine: () => { settle(true); },
    };
  }
}

export const sparkRendererAdmissionGate = new SparkRendererAdmissionGate();

interface SparkRendererDisposeOptions {
  readonly drainTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly retirementPollIntervalMs?: number;
  readonly retirementTimeoutMs?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly onDisposed?: () => void;
  readonly onQuarantined?: () => void;
}

const SPARK_RENDERER_DRAIN_TIMEOUT_MS = 1_000;
const SPARK_RENDERER_DRAIN_POLL_MS = 16;
const SPARK_RENDERER_RETIREMENT_POLL_MS = 250;
const SPARK_RENDERER_RETIREMENT_TIMEOUT_MS = 30_000;
const REQUIRED_IDLE_SAMPLES = 2;
const rendererDisposeJobs = new WeakMap<
  SparkRendererLifecycle,
  Promise<SparkRendererDisposeOutcome>
>();
const rendererRetirementJobs = new WeakMap<SparkRendererLifecycle, Promise<void>>();

function workerIsIdle(worker: SparkRendererWorkerLifecycle | null): boolean {
  return worker === null || (
    worker.queue === null && Object.keys(worker.messages).length === 0
  );
}

function rendererIsIdle(renderer: SparkRendererLifecycle): boolean {
  return !renderer.sorting &&
    workerIsIdle(renderer.sortWorker) &&
    workerIsIdle(renderer.lodWorker) &&
    (renderer.pager === undefined || renderer.pager.fetchers.length === 0) &&
    renderer.updateTimeoutId === -1 &&
    renderer.sortTimeoutId === -1;
}

function quiesceRenderer(renderer: SparkRendererLifecycle): void {
  renderer.visible = false;
  renderer.autoUpdate = false;
  renderer.enableDriveLod = false;
  renderer.enableLodFetching = false;
  renderer.sortDirty = false;
  renderer.lodDirty = false;
  renderer.onDirty = undefined;
  if (renderer.updateTimeoutId !== -1) {
    clearTimeout(renderer.updateTimeoutId);
    renderer.updateTimeoutId = -1;
  }
  if (renderer.sortTimeoutId !== -1) {
    clearTimeout(renderer.sortTimeoutId);
    renderer.sortTimeoutId = -1;
  }
  if (renderer.pager !== undefined) {
    renderer.pager.autoDrive = false;
    renderer.pager.numFetchers = 0;
  }
}

function disposeRendererResources(
  renderer: SparkRendererLifecycle,
  onDisposed: (() => void) | undefined,
  onQuarantined: (() => void) | undefined,
): void {
  const errors: unknown[] = [];
  const dispose = (resource: DisposableResource): void => {
    try {
      resource.dispose();
    } catch (error: unknown) {
      errors.push(error);
    }
  };

  dispose(renderer);
  dispose(renderer.material);
  dispose(renderer.geometry);
  if (errors.length > 0) {
    onQuarantined?.();
    throw errors[0];
  }
  onDisposed?.();
}

async function disposeAfterStableIdle(
  renderer: SparkRendererLifecycle,
  wait: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number,
  deadline: number,
  now: () => number,
  onDisposed: (() => void) | undefined,
  onQuarantined: (() => void) | undefined,
): Promise<boolean> {
  let idleSamples = 0;
  for (;;) {
    // Running Spark continuations can create a pager or schedule work after
    // React starts cleanup, so shutdown controls are re-applied every turn.
    quiesceRenderer(renderer);
    if (rendererIsIdle(renderer)) {
      idleSamples += 1;
      if (idleSamples >= REQUIRED_IDLE_SAMPLES) {
        // Do not await between the final idle observation and disposal. A
        // microtask boundary here would let Spark repopulate worker state.
        disposeRendererResources(renderer, onDisposed, onQuarantined);
        return true;
      }
    } else {
      idleSamples = 0;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) return false;
    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}

function surfaceRetirementError(error: unknown): void {
  setTimeout(() => {
    throw error;
  }, 0);
}

function retireRendererWithinBound(
  renderer: SparkRendererLifecycle,
  options: Required<Pick<
    SparkRendererDisposeOptions,
    "retirementPollIntervalMs" | "retirementTimeoutMs" | "now" | "wait"
  >> & Pick<SparkRendererDisposeOptions, "onDisposed" | "onQuarantined">,
): Promise<void> {
  const existing = rendererRetirementJobs.get(renderer);
  if (existing !== undefined) return existing;

  const job = (async (): Promise<void> => {
    const disposed = await disposeAfterStableIdle(
      renderer,
      options.wait,
      options.retirementPollIntervalMs,
      options.now() + options.retirementTimeoutMs,
      options.now,
      options.onDisposed,
      options.onQuarantined,
    );
    if (!disposed) options.onQuarantined?.();
  })();
  rendererRetirementJobs.set(renderer, job);
  job.catch(surfaceRetirementError);
  return job;
}

/**
 * Spark 2.0 rejects in-flight worker RPCs from dispose(), while renderer
 * updates launch those RPCs without observing their promise. Quiesce and wait
 * for two idle turns before disposing. If foreground cleanup reaches its
 * deadline, retirement continues at low frequency for one bounded interval.
 * A still-busy renderer is quarantined and must trip the page-lifetime
 * admission gate: it is never force-disposed, and no additional renderer may
 * accumulate. Spark needs an upstream cancellable dispose API to recover the
 * quarantined renderer without a reload.
 */
export function disposeSparkRendererAfterWorkerDrain(
  renderer: SparkRendererLifecycle,
  options: SparkRendererDisposeOptions = {},
): Promise<SparkRendererDisposeOutcome> {
  const existing = rendererDisposeJobs.get(renderer);
  if (existing !== undefined) return existing;

  const now = options.now ?? (() => globalThis.performance.now());
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const drainTimeoutMs = options.drainTimeoutMs ?? SPARK_RENDERER_DRAIN_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? SPARK_RENDERER_DRAIN_POLL_MS;
  const retirementPollIntervalMs = options.retirementPollIntervalMs ??
    SPARK_RENDERER_RETIREMENT_POLL_MS;
  const retirementTimeoutMs = options.retirementTimeoutMs ??
    SPARK_RENDERER_RETIREMENT_TIMEOUT_MS;
  const job = (async (): Promise<SparkRendererDisposeOutcome> => {
    const disposed = await disposeAfterStableIdle(
      renderer,
      wait,
      pollIntervalMs,
      now() + drainTimeoutMs,
      now,
      options.onDisposed,
      options.onQuarantined,
    );
    if (disposed) return "drained";

    void retireRendererWithinBound(renderer, {
      retirementPollIntervalMs,
      retirementTimeoutMs,
      now,
      wait,
      onDisposed: options.onDisposed,
      onQuarantined: options.onQuarantined,
    });
    return "deferred";
  })();
  rendererDisposeJobs.set(renderer, job);
  job.catch(surfaceRetirementError);
  return job;
}
