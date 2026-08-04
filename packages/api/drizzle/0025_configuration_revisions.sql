-- T-096: optimistic concurrency for planner full-sync saves.
--
-- `configurations.revision` is the compare-and-swap token used by the public
-- and authenticated batch-save endpoints. Every accepted full-layout save
-- increments it atomically before replacing placed_objects.
--
-- `configuration_layout_revisions` records each accepted draft/layout save so
-- the system has a durable edit history separate from approved hallkeeper
-- snapshots.

ALTER TABLE "configurations"
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configurations_revision_positive'
  ) THEN
    ALTER TABLE "configurations"
      ADD CONSTRAINT "configurations_revision_positive"
      CHECK ("revision" >= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "configuration_layout_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "source" varchar(40) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "configuration_layout_revisions_revision_positive" CHECK ("revision" >= 1),
  CONSTRAINT "configuration_layout_revisions_source_check" CHECK (
    "source" IN ('public_batch', 'authenticated_batch')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "configuration_layout_revisions_config_revision_unique"
  ON "configuration_layout_revisions" ("configuration_id", "revision");

CREATE INDEX IF NOT EXISTS "configuration_layout_revisions_config_created_idx"
  ON "configuration_layout_revisions" ("configuration_id", "created_at");
