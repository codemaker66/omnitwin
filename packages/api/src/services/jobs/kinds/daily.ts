import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../../db/client.js";
import type { JobAlerts } from "../alerts.js";
import { describeInvariant, isHealthy, readJobListInvariant } from "../invariant.js";
import { defineJobKind, type JobContext, type JobKind, type JobRegistry } from "../kinds.js";
import { nextLocalTime } from "../local-time.js";
import type { RepeatingJob } from "../repeating.js";
import { enqueueJob } from "../store.js";

// ---------------------------------------------------------------------------
// The job list (T-702): the list's own daily run, at 03:00 UTC.
//
// Three things, each in its own short statement, outside any transaction:
//
//   1. Tidy: delete up to 1,000 `done` or `abandoned` rows that finished more
//      than 90 days ago. `dead` rows stay for a person to look at. A run that
//      deleted a full 1,000 asks for one more run at once, keyed
//      `more-after:<this run's id>`: a key no occurrence can have (those are
//      ISO instants), fresh for every run, and the same for every try of one
//      run, so a repeated try asks once. Its payload is this run's own
//      occurrence, which the kind's schema accepts.
//   2. Read the invariant (nothing stuck unseen). Unhealthy: log the four
//      counts, whether or not Sentry is on, and raise `listStuck` with them
//      (its own alert, `job.list-stuck`, not a fault of the worker's).
//   3. Check in, so Sentry alerts if a day passes without one.
//
// Safe to repeat: deleting what is gone deletes nothing, and the read and the
// check-in change nothing. Between statements it stops if told to.
// ---------------------------------------------------------------------------

export const DAILY_JOB_KIND = "jobs.daily";
export const DAILY_MONITOR = "job-list-daily";
/** The most rows one run deletes. */
export const TIDY_BATCH = 1000;
const MORE_KEY_PREFIX = "more-after:";

const DAILY_PAYLOAD = z.object({ occurrence: z.string().min(1).max(300) }).strict();
type DailyPayload = z.infer<typeof DAILY_PAYLOAD>;

const deletedRow = z.object({ deleted: z.number().int() });

/**
 * One bounded statement: at most TIDY_BATCH rows, skipping any another
 * statement holds. A row's age runs from the LATER of when it finished and
 * when a person closed it (GREATEST skips NULLs), so a dead job closed with a
 * note long after it died keeps that note for 90 days from the closing. No
 * order: ids are random, so any order means nothing, and without one the scan
 * stops at the batch's last match.
 */
async function tidyFinishedJobs(db: Database): Promise<number> {
  const result = await db.execute(sql`
    WITH old AS (
      SELECT id FROM jobs
      WHERE state IN ('done', 'abandoned')
        AND GREATEST(finished_at, resolved_at) < now() - interval '90 days'
      LIMIT ${TIDY_BATCH}
      FOR UPDATE SKIP LOCKED
    ),
    gone AS (DELETE FROM jobs WHERE id IN (SELECT id FROM old) RETURNING 1)
    SELECT count(*)::int AS deleted FROM gone`);
  const [raw] = result.rows;
  if (raw === undefined) throw new Error("The tidy statement returned no row");
  return deletedRow.parse(raw).deleted;
}

async function runDaily(
  ctx: JobContext<DailyPayload>,
  self: JobKind<DailyPayload>,
  deps: { readonly registry: () => JobRegistry; readonly alerts: JobAlerts },
): Promise<void> {
  const deleted = await tidyFinishedJobs(ctx.db);
  ctx.signal.throwIfAborted();
  if (deleted >= TIDY_BATCH) {
    await enqueueJob(ctx.db, self, { key: `${MORE_KEY_PREFIX}${ctx.jobId}`, payload: { occurrence: ctx.payload.occurrence } });
    ctx.signal.throwIfAborted();
  }

  const invariant = await readJobListInvariant(ctx.db, deps.registry());
  ctx.signal.throwIfAborted();
  if (isHealthy(invariant)) {
    ctx.logger.info({ ...invariant, deleted }, "the job list's daily check found nothing stuck");
  } else {
    ctx.logger.error({ ...invariant }, "the job list's daily check found work stuck unseen");
    deps.alerts.listStuck(describeInvariant(invariant));
  }

  deps.alerts.checkIn(DAILY_MONITOR);
}

/**
 * The daily run. `registry` is read when the run happens, so it can name the
 * registry this kind is itself part of.
 */
export function dailyJob(deps: { readonly registry: () => JobRegistry; readonly alerts: JobAlerts }): RepeatingJob {
  const kind: JobKind<DailyPayload> = defineJobKind<DailyPayload>({
    kind: DAILY_JOB_KIND,
    version: 1,
    scope: "platform",
    timeoutMs: 15_000,
    maxAttempts: 2,
    payload: DAILY_PAYLOAD,
    handler: (ctx) => runDaily(ctx, kind, deps),
  });
  return { kind, next: (after) => nextLocalTime(after, "03:00", "UTC") };
}
