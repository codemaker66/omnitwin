import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { migrate as neonMigrate } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";
import { Pool as PgPool } from "pg";
import { z } from "zod";
import { isLocalDatabaseUrl } from "../db/client.js";

// ---------------------------------------------------------------------------
// Migrate before the deployment goes live.
//
// Railway rebuilds the API the moment master moves and promotes the new
// container as soon as it is healthy, while the GitHub Deploy workflow
// applies migrations only after master's CI has passed. On 9 October 2026
// that left the API running eleven minutes ahead of migration 0087, selecting
// columns that did not exist yet. This script is Railway's pre-deploy
// command (railway.json): it runs inside the built image, with the service's
// own DATABASE_URL, before traffic switches. It runs the same read-only tail
// gate the workflow runs, then applies what is pending through drizzle-orm's
// migrator, which keeps the same `drizzle.__drizzle_migrations` ledger (tag
// hash and `when`) drizzle-kit writes. The workflow still runs afterwards as
// the audited second pass and finds nothing pending.
//
// A failed gate or migration fails the deployment, and Railway keeps the
// previous container serving. Nothing here prints the connection string.
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL(".", import.meta.url));
const API_ROOT = resolve(HERE, "../../");
export const MIGRATIONS_FOLDER = resolve(API_ROOT, "drizzle");

const JournalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().min(1) })),
}).passthrough();

export interface MigrationOutcome {
  /** Rows in the migrations ledger before and after this run. */
  readonly appliedBefore: number;
  readonly appliedAfter: number;
  /** Entries in the local journal: the count the ledger must reach. */
  readonly local: number;
}

interface Queryable {
  query(text: string): Promise<{ rows: unknown[] }>;
}

class MigrationError extends Error {}

async function appliedCount(pool: Queryable): Promise<number> {
  try {
    const result = await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations");
    const row = result.rows[0] as { readonly count?: unknown } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  } catch {
    // A database that has never been migrated has no ledger yet.
    return 0;
  }
}

/** Apply every journal entry the database has not recorded, with the driver
 *  the API itself would use for this URL. Idempotent: a second run applies
 *  nothing and reports the same counts. */
export async function migratePending(databaseUrl: string): Promise<MigrationOutcome> {
  const journalText = await readFile(resolve(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8");
  const journal = JournalSchema.parse(JSON.parse(journalText));
  const local = journal.entries.length;

  if (isLocalDatabaseUrl(databaseUrl)) {
    const pool = new PgPool({ connectionString: databaseUrl });
    try {
      const appliedBefore = await appliedCount(pool);
      await pgMigrate(pgDrizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
      return { appliedBefore, appliedAfter: await appliedCount(pool), local };
    } finally {
      await pool.end();
    }
  }

  const pool = new NeonPool({ connectionString: databaseUrl });
  try {
    const appliedBefore = await appliedCount(pool);
    await neonMigrate(neonDrizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    return { appliedBefore, appliedAfter: await appliedCount(pool), local };
  } finally {
    await pool.end();
  }
}

/** The workflow's read-only gate, run as the same compiled script with the
 *  same Node flags, so the deployment is refused on exactly what CI refuses. */
function runTailGate(): void {
  const gate = resolve(HERE, "verify-migration-tail-readiness.js");
  const result = spawnSync(process.execPath, [...process.execArgv, gate, "--deploy-gate"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new MigrationError(`The migration tail gate refused this deployment (exit ${String(result.status ?? "signal")}).`);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new MigrationError("DATABASE_URL is required to migrate before the deployment goes live.");
  }
  runTailGate();
  const outcome = await migratePending(databaseUrl);
  if (outcome.appliedAfter !== outcome.local) {
    throw new MigrationError(`The ledger holds ${String(outcome.appliedAfter)} migrations; the journal has ${String(outcome.local)}.`);
  }
  // eslint-disable-next-line no-console -- the deployment log is the operator's record
  console.log(JSON.stringify({ status: "migrated", ...outcome }));
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    const reason = error instanceof MigrationError ? error.message : "Migration before deployment failed";
    // eslint-disable-next-line no-console -- deliberately redacted operator error
    console.error(JSON.stringify({ status: "failed", reason }));
    process.exitCode = 1;
  });
}
