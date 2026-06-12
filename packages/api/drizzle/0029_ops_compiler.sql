-- -----------------------------------------------------------------------------
-- 0029_ops_compiler
--
-- Ops Compiler v1. Persists internal handoff artifacts compiled from approved
-- configuration sheet snapshots and optional event phase context. These rows are
-- not event-day live status and do not represent safety, legal, or compliance
-- approval.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "handoff_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "config_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "snapshot_id" uuid NOT NULL REFERENCES "configuration_sheet_snapshots"("id") ON DELETE CASCADE,
  "snapshot_hash" varchar(64) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "status" varchar(20) NOT NULL DEFAULT 'compiled',
  "source_label" varchar(200) NOT NULL,
  "summary" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "compiled_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_snapshot_version_unique') THEN
    ALTER TABLE "handoff_packs"
      ADD CONSTRAINT "handoff_packs_snapshot_version_unique"
      UNIQUE ("snapshot_id", "version");
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_status_check') THEN
    ALTER TABLE "handoff_packs" DROP CONSTRAINT "handoff_packs_status_check";
  END IF;
  ALTER TABLE "handoff_packs"
    ADD CONSTRAINT "handoff_packs_status_check"
    CHECK ("status" IN ('compiled', 'superseded', 'stale', 'exported'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_snapshot_hash_check') THEN
    ALTER TABLE "handoff_packs"
      ADD CONSTRAINT "handoff_packs_snapshot_hash_check"
      CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_version_positive') THEN
    ALTER TABLE "handoff_packs"
      ADD CONSTRAINT "handoff_packs_version_positive"
      CHECK ("version" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packs_text_nonempty') THEN
    ALTER TABLE "handoff_packs"
      ADD CONSTRAINT "handoff_packs_text_nonempty"
      CHECK (length(trim("source_label")) > 0 AND length(trim("summary")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "handoff_packs_config_idx" ON "handoff_packs" ("config_id");
CREATE INDEX IF NOT EXISTS "handoff_packs_event_idx" ON "handoff_packs" ("event_id");
CREATE INDEX IF NOT EXISTS "handoff_packs_status_idx" ON "handoff_packs" ("status");

CREATE TABLE IF NOT EXISTS "task_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "kind" varchar(30) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_groups_kind_check') THEN
    ALTER TABLE "task_groups" DROP CONSTRAINT "task_groups_kind_check";
  END IF;
  ALTER TABLE "task_groups"
    ADD CONSTRAINT "task_groups_kind_check"
    CHECK ("kind" IN ('setup', 'breakdown', 'room_flip', 'supplier', 'review'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_groups_order_nonneg') THEN
    ALTER TABLE "task_groups"
      ADD CONSTRAINT "task_groups_order_nonneg"
      CHECK ("sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "task_groups_pack_order_idx" ON "task_groups" ("handoff_pack_id", "sort_order");

CREATE TABLE IF NOT EXISTS "ops_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "task_group_id" uuid REFERENCES "task_groups"("id") ON DELETE SET NULL,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "kind" varchar(30) NOT NULL,
  "title" varchar(240) NOT NULL,
  "detail" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'todo',
  "sort_order" integer NOT NULL DEFAULT 0,
  "due_label" varchar(120),
  "source_ref" varchar(300),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_kind_check') THEN
    ALTER TABLE "ops_tasks" DROP CONSTRAINT "ops_tasks_kind_check";
  END IF;
  ALTER TABLE "ops_tasks"
    ADD CONSTRAINT "ops_tasks_kind_check"
    CHECK ("kind" IN ('setup', 'breakdown', 'room_flip', 'supplier', 'review_gate', 'note'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_status_check') THEN
    ALTER TABLE "ops_tasks" DROP CONSTRAINT "ops_tasks_status_check";
  END IF;
  ALTER TABLE "ops_tasks"
    ADD CONSTRAINT "ops_tasks_status_check"
    CHECK ("status" IN ('todo', 'in_progress', 'done', 'blocked', 'waived'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_order_nonneg') THEN
    ALTER TABLE "ops_tasks"
      ADD CONSTRAINT "ops_tasks_order_nonneg"
      CHECK ("sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ops_tasks_pack_order_idx" ON "ops_tasks" ("handoff_pack_id", "sort_order");
CREATE INDEX IF NOT EXISTS "ops_tasks_group_idx" ON "ops_tasks" ("task_group_id");
CREATE INDEX IF NOT EXISTS "ops_tasks_status_idx" ON "ops_tasks" ("status");

CREATE TABLE IF NOT EXISTS "furniture_pick_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "total_items" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'furniture_pick_lists_pack_unique') THEN
    ALTER TABLE "furniture_pick_lists"
      ADD CONSTRAINT "furniture_pick_lists_pack_unique"
      UNIQUE ("handoff_pack_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'furniture_pick_lists_total_nonneg') THEN
    ALTER TABLE "furniture_pick_lists"
      ADD CONSTRAINT "furniture_pick_lists_total_nonneg"
      CHECK ("total_items" >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "pick_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pick_list_id" uuid NOT NULL REFERENCES "furniture_pick_lists"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "category" varchar(80) NOT NULL,
  "quantity" integer NOT NULL DEFAULT 0,
  "source_phase" varchar(80),
  "source_zone" varchar(80),
  "notes" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pick_list_items_counts_nonneg') THEN
    ALTER TABLE "pick_list_items"
      ADD CONSTRAINT "pick_list_items_counts_nonneg"
      CHECK ("quantity" >= 0 AND "sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pick_list_items_list_order_idx" ON "pick_list_items" ("pick_list_id", "sort_order");

CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE SET NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(80) NOT NULL,
  "contact_name" varchar(160),
  "email" varchar(255),
  "phone" varchar(40),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "suppliers_venue_category_idx" ON "suppliers" ("venue_id", "category");

CREATE TABLE IF NOT EXISTS "supplier_instructions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "category" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "detail" text NOT NULL,
  "arrival_window" varchar(120),
  "source_ref" varchar(300),
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_instructions_order_nonneg') THEN
    ALTER TABLE "supplier_instructions"
      ADD CONSTRAINT "supplier_instructions_order_nonneg"
      CHECK ("sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "supplier_instructions_pack_order_idx" ON "supplier_instructions" ("handoff_pack_id", "sort_order");
CREATE INDEX IF NOT EXISTS "supplier_instructions_supplier_idx" ON "supplier_instructions" ("supplier_id");

CREATE TABLE IF NOT EXISTS "load_in_sequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "step_number" integer NOT NULL,
  "title" varchar(200) NOT NULL,
  "detail" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "breakdown_sequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "step_number" integer NOT NULL,
  "title" varchar(200) NOT NULL,
  "detail" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'load_in_sequences_order_check') THEN
    ALTER TABLE "load_in_sequences"
      ADD CONSTRAINT "load_in_sequences_order_check"
      CHECK ("step_number" > 0 AND "sort_order" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'breakdown_sequences_order_check') THEN
    ALTER TABLE "breakdown_sequences"
      ADD CONSTRAINT "breakdown_sequences_order_check"
      CHECK ("step_number" > 0 AND "sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "load_in_sequences_pack_order_idx" ON "load_in_sequences" ("handoff_pack_id", "sort_order");
CREATE INDEX IF NOT EXISTS "breakdown_sequences_pack_order_idx" ON "breakdown_sequences" ("handoff_pack_id", "sort_order");

CREATE TABLE IF NOT EXISTS "room_flip_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "phase_id" uuid REFERENCES "event_phases"("id") ON DELETE SET NULL,
  "from_phase_label" varchar(120),
  "to_phase_label" varchar(120),
  "duration_minutes" integer NOT NULL DEFAULT 0,
  "task_count" integer NOT NULL DEFAULT 0,
  "review_gate_count" integer NOT NULL DEFAULT 0,
  "notes" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_flip_plans_counts_nonneg') THEN
    ALTER TABLE "room_flip_plans"
      ADD CONSTRAINT "room_flip_plans_counts_nonneg"
      CHECK ("duration_minutes" >= 0 AND "task_count" >= 0 AND "review_gate_count" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "room_flip_plans_pack_idx" ON "room_flip_plans" ("handoff_pack_id");
CREATE INDEX IF NOT EXISTS "room_flip_plans_phase_idx" ON "room_flip_plans" ("phase_id");

CREATE TABLE IF NOT EXISTS "beo_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "source_snapshot_hash" varchar(64) NOT NULL,
  "safe_status" varchar(60) NOT NULL DEFAULT 'internal_operations_handoff',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beo_documents_pack_unique') THEN
    ALTER TABLE "beo_documents"
      ADD CONSTRAINT "beo_documents_pack_unique"
      UNIQUE ("handoff_pack_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beo_documents_snapshot_hash_check') THEN
    ALTER TABLE "beo_documents"
      ADD CONSTRAINT "beo_documents_snapshot_hash_check"
      CHECK ("source_snapshot_hash" ~ '^[a-f0-9]{64}$');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beo_documents_safe_status_check') THEN
    ALTER TABLE "beo_documents" DROP CONSTRAINT "beo_documents_safe_status_check";
  END IF;
  ALTER TABLE "beo_documents"
    ADD CONSTRAINT "beo_documents_safe_status_check"
    CHECK ("safe_status" = 'internal_operations_handoff');
END $$;

CREATE TABLE IF NOT EXISTS "snapshot_diffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "previous_snapshot_hash" varchar(64),
  "current_snapshot_hash" varchar(64) NOT NULL,
  "added_count" integer NOT NULL DEFAULT 0,
  "removed_count" integer NOT NULL DEFAULT 0,
  "changed_count" integer NOT NULL DEFAULT 0,
  "summary" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_diffs_pack_unique') THEN
    ALTER TABLE "snapshot_diffs"
      ADD CONSTRAINT "snapshot_diffs_pack_unique"
      UNIQUE ("handoff_pack_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_diffs_hash_shape') THEN
    ALTER TABLE "snapshot_diffs"
      ADD CONSTRAINT "snapshot_diffs_hash_shape"
      CHECK (
        "current_snapshot_hash" ~ '^[a-f0-9]{64}$'
        AND ("previous_snapshot_hash" IS NULL OR "previous_snapshot_hash" ~ '^[a-f0-9]{64}$')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_diffs_counts_nonneg') THEN
    ALTER TABLE "snapshot_diffs"
      ADD CONSTRAINT "snapshot_diffs_counts_nonneg"
      CHECK ("added_count" >= 0 AND "removed_count" >= 0 AND "changed_count" >= 0);
  END IF;
END $$;
