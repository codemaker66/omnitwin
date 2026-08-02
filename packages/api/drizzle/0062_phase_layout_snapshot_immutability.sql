-- Frozen phase layout snapshots are evidence-bearing timeline keyframes.
-- They may only be superseded by appending a new row that references the
-- predecessor; the predecessor itself must remain byte-for-byte unchanged.

-- Event Architect has produced immutable configuration revisions with this
-- source since 0047. Preserve the two existing admitted sources and add the
-- missing producer explicitly; the named constraint remains fail-closed.
ALTER TABLE "configuration_layout_revisions"
  DROP CONSTRAINT "configuration_layout_revisions_source_check";
ALTER TABLE "configuration_layout_revisions"
  ADD CONSTRAINT "configuration_layout_revisions_source_check"
  CHECK ("source" IN ('public_batch', 'authenticated_batch', 'event_architect_candidate'));

CREATE OR REPLACE FUNCTION "reject_frozen_phase_layout_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor record;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."status" = 'frozen' THEN
    RAISE EXCEPTION 'Frozen phase layout snapshots are immutable; append a superseding row instead.'
      USING ERRCODE = '55000',
            CONSTRAINT = 'phase_layout_snapshots_frozen_immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" = 'frozen' THEN
    RAISE EXCEPTION 'Frozen phase layout snapshots must be inserted, not promoted by update.'
      USING ERRCODE = '55000',
            CONSTRAINT = 'phase_layout_snapshots_frozen_immutable';
  END IF;

  IF NEW."supersedes_snapshot_id" IS NOT NULL THEN
    SELECT "id", "event_phase_id", "status", "created_at", "frozen_at"
      INTO predecessor
      FROM "phase_layout_snapshots"
      WHERE "id" = NEW."supersedes_snapshot_id";

    IF NOT FOUND
      OR predecessor."status" <> 'frozen'
      OR predecessor."frozen_at" IS NULL
      OR predecessor."event_phase_id" <> NEW."event_phase_id"
      OR predecessor."frozen_at" >= COALESCE(NEW."frozen_at", NEW."created_at")
    THEN
      RAISE EXCEPTION 'A superseded snapshot must be an earlier frozen row for the same event phase.'
        USING ERRCODE = '23514',
              CONSTRAINT = 'phase_layout_snapshots_supersedes_lineage';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'phase_layout_snapshots_frozen_immutable'
      AND tgrelid = 'phase_layout_snapshots'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER "phase_layout_snapshots_frozen_immutable"
      BEFORE INSERT OR UPDATE OR DELETE ON "phase_layout_snapshots"
      FOR EACH ROW
      EXECUTE FUNCTION "reject_frozen_phase_layout_snapshot_mutation"();
  END IF;
END
$$;
