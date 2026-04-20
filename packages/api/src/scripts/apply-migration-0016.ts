import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0016_review_sessions
//
// Creates the review_sessions presence table used by the "Catherine is
// viewing this review" UI. Idempotent via IF NOT EXISTS.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0016.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "review_sessions" (
    "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "last_seen_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("configuration_id", "user_id")
  )
`);

await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "review_sessions_config_last_seen_idx"
    ON "review_sessions" ("configuration_id", "last_seen_at" DESC)
`);

// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0016_review_sessions applied successfully");
process.exit(0);
