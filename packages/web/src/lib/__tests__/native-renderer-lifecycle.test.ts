import { describe, expect, it, vi } from "vitest";
import { createNativeRendererLifecycle } from "../native-renderer-lifecycle.js";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve = (): void => { throw new Error("Not initialized"); };
  let reject = (_error: Error): void => { throw new Error("Not initialized"); };
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("native renderer ownership", () => {
  it("waits for backend readiness before announcing ready and releases exactly once", async () => {
    const pending = deferred();
    const dispose = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    const onError = vi.fn();
    const owner = createNativeRendererLifecycle({ initialize: () => pending.promise, dispose, onReady, onError });
    expect(onReady).not.toHaveBeenCalled();
    pending.resolve();
    await owner.settled;
    expect(onReady).toHaveBeenCalledOnce();
    owner.cancel();
    owner.cancel();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("unmount during initialization disposes the eventual device without announcing ready", async () => {
    const pending = deferred();
    const dispose = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    const onError = vi.fn();
    const owner = createNativeRendererLifecycle({ initialize: () => pending.promise, dispose, onReady, onError });
    owner.cancel();
    expect(dispose).not.toHaveBeenCalled();
    pending.resolve();
    await owner.settled;
    expect(dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports initialization failure and cleans partial backend resources", async () => {
    const error = new Error("GPU unavailable");
    const dispose = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    const onError = vi.fn();
    const owner = createNativeRendererLifecycle({
      initialize: () => Promise.reject(error), dispose, onReady, onError,
    });
    await owner.settled;
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(false);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("suppresses late errors after cancellation and absorbs failed disposal", async () => {
    const pending = deferred();
    const onError = vi.fn();
    const owner = createNativeRendererLifecycle({
      initialize: () => pending.promise,
      dispose: () => Promise.reject(new Error("Device already lost")),
      onReady: vi.fn(), onError,
    });
    owner.cancel();
    pending.reject(new Error("Adapter failed after navigation"));
    await expect(owner.settled).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it("retires a running renderer only once its resources are actually released", async () => {
    const released = deferred();
    const dispose = vi.fn(() => released.promise);
    const owner = createNativeRendererLifecycle({ initialize: () => Promise.resolve(), dispose, onReady: vi.fn(), onError: vi.fn() });
    await owner.settled;
    let retired = false;
    const retirement = owner.retire().then(() => { retired = true; });
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(retired).toBe(false);
    released.resolve();
    await retirement;
    expect(retired).toBe(true);
    await owner.retire();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("retires a renderer still initializing after its init settles, without announcing it ready", async () => {
    const pending = deferred();
    const dispose = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    const owner = createNativeRendererLifecycle({ initialize: () => pending.promise, dispose, onReady, onError: vi.fn() });
    const retirement = owner.retire();
    pending.resolve();
    await retirement;
    expect(dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("releases the initialized device if installing the ready scene throws", async () => {
    const error = new Error("Scene attachment failed");
    const dispose = vi.fn(() => Promise.resolve());
    const onError = vi.fn();
    const owner = createNativeRendererLifecycle({
      initialize: () => Promise.resolve(), dispose, onError,
      onReady: () => { throw error; },
    });
    await owner.settled;
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(true);
  });
});
