import { describe, expect, it, vi } from "vitest";
import { Matrix4 } from "three";
import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { NativeCpuSortPool, type NativeCpuSortWorker } from "../native-cpu-sort-pool.js";
import type { NativeCpuSortCommand } from "../native-cpu-sort-protocol.js";

class TelemetryWorker implements NativeCpuSortWorker {
  onmessage: NativeCpuSortWorker["onmessage"] = null;
  onerror: NativeCpuSortWorker["onerror"] = null;
  onmessageerror: NativeCpuSortWorker["onmessageerror"] = null;
  readonly jobs: Extract<NativeCpuSortCommand, { type: "sort" }>[] = [];
  terminate = vi.fn();
  postMessage(command: NativeCpuSortCommand): void { if (command.type === "sort") this.jobs.push(command); }
  complete(index: number, duration: unknown = undefined): void {
    const job = this.jobs[index];
    if (job === undefined) throw new Error("Missing test job");
    this.onmessage?.(new MessageEvent("message", { data: {
      type: "sorted", geometryId: job.geometryId, requestId: job.requestId,
      order: new Uint32Array([1, 0]), ...(duration === undefined ? {} : { durationMs: duration }),
    } }));
  }
}

const request = (angle = 0): GaussianSplatCpuSortRequest => ({
  modelViewMatrix: new Matrix4().makeRotationY(angle).elements, nearDepth: .1, farDepth: 2000, binCount: 65_536,
});
function fixture() {
  const worker = new TelemetryWorker();
  let now = 0;
  const pool = new NativeCpuSortPool(() => worker, () => now);
  const apply = vi.fn<() => boolean | undefined>(), error = vi.fn();
  const handle = pool.register(new Float32Array([0, 0, -5, 0, 0, -6]), apply, error);
  return { pool, worker, handle, apply, error, at: (value: number): void => { now = value; } };
}

describe("native sort duration and applied camera age", () => {
  it("keeps original request time through A/B/latest-pose coalescing and queue delay", async () => {
    const f = fixture();
    try {
      f.at(10); f.handle.request(request());
      expect(f.handle.stats(11)).toEqual({ sortTimeMs: null, sortAgeMs: null, sortBacklog: 1 });
      f.at(20); f.handle.request(request(.1));
      f.at(30); f.handle.request(request(.2));
      expect(f.handle.stats(35)?.sortBacklog).toBe(2);
      f.at(100); f.worker.complete(0, 7); await f.handle.firstSort;
      expect(f.handle.stats(100)).toEqual({ sortTimeMs: 7, sortAgeMs: 90, sortBacklog: 1 });
      expect(f.worker.jobs).toHaveLength(2);
      expect(f.worker.jobs[1]?.parameters).toEqual(request(.2));
      f.at(110); f.handle.request(request());
      f.at(200); f.worker.complete(1, 9);
      expect(f.handle.stats(200)).toEqual({ sortTimeMs: 9, sortAgeMs: 170, sortBacklog: 1 });
      f.at(210); f.worker.complete(2, 5);
      expect(f.handle.stats(210)).toEqual({ sortTimeMs: 5, sortAgeMs: 100, sortBacklog: 0 });
      expect(f.apply).toHaveBeenCalledTimes(3);
    } finally { f.pool.dispose(); }
  });

  it("keeps unknown duration null without replacing pose age with completion time", async () => {
    const f = fixture();
    try {
      f.at(5); f.handle.request(request());
      f.at(50); f.worker.complete(0); await f.handle.firstSort;
      expect(f.handle.stats(100)).toEqual({ sortTimeMs: null, sortAgeMs: 95, sortBacklog: 0 });
      expect(f.handle.stats(NaN)?.sortAgeMs).toBeNull();
      expect(f.handle.stats(1)?.sortAgeMs).toBeNull();
    } finally { f.pool.dispose(); }
  });

  it("keeps the previous displayed order's telemetry when its scene refuses a stale order", async () => {
    const f = fixture();
    try {
      f.at(10); f.handle.request(request()); f.worker.complete(0, 2); await f.handle.firstSort;
      f.at(30); f.handle.request(request(.3)); f.apply.mockReturnValue(false); f.worker.complete(1, 8);
      expect(f.handle.stats(100)).toEqual({ sortTimeMs: 2, sortAgeMs: 90, sortBacklog: 0 });
      f.apply.mockReturnValue(true); f.at(110); f.handle.request(request(.4)); f.worker.complete(2, 0);
      expect(f.handle.stats(120)).toEqual({ sortTimeMs: 0, sortAgeMs: 10, sortBacklog: 0 });
      expect(f.worker.jobs[2]?.recycle).toBeInstanceOf(Uint32Array);
    } finally { f.pool.dispose(); }
  });

  it("does not publish disposed work or contaminate another registration", async () => {
    const f = fixture();
    try {
      f.at(10); f.handle.request(request()); f.handle.dispose();
      await expect(f.handle.firstSort).rejects.toMatchObject({ name: "AbortError" });
      const next = f.pool.register(new Float32Array([0, 0, -5, 0, 0, -6]), vi.fn(), vi.fn());
      f.at(20); next.request(request());
      f.worker.complete(0, 999);
      expect(f.handle.stats(100)).toBeNull();
      expect(next.stats(100)).toEqual({ sortTimeMs: null, sortAgeMs: null, sortBacklog: 1 });
      f.worker.complete(1, 4); await next.firstSort;
      expect(next.stats(100)).toEqual({ sortTimeMs: 4, sortAgeMs: 80, sortBacklog: 0 });
      expect(f.apply).not.toHaveBeenCalled();
      f.pool.dispose();
      expect(next.stats(110)).toBeNull();
    } finally { f.pool.dispose(); }
  });

  it.each([NaN, Infinity, -1, "5", null])("rejects malformed optional duration %s", async (duration) => {
    const f = fixture();
    try {
      f.handle.request(request()); f.worker.complete(0, duration);
      await expect(f.handle.firstSort).rejects.toThrow("invalid duration");
      expect(f.handle.stats(100)).toBeNull(); expect(f.apply).not.toHaveBeenCalled();
      expect(f.worker.terminate).toHaveBeenCalledOnce();
    } finally { f.pool.dispose(); }
  });

  it("invalidates stats on a stale-generation failure without accepting its duration", async () => {
    const f = fixture();
    try {
      f.at(10); f.handle.request(request()); f.worker.complete(0, 2); await f.handle.firstSort;
      f.at(20); f.handle.request(request(.1)); f.worker.complete(0, 1000);
      expect(f.handle.stats(30)).toBeNull(); expect(f.apply).toHaveBeenCalledOnce();
      expect(f.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "Native sort worker returned an unexpected generation" }));
    } finally { f.pool.dispose(); }
  });
});
