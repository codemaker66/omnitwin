-- Exact historical runtime admission is captured on the immutable phase row.
-- Existing frozen rows remain explicitly legacy-unbound; they are never
-- backfilled from a newer package. New producers record either one complete
-- reviewed-presentation receipt or one immutable unavailable decision in the
-- same transaction that inserts the frozen layout snapshot.

ALTER TABLE "runtime_packages"
  ADD CONSTRAINT "runtime_packages_id_digest_unique"
  UNIQUE ("id", "content_digest");

ALTER TABLE "phase_layout_snapshots"
  ADD COLUMN "runtime_binding_state" varchar(24) NOT NULL DEFAULT 'legacy_unbound',
  ADD COLUMN "runtime_binding_digest" varchar(64),
  ADD COLUMN "runtime_binding" jsonb,
  ADD COLUMN "runtime_package_id" uuid,
  ADD COLUMN "runtime_package_content_digest" varchar(64),
  ADD COLUMN "runtime_qa_record_id" uuid,
  ADD COLUMN "runtime_transform_artifact_row_id" uuid;

ALTER TABLE "phase_layout_snapshots"
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_state_check"
    CHECK ("runtime_binding_state" IN ('legacy_unbound', 'available', 'unavailable')),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_digest_shape"
    CHECK (
      "runtime_binding_digest" IS NULL
      OR "runtime_binding_digest" ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_package_digest_shape"
    CHECK (
      "runtime_package_content_digest" IS NULL
      OR "runtime_package_content_digest" ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_coherent"
    CHECK (
      (
        "runtime_binding_state" = 'legacy_unbound'
        AND "runtime_binding_digest" IS NULL
        AND "runtime_binding" IS NULL
        AND "runtime_package_id" IS NULL
        AND "runtime_package_content_digest" IS NULL
        AND "runtime_qa_record_id" IS NULL
        AND "runtime_transform_artifact_row_id" IS NULL
      )
      OR
      (
        "runtime_binding_state" = 'unavailable'
        AND "status" = 'frozen'
        AND "frozen_at" IS NOT NULL
        AND "runtime_binding_digest" IS NOT NULL
        AND jsonb_typeof("runtime_binding") = 'object'
        AND "runtime_package_id" IS NULL
        AND "runtime_package_content_digest" IS NULL
        AND "runtime_qa_record_id" IS NULL
        AND "runtime_transform_artifact_row_id" IS NULL
      )
      OR
      (
        "runtime_binding_state" = 'available'
        AND "status" = 'frozen'
        AND "frozen_at" IS NOT NULL
        AND "runtime_binding_digest" IS NOT NULL
        AND jsonb_typeof("runtime_binding") = 'object'
        AND "runtime_package_id" IS NOT NULL
        AND "runtime_package_content_digest" IS NOT NULL
        AND "runtime_qa_record_id" IS NOT NULL
        AND "runtime_transform_artifact_row_id" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_json_identity"
    CHECK (
      "runtime_binding_state" = 'legacy_unbound'
      OR (
        "runtime_binding"->>'schemaVersion' = 'phase-layout-runtime-binding.v1'
        AND "runtime_binding"->>'admissionPolicy' = 'trades-hall-reviewed-presentation.v1'
        AND "runtime_binding"->>'bindingId' = "id"::text
        AND "runtime_binding"->>'phaseLayoutSnapshotId' = "id"::text
        AND "runtime_binding"->>'canonicalSnapshotId' = "canonical_snapshot_id"::text
        AND "runtime_binding"->>'snapshotHash' = "snapshot_hash"
        AND "runtime_binding"->>'boundBy' = "frozen_by"::text
        AND "runtime_binding"->>'availability' = "runtime_binding_state"
        AND "runtime_binding"->>'bindingDigest' = "runtime_binding_digest"
      )
    ),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_package_identity"
    CHECK (
      "runtime_binding_state" <> 'available'
      OR (
        "runtime_binding"->>'runtimePackageId' = "runtime_package_id"::text
        AND "runtime_binding"->>'runtimePackageContentDigest' = "runtime_package_content_digest"
      )
    ),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_package_digest_fk"
    FOREIGN KEY ("runtime_package_id", "runtime_package_content_digest")
    REFERENCES "runtime_packages" ("id", "content_digest")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_qa_record_fk"
    FOREIGN KEY ("runtime_qa_record_id")
    REFERENCES "runtime_qa_records" ("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_transform_artifact_fk"
    FOREIGN KEY ("runtime_transform_artifact_row_id")
    REFERENCES "runtime_transform_artifacts" ("id")
    ON DELETE RESTRICT;

CREATE INDEX "phase_layout_snapshots_runtime_package_idx"
  ON "phase_layout_snapshots" ("runtime_package_id");

CREATE INDEX "phase_layout_snapshots_runtime_binding_state_idx"
  ON "phase_layout_snapshots" ("runtime_binding_state");
