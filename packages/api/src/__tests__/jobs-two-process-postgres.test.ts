import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import type { Database } from "../db/client.js";
import { buildJobRegistry, defineJobKind } from "../services/jobs/kinds.js";
import { enqueueJob } from "../services/jobs/store.js";
import { ensureEffectsTable, jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, two servers on one list. Each server is a real child process
// (fixtures/job-worker-child.ts) running a real JobWorker against the same
// throwaway database, so taking, killing and stopping are what production
// does: separate processes, separate pools, one table.
//
// The children are told what to do by message, never by signal (Windows does
// not deliver a signal to a handler), and are killed with SIGKILL. Every child
// a test starts is killed in afterEach if it is still alive: a leaked child
// holds a connection and a claim and would poison the next test. Each test's
// timeout is longer than the waits inside it, and a body that outlives its test
// anyway can start no server: afterEach closes the test's owner, and a server
// asked for after that is killed at once.
//
// A child that must notice a job written after it started is poked; one that
// starts after the job was written plans when it starts. `expireClaimOfKey`
// moves a claim's expiry into the past by SQL: it stands in for waiting out
// the claim.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts), and the child checks it too.

type JobRow = {
  readonly id: string;
  readonly state: string;
  readonly attempts: number;
  readonly lost_claims: number;
};

type EffectRow = {
  readonly key: string;
  readonly server: string;
};

interface ChildRecord {
  readonly name: string;
  readonly messages: unknown[];
  readonly output: string[];
}

/** One test's right to start servers. afterEach closes it; a server asked for after that is killed at once. */
interface TestOwner {
  closed: boolean;
}

type StartChild = (name: string, options?: { readonly stopGraceMs?: number }) => Promise<ChildProcess>;

const fixturePath = resolve(import.meta.dirname, "fixtures/job-worker-child.ts");

/** The grace a child is given when told to stop, unless a test says otherwise. */
const DEFAULT_STOP_GRACE_MS = 5_000;
/** A new child loads TypeScript through tsx and opens a connection: seconds each on a loaded machine. */
const CHILD_READY_MS = 60_000;
const MESSAGE_MS = 30_000;
const EXIT_MS = 30_000;
/** One statement on the parent's pool: its statement_timeout (helpers/jobs-db.ts). */
const QUERY_MS = 10_000;
/** Room for a test's own work between its waits. */
const SLACK_MS = 30_000;

/**
 * A test's timeout: the sum of the longest each of its waits can take, and some
 * room. It is always longer than the waits inside the test, so the inner,
 * informative error (with the child's output) fails the test, not Vitest's
 * timeout, and the body has ended before afterEach runs.
 */
function budget(...waits: readonly number[]): number {
  return waits.reduce((sum, wait) => sum + wait, SLACK_MS);
}

/** `waitUntil(check, ms)` at its longest: its deadline, and the check that began just before it. */
function polled(ms: number): number {
  return ms + QUERY_MS;
}

const alertMessage = z.object({ alert: z.tuple([z.string(), z.record(z.string(), z.unknown())]) }).strict();

// The kinds as the parent writes them. Each matches the child's (name, version,
// scope, payload, attempts); its handler is never run here.
function notHere(): Promise<void> {
  return Promise.reject(new Error("This kind runs in the child process."));
}
const effect = defineJobKind({
  kind: "test.effect", version: 1, scope: "platform", timeoutMs: 15_000,
  payload: z.object({ n: z.number().int() }).strict(), handler: notHere,
});
const waits = defineJobKind({
  kind: "test.waits", version: 1, scope: "platform", timeoutMs: 15_000,
  payload: z.object({}).strict(), handler: notHere,
});
const dies = defineJobKind({
  kind: "test.dies", version: 1, scope: "platform", timeoutMs: 15_000,
  payload: z.object({}).strict(), handler: notHere,
});
const slow = defineJobKind({
  kind: "test.slow", version: 1, scope: "platform", timeoutMs: 12_000,
  payload: z.object({}).strict(), handler: notHere,
});
// Built only to check the definitions are distinct, as the child's registry is.
buildJobRegistry([effect, waits, dies, slow]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

describe.skipIf(jobsTestUrl === undefined)("jobs: two servers on one list", () => {
  let pool: Pool;
  let db: Database;
  /** What each child has said; never cleared, so a late reader still finds it. */
  const records = new WeakMap<ChildProcess, ChildRecord>();
  /** The children the current test has started; afterEach kills any still alive. */
  let children: ChildProcess[] = [];
  /** Every child this suite has forked, in order. */
  const forked: ChildProcess[] = [];
  /** The running test's owner; replaced in beforeEach, closed in afterEach. */
  let owner: TestOwner = { closed: true };

  function recordOf(child: ChildProcess): ChildRecord {
    const record = records.get(child);
    if (record === undefined) throw new Error("Not a child this suite started");
    return record;
  }

  function describeChild(record: ChildRecord): string {
    return `child "${record.name}": ${JSON.stringify(record.messages)}\n${record.output.join("")}`;
  }

  /** Until `child` has sent a message equal to `expected` (one sent before the call counts). */
  async function messageFrom(child: ChildProcess, expected: Record<string, unknown>, ms: number = MESSAGE_MS): Promise<void> {
    const record = recordOf(child);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (record.messages.some((message) => isDeepStrictEqual(message, expected))) return;
      if (!isAlive(child)) {
        throw new Error(`The child ended before sending ${JSON.stringify(expected)}; ${describeChild(record)}`);
      }
      await sleep(20);
    }
    throw new Error(`No ${JSON.stringify(expected)} within ${String(ms)} ms; ${describeChild(record)}`);
  }

  /** Kills `child` if it is alive and waits for it to end. */
  async function killAndWait(child: ChildProcess): Promise<void> {
    if (!isAlive(child)) return;
    const ended = new Promise<void>((resolve) => { child.once("exit", () => { resolve(); }); });
    child.kill("SIGKILL");
    await ended;
  }

  /**
   * Starts a server for `startedBy` and waits until its pool has a live
   * connection and its worker has started. If that test has already ended (its
   * body outlived a timeout), the child is killed at once and this throws: a
   * server is never left alive into another test. The fork and the check run in
   * the same tick, so a child forked before afterEach is in `children` for it to
   * kill, and one forked after is killed here.
   */
  async function startChildFor(
    startedBy: TestOwner,
    name: string,
    options: { readonly stopGraceMs?: number } = {},
  ): Promise<ChildProcess> {
    const child = fork(fixturePath, [name, String(options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS)], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env },
      // Kept, not printed: a child's output is shown only when its test fails.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    forked.push(child);
    const record: ChildRecord = { name, messages: [], output: [] };
    records.set(child, record);
    if (startedBy.closed) {
      await killAndWait(child);
      throw new Error(`Server "${name}" was asked for after its test ended; it was killed at once`);
    }
    children.push(child);
    child.on("message", (message: unknown) => { record.messages.push(message); });
    child.stdout?.on("data", (chunk: Buffer) => { record.output.push(chunk.toString("utf8")); });
    child.stderr?.on("data", (chunk: Buffer) => { record.output.push(chunk.toString("utf8")); });
    onTestFailed(() => { console.error(describeChild(record)); });
    await messageFrom(child, { ready: true }, CHILD_READY_MS);
    return child;
  }

  /**
   * A test that starts servers. Its body is handed a `startChild` bound to this
   * test, taken when the test begins, so a body that outlives its test cannot
   * start a server in the next one.
   */
  function serverTest(name: string, body: (startChild: StartChild) => Promise<void>, timeoutMs: number): void {
    it(name, async () => {
      const startedBy = owner;
      await body((childName, options) => startChildFor(startedBy, childName, options));
    }, timeoutMs);
  }

  /** The child's exit code once it has ended (null if a signal ended it). */
  function exited(child: ChildProcess): Promise<number | null> {
    if (!isAlive(child)) return Promise.resolve(child.exitCode);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`The child never ended; ${describeChild(recordOf(child))}`)); }, EXIT_MS);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  /** Tells the child to stop, by message, and checks it ended cleanly. */
  async function stopChild(child: ChildProcess): Promise<void> {
    child.send({ stop: true });
    expect(await exited(child)).toBe(0);
  }

  function alertsFrom(child: ChildProcess): readonly (readonly [string, Record<string, unknown>])[] {
    return recordOf(child).messages.flatMap((message) => {
      const parsed = alertMessage.safeParse(message);
      return parsed.success ? [parsed.data.alert] : [];
    });
  }

  /** Polls the list until `check` holds. */
  async function waitUntil(check: () => Promise<boolean>, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await check()) return;
      await sleep(100);
    }
    throw new Error(`It never happened within ${String(ms)} ms`);
  }

  // ---- Reading and steering the list -------------------------------------

  async function seedEffects(count: number): Promise<void> {
    await pool.query(
      `INSERT INTO jobs (kind, version, key, scope, payload, max_attempts)
       SELECT 'test.effect', 1, 'effect-' || n, 'platform', jsonb_build_object('n', n), 6
       FROM generate_series(1, $1::integer) AS n`,
      [count],
    );
  }

  async function countState(state: string): Promise<number> {
    const [row] = (await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM jobs WHERE state = $1", [state])).rows;
    return row?.count ?? 0;
  }

  async function rowOfKey(key: string): Promise<JobRow> {
    const [row] = (await pool.query<JobRow>("SELECT id, state, attempts, lost_claims FROM jobs WHERE key = $1", [key])).rows;
    if (row === undefined) throw new Error("No such job");
    return row;
  }

  async function stateOfKey(key: string): Promise<string> {
    return (await rowOfKey(key)).state;
  }

  async function effects(): Promise<readonly EffectRow[]> {
    return (await pool.query<EffectRow>("SELECT key, server FROM job_test_effects")).rows;
  }

  async function effectsFor(key: string): Promise<readonly EffectRow[]> {
    return (await pool.query<EffectRow>("SELECT key, server FROM job_test_effects WHERE key = $1", [key])).rows;
  }

  /** Stands in for waiting out the claim: its expiry is moved into the past, by the database's clock. */
  async function expireClaimOfKey(key: string): Promise<void> {
    const result = await pool.query(
      "UPDATE jobs SET claim_expires_at = now() - interval '1 second' WHERE key = $1 AND state = 'running'",
      [key],
    );
    if (result.rowCount !== 1) throw new Error(`The job "${key}" holds no claim to expire`);
  }

  // ---- Set-up --------------------------------------------------------------

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_two_process_${randomUUID()}`));
  }, 180_000);

  beforeEach(async () => {
    owner = { closed: false };
    await resetJobs(pool);
    await ensureEffectsTable(pool);
  });

  afterEach(async () => {
    // Closed first, in the same tick as the list is taken: a body that outlives
    // its test can start no server after this.
    owner.closed = true;
    const left = children;
    children = [];
    for (const child of left) await killAndWait(child);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  // ---- The brief's cases ---------------------------------------------------

  serverTest("two servers, one list: 200 jobs, every effect there once", async (startChild) => {
    const [a, b] = await Promise.all([startChild("a"), startChild("b")]);
    // Both are running before the jobs exist, then both are woken at once:
    // otherwise the child that connects first could drain the list alone.
    await seedEffects(200);
    a.send({ poke: true });
    b.send({ poke: true });
    await waitUntil(async () => (await countState("done")) === 200, 60_000);
    const rows = await effects();
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((row) => row.key)).size).toBe(200);
    expect(new Set(rows.map((row) => row.server))).toEqual(new Set(["a", "b"]));
    await Promise.all([stopChild(a), stopChild(b)]);
  }, budget(CHILD_READY_MS, QUERY_MS, polled(60_000), QUERY_MS, EXIT_MS));

  serverTest("a server killed mid-job: the job is put back when its claim runs out, and its effect is there once", async (startChild) => {
    await enqueueJob(db, waits, { key: "w", payload: {} });
    const a = await startChild("a");
    await messageFrom(a, { started: "w" });
    a.kill("SIGKILL"); await exited(a);
    await expireClaimOfKey("w");
    const b = await startChild("b");
    await messageFrom(b, { started: "w" }); b.send({ release: "w" });
    await waitUntil(async () => (await stateOfKey("w")) === "done", 20_000);
    expect(await effectsFor("w")).toEqual([{ key: "w", server: "b" }]);
    expect(await rowOfKey("w")).toMatchObject({ lost_claims: 1, attempts: 2 });
    expect(alertsFrom(b)).toEqual([["claimLost", { id: (await rowOfKey("w")).id, kind: "test.waits", venueId: null, lostClaims: 1 }]]);
    await stopChild(b);
  }, budget(
    QUERY_MS, CHILD_READY_MS, MESSAGE_MS, EXIT_MS, QUERY_MS,
    CHILD_READY_MS, MESSAGE_MS, polled(20_000), 3 * QUERY_MS, EXIT_MS,
  ));

  serverTest("a job that takes its server down does so twice and is then dead, never a third time", async (startChild) => {
    await enqueueJob(db, dies, { key: "d", payload: {} });
    for (const name of ["a", "b"]) {
      const child = await startChild(name);
      await messageFrom(child, { dying: "d" }); await exited(child);
      await expireClaimOfKey("d");
    }
    const c = await startChild("c");
    await waitUntil(async () => (await stateOfKey("d")) === "dead", 20_000);
    expect(await rowOfKey("d")).toMatchObject({ lost_claims: 2, attempts: 2 });
    expect(c.exitCode).toBeNull();                    // the third server is still alive
    expect(recordOf(c).messages).not.toContainEqual({ dying: "d" });
    expect(alertsFrom(c)).toEqual([["jobDead", {
      id: (await rowOfKey("d")).id, kind: "test.dies", venueId: null, reason: "The server that took this job never answered.",
    }]]);
    await stopChild(c);
  }, budget(
    QUERY_MS, 2 * (CHILD_READY_MS + MESSAGE_MS + EXIT_MS + QUERY_MS),
    CHILD_READY_MS, polled(20_000), 2 * QUERY_MS, EXIT_MS,
  ));

  serverTest("a deploy: a server told to stop mid-job hands it back without counting the try, and exits in time", async (startChild) => {
    await enqueueJob(db, slow, { key: "s", payload: {} });
    const a = await startChild("a", { stopGraceMs: 500 });
    await messageFrom(a, { started: "s" });
    const began = Date.now(); a.send({ stop: true });
    expect(await exited(a)).toBe(0);
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(await rowOfKey("s")).toMatchObject({ state: "queued", attempts: 0, lost_claims: 0 });
  }, budget(QUERY_MS, CHILD_READY_MS, MESSAGE_MS, EXIT_MS, QUERY_MS));

  serverTest("a job written while no server is running is run when one starts", async (startChild) => {
    const a = await startChild("a"); await stopChild(a);
    await enqueueJob(db, effect, { key: "after-restart", payload: { n: 1 } });
    const b = await startChild("b");
    await waitUntil(async () => (await stateOfKey("after-restart")) === "done", 20_000);
    expect(await effectsFor("after-restart")).toEqual([{ key: "after-restart", server: "b" }]);
    await stopChild(b);
  }, budget(CHILD_READY_MS, EXIT_MS, QUERY_MS, CHILD_READY_MS, polled(20_000), QUERY_MS, EXIT_MS));

  // ---- The suite's own guard -----------------------------------------------

  it("a server asked for after its test has ended is killed at once and takes no job", async () => {
    await enqueueJob(db, effect, { key: "late", payload: { n: 1 } });
    // The owner afterEach leaves behind: what a body that outlived its test still holds.
    const ended: TestOwner = { closed: true };
    const before = forked.length;
    await expect(startChildFor(ended, "late")).rejects.toThrow("was asked for after its test ended");
    const late = forked.slice(before);
    expect(late).toHaveLength(1);
    expect(late.filter(isAlive)).toEqual([]);
    expect(children).toEqual([]);
    expect(await stateOfKey("late")).toBe("queued");
    expect(await effectsFor("late")).toEqual([]);
  }, budget(QUERY_MS, EXIT_MS, 2 * QUERY_MS));
});
