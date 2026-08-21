-- Verified Twin, authenticated Scene-parser, and Scene authority over 0065.

-- This migration is deployable by one direct, unpooled, least-privilege
-- migration LOGIN. External bootstrap grants that LOGIN SET-only membership
-- in the two NOLOGIN owner roles and schema grant option; this transaction
-- grants target CREATE only for owner replacement/transfers and revokes it in
-- the final closure. Runtime capability memberships are never acceptable on
-- the migration principal.
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
    RAISE EXCEPTION '0066 requires an isolated least-privilege migration login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_scene_migration_principal_isolation';
  END IF;
END;
$$;

GRANT CREATE ON SCHEMA public
TO "omnitwin_historical_schema_owner",
   "omnitwin_historical_evidence_owner";

-- New tables are initially migration-owned, so their exact FKs need a narrow
-- temporary REFERENCES bridge to the twelve 0065 schema-owner parents. The
-- bridge is granted only to this session_user and is revoked before commit.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT REFERENCES ON TABLE '
      || 'public.hr_action_authority_snapshots, '
      || 'public.hr_derivations, public.hr_derivation_members, '
      || 'public.hr_evidence_environments, public.hr_evidence_records, '
      || 'public.hr_evidence_subjects, public.hr_object_receipts, '
      || 'public.hr_provider_capabilities, public.hr_role_attestations, '
      || 'public.hr_scope_epochs, public.hr_signing_key_authorities, '
      || 'public.hr_transform_reviews TO %I',
    session_user
  );
END;
$$;
RESET ROLE;

-- These exact legacy identity surfaces are used only by the Scene
-- graph introduced below. Keeping them here leaves 0065 independently scoped
-- to capture, derivation, transform, rights, and the test-only twin wrapper.
ALTER TABLE "runtime_presentation_admissions"
  ADD CONSTRAINT "hr_admissions_scene_leaf_unique" UNIQUE (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "runtime_manifest_digest", "scene_authority_artifact_row_id",
    "scene_authority_artifact_id", "scene_authority_map_digest",
    "member_count"
  );
ALTER TABLE "reconstruction_review_evidence_artifacts"
  ADD CONSTRAINT "hr_scene_artifacts_private_leaf_unique" UNIQUE (
    "id", "venue_slug", "artifact_kind", "artifact_id", "artifact_digest",
    "object_key", "object_sha256", "size_bytes", "schema_version",
    "registered_by", "registered_at"
  );

SET LOCAL ROLE "omnitwin_historical_schema_owner";
ALTER TABLE "hr_derivations"
  ADD CONSTRAINT "hr_derivations_scene_receipt_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "members_digest", "member_count", "expires_at"
  );

ALTER TABLE "hr_object_receipts"
  ADD CONSTRAINT "hr_object_receipts_scene_capability_unique" UNIQUE (
    "id", "capability_id", "capability_digest", "capability_expires_at"
  );
RESET ROLE;

-- Production Scene authority must not elevate the 0063 attestation metadata
-- row by itself. It re-receives and re-verifies the exact private DSSE
-- envelope under a purpose-scoped current key, then records an independent
-- platform-admin action. The 0065 wrapper remains deliberately test-only.
CREATE OR REPLACE FUNCTION "hr_jsonb_has_exact_keys"(
  value jsonb,
  expected_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
         FROM jsonb_object_keys(value) AS key_name)
      IS NOT DISTINCT FROM (
        SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
        FROM unnest(expected_keys) AS key_name
      )
$$;

-- Accepted rows are written through SET ROLE from one dedicated verifier
-- LOGIN. Reject administrative sessions and LOGINs which can also assume any
-- other application capability: SET ROLE changes current_user, not
-- session_user, so this closes cross-pool credential reuse at every existing
-- a_hr_require_*_verifier trigger without widening the accepted-table ACLs.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
CREATE OR REPLACE FUNCTION "hr_require_evidence_verifier"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user <> 'omnitwin_historical_evidence_verifier'
     OR NOT pg_has_role(
       session_user, 'omnitwin_historical_evidence_verifier', 'MEMBER'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_roles AS reachable_role
       WHERE reachable_role.rolname NOT IN (
           session_user, 'omnitwin_historical_evidence_verifier'
         )
         AND pg_has_role(session_user, reachable_role.oid, 'MEMBER')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_roles AS principal
       WHERE principal.rolname = session_user
         AND (
           NOT principal.rolcanlogin
           OR principal.rolsuper
           OR principal.rolcreaterole
           OR principal.rolcreatedb
           OR principal.rolreplication
           OR principal.rolbypassrls
         )
     ) THEN
    RAISE EXCEPTION 'accepted evidence requires an isolated verifier login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_trusted_evidence_verifier_isolation';
  END IF;
  RETURN NEW;
END;
$$;
RESET ROLE;

ALTER TABLE "runtime_execution_key_policies"
  DROP CONSTRAINT "runtime_execution_key_policies_shape",
  ADD CONSTRAINT "runtime_execution_key_policies_shape" CHECK ((
    "purpose" IN (
      'historical_runtime_execution_activation',
      'historical_runtime_capture_content_identity',
      'historical_runtime_role_attestation',
      'historical_runtime_twin_release_attestation'
    )
    AND "algorithm" = 'ed25519'
    AND (
      "purpose" = 'historical_runtime_execution_activation'
      OR (
        octet_length("key_id") BETWEEN 1 AND 128
        AND "key_id" ~ '^[ -~]+$'
      )
    )
    AND "public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "policy_digest" ~ '^[a-f0-9]{64}$'
    AND "registered_at" <= "effective_at"
    AND "effective_at" < "expires_at"
    AND jsonb_typeof("policy_body") = 'object'
    AND "policy_body"->>'schemaVersion' =
      'historical-runtime-execution-key-policy.v1'
    AND "policy_body"->>'policyId' = "id"::text
    AND "policy_body"->>'purpose' = "purpose"
    AND "policy_body"->>'algorithm' = "algorithm"
    AND "policy_body"->>'keyId' = "key_id"
    AND "policy_body"->>'publicKeyFingerprint' = "public_key_fingerprint"
    AND "policy_body"->>'policyDigest' = "policy_digest"
    AND "policy_body"->>'registeredBy' = "registered_by"::text
    AND ("policy_body"->>'registeredAt')::timestamptz = "registered_at"
    AND ("policy_body"->>'effectiveAt')::timestamptz = "effective_at"
    AND ("policy_body"->>'expiresAt')::timestamptz = "expires_at"
  ) IS TRUE);

SET LOCAL ROLE "omnitwin_historical_schema_owner";
ALTER TABLE "hr_signing_key_authorities"
  DROP CONSTRAINT "hr_signing_keys_shape",
  ADD CONSTRAINT "hr_signing_keys_shape" CHECK ((
    "purpose" IN (
      'historical_runtime_execution_activation',
      'historical_runtime_capture_content_identity',
      'historical_runtime_role_attestation',
      'historical_runtime_twin_release_attestation'
    )
    AND octet_length("key_id") BETWEEN 1 AND 128
    AND "key_id" ~ '^[ -~]+$'
    AND octet_length("public_key_bytes") = 44
    AND substring("public_key_bytes" from 1 for 12) =
      decode('302a300506032b6570032100', 'hex')
    AND encode(digest("public_key_bytes", 'sha256'), 'hex') =
      "public_key_fingerprint"
    AND "registrar_authority_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("registrar_authority_body") = 'object'
    AND "policy_effective_at" <= "verified_at"
    AND "verified_at" = "created_at"
    AND "verified_at" < "expires_at"
    AND "expires_at" = LEAST("policy_expires_at", "scope_epoch_expires_at")
  ) IS TRUE);
RESET ROLE;

ALTER TABLE "reconstruction_release_attestations"
  ADD CONSTRAINT "hr_release_attestations_signing_leaf_unique" UNIQUE (
    "id", "attestation_type", "key_id", "public_key_fingerprint",
    "statement_sha256", "request_digest"
  ),
  ADD CONSTRAINT "hr_release_attestations_storage_leaf_unique" UNIQUE (
    "id", "r2_key"
  );

CREATE TABLE "hr_verified_twin_release_authorities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "record_kind" varchar(50)
    GENERATED ALWAYS AS ('twin_release_authority') STORED,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40)
    GENERATED ALWAYS AS ('scene_validation') STORED,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "release_id" uuid NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "release_digest" varchar(64) NOT NULL,
  "source_manifest_sha256" varchar(64) NOT NULL,
  "release_manifest_sha256" varchar(64) NOT NULL,
  "release_created_by" uuid NOT NULL,
  "release_created_at" timestamptz NOT NULL,
  "release_review_id" uuid NOT NULL,
  "release_qa_report_digest" varchar(64) NOT NULL,
  "release_review_digest" varchar(64) NOT NULL,
  "release_reviewer_actor_id" uuid NOT NULL,
  "release_reviewer_authority" varchar(40) NOT NULL,
  "release_review_decision" varchar(20) NOT NULL,
  "release_target_exposure" varchar(30) NOT NULL,
  "release_visual_evidence" jsonb NOT NULL,
  "release_transform_artifact_refs" jsonb NOT NULL,
  "release_scene_authority_refs" jsonb NOT NULL,
  "release_review_sequence" integer NOT NULL,
  "release_supersedes_review_id" uuid,
  "release_reviewed_at" timestamptz NOT NULL,
  "release_attestation_id" uuid NOT NULL,
  "release_attestation_type" varchar(50) NOT NULL,
  "legacy_key_id" varchar(160) NOT NULL,
  "legacy_public_key_fingerprint" varchar(64) NOT NULL,
  "legacy_statement_sha256" varchar(64) NOT NULL,
  "legacy_attestation_envelope_sha256" varchar(64) NOT NULL,
  "legacy_attestation_r2_key" text NOT NULL,
  "legacy_attestation_request_digest" varchar(64) NOT NULL,
  "legacy_attestation_verified_by" uuid NOT NULL,
  "legacy_attestation_verified_at" timestamptz NOT NULL,
  "envelope_receipt_id" uuid NOT NULL,
  "envelope_receipt_role" varchar(40)
    GENERATED ALWAYS AS ('evidence_document') STORED,
  "envelope_receipt_digest" varchar(64) NOT NULL,
  "envelope_capability_id" uuid NOT NULL,
  "envelope_capability_digest" varchar(64) NOT NULL,
  "envelope_provider_profile" varchar(40) NOT NULL,
  "envelope_provider_kind" varchar(40) NOT NULL,
  "envelope_provider_account_sha256" varchar(64) NOT NULL,
  "envelope_endpoint_authority_sha256" varchar(64) NOT NULL,
  "envelope_private_bucket_sha256" varchar(64) NOT NULL,
  "envelope_storage_key_sha256" varchar(64) NOT NULL,
  "envelope_version_kind" varchar(50) NOT NULL,
  "envelope_storage_version" varchar(512) NOT NULL,
  "envelope_storage_etag" varchar(512) NOT NULL,
  "envelope_file_name" varchar(255) NOT NULL,
  "envelope_mime_type" varchar(160) NOT NULL,
  "envelope_receipt_expires_at" timestamptz NOT NULL,
  "envelope_receipt_body" jsonb NOT NULL,
  "envelope_bytes" bytea NOT NULL,
  "envelope_body" jsonb NOT NULL,
  "envelope_sha256" varchar(64) NOT NULL,
  "envelope_byte_length" bigint NOT NULL,
  "payload_type" varchar(240) NOT NULL,
  "payload_bytes" bytea NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "payload_byte_length" integer NOT NULL,
  "statement_body" jsonb NOT NULL,
  "signing_key_authority_id" uuid NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "key_purpose" varchar(80)
    GENERATED ALWAYS AS (
      'historical_runtime_twin_release_attestation'
    ) STORED,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "key_effective_at" timestamptz NOT NULL,
  "key_expires_at" timestamptz NOT NULL,
  "verification_boundary" varchar(60) NOT NULL,
  "verified_by_database_principal" varchar(63) NOT NULL,
  "verification_receipt_digest" varchar(64) NOT NULL,
  "verification_receipt_body" jsonb NOT NULL,
  "approval_authority_snapshot_id" uuid NOT NULL,
  "approval_action_kind" varchar(60)
    GENERATED ALWAYS AS ('twin_release_authority_approval') STORED,
  "approval_action_id" uuid NOT NULL,
  "approval_authority_role" varchar(40)
    GENERATED ALWAYS AS ('twin_release_approver') STORED,
  "approval_action_parameters_digest" varchar(64) NOT NULL,
  "approval_actor_id" uuid NOT NULL,
  "approval_authority_digest" varchar(64) NOT NULL,
  "approval_snapshotted_at" timestamptz NOT NULL,
  "approval_authority_expires_at" timestamptz NOT NULL,
  "approved_at" timestamptz NOT NULL,
  "approval_requested_expires_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "twin_release_authority_digest" varchar(64) NOT NULL,
  "twin_release_authority_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_verified_twin_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "twin_release_authority_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_release_fk" FOREIGN KEY (
    "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "release_created_by", "release_created_at"
  ) REFERENCES "reconstruction_releases" (
    "id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "created_by", "created_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_release_source_fk" FOREIGN KEY (
    "release_id", "release_digest", "source_manifest_sha256"
  ) REFERENCES "reconstruction_releases" (
    "id", "release_digest", "source_manifest_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_review_fk" FOREIGN KEY (
    "release_review_id", "release_id", "venue_slug", "release_kind",
    "release_digest", "release_manifest_sha256", "release_qa_report_digest",
    "release_review_digest", "release_reviewer_actor_id",
    "release_reviewer_authority", "release_review_decision",
    "release_target_exposure", "release_review_sequence",
    "release_reviewed_at"
  ) REFERENCES "reconstruction_release_reviews" (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "qa_report_digest", "request_digest",
    "reviewer_user_id", "reviewer_authority", "decision", "target_exposure",
    "review_sequence", "reviewed_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_supersedes_fk" FOREIGN KEY (
    "release_supersedes_review_id"
  ) REFERENCES "reconstruction_release_reviews" ("id") ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_attestation_fk" FOREIGN KEY (
    "release_attestation_id", "release_id", "venue_slug", "release_kind",
    "release_digest", "release_qa_report_digest", "release_review_id",
    "release_review_digest", "legacy_attestation_envelope_sha256",
    "legacy_attestation_verified_by", "legacy_attestation_verified_at"
  ) REFERENCES "reconstruction_release_attestations" (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "qa_report_digest", "review_id", "review_digest", "envelope_sha256",
    "verified_by", "verified_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_attestation_signing_fk" FOREIGN KEY (
    "release_attestation_id", "release_attestation_type", "legacy_key_id",
    "legacy_public_key_fingerprint", "legacy_statement_sha256",
    "legacy_attestation_request_digest"
  ) REFERENCES "reconstruction_release_attestations" (
    "id", "attestation_type", "key_id", "public_key_fingerprint",
    "statement_sha256", "request_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_attestation_storage_fk" FOREIGN KEY (
    "release_attestation_id", "legacy_attestation_r2_key"
  ) REFERENCES "reconstruction_release_attestations" (
    "id", "r2_key"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_receipt_authority_fk" FOREIGN KEY (
    "envelope_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "envelope_capability_id",
    "envelope_capability_digest", "envelope_provider_profile",
    "envelope_provider_kind", "envelope_provider_account_sha256",
    "envelope_endpoint_authority_sha256", "envelope_private_bucket_sha256",
    "envelope_receipt_role", "envelope_receipt_digest",
    "envelope_receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_receipt_bytes_fk" FOREIGN KEY (
    "envelope_receipt_id", "envelope_sha256", "envelope_byte_length",
    "envelope_file_name", "envelope_mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_receipt_version_fk" FOREIGN KEY (
    "envelope_receipt_id", "envelope_storage_key_sha256",
    "envelope_version_kind", "envelope_storage_version"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_key_sha256", "version_kind", "storage_version"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_receipt_etag_fk" FOREIGN KEY (
    "envelope_receipt_id", "envelope_storage_etag"
  ) REFERENCES "hr_object_receipts" ("id", "storage_etag")
    ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_key_fk" FOREIGN KEY (
    "signing_key_authority_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "key_policy_id", "key_purpose", "key_policy_digest", "key_id",
    "public_key_fingerprint", "key_effective_at", "key_expires_at"
  ) REFERENCES "hr_signing_key_authorities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "key_policy_id", "purpose",
    "key_policy_digest", "key_id", "public_key_fingerprint",
    "policy_effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_approval_fk" FOREIGN KEY (
    "approval_authority_snapshot_id", "approval_action_kind",
    "approval_action_id", "approval_authority_role",
    "approval_action_parameters_digest", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "approval_actor_id", "approval_authority_digest",
    "approval_snapshotted_at", "approval_authority_expires_at"
  ) REFERENCES "hr_action_authority_snapshots" (
    "id", "action_kind", "action_id", "authority_role",
    "action_parameters_digest", "environment_id", "environment_mode",
    "environment_digest", "authority_scope_epoch_id", "venue_id", "space_id",
    "actor_id", "authority_digest", "snapshotted_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_verified_twin_shape" CHECK ((
    "environment_mode" IN ('production', 'test')
    AND "release_kind" = 'venue_twin_v1'
    AND "release_reviewer_authority" = 'platform_admin'
    AND "release_review_decision" = 'approved'
    AND "release_target_exposure" = 'public'
    AND jsonb_typeof("release_visual_evidence") = 'array'
    AND jsonb_array_length("release_visual_evidence") > 0
    AND jsonb_typeof("release_transform_artifact_refs") = 'array'
    AND jsonb_array_length("release_transform_artifact_refs") = 1
    AND jsonb_typeof("release_scene_authority_refs") = 'array'
    AND jsonb_array_length("release_scene_authority_refs") = 1
    AND "release_review_sequence" > 0
    AND "release_attestation_type" = 'in_toto_dsse_ed25519'
    AND "release_created_at" <= "release_reviewed_at"
    AND "release_reviewed_at" <= "legacy_attestation_verified_at"
    AND "legacy_attestation_envelope_sha256" = "envelope_sha256"
    AND encode(digest(convert_to("legacy_attestation_r2_key", 'UTF8'), 'sha256'), 'hex') =
      "envelope_storage_key_sha256"
    AND "envelope_receipt_body"->>'receiptDigest' = "envelope_receipt_digest"
    AND "envelope_sha256" ~ '^[a-f0-9]{64}$'
    AND "envelope_byte_length" BETWEEN 1 AND 2097152
    AND octet_length("envelope_bytes") = "envelope_byte_length"
    AND encode(digest("envelope_bytes", 'sha256'), 'hex') = "envelope_sha256"
    AND convert_from("envelope_bytes", 'UTF8')::jsonb = "envelope_body"
    AND "payload_type" = 'application/vnd.in-toto+json'
    AND "payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "payload_byte_length" BETWEEN 1 AND 1048576
    AND octet_length("payload_bytes") = "payload_byte_length"
    AND encode(digest("payload_bytes", 'sha256'), 'hex') = "payload_sha256"
    AND convert_from("payload_bytes", 'UTF8')::jsonb = "statement_body"
    AND "legacy_statement_sha256" = "payload_sha256"
    AND "envelope_body"->>'payloadType' = "payload_type"
    AND decode("envelope_body"->>'payload', 'base64') = "payload_bytes"
    AND ("envelope_body"->>'payload') !~ '[[:space:]]'
    AND jsonb_typeof("envelope_body"->'signatures') = 'array'
    AND jsonb_array_length("envelope_body"->'signatures') = 1
    AND "hr_jsonb_has_exact_keys"(
      "envelope_body", ARRAY['payload', 'payloadType', 'signatures']
    )
    AND "hr_jsonb_has_exact_keys"(
      "envelope_body"->'signatures'->0, ARRAY['keyid', 'sig']
    )
    AND "envelope_body"->'signatures'->0->>'keyid' = "key_id"
    AND ("envelope_body"->'signatures'->0->>'sig') !~ '[[:space:]]'
    AND octet_length(decode(
      "envelope_body"->'signatures'->0->>'sig', 'base64'
    )) = 64
    AND "legacy_key_id" = "key_id"
    AND "legacy_public_key_fingerprint" = "public_key_fingerprint"
    AND "hr_jsonb_has_exact_keys"(
      "statement_body", ARRAY['_type', 'predicate', 'predicateType', 'subject']
    )
    AND "statement_body"->>'_type' = 'https://in-toto.io/Statement/v1'
    AND "statement_body"->>'predicateType' =
      'https://venviewer.com/attestations/reconstruction-release/v1'
    AND jsonb_typeof("statement_body"->'subject') = 'array'
    AND jsonb_array_length("statement_body"->'subject') = 1
    AND "statement_body"->'subject'->0->>'name' =
      'reconstruction-release/' || "venue_slug" || '/' || "release_digest"
    AND "statement_body"->'subject'->0->'digest'->>'sha256' = "release_digest"
    AND "statement_body"->'predicate'->>'schemaVersion' =
      'venviewer.reconstruction-attestation-predicate.v1'
    AND "statement_body"->'predicate'->>'venueSlug' = "venue_slug"
    AND "statement_body"->'predicate'->>'releaseKind' = "release_kind"
    AND ("statement_body"->'predicate'->>'releaseId')::uuid = "release_id"
    AND "statement_body"->'predicate'->>'releaseDigest' = "release_digest"
    AND "statement_body"->'predicate'->>'sourceManifestSha256' =
      "source_manifest_sha256"
    AND "statement_body"->'predicate'->>'releaseManifestSha256' =
      "release_manifest_sha256"
    AND "statement_body"->'predicate'->>'qaReportDigest' =
      "release_qa_report_digest"
    AND ("statement_body"->'predicate'->>'reviewId')::uuid = "release_review_id"
    AND "statement_body"->'predicate'->>'reviewDigest' = "release_review_digest"
    AND date_trunc('milliseconds',
      ("statement_body"->'predicate'->>'reviewedAt')::timestamptz
    ) = date_trunc('milliseconds', "release_reviewed_at")
    AND ("statement_body"->'predicate'->>'reviewerUserId')::uuid =
      "release_reviewer_actor_id"
    AND "statement_body"->'predicate'->>'decision' = 'approved'
    AND "statement_body"->'predicate'->>'targetExposure' = 'public'
    AND "statement_body"->'predicate'->'visualEvidence' =
      "release_visual_evidence"
    AND "statement_body"->'predicate'->'transformArtifactRef' =
      "release_transform_artifact_refs"->0
    AND "statement_body"->'predicate'->'sceneAuthorityMapRef' =
      "release_scene_authority_refs"->0
    AND "verification_boundary" = 'ed25519_dsse_verified_by_service_v1'
    AND "verified_by_database_principal" =
      'omnitwin_historical_evidence_verifier'
    AND "verification_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "hr_jsonb_has_exact_keys"(
      "verification_receipt_body", ARRAY[
        'envelopeSha256', 'keyId', 'payloadSha256', 'publicKeyFingerprint',
        'schemaVersion', 'signingKeyAuthorityId', 'verificationBoundary',
        'verificationReceiptDigest', 'verifiedAt',
        'verifiedByDatabasePrincipal'
      ]
    )
    AND "verification_receipt_body"->>'verificationBoundary' =
      "verification_boundary"
    AND "verification_receipt_body"->>'verifiedByDatabasePrincipal' =
      "verified_by_database_principal"
    AND "verification_receipt_body"->>'envelopeSha256' = "envelope_sha256"
    AND "verification_receipt_body"->>'payloadSha256' = "payload_sha256"
    AND ("verification_receipt_body"->>'signingKeyAuthorityId')::uuid =
      "signing_key_authority_id"
    AND "verification_receipt_body"->>'keyId' = "key_id"
    AND "verification_receipt_body"->>'publicKeyFingerprint' =
      "public_key_fingerprint"
    AND ("verification_receipt_body"->>'verifiedAt')::timestamptz =
      "approved_at"
    AND "verification_receipt_body"->>'verificationReceiptDigest' =
      "verification_receipt_digest"
    AND "verification_receipt_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-twin-release-verification-receipt.v1\n'
        || "hr_stable_canonical_json"(
          "verification_receipt_body" - 'verificationReceiptDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
    AND "approval_snapshotted_at" <= "approved_at"
    AND "approved_at" < "approval_authority_expires_at"
    AND "approved_at" < "approval_requested_expires_at"
    AND "approved_at" = "created_at"
    AND "approved_at" < "expires_at"
    AND "expires_at" = LEAST(
      "approved_at" + interval '30 days', "scope_epoch_expires_at",
      "envelope_receipt_expires_at", "key_expires_at",
      "approval_requested_expires_at"
    )
    AND "approval_actor_id" <> "release_created_by"
    AND "approval_actor_id" <> "release_reviewer_actor_id"
    AND "approval_actor_id" <> "legacy_attestation_verified_by"
    AND "release_created_by" <> "release_reviewer_actor_id"
    AND "release_created_by" <> "legacy_attestation_verified_by"
    AND "release_reviewer_actor_id" <> "legacy_attestation_verified_by"
    AND "twin_release_authority_digest" ~ '^[a-f0-9]{64}$'
    AND "twin_release_authority_body"->>'schemaVersion' =
      'historical-runtime-verified-twin-release-authority.v1'
    AND ("twin_release_authority_body"->>'authorityId')::uuid = "id"
    AND ("twin_release_authority_body"->>'sceneValidationId')::uuid =
      "subject_id"
    AND ("twin_release_authority_body"->>'releaseId')::uuid = "release_id"
    AND "twin_release_authority_body"->>'releaseDigest' = "release_digest"
    AND "twin_release_authority_body"->>'envelopeSha256' = "envelope_sha256"
    AND "twin_release_authority_body"->>'legacyAttestationObjectKeySha256' =
      "envelope_storage_key_sha256"
    AND "twin_release_authority_body"->>'payloadSha256' = "payload_sha256"
    AND ("twin_release_authority_body"->>'signingKeyAuthorityId')::uuid =
      "signing_key_authority_id"
    AND "hr_jsonb_has_exact_keys"(
      "twin_release_authority_body"->'approvalAuthority', ARRAY[
        'actionAuthoritySnapshotId', 'actionId', 'actionKind',
        'actionParametersDigest', 'actorId', 'authorityDigest',
        'authorityRole', 'expiresAt', 'snapshottedAt'
      ]
    )
    AND "twin_release_authority_body"->'approvalAuthority'->>'actionKind' =
      "approval_action_kind"
    AND "twin_release_authority_body"->'approvalAuthority'->>'authorityRole' =
      "approval_authority_role"
    AND (
      "twin_release_authority_body"->'approvalAuthority'
        ->>'actionAuthoritySnapshotId'
    )::uuid = "approval_authority_snapshot_id"
    AND (
      "twin_release_authority_body"->'approvalAuthority'->>'actionId'
    )::uuid = "approval_action_id"
    AND "twin_release_authority_body"->'approvalAuthority'
      ->>'actionParametersDigest' = "approval_action_parameters_digest"
    AND (
      "twin_release_authority_body"->'approvalAuthority'->>'actorId'
    )::uuid = "approval_actor_id"
    AND "twin_release_authority_body"->'approvalAuthority'
      ->>'authorityDigest' = "approval_authority_digest"
    AND ("twin_release_authority_body"->>'approvedAt')::timestamptz =
      "approved_at"
    AND ("twin_release_authority_body"->>'expiresAt')::timestamptz =
      "expires_at"
    AND "twin_release_authority_body"->>'twinReleaseAuthorityDigest' =
      "twin_release_authority_digest"
    AND "twin_release_authority_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-verified-twin-release-authority.v1\n'
        || "hr_stable_canonical_json"(
          "twin_release_authority_body" - 'twinReleaseAuthorityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE),
  CONSTRAINT "hr_verified_twin_exact_unique" UNIQUE (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "release_id", "release_digest", "release_manifest_sha256",
    "twin_release_authority_digest", "approval_actor_id", "expires_at"
  )
);

-- A production parser receipt is accepted only from one independently
-- provisioned verifier runtime identity. This migration intentionally inserts
-- no authority row: source policy is not executable/deployment identity, and
-- production remains fail-closed until the identity-plane rollout provisions
-- exact executable and deployment-image digests for an isolated verifier
-- LOGIN. Ordinary runtime principals receive no write path to either table.
CREATE TABLE "hr_scene_parser_runtime_identities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20)
    GENERATED ALWAYS AS ('production') STORED,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "source_manifest_digest" varchar(64) NOT NULL,
  "executable_artifact_digest" varchar(64) NOT NULL,
  "deployment_image_digest" varchar(64) NOT NULL,
  "parser_policy_digest" varchar(64) NOT NULL,
  "verifier_capability_principal" varchar(63) NOT NULL,
  "verifier_session_principal_sha256" varchar(64) NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "runtime_identity_digest" varchar(64) NOT NULL,
  "runtime_identity_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_scene_parser_runtime_identity_environment_fk" FOREIGN KEY (
    "environment_id", "environment_mode", "environment_digest"
  ) REFERENCES "hr_evidence_environments" (
    "id", "mode", "environment_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_parser_runtime_identity_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_parser_runtime_identity_shape" CHECK ((
    "source_manifest_digest" ~ '^[a-f0-9]{64}$'
    AND "source_manifest_digest" <> repeat('0', 64)
    AND "source_manifest_digest" =
      '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17'
    AND "executable_artifact_digest" ~ '^[a-f0-9]{64}$'
    AND "executable_artifact_digest" <> repeat('0', 64)
    AND "deployment_image_digest" ~ '^[a-f0-9]{64}$'
    AND "deployment_image_digest" <> repeat('0', 64)
    AND "parser_policy_digest" =
      'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1'
    AND "verifier_capability_principal" =
      'omnitwin_historical_evidence_verifier'
    AND "verifier_session_principal_sha256" ~ '^[a-f0-9]{64}$'
    AND "verifier_session_principal_sha256" <> repeat('0', 64)
    AND "effective_at" = "created_at"
    AND "effective_at" < "expires_at"
    AND "hr_jsonb_has_exact_keys"(
      "runtime_identity_body", ARRAY[
        'createdAt', 'deploymentImageDigest', 'environmentDigest',
        'environmentId', 'executableArtifactDigest', 'expiresAt',
        'parserPolicyDigest', 'runtimeIdentityDigest', 'runtimeIdentityId',
        'schemaVersion', 'scopeEpoch', 'scopeEpochDigest',
        'scopeEpochExpiresAt', 'scopeEpochId', 'sourceManifestDigest',
        'spaceId', 'venueId', 'verifierCapabilityPrincipal',
        'verifierSessionPrincipalSha256'
      ]
    )
    AND "runtime_identity_body"->>'schemaVersion' =
      'historical-runtime-scene-parser-runtime-identity.v1'
    AND ("runtime_identity_body"->>'runtimeIdentityId')::uuid = "id"
    AND ("runtime_identity_body"->>'environmentId')::uuid = "environment_id"
    AND "runtime_identity_body"->>'environmentDigest' =
      "environment_digest"
    AND ("runtime_identity_body"->>'scopeEpochId')::uuid = "scope_epoch_id"
    AND ("runtime_identity_body"->>'scopeEpoch')::bigint = "scope_epoch"
    AND "runtime_identity_body"->>'scopeEpochDigest' = "scope_epoch_digest"
    AND ("runtime_identity_body"->>'scopeEpochExpiresAt')::timestamptz =
      "scope_epoch_expires_at"
    AND ("runtime_identity_body"->>'venueId')::uuid = "venue_id"
    AND ("runtime_identity_body"->>'spaceId')::uuid = "space_id"
    AND "runtime_identity_body"->>'sourceManifestDigest' =
      "source_manifest_digest"
    AND "runtime_identity_body"->>'executableArtifactDigest' =
      "executable_artifact_digest"
    AND "runtime_identity_body"->>'deploymentImageDigest' =
      "deployment_image_digest"
    AND "runtime_identity_body"->>'parserPolicyDigest' =
      "parser_policy_digest"
    AND "runtime_identity_body"->>'verifierCapabilityPrincipal' =
      "verifier_capability_principal"
    AND "runtime_identity_body"->>'verifierSessionPrincipalSha256' =
      "verifier_session_principal_sha256"
    AND ("runtime_identity_body"->>'createdAt')::timestamptz = "created_at"
    AND ("runtime_identity_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "runtime_identity_body"->>'runtimeIdentityDigest' =
      "runtime_identity_digest"
    AND "runtime_identity_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-scene-parser-runtime-identity.v1\n'
        || "hr_stable_canonical_json"(
          "runtime_identity_body" - 'runtimeIdentityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE),
  CONSTRAINT "hr_scene_parser_runtime_identity_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "scope_epoch", "scope_epoch_digest",
    "scope_epoch_expires_at", "venue_id", "space_id",
    "source_manifest_digest",
    "executable_artifact_digest", "deployment_image_digest",
    "parser_policy_digest", "verifier_capability_principal",
    "verifier_session_principal_sha256", "effective_at", "expires_at",
    "runtime_identity_digest"
  ),
  -- Downstream handles already bind their exact epoch through their parser
  -- receipt FK. This key additionally proves that their compact scope tuple
  -- selects the same immutable runtime-identity row.
  CONSTRAINT "hr_scene_parser_runtime_identity_compact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "source_manifest_digest",
    "executable_artifact_digest", "deployment_image_digest",
    "parser_policy_digest", "verifier_capability_principal",
    "verifier_session_principal_sha256", "effective_at", "expires_at",
    "runtime_identity_digest"
  ),
  CONSTRAINT "hr_scene_parser_runtime_identity_digest_unique" UNIQUE (
    "id", "runtime_identity_digest"
  )
);

CREATE TABLE "hr_scene_parser_runtime_identity_revocations" (
  "runtime_identity_id" uuid PRIMARY KEY NOT NULL,
  "runtime_identity_digest" varchar(64) NOT NULL,
  "revoked_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_scene_parser_runtime_identity_revocation_fk" FOREIGN KEY (
    "runtime_identity_id", "runtime_identity_digest"
  ) REFERENCES "hr_scene_parser_runtime_identities" (
    "id", "runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_parser_runtime_identity_revocation_shape" CHECK ((
    "revoked_at" = "created_at"
    AND "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND "hr_jsonb_has_exact_keys"(
      "revocation_body", ARRAY[
        'revocationDigest', 'revokedAt', 'runtimeIdentityDigest',
        'runtimeIdentityId', 'schemaVersion'
      ]
    )
    AND "revocation_body"->>'schemaVersion' =
      'historical-runtime-scene-parser-runtime-identity-revocation.v1'
    AND ("revocation_body"->>'runtimeIdentityId')::uuid =
      "runtime_identity_id"
    AND "revocation_body"->>'runtimeIdentityDigest' =
      "runtime_identity_digest"
    AND ("revocation_body"->>'revokedAt')::timestamptz = "revoked_at"
    AND "revocation_body"->>'revocationDigest' = "revocation_digest"
    AND "revocation_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-scene-parser-runtime-identity-revocation.v1\n'
        || "hr_stable_canonical_json"(
          "revocation_body" - 'revocationDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE)
);

-- Production Scene authority starts with one verifier-produced receipt over
-- the exact private Scene map, release manifest, and source-Twin manifest
-- bytes. Parsed bodies and normalized projections are retained for audit, but
-- only bounded scalar identities participate in B-tree keys. The issuer below
-- rehydrates every relational identity and hashes a number-free projection so
-- PostgreSQL and TypeScript share one unambiguous digest material.
CREATE TABLE "hr_scene_map_parser_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "scene_validation_id" uuid NOT NULL,
  "subject_kind" varchar(40)
    GENERATED ALWAYS AS ('scene_validation') STORED,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "presentation_admission_id" uuid NOT NULL,
  "presentation_admission_digest" varchar(64) NOT NULL,
  "presentation_admission_reviewer_attestation_id" uuid NOT NULL,
  "presentation_admission_reviewer_attestation_digest" varchar(64) NOT NULL,
  "presentation_admission_reviewer_subject_id" uuid NOT NULL,
  "presentation_admission_reviewer_actor_id" uuid NOT NULL,
  "presentation_admission_reviewer_effective_at" timestamptz NOT NULL,
  "presentation_admission_reviewer_expires_at" timestamptz NOT NULL,
  "presentation_admission_reviewer_subject_kind" varchar(40)
    GENERATED ALWAYS AS ('reviewed_profile') STORED,
  "presentation_admission_reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('admission_reviewer') STORED,
  "presentation_admission_reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('presentation_admission') STORED,
  "presentation_admission_reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS (
      "presentation_admission_reviewer_subject_id"::text
    ) STORED,
  "presentation_admission_reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("presentation_admission_digest") STORED,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "runtime_manifest_digest" varchar(64) NOT NULL,
  "admission_member_count" integer NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_members_digest" varchar(64) NOT NULL,
  "derivation_member_count" integer NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "member_receipt_min_expires_at" timestamptz NOT NULL,
  "transform_review_id" uuid NOT NULL,
  "transform_review_subject_digest" varchar(64) NOT NULL,
  "transform_review_digest" varchar(64) NOT NULL,
  "transform_reviewer_actor_id" uuid NOT NULL,
  "transform_review_expires_at" timestamptz NOT NULL,
  "transform_artifact_row_id" uuid NOT NULL,
  "transform_artifact_id" varchar(120) NOT NULL,
  "transform_artifact_digest" varchar(64) NOT NULL,
  "twin_release_authority_id" uuid NOT NULL,
  "twin_release_record_kind" varchar(50)
    GENERATED ALWAYS AS ('twin_release_authority') STORED,
  "twin_release_authority_digest" varchar(64) NOT NULL,
  "twin_release_authority_actor_id" uuid NOT NULL,
  "twin_release_authority_expires_at" timestamptz NOT NULL,
  "twin_release_id" uuid NOT NULL,
  "twin_release_digest" varchar(64) NOT NULL,
  "twin_release_manifest_digest" varchar(64) NOT NULL,
  "twin_payload_type" varchar(240) NOT NULL,
  "twin_key_id" varchar(128) NOT NULL,
  "twin_public_key_fingerprint" varchar(64) NOT NULL,
  "twin_envelope_sha256" varchar(64) NOT NULL,
  "twin_envelope_byte_length" bigint NOT NULL,
  "twin_payload_sha256" varchar(64) NOT NULL,
  "twin_payload_byte_length" bigint NOT NULL,
  "twin_statement_sha256" varchar(64) NOT NULL,
  "twin_predicate_digest" varchar(64) NOT NULL,
  "signed_transform_artifact_ref" jsonb NOT NULL,
  "signed_scene_authority_map_ref" jsonb NOT NULL,
  "scene_artifact_row_id" uuid NOT NULL,
  "scene_artifact_kind" varchar(50) NOT NULL,
  "scene_artifact_id" varchar(160) NOT NULL,
  "scene_artifact_digest" varchar(64) NOT NULL,
  "scene_registry_object_key" text NOT NULL,
  "scene_registry_object_sha256" varchar(64) NOT NULL,
  "scene_registry_object_size_bytes" bigint NOT NULL,
  "scene_registry_schema_version" varchar(80) NOT NULL,
  "scene_registry_registered_by" uuid NOT NULL,
  "scene_registry_registered_at" timestamptz NOT NULL,
  "scene_object_receipt_id" uuid NOT NULL,
  "scene_object_receipt_role" varchar(40) NOT NULL,
  "scene_object_receipt_digest" varchar(64) NOT NULL,
  "scene_object_capability_id" uuid NOT NULL,
  "scene_object_capability_digest" varchar(64) NOT NULL,
  "scene_object_capability_expires_at" timestamptz NOT NULL,
  "scene_object_sha256" varchar(64) NOT NULL,
  "scene_object_size_bytes" bigint NOT NULL,
  "scene_object_file_name" varchar(255) NOT NULL,
  "scene_object_mime_type" varchar(160) NOT NULL,
  "scene_object_receipt_expires_at" timestamptz NOT NULL,
  "scene_object_receipt_body" jsonb NOT NULL,
  "release_manifest_object_receipt_id" uuid NOT NULL,
  "release_manifest_object_receipt_role" varchar(40) NOT NULL,
  "release_manifest_object_receipt_digest" varchar(64) NOT NULL,
  "release_manifest_capability_id" uuid NOT NULL,
  "release_manifest_capability_digest" varchar(64) NOT NULL,
  "release_manifest_capability_expires_at" timestamptz NOT NULL,
  "release_manifest_object_sha256" varchar(64) NOT NULL,
  "release_manifest_object_size_bytes" bigint NOT NULL,
  "release_manifest_object_file_name" varchar(255) NOT NULL,
  "release_manifest_object_mime_type" varchar(160) NOT NULL,
  "release_manifest_receipt_expires_at" timestamptz NOT NULL,
  "release_manifest_object_receipt_body" jsonb NOT NULL,
  "source_twin_object_receipt_id" uuid NOT NULL,
  "source_twin_object_receipt_role" varchar(40) NOT NULL,
  "source_twin_object_receipt_digest" varchar(64) NOT NULL,
  "source_twin_capability_id" uuid NOT NULL,
  "source_twin_capability_digest" varchar(64) NOT NULL,
  "source_twin_capability_expires_at" timestamptz NOT NULL,
  "source_twin_object_sha256" varchar(64) NOT NULL,
  "source_twin_object_size_bytes" bigint NOT NULL,
  "source_twin_object_file_name" varchar(255) NOT NULL,
  "source_twin_object_mime_type" varchar(160) NOT NULL,
  "source_twin_receipt_expires_at" timestamptz NOT NULL,
  "source_twin_object_receipt_body" jsonb NOT NULL,
  "source_twin_manifest_release_object_path" varchar(80) NOT NULL,
  "scene_map_bytes" bytea NOT NULL,
  "scene_map_body" jsonb NOT NULL,
  "scene_map_sha256" varchar(64) NOT NULL,
  "scene_map_byte_length" bigint NOT NULL,
  "parsed_map_digest" varchar(64) NOT NULL,
  "release_manifest_bytes" bytea NOT NULL,
  "release_manifest_body" jsonb NOT NULL,
  "release_manifest_sha256" varchar(64) NOT NULL,
  "release_manifest_byte_length" bigint NOT NULL,
  "source_twin_manifest_bytes" bytea NOT NULL,
  "source_twin_manifest_body" jsonb NOT NULL,
  "source_twin_manifest_sha256" varchar(64) NOT NULL,
  "source_twin_manifest_byte_length" bigint NOT NULL,
  "room_projection_body" jsonb NOT NULL,
  "whole_region_ids" jsonb NOT NULL,
  "expected_twin_node_ids" jsonb NOT NULL,
  "covered_twin_node_ids" jsonb NOT NULL,
  "ordered_regions" jsonb NOT NULL,
  "referenced_release_paths" jsonb NOT NULL,
  "expanded_region_node_reference_count" bigint NOT NULL,
  "normalized_projection_byte_length" bigint NOT NULL,
  "ordered_members" jsonb NOT NULL,
  "verified_coverage_digest" varchar(64) NOT NULL,
  "verification_profile" varchar(40) NOT NULL,
  "parser_version" varchar(80) NOT NULL,
  "parser_policy_digest" varchar(64) NOT NULL,
  "parser_implementation_manifest_digest" varchar(64) NOT NULL,
  "parser_runtime_identity_id" uuid,
  "parser_runtime_identity_digest" varchar(64),
  "parser_runtime_identity_effective_at" timestamptz,
  "parser_runtime_identity_expires_at" timestamptz,
  "parser_runtime_executable_artifact_digest" varchar(64),
  "parser_runtime_deployment_image_digest" varchar(64),
  "parser_runtime_session_principal_sha256" varchar(64),
  "verification_boundary" varchar(80) NOT NULL,
  "verified_by_database_principal" varchar(63) NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "parser_digest_material" jsonb NOT NULL,
  "scene_map_verification_receipt_digest" varchar(64) NOT NULL,
  "scene_map_verification_receipt_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_scene_map_receipts_subject_fk" FOREIGN KEY (
    "scene_validation_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "scope_epoch_id", "scope_epoch", "scope_epoch_digest",
    "scope_epoch_expires_at"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id",
    "scope_epoch", "scope_epoch_digest", "scope_epoch_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug", "runtime_manifest_digest", "scene_artifact_row_id",
    "scene_artifact_id", "scene_artifact_digest", "admission_member_count"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "runtime_manifest_digest", "scene_authority_artifact_row_id",
    "scene_authority_artifact_id", "scene_authority_map_digest",
    "member_count"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_admission_reviewer_fk" FOREIGN KEY (
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_subject_id",
    "presentation_admission_reviewer_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "presentation_admission_reviewer_role",
    "presentation_admission_reviewer_actor_id",
    "presentation_admission_reviewer_bound_kind",
    "presentation_admission_reviewer_bound_reference",
    "presentation_admission_reviewer_bound_digest",
    "presentation_admission_reviewer_effective_at",
    "presentation_admission_reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_derivation_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "derivation_evidence_digest", "derivation_members_digest",
    "derivation_member_count", "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "members_digest", "member_count", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_transform_fk" FOREIGN KEY (
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
  CONSTRAINT "hr_scene_map_receipts_twin_fk" FOREIGN KEY (
    "twin_release_authority_id", "scene_validation_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "twin_release_id", "twin_release_digest",
    "twin_release_manifest_digest", "twin_release_authority_digest",
    "twin_release_authority_actor_id", "twin_release_authority_expires_at"
  ) REFERENCES "hr_verified_twin_release_authorities" (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "release_id", "release_digest", "release_manifest_sha256",
    "twin_release_authority_digest", "approval_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_registry_fk" FOREIGN KEY (
    "scene_artifact_row_id", "venue_slug", "scene_artifact_kind",
    "scene_artifact_id", "scene_artifact_digest", "scene_registry_object_key",
    "scene_registry_object_sha256", "scene_registry_object_size_bytes",
    "scene_registry_schema_version", "scene_registry_registered_by",
    "scene_registry_registered_at"
  ) REFERENCES "reconstruction_review_evidence_artifacts" (
    "id", "venue_slug", "artifact_kind", "artifact_id", "artifact_digest",
    "object_key", "object_sha256", "size_bytes", "schema_version",
    "registered_by", "registered_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_scene_object_fk" FOREIGN KEY (
    "scene_object_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "scene_object_receipt_role",
    "scene_object_receipt_digest", "venue_id", "space_id",
    "scene_object_receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "receipt_role", "receipt_digest", "venue_id", "space_id",
    "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_scene_bytes_fk" FOREIGN KEY (
    "scene_object_receipt_id", "scene_object_sha256",
    "scene_object_size_bytes", "scene_object_file_name",
    "scene_object_mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_scene_capability_fk" FOREIGN KEY (
    "scene_object_receipt_id", "scene_object_capability_id",
    "scene_object_capability_digest", "scene_object_capability_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "capability_id", "capability_digest", "capability_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_release_object_fk" FOREIGN KEY (
    "release_manifest_object_receipt_id", "environment_id",
    "environment_mode", "environment_digest",
    "release_manifest_object_receipt_role",
    "release_manifest_object_receipt_digest", "venue_id", "space_id",
    "release_manifest_receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "receipt_role", "receipt_digest", "venue_id", "space_id",
    "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_release_bytes_fk" FOREIGN KEY (
    "release_manifest_object_receipt_id", "release_manifest_object_sha256",
    "release_manifest_object_size_bytes", "release_manifest_object_file_name",
    "release_manifest_object_mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_release_capability_fk" FOREIGN KEY (
    "release_manifest_object_receipt_id", "release_manifest_capability_id",
    "release_manifest_capability_digest",
    "release_manifest_capability_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "capability_id", "capability_digest", "capability_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_source_object_fk" FOREIGN KEY (
    "source_twin_object_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "source_twin_object_receipt_role",
    "source_twin_object_receipt_digest", "venue_id", "space_id",
    "source_twin_receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "receipt_role", "receipt_digest", "venue_id", "space_id",
    "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_source_bytes_fk" FOREIGN KEY (
    "source_twin_object_receipt_id", "source_twin_object_sha256",
    "source_twin_object_size_bytes", "source_twin_object_file_name",
    "source_twin_object_mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_source_capability_fk" FOREIGN KEY (
    "source_twin_object_receipt_id", "source_twin_capability_id",
    "source_twin_capability_digest", "source_twin_capability_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "capability_id", "capability_digest", "capability_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_runtime_identity_fk" FOREIGN KEY (
    "parser_runtime_identity_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at", "venue_id", "space_id",
    "parser_implementation_manifest_digest",
    "parser_runtime_executable_artifact_digest",
    "parser_runtime_deployment_image_digest", "parser_policy_digest",
    "verified_by_database_principal",
    "parser_runtime_session_principal_sha256",
    "parser_runtime_identity_effective_at",
    "parser_runtime_identity_expires_at", "parser_runtime_identity_digest"
  ) REFERENCES "hr_scene_parser_runtime_identities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "scope_epoch", "scope_epoch_digest",
    "scope_epoch_expires_at", "venue_id", "space_id",
    "source_manifest_digest",
    "executable_artifact_digest", "deployment_image_digest",
    "parser_policy_digest", "verifier_capability_principal",
    "verifier_session_principal_sha256", "effective_at", "expires_at",
    "runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_receipts_shape" CHECK ((
    "scene_artifact_kind" = 'scene_authority_map_v0'
    AND "scene_registry_schema_version" = 'venviewer.scene-authority-map.v0'
    AND "scene_object_receipt_role" = 'scene'
    AND "release_manifest_object_receipt_role" = 'evidence_document'
    AND "source_twin_object_receipt_role" = 'evidence_document'
    AND "source_twin_manifest_release_object_path" = 'manifest.json'
    AND "admission_member_count" = "derivation_member_count"
    AND "admission_member_count" BETWEEN 1 AND 8
    AND "scene_map_byte_length" BETWEEN 1 AND 4194304
    AND "release_manifest_byte_length" BETWEEN 1 AND 2097152
    AND "source_twin_manifest_byte_length" BETWEEN 1 AND 4194304
    AND octet_length("scene_map_bytes") = "scene_map_byte_length"
    AND octet_length("release_manifest_bytes") = "release_manifest_byte_length"
    AND octet_length("source_twin_manifest_bytes") =
      "source_twin_manifest_byte_length"
    AND encode(digest("scene_map_bytes", 'sha256'), 'hex') =
      "scene_map_sha256"
    AND encode(digest("release_manifest_bytes", 'sha256'), 'hex') =
      "release_manifest_sha256"
    AND encode(digest("source_twin_manifest_bytes", 'sha256'), 'hex') =
      "source_twin_manifest_sha256"
    AND convert_from("scene_map_bytes", 'UTF8')::jsonb = "scene_map_body"
    AND convert_from("release_manifest_bytes", 'UTF8')::jsonb =
      "release_manifest_body"
    AND convert_from("source_twin_manifest_bytes", 'UTF8')::jsonb =
      "source_twin_manifest_body"
    AND "scene_map_sha256" = "scene_object_sha256"
    AND "scene_map_byte_length" = "scene_object_size_bytes"
    AND "scene_map_sha256" = "scene_registry_object_sha256"
    AND "scene_map_byte_length" = "scene_registry_object_size_bytes"
    AND "release_manifest_sha256" = "release_manifest_object_sha256"
    AND "release_manifest_byte_length" = "release_manifest_object_size_bytes"
    AND "release_manifest_sha256" = "twin_release_manifest_digest"
    AND "twin_payload_type" = 'application/vnd.in-toto+json'
    AND octet_length("twin_key_id") BETWEEN 1 AND 128
    AND "twin_key_id" ~ '^[ -~]+$'
    AND "twin_public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "twin_envelope_sha256" ~ '^[a-f0-9]{64}$'
    AND "twin_envelope_byte_length" BETWEEN 1 AND 2097152
    AND "twin_payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "twin_payload_byte_length" BETWEEN 1 AND 1048576
    AND "twin_statement_sha256" = "twin_payload_sha256"
    AND "twin_predicate_digest" ~ '^[a-f0-9]{64}$'
    AND "source_twin_manifest_sha256" = "source_twin_object_sha256"
    AND "source_twin_manifest_byte_length" = "source_twin_object_size_bytes"
    AND "source_twin_manifest_sha256" =
      "release_manifest_body"->>'sourceManifestSha256'
    AND "release_manifest_body"->>'releaseDigest' = "twin_release_digest"
    AND "release_manifest_body"->>'venueSlug' = "venue_slug"
    AND "scene_map_body"->>'id' = "scene_artifact_id"
    AND "scene_map_body"->>'venueSlug' = "venue_slug"
    AND "parsed_map_digest" = "scene_artifact_digest"
    AND "signed_transform_artifact_ref" = jsonb_build_object(
      'artifactDigest', "transform_artifact_digest",
      'artifactId', "transform_artifact_id"
    )
    AND "signed_scene_authority_map_ref" = jsonb_build_object(
      'artifactDigest', "scene_artifact_digest",
      'artifactId', "scene_artifact_id"
    )
    AND "parser_version" = 'venviewer.scene-map-private-byte-verifier.v1'
    AND "verification_boundary" =
      'exact_private_scene_map_release_inventory_v1'
    AND "verified_by_database_principal" =
      'omnitwin_historical_evidence_verifier'
    AND jsonb_typeof("room_projection_body") = 'object'
    AND "room_projection_body"->>'projectionVersion' =
      'venviewer.scene-room-node-projection.v1'
    AND "room_projection_body"->>'ordering' =
      'source_twin_manifest_order'
    AND "room_projection_body"->>'spaceSlug' = "space_slug"
    AND jsonb_typeof("whole_region_ids") = 'array'
    AND jsonb_array_length("whole_region_ids") BETWEEN 1 AND 2000
    AND jsonb_typeof("expected_twin_node_ids") = 'array'
    AND jsonb_array_length("expected_twin_node_ids") BETWEEN 1 AND 20000
    AND "covered_twin_node_ids" = "expected_twin_node_ids"
    AND jsonb_typeof("ordered_regions") = 'array'
    AND jsonb_array_length("ordered_regions") =
      jsonb_array_length("whole_region_ids")
    AND jsonb_typeof("referenced_release_paths") = 'array'
    AND jsonb_array_length("referenced_release_paths") > 0
    AND "expanded_region_node_reference_count" BETWEEN 1 AND 65536
    AND "normalized_projection_byte_length" BETWEEN 1 AND 4194304
    AND jsonb_typeof("ordered_members") = 'array'
    AND jsonb_array_length("ordered_members") = "derivation_member_count"
    AND "verified_coverage_digest" ~ '^[a-f0-9]{64}$'
    AND "parser_policy_digest" =
      'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1'
    AND "parser_implementation_manifest_digest" =
      '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17'
    AND (
      ("verification_profile" = 'production_runtime'
        AND "environment_mode" = 'production'
        AND "parser_runtime_identity_id" IS NOT NULL
        AND "parser_runtime_identity_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_identity_effective_at" IS NOT NULL
        AND "parser_runtime_identity_expires_at" IS NOT NULL
        AND "parser_runtime_executable_artifact_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_deployment_image_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_session_principal_sha256" ~ '^[a-f0-9]{64}$')
      OR ("verification_profile" = 'local_test_fixture'
        AND "environment_mode" = 'test'
        AND "scene_object_receipt_body"->'object'->>'providerProfile' =
          'local_fixture'
        AND "release_manifest_object_receipt_body"->'object'->>
          'providerProfile' = 'local_fixture'
        AND "source_twin_object_receipt_body"->'object'->>'providerProfile' =
          'local_fixture'
        AND "parser_runtime_identity_id" IS NULL
        AND "parser_runtime_identity_digest" IS NULL
        AND "parser_runtime_identity_effective_at" IS NULL
        AND "parser_runtime_identity_expires_at" IS NULL
        AND "parser_runtime_executable_artifact_digest" IS NULL
        AND "parser_runtime_deployment_image_digest" IS NULL
        AND "parser_runtime_session_principal_sha256" IS NULL)
    )
    AND "scene_map_verification_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "verified_at" = "created_at"
    AND "verified_at" < "expires_at"
    AND "expires_at" = LEAST(
      "verified_at" + interval '30 days',
      "scope_epoch_expires_at",
      "presentation_admission_reviewer_expires_at",
      "derivation_expires_at", "member_receipt_min_expires_at",
      "transform_review_expires_at", "twin_release_authority_expires_at",
      "scene_object_capability_expires_at",
      "release_manifest_capability_expires_at",
      "source_twin_capability_expires_at", "scene_object_receipt_expires_at",
      "release_manifest_receipt_expires_at",
      "source_twin_receipt_expires_at",
      COALESCE("parser_runtime_identity_expires_at", 'infinity')
    )
    AND "scene_map_verification_receipt_body"->>'schemaVersion' =
      'historical-runtime-scene-map-parser-receipt.v1'
    AND ("scene_map_verification_receipt_body"->>'verificationReceiptId')::uuid =
      "id"
    AND ("scene_map_verification_receipt_body"->>'sceneValidationId')::uuid =
      "scene_validation_id"
    AND "scene_map_verification_receipt_body"->>'parserVersion' =
      "parser_version"
    AND "scene_map_verification_receipt_body"->>'verificationProfile' =
      "verification_profile"
    AND "scene_map_verification_receipt_body"->>'parserPolicyDigest' =
      "parser_policy_digest"
    AND "scene_map_verification_receipt_body"->>
      'parserImplementationManifestDigest' =
      "parser_implementation_manifest_digest"
    AND COALESCE(("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityId')::uuid, NULL) IS NOT DISTINCT FROM
      "parser_runtime_identity_id"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_identity_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityEffectiveAt', '')::timestamptz
      IS NOT DISTINCT FROM "parser_runtime_identity_effective_at"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityExpiresAt', '')::timestamptz
      IS NOT DISTINCT FROM "parser_runtime_identity_expires_at"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeExecutableArtifactDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_executable_artifact_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeDeploymentImageDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_deployment_image_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeVerifierCapabilityPrincipal', '') IS NOT DISTINCT FROM
      CASE WHEN "verification_profile" = 'production_runtime'
        THEN "verified_by_database_principal" ELSE NULL END
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeSessionPrincipalSha256', '') IS NOT DISTINCT FROM
      "parser_runtime_session_principal_sha256"
    AND "scene_map_verification_receipt_body"->>
      'expandedRegionNodeReferenceCount' =
      "expanded_region_node_reference_count"::text
    AND "scene_map_verification_receipt_body"->>
      'normalizedProjectionByteLength' =
      "normalized_projection_byte_length"::text
    AND "scene_map_verification_receipt_body"->>'verificationBoundary' =
      "verification_boundary"
    AND "scene_map_verification_receipt_body"->>
      'verifiedByDatabasePrincipal' = "verified_by_database_principal"
    AND ("scene_map_verification_receipt_body"->>'verifiedAt')::timestamptz =
      "verified_at"
    AND ("scene_map_verification_receipt_body"->>'expiresAt')::timestamptz =
      "expires_at"
    AND "scene_map_verification_receipt_body"->>
      'sceneMapVerificationReceiptDigest' =
      "scene_map_verification_receipt_digest"
    AND "scene_map_verification_receipt_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-scene-map-parser-receipt.v1\n'
        || "hr_stable_canonical_json"("parser_digest_material"), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE),
  CONSTRAINT "hr_scene_map_receipts_exact_unique" UNIQUE (
    "id", "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "derivation_id", "transform_review_id",
    "twin_release_authority_id", "scene_artifact_row_id",
    "scene_object_receipt_id", "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at",
    "scene_map_verification_receipt_digest",
    "expires_at"
  )
);

-- The large verifier-authenticated row is the parser leaf. A separate compact
-- accepted handle is the only relation that Scene subjects/finals consume.
-- This one-to-one split prevents a caller from substituting free projection
-- fields after the isolated verifier has committed the exact raw-byte result.
ALTER TABLE "hr_scene_map_parser_receipts"
  DROP CONSTRAINT "hr_scene_map_receipts_twin_fk";
ALTER TABLE "hr_scene_map_parser_receipts"
  ADD COLUMN "production_twin_release_authority_id" uuid
    GENERATED ALWAYS AS (
      CASE WHEN "verification_profile" = 'production_runtime'
        THEN "twin_release_authority_id"
        ELSE NULL
      END
    ) STORED;
ALTER TABLE "hr_scene_map_parser_receipts"
  ADD CONSTRAINT "hr_scene_map_parser_receipts_twin_record_fk" FOREIGN KEY (
    "twin_release_authority_id", "twin_release_record_kind",
    "scene_validation_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "twin_release_authority_digest",
    "twin_release_authority_expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT;
ALTER TABLE "hr_scene_map_parser_receipts"
  ADD CONSTRAINT "hr_scene_map_parser_receipts_production_twin_fk"
  FOREIGN KEY (
    "production_twin_release_authority_id", "scene_validation_id",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "twin_release_id",
    "twin_release_digest", "twin_release_manifest_digest",
    "twin_release_authority_digest", "twin_release_authority_actor_id",
    "twin_release_authority_expires_at"
  ) REFERENCES "hr_verified_twin_release_authorities" (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "release_id", "release_digest", "release_manifest_sha256",
    "twin_release_authority_digest", "approval_actor_id", "expires_at"
  ) ON DELETE RESTRICT;
ALTER TABLE "hr_scene_map_parser_receipts"
  ADD CONSTRAINT "hr_scene_map_parser_receipts_handle_unique" UNIQUE (
    "id", "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "derivation_id", "transform_review_id",
    "twin_release_authority_id", "scene_artifact_row_id",
    "scene_object_receipt_id", "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at",
    "scene_map_verification_receipt_digest",
    "verification_profile", "parser_policy_digest",
    "parser_implementation_manifest_digest", "verified_at", "expires_at"
  );
ALTER TABLE "hr_scene_map_parser_receipts"
  ADD CONSTRAINT "hr_scene_map_parser_receipts_runtime_handle_unique" UNIQUE (
    "id", "parser_runtime_identity_id", "parser_runtime_identity_digest"
  );

CREATE TABLE "hr_verified_scene_map_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "parser_receipt_id" uuid NOT NULL UNIQUE,
  "scene_validation_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "presentation_admission_id" uuid NOT NULL,
  "derivation_id" uuid NOT NULL,
  "transform_review_id" uuid NOT NULL,
  "twin_release_authority_id" uuid NOT NULL,
  "scene_artifact_row_id" uuid NOT NULL,
  "scene_object_receipt_id" uuid NOT NULL,
  "scene_object_receipt_digest" varchar(64) NOT NULL,
  "presentation_admission_reviewer_attestation_id" uuid NOT NULL,
  "presentation_admission_reviewer_attestation_digest" varchar(64) NOT NULL,
  "presentation_admission_reviewer_expires_at" timestamptz NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "transform_review_expires_at" timestamptz NOT NULL,
  "twin_release_authority_digest" varchar(64) NOT NULL,
  "twin_release_authority_expires_at" timestamptz NOT NULL,
  "twin_release_digest" varchar(64) NOT NULL,
  "scene_object_capability_expires_at" timestamptz NOT NULL,
  "parser_receipt_digest" varchar(64) NOT NULL,
  "verification_profile" varchar(40) NOT NULL,
  "parser_policy_digest" varchar(64) NOT NULL,
  "parser_implementation_manifest_digest" varchar(64) NOT NULL,
  "parser_runtime_identity_id" uuid,
  "parser_runtime_identity_digest" varchar(64),
  "parser_runtime_identity_effective_at" timestamptz,
  "parser_runtime_identity_expires_at" timestamptz,
  "parser_runtime_executable_artifact_digest" varchar(64),
  "parser_runtime_deployment_image_digest" varchar(64),
  "parser_runtime_verifier_capability_principal" varchar(63),
  "parser_runtime_session_principal_sha256" varchar(64),
  "parser_verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "scene_map_verification_receipt_digest" varchar(64) NOT NULL,
  "scene_map_verification_receipt_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_scene_map_handle_parser_fk" FOREIGN KEY (
    "parser_receipt_id", "scene_validation_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "presentation_admission_id", "derivation_id",
    "transform_review_id", "twin_release_authority_id",
    "scene_artifact_row_id", "scene_object_receipt_id",
    "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at", "parser_receipt_digest",
    "verification_profile",
    "parser_policy_digest", "parser_implementation_manifest_digest",
    "parser_verified_at", "expires_at"
  ) REFERENCES "hr_scene_map_parser_receipts" (
    "id", "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "derivation_id", "transform_review_id",
    "twin_release_authority_id", "scene_artifact_row_id",
    "scene_object_receipt_id", "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at",
    "scene_map_verification_receipt_digest",
    "verification_profile", "parser_policy_digest",
    "parser_implementation_manifest_digest", "verified_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_handle_parser_runtime_exact_fk" FOREIGN KEY (
    "parser_receipt_id", "parser_runtime_identity_id",
    "parser_runtime_identity_digest"
  ) REFERENCES "hr_scene_map_parser_receipts" (
    "id", "parser_runtime_identity_id", "parser_runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_handle_runtime_identity_fk" FOREIGN KEY (
    "parser_runtime_identity_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "parser_implementation_manifest_digest",
    "parser_runtime_executable_artifact_digest",
    "parser_runtime_deployment_image_digest", "parser_policy_digest",
    "parser_runtime_verifier_capability_principal",
    "parser_runtime_session_principal_sha256",
    "parser_runtime_identity_effective_at",
    "parser_runtime_identity_expires_at", "parser_runtime_identity_digest"
  ) REFERENCES "hr_scene_parser_runtime_identities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "source_manifest_digest",
    "executable_artifact_digest", "deployment_image_digest",
    "parser_policy_digest", "verifier_capability_principal",
    "verifier_session_principal_sha256",
    "effective_at", "expires_at", "runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_map_handle_shape" CHECK ((
    "parser_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "parser_policy_digest" =
      'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1'
    AND "parser_implementation_manifest_digest" =
      '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17'
    AND "parser_verified_at" = "created_at"
    AND "parser_verified_at" < "expires_at"
    AND (
      ("verification_profile" = 'production_runtime'
        AND "environment_mode" = 'production'
        AND "parser_runtime_identity_id" IS NOT NULL
        AND "parser_runtime_identity_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_identity_effective_at" <= "parser_verified_at"
        AND "parser_verified_at" < "parser_runtime_identity_expires_at"
        AND "parser_runtime_executable_artifact_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_deployment_image_digest" ~ '^[a-f0-9]{64}$'
        AND "parser_runtime_verifier_capability_principal" =
          'omnitwin_historical_evidence_verifier'
        AND "parser_runtime_session_principal_sha256" ~ '^[a-f0-9]{64}$')
      OR ("verification_profile" = 'local_test_fixture'
        AND "environment_mode" = 'test'
        AND "parser_runtime_identity_id" IS NULL
        AND "parser_runtime_identity_digest" IS NULL
        AND "parser_runtime_identity_effective_at" IS NULL
        AND "parser_runtime_identity_expires_at" IS NULL
        AND "parser_runtime_executable_artifact_digest" IS NULL
        AND "parser_runtime_deployment_image_digest" IS NULL
        AND "parser_runtime_verifier_capability_principal" IS NULL
        AND "parser_runtime_session_principal_sha256" IS NULL)
    )
    AND "scene_map_verification_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "hr_jsonb_has_exact_keys"(
      "scene_map_verification_receipt_body", ARRAY[
        'acceptedAt', 'derivationExpiresAt', 'derivationId', 'expiresAt',
        'parserImplementationManifestDigest',
        'parserPolicyDigest', 'parserReceiptDigest', 'parserReceiptId',
        'parserRuntimeDeploymentImageDigest',
        'parserRuntimeExecutableArtifactDigest',
        'parserRuntimeIdentityDigest', 'parserRuntimeIdentityEffectiveAt',
        'parserRuntimeIdentityExpiresAt', 'parserRuntimeIdentityId',
        'parserRuntimeSessionPrincipalSha256',
        'parserRuntimeVerifierCapabilityPrincipal',
        'presentationAdmissionId',
        'presentationAdmissionReviewerAttestationDigest',
        'presentationAdmissionReviewerAttestationExpiresAt',
        'presentationAdmissionReviewerAttestationId',
        'sceneArtifactRowId', 'sceneObjectReceiptDigest',
        'sceneObjectReceiptId', 'sceneProviderCapabilityExpiresAt',
        'sceneMapVerificationReceiptDigest', 'sceneMapVerificationReceiptId',
        'sceneValidationId', 'schemaVersion', 'transformReviewExpiresAt',
        'transformReviewId', 'twinReleaseAuthorityDigest',
        'twinReleaseAuthorityExpiresAt', 'twinReleaseAuthorityReceiptId',
        'twinReleaseDigest', 'verificationProfile'
      ]
    )
    AND "scene_map_verification_receipt_body"->>'schemaVersion' =
      'historical-runtime-scene-map-verification-handle.v1'
    AND ("scene_map_verification_receipt_body"->>
      'sceneMapVerificationReceiptId')::uuid = "id"
    AND ("scene_map_verification_receipt_body"->>'parserReceiptId')::uuid =
      "parser_receipt_id"
    AND ("scene_map_verification_receipt_body"->>'sceneValidationId')::uuid =
      "scene_validation_id"
    AND "scene_map_verification_receipt_body"->>'parserReceiptDigest' =
      "parser_receipt_digest"
    AND "scene_map_verification_receipt_body"->>'sceneObjectReceiptDigest' =
      "scene_object_receipt_digest"
    AND ("scene_map_verification_receipt_body"->>
      'presentationAdmissionId')::uuid = "presentation_admission_id"
    AND ("scene_map_verification_receipt_body"->>
      'presentationAdmissionReviewerAttestationId')::uuid =
      "presentation_admission_reviewer_attestation_id"
    AND "scene_map_verification_receipt_body"->>
      'presentationAdmissionReviewerAttestationDigest' =
      "presentation_admission_reviewer_attestation_digest"
    AND ("scene_map_verification_receipt_body"->>
      'presentationAdmissionReviewerAttestationExpiresAt')::timestamptz =
      "presentation_admission_reviewer_expires_at"
    AND ("scene_map_verification_receipt_body"->>'derivationId')::uuid =
      "derivation_id"
    AND ("scene_map_verification_receipt_body"->>
      'derivationExpiresAt')::timestamptz = "derivation_expires_at"
    AND ("scene_map_verification_receipt_body"->>'transformReviewId')::uuid =
      "transform_review_id"
    AND ("scene_map_verification_receipt_body"->>
      'transformReviewExpiresAt')::timestamptz = "transform_review_expires_at"
    AND ("scene_map_verification_receipt_body"->>
      'twinReleaseAuthorityReceiptId')::uuid = "twin_release_authority_id"
    AND "scene_map_verification_receipt_body"->>'twinReleaseAuthorityDigest' =
      "twin_release_authority_digest"
    AND ("scene_map_verification_receipt_body"->>
      'twinReleaseAuthorityExpiresAt')::timestamptz =
      "twin_release_authority_expires_at"
    AND "scene_map_verification_receipt_body"->>'twinReleaseDigest' =
      "twin_release_digest"
    AND ("scene_map_verification_receipt_body"->>'sceneArtifactRowId')::uuid =
      "scene_artifact_row_id"
    AND ("scene_map_verification_receipt_body"->>'sceneObjectReceiptId')::uuid =
      "scene_object_receipt_id"
    AND ("scene_map_verification_receipt_body"->>
      'sceneProviderCapabilityExpiresAt')::timestamptz =
      "scene_object_capability_expires_at"
    AND "scene_map_verification_receipt_body"->>'verificationProfile' =
      "verification_profile"
    AND "scene_map_verification_receipt_body"->>'parserPolicyDigest' =
      "parser_policy_digest"
    AND "scene_map_verification_receipt_body"->>
      'parserImplementationManifestDigest' =
      "parser_implementation_manifest_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityId', '')::uuid IS NOT DISTINCT FROM
      "parser_runtime_identity_id"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_identity_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityEffectiveAt', '')::timestamptz
      IS NOT DISTINCT FROM "parser_runtime_identity_effective_at"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeIdentityExpiresAt', '')::timestamptz
      IS NOT DISTINCT FROM "parser_runtime_identity_expires_at"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeExecutableArtifactDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_executable_artifact_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeDeploymentImageDigest', '') IS NOT DISTINCT FROM
      "parser_runtime_deployment_image_digest"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeSessionPrincipalSha256', '') IS NOT DISTINCT FROM
      "parser_runtime_session_principal_sha256"
    AND NULLIF("scene_map_verification_receipt_body"->>
      'parserRuntimeVerifierCapabilityPrincipal', '') IS NOT DISTINCT FROM
      "parser_runtime_verifier_capability_principal"
    AND ("scene_map_verification_receipt_body"->>'acceptedAt')::timestamptz =
      "created_at"
    AND ("scene_map_verification_receipt_body"->>'expiresAt')::timestamptz =
      "expires_at"
    AND "scene_map_verification_receipt_body"->>
      'sceneMapVerificationReceiptDigest' =
      "scene_map_verification_receipt_digest"
    AND "scene_map_verification_receipt_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-scene-map-verification-handle.v1\n'
        || "hr_stable_canonical_json"(
          "scene_map_verification_receipt_body"
            - 'sceneMapVerificationReceiptDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE),
  CONSTRAINT "hr_scene_map_handle_exact_unique" UNIQUE (
    "id", "parser_receipt_id", "scene_validation_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "presentation_admission_id", "derivation_id",
    "transform_review_id", "twin_release_authority_id",
    "scene_artifact_row_id", "scene_object_receipt_id",
    "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at", "parser_receipt_digest",
    "scene_map_verification_receipt_digest",
    "verification_profile", "parser_policy_digest",
    "parser_implementation_manifest_digest", "expires_at"
  ),
  CONSTRAINT "hr_scene_map_handle_runtime_subject_unique" UNIQUE (
    "id", "parser_runtime_identity_id", "parser_runtime_identity_digest"
  )
);

CREATE TABLE "hr_scene_validation_subjects" (
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
  "presentation_admission_id" uuid NOT NULL,
  "presentation_admission_digest" varchar(64) NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "runtime_manifest_digest" varchar(64) NOT NULL,
  "admission_member_count" integer NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "scene_artifact_row_id" uuid NOT NULL,
  "scene_artifact_kind" varchar(50) NOT NULL,
  "scene_artifact_id" varchar(160) NOT NULL,
  "scene_artifact_digest" varchar(64) NOT NULL,
  "scene_registry_object_key" text NOT NULL,
  "scene_registry_object_sha256" varchar(64) NOT NULL,
  "scene_registry_object_size_bytes" bigint NOT NULL,
  "scene_registry_schema_version" varchar(80) NOT NULL,
  "scene_registry_registered_by" uuid NOT NULL,
  "scene_registry_registered_at" timestamptz NOT NULL,
  "scene_object_receipt_id" uuid NOT NULL,
  "scene_receipt_role" varchar(40) GENERATED ALWAYS AS ('scene') STORED,
  "scene_object_receipt_digest" varchar(64) NOT NULL,
  "scene_capability_id" uuid NOT NULL,
  "scene_capability_digest" varchar(64) NOT NULL,
  "scene_capability_expires_at" timestamptz NOT NULL,
  "scene_provider_profile" varchar(40) NOT NULL,
  "scene_provider_kind" varchar(40) NOT NULL,
  "scene_provider_account_sha256" varchar(64) NOT NULL,
  "scene_endpoint_authority_sha256" varchar(64) NOT NULL,
  "scene_private_bucket_sha256" varchar(64) NOT NULL,
  "scene_storage_key_sha256" varchar(64) NOT NULL,
  "scene_version_kind" varchar(50) NOT NULL,
  "scene_storage_version" varchar(512) NOT NULL,
  "scene_storage_etag" varchar(512) NOT NULL,
  "scene_file_name" varchar(255) NOT NULL,
  "scene_mime_type" varchar(160) NOT NULL,
  "scene_receipt_expires_at" timestamptz NOT NULL,
  "scene_raw_bytes" bytea NOT NULL,
  "scene_parsed_map_body" jsonb NOT NULL,
  "parsed_map_digest" varchar(64) NOT NULL,
  "scene_map_verification_receipt_id" uuid NOT NULL,
  "scene_map_verification_receipt_digest" varchar(64) NOT NULL,
  "scene_map_verification_receipt_expires_at" timestamptz NOT NULL,
  "scene_map_verification_receipt_body" jsonb NOT NULL,
  "scene_map_parser_receipt_id" uuid NOT NULL,
  "scene_map_parser_receipt_digest" varchar(64) NOT NULL,
  "scene_map_parser_receipt_expires_at" timestamptz NOT NULL,
  "scene_map_verification_profile" varchar(40) NOT NULL,
  "scene_map_parser_policy_digest" varchar(64) NOT NULL,
  "scene_map_parser_implementation_manifest_digest" varchar(64) NOT NULL,
  "scene_map_parser_runtime_identity_id" uuid,
  "scene_map_parser_runtime_identity_digest" varchar(64),
  "scene_map_parser_runtime_identity_effective_at" timestamptz,
  "scene_map_parser_runtime_identity_expires_at" timestamptz,
  "scene_map_parser_runtime_executable_artifact_digest" varchar(64),
  "scene_map_parser_runtime_deployment_image_digest" varchar(64),
  "scene_map_parser_runtime_verifier_capability_principal" varchar(63),
  "scene_map_parser_runtime_session_principal_sha256" varchar(64),
  "presentation_admission_reviewer_attestation_id" uuid NOT NULL,
  "presentation_admission_reviewer_attestation_digest" varchar(64) NOT NULL,
  "admission_reviewer_subject_id" uuid NOT NULL,
  "admission_reviewer_subject_kind" varchar(40)
    GENERATED ALWAYS AS ('reviewed_profile') STORED,
  "admission_reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('admission_reviewer') STORED,
  "admission_reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('presentation_admission') STORED,
  "admission_reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("admission_reviewer_subject_id"::text) STORED,
  "admission_reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("presentation_admission_digest") STORED,
  "presentation_admission_reviewer_actor_id" uuid NOT NULL,
  "presentation_admission_reviewer_effective_at" timestamptz NOT NULL,
  "presentation_admission_reviewer_expires_at" timestamptz NOT NULL,
  "transform_review_id" uuid NOT NULL,
  "transform_artifact_row_id" uuid NOT NULL,
  "transform_review_subject_digest" varchar(64) NOT NULL,
  "transform_review_digest" varchar(64) NOT NULL,
  "transform_reviewer_actor_id" uuid NOT NULL,
  "transform_review_expires_at" timestamptz NOT NULL,
  "twin_release_authority_id" uuid NOT NULL,
  "twin_release_record_kind" varchar(50)
    GENERATED ALWAYS AS ('twin_release_authority') STORED,
  "twin_release_id" uuid NOT NULL,
  "twin_release_digest" varchar(64) NOT NULL,
  "twin_release_manifest_digest" varchar(64) NOT NULL,
  "twin_release_authority_digest" varchar(64) NOT NULL,
  "twin_release_authority_actor_id" uuid NOT NULL,
  "twin_release_authority_expires_at" timestamptz NOT NULL,
  "room_scope_basis_digest" varchar(64) NOT NULL,
  "coverage_decision" varchar(70) NOT NULL,
  "coverage_digest" varchar(64) NOT NULL,
  "whole_region_count" integer NOT NULL,
  "member_count" integer NOT NULL,
  "scene_validation_subject_digest" varchar(64) NOT NULL,
  "authority_expires_at" timestamptz NOT NULL,
  "validated_at" timestamptz NOT NULL,
  "subject_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scene_subjects_subject_fk" FOREIGN KEY (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug", "runtime_manifest_digest", "scene_artifact_row_id",
    "scene_artifact_id", "scene_artifact_digest", "admission_member_count"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "runtime_manifest_digest", "scene_authority_artifact_row_id",
    "scene_authority_artifact_id", "scene_authority_map_digest", "member_count"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_registry_fk" FOREIGN KEY (
    "scene_artifact_row_id", "venue_slug", "scene_artifact_kind",
    "scene_artifact_id", "scene_artifact_digest", "scene_registry_object_key",
    "scene_registry_object_sha256", "scene_registry_object_size_bytes",
    "scene_registry_schema_version", "scene_registry_registered_by",
    "scene_registry_registered_at"
  ) REFERENCES "reconstruction_review_evidence_artifacts" (
    "id", "venue_slug", "artifact_kind", "artifact_id", "artifact_digest",
    "object_key", "object_sha256", "size_bytes", "schema_version",
    "registered_by", "registered_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_derivation_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "derivation_evidence_digest", "admission_member_count",
    "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "member_count", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_verification_receipt_fk" FOREIGN KEY (
    "scene_map_verification_receipt_id", "scene_map_parser_receipt_id",
    "id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "presentation_admission_id", "derivation_id",
    "transform_review_id", "twin_release_authority_id",
    "scene_artifact_row_id", "scene_object_receipt_id",
    "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_capability_expires_at",
    "scene_map_parser_receipt_digest",
    "scene_map_verification_receipt_digest",
    "scene_map_verification_profile", "scene_map_parser_policy_digest",
    "scene_map_parser_implementation_manifest_digest",
    "scene_map_verification_receipt_expires_at"
  ) REFERENCES "hr_verified_scene_map_receipts" (
    "id", "parser_receipt_id", "scene_validation_id", "environment_id",
    "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "derivation_id", "transform_review_id",
    "twin_release_authority_id", "scene_artifact_row_id",
    "scene_object_receipt_id", "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at",
    "parser_receipt_digest",
    "scene_map_verification_receipt_digest", "verification_profile",
    "parser_policy_digest", "parser_implementation_manifest_digest",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_handle_runtime_exact_fk" FOREIGN KEY (
    "scene_map_verification_receipt_id",
    "scene_map_parser_runtime_identity_id",
    "scene_map_parser_runtime_identity_digest"
  ) REFERENCES "hr_verified_scene_map_receipts" (
    "id", "parser_runtime_identity_id", "parser_runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_parser_runtime_identity_fk" FOREIGN KEY (
    "scene_map_parser_runtime_identity_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "scene_map_parser_implementation_manifest_digest",
    "scene_map_parser_runtime_executable_artifact_digest",
    "scene_map_parser_runtime_deployment_image_digest",
    "scene_map_parser_policy_digest",
    "scene_map_parser_runtime_verifier_capability_principal",
    "scene_map_parser_runtime_session_principal_sha256",
    "scene_map_parser_runtime_identity_effective_at",
    "scene_map_parser_runtime_identity_expires_at",
    "scene_map_parser_runtime_identity_digest"
  ) REFERENCES "hr_scene_parser_runtime_identities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "source_manifest_digest",
    "executable_artifact_digest", "deployment_image_digest",
    "parser_policy_digest", "verifier_capability_principal",
    "verifier_session_principal_sha256", "effective_at", "expires_at",
    "runtime_identity_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_object_authority_fk" FOREIGN KEY (
    "scene_object_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scene_capability_id",
    "scene_capability_digest", "scene_provider_profile",
    "scene_provider_kind", "scene_provider_account_sha256",
    "scene_endpoint_authority_sha256", "scene_private_bucket_sha256",
    "scene_receipt_role", "scene_object_receipt_digest",
    "scene_receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_object_bytes_fk" FOREIGN KEY (
    "scene_object_receipt_id", "scene_registry_object_sha256",
    "scene_registry_object_size_bytes", "scene_file_name", "scene_mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_object_version_fk" FOREIGN KEY (
    "scene_object_receipt_id", "scene_storage_key_sha256",
    "scene_version_kind", "scene_storage_version"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_key_sha256", "version_kind", "storage_version"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_object_etag_fk" FOREIGN KEY (
    "scene_object_receipt_id", "scene_storage_etag"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_etag"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_capability_fk" FOREIGN KEY (
    "scene_capability_id", "environment_id", "environment_mode",
    "environment_digest", "scene_capability_digest", "venue_id", "space_id",
    "scene_capability_expires_at"
  ) REFERENCES "hr_provider_capabilities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "capability_digest", "venue_id", "space_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_admission_reviewer_fk" FOREIGN KEY (
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "admission_reviewer_subject_id", "admission_reviewer_subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "admission_reviewer_role",
    "presentation_admission_reviewer_actor_id",
    "admission_reviewer_bound_kind", "admission_reviewer_bound_reference",
    "admission_reviewer_bound_digest",
    "presentation_admission_reviewer_effective_at",
    "presentation_admission_reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_transform_fk" FOREIGN KEY (
    "transform_review_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id", "transform_artifact_row_id",
    "transform_review_subject_digest", "transform_review_digest",
    "transform_reviewer_actor_id", "transform_review_expires_at"
  ) REFERENCES "hr_transform_reviews" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "transform_artifact_row_id",
    "transform_review_subject_digest", "transform_review_digest",
    "reviewer_actor_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_twin_fk" FOREIGN KEY (
    "twin_release_authority_id", "twin_release_record_kind", "id",
    "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "twin_release_authority_digest", "twin_release_authority_expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_subjects_shape" CHECK ((
    "subject_kind" = 'scene_validation'
    AND "scene_artifact_kind" = 'scene_authority_map_v0'
    AND "scene_registry_schema_version" = 'venviewer.scene-authority-map.v0'
    AND "scene_registry_object_size_bytes" = octet_length("scene_raw_bytes")
    AND "scene_registry_object_size_bytes" BETWEEN 1 AND 4194304
    AND encode(digest("scene_raw_bytes", 'sha256'), 'hex') =
      "scene_registry_object_sha256"
    AND convert_from("scene_raw_bytes", 'UTF8')::jsonb =
      "scene_parsed_map_body"
    AND "scene_parsed_map_body"->>'schemaVersion' =
      'venviewer.scene-authority-map.v0'
    AND "scene_parsed_map_body"->>'id' = "scene_artifact_id"
    AND "scene_parsed_map_body"->>'venueSlug' = "venue_slug"
    AND "scene_map_verification_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "scene_map_parser_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "scene_map_verification_receipt_expires_at" =
      "scene_map_parser_receipt_expires_at"
    AND jsonb_typeof("scene_map_verification_receipt_body") = 'object'
    AND (
      "scene_map_verification_receipt_body"->>
        'sceneMapVerificationReceiptId'
    )::uuid = "scene_map_verification_receipt_id"
    AND (
      "scene_map_verification_receipt_body"->>'parserReceiptId'
    )::uuid = "scene_map_parser_receipt_id"
    AND "scene_map_verification_receipt_body"->>'parserReceiptDigest' =
      "scene_map_parser_receipt_digest"
    AND "scene_map_verification_receipt_body"->>
      'sceneMapVerificationReceiptDigest' =
      "scene_map_verification_receipt_digest"
    AND "scene_map_parser_policy_digest" =
      'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1'
    AND "scene_map_parser_implementation_manifest_digest" =
      '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17'
    AND (
      ("scene_map_verification_profile" = 'production_runtime'
        AND "environment_mode" = 'production'
        AND "scene_map_parser_runtime_identity_id" IS NOT NULL
        AND "scene_map_parser_runtime_identity_digest" ~ '^[a-f0-9]{64}$'
        AND "scene_map_parser_runtime_identity_effective_at" <=
          "validated_at"
        AND "validated_at" <
          "scene_map_parser_runtime_identity_expires_at"
        AND "scene_map_parser_runtime_executable_artifact_digest" ~
          '^[a-f0-9]{64}$'
        AND "scene_map_parser_runtime_deployment_image_digest" ~
          '^[a-f0-9]{64}$'
        AND "scene_map_parser_runtime_verifier_capability_principal" =
          'omnitwin_historical_evidence_verifier'
        AND "scene_map_parser_runtime_session_principal_sha256" ~
          '^[a-f0-9]{64}$')
      OR ("scene_map_verification_profile" = 'local_test_fixture'
        AND "environment_mode" = 'test'
        AND "scene_map_parser_runtime_identity_id" IS NULL
        AND "scene_map_parser_runtime_identity_digest" IS NULL
        AND "scene_map_parser_runtime_identity_effective_at" IS NULL
        AND "scene_map_parser_runtime_identity_expires_at" IS NULL
        AND "scene_map_parser_runtime_executable_artifact_digest" IS NULL
        AND "scene_map_parser_runtime_deployment_image_digest" IS NULL
        AND "scene_map_parser_runtime_verifier_capability_principal" IS NULL
        AND "scene_map_parser_runtime_session_principal_sha256" IS NULL)
    )
    AND encode(digest(
      convert_to("scene_registry_object_key", 'UTF8'), 'sha256'
    ), 'hex') = "scene_storage_key_sha256"
    AND "coverage_decision" =
      'whole_room_and_all_runtime_members_covered'
    AND "whole_region_count" BETWEEN 1 AND 2000
    AND "member_count" = "admission_member_count"
    AND "member_count" BETWEEN 1 AND 8
    AND "scene_validation_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "coverage_digest" ~ '^[a-f0-9]{64}$'
    AND "room_scope_basis_digest" ~ '^[a-f0-9]{64}$'
    AND "scene_registry_registered_at" <= "validated_at"
    AND "presentation_admission_reviewer_effective_at" <= "validated_at"
    AND "validated_at" = "created_at"
    AND "validated_at" < "authority_expires_at"
    AND "authority_expires_at" = LEAST(
      "presentation_admission_reviewer_expires_at",
      "derivation_expires_at", "transform_review_expires_at",
      "twin_release_authority_expires_at", "scene_capability_expires_at",
      "scene_receipt_expires_at",
      "scene_map_verification_receipt_expires_at",
      "scene_map_parser_receipt_expires_at",
      COALESCE("scene_map_parser_runtime_identity_expires_at", 'infinity')
    )
    AND "presentation_admission_reviewer_actor_id" <>
      "transform_reviewer_actor_id"
    AND "presentation_admission_reviewer_actor_id" <>
      "twin_release_authority_actor_id"
    AND "presentation_admission_reviewer_actor_id" <>
      "scene_registry_registered_by"
    AND "transform_reviewer_actor_id" <> "twin_release_authority_actor_id"
    AND "transform_reviewer_actor_id" <> "scene_registry_registered_by"
    AND "twin_release_authority_actor_id" <> "scene_registry_registered_by"
    AND jsonb_typeof("subject_body") = 'object'
    AND "subject_body"->>'schemaVersion' =
      'historical-runtime-scene-authority-subject.v1'
    AND ("subject_body"->>'sceneValidationId')::uuid = "id"
    AND ("subject_body"->>'sceneArtifactRowId')::uuid =
      "scene_artifact_row_id"
    AND "subject_body"->>'sceneArtifactId' = "scene_artifact_id"
    AND "subject_body"->>'sceneArtifactDigest' = "scene_artifact_digest"
    AND "subject_body"->>'sceneRegistryObjectSha256' =
      "scene_registry_object_sha256"
    AND ("subject_body"->>'sceneRegistryObjectSizeBytes')::bigint =
      "scene_registry_object_size_bytes"
    AND ("subject_body"->'sceneObjectReceipt'->>'receiptId')::uuid =
      "scene_object_receipt_id"
    AND "subject_body"->'sceneObjectReceipt'->>'receiptDigest' =
      "scene_object_receipt_digest"
    AND "subject_body"->>'parsedMapDigest' = "parsed_map_digest"
    AND ("subject_body"->>'sceneMapVerificationReceiptId')::uuid =
      "scene_map_verification_receipt_id"
    AND "subject_body"->>'sceneMapVerificationReceiptDigest' =
      "scene_map_verification_receipt_digest"
    AND ("subject_body"->>'sceneMapVerificationReceiptExpiresAt'
      )::timestamptz = "scene_map_verification_receipt_expires_at"
    AND "subject_body"->'sceneMapVerificationReceipt' =
      "scene_map_verification_receipt_body"
    AND ("subject_body"->>'sceneMapParserReceiptId')::uuid =
      "scene_map_parser_receipt_id"
    AND "subject_body"->>'sceneMapParserReceiptDigest' =
      "scene_map_parser_receipt_digest"
    AND ("subject_body"->>'sceneMapParserReceiptExpiresAt')::timestamptz =
      "scene_map_parser_receipt_expires_at"
    AND "subject_body"->>'sceneMapVerificationProfile' =
      "scene_map_verification_profile"
    AND "subject_body"->>'sceneMapParserPolicyDigest' =
      "scene_map_parser_policy_digest"
    AND "subject_body"->>'sceneMapParserImplementationManifestDigest' =
      "scene_map_parser_implementation_manifest_digest"
    AND NULLIF("subject_body"->>'sceneMapParserRuntimeIdentityId', '')::uuid
      IS NOT DISTINCT FROM "scene_map_parser_runtime_identity_id"
    AND NULLIF("subject_body"->>'sceneMapParserRuntimeIdentityDigest', '')
      IS NOT DISTINCT FROM "scene_map_parser_runtime_identity_digest"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeIdentityEffectiveAt', '')::timestamptz
      IS NOT DISTINCT FROM "scene_map_parser_runtime_identity_effective_at"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeIdentityExpiresAt', '')::timestamptz
      IS NOT DISTINCT FROM "scene_map_parser_runtime_identity_expires_at"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeExecutableArtifactDigest', '')
      IS NOT DISTINCT FROM
      "scene_map_parser_runtime_executable_artifact_digest"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeDeploymentImageDigest', '')
      IS NOT DISTINCT FROM
      "scene_map_parser_runtime_deployment_image_digest"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeVerifierCapabilityPrincipal', '')
      IS NOT DISTINCT FROM
      "scene_map_parser_runtime_verifier_capability_principal"
    AND NULLIF("subject_body"->>
      'sceneMapParserRuntimeSessionPrincipalSha256', '')
      IS NOT DISTINCT FROM
      "scene_map_parser_runtime_session_principal_sha256"
    AND "subject_body"->>'coverageDigest' = "coverage_digest"
    AND ("subject_body"->>'validatedAt')::timestamptz = "validated_at"
    AND ("subject_body"->>'presentationAdmissionReviewerAttestationId')::uuid =
      "presentation_admission_reviewer_attestation_id"
    AND "subject_body"->>
      'presentationAdmissionReviewerAttestationDigest' =
      "presentation_admission_reviewer_attestation_digest"
    AND ("subject_body"->>'presentationAdmissionReviewerActorId')::uuid =
      "presentation_admission_reviewer_actor_id"
    AND (
      "subject_body"->>'presentationAdmissionReviewerAttestationExpiresAt'
    )::timestamptz = "presentation_admission_reviewer_expires_at"
    AND ("subject_body"->>'transformReviewExpiresAt')::timestamptz =
      "transform_review_expires_at"
    AND ("subject_body"->>'derivationExpiresAt')::timestamptz =
      "derivation_expires_at"
    AND ("subject_body"->>'twinReleaseAuthorityReceiptId')::uuid =
      "twin_release_authority_id"
    AND "subject_body"->>'twinReleaseAuthorityDigest' =
      "twin_release_authority_digest"
    AND "subject_body"->>'twinReleaseDigest' = "twin_release_digest"
    AND ("subject_body"->>'twinReleaseAuthorityExpiresAt')::timestamptz =
      "twin_release_authority_expires_at"
    AND ("subject_body"->>'providerCapabilityReceiptId')::uuid =
      "scene_capability_id"
    AND "subject_body"->>'providerCapabilityDigest' =
      "scene_capability_digest"
    AND ("subject_body"->>'providerCapabilityExpiresAt')::timestamptz =
      "scene_capability_expires_at"
    AND ("subject_body"->>'authorityExpiresAt')::timestamptz =
      "authority_expires_at"
    AND "subject_body"->>'sceneValidationSubjectDigest' =
      "scene_validation_subject_digest"
  ) IS TRUE),
  CONSTRAINT "hr_scene_subjects_member_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "coverage_digest",
    "scene_validation_subject_digest", "member_count", "authority_expires_at"
  ),
  CONSTRAINT "hr_scene_subjects_member_fk_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "coverage_digest",
    "scene_validation_subject_digest", "authority_expires_at"
  ),
  CONSTRAINT "hr_scene_subjects_region_fk_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "coverage_digest"
  ),
  CONSTRAINT "hr_scene_subjects_final_fk_unique" UNIQUE (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "validated_at",
    "presentation_admission_reviewer_actor_id", "transform_reviewer_actor_id",
    "twin_release_authority_actor_id", "scene_registry_registered_by",
    "authority_expires_at"
  )
);

CREATE TABLE "hr_scene_whole_regions" (
  "scene_validation_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "coverage_digest" varchar(64) NOT NULL,
  "whole_region_index" integer NOT NULL,
  "region_id" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scene_whole_regions_pkey"
    PRIMARY KEY ("scene_validation_id", "whole_region_index"),
  CONSTRAINT "hr_scene_whole_regions_subject_fk" FOREIGN KEY (
    "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "coverage_digest"
  ) REFERENCES "hr_scene_validation_subjects" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "coverage_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_whole_regions_shape" CHECK ((
    "whole_region_index" BETWEEN 0 AND 1999
    AND length(btrim("region_id")) BETWEEN 1 AND 120
  ) IS TRUE),
  CONSTRAINT "hr_scene_whole_regions_id_unique"
    UNIQUE ("scene_validation_id", "region_id")
);

CREATE TABLE "hr_scene_validation_members" (
  "scene_validation_id" uuid NOT NULL,
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
  "coverage_digest" varchar(64) NOT NULL,
  "scene_validation_subject_digest" varchar(64) NOT NULL,
  "scene_authority_expires_at" timestamptz NOT NULL,
  "member_index" integer NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "derivation_output_receipt_id" uuid NOT NULL,
  "derivation_member_receipt_digest" varchar(64) NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "derivation_receipt_expires_at" timestamptz NOT NULL,
  "rights_evidence_row_id" uuid NOT NULL,
  "rights_evidence_digest" varchar(64) NOT NULL,
  "rights_decision" varchar(20) NOT NULL,
  "rights_reviewed_by" uuid NOT NULL,
  "rights_reviewed_at" timestamptz NOT NULL,
  "authority_reference" text NOT NULL,
  "covered_region_count" integer NOT NULL,
  "member_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scene_members_pkey"
    PRIMARY KEY ("scene_validation_id", "member_index"),
  CONSTRAINT "hr_scene_members_subject_fk" FOREIGN KEY (
    "scene_validation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id",
    "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "coverage_digest",
    "scene_validation_subject_digest", "scene_authority_expires_at"
  ) REFERENCES "hr_scene_validation_subjects" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "runtime_package_content_digest", "derivation_id",
    "derivation_evidence_digest", "coverage_digest",
    "scene_validation_subject_digest", "authority_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_members_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "member_index", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "space_slug",
    "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "storage_key_sha256", "rights_evidence_row_id",
    "rights_evidence_digest", "rights_decision", "rights_reviewed_by",
    "rights_reviewed_at"
  ) REFERENCES "runtime_presentation_admission_members" (
    "admission_id", "member_index", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "storage_key_sha256", "rights_evidence_row_id",
    "rights_evidence_digest", "rights_decision", "rights_reviewed_by",
    "rights_reviewed_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_members_derivation_fk" FOREIGN KEY (
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
  CONSTRAINT "hr_scene_members_shape" CHECK ((
    "member_index" BETWEEN 0 AND 7
    AND "rights_decision" = 'approved'
    AND length(btrim("authority_reference")) BETWEEN 1 AND 1024
    AND octet_length("authority_reference") <= 512
    AND "covered_region_count" BETWEEN 1 AND 2000
    AND "created_at" < LEAST(
      "scene_authority_expires_at", "derivation_receipt_expires_at"
    )
    AND jsonb_typeof("member_body") = 'object'
    AND ("member_body"->>'memberIndex')::integer = "member_index"
    AND ("member_body"->>'assetVersionId')::uuid = "asset_version_id"
    AND ("member_body"->>'derivationOutputReceiptId')::uuid =
      "derivation_output_receipt_id"
    AND "member_body"->>'derivationMemberReceiptDigest' =
      "derivation_member_receipt_digest"
    AND "member_body"->>'authorityReference' = "authority_reference"
    AND jsonb_array_length("member_body"->'coveredRegionIds') =
      "covered_region_count"
  ) IS TRUE),
  CONSTRAINT "hr_scene_members_asset_unique"
    UNIQUE ("scene_validation_id", "asset_version_id"),
  CONSTRAINT "hr_scene_members_receipt_unique"
    UNIQUE ("scene_validation_id", "derivation_output_receipt_id"),
  CONSTRAINT "hr_scene_members_reference_unique"
    UNIQUE ("scene_validation_id", "authority_reference"),
  CONSTRAINT "hr_scene_members_exact_unique" UNIQUE (
    "scene_validation_id", "member_index", "environment_id",
    "environment_mode", "environment_digest", "coverage_digest",
    "venue_id", "space_id",
    "presentation_admission_id", "runtime_package_id", "derivation_id",
    "asset_version_id", "derivation_output_receipt_id",
    "derivation_member_receipt_digest", "authority_reference",
    "scene_validation_subject_digest", "scene_authority_expires_at"
  )
);

CREATE TABLE "hr_scene_member_regions" (
  "scene_validation_id" uuid NOT NULL,
  "member_index" integer NOT NULL,
  "covered_region_index" integer NOT NULL,
  "region_id" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scene_member_regions_pkey"
    PRIMARY KEY (
      "scene_validation_id", "member_index", "covered_region_index"
    ),
  CONSTRAINT "hr_scene_member_regions_member_fk" FOREIGN KEY (
    "scene_validation_id", "member_index"
  ) REFERENCES "hr_scene_validation_members" (
    "scene_validation_id", "member_index"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_member_regions_whole_fk" FOREIGN KEY (
    "scene_validation_id", "region_id"
  ) REFERENCES "hr_scene_whole_regions" (
    "scene_validation_id", "region_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_member_regions_shape" CHECK ((
    "covered_region_index" BETWEEN 0 AND 1999
    AND length(btrim("region_id")) BETWEEN 1 AND 120
  ) IS TRUE),
  CONSTRAINT "hr_scene_member_regions_id_unique" UNIQUE (
    "scene_validation_id", "member_index", "region_id"
  )
);

CREATE TABLE "hr_scene_validations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('scene_validation') STORED,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "scene_validation_subject_digest" varchar(64) NOT NULL,
  "subject_authority_expires_at" timestamptz NOT NULL,
  "subject_validated_at" timestamptz NOT NULL,
  "admission_reviewer_actor_id" uuid NOT NULL,
  "transform_reviewer_actor_id" uuid NOT NULL,
  "twin_release_authority_actor_id" uuid NOT NULL,
  "scene_registry_actor_id" uuid NOT NULL,
  "reviewer_attestation_id" uuid NOT NULL,
  "reviewer_attestation_digest" varchar(64) NOT NULL,
  "reviewer_role" varchar(50) GENERATED ALWAYS AS ('scene_reviewer') STORED,
  "reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('scene_validation_subject') STORED,
  "reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("scene_validation_subject_digest") STORED,
  "reviewer_actor_id" uuid NOT NULL,
  "reviewer_attestation_effective_at" timestamptz NOT NULL,
  "reviewer_attestation_expires_at" timestamptz NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "scene_validation_digest" varchar(64) NOT NULL,
  "scene_validation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scene_validations_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "scene_validation_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_validations_subject_fk" FOREIGN KEY (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "subject_validated_at",
    "admission_reviewer_actor_id", "transform_reviewer_actor_id",
    "twin_release_authority_actor_id", "scene_registry_actor_id",
    "subject_authority_expires_at"
  ) REFERENCES "hr_scene_validation_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "validated_at",
    "presentation_admission_reviewer_actor_id", "transform_reviewer_actor_id",
    "twin_release_authority_actor_id", "scene_registry_registered_by",
    "authority_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_validations_reviewer_fk" FOREIGN KEY (
    "reviewer_attestation_id", "reviewer_attestation_digest", "id",
    "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "reviewer_role", "reviewer_actor_id", "reviewer_bound_kind",
    "reviewer_bound_reference", "reviewer_bound_digest",
    "reviewer_attestation_effective_at",
    "reviewer_attestation_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scene_validations_shape" CHECK ((
    "subject_kind" = 'scene_validation'
    AND "reviewed_at" = "created_at"
    AND "reviewed_at" >= "subject_validated_at"
    AND "reviewer_attestation_effective_at" <= "reviewed_at"
    AND "reviewed_at" < "expires_at"
    AND "expires_at" = LEAST(
      "subject_authority_expires_at", "reviewer_attestation_expires_at"
    )
    AND "expires_at" <= "reviewed_at" + interval '30 days'
    AND "reviewer_actor_id" <> "admission_reviewer_actor_id"
    AND "reviewer_actor_id" <> "transform_reviewer_actor_id"
    AND "reviewer_actor_id" <> "twin_release_authority_actor_id"
    AND "reviewer_actor_id" <> "scene_registry_actor_id"
    AND "scene_validation_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("scene_validation_body") = 'object'
    AND "scene_validation_body"->>'schemaVersion' =
      'historical-runtime-scene-authority-receipt.v1'
    AND "scene_validation_body"->>'sceneValidationSubjectDigest' =
      "scene_validation_subject_digest"
    AND ("scene_validation_body"->>'reviewerAttestationId')::uuid =
      "reviewer_attestation_id"
    AND "scene_validation_body"->>'reviewerAttestationDigest' =
      "reviewer_attestation_digest"
    AND ("scene_validation_body"->>'reviewerActorId')::uuid =
      "reviewer_actor_id"
    AND (
      "scene_validation_body"->>'reviewerAttestationExpiresAt'
    )::timestamptz = "reviewer_attestation_expires_at"
    AND ("scene_validation_body"->>'reviewedAt')::timestamptz = "reviewed_at"
    AND ("scene_validation_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "scene_validation_body"->>'sceneValidationDigest' =
      "scene_validation_digest"
  ) IS TRUE),
  CONSTRAINT "hr_scene_validations_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id",
    "scene_validation_subject_digest", "scene_validation_digest",
    "reviewer_actor_id", "expires_at"
  )
);

-- 0065 already owns the core revocation and legacy execution audit kinds.
-- This Scene-only slice adds exactly one authenticated action for production
-- Twin approval; 0067 may replace these checks additively for execution-v2.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
ALTER TABLE "hr_authenticated_action_assertions"
  DROP CONSTRAINT "hr_action_assertions_shape",
  ADD CONSTRAINT "hr_action_assertions_shape" CHECK ((
    "audience" = 'historical_runtime_evidence'
    AND "action_kind" IN (
      'scope_epoch_revocation', 'provider_capability_revocation',
      'signing_key_authority_revocation', 'role_attestation_revocation',
      'evidence_record_revocation', 'execution_activation_revocation',
      'execution_activation_request',
      'twin_release_authority_approval'
    )
    AND "environment_mode" IN ('production', 'test')
    AND "authentication_source" IN ('clerk_session', 'local_test_fixture')
    AND ("environment_mode" = 'test'
      OR "authentication_source" = 'clerk_session')
    AND "authentication_audience" =
      'venviewer_historical_runtime_evidence'
    AND "authentication_session_sha256" ~ '^[a-f0-9]{64}$'
    AND "authentication_subject_sha256" ~ '^[a-f0-9]{64}$'
    AND "authentication_session_issued_at" <= "authenticated_at"
    AND "authenticated_at" < "authentication_session_expires_at"
    AND length("authenticated_by_database_principal") BETWEEN 1 AND 63
    AND "action_parameters_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("action_parameters_body") = 'object'
    AND "action_parameters_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-action-parameters.v1\n'
        || "hr_stable_canonical_json"("action_parameters_body"), 'UTF8'
    ), 'sha256'), 'hex')
    AND "platform_role" IN ('none', 'operator', 'admin')
    AND "user_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin')
    AND "workspace_state" IN ('active', 'not_applicable')
    AND ("platform_role" <> 'none' OR "user_venue_id" = "venue_id")
    AND (
      ("workspace_state" = 'active' AND "membership_id" IS NOT NULL
        AND "workspace_id" IS NOT NULL AND "workspace_role" IS NOT NULL
        AND "venue_role" IS NOT NULL AND "membership_updated_at" IS NOT NULL
        AND "membership_version_digest" ~ '^[a-f0-9]{64}$'
        AND "membership_updated_at" <= "authenticated_at")
      OR ("workspace_state" = 'not_applicable' AND "membership_id" IS NULL
        AND "workspace_id" IS NULL AND "workspace_role" IS NULL
        AND "venue_role" IS NULL AND "membership_updated_at" IS NULL
        AND "membership_version_digest" IS NULL
        AND "platform_role" IN ('operator', 'admin'))
    )
    AND "authenticated_at" = "created_at"
    AND "authenticated_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "authenticated_at" + interval '5 minutes',
      "authentication_session_expires_at",
      "authority_scope_epoch_expires_at"
    )
    AND "assertion_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("assertion_body") = 'object'
    AND "assertion_body"->>'schemaVersion' =
      'historical-runtime-authenticated-action-assertion.v1'
    AND ("assertion_body"->>'assertionId')::uuid = "id"
    AND "assertion_body"->>'audience' = "audience"
    AND "assertion_body"->>'actionKind' = "action_kind"
    AND ("assertion_body"->>'actionId')::uuid = "action_id"
    AND "assertion_body"->>'actionParametersDigest' =
      "action_parameters_digest"
    AND "assertion_body"->'actionParameters' = "action_parameters_body"
    AND ("assertion_body"->>'environmentId')::uuid = "environment_id"
    AND "assertion_body"->>'environmentMode' = "environment_mode"
    AND "assertion_body"->>'environmentDigest' = "environment_digest"
    AND ("assertion_body"->>'venueId')::uuid = "venue_id"
    AND ("assertion_body"->>'spaceId')::uuid = "space_id"
    AND ("assertion_body"->>'actorId')::uuid = "actor_id"
    AND "assertion_body"->>'authenticationSource' = "authentication_source"
    AND "assertion_body"->>'authenticationAudience' =
      "authentication_audience"
    AND "assertion_body"->>'authenticationSessionSha256' =
      "authentication_session_sha256"
    AND "assertion_body"->>'authenticationSubjectSha256' =
      "authentication_subject_sha256"
    AND ("assertion_body"->>'authenticationSessionIssuedAt')::timestamptz =
      "authentication_session_issued_at"
    AND ("assertion_body"->>'authenticationSessionExpiresAt')::timestamptz =
      "authentication_session_expires_at"
    AND "assertion_body"->>'authenticatedByDatabasePrincipal' =
      "authenticated_by_database_principal"
    AND "assertion_body"->>'platformRole' = "platform_role"
    AND "assertion_body"->>'userRole' = "user_role"
    AND ("assertion_body"->>'authenticatedAt')::timestamptz =
      "authenticated_at"
    AND ("assertion_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "assertion_body"->>'assertionDigest' = "assertion_digest"
    AND "assertion_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-authenticated-action-assertion.v1\n'
        || "hr_stable_canonical_json"(
          "assertion_body" - 'assertionDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE);

ALTER TABLE "hr_action_authority_snapshots"
  DROP CONSTRAINT "hr_action_authority_shape",
  ADD CONSTRAINT "hr_action_authority_shape" CHECK ((
    "authority_role" IN (
      'revoker', 'execution_requester', 'twin_release_approver'
    )
    AND (
      ("action_kind" IN (
        'scope_epoch_revocation', 'provider_capability_revocation',
        'signing_key_authority_revocation', 'role_attestation_revocation',
        'evidence_record_revocation', 'execution_activation_revocation'
      ) AND "authority_role" = 'revoker')
      OR ("action_kind" = 'execution_activation_request'
        AND "authority_role" = 'execution_requester')
      OR ("action_kind" = 'twin_release_authority_approval'
        AND "authority_role" = 'twin_release_approver')
    )
    AND "authentication_asserted_at" <= "snapshotted_at"
    AND "snapshotted_at" = "created_at"
    AND "snapshotted_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "snapshotted_at" + interval '5 minutes',
      "authentication_assertion_expires_at",
      "authority_scope_epoch_expires_at"
    )
    AND "authority_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("authority_body") = 'object'
    AND "authority_body"->>'schemaVersion' =
      'historical-runtime-action-authority-snapshot.v1'
    AND ("authority_body"->>'authoritySnapshotId')::uuid = "id"
    AND "authority_body"->>'actionKind' = "action_kind"
    AND ("authority_body"->>'actionId')::uuid = "action_id"
    AND "authority_body"->>'actionParametersDigest' =
      "action_parameters_digest"
    AND "authority_body"->>'authorityRole' = "authority_role"
    AND ("authority_body"->>'authenticationAssertionId')::uuid =
      "authentication_assertion_id"
    AND "authority_body"->>'authenticationAssertionDigest' =
      "authentication_assertion_digest"
    AND ("authority_body"->>'environmentId')::uuid = "environment_id"
    AND "authority_body"->>'environmentMode' = "environment_mode"
    AND "authority_body"->>'environmentDigest' = "environment_digest"
    AND ("authority_body"->>'venueId')::uuid = "venue_id"
    AND ("authority_body"->>'spaceId')::uuid = "space_id"
    AND ("authority_body"->>'actorId')::uuid = "actor_id"
    AND ("authority_body"->>'snapshottedAt')::timestamptz = "snapshotted_at"
    AND ("authority_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "authority_body"->>'authorityDigest' = "authority_digest"
    AND "authority_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-action-authority-snapshot.v1\n'
        || "hr_stable_canonical_json"(
          "authority_body" - 'authorityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE);
RESET ROLE;

-- This private consumer recognizes only the new Twin-approval action. The
-- ordinary API cannot use it for core revocations or legacy execution.
CREATE OR REPLACE FUNCTION "hr_consume_high_assurance_action_authority"(
  p_assertion_id uuid,
  p_expected_action_kind text,
  p_expected_authority_role text
)
RETURNS "hr_action_authority_snapshots"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  assertion_identity record;
  assertion_row public."hr_authenticated_action_assertions"%ROWTYPE;
  live_user record;
  live_workspace record;
  live_membership record;
  role_allowed boolean;
  wall_now timestamptz;
  action_at timestamptz;
  snapshot_id uuid := gen_random_uuid();
  material_body jsonb;
  authority_digest text;
  issued public."hr_action_authority_snapshots"%ROWTYPE;
BEGIN
  IF NOT pg_has_role(session_user, 'omnitwin_api_activation', 'MEMBER')
     OR pg_has_role(
       session_user, 'omnitwin_historical_auth_gateway', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_evidence_verifier', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_evidence_owner', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_schema_owner', 'MEMBER'
     ) THEN
    RAISE EXCEPTION 'high-assurance action requires the isolated API principal'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_high_assurance_action_api_isolation';
  END IF;
  IF p_expected_authority_role <> 'twin_release_approver'
     OR p_expected_action_kind <> 'twin_release_authority_approval' THEN
    RAISE EXCEPTION 'unsupported high-assurance authority action'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_kind';
  END IF;

  SELECT "environment_id", "venue_id", "space_id"
  INTO STRICT assertion_identity
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = p_assertion_id
    AND "action_kind" = p_expected_action_kind;
  PERFORM public."hr_lock_scope"(
    assertion_identity."environment_id", assertion_identity."venue_id",
    assertion_identity."space_id"
  );
  PERFORM public."hr_lock_authority"(
    'authenticated-action', p_assertion_id::text
  );
  SELECT * INTO STRICT assertion_row
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = p_assertion_id
    AND "action_kind" = p_expected_action_kind
  FOR SHARE;
  PERFORM public."hr_assert_scope_current"(
    assertion_row."authority_scope_epoch_id", assertion_row."environment_id",
    assertion_row."environment_mode", assertion_row."environment_digest",
    assertion_row."venue_id", assertion_row."space_id",
    public."hr_wall_clock_ms"()
  );

  SELECT * INTO issued
  FROM public."hr_action_authority_snapshots"
  WHERE "authentication_assertion_id" = p_assertion_id;
  IF FOUND THEN
    IF issued."action_kind" IS DISTINCT FROM p_expected_action_kind
       OR issued."authority_role" IS DISTINCT FROM
          p_expected_authority_role THEN
      RAISE EXCEPTION 'authenticated assertion was consumed for another action'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_authenticated_action_single_use';
    END IF;
    RETURN issued;
  END IF;

  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_user
  FROM public."users"
  WHERE "id" = assertion_row."actor_id"
  FOR SHARE;
  IF live_user."role" IS DISTINCT FROM assertion_row."user_role"
     OR live_user."platform_role" IS DISTINCT FROM assertion_row."platform_role"
     OR live_user."venue_id" IS DISTINCT FROM assertion_row."user_venue_id"
     OR (assertion_row."authentication_source" = 'clerk_session'
       AND (live_user."clerk_id" IS NULL OR
         encode(digest(convert_to(
           E'venviewer.historical-runtime-authenticated-subject.v1\n'
             || live_user."clerk_id", 'UTF8'
         ), 'sha256'), 'hex') IS DISTINCT FROM
           assertion_row."authentication_subject_sha256"))
     OR (assertion_row."authentication_source" = 'local_test_fixture'
       AND encode(digest(convert_to(
         E'venviewer.historical-runtime-authenticated-subject.v1\n'
           || assertion_row."actor_id"::text, 'UTF8'
       ), 'sha256'), 'hex') IS DISTINCT FROM
         assertion_row."authentication_subject_sha256") THEN
    RAISE EXCEPTION 'authenticated action assertion is no longer current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_authenticated_action_current';
  END IF;
  IF assertion_row."workspace_state" = 'active' THEN
    SELECT "primary_venue_id", "status", "deleted_at"
    INTO STRICT live_workspace
    FROM public."workspaces"
    WHERE "id" = assertion_row."workspace_id"
    FOR SHARE;
    SELECT "user_id", "workspace_id", "role", "venue_role", "status",
      date_trunc('milliseconds', "updated_at") AS updated_at
    INTO STRICT live_membership
    FROM public."workspace_memberships"
    WHERE "id" = assertion_row."membership_id"
    FOR SHARE;
    IF live_membership."user_id" IS DISTINCT FROM assertion_row."actor_id"
       OR live_membership."workspace_id" IS DISTINCT FROM
          assertion_row."workspace_id"
       OR live_membership."role" IS DISTINCT FROM assertion_row."workspace_role"
       OR live_membership."venue_role" IS DISTINCT FROM assertion_row."venue_role"
       OR live_membership."status" <> 'active'
       OR live_membership.updated_at IS DISTINCT FROM
          assertion_row."membership_updated_at"
       OR live_workspace."primary_venue_id" IS DISTINCT FROM
          assertion_row."venue_id"
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'authenticated action membership is no longer current'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_authenticated_action_current';
    END IF;
  END IF;

  role_allowed := p_expected_authority_role = 'twin_release_approver'
    AND assertion_row."platform_role" = 'admin';
  IF NOT role_allowed THEN
    RAISE EXCEPTION 'authenticated actor cannot perform requested action'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_action_authority_role';
  END IF;

  wall_now := public."hr_wall_clock_ms"();
  IF wall_now < assertion_row."authenticated_at"
     OR wall_now >= assertion_row."expires_at"
     OR wall_now >= assertion_row."authentication_session_expires_at" THEN
    RAISE EXCEPTION 'authenticated action assertion expired while locking'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_authenticated_action_current';
  END IF;
  action_at := public."hr_db_clock_ms"();
  material_body := jsonb_build_object(
    'actionId', assertion_row."action_id"::text,
    'actionKind', assertion_row."action_kind",
    'actionParametersDigest', assertion_row."action_parameters_digest",
    'actorId', assertion_row."actor_id"::text,
    'authenticationAssertion', assertion_row."assertion_body",
    'authenticationAssertionDigest', assertion_row."assertion_digest",
    'authenticationAssertionId', assertion_row."id"::text,
    'authorityRole', p_expected_authority_role,
    'authorityScopeEpoch', jsonb_build_object(
      'epoch', assertion_row."authority_scope_epoch",
      'epochDigest', assertion_row."authority_scope_epoch_digest",
      'epochId', assertion_row."authority_scope_epoch_id"::text,
      'expiresAt', public."hr_iso_utc_ms"(
        assertion_row."authority_scope_epoch_expires_at"
      )
    ),
    'authoritySnapshotId', snapshot_id::text,
    'environmentDigest', assertion_row."environment_digest",
    'environmentId', assertion_row."environment_id"::text,
    'environmentMode', assertion_row."environment_mode",
    'expiresAt', public."hr_iso_utc_ms"(LEAST(
      action_at + interval '5 minutes', assertion_row."expires_at",
      assertion_row."authority_scope_epoch_expires_at"
    )),
    'schemaVersion', 'historical-runtime-action-authority-snapshot.v1',
    'snapshottedAt', public."hr_iso_utc_ms"(action_at),
    'spaceId', assertion_row."space_id"::text,
    'tenantBoundary', 'venue_id_v1',
    'tenantId', assertion_row."venue_id"::text,
    'venueId', assertion_row."venue_id"::text
  );
  authority_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-action-authority-snapshot.v1\n'
      || public."hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  INSERT INTO public."hr_action_authority_snapshots" (
    "id", "action_kind", "action_id", "authority_role",
    "action_parameters_digest", "authentication_assertion_id",
    "authentication_assertion_digest", "authentication_asserted_at",
    "authentication_assertion_expires_at", "environment_id",
    "environment_mode", "environment_digest", "authority_scope_epoch_id",
    "authority_scope_epoch", "authority_scope_epoch_digest",
    "authority_scope_epoch_expires_at", "venue_id", "space_id", "actor_id",
    "snapshotted_at", "expires_at", "authority_digest", "authority_body",
    "created_at"
  ) VALUES (
    snapshot_id, assertion_row."action_kind", assertion_row."action_id",
    p_expected_authority_role, assertion_row."action_parameters_digest",
    assertion_row."id", assertion_row."assertion_digest",
    assertion_row."authenticated_at", assertion_row."expires_at",
    assertion_row."environment_id", assertion_row."environment_mode",
    assertion_row."environment_digest", assertion_row."authority_scope_epoch_id",
    assertion_row."authority_scope_epoch",
    assertion_row."authority_scope_epoch_digest",
    assertion_row."authority_scope_epoch_expires_at", assertion_row."venue_id",
    assertion_row."space_id", assertion_row."actor_id", action_at,
    LEAST(action_at + interval '5 minutes', assertion_row."expires_at",
      assertion_row."authority_scope_epoch_expires_at"),
    authority_digest, material_body || jsonb_build_object(
      'authorityDigest', authority_digest
    ), action_at
  ) RETURNING * INTO issued;
  INSERT INTO public."hr_authenticated_action_assertion_uses" (
    "authentication_assertion_id", "authentication_assertion_digest",
    "action_authority_snapshot_id", "action_kind", "action_id", "actor_id",
    "authentication_asserted_at", "used_at", "created_at"
  ) VALUES (
    assertion_row."id", assertion_row."assertion_digest", issued."id",
    assertion_row."action_kind", assertion_row."action_id",
    assertion_row."actor_id", assertion_row."authenticated_at", action_at,
    action_at
  );
  RETURN issued;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'authenticated action assertion does not exist'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_authenticated_action_identity';
END;
$$;

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


-- The isolated authentication gateway is the only principal allowed to turn
-- verified Clerk/session claims into the Twin-approval action assertion. The
-- ordinary API later passes only the assertion id to the typed consumer.
CREATE OR REPLACE FUNCTION "hr_issue_high_assurance_authenticated_action_assertion"(
  p_assertion_id uuid,
  p_action_kind text,
  p_action_parameters jsonb,
  p_authority_scope_epoch_id uuid,
  p_authenticated_actor_id uuid,
  p_authentication_source text,
  p_authentication_subject text,
  p_authentication_session_id text,
  p_authentication_audience text,
  p_authentication_session_issued_at timestamptz,
  p_authentication_session_expires_at timestamptz,
  p_membership_id uuid,
  p_workspace_id uuid
)
RETURNS "hr_authenticated_action_assertions"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  scope_row public."hr_scope_epochs"%ROWTYPE;
  live_user record;
  live_workspace record;
  live_membership record;
  action_id uuid := gen_random_uuid();
  action_at timestamptz;
  session_issued_at timestamptz := date_trunc(
    'milliseconds', p_authentication_session_issued_at
  );
  session_expires_at timestamptz := date_trunc(
    'milliseconds', p_authentication_session_expires_at
  );
  membership_updated_at timestamptz;
  membership_version_digest text;
  workspace_state text;
  issued_workspace_role text;
  issued_venue_role text;
  membership_body jsonb;
  action_parameters_digest text;
  authentication_session_sha256 text;
  authentication_subject_sha256 text;
  material_body jsonb;
  assertion_digest text;
  issued public."hr_authenticated_action_assertions"%ROWTYPE;
BEGIN
  IF NOT pg_has_role(
       session_user, 'omnitwin_historical_auth_gateway', 'MEMBER'
     )
     OR pg_has_role(session_user, 'omnitwin_api_activation', 'MEMBER')
     OR pg_has_role(
       session_user, 'omnitwin_historical_evidence_verifier', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_evidence_owner', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_schema_owner', 'MEMBER'
     ) THEN
    RAISE EXCEPTION 'high-assurance assertion requires an isolated gateway login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_high_assurance_action_gateway_isolation';
  END IF;
  IF p_action_kind <> 'twin_release_authority_approval' THEN
    RAISE EXCEPTION 'unsupported high-assurance action kind'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_kind';
  END IF;
  IF p_authentication_audience <>
       'venviewer_historical_runtime_evidence' THEN
    RAISE EXCEPTION 'high-assurance authenticated session audience is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_audience';
  END IF;
  IF length(p_authentication_subject) NOT BETWEEN 1 AND 255
     OR length(p_authentication_session_id) NOT BETWEEN 1 AND 512
     OR p_authentication_subject !~ '^[ -~]+$'
     OR p_authentication_session_id !~ '^[ -~]+$'
     OR session_issued_at IS NULL OR session_expires_at IS NULL
     OR session_issued_at >= session_expires_at THEN
    RAISE EXCEPTION 'high-assurance session identity is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_session';
  END IF;
  IF jsonb_typeof(p_action_parameters) <> 'object' THEN
    RAISE EXCEPTION 'high-assurance action parameters must be an object'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_parameters';
  END IF;
  IF (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
      FROM jsonb_object_keys(p_action_parameters) AS key_name)
       IS DISTINCT FROM ARRAY[
         'authorityId', 'envelopeReceiptId', 'expiresAt',
         'releaseAttestationId', 'releaseId', 'releaseReviewId',
         'sceneValidationId', 'signingKeyAuthorityId'
       ]::text[]
     OR (p_action_parameters->>'authorityId')::uuid IS NULL
     OR (p_action_parameters->>'envelopeReceiptId')::uuid IS NULL
     OR (p_action_parameters->>'releaseAttestationId')::uuid IS NULL
     OR (p_action_parameters->>'releaseId')::uuid IS NULL
     OR (p_action_parameters->>'releaseReviewId')::uuid IS NULL
     OR (p_action_parameters->>'sceneValidationId')::uuid IS NULL
     OR (p_action_parameters->>'signingKeyAuthorityId')::uuid IS NULL
     OR (p_action_parameters->>'expiresAt')::timestamptz IS NULL THEN
    RAISE EXCEPTION 'Twin-release approval parameters are not strict and canonical'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_twin_release_action_parameters';
  END IF;
  action_parameters_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-action-parameters.v1\n'
      || public."hr_stable_canonical_json"(p_action_parameters), 'UTF8'
  ), 'sha256'), 'hex');

  SELECT * INTO STRICT scope_row
  FROM public."hr_scope_epochs"
  WHERE "id" = p_authority_scope_epoch_id;
  PERFORM public."hr_lock_scope"(
    scope_row."environment_id", scope_row."venue_id", scope_row."space_id"
  );
  PERFORM public."hr_assert_scope_current"(
    scope_row."id", scope_row."environment_id", scope_row."environment_mode",
    scope_row."environment_digest", scope_row."venue_id",
    scope_row."space_id", public."hr_wall_clock_ms"()
  );
  SELECT * INTO STRICT scope_row
  FROM public."hr_scope_epochs"
  WHERE "id" = p_authority_scope_epoch_id
  FOR SHARE;
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_user
  FROM public."users"
  WHERE "id" = p_authenticated_actor_id
  FOR SHARE;

  IF p_authentication_source = 'local_test_fixture' THEN
    IF scope_row."environment_mode" <> 'test'
       OR p_authentication_subject <> p_authenticated_actor_id::text THEN
      RAISE EXCEPTION 'local high-assurance assertion identity is invalid'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_high_assurance_action_subject';
    END IF;
  ELSIF p_authentication_source <> 'clerk_session'
      OR live_user."clerk_id" IS NULL
      OR p_authentication_subject IS DISTINCT FROM live_user."clerk_id" THEN
    RAISE EXCEPTION 'high-assurance action requires the exact Clerk subject'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_high_assurance_action_subject';
  END IF;
  IF (p_membership_id IS NULL) <> (p_workspace_id IS NULL) THEN
    RAISE EXCEPTION 'high-assurance action membership is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_high_assurance_action_membership';
  END IF;
  IF p_membership_id IS NOT NULL THEN
    SELECT "primary_venue_id", "status", "deleted_at"
    INTO STRICT live_workspace
    FROM public."workspaces"
    WHERE "id" = p_workspace_id
    FOR SHARE;
    SELECT "user_id", "workspace_id", "role", "venue_role", "status",
      date_trunc('milliseconds', "updated_at") AS updated_at
    INTO STRICT live_membership
    FROM public."workspace_memberships"
    WHERE "id" = p_membership_id AND "workspace_id" = p_workspace_id
    FOR SHARE;
    IF live_membership."user_id" IS DISTINCT FROM p_authenticated_actor_id
       OR live_membership."status" <> 'active'
       OR live_workspace."primary_venue_id" IS DISTINCT FROM
          scope_row."venue_id"
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'high-assurance action membership is not current'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_high_assurance_action_membership';
    END IF;
    workspace_state := 'active';
    issued_workspace_role := live_membership."role";
    issued_venue_role := live_membership."venue_role";
    membership_updated_at := live_membership.updated_at;
    membership_body := jsonb_build_object(
      'membershipId', p_membership_id::text,
      'membershipStatus', 'active',
      'membershipUpdatedAt', public."hr_iso_utc_ms"(membership_updated_at),
      'userId', p_authenticated_actor_id::text,
      'venueRole', issued_venue_role,
      'workspaceId', p_workspace_id::text,
      'workspaceRole', issued_workspace_role
    );
    membership_version_digest := encode(digest(convert_to(
      E'venviewer.historical-runtime-membership-version.v1\n'
        || public."hr_stable_canonical_json"(membership_body), 'UTF8'
    ), 'sha256'), 'hex');
    membership_body := membership_body || jsonb_build_object(
      'membershipVersionDigest', membership_version_digest,
      'state', 'active'
    );
  ELSE
    IF live_user."platform_role" NOT IN ('operator', 'admin') THEN
      RAISE EXCEPTION 'non-platform high-assurance action needs membership'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_high_assurance_action_membership';
    END IF;
    workspace_state := 'not_applicable';
    membership_body := jsonb_build_object(
      'reason', 'platform_authority', 'state', 'not_applicable'
    );
  END IF;

  action_at := public."hr_db_clock_ms"();
  IF session_issued_at > action_at OR action_at >= session_expires_at THEN
    RAISE EXCEPTION 'high-assurance authenticated session is not current'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_high_assurance_action_session';
  END IF;
  authentication_session_sha256 := encode(digest(convert_to(
    E'venviewer.historical-runtime-authentication-session.v1\n'
      || p_authentication_session_id, 'UTF8'
  ), 'sha256'), 'hex');
  authentication_subject_sha256 := encode(digest(convert_to(
    E'venviewer.historical-runtime-authenticated-subject.v1\n'
      || p_authentication_subject, 'UTF8'
  ), 'sha256'), 'hex');
  material_body := jsonb_build_object(
    'actionId', action_id::text,
    'actionKind', p_action_kind,
    'actionParameters', p_action_parameters,
    'actionParametersDigest', action_parameters_digest,
    'actorId', p_authenticated_actor_id::text,
    'assertionId', p_assertion_id::text,
    'audience', 'historical_runtime_evidence',
    'authenticatedAt', public."hr_iso_utc_ms"(action_at),
    'authenticatedByDatabasePrincipal', session_user::text,
    'authenticationAudience', p_authentication_audience,
    'authenticationSessionExpiresAt',
      public."hr_iso_utc_ms"(session_expires_at),
    'authenticationSessionIssuedAt', public."hr_iso_utc_ms"(session_issued_at),
    'authenticationSessionSha256', authentication_session_sha256,
    'authenticationSource', p_authentication_source,
    'authenticationSubjectSha256', authentication_subject_sha256,
    'authorityScopeEpoch', jsonb_build_object(
      'epoch', scope_row."epoch",
      'epochDigest', scope_row."epoch_digest",
      'epochId', scope_row."id"::text,
      'expiresAt', public."hr_iso_utc_ms"(scope_row."expires_at")
    ),
    'environmentDigest', scope_row."environment_digest",
    'environmentId', scope_row."environment_id"::text,
    'environmentMode', scope_row."environment_mode",
    'expiresAt', public."hr_iso_utc_ms"(LEAST(
      action_at + interval '5 minutes', session_expires_at,
      scope_row."expires_at"
    )),
    'nonce', gen_random_uuid()::text,
    'platformRole', live_user."platform_role",
    'schemaVersion', 'historical-runtime-authenticated-action-assertion.v1',
    'spaceId', scope_row."space_id"::text,
    'tenantBoundary', 'venue_id_v1',
    'tenantId', scope_row."venue_id"::text,
    'userRole', live_user."role",
    'userVenueId', CASE WHEN live_user."venue_id" IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(live_user."venue_id"::text) END,
    'venueId', scope_row."venue_id"::text,
    'workspaceMembership', membership_body
  );
  assertion_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-authenticated-action-assertion.v1\n'
      || public."hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  INSERT INTO public."hr_authenticated_action_assertions" (
    "id", "audience", "action_kind", "action_id",
    "action_parameters_digest", "action_parameters_body", "environment_id",
    "environment_mode", "environment_digest", "authority_scope_epoch_id",
    "authority_scope_epoch", "authority_scope_epoch_digest",
    "authority_scope_epoch_expires_at", "venue_id", "space_id", "actor_id",
    "authentication_source", "authentication_audience",
    "authentication_session_sha256", "authentication_subject_sha256",
    "authentication_session_issued_at", "authentication_session_expires_at",
    "authenticated_by_database_principal", "platform_role", "user_role",
    "user_venue_id", "workspace_state", "membership_id", "workspace_id",
    "workspace_role", "venue_role", "membership_updated_at",
    "membership_version_digest", "authenticated_at", "expires_at", "nonce",
    "assertion_digest", "assertion_body", "created_at"
  ) VALUES (
    p_assertion_id, 'historical_runtime_evidence', p_action_kind, action_id,
    action_parameters_digest, p_action_parameters, scope_row."environment_id",
    scope_row."environment_mode", scope_row."environment_digest",
    scope_row."id", scope_row."epoch", scope_row."epoch_digest",
    scope_row."expires_at", scope_row."venue_id", scope_row."space_id",
    p_authenticated_actor_id, p_authentication_source,
    p_authentication_audience, authentication_session_sha256,
    authentication_subject_sha256, session_issued_at, session_expires_at,
    session_user::text, live_user."platform_role", live_user."role",
    live_user."venue_id", workspace_state, p_membership_id, p_workspace_id,
    issued_workspace_role, issued_venue_role, membership_updated_at,
    membership_version_digest, action_at,
    LEAST(action_at + interval '5 minutes', session_expires_at,
      scope_row."expires_at"),
    (material_body->>'nonce')::uuid, assertion_digest,
    material_body || jsonb_build_object('assertionDigest', assertion_digest),
    action_at
  ) RETURNING * INTO issued;
  RETURN issued;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'high-assurance action scope, actor, or membership is missing'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_high_assurance_action_identity';
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_scene_graph_complete"(
  p_scene_validation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  scene_subject "hr_scene_validation_subjects"%ROWTYPE;
  scene_receipt "hr_object_receipts"%ROWTYPE;
  verification_handle "hr_verified_scene_map_receipts"%ROWTYPE;
  verification_receipt "hr_scene_map_parser_receipts"%ROWTYPE;
  final_scene "hr_scene_validations"%ROWTYPE;
  whole_count bigint;
  whole_min integer;
  whole_max integer;
  member_count bigint;
  member_min integer;
  member_max integer;
  whole_regions jsonb;
  ordered_members jsonb;
  verification_receipt_members jsonb;
  room_scope_basis_body jsonb;
  coverage_body jsonb;
BEGIN
  PERFORM "hr_lock_authority"(
    'scene-validation', p_scene_validation_id::text
  );
  SELECT * INTO STRICT scene_subject
  FROM "hr_scene_validation_subjects"
  WHERE "id" = p_scene_validation_id
  FOR SHARE;
  SELECT * INTO STRICT scene_receipt
  FROM "hr_object_receipts"
  WHERE "id" = scene_subject."scene_object_receipt_id"
  FOR SHARE;
  SELECT * INTO STRICT verification_handle
  FROM "hr_verified_scene_map_receipts"
  WHERE "id" = scene_subject."scene_map_verification_receipt_id"
    AND "scene_validation_id" = scene_subject."id"
    AND "scene_map_verification_receipt_digest" =
      scene_subject."scene_map_verification_receipt_digest"
  FOR SHARE;
  SELECT * INTO STRICT verification_receipt
  FROM "hr_scene_map_parser_receipts"
  WHERE "id" = scene_subject."scene_map_parser_receipt_id"
    AND "id" = verification_handle."parser_receipt_id"
    AND "scene_validation_id" = scene_subject."id"
    AND "scene_map_verification_receipt_digest" =
      scene_subject."scene_map_parser_receipt_digest"
  FOR SHARE;

  IF jsonb_typeof(scene_subject."scene_parsed_map_body") <> 'object'
     OR jsonb_typeof(scene_subject."scene_parsed_map_body"->'regions') <>
        'array'
     OR (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
         FROM jsonb_object_keys(
           scene_subject."scene_parsed_map_body"
         ) AS key_name) IS DISTINCT FROM ARRAY[
           'generatedAt', 'id', 'regions', 'schemaVersion', 'venueSlug'
         ]::text[]
     OR jsonb_array_length(
       scene_subject."scene_parsed_map_body"->'regions'
     ) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Scene Authority Map has an invalid top-level shape'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_parsed_map_shape';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      scene_subject."scene_parsed_map_body"->'regions'
    ) AS parsed(region)
    WHERE jsonb_typeof(parsed.region) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Scene Authority Map contains a non-object region'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_parsed_map_region_shape';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      scene_subject."scene_parsed_map_body"->'regions'
    ) AS parsed(region)
    WHERE (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
           FROM jsonb_object_keys(parsed.region) AS key_name)
          IS DISTINCT FROM ARRAY[
            'authorities', 'confidenceTier', 'id', 'label',
            'provenanceRefs', 'reconstructionStrategy', 'scope',
            'transformArtifactRef', 'truthStatus'
          ]::text[]
      OR length(btrim(parsed.region->>'id')) NOT BETWEEN 1 AND 120
  ) OR (
    SELECT count(*) <> count(DISTINCT parsed.region->>'id')
    FROM jsonb_array_elements(
      scene_subject."scene_parsed_map_body"->'regions'
    ) AS parsed(region)
  ) THEN
    RAISE EXCEPTION 'Scene Authority Map region identities are not strict and unique'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_parsed_map_region_identity';
  END IF;

  SELECT count(*), min("whole_region_index"), max("whole_region_index"),
    jsonb_agg(to_jsonb("region_id") ORDER BY "whole_region_index")
  INTO whole_count, whole_min, whole_max, whole_regions
  FROM "hr_scene_whole_regions"
  WHERE "scene_validation_id" = p_scene_validation_id;
  IF whole_count <> scene_subject."whole_region_count"
     OR whole_min IS DISTINCT FROM 0
     OR whole_max IS DISTINCT FROM scene_subject."whole_region_count" - 1 THEN
    RAISE EXCEPTION 'Scene whole-region set is incomplete or non-dense'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_whole_regions_complete';
  END IF;

  SELECT count(*), min("member_index"), max("member_index")
  INTO member_count, member_min, member_max
  FROM "hr_scene_validation_members"
  WHERE "scene_validation_id" = p_scene_validation_id;
  IF member_count <> scene_subject."member_count"
     OR member_min IS DISTINCT FROM 0
     OR member_max IS DISTINCT FROM scene_subject."member_count" - 1 THEN
    RAISE EXCEPTION 'Scene member set is incomplete or non-dense'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_members_complete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "hr_scene_validation_members" AS member
    CROSS JOIN LATERAL (
      SELECT count(*) AS region_count,
        min(region."covered_region_index") AS min_index,
        max(region."covered_region_index") AS max_index,
        jsonb_agg(to_jsonb(region."region_id")
          ORDER BY region."covered_region_index") AS region_ids
      FROM "hr_scene_member_regions" AS region
      WHERE region."scene_validation_id" = member."scene_validation_id"
        AND region."member_index" = member."member_index"
    ) AS member_regions
    WHERE member."scene_validation_id" = p_scene_validation_id
      AND (
        member_regions.region_count <> member."covered_region_count"
        OR member_regions.min_index IS DISTINCT FROM 0
        OR member_regions.max_index IS DISTINCT FROM
          member."covered_region_count" - 1
        OR member."member_body" IS DISTINCT FROM jsonb_build_object(
          'assetVersionId', member."asset_version_id"::text,
          'authorityReference', member."authority_reference",
          'coveredRegionIds', member_regions.region_ids,
          'derivationOutputReceiptId',
            member."derivation_output_receipt_id"::text,
          'derivationMemberReceiptDigest',
            member."derivation_member_receipt_digest",
          'memberIndex', member."member_index"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Scene member coverage rows do not equal member body'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_member_regions_complete';
  END IF;

  IF whole_count <> jsonb_array_length(
       scene_subject."scene_parsed_map_body"->'regions'
     ) OR EXISTS (
    SELECT 1 FROM "hr_scene_whole_regions" AS whole
    WHERE whole."scene_validation_id" = p_scene_validation_id
      AND NOT EXISTS (
        SELECT 1 FROM "hr_scene_member_regions" AS covered
        WHERE covered."scene_validation_id" = p_scene_validation_id
          AND covered."region_id" = whole."region_id"
      )
  ) OR EXISTS (
    SELECT 1 FROM "hr_scene_whole_regions" AS whole
    WHERE whole."scene_validation_id" = p_scene_validation_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          scene_subject."scene_parsed_map_body"->'regions'
        ) AS parsed(region)
        WHERE parsed.region->>'id' = whole."region_id"
      )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      scene_subject."scene_parsed_map_body"->'regions'
    ) AS parsed(region)
    WHERE NOT EXISTS (
      SELECT 1 FROM "hr_scene_whole_regions" AS whole
      WHERE whole."scene_validation_id" = p_scene_validation_id
        AND whole."region_id" = parsed.region->>'id'
    )
  ) THEN
    RAISE EXCEPTION 'Scene whole-room coverage does not equal the parsed map'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_coverage_union';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'assetVersionId', member."asset_version_id"::text,
    'authorityReference', member."authority_reference",
    'coveredRegionIds', member_regions.region_ids,
    'derivationOutputReceiptId', member."derivation_output_receipt_id"::text,
    'derivationMemberReceiptDigest', member."derivation_member_receipt_digest",
    'memberIndex', member."member_index"
  ) ORDER BY member."member_index")
  INTO ordered_members
  FROM "hr_scene_validation_members" AS member
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(region."region_id")
      ORDER BY region."covered_region_index") AS region_ids
    FROM "hr_scene_member_regions" AS region
    WHERE region."scene_validation_id" = member."scene_validation_id"
      AND region."member_index" = member."member_index"
  ) AS member_regions
  WHERE member."scene_validation_id" = p_scene_validation_id;

  SELECT jsonb_agg(jsonb_build_object(
      'assetVersionId', member.value->>'assetVersionId',
      'authorityReference', member.value->>'authorityReference',
      'coveredRegionIds', member.value->'coveredRegionIds',
      'derivationOutputReceiptId',
        member.value->>'derivationOutputReceiptId',
      'derivationMemberReceiptDigest',
        member.value->>'derivationMemberReceiptDigest',
      'memberIndex', (member.value->>'memberIndex')::integer
    ) ORDER BY member.ordinal)
    INTO verification_receipt_members
    FROM jsonb_array_elements(verification_receipt."ordered_members")
      WITH ORDINALITY AS member(value, ordinal);

    IF scene_subject."scene_map_verification_receipt_body" IS DISTINCT FROM
         verification_handle."scene_map_verification_receipt_body"
       OR scene_subject."scene_map_verification_receipt_expires_at"
          IS DISTINCT FROM verification_handle."expires_at"
       OR scene_subject."scene_map_parser_receipt_expires_at"
          IS DISTINCT FROM verification_receipt."expires_at"
       OR scene_subject."scene_raw_bytes" IS DISTINCT FROM
          verification_receipt."scene_map_bytes"
       OR scene_subject."scene_parsed_map_body" IS DISTINCT FROM
          verification_receipt."scene_map_body"
       OR scene_subject."parsed_map_digest" IS DISTINCT FROM
          verification_receipt."parsed_map_digest"
       OR scene_subject."scene_object_receipt_id" IS DISTINCT FROM
          verification_receipt."scene_object_receipt_id"
       OR scene_subject."scene_object_receipt_digest" IS DISTINCT FROM
          verification_receipt."scene_object_receipt_digest"
       OR whole_regions IS DISTINCT FROM verification_receipt."whole_region_ids"
       OR ordered_members IS DISTINCT FROM verification_receipt_members THEN
      RAISE EXCEPTION 'Scene graph differs from its authenticated parser handle'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_verified_receipt_exact_graph';
  END IF;

  room_scope_basis_body := jsonb_build_object(
    'derivationEvidenceDigest', scene_subject."derivation_evidence_digest",
    'derivationId', scene_subject."derivation_id"::text,
    'presentationAdmissionDigest',
      scene_subject."presentation_admission_digest",
    'presentationAdmissionId',
      scene_subject."presentation_admission_id"::text,
    'runtimeManifestDigest', scene_subject."runtime_manifest_digest",
    'runtimePackageContentDigest',
      scene_subject."runtime_package_content_digest",
    'runtimePackageId', scene_subject."runtime_package_id"::text,
    'sceneArtifactDigest', scene_subject."scene_artifact_digest",
    'sceneArtifactRowId', scene_subject."scene_artifact_row_id"::text,
    'schemaVersion', 'historical-runtime-room-scope-basis.v1',
    'spaceId', scene_subject."space_id"::text,
    'transformReviewDigest', scene_subject."transform_review_digest",
    'transformReviewId', scene_subject."transform_review_id"::text,
    'twinReleaseId', scene_subject."twin_release_id"::text,
    'twinReleaseManifestDigest', scene_subject."twin_release_manifest_digest",
    'venueId', scene_subject."venue_id"::text
  );
  coverage_body := jsonb_build_object(
    'coverageDecision', scene_subject."coverage_decision",
    'derivationEvidenceDigest', scene_subject."derivation_evidence_digest",
    'derivationId', scene_subject."derivation_id"::text,
    'orderedMembers', ordered_members,
    'presentationAdmissionDigest',
      scene_subject."presentation_admission_digest",
    'presentationAdmissionId', scene_subject."presentation_admission_id"::text,
    'roomScopeBasis', room_scope_basis_body,
    'roomScopeBasisDigest', scene_subject."room_scope_basis_digest",
    'runtimeManifestDigest', scene_subject."runtime_manifest_digest",
    'runtimePackageContentDigest',
      scene_subject."runtime_package_content_digest",
    'runtimePackageId', scene_subject."runtime_package_id"::text,
    'spaceId', scene_subject."space_id"::text,
    'transformReviewDigest', scene_subject."transform_review_digest",
    'transformReviewId', scene_subject."transform_review_id"::text,
    'twinReleaseId', scene_subject."twin_release_id"::text,
    'twinReleaseManifestDigest', scene_subject."twin_release_manifest_digest",
    'venueId', scene_subject."venue_id"::text,
    'wholeVenueRegionIds', whole_regions
  );
  IF scene_subject."room_scope_basis_digest" IS DISTINCT FROM encode(digest(
       convert_to(
         E'venviewer.historical-runtime-room-scope-basis.v1\n'
           || "hr_stable_canonical_json"(room_scope_basis_body), 'UTF8'
       ), 'sha256'
     ), 'hex')
     OR scene_subject."subject_body"->'coverage' IS DISTINCT FROM coverage_body
     OR scene_subject."coverage_digest" IS DISTINCT FROM encode(digest(convert_to(
       E'venviewer.historical-runtime-scene-authority-coverage.v1\n'
         || "hr_stable_canonical_json"(coverage_body), 'UTF8'
     ), 'sha256'), 'hex')
     OR scene_subject."subject_body"->'sceneObjectReceipt' IS DISTINCT FROM
        scene_receipt."receipt_body"
     OR scene_subject."scene_validation_subject_digest" IS DISTINCT FROM
        encode(digest(convert_to(
          E'venviewer.historical-runtime-scene-authority-subject.v1\n'
            || "hr_stable_canonical_json"(
              scene_subject."subject_body" - 'sceneValidationSubjectDigest'
            ), 'UTF8'
        ), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'Scene subject body or canonical digest is substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_subject_exact_body';
  END IF;

  SELECT * INTO final_scene
  FROM "hr_scene_validations"
  WHERE "id" = p_scene_validation_id
  FOR SHARE;
  IF FOUND AND (
    final_scene."scene_validation_body"->'subject' IS DISTINCT FROM
      scene_subject."subject_body"
    OR final_scene."scene_validation_digest" IS DISTINCT FROM encode(digest(
      convert_to(
        E'venviewer.historical-runtime-scene-authority-receipt.v1\n'
          || "hr_stable_canonical_json"(
            final_scene."scene_validation_body" - 'sceneValidationDigest'
          ), 'UTF8'
      ), 'sha256'
    ), 'hex')
  ) THEN
    RAISE EXCEPTION 'Final Scene receipt does not equal its relational subject'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_final_exact_body';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_scene_graph_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_body jsonb := to_jsonb(NEW);
  scene_id uuid;
BEGIN
  scene_id := COALESCE(
    (row_body->>'scene_validation_id')::uuid,
    (row_body->>'id')::uuid
  );
  PERFORM "hr_assert_scene_graph_complete"(scene_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_scene_subject_graph_complete"
  AFTER INSERT ON "hr_scene_validation_subjects"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_scene_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_scene_whole_graph_complete"
  AFTER INSERT ON "hr_scene_whole_regions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_scene_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_scene_member_graph_complete"
  AFTER INSERT ON "hr_scene_validation_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_scene_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_scene_member_region_graph_complete"
  AFTER INSERT ON "hr_scene_member_regions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_scene_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_scene_final_graph_complete"
  AFTER INSERT ON "hr_scene_validations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_scene_graph_deferred_guard"();

-- The ordinary API can consume a gateway-issued twin approval only through
-- this one-handle entry point. The immutable assertion carries every target
-- id and expiry; the API cannot substitute any action parameters or actor.
CREATE OR REPLACE FUNCTION "hr_authorize_verified_twin_release_authority"(
  p_assertion_id uuid
)
RETURNS "hr_action_authority_snapshots"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public."hr_consume_high_assurance_action_authority"(
    p_assertion_id, 'twin_release_authority_approval',
    'twin_release_approver'
  );
END;
$$;

-- The verifier has already performed Ed25519 verification over the exact DSSE
-- PAE before this insert. This DB boundary independently rehydrates every
-- release/review/object/key/action identity, retains the exact envelope and
-- payload bytes, rejects stale/superseded authority, and derives all durable
-- bodies/digests/timestamps. A caller-computable signature shape is never
-- treated as verification proof outside the isolated verifier principal.
CREATE OR REPLACE FUNCTION "hr_issue_verified_twin_release_authority"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  requested_id uuid := NEW."id";
  requested_subject_id uuid := NEW."subject_id";
  requested_release_id uuid := NEW."release_id";
  requested_review_id uuid := NEW."release_review_id";
  requested_attestation_id uuid := NEW."release_attestation_id";
  requested_receipt_id uuid := NEW."envelope_receipt_id";
  requested_key_authority_id uuid := NEW."signing_key_authority_id";
  requested_action_snapshot_id uuid := NEW."approval_authority_snapshot_id";
  requested_envelope_bytes bytea := NEW."envelope_bytes";
  requested_expires_at timestamptz;
  subject_row public."hr_evidence_subjects"%ROWTYPE;
  scope_row public."hr_scope_epochs"%ROWTYPE;
  venue_row public."venues"%ROWTYPE;
  space_row public."spaces"%ROWTYPE;
  release_row public."reconstruction_releases"%ROWTYPE;
  review_row public."reconstruction_release_reviews"%ROWTYPE;
  latest_review public."reconstruction_release_reviews"%ROWTYPE;
  attestation_row public."reconstruction_release_attestations"%ROWTYPE;
  receipt_row public."hr_object_receipts"%ROWTYPE;
  key_row public."hr_signing_key_authorities"%ROWTYPE;
  action_row public."hr_action_authority_snapshots"%ROWTYPE;
  assertion_row public."hr_authenticated_action_assertions"%ROWTYPE;
  approval_actor public."users"%ROWTYPE;
  action_parameters jsonb;
  action_at timestamptz;
  wall_now timestamptz;
  verification_material jsonb;
  authority_material jsonb;
BEGIN
  IF NOT pg_has_role(
       session_user, 'omnitwin_historical_evidence_verifier', 'MEMBER'
     )
     OR pg_has_role(session_user, 'omnitwin_api_activation', 'MEMBER')
     OR pg_has_role(
       session_user, 'omnitwin_historical_auth_gateway', 'MEMBER'
     )
     OR pg_has_role(
       session_user, 'omnitwin_historical_evidence_owner', 'MEMBER'
     ) THEN
    RAISE EXCEPTION 'verified twin authority requires isolated verifier login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_verified_twin_verifier_isolation';
  END IF;
  IF requested_envelope_bytes IS NULL
     OR octet_length(requested_envelope_bytes) NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION 'verified twin envelope bytes are missing or oversized'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_verified_twin_envelope_bytes';
  END IF;

  SELECT * INTO STRICT subject_row
  FROM public."hr_evidence_subjects"
  WHERE "id" = requested_subject_id
    AND "subject_kind" = 'scene_validation';
  PERFORM public."hr_lock_scope"(
    subject_row."environment_id", subject_row."venue_id",
    subject_row."space_id"
  );
  PERFORM public."hr_lock_authority"(
    'evidence-record', requested_id::text
  );
  PERFORM public."hr_lock_authority"(
    'reconstruction-release', requested_release_id::text
  );
  PERFORM public."hr_assert_scope_current"(
    subject_row."scope_epoch_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id",
    public."hr_wall_clock_ms"()
  );
  SELECT * INTO STRICT scope_row
  FROM public."hr_scope_epochs"
  WHERE "id" = subject_row."scope_epoch_id"
  FOR SHARE;
  SELECT * INTO STRICT venue_row
  FROM public."venues"
  WHERE "id" = subject_row."venue_id"
  FOR SHARE;
  SELECT * INTO STRICT space_row
  FROM public."spaces"
  WHERE "id" = subject_row."space_id"
    AND "venue_id" = subject_row."venue_id"
  FOR SHARE;
  SELECT * INTO STRICT release_row
  FROM public."reconstruction_releases"
  WHERE "id" = requested_release_id
    AND "venue_slug" = venue_row."slug"
    AND "release_kind" = 'venue_twin_v1'
  FOR SHARE;
  SELECT * INTO STRICT review_row
  FROM public."reconstruction_release_reviews"
  WHERE "id" = requested_review_id
    AND "release_id" = release_row."id"
  FOR SHARE;
  SELECT * INTO STRICT latest_review
  FROM public."reconstruction_release_reviews"
  WHERE "release_id" = release_row."id"
  ORDER BY "review_sequence" DESC
  LIMIT 1
  FOR SHARE;
  IF latest_review."id" IS DISTINCT FROM review_row."id"
     OR latest_review."request_digest" IS DISTINCT FROM
        review_row."request_digest"
     OR latest_review."decision" <> 'approved'
     OR latest_review."target_exposure" <> 'public'
     OR latest_review."reviewer_authority" <> 'platform_admin'
     OR jsonb_array_length(latest_review."visual_evidence") = 0
     OR jsonb_array_length(latest_review."transform_artifact_refs") <> 1
     OR jsonb_array_length(latest_review."scene_authority_refs") <> 1 THEN
    RAISE EXCEPTION 'twin release review is not the latest public approval'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_latest_review';
  END IF;
  SELECT * INTO STRICT attestation_row
  FROM public."reconstruction_release_attestations"
  WHERE "id" = requested_attestation_id
    AND "release_id" = release_row."id"
    AND "review_id" = review_row."id"
    AND "review_digest" = review_row."request_digest"
  FOR SHARE;

  PERFORM public."hr_assert_object_receipt_current"(
    requested_receipt_id, subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id",
    public."hr_wall_clock_ms"()
  );
  SELECT * INTO STRICT receipt_row
  FROM public."hr_object_receipts"
  WHERE "id" = requested_receipt_id
    AND "receipt_role" = 'evidence_document'
  FOR SHARE;
  PERFORM public."hr_assert_signing_key_current"(
    requested_key_authority_id, subject_row."scope_epoch_id",
    subject_row."environment_id", subject_row."environment_mode",
    subject_row."environment_digest", subject_row."venue_id",
    subject_row."space_id",
    'historical_runtime_twin_release_attestation',
    public."hr_wall_clock_ms"()
  );
  SELECT * INTO STRICT key_row
  FROM public."hr_signing_key_authorities"
  WHERE "id" = requested_key_authority_id
  FOR SHARE;
  SELECT * INTO STRICT action_row
  FROM public."hr_action_authority_snapshots"
  WHERE "id" = requested_action_snapshot_id
    AND "action_kind" = 'twin_release_authority_approval'
    AND "authority_role" = 'twin_release_approver'
  FOR SHARE;
  SELECT * INTO STRICT assertion_row
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = action_row."authentication_assertion_id"
  FOR SHARE;
  SELECT * INTO STRICT approval_actor
  FROM public."users"
  WHERE "id" = action_row."actor_id"
  FOR SHARE;
  action_parameters := assertion_row."action_parameters_body";
  requested_expires_at := date_trunc(
    'milliseconds', (action_parameters->>'expiresAt')::timestamptz
  );
  wall_now := public."hr_wall_clock_ms"();
  IF subject_row."environment_mode" <> 'production'
     OR action_row."environment_id" IS DISTINCT FROM subject_row."environment_id"
     OR action_row."environment_mode" IS DISTINCT FROM
        subject_row."environment_mode"
     OR action_row."environment_digest" IS DISTINCT FROM
        subject_row."environment_digest"
     OR action_row."authority_scope_epoch_id" IS DISTINCT FROM
        subject_row."scope_epoch_id"
     OR action_row."venue_id" IS DISTINCT FROM subject_row."venue_id"
     OR action_row."space_id" IS DISTINCT FROM subject_row."space_id"
     OR action_row."action_parameters_digest" IS DISTINCT FROM
        assertion_row."action_parameters_digest"
     OR action_row."expires_at" <= wall_now
     OR approval_actor."platform_role" <> 'admin'
     OR (action_parameters->>'authorityId')::uuid IS DISTINCT FROM requested_id
     OR (action_parameters->>'sceneValidationId')::uuid IS DISTINCT FROM
        requested_subject_id
     OR (action_parameters->>'releaseId')::uuid IS DISTINCT FROM
        requested_release_id
     OR (action_parameters->>'releaseReviewId')::uuid IS DISTINCT FROM
        requested_review_id
     OR (action_parameters->>'releaseAttestationId')::uuid IS DISTINCT FROM
        requested_attestation_id
     OR (action_parameters->>'envelopeReceiptId')::uuid IS DISTINCT FROM
        requested_receipt_id
     OR (action_parameters->>'signingKeyAuthorityId')::uuid IS DISTINCT FROM
        requested_key_authority_id
     OR requested_expires_at <= wall_now THEN
    RAISE EXCEPTION 'twin release approval action is stale or substituted'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_approval_current';
  END IF;

  NEW."envelope_body" := convert_from(requested_envelope_bytes, 'UTF8')::jsonb;
  IF NEW."envelope_body"->>'payloadType' <> 'application/vnd.in-toto+json'
     OR jsonb_typeof(NEW."envelope_body"->'signatures') <> 'array'
     OR jsonb_array_length(NEW."envelope_body"->'signatures') <> 1 THEN
    RAISE EXCEPTION 'twin release DSSE envelope shape is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_verified_twin_envelope_shape';
  END IF;
  NEW."payload_bytes" := decode(NEW."envelope_body"->>'payload', 'base64');
  NEW."statement_body" := convert_from(NEW."payload_bytes", 'UTF8')::jsonb;
  NEW."envelope_bytes" := requested_envelope_bytes;
  NEW."envelope_sha256" := encode(
    digest(NEW."envelope_bytes", 'sha256'), 'hex'
  );
  NEW."envelope_byte_length" := octet_length(NEW."envelope_bytes");
  NEW."payload_type" := 'application/vnd.in-toto+json';
  NEW."payload_sha256" := encode(digest(NEW."payload_bytes", 'sha256'), 'hex');
  NEW."payload_byte_length" := octet_length(NEW."payload_bytes");
  IF NEW."envelope_sha256" IS DISTINCT FROM receipt_row."sha256"
     OR NEW."envelope_byte_length" IS DISTINCT FROM receipt_row."size_bytes"
     OR NEW."envelope_sha256" IS DISTINCT FROM attestation_row."envelope_sha256"
     OR NEW."payload_sha256" IS DISTINCT FROM attestation_row."statement_sha256"
     OR NEW."envelope_body"->'signatures'->0->>'keyid' IS DISTINCT FROM
        key_row."key_id"
     OR attestation_row."key_id" IS DISTINCT FROM key_row."key_id"
     OR attestation_row."public_key_fingerprint" IS DISTINCT FROM
        key_row."public_key_fingerprint"
     OR encode(digest(convert_to(
       attestation_row."r2_key", 'UTF8'
     ), 'sha256'), 'hex') IS DISTINCT FROM receipt_row."storage_key_sha256" THEN
    RAISE EXCEPTION 'raw twin envelope, receipt, key, or legacy metadata differ'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_verified_twin_raw_identity';
  END IF;

  -- Recheck currentness at wall time after every potentially blocking lock,
  -- then sample exactly one canonical action instant.
  PERFORM public."hr_assert_object_receipt_current"(
    receipt_row."id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", wall_now
  );
  PERFORM public."hr_assert_signing_key_current"(
    key_row."id", subject_row."scope_epoch_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id",
    'historical_runtime_twin_release_attestation', wall_now
  );
  action_at := public."hr_db_clock_ms"();
  IF action_at >= receipt_row."denial_expires_at"
     OR action_at >= key_row."expires_at"
     OR action_at >= scope_row."expires_at"
     OR action_at >= action_row."expires_at" THEN
    RAISE EXCEPTION 'twin release authority expired while locking'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_current';
  END IF;
  IF action_row."actor_id" IN (
       release_row."created_by", review_row."reviewer_user_id",
       attestation_row."verified_by"
     )
     OR release_row."created_by" = review_row."reviewer_user_id"
     OR release_row."created_by" = attestation_row."verified_by"
     OR review_row."reviewer_user_id" = attestation_row."verified_by" THEN
    RAISE EXCEPTION 'twin release ceremonies are not actor-separated'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_verified_twin_actor_separation';
  END IF;

  NEW."subject_id" := subject_row."id";
  NEW."environment_id" := subject_row."environment_id";
  NEW."environment_mode" := subject_row."environment_mode";
  NEW."environment_digest" := subject_row."environment_digest";
  NEW."scope_epoch_id" := subject_row."scope_epoch_id";
  NEW."scope_epoch" := scope_row."epoch";
  NEW."scope_epoch_digest" := scope_row."epoch_digest";
  NEW."scope_epoch_expires_at" := scope_row."expires_at";
  NEW."venue_id" := subject_row."venue_id";
  NEW."venue_slug" := venue_row."slug";
  NEW."space_id" := subject_row."space_id";
  NEW."space_slug" := space_row."slug";
  NEW."release_id" := release_row."id";
  NEW."release_kind" := release_row."release_kind";
  NEW."release_digest" := release_row."release_digest";
  NEW."source_manifest_sha256" := release_row."source_manifest_sha256";
  NEW."release_manifest_sha256" := release_row."release_manifest_sha256";
  NEW."release_created_by" := release_row."created_by";
  NEW."release_created_at" := release_row."created_at";
  NEW."release_review_id" := review_row."id";
  NEW."release_qa_report_digest" := review_row."qa_report_digest";
  NEW."release_review_digest" := review_row."request_digest";
  NEW."release_reviewer_actor_id" := review_row."reviewer_user_id";
  NEW."release_reviewer_authority" := review_row."reviewer_authority";
  NEW."release_review_decision" := review_row."decision";
  NEW."release_target_exposure" := review_row."target_exposure";
  NEW."release_visual_evidence" := review_row."visual_evidence";
  NEW."release_transform_artifact_refs" := review_row."transform_artifact_refs";
  NEW."release_scene_authority_refs" := review_row."scene_authority_refs";
  NEW."release_review_sequence" := review_row."review_sequence";
  NEW."release_supersedes_review_id" := review_row."supersedes_review_id";
  NEW."release_reviewed_at" := review_row."reviewed_at";
  NEW."release_attestation_id" := attestation_row."id";
  NEW."release_attestation_type" := attestation_row."attestation_type";
  NEW."legacy_key_id" := attestation_row."key_id";
  NEW."legacy_public_key_fingerprint" :=
    attestation_row."public_key_fingerprint";
  NEW."legacy_statement_sha256" := attestation_row."statement_sha256";
  NEW."legacy_attestation_envelope_sha256" :=
    attestation_row."envelope_sha256";
  NEW."legacy_attestation_r2_key" := attestation_row."r2_key";
  NEW."legacy_attestation_request_digest" := attestation_row."request_digest";
  NEW."legacy_attestation_verified_by" := attestation_row."verified_by";
  NEW."legacy_attestation_verified_at" := attestation_row."verified_at";
  NEW."envelope_receipt_id" := receipt_row."id";
  NEW."envelope_receipt_digest" := receipt_row."receipt_digest";
  NEW."envelope_capability_id" := receipt_row."capability_id";
  NEW."envelope_capability_digest" := receipt_row."capability_digest";
  NEW."envelope_provider_profile" := receipt_row."provider_profile";
  NEW."envelope_provider_kind" := receipt_row."provider_kind";
  NEW."envelope_provider_account_sha256" :=
    receipt_row."provider_account_sha256";
  NEW."envelope_endpoint_authority_sha256" :=
    receipt_row."endpoint_authority_sha256";
  NEW."envelope_private_bucket_sha256" :=
    receipt_row."private_bucket_sha256";
  NEW."envelope_storage_key_sha256" := receipt_row."storage_key_sha256";
  NEW."envelope_version_kind" := receipt_row."version_kind";
  NEW."envelope_storage_version" := receipt_row."storage_version";
  NEW."envelope_storage_etag" := receipt_row."storage_etag";
  NEW."envelope_file_name" := receipt_row."file_name";
  NEW."envelope_mime_type" := receipt_row."mime_type";
  NEW."envelope_receipt_expires_at" := receipt_row."denial_expires_at";
  NEW."envelope_receipt_body" := receipt_row."receipt_body";
  NEW."signing_key_authority_id" := key_row."id";
  NEW."key_policy_id" := key_row."key_policy_id";
  NEW."key_policy_digest" := key_row."key_policy_digest";
  NEW."key_id" := key_row."key_id";
  NEW."public_key_fingerprint" := key_row."public_key_fingerprint";
  NEW."key_effective_at" := key_row."policy_effective_at";
  NEW."key_expires_at" := key_row."expires_at";
  NEW."verification_boundary" := 'ed25519_dsse_verified_by_service_v1';
  -- The accountable LOGIN is proven by the isolation predicate above. The
  -- durable receipt names the NOLOGIN capability which authorized the write;
  -- SET ROLE deliberately does not change session_user.
  NEW."verified_by_database_principal" :=
    'omnitwin_historical_evidence_verifier';
  NEW."approval_authority_snapshot_id" := action_row."id";
  NEW."approval_action_id" := action_row."action_id";
  NEW."approval_action_parameters_digest" :=
    action_row."action_parameters_digest";
  NEW."approval_actor_id" := action_row."actor_id";
  NEW."approval_authority_digest" := action_row."authority_digest";
  NEW."approval_snapshotted_at" := action_row."snapshotted_at";
  NEW."approval_authority_expires_at" := action_row."expires_at";
  NEW."approved_at" := action_at;
  NEW."created_at" := action_at;
  NEW."approval_requested_expires_at" := requested_expires_at;
  NEW."expires_at" := LEAST(
    requested_expires_at, action_at + interval '30 days', scope_row."expires_at",
    receipt_row."denial_expires_at", key_row."expires_at"
  );
  verification_material := jsonb_build_object(
    'envelopeSha256', NEW."envelope_sha256",
    'keyId', NEW."key_id",
    'payloadSha256', NEW."payload_sha256",
    'publicKeyFingerprint', NEW."public_key_fingerprint",
    'schemaVersion',
      'historical-runtime-twin-release-verification-receipt.v1',
    'signingKeyAuthorityId', NEW."signing_key_authority_id"::text,
    'verificationBoundary', NEW."verification_boundary",
    'verifiedAt', public."hr_iso_utc_ms"(action_at),
    'verifiedByDatabasePrincipal', NEW."verified_by_database_principal"
  );
  NEW."verification_receipt_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-twin-release-verification-receipt.v1\n'
      || public."hr_stable_canonical_json"(verification_material), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."verification_receipt_body" := verification_material ||
    jsonb_build_object(
      'verificationReceiptDigest', NEW."verification_receipt_digest"
    );
  authority_material := jsonb_build_object(
    'approvalAuthority', jsonb_build_object(
      'actionAuthoritySnapshotId', action_row."id"::text,
      'actionKind', 'twin_release_authority_approval',
      'actionId', action_row."action_id"::text,
      'actionParametersDigest', action_row."action_parameters_digest",
      'actorId', action_row."actor_id"::text,
      'authorityRole', 'twin_release_approver',
      'authorityDigest', action_row."authority_digest",
      'expiresAt', public."hr_iso_utc_ms"(action_row."expires_at"),
      'snapshottedAt', public."hr_iso_utc_ms"(action_row."snapshotted_at")
    ),
    'approvedAt', public."hr_iso_utc_ms"(action_at),
    'authorityId', NEW."id"::text,
    'envelope', NEW."envelope_body",
    'envelopeByteLength', NEW."envelope_byte_length"::text,
    'envelopeObjectReceipt', receipt_row."receipt_body",
    'envelopeSha256', NEW."envelope_sha256",
    'envelopeUtf8', convert_from(NEW."envelope_bytes", 'UTF8'),
    'expiresAt', public."hr_iso_utc_ms"(NEW."expires_at"),
    'keyExpiresAt', public."hr_iso_utc_ms"(NEW."key_expires_at"),
    'keyId', NEW."key_id",
    'keyPolicyDigest', NEW."key_policy_digest",
    'keyPolicyId', NEW."key_policy_id"::text,
    'keyPurpose', 'historical_runtime_twin_release_attestation',
    'legacyAttestationEnvelopeSha256',
      NEW."legacy_attestation_envelope_sha256",
    'legacyAttestationObjectKeySha256', NEW."envelope_storage_key_sha256",
    'legacyAttestationVerifiedAt',
      public."hr_iso_utc_ms"(NEW."legacy_attestation_verified_at"),
    'legacyAttestationVerifiedBy', NEW."legacy_attestation_verified_by"::text,
    'payloadByteLength', NEW."payload_byte_length"::text,
    'payloadSha256', NEW."payload_sha256",
    'payloadType', NEW."payload_type",
    'payloadUtf8', convert_from(NEW."payload_bytes", 'UTF8'),
    'publicKeyFingerprint', NEW."public_key_fingerprint",
    'releaseAttestationId', NEW."release_attestation_id"::text,
    'releaseCreatedAt', public."hr_iso_utc_ms"(NEW."release_created_at"),
    'releaseCreatedBy', NEW."release_created_by"::text,
    'releaseDigest', NEW."release_digest",
    'releaseId', NEW."release_id"::text,
    'releaseKind', NEW."release_kind",
    'releaseManifestSha256', NEW."release_manifest_sha256",
    'releaseQaReportDigest', NEW."release_qa_report_digest",
    'releaseReviewDecision', NEW."release_review_decision",
    'releaseReviewDigest', NEW."release_review_digest",
    'releaseReviewId', NEW."release_review_id"::text,
    'releaseReviewSequence', NEW."release_review_sequence",
    'releaseReviewedAt', public."hr_iso_utc_ms"(NEW."release_reviewed_at"),
    'releaseReviewerActorId', NEW."release_reviewer_actor_id"::text,
    'releaseReviewerAuthority', NEW."release_reviewer_authority",
    'releaseSupersedesReviewId', CASE
      WHEN NEW."release_supersedes_review_id" IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(NEW."release_supersedes_review_id"::text)
    END,
    'releaseTargetExposure', NEW."release_target_exposure",
    'sceneValidationId', NEW."subject_id"::text,
    'schemaVersion', 'historical-runtime-verified-twin-release-authority.v1',
    'signingKeyAuthorityId', NEW."signing_key_authority_id"::text,
    'sourceManifestSha256', NEW."source_manifest_sha256",
    'spaceId', NEW."space_id"::text,
    'spaceSlug', NEW."space_slug",
    'statement', NEW."statement_body",
    'venueId', NEW."venue_id"::text,
    'venueSlug', NEW."venue_slug",
    'verificationReceipt', NEW."verification_receipt_body"
  );
  NEW."twin_release_authority_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-verified-twin-release-authority.v1\n'
      || public."hr_stable_canonical_json"(authority_material), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."twin_release_authority_body" := authority_material ||
    jsonb_build_object(
      'twinReleaseAuthorityDigest', NEW."twin_release_authority_digest"
    );
  PERFORM public."hr_insert_evidence_record"(
    NEW."id", 'twin_release_authority', NEW."subject_id", 'scene_validation',
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."twin_release_authority_digest", action_at, NEW."expires_at", action_at
  );
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'verified twin release input identity does not exist'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_verified_twin_identity';
END;
$$;

CREATE TRIGGER "b_hr_issue_verified_twin_release_authority"
  BEFORE INSERT ON "hr_verified_twin_release_authorities"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_verified_twin_release_authority"();

CREATE OR REPLACE FUNCTION "hr_assert_verified_twin_release_current"(
  p_authority_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  twin_row public."hr_verified_twin_release_authorities"%ROWTYPE;
  latest_review public."reconstruction_release_reviews"%ROWTYPE;
  action_row public."hr_action_authority_snapshots"%ROWTYPE;
  assertion_row public."hr_authenticated_action_assertions"%ROWTYPE;
  approval_actor public."users"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_assert_evidence_record_current"(
    p_authority_id, 'twin_release_authority', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    p_action_at
  );
  SELECT * INTO STRICT twin_row
  FROM public."hr_verified_twin_release_authorities"
  WHERE "id" = p_authority_id
  FOR SHARE;
  IF p_environment_mode <> 'production'
     OR twin_row."environment_mode" <> 'production' THEN
    RAISE EXCEPTION 'verified twin release authority is production-only'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_environment';
  END IF;
  PERFORM public."hr_lock_authority"(
    'reconstruction-release', twin_row."release_id"::text
  );
  SELECT * INTO STRICT latest_review
  FROM public."reconstruction_release_reviews"
  WHERE "release_id" = twin_row."release_id"
  ORDER BY "review_sequence" DESC
  LIMIT 1
  FOR SHARE;
  IF latest_review."id" IS DISTINCT FROM twin_row."release_review_id"
     OR latest_review."request_digest" IS DISTINCT FROM
        twin_row."release_review_digest"
     OR latest_review."review_sequence" IS DISTINCT FROM
        twin_row."release_review_sequence"
     OR latest_review."reviewer_user_id" IS DISTINCT FROM
        twin_row."release_reviewer_actor_id"
     OR latest_review."decision" <> 'approved'
     OR latest_review."target_exposure" <> 'public' THEN
    RAISE EXCEPTION 'verified twin release approval was superseded'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_latest_review';
  END IF;
  PERFORM public."hr_assert_object_receipt_current"(
    twin_row."envelope_receipt_id", twin_row."environment_id",
    twin_row."environment_mode", twin_row."environment_digest",
    twin_row."venue_id", twin_row."space_id", p_action_at
  );
  PERFORM public."hr_assert_signing_key_current"(
    twin_row."signing_key_authority_id", twin_row."scope_epoch_id",
    twin_row."environment_id", twin_row."environment_mode",
    twin_row."environment_digest", twin_row."venue_id", twin_row."space_id",
    'historical_runtime_twin_release_attestation', p_action_at
  );
  SELECT * INTO STRICT action_row
  FROM public."hr_action_authority_snapshots"
  WHERE "id" = twin_row."approval_authority_snapshot_id"
  FOR SHARE;
  SELECT * INTO STRICT assertion_row
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = action_row."authentication_assertion_id"
  FOR SHARE;
  SELECT * INTO STRICT approval_actor
  FROM public."users"
  WHERE "id" = twin_row."approval_actor_id"
  FOR SHARE;
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  IF twin_row."expires_at" <= wall_now
     OR action_row."action_kind" <> 'twin_release_authority_approval'
     OR action_row."authority_role" <> 'twin_release_approver'
     OR action_row."authority_digest" IS DISTINCT FROM
        twin_row."approval_authority_digest"
     OR assertion_row."action_parameters_digest" IS DISTINCT FROM
        twin_row."approval_action_parameters_digest"
     OR (assertion_row."action_parameters_body"->>'authorityId')::uuid
        IS DISTINCT FROM twin_row."id"
     OR approval_actor."platform_role" <> 'admin' THEN
    RAISE EXCEPTION 'verified twin release authority is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_verified_twin_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_twin_release_authority_current"(
  p_authority_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_environment_mode = 'test' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."hr_twin_release_authorities"
      WHERE "id" = p_authority_id AND "environment_mode" = 'test'
    ) THEN
      RAISE EXCEPTION 'test Scene requires the test-only twin wrapper'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_twin_release_environment_dispatch';
    END IF;
    PERFORM public."hr_assert_test_twin_release_current"(
      p_authority_id, p_environment_id, p_environment_mode,
      p_environment_digest, p_venue_id, p_space_id, p_action_at
    );
  ELSIF p_environment_mode = 'production' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."hr_verified_twin_release_authorities"
      WHERE "id" = p_authority_id AND "environment_mode" = 'production'
    ) THEN
      RAISE EXCEPTION 'production Scene requires a verified twin authority'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_twin_release_environment_dispatch';
    END IF;
    PERFORM public."hr_assert_verified_twin_release_current"(
      p_authority_id, p_environment_id, p_environment_mode,
      p_environment_digest, p_venue_id, p_space_id, p_action_at
    );
  ELSE
    RAISE EXCEPTION 'unsupported evidence environment mode'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_twin_release_environment_dispatch';
  END IF;
END;
$$;

-- A generic evidence-record lease is not enough for a transform review: the
-- reviewer's action-time authority is part of the durable review. Acquire the
-- exact record and role locks, then repeat both checks at a fresh wall instant
-- so a blocking wait cannot preserve stale reviewer authority.
CREATE OR REPLACE FUNCTION "hr_assert_transform_review_current"(
  p_transform_review_id uuid,
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
  review_row public."hr_transform_reviews"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'evidence-record', p_transform_review_id::text
  );
  PERFORM public."hr_assert_evidence_record_current"(
    p_transform_review_id, 'transform_review', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    p_action_at
  );
  SELECT * INTO STRICT review_row
  FROM public."hr_transform_reviews"
  WHERE "id" = p_transform_review_id
    AND "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  PERFORM public."hr_assert_role_attestation_current"(
    review_row."reviewer_attestation_id", p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    p_action_at
  );

  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  PERFORM public."hr_assert_evidence_record_current"(
    p_transform_review_id, 'transform_review', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  PERFORM public."hr_assert_role_attestation_current"(
    review_row."reviewer_attestation_id", p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  IF review_row."reviewed_at" > wall_now
     OR review_row."expires_at" <= wall_now
     OR review_row."expires_at" > review_row."reviewer_expires_at" THEN
    RAISE EXCEPTION 'historical-runtime transform review is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_transform_review_current';
  END IF;
  RETURN review_row."expires_at";
END;
$$;

-- Admission-review authority binds both the admission digest and the exact
-- admission UUID inside the signed evidence. The core role graph intentionally
-- permits a different role subject, so this lineage-specific tuple check lives
-- at each Scene/profile consumer rather than changing 0065 semantics.
CREATE OR REPLACE FUNCTION
"hr_assert_presentation_admission_reviewer_current"(
  p_attestation_id uuid,
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
  IF admission_row."decision" <> 'approved'
     OR role_row."role" <> 'admission_reviewer'
     OR role_row."bound_kind" <> 'presentation_admission'
     OR role_row."bound_digest" IS DISTINCT FROM admission_row."admission_digest"
     OR role_row."attestation_body"->'subject'->'evidence'->>'schemaVersion'
        IS DISTINCT FROM
        'historical-runtime-role-admission-review.v1'
     OR role_row."attestation_body"->'subject'->'evidence'->>'decision'
        IS DISTINCT FROM 'approved'
     OR role_row."attestation_body"->'subject'->'evidence'
        ->>'presentationAdmissionDigest'
        IS DISTINCT FROM admission_row."admission_digest"
     OR (
       role_row."attestation_body"->'subject'->'evidence'
         ->>'presentationAdmissionId'
     )::uuid
        IS DISTINCT FROM admission_row."id"
     OR role_row."effective_at" > wall_now
     OR role_row."expires_at" <= wall_now THEN
    RAISE EXCEPTION 'presentation admission reviewer does not bind the exact admission'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_admission_reviewer_exact';
  END IF;
  RETURN role_row."expires_at";
END;
$$;

-- Admission members remain a legacy mutable insert surface until a planning
-- snapshot or verified Scene receipt seals them. Protect the exact admission
-- identity with the private authority-lock row, and prove a dense,
-- bidirectional byte/storage intersection with the immutable derivation.
CREATE OR REPLACE FUNCTION
"hr_assert_runtime_presentation_admission_members_exact"(
  p_admission_id uuid,
  p_derivation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  admission_row public."runtime_presentation_admissions"%ROWTYPE;
  derivation_row public."hr_derivations"%ROWTYPE;
  admission_count bigint;
  admission_distinct_count bigint;
  admission_min integer;
  admission_max integer;
  derivation_count bigint;
  derivation_distinct_count bigint;
  derivation_min integer;
  derivation_max integer;
BEGIN
  PERFORM public."hr_lock_authority"(
    'runtime-presentation-admission', p_admission_id::text
  );
  SELECT * INTO STRICT admission_row
  FROM public."runtime_presentation_admissions"
  WHERE "id" = p_admission_id
  FOR SHARE;
  SELECT * INTO STRICT derivation_row
  FROM public."hr_derivations"
  WHERE "id" = p_derivation_id
  FOR SHARE;

  SELECT count(*), count(DISTINCT member."member_index"),
    min(member."member_index"), max(member."member_index")
  INTO admission_count, admission_distinct_count,
    admission_min, admission_max
  FROM public."runtime_presentation_admission_members" AS member
  WHERE member."admission_id" = admission_row."id";
  SELECT count(*), count(DISTINCT member."member_index"),
    min(member."member_index"), max(member."member_index")
  INTO derivation_count, derivation_distinct_count,
    derivation_min, derivation_max
  FROM public."hr_derivation_members" AS member
  WHERE member."derivation_id" = derivation_row."id";

  IF admission_row."decision" <> 'approved'
     OR admission_row."member_count" IS DISTINCT FROM
        derivation_row."member_count"
     OR admission_count IS DISTINCT FROM admission_row."member_count"::bigint
     OR admission_distinct_count IS DISTINCT FROM admission_count
     OR admission_min IS DISTINCT FROM 0
     OR admission_max IS DISTINCT FROM admission_row."member_count" - 1
     OR derivation_count IS DISTINCT FROM derivation_row."member_count"::bigint
     OR derivation_distinct_count IS DISTINCT FROM derivation_count
     OR derivation_min IS DISTINCT FROM 0
     OR derivation_max IS DISTINCT FROM derivation_row."member_count" - 1
     OR EXISTS (
       SELECT 1
       FROM public."runtime_presentation_admission_members" AS admitted
       WHERE admitted."admission_id" = admission_row."id"
         AND NOT EXISTS (
           SELECT 1
           FROM public."hr_derivation_members" AS derived
           WHERE derived."derivation_id" = derivation_row."id"
             AND derived."member_index" = admitted."member_index"
             AND derived."asset_version_id" = admitted."asset_version_id"
             AND derived."file_name" = admitted."file_name"
             AND derived."file_ext" = admitted."file_ext"
             AND derived."mime_type" = admitted."mime_type"
             AND derived."sha256" = admitted."sha256"
             AND derived."size_bytes" = admitted."size_bytes"
             AND derived."storage_key_sha256" = admitted."storage_key_sha256"
         )
     )
     OR EXISTS (
       SELECT 1
       FROM public."hr_derivation_members" AS derived
       WHERE derived."derivation_id" = derivation_row."id"
         AND NOT EXISTS (
           SELECT 1
           FROM public."runtime_presentation_admission_members" AS admitted
           WHERE admitted."admission_id" = admission_row."id"
             AND admitted."member_index" = derived."member_index"
             AND admitted."asset_version_id" = derived."asset_version_id"
             AND admitted."file_name" = derived."file_name"
             AND admitted."file_ext" = derived."file_ext"
             AND admitted."mime_type" = derived."mime_type"
             AND admitted."sha256" = derived."sha256"
             AND admitted."size_bytes" = derived."size_bytes"
             AND admitted."storage_key_sha256" = derived."storage_key_sha256"
             AND admitted."rights_decision" = 'approved'
         )
     ) THEN
    RAISE EXCEPTION 'presentation admission members do not exactly match derivation'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_admission_members_exact';
  END IF;
END;
$$;

-- Replace 0063's caller-reachable advisory-lock guard in place. The existing
-- trigger now takes the protected authority-lock row, so an ordinary API
-- session cannot hold the serializer while the Scene verifier waits. The
-- first durable verified receipt seals the member set in addition to the
-- legacy frozen-snapshot seal.
CREATE OR REPLACE FUNCTION
public."runtime_presentation_member_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public."hr_lock_authority"(
    'runtime-presentation-admission', NEW."admission_id"::text
  );
  IF EXISTS (
       SELECT 1
       FROM public."phase_layout_snapshots" AS snapshot
       WHERE snapshot."runtime_presentation_admission_id" = NEW."admission_id"
     ) OR EXISTS (
       SELECT 1
       FROM public."hr_verified_scene_map_receipts" AS receipt
       WHERE receipt."presentation_admission_id" = NEW."admission_id"
     ) THEN
    RAISE EXCEPTION 'runtime presentation admission member set is sealed'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_map_receipt_admission_members_sealed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_scene_parser_runtime_identity_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  runtime_row public."hr_scene_parser_runtime_identities"%ROWTYPE;
  action_at timestamptz;
  material_body jsonb;
BEGIN
  IF NEW."runtime_identity_id" IS NULL THEN
    RAISE EXCEPTION 'Scene parser runtime revocation target is required'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_parser_runtime_revocation_target';
  END IF;
  PERFORM public."hr_lock_authority"(
    'scene-parser-runtime-identity', NEW."runtime_identity_id"::text
  );
  SELECT * INTO STRICT runtime_row
  FROM public."hr_scene_parser_runtime_identities"
  WHERE "id" = NEW."runtime_identity_id"
  FOR SHARE;
  action_at := public."hr_db_clock_ms"();
  NEW."runtime_identity_digest" := runtime_row."runtime_identity_digest";
  NEW."revoked_at" := action_at;
  NEW."created_at" := action_at;
  material_body := jsonb_build_object(
    'revokedAt', public."hr_iso_utc_ms"(action_at),
    'runtimeIdentityDigest', runtime_row."runtime_identity_digest",
    'runtimeIdentityId', runtime_row."id"::text,
    'schemaVersion',
      'historical-runtime-scene-parser-runtime-identity-revocation.v1'
  );
  NEW."revocation_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-parser-runtime-identity-revocation.v1\n'
      || public."hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."revocation_body" := material_body || jsonb_build_object(
    'revocationDigest', NEW."revocation_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_issue_scene_parser_runtime_identity_revocation"
  BEFORE INSERT ON "hr_scene_parser_runtime_identity_revocations"
  FOR EACH ROW EXECUTE FUNCTION
    "hr_issue_scene_parser_runtime_identity_revocation"();

CREATE OR REPLACE FUNCTION "hr_assert_scene_parser_runtime_identity_current"(
  p_runtime_identity_id uuid,
  p_runtime_identity_digest text,
  p_environment_id uuid,
  p_environment_digest text,
  p_scope_epoch_id uuid,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  runtime_row public."hr_scene_parser_runtime_identities"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  IF p_runtime_identity_id IS NULL OR p_runtime_identity_digest IS NULL THEN
    RAISE EXCEPTION 'production parser runtime identity is required'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_parser_runtime_identity_required';
  END IF;
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'scene-parser-runtime-identity', p_runtime_identity_id::text
  );
  SELECT * INTO STRICT runtime_row
  FROM public."hr_scene_parser_runtime_identities"
  WHERE "id" = p_runtime_identity_id
    AND "runtime_identity_digest" = p_runtime_identity_digest
    AND "environment_id" = p_environment_id
    AND "environment_mode" = 'production'
    AND "environment_digest" = p_environment_digest
    AND "scope_epoch_id" = p_scope_epoch_id
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  IF runtime_row."effective_at" > wall_now
     OR runtime_row."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1
       FROM public."hr_scene_parser_runtime_identity_revocations" AS revocation
       WHERE revocation."runtime_identity_id" = runtime_row."id"
     ) THEN
    RAISE EXCEPTION 'Scene parser runtime identity is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_parser_runtime_identity_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_scene_map_parser_receipt_current"(
  p_receipt_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  receipt_row public."hr_scene_map_parser_receipts"%ROWTYPE;
  record_identity record;
  object_receipt_id uuid;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'scene-map-receipt', p_receipt_id::text
  );
  SELECT * INTO STRICT receipt_row
  FROM public."hr_scene_map_parser_receipts"
  WHERE "id" = p_receipt_id
    AND "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (receipt_row."derivation_id", 'derivation'::text),
      (receipt_row."transform_review_id", 'transform_review'::text),
      (receipt_row."twin_release_authority_id",
        'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind,
      receipt_row."environment_id", receipt_row."environment_mode",
      receipt_row."environment_digest", receipt_row."venue_id",
      receipt_row."space_id", p_action_at
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_current"(
    receipt_row."derivation_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", p_action_at
  );
  PERFORM public."hr_assert_transform_review_current"(
    receipt_row."transform_review_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", p_action_at
  );
  PERFORM public."hr_assert_runtime_presentation_admission_members_exact"(
    receipt_row."presentation_admission_id", receipt_row."derivation_id"
  );
  PERFORM public."hr_assert_twin_release_authority_current"(
    receipt_row."twin_release_authority_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", p_action_at
  );
  PERFORM public."hr_assert_role_attestation_current"(
    receipt_row."presentation_admission_reviewer_attestation_id",
    receipt_row."environment_id", receipt_row."environment_mode",
    receipt_row."environment_digest", receipt_row."venue_id",
    receipt_row."space_id", p_action_at
  );
  PERFORM public."hr_assert_presentation_admission_reviewer_current"(
    receipt_row."presentation_admission_reviewer_attestation_id",
    receipt_row."presentation_admission_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", p_action_at
  );
  FOR object_receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT receipt_row."scene_object_receipt_id" AS id
      UNION
      SELECT receipt_row."release_manifest_object_receipt_id"
      UNION
      SELECT receipt_row."source_twin_object_receipt_id"
      UNION
      SELECT member."output_receipt_id"
      FROM public."hr_derivation_members" AS member
      WHERE member."derivation_id" = receipt_row."derivation_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_object_receipt_current"(
      object_receipt_id, receipt_row."environment_id",
      receipt_row."environment_mode", receipt_row."environment_digest",
      receipt_row."venue_id", receipt_row."space_id", p_action_at
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_graph_complete"(
    receipt_row."derivation_id"
  );
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  -- Every upstream authority is re-evaluated at one fresh post-lock instant.
  -- p_action_at is an ordering hint only; it must never backdate currentness
  -- across a blocking wait or a constituent expiry.
  PERFORM public."hr_assert_scope_current"(
    receipt_row."scope_epoch_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", wall_now
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (receipt_row."derivation_id", 'derivation'::text),
      (receipt_row."transform_review_id", 'transform_review'::text),
      (receipt_row."twin_release_authority_id",
        'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind,
      receipt_row."environment_id", receipt_row."environment_mode",
      receipt_row."environment_digest", receipt_row."venue_id",
      receipt_row."space_id", wall_now
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_current"(
    receipt_row."derivation_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", wall_now
  );
  PERFORM public."hr_assert_transform_review_current"(
    receipt_row."transform_review_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", wall_now
  );
  PERFORM public."hr_assert_runtime_presentation_admission_members_exact"(
    receipt_row."presentation_admission_id", receipt_row."derivation_id"
  );
  PERFORM public."hr_assert_twin_release_authority_current"(
    receipt_row."twin_release_authority_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", wall_now
  );
  PERFORM public."hr_assert_role_attestation_current"(
    receipt_row."presentation_admission_reviewer_attestation_id",
    receipt_row."environment_id", receipt_row."environment_mode",
    receipt_row."environment_digest", receipt_row."venue_id",
    receipt_row."space_id", wall_now
  );
  PERFORM public."hr_assert_presentation_admission_reviewer_current"(
    receipt_row."presentation_admission_reviewer_attestation_id",
    receipt_row."presentation_admission_id", receipt_row."environment_id",
    receipt_row."environment_mode", receipt_row."environment_digest",
    receipt_row."venue_id", receipt_row."space_id", wall_now
  );
  FOR object_receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT receipt_row."scene_object_receipt_id" AS id
      UNION
      SELECT receipt_row."release_manifest_object_receipt_id"
      UNION
      SELECT receipt_row."source_twin_object_receipt_id"
      UNION
      SELECT member."output_receipt_id"
      FROM public."hr_derivation_members" AS member
      WHERE member."derivation_id" = receipt_row."derivation_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_object_receipt_current"(
      object_receipt_id, receipt_row."environment_id",
      receipt_row."environment_mode", receipt_row."environment_digest",
      receipt_row."venue_id", receipt_row."space_id", wall_now
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_graph_complete"(
    receipt_row."derivation_id"
  );
  IF receipt_row."verification_profile" = 'production_runtime' THEN
    PERFORM public."hr_assert_scene_parser_runtime_identity_current"(
      receipt_row."parser_runtime_identity_id",
      receipt_row."parser_runtime_identity_digest",
      receipt_row."environment_id", receipt_row."environment_digest",
      receipt_row."scope_epoch_id", receipt_row."venue_id",
      receipt_row."space_id", wall_now
    );
  ELSIF receipt_row."verification_profile" <> 'local_test_fixture' THEN
    RAISE EXCEPTION 'unsupported Scene parser verification profile'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_map_parser_profile_current';
  END IF;
  IF receipt_row."expires_at" <= wall_now THEN
    RAISE EXCEPTION 'verified Scene-map receipt is expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_map_receipt_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_verified_scene_map_receipt_current"(
  p_receipt_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  handle_row public."hr_verified_scene_map_receipts"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM public."hr_lock_scope"(
    p_environment_id, p_venue_id, p_space_id
  );
  PERFORM public."hr_lock_authority"(
    'scene-map-verification-handle', p_receipt_id::text
  );
  SELECT * INTO STRICT handle_row
  FROM public."hr_verified_scene_map_receipts"
  WHERE "id" = p_receipt_id
    AND "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
  FOR SHARE;
  PERFORM public."hr_assert_scene_map_parser_receipt_current"(
    handle_row."parser_receipt_id", p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, p_action_at
  );
  wall_now := GREATEST(p_action_at, public."hr_wall_clock_ms"());
  IF handle_row."expires_at" <= wall_now THEN
    RAISE EXCEPTION 'verified Scene-map handle is expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_map_verification_handle_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_scene_map_parser_receipt"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  requested_id uuid := NEW."id";
  requested_scene_validation_id uuid := NEW."scene_validation_id";
  requested_admission_id uuid := NEW."presentation_admission_id";
  requested_admission_reviewer_id uuid :=
    NEW."presentation_admission_reviewer_attestation_id";
  requested_derivation_id uuid := NEW."derivation_id";
  requested_transform_review_id uuid := NEW."transform_review_id";
  requested_twin_authority_id uuid := NEW."twin_release_authority_id";
  requested_scene_receipt_id uuid := NEW."scene_object_receipt_id";
  requested_release_receipt_id uuid :=
    NEW."release_manifest_object_receipt_id";
  requested_source_receipt_id uuid := NEW."source_twin_object_receipt_id";
  requested_scene_bytes bytea := NEW."scene_map_bytes";
  requested_release_bytes bytea := NEW."release_manifest_bytes";
  requested_source_bytes bytea := NEW."source_twin_manifest_bytes";
  requested_verification_profile text := NEW."verification_profile";
  requested_parser_policy_digest text := NEW."parser_policy_digest";
  requested_parser_implementation_manifest_digest text :=
    NEW."parser_implementation_manifest_digest";
  requested_parser_runtime_identity_id uuid := NEW."parser_runtime_identity_id";
  requested_parsed_map_digest text := NEW."parsed_map_digest";
  requested_signed_transform_artifact_ref jsonb :=
    NEW."signed_transform_artifact_ref";
  requested_signed_scene_authority_map_ref jsonb :=
    NEW."signed_scene_authority_map_ref";
  requested_twin_payload_type text := NEW."twin_payload_type";
  requested_twin_key_id text := NEW."twin_key_id";
  requested_twin_public_key_fingerprint text :=
    NEW."twin_public_key_fingerprint";
  requested_twin_envelope_sha256 text := NEW."twin_envelope_sha256";
  requested_twin_envelope_byte_length bigint :=
    NEW."twin_envelope_byte_length";
  requested_twin_payload_sha256 text := NEW."twin_payload_sha256";
  requested_twin_payload_byte_length bigint := NEW."twin_payload_byte_length";
  requested_twin_statement_sha256 text := NEW."twin_statement_sha256";
  requested_twin_predicate_digest text := NEW."twin_predicate_digest";
  requested_room_projection_body jsonb := NEW."room_projection_body";
  requested_whole_region_ids jsonb := NEW."whole_region_ids";
  requested_expected_twin_node_ids jsonb := NEW."expected_twin_node_ids";
  requested_covered_twin_node_ids jsonb := NEW."covered_twin_node_ids";
  requested_ordered_regions jsonb := NEW."ordered_regions";
  requested_referenced_release_paths jsonb := NEW."referenced_release_paths";
  requested_ordered_members jsonb := NEW."ordered_members";
  requested_expanded_region_node_reference_count bigint :=
    NEW."expanded_region_node_reference_count";
  requested_normalized_projection_byte_length bigint :=
    NEW."normalized_projection_byte_length";
  requested_verified_coverage_digest text := NEW."verified_coverage_digest";
  subject_row public."hr_evidence_subjects"%ROWTYPE;
  scope_row public."hr_scope_epochs"%ROWTYPE;
  venue_row public."venues"%ROWTYPE;
  space_row public."spaces"%ROWTYPE;
  admission_row public."runtime_presentation_admissions"%ROWTYPE;
  admission_role public."hr_role_attestations"%ROWTYPE;
  derivation_row public."hr_derivations"%ROWTYPE;
  transform_row public."hr_transform_reviews"%ROWTYPE;
  twin_row record;
  runtime_identity public."hr_scene_parser_runtime_identities"%ROWTYPE;
  registry_row public."reconstruction_review_evidence_artifacts"%ROWTYPE;
  scene_receipt public."hr_object_receipts"%ROWTYPE;
  release_receipt public."hr_object_receipts"%ROWTYPE;
  source_receipt public."hr_object_receipts"%ROWTYPE;
  derivation_member public."hr_derivation_members"%ROWTYPE;
  admission_member public."runtime_presentation_admission_members"%ROWTYPE;
  record_identity record;
  member_entry record;
  region_entry record;
  object_receipt_id uuid;
  check_at timestamptz;
  action_at timestamptz;
  member_min_expiry timestamptz;
  room_node_ids jsonb;
  room_node_id_set jsonb;
  room_node_order jsonb;
  release_file_by_path jsonb;
  whole_region_ids jsonb;
  derived_ordered_regions jsonb := '[]'::jsonb;
  derived_referenced_paths jsonb;
  derived_ordered_members jsonb := '[]'::jsonb;
  region_node_ids jsonb;
  covered_node_id_set jsonb := '{}'::jsonb;
  member_region_ids jsonb;
  authority_reference text;
  coverage_digest_material jsonb;
  normalized_projection_material jsonb;
  expanded_reference_count bigint;
  normalized_projection_length bigint;
  receipt_digest_material jsonb;
  receipt_material jsonb;
BEGIN
  IF requested_id IS NULL OR requested_scene_validation_id IS NULL
     OR requested_admission_id IS NULL
     OR requested_admission_reviewer_id IS NULL
     OR requested_derivation_id IS NULL
     OR requested_transform_review_id IS NULL
     OR requested_twin_authority_id IS NULL
     OR requested_scene_receipt_id IS NULL
     OR requested_release_receipt_id IS NULL
     OR requested_source_receipt_id IS NULL
     OR requested_scene_bytes IS NULL
     OR requested_release_bytes IS NULL
     OR requested_source_bytes IS NULL
     OR requested_verification_profile IS NULL
     OR requested_parser_policy_digest IS NULL
     OR requested_parser_implementation_manifest_digest IS NULL
     OR requested_parsed_map_digest IS NULL
     OR requested_signed_transform_artifact_ref IS NULL
     OR requested_signed_scene_authority_map_ref IS NULL
     OR requested_twin_payload_type IS NULL
     OR requested_twin_key_id IS NULL
     OR requested_twin_public_key_fingerprint IS NULL
     OR requested_twin_envelope_sha256 IS NULL
     OR requested_twin_envelope_byte_length IS NULL
     OR requested_twin_payload_sha256 IS NULL
     OR requested_twin_payload_byte_length IS NULL
     OR requested_twin_statement_sha256 IS NULL
     OR requested_twin_predicate_digest IS NULL
     OR requested_room_projection_body IS NULL
     OR requested_whole_region_ids IS NULL
     OR requested_expected_twin_node_ids IS NULL
     OR requested_covered_twin_node_ids IS NULL
     OR requested_ordered_regions IS NULL
     OR requested_referenced_release_paths IS NULL
     OR requested_ordered_members IS NULL
     OR requested_expanded_region_node_reference_count IS NULL
     OR requested_normalized_projection_byte_length IS NULL
     OR requested_verified_coverage_digest IS NULL THEN
    RAISE EXCEPTION 'verified Scene-map receipt input is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_input';
  END IF;
  IF octet_length(requested_scene_bytes) NOT BETWEEN 1 AND 4194304
     OR octet_length(requested_release_bytes) NOT BETWEEN 1 AND 2097152
     OR octet_length(requested_source_bytes) NOT BETWEEN 1 AND 4194304 THEN
    RAISE EXCEPTION 'verified Scene-map receipt bytes exceed fixed bounds'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_byte_bounds';
  END IF;

  SELECT * INTO STRICT subject_row
  FROM public."hr_evidence_subjects"
  WHERE "id" = requested_scene_validation_id
    AND "subject_kind" = 'scene_validation';
  PERFORM public."hr_lock_scope"(
    subject_row."environment_id", subject_row."venue_id",
    subject_row."space_id"
  );
  PERFORM public."hr_lock_authority"(
    'scene-map-parser-receipt', requested_id::text
  );
  PERFORM public."hr_lock_authority"(
    'runtime-presentation-admission', requested_admission_id::text
  );
  SELECT * INTO STRICT subject_row
  FROM public."hr_evidence_subjects"
  WHERE "id" = requested_scene_validation_id
    AND "subject_kind" = 'scene_validation'
  FOR SHARE;
  IF (requested_verification_profile = 'production_runtime'
        AND subject_row."environment_mode" <> 'production')
     OR (requested_verification_profile = 'local_test_fixture'
        AND subject_row."environment_mode" <> 'test')
     OR requested_verification_profile NOT IN (
       'production_runtime', 'local_test_fixture'
     ) THEN
    RAISE EXCEPTION 'Scene parser verification profile does not match environment'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_environment';
  END IF;
  SELECT * INTO STRICT scope_row
  FROM public."hr_scope_epochs"
  WHERE "id" = subject_row."scope_epoch_id"
  FOR SHARE;
  SELECT * INTO STRICT venue_row
  FROM public."venues"
  WHERE "id" = subject_row."venue_id"
  FOR SHARE;
  SELECT * INTO STRICT space_row
  FROM public."spaces"
  WHERE "id" = subject_row."space_id"
    AND "venue_id" = subject_row."venue_id"
  FOR SHARE;
  SELECT * INTO STRICT admission_row
  FROM public."runtime_presentation_admissions"
  WHERE "id" = requested_admission_id
    AND "venue_slug" = venue_row."slug"
    AND "room_slug" = space_row."slug"
  FOR SHARE;
  SELECT * INTO STRICT admission_role
  FROM public."hr_role_attestations"
  WHERE "id" = requested_admission_reviewer_id
    AND "role" = 'admission_reviewer'
    AND "bound_kind" = 'presentation_admission'
    AND "bound_digest" = admission_row."admission_digest"
    AND "environment_id" = subject_row."environment_id"
    AND "environment_mode" = subject_row."environment_mode"
    AND "environment_digest" = subject_row."environment_digest"
    AND "scope_epoch_id" = subject_row."scope_epoch_id"
    AND "venue_id" = subject_row."venue_id"
    AND "space_id" = subject_row."space_id"
  FOR SHARE;
  SELECT * INTO STRICT derivation_row
  FROM public."hr_derivations"
  WHERE "id" = requested_derivation_id
    AND "environment_id" = subject_row."environment_id"
    AND "environment_mode" = subject_row."environment_mode"
    AND "environment_digest" = subject_row."environment_digest"
    AND "scope_epoch_id" = subject_row."scope_epoch_id"
    AND "venue_id" = subject_row."venue_id"
    AND "space_id" = subject_row."space_id"
  FOR SHARE;
  PERFORM public."hr_assert_runtime_presentation_admission_members_exact"(
    admission_row."id", derivation_row."id"
  );
  SELECT * INTO STRICT transform_row
  FROM public."hr_transform_reviews"
  WHERE "id" = requested_transform_review_id
    AND "presentation_admission_id" = admission_row."id"
    AND "runtime_package_id" = admission_row."runtime_package_id"
    AND "environment_id" = subject_row."environment_id"
    AND "scope_epoch_id" = subject_row."scope_epoch_id"
    AND "venue_id" = subject_row."venue_id"
    AND "space_id" = subject_row."space_id"
  FOR SHARE;
  IF requested_verification_profile = 'production_runtime' THEN
    IF requested_parser_runtime_identity_id IS NULL THEN
      RAISE EXCEPTION 'production parser runtime identity is required'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_parser_runtime_identity_required';
    END IF;
    PERFORM public."hr_lock_authority"(
      'scene-parser-runtime-identity',
      requested_parser_runtime_identity_id::text
    );
    SELECT * INTO runtime_identity
    FROM public."hr_scene_parser_runtime_identities"
    WHERE "id" = requested_parser_runtime_identity_id
      AND "environment_id" = subject_row."environment_id"
      AND "environment_mode" = 'production'
      AND "environment_digest" = subject_row."environment_digest"
      AND "scope_epoch_id" = subject_row."scope_epoch_id"
      AND "venue_id" = subject_row."venue_id"
      AND "space_id" = subject_row."space_id"
      AND "source_manifest_digest" =
        requested_parser_implementation_manifest_digest
      AND "parser_policy_digest" = requested_parser_policy_digest
      AND "verifier_capability_principal" =
        'omnitwin_historical_evidence_verifier'
      AND "verifier_session_principal_sha256" = encode(digest(
        convert_to(session_user, 'UTF8'), 'sha256'
      ), 'hex')
    FOR SHARE;
    IF runtime_identity."id" IS NULL THEN
      RAISE EXCEPTION 'production parser runtime identity is not current'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_scene_parser_runtime_identity_current';
    END IF;
    SELECT
      verified."id", verified."release_id", verified."release_digest",
      verified."release_manifest_sha256", verified."source_manifest_sha256",
      verified."release_transform_artifact_refs",
      verified."release_scene_authority_refs", verified."approval_actor_id",
      verified."expires_at", verified."twin_release_authority_digest",
      verified."payload_type", verified."key_id",
      verified."public_key_fingerprint", verified."envelope_sha256",
      verified."envelope_byte_length", verified."payload_sha256",
      verified."payload_byte_length", verified."payload_sha256" AS statement_sha256,
      encode(digest(convert_to(
        E'venviewer.historical-runtime-twin-release-predicate.v1\n'
          || public."hr_stable_canonical_json"(
            verified."statement_body"->'predicate'
          ), 'UTF8'
      ), 'sha256'), 'hex') AS predicate_digest
    INTO STRICT twin_row
    FROM public."hr_verified_twin_release_authorities" AS verified
    WHERE verified."id" = requested_twin_authority_id
      AND verified."subject_id" = subject_row."id"
      AND verified."environment_id" = subject_row."environment_id"
      AND verified."environment_mode" = 'production'
      AND verified."environment_digest" = subject_row."environment_digest"
      AND verified."scope_epoch_id" = subject_row."scope_epoch_id"
      AND verified."venue_id" = subject_row."venue_id"
      AND verified."space_id" = subject_row."space_id"
    FOR SHARE OF verified;
  ELSE
    IF requested_parser_runtime_identity_id IS NOT NULL THEN
      RAISE EXCEPTION 'local parser receipts cannot name a runtime identity'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_parser_local_runtime_identity';
    END IF;
    SELECT
      fixture."id", fixture."release_id", fixture."release_digest",
      fixture."release_manifest_sha256",
      encode(digest(requested_source_bytes, 'sha256'), 'hex')
        AS source_manifest_sha256,
      jsonb_build_array(requested_signed_transform_artifact_ref)
        AS release_transform_artifact_refs,
      jsonb_build_array(requested_signed_scene_authority_map_ref)
        AS release_scene_authority_refs,
      fixture."approved_by_actor_id" AS approval_actor_id,
      fixture."expires_at", fixture."twin_release_authority_digest",
      requested_twin_payload_type AS payload_type,
      requested_twin_key_id AS key_id,
      requested_twin_public_key_fingerprint AS public_key_fingerprint,
      requested_twin_envelope_sha256 AS envelope_sha256,
      requested_twin_envelope_byte_length AS envelope_byte_length,
      requested_twin_payload_sha256 AS payload_sha256,
      requested_twin_payload_byte_length AS payload_byte_length,
      requested_twin_statement_sha256 AS statement_sha256,
      requested_twin_predicate_digest AS predicate_digest
    INTO STRICT twin_row
    FROM public."hr_twin_release_authorities" AS fixture
    WHERE fixture."id" = requested_twin_authority_id
      AND fixture."subject_id" = subject_row."id"
      AND fixture."environment_id" = subject_row."environment_id"
      AND fixture."environment_mode" = 'test'
      AND fixture."environment_digest" = subject_row."environment_digest"
      AND fixture."scope_epoch_id" = subject_row."scope_epoch_id"
      AND fixture."venue_id" = subject_row."venue_id"
      AND fixture."space_id" = subject_row."space_id"
    FOR SHARE OF fixture;
  END IF;
  SELECT * INTO STRICT registry_row
  FROM public."reconstruction_review_evidence_artifacts"
  WHERE "id" = admission_row."scene_authority_artifact_row_id"
    AND "artifact_kind" = 'scene_authority_map_v0'
    AND "venue_slug" = venue_row."slug"
  FOR SHARE;
  SELECT * INTO STRICT scene_receipt
  FROM public."hr_object_receipts"
  WHERE "id" = requested_scene_receipt_id
    AND "receipt_role" = 'scene'
  FOR SHARE;
  SELECT * INTO STRICT release_receipt
  FROM public."hr_object_receipts"
  WHERE "id" = requested_release_receipt_id
    AND "receipt_role" = 'evidence_document'
  FOR SHARE;
  SELECT * INTO STRICT source_receipt
  FROM public."hr_object_receipts"
  WHERE "id" = requested_source_receipt_id
    AND "receipt_role" = 'evidence_document'
  FOR SHARE;
  IF requested_verification_profile = 'local_test_fixture'
     AND (
       scene_receipt."provider_profile" IS DISTINCT FROM 'local_fixture'
       OR release_receipt."provider_profile" IS DISTINCT FROM 'local_fixture'
       OR source_receipt."provider_profile" IS DISTINCT FROM 'local_fixture'
     ) THEN
    RAISE EXCEPTION 'local parser receipts require exact local-fixture objects'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_local_objects';
  END IF;
  IF derivation_row."member_count" IS DISTINCT FROM admission_row."member_count"
     OR transform_row."transform_artifact_row_id" IS DISTINCT FROM
        admission_row."runtime_transform_artifact_row_id"
     OR transform_row."transform_artifact_id" IS DISTINCT FROM
        admission_row."runtime_transform_artifact_id"
     OR transform_row."transform_artifact_digest" IS DISTINCT FROM
        admission_row."runtime_transform_artifact_digest"
     OR registry_row."artifact_id" IS DISTINCT FROM
        admission_row."scene_authority_artifact_id"
     OR registry_row."artifact_digest" IS DISTINCT FROM
        admission_row."scene_authority_map_digest"
     OR twin_row."release_transform_artifact_refs"->0 IS DISTINCT FROM
        jsonb_build_object(
          'artifactDigest', transform_row."transform_artifact_digest",
          'artifactId', transform_row."transform_artifact_id"
        )
     OR twin_row."release_scene_authority_refs"->0 IS DISTINCT FROM
        jsonb_build_object(
          'artifactDigest', registry_row."artifact_digest",
          'artifactId', registry_row."artifact_id"
        )
     OR requested_signed_transform_artifact_ref IS DISTINCT FROM
        twin_row."release_transform_artifact_refs"->0
     OR requested_signed_scene_authority_map_ref IS DISTINCT FROM
        twin_row."release_scene_authority_refs"->0
     OR requested_twin_payload_type IS DISTINCT FROM twin_row."payload_type"
     OR requested_twin_key_id IS DISTINCT FROM twin_row."key_id"
     OR requested_twin_public_key_fingerprint IS DISTINCT FROM
        twin_row."public_key_fingerprint"
     OR requested_twin_envelope_sha256 IS DISTINCT FROM
        twin_row."envelope_sha256"
     OR requested_twin_envelope_byte_length IS DISTINCT FROM
        twin_row."envelope_byte_length"
     OR requested_twin_payload_sha256 IS DISTINCT FROM twin_row."payload_sha256"
     OR requested_twin_payload_byte_length IS DISTINCT FROM
        twin_row."payload_byte_length"
     OR requested_twin_statement_sha256 IS DISTINCT FROM
        twin_row."statement_sha256"
     OR requested_twin_predicate_digest IS DISTINCT FROM
        twin_row."predicate_digest" THEN
    RAISE EXCEPTION 'Scene-map receipt lineage differs from signed Twin release'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_lineage';
  END IF;

  NEW."scene_map_bytes" := requested_scene_bytes;
  NEW."release_manifest_bytes" := requested_release_bytes;
  NEW."source_twin_manifest_bytes" := requested_source_bytes;
  NEW."scene_map_body" := convert_from(requested_scene_bytes, 'UTF8')::jsonb;
  NEW."release_manifest_body" :=
    convert_from(requested_release_bytes, 'UTF8')::jsonb;
  NEW."source_twin_manifest_body" :=
    convert_from(requested_source_bytes, 'UTF8')::jsonb;
  NEW."scene_map_sha256" := encode(digest(requested_scene_bytes, 'sha256'), 'hex');
  NEW."scene_map_byte_length" := octet_length(requested_scene_bytes);
  NEW."release_manifest_sha256" :=
    encode(digest(requested_release_bytes, 'sha256'), 'hex');
  NEW."release_manifest_byte_length" := octet_length(requested_release_bytes);
  NEW."source_twin_manifest_sha256" :=
    encode(digest(requested_source_bytes, 'sha256'), 'hex');
  NEW."source_twin_manifest_byte_length" := octet_length(requested_source_bytes);
  NEW."parsed_map_digest" := requested_parsed_map_digest;
  IF NEW."scene_map_sha256" IS DISTINCT FROM registry_row."object_sha256"
     OR NEW."scene_map_byte_length" IS DISTINCT FROM registry_row."size_bytes"
     OR NEW."scene_map_sha256" IS DISTINCT FROM scene_receipt."sha256"
     OR NEW."scene_map_byte_length" IS DISTINCT FROM scene_receipt."size_bytes"
     OR NEW."release_manifest_sha256" IS DISTINCT FROM
        twin_row."release_manifest_sha256"
     OR NEW."release_manifest_sha256" IS DISTINCT FROM release_receipt."sha256"
     OR NEW."release_manifest_byte_length" IS DISTINCT FROM
        release_receipt."size_bytes"
     OR NEW."source_twin_manifest_sha256" IS DISTINCT FROM
        twin_row."source_manifest_sha256"
     OR NEW."source_twin_manifest_sha256" IS DISTINCT FROM source_receipt."sha256"
     OR NEW."source_twin_manifest_byte_length" IS DISTINCT FROM
        source_receipt."size_bytes" THEN
    RAISE EXCEPTION 'Scene, release, or source-Twin private bytes are substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_raw_bytes';
  END IF;
  IF NEW."parsed_map_digest" !~ '^[a-f0-9]{64}$'
     OR NEW."parsed_map_digest" IS DISTINCT FROM
        registry_row."artifact_digest" THEN
    RAISE EXCEPTION 'parser result has an invalid canonical map digest'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_digest';
  END IF;

  IF NEW."scene_map_body"->>'schemaVersion' <>
       'venviewer.scene-authority-map.v0'
     OR NEW."scene_map_body"->>'id' <> registry_row."artifact_id"
     OR NEW."scene_map_body"->>'venueSlug' <> venue_row."slug"
     OR NEW."release_manifest_body"->>'releaseDigest' <>
        twin_row."release_digest"
     OR NEW."release_manifest_body"->>'sourceManifestSha256' <>
        NEW."source_twin_manifest_sha256"
     OR NEW."release_manifest_body"->>'venueSlug' <> venue_row."slug"
     OR NEW."source_twin_manifest_body"->>'venueSlug' <> venue_row."slug"
     OR NOT public."hr_jsonb_has_exact_keys"(
       NEW."release_manifest_body", ARRAY[
         'fileCount', 'files', 'generatedAt', 'releaseDigest', 'releaseKind',
         'schemaVersion', 'sourceManifestSha256', 'totalBytes', 'venueSlug'
       ]
     )
     OR jsonb_typeof(NEW."release_manifest_body"->'files') <> 'array'
     OR jsonb_array_length(NEW."release_manifest_body"->'files') < 1
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         NEW."release_manifest_body"->'files'
       ) AS release_file(value)
       WHERE public."hr_jsonb_has_exact_keys"(
           release_file.value,
           ARRAY['mimeType', 'path', 'role', 'sha256', 'sizeBytes']
         ) IS DISTINCT FROM TRUE
         OR jsonb_typeof(release_file.value->'path') IS DISTINCT FROM 'string'
         OR octet_length(release_file.value->>'path') NOT BETWEEN 1 AND 1024
         OR btrim(release_file.value->>'path') IS DISTINCT FROM
           release_file.value->>'path'
         OR release_file.value->>'path' !~
           '^[A-Za-z0-9._~!$&''()*+,;=:@/-]+$'
         OR left(release_file.value->>'path', 1) = '/'
         OR right(release_file.value->>'path', 1) = '/'
         OR position('//' IN release_file.value->>'path') > 0
         OR EXISTS (
           SELECT 1
           FROM unnest(string_to_array(release_file.value->>'path', '/')) AS segment(value)
           WHERE segment.value IN ('', '.', '..')
         )
         OR jsonb_typeof(release_file.value->'sha256') IS DISTINCT FROM 'string'
         OR release_file.value->>'sha256' !~ '^[a-f0-9]{64}$'
         OR CASE
           WHEN jsonb_typeof(release_file.value->'sizeBytes') = 'number'
             AND release_file.value->>'sizeBytes' ~ '^[1-9][0-9]{0,15}$'
           THEN (release_file.value->>'sizeBytes')::numeric > 9007199254740991
           ELSE TRUE
         END
         OR jsonb_typeof(release_file.value->'mimeType') IS DISTINCT FROM 'string'
         OR octet_length(release_file.value->>'mimeType') NOT BETWEEN 1 AND 160
         OR btrim(release_file.value->>'mimeType') IS DISTINCT FROM
           release_file.value->>'mimeType'
         OR jsonb_typeof(release_file.value->'role') IS DISTINCT FROM 'string'
         OR release_file.value->>'role' NOT IN (
           'manifest', 'imagery', 'geometry', 'evidence', 'other'
         )
     )
     OR (
       SELECT count(*)
       FROM jsonb_array_elements(
         NEW."release_manifest_body"->'files'
       ) AS release_file(value)
     ) <> (
       SELECT count(DISTINCT lower(release_file.value->>'path'))
       FROM jsonb_array_elements(
         NEW."release_manifest_body"->'files'
       ) AS release_file(value)
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW."release_manifest_body"->'files')
         WITH ORDINALITY AS release_file(value, ordinal)
       WHERE ordinal > 1
         AND release_file.value->>'path' <= (
           NEW."release_manifest_body"->'files'->(ordinal::integer - 2)
         )->>'path'
     )
     OR (CASE
       WHEN jsonb_typeof(NEW."release_manifest_body"->'fileCount') = 'number'
         AND NEW."release_manifest_body"->>'fileCount' ~ '^[1-9][0-9]{0,15}$'
       THEN (NEW."release_manifest_body"->>'fileCount')::numeric <>
         jsonb_array_length(NEW."release_manifest_body"->'files')
       ELSE TRUE
     END)
     OR (CASE
       WHEN jsonb_typeof(NEW."release_manifest_body"->'totalBytes') = 'number'
         AND NEW."release_manifest_body"->>'totalBytes' ~ '^[1-9][0-9]{0,15}$'
       THEN (NEW."release_manifest_body"->>'totalBytes')::numeric >
           9007199254740991
         OR (NEW."release_manifest_body"->>'totalBytes')::numeric <> (
           SELECT sum((release_file.value->>'sizeBytes')::numeric)
           FROM jsonb_array_elements(
             NEW."release_manifest_body"->'files'
           ) AS release_file(value)
         )
       ELSE TRUE
     END)
     OR NEW."release_manifest_body"->>'releaseDigest' <> encode(digest(
       convert_to(
         E'venviewer.reconstruction-release.v1\n' || (
           SELECT string_agg(
             (release_file.value->>'sha256') || '  '
               || (release_file.value->>'sizeBytes')::bigint::text || '  '
               || (release_file.value->>'path') || E'\n',
             '' ORDER BY release_file.value->>'path' COLLATE "C"
           )
           FROM jsonb_array_elements(
             NEW."release_manifest_body"->'files'
           ) AS release_file(value)
         ),
         'UTF8'
       ),
       'sha256'
     ), 'hex')
     OR (
       SELECT count(*)
       FROM jsonb_array_elements(
         NEW."release_manifest_body"->'files'
       ) AS release_file(value)
       WHERE release_file.value->>'path' = 'manifest.json'
         AND release_file.value->>'role' = 'manifest'
         AND release_file.value->>'sha256' = NEW."source_twin_manifest_sha256"
         AND (release_file.value->>'sizeBytes')::bigint =
           NEW."source_twin_manifest_byte_length"
     ) <> 1
     OR jsonb_typeof(NEW."scene_map_body"->'regions') <> 'array'
     OR jsonb_array_length(NEW."scene_map_body"->'regions') NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(NEW."source_twin_manifest_body"->'nodes') <> 'array'
     OR jsonb_array_length(
       NEW."source_twin_manifest_body"->'nodes'
     ) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'verified private Scene/release/source bodies are inconsistent'
     USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_parsed_identity';
  END IF;
  -- The strict, unique release inventory above is the only source of file
  -- authority. Materialize it once before iterating up to 2,000 regions;
  -- rescanning a 10,000-file JSON array for every authority slot would hold
  -- the scope and receipt locks for an attacker-controlled amount of time.
  SELECT jsonb_object_agg(release_file.value->>'path', release_file.value)
  INTO STRICT release_file_by_path
  FROM jsonb_array_elements(
    NEW."release_manifest_body"->'files'
  ) AS release_file(value);
  IF EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         NEW."source_twin_manifest_body"->'nodes'
       ) AS node(value)
        WHERE NOT (node.value ? 'roomSlug')
          OR node.value->'roomSlug' = 'null'::jsonb
          OR jsonb_typeof(node.value->'roomSlug') <> 'string'
     )
     OR (
       SELECT count(*)
       FROM jsonb_array_elements(NEW."source_twin_manifest_body"->'nodes')
     ) <> (
       SELECT count(DISTINCT node.value->>'id')
       FROM jsonb_array_elements(
         NEW."source_twin_manifest_body"->'nodes'
       ) AS node(value)
     )
     OR (
       SELECT count(*)
       FROM jsonb_array_elements(NEW."source_twin_manifest_body"->'nodes')
     ) <> (
       SELECT count(DISTINCT (node.value->>'index')::integer)
       FROM jsonb_array_elements(
         NEW."source_twin_manifest_body"->'nodes'
       ) AS node(value)
     ) THEN
    RAISE EXCEPTION 'source Twin nodes need unique IDs/indices and exact room tags'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_twin_nodes';
  END IF;
  SELECT jsonb_agg(to_jsonb(node.value->>'id') ORDER BY node.ordinal)
  INTO room_node_ids
  FROM jsonb_array_elements(NEW."source_twin_manifest_body"->'nodes')
    WITH ORDINALITY AS node(value, ordinal)
  WHERE node.value->>'roomSlug' = space_row."slug";
  IF jsonb_typeof(room_node_ids) <> 'array'
     OR jsonb_array_length(room_node_ids) < 1 THEN
    RAISE EXCEPTION 'source Twin has no nodes for the exact room'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_room_nodes';
  END IF;
  SELECT jsonb_object_agg(room_node.node_id, true)
  INTO STRICT room_node_id_set
  FROM jsonb_array_elements_text(room_node_ids) AS room_node(node_id);
  SELECT jsonb_object_agg(room_node.node_id, room_node.ordinal - 1)
  INTO STRICT room_node_order
  FROM jsonb_array_elements_text(room_node_ids)
    WITH ORDINALITY AS room_node(node_id, ordinal);
  SELECT jsonb_agg(to_jsonb(region.value->>'id') ORDER BY region.ordinal)
  INTO whole_region_ids
  FROM jsonb_array_elements(NEW."scene_map_body"->'regions')
    WITH ORDINALITY AS region(value, ordinal);
  IF jsonb_array_length(whole_region_ids) <> (
       SELECT count(DISTINCT region.value->>'id')
       FROM jsonb_array_elements(NEW."scene_map_body"->'regions') AS region(value)
     ) THEN
    RAISE EXCEPTION 'Scene region IDs are not unique'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_region_ids';
  END IF;
  SELECT sum(
    CASE region.value->'scope'->>'kind'
      WHEN 'twin_nodes' THEN jsonb_array_length(
        region.value->'scope'->'nodeIds'
      )
      ELSE jsonb_array_length(room_node_ids)
    END
  )::bigint
  INTO STRICT expanded_reference_count
  FROM jsonb_array_elements(NEW."scene_map_body"->'regions') AS region(value);
  IF expanded_reference_count NOT BETWEEN 1 AND 65536 THEN
    RAISE EXCEPTION 'expanded Scene region-node projection exceeds fixed bound'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_expanded_projection_bound';
  END IF;

  FOR region_entry IN
    SELECT region.value, (region.ordinal - 1)::integer AS region_index
    FROM jsonb_array_elements(NEW."scene_map_body"->'regions')
      WITH ORDINALITY AS region(value, ordinal)
    ORDER BY region.ordinal
  LOOP
    IF region_entry.value->'transformArtifactRef' IS DISTINCT FROM
         jsonb_build_object(
           'artifactDigest', transform_row."transform_artifact_digest",
           'artifactId', transform_row."transform_artifact_id"
         ) THEN
      RAISE EXCEPTION 'Scene region is not bound to the selected transform'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_region_transform';
    ELSIF region_entry.value->'scope'->>'kind' = 'bounds_cvf' THEN
      RAISE EXCEPTION 'bounds_cvf needs an exact transform-frame proof'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_bounds_cvf';
    ELSIF region_entry.value->'scope'->>'kind' = 'whole_venue' THEN
      IF jsonb_array_length(room_node_ids) <> jsonb_array_length(
           NEW."source_twin_manifest_body"->'nodes'
         ) THEN
        RAISE EXCEPTION 'whole_venue cannot prove one room in a multi-room Twin'
          USING ERRCODE = '23514',
                CONSTRAINT = 'hr_scene_map_receipt_whole_venue_scope';
      END IF;
      region_node_ids := room_node_ids;
    ELSIF region_entry.value->'scope'->>'kind' = 'twin_nodes' THEN
      region_node_ids := region_entry.value->'scope'->'nodeIds';
      IF jsonb_typeof(region_node_ids) <> 'array'
         OR jsonb_array_length(region_node_ids) NOT BETWEEN 1 AND 2000
         OR jsonb_array_length(region_node_ids) <> (
           SELECT count(DISTINCT supplied.node_id)
           FROM jsonb_array_elements_text(region_node_ids)
             AS supplied(node_id)
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(region_node_ids)
             AS supplied(node_id)
           WHERE NOT (room_node_id_set ? supplied.node_id)
         ) THEN
        RAISE EXCEPTION 'Scene region names a node outside the exact room projection'
          USING ERRCODE = '23514',
                CONSTRAINT = 'hr_scene_map_receipt_region_nodes';
      END IF;
    ELSE
      RAISE EXCEPTION 'Scene region scope is unsupported'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_region_scope';
    END IF;
    IF public."hr_jsonb_has_exact_keys"(
         region_entry.value->'authorities', ARRAY[
           'appearanceAuthority', 'exportAuthority', 'geometryAuthority',
           'interactionAuthority', 'lightingAuthority', 'physicsAuthority',
           'semanticAuthority'
         ]
       ) IS DISTINCT FROM TRUE
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(region_entry.value->'authorities') AS authority(slot, body)
         WHERE NOT (
           public."hr_jsonb_has_exact_keys"(
             body, ARRAY['kind', 'ref']
           ) IS TRUE
           AND jsonb_typeof(body->'kind') = 'string'
           AND body->>'kind' IN ('release_file', 'runtime_layer', 'none')
           AND (
             (body->>'kind' = 'none' AND body->'ref' = 'null'::jsonb)
             OR (
               body->>'kind' IN ('release_file', 'runtime_layer')
               AND jsonb_typeof(body->'ref') = 'string'
               AND octet_length(body->>'ref') BETWEEN 1 AND 1024
             )
           )
         ) IS TRUE
       )
       OR region_entry.value->'authorities'->'geometryAuthority'->>'kind'
         IS DISTINCT FROM
         'release_file'
       OR region_entry.value->'authorities'->'semanticAuthority'->>'kind'
         IS DISTINCT FROM
         'release_file'
       OR region_entry.value->'authorities'->'interactionAuthority'->>'kind'
         IS DISTINCT FROM
         'release_file'
       OR (
         region_entry.value->'authorities'->'appearanceAuthority'->>'kind'
         IN ('release_file', 'runtime_layer')
       ) IS DISTINCT FROM TRUE
       OR EXISTS (
         SELECT 1
         FROM (VALUES
           ('lightingAuthority'), ('physicsAuthority'), ('exportAuthority')
         ) AS optional(slot)
         WHERE (
           region_entry.value->'authorities'->optional.slot->>'kind'
             IN ('release_file', 'none')
         ) IS DISTINCT FROM TRUE
       )
       OR EXISTS (
          SELECT 1
          FROM jsonb_each(region_entry.value->'authorities') AS authority(slot, body)
          WHERE body->>'kind' = 'runtime_layer'
            AND slot <> 'appearanceAuthority'
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(region_entry.value->'authorities') AS authority(slot, body)
         WHERE body->>'kind' = 'release_file'
           AND NOT (release_file_by_path ? (body->>'ref'))
       )
       OR EXISTS (
          SELECT 1
          FROM jsonb_each(region_entry.value->'authorities') AS authority(slot, body)
          WHERE body->>'kind' = 'release_file'
            AND (
              lower(body->>'ref') LIKE '%.sog'
              OR lower(body->>'ref') LIKE '%.spz'
            )
       ) THEN
      RAISE EXCEPTION 'Scene authority slots are not exact release/appearance evidence'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_authority_slots';
    END IF;
    IF (
         release_file_by_path -> (
           region_entry.value->'authorities'->'geometryAuthority'->>'ref'
         ) ->> 'role'
       ) IS DISTINCT FROM 'geometry'
       OR (
         (
           release_file_by_path -> (
             region_entry.value->'authorities'->'semanticAuthority'->>'ref'
           ) ->> 'role'
         ) IN ('manifest', 'geometry')
       ) IS DISTINCT FROM TRUE
       OR (
         (
           release_file_by_path -> (
             region_entry.value->'authorities'->'interactionAuthority'->>'ref'
           ) ->> 'role'
         ) IN ('manifest', 'geometry')
       ) IS DISTINCT FROM TRUE
       OR (
         region_entry.value->'authorities'->'appearanceAuthority'->>'kind' =
           'release_file'
         AND (
           release_file_by_path -> (
             region_entry.value->'authorities'->'appearanceAuthority'->>'ref'
           ) ->> 'role'
         ) IS DISTINCT FROM 'imagery'
       ) THEN
      RAISE EXCEPTION 'Scene required authority has the wrong release role'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_release_roles';
    END IF;
  END LOOP;
  SELECT jsonb_agg(
    jsonb_build_object(
      'coveredTwinNodeIds', CASE
        WHEN region.value->'scope'->>'kind' = 'whole_venue' THEN room_node_ids
        ELSE (
          SELECT jsonb_agg(to_jsonb(supplied.node_id) ORDER BY
            (room_node_order->>supplied.node_id)::integer)
          FROM jsonb_array_elements_text(
            region.value->'scope'->'nodeIds'
          ) AS supplied(node_id)
        )
      END,
      'regionId', region.value->>'id',
      'regionIndex', (region.ordinal - 1)::integer
    ) ORDER BY region.ordinal
  )
  INTO STRICT derived_ordered_regions
  FROM jsonb_array_elements(NEW."scene_map_body"->'regions')
    WITH ORDINALITY AS region(value, ordinal);
  SELECT jsonb_object_agg(covered.node_id, true)
  INTO STRICT covered_node_id_set
  FROM jsonb_array_elements(derived_ordered_regions) AS region(value)
  CROSS JOIN LATERAL jsonb_array_elements_text(
    region.value->'coveredTwinNodeIds'
  ) AS covered(node_id);
  IF covered_node_id_set IS DISTINCT FROM room_node_id_set THEN
    RAISE EXCEPTION 'Scene regions do not cover every exact room Twin node'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_whole_room';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(referenced.path) ORDER BY referenced.first_pos),
    '[]'::jsonb)
  INTO derived_referenced_paths
  FROM (
    SELECT authority.body->>'ref' AS path,
      min((region.ordinal - 1) * 10 + authority.slot_order) AS first_pos
    FROM jsonb_array_elements(NEW."scene_map_body"->'regions')
      WITH ORDINALITY AS region(value, ordinal)
    CROSS JOIN LATERAL (VALUES
      (1, region.value->'authorities'->'geometryAuthority'),
      (2, region.value->'authorities'->'appearanceAuthority'),
      (3, region.value->'authorities'->'lightingAuthority'),
      (4, region.value->'authorities'->'physicsAuthority'),
      (5, region.value->'authorities'->'semanticAuthority'),
      (6, region.value->'authorities'->'interactionAuthority'),
      (7, region.value->'authorities'->'exportAuthority')
    ) AS authority(slot_order, body)
    WHERE authority.body->>'kind' = 'release_file'
    GROUP BY authority.body->>'ref'
  ) AS referenced;

  FOR member_entry IN
    SELECT member."member_index"
    FROM public."hr_derivation_members" AS member
    WHERE member."derivation_id" = derivation_row."id"
    ORDER BY member."member_index"
  LOOP
    IF member_entry.member_index < 0
       OR member_entry.member_index >= derivation_row."member_count" THEN
      RAISE EXCEPTION 'derivation members are not dense'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_dense_members';
    END IF;
    SELECT * INTO STRICT derivation_member
    FROM public."hr_derivation_members"
    WHERE "derivation_id" = derivation_row."id"
      AND "member_index" = member_entry.member_index
    FOR SHARE;
    SELECT * INTO STRICT admission_member
    FROM public."runtime_presentation_admission_members"
    WHERE "admission_id" = admission_row."id"
      AND "member_index" = member_entry.member_index;
    IF admission_member."asset_version_id" IS DISTINCT FROM
         derivation_member."asset_version_id"
       OR admission_member."file_name" IS DISTINCT FROM
          derivation_member."file_name"
       OR admission_member."file_ext" IS DISTINCT FROM
          derivation_member."file_ext"
       OR admission_member."mime_type" IS DISTINCT FROM
          derivation_member."mime_type"
       OR admission_member."sha256" IS DISTINCT FROM derivation_member."sha256"
       OR admission_member."size_bytes" IS DISTINCT FROM
          derivation_member."size_bytes"
       OR admission_member."storage_key_sha256" IS DISTINCT FROM
          derivation_member."storage_key_sha256"
       OR admission_member."rights_decision" <> 'approved' THEN
      RAISE EXCEPTION 'Scene member does not exactly intersect admission and derivation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_member_intersection';
    END IF;
    authority_reference := 'runtime-layer/v1/' || encode(digest(convert_to(
      E'venviewer.historical-runtime-scene-runtime-layer.v1\n'
        || public."hr_stable_canonical_json"(jsonb_build_object(
          'assetVersionId', derivation_member."asset_version_id"::text,
          'fileExt', derivation_member."file_ext",
          'fileName', derivation_member."file_name",
          'memberIndex', member_entry.member_index::text,
          'mimeType', derivation_member."mime_type",
          'sha256', derivation_member."sha256",
          'sizeBytes', derivation_member."size_bytes"::text,
          'storageKeySha256', derivation_member."storage_key_sha256"
        )), 'UTF8'
    ), 'sha256'), 'hex');
    SELECT jsonb_agg(to_jsonb(region.value->>'id') ORDER BY region.ordinal)
    INTO member_region_ids
    FROM jsonb_array_elements(NEW."scene_map_body"->'regions')
      WITH ORDINALITY AS region(value, ordinal)
    WHERE region.value->'authorities'->'appearanceAuthority'->>'kind' =
        'runtime_layer'
      AND region.value->'authorities'->'appearanceAuthority'->>'ref' =
        authority_reference;
    IF jsonb_typeof(member_region_ids) <> 'array'
       OR jsonb_array_length(member_region_ids) < 1 THEN
      RAISE EXCEPTION 'signed Scene map omits an exact runtime member layer'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_map_receipt_runtime_layer';
    END IF;
    derived_ordered_members := derived_ordered_members || jsonb_build_array(
      jsonb_build_object(
        'admissionRightsDecision', admission_member."rights_decision",
        'admissionRightsEvidenceDigest', admission_member."rights_evidence_digest",
        'admissionRightsEvidenceRowId', admission_member."rights_evidence_row_id"::text,
        'admissionRightsReviewedAt',
          public."hr_iso_utc_ms"(admission_member."rights_reviewed_at"),
        'admissionRightsReviewedBy', admission_member."rights_reviewed_by"::text,
        'assetVersionId', derivation_member."asset_version_id"::text,
        'authorityReference', authority_reference,
        'coveredRegionIds', member_region_ids,
        'derivationMemberReceiptDigest', derivation_member."output_receipt_digest",
        'derivationMemberReceiptExpiresAt',
          public."hr_iso_utc_ms"(derivation_member."receipt_expires_at"),
        'derivationMemberStorageKeySha256',
          derivation_member."storage_key_sha256",
        'derivationOutputReceiptId', derivation_member."output_receipt_id"::text,
        'fileExt', derivation_member."file_ext",
        'fileName', derivation_member."file_name",
        'memberIndex', member_entry.member_index,
        'mimeType', derivation_member."mime_type",
        'sha256', derivation_member."sha256",
        'sizeBytes', derivation_member."size_bytes"
      )
    );
  END LOOP;
  IF jsonb_array_length(derived_ordered_members) <>
       derivation_row."member_count"
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(derived_ordered_members) AS member(value)
       WHERE jsonb_typeof(member.value->'coveredRegionIds') <> 'array'
          OR jsonb_array_length(member.value->'coveredRegionIds') < 1
          OR jsonb_array_length(member.value->'coveredRegionIds') <> (
            SELECT count(DISTINCT covered.region_id)
            FROM jsonb_array_elements_text(
              member.value->'coveredRegionIds'
            ) AS covered(region_id)
          )
     )
     OR (
       SELECT count(DISTINCT covered.region_id)
       FROM jsonb_array_elements(derived_ordered_members) AS member(value),
         jsonb_array_elements_text(
           member.value->'coveredRegionIds'
         ) AS covered(region_id)
     ) <> jsonb_array_length(whole_region_ids)
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(whole_region_ids) AS whole(region_id)
       WHERE NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(derived_ordered_members) AS member(value),
           jsonb_array_elements_text(
             member.value->'coveredRegionIds'
           ) AS covered(region_id)
         WHERE covered.region_id = whole.region_id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(derived_ordered_members) AS member(value),
         jsonb_array_elements_text(
           member.value->'coveredRegionIds'
         ) AS covered(region_id)
       WHERE NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(whole_region_ids) AS whole(region_id)
         WHERE whole.region_id = covered.region_id
       )
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW."scene_map_body"->'regions') AS region(value)
       WHERE region.value->'authorities'->'appearanceAuthority'->>'kind' =
           'runtime_layer'
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(derived_ordered_members) AS member(value)
           WHERE member.value->>'authorityReference' =
             region.value->'authorities'->'appearanceAuthority'->>'ref'
         )
     ) THEN
    RAISE EXCEPTION 'signed Scene runtime-layer projection has extras or gaps'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_receipt_runtime_layer_set';
  END IF;
  SELECT min("receipt_expires_at") INTO STRICT member_min_expiry
  FROM public."hr_derivation_members"
  WHERE "derivation_id" = derivation_row."id";

  NEW."environment_id" := subject_row."environment_id";
  NEW."environment_mode" := subject_row."environment_mode";
  NEW."environment_digest" := subject_row."environment_digest";
  NEW."scope_epoch_id" := subject_row."scope_epoch_id";
  NEW."scope_epoch" := scope_row."epoch";
  NEW."scope_epoch_digest" := scope_row."epoch_digest";
  NEW."scope_epoch_expires_at" := scope_row."expires_at";
  NEW."venue_id" := subject_row."venue_id";
  NEW."venue_slug" := venue_row."slug";
  NEW."space_id" := subject_row."space_id";
  NEW."space_slug" := space_row."slug";
  NEW."presentation_admission_id" := admission_row."id";
  NEW."presentation_admission_digest" := admission_row."admission_digest";
  NEW."presentation_admission_reviewer_attestation_id" := admission_role."id";
  NEW."presentation_admission_reviewer_attestation_digest" :=
    admission_role."attestation_digest";
  NEW."presentation_admission_reviewer_subject_id" := admission_role."subject_id";
  NEW."presentation_admission_reviewer_actor_id" := admission_role."actor_id";
  NEW."presentation_admission_reviewer_effective_at" :=
    admission_role."effective_at";
  NEW."presentation_admission_reviewer_expires_at" := admission_role."expires_at";
  NEW."runtime_package_id" := admission_row."runtime_package_id";
  NEW."runtime_package_content_digest" :=
    admission_row."runtime_package_content_digest";
  NEW."runtime_manifest_digest" := admission_row."runtime_manifest_digest";
  NEW."admission_member_count" := admission_row."member_count";
  NEW."derivation_id" := derivation_row."id";
  NEW."derivation_evidence_digest" := derivation_row."derivation_evidence_digest";
  NEW."derivation_members_digest" := derivation_row."members_digest";
  NEW."derivation_member_count" := derivation_row."member_count";
  NEW."derivation_expires_at" := derivation_row."expires_at";
  NEW."member_receipt_min_expires_at" := member_min_expiry;
  NEW."transform_review_id" := transform_row."id";
  NEW."transform_review_subject_digest" :=
    transform_row."transform_review_subject_digest";
  NEW."transform_review_digest" := transform_row."transform_review_digest";
  NEW."transform_reviewer_actor_id" := transform_row."reviewer_actor_id";
  NEW."transform_review_expires_at" := transform_row."expires_at";
  NEW."transform_artifact_row_id" := transform_row."transform_artifact_row_id";
  NEW."transform_artifact_id" := transform_row."transform_artifact_id";
  NEW."transform_artifact_digest" := transform_row."transform_artifact_digest";
  NEW."twin_release_authority_id" := twin_row."id";
  NEW."twin_release_authority_digest" := twin_row."twin_release_authority_digest";
  NEW."twin_release_authority_actor_id" := twin_row."approval_actor_id";
  NEW."twin_release_authority_expires_at" := twin_row."expires_at";
  NEW."twin_release_id" := twin_row."release_id";
  NEW."twin_release_digest" := twin_row."release_digest";
  NEW."twin_release_manifest_digest" := twin_row."release_manifest_sha256";
  NEW."twin_payload_type" := twin_row."payload_type";
  NEW."twin_key_id" := twin_row."key_id";
  NEW."twin_public_key_fingerprint" := twin_row."public_key_fingerprint";
  NEW."twin_envelope_sha256" := twin_row."envelope_sha256";
  NEW."twin_envelope_byte_length" := twin_row."envelope_byte_length";
  NEW."twin_payload_sha256" := twin_row."payload_sha256";
  NEW."twin_payload_byte_length" := twin_row."payload_byte_length";
  NEW."twin_statement_sha256" := twin_row."statement_sha256";
  NEW."twin_predicate_digest" := twin_row."predicate_digest";
  NEW."signed_transform_artifact_ref" := twin_row."release_transform_artifact_refs"->0;
  NEW."signed_scene_authority_map_ref" := twin_row."release_scene_authority_refs"->0;
  NEW."scene_artifact_row_id" := registry_row."id";
  NEW."scene_artifact_kind" := registry_row."artifact_kind";
  NEW."scene_artifact_id" := registry_row."artifact_id";
  NEW."scene_artifact_digest" := registry_row."artifact_digest";
  NEW."scene_registry_object_key" := registry_row."object_key";
  NEW."scene_registry_object_sha256" := registry_row."object_sha256";
  NEW."scene_registry_object_size_bytes" := registry_row."size_bytes";
  NEW."scene_registry_schema_version" := registry_row."schema_version";
  NEW."scene_registry_registered_by" := registry_row."registered_by";
  NEW."scene_registry_registered_at" := registry_row."registered_at";
  NEW."scene_object_receipt_id" := scene_receipt."id";
  NEW."scene_object_receipt_role" := scene_receipt."receipt_role";
  NEW."scene_object_receipt_digest" := scene_receipt."receipt_digest";
  NEW."scene_object_capability_id" := scene_receipt."capability_id";
  NEW."scene_object_capability_digest" := scene_receipt."capability_digest";
  NEW."scene_object_capability_expires_at" := scene_receipt."capability_expires_at";
  NEW."scene_object_sha256" := scene_receipt."sha256";
  NEW."scene_object_size_bytes" := scene_receipt."size_bytes";
  NEW."scene_object_file_name" := scene_receipt."file_name";
  NEW."scene_object_mime_type" := scene_receipt."mime_type";
  NEW."scene_object_receipt_expires_at" := scene_receipt."denial_expires_at";
  NEW."scene_object_receipt_body" := scene_receipt."receipt_body";
  NEW."release_manifest_object_receipt_id" := release_receipt."id";
  NEW."release_manifest_object_receipt_role" := release_receipt."receipt_role";
  NEW."release_manifest_object_receipt_digest" := release_receipt."receipt_digest";
  NEW."release_manifest_capability_id" := release_receipt."capability_id";
  NEW."release_manifest_capability_digest" := release_receipt."capability_digest";
  NEW."release_manifest_capability_expires_at" :=
    release_receipt."capability_expires_at";
  NEW."release_manifest_object_sha256" := release_receipt."sha256";
  NEW."release_manifest_object_size_bytes" := release_receipt."size_bytes";
  NEW."release_manifest_object_file_name" := release_receipt."file_name";
  NEW."release_manifest_object_mime_type" := release_receipt."mime_type";
  NEW."release_manifest_receipt_expires_at" := release_receipt."denial_expires_at";
  NEW."release_manifest_object_receipt_body" := release_receipt."receipt_body";
  NEW."source_twin_object_receipt_id" := source_receipt."id";
  NEW."source_twin_object_receipt_role" := source_receipt."receipt_role";
  NEW."source_twin_object_receipt_digest" := source_receipt."receipt_digest";
  NEW."source_twin_capability_id" := source_receipt."capability_id";
  NEW."source_twin_capability_digest" := source_receipt."capability_digest";
  NEW."source_twin_capability_expires_at" := source_receipt."capability_expires_at";
  NEW."source_twin_object_sha256" := source_receipt."sha256";
  NEW."source_twin_object_size_bytes" := source_receipt."size_bytes";
  NEW."source_twin_object_file_name" := source_receipt."file_name";
  NEW."source_twin_object_mime_type" := source_receipt."mime_type";
  NEW."source_twin_receipt_expires_at" := source_receipt."denial_expires_at";
  NEW."source_twin_object_receipt_body" := source_receipt."receipt_body";
  NEW."source_twin_manifest_release_object_path" := 'manifest.json';
  NEW."room_projection_body" := jsonb_build_object(
    'ordering', 'source_twin_manifest_order',
    'projectionVersion', 'venviewer.scene-room-node-projection.v1',
    'roomTwinNodeIds', room_node_ids,
    'spaceSlug', space_row."slug"
  );
  NEW."whole_region_ids" := whole_region_ids;
  NEW."expected_twin_node_ids" := room_node_ids;
  NEW."covered_twin_node_ids" := room_node_ids;
  NEW."ordered_regions" := derived_ordered_regions;
  NEW."referenced_release_paths" := derived_referenced_paths;
  NEW."ordered_members" := derived_ordered_members;
  NEW."verification_profile" := requested_verification_profile;
  NEW."parser_policy_digest" := requested_parser_policy_digest;
  NEW."parser_implementation_manifest_digest" :=
    requested_parser_implementation_manifest_digest;
  IF requested_verification_profile = 'production_runtime' THEN
    NEW."parser_runtime_identity_id" := runtime_identity."id";
    NEW."parser_runtime_identity_digest" :=
      runtime_identity."runtime_identity_digest";
    NEW."parser_runtime_identity_effective_at" := runtime_identity."effective_at";
    NEW."parser_runtime_identity_expires_at" := runtime_identity."expires_at";
    NEW."parser_runtime_executable_artifact_digest" :=
      runtime_identity."executable_artifact_digest";
    NEW."parser_runtime_deployment_image_digest" :=
      runtime_identity."deployment_image_digest";
    NEW."parser_runtime_session_principal_sha256" :=
      runtime_identity."verifier_session_principal_sha256";
  ELSE
    NEW."parser_runtime_identity_id" := NULL;
    NEW."parser_runtime_identity_digest" := NULL;
    NEW."parser_runtime_identity_effective_at" := NULL;
    NEW."parser_runtime_identity_expires_at" := NULL;
    NEW."parser_runtime_executable_artifact_digest" := NULL;
    NEW."parser_runtime_deployment_image_digest" := NULL;
    NEW."parser_runtime_session_principal_sha256" := NULL;
  END IF;
  normalized_projection_material := jsonb_build_object(
    'coveredTwinNodeIds', NEW."covered_twin_node_ids",
    'expectedTwinNodeIds', NEW."expected_twin_node_ids",
    'orderedRegions', NEW."ordered_regions",
    'orderedRuntimeLayers', (
      SELECT jsonb_agg(jsonb_build_object(
        'authorityReference', member.value->>'authorityReference',
        'coveredRegionIds', member.value->'coveredRegionIds',
        'runtimeLayerIndex', (member.ordinal - 1)::integer
      ) ORDER BY member.ordinal)
      FROM jsonb_array_elements(NEW."ordered_members")
        WITH ORDINALITY AS member(value, ordinal)
    ),
    'referencedReleasePaths', NEW."referenced_release_paths",
    'regionIds', NEW."whole_region_ids",
    'roomProjection', NEW."room_projection_body"
  );
  normalized_projection_length := octet_length(convert_to(
    public."hr_stable_canonical_json"(normalized_projection_material),
    'UTF8'
  ));
  IF normalized_projection_length NOT BETWEEN 1 AND 4194304 THEN
    RAISE EXCEPTION 'normalized Scene projection exceeds fixed byte bound'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_projection_byte_bound';
  END IF;
  NEW."expanded_region_node_reference_count" := expanded_reference_count;
  NEW."normalized_projection_byte_length" := normalized_projection_length;
  IF requested_room_projection_body IS DISTINCT FROM NEW."room_projection_body"
     OR requested_whole_region_ids IS DISTINCT FROM NEW."whole_region_ids"
     OR requested_expected_twin_node_ids IS DISTINCT FROM
        NEW."expected_twin_node_ids"
     OR requested_covered_twin_node_ids IS DISTINCT FROM
        NEW."covered_twin_node_ids"
     OR requested_ordered_regions IS DISTINCT FROM NEW."ordered_regions"
     OR requested_referenced_release_paths IS DISTINCT FROM
        NEW."referenced_release_paths"
     OR requested_ordered_members IS DISTINCT FROM NEW."ordered_members"
     OR requested_expanded_region_node_reference_count IS DISTINCT FROM
        NEW."expanded_region_node_reference_count"
     OR requested_normalized_projection_byte_length IS DISTINCT FROM
        NEW."normalized_projection_byte_length" THEN
    RAISE EXCEPTION 'authenticated parser projection differs from DB lineage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_projection_exact';
  END IF;

  -- All lock-taking currentness calls above are repeated at one fresh wall
  -- instant after the full deterministic lock set is held.
  check_at := public."hr_wall_clock_ms"();
  PERFORM public."hr_assert_scope_current"(
    subject_row."scope_epoch_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (derivation_row."id", 'derivation'::text),
      (transform_row."id", 'transform_review'::text),
      (twin_row."id", 'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind, subject_row."environment_id",
      subject_row."environment_mode", subject_row."environment_digest",
      subject_row."venue_id", subject_row."space_id", check_at
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_current"(
    derivation_row."id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  PERFORM public."hr_assert_transform_review_current"(
    transform_row."id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  PERFORM public."hr_assert_runtime_presentation_admission_members_exact"(
    admission_row."id", derivation_row."id"
  );
  PERFORM public."hr_assert_twin_release_authority_current"(
    twin_row."id", subject_row."environment_id", subject_row."environment_mode",
    subject_row."environment_digest", subject_row."venue_id",
    subject_row."space_id", check_at
  );
  PERFORM public."hr_assert_role_attestation_current"(
    admission_role."id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  PERFORM public."hr_assert_presentation_admission_reviewer_current"(
    admission_role."id", admission_row."id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  FOR object_receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT scene_receipt."id" AS id
      UNION SELECT release_receipt."id"
      UNION SELECT source_receipt."id"
      UNION SELECT member."output_receipt_id"
      FROM public."hr_derivation_members" AS member
      WHERE member."derivation_id" = derivation_row."id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM public."hr_assert_object_receipt_current"(
      object_receipt_id, subject_row."environment_id",
      subject_row."environment_mode", subject_row."environment_digest",
      subject_row."venue_id", subject_row."space_id", check_at
    );
  END LOOP;
  PERFORM public."hr_assert_derivation_graph_complete"(derivation_row."id");
  IF requested_verification_profile = 'production_runtime' THEN
    PERFORM public."hr_assert_scene_parser_runtime_identity_current"(
      runtime_identity."id", runtime_identity."runtime_identity_digest",
      subject_row."environment_id", subject_row."environment_digest",
      subject_row."scope_epoch_id", subject_row."venue_id",
      subject_row."space_id", check_at
    );
  END IF;
  action_at := public."hr_db_clock_ms"();
  NEW."verified_at" := action_at;
  NEW."created_at" := action_at;
  NEW."expires_at" := LEAST(
    action_at + interval '30 days', scope_row."expires_at",
    admission_role."expires_at",
    derivation_row."expires_at", member_min_expiry, transform_row."expires_at",
    twin_row."expires_at", scene_receipt."capability_expires_at",
    release_receipt."capability_expires_at", source_receipt."capability_expires_at",
    scene_receipt."denial_expires_at", release_receipt."denial_expires_at",
    source_receipt."denial_expires_at",
    COALESCE(runtime_identity."expires_at", 'infinity'::timestamptz)
  );
  IF NEW."expires_at" <= action_at
     OR action_at < scene_receipt."denial_probed_at"
     OR action_at < release_receipt."denial_probed_at"
     OR action_at < source_receipt."denial_probed_at"
     OR action_at >= admission_role."expires_at"
     OR action_at >= derivation_row."expires_at"
     OR action_at >= transform_row."expires_at"
     OR action_at >= twin_row."expires_at" THEN
    RAISE EXCEPTION 'Scene-map verification expired while acquiring authority locks'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_map_receipt_current';
  END IF;
  NEW."parser_version" := 'venviewer.scene-map-private-byte-verifier.v1';
  NEW."verification_boundary" :=
    'exact_private_scene_map_release_inventory_v1';
  NEW."verified_by_database_principal" :=
    'omnitwin_historical_evidence_verifier';

  SELECT jsonb_build_object(
    'coveredRegionIds', member.value->'coveredRegionIds',
    'authorityReference', member.value->>'authorityReference',
    'derivationMemberReceiptDigest',
      member.value->>'derivationMemberReceiptDigest',
    'derivationMemberStorageKeySha256',
      member.value->>'derivationMemberStorageKeySha256',
    'derivationOutputReceiptId',
      member.value->>'derivationOutputReceiptId',
    'assetVersionId', member.value->>'assetVersionId',
    'memberIndex', (member.value->>'memberIndex')::integer::text
  )
  INTO member_region_ids
  FROM jsonb_array_elements(NEW."ordered_members") AS member(value)
  LIMIT 1;
  coverage_digest_material := jsonb_build_object(
    'coveredTwinNodeIds', NEW."covered_twin_node_ids",
    'expectedTwinNodeIds', NEW."expected_twin_node_ids",
    'orderedMembers', (
      SELECT jsonb_agg(jsonb_build_object(
        'assetVersionId', member.value->>'assetVersionId',
        'authorityReference', member.value->>'authorityReference',
        'coveredRegionIds', member.value->'coveredRegionIds',
        'derivationMemberReceiptDigest',
          member.value->>'derivationMemberReceiptDigest',
        'derivationMemberStorageKeySha256',
          member.value->>'derivationMemberStorageKeySha256',
        'derivationOutputReceiptId',
          member.value->>'derivationOutputReceiptId',
        'memberIndex', (member.value->>'memberIndex')::integer::text
      ) ORDER BY member.ordinal)
      FROM jsonb_array_elements(NEW."ordered_members")
        WITH ORDINALITY AS member(value, ordinal)
    ),
    'orderedRegions', (
      SELECT jsonb_agg(jsonb_build_object(
        'coveredTwinNodeIds', region.value->'coveredTwinNodeIds',
        'regionId', region.value->>'regionId',
        'regionIndex', (region.value->>'regionIndex')::integer::text
      ) ORDER BY region.ordinal)
      FROM jsonb_array_elements(NEW."ordered_regions")
        WITH ORDINALITY AS region(value, ordinal)
    ),
    'referencedReleasePaths', NEW."referenced_release_paths",
    'wholeRegionIds', NEW."whole_region_ids"
  );
  NEW."verified_coverage_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-verified-scene-map-coverage.v1\n'
      || public."hr_stable_canonical_json"(coverage_digest_material),
    'UTF8'
  ), 'sha256'), 'hex');
  IF requested_verified_coverage_digest IS DISTINCT FROM
       NEW."verified_coverage_digest" THEN
    RAISE EXCEPTION 'authenticated parser coverage digest differs from DB lineage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_map_parser_coverage_digest_exact';
  END IF;

  receipt_material := jsonb_build_object(
    'admissionMemberCount', NEW."admission_member_count",
    'coveredTwinNodeIds', NEW."covered_twin_node_ids",
    'derivationEvidenceDigest', NEW."derivation_evidence_digest",
    'derivationExpiresAt', public."hr_iso_utc_ms"(NEW."derivation_expires_at"),
    'derivationId', NEW."derivation_id"::text,
    'derivationMemberCount', NEW."derivation_member_count",
    'derivationMembersDigest', NEW."derivation_members_digest",
    'environmentDigest', NEW."environment_digest",
    'environmentId', NEW."environment_id"::text,
    'environmentMode', NEW."environment_mode",
    'expectedTwinNodeIds', NEW."expected_twin_node_ids",
    'expiresAt', public."hr_iso_utc_ms"(NEW."expires_at"),
    'orderedMembers', NEW."ordered_members",
    'orderedRegions', NEW."ordered_regions",
    'parsedMapDigest', NEW."parsed_map_digest",
    'parserVersion', NEW."parser_version",
    'presentationAdmissionDigest', NEW."presentation_admission_digest",
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'presentationAdmissionReviewerAttestationDigest',
      NEW."presentation_admission_reviewer_attestation_digest",
    'presentationAdmissionReviewerAttestationExpiresAt',
      public."hr_iso_utc_ms"(
        NEW."presentation_admission_reviewer_expires_at"
      ),
    'presentationAdmissionReviewerAttestationId',
      NEW."presentation_admission_reviewer_attestation_id"::text,
    'referencedReleasePaths', NEW."referenced_release_paths",
    'releaseManifest', NEW."release_manifest_body",
    'releaseManifestByteLength', NEW."release_manifest_byte_length"::text,
    'releaseManifestObjectReceipt', NEW."release_manifest_object_receipt_body",
    'releaseManifestProviderCapabilityExpiresAt',
      public."hr_iso_utc_ms"(NEW."release_manifest_capability_expires_at"),
    'releaseManifestSha256', NEW."release_manifest_sha256",
    'releaseManifestUtf8', convert_from(NEW."release_manifest_bytes", 'UTF8'),
    'roomProjection', NEW."room_projection_body",
    'runtimeManifestDigest', NEW."runtime_manifest_digest",
    'runtimePackageContentDigest', NEW."runtime_package_content_digest",
    'runtimePackageId', NEW."runtime_package_id"::text,
    'sceneArtifactDigest', NEW."scene_artifact_digest",
    'sceneArtifactId', NEW."scene_artifact_id",
    'sceneArtifactRowId', NEW."scene_artifact_row_id"::text,
    'sceneMap', NEW."scene_map_body",
    'sceneMapByteLength', NEW."scene_map_byte_length"::text,
    'sceneMapSha256', NEW."scene_map_sha256",
    'sceneMapUtf8', convert_from(NEW."scene_map_bytes", 'UTF8')
  ) || jsonb_build_object(
    'sceneObjectReceipt', NEW."scene_object_receipt_body",
    'sceneProviderCapabilityExpiresAt',
      public."hr_iso_utc_ms"(NEW."scene_object_capability_expires_at"),
    'sceneValidationId', NEW."scene_validation_id"::text,
    'schemaVersion',
      'historical-runtime-scene-map-parser-receipt.v1',
    'scopeEpochExpiresAt', public."hr_iso_utc_ms"(NEW."scope_epoch_expires_at"),
    'scopeEpochId', NEW."scope_epoch_id"::text,
    'signedSceneAuthorityMapRef', NEW."signed_scene_authority_map_ref",
    'signedTransformArtifactRef', NEW."signed_transform_artifact_ref",
    'sourceTwinManifest', NEW."source_twin_manifest_body",
    'sourceTwinManifestByteLength', NEW."source_twin_manifest_byte_length"::text,
    'sourceTwinManifestObjectReceipt', NEW."source_twin_object_receipt_body",
    'sourceTwinManifestProviderCapabilityExpiresAt',
      public."hr_iso_utc_ms"(NEW."source_twin_capability_expires_at"),
    'sourceTwinManifestReleaseObjectPath',
      NEW."source_twin_manifest_release_object_path",
    'sourceTwinManifestSha256', NEW."source_twin_manifest_sha256",
    'sourceTwinManifestUtf8', convert_from(NEW."source_twin_manifest_bytes", 'UTF8'),
    'spaceId', NEW."space_id"::text,
    'spaceSlug', NEW."space_slug",
    'transformArtifactDigest', NEW."transform_artifact_digest",
    'transformArtifactId', NEW."transform_artifact_id",
    'transformArtifactRowId', NEW."transform_artifact_row_id"::text,
    'transformReviewDigest', NEW."transform_review_digest",
    'transformReviewExpiresAt',
      public."hr_iso_utc_ms"(NEW."transform_review_expires_at"),
    'transformReviewId', NEW."transform_review_id"::text,
    'twinReleaseAuthorityDigest', NEW."twin_release_authority_digest",
    'twinReleaseAuthorityExpiresAt',
      public."hr_iso_utc_ms"(NEW."twin_release_authority_expires_at"),
    'twinReleaseAuthorityReceiptId', NEW."twin_release_authority_id"::text,
    'twinReleaseDigest', NEW."twin_release_digest",
    'twinReleaseId', NEW."twin_release_id"::text,
    'twinReleaseManifestDigest', NEW."twin_release_manifest_digest",
    'venueId', NEW."venue_id"::text,
    'venueSlug', NEW."venue_slug",
    'verificationBoundary', NEW."verification_boundary",
    'verificationReceiptId', NEW."id"::text,
    'verifiedAt', public."hr_iso_utc_ms"(NEW."verified_at"),
    'verifiedByDatabasePrincipal', NEW."verified_by_database_principal",
    'verifiedCoverageDigest', NEW."verified_coverage_digest",
    'wholeRegionIds', NEW."whole_region_ids"
  ) || jsonb_build_object(
    'authenticatedTwinRelease', jsonb_build_object(
      'envelopeByteLength', NEW."twin_envelope_byte_length"::text,
      'envelopeSha256', NEW."twin_envelope_sha256",
      'keyId', NEW."twin_key_id",
      'payloadByteLength', NEW."twin_payload_byte_length"::text,
      'payloadSha256', NEW."twin_payload_sha256",
      'payloadType', NEW."twin_payload_type",
      'predicateDigest', NEW."twin_predicate_digest",
      'publicKeyFingerprint', NEW."twin_public_key_fingerprint",
      'statementSha256', NEW."twin_statement_sha256"
    ),
    'expandedRegionNodeReferenceCount',
      NEW."expanded_region_node_reference_count"::text,
    'normalizedProjectionByteLength',
      NEW."normalized_projection_byte_length"::text,
    'parserImplementationManifestDigest',
      NEW."parser_implementation_manifest_digest",
    'parserPolicyDigest', NEW."parser_policy_digest",
    'parserRuntimeDeploymentImageDigest',
      NEW."parser_runtime_deployment_image_digest",
    'parserRuntimeExecutableArtifactDigest',
      NEW."parser_runtime_executable_artifact_digest",
    'parserRuntimeIdentityDigest', NEW."parser_runtime_identity_digest",
    'parserRuntimeIdentityEffectiveAt', CASE
      WHEN NEW."parser_runtime_identity_effective_at" IS NULL THEN NULL
      ELSE public."hr_iso_utc_ms"(NEW."parser_runtime_identity_effective_at")
    END,
    'parserRuntimeIdentityExpiresAt', CASE
      WHEN NEW."parser_runtime_identity_expires_at" IS NULL THEN NULL
      ELSE public."hr_iso_utc_ms"(NEW."parser_runtime_identity_expires_at")
    END,
    'parserRuntimeIdentityId', NEW."parser_runtime_identity_id"::text,
    'parserRuntimeSessionPrincipalSha256',
      NEW."parser_runtime_session_principal_sha256",
    'parserRuntimeVerifierCapabilityPrincipal', CASE
      WHEN NEW."verification_profile" = 'production_runtime'
        THEN NEW."verified_by_database_principal"
      ELSE NULL
    END,
    'parserVersion', NEW."parser_version",
    'verificationProfile', NEW."verification_profile"
  );
  receipt_digest_material := receipt_material
    - 'sceneMap' - 'sceneMapUtf8'
    - 'releaseManifest' - 'releaseManifestUtf8'
    - 'sourceTwinManifest' - 'sourceTwinManifestUtf8'
    - 'sceneObjectReceipt' - 'releaseManifestObjectReceipt'
    - 'sourceTwinManifestObjectReceipt'
    || jsonb_build_object(
      'admissionMemberCount', NEW."admission_member_count"::text,
      'derivationMemberCount', NEW."derivation_member_count"::text,
      'orderedMembers', (
        SELECT jsonb_agg(jsonb_build_object(
          'admissionRightsDecision', member.value->>'admissionRightsDecision',
          'admissionRightsEvidenceDigest',
            member.value->>'admissionRightsEvidenceDigest',
          'admissionRightsEvidenceRowId',
            member.value->>'admissionRightsEvidenceRowId',
          'admissionRightsReviewedAt',
            member.value->>'admissionRightsReviewedAt',
          'admissionRightsReviewedBy',
            member.value->>'admissionRightsReviewedBy',
          'assetVersionId', member.value->>'assetVersionId',
          'authorityReference', member.value->>'authorityReference',
          'coveredRegionIds', member.value->'coveredRegionIds',
          'derivationMemberReceiptDigest',
            member.value->>'derivationMemberReceiptDigest',
          'derivationMemberReceiptExpiresAt',
            member.value->>'derivationMemberReceiptExpiresAt',
          'derivationMemberStorageKeySha256',
            member.value->>'derivationMemberStorageKeySha256',
          'derivationOutputReceiptId',
            member.value->>'derivationOutputReceiptId',
          'fileExt', member.value->>'fileExt',
          'fileName', member.value->>'fileName',
          'memberIndex', (member.value->>'memberIndex')::integer::text,
          'mimeType', member.value->>'mimeType',
          'sha256', member.value->>'sha256',
          'sizeBytes', (member.value->>'sizeBytes')::bigint::text
        ) ORDER BY member.ordinal)
        FROM jsonb_array_elements(NEW."ordered_members")
          WITH ORDINALITY AS member(value, ordinal)
      ),
      'orderedRegions', (
        SELECT jsonb_agg(jsonb_build_object(
          'coveredTwinNodeIds', region.value->'coveredTwinNodeIds',
          'regionId', region.value->>'regionId',
          'regionIndex', (region.value->>'regionIndex')::integer::text
        ) ORDER BY region.ordinal)
        FROM jsonb_array_elements(NEW."ordered_regions")
          WITH ORDINALITY AS region(value, ordinal)
      ),
      'sceneObjectIdentity', jsonb_build_object(
        'capabilityDigest', NEW."scene_object_capability_digest",
        'capabilityReceiptId', NEW."scene_object_capability_id"::text,
        'denialExpiresAt',
          public."hr_iso_utc_ms"(NEW."scene_object_receipt_expires_at"),
        'objectSha256', NEW."scene_object_sha256",
        'objectSizeBytes', NEW."scene_object_size_bytes"::text,
        'receiptDigest', NEW."scene_object_receipt_digest",
        'receiptId', NEW."scene_object_receipt_id"::text
      ),
      'releaseManifestObjectIdentity', jsonb_build_object(
        'capabilityDigest', NEW."release_manifest_capability_digest",
        'capabilityReceiptId', NEW."release_manifest_capability_id"::text,
        'denialExpiresAt',
          public."hr_iso_utc_ms"(NEW."release_manifest_receipt_expires_at"),
        'objectSha256', NEW."release_manifest_object_sha256",
        'objectSizeBytes', NEW."release_manifest_object_size_bytes"::text,
        'receiptDigest', NEW."release_manifest_object_receipt_digest",
        'receiptId', NEW."release_manifest_object_receipt_id"::text
      ),
      'sourceTwinManifestObjectIdentity', jsonb_build_object(
        'capabilityDigest', NEW."source_twin_capability_digest",
        'capabilityReceiptId', NEW."source_twin_capability_id"::text,
        'denialExpiresAt',
          public."hr_iso_utc_ms"(NEW."source_twin_receipt_expires_at"),
        'objectSha256', NEW."source_twin_object_sha256",
        'objectSizeBytes', NEW."source_twin_object_size_bytes"::text,
        'receiptDigest', NEW."source_twin_object_receipt_digest",
        'receiptId', NEW."source_twin_object_receipt_id"::text
      )
    );
  NEW."parser_digest_material" := receipt_digest_material;
  NEW."scene_map_verification_receipt_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-map-parser-receipt.v1\n'
      || public."hr_stable_canonical_json"(receipt_digest_material),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."scene_map_verification_receipt_body" := receipt_material ||
    jsonb_build_object(
      'sceneMapVerificationReceiptDigest',
        NEW."scene_map_verification_receipt_digest"
    );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_accept_verified_scene_map_receipt"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  handle_id uuid := gen_random_uuid();
  handle_body jsonb;
  handle_digest text;
BEGIN
  handle_body := jsonb_build_object(
    'acceptedAt', public."hr_iso_utc_ms"(NEW."verified_at"),
    'derivationExpiresAt', public."hr_iso_utc_ms"(NEW."derivation_expires_at"),
    'derivationId', NEW."derivation_id"::text,
    'expiresAt', public."hr_iso_utc_ms"(NEW."expires_at"),
    'parserImplementationManifestDigest',
      NEW."parser_implementation_manifest_digest",
    'parserPolicyDigest', NEW."parser_policy_digest",
    'parserReceiptDigest', NEW."scene_map_verification_receipt_digest",
    'parserReceiptId', NEW."id"::text,
    'parserRuntimeDeploymentImageDigest',
      NEW."parser_runtime_deployment_image_digest",
    'parserRuntimeExecutableArtifactDigest',
      NEW."parser_runtime_executable_artifact_digest",
    'parserRuntimeIdentityDigest', NEW."parser_runtime_identity_digest",
    'parserRuntimeIdentityEffectiveAt', CASE
      WHEN NEW."parser_runtime_identity_effective_at" IS NULL THEN NULL
      ELSE public."hr_iso_utc_ms"(NEW."parser_runtime_identity_effective_at")
    END,
    'parserRuntimeIdentityExpiresAt', CASE
      WHEN NEW."parser_runtime_identity_expires_at" IS NULL THEN NULL
      ELSE public."hr_iso_utc_ms"(NEW."parser_runtime_identity_expires_at")
    END,
    'parserRuntimeIdentityId', NEW."parser_runtime_identity_id"::text,
    'parserRuntimeSessionPrincipalSha256',
      NEW."parser_runtime_session_principal_sha256",
    'parserRuntimeVerifierCapabilityPrincipal', CASE
      WHEN NEW."verification_profile" = 'production_runtime'
        THEN NEW."verified_by_database_principal"
      ELSE NULL
    END,
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'presentationAdmissionReviewerAttestationDigest',
      NEW."presentation_admission_reviewer_attestation_digest",
    'presentationAdmissionReviewerAttestationExpiresAt',
      public."hr_iso_utc_ms"(
        NEW."presentation_admission_reviewer_expires_at"
      ),
    'presentationAdmissionReviewerAttestationId',
      NEW."presentation_admission_reviewer_attestation_id"::text,
    'sceneArtifactRowId', NEW."scene_artifact_row_id"::text,
    'sceneObjectReceiptDigest', NEW."scene_object_receipt_digest",
    'sceneObjectReceiptId', NEW."scene_object_receipt_id"::text,
    'sceneProviderCapabilityExpiresAt',
      public."hr_iso_utc_ms"(NEW."scene_object_capability_expires_at"),
    'sceneMapVerificationReceiptId', handle_id::text,
    'sceneValidationId', NEW."scene_validation_id"::text,
    'schemaVersion',
      'historical-runtime-scene-map-verification-handle.v1',
    'transformReviewExpiresAt',
      public."hr_iso_utc_ms"(NEW."transform_review_expires_at"),
    'transformReviewId', NEW."transform_review_id"::text,
    'twinReleaseAuthorityDigest', NEW."twin_release_authority_digest",
    'twinReleaseAuthorityExpiresAt',
      public."hr_iso_utc_ms"(NEW."twin_release_authority_expires_at"),
    'twinReleaseAuthorityReceiptId', NEW."twin_release_authority_id"::text,
    'twinReleaseDigest', NEW."twin_release_digest",
    'verificationProfile', NEW."verification_profile"
  );
  handle_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-map-verification-handle.v1\n'
      || public."hr_stable_canonical_json"(handle_body), 'UTF8'
  ), 'sha256'), 'hex');
  INSERT INTO public."hr_verified_scene_map_receipts" (
    "id", "parser_receipt_id", "scene_validation_id", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "presentation_admission_id", "derivation_id",
    "transform_review_id", "twin_release_authority_id",
    "scene_artifact_row_id", "scene_object_receipt_id",
    "scene_object_receipt_digest",
    "presentation_admission_reviewer_attestation_id",
    "presentation_admission_reviewer_attestation_digest",
    "presentation_admission_reviewer_expires_at", "derivation_expires_at",
    "transform_review_expires_at", "twin_release_authority_digest",
    "twin_release_authority_expires_at", "twin_release_digest",
    "scene_object_capability_expires_at", "parser_receipt_digest",
    "verification_profile", "parser_policy_digest",
    "parser_implementation_manifest_digest", "parser_runtime_identity_id",
    "parser_runtime_identity_digest", "parser_runtime_identity_effective_at",
    "parser_runtime_identity_expires_at",
    "parser_runtime_executable_artifact_digest",
    "parser_runtime_deployment_image_digest",
    "parser_runtime_verifier_capability_principal",
    "parser_runtime_session_principal_sha256", "parser_verified_at",
    "expires_at", "scene_map_verification_receipt_digest",
    "scene_map_verification_receipt_body", "created_at"
  ) VALUES (
    handle_id, NEW."id", NEW."scene_validation_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."scope_epoch_id",
    NEW."venue_id", NEW."space_id", NEW."presentation_admission_id",
    NEW."derivation_id", NEW."transform_review_id",
    NEW."twin_release_authority_id", NEW."scene_artifact_row_id",
    NEW."scene_object_receipt_id", NEW."scene_object_receipt_digest",
    NEW."presentation_admission_reviewer_attestation_id",
    NEW."presentation_admission_reviewer_attestation_digest",
    NEW."presentation_admission_reviewer_expires_at",
    NEW."derivation_expires_at", NEW."transform_review_expires_at",
    NEW."twin_release_authority_digest",
    NEW."twin_release_authority_expires_at", NEW."twin_release_digest",
    NEW."scene_object_capability_expires_at",
    NEW."scene_map_verification_receipt_digest",
    NEW."verification_profile", NEW."parser_policy_digest",
    NEW."parser_implementation_manifest_digest", NEW."parser_runtime_identity_id",
    NEW."parser_runtime_identity_digest", NEW."parser_runtime_identity_effective_at",
    NEW."parser_runtime_identity_expires_at",
    NEW."parser_runtime_executable_artifact_digest",
    NEW."parser_runtime_deployment_image_digest", CASE
      WHEN NEW."verification_profile" = 'production_runtime'
        THEN NEW."verified_by_database_principal"
      ELSE NULL
    END,
    NEW."parser_runtime_session_principal_sha256", NEW."verified_at",
    NEW."expires_at", handle_digest,
    handle_body || jsonb_build_object(
      'sceneMapVerificationReceiptDigest', handle_digest
    ),
    NEW."verified_at"
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "b_hr_issue_scene_map_parser_receipt"
  BEFORE INSERT ON "hr_scene_map_parser_receipts"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_scene_map_parser_receipt"();
CREATE TRIGGER "c_hr_accept_verified_scene_map_receipt"
  AFTER INSERT ON "hr_scene_map_parser_receipts"
  FOR EACH ROW EXECUTE FUNCTION "hr_accept_verified_scene_map_receipt"();
-- Scene subjects and final receipts contain DB action times inside their
-- canonical digests. The verifier supplies the private bytes and normalized
-- coverage candidates, but this boundary revalidates every immutable leaf,
-- chooses one DB-owned action instant after locks, and constructs the exact
-- TS-domain body/digest. The deferred graph guard then proves the supplied
-- child rows are exactly the ordered coverage committed by that body.
CREATE OR REPLACE FUNCTION "hr_issue_scene_validation_subject"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz;
  action_at timestamptz;
  subject_row "hr_evidence_subjects"%ROWTYPE;
  receipt_row "hr_object_receipts"%ROWTYPE;
  verification_handle "hr_verified_scene_map_receipts"%ROWTYPE;
  verification_receipt "hr_scene_map_parser_receipts"%ROWTYPE;
  derivation_row "hr_derivations"%ROWTYPE;
  derivation_member "hr_derivation_members"%ROWTYPE;
  test_twin "hr_twin_release_authorities"%ROWTYPE;
  verified_twin "hr_verified_twin_release_authorities"%ROWTYPE;
  coverage_input jsonb;
  record_identity record;
  member_entry record;
  member_regions jsonb;
  whole_regions jsonb;
  ordered_members jsonb := '[]'::jsonb;
  room_scope_basis_body jsonb;
  coverage_body jsonb;
  subject_material jsonb;
  receipt_id uuid;
BEGIN
  -- The generic subject is the only scope discovery input. Never let caller
  -- staging choose a lock key or cross-wire the production evidence scope.
  SELECT * INTO STRICT subject_row
  FROM "hr_evidence_subjects"
  WHERE "id" = NEW."id"
    AND "subject_kind" = 'scene_validation';
  NEW."subject_kind" := subject_row."subject_kind";
  NEW."environment_id" := subject_row."environment_id";
  NEW."environment_mode" := subject_row."environment_mode";
  NEW."environment_digest" := subject_row."environment_digest";
  NEW."scope_epoch_id" := subject_row."scope_epoch_id";
  NEW."venue_id" := subject_row."venue_id";
  NEW."space_id" := subject_row."space_id";
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_lock_authority"('scene-validation', NEW."id"::text);
  SELECT * INTO STRICT subject_row
  FROM "hr_evidence_subjects"
  WHERE "id" = NEW."id"
    AND "subject_kind" = 'scene_validation'
    AND "environment_id" = NEW."environment_id"
    AND "environment_mode" = NEW."environment_mode"
    AND "environment_digest" = NEW."environment_digest"
    AND "scope_epoch_id" = NEW."scope_epoch_id"
    AND "venue_id" = NEW."venue_id"
    AND "space_id" = NEW."space_id"
  FOR SHARE;

  IF NEW."scene_map_verification_receipt_id" IS NULL THEN
    RAISE EXCEPTION 'Scene requires an accepted map-verification handle'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_subject_verification_receipt_required';
  END IF;
  PERFORM "hr_lock_authority"(
    'scene-map-verification-handle',
    NEW."scene_map_verification_receipt_id"::text
  );
  SELECT * INTO STRICT verification_handle
  FROM "hr_verified_scene_map_receipts"
  WHERE "id" = NEW."scene_map_verification_receipt_id"
    AND "scene_validation_id" = NEW."id"
    AND "environment_id" = subject_row."environment_id"
    AND "environment_mode" = subject_row."environment_mode"
    AND "environment_digest" = subject_row."environment_digest"
    AND "scope_epoch_id" = subject_row."scope_epoch_id"
    AND "venue_id" = subject_row."venue_id"
    AND "space_id" = subject_row."space_id"
  FOR SHARE;
  PERFORM "hr_lock_authority"(
    'scene-map-parser-receipt', verification_handle."parser_receipt_id"::text
  );
  SELECT parser.* INTO STRICT verification_receipt
  FROM "hr_scene_map_parser_receipts" AS parser
  WHERE parser."id" = verification_handle."parser_receipt_id"
    AND parser."scene_validation_id" = NEW."id"
    AND parser."environment_id" = subject_row."environment_id"
    AND parser."environment_mode" = subject_row."environment_mode"
    AND parser."environment_digest" = subject_row."environment_digest"
    AND parser."scope_epoch_id" = subject_row."scope_epoch_id"
    AND parser."venue_id" = subject_row."venue_id"
    AND parser."space_id" = subject_row."space_id"
    AND parser."scene_map_verification_receipt_digest" =
      verification_handle."parser_receipt_digest"
    AND parser."verification_profile" =
      verification_handle."verification_profile"
  FOR SHARE OF parser;

    -- Both production and local-test Scene rows accept only the compact handle.
    -- Every byte body and normalized projection is rehydrated from its exact
    -- verifier-authenticated parser leaf; caller staging cannot survive.
    NEW."venue_slug" := verification_receipt."venue_slug";
    NEW."space_slug" := verification_receipt."space_slug";
    NEW."presentation_admission_id" :=
      verification_receipt."presentation_admission_id";
    NEW."presentation_admission_digest" :=
      verification_receipt."presentation_admission_digest";
    NEW."runtime_package_id" := verification_receipt."runtime_package_id";
    NEW."runtime_package_content_digest" :=
      verification_receipt."runtime_package_content_digest";
    NEW."runtime_manifest_digest" :=
      verification_receipt."runtime_manifest_digest";
    NEW."admission_member_count" :=
      verification_receipt."admission_member_count";
    NEW."derivation_id" := verification_receipt."derivation_id";
    NEW."derivation_evidence_digest" :=
      verification_receipt."derivation_evidence_digest";
    NEW."derivation_expires_at" := verification_receipt."derivation_expires_at";
    NEW."scene_artifact_row_id" := verification_receipt."scene_artifact_row_id";
    NEW."scene_artifact_kind" := verification_receipt."scene_artifact_kind";
    NEW."scene_artifact_id" := verification_receipt."scene_artifact_id";
    NEW."scene_artifact_digest" := verification_receipt."scene_artifact_digest";
    NEW."scene_registry_object_key" :=
      verification_receipt."scene_registry_object_key";
    NEW."scene_registry_object_sha256" :=
      verification_receipt."scene_registry_object_sha256";
    NEW."scene_registry_object_size_bytes" :=
      verification_receipt."scene_registry_object_size_bytes";
    NEW."scene_registry_schema_version" :=
      verification_receipt."scene_registry_schema_version";
    NEW."scene_registry_registered_by" :=
      verification_receipt."scene_registry_registered_by";
    NEW."scene_registry_registered_at" :=
      verification_receipt."scene_registry_registered_at";
    NEW."scene_object_receipt_id" :=
      verification_receipt."scene_object_receipt_id";
    NEW."scene_object_receipt_digest" :=
      verification_receipt."scene_object_receipt_digest";
    NEW."scene_capability_id" := verification_receipt."scene_object_capability_id";
    NEW."scene_capability_digest" :=
      verification_receipt."scene_object_capability_digest";
    NEW."scene_capability_expires_at" :=
      verification_receipt."scene_object_capability_expires_at";
    NEW."scene_receipt_expires_at" :=
      verification_receipt."scene_object_receipt_expires_at";
    NEW."scene_raw_bytes" := verification_receipt."scene_map_bytes";
    NEW."scene_parsed_map_body" := verification_receipt."scene_map_body";
    NEW."parsed_map_digest" := verification_receipt."parsed_map_digest";
    NEW."scene_map_verification_receipt_id" := verification_handle."id";
    NEW."scene_map_verification_receipt_digest" :=
      verification_handle."scene_map_verification_receipt_digest";
    NEW."scene_map_verification_receipt_expires_at" :=
      verification_handle."expires_at";
    NEW."scene_map_verification_receipt_body" :=
      verification_handle."scene_map_verification_receipt_body";
    NEW."scene_map_parser_receipt_id" := verification_receipt."id";
    NEW."scene_map_parser_receipt_digest" :=
      verification_receipt."scene_map_verification_receipt_digest";
    NEW."scene_map_parser_receipt_expires_at" :=
      verification_receipt."expires_at";
    NEW."scene_map_verification_profile" :=
      verification_receipt."verification_profile";
    NEW."scene_map_parser_policy_digest" :=
      verification_receipt."parser_policy_digest";
    NEW."scene_map_parser_implementation_manifest_digest" :=
      verification_receipt."parser_implementation_manifest_digest";
    NEW."scene_map_parser_runtime_identity_id" :=
      verification_receipt."parser_runtime_identity_id";
    NEW."scene_map_parser_runtime_identity_digest" :=
      verification_receipt."parser_runtime_identity_digest";
    NEW."scene_map_parser_runtime_identity_effective_at" :=
      verification_receipt."parser_runtime_identity_effective_at";
    NEW."scene_map_parser_runtime_identity_expires_at" :=
      verification_receipt."parser_runtime_identity_expires_at";
    NEW."scene_map_parser_runtime_executable_artifact_digest" :=
      verification_receipt."parser_runtime_executable_artifact_digest";
    NEW."scene_map_parser_runtime_deployment_image_digest" :=
      verification_receipt."parser_runtime_deployment_image_digest";
    NEW."scene_map_parser_runtime_verifier_capability_principal" := CASE
      WHEN verification_receipt."verification_profile" = 'production_runtime'
        THEN verification_receipt."verified_by_database_principal"
      ELSE NULL
    END;
    NEW."scene_map_parser_runtime_session_principal_sha256" :=
      verification_receipt."parser_runtime_session_principal_sha256";
    NEW."presentation_admission_reviewer_attestation_id" :=
      verification_receipt."presentation_admission_reviewer_attestation_id";
    NEW."presentation_admission_reviewer_attestation_digest" :=
      verification_receipt."presentation_admission_reviewer_attestation_digest";
    NEW."admission_reviewer_subject_id" :=
      verification_receipt."presentation_admission_reviewer_subject_id";
    NEW."presentation_admission_reviewer_actor_id" :=
      verification_receipt."presentation_admission_reviewer_actor_id";
    NEW."presentation_admission_reviewer_effective_at" :=
      verification_receipt."presentation_admission_reviewer_effective_at";
    NEW."presentation_admission_reviewer_expires_at" :=
      verification_receipt."presentation_admission_reviewer_expires_at";
    NEW."transform_review_id" := verification_receipt."transform_review_id";
    NEW."transform_artifact_row_id" :=
      verification_receipt."transform_artifact_row_id";
    NEW."transform_review_subject_digest" :=
      verification_receipt."transform_review_subject_digest";
    NEW."transform_review_digest" :=
      verification_receipt."transform_review_digest";
    NEW."transform_reviewer_actor_id" :=
      verification_receipt."transform_reviewer_actor_id";
    NEW."transform_review_expires_at" :=
      verification_receipt."transform_review_expires_at";
    NEW."twin_release_authority_id" :=
      verification_receipt."twin_release_authority_id";
    NEW."twin_release_id" := verification_receipt."twin_release_id";
    NEW."twin_release_digest" := verification_receipt."twin_release_digest";
    NEW."twin_release_manifest_digest" :=
      verification_receipt."twin_release_manifest_digest";
    NEW."twin_release_authority_digest" :=
      verification_receipt."twin_release_authority_digest";
    NEW."twin_release_authority_actor_id" :=
      verification_receipt."twin_release_authority_actor_id";
    NEW."twin_release_authority_expires_at" :=
      verification_receipt."twin_release_authority_expires_at";
    coverage_input := jsonb_build_object(
      'orderedMembers', verification_receipt."ordered_members"
    );
    whole_regions := verification_receipt."whole_region_ids";

  IF NEW."environment_mode" = 'test' THEN
    SELECT * INTO STRICT test_twin
    FROM "hr_twin_release_authorities"
    WHERE "id" = NEW."twin_release_authority_id"
      AND "subject_id" = NEW."id"
    FOR SHARE;
    NEW."twin_release_id" := test_twin."release_id";
    NEW."twin_release_digest" := test_twin."release_digest";
    NEW."twin_release_manifest_digest" :=
      test_twin."release_manifest_sha256";
    NEW."twin_release_authority_digest" :=
      test_twin."twin_release_authority_digest";
    NEW."twin_release_authority_actor_id" :=
      test_twin."approved_by_actor_id";
    NEW."twin_release_authority_expires_at" := test_twin."expires_at";
  ELSIF NEW."environment_mode" = 'production' THEN
    SELECT * INTO STRICT verified_twin
    FROM "hr_verified_twin_release_authorities"
    WHERE "id" = NEW."twin_release_authority_id"
      AND "subject_id" = NEW."id"
    FOR SHARE;
    NEW."twin_release_id" := verified_twin."release_id";
    NEW."twin_release_digest" := verified_twin."release_digest";
    NEW."twin_release_manifest_digest" :=
      verified_twin."release_manifest_sha256";
    NEW."twin_release_authority_digest" :=
      verified_twin."twin_release_authority_digest";
    NEW."twin_release_authority_actor_id" :=
      verified_twin."approval_actor_id";
    NEW."twin_release_authority_expires_at" := verified_twin."expires_at";
  ELSE
    RAISE EXCEPTION 'Scene evidence environment is unsupported'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_twin_environment';
  END IF;
  SELECT * INTO STRICT derivation_row
  FROM "hr_derivations"
  WHERE "id" = NEW."derivation_id"
  FOR SHARE;
  IF derivation_row."member_count" <> NEW."admission_member_count" THEN
    RAISE EXCEPTION 'Scene derivation does not equal the admission member graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_derivation_member_count';
  END IF;
  SELECT * INTO STRICT receipt_row
  FROM "hr_object_receipts"
  WHERE "id" = NEW."scene_object_receipt_id"
  FOR SHARE;
  NEW."scene_object_receipt_digest" := receipt_row."receipt_digest";
  NEW."scene_capability_id" := receipt_row."capability_id";
  NEW."scene_capability_digest" := receipt_row."capability_digest";
  NEW."scene_capability_expires_at" := receipt_row."capability_expires_at";
  NEW."scene_provider_profile" := receipt_row."provider_profile";
  NEW."scene_provider_kind" := receipt_row."provider_kind";
  NEW."scene_provider_account_sha256" := receipt_row."provider_account_sha256";
  NEW."scene_endpoint_authority_sha256" :=
    receipt_row."endpoint_authority_sha256";
  NEW."scene_private_bucket_sha256" := receipt_row."private_bucket_sha256";
  NEW."scene_storage_key_sha256" := receipt_row."storage_key_sha256";
  NEW."scene_version_kind" := receipt_row."version_kind";
  NEW."scene_storage_version" := receipt_row."storage_version";
  NEW."scene_storage_etag" := receipt_row."storage_etag";
  NEW."scene_file_name" := receipt_row."file_name";
  NEW."scene_mime_type" := receipt_row."mime_type";
  NEW."scene_receipt_expires_at" := receipt_row."denial_expires_at";
  IF jsonb_typeof(coverage_input) <> 'object'
     OR jsonb_typeof(coverage_input->'orderedMembers') <> 'array'
     OR jsonb_array_length(coverage_input->'orderedMembers')
        NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Scene coverage staging material is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_coverage_staging_shape';
  END IF;

  IF jsonb_typeof(whole_regions) <> 'array'
     OR jsonb_array_length(whole_regions) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Scene parsed map has no complete room-region set'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_parsed_map_shape';
  END IF;
  FOR member_entry IN
    SELECT member.value, (member.ordinal - 1)::integer AS member_index
    FROM jsonb_array_elements(
      coverage_input->'orderedMembers'
    ) WITH ORDINALITY AS member(value, ordinal)
    ORDER BY member.ordinal
  LOOP
    IF jsonb_typeof(member_entry.value) <> 'object'
       OR (member_entry.value->>'memberIndex')::integer <>
          member_entry.member_index
       OR length(btrim(member_entry.value->>'authorityReference'))
          NOT BETWEEN 1 AND 1024 THEN
      RAISE EXCEPTION 'Scene member authority staging is not dense and typed'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_member_authority_staging';
    END IF;
    member_regions := member_entry.value->'coveredRegionIds';
    IF jsonb_typeof(member_regions) <> 'array'
       OR jsonb_array_length(member_regions) = 0 THEN
      RAISE EXCEPTION 'Scene member authority reference is absent from parsed map'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_member_authority_reference';
    END IF;
    SELECT * INTO STRICT derivation_member
    FROM "hr_derivation_members"
    WHERE "derivation_id" = derivation_row."id"
      AND "member_index" = member_entry.member_index
    FOR SHARE;
    IF (
      (member_entry.value->>'assetVersionId')::uuid IS DISTINCT FROM
        derivation_member."asset_version_id"
      OR (member_entry.value->>'derivationOutputReceiptId')::uuid IS DISTINCT FROM
        derivation_member."output_receipt_id"
      OR member_entry.value->>'derivationMemberReceiptDigest' IS DISTINCT FROM
        derivation_member."output_receipt_digest"
    ) THEN
      RAISE EXCEPTION 'verified Scene member projection differs from derivation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_subject_verified_member';
    END IF;
    ordered_members := ordered_members || jsonb_build_array(
      jsonb_build_object(
        'assetVersionId', derivation_member."asset_version_id"::text,
        'authorityReference', member_entry.value->>'authorityReference',
        'coveredRegionIds', member_regions,
        'derivationOutputReceiptId',
          derivation_member."output_receipt_id"::text,
        'derivationMemberReceiptDigest',
          derivation_member."output_receipt_digest",
        'memberIndex', member_entry.member_index
      )
    );
  END LOOP;

  -- Sample currentness only after the complete deterministic lock set is
  -- held, then re-run every constituent check at that single wall instant.
  check_at := "hr_wall_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (NEW."derivation_id", 'derivation'::text),
      (NEW."transform_review_id", 'transform_review'::text),
      (NEW."twin_release_authority_id", 'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind, NEW."environment_id",
      NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
      NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_current"(
    NEW."derivation_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    NEW."transform_review_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_twin_release_authority_current"(
    NEW."twin_release_authority_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    NEW."presentation_admission_reviewer_attestation_id",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    NEW."presentation_admission_reviewer_attestation_id",
    NEW."presentation_admission_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    verification_handle."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT NEW."scene_object_receipt_id" AS id
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = derivation_row."id"
      UNION
      SELECT verification_receipt."release_manifest_object_receipt_id"
      UNION
      SELECT verification_receipt."source_twin_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_graph_complete"(derivation_row."id");
  PERFORM "hr_assert_runtime_presentation_admission_members_exact"(
    NEW."presentation_admission_id", derivation_row."id"
  );
  -- The preceding pass acquired every protected authority lock. Re-sample and
  -- repeat the complete graph so a wait cannot preserve an earlier instant.
  check_at := "hr_wall_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (NEW."derivation_id", 'derivation'::text),
      (NEW."transform_review_id", 'transform_review'::text),
      (NEW."twin_release_authority_id", 'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind, NEW."environment_id",
      NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
      NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_current"(
    NEW."derivation_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    NEW."transform_review_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_twin_release_authority_current"(
    NEW."twin_release_authority_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    NEW."presentation_admission_reviewer_attestation_id",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    NEW."presentation_admission_reviewer_attestation_id",
    NEW."presentation_admission_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    verification_handle."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR receipt_id IN
    SELECT candidate.id
    FROM (
      SELECT NEW."scene_object_receipt_id" AS id
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = derivation_row."id"
      UNION
      SELECT verification_receipt."release_manifest_object_receipt_id"
      UNION
      SELECT verification_receipt."source_twin_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_graph_complete"(derivation_row."id");
  PERFORM "hr_assert_runtime_presentation_admission_members_exact"(
    NEW."presentation_admission_id", derivation_row."id"
  );
  action_at := "hr_db_clock_ms"();
  NEW."subject_kind" := 'scene_validation';
  NEW."derivation_evidence_digest" :=
    derivation_row."derivation_evidence_digest";
  NEW."derivation_expires_at" := derivation_row."expires_at";
  NEW."coverage_decision" := 'whole_room_and_all_runtime_members_covered';
  NEW."whole_region_count" := jsonb_array_length(whole_regions);
  NEW."member_count" := jsonb_array_length(ordered_members);
  NEW."created_at" := action_at;
  NEW."validated_at" := action_at;
  NEW."authority_expires_at" := LEAST(
    NEW."presentation_admission_reviewer_expires_at",
    NEW."derivation_expires_at", NEW."transform_review_expires_at",
    NEW."twin_release_authority_expires_at",
    NEW."scene_capability_expires_at", NEW."scene_receipt_expires_at",
    COALESCE(NEW."scene_map_verification_receipt_expires_at", 'infinity')
  );
  IF NEW."authority_expires_at" <= action_at
     OR action_at < (
       receipt_row."receipt_body"->'anonymousAccessDenial'->>'probedAt'
     )::timestamptz
     OR action_at < verification_receipt."verified_at" THEN
    RAISE EXCEPTION 'Scene subject authority is expired or precedes byte custody'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_subject_current';
  END IF;

  room_scope_basis_body := jsonb_build_object(
    'derivationEvidenceDigest', NEW."derivation_evidence_digest",
    'derivationId', NEW."derivation_id"::text,
    'presentationAdmissionDigest', NEW."presentation_admission_digest",
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'runtimeManifestDigest', NEW."runtime_manifest_digest",
    'runtimePackageContentDigest', NEW."runtime_package_content_digest",
    'runtimePackageId', NEW."runtime_package_id"::text,
    'sceneArtifactDigest', NEW."scene_artifact_digest",
    'sceneArtifactRowId', NEW."scene_artifact_row_id"::text,
    'schemaVersion', 'historical-runtime-room-scope-basis.v1',
    'spaceId', NEW."space_id"::text,
    'transformReviewDigest', NEW."transform_review_digest",
    'transformReviewId', NEW."transform_review_id"::text,
    'twinReleaseId', NEW."twin_release_id"::text,
    'twinReleaseManifestDigest', NEW."twin_release_manifest_digest",
    'venueId', NEW."venue_id"::text
  );
  NEW."room_scope_basis_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-room-scope-basis.v1\n'
      || "hr_stable_canonical_json"(room_scope_basis_body), 'UTF8'
  ), 'sha256'), 'hex');
  coverage_body := jsonb_build_object(
    'coverageDecision', NEW."coverage_decision",
    'derivationEvidenceDigest', NEW."derivation_evidence_digest",
    'derivationId', NEW."derivation_id"::text,
    'orderedMembers', ordered_members,
    'presentationAdmissionDigest', NEW."presentation_admission_digest",
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'roomScopeBasis', room_scope_basis_body,
    'roomScopeBasisDigest', NEW."room_scope_basis_digest",
    'runtimeManifestDigest', NEW."runtime_manifest_digest",
    'runtimePackageContentDigest', NEW."runtime_package_content_digest",
    'runtimePackageId', NEW."runtime_package_id"::text,
    'spaceId', NEW."space_id"::text,
    'transformReviewDigest', NEW."transform_review_digest",
    'transformReviewId', NEW."transform_review_id"::text,
    'twinReleaseId', NEW."twin_release_id"::text,
    'twinReleaseManifestDigest', NEW."twin_release_manifest_digest",
    'venueId', NEW."venue_id"::text,
    'wholeVenueRegionIds', whole_regions
  );
  NEW."coverage_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-authority-coverage.v1\n'
      || "hr_stable_canonical_json"(coverage_body), 'UTF8'
  ), 'sha256'), 'hex');
  subject_material := jsonb_build_object(
    'authorityExpiresAt', "hr_iso_utc_ms"(NEW."authority_expires_at"),
    'coverage', coverage_body,
    'coverageDigest', NEW."coverage_digest",
    'parsedMapDigest', NEW."parsed_map_digest",
    'presentationAdmissionReviewerActorId',
      NEW."presentation_admission_reviewer_actor_id"::text,
    'presentationAdmissionReviewerAttestationDigest',
      NEW."presentation_admission_reviewer_attestation_digest",
    'presentationAdmissionReviewerAttestationExpiresAt',
      "hr_iso_utc_ms"(NEW."presentation_admission_reviewer_expires_at"),
    'presentationAdmissionReviewerAttestationId',
      NEW."presentation_admission_reviewer_attestation_id"::text,
    'providerCapabilityDigest', NEW."scene_capability_digest",
    'providerCapabilityExpiresAt',
      "hr_iso_utc_ms"(NEW."scene_capability_expires_at"),
    'providerCapabilityReceiptId', NEW."scene_capability_id"::text,
    'sceneArtifactDigest', NEW."scene_artifact_digest",
    'sceneArtifactId', NEW."scene_artifact_id",
    'sceneArtifactRowId', NEW."scene_artifact_row_id"::text,
    'sceneObjectReceipt', receipt_row."receipt_body",
    'sceneRegistryObjectSha256', NEW."scene_registry_object_sha256",
    'sceneRegistryObjectSizeBytes', NEW."scene_registry_object_size_bytes",
    'sceneValidationId', NEW."id"::text,
    'schemaVersion', 'historical-runtime-scene-authority-subject.v1',
    'derivationExpiresAt', "hr_iso_utc_ms"(NEW."derivation_expires_at"),
    'transformReviewExpiresAt',
      "hr_iso_utc_ms"(NEW."transform_review_expires_at"),
    'twinReleaseAuthorityDigest', NEW."twin_release_authority_digest",
    'twinReleaseAuthorityExpiresAt',
      "hr_iso_utc_ms"(NEW."twin_release_authority_expires_at"),
    'twinReleaseAuthorityReceiptId',
      NEW."twin_release_authority_id"::text,
    'twinReleaseDigest', NEW."twin_release_digest",
    'validatedAt', "hr_iso_utc_ms"(action_at)
  );
  subject_material := subject_material || jsonb_build_object(
    'sceneMapParserReceiptDigest', NEW."scene_map_parser_receipt_digest",
    'sceneMapParserReceiptExpiresAt',
      "hr_iso_utc_ms"(NEW."scene_map_parser_receipt_expires_at"),
    'sceneMapParserReceiptId', NEW."scene_map_parser_receipt_id"::text,
    'sceneMapParserImplementationManifestDigest',
      NEW."scene_map_parser_implementation_manifest_digest",
    'sceneMapParserPolicyDigest', NEW."scene_map_parser_policy_digest",
    'sceneMapParserRuntimeDeploymentImageDigest',
      NEW."scene_map_parser_runtime_deployment_image_digest",
    'sceneMapParserRuntimeExecutableArtifactDigest',
      NEW."scene_map_parser_runtime_executable_artifact_digest",
    'sceneMapParserRuntimeIdentityDigest',
      NEW."scene_map_parser_runtime_identity_digest",
    'sceneMapParserRuntimeIdentityEffectiveAt', CASE
      WHEN NEW."scene_map_parser_runtime_identity_effective_at" IS NULL
        THEN NULL
      ELSE "hr_iso_utc_ms"(
        NEW."scene_map_parser_runtime_identity_effective_at"
      )
    END,
    'sceneMapParserRuntimeIdentityExpiresAt', CASE
      WHEN NEW."scene_map_parser_runtime_identity_expires_at" IS NULL THEN NULL
      ELSE "hr_iso_utc_ms"(NEW."scene_map_parser_runtime_identity_expires_at")
    END,
    'sceneMapParserRuntimeIdentityId',
      NEW."scene_map_parser_runtime_identity_id"::text,
    'sceneMapParserRuntimeSessionPrincipalSha256',
      NEW."scene_map_parser_runtime_session_principal_sha256",
    'sceneMapParserRuntimeVerifierCapabilityPrincipal',
      NEW."scene_map_parser_runtime_verifier_capability_principal",
    'sceneMapVerificationReceipt', NEW."scene_map_verification_receipt_body",
    'sceneMapVerificationReceiptDigest',
      NEW."scene_map_verification_receipt_digest",
    'sceneMapVerificationReceiptExpiresAt',
      "hr_iso_utc_ms"(NEW."scene_map_verification_receipt_expires_at"),
    'sceneMapVerificationReceiptId',
      NEW."scene_map_verification_receipt_id"::text,
    'sceneMapVerificationProfile', NEW."scene_map_verification_profile"
  );
  NEW."scene_validation_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-authority-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."subject_body" := subject_material || jsonb_build_object(
    'sceneValidationSubjectDigest', NEW."scene_validation_subject_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_scene_validation_subject"
  BEFORE INSERT ON "hr_scene_validation_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_scene_validation_subject"();

CREATE OR REPLACE FUNCTION "hr_populate_scene_validation_children"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  region_entry record;
  member_entry record;
  covered_entry record;
  derivation_member "hr_derivation_members"%ROWTYPE;
  admission_member "runtime_presentation_admission_members"%ROWTYPE;
BEGIN
  FOR region_entry IN
    SELECT region.value #>> '{}' AS region_id,
      (region.ordinal - 1)::integer AS region_index
    FROM jsonb_array_elements(
      NEW."subject_body"->'coverage'->'wholeVenueRegionIds'
    ) WITH ORDINALITY AS region(value, ordinal)
    ORDER BY region.ordinal
  LOOP
    INSERT INTO "hr_scene_whole_regions" (
      "scene_validation_id", "environment_id", "environment_mode",
      "environment_digest", "coverage_digest", "whole_region_index",
      "region_id", "created_at"
    ) VALUES (
      NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."coverage_digest",
      region_entry.region_index, region_entry.region_id, NEW."created_at"
    );
  END LOOP;

  FOR member_entry IN
    SELECT member.value,
      (member.ordinal - 1)::integer AS member_index
    FROM jsonb_array_elements(
      NEW."subject_body"->'coverage'->'orderedMembers'
    ) WITH ORDINALITY AS member(value, ordinal)
    ORDER BY member.ordinal
  LOOP
    SELECT * INTO STRICT derivation_member
    FROM "hr_derivation_members"
    WHERE "derivation_id" = NEW."derivation_id"
      AND "member_index" = member_entry.member_index;
    SELECT * INTO STRICT admission_member
    FROM "runtime_presentation_admission_members"
    WHERE "admission_id" = NEW."presentation_admission_id"
      AND "member_index" = member_entry.member_index;
    IF admission_member."asset_version_id" IS DISTINCT FROM
         derivation_member."asset_version_id"
       OR admission_member."sha256" IS DISTINCT FROM derivation_member."sha256"
       OR admission_member."size_bytes" IS DISTINCT FROM
          derivation_member."size_bytes"
       OR admission_member."storage_key_sha256" IS DISTINCT FROM
          derivation_member."storage_key_sha256" THEN
      RAISE EXCEPTION 'Scene member does not intersect admission and derivation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_scene_member_intersection';
    END IF;
    INSERT INTO "hr_scene_validation_members" (
      "scene_validation_id", "environment_id", "environment_mode",
      "environment_digest", "scope_epoch_id", "venue_id", "venue_slug",
      "space_id", "space_slug", "presentation_admission_id",
      "runtime_package_id", "runtime_package_content_digest",
      "coverage_digest", "scene_validation_subject_digest",
      "scene_authority_expires_at", "member_index", "derivation_id",
      "derivation_evidence_digest", "asset_version_id", "file_name",
      "file_ext", "mime_type", "sha256", "size_bytes",
      "derivation_output_receipt_id", "derivation_member_receipt_digest",
      "storage_key_sha256", "derivation_receipt_expires_at",
      "rights_evidence_row_id", "rights_evidence_digest", "rights_decision",
      "rights_reviewed_by", "rights_reviewed_at", "authority_reference",
      "covered_region_count", "member_body", "created_at"
    ) VALUES (
      NEW."id", NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
      NEW."venue_slug", NEW."space_id", NEW."space_slug",
      NEW."presentation_admission_id", NEW."runtime_package_id",
      NEW."runtime_package_content_digest", NEW."coverage_digest",
      NEW."scene_validation_subject_digest", NEW."authority_expires_at",
      member_entry.member_index, NEW."derivation_id",
      NEW."derivation_evidence_digest", derivation_member."asset_version_id",
      derivation_member."file_name", derivation_member."file_ext",
      derivation_member."mime_type", derivation_member."sha256",
      derivation_member."size_bytes", derivation_member."output_receipt_id",
      derivation_member."output_receipt_digest",
      derivation_member."storage_key_sha256",
      derivation_member."receipt_expires_at",
      admission_member."rights_evidence_row_id",
      admission_member."rights_evidence_digest",
      admission_member."rights_decision", admission_member."rights_reviewed_by",
      admission_member."rights_reviewed_at",
      member_entry.value->>'authorityReference',
      jsonb_array_length(member_entry.value->'coveredRegionIds'),
      member_entry.value, NEW."created_at"
    );
    FOR covered_entry IN
      SELECT covered.value #>> '{}' AS region_id,
        (covered.ordinal - 1)::integer AS region_index
      FROM jsonb_array_elements(member_entry.value->'coveredRegionIds')
        WITH ORDINALITY AS covered(value, ordinal)
      ORDER BY covered.ordinal
    LOOP
      INSERT INTO "hr_scene_member_regions" (
        "scene_validation_id", "member_index", "covered_region_index",
        "region_id", "created_at"
      ) VALUES (
        NEW."id", member_entry.member_index, covered_entry.region_index,
        covered_entry.region_id, NEW."created_at"
      );
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "c_hr_populate_scene_validation_children"
  AFTER INSERT ON "hr_scene_validation_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_populate_scene_validation_children"();

CREATE OR REPLACE FUNCTION "hr_issue_scene_validation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz;
  action_at timestamptz;
  requested_subject_digest text := NEW."scene_validation_subject_digest";
  scene_subject "hr_scene_validation_subjects"%ROWTYPE;
  verification_handle "hr_verified_scene_map_receipts"%ROWTYPE;
  verification_receipt "hr_scene_map_parser_receipts"%ROWTYPE;
  reviewer_role "hr_role_attestations"%ROWTYPE;
  record_identity record;
  role_id uuid;
  receipt_id uuid;
  material_body jsonb;
BEGIN
  SELECT * INTO STRICT scene_subject
  FROM "hr_scene_validation_subjects"
  WHERE "id" = NEW."id";
  PERFORM "hr_lock_scope"(
    scene_subject."environment_id", scene_subject."venue_id",
    scene_subject."space_id"
  );
  PERFORM "hr_lock_authority"('scene-validation', NEW."id"::text);
  SELECT * INTO STRICT scene_subject
  FROM "hr_scene_validation_subjects"
  WHERE "id" = NEW."id"
    AND "environment_id" = scene_subject."environment_id"
    AND "environment_mode" = scene_subject."environment_mode"
    AND "environment_digest" = scene_subject."environment_digest"
    AND "scope_epoch_id" = scene_subject."scope_epoch_id"
    AND "venue_id" = scene_subject."venue_id"
    AND "space_id" = scene_subject."space_id"
  FOR SHARE;
  IF requested_subject_digest IS DISTINCT FROM
       scene_subject."scene_validation_subject_digest" THEN
    RAISE EXCEPTION 'final Scene request does not name the locked subject digest'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_scene_final_requested_subject';
  END IF;
  PERFORM "hr_lock_authority"(
    'scene-map-verification-handle',
    scene_subject."scene_map_verification_receipt_id"::text
  );
  SELECT * INTO STRICT verification_handle
  FROM "hr_verified_scene_map_receipts"
  WHERE "id" = scene_subject."scene_map_verification_receipt_id"
    AND "scene_validation_id" = scene_subject."id"
    AND "scene_map_verification_receipt_digest" =
      scene_subject."scene_map_verification_receipt_digest"
    AND "environment_id" = scene_subject."environment_id"
    AND "environment_mode" = scene_subject."environment_mode"
    AND "environment_digest" = scene_subject."environment_digest"
    AND "scope_epoch_id" = scene_subject."scope_epoch_id"
    AND "venue_id" = scene_subject."venue_id"
    AND "space_id" = scene_subject."space_id"
  FOR SHARE;
  PERFORM "hr_lock_authority"(
    'scene-map-parser-receipt', verification_handle."parser_receipt_id"::text
  );
  SELECT parser.* INTO STRICT verification_receipt
  FROM "hr_scene_map_parser_receipts" AS parser
  WHERE parser."id" = verification_handle."parser_receipt_id"
    AND parser."scene_validation_id" = scene_subject."id"
    AND parser."scene_map_verification_receipt_digest" =
      scene_subject."scene_map_parser_receipt_digest"
    AND parser."environment_id" = scene_subject."environment_id"
    AND parser."environment_mode" = scene_subject."environment_mode"
    AND parser."environment_digest" = scene_subject."environment_digest"
    AND parser."scope_epoch_id" = scene_subject."scope_epoch_id"
    AND parser."venue_id" = scene_subject."venue_id"
    AND parser."space_id" = scene_subject."space_id"
  FOR SHARE OF parser;
  PERFORM "hr_assert_scene_graph_complete"(NEW."id");
  SELECT * INTO STRICT reviewer_role
  FROM "hr_role_attestations"
  WHERE "id" = NEW."reviewer_attestation_id"
  FOR SHARE;
  check_at := "hr_wall_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    scene_subject."scope_epoch_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (scene_subject."derivation_id", 'derivation'::text),
      (scene_subject."transform_review_id", 'transform_review'::text),
      (scene_subject."twin_release_authority_id",
        'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind,
      scene_subject."environment_id", scene_subject."environment_mode",
      scene_subject."environment_digest", scene_subject."venue_id",
      scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_current"(
    scene_subject."derivation_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    scene_subject."transform_review_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_twin_release_authority_current"(
    scene_subject."twin_release_authority_id",
    scene_subject."environment_id", scene_subject."environment_mode",
    scene_subject."environment_digest", scene_subject."venue_id",
    scene_subject."space_id", check_at
  );
  FOR role_id IN
    SELECT candidate.id
    FROM (VALUES
      (scene_subject."presentation_admission_reviewer_attestation_id"),
      (NEW."reviewer_attestation_id")
    ) AS candidate(id)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, scene_subject."environment_id", scene_subject."environment_mode",
      scene_subject."environment_digest", scene_subject."venue_id",
      scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    scene_subject."presentation_admission_reviewer_attestation_id",
    scene_subject."presentation_admission_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    verification_handle."id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  FOR receipt_id IN
    SELECT candidate.id FROM (
      SELECT scene_subject."scene_object_receipt_id" AS id
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = scene_subject."derivation_id"
      UNION
      SELECT verification_receipt."release_manifest_object_receipt_id"
      UNION
      SELECT verification_receipt."source_twin_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, scene_subject."environment_id",
      scene_subject."environment_mode", scene_subject."environment_digest",
      scene_subject."venue_id", scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_graph_complete"(scene_subject."derivation_id");
  PERFORM "hr_assert_runtime_presentation_admission_members_exact"(
    scene_subject."presentation_admission_id", scene_subject."derivation_id"
  );
  -- All authority locks now persist to transaction end. Re-sample wall time
  -- and repeat every currentness predicate before choosing the durable action
  -- instant, including all three private verification-object receipts.
  check_at := "hr_wall_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    scene_subject."scope_epoch_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  FOR record_identity IN
    SELECT candidate.id, candidate.kind
    FROM (VALUES
      (scene_subject."derivation_id", 'derivation'::text),
      (scene_subject."transform_review_id", 'transform_review'::text),
      (scene_subject."twin_release_authority_id",
        'twin_release_authority'::text)
    ) AS candidate(id, kind)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_evidence_record_current"(
      record_identity.id, record_identity.kind,
      scene_subject."environment_id", scene_subject."environment_mode",
      scene_subject."environment_digest", scene_subject."venue_id",
      scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_current"(
    scene_subject."derivation_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_transform_review_current"(
    scene_subject."transform_review_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_twin_release_authority_current"(
    scene_subject."twin_release_authority_id",
    scene_subject."environment_id", scene_subject."environment_mode",
    scene_subject."environment_digest", scene_subject."venue_id",
    scene_subject."space_id", check_at
  );
  FOR role_id IN
    SELECT candidate.id
    FROM (VALUES
      (scene_subject."presentation_admission_reviewer_attestation_id"),
      (NEW."reviewer_attestation_id")
    ) AS candidate(id)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, scene_subject."environment_id", scene_subject."environment_mode",
      scene_subject."environment_digest", scene_subject."venue_id",
      scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_presentation_admission_reviewer_current"(
    scene_subject."presentation_admission_reviewer_attestation_id",
    scene_subject."presentation_admission_id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  PERFORM "hr_assert_verified_scene_map_receipt_current"(
    verification_handle."id", scene_subject."environment_id",
    scene_subject."environment_mode", scene_subject."environment_digest",
    scene_subject."venue_id", scene_subject."space_id", check_at
  );
  FOR receipt_id IN
    SELECT candidate.id FROM (
      SELECT scene_subject."scene_object_receipt_id" AS id
      UNION
      SELECT member."output_receipt_id"
      FROM "hr_derivation_members" AS member
      WHERE member."derivation_id" = scene_subject."derivation_id"
      UNION
      SELECT verification_receipt."release_manifest_object_receipt_id"
      UNION
      SELECT verification_receipt."source_twin_object_receipt_id"
    ) AS candidate
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, scene_subject."environment_id",
      scene_subject."environment_mode", scene_subject."environment_digest",
      scene_subject."venue_id", scene_subject."space_id", check_at
    );
  END LOOP;
  PERFORM "hr_assert_derivation_graph_complete"(scene_subject."derivation_id");
  PERFORM "hr_assert_runtime_presentation_admission_members_exact"(
    scene_subject."presentation_admission_id", scene_subject."derivation_id"
  );
  action_at := "hr_db_clock_ms"();

  NEW."subject_kind" := scene_subject."subject_kind";
  NEW."environment_id" := scene_subject."environment_id";
  NEW."environment_mode" := scene_subject."environment_mode";
  NEW."environment_digest" := scene_subject."environment_digest";
  NEW."scope_epoch_id" := scene_subject."scope_epoch_id";
  NEW."venue_id" := scene_subject."venue_id";
  NEW."space_id" := scene_subject."space_id";
  NEW."scene_validation_subject_digest" :=
    scene_subject."scene_validation_subject_digest";
  NEW."subject_authority_expires_at" := scene_subject."authority_expires_at";
  NEW."subject_validated_at" := scene_subject."validated_at";
  NEW."admission_reviewer_actor_id" :=
    scene_subject."presentation_admission_reviewer_actor_id";
  NEW."transform_reviewer_actor_id" :=
    scene_subject."transform_reviewer_actor_id";
  NEW."twin_release_authority_actor_id" :=
    scene_subject."twin_release_authority_actor_id";
  NEW."scene_registry_actor_id" :=
    scene_subject."scene_registry_registered_by";
  NEW."reviewer_attestation_digest" := reviewer_role."attestation_digest";
  NEW."reviewer_actor_id" := reviewer_role."actor_id";
  NEW."reviewer_attestation_effective_at" := reviewer_role."effective_at";
  NEW."reviewer_attestation_expires_at" := reviewer_role."expires_at";
  NEW."created_at" := action_at;
  NEW."reviewed_at" := action_at;
  NEW."expires_at" := LEAST(
    scene_subject."authority_expires_at", reviewer_role."expires_at",
    COALESCE(verification_receipt."expires_at", 'infinity')
  );
  IF action_at < scene_subject."validated_at"
     OR NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'Scene final review authority is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scene_final_current';
  END IF;
  material_body := jsonb_build_object(
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'reviewedAt', "hr_iso_utc_ms"(action_at),
    'reviewerActorId', NEW."reviewer_actor_id"::text,
    'reviewerAttestationDigest', NEW."reviewer_attestation_digest",
    'reviewerAttestationExpiresAt',
      "hr_iso_utc_ms"(NEW."reviewer_attestation_expires_at"),
    'reviewerAttestationId', NEW."reviewer_attestation_id"::text,
    'sceneMapParserReceiptDigest',
      scene_subject."scene_map_parser_receipt_digest",
    'sceneMapParserReceiptExpiresAt',
      "hr_iso_utc_ms"(scene_subject."scene_map_parser_receipt_expires_at"),
    'sceneMapParserReceiptId',
      scene_subject."scene_map_parser_receipt_id"::text,
    'sceneMapParserRuntimeIdentityDigest',
      scene_subject."scene_map_parser_runtime_identity_digest",
    'sceneMapParserRuntimeIdentityId',
      scene_subject."scene_map_parser_runtime_identity_id"::text,
    'sceneMapVerificationReceiptDigest',
      scene_subject."scene_map_verification_receipt_digest",
    'sceneMapVerificationReceiptExpiresAt',
      "hr_iso_utc_ms"(scene_subject."scene_map_verification_receipt_expires_at"),
    'sceneMapVerificationReceiptId',
      scene_subject."scene_map_verification_receipt_id"::text,
    'sceneValidationSubjectDigest',
      NEW."scene_validation_subject_digest",
    'schemaVersion', 'historical-runtime-scene-authority-receipt.v1',
    'subject', scene_subject."subject_body"
  );
  NEW."scene_validation_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scene-authority-receipt.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."scene_validation_body" := material_body || jsonb_build_object(
    'sceneValidationDigest', NEW."scene_validation_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'scene_validation', NEW."id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."scene_validation_digest", action_at, NEW."expires_at", action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_scene_validation"
  BEFORE INSERT ON "hr_scene_validations"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_scene_validation"();

-- The migration LOGIN still owns every object created above. Close table ACLs
-- before transferring the exact ten Scene/Twin relations; no ordinary runtime
-- principal receives a direct production runtime-identity write surface.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_verified_twin_release_authorities",
  "hr_scene_parser_runtime_identities",
  "hr_scene_parser_runtime_identity_revocations",
  "hr_scene_map_parser_receipts", "hr_verified_scene_map_receipts",
  "hr_scene_validation_subjects", "hr_scene_whole_regions",
  "hr_scene_validation_members", "hr_scene_member_regions",
  "hr_scene_validations"
FROM PUBLIC, "omnitwin_api_activation",
  "omnitwin_historical_auth_gateway";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_scene_parser_runtime_identities",
  "hr_scene_parser_runtime_identity_revocations",
  "hr_verified_scene_map_receipts"
FROM "omnitwin_historical_evidence_verifier";

GRANT SELECT ON TABLE
  "phase_layout_snapshots",
  "reconstruction_review_evidence_artifacts", "runtime_packages",
  "runtime_presentation_admissions",
  "runtime_presentation_admission_members",
  "hr_verified_twin_release_authorities",
  "hr_scene_parser_runtime_identities",
  "hr_scene_parser_runtime_identity_revocations",
  "hr_scene_map_parser_receipts", "hr_verified_scene_map_receipts",
  "hr_scene_validation_subjects", "hr_scene_whole_regions",
  "hr_scene_validation_members", "hr_scene_member_regions",
  "hr_scene_validations"
TO "omnitwin_historical_evidence_owner";

-- PostgreSQL row-locking SELECTs require UPDATE on a selected column. Grant
-- only immutable identity columns used by the owner-side currentness graph.
GRANT UPDATE ("id") ON TABLE
  "reconstruction_review_evidence_artifacts", "runtime_packages",
  "runtime_presentation_admissions",
  "hr_verified_twin_release_authorities",
  "hr_scene_parser_runtime_identities", "hr_scene_map_parser_receipts",
  "hr_verified_scene_map_receipts", "hr_scene_validation_subjects",
  "hr_scene_validations"
TO "omnitwin_historical_evidence_owner";
GRANT UPDATE ("scene_validation_id") ON TABLE
  "hr_scene_validation_members"
TO "omnitwin_historical_evidence_owner";
GRANT INSERT ON TABLE
  "hr_verified_scene_map_receipts", "hr_scene_whole_regions",
  "hr_scene_validation_members", "hr_scene_member_regions"
TO "omnitwin_historical_evidence_owner";

GRANT SELECT ON TABLE
  "reconstruction_review_evidence_artifacts", "runtime_packages",
  "runtime_presentation_admissions",
  "runtime_presentation_admission_members",
  "hr_verified_twin_release_authorities",
  "hr_scene_map_parser_receipts", "hr_verified_scene_map_receipts",
  "hr_scene_validation_subjects", "hr_scene_whole_regions",
  "hr_scene_validation_members", "hr_scene_member_regions",
  "hr_scene_validations"
TO "omnitwin_historical_evidence_verifier";
GRANT SELECT, INSERT ON TABLE
  "hr_verified_twin_release_authorities", "hr_scene_map_parser_receipts",
  "hr_scene_validation_subjects", "hr_scene_validations"
TO "omnitwin_historical_evidence_verifier";
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_verified_twin_release_authorities", "hr_scene_map_parser_receipts",
  "hr_verified_scene_map_receipts", "hr_scene_validation_subjects",
  "hr_scene_validations"
FROM "omnitwin_historical_evidence_verifier";

-- Revoke function defaults and grant only the three narrow service entry
-- points plus the pure helpers required by trusted CHECK/definer execution.
REVOKE ALL ON FUNCTION
  public."hr_jsonb_has_exact_keys"(jsonb, text[]),
  public."hr_consume_high_assurance_action_authority"(uuid, text, text),
  public."hr_issue_high_assurance_authenticated_action_assertion"(
    uuid, text, jsonb, uuid, uuid, text, text, text, text,
    timestamptz, timestamptz, uuid, uuid
  ),
  public."hr_assert_scene_graph_complete"(uuid),
  public."hr_scene_graph_deferred_guard"(),
  public."hr_authorize_verified_twin_release_authority"(uuid),
  public."hr_issue_verified_twin_release_authority"(),
  public."hr_assert_verified_twin_release_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_twin_release_authority_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_transform_review_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_presentation_admission_reviewer_current"(
    uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_runtime_presentation_admission_members_exact"(uuid, uuid),
  public."runtime_presentation_member_insert_guard"(),
  public."hr_issue_scene_parser_runtime_identity_revocation"(),
  public."hr_assert_scene_parser_runtime_identity_current"(
    uuid, text, uuid, text, uuid, uuid, uuid, timestamptz
  ),
  public."hr_assert_scene_map_parser_receipt_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_assert_verified_scene_map_receipt_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  public."hr_issue_scene_map_parser_receipt"(),
  public."hr_accept_verified_scene_map_receipt"(),
  public."hr_issue_scene_validation_subject"(),
  public."hr_populate_scene_validation_children"(),
  public."hr_issue_scene_validation"()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public."hr_assert_scene_graph_complete"(uuid),
  public."hr_jsonb_has_exact_keys"(jsonb, text[])
TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION
  public."hr_jsonb_has_exact_keys"(jsonb, text[])
TO "omnitwin_historical_evidence_verifier";
GRANT USAGE ON SCHEMA public TO "omnitwin_api_activation";
GRANT EXECUTE ON FUNCTION
  public."hr_authorize_verified_twin_release_authority"(uuid)
TO "omnitwin_api_activation";
GRANT EXECUTE ON FUNCTION
  public."hr_issue_high_assurance_authenticated_action_assertion"(
    uuid, text, jsonb, uuid, uuid, text, text, text, text,
    timestamptz, timestamptz, uuid, uuid
  )
TO "omnitwin_historical_auth_gateway";

-- Transfer only objects introduced by this migration. Existing 0065 objects
-- retain their exact owners; the two CREATE OR REPLACE boundaries above were
-- executed under those owners rather than being taken back by the migrator.
ALTER TABLE public."hr_verified_twin_release_authorities"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_parser_runtime_identities"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_parser_runtime_identity_revocations"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_map_parser_receipts"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_verified_scene_map_receipts"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_validation_subjects"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_whole_regions"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_validation_members"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_member_regions"
  OWNER TO "omnitwin_historical_schema_owner";
ALTER TABLE public."hr_scene_validations"
  OWNER TO "omnitwin_historical_schema_owner";

ALTER FUNCTION public."hr_jsonb_has_exact_keys"(jsonb, text[])
  OWNER TO "omnitwin_historical_schema_owner";
ALTER FUNCTION public."hr_assert_scene_graph_complete"(uuid)
  OWNER TO "omnitwin_historical_schema_owner";
ALTER FUNCTION public."hr_consume_high_assurance_action_authority"(
  uuid, text, text
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_high_assurance_authenticated_action_assertion"(
  uuid, text, jsonb, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, uuid, uuid
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_scene_graph_deferred_guard"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_authorize_verified_twin_release_authority"(uuid)
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_verified_twin_release_authority"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_verified_twin_release_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_twin_release_authority_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_transform_review_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_presentation_admission_reviewer_current"(
  uuid, uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_runtime_presentation_admission_members_exact"(
  uuid, uuid
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."runtime_presentation_member_insert_guard"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_scene_parser_runtime_identity_revocation"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_scene_parser_runtime_identity_current"(
  uuid, text, uuid, text, uuid, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_scene_map_parser_receipt_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_assert_verified_scene_map_receipt_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_scene_map_parser_receipt"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_accept_verified_scene_map_receipt"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_scene_validation_subject"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_populate_scene_validation_children"()
  OWNER TO "omnitwin_historical_evidence_owner";
ALTER FUNCTION public."hr_issue_scene_validation"()
  OWNER TO "omnitwin_historical_evidence_owner";

-- Guard and append-only trigger creation runs as the schema owner after the
-- relation transfers. This avoids granting the migration LOGIN EXECUTE on
-- generic owner/verifier/mutation trigger functions.
SET LOCAL ROLE "omnitwin_historical_schema_owner";
CREATE TRIGGER "a0_hr_require_verified_twin_verifier"
  BEFORE INSERT ON public."hr_verified_twin_release_authorities"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();
CREATE TRIGGER "a0_hr_require_scene_map_parser_receipt_verifier"
  BEFORE INSERT ON public."hr_scene_map_parser_receipts"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();
CREATE TRIGGER "a0_hr_require_scene_map_handle_owner"
  BEFORE INSERT ON public."hr_verified_scene_map_receipts"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_owner"();
CREATE TRIGGER "a_hr_require_scene_subject_verifier"
  BEFORE INSERT ON public."hr_scene_validation_subjects"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_scene_final_verifier"
  BEFORE INSERT ON public."hr_scene_validations"
  FOR EACH ROW EXECUTE FUNCTION public."hr_require_evidence_verifier"();

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'hr_verified_twin_release_authorities',
    'hr_scene_parser_runtime_identities',
    'hr_scene_parser_runtime_identity_revocations',
    'hr_scene_map_parser_receipts', 'hr_verified_scene_map_receipts',
    'hr_scene_validation_subjects', 'hr_scene_whole_regions',
    'hr_scene_validation_members', 'hr_scene_member_regions',
    'hr_scene_validations'
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

SET LOCAL ROLE "omnitwin_historical_schema_owner";
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE REFERENCES ON TABLE '
      || 'public.hr_action_authority_snapshots, '
      || 'public.hr_derivations, public.hr_derivation_members, '
      || 'public.hr_evidence_environments, public.hr_evidence_records, '
      || 'public.hr_evidence_subjects, public.hr_object_receipts, '
      || 'public.hr_provider_capabilities, public.hr_role_attestations, '
      || 'public.hr_scope_epochs, public.hr_signing_key_authorities, '
      || 'public.hr_transform_reviews FROM %I',
    session_user
  );
  IF EXISTS (SELECT 1 FROM public."hr_scene_parser_runtime_identities")
     OR EXISTS (
       SELECT 1 FROM public."hr_scene_parser_runtime_identity_revocations"
     ) THEN
    RAISE EXCEPTION '0066 must not provision parser runtime identity authority'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
RESET ROLE;

REVOKE CREATE ON SCHEMA public
FROM "omnitwin_historical_schema_owner",
     "omnitwin_historical_evidence_owner",
     "omnitwin_historical_evidence_verifier";

-- Exact postflight: no migration-owned hr_* object, no PUBLIC function
-- execution, no residual CREATE, no writable production runtime identity, and
-- every new relation/function/trigger has its intended owner and fixed path.
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
    RAISE EXCEPTION '0066 did not restore the migration principal'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_verified_twin_release_authorities',
      'hr_scene_parser_runtime_identities',
      'hr_scene_parser_runtime_identity_revocations',
      'hr_scene_map_parser_receipts', 'hr_verified_scene_map_receipts',
      'hr_scene_validation_subjects', 'hr_scene_whole_regions',
      'hr_scene_validation_members', 'hr_scene_member_regions',
      'hr_scene_validations'
    ]::text[]) AS expected(name)
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = 'public'::regnamespace
     AND relation.relname = expected.name
     AND relation.relkind IN ('r', 'p')
    WHERE relation.oid IS NULL OR relation.relowner <> schema_owner_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind IN ('r', 'p')
      AND relation.relname LIKE 'hr\_%' ESCAPE '\'
      AND relation.relowner = migration_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES'
    ]::text[]) AS checked(privilege_name)
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind IN ('r', 'p')
      AND relation.relname LIKE 'hr\_%' ESCAPE '\'
      AND pg_catalog.has_table_privilege(
        session_user, relation.oid, checked.privilege_name
      )
  ) THEN
    RAISE EXCEPTION '0066 relation ownership/migrator ACL closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hr_jsonb_has_exact_keys(jsonb,text[])', false,
        schema_owner_oid),
      ('public.hr_require_evidence_verifier()', false, schema_owner_oid),
      ('public.hr_consume_high_assurance_action_authority(uuid,text,text)',
        true, evidence_owner_oid),
      ('public.hr_assert_evidence_record_leaf_exact(uuid)',
        true, evidence_owner_oid),
      ('public.hr_issue_high_assurance_authenticated_action_assertion(uuid,text,jsonb,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,uuid)',
        true, evidence_owner_oid),
      ('public.hr_assert_scene_graph_complete(uuid)', false,
        schema_owner_oid),
      ('public.hr_scene_graph_deferred_guard()', true, evidence_owner_oid),
      ('public.hr_authorize_verified_twin_release_authority(uuid)',
        true, evidence_owner_oid),
      ('public.hr_issue_verified_twin_release_authority()',
        true, evidence_owner_oid),
      ('public.hr_assert_verified_twin_release_current(uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_twin_release_authority_current(uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_transform_review_current(uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_presentation_admission_reviewer_current(uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_runtime_presentation_admission_members_exact(uuid,uuid)',
        true, evidence_owner_oid),
      ('public.runtime_presentation_member_insert_guard()',
        true, evidence_owner_oid),
      ('public.hr_issue_scene_parser_runtime_identity_revocation()',
        true, evidence_owner_oid),
      ('public.hr_assert_scene_parser_runtime_identity_current(uuid,text,uuid,text,uuid,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_scene_map_parser_receipt_current(uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_assert_verified_scene_map_receipt_current(uuid,uuid,text,text,uuid,uuid,timestamptz)',
        true, evidence_owner_oid),
      ('public.hr_issue_scene_map_parser_receipt()', true,
        evidence_owner_oid),
      ('public.hr_accept_verified_scene_map_receipt()', true,
        evidence_owner_oid),
      ('public.hr_issue_scene_validation_subject()', true,
        evidence_owner_oid),
      ('public.hr_populate_scene_validation_children()', true,
        evidence_owner_oid),
      ('public.hr_issue_scene_validation()', true, evidence_owner_oid)
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
      AND procedure.prokind = 'f'
      AND procedure.proname LIKE 'hr\_%' ESCAPE '\'
      AND procedure.proowner = migration_oid
  ) THEN
    RAISE EXCEPTION '0066 function ownership/ACL closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'hr_verified_twin_release_authorities',
      'hr_scene_parser_runtime_identities',
      'hr_scene_parser_runtime_identity_revocations',
      'hr_scene_map_parser_receipts', 'hr_verified_scene_map_receipts',
      'hr_scene_validation_subjects', 'hr_scene_whole_regions',
      'hr_scene_validation_members', 'hr_scene_member_regions',
      'hr_scene_validations'
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
    RAISE EXCEPTION '0066 append-only trigger closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.has_schema_privilege(
       'omnitwin_historical_schema_owner', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege(
       'omnitwin_historical_evidence_owner', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege(
       'omnitwin_historical_evidence_verifier', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege('public', 'public', 'CREATE')
     OR pg_catalog.has_table_privilege(
       'omnitwin_api_activation',
       'public.hr_scene_parser_runtime_identities', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'omnitwin_historical_auth_gateway',
       'public.hr_scene_parser_runtime_identities', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_scene_parser_runtime_identities', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.phase_layout_snapshots', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.phase_layout_snapshots', 'UPDATE'
     ) THEN
    RAISE EXCEPTION '0066 runtime-identity/schema closure failed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'phase_layout_snapshots',
      'reconstruction_review_evidence_artifacts',
      'runtime_packages',
      'runtime_presentation_admissions',
      'runtime_presentation_admission_members'
    ]::text[]) AS required(name)
    WHERE NOT pg_catalog.has_table_privilege(
      'omnitwin_historical_evidence_owner',
      pg_catalog.to_regclass('public.' || required.name), 'SELECT'
    )
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'reconstruction_review_evidence_artifacts',
      'runtime_packages',
      'runtime_presentation_admissions',
      'runtime_presentation_admission_members'
    ]::text[]) AS required(name)
    WHERE NOT pg_catalog.has_table_privilege(
      'omnitwin_historical_evidence_verifier',
      pg_catalog.to_regclass('public.' || required.name), 'SELECT'
    )
  ) OR pg_catalog.has_table_privilege(
    'omnitwin_historical_evidence_verifier',
    'public.phase_layout_snapshots', 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'phase_layout_snapshots',
      'reconstruction_review_evidence_artifacts',
      'runtime_packages',
      'runtime_presentation_admissions',
      'runtime_presentation_admission_members'
    ]::text[]) AS checked(name)
    CROSS JOIN unnest(ARRAY[
      'INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]::text[]) AS checked_privilege(name)
    WHERE pg_catalog.has_table_privilege(
      'omnitwin_historical_evidence_owner',
      pg_catalog.to_regclass('public.' || checked.name),
      checked_privilege.name
    ) OR pg_catalog.has_table_privilege(
      'omnitwin_historical_evidence_verifier',
      pg_catalog.to_regclass('public.' || checked.name),
      checked_privilege.name
    )
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'phase_layout_snapshots',
      'reconstruction_review_evidence_artifacts',
      'runtime_packages',
      'runtime_presentation_admissions',
      'runtime_presentation_admission_members'
    ]::text[]) AS checked(name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass('public.' || checked.name)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE pg_catalog.has_column_privilege(
      'omnitwin_historical_evidence_owner', relation.oid,
      attribute.attnum, 'UPDATE'
    ) IS DISTINCT FROM (
      checked.name IN (
        'reconstruction_review_evidence_artifacts',
        'runtime_packages', 'runtime_presentation_admissions'
      ) AND attribute.attname = 'id'
    )
       OR pg_catalog.has_column_privilege(
         'omnitwin_historical_evidence_verifier', relation.oid,
         attribute.attnum, 'UPDATE'
       )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER'
    ]::text[]) AS checked_privilege(name)
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND (
        relation.relname IN ('events', 'event_phases', 'configurations')
        OR relation.relname LIKE 'hr\_reviewed\_profile%' ESCAPE '\'
        OR relation.relname LIKE 'hr\_execution%' ESCAPE '\'
      )
      AND (
        pg_catalog.has_table_privilege(
          'omnitwin_historical_evidence_owner', relation.oid,
          checked_privilege.name
        ) OR pg_catalog.has_table_privilege(
          'omnitwin_historical_evidence_verifier', relation.oid,
          checked_privilege.name
        )
      )
  ) THEN
    RAISE EXCEPTION '0066 legacy relation ACL closure failed'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
