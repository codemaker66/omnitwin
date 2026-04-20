import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0012_configuration_reviews
//
// Adds the review workflow to `configurations` (eight-status lifecycle) +
// the `configuration_review_history` audit table. Idempotent: all column
// adds use IF NOT EXISTS, the constraint is guarded by a pg_constraint
// lookup, and the table use CREATE TABLE IF NOT EXISTS — re-running on
// an already-migrated DB is a no-op.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0012.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const migration = `
ALTER TABLE "configurations"
  ADD COLUMN IF NOT EXISTS "review_status" varchar(30) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "review_note" text;

CREATE INDEX IF NOT EXISTS "configurations_venue_review_status_idx"
  ON "configurations" ("venue_id", "review_status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configurations_approval_cols_coherent'
  ) THEN
    ALTER TABLE "configurations"
      ADD CONSTRAINT "configurations_approval_cols_coherent"
      CHECK (
        ("approved_at" IS NULL AND "approved_by" IS NULL)
        OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "configuration_review_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "from_status" varchar(30) NOT NULL,
  "to_status" varchar(30) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id"),
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "config_review_history_config_idx"
  ON "configuration_review_history" ("configuration_id");
`;

await db.execute(sql.raw(migration));
// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0012_configuration_reviews applied successfully");
process.exit(0);
