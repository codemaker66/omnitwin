/**
 * Own an asynchronous graphics backend independently of React's mount timing.
 * Cancellation must wait for init: Three's dispose() cannot release a device
 * which is still being acquired and its failed-init path restarts init.
 */
export interface NativeRendererLifecycle {
  readonly settled: Promise<void>;
  cancel(): void;
}

interface NativeRendererLifecycleOptions {
  readonly initialize: () => Promise<void>;
  readonly dispose: (initialized: boolean) => Promise<void>;
  readonly onReady: () => void;
  readonly onError: (error: Error) => void;
}

export function nativeRendererError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createNativeRendererLifecycle({
  initialize, dispose, onReady, onError,
}: NativeRendererLifecycleOptions): NativeRendererLifecycle {
  let cancelled = false;
  let initialized = false;
  let finished = false;
  let disposal: Promise<void> | null = null;
  const release = (): Promise<void> => {
    disposal ??= dispose(initialized).catch(() => {
      // A lost GPU may reject disposal too. There is no longer a live view to
      // update; cancellation must never create an unhandled rejection.
    });
    return disposal;
  };

  const settled = Promise.resolve().then(initialize).then(() => {
    initialized = true;
    finished = true;
    if (cancelled) return release();
    onReady();
    return undefined;
  }).catch((error: unknown) => {
    finished = true;
    if (!cancelled) onError(nativeRendererError(error));
    return release();
  });

  return {
    settled,
    cancel() {
      cancelled = true;
      if (finished) void release();
    },
  };
}
