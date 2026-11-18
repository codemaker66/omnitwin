import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { validateEnv, type Env } from "../env.js";
import { recordingJobAlerts } from "../services/jobs/alerts.js";
import { isHealthy, readJobListInvariant } from "../services/jobs/invariant.js";
import { buildJobRegistry, type JobLogger, type JobRegistry } from "../services/jobs/kinds.js";
import { selfTestJob } from "../services/jobs/kinds/selftest.js";
import { buildJobKinds, startJobs } from "../services/jobs/runtime.js";
import { enqueueJob } from "../services/jobs/store.js";
import { installedJobWorker, pokeJobWorker } from "../services/jobs/wake.js";
import { JobWorker } from "../services/jobs/worker.js";
import { jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, the job list inside the API: the release check (nothing stuck
// unseen), the two built-in kinds, and the worker started and stopped with the
// server behind JOBS_WORKER, which ships off.
//
// The tests that must go through `buildServer` build it against the explicit
// throwaway database, each server with its own application_name so the
// database itself can say whether that server sent a statement. Importing the
// whole server is slow on a loaded machine, so those tests have long limits.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).
process.env["NODE_ENV"] = "test";

// A type alias, not an interface: pg's row type has a string index signature,
// which only an alias of an object type meets.
type JobRow = {
  readonly key: string;
  readonly kind: string;
  readonly state: string;
  readonly attempts: number;
  readonly claim_token: string | null;
  readonly last_error: string | null;
  readonly payload: Record<string, unknown>;
};

type BuildServer = (env: Env) => Promise<FastifyInstance>;

interface LogEntry {
  readonly level: "info" | "warn" | "error";
  readonly obj: Record<string, unknown>;
  readonly msg: string | undefined;
}

const JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters-long";
const DAILY_MONITOR = "job-list-daily";
/**
 * Made once per run of this file and added to every server's application_name,
 * so a server left behind by an aborted run is never counted as one of these.
 */
const RUN = randomUUID().slice(0, 8);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitUntil(check: () => Promise<boolean> | boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Until no pass is running or about to run. Reads the worker's memory only. */
async function idle(target: JobWorker): Promise<void> {
  await waitUntil(() => target.status().lastPassAt !== null && !target.status().passRunning, 30_000, "the worker to go idle");
}

function recordingLogger(): JobLogger & { readonly entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (obj, msg) => { entries.push({ level: "info", obj, msg }); },
    warn: (obj, msg) => { entries.push({ level: "warn", obj, msg }); },
    error: (obj, msg) => { entries.push({ level: "error", obj, msg }); },
  };
}

/** The server's own database url: the throwaway database, marked with the server's name. */
function serverUrl(applicationName: string): string {
  if (jobsTestUrl === undefined) throw new Error("VENVIEWER_JOBS_TEST_DATABASE_URL is required");
  return `${jobsTestUrl}?application_name=${applicationName}`;
}

function serverEnv(applicationName: string, worker: "on" | "off" | undefined): Env {
  return validateEnv({
    NODE_ENV: "test",
    DATABASE_URL: serverUrl(applicationName),
    JWT_SECRET,
    ...(worker === undefined ? {} : { JOBS_WORKER: worker }),
  });
}

describe.skipIf(jobsTestUrl === undefined)("jobs: inside the API", () => {
  let pool: Pool;
  let db: Database;
  let buildServer: BuildServer | null = null;

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_runtime_${randomUUID()}`));
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
    await pool.query("DELETE FROM email_sends");
  });

  afterAll(async () => {
    await pool.end();
  });

  /** The whole server, imported once: importing index.ts alone takes about a minute here. */
  async function loadBuildServer(): Promise<BuildServer> {
    if (buildServer === null) {
      process.env["JWT_SECRET"] = JWT_SECRET;
      const imported = await import("../index.js");
      buildServer = imported.buildServer;
    }
    return buildServer;
  }

  /**
   * The statements this server's connections began at or after `since` (the
   * database's clock), and any connection it opened since. None means it sent
   * no statement. Each is named by its text, so a failure says what was sent.
   */
  async function statementsSince(applicationName: string, since: Date): Promise<string[]> {
    const rows = (await pool.query<{ query: string; opened: boolean }>(
      `SELECT query, backend_start >= $2 AS opened FROM pg_stat_activity
       WHERE application_name = $1 AND (backend_start >= $2 OR query_start >= $2)`,
      [applicationName, since],
    )).rows;
    return rows.map((row) => `${row.opened ? "(new connection) " : ""}${row.query}`);
  }

  async function databaseNow(): Promise<Date> {
    const [row] = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows;
    if (row === undefined) throw new Error("The database gave no time");
    return row.now;
  }

  /** Until the server has sent nothing for half a second: its start-up work is over. */
  async function quiet(applicationName: string): Promise<void> {
    await waitUntil(async () => {
      const since = await databaseNow();
      await sleep(500);
      return (await statementsSince(applicationName, since)).length === 0;
    }, 30_000, "the server to fall quiet");
  }

  async function jobByKey(key: string): Promise<JobRow | undefined> {
    return (await pool.query<JobRow>("SELECT key, kind, state, attempts, claim_token, last_error, payload FROM jobs WHERE key = $1", [key])).rows[0];
  }

  async function seedJob(input: { readonly kind?: string; readonly version?: number; readonly key: string; readonly runAt?: SQL }): Promise<void> {
    const kind = input.kind ?? selfTestJob.kind;
    await db.execute(sql`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, run_at)
      VALUES (${kind}, ${input.version ?? 1}, ${input.key}, 'platform', ${JSON.stringify({ nonce: input.key })}::jsonb, 6,
              ${input.runAt ?? sql`now()`})`);
  }

  async function seedRunning(input: { readonly key: string; readonly claimExpiresAt: SQL }): Promise<void> {
    await db.execute(sql`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, state, attempts, claim_token, claimed_by, claim_expires_at)
      VALUES (${selfTestJob.kind}, 1, ${input.key}, 'platform', ${JSON.stringify({ nonce: input.key })}::jsonb, 6, 'running', 1,
              gen_random_uuid(), 'a-server-that-went-away', ${input.claimExpiresAt})`);
  }

  async function seedFinished(input: { readonly key: string; readonly state: "done" | "dead" | "abandoned"; readonly finishedAt: SQL }): Promise<void> {
    const abandoned = input.state === "abandoned";
    await db.execute(sql`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, state, attempts, finished_at, resolved_at, resolution)
      VALUES (${selfTestJob.kind}, 1, ${input.key}, 'platform', ${JSON.stringify({ nonce: input.key })}::jsonb, 6, ${input.state}, 1,
              ${abandoned ? null : input.finishedAt}, ${abandoned ? input.finishedAt : null}, ${abandoned ? "Closed by hand." : null})`);
  }

  async function seedSend(input: { readonly status: string; readonly createdAt: SQL }): Promise<void> {
    await db.execute(sql`
      INSERT INTO email_sends (idempotency_key, recipient, subject, status, created_at)
      VALUES (${randomUUID()}, 'guest@example.org', 'A test send', ${input.status}, ${input.createdAt})`);
  }

  async function seedDailyRun(key: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, run_at)
      VALUES ('jobs.daily', 1, ${key}, 'platform', ${JSON.stringify({ occurrence: key })}::jsonb, 2, now())`);
  }

  // ---- The release check and the daily job -------------------------------

  describe("the release check and the daily job", () => {
    let registry: JobRegistry;
    let worker: JobWorker | null = null;

    beforeAll(() => {
      registry = buildJobRegistry(buildJobKinds(recordingJobAlerts()).kinds);
    });

    afterEach(async () => {
      if (worker !== null) await worker.stop(1000);
      worker = null;
    });

    function startWorker(alerts: ReturnType<typeof recordingJobAlerts>, logger: JobLogger): JobWorker {
      const { kinds } = buildJobKinds(alerts);
      const started = new JobWorker({
        db,
        registry: buildJobRegistry(kinds),
        serverId: "test-daily",
        logger,
        alerts,
        lostClaimPauseSeconds: 0,
      });
      started.start();
      return started;
    }

    it("this build knows the self-test and the daily kinds, and only the daily one repeats", () => {
      const { kinds, repeating } = buildJobKinds(recordingJobAlerts());
      expect(kinds.map((kind) => kind.kind).sort()).toEqual(["jobs.daily", "jobs.selftest"]);
      expect(repeating.map((job) => job.kind.kind)).toEqual(["jobs.daily"]);
      const daily = repeating[0];
      expect(daily?.kind).toMatchObject({ scope: "platform", timeoutMs: 15_000, maxAttempts: 2 });
      expect(daily?.next(new Date("2027-01-10T12:00:00Z")).toISOString()).toBe("2027-01-11T03:00:00.000Z");
      expect(daily?.next(new Date("2027-01-10T02:59:00Z")).toISOString()).toBe("2027-01-10T03:00:00.000Z");
      expect(selfTestJob).toMatchObject({ kind: "jobs.selftest", scope: "platform", timeoutMs: 5000 });
    });

    it("a clean list is healthy; each kind of stuck row is counted", async () => {
      expect(isHealthy(await readJobListInvariant(db, registry))).toBe(true);
      await seedJob({ key: "old", runAt: sql`now() - interval '3 hours'` });
      await seedRunning({ key: "gone", claimExpiresAt: sql`now() - interval '2 hours'` });
      await seedJob({ kind: "test.unknown", key: "alien" });
      await seedSend({ status: "queued", createdAt: sql`now() - interval '2 days'` });
      await seedSend({ status: "pending", createdAt: sql`now() - interval '2 days'` });   // today's path: not counted
      const invariant = await readJobListInvariant(db, registry);
      expect(invariant).toEqual({ overdueJobs: 1, expiredClaims: 1, staleQueuedSends: 1, unreadableJobs: 1 });
      expect(isHealthy(invariant)).toBe(false);
    });

    it("counts a known kind written in a version this code does not read as unreadable, not overdue", async () => {
      await seedJob({ version: 2, key: "future-shape", runAt: sql`now() - interval '3 hours'` });
      expect(await readJobListInvariant(db, registry)).toEqual({ overdueJobs: 0, expiredClaims: 0, staleQueuedSends: 0, unreadableJobs: 1 });
    });

    it("leaves alone what is late but inside its margin, and every finished row", async () => {
      await seedJob({ key: "an-hour-late", runAt: sql`now() - interval '1 hour'` });
      await seedRunning({ key: "lapsed-lately", claimExpiresAt: sql`now() - interval '30 minutes'` });
      await seedSend({ status: "queued", createdAt: sql`now() - interval '12 hours'` });
      await seedFinished({ key: "dead-long-ago", state: "dead", finishedAt: sql`now() - interval '9 days'` });
      await seedFinished({ key: "done-long-ago", state: "done", finishedAt: sql`now() - interval '9 days'` });
      const invariant = await readJobListInvariant(db, registry);
      expect(invariant).toEqual({ overdueJobs: 0, expiredClaims: 0, staleQueuedSends: 0, unreadableJobs: 0 });
      expect(isHealthy(invariant)).toBe(true);
    });

    it("the daily job tidies old finished rows, reads the invariant and checks in", async () => {
      await seedFinished({ key: "done-91", state: "done", finishedAt: sql`now() - interval '91 days'` });
      await seedFinished({ key: "abandoned-91", state: "abandoned", finishedAt: sql`now() - interval '91 days'` });
      await seedFinished({ key: "done-89", state: "done", finishedAt: sql`now() - interval '89 days'` });
      await seedFinished({ key: "dead-91", state: "dead", finishedAt: sql`now() - interval '91 days'` });
      // Died 100 days ago, closed by a person with a note yesterday: its age runs from the closing.
      await pool.query(`
        INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, state, attempts, finished_at, resolved_at, resolution)
        VALUES ('jobs.selftest', 1, 'closed-yesterday', 'platform', '{"nonce": "closed-yesterday"}'::jsonb, 6, 'abandoned', 6,
                now() - interval '100 days', now() - interval '1 day', 'Looked at and closed.')`);
      await seedDailyRun("2020-01-01T03:00:00.000Z");
      const alerts = recordingJobAlerts();
      const logger = recordingLogger();
      worker = startWorker(alerts, logger);
      await idle(worker);

      expect(await jobByKey("done-91")).toBeUndefined();
      expect(await jobByKey("abandoned-91")).toBeUndefined();
      // Newer than 90 days, closed lately, or dead (kept for a person to look at): left alone.
      expect((await jobByKey("done-89"))?.state).toBe("done");
      expect((await jobByKey("closed-yesterday"))?.state).toBe("abandoned");
      expect((await jobByKey("dead-91"))?.state).toBe("dead");
      expect((await jobByKey("2020-01-01T03:00:00.000Z"))?.state).toBe("done");
      // Healthy: no fault, one check-in, and no further run asked for.
      expect(alerts.calls).toEqual([["checkIn", { monitor: DAILY_MONITOR }]]);
      expect((await pool.query("SELECT 1 FROM jobs WHERE kind = 'jobs.daily'")).rowCount).toBe(1);
    });

    it("the daily job runs once more, under its own key, when it deleted a full thousand", async () => {
      await pool.query(`
        INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, state, attempts, finished_at)
        SELECT 'jobs.selftest', 1, 'old-' || g, 'platform', jsonb_build_object('nonce', 'old-' || g), 6, 'done', 1,
               now() - interval '100 days'
        FROM generate_series(1, 1001) AS g`);
      const occurrence = "2020-01-01T03:00:00.000Z";
      await seedDailyRun(occurrence);
      const [first] = (await pool.query<{ id: string }>("SELECT id FROM jobs WHERE key = $1", [occurrence])).rows;
      const alerts = recordingJobAlerts();
      worker = startWorker(alerts, recordingLogger());
      await idle(worker);

      expect((await pool.query("SELECT 1 FROM jobs WHERE key LIKE 'old-%'")).rowCount).toBe(0);
      const runs = (await pool.query<JobRow>(
        "SELECT key, kind, state, attempts, claim_token, last_error, payload FROM jobs WHERE kind = 'jobs.daily' ORDER BY created_at, key",
      )).rows;
      expect(runs).toHaveLength(2);
      expect(runs[0]).toMatchObject({ key: occurrence, state: "done" });
      // The extra run is keyed by the run that asked for it, and carries the same occurrence.
      expect(runs[1]).toMatchObject({ key: `more-after:${first?.id ?? "none"}`, state: "done", payload: { occurrence } });
      expect(alerts.calls).toEqual([["checkIn", { monitor: DAILY_MONITOR }], ["checkIn", { monitor: DAILY_MONITOR }]]);
    });

    it("the daily job raises a fault with the four counts when something is stuck, and logs it", async () => {
      await seedJob({ kind: "test.unknown", key: "alien" });
      await seedSend({ status: "queued", createdAt: sql`now() - interval '2 days'` });
      await seedDailyRun("2020-01-01T03:00:00.000Z");
      const alerts = recordingJobAlerts();
      const logger = recordingLogger();
      worker = startWorker(alerts, logger);
      await idle(worker);

      expect(alerts.calls).toHaveLength(2);
      expect(alerts.calls[0]?.[0]).toBe("workerFault");
      const fault = alerts.calls[0]?.[1] as { readonly what: string; readonly detail: string };
      expect(fault.what).toBe("loop");
      expect(fault.detail).toContain("overdue jobs 0");
      expect(fault.detail).toContain("expired claims 0");
      expect(fault.detail).toContain("stale queued sends 1");
      expect(fault.detail).toContain("unreadable jobs 1");
      expect(alerts.calls[1]).toEqual(["checkIn", { monitor: DAILY_MONITOR }]);
      // Written to the log whether or not Sentry is on.
      expect(logger.entries).toContainEqual(expect.objectContaining({
        level: "error",
        obj: { overdueJobs: 0, expiredClaims: 0, staleQueuedSends: 1, unreadableJobs: 1 },
      }));
      expect((await jobByKey("2020-01-01T03:00:00.000Z"))?.state).toBe("done");
    });
  });

  // ---- The switch ---------------------------------------------------------

  describe("the switch", () => {
    it("JOBS_WORKER and JOBS_MAX_SLEEP_MINUTES ship unset; on, off and 1 to 360 are read; anything else is refused", () => {
      // Unset: no worker (startJobs reads only "on"), and the worker's own default of 60 minutes.
      const env = serverEnv(`jobs_runtime_env_${RUN}`, undefined);
      expect(env.JOBS_WORKER).toBeUndefined();
      expect(env.JOBS_MAX_SLEEP_MINUTES).toBeUndefined();
      expect(validateEnv({ DATABASE_URL: serverUrl("x"), JOBS_WORKER: "off", JOBS_MAX_SLEEP_MINUTES: "1" })).toMatchObject({
        JOBS_WORKER: "off",
        JOBS_MAX_SLEEP_MINUTES: 1,
      });
      expect(validateEnv({ DATABASE_URL: serverUrl("x"), JOBS_WORKER: "on", JOBS_MAX_SLEEP_MINUTES: "360" })).toMatchObject({
        JOBS_WORKER: "on",
        JOBS_MAX_SLEEP_MINUTES: 360,
      });
      expect(() => validateEnv({ DATABASE_URL: serverUrl("x"), JOBS_WORKER: "yes" })).toThrow(/JOBS_WORKER/u);
      expect(() => validateEnv({ DATABASE_URL: serverUrl("x"), JOBS_MAX_SLEEP_MINUTES: "0" })).toThrow(/JOBS_MAX_SLEEP_MINUTES/u);
      expect(() => validateEnv({ DATABASE_URL: serverUrl("x"), JOBS_MAX_SLEEP_MINUTES: "361" })).toThrow(/JOBS_MAX_SLEEP_MINUTES/u);
    });

    it("with it off, startJobs builds the registry and touches no database, starts no timer and installs nothing", async () => {
      const touched: string[] = [];
      const untouchable = new Proxy(db, {
        get: (target, property): unknown => {
          touched.push(String(property));
          return Reflect.get(target, property, target);
        },
      });
      const timers = [
        vi.spyOn(globalThis, "setTimeout"),
        vi.spyOn(globalThis, "setInterval"),
        vi.spyOn(globalThis, "setImmediate"),
      ];
      const logger = recordingLogger();
      try {
        // "off", and unset (as it ships).
        for (const setting of ["off", undefined] as const) {
          const started = await startJobs({ db: untouchable, env: serverEnv(`jobs_runtime_off_unit_${RUN}`, setting), logger });
          expect(started.worker).toBeNull();
          expect([...started.registry.keys()].sort()).toEqual(["jobs.daily", "jobs.selftest"]);
          expect(installedJobWorker()).toBeNull();
          await started.stop(18_000);
        }
        for (const timer of timers) expect(timer).not.toHaveBeenCalled();
      } finally {
        for (const timer of timers) timer.mockRestore();
      }
      expect(touched).toEqual([]);
      expect(logger.entries).toEqual([]);
    });

    it("a stop that fails never rejects: it is logged once, scrubbed, and the worker is uninstalled", async () => {
      const logger = recordingLogger();
      const started = await startJobs({ db, env: serverEnv(`jobs_runtime_stop_unit_${RUN}`, "on"), logger });
      const worker = started.worker;
      if (worker === null) throw new Error("No worker was started");
      await idle(worker);
      expect(installedJobWorker()).toBe(worker);
      // The smallest seam there is, without changing worker.ts: the worker's own stop rejects.
      const failing = vi.spyOn(JobWorker.prototype, "stop").mockRejectedValue(new Error("refused ada@example.org"));
      try {
        await expect(started.stop(1000)).resolves.toBeUndefined();
        await expect(started.stop(1000)).resolves.toBeUndefined();
        const errors = logger.entries.filter((entry) => entry.level === "error");
        expect(errors).toEqual([{ level: "error", obj: { error: "refused [email address]" }, msg: "the job worker did not stop cleanly" }]);
        expect(failing).toHaveBeenCalledTimes(1);
        expect(installedJobWorker()).toBeNull();
      } finally {
        failing.mockRestore();
        // The real stop, so the worker leaves nothing behind.
        await worker.stop(1000);
      }
    });
  });

  // ---- Through the whole server -------------------------------------------

  describe("a server with JOBS_WORKER off", () => {
    const APP = `jobs_runtime_off_${RUN}`;
    let server: FastifyInstance | null = null;

    beforeAll(async () => {
      server = await (await loadBuildServer())(serverEnv(APP, undefined));
    }, 600_000);

    afterAll(async () => {
      await server?.close();
    }, 60_000);

    it("with JOBS_WORKER off nothing is installed and the health route says so", async () => {
      if (server === null) throw new Error("No server");
      expect(installedJobWorker()).toBeNull();
      const response = await server.inject({ method: "GET", url: "/health/worker" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ worker: "off" });
      // Nothing was written to the list either: no worker ran, no next run was asked for.
      expect((await pool.query("SELECT 1 FROM jobs")).rowCount).toBe(0);
    });
  });

  describe("a server with JOBS_WORKER on", () => {
    const APP = `jobs_runtime_on_${RUN}`;
    let server: FastifyInstance | null = null;
    /** What the first pass left queued for the daily kind, read before the next test empties the list. */
    let firstDailyRuns: { readonly key: string; readonly run_at: Date }[] = [];

    beforeAll(async () => {
      await resetJobs(pool);
      server = await (await loadBuildServer())(serverEnv(APP, "on"));
      // Boot the plugins now, so the first request in a test is only a request.
      await server.ready();
      const worker = installedJobWorker();
      if (worker === null) throw new Error("The server installed no worker");
      await idle(worker);
      firstDailyRuns = (await pool.query<{ key: string; run_at: Date }>(
        "SELECT key, run_at FROM jobs WHERE kind = 'jobs.daily' AND state = 'queued'",
      )).rows;
    }, 600_000);

    afterAll(async () => {
      await server?.close();
      expect(installedJobWorker()).toBeNull();
    }, 60_000);

    it("with JOBS_WORKER on the worker runs, and the health route reports it without a statement", async () => {
      if (server === null) throw new Error("No server");
      const target: FastifyInstance = server;
      const worker = installedJobWorker();
      if (worker === null) throw new Error("No worker is installed");
      const wake = (): string => JSON.stringify([worker.status().lastPassAt, worker.status().nextWakeAt]);

      /** One quiet window round one request, and whether the worker's own timed wake fell inside it. */
      async function measure(): Promise<{ readonly statusCode: number; readonly body: unknown; readonly sent: string[]; readonly woke: boolean }> {
        await quiet(APP);
        const wakeBefore = wake();
        const before = await databaseNow();
        const response = await target.inject({ method: "GET", url: "/health/worker" });
        const sent = await statementsSince(APP, before);
        return { statusCode: response.statusCode, body: response.json<unknown>(), sent, woke: wake() !== wakeBefore };
      }

      // The worker wakes on its own each UTC hour and at 03:00 UTC; a wake that
      // falls inside the window sends statements that are not the route's. If
      // the worker's last pass or next wake changed during the window, the
      // window is taken once more, once only (no loop): two timed wakes cannot
      // fall in two half-second windows taken back to back.
      let taken = await measure();
      if (taken.woke) taken = await measure();
      expect(taken.woke).toBe(false);
      expect(taken.statusCode).toBe(200);
      expect(taken.body).toMatchObject({ started: true, fault: null, passRunning: false, currentJob: null });
      expect(typeof (taken.body as { readonly lastPassAt?: unknown }).lastPassAt).toBe("number");
      expect(taken.sent).toEqual([]);

      // The count does see a statement when one is sent: the database probe sends one.
      const probed = await databaseNow();
      expect((await target.inject({ method: "GET", url: "/health/db" })).statusCode).toBe(200);
      expect(await statementsSince(APP, probed)).toContain("SELECT 1");
    }, 60_000);

    it("its first pass wrote the next daily run", () => {
      expect(firstDailyRuns).toHaveLength(1);
      const [row] = firstDailyRuns;
      expect(row?.key).toMatch(/T03:00:00\.000Z$/u);
      expect(row?.key).toBe(row?.run_at.toISOString());
    });

    it("the self-test job runs and ends done", async () => {
      await enqueueJob(db, selfTestJob, { key: "t1", payload: { nonce: "t1" } });
      pokeJobWorker();
      await waitUntil(async () => (await jobByKey("t1"))?.state === "done", 15_000, "the self-test job to end done");
    }, 30_000);
  });

  describe("closing a server with JOBS_WORKER on", () => {
    const APP = `jobs_runtime_close_${RUN}`;

    it("closing the server stops the worker before the database pool closes", async () => {
      await resetJobs(pool);
      const server = await (await loadBuildServer())(serverEnv(APP, "on"));
      const worker = installedJobWorker();
      if (worker === null) throw new Error("The server installed no worker");
      await idle(worker);

      // The daily run is held inside its handler: its read of email_sends waits
      // on a lock this test holds, so the job is running when close() is called.
      const holder = await pool.connect();
      let held = true;
      const logs: string[] = [];
      const spies = [
        vi.spyOn(server.log, "warn").mockImplementation((...args: unknown[]) => { logs.push(JSON.stringify(args)); }),
        vi.spyOn(server.log, "error").mockImplementation((...args: unknown[]) => { logs.push(JSON.stringify(args)); }),
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logs.push(JSON.stringify(args.map(String))); }),
      ];
      try {
        await holder.query("BEGIN");
        await holder.query("LOCK TABLE email_sends IN ACCESS EXCLUSIVE MODE");
        const key = "2020-01-01T03:00:00.000Z";
        await seedDailyRun(key);
        pokeJobWorker();
        await waitUntil(async () => {
          const [row] = (await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
            [APP],
          )).rows;
          return (row?.n ?? 0) > 0;
        }, 30_000, "the daily run to wait on the lock");
        expect(worker.status().currentJob?.kind).toBe("jobs.daily");
        expect((await jobByKey(key))?.state).toBe("running");

        const closing = server.close();
        // The stop has begun and takes nothing new, but waits for the running handler.
        await waitUntil(() => !worker.status().started, 10_000, "the stop to begin");
        expect((await jobByKey(key))?.state).toBe("running");

        // The handler never answers, so its own 15-second limit ends it inside
        // the 18-second grace, and the worker records the failed try through
        // the pool, which must still be open. Had the pool closed first, the
        // write would fail ("Cannot use a pool after calling end on the pool")
        // and the row would stay running.
        await waitUntil(async () => (await jobByKey(key))?.state === "queued", 60_000, "the running job's try to be recorded");
        await holder.query("ROLLBACK");
        held = false;
        await closing;

        const row = await jobByKey(key);
        expect(row).toMatchObject({ state: "queued", attempts: 1, claim_token: null });
        expect(row?.last_error).toBe("The handler passed its time limit of 15000 ms.");
        expect(installedJobWorker()).toBeNull();
        expect(logs.filter((line) => /pool after|after calling end/iu.test(line))).toEqual([]);
        expect(logs.some((line) => line.includes("a job failed and will be tried again"))).toBe(true);
      } finally {
        if (held) await holder.query("ROLLBACK");
        holder.release();
        for (const spy of spies) spy.mockRestore();
      }
    }, 600_000);
  });
});
