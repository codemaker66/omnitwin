import { randomUUID } from "node:crypto";
import { SelfTestResultSchema, StuckJobSchema, StuckWorkSchema, USER_ROLES, type SelfTestResult, type StuckJob } from "@omnitwin/types";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import { adminJobsRoutes } from "../routes/admin-jobs.js";
import { recordingJobAlerts } from "../services/jobs/alerts.js";
import { buildJobRegistry, defineJobKind, type JobLogger } from "../services/jobs/kinds.js";
import { buildJobKinds } from "../services/jobs/runtime.js";
import { JobRetryPreparationError, retryDeadJob } from "../services/jobs/store.js";
import { installJobWorker } from "../services/jobs/wake.js";
import { JobWorker } from "../services/jobs/worker.js";
import { ensureEffectsTable, jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, Stuck work: the routes a platform administrator uses on dead jobs.
//
// The plugin is mounted on its own small server against the explicit
// throwaway database, with the real `authenticate` and `authorizePlatformAdmin`
// and a registry that adds three test kinds (one for a venue, one with a
// preparation for Try again, three whose preparation throws). One test builds
// the whole server to prove the plugin is registered there. Identities are the
// test-mode tokens `admin.test.ts` uses (read only when NODE_ENV is "test").
// Fixtures use example.org. The small server logs to a captured stream, so a
// test can read what the route logged.
process.env["NODE_ENV"] = "test";

const JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters-long";

const quietLogger: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const venueKind = defineJobKind({
  kind: "test.venue",
  version: 1,
  scope: "venue",
  timeoutMs: 1000,
  payload: z.object({ nonce: z.string() }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
});

/** Its preparation records itself in the tests-only table, inside the retry's transaction. */
const preparedKind = defineJobKind({
  kind: "test.prepared",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ nonce: z.string() }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
  onManualRetry: async (tx, payload) => {
    await tx.execute(sql`INSERT INTO job_test_effects (key, server) VALUES (${payload.nonce}, 'prepared')`);
  },
});

/** Its preparation writes, then throws: the write must go with the rest of the retry. */
const failingKind = defineJobKind({
  kind: "test.prep-fails",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ nonce: z.string() }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
  onManualRetry: async (tx, payload) => {
    await tx.execute(sql`INSERT INTO job_test_effects (key, server) VALUES (${payload.nonce}, 'prepared')`);
    throw new Error("The preparation failed");
  },
});

const PREPARATION_FAILED = {
  error: "This job could not be made ready for another try. It is still stuck.",
  code: "JOB_RETRY_PREPARATION_FAILED",
};
const NOT_FOUND = { error: "There is no such job.", code: "JOB_NOT_FOUND" };
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Its preparation fails in the kind's own parse of a stored payload, as a changed shape would. */
const zodFailingKind = defineJobKind({
  kind: "test.prep-zod",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ nonce: z.string() }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
  onManualRetry: (_tx, payload) => {
    z.number().parse(payload.nonce);
    return Promise.resolve();
  },
});

/** Its preparation fails with a message that holds an address and a query parameter. */
const addressFailingKind = defineJobKind({
  kind: "test.prep-address",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ nonce: z.string() }).strict(),
  handler: (): Promise<void> => Promise.resolve(),
  onManualRetry: () => Promise.reject(new Error("could not write to someone@example.org?token=abc")),
});

type JobState = "queued" | "running" | "done" | "dead" | "abandoned";

interface Seed {
  readonly id?: string;
  readonly kind?: string;
  readonly version?: number;
  readonly state: JobState;
  readonly venueId?: string;
  readonly attempts?: number;
  readonly lostClaims?: number;
  readonly lastError?: string;
  /** Timestamps, as the database reads them. */
  readonly runAt?: string;
  readonly finishedAt?: string;
  readonly nonce?: string;
}

// A type alias, not an interface: pg's row type has a string index signature,
// which only an alias of an object type meets.
type JobRow = {
  readonly state: string;
  readonly attempts: number;
  readonly lost_claims: number;
  readonly resolved_by: string | null;
  readonly resolved_at: Date | null;
  readonly resolution: string | null;
  readonly finished_at: Date | null;
  readonly last_error: string | null;
  readonly fresh_run_at: boolean;
};

type Method = "GET" | "POST";
type StuckBody = { readonly data: z.infer<typeof StuckWorkSchema> };

/** What a response said, checked against the contract instead of trusted. */
function stuckBody(response: { json: () => unknown }): StuckBody {
  return z.object({ data: StuckWorkSchema }).parse(response.json());
}

/** The throwaway database's url, marked with the whole server's name; any query the url already has stays. */
function wholeServerUrl(base: string): string {
  const url = new URL(base);
  url.searchParams.set("application_name", "admin_jobs_whole");
  return url.toString();
}

describe.skipIf(jobsTestUrl === undefined)("jobs: Stuck work, the routes", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  /** What the small server logged, one JSON line each. */
  const logged: string[] = [];
  const adminId = randomUUID();
  const venueId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  const registry = buildJobRegistry([
    ...buildJobKinds(recordingJobAlerts()).kinds,
    venueKind,
    preparedKind,
    failingKind,
    zodFailingKind,
    addressFailingKind,
  ]);

  const platformAdmin = JSON.stringify({ id: adminId, email: `admin-${suffix}@example.org`, role: "admin", platformRole: "admin", venueId: null });
  /** A signed-in person of this role who is not a platform administrator. */
  const withRole = (role: string): string => JSON.stringify({ id: randomUUID(), email: `${role}-${suffix}@example.org`, role, platformRole: "none", venueId });

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`admin_jobs_${randomUUID()}`));
    await pool.query(
      "INSERT INTO users (id, email, name, role, platform_role) VALUES ($1, $2, 'Test Admin', 'admin', 'admin')",
      [adminId, `admin-${suffix}@example.org`],
    );
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Test Hall', $2, '1 Test Street')",
      [venueId, `test-hall-${suffix}`],
    );
    server = Fastify({ logger: { level: "error", stream: { write: (line: string) => { logged.push(line); } } } });
    await server.register(adminJobsRoutes, { db, registry, prefix: "/admin/jobs" });
    await server.ready();
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
    await ensureEffectsTable(pool);
    await pool.query("DELETE FROM email_sends");
    logged.length = 0;
  });

  afterAll(async () => {
    await server.close();
    await pool.query("TRUNCATE TABLE jobs");
    await pool.query("DELETE FROM venues WHERE id = $1", [venueId]);
    await pool.query("DELETE FROM users WHERE id = $1", [adminId]);
    await pool.end();
  });

  function call(method: Method, url: string, token?: string, body?: Record<string, unknown>) {
    return server.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      ...(body === undefined ? {} : { payload: body }),
    });
  }

  const asPlatformAdmin = (method: Method, url: string, body?: Record<string, unknown>) => call(method, url, platformAdmin, body);

  async function seed(input: Seed): Promise<string> {
    const id = input.id ?? randomUUID();
    const state = input.state;
    await pool.query(
      `INSERT INTO jobs (id, kind, version, key, scope, venue_id, payload, max_attempts, state, attempts, lost_claims, last_error,
         run_at, finished_at, claim_token, claimed_by, claim_expires_at, resolved_at, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 6, $8::text, $9, $10, $11,
         COALESCE($12::timestamptz, now()), $13::timestamptz,
         CASE WHEN $8::text = 'running' THEN gen_random_uuid() END,
         CASE WHEN $8::text = 'running' THEN 'a-test-server' END,
         CASE WHEN $8::text = 'running' THEN now() + interval '1 hour' END,
         CASE WHEN $8::text = 'abandoned' THEN now() END,
         CASE WHEN $8::text = 'abandoned' THEN 'Closed by hand.' END)`,
      [
        id, input.kind ?? "jobs.selftest", input.version ?? 1, `key-${id}`,
        input.venueId === undefined ? "platform" : "venue", input.venueId ?? null,
        JSON.stringify({ nonce: input.nonce ?? `nonce-${id}` }), state, input.attempts ?? 0, input.lostClaims ?? 0,
        input.lastError ?? null, input.runAt ?? null,
        input.finishedAt ?? (state === "dead" || state === "done" ? new Date().toISOString() : null),
      ],
    );
    return id;
  }

  async function rowOf(id: string): Promise<JobRow> {
    const [row] = (await pool.query<JobRow>(
      `SELECT state, attempts, lost_claims, resolved_by, resolved_at, resolution, finished_at, last_error,
         (run_at > now() - interval '1 minute') AS fresh_run_at
       FROM jobs WHERE id = $1`,
      [id],
    )).rows;
    if (row === undefined) throw new Error("No such job");
    return row;
  }

  /** Every job row, as a value: for "a refused call changed nothing". */
  async function wholeTable(): Promise<unknown[]> {
    return (await pool.query<Record<string, unknown>>("SELECT * FROM jobs ORDER BY id")).rows;
  }

  async function effects(): Promise<string[]> {
    return (await pool.query<{ key: string }>("SELECT key FROM job_test_effects ORDER BY key")).rows.map((row) => row.key);
  }

  async function seedSend(status: string, age: string): Promise<void> {
    await pool.query(
      `INSERT INTO email_sends (idempotency_key, recipient, subject, status, created_at)
       VALUES ($1, 'guest@example.org', 'A test send', $2, now() - $3::interval)`,
      [randomUUID(), status, age],
    );
  }

  // ---- Who may use it -------------------------------------------------------

  it("every role that is not a platform administrator, and a signed-out caller, are refused on all four routes, and nothing changes", async () => {
    const deadId = await seed({ state: "dead", attempts: 6, lastError: "no" });
    await seed({ state: "queued" });
    const before = await wholeTable();
    const routes: readonly { readonly method: Method; readonly url: string; readonly body?: Record<string, unknown> }[] = [
      { method: "GET", url: "/admin/jobs/stuck" },
      { method: "POST", url: `/admin/jobs/${deadId}/retry` },
      { method: "POST", url: `/admin/jobs/${deadId}/close`, body: { note: "Closed by someone who may not" } },
      { method: "POST", url: "/admin/jobs/selftest" },
    ];
    // The roles come from the vocabulary, so a role added to it is covered here without anyone remembering this file.
    for (const route of routes) {
      expect((await call(route.method, route.url, undefined, route.body)).statusCode, `${route.url} signed out`).toBe(401);
      for (const role of USER_ROLES) {
        expect((await call(route.method, route.url, withRole(role), route.body)).statusCode, `${route.url} as ${role}`).toBe(403);
      }
    }
    expect(await wholeTable()).toEqual(before);
    expect(await effects()).toEqual([]);
    // The control: the same server lets a platform administrator in, so the loop above cannot pass because every request fails.
    expect((await asPlatformAdmin("GET", "/admin/jobs/stuck")).statusCode).toBe(200);
  });

  // ---- The list ---------------------------------------------------------------

  it("lists dead jobs with their venue's name, newest first, and the counts", async () => {
    const olderDeadId = await seed({
      kind: "jobs.selftest", state: "dead", attempts: 6, lastError: "gave up",
      runAt: "2027-01-01T10:00:00.000Z", finishedAt: "2027-01-02T10:00:00.000Z",
    });
    const newerDeadId = await seed({
      kind: "test.venue", state: "dead", venueId, attempts: 3, lostClaims: 1, lastError: "no",
      runAt: "2027-01-03T10:00:00.000Z", finishedAt: "2027-01-04T11:30:15.250Z", nonce: "a-secret-nonce-value",
    });
    await seed({ state: "queued" });
    await seed({ state: "done" });
    await seed({ state: "abandoned" });
    await seedSend("pending", "2 days");
    await seedSend("pending", "1 hour");
    await seedSend("queued", "2 days");
    await seedSend("sent", "2 days");

    const response = await asPlatformAdmin("GET", "/admin/jobs/stuck");
    expect(response.statusCode).toBe(200);
    const body = stuckBody(response).data;
    expect(body.jobs.map((job: StuckJob) => job.id)).toEqual([newerDeadId, olderDeadId]);
    expect(body.jobs[0]).toEqual({
      id: newerDeadId, kind: "test.venue", venueId, venueName: "Test Hall", attempts: 3, lostClaims: 1, reason: "no",
      dueAt: "2027-01-03T10:00:00.000Z", gaveUpAt: "2027-01-04T11:30:15.250Z",
    });
    expect(body.jobs[1]).toEqual({
      id: olderDeadId, kind: "jobs.selftest", venueId: null, venueName: null, attempts: 6, lostClaims: 0, reason: "gave up",
      dueAt: "2027-01-01T10:00:00.000Z", gaveUpAt: "2027-01-02T10:00:00.000Z",
    });
    expect(body.counts).toEqual({ queued: 1, running: 0, dead: 2, oldPendingSends: 1 });
    // No worker runs in this process.
    expect(body.worker).toEqual({ worker: "off" });
    // The whole answer is the contract's shape, and holds no payload, address or name.
    expect(StuckWorkSchema.parse(body)).toEqual(body);
    for (const job of body.jobs) expect(StuckJobSchema.strict().safeParse(job).success).toBe(true);
    expect(response.body).not.toContain("a-secret-nonce-value");
    expect(response.body).not.toContain("example.org");
    // Nor the seeded person's name (the administrator's user row) or the venue's street address.
    expect(response.body).not.toContain("Test Admin");
    expect(response.body).not.toContain("1 Test Street");
  });

  it("counts every queued, running and dead job in the table", async () => {
    await seed({ state: "queued" });
    await seed({ state: "queued" });
    await seed({ state: "running" });
    await seed({ state: "dead" });
    const body = stuckBody(await asPlatformAdmin("GET", "/admin/jobs/stuck"));
    expect(body.data.counts).toEqual({ queued: 2, running: 1, dead: 1, oldPendingSends: 0 });
  });

  it("lists at most 200, the newest, while counting them all; two that gave up together come out in a fixed order", async () => {
    await pool.query(`
      INSERT INTO jobs (kind, version, key, scope, payload, max_attempts, state, attempts, finished_at)
      SELECT 'jobs.selftest', 1, 'bulk-' || g, 'platform', jsonb_build_object('nonce', 'bulk-' || g), 6, 'dead', 6,
             timestamptz '2027-02-01T00:00:00Z' + g * interval '1 minute'
      FROM generate_series(1, 205) AS g`);
    // Equal finished_at, the newest of all: they tie, so the id decides, highest first.
    const tied = [
      await seed({ state: "dead", finishedAt: "2027-03-01T00:00:00.000Z" }),
      await seed({ state: "dead", finishedAt: "2027-03-01T00:00:00.000Z" }),
    ].sort().reverse();
    const body = stuckBody(await asPlatformAdmin("GET", "/admin/jobs/stuck"));
    expect(body.data.jobs).toHaveLength(200);
    expect(body.data.counts.dead).toBe(207);
    expect(body.data.jobs.slice(0, 2).map((job) => job.id)).toEqual(tied);
    // 207 dead, 200 shown: the seven oldest bulk rows (minutes 1 to 7) are the ones left off the page.
    const gaveUp = body.data.jobs.slice(2).map((job) => Date.parse(job.gaveUpAt));
    expect(gaveUp).toEqual([...gaveUp].sort((a, b) => b - a));
    expect(Math.min(...gaveUp)).toBe(Date.parse("2027-02-01T00:08:00.000Z"));
  });

  // ---- Try again --------------------------------------------------------------

  it("Try again puts a dead job back, due now, with its tries reset, and records who", async () => {
    const deadId = await seed({
      state: "dead", attempts: 6, lostClaims: 1, lastError: "no", runAt: "2020-01-01T00:00:00.000Z",
    });
    const response = await asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { id: deadId } });
    const row = await rowOf(deadId);
    expect(row).toMatchObject({
      state: "queued", attempts: 0, lost_claims: 0, resolved_by: adminId, resolution: "Tried again",
      finished_at: null, fresh_run_at: true,
    });
    expect(row.resolved_at).not.toBeNull();
    // A queued job holds no claim (the table's own rule, jobs_claim, accepted the row).
    const [claim] = (await pool.query<Record<string, unknown>>("SELECT claim_token, claimed_by, claim_expires_at FROM jobs WHERE id = $1", [deadId])).rows;
    expect(claim).toEqual({ claim_token: null, claimed_by: null, claim_expires_at: null });
  });

  it("Try again runs the kind's own preparation in the same transaction, and only when it changed the row", async () => {
    const deadId = await seed({ kind: "test.prepared", state: "dead", attempts: 6, nonce: "prepared-by-retry" });
    const queuedId = await seed({ kind: "test.prepared", state: "queued", nonce: "queued-one" });
    expect((await asPlatformAdmin("POST", `/admin/jobs/${queuedId}/retry`)).statusCode).toBe(409);
    expect(await effects()).toEqual([]);

    expect((await asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`)).statusCode).toBe(200);
    expect(await effects()).toEqual(["prepared-by-retry"]);
    expect((await rowOf(deadId)).state).toBe("queued");

    // A preparation that throws takes the whole retry with it: the job stays dead, nothing it wrote stays.
    const failingId = await seed({ kind: "test.prep-fails", state: "dead", attempts: 6, lastError: "no", nonce: "never-kept" });
    const refused = await asPlatformAdmin("POST", `/admin/jobs/${failingId}/retry`);
    expect(refused.statusCode).toBe(500);
    expect(refused.json()).toEqual(PREPARATION_FAILED);
    expect(await rowOf(failingId)).toMatchObject({
      state: "dead", attempts: 6, lost_claims: 0, resolved_by: null, resolution: null, last_error: "no",
    });
    expect(await effects()).toEqual(["prepared-by-retry"]);
    // Logged once, with the kind, the job and the venue (none here) and the text, and nothing else.
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0] ?? "{}")).toMatchObject({
      level: 50, kind: "test.prep-fails", jobId: failingId, venueId: null, reason: "The preparation failed",
    });
    expect(logged[0]).not.toContain("never-kept");
  });

  it("a preparation that fails in the kind's own parse is the same 500, not a 400, and the job stays dead", async () => {
    const zodId = await seed({ kind: "test.prep-zod", state: "dead", attempts: 6, lastError: "no", nonce: "not-a-number" });
    const response = await asPlatformAdmin("POST", `/admin/jobs/${zodId}/retry`);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual(PREPARATION_FAILED);
    expect(await rowOf(zodId)).toMatchObject({ state: "dead", attempts: 6, resolved_by: null, resolution: null, last_error: "no" });
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0] ?? "{}")).toMatchObject({ kind: "test.prep-zod", jobId: zodId });
  });

  it("the text of a failed preparation holds no address and no query parameter, in the error or in the log", async () => {
    const id = await seed({ kind: "test.prep-address", state: "dead", attempts: 6, lastError: "no" });
    const error: unknown = await retryDeadJob(db, registry, id, adminId).then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(JobRetryPreparationError);
    if (!(error instanceof JobRetryPreparationError)) throw new Error("No preparation error");
    expect(error).toMatchObject({ kind: "test.prep-address", jobId: id, venueId: null });
    expect(error.message).toContain("could not write to");
    expect(error.message).not.toContain("example.org");
    expect(error.message).not.toContain("token=abc");
    expect((await rowOf(id)).state).toBe("dead");

    const response = await asPlatformAdmin("POST", `/admin/jobs/${id}/retry`);
    expect(response.statusCode).toBe(500);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain("example.org");
    expect(logged[0]).not.toContain("token=abc");
    expect(response.body).not.toContain("example.org");
  });

  it("two admins pressing Try again at the same moment: one 200, one 409, and the preparation runs once", async () => {
    const deadId = await seed({ kind: "test.prepared", state: "dead", attempts: 6, nonce: "only-once" });
    const both = await Promise.all([
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`),
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`),
    ]);
    expect(both.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const refused = both.find((response) => response.statusCode === 409);
    expect(refused?.json()).toEqual({ error: "This job is already back on the list.", code: "JOB_NOT_STUCK" });
    expect(await effects()).toEqual(["only-once"]);
    expect((await rowOf(deadId)).state).toBe("queued");
  });

  it("Try again and Close at the same moment: one wins, the other is told the job is not stuck", async () => {
    const deadId = await seed({ state: "dead", attempts: 6 });
    const [retry, close] = await Promise.all([
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/retry`),
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "Sent by hand" }),
    ]);
    expect([retry.statusCode, close.statusCode].sort()).toEqual([200, 409]);
    expect((await rowOf(deadId)).state).toBe(retry.statusCode === 200 ? "queued" : "abandoned");
  });

  it("does not put back a dead job no server of this release can run: it stays dead, to be closed with a note", async () => {
    const unknownKindId = await seed({ kind: "test.unknown", state: "dead", attempts: 6, lastError: "no" });
    const futureShapeId = await seed({ kind: "jobs.selftest", version: 2, state: "dead", attempts: 6, lastError: "no" });
    const before = await wholeTable();
    for (const id of [unknownKindId, futureShapeId]) {
      const response = await asPlatformAdmin("POST", `/admin/jobs/${id}/retry`);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "This server can no longer run this kind of job. Close it with a note.",
        code: "JOB_KIND_UNREADABLE",
      });
    }
    expect(await wholeTable()).toEqual(before);
    // Closing works for any kind.
    expect((await asPlatformAdmin("POST", `/admin/jobs/${unknownKindId}/close`, { note: "That kind is gone" })).statusCode).toBe(200);
    expect(await rowOf(unknownKindId)).toMatchObject({ state: "abandoned", resolution: "That kind is gone", resolved_by: adminId });
  });

  // ---- Close ------------------------------------------------------------------

  it("Close needs a note of 1 to 500 characters and records it", async () => {
    const deadId = await seed({ state: "dead", attempts: 6, lastError: "no" });
    const refusals: readonly Record<string, unknown>[] = [
      { note: "  " }, { note: "" }, { note: "x".repeat(501) }, { note: 7 }, {}, { note: "has a \u0000 in it" },
    ];
    for (const body of refusals) {
      const response = await asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, body);
      expect(response.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect((await rowOf(deadId)).state).toBe("dead");

    const closing = await asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "  Sent by hand  " });
    expect(closing.statusCode).toBe(200);
    expect(closing.json()).toEqual({ data: { id: deadId } });
    const closed = await rowOf(deadId);
    expect(closed).toMatchObject({ state: "abandoned", resolution: "Sent by hand", resolved_by: adminId, last_error: "no" });
    expect(closed.resolved_at).not.toBeNull();
    // It left the list of stuck jobs.
    const body = stuckBody(await asPlatformAdmin("GET", "/admin/jobs/stuck"));
    expect(body.data.jobs).toEqual([]);
    expect(body.data.counts.dead).toBe(0);
    // A note of exactly 500 is allowed.
    const another = await seed({ state: "dead" });
    expect((await asPlatformAdmin("POST", `/admin/jobs/${another}/close`, { note: "y".repeat(500) })).statusCode).toBe(200);
  });

  it("two admins closing at the same moment: one 200, one 409, and the winner's note stands", async () => {
    const deadId = await seed({ state: "dead", attempts: 6 });
    const both = await Promise.all([
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "First note" }),
      asPlatformAdmin("POST", `/admin/jobs/${deadId}/close`, { note: "Second note" }),
    ]);
    expect(both.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await rowOf(deadId)).resolution).toBe(both[0]?.statusCode === 200 ? "First note" : "Second note");
  });

  // ---- What is refused --------------------------------------------------------

  it("a job that is not dead cannot be tried again or closed, and is left as it was", async () => {
    const ids = [
      await seed({ state: "queued" }),
      await seed({ state: "running" }),
      await seed({ state: "done" }),
      await seed({ state: "abandoned" }),
    ];
    const before = await wholeTable();
    for (const id of ids) {
      const retry = await asPlatformAdmin("POST", `/admin/jobs/${id}/retry`);
      expect(retry.statusCode, `retry ${id}`).toBe(409);
      expect(retry.json()).toEqual({ error: "This job is already back on the list.", code: "JOB_NOT_STUCK" });
      const close = await asPlatformAdmin("POST", `/admin/jobs/${id}/close`, { note: "A note" });
      expect(close.statusCode, `close ${id}`).toBe(409);
      expect(close.json()).toEqual({ error: "This job is already back on the list.", code: "JOB_NOT_STUCK" });
    }
    expect(await wholeTable()).toEqual(before);
  });

  it("an id that names no job is a 404, for Try again and for Close", async () => {
    await seed({ state: "dead" });
    const before = await wholeTable();
    const nobody = randomUUID();
    const retry = await asPlatformAdmin("POST", `/admin/jobs/${nobody}/retry`);
    expect(retry.statusCode).toBe(404);
    expect(retry.json()).toEqual(NOT_FOUND);
    const close = await asPlatformAdmin("POST", `/admin/jobs/${nobody}/close`, { note: "A note" });
    expect(close.statusCode).toBe(404);
    expect(close.json()).toEqual(NOT_FOUND);
    expect(await wholeTable()).toEqual(before);
  });

  it("a job id that is not an id is a 400 before any statement is sent", async () => {
    const before = await wholeTable();
    for (const bad of ["not-an-id", "123", "00000000-0000-0000-0000-00000000000z"]) {
      const retry = await asPlatformAdmin("POST", `/admin/jobs/${bad}/retry`);
      expect(retry.statusCode, bad).toBe(400);
      expect(retry.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      const close = await asPlatformAdmin("POST", `/admin/jobs/${bad}/close`, { note: "A note" });
      expect(close.statusCode, bad).toBe(400);
      expect(close.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await wholeTable()).toEqual(before);
  });

  // ---- The self-test ----------------------------------------------------------

  describe("the self-test", () => {
    /** The same plugin with short waits, so a job nobody takes costs milliseconds, not five seconds. */
    let shortWait: FastifyInstance;

    beforeAll(async () => {
      shortWait = Fastify();
      await shortWait.register(adminJobsRoutes, { db, registry, selfTestWaitMs: [10, 10, 10], prefix: "/admin/jobs" });
      await shortWait.ready();
    });

    afterAll(async () => {
      await shortWait.close();
    });

    afterEach(() => {
      installJobWorker(null);
    });

    /** What the response said, against the contract (the shape itself is asserted on `json()`). */
    function selfTestResult(response: { json: () => unknown }): SelfTestResult {
      return z.object({ data: SelfTestResultSchema }).parse(response.json()).data;
    }

    function pressOn(target: FastifyInstance) {
      return target.inject({ method: "POST", url: "/admin/jobs/selftest", headers: { authorization: `Bearer ${platformAdmin}` } });
    }

    it("with a worker running here it waits for the job and answers that it is done", async () => {
      const worker = new JobWorker({ db, registry, serverId: "admin-jobs-test-run", logger: quietLogger, alerts: recordingJobAlerts() });
      installJobWorker(worker);
      worker.start();
      try {
        const response = await asPlatformAdmin("POST", "/admin/jobs/selftest");
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ data: { id: expect.any(String) as string, state: "done" } });
        const result = selfTestResult(response);
        expect(result.id).toMatch(UUID_SHAPE);
        const rows = (await pool.query<{ id: string; kind: string; state: string }>("SELECT id, kind, state FROM jobs")).rows;
        expect(rows).toEqual([{ id: result.id, kind: "jobs.selftest", state: "done" }]);
      } finally {
        await worker.stop(1000);
      }
    }, 20_000);

    it("with no worker installed it writes the job, answers queued at once, and does not wait", async () => {
      installJobWorker(null);
      const started = Date.now();
      const response = await asPlatformAdmin("POST", "/admin/jobs/selftest");
      const took = Date.now() - started;
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { id: expect.any(String) as string, state: "queued" } });
      const result = selfTestResult(response);
      expect(result.id).toMatch(UUID_SHAPE);
      // The default waits add up to 5 seconds and the first gap alone is 100 ms: this did not wait for any of them.
      expect(took).toBeLessThan(1000);
      const rows = (await pool.query<{ id: string; kind: string; state: string }>("SELECT id, kind, state FROM jobs")).rows;
      expect(rows).toEqual([{ id: result.id, kind: "jobs.selftest", state: "queued" }]);
    });

    it("a worker that never takes the job: all the reads are made, the answer is queued, and the request returns", async () => {
      // Installed but never started, so nothing takes the job.
      installJobWorker(new JobWorker({ db, registry, serverId: "admin-jobs-test-idle", logger: quietLogger, alerts: recordingJobAlerts() }));
      const started = Date.now();
      const response = await pressOn(shortWait);
      const took = Date.now() - started;
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { id: expect.any(String) as string, state: "queued" } });
      const result = selfTestResult(response);
      // Three gaps of 10 ms were waited out, and nothing like the default 5 seconds.
      expect(took).toBeGreaterThanOrEqual(25);
      expect(took).toBeLessThan(2000);
      expect((await rowOf(result.id)).state).toBe("queued");
    });

    it("writes one job and pokes the worker, after the job is committed", async () => {
      const worker = new JobWorker({ db, registry, serverId: "admin-jobs-test", logger: quietLogger, alerts: recordingJobAlerts() });
      const poke = vi.spyOn(worker, "poke");
      installJobWorker(worker);

      const response = await pressOn(shortWait);
      expect(response.statusCode).toBe(200);
      const data = selfTestResult(response);
      expect(data.id).toMatch(UUID_SHAPE);
      expect(poke).toHaveBeenCalledTimes(1);
      const rows = (await pool.query<{ id: string; kind: string; state: string; scope: string; payload: { nonce: string } }>(
        "SELECT id, kind, state, scope, payload FROM jobs",
      )).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: data.id, kind: "jobs.selftest", state: "queued", scope: "platform" });
      expect(typeof rows[0]?.payload.nonce).toBe("string");

      // A second press is a second job (each has its own key), not the same one.
      const again = selfTestResult(await pressOn(shortWait));
      expect(again.id).not.toBe(data.id);
      expect(poke).toHaveBeenCalledTimes(2);

      // With a worker installed, Stuck work reports its status in place of "off".
      const stuck = stuckBody(await asPlatformAdmin("GET", "/admin/jobs/stuck"));
      expect(stuck.data.worker).toMatchObject({ started: false, fault: null, currentJob: null, passRunning: false });
      expect(StuckWorkSchema.parse(stuck.data)).toEqual(stuck.data);
    });
  });

  // ---- The whole server -------------------------------------------------------

  describe("the whole server", () => {
    let whole: FastifyInstance | null = null;

    beforeAll(async () => {
      if (jobsTestUrl === undefined) throw new Error("VENVIEWER_JOBS_TEST_DATABASE_URL is required");
      process.env["JWT_SECRET"] = JWT_SECRET;
      const { buildServer } = await import("../index.js");
      const built = await buildServer(validateEnv({
        NODE_ENV: "test",
        DATABASE_URL: wholeServerUrl(jobsTestUrl),
        JWT_SECRET,
      }));
      whole = built;
      await built.ready();
    }, 600_000);

    afterAll(async () => {
      await whole?.close();
    }, 60_000);

    it("registers the four routes under /admin/jobs, for platform administrators only", async () => {
      if (whole === null) throw new Error("No server");
      const target: FastifyInstance = whole;
      const deadId = await seed({ state: "dead", attempts: 6 });
      const routes: readonly { readonly method: Method; readonly url: string }[] = [
        { method: "GET", url: "/admin/jobs/stuck" },
        { method: "POST", url: `/admin/jobs/${deadId}/retry` },
        { method: "POST", url: `/admin/jobs/${deadId}/close` },
        { method: "POST", url: "/admin/jobs/selftest" },
      ];
      for (const route of routes) {
        expect((await target.inject(route)).statusCode, route.url).toBe(401);
        for (const role of USER_ROLES) {
          expect((await target.inject({ ...route, headers: { authorization: `Bearer ${withRole(role)}` } })).statusCode, `${route.url} as ${role}`).toBe(403);
        }
      }
      const listed = await target.inject({ method: "GET", url: "/admin/jobs/stuck", headers: { authorization: `Bearer ${platformAdmin}` } });
      expect(listed.statusCode).toBe(200);
      const body = stuckBody(listed).data;
      expect(body.jobs.map((job) => job.id)).toEqual([deadId]);
      expect(body.worker).toEqual({ worker: "off" });
    });
  });
});
