-- T-473: make the persisted layout coordinate contract explicit.
--
-- Before this release, placed_objects X/Z were written in editor render space
-- (real metres multiplied by two). The corrected application boundary writes
-- real metres. Historical JSON artifacts cannot be rewritten: approved sheets,
-- proposal versions, phase snapshots, and layout revision payloads are evidence
-- whose original bytes and hashes must remain stable. Their new sidecar column
-- records which coordinate contract their payload uses, while read paths adapt
-- legacy sheet payloads without mutating the stored evidence.
--
-- ACCESS EXCLUSIVE locks are intentional. They serialize the one-time live-row
-- transform with configuration saves and snapshot/version creation, so a real-
-- metre row cannot arrive between provenance labelling and the division update.

LOCK TABLE
  "placed_objects",
  "configuration_layout_revisions",
  "configuration_sheet_snapshots",
  "proposal_versions",
  "phase_layout_snapshots"
IN ACCESS EXCLUSIVE MODE;

-- Existing live rows start as legacy render space. The guarded UPDATE below is
-- idempotent if an operator has to resume a transaction after a failed deploy.
ALTER TABLE "placed_objects"
  ADD COLUMN IF NOT EXISTS "coordinate_space" varchar(32)
  NOT NULL DEFAULT 'legacy_render_v0';

-- No default is deliberate: a pre-0044 server cannot insert a placement after
-- this migration. New code supplies a fresh nonce for every X/Z insert/update.
ALTER TABLE "placed_objects"
  ADD COLUMN IF NOT EXISTS "coordinate_write_token" uuid;

-- Existing immutable artifacts are labelled, not rewritten. New artifacts use
-- the real-metre contract after the defaults are switched at the end.
ALTER TABLE "configuration_layout_revisions"
  ADD COLUMN IF NOT EXISTS "coordinate_space" varchar(32)
  NOT NULL DEFAULT 'legacy_render_v0';

ALTER TABLE "configuration_sheet_snapshots"
  ADD COLUMN IF NOT EXISTS "coordinate_space" varchar(32)
  NOT NULL DEFAULT 'legacy_render_v0';

ALTER TABLE "proposal_versions"
  ADD COLUMN IF NOT EXISTS "coordinate_space" varchar(32)
  NOT NULL DEFAULT 'legacy_render_v0';

ALTER TABLE "phase_layout_snapshots"
  ADD COLUMN IF NOT EXISTS "coordinate_space" varchar(32)
  NOT NULL DEFAULT 'legacy_render_v0';

UPDATE "placed_objects"
SET
  "position_x" = "position_x" / 2,
  "position_z" = "position_z" / 2,
  "coordinate_space" = 'real_m_v1',
  "coordinate_write_token" = COALESCE("coordinate_write_token", gen_random_uuid())
WHERE "coordinate_space" = 'legacy_render_v0';

-- A partially resumed migration may already have real-labelled rows but no
-- nonce, so finish that backfill without touching coordinates a second time.
UPDATE "placed_objects"
SET "coordinate_write_token" = gen_random_uuid()
WHERE "coordinate_write_token" IS NULL;

ALTER TABLE "placed_objects"
  ALTER COLUMN "coordinate_write_token" SET NOT NULL;

ALTER TABLE "placed_objects"
  ALTER COLUMN "coordinate_space" SET DEFAULT 'real_m_v1';
ALTER TABLE "configuration_layout_revisions"
  ALTER COLUMN "coordinate_space" SET DEFAULT 'real_m_v1';
ALTER TABLE "configuration_sheet_snapshots"
  ALTER COLUMN "coordinate_space" SET DEFAULT 'real_m_v1';
ALTER TABLE "proposal_versions"
  ALTER COLUMN "coordinate_space" SET DEFAULT 'real_m_v1';
ALTER TABLE "phase_layout_snapshots"
  ALTER COLUMN "coordinate_space" SET DEFAULT 'real_m_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'placed_objects_coordinate_space_check'
  ) THEN
    ALTER TABLE "placed_objects"
      ADD CONSTRAINT "placed_objects_coordinate_space_check"
      CHECK ("coordinate_space" = 'real_m_v1');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuration_layout_revisions_coordinate_space_check'
  ) THEN
    ALTER TABLE "configuration_layout_revisions"
      ADD CONSTRAINT "configuration_layout_revisions_coordinate_space_check"
      CHECK ("coordinate_space" IN ('legacy_render_v0', 'real_m_v1'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuration_sheet_snapshots_coordinate_space_check'
  ) THEN
    ALTER TABLE "configuration_sheet_snapshots"
      ADD CONSTRAINT "configuration_sheet_snapshots_coordinate_space_check"
      CHECK ("coordinate_space" IN ('legacy_render_v0', 'real_m_v1'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_versions_coordinate_space_check'
  ) THEN
    ALTER TABLE "proposal_versions"
      ADD CONSTRAINT "proposal_versions_coordinate_space_check"
      CHECK ("coordinate_space" IN ('legacy_render_v0', 'real_m_v1'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_coordinate_space_check'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_coordinate_space_check"
      CHECK ("coordinate_space" IN ('legacy_render_v0', 'real_m_v1'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "enforce_real_metre_coordinate_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."position_x" IS DISTINCT FROM OLD."position_x"
    OR NEW."position_z" IS DISTINCT FROM OLD."position_z"
  ) AND NEW."coordinate_write_token" IS NOT DISTINCT FROM OLD."coordinate_write_token" THEN
    RAISE EXCEPTION 'placed_objects X/Z writes require the real-metre write protocol'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "placed_objects_real_metre_write_guard" ON "placed_objects";
CREATE TRIGGER "placed_objects_real_metre_write_guard"
BEFORE UPDATE OF "position_x", "position_z" ON "placed_objects"
FOR EACH ROW
EXECUTE FUNCTION "enforce_real_metre_coordinate_write"();
