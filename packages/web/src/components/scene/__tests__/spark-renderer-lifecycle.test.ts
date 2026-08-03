import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disposeSparkRendererAfterWorkerDrain,
  SparkRendererAdmissionGate,
  type SparkRendererLifecycle,
  type SparkRendererPagerLifecycle,
  type SparkRendererWorkerLifecycle,
} from "../spark-renderer-lifecycle.js";

interface MutableWorker extends SparkRendererWorkerLifecycle {
  queue: unknown[] | null;
  messages: Record<number, unknown>;
}

function pendingWorker(): MutableWorker {
  return {
    queue: [],
    messages: { 1: { reject: vi.fn() } },
  };
}

function rendererWith(
  worker: SparkRendererWorkerLifecycle | null,
  dispose: () => void = vi.fn(),
): SparkRendererLifecycle {
  return {
    autoUpdate: true,
    enableDriveLod: true,
    enableLodFetching: true,
    geometry: { dispose: vi.fn() },
    lodDirty: true,
    lodWorker: null,
    material: { dispose: vi.fn() },
    onDirty: vi.fn(),
    sortDirty: true,
    sorting: worker !== null,
    sortWorker: worker,
    sortTimeoutId: 12,
    updateTimeoutId: 11,
    visible: true,
    dispose,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Spark renderer shutdown", () => {
  it("quiesces updates and waits for two idle turns before disposal", async () => {
    const worker = pendingWorker();
    const renderer = rendererWith(worker);
    let now = 0;
    let waits = 0;
    const result = disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      wait: () => {
        waits += 1;
        now += 10;
        if (waits === 1) {
          worker.messages = {};
          worker.queue = null;
          Object.assign(renderer, { sorting: false });
        }
        return Promise.resolve();
      },
    });

    expect(renderer.autoUpdate).toBe(false);
    expect(renderer.enableDriveLod).toBe(false);
    expect(renderer.enableLodFetching).toBe(false);
    expect(renderer.onDirty).toBeUndefined();
    await expect(result).resolves.toBe("drained");
    expect(waits).toBe(2);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.material.dispose).toHaveBeenCalledOnce();
    expect(renderer.geometry.dispose).toHaveBeenCalledOnce();
  });

  it("quiesces a pager that appears while existing work drains", async () => {
    const renderer = rendererWith(null);
    Object.assign(renderer, { sorting: true });
    let now = 0;
    let waits = 0;
    const pager: SparkRendererPagerLifecycle = {
      autoDrive: true,
      numFetchers: 3,
      fetchers: [{}],
    };

    const result = disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      wait: () => {
        waits += 1;
        now += 10;
        if (waits === 1) {
          Object.assign(renderer, { sorting: false, pager });
        } else if (waits === 2) {
          Object.assign(pager, { fetchers: [] });
        }
        return Promise.resolve();
      },
    });

    await expect(result).resolves.toBe("drained");
    expect(pager.autoDrive).toBe(false);
    expect(pager.numFetchers).toBe(0);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it("defers a busy renderer without terminating workers or changing messages", async () => {
    vi.useFakeTimers();
    const worker = pendingWorker();
    const originalMessages = worker.messages;
    const renderer = rendererWith(worker);

    await expect(disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 0,
      retirementPollIntervalMs: 10,
      retirementTimeoutMs: 100,
      now: () => Date.now(),
    })).resolves.toBe("deferred");

    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(worker.messages).toBe(originalMessages);
    expect(worker.messages).toHaveProperty("1");

    worker.messages = {};
    worker.queue = null;
    Object.assign(renderer, { sorting: false });
    await vi.advanceTimersByTimeAsync(20);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it("bounds retirement and quarantines a permanently busy renderer", async () => {
    vi.useFakeTimers();
    const worker = pendingWorker();
    const originalMessages = worker.messages;
    const renderer = rendererWith(worker);
    const onQuarantined = vi.fn();

    await expect(disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 0,
      retirementPollIntervalMs: 10,
      retirementTimeoutMs: 20,
      now: () => Date.now(),
      onQuarantined,
    })).resolves.toBe("deferred");
    await vi.advanceTimersByTimeAsync(20);

    expect(onQuarantined).toHaveBeenCalledOnce();
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(renderer.material.dispose).not.toHaveBeenCalled();
    expect(renderer.geometry.dispose).not.toHaveBeenCalled();
    expect(worker.messages).toBe(originalMessages);
    expect(worker.messages).toHaveProperty("1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps the final retirement wait at the remaining deadline", async () => {
    const renderer = rendererWith(pendingWorker());
    const waits: number[] = [];
    let now = 0;
    let resolveQuarantined: (() => void) | undefined;
    const quarantined = new Promise<void>((resolve) => {
      resolveQuarantined = resolve;
    });

    await expect(disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 0,
      retirementPollIntervalMs: 10,
      retirementTimeoutMs: 23,
      now: () => now,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
      onQuarantined: () => { resolveQuarantined?.(); },
    })).resolves.toBe("deferred");
    await quarantined;

    expect(waits).toEqual([10, 10, 3]);
    expect(now).toBe(23);
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it("does not dispose across a transient idle sample", async () => {
    const worker: MutableWorker = { queue: null, messages: {} };
    const renderer = rendererWith(worker);
    Object.assign(renderer, { sorting: false });
    let now = 0;
    let waits = 0;

    const result = disposeSparkRendererAfterWorkerDrain(renderer, {
      drainTimeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      wait: () => {
        waits += 1;
        now += 10;
        if (waits === 1) {
          worker.queue = [];
          worker.messages = { 2: {} };
          Object.assign(renderer, { sorting: true });
        } else if (waits === 2) {
          worker.queue = null;
          worker.messages = {};
          Object.assign(renderer, { sorting: false });
        }
        return Promise.resolve();
      },
    });

    await expect(result).resolves.toBe("drained");
    expect(waits).toBe(3);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it("disposes synchronously with the final idle observation", async () => {
    const worker: MutableWorker = { queue: null, messages: {} };
    const dispose = vi.fn(() => {
      expect(worker.messages).toEqual({});
    });
    const renderer = rendererWith(worker, dispose);
    let sortingReads = 0;
    Object.defineProperty(renderer, "sorting", {
      configurable: true,
      get: () => {
        sortingReads += 1;
        if (sortingReads === 2) {
          queueMicrotask(() => { worker.messages = { 3: {} }; });
        }
        return false;
      },
    });

    await expect(disposeSparkRendererAfterWorkerDrain(renderer, {
      wait: () => Promise.resolve(),
    })).resolves.toBe("drained");
    expect(dispose).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(worker.messages).toHaveProperty("3");
  });

  it("deduplicates repeated React cleanup calls for one renderer", async () => {
    const renderer = rendererWith(null);
    Object.assign(renderer, { sorting: false });
    const first = disposeSparkRendererAfterWorkerDrain(renderer);
    const second = disposeSparkRendererAfterWorkerDrain(renderer);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("drained");
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});

describe("Spark renderer admission", () => {
  it("allows one host per canvas and permits concurrent distinct canvases", () => {
    const gate = new SparkRendererAdmissionGate();
    const canvasA = {};
    const canvasB = {};
    const first = gate.acquire(canvasA);
    const concurrent = gate.acquire(canvasB);

    expect(first).not.toBeNull();
    expect(gate.acquire(canvasA)).toBeNull();
    expect(concurrent).not.toBeNull();
    first?.release();
    expect(gate.acquire(canvasA)).not.toBeNull();
    concurrent?.release();
  });

  it("trips a page-lifetime latch after one renderer is quarantined", () => {
    const gate = new SparkRendererAdmissionGate();
    const listener = vi.fn();
    const unsubscribe = gate.subscribe(listener);
    const lease = gate.acquire({});

    lease?.quarantine();
    expect(gate.getSnapshot()).toBe("quarantined");
    expect(gate.acquire({})).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    lease?.release();
    expect(gate.getSnapshot()).toBe("quarantined");
    unsubscribe();
  });
});
