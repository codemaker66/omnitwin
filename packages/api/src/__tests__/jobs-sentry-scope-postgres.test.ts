import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import type * as SentryNode from "@sentry/node";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import { initSentry } from "../observability/sentry.js";
import { buildOwnScope, sentryJobAlerts } from "../services/jobs/alerts.js";
import { buildJobRegistry, defineJobKind, PermanentJobError, RetryJobIn, type JobLogger } from "../services/jobs/kinds.js";
import { selfTestJob } from "../services/jobs/kinds/selftest.js";
import { startJobs } from "../services/jobs/runtime.js";
import { enqueueJob } from "../services/jobs/store.js";
import { JobWorker } from "../services/jobs/worker.js";
import { jobsTestUrl, openJobsDatabase } from "./helpers/jobs-db.js";

// ---------------------------------------------------------------------------
// T-702, after the final wave: what Sentry files a job's alert under. The
// worker runs every pass in the async context it was built in (start-up), so
// no request lends it a scope. That alone would put every pass and every job
// on one Sentry isolation scope and one trace: a breadcrumb one job's handler
// leaves would ride on the next job's alert, and every alert would share
// start-up's trace (the same fault was measured on the escalation scheduler's
// change, T-764). Each job run, and each pass's own work, must have a scope
// and a trace of its own.
//
// The real SDK is started as the API starts it (initSentry, every request
// traced) against a stand-in for Sentry's ingest on the loopback, as
// sentry-capture-path.test.ts does; what the SDK sent is read from it. The
// worker is the real one on the throwaway database, its alerts the Sentry
// reporter. Two passes run: in each, an orphaned claim is put back (a
// `claimLost` alert, the pass's own work) and jobs run whose handlers leave a
// breadcrumb, some then dying (a `jobDead` alert, the job's own). A breadcrumb
// left at start-up, before the worker is built, must reach none of them. The
// worker gets its scope from `buildOwnScope`, as runtime.ts gives it. The last
// case starts the server's own worker through `startJobs` with the worker on
// and the DSN set, so the wiring itself is under test.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).
// ---------------------------------------------------------------------------

interface Breadcrumb {
  readonly message?: string;
}

interface SentEvent {
  readonly tags?: Record<string, string>;
  readonly contexts?: { readonly trace?: { readonly trace_id?: string } };
  readonly breadcrumbs?: readonly Breadcrumb[] | { readonly values?: readonly Breadcrumb[] };
}

interface FakeTimer {
  readonly fire: () => void;
  fired: boolean;
  cleared: boolean;
}

const CRUMB = "crumb:";

const quietLogger: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The error and message events in the envelopes received (newline-delimited JSON: header, then item header and payload). */
function eventsIn(envelopes: readonly string[]): SentEvent[] {
  const found: SentEvent[] = [];
  for (const envelope of envelopes) {
    const lines = envelope.split("\n").filter((line) => line.trim() !== "");
    for (let index = 1; index + 1 < lines.length; index += 2) {
      const header = JSON.parse(lines[index] ?? "{}") as { type?: unknown };
      if (header.type === "event") found.push(JSON.parse(lines[index + 1] ?? "{}") as SentEvent);
    }
  }
  return found;
}

/** An event's breadcrumbs come as a list, or (in older payloads) under `values`. */
function isList(raw: NonNullable<SentEvent["breadcrumbs"]>): raw is readonly Breadcrumb[] {
  return Array.isArray(raw);
}

/** The breadcrumbs this suite's handlers left, as their names, on an event. */
function crumbsOf(event: SentEvent): string[] {
  const raw = event.breadcrumbs;
  const list: readonly Breadcrumb[] = raw === undefined ? [] : isList(raw) ? raw : raw.values ?? [];
  return list
    .map((crumb) => crumb.message ?? "")
    .filter((message) => message.startsWith(CRUMB))
    .map((message) => message.slice(CRUMB.length));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

describe.skipIf(jobsTestUrl === undefined)("jobs: each job run has its own Sentry scope and trace (the real SDK)", () => {
  let pool: Pool;
  let db: Database;
  let Sentry: typeof SentryNode;
  let ingest: Server | undefined;
  let worker: JobWorker | undefined;
  const envelopes: string[] = [];
  const timers: FakeTimer[] = [];
  /** The stand-in ingest's DSN, set once it listens. */
  let dsn = "";
  /** Each job's and orphan's id, by its name in this suite. */
  const ids = new Map<string, string>();

  const payload = z.object({ name: z.string() }).strict();
  /** Leaves a breadcrumb naming itself, and finishes. */
  const crumb = defineJobKind({
    kind: "test.crumb",
    version: 1,
    scope: "platform",
    timeoutMs: 5000,
    payload,
    handler: (ctx): Promise<void> => {
      Sentry.addBreadcrumb({ category: "job-test", message: `${CRUMB}${ctx.payload.name}` });
      return Promise.resolve();
    },
  });
  /** Leaves a breadcrumb naming itself, then dies: its `jobDead` alert is the job's own event. */
  const crumbDies = defineJobKind({
    kind: "test.crumb-dies",
    version: 1,
    scope: "platform",
    timeoutMs: 5000,
    payload,
    handler: (ctx): Promise<void> => {
      Sentry.addBreadcrumb({ category: "job-test", message: `${CRUMB}${ctx.payload.name}` });
      return Promise.reject(new PermanentJobError(`${ctx.payload.name} cannot work`));
    },
  });
  /** Each run, in order, as name and try (`P1`, `Q1`, ...): the proof that two jobs' runs interleaved. */
  const runs: string[] = [];
  /**
   * Leaves a breadcrumb, takes 1.5 s, and asks to be tried again in a second. Its second try is its last, so the
   * job dies then. Two of them in one pass run P, Q, P again (P's alert), Q again (Q's alert): each alert is
   * captured after both jobs have left breadcrumbs, so the test reads both ways.
   */
  const crumbTwice = defineJobKind({
    kind: "test.crumb-twice",
    version: 1,
    scope: "platform",
    timeoutMs: 5000,
    maxAttempts: 2,
    payload,
    handler: async (ctx): Promise<void> => {
      runs.push(`${ctx.payload.name}${String(ctx.attempt)}`);
      Sentry.addBreadcrumb({ category: "job-test", message: `${CRUMB}${ctx.payload.name}` });
      await sleep(1500);
      throw new RetryJobIn(1, `${ctx.payload.name} again`);
    },
  });

  function setTimer(callback: () => void): unknown {
    const timer: FakeTimer = {
      fired: false,
      cleared: false,
      fire: () => {
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

  async function idle(target: JobWorker): Promise<void> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (!target.status().passRunning) return;
      await sleep(5);
    }
    throw new Error("The worker never went idle");
  }

  /** A job of `kind`, due `ageSeconds` ago, so the jobs of one pass run in the order they are written. */
  async function write(kind: typeof crumb, name: string, ageSeconds: number): Promise<void> {
    const { id } = await enqueueJob(db, kind, { key: name, runAt: new Date(Date.now() - ageSeconds * 1000), payload: { name } });
    ids.set(name, id);
  }

  /** A claim another server took and never answered for, of a kind this worker does not run: recovery puts it back. */
  async function orphan(name: string): Promise<void> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO jobs (id, kind, version, key, scope, payload, max_attempts, state, attempts, claim_token, claimed_by, claim_expires_at)
       VALUES ($1, 'test.elsewhere', 1, $2, 'platform', '{}'::jsonb, 6, 'running', 1, gen_random_uuid(), 'gone', now() - interval '1 second')`,
      [id, name],
    );
    ids.set(name, id);
  }

  beforeAll(async () => {
    ingest = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        envelopes.push((request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const listening = ingest;
    await new Promise<void>((resolve) => { listening.listen(0, "127.0.0.1", resolve); });
    const { port } = listening.address() as AddressInfo;
    // The SDK's transport honours http_proxy; the stand-in ingest is local.
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    dsn = `http://public@127.0.0.1:${String(port)}/1`;
    await initSentry({ SENTRY_DSN: dsn, NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: 1 });
    Sentry = await import("@sentry/node");

    ({ pool, db } = await openJobsDatabase(`jobs_sentry_scope_${randomUUID()}`));
    await pool.query("TRUNCATE TABLE jobs");

    // Something start-up left on its own scope: no pass or job run may inherit it.
    Sentry.addBreadcrumb({ category: "job-test", message: `${CRUMB}start-up` });

    // Built at start-up, outside any request, as runtime.ts builds it, with the scope it builds from the DSN.
    const withOwnScope = await buildOwnScope({ SENTRY_DSN: dsn });
    worker = new JobWorker({
      db,
      registry: buildJobRegistry([crumb, crumbDies, crumbTwice]),
      serverId: "sentry-scope-test",
      logger: quietLogger,
      alerts: sentryJobAlerts(Sentry, quietLogger),
      lostClaimPauseSeconds: 0,
      setTimer,
      clearTimer,
      ...(withOwnScope === undefined ? {} : { withOwnScope }),
    });

    // Pass 1: an orphan put back, then A (finishes), B and D (die), in that order.
    await orphan("orphan-1");
    await write(crumb, "A", 180);
    await write(crumbDies, "B", 120);
    await write(crumbDies, "D", 60);
    worker.start();
    await idle(worker);

    // Pass 2, woken by its timer: another orphan put back, then C (dies).
    await orphan("orphan-2");
    await write(crumbDies, "C", 60);
    timers.at(-1)?.fire();
    await idle(worker);

    // Pass 3, woken by its timer: P and Q, whose runs interleave (P, Q, P's last, Q's last).
    await write(crumbTwice, "P", 120);
    await write(crumbTwice, "Q", 60);
    timers.at(-1)?.fire();
    await idle(worker);

    expect(await Sentry.flush(5_000)).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await worker?.stop(1000);
    vi.unstubAllEnvs();
    await pool.query("TRUNCATE TABLE jobs");
    await pool.end();
    const closing = ingest;
    if (closing !== undefined) await new Promise<void>((resolve) => { closing.close(() => { resolve(); }); });
  });

  /** The one event sent for the job or orphan named `name`. */
  function eventFor(name: string): SentEvent {
    const id = ids.get(name);
    const sent = eventsIn(envelopes).filter((event) => event.tags?.["job.id"] === id);
    if (sent.length !== 1) throw new Error(`${String(sent.length)} events for ${name}, not 1`);
    const [event] = sent;
    if (event === undefined) throw new Error(`no event for ${name}`);
    return event;
  }

  const traceOf = (name: string): string | undefined => eventFor(name).contexts?.trace?.trace_id;

  it("the control: a breadcrumb a handler leaves is on its own job's alert", () => {
    expect(crumbsOf(eventFor("B"))).toContain("B");
    expect(crumbsOf(eventFor("D"))).toContain("D");
    expect(crumbsOf(eventFor("C"))).toContain("C");
  });

  it("no breadcrumb crosses from one job to another, in one pass or the next", () => {
    expect({
      B: crumbsOf(eventFor("B")),
      D: crumbsOf(eventFor("D")),
      C: crumbsOf(eventFor("C")),
    }).toEqual({ B: ["B"], D: ["D"], C: ["C"] });
  });

  it("reads both ways: of two jobs whose runs interleave in one pass, neither's breadcrumb is on the other's alert", () => {
    // The check on the test itself: P's alert (its second try) came after Q had left a breadcrumb, and Q's after P had.
    expect(runs).toEqual(["P1", "Q1", "P2", "Q2"]);
    expect({ P: crumbsOf(eventFor("P")), Q: crumbsOf(eventFor("Q")) }).toEqual({ P: ["P"], Q: ["Q"] });
  });

  it("each job run has its own trace, in one pass and across passes", () => {
    const traces = { B: traceOf("B"), D: traceOf("D"), C: traceOf("C") };
    for (const trace of Object.values(traces)) expect(trace).toMatch(/^[0-9a-f]{32}$/u);
    expect(new Set(Object.values(traces)).size, JSON.stringify(traces)).toBe(3);
  });

  it("each pass's own work has a scope and trace of its own, apart from its jobs", () => {
    expect({ "orphan-1": crumbsOf(eventFor("orphan-1")), "orphan-2": crumbsOf(eventFor("orphan-2")) })
      .toEqual({ "orphan-1": [], "orphan-2": [] });
    const traces = {
      "orphan-1": traceOf("orphan-1"), "orphan-2": traceOf("orphan-2"), B: traceOf("B"), D: traceOf("D"), C: traceOf("C"),
    };
    expect(new Set(Object.values(traces)).size, JSON.stringify(traces)).toBe(5);
  });

  it("startJobs, as the server calls it with the worker on and a DSN set, gives each job run its own scope and trace", async () => {
    // The worker above is done with; this one is the server's own, built by startJobs from the env.
    await worker?.stop(1000);
    await pool.query("TRUNCATE TABLE jobs");
    // Two self-tests on their last try whose stored payload no longer parses: each dies in its own run.
    for (const [name, ageSeconds] of [["X", 120], ["Y", 60]] as const) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO jobs (id, kind, version, key, scope, payload, max_attempts, attempts, run_at)
         VALUES ($1, $2, 1, $3, 'platform', '{}'::jsonb, 6, 5, now() - make_interval(secs => $4))`,
        [id, selfTestJob.kind, `wiring-${name}`, ageSeconds],
      );
      ids.set(name, id);
    }
    const nameOf = new Map([...ids].map(([name, id]) => [id, name]));
    // The server's logger as a trail: each line a job's run logs leaves a breadcrumb on the scope it runs in.
    const trail = (obj: Record<string, unknown>): void => {
      const jobId = obj["jobId"];
      const name = typeof jobId === "string" ? nameOf.get(jobId) : undefined;
      if (name !== undefined) Sentry.addBreadcrumb({ category: "job-test", message: `${CRUMB}${name}` });
    };
    const jobs = await startJobs({
      db,
      env: validateEnv({
        NODE_ENV: "test",
        DATABASE_URL: jobsTestUrl ?? "",
        JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
        JOBS_WORKER: "on",
        SENTRY_DSN: dsn,
      }),
      logger: { info: () => undefined, warn: trail, error: trail },
    });
    try {
      expect(jobs.worker).not.toBeNull();
      const deadline = Date.now() + 30_000;
      const deadCount = async (): Promise<number> => (await pool.query<{ dead: number }>(
        "SELECT count(*)::integer AS dead FROM jobs WHERE key LIKE 'wiring-%' AND state = 'dead'",
      )).rows[0]?.dead ?? 0;
      while (await deadCount() < 2) {
        if (Date.now() > deadline) throw new Error("The two jobs never died");
        await sleep(25);
      }
      expect(await Sentry.flush(5_000)).toBe(true);
    } finally {
      await jobs.stop(1000);
    }
    // Neither alert carries start-up's breadcrumb or the other job's, and each is on a trace of its own.
    expect({ X: crumbsOf(eventFor("X")), Y: crumbsOf(eventFor("Y")) }).toEqual({ X: ["X"], Y: ["Y"] });
    const traces = { X: traceOf("X"), Y: traceOf("Y") };
    for (const trace of Object.values(traces)) expect(trace).toMatch(/^[0-9a-f]{32}$/u);
    expect(traces.X).not.toBe(traces.Y);
  }, 60_000);
});
