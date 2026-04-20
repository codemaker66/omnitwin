-- -----------------------------------------------------------------------------
-- 0013_configuration_sheet_snapshots
--
-- Immutable snapshots of the hallkeeper sheet. When a configuration is
-- submitted for review, the server:
--
--   1. Runs the extraction pipeline
--      (placed furniture → manifest + implicit equipment requirements
--      + accessibility callouts from configuration metadata)
--   2. Canonicalises the input and computes a sha256 `source_hash`
--   3. Upserts a row here — if the hash matches the latest snapshot,
--      returns that row unchanged (idempotent re-submit of a no-op
--      edit); otherwise inserts a new version
--   4. Transitions `configurations.review_status` to 'submitted'
--
-- From that moment the snapshot is the canonical artifact shown to
-- hallkeepers. Edits to the live configuration do NOT mutate the
-- snapshot; the planner must re-submit to create a new version, and
-- staff must re-approve it.
--
-- `approved_at` / `approved_by` denormalise the approval event onto the
-- snapshot itself so the audit trail survives a configurations-row
-- delete-and-restore (both columns are null until approval; both
-- populated together, or both null — CHECK constraint below).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "configuration_sheet_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "diagram_url" text,
  "pdf_url" text,
  "source_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "created_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "config_sheet_snapshot_version_unique" UNIQUE ("configuration_id", "version"),
  CONSTRAINT "config_sheet_snapshot_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "config_sheet_snapshot_source_hash_hex" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "config_sheet_snapshot_approval_coherent" CHECK (
    ("approved_at" IS NULL AND "approved_by" IS NULL)
    OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
  )
);

-- Hot read path: "latest snapshot for this config" + "snapshot matching
-- a given hash" (idempotent re-submit lookup).
CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_config_idx"
  ON "configuration_sheet_snapshots" ("configuration_id");

CREATE INDEX IF NOT EXISTS "config_sheet_snapshots_source_hash_idx"
  ON "configuration_sheet_snapshots" ("configuration_id", "source_hash");
