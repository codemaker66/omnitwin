import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { buildJobRegistry, defineJobKind, jobErrorText } from "../services/jobs/kinds.js";
import { enqueueJob, JobInputError } from "../services/jobs/store.js";
import { jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, declaring a kind of work and writing a job: the write happens in the
// caller's own transaction, a repeat of the same kind and key changes nothing,
// and data that does not match the kind is refused before any statement.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts).

const effectDefinition = {
  kind: "test.effect",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ n: z.number().int() }).strict(),
  handler: async (): Promise<void> => { /* nothing to do */ },
} as const;
const effect = defineJobKind(effectDefinition);
const wordsKind = defineJobKind({
  kind: "test.words",
  version: 1,
  scope: "platform",
  timeoutMs: 1000,
  payload: z.object({ text: z.string() }).strict(),
  handler: async (): Promise<void> => { /* nothing to do */ },
});
const venueKind = defineJobKind({
  kind: "test.venue",
  version: 1,
  scope: "venue",
  timeoutMs: 1000,
  payload: z.object({}).strict(),
  handler: async (): Promise<void> => { /* nothing to do */ },
});

describe.skipIf(jobsTestUrl === undefined)("jobs: declaring a kind and writing a job", () => {
  let pool: Pool;
  let db: Database;
  let venueId: string;

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_enqueue_${randomUUID()}`));
    venueId = randomUUID();
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'TEST ONLY jobs enqueue venue', $2, 'Test street')",
      [venueId, `jobs-enqueue-${venueId.slice(0, 8)}`],
    );
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function countJobs(): Promise<number> {
    const result = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM jobs");
    return Number(result.rows[0]?.n);
  }

  async function oneJob(kind: string, key: string): Promise<Readonly<Record<string, unknown>>> {
    const result = await pool.query<Record<string, unknown>>("SELECT * FROM jobs WHERE kind = $1 AND key = $2", [kind, key]);
    const [row] = result.rows;
    if (row === undefined) throw new Error("No such job");
    return row;
  }

  /** Due by the database's clock, never the test's. */
  async function isDueNow(kind: string, key: string): Promise<boolean> {
    const result = await pool.query<{ due: boolean }>("SELECT run_at <= now() AS due FROM jobs WHERE kind = $1 AND key = $2", [kind, key]);
    return result.rows[0]?.due === true;
  }

  it("a transaction that rolls back leaves no job", async () => {
    await expect(db.transaction(async (tx) => {
      await enqueueJob(tx, effect, { key: "a", payload: { n: 1 } });
      throw new Error("undo");
    })).rejects.toThrow("undo");
    expect(await countJobs()).toBe(0);
  });

  it("a transaction that commits leaves its job, queued and due now", async () => {
    const { created } = await db.transaction((tx) => enqueueJob(tx, effect, { key: "a", payload: { n: 1 } }));
    expect(created).toBe(true);
    expect(await oneJob("test.effect", "a")).toMatchObject({ state: "queued", attempts: 0, max_attempts: 6, version: 1, scope: "platform" });
    expect(await isDueNow("test.effect", "a")).toBe(true);
  });

  it("twenty writers of the same key make one row", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => enqueueJob(db, effect, { key: "same", payload: { n: 1 } })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await countJobs()).toBe(1);
  });

  it("a duplicate inside a transaction does not abort it", async () => {
    await enqueueJob(db, effect, { key: "dup", payload: { n: 1 } });
    await db.transaction(async (tx) => {
      expect((await enqueueJob(tx, effect, { key: "dup", payload: { n: 1 } })).created).toBe(false);
      const still = await tx.execute(sql`SELECT 1 AS one`);
      expect(still.rows).toHaveLength(1);
    });
    expect(await countJobs()).toBe(1);
  });

  it("refuses data that does not match the kind, before any statement", async () => {
    await expect(enqueueJob(db, effect, { key: "a", payload: { n: "one" } as never })).rejects.toThrow(JobInputError);
    await expect(enqueueJob(db, effect, { key: "a", payload: { n: 1, name: "Ada" } as never })).rejects.toThrow(JobInputError);
    const refusal = await enqueueJob(db, effect, { key: "a", payload: { n: 1, name: "Ada" } as never }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(JobInputError);
    // The issue paths are named; the values never are.
    expect((refusal as Error).message).not.toContain("Ada");
    // Over 2,048 bytes is refused here, not by the table's check inside the caller's transaction.
    await expect(enqueueJob(db, wordsKind, { key: "a", payload: { text: "w".repeat(2100) } })).rejects.toThrow(JobInputError);
    await expect(db.transaction(async (tx) => {
      await expect(enqueueJob(tx, wordsKind, { key: "a", payload: { text: "w".repeat(2100) } })).rejects.toThrow(JobInputError);
      return enqueueJob(tx, wordsKind, { key: "b", payload: { text: "fits" } });
    })).resolves.toMatchObject({ created: true });
    await resetJobs(pool);
    expect(await countJobs()).toBe(0);
  });

  it("refuses a venue's kind with no venue, a platform kind with one, and a key over 300 characters", async () => {
    await expect(enqueueJob(db, venueKind, { key: "a", payload: {} })).rejects.toThrow(JobInputError);
    await expect(enqueueJob(db, effect, { key: "a", venueId, payload: { n: 1 } })).rejects.toThrow(JobInputError);
    await expect(enqueueJob(db, effect, { key: "k".repeat(301), payload: { n: 1 } })).rejects.toThrow(JobInputError);
    await expect(enqueueJob(db, effect, { key: "", payload: { n: 1 } })).rejects.toThrow(JobInputError);
    expect(await countJobs()).toBe(0);
    // A venue's kind with its venue is written, and the row names the venue.
    const { created } = await enqueueJob(db, venueKind, { key: "a", venueId, payload: {} });
    expect(created).toBe(true);
    expect(await oneJob("test.venue", "a")).toMatchObject({ scope: "venue", venue_id: venueId });
  });

  it("refuses a kind with a time limit over 15 seconds, and two kinds of one name", () => {
    expect(() => defineJobKind({ ...effectDefinition, timeoutMs: 15_001 })).toThrow();
    expect(() => defineJobKind({ ...effectDefinition, timeoutMs: 0 })).toThrow();
    expect(() => buildJobRegistry([effect, effect])).toThrow();
  });

  it("an error's text loses its query parameters and any address, and is never over 500 characters", () => {
    expect(jobErrorText(new Error("Resend refused ada@example.org"))).toBe("Resend refused [email address]");
    expect(jobErrorText(new Error("Failed query: insert\nparams: ada@example.org,Ada"))).not.toContain("Ada");
    expect(jobErrorText(new Error("x".repeat(900))).length).toBeLessThanOrEqual(500);
    expect(jobErrorText(undefined)).toBe("unknown error");
  });
});
