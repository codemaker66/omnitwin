-- -----------------------------------------------------------------------------
-- 0039_runtime_transform_artifacts
--
-- Persist reviewed TransformArtifactV0 records against runtime packages.
-- This creates a registration path only; it does not insert or imply any real
-- Trades Hall transform.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "runtime_transform_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "runtime_package_id" uuid NOT NULL REFERENCES "runtime_packages"("id") ON DELETE CASCADE,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "transform_artifact_id" varchar(120) NOT NULL,
  "transform_artifact" jsonb NOT NULL,
  "review_note" text,
  "registered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_transform_artifacts_package_artifact_unique') THEN
    ALTER TABLE "runtime_transform_artifacts"
      ADD CONSTRAINT "runtime_transform_artifacts_package_artifact_unique"
      UNIQUE ("runtime_package_id", "transform_artifact_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_transform_artifacts_venue_slug_shape') THEN
    ALTER TABLE "runtime_transform_artifacts"
      ADD CONSTRAINT "runtime_transform_artifacts_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_transform_artifacts_room_slug_shape') THEN
    ALTER TABLE "runtime_transform_artifacts"
      ADD CONSTRAINT "runtime_transform_artifacts_room_slug_shape"
      CHECK ("room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_transform_artifacts_transform_id_shape') THEN
    ALTER TABLE "runtime_transform_artifacts"
      ADD CONSTRAINT "runtime_transform_artifacts_transform_id_shape"
      CHECK ("transform_artifact_id" ~ '^[a-z0-9][a-z0-9._-]*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_transform_artifacts_json_shape') THEN
    ALTER TABLE "runtime_transform_artifacts"
      ADD CONSTRAINT "runtime_transform_artifacts_json_shape"
      CHECK (
        jsonb_typeof("transform_artifact") = 'object'
        AND "transform_artifact"->>'id' = "transform_artifact_id"
        AND "transform_artifact"->>'units' = 'meters'
        AND "transform_artifact"->>'sourceFrame' IS DISTINCT FROM "transform_artifact"->>'targetFrame'
        AND "transform_artifact"->>'alignmentMethod' IN (
          'manual_alignment',
          'icp',
          'landmark_solve',
          'matterport_e57_extraction',
          'blender_authored_placement',
          'known_pose_colmap'
        )
        AND "transform_artifact"->'reviewer'->>'actorType' = 'human'
        AND length(trim(COALESCE("transform_artifact"->'reviewer'->>'role', ''))) > 0
        AND jsonb_typeof("transform_artifact"->'provenance'->'refs') = 'array'
        AND jsonb_array_length("transform_artifact"->'provenance'->'refs') > 0
        AND jsonb_path_exists(
          "transform_artifact",
          '$.provenance.refs[*] ? (@.refType == "control_network" || @.refType == "landmark_set" || @.refType == "artifact")'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "runtime_transform_artifacts_package_idx"
  ON "runtime_transform_artifacts" ("runtime_package_id");
CREATE INDEX IF NOT EXISTS "runtime_transform_artifacts_venue_room_idx"
  ON "runtime_transform_artifacts" ("venue_slug", "room_slug");
