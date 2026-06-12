-- -----------------------------------------------------------------------------
-- 0035_guest_flow_navmesh_upgrade
--
-- Browser-first Guest Flow Replay upgrade. Adds scenario records and navmesh
-- version records while preserving existing v0 replay artifacts. These tables
-- store simulated planning evidence only; they do not assert safety, legal
-- compliance, evacuation approval, occupancy approval, or certification.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "guest_flow_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "name" varchar(180) NOT NULL,
  "scenario_type" varchar(60) NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'draft',
  "seed" integer NOT NULL,
  "assumptions" jsonb NOT NULL,
  "input_payload" jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_flow_scenarios_status_check') THEN
    ALTER TABLE "guest_flow_scenarios" DROP CONSTRAINT "guest_flow_scenarios_status_check";
  END IF;
  ALTER TABLE "guest_flow_scenarios"
    ADD CONSTRAINT "guest_flow_scenarios_status_check"
    CHECK ("status" IN ('draft', 'ready', 'archived'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_flow_scenarios_seed_nonneg') THEN
    ALTER TABLE "guest_flow_scenarios"
      ADD CONSTRAINT "guest_flow_scenarios_seed_nonneg"
      CHECK ("seed" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "guest_flow_scenarios_event_idx" ON "guest_flow_scenarios" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "guest_flow_scenarios_phase_idx" ON "guest_flow_scenarios" ("phase_id");
CREATE INDEX IF NOT EXISTS "guest_flow_scenarios_config_idx" ON "guest_flow_scenarios" ("configuration_id");

CREATE TABLE IF NOT EXISTS "navmesh_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "scenario_id" uuid REFERENCES "guest_flow_scenarios"("id") ON DELETE SET NULL,
  "navmesh_hash" varchar(64) NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "algorithm" varchar(80) NOT NULL DEFAULT 'grid_navmesh_fallback_v0',
  "cell_size_m" numeric(8, 3) NOT NULL,
  "agent_radius_m" numeric(8, 3) NOT NULL,
  "walkable_cell_count" integer NOT NULL,
  "blocked_cell_count" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "limitations" jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'navmesh_versions_algorithm_check') THEN
    ALTER TABLE "navmesh_versions" DROP CONSTRAINT "navmesh_versions_algorithm_check";
  END IF;
  ALTER TABLE "navmesh_versions"
    ADD CONSTRAINT "navmesh_versions_algorithm_check"
    CHECK ("algorithm" IN ('grid_navmesh_fallback_v0'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'navmesh_versions_hash_shape') THEN
    ALTER TABLE "navmesh_versions"
      ADD CONSTRAINT "navmesh_versions_hash_shape"
      CHECK (
        "navmesh_hash" ~ '^[a-f0-9]{64}$'
        AND "input_hash" ~ '^[a-f0-9]{64}$'
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'navmesh_versions_cell_counts_nonneg') THEN
    ALTER TABLE "navmesh_versions"
      ADD CONSTRAINT "navmesh_versions_cell_counts_nonneg"
      CHECK ("walkable_cell_count" >= 0 AND "blocked_cell_count" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "navmesh_versions_event_idx" ON "navmesh_versions" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "navmesh_versions_phase_idx" ON "navmesh_versions" ("phase_id");
CREATE INDEX IF NOT EXISTS "navmesh_versions_config_idx" ON "navmesh_versions" ("configuration_id");
CREATE INDEX IF NOT EXISTS "navmesh_versions_scenario_idx" ON "navmesh_versions" ("scenario_id");
CREATE UNIQUE INDEX IF NOT EXISTS "navmesh_versions_hash_unique" ON "navmesh_versions" ("navmesh_hash");

ALTER TABLE "guest_flow_replays"
  ADD COLUMN IF NOT EXISTS "scenario_id" uuid REFERENCES "guest_flow_scenarios"("id") ON DELETE SET NULL;

ALTER TABLE "guest_flow_replays"
  ADD COLUMN IF NOT EXISTS "navmesh_version_id" uuid REFERENCES "navmesh_versions"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "guest_flow_replays_scenario_idx" ON "guest_flow_replays" ("scenario_id");
CREATE INDEX IF NOT EXISTS "guest_flow_replays_navmesh_idx" ON "guest_flow_replays" ("navmesh_version_id");
