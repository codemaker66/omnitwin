import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { JobAlerts } from "../../services/jobs/alerts.js";
import { buildJobRegistry, defineJobKind, type JobContext, type JobLogger } from "../../services/jobs/kinds.js";
import { JobWorker } from "../../services/jobs/worker.js";
import { assertJobsTestTarget, jobsTestUrl } from "../helpers/jobs-db.js";

// ---------------------------------------------------------------------------
// One server on the job list, as a child process, for
// jobs-two-process-postgres.test.ts (T-702).
//
// Started with fork(this file, [serverId, stopGraceMs], { execArgv: ["--import", "tsx"] }).
// Reads only VENVIEWER_JOBS_TEST_DATABASE_URL, checked to be the loopback
// venviewer_jobs_test database; never DATABASE_URL or .env. Does not migrate:
// the parent has.
//
// To the parent:   { ready: true }      the pool has a live connection and the worker has started
//                  { started: key }     test.waits or test.slow has begun
//                  { dying: key }       test.dies is about to kill this process
//                  { alert: [name, fields] }, { log: { level, msg, fields } }
// From the parent: { poke: true }       worker.poke()
//                  { release: key }     lets test.waits finish
//                  { stop: true }       worker.stop(stopGraceMs), close the pool, exit 0
// Messages, not signals, so the test means the same on Windows and Linux. If
// the parent goes away the channel closes and this process exits at once.
// ---------------------------------------------------------------------------

const parentMessage = z.union([
  z.object({ stop: z.literal(true) }).strict(),
  z.object({ poke: z.literal(true) }).strict(),
  z.object({ release: z.string().min(1) }).strict(),
]);

const keyRow = z.object({ key: z.string() });

const never = new Promise<never>(() => undefined);

/** How long closing the pool may take before the process exits anyway. */
const POOL_END_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Sends a message and resolves once it is written to the channel. */
function send(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) {
      reject(new Error("The job worker child must be started with fork"));
      return;
    }
    process.send(message, (error: Error | null) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

/** For logs and alerts: never throws, and a channel already closed is ignored. */
function tell(message: Record<string, unknown>): void {
  send(message).catch(() => undefined);
}

function parseArguments(): { readonly serverId: string; readonly stopGraceMs: number } {
  const [serverId, graceText] = process.argv.slice(2);
  if (serverId === undefined || !/^[a-z][a-z0-9-]*$/u.test(serverId)) {
    throw new Error("The first argument must be the server's name");
  }
  const stopGraceMs = Number(graceText);
  if (!Number.isInteger(stopGraceMs) || stopGraceMs < 0) {
    throw new Error("The second argument must be the stop grace in whole milliseconds");
  }
  return { serverId, stopGraceMs };
}

async function main(): Promise<void> {
  const { serverId, stopGraceMs } = parseArguments();
  if (jobsTestUrl === undefined) throw new Error("VENVIEWER_JOBS_TEST_DATABASE_URL is required");
  assertJobsTestTarget(jobsTestUrl);
  const pool = new Pool({
    connectionString: jobsTestUrl,
    application_name: `jobs_child_${serverId}`,
    max: 4,
    // Keep the connection: a new one can take seconds on a loaded machine.
    idleTimeoutMillis: 0,
    options: "-c statement_timeout=10000 -c lock_timeout=8000",
  });
  const [current] = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows;
  if (current?.name !== "venviewer_jobs_test") throw new Error("Connected to the wrong database");
  const db: Database = drizzle(pool, { schema });

  // ---- test.waits: released by the parent ------------------------------------
  const released = new Set<string>();
  const waiting = new Map<string, () => void>();

  function release(key: string): void {
    released.add(key);
    waiting.get(key)?.();
  }

  function waitForRelease(key: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (released.has(key)) { resolve(); return; }
      waiting.set(key, resolve);
      signal.addEventListener("abort", () => { reject(new Error("Told to stop.")); }, { once: true });
    });
  }

  /** Waits `ms`, or rejects as soon as the worker aborts the signal. Holds no timer after that. */
  function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Told to stop."));
      }, { once: true });
    });
  }

  // ---- The kinds ------------------------------------------------------------
  // A payload holds no key, so a handler reads its own job's key by id.
  async function keyOf(ctx: JobContext<unknown>): Promise<string> {
    const result = await ctx.db.execute(sql`SELECT key FROM jobs WHERE id = ${ctx.jobId}::uuid`);
    return keyRow.parse(result.rows[0]).key;
  }

  /** One row per run: the table has no unique rule, so a job run twice shows as two rows. */
  async function recordEffect(ctx: JobContext<unknown>): Promise<void> {
    const result = await ctx.db.execute(sql`
      INSERT INTO job_test_effects (key, server)
      SELECT key, ${serverId}::text FROM jobs WHERE id = ${ctx.jobId}::uuid
      RETURNING key`);
    if (result.rows.length !== 1) throw new Error("The effect was not recorded");
  }

  const effect = defineJobKind({
    kind: "test.effect", version: 1, scope: "platform", timeoutMs: 15_000,
    payload: z.object({ n: z.number().int() }).strict(),
    handler: async (ctx): Promise<void> => {
      // A beat of work, so two servers draining one list interleave.
      await sleep(25);
      await recordEffect(ctx);
    },
  });
  const waits = defineJobKind({
    kind: "test.waits", version: 1, scope: "platform", timeoutMs: 15_000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      const key = await keyOf(ctx);
      await send({ started: key });
      await waitForRelease(key, ctx.signal);
      await recordEffect(ctx);
    },
  });
  const dies = defineJobKind({
    kind: "test.dies", version: 1, scope: "platform", timeoutMs: 15_000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      const key = await keyOf(ctx);
      await send({ dying: key });
      process.kill(process.pid, "SIGKILL");
      await never;
    },
  });
  const slow = defineJobKind({
    kind: "test.slow", version: 1, scope: "platform", timeoutMs: 12_000,
    payload: z.object({}).strict(),
    handler: async (ctx): Promise<void> => {
      const key = await keyOf(ctx);
      await send({ started: key });
      await sleepUnlessAborted(10_000, ctx.signal);
    },
  });

  const logger: JobLogger = {
    info: (fields, msg) => { tell({ log: { level: "info", msg, fields } }); },
    warn: (fields, msg) => { tell({ log: { level: "warn", msg, fields } }); },
    error: (fields, msg) => { tell({ log: { level: "error", msg, fields } }); },
  };
  const alerts: JobAlerts = {
    jobDead: (job) => { tell({ alert: ["jobDead", { ...job }] }); },
    claimLost: (job) => { tell({ alert: ["claimLost", { ...job }] }); },
    workerFault: (what, detail) => { tell({ alert: ["workerFault", { what, detail }] }); },
    workerRecovered: (what) => { tell({ alert: ["workerRecovered", { what }] }); },
    listStuck: (detail) => { tell({ alert: ["listStuck", { detail }] }); },
    checkIn: (monitor) => { tell({ alert: ["checkIn", { monitor }] }); },
  };

  const worker = new JobWorker({
    db,
    registry: buildJobRegistry([effect, waits, dies, slow]),
    serverId,
    logger,
    alerts,
    lostClaimPauseSeconds: 0,
  });

  let stopping = false;
  async function stopAndExit(): Promise<void> {
    await worker.stop(stopGraceMs);
    const closed = await Promise.race([
      pool.end().then(() => true),
      sleep(POOL_END_MS).then(() => false),
    ]);
    process.exit(closed ? 0 : 2);
  }

  process.on("message", (raw: unknown) => {
    const message = parentMessage.parse(raw);
    if ("stop" in message) {
      if (stopping) return;
      stopping = true;
      stopAndExit().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
    } else if ("poke" in message) {
      worker.poke();
    } else {
      release(message.release);
    }
  });

  worker.start();
  await send({ ready: true });
}

// The parent has gone: nobody will stop this server, so it ends now.
process.on("disconnect", () => { process.exit(1); });

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
