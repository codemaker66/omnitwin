// ---------------------------------------------------------------------------
// Long builds in short slices
//
// When the walls' relief arrives, the planner builds a good deal from it on
// the main thread: the relief as drawn (cut along the doorways' lines), the
// walls' geometry with every vertex's baked light, the section's cap and the
// slicer's index (hall-arrival.ts). Run at once, that was one task of 150 to
// 250 ms on a desktop CPU, and four to six times that on a phone: a frozen
// page just as the room appears. Each of those builds is written as a
// generator that yields every few hundred triangles; runSliced runs one in
// slices of about a frame's spare time, handing the thread back between them,
// and drain runs one to its end at once (tests, and anything that needs the
// result now).
// ---------------------------------------------------------------------------

/** A build that yields between its steps and returns its result. */
export type Steps<T> = Generator<void, T, void>;

/** Runs a build to its end at once. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}

/** Milliseconds of work a slice may run before it hands the thread back. */
export const SLICE_BUDGET_MS = 8;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Hands the main thread back for one task: a message to itself (a timeout's
 * minimum delay grows once timeouts nest), or a timeout where there is no
 * MessageChannel.
 */
export function yieldToMain(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => { setTimeout(resolve, 0); });
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Why a sliced build stopped early (its owner went away). */
export class SlicedBuildCancelled extends Error {
  constructor() {
    super("The sliced build was cancelled");
    this.name = "SlicedBuildCancelled";
  }
}

export interface SliceOptions {
  /** Milliseconds a slice may run (SLICE_BUDGET_MS). */
  readonly budgetMs?: number;
  /** Hands the thread back between slices (yieldToMain). */
  readonly yieldNow?: () => Promise<void>;
  /** Asked between slices: false stops the build (SlicedBuildCancelled). */
  readonly live?: () => boolean;
  /** Called with each slice's length, milliseconds (for measuring). */
  readonly onSlice?: (ms: number) => void;
}

/**
 * Runs a build in slices of about `budgetMs` each, yielding to the main
 * thread between them; resolves with its result. A slice always takes at
 * least one step, so it may overrun the budget by one step's length.
 */
export async function runSliced<T>(steps: Steps<T>, options: SliceOptions = {}): Promise<T> {
  const budget = options.budgetMs ?? SLICE_BUDGET_MS;
  const yieldNow = options.yieldNow ?? yieldToMain;
  for (;;) {
    if (options.live !== undefined && !options.live()) throw new SlicedBuildCancelled();
    const started = now();
    for (;;) {
      const next = steps.next();
      if (next.done === true) {
        options.onSlice?.(now() - started);
        return next.value;
      }
      if (now() - started >= budget) break;
    }
    options.onSlice?.(now() - started);
    await yieldNow();
  }
}
