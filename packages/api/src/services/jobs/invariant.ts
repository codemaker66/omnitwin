import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { JobExecutor, JobRegistry } from "./kinds.js";

// ---------------------------------------------------------------------------
// The job list (T-702): nothing is stuck unseen.
//
// One read, run three ways: by hand after a release
// (`scripts/check-job-list-invariant.ts`), in the tests, and every day inside
// production from the list's own daily job. It finds:
//
//   overdueJobs      queued, due more than two hours ago, of a kind and
//                    version this code reads (so a worker should have run it)
//   expiredClaims    running, whose claim ran out more than an hour ago (so no
//                    worker has recovered it)
//   staleQueuedSends email_sends with status 'queued' written more than a day
//                    ago; only rows the list wrote are 'queued', so old
//                    'pending' sends from before it do not trip this
//   unreadableJobs   queued, of a kind or version this code does not read (so
//                    no worker of this release ever will)
//
// The database's clock decides every age. One statement; it writes nothing.
// ---------------------------------------------------------------------------

export interface JobListInvariant {
  readonly overdueJobs: number;
  readonly expiredClaims: number;
  readonly staleQueuedSends: number;
  readonly unreadableJobs: number;
}

const invariantRow = z.object({
  overdue_jobs: z.number().int(),
  expired_claims: z.number().int(),
  stale_queued_sends: z.number().int(),
  unreadable_jobs: z.number().int(),
});

/** The (kind, version) pairs this registry reads, as a table; an empty one for an empty registry. */
function knownVersions(registry: JobRegistry): SQL {
  const rows: SQL[] = [];
  for (const [kind, definition] of registry) {
    for (const version of new Set(definition.reads)) {
      rows.push(sql`(${kind}::text, ${version}::integer)`);
    }
  }
  // `VALUES` with no rows is not a statement PostgreSQL accepts.
  if (rows.length === 0) return sql`SELECT NULL::text AS kind, NULL::integer AS version WHERE false`;
  return sql`VALUES ${sql.join(rows, sql`, `)}`;
}

/** Takes the database or an open transaction (the release check reads inside a read-only one). */
export async function readJobListInvariant(db: JobExecutor, registry: JobRegistry): Promise<JobListInvariant> {
  const result = await db.execute(sql`
    WITH known(kind, version) AS (${knownVersions(registry)})
    SELECT
      (SELECT count(*) FROM jobs j
        WHERE j.state = 'queued' AND j.run_at < now() - interval '2 hours'
          AND EXISTS (SELECT 1 FROM known k WHERE k.kind = j.kind AND k.version = j.version))::int AS overdue_jobs,
      (SELECT count(*) FROM jobs
        WHERE state = 'running' AND claim_expires_at < now() - interval '1 hour')::int AS expired_claims,
      (SELECT count(*) FROM email_sends
        WHERE status = 'queued' AND created_at < now() - interval '1 day')::int AS stale_queued_sends,
      (SELECT count(*) FROM jobs j
        WHERE j.state = 'queued'
          AND NOT EXISTS (SELECT 1 FROM known k WHERE k.kind = j.kind AND k.version = j.version))::int AS unreadable_jobs`);
  const [raw] = result.rows;
  if (raw === undefined) throw new Error("The job list's invariant read returned no row");
  const row = invariantRow.parse(raw);
  return {
    overdueJobs: row.overdue_jobs,
    expiredClaims: row.expired_claims,
    staleQueuedSends: row.stale_queued_sends,
    unreadableJobs: row.unreadable_jobs,
  };
}

/** True when every count is zero. */
export function isHealthy(invariant: JobListInvariant): boolean {
  return invariant.overdueJobs === 0 && invariant.expiredClaims === 0
    && invariant.staleQueuedSends === 0 && invariant.unreadableJobs === 0;
}

/** The four counts in words, for an alert's text. */
export function describeInvariant(invariant: JobListInvariant): string {
  return `overdue jobs ${String(invariant.overdueJobs)}, expired claims ${String(invariant.expiredClaims)}, `
    + `stale queued sends ${String(invariant.staleQueuedSends)}, unreadable jobs ${String(invariant.unreadableJobs)}`;
}
