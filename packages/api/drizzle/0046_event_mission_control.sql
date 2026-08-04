-- -----------------------------------------------------------------------------
-- 0046_event_mission_control
--
-- Authoritative, replayable event-day execution. Compiled ops tasks stay as
-- frozen handoff inputs; mission phase/task rows are CAS-guarded projections,
-- and event_mission_events is append-only. Presence is advisory and expires by
-- last_seen_at rather than entering the replay log.
-- -----------------------------------------------------------------------------

ALTER TABLE "ops_tasks"
  ADD COLUMN IF NOT EXISTS "spatial_anchors" jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_spatial_anchors_array_check') THEN
    ALTER TABLE "ops_tasks"
      ADD CONSTRAINT "ops_tasks_spatial_anchors_array_check"
      CHECK (jsonb_typeof("spatial_anchors") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_id_venue_unique') THEN
    ALTER TABLE "events" ADD CONSTRAINT "events_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_event_id_id_unique') THEN
    ALTER TABLE "handoff_packs" ADD CONSTRAINT "handoff_packs_event_id_id_unique" UNIQUE ("event_id", "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_handoff_id_unique') THEN
    ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_handoff_id_unique" UNIQUE ("handoff_pack_id", "id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "event_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id"),
  "source_snapshot_hash" varchar(64) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'live',
  "baseline" jsonb NOT NULL,
  "baseline_hash" varchar(64) NOT NULL,
  "last_sequence" bigint NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_missions_id_event_unique" UNIQUE ("id", "event_id"),
  CONSTRAINT "event_missions_id_event_handoff_unique" UNIQUE ("id", "event_id", "handoff_pack_id"),
  CONSTRAINT "event_missions_event_venue_fk" FOREIGN KEY ("event_id", "venue_id")
    REFERENCES "events" ("id", "venue_id"),
  CONSTRAINT "event_missions_event_handoff_fk" FOREIGN KEY ("event_id", "handoff_pack_id")
    REFERENCES "handoff_packs" ("event_id", "id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_missions_status_check') THEN
    ALTER TABLE "event_missions" ADD CONSTRAINT "event_missions_status_check"
      CHECK ("status" IN ('live', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_missions_hash_check') THEN
    ALTER TABLE "event_missions" ADD CONSTRAINT "event_missions_hash_check"
      CHECK ("source_snapshot_hash" ~ '^[a-f0-9]{64}$' AND "baseline_hash" ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_missions_sequence_check') THEN
    ALTER TABLE "event_missions" ADD CONSTRAINT "event_missions_sequence_check" CHECK ("last_sequence" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_missions_baseline_object_check') THEN
    ALTER TABLE "event_missions" ADD CONSTRAINT "event_missions_baseline_object_check"
      CHECK (
        jsonb_typeof("baseline") = 'object' AND
        "baseline" ->> 'schemaVersion' = 'venviewer.event-mission.v0' AND
        "baseline" ->> 'missionId' = "id"::text AND
        "baseline" ->> 'eventId' = "event_id"::text AND
        "baseline" ->> 'venueId' = "venue_id"::text AND
        "baseline" ->> 'handoffPackId' = "handoff_pack_id"::text
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_missions_terminal_timestamp_check') THEN
    ALTER TABLE "event_missions" ADD CONSTRAINT "event_missions_terminal_timestamp_check" CHECK (
      ("status" = 'live' AND "completed_at" IS NULL AND "cancelled_at" IS NULL) OR
      ("status" = 'completed' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL) OR
      ("status" = 'cancelled' AND "completed_at" IS NULL AND "cancelled_at" IS NOT NULL)
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "event_missions_one_live_per_event"
  ON "event_missions" ("event_id") WHERE "status" = 'live';
CREATE INDEX IF NOT EXISTS "event_missions_event_created_idx" ON "event_missions" ("event_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "event_missions_venue_status_idx" ON "event_missions" ("venue_id", "status");

CREATE TABLE IF NOT EXISTS "event_mission_phases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "phase_id" uuid NOT NULL REFERENCES "event_phases"("id"),
  "name" varchar(100) NOT NULL,
  "sort_order" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "revision" integer NOT NULL DEFAULT 1,
  "actual_started_at" timestamp with time zone,
  "actual_ended_at" timestamp with time zone,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_mission_phases_mission_phase_unique" UNIQUE ("mission_id", "phase_id"),
  CONSTRAINT "event_mission_phases_mission_id_unique" UNIQUE ("mission_id", "id"),
  CONSTRAINT "event_mission_phases_mission_event_fk" FOREIGN KEY ("mission_id", "event_id")
    REFERENCES "event_missions" ("id", "event_id") ON DELETE CASCADE,
  CONSTRAINT "event_mission_phases_event_phase_fk" FOREIGN KEY ("event_id", "phase_id")
    REFERENCES "event_phases" ("event_id", "id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_phases_status_check') THEN
    ALTER TABLE "event_mission_phases" ADD CONSTRAINT "event_mission_phases_status_check"
      CHECK ("status" IN ('pending', 'active', 'completed', 'skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_phases_revision_check') THEN
    ALTER TABLE "event_mission_phases" ADD CONSTRAINT "event_mission_phases_revision_check"
      CHECK ("revision" > 0 AND "sort_order" >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "event_mission_phases_one_active"
  ON "event_mission_phases" ("mission_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "event_mission_phases_mission_order_idx"
  ON "event_mission_phases" ("mission_id", "sort_order");

CREATE TABLE IF NOT EXISTS "event_mission_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id"),
  "ops_task_id" uuid NOT NULL REFERENCES "ops_tasks"("id"),
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "kind" varchar(30) NOT NULL,
  "title" varchar(240) NOT NULL,
  "detail" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'todo',
  "revision" integer NOT NULL DEFAULT 1,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assignee_label" varchar(160),
  "spatial_anchors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "actual_started_at" timestamp with time zone,
  "actual_ended_at" timestamp with time zone,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_mission_tasks_mission_task_unique" UNIQUE ("mission_id", "ops_task_id"),
  CONSTRAINT "event_mission_tasks_mission_id_unique" UNIQUE ("mission_id", "id"),
  CONSTRAINT "event_mission_tasks_mission_scope_fk" FOREIGN KEY ("mission_id", "event_id", "handoff_pack_id")
    REFERENCES "event_missions" ("id", "event_id", "handoff_pack_id") ON DELETE CASCADE,
  CONSTRAINT "event_mission_tasks_handoff_task_fk" FOREIGN KEY ("handoff_pack_id", "ops_task_id")
    REFERENCES "ops_tasks" ("handoff_pack_id", "id"),
  CONSTRAINT "event_mission_tasks_event_phase_fk" FOREIGN KEY ("event_id", "phase_id")
    REFERENCES "event_phases" ("event_id", "id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_tasks_status_check') THEN
    ALTER TABLE "event_mission_tasks" ADD CONSTRAINT "event_mission_tasks_status_check"
      CHECK ("status" IN ('todo', 'in_progress', 'done', 'blocked', 'waived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_tasks_kind_check') THEN
    ALTER TABLE "event_mission_tasks" ADD CONSTRAINT "event_mission_tasks_kind_check"
      CHECK ("kind" IN ('setup', 'breakdown', 'room_flip', 'supplier', 'review_gate', 'note'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_tasks_shape_check') THEN
    ALTER TABLE "event_mission_tasks" ADD CONSTRAINT "event_mission_tasks_shape_check"
      CHECK ("revision" > 0 AND length(trim("title")) > 0 AND length(trim("detail")) > 0 AND jsonb_typeof("spatial_anchors") = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_mission_tasks_mission_status_idx" ON "event_mission_tasks" ("mission_id", "status");
CREATE INDEX IF NOT EXISTS "event_mission_tasks_assignee_idx" ON "event_mission_tasks" ("assigned_to");

CREATE TABLE IF NOT EXISTS "event_mission_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "mission_task_id" uuid REFERENCES "event_mission_tasks"("id") ON DELETE SET NULL,
  "title" varchar(180) NOT NULL,
  "detail" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "severity" varchar(20) NOT NULL DEFAULT 'attention',
  "spatial_anchor" jsonb,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reported_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_mission_incidents_mission_id_unique" UNIQUE ("mission_id", "id"),
  CONSTRAINT "event_mission_incidents_mission_event_fk" FOREIGN KEY ("mission_id", "event_id")
    REFERENCES "event_missions" ("id", "event_id") ON DELETE CASCADE,
  CONSTRAINT "event_mission_incidents_mission_task_fk" FOREIGN KEY ("mission_id", "mission_task_id")
    REFERENCES "event_mission_tasks" ("mission_id", "id"),
  CONSTRAINT "event_mission_incidents_event_phase_fk" FOREIGN KEY ("event_id", "phase_id")
    REFERENCES "event_phases" ("event_id", "id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_incidents_status_check') THEN
    ALTER TABLE "event_mission_incidents" ADD CONSTRAINT "event_mission_incidents_status_check"
      CHECK ("status" IN ('open', 'in_progress', 'resolved', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_incidents_severity_check') THEN
    ALTER TABLE "event_mission_incidents" ADD CONSTRAINT "event_mission_incidents_severity_check"
      CHECK ("severity" IN ('info', 'attention', 'urgent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_incidents_shape_check') THEN
    ALTER TABLE "event_mission_incidents" ADD CONSTRAINT "event_mission_incidents_shape_check"
      CHECK ("revision" > 0 AND length(trim("title")) > 0 AND length(trim("detail")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_mission_incidents_mission_status_idx"
  ON "event_mission_incidents" ("mission_id", "status");

CREATE TABLE IF NOT EXISTS "event_mission_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "sequence" bigint NOT NULL,
  "kind" varchar(40) NOT NULL,
  "entity_type" varchar(30) NOT NULL,
  "entity_id" uuid,
  "entity_revision" integer,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_role" varchar(30) NOT NULL,
  "actor_label" varchar(160) NOT NULL,
  "actor_key" varchar(200) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "requires_acknowledgement" boolean NOT NULL DEFAULT false,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_mission_events_mission_sequence_unique" UNIQUE ("mission_id", "sequence"),
  CONSTRAINT "event_mission_events_mission_id_unique" UNIQUE ("mission_id", "id"),
  CONSTRAINT "event_mission_events_idempotency_unique" UNIQUE ("mission_id", "actor_key", "idempotency_key"),
  CONSTRAINT "event_mission_events_mission_event_fk" FOREIGN KEY ("mission_id", "event_id")
    REFERENCES "event_missions" ("id", "event_id") ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_events_kind_check') THEN
    ALTER TABLE "event_mission_events" ADD CONSTRAINT "event_mission_events_kind_check" CHECK ("kind" IN (
      'mission_started', 'mission_status_changed', 'phase_status_changed', 'task_status_changed',
      'incident_created', 'incident_updated', 'event_acknowledged'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_events_entity_check') THEN
    ALTER TABLE "event_mission_events" ADD CONSTRAINT "event_mission_events_entity_check"
      CHECK ("entity_type" IN ('mission', 'phase', 'task', 'incident', 'acknowledgement'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_events_shape_check') THEN
    ALTER TABLE "event_mission_events" ADD CONSTRAINT "event_mission_events_shape_check" CHECK (
      "sequence" > 0 AND length(trim("actor_label")) > 0 AND length(trim("actor_key")) > 0 AND
      length(trim("idempotency_key")) >= 8 AND jsonb_typeof("payload") = 'object' AND
      "payload" ->> 'kind' = "kind"
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_events_actor_role_check') THEN
    ALTER TABLE "event_mission_events" ADD CONSTRAINT "event_mission_events_actor_role_check"
      CHECK ("actor_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_mission_events_mission_created_idx"
  ON "event_mission_events" ("mission_id", "created_at");
CREATE INDEX IF NOT EXISTS "event_mission_events_entity_idx"
  ON "event_mission_events" ("entity_type", "entity_id");

CREATE TABLE IF NOT EXISTS "event_mission_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "acknowledged_event_id" uuid NOT NULL REFERENCES "event_mission_events"("id") ON DELETE CASCADE,
  "acknowledged_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "acknowledged_by_role" varchar(30) NOT NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "event_mission_ack_event_user_unique" UNIQUE ("mission_id", "acknowledged_event_id", "acknowledged_by"),
  CONSTRAINT "event_mission_ack_mission_event_fk" FOREIGN KEY ("mission_id", "event_id")
    REFERENCES "event_missions" ("id", "event_id") ON DELETE CASCADE,
  CONSTRAINT "event_mission_ack_target_fk" FOREIGN KEY ("mission_id", "acknowledged_event_id")
    REFERENCES "event_mission_events" ("mission_id", "id") ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_ack_role_check') THEN
    ALTER TABLE "event_mission_acknowledgements" ADD CONSTRAINT "event_mission_ack_role_check"
      CHECK ("acknowledged_by_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_mission_ack_mission_created_idx"
  ON "event_mission_acknowledgements" ("mission_id", "created_at");

CREATE TABLE IF NOT EXISTS "event_mission_sessions" (
  "mission_id" uuid NOT NULL REFERENCES "event_missions"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(160) NOT NULL,
  "role" varchar(30) NOT NULL,
  "active_phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "active_task_id" uuid REFERENCES "event_mission_tasks"("id") ON DELETE SET NULL,
  "view" varchar(20) NOT NULL DEFAULT 'board',
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("mission_id", "session_id", "user_id"),
  CONSTRAINT "event_mission_sessions_mission_task_fk" FOREIGN KEY ("mission_id", "active_task_id")
    REFERENCES "event_mission_tasks" ("mission_id", "id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_sessions_view_check') THEN
    ALTER TABLE "event_mission_sessions" ADD CONSTRAINT "event_mission_sessions_view_check"
      CHECK ("view" IN ('board', 'map', 'timeline', 'replay'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_mission_sessions_role_check') THEN
    ALTER TABLE "event_mission_sessions" ADD CONSTRAINT "event_mission_sessions_role_check"
      CHECK ("role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_mission_sessions_active_idx"
  ON "event_mission_sessions" ("mission_id", "last_seen_at" DESC);
