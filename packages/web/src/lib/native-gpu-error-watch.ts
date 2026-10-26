/**
 * Uncaptured GPU errors (WebGPU validation, out-of-memory, internal) are not a
 * lost device. Three r186 forwards every one through `renderer.onError` and
 * documents it as non-escalating: one bad upload or draw is usually followed
 * by perfectly good frames. A view is broken only when the errors keep coming
 * and no frame gets through cleanly for a while.
 *
 * A device reports a frame's errors when it processes that frame's commands,
 * ahead of the frame's work completing, and only when it is ticked: an idle
 * device delivers nothing (measured in Chromium, 26 October). So a frame has
 * got through once its own GPU work has completed and no error followed for
 * `NATIVE_GPU_HEALTHY_FRAME_MS`, however long a busy GPU took over it.
 */

/** How long errors may continue with no healthy frame before the view is broken. */
export const NATIVE_GPU_ERROR_GRACE_MS = 3_000;
/** After a frame's GPU work completes, this long without a further error means it got through. */
export const NATIVE_GPU_HEALTHY_FRAME_MS = 250;
/** Distinct messages reported per view; a broken scene can word one fault many ways. */
export const NATIVE_GPU_ERROR_REPORT_LIMIT = 5;

export interface NativeGpuErrorWatch {
  /** An uncaptured error on the current renderer. True the first time this message is seen (up to the limit): report it. */
  error(message: string): boolean;
  /**
   * A main frame was drawn on the current renderer. `work` starts waiting for
   * that frame's GPU completion; it is called only while errors are being judged.
   */
  drawn(work: () => PromiseLike<void>): void;
  /** The view has a new renderer: its predecessor's errors no longer count. Reported messages stay reported. */
  reset(): void;
  dispose(): void;
}

export interface NativeGpuErrorWatchOptions {
  /** Errors outlasted the grace period with no healthy frame; `message` is the latest. */
  readonly onBroken: (message: string) => void;
  /** Ask for a fresh frame, the one that shows whether the view still draws. */
  readonly redraw: () => void;
  /** A hidden page draws nothing, so nothing can get through: the grace waits. Defaults to the document's visibility. */
  readonly isHidden?: () => boolean;
}

/** A drawn frame waiting to prove it got through: first its GPU work, then the quiet tail. */
interface Settling { tail: ReturnType<typeof setTimeout> | null }

interface ErrorEpisode {
  latest: string;
  /** The grace period is over; the next error, or a pending frame's failure, breaks the view. */
  expired: boolean;
  grace: ReturnType<typeof setTimeout>;
  settling: Settling | null;
}

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function createNativeGpuErrorWatch({
  onBroken, redraw, isHidden = documentHidden,
}: NativeGpuErrorWatchOptions): NativeGpuErrorWatch {
  const reported = new Set<string>();
  let episode: ErrorEpisode | null = null;
  let disposed = false;

  const stopSettling = (current: ErrorEpisode): void => {
    const tail = current.settling?.tail;
    if (tail !== undefined && tail !== null) clearTimeout(tail);
    current.settling = null;
  };

  const close = (): void => {
    if (episode === null) return;
    clearTimeout(episode.grace);
    stopSettling(episode);
    episode = null;
  };

  const broken = (): void => {
    if (episode === null) return;
    const { latest } = episode;
    close();
    onBroken(latest);
  };

  const graceOver = (): void => {
    if (episode === null) return;
    // Nothing draws while the page is hidden, so nothing could have got through: judge once it is shown.
    if (isHidden()) {
      episode.grace = setTimeout(graceOver, NATIVE_GPU_ERROR_GRACE_MS);
      return;
    }
    // A frame still proving itself decides; with none, nothing got through.
    if (episode.settling === null) broken();
    else episode.expired = true;
  };

  return {
    error(message) {
      if (disposed) return false;
      const first = !reported.has(message) && reported.size < NATIVE_GPU_ERROR_REPORT_LIMIT;
      if (first) reported.add(message);
      if (episode === null) {
        episode = { latest: message, expired: false, settling: null, grace: setTimeout(graceOver, NATIVE_GPU_ERROR_GRACE_MS) };
      } else {
        episode.latest = message;
        stopSettling(episode);
        if (episode.expired) {
          broken();
          return first;
        }
      }
      redraw();
      return first;
    },
    drawn(work) {
      if (disposed || episode === null || episode.settling !== null) return;
      const current = episode;
      const settling: Settling = { tail: null };
      current.settling = settling;
      const proving = (): boolean => episode === current && current.settling === settling;
      void Promise.resolve(work()).then(() => {
        if (proving()) settling.tail = setTimeout(close, NATIVE_GPU_HEALTHY_FRAME_MS);
      }, () => {
        // A frame whose work never completed proves nothing.
        if (!proving()) return;
        current.settling = null;
        if (current.expired) broken();
      });
    },
    reset: close,
    dispose() {
      disposed = true;
      close();
    },
  };
}
