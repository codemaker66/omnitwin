-- -----------------------------------------------------------------------------
-- 0031_guest_flow_replay
--
-- Guest Flow Replay v0 persistence. Stores deterministic simulated planning
-- support artifacts and their inspectable outputs. These tables do not assert
-- safety, legal compliance, occupancy approval, or certification.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "guest_flow_replays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "scenario_type" varchar(60) NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'simulated_planning_support',
  "simulator_source" varchar(60) NOT NULL DEFAULT 'custom_venviewer_v0',
  "seed" integer NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "artifact_hash" varchar(64) NOT NULL,
  "snapshot_hash" varchar(64),
  "assumptions" jsonb NOT NULL,
  "input_payload" jsonb NOT NULL,
  "metrics" jsonb NOT NULL,
  "disclosure_label" varchar(160) NOT NULL DEFAULT 'Simulated guest flow - planning support',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_flow_replays_status_check') THEN
    ALTER TABLE "guest_flow_replays" DROP CONSTRAINT "guest_flow_replays_status_check";
  END IF;
  ALTER TABLE "guest_flow_replays"
    ADD CONSTRAINT "guest_flow_replays_status_check"
    CHECK ("status" IN ('simulated_planning_support', 'stale', 'failed', 'human_review_required'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_flow_replays_hash_shape') THEN
    ALTER TABLE "guest_flow_replays"
      ADD CONSTRAINT "guest_flow_replays_hash_shape"
      CHECK (
        "input_hash" ~ '^[a-f0-9]{64}$'
        AND "artifact_hash" ~ '^[a-f0-9]{64}$'
        AND ("snapshot_hash" IS NULL OR "snapshot_hash" ~ '^[a-f0-9]{64}$')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_flow_replays_seed_nonneg') THEN
    ALTER TABLE "guest_flow_replays"
      ADD CONSTRAINT "guest_flow_replays_seed_nonneg"
      CHECK ("seed" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "guest_flow_replays_event_idx" ON "guest_flow_replays" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "guest_flow_replays_phase_idx" ON "guest_flow_replays" ("phase_id");
CREATE INDEX IF NOT EXISTS "guest_flow_replays_config_idx" ON "guest_flow_replays" ("configuration_id");
CREATE UNIQUE INDEX IF NOT EXISTS "guest_flow_replays_artifact_hash_unique" ON "guest_flow_replays" ("artifact_hash");

CREATE TABLE IF NOT EXISTS "agent_trajectories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "replay_id" uuid NOT NULL REFERENCES "guest_flow_replays"("id") ON DELETE CASCADE,
  "agent_id" varchar(80) NOT NULL,
  "profile" varchar(40) NOT NULL,
  "spawn_id" varchar(120) NOT NULL,
  "destination_id" varchar(120) NOT NULL,
  "points" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "agent_trajectories_replay_idx" ON "agent_trajectories" ("replay_id", "agent_id");

CREATE TABLE IF NOT EXISTS "density_heatmaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "replay_id" uuid NOT NULL REFERENCES "guest_flow_replays"("id") ON DELETE CASCADE,
  "cell_size_m" numeric(8, 3) NOT NULL,
  "max_density" numeric(10, 3) NOT NULL,
  "cells" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "density_heatmaps_replay_unique" ON "density_heatmaps" ("replay_id");

CREATE TABLE IF NOT EXISTS "route_conflicts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "replay_id" uuid NOT NULL REFERENCES "guest_flow_replays"("id") ON DELETE CASCADE,
  "conflict_key" varchar(120) NOT NULL,
  "conflict_type" varchar(40) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "point" jsonb NOT NULL,
  "involved_agent_ids" jsonb NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_conflicts_severity_check') THEN
    ALTER TABLE "route_conflicts" DROP CONSTRAINT "route_conflicts_severity_check";
  END IF;
  ALTER TABLE "route_conflicts"
    ADD CONSTRAINT "route_conflicts_severity_check"
    CHECK ("severity" IN ('info', 'attention', 'review'));
END $$;

CREATE INDEX IF NOT EXISTS "route_conflicts_replay_idx" ON "route_conflicts" ("replay_id", "severity");

CREATE TABLE IF NOT EXISTS "queue_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "replay_id" uuid NOT NULL REFERENCES "guest_flow_replays"("id") ON DELETE CASCADE,
  "zone_key" varchar(120) NOT NULL,
  "destination_id" varchar(120) NOT NULL,
  "label" varchar(160) NOT NULL,
  "centre" jsonb NOT NULL,
  "estimated_agents" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "queue_zones_replay_idx" ON "queue_zones" ("replay_id");

CREATE TABLE IF NOT EXISTS "staff_lanes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "replay_id" uuid NOT NULL REFERENCES "guest_flow_replays"("id") ON DELETE CASCADE,
  "lane_key" varchar(120) NOT NULL,
  "label" varchar(160) NOT NULL,
  "line" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "staff_lanes_replay_idx" ON "staff_lanes" ("replay_id");
