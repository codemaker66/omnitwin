import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { recordingJobAlerts } from "../services/jobs/alerts.js";
import {
  buildJobRegistry,
  ClaimLostError,
  defineJobKind,
  PermanentJobError,
  RetryJobIn,
  type JobLogger,
} from "../services/jobs/kinds.js";
import { enqueueJob, RETRY_SECONDS } from "../services/jobs/store.js";
import { JobWorker, type JobWorkerDeps } from "../services/jobs/worker.js";
import { ensureEffectsTable, jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, the worker: it plans from the database's clock, takes one job at a
// time, races each handler against its limit and each statement of its own
// against a shorter one, and sleeps until the next job is due or the next
// boundary. Its waits are injected (setTimer, clearTimer, yieldToLoop), so a
// test reads them and fires them by hand: no assertion here waits on a wall
// clock to fire anything. Its statements go through a counting double round
// the real database, which can also fail, hang or hold back a statement.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).

// A type alias, not an interface: pg's row type has a string index signature,
// which only an alias of an object type meets.
type JobRow = {
  readonly id: string;
  readonly state: string;
  readonly attempts: number;
  readonly lost_claims: number;
  readonly last_error: string | null;
  readonly claim_token: string | null;
  readonly run_at: Date;
  readonly created_at: Date;
  readonly finished_at: Date | null;
};

interface FakeTimer {
  readonly ms: number;
  readonly fire: () => void;
  fired: boolean;
  cleared: boolean;
}

interface LogEntry {
  readonly level: "info" | "warn" | "error";
  readonly obj: Record<string, unknown>;
  readonly msg: string | undefined;
}

/**
 * What the next statements through the double do: run, reject, never settle,
 * answer at once with no rows without reaching the database, or wait for a gate.
 */
type StatementPlan = "run" | "fail" | "hang" | "nothing" | Promise<void>;

/**
 * A boundary decades apart (every 10,000,000 minutes since the epoch: the next
 * is in January 2027, the one after in 2046), so the hour can never come
 * before the job a test is timing.
 */
const FAR_BOUNDARY_MINUTES = 10_000_000;

const never = new Promise<never>(() => undefined);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

describe.skipIf(jobsTestUrl === undefined)("jobs: the worker", () => {
  let pool: Pool;
  let db: Database;
  let counted: Database;

  // ---- What the doubles record -------------------------------------------
  const statements = { count: 0 };
  const passes = { count: 0 };
  const yields = { count: 0 };
  const timers: FakeTimer[] = [];
  const logs: LogEntry[] = [];
  const ran: number[] = [];
  const upcoming: StatementPlan[] = [];
  let broken = false;
  let alerts = recordingJobAlerts();
  let worker: JobWorker;

  // ---- What the kinds below report back ----------------------------------
  let seenSignal: AbortSignal | null = null;
  let waitsSignal: AbortSignal | null = null;
  let markStarted: () => void = () => undefined;
  let waitsStarted: Promise<void> = Promise.resolve();
  let release: () => void = () => undefined;
  let released: Promise<void> = Promise.resolve();

  // ---- The kinds ---------------------------------------------------------
  const effect = defineJobKind({
    kind: "test.effect",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({ n: z.number().int() }).strict(),
    handler: (ctx): Promise<void> => {
      ran.push(ctx.payload.n);
      return Promise.resolve();
    },
  });
  /** Never settles: the worker must give up on it at its limit. */
  const hangs = defineJobKind({
    kind: "test.hangs",
    version: 1,
    scope: "platform",
    timeoutMs: 50,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      seenSignal = ctx.signal;
      await never;
    },
  });
  /** Rejects 100 ms after its 50 ms limit, when nobody is waiting for it any more. */
  const rejectsLate = defineJobKind({
    kind: "test.rejects-late",
    version: 1,
    scope: "platform",
    timeoutMs: 50,
    payload: z.object({}).strict(),
    handler: async (): Promise<void> => {
      await sleep(150);
      throw new Error("rejected after its limit");
    },
  });
  /** Always fails, quoting an address the way a provider's refusal can. */
  const alwaysThrows = defineJobKind({
    kind: "test.poison",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    maxAttempts: 2,
    payload: z.object({}).strict(),
    handler: (): Promise<void> => Promise.reject(new Error("refused guest@example.org")),
  });
  const permanent = defineJobKind({
    kind: "test.permanent",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({}).strict(),
    handler: (): Promise<void> => Promise.reject(new PermanentJobError("This can never work.")),
  });
  /** Asks for its own wait; `null` stands for NaN, which JSON cannot hold. `failFirstRecord` breaks the worker's next statement. */
  const retryLater = defineJobKind({
    kind: "test.retry-later",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({ seconds: z.number().nullable(), failFirstRecord: z.boolean() }).strict(),
    handler: (ctx): Promise<void> => {
      if (ctx.payload.failFirstRecord) upcoming.push("fail");
      return Promise.reject(new RetryJobIn(ctx.payload.seconds ?? Number.NaN, "The provider asked for a pause."));
    },
  });
  const claimLost = defineJobKind({
    kind: "test.claim-lost",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({}).strict(),
    handler: (): Promise<void> => Promise.reject(new ClaimLostError("Another taker has it.")),
  });
  /**
   * Records its effect and marks itself done in one transaction. It and `loses`
   * talk to the database, so they have the longest limit: a new connection on
   * a loaded machine can take seconds, and these tests are not about the limit.
   */
  const commits = defineJobKind({
    kind: "test.commits",
    version: 1,
    scope: "platform",
    timeoutMs: 15_000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO job_test_effects (key, server) VALUES ('commits', 'worker')`);
        await ctx.completeIn(tx);
      });
    },
  });
  /** As `commits`, but another taker's claim replaces its own before it completes. */
  const loses = defineJobKind({
    kind: "test.loses",
    version: 1,
    scope: "platform",
    timeoutMs: 15_000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO job_test_effects (key, server) VALUES ('loses', 'worker')`);
        await pool.query("UPDATE jobs SET claim_token = gen_random_uuid() WHERE id = $1", [ctx.jobId]);
        await ctx.completeIn(tx);
      });
    },
  });
  /** Writes version 2 and still reads version 1. */
  const shaped = defineJobKind({
    kind: "test.shaped",
    version: 2,
    reads: [1, 2],
    scope: "platform",
    timeoutMs: 1000,
    payload: z.union([z.object({ old: z.literal(true) }).strict(), z.object({ n: z.number() }).strict()]),
    handler: async (): Promise<void> => { /* nothing to do */ },
  });
  /** Says it has started, then waits for the test's release, or for the worker to tell it to stop. */
  const waitsForRelease = defineJobKind({
    kind: "test.waits",
    version: 1,
    scope: "platform",
    timeoutMs: 5000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      waitsSignal = ctx.signal;
      markStarted();
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve);
        ctx.signal.addEventListener("abort", () => { reject(new Error("Told to stop.")); }, { once: true });
      });
    },
  });
  /** Pokes the worker three times while its pass is running. */
  const pokes = defineJobKind({
    kind: "test.pokes",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({}).strict(),
    handler: (): Promise<void> => {
      worker.poke(); worker.poke(); worker.poke();
      return Promise.resolve();
    },
  });
  /** Not an async function: it throws before any promise exists. */
  const throwsAtOnce = defineJobKind({
    kind: "test.throws-at-once",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({}).strict(),
    handler: (): Promise<void> => { throw new Error("thrown before any promise"); },
  });
  /** Rejects, a tick after it begins, with something that is not an Error. */
  const throwsText = defineJobKind({
    kind: "test.throws-text",
    version: 1,
    scope: "platform",
    timeoutMs: 1000,
    payload: z.object({}).strict(),
    handler: async (): Promise<void> => {
      await Promise.resolve();
      const notAnError: unknown = "a plain string, not an Error";
      throw notAnError;
    },
  });
  const registry = buildJobRegistry([
    effect, hangs, rejectsLate, alwaysThrows, permanent, retryLater, claimLost, commits, loses, shaped,
    waitsForRelease, pokes, throwsAtOnce, throwsText,
  ]);

  // ---- The doubles -------------------------------------------------------

  /** The real database, with every `execute` counted and steerable. Every store function reaches it through `execute`. */
  function countedDatabase(real: Database): Database {
    const execute = (query: Parameters<Database["execute"]>[0]): Promise<unknown> => {
      statements.count += 1;
      if (broken) return Promise.reject(new Error("The database is unreachable."));
      const plan = upcoming.shift() ?? "run";
      if (plan === "fail") return Promise.reject(new Error("The statement failed."));
      if (plan === "hang") return never;
      if (plan === "nothing") return Promise.resolve({ rows: [] });
      if (plan !== "run") return plan.then(() => real.execute(query));
      return real.execute(query);
    };
    return new Proxy(real, {
      get: (target, property): unknown => {
        if (property === "execute") return execute;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  const breakDatabase = (): void => { broken = true; };
  const mendDatabase = (): void => { broken = false; };
  const hangNextStatement = (): void => { upcoming.push("hang"); };

  function setTimer(callback: () => void, ms: number): unknown {
    const timer: FakeTimer = {
      ms,
      fired: false,
      cleared: false,
      fire: () => {
        // A cleared timer never fires, as with the real one.
        if (timer.fired || timer.cleared) return;
        timer.fired = true;
        callback();
      },
    };
    timers.push(timer);
    return timer;
  }

  function clearTimer(handle: unknown): void {
    const timer = timers.find((candidate) => candidate === handle);
    if (timer !== undefined) timer.cleared = true;
  }

  const logger: JobLogger = {
    info: (obj, msg) => { logs.push({ level: "info", obj, msg }); },
    warn: (obj, msg) => { logs.push({ level: "warn", obj, msg }); },
    error: (obj, msg) => { logs.push({ level: "error", obj, msg }); },
  };

  const countPass = (): Promise<void> => {
    passes.count += 1;
    return Promise.resolve();
  };

  function makeWorker(overrides: Partial<JobWorkerDeps> = {}): JobWorker {
    return new JobWorker({
      db: counted,
      registry,
      serverId: "test-server",
      logger,
      alerts,
      lostClaimPauseSeconds: 0,
      setTimer,
      clearTimer,
      yieldToLoop: async () => {
        yields.count += 1;
        await new Promise((resolve) => { setImmediate(resolve); });
      },
      ...overrides,
    });
  }

  /**
   * Until no pass is running or about to run. Reads the worker's memory only.
   * The deadline only bounds a failure; the test's own timeout normally comes first.
   */
  async function idle(target: JobWorker): Promise<void> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (!target.status().passRunning) return;
      await sleep(5);
    }
    throw new Error("The worker never went idle");
  }

  // ---- Reading the list, always by the database's clock ------------------

  async function rowOfKey(key: string): Promise<JobRow> {
    const [row] = (await pool.query<JobRow>("SELECT * FROM jobs WHERE key = $1", [key])).rows;
    if (row === undefined) throw new Error("No such job");
    return row;
  }

  async function stateOfKey(key: string): Promise<string> {
    return (await rowOfKey(key)).state;
  }

  async function stateOfKind(kind: string): Promise<string> {
    const [row] = (await pool.query<{ state: string }>("SELECT state FROM jobs WHERE kind = $1", [kind])).rows;
    if (row === undefined) throw new Error("No such job");
    return row.state;
  }

  /** The wait a failed try was given, exactly: `run_at` and `updated_at` are set by the same statement's now(). */
  async function waitGivenToKey(key: string): Promise<number> {
    const [row] = (await pool.query<{ seconds: number }>(
      "SELECT extract(epoch from run_at - updated_at)::double precision AS seconds FROM jobs WHERE key = $1",
      [key],
    )).rows;
    if (row === undefined) throw new Error("No such job");
    return row.seconds;
  }

  async function makeDueNowByKey(key: string): Promise<void> {
    await pool.query("UPDATE jobs SET run_at = now() WHERE key = $1", [key]);
  }

  async function seedJob(input: { readonly kind: string; readonly version: number; readonly payload?: Record<string, unknown> }): Promise<void> {
    await pool.query(
      "INSERT INTO jobs (kind, version, key, scope, payload, max_attempts) VALUES ($1, $2, $3, 'platform', $4::jsonb, 6)",
      [input.kind, input.version, `seed-${randomUUID()}`, JSON.stringify(input.payload ?? { n: 1 })],
    );
  }

  async function seedQueued(count: number): Promise<void> {
    await pool.query(
      `INSERT INTO jobs (kind, version, key, scope, payload, max_attempts)
       SELECT 'test.effect', 1, 'many-' || n, 'platform', '{"n": 1}'::jsonb, 6 FROM generate_series(1, $1::integer) AS n`,
      [count],
    );
  }

  async function databaseNowMs(): Promise<number> {
    const [row] = (await pool.query<{ ms: number }>("SELECT (extract(epoch from now()) * 1000)::double precision AS ms")).rows;
    if (row === undefined) throw new Error("No clock");
    return row.ms;
  }

  async function secondsToNextHour(): Promise<number> {
    const [row] = (await pool.query<{ seconds: number }>(
      "SELECT (ceil(extract(epoch from now()) / 3600) * 3600 - extract(epoch from now()))::double precision AS seconds",
    )).rows;
    if (row === undefined) throw new Error("No clock");
    return row.seconds;
  }

  function inSeconds(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  async function started(key: string): Promise<void> {
    await waitsStarted;
    expect(worker.status().currentJob?.id).toBe((await rowOfKey(key)).id);
  }

  /** Polls the list (not the worker) until `check` holds. */
  async function eventually(check: () => Promise<boolean>): Promise<void> {
    for (let look = 0; look < 400; look += 1) {
      if (await check()) return;
      await sleep(10);
    }
    throw new Error("It never happened");
  }

  // ---- Set-up --------------------------------------------------------------

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_worker_${randomUUID()}`));
    counted = countedDatabase(db);
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
    statements.count = 0;
    passes.count = 0;
    yields.count = 0;
    timers.length = 0;
    logs.length = 0;
    ran.length = 0;
    upcoming.length = 0;
    broken = false;
    alerts = recordingJobAlerts();
    seenSignal = null;
    waitsSignal = null;
    waitsStarted = new Promise((resolve) => { markStarted = () => { resolve(); }; });
    released = new Promise((resolve) => { release = () => { resolve(); }; });
    worker = makeWorker();
  });

  afterEach(async () => {
    await worker.stop(100);
    release();
    broken = false;
    upcoming.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ---- The brief's cases ---------------------------------------------------

  it("runs a due job and marks it done", async () => {
    await enqueueJob(db, effect, { key: "a", payload: { n: 1 } });
    worker.start(); await idle(worker);
    expect(await stateOfKey("a")).toBe("done");
    expect(ran).toEqual([1]);
    expect(worker.status()).toMatchObject({ started: true, passRunning: false, currentJob: null, fault: null });
    expect(worker.status().lastPassAt).not.toBeNull();
  });

  it("sleeps until the next job is due and asks the database nothing in between", async () => {
    worker = makeWorker({ sleepMinutes: FAR_BOUNDARY_MINUTES });
    await enqueueJob(db, effect, { key: "later", runAt: inSeconds(90), payload: { n: 2 } });
    worker.start(); await idle(worker);
    expect(timers.at(-1)?.ms).toBeGreaterThan(80_000);
    expect(timers.at(-1)?.ms).toBeLessThanOrEqual(90_000);
    expect(timers.filter((timer) => !timer.cleared && !timer.fired)).toHaveLength(1);
    expect(worker.status().nextWakeAt).not.toBeNull();
    const before = statements.count;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(statements.count).toBe(before);
    expect(await stateOfKey("later")).toBe("queued");
  });

  it("with nothing due, wakes on the hour by the database's clock", async () => {
    worker.start(); await idle(worker);
    expect(timers.at(-1)?.ms).toBeGreaterThan(0);
    expect(timers.at(-1)?.ms).toBeLessThanOrEqual(3_600_000);
    // Compared round the hour, so a test that runs as the hour turns still compares like with like.
    const apart = Math.abs((timers.at(-1)?.ms ?? 0) / 1000 - await secondsToNextHour());
    expect(Math.min(apart, 3600 - apart)).toBeLessThan(3);
  });

  it("a poke wakes it at once, and pokes during a pass fold into one more", async () => {
    worker = makeWorker({ afterPass: countPass });
    worker.start(); await idle(worker);
    await enqueueJob(db, effect, { key: "now", payload: { n: 3 } });
    worker.poke(); worker.poke(); worker.poke(); await idle(worker);
    expect(await stateOfKey("now")).toBe("done");
    expect(passes.count).toBe(2);
    // The sleep the poke cut short was cleared, and one new one was set.
    expect(timers.filter((timer) => !timer.cleared && !timer.fired)).toHaveLength(1);
  });

  it("a handler that never returns is failed at its limit, told to stop, and the next job runs", async () => {
    await enqueueJob(db, hangs, { key: "hung", payload: {} });
    await enqueueJob(db, effect, { key: "after", payload: { n: 4 } });
    worker.start(); await idle(worker);
    expect(await rowOfKey("hung")).toMatchObject({ state: "queued", attempts: 1, last_error: expect.stringContaining("time limit") });
    expect((await rowOfKey("hung")).last_error).toBe("The handler passed its time limit of 50 ms.");
    expect(await stateOfKey("after")).toBe("done");
    expect(seenSignal?.aborted).toBe(true);
    expect(worker.status().abandonedHandlers).toBe(1);
  });

  it("what an abandoned handler does later is caught", async () => {
    const stray = vi.fn(); process.on("unhandledRejection", stray);
    await enqueueJob(db, rejectsLate, { key: "late", payload: {} });
    worker.start(); await idle(worker); await new Promise((resolve) => setTimeout(resolve, 250));
    process.off("unhandledRejection", stray);
    expect(stray).not.toHaveBeenCalled();
    // Caught, and logged with its text.
    expect(logs.some((entry) => entry.level === "warn" && entry.obj["error"] === "rejected after its limit")).toBe(true);
  });

  it("a poisoned job goes dead with one alert while other jobs keep moving", async () => {
    await enqueueJob(db, alwaysThrows, { key: "poison", payload: {} });
    await enqueueJob(db, effect, { key: "fine", payload: { n: 5 } });
    worker.start(); await idle(worker); await makeDueNowByKey("poison"); worker.poke(); await idle(worker);
    expect(await stateOfKey("poison")).toBe("dead");
    expect(await stateOfKey("fine")).toBe("done");
    expect(alerts.calls.filter(([name]) => name === "jobDead")).toHaveLength(1);
    expect(alerts.calls.find(([name]) => name === "jobDead")?.[1]).toEqual({
      id: (await rowOfKey("poison")).id, kind: "test.poison", venueId: null, reason: "refused [email address]",
    });
    expect(JSON.stringify(alerts.calls)).not.toContain("@");
    expect(JSON.stringify(logs)).not.toContain("@");
    expect((await rowOfKey("poison")).last_error).toBe("refused [email address]");
  });

  it("PermanentJobError is dead at once, with one alert", async () => {
    await enqueueJob(db, permanent, { key: "never", payload: {} });
    worker.start(); await idle(worker);
    const row = await rowOfKey("never");
    expect(row).toMatchObject({ state: "dead", attempts: 1, last_error: "This can never work.", claim_token: null });
    // Dead keeps the time it was due.
    expect(row.run_at.getTime()).toBe(row.created_at.getTime());
    expect(alerts.calls).toEqual([["jobDead", { id: row.id, kind: "test.permanent", venueId: null, reason: "This can never work." }]]);
  });

  it("RetryJobIn sets the wait", async () => {
    await enqueueJob(db, retryLater, { key: "pause", payload: { seconds: 120, failFirstRecord: false } });
    worker.start(); await idle(worker);
    expect(await rowOfKey("pause")).toMatchObject({ state: "queued", attempts: 1, last_error: "The provider asked for a pause.", claim_token: null });
    expect(await waitGivenToKey("pause")).toBe(120);
    expect(alerts.calls).toEqual([]);
  });

  it("ClaimLostError changes nothing", async () => {
    await enqueueJob(db, claimLost, { key: "gone", payload: {} });
    worker.start(); await idle(worker);
    const row = await rowOfKey("gone");
    // The row is left as the claim left it: running, its token in place, its time unchanged, no error recorded.
    expect(row).toMatchObject({ state: "running", attempts: 1, last_error: null });
    expect(row.claim_token).not.toBeNull();
    expect(row.run_at.getTime()).toBe(row.created_at.getTime());
    expect(alerts.calls).toEqual([]);
  });

  it("completeIn commits the handler's change with done, and undoes it when the claim has gone", async () => {
    await ensureEffectsTable(pool);
    // B's handler holds one connection in its transaction while it takes the claim with another. Three
    // connections are opened first, so neither handler waits on the server starting a new one (seconds,
    // on a loaded machine). The pool keeps an idle connection for ten seconds.
    await Promise.all([pool.query("SELECT 1"), pool.query("SELECT 1"), pool.query("SELECT 1")]);
    await enqueueJob(db, commits, { key: "commits", payload: {} });
    await enqueueJob(db, loses, { key: "loses", payload: {} });
    worker.start(); await idle(worker);
    const effects = (await pool.query<{ key: string }>("SELECT key FROM job_test_effects ORDER BY key")).rows;
    // Kind A: its row and `done`, together.
    expect(effects).toEqual([{ key: "commits" }]);
    expect(await stateOfKey("commits")).toBe("done");
    // Kind B: ClaimLostError rolled its row back, and the row keeps the other taker's claim.
    const lost = await rowOfKey("loses");
    expect(lost).toMatchObject({ state: "running", attempts: 1, last_error: null });
    expect(lost.claim_token).not.toBeNull();
    // Neither handler was cut off at its limit: what the worker said is only B's lost claim.
    expect(logs.filter((entry) => entry.level !== "info").map((entry) => [entry.msg, entry.obj])).toEqual([
      ["a handler found its claim had passed to another taker", expect.anything()],
    ]);
    expect(worker.status().abandonedHandlers).toBe(0);
    // recover, claim A, claim B, claim (none), plan: no second finishJob after completeIn.
    expect(statements.count).toBe(5);
    expect(alerts.calls).toEqual([]);
  }, 30_000);

  it("reads old shapes: a kind that reads versions 1 and 2 runs a version 1 row", async () => {
    await seedJob({ kind: "test.shaped", version: 1, payload: { old: true } });
    worker.start(); await idle(worker);
    expect(await stateOfKind("test.shaped")).toBe("done");
  });

  it("never takes a version it does not know, and still plans its next wake", async () => {
    await seedJob({ kind: "test.effect", version: 9 });
    worker.start(); await idle(worker);
    expect(await stateOfKind("test.effect")).toBe("queued");
    expect(timers.at(-1)).toBeDefined();
    expect(ran).toEqual([]);
  });

  it("a database fault: one alert for the outage, a retry a minute later, and it carries on", async () => {
    breakDatabase();
    worker.start(); await idle(worker);
    expect(timers.at(-1)?.ms).toBe(60_000);
    timers.at(-1)?.fire(); await idle(worker);
    expect(alerts.calls.filter(([name]) => name === "workerFault")).toHaveLength(1);
    expect(alerts.calls.find(([name]) => name === "workerFault")?.[1]).toMatchObject({ what: "database" });
    expect(worker.status().fault).toBe("database");
    expect(worker.status().lastPassAt).toBeNull();
    mendDatabase(); timers.at(-1)?.fire(); await idle(worker);
    expect(alerts.calls.filter(([name]) => name === "workerRecovered")).toHaveLength(1);
    expect(alerts.calls.find(([name]) => name === "workerRecovered")?.[1]).toEqual({ what: "database" });
    expect(worker.status().fault).toBeNull();
    expect(worker.status().lastPassAt).not.toBeNull();
  });

  it("a database call of its own that never returns does not block it", async () => {
    hangNextStatement();
    worker = makeWorker({ dbCallTimeoutMs: 50 }); worker.start(); await idle(worker);
    expect(worker.status().fault).toBe("database");
    expect(timers.at(-1)?.ms).toBe(60_000);
  });

  it("yields between jobs", async () => {
    await seedQueued(3);
    worker.start(); await idle(worker);
    expect(yields.count).toBe(3);
    expect(ran).toEqual([1, 1, 1]);
  });

  it("stop takes nothing new, waits for the running job, then hands back what is unfinished", async () => {
    await enqueueJob(db, waitsForRelease, { key: "slow", payload: {} });
    await enqueueJob(db, effect, { key: "queued-behind", payload: { n: 6 } });
    worker.start(); await started("slow");
    await worker.stop(100);
    expect(await rowOfKey("slow")).toMatchObject({ state: "queued", attempts: 0 });
    expect(await stateOfKey("queued-behind")).toBe("queued");
    expect(timers.filter((timer) => !timer.cleared && !timer.fired)).toHaveLength(0);
    // The handler was told to stop, and the worker no longer counts it as running.
    expect(waitsSignal?.aborted).toBe(true);
    expect(worker.status()).toMatchObject({ started: false, passRunning: false, currentJob: null, nextWakeAt: null });
  });

  it("status never touches the database", async () => {
    worker.start(); await idle(worker);
    const before = statements.count; worker.status();
    expect(statements.count).toBe(before);
  });

  // ---- R12: a provider's "retry after" never leaves a claim standing --------

  it("holds RetryJobIn's wait to between one second and seven days, and NaN takes the usual wait", async () => {
    await enqueueJob(db, retryLater, { key: "month", payload: { seconds: 30 * 86_400, failFirstRecord: false } });
    await enqueueJob(db, retryLater, { key: "zero", payload: { seconds: 0, failFirstRecord: false } });
    await enqueueJob(db, retryLater, { key: "negative", payload: { seconds: -5, failFirstRecord: false } });
    await enqueueJob(db, retryLater, { key: "nan", payload: { seconds: null, failFirstRecord: false } });
    worker.start(); await idle(worker);
    expect(await waitGivenToKey("month")).toBe(604_800);
    expect(await waitGivenToKey("zero")).toBe(1);
    expect(await waitGivenToKey("negative")).toBe(1);
    expect(await waitGivenToKey("nan")).toBe(RETRY_SECONDS[0]);
    for (const key of ["month", "zero", "negative", "nan"]) {
      expect(await rowOfKey(key)).toMatchObject({ state: "queued", attempts: 1, claim_token: null });
    }
  });

  it("when recording a failed try fails, tries once more on the usual wait", async () => {
    await enqueueJob(db, retryLater, { key: "unrecorded", payload: { seconds: 120, failFirstRecord: true } });
    worker.start(); await idle(worker);
    // The first failJob (with its 120 seconds) was refused; the second used the usual first wait.
    expect(await rowOfKey("unrecorded")).toMatchObject({ state: "queued", attempts: 1, claim_token: null });
    expect(await waitGivenToKey("unrecorded")).toBe(RETRY_SECONDS[0]);
    expect(worker.status().fault).toBeNull();
    expect(logs.some((entry) => entry.level === "warn" && entry.obj["error"] === "failJob failed: The statement failed.")).toBe(true);
  });

  // ---- The edges the brief leaves to the worker ------------------------------

  it("pokes while a pass runs fold into exactly one more pass", async () => {
    worker = makeWorker({ afterPass: countPass });
    worker.start(); await idle(worker);
    await enqueueJob(db, pokes, { key: "pokes", payload: {} });
    worker.poke(); await idle(worker);
    // The pass that ran the job, then one more for its three pokes.
    expect(passes.count).toBe(3);
    expect(await stateOfKey("pokes")).toBe("done");
  });

  it("afterPass is given the database's now, and the plan sees what it wrote", async () => {
    const seen: Date[] = [];
    worker = makeWorker({
      sleepMinutes: FAR_BOUNDARY_MINUTES,
      afterPass: async (now) => {
        seen.push(now);
        await enqueueJob(db, effect, { key: "written-after", runAt: new Date(now.getTime() + 30_000), payload: { n: 7 } });
      },
    });
    worker.start(); await idle(worker);
    expect(seen).toHaveLength(1);
    expect(Math.abs((seen[0]?.getTime() ?? 0) - await databaseNowMs())).toBeLessThan(5_000);
    expect(timers.at(-1)?.ms).toBeGreaterThan(20_000);
    expect(timers.at(-1)?.ms).toBeLessThanOrEqual(30_000);
    expect(await stateOfKey("written-after")).toBe("queued");
  });

  it("stop while it sleeps clears the timer; a second stop is the same stop; a poke or start after it does nothing", async () => {
    worker.start(); await idle(worker);
    const sleeping = timers.at(-1);
    expect(sleeping).toMatchObject({ fired: false, cleared: false });
    // A long grace is never waited out when nothing is running: this would time out if it were.
    await Promise.all([worker.stop(60_000), worker.stop(60_000)]);
    expect(sleeping?.cleared).toBe(true);
    expect(worker.status()).toMatchObject({ started: false, passRunning: false, nextWakeAt: null });
    const before = statements.count;
    worker.poke(); worker.start();
    expect(worker.status().passRunning).toBe(false);
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(statements.count).toBe(before);
    expect(timers).toHaveLength(1);
  });

  it("stop lets a running job finish inside the grace, and a second stop does not cut the grace short", async () => {
    await enqueueJob(db, waitsForRelease, { key: "slow", payload: {} });
    await enqueueJob(db, effect, { key: "queued-behind", payload: { n: 6 } });
    worker.start(); await started("slow");
    const stopping = worker.stop(5_000);
    const again = worker.stop(1);
    release();
    await Promise.all([stopping, again]);
    expect(await rowOfKey("slow")).toMatchObject({ state: "done", attempts: 1 });
    expect(await stateOfKey("queued-behind")).toBe("queued");
    expect(waitsSignal?.aborted).toBe(false);
    expect(worker.status().abandonedHandlers).toBe(0);
  });

  it("a handler that throws at once, or rejects with something not an Error, fails like any other", async () => {
    const stray = vi.fn(); process.on("unhandledRejection", stray);
    await enqueueJob(db, throwsAtOnce, { key: "at-once", payload: {} });
    await enqueueJob(db, throwsText, { key: "text", payload: {} });
    worker.start(); await idle(worker);
    process.off("unhandledRejection", stray);
    expect(await rowOfKey("at-once")).toMatchObject({ state: "queued", attempts: 1, last_error: "thrown before any promise" });
    expect(await rowOfKey("text")).toMatchObject({ state: "queued", attempts: 1, last_error: "a plain string, not an Error" });
    expect(worker.status().fault).toBeNull();
    expect(stray).not.toHaveBeenCalled();
  });

  it("a claim that answers after its limit gives its job back rather than leave it to run out", async () => {
    await enqueueJob(db, effect, { key: "late-claim", payload: { n: 8 } });
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = () => { resolve(); }; });
    // Recovery answers at once (no rows, without the database, so its own speed
    // cannot decide the test); the claim is held back past the 50 ms limit.
    upcoming.push("nothing", gate);
    worker = makeWorker({ dbCallTimeoutMs: 50 }); worker.start(); await idle(worker);
    expect(worker.status().fault).toBe("database");
    expect(alerts.calls.find(([name]) => name === "workerFault")?.[1]).toEqual({
      what: "database", detail: "claimNextJob passed its time limit of 50 ms.",
    });
    open();                                           // the claim now takes the job, after the worker gave up on it
    const handedBack = (entry: LogEntry): boolean =>
      entry.msg === "a claim answered after its limit; its job was handed back" && entry.obj["handedBack"] === true;
    await eventually(() => Promise.resolve(logs.some(handedBack)));
    expect(await rowOfKey("late-claim")).toMatchObject({ state: "queued", attempts: 0, lost_claims: 0, claim_token: null });
    expect(ran).toEqual([]);
  });

  it("a recovery that answers after its limit still raises its alerts", async () => {
    await enqueueJob(db, effect, { key: "orphan", payload: { n: 9 } });
    await pool.query(
      `UPDATE jobs SET state = 'running', attempts = 1, claim_token = gen_random_uuid(), claimed_by = 'gone',
         claim_expires_at = now() - interval '1 second' WHERE key = 'orphan'`,
    );
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = () => { resolve(); }; });
    upcoming.push(gate);                              // the recovery is held back
    worker = makeWorker({ dbCallTimeoutMs: 50 }); worker.start(); await idle(worker);
    expect(worker.status().fault).toBe("database");
    open();
    await eventually(() => Promise.resolve(alerts.calls.some(([name]) => name === "claimLost")));
    expect(alerts.calls.find(([name]) => name === "claimLost")?.[1]).toEqual({
      id: (await rowOfKey("orphan")).id, kind: "test.effect", venueId: null, lostClaims: 1,
    });
  });

  it("refuses settings that make no sense when it is built", () => {
    expect(() => makeWorker({ sleepMinutes: 0 })).toThrow(RangeError);
    expect(() => makeWorker({ sleepMinutes: Number.NaN })).toThrow(RangeError);
    expect(() => makeWorker({ dbCallTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => makeWorker({ faultRetryMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => makeWorker({ lostClaimPauseSeconds: -1 })).toThrow(RangeError);
  });
});
