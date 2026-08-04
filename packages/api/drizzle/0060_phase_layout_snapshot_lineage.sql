-- Wave E phase keyframe producer lineage.
--
-- Existing rows remain readable. New producer rows persist the exact canonical
-- snapshot, validator proof, authenticated actor, and immutable predecessor
-- used at the append boundary. The copied canonical payload remains the
-- timeline render subject if an upstream configuration is later removed.

ALTER TABLE "phase_layout_snapshots"
  ADD COLUMN IF NOT EXISTS "canonical_snapshot_id" uuid,
  ADD COLUMN IF NOT EXISTS "proof_digest" varchar(64),
  ADD COLUMN IF NOT EXISTS "supersedes_snapshot_id" uuid,
  ADD COLUMN IF NOT EXISTS "frozen_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_canonical_snapshot_fk'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_canonical_snapshot_fk"
      FOREIGN KEY ("canonical_snapshot_id")
      REFERENCES "canonical_layout_snapshots" ("id")
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_proof_digest_fk'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_proof_digest_fk"
      FOREIGN KEY ("proof_digest")
      REFERENCES "layout_validation_runs" ("proof_digest")
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_supersedes_fk'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_supersedes_fk"
      FOREIGN KEY ("supersedes_snapshot_id")
      REFERENCES "phase_layout_snapshots" ("id")
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_frozen_by_fk'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_frozen_by_fk"
      FOREIGN KEY ("frozen_by")
      REFERENCES "users" ("id")
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_proof_digest_shape'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_proof_digest_shape"
      CHECK (
        "proof_digest" IS NULL
        OR "proof_digest" ~ '^[a-f0-9]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phase_layout_snapshots_no_self_supersession'
  ) THEN
    ALTER TABLE "phase_layout_snapshots"
      ADD CONSTRAINT "phase_layout_snapshots_no_self_supersession"
      CHECK (
        "supersedes_snapshot_id" IS NULL
        OR "supersedes_snapshot_id" <> "id"
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "phase_layout_snapshots_canonical_idx"
  ON "phase_layout_snapshots" ("canonical_snapshot_id");

CREATE INDEX IF NOT EXISTS "phase_layout_snapshots_supersedes_idx"
  ON "phase_layout_snapshots" ("supersedes_snapshot_id");
