import type { JobAlerts } from "./alerts.js";
import { jobErrorText, type JobExecutor, type JobKind, type JobLogger } from "./kinds.js";
import { enqueueJob } from "./store.js";

// ---------------------------------------------------------------------------
// The job list (T-702): work that repeats.
//
// A repeating kind is never "scheduled" anywhere but on the list itself: its
// next run is a job, keyed by the ISO instant of that run. Every server asks
// for the same next run, the (kind, key) rule lets exactly one write succeed,
// and the others change nothing. The worker asks at the end of every pass, so
// the next run is written as soon as the current one is taken, and a run that
// ends dead does not end the series.
//
// A kind whose `next` throws, or gives an instant that is not after now, is
// skipped and reported, and the other kinds still get their runs: one faulty
// kind must neither stop the pass on every server nor write a due run under a
// new key on every pass.
// ---------------------------------------------------------------------------

export interface RepeatingJob {
  readonly kind: JobKind<{ readonly occurrence: string }>;
  /**
   * The next run strictly after `after`. It must return an instant after
   * `after`: a kind whose `next` throws, or returns one that is not, is skipped
   * and reported, and gets no run.
   */
  readonly next: (after: Date) => Date;
}

/** A repeating kind that was given no next run, and why (text already through `jobErrorText`). */
export interface SkippedRun {
  readonly kind: string;
  readonly reason: string;
}

const NOT_AFTER_NOW = "its next run is not after now";

/** The kind's next run after `now`, or why it has none. Never throws. */
function plannedRun(
  job: RepeatingJob,
  now: Date,
): { readonly runAt: Date; readonly key: string } | { readonly skipped: SkippedRun } {
  try {
    const runAt = job.next(now);
    const at = runAt.getTime();
    // An invalid date is NaN, which is after nothing.
    if (Number.isNaN(at) || at <= now.getTime()) {
      return { skipped: { kind: job.kind.kind, reason: NOT_AFTER_NOW } };
    }
    return { runAt, key: runAt.toISOString() };
  } catch (error: unknown) {
    return { skipped: { kind: job.kind.kind, reason: jobErrorText(error) } };
  }
}

/**
 * Makes sure each repeating kind has its next run on the list, written
 * through `executor` (the worker gives one of its own bounded transactions).
 * Key: the ISO instant of that run. `now` is the caller's: the worker passes
 * the database's own now. The kinds must be platform kinds: a run carries no
 * venue. Returns the kinds it skipped because their `next` failed; a failure
 * to write a run still rejects.
 */
export async function ensureNextRuns(
  executor: JobExecutor,
  repeating: readonly RepeatingJob[],
  now: Date,
): Promise<readonly SkippedRun[]> {
  const skipped: SkippedRun[] = [];
  for (const job of repeating) {
    const planned = plannedRun(job, now);
    if ("skipped" in planned) {
      skipped.push(planned.skipped);
      continue;
    }
    // Outside the kind's own check: a database failure is still a database fault.
    await enqueueJob(executor, job.kind, { key: planned.key, runAt: planned.runAt, payload: { occurrence: planned.key } });
  }
  return skipped;
}

/**
 * The worker's `afterPass`: `ensureNextRuns` through the transaction the
 * worker gives it, then each skipped kind is logged at error level every
 * time, and `listStuck` is raised once for each such kind in this process's
 * life. A failure to write a run still rejects, which the worker counts as a
 * database fault.
 */
export function nextRunsKeeper(
  repeating: readonly RepeatingJob[],
  logger: JobLogger,
  alerts: JobAlerts,
): (now: Date, executor: JobExecutor) => Promise<void> {
  const told = new Set<string>();
  return async (now, executor) => {
    const skipped = await ensureNextRuns(executor, repeating, now);
    for (const { kind, reason } of skipped) {
      logger.error({ kind, error: reason }, "a repeating kind has no next run");
      if (told.has(kind)) continue;
      told.add(kind);
      alerts.listStuck(`The repeating kind ${kind} has no next run: ${reason}`);
    }
  };
}
