-- -----------------------------------------------------------------------------
-- 0042_event_plan_lifecycle
--
-- Cross-role event-plan change feed, in-app notifications, per-user read
-- receipts, and hallkeeper acknowledgements. These are planning operations
-- records only; they do not imply legal, fire, accessibility, occupancy, or
-- certification approval.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "event_plan_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "proposal_id" uuid REFERENCES "proposals"("id") ON DELETE SET NULL,
  "handoff_pack_id" uuid REFERENCES "handoff_packs"("id") ON DELETE SET NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_role" varchar(30) NOT NULL,
  "actor_label" varchar(160) NOT NULL,
  "source_kind" varchar(40) NOT NULL,
  "source_id" varchar(160) NOT NULL,
  "title" varchar(180) NOT NULL,
  "summary" text NOT NULL,
  "before_summary" text,
  "after_summary" text,
  "affected_surfaces" jsonb NOT NULL,
  "audience_roles" jsonb NOT NULL,
  "risk_level" varchar(20) NOT NULL DEFAULT 'attention',
  "requires_hallkeeper_acknowledgement" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "event_plan_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "change_id" uuid REFERENCES "event_plan_changes"("id") ON DELETE CASCADE,
  "event_id" uuid REFERENCES "events"("id") ON DELETE CASCADE,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE CASCADE,
  "audience_role" varchar(30) NOT NULL,
  "recipient_user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(180) NOT NULL,
  "body" text NOT NULL,
  "severity" varchar(20) NOT NULL DEFAULT 'attention',
  "action_path" varchar(500),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "event_plan_notification_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "event_plan_notifications"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "read_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "event_plan_change_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "change_id" uuid NOT NULL REFERENCES "event_plan_changes"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "acknowledged_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "acknowledged_by_role" varchar(30) NOT NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_changes_actor_role_check') THEN
    ALTER TABLE "event_plan_changes"
      ADD CONSTRAINT "event_plan_changes_actor_role_check"
      CHECK ("actor_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_changes_source_kind_check') THEN
    ALTER TABLE "event_plan_changes"
      ADD CONSTRAINT "event_plan_changes_source_kind_check"
      CHECK ("source_kind" IN ('event', 'configuration', 'proposal', 'proposal_comment', 'proposal_response', 'ops_task', 'ops_issue', 'handoff_pack', 'runtime_asset'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_changes_risk_level_check') THEN
    ALTER TABLE "event_plan_changes"
      ADD CONSTRAINT "event_plan_changes_risk_level_check"
      CHECK ("risk_level" IN ('info', 'attention', 'blocker'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_changes_surfaces_json_check') THEN
    ALTER TABLE "event_plan_changes"
      ADD CONSTRAINT "event_plan_changes_surfaces_json_check"
      CHECK (
        jsonb_typeof("affected_surfaces") = 'array'
        AND jsonb_array_length("affected_surfaces") > 0
        AND "affected_surfaces" <@ '[
          "layout", "guest_count", "timings", "furniture", "suppliers",
          "accessibility", "service_notes", "pricing", "proposal",
          "evidence", "runtime_asset", "ops_tasks", "room_flip",
          "guest_flow", "lighting", "comments"
        ]'::jsonb
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_changes_audience_json_check') THEN
    ALTER TABLE "event_plan_changes"
      ADD CONSTRAINT "event_plan_changes_audience_json_check"
      CHECK (
        jsonb_typeof("audience_roles") = 'array'
        AND jsonb_array_length("audience_roles") > 0
        AND "audience_roles" <@ '["client", "planner", "staff", "hallkeeper", "admin", "supplier", "executive"]'::jsonb
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_notifications_role_check') THEN
    ALTER TABLE "event_plan_notifications"
      ADD CONSTRAINT "event_plan_notifications_role_check"
      CHECK ("audience_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_notifications_severity_check') THEN
    ALTER TABLE "event_plan_notifications"
      ADD CONSTRAINT "event_plan_notifications_severity_check"
      CHECK ("severity" IN ('info', 'attention', 'urgent'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_notification_reads_unique') THEN
    ALTER TABLE "event_plan_notification_reads"
      ADD CONSTRAINT "event_plan_notification_reads_unique"
      UNIQUE ("notification_id", "user_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_change_ack_role_check') THEN
    ALTER TABLE "event_plan_change_acknowledgements"
      ADD CONSTRAINT "event_plan_change_ack_role_check"
      CHECK ("acknowledged_by_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_plan_change_ack_user_unique') THEN
    ALTER TABLE "event_plan_change_acknowledgements"
      ADD CONSTRAINT "event_plan_change_ack_user_unique"
      UNIQUE ("change_id", "acknowledged_by");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_plan_changes_event_created_idx"
  ON "event_plan_changes" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "event_plan_changes_venue_created_idx"
  ON "event_plan_changes" ("venue_id", "created_at");
CREATE INDEX IF NOT EXISTS "event_plan_changes_config_idx"
  ON "event_plan_changes" ("configuration_id");
CREATE INDEX IF NOT EXISTS "event_plan_changes_proposal_idx"
  ON "event_plan_changes" ("proposal_id");
CREATE INDEX IF NOT EXISTS "event_plan_changes_handoff_idx"
  ON "event_plan_changes" ("handoff_pack_id");

CREATE INDEX IF NOT EXISTS "event_plan_notifications_change_idx"
  ON "event_plan_notifications" ("change_id");
CREATE INDEX IF NOT EXISTS "event_plan_notifications_venue_role_created_idx"
  ON "event_plan_notifications" ("venue_id", "audience_role", "created_at");
CREATE INDEX IF NOT EXISTS "event_plan_notifications_recipient_created_idx"
  ON "event_plan_notifications" ("recipient_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "event_plan_notification_reads_user_idx"
  ON "event_plan_notification_reads" ("user_id");
CREATE INDEX IF NOT EXISTS "event_plan_change_ack_event_idx"
  ON "event_plan_change_acknowledgements" ("event_id", "created_at");
