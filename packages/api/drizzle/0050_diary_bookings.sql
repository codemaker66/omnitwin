-- -----------------------------------------------------------------------------
-- 0050_diary_bookings
--
-- The Diary's commitment axis (Canon §1–§3, T-487). One bookings table carries
-- prospect / hold / ink / internal_block commitments with option-ladder rank,
-- hold-hygiene fields, and soft deletion. The ink hard floor is a btree_gist
-- partial exclusion constraint: two active inks can never overlap in one
-- space. Holds and prospects overlap by design (the option ladder). Additive
-- extensions: events gains CRM links + the headcount triple; event_phases
-- gains space_id (the Occupancy Footprint keystone); spaces gains a composite
-- identity for tenant-integrity foreign keys. Strictly additive — nothing is
-- removed or rewritten.
--
-- Like migration 0045, the composite event FK below is authoritative for its
-- column-targeted ON DELETE behaviour; Drizzle 0.45 cannot encode the target
-- column list, so schema.ts declares the FK without an action.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_id_venue_unique') THEN
    ALTER TABLE "spaces" ADD CONSTRAINT "spaces_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "kind" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "title" varchar(200) NOT NULL,
  "event_type" varchar(80),
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "rank" integer,
  "joint_flag" boolean NOT NULL DEFAULT false,
  "decision_at" timestamp with time zone,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "next_action" varchar(500),
  "next_action_due_at" timestamp with time zone,
  "series_id" uuid,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "bookings_id_venue_unique" UNIQUE ("id", "venue_id"),
  CONSTRAINT "bookings_event_venue_fk" FOREIGN KEY("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE SET NULL ("event_id"),
  CONSTRAINT "bookings_space_venue_fk" FOREIGN KEY("space_id", "venue_id") REFERENCES "spaces"("id", "venue_id"),
  CONSTRAINT "bookings_time_valid" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "bookings_kind_check" CHECK ("kind" IN ('prospect', 'hold', 'ink', 'internal_block')),
  CONSTRAINT "bookings_status_check" CHECK ("status" IN ('active', 'released', 'expired', 'cancelled', 'lost')),
  CONSTRAINT "bookings_rank_positive" CHECK ("rank" IS NULL OR "rank" >= 1),
  CONSTRAINT "bookings_rank_hold_only" CHECK ("rank" IS NULL OR "kind" = 'hold')
);

-- The ink hard floor (Canon §2.2). Half-open [) ranges: back-to-back bookings
-- (one ends 18:00, the next starts 18:00) are legal — the turnaround rule
-- engine, not this constraint, judges whether the gap is operationally
-- sufficient. Only active, non-deleted ink participates; the constraint is
-- the final arbiter of the joint-first conversion race (error 23P01).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_ink_no_overlap') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ink_no_overlap"
      EXCLUDE USING gist (
        "space_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
      )
      WHERE ("kind" = 'ink' AND "status" = 'active' AND "deleted_at" IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_venue_starts_idx" ON "bookings" ("venue_id", "starts_at");
CREATE INDEX IF NOT EXISTS "bookings_space_starts_idx" ON "bookings" ("space_id", "starts_at");
CREATE INDEX IF NOT EXISTS "bookings_event_idx" ON "bookings" ("event_id");
CREATE INDEX IF NOT EXISTS "bookings_venue_kind_status_idx" ON "bookings" ("venue_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "bookings_venue_decision_idx" ON "bookings" ("venue_id", "decision_at");
CREATE INDEX IF NOT EXISTS "bookings_venue_next_action_idx" ON "bookings" ("venue_id", "next_action_due_at");

CREATE TABLE IF NOT EXISTS "booking_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "from_state" varchar(20) NOT NULL,
  "to_state" varchar(20) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "booking_status_history_booking_idx" ON "booking_status_history" ("booking_id");

CREATE TABLE IF NOT EXISTS "turnaround_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid REFERENCES "spaces"("id"),
  "event_type" varchar(80),
  "name" varchar(200) NOT NULL,
  "minutes" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "turnaround_rules_minutes_nonnegative" CHECK ("minutes" >= 0)
);

CREATE INDEX IF NOT EXISTS "turnaround_rules_venue_space_idx" ON "turnaround_rules" ("venue_id", "space_id");

-- Events join the CRM spine (Canon §2.4): client account + opportunity links
-- and the guaranteed / expected / setFor headcount triple. The legacy single
-- guest_count column remains untouched for existing consumers.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "client_account_id" uuid REFERENCES "client_accounts"("id") ON DELETE SET NULL;
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "headcount_guaranteed" integer;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "headcount_expected" integer;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "headcount_set_for" integer;

CREATE INDEX IF NOT EXISTS "events_client_account_idx" ON "events" ("client_account_id");
CREATE INDEX IF NOT EXISTS "events_opportunity_idx" ON "events" ("opportunity_id");

-- The Occupancy Footprint keystone (Canon §2.3): phases become room-scoped.
-- Nullable — existing rows stay venue-global and are excluded from room lanes
-- until scoped.
ALTER TABLE "event_phases"
  ADD COLUMN IF NOT EXISTS "space_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "event_phases_space_idx" ON "event_phases" ("space_id");
