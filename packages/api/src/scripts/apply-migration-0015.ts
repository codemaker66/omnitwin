import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0015_venue_timezone
//
// Adds per-venue IANA timezone to `venues`. Backfills all existing
// rows to 'Europe/London' (the flagship tenant's zone). Idempotent
// via `ADD COLUMN IF NOT EXISTS`.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0015.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

await db.execute(sql`
  ALTER TABLE "venues"
    ADD COLUMN IF NOT EXISTS "timezone" varchar(100) NOT NULL DEFAULT 'Europe/London'
`);

// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0015_venue_timezone applied successfully");
process.exit(0);
