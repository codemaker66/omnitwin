-- -----------------------------------------------------------------------------
-- 0024_runtime_assets
--
-- Room-agnostic foundation for real captured runtime assets. This migration
-- creates empty registry tables only. It does not insert or imply any real
-- Trades Hall asset. It also upgrades the earlier local draft shape if that
-- draft was applied before this migration contract was finalized.
-- -----------------------------------------------------------------------------

-- 1. capture_sessions -----------------------------------------------------

CREATE TABLE IF NOT EXISTS "capture_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100),
  "capture_source" varchar(30) NOT NULL,
  "capture_device" text,
  "capture_date" date,
  "operator_name" text,
  "source_project_name" text,
  "notes" text,
  "status" varchar(30) NOT NULL DEFAULT 'captured',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capture_sessions' AND column_name = 'source_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capture_sessions' AND column_name = 'capture_source'
  ) THEN
    ALTER TABLE "capture_sessions" RENAME COLUMN "source_type" TO "capture_source";
  END IF;
END $$;

ALTER TABLE "capture_sessions" ADD COLUMN IF NOT EXISTS "capture_source" varchar(30);
ALTER TABLE "capture_sessions" ADD COLUMN IF NOT EXISTS "operator_name" text;
ALTER TABLE "capture_sessions" ADD COLUMN IF NOT EXISTS "source_project_name" text;
ALTER TABLE "capture_sessions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "capture_sessions" ALTER COLUMN "capture_source" SET NOT NULL;
ALTER TABLE "capture_sessions" ALTER COLUMN "status" SET DEFAULT 'captured';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capture_sessions' AND column_name = 'operator_notes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capture_sessions' AND column_name = 'notes'
  ) THEN
    ALTER TABLE "capture_sessions" RENAME COLUMN "operator_notes" TO "notes";
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capture_sessions' AND column_name = 'operator_notes'
  ) THEN
    UPDATE "capture_sessions"
      SET "notes" = COALESCE("notes", "operator_notes");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_sessions_venue_slug_shape') THEN
    ALTER TABLE "capture_sessions"
      ADD CONSTRAINT "capture_sessions_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_sessions_room_slug_shape') THEN
    ALTER TABLE "capture_sessions"
      ADD CONSTRAINT "capture_sessions_room_slug_shape"
      CHECK ("room_slug" IS NULL OR "room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_sessions_source_type_check') THEN
    ALTER TABLE "capture_sessions" DROP CONSTRAINT "capture_sessions_source_type_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_sessions_capture_source_check') THEN
    ALTER TABLE "capture_sessions"
      ADD CONSTRAINT "capture_sessions_capture_source_check"
      CHECK ("capture_source" IN ('matterport', 'xgrids_portalcam', 'runpod', 'manual', 'other'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_sessions_status_check') THEN
    ALTER TABLE "capture_sessions" DROP CONSTRAINT "capture_sessions_status_check";
  END IF;
  ALTER TABLE "capture_sessions"
    ADD CONSTRAINT "capture_sessions_status_check"
    CHECK ("status" IN ('captured', 'uploaded', 'processing', 'processed', 'failed', 'archived'));
END $$;

CREATE INDEX IF NOT EXISTS "capture_sessions_venue_room_idx"
  ON "capture_sessions" ("venue_slug", "room_slug");
CREATE INDEX IF NOT EXISTS "capture_sessions_status_idx"
  ON "capture_sessions" ("status");

-- 2. asset_versions -------------------------------------------------------

CREATE TABLE IF NOT EXISTS "asset_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100),
  "capture_session_id" uuid REFERENCES "capture_sessions"("id") ON DELETE SET NULL,
  "asset_kind" varchar(30) NOT NULL,
  "source_type" varchar(30) NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "r2_key" text,
  "external_url" text,
  "mime_type" text,
  "sha256" varchar(64),
  "size_bytes" bigint,
  "evidence_status" varchar(20) NOT NULL DEFAULT 'unverified',
  "runtime_status" varchar(20) NOT NULL DEFAULT 'staged',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

ALTER TABLE "asset_versions" ADD COLUMN IF NOT EXISTS "external_url" text;
ALTER TABLE "asset_versions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "asset_versions" ALTER COLUMN "r2_key" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_r2_key_unique') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_r2_key_unique" UNIQUE ("r2_key");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_external_url_unique') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_external_url_unique" UNIQUE ("external_url");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_storage_ref_required') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_storage_ref_required"
      CHECK ("r2_key" IS NOT NULL OR "external_url" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_venue_slug_shape') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_room_slug_shape') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_room_slug_shape"
      CHECK ("room_slug" IS NULL OR "room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_asset_kind_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_asset_kind_check";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_asset_kind_check"
    CHECK ("asset_kind" IN ('splat', 'mesh', 'point_cloud', 'image_set', 'video', 'manifest', 'preview', 'other'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_source_type_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_source_type_check";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_source_type_check"
    CHECK ("source_type" IN ('xgrids', 'runpod', 'matterport', 'manual', 'other'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_file_ext_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_file_ext_check";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_file_ext_check"
    CHECK ("file_ext" IN (
      '.ply', '.spz', '.splat', '.ksplat', '.rad', '.radc',
      '.glb', '.gltf', '.obj', '.e57', '.las', '.laz',
      '.zip', '.json', '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov'
    ));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_evidence_status_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_evidence_status_check";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_evidence_status_check"
    CHECK ("evidence_status" IN ('unverified', 'machine_checked', 'human_reviewed', 'rejected'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_runtime_status_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_runtime_status_check";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_runtime_status_check"
    CHECK ("runtime_status" IN ('staged', 'usable', 'rejected', 'archived'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_sha256_check') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_sha256_check"
      CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_r2_key_shape') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_r2_key_shape";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_r2_key_shape"
    CHECK (
      "r2_key" IS NULL OR (
        "r2_key" !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
        AND "r2_key" NOT LIKE '/%'
        AND strpos("r2_key", E'\\') = 0
        AND "r2_key" NOT LIKE '%?%'
        AND "r2_key" NOT LIKE '%#%'
      )
    );
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_external_url_shape') THEN
    ALTER TABLE "asset_versions"
      ADD CONSTRAINT "asset_versions_external_url_shape"
      CHECK ("external_url" IS NULL OR "external_url" ~ '^https://[^[:space:]]+$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_no_fixture_keys') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_no_fixture_keys";
  END IF;
  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_no_fixture_keys"
    CHECK (
      lower(COALESCE("r2_key", '')) NOT LIKE '%textsplats%'
      AND lower(COALESCE("r2_key", '')) NOT LIKE '%text-splats%'
      AND lower(COALESCE("r2_key", '')) NOT LIKE '%spark-fixture%'
      AND lower(COALESCE("r2_key", '')) NOT LIKE '%splat-fixture%'
      AND lower(COALESCE("r2_key", '')) NOT LIKE '%fixture%'
      AND lower(COALESCE("r2_key", '')) NOT LIKE '%demo%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%textsplats%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%text-splats%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%spark-fixture%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%splat-fixture%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%fixture%'
      AND lower(COALESCE("external_url", '')) NOT LIKE '%demo%'
    );
END $$;

CREATE INDEX IF NOT EXISTS "asset_versions_venue_room_idx"
  ON "asset_versions" ("venue_slug", "room_slug");
CREATE INDEX IF NOT EXISTS "asset_versions_capture_session_idx"
  ON "asset_versions" ("capture_session_id");
CREATE INDEX IF NOT EXISTS "asset_versions_runtime_status_idx"
  ON "asset_versions" ("runtime_status");

-- 3. room_manifests -------------------------------------------------------

CREATE TABLE IF NOT EXISTS "room_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "display_name" text NOT NULL,
  "matterport_master_reference" text,
  "alignment_status" varchar(20) NOT NULL DEFAULT 'unaligned',
  "primary_capture_source" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

ALTER TABLE "room_manifests" ADD COLUMN IF NOT EXISTS "primary_capture_source" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_manifests_venue_room_unique') THEN
    ALTER TABLE "room_manifests"
      ADD CONSTRAINT "room_manifests_venue_room_unique" UNIQUE ("venue_slug", "room_slug");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_manifests_venue_slug_shape') THEN
    ALTER TABLE "room_manifests"
      ADD CONSTRAINT "room_manifests_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_manifests_room_slug_shape') THEN
    ALTER TABLE "room_manifests"
      ADD CONSTRAINT "room_manifests_room_slug_shape"
      CHECK ("room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_manifests_alignment_status_check') THEN
    ALTER TABLE "room_manifests" DROP CONSTRAINT "room_manifests_alignment_status_check";
  END IF;
  ALTER TABLE "room_manifests"
    ADD CONSTRAINT "room_manifests_alignment_status_check"
    CHECK ("alignment_status" IN ('unaligned', 'approximate', 'aligned', 'verified'));
END $$;

CREATE INDEX IF NOT EXISTS "room_manifests_alignment_idx"
  ON "room_manifests" ("alignment_status");

-- 4. runtime_packages -----------------------------------------------------

CREATE TABLE IF NOT EXISTS "runtime_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "primary_visual_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL,
  "semantic_mesh_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL,
  "collision_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL,
  "point_cloud_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL,
  "manifest_json" jsonb NOT NULL,
  "evidence_status" varchar(20) NOT NULL DEFAULT 'unverified',
  "runtime_status" varchar(20) NOT NULL DEFAULT 'draft',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

ALTER TABLE "runtime_packages" ADD COLUMN IF NOT EXISTS "point_cloud_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL;
ALTER TABLE "runtime_packages" ALTER COLUMN "runtime_status" SET DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_venue_slug_shape') THEN
    ALTER TABLE "runtime_packages"
      ADD CONSTRAINT "runtime_packages_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_room_slug_shape') THEN
    ALTER TABLE "runtime_packages"
      ADD CONSTRAINT "runtime_packages_room_slug_shape"
      CHECK ("room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_evidence_status_check') THEN
    ALTER TABLE "runtime_packages" DROP CONSTRAINT "runtime_packages_evidence_status_check";
  END IF;
  ALTER TABLE "runtime_packages"
    ADD CONSTRAINT "runtime_packages_evidence_status_check"
    CHECK ("evidence_status" IN ('unverified', 'machine_checked', 'human_reviewed', 'rejected'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_runtime_status_check') THEN
    ALTER TABLE "runtime_packages" DROP CONSTRAINT "runtime_packages_runtime_status_check";
  END IF;
  ALTER TABLE "runtime_packages"
    ADD CONSTRAINT "runtime_packages_runtime_status_check"
    CHECK ("runtime_status" IN ('draft', 'internal_ready', 'published', 'archived'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_manifest_shape') THEN
    ALTER TABLE "runtime_packages" DROP CONSTRAINT "runtime_packages_manifest_shape";
  END IF;
  ALTER TABLE "runtime_packages"
    ADD CONSTRAINT "runtime_packages_manifest_shape"
    CHECK (
      "manifest_json"->>'schemaVersion' = 'venviewer.runtime-package.v1'
      AND "manifest_json"->>'packageType' = 'room-runtime'
      AND "manifest_json"->>'venueSlug' = "venue_slug"
      AND "manifest_json"->>'roomSlug' = "room_slug"
      AND jsonb_typeof("manifest_json"->'assets') = 'object'
    );
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_usable_primary_visual_check') THEN
    ALTER TABLE "runtime_packages" DROP CONSTRAINT "runtime_packages_usable_primary_visual_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_packages_loadable_primary_visual_check') THEN
    ALTER TABLE "runtime_packages"
      ADD CONSTRAINT "runtime_packages_loadable_primary_visual_check"
      CHECK ("runtime_status" NOT IN ('internal_ready', 'published') OR "primary_visual_asset_version_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "runtime_packages_venue_room_status_idx"
  ON "runtime_packages" ("venue_slug", "room_slug", "runtime_status");
CREATE INDEX IF NOT EXISTS "runtime_packages_primary_visual_idx"
  ON "runtime_packages" ("primary_visual_asset_version_id");
CREATE INDEX IF NOT EXISTS "runtime_packages_point_cloud_idx"
  ON "runtime_packages" ("point_cloud_asset_version_id");

-- 5. processing_jobs ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "processing_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100),
  "source_asset_version_id" uuid REFERENCES "asset_versions"("id") ON DELETE SET NULL,
  "target_room_slug" varchar(100),
  "processor" varchar(30) NOT NULL,
  "machine_type" text,
  "required_ram_gb" numeric(6, 2),
  "status" varchar(30) NOT NULL DEFAULT 'planned',
  "output_notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_venue_slug_shape') THEN
    ALTER TABLE "processing_jobs"
      ADD CONSTRAINT "processing_jobs_venue_slug_shape"
      CHECK ("venue_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_room_slug_shape') THEN
    ALTER TABLE "processing_jobs"
      ADD CONSTRAINT "processing_jobs_room_slug_shape"
      CHECK ("room_slug" IS NULL OR "room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_target_room_slug_shape') THEN
    ALTER TABLE "processing_jobs"
      ADD CONSTRAINT "processing_jobs_target_room_slug_shape"
      CHECK ("target_room_slug" IS NULL OR "target_room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_processor_check') THEN
    ALTER TABLE "processing_jobs"
      ADD CONSTRAINT "processing_jobs_processor_check"
      CHECK ("processor" IN ('lixel_cybercolor', 'runpod', 'custom', 'manual', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_status_check') THEN
    ALTER TABLE "processing_jobs"
      ADD CONSTRAINT "processing_jobs_status_check"
      CHECK ("status" IN ('planned', 'running', 'complete', 'failed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "processing_jobs_venue_room_idx"
  ON "processing_jobs" ("venue_slug", "room_slug");
CREATE INDEX IF NOT EXISTS "processing_jobs_source_asset_idx"
  ON "processing_jobs" ("source_asset_version_id");
CREATE INDEX IF NOT EXISTS "processing_jobs_status_idx"
  ON "processing_jobs" ("status");
