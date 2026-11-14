import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { buildJobRegistry, defineJobKind } from "../services/jobs/kinds.js";
import {
  claimNextJob,
  failJob,
  finishJob,
  handBackJob,
  LOST_CLAIM_PAUSE_SECONDS,
  planNextWake,
  recoverLostClaims,
  RETRY_SECONDS,
  type ClaimedJob,
} from "../services/jobs/store.js";
import { jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, taking, finishing, failing and recovering a job: each is one statement
// under a claim token, so two servers can share the list safely. Races are run
// on real connections: a statement another one must wait for is held open in a
// transaction of its own until the other is seen waiting on its row locks.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).

/** Its claim lasts 1 second plus the margin: 16 seconds. */
const effect = defineJobKind({
  kind: "test.effect",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ n: z.number().int() }).strict(),
  handler: async (): Promise<void> => { /* nothing to do */ },
});
/** Writes version 2 and still reads version 1. Its 2.5 seconds count as 3, so its claim lasts 18 seconds. */
const reader = defineJobKind({
  kind: "test.reader",
  version: 2,
  reads: [1, 2],
  scope: "platform",
  timeoutMs: 2500,
  payload: z.object({ n: z.number().int() }).strict(),
  handler: async (): Promise<void> => { /* nothing to do */ },
});
const registry = buildJobRegistry([effect, reader]);

const LOST_CLAIM_TEXT = "The server that took this job never answered.";

// A type alias, not an interface: pg's row type has a string index signature,
// which only an alias of an object type meets.
type JobRow = {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly key: string;
  readonly state: string;
  readonly attempts: number;
  readonly lost_claims: number;
  readonly last_error: string | null;
  readonly claim_token: string | null;
  readonly claimed_by: string | null;
  readonly claim_expires_at: Date | null;
  readonly run_at: Date;
  readonly finished_at: Date | null;
};

describe.skipIf(jobsTestUrl === undefined)("jobs: taking, finishing, failing and recovering", () => {
  const applicationName = `jobs_claim_${randomUUID()}`;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(applicationName));
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedJob(input: {
    readonly key?: string;
    readonly kind?: string;
    readonly version?: number;
    readonly runAt?: SQL;
  } = {}): Promise<void> {
    await db.execute(sql`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, run_at)
      VALUES (${input.kind ?? "test.effect"}, ${input.version ?? 1}, ${input.key ?? `job-${randomUUID()}`},
        'platform', '{"n": 1}'::jsonb, 6, ${input.runAt ?? sql`now()`})`);
  }

  async function seedQueued(count: number): Promise<void> {
    await pool.query(
      `INSERT INTO jobs (kind, version, key, scope, payload, max_attempts)
       SELECT 'test.effect', 1, 'many-' || n, 'platform', '{"n": 1}'::jsonb, 6 FROM generate_series(1, $1::integer) AS n`,
      [count],
    );
  }

  /** Takes the next due job, writing one first if none is due. */
  async function takeOne(): Promise<ClaimedJob> {
    const due = await claimNextJob(db, registry, "a");
    if (due !== null) return due;
    await seedJob();
    const job = await claimNextJob(db, registry, "a");
    if (job === null) throw new Error("Nothing to take");
    return job;
  }

  async function rowOf(id: string): Promise<JobRow> {
    const [row] = (await pool.query<JobRow>("SELECT * FROM jobs WHERE id = $1", [id])).rows;
    if (row === undefined) throw new Error("No such job");
    return row;
  }

  async function idOf(key: string): Promise<string> {
    const [row] = (await pool.query<{ id: string }>("SELECT id FROM jobs WHERE key = $1", [key])).rows;
    if (row === undefined) throw new Error("No such job");
    return row.id;
  }

  async function stateOf(id: string): Promise<string> {
    return (await rowOf(id)).state;
  }

  async function stateOfAll(): Promise<readonly string[]> {
    return (await pool.query<{ state: string }>("SELECT state FROM jobs ORDER BY key")).rows.map((row) => row.state);
  }

  /** By the database's clock, never the test's. */
  async function secondsFromNow(column: "run_at" | "claim_expires_at", where: "key" | "id", value: string): Promise<number> {
    const [row] = (await pool.query<{ seconds: number | null }>(
      `SELECT extract(epoch from ${column} - now())::double precision AS seconds FROM jobs WHERE ${where} = $1`,
      [value],
    )).rows;
    if (row?.seconds === undefined || row.seconds === null) throw new Error("No such job, or no such time");
    return row.seconds;
  }

  const claimSecondsLeft = (key: string): Promise<number> => secondsFromNow("claim_expires_at", "key", key);
  const dueInSeconds = (key: string): Promise<number> => secondsFromNow("run_at", "key", key);
  const dueInSecondsById = (id: string): Promise<number> => secondsFromNow("run_at", "id", id);

  async function makeDueNow(key: string): Promise<void> {
    await pool.query("UPDATE jobs SET run_at = now() WHERE key = $1", [key]);
  }

  async function makeDueNowById(id: string): Promise<void> {
    await pool.query("UPDATE jobs SET run_at = now() WHERE id = $1", [id]);
  }

  /** Stands in for waiting out the claim. */
  async function expireClaim(id: string): Promise<void> {
    await pool.query("UPDATE jobs SET claim_expires_at = now() - interval '1 second' WHERE id = $1", [id]);
  }

  /** Waits until `count` of this suite's statements are waiting on a lock. */
  async function waitForLockWaiters(count: number): Promise<void> {
    for (let look = 0; look < 250; look += 1) {
      const [row] = (await pool.query<{ waiting: number }>(
        "SELECT count(*)::integer AS waiting FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )).rows;
      if ((row?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
    throw new Error(`Expected ${String(count)} statements waiting on a lock`);
  }

  /**
   * Runs `first` in a transaction held open on a connection of its own, then
   * `second` while it is open, then commits. With `waiters` 0, `second` must
   * finish while `first` still holds its rows (a statement that waited on them
   * instead fails at the pool's lock timeout). Otherwise `second` is started,
   * and the commit waits until that many of its statements are waiting on the
   * held rows. Either way the two overlap for certain, as two servers'
   * statements can, rather than merely starting together.
   */
  async function overlap<A, B>(
    first: (held: Database) => Promise<A>,
    second: () => Promise<B>,
    waiters: number,
  ): Promise<{ readonly first: A; readonly second: B }> {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      const firstResult = await first(drizzle(client, { schema }));
      const pending = second();
      // Handled at once, so a failure while this waits is never an unhandled rejection.
      void pending.catch(() => undefined);
      if (waiters === 0) {
        const secondResult = await pending;
        await client.query("COMMIT");
        committed = true;
        return { first: firstResult, second: secondResult };
      }
      await waitForLockWaiters(waiters);
      await client.query("COMMIT");
      committed = true;
      return { first: firstResult, second: await pending };
    } finally {
      if (!committed) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }

  it("two takers never take the same job", async () => {
    await seedQueued(50);
    const taken = await Promise.all(Array.from({ length: 50 }, (_, i) => claimNextJob(db, registry, i % 2 === 0 ? "a" : "b")));
    const ids = taken.filter((job) => job !== null).map((job) => job.id);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    const [claims] = (await pool.query<{ running: number; tokens: number }>(
      "SELECT count(*) FILTER (WHERE state = 'running')::integer AS running, count(DISTINCT claim_token)::integer AS tokens FROM jobs",
    )).rows;
    expect(claims).toEqual({ running: 50, tokens: 50 });
    // The same with the overlap made certain: while one taker's statement still holds the oldest
    // job, uncommitted, another passes over it without waiting and takes the next.
    await resetJobs(pool);
    await seedJob({ key: "held", runAt: sql`now() - interval '1 minute'` });
    await seedJob({ key: "next" });
    const race = await overlap(
      (held) => claimNextJob(held, registry, "a"),
      () => claimNextJob(db, registry, "b"),
      0,
    );
    expect(race.first?.id).toBe(await idOf("held"));
    expect(race.second?.id).toBe(await idOf("next"));
    expect(await rowOf(await idOf("held"))).toMatchObject({ state: "running", attempts: 1, claimed_by: "a" });
  });

  it("takes the oldest due job, and leaves what is not yet due", async () => {
    await seedJob({ key: "later", runAt: sql`now() + interval '1 hour'` });
    await seedJob({ key: "older", runAt: sql`now() - interval '2 minutes'` });
    await seedJob({ key: "newer", runAt: sql`now() - interval '1 minute'` });
    expect((await claimNextJob(db, registry, "a"))?.id).toBe(await idOf("older"));
    expect((await claimNextJob(db, registry, "a"))?.id).toBe(await idOf("newer"));
    expect(await claimNextJob(db, registry, "a")).toBeNull();
    expect(await stateOf(await idOf("later"))).toBe("queued");
  });

  it("takes only kinds and versions the registry knows", async () => {
    await seedJob({ key: "1-unknown", kind: "test.unknown" });
    await seedJob({ key: "2-unread-version", kind: "test.effect", version: 9 });
    expect(await claimNextJob(db, registry, "a")).toBeNull();
    expect(await stateOfAll()).toEqual(["queued", "queued"]);
    // A kind that still reads an older version takes it, and nothing newer than it knows.
    await seedJob({ key: "3-reader-old", kind: "test.reader", version: 1 });
    await seedJob({ key: "4-reader-new", kind: "test.reader", version: 3 });
    // An empty registry knows nothing: it takes nothing and plans for no due job.
    const none = buildJobRegistry([]);
    expect(await claimNextJob(db, none, "a")).toBeNull();
    expect((await planNextWake(db, none, 60)).dueInSeconds).toBeNull();
    expect(await claimNextJob(db, registry, "a")).toMatchObject({ kind: "test.reader", version: 1 });
    expect(await claimNextJob(db, registry, "a")).toBeNull();
    expect(await stateOfAll()).toEqual(["queued", "queued", "running", "queued"]);
  });

  it("a claim lasts the kind's time limit plus the margin, and counts the try", async () => {
    await seedJob({ key: "a" });
    const job = await claimNextJob(db, registry, "a");
    expect(job?.attempts).toBe(1);
    expect(await claimSecondsLeft("a")).toBeGreaterThan(14);
    expect(await claimSecondsLeft("a")).toBeLessThanOrEqual(16);
    const id = await idOf("a");
    expect(job).toEqual({
      id, kind: "test.effect", version: 1, venueId: null, payload: { n: 1 }, attempts: 1, claimToken: expect.any(String),
    });
    expect(await rowOf(id)).toMatchObject({ state: "running", claimed_by: "a", claim_token: job?.claimToken });
    // Each kind's own limit: test.reader's 2.5 seconds count as 3, so its claim lasts 18.
    await seedJob({ key: "r", kind: "test.reader", version: 2 });
    expect(await claimNextJob(db, registry, "b")).toMatchObject({ kind: "test.reader", version: 2, attempts: 1 });
    expect(await claimSecondsLeft("r")).toBeGreaterThan(16);
    expect(await claimSecondsLeft("r")).toBeLessThanOrEqual(18);
    expect(await rowOf(await idOf("r"))).toMatchObject({ claimed_by: "b" });
  });

  it("only the claim's own token finishes it", async () => {
    const job = await takeOne();
    expect(await finishJob(db, job.id, randomUUID())).toBe(false);
    expect(await stateOf(job.id)).toBe("running");
    expect(await finishJob(db, job.id, job.claimToken)).toBe(true);
    expect(await rowOf(job.id)).toMatchObject({ state: "done", claim_token: null, claimed_by: null, claim_expires_at: null });
    expect((await rowOf(job.id)).finished_at).toBeInstanceOf(Date);
    // A claim finishes once.
    expect(await finishJob(db, job.id, job.claimToken)).toBe(false);
    // Its claim has run out but no recovery has taken it: its own token still finishes it, in the
    // handler's transaction. A recovery that meets that transaction waits, then finds nothing to put back.
    const late = await takeOne();
    await expireClaim(late.id);
    const race = await overlap((held) => finishJob(held, late.id, late.claimToken), () => recoverLostClaims(db), 1);
    expect(race).toEqual({ first: true, second: [] });
    expect(await rowOf(late.id)).toMatchObject({ state: "done", lost_claims: 0, claim_token: null });
  });

  it("fails after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then is dead", async () => {
    await seedJob({ key: "a" });
    for (const seconds of RETRY_SECONDS) {
      const job = await takeOne();
      expect(await failJob(db, job.id, job.claimToken, "no", { permanent: false })).toBe("queued");
      expect(Math.abs(await dueInSeconds("a") - seconds)).toBeLessThan(2);
      expect(await rowOf(job.id)).toMatchObject({ state: "queued", claim_token: null, claimed_by: null, claim_expires_at: null });
      await makeDueNow("a");
    }
    const last = await takeOne();
    expect(last.attempts).toBe(6);
    expect(await failJob(db, last.id, last.claimToken, "no", { permanent: false })).toBe("dead");
    expect(await rowOf(last.id)).toMatchObject({ state: "dead", last_error: "no", claim_token: null, claimed_by: null, claim_expires_at: null });
    expect((await rowOf(last.id)).finished_at).toBeInstanceOf(Date);
  });

  it("a permanent failure is dead at once; a stated wait is used instead of the usual one", async () => {
    const a = await takeOne();
    expect(await failJob(db, a.id, a.claimToken, "never", { permanent: true })).toBe("dead");
    expect(await rowOf(a.id)).toMatchObject({ state: "dead", attempts: 1, last_error: "never", claim_token: null });
    await seedJob({ key: "b" });
    const b = await takeOne();
    // A wait that is not a number of seconds is refused before any statement, and the claim stands.
    await expect(failJob(db, b.id, b.claimToken, "later", { permanent: false, retryInSeconds: -1 })).rejects.toThrow(RangeError);
    await expect(failJob(db, b.id, b.claimToken, "later", { permanent: false, retryInSeconds: Number.NaN })).rejects.toThrow(RangeError);
    expect(await stateOf(b.id)).toBe("running");
    expect(await failJob(db, b.id, b.claimToken, "later", { permanent: false, retryInSeconds: 40_000 })).toBe("queued");
    expect(Math.abs(await dueInSeconds("b") - 40_000)).toBeLessThan(2);
  });

  it("a failure reported under a lost claim changes nothing", async () => {
    const job = await takeOne();
    expect(await failJob(db, job.id, randomUUID(), "no", { permanent: false })).toBe("lost");
    expect(await stateOf(job.id)).toBe("running");
    // The claim runs out and a recovery takes the row first. The claim's own late reports wait for
    // it, then each changes nothing and says so.
    await expireClaim(job.id);
    const race = await overlap(
      (held) => recoverLostClaims(held),
      () => Promise.all([
        failJob(db, job.id, job.claimToken, "late", { permanent: false }),
        finishJob(db, job.id, job.claimToken),
        handBackJob(db, job.id, job.claimToken),
      ]),
      3,
    );
    expect(race.first).toEqual([expect.objectContaining({ id: job.id, state: "queued", lostClaims: 1 })]);
    expect(race.second).toEqual(["lost", false, false]);
    expect(await rowOf(job.id)).toMatchObject({
      state: "queued", attempts: 1, lost_claims: 1, last_error: LOST_CLAIM_TEXT, claim_token: null, claimed_by: null,
    });
  });

  it("handing back does not count the try", async () => {
    const job = await takeOne();
    expect(await handBackJob(db, job.id, job.claimToken)).toBe(true);
    expect(await rowOf(job.id)).toMatchObject({ state: "queued", attempts: 0, claim_token: null });
    expect(await handBackJob(db, job.id, job.claimToken)).toBe(false);
    // Still due: the next server takes it at once, as its first try.
    expect(await claimNextJob(db, registry, "b")).toMatchObject({ id: job.id, attempts: 1 });
  });

  it("a claim that ran out is put back once, after the pause, and the second time is dead", async () => {
    const first = await takeOne();
    await expireClaim(first.id);
    expect(await recoverLostClaims(db)).toEqual([expect.objectContaining({ id: first.id, state: "queued", lostClaims: 1 })]);
    expect(Math.abs(await dueInSecondsById(first.id) - LOST_CLAIM_PAUSE_SECONDS)).toBeLessThan(2);
    expect(await rowOf(first.id)).toMatchObject({ state: "queued", last_error: LOST_CLAIM_TEXT, claim_token: null, finished_at: null });
    await makeDueNowById(first.id);
    const second = await takeOne();
    expect(second.id).toBe(first.id);
    await expireClaim(second.id);
    expect(await recoverLostClaims(db)).toEqual([expect.objectContaining({ id: first.id, state: "dead", lostClaims: 2 })]);
    expect(await rowOf(first.id)).toMatchObject({ state: "dead", attempts: 2, claim_token: null, claimed_by: null, claim_expires_at: null });
    expect((await rowOf(first.id)).finished_at).toBeInstanceOf(Date);
    await expect(recoverLostClaims(db, -1)).rejects.toThrow(RangeError);
  });

  it("two servers recovering at once count one lost claim", async () => {
    const job = await takeOne();
    await expireClaim(job.id);
    const both = await Promise.all([recoverLostClaims(db), recoverLostClaims(db)]);
    expect(both.flat()).toHaveLength(1);
    expect((await rowOf(job.id)).lost_claims).toBe(1);
    // The same race with the overlap made certain: one recovery holds the row, the other waits on
    // it, then finds the claim already put back and counts nothing.
    const other = await takeOne();
    expect(other.id).not.toBe(job.id);
    await expireClaim(other.id);
    const race = await overlap((held) => recoverLostClaims(held), () => recoverLostClaims(db), 1);
    expect(race.first).toEqual([expect.objectContaining({ id: other.id, lostClaims: 1 })]);
    expect(race.second).toEqual([]);
    expect((await rowOf(other.id)).lost_claims).toBe(1);
  });

  it("a claim that has not run out is left alone", async () => {
    const job = await takeOne();
    expect(await recoverLostClaims(db)).toEqual([]);
    expect(await stateOf(job.id)).toBe("running");
    expect((await rowOf(job.id)).lost_claims).toBe(0);
  });

  it("plans from the database's clock", async () => {
    await seedJob({ key: "soon", runAt: sql`now() + interval '90 seconds'` });
    // A kind this registry does not read never wakes it.
    await seedJob({ key: "unknown", kind: "test.unknown", runAt: sql`now() + interval '10 seconds'` });
    const plan = await planNextWake(db, registry, 60);
    expect(Math.abs((plan.dueInSeconds ?? 0) - 90)).toBeLessThan(2);
    expect(plan.boundaryInSeconds).toBeGreaterThan(0);
    expect(plan.boundaryInSeconds).toBeLessThanOrEqual(3600);
    expect((await planNextWake(db, registry, 5)).boundaryInSeconds).toBeLessThanOrEqual(300);
    const [clock] = (await pool.query<{ ms: number }>("SELECT (extract(epoch from now()) * 1000)::double precision AS ms")).rows;
    expect(Math.abs(plan.now.getTime() - (clock?.ms ?? 0))).toBeLessThan(2000);
    // A job already overdue is due now, not in the past.
    await seedJob({ key: "overdue", runAt: sql`now() - interval '1 minute'` });
    expect((await planNextWake(db, registry, 60)).dueInSeconds).toBe(0);
    await expect(planNextWake(db, registry, 0)).rejects.toThrow(RangeError);
  });

  it("plans for another server's claim running out, and for nothing when nothing is due", async () => {
    expect((await planNextWake(db, registry, 60)).dueInSeconds).toBeNull();
    await takeOne();
    const plan = await planNextWake(db, registry, 60);
    expect(plan.dueInSeconds).toBeGreaterThan(13);
    expect(plan.dueInSeconds).toBeLessThanOrEqual(16);
  });
});
