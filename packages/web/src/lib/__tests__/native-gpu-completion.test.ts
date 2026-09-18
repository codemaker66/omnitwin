import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, RenderTarget, Scene } from "three";
import { WebGPURenderer } from "three/webgpu";
import { waitForNativeGpuWork } from "../native-gpu-completion.js";
import { afterNativeCanvasGpuWork, withNativeRenderScope } from "../native-renderer.js";

function webgl() {
  const renderer = new WebGPURenderer({ forceWebGL: true });
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 37143, ALREADY_SIGNALED: 37146, CONDITION_SATISFIED: 37148, TIMEOUT_EXPIRED: 37147,
    fenceSync: vi.fn(() => ({})), deleteSync: vi.fn(), flush: vi.fn(), isContextLost: vi.fn(() => false),
    clientWaitSync: vi.fn(() => 37147),
  };
  vi.spyOn(renderer, "getContext").mockReturnValue(gl);
  return { renderer, gl };
}

function webgpu() {
  const renderer = new WebGPURenderer();
  let resolve = (): void => { throw new Error("Completion promise not initialized"); };
  let reject = (_reason: Error): void => { throw new Error("Completion promise not initialized"); };
  let lose = (): void => { throw new Error("Loss promise not initialized"); };
  const submitted = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const lost = new Promise<void>((yes) => { lose = yes; });
  const queue = { onSubmittedWorkDone: vi.fn(() => submitted) };
  Object.assign(renderer.backend, { device: { queue, lost } });
  vi.spyOn(renderer, "getContext").mockReturnValue({});
  return { renderer, queue, resolve, reject, lose };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("native GPU completion", () => {
  it("flushes one fence and polls without blocking, then releases it exactly once", async () => {
    const { renderer, gl } = webgl(), done = vi.fn();
    const waiting = waitForNativeGpuWork(renderer, new AbortController().signal).then(done);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(32);
    expect(done).not.toHaveBeenCalled();
    expect(gl.clientWaitSync).toHaveBeenLastCalledWith(expect.any(Object), 0, 0);
    gl.clientWaitSync.mockReturnValue(gl.CONDITION_SATISFIED);
    await vi.advanceTimersByTimeAsync(16); await waiting;
    expect(done).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a cleanup failure exactly once instead of leaving readiness pending", async () => {
    const { renderer, gl } = webgl(), done = vi.fn(), failed = vi.fn();
    gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    gl.deleteSync.mockImplementation(() => { throw new Error("fence cleanup failed"); });
    const result = waitForNativeGpuWork(renderer, new AbortController().signal).then(done, failed);
    await vi.advanceTimersByTimeAsync(16); await result;
    expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "fence cleanup failed" }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failed).toHaveBeenCalledOnce(); expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels polling and releases the fence without a late completion", async () => {
    const { renderer, gl } = webgl(), controller = new AbortController();
    const result = waitForNativeGpuWork(renderer, controller.signal).catch((reason: unknown) => reason);
    controller.abort(); controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not allocate work for an already cancelled owner", async () => {
    const { renderer, gl } = webgl(), controller = new AbortController(); controller.abort();
    await expect(waitForNativeGpuWork(renderer, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(gl.fenceSync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a stalled fence after the product deadline and stops polling", async () => {
    const { renderer, gl } = webgl();
    const result = waitForNativeGpuWork(renderer, new AbortController().signal).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ message: "Native GPU work did not complete within 30 seconds" });
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects context loss without marking work ready", async () => {
    const { renderer, gl } = webgl();
    const result = waitForNativeGpuWork(renderer, new AbortController().signal).catch((reason: unknown) => reason);
    gl.isContextLost.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(16);
    expect(await result).toMatchObject({ message: expect.stringContaining("context was lost") });
    expect(gl.deleteSync).toHaveBeenCalledOnce();
  });

  it("waits for the actual WebGPU queue and rejects queue errors or device loss", async () => {
    const state = webgpu(), done = vi.fn();
    const waiting = waitForNativeGpuWork(state.renderer, new AbortController().signal).then(done);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    state.resolve(); await waiting; expect(done).toHaveBeenCalledOnce();
    expect(state.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    const failed = webgpu();
    const rejected = waitForNativeGpuWork(failed.renderer, new AbortController().signal);
    failed.reject(new Error("queue failed")); await expect(rejected).rejects.toThrow("queue failed");
    const lost = webgpu();
    const lostResult = waitForNativeGpuWork(lost.renderer, new AbortController().signal);
    lost.lose(); await expect(lostResult).rejects.toThrow("device was lost");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps aborted WebGPU waits cancelled after a late queue resolution or rejection", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const state = webgpu(), controller = new AbortController();
      const done = vi.fn(), failed = vi.fn();
      const result = waitForNativeGpuWork(state.renderer, controller.signal).then(done, failed);
      controller.abort(); await result;
      if (outcome === "resolve") state.resolve();
      else state.reject(new Error("late device failure"));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledOnce();
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("starts only after the entire successful main render, including a nested offscreen pass", async () => {
    const state = webgpu(), scene = new Scene(), camera = new PerspectiveCamera();
    const complete = vi.fn(), failed = vi.fn(), controller = new AbortController();
    const offscreen = new RenderTarget(1, 1);
    withNativeRenderScope(state.renderer, scene, camera, () => {
      expect(afterNativeCanvasGpuWork(state.renderer, scene, camera, controller.signal, complete, failed)).toBe(true);
      state.renderer.setRenderTarget(offscreen);
      withNativeRenderScope(state.renderer, scene, camera, () => {
        expect(afterNativeCanvasGpuWork(state.renderer, scene, camera, controller.signal, complete, failed)).toBe(false);
      });
      state.renderer.setRenderTarget(null);
      expect(state.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
    expect(state.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    state.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(complete).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
    withNativeRenderScope(state.renderer, scene, camera, () => undefined);
    expect(state.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    offscreen.dispose();
  });

  it("never treats a nested null-target render as a completed main frame", () => {
    const state = webgpu(), scene = new Scene(), camera = new PerspectiveCamera();
    const complete = vi.fn(), failed = vi.fn();
    expect(() => { withNativeRenderScope(state.renderer, scene, camera, () => {
      withNativeRenderScope(state.renderer, scene, camera, () => {
        expect(afterNativeCanvasGpuWork(state.renderer, scene, camera, new AbortController().signal, complete, failed)).toBe(false);
      });
      expect(state.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
      throw new Error("outer draw failed");
    }); }).toThrow("outer draw failed");
    expect(complete).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    expect(state.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
  });

  it("routes asynchronous callback exceptions through the renderer lifecycle", async () => {
    const state = webgpu(), scene = new Scene(), camera = new PerspectiveCamera();
    const error = vi.spyOn(state.renderer, "onError").mockImplementation(() => undefined);
    withNativeRenderScope(state.renderer, scene, camera, () => {
      afterNativeCanvasGpuWork(state.renderer, scene, camera, new AbortController().signal,
        () => { throw new Error("readiness callback failed"); }, () => undefined);
    });
    state.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith("Native GPU readiness callback failed: readiness callback failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards completion work if rendering throws, and excludes unscoped callbacks", () => {
    const state = webgpu(), scene = new Scene(), camera = new PerspectiveCamera();
    const complete = vi.fn(), failed = vi.fn(() => { throw new Error("secondary handler failed"); }), controller = new AbortController();
    const report = vi.spyOn(state.renderer, "onError").mockImplementation(() => undefined);
    expect(afterNativeCanvasGpuWork(state.renderer, scene, camera, controller.signal, complete, failed)).toBe(false);
    expect(() => { withNativeRenderScope(state.renderer, scene, camera, () => {
      afterNativeCanvasGpuWork(state.renderer, scene, camera, controller.signal, complete, failed);
      throw new Error("draw failed");
    }); }).toThrow("draw failed");
    expect(state.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "draw failed" }));
    expect(report).toHaveBeenCalledWith("Native GPU readiness callback failed: secondary handler failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
