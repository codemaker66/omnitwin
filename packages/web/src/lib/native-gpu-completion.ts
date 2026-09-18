import type { WebGPURenderer } from "three/webgpu";

const POLL_MS = 16;
const DEADLINE_MS = 30_000;

type CompletionRenderer = Pick<WebGPURenderer, "getContext" | "backend">;

type FenceContext = Pick<WebGL2RenderingContext,
  "fenceSync" | "deleteSync" | "flush" | "isContextLost" | "clientWaitSync"
  | "SYNC_GPU_COMMANDS_COMPLETE" | "ALREADY_SIGNALED" | "CONDITION_SATISFIED" | "TIMEOUT_EXPIRED">;
interface CompletionQueue { onSubmittedWorkDone(): PromiseLike<unknown> }
function isFenceContext(value: unknown): value is FenceContext {
  return typeof value === "object" && value !== null
    && "fenceSync" in value && typeof value.fenceSync === "function"
    && "deleteSync" in value && typeof value.deleteSync === "function"
    && "flush" in value && typeof value.flush === "function"
    && "isContextLost" in value && typeof value.isContextLost === "function"
    && "clientWaitSync" in value && typeof value.clientWaitSync === "function"
    && "SYNC_GPU_COMMANDS_COMPLETE" in value && typeof value.SYNC_GPU_COMMANDS_COMPLETE === "number"
    && "ALREADY_SIGNALED" in value && typeof value.ALREADY_SIGNALED === "number"
    && "CONDITION_SATISFIED" in value && typeof value.CONDITION_SATISFIED === "number"
    && "TIMEOUT_EXPIRED" in value && typeof value.TIMEOUT_EXPIRED === "number";
}
function isCompletionQueue(value: unknown): value is CompletionQueue {
  return typeof value === "object" && value !== null
    && "onSubmittedWorkDone" in value && typeof value.onSubmittedWorkDone === "function";
}


interface DeviceLossState {
  reason: Error | null;
  readonly listeners: Set<(reason: Error) => void>;
}
const deviceLosses = new WeakMap<object, DeviceLossState>();

function observeDeviceLoss(device: object, lost: object, callback: (reason: Error) => void): () => void {
  let state = deviceLosses.get(device);
  if (state === undefined) {
    state = { reason: null, listeners: new Set() };
    deviceLosses.set(device, state);
    const record = state;
    const notify = (): void => {
      record.reason = new Error("Native WebGPU device was lost while waiting for GPU readiness");
      for (const listener of record.listeners) listener(record.reason);
      record.listeners.clear();
    };
    // One loss subscription per device; completed waits remove their callbacks.
    void Promise.resolve(lost).then(notify, notify);
  }
  if (state.reason !== null) callback(state.reason);
  else state.listeners.add(callback);
  const listeners = state.listeners;
  return () => { listeners.delete(callback); };
}


/** Wait for submitted GPU work without blocking JS or changing render state.
 * This acknowledges raster completion, not browser compositor presentation. */
export function waitForNativeGpuWork(renderer: CompletionRenderer, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let cleanup = (): void => undefined;
    const finish = (reason?: unknown): void => {
      if (done) return;
      done = true;
      if (poll !== undefined) clearTimeout(poll);
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      let failure = reason;
      try { cleanup(); } catch (cleanupError: unknown) { failure ??= cleanupError ?? new Error("Native GPU fence cleanup failed"); }
      if (failure === undefined) resolve();
      else reject(failure instanceof Error ? failure : new Error(typeof failure === "string" ? failure : "Native GPU completion failed", { cause: failure }));
    };
    const abort = (): void => { finish(new DOMException("Native GPU readiness cancelled", "AbortError")); };
    const deadline = setTimeout(() => { finish(new Error("Native GPU work did not complete within 30 seconds")); }, DEADLINE_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      const context = renderer.getContext();
      if (isFenceContext(context)) {
        if (context.isContextLost()) throw new Error("Native WebGL context was lost before GPU readiness");
        const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence === null) throw new Error("Native WebGL could not create a readiness fence");
        cleanup = () => { context.deleteSync(fence); };
        context.flush();
        const check = (): void => {
          if (done) return;
          try {
            if (context.isContextLost()) throw new Error("Native WebGL context was lost while waiting for GPU readiness");
            const status = context.clientWaitSync(fence, 0, 0);
            if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) finish();
            else if (status === context.TIMEOUT_EXPIRED) poll = setTimeout(check, POLL_MS);
            else throw new Error("Native WebGL readiness fence failed");
          } catch (reason: unknown) { finish(reason ?? new Error("Native GPU completion failed")); }
        };
        // WebGL fences cannot signal until control has returned to the event loop.
        poll = setTimeout(check, POLL_MS);
      } else {
        const backend = renderer.backend;
        if (!("device" in backend) || typeof backend.device !== "object" || backend.device === null) {
          throw new Error("Native WebGPU readiness requires the active rendering device");
        }
        const device = backend.device;
        if (!("queue" in device) || !isCompletionQueue(device.queue)) {
          throw new Error("Native WebGPU queue does not support completion notifications");
        }
        const completed: unknown = device.queue.onSubmittedWorkDone();
        if (typeof completed !== "object" || completed === null || !("then" in completed) || typeof completed.then !== "function") {
          throw new Error("Native WebGPU queue returned an invalid completion notification");
        }
        void Promise.resolve(completed).then(() => { finish(); }, (reason: unknown) => { finish(reason ?? new Error("Native GPU completion failed")); });
        if ("lost" in device && typeof device.lost === "object" && device.lost !== null && "then" in device.lost && typeof device.lost.then === "function") {
          cleanup = observeDeviceLoss(device, device.lost, finish);
        }
      }
    } catch (reason: unknown) { finish(reason ?? new Error("Native GPU completion failed")); }
  });
}
