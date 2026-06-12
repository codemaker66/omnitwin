-- -----------------------------------------------------------------------------
-- 0030_event_day_ops
--
-- Mobile/tablet event-day execution state. This is live operational progress
-- attached to an event and its compiled handoff pack. It does not create
-- safety, legal, compliance, or certification claims.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "event_day_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "ops_task_id" uuid REFERENCES "ops_tasks"("id") ON DELETE SET NULL,
  "title" varchar(180) NOT NULL,
  "detail" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "severity" varchar(20) NOT NULL DEFAULT 'attention',
  "source" varchar(20) NOT NULL DEFAULT 'hallkeeper',
  "reported_by" uuid REFERENCES "users"("id"),
  "assigned_to" uuid REFERENCES "users"("id"),
  "escalation_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "resolved_at" timestamp with time zone
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_day_issues_status_check') THEN
    ALTER TABLE "event_day_issues" DROP CONSTRAINT "event_day_issues_status_check";
  END IF;
  ALTER TABLE "event_day_issues"
    ADD CONSTRAINT "event_day_issues_status_check"
    CHECK ("status" IN ('open', 'in_progress', 'resolved', 'closed'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_day_issues_severity_check') THEN
    ALTER TABLE "event_day_issues" DROP CONSTRAINT "event_day_issues_severity_check";
  END IF;
  ALTER TABLE "event_day_issues"
    ADD CONSTRAINT "event_day_issues_severity_check"
    CHECK ("severity" IN ('info', 'attention', 'urgent'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_day_issues_source_check') THEN
    ALTER TABLE "event_day_issues" DROP CONSTRAINT "event_day_issues_source_check";
  END IF;
  ALTER TABLE "event_day_issues"
    ADD CONSTRAINT "event_day_issues_source_check"
    CHECK ("source" IN ('hallkeeper', 'staff', 'system'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_day_issues_text_nonempty') THEN
    ALTER TABLE "event_day_issues"
      ADD CONSTRAINT "event_day_issues_text_nonempty"
      CHECK (length(trim("title")) > 0 AND length(trim("detail")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_day_issues_event_status_idx" ON "event_day_issues" ("event_id", "status");
CREATE INDEX IF NOT EXISTS "event_day_issues_phase_idx" ON "event_day_issues" ("phase_id");
CREATE INDEX IF NOT EXISTS "event_day_issues_task_idx" ON "event_day_issues" ("ops_task_id");

CREATE TABLE IF NOT EXISTS "task_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ops_task_id" uuid NOT NULL REFERENCES "ops_tasks"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "assigned_to" uuid REFERENCES "users"("id"),
  "assignee_label" varchar(160),
  "role_label" varchar(80),
  "status" varchar(20) NOT NULL DEFAULT 'assigned',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_assignments_status_check') THEN
    ALTER TABLE "task_assignments" DROP CONSTRAINT "task_assignments_status_check";
  END IF;
  ALTER TABLE "task_assignments"
    ADD CONSTRAINT "task_assignments_status_check"
    CHECK ("status" IN ('assigned', 'accepted', 'released'));
END $$;

CREATE INDEX IF NOT EXISTS "task_assignments_event_idx" ON "task_assignments" ("event_id");
CREATE INDEX IF NOT EXISTS "task_assignments_task_idx" ON "task_assignments" ("ops_task_id");
CREATE INDEX IF NOT EXISTS "task_assignments_assignee_idx" ON "task_assignments" ("assigned_to");

CREATE TABLE IF NOT EXISTS "task_completion_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ops_task_id" uuid NOT NULL REFERENCES "ops_tasks"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "from_status" varchar(20) NOT NULL,
  "to_status" varchar(20) NOT NULL,
  "idempotency_key" varchar(160),
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_completion_events_status_check') THEN
    ALTER TABLE "task_completion_events" DROP CONSTRAINT "task_completion_events_status_check";
  END IF;
  ALTER TABLE "task_completion_events"
    ADD CONSTRAINT "task_completion_events_status_check"
    CHECK (
      "from_status" IN ('todo', 'in_progress', 'done', 'blocked', 'waived')
      AND "to_status" IN ('todo', 'in_progress', 'done', 'blocked', 'waived')
    );
END $$;

CREATE INDEX IF NOT EXISTS "task_completion_events_event_idx" ON "task_completion_events" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "task_completion_events_task_idx" ON "task_completion_events" ("ops_task_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "task_completion_events_idempotency_unique"
  ON "task_completion_events" ("ops_task_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ops_status_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "kind" varchar(20) NOT NULL DEFAULT 'general',
  "message" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_status_updates_kind_check') THEN
    ALTER TABLE "ops_status_updates" DROP CONSTRAINT "ops_status_updates_kind_check";
  END IF;
  ALTER TABLE "ops_status_updates"
    ADD CONSTRAINT "ops_status_updates_kind_check"
    CHECK ("kind" IN ('phase', 'setup', 'supplier', 'escalation', 'general'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_status_updates_message_nonempty') THEN
    ALTER TABLE "ops_status_updates"
      ADD CONSTRAINT "ops_status_updates_message_nonempty"
      CHECK (length(trim("message")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ops_status_updates_event_idx" ON "ops_status_updates" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "ops_status_updates_phase_idx" ON "ops_status_updates" ("phase_id");
