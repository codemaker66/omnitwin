import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { recordingJobAlerts } from "../services/jobs/alerts.js";
import { buildJobRegistry, defineJobKind, type JobLogger } from "../services/jobs/kinds.js";
import { nextLocalTime } from "../services/jobs/local-time.js";
import { ensureNextRuns, type RepeatingJob } from "../services/jobs/repeating.js";
import { JobWorker } from "../services/jobs/worker.js";
import { jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, work that repeats: each repeating kind has its next run on the list,
// written once however many servers ask, and written again at the end of every
// worker pass, so a dead run does not end the series.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).

// A type alias, not an interface: pg's row type has a string index signature,
// which only an alias of an object type meets.
type OccurrenceRow = {
  readonly key: string;
  readonly state: string;
  readonly run_at: Date;
  readonly payload: { readonly occurrence: string };
};

const OCCURRENCE_PAYLOAD = z.object({ occurrence: z.string() }).strict();

const silentLogger: JobLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

describe.skipIf(jobsTestUrl === undefined)("jobs: work that repeats", () => {
  let pool: Pool;
  let db: Database;
  let worker: JobWorker | null = null;

  /** Records that a run happened. */
  const occurrenceKind = defineJobKind({
    kind: "test.occurrence",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: OCCURRENCE_PAYLOAD,
    handler: (): Promise<void> => Promise.resolve(),
  });
  /** Always fails, and has one try only: the run is dead at once. */
  const failingKind = defineJobKind({
    kind: "test.occurrence-fails",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    maxAttempts: 1,
    payload: OCCURRENCE_PAYLOAD,
    handler: (): Promise<void> => Promise.reject(new Error("This run cannot work.")),
  });

  async function jobsOfKind(kind: string): Promise<OccurrenceRow[]> {
    return (await pool.query<OccurrenceRow>(
      "SELECT key, state, run_at, payload FROM jobs WHERE kind = $1 ORDER BY key",
      [kind],
    )).rows;
  }

  /** Until no pass is running or about to run. Reads the worker's memory only. */
  async function idle(target: JobWorker): Promise<void> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (!target.status().passRunning) return;
      await sleep(5);
    }
    throw new Error("The worker never went idle");
  }

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_repeating_${randomUUID()}`));
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
  });

  afterEach(async () => {
    if (worker !== null) await worker.stop(100);
    worker = null;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("writes the next run once, however often and by however many servers it is asked", async () => {
    const daily: RepeatingJob = { kind: occurrenceKind, next: (after) => nextLocalTime(after, "03:00", "UTC") };
    const now = new Date("2027-01-10T12:00:00Z");
    await Promise.all([ensureNextRuns(db, [daily], now), ensureNextRuns(db, [daily], now), ensureNextRuns(db, [daily], now)]);
    expect(await jobsOfKind(occurrenceKind.kind)).toEqual([expect.objectContaining({ key: "2027-01-11T03:00:00.000Z", state: "queued" })]);
    const [row] = await jobsOfKind(occurrenceKind.kind);
    expect(row?.run_at.toISOString()).toBe("2027-01-11T03:00:00.000Z");
    expect(row?.payload).toEqual({ occurrence: "2027-01-11T03:00:00.000Z" });
  });

  it("a run that is taken has its next run written at the end of that pass, and a dead run does not end the series", async () => {
    const daily: RepeatingJob = { kind: failingKind, next: (after) => nextLocalTime(after, "03:00", "UTC") };
    const dueKey = "2020-01-01T03:00:00.000Z";
    await pool.query(
      "INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, run_at) VALUES ($1, 1, $2, 'platform', $3::jsonb, 1, $4::timestamptz)",
      [failingKind.kind, dueKey, JSON.stringify({ occurrence: dueKey }), dueKey],
    );
    worker = new JobWorker({
      db,
      registry: buildJobRegistry([failingKind]),
      serverId: "test-server",
      logger: silentLogger,
      alerts: recordingJobAlerts(),
      lostClaimPauseSeconds: 0,
      afterPass: (now) => ensureNextRuns(db, [daily], now),
    });
    worker.start();
    await idle(worker);

    const rows = await jobsOfKind(failingKind.kind);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: dueKey, state: "dead" });
    const next = rows[1];
    if (next === undefined) throw new Error("The next run was not written");
    // Keyed by its own time, queued, in the future, and the next 03:00 UTC.
    expect(next.state).toBe("queued");
    expect(next.key).toBe(next.run_at.toISOString());
    expect(next.key).toMatch(/T03:00:00\.000Z$/u);
    expect(next.payload).toEqual({ occurrence: next.key });
    const [clock] = (await pool.query<{ now: Date }>("SELECT now() AS now")).rows;
    expect(next.run_at.getTime()).toBeGreaterThan(clock?.now.getTime() ?? Number.POSITIVE_INFINITY);
  });

  it("writes one next run for each repeating kind, and none twice when asked again later in the same period", async () => {
    const daily: RepeatingJob = { kind: occurrenceKind, next: (after) => nextLocalTime(after, "03:00", "UTC") };
    const hourly: RepeatingJob = {
      kind: failingKind,
      next: (after) => new Date((Math.floor(after.getTime() / 3_600_000) + 1) * 3_600_000),
    };
    await ensureNextRuns(db, [daily, hourly], new Date("2027-01-10T12:10:00Z"));
    await ensureNextRuns(db, [daily, hourly], new Date("2027-01-10T12:50:00Z"));
    expect((await jobsOfKind(occurrenceKind.kind)).map((row) => row.key)).toEqual(["2027-01-11T03:00:00.000Z"]);
    expect((await jobsOfKind(failingKind.kind)).map((row) => row.key)).toEqual(["2027-01-10T13:00:00.000Z"]);
    // Once the hour has turned, the next period's run is written beside the first.
    await ensureNextRuns(db, [daily, hourly], new Date("2027-01-10T13:00:00Z"));
    expect((await jobsOfKind(failingKind.kind)).map((row) => row.key)).toEqual(["2027-01-10T13:00:00.000Z", "2027-01-10T14:00:00.000Z"]);
    expect(await jobsOfKind(occurrenceKind.kind)).toHaveLength(1);
  });

  it("a list with nothing repeating writes nothing", async () => {
    await ensureNextRuns(db, [], new Date("2027-01-10T12:00:00Z"));
    expect((await pool.query("SELECT 1 FROM jobs")).rowCount).toBe(0);
  });
});
