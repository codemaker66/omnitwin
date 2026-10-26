/**
 * Uncaptured GPU errors (WebGPU validation, out-of-memory, internal) are not a
 * lost device. Three r186 forwards every one through `renderer.onError` and
 * documents it as non-escalating: one bad upload or draw is usually followed
 * by perfectly good frames. A view is broken only when the errors keep coming
 * and no frame gets through cleanly for a while.
 *
 * Errors arrive asynchronously, a frame or two after the submission that
 * caused them, so a frame counts as healthy once it has drawn and no further
 * error has followed it for `NATIVE_GPU_HEALTHY_FRAME_MS`.
 */

/** How long errors may continue with no healthy frame before the view is broken. */
export const NATIVE_GPU_ERROR_GRACE_MS = 3_000;
/** A frame drawn this long without a further error got through. */
export const NATIVE_GPU_HEALTHY_FRAME_MS = 250;
/** Distinct messages reported per view; a broken scene can word one fault many ways. */
export const NATIVE_GPU_ERROR_REPORT_LIMIT = 5;

export interface NativeGpuErrorWatch {
  /** An uncaptured error on the current renderer. True the first time this message is seen (up to the limit): report it. */
  error(message: string): boolean;
  /** A main frame was drawn on the current renderer. */
  drawn(): void;
  /** The view has a new renderer: its predecessor's errors no longer count. Reported messages stay reported. */
  reset(): void;
  dispose(): void;
}

export interface NativeGpuErrorWatchOptions {
  /** Errors outlasted the grace period with no healthy frame; `message` is the latest. */
  readonly onBroken: (message: string) => void;
  /** Ask for a fresh frame, the one that shows whether the view still draws. */
  readonly redraw: () => void;
}

interface ErrorEpisode {
  latest: string;
  /** The grace period is over; the next error, or a pending frame's failure, breaks the view. */
  expired: boolean;
  grace: ReturnType<typeof setTimeout>;
  /** A frame drawn since the latest error, waiting to prove it got through. */
  settling: ReturnType<typeof setTimeout> | null;
}

export function createNativeGpuErrorWatch({ onBroken, redraw }: NativeGpuErrorWatchOptions): NativeGpuErrorWatch {
  const reported = new Set<string>();
  let episode: ErrorEpisode | null = null;
  let disposed = false;

  const close = (): void => {
    if (episode === null) return;
    clearTimeout(episode.grace);
    if (episode.settling !== null) clearTimeout(episode.settling);
    episode = null;
  };

  const broken = (): void => {
    if (episode === null) return;
    const { latest } = episode;
    close();
    onBroken(latest);
  };

  return {
    error(message) {
      if (disposed) return false;
      const first = !reported.has(message) && reported.size < NATIVE_GPU_ERROR_REPORT_LIMIT;
      if (first) reported.add(message);
      if (episode === null) {
        episode = {
          latest: message, expired: false, settling: null,
          grace: setTimeout(() => {
            if (episode === null) return;
            // A frame still proving itself decides; with none, nothing got through.
            if (episode.settling === null) broken();
            else episode.expired = true;
          }, NATIVE_GPU_ERROR_GRACE_MS),
        };
      } else {
        episode.latest = message;
        if (episode.settling !== null) {
          clearTimeout(episode.settling);
          episode.settling = null;
        }
        if (episode.expired) {
          broken();
          return first;
        }
      }
      redraw();
      return first;
    },
    drawn() {
      if (disposed || episode === null || episode.settling !== null) return;
      episode.settling = setTimeout(close, NATIVE_GPU_HEALTHY_FRAME_MS);
    },
    reset: close,
    dispose() {
      disposed = true;
      close();
    },
  };
}
