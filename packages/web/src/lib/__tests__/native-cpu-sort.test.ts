import { afterEach, describe, expect, it, vi } from "vitest";
import { Matrix4 } from "three";
import type { GaussianSplatCpuSortRequest } from "three/addons/objects/GaussianSplat.js";
import { NativeCpuSortKernel } from "../native-cpu-sort-kernel.js";
import { NativeCpuSortPool, type NativeCpuSortWorker } from "../native-cpu-sort-pool.js";
import { NATIVE_CPU_SORT_TIMEOUT_MS, type NativeCpuSortCommand } from "../native-cpu-sort-protocol.js";

class ControlledWorker implements NativeCpuSortWorker {
  readonly sent: { message: NativeCpuSortCommand; transfer: Transferable[] }[] = [];
  terminate = vi.fn();
  onmessage: NativeCpuSortWorker["onmessage"] = null;
  onerror: NativeCpuSortWorker["onerror"] = null;
  onmessageerror: NativeCpuSortWorker["onmessageerror"] = null;
  postMessage(message: NativeCpuSortCommand, transfer: Transferable[]): void { this.sent.push({ message, transfer }); }
  jobs() { return this.sent.map((entry) => entry.message).filter((message) => message.type === "sort"); }
  complete(index: number, order = new Uint32Array([2, 1, 0])): void {
    const job = this.jobs()[index];
    if (job === undefined) throw new Error("Missing test request");
    this.onmessage?.(new MessageEvent("message", { data: { type: "sorted", geometryId: job.geometryId, requestId: job.requestId, order } }));
  }
}

const centers = () => new Float32Array([0, 0, -5, 0, 0, -5.01, 0, 0, -1400]);
function request(angle = 0): GaussianSplatCpuSortRequest {
  return { modelViewMatrix: new Matrix4().makeRotationY(angle).elements, nearDepth: 0.1, farDepth: 1401, binCount: 65_536 };
}
function setup() {
  const worker = new ControlledWorker(), factory = vi.fn(() => worker), pool = new NativeCpuSortPool(factory);
  const apply = vi.fn(), error = vi.fn(), positions = centers();
  const handle = pool.register(positions, apply, error);
  return { pool, worker, factory, apply, error, positions, handle };
}
afterEach(() => { vi.useRealTimers(); });

describe("native CPU sorting worker ownership", () => {
  it("waits for a real first order and transfers only a copied position buffer", async () => {
    const state = setup(), ready = vi.fn();
    void state.handle.firstSort.then(ready);
    state.handle.request(request());
    expect(state.factory).toHaveBeenCalledOnce();
    const job = state.worker.jobs()[0];
    expect(job?.centers).toEqual(state.positions);
    expect(job?.centers?.buffer).not.toBe(state.positions.buffer);
    expect(state.worker.sent[0]?.transfer).not.toContain(state.positions.buffer);
    expect(ready).not.toHaveBeenCalled();
    const output = new Uint32Array([2, 1, 0]);
    state.worker.complete(0, output);
    await state.handle.firstSort;
    expect(state.apply).toHaveBeenCalledExactlyOnceWith(output);
    expect(ready).toHaveBeenCalledOnce();
    expect([...state.positions]).toEqual([...centers()]);
    state.pool.dispose();
  });

  it("coalesces B then A while applying completed A, B, A without starvation", async () => {
    const state = setup(), a = request(), b = request(0.3);
    state.handle.request(a); state.worker.complete(0); await state.handle.firstSort;
    state.handle.request(b);
    state.handle.request(request(0.6));
    state.handle.request(a);
    expect(state.worker.jobs()).toHaveLength(2);
    state.worker.complete(1, new Uint32Array([0, 1, 2]));
    expect(state.apply).toHaveBeenCalledTimes(2); // Completed B is useful while A is pending.
    expect(state.worker.jobs()).toHaveLength(3);
    expect(state.worker.jobs()[2]?.parameters).toEqual(a);
    state.worker.complete(2);
    expect(state.apply).toHaveBeenCalledTimes(3);
    expect(state.apply).toHaveBeenLastCalledWith(new Uint32Array([2, 1, 0]));
    expect(state.worker.jobs().slice(1).every((job) => job.centers === undefined)).toBe(true);
    expect(state.worker.jobs()[1]?.recycle).toEqual(new Uint32Array([2, 1, 0]));
    state.pool.dispose();
  });

  it("does not copy or transfer a queued geometry removed before dispatch", async () => {
    const state = setup();
    state.handle.request(request());
    const second = state.pool.register(centers(), vi.fn(), vi.fn());
    second.request(request()); second.dispose();
    await expect(second.firstSort).rejects.toMatchObject({ name: "AbortError" });
    expect(state.worker.jobs()).toHaveLength(1);
    state.worker.complete(0); await state.handle.firstSort;
    expect(state.worker.jobs()).toHaveLength(1);
    state.pool.dispose();
  });

  it("ignores disposed in-flight results and then services a replacement", async () => {
    const state = setup();
    state.handle.request(request()); state.handle.dispose();
    await expect(state.handle.firstSort).rejects.toMatchObject({ name: "AbortError" });
    const apply = vi.fn(), next = state.pool.register(centers(), apply, vi.fn()); next.request(request());
    state.worker.complete(0);
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.worker.jobs()).toHaveLength(2);
    state.worker.complete(1); await next.firstSort;
    expect(apply).toHaveBeenCalledOnce();
    state.pool.dispose();
  });

  it("bounds registered geometries and kills outstanding work on scene release", async () => {
    const state = setup();
    const second = state.pool.register(centers(), vi.fn(), vi.fn());
    const third = state.pool.register(centers(), vi.fn(), vi.fn());
    expect(() => state.pool.register(centers(), vi.fn(), vi.fn())).toThrow(/resident limit/);
    state.handle.request(request()); state.pool.dispose();
    state.worker.complete(0);
    await expect(state.handle.firstSort).rejects.toMatchObject({ name: "AbortError" });
    await expect(second.firstSort).rejects.toMatchObject({ name: "AbortError" });
    await expect(third.firstSort).rejects.toMatchObject({ name: "AbortError" });
    expect(state.worker.terminate).toHaveBeenCalledOnce();
    expect(state.apply).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled();
  });

  it.each(["crash", "timeout", "malformed"])("fails closed on worker %s without marking the first sort ready", async (failure) => {
    vi.useFakeTimers();
    const state = setup(); state.handle.request(request());
    if (failure === "crash") state.worker.onerror?.(new ErrorEvent("error", { message: "worker crash" }));
    else if (failure === "timeout") await vi.advanceTimersByTimeAsync(NATIVE_CPU_SORT_TIMEOUT_MS);
    else state.worker.complete(0, new Uint32Array([0]));
    await expect(state.handle.firstSort).rejects.toThrow();
    expect(state.error).toHaveBeenCalledOnce(); expect(state.apply).not.toHaveBeenCalled();
    expect(state.worker.terminate).toHaveBeenCalledOnce();
    state.worker.complete(0); expect(state.apply).not.toHaveBeenCalled();
    state.pool.dispose();
  });

  it("rejects every owner even when one consumer's failure handler throws", async () => {
    const state = setup();
    state.error.mockImplementation(() => { throw new Error("consumer callback failed"); });
    const nextError = vi.fn(), next = state.pool.register(centers(), vi.fn(), nextError);
    state.handle.request(request()); next.request(request());
    expect(() => state.worker.onerror?.(new ErrorEvent("error", { message: "worker failed" }))).not.toThrow();
    await expect(state.handle.firstSort).rejects.toThrow("worker failed");
    await expect(next.firstSort).rejects.toThrow("worker failed");
    expect(nextError).toHaveBeenCalledOnce();
    state.pool.dispose();
  });
});

describe("native worker counting-sort kernel", () => {
  it("retains all near layers with a distant environment and recycles only its exchange buffer", () => {
    const positions = centers(), kernel = new NativeCpuSortKernel(positions), exchange = new Uint32Array(3);
    expect(kernel.compute(request(), exchange)).toBe(exchange);
    expect([...exchange]).toEqual([2, 1, 0]);
    expect([...positions]).toEqual([...centers()]);
    kernel.dispose();
  });

  it("preserves source order inside identical bins and negative orthographic depths", () => {
    const kernel = new NativeCpuSortKernel(new Float32Array([0, 0, 4.99, 0, 0, 4.98, 0, 0, 4.98, 0, 0, -1400]));
    expect([...kernel.compute({ ...request(), nearDepth: -10 })]).toEqual([3, 1, 2, 0]);
    kernel.dispose();
  });

  it("rejects malformed geometry and nonfinite camera parameters", () => {
    expect(() => new NativeCpuSortKernel(new Float32Array([NaN, 0, 0]))).toThrow(/positions/);
    const kernel = new NativeCpuSortKernel(centers());
    expect(() => kernel.compute({ ...request(), farDepth: Infinity })).toThrow(/parameters/);
    kernel.dispose();
  });
});
