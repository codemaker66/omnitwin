-- -----------------------------------------------------------------------------
-- 0024_runtime_assets
--
-- Adds the runtime visual-asset provenance layer (T-091 groundwork — does NOT
-- complete T-091/T-091A; that requires a real captured asset actually loading
-- in runtime, verified by a human).
--
--   1. asset_versions — the provenance record for one processed visual asset
--      (a Gaussian-splat bundle staged in R2). `evidence_status` is the only
--      trust signal and is deliberately honest: 'unverified' | 'machine_checked'
--      | 'human_reviewed'. It NEVER asserts legal/safety certification.
--
--   2. runtime_packages — a publishable pointer that exposes an AssetVersion to
--      the runtime renderer. Only status='published' rows are served; the
--      renderer loads the latest published package and otherwise falls back to
--      the procedural room.
--
-- Both tables start empty. No backfill — there is no real Trades Hall capture
-- yet, and fixture/demo keys are rejected at the API boundary, never inserted.
-- -----------------------------------------------------------------------------

-- 1. asset_versions -------------------------------------------------------

CREATE TABLE IF NOT EXISTS "asset_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid REFERENCES "spaces"("id"),
  "source" varchar(30) NOT NULL,
  "r2_key" text NOT NULL,
  "splat_extension" varchar(10) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "capture_date" date,
  "evidence_status" varchar(20) NOT NULL DEFAULT 'unverified',
  "size_bytes" integer,
  "label" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "asset_versions_source_check"
    CHECK ("source" IN ('runpod', 'xgrids', 'matterport', 'manual')),
  CONSTRAINT "asset_versions_evidence_status_check"
    CHECK ("evidence_status" IN ('unverified', 'machine_checked', 'human_reviewed')),
  CONSTRAINT "asset_versions_sha256_check"
    CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS "asset_versions_venue_idx"
  ON "asset_versions" ("venue_id");
CREATE INDEX IF NOT EXISTS "asset_versions_space_idx"
  ON "asset_versions" ("space_id");

-- 2. runtime_packages -----------------------------------------------------

CREATE TABLE IF NOT EXISTS "runtime_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid REFERENCES "spaces"("id"),
  "asset_version_id" uuid NOT NULL REFERENCES "asset_versions"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "label" text,
  "published_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "runtime_packages_status_check"
    CHECK ("status" IN ('draft', 'published', 'retired'))
);

CREATE INDEX IF NOT EXISTS "runtime_packages_venue_status_idx"
  ON "runtime_packages" ("venue_id", "status");

-- Hot read: latest published package by published_at desc.
CREATE INDEX IF NOT EXISTS "runtime_packages_published_idx"
  ON "runtime_packages" ("status", "published_at");
