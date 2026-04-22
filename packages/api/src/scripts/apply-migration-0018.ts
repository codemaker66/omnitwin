import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// apply-migration-0018_subscriptions
//
// Creates the subscriptions + stripe_events tables, adds subscription_status
// and plan_tier to venues, and backfills Trades Hall Glasgow as 'active'.
// Idempotent — safe to re-run. Mirrors 0018_subscriptions.sql exactly.
//
// Usage: `pnpm --filter @omnitwin/api tsx src/scripts/apply-migration-0018.ts`
// ---------------------------------------------------------------------------

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

// 1. subscriptions --------------------------------------------------------
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "venue_id" uuid REFERENCES "venues"("id"),
    "stripe_customer_id" text NOT NULL,
    "stripe_subscription_id" text,
    "stripe_checkout_session_id" text,
    "plan_tier" varchar(30) NOT NULL,
    "status" varchar(30) NOT NULL,
    "current_period_end" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT "subscriptions_plan_tier_check"
      CHECK ("plan_tier" IN ('starter', 'pro', 'venue')),
    CONSTRAINT "subscriptions_status_check"
      CHECK ("status" IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'))
  )
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_unique"
    ON "subscriptions" ("stripe_subscription_id")
    WHERE "stripe_subscription_id" IS NOT NULL
`);

await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_checkout_session_id_unique"
    ON "subscriptions" ("stripe_checkout_session_id")
    WHERE "stripe_checkout_session_id" IS NOT NULL
`);

await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscriptions_venue_idx" ON "subscriptions" ("venue_id")`);
await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" ("status")`);

// 2. stripe_events --------------------------------------------------------
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "stripe_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" text NOT NULL UNIQUE,
    "type" varchar(100) NOT NULL,
    "received_at" timestamp with time zone NOT NULL DEFAULT NOW()
  )
`);

await db.execute(sql`CREATE INDEX IF NOT EXISTS "stripe_events_type_idx" ON "stripe_events" ("type")`);

// 3. venues extensions + backfill -----------------------------------------
await db.execute(sql`ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "subscription_status" varchar(30) NOT NULL DEFAULT 'none'`);
await db.execute(sql`ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "plan_tier" varchar(30)`);

await db.execute(sql`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'venues_subscription_status_check'
    ) THEN
      ALTER TABLE "venues" ADD CONSTRAINT "venues_subscription_status_check" CHECK (
        "subscription_status" IN ('none', 'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')
      );
    END IF;
  END $$
`);

await db.execute(sql`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'venues_plan_tier_check'
    ) THEN
      ALTER TABLE "venues" ADD CONSTRAINT "venues_plan_tier_check" CHECK (
        "plan_tier" IS NULL OR "plan_tier" IN ('starter', 'pro', 'venue')
      );
    END IF;
  END $$
`);

await db.execute(sql`
  UPDATE "venues"
    SET "subscription_status" = 'active', "plan_tier" = 'venue'
    WHERE "slug" = 'trades-hall-glasgow' AND "subscription_status" = 'none'
`);

// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0018_subscriptions applied successfully");
process.exit(0);
