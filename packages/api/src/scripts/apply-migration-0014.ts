import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0014_snapshot_approved_partial_index
//
// Adds a partial index on `configuration_sheet_snapshots` covering
// approved rows only — see the SQL file header for rationale.
// Idempotent via IF NOT EXISTS.
//
// Production-rollout note: if the snapshots table is already large,
// switch to CONCURRENTLY for a non-blocking build (requires dropping
// this script's transaction wrapper since CONCURRENTLY cannot run
// inside a transaction block).
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0014.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_approved_idx"
    ON "configuration_sheet_snapshots" ("configuration_id", "version" DESC)
    WHERE "approved_at" IS NOT NULL
`);

// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0014_snapshot_approved_partial_index applied successfully");
process.exit(0);
