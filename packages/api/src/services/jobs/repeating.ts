import type { Database } from "../../db/client.js";
import type { JobKind } from "./kinds.js";
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
// ---------------------------------------------------------------------------

export interface RepeatingJob {
  readonly kind: JobKind<{ readonly occurrence: string }>;
  /** The next run strictly after `after`. */
  readonly next: (after: Date) => Date;
}

/**
 * Makes sure each repeating kind has its next run on the list. Key: the ISO
 * instant of that run. `now` is the caller's: the worker passes the
 * database's own now. The kinds must be platform kinds: a run carries no venue.
 */
export async function ensureNextRuns(db: Database, repeating: readonly RepeatingJob[], now: Date): Promise<void> {
  for (const job of repeating) {
    const runAt = job.next(now);
    const key = runAt.toISOString();
    await enqueueJob(db, job.kind, { key, runAt, payload: { occurrence: key } });
  }
}
