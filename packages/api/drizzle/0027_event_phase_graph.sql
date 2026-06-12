-- -----------------------------------------------------------------------------
-- 0027_event_phase_graph
--
-- Event model and phase graph foundation. Creates durable planning data only:
-- events, phases, scenarios, layout variants, configuration links, and phase
-- layout snapshots. Density and staff-conflict fields default to not_checked so
-- downstream UI cannot imply simulation, safety, or operational verification.
-- -----------------------------------------------------------------------------

-- 1. events -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "name" varchar(200) NOT NULL,
  "event_type" varchar(80),
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "guest_count" integer NOT NULL DEFAULT 0,
  "client_name" varchar(200),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_status_check') THEN
    ALTER TABLE "events" DROP CONSTRAINT "events_status_check";
  END IF;
  ALTER TABLE "events"
    ADD CONSTRAINT "events_status_check"
    CHECK ("status" IN ('draft', 'proposed', 'confirmed', 'in_planning', 'ready_for_ops', 'executed', 'closed', 'cancelled'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_guest_count_nonneg') THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_guest_count_nonneg"
      CHECK ("guest_count" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_time_order') THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_time_order"
      CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "events_venue_status_idx"
  ON "events" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "events_created_by_idx"
  ON "events" ("created_by");

-- 2. event_phases -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "event_phases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "template_key" varchar(40),
  "name" varchar(100) NOT NULL,
  "sort_order" integer NOT NULL,
  "starts_at" timestamp with time zone,
  "duration_minutes" integer NOT NULL DEFAULT 0,
  "guest_count" integer,
  "ops_tasks_count" integer NOT NULL DEFAULT 0,
  "review_gates_count" integer NOT NULL DEFAULT 0,
  "density_status" varchar(30) NOT NULL DEFAULT 'not_checked',
  "density_label" varchar(120) NOT NULL DEFAULT 'Density not checked',
  "staff_conflicts_status" varchar(30) NOT NULL DEFAULT 'not_checked',
  "staff_conflicts_label" varchar(120) NOT NULL DEFAULT 'Staff conflicts not checked',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_phases_event_template_unique') THEN
    ALTER TABLE "event_phases"
      ADD CONSTRAINT "event_phases_event_template_unique"
      UNIQUE ("event_id", "template_key");
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_phases_template_key_check') THEN
    ALTER TABLE "event_phases" DROP CONSTRAINT "event_phases_template_key_check";
  END IF;
  ALTER TABLE "event_phases"
    ADD CONSTRAINT "event_phases_template_key_check"
    CHECK ("template_key" IS NULL OR "template_key" IN ('arrival', 'ceremony', 'room-flip', 'dinner', 'speeches', 'bar-queue', 'dancing', 'breakdown'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_phases_density_status_check') THEN
    ALTER TABLE "event_phases" DROP CONSTRAINT "event_phases_density_status_check";
  END IF;
  ALTER TABLE "event_phases"
    ADD CONSTRAINT "event_phases_density_status_check"
    CHECK ("density_status" IN ('not_checked', 'missing_inputs', 'simulated', 'current', 'stale'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_phases_staff_conflicts_status_check') THEN
    ALTER TABLE "event_phases" DROP CONSTRAINT "event_phases_staff_conflicts_status_check";
  END IF;
  ALTER TABLE "event_phases"
    ADD CONSTRAINT "event_phases_staff_conflicts_status_check"
    CHECK ("staff_conflicts_status" IN ('not_checked', 'missing_inputs', 'simulated', 'current', 'stale'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_phases_counts_nonneg') THEN
    ALTER TABLE "event_phases"
      ADD CONSTRAINT "event_phases_counts_nonneg"
      CHECK (
        "sort_order" >= 0 AND
        "duration_minutes" >= 0 AND
        ("guest_count" IS NULL OR "guest_count" >= 0) AND
        "ops_tasks_count" >= 0 AND
        "review_gates_count" >= 0
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_phases_event_order_idx"
  ON "event_phases" ("event_id", "sort_order");

-- 3. event_scenarios ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "event_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "name" varchar(160) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "assumptions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seed" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_scenarios_status_check') THEN
    ALTER TABLE "event_scenarios" DROP CONSTRAINT "event_scenarios_status_check";
  END IF;
  ALTER TABLE "event_scenarios"
    ADD CONSTRAINT "event_scenarios_status_check"
    CHECK ("status" IN ('draft', 'ready_for_inputs', 'queued', 'completed', 'stale', 'cancelled'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_scenarios_seed_nonneg') THEN
    ALTER TABLE "event_scenarios"
      ADD CONSTRAINT "event_scenarios_seed_nonneg"
      CHECK ("seed" IS NULL OR "seed" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_scenarios_event_idx"
  ON "event_scenarios" ("event_id");
CREATE INDEX IF NOT EXISTS "event_scenarios_phase_idx"
  ON "event_scenarios" ("phase_id");

-- 4. layout_variants ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "layout_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "name" varchar(160) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "guest_count" integer,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'layout_variants_status_check') THEN
    ALTER TABLE "layout_variants" DROP CONSTRAINT "layout_variants_status_check";
  END IF;
  ALTER TABLE "layout_variants"
    ADD CONSTRAINT "layout_variants_status_check"
    CHECK ("status" IN ('draft', 'candidate', 'approved', 'archived'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'layout_variants_guest_count_nonneg') THEN
    ALTER TABLE "layout_variants"
      ADD CONSTRAINT "layout_variants_guest_count_nonneg"
      CHECK ("guest_count" IS NULL OR "guest_count" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "layout_variants_event_status_idx"
  ON "layout_variants" ("event_id", "status");
CREATE INDEX IF NOT EXISTS "layout_variants_configuration_idx"
  ON "layout_variants" ("configuration_id");

-- 5. event_configuration_links ----------------------------------------------

CREATE TABLE IF NOT EXISTS "event_configuration_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "layout_variant_id" uuid REFERENCES "layout_variants"("id") ON DELETE SET NULL,
  "link_type" varchar(40) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_configuration_links_unique') THEN
    ALTER TABLE "event_configuration_links"
      ADD CONSTRAINT "event_configuration_links_unique"
      UNIQUE ("event_id", "configuration_id", "link_type");
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_configuration_links_link_type_check') THEN
    ALTER TABLE "event_configuration_links" DROP CONSTRAINT "event_configuration_links_link_type_check";
  END IF;
  ALTER TABLE "event_configuration_links"
    ADD CONSTRAINT "event_configuration_links_link_type_check"
    CHECK ("link_type" IN ('source_configuration', 'variant_configuration', 'approved_snapshot_source'));
END $$;

CREATE INDEX IF NOT EXISTS "event_configuration_links_event_idx"
  ON "event_configuration_links" ("event_id");
CREATE INDEX IF NOT EXISTS "event_configuration_links_config_idx"
  ON "event_configuration_links" ("configuration_id");

-- 6. phase_layout_snapshots --------------------------------------------------

CREATE TABLE IF NOT EXISTS "phase_layout_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_phase_id" uuid NOT NULL REFERENCES "event_phases"("id") ON DELETE CASCADE,
  "layout_variant_id" uuid REFERENCES "layout_variants"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "snapshot_hash" varchar(64),
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "object_count" integer NOT NULL DEFAULT 0,
  "guest_count" integer,
  "payload" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "frozen_at" timestamp with time zone
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase_layout_snapshots_status_check') THEN
    ALTER TABLE "phase_layout_snapshots" DROP CONSTRAINT "phase_layout_snapshots_status_check";
  END IF;
  ALTER TABLE "phase_layout_snapshots"
    ADD CONSTRAINT "phase_layout_snapshots_status_check"
    CHECK ("status" IN ('draft', 'frozen', 'stale', 'superseded'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase_layout_snapshots_hash_shape') THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_hash_shape"
      CHECK ("snapshot_hash" IS NULL OR "snapshot_hash" ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase_layout_snapshots_counts_nonneg') THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_counts_nonneg"
      CHECK ("object_count" >= 0 AND ("guest_count" IS NULL OR "guest_count" >= 0));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "phase_layout_snapshots_phase_idx"
  ON "phase_layout_snapshots" ("event_phase_id");
CREATE INDEX IF NOT EXISTS "phase_layout_snapshots_variant_idx"
  ON "phase_layout_snapshots" ("layout_variant_id");
CREATE INDEX IF NOT EXISTS "phase_layout_snapshots_config_idx"
  ON "phase_layout_snapshots" ("configuration_id");
