-- -----------------------------------------------------------------------------
-- 0041_capture_control_sources
--
-- Persist capture-control source evidence for room/runtime transforms. This is
-- an intake and audit path; it does not create a signed transform artifact or
-- approve any public runtime visual by itself.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "capture_control_source_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "runtime_package_id" uuid REFERENCES "runtime_packages"("id") ON DELETE SET NULL,
  "transform_artifact_id" varchar(120),
  "source_id" varchar(160) NOT NULL,
  "source_class" varchar(50) NOT NULL,
  "pose_authority_level" varchar(50) NOT NULL,
  "qa_status" varchar(40) NOT NULL,
  "source_record" jsonb NOT NULL,
  "review_note" text,
  "registered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_venue_room_source_unique') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_venue_room_source_unique"
      UNIQUE ("venue_slug", "room_slug", "source_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_venue_slug_shape') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_room_slug_shape') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_room_slug_shape"
      CHECK ("room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_source_id_shape') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_source_id_shape"
      CHECK ("source_id" ~ '^[a-z][a-z0-9]*([_:-][a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_transform_id_shape') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_transform_id_shape"
      CHECK (
        "transform_artifact_id" IS NULL
        OR "transform_artifact_id" ~ '^[a-z0-9][a-z0-9._-]*$'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_source_class_check') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_source_class_check";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_source_class_check"
    CHECK ("source_class" IN (
      'raw_structured_e57_poses',
      'matterport_api_sdk_poses',
      'colmap_poses',
      'apriltags',
      'charuco_boards',
      'manual_landmarks',
      'control_distances',
      'artist_blender_alignment_refs',
      'known_pose_colmap_model'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_pose_authority_check') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_pose_authority_check";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_pose_authority_check"
    CHECK ("pose_authority_level" IN (
      'measured_control',
      'validated_fiducial_control',
      'manual_landmark_control',
      'known_pose_colmap',
      'colmap_reconstructed',
      'visual_alignment_only'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_qa_status_check') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_qa_status_check";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_qa_status_check"
    CHECK ("qa_status" IN (
      'source_registered',
      'machine_checked',
      'requires_human_review',
      'human_reviewed',
      'accepted',
      'rejected',
      'contested',
      'stale',
      'superseded'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_authority_pair_check') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_authority_pair_check";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_authority_pair_check"
    CHECK (
      ("source_class" IN ('raw_structured_e57_poses', 'matterport_api_sdk_poses', 'control_distances') AND "pose_authority_level" = 'measured_control')
      OR ("source_class" IN ('apriltags', 'charuco_boards') AND "pose_authority_level" = 'validated_fiducial_control')
      OR ("source_class" = 'manual_landmarks' AND "pose_authority_level" = 'manual_landmark_control')
      OR ("source_class" = 'known_pose_colmap_model' AND "pose_authority_level" = 'known_pose_colmap')
      OR ("source_class" = 'colmap_poses' AND "pose_authority_level" = 'colmap_reconstructed')
      OR ("source_class" = 'artist_blender_alignment_refs' AND "pose_authority_level" = 'visual_alignment_only')
    );

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_transform_requires_package') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_transform_requires_package";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_transform_requires_package"
    CHECK ("transform_artifact_id" IS NULL OR "runtime_package_id" IS NOT NULL);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_json_shape') THEN
    ALTER TABLE "capture_control_source_records" DROP CONSTRAINT "capture_control_sources_json_shape";
  END IF;
  ALTER TABLE "capture_control_source_records"
    ADD CONSTRAINT "capture_control_sources_json_shape"
    CHECK (
      jsonb_typeof("source_record") = 'object'
      AND "source_record"->>'sourceId' = "source_id"
      AND "source_record"->>'sourceClass' = "source_class"
      AND "source_record"->>'poseAuthorityLevel' = "pose_authority_level"
      AND "source_record"->>'qaStatus' = "qa_status"
      AND jsonb_typeof("source_record"->'sourceRefs') = 'array'
      AND jsonb_array_length("source_record"->'sourceRefs') > 0
      AND jsonb_typeof("source_record"->'transformArtifactRefs') = 'array'
      AND jsonb_typeof("source_record"->'staleWhen') = 'array'
    );

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_control_sources_transform_artifact_fk') THEN
    ALTER TABLE "capture_control_source_records"
      ADD CONSTRAINT "capture_control_sources_transform_artifact_fk"
      FOREIGN KEY ("runtime_package_id", "transform_artifact_id")
      REFERENCES "runtime_transform_artifacts" ("runtime_package_id", "transform_artifact_id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "capture_control_sources_venue_room_idx"
  ON "capture_control_source_records" ("venue_slug", "room_slug");
CREATE INDEX IF NOT EXISTS "capture_control_sources_runtime_package_idx"
  ON "capture_control_source_records" ("runtime_package_id");
CREATE INDEX IF NOT EXISTS "capture_control_sources_transform_idx"
  ON "capture_control_source_records" ("runtime_package_id", "transform_artifact_id");
CREATE INDEX IF NOT EXISTS "capture_control_sources_qa_status_idx"
  ON "capture_control_source_records" ("qa_status");
