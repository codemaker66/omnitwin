-- Authenticated owner-capture evidence graph for historical room runtimes.
--
-- This is intentionally additive. Migration 0064 remains immutable forensic
-- history; this migration establishes only the core evidence graph. No 0063
-- admission, asset, capture, or Foundry row is backfilled or elevated. New
-- authority begins only with explicitly inserted, exact-FK evidence records.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Signature verification happens in the hardened Node Ed25519/DSSE verifier,
-- but accepted rows are written through separate database capability roles.
-- Cluster-role creation, hardening, credentials, and migrator SET membership
-- are privileged bootstrap responsibilities; an application migration must
-- never repair role attributes by requiring CREATEROLE or superuser fallback.
DO $$
DECLARE
  capability_name text;
  capability record;
BEGIN
  FOREACH capability_name IN ARRAY ARRAY[
    'omnitwin_historical_schema_owner',
    'omnitwin_historical_evidence_owner',
    'omnitwin_historical_evidence_verifier',
    'omnitwin_historical_auth_gateway',
    'omnitwin_api_activation'
  ]::text[]
  LOOP
    SELECT * INTO capability
    FROM pg_catalog.pg_roles
    WHERE rolname = capability_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'required pre-provisioned capability role % is absent',
        capability_name USING ERRCODE = '42501';
    END IF;
    IF capability.rolcanlogin OR capability.rolinherit
       OR capability.rolsuper OR capability.rolcreatedb
       OR capability.rolcreaterole OR capability.rolreplication
       OR capability.rolbypassrls THEN
      RAISE EXCEPTION 'capability role % has unsafe cluster attributes',
        capability_name USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF NOT pg_catalog.pg_has_role(
    session_user, 'omnitwin_historical_evidence_owner', 'SET'
  ) THEN
    RAISE EXCEPTION 'migration principal lacks SET membership in evidence owner'
      USING ERRCODE = '42501';
  END IF;
  IF NOT pg_catalog.pg_has_role(
    session_user, 'omnitwin_historical_schema_owner', 'SET'
  ) THEN
    RAISE EXCEPTION 'migration principal lacks SET membership in schema owner'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reachable(roleid) AS (
      SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname = 'omnitwin_api_activation'
      UNION
      SELECT membership.roleid
      FROM pg_catalog.pg_auth_members AS membership
      JOIN reachable ON reachable.roleid = membership.member
    )
    SELECT 1
    FROM reachable
    JOIN pg_catalog.pg_roles AS capability
      ON capability.oid = reachable.roleid
    WHERE capability.rolname IN (
      'omnitwin_historical_schema_owner',
      'omnitwin_historical_evidence_owner',
      'omnitwin_historical_evidence_verifier',
      'omnitwin_historical_auth_gateway'
    )
  ) THEN
    RAISE EXCEPTION 'ordinary API role reaches a historical evidence capability role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- SECURITY DEFINER entry points resolve public objects before pg_temp and the
-- application never needs ambient DDL authority in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE OR REPLACE FUNCTION "hr_db_clock_ms"()
RETURNS timestamp with time zone
LANGUAGE sql
VOLATILE
AS $$
  SELECT date_trunc('milliseconds', clock_timestamp())
$$;

-- A DB-issued evidence action uses hr_db_clock_ms() once so every canonical
-- body/column in that action shares one instant. Currentness checks instead
-- use wall time after every potentially blocking lock; statement_timestamp()
-- would otherwise let a statement that waited past expiry retain stale
-- authority.
CREATE OR REPLACE FUNCTION "hr_wall_clock_ms"()
RETURNS timestamp with time zone
LANGUAGE sql
VOLATILE
AS $$
  SELECT date_trunc('milliseconds', clock_timestamp())
$$;

CREATE OR REPLACE FUNCTION "hr_force_db_created_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW."created_at" := "hr_db_clock_ms"();
  RETURN NEW;
END;
$$;

-- Canonical JSON used only for DB-issued evidence material. This mirrors the
-- shared stableCanonicalJson contract: object keys sort lexically, arrays keep
-- order, and no insignificant whitespace is emitted.
CREATE OR REPLACE FUNCTION "hr_stable_canonical_json"(value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  value_kind text := jsonb_typeof(value);
  canonical text;
BEGIN
  IF value_kind = 'object' THEN
    SELECT '{' || COALESCE(string_agg(
      to_json(key_name)::text || ':' || "hr_stable_canonical_json"(key_value),
      ',' ORDER BY key_name COLLATE "C"
    ), '') || '}'
    INTO canonical
    FROM jsonb_each(value) AS entry(key_name, key_value);
    RETURN canonical;
  ELSIF value_kind = 'array' THEN
    SELECT '[' || COALESCE(string_agg(
      "hr_stable_canonical_json"(element), ',' ORDER BY ordinal
    ), '') || ']'
    INTO canonical
    FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(element, ordinal);
    RETURN canonical;
  END IF;
  RETURN value::text;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_iso_utc_ms"(value timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE OR REPLACE FUNCTION "hr_require_evidence_verifier"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user <> 'omnitwin_historical_evidence_verifier' THEN
    RAISE EXCEPTION 'accepted authenticated evidence requires verifier role'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_trusted_evidence_verifier_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_require_evidence_owner"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user <> 'omnitwin_historical_evidence_owner' THEN
    RAISE EXCEPTION 'generic evidence parents require the trusted issuer'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_trusted_evidence_owner_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_role_evidence_document"(
  evidence jsonb,
  evidence_role text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE evidence_role
    WHEN 'capture_operator' THEN evidence->'lineageDocument'
    WHEN 'source_custodian' THEN evidence->'custodyDocument'
    WHEN 'owner_authorizer' THEN evidence->'authorizationDocument'
    WHEN 'normalizer' THEN evidence->'normalizationDocument'
    WHEN 'derivative_producer' THEN evidence->'producerDocument'
    WHEN 'derivative_custodian' THEN evidence->'custodyDocument'
    WHEN 'package_custodian' THEN evidence->'custodyDocument'
    ELSE evidence->'reviewDocument'
  END
$$;

CREATE OR REPLACE FUNCTION "hr_uuid_array_is_distinct"(values_to_check uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(values_to_check) = (
    SELECT count(DISTINCT value) FROM unnest(values_to_check) AS value
  )
$$;

CREATE TABLE "hr_evidence_environments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "configured_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "environment_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_evidence_environments_shape" CHECK ((
    "mode" IN ('production', 'test')
    AND "environment_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("environment_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_evidence_environments_exact_unique"
    UNIQUE ("id", "mode", "environment_digest")
);
CREATE UNIQUE INDEX "hr_evidence_environment_singleton"
  ON "hr_evidence_environments" ((true));

-- 0064 predated the role-attestation signing purpose and the hardened DSSE
-- key-id alphabet. Tighten it additively without rewriting migration history.
ALTER TABLE "runtime_execution_key_policies"
  DROP CONSTRAINT "runtime_execution_key_policies_shape";

ALTER TABLE "runtime_execution_key_policies"
  ADD CONSTRAINT "runtime_execution_key_policies_shape" CHECK ((
    "purpose" IN (
      'historical_runtime_execution_activation',
      'historical_runtime_capture_content_identity',
      'historical_runtime_role_attestation'
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
    AND "policy_body"->>'schemaVersion' = 'historical-runtime-execution-key-policy.v1'
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
  ) IS TRUE),
  ADD CONSTRAINT "runtime_execution_key_policies_purpose_unique" UNIQUE (
    "id", "purpose", "policy_digest", "key_id", "public_key_fingerprint",
    "effective_at", "expires_at"
  );

-- Composite keys used by the graph. These add identity surfaces only; they do
-- not change or bless the referenced legacy rows.
ALTER TABLE "venues"
  ADD CONSTRAINT "hr_venues_id_slug_unique" UNIQUE ("id", "slug");
ALTER TABLE "spaces"
  ADD CONSTRAINT "hr_spaces_id_venue_slug_unique"
  UNIQUE ("id", "venue_id", "slug");
ALTER TABLE "workspaces"
  ADD CONSTRAINT "hr_workspaces_id_venue_unique"
  UNIQUE ("id", "primary_venue_id");
ALTER TABLE "workspace_memberships"
  ADD CONSTRAINT "hr_memberships_id_workspace_unique"
  UNIQUE ("id", "workspace_id");
ALTER TABLE "runtime_presentation_admissions"
  ADD CONSTRAINT "hr_admissions_review_leaf_unique" UNIQUE (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "decision", "reviewed_by", "reviewed_at", "member_count"
  ),
  ADD CONSTRAINT "hr_admissions_transform_leaf_unique" UNIQUE (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "runtime_transform_artifact_row_id", "runtime_transform_artifact_id",
    "runtime_transform_artifact_digest"
  ),
  ADD CONSTRAINT "hr_admissions_subject_scope_unique" UNIQUE (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug"
  );
ALTER TABLE "runtime_transform_artifacts"
  ADD CONSTRAINT "hr_transform_artifacts_review_leaf_unique" UNIQUE (
    "id", "runtime_package_id", "venue_slug", "room_slug",
    "transform_artifact_id", "artifact_digest", "registered_by", "created_at"
  );
ALTER TABLE "reconstruction_releases"
  ADD CONSTRAINT "hr_releases_authority_leaf_unique" UNIQUE (
    "id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "created_by", "created_at"
  );
ALTER TABLE "reconstruction_release_reviews"
  ADD CONSTRAINT "hr_release_reviews_authority_leaf_unique" UNIQUE (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "qa_report_digest", "request_digest",
    "reviewer_user_id", "reviewer_authority", "decision", "target_exposure",
    "review_sequence", "supersedes_review_id", "reviewed_at"
  );
ALTER TABLE "reconstruction_release_attestations"
  ADD CONSTRAINT "hr_release_attestations_authority_leaf_unique" UNIQUE (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "qa_report_digest", "review_id", "review_digest", "envelope_sha256",
    "verified_by", "verified_at"
  );
ALTER TABLE "runtime_presentation_admission_members"
  ADD CONSTRAINT "hr_admission_members_exact_unique" UNIQUE (
    "admission_id", "member_index", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "asset_version_id", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "storage_key_sha256", "rights_evidence_row_id",
    "rights_evidence_digest", "rights_decision", "rights_reviewed_by",
    "rights_reviewed_at"
  );


-- A scope epoch is immutable and revocable. All authority-bearing records bind
-- one exact epoch; rotating authority creates a new row rather than updating.
CREATE TABLE "hr_scope_epochs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE RESTRICT,
  "epoch" bigint NOT NULL,
  "epoch_digest" varchar(64) NOT NULL,
  "issued_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "epoch_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scope_epochs_environment_fk" FOREIGN KEY (
    "environment_id", "environment_mode", "environment_digest"
  ) REFERENCES "hr_evidence_environments" (
    "id", "mode", "environment_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scope_epochs_space_fk" FOREIGN KEY ("space_id", "venue_id")
    REFERENCES "spaces"("id", "venue_id") ON DELETE RESTRICT,
  CONSTRAINT "hr_scope_epochs_shape" CHECK ((
    "epoch" > 0
    AND "epoch_digest" ~ '^[a-f0-9]{64}$'
    AND "effective_at" = "created_at"
    AND "effective_at" < "expires_at"
    AND "expires_at" <= "effective_at" + interval '365 days'
    AND jsonb_typeof("epoch_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_scope_epochs_sequence_unique"
    UNIQUE ("environment_id", "venue_id", "space_id", "epoch"),
  CONSTRAINT "hr_scope_epochs_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  )
);

CREATE TABLE "hr_scope_epoch_revocations" (
  "epoch_id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "epoch" bigint NOT NULL,
  "epoch_digest" varchar(64) NOT NULL,
  "epoch_expires_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_scope_epoch_revocations_epoch_fk" FOREIGN KEY (
    "epoch_id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_scope_epoch_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "revoked_at" = "created_at"
    AND jsonb_typeof("revocation_body") = 'object'
  ) IS TRUE)
);

-- Provider capability ceremonies prove that one provider/account/bucket can
-- re-read exact immutable versions after overwrite. local_fixture is isolated
-- to test environments and r2_workers remains production-ineligible.
CREATE TABLE "hr_provider_capabilities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "capability_digest" varchar(64) NOT NULL,
  "provider_profile" varchar(40) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "version_kind" varchar(50) NOT NULL,
  "verification_mode" varchar(70) NOT NULL,
  "exact_version_read_supported" boolean NOT NULL,
  "overwrite_preserves_prior_version" boolean NOT NULL,
  "anonymous_probe_supported" boolean NOT NULL,
  "anonymous_head_request_digest" varchar(64) NOT NULL,
  "anonymous_head_response_digest" varchar(64) NOT NULL,
  "anonymous_head_status_code" integer NOT NULL,
  "anonymous_head_redirect_count" integer NOT NULL,
  "anonymous_get_request_digest" varchar(64) NOT NULL,
  "anonymous_get_response_digest" varchar(64) NOT NULL,
  "anonymous_get_status_code" integer NOT NULL,
  "anonymous_get_redirect_count" integer NOT NULL,
  "anonymous_denial_class" varchar(50) NOT NULL,
  "provider_account_sha256" varchar(64) NOT NULL,
  "endpoint_authority_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "test_object_storage_key_sha256" varchar(64) NOT NULL,
  "initial_write_digest" varchar(64) NOT NULL,
  "initial_read_digest" varchar(64) NOT NULL,
  "overwrite_digest" varchar(64) NOT NULL,
  "prior_version_reread_digest" varchar(64) NOT NULL,
  "verified_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "capability_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_provider_capabilities_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_provider_capabilities_shape" CHECK ((
    "environment_mode" IN ('production', 'test')
    AND "capability_digest" ~ '^[a-f0-9]{64}$'
    AND "provider_profile" IN ('runtime_private', 'foundry_candidate', 'local_fixture')
    AND (
      ("provider_kind" = 's3' AND "version_kind" = 's3_version_id'
        AND "verification_mode" = 'provider_native_version')
      OR ("provider_kind" IN ('r2_s3', 'content_addressed_immutable')
        AND "version_kind" = 'content_addressed_immutable_key'
        AND "verification_mode" = 'content_addressed_no_overwrite_with_retention')
      OR ("provider_kind" = 'r2_workers' AND "version_kind" = 'r2_object_version'
        AND "verification_mode" = 'provider_native_version')
      OR ("provider_kind" = 'local_fixture'
        AND "version_kind" = 'local_fixture_version'
        AND "verification_mode" = 'local_fixture_exact_version')
    )
    AND (("provider_profile" = 'local_fixture') = ("provider_kind" = 'local_fixture'))
    AND "exact_version_read_supported"
    AND "overwrite_preserves_prior_version"
    AND "anonymous_probe_supported"
    AND "provider_account_sha256" ~ '^[a-f0-9]{64}$'
    AND "endpoint_authority_sha256" ~ '^[a-f0-9]{64}$'
    AND "private_bucket_sha256" ~ '^[a-f0-9]{64}$'
    AND "test_object_storage_key_sha256" ~ '^[a-f0-9]{64}$'
    AND "initial_write_digest" ~ '^[a-f0-9]{64}$'
    AND "initial_read_digest" ~ '^[a-f0-9]{64}$'
    AND "overwrite_digest" ~ '^[a-f0-9]{64}$'
    AND "prior_version_reread_digest" ~ '^[a-f0-9]{64}$'
    AND "anonymous_head_request_digest" ~ '^[a-f0-9]{64}$'
    AND "anonymous_head_response_digest" ~ '^[a-f0-9]{64}$'
    AND "anonymous_get_request_digest" ~ '^[a-f0-9]{64}$'
    AND "anonymous_get_response_digest" ~ '^[a-f0-9]{64}$'
    AND "anonymous_head_request_digest" <> "anonymous_get_request_digest"
    AND "anonymous_head_redirect_count" = 0
    AND "anonymous_get_redirect_count" = 0
    AND "anonymous_head_status_code" = "anonymous_get_status_code"
    AND (
      ("anonymous_head_status_code" = 401
        AND "anonymous_denial_class" = 'authentication_required')
      OR ("anonymous_head_status_code" = 403
        AND "anonymous_denial_class" = 'access_forbidden')
      OR ("anonymous_head_status_code" = 404
        AND "anonymous_denial_class" = 'concealed_existing_object')
    )
    AND ("environment_mode" = 'test' OR (
      "provider_profile" <> 'local_fixture' AND "provider_kind" <> 'r2_workers'
    ))
    AND "initial_read_digest" = "initial_write_digest"
    AND "prior_version_reread_digest" = "initial_write_digest"
    AND "overwrite_digest" <> "initial_write_digest"
    AND "verified_at" = "created_at"
    AND "verified_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "verified_at" + interval '30 days', "scope_epoch_expires_at"
    )
    AND jsonb_typeof("capability_body") = 'object'
    AND "capability_body"->>'schemaVersion' =
      'historical-runtime-provider-capability.v2'
    AND ("capability_body"->>'capabilityReceiptId')::uuid = "id"
    AND "capability_body"->>'providerProfile' = "provider_profile"
    AND "capability_body"->>'providerAccountSha256' =
      "provider_account_sha256"
    AND "capability_body"->>'endpointAuthoritySha256' =
      "endpoint_authority_sha256"
    AND "capability_body"->>'privateBucketSha256' = "private_bucket_sha256"
    AND "capability_body"->>'providerKind' = "provider_kind"
    AND "capability_body"->>'versionKind' = "version_kind"
    AND ("capability_body"->>'exactVersionReadSupported')::boolean =
      "exact_version_read_supported"
    AND ("capability_body"->>'overwritePreservesPriorVersion')::boolean =
      "overwrite_preserves_prior_version"
    AND ("capability_body"->>'anonymousProbeSupported')::boolean =
      "anonymous_probe_supported"
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'headRequestMethod' = 'HEAD'
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'headRequestDigest' = "anonymous_head_request_digest"
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'headResponseDigest' = "anonymous_head_response_digest"
    AND (
      "capability_body"->'anonymousAccessProbeEquivalence'->>
        'headStatusCode'
    )::integer = "anonymous_head_status_code"
    AND (
      "capability_body"->'anonymousAccessProbeEquivalence'->>
        'headRedirectCount'
    )::integer = "anonymous_head_redirect_count"
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'getRequestMethod' = 'GET'
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'getRangeHeader' = 'bytes=0-0'
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'getRequestDigest' = "anonymous_get_request_digest"
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'getResponseDigest' = "anonymous_get_response_digest"
    AND (
      "capability_body"->'anonymousAccessProbeEquivalence'->>
        'getStatusCode'
    )::integer = "anonymous_get_status_code"
    AND (
      "capability_body"->'anonymousAccessProbeEquivalence'->>
        'getRedirectCount'
    )::integer = "anonymous_get_redirect_count"
    AND "capability_body"->'anonymousAccessProbeEquivalence'->>
      'denialClass' = "anonymous_denial_class"
    AND "capability_body"->>'verificationMode' = "verification_mode"
    AND "capability_body"->>'testObjectStorageKeySha256' =
      "test_object_storage_key_sha256"
    AND "capability_body"->>'initialWriteDigest' = "initial_write_digest"
    AND "capability_body"->>'initialReadDigest' = "initial_read_digest"
    AND "capability_body"->>'overwriteDigest' = "overwrite_digest"
    AND "capability_body"->>'priorVersionRereadDigest' =
      "prior_version_reread_digest"
    AND ("capability_body"->>'verifiedBy')::uuid = "verified_by"
    AND ("capability_body"->>'verifiedAt')::timestamptz = "verified_at"
    AND ("capability_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "capability_body"->>'capabilityDigest' = "capability_digest"
  ) IS TRUE),
  CONSTRAINT "hr_provider_capabilities_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_digest",
    "provider_profile", "provider_kind", "version_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "expires_at"
  ),
  CONSTRAINT "hr_provider_capabilities_id_digest_unique"
    UNIQUE (
      "id", "environment_id", "environment_mode", "environment_digest",
      "capability_digest", "venue_id", "space_id", "expires_at"
    )
);

CREATE TABLE "hr_provider_capability_revocations" (
  "capability_id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "capability_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "capability_expires_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_provider_cap_revocations_cap_fk" FOREIGN KEY (
    "capability_id", "environment_id", "environment_mode",
    "environment_digest", "capability_digest", "venue_id", "space_id",
    "capability_expires_at"
  ) REFERENCES "hr_provider_capabilities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "capability_digest", "venue_id", "space_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_provider_cap_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "revoked_at" = "created_at"
    AND jsonb_typeof("revocation_body") = 'object'
  ) IS TRUE)
);

CREATE TABLE "hr_object_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "capability_id" uuid NOT NULL,
  "capability_digest" varchar(64) NOT NULL,
  "capability_expires_at" timestamptz NOT NULL,
  "receipt_role" varchar(40) NOT NULL,
  "receipt_digest" varchar(64) NOT NULL,
  "provider_profile" varchar(40) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "version_kind" varchar(50) NOT NULL,
  "provider_account_sha256" varchar(64) NOT NULL,
  "endpoint_authority_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "storage_version" varchar(512) NOT NULL,
  "storage_etag" varchar(512) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "custodian_actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "custodian_membership_id" uuid REFERENCES "workspace_memberships"("id")
    ON DELETE RESTRICT,
  "custodian_authority_digest" varchar(64) NOT NULL,
  "custodian_authority_body" jsonb NOT NULL,
  "observed_by_actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "observed_by_membership_id" uuid REFERENCES "workspace_memberships"("id")
    ON DELETE RESTRICT,
  "observed_by_authority_digest" varchar(64) NOT NULL,
  "observed_by_authority_body" jsonb NOT NULL,
  "authenticated_read_request_digest" varchar(64) NOT NULL,
  "authenticated_read_response_digest" varchar(64) NOT NULL,
  "read_at" timestamptz NOT NULL,
  "denial_request_method" varchar(10) NOT NULL,
  "denial_request_digest" varchar(64) NOT NULL,
  "denial_response_digest" varchar(64) NOT NULL,
  "denial_status_code" integer NOT NULL,
  "denial_class" varchar(50) NOT NULL,
  "denial_redirect_count" integer NOT NULL,
  "denial_get_request_method" varchar(10) NOT NULL,
  "denial_get_range_header" varchar(32) NOT NULL,
  "denial_get_request_digest" varchar(64) NOT NULL,
  "denial_get_response_digest" varchar(64) NOT NULL,
  "denial_get_status_code" integer NOT NULL,
  "denial_get_class" varchar(50) NOT NULL,
  "denial_get_redirect_count" integer NOT NULL,
  "denial_probed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "denial_prober_membership_id" uuid REFERENCES "workspace_memberships"("id")
    ON DELETE RESTRICT,
  "denial_prober_authority_digest" varchar(64) NOT NULL,
  "denial_prober_authority_body" jsonb NOT NULL,
  "denial_probed_at" timestamptz NOT NULL,
  "denial_expires_at" timestamptz NOT NULL,
  "receipt_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_object_receipts_capability_fk" FOREIGN KEY (
    "capability_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "capability_digest", "provider_profile", "provider_kind", "version_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "capability_expires_at"
  ) REFERENCES "hr_provider_capabilities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_digest",
    "provider_profile", "provider_kind", "version_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_object_receipts_shape" CHECK ((
    "environment_mode" IN ('production', 'test')
    AND "receipt_role" IN (
      'source_root', 'source_member', 'derived_member', 'scene',
      'evidence_document', 'supporting_metadata'
    )
    AND "receipt_digest" ~ '^[a-f0-9]{64}$'
    AND "capability_digest" ~ '^[a-f0-9]{64}$'
    AND "provider_account_sha256" ~ '^[a-f0-9]{64}$'
    AND "endpoint_authority_sha256" ~ '^[a-f0-9]{64}$'
    AND "private_bucket_sha256" ~ '^[a-f0-9]{64}$'
    AND "storage_key_sha256" ~ '^[a-f0-9]{64}$'
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "authenticated_read_request_digest" ~ '^[a-f0-9]{64}$'
    AND "authenticated_read_response_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_request_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_response_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_get_request_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_get_response_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_get_request_digest" <> "denial_request_digest"
    AND "custodian_authority_digest" ~ '^[a-f0-9]{64}$'
    AND "observed_by_authority_digest" ~ '^[a-f0-9]{64}$'
    AND "denial_prober_authority_digest" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" BETWEEN 1 AND 68719476736
    AND length("storage_version") BETWEEN 1 AND 512
    AND length("storage_etag") BETWEEN 1 AND 512
    AND length("file_name") BETWEEN 1 AND 255
    AND "file_name" !~ '[/\\]'
    AND "custodian_actor_id" <> "observed_by_actor_id"
    AND "custodian_actor_id" <> "denial_probed_by"
    AND "observed_by_actor_id" <> "denial_probed_by"
    AND "read_at" <= "denial_probed_at"
    AND "read_at" >= "denial_probed_at" - interval '5 minutes'
    AND "denial_request_method" = 'HEAD'
    AND "denial_redirect_count" = 0
    AND "denial_get_request_method" = 'GET'
    AND "denial_get_range_header" = 'bytes=0-0'
    AND "denial_get_redirect_count" = 0
    AND "denial_get_status_code" = "denial_status_code"
    AND "denial_get_class" = "denial_class"
    AND "denial_probed_at" = "created_at"
    AND "denial_probed_at" < "denial_expires_at"
    AND "denial_expires_at" <= LEAST(
      "denial_probed_at" + interval '24 hours', "capability_expires_at"
    )
    AND (
      ("denial_status_code" = 401 AND "denial_class" = 'authentication_required')
      OR ("denial_status_code" = 403 AND "denial_class" = 'access_forbidden')
      OR ("denial_status_code" = 404 AND "denial_class" = 'concealed_existing_object')
    )
    AND jsonb_typeof("receipt_body") = 'object'
    AND jsonb_typeof("custodian_authority_body") = 'object'
    AND jsonb_typeof("observed_by_authority_body") = 'object'
    AND jsonb_typeof("denial_prober_authority_body") = 'object'
    AND "custodian_authority_body"->>'authorityDigest' =
      "custodian_authority_digest"
    AND "observed_by_authority_body"->>'authorityDigest' =
      "observed_by_authority_digest"
    AND "denial_prober_authority_body"->>'authorityDigest' =
      "denial_prober_authority_digest"
    AND "custodian_authority_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-object-actor-authority.v1\n'
        || "hr_stable_canonical_json"(
          "custodian_authority_body" - 'authorityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
    AND "observed_by_authority_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-object-actor-authority.v1\n'
        || "hr_stable_canonical_json"(
          "observed_by_authority_body" - 'authorityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
    AND "denial_prober_authority_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-object-actor-authority.v1\n'
        || "hr_stable_canonical_json"(
          "denial_prober_authority_body" - 'authorityDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
    AND "receipt_body"->>'schemaVersion' =
      'historical-runtime-exact-object-receipt.v2'
    AND "receipt_body"->>'receiptId' = "id"::text
    AND "receipt_body"->>'receiptDigest' = "receipt_digest"
    AND "receipt_body"->'object'->>'providerProfile' = "provider_profile"
    AND "receipt_body"->'object'->>'providerKind' = "provider_kind"
    AND "receipt_body"->'object'->>'providerAccountSha256' =
      "provider_account_sha256"
    AND "receipt_body"->'object'->>'endpointAuthoritySha256' =
      "endpoint_authority_sha256"
    AND "receipt_body"->'object'->>'privateBucketSha256' =
      "private_bucket_sha256"
    AND "receipt_body"->'object'->>'storageKeySha256' = "storage_key_sha256"
    AND "receipt_body"->'object'->>'versionKind' = "version_kind"
    AND "receipt_body"->'object'->>'storageVersion' = "storage_version"
    AND ("receipt_body"->'object'->>'immutabilityCapabilityReceiptId')::uuid =
      "capability_id"
    AND "receipt_body"->'object'->>'immutabilityCapabilityDigest' =
      "capability_digest"
    AND "receipt_body"->'object'->>'storageEtag' = "storage_etag"
    AND "receipt_body"->'object'->>'fileName' = "file_name"
    AND "receipt_body"->'object'->>'mimeType' = "mime_type"
    AND "receipt_body"->'object'->>'sha256' = "sha256"
    AND ("receipt_body"->'object'->>'sizeBytes')::bigint = "size_bytes"
    AND "receipt_body"->>'custodianActorId' = "custodian_actor_id"::text
    AND "receipt_body"->'custodianAuthority' =
      "custodian_authority_body"
    AND "receipt_body"->>'observedByActorId' = "observed_by_actor_id"::text
    AND "receipt_body"->'observedByAuthority' =
      "observed_by_authority_body"
    AND "receipt_body"->>'authenticatedReadRequestDigest' =
      "authenticated_read_request_digest"
    AND "receipt_body"->>'authenticatedReadResponseDigest' =
      "authenticated_read_response_digest"
    AND ("receipt_body"->>'readAt')::timestamptz = "read_at"
    AND "receipt_body"->'anonymousAccessDenial'->>'schemaVersion' =
      'historical-runtime-anonymous-access-denial.v2'
    AND "receipt_body"->'anonymousAccessDenial'->>'requestMethod' =
      "denial_request_method"
    AND "receipt_body"->'anonymousAccessDenial'->>'providerProfile' =
      "provider_profile"
    AND "receipt_body"->'anonymousAccessDenial'->>'providerKind' =
      "provider_kind"
    AND "receipt_body"->'anonymousAccessDenial'->>'providerAccountSha256' =
      "provider_account_sha256"
    AND "receipt_body"->'anonymousAccessDenial'->>'endpointAuthoritySha256' =
      "endpoint_authority_sha256"
    AND "receipt_body"->'anonymousAccessDenial'->>'privateBucketSha256' =
      "private_bucket_sha256"
    AND "receipt_body"->'anonymousAccessDenial'->>'storageKeySha256' =
      "storage_key_sha256"
    AND "receipt_body"->'anonymousAccessDenial'->>'versionKind' =
      "version_kind"
    AND "receipt_body"->'anonymousAccessDenial'->>'storageVersion' =
      "storage_version"
    AND (
      "receipt_body"->'anonymousAccessDenial'->>
        'immutabilityCapabilityReceiptId'
    )::uuid = "capability_id"
    AND "receipt_body"->'anonymousAccessDenial'->>
      'immutabilityCapabilityDigest' = "capability_digest"
    AND "receipt_body"->'anonymousAccessDenial'->>
      'authenticatedReadRequestDigest' = "authenticated_read_request_digest"
    AND "receipt_body"->'anonymousAccessDenial'->>'requestDigest' =
      "denial_request_digest"
    AND "receipt_body"->'anonymousAccessDenial'->>'responseDigest' =
      "denial_response_digest"
    AND ("receipt_body"->'anonymousAccessDenial'->>'redirectCount')::integer =
      "denial_redirect_count"
    AND ("receipt_body"->'anonymousAccessDenial'->>'statusCode')::integer =
      "denial_status_code"
    AND "receipt_body"->'anonymousAccessDenial'->>'denialClass' = "denial_class"
    AND "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
      'requestMethod' = "denial_get_request_method"
    AND "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
      'rangeHeader' = "denial_get_range_header"
    AND "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
      'requestDigest' = "denial_get_request_digest"
    AND "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
      'responseDigest' = "denial_get_response_digest"
    AND (
      "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>'statusCode'
    )::integer = "denial_get_status_code"
    AND "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
      'denialClass' = "denial_get_class"
    AND (
      "receipt_body"->'anonymousAccessDenial'->'safeRangeGet'->>
        'redirectCount'
    )::integer = "denial_get_redirect_count"
    AND ("receipt_body"->'anonymousAccessDenial'->>'probedBy')::uuid =
      "denial_probed_by"
    AND "receipt_body"->'anonymousAccessDenial'->'proberAuthority' =
      "denial_prober_authority_body"
    AND ("receipt_body"->'anonymousAccessDenial'->>'probedAt')::timestamptz =
      "denial_probed_at"
    AND ("receipt_body"->'anonymousAccessDenial'->>'expiresAt')::timestamptz =
      "denial_expires_at"
    AND "receipt_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-exact-object-receipt.v2\n'
        || "hr_stable_canonical_json"(
          "receipt_body" - 'receiptDigest'
        ), 'UTF8'
    ), 'sha256'), 'hex')
  ) IS TRUE),
  CONSTRAINT "hr_object_receipts_authority_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "denial_expires_at"
  ),
  CONSTRAINT "hr_object_receipts_bytes_unique" UNIQUE (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ),
  CONSTRAINT "hr_object_receipts_storage_version_unique" UNIQUE (
    "id", "storage_key_sha256", "version_kind", "storage_version"
  ),
  CONSTRAINT "hr_object_receipts_storage_etag_unique" UNIQUE (
    "id", "storage_etag"
  ),
  CONSTRAINT "hr_object_receipts_id_digest_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "receipt_role", "receipt_digest", "venue_id", "space_id",
    "denial_expires_at"
  )
);

CREATE INDEX "hr_object_receipts_lookup_idx" ON "hr_object_receipts" (
  "provider_account_sha256", "private_bucket_sha256", "storage_key_sha256",
  "version_kind", "storage_version"
);

CREATE TABLE "hr_evidence_subjects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_evidence_subjects_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_evidence_subjects_shape" CHECK ((
    "subject_kind" IN (
      'capture_import', 'derivation', 'transform_review', 'rights_clearance',
      'scene_validation', 'reviewed_profile', 'execution_activation'
    )
    AND "created_at" < "scope_epoch_expires_at"
  ) IS TRUE),
  CONSTRAINT "hr_evidence_subjects_exact_unique" UNIQUE (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id",
    "scope_epoch", "scope_epoch_digest", "scope_epoch_expires_at"
  ),
  CONSTRAINT "hr_evidence_subjects_scope_unique" UNIQUE (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  )
);

CREATE TABLE "hr_authority_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "attestation_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "authentication_source" varchar(40) NOT NULL,
  "platform_role" varchar(20) NOT NULL,
  "user_role" varchar(20) NOT NULL,
  "user_venue_id" uuid,
  "workspace_state" varchar(30) NOT NULL,
  "membership_id" uuid,
  "workspace_id" uuid,
  "workspace_role" varchar(30),
  "venue_role" varchar(30),
  "membership_updated_at" timestamptz,
  "membership_version_digest" varchar(64),
  "snapshotted_at" timestamptz NOT NULL,
  "authority_digest" varchar(64) NOT NULL,
  "authority_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_authority_snapshots_subject_fk" FOREIGN KEY (
    "subject_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_authority_snapshots_environment_fk" FOREIGN KEY (
    "environment_id", "environment_mode", "environment_digest"
  ) REFERENCES "hr_evidence_environments" (
    "id", "mode", "environment_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_authority_snapshots_membership_fk"
    FOREIGN KEY ("membership_id", "workspace_id")
    REFERENCES "workspace_memberships" ("id", "workspace_id")
    ON DELETE RESTRICT,
  CONSTRAINT "hr_authority_snapshots_workspace_fk"
    FOREIGN KEY ("workspace_id", "venue_id")
    REFERENCES "workspaces" ("id", "primary_venue_id")
    ON DELETE RESTRICT,
  CONSTRAINT "hr_authority_snapshots_shape" CHECK ((
    "authentication_source" IN ('clerk_session', 'local_test_fixture')
    AND ("environment_mode" = 'test'
      OR "authentication_source" = 'clerk_session')
    AND "platform_role" IN ('none', 'operator', 'admin')
    AND "user_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin')
    AND "workspace_state" IN ('active', 'not_applicable')
    AND "authority_digest" ~ '^[a-f0-9]{64}$'
    AND "snapshotted_at" = "created_at"
    AND ("platform_role" <> 'none' OR "user_venue_id" = "venue_id")
    AND (
      ("workspace_state" = 'active' AND "membership_id" IS NOT NULL
        AND "workspace_id" IS NOT NULL AND "workspace_role" IS NOT NULL
        AND "venue_role" IS NOT NULL AND "membership_updated_at" IS NOT NULL
        AND "membership_version_digest" ~ '^[a-f0-9]{64}$'
        AND "membership_updated_at" <= "snapshotted_at")
      OR ("workspace_state" = 'not_applicable' AND "membership_id" IS NULL
        AND "workspace_id" IS NULL AND "workspace_role" IS NULL
        AND "venue_role" IS NULL AND "membership_updated_at" IS NULL
        AND "membership_version_digest" IS NULL AND "platform_role" <> 'none')
    )
    AND jsonb_typeof("authority_body") = 'object'
    AND "authority_body"->>'authenticationSource' =
      "authentication_source"
    AND "authority_body"->>'platformRole' = "platform_role"
    AND "authority_body"->>'userRole' = "user_role"
    AND (
      ("user_venue_id" IS NULL
        AND "authority_body"->'userVenueId' = 'null'::jsonb)
      OR "authority_body"->>'userVenueId' = "user_venue_id"::text
    )
    AND ("authority_body"->>'venueId')::uuid = "venue_id"
    AND ("authority_body"->>'snapshottedAt')::timestamptz =
      "snapshotted_at"
    AND "authority_body"->>'authorityDigest' = "authority_digest"
    AND (
      ("workspace_state" = 'active'
        AND "authority_body"->'workspaceMembership'->>'state' = 'active'
        AND (
          "authority_body"->'workspaceMembership'->>'membershipId'
        )::uuid = "membership_id"
        AND (
          "authority_body"->'workspaceMembership'->>'workspaceId'
        )::uuid = "workspace_id"
        AND "authority_body"->'workspaceMembership'->>'workspaceRole' =
          "workspace_role"
        AND "authority_body"->'workspaceMembership'->>'venueRole' =
          "venue_role"
        AND "authority_body"->'workspaceMembership'->>'membershipStatus' =
          'active'
        AND (
          "authority_body"->'workspaceMembership'->>'membershipUpdatedAt'
        )::timestamptz = "membership_updated_at"
        AND "authority_body"->'workspaceMembership'->>
          'membershipVersionDigest' = "membership_version_digest")
      OR ("workspace_state" = 'not_applicable'
        AND "authority_body"->'workspaceMembership'->>'state' =
          'not_applicable'
        AND "authority_body"->'workspaceMembership'->>'reason' =
          'platform_authority')
    )
  ) IS TRUE),
  CONSTRAINT "hr_authority_snapshots_exact_unique" UNIQUE (
    "id", "attestation_id", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "actor_id", "authority_digest", "authority_body",
    "snapshotted_at"
  ),
  CONSTRAINT "hr_authority_snapshots_attestation_unique" UNIQUE (
    "attestation_id", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "actor_id", "authority_digest", "snapshotted_at"
  )
);

-- The ordinary API database principal cannot attest which Clerk session is
-- driving a request. A separately provisioned authentication-gateway login
-- calls the narrow issuer for this append-only, action-bound assertion. The
-- assertion is single-use and cannot be repurposed for another action UUID.
CREATE TABLE "hr_authenticated_action_assertions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "audience" varchar(60) NOT NULL,
  "action_kind" varchar(60) NOT NULL,
  "action_id" uuid NOT NULL,
  "action_parameters_digest" varchar(64) NOT NULL,
  "action_parameters_body" jsonb NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "authority_scope_epoch_id" uuid NOT NULL,
  "authority_scope_epoch" bigint NOT NULL,
  "authority_scope_epoch_digest" varchar(64) NOT NULL,
  "authority_scope_epoch_expires_at" timestamptz NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "authentication_source" varchar(40) NOT NULL,
  "authentication_audience" varchar(120) NOT NULL,
  "authentication_session_sha256" varchar(64) NOT NULL,
  "authentication_subject_sha256" varchar(64) NOT NULL,
  "authentication_session_issued_at" timestamptz NOT NULL,
  "authentication_session_expires_at" timestamptz NOT NULL,
  "authenticated_by_database_principal" varchar(63) NOT NULL,
  "platform_role" varchar(20) NOT NULL,
  "user_role" varchar(20) NOT NULL,
  "user_venue_id" uuid,
  "workspace_state" varchar(30) NOT NULL,
  "membership_id" uuid,
  "workspace_id" uuid,
  "workspace_role" varchar(30),
  "venue_role" varchar(30),
  "membership_updated_at" timestamptz,
  "membership_version_digest" varchar(64),
  "authenticated_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "nonce" uuid NOT NULL,
  "assertion_digest" varchar(64) NOT NULL,
  "assertion_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_action_assertions_environment_fk" FOREIGN KEY (
    "environment_id", "environment_mode", "environment_digest"
  ) REFERENCES "hr_evidence_environments" (
    "id", "mode", "environment_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertions_scope_fk" FOREIGN KEY (
    "authority_scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "authority_scope_epoch",
    "authority_scope_epoch_digest", "authority_scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertions_membership_fk" FOREIGN KEY (
    "membership_id", "workspace_id"
  ) REFERENCES "workspace_memberships" ("id", "workspace_id")
    ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertions_workspace_fk" FOREIGN KEY (
    "workspace_id", "venue_id"
  ) REFERENCES "workspaces" ("id", "primary_venue_id")
    ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertions_shape" CHECK ((
    "audience" = 'historical_runtime_evidence'
    AND "action_kind" IN (
      'scope_epoch_revocation', 'provider_capability_revocation',
      'signing_key_authority_revocation', 'role_attestation_revocation',
      'evidence_record_revocation', 'execution_activation_revocation',
      'execution_activation_request'
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
  ) IS TRUE),
  CONSTRAINT "hr_action_assertions_action_unique"
    UNIQUE ("action_kind", "action_id"),
  CONSTRAINT "hr_action_assertions_exact_unique" UNIQUE (
    "id", "action_kind", "action_id", "action_parameters_digest",
    "environment_id",
    "environment_mode", "environment_digest", "authority_scope_epoch_id",
    "venue_id", "space_id", "actor_id", "assertion_digest",
    "authenticated_at", "expires_at"
  ),
  CONSTRAINT "hr_action_assertions_use_unique" UNIQUE (
    "id", "action_kind", "action_id", "actor_id", "assertion_digest",
    "authenticated_at"
  )
);

CREATE TABLE "hr_action_authority_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "action_kind" varchar(60) NOT NULL,
  "action_id" uuid NOT NULL,
  "authority_role" varchar(40) NOT NULL,
  "action_parameters_digest" varchar(64) NOT NULL,
  "authentication_assertion_id" uuid NOT NULL,
  "authentication_assertion_digest" varchar(64) NOT NULL,
  "authentication_asserted_at" timestamptz NOT NULL,
  "authentication_assertion_expires_at" timestamptz NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "authority_scope_epoch_id" uuid NOT NULL,
  "authority_scope_epoch" bigint NOT NULL,
  "authority_scope_epoch_digest" varchar(64) NOT NULL,
  "authority_scope_epoch_expires_at" timestamptz NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "snapshotted_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "authority_digest" varchar(64) NOT NULL,
  "authority_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_action_authority_assertion_fk" FOREIGN KEY (
    "authentication_assertion_id", "action_kind", "action_id",
    "action_parameters_digest",
    "environment_id", "environment_mode", "environment_digest",
    "authority_scope_epoch_id", "venue_id", "space_id", "actor_id",
    "authentication_assertion_digest", "authentication_asserted_at",
    "authentication_assertion_expires_at"
  ) REFERENCES "hr_authenticated_action_assertions" (
    "id", "action_kind", "action_id", "action_parameters_digest",
    "environment_id",
    "environment_mode", "environment_digest", "authority_scope_epoch_id",
    "venue_id", "space_id", "actor_id", "assertion_digest",
    "authenticated_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_authority_scope_fk" FOREIGN KEY (
    "authority_scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "authority_scope_epoch",
    "authority_scope_epoch_digest", "authority_scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_authority_shape" CHECK ((
    "authority_role" IN ('revoker', 'execution_requester')
    AND (
      ("action_kind" IN (
        'scope_epoch_revocation', 'provider_capability_revocation',
        'signing_key_authority_revocation', 'role_attestation_revocation',
        'evidence_record_revocation', 'execution_activation_revocation'
      ) AND "authority_role" = 'revoker')
      OR ("action_kind" = 'execution_activation_request'
        AND "authority_role" = 'execution_requester')
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
  ) IS TRUE),
  CONSTRAINT "hr_action_authority_action_unique"
    UNIQUE ("action_kind", "action_id"),
  CONSTRAINT "hr_action_authority_assertion_unique"
    UNIQUE ("authentication_assertion_id"),
  CONSTRAINT "hr_action_authority_exact_unique" UNIQUE (
    "id", "action_kind", "action_id", "authority_role",
    "action_parameters_digest",
    "environment_id", "environment_mode", "environment_digest",
    "authority_scope_epoch_id", "venue_id", "space_id", "actor_id",
    "authority_digest", "snapshotted_at", "expires_at"
  ),
  CONSTRAINT "hr_action_authority_use_unique" UNIQUE (
    "id", "action_kind", "action_id", "actor_id", "snapshotted_at"
  )
);

CREATE TABLE "hr_authenticated_action_assertion_uses" (
  "authentication_assertion_id" uuid PRIMARY KEY NOT NULL,
  "authentication_assertion_digest" varchar(64) NOT NULL,
  "action_authority_snapshot_id" uuid NOT NULL UNIQUE,
  "action_kind" varchar(60) NOT NULL,
  "action_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "authentication_asserted_at" timestamptz NOT NULL,
  "used_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_action_assertion_uses_assertion_fk" FOREIGN KEY (
    "authentication_assertion_id", "action_kind", "action_id",
    "actor_id", "authentication_assertion_digest",
    "authentication_asserted_at"
  ) REFERENCES "hr_authenticated_action_assertions" (
    "id", "action_kind", "action_id", "actor_id", "assertion_digest",
    "authenticated_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertion_uses_snapshot_fk" FOREIGN KEY (
    "action_authority_snapshot_id", "action_kind", "action_id",
    "actor_id", "used_at"
  ) REFERENCES "hr_action_authority_snapshots" (
    "id", "action_kind", "action_id", "actor_id", "snapshotted_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_action_assertion_uses_shape" CHECK ((
    "authentication_asserted_at" <= "used_at"
    AND "used_at" = "created_at"
  ) IS TRUE)
);

CREATE OR REPLACE FUNCTION "hr_issue_authority_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_at timestamptz;
  live_user record;
  live_membership record;
  live_workspace record;
  membership_material jsonb;
  snapshot_material jsonb;
BEGIN
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id",
    "hr_wall_clock_ms"()
  );
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_user
  FROM "users"
  WHERE "id" = NEW."actor_id"
  FOR SHARE;
  NEW."platform_role" := live_user."platform_role";
  NEW."user_role" := live_user."role";
  NEW."user_venue_id" := live_user."venue_id";

  IF NEW."authentication_source" = 'local_test_fixture' THEN
    IF NEW."environment_mode" <> 'test' THEN
      RAISE EXCEPTION 'local fixture authority is test-only'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_authority_snapshot_environment';
    END IF;
  ELSIF NEW."authentication_source" <> 'clerk_session' THEN
    RAISE EXCEPTION 'unsupported authentication source'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authority_snapshot_environment';
  ELSIF live_user."clerk_id" IS NULL THEN
    RAISE EXCEPTION 'clerk authority requires a bound Clerk identity'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authority_snapshot_authentication';
  END IF;

  IF (NEW."membership_id" IS NULL) <> (NEW."workspace_id" IS NULL) THEN
    RAISE EXCEPTION 'membership and workspace must be supplied together'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authority_snapshot_membership';
  END IF;

  IF NEW."membership_id" IS NOT NULL THEN
    SELECT "primary_venue_id", "status", "deleted_at"
    INTO STRICT live_workspace
    FROM "workspaces"
    WHERE "id" = NEW."workspace_id"
    FOR SHARE;

    SELECT
      "user_id", "workspace_id", "role", "venue_role", "status",
      "updated_at"
    INTO STRICT live_membership
    FROM "workspace_memberships"
    WHERE "id" = NEW."membership_id"
      AND "workspace_id" = NEW."workspace_id"
    FOR SHARE;

    IF live_membership."user_id" IS DISTINCT FROM NEW."actor_id"
       OR live_workspace."primary_venue_id" IS DISTINCT FROM NEW."venue_id"
       OR live_membership."status" <> 'active'
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'authority membership is not current for actor and venue'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_authority_snapshot_membership';
    END IF;

    NEW."workspace_state" := 'active';
    NEW."workspace_role" := live_membership."role";
    NEW."venue_role" := live_membership."venue_role";
    NEW."membership_updated_at" := date_trunc(
      'milliseconds', live_membership."updated_at"
    );
    membership_material := jsonb_build_object(
      'membershipId', NEW."membership_id"::text,
      'membershipStatus', 'active',
      'membershipUpdatedAt', "hr_iso_utc_ms"(NEW."membership_updated_at"),
      'userId', NEW."actor_id"::text,
      'venueRole', live_membership."venue_role",
      'workspaceId', NEW."workspace_id"::text,
      'workspaceRole', live_membership."role"
    );
    NEW."membership_version_digest" := encode(digest(convert_to(
      E'venviewer.historical-runtime-membership-version.v1\n'
        || "hr_stable_canonical_json"(membership_material),
      'UTF8'
    ), 'sha256'), 'hex');
  ELSE
    IF live_user."platform_role" NOT IN ('operator', 'admin') THEN
      RAISE EXCEPTION 'non-platform actor requires active venue membership'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_authority_snapshot_membership';
    END IF;
    NEW."workspace_state" := 'not_applicable';
    NEW."workspace_role" := NULL;
    NEW."venue_role" := NULL;
    NEW."membership_updated_at" := NULL;
    NEW."membership_version_digest" := NULL;
  END IF;

  IF NEW."platform_role" = 'none'
     AND NEW."user_venue_id" IS DISTINCT FROM NEW."venue_id" THEN
    RAISE EXCEPTION 'venue actor is outside requested venue'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authority_snapshot_venue';
  END IF;

  -- Sample the canonical action instant only after every live authority row
  -- has been locked. A concurrent suspension/update may make the SELECTs
  -- above wait; using a pre-lock instant would backdate the snapshot.
  action_at := "hr_db_clock_ms"();
  NEW."created_at" := action_at;
  NEW."snapshotted_at" := action_at;

  snapshot_material := jsonb_build_object(
    'authenticationSource', NEW."authentication_source",
    'platformRole', NEW."platform_role",
    'snapshottedAt', "hr_iso_utc_ms"(action_at),
    'userRole', NEW."user_role",
    'userVenueId', CASE WHEN NEW."user_venue_id" IS NULL
      THEN 'null'::jsonb ELSE to_jsonb(NEW."user_venue_id"::text) END,
    'venueId', NEW."venue_id"::text,
    'workspaceMembership', CASE WHEN NEW."workspace_state" = 'active'
      THEN jsonb_build_object(
        'membershipId', NEW."membership_id"::text,
        'membershipStatus', 'active',
        'membershipUpdatedAt', "hr_iso_utc_ms"(NEW."membership_updated_at"),
        'membershipVersionDigest', NEW."membership_version_digest",
        'state', 'active',
        'venueRole', NEW."venue_role",
        'workspaceId', NEW."workspace_id"::text,
        'workspaceRole', NEW."workspace_role"
      )
      ELSE jsonb_build_object(
        'reason', 'platform_authority', 'state', 'not_applicable'
      )
    END
  );
  NEW."authority_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-authority-snapshot.v1\n'
      || "hr_stable_canonical_json"(snapshot_material),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."authority_body" := snapshot_material || jsonb_build_object(
    'authorityDigest', NEW."authority_digest"
  );
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'authority actor or membership does not exist'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_authority_snapshot_live_identity';
END;
$$;

CREATE TRIGGER "a_hr_issue_authority_snapshot"
  BEFORE INSERT ON "hr_authority_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_authority_snapshot"();

CREATE OR REPLACE FUNCTION "hr_issue_authenticated_action_assertion"(
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
  action_at timestamptz;
  membership_updated_at timestamptz;
  membership_version_digest text;
  workspace_state text;
  issued_workspace_role text;
  issued_venue_role text;
  membership_body jsonb;
  action_parameters_digest text;
  action_id uuid;
  authentication_session_sha256 text;
  authentication_subject_sha256 text;
  session_issued_at timestamptz;
  session_expires_at timestamptz;
  material_body jsonb;
  assertion_digest text;
  assertion_body jsonb;
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
    RAISE EXCEPTION 'authenticated action requires an isolated gateway login'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_authenticated_action_gateway_isolation';
  END IF;
  action_id := gen_random_uuid();
  IF p_action_kind NOT IN (
    'scope_epoch_revocation', 'provider_capability_revocation',
    'signing_key_authority_revocation', 'role_attestation_revocation',
    'evidence_record_revocation', 'execution_activation_revocation',
    'execution_activation_request'
  ) THEN
    RAISE EXCEPTION 'unsupported authenticated action kind'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_kind';
  END IF;
  IF p_authentication_audience <>
       'venviewer_historical_runtime_evidence' THEN
    RAISE EXCEPTION 'authenticated session audience is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_audience';
  END IF;
  IF length(p_authentication_subject) NOT BETWEEN 1 AND 255
     OR length(p_authentication_session_id) NOT BETWEEN 1 AND 512
     OR p_authentication_subject !~ '^[ -~]+$'
     OR p_authentication_session_id !~ '^[ -~]+$' THEN
    RAISE EXCEPTION 'authenticated session identity is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_session';
  END IF;
  session_issued_at := date_trunc(
    'milliseconds', p_authentication_session_issued_at
  );
  session_expires_at := date_trunc(
    'milliseconds', p_authentication_session_expires_at
  );
  IF session_issued_at IS NULL OR session_expires_at IS NULL
     OR session_issued_at >= session_expires_at THEN
    RAISE EXCEPTION 'authenticated session chronology is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_session';
  END IF;
  IF jsonb_typeof(p_action_parameters) <> 'object' THEN
    RAISE EXCEPTION 'authenticated action parameters must be an object'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_parameters';
  END IF;
  IF p_action_kind LIKE '%_revocation' AND (
    (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
     FROM jsonb_object_keys(p_action_parameters) AS key_name)
      IS DISTINCT FROM ARRAY[
        'incidentReference', 'reason', 'reasonCode', 'targetId'
      ]::text[]
    OR length(btrim(p_action_parameters->>'reason')) NOT BETWEEN 1 AND 500
    OR p_action_parameters->>'reason' <> btrim(p_action_parameters->>'reason')
    OR p_action_parameters->>'reasonCode' NOT IN (
      'administrative_emergency', 'authority_withdrawn',
      'integrity_failure', 'privacy_incident', 'suspected_key_compromise'
    )
    OR length(btrim(p_action_parameters->>'incidentReference'))
      NOT BETWEEN 1 AND 200
    OR p_action_parameters->>'incidentReference' <>
      btrim(p_action_parameters->>'incidentReference')
    OR (p_action_parameters->>'targetId')::uuid IS NULL
  ) THEN
    RAISE EXCEPTION 'revocation action parameters are not strict and canonical'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_parameters';
  ELSIF p_action_kind = 'execution_activation_request' AND (
    (SELECT array_agg(key_name ORDER BY key_name COLLATE "C")
     FROM jsonb_object_keys(p_action_parameters) AS key_name)
      IS DISTINCT FROM ARRAY[
        'canonicalSnapshotId', 'eventId', 'expiresAt', 'phaseId',
        'reviewedProfileEvidenceId'
      ]::text[]
    OR (p_action_parameters->>'canonicalSnapshotId')::uuid IS NULL
    OR (p_action_parameters->>'eventId')::uuid IS NULL
    OR (p_action_parameters->>'phaseId')::uuid IS NULL
    OR (p_action_parameters->>'reviewedProfileEvidenceId')::uuid IS NULL
    OR (p_action_parameters->>'expiresAt')::timestamptz IS NULL
  ) THEN
    RAISE EXCEPTION 'execution action parameters are not strict and canonical'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_parameters';
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
    IF scope_row."environment_mode" <> 'test' THEN
      RAISE EXCEPTION 'local authenticated action is test-only'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_authenticated_action_environment';
    END IF;
    IF p_authentication_subject <> p_authenticated_actor_id::text THEN
      RAISE EXCEPTION 'local authenticated subject does not match actor'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_authenticated_action_subject';
    END IF;
  ELSIF p_authentication_source <> 'clerk_session'
      OR live_user."clerk_id" IS NULL
      OR p_authentication_subject IS DISTINCT FROM live_user."clerk_id" THEN
    RAISE EXCEPTION 'production authenticated action requires Clerk identity'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_authenticated_action_subject';
  END IF;
  IF (p_membership_id IS NULL) <> (p_workspace_id IS NULL) THEN
    RAISE EXCEPTION 'authenticated action membership is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_authenticated_action_membership';
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
       OR live_workspace."primary_venue_id" IS DISTINCT FROM scope_row."venue_id"
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'authenticated action membership is not current'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_authenticated_action_membership';
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
      'venueRole', live_membership."venue_role",
      'workspaceId', p_workspace_id::text,
      'workspaceRole', live_membership."role"
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
      RAISE EXCEPTION 'non-platform authenticated action needs membership'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_authenticated_action_membership';
    END IF;
    workspace_state := 'not_applicable';
    membership_body := jsonb_build_object(
      'reason', 'platform_authority', 'state', 'not_applicable'
    );
  END IF;

  action_at := public."hr_db_clock_ms"();
  IF session_issued_at > action_at OR action_at >= session_expires_at THEN
    RAISE EXCEPTION 'authenticated session is not current'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_authenticated_action_session';
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
    'authenticationSessionIssuedAt',
      public."hr_iso_utc_ms"(session_issued_at),
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
  assertion_body := material_body || jsonb_build_object(
    'assertionDigest', assertion_digest
  );
  INSERT INTO public."hr_authenticated_action_assertions" (
    "id", "audience", "action_kind", "action_id",
    "action_parameters_digest", "action_parameters_body", "environment_id",
    "environment_mode", "environment_digest", "authority_scope_epoch_id",
    "authority_scope_epoch", "authority_scope_epoch_digest",
    "authority_scope_epoch_expires_at", "venue_id", "space_id", "actor_id",
    "authentication_source", "authentication_audience",
    "authentication_session_sha256", "authentication_subject_sha256",
    "authentication_session_issued_at", "authentication_session_expires_at",
    "authenticated_by_database_principal",
    "platform_role", "user_role", "user_venue_id", "workspace_state",
    "membership_id", "workspace_id", "workspace_role", "venue_role",
    "membership_updated_at", "membership_version_digest",
    "authenticated_at", "expires_at", "nonce", "assertion_digest",
    "assertion_body", "created_at"
  ) VALUES (
    p_assertion_id, 'historical_runtime_evidence', p_action_kind, action_id,
    action_parameters_digest, p_action_parameters,
    scope_row."environment_id", scope_row."environment_mode",
    scope_row."environment_digest", scope_row."id", scope_row."epoch",
    scope_row."epoch_digest", scope_row."expires_at", scope_row."venue_id",
    scope_row."space_id", p_authenticated_actor_id, p_authentication_source,
    p_authentication_audience, authentication_session_sha256,
    authentication_subject_sha256, session_issued_at, session_expires_at,
    session_user::text,
    live_user."platform_role",
    live_user."role", live_user."venue_id", workspace_state,
    p_membership_id, p_workspace_id,
    issued_workspace_role, issued_venue_role,
    membership_updated_at, membership_version_digest, action_at,
    LEAST(action_at + interval '5 minutes', session_expires_at,
      scope_row."expires_at"),
    (material_body->>'nonce')::uuid, assertion_digest, assertion_body, action_at
  ) RETURNING * INTO issued;
  RETURN issued;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'authenticated action scope, actor, or membership is missing'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_authenticated_action_identity';
END;
$$;

CREATE OR REPLACE FUNCTION "hr_consume_action_authority"(
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
  assertion_row public."hr_authenticated_action_assertions"%ROWTYPE;
  live_user record;
  live_workspace record;
  live_membership record;
  role_allowed boolean;
  action_at timestamptz;
  wall_now timestamptz;
  material_body jsonb;
  authority_digest text;
  snapshot_id uuid;
  issued public."hr_action_authority_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT assertion_row
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = p_assertion_id
    AND "action_kind" = p_expected_action_kind
  FOR SHARE;
  PERFORM public."hr_lock_scope"(
    assertion_row."environment_id", assertion_row."venue_id",
    assertion_row."space_id"
  );
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
       OR live_membership."workspace_id" IS DISTINCT FROM assertion_row."workspace_id"
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

  role_allowed := CASE
    WHEN p_expected_authority_role = 'revoker' THEN
      CASE
        WHEN assertion_row."action_kind" IN (
          'scope_epoch_revocation', 'provider_capability_revocation',
          'signing_key_authority_revocation'
        ) THEN assertion_row."platform_role" = 'admin'
        WHEN assertion_row."action_kind" IN (
          'role_attestation_revocation', 'evidence_record_revocation',
          'execution_activation_revocation'
        ) THEN assertion_row."platform_role" = 'admin'
          OR (assertion_row."workspace_state" = 'active'
            AND assertion_row."user_venue_id" = assertion_row."venue_id"
            AND assertion_row."workspace_role" IN ('owner', 'admin'))
        ELSE false
      END
    WHEN p_expected_authority_role = 'execution_requester' THEN
      assertion_row."platform_role" IN ('operator', 'admin')
      OR (assertion_row."workspace_state" = 'active'
        AND assertion_row."user_role" IN (
          'planner', 'staff', 'hallkeeper', 'admin'
        )
        AND (assertion_row."workspace_role" IN (
          'owner', 'admin', 'staff', 'hallkeeper'
        ) OR assertion_row."venue_role" = 'hallkeeper'))
    ELSE false
  END;
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
  snapshot_id := gen_random_uuid();

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
    "action_parameters_digest",
    "authentication_assertion_id", "authentication_assertion_digest",
    "authentication_asserted_at", "authentication_assertion_expires_at",
    "environment_id", "environment_mode", "environment_digest",
    "authority_scope_epoch_id", "authority_scope_epoch",
    "authority_scope_epoch_digest", "authority_scope_epoch_expires_at",
    "venue_id", "space_id", "actor_id", "snapshotted_at", "expires_at",
    "authority_digest", "authority_body", "created_at"
  ) VALUES (
    snapshot_id, assertion_row."action_kind", assertion_row."action_id",
    p_expected_authority_role, assertion_row."action_parameters_digest",
    assertion_row."id",
    assertion_row."assertion_digest", assertion_row."authenticated_at",
    assertion_row."expires_at", assertion_row."environment_id",
    assertion_row."environment_mode", assertion_row."environment_digest",
    assertion_row."authority_scope_epoch_id",
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

CREATE TRIGGER "a_hr_require_action_assertion_owner"
  BEFORE INSERT ON "hr_authenticated_action_assertions"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a_hr_require_action_authority_owner"
  BEFORE INSERT ON "hr_action_authority_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a_hr_require_action_assertion_use_owner"
  BEFORE INSERT ON "hr_authenticated_action_assertion_uses"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();

-- A legacy 0064 policy is never directly an evidence root. This scoped
-- wrapper reloads its exact row, binds actual Ed25519 public bytes, and records
-- a DB-time registration under the one configured environment and scope.
CREATE TABLE "hr_signing_key_authorities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "purpose" varchar(80) NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "public_key_bytes" bytea NOT NULL,
  "policy_effective_at" timestamptz NOT NULL,
  "policy_expires_at" timestamptz NOT NULL,
  "registrar_authority_digest" varchar(64) NOT NULL,
  "registrar_authority_body" jsonb NOT NULL,
  "verified_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_signing_keys_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_signing_keys_policy_fk" FOREIGN KEY (
    "key_policy_id", "purpose", "key_policy_digest", "key_id",
    "public_key_fingerprint", "policy_effective_at", "policy_expires_at"
  ) REFERENCES "runtime_execution_key_policies" (
    "id", "purpose", "policy_digest", "key_id", "public_key_fingerprint",
    "effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_signing_keys_shape" CHECK ((
    "purpose" IN (
      'historical_runtime_execution_activation',
      'historical_runtime_capture_content_identity',
      'historical_runtime_role_attestation'
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
  ) IS TRUE),
  CONSTRAINT "hr_signing_keys_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "key_policy_id", "purpose",
    "key_policy_digest", "key_id", "public_key_fingerprint",
    "policy_effective_at", "expires_at"
  ),
  CONSTRAINT "hr_signing_keys_policy_scope_unique" UNIQUE (
    "key_policy_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id", "purpose"
  )
);

CREATE TABLE "hr_signing_key_authority_revocations" (
  "signing_key_authority_id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "purpose" varchar(80) NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "policy_effective_at" timestamptz NOT NULL,
  "authority_expires_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_signing_key_revocations_authority_fk" FOREIGN KEY (
    "signing_key_authority_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "key_policy_id", "purpose", "key_policy_digest", "key_id",
    "public_key_fingerprint", "policy_effective_at", "authority_expires_at"
  ) REFERENCES "hr_signing_key_authorities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "key_policy_id", "purpose",
    "key_policy_digest", "key_id", "public_key_fingerprint",
    "policy_effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_signing_key_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "revoked_at" = "created_at"
    AND jsonb_typeof("revocation_body") = 'object'
  ) IS TRUE)
);

-- Role attestations use a two-step custody boundary: PostgreSQL persists the
-- exact server-issued payload bytes first, then accepts only an exact envelope
-- verified against a purpose-scoped current key. Parsed JSON is diagnostic;
-- raw bytes remain the authority source.
CREATE TABLE "hr_role_attestation_drafts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "role" varchar(50) NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "authority_snapshot_id" uuid NOT NULL,
  "authority_digest" varchar(64) NOT NULL,
  "authority_body" jsonb NOT NULL,
  "authority_snapshotted_at" timestamptz NOT NULL,
  "evidence_document_receipt_id" uuid NOT NULL,
  "evidence_document_receipt_role" varchar(40) NOT NULL,
  "evidence_document_receipt_digest" varchar(64) NOT NULL,
  "evidence_document_expires_at" timestamptz NOT NULL,
  "evidence_scope_digest" varchar(64) NOT NULL,
  "bound_kind" varchar(60) NOT NULL,
  "bound_reference" varchar(200) NOT NULL,
  "bound_digest" varchar(64) NOT NULL,
  "evidence_digest" varchar(64) NOT NULL,
  "evidence_body" jsonb NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "signing_key_authority_id" uuid NOT NULL,
  "key_policy_purpose" varchar(80) NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "key_effective_at" timestamptz NOT NULL,
  "key_expires_at" timestamptz NOT NULL,
  "role_subject_digest" varchar(64) NOT NULL,
  "payload_type" varchar(160) NOT NULL,
  "payload_bytes" bytea NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "payload_byte_length" integer NOT NULL,
  "nonce" uuid NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "subject_body" jsonb NOT NULL,
  "statement_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_role_drafts_subject_fk" FOREIGN KEY (
    "subject_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_drafts_snapshot_fk" FOREIGN KEY (
    "authority_snapshot_id", "id", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "actor_id", "authority_digest",
    "authority_body", "authority_snapshotted_at"
  ) REFERENCES "hr_authority_snapshots" (
    "id", "attestation_id", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "actor_id", "authority_digest", "authority_body",
    "snapshotted_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_drafts_document_fk" FOREIGN KEY (
    "evidence_document_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "evidence_document_receipt_role",
    "evidence_document_receipt_digest", "venue_id", "space_id",
    "evidence_document_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "receipt_role", "receipt_digest", "venue_id", "space_id",
    "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_drafts_key_fk" FOREIGN KEY (
    "signing_key_authority_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "key_policy_id", "key_policy_purpose", "key_policy_digest", "key_id",
    "public_key_fingerprint", "key_effective_at", "key_expires_at"
  ) REFERENCES "hr_signing_key_authorities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "key_policy_id", "purpose",
    "key_policy_digest", "key_id", "public_key_fingerprint",
    "policy_effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_drafts_shape" CHECK ((
    "environment_mode" IN ('production', 'test')
    AND "evidence_document_receipt_role" = 'evidence_document'
    AND "key_policy_purpose" = 'historical_runtime_role_attestation'
    AND octet_length("key_id") BETWEEN 1 AND 128
    AND "key_id" ~ '^[ -~]+$'
    AND "public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "authority_digest" ~ '^[a-f0-9]{64}$'
    AND "evidence_scope_digest" ~ '^[a-f0-9]{64}$'
    AND "bound_digest" ~ '^[a-f0-9]{64}$'
    AND "evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "role_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "payload_type" =
      'application/vnd.venviewer.historical-runtime-role-attestation.v1+json'
    AND "payload_byte_length" = octet_length("payload_bytes")
    AND "payload_byte_length" BETWEEN 1 AND 524288
    AND encode(digest("payload_bytes", 'sha256'), 'hex') = "payload_sha256"
    AND convert_from("payload_bytes", 'UTF8')::jsonb = "statement_body"
    AND "subject_body"->>'schemaVersion' =
      'historical-runtime-role-attestation.v1'
    AND ("subject_body"->>'attestationId')::uuid = "id"
    AND ("subject_body"->>'subjectId')::uuid = "subject_id"
    AND "subject_body"->>'subjectKind' = "subject_kind"
    AND "subject_body"->>'tenantBoundary' = 'venue_id_v1'
    AND ("subject_body"->>'tenantId')::uuid = "venue_id"
    AND ("subject_body"->>'venueId')::uuid = "venue_id"
    AND ("subject_body"->>'spaceId')::uuid = "space_id"
    AND "subject_body"->>'role' = "role"
    AND ("subject_body"->>'actorId')::uuid = "actor_id"
    AND "subject_body"->'evidence' = "evidence_body"
    AND "subject_body"->'authoritySnapshot' = "authority_body"
    AND "subject_body"->'authoritySnapshot'->>'authorityDigest' =
      "authority_digest"
    AND ("authority_body"->>'snapshottedAt')::timestamptz =
      "authority_snapshotted_at"
    AND "authority_snapshotted_at" <= "recorded_at"
    AND "evidence_body"->>'role' = "role"
    AND "hr_role_evidence_document"("evidence_body", "role")->>
      'scopeDigest' = "evidence_scope_digest"
    AND (
      "hr_role_evidence_document"("evidence_body", "role")
        ->'documentReceipt'->>'receiptId'
    )::uuid = "evidence_document_receipt_id"
    AND "hr_role_evidence_document"("evidence_body", "role")
      ->'documentReceipt'->>'receiptDigest' =
      "evidence_document_receipt_digest"
    AND (
      "hr_role_evidence_document"("evidence_body", "role")
        ->'documentReceipt'->'anonymousAccessDenial'->>'expiresAt'
    )::timestamptz = "evidence_document_expires_at"
    AND "bound_reference" = "subject_id"::text
    AND (
      ("role" = 'capture_operator'
        AND "bound_kind" = 'capture_lineage'
        AND "bound_digest" = "evidence_scope_digest")
      OR ("role" IN (
          'source_custodian', 'owner_authorizer', 'privacy_reviewer',
          'movable_content_reviewer'
        ) AND "bound_kind" = 'source_receipt_set'
        AND "bound_digest" = "evidence_body"->>'sourceReceiptSetDigest')
      OR ("role" = 'normalizer'
        AND "bound_kind" = 'capture_content_subject'
        AND "bound_digest" =
          "evidence_body"->>'captureContentSubjectDigest')
      OR ("role" = 'capture_final_reviewer'
        AND "bound_kind" = 'capture_root_evidence'
        AND "bound_digest" = "evidence_body"->>'captureRootEvidenceDigest')
      OR ("role" = 'derivative_producer'
        AND "bound_kind" = 'conversion_recipe'
        AND "bound_digest" = "evidence_body"->>'conversionRecipeDigest')
      OR ("role" IN ('derivative_custodian', 'derivative_reviewer')
        AND "bound_kind" = 'derivation_members'
        AND "bound_digest" = "evidence_body"->>'outputReceiptSetDigest')
      OR ("role" = 'package_custodian'
        AND "bound_kind" = 'runtime_manifest'
        AND "bound_digest" = "evidence_body"->>'runtimeManifestDigest')
      OR ("role" = 'qa_reviewer'
        AND "bound_kind" = 'runtime_qa_record'
        AND "bound_digest" = "evidence_body"->>'runtimeQaRecordDigest')
      OR ("role" = 'transform_reviewer'
        AND "bound_kind" = 'transform_review_subject'
        AND "bound_digest" =
          "evidence_body"->>'transformReviewSubjectDigest')
      OR ("role" = 'rights_reviewer'
        AND "bound_kind" = 'rights_clearance_subject'
        AND "bound_digest" =
          "evidence_body"->>'rightsClearanceSubjectDigest')
      OR ("role" = 'scene_reviewer'
        AND "bound_kind" = 'scene_validation_subject'
        AND "bound_digest" =
          "evidence_body"->>'sceneValidationSubjectDigest')
      OR ("role" = 'admission_reviewer'
        AND "bound_kind" = 'presentation_admission'
        AND "bound_digest" =
          "evidence_body"->>'presentationAdmissionDigest')
      OR ("role" = 'profile_final_reviewer'
        AND "bound_kind" = 'reviewed_profile_subject'
        AND "bound_digest" =
          "evidence_body"->>'reviewedProfileSubjectDigest')
      OR ("role" = 'execution_reviewer'
        AND "bound_kind" = 'execution_activation_subject'
        AND "bound_digest" =
          "evidence_body"->>'executionActivationSubjectDigest')
    )
    AND (
      ("role" = 'capture_operator'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-capture-operator.v1'
        AND "evidence_body"->>'captureClass' IN (
          'owner_authorized_existing_capture',
          'venue_operator_direct_camera'
        )
        AND "evidence_body"->>'lineageStartKind' IN (
          'raw_capture_object', 'direct_camera_capture_bundle',
          'processed_capture_package'
        )
        AND "evidence_body"->>'ancestorState' IN (
          'exact_private_receipt', 'owner_attested_unavailable_ancestor'
        )
        AND jsonb_typeof("evidence_body"->'captureTime') = 'object'
        AND jsonb_typeof("evidence_body"->'captureDevice') = 'object')
      OR ("role" = 'source_custodian'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-source-custodian.v1')
      OR ("role" = 'owner_authorizer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-owner-authorization.v1'
        AND "evidence_body"->>'decision' = 'approved'
        AND "evidence_body"->'authorizedOperations' =
          '["store_private","convert","render","generate_derivatives","internal_planning","customer_presentation"]'::jsonb)
      OR ("role" = 'privacy_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-privacy-review.v1'
        AND "evidence_body"->>'decision' = 'approved'
        AND "evidence_body"->'reviewedCategories' =
          '["faces","personal_documents","vehicle_registrations","access_credentials","private_conversations"]'::jsonb)
      OR ("role" = 'movable_content_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-movable-content-review.v1'
        AND "evidence_body"->>'decision' = 'approved'
        AND "evidence_body"->>'treatment' IN (
          'accepted_as_captured', 'masked', 'removed',
          'segmented_non_authoritative'
        )
        AND "evidence_body"->'reviewedCategories' =
          '["furniture","decor","event_dressing","people","temporary_equipment"]'::jsonb)
      OR ("role" = 'normalizer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-normalizer.v1')
      OR ("role" = 'capture_final_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-capture-final-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'derivative_producer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-derivative-producer.v1')
      OR ("role" = 'derivative_custodian'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-derivative-custodian.v1')
      OR ("role" = 'derivative_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-derivative-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'package_custodian'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-package-custodian.v1')
      OR ("role" = 'qa_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-qa-review.v1'
        AND "evidence_body"->>'decision' IN (
          'approved_internal_preview', 'approved_public'
        ))
      OR ("role" = 'transform_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-transform-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'rights_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-rights-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'scene_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-scene-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'admission_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-admission-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'profile_final_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-profile-final-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
      OR ("role" = 'execution_reviewer'
        AND "evidence_body"->>'schemaVersion' =
          'historical-runtime-role-execution-review.v1'
        AND "evidence_body"->>'decision' = 'approved')
    )
    AND ("subject_body"->>'keyPolicyId')::uuid = "key_policy_id"
    AND "subject_body"->>'keyPolicyDigest' = "key_policy_digest"
    AND "subject_body"->>'keyId' = "key_id"
    AND "subject_body"->>'signerPublicKeySha256' =
      'sha256:' || "public_key_fingerprint"
    AND ("subject_body"->>'recordedAt')::timestamptz = "recorded_at"
    AND ("subject_body"->>'effectiveAt')::timestamptz = "effective_at"
    AND ("subject_body"->>'expiresAt')::timestamptz = "expires_at"
    AND ("subject_body"->>'nonce')::uuid = "nonce"
    AND "subject_body"->>'roleAttestationSubjectDigest' =
      "role_subject_digest"
    AND "statement_body"->>'authority' = 'venue_evidence'
    AND "statement_body"->>'evidenceKind' =
      'historical_runtime_role_attestation'
    AND "statement_body"->>'schemaVersion' =
      'historical-runtime-role-attestation-statement.v1'
    AND "statement_body"->>'subjectName' =
      'historical-runtime-role-attestation/' || "id"::text
    AND "statement_body"->>'subjectDigest' = "role_subject_digest"
    AND ("statement_body"->'predicate'->>'attestationId')::uuid = "id"
    AND "statement_body"->'predicate'->>'roleAttestationSubjectDigest' =
      "role_subject_digest"
    AND "statement_body"->'predicate'->>'subjectKind' = "subject_kind"
    AND "statement_body"->'predicate'->>'role' = "role"
    AND ("statement_body"->'predicate'->>'actorId')::uuid = "actor_id"
    AND ("statement_body"->'predicate'->>'tenantId')::uuid = "venue_id"
    AND ("statement_body"->'predicate'->>'venueId')::uuid = "venue_id"
    AND ("statement_body"->'predicate'->>'spaceId')::uuid = "space_id"
    AND ("statement_body"->'predicate'->>'keyPolicyId')::uuid =
      "key_policy_id"
    AND "statement_body"->'predicate'->>'keyPolicyDigest' =
      "key_policy_digest"
    AND "statement_body"->'predicate'->>'keyId' = "key_id"
    AND "statement_body"->'predicate'->>'signerPublicKeySha256' =
      'sha256:' || "public_key_fingerprint"
    AND ("statement_body"->'predicate'->>'issuedAt')::timestamptz =
      "recorded_at"
    AND ("statement_body"->'predicate'->>'effectiveAt')::timestamptz =
      "effective_at"
    AND ("statement_body"->'predicate'->>'expiresAt')::timestamptz =
      "expires_at"
    AND ("statement_body"->'predicate'->>'nonce')::uuid = "nonce"
    AND "recorded_at" = "created_at"
    AND "recorded_at" <= "effective_at"
    AND "effective_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "effective_at" + interval '365 days', "key_expires_at",
      "evidence_document_expires_at"
    )
    AND "key_effective_at" <= "recorded_at"
    AND (
      ("role" IN (
        'capture_operator', 'source_custodian', 'owner_authorizer',
        'privacy_reviewer', 'movable_content_reviewer', 'normalizer',
        'capture_final_reviewer'
      ) AND "subject_kind" = 'capture_import')
      OR ("role" IN (
        'derivative_producer', 'derivative_custodian', 'derivative_reviewer'
      ) AND "subject_kind" = 'derivation')
      OR ("role" = 'transform_reviewer' AND "subject_kind" = 'transform_review')
      OR ("role" = 'rights_reviewer' AND "subject_kind" = 'rights_clearance')
      OR ("role" = 'scene_reviewer' AND "subject_kind" = 'scene_validation')
      OR ("role" IN (
        'package_custodian', 'qa_reviewer', 'admission_reviewer',
        'profile_final_reviewer'
      ) AND "subject_kind" = 'reviewed_profile')
      OR ("role" = 'execution_reviewer'
        AND "subject_kind" = 'execution_activation')
    )
    AND jsonb_typeof("evidence_body") = 'object'
    AND jsonb_typeof("subject_body") = 'object'
    AND jsonb_typeof("statement_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_role_drafts_nonce_unique" UNIQUE ("nonce"),
  CONSTRAINT "hr_role_drafts_exact_unique" UNIQUE (
    "id", "role_subject_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "key_policy_id",
    "signing_key_authority_id", "key_policy_digest", "key_id",
    "public_key_fingerprint", "payload_sha256", "payload_byte_length",
    "effective_at", "expires_at"
  )
);

CREATE INDEX "hr_role_drafts_subject_idx" ON "hr_role_attestation_drafts" (
  "subject_id", "role", "effective_at", "expires_at", "id"
);

CREATE TABLE "hr_role_attestations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "attestation_digest" varchar(64) NOT NULL,
  "role_subject_digest" varchar(64) NOT NULL,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "role" varchar(50) NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "bound_kind" varchar(60) NOT NULL,
  "bound_reference" varchar(200) NOT NULL,
  "bound_digest" varchar(64) NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "signing_key_authority_id" uuid NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "payload_bytes" bytea NOT NULL,
  "payload_byte_length" integer NOT NULL,
  "envelope_sha256" varchar(71) NOT NULL,
  "envelope_bytes" bytea NOT NULL,
  "envelope_byte_length" integer NOT NULL,
  "verifier_receipt_sha256" varchar(71) NOT NULL,
  "signer_public_key_sha256" varchar(71) NOT NULL,
  "envelope_body" jsonb NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "attestation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_role_attestations_draft_fk" FOREIGN KEY (
    "id", "role_subject_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "key_policy_id",
    "signing_key_authority_id", "key_policy_digest", "key_id",
    "public_key_fingerprint", "payload_sha256", "payload_byte_length",
    "effective_at", "expires_at"
  ) REFERENCES "hr_role_attestation_drafts" (
    "id", "role_subject_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "key_policy_id",
    "signing_key_authority_id", "key_policy_digest", "key_id",
    "public_key_fingerprint", "payload_sha256", "payload_byte_length",
    "effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_attestations_shape" CHECK ((
    "attestation_digest" ~ '^[a-f0-9]{64}$'
    AND "envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "verifier_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "signer_public_key_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "signer_public_key_sha256" = 'sha256:' || "public_key_fingerprint"
    AND "envelope_byte_length" = octet_length("envelope_bytes")
    AND "envelope_byte_length" BETWEEN 1 AND 1048576
    AND "payload_byte_length" BETWEEN 1 AND 524288
    AND encode(digest("payload_bytes", 'sha256'), 'hex') = "payload_sha256"
    AND encode(digest(
      convert_to(E'venviewer.historical-runtime-role-attestation.v1.dsse-envelope\n', 'UTF8')
      || "envelope_bytes", 'sha256'
    ), 'hex') = substring("envelope_sha256" from 8)
    AND encode(digest(
      convert_to(E'venviewer.historical-runtime-role-attestation.v1\n', 'UTF8')
      || "payload_bytes", 'sha256'
    ), 'hex') = substring("verifier_receipt_sha256" from 8)
    AND convert_from("envelope_bytes", 'UTF8')::jsonb = "envelope_body"
    AND "envelope_body"->>'payloadType' =
      'application/vnd.venviewer.historical-runtime-role-attestation.v1+json'
    AND decode("envelope_body"->>'payload', 'base64') = "payload_bytes"
    AND jsonb_typeof("envelope_body"->'signatures') = 'array'
    AND jsonb_array_length("envelope_body"->'signatures') = 1
    AND "envelope_body"#>>'{signatures,0,keyid}' = "key_id"
    AND octet_length(decode(
      "envelope_body"#>>'{signatures,0,sig}', 'base64'
    )) = 64
    AND convert_from("payload_bytes", 'UTF8')::jsonb =
      "attestation_body"->'statement'
    AND "attestation_body"->>'attestationDigest' = "attestation_digest"
    AND "attestation_body"->'subject'->>'roleAttestationSubjectDigest' =
      "role_subject_digest"
    AND ("attestation_body"->'subject'->>'attestationId')::uuid = "id"
    AND ("attestation_body"->'subject'->>'subjectId')::uuid = "subject_id"
    AND "attestation_body"->'subject'->>'subjectKind' = "subject_kind"
    AND "attestation_body"->'subject'->>'role' = "role"
    AND ("attestation_body"->'subject'->>'actorId')::uuid = "actor_id"
    AND ("attestation_body"->'subject'->>'tenantId')::uuid = "venue_id"
    AND ("attestation_body"->'subject'->>'venueId')::uuid = "venue_id"
    AND ("attestation_body"->'subject'->>'spaceId')::uuid = "space_id"
    AND ("attestation_body"->'subject'->>'keyPolicyId')::uuid =
      "key_policy_id"
    AND "attestation_body"->'subject'->>'keyPolicyDigest' =
      "key_policy_digest"
    AND "attestation_body"->'subject'->>'keyId' = "key_id"
    AND "attestation_body"->'subject'->>'signerPublicKeySha256' =
      "signer_public_key_sha256"
    AND ("attestation_body"->'subject'->>'effectiveAt')::timestamptz =
      "effective_at"
    AND ("attestation_body"->'subject'->>'expiresAt')::timestamptz =
      "expires_at"
    AND "attestation_body"->'rawEvidence'->>'payloadType' =
      'application/vnd.venviewer.historical-runtime-role-attestation.v1+json'
    AND "attestation_body"->'rawEvidence'->>'payloadUtf8' =
      convert_from("payload_bytes", 'UTF8')
    AND "attestation_body"->'rawEvidence'->>'envelopeUtf8' =
      convert_from("envelope_bytes", 'UTF8')
    AND "attestation_body"->'rawEvidence'->>'payloadSha256' =
      "payload_sha256"
    AND "attestation_body"->'rawEvidence'->>'receiptSha256' =
      "verifier_receipt_sha256"
    AND "attestation_body"->'rawEvidence'->>'envelopeSha256' =
      "envelope_sha256"
    AND "attestation_body"->'rawEvidence'->>'signerPublicKeySha256' =
      "signer_public_key_sha256"
    AND ("attestation_body"->'rawEvidence'->>'payloadByteLength')::integer =
      "payload_byte_length"
    AND ("attestation_body"->'rawEvidence'->>'envelopeByteLength')::integer =
      "envelope_byte_length"
    AND ("attestation_body"->'rawEvidence'->>'verifiedAt')::timestamptz =
      "verified_at"
    AND "verified_at" = "created_at"
    AND "verified_at" >= "effective_at"
    AND "verified_at" < "expires_at"
    AND jsonb_typeof("envelope_body") = 'object'
    AND jsonb_typeof("attestation_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_role_attestations_exact_unique" UNIQUE (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ),
  CONSTRAINT "hr_role_attestations_scope_unique" UNIQUE (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "expires_at"
  ),
  CONSTRAINT "hr_role_attestations_actor_unique" UNIQUE (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  )
);

CREATE TABLE "hr_role_attestation_revocations" (
  "attestation_id" uuid PRIMARY KEY NOT NULL,
  "attestation_digest" varchar(64) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "attestation_expires_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_role_revocations_attestation_fk" FOREIGN KEY (
    "attestation_id", "attestation_digest", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "attestation_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_role_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "revoked_at" = "created_at"
    AND jsonb_typeof("revocation_body") = 'object'
  ) IS TRUE)
);

CREATE TABLE "hr_source_receipt_sets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "capture_subject_id" uuid NOT NULL,
  "capture_subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "lineage_start_kind" varchar(50) NOT NULL,
  "ancestor_state" varchar(60) NOT NULL,
  "unavailable_attestation_id" uuid,
  "unavailable_attestation_digest" varchar(64),
  "unavailable_actor_id" uuid,
  "unavailable_expires_at" timestamptz,
  "unavailable_role" varchar(50),
  "unavailable_bound_kind" varchar(60),
  "unavailable_bound_reference" varchar(200),
  "unavailable_bound_digest" varchar(64),
  "root_component_index" integer NOT NULL,
  "member_count" integer NOT NULL,
  "total_bytes" bigint NOT NULL,
  "receipt_set_digest" varchar(64) NOT NULL,
  "receipt_set_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_source_sets_subject_fk" FOREIGN KEY (
    "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_sets_unavailable_fk" FOREIGN KEY (
    "unavailable_attestation_id", "unavailable_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "unavailable_role", "unavailable_actor_id",
    "unavailable_bound_kind", "unavailable_bound_reference",
    "unavailable_bound_digest", "unavailable_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_sets_shape" CHECK ((
    "lineage_start_kind" IN (
      'raw_capture_object', 'direct_camera_capture_bundle',
      'processed_capture_package'
    )
    AND "capture_subject_kind" = 'capture_import'
    AND "ancestor_state" IN (
      'exact_private_receipt', 'owner_attested_unavailable_ancestor'
    )
    AND "root_component_index" >= 0
    AND "member_count" BETWEEN 1 AND 256
    AND "root_component_index" < "member_count"
    AND "total_bytes" BETWEEN 1 AND 1099511627776
    AND "receipt_set_digest" ~ '^[a-f0-9]{64}$'
    AND (
      ("ancestor_state" = 'owner_attested_unavailable_ancestor'
        AND "unavailable_attestation_id" IS NOT NULL
        AND "unavailable_attestation_digest" IS NOT NULL
        AND "unavailable_actor_id" IS NOT NULL
        AND "unavailable_expires_at" > "created_at"
        AND "unavailable_role" = 'capture_operator'
        AND "unavailable_bound_kind" = 'capture_lineage'
        AND "unavailable_bound_reference" = "capture_subject_id"::text
        AND "unavailable_bound_digest" ~ '^[a-f0-9]{64}$')
      OR ("ancestor_state" = 'exact_private_receipt'
        AND "unavailable_attestation_id" IS NULL
        AND "unavailable_attestation_digest" IS NULL
        AND "unavailable_actor_id" IS NULL
        AND "unavailable_expires_at" IS NULL
        AND "unavailable_role" IS NULL
        AND "unavailable_bound_kind" IS NULL
        AND "unavailable_bound_reference" IS NULL
        AND "unavailable_bound_digest" IS NULL)
    )
    AND jsonb_typeof("receipt_set_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_source_sets_exact_unique" UNIQUE (
    "id", "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "receipt_set_digest", "root_component_index", "member_count",
    "total_bytes"
  ),
  CONSTRAINT "hr_source_sets_scope_unique" UNIQUE (
    "id", "capture_subject_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "receipt_set_digest"
  )
);

CREATE TABLE "hr_source_receipt_members" (
  "source_set_id" uuid NOT NULL,
  "capture_subject_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "receipt_set_digest" varchar(64) NOT NULL,
  "component_index" integer NOT NULL,
  "role" varchar(50) NOT NULL,
  "relative_path" text NOT NULL,
  "receipt_id" uuid NOT NULL,
  "receipt_role" varchar(40) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "capability_id" uuid NOT NULL,
  "capability_digest" varchar(64) NOT NULL,
  "provider_profile" varchar(40) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_account_sha256" varchar(64) NOT NULL,
  "endpoint_authority_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "receipt_digest" varchar(64) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "mime_type" varchar(160) NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "version_kind" varchar(50) NOT NULL,
  "storage_version" varchar(512) NOT NULL,
  "storage_etag" varchar(512) NOT NULL,
  "receipt_expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_source_members_pkey"
    PRIMARY KEY ("source_set_id", "component_index"),
  CONSTRAINT "hr_source_members_set_fk" FOREIGN KEY (
    "source_set_id", "capture_subject_id", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "receipt_set_digest"
  ) REFERENCES "hr_source_receipt_sets" (
    "id", "capture_subject_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "receipt_set_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_members_receipt_authority_fk" FOREIGN KEY (
    "receipt_id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_members_receipt_bytes_fk" FOREIGN KEY (
    "receipt_id", "sha256", "size_bytes", "file_name", "mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_members_receipt_version_fk" FOREIGN KEY (
    "receipt_id", "storage_key_sha256", "version_kind", "storage_version"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_key_sha256", "version_kind", "storage_version"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_members_receipt_etag_fk" FOREIGN KEY (
    "receipt_id", "storage_etag"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_etag"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_source_members_shape" CHECK ((
    "component_index" BETWEEN 0 AND 255
    AND "role" IN (
      'raw_capture', 'inventory_manifest', 'processed_package_archive',
      'processed_package_member', 'supporting_capture_metadata'
    )
    AND (
      ("role" IN ('raw_capture', 'inventory_manifest', 'processed_package_archive')
        AND "receipt_role" = 'source_root')
      OR ("role" = 'processed_package_member'
        AND "receipt_role" = 'source_member')
      OR ("role" = 'supporting_capture_metadata'
        AND "receipt_role" = 'supporting_metadata')
    )
    AND length("relative_path") BETWEEN 1 AND 1024
    AND octet_length("relative_path") <= 512
    AND "relative_path" !~ '(^/|\\\\|(^|/)\.\.?(/|$)|//|[?#])'
    AND "created_at" < "receipt_expires_at"
  ) IS TRUE),
  CONSTRAINT "hr_source_members_path_unique"
    UNIQUE ("source_set_id", "relative_path"),
  CONSTRAINT "hr_source_members_receipt_unique"
    UNIQUE ("source_set_id", "receipt_id"),
  CONSTRAINT "hr_source_members_receipt_digest_unique"
    UNIQUE ("source_set_id", "receipt_digest"),
  CONSTRAINT "hr_source_members_contract_object_unique" UNIQUE (
    "source_set_id", "provider_kind", "provider_account_sha256",
    "private_bucket_sha256", "storage_key_sha256", "version_kind",
    "storage_version"
  ),
  CONSTRAINT "hr_source_members_object_unique" UNIQUE (
    "source_set_id", "provider_profile", "provider_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "storage_key_sha256", "version_kind",
    "storage_version"
  ),
  CONSTRAINT "hr_source_members_exact_unique" UNIQUE (
    "source_set_id", "component_index", "role", "relative_path",
    "receipt_id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "receipt_digest", "sha256", "size_bytes"
  )
);

CREATE TABLE "hr_normalized_content_identities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "capture_subject_id" uuid NOT NULL,
  "capture_subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "source_set_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "source_receipt_set_digest" varchar(64) NOT NULL,
  "source_member_count" integer NOT NULL,
  "source_total_bytes" bigint NOT NULL,
  "root_component_index" integer NOT NULL,
  "root_role" varchar(50) NOT NULL,
  "root_relative_path" text NOT NULL,
  "root_receipt_id" uuid NOT NULL,
  "root_receipt_digest" varchar(64) NOT NULL,
  "root_sha256" varchar(64) NOT NULL,
  "root_size_bytes" bigint NOT NULL,
  "detected_source_format" varchar(50) NOT NULL,
  "normalization_spec" varchar(80) NOT NULL,
  "format_tag" varchar(20),
  "normalization_profile_version" varchar(80) NOT NULL,
  "test_vector_set_digest" varchar(64) NOT NULL,
  "decoder_name" varchar(120) NOT NULL,
  "decoder_version" varchar(120) NOT NULL,
  "decoder_binary_sha256" varchar(64) NOT NULL,
  "normalized_sha256" varchar(64) NOT NULL,
  "normalized_size_bytes" bigint NOT NULL,
  "width_pixels" bigint,
  "height_pixels" bigint,
  "row_stride_bytes" bigint,
  "frame_count" bigint,
  "frame_byte_length" bigint,
  "point_count" bigint,
  "scan_count" bigint,
  "record_count" bigint,
  "record_stride_bytes" bigint,
  "header_size_bytes" bigint,
  "header_sha256" varchar(64),
  "property_layout_digest" varchar(64),
  "vertex_count" bigint,
  "index_count" bigint,
  "vertex_record_stride_bytes" bigint,
  "index_record_stride_bytes" bigint,
  "topology" varchar(50),
  "inventory_object_count" integer,
  "inventory_byte_length" bigint,
  "inventory_members_digest" varchar(64),
  "normalization_digest" varchar(64) NOT NULL,
  "normalization_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_normalized_identities_source_fk" FOREIGN KEY (
    "source_set_id", "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "source_receipt_set_digest", "root_component_index",
    "source_member_count", "source_total_bytes"
  ) REFERENCES "hr_source_receipt_sets" (
    "id", "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "receipt_set_digest", "root_component_index", "member_count",
    "total_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_normalized_identities_root_fk" FOREIGN KEY (
    "source_set_id", "root_component_index", "root_role", "root_relative_path",
    "root_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "root_receipt_digest",
    "root_sha256", "root_size_bytes"
  ) REFERENCES "hr_source_receipt_members" (
    "source_set_id", "component_index", "role", "relative_path", "receipt_id",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "receipt_digest", "sha256", "size_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_normalized_identities_shape" CHECK ((
    "normalization_profile_version" = 'historical-runtime-normalization-profile.v1'
    AND "capture_subject_kind" = 'capture_import'
    AND "normalized_sha256" ~ '^[a-f0-9]{64}$'
    AND "normalization_digest" ~ '^[a-f0-9]{64}$'
    AND "test_vector_set_digest" ~ '^[a-f0-9]{64}$'
    AND "decoder_binary_sha256" ~ '^[a-f0-9]{64}$'
    AND "normalized_size_bytes" BETWEEN 1 AND 68719476736
    AND (
      ("detected_source_format" = 'e57'
        AND "normalization_spec" = 'e57-cartesian-points-f64.v1'
        AND "point_count" > 0 AND "scan_count" > 0
        AND "record_stride_bytes" = 24
        AND "normalized_size_bytes" = "point_count" * 24)
      OR ("detected_source_format" IN (
          'panorama_jpeg', 'panorama_png', 'panorama_tiff'
        ) AND "normalization_spec" = 'panorama-rgb8-srgb-top-left.v1'
        AND "width_pixels" > 0 AND "height_pixels" > 0
        AND "row_stride_bytes" = "width_pixels" * 3
        AND "frame_count" = 1
        AND "frame_byte_length" = "row_stride_bytes" * "height_pixels"
        AND "normalized_size_bytes" = "frame_byte_length")
      OR ("detected_source_format" IN ('video_mp4', 'video_quicktime')
        AND "normalization_spec" =
          'video-frame-sequence-rgb8-srgb-top-left.v1'
        AND "width_pixels" > 0 AND "height_pixels" > 0
        AND "row_stride_bytes" = "width_pixels" * 3
        AND "frame_count" > 0
        AND "frame_byte_length" = "row_stride_bytes" * "height_pixels"
        AND "normalized_size_bytes" = "frame_byte_length" * "frame_count")
      OR ("detected_source_format" = 'ply'
        AND "normalization_spec" = 'ply-binary-little-endian-records.v1'
        AND "record_count" > 0 AND "record_stride_bytes" > 0
        AND "header_size_bytes" >= 0
        AND "header_sha256" ~ '^[a-f0-9]{64}$'
        AND "property_layout_digest" ~ '^[a-f0-9]{64}$'
        AND "normalized_size_bytes" = "header_size_bytes"
          + "record_count" * "record_stride_bytes")
      OR ("detected_source_format" = 'obj'
        AND "normalization_spec" = 'obj-indexed-geometry-f64.v1'
        AND "vertex_count" > 0 AND "index_count" > 0
        AND "vertex_record_stride_bytes" = 24
        AND "index_record_stride_bytes" = 4
        AND "topology" IN ('triangles', 'mixed-polygons-preserved')
        AND "normalized_size_bytes" = "vertex_count" * 24 + "index_count" * 4)
      OR ("detected_source_format" IN ('sog', 'spz')
        AND "normalization_spec" = 'raw-bytes-exact.v1'
        AND "format_tag" = "detected_source_format"
        AND "normalized_sha256" = "root_sha256"
        AND "normalized_size_bytes" = "root_size_bytes")
      OR ("detected_source_format" = 'processed_package_inventory'
        AND "normalization_spec" = 'ordered-object-inventory.v1'
        AND "inventory_object_count" = "source_member_count"
        AND "inventory_byte_length" = "normalized_size_bytes"
        AND "inventory_members_digest" ~ '^[a-f0-9]{64}$')
    )
    AND jsonb_typeof("normalization_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_normalized_identities_exact_unique" UNIQUE (
    "id", "capture_subject_id", "capture_subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "source_set_id",
    "venue_id", "space_id", "source_receipt_set_digest",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes"
  ),
  CONSTRAINT "hr_normalized_identities_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "normalization_digest"
  ),
  CONSTRAINT "hr_normalized_identities_inventory_parent_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "normalization_digest", "source_set_id"
  )
);

CREATE TABLE "hr_normalized_inventory_members" (
  "normalization_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "normalization_digest" varchar(64) NOT NULL,
  "source_set_id" uuid NOT NULL,
  "component_index" integer NOT NULL,
  "role" varchar(50) NOT NULL,
  "relative_path" text NOT NULL,
  "receipt_id" uuid NOT NULL,
  "receipt_digest" varchar(64) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_normalized_inventory_members_pkey"
    PRIMARY KEY ("normalization_id", "component_index"),
  CONSTRAINT "hr_norm_inventory_members_identity_fk" FOREIGN KEY (
    "normalization_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "normalization_digest",
    "source_set_id"
  ) REFERENCES "hr_normalized_content_identities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "normalization_digest", "source_set_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_norm_inventory_members_source_fk" FOREIGN KEY (
    "source_set_id", "component_index", "role", "relative_path",
    "receipt_id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "receipt_digest", "sha256", "size_bytes"
  ) REFERENCES "hr_source_receipt_members" (
    "source_set_id", "component_index", "role", "relative_path",
    "receipt_id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "receipt_digest", "sha256", "size_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_norm_inventory_members_path_unique"
    UNIQUE ("normalization_id", "relative_path")
);

CREATE TABLE "hr_evidence_records" (
  "id" uuid PRIMARY KEY NOT NULL,
  "record_kind" varchar(50) NOT NULL,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "scope_epoch" bigint NOT NULL,
  "scope_epoch_digest" varchar(64) NOT NULL,
  "scope_epoch_expires_at" timestamptz NOT NULL,
  "record_digest" varchar(64) NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_evidence_records_subject_fk" FOREIGN KEY (
    "subject_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_evidence_records_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_evidence_records_shape" CHECK ((
    "record_kind" IN (
      'capture_root', 'capture_clearance', 'derivation', 'transform_review',
      'rights_clearance', 'twin_release_authority', 'scene_validation',
      'reviewed_profile'
    )
    AND (
      ("record_kind" IN ('capture_root', 'capture_clearance')
        AND "subject_kind" = 'capture_import')
      OR ("record_kind" = 'derivation' AND "subject_kind" = 'derivation')
      OR ("record_kind" = 'transform_review'
        AND "subject_kind" = 'transform_review')
      OR ("record_kind" = 'rights_clearance'
        AND "subject_kind" = 'rights_clearance')
      OR ("record_kind" IN ('twin_release_authority', 'scene_validation')
        AND "subject_kind" = 'scene_validation')
      OR ("record_kind" = 'reviewed_profile'
        AND "subject_kind" = 'reviewed_profile')
    )
    AND "record_digest" ~ '^[a-f0-9]{64}$'
    AND "effective_at" <= "created_at"
    AND "created_at" < "expires_at"
    AND "expires_at" <= "scope_epoch_expires_at"
  ) IS TRUE),
  CONSTRAINT "hr_evidence_records_exact_unique" UNIQUE (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "venue_id", "space_id", "record_digest", "expires_at"
  ),
  CONSTRAINT "hr_evidence_records_leaf_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "record_digest", "expires_at"
  ),
  CONSTRAINT "hr_evidence_records_revoke_unique" UNIQUE (
    "id", "record_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "record_digest"
  )
);

CREATE INDEX "hr_evidence_records_current_idx" ON "hr_evidence_records" (
  "venue_id", "space_id", "record_kind", "expires_at", "id"
);

-- This parent must retain the exact action instant sampled by the typed-leaf
-- issuer. Only hr_insert_evidence_record() executes with this NOLOGIN owner.
CREATE TRIGGER "a00_hr_require_evidence_record_owner"
  BEFORE INSERT ON "hr_evidence_records"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();

CREATE TABLE "hr_evidence_record_revocations" (
  "record_id" uuid PRIMARY KEY NOT NULL,
  "record_kind" varchar(50) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "record_digest" varchar(64) NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamptz NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_record_revocations_record_fk" FOREIGN KEY (
    "record_id", "record_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "record_digest"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "record_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_record_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "revoked_at" = "created_at"
    AND jsonb_typeof("revocation_body") = 'object'
  ) IS TRUE)
);

CREATE OR REPLACE FUNCTION "hr_revocation_schema_version"(
  revocation_kind text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE revocation_kind
    WHEN 'scope_epoch_revocation'
      THEN 'historical-runtime-scope-epoch-revocation.v1'
    WHEN 'provider_capability_revocation'
      THEN 'historical-runtime-provider-capability-revocation.v1'
    WHEN 'signing_key_authority_revocation'
      THEN 'historical-runtime-signing-key-authority-revocation.v1'
    WHEN 'role_attestation_revocation'
      THEN 'historical-runtime-role-attestation-revocation.v1'
    WHEN 'evidence_record_revocation'
      THEN 'historical-runtime-evidence-record-revocation.v1'
    WHEN 'execution_activation_revocation'
      THEN 'historical-runtime-execution-activation-revocation.v1'
  END
$$;

CREATE OR REPLACE FUNCTION "hr_revocation_digest_for_body"(
  revocation_kind text,
  revocation_body jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT encode(digest(convert_to(
    ('venviewer.' || "hr_revocation_schema_version"(revocation_kind)
      || chr(10) || "hr_stable_canonical_json"(
        revocation_body - 'revocationDigest'
      )), 'UTF8'
  ), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION "hr_revocation_body_matches"(
  revocation_body jsonb,
  revocation_kind text,
  revocation_id uuid,
  target_id uuid,
  target_digest text,
  reason text,
  authority_snapshot_id uuid,
  authority_digest text,
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_digest text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_typeof(revocation_body) = 'object'
    AND revocation_body->>'schemaVersion' =
      "hr_revocation_schema_version"(revocation_kind)
    AND (revocation_body->>'revocationId')::uuid = revocation_id
    AND revocation_body->>'revocationKind' = revocation_kind
    AND (revocation_body->>'targetId')::uuid = target_id
    AND revocation_body->>'targetDigest' = target_digest
    AND revocation_body->>'reason' = reason
    AND (revocation_body->>'revokerAuthoritySnapshotId')::uuid =
      authority_snapshot_id
    AND revocation_body->>'revokerAuthorityDigest' = authority_digest
    AND (revocation_body->>'revokedBy')::uuid = revoked_by
    AND (revocation_body->>'revokedAt')::timestamptz = revoked_at
    AND revocation_body->>'revocationDigest' = revocation_digest
    AND "hr_revocation_digest_for_body"(
      revocation_kind, revocation_body
    ) = revocation_digest
$$;

-- One normalized action exact-binds the authenticated revoker, current
-- authority scope, private incident document, target identity, and DB action
-- time. A typed child is populated in the same transaction and is the row
-- consulted by existing currentness predicates.
CREATE TABLE "hr_revocation_actions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "revocation_kind" varchar(60) NOT NULL,
  "target_kind" varchar(60) NOT NULL,
  "target_id" uuid NOT NULL,
  "target_digest" varchar(64) NOT NULL,
  "target_scope_epoch_id" uuid NOT NULL,
  "target_expires_at" timestamptz NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "revoker_action_kind" varchar(60) NOT NULL,
  "revoker_authority_role" varchar(40)
    GENERATED ALWAYS AS ('revoker') STORED,
  "revoker_action_parameters_digest" varchar(64) NOT NULL,
  "revoker_authority_snapshot_id" uuid NOT NULL,
  "revoker_authority_scope_epoch_id" uuid NOT NULL,
  "revoker_authority_digest" varchar(64) NOT NULL,
  "revoker_authority_snapshotted_at" timestamptz NOT NULL,
  "revoker_authority_expires_at" timestamptz NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reason_code" varchar(50) NOT NULL,
  "incident_reference" varchar(200) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_at" timestamptz NOT NULL,
  "revocation_digest" varchar(64) NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "hr_revocation_actions_environment_fk" FOREIGN KEY (
    "environment_id", "environment_mode", "environment_digest"
  ) REFERENCES "hr_evidence_environments" (
    "id", "mode", "environment_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_revocation_actions_authority_fk" FOREIGN KEY (
    "revoker_authority_snapshot_id", "revoker_action_kind", "id",
    "revoker_authority_role", "revoker_action_parameters_digest",
    "environment_id", "environment_mode",
    "environment_digest", "revoker_authority_scope_epoch_id", "venue_id",
    "space_id", "revoked_by", "revoker_authority_digest",
    "revoker_authority_snapshotted_at", "revoker_authority_expires_at"
  ) REFERENCES "hr_action_authority_snapshots" (
    "id", "action_kind", "action_id", "authority_role",
    "action_parameters_digest", "environment_id", "environment_mode",
    "environment_digest", "authority_scope_epoch_id",
    "venue_id", "space_id", "actor_id", "authority_digest",
    "snapshotted_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_revocation_actions_shape" CHECK ((
    "revocation_kind" IN (
      'scope_epoch_revocation', 'provider_capability_revocation',
      'signing_key_authority_revocation', 'role_attestation_revocation',
      'evidence_record_revocation'
    )
    AND "target_kind" = CASE "revocation_kind"
      WHEN 'scope_epoch_revocation' THEN 'scope_epoch'
      WHEN 'provider_capability_revocation' THEN 'provider_capability'
      WHEN 'signing_key_authority_revocation' THEN 'signing_key_authority'
      WHEN 'role_attestation_revocation' THEN 'role_attestation'
      WHEN 'evidence_record_revocation' THEN 'evidence_record'
    END
    AND "revoker_action_kind" = "revocation_kind"
    AND "revoker_action_parameters_digest" ~ '^[a-f0-9]{64}$'
    AND "target_digest" ~ '^[a-f0-9]{64}$'
    AND "revoker_authority_digest" ~ '^[a-f0-9]{64}$'
    AND "reason_code" IN (
      'administrative_emergency', 'authority_withdrawn',
      'integrity_failure', 'privacy_incident', 'suspected_key_compromise'
    )
    AND length(btrim("incident_reference")) BETWEEN 1 AND 200
    AND "incident_reference" = btrim("incident_reference")
    AND length(btrim("reason")) BETWEEN 1 AND 500
    AND "reason" = btrim("reason")
    AND "revoker_authority_snapshotted_at" = "revoked_at"
    AND "revoked_at" = "created_at"
    AND "revoked_at" < "revoker_authority_expires_at"
    AND jsonb_typeof("revocation_body") = 'object'
    AND "revocation_body"->>'schemaVersion' =
      "hr_revocation_schema_version"("revocation_kind")
    AND ("revocation_body"->>'revocationId')::uuid = "id"
    AND "revocation_body"->>'revocationKind' = "revocation_kind"
    AND "revocation_body"->>'targetKind' = "target_kind"
    AND ("revocation_body"->>'targetId')::uuid = "target_id"
    AND "revocation_body"->>'targetDigest' = "target_digest"
    AND ("revocation_body"->>'targetScopeEpochId')::uuid =
      "target_scope_epoch_id"
    AND ("revocation_body"->>'targetExpiresAt')::timestamptz =
      "target_expires_at"
    AND ("revocation_body"->>'environmentId')::uuid = "environment_id"
    AND "revocation_body"->>'environmentMode' = "environment_mode"
    AND "revocation_body"->>'environmentDigest' = "environment_digest"
    AND ("revocation_body"->>'venueId')::uuid = "venue_id"
    AND ("revocation_body"->>'spaceId')::uuid = "space_id"
    AND ("revocation_body"->>'revokerAuthoritySnapshotId')::uuid =
      "revoker_authority_snapshot_id"
    AND "revocation_body"->>'revokerAuthorityDigest' =
      "revoker_authority_digest"
    AND "revocation_body"->>'revokerActionParametersDigest' =
      "revoker_action_parameters_digest"
    AND "revoker_action_parameters_digest" = encode(digest(convert_to(
      E'venviewer.historical-runtime-action-parameters.v1\n'
        || "hr_stable_canonical_json"(jsonb_build_object(
          'incidentReference', "incident_reference",
          'reason', "reason",
          'reasonCode', "reason_code",
          'targetId', "target_id"::text
        )), 'UTF8'
    ), 'sha256'), 'hex')
    AND "revocation_body"->>'reasonCode' = "reason_code"
    AND "revocation_body"->>'incidentReference' = "incident_reference"
    AND ("revocation_body"->>'revokedBy')::uuid = "revoked_by"
    AND "revocation_body"->>'reason' = "reason"
    AND ("revocation_body"->>'revokedAt')::timestamptz = "revoked_at"
    AND "revocation_body"->>'revocationDigest' = "revocation_digest"
    AND "revocation_digest" = "hr_revocation_digest_for_body"(
      "revocation_kind", "revocation_body"
    )
  ) IS TRUE),
  CONSTRAINT "hr_revocation_actions_target_unique"
    UNIQUE ("revocation_kind", "target_id"),
  CONSTRAINT "hr_revocation_actions_child_unique" UNIQUE (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  )
);

ALTER TABLE "hr_provider_capabilities"
  ADD CONSTRAINT "hr_provider_capabilities_revocation_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capability_digest",
    "expires_at"
  );

ALTER TABLE "hr_provider_capability_revocations"
  ADD COLUMN "scope_epoch_id" uuid NOT NULL,
  ADD COLUMN "revocation_action_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_snapshot_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_digest" varchar(64) NOT NULL,
  ADD COLUMN "revocation_kind" varchar(60)
    GENERATED ALWAYS AS ('provider_capability_revocation') STORED,
  ADD COLUMN "target_kind" varchar(60)
    GENERATED ALWAYS AS ('provider_capability') STORED,
  DROP CONSTRAINT "hr_provider_cap_revocations_cap_fk",
  ADD CONSTRAINT "hr_provider_cap_revocations_cap_fk" FOREIGN KEY (
    "capability_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capability_digest", "capability_expires_at"
  ) REFERENCES "hr_provider_capabilities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capability_digest",
    "expires_at"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_role_attestation_revocations"
  ADD COLUMN "subject_id" uuid NOT NULL,
  ADD COLUMN "subject_kind" varchar(40) NOT NULL,
  ADD COLUMN "scope_epoch_id" uuid NOT NULL,
  ADD COLUMN "role" varchar(50) NOT NULL,
  ADD COLUMN "target_actor_id" uuid NOT NULL,
  ADD COLUMN "bound_kind" varchar(60) NOT NULL,
  ADD COLUMN "bound_reference" varchar(200) NOT NULL,
  ADD COLUMN "bound_digest" varchar(64) NOT NULL,
  ADD COLUMN "effective_at" timestamptz NOT NULL,
  ADD COLUMN "revocation_action_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_snapshot_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_digest" varchar(64) NOT NULL,
  ADD COLUMN "revocation_kind" varchar(60)
    GENERATED ALWAYS AS ('role_attestation_revocation') STORED,
  ADD COLUMN "target_kind" varchar(60)
    GENERATED ALWAYS AS ('role_attestation') STORED,
  DROP CONSTRAINT "hr_role_revocations_attestation_fk",
  ADD CONSTRAINT "hr_role_revocations_attestation_fk" FOREIGN KEY (
    "attestation_id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "target_actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "attestation_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "effective_at",
    "expires_at"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_evidence_record_revocations"
  ADD COLUMN "subject_id" uuid NOT NULL,
  ADD COLUMN "subject_kind" varchar(40) NOT NULL,
  ADD COLUMN "scope_epoch_id" uuid NOT NULL,
  ADD COLUMN "record_expires_at" timestamptz NOT NULL,
  ADD COLUMN "revocation_action_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_snapshot_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_digest" varchar(64) NOT NULL,
  ADD COLUMN "revocation_kind" varchar(60)
    GENERATED ALWAYS AS ('evidence_record_revocation') STORED,
  ADD COLUMN "target_kind" varchar(60)
    GENERATED ALWAYS AS ('evidence_record') STORED,
  DROP CONSTRAINT "hr_record_revocations_record_fk",
  ADD CONSTRAINT "hr_record_revocations_record_fk" FOREIGN KEY (
    "record_id", "record_kind", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "record_digest",
    "record_expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_scope_epoch_revocations"
  ADD COLUMN "revocation_action_id" uuid NOT NULL,
  ADD COLUMN "target_scope_epoch_id" uuid
    GENERATED ALWAYS AS ("epoch_id") STORED,
  ADD COLUMN "revoker_authority_snapshot_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_digest" varchar(64) NOT NULL,
  ADD COLUMN "revocation_kind" varchar(60)
    GENERATED ALWAYS AS ('scope_epoch_revocation') STORED,
  ADD COLUMN "target_kind" varchar(60)
    GENERATED ALWAYS AS ('scope_epoch') STORED;

ALTER TABLE "hr_signing_key_authority_revocations"
  ADD COLUMN "revocation_action_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_snapshot_id" uuid NOT NULL,
  ADD COLUMN "revoker_authority_digest" varchar(64) NOT NULL,
  ADD COLUMN "revocation_kind" varchar(60)
    GENERATED ALWAYS AS ('signing_key_authority_revocation') STORED,
  ADD COLUMN "target_kind" varchar(60)
    GENERATED ALWAYS AS ('signing_key_authority') STORED;

ALTER TABLE "hr_scope_epoch_revocations"
  ADD CONSTRAINT "hr_scope_epoch_revocations_action_fk" FOREIGN KEY (
    "revocation_action_id", "revocation_kind", "target_kind", "epoch_id",
    "epoch_digest", "target_scope_epoch_id", "epoch_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) REFERENCES "hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_provider_capability_revocations"
  ADD CONSTRAINT "hr_provider_cap_revocations_action_fk" FOREIGN KEY (
    "revocation_action_id", "revocation_kind", "target_kind",
    "capability_id", "capability_digest", "scope_epoch_id",
    "capability_expires_at", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) REFERENCES "hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_signing_key_authority_revocations"
  ADD CONSTRAINT "hr_signing_key_revocations_action_fk" FOREIGN KEY (
    "revocation_action_id", "revocation_kind", "target_kind",
    "signing_key_authority_id", "key_policy_digest", "scope_epoch_id",
    "authority_expires_at", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) REFERENCES "hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_role_attestation_revocations"
  ADD CONSTRAINT "hr_role_revocations_action_fk" FOREIGN KEY (
    "revocation_action_id", "revocation_kind", "target_kind",
    "attestation_id", "attestation_digest", "scope_epoch_id",
    "attestation_expires_at", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) REFERENCES "hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_evidence_record_revocations"
  ADD CONSTRAINT "hr_record_revocations_action_fk" FOREIGN KEY (
    "revocation_action_id", "revocation_kind", "target_kind", "record_id",
    "record_digest", "scope_epoch_id", "record_expires_at",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "revoker_authority_snapshot_id",
    "revoker_authority_digest", "revoked_by", "revoked_at",
    "revocation_digest"
  ) REFERENCES "hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_authority_snapshot_id", "revoker_authority_digest",
    "revoked_by", "revoked_at", "revocation_digest"
  ) ON DELETE RESTRICT;

ALTER TABLE "hr_scope_epoch_revocations"
  ADD CONSTRAINT "hr_scope_epoch_revocations_canonical" CHECK (
    "hr_revocation_body_matches"(
      "revocation_body", "revocation_kind", "revocation_action_id",
      "epoch_id", "epoch_digest", "reason",
      "revoker_authority_snapshot_id", "revoker_authority_digest",
      "revoked_by", "revoked_at", "revocation_digest"
    )
  );
ALTER TABLE "hr_provider_capability_revocations"
  ADD CONSTRAINT "hr_provider_cap_revocations_canonical" CHECK (
    "hr_revocation_body_matches"(
      "revocation_body", "revocation_kind", "revocation_action_id",
      "capability_id", "capability_digest", "reason",
      "revoker_authority_snapshot_id", "revoker_authority_digest",
      "revoked_by", "revoked_at", "revocation_digest"
    )
  );
ALTER TABLE "hr_signing_key_authority_revocations"
  ADD CONSTRAINT "hr_signing_key_revocations_canonical" CHECK (
    "hr_revocation_body_matches"(
      "revocation_body", "revocation_kind", "revocation_action_id",
      "signing_key_authority_id", "key_policy_digest", "reason",
      "revoker_authority_snapshot_id", "revoker_authority_digest",
      "revoked_by", "revoked_at", "revocation_digest"
    )
  );
ALTER TABLE "hr_role_attestation_revocations"
  ADD CONSTRAINT "hr_role_revocations_canonical" CHECK (
    "hr_revocation_body_matches"(
      "revocation_body", "revocation_kind", "revocation_action_id",
      "attestation_id", "attestation_digest", "reason",
      "revoker_authority_snapshot_id", "revoker_authority_digest",
      "revoked_by", "revoked_at", "revocation_digest"
    )
  );
ALTER TABLE "hr_evidence_record_revocations"
  ADD CONSTRAINT "hr_record_revocations_canonical" CHECK (
    "hr_revocation_body_matches"(
      "revocation_body", "revocation_kind", "revocation_action_id",
      "record_id", "record_digest", "reason",
      "revoker_authority_snapshot_id", "revoker_authority_digest",
      "revoked_by", "revoked_at", "revocation_digest"
    )
  );

CREATE TABLE "hr_capture_content_subjects" (
  "capture_root_id" uuid PRIMARY KEY NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "source_set_id" uuid NOT NULL,
  "source_receipt_set_digest" varchar(64) NOT NULL,
  "source_member_count" integer NOT NULL,
  "source_total_bytes" bigint NOT NULL,
  "normalization_id" uuid NOT NULL,
  "normalization_digest" varchar(64) NOT NULL,
  "normalized_sha256" varchar(64) NOT NULL,
  "normalized_size_bytes" bigint NOT NULL,
  "capture_operator_attestation_id" uuid NOT NULL,
  "capture_operator_attestation_digest" varchar(64) NOT NULL,
  "capture_operator_role" varchar(50) GENERATED ALWAYS AS ('capture_operator') STORED,
  "capture_operator_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('capture_lineage') STORED,
  "capture_operator_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "capture_operator_bound_digest" varchar(64) NOT NULL,
  "capture_operator_actor_id" uuid NOT NULL,
  "capture_operator_expires_at" timestamptz NOT NULL,
  "source_custodian_attestation_id" uuid NOT NULL,
  "source_custodian_attestation_digest" varchar(64) NOT NULL,
  "source_custodian_role" varchar(50)
    GENERATED ALWAYS AS ('source_custodian') STORED,
  "source_custodian_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('source_receipt_set') STORED,
  "source_custodian_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "source_custodian_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("source_receipt_set_digest") STORED,
  "source_custodian_actor_id" uuid NOT NULL,
  "source_custodian_expires_at" timestamptz NOT NULL,
  "normalized_by_actor_id" uuid NOT NULL REFERENCES "users"("id")
    ON DELETE RESTRICT,
  "capture_content_subject_digest" varchar(64) NOT NULL,
  "subject_body" jsonb NOT NULL,
  "prepared_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_capture_subjects_subject_fk" FOREIGN KEY (
    "capture_root_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) REFERENCES "hr_evidence_subjects" (
    "id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_subjects_source_fk" FOREIGN KEY (
    "source_set_id", "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "source_receipt_set_digest"
  ) REFERENCES "hr_source_receipt_sets" (
    "id", "capture_subject_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "receipt_set_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_subjects_norm_fk" FOREIGN KEY (
    "normalization_id", "capture_root_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "source_set_id", "venue_id", "space_id", "source_receipt_set_digest",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes"
  ) REFERENCES "hr_normalized_content_identities" (
    "id", "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "source_set_id", "venue_id", "space_id", "source_receipt_set_digest",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_subjects_operator_fk" FOREIGN KEY (
    "capture_operator_attestation_id", "capture_operator_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "capture_operator_role", "capture_operator_actor_id",
    "capture_operator_bound_kind", "capture_operator_bound_reference",
    "capture_operator_bound_digest", "capture_operator_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_subjects_custodian_fk" FOREIGN KEY (
    "source_custodian_attestation_id", "source_custodian_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "source_custodian_role", "source_custodian_actor_id",
    "source_custodian_bound_kind", "source_custodian_bound_reference",
    "source_custodian_bound_digest", "source_custodian_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_subjects_shape" CHECK ((
    "subject_kind" = 'capture_import'
    AND "capture_content_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "capture_operator_actor_id" <> "source_custodian_actor_id"
    AND "normalized_by_actor_id" <> "capture_operator_actor_id"
    AND "normalized_by_actor_id" <> "source_custodian_actor_id"
    AND "prepared_at" = "created_at"
    AND "prepared_at" < LEAST(
      "capture_operator_expires_at", "source_custodian_expires_at"
    )
    AND jsonb_typeof("subject_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_capture_subjects_exact_unique" UNIQUE (
    "capture_root_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest", "normalization_id",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes",
    "capture_operator_attestation_id", "capture_operator_attestation_digest",
    "capture_operator_actor_id", "capture_operator_expires_at",
    "source_custodian_attestation_id", "source_custodian_attestation_digest",
    "source_custodian_actor_id", "source_custodian_expires_at",
    "normalized_by_actor_id", "capture_content_subject_digest"
  ),
  CONSTRAINT "hr_capture_subjects_draft_unique" UNIQUE (
    "capture_root_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest", "normalization_id",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes",
    "normalized_by_actor_id", "capture_content_subject_digest"
  ),
  CONSTRAINT "hr_capture_subjects_profile_actors_unique" UNIQUE (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_operator_actor_id", "source_custodian_actor_id",
    "normalized_by_actor_id", "capture_content_subject_digest"
  ),
  CONSTRAINT "hr_capture_subjects_clearance_source_unique" UNIQUE (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest",
    "capture_content_subject_digest"
  )
);

CREATE TABLE "hr_capture_content_drafts" (
  "capture_root_id" uuid PRIMARY KEY NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "source_set_id" uuid NOT NULL,
  "source_receipt_set_digest" varchar(64) NOT NULL,
  "normalization_id" uuid NOT NULL,
  "normalization_digest" varchar(64) NOT NULL,
  "normalized_sha256" varchar(64) NOT NULL,
  "normalized_size_bytes" bigint NOT NULL,
  "capture_content_subject_digest" varchar(64) NOT NULL,
  "normalizer_attestation_id" uuid NOT NULL,
  "normalizer_attestation_digest" varchar(64) NOT NULL,
  "normalizer_role" varchar(50) GENERATED ALWAYS AS ('normalizer') STORED,
  "normalizer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('capture_content_subject') STORED,
  "normalizer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "normalizer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("capture_content_subject_digest") STORED,
  "normalizer_actor_id" uuid NOT NULL,
  "normalizer_expires_at" timestamptz NOT NULL,
  "signing_key_authority_id" uuid NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "key_policy_purpose" varchar(80) NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "key_effective_at" timestamptz NOT NULL,
  "key_expires_at" timestamptz NOT NULL,
  "predicate_digest" varchar(64) NOT NULL,
  "payload_type" varchar(160) NOT NULL,
  "payload_bytes" bytea NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "payload_byte_length" integer NOT NULL,
  "statement_body" jsonb NOT NULL,
  "nonce" uuid NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_capture_drafts_subject_fk" FOREIGN KEY (
    "capture_root_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest", "normalization_id",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes",
    "normalizer_actor_id", "capture_content_subject_digest"
  ) REFERENCES "hr_capture_content_subjects" (
    "capture_root_id", "subject_kind", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest", "normalization_id",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes",
    "normalized_by_actor_id", "capture_content_subject_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_drafts_normalizer_fk" FOREIGN KEY (
    "normalizer_attestation_id", "normalizer_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "normalizer_role", "normalizer_actor_id",
    "normalizer_bound_kind", "normalizer_bound_reference",
    "normalizer_bound_digest", "normalizer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_drafts_key_fk" FOREIGN KEY (
    "signing_key_authority_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "key_policy_id", "key_policy_purpose", "key_policy_digest", "key_id",
    "public_key_fingerprint", "key_effective_at", "key_expires_at"
  ) REFERENCES "hr_signing_key_authorities" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "key_policy_id", "purpose",
    "key_policy_digest", "key_id", "public_key_fingerprint",
    "policy_effective_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_drafts_shape" CHECK ((
    "subject_kind" = 'capture_import'
    AND "key_policy_purpose" = 'historical_runtime_capture_content_identity'
    AND "payload_type" =
      'application/vnd.venviewer.historical-runtime-capture-content-identity.v1+json'
    AND "predicate_digest" ~ '^[a-f0-9]{64}$'
    AND "payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "payload_byte_length" = octet_length("payload_bytes")
    AND "payload_byte_length" BETWEEN 1 AND 524288
    AND encode(digest("payload_bytes", 'sha256'), 'hex') = "payload_sha256"
    AND convert_from("payload_bytes", 'UTF8')::jsonb = "statement_body"
    AND "statement_body"->>'authority' = 'venue_evidence'
    AND "statement_body"->>'evidenceKind' =
      'historical_runtime_capture_content_identity'
    AND "statement_body"->>'schemaVersion' =
      'historical-runtime-capture-content-identity-statement.v1'
    AND "statement_body"->>'subjectName' =
      'historical-runtime-capture-root/' || "capture_root_id"::text
    AND "statement_body"->>'subjectDigest' = "predicate_digest"
    AND "statement_body"->'predicate'->>'schemaVersion' =
      'historical-runtime-capture-content-identity.v1'
    AND "statement_body"->'predicate'->>'captureContentSubjectDigest' =
      "capture_content_subject_digest"
    AND ("statement_body"->'predicate'->>'keyPolicyId')::uuid =
      "key_policy_id"
    AND "statement_body"->'predicate'->>'keyPolicyDigest' =
      "key_policy_digest"
    AND "statement_body"->'predicate'->>'keyId' = "key_id"
    AND "statement_body"->'predicate'->>'signerPublicKeySha256' =
      'sha256:' || "public_key_fingerprint"
    AND ("statement_body"->'predicate'->>'normalizerAttestationId')::uuid =
      "normalizer_attestation_id"
    AND "statement_body"->'predicate'->>'normalizerAttestationDigest' =
      "normalizer_attestation_digest"
    AND ("statement_body"->'predicate'->>'issuedAt')::timestamptz =
      "issued_at"
    AND ("statement_body"->'predicate'->>'expiresAt')::timestamptz =
      "expires_at"
    AND ("statement_body"->'predicate'->>'nonce')::uuid = "nonce"
    AND "statement_body"->'predicate'->'captureContentSubject'->>'schemaVersion' =
      'historical-runtime-capture-content-subject.v1'
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'captureRootId'
    )::uuid = "capture_root_id"
    AND "statement_body"->'predicate'->'captureContentSubject'->>'tenantBoundary' =
      'venue_id_v1'
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'tenantId'
    )::uuid = "venue_id"
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'venueId'
    )::uuid = "venue_id"
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'spaceId'
    )::uuid = "space_id"
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'sourceReceiptSetId'
    )::uuid = "source_set_id"
    AND "statement_body"->'predicate'->'captureContentSubject'->>
      'sourceReceiptSetDigest' = "source_receipt_set_digest"
    AND "statement_body"->'predicate'->'captureContentSubject'->>
      'normalizedContentDigest' = "normalization_digest"
    AND (
      "statement_body"->'predicate'->'captureContentSubject'->>'normalizedBy'
    )::uuid = "normalizer_actor_id"
    AND "issued_at" = "created_at"
    AND "issued_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "issued_at" + interval '365 days', "normalizer_expires_at",
      "key_expires_at"
    )
    AND "key_effective_at" <= "issued_at"
    AND jsonb_typeof("statement_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_capture_drafts_nonce_unique" UNIQUE ("nonce"),
  CONSTRAINT "hr_capture_drafts_exact_unique" UNIQUE (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "predicate_digest", "payload_sha256", "payload_byte_length",
    "signing_key_authority_id", "key_policy_id", "key_policy_digest",
    "key_id", "public_key_fingerprint", "normalizer_attestation_id",
    "normalizer_attestation_digest", "normalizer_actor_id",
    "normalizer_expires_at", "expires_at"
  )
);

CREATE TABLE "hr_capture_roots" (
  "capture_root_id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("capture_root_id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('capture_root') STORED,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "capture_root_evidence_digest" varchar(64) NOT NULL,
  "predicate_digest" varchar(64) NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "payload_bytes" bytea NOT NULL,
  "payload_byte_length" integer NOT NULL,
  "signing_key_authority_id" uuid NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(128) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "normalizer_attestation_id" uuid NOT NULL,
  "normalizer_attestation_digest" varchar(64) NOT NULL,
  "normalizer_actor_id" uuid NOT NULL,
  "normalizer_expires_at" timestamptz NOT NULL,
  "envelope_bytes" bytea NOT NULL,
  "envelope_sha256" varchar(71) NOT NULL,
  "envelope_byte_length" integer NOT NULL,
  "verifier_receipt_sha256" varchar(71) NOT NULL,
  "signer_public_key_sha256" varchar(71) NOT NULL,
  "envelope_body" jsonb NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "capture_root_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_capture_roots_record_fk" FOREIGN KEY (
    "capture_root_id", "record_kind", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_evidence_digest",
    "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_roots_draft_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "predicate_digest", "payload_sha256", "payload_byte_length",
    "signing_key_authority_id", "key_policy_id", "key_policy_digest",
    "key_id", "public_key_fingerprint", "normalizer_attestation_id",
    "normalizer_attestation_digest", "normalizer_actor_id",
    "normalizer_expires_at", "expires_at"
  ) REFERENCES "hr_capture_content_drafts" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "predicate_digest", "payload_sha256", "payload_byte_length",
    "signing_key_authority_id", "key_policy_id", "key_policy_digest",
    "key_id", "public_key_fingerprint", "normalizer_attestation_id",
    "normalizer_attestation_digest", "normalizer_actor_id",
    "normalizer_expires_at", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_roots_shape" CHECK ((
    "subject_kind" = 'capture_import'
    AND "capture_root_evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "payload_byte_length" = octet_length("payload_bytes")
    AND encode(digest("payload_bytes", 'sha256'), 'hex') = "payload_sha256"
    AND "envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "verifier_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "signer_public_key_sha256" = 'sha256:' || "public_key_fingerprint"
    AND "envelope_byte_length" = octet_length("envelope_bytes")
    AND "envelope_byte_length" BETWEEN 1 AND 1048576
    AND encode(digest(
      convert_to(E'venviewer.historical-runtime-capture-content-identity.v1.dsse-envelope\n', 'UTF8')
      || "envelope_bytes", 'sha256'
    ), 'hex') = substring("envelope_sha256" from 8)
    AND encode(digest(
      convert_to(E'venviewer.historical-runtime-capture-content-identity.v1\n', 'UTF8')
      || "payload_bytes", 'sha256'
    ), 'hex') = substring("verifier_receipt_sha256" from 8)
    AND convert_from("envelope_bytes", 'UTF8')::jsonb = "envelope_body"
    AND "envelope_body"->>'payloadType' =
      'application/vnd.venviewer.historical-runtime-capture-content-identity.v1+json'
    AND decode("envelope_body"->>'payload', 'base64') = "payload_bytes"
    AND jsonb_typeof("envelope_body"->'signatures') = 'array'
    AND jsonb_array_length("envelope_body"->'signatures') = 1
    AND "envelope_body"#>>'{signatures,0,keyid}' = "key_id"
    AND octet_length(decode(
      "envelope_body"#>>'{signatures,0,sig}', 'base64'
    )) = 64
    AND "capture_root_body"->>'schemaVersion' =
      'historical-runtime-capture-root-evidence.v1'
    AND ("capture_root_body"->>'captureRootId')::uuid = "capture_root_id"
    AND ("capture_root_body"->>'venueId')::uuid = "venue_id"
    AND ("capture_root_body"->>'spaceId')::uuid = "space_id"
    AND "capture_root_body"->>'captureContentSubjectDigest' =
      "capture_root_body"->'captureContentStatement'->'predicate'->>
        'captureContentSubjectDigest'
    AND "capture_root_body"->>'captureContentPredicateDigest' =
      "predicate_digest"
    AND "capture_root_body"->>'captureContentPayloadUtf8' =
      convert_from("payload_bytes", 'UTF8')
    AND "capture_root_body"->>'captureContentPayloadSha256' =
      "payload_sha256"
    AND "capture_root_body"->>'captureContentReceiptSha256' =
      "verifier_receipt_sha256"
    AND "capture_root_body"->>'captureContentEnvelopeUtf8' =
      convert_from("envelope_bytes", 'UTF8')
    AND "capture_root_body"->>'captureContentEnvelopeSha256' =
      "envelope_sha256"
    AND "capture_root_body"->>'captureContentSignerPublicKeySha256' =
      "signer_public_key_sha256"
    AND ("capture_root_body"->>'captureContentPayloadByteLength')::integer =
      "payload_byte_length"
    AND ("capture_root_body"->>'captureContentEnvelopeByteLength')::integer =
      "envelope_byte_length"
    AND ("capture_root_body"->>'captureContentVerifiedAt')::timestamptz =
      "verified_at"
    AND ("capture_root_body"->>'normalizerAttestationId')::uuid =
      "normalizer_attestation_id"
    AND "capture_root_body"->>'normalizerAttestationDigest' =
      "normalizer_attestation_digest"
    AND ("capture_root_body"->>'normalizedBy')::uuid =
      "normalizer_actor_id"
    AND "capture_root_body"->>'captureRootEvidenceDigest' =
      "capture_root_evidence_digest"
    AND "capture_root_body"->'captureContentStatement' =
      convert_from("payload_bytes", 'UTF8')::jsonb
    AND "verified_at" = "created_at"
    AND "verified_at" < "expires_at"
    AND jsonb_typeof("envelope_body") = 'object'
    AND jsonb_typeof("capture_root_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_capture_roots_exact_unique" UNIQUE (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "expires_at"
  )
);

CREATE TABLE "hr_capture_clearances" (
  "id" uuid PRIMARY KEY NOT NULL,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('capture_clearance') STORED,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "capture_root_id" uuid NOT NULL,
  "capture_content_subject_digest" varchar(64) NOT NULL,
  "capture_root_evidence_digest" varchar(64) NOT NULL,
  "capture_root_expires_at" timestamptz NOT NULL,
  "source_set_id" uuid NOT NULL,
  "source_receipt_set_digest" varchar(64) NOT NULL,
  "owner_attestation_id" uuid NOT NULL,
  "owner_attestation_digest" varchar(64) NOT NULL,
  "owner_role" varchar(50) GENERATED ALWAYS AS ('owner_authorizer') STORED,
  "owner_actor_id" uuid NOT NULL,
  "owner_bound_kind" varchar(60) GENERATED ALWAYS AS ('source_receipt_set') STORED,
  "owner_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "owner_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("source_receipt_set_digest") STORED,
  "owner_expires_at" timestamptz NOT NULL,
  "privacy_attestation_id" uuid NOT NULL,
  "privacy_attestation_digest" varchar(64) NOT NULL,
  "privacy_role" varchar(50) GENERATED ALWAYS AS ('privacy_reviewer') STORED,
  "privacy_actor_id" uuid NOT NULL,
  "privacy_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('source_receipt_set') STORED,
  "privacy_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "privacy_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("source_receipt_set_digest") STORED,
  "privacy_expires_at" timestamptz NOT NULL,
  "movable_attestation_id" uuid NOT NULL,
  "movable_attestation_digest" varchar(64) NOT NULL,
  "movable_role" varchar(50)
    GENERATED ALWAYS AS ('movable_content_reviewer') STORED,
  "movable_actor_id" uuid NOT NULL,
  "movable_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('source_receipt_set') STORED,
  "movable_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "movable_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("source_receipt_set_digest") STORED,
  "movable_expires_at" timestamptz NOT NULL,
  "final_attestation_id" uuid NOT NULL,
  "final_attestation_digest" varchar(64) NOT NULL,
  "final_role" varchar(50)
    GENERATED ALWAYS AS ('capture_final_reviewer') STORED,
  "final_actor_id" uuid NOT NULL,
  "final_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('capture_root_evidence') STORED,
  "final_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("capture_root_id"::text) STORED,
  "final_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("capture_root_evidence_digest") STORED,
  "final_expires_at" timestamptz NOT NULL,
  "capture_clearance_digest" varchar(64) NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "clearance_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_capture_clearances_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "capture_clearance_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_root_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "capture_root_expires_at"
  ) REFERENCES "hr_capture_roots" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_source_fk" FOREIGN KEY (
    "source_set_id", "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "source_receipt_set_digest"
  ) REFERENCES "hr_source_receipt_sets" (
    "id", "capture_subject_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "receipt_set_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_signed_source_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest",
    "capture_content_subject_digest"
  ) REFERENCES "hr_capture_content_subjects" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "source_set_id", "source_receipt_set_digest",
    "capture_content_subject_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_owner_fk" FOREIGN KEY (
    "owner_attestation_id", "owner_attestation_digest", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "owner_role", "owner_actor_id", "owner_bound_kind",
    "owner_bound_reference", "owner_bound_digest", "owner_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_privacy_fk" FOREIGN KEY (
    "privacy_attestation_id", "privacy_attestation_digest", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "privacy_role", "privacy_actor_id", "privacy_bound_kind",
    "privacy_bound_reference", "privacy_bound_digest", "privacy_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_movable_fk" FOREIGN KEY (
    "movable_attestation_id", "movable_attestation_digest", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "movable_role", "movable_actor_id", "movable_bound_kind",
    "movable_bound_reference", "movable_bound_digest", "movable_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_final_fk" FOREIGN KEY (
    "final_attestation_id", "final_attestation_digest", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "final_role", "final_actor_id", "final_bound_kind",
    "final_bound_reference", "final_bound_digest", "final_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_capture_clearances_shape" CHECK ((
    "subject_kind" = 'capture_import'
    AND "subject_id" = "capture_root_id"
    AND "capture_clearance_digest" ~ '^[a-f0-9]{64}$'
    AND "effective_at" >= "created_at"
    AND "effective_at" < "expires_at"
    AND "expires_at" = LEAST(
      "capture_root_expires_at", "owner_expires_at", "privacy_expires_at",
      "movable_expires_at", "final_expires_at"
    )
    AND "owner_actor_id" <> "privacy_actor_id"
    AND "owner_actor_id" <> "movable_actor_id"
    AND "owner_actor_id" <> "final_actor_id"
    AND "privacy_actor_id" <> "movable_actor_id"
    AND "privacy_actor_id" <> "final_actor_id"
    AND "movable_actor_id" <> "final_actor_id"
    AND jsonb_typeof("clearance_body") = 'object'
  ) IS TRUE),
  CONSTRAINT "hr_capture_clearances_exact_unique" UNIQUE (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_id", "capture_root_evidence_digest",
    "capture_clearance_digest", "expires_at"
  ),
  CONSTRAINT "hr_capture_clearances_profile_actors_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_digest", "owner_actor_id", "privacy_actor_id",
    "movable_actor_id", "final_actor_id", "expires_at"
  )
);

-- One reviewed derivation binds one cleared capture root to a dense ordered
-- set of exact private runtime objects and exact asset_versions leaves.
CREATE TABLE "hr_derivations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('derivation') STORED,
  "subject_kind" varchar(40) NOT NULL,
  "capture_subject_kind" varchar(40)
    GENERATED ALWAYS AS ('capture_import') STORED,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "capture_root_id" uuid NOT NULL,
  "capture_root_evidence_digest" varchar(64) NOT NULL,
  "capture_root_expires_at" timestamptz NOT NULL,
  "capture_clearance_id" uuid NOT NULL,
  "capture_clearance_digest" varchar(64) NOT NULL,
  "capture_clearance_expires_at" timestamptz NOT NULL,
  "normalization_id" uuid NOT NULL,
  "source_set_id" uuid NOT NULL,
  "source_receipt_set_digest" varchar(64) NOT NULL,
  "input_normalized_content_digest" varchar(64) NOT NULL,
  "input_normalized_sha256" varchar(64) NOT NULL,
  "input_normalized_size_bytes" bigint NOT NULL,
  "conversion_tool" varchar(160) NOT NULL,
  "conversion_version" varchar(120) NOT NULL,
  "conversion_binary_sha256" varchar(64) NOT NULL,
  "conversion_command_sha256" varchar(64) NOT NULL,
  "conversion_parameters_digest" varchar(64) NOT NULL,
  "conversion_environment_digest" varchar(64) NOT NULL,
  "conversion_recipe_digest" varchar(64) NOT NULL,
  "producer_attestation_id" uuid NOT NULL,
  "producer_attestation_digest" varchar(64) NOT NULL,
  "producer_role" varchar(50)
    GENERATED ALWAYS AS ('derivative_producer') STORED,
  "producer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('conversion_recipe') STORED,
  "producer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "producer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("conversion_recipe_digest") STORED,
  "producer_actor_id" uuid NOT NULL,
  "producer_expires_at" timestamptz NOT NULL,
  "custodian_attestation_id" uuid NOT NULL,
  "custodian_attestation_digest" varchar(64) NOT NULL,
  "custodian_role" varchar(50)
    GENERATED ALWAYS AS ('derivative_custodian') STORED,
  "custodian_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('derivation_members') STORED,
  "custodian_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "custodian_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("members_digest") STORED,
  "custodian_actor_id" uuid NOT NULL,
  "custodian_expires_at" timestamptz NOT NULL,
  "reviewer_attestation_id" uuid NOT NULL,
  "reviewer_attestation_digest" varchar(64) NOT NULL,
  "reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('derivative_reviewer') STORED,
  "reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('derivation_members') STORED,
  "reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("members_digest") STORED,
  "reviewer_actor_id" uuid NOT NULL,
  "reviewer_expires_at" timestamptz NOT NULL,
  "member_count" integer NOT NULL,
  "total_bytes" bigint NOT NULL,
  "members_digest" varchar(64) NOT NULL,
  "minimum_output_receipt_expires_at" timestamptz NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_body" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_derivations_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "derivation_evidence_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_venue_fk" FOREIGN KEY ("venue_id", "venue_slug")
    REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_root_fk" FOREIGN KEY (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "capture_root_expires_at"
  ) REFERENCES "hr_capture_roots" (
    "capture_root_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "capture_root_evidence_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_clearance_fk" FOREIGN KEY (
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
  CONSTRAINT "hr_derivations_normalization_fk" FOREIGN KEY (
    "normalization_id", "capture_root_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "source_set_id", "venue_id", "space_id", "source_receipt_set_digest",
    "input_normalized_content_digest", "input_normalized_sha256",
    "input_normalized_size_bytes"
  ) REFERENCES "hr_normalized_content_identities" (
    "id", "capture_subject_id", "capture_subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id",
    "source_set_id", "venue_id", "space_id", "source_receipt_set_digest",
    "normalization_digest", "normalized_sha256", "normalized_size_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_producer_fk" FOREIGN KEY (
    "producer_attestation_id", "producer_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "producer_role", "producer_actor_id", "producer_bound_kind",
    "producer_bound_reference", "producer_bound_digest", "producer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_custodian_fk" FOREIGN KEY (
    "custodian_attestation_id", "custodian_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "custodian_role", "custodian_actor_id",
    "custodian_bound_kind", "custodian_bound_reference",
    "custodian_bound_digest", "custodian_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_reviewer_fk" FOREIGN KEY (
    "reviewer_attestation_id", "reviewer_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "reviewer_role", "reviewer_actor_id", "reviewer_bound_kind",
    "reviewer_bound_reference", "reviewer_bound_digest", "reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivations_shape" CHECK ((
    "subject_kind" = 'derivation'
    AND "member_count" BETWEEN 1 AND 8
    AND "total_bytes" BETWEEN 1 AND 100663296
    AND "members_digest" ~ '^[a-f0-9]{64}$'
    AND "conversion_binary_sha256" ~ '^[a-f0-9]{64}$'
    AND "conversion_command_sha256" ~ '^[a-f0-9]{64}$'
    AND "conversion_parameters_digest" ~ '^[a-f0-9]{64}$'
    AND "conversion_environment_digest" ~ '^[a-f0-9]{64}$'
    AND "conversion_recipe_digest" ~ '^[a-f0-9]{64}$'
    AND "producer_actor_id" <> "custodian_actor_id"
    AND "producer_actor_id" <> "reviewer_actor_id"
    AND "custodian_actor_id" <> "reviewer_actor_id"
    AND "created_at" < "expires_at"
    AND "expires_at" = LEAST(
      "capture_clearance_expires_at", "producer_expires_at",
      "custodian_expires_at", "reviewer_expires_at",
      "minimum_output_receipt_expires_at"
    )
    AND jsonb_typeof("derivation_body") = 'object'
    AND "derivation_body"->>'schemaVersion' =
      'historical-runtime-derivation-evidence.v1'
    AND ("derivation_body"->>'derivationId')::uuid = "id"
    AND ("derivation_body"->>'venueId')::uuid = "venue_id"
    AND ("derivation_body"->>'spaceId')::uuid = "space_id"
    AND ("derivation_body"->>'captureRootId')::uuid = "capture_root_id"
    AND "derivation_body"->>'captureRootEvidenceDigest' =
      "capture_root_evidence_digest"
    AND "derivation_body"->>'inputNormalizedContentDigest' =
      "input_normalized_content_digest"
    AND ("derivation_body"->>'captureClearanceId')::uuid =
      "capture_clearance_id"
    AND "derivation_body"->>'captureClearanceDigest' =
      "capture_clearance_digest"
    AND "derivation_body"->>'conversionTool' = "conversion_tool"
    AND "derivation_body"->>'conversionVersion' = "conversion_version"
    AND "derivation_body"->>'conversionBinarySha256' =
      "conversion_binary_sha256"
    AND "derivation_body"->>'conversionCommandSha256' =
      "conversion_command_sha256"
    AND "derivation_body"->>'conversionParametersDigest' =
      "conversion_parameters_digest"
    AND "derivation_body"->>'conversionEnvironmentDigest' =
      "conversion_environment_digest"
    AND ("derivation_body"->>'producerAttestationId')::uuid =
      "producer_attestation_id"
    AND "derivation_body"->>'producerAttestationDigest' =
      "producer_attestation_digest"
    AND ("derivation_body"->>'custodianAttestationId')::uuid =
      "custodian_attestation_id"
    AND "derivation_body"->>'custodianAttestationDigest' =
      "custodian_attestation_digest"
    AND ("derivation_body"->>'reviewerAttestationId')::uuid =
      "reviewer_attestation_id"
    AND "derivation_body"->>'reviewerAttestationDigest' =
      "reviewer_attestation_digest"
    AND ("derivation_body"->>'memberCount')::integer = "member_count"
    AND ("derivation_body"->>'totalBytes')::bigint = "total_bytes"
    AND "derivation_body"->>'membersDigest' = "members_digest"
    AND ("derivation_body"->>'registeredAt')::timestamptz = "created_at"
    AND "derivation_body"->>'derivationEvidenceDigest' =
      "derivation_evidence_digest"
  ) IS TRUE),
  CONSTRAINT "hr_derivations_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_id", "derivation_evidence_digest", "member_count",
    "total_bytes", "members_digest", "reviewer_actor_id",
    "reviewer_expires_at", "expires_at"
  ),
  CONSTRAINT "hr_derivations_member_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "venue_slug", "space_id", "space_slug",
    "derivation_evidence_digest", "expires_at"
  ),
  CONSTRAINT "hr_derivations_record_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "expires_at"
  ),
  CONSTRAINT "hr_derivations_scene_scope_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "member_count", "expires_at"
  ),
  CONSTRAINT "hr_derivations_profile_actors_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "capture_root_id",
    "capture_clearance_id", "derivation_evidence_digest",
    "producer_actor_id", "custodian_actor_id", "reviewer_actor_id",
    "expires_at"
  )
);

CREATE TABLE "hr_derivation_members" (
  "derivation_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "member_index" integer NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "output_receipt_id" uuid NOT NULL,
  "receipt_role" varchar(40) GENERATED ALWAYS AS ('derived_member') STORED,
  "output_receipt_digest" varchar(64) NOT NULL,
  "capability_id" uuid NOT NULL,
  "capability_digest" varchar(64) NOT NULL,
  "provider_profile" varchar(40) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_account_sha256" varchar(64) NOT NULL,
  "endpoint_authority_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "version_kind" varchar(50) NOT NULL,
  "storage_version" varchar(512) NOT NULL,
  "storage_etag" varchar(512) NOT NULL,
  "receipt_expires_at" timestamptz NOT NULL,
  "member_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_derivation_members_pkey"
    PRIMARY KEY ("derivation_id", "member_index"),
  CONSTRAINT "hr_derivation_members_parent_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "venue_slug",
    "space_id", "space_slug", "derivation_evidence_digest",
    "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "venue_slug", "space_id", "space_slug",
    "derivation_evidence_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_asset_fk" FOREIGN KEY (
    "asset_version_id", "venue_slug", "space_slug", "file_name", "file_ext",
    "mime_type", "sha256", "size_bytes"
  ) REFERENCES "asset_versions" (
    "id", "venue_slug", "room_slug", "file_name", "file_ext", "mime_type",
    "sha256", "size_bytes"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_receipt_authority_fk" FOREIGN KEY (
    "output_receipt_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "capability_id",
    "capability_digest", "provider_profile", "provider_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "receipt_role", "output_receipt_digest",
    "receipt_expires_at"
  ) REFERENCES "hr_object_receipts" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "capability_id", "capability_digest",
    "provider_profile", "provider_kind", "provider_account_sha256",
    "endpoint_authority_sha256", "private_bucket_sha256", "receipt_role",
    "receipt_digest", "denial_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_receipt_bytes_fk" FOREIGN KEY (
    "output_receipt_id", "sha256", "size_bytes", "file_name", "mime_type"
  ) REFERENCES "hr_object_receipts" (
    "id", "sha256", "size_bytes", "file_name", "mime_type"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_receipt_version_fk" FOREIGN KEY (
    "output_receipt_id", "storage_key_sha256", "version_kind",
    "storage_version"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_key_sha256", "version_kind", "storage_version"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_receipt_etag_fk" FOREIGN KEY (
    "output_receipt_id", "storage_etag"
  ) REFERENCES "hr_object_receipts" (
    "id", "storage_etag"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_derivation_members_shape" CHECK ((
    "member_index" BETWEEN 0 AND 7
    AND "file_ext" IN ('.sog', '.spz')
    AND "file_name" LIKE '%' || "file_ext"
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" BETWEEN 1 AND 16777216
    AND "created_at" < "receipt_expires_at"
    AND "derivation_expires_at" <= "receipt_expires_at"
    AND jsonb_typeof("member_body") = 'object'
    AND ("member_body"->>'memberIndex')::integer = "member_index"
    AND ("member_body"->>'assetVersionId')::uuid = "asset_version_id"
    AND "member_body"->>'fileName' = "file_name"
    AND "member_body"->>'fileExt' = "file_ext"
    AND "member_body"->>'mimeType' = "mime_type"
    AND "member_body"->>'sha256' = "sha256"
    AND ("member_body"->>'sizeBytes')::bigint = "size_bytes"
    AND ("member_body"->'outputReceipt'->>'receiptId')::uuid =
      "output_receipt_id"
    AND "member_body"->'outputReceipt'->>'receiptDigest' =
      "output_receipt_digest"
  ) IS TRUE),
  CONSTRAINT "hr_derivation_members_asset_unique"
    UNIQUE ("derivation_id", "asset_version_id"),
  CONSTRAINT "hr_derivation_members_receipt_unique"
    UNIQUE ("derivation_id", "output_receipt_id"),
  CONSTRAINT "hr_derivation_members_receipt_digest_unique"
    UNIQUE ("derivation_id", "output_receipt_digest"),
  CONSTRAINT "hr_derivation_members_contract_object_unique" UNIQUE (
    "derivation_id", "provider_kind", "provider_account_sha256",
    "private_bucket_sha256", "storage_key_sha256", "version_kind",
    "storage_version"
  ),
  CONSTRAINT "hr_derivation_members_object_unique" UNIQUE (
    "derivation_id", "provider_profile", "provider_kind",
    "provider_account_sha256", "endpoint_authority_sha256",
    "private_bucket_sha256", "storage_key_sha256", "version_kind",
    "storage_version"
  ),
  CONSTRAINT "hr_derivation_members_exact_unique" UNIQUE (
    "derivation_id", "member_index", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "derivation_evidence_digest",
    "asset_version_id", "venue_slug", "space_slug", "file_name", "file_ext",
    "mime_type", "sha256", "size_bytes", "output_receipt_id",
    "output_receipt_digest", "storage_key_sha256", "receipt_expires_at"
  )
);

CREATE TABLE "hr_transform_reviews" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('transform_review') STORED,
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
  "admission_decision" varchar(20) NOT NULL,
  "admission_reviewed_by" uuid NOT NULL,
  "admission_reviewed_at" timestamptz NOT NULL,
  "admission_member_count" integer NOT NULL,
  "transform_artifact_row_id" uuid NOT NULL,
  "transform_artifact_id" varchar(120) NOT NULL,
  "transform_artifact_digest" varchar(64) NOT NULL,
  "transform_registered_by" uuid NOT NULL,
  "transform_registered_at" timestamptz NOT NULL,
  "transform_review_subject_digest" varchar(64) NOT NULL,
  "reviewer_attestation_id" uuid NOT NULL,
  "reviewer_attestation_digest" varchar(64) NOT NULL,
  "reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('transform_reviewer') STORED,
  "reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('transform_review_subject') STORED,
  "reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("transform_review_subject_digest") STORED,
  "reviewer_actor_id" uuid NOT NULL,
  "reviewer_expires_at" timestamptz NOT NULL,
  "decision" varchar(20) NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "transform_review_digest" varchar(64) NOT NULL,
  "transform_review_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_transform_reviews_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "transform_review_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug", "admission_decision", "admission_reviewed_by",
    "admission_reviewed_at", "admission_member_count"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug", "decision",
    "reviewed_by", "reviewed_at", "member_count"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_admission_transform_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug", "transform_artifact_row_id", "transform_artifact_id",
    "transform_artifact_digest"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug",
    "runtime_transform_artifact_row_id", "runtime_transform_artifact_id",
    "runtime_transform_artifact_digest"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_artifact_fk" FOREIGN KEY (
    "transform_artifact_row_id", "runtime_package_id", "venue_slug",
    "space_slug", "transform_artifact_id", "transform_artifact_digest",
    "transform_registered_by", "transform_registered_at"
  ) REFERENCES "runtime_transform_artifacts" (
    "id", "runtime_package_id", "venue_slug", "room_slug",
    "transform_artifact_id", "artifact_digest", "registered_by", "created_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_reviewer_fk" FOREIGN KEY (
    "reviewer_attestation_id", "reviewer_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "reviewer_role", "reviewer_actor_id", "reviewer_bound_kind",
    "reviewer_bound_reference", "reviewer_bound_digest", "reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_transform_reviews_shape" CHECK ((
    "subject_kind" = 'transform_review'
    AND "admission_decision" = 'approved'
    AND "decision" = 'approved'
    AND "transform_registered_by" <> "reviewer_actor_id"
    AND "admission_reviewed_by" <> "reviewer_actor_id"
    AND "transform_registered_at" <= "reviewed_at"
    AND "admission_reviewed_at" <= "reviewed_at"
    AND "reviewed_at" = "created_at"
    AND "reviewed_at" < "expires_at"
    AND "expires_at" <= "reviewer_expires_at"
    AND "transform_review_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "transform_review_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("transform_review_body") = 'object'
    AND "transform_review_body"->'subject'->>'schemaVersion' =
      'historical-runtime-transform-review-subject.v1'
    AND ("transform_review_body"->'subject'->>'transformReviewId')::uuid =
      "id"
    AND ("transform_review_body"->'subject'->>'venueId')::uuid = "venue_id"
    AND ("transform_review_body"->'subject'->>'spaceId')::uuid = "space_id"
    AND (
      "transform_review_body"->'subject'->>'presentationAdmissionId'
    )::uuid = "presentation_admission_id"
    AND "transform_review_body"->'subject'->>'presentationAdmissionDigest' =
      "presentation_admission_digest"
    AND (
      "transform_review_body"->'subject'->>'runtimePackageId'
    )::uuid = "runtime_package_id"
    AND "transform_review_body"->'subject'->>'runtimePackageContentDigest' =
      "runtime_package_content_digest"
    AND (
      "transform_review_body"->'subject'->>'transformArtifactRowId'
    )::uuid = "transform_artifact_row_id"
    AND "transform_review_body"->'subject'->>'transformArtifactId' =
      "transform_artifact_id"
    AND "transform_review_body"->'subject'->>'transformArtifactDigest' =
      "transform_artifact_digest"
    AND "transform_review_body"->>'subjectDigest' =
      "transform_review_subject_digest"
    AND ("transform_review_body"->>'reviewerAttestationId')::uuid =
      "reviewer_attestation_id"
    AND "transform_review_body"->>'reviewerAttestationDigest' =
      "reviewer_attestation_digest"
    AND ("transform_review_body"->>'reviewerActorId')::uuid =
      "reviewer_actor_id"
    AND "transform_review_body"->>'decision' = "decision"
    AND ("transform_review_body"->>'reviewedAt')::timestamptz = "reviewed_at"
    AND ("transform_review_body"->>'expiresAt')::timestamptz = "expires_at"
    AND "transform_review_body"->>'transformReviewDigest' =
      "transform_review_digest"
  ) IS TRUE),
  CONSTRAINT "hr_transform_reviews_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "presentation_admission_id",
    "runtime_package_id", "transform_artifact_row_id",
    "transform_review_subject_digest", "transform_review_digest",
    "reviewer_actor_id", "expires_at"
  )
);

CREATE TABLE "hr_rights_clearances" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_id" uuid GENERATED ALWAYS AS ("id") STORED,
  "record_kind" varchar(50) GENERATED ALWAYS AS ('rights_clearance') STORED,
  "subject_kind" varchar(40) NOT NULL,
  "environment_id" uuid NOT NULL,
  "environment_mode" varchar(20) NOT NULL,
  "environment_digest" varchar(64) NOT NULL,
  "scope_epoch_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL,
  "space_slug" varchar(100) NOT NULL,
  "derivation_id" uuid NOT NULL,
  "derivation_evidence_digest" varchar(64) NOT NULL,
  "derivation_expires_at" timestamptz NOT NULL,
  "member_index" integer NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "output_receipt_id" uuid NOT NULL,
  "output_receipt_digest" varchar(64) NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "output_receipt_expires_at" timestamptz NOT NULL,
  "presentation_admission_id" uuid NOT NULL,
  "presentation_admission_digest" varchar(64) NOT NULL,
  "runtime_package_id" uuid NOT NULL,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "rights_evidence_row_id" uuid NOT NULL,
  "rights_evidence_digest" varchar(64) NOT NULL,
  "rights_decision" varchar(20) NOT NULL,
  "rights_reviewed_by" uuid NOT NULL,
  "rights_reviewed_at" timestamptz NOT NULL,
  "rights_clearance_subject_digest" varchar(64) NOT NULL,
  "reviewer_attestation_id" uuid NOT NULL,
  "reviewer_attestation_digest" varchar(64) NOT NULL,
  "reviewer_role" varchar(50)
    GENERATED ALWAYS AS ('rights_reviewer') STORED,
  "reviewer_bound_kind" varchar(60)
    GENERATED ALWAYS AS ('rights_clearance_subject') STORED,
  "reviewer_bound_reference" varchar(200)
    GENERATED ALWAYS AS ("id"::text) STORED,
  "reviewer_bound_digest" varchar(64)
    GENERATED ALWAYS AS ("rights_clearance_subject_digest") STORED,
  "reviewer_actor_id" uuid NOT NULL,
  "reviewer_expires_at" timestamptz NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "rights_clearance_digest" varchar(64) NOT NULL,
  "rights_clearance_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_rights_clearances_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "rights_clearance_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_derivation_fk" FOREIGN KEY (
    "derivation_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "derivation_evidence_digest", "derivation_expires_at"
  ) REFERENCES "hr_derivations" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_evidence_digest",
    "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_member_fk" FOREIGN KEY (
    "derivation_id", "member_index", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "derivation_evidence_digest", "asset_version_id", "venue_slug",
    "space_slug", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "output_receipt_id", "output_receipt_digest",
    "storage_key_sha256", "output_receipt_expires_at"
  ) REFERENCES "hr_derivation_members" (
    "derivation_id", "member_index", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id",
    "derivation_evidence_digest", "asset_version_id", "venue_slug",
    "space_slug", "file_name", "file_ext", "mime_type", "sha256",
    "size_bytes", "output_receipt_id", "output_receipt_digest",
    "storage_key_sha256", "receipt_expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_admission_fk" FOREIGN KEY (
    "presentation_admission_id", "presentation_admission_digest",
    "runtime_package_id", "runtime_package_content_digest", "venue_slug",
    "space_slug"
  ) REFERENCES "runtime_presentation_admissions" (
    "id", "admission_digest", "runtime_package_id",
    "runtime_package_content_digest", "venue_slug", "room_slug"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_admission_member_fk" FOREIGN KEY (
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
  CONSTRAINT "hr_rights_clearances_legacy_rights_fk" FOREIGN KEY (
    "rights_evidence_row_id", "asset_version_id", "venue_slug", "space_slug",
    "sha256", "size_bytes", "rights_evidence_digest", "rights_decision",
    "rights_reviewed_by", "rights_reviewed_at"
  ) REFERENCES "runtime_presentation_rights_evidence" (
    "id", "asset_version_id", "venue_slug", "room_slug", "asset_sha256",
    "asset_size_bytes", "evidence_digest", "decision", "reviewed_by",
    "reviewed_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_reviewer_fk" FOREIGN KEY (
    "reviewer_attestation_id", "reviewer_attestation_digest",
    "environment_id", "environment_mode", "environment_digest", "venue_id",
    "space_id", "reviewer_role", "reviewer_actor_id", "reviewer_bound_kind",
    "reviewer_bound_reference", "reviewer_bound_digest", "reviewer_expires_at"
  ) REFERENCES "hr_role_attestations" (
    "id", "attestation_digest", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "role", "actor_id",
    "bound_kind", "bound_reference", "bound_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_rights_clearances_shape" CHECK ((
    "subject_kind" = 'rights_clearance'
    AND "rights_decision" = 'approved'
    AND "reviewer_actor_id" = "rights_reviewed_by"
    AND "rights_clearance_subject_digest" ~ '^[a-f0-9]{64}$'
    AND "rights_clearance_digest" ~ '^[a-f0-9]{64}$'
    AND "rights_reviewed_at" <= "created_at"
    AND "effective_at" >= "created_at"
    AND "effective_at" < "expires_at"
    AND "expires_at" <= LEAST(
      "derivation_expires_at", "output_receipt_expires_at",
      "reviewer_expires_at"
    )
    AND jsonb_typeof("rights_clearance_body") = 'object'
    AND "rights_clearance_body"->'subject'->>'schemaVersion' =
      'historical-runtime-rights-clearance-subject.v1'
    AND (
      "rights_clearance_body"->'subject'->>'rightsClearanceId'
    )::uuid = "id"
    AND ("rights_clearance_body"->'subject'->>'venueId')::uuid = "venue_id"
    AND ("rights_clearance_body"->'subject'->>'spaceId')::uuid = "space_id"
    AND ("rights_clearance_body"->'subject'->>'derivationId')::uuid =
      "derivation_id"
    AND "rights_clearance_body"->'subject'->>'derivationEvidenceDigest' =
      "derivation_evidence_digest"
    AND (
      "rights_clearance_body"->'subject'->>'memberIndex'
    )::integer = "member_index"
    AND ("rights_clearance_body"->'subject'->>'assetVersionId')::uuid =
      "asset_version_id"
    AND ("rights_clearance_body"->'subject'->>'outputReceiptId')::uuid =
      "output_receipt_id"
    AND "rights_clearance_body"->'subject'->>'outputReceiptDigest' =
      "output_receipt_digest"
    AND (
      "rights_clearance_body"->'subject'->>'presentationAdmissionId'
    )::uuid = "presentation_admission_id"
    AND "rights_clearance_body"->'subject'->>'presentationAdmissionDigest' =
      "presentation_admission_digest"
    AND (
      "rights_clearance_body"->'subject'->>'rightsEvidenceRowId'
    )::uuid = "rights_evidence_row_id"
    AND "rights_clearance_body"->'subject'->>'rightsEvidenceDigest' =
      "rights_evidence_digest"
    AND "rights_clearance_body"->'subject'->>'rightsDecision' =
      "rights_decision"
    AND (
      "rights_clearance_body"->'subject'->>'rightsReviewedBy'
    )::uuid = "rights_reviewed_by"
    AND (
      "rights_clearance_body"->'subject'->>'rightsReviewedAt'
    )::timestamptz = "rights_reviewed_at"
    AND "rights_clearance_body"->>'subjectDigest' =
      "rights_clearance_subject_digest"
    AND ("rights_clearance_body"->>'reviewerAttestationId')::uuid =
      "reviewer_attestation_id"
    AND "rights_clearance_body"->>'reviewerAttestationDigest' =
      "reviewer_attestation_digest"
    AND ("rights_clearance_body"->>'reviewerActorId')::uuid =
      "reviewer_actor_id"
    AND ("rights_clearance_body"->>'effectiveAt')::timestamptz =
      "effective_at"
    AND ("rights_clearance_body"->>'expiresAt')::timestamptz = "expires_at"
    AND ("rights_clearance_body"->>'registeredAt')::timestamptz = "created_at"
    AND "rights_clearance_body"->>'rightsClearanceDigest' =
      "rights_clearance_digest"
  ) IS TRUE),
  CONSTRAINT "hr_rights_clearances_exact_unique" UNIQUE (
    "id", "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "derivation_id",
    "derivation_evidence_digest", "member_index", "asset_version_id",
    "output_receipt_id", "output_receipt_digest",
    "presentation_admission_id", "rights_evidence_row_id",
    "rights_clearance_digest", "reviewer_actor_id", "expires_at"
  )
);

CREATE UNIQUE INDEX "hr_rights_clearances_derivation_member_unique"
  ON "hr_rights_clearances" ("derivation_id", "member_index");

-- Reconstruction releases predate finite authority. This wrapper does not
-- rewrite them: it exact-FKs the approved review and verified attestation,
-- then adds a current, revocable, DB-time platform-admin authorization.
-- `supersedes_review_id` is nullable, so it cannot participate in the core
-- composite FK: MATCH SIMPLE would otherwise disable every other comparison
-- for an ordinary first review. Keep the core identity non-null and bind the
-- optional predecessor separately; the issuer also rechecks IS NOT DISTINCT.
ALTER TABLE "reconstruction_release_reviews"
  ADD CONSTRAINT "hr_release_reviews_twin_core_unique" UNIQUE (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "qa_report_digest", "request_digest",
    "reviewer_user_id", "reviewer_authority", "decision", "target_exposure",
    "review_sequence", "reviewed_at"
  );

CREATE TABLE "hr_twin_release_authorities" (
  "id" uuid PRIMARY KEY NOT NULL,
  "record_kind" varchar(50)
    GENERATED ALWAYS AS ('twin_release_authority') STORED,
  "subject_id" uuid NOT NULL,
  "subject_kind" varchar(40) NOT NULL,
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
  "release_review_sequence" integer NOT NULL,
  "release_supersedes_review_id" uuid,
  "release_reviewed_at" timestamptz NOT NULL,
  "release_attestation_id" uuid NOT NULL,
  "release_attestation_envelope_sha256" varchar(64) NOT NULL,
  "release_attestation_verified_by" uuid NOT NULL,
  "release_attestation_verified_at" timestamptz NOT NULL,
  "authority_snapshot_id" uuid NOT NULL,
  "approved_by_actor_id" uuid NOT NULL,
  "authority_digest" varchar(64) NOT NULL,
  "authority_body" jsonb NOT NULL,
  "authority_snapshotted_at" timestamptz NOT NULL,
  "approved_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "twin_release_authority_digest" varchar(64) NOT NULL,
  "twin_release_authority_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_db_clock_ms"(),
  CONSTRAINT "hr_twin_release_authorities_record_fk" FOREIGN KEY (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "twin_release_authority_digest", "expires_at"
  ) REFERENCES "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "record_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_scope_fk" FOREIGN KEY (
    "scope_epoch_id", "environment_id", "environment_mode",
    "environment_digest", "venue_id", "space_id", "scope_epoch",
    "scope_epoch_digest", "scope_epoch_expires_at"
  ) REFERENCES "hr_scope_epochs" (
    "id", "environment_id", "environment_mode", "environment_digest",
    "venue_id", "space_id", "epoch", "epoch_digest", "expires_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_venue_fk" FOREIGN KEY (
    "venue_id", "venue_slug"
  ) REFERENCES "venues" ("id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_space_fk" FOREIGN KEY (
    "space_id", "venue_id", "space_slug"
  ) REFERENCES "spaces" ("id", "venue_id", "slug") ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_release_fk" FOREIGN KEY (
    "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "release_created_by", "release_created_at"
  ) REFERENCES "reconstruction_releases" (
    "id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "created_by", "created_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_review_fk" FOREIGN KEY (
    "release_review_id", "release_id", "venue_slug", "release_kind",
    "release_digest", "release_manifest_sha256", "release_qa_report_digest",
    "release_review_digest", "release_reviewer_actor_id",
    "release_reviewer_authority", "release_review_decision",
    "release_target_exposure", "release_review_sequence", "release_reviewed_at"
  ) REFERENCES "reconstruction_release_reviews" (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "release_manifest_sha256", "qa_report_digest", "request_digest",
    "reviewer_user_id", "reviewer_authority", "decision", "target_exposure",
    "review_sequence", "reviewed_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_supersedes_fk" FOREIGN KEY (
    "release_supersedes_review_id"
  ) REFERENCES "reconstruction_release_reviews" ("id") ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_attestation_fk" FOREIGN KEY (
    "release_attestation_id", "release_id", "venue_slug", "release_kind",
    "release_digest", "release_qa_report_digest", "release_review_id",
    "release_review_digest", "release_attestation_envelope_sha256",
    "release_attestation_verified_by", "release_attestation_verified_at"
  ) REFERENCES "reconstruction_release_attestations" (
    "id", "release_id", "venue_slug", "release_kind", "release_digest",
    "qa_report_digest", "review_id", "review_digest", "envelope_sha256",
    "verified_by", "verified_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_snapshot_fk" FOREIGN KEY (
    "authority_snapshot_id", "id", "subject_id", "subject_kind",
    "environment_id", "environment_mode", "environment_digest",
    "scope_epoch_id", "venue_id", "space_id", "approved_by_actor_id",
    "authority_digest", "authority_body", "authority_snapshotted_at"
  ) REFERENCES "hr_authority_snapshots" (
    "id", "attestation_id", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "actor_id", "authority_digest", "authority_body",
    "snapshotted_at"
  ) ON DELETE RESTRICT,
  CONSTRAINT "hr_twin_release_authorities_shape" CHECK ((
    "subject_kind" = 'scene_validation'
    -- Legacy release reviews/attestations do not retain the raw signed bytes,
    -- current purpose-scoped key, or private artifact receipt required by
    -- production T-541. Keep this wrapper forensic/test-only until a distinct
    -- reverified production leaf is implemented.
    AND "environment_mode" = 'test'
    AND "release_kind" = 'venue_twin_v1'
    AND "release_reviewer_authority" = 'platform_admin'
    AND "release_review_decision" = 'approved'
    AND "release_target_exposure" IN ('expert_review', 'public')
    AND "release_created_at" <= "release_reviewed_at"
    AND "release_review_sequence" > 0
    AND "release_reviewed_at" <= "release_attestation_verified_at"
    AND "release_attestation_verified_at" <= "authority_snapshotted_at"
    AND "authority_snapshotted_at" <= "approved_at"
    AND "approved_at" = "created_at"
    AND "approved_at" < "expires_at"
    AND "expires_at" = LEAST(
      "approved_at" + interval '30 days', "scope_epoch_expires_at"
    )
    AND "approved_by_actor_id" <> "release_created_by"
    AND "approved_by_actor_id" <> "release_reviewer_actor_id"
    AND "approved_by_actor_id" <> "release_attestation_verified_by"
    AND "release_created_by" <> "release_reviewer_actor_id"
    AND "release_created_by" <> "release_attestation_verified_by"
    AND "release_reviewer_actor_id" <> "release_attestation_verified_by"
    AND "twin_release_authority_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("twin_release_authority_body") = 'object'
    AND "twin_release_authority_body"->>'schemaVersion' =
      'historical-runtime-twin-release-authority.v1'
    AND ("twin_release_authority_body"->>'authorityId')::uuid = "id"
    AND ("twin_release_authority_body"->>'sceneValidationId')::uuid =
      "subject_id"
    AND ("twin_release_authority_body"->>'releaseId')::uuid = "release_id"
    AND "twin_release_authority_body"->>'releaseDigest' = "release_digest"
    AND "twin_release_authority_body"->>'releaseManifestSha256' =
      "release_manifest_sha256"
    AND ("twin_release_authority_body"->>'releaseReviewId')::uuid =
      "release_review_id"
    AND ("twin_release_authority_body"->>'releaseAttestationId')::uuid =
      "release_attestation_id"
    AND ("twin_release_authority_body"->>'approvedByActorId')::uuid =
      "approved_by_actor_id"
    AND "twin_release_authority_body"->>'authorityDigest' =
      "authority_digest"
    AND ("twin_release_authority_body"->>'approvedAt')::timestamptz =
      "approved_at"
    AND ("twin_release_authority_body"->>'expiresAt')::timestamptz =
      "expires_at"
    AND "twin_release_authority_body"->>'twinReleaseAuthorityDigest' =
      "twin_release_authority_digest"
  ) IS TRUE),
  CONSTRAINT "hr_twin_release_authorities_exact_unique" UNIQUE (
    "id", "subject_id", "environment_id", "environment_mode",
    "environment_digest", "scope_epoch_id", "venue_id", "space_id",
    "release_id", "release_digest", "release_manifest_sha256",
    "twin_release_authority_digest", "approved_by_actor_id", "expires_at"
  )
);


-- -------------------------------------------------------------------------
-- Current-authority and trusted-verifier guards.
--
-- Authority serialization uses protected row locks, never PostgreSQL advisory
-- locks. Advisory locks are callable by an ordinary database login and would
-- let a compromised application credential hold the exact authority lock and
-- indefinitely delay emergency revocation. Only the NOLOGIN evidence owner can
-- create or lock these rows, through the private helper below.

CREATE TABLE "hr_authority_lock_rows" (
  "lock_namespace" varchar(64) NOT NULL,
  "lock_key" varchar(256) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT "hr_wall_clock_ms"(),
  CONSTRAINT "hr_authority_lock_rows_pk" PRIMARY KEY (
    "lock_namespace", "lock_key"
  ),
  CONSTRAINT "hr_authority_lock_rows_shape" CHECK (
    "lock_namespace" ~ '^[a-z][a-z0-9_-]{0,63}$'
    AND "lock_key" ~ '^[!-~]+$'
    AND char_length("lock_key") BETWEEN 1 AND 256
  )
);

CREATE TRIGGER "a_hr_require_authority_lock_owner"
  BEFORE INSERT ON "hr_authority_lock_rows"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();

CREATE OR REPLACE FUNCTION "hr_lock_authority"(
  p_lock_namespace text,
  p_lock_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public."hr_authority_lock_rows" (
    "lock_namespace", "lock_key"
  ) VALUES (
    p_lock_namespace, p_lock_key
  )
  ON CONFLICT ("lock_namespace", "lock_key") DO NOTHING;

  PERFORM 1
  FROM public."hr_authority_lock_rows"
  WHERE "lock_namespace" = p_lock_namespace
    AND "lock_key" = p_lock_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical-runtime authority lock row is unavailable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_authority_lock_row';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_lock_scope"(
  p_environment_id uuid,
  p_venue_id uuid,
  p_space_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM "hr_lock_authority"(
    'scope',
    p_environment_id::text || ':' || p_venue_id::text || ':' || p_space_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_scope_current"(
  p_scope_epoch_id uuid,
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
  live_scope "hr_scope_epochs"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM "hr_lock_scope"(p_environment_id, p_venue_id, p_space_id);
  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());
  SELECT *
  INTO live_scope
  FROM "hr_scope_epochs"
  WHERE "environment_id" = p_environment_id
    AND "environment_mode" = p_environment_mode
    AND "environment_digest" = p_environment_digest
    AND "venue_id" = p_venue_id
    AND "space_id" = p_space_id
    AND "effective_at" <= wall_now
  ORDER BY "epoch" DESC
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND
     OR live_scope."id" IS DISTINCT FROM p_scope_epoch_id
     OR live_scope."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1 FROM "hr_scope_epoch_revocations" AS revoked
       WHERE revoked."epoch_id" = p_scope_epoch_id
     ) THEN
    RAISE EXCEPTION 'historical-runtime scope epoch is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_scope_epoch_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_signing_key_current"(
  p_signing_key_authority_id uuid,
  p_scope_epoch_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_purpose text,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  live_key "hr_signing_key_authorities"%ROWTYPE;
  live_policy_id uuid;
  wall_now timestamptz;
BEGIN
  PERFORM "hr_assert_scope_current"(
    p_scope_epoch_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, p_action_at
  );
  -- Discover the immutable policy identity, then serialize every key-current
  -- decision with both the legacy policy revocation writer and the scoped key
  -- authority revocation writer. Re-read the row only after both locks so a
  -- revocation cannot commit between our currentness snapshot and acceptance.
  SELECT "key_policy_id" INTO live_policy_id
  FROM "hr_signing_key_authorities"
  WHERE "id" = p_signing_key_authority_id;
  IF FOUND THEN
    PERFORM "hr_lock_authority"('key-policy', live_policy_id::text);
    PERFORM "hr_lock_authority"(
      'key-authority', p_signing_key_authority_id::text
    );
    SELECT * INTO live_key
    FROM "hr_signing_key_authorities"
    WHERE "id" = p_signing_key_authority_id
    FOR SHARE;
  END IF;
  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());
  IF NOT FOUND
     OR live_key."environment_id" IS DISTINCT FROM p_environment_id
     OR live_key."environment_mode" IS DISTINCT FROM p_environment_mode
     OR live_key."environment_digest" IS DISTINCT FROM p_environment_digest
     OR live_key."scope_epoch_id" IS DISTINCT FROM p_scope_epoch_id
     OR live_key."venue_id" IS DISTINCT FROM p_venue_id
     OR live_key."space_id" IS DISTINCT FROM p_space_id
     OR live_key."purpose" IS DISTINCT FROM p_purpose
     OR live_key."policy_effective_at" > wall_now
     OR live_key."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1 FROM "hr_signing_key_authority_revocations" AS revoked
       WHERE revoked."signing_key_authority_id" = p_signing_key_authority_id
     )
     OR EXISTS (
       SELECT 1 FROM "runtime_execution_key_policy_revocations" AS revoked
       WHERE revoked."policy_id" = live_key."key_policy_id"
     ) THEN
    RAISE EXCEPTION 'historical-runtime signing key is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_signing_key_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_object_receipt_current"(
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  live_receipt "hr_object_receipts"%ROWTYPE;
  live_capability "hr_provider_capabilities"%ROWTYPE;
  live_capability_id uuid;
  live_scope_epoch_id uuid;
  wall_now timestamptz;
BEGIN
  -- Discover immutable identities without taking a row lock before the
  -- canonical scope lock.
  SELECT receipt."capability_id" INTO live_capability_id
  FROM "hr_object_receipts" AS receipt
  WHERE receipt."id" = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical-runtime private object receipt is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_object_receipt_current';
  END IF;
  SELECT capability."scope_epoch_id" INTO live_scope_epoch_id
  FROM "hr_provider_capabilities" AS capability
  WHERE capability."id" = live_capability_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical-runtime provider capability is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_provider_capability_current';
  END IF;

  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());
  PERFORM "hr_assert_scope_current"(
    live_scope_epoch_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  PERFORM "hr_lock_authority"(
    'provider-capability', live_capability_id::text
  );

  -- Re-read under locks, then evaluate current wall time. This prevents both
  -- a revocation race and expiry extension while waiting for a lock.
  SELECT * INTO live_receipt
  FROM "hr_object_receipts"
  WHERE "id" = p_receipt_id
  FOR SHARE;
  SELECT * INTO live_capability
  FROM "hr_provider_capabilities"
  WHERE "id" = live_capability_id
  FOR SHARE;
  wall_now := GREATEST(wall_now, "hr_wall_clock_ms"());
  IF live_receipt."id" IS NULL
     OR live_receipt."capability_id" IS DISTINCT FROM live_capability_id
     OR live_receipt."environment_id" IS DISTINCT FROM p_environment_id
     OR live_receipt."environment_mode" IS DISTINCT FROM p_environment_mode
     OR live_receipt."environment_digest" IS DISTINCT FROM p_environment_digest
     OR live_receipt."venue_id" IS DISTINCT FROM p_venue_id
     OR live_receipt."space_id" IS DISTINCT FROM p_space_id
     OR live_receipt."denial_expires_at" <= wall_now THEN
    RAISE EXCEPTION 'historical-runtime private object receipt is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_object_receipt_current';
  END IF;
  IF live_capability."id" IS NULL
     OR live_capability."scope_epoch_id" IS DISTINCT FROM live_scope_epoch_id
     OR live_capability."environment_id" IS DISTINCT FROM p_environment_id
     OR live_capability."environment_mode" IS DISTINCT FROM p_environment_mode
     OR live_capability."environment_digest" IS DISTINCT FROM p_environment_digest
     OR live_capability."venue_id" IS DISTINCT FROM p_venue_id
     OR live_capability."space_id" IS DISTINCT FROM p_space_id
     OR live_capability."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1 FROM "hr_provider_capability_revocations" AS revoked
       WHERE revoked."capability_id" = live_capability_id
     ) THEN
    RAISE EXCEPTION 'historical-runtime provider capability is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_provider_capability_current';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_role_snapshot_current"(
  p_snapshot_id uuid,
  p_role text,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  snapshot_row "hr_authority_snapshots"%ROWTYPE;
  live_user record;
  live_membership record;
  live_workspace record;
  role_allowed boolean;
  wall_now timestamptz;
BEGIN
  SELECT * INTO STRICT snapshot_row
  FROM "hr_authority_snapshots"
  WHERE "id" = p_snapshot_id
  FOR SHARE;
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_user
  FROM "users"
  WHERE "id" = snapshot_row."actor_id"
  FOR SHARE;
  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());

  IF live_user."role" IS DISTINCT FROM snapshot_row."user_role"
     OR live_user."platform_role" IS DISTINCT FROM snapshot_row."platform_role"
     OR live_user."venue_id" IS DISTINCT FROM snapshot_row."user_venue_id"
     OR (snapshot_row."authentication_source" = 'clerk_session'
       AND live_user."clerk_id" IS NULL) THEN
    RAISE EXCEPTION 'authority snapshot user state is no longer current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_authority_snapshot_current';
  END IF;

  IF snapshot_row."workspace_state" = 'active' THEN
    SELECT "primary_venue_id", "status", "deleted_at"
    INTO STRICT live_workspace
    FROM "workspaces"
    WHERE "id" = snapshot_row."workspace_id"
    FOR SHARE;
    SELECT "user_id", "workspace_id", "role", "venue_role", "status",
      date_trunc('milliseconds', "updated_at") AS updated_at
    INTO STRICT live_membership
    FROM "workspace_memberships"
    WHERE "id" = snapshot_row."membership_id"
    FOR SHARE;
    IF live_membership."user_id" IS DISTINCT FROM snapshot_row."actor_id"
       OR live_membership."workspace_id" IS DISTINCT FROM snapshot_row."workspace_id"
       OR live_membership."role" IS DISTINCT FROM snapshot_row."workspace_role"
       OR live_membership."venue_role" IS DISTINCT FROM snapshot_row."venue_role"
       OR live_membership."status" <> 'active'
       OR live_membership."updated_at" IS DISTINCT FROM
          snapshot_row."membership_updated_at"
       OR live_workspace."primary_venue_id" IS DISTINCT FROM
          snapshot_row."venue_id"
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'authority membership is no longer current'
        USING ERRCODE = '55000',
              CONSTRAINT = 'hr_authority_snapshot_current';
    END IF;
  END IF;

  role_allowed := CASE
    WHEN p_role = 'owner_authorizer' THEN
      snapshot_row."workspace_state" = 'active'
      AND snapshot_row."workspace_role" IN ('owner', 'admin')
    WHEN snapshot_row."platform_role" IN ('operator', 'admin') THEN true
    WHEN snapshot_row."workspace_state" <> 'active' THEN false
    WHEN p_role IN (
      'source_custodian', 'package_custodian', 'capture_operator'
    ) THEN snapshot_row."workspace_role" IN ('owner', 'admin', 'staff')
      OR snapshot_row."venue_role" = 'hallkeeper'
    ELSE snapshot_row."user_role" IN ('admin', 'staff', 'hallkeeper')
      AND snapshot_row."workspace_role" IN (
        'owner', 'admin', 'staff', 'hallkeeper'
      )
  END;
  IF NOT role_allowed THEN
    RAISE EXCEPTION 'authority snapshot cannot perform requested evidence role'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_authority_snapshot_role';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_role_attestation_current"(
  p_attestation_id uuid,
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
  live_role "hr_role_attestations"%ROWTYPE;
  draft_row "hr_role_attestation_drafts"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM "hr_lock_scope"(p_environment_id, p_venue_id, p_space_id);
  PERFORM "hr_lock_authority"('role-attestation', p_attestation_id::text);
  SELECT * INTO live_role
  FROM "hr_role_attestations"
  WHERE "id" = p_attestation_id
  FOR SHARE;
  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());
  IF NOT FOUND
     OR live_role."environment_id" IS DISTINCT FROM p_environment_id
     OR live_role."environment_mode" IS DISTINCT FROM p_environment_mode
     OR live_role."environment_digest" IS DISTINCT FROM p_environment_digest
     OR live_role."venue_id" IS DISTINCT FROM p_venue_id
     OR live_role."space_id" IS DISTINCT FROM p_space_id
     OR live_role."effective_at" > wall_now
     OR live_role."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1 FROM "hr_role_attestation_revocations" AS revoked
       WHERE revoked."attestation_id" = p_attestation_id
     ) THEN
    RAISE EXCEPTION 'historical-runtime role attestation is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_role_attestation_current';
  END IF;
  SELECT * INTO STRICT draft_row
  FROM "hr_role_attestation_drafts"
  WHERE "id" = p_attestation_id
  FOR SHARE;
  PERFORM "hr_assert_object_receipt_current"(
    draft_row."evidence_document_receipt_id", p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  PERFORM "hr_assert_scope_current"(
    draft_row."scope_epoch_id", p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  PERFORM "hr_assert_signing_key_current"(
    draft_row."signing_key_authority_id", draft_row."scope_epoch_id",
    p_environment_id, p_environment_mode, p_environment_digest,
    p_venue_id, p_space_id, 'historical_runtime_role_attestation', wall_now
  );
  PERFORM "hr_assert_role_snapshot_current"(
    draft_row."authority_snapshot_id", live_role."role", wall_now
  );
END;
$$;

-- The generic record is an index over one typed immutable authority leaf; it
-- is never authority by itself. Reconstruct the exact parent/leaf identity on
-- every currentness read and at the deferred insert boundary.
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
      SELECT count(*) INTO exact_count
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

CREATE OR REPLACE FUNCTION "hr_insert_evidence_record"(
  p_id uuid,
  p_record_kind text,
  p_subject_id uuid,
  p_subject_kind text,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_scope_epoch_id uuid,
  p_venue_id uuid,
  p_space_id uuid,
  p_record_digest text,
  p_effective_at timestamptz,
  p_expires_at timestamptz,
  p_action_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  scope_row "hr_scope_epochs"%ROWTYPE;
BEGIN
  PERFORM "hr_assert_scope_current"(
    p_scope_epoch_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, p_action_at
  );
  SELECT * INTO STRICT scope_row
  FROM "hr_scope_epochs"
  WHERE "id" = p_scope_epoch_id
  FOR SHARE;
  IF p_effective_at > p_action_at
     OR p_action_at >= p_expires_at
     OR p_expires_at > scope_row."expires_at" THEN
    RAISE EXCEPTION 'typed evidence record has an invalid authority window'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_evidence_record_authority_window';
  END IF;
  INSERT INTO "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "scope_epoch", "scope_epoch_digest",
    "scope_epoch_expires_at", "record_digest", "effective_at", "expires_at",
    "created_at"
  ) VALUES (
    p_id, p_record_kind, p_subject_id, p_subject_kind, p_environment_id,
    p_environment_mode, p_environment_digest, p_scope_epoch_id, p_venue_id,
    p_space_id, scope_row."epoch", scope_row."epoch_digest",
    scope_row."expires_at", p_record_digest, p_effective_at, p_expires_at,
    p_action_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION "hr_evidence_record_leaf_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM "hr_assert_evidence_record_leaf_exact"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_evidence_record_typed_leaf_complete"
  AFTER INSERT ON "hr_evidence_records"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_evidence_record_leaf_deferred_guard"();

CREATE OR REPLACE FUNCTION "hr_assert_evidence_record_current"(
  p_record_id uuid,
  p_record_kind text,
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
  live_record "hr_evidence_records"%ROWTYPE;
  wall_now timestamptz;
BEGIN
  PERFORM "hr_lock_scope"(p_environment_id, p_venue_id, p_space_id);
  PERFORM "hr_lock_authority"('evidence-record', p_record_id::text);
  SELECT * INTO live_record
  FROM "hr_evidence_records"
  WHERE "id" = p_record_id
  FOR SHARE;
  wall_now := GREATEST(p_action_at, "hr_wall_clock_ms"());
  IF NOT FOUND
     OR live_record."record_kind" IS DISTINCT FROM p_record_kind
     OR live_record."environment_id" IS DISTINCT FROM p_environment_id
     OR live_record."environment_mode" IS DISTINCT FROM p_environment_mode
     OR live_record."environment_digest" IS DISTINCT FROM p_environment_digest
     OR live_record."venue_id" IS DISTINCT FROM p_venue_id
     OR live_record."space_id" IS DISTINCT FROM p_space_id
     OR live_record."effective_at" > wall_now
     OR live_record."expires_at" <= wall_now
     OR EXISTS (
       SELECT 1 FROM "hr_evidence_record_revocations" AS revoked
       WHERE revoked."record_id" = p_record_id
     ) THEN
    RAISE EXCEPTION 'historical-runtime evidence record is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_evidence_record_current';
  END IF;
  PERFORM "hr_assert_scope_current"(
    live_record."scope_epoch_id", p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  PERFORM "hr_assert_evidence_record_leaf_exact"(p_record_id);
END;
$$;


CREATE OR REPLACE FUNCTION "hr_issue_role_attestation_draft"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_at timestamptz;
  requested_expires_at timestamptz := date_trunc('milliseconds', NEW."expires_at");
  snapshot_row "hr_authority_snapshots"%ROWTYPE;
  key_row "hr_signing_key_authorities"%ROWTYPE;
  receipt_row "hr_object_receipts"%ROWTYPE;
  document_material jsonb;
  document_receipt jsonb;
  subject_material jsonb;
  statement_predicate jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  action_at := "hr_db_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", action_at
  );

  SELECT * INTO STRICT snapshot_row
  FROM "hr_authority_snapshots"
  WHERE "id" = NEW."authority_snapshot_id"
  FOR SHARE;
  IF snapshot_row."attestation_id" IS DISTINCT FROM NEW."id"
     OR snapshot_row."subject_id" IS DISTINCT FROM NEW."subject_id"
     OR snapshot_row."subject_kind" IS DISTINCT FROM NEW."subject_kind"
     OR snapshot_row."environment_id" IS DISTINCT FROM NEW."environment_id"
     OR snapshot_row."environment_mode" IS DISTINCT FROM NEW."environment_mode"
     OR snapshot_row."environment_digest" IS DISTINCT FROM NEW."environment_digest"
     OR snapshot_row."scope_epoch_id" IS DISTINCT FROM NEW."scope_epoch_id"
     OR snapshot_row."venue_id" IS DISTINCT FROM NEW."venue_id"
     OR snapshot_row."space_id" IS DISTINCT FROM NEW."space_id"
     OR snapshot_row."actor_id" IS DISTINCT FROM NEW."actor_id" THEN
    RAISE EXCEPTION 'authority snapshot does not bind this role subject'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_role_draft_authority_exact';
  END IF;
  PERFORM "hr_assert_role_snapshot_current"(
    snapshot_row."id", NEW."role", action_at
  );

  SELECT * INTO STRICT key_row
  FROM "hr_signing_key_authorities"
  WHERE "id" = NEW."signing_key_authority_id"
  FOR SHARE;
  IF key_row."purpose" <> 'historical_runtime_role_attestation' THEN
    RAISE EXCEPTION 'role draft requires role-attestation signing purpose'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_role_draft_key_purpose';
  END IF;
  PERFORM "hr_assert_signing_key_current"(
    key_row."id", NEW."scope_epoch_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", 'historical_runtime_role_attestation', action_at
  );

  document_material := "hr_role_evidence_document"(
    NEW."evidence_body", NEW."role"
  );
  IF jsonb_typeof(document_material) <> 'object' THEN
    RAISE EXCEPTION 'role evidence document is missing'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_role_draft_document';
  END IF;
  document_receipt := document_material->'documentReceipt';
  SELECT * INTO STRICT receipt_row
  FROM "hr_object_receipts"
  WHERE "id" = (document_receipt->>'receiptId')::uuid
  FOR SHARE;
  IF receipt_row."receipt_role" <> 'evidence_document'
     OR receipt_row."receipt_body" IS DISTINCT FROM document_receipt
     OR receipt_row."receipt_digest" IS DISTINCT FROM
        document_receipt->>'receiptDigest' THEN
    RAISE EXCEPTION 'role evidence document is not the exact private receipt'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_role_draft_document';
  END IF;
  PERFORM "hr_assert_object_receipt_current"(
    receipt_row."id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", action_at
  );

  IF requested_expires_at IS NULL OR requested_expires_at <= action_at THEN
    RAISE EXCEPTION 'role authority must have a future expiry'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_role_draft_expiry';
  END IF;

  NEW."created_at" := action_at;
  NEW."recorded_at" := action_at;
  NEW."effective_at" := action_at;
  NEW."expires_at" := LEAST(
    requested_expires_at, action_at + interval '365 days',
    key_row."expires_at", receipt_row."denial_expires_at"
  );
  NEW."nonce" := gen_random_uuid();
  NEW."authority_digest" := snapshot_row."authority_digest";
  NEW."authority_body" := snapshot_row."authority_body";
  NEW."authority_snapshotted_at" := snapshot_row."snapshotted_at";
  NEW."evidence_document_receipt_id" := receipt_row."id";
  NEW."evidence_document_receipt_role" := 'evidence_document';
  NEW."evidence_document_receipt_digest" := receipt_row."receipt_digest";
  NEW."evidence_document_expires_at" := receipt_row."denial_expires_at";
  NEW."evidence_scope_digest" := document_material->>'scopeDigest';
  NEW."evidence_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-role-evidence.v1\n'
      || "hr_stable_canonical_json"(NEW."evidence_body"),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."key_policy_id" := key_row."key_policy_id";
  NEW."key_policy_purpose" := key_row."purpose";
  NEW."key_policy_digest" := key_row."key_policy_digest";
  NEW."key_id" := key_row."key_id";
  NEW."public_key_fingerprint" := key_row."public_key_fingerprint";
  NEW."key_effective_at" := key_row."policy_effective_at";
  NEW."key_expires_at" := key_row."expires_at";
  NEW."bound_reference" := NEW."subject_id"::text;
  NEW."bound_kind" := CASE
    WHEN NEW."role" = 'capture_operator' THEN 'capture_lineage'
    WHEN NEW."role" IN (
      'source_custodian', 'owner_authorizer', 'privacy_reviewer',
      'movable_content_reviewer'
    ) THEN 'source_receipt_set'
    WHEN NEW."role" = 'normalizer' THEN 'capture_content_subject'
    WHEN NEW."role" = 'capture_final_reviewer' THEN 'capture_root_evidence'
    WHEN NEW."role" = 'derivative_producer' THEN 'conversion_recipe'
    WHEN NEW."role" IN ('derivative_custodian', 'derivative_reviewer')
      THEN 'derivation_members'
    WHEN NEW."role" = 'package_custodian' THEN 'runtime_manifest'
    WHEN NEW."role" = 'qa_reviewer' THEN 'runtime_qa_record'
    WHEN NEW."role" = 'transform_reviewer' THEN 'transform_review_subject'
    WHEN NEW."role" = 'rights_reviewer' THEN 'rights_clearance_subject'
    WHEN NEW."role" = 'scene_reviewer' THEN 'scene_validation_subject'
    WHEN NEW."role" = 'admission_reviewer' THEN 'presentation_admission'
    WHEN NEW."role" = 'profile_final_reviewer' THEN 'reviewed_profile_subject'
    WHEN NEW."role" = 'execution_reviewer'
      THEN 'execution_activation_subject'
  END;
  NEW."bound_digest" := CASE
    WHEN NEW."role" = 'capture_operator' THEN NEW."evidence_scope_digest"
    WHEN NEW."role" IN (
      'source_custodian', 'owner_authorizer', 'privacy_reviewer',
      'movable_content_reviewer'
    ) THEN NEW."evidence_body"->>'sourceReceiptSetDigest'
    WHEN NEW."role" = 'normalizer'
      THEN NEW."evidence_body"->>'captureContentSubjectDigest'
    WHEN NEW."role" = 'capture_final_reviewer'
      THEN NEW."evidence_body"->>'captureRootEvidenceDigest'
    WHEN NEW."role" = 'derivative_producer'
      THEN NEW."evidence_body"->>'conversionRecipeDigest'
    WHEN NEW."role" IN ('derivative_custodian', 'derivative_reviewer')
      THEN NEW."evidence_body"->>'outputReceiptSetDigest'
    WHEN NEW."role" = 'package_custodian'
      THEN NEW."evidence_body"->>'runtimeManifestDigest'
    WHEN NEW."role" = 'qa_reviewer'
      THEN NEW."evidence_body"->>'runtimeQaRecordDigest'
    WHEN NEW."role" = 'transform_reviewer'
      THEN NEW."evidence_body"->>'transformReviewSubjectDigest'
    WHEN NEW."role" = 'rights_reviewer'
      THEN NEW."evidence_body"->>'rightsClearanceSubjectDigest'
    WHEN NEW."role" = 'scene_reviewer'
      THEN NEW."evidence_body"->>'sceneValidationSubjectDigest'
    WHEN NEW."role" = 'admission_reviewer'
      THEN NEW."evidence_body"->>'presentationAdmissionDigest'
    WHEN NEW."role" = 'profile_final_reviewer'
      THEN NEW."evidence_body"->>'reviewedProfileSubjectDigest'
    WHEN NEW."role" = 'execution_reviewer'
      THEN NEW."evidence_body"->>'executionActivationSubjectDigest'
  END;

  subject_material := jsonb_build_object(
    'actorId', NEW."actor_id"::text,
    'attestationId', NEW."id"::text,
    'authoritySnapshot', NEW."authority_body",
    'effectiveAt', "hr_iso_utc_ms"(NEW."effective_at"),
    'evidence', NEW."evidence_body",
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'keyId', NEW."key_id",
    'keyPolicyDigest', NEW."key_policy_digest",
    'keyPolicyId', NEW."key_policy_id"::text,
    'nonce', NEW."nonce"::text,
    'recordedAt', "hr_iso_utc_ms"(NEW."recorded_at"),
    'role', NEW."role",
    'schemaVersion', 'historical-runtime-role-attestation.v1',
    'signerPublicKeySha256', 'sha256:' || NEW."public_key_fingerprint",
    'spaceId', NEW."space_id"::text,
    'subjectId', NEW."subject_id"::text,
    'subjectKind', NEW."subject_kind",
    'tenantBoundary', 'venue_id_v1',
    'tenantId', NEW."venue_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."role_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-role-attestation-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."subject_body" := subject_material || jsonb_build_object(
    'roleAttestationSubjectDigest', NEW."role_subject_digest"
  );
  statement_predicate := jsonb_build_object(
    'actorId', NEW."actor_id"::text,
    'attestationId', NEW."id"::text,
    'effectiveAt', "hr_iso_utc_ms"(NEW."effective_at"),
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'issuedAt', "hr_iso_utc_ms"(NEW."recorded_at"),
    'keyId', NEW."key_id",
    'keyPolicyDigest', NEW."key_policy_digest",
    'keyPolicyId', NEW."key_policy_id"::text,
    'nonce', NEW."nonce"::text,
    'role', NEW."role",
    'roleAttestationSubjectDigest', NEW."role_subject_digest",
    'signerPublicKeySha256', 'sha256:' || NEW."public_key_fingerprint",
    'spaceId', NEW."space_id"::text,
    'subjectKind', NEW."subject_kind",
    'tenantId', NEW."venue_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."statement_body" := jsonb_build_object(
    'authority', 'venue_evidence',
    'evidenceKind', 'historical_runtime_role_attestation',
    'predicate', statement_predicate,
    'schemaVersion', 'historical-runtime-role-attestation-statement.v1',
    'subjectDigest', NEW."role_subject_digest",
    'subjectName', 'historical-runtime-role-attestation/' || NEW."id"::text
  );
  NEW."payload_type" :=
    'application/vnd.venviewer.historical-runtime-role-attestation.v1+json';
  NEW."payload_bytes" := convert_to(
    "hr_stable_canonical_json"(NEW."statement_body"), 'UTF8'
  );
  NEW."payload_sha256" := encode(digest(NEW."payload_bytes", 'sha256'), 'hex');
  NEW."payload_byte_length" := octet_length(NEW."payload_bytes");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_issue_role_attestation_draft"
  BEFORE INSERT ON "hr_role_attestation_drafts"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_role_attestation_draft"();

CREATE OR REPLACE FUNCTION "hr_accept_role_attestation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_at timestamptz;
  draft_row "hr_role_attestation_drafts"%ROWTYPE;
  raw_evidence jsonb;
  receipt_material jsonb;
BEGIN
  SELECT * INTO STRICT draft_row
  FROM "hr_role_attestation_drafts"
  WHERE "id" = NEW."id"
  FOR SHARE;
  PERFORM "hr_lock_scope"(
    draft_row."environment_id", draft_row."venue_id", draft_row."space_id"
  );
  PERFORM "hr_lock_authority"('role-attestation', NEW."id"::text);
  action_at := "hr_db_clock_ms"();
  PERFORM "hr_assert_scope_current"(
    draft_row."scope_epoch_id", draft_row."environment_id",
    draft_row."environment_mode", draft_row."environment_digest",
    draft_row."venue_id", draft_row."space_id", action_at
  );
  PERFORM "hr_assert_signing_key_current"(
    draft_row."signing_key_authority_id", draft_row."scope_epoch_id",
    draft_row."environment_id", draft_row."environment_mode",
    draft_row."environment_digest", draft_row."venue_id",
    draft_row."space_id", 'historical_runtime_role_attestation', action_at
  );
  PERFORM "hr_assert_object_receipt_current"(
    draft_row."evidence_document_receipt_id", draft_row."environment_id",
    draft_row."environment_mode", draft_row."environment_digest",
    draft_row."venue_id", draft_row."space_id", action_at
  );
  PERFORM "hr_assert_role_snapshot_current"(
    draft_row."authority_snapshot_id", draft_row."role", action_at
  );
  IF draft_row."expires_at" <= action_at THEN
    RAISE EXCEPTION 'role draft expired before signature verification'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_role_attestation_current';
  END IF;
  IF NEW."envelope_bytes" IS NULL
     OR octet_length(NEW."envelope_bytes") NOT BETWEEN 1 AND 1048576 THEN
    RAISE EXCEPTION 'role DSSE envelope size is invalid'
      USING ERRCODE = '22023',
            CONSTRAINT = 'hr_role_attestation_envelope';
  END IF;

  NEW."role_subject_digest" := draft_row."role_subject_digest";
  NEW."subject_id" := draft_row."subject_id";
  NEW."subject_kind" := draft_row."subject_kind";
  NEW."environment_id" := draft_row."environment_id";
  NEW."environment_mode" := draft_row."environment_mode";
  NEW."environment_digest" := draft_row."environment_digest";
  NEW."scope_epoch_id" := draft_row."scope_epoch_id";
  NEW."venue_id" := draft_row."venue_id";
  NEW."space_id" := draft_row."space_id";
  NEW."role" := draft_row."role";
  NEW."actor_id" := draft_row."actor_id";
  NEW."bound_kind" := draft_row."bound_kind";
  NEW."bound_reference" := draft_row."bound_reference";
  NEW."bound_digest" := draft_row."bound_digest";
  NEW."key_policy_id" := draft_row."key_policy_id";
  NEW."signing_key_authority_id" := draft_row."signing_key_authority_id";
  NEW."key_policy_digest" := draft_row."key_policy_digest";
  NEW."key_id" := draft_row."key_id";
  NEW."public_key_fingerprint" := draft_row."public_key_fingerprint";
  NEW."payload_bytes" := draft_row."payload_bytes";
  NEW."payload_sha256" := draft_row."payload_sha256";
  NEW."payload_byte_length" := draft_row."payload_byte_length";
  NEW."envelope_byte_length" := octet_length(NEW."envelope_bytes");
  NEW."envelope_sha256" := 'sha256:' || encode(digest(
    convert_to(E'venviewer.historical-runtime-role-attestation.v1.dsse-envelope\n', 'UTF8')
      || NEW."envelope_bytes", 'sha256'
  ), 'hex');
  NEW."verifier_receipt_sha256" := 'sha256:' || encode(digest(
    convert_to(E'venviewer.historical-runtime-role-attestation.v1\n', 'UTF8')
      || NEW."payload_bytes", 'sha256'
  ), 'hex');
  NEW."signer_public_key_sha256" :=
    'sha256:' || draft_row."public_key_fingerprint";
  NEW."envelope_body" := convert_from(NEW."envelope_bytes", 'UTF8')::jsonb;
  NEW."effective_at" := draft_row."effective_at";
  NEW."expires_at" := draft_row."expires_at";
  NEW."verified_at" := action_at;
  NEW."created_at" := action_at;

  raw_evidence := jsonb_build_object(
    'envelopeByteLength', NEW."envelope_byte_length"::text,
    'envelopeSha256', NEW."envelope_sha256",
    'envelopeUtf8', convert_from(NEW."envelope_bytes", 'UTF8'),
    'payloadByteLength', NEW."payload_byte_length"::text,
    'payloadSha256', NEW."payload_sha256",
    'payloadType',
      'application/vnd.venviewer.historical-runtime-role-attestation.v1+json',
    'payloadUtf8', convert_from(NEW."payload_bytes", 'UTF8'),
    'receiptSha256', NEW."verifier_receipt_sha256",
    'signerPublicKeySha256', NEW."signer_public_key_sha256",
    'verifiedAt', "hr_iso_utc_ms"(action_at)
  );
  receipt_material := jsonb_build_object(
    'rawEvidence', raw_evidence,
    'statement', draft_row."statement_body",
    'subject', draft_row."subject_body"
  );
  NEW."attestation_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-role-attestation-receipt.v1\n'
      || "hr_stable_canonical_json"(receipt_material),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."attestation_body" := receipt_material || jsonb_build_object(
    'attestationDigest', NEW."attestation_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_require_role_verifier"
  BEFORE INSERT ON "hr_role_attestations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "b_hr_accept_role_attestation"
  BEFORE INSERT ON "hr_role_attestations"
  FOR EACH ROW EXECUTE FUNCTION "hr_accept_role_attestation"();

-- Rehydrate the complete capture source lineage at every authority boundary.
-- The aggregate/body guards prove immutable shape; this helper additionally
-- proves that every constituent receipt/capability and role remains current,
-- and that the operator's signed lineage decision is the exact selected set.
CREATE OR REPLACE FUNCTION "hr_assert_capture_source_current"(
  p_capture_root_id uuid,
  p_source_set_id uuid,
  p_normalization_id uuid,
  p_capture_operator_attestation_id uuid,
  p_source_custodian_attestation_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_scope_epoch_id uuid,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  wall_now timestamptz := GREATEST(p_action_at, "hr_wall_clock_ms"());
  source_row "hr_source_receipt_sets"%ROWTYPE;
  normalization_row "hr_normalized_content_identities"%ROWTYPE;
  operator_row "hr_role_attestations"%ROWTYPE;
  custodian_row "hr_role_attestations"%ROWTYPE;
  operator_evidence jsonb;
  custodian_evidence jsonb;
  role_id uuid;
  receipt_id uuid;
  minimum_receipt_expiry timestamptz;
  minimum_authority_expiry timestamptz;
BEGIN
  PERFORM "hr_assert_scope_current"(
    p_scope_epoch_id, p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  PERFORM "hr_lock_authority"('source-set', p_source_set_id::text);
  PERFORM "hr_lock_authority"('normalization', p_normalization_id::text);

  SELECT * INTO STRICT source_row
  FROM "hr_source_receipt_sets"
  WHERE "id" = p_source_set_id
  FOR SHARE;
  SELECT * INTO STRICT normalization_row
  FROM "hr_normalized_content_identities"
  WHERE "id" = p_normalization_id
  FOR SHARE;

  IF source_row."capture_subject_id" IS DISTINCT FROM p_capture_root_id
     OR source_row."capture_subject_kind" <> 'capture_import'
     OR source_row."environment_id" IS DISTINCT FROM p_environment_id
     OR source_row."environment_mode" IS DISTINCT FROM p_environment_mode
     OR source_row."environment_digest" IS DISTINCT FROM p_environment_digest
     OR source_row."scope_epoch_id" IS DISTINCT FROM p_scope_epoch_id
     OR source_row."venue_id" IS DISTINCT FROM p_venue_id
     OR source_row."space_id" IS DISTINCT FROM p_space_id
     OR normalization_row."capture_subject_id" IS DISTINCT FROM p_capture_root_id
     OR normalization_row."capture_subject_kind" <> 'capture_import'
     OR normalization_row."environment_id" IS DISTINCT FROM p_environment_id
     OR normalization_row."environment_mode" IS DISTINCT FROM p_environment_mode
     OR normalization_row."environment_digest" IS DISTINCT FROM p_environment_digest
     OR normalization_row."scope_epoch_id" IS DISTINCT FROM p_scope_epoch_id
     OR normalization_row."venue_id" IS DISTINCT FROM p_venue_id
     OR normalization_row."space_id" IS DISTINCT FROM p_space_id
     OR normalization_row."source_set_id" IS DISTINCT FROM source_row."id"
     OR normalization_row."source_receipt_set_digest" IS DISTINCT FROM
        source_row."receipt_set_digest"
     OR normalization_row."root_component_index" IS DISTINCT FROM
        source_row."root_component_index"
     OR normalization_row."source_member_count" IS DISTINCT FROM
        source_row."member_count"
     OR normalization_row."source_total_bytes" IS DISTINCT FROM
        source_row."total_bytes" THEN
    RAISE EXCEPTION 'capture source and normalization do not share one exact lineage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_source_lineage_exact';
  END IF;

  PERFORM "hr_assert_source_receipt_set_complete"(source_row."id");
  PERFORM "hr_assert_normalized_content_complete"(normalization_row."id");

  FOR role_id IN
    SELECT DISTINCT candidate.id FROM (VALUES
      (p_capture_operator_attestation_id),
      (p_source_custodian_attestation_id),
      (source_row."unavailable_attestation_id")
    ) AS candidate(id)
    WHERE candidate.id IS NOT NULL
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, p_environment_id, p_environment_mode, p_environment_digest,
      p_venue_id, p_space_id, wall_now
    );
  END LOOP;

  SELECT * INTO STRICT operator_row
  FROM "hr_role_attestations"
  WHERE "id" = p_capture_operator_attestation_id
  FOR SHARE;
  SELECT * INTO STRICT custodian_row
  FROM "hr_role_attestations"
  WHERE "id" = p_source_custodian_attestation_id
  FOR SHARE;
  operator_evidence := operator_row."attestation_body"->'subject'->'evidence';
  custodian_evidence := custodian_row."attestation_body"->'subject'->'evidence';

  IF operator_row."role" <> 'capture_operator'
     OR operator_row."subject_id" IS DISTINCT FROM p_capture_root_id
     OR operator_row."bound_kind" <> 'capture_lineage'
     OR operator_row."bound_reference" IS DISTINCT FROM p_capture_root_id::text
     OR custodian_row."role" <> 'source_custodian'
     OR custodian_row."subject_id" IS DISTINCT FROM p_capture_root_id
     OR custodian_row."bound_kind" <> 'source_receipt_set'
     OR custodian_row."bound_reference" IS DISTINCT FROM p_capture_root_id::text
     OR custodian_row."bound_digest" IS DISTINCT FROM
        source_row."receipt_set_digest"
     OR operator_evidence->>'lineageStartKind' IS DISTINCT FROM
        source_row."lineage_start_kind"
     OR operator_evidence->>'ancestorState' IS DISTINCT FROM
        source_row."ancestor_state"
     OR custodian_evidence->>'sourceReceiptSetDigest' IS DISTINCT FROM
        source_row."receipt_set_digest"
     OR (
       operator_evidence->>'captureClass' = 'venue_operator_direct_camera'
       AND (
         source_row."lineage_start_kind" <> 'direct_camera_capture_bundle'
         OR source_row."ancestor_state" <> 'exact_private_receipt'
       )
     )
     OR (
       operator_evidence->>'captureClass' = 'owner_authorized_existing_capture'
       AND source_row."lineage_start_kind" NOT IN (
         'raw_capture_object', 'processed_capture_package'
       )
     )
     OR operator_evidence->>'captureClass' NOT IN (
       'owner_authorized_existing_capture', 'venue_operator_direct_camera'
     )
     OR (
       source_row."ancestor_state" = 'owner_attested_unavailable_ancestor'
       AND (
         source_row."unavailable_attestation_id" IS DISTINCT FROM
           operator_row."id"
         OR source_row."unavailable_attestation_digest" IS DISTINCT FROM
           operator_row."attestation_digest"
       )
     ) THEN
    RAISE EXCEPTION 'capture operator/custodian evidence contradicts the selected source lineage'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_source_role_lineage';
  END IF;

  FOR receipt_id IN
    SELECT member."receipt_id"
    FROM "hr_source_receipt_members" AS member
    WHERE member."source_set_id" = source_row."id"
    ORDER BY member."receipt_id"
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, p_environment_id, p_environment_mode, p_environment_digest,
      p_venue_id, p_space_id, wall_now
    );
  END LOOP;
  SELECT min(member."receipt_expires_at")
  INTO STRICT minimum_receipt_expiry
  FROM "hr_source_receipt_members" AS member
  WHERE member."source_set_id" = source_row."id";

  minimum_authority_expiry := LEAST(
    minimum_receipt_expiry, operator_row."expires_at", custodian_row."expires_at",
    COALESCE(source_row."unavailable_expires_at", 'infinity'::timestamptz)
  );
  IF minimum_receipt_expiry IS NULL OR minimum_authority_expiry <= wall_now THEN
    RAISE EXCEPTION 'capture source authority is no longer current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_source_current';
  END IF;
  RETURN minimum_authority_expiry;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_prepare_capture_content_subject"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  source_authority_expires_at timestamptz;
  source_row "hr_source_receipt_sets"%ROWTYPE;
  normalization_row "hr_normalized_content_identities"%ROWTYPE;
  operator_row "hr_role_attestations"%ROWTYPE;
  custodian_row "hr_role_attestations"%ROWTYPE;
  subject_material jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  source_authority_expires_at := "hr_assert_capture_source_current"(
    NEW."capture_root_id", NEW."source_set_id", NEW."normalization_id",
    NEW."capture_operator_attestation_id",
    NEW."source_custodian_attestation_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."scope_epoch_id",
    NEW."venue_id", NEW."space_id", check_at
  );
  SELECT * INTO STRICT source_row
  FROM "hr_source_receipt_sets"
  WHERE "id" = NEW."source_set_id"
  FOR SHARE;
  SELECT * INTO STRICT normalization_row
  FROM "hr_normalized_content_identities"
  WHERE "id" = NEW."normalization_id"
  FOR SHARE;
  SELECT * INTO STRICT operator_row
  FROM "hr_role_attestations"
  WHERE "id" = NEW."capture_operator_attestation_id"
  FOR SHARE;
  SELECT * INTO STRICT custodian_row
  FROM "hr_role_attestations"
  WHERE "id" = NEW."source_custodian_attestation_id"
  FOR SHARE;

  action_at := "hr_db_clock_ms"();
  IF source_authority_expires_at <= action_at THEN
    RAISE EXCEPTION 'capture source authority expired while preparing its subject'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_source_current';
  END IF;
  NEW."subject_kind" := 'capture_import';
  NEW."created_at" := action_at;
  NEW."prepared_at" := action_at;
  NEW."source_receipt_set_digest" := source_row."receipt_set_digest";
  NEW."source_member_count" := source_row."member_count";
  NEW."source_total_bytes" := source_row."total_bytes";
  NEW."normalization_digest" := normalization_row."normalization_digest";
  NEW."normalized_sha256" := normalization_row."normalized_sha256";
  NEW."normalized_size_bytes" := normalization_row."normalized_size_bytes";
  NEW."capture_operator_attestation_digest" := operator_row."attestation_digest";
  NEW."capture_operator_bound_digest" := operator_row."bound_digest";
  NEW."capture_operator_actor_id" := operator_row."actor_id";
  NEW."capture_operator_expires_at" := operator_row."expires_at";
  NEW."source_custodian_attestation_digest" := custodian_row."attestation_digest";
  NEW."source_custodian_actor_id" := custodian_row."actor_id";
  NEW."source_custodian_expires_at" := custodian_row."expires_at";
  subject_material := jsonb_build_object(
    'captureRootId', NEW."capture_root_id"::text,
    'normalizedBy', NEW."normalized_by_actor_id"::text,
    'normalizedContentDigest', NEW."normalization_digest",
    'schemaVersion', 'historical-runtime-capture-content-subject.v1',
    'sourceReceiptSetDigest', NEW."source_receipt_set_digest",
    'sourceReceiptSetId', NEW."source_set_id"::text,
    'spaceId', NEW."space_id"::text,
    'tenantBoundary', 'venue_id_v1',
    'tenantId', NEW."venue_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."subject_body" := subject_material;
  NEW."capture_content_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-capture-content-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material),
    'UTF8'
  ), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_prepare_capture_content_subject"
  BEFORE INSERT ON "hr_capture_content_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_prepare_capture_content_subject"();

CREATE OR REPLACE FUNCTION "hr_issue_capture_content_draft"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  requested_expires_at timestamptz := date_trunc('milliseconds', NEW."expires_at");
  source_authority_expires_at timestamptz;
  subject_row "hr_capture_content_subjects"%ROWTYPE;
  normalizer_row "hr_role_attestations"%ROWTYPE;
  key_row "hr_signing_key_authorities"%ROWTYPE;
  predicate_body jsonb;
BEGIN
  SELECT * INTO STRICT subject_row
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = NEW."capture_root_id";
  PERFORM "hr_lock_scope"(
    subject_row."environment_id", subject_row."venue_id", subject_row."space_id"
  );
  SELECT * INTO STRICT subject_row
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = NEW."capture_root_id"
  FOR SHARE;
  PERFORM "hr_assert_scope_current"(
    subject_row."scope_epoch_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  source_authority_expires_at := "hr_assert_capture_source_current"(
    subject_row."capture_root_id", subject_row."source_set_id",
    subject_row."normalization_id",
    subject_row."capture_operator_attestation_id",
    subject_row."source_custodian_attestation_id",
    subject_row."environment_id", subject_row."environment_mode",
    subject_row."environment_digest", subject_row."scope_epoch_id",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    NEW."normalizer_attestation_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  SELECT * INTO STRICT normalizer_row
  FROM "hr_role_attestations"
  WHERE "id" = NEW."normalizer_attestation_id"
  FOR SHARE;
  IF normalizer_row."role" <> 'normalizer'
     OR normalizer_row."subject_id" IS DISTINCT FROM NEW."capture_root_id"
     OR normalizer_row."bound_digest" IS DISTINCT FROM
        subject_row."capture_content_subject_digest"
     OR normalizer_row."actor_id" IS DISTINCT FROM
        subject_row."normalized_by_actor_id" THEN
    RAISE EXCEPTION 'normalizer attestation does not bind capture subject'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_draft_normalizer';
  END IF;
  SELECT * INTO STRICT key_row
  FROM "hr_signing_key_authorities"
  WHERE "id" = NEW."signing_key_authority_id"
  FOR SHARE;
  PERFORM "hr_assert_signing_key_current"(
    key_row."id", subject_row."scope_epoch_id", subject_row."environment_id",
    subject_row."environment_mode", subject_row."environment_digest",
    subject_row."venue_id", subject_row."space_id",
    'historical_runtime_capture_content_identity', check_at
  );
  action_at := "hr_db_clock_ms"();
  IF requested_expires_at IS NULL OR requested_expires_at <= action_at THEN
    RAISE EXCEPTION 'capture content authority must have a future expiry'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_draft_expiry';
  END IF;

  NEW."subject_kind" := subject_row."subject_kind";
  NEW."environment_id" := subject_row."environment_id";
  NEW."environment_mode" := subject_row."environment_mode";
  NEW."environment_digest" := subject_row."environment_digest";
  NEW."scope_epoch_id" := subject_row."scope_epoch_id";
  NEW."venue_id" := subject_row."venue_id";
  NEW."space_id" := subject_row."space_id";
  NEW."source_set_id" := subject_row."source_set_id";
  NEW."source_receipt_set_digest" := subject_row."source_receipt_set_digest";
  NEW."normalization_id" := subject_row."normalization_id";
  NEW."normalization_digest" := subject_row."normalization_digest";
  NEW."normalized_sha256" := subject_row."normalized_sha256";
  NEW."normalized_size_bytes" := subject_row."normalized_size_bytes";
  NEW."capture_content_subject_digest" :=
    subject_row."capture_content_subject_digest";
  NEW."normalizer_attestation_digest" := normalizer_row."attestation_digest";
  NEW."normalizer_actor_id" := normalizer_row."actor_id";
  NEW."normalizer_expires_at" := normalizer_row."expires_at";
  NEW."key_policy_id" := key_row."key_policy_id";
  NEW."key_policy_purpose" := key_row."purpose";
  NEW."key_policy_digest" := key_row."key_policy_digest";
  NEW."key_id" := key_row."key_id";
  NEW."public_key_fingerprint" := key_row."public_key_fingerprint";
  NEW."key_effective_at" := key_row."policy_effective_at";
  NEW."key_expires_at" := key_row."expires_at";
  NEW."issued_at" := action_at;
  NEW."created_at" := action_at;
  NEW."expires_at" := LEAST(
    requested_expires_at, action_at + interval '365 days', key_row."expires_at",
    normalizer_row."expires_at", subject_row."capture_operator_expires_at",
    subject_row."source_custodian_expires_at", source_authority_expires_at
  );
  NEW."nonce" := gen_random_uuid();
  predicate_body := jsonb_build_object(
    'captureContentSubject', subject_row."subject_body",
    'captureContentSubjectDigest', subject_row."capture_content_subject_digest",
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'issuedAt', "hr_iso_utc_ms"(action_at),
    'keyId', NEW."key_id",
    'keyPolicyDigest', NEW."key_policy_digest",
    'keyPolicyId', NEW."key_policy_id"::text,
    'nonce', NEW."nonce"::text,
    'normalizerAttestationDigest', NEW."normalizer_attestation_digest",
    'normalizerAttestationId', NEW."normalizer_attestation_id"::text,
    'schemaVersion', 'historical-runtime-capture-content-identity.v1',
    'signerPublicKeySha256', 'sha256:' || NEW."public_key_fingerprint"
  );
  NEW."predicate_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-capture-content-identity-subject.v1\n'
      || "hr_stable_canonical_json"(predicate_body),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."statement_body" := jsonb_build_object(
    'authority', 'venue_evidence',
    'evidenceKind', 'historical_runtime_capture_content_identity',
    'predicate', predicate_body,
    'schemaVersion',
      'historical-runtime-capture-content-identity-statement.v1',
    'subjectDigest', NEW."predicate_digest",
    'subjectName', 'historical-runtime-capture-root/' ||
      NEW."capture_root_id"::text
  );
  NEW."payload_type" :=
    'application/vnd.venviewer.historical-runtime-capture-content-identity.v1+json';
  NEW."payload_bytes" := convert_to(
    "hr_stable_canonical_json"(NEW."statement_body"), 'UTF8'
  );
  NEW."payload_sha256" := encode(digest(NEW."payload_bytes", 'sha256'), 'hex');
  NEW."payload_byte_length" := octet_length(NEW."payload_bytes");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_issue_capture_content_draft"
  BEFORE INSERT ON "hr_capture_content_drafts"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_capture_content_draft"();

CREATE OR REPLACE FUNCTION "hr_accept_capture_root"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  source_authority_expires_at timestamptz;
  draft_row "hr_capture_content_drafts"%ROWTYPE;
  subject_row "hr_capture_content_subjects"%ROWTYPE;
  normalization_row "hr_normalized_content_identities"%ROWTYPE;
  operator_row "hr_role_attestations"%ROWTYPE;
  custodian_row "hr_role_attestations"%ROWTYPE;
  scope_row "hr_scope_epochs"%ROWTYPE;
  root_material jsonb;
BEGIN
  SELECT * INTO STRICT draft_row
  FROM "hr_capture_content_drafts"
  WHERE "capture_root_id" = NEW."capture_root_id";
  PERFORM "hr_lock_scope"(
    draft_row."environment_id", draft_row."venue_id", draft_row."space_id"
  );
  PERFORM "hr_lock_authority"('capture-root', NEW."capture_root_id"::text);
  SELECT * INTO STRICT draft_row
  FROM "hr_capture_content_drafts"
  WHERE "capture_root_id" = NEW."capture_root_id"
  FOR SHARE;
  PERFORM "hr_assert_scope_current"(
    draft_row."scope_epoch_id", draft_row."environment_id",
    draft_row."environment_mode", draft_row."environment_digest",
    draft_row."venue_id", draft_row."space_id", check_at
  );
  PERFORM "hr_assert_signing_key_current"(
    draft_row."signing_key_authority_id", draft_row."scope_epoch_id",
    draft_row."environment_id", draft_row."environment_mode",
    draft_row."environment_digest", draft_row."venue_id",
    draft_row."space_id", 'historical_runtime_capture_content_identity',
    check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    draft_row."normalizer_attestation_id", draft_row."environment_id",
    draft_row."environment_mode", draft_row."environment_digest",
    draft_row."venue_id", draft_row."space_id", check_at
  );
  SELECT * INTO STRICT subject_row
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = NEW."capture_root_id"
  FOR SHARE;
  source_authority_expires_at := "hr_assert_capture_source_current"(
    subject_row."capture_root_id", subject_row."source_set_id",
    subject_row."normalization_id",
    subject_row."capture_operator_attestation_id",
    subject_row."source_custodian_attestation_id",
    subject_row."environment_id", subject_row."environment_mode",
    subject_row."environment_digest", subject_row."scope_epoch_id",
    subject_row."venue_id", subject_row."space_id", check_at
  );
  SELECT * INTO STRICT normalization_row
  FROM "hr_normalized_content_identities"
  WHERE "id" = subject_row."normalization_id"
  FOR SHARE;
  SELECT * INTO STRICT operator_row
  FROM "hr_role_attestations"
  WHERE "id" = subject_row."capture_operator_attestation_id"
  FOR SHARE;
  SELECT * INTO STRICT custodian_row
  FROM "hr_role_attestations"
  WHERE "id" = subject_row."source_custodian_attestation_id"
  FOR SHARE;
  SELECT * INTO STRICT scope_row
  FROM "hr_scope_epochs"
  WHERE "id" = draft_row."scope_epoch_id"
  FOR SHARE;
  action_at := "hr_db_clock_ms"();
  IF draft_row."expires_at" <= action_at
     OR source_authority_expires_at <= action_at
     OR draft_row."expires_at" > source_authority_expires_at THEN
    RAISE EXCEPTION 'capture draft expired before signature verification'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_root_current';
  END IF;
  IF NEW."envelope_bytes" IS NULL
     OR octet_length(NEW."envelope_bytes") NOT BETWEEN 1 AND 1048576 THEN
    RAISE EXCEPTION 'capture DSSE envelope size is invalid'
      USING ERRCODE = '22023',
            CONSTRAINT = 'hr_capture_root_envelope';
  END IF;

  NEW."subject_kind" := draft_row."subject_kind";
  NEW."environment_id" := draft_row."environment_id";
  NEW."environment_mode" := draft_row."environment_mode";
  NEW."environment_digest" := draft_row."environment_digest";
  NEW."scope_epoch_id" := draft_row."scope_epoch_id";
  NEW."venue_id" := draft_row."venue_id";
  NEW."space_id" := draft_row."space_id";
  NEW."predicate_digest" := draft_row."predicate_digest";
  NEW."payload_sha256" := draft_row."payload_sha256";
  NEW."payload_bytes" := draft_row."payload_bytes";
  NEW."payload_byte_length" := draft_row."payload_byte_length";
  NEW."signing_key_authority_id" := draft_row."signing_key_authority_id";
  NEW."key_policy_id" := draft_row."key_policy_id";
  NEW."key_policy_digest" := draft_row."key_policy_digest";
  NEW."key_id" := draft_row."key_id";
  NEW."public_key_fingerprint" := draft_row."public_key_fingerprint";
  NEW."normalizer_attestation_id" := draft_row."normalizer_attestation_id";
  NEW."normalizer_attestation_digest" :=
    draft_row."normalizer_attestation_digest";
  NEW."normalizer_actor_id" := draft_row."normalizer_actor_id";
  NEW."normalizer_expires_at" := draft_row."normalizer_expires_at";
  NEW."envelope_byte_length" := octet_length(NEW."envelope_bytes");
  NEW."envelope_sha256" := 'sha256:' || encode(digest(
    convert_to(E'venviewer.historical-runtime-capture-content-identity.v1.dsse-envelope\n', 'UTF8')
      || NEW."envelope_bytes", 'sha256'
  ), 'hex');
  NEW."verifier_receipt_sha256" := 'sha256:' || encode(digest(
    convert_to(E'venviewer.historical-runtime-capture-content-identity.v1\n', 'UTF8')
      || NEW."payload_bytes", 'sha256'
  ), 'hex');
  NEW."signer_public_key_sha256" :=
    'sha256:' || draft_row."public_key_fingerprint";
  NEW."envelope_body" := convert_from(NEW."envelope_bytes", 'UTF8')::jsonb;
  NEW."verified_at" := action_at;
  NEW."created_at" := action_at;
  NEW."expires_at" := draft_row."expires_at";

  root_material := jsonb_build_object(
    'captureClass',
      operator_row."attestation_body"->'subject'->'evidence'->>'captureClass',
    'captureContentEnvelopeByteLength', NEW."envelope_byte_length"::text,
    'captureContentEnvelopeSha256', NEW."envelope_sha256",
    'captureContentEnvelopeUtf8', convert_from(NEW."envelope_bytes", 'UTF8'),
    'captureContentPayloadByteLength', NEW."payload_byte_length"::text,
    'captureContentPayloadSha256', NEW."payload_sha256",
    'captureContentPayloadUtf8', convert_from(NEW."payload_bytes", 'UTF8'),
    'captureContentPredicateDigest', NEW."predicate_digest",
    'captureContentReceiptSha256', NEW."verifier_receipt_sha256",
    'captureContentSignerPublicKeySha256', NEW."signer_public_key_sha256",
    'captureContentStatement', draft_row."statement_body",
    'captureContentSubjectDigest', subject_row."capture_content_subject_digest",
    'captureContentVerifiedAt', "hr_iso_utc_ms"(action_at),
    'captureOperatorAttestationDigest', operator_row."attestation_digest",
    'captureOperatorAttestationId', operator_row."id"::text,
    'captureRootId', NEW."capture_root_id"::text,
    'normalizedAt', "hr_iso_utc_ms"(normalization_row."created_at"),
    'normalizedBy', subject_row."normalized_by_actor_id"::text,
    'normalizedContentDigest', subject_row."normalization_digest",
    'normalizerAttestationDigest', NEW."normalizer_attestation_digest",
    'normalizerAttestationId', NEW."normalizer_attestation_id"::text,
    'schemaVersion', 'historical-runtime-capture-root-evidence.v1',
    'sourceCustodianAttestationDigest', custodian_row."attestation_digest",
    'sourceCustodianAttestationId', custodian_row."id"::text,
    'sourceReceiptSetDigest', subject_row."source_receipt_set_digest",
    'sourceReceiptSetId', subject_row."source_set_id"::text,
    'spaceId', NEW."space_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."capture_root_evidence_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-capture-root-evidence.v1\n'
      || "hr_stable_canonical_json"(root_material),
    'UTF8'
  ), 'sha256'), 'hex');
  NEW."capture_root_body" := root_material || jsonb_build_object(
    'captureRootEvidenceDigest', NEW."capture_root_evidence_digest"
  );

  INSERT INTO "hr_evidence_records" (
    "id", "record_kind", "subject_id", "subject_kind", "environment_id",
    "environment_mode", "environment_digest", "scope_epoch_id", "venue_id",
    "space_id", "scope_epoch", "scope_epoch_digest",
    "scope_epoch_expires_at", "record_digest", "effective_at", "expires_at",
    "created_at"
  ) VALUES (
    NEW."capture_root_id", 'capture_root', NEW."capture_root_id",
    NEW."subject_kind", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."scope_epoch_id", NEW."venue_id",
    NEW."space_id", scope_row."epoch", scope_row."epoch_digest",
    scope_row."expires_at", NEW."capture_root_evidence_digest", action_at,
    NEW."expires_at", action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "a_hr_require_capture_root_verifier"
  BEFORE INSERT ON "hr_capture_roots"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "b_hr_accept_capture_root"
  BEFORE INSERT ON "hr_capture_roots"
  FOR EACH ROW EXECUTE FUNCTION "hr_accept_capture_root"();


CREATE OR REPLACE FUNCTION "hr_issue_evidence_environment"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_at timestamptz;
  live_actor record;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_authority"('environment', 'singleton');
  IF EXISTS (SELECT 1 FROM "hr_evidence_environments") THEN
    RAISE EXCEPTION 'historical-runtime evidence environment already exists'
      USING ERRCODE = '23505',
            CONSTRAINT = 'hr_evidence_environment_singleton';
  END IF;
  SELECT "platform_role", "clerk_id" INTO STRICT live_actor
  FROM "users"
  WHERE "id" = NEW."configured_by"
  FOR SHARE;
  IF live_actor."platform_role" <> 'admin'
     OR (NEW."mode" = 'production' AND live_actor."clerk_id" IS NULL) THEN
    RAISE EXCEPTION 'evidence environment requires a current platform admin'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_evidence_environment_registrar';
  END IF;
  action_at := "hr_db_clock_ms"();
  NEW."created_at" := action_at;
  material_body := jsonb_build_object(
    'configuredAt', "hr_iso_utc_ms"(action_at),
    'configuredBy', NEW."configured_by"::text,
    'environmentId', NEW."id"::text,
    'mode', NEW."mode",
    'schemaVersion', 'historical-runtime-evidence-environment.v1'
  );
  NEW."environment_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-evidence-environment.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."environment_body" := material_body || jsonb_build_object(
    'environmentDigest', NEW."environment_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_evidence_environment"
  BEFORE INSERT ON "hr_evidence_environments"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_evidence_environment"();

CREATE OR REPLACE FUNCTION "hr_issue_scope_epoch"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_at timestamptz;
  environment_row "hr_evidence_environments"%ROWTYPE;
  live_actor record;
  next_epoch bigint;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  SELECT * INTO STRICT environment_row
  FROM "hr_evidence_environments"
  WHERE "id" = NEW."environment_id"
  FOR SHARE;
  SELECT "platform_role", "clerk_id" INTO STRICT live_actor
  FROM "users"
  WHERE "id" = NEW."issued_by"
  FOR SHARE;
  IF live_actor."platform_role" <> 'admin'
     OR (environment_row."mode" = 'production'
       AND live_actor."clerk_id" IS NULL) THEN
    RAISE EXCEPTION 'scope epoch requires a current platform admin'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_scope_epoch_registrar';
  END IF;
  SELECT COALESCE(max(existing."epoch"), 0) + 1 INTO next_epoch
  FROM "hr_scope_epochs" AS existing
  WHERE existing."environment_id" = NEW."environment_id"
    AND existing."venue_id" = NEW."venue_id"
    AND existing."space_id" = NEW."space_id";
  action_at := "hr_db_clock_ms"();
  NEW."environment_mode" := environment_row."mode";
  NEW."environment_digest" := environment_row."environment_digest";
  NEW."epoch" := next_epoch;
  NEW."created_at" := action_at;
  NEW."effective_at" := action_at;
  NEW."expires_at" := action_at + interval '365 days';
  material_body := jsonb_build_object(
    'effectiveAt', "hr_iso_utc_ms"(action_at),
    'environmentDigest', NEW."environment_digest",
    'environmentId', NEW."environment_id"::text,
    'environmentMode', NEW."environment_mode",
    'epoch', NEW."epoch",
    'epochId', NEW."id"::text,
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'issuedBy', NEW."issued_by"::text,
    'schemaVersion', 'historical-runtime-scope-epoch.v1',
    'spaceId', NEW."space_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."epoch_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-scope-epoch.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."epoch_body" := material_body || jsonb_build_object(
    'epochDigest', NEW."epoch_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_scope_epoch"
  BEFORE INSERT ON "hr_scope_epochs"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_scope_epoch"();

-- Reserve a scoped immutable subject before any purpose-specific role
-- attestation refers to it. This is intentionally a verifier-only boundary:
-- neither the request API nor a caller-supplied scope copy can mint subjects.
CREATE OR REPLACE FUNCTION "hr_issue_evidence_subject"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  scope_row "hr_scope_epochs"%ROWTYPE;
  action_at timestamptz;
BEGIN
  SELECT * INTO STRICT scope_row
  FROM "hr_scope_epochs"
  WHERE "id" = NEW."scope_epoch_id";
  PERFORM "hr_lock_scope"(
    scope_row."environment_id", scope_row."venue_id", scope_row."space_id"
  );
  SELECT * INTO STRICT scope_row
  FROM "hr_scope_epochs"
  WHERE "id" = NEW."scope_epoch_id"
  FOR SHARE;
  PERFORM "hr_assert_scope_current"(
    scope_row."id", scope_row."environment_id", scope_row."environment_mode",
    scope_row."environment_digest", scope_row."venue_id", scope_row."space_id",
    "hr_wall_clock_ms"()
  );
  action_at := "hr_db_clock_ms"();
  NEW."environment_id" := scope_row."environment_id";
  NEW."environment_mode" := scope_row."environment_mode";
  NEW."environment_digest" := scope_row."environment_digest";
  NEW."venue_id" := scope_row."venue_id";
  NEW."space_id" := scope_row."space_id";
  NEW."scope_epoch" := scope_row."epoch";
  NEW."scope_epoch_digest" := scope_row."epoch_digest";
  NEW."scope_epoch_expires_at" := scope_row."expires_at";
  NEW."created_at" := action_at;
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'historical-runtime evidence subject scope does not exist'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_evidence_subject_scope';
END;
$$;

CREATE TRIGGER "b_hr_issue_evidence_subject"
  BEFORE INSERT ON "hr_evidence_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_evidence_subject"();

CREATE OR REPLACE FUNCTION "hr_issue_provider_capability"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  live_actor record;
  material_body jsonb;
BEGIN
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_actor
  FROM "users"
  WHERE "id" = NEW."verified_by"
  FOR SHARE;
  IF (NEW."environment_mode" = 'production' AND live_actor."clerk_id" IS NULL)
     OR NOT (
       live_actor."platform_role" IN ('operator', 'admin')
       OR (live_actor."venue_id" = NEW."venue_id"
         AND live_actor."role" IN ('admin', 'staff', 'hallkeeper'))
     ) THEN
    RAISE EXCEPTION 'provider capability verifier lacks current authority'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_provider_capability_verifier_authority';
  END IF;
  IF NEW."anonymous_head_status_code" IS DISTINCT FROM
       NEW."anonymous_get_status_code"
     OR NEW."anonymous_head_request_digest" IS NOT DISTINCT FROM
       NEW."anonymous_get_request_digest" THEN
    RAISE EXCEPTION 'provider HEAD and safe-range GET probes differ'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_provider_capability_head_get_parity';
  END IF;
  action_at := "hr_db_clock_ms"();
  NEW."created_at" := action_at;
  NEW."verified_at" := action_at;
  NEW."exact_version_read_supported" := true;
  NEW."overwrite_preserves_prior_version" := true;
  NEW."anonymous_probe_supported" := true;
  NEW."anonymous_head_redirect_count" := 0;
  NEW."anonymous_get_redirect_count" := 0;
  NEW."expires_at" := LEAST(
    action_at + interval '30 days', NEW."scope_epoch_expires_at"
  );
  material_body := jsonb_build_object(
    'anonymousAccessProbeEquivalence', jsonb_build_object(
      'denialClass', NEW."anonymous_denial_class",
      'getRedirectCount', 0,
      'getRangeHeader', 'bytes=0-0',
      'getRequestMethod', 'GET',
      'getRequestDigest', NEW."anonymous_get_request_digest",
      'getResponseDigest', NEW."anonymous_get_response_digest",
      'getStatusCode', NEW."anonymous_get_status_code",
      'headRedirectCount', 0,
      'headRequestMethod', 'HEAD',
      'headRequestDigest', NEW."anonymous_head_request_digest",
      'headResponseDigest', NEW."anonymous_head_response_digest",
      'headStatusCode', NEW."anonymous_head_status_code"
    ),
    'anonymousProbeSupported', true,
    'capabilityReceiptId', NEW."id"::text,
    'endpointAuthoritySha256', NEW."endpoint_authority_sha256",
    'exactVersionReadSupported', true,
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'initialReadDigest', NEW."initial_read_digest",
    'initialWriteDigest', NEW."initial_write_digest",
    'overwriteDigest', NEW."overwrite_digest",
    'overwritePreservesPriorVersion', true,
    'priorVersionRereadDigest', NEW."prior_version_reread_digest",
    'privateBucketSha256', NEW."private_bucket_sha256",
    'providerAccountSha256', NEW."provider_account_sha256",
    'providerKind', NEW."provider_kind",
    'providerProfile', NEW."provider_profile",
    'schemaVersion', 'historical-runtime-provider-capability.v2',
    'testObjectStorageKeySha256', NEW."test_object_storage_key_sha256",
    'verificationMode', NEW."verification_mode",
    'verifiedAt', "hr_iso_utc_ms"(action_at),
    'verifiedBy', NEW."verified_by"::text,
    'versionKind', NEW."version_kind"
  );
  NEW."capability_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-provider-capability.v2\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."capability_body" := material_body || jsonb_build_object(
    'capabilityDigest', NEW."capability_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_provider_capability"
  BEFORE INSERT ON "hr_provider_capabilities"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_provider_capability"();

CREATE OR REPLACE FUNCTION "hr_build_object_actor_authority"(
  p_actor_id uuid,
  p_membership_id uuid,
  p_authority_role text,
  p_environment_id uuid,
  p_environment_mode text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  live_user record;
  live_membership record;
  live_workspace record;
  membership_body jsonb;
  membership_digest text;
  material_body jsonb;
  authority_digest text;
BEGIN
  IF p_authority_role NOT IN (
    'object_custodian', 'object_observer', 'anonymous_denial_prober'
  ) THEN
    RAISE EXCEPTION 'unsupported object-receipt actor authority role'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_object_actor_authority_role';
  END IF;
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_user
  FROM public."users"
  WHERE "id" = p_actor_id;
  IF p_environment_mode = 'production' AND live_user."clerk_id" IS NULL THEN
    RAISE EXCEPTION 'production object-receipt actor lacks Clerk identity'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_object_actor_authority_current';
  END IF;

  IF live_user."platform_role" IN ('operator', 'admin') THEN
    IF p_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'platform object-receipt actor must not claim membership'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_object_actor_authority_membership';
    END IF;
    membership_body := jsonb_build_object(
      'reason', 'platform_authority',
      'state', 'not_applicable'
    );
  ELSE
    IF p_membership_id IS NULL OR live_user."venue_id" IS DISTINCT FROM p_venue_id
       OR live_user."role" NOT IN ('planner', 'staff', 'hallkeeper', 'admin')
    THEN
      RAISE EXCEPTION 'object-receipt actor is outside the receipt venue'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_object_actor_authority_tenant';
    END IF;
    SELECT "user_id", "workspace_id", "role", "venue_role", "status",
      date_trunc('milliseconds', "updated_at") AS updated_at
    INTO STRICT live_membership
    FROM public."workspace_memberships"
    WHERE "id" = p_membership_id;
    SELECT "primary_venue_id", "status", "deleted_at"
    INTO STRICT live_workspace
    FROM public."workspaces"
    WHERE "id" = live_membership."workspace_id";
    IF live_membership."user_id" IS DISTINCT FROM p_actor_id
       OR live_membership."status" <> 'active'
       OR live_workspace."primary_venue_id" IS DISTINCT FROM p_venue_id
       OR live_workspace."status" <> 'active'
       OR live_workspace."deleted_at" IS NOT NULL
       OR NOT (
         live_membership."role" IN ('owner', 'admin', 'staff', 'hallkeeper')
         OR live_membership."venue_role" = 'hallkeeper'
       ) THEN
      RAISE EXCEPTION 'object-receipt actor membership is not current in venue'
        USING ERRCODE = '42501',
              CONSTRAINT = 'hr_object_actor_authority_membership';
    END IF;
    membership_body := jsonb_build_object(
      'membershipId', p_membership_id::text,
      'membershipStatus', 'active',
      'membershipUpdatedAt', "hr_iso_utc_ms"(live_membership.updated_at),
      'userId', p_actor_id::text,
      'venueRole', live_membership."venue_role",
      'workspaceId', live_membership."workspace_id"::text,
      'workspaceRole', live_membership."role"
    );
    membership_digest := encode(digest(convert_to(
      E'venviewer.historical-runtime-membership-version.v1\n'
        || "hr_stable_canonical_json"(membership_body), 'UTF8'
    ), 'sha256'), 'hex');
    membership_body := membership_body || jsonb_build_object(
      'membershipVersionDigest', membership_digest,
      'state', 'active'
    );
  END IF;

  material_body := jsonb_build_object(
    'actorId', p_actor_id::text,
    'authorityRole', p_authority_role,
    'environmentId', p_environment_id::text,
    'environmentMode', p_environment_mode,
    'platformRole', live_user."platform_role",
    'schemaVersion', 'historical-runtime-object-actor-authority.v1',
    'snapshottedAt', "hr_iso_utc_ms"(p_action_at),
    'spaceId', p_space_id::text,
    'userRole', live_user."role",
    'userVenueId', CASE WHEN live_user."venue_id" IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(live_user."venue_id"::text) END,
    'venueId', p_venue_id::text,
    'workspaceMembership', membership_body
  );
  authority_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-object-actor-authority.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  RETURN material_body || jsonb_build_object(
    'authorityDigest', authority_digest
  );
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'object-receipt actor or membership is missing'
      USING ERRCODE = '23503',
            CONSTRAINT = 'hr_object_actor_authority_identity';
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_object_receipt"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  capability_scope record;
  capability "hr_provider_capabilities"%ROWTYPE;
  membership_ids uuid[];
  workspace_ids uuid[];
  object_body jsonb;
  denial_body jsonb;
  material_body jsonb;
BEGIN
  -- Resolve only the immutable scope identity first. The protected scope row lock
  -- must precede the provider-capability lock on every currentness path.
  SELECT "scope_epoch_id", "environment_id", "environment_mode",
         "environment_digest", "venue_id", "space_id"
  INTO STRICT capability_scope
  FROM "hr_provider_capabilities"
  WHERE "id" = NEW."capability_id";
  PERFORM "hr_assert_scope_current"(
    capability_scope."scope_epoch_id", capability_scope."environment_id",
    capability_scope."environment_mode", capability_scope."environment_digest",
    capability_scope."venue_id", capability_scope."space_id", check_at
  );
  PERFORM "hr_lock_authority"(
    'provider-capability', NEW."capability_id"::text
  );
  -- Re-read under the canonical lock so a concurrent revocation cannot land
  -- between the capability observation and the immutable receipt insertion.
  SELECT * INTO STRICT capability
  FROM "hr_provider_capabilities"
  WHERE "id" = NEW."capability_id"
  FOR SHARE;
  check_at := "hr_wall_clock_ms"();
  IF capability."expires_at" <= check_at OR EXISTS (
    SELECT 1 FROM "hr_provider_capability_revocations" AS revoked
    WHERE revoked."capability_id" = capability."id"
  ) THEN
    RAISE EXCEPTION 'object receipt provider capability is not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_object_receipt_capability_current';
  END IF;
  IF NEW."custodian_actor_id" = NEW."observed_by_actor_id"
     OR NEW."custodian_actor_id" = NEW."denial_probed_by"
     OR NEW."observed_by_actor_id" = NEW."denial_probed_by" THEN
    RAISE EXCEPTION 'object receipt requires three independent actors'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_object_receipt_actor_separation';
  END IF;
  IF NEW."denial_get_status_code" IS DISTINCT FROM NEW."denial_status_code"
     OR NEW."denial_get_class" IS DISTINCT FROM NEW."denial_class"
     OR NEW."denial_get_request_digest" IS NOT DISTINCT FROM
        NEW."denial_request_digest" THEN
    RAISE EXCEPTION 'exact-object HEAD and safe-range GET denial probes differ'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_object_receipt_head_get_parity';
  END IF;
  -- Lock all live actor identities and any claimed workspace authority in a
  -- deterministic order before sampling the canonical observation instant.
  PERFORM 1
  FROM public."users"
  WHERE "id" = ANY (ARRAY[
    NEW."custodian_actor_id", NEW."observed_by_actor_id",
    NEW."denial_probed_by"
  ]::uuid[])
  ORDER BY "id"
  FOR SHARE;
  membership_ids := array_remove(ARRAY[
    NEW."custodian_membership_id", NEW."observed_by_membership_id",
    NEW."denial_prober_membership_id"
  ]::uuid[], NULL);
  IF cardinality(membership_ids) > 0 THEN
    SELECT array_agg(DISTINCT "workspace_id" ORDER BY "workspace_id")
    INTO workspace_ids
    FROM public."workspace_memberships"
    WHERE "id" = ANY (membership_ids);
    PERFORM 1
    FROM public."workspaces"
    WHERE "id" = ANY (workspace_ids)
    ORDER BY "id"
    FOR SHARE;
    PERFORM 1
    FROM public."workspace_memberships"
    WHERE "id" = ANY (membership_ids)
    ORDER BY "id"
    FOR SHARE;
  END IF;
  action_at := "hr_db_clock_ms"();
  NEW."environment_id" := capability."environment_id";
  NEW."environment_mode" := capability."environment_mode";
  NEW."environment_digest" := capability."environment_digest";
  NEW."venue_id" := capability."venue_id";
  NEW."space_id" := capability."space_id";
  NEW."capability_digest" := capability."capability_digest";
  NEW."capability_expires_at" := capability."expires_at";
  NEW."provider_profile" := capability."provider_profile";
  NEW."provider_kind" := capability."provider_kind";
  NEW."version_kind" := capability."version_kind";
  NEW."provider_account_sha256" := capability."provider_account_sha256";
  NEW."endpoint_authority_sha256" := capability."endpoint_authority_sha256";
  NEW."private_bucket_sha256" := capability."private_bucket_sha256";
  NEW."created_at" := action_at;
  NEW."denial_probed_at" := action_at;
  NEW."read_at" := date_trunc('milliseconds', NEW."read_at");
  NEW."denial_request_method" := 'HEAD';
  NEW."denial_redirect_count" := 0;
  NEW."denial_get_request_method" := 'GET';
  NEW."denial_get_range_header" := 'bytes=0-0';
  NEW."denial_get_redirect_count" := 0;
  NEW."denial_expires_at" := LEAST(
    action_at + interval '24 hours', capability."expires_at"
  );
  NEW."custodian_authority_body" := "hr_build_object_actor_authority"(
    NEW."custodian_actor_id", NEW."custodian_membership_id",
    'object_custodian', NEW."environment_id", NEW."environment_mode",
    NEW."venue_id", NEW."space_id", action_at
  );
  NEW."custodian_authority_digest" :=
    NEW."custodian_authority_body"->>'authorityDigest';
  NEW."observed_by_authority_body" := "hr_build_object_actor_authority"(
    NEW."observed_by_actor_id", NEW."observed_by_membership_id",
    'object_observer', NEW."environment_id", NEW."environment_mode",
    NEW."venue_id", NEW."space_id", action_at
  );
  NEW."observed_by_authority_digest" :=
    NEW."observed_by_authority_body"->>'authorityDigest';
  NEW."denial_prober_authority_body" := "hr_build_object_actor_authority"(
    NEW."denial_probed_by", NEW."denial_prober_membership_id",
    'anonymous_denial_prober', NEW."environment_id", NEW."environment_mode",
    NEW."venue_id", NEW."space_id", action_at
  );
  NEW."denial_prober_authority_digest" :=
    NEW."denial_prober_authority_body"->>'authorityDigest';
  object_body := jsonb_build_object(
    'endpointAuthoritySha256', NEW."endpoint_authority_sha256",
    'fileName', NEW."file_name",
    'immutabilityCapabilityDigest', NEW."capability_digest",
    'immutabilityCapabilityReceiptId', NEW."capability_id"::text,
    'mimeType', NEW."mime_type",
    'privateBucketSha256', NEW."private_bucket_sha256",
    'providerAccountSha256', NEW."provider_account_sha256",
    'providerKind', NEW."provider_kind",
    'providerProfile', NEW."provider_profile",
    'sha256', NEW."sha256",
    'sizeBytes', NEW."size_bytes",
    'storageEtag', NEW."storage_etag",
    'storageKeySha256', NEW."storage_key_sha256",
    'storageVersion', NEW."storage_version",
    'versionKind', NEW."version_kind"
  );
  denial_body := jsonb_build_object(
    'authenticatedReadRequestDigest',
      NEW."authenticated_read_request_digest",
    'denialClass', NEW."denial_class",
    'endpointAuthoritySha256', NEW."endpoint_authority_sha256",
    'expiresAt', "hr_iso_utc_ms"(NEW."denial_expires_at"),
    'immutabilityCapabilityDigest', NEW."capability_digest",
    'immutabilityCapabilityReceiptId', NEW."capability_id"::text,
    'privateBucketSha256', NEW."private_bucket_sha256",
    'probedAt', "hr_iso_utc_ms"(action_at),
    'probedBy', NEW."denial_probed_by"::text,
    'proberAuthority', NEW."denial_prober_authority_body",
    'providerAccountSha256', NEW."provider_account_sha256",
    'providerKind', NEW."provider_kind",
    'providerProfile', NEW."provider_profile",
    'redirectCount', 0,
    'requestDigest', NEW."denial_request_digest",
    'requestMethod', 'HEAD',
    'responseDigest', NEW."denial_response_digest",
    'safeRangeGet', jsonb_build_object(
      'denialClass', NEW."denial_get_class",
      'rangeHeader', 'bytes=0-0',
      'redirectCount', 0,
      'requestDigest', NEW."denial_get_request_digest",
      'requestMethod', 'GET',
      'responseDigest', NEW."denial_get_response_digest",
      'statusCode', NEW."denial_get_status_code"
    ),
    'schemaVersion', 'historical-runtime-anonymous-access-denial.v2',
    'statusCode', NEW."denial_status_code",
    'storageKeySha256', NEW."storage_key_sha256",
    'storageVersion', NEW."storage_version",
    'versionKind', NEW."version_kind"
  );
  material_body := jsonb_build_object(
    'anonymousAccessDenial', denial_body,
    'authenticatedReadRequestDigest',
      NEW."authenticated_read_request_digest",
    'authenticatedReadResponseDigest',
      NEW."authenticated_read_response_digest",
    'custodianActorId', NEW."custodian_actor_id"::text,
    'custodianAuthority', NEW."custodian_authority_body",
    'object', object_body,
    'observedByActorId', NEW."observed_by_actor_id"::text,
    'observedByAuthority', NEW."observed_by_authority_body",
    'readAt', "hr_iso_utc_ms"(NEW."read_at"),
    'receiptId', NEW."id"::text,
    'schemaVersion', 'historical-runtime-exact-object-receipt.v2'
  );
  NEW."receipt_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-exact-object-receipt.v2\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."receipt_body" := material_body || jsonb_build_object(
    'receiptDigest', NEW."receipt_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_object_receipt"
  BEFORE INSERT ON "hr_object_receipts"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_object_receipt"();

CREATE OR REPLACE FUNCTION "hr_issue_signing_key_authority"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  live_actor record;
  registrar_material jsonb;
BEGIN
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_lock_authority"('key-policy', NEW."key_policy_id"::text);
  PERFORM "hr_lock_authority"('key-authority', NEW."id"::text);
  IF EXISTS (
    SELECT 1 FROM "runtime_execution_key_policy_revocations" AS revoked
    WHERE revoked."policy_id" = NEW."key_policy_id"
  ) THEN
    RAISE EXCEPTION 'cannot register a revoked signing-key policy'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_signing_key_policy_current';
  END IF;
  SELECT "role", "platform_role", "venue_id", "clerk_id"
  INTO STRICT live_actor
  FROM "users"
  WHERE "id" = NEW."verified_by"
  FOR SHARE;
  IF live_actor."platform_role" <> 'admin'
     OR (NEW."environment_mode" = 'production' AND live_actor."clerk_id" IS NULL)
  THEN
    RAISE EXCEPTION 'signing-key registrar must be a current platform admin'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_signing_key_registrar_authority';
  END IF;
  action_at := "hr_db_clock_ms"();
  NEW."created_at" := action_at;
  NEW."verified_at" := action_at;
  NEW."expires_at" := LEAST(
    NEW."policy_expires_at", NEW."scope_epoch_expires_at"
  );
  registrar_material := jsonb_build_object(
    'actorId', NEW."verified_by"::text,
    'authenticationSource', CASE
      WHEN NEW."environment_mode" = 'production' THEN 'clerk_session'
      ELSE 'local_test_fixture'
    END,
    'platformRole', live_actor."platform_role",
    'registeredAt', "hr_iso_utc_ms"(action_at),
    'schemaVersion', 'historical-runtime-signing-key-registrar.v1',
    'userRole', live_actor."role",
    'venueId', NEW."venue_id"::text
  );
  NEW."registrar_authority_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-signing-key-registrar.v1\n'
      || "hr_stable_canonical_json"(registrar_material), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."registrar_authority_body" := registrar_material || jsonb_build_object(
    'authorityDigest', NEW."registrar_authority_digest"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_signing_key_authority"
  BEFORE INSERT ON "hr_signing_key_authorities"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_signing_key_authority"();

CREATE OR REPLACE FUNCTION "hr_assert_capture_root_current"(
  p_capture_root_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  wall_now timestamptz := GREATEST(p_action_at, "hr_wall_clock_ms"());
  root_row "hr_capture_roots"%ROWTYPE;
  draft_row "hr_capture_content_drafts"%ROWTYPE;
  subject_row "hr_capture_content_subjects"%ROWTYPE;
  source_authority_expires_at timestamptz;
BEGIN
  PERFORM "hr_assert_evidence_record_current"(
    p_capture_root_id, 'capture_root', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  SELECT * INTO STRICT root_row
  FROM "hr_capture_roots"
  WHERE "capture_root_id" = p_capture_root_id
  FOR SHARE;
  SELECT * INTO STRICT draft_row
  FROM "hr_capture_content_drafts"
  WHERE "capture_root_id" = p_capture_root_id
  FOR SHARE;
  SELECT * INTO STRICT subject_row
  FROM "hr_capture_content_subjects"
  WHERE "capture_root_id" = p_capture_root_id
  FOR SHARE;

  IF root_row."environment_id" IS DISTINCT FROM p_environment_id
     OR root_row."environment_mode" IS DISTINCT FROM p_environment_mode
     OR root_row."environment_digest" IS DISTINCT FROM p_environment_digest
     OR root_row."venue_id" IS DISTINCT FROM p_venue_id
     OR root_row."space_id" IS DISTINCT FROM p_space_id
     OR draft_row."scope_epoch_id" IS DISTINCT FROM root_row."scope_epoch_id"
     OR draft_row."capture_root_id" IS DISTINCT FROM root_row."capture_root_id"
     OR subject_row."scope_epoch_id" IS DISTINCT FROM root_row."scope_epoch_id"
     OR subject_row."capture_content_subject_digest" IS DISTINCT FROM
        draft_row."capture_content_subject_digest" THEN
    RAISE EXCEPTION 'capture root does not bind one exact subject and draft'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_root_exact_chain';
  END IF;

  source_authority_expires_at := "hr_assert_capture_source_current"(
    subject_row."capture_root_id", subject_row."source_set_id",
    subject_row."normalization_id",
    subject_row."capture_operator_attestation_id",
    subject_row."source_custodian_attestation_id",
    subject_row."environment_id", subject_row."environment_mode",
    subject_row."environment_digest", subject_row."scope_epoch_id",
    subject_row."venue_id", subject_row."space_id", wall_now
  );
  PERFORM "hr_assert_role_attestation_current"(
    draft_row."normalizer_attestation_id", p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  PERFORM "hr_assert_signing_key_current"(
    draft_row."signing_key_authority_id", draft_row."scope_epoch_id",
    p_environment_id, p_environment_mode, p_environment_digest,
    p_venue_id, p_space_id,
    'historical_runtime_capture_content_identity', wall_now
  );
  wall_now := GREATEST(wall_now, "hr_wall_clock_ms"());
  IF root_row."expires_at" <= wall_now
     OR root_row."expires_at" > source_authority_expires_at THEN
    RAISE EXCEPTION 'capture root constituents are not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_root_current';
  END IF;
  RETURN root_row."expires_at";
END;
$$;

CREATE OR REPLACE FUNCTION "hr_assert_capture_clearance_current"(
  p_capture_clearance_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  wall_now timestamptz := GREATEST(p_action_at, "hr_wall_clock_ms"());
  clearance_row "hr_capture_clearances"%ROWTYPE;
  root_expires_at timestamptz;
  role_id uuid;
BEGIN
  SELECT * INTO STRICT clearance_row
  FROM "hr_capture_clearances"
  WHERE "id" = p_capture_clearance_id;
  root_expires_at := "hr_assert_capture_root_current"(
    clearance_row."capture_root_id", p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  PERFORM "hr_assert_evidence_record_current"(
    p_capture_clearance_id, 'capture_clearance', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  SELECT * INTO STRICT clearance_row
  FROM "hr_capture_clearances"
  WHERE "id" = p_capture_clearance_id
  FOR SHARE;
  IF clearance_row."environment_id" IS DISTINCT FROM p_environment_id
     OR clearance_row."environment_mode" IS DISTINCT FROM p_environment_mode
     OR clearance_row."environment_digest" IS DISTINCT FROM p_environment_digest
     OR clearance_row."venue_id" IS DISTINCT FROM p_venue_id
     OR clearance_row."space_id" IS DISTINCT FROM p_space_id THEN
    RAISE EXCEPTION 'capture clearance is outside the requested evidence scope'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_clearance_exact_scope';
  END IF;
  FOR role_id IN
    SELECT candidate.id FROM (VALUES
      (clearance_row."owner_attestation_id"),
      (clearance_row."privacy_attestation_id"),
      (clearance_row."movable_attestation_id"),
      (clearance_row."final_attestation_id")
    ) AS candidate(id)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, p_environment_id, p_environment_mode, p_environment_digest,
      p_venue_id, p_space_id, wall_now
    );
  END LOOP;
  wall_now := GREATEST(wall_now, "hr_wall_clock_ms"());
  IF clearance_row."effective_at" > wall_now
     OR clearance_row."expires_at" <= wall_now
     OR clearance_row."expires_at" > root_expires_at THEN
    RAISE EXCEPTION 'capture clearance constituents are not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_clearance_current';
  END IF;
  RETURN clearance_row."expires_at";
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_capture_clearance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  root_expires_at timestamptz;
  role_id uuid;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  root_expires_at := "hr_assert_capture_root_current"(
    NEW."capture_root_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR role_id IN
    SELECT candidate.id FROM (VALUES
      (NEW."owner_attestation_id"), (NEW."privacy_attestation_id"),
      (NEW."movable_attestation_id"), (NEW."final_attestation_id")
    ) AS candidate(id) ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  action_at := "hr_db_clock_ms"();
  IF NEW."capture_root_expires_at" IS DISTINCT FROM root_expires_at THEN
    RAISE EXCEPTION 'capture clearance does not bind the current root expiry'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_capture_clearance_root_current';
  END IF;
  NEW."subject_id" := NEW."capture_root_id";
  NEW."subject_kind" := 'capture_import';
  NEW."created_at" := action_at;
  NEW."effective_at" := action_at;
  NEW."expires_at" := LEAST(
    NEW."capture_root_expires_at", NEW."owner_expires_at",
    NEW."privacy_expires_at", NEW."movable_expires_at", NEW."final_expires_at"
  );
  IF NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'capture clearance authority is already expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_capture_clearance_current';
  END IF;
  material_body := jsonb_build_object(
    'captureRootEvidenceDigest', NEW."capture_root_evidence_digest",
    'captureRootId', NEW."capture_root_id"::text,
    'clearanceId', NEW."id"::text,
    'effectiveAt', "hr_iso_utc_ms"(action_at),
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'finalReviewAttestationDigest', NEW."final_attestation_digest",
    'finalReviewAttestationId', NEW."final_attestation_id"::text,
    'finalReviewerActorId', NEW."final_actor_id"::text,
    'movableContentReviewAttestationDigest', NEW."movable_attestation_digest",
    'movableContentReviewAttestationId', NEW."movable_attestation_id"::text,
    'movableContentReviewerActorId', NEW."movable_actor_id"::text,
    'ownerAuthorizationAttestationDigest', NEW."owner_attestation_digest",
    'ownerAuthorizationAttestationId', NEW."owner_attestation_id"::text,
    'ownerAuthorizerActorId', NEW."owner_actor_id"::text,
    'privacyReviewAttestationDigest', NEW."privacy_attestation_digest",
    'privacyReviewAttestationId', NEW."privacy_attestation_id"::text,
    'privacyReviewerActorId', NEW."privacy_actor_id"::text,
    'registeredAt', "hr_iso_utc_ms"(action_at),
    'schemaVersion', 'historical-runtime-capture-clearance.v1',
    'sourceReceiptSetDigest', NEW."source_receipt_set_digest",
    'sourceReceiptSetId', NEW."source_set_id"::text,
    'spaceId', NEW."space_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."capture_clearance_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-capture-clearance.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."clearance_body" := material_body || jsonb_build_object(
    'captureClearanceDigest', NEW."capture_clearance_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'capture_clearance', NEW."subject_id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."capture_clearance_digest", NEW."effective_at", NEW."expires_at",
    action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_capture_clearance"
  BEFORE INSERT ON "hr_capture_clearances"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_capture_clearance"();

CREATE OR REPLACE FUNCTION "hr_issue_derivation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  supplied_members jsonb := NEW."derivation_body"->'members';
  canonical_members jsonb := '[]'::jsonb;
  supplied_member jsonb;
  clearance_expires_at timestamptz;
  role_id uuid;
  receipt_id uuid;
  receipt_row "hr_object_receipts"%ROWTYPE;
  member_ordinal integer := 0;
  total_bytes bigint := 0;
  minimum_receipt_expiry timestamptz;
  recipe_body jsonb;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  clearance_expires_at := "hr_assert_capture_clearance_current"(
    NEW."capture_clearance_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  FOR role_id IN
    SELECT candidate.id FROM (VALUES
      (NEW."producer_attestation_id"), (NEW."custodian_attestation_id"),
      (NEW."reviewer_attestation_id")
    ) AS candidate(id) ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  IF jsonb_typeof(supplied_members) <> 'array'
     OR jsonb_array_length(supplied_members) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'derivation requires one to eight ordered members'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_members_complete';
  END IF;
  FOR receipt_id IN
    SELECT DISTINCT (member.value->'outputReceipt'->>'receiptId')::uuid
    FROM jsonb_array_elements(supplied_members) AS member(value)
    ORDER BY 1
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, NEW."environment_id", NEW."environment_mode",
      NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
    );
  END LOOP;
  FOR supplied_member IN
    SELECT member.value
    FROM jsonb_array_elements(supplied_members) WITH ORDINALITY
      AS member(value, ordinal)
    ORDER BY member.ordinal
  LOOP
    IF jsonb_typeof(supplied_member) <> 'object'
       OR (supplied_member->>'memberIndex')::integer <> member_ordinal THEN
      RAISE EXCEPTION 'derivation members must be dense and ordered'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_derivation_members_complete';
    END IF;
    SELECT * INTO STRICT receipt_row
    FROM "hr_object_receipts"
    WHERE "id" = (supplied_member->'outputReceipt'->>'receiptId')::uuid
    FOR SHARE;
    IF receipt_row."receipt_role" <> 'derived_member'
       OR receipt_row."receipt_body" IS DISTINCT FROM
          supplied_member->'outputReceipt'
       OR receipt_row."file_name" IS DISTINCT FROM
          supplied_member->>'fileName'
       OR receipt_row."mime_type" IS DISTINCT FROM
          supplied_member->>'mimeType'
       OR receipt_row."sha256" IS DISTINCT FROM supplied_member->>'sha256'
       OR receipt_row."size_bytes" IS DISTINCT FROM
          (supplied_member->>'sizeBytes')::bigint THEN
      RAISE EXCEPTION 'derivation member does not bind its exact private receipt'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_derivation_member_exact_receipt';
    END IF;
    canonical_members := canonical_members || jsonb_build_array(
      jsonb_build_object(
        'assetVersionId', supplied_member->>'assetVersionId',
        'fileExt', supplied_member->>'fileExt',
        'fileName', receipt_row."file_name",
        'memberIndex', member_ordinal,
        'mimeType', receipt_row."mime_type",
        'outputReceipt', receipt_row."receipt_body",
        'sha256', receipt_row."sha256",
        'sizeBytes', receipt_row."size_bytes"
      )
    );
    total_bytes := total_bytes + receipt_row."size_bytes";
    minimum_receipt_expiry := CASE
      WHEN minimum_receipt_expiry IS NULL THEN receipt_row."denial_expires_at"
      ELSE LEAST(minimum_receipt_expiry, receipt_row."denial_expires_at")
    END;
    member_ordinal := member_ordinal + 1;
  END LOOP;
  action_at := "hr_db_clock_ms"();
  IF NEW."capture_clearance_expires_at" IS DISTINCT FROM clearance_expires_at THEN
    RAISE EXCEPTION 'derivation does not bind the current capture clearance expiry'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_clearance_current';
  END IF;
  recipe_body := jsonb_build_object(
    'conversionBinarySha256', NEW."conversion_binary_sha256",
    'conversionCommandSha256', NEW."conversion_command_sha256",
    'conversionEnvironmentDigest', NEW."conversion_environment_digest",
    'conversionParametersDigest', NEW."conversion_parameters_digest",
    'conversionTool', NEW."conversion_tool",
    'conversionVersion', NEW."conversion_version"
  );
  NEW."subject_kind" := 'derivation';
  NEW."member_count" := member_ordinal;
  NEW."total_bytes" := total_bytes;
  NEW."members_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-members.v1\n'
      || "hr_stable_canonical_json"(canonical_members), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."minimum_output_receipt_expires_at" := minimum_receipt_expiry;
  NEW."conversion_recipe_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-conversion-recipe.v1\n'
      || "hr_stable_canonical_json"(recipe_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."created_at" := action_at;
  NEW."expires_at" := LEAST(
    NEW."capture_clearance_expires_at", NEW."producer_expires_at",
    NEW."custodian_expires_at", NEW."reviewer_expires_at",
    minimum_receipt_expiry
  );
  IF NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'derivation authority is already expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_derivation_current';
  END IF;
  material_body := jsonb_build_object(
    'captureClearanceDigest', NEW."capture_clearance_digest",
    'captureClearanceId', NEW."capture_clearance_id"::text,
    'captureRootEvidenceDigest', NEW."capture_root_evidence_digest",
    'captureRootId', NEW."capture_root_id"::text,
    'conversionBinarySha256', NEW."conversion_binary_sha256",
    'conversionCommandSha256', NEW."conversion_command_sha256",
    'conversionEnvironmentDigest', NEW."conversion_environment_digest",
    'conversionParametersDigest', NEW."conversion_parameters_digest",
    'conversionRecipeDigest', NEW."conversion_recipe_digest",
    'conversionTool', NEW."conversion_tool",
    'conversionVersion', NEW."conversion_version",
    'custodianAttestationDigest', NEW."custodian_attestation_digest",
    'custodianAttestationId', NEW."custodian_attestation_id"::text,
    'derivationId', NEW."id"::text,
    'inputNormalizedContentDigest', NEW."input_normalized_content_digest",
    'memberCount', NEW."member_count",
    'members', canonical_members,
    'membersDigest', NEW."members_digest",
    'producerAttestationDigest', NEW."producer_attestation_digest",
    'producerAttestationId', NEW."producer_attestation_id"::text,
    'registeredAt', "hr_iso_utc_ms"(action_at),
    'reviewerAttestationDigest', NEW."reviewer_attestation_digest",
    'reviewerAttestationId', NEW."reviewer_attestation_id"::text,
    'schemaVersion', 'historical-runtime-derivation-evidence.v1',
    'spaceId', NEW."space_id"::text,
    'totalBytes', NEW."total_bytes",
    'venueId', NEW."venue_id"::text
  );
  NEW."derivation_evidence_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-evidence.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."derivation_body" := material_body || jsonb_build_object(
    'derivationEvidenceDigest', NEW."derivation_evidence_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'derivation', NEW."id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."derivation_evidence_digest", action_at, NEW."expires_at", action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_derivation"
  BEFORE INSERT ON "hr_derivations"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_derivation"();

CREATE OR REPLACE FUNCTION "hr_assert_derivation_current"(
  p_derivation_id uuid,
  p_environment_id uuid,
  p_environment_mode text,
  p_environment_digest text,
  p_venue_id uuid,
  p_space_id uuid,
  p_action_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  wall_now timestamptz := GREATEST(p_action_at, "hr_wall_clock_ms"());
  derivation_row "hr_derivations"%ROWTYPE;
  clearance_expires_at timestamptz;
  role_id uuid;
  receipt_id uuid;
  minimum_receipt_expiry timestamptz;
BEGIN
  SELECT * INTO STRICT derivation_row
  FROM "hr_derivations"
  WHERE "id" = p_derivation_id;
  clearance_expires_at := "hr_assert_capture_clearance_current"(
    derivation_row."capture_clearance_id", p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    wall_now
  );
  PERFORM "hr_assert_evidence_record_current"(
    p_derivation_id, 'derivation', p_environment_id, p_environment_mode,
    p_environment_digest, p_venue_id, p_space_id, wall_now
  );
  SELECT * INTO STRICT derivation_row
  FROM "hr_derivations"
  WHERE "id" = p_derivation_id
  FOR SHARE;
  IF derivation_row."environment_id" IS DISTINCT FROM p_environment_id
     OR derivation_row."environment_mode" IS DISTINCT FROM p_environment_mode
     OR derivation_row."environment_digest" IS DISTINCT FROM p_environment_digest
     OR derivation_row."venue_id" IS DISTINCT FROM p_venue_id
     OR derivation_row."space_id" IS DISTINCT FROM p_space_id
     OR derivation_row."capture_clearance_expires_at" IS DISTINCT FROM
        clearance_expires_at THEN
    RAISE EXCEPTION 'derivation is outside the exact current capture chain'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_exact_chain';
  END IF;

  FOR role_id IN
    SELECT candidate.id FROM (VALUES
      (derivation_row."producer_attestation_id"),
      (derivation_row."custodian_attestation_id"),
      (derivation_row."reviewer_attestation_id")
    ) AS candidate(id)
    ORDER BY candidate.id
  LOOP
    PERFORM "hr_assert_role_attestation_current"(
      role_id, p_environment_id, p_environment_mode, p_environment_digest,
      p_venue_id, p_space_id, wall_now
    );
  END LOOP;
  FOR receipt_id IN
    SELECT member."output_receipt_id"
    FROM "hr_derivation_members" AS member
    WHERE member."derivation_id" = p_derivation_id
    ORDER BY member."output_receipt_id"
  LOOP
    PERFORM "hr_assert_object_receipt_current"(
      receipt_id, p_environment_id, p_environment_mode, p_environment_digest,
      p_venue_id, p_space_id, wall_now
    );
  END LOOP;
  PERFORM "hr_assert_derivation_graph_complete"(p_derivation_id);
  SELECT min(member."receipt_expires_at")
  INTO STRICT minimum_receipt_expiry
  FROM "hr_derivation_members" AS member
  WHERE member."derivation_id" = p_derivation_id;
  wall_now := GREATEST(wall_now, "hr_wall_clock_ms"());
  IF minimum_receipt_expiry IS NULL
     OR derivation_row."minimum_output_receipt_expires_at" IS DISTINCT FROM
        minimum_receipt_expiry
     OR derivation_row."expires_at" <= wall_now
     OR derivation_row."expires_at" > minimum_receipt_expiry
     OR derivation_row."expires_at" > clearance_expires_at THEN
    RAISE EXCEPTION 'derivation constituents are not current'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_derivation_current';
  END IF;
  RETURN derivation_row."expires_at";
END;
$$;

CREATE OR REPLACE FUNCTION "hr_issue_transform_review"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  subject_material jsonb;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    NEW."reviewer_attestation_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  action_at := "hr_db_clock_ms"();
  NEW."subject_kind" := 'transform_review';
  NEW."decision" := 'approved';
  NEW."created_at" := action_at;
  NEW."reviewed_at" := action_at;
  NEW."expires_at" := NEW."reviewer_expires_at";
  IF NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'transform review authority is already expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_transform_review_current';
  END IF;
  subject_material := jsonb_build_object(
    'presentationAdmissionDigest', NEW."presentation_admission_digest",
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'runtimePackageContentDigest', NEW."runtime_package_content_digest",
    'runtimePackageId', NEW."runtime_package_id"::text,
    'schemaVersion', 'historical-runtime-transform-review-subject.v1',
    'spaceId', NEW."space_id"::text,
    'transformArtifactDigest', NEW."transform_artifact_digest",
    'transformArtifactId', NEW."transform_artifact_id",
    'transformArtifactRowId', NEW."transform_artifact_row_id"::text,
    'transformReviewId', NEW."id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."transform_review_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-transform-review-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material), 'UTF8'
  ), 'sha256'), 'hex');
  material_body := jsonb_build_object(
    'decision', 'approved',
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'reviewedAt', "hr_iso_utc_ms"(action_at),
    'reviewerActorId', NEW."reviewer_actor_id"::text,
    'reviewerAttestationDigest', NEW."reviewer_attestation_digest",
    'reviewerAttestationId', NEW."reviewer_attestation_id"::text,
    'subject', subject_material,
    'subjectDigest', NEW."transform_review_subject_digest"
  );
  NEW."transform_review_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-transform-review.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."transform_review_body" := material_body || jsonb_build_object(
    'transformReviewDigest', NEW."transform_review_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'transform_review', NEW."id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."transform_review_digest", NEW."reviewed_at", NEW."expires_at",
    action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_transform_review"
  BEFORE INSERT ON "hr_transform_reviews"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_transform_review"();

CREATE OR REPLACE FUNCTION "hr_issue_rights_clearance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  derivation_expires_at timestamptz;
  subject_material jsonb;
  material_body jsonb;
BEGIN
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  derivation_expires_at := "hr_assert_derivation_current"(
    NEW."derivation_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_assert_role_attestation_current"(
    NEW."reviewer_attestation_id", NEW."environment_id",
    NEW."environment_mode", NEW."environment_digest", NEW."venue_id",
    NEW."space_id", check_at
  );
  PERFORM "hr_assert_object_receipt_current"(
    NEW."output_receipt_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  action_at := "hr_db_clock_ms"();
  IF NEW."derivation_expires_at" IS DISTINCT FROM derivation_expires_at THEN
    RAISE EXCEPTION 'rights clearance does not bind the current derivation expiry'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_rights_derivation_current';
  END IF;
  NEW."subject_kind" := 'rights_clearance';
  NEW."rights_decision" := 'approved';
  NEW."created_at" := action_at;
  NEW."effective_at" := action_at;
  NEW."expires_at" := LEAST(
    NEW."derivation_expires_at", NEW."output_receipt_expires_at",
    NEW."reviewer_expires_at"
  );
  IF NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'rights clearance authority is already expired'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_rights_clearance_current';
  END IF;
  subject_material := jsonb_build_object(
    'assetVersionId', NEW."asset_version_id"::text,
    'derivationEvidenceDigest', NEW."derivation_evidence_digest",
    'derivationId', NEW."derivation_id"::text,
    'memberIndex', NEW."member_index",
    'outputReceiptDigest', NEW."output_receipt_digest",
    'outputReceiptId', NEW."output_receipt_id"::text,
    'presentationAdmissionDigest', NEW."presentation_admission_digest",
    'presentationAdmissionId', NEW."presentation_admission_id"::text,
    'rightsClearanceId', NEW."id"::text,
    'rightsDecision', 'approved',
    'rightsEvidenceDigest', NEW."rights_evidence_digest",
    'rightsEvidenceRowId', NEW."rights_evidence_row_id"::text,
    'rightsReviewedAt', "hr_iso_utc_ms"(NEW."rights_reviewed_at"),
    'rightsReviewedBy', NEW."rights_reviewed_by"::text,
    'schemaVersion', 'historical-runtime-rights-clearance-subject.v1',
    'spaceId', NEW."space_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."rights_clearance_subject_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-rights-clearance-subject.v1\n'
      || "hr_stable_canonical_json"(subject_material), 'UTF8'
  ), 'sha256'), 'hex');
  material_body := jsonb_build_object(
    'effectiveAt', "hr_iso_utc_ms"(action_at),
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'registeredAt', "hr_iso_utc_ms"(action_at),
    'reviewerActorId', NEW."reviewer_actor_id"::text,
    'reviewerAttestationDigest', NEW."reviewer_attestation_digest",
    'reviewerAttestationId', NEW."reviewer_attestation_id"::text,
    'subject', subject_material,
    'subjectDigest', NEW."rights_clearance_subject_digest"
  );
  NEW."rights_clearance_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-rights-clearance.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."rights_clearance_body" := material_body || jsonb_build_object(
    'rightsClearanceDigest', NEW."rights_clearance_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'rights_clearance', NEW."id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."rights_clearance_digest", NEW."effective_at", NEW."expires_at",
    action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_rights_clearance"
  BEFORE INSERT ON "hr_rights_clearances"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_rights_clearance"();

CREATE OR REPLACE FUNCTION "hr_issue_test_twin_release_authority"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  check_at timestamptz := "hr_wall_clock_ms"();
  action_at timestamptz;
  release_row "reconstruction_releases"%ROWTYPE;
  review_row "reconstruction_release_reviews"%ROWTYPE;
  latest_review "reconstruction_release_reviews"%ROWTYPE;
  attestation_row "reconstruction_release_attestations"%ROWTYPE;
  snapshot_row "hr_authority_snapshots"%ROWTYPE;
  material_body jsonb;
BEGIN
  IF NEW."environment_mode" <> 'test' THEN
    RAISE EXCEPTION 'legacy twin release wrappers are test-only'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_legacy_twin_production_forbidden';
  END IF;
  PERFORM "hr_lock_scope"(
    NEW."environment_id", NEW."venue_id", NEW."space_id"
  );
  PERFORM "hr_assert_scope_current"(
    NEW."scope_epoch_id", NEW."environment_id", NEW."environment_mode",
    NEW."environment_digest", NEW."venue_id", NEW."space_id", check_at
  );
  PERFORM "hr_lock_authority"(
    'reconstruction-release', NEW."release_id"::text
  );
  SELECT * INTO STRICT release_row
  FROM "reconstruction_releases"
  WHERE "id" = NEW."release_id"
  FOR SHARE;
  SELECT * INTO STRICT review_row
  FROM "reconstruction_release_reviews"
  WHERE "id" = NEW."release_review_id"
  FOR SHARE;
  SELECT * INTO STRICT latest_review
  FROM "reconstruction_release_reviews"
  WHERE "release_id" = release_row."id"
  ORDER BY "review_sequence" DESC
  LIMIT 1
  FOR SHARE;
  IF review_row."id" IS DISTINCT FROM latest_review."id"
     OR review_row."release_id" IS DISTINCT FROM release_row."id"
     OR review_row."release_digest" IS DISTINCT FROM release_row."release_digest"
     OR review_row."release_manifest_sha256" IS DISTINCT FROM
        release_row."release_manifest_sha256"
     OR review_row."decision" <> 'approved'
     OR review_row."reviewer_authority" <> 'platform_admin'
     OR review_row."target_exposure" NOT IN ('expert_review', 'public')
     OR review_row."supersedes_review_id" IS DISTINCT FROM
        NEW."release_supersedes_review_id" THEN
    RAISE EXCEPTION 'legacy twin wrapper does not bind the latest exact review'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_twin_release_latest_review';
  END IF;
  SELECT * INTO STRICT attestation_row
  FROM "reconstruction_release_attestations"
  WHERE "id" = NEW."release_attestation_id"
  FOR SHARE;
  IF attestation_row."release_id" IS DISTINCT FROM release_row."id"
     OR attestation_row."release_digest" IS DISTINCT FROM
        release_row."release_digest"
     OR attestation_row."review_id" IS DISTINCT FROM review_row."id"
     OR attestation_row."review_digest" IS DISTINCT FROM
        review_row."request_digest"
     OR attestation_row."qa_report_digest" IS DISTINCT FROM
        review_row."qa_report_digest" THEN
    RAISE EXCEPTION 'legacy twin wrapper attestation is not the exact review leaf'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_twin_release_attestation_exact';
  END IF;
  SELECT * INTO STRICT snapshot_row
  FROM "hr_authority_snapshots"
  WHERE "id" = NEW."authority_snapshot_id"
  FOR SHARE;
  IF snapshot_row."attestation_id" IS DISTINCT FROM NEW."id"
     OR snapshot_row."subject_id" IS DISTINCT FROM NEW."subject_id"
     OR snapshot_row."subject_kind" <> 'scene_validation'
     OR snapshot_row."environment_id" IS DISTINCT FROM NEW."environment_id"
     OR snapshot_row."environment_mode" IS DISTINCT FROM NEW."environment_mode"
     OR snapshot_row."environment_digest" IS DISTINCT FROM
        NEW."environment_digest"
     OR snapshot_row."scope_epoch_id" IS DISTINCT FROM NEW."scope_epoch_id"
     OR snapshot_row."venue_id" IS DISTINCT FROM NEW."venue_id"
     OR snapshot_row."space_id" IS DISTINCT FROM NEW."space_id"
     OR snapshot_row."platform_role" <> 'admin' THEN
    RAISE EXCEPTION 'legacy twin wrapper requires exact platform-admin authority'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_twin_release_approver_authority';
  END IF;
  PERFORM "hr_assert_role_snapshot_current"(
    snapshot_row."id", 'scene_reviewer', check_at
  );

  -- The release, latest review, attestation, and approving authority are all
  -- locked before the canonical approval instant is sampled.
  action_at := "hr_db_clock_ms"();

  NEW."subject_kind" := 'scene_validation';
  NEW."venue_slug" := release_row."venue_slug";
  NEW."release_kind" := release_row."release_kind";
  NEW."release_digest" := release_row."release_digest";
  NEW."release_manifest_sha256" := release_row."release_manifest_sha256";
  NEW."release_created_by" := release_row."created_by";
  NEW."release_created_at" := release_row."created_at";
  NEW."release_qa_report_digest" := review_row."qa_report_digest";
  NEW."release_review_digest" := review_row."request_digest";
  NEW."release_reviewer_actor_id" := review_row."reviewer_user_id";
  NEW."release_reviewer_authority" := review_row."reviewer_authority";
  NEW."release_review_decision" := review_row."decision";
  NEW."release_target_exposure" := review_row."target_exposure";
  NEW."release_review_sequence" := review_row."review_sequence";
  NEW."release_supersedes_review_id" := review_row."supersedes_review_id";
  NEW."release_reviewed_at" := review_row."reviewed_at";
  NEW."release_attestation_envelope_sha256" :=
    attestation_row."envelope_sha256";
  NEW."release_attestation_verified_by" := attestation_row."verified_by";
  NEW."release_attestation_verified_at" := attestation_row."verified_at";
  NEW."approved_by_actor_id" := snapshot_row."actor_id";
  NEW."authority_digest" := snapshot_row."authority_digest";
  NEW."authority_body" := snapshot_row."authority_body";
  NEW."authority_snapshotted_at" := snapshot_row."snapshotted_at";
  NEW."created_at" := action_at;
  NEW."approved_at" := action_at;
  NEW."expires_at" := LEAST(
    action_at + interval '30 days', NEW."scope_epoch_expires_at"
  );
  IF NEW."release_attestation_verified_at" > NEW."authority_snapshotted_at"
     OR NEW."authority_snapshotted_at" > action_at
     OR NEW."expires_at" <= action_at THEN
    RAISE EXCEPTION 'legacy twin wrapper chronology is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_twin_release_chronology';
  END IF;
  material_body := jsonb_build_object(
    'approvedAt', "hr_iso_utc_ms"(action_at),
    'approvedByActorId', NEW."approved_by_actor_id"::text,
    'authorityDigest', NEW."authority_digest",
    'authorityId', NEW."id"::text,
    'authoritySnapshot', NEW."authority_body",
    'authoritySnapshotId', NEW."authority_snapshot_id"::text,
    'expiresAt', "hr_iso_utc_ms"(NEW."expires_at"),
    'releaseAttestationEnvelopeSha256',
      NEW."release_attestation_envelope_sha256",
    'releaseAttestationId', NEW."release_attestation_id"::text,
    'releaseAttestationVerifiedAt',
      "hr_iso_utc_ms"(NEW."release_attestation_verified_at"),
    'releaseAttestationVerifiedBy',
      NEW."release_attestation_verified_by"::text,
    'releaseCreatedAt', "hr_iso_utc_ms"(NEW."release_created_at"),
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
    'releaseReviewedAt', "hr_iso_utc_ms"(NEW."release_reviewed_at"),
    'releaseReviewerActorId', NEW."release_reviewer_actor_id"::text,
    'releaseReviewerAuthority', NEW."release_reviewer_authority",
    'releaseSupersedesReviewId', CASE
      WHEN NEW."release_supersedes_review_id" IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(NEW."release_supersedes_review_id"::text)
    END,
    'releaseTargetExposure', NEW."release_target_exposure",
    'sceneValidationId', NEW."subject_id"::text,
    'schemaVersion', 'historical-runtime-twin-release-authority.v1',
    'spaceId', NEW."space_id"::text,
    'venueId', NEW."venue_id"::text
  );
  NEW."twin_release_authority_digest" := encode(digest(convert_to(
    E'venviewer.historical-runtime-twin-release-authority.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  NEW."twin_release_authority_body" := material_body || jsonb_build_object(
    'twinReleaseAuthorityDigest', NEW."twin_release_authority_digest"
  );
  PERFORM "hr_insert_evidence_record"(
    NEW."id", 'twin_release_authority', NEW."subject_id", NEW."subject_kind",
    NEW."environment_id", NEW."environment_mode", NEW."environment_digest",
    NEW."scope_epoch_id", NEW."venue_id", NEW."space_id",
    NEW."twin_release_authority_digest", NEW."approved_at", NEW."expires_at",
    action_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "b_hr_issue_test_twin_release_authority"
  BEFORE INSERT ON "hr_twin_release_authorities"
  FOR EACH ROW EXECUTE FUNCTION "hr_issue_test_twin_release_authority"();

CREATE OR REPLACE FUNCTION "hr_issue_revocation_action"(
  p_authentication_assertion_id uuid,
  p_expected_revocation_kind text
)
RETURNS "hr_revocation_actions"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  assertion_row public."hr_authenticated_action_assertions"%ROWTYPE;
  revocation_id uuid;
  revocation_kind text;
  target_id uuid;
  reason_code text;
  normalized_reason text;
  normalized_incident_reference text;
  target_kind text;
  target_digest text;
  target_scope_epoch_id uuid;
  target_expires_at timestamptz;
  target_environment_id uuid;
  target_environment_mode text;
  target_environment_digest text;
  target_venue_id uuid;
  target_space_id uuid;
  target_body jsonb;
  scope_target public."hr_scope_epochs"%ROWTYPE;
  capability_target public."hr_provider_capabilities"%ROWTYPE;
  signing_target public."hr_signing_key_authorities"%ROWTYPE;
  role_target public."hr_role_attestations"%ROWTYPE;
  record_target public."hr_evidence_records"%ROWTYPE;
  action_authority public."hr_action_authority_snapshots"%ROWTYPE;
  material_body jsonb;
  revocation_digest text;
  issued public."hr_revocation_actions"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT assertion_row
  FROM public."hr_authenticated_action_assertions"
  WHERE "id" = p_authentication_assertion_id
    AND "action_kind" = p_expected_revocation_kind
  FOR SHARE;
  revocation_id := assertion_row."action_id";
  revocation_kind := assertion_row."action_kind";
  target_id := (assertion_row."action_parameters_body"->>'targetId')::uuid;
  reason_code := assertion_row."action_parameters_body"->>'reasonCode';
  normalized_incident_reference := btrim(
    assertion_row."action_parameters_body"->>'incidentReference'
  );
  normalized_reason := btrim(
    assertion_row."action_parameters_body"->>'reason'
  );
  IF length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'revocation reason is required and bounded'
      USING ERRCODE = '23514', CONSTRAINT = 'hr_revocation_reason';
  END IF;
  IF reason_code NOT IN (
    'administrative_emergency', 'authority_withdrawn',
    'integrity_failure', 'privacy_incident', 'suspected_key_compromise'
  ) OR length(normalized_incident_reference) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'revocation reason code or incident reference is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'hr_revocation_reason';
  END IF;
  CASE revocation_kind
    WHEN 'scope_epoch_revocation' THEN
      SELECT * INTO STRICT scope_target
      FROM public."hr_scope_epochs" WHERE "id" = target_id;
      PERFORM public."hr_lock_scope"(
        scope_target."environment_id", scope_target."venue_id",
        scope_target."space_id"
      );
      SELECT * INTO STRICT scope_target
      FROM public."hr_scope_epochs" WHERE "id" = target_id FOR SHARE;
      target_kind := 'scope_epoch';
      target_digest := scope_target."epoch_digest";
      target_scope_epoch_id := scope_target."id";
      target_expires_at := scope_target."expires_at";
      target_environment_id := scope_target."environment_id";
      target_environment_mode := scope_target."environment_mode";
      target_environment_digest := scope_target."environment_digest";
      target_venue_id := scope_target."venue_id";
      target_space_id := scope_target."space_id";
      target_body := jsonb_build_object(
        'epoch', scope_target."epoch",
        'epochDigest', scope_target."epoch_digest",
        'epochId', scope_target."id"::text,
        'expiresAt', public."hr_iso_utc_ms"(scope_target."expires_at")
      );
    WHEN 'provider_capability_revocation' THEN
      SELECT * INTO STRICT capability_target
      FROM public."hr_provider_capabilities" WHERE "id" = target_id;
      PERFORM public."hr_lock_scope"(
        capability_target."environment_id", capability_target."venue_id",
        capability_target."space_id"
      );
      PERFORM public."hr_lock_authority"(
        'provider-capability', target_id::text
      );
      SELECT * INTO STRICT capability_target
      FROM public."hr_provider_capabilities"
      WHERE "id" = target_id FOR SHARE;
      target_kind := 'provider_capability';
      target_digest := capability_target."capability_digest";
      target_scope_epoch_id := capability_target."scope_epoch_id";
      target_expires_at := capability_target."expires_at";
      target_environment_id := capability_target."environment_id";
      target_environment_mode := capability_target."environment_mode";
      target_environment_digest := capability_target."environment_digest";
      target_venue_id := capability_target."venue_id";
      target_space_id := capability_target."space_id";
      target_body := jsonb_build_object(
        'capabilityDigest', capability_target."capability_digest",
        'capabilityExpiresAt', public."hr_iso_utc_ms"(
          capability_target."expires_at"
        ),
        'capabilityId', capability_target."id"::text,
        'scopeEpochId', capability_target."scope_epoch_id"::text
      );
    WHEN 'signing_key_authority_revocation' THEN
      SELECT * INTO STRICT signing_target
      FROM public."hr_signing_key_authorities" WHERE "id" = target_id;
      PERFORM public."hr_lock_scope"(
        signing_target."environment_id", signing_target."venue_id",
        signing_target."space_id"
      );
      PERFORM public."hr_lock_authority"(
        'key-policy', signing_target."key_policy_id"::text
      );
      PERFORM public."hr_lock_authority"('key-authority', target_id::text);
      SELECT * INTO STRICT signing_target
      FROM public."hr_signing_key_authorities"
      WHERE "id" = target_id FOR SHARE;
      target_kind := 'signing_key_authority';
      target_digest := signing_target."key_policy_digest";
      target_scope_epoch_id := signing_target."scope_epoch_id";
      target_expires_at := signing_target."expires_at";
      target_environment_id := signing_target."environment_id";
      target_environment_mode := signing_target."environment_mode";
      target_environment_digest := signing_target."environment_digest";
      target_venue_id := signing_target."venue_id";
      target_space_id := signing_target."space_id";
      target_body := jsonb_build_object(
        'authorityExpiresAt', public."hr_iso_utc_ms"(signing_target."expires_at"),
        'keyId', signing_target."key_id",
        'keyPolicyDigest', signing_target."key_policy_digest",
        'keyPolicyId', signing_target."key_policy_id"::text,
        'policyEffectiveAt', public."hr_iso_utc_ms"(
          signing_target."policy_effective_at"
        ),
        'publicKeyFingerprint', signing_target."public_key_fingerprint",
        'purpose', signing_target."purpose",
        'scopeEpochId', signing_target."scope_epoch_id"::text,
        'signingKeyAuthorityId', signing_target."id"::text
      );
    WHEN 'role_attestation_revocation' THEN
      SELECT * INTO STRICT role_target
      FROM public."hr_role_attestations" WHERE "id" = target_id;
      PERFORM public."hr_lock_scope"(
        role_target."environment_id", role_target."venue_id",
        role_target."space_id"
      );
      PERFORM public."hr_lock_authority"(
        'role-attestation', target_id::text
      );
      SELECT * INTO STRICT role_target
      FROM public."hr_role_attestations"
      WHERE "id" = target_id FOR SHARE;
      target_kind := 'role_attestation';
      target_digest := role_target."attestation_digest";
      target_scope_epoch_id := role_target."scope_epoch_id";
      target_expires_at := role_target."expires_at";
      target_environment_id := role_target."environment_id";
      target_environment_mode := role_target."environment_mode";
      target_environment_digest := role_target."environment_digest";
      target_venue_id := role_target."venue_id";
      target_space_id := role_target."space_id";
      target_body := jsonb_build_object(
        'actorId', role_target."actor_id"::text,
        'attestationDigest', role_target."attestation_digest",
        'attestationId', role_target."id"::text,
        'boundDigest', role_target."bound_digest",
        'boundKind', role_target."bound_kind",
        'boundReference', role_target."bound_reference",
        'effectiveAt', public."hr_iso_utc_ms"(role_target."effective_at"),
        'expiresAt', public."hr_iso_utc_ms"(role_target."expires_at"),
        'role', role_target."role",
        'scopeEpochId', role_target."scope_epoch_id"::text,
        'subjectId', role_target."subject_id"::text,
        'subjectKind', role_target."subject_kind"
      );
    WHEN 'evidence_record_revocation' THEN
      SELECT * INTO STRICT record_target
      FROM public."hr_evidence_records" WHERE "id" = target_id;
      PERFORM public."hr_lock_scope"(
        record_target."environment_id", record_target."venue_id",
        record_target."space_id"
      );
      PERFORM public."hr_lock_authority"('evidence-record', target_id::text);
      SELECT * INTO STRICT record_target
      FROM public."hr_evidence_records"
      WHERE "id" = target_id FOR SHARE;
      target_kind := 'evidence_record';
      target_digest := record_target."record_digest";
      target_scope_epoch_id := record_target."scope_epoch_id";
      target_expires_at := record_target."expires_at";
      target_environment_id := record_target."environment_id";
      target_environment_mode := record_target."environment_mode";
      target_environment_digest := record_target."environment_digest";
      target_venue_id := record_target."venue_id";
      target_space_id := record_target."space_id";
      target_body := jsonb_build_object(
        'expiresAt', public."hr_iso_utc_ms"(record_target."expires_at"),
        'recordDigest', record_target."record_digest",
        'recordId', record_target."id"::text,
        'recordKind', record_target."record_kind",
        'scopeEpochId', record_target."scope_epoch_id"::text,
        'subjectId', record_target."subject_id"::text,
        'subjectKind', record_target."subject_kind"
      );
    ELSE
      RAISE EXCEPTION 'unsupported core revocation kind'
        USING ERRCODE = '23514', CONSTRAINT = 'hr_revocation_kind';
  END CASE;

  SELECT * INTO issued
  FROM public."hr_revocation_actions" AS existing_action
  WHERE existing_action."revocation_kind" = assertion_row."action_kind"
    AND existing_action."target_id" =
      (assertion_row."action_parameters_body"->>'targetId')::uuid;
  IF FOUND THEN
    IF issued."id" IS DISTINCT FROM revocation_id
       OR issued."revoker_action_parameters_digest" IS DISTINCT FROM
          assertion_row."action_parameters_digest" THEN
      RAISE EXCEPTION 'historical-runtime target is already revoked'
        USING ERRCODE = '23505', CONSTRAINT = 'hr_revocation_target_once';
    END IF;
    RETURN issued;
  END IF;
  action_authority := public."hr_consume_action_authority"(
    p_authentication_assertion_id, revocation_kind, 'revoker'
  );
  IF action_authority."environment_id" IS DISTINCT FROM target_environment_id
     OR action_authority."environment_mode" IS DISTINCT FROM
        target_environment_mode
     OR action_authority."environment_digest" IS DISTINCT FROM
        target_environment_digest
     OR action_authority."venue_id" IS DISTINCT FROM target_venue_id
     OR action_authority."space_id" IS DISTINCT FROM target_space_id THEN
    RAISE EXCEPTION 'revoker assertion does not bind target scope'
      USING ERRCODE = '23514', CONSTRAINT = 'hr_revocation_scope';
  END IF;
  material_body := jsonb_build_object(
    'environmentDigest', target_environment_digest,
    'environmentId', target_environment_id::text,
    'environmentMode', target_environment_mode,
    'incidentReference', normalized_incident_reference,
    'reason', normalized_reason,
    'reasonCode', reason_code,
    'revocationId', revocation_id::text,
    'revocationKind', revocation_kind,
    'revokedAt', public."hr_iso_utc_ms"(action_authority."snapshotted_at"),
    'revokedBy', action_authority."actor_id"::text,
    'revokerAuthority', action_authority."authority_body",
    'revokerAuthorityDigest', action_authority."authority_digest",
    'revokerAuthoritySnapshotId', action_authority."id"::text,
    'revokerActionParametersDigest',
      action_authority."action_parameters_digest",
    'schemaVersion', public."hr_revocation_schema_version"(revocation_kind),
    'spaceId', target_space_id::text,
    'target', target_body,
    'targetDigest', target_digest,
    'targetExpiresAt', public."hr_iso_utc_ms"(target_expires_at),
    'targetId', target_id::text,
    'targetKind', target_kind,
    'targetScopeEpochId', target_scope_epoch_id::text,
    'venueId', target_venue_id::text
  );
  revocation_digest := public."hr_revocation_digest_for_body"(
    revocation_kind, material_body
  );
  INSERT INTO public."hr_revocation_actions" (
    "id", "revocation_kind", "target_kind", "target_id", "target_digest",
    "target_scope_epoch_id", "target_expires_at", "environment_id",
    "environment_mode", "environment_digest", "venue_id", "space_id",
    "revoker_action_kind", "revoker_action_parameters_digest",
    "revoker_authority_snapshot_id", "revoker_authority_scope_epoch_id",
    "revoker_authority_digest", "revoker_authority_snapshotted_at",
    "revoker_authority_expires_at", "revoked_by", "reason_code",
    "incident_reference", "reason", "revoked_at",
    "revocation_digest", "revocation_body", "created_at"
  ) VALUES (
    revocation_id, revocation_kind, target_kind, target_id,
    target_digest, target_scope_epoch_id, target_expires_at,
    target_environment_id, target_environment_mode, target_environment_digest,
    target_venue_id, target_space_id, revocation_kind,
    action_authority."action_parameters_digest", action_authority."id",
    action_authority."authority_scope_epoch_id",
    action_authority."authority_digest", action_authority."snapshotted_at",
    action_authority."expires_at", action_authority."actor_id", reason_code,
    normalized_incident_reference, normalized_reason,
    action_authority."snapshotted_at", revocation_digest,
    material_body || jsonb_build_object(
      'revocationDigest', revocation_digest
    ), action_authority."snapshotted_at"
  ) RETURNING * INTO issued;

  CASE revocation_kind
    WHEN 'scope_epoch_revocation' THEN
      INSERT INTO public."hr_scope_epoch_revocations" (
        "epoch_id", "environment_id", "environment_mode",
        "environment_digest", "venue_id", "space_id", "epoch",
        "epoch_digest", "epoch_expires_at", "revocation_action_id",
        "revoker_authority_snapshot_id", "revoker_authority_digest",
        "revocation_digest", "reason", "revoked_by", "revoked_at",
        "revocation_body", "created_at"
      ) VALUES (
        scope_target."id", scope_target."environment_id",
        scope_target."environment_mode", scope_target."environment_digest",
        scope_target."venue_id", scope_target."space_id", scope_target."epoch",
        scope_target."epoch_digest", scope_target."expires_at", issued."id",
        action_authority."id", action_authority."authority_digest",
        issued."revocation_digest", issued."reason", issued."revoked_by",
        issued."revoked_at", issued."revocation_body", issued."created_at"
      );
    WHEN 'provider_capability_revocation' THEN
      INSERT INTO public."hr_provider_capability_revocations" (
        "capability_id", "environment_id", "environment_mode",
        "environment_digest", "scope_epoch_id", "capability_digest",
        "venue_id", "space_id", "capability_expires_at",
        "revocation_action_id", "revoker_authority_snapshot_id",
        "revoker_authority_digest", "revocation_digest", "reason",
        "revoked_by", "revoked_at", "revocation_body", "created_at"
      ) VALUES (
        capability_target."id", capability_target."environment_id",
        capability_target."environment_mode",
        capability_target."environment_digest",
        capability_target."scope_epoch_id", capability_target."capability_digest",
        capability_target."venue_id", capability_target."space_id",
        capability_target."expires_at", issued."id", action_authority."id",
        action_authority."authority_digest", issued."revocation_digest",
        issued."reason", issued."revoked_by", issued."revoked_at",
        issued."revocation_body", issued."created_at"
      );
    WHEN 'signing_key_authority_revocation' THEN
      INSERT INTO public."hr_signing_key_authority_revocations" (
        "signing_key_authority_id", "environment_id", "environment_mode",
        "environment_digest", "scope_epoch_id", "venue_id", "space_id",
        "key_policy_id", "purpose", "key_policy_digest", "key_id",
        "public_key_fingerprint", "policy_effective_at",
        "authority_expires_at", "revocation_action_id",
        "revoker_authority_snapshot_id", "revoker_authority_digest",
        "revocation_digest", "reason", "revoked_by", "revoked_at",
        "revocation_body", "created_at"
      ) VALUES (
        signing_target."id", signing_target."environment_id",
        signing_target."environment_mode", signing_target."environment_digest",
        signing_target."scope_epoch_id", signing_target."venue_id",
        signing_target."space_id", signing_target."key_policy_id",
        signing_target."purpose", signing_target."key_policy_digest",
        signing_target."key_id", signing_target."public_key_fingerprint",
        signing_target."policy_effective_at", signing_target."expires_at",
        issued."id", action_authority."id", action_authority."authority_digest",
        issued."revocation_digest", issued."reason", issued."revoked_by",
        issued."revoked_at", issued."revocation_body", issued."created_at"
      );
    WHEN 'role_attestation_revocation' THEN
      INSERT INTO public."hr_role_attestation_revocations" (
        "attestation_id", "attestation_digest", "subject_id", "subject_kind",
        "environment_id", "environment_mode", "environment_digest",
        "scope_epoch_id", "venue_id", "space_id", "role",
        "target_actor_id", "bound_kind", "bound_reference", "bound_digest",
        "effective_at", "attestation_expires_at", "revocation_action_id",
        "revoker_authority_snapshot_id", "revoker_authority_digest",
        "revocation_digest", "reason", "revoked_by", "revoked_at",
        "revocation_body", "created_at"
      ) VALUES (
        role_target."id", role_target."attestation_digest",
        role_target."subject_id", role_target."subject_kind",
        role_target."environment_id", role_target."environment_mode",
        role_target."environment_digest", role_target."scope_epoch_id",
        role_target."venue_id", role_target."space_id", role_target."role",
        role_target."actor_id", role_target."bound_kind",
        role_target."bound_reference", role_target."bound_digest",
        role_target."effective_at", role_target."expires_at", issued."id",
        action_authority."id", action_authority."authority_digest",
        issued."revocation_digest", issued."reason", issued."revoked_by",
        issued."revoked_at", issued."revocation_body", issued."created_at"
      );
    WHEN 'evidence_record_revocation' THEN
      INSERT INTO public."hr_evidence_record_revocations" (
        "record_id", "record_kind", "subject_id", "subject_kind",
        "environment_id", "environment_mode", "environment_digest",
        "scope_epoch_id", "venue_id", "space_id", "record_digest",
        "record_expires_at", "revocation_action_id",
        "revoker_authority_snapshot_id", "revoker_authority_digest",
        "revocation_digest", "reason", "revoked_by", "revoked_at",
        "revocation_body", "created_at"
      ) VALUES (
        record_target."id", record_target."record_kind",
        record_target."subject_id", record_target."subject_kind",
        record_target."environment_id", record_target."environment_mode",
        record_target."environment_digest", record_target."scope_epoch_id",
        record_target."venue_id", record_target."space_id",
        record_target."record_digest", record_target."expires_at", issued."id",
        action_authority."id", action_authority."authority_digest",
        issued."revocation_digest", issued."reason", issued."revoked_by",
        issued."revoked_at", issued."revocation_body", issued."created_at"
      );
  END CASE;
  RETURN issued;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'revocation target or action evidence does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'hr_revocation_identity';
END;
$$;

CREATE OR REPLACE FUNCTION "hr_revoke_scope_epoch"(
  p_authentication_assertion_id uuid
) RETURNS "hr_scope_epoch_revocations"
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_row public."hr_revocation_actions"%ROWTYPE;
  issued public."hr_scope_epoch_revocations"%ROWTYPE;
BEGIN
  action_row := public."hr_issue_revocation_action"(
    p_authentication_assertion_id, 'scope_epoch_revocation'
  );
  SELECT * INTO STRICT issued FROM public."hr_scope_epoch_revocations"
  WHERE "epoch_id" = action_row."target_id";
  RETURN issued;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_revoke_provider_capability"(
  p_authentication_assertion_id uuid
) RETURNS "hr_provider_capability_revocations"
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_row public."hr_revocation_actions"%ROWTYPE;
  issued public."hr_provider_capability_revocations"%ROWTYPE;
BEGIN
  action_row := public."hr_issue_revocation_action"(
    p_authentication_assertion_id, 'provider_capability_revocation'
  );
  SELECT * INTO STRICT issued FROM public."hr_provider_capability_revocations"
  WHERE "capability_id" = action_row."target_id";
  RETURN issued;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_revoke_signing_key_authority"(
  p_authentication_assertion_id uuid
) RETURNS "hr_signing_key_authority_revocations"
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_row public."hr_revocation_actions"%ROWTYPE;
  issued public."hr_signing_key_authority_revocations"%ROWTYPE;
BEGIN
  action_row := public."hr_issue_revocation_action"(
    p_authentication_assertion_id, 'signing_key_authority_revocation'
  );
  SELECT * INTO STRICT issued
  FROM public."hr_signing_key_authority_revocations"
  WHERE "signing_key_authority_id" = action_row."target_id";
  RETURN issued;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_revoke_role_attestation"(
  p_authentication_assertion_id uuid
) RETURNS "hr_role_attestation_revocations"
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_row public."hr_revocation_actions"%ROWTYPE;
  issued public."hr_role_attestation_revocations"%ROWTYPE;
BEGIN
  action_row := public."hr_issue_revocation_action"(
    p_authentication_assertion_id, 'role_attestation_revocation'
  );
  SELECT * INTO STRICT issued FROM public."hr_role_attestation_revocations"
  WHERE "attestation_id" = action_row."target_id";
  RETURN issued;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_revoke_evidence_record"(
  p_authentication_assertion_id uuid
) RETURNS "hr_evidence_record_revocations"
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  action_row public."hr_revocation_actions"%ROWTYPE;
  issued public."hr_evidence_record_revocations"%ROWTYPE;
BEGIN
  action_row := public."hr_issue_revocation_action"(
    p_authentication_assertion_id, 'evidence_record_revocation'
  );
  SELECT * INTO STRICT issued FROM public."hr_evidence_record_revocations"
  WHERE "record_id" = action_row."target_id";
  RETURN issued;
END;
$$;

REVOKE ALL ON FUNCTION
  "hr_issue_authenticated_action_assertion"(
    uuid, text, jsonb, uuid, uuid, text, text, text, text,
    timestamptz, timestamptz, uuid, uuid
  ),
  "hr_consume_action_authority"(uuid, text, text),
  "hr_issue_revocation_action"(uuid, text),
  "hr_revoke_scope_epoch"(uuid),
  "hr_revoke_provider_capability"(uuid),
  "hr_revoke_signing_key_authority"(uuid),
  "hr_revoke_role_attestation"(uuid),
  "hr_revoke_evidence_record"(uuid)
FROM PUBLIC, "omnitwin_api_activation", "omnitwin_historical_evidence_verifier";

GRANT USAGE ON SCHEMA public TO "omnitwin_historical_auth_gateway";
GRANT EXECUTE ON FUNCTION "hr_issue_authenticated_action_assertion"(
  uuid, text, jsonb, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, uuid, uuid
) TO "omnitwin_historical_auth_gateway";
GRANT EXECUTE ON FUNCTION
  "hr_revoke_scope_epoch"(uuid),
  "hr_revoke_provider_capability"(uuid),
  "hr_revoke_signing_key_authority"(uuid),
  "hr_revoke_role_attestation"(uuid),
  "hr_revoke_evidence_record"(uuid)
TO "omnitwin_api_activation";

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_authenticated_action_assertions", "hr_action_authority_snapshots",
  "hr_authenticated_action_assertion_uses", "hr_revocation_actions",
  "hr_scope_epoch_revocations", "hr_provider_capability_revocations",
  "hr_signing_key_authority_revocations", "hr_role_attestation_revocations",
  "hr_evidence_record_revocations"
FROM PUBLIC, "omnitwin_api_activation", "omnitwin_historical_evidence_verifier",
  "omnitwin_historical_auth_gateway";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "runtime_execution_key_policy_revocations"
FROM PUBLIC, "omnitwin_api_activation", "omnitwin_historical_evidence_verifier",
  "omnitwin_historical_auth_gateway";

GRANT SELECT, INSERT, UPDATE ON TABLE
  "hr_authenticated_action_assertions", "hr_action_authority_snapshots",
  "hr_authenticated_action_assertion_uses", "hr_revocation_actions",
  "hr_scope_epoch_revocations", "hr_provider_capability_revocations",
  "hr_signing_key_authority_revocations", "hr_role_attestation_revocations",
  "hr_evidence_record_revocations"
TO "omnitwin_historical_evidence_owner";

CREATE TRIGGER "a_hr_require_revocation_action_owner"
  BEFORE INSERT ON "hr_revocation_actions"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a0_hr_require_scope_revocation_owner"
  BEFORE INSERT ON "hr_scope_epoch_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a0_hr_require_provider_revocation_owner"
  BEFORE INSERT ON "hr_provider_capability_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a0_hr_require_signing_revocation_owner"
  BEFORE INSERT ON "hr_signing_key_authority_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a0_hr_require_role_revocation_owner"
  BEFORE INSERT ON "hr_role_attestation_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();
CREATE TRIGGER "a0_hr_require_record_revocation_owner"
  BEFORE INSERT ON "hr_evidence_record_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_owner"();

CREATE OR REPLACE FUNCTION "hr_lock_scope_epoch_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  epoch_row "hr_scope_epochs"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT epoch_row FROM "hr_scope_epochs"
  WHERE "id" = NEW."epoch_id";
  PERFORM "hr_lock_scope"(
    epoch_row."environment_id", epoch_row."venue_id", epoch_row."space_id"
  );
  SELECT action."revoked_at" INTO STRICT NEW."created_at"
  FROM "hr_revocation_actions" AS action
  WHERE action."id" = NEW."revocation_action_id";
  NEW."revoked_at" := NEW."created_at";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_scope_epoch_revocation"
  BEFORE INSERT ON "hr_scope_epoch_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_scope_epoch_revocation"();

CREATE OR REPLACE FUNCTION "hr_lock_provider_capability_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  cap_row "hr_provider_capabilities"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT cap_row FROM "hr_provider_capabilities"
  WHERE "id" = NEW."capability_id";
  PERFORM "hr_lock_scope"(
    cap_row."environment_id", cap_row."venue_id", cap_row."space_id"
  );
  PERFORM "hr_lock_authority"('provider-capability', cap_row."id"::text);
  SELECT action."revoked_at" INTO STRICT NEW."created_at"
  FROM "hr_revocation_actions" AS action
  WHERE action."id" = NEW."revocation_action_id";
  NEW."revoked_at" := NEW."created_at";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_provider_capability_revocation"
  BEFORE INSERT ON "hr_provider_capability_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_provider_capability_revocation"();

CREATE OR REPLACE FUNCTION "hr_lock_legacy_key_policy_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM "hr_lock_authority"('key-policy', NEW."policy_id"::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_legacy_key_policy_revocation"
  BEFORE INSERT ON "runtime_execution_key_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_legacy_key_policy_revocation"();

CREATE OR REPLACE FUNCTION "hr_lock_signing_key_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  key_row "hr_signing_key_authorities"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT key_row FROM "hr_signing_key_authorities"
  WHERE "id" = NEW."signing_key_authority_id";
  PERFORM "hr_lock_scope"(
    key_row."environment_id", key_row."venue_id", key_row."space_id"
  );
  PERFORM "hr_lock_authority"('key-policy', key_row."key_policy_id"::text);
  PERFORM "hr_lock_authority"('key-authority', key_row."id"::text);
  SELECT action."revoked_at" INTO STRICT NEW."created_at"
  FROM "hr_revocation_actions" AS action
  WHERE action."id" = NEW."revocation_action_id";
  NEW."revoked_at" := NEW."created_at";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_signing_key_revocation"
  BEFORE INSERT ON "hr_signing_key_authority_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_signing_key_revocation"();

CREATE OR REPLACE FUNCTION "hr_lock_role_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  role_row "hr_role_attestations"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT role_row FROM "hr_role_attestations"
  WHERE "id" = NEW."attestation_id";
  PERFORM "hr_lock_scope"(
    role_row."environment_id", role_row."venue_id", role_row."space_id"
  );
  PERFORM "hr_lock_authority"('role-attestation', role_row."id"::text);
  SELECT action."revoked_at" INTO STRICT NEW."created_at"
  FROM "hr_revocation_actions" AS action
  WHERE action."id" = NEW."revocation_action_id";
  NEW."revoked_at" := NEW."created_at";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_role_revocation"
  BEFORE INSERT ON "hr_role_attestation_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_role_revocation"();

CREATE OR REPLACE FUNCTION "hr_lock_record_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  record_row "hr_evidence_records"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT record_row FROM "hr_evidence_records"
  WHERE "id" = NEW."record_id";
  PERFORM "hr_lock_scope"(
    record_row."environment_id", record_row."venue_id", record_row."space_id"
  );
  PERFORM "hr_lock_authority"('evidence-record', record_row."id"::text);
  SELECT action."revoked_at" INTO STRICT NEW."created_at"
  FROM "hr_revocation_actions" AS action
  WHERE action."id" = NEW."revocation_action_id";
  NEW."revoked_at" := NEW."created_at";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_record_revocation"
  BEFORE INSERT ON "hr_evidence_record_revocations"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_record_revocation"();


CREATE OR REPLACE FUNCTION "hr_lock_reconstruction_release_review"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM "hr_lock_authority"(
    'reconstruction-release', NEW."release_id"::text
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "a_hr_lock_reconstruction_release_review"
  BEFORE INSERT ON "reconstruction_release_reviews"
  FOR EACH ROW EXECUTE FUNCTION "hr_lock_reconstruction_release_review"();

CREATE OR REPLACE FUNCTION "hr_assert_source_receipt_set_complete"(
  p_source_set_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_set "hr_source_receipt_sets"%ROWTYPE;
  actual_count bigint;
  minimum_index integer;
  maximum_index integer;
  actual_total_bytes bigint;
  raw_capture_count bigint;
  processed_member_count bigint;
  root_role text;
  members_body jsonb;
  material_body jsonb;
  expected_digest text;
BEGIN
  PERFORM "hr_lock_authority"('source-set', p_source_set_id::text);
  SELECT * INTO STRICT source_set
  FROM "hr_source_receipt_sets"
  WHERE "id" = p_source_set_id
  FOR SHARE;

  SELECT count(*), min(member."component_index"),
    max(member."component_index"), COALESCE(sum(member."size_bytes"), 0),
    count(*) FILTER (WHERE member."role" = 'raw_capture'),
    count(*) FILTER (WHERE member."role" = 'processed_package_member'),
    max(member."role") FILTER (
      WHERE member."component_index" = source_set."root_component_index"
    ),
    jsonb_agg(jsonb_build_object(
      'componentIndex', member."component_index",
      'receipt', receipt."receipt_body",
      'relativePath', member."relative_path",
      'role', member."role"
    ) ORDER BY member."component_index")
  INTO actual_count, minimum_index, maximum_index, actual_total_bytes,
    raw_capture_count, processed_member_count, root_role, members_body
  FROM "hr_source_receipt_members" AS member
  JOIN "hr_object_receipts" AS receipt
    ON receipt."id" = member."receipt_id"
  WHERE member."source_set_id" = p_source_set_id;

  IF actual_count <> source_set."member_count"
     OR minimum_index IS DISTINCT FROM 0
     OR maximum_index IS DISTINCT FROM source_set."member_count" - 1
     OR actual_total_bytes <> source_set."total_bytes"
     OR root_role IS NULL THEN
    RAISE EXCEPTION 'Source receipt set is incomplete, non-dense, or has wrong totals'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_source_receipt_set_complete';
  END IF;
  IF (source_set."lineage_start_kind" = 'raw_capture_object' AND (
        source_set."ancestor_state" <> 'exact_private_receipt'
        OR raw_capture_count <> 1 OR root_role <> 'raw_capture'
      )) OR (
        source_set."lineage_start_kind" = 'direct_camera_capture_bundle'
        AND (
          source_set."ancestor_state" <> 'exact_private_receipt'
          OR raw_capture_count < 1 OR root_role <> 'raw_capture'
        )
      ) OR (
        source_set."lineage_start_kind" = 'processed_capture_package'
        AND root_role NOT IN ('inventory_manifest', 'processed_package_archive')
      ) OR (
        source_set."lineage_start_kind" = 'processed_capture_package'
        AND root_role = 'inventory_manifest' AND processed_member_count = 0
      ) THEN
    RAISE EXCEPTION 'Source receipt root contradicts its lineage start kind'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_source_receipt_root_role';
  END IF;

  material_body := jsonb_build_object(
    'ancestorState', source_set."ancestor_state",
    'lineageStartKind', source_set."lineage_start_kind",
    'members', members_body,
    'receiptSetId', source_set."id"::text,
    'rootComponentIndex', source_set."root_component_index",
    'schemaVersion', 'historical-runtime-source-receipt-set.v1',
    'unavailableAncestorAttestationDigest',
      source_set."unavailable_attestation_digest",
    'unavailableAncestorAttestationId',
      source_set."unavailable_attestation_id"::text
  );
  expected_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-source-receipt-set.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  IF source_set."receipt_set_digest" IS DISTINCT FROM expected_digest
     OR source_set."receipt_set_body" IS DISTINCT FROM
       material_body || jsonb_build_object('receiptSetDigest', expected_digest)
  THEN
    RAISE EXCEPTION 'Source receipt set body or digest is substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_source_receipt_set_exact_body';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_source_receipt_set_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_body jsonb := to_jsonb(NEW);
  source_set_id uuid;
BEGIN
  source_set_id := COALESCE(
    (row_body->>'source_set_id')::uuid,
    (row_body->>'id')::uuid
  );
  PERFORM "hr_assert_source_receipt_set_complete"(source_set_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_source_set_graph_complete"
  AFTER INSERT ON "hr_source_receipt_sets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_source_receipt_set_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_source_member_graph_complete"
  AFTER INSERT ON "hr_source_receipt_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_source_receipt_set_deferred_guard"();

CREATE OR REPLACE FUNCTION "hr_assert_normalized_content_complete"(
  p_normalization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  identity "hr_normalized_content_identities"%ROWTYPE;
  inventory_count bigint;
  inventory_min integer;
  inventory_max integer;
  inventory_members jsonb;
  expected_inventory_digest text;
  identity_body jsonb;
  expected_identity_digest text;
BEGIN
  PERFORM "hr_lock_authority"('normalization', p_normalization_id::text);
  SELECT * INTO STRICT identity
  FROM "hr_normalized_content_identities"
  WHERE "id" = p_normalization_id
  FOR SHARE;

  SELECT count(*), min(member."component_index"),
    max(member."component_index"),
    jsonb_agg(jsonb_build_object(
      'componentIndex', member."component_index",
      'relativePath', member."relative_path",
      'role', member."role",
      'sha256', member."sha256",
      'sizeBytes', member."size_bytes"
    ) ORDER BY member."component_index")
  INTO inventory_count, inventory_min, inventory_max, inventory_members
  FROM "hr_normalized_inventory_members" AS member
  WHERE member."normalization_id" = p_normalization_id;

  IF identity."normalization_spec" = 'ordered-object-inventory.v1' THEN
    IF inventory_count <> identity."inventory_object_count"
       OR inventory_count <> identity."source_member_count"
       OR inventory_min IS DISTINCT FROM 0
       OR inventory_max IS DISTINCT FROM identity."inventory_object_count" - 1
    THEN
      RAISE EXCEPTION 'Normalized inventory is incomplete or non-dense'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_normalized_inventory_complete';
    END IF;
    expected_inventory_digest := encode(digest(convert_to(
      E'venviewer.historical-runtime-normalized-inventory-members.v1\n'
        || "hr_stable_canonical_json"(inventory_members), 'UTF8'
    ), 'sha256'), 'hex');
    IF identity."inventory_members_digest" IS DISTINCT FROM
         expected_inventory_digest THEN
      RAISE EXCEPTION 'Normalized inventory member digest differs from rows'
        USING ERRCODE = '23514',
              CONSTRAINT = 'hr_normalized_inventory_digest';
    END IF;
  ELSIF inventory_count <> 0 THEN
    RAISE EXCEPTION 'Non-inventory normalization must not have inventory rows'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_normalized_inventory_forbidden';
  END IF;

  identity_body := jsonb_build_object(
    'conformanceTestVectorSetDigest', identity."test_vector_set_digest",
    'decoderBinarySha256', identity."decoder_binary_sha256",
    'decoderName', identity."decoder_name",
    'decoderVersion', identity."decoder_version",
    'normalizationProfileVersion', identity."normalization_profile_version",
    'normalizationSpec', identity."normalization_spec",
    'normalizedSha256', identity."normalized_sha256",
    'normalizedSizeBytes', identity."normalized_size_bytes"
  ) || CASE identity."normalization_spec"
    WHEN 'raw-bytes-exact.v1' THEN jsonb_build_object(
      'exactBinaryReason',
        'no-approved-deterministic-decoder-use-exact-versioned-bytes',
      'formatTag', identity."format_tag"
    )
    WHEN 'ordered-object-inventory.v1' THEN jsonb_build_object(
      'inventoryByteLength', identity."inventory_byte_length",
      'inventoryEncoding', 'utf8-sha256-size-role-path-lines-v1',
      'inventoryMembers', inventory_members,
      'inventoryMembersDigest', expected_inventory_digest,
      'objectCount', identity."inventory_object_count",
      'orderingRule', 'component-index-ascending'
    )
    WHEN 'panorama-rgb8-srgb-top-left.v1' THEN jsonb_build_object(
      'alphaRule', 'reject-non-opaque-alpha',
      'colourRule',
        'embedded-icc-to-srgb-relative-colorimetric-or-assume-srgb',
      'frameByteLength', identity."frame_byte_length",
      'heightPixels', identity."height_pixels",
      'orientationRule', 'apply-exif-1-to-8-then-top-left',
      'rowStrideBytes', identity."row_stride_bytes",
      'widthPixels', identity."width_pixels"
    )
    WHEN 'video-frame-sequence-rgb8-srgb-top-left.v1' THEN
      jsonb_build_object(
        'alphaRule', 'reject-non-opaque-alpha',
        'colourRule',
          'embedded-icc-to-srgb-relative-colorimetric-or-assume-srgb',
        'frameByteLength', identity."frame_byte_length",
        'frameCount', identity."frame_count",
        'frameOrder', 'presentation-timestamp-then-decode-index',
        'heightPixels', identity."height_pixels",
        'orientationRule', 'container-display-matrix-then-top-left',
        'rowStrideBytes', identity."row_stride_bytes",
        'widthPixels', identity."width_pixels"
      )
    WHEN 'e57-cartesian-points-f64.v1' THEN jsonb_build_object(
      'invalidPointPolicy',
        'reject-non-finite-drop-explicit-invalid-state',
      'pointCount', identity."point_count",
      'recordLayout', 'xyz-f64-little-endian-valid-points-only',
      'recordStrideBytes', identity."record_stride_bytes",
      'scanCount', identity."scan_count"
    )
    WHEN 'ply-binary-little-endian-records.v1' THEN jsonb_build_object(
      'headerSha256', identity."header_sha256",
      'headerSizeBytes', identity."header_size_bytes",
      'propertyLayoutDigest', identity."property_layout_digest",
      'recordCount', identity."record_count",
      'recordOrder', 'file-order',
      'recordStrideBytes', identity."record_stride_bytes"
    )
    WHEN 'obj-indexed-geometry-f64.v1' THEN jsonb_build_object(
      'indexCount', identity."index_count",
      'indexRecordStrideBytes', identity."index_record_stride_bytes",
      'numericEncoding', 'ieee754-f64-little-endian',
      'topology', identity."topology",
      'vertexCount', identity."vertex_count",
      'vertexRecordStrideBytes', identity."vertex_record_stride_bytes"
    )
    ELSE '{}'::jsonb
  END;
  expected_identity_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-normalized-content-identity.v1\n'
      || "hr_stable_canonical_json"(identity_body), 'UTF8'
  ), 'sha256'), 'hex');
  IF identity."normalization_digest" IS DISTINCT FROM expected_identity_digest
     OR identity."normalization_body" IS DISTINCT FROM identity_body THEN
    RAISE EXCEPTION 'Normalized content body or digest is substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_normalized_content_exact_body';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_normalized_content_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_body jsonb := to_jsonb(NEW);
  normalization_id uuid;
BEGIN
  normalization_id := COALESCE(
    (row_body->>'normalization_id')::uuid,
    (row_body->>'id')::uuid
  );
  PERFORM "hr_assert_normalized_content_complete"(normalization_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_normalized_content_graph_complete"
  AFTER INSERT ON "hr_normalized_content_identities"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_normalized_content_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_normalized_inventory_graph_complete"
  AFTER INSERT ON "hr_normalized_inventory_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_normalized_content_deferred_guard"();

CREATE OR REPLACE FUNCTION "hr_assert_derivation_graph_complete"(
  p_derivation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  derivation "hr_derivations"%ROWTYPE;
  actual_count bigint;
  minimum_index integer;
  maximum_index integer;
  actual_total_bytes bigint;
  minimum_receipt_expiry timestamptz;
  members_body jsonb;
  expected_members_digest text;
  recipe_body jsonb;
  expected_recipe_digest text;
  material_body jsonb;
  expected_derivation_digest text;
BEGIN
  PERFORM "hr_lock_authority"('derivation', p_derivation_id::text);
  SELECT * INTO STRICT derivation
  FROM "hr_derivations"
  WHERE "id" = p_derivation_id
  FOR SHARE;

  SELECT count(*), min(member."member_index"), max(member."member_index"),
    COALESCE(sum(member."size_bytes"), 0), min(member."receipt_expires_at"),
    jsonb_agg(jsonb_build_object(
      'assetVersionId', member."asset_version_id"::text,
      'fileExt', member."file_ext",
      'fileName', member."file_name",
      'memberIndex', member."member_index",
      'mimeType', member."mime_type",
      'outputReceipt', receipt."receipt_body",
      'sha256', member."sha256",
      'sizeBytes', member."size_bytes"
    ) ORDER BY member."member_index")
  INTO actual_count, minimum_index, maximum_index, actual_total_bytes,
    minimum_receipt_expiry, members_body
  FROM "hr_derivation_members" AS member
  JOIN "hr_object_receipts" AS receipt
    ON receipt."id" = member."output_receipt_id"
  WHERE member."derivation_id" = p_derivation_id;

  IF actual_count <> derivation."member_count"
     OR minimum_index IS DISTINCT FROM 0
     OR maximum_index IS DISTINCT FROM derivation."member_count" - 1
     OR actual_total_bytes <> derivation."total_bytes"
     OR minimum_receipt_expiry IS DISTINCT FROM
       derivation."minimum_output_receipt_expires_at"
     OR derivation."expires_at" IS DISTINCT FROM LEAST(
       derivation."capture_clearance_expires_at",
       derivation."producer_expires_at", derivation."custodian_expires_at",
       derivation."reviewer_expires_at", minimum_receipt_expiry
     ) THEN
    RAISE EXCEPTION 'Derivation members are incomplete, non-dense, or wrong total'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_members_complete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "hr_derivation_members" AS member
    JOIN "hr_object_receipts" AS receipt
      ON receipt."id" = member."output_receipt_id"
    WHERE member."derivation_id" = p_derivation_id
      AND member."member_body" IS DISTINCT FROM jsonb_build_object(
        'assetVersionId', member."asset_version_id"::text,
        'fileExt', member."file_ext",
        'fileName', member."file_name",
        'memberIndex', member."member_index",
        'mimeType', member."mime_type",
        'outputReceipt', receipt."receipt_body",
        'sha256', member."sha256",
        'sizeBytes', member."size_bytes"
      )
  ) THEN
    RAISE EXCEPTION 'Derivation member body substitutes its exact receipt'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_member_exact_body';
  END IF;

  expected_members_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-members.v1\n'
      || "hr_stable_canonical_json"(members_body), 'UTF8'
  ), 'sha256'), 'hex');
  recipe_body := jsonb_build_object(
    'conversionBinarySha256', derivation."conversion_binary_sha256",
    'conversionCommandSha256', derivation."conversion_command_sha256",
    'conversionEnvironmentDigest',
      derivation."conversion_environment_digest",
    'conversionParametersDigest', derivation."conversion_parameters_digest",
    'conversionTool', derivation."conversion_tool",
    'conversionVersion', derivation."conversion_version"
  );
  expected_recipe_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-conversion-recipe.v1\n'
      || "hr_stable_canonical_json"(recipe_body), 'UTF8'
  ), 'sha256'), 'hex');
  material_body := jsonb_build_object(
    'captureClearanceDigest', derivation."capture_clearance_digest",
    'captureClearanceId', derivation."capture_clearance_id"::text,
    'captureRootEvidenceDigest', derivation."capture_root_evidence_digest",
    'captureRootId', derivation."capture_root_id"::text,
    'conversionBinarySha256', derivation."conversion_binary_sha256",
    'conversionCommandSha256', derivation."conversion_command_sha256",
    'conversionEnvironmentDigest',
      derivation."conversion_environment_digest",
    'conversionParametersDigest', derivation."conversion_parameters_digest",
    'conversionRecipeDigest', expected_recipe_digest,
    'conversionTool', derivation."conversion_tool",
    'conversionVersion', derivation."conversion_version",
    'custodianAttestationDigest', derivation."custodian_attestation_digest",
    'custodianAttestationId', derivation."custodian_attestation_id"::text,
    'derivationId', derivation."id"::text,
    'inputNormalizedContentDigest',
      derivation."input_normalized_content_digest",
    'memberCount', derivation."member_count",
    'members', members_body,
    'membersDigest', expected_members_digest,
    'producerAttestationDigest', derivation."producer_attestation_digest",
    'producerAttestationId', derivation."producer_attestation_id"::text,
    'registeredAt', "hr_iso_utc_ms"(derivation."created_at"),
    'reviewerAttestationDigest', derivation."reviewer_attestation_digest",
    'reviewerAttestationId', derivation."reviewer_attestation_id"::text,
    'schemaVersion', 'historical-runtime-derivation-evidence.v1',
    'spaceId', derivation."space_id"::text,
    'totalBytes', derivation."total_bytes",
    'venueId', derivation."venue_id"::text
  );
  expected_derivation_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-evidence.v1\n'
      || "hr_stable_canonical_json"(material_body), 'UTF8'
  ), 'sha256'), 'hex');
  IF derivation."members_digest" IS DISTINCT FROM expected_members_digest
     OR derivation."conversion_recipe_digest" IS DISTINCT FROM
       expected_recipe_digest
     OR derivation."derivation_evidence_digest" IS DISTINCT FROM
       expected_derivation_digest
     OR derivation."derivation_body" IS DISTINCT FROM material_body
       || jsonb_build_object(
         'derivationEvidenceDigest', expected_derivation_digest
       ) THEN
    RAISE EXCEPTION 'Derivation body, recipe, or aggregate digest is substituted'
      USING ERRCODE = '23514',
            CONSTRAINT = 'hr_derivation_exact_body';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "hr_derivation_graph_deferred_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_body jsonb := to_jsonb(NEW);
  derivation_id uuid;
BEGIN
  derivation_id := COALESCE(
    (row_body->>'derivation_id')::uuid,
    (row_body->>'id')::uuid
  );
  PERFORM "hr_assert_derivation_graph_complete"(derivation_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "hr_derivation_graph_complete"
  AFTER INSERT ON "hr_derivations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_derivation_graph_deferred_guard"();
CREATE CONSTRAINT TRIGGER "hr_derivation_member_graph_complete"
  AFTER INSERT ON "hr_derivation_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "hr_derivation_graph_deferred_guard"();


CREATE OR REPLACE FUNCTION "hr_assert_test_twin_release_current"(
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  twin_row "hr_twin_release_authorities"%ROWTYPE;
  latest_review "reconstruction_release_reviews"%ROWTYPE;
  authority_snapshot "hr_authority_snapshots"%ROWTYPE;
BEGIN
  PERFORM "hr_assert_evidence_record_current"(
    p_authority_id, 'twin_release_authority', p_environment_id,
    p_environment_mode, p_environment_digest, p_venue_id, p_space_id,
    p_action_at
  );
  SELECT * INTO STRICT twin_row
  FROM "hr_twin_release_authorities"
  WHERE "id" = p_authority_id
  FOR SHARE;
  IF p_environment_mode <> 'test' OR twin_row."environment_mode" <> 'test' THEN
    RAISE EXCEPTION 'legacy twin release authority is test-only'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_legacy_twin_production_forbidden';
  END IF;
  PERFORM "hr_lock_authority"(
    'reconstruction-release', twin_row."release_id"::text
  );
  SELECT * INTO latest_review
  FROM "reconstruction_release_reviews"
  WHERE "release_id" = twin_row."release_id"
  ORDER BY "review_sequence" DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND
     OR latest_review."id" IS DISTINCT FROM twin_row."release_review_id"
     OR latest_review."review_sequence" IS DISTINCT FROM
        twin_row."release_review_sequence"
     OR latest_review."request_digest" IS DISTINCT FROM
        twin_row."release_review_digest"
     OR latest_review."reviewer_user_id" IS DISTINCT FROM
        twin_row."release_reviewer_actor_id"
     OR latest_review."reviewer_authority" IS DISTINCT FROM
        twin_row."release_reviewer_authority"
     OR latest_review."target_exposure" IS DISTINCT FROM
        twin_row."release_target_exposure"
     OR date_trunc('milliseconds', latest_review."reviewed_at") IS DISTINCT FROM
        date_trunc('milliseconds', twin_row."release_reviewed_at")
     OR latest_review."decision" <> 'approved' THEN
    RAISE EXCEPTION 'legacy twin release approval was superseded or substituted'
      USING ERRCODE = '55000',
            CONSTRAINT = 'hr_twin_release_latest_review';
  END IF;
  SELECT * INTO STRICT authority_snapshot
  FROM "hr_authority_snapshots"
  WHERE "id" = twin_row."authority_snapshot_id"
  FOR SHARE;
  IF authority_snapshot."platform_role" <> 'admin'
     OR authority_snapshot."actor_id" IS DISTINCT FROM
        twin_row."approved_by_actor_id"
     OR authority_snapshot."authority_digest" IS DISTINCT FROM
        twin_row."authority_digest" THEN
    RAISE EXCEPTION 'legacy twin wrapper approver lacks exact platform-admin authority'
      USING ERRCODE = '42501',
            CONSTRAINT = 'hr_twin_release_approver_authority';
  END IF;
  PERFORM "hr_assert_role_snapshot_current"(
    twin_row."authority_snapshot_id", 'scene_reviewer', p_action_at
  );
END;
$$;


-- Every 0065 authority row is append-only. DB time is written for every
-- insert even when a caller supplies created_at, and post-commit body/member
-- substitution, deletion, or TRUNCATE is rejected by table triggers. This
-- intentionally covers normalized child rows as well as final receipts.
CREATE OR REPLACE FUNCTION "hr_reject_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'historical-runtime evidence is append-only'
    USING ERRCODE = '55000',
          CONSTRAINT = 'hr_evidence_append_only';
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT relation.relname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND left(relation.relname, 3) = 'hr_'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'created_at'
          AND NOT attribute.attisdropped
      )
    ORDER BY relation.relname COLLATE "C"
  LOOP
    -- The only INSERT path for the generic parent is the evidence-owner
    -- hr_insert_evidence_record() function. It deliberately reuses the typed
    -- leaf's already sampled DB action instant; independently resampling here
    -- would make the deferred exact-leaf equality impossible.
    IF target_table NOT IN (
      'hr_evidence_records',
      'hr_authenticated_action_assertions',
      'hr_action_authority_snapshots',
      'hr_authenticated_action_assertion_uses',
      'hr_revocation_actions',
      'hr_scope_epoch_revocations',
      'hr_provider_capability_revocations',
      'hr_signing_key_authority_revocations',
      'hr_role_attestation_revocations',
      'hr_evidence_record_revocations'
    ) THEN
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER a00_hr_force_db_created_at '
          || 'BEFORE INSERT ON public.%I FOR EACH ROW '
          || 'EXECUTE FUNCTION public.hr_force_db_created_at()',
        target_table
      );
    END IF;
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


-- Provider/object/key evidence and all accepted signatures are produced only
CREATE TRIGGER "a_hr_require_provider_capability_verifier"
  BEFORE INSERT ON "hr_provider_capabilities"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_environment_verifier"
  BEFORE INSERT ON "hr_evidence_environments"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_scope_epoch_verifier"
  BEFORE INSERT ON "hr_scope_epochs"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_evidence_subject_verifier"
  BEFORE INSERT ON "hr_evidence_subjects"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_object_receipt_verifier"
  BEFORE INSERT ON "hr_object_receipts"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_signing_key_verifier"
  BEFORE INSERT ON "hr_signing_key_authorities"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_capture_clearance_verifier"
  BEFORE INSERT ON "hr_capture_clearances"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_derivation_verifier"
  BEFORE INSERT ON "hr_derivations"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_derivation_member_verifier"
  BEFORE INSERT ON "hr_derivation_members"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_transform_review_verifier"
  BEFORE INSERT ON "hr_transform_reviews"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_rights_clearance_verifier"
  BEFORE INSERT ON "hr_rights_clearances"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();
CREATE TRIGGER "a_hr_require_test_twin_verifier"
  BEFORE INSERT ON "hr_twin_release_authorities"
  FOR EACH ROW EXECUTE FUNCTION "hr_require_evidence_verifier"();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_evidence_environments", "hr_scope_epochs", "hr_evidence_subjects",
  "hr_authority_lock_rows",
  "hr_authority_snapshots", "hr_role_attestation_drafts",
  "hr_source_receipt_sets", "hr_source_receipt_members",
  "hr_normalized_content_identities", "hr_normalized_inventory_members",
  "hr_capture_content_subjects", "hr_capture_content_drafts",
  "hr_provider_capabilities", "hr_object_receipts",
  "hr_signing_key_authorities", "hr_role_attestations",
  "hr_capture_roots", "hr_capture_clearances", "hr_derivations",
  "hr_derivation_members", "hr_transform_reviews",
  "hr_rights_clearances", "hr_twin_release_authorities",
  "hr_evidence_records"
FROM PUBLIC, "omnitwin_api_activation";
REVOKE ALL ON TABLE "hr_authority_lock_rows"
FROM PUBLIC, "omnitwin_api_activation",
  "omnitwin_historical_evidence_verifier",
  "omnitwin_historical_auth_gateway";

GRANT USAGE ON SCHEMA public TO "omnitwin_historical_evidence_owner";
GRANT SELECT ON TABLE
  "users", "workspaces", "workspace_memberships", "venues", "spaces",
  "reconstruction_release_reviews", "reconstruction_releases",
  "reconstruction_release_attestations", "runtime_execution_key_policies",
  "runtime_execution_key_policy_revocations", "hr_evidence_environments",
  "hr_scope_epochs", "hr_scope_epoch_revocations", "hr_authority_lock_rows",
  "hr_provider_capabilities", "hr_provider_capability_revocations",
  "hr_object_receipts", "hr_evidence_subjects", "hr_authority_snapshots",
  "hr_signing_key_authorities", "hr_signing_key_authority_revocations",
  "hr_role_attestation_drafts", "hr_role_attestations",
  "hr_role_attestation_revocations", "hr_source_receipt_sets",
  "hr_source_receipt_members", "hr_normalized_content_identities",
  "hr_normalized_inventory_members", "hr_evidence_records",
  "hr_evidence_record_revocations", "hr_capture_content_subjects",
  "hr_capture_content_drafts", "hr_capture_roots",
  "hr_capture_clearances", "hr_derivations", "hr_derivation_members",
  "hr_transform_reviews", "hr_rights_clearances",
  "hr_twin_release_authorities"
TO "omnitwin_historical_evidence_owner";
GRANT INSERT ON TABLE "hr_authority_lock_rows"
TO "omnitwin_historical_evidence_owner";
GRANT UPDATE ("lock_namespace") ON TABLE "hr_authority_lock_rows"
TO "omnitwin_historical_evidence_owner";
-- FOR SHARE needs UPDATE privilege, but the owner must never be able to alter
-- live roles, memberships, legacy releases, or key-policy material. Grant only
-- each mutable source's identity column; all hr_* rows are separately blocked
-- by the append-only mutation triggers below.
GRANT UPDATE ("id") ON TABLE
  "users", "workspaces", "workspace_memberships", "venues", "spaces",
  "reconstruction_release_reviews", "reconstruction_releases",
  "reconstruction_release_attestations", "runtime_execution_key_policies"
TO "omnitwin_historical_evidence_owner";
GRANT UPDATE ("policy_id") ON TABLE
  "runtime_execution_key_policy_revocations"
TO "omnitwin_historical_evidence_owner";
GRANT UPDATE ON TABLE
  "hr_evidence_environments", "hr_scope_epochs", "hr_scope_epoch_revocations",
  "hr_provider_capabilities", "hr_provider_capability_revocations",
  "hr_object_receipts", "hr_evidence_subjects", "hr_authority_snapshots",
  "hr_signing_key_authorities", "hr_signing_key_authority_revocations",
  "hr_role_attestation_drafts", "hr_role_attestations",
  "hr_role_attestation_revocations", "hr_source_receipt_sets",
  "hr_source_receipt_members", "hr_normalized_content_identities",
  "hr_normalized_inventory_members", "hr_evidence_records",
  "hr_evidence_record_revocations", "hr_capture_content_subjects",
  "hr_capture_content_drafts", "hr_capture_roots",
  "hr_capture_clearances", "hr_derivations", "hr_derivation_members",
  "hr_transform_reviews", "hr_rights_clearances",
  "hr_twin_release_authorities"
TO "omnitwin_historical_evidence_owner";
GRANT INSERT ON TABLE "hr_evidence_records"
TO "omnitwin_historical_evidence_owner";

GRANT EXECUTE ON FUNCTION "hr_assert_source_receipt_set_complete"(uuid)
TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_normalized_content_complete"(uuid)
TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_derivation_graph_complete"(uuid)
TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_capture_source_current"(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid,
  timestamptz
) TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_capture_root_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_capture_clearance_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) TO "omnitwin_historical_evidence_owner";
GRANT EXECUTE ON FUNCTION "hr_assert_derivation_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) TO "omnitwin_historical_evidence_owner";

REVOKE ALL ON FUNCTION
  "hr_lock_authority"(text, text),
  "hr_lock_scope"(uuid, uuid, uuid),
  "hr_lock_scope_epoch_revocation"(),
  "hr_lock_provider_capability_revocation"(),
  "hr_lock_legacy_key_policy_revocation"(),
  "hr_lock_signing_key_revocation"(),
  "hr_lock_role_revocation"(),
  "hr_lock_record_revocation"(),
  "hr_lock_reconstruction_release_review"(),
  "hr_issue_authority_snapshot"(),
  "hr_issue_role_attestation_draft"(),
  "hr_accept_role_attestation"(),
  "hr_prepare_capture_content_subject"(),
  "hr_issue_capture_content_draft"(),
  "hr_accept_capture_root"(),
  "hr_issue_evidence_environment"(),
  "hr_issue_scope_epoch"(),
  "hr_issue_evidence_subject"(),
  "hr_issue_provider_capability"(),
  "hr_build_object_actor_authority"(
    uuid, uuid, text, uuid, text, uuid, uuid, timestamptz
  ),
  "hr_issue_object_receipt"(),
  "hr_issue_signing_key_authority"(),
  "hr_issue_capture_clearance"(),
  "hr_issue_derivation"(),
  "hr_issue_transform_review"(),
  "hr_issue_rights_clearance"(),
  "hr_issue_test_twin_release_authority"(),
  "hr_assert_test_twin_release_current"(
    uuid, uuid, text, text, uuid, uuid, timestamptz
  ),
  "hr_assert_evidence_record_leaf_exact"(uuid),
  "hr_insert_evidence_record"(
    uuid, text, uuid, text, uuid, text, text, uuid, uuid, uuid, text,
    timestamptz, timestamptz, timestamptz
  ),
  "hr_evidence_record_leaf_deferred_guard"(),
  "hr_source_receipt_set_deferred_guard"(),
  "hr_normalized_content_deferred_guard"(),
  "hr_derivation_graph_deferred_guard"()
FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_source_receipt_set_complete"(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_normalized_content_complete"(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_derivation_graph_complete"(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_capture_source_current"(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_capture_root_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_capture_clearance_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "hr_assert_derivation_current"(
  uuid, uuid, text, text, uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO "omnitwin_historical_evidence_verifier";
-- Direct verifier staging evaluates DB-owned timestamp defaults and canonical
-- CHECK expressions before/after SECURITY DEFINER issuers run. Expose only
-- these pure construction helpers; lock/currentness and mutation helpers stay
-- private to the evidence owner.
GRANT EXECUTE ON FUNCTION
  "hr_db_clock_ms"(),
  "hr_wall_clock_ms"(),
  "hr_stable_canonical_json"(jsonb),
  "hr_role_evidence_document"(jsonb, text)
TO "omnitwin_historical_evidence_verifier";
GRANT SELECT ON TABLE
  "users", "workspaces", "workspace_memberships", "venues", "spaces",
  "runtime_execution_key_policies", "runtime_execution_key_policy_revocations",
  "hr_evidence_environments", "hr_scope_epochs", "hr_evidence_subjects",
  "hr_scope_epoch_revocations", "hr_provider_capabilities",
  "hr_provider_capability_revocations", "hr_object_receipts",
  "hr_authority_snapshots", "hr_signing_key_authorities",
  "hr_signing_key_authority_revocations", "hr_role_attestation_drafts",
  "hr_role_attestations", "hr_role_attestation_revocations",
  "hr_source_receipt_sets", "hr_source_receipt_members",
  "hr_normalized_content_identities", "hr_normalized_inventory_members",
  "hr_evidence_records", "hr_evidence_record_revocations",
  "hr_capture_content_subjects", "hr_capture_content_drafts",
  "hr_capture_roots", "hr_capture_clearances", "hr_derivations",
  "hr_derivation_members", "hr_transform_reviews", "hr_rights_clearances",
  "hr_twin_release_authorities"
TO "omnitwin_historical_evidence_verifier";
GRANT SELECT, INSERT ON TABLE
  "hr_evidence_environments", "hr_scope_epochs", "hr_evidence_subjects",
  -- These are pre-acceptance construction rows. They remain unavailable to
  -- the ordinary API principal, but the isolated verifier must be able to
  -- build the exact authority/draft/source graph that its accepted signature
  -- and byte-verification rows reference. Deferred graph guards and the
  -- SECURITY DEFINER BEFORE issuers still canonicalize/reject every row.
  "hr_authority_snapshots", "hr_role_attestation_drafts",
  "hr_source_receipt_sets", "hr_source_receipt_members",
  "hr_normalized_content_identities", "hr_normalized_inventory_members",
  "hr_capture_content_subjects", "hr_capture_content_drafts",
  "hr_provider_capabilities", "hr_object_receipts",
  "hr_signing_key_authorities", "hr_role_attestations", "hr_capture_roots",
  "hr_capture_clearances", "hr_derivations", "hr_derivation_members",
  "hr_transform_reviews", "hr_rights_clearances",
  "hr_twin_release_authorities"
TO "omnitwin_historical_evidence_verifier";
REVOKE INSERT ON TABLE "hr_evidence_records"
FROM "omnitwin_historical_evidence_verifier";
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  "hr_evidence_environments", "hr_scope_epochs", "hr_evidence_subjects",
  "hr_authority_snapshots", "hr_role_attestation_drafts",
  "hr_source_receipt_sets", "hr_source_receipt_members",
  "hr_normalized_content_identities", "hr_normalized_inventory_members",
  "hr_capture_content_subjects", "hr_capture_content_drafts",
  "hr_provider_capabilities", "hr_object_receipts",
  "hr_signing_key_authorities", "hr_role_attestations", "hr_capture_roots",
  "hr_capture_clearances", "hr_derivations", "hr_derivation_members",
  "hr_transform_reviews", "hr_rights_clearances",
  "hr_twin_release_authorities", "hr_evidence_records"
FROM "omnitwin_historical_evidence_verifier";

-- PostgreSQL requires each target owner to hold CREATE on the containing
-- schema while ownership is transferred. All ACL construction above still
-- ran under the migration owner; this tightly bracketed privilege exists only
-- for the following owner transfers and is removed by the final postflight.
GRANT CREATE ON SCHEMA public
TO "omnitwin_historical_schema_owner",
   "omnitwin_historical_evidence_owner";

-- Make the NOLOGIN schema owner the durable owner of every core authority
-- relation and invoker helper. SECURITY DEFINER entry points remain owned by
-- the distinct NOLOGIN evidence owner. The migrator is a separately
-- provisioned SET member of both solely for controlled schema evolution;
-- ordinary API/gateway/verifier credentials have no membership path.
DO $$
DECLARE
  target_relation record;
  target_function record;
BEGIN
  FOR target_relation IN
    SELECT relation.relname
    FROM pg_catalog.pg_class AS relation
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind IN ('r', 'p')
      AND relation.relname LIKE 'hr\_%' ESCAPE '\'
    ORDER BY relation.relname
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I OWNER TO %I', target_relation.relname,
      'omnitwin_historical_schema_owner'
    );
  END LOOP;

  FOR target_function IN
    SELECT procedure.proname,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS args,
           CASE WHEN procedure.prosecdef
             THEN 'omnitwin_historical_evidence_owner'
             ELSE 'omnitwin_historical_schema_owner'
           END AS target_owner
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = 'public'::regnamespace
      AND procedure.prokind = 'f'
      AND procedure.proname LIKE 'hr\_%' ESCAPE '\'
    ORDER BY procedure.proname, procedure.oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC',
      target_function.proname, target_function.args
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO %I',
      target_function.proname, target_function.args,
      'omnitwin_historical_evidence_owner'
    );
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION public.%I(%s) OWNER TO %I',
      target_function.proname, target_function.args,
      target_function.target_owner
    );
  END LOOP;
END;
$$;

REVOKE CREATE ON SCHEMA public
FROM "omnitwin_historical_schema_owner",
     "omnitwin_historical_evidence_owner";

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
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind IN ('r', 'p')
      AND relation.relname LIKE 'hr\_%' ESCAPE '\'
      AND relation.relowner <> schema_owner_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = 'public'::regnamespace
      AND procedure.prokind = 'f'
      AND procedure.proname LIKE 'hr\_%' ESCAPE '\'
      AND (
        (procedure.prosecdef
          AND procedure.proowner <> evidence_owner_oid)
        OR (NOT procedure.prosecdef
          AND procedure.proowner <> schema_owner_oid)
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = 'public'::regnamespace
      AND procedure.prokind = 'f'
      AND procedure.proname LIKE 'hr\_%' ESCAPE '\'
      AND pg_catalog.has_function_privilege(
        'public', procedure.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'historical evidence ownership transfer is incomplete'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.has_schema_privilege(
       'omnitwin_historical_evidence_owner', 'public', 'CREATE'
     ) OR pg_catalog.has_schema_privilege(
       'omnitwin_historical_schema_owner', 'public', 'CREATE'
     ) OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         (SELECT nspacl FROM pg_catalog.pg_namespace WHERE nspname = 'public'),
         pg_catalog.acldefault('n', schema_owner_oid)
       )) AS privilege
       WHERE privilege.grantee = 0 AND privilege.privilege_type = 'CREATE'
     ) THEN
    RAISE EXCEPTION 'public schema CREATE remained reachable after transfer'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
