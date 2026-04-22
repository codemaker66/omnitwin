-- -----------------------------------------------------------------------------
-- 0018_subscriptions
--
-- Turns OMNITWIN / VenViewer from a single-tenant tool for Trades Hall into
-- a multi-tenant SaaS. Adds two tables and two columns:
--
--   1. subscriptions — one row per Stripe subscription. Created when a
--      prospective customer starts Checkout (venue_id NULL at that point);
--      linked to a venue after the onboarding wizard finishes.
--
--   2. stripe_events — idempotency log for Stripe webhooks. Mirrors the
--      email_sends pattern (insert-first by unique event_id, catch 23505,
--      treat duplicates as "already processed"). Stripe retries webhooks
--      on transient failures, so every handler MUST be idempotent.
--
--   3. venues.subscription_status + venues.plan_tier — denormalised onto
--      venues so the require-active-subscription middleware can read
--      gating state with one indexed lookup instead of joining
--      subscriptions on every authenticated request.
--
-- The existing Trades Hall venue is backfilled as subscription_status
-- 'active', plan_tier 'venue' — the SaaS migration doesn't paywall the
-- current single customer. Any future venue starts at status 'none' and
-- gets promoted to 'trialing' / 'active' by the webhook handler.
-- -----------------------------------------------------------------------------

-- 1. subscriptions --------------------------------------------------------

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
);

-- Unique on Stripe identifiers where present. Partial indexes allow
-- multiple rows with NULL during the Checkout handoff window.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_unique"
  ON "subscriptions" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_checkout_session_id_unique"
  ON "subscriptions" ("stripe_checkout_session_id")
  WHERE "stripe_checkout_session_id" IS NOT NULL;

-- Hot reads
CREATE INDEX IF NOT EXISTS "subscriptions_venue_idx"
  ON "subscriptions" ("venue_id");
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx"
  ON "subscriptions" ("status");

-- 2. stripe_events --------------------------------------------------------

CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL UNIQUE,
  "type" varchar(100) NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "stripe_events_type_idx"
  ON "stripe_events" ("type");

-- 3. venues.subscription_status + plan_tier -------------------------------

ALTER TABLE "venues"
  ADD COLUMN IF NOT EXISTS "subscription_status" varchar(30) NOT NULL DEFAULT 'none';

ALTER TABLE "venues"
  ADD COLUMN IF NOT EXISTS "plan_tier" varchar(30);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_subscription_status_check'
  ) THEN
    ALTER TABLE "venues" ADD CONSTRAINT "venues_subscription_status_check" CHECK (
      "subscription_status" IN ('none', 'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_plan_tier_check'
  ) THEN
    ALTER TABLE "venues" ADD CONSTRAINT "venues_plan_tier_check" CHECK (
      "plan_tier" IS NULL OR "plan_tier" IN ('starter', 'pro', 'venue')
    );
  END IF;
END $$;

-- Backfill: Trades Hall Glasgow stays live on the 'venue' tier. No paywall
-- for the flagship customer during the SaaS roll-out. Any future venue
-- (multi-tenant onboarding) starts at 'none' until Checkout completes.
UPDATE "venues"
  SET "subscription_status" = 'active', "plan_tier" = 'venue'
  WHERE "slug" = 'trades-hall-glasgow' AND "subscription_status" = 'none';
