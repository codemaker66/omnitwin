import type { NativeGpuWorkResult } from "./native-gpu-completion.js";

interface FrameTicket {
  readonly completion: Promise<void>;
  poll(): NativeGpuWorkResult;
}

interface NativeFramePacerOptions {
  readonly createTicket: (signal: AbortSignal) => FrameTicket;
  readonly invalidate: () => void;
  readonly onError: (error: Error) => void;
  readonly now?: () => number;
}

export interface NativeFramePacer {
  /** The callback draws current state now; it is never retained for a later frame.
   * Return false if rendering failed or its renderer was removed during the draw. */
  request(draw: () => boolean): void;
  dispose(): void;
}

interface PendingFrame {
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly ticket: FrameTicket;
}

/** Bound automatic main-view submissions while keeping R3F's frame updates live.
 * Explicit renderer.render calls, exports and source readiness remain independent.
 * Poll on an arriving frame so a fast GPU need not wait for the background poll. */
export function createNativeFramePacer(options: NativeFramePacerOptions): NativeFramePacer {
  const now = options.now ?? (() => performance.now());
  const pending = new Set<PendingFrame>();
  let capacity = 2;
  let consecutiveFast = 0;
  let dirty = false;
  let disposed = false;
  let drawing = false;
  // Polling, drawing and ticket creation may synchronously dispose their owner.
  // Read after each callback instead of relying on its earlier narrowed value.
  const isDisposed = (): boolean => disposed;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    dirty = false;
    const outstanding = [...pending];
    pending.clear();
    for (const frame of outstanding) frame.controller.abort();
  };

  const fail = (cause: unknown): void => {
    if (disposed) return;
    dispose();
    const error = cause instanceof Error ? cause : new Error("Native frame completion failed", { cause });
    try { options.onError(error); }
    catch { /* The failure observer cannot retain tickets or reject an async completion again. */ }
  };

  const wake = (): void => {
    if (disposed || !dirty || pending.size >= capacity) return;
    dirty = false;
    try { options.invalidate(); }
    catch (cause) { fail(cause); }
  };

  const retire = (frame: PendingFrame): boolean => {
    if (disposed || !pending.has(frame)) return true;
    let result: NativeGpuWorkResult;
    try { result = frame.ticket.poll(); }
    catch (cause) { fail(cause); return true; }
    if (result.status === "pending") return false;
    if (result.status === "failed") {
      fail(result.error);
      return true;
    }
    pending.delete(frame);
    const elapsed = Math.max(0, result.completedAt - frame.startedAt);
    if (elapsed > 50) {
      capacity = 1;
      consecutiveFast = 0;
    } else if (elapsed < 25) {
      consecutiveFast += 1;
      if (consecutiveFast >= 3) {
        capacity = 2;
        consecutiveFast = 0;
      }
    } else {
      consecutiveFast = 0;
    }
    return true;
  };

  return {
    dispose,
    request(draw) {
      if (disposed) return;
      if (drawing) { dirty = true; return; }
      // A real incoming frame already owns the wake. Retiring here must not
      // manufacture another invalidation when its completion microtask runs.
      for (const frame of [...pending]) retire(frame);
      if (isDisposed()) return;
      if (pending.size >= capacity) {
        dirty = true;
        return;
      }
      dirty = false;
      const startedAt = now();
      let drawn: boolean;
      drawing = true;
      try { drawn = draw(); }
      catch (cause) { fail(cause); return; }
      finally { drawing = false; }
      if (!drawn) { dispose(); return; }
      if (isDisposed()) return;
      const controller = new AbortController();
      let ticket: FrameTicket;
      try { ticket = options.createTicket(controller.signal); }
      catch (cause) { controller.abort(); fail(cause); return; }
      if (isDisposed()) {
        void ticket.completion.catch(() => undefined);
        controller.abort();
        return;
      }
      const frame: PendingFrame = { startedAt, controller, ticket };
      pending.add(frame);
      void ticket.completion.then(() => {
        if (disposed || !pending.has(frame)) return;
        if (!retire(frame)) {
          fail(new Error("Native GPU completion resolved without a terminal result"));
          return;
        }
        wake();
      }, (cause: unknown) => {
        if (!disposed && pending.has(frame)) fail(cause);
      });
    },
  };
}
