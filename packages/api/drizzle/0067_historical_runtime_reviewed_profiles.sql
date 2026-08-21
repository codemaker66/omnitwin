-- Immutable reviewed-profile authority over the verified Scene graph.

-- One direct, unpooled, least-privilege migration LOGIN deploys this slice.
-- External bootstrap grants SET-only membership in the two NOLOGIN owner
-- roles plus temporary schema grant option. Runtime capability overlap is
-- forbidden, and every temporary edge is closed before commit.
DO $$
DECLARE
  migration_role record;
BEGIN
  SELECT "rolcanlogin", "rolinherit", "rolsuper", "rolcreatedb",
    "rolcreaterole", "rolreplication", "rolbypassrls"
  INTO STRICT migration_role
  FROM pg_catalog.pg_roles
  WHERE "rolname" = session_user;

  IF current_user IS DISTINCT FROM session_user
     OR NOT migration_role."rolcanlogin"
     OR migration_role."rolinherit"
     OR migration_role."rolsuper"
     OR migration_role."rolcreatedb"
     OR migration_role."rolcreaterole"
     OR migration_role."rolreplication"
     OR migration_role."rolbypassrls"
     OR NOT pg_catalog.pg_has_role(
       session_user, 'omnitwin_historical_schema_owner', 'SET'
     )
     OR NOT pg_catalog.pg_has_role(
       session_user, 'omnitwin_historical_evidence_owner', 'SET'
     )
     OR pg_catalog.pg_has_role(
       session_user, 'omnitwin_historical_evidence_verifier', 'MEMBER'
     )
     OR pg_catalog.pg_has_role(
       session_user, 'omnitwin_historical_auth_gateway', 'MEMBER'
     )
     OR pg_catalog.pg_has_role(
       session_user, 'omnitwin_api_activation', 'MEMBER'
     ) THEN
    RAISE EXCEPTION '0067 requires an isolated least-privilege migration login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_profile_migration_principal_isolation';
  END IF;
END;
$$;

GRANT CREATE ON SCHEMA public
TO "omnitwin_historical_schema_owner",
   "omnitwin_historical_evidence_owner";

-- New migration-owned tables need a transaction-local REFERENCES bridge to
-- the exact thirteen 0065/0066 schema-owner parents. The sole CHECK helper is
-- also granted only for table creation and revoked before commit.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT REFERENCES ON TABLE '
      || 'public.hr_capture_clearances, '
      || 'public.hr_capture_content_subjects, public.hr_capture_roots, '
      || 'public.hr_derivation_members, public.hr_derivations, '
      || 'public.hr_evidence_records, public.hr_evidence_subjects, '
      || 'public.hr_rights_clearances, public.hr_role_attestations, '
      || 'public.hr_scene_validation_members, '
      || 'public.hr_scene_validation_subjects, '
      || 'public.hr_scene_validations, public.hr_transform_reviews TO %I',
    session_user
  );
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION public.hr_uuid_array_is_distinct(uuid[]) TO %I',
    session_user
  );
END;
$$;
RESET ROLE;

-- Exact legacy profile identity surfaces. The parallel Scene surfaces are
-- already committed by 0066 and are deliberately not recreated here.
ALTER TABLE "runtime_presentation_admissions"
  ADD CONSTRAINT "hr_admissions_profile_leaf_unique" UNIQUE (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "reviewed_profile_id", "reviewed_profile_manifest_fingerprint",
    "runtime_manifest_digest", "runtime_qa_record_id",
    "runtime_qa_record_key", "runtime_qa_record_digest",
    "runtime_qa_decision", "runtime_qa_reviewed_by", "runtime_qa_reviewed_at",
    "runtime_transform_artifact_row_id", "runtime_transform_artifact_id",
    "runtime_transform_artifact_digest", "scene_authority_artifact_row_id",
    "scene_authority_artifact_id", "scene_authority_map_digest",
    "decision", "reviewed_by", "reviewed_at", "member_count"
  );
ALTER TABLE "runtime_packages"
  ADD CONSTRAINT "hr_runtime_packages_profile_leaf_unique" UNIQUE (
    "id", "venue_slug", "room_slug", "revision", "content_digest"
  );

-- A reviewed profile is the only package-level authority accepted by the new
-- execution graph. Its subject exact-FKs every immutable upstream leaf and a
-- dense ordered member intersection; a later independent role attestation
-- finalizes that pre-review subject without a digest cycle.
CREATE TABLE "hr_reviewed_profile_subjects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "reviewed_profile_id" varchar(120) NOT NULL,
  "reviewed_profile_manifest_fingerprint" varchar(64) NOT NULL,
  "presentation_admission_id" uuid NOT NULL,
  "presentation_admission_digest" varchar(64) NOT NULL,
  "presentation_admission_decision" varchar(20) NOT NULL,
  "presentation_admission_reviewed_by" uuid NOT NULL,
  "presentation_admission_reviewed_at" timestamptz NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_revision" integer NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "runtime_manifest_digest" varchar(64) NOT NULL,
  "capture_root_id" uuid NOT NULL,
  "capture_content_subject_digest" varchar(64) NOT NULL,
  "capture_root_evidence_digest" varchar(64) NOT NULL,
  "capture_root_expires_at" timestamptz NOT NULL,
  "capture_clearance_id" uuid NOT NULL,
  "capture_clearance_digest" varchar(64) NOT NULL,
  "capture_clearance_expires_at" timestamptz NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_member_count" integer NOT NULL,
  "derivation_total_bytes" bigint NOT NULL,
  "derivation_members_digest" varchar(64) NOT NULL,
  "derivation_reviewer_actor_id" uuid NOT NULL,
  "derivation_reviewer_expires_at" timestamptz NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "runtime_qa_record_id" uuid NOT NULL,
  "runtime_qa_record_key" varchar(120) NOT NULL,
  "runtime_qa_record_digest" varchar(64) NOT NULL,
  "runtime_qa_decision" varchar(40) NOT NULL,
  "runtime_qa_reviewed_by" uuid NOT NULL,
  "runtime_qa_reviewed_at" timestamptz NOT NULL,
  "qa_reviewer_attestation_id" uuid NOT NULL,
  "qa_reviewer_attestation_digest" varchar(64) NOT NULL,
  "qa_reviewer_role" varchar(50) GENERATED ALWAYS AS ('qa_reviewer') STORED,
  "qa_reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('runtime_qa_record') STORED,
  "qa_reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "qa_reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("runtime_qa_record_digest") STORED,
  "qa_reviewer_effective_at" timestamptz NOT NULL,
  "qa_reviewer_expires_at" timestamptz NOT NULL,
  "transform_artifact_row_id" uuid NOT NULL,
  "transform_artifact_id" varchar(120) NOT NULL,
  "transform_artifact_digest" varchar(64) NOT NULL,
  "transform_review_id" uuid NOT NULL,
  "transform_review_subject_digest" varchar(64) NOT NULL,
  "transform_review_digest" varchar(64) NOT NULL,
  "transform_reviewer_actor_id" uuid NOT NULL,
  "transform_review_expires_at" timestamptz NOT NULL,
  "scene_artifact_row_id" uuid NOT NULL,
  "scene_artifact_id" varchar(160) NOT NULL,
  "scene_artifact_digest" varchar(64) NOT NULL,
  "scene_validation_id" uuid NOT NULL,
  "scene_validation_subject_digest" varchar(64) NOT NULL,
  "scene_coverage_digest" varchar(64) NOT NULL,
  "scene_subject_authority_expires_at" timestamptz NOT NULL,
  "scene_validation_digest" varchar(64) NOT NULL,
  "scene_reviewer_actor_id" uuid NOT NULL,
  "scene_validation_expires_at" timestamptz NOT NULL,
  "package_custodian_attestation_id" uuid NOT NULL,
  "package_custodian_attestation_digest" varchar(64) NOT NULL,
  "package_custodian_role" varchar(50)
    GENERATED ALWAYS AS ('package_custodian') STORED,
  "package_custodian_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('runtime_manifest') STORED,
  "package_custodian_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "package_custodian_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("runtime_manifest_digest") STORED,
  "package_custodian_actor_id" uuid NOT NULL,
  "package_custodian_effective_at" timestamptz NOT NULL,
  "package_custodian_expires_at" timestamptz NOT NULL,
  "admission_reviewer_attestation_id" uuid NOT NULL,
  "admission_reviewer_attestation_digest" varchar(64) NOT NULL,
  "admission_reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('admission_reviewer') STORED,
  "admission_reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('presentation_admission') STORED,
  "admission_reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "admission_reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("presentation_admission_digest") STORED,
  "admission_reviewer_effective_at" timestamptz NOT NULL,
  "admission_reviewer_expires_at" timestamptz NOT NULL,
  "capture_creator_actor_id" uuid NOT NULL,
  "source_custodian_actor_id" uuid NOT NULL,
  "owner_authorizer_actor_id" uuid NOT NULL,
  "privacy_reviewer_actor_id" uuid NOT NULL,
  "movable_content_reviewer_actor_id" uuid NOT NULL,
  "normalizer_actor_id" uuid NOT NULL,
  "capture_final_reviewer_actor_id" uuid NOT NULL,
  "derivative_producer_actor_id" uuid NOT NULL,
  "derivative_custodian_actor_id" uuid NOT NULL,
  "designated_final_reviewer_actor_id" uuid NOT NULL,
  "member_count" integer NOT NULL,
  "total_bytes" bigint NOT NULL,
  "members_digest" varchar(64) NOT NULL,
  "actor_map_digest" varchar(64) NOT NULL,
  "prepared_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "reviewed_profile_subject_digest" varchar(64) NOT NULL,
  "subject_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_profile_subjects_subject_fk" FOREIGN KEY (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug", "reviewed_profile_id",
    "reviewed_profile_manifest_fingerprint", "runtime_manifest_digest",
    "runtime_qa_record_id", "runtime_qa_record_key",
    "runtime_qa_record_digest", "runtime_qa_decision",
    "runtime_qa_reviewed_by", "runtime_qa_reviewed_at",
    "transform_artifact_row_id", "transform_artifact_id",
    "transform_artifact_digest", "scene_artifact_row_id",
    "scene_artifact_id", "scene_artifact_digest",
    "presentation_admission_decision", "presentation_admission_reviewed_by",
    "presentation_admission_reviewed_at", "member_count"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "reviewed_profile_id", "reviewed_profile_manifest_fingerprint",
    "runtime_manifest_digest", "runtime_qa_record_id",
    "runtime_qa_record_key", "runtime_qa_record_digest",
    "runtime_qa_decision", "runtime_qa_reviewed_by",
    "runtime_qa_reviewed_at", "runtime_transform_artifact_row_id",
    "runtime_transform_artifact_id", "runtime_transform_artifact_digest",
    "scene_authority_artifact_row_id", "scene_authority_artifact_id",
    "scene_authority_map_digest", "decision", "reviewed_by", "reviewed_at",
    "member_count"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_package_fk" FOREIGN KEY (
    "runtime_package_id", "venue_slug", "space_slug",
    "runtime_package_revision", "runtime_package_content_digest"
  ) REFERENCES "runtime_packages" (
    "id", "venue_slug", "room_slug", "revision", "content_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_root_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "capture_root_expires_at"
  ) REFERENCES "hr_capture_roots" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_capture_actors_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_creator_actor_id", "source_custodian_actor_id",
    "normalizer_actor_id", "capture_content_subject_digest"
  ) REFERENCES "hr_capture_content_subjects" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_operator_actor_id", "source_custodian_actor_id",
    "normalized_by_actor_id", "capture_content_subject_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_clearance_fk" FOREIGN KEY (
    "capture_clearance_id", "capture_root_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "capture_root_id", "capture_root_evidence_digest",
    "capture_clearance_digest", "capture_clearance_expires_at"
  ) REFERENCES "hr_capture_clearances" (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_id", "capture_root_evidence_digest",
    "capture_clearance_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_clearance_actors_fk" FOREIGN KEY (
    "capture_clearance_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_id", "capture_clearance_digest",
    "owner_authorizer_actor_id", "privacy_reviewer_actor_id",
    "movable_content_reviewer_actor_id", "capture_final_reviewer_actor_id",
    "capture_clearance_expires_at"
  ) REFERENCES "hr_capture_clearances" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_digest", "owner_actor_id", "privacy_actor_id",
    "movable_actor_id", "final_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_derivation_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_id", "capture_clearance_id", "derivation_evidence_digest",
    "derivation_member_count", "derivation_total_bytes",
    "derivation_members_digest", "derivation_reviewer_actor_id",
    "derivation_reviewer_expires_at", "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_id", "derivation_evidence_digest", "member_count",
    "total_bytes", "members_digest", "reviewer_actor_id",
    "reviewer_expires_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_derivation_actors_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_id", "capture_clearance_id", "derivation_evidence_digest",
    "derivative_producer_actor_id", "derivative_custodian_actor_id",
    "derivation_reviewer_actor_id", "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_id", "derivation_evidence_digest",
    "producer_actor_id", "custodian_actor_id", "reviewer_actor_id",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_qa_reviewer_fk" FOREIGN KEY (
    "qa_reviewer_attestation_id", "qa_reviewer_attestation_digest", "id",
    "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "qa_reviewer_role", "runtime_qa_reviewed_by", "qa_reviewer_bound_kind",
    "qa_reviewer_bound_reference", "qa_reviewer_bound_digest",
    "qa_reviewer_effective_at", "qa_reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_transform_fk" FOREIGN KEY (
    "transform_review_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id",
    "transform_artifact_row_id", "transform_review_subject_digest",
    "transform_review_digest", "transform_reviewer_actor_id",
    "transform_review_expires_at"
  ) REFERENCES "hr_transform_reviews" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "transform_artifact_row_id",
    "transform_review_subject_digest", "transform_review_digest",
    "reviewer_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_scene_subject_fk" FOREIGN KEY (
    "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id",
    "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "scene_coverage_digest",
    "scene_validation_subject_digest", "member_count",
    "scene_subject_authority_expires_at"
  ) REFERENCES "hr_scene_validation_subjects" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "coverage_digest",
    "scene_validation_subject_digest", "member_count", "authority_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_scene_final_fk" FOREIGN KEY (
    "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "scene_validation_digest",
    "scene_reviewer_actor_id", "scene_validation_expires_at"
  ) REFERENCES "hr_scene_validations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "scene_validation_digest",
    "reviewer_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_custodian_fk" FOREIGN KEY (
    "package_custodian_attestation_id",
    "package_custodian_attestation_digest", "id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "package_custodian_role",
    "package_custodian_actor_id", "package_custodian_bound_kind",
    "package_custodian_bound_reference", "package_custodian_bound_digest",
    "package_custodian_effective_at", "package_custodian_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_admission_reviewer_fk" FOREIGN KEY (
    "admission_reviewer_attestation_id",
    "admission_reviewer_attestation_digest", "id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "admission_reviewer_role",
    "presentation_admission_reviewed_by", "admission_reviewer_bound_kind",
    "admission_reviewer_bound_reference", "admission_reviewer_bound_digest",
    "admission_reviewer_effective_at", "admission_reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_subjects_shape" CHECK ((
    "subject_kind" = 'reviewed_profile'
    AND "presentation_admission_decision" = 'approved'
    AND "runtime_qa_decision" IN (
      'approved_internal_preview', 'approved_public'
    )
    AND "member_count" = "derivation_member_count"
    AND "total_bytes" = "derivation_total_bytes"
    AND "member_count" BETWEEN 1 AND 8
    AND "total_bytes" BETWEEN 1 AND 100663296
    AND "presentation_admission_reviewed_at" <= "prepared_at"
    AND "runtime_qa_reviewed_at" <= "prepared_at"
    AND "qa_reviewer_effective_at" <= "prepared_at"
    AND "package_custodian_effective_at" <= "prepared_at"
    AND "admission_reviewer_effective_at" <= "prepared_at"
    AND "prepared_at" = "created_at"
    AND "prepared_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "capture_clearance_expires_at", "derivation_expires_at",
      "qa_reviewer_expires_at", "transform_review_expires_at",
      "scene_validation_expires_at", "package_custodian_expires_at",
      "admission_reviewer_expires_at"
    )
    AND "reviewed_profile_manifest_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "members_digest" ~ '^[a-f0-9]{64}$'
    AND "actor_map_digest" ~ '^[a-f0-9]{64}$'
    AND "reviewed_profile_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "hr_uuid_array_is_distinct"(ARRAY[
      "capture_creator_actor_id", "source_custodian_actor_id",
      "owner_authorizer_actor_id", "privacy_reviewer_actor_id",
      "movable_content_reviewer_actor_id", "normalizer_actor_id",
      "capture_final_reviewer_actor_id", "derivative_producer_actor_id",
      "derivative_custodian_actor_id", "derivation_reviewer_actor_id",
      "package_custodian_actor_id", "runtime_qa_reviewed_by",
      "transform_reviewer_actor_id", "scene_reviewer_actor_id",
      "presentation_admission_reviewed_by",
      "designated_final_reviewer_actor_id"
    ])
    AND jsonb_typeof("subject_body") = 'object'
    AND "subject_body"->>'schemaVersion' =
      'historical-runtime-reviewed-profile-subject.v1'
    AND ("subject_body"->>'reviewedProfileEvidenceId')::uuid = "id"
    AND "subject_body"->>'reviewedProfileId' = "reviewed_profile_id"
    AND "subject_body"->>'reviewedProfileManifestFingerprint' =
      "reviewed_profile_manifest_fingerprint"
    AND ("subject_body"->>'venueId')::uuid = "venue_id"
    AND ("subject_body"->>'spaceId')::uuid = "space_id"
    AND ("subject_body"->>'presentationAdmissionId')::uuid =
      "presentation_admission_id"
    AND "subject_body"->>'presentationAdmissionDigest' =
      "presentation_admission_digest"
    AND ("subject_body"->>'runtimePackageId')::uuid = "runtime_package_id"
    AND ("subject_body"->>'runtimePackageRevision')::integer =
      "runtime_package_revision"
    AND "subject_body"->>'runtimePackageContentDigest' =
      "runtime_package_content_digest"
    AND "subject_body"->>'runtimeManifestDigest' = "runtime_manifest_digest"
    AND ("subject_body"->>'captureRootId')::uuid = "capture_root_id"
    AND "subject_body"->>'captureContentSubjectDigest' =
      "capture_content_subject_digest"
    AND "subject_body"->>'captureRootEvidenceDigest' =
      "capture_root_evidence_digest"
    AND ("subject_body"->>'captureClearanceId')::uuid =
      "capture_clearance_id"
    AND "subject_body"->>'captureClearanceDigest' =
      "capture_clearance_digest"
    AND ("subject_body"->>'derivationId')::uuid = "derivation_id"
    AND "subject_body"->>'derivationEvidenceDigest' =
      "derivation_evidence_digest"
    AND ("subject_body"->>'runtimeQaRecordId')::uuid =
      "runtime_qa_record_id"
    AND "subject_body"->>'runtimeQaRecordKey' = "runtime_qa_record_key"
    AND "subject_body"->>'runtimeQaRecordDigest' = "runtime_qa_record_digest"
    AND "subject_body"->>'runtimeQaDecision' = "runtime_qa_decision"
    AND ("subject_body"->>'runtimeQaReviewedBy')::uuid =
      "runtime_qa_reviewed_by"
    AND ("subject_body"->>'runtimeQaReviewedAt')::timestamptz =
      "runtime_qa_reviewed_at"
    AND ("subject_body"->>'qaReviewerAttestationId')::uuid =
      "qa_reviewer_attestation_id"
    AND "subject_body"->>'qaReviewerAttestationDigest' =
      "qa_reviewer_attestation_digest"
    AND ("subject_body"->>'transformReviewId')::uuid = "transform_review_id"
    AND "subject_body"->>'transformReviewDigest' = "transform_review_digest"
    AND ("subject_body"->>'sceneValidationId')::uuid = "scene_validation_id"
    AND "subject_body"->>'sceneValidationDigest' = "scene_validation_digest"
    AND ("subject_body"->>'packageCustodianAttestationId')::uuid =
      "package_custodian_attestation_id"
    AND "subject_body"->>'packageCustodianAttestationDigest' =
      "package_custodian_attestation_digest"
    AND ("subject_body"->>'memberCount')::integer = "member_count"
    AND ("subject_body"->>'totalBytes')::bigint = "total_bytes"
    AND "subject_body"->>'membersDigest' = "members_digest"
    AND "subject_body"->>'actorMapDigest' = "actor_map_digest"
    AND ("subject_body"->>'preparedAt')::timestamptz = "prepared_at"
    AND ("subject_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "subject_body"->>'reviewedProfileSubjectDigest' =
      "reviewed_profile_subject_digest"
  ) IS TRUE),
  CONSTRAINT "hr_profile_subjects_exact_unique" UNIQUE (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_id", "reviewed_profile_manifest_fingerprint",
    "presentation_admission_id", "runtime_package_id", "capture_root_id",
    "capture_clearance_id", "derivation_id", "transform_review_id",
    "scene_validation_id", "reviewed_profile_subject_digest",
    "member_count", "total_bytes", "members_digest", "expires_at"
  ),
  CONSTRAINT "hr_profile_subjects_member_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "venue_slug", "space_slug",
    "presentation_admission_id", "runtime_package_id",
    "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "scene_validation_id",
    "scene_coverage_digest", "scene_validation_subject_digest", "member_count",
    "reviewed_profile_subject_digest", "expires_at"
  ),
  CONSTRAINT "hr_profile_subjects_final_fk_unique" UNIQUE (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "designated_final_reviewer_actor_id",
    "prepared_at", "expires_at"
  ),
  CONSTRAINT "hr_profile_subjects_actor_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "expires_at"
  )
);

CREATE TABLE "hr_reviewed_profile_actors" (
  "reviewed_profile_evidence_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "reviewed_profile_subject_digest" varchar(64) NOT NULL,
  "profile_expires_at" timestamptz NOT NULL,
  "actor_role" varchar(50) NOT NULL,
  "member_index" integer,
  "actor_slot" varchar(70) GENERATED ALWAYS AS (
    "actor_role" || ':' || COALESCE("member_index"::text, 'fixed')
  ) STORED,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_profile_actors_parent_fk" FOREIGN KEY (
    "reviewed_profile_evidence_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "profile_expires_at"
  ) REFERENCES "hr_reviewed_profile_subjects" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_actors_shape" CHECK ((
    "actor_role" IN (
      'capture_creator', 'source_custodian', 'owner_authorizer',
      'privacy_reviewer', 'movable_content_reviewer', 'normalizer',
      'capture_final_reviewer', 'derivative_producer',
      'derivative_custodian', 'derivative_reviewer', 'package_custodian',
      'qa_reviewer', 'transform_reviewer', 'scene_reviewer',
      'admission_reviewer', 'rights_reviewer', 'profile_final_reviewer'
    )
    AND (("actor_role" = 'rights_reviewer') = ("member_index" IS NOT NULL))
    AND ("member_index" IS NULL OR "member_index" BETWEEN 0 AND 7)
    AND "created_at" < "profile_expires_at"
  ) IS TRUE),
  CONSTRAINT "hr_profile_actors_slot_unique"
    UNIQUE ("reviewed_profile_evidence_id", "actor_slot"),
  CONSTRAINT "hr_profile_actors_actor_unique"
    UNIQUE ("reviewed_profile_evidence_id", "actor_id"),
  CONSTRAINT "hr_profile_actors_exact_unique" UNIQUE (
    "reviewed_profile_evidence_id", "actor_role", "member_index", "actor_id",
    "reviewed_profile_subject_digest", "profile_expires_at"
  )
);

CREATE TABLE "hr_reviewed_profile_members" (
  "reviewed_profile_evidence_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "presentation_admission_id" uuid NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "scene_validation_id" uuid NOT NULL,
  "scene_validation_subject_digest" varchar(64) NOT NULL,
  "profile_member_count" integer NOT NULL,
  "reviewed_profile_subject_digest" varchar(64) NOT NULL,
  "profile_expires_at" timestamptz NOT NULL,
  "member_index" integer NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "derivation_output_receipt_id" uuid NOT NULL,
  "derivation_member_receipt_digest" varchar(64) NOT NULL,
  "derivation_receipt_expires_at" timestamptz NOT NULL,
  "rights_clearance_id" uuid NOT NULL,
  "rights_evidence_row_id" uuid NOT NULL,
  "legacy_rights_evidence_digest" varchar(64) NOT NULL,
  "legacy_rights_decision" varchar(20)
    GENERATED ALWAYS AS ('approved') STORED,
  "legacy_rights_reviewed_at" timestamptz NOT NULL,
  "rights_clearance_digest" varchar(64) NOT NULL,
  "rights_actor_role" varchar(50)
    GENERATED ALWAYS AS ('rights_reviewer') STORED,
  "rights_reviewer_actor_id" uuid NOT NULL,
  "rights_clearance_expires_at" timestamptz NOT NULL,
  "scene_authority_reference" text NOT NULL,
  "scene_coverage_digest" varchar(64) NOT NULL,
  "scene_subject_authority_expires_at" timestamptz NOT NULL,
  "member_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_profile_members_pkey"
    PRIMARY KEY ("reviewed_profile_evidence_id", "member_index"),
  CONSTRAINT "hr_profile_members_parent_fk" FOREIGN KEY (
    "reviewed_profile_evidence_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "venue_slug", "space_slug", "presentation_admission_id",
    "runtime_package_id", "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "scene_validation_id",
    "scene_coverage_digest", "scene_validation_subject_digest",
    "profile_member_count",
    "reviewed_profile_subject_digest", "profile_expires_at"
  ) REFERENCES "hr_reviewed_profile_subjects" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "venue_slug", "space_slug",
    "presentation_admission_id", "runtime_package_id",
    "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "scene_validation_id",
    "scene_coverage_digest", "scene_validation_subject_digest", "member_count",
    "reviewed_profile_subject_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_derivation_fk" FOREIGN KEY (
    "derivation_id", "member_index", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "derivation_evidence_digest", "asset_version_id", "venue_slug",
    "space_slug", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "storage_key_sha256",
    "derivation_receipt_expires_at"
  ) REFERENCES "hr_derivation_members" (
    "derivation_id", "member_index", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "derivation_evidence_digest", "asset_version_id", "venue_slug",
    "space_slug", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "output_receipt_id", "output_receipt_digest",
    "storage_key_sha256", "receipt_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "member_index", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "space_slug",
    "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "storage_key_sha256", "rights_evidence_row_id",
    "legacy_rights_evidence_digest", "legacy_rights_decision",
    "rights_reviewer_actor_id",
    "legacy_rights_reviewed_at"
  ) REFERENCES "runtime_presentation_admission_members" (
    "admission_id", "member_index", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "storage_key_sha256", "rights_evidence_row_id",
    "rights_evidence_digest", "rights_decision", "rights_reviewed_by",
    "rights_reviewed_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_rights_fk" FOREIGN KEY (
    "rights_clearance_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "derivation_id", "derivation_evidence_digest", "member_index",
    "asset_version_id", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "presentation_admission_id",
    "rights_evidence_row_id", "rights_clearance_digest",
    "rights_reviewer_actor_id", "rights_clearance_expires_at"
  ) REFERENCES "hr_rights_clearances" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_id",
    "derivation_evidence_digest", "member_index", "asset_version_id",
    "output_receipt_id", "output_receipt_digest",
    "presentation_admission_id", "rights_evidence_row_id",
    "rights_clearance_digest", "reviewer_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_scene_fk" FOREIGN KEY (
    "scene_validation_id", "member_index", "environment_id",
    "environment_mode", "environment_digest", "scene_coverage_digest",
    "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id", "derivation_id",
    "asset_version_id", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "scene_authority_reference",
    "scene_validation_subject_digest", "scene_subject_authority_expires_at"
  ) REFERENCES "hr_scene_validation_members" (
    "scene_validation_id", "member_index", "environment_id",
    "environment_mode", "environment_digest", "coverage_digest",
    "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id", "derivation_id",
    "asset_version_id", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "authority_reference",
    "scene_validation_subject_digest", "scene_authority_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_rights_actor_fk" FOREIGN KEY (
    "reviewed_profile_evidence_id", "rights_actor_role", "member_index",
    "rights_reviewer_actor_id", "reviewed_profile_subject_digest",
    "profile_expires_at"
  ) REFERENCES "hr_reviewed_profile_actors" (
    "reviewed_profile_evidence_id", "actor_role", "member_index", "actor_id",
    "reviewed_profile_subject_digest", "profile_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_profile_members_shape" CHECK ((
    "member_index" BETWEEN 0 AND 7
    AND "profile_member_count" BETWEEN 1 AND 8
    AND "member_index" < "profile_member_count"
    AND "file_ext" IN ('.sog', '.spz')
    AND "file_name" LIKE '%' || "file_ext"
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" BETWEEN 1 AND 16777216
    AND "created_at" < LEAST(
      "profile_expires_at", "derivation_receipt_expires_at",
      "rights_clearance_expires_at", "scene_subject_authority_expires_at"
    )
    AND "profile_expires_at" <= LEAST(
      "derivation_receipt_expires_at", "rights_clearance_expires_at",
      "scene_subject_authority_expires_at"
    )
    AND jsonb_typeof("member_body") = 'object'
    AND ("member_body"->>'memberIndex')::integer = "member_index"
    AND ("member_body"->>'assetVersionId')::uuid = "asset_version_id"
    AND "member_body"->>'fileName' = "file_name"
    AND "member_body"->>'fileExt' = "file_ext"
    AND "member_body"->>'mimeType' = "mime_type"
    AND "member_body"->>'sha256' = "sha256"
    AND ("member_body"->>'sizeBytes')::bigint = "size_bytes"
    AND ("member_body"->>'derivationOutputReceiptId')::uuid =
      "derivation_output_receipt_id"
    AND "member_body"->>'derivationMemberReceiptDigest' =
      "derivation_member_receipt_digest"
    AND ("member_body"->>'rightsClearanceId')::uuid = "rights_clearance_id"
    AND "member_body"->>'rightsClearanceDigest' = "rights_clearance_digest"
    AND ("member_body"->>'rightsReviewerActorId')::uuid =
      "rights_reviewer_actor_id"
    AND "member_body"->>'sceneCoverageDigest' = "scene_coverage_digest"
    AND "member_body"->>'sceneAuthorityReference' =
      "scene_authority_reference"
  ) IS TRUE),
  CONSTRAINT "hr_profile_members_asset_unique"
    UNIQUE ("reviewed_profile_evidence_id", "asset_version_id"),
  CONSTRAINT "hr_profile_members_receipt_unique"
    UNIQUE ("reviewed_profile_evidence_id", "derivation_output_receipt_id"),
  CONSTRAINT "hr_profile_members_rights_unique"
    UNIQUE ("reviewed_profile_evidence_id", "rights_clearance_id"),
  CONSTRAINT "hr_profile_members_exact_unique" UNIQUE (
    "reviewed_profile_evidence_id", "member_index", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "presentation_admission_id", "runtime_package_id",
    "derivation_id", "asset_version_id", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "rights_clearance_id",
    "rights_clearance_digest", "scene_validation_id",
    "scene_authority_reference", "profile_expires_at"
  )
);

CREATE TABLE "hr_reviewed_profiles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('reviewed_profile') STORED,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "reviewed_profile_subject_digest" varchar(64) NOT NULL,
  "subject_expires_at" timestamptz NOT NULL,
  "subject_prepared_at" timestamptz NOT NULL,
  "final_reviewer_attestation_id" uuid NOT NULL,
  "final_reviewer_attestation_digest" varchar(64) NOT NULL,
  "final_reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('profile_final_reviewer') STORED,
  "final_reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('reviewed_profile_subject') STORED,
  "final_reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "final_reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("reviewed_profile_subject_digest") STORED,
  "final_reviewer_actor_id" uuid NOT NULL,
  "final_reviewer_effective_at" timestamptz NOT NULL,
  "final_reviewer_attestation_expires_at" timestamptz NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "reviewed_profile_evidence_digest" varchar(64) NOT NULL,
  "reviewed_profile_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_reviewed_profiles_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "reviewed_profile_evidence_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_reviewed_profiles_subject_fk" FOREIGN KEY (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "final_reviewer_actor_id",
    "subject_prepared_at", "subject_expires_at"
  ) REFERENCES "hr_reviewed_profile_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "designated_final_reviewer_actor_id",
    "prepared_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_reviewed_profiles_final_reviewer_fk" FOREIGN KEY (
    "final_reviewer_attestation_id", "final_reviewer_attestation_digest",
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "final_reviewer_role", "final_reviewer_actor_id",
    "final_reviewer_bound_kind", "final_reviewer_bound_reference",
    "final_reviewer_bound_digest", "final_reviewer_effective_at",
    "final_reviewer_attestation_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_reviewed_profiles_shape" CHECK ((
    "subject_kind" = 'reviewed_profile'
    AND "reviewed_at" = "created_at"
    AND "reviewed_at" >= "subject_prepared_at"
    AND "reviewed_at" < "subject_expires_at"
    AND "final_reviewer_effective_at" <= "reviewed_at"
    AND "reviewed_at" < "expires_at"
    AND "expires_at" = LEAST(
      "subject_expires_at", "final_reviewer_attestation_expires_at"
    )
    AND "expires_at" <= "reviewed_at" + interval '90 days'
    AND "reviewed_profile_evidence_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("reviewed_profile_body") = 'object'
    AND "reviewed_profile_body"->>'schemaVersion' =
      'historical-runtime-reviewed-profile-evidence.v1'
    AND "reviewed_profile_body"->>'reviewedProfileSubjectDigest' =
      "reviewed_profile_subject_digest"
    AND ("reviewed_profile_body"->>'finalReviewerAttestationId')::uuid =
      "final_reviewer_attestation_id"
    AND "reviewed_profile_body"->>'finalReviewerAttestationDigest' =
      "final_reviewer_attestation_digest"
    AND ("reviewed_profile_body"->>'finalReviewerActorId')::uuid =
      "final_reviewer_actor_id"
    AND ("reviewed_profile_body"->>'finalReviewerAttestationExpiresAt')::timestamptz =
      "final_reviewer_attestation_expires_at"
    AND ("reviewed_profile_body"->>'reviewedAt')::timestamptz = "reviewed_at"
    AND ("reviewed_profile_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "reviewed_profile_body"->>'reviewedProfileEvidenceDigest' =
      "reviewed_profile_evidence_digest"
  ) IS TRUE),
  CONSTRAINT "hr_reviewed_profiles_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "reviewed_profile_evidence_digest",
    "final_reviewer_actor_id", "expires_at"
  )
);


-- Extend the 0066 exact typed-leaf guard under its existing evidence-owner
-- identity. No execution leaf is admitted by this migration.
SET LOCAL ROLE "omnitwin_historical_evidence_owner";
CREATE OR REPLACE FUNCTION "hr_assert_evidence_record_leaf_exact"(
  p_record_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  record_row "hr_evidence_records"%ROWTYPE;
  leaf_count integer;
  exact_count integer := 0;
BEGIN
  SELECT * INTO STRICT record_row
  FROM "hr_evidence_records"
  WHERE "id" = p_record_id
  FOR SHARE;

  SELECT count(*) INTO leaf_count
  FROM (
    SELECT "capture_root_id" AS id FROM "hr_capture_roots"
      WHERE "capture_root_id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_capture_clearances"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_derivations"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_transform_reviews"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_rights_clearances"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_twin_release_authorities"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_verified_twin_release_authorities"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_scene_validations"
      WHERE "id" = p_record_id
    UNION ALL SELECT "id" FROM "hr_reviewed_profiles"
      WHERE "id" = p_record_id
  ) AS typed_leaf;
  IF leaf_count <> 1 THEN
    RAISE EXCEPTION 'evidence record must resolve to exactly one typed leaf'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_evidence_record_exactly_one_leaf';
  END IF;

  CASE record_row."record_kind"
    WHEN 'capture_root' THEN
      SELECT count(*) INTO exact_count FROM "hr_capture_roots" AS leaf
      WHERE leaf."capture_root_id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."capture_root_evidence_digest" = record_row."record_digest"
        AND leaf."verified_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'capture_clearance' THEN
      SELECT count(*) INTO exact_count FROM "hr_capture_clearances" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."capture_clearance_digest" = record_row."record_digest"
        AND leaf."effective_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'derivation' THEN
      SELECT count(*) INTO exact_count FROM "hr_derivations" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."derivation_evidence_digest" = record_row."record_digest"
        AND leaf."created_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'transform_review' THEN
      SELECT count(*) INTO exact_count FROM "hr_transform_reviews" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."transform_review_digest" = record_row."record_digest"
        AND leaf."reviewed_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'rights_clearance' THEN
      SELECT count(*) INTO exact_count FROM "hr_rights_clearances" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."rights_clearance_digest" = record_row."record_digest"
        AND leaf."effective_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'twin_release_authority' THEN
      SELECT count(*) INTO exact_count FROM (
        SELECT leaf."id"
        FROM "hr_twin_release_authorities" AS leaf
        WHERE leaf."id" = record_row."id"
          AND leaf."subject_id" = record_row."subject_id"
          AND leaf."subject_kind" = record_row."subject_kind"
          AND leaf."environment_id" = record_row."environment_id"
          AND leaf."environment_mode" = record_row."environment_mode"
          AND leaf."environment_digest" = record_row."environment_digest"
          AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
          AND leaf."venue_id" = record_row."venue_id"
          AND leaf."space_id" = record_row."space_id"
          AND leaf."twin_release_authority_digest" = record_row."record_digest"
          AND leaf."approved_at" = record_row."effective_at"
          AND leaf."expires_at" = record_row."expires_at"
          AND leaf."created_at" = record_row."created_at"
        UNION ALL
        SELECT leaf."id"
        FROM "hr_verified_twin_release_authorities" AS leaf
        WHERE leaf."id" = record_row."id"
          AND leaf."subject_id" = record_row."subject_id"
          AND leaf."subject_kind" = record_row."subject_kind"
          AND leaf."environment_id" = record_row."environment_id"
          AND leaf."environment_mode" = record_row."environment_mode"
          AND leaf."environment_digest" = record_row."environment_digest"
          AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
          AND leaf."venue_id" = record_row."venue_id"
          AND leaf."space_id" = record_row."space_id"
          AND leaf."twin_release_authority_digest" = record_row."record_digest"
          AND leaf."approved_at" = record_row."effective_at"
          AND leaf."expires_at" = record_row."expires_at"
          AND leaf."created_at" = record_row."created_at"
      ) AS exact_twin_leaf;
    WHEN 'scene_validation' THEN
      SELECT count(*) INTO exact_count FROM "hr_scene_validations" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."scene_validation_digest" = record_row."record_digest"
        AND leaf."reviewed_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    WHEN 'reviewed_profile' THEN
      SELECT count(*) INTO exact_count FROM "hr_reviewed_profiles" AS leaf
      WHERE leaf."id" = record_row."id"
        AND leaf."subject_id" = record_row."subject_id"
        AND leaf."subject_kind" = record_row."subject_kind"
        AND leaf."environment_id" = record_row."environment_id"
        AND leaf."environment_mode" = record_row."environment_mode"
        AND leaf."environment_digest" = record_row."environment_digest"
        AND leaf."scope_epoch_id" = record_row."scope_epoch_id"
        AND leaf."venue_id" = record_row."venue_id"
        AND leaf."space_id" = record_row."space_id"
        AND leaf."reviewed_profile_evidence_digest" = record_row."record_digest"
        AND leaf."reviewed_at" = record_row."effective_at"
        AND leaf."expires_at" = record_row."expires_at"
        AND leaf."created_at" = record_row."created_at";
    ELSE
      exact_count := 0;
  END CASE;
  IF exact_count <> 1 THEN
    RAISE EXCEPTION 'evidence record does not exactly bind its typed leaf'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_evidence_record_typed_leaf_exact';
  END IF;
END;
$$;

RESET ROLE;

-- Profile QA authority must bind the exact immutable QA tuple inside the
-- signed role evidence. The legacy role graph binds only the record digest.
CREATE OR REPLACE FUNCTION "hr_assert_profile_qa_reviewer_current"(
  p_attestation_id uuid,
  p_profile_id uuid,
  p_admission_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  admission_row public."runtime_presentation_admissions"%ROWTYPE;
  role_row public."hr_role_attestations"%ROWTYPE;
  signed_evidence jsonb;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'runtime-presentation-admission', p_admission_id::text
  );
  SELECT * INTO STRICT admission_row
  FROM public."runtime_presentation_admissions"
  WHERE "id" = p_admission_id
  FOR SHARE;
  PERFORM public."hr_assert_role_attestation_current"(
    p_attestation_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, p_action_at
  );
  SELECT * INTO STRICT role_row
  FROM public."hr_role_attestations"
  WHERE "id" = p_attestation_id
    AND "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  PERFORM public."hr_assert_role_attestation_current"(
    p_attestation_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  signed_evidence := role_row."attestation_body"->'subject'->'evidence';
  IF admission_row."decision" <> 'approved'
     OR role_row."subject_id" IS DISTINCT FROM p_profile_id
     OR role_row."subject_kind" <> 'reviewed_profile'
     OR role_row."role" <> 'qa_reviewer'
     OR role_row."actor_id" IS DISTINCT FROM
        admission_row."runtime_qa_reviewed_by"
     OR role_row."bound_kind" <> 'runtime_qa_record'
     OR role_row."bound_reference" <> p_profile_id::text
     OR role_row."bound_digest" IS DISTINCT FROM
        admission_row."runtime_qa_record_digest"
     OR signed_evidence->>'schemaVersion' IS DISTINCT FROM
        'historical-runtime-role-qa-review.v1'
     OR signed_evidence->>'role' IS DISTINCT FROM 'qa_reviewer'
     OR signed_evidence->>'decision' IS DISTINCT FROM
        admission_row."runtime_qa_decision"
     OR (signed_evidence->>'runtimeQaRecordId')::uuid IS DISTINCT FROM
        admission_row."runtime_qa_record_id"
     OR signed_evidence->>'runtimeQaRecordDigest' IS DISTINCT FROM
        admission_row."runtime_qa_record_digest"
     OR role_row."effective_at" > wall_now
     OR role_row."expires_at" <= wall_now THEN
    RAISE EXCEPTION 'profile QA reviewer does not bind the exact QA record'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_qa_reviewer_exact';
  END IF;
  RETURN role_row."expires_at";
END;
$$;

-- Package custody commits both the immutable package bytes and manifest.
-- The legacy bound digest covers only the manifest, so both signed fields are
-- checked at each profile issuance/currentness boundary.
CREATE OR REPLACE FUNCTION "hr_assert_profile_package_custodian_current"(
  p_attestation_id uuid,
  p_profile_id uuid,
  p_admission_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  admission_row public."runtime_presentation_admissions"%ROWTYPE;
  role_row public."hr_role_attestations"%ROWTYPE;
  signed_evidence jsonb;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'runtime-presentation-admission', p_admission_id::text
  );
  SELECT * INTO STRICT admission_row
  FROM public."runtime_presentation_admissions"
  WHERE "id" = p_admission_id
  FOR SHARE;
  PERFORM public."hr_assert_role_attestation_current"(
    p_attestation_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, p_action_at
  );
  SELECT * INTO STRICT role_row
  FROM public."hr_role_attestations"
  WHERE "id" = p_attestation_id
    AND "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  PERFORM public."hr_assert_role_attestation_current"(
    p_attestation_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  signed_evidence := role_row."attestation_body"->'subject'->'evidence';
  IF admission_row."decision" <> 'approved'
     OR role_row."subject_id" IS DISTINCT FROM p_profile_id
     OR role_row."subject_kind" <> 'reviewed_profile'
     OR role_row."role" <> 'package_custodian'
     OR role_row."bound_kind" <> 'runtime_manifest'
     OR role_row."bound_reference" <> p_profile_id::text
     OR role_row."bound_digest" IS DISTINCT FROM
        admission_row."runtime_manifest_digest"
     OR signed_evidence->>'schemaVersion' IS DISTINCT FROM
        'historical-runtime-role-package-custodian.v1'
     OR signed_evidence->>'role' IS DISTINCT FROM 'package_custodian'
     OR signed_evidence->>'runtimePackageContentDigest' IS DISTINCT FROM
        admission_row."runtime_package_content_digest"
     OR signed_evidence->>'runtimeManifestDigest' IS DISTINCT FROM
        admission_row."runtime_manifest_digest"
     OR role_row."effective_at" > wall_now
     OR role_row."expires_at" <= wall_now THEN
    RAISE EXCEPTION 'package custodian does not bind the exact package and manifest'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_package_custodian_exact';
  END IF;
  RETURN role_row."expires_at";
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_profile_graph_complete"(
  p_reviewed_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  profile_subject "hr_reviewed_profile_subjects"%ROWTYPE;
  final_profile "hr_reviewed_profiles"%ROWTYPE;
  member_count bigint;
  member_min integer;
  member_max integer;
  total_bytes bigint;
  actor_count bigint;
  members_body jsonb;
  rights_actor_ids jsonb;
  rights_expiries jsonb;
  actor_map_body jsonb;
  constituent_expiries jsonb;
  subject_material jsonb;
  expected_subject_digest text;
  final_material jsonb;
BEGIN
  PERFORM "hr_lock_authority"(
    'reviewed-profile', p_reviewed_profile_id::text
  );
  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = p_reviewed_profile_id
  FOR SHARE;

  IF NOT EXISTS (
    SELECT 1
    FROM "hr_scene_validation_subjects" AS scene_subject
    WHERE scene_subject."id" = profile_subject."scene_validation_id"
      AND scene_subject."presentation_admission_id" =
        profile_subject."presentation_admission_id"
      AND scene_subject."presentation_admission_reviewer_actor_id" =
        profile_subject."presentation_admission_reviewed_by"
  ) THEN
    RAISE EXCEPTION 'Scene and profile admission authorities must share the normalized admission actor'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_scene_admission_actor_exact';
  END IF;

  SELECT count(*), min("member_index"), max("member_index"),
    COALESCE(sum("size_bytes"), 0),
    jsonb_agg(jsonb_build_object(
      'assetVersionId', "asset_version_id"::text,
      'derivationMemberReceiptDigest', "derivation_member_receipt_digest",
      'derivationOutputReceiptId', "derivation_output_receipt_id"::text,
      'fileExt', "file_ext",
      'fileName', "file_name",
      'memberIndex', "member_index",
      'mimeType', "mime_type",
      'rightsClearanceDigest', "rights_clearance_digest",
      'rightsClearanceId', "rights_clearance_id"::text,
      'rightsReviewerActorId', "rights_reviewer_actor_id"::text,
      'sceneAuthorityReference', "scene_authority_reference",
      'sceneCoverageDigest', "scene_coverage_digest",
      'sha256', "sha256",
      'sizeBytes', "size_bytes"
    ) ORDER BY "member_index"),
    jsonb_agg(to_jsonb("rights_reviewer_actor_id"::text)
      ORDER BY "member_index"),
    jsonb_agg(to_jsonb("hr_iso_utc_ms"("rights_clearance_expires_at"))
      ORDER BY "member_index")
  INTO member_count, member_min, member_max, total_bytes, members_body,
    rights_actor_ids, rights_expiries
  FROM "hr_reviewed_profile_members"
  WHERE "reviewed_profile_evidence_id" = p_reviewed_profile_id;
  IF member_count <> profile_subject."member_count"
     OR member_min IS DISTINCT FROM 0
     OR member_max IS DISTINCT FROM profile_subject."member_count" - 1
     OR total_bytes <> profile_subject."total_bytes" THEN
    RAISE EXCEPTION 'Reviewed-profile members are incomplete or totals differ'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_members_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "hr_reviewed_profile_members" AS member
    WHERE member."reviewed_profile_evidence_id" = p_reviewed_profile_id
      AND member."member_body" IS DISTINCT FROM jsonb_build_object(
        'assetVersionId', member."asset_version_id"::text,
        'derivationMemberReceiptDigest',
          member."derivation_member_receipt_digest",
        'derivationOutputReceiptId',
          member."derivation_output_receipt_id"::text,
        'fileExt', member."file_ext",
        'fileName', member."file_name",
        'memberIndex', member."member_index",
        'mimeType', member."mime_type",
        'rightsClearanceDigest', member."rights_clearance_digest",
        'rightsClearanceId', member."rights_clearance_id"::text,
        'rightsReviewerActorId', member."rights_reviewer_actor_id"::text,
        'sceneAuthorityReference', member."scene_authority_reference",
        'sceneCoverageDigest', member."scene_coverage_digest",
        'sha256', member."sha256",
        'sizeBytes', member."size_bytes"
      )
  ) THEN
    RAISE EXCEPTION 'Reviewed-profile member body is substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_member_exact_body';
  END IF;

  SELECT count(*) INTO actor_count
  FROM "hr_reviewed_profile_actors"
  WHERE "reviewed_profile_evidence_id" = p_reviewed_profile_id;
  IF actor_count <> 16 + profile_subject."member_count" THEN
    RAISE EXCEPTION 'Reviewed-profile actor graph is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_actors_complete';
  END IF;
  IF EXISTS (
    WITH expected("actor_role", "member_index", "actor_id") AS (
      VALUES
        ('capture_creator'::text, NULL::integer,
          profile_subject."capture_creator_actor_id"),
        ('source_custodian', NULL,
          profile_subject."source_custodian_actor_id"),
        ('owner_authorizer', NULL,
          profile_subject."owner_authorizer_actor_id"),
        ('privacy_reviewer', NULL,
          profile_subject."privacy_reviewer_actor_id"),
        ('movable_content_reviewer', NULL,
          profile_subject."movable_content_reviewer_actor_id"),
        ('normalizer', NULL, profile_subject."normalizer_actor_id"),
        ('capture_final_reviewer', NULL,
          profile_subject."capture_final_reviewer_actor_id"),
        ('derivative_producer', NULL,
          profile_subject."derivative_producer_actor_id"),
        ('derivative_custodian', NULL,
          profile_subject."derivative_custodian_actor_id"),
        ('derivative_reviewer', NULL,
          profile_subject."derivation_reviewer_actor_id"),
        ('package_custodian', NULL,
          profile_subject."package_custodian_actor_id"),
        ('qa_reviewer', NULL, profile_subject."runtime_qa_reviewed_by"),
        ('transform_reviewer', NULL,
          profile_subject."transform_reviewer_actor_id"),
        ('scene_reviewer', NULL, profile_subject."scene_reviewer_actor_id"),
        ('admission_reviewer', NULL,
          profile_subject."presentation_admission_reviewed_by"),
        ('profile_final_reviewer', NULL,
          profile_subject."designated_final_reviewer_actor_id")
      UNION ALL
      SELECT 'rights_reviewer', member."member_index",
        member."rights_reviewer_actor_id"
      FROM "hr_reviewed_profile_members" AS member
      WHERE member."reviewed_profile_evidence_id" = p_reviewed_profile_id
    )
    SELECT 1 FROM expected
    LEFT JOIN "hr_reviewed_profile_actors" AS actual
      ON actual."reviewed_profile_evidence_id" = p_reviewed_profile_id
      AND actual."actor_role" = expected."actor_role"
      AND actual."member_index" IS NOT DISTINCT FROM expected."member_index"
      AND actual."actor_id" = expected."actor_id"
    WHERE actual."actor_id" IS NULL
  ) OR EXISTS (
    WITH expected("actor_role", "member_index", "actor_id") AS (
      VALUES
        ('capture_creator'::text, NULL::integer,
          profile_subject."capture_creator_actor_id"),
        ('source_custodian', NULL,
          profile_subject."source_custodian_actor_id"),
        ('owner_authorizer', NULL,
          profile_subject."owner_authorizer_actor_id"),
        ('privacy_reviewer', NULL,
          profile_subject."privacy_reviewer_actor_id"),
        ('movable_content_reviewer', NULL,
          profile_subject."movable_content_reviewer_actor_id"),
        ('normalizer', NULL, profile_subject."normalizer_actor_id"),
        ('capture_final_reviewer', NULL,
          profile_subject."capture_final_reviewer_actor_id"),
        ('derivative_producer', NULL,
          profile_subject."derivative_producer_actor_id"),
        ('derivative_custodian', NULL,
          profile_subject."derivative_custodian_actor_id"),
        ('derivative_reviewer', NULL,
          profile_subject."derivation_reviewer_actor_id"),
        ('package_custodian', NULL,
          profile_subject."package_custodian_actor_id"),
        ('qa_reviewer', NULL, profile_subject."runtime_qa_reviewed_by"),
        ('transform_reviewer', NULL,
          profile_subject."transform_reviewer_actor_id"),
        ('scene_reviewer', NULL, profile_subject."scene_reviewer_actor_id"),
        ('admission_reviewer', NULL,
          profile_subject."presentation_admission_reviewed_by"),
        ('profile_final_reviewer', NULL,
          profile_subject."designated_final_reviewer_actor_id")
      UNION ALL
      SELECT 'rights_reviewer', member."member_index",
        member."rights_reviewer_actor_id"
      FROM "hr_reviewed_profile_members" AS member
      WHERE member."reviewed_profile_evidence_id" = p_reviewed_profile_id
    )
    SELECT 1 FROM "hr_reviewed_profile_actors" AS actual
    LEFT JOIN expected
      ON actual."actor_role" = expected."actor_role"
      AND actual."member_index" IS NOT DISTINCT FROM expected."member_index"
      AND actual."actor_id" = expected."actor_id"
    WHERE actual."reviewed_profile_evidence_id" = p_reviewed_profile_id
      AND expected."actor_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Reviewed-profile normalized actors differ from authority leaves'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_actor_provenance';
  END IF;

  actor_map_body := jsonb_build_object(
    'admissionReviewerActorId',
      profile_subject."presentation_admission_reviewed_by"::text,
    'captureCreatorActorId', profile_subject."capture_creator_actor_id"::text,
    'captureFinalReviewerActorId',
      profile_subject."capture_final_reviewer_actor_id"::text,
    'derivativeCustodianActorId',
      profile_subject."derivative_custodian_actor_id"::text,
    'derivativeProducerActorId',
      profile_subject."derivative_producer_actor_id"::text,
    'derivativeReviewerActorId',
      profile_subject."derivation_reviewer_actor_id"::text,
    'designatedFinalReviewerActorId',
      profile_subject."designated_final_reviewer_actor_id"::text,
    'movableContentReviewerActorId',
      profile_subject."movable_content_reviewer_actor_id"::text,
    'normalizerActorId', profile_subject."normalizer_actor_id"::text,
    'ownerAuthorizerActorId',
      profile_subject."owner_authorizer_actor_id"::text,
    'packageCustodianActorId',
      profile_subject."package_custodian_actor_id"::text,
    'privacyReviewerActorId',
      profile_subject."privacy_reviewer_actor_id"::text,
    'qaReviewerActorId', profile_subject."runtime_qa_reviewed_by"::text,
    'rightsReviewerActorIds', rights_actor_ids,
    'sceneReviewerActorId', profile_subject."scene_reviewer_actor_id"::text,
    'sourceCustodianActorId',
      profile_subject."source_custodian_actor_id"::text,
    'transformReviewerActorId',
      profile_subject."transform_reviewer_actor_id"::text
  );
  constituent_expiries := jsonb_build_object(
    'admissionReviewerAttestationExpiresAt',
      "hr_iso_utc_ms"(profile_subject."admission_reviewer_expires_at"),
    'captureClearanceExpiresAt',
      "hr_iso_utc_ms"(profile_subject."capture_clearance_expires_at"),
    'derivationReviewExpiresAt',
      "hr_iso_utc_ms"(profile_subject."derivation_expires_at"),
    'packageCustodianAttestationExpiresAt',
      "hr_iso_utc_ms"(profile_subject."package_custodian_expires_at"),
    'rightsClearanceExpiresAt', rights_expiries,
    'runtimeQaAuthorityExpiresAt',
      "hr_iso_utc_ms"(profile_subject."qa_reviewer_expires_at"),
    'sceneValidationExpiresAt',
      "hr_iso_utc_ms"(profile_subject."scene_validation_expires_at"),
    'transformReviewExpiresAt',
      "hr_iso_utc_ms"(profile_subject."transform_review_expires_at")
  );
  IF profile_subject."expires_at" IS DISTINCT FROM LEAST(
    profile_subject."capture_clearance_expires_at",
    profile_subject."derivation_expires_at",
    profile_subject."qa_reviewer_expires_at",
    profile_subject."transform_review_expires_at",
    profile_subject."scene_validation_expires_at",
    profile_subject."package_custodian_expires_at",
    profile_subject."admission_reviewer_expires_at",
    (SELECT min("rights_clearance_expires_at")
     FROM "hr_reviewed_profile_members"
     WHERE "reviewed_profile_evidence_id" = p_reviewed_profile_id),
    (SELECT min("derivation_receipt_expires_at")
     FROM "hr_reviewed_profile_members"
     WHERE "reviewed_profile_evidence_id" = p_reviewed_profile_id)
  ) THEN
    RAISE EXCEPTION 'Reviewed-profile expiry is not exact constituent minimum'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_expiry_exact';
  END IF;

  subject_material := jsonb_build_object(
    'actorMap', actor_map_body,
    'actorMapDigest', profile_subject."actor_map_digest",
    'admissionReviewerAttestationDigest',
      profile_subject."admission_reviewer_attestation_digest",
    'admissionReviewerAttestationId',
      profile_subject."admission_reviewer_attestation_id"::text,
    'captureClearanceDigest', profile_subject."capture_clearance_digest",
    'captureClearanceId', profile_subject."capture_clearance_id"::text,
    'captureContentSubjectDigest',
      profile_subject."capture_content_subject_digest",
    'captureRootEvidenceDigest', profile_subject."capture_root_evidence_digest",
    'captureRootId', profile_subject."capture_root_id"::text,
    'constituentExpiries', constituent_expiries,
    'derivationEvidenceDigest', profile_subject."derivation_evidence_digest",
    'derivationId', profile_subject."derivation_id"::text,
    'expiresAt', "hr_iso_utc_ms"(profile_subject."expires_at"),
    'memberCount', profile_subject."member_count",
    'members', members_body,
    'membersDigest', profile_subject."members_digest",
    'packageCustodianAttestationDigest',
      profile_subject."package_custodian_attestation_digest",
    'packageCustodianAttestationId',
      profile_subject."package_custodian_attestation_id"::text,
    'preparedAt', "hr_iso_utc_ms"(profile_subject."prepared_at"),
    'presentationAdmissionDigest',
      profile_subject."presentation_admission_digest",
    'presentationAdmissionId',
      profile_subject."presentation_admission_id"::text,
    'presentationAdmissionReviewedAt',
      "hr_iso_utc_ms"(profile_subject."presentation_admission_reviewed_at"),
    'presentationAdmissionReviewedBy',
      profile_subject."presentation_admission_reviewed_by"::text,
    'qaReviewerAttestationDigest',
      profile_subject."qa_reviewer_attestation_digest",
    'qaReviewerAttestationId',
      profile_subject."qa_reviewer_attestation_id"::text,
    'reviewedProfileEvidenceId', profile_subject."id"::text,
    'reviewedProfileId', profile_subject."reviewed_profile_id",
    'reviewedProfileManifestFingerprint',
      profile_subject."reviewed_profile_manifest_fingerprint",
    'runtimeManifestDigest', profile_subject."runtime_manifest_digest",
    'runtimePackageContentDigest',
      profile_subject."runtime_package_content_digest",
    'runtimePackageId', profile_subject."runtime_package_id"::text,
    'runtimePackageRevision', profile_subject."runtime_package_revision",
    'runtimeQaDecision', profile_subject."runtime_qa_decision",
    'runtimeQaRecordDigest', profile_subject."runtime_qa_record_digest",
    'runtimeQaRecordId', profile_subject."runtime_qa_record_id"::text,
    'runtimeQaRecordKey', profile_subject."runtime_qa_record_key",
    'runtimeQaReviewedAt',
      "hr_iso_utc_ms"(profile_subject."runtime_qa_reviewed_at"),
    'runtimeQaReviewedBy', profile_subject."runtime_qa_reviewed_by"::text,
    'sceneValidationDigest', profile_subject."scene_validation_digest",
    'sceneValidationId', profile_subject."scene_validation_id"::text,
    'schemaVersion', 'historical-runtime-reviewed-profile-subject.v1',
    'spaceId', profile_subject."space_id"::text,
    'totalBytes', profile_subject."total_bytes",
    'transformReviewDigest', profile_subject."transform_review_digest",
    'transformReviewId', profile_subject."transform_review_id"::text,
    'venueId', profile_subject."venue_id"::text
  );
  IF profile_subject."members_digest" IS DISTINCT FROM encode(digest(convert_to(
       E'venviewer.historical-runtime-reviewed-profile-members.v1\n'
         || "hr_stable_canonical_json"(members_body), 'UTF8'
     ), 'sha256'), 'hex')
     OR profile_subject."actor_map_digest" IS DISTINCT FROM encode(digest(
       convert_to(
         E'venviewer.historical-runtime-reviewed-profile-actor-map.v1\n'
           || "hr_stable_canonical_json"(actor_map_body), 'UTF8'
       ), 'sha256'
     ), 'hex') THEN
    RAISE EXCEPTION 'Reviewed-profile aggregate digest differs from rows'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_aggregate_digest';
  END IF;
  expected_subject_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-reviewed-profile-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material), 'UTF8'
  ), 'sha256'), 'hex');
  IF profile_subject."reviewed_profile_subject_digest" IS DISTINCT FROM
       expected_subject_digest
     OR profile_subject."subject_body" IS DISTINCT FROM
       subject_material || jsonb_build_object(
         'reviewedProfileSubjectDigest', expected_subject_digest
       ) THEN
    RAISE EXCEPTION 'Reviewed-profile subject body is not exact relational graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_subject_exact_body';
  END IF;

  SELECT * INTO final_profile
  FROM "hr_reviewed_profiles"
  WHERE "id" = p_reviewed_profile_id
  FOR SHARE;
  IF FOUND THEN
    final_material := jsonb_build_object(
      'expiresAt', "hr_iso_utc_ms"(final_profile."expires_at"),
      'finalReviewerActorId', final_profile."final_reviewer_actor_id"::text,
      'finalReviewerAttestationDigest',
        final_profile."final_reviewer_attestation_digest",
      'finalReviewerAttestationExpiresAt',
        "hr_iso_utc_ms"(final_profile."final_reviewer_attestation_expires_at"),
      'finalReviewerAttestationId',
        final_profile."final_reviewer_attestation_id"::text,
      'reviewedAt', "hr_iso_utc_ms"(final_profile."reviewed_at"),
      'reviewedProfileSubjectDigest', expected_subject_digest,
      'schemaVersion', 'historical-runtime-reviewed-profile-evidence.v1',
      'subject', profile_subject."subject_body"
    );
    IF final_profile."reviewed_profile_evidence_digest" IS DISTINCT FROM
         encode(digest(convert_to(
           E'venviewer.historical-runtime-reviewed-profile-evidence.v1\n'
             || "hr_stable_canonical_json"(final_material), 'UTF8'
         ), 'sha256'), 'hex')
       OR final_profile."reviewed_profile_body" IS DISTINCT FROM
         final_material || jsonb_build_object(
           'reviewedProfileEvidenceDigest',
             final_profile."reviewed_profile_evidence_digest"
         ) THEN
      RAISE EXCEPTION 'Final reviewed-profile receipt substitutes its subject'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_profile_final_exact_body';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_profile_graph_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_body jsonb := to_jsonb(NEW);
  profile_id uuid;
BEGIN
  profile_id := COALESCE(
    (row_body->>'reviewed_profile_evidence_id')::uuid,
    (row_body->>'id')::uuid
  );
  PERFORM "hr_assert_profile_graph_complete"(profile_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_profile_subject_graph_complete"
  AFTER INSERT ON "hr_reviewed_profile_subjects"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_profile_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_profile_actor_graph_complete"
  AFTER INSERT ON "hr_reviewed_profile_actors"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_profile_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_profile_member_graph_complete"
  AFTER INSERT ON "hr_reviewed_profile_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_profile_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_profile_final_graph_complete"
  AFTER INSERT ON "hr_reviewed_profiles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_profile_graph_deferred_guard"();
CREATE OR REPLACE FUNCTION public.hr_issue_reviewed_profile_subject()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  check_at timestamptz;
  action_at timestamptz;
  requested_profile_id text := NEW."reviewed_profile_id";
  rights_ids jsonb := NEW."subject_body"->'rightsClearanceIds';
  admission_row "runtime_presentation_admissions"%ROWTYPE;
  package_row "runtime_packages"%ROWTYPE;
  capture_subject "hr_capture_content_subjects"%ROWTYPE;
  capture_root "hr_capture_roots"%ROWTYPE;
  clearance_row "hr_capture_clearances"%ROWTYPE;
  derivation_row "hr_derivations"%ROWTYPE;
  transform_row "hr_transform_reviews"%ROWTYPE;
  scene_subject "hr_scene_validation_subjects"%ROWTYPE;
  scene_final "hr_scene_validations"%ROWTYPE;
  package_role "hr_role_attestations"%ROWTYPE;
  qa_role "hr_role_attestations"%ROWTYPE;
  admission_role "hr_role_attestations"%ROWTYPE;
  rights_row "hr_rights_clearances"%ROWTYPE;
  derivation_member "hr_derivation_members"%ROWTYPE;
  scene_member "hr_scene_validation_members"%ROWTYPE;
  record_identity record;
  role_id uuid;
  receipt_id uuid;
  staged_right record;
  final_actor_id uuid;
  member_body jsonb;
  members_body jsonb := '[]'::jsonb;
  rights_actor_ids jsonb := '[]'::jsonb;
  rights_expiries jsonb := '[]'::jsonb;
  actor_map_body jsonb;
  constituent_expiries jsonb;
  subject_material jsonb;
  total_bytes bigint := 0;
  minimum_rights_expiry timestamptz;
BEGIN
  IF jsonb_typeof(rights_ids) <> 'array'
     OR jsonb_array_length(rights_ids) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'reviewed profile requires ordered rights-clearance ids'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_rights_staging';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(rights_ids) AS supplied(id)
    GROUP BY supplied.id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'reviewed profile rights-clearance ids are not unique'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_rights_staging';
  END IF;

  -- Discover the immutable scope without taking a row lock before the
  -- canonical scope advisory lock, then re-read every leaf under locks.
  SELECT * INTO STRICT clearance_row
  FROM "hr_capture_clearances"
  WHERE "id" = NEW."capture_clearance_id";
  NEW."environment_id" := clearance_row."environment_id";
  NEW."environment_mode" := clearance_row."environment_mode";
  NEW."environment_digest" := clearance_row."environment_digest";
  NEW."scope_epoch_id" := clearance_row."scope_epoch_id";
  NEW."venue_id" := clearance_row."venue_id";
  NEW."space_id" := clearance_row."space_id";
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_lock_authority"('reviewed-profile', NEW."id"::text);
  PERFORM "hr_lock_authority"(
    'runtime-presentation-admission', NEW."presentation_admission_id"::text
  );
  check_at := "hr_wall_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );

  SELECT * INTO STRICT clearance_row
  FROM "hr_capture_clearances"
  WHERE "id" = NEW."capture_clearance_id"
  FOR SHARE;
  SELECT * INTO STRICT capture_root
  FROM "hr_capture_roots"
  WHERE "capture_root_id" = clearance_row."capture_root_id"
  FOR SHARE;
  SELECT * INTO STRICT capture_subject
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = clearance_row."capture_root_id"
  FOR SHARE;
  SELECT * INTO STRICT derivation_row
  FROM "hr_derivations"
  WHERE "id" = NEW."derivation_id"
  FOR SHARE;
  SELECT * INTO STRICT transform_row
  FROM "hr_transform_reviews"
  WHERE "id" = NEW."transform_review_id"
  FOR SHARE;
  SELECT * INTO STRICT scene_subject
  FROM "hr_scene_validation_subjects"
  WHERE "id" = NEW."scene_validation_id"
  FOR SHARE;
  SELECT * INTO STRICT scene_final
  FROM "hr_scene_validations"
  WHERE "id" = NEW."scene_validation_id"
  FOR SHARE;
  SELECT * INTO STRICT admission_row
  FROM "runtime_presentation_admissions"
  WHERE "id" = NEW."presentation_admission_id"
  FOR SHARE;
  SELECT * INTO STRICT package_row
  FROM "runtime_packages"
  WHERE "id" = admission_row."runtime_package_id"
  FOR SHARE;

  IF requested_profile_id IS DISTINCT FROM admission_row."reviewed_profile_id"
     OR clearance_row."capture_root_id" IS DISTINCT FROM
       derivation_row."capture_root_id"
     OR derivation_row."capture_clearance_id" IS DISTINCT FROM
        clearance_row."id"
     OR transform_row."presentation_admission_id" IS DISTINCT FROM
        admission_row."id"
     OR scene_subject."presentation_admission_id" IS DISTINCT FROM
        admission_row."id"
     OR scene_subject."presentation_admission_reviewer_actor_id" IS DISTINCT FROM
        admission_row."reviewed_by"
     OR scene_subject."transform_review_id" IS DISTINCT FROM
        transform_row."id"
     OR scene_final."scene_validation_subject_digest" IS DISTINCT FROM
        scene_subject."scene_validation_subject_digest"
     OR jsonb_array_length(rights_ids) <> derivation_row."member_count"
     OR derivation_row."member_count" <> admission_row."member_count"
     OR scene_subject."member_count" <> admission_row."member_count" THEN
    RAISE EXCEPTION 'reviewed-profile leaves do not share one exact graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_leaf_graph';
  END IF;

  -- Current evidence records are locked in UUID order. This includes every
  -- per-member rights authority and the test-only twin wrapper selected by
  -- the exact Scene subject.
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (
      SELECT fixed.id, fixed.kind
      FROM (VALUES
        (capture_root."capture_root_id", 'capture_root'::text),
        (clearance_row."id", 'capture_clearance'::text),
        (derivation_row."id", 'derivation'::text),
        (transform_row."id", 'transform_review'::text),
        (scene_final."id", 'scene_validation'::text),
        (scene_subject."twin_release_authority_id",
          'twin_release_authority'::text)
      ) AS fixed(id, kind)
      UNION ALL
      SELECT supplied.id::uuid, 'rights_clearance'::text
      FROM jsonb_array_elements_text(rights_ids) AS supplied(id)
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind, NEW."environment_id",
      NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
      NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_twin_release_authority_current"(
    scene_subject."twin_release_authority_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_derivation_current"(
    derivation_row."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    transform_row."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );

  SELECT * INTO STRICT package_role
  FROM "hr_role_attestations"
  WHERE "id" = NEW."package_custodian_attestation_id"
  FOR SHARE;
  SELECT * INTO STRICT qa_role
  FROM "hr_role_attestations"
  WHERE "id" = NEW."qa_reviewer_attestation_id"
  FOR SHARE;
  SELECT * INTO STRICT admission_role
  FROM "hr_role_attestations"
  WHERE "id" = NEW."admission_reviewer_attestation_id"
  FOR SHARE;

  IF admission_role."actor_id" IS DISTINCT FROM admission_row."reviewed_by"
     OR scene_subject."presentation_admission_reviewer_actor_id" IS DISTINCT FROM
        admission_row."reviewed_by" THEN
    RAISE EXCEPTION 'Scene and profile admission authorities must share the normalized admission actor'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_scene_admission_actor_exact';
  END IF;

  FOR role_id IN
    SELECT candidate.id
    FROM (
      SELECT fixed.id FROM (VALUES
        (package_role."id"), (qa_role."id"), (admission_role."id"),
        (capture_subject."capture_operator_attestation_id"),
        (capture_subject."source_custodian_attestation_id"),
        (capture_root."normalizer_attestation_id"),
        (clearance_row."owner_attestation_id"),
        (clearance_row."privacy_attestation_id"),
        (clearance_row."movable_attestation_id"),
        (clearance_row."final_attestation_id"),
        (derivation_row."producer_attestation_id"),
        (derivation_row."custodian_attestation_id"),
        (derivation_row."reviewer_attestation_id"),
        (transform_row."reviewer_attestation_id"),
        (scene_subject."presentation_admission_reviewer_attestation_id"),
        (scene_final."reviewer_attestation_id")
      ) AS fixed(id)
      UNION
      SELECT rights."reviewer_attestation_id"
      FROM "hr_rights_clearances" AS rights
      JOIN jsonb_array_elements_text(rights_ids) AS supplied(id)
        ON rights."id" = supplied.id::uuid
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    admission_role."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  IF scene_subject."presentation_admission_reviewer_attestation_id" <>
       admission_role."id" THEN
    PERFORM "hr_assert_presentation_admission_reviewer_current"(
      scene_subject."presentation_admission_reviewer_attestation_id",
      admission_row."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END IF;
  PERFORM "hr_assert_profile_qa_reviewer_current"(
    qa_role."id", NEW."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_profile_package_custodian_current"(
    package_role."id", NEW."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  IF scene_subject."scene_map_verification_receipt_id" IS NULL THEN
    RAISE EXCEPTION 'reviewed profile requires a compact Scene verification receipt'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_scene_map_receipt_required';
  END IF;
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    scene_subject."scene_map_verification_receipt_id",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."venue_id", NEW."space_id", check_at
  );

  -- Exact source, derivative, and Scene byte receipts are the last lock class.
  FOR receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT member."receipt_id" AS id
      FROM "hr_source_receipt_members" AS member
      WHERE member."source_set_id" = capture_subject."source_set_id"
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = derivation_row."id"
      UNION
      SELECT scene_subject."scene_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_source_receipt_set_complete"(
    capture_subject."source_set_id"
  );
  PERFORM "hr_assert_normalized_content_complete"(
    capture_subject."normalization_id"
  );
  PERFORM "hr_assert_derivation_graph_complete"(derivation_row."id");
  PERFORM "hr_assert_scene_graph_complete"(scene_subject."id");

  -- Rehydrate every ordered member from the exact derivation, current rights,
  -- and exact Scene-coverage rows. Nothing in the staging array other than
  -- the ordered clearance IDs is retained.
  FOR staged_right IN
    SELECT supplied.id::uuid AS rights_id,
      (supplied.ordinal - 1)::integer AS member_index
    FROM jsonb_array_elements_text(rights_ids)
      WITH ORDINALITY AS supplied(id, ordinal)
    ORDER BY supplied.ordinal
  LOOP
    SELECT * INTO STRICT rights_row
    FROM "hr_rights_clearances"
    WHERE "id" = staged_right.rights_id
    FOR SHARE;
    SELECT * INTO STRICT derivation_member
    FROM "hr_derivation_members"
    WHERE "derivation_id" = derivation_row."id"
      AND "member_index" = staged_right.member_index
    FOR SHARE;
    SELECT * INTO STRICT scene_member
    FROM "hr_scene_validation_members"
    WHERE "scene_validation_id" = scene_subject."id"
      AND "member_index" = staged_right.member_index
    FOR SHARE;
    IF rights_row."derivation_id" IS DISTINCT FROM derivation_row."id"
       OR rights_row."member_index" IS DISTINCT FROM
          staged_right.member_index
       OR rights_row."asset_version_id" IS DISTINCT FROM
          derivation_member."asset_version_id"
       OR rights_row."output_receipt_id" IS DISTINCT FROM
          derivation_member."output_receipt_id"
       OR scene_member."derivation_id" IS DISTINCT FROM derivation_row."id"
       OR scene_member."asset_version_id" IS DISTINCT FROM
          derivation_member."asset_version_id"
       OR scene_member."derivation_output_receipt_id" IS DISTINCT FROM
          derivation_member."output_receipt_id" THEN
      RAISE EXCEPTION 'profile member does not intersect derivation, rights, and Scene'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_profile_member_intersection';
    END IF;
    member_body := jsonb_build_object(
      'assetVersionId', derivation_member."asset_version_id"::text,
      'derivationMemberReceiptDigest',
        derivation_member."output_receipt_digest",
      'derivationOutputReceiptId',
        derivation_member."output_receipt_id"::text,
      'fileExt', derivation_member."file_ext",
      'fileName', derivation_member."file_name",
      'memberIndex', staged_right.member_index,
      'mimeType', derivation_member."mime_type",
      'rightsClearanceDigest', rights_row."rights_clearance_digest",
      'rightsClearanceId', rights_row."id"::text,
      'rightsReviewerActorId', rights_row."reviewer_actor_id"::text,
      'sceneAuthorityReference', scene_member."authority_reference",
      'sceneCoverageDigest', scene_member."coverage_digest",
      'sha256', derivation_member."sha256",
      'sizeBytes', derivation_member."size_bytes"
    );
    members_body := members_body || jsonb_build_array(member_body);
    rights_actor_ids := rights_actor_ids || jsonb_build_array(
      rights_row."reviewer_actor_id"::text
    );
    rights_expiries := rights_expiries || jsonb_build_array(
      "hr_iso_utc_ms"(rights_row."expires_at")
    );
    total_bytes := total_bytes + derivation_member."size_bytes";
    minimum_rights_expiry := CASE
      WHEN minimum_rights_expiry IS NULL THEN rights_row."expires_at"
      ELSE LEAST(minimum_rights_expiry, rights_row."expires_at")
    END;
  END LOOP;

  SELECT "id" INTO STRICT final_actor_id
  FROM "users"
  WHERE "id" = NEW."designated_final_reviewer_actor_id"
  FOR SHARE;
  action_at := "hr_db_clock_ms"();
  IF action_at < check_at THEN
    RAISE EXCEPTION 'reviewed-profile action clock moved behind its lock fence'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_profile_clock_monotonic';
  END IF;
  check_at := GREATEST(check_at, action_at, "hr_wall_clock_ms"());

  -- Every potentially blocking lock has now been acquired. Repeat the full
  -- authority sweep at a fresh wall instant so no wait can preserve a stale
  -- constituent in the immutable profile subject.
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_derivation_current"(
    derivation_row."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    transform_row."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_twin_release_authority_current"(
    scene_subject."twin_release_authority_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    scene_subject."scene_map_verification_receipt_id",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    admission_role."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  IF scene_subject."presentation_admission_reviewer_attestation_id" <>
       admission_role."id" THEN
    PERFORM "hr_assert_presentation_admission_reviewer_current"(
      scene_subject."presentation_admission_reviewer_attestation_id",
      admission_row."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END IF;
  PERFORM "hr_assert_profile_qa_reviewer_current"(
    qa_role."id", NEW."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_profile_package_custodian_current"(
    package_role."id", NEW."id", admission_row."id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (
      SELECT fixed.id, fixed.kind
      FROM (VALUES
        (capture_root."capture_root_id", 'capture_root'::text),
        (clearance_row."id", 'capture_clearance'::text),
        (derivation_row."id", 'derivation'::text),
        (transform_row."id", 'transform_review'::text),
        (scene_final."id", 'scene_validation'::text),
        (scene_subject."twin_release_authority_id",
          'twin_release_authority'::text)
      ) AS fixed(id, kind)
      UNION ALL
      SELECT supplied.id::uuid, 'rights_clearance'::text
      FROM jsonb_array_elements_text(rights_ids) AS supplied(id)
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind, NEW."environment_id",
      NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
      NEW."space_id", check_at
    );
  END LOOP;
  FOR role_id IN
    SELECT candidate.id
    FROM (
      SELECT fixed.id FROM (VALUES
        (package_role."id"), (qa_role."id"), (admission_role."id"),
        (capture_subject."capture_operator_attestation_id"),
        (capture_subject."source_custodian_attestation_id"),
        (capture_root."normalizer_attestation_id"),
        (clearance_row."owner_attestation_id"),
        (clearance_row."privacy_attestation_id"),
        (clearance_row."movable_attestation_id"),
        (clearance_row."final_attestation_id"),
        (derivation_row."producer_attestation_id"),
        (derivation_row."custodian_attestation_id"),
        (derivation_row."reviewer_attestation_id"),
        (transform_row."reviewer_attestation_id"),
        (scene_subject."presentation_admission_reviewer_attestation_id"),
        (scene_final."reviewer_attestation_id")
      ) AS fixed(id)
      UNION
      SELECT rights."reviewer_attestation_id"
      FROM "hr_rights_clearances" AS rights
      JOIN jsonb_array_elements_text(rights_ids) AS supplied(id)
        ON rights."id" = supplied.id::uuid
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  FOR receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT member."receipt_id" AS id
      FROM "hr_source_receipt_members" AS member
      WHERE member."source_set_id" = capture_subject."source_set_id"
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = derivation_row."id"
      UNION
      SELECT scene_subject."scene_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_source_receipt_set_complete"(
    capture_subject."source_set_id"
  );
  PERFORM "hr_assert_normalized_content_complete"(
    capture_subject."normalization_id"
  );
  PERFORM "hr_assert_derivation_graph_complete"(derivation_row."id");
  PERFORM "hr_assert_scene_graph_complete"(scene_subject."id");

  NEW."subject_kind" := 'reviewed_profile';
  NEW."venue_slug" := admission_row."venue_slug";
  NEW."space_slug" := admission_row."room_slug";
  NEW."reviewed_profile_id" := admission_row."reviewed_profile_id";
  NEW."reviewed_profile_manifest_fingerprint" :=
    admission_row."reviewed_profile_manifest_fingerprint";
  NEW."presentation_admission_digest" := admission_row."admission_digest";
  NEW."presentation_admission_decision" := admission_row."decision";
  NEW."presentation_admission_reviewed_by" := admission_row."reviewed_by";
  NEW."presentation_admission_reviewed_at" :=
    date_trunc('milliseconds', admission_row."reviewed_at");
  NEW."runtime_package_id" := admission_row."runtime_package_id";
  NEW."runtime_package_revision" := package_row."revision";
  NEW."runtime_package_content_digest" :=
    admission_row."runtime_package_content_digest";
  NEW."runtime_manifest_digest" := admission_row."runtime_manifest_digest";
  NEW."capture_root_id" := capture_root."capture_root_id";
  NEW."capture_content_subject_digest" :=
    capture_subject."capture_content_subject_digest";
  NEW."capture_root_evidence_digest" :=
    capture_root."capture_root_evidence_digest";
  NEW."capture_root_expires_at" := capture_root."expires_at";
  NEW."capture_clearance_digest" := clearance_row."capture_clearance_digest";
  NEW."capture_clearance_expires_at" := clearance_row."expires_at";
  NEW."derivation_evidence_digest" :=
    derivation_row."derivation_evidence_digest";
  NEW."derivation_member_count" := derivation_row."member_count";
  NEW."derivation_total_bytes" := derivation_row."total_bytes";
  NEW."derivation_members_digest" := derivation_row."members_digest";
  NEW."derivation_reviewer_actor_id" := derivation_row."reviewer_actor_id";
  NEW."derivation_reviewer_expires_at" :=
    derivation_row."reviewer_expires_at";
  NEW."derivation_expires_at" := derivation_row."expires_at";
  NEW."runtime_qa_record_id" := admission_row."runtime_qa_record_id";
  NEW."runtime_qa_record_key" := admission_row."runtime_qa_record_key";
  NEW."runtime_qa_record_digest" := admission_row."runtime_qa_record_digest";
  NEW."runtime_qa_decision" := admission_row."runtime_qa_decision";
  NEW."runtime_qa_reviewed_by" := admission_row."runtime_qa_reviewed_by";
  NEW."runtime_qa_reviewed_at" :=
    date_trunc('milliseconds', admission_row."runtime_qa_reviewed_at");
  NEW."qa_reviewer_attestation_digest" := qa_role."attestation_digest";
  NEW."qa_reviewer_effective_at" := qa_role."effective_at";
  NEW."qa_reviewer_expires_at" := qa_role."expires_at";
  NEW."transform_artifact_row_id" := transform_row."transform_artifact_row_id";
  NEW."transform_artifact_id" := transform_row."transform_artifact_id";
  NEW."transform_artifact_digest" := transform_row."transform_artifact_digest";
  NEW."transform_review_subject_digest" :=
    transform_row."transform_review_subject_digest";
  NEW."transform_review_digest" := transform_row."transform_review_digest";
  NEW."transform_reviewer_actor_id" := transform_row."reviewer_actor_id";
  NEW."transform_review_expires_at" := transform_row."expires_at";
  NEW."scene_artifact_row_id" := scene_subject."scene_artifact_row_id";
  NEW."scene_artifact_id" := scene_subject."scene_artifact_id";
  NEW."scene_artifact_digest" := scene_subject."scene_artifact_digest";
  NEW."scene_validation_subject_digest" :=
    scene_subject."scene_validation_subject_digest";
  NEW."scene_coverage_digest" := scene_subject."coverage_digest";
  NEW."scene_subject_authority_expires_at" :=
    scene_subject."authority_expires_at";
  NEW."scene_validation_digest" := scene_final."scene_validation_digest";
  NEW."scene_reviewer_actor_id" := scene_final."reviewer_actor_id";
  NEW."scene_validation_expires_at" := scene_final."expires_at";
  NEW."package_custodian_attestation_digest" := package_role."attestation_digest";
  NEW."package_custodian_actor_id" := package_role."actor_id";
  NEW."package_custodian_effective_at" := package_role."effective_at";
  NEW."package_custodian_expires_at" := package_role."expires_at";
  NEW."admission_reviewer_attestation_digest" := admission_role."attestation_digest";
  NEW."admission_reviewer_effective_at" := admission_role."effective_at";
  NEW."admission_reviewer_expires_at" := admission_role."expires_at";
  NEW."capture_creator_actor_id" := capture_subject."capture_operator_actor_id";
  NEW."source_custodian_actor_id" := capture_subject."source_custodian_actor_id";
  NEW."owner_authorizer_actor_id" := clearance_row."owner_actor_id";
  NEW."privacy_reviewer_actor_id" := clearance_row."privacy_actor_id";
  NEW."movable_content_reviewer_actor_id" := clearance_row."movable_actor_id";
  NEW."normalizer_actor_id" := capture_root."normalizer_actor_id";
  NEW."capture_final_reviewer_actor_id" := clearance_row."final_actor_id";
  NEW."derivative_producer_actor_id" := derivation_row."producer_actor_id";
  NEW."derivative_custodian_actor_id" := derivation_row."custodian_actor_id";
  NEW."member_count" := derivation_row."member_count";
  NEW."total_bytes" := total_bytes;
  NEW."members_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-reviewed-profile-members.v1\n'
      || "hr_stable_canonical_json"(members_body), 'UTF8'
  ), 'sha256'), 'hex');

  actor_map_body := jsonb_build_object(
    'admissionReviewerActorId', admission_row."reviewed_by"::text,
    'captureCreatorActorId', capture_subject."capture_operator_actor_id"::text,
    'captureFinalReviewerActorId', clearance_row."final_actor_id"::text,
    'derivativeCustodianActorId', derivation_row."custodian_actor_id"::text,
    'derivativeProducerActorId', derivation_row."producer_actor_id"::text,
    'derivativeReviewerActorId', derivation_row."reviewer_actor_id"::text,
    'designatedFinalReviewerActorId', final_actor_id::text,
    'movableContentReviewerActorId', clearance_row."movable_actor_id"::text,
    'normalizerActorId', capture_root."normalizer_actor_id"::text,
    'ownerAuthorizerActorId', clearance_row."owner_actor_id"::text,
    'packageCustodianActorId', package_role."actor_id"::text,
    'privacyReviewerActorId', clearance_row."privacy_actor_id"::text,
    'qaReviewerActorId', admission_row."runtime_qa_reviewed_by"::text,
    'rightsReviewerActorIds', rights_actor_ids,
    'sceneReviewerActorId', scene_final."reviewer_actor_id"::text,
    'sourceCustodianActorId', capture_subject."source_custodian_actor_id"::text,
    'transformReviewerActorId', transform_row."reviewer_actor_id"::text
  );
  NEW."actor_map_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-reviewed-profile-actor-map.v1\n'
      || "hr_stable_canonical_json"(actor_map_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."created_at" := action_at;
  NEW."prepared_at" := action_at;
  NEW."expires_at" := LEAST(
    clearance_row."expires_at", derivation_row."expires_at", qa_role."expires_at",
    transform_row."expires_at", scene_final."expires_at", package_role."expires_at",
    admission_role."expires_at", minimum_rights_expiry
  );
  IF NEW."expires_at" <= check_at THEN
    RAISE EXCEPTION 'reviewed-profile authority expired while locks were acquired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_profile_subject_current';
  END IF;
  constituent_expiries := jsonb_build_object(
    'admissionReviewerAttestationExpiresAt',
      "hr_iso_utc_ms"(admission_role."expires_at"),
    'captureClearanceExpiresAt', "hr_iso_utc_ms"(clearance_row."expires_at"),
    'derivationReviewExpiresAt', "hr_iso_utc_ms"(derivation_row."expires_at"),
    'packageCustodianAttestationExpiresAt',
      "hr_iso_utc_ms"(package_role."expires_at"),
    'rightsClearanceExpiresAt', rights_expiries,
    'runtimeQaAuthorityExpiresAt', "hr_iso_utc_ms"(qa_role."expires_at"),
    'sceneValidationExpiresAt', "hr_iso_utc_ms"(scene_final."expires_at"),
    'transformReviewExpiresAt', "hr_iso_utc_ms"(transform_row."expires_at")
  );
  subject_material := jsonb_build_object(
    'actorMap', actor_map_body,
    'actorMapDigest', NEW."actor_map_digest",
    'admissionReviewerAttestationDigest', admission_role."attestation_digest",
    'admissionReviewerAttestationId', admission_role."id"::text,
    'captureClearanceDigest', clearance_row."capture_clearance_digest",
    'captureClearanceId', clearance_row."id"::text,
    'captureContentSubjectDigest', capture_subject."capture_content_subject_digest",
    'captureRootEvidenceDigest', capture_root."capture_root_evidence_digest",
    'captureRootId', capture_root."capture_root_id"::text,
    'constituentExpiries', constituent_expiries,
    'derivationEvidenceDigest', derivation_row."derivation_evidence_digest",
    'derivationId', derivation_row."id"::text,
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'memberCount', NEW."member_count",
    'members', members_body,
    'membersDigest', NEW."members_digest",
    'packageCustodianAttestationDigest', package_role."attestation_digest",
    'packageCustodianAttestationId', package_role."id"::text,
    'preparedAt', "hr_iso_utc_ms"(action_at),
    'presentationAdmissionDigest', admission_row."admission_digest",
    'presentationAdmissionId', admission_row."id"::text,
    'presentationAdmissionReviewedAt',
      "hr_iso_utc_ms"(admission_row."reviewed_at"),
    'presentationAdmissionReviewedBy', admission_row."reviewed_by"::text,
    'qaReviewerAttestationDigest', qa_role."attestation_digest",
    'qaReviewerAttestationId', qa_role."id"::text,
    'reviewedProfileEvidenceId', NEW."id"::text,
    'reviewedProfileId', admission_row."reviewed_profile_id",
    'reviewedProfileManifestFingerprint',
      admission_row."reviewed_profile_manifest_fingerprint",
    'runtimeManifestDigest', admission_row."runtime_manifest_digest",
    'runtimePackageContentDigest', admission_row."runtime_package_content_digest",
    'runtimePackageId', admission_row."runtime_package_id"::text,
    'runtimePackageRevision', package_row."revision",
    'runtimeQaDecision', admission_row."runtime_qa_decision",
    'runtimeQaRecordDigest', admission_row."runtime_qa_record_digest",
    'runtimeQaRecordId', admission_row."runtime_qa_record_id"::text,
    'runtimeQaRecordKey', admission_row."runtime_qa_record_key",
    'runtimeQaReviewedAt', "hr_iso_utc_ms"(admission_row."runtime_qa_reviewed_at"),
    'runtimeQaReviewedBy', admission_row."runtime_qa_reviewed_by"::text,
    'sceneValidationDigest', scene_final."scene_validation_digest",
    'sceneValidationId', scene_final."id"::text,
    'schemaVersion', 'historical-runtime-reviewed-profile-subject.v1',
    'spaceId', NEW."space_id"::text,
    'totalBytes', NEW."total_bytes",
    'transformReviewDigest', transform_row."transform_review_digest",
    'transformReviewId', transform_row."id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."reviewed_profile_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-reviewed-profile-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."subject_body" := subject_material || jsonb_build_object(
    'reviewedProfileSubjectDigest', NEW."reviewed_profile_subject_digest"
  );
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'reviewed-profile issuer cannot resolve an exact evidence leaf'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_profile_leaf_missing';
END;
$function$;


CREATE TRIGGER "b_hr_issue_reviewed_profile_subject"
  BEFORE INSERT ON "hr_reviewed_profile_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_reviewed_profile_subject"();

CREATE OR REPLACE FUNCTION "hr_populate_reviewed_profile_children"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  member_entry record;
  derivation_member "hr_derivation_members"%ROWTYPE;
  rights_row "hr_rights_clearances"%ROWTYPE;
  scene_member "hr_scene_validation_members"%ROWTYPE;
BEGIN
  INSERT INTO "hr_reviewed_profile_actors" (
    "reviewed_profile_evidence_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewed_profile_subject_digest", "profile_expires_at", "actor_role",
    "member_index", "actor_id", "created_at"
  ) VALUES
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'capture_creator', NULL, NEW."capture_creator_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'source_custodian', NULL, NEW."source_custodian_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'owner_authorizer', NULL, NEW."owner_authorizer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'privacy_reviewer', NULL, NEW."privacy_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'movable_content_reviewer', NULL,
      NEW."movable_content_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'normalizer', NULL, NEW."normalizer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'capture_final_reviewer', NULL,
      NEW."capture_final_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'derivative_producer', NULL,
      NEW."derivative_producer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'derivative_custodian', NULL,
      NEW."derivative_custodian_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'derivative_reviewer', NULL,
      NEW."derivation_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'package_custodian', NULL,
      NEW."package_custodian_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'qa_reviewer', NULL, NEW."runtime_qa_reviewed_by", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'transform_reviewer', NULL,
      NEW."transform_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'scene_reviewer', NULL, NEW."scene_reviewer_actor_id", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'admission_reviewer', NULL,
      NEW."presentation_admission_reviewed_by", NEW."created_at"),
    (NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'profile_final_reviewer', NULL,
      NEW."designated_final_reviewer_actor_id", NEW."created_at");

  FOR member_entry IN
    SELECT member.value,
      (member.ordinal - 1)::integer AS member_index
    FROM jsonb_array_elements(NEW."subject_body"->'members')
      WITH ORDINALITY AS member(value, ordinal)
    ORDER BY member.ordinal
  LOOP
    SELECT * INTO STRICT derivation_member
    FROM "hr_derivation_members"
    WHERE "derivation_id" = NEW."derivation_id"
      AND "member_index" = member_entry.member_index;
    SELECT * INTO STRICT rights_row
    FROM "hr_rights_clearances"
    WHERE "id" = (member_entry.value->>'rightsClearanceId')::uuid;
    SELECT * INTO STRICT scene_member
    FROM "hr_scene_validation_members"
    WHERE "scene_validation_id" = NEW."scene_validation_id"
      AND "member_index" = member_entry.member_index;

    INSERT INTO "hr_reviewed_profile_actors" (
      "reviewed_profile_evidence_id", "environment_id", "environment_mode",
      "environment_digest", "scope_epoch_id", "venue_id", "space_id",
      "reviewed_profile_subject_digest", "profile_expires_at", "actor_role",
      "member_index", "actor_id", "created_at"
    ) VALUES (
      NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."space_id", NEW."reviewed_profile_subject_digest", NEW."expires_at",
      'rights_reviewer', member_entry.member_index,
      rights_row."reviewer_actor_id", NEW."created_at"
    );

    INSERT INTO "hr_reviewed_profile_members" (
      "reviewed_profile_evidence_id", "environment_id", "environment_mode",
      "environment_digest", "scope_epoch_id", "venue_id", "venue_slug",
      "space_id", "space_slug", "presentation_admission_id",
      "runtime_package_id", "runtime_package_content_digest",
      "derivation_id", "derivation_evidence_digest", "scene_validation_id",
      "scene_validation_subject_digest", "profile_member_count",
      "reviewed_profile_subject_digest", "profile_expires_at", "member_index",
      "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
      "size_bytes", "storage_key_sha256", "derivation_output_receipt_id",
      "derivation_member_receipt_digest", "derivation_receipt_expires_at",
      "rights_clearance_id", "rights_evidence_row_id",
      "legacy_rights_evidence_digest", "legacy_rights_reviewed_at",
      "rights_clearance_digest", "rights_reviewer_actor_id",
      "rights_clearance_expires_at", "scene_authority_reference",
      "scene_coverage_digest", "scene_subject_authority_expires_at",
      "member_body", "created_at"
    ) VALUES (
      NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."venue_slug", NEW."space_id", NEW."space_slug",
      NEW."presentation_admission_id", NEW."runtime_package_id",
      NEW."runtime_package_content_digest", NEW."derivation_id",
      NEW."derivation_evidence_digest", NEW."scene_validation_id",
      NEW."scene_validation_subject_digest", NEW."member_count",
      NEW."reviewed_profile_subject_digest", NEW."expires_at",
      member_entry.member_index, derivation_member."asset_version_id",
      derivation_member."file_name", derivation_member."file_ext",
      derivation_member."mime_type", derivation_member."sha256",
      derivation_member."size_bytes", derivation_member."storage_key_sha256",
      derivation_member."output_receipt_id",
      derivation_member."output_receipt_digest",
      derivation_member."receipt_expires_at", rights_row."id",
      rights_row."rights_evidence_row_id", rights_row."rights_evidence_digest",
      rights_row."rights_reviewed_at", rights_row."rights_clearance_digest",
      rights_row."reviewer_actor_id", rights_row."expires_at",
      scene_member."authority_reference", scene_member."coverage_digest",
      scene_member."scene_authority_expires_at", member_entry.value,
      NEW."created_at"
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "c_hr_populate_reviewed_profile_children"
  AFTER INSERT ON "hr_reviewed_profile_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_populate_reviewed_profile_children"();

CREATE OR REPLACE FUNCTION "hr_assert_reviewed_profile_subject_current"(
  p_profile_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  profile_subject "hr_reviewed_profile_subjects"%ROWTYPE;
  admission_row "runtime_presentation_admissions"%ROWTYPE;
  capture_subject "hr_capture_content_subjects"%ROWTYPE;
  capture_root "hr_capture_roots"%ROWTYPE;
  clearance_row "hr_capture_clearances"%ROWTYPE;
  derivation_row "hr_derivations"%ROWTYPE;
  transform_row "hr_transform_reviews"%ROWTYPE;
  scene_subject "hr_scene_validation_subjects"%ROWTYPE;
  scene_final "hr_scene_validations"%ROWTYPE;
  record_identity record;
  role_id uuid;
  receipt_id uuid;
  check_at timestamptz;
BEGIN
  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = p_profile_id;
  PERFORM "hr_lock_scope"(
    profile_subject."environment_id", profile_subject."venue_id",
    profile_subject."space_id"
  );
  PERFORM "hr_lock_authority"('reviewed-profile', p_profile_id::text);
  PERFORM "hr_lock_authority"(
    'runtime-presentation-admission',
    profile_subject."presentation_admission_id"::text
  );

  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = p_profile_id
  FOR SHARE;
  SELECT * INTO STRICT admission_row
  FROM "runtime_presentation_admissions"
  WHERE "id" = profile_subject."presentation_admission_id"
  FOR SHARE;
  SELECT * INTO STRICT capture_subject
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = profile_subject."capture_root_id"
  FOR SHARE;
  SELECT * INTO STRICT capture_root
  FROM "hr_capture_roots"
  WHERE "capture_root_id" = profile_subject."capture_root_id"
  FOR SHARE;
  SELECT * INTO STRICT clearance_row
  FROM "hr_capture_clearances"
  WHERE "id" = profile_subject."capture_clearance_id"
  FOR SHARE;
  SELECT * INTO STRICT derivation_row
  FROM "hr_derivations"
  WHERE "id" = profile_subject."derivation_id"
  FOR SHARE;
  SELECT * INTO STRICT transform_row
  FROM "hr_transform_reviews"
  WHERE "id" = profile_subject."transform_review_id"
  FOR SHARE;
  SELECT * INTO STRICT scene_subject
  FROM "hr_scene_validation_subjects"
  WHERE "id" = profile_subject."scene_validation_id"
  FOR SHARE;
  SELECT * INTO STRICT scene_final
  FROM "hr_scene_validations"
  WHERE "id" = profile_subject."scene_validation_id"
  FOR SHARE;

  IF scene_subject."scene_map_verification_receipt_id" IS NULL THEN
    RAISE EXCEPTION 'reviewed profile requires a compact Scene verification receipt'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_scene_map_receipt_required';
  END IF;

  -- The first pass acquires every downstream authority lock; the second pass
  -- samples a new wall instant after those potentially blocking operations.
  FOR sweep_index IN 1..2 LOOP
    check_at := GREATEST(
      COALESCE(check_at, p_action_at), p_action_at, "hr_wall_clock_ms"()
    );
    PERFORM "hr_assert_scope_current"(
      profile_subject."scope_epoch_id", profile_subject."environment_id",
      profile_subject."environment_mode", profile_subject."environment_digest",
      profile_subject."venue_id", profile_subject."space_id", check_at
    );
    IF profile_subject."prepared_at" > check_at
       OR profile_subject."expires_at" <= check_at THEN
      RAISE EXCEPTION 'reviewed-profile subject is no longer current'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_profile_subject_current';
    END IF;
    IF profile_subject."presentation_admission_reviewed_by" IS DISTINCT FROM
         admission_row."reviewed_by"
       OR scene_subject."presentation_admission_reviewer_actor_id" IS DISTINCT FROM
          admission_row."reviewed_by" THEN
      RAISE EXCEPTION 'Scene and profile admission authorities must share the normalized admission actor'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_profile_scene_admission_actor_exact';
    END IF;

    FOR record_identity IN
      SELECT candidate.id, candidate.kind
      FROM (
        SELECT fixed.id, fixed.kind FROM (VALUES
          (capture_root."capture_root_id", 'capture_root'::text),
          (clearance_row."id", 'capture_clearance'::text),
          (derivation_row."id", 'derivation'::text),
          (transform_row."id", 'transform_review'::text),
          (scene_final."id", 'scene_validation'::text),
          (scene_subject."twin_release_authority_id",
            'twin_release_authority'::text)
        ) AS fixed(id, kind)
        UNION ALL
        SELECT member."rights_clearance_id", 'rights_clearance'::text
        FROM "hr_reviewed_profile_members" AS member
        WHERE member."reviewed_profile_evidence_id" = p_profile_id
      ) AS candidate
      ORDER BY candidate.id
    LOOP
      PERFORM "hr_assert_evidence_record_current"(
        record_identity.id, record_identity.kind,
        profile_subject."environment_id", profile_subject."environment_mode",
        profile_subject."environment_digest", profile_subject."venue_id",
        profile_subject."space_id", check_at
      );
    END LOOP;

    PERFORM "hr_assert_derivation_current"(
      derivation_row."id", profile_subject."environment_id",
      profile_subject."environment_mode", profile_subject."environment_digest",
      profile_subject."venue_id", profile_subject."space_id", check_at
    );
    PERFORM "hr_assert_transform_review_current"(
      transform_row."id", profile_subject."environment_id",
      profile_subject."environment_mode", profile_subject."environment_digest",
      profile_subject."venue_id", profile_subject."space_id", check_at
    );
    PERFORM "hr_assert_twin_release_authority_current"(
      scene_subject."twin_release_authority_id",
      profile_subject."environment_id", profile_subject."environment_mode",
      profile_subject."environment_digest", profile_subject."venue_id",
      profile_subject."space_id", check_at
    );
    PERFORM "hr_assert_verified_scene_map_receipt_current"(
      scene_subject."scene_map_verification_receipt_id",
      profile_subject."environment_id", profile_subject."environment_mode",
      profile_subject."environment_digest", profile_subject."venue_id",
      profile_subject."space_id", check_at
    );

    FOR role_id IN
      SELECT candidate.id
      FROM (
        SELECT fixed.id FROM (VALUES
          (profile_subject."package_custodian_attestation_id"),
          (profile_subject."qa_reviewer_attestation_id"),
          (profile_subject."admission_reviewer_attestation_id"),
          (capture_subject."capture_operator_attestation_id"),
          (capture_subject."source_custodian_attestation_id"),
          (capture_root."normalizer_attestation_id"),
          (clearance_row."owner_attestation_id"),
          (clearance_row."privacy_attestation_id"),
          (clearance_row."movable_attestation_id"),
          (clearance_row."final_attestation_id"),
          (derivation_row."producer_attestation_id"),
          (derivation_row."custodian_attestation_id"),
          (derivation_row."reviewer_attestation_id"),
          (transform_row."reviewer_attestation_id"),
          (scene_subject."presentation_admission_reviewer_attestation_id"),
          (scene_final."reviewer_attestation_id")
        ) AS fixed(id)
        UNION
        SELECT rights."reviewer_attestation_id"
        FROM "hr_reviewed_profile_members" AS member
        JOIN "hr_rights_clearances" AS rights
          ON rights."id" = member."rights_clearance_id"
        WHERE member."reviewed_profile_evidence_id" = p_profile_id
      ) AS candidate
      ORDER BY candidate.id
    LOOP
      PERFORM "hr_assert_role_attestation_current"(
        role_id, profile_subject."environment_id",
        profile_subject."environment_mode",
        profile_subject."environment_digest", profile_subject."venue_id",
        profile_subject."space_id", check_at
      );
    END LOOP;

    PERFORM "hr_assert_profile_qa_reviewer_current"(
      profile_subject."qa_reviewer_attestation_id", profile_subject."id",
      admission_row."id", profile_subject."environment_id",
      profile_subject."environment_mode", profile_subject."environment_digest",
      profile_subject."venue_id", profile_subject."space_id", check_at
    );
    PERFORM "hr_assert_profile_package_custodian_current"(
      profile_subject."package_custodian_attestation_id",
      profile_subject."id", admission_row."id",
      profile_subject."environment_id", profile_subject."environment_mode",
      profile_subject."environment_digest", profile_subject."venue_id",
      profile_subject."space_id", check_at
    );
    PERFORM "hr_assert_presentation_admission_reviewer_current"(
      profile_subject."admission_reviewer_attestation_id",
      admission_row."id", profile_subject."environment_id",
      profile_subject."environment_mode", profile_subject."environment_digest",
      profile_subject."venue_id", profile_subject."space_id", check_at
    );
    IF scene_subject."presentation_admission_reviewer_attestation_id" <>
         profile_subject."admission_reviewer_attestation_id" THEN
      PERFORM "hr_assert_presentation_admission_reviewer_current"(
        scene_subject."presentation_admission_reviewer_attestation_id",
        admission_row."id", profile_subject."environment_id",
        profile_subject."environment_mode",
        profile_subject."environment_digest", profile_subject."venue_id",
        profile_subject."space_id", check_at
      );
    END IF;

    FOR receipt_id IN
      SELECT candidate.id FROM (
        SELECT member."receipt_id" AS id
        FROM "hr_source_receipt_members" AS member
        WHERE member."source_set_id" = capture_subject."source_set_id"
        UNION
        SELECT member."output_receipt_id"
        FROM "hr_derivation_members" AS member
        WHERE member."derivation_id" = derivation_row."id"
        UNION
        SELECT scene_subject."scene_object_receipt_id"
      ) AS candidate
      ORDER BY candidate.id
    LOOP
      PERFORM "hr_assert_object_receipt_current"(
        receipt_id, profile_subject."environment_id",
        profile_subject."environment_mode",
        profile_subject."environment_digest", profile_subject."venue_id",
        profile_subject."space_id", check_at
      );
    END LOOP;
    PERFORM "hr_assert_source_receipt_set_complete"(
      capture_subject."source_set_id"
    );
    PERFORM "hr_assert_normalized_content_complete"(
      capture_subject."normalization_id"
    );
    PERFORM "hr_assert_derivation_graph_complete"(derivation_row."id");
    PERFORM "hr_assert_scene_graph_complete"(scene_subject."id");
    PERFORM "hr_assert_profile_graph_complete"(p_profile_id);
  END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION "hr_assert_reviewed_profile_current"(
  p_profile_id uuid,
  p_profile_digest text,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  profile_row "hr_reviewed_profiles"%ROWTYPE;
  profile_subject "hr_reviewed_profile_subjects"%ROWTYPE;
  final_role "hr_role_attestations"%ROWTYPE;
  signed_evidence jsonb;
  wall_now timestamptz;
BEGIN
  PERFORM "hr_lock_scope"(p_environment_id, p_venue_id, p_space_id);
  PERFORM "hr_lock_authority"('evidence-record', p_profile_id::text);
  PERFORM "hr_lock_authority"('reviewed-profile', p_profile_id::text);

  SELECT * INTO profile_row
  FROM "hr_reviewed_profiles"
  WHERE "id" = p_profile_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical-runtime reviewed profile is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_reviewed_profile_current';
  END IF;
  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = p_profile_id
  FOR SHARE;
  SELECT * INTO STRICT final_role
  FROM "hr_role_attestations"
  WHERE "id" = profile_row."final_reviewer_attestation_id"
  FOR SHARE;
  signed_evidence := final_role."attestation_body"->'subject'->'evidence';

  FOR sweep_index IN 1..2 LOOP
    wall_now := GREATEST(
      COALESCE(wall_now, p_action_at), p_action_at, "hr_wall_clock_ms"()
    );
    IF profile_row."reviewed_profile_evidence_digest" IS DISTINCT FROM
         p_profile_digest
       OR profile_row."environment_id" IS DISTINCT FROM p_environment_id
       OR profile_row."environment_mode" IS DISTINCT FROM p_environment_mode
       OR profile_row."environment_digest" IS DISTINCT FROM
          p_environment_digest
       OR profile_row."venue_id" IS DISTINCT FROM p_venue_id
       OR profile_row."space_id" IS DISTINCT FROM p_space_id
       OR profile_row."reviewed_at" > wall_now
       OR profile_row."expires_at" <= wall_now THEN
      RAISE EXCEPTION 'historical-runtime reviewed profile is not current'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_reviewed_profile_current';
    END IF;
    PERFORM "hr_assert_evidence_record_current"(
      p_profile_id, 'reviewed_profile', p_environment_id, p_environment_mode,
      p_environment_digest, p_venue_id, p_space_id, wall_now
    );
    PERFORM "hr_assert_reviewed_profile_subject_current"(
      p_profile_id, wall_now
    );
    PERFORM "hr_assert_role_attestation_current"(
      final_role."id", p_environment_id, p_environment_mode,
      p_environment_digest, p_venue_id, p_space_id, wall_now
    );
    IF final_role."role" <> 'profile_final_reviewer'
       OR final_role."subject_id" IS DISTINCT FROM profile_subject."id"
       OR final_role."subject_kind" <> 'reviewed_profile'
       OR final_role."bound_kind" <> 'reviewed_profile_subject'
       OR final_role."bound_reference" <> profile_subject."id"::text
       OR final_role."bound_digest" IS DISTINCT FROM
          profile_subject."reviewed_profile_subject_digest"
       OR final_role."actor_id" IS DISTINCT FROM
          profile_subject."designated_final_reviewer_actor_id"
       OR signed_evidence->>'schemaVersion' IS DISTINCT FROM
          'historical-runtime-role-profile-final-review.v1'
       OR signed_evidence->>'role' IS DISTINCT FROM
          'profile_final_reviewer'
       OR signed_evidence->>'decision' IS DISTINCT FROM 'approved'
       OR signed_evidence->>'reviewedProfileSubjectDigest' IS DISTINCT FROM
          profile_subject."reviewed_profile_subject_digest"
       OR final_role."effective_at" > wall_now
       OR final_role."expires_at" <= wall_now THEN
      RAISE EXCEPTION 'final reviewer does not bind the exact signed profile subject'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_profile_final_reviewer_exact';
    END IF;
    PERFORM "hr_assert_profile_graph_complete"(p_profile_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_reviewed_profile"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz;
  action_at timestamptz;
  requested_subject_digest text := NEW."reviewed_profile_subject_digest";
  profile_subject "hr_reviewed_profile_subjects"%ROWTYPE;
  final_role "hr_role_attestations"%ROWTYPE;
  signed_evidence jsonb;
  material_body jsonb;
BEGIN
  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = NEW."id";
  PERFORM "hr_lock_scope"(
    profile_subject."environment_id", profile_subject."venue_id",
    profile_subject."space_id"
  );
  -- Match currentness and revocation probes: the record serializer precedes
  -- the reviewed-profile serializer, including before a final row exists and
  -- a concurrent currentness probe observes only the subject.
  PERFORM "hr_lock_authority"('evidence-record', NEW."id"::text);
  PERFORM "hr_lock_authority"('reviewed-profile', NEW."id"::text);
  check_at := "hr_wall_clock_ms"();

  SELECT * INTO STRICT profile_subject
  FROM "hr_reviewed_profile_subjects"
  WHERE "id" = NEW."id"
  FOR SHARE;
  IF requested_subject_digest IS DISTINCT FROM
       profile_subject."reviewed_profile_subject_digest" THEN
    RAISE EXCEPTION 'final profile request does not name the locked subject digest'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_final_requested_subject';
  END IF;
  PERFORM "hr_assert_profile_graph_complete"(NEW."id");
  PERFORM "hr_assert_reviewed_profile_subject_current"(NEW."id", check_at);
  PERFORM "hr_assert_role_attestation_current"(
    NEW."final_reviewer_attestation_id", profile_subject."environment_id",
    profile_subject."environment_mode", profile_subject."environment_digest",
    profile_subject."venue_id", profile_subject."space_id", check_at
  );
  SELECT * INTO STRICT final_role
  FROM "hr_role_attestations"
  WHERE "id" = NEW."final_reviewer_attestation_id"
  FOR SHARE;
  signed_evidence := final_role."attestation_body"->'subject'->'evidence';
  IF final_role."role" <> 'profile_final_reviewer'
     OR final_role."subject_id" IS DISTINCT FROM profile_subject."id"
     OR final_role."subject_kind" <> 'reviewed_profile'
     OR final_role."bound_kind" <> 'reviewed_profile_subject'
     OR final_role."bound_reference" <> profile_subject."id"::text
     OR final_role."bound_digest" IS DISTINCT FROM
        profile_subject."reviewed_profile_subject_digest"
     OR final_role."actor_id" IS DISTINCT FROM
        profile_subject."designated_final_reviewer_actor_id"
     OR signed_evidence->>'schemaVersion' IS DISTINCT FROM
        'historical-runtime-role-profile-final-review.v1'
     OR signed_evidence->>'role' IS DISTINCT FROM 'profile_final_reviewer'
     OR signed_evidence->>'decision' IS DISTINCT FROM 'approved'
     OR signed_evidence->>'reviewedProfileSubjectDigest' IS DISTINCT FROM
        profile_subject."reviewed_profile_subject_digest"
     OR final_role."effective_at" > check_at
     OR final_role."expires_at" <= check_at THEN
    RAISE EXCEPTION 'final reviewer does not bind the exact signed profile subject'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_final_reviewer_exact';
  END IF;

  -- Establish the single action instant only after the first complete lock
  -- pass, then repeat the full subject and signed reviewer chain.
  action_at := "hr_db_clock_ms"();
  IF action_at < check_at THEN
    RAISE EXCEPTION 'reviewed-profile action clock moved behind its lock fence'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_profile_clock_monotonic';
  END IF;
  PERFORM "hr_assert_reviewed_profile_subject_current"(NEW."id", action_at);
  check_at := GREATEST(check_at, action_at, "hr_wall_clock_ms"());
  PERFORM "hr_assert_role_attestation_current"(
    final_role."id", profile_subject."environment_id",
    profile_subject."environment_mode", profile_subject."environment_digest",
    profile_subject."venue_id", profile_subject."space_id", check_at
  );
  IF final_role."role" <> 'profile_final_reviewer'
     OR final_role."subject_id" IS DISTINCT FROM profile_subject."id"
     OR final_role."subject_kind" <> 'reviewed_profile'
     OR final_role."bound_kind" <> 'reviewed_profile_subject'
     OR final_role."bound_reference" <> profile_subject."id"::text
     OR final_role."bound_digest" IS DISTINCT FROM
        profile_subject."reviewed_profile_subject_digest"
     OR final_role."actor_id" IS DISTINCT FROM
        profile_subject."designated_final_reviewer_actor_id"
     OR signed_evidence->>'schemaVersion' IS DISTINCT FROM
        'historical-runtime-role-profile-final-review.v1'
     OR signed_evidence->>'role' IS DISTINCT FROM 'profile_final_reviewer'
     OR signed_evidence->>'decision' IS DISTINCT FROM 'approved'
     OR signed_evidence->>'reviewedProfileSubjectDigest' IS DISTINCT FROM
        profile_subject."reviewed_profile_subject_digest"
     OR final_role."effective_at" > check_at
     OR final_role."expires_at" <= check_at THEN
    RAISE EXCEPTION 'final reviewer does not bind the exact signed profile subject'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_profile_final_reviewer_exact';
  END IF;
  PERFORM "hr_assert_profile_graph_complete"(NEW."id");

  NEW."subject_kind" := profile_subject."subject_kind";
  NEW."environment_id" := profile_subject."environment_id";
  NEW."environment_mode" := profile_subject."environment_mode";
  NEW."environment_digest" := profile_subject."environment_digest";
  NEW."scope_epoch_id" := profile_subject."scope_epoch_id";
  NEW."venue_id" := profile_subject."venue_id";
  NEW."space_id" := profile_subject."space_id";
  NEW."reviewed_profile_subject_digest" :=
    profile_subject."reviewed_profile_subject_digest";
  NEW."subject_expires_at" := profile_subject."expires_at";
  NEW."subject_prepared_at" := profile_subject."prepared_at";
  NEW."final_reviewer_attestation_digest" := final_role."attestation_digest";
  NEW."final_reviewer_actor_id" := final_role."actor_id";
  NEW."final_reviewer_effective_at" := final_role."effective_at";
  NEW."final_reviewer_attestation_expires_at" := final_role."expires_at";
  NEW."created_at" := action_at;
  NEW."reviewed_at" := action_at;
  NEW."expires_at" := LEAST(
    profile_subject."expires_at", final_role."expires_at"
  );
  IF NEW."expires_at" > action_at + interval '90 days' THEN
    RAISE EXCEPTION 'final reviewed-profile authority exceeds the 90-day contract'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_reviewed_profile_ttl';
  END IF;
  IF action_at < profile_subject."prepared_at"
     OR NEW."expires_at" <= check_at THEN
    RAISE EXCEPTION 'final reviewed-profile authority is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_profile_final_current';
  END IF;

  material_body := jsonb_build_object(
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'finalReviewerActorId', final_role."actor_id"::text,
    'finalReviewerAttestationDigest', final_role."attestation_digest",
    'finalReviewerAttestationExpiresAt', "hr_iso_utc_ms"(final_role."expires_at"),
    'finalReviewerAttestationId', final_role."id"::text,
    'reviewedAt', "hr_iso_utc_ms"(action_at),
    'reviewedProfileSubjectDigest',
      profile_subject."reviewed_profile_subject_digest",
    'schemaVersion', 'historical-runtime-reviewed-profile-evidence.v1',
    'subject', profile_subject."subject_body"
  );
  NEW."reviewed_profile_evidence_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-reviewed-profile-evidence.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."reviewed_profile_body" := material_body || jsonb_build_object(
    'reviewedProfileEvidenceDigest', NEW."reviewed_profile_evidence_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'reviewed_profile', NEW."id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."reviewed_profile_evidence_digest", action_at, NEW."expires_at",
    action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_reviewed_profile"
  BEFORE INSERT ON "hr_reviewed_profiles"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_reviewed_profile"();
-- Ownership, ACL, append-only, and catalog closure follows below.

-- Close direct write surfaces before transferring the exact four relations.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_reviewed_profile_subjects", "hr_reviewed_profile_actors",
  "hr_reviewed_profile_members", "hr_reviewed_profiles"
FROM PUBLIC, "omnitwin_api_activation",
  "omnitwin_historical_auth_gateway";
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_reviewed_profile_subjects", "hr_reviewed_profile_actors",
  "hr_reviewed_profile_members", "hr_reviewed_profiles"
FROM "omnitwin_historical_evidence_verifier";

GRANT SELECT ON TABLE
  "hr_reviewed_profile_subjects", "hr_reviewed_profile_actors",
  "hr_reviewed_profile_members", "hr_reviewed_profiles"
TO "omnitwin_historical_evidence_owner",
   "omnitwin_historical_evidence_verifier";
GRANT INSERT ON TABLE
  "hr_reviewed_profile_actors", "hr_reviewed_profile_members"
TO "omnitwin_historical_evidence_owner";
GRANT SELECT, INSERT ON TABLE
  "hr_reviewed_profile_subjects", "hr_reviewed_profiles"
TO "omnitwin_historical_evidence_verifier";

-- Row-locking SELECTs need UPDATE on one immutable identity column. No owner
-- function may update the append-only evidence rows.
GRANT UPDATE ("id") ON TABLE
  "hr_reviewed_profile_subjects", "hr_reviewed_profiles"
TO "omnitwin_historical_evidence_owner";

REVOKE ALL ON FUNCTION
  public."hr_assert_profile_qa_reviewer_current"(
    uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_profile_package_custodian_current"(
    uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_profile_graph_complete"(uuid),
  public."hr_profile_graph_deferred_guard"(),
  public."hr_issue_reviewed_profile_subject"(),
  public."hr_populate_reviewed_profile_children"(),
  public."hr_assert_reviewed_profile_subject_current"(uuid, timestamptz),
  public."hr_assert_reviewed_profile_current"(
    uuid, text, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_issue_reviewed_profile"()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public."hr_assert_profile_graph_complete"(uuid),
  public."hr_assert_reviewed_profile_current"(
    uuid, text, uuid, text, text, uuid, uuid, timestamptz
  )
TO "omnitwin_historical_evidence_owner";
-- The verifier inserts the subject row whose CHECK uses this pure helper.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
GRANT EXECUTE ON FUNCTION public."hr_uuid_array_is_distinct"(uuid[])
TO "omnitwin_historical_evidence_verifier";
RESET ROLE;

ALTER TABLE public."hr_reviewed_profile_subjects"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_reviewed_profile_actors"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_reviewed_profile_members"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_reviewed_profiles"
  OWNER TO "omnitwin_historical_schema_owner";

ALTER FUNCTION public."hr_assert_profile_graph_complete"(uuid)
  OWNER TO "omnitwin_historical_schema_owner";
ALTER FUNCTION public."hr_assert_reviewed_profile_current"(
  uuid, text, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_schema_owner";
ALTER FUNCTION public."hr_assert_profile_qa_reviewer_current"(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_profile_package_custodian_current"(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_profile_graph_deferred_guard"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_reviewed_profile_subject"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_populate_reviewed_profile_children"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_reviewed_profile_subject_current"(
  uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_reviewed_profile"()
  OWNER TO "omnitwin_historical_evidence_owner";

-- Guard and append-only triggers are installed only after relation transfer,
-- under the schema owner which already owns the generic guard functions.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
CREATE TRIGGER "a0_hr_require_profile_subject_verifier"
  BEFORE INSERT ON public."hr_reviewed_profile_subjects"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();
CREATE TRIGGER "a0_hr_require_profile_final_verifier"
  BEFORE INSERT ON public."hr_reviewed_profiles"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
    'hr_reviewed_profile_members', 'hr_reviewed_profiles'
  ]::text[]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER z_hr_reject_row_mutation '
        || 'BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW '
        || 'EXECUTE FUNCTION public.hr_reject_evidence_mutation()',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER z_hr_reject_truncate '
        || 'BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT '
        || 'EXECUTE FUNCTION public.hr_reject_evidence_mutation()',
      target_table
    );
  END LOOP;
END;
$$;
RESET ROLE;

-- Restore every temporary migration edge before the transaction can commit.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE REFERENCES ON TABLE '
      || 'public.hr_capture_clearances, '
      || 'public.hr_capture_content_subjects, public.hr_capture_roots, '
      || 'public.hr_derivation_members, public.hr_derivations, '
      || 'public.hr_evidence_records, public.hr_evidence_subjects, '
      || 'public.hr_rights_clearances, public.hr_role_attestations, '
      || 'public.hr_scene_validation_members, '
      || 'public.hr_scene_validation_subjects, '
      || 'public.hr_scene_validations, public.hr_transform_reviews FROM %I',
    session_user
  );
  EXECUTE pg_catalog.format(
    'REVOKE EXECUTE ON FUNCTION public.hr_uuid_array_is_distinct(uuid[]) FROM %I',
    session_user
  );
END;
$$;
RESET ROLE;

REVOKE CREATE ON SCHEMA public
FROM "omnitwin_historical_schema_owner",
     "omnitwin_historical_evidence_owner",
     "omnitwin_historical_evidence_verifier";

-- Exact postflight for the profile-only slice. It intentionally permits the
-- two backing indexes added to legacy migrator-owned tables, but no new table
-- or function may remain owned by the migration LOGIN.
DO $$
DECLARE
  schema_owner_oid oid := (
    SELECT oid FROM pg_catalog.pg_roles
    WHERE rolname = 'omnitwin_historical_schema_owner'
  );
  evidence_owner_oid oid := (
    SELECT oid FROM pg_catalog.pg_roles
    WHERE rolname = 'omnitwin_historical_evidence_owner'
  );
  migration_oid oid := (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = session_user
  );
BEGIN
  IF current_user IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION '0067 did not restore the migration principal'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
      'hr_reviewed_profile_members', 'hr_reviewed_profiles'
    ]::text[]) AS expected(name)
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = 'public'::regnamespace
     AND relation.relname = expected.name
     AND relation.relkind IN ('r', 'p')
    WHERE relation.oid IS NULL OR relation.relowner <> schema_owner_oid
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
      'hr_reviewed_profile_members', 'hr_reviewed_profiles'
    ]::text[]) AS expected(name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass('public.' || expected.name)
    WHERE relation.relowner = migration_oid
  ) THEN
    RAISE EXCEPTION '0067 relation ownership closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hr_assert_evidence_record_leaf_exact(uuid)', true,
        evidence_owner_oid),
      ('public.hr_assert_profile_qa_reviewer_current(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_profile_package_custodian_current(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_profile_graph_complete(uuid)', false,
        schema_owner_oid),
      ('public.hr_profile_graph_deferred_guard()', true,
        evidence_owner_oid),
      ('public.hr_issue_reviewed_profile_subject()', true,
        evidence_owner_oid),
      ('public.hr_populate_reviewed_profile_children()', true,
        evidence_owner_oid),
      ('public.hr_assert_reviewed_profile_subject_current(uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_reviewed_profile_current(uuid,text,uuid,text,text,uuid,uuid,timestamptz)',
        false, schema_owner_oid),
      ('public.hr_issue_reviewed_profile()', true, evidence_owner_oid)
    ) AS expected(signature, security_definer, owner_oid)
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE procedure.oid IS NULL
       OR procedure.proowner <> expected.owner_oid
       OR procedure.prosecdef IS DISTINCT FROM expected.security_definer
       OR procedure.proconfig IS NULL
       OR NOT (
         'search_path=pg_catalog, public, pg_temp' = ANY(procedure.proconfig)
       )
       OR pg_catalog.has_function_privilege(
         'public', procedure.oid, 'EXECUTE'
       )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = 'public'::regnamespace
      AND procedure.proname IN (
        'hr_assert_profile_qa_reviewer_current',
        'hr_assert_profile_package_custodian_current',
        'hr_assert_profile_graph_complete',
        'hr_profile_graph_deferred_guard',
        'hr_issue_reviewed_profile_subject',
        'hr_populate_reviewed_profile_children',
        'hr_assert_reviewed_profile_subject_current',
        'hr_assert_reviewed_profile_current',
        'hr_issue_reviewed_profile'
      )
      AND procedure.proowner = migration_oid
  ) THEN
    RAISE EXCEPTION '0067 function ownership/ACL closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relname IN (
        'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
        'hr_reviewed_profile_members', 'hr_reviewed_profiles'
      )
      AND NOT trigger.tgisinternal
  ) <> 17 THEN
    RAISE EXCEPTION '0067 exact trigger inventory is not 17'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
      'hr_reviewed_profile_members', 'hr_reviewed_profiles'
    ]::text[]) AS expected(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger
      WHERE trigger.tgrelid = pg_catalog.to_regclass(
          'public.' || expected.name
        )
        AND trigger.tgname = 'z_hr_reject_row_mutation'
        AND trigger.tgenabled = 'O'
        AND NOT trigger.tgisinternal
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger
      WHERE trigger.tgrelid = pg_catalog.to_regclass(
          'public.' || expected.name
        )
        AND trigger.tgname = 'z_hr_reject_truncate'
        AND trigger.tgenabled = 'O'
        AND NOT trigger.tgisinternal
    )
  ) THEN
    RAISE EXCEPTION '0067 append-only trigger closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.has_schema_privilege(
       'omnitwin_historical_schema_owner', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege(
       'omnitwin_historical_evidence_owner', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege(
       'omnitwin_historical_evidence_verifier', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege('public', 'public', 'CREATE')
     OR NOT pg_catalog.has_function_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_uuid_array_is_distinct(uuid[])', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION '0067 schema/CHECK-helper closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_reviewed_profile_subjects', 'hr_reviewed_profile_actors',
      'hr_reviewed_profile_members', 'hr_reviewed_profiles'
    ]::text[]) AS relation_name(name)
    CROSS JOIN unnest(ARRAY[
      'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]::text[]) AS forbidden(privilege_name)
    WHERE pg_catalog.has_table_privilege(
      'omnitwin_historical_evidence_verifier',
      pg_catalog.to_regclass('public.' || relation_name.name),
      forbidden.privilege_name
    ) OR pg_catalog.has_table_privilege(
      'omnitwin_api_activation',
      pg_catalog.to_regclass('public.' || relation_name.name),
      forbidden.privilege_name
    ) OR pg_catalog.has_table_privilege(
      'omnitwin_historical_auth_gateway',
      pg_catalog.to_regclass('public.' || relation_name.name),
      forbidden.privilege_name
    )
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_capture_clearances', 'hr_capture_content_subjects',
      'hr_capture_roots', 'hr_derivation_members', 'hr_derivations',
      'hr_evidence_records', 'hr_evidence_subjects',
      'hr_rights_clearances', 'hr_role_attestations',
      'hr_scene_validation_members', 'hr_scene_validation_subjects',
      'hr_scene_validations', 'hr_transform_reviews'
    ]::text[]) AS parent(name)
    WHERE pg_catalog.has_table_privilege(
      session_user, pg_catalog.to_regclass('public.' || parent.name),
      'REFERENCES'
    )
  ) OR pg_catalog.has_function_privilege(
    session_user, 'public.hr_uuid_array_is_distinct(uuid[])', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '0067 temporary/mutating ACL closure failed'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
