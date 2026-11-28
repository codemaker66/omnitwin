import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../../db/schema.js";
import type { Database } from "../../db/client.js";

// ---------------------------------------------------------------------------
// The job list's suites' disposable PostgreSQL (T-702).
//
// Opt-in only, never DATABASE_URL or .env:
//   VENVIEWER_JOBS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_jobs_test
// The helper checks the host and the database name, not the port, so a
// machine that already uses 55476 can run its own server on another port.
// ---------------------------------------------------------------------------

export const jobsTestUrl = process.env["VENVIEWER_JOBS_TEST_DATABASE_URL"];

export function assertJobsTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_jobs_test" || url.search !== "" || url.hash !== "") {
    throw new Error("The job list's tests require the explicit loopback venviewer_jobs_test database");
  }
}

/**
 * A pool on the disposable database, migrated with the whole set as production
 * holds it. The timeouts make a test that would hang fail instead. Call it from
 * a `beforeAll` with a timeout of 180_000: migrating takes longer than ten seconds.
 */
export async function openJobsDatabase(name: string): Promise<{ readonly pool: Pool; readonly db: Database }> {
  if (jobsTestUrl === undefined) throw new Error("VENVIEWER_JOBS_TEST_DATABASE_URL is required");
  assertJobsTestTarget(jobsTestUrl);
  const pool = new Pool({
    connectionString: jobsTestUrl,
    application_name: name,
    max: 8,
    options: "-c statement_timeout=10000 -c lock_timeout=8000",
  });
  const [row] = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows;
  if (row?.name !== "venviewer_jobs_test") throw new Error("Connected to the wrong database");
  await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../../drizzle") });
  const db: Database = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * A second pool on the same disposable database (already migrated by
 * `openJobsDatabase`) with no server-side timeouts, as production's pool
 * connects (db/client.ts sets none): for the cases that must see what bounds
 * the worker's own statements when the pool does not. The caller ends it.
 */
export function openUnboundedDatabase(name: string): { readonly pool: Pool; readonly db: Database } {
  if (jobsTestUrl === undefined) throw new Error("VENVIEWER_JOBS_TEST_DATABASE_URL is required");
  assertJobsTestTarget(jobsTestUrl);
  const pool = new Pool({ connectionString: jobsTestUrl, application_name: name, max: 4 });
  const db: Database = drizzle(pool, { schema });
  return { pool, db };
}

/** Empties the job list between tests. */
export async function resetJobs(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE jobs");
}

/**
 * Makes the tests-only table a handler records its effect in, and empties it.
 * It has no unique rule, so work done twice shows as two rows. Made here, in
 * the throwaway database, and never by a migration.
 */
export async function ensureEffectsTable(pool: Pool): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS job_test_effects (key text NOT NULL, server text NOT NULL)");
  await pool.query("TRUNCATE TABLE job_test_effects");
}
