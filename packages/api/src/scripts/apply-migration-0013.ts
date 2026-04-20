import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0013_configuration_sheet_snapshots
//
// Creates the immutable hallkeeper-sheet snapshot table. Depends on
// migration 0012 having run first (`users` and `configurations` are
// referenced). Idempotent: CREATE TABLE IF NOT EXISTS + all indexes
// are IF NOT EXISTS.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0013.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const migration = `
CREATE TABLE IF NOT EXISTS "configuration_sheet_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "diagram_url" text,
  "pdf_url" text,
  "source_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "created_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "config_sheet_snapshot_version_unique" UNIQUE ("configuration_id", "version"),
  CONSTRAINT "config_sheet_snapshot_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "config_sheet_snapshot_source_hash_hex" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "config_sheet_snapshot_approval_coherent" CHECK (
    ("approved_at" IS NULL AND "approved_by" IS NULL)
    OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_config_idx"
  ON "configuration_sheet_snapshots" ("configuration_id");

CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_source_hash_idx"
  ON "configuration_sheet_snapshots" ("configuration_id", "source_hash");
`;

await db.execute(sql.raw(migration));
// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0013_configuration_sheet_snapshots applied successfully");
process.exit(0);
