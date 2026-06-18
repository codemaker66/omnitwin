-- -----------------------------------------------------------------------------
-- 0040_runtime_qa_records
--
-- Persist reviewed runtime QA/exposure records against runtime packages. This
-- creates the public-exposure gate; it does not insert or imply any approved
-- public Trades Hall runtime visual.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "runtime_qa_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "runtime_package_id" uuid NOT NULL REFERENCES "runtime_packages"("id") ON DELETE CASCADE,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "record_id" varchar(120) NOT NULL,
  "record_json" jsonb NOT NULL,
  "signed_transform_artifact_id" varchar(120),
  "public_exposure_decision" varchar(40) NOT NULL,
  "asset_evidence_status" varchar(20) NOT NULL,
  "runtime_status" varchar(20) NOT NULL,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE "runtime_qa_records"
    ADD COLUMN IF NOT EXISTS "signed_transform_artifact_id" varchar(120);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_package_record_unique') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_package_record_unique"
      UNIQUE ("runtime_package_id", "record_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_venue_slug_shape') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_room_slug_shape') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_room_slug_shape"
      CHECK ("room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_record_id_shape') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_record_id_shape"
      CHECK ("record_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_signed_transform_id_shape') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_signed_transform_id_shape"
      CHECK (
        "signed_transform_artifact_id" IS NULL
        OR "signed_transform_artifact_id" ~ '^[a-z0-9][a-z0-9._-]*$'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_public_exposure_check') THEN
    ALTER TABLE "runtime_qa_records" DROP CONSTRAINT "runtime_qa_records_public_exposure_check";
  END IF;
  ALTER TABLE "runtime_qa_records"
    ADD CONSTRAINT "runtime_qa_records_public_exposure_check"
    CHECK ("public_exposure_decision" IN ('blocked_internal_only', 'approved_internal_preview', 'approved_public'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_asset_evidence_status_check') THEN
    ALTER TABLE "runtime_qa_records" DROP CONSTRAINT "runtime_qa_records_asset_evidence_status_check";
  END IF;
  ALTER TABLE "runtime_qa_records"
    ADD CONSTRAINT "runtime_qa_records_asset_evidence_status_check"
    CHECK ("asset_evidence_status" IN ('unverified', 'machine_checked', 'human_reviewed', 'rejected'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_runtime_status_check') THEN
    ALTER TABLE "runtime_qa_records" DROP CONSTRAINT "runtime_qa_records_runtime_status_check";
  END IF;
  ALTER TABLE "runtime_qa_records"
    ADD CONSTRAINT "runtime_qa_records_runtime_status_check"
    CHECK ("runtime_status" IN ('draft', 'internal_ready', 'published', 'archived'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_json_shape') THEN
    ALTER TABLE "runtime_qa_records" DROP CONSTRAINT "runtime_qa_records_json_shape";
  END IF;
  ALTER TABLE "runtime_qa_records"
    ADD CONSTRAINT "runtime_qa_records_json_shape"
    CHECK (
      jsonb_typeof("record_json") = 'object'
      AND "record_json"->>'schemaVersion' = 'runtime-qa-record.v0'
      AND "record_json"->>'recordId' = "record_id"
      AND "record_json"->>'runtimePackageId' = "runtime_package_id"::text
      AND "record_json"->>'venueSlug' = "venue_slug"
      AND "record_json"->>'roomSlug' = "room_slug"
      AND "record_json"->>'assetEvidenceStatus' = "asset_evidence_status"
      AND "record_json"->>'runtimeStatus' = "runtime_status"
      AND "record_json"->'publicExposure'->>'decision' = "public_exposure_decision"
      AND ("record_json"->'viewTransform'->>'signedTransformArtifactId')
        IS NOT DISTINCT FROM "signed_transform_artifact_id"
    );

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_signed_transform_artifact_fk') THEN
    ALTER TABLE "runtime_qa_records"
      ADD CONSTRAINT "runtime_qa_records_signed_transform_artifact_fk"
      FOREIGN KEY ("runtime_package_id", "signed_transform_artifact_id")
      REFERENCES "runtime_transform_artifacts" ("runtime_package_id", "transform_artifact_id")
      ON DELETE RESTRICT;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_qa_records_public_gate') THEN
    ALTER TABLE "runtime_qa_records" DROP CONSTRAINT "runtime_qa_records_public_gate";
  END IF;
  ALTER TABLE "runtime_qa_records"
    ADD CONSTRAINT "runtime_qa_records_public_gate"
    CHECK (
      "public_exposure_decision" <> 'approved_public'
      OR (
        "asset_evidence_status" = 'human_reviewed'
        AND "record_json"->'viewTransform'->>'posture' = 'signed_room_local_transform'
        AND "signed_transform_artifact_id" IS NOT NULL
        AND jsonb_path_exists(
          "record_json",
          '$.checks[*] ? (@.checkKey == "public_exposure_review" && @.status == "passed")'
        )
      )
    );
END $$;

CREATE INDEX IF NOT EXISTS "runtime_qa_records_package_idx"
  ON "runtime_qa_records" ("runtime_package_id");
CREATE INDEX IF NOT EXISTS "runtime_qa_records_venue_room_idx"
  ON "runtime_qa_records" ("venue_slug", "room_slug");
CREATE INDEX IF NOT EXISTS "runtime_qa_records_signed_transform_idx"
  ON "runtime_qa_records" ("runtime_package_id", "signed_transform_artifact_id");
CREATE INDEX IF NOT EXISTS "runtime_qa_records_public_exposure_idx"
  ON "runtime_qa_records" ("public_exposure_decision");
