import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { DataTexture, PerspectiveCamera, Scene, WebGLRenderer } from "three";

interface WorkerRequest { id: number; name: string; args: Record<string, unknown> }
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: { data: { id: number; result?: unknown; error?: unknown } }) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminate = vi.fn();
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(request: WorkerRequest) { this.requests.push(request); }
  reply(result: unknown) { this.onmessage?.({ data: { id: this.requests.at(-1)!.id, result } }); }
  fail(error: Error) { this.onmessage?.({ data: { id: this.requests.at(-1)!.id, error } }); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Exercise the real pinned vendor methods. Only the browser Worker transport
// and GPU readback are controlled; mocking SparkRenderer would miss this race.
function invoke(spark: SparkRenderer, method: string, ...args: unknown[]): Promise<void> {
  return Reflect.apply(Reflect.get(spark, method) as (...values: unknown[]) => Promise<void>, spark, args);
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  const onDirty = vi.fn();
  const spark = new SparkRenderer({ renderer, onDirty, lodRaycast: 0 });
  const resources = [...new Set([spark.display, spark.current, ...spark.accumulators])]
    .map(accumulator => vi.spyOn(accumulator, "dispose"));
  Reflect.set(spark, "readbackDepth", vi.fn(() => Promise.resolve(new Uint32Array())));
  Reflect.set(spark, "dirty", false);
  Reflect.set(spark, "readPause", 0);
  Reflect.set(spark, "lodDirty", true);
  Reflect.set(spark, "sortDirty", true);
  return { spark, onDirty, resources };
}
function worker() { return ControlledWorker.instances.at(-1)!; }
function sort(spark: SparkRenderer) { return invoke(spark, "driveSort"); }

beforeEach(() => { ControlledWorker.instances = []; vi.stubGlobal("Worker", ControlledWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Spark 2.1 renderer lifecycle patch", () => {
  it("cancels owned pause and queued update/sort timers before GPU work starts", async () => {
    vi.useFakeTimers();
    const { spark, resources, onDirty } = fixture();
    Reflect.set(spark, "readPause", 1000);
    Reflect.set(spark, "updateTimeoutId", setTimeout(() => { throw new Error("late update"); }, 100));
    const pending = sort(spark);
    spark.dispose(); spark.dispose();
    await pending;
    expect(Reflect.get(spark, "readbackDepth")).not.toHaveBeenCalled();
    expect(ControlledWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(resources.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(onDirty).not.toHaveBeenCalled();
    await spark.update({ scene: new Scene(), camera: new PerspectiveCamera() });
    expect(Reflect.get(spark, "sorting")).toBe(false);
  });

  it("clears a throttled sort timer without starting a worker", async () => {
    vi.useFakeTimers();
    const { spark } = fixture();
    Reflect.set(spark, "lastSortTime", performance.now() + 100);
    Reflect.set(spark, "minSortIntervalMs", 1000);
    await sort(spark);
    expect(vi.getTimerCount()).toBe(1);
    spark.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(ControlledWorker.instances).toHaveLength(0);
  });

  it("keeps GPU targets until pending readback settles, then releases once", async () => {
    const { spark, resources, onDirty } = fixture();
    const readback = deferred<Uint32Array>();
    Reflect.set(spark, "readbackDepth", () => readback.promise);
    const pending = sort(spark);
    spark.dispose(); spark.dispose();
    expect(resources.every(dispose => dispose.mock.calls.length === 0)).toBe(true);
    readback.resolve(new Uint32Array());
    await pending;
    expect(resources.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(ControlledWorker.instances).toHaveLength(0);
    expect(onDirty).not.toHaveBeenCalled();
    expect(Reflect.get(spark, "sorting")).toBe(false);
  });

  it("handles its own pending sort RPC cancellation without late writes", async () => {
    const { spark, onDirty } = fixture();
    const pending = sort(spark);
    await flush();
    expect(worker().requests[0]?.name).toBe("sortSplats32");
    spark.dispose(); spark.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(spark.orderingTexture).toBeNull();
    expect(onDirty).not.toHaveBeenCalled();
    expect(Reflect.get(spark, "sorting")).toBe(false);
  });

  it.each(["rejected fence", "scheduling exception"])("drains real readback layers after a %s", async failureKind => {
    const { spark, resources } = fixture();
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const failure = new Error("GPU context lost");
    // Use the real vendor readbackDepth implementation with two GPU fence seams.
    Reflect.deleteProperty(spark, "readbackDepth");
    Reflect.set(spark, "saveRenderState", () => ({}));
    Reflect.set(spark, "resetRenderState", vi.fn());
    Reflect.set(spark.renderer, "setRenderTarget", vi.fn());
    const readPixels = vi.fn().mockReturnValueOnce(first.promise);
    if (failureKind === "rejected fence") readPixels.mockReturnValueOnce(second.promise);
    else readPixels.mockImplementationOnce(() => { throw failure; });
    Reflect.set(spark.renderer, "readRenderTargetPixelsAsync", readPixels);
    Reflect.set(spark, "flushAfterRead", false);
    Reflect.set(spark.current, "target", { dispose: vi.fn() });
    Reflect.set(spark.current, "numSplats", 2048 * 2048 + 1);
    Reflect.set(spark.current, "maxSplats", 2048 * 2048 + 2048);
    const pending = sort(spark);
    const rejected = expect(pending).rejects.toBe(failure);
    expect(readPixels).toHaveBeenCalledTimes(2);
    spark.dispose();
    if (failureKind === "rejected fence") first.reject(failure);
    await flush();
    expect(resources.every(dispose => dispose.mock.calls.length === 0)).toBe(true);
    if (failureKind === "rejected fence") second.resolve(new Uint8Array());
    else first.resolve(new Uint8Array());
    await rejected;
    expect(resources.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(ControlledWorker.instances).toHaveLength(0);
  });

  it("releases existing LOD textures once when clearing their mappings", () => {
    const { spark } = fixture();
    const texture = new DataTexture();
    const dispose = vi.spyOn(texture, "dispose");
    const mesh = Object.create(SplatMesh.prototype) as SplatMesh;
    spark.lodInstances.set(mesh, { lodId: 1, numSplats: 0, indices: new Uint32Array(), texture });
    spark.dispose(); spark.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(spark.lodInstances.size).toBe(0);
  });

  it.each(["sortPause", "sortDelay"])("cancels the owned %s timer", async delay => {
    vi.useFakeTimers();
    const { spark } = fixture();
    Reflect.set(spark, delay, 1000);
    const pending = sort(spark);
    await flush();
    if (delay === "sortDelay") {
      worker().reply({ readback: new Uint32Array(), ordering: new Uint32Array(16384), activeSplats: 0 });
      await flush();
    }
    expect(vi.getTimerCount()).toBe(1);
    spark.dispose();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(spark.orderingTexture).toBeNull();
  });

  it("handles a real pending LOD RPC and cannot revive disposed mappings", async () => {
    const { spark, onDirty } = fixture();
    Reflect.set(spark, "lodDirty", true);
    const pending = invoke(spark, "driveLod", {
      visibleGenerators: [], camera: new PerspectiveCamera(), scene: new Scene(),
    });
    await flush();
    expect(worker().requests[0]?.name).toBe("traverseLodTrees");
    spark.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect(spark.lodInstances.size).toBe(0);
    expect(onDirty).not.toHaveBeenCalled();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["sort", "lod"])("ignores a completed %s response when disposal wins the continuation", async kind => {
    const { spark, onDirty } = fixture();
    const pending = kind === "sort" ? sort(spark) : invoke(spark, "driveLod", {
      visibleGenerators: [], camera: new PerspectiveCamera(), scene: new Scene(),
    });
    await flush();
    worker().reply(kind === "sort"
      ? { readback: new Uint32Array(), ordering: new Uint32Array(16384), activeSplats: 7 }
      : { keyIndices: {}, chunks: [], pixelLimit: 0 });
    spark.dispose();
    await pending;
    expect(spark.activeSplats).toBe(0);
    expect(spark.orderingTexture).toBeNull();
    expect(spark.lodInstances.size).toBe(0);
    expect(onDirty).not.toHaveBeenCalled();
  });

  it.each(["readback", "sort", "lod"])("propagates unexpected %s failure, including after disposal", async kind => {
    const { spark } = fixture();
    // An ordinary error with the same text must not become owned cancellation.
    const failure = new Error(kind === "sort" ? "Worker terminate" : "unexpected failure");
    let pending: Promise<void>;
    if (kind === "readback") {
      const readback = deferred<Uint32Array>();
      Reflect.set(spark, "readbackDepth", () => readback.promise);
      pending = sort(spark);
      spark.dispose();
      readback.reject(failure);
    } else {
      pending = kind === "sort" ? sort(spark) : invoke(spark, "driveLod", {
        visibleGenerators: [], camera: new PerspectiveCamera(), scene: new Scene(),
      });
      await flush();
      worker().fail(failure);
      spark.dispose();
    }
    await expect(pending).rejects.toBe(failure);
    expect(Reflect.get(spark, "sorting")).toBe(false);
  });

  it("retains ordinary completion and allows a fresh renderer after teardown", async () => {
    fixture().spark.dispose();
    const { spark, onDirty } = fixture();
    const pending = sort(spark);
    await flush();
    worker().reply({ readback: new Uint32Array(), ordering: new Uint32Array(16384), activeSplats: 7 });
    await pending;
    expect(spark.activeSplats).toBe(7);
    expect(spark.orderingTexture).toBeInstanceOf(DataTexture);
    expect(onDirty).toHaveBeenCalledTimes(1);
    const textureDispose = vi.spyOn(spark.orderingTexture!, "dispose");
    spark.dispose(); spark.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
