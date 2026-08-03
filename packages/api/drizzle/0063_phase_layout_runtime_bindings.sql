-- Exact historical runtime admission is captured on the immutable phase row.
-- Existing frozen rows remain explicitly legacy-unbound; they are never
-- backfilled from a newer package. New producers record either one complete
-- reviewed-presentation receipt or one immutable unavailable decision in the
-- same transaction that inserts the frozen layout snapshot.

ALTER TABLE "runtime_packages"
  ADD CONSTRAINT "runtime_packages_id_digest_unique"
  UNIQUE ("id", "content_digest"),
  ADD CONSTRAINT "runtime_packages_id_scope_digest_unique"
  UNIQUE ("id", "venue_slug", "room_slug", "content_digest");

ALTER TABLE "asset_versions"
  ADD CONSTRAINT "asset_versions_exact_runtime_member_unique"
  UNIQUE (
    "id", "venue_slug", "room_slug", "file_name", "file_ext",
    "mime_type", "sha256", "size_bytes"
  ),
  ADD CONSTRAINT "asset_versions_runtime_byte_identity_unique"
  UNIQUE ("id", "venue_slug", "room_slug", "sha256", "size_bytes");

-- Legacy evidence remains readable but is deliberately ineligible until it
-- has an exact digest and authenticated review time. All new API writes set
-- these columns. The rows become append-only below.
ALTER TABLE "runtime_transform_artifacts"
  ADD COLUMN "artifact_digest" varchar(64),
  ADD CONSTRAINT "runtime_transform_artifacts_digest_shape"
    CHECK ("artifact_digest" IS NULL OR "artifact_digest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "runtime_transform_artifacts_exact_binding_unique"
    UNIQUE (
      "id", "runtime_package_id", "venue_slug", "room_slug",
      "transform_artifact_id", "artifact_digest"
    );

ALTER TABLE "runtime_qa_records"
  ADD COLUMN "record_digest" varchar(64),
  ADD COLUMN "reviewed_at" timestamp with time zone,
  ADD CONSTRAINT "runtime_qa_records_digest_shape"
    CHECK ("record_digest" IS NULL OR "record_digest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "runtime_qa_records_review_time_matches_body"
    CHECK ((
      "reviewed_at" IS NULL
      OR (
        jsonb_typeof("record_json"->'recordedAt') = 'string'
        AND ("record_json"->>'recordedAt')::timestamp with time zone = "reviewed_at"
      )
    ) IS TRUE),
  ADD CONSTRAINT "runtime_qa_records_exact_binding_unique"
    UNIQUE (
      "id", "runtime_package_id", "venue_slug", "room_slug", "record_id",
      "record_digest", "public_exposure_decision", "reviewed_by", "reviewed_at"
    );

ALTER TABLE "reconstruction_review_evidence_artifacts"
  ADD CONSTRAINT "reconstruction_review_evidence_exact_runtime_unique"
  UNIQUE ("id", "venue_slug", "artifact_kind", "artifact_id", "artifact_digest");

CREATE TABLE "runtime_presentation_rights_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "asset_sha256" varchar(64) NOT NULL,
  "asset_size_bytes" bigint NOT NULL,
  "evidence_digest" varchar(64) NOT NULL,
  "evidence_body" jsonb NOT NULL,
  "decision" varchar(20) NOT NULL,
  "reviewed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_presentation_rights_evidence_shape" CHECK ((
    "venue_slug" = 'trades-hall'
    AND "room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND "asset_sha256" ~ '^[a-f0-9]{64}$'
    AND "asset_size_bytes" > 0
    AND "evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "decision" IN ('approved', 'rejected')
    AND jsonb_typeof("evidence_body") = 'object'
    AND "evidence_body"->>'schemaVersion' = 'runtime-presentation-rights-evidence.v1'
    AND "evidence_body"->>'evidenceId' = "id"::text
    AND "evidence_body"->>'assetVersionId' = "asset_version_id"::text
    AND "evidence_body"->>'venueSlug' = "venue_slug"
    AND "evidence_body"->>'roomSlug' = "room_slug"
    AND "evidence_body"->>'assetSha256' = "asset_sha256"
    AND ("evidence_body"->>'assetSizeBytes')::bigint = "asset_size_bytes"
    AND "evidence_body"->>'decision' = "decision"
    AND "evidence_body"->>'reviewedBy' = "reviewed_by"::text
    AND ("evidence_body"->>'reviewedAt')::timestamp with time zone = "reviewed_at"
  ) IS TRUE),
  CONSTRAINT "runtime_presentation_rights_evidence_asset_fk"
    FOREIGN KEY (
      "asset_version_id", "venue_slug", "room_slug", "asset_sha256", "asset_size_bytes"
    ) REFERENCES "asset_versions" (
      "id", "venue_slug", "room_slug", "sha256", "size_bytes"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_rights_evidence_exact_unique"
    UNIQUE (
      "id", "asset_version_id", "venue_slug", "room_slug", "asset_sha256",
      "asset_size_bytes", "evidence_digest", "decision", "reviewed_by", "reviewed_at"
    )
);

-- This is a normalized, append-only admission receipt, not a caller-supplied
-- hash envelope. It can exist only when PostgreSQL can follow exact composite
-- references to the package, QA body/reviewer/time, transform body, and one
-- registered Scene Authority artifact. Ordered member rows below bind every
-- reviewed byte and its rights review. No current production row is inserted.
CREATE TABLE "runtime_presentation_admissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "runtime_manifest_digest" varchar(64) NOT NULL,
  "reviewed_profile_id" varchar(120) NOT NULL,
  "reviewed_profile_manifest_fingerprint" varchar(64) NOT NULL,
  "runtime_qa_record_id" uuid NOT NULL,
  "runtime_qa_record_key" varchar(120) NOT NULL,
  "runtime_qa_record_digest" varchar(64) NOT NULL,
  "runtime_qa_decision" varchar(40) NOT NULL,
  "runtime_qa_reviewed_by" uuid NOT NULL,
  "runtime_qa_reviewed_at" timestamp with time zone NOT NULL,
  "runtime_transform_artifact_row_id" uuid NOT NULL,
  "runtime_transform_artifact_id" varchar(120) NOT NULL,
  "runtime_transform_artifact_digest" varchar(64) NOT NULL,
  "scene_authority_artifact_row_id" uuid NOT NULL,
  "scene_authority_artifact_kind" varchar(50) NOT NULL,
  "scene_authority_artifact_id" varchar(160) NOT NULL,
  "scene_authority_map_digest" varchar(64) NOT NULL,
  "rights_evidence_digest" varchar(64) NOT NULL,
  "member_count" integer NOT NULL,
  "decision" varchar(20) NOT NULL,
  "admission_digest" varchar(64) NOT NULL,
  "admission_body" jsonb NOT NULL,
  "reviewed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_presentation_admissions_digest_shapes" CHECK (
    "runtime_package_content_digest" ~ '^[a-f0-9]{64}$'
    AND "runtime_manifest_digest" ~ '^[a-f0-9]{64}$'
    AND "reviewed_profile_manifest_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "runtime_qa_record_digest" ~ '^[a-f0-9]{64}$'
    AND "runtime_transform_artifact_digest" ~ '^[a-f0-9]{64}$'
    AND "scene_authority_map_digest" ~ '^[a-f0-9]{64}$'
    AND "rights_evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "admission_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "runtime_presentation_admissions_shape" CHECK ((
    "venue_slug" = 'trades-hall'
    AND "room_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND "reviewed_profile_id" ~ '^[a-z0-9][a-z0-9._-]*$'
    AND "runtime_qa_record_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND "runtime_transform_artifact_id" ~ '^[a-z0-9][a-z0-9._-]*$'
    AND "scene_authority_artifact_kind" = 'scene_authority_map_v0'
    AND "member_count" BETWEEN 1 AND 8
    AND "decision" IN ('approved', 'rejected')
    AND "runtime_qa_decision" IN ('approved_internal_preview', 'approved_public')
    AND "runtime_qa_reviewed_at" <= "reviewed_at"
    AND jsonb_typeof("admission_body") = 'object'
    AND "admission_body"->>'schemaVersion' = 'runtime-presentation-admission.v1'
    AND "admission_body"->>'admissionId' = "id"::text
    AND "admission_body"->>'runtimePackageId' = "runtime_package_id"::text
    AND "admission_body"->>'runtimePackageContentDigest' = "runtime_package_content_digest"
    AND "admission_body"->>'venueSlug' = "venue_slug"
    AND "admission_body"->>'roomSlug' = "room_slug"
    AND "admission_body"->>'runtimeManifestDigest' = "runtime_manifest_digest"
    AND "admission_body"->>'reviewedProfileId' = "reviewed_profile_id"
    AND "admission_body"->>'reviewedProfileManifestFingerprint' = "reviewed_profile_manifest_fingerprint"
    AND "admission_body"->>'runtimeQaRecordId' = "runtime_qa_record_id"::text
    AND "admission_body"->>'runtimeQaRecordKey' = "runtime_qa_record_key"
    AND "admission_body"->>'runtimeQaRecordDigest' = "runtime_qa_record_digest"
    AND "admission_body"->>'runtimeQaDecision' = "runtime_qa_decision"
    AND "admission_body"->>'runtimeQaReviewedBy' = "runtime_qa_reviewed_by"::text
    AND ("admission_body"->>'runtimeQaReviewedAt')::timestamp with time zone = "runtime_qa_reviewed_at"
    AND "admission_body"->>'runtimeTransformArtifactRowId' = "runtime_transform_artifact_row_id"::text
    AND "admission_body"->>'runtimeTransformArtifactId' = "runtime_transform_artifact_id"
    AND "admission_body"->>'runtimeTransformArtifactDigest' = "runtime_transform_artifact_digest"
    AND "admission_body"->>'sceneAuthorityArtifactRowId' = "scene_authority_artifact_row_id"::text
    AND "admission_body"->>'sceneAuthorityArtifactKind' = "scene_authority_artifact_kind"
    AND "admission_body"->>'sceneAuthorityArtifactId' = "scene_authority_artifact_id"
    AND "admission_body"->>'sceneAuthorityMapDigest' = "scene_authority_map_digest"
    AND "admission_body"->>'rightsEvidenceDigest' = "rights_evidence_digest"
    AND ("admission_body"->>'memberCount')::integer = "member_count"
    AND "admission_body"->>'decision' = "decision"
    AND "admission_body"->>'reviewedBy' = "reviewed_by"::text
    AND ("admission_body"->>'reviewedAt')::timestamp with time zone = "reviewed_at"
  ) IS TRUE),
  CONSTRAINT "runtime_presentation_admissions_package_fk"
    FOREIGN KEY (
      "runtime_package_id", "venue_slug", "room_slug", "runtime_package_content_digest"
    ) REFERENCES "runtime_packages" (
      "id", "venue_slug", "room_slug", "content_digest"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admissions_qa_fk"
    FOREIGN KEY (
      "runtime_qa_record_id", "runtime_package_id", "venue_slug", "room_slug",
      "runtime_qa_record_key", "runtime_qa_record_digest", "runtime_qa_decision",
      "runtime_qa_reviewed_by", "runtime_qa_reviewed_at"
    ) REFERENCES "runtime_qa_records" (
      "id", "runtime_package_id", "venue_slug", "room_slug", "record_id",
      "record_digest", "public_exposure_decision", "reviewed_by", "reviewed_at"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admissions_transform_fk"
    FOREIGN KEY (
      "runtime_transform_artifact_row_id", "runtime_package_id", "venue_slug",
      "room_slug", "runtime_transform_artifact_id", "runtime_transform_artifact_digest"
    ) REFERENCES "runtime_transform_artifacts" (
      "id", "runtime_package_id", "venue_slug", "room_slug",
      "transform_artifact_id", "artifact_digest"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admissions_scene_authority_fk"
    FOREIGN KEY (
      "scene_authority_artifact_row_id", "venue_slug", "scene_authority_artifact_kind",
      "scene_authority_artifact_id", "scene_authority_map_digest"
    ) REFERENCES "reconstruction_review_evidence_artifacts" (
      "id", "venue_slug", "artifact_kind", "artifact_id", "artifact_digest"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admissions_member_scope_unique"
    UNIQUE (
      "id", "runtime_package_id", "runtime_package_content_digest", "venue_slug", "room_slug"
    ),
  CONSTRAINT "runtime_presentation_admissions_exact_binding_unique"
    UNIQUE (
      "id", "runtime_package_id", "runtime_package_content_digest", "venue_slug",
      "room_slug", "runtime_manifest_digest", "runtime_qa_record_id",
      "runtime_transform_artifact_row_id", "decision", "reviewed_at", "admission_digest"
    )
);

CREATE TABLE "runtime_presentation_admission_members" (
  "admission_id" uuid NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "room_slug" varchar(100) NOT NULL,
  "member_index" integer NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "rights_evidence_row_id" uuid NOT NULL,
  "rights_evidence_digest" varchar(64) NOT NULL,
  "rights_decision" varchar(20) NOT NULL,
  "rights_reviewed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "rights_reviewed_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("admission_id", "member_index"),
  CONSTRAINT "runtime_presentation_admission_members_shape" CHECK (
    "member_index" BETWEEN 0 AND 7
    AND "file_ext" IN ('.sog', '.spz')
    AND right("file_name", length("file_ext")) = "file_ext"
    AND length(trim("mime_type")) > 0
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "storage_key_sha256" ~ '^[a-f0-9]{64}$'
    AND "rights_evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" BETWEEN 1 AND 16777216
    AND "rights_decision" IN ('approved', 'rejected')
  ),
  CONSTRAINT "runtime_presentation_admission_members_admission_fk"
    FOREIGN KEY (
      "admission_id", "runtime_package_id", "runtime_package_content_digest",
      "venue_slug", "room_slug"
    ) REFERENCES "runtime_presentation_admissions" (
      "id", "runtime_package_id", "runtime_package_content_digest",
      "venue_slug", "room_slug"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admission_members_asset_fk"
    FOREIGN KEY (
      "asset_version_id", "venue_slug", "room_slug", "file_name", "file_ext",
      "mime_type", "sha256", "size_bytes"
    ) REFERENCES "asset_versions" (
      "id", "venue_slug", "room_slug", "file_name", "file_ext",
      "mime_type", "sha256", "size_bytes"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_presentation_admission_members_rights_fk"
    FOREIGN KEY (
      "rights_evidence_row_id", "asset_version_id", "venue_slug", "room_slug",
      "sha256", "size_bytes", "rights_evidence_digest", "rights_decision",
      "rights_reviewed_by", "rights_reviewed_at"
    ) REFERENCES "runtime_presentation_rights_evidence" (
      "id", "asset_version_id", "venue_slug", "room_slug", "asset_sha256",
      "asset_size_bytes", "evidence_digest", "decision", "reviewed_by", "reviewed_at"
    ) ON DELETE RESTRICT
);

CREATE INDEX "runtime_presentation_admissions_package_idx"
  ON "runtime_presentation_admissions" (
    "runtime_package_id", "runtime_package_content_digest", "reviewed_at", "id"
  );
CREATE INDEX "runtime_presentation_admission_members_asset_idx"
  ON "runtime_presentation_admission_members" ("asset_version_id");

ALTER TABLE "phase_layout_snapshots"
  ADD COLUMN "runtime_binding_state" varchar(24) NOT NULL DEFAULT 'legacy_unbound',
  ADD COLUMN "runtime_binding_digest" varchar(64),
  ADD COLUMN "runtime_binding" jsonb,
  ADD COLUMN "runtime_presentation_admission_id" uuid,
  ADD COLUMN "runtime_presentation_admission_decision" varchar(20),
  ADD COLUMN "runtime_presentation_admission_reviewed_at" timestamp with time zone,
  ADD COLUMN "runtime_presentation_admission_digest" varchar(64),
  ADD COLUMN "runtime_package_id" uuid,
  ADD COLUMN "runtime_package_content_digest" varchar(64),
  ADD COLUMN "runtime_venue_slug" varchar(100),
  ADD COLUMN "runtime_room_slug" varchar(100),
  ADD COLUMN "runtime_manifest_digest" varchar(64),
  ADD COLUMN "runtime_reviewed_profile_id" varchar(120),
  ADD COLUMN "runtime_reviewed_profile_fingerprint" varchar(64),
  ADD COLUMN "runtime_rights_evidence_digest" varchar(64),
  ADD COLUMN "runtime_scene_authority_map_digest" varchar(64),
  ADD COLUMN "runtime_qa_record_id" uuid,
  ADD COLUMN "runtime_qa_record_key" varchar(120),
  ADD COLUMN "runtime_qa_record_digest" varchar(64),
  ADD COLUMN "runtime_qa_decision" varchar(40),
  ADD COLUMN "runtime_qa_reviewed_by" uuid,
  ADD COLUMN "runtime_qa_reviewed_at" timestamp with time zone,
  ADD COLUMN "runtime_transform_artifact_row_id" uuid,
  ADD COLUMN "runtime_transform_artifact_id" varchar(120),
  ADD COLUMN "runtime_transform_artifact_digest" varchar(64);

ALTER TABLE "phase_layout_snapshots"
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_state_check"
    CHECK ("runtime_binding_state" IN ('legacy_unbound', 'available', 'unavailable')),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_digest_shape"
    CHECK ("runtime_binding_digest" IS NULL OR "runtime_binding_digest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_digest_shapes"
    CHECK ((
      ("runtime_package_content_digest" IS NULL OR "runtime_package_content_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_manifest_digest" IS NULL OR "runtime_manifest_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_reviewed_profile_fingerprint" IS NULL OR "runtime_reviewed_profile_fingerprint" ~ '^[a-f0-9]{64}$')
      AND ("runtime_rights_evidence_digest" IS NULL OR "runtime_rights_evidence_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_scene_authority_map_digest" IS NULL OR "runtime_scene_authority_map_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_qa_record_digest" IS NULL OR "runtime_qa_record_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_transform_artifact_digest" IS NULL OR "runtime_transform_artifact_digest" ~ '^[a-f0-9]{64}$')
      AND ("runtime_presentation_admission_digest" IS NULL OR "runtime_presentation_admission_digest" ~ '^[a-f0-9]{64}$')
    ) IS TRUE),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_coherent"
    CHECK ((
      (
        "runtime_binding_state" = 'legacy_unbound'
        AND "runtime_binding_digest" IS NULL
        AND "runtime_binding" IS NULL
        AND "runtime_presentation_admission_id" IS NULL
        AND "runtime_presentation_admission_decision" IS NULL
        AND "runtime_presentation_admission_reviewed_at" IS NULL
        AND "runtime_presentation_admission_digest" IS NULL
        AND "runtime_package_id" IS NULL
        AND "runtime_package_content_digest" IS NULL
        AND "runtime_venue_slug" IS NULL
        AND "runtime_room_slug" IS NULL
        AND "runtime_manifest_digest" IS NULL
        AND "runtime_reviewed_profile_id" IS NULL
        AND "runtime_reviewed_profile_fingerprint" IS NULL
        AND "runtime_rights_evidence_digest" IS NULL
        AND "runtime_scene_authority_map_digest" IS NULL
        AND "runtime_qa_record_id" IS NULL
        AND "runtime_qa_record_key" IS NULL
        AND "runtime_qa_record_digest" IS NULL
        AND "runtime_qa_decision" IS NULL
        AND "runtime_qa_reviewed_by" IS NULL
        AND "runtime_qa_reviewed_at" IS NULL
        AND "runtime_transform_artifact_row_id" IS NULL
        AND "runtime_transform_artifact_id" IS NULL
        AND "runtime_transform_artifact_digest" IS NULL
      ) OR (
        "runtime_binding_state" = 'unavailable'
        AND "status" = 'frozen' AND "frozen_at" IS NOT NULL
        AND "runtime_binding_digest" IS NOT NULL
        AND jsonb_typeof("runtime_binding") = 'object'
        AND "runtime_presentation_admission_id" IS NULL
        AND "runtime_presentation_admission_decision" IS NULL
        AND "runtime_presentation_admission_reviewed_at" IS NULL
        AND "runtime_presentation_admission_digest" IS NULL
        AND "runtime_package_id" IS NULL
        AND "runtime_package_content_digest" IS NULL
        AND "runtime_venue_slug" IS NULL
        AND "runtime_room_slug" IS NULL
        AND "runtime_manifest_digest" IS NULL
        AND "runtime_reviewed_profile_id" IS NULL
        AND "runtime_reviewed_profile_fingerprint" IS NULL
        AND "runtime_rights_evidence_digest" IS NULL
        AND "runtime_scene_authority_map_digest" IS NULL
        AND "runtime_qa_record_id" IS NULL
        AND "runtime_qa_record_key" IS NULL
        AND "runtime_qa_record_digest" IS NULL
        AND "runtime_qa_decision" IS NULL
        AND "runtime_qa_reviewed_by" IS NULL
        AND "runtime_qa_reviewed_at" IS NULL
        AND "runtime_transform_artifact_row_id" IS NULL
        AND "runtime_transform_artifact_id" IS NULL
        AND "runtime_transform_artifact_digest" IS NULL
      ) OR (
        "runtime_binding_state" = 'available'
        AND "status" = 'frozen' AND "frozen_at" IS NOT NULL
        AND "runtime_binding_digest" IS NOT NULL
        AND jsonb_typeof("runtime_binding") = 'object'
        AND "runtime_presentation_admission_id" IS NOT NULL
        AND "runtime_presentation_admission_decision" = 'approved'
        AND "runtime_presentation_admission_reviewed_at" IS NOT NULL
        AND "runtime_presentation_admission_digest" IS NOT NULL
        AND "runtime_package_id" IS NOT NULL
        AND "runtime_package_content_digest" IS NOT NULL
        AND "runtime_venue_slug" IS NOT NULL
        AND "runtime_room_slug" IS NOT NULL
        AND "runtime_manifest_digest" IS NOT NULL
        AND "runtime_reviewed_profile_id" IS NOT NULL
        AND "runtime_reviewed_profile_fingerprint" IS NOT NULL
        AND "runtime_rights_evidence_digest" IS NOT NULL
        AND "runtime_scene_authority_map_digest" IS NOT NULL
        AND "runtime_qa_record_id" IS NOT NULL
        AND "runtime_qa_record_key" IS NOT NULL
        AND "runtime_qa_record_digest" IS NOT NULL
        AND "runtime_qa_decision" IS NOT NULL
        AND "runtime_qa_reviewed_by" IS NOT NULL
        AND "runtime_qa_reviewed_at" IS NOT NULL
        AND "runtime_transform_artifact_row_id" IS NOT NULL
        AND "runtime_transform_artifact_id" IS NOT NULL
        AND "runtime_transform_artifact_digest" IS NOT NULL
      )
    ) IS TRUE),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_json_identity"
    CHECK ((
      "runtime_binding_state" = 'legacy_unbound'
      OR (
        "runtime_binding"->>'schemaVersion' = 'phase-layout-runtime-binding.v1'
        AND "runtime_binding"->>'admissionPolicy' = 'trades-hall-reviewed-presentation.v1'
        AND "runtime_binding"->>'bindingId' = "id"::text
        AND "runtime_binding"->>'phaseLayoutSnapshotId' = "id"::text
        AND "runtime_binding"->>'canonicalSnapshotId' = "canonical_snapshot_id"::text
        AND "runtime_binding"->>'snapshotHash' = "snapshot_hash"
        AND "runtime_binding"->>'venueId' = "payload"->>'venueId'
        AND "runtime_binding"->>'spaceId' = "payload"->>'spaceId'
        AND "runtime_binding"->>'venueSlug' = "payload"->'venueRuntime'->>'venueSlug'
        AND "runtime_binding"->>'spaceSlug' = "payload"->'venueRuntime'->>'spaceSlug'
        AND "runtime_binding"->>'boundBy' = "frozen_by"::text
        AND ("runtime_binding"->>'boundAt')::timestamp with time zone = "frozen_at"
        AND "runtime_binding"->>'availability' = "runtime_binding_state"
        AND "runtime_binding"->>'bindingDigest' = "runtime_binding_digest"
      )
    ) IS TRUE),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_unavailable_expectation"
    CHECK ((
      "runtime_binding_state" <> 'unavailable'
      OR (
        "runtime_binding"->'expectedRuntimePackageId'
          IS NOT DISTINCT FROM "payload"->'venueRuntime'->'runtimePackageId'
        AND "runtime_binding"->'expectedRuntimeManifestDigest'
          IS NOT DISTINCT FROM "payload"->'venueRuntime'->'runtimeVenueManifestDigest'
      )
    ) IS TRUE),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_available_identity"
    CHECK ((
      "runtime_binding_state" <> 'available'
      OR (
        "runtime_binding"->>'runtimePackageId' = "runtime_package_id"::text
        AND "runtime_binding"->>'runtimePackageContentDigest' = "runtime_package_content_digest"
        AND "runtime_binding"->>'venueSlug' = "runtime_venue_slug"
        AND "runtime_binding"->>'spaceSlug' = "runtime_room_slug"
        AND "runtime_binding"->>'runtimeManifestDigest' = "runtime_manifest_digest"
        AND "runtime_binding"->>'reviewedProfileId' = "runtime_reviewed_profile_id"
        AND "runtime_binding"->>'reviewedProfileManifestFingerprint' = "runtime_reviewed_profile_fingerprint"
        AND "runtime_binding"->>'rightsEvidenceDigest' = "runtime_rights_evidence_digest"
        AND "runtime_binding"->>'sceneAuthorityMapDigest' = "runtime_scene_authority_map_digest"
        AND "runtime_binding"->>'runtimeQaRecordId' = "runtime_qa_record_id"::text
        AND "runtime_binding"->>'runtimeQaRecordKey' = "runtime_qa_record_key"
        AND "runtime_binding"->>'runtimeQaRecordDigest' = "runtime_qa_record_digest"
        AND "runtime_binding"->>'runtimeQaDecision' = "runtime_qa_decision"
        AND "runtime_binding"->>'runtimeQaReviewedBy' = "runtime_qa_reviewed_by"::text
        AND ("runtime_binding"->>'runtimeQaReviewedAt')::timestamp with time zone = "runtime_qa_reviewed_at"
        AND "runtime_qa_reviewed_at" <= "frozen_at"
        AND "runtime_presentation_admission_reviewed_at" <= "frozen_at"
        AND "runtime_binding"->>'transformArtifactRowId' = "runtime_transform_artifact_row_id"::text
        AND "runtime_binding"->>'transformArtifactId' = "runtime_transform_artifact_id"
        AND "runtime_binding"->>'transformArtifactDigest' = "runtime_transform_artifact_digest"
        AND "runtime_binding"->'transformArtifact'->>'id' = "runtime_transform_artifact_id"
        AND ("runtime_binding"->'transformArtifact'->>'date')::timestamp with time zone <= "frozen_at"
        AND "runtime_binding"->>'runtimePackageId' = "payload"->'venueRuntime'->>'runtimePackageId'
        AND "runtime_binding"->>'runtimeManifestDigest' = "payload"->'venueRuntime'->>'runtimeVenueManifestDigest'
      )
    ) IS TRUE),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_package_scope_fk"
    FOREIGN KEY (
      "runtime_package_id", "runtime_venue_slug", "runtime_room_slug",
      "runtime_package_content_digest"
    ) REFERENCES "runtime_packages" (
      "id", "venue_slug", "room_slug", "content_digest"
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_qa_exact_fk"
    FOREIGN KEY (
      "runtime_qa_record_id", "runtime_package_id", "runtime_venue_slug",
      "runtime_room_slug", "runtime_qa_record_key", "runtime_qa_record_digest",
      "runtime_qa_decision", "runtime_qa_reviewed_by", "runtime_qa_reviewed_at"
    ) REFERENCES "runtime_qa_records" (
      "id", "runtime_package_id", "venue_slug", "room_slug", "record_id",
      "record_digest", "public_exposure_decision", "reviewed_by", "reviewed_at"
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_transform_exact_fk"
    FOREIGN KEY (
      "runtime_transform_artifact_row_id", "runtime_package_id", "runtime_venue_slug",
      "runtime_room_slug", "runtime_transform_artifact_id", "runtime_transform_artifact_digest"
    ) REFERENCES "runtime_transform_artifacts" (
      "id", "runtime_package_id", "venue_slug", "room_slug",
      "transform_artifact_id", "artifact_digest"
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_admission_exact_fk"
    FOREIGN KEY (
      "runtime_presentation_admission_id", "runtime_package_id",
      "runtime_package_content_digest", "runtime_venue_slug", "runtime_room_slug",
      "runtime_manifest_digest", "runtime_qa_record_id", "runtime_transform_artifact_row_id"
      , "runtime_presentation_admission_decision", "runtime_presentation_admission_reviewed_at"
      , "runtime_presentation_admission_digest"
    ) REFERENCES "runtime_presentation_admissions" (
      "id", "runtime_package_id", "runtime_package_content_digest", "venue_slug",
      "room_slug", "runtime_manifest_digest", "runtime_qa_record_id",
      "runtime_transform_artifact_row_id", "decision", "reviewed_at", "admission_digest"
    ) ON DELETE RESTRICT;

CREATE INDEX "phase_layout_snapshots_runtime_package_idx"
  ON "phase_layout_snapshots" ("runtime_package_id");
CREATE INDEX "phase_layout_snapshots_runtime_binding_state_idx"
  ON "phase_layout_snapshots" ("runtime_binding_state");

CREATE OR REPLACE FUNCTION "runtime_presentation_evidence_append_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000',
          CONSTRAINT = TG_TABLE_NAME || '_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION "runtime_presentation_member_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('runtime-presentation-admission:' || NEW."admission_id"::text, 0)
  );
  IF EXISTS (
    SELECT 1
    FROM "phase_layout_snapshots" snapshot
    WHERE snapshot."runtime_presentation_admission_id" = NEW."admission_id"
  ) THEN
    RAISE EXCEPTION 'runtime presentation admission member set is sealed by a frozen snapshot'
      USING ERRCODE = '55000',
            CONSTRAINT = 'runtime_presentation_admission_members_sealed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "runtime_presentation_admission_members_insert_guard"
  BEFORE INSERT ON "runtime_presentation_admission_members"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_member_insert_guard"();

CREATE OR REPLACE FUNCTION "phase_layout_runtime_admission_member_set_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  actual_count integer;
  distinct_index_count integer;
  minimum_index integer;
  maximum_index integer;
  total_size_bytes bigint;
BEGIN
  IF NEW."runtime_binding_state" <> 'available' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'runtime-presentation-admission:' || NEW."runtime_presentation_admission_id"::text,
      0
    )
  );
  SELECT admission."member_count"
  INTO expected_count
  FROM "runtime_presentation_admissions" admission
  WHERE admission."id" = NEW."runtime_presentation_admission_id"
    AND admission."decision" = 'approved'
    AND admission."runtime_package_id" = NEW."runtime_package_id"
    AND admission."runtime_package_content_digest" = NEW."runtime_package_content_digest"
    AND admission."venue_slug" = NEW."runtime_venue_slug"
    AND admission."room_slug" = NEW."runtime_room_slug"
    AND admission."runtime_manifest_digest" = NEW."runtime_manifest_digest"
    AND admission."reviewed_at" = NEW."runtime_presentation_admission_reviewed_at"
    AND admission."reviewed_at" <= NEW."frozen_at"
    AND admission."created_at" <= NEW."frozen_at"
    AND admission."admission_digest" = NEW."runtime_presentation_admission_digest";
  SELECT
    count(*), count(DISTINCT member."member_index"),
    min(member."member_index"), max(member."member_index"),
    coalesce(sum(member."size_bytes"), 0)
  INTO actual_count, distinct_index_count, minimum_index, maximum_index, total_size_bytes
  FROM "runtime_presentation_admission_members" member
  WHERE member."admission_id" = NEW."runtime_presentation_admission_id";
  IF expected_count IS NULL
     OR actual_count <> expected_count
     OR distinct_index_count <> expected_count
     OR minimum_index <> 0
     OR maximum_index <> expected_count - 1
     OR total_size_bytes > 100663296 THEN
    RAISE EXCEPTION 'runtime presentation admission member set is incomplete or non-contiguous'
      USING ERRCODE = '23514',
            CONSTRAINT = 'phase_layout_snapshots_runtime_admission_member_set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "phase_layout_snapshots_runtime_admission_member_set"
  BEFORE INSERT ON "phase_layout_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "phase_layout_runtime_admission_member_set_guard"();

CREATE TRIGGER "runtime_transform_artifacts_append_only"
  BEFORE UPDATE OR DELETE ON "runtime_transform_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_qa_records_append_only"
  BEFORE UPDATE OR DELETE ON "runtime_qa_records"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_admissions_append_only"
  BEFORE UPDATE OR DELETE ON "runtime_presentation_admissions"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_admission_members_append_only"
  BEFORE UPDATE OR DELETE ON "runtime_presentation_admission_members"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_rights_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "runtime_presentation_rights_evidence"
  FOR EACH ROW EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();

CREATE TRIGGER "runtime_transform_artifacts_no_truncate"
  BEFORE TRUNCATE ON "runtime_transform_artifacts"
  FOR EACH STATEMENT EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_qa_records_no_truncate"
  BEFORE TRUNCATE ON "runtime_qa_records"
  FOR EACH STATEMENT EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_admissions_no_truncate"
  BEFORE TRUNCATE ON "runtime_presentation_admissions"
  FOR EACH STATEMENT EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_admission_members_no_truncate"
  BEFORE TRUNCATE ON "runtime_presentation_admission_members"
  FOR EACH STATEMENT EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
CREATE TRIGGER "runtime_presentation_rights_evidence_no_truncate"
  BEFORE TRUNCATE ON "runtime_presentation_rights_evidence"
  FOR EACH STATEMENT EXECUTE FUNCTION "runtime_presentation_evidence_append_only_guard"();
