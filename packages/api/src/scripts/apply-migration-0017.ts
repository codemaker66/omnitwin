import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0017_layout_urls
//
// Adds URL identifier columns + layout_aliases table needed for the
// `/<username>/<slug>` and `/plan/<shortcode>` URL refactor. Idempotent
// via IF NOT EXISTS and pg_constraint existence checks — safe to run
// against any environment regardless of prior migration state.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0017.ts`
//
// See packages/api/drizzle/0017_layout_urls.sql for the narrative
// explaining the three pieces (users.username, configurations.slug +
// short_code, layout_aliases). This script is the operational twin that
// can be run ahead of the drizzle-kit migrate pipeline when we need to
// apply the change manually.
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

// 1. users.username -------------------------------------------------------
await db.execute(sql`
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(30)
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique_idx"
    ON "users" (lower("username"))
    WHERE "username" IS NOT NULL
`);

await db.execute(sql`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_username_shape'
    ) THEN
      ALTER TABLE "users" ADD CONSTRAINT "users_username_shape" CHECK (
        "username" IS NULL OR "username" ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$'
      );
    END IF;
  END $$
`);

// 2. configurations.slug + short_code -------------------------------------
await db.execute(sql`
  ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "slug" varchar(60)
`);

await db.execute(sql`
  ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "short_code" varchar(12)
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "configurations_user_slug_unique"
    ON "configurations" ("user_id", lower("slug"))
    WHERE "deleted_at" IS NULL AND "user_id" IS NOT NULL AND "slug" IS NOT NULL
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "configurations_short_code_unique"
    ON "configurations" ("short_code")
    WHERE "deleted_at" IS NULL AND "short_code" IS NOT NULL
`);

await db.execute(sql`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'configurations_slug_shape'
    ) THEN
      ALTER TABLE "configurations" ADD CONSTRAINT "configurations_slug_shape" CHECK (
        "slug" IS NULL OR "slug" ~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$'
      );
    END IF;
  END $$
`);

await db.execute(sql`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'configurations_short_code_shape'
    ) THEN
      ALTER TABLE "configurations" ADD CONSTRAINT "configurations_short_code_shape" CHECK (
        "short_code" IS NULL OR "short_code" ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{6}$'
      );
    END IF;
  END $$
`);

// 3. layout_aliases -------------------------------------------------------
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "layout_aliases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
    "kind" varchar(20) NOT NULL,
    "path_key" text NOT NULL,
    "retired_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT "layout_aliases_kind_check" CHECK ("kind" IN ('uuid', 'shortcode', 'user_slug'))
  )
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "layout_aliases_path_unique"
    ON "layout_aliases" ("path_key")
`);

await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "layout_aliases_config_idx"
    ON "layout_aliases" ("configuration_id")
`);

// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0017_layout_urls applied successfully");
process.exit(0);
