-- -----------------------------------------------------------------------------
-- 0057_foundry_derivative_execution_candidates
--
-- Authenticated registry attestations and one-time, authority-none candidate
-- reservations for the exact singleton normalize_mesh_glb/v0 operation.
--
-- This migration intentionally has no connection to runtime-side or
-- output-side authority tables.  Every row remains execution-ineligible.  It
-- records evidence that a later atomic activation migration may activate only
-- after all runtime and output gates exist together.
-- -----------------------------------------------------------------------------

CREATE TABLE "foundry_derivative_rights_registry_attestations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "registry_authority" varchar(64) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "approval_id" varchar(120) NOT NULL
    REFERENCES "foundry_derivative_rights_approvals"("approval_id") ON DELETE RESTRICT,
  "derivative_rights_approval_sha256" varchar(71) NOT NULL,
  "review_id" uuid NOT NULL
    REFERENCES "foundry_derivative_rights_reviews_v1"("id") ON DELETE RESTRICT,
  "review_receipt_sha256" varchar(71) NOT NULL,
  "terms_custody_id" uuid NOT NULL
    REFERENCES "foundry_derivative_terms_evidence_custody_v1"("id") ON DELETE RESTRICT,
  "terms_custody_receipt_sha256" varchar(71) NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_generation" bigint NOT NULL,
  "job_subject_sha256" varchar(71) NOT NULL,
  "ingest_manifest_sha256" varchar(71) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "operation_id" varchar(96) NOT NULL,
  "derivative_class" varchar(120) NOT NULL,
  "asset_id" varchar(120) NOT NULL,
  "approval_expires_at" timestamptz NOT NULL,
  "registration_request_sha256" varchar(71) NOT NULL,
  "registration_request_json" jsonb NOT NULL,
  "registry_attestation_sha256" varchar(71) NOT NULL,
  "registry_attestation_json" jsonb NOT NULL,
  "attested_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(120) NOT NULL,
  "attested_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "foundry_derivative_registry_attestation_review_unique"
    UNIQUE("review_id"),
  CONSTRAINT "foundry_derivative_registry_attestation_approval_unique"
    UNIQUE("approval_id"),
  CONSTRAINT "foundry_derivative_registry_attestation_digest_unique"
    UNIQUE("registry_attestation_sha256"),
  CONSTRAINT "foundry_derivative_registry_attestation_exact_unique" UNIQUE(
    "id", "registry_attestation_sha256", "approval_id",
    "derivative_rights_approval_sha256", "review_id",
    "review_receipt_sha256", "terms_custody_id",
    "terms_custody_receipt_sha256"
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_actor_idem_unique"
    UNIQUE("attested_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_derivative_registry_attestation_inert" CHECK (
    "registry_authority" = 'authenticated_registry_attestation_v1'
    AND "execution_eligible" = false
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_operation" CHECK (
    "operation_id" = 'normalize_mesh_glb/v0'
    AND "derivative_class" = 'lossless_internal_format_normalization'
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_keys" CHECK (
    "approval_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "policy_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "stage_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "asset_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_uuid_shapes" CHECK (
    "id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "review_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "terms_custody_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "attested_by_user_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_digests" CHECK (
    "derivative_rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "review_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "terms_custody_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "registration_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "registry_attestation_sha256" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_generation" CHECK (
    "policy_generation" BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_times" CHECK (
    "attested_at" = date_trunc('milliseconds', "attested_at")
    AND "recorded_at" = "attested_at"
    AND "attested_at" < "approval_expires_at"
    AND "attested_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "approval_expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_registry_attestation_json" CHECK (
    jsonb_typeof("registration_request_json") = 'object'
    AND jsonb_typeof("registry_attestation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_rights_registry_attestation_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "registry_authority" varchar(64) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "attestation_id" uuid NOT NULL
    REFERENCES "foundry_derivative_rights_registry_attestations_v1"("id")
    ON DELETE RESTRICT,
  "registry_attestation_sha256" varchar(71) NOT NULL,
  "reason" text NOT NULL,
  "revocation_request_sha256" varchar(71) NOT NULL,
  "revocation_request_json" jsonb NOT NULL,
  "attestation_revocation_sha256" varchar(71) NOT NULL,
  "attestation_revocation_json" jsonb NOT NULL,
  "revoked_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(120) NOT NULL,
  "revoked_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "foundry_derivative_registry_revocation_one_unique"
    UNIQUE("attestation_id"),
  CONSTRAINT "foundry_derivative_registry_revocation_digest_unique"
    UNIQUE("attestation_revocation_sha256"),
  CONSTRAINT "foundry_derivative_registry_revocation_actor_idem_unique"
    UNIQUE("revoked_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_derivative_registry_revocation_inert" CHECK (
    "registry_authority" = 'authenticated_registry_attestation_v1'
    AND "execution_eligible" = false
  ),
  CONSTRAINT "foundry_derivative_registry_revocation_digests" CHECK (
    "registry_attestation_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "revocation_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "attestation_revocation_sha256" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_registry_revocation_text" CHECK (
    "foundry_is_derivative_trimmed_text_v0"("reason", 1, 2000)
    AND "idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_registry_revocation_uuid_shapes" CHECK (
    "id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "attestation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "revoked_by_user_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "foundry_derivative_registry_revocation_times" CHECK (
    "revoked_at" = date_trunc('milliseconds', "revoked_at")
    AND "recorded_at" = "revoked_at"
    AND "revoked_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "revoked_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_registry_revocation_json" CHECK (
    jsonb_typeof("revocation_request_json") = 'object'
    AND jsonb_typeof("attestation_revocation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_execution_authorization_candidates_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority" varchar(20) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "dispatch_enabled" boolean NOT NULL,
  "output_disposition" varchar(40) NOT NULL,
  "approval_id" varchar(120) NOT NULL
    REFERENCES "foundry_derivative_rights_approvals"("approval_id") ON DELETE RESTRICT,
  "derivative_rights_approval_sha256" varchar(71) NOT NULL,
  "review_id" uuid NOT NULL
    REFERENCES "foundry_derivative_rights_reviews_v1"("id") ON DELETE RESTRICT,
  "review_receipt_sha256" varchar(71) NOT NULL,
  "attestation_id" uuid NOT NULL
    REFERENCES "foundry_derivative_rights_registry_attestations_v1"("id")
    ON DELETE RESTRICT,
  "registry_attestation_sha256" varchar(71) NOT NULL,
  "base_execution_subject_sha256" varchar(71) NOT NULL,
  "base_execution_subject_json" jsonb NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL REFERENCES "foundry_jobs"("job_id") ON DELETE RESTRICT,
  "job_spec_sha256" varchar(71) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "ingest_manifest_sha256" varchar(71) NOT NULL,
  "job_subject_sha256" varchar(71) NOT NULL,
  "worker_profile_sha256" varchar(71) NOT NULL,
  "operation_class" varchar(40) NOT NULL,
  "binding_set_sha256" varchar(71) NOT NULL,
  "binding_set_json" jsonb NOT NULL,
  "restriction_lineage_set_sha256" varchar(71) NOT NULL,
  "restriction_lineage_set_json" jsonb NOT NULL,
  "output_policy_sha256" varchar(71) NOT NULL,
  "output_policy_json" jsonb NOT NULL,
  "reservation_request_sha256" varchar(71) NOT NULL,
  "reservation_request_json" jsonb NOT NULL,
  "reservation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "candidate_reservation_receipt_sha256" varchar(71) NOT NULL,
  "candidate_reservation_receipt_json" jsonb NOT NULL,
  "candidate_sha256" varchar(71) NOT NULL,
  "candidate_json" jsonb NOT NULL,
  "reserved_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(120) NOT NULL,
  "assembled_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "foundry_derivative_candidate_review_unique" UNIQUE("review_id"),
  CONSTRAINT "foundry_derivative_candidate_approval_unique" UNIQUE("approval_id"),
  CONSTRAINT "foundry_derivative_candidate_attestation_unique" UNIQUE("attestation_id"),
  CONSTRAINT "foundry_derivative_candidate_base_subject_unique"
    UNIQUE("base_execution_subject_sha256"),
  CONSTRAINT "foundry_derivative_candidate_subject_unique" UNIQUE("candidate_sha256"),
  CONSTRAINT "foundry_derivative_candidate_reservation_unique" UNIQUE("reservation_id"),
  CONSTRAINT "foundry_derivative_candidate_reservation_receipt_unique"
    UNIQUE("candidate_reservation_receipt_sha256"),
  CONSTRAINT "foundry_derivative_candidate_actor_idem_unique"
    UNIQUE("reserved_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_derivative_candidate_inert" CHECK (
    "authority" = 'none'
    AND "execution_eligible" = false
    AND "dispatch_enabled" = false
    AND "output_disposition" = 'quarantine_only'
    AND "operation_class" = 'deterministic_transformation'
  ),
  CONSTRAINT "foundry_derivative_candidate_keys" CHECK (
    "approval_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "project_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "job_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_candidate_uuid_shapes" CHECK (
    "id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "review_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "attestation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "reservation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "reserved_by_user_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "foundry_derivative_candidate_digests" CHECK (
    "derivative_rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "review_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "registry_attestation_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "base_execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "worker_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "binding_set_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "restriction_lineage_set_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "output_policy_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "reservation_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "candidate_reservation_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "candidate_sha256" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_candidate_times" CHECK (
    "assembled_at" = date_trunc('milliseconds', "assembled_at")
    AND "recorded_at" = "assembled_at"
    AND "assembled_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "assembled_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_candidate_json" CHECK (
    jsonb_typeof("base_execution_subject_json") = 'object'
    AND jsonb_typeof("binding_set_json") = 'object'
    AND jsonb_typeof("restriction_lineage_set_json") = 'object'
    AND jsonb_typeof("output_policy_json") = 'object'
    AND jsonb_typeof("reservation_request_json") = 'object'
    AND jsonb_typeof("candidate_reservation_receipt_json") = 'object'
    AND jsonb_typeof("candidate_json") = 'object'
  )
);

CREATE INDEX "foundry_derivative_registry_attestation_policy_idx"
  ON "foundry_derivative_rights_registry_attestations_v1"(
    "policy_version", "policy_definition_sha256", "policy_generation",
    "attested_at"
  );

CREATE INDEX "foundry_derivative_candidate_job_idx"
  ON "foundry_derivative_execution_authorization_candidates_v1"(
    "job_id", "project_id", "assembled_at"
  );

CREATE FUNCTION "guard_foundry_derivative_registry_attestation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  review_row "foundry_derivative_rights_reviews_v1"%ROWTYPE;
  custody_row "foundry_derivative_terms_evidence_custody_v1"%ROWTYPE;
  actor_platform_role varchar;
  current_policy_generation bigint;
  database_now timestamptz;
  database_now_text text;
  expected_request jsonb;
  expected_attestation jsonb;
BEGIN
  SELECT actor."platform_role"
  INTO actor_platform_role
  FROM "users" actor
  WHERE actor."id" = NEW."attested_by_user_id"
  FOR SHARE;
  IF NOT FOUND OR actor_platform_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'derivative registry attestation requires a current platform administrator'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = NEW."approval_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative registry attestation approval is absent'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO review_row
  FROM "foundry_derivative_rights_reviews_v1"
  WHERE "id" = NEW."review_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative registry attestation review is absent'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO custody_row
  FROM "foundry_derivative_terms_evidence_custody_v1"
  WHERE "id" = NEW."terms_custody_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative registry attestation custody is absent'
      USING ERRCODE = '23503';
  END IF;

  -- This is the same advisory lock used by 0054 approval/revocation and 0055
  -- accepted-review insertion.  Time is sampled only after every source row
  -- and the policy serialization point are held.
  PERFORM "foundry_lock_derivative_rights_policy_version"(
    approval_row."policy_version"
  );
  database_now := date_trunc('milliseconds', clock_timestamp());
  database_now_text := to_char(
    database_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT policy."generation"
  INTO current_policy_generation
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = approval_row."policy_version"
    AND policy."effective_at" <= database_now
  ORDER BY policy."effective_at" DESC, policy."generation" DESC
  LIMIT 1;

  IF review_row."authority" IS DISTINCT FROM 'none'
     OR review_row."execution_eligible" IS DISTINCT FROM false
     OR review_row."decision" IS DISTINCT FROM 'accepted_for_registry_attestation'
     OR review_row."approval_id" IS DISTINCT FROM approval_row."approval_id"
     OR review_row."derivative_rights_approval_sha256"
          IS DISTINCT FROM approval_row."derivative_rights_approval_sha256"
     OR review_row."terms_custody_id" IS DISTINCT FROM custody_row."id"
     OR review_row."terms_custody_receipt_sha256"
          IS DISTINCT FROM custody_row."custody_receipt_sha256"
     OR custody_row."authority" IS DISTINCT FROM 'none'
     OR custody_row."execution_eligible" IS DISTINCT FROM false
     OR custody_row."artifact_id"
          IS DISTINCT FROM approval_row."terms_evidence_artifact_id"
     OR custody_row."sha256" IS DISTINCT FROM approval_row."terms_evidence_sha256"
     OR custody_row."size_bytes"
          IS DISTINCT FROM approval_row."terms_evidence_size_bytes"
     OR custody_row."media_type"
          IS DISTINCT FROM approval_row."terms_evidence_media_type"
     OR custody_row."captured_at"
          IS DISTINCT FROM approval_row."terms_evidence_captured_at"
     OR approval_row."authority" IS DISTINCT FROM 'none'
     OR approval_row."decision" IS DISTINCT FROM 'allowed'
     OR approval_row."operation_id" IS DISTINCT FROM 'normalize_mesh_glb/v0'
     OR approval_row."derivative_class"
          IS DISTINCT FROM 'lossless_internal_format_normalization'
     OR approval_row."registered_at" > database_now
     OR approval_row."decided_at" > database_now
     OR approval_row."expires_at" <= database_now
     OR review_row."reviewed_at" > database_now
     OR custody_row."recorded_at" > database_now
     OR current_policy_generation IS DISTINCT FROM approval_row."policy_generation"
     OR EXISTS (
       SELECT 1
       FROM "foundry_derivative_rights_policy_revocations" revocation
       WHERE revocation."policy_version" = approval_row."policy_version"
         AND revocation."policy_definition_sha256" =
               approval_row."policy_definition_sha256"
         AND revocation."policy_generation" = approval_row."policy_generation"
     ) THEN
    RAISE EXCEPTION 'derivative registry attestation source is not exact, current, accepted, or unrevoked'
      USING ERRCODE = '23514';
  END IF;

  NEW."registry_authority" := 'authenticated_registry_attestation_v1';
  NEW."execution_eligible" := false;
  NEW."derivative_rights_approval_sha256" :=
    approval_row."derivative_rights_approval_sha256";
  NEW."review_receipt_sha256" := review_row."review_receipt_sha256";
  NEW."terms_custody_receipt_sha256" := custody_row."custody_receipt_sha256";
  NEW."policy_version" := approval_row."policy_version";
  NEW."policy_definition_sha256" := approval_row."policy_definition_sha256";
  NEW."policy_generation" := approval_row."policy_generation";
  NEW."job_subject_sha256" := approval_row."job_subject_sha256";
  NEW."ingest_manifest_sha256" := approval_row."ingest_manifest_sha256";
  NEW."stage_id" := approval_row."stage_id";
  NEW."operation_id" := approval_row."operation_id";
  NEW."derivative_class" := approval_row."derivative_class";
  NEW."asset_id" := approval_row."asset_id";
  NEW."approval_expires_at" := approval_row."expires_at";
  NEW."attested_at" := database_now;
  NEW."recorded_at" := database_now;

  expected_request := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1',
    'approvalId', approval_row."approval_id",
    'derivativeRightsApprovalSha256',
      approval_row."derivative_rights_approval_sha256",
    'reviewId', review_row."id"::text,
    'reviewReceiptSha256', review_row."review_receipt_sha256",
    'custodyId', custody_row."id"::text,
    'custodyReceiptSha256', custody_row."custody_receipt_sha256"
  );
  IF NEW."registration_request_json" IS DISTINCT FROM expected_request
     OR NEW."registration_request_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1',
         expected_request
       ) THEN
    RAISE EXCEPTION 'derivative registry attestation request does not bind the exact accepted evidence'
      USING ERRCODE = '23514';
  END IF;

  expected_attestation := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-registry-attestation.v1',
    'attestationId', NEW."id"::text,
    'registrationRequestSha256', NEW."registration_request_sha256",
    'derivativeRightsApproval', approval_row."derivative_rights_approval_json",
    'acceptedReviewReceipt',
      review_row."review_receipt_json" || jsonb_build_object(
        'reviewReceiptSha256', review_row."review_receipt_sha256"
      ),
    'termsEvidenceCustodyReceipt',
      custody_row."custody_receipt_json" || jsonb_build_object(
        'custodyReceiptSha256', custody_row."custody_receipt_sha256"
      ),
    'attestedByUserId', NEW."attested_by_user_id"::text,
    'attestedAt', database_now_text,
    'registryAuthority', 'authenticated_registry_attestation_v1',
    'executionEligible', false
  );
  NEW."registry_attestation_json" := expected_attestation;
  NEW."registry_attestation_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-registry-attestation.v1',
      expected_attestation
    );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_registry_attestation_revocation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attestation_row "foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
  actor_platform_role varchar;
  database_now timestamptz;
  database_now_text text;
  expected_request jsonb;
  expected_revocation jsonb;
  full_attestation jsonb;
BEGIN
  SELECT actor."platform_role"
  INTO actor_platform_role
  FROM "users" actor
  WHERE actor."id" = NEW."revoked_by_user_id"
  FOR SHARE;
  IF NOT FOUND OR actor_platform_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'derivative registry attestation revocation requires a current platform administrator'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE conflicts with candidate FOR SHARE.  Whichever transaction
  -- obtains this row first establishes whether the inert reservation precedes
  -- the revocation or must observe and reject it.
  SELECT * INTO attestation_row
  FROM "foundry_derivative_rights_registry_attestations_v1"
  WHERE "id" = NEW."attestation_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative registry attestation to revoke is absent'
      USING ERRCODE = '23503';
  END IF;

  PERFORM "foundry_lock_derivative_rights_policy_version"(
    attestation_row."policy_version"
  );
  database_now := date_trunc('milliseconds', clock_timestamp());
  database_now_text := to_char(
    database_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  IF NEW."registry_attestation_sha256" IS DISTINCT FROM
       attestation_row."registry_attestation_sha256"
     OR attestation_row."attested_at" > database_now THEN
    RAISE EXCEPTION 'derivative registry attestation revocation misses its exact subject'
      USING ERRCODE = '23514';
  END IF;

  NEW."registry_authority" := 'authenticated_registry_attestation_v1';
  NEW."execution_eligible" := false;
  NEW."revoked_at" := database_now;
  NEW."recorded_at" := database_now;

  expected_request := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1',
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'reason', NEW."reason"
  );
  IF NEW."revocation_request_json" IS DISTINCT FROM expected_request
     OR NEW."revocation_request_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1',
         expected_request
       ) THEN
    RAISE EXCEPTION 'derivative registry attestation revocation request is not exact'
      USING ERRCODE = '23514';
  END IF;

  full_attestation := attestation_row."registry_attestation_json" ||
    jsonb_build_object(
      'registryAttestationSha256',
      attestation_row."registry_attestation_sha256"
    );
  expected_revocation := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-registry-attestation-revocation.v1',
    'revocationId', NEW."id"::text,
    'revocationRequestSha256', NEW."revocation_request_sha256",
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'registryAttestation', full_attestation,
    'revokedByUserId', NEW."revoked_by_user_id"::text,
    'revokedAt', database_now_text,
    'reason', NEW."reason",
    'registryAuthority', 'authenticated_registry_attestation_v1',
    'executionEligible', false
  );
  NEW."attestation_revocation_json" := expected_revocation;
  NEW."attestation_revocation_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-registry-attestation-revocation.v1',
      expected_revocation
    );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_execution_candidate_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attestation_row "foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  review_row "foundry_derivative_rights_reviews_v1"%ROWTYPE;
  custody_row "foundry_derivative_terms_evidence_custody_v1"%ROWTYPE;
  job_row "foundry_jobs"%ROWTYPE;
  job_worker_row "foundry_job_worker_profiles"%ROWTYPE;
  worker_row "foundry_trusted_worker_profiles"%ROWTYPE;
  actor_platform_role varchar;
  current_policy_generation bigint;
  policy_cost_observation_maximum_age_seconds integer;
  database_now timestamptz;
  database_now_text text;
  job_stage jsonb;
  expected_worker_profile_sha256s jsonb;
  full_attestation jsonb;
  binding_id varchar(120);
  binding jsonb;
  expected_binding_set jsonb;
  expected_restriction_entries jsonb;
  expected_restriction_set jsonb;
  expected_output_policy jsonb;
  expected_request jsonb;
  expected_candidate_reservation_receipt jsonb;
  full_candidate_reservation_receipt jsonb;
  expected_candidate jsonb;
BEGIN
  SELECT actor."platform_role"
  INTO actor_platform_role
  FROM "users" actor
  WHERE actor."id" = NEW."reserved_by_user_id"
  FOR SHARE;
  IF NOT FOUND OR actor_platform_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'derivative candidate reservation requires a current platform administrator'
      USING ERRCODE = '42501';
  END IF;

  -- FOR SHARE conflicts with attestation revocation's FOR UPDATE.  This lock
  -- is acquired before policy time sampling and held through the unique
  -- reservation insert.
  SELECT * INTO attestation_row
  FROM "foundry_derivative_rights_registry_attestations_v1"
  WHERE "id" = NEW."attestation_id"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative candidate registry attestation is absent'
      USING ERRCODE = '23503';
  END IF;

  PERFORM "foundry_lock_derivative_rights_policy_version"(
    attestation_row."policy_version"
  );

  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = attestation_row."approval_id"
  FOR KEY SHARE;
  SELECT * INTO review_row
  FROM "foundry_derivative_rights_reviews_v1"
  WHERE "id" = attestation_row."review_id"
  FOR KEY SHARE;
  SELECT * INTO custody_row
  FROM "foundry_derivative_terms_evidence_custody_v1"
  WHERE "id" = attestation_row."terms_custody_id"
  FOR KEY SHARE;
  SELECT * INTO job_row
  FROM "foundry_jobs"
  WHERE "job_id" = NEW."job_id"
  FOR KEY SHARE;
  IF approval_row."approval_id" IS NULL
     OR review_row."id" IS NULL
     OR custody_row."id" IS NULL
     OR job_row."job_id" IS NULL THEN
    RAISE EXCEPTION 'derivative candidate exact source graph is incomplete'
      USING ERRCODE = '23503';
  END IF;

  SELECT link.* INTO job_worker_row
  FROM "foundry_job_worker_profiles" link
  WHERE link."job_id" = job_row."job_id"
    AND link."stage_id" = approval_row."stage_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative candidate exact stage worker link is absent'
      USING ERRCODE = '23503';
  END IF;
  SELECT profile.* INTO worker_row
  FROM "foundry_trusted_worker_profiles" profile
  WHERE profile."worker_profile_sha256" = job_worker_row."worker_profile_sha256"
    AND profile."operation_class" = job_worker_row."operation_class"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative candidate exact trusted worker profile is absent'
      USING ERRCODE = '23503';
  END IF;

  SELECT policy."cost_observation_maximum_age_seconds"
  INTO policy_cost_observation_maximum_age_seconds
  FROM "foundry_execution_policies" policy
  WHERE policy."execution_policy_sha256" = job_row."execution_policy_sha256"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative candidate execution policy is absent'
      USING ERRCODE = '23503';
  END IF;

  database_now := date_trunc('milliseconds', clock_timestamp());
  database_now_text := to_char(
    database_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  SELECT policy."generation"
  INTO current_policy_generation
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = approval_row."policy_version"
    AND policy."effective_at" <= database_now
  ORDER BY policy."effective_at" DESC, policy."generation" DESC
  LIMIT 1;

  IF NEW."authority" IS DISTINCT FROM 'none'
     OR NEW."execution_eligible" IS DISTINCT FROM false
     OR NEW."dispatch_enabled" IS DISTINCT FROM false
     OR NEW."output_disposition" IS DISTINCT FROM 'quarantine_only'
     OR NEW."approval_id" IS DISTINCT FROM approval_row."approval_id"
     OR NEW."derivative_rights_approval_sha256"
          IS DISTINCT FROM approval_row."derivative_rights_approval_sha256"
     OR NEW."review_id" IS DISTINCT FROM review_row."id"
     OR NEW."review_receipt_sha256"
          IS DISTINCT FROM review_row."review_receipt_sha256"
     OR NEW."registry_attestation_sha256"
          IS DISTINCT FROM attestation_row."registry_attestation_sha256"
     OR attestation_row."registry_authority"
          IS DISTINCT FROM 'authenticated_registry_attestation_v1'
     OR attestation_row."execution_eligible" IS DISTINCT FROM false
     OR attestation_row."approval_id" IS DISTINCT FROM approval_row."approval_id"
     OR attestation_row."derivative_rights_approval_sha256"
          IS DISTINCT FROM approval_row."derivative_rights_approval_sha256"
     OR attestation_row."review_id" IS DISTINCT FROM review_row."id"
     OR attestation_row."review_receipt_sha256"
          IS DISTINCT FROM review_row."review_receipt_sha256"
     OR attestation_row."terms_custody_id" IS DISTINCT FROM custody_row."id"
     OR attestation_row."terms_custody_receipt_sha256"
          IS DISTINCT FROM custody_row."custody_receipt_sha256"
     OR review_row."decision" IS DISTINCT FROM 'accepted_for_registry_attestation'
     OR attestation_row."attested_at" > database_now
     OR approval_row."expires_at" <= database_now
     OR attestation_row."approval_expires_at" <= database_now
     OR worker_row."reviewed_at" > database_now
     OR worker_row."registered_at" > database_now
     OR worker_row."expires_at" <= database_now
     OR job_worker_row."registered_at" > database_now
     OR current_policy_generation IS DISTINCT FROM approval_row."policy_generation"
     OR EXISTS (
       SELECT 1
       FROM "foundry_derivative_rights_policy_revocations" revocation
       WHERE revocation."policy_version" = approval_row."policy_version"
         AND revocation."policy_definition_sha256" =
               approval_row."policy_definition_sha256"
         AND revocation."policy_generation" = approval_row."policy_generation"
     )
     OR EXISTS (
       SELECT 1
       FROM "foundry_derivative_rights_registry_attestation_revocations_v1" revocation
       WHERE revocation."attestation_id" = attestation_row."id"
     ) THEN
    RAISE EXCEPTION 'derivative candidate source is not exact, current, unexpired, and unrevoked'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_classify_normalize_mesh_glb_v0_job_spec"(
       job_row."job_spec_json"
     ) IS DISTINCT FROM 'normalize_mesh_glb_v0_exact'
     OR jsonb_array_length(job_row."job_spec_json"->'stages') <> 1
     OR job_row."execution_intent" IS DISTINCT FROM 'execute'
     OR job_row."authority" IS DISTINCT FROM 'none'
     OR job_row."job_id" IS DISTINCT FROM approval_row."job_id"
     OR job_row."project_id" IS DISTINCT FROM approval_row."project_id"
     OR job_row."job_spec_sha256" IS DISTINCT FROM approval_row."job_spec_sha256"
     OR job_row."reviewed_ingest_manifest_sha256"
          IS DISTINCT FROM approval_row."ingest_manifest_sha256"
     OR job_row."job_spec_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.job-spec.v0', job_row."job_spec_json"
       )
     OR approval_row."job_subject_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.job-approval-subject.v0', job_row."job_spec_json"
       ) THEN
    RAISE EXCEPTION 'derivative candidate must bind the exact immutable singleton normalization job'
      USING ERRCODE = '23514';
  END IF;

  job_stage := job_row."job_spec_json"->'stages'->0;
  IF job_stage->>'id' IS DISTINCT FROM approval_row."stage_id"
     OR job_stage->>'kind' IS DISTINCT FROM 'geometry'
     OR job_stage->'command' IS DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
     OR job_stage->>'networkAccess' IS DISTINCT FROM 'none'
     OR job_stage->'rightsPurposes' IS DISTINCT FROM
          '["commercial_internal_use"]'::jsonb
     OR job_stage->'inputAssetIds' IS DISTINCT FROM
          jsonb_build_array(approval_row."asset_id")
     OR approval_row."operation_id" IS DISTINCT FROM 'normalize_mesh_glb/v0'
     OR approval_row."derivative_class"
          IS DISTINCT FROM 'lossless_internal_format_normalization'
     OR job_worker_row."project_id" IS DISTINCT FROM job_row."project_id"
     OR job_worker_row."execution_envelope_sha256"
          IS DISTINCT FROM job_row."execution_envelope_sha256"
     OR job_worker_row."provider_plan_sha256"
          IS DISTINCT FROM job_row."provider_plan_sha256"
     OR job_worker_row."trusted_worker_profile_set_sha256"
          IS DISTINCT FROM job_row."trusted_worker_profile_set_sha256"
     OR job_worker_row."operation_class"
          IS DISTINCT FROM 'deterministic_transformation'
     OR worker_row."operation_class"
          IS DISTINCT FROM 'deterministic_transformation'
     OR worker_row."network_access" IS DISTINCT FROM 'none'
     OR worker_row."profile_json"->'command' IS DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
     OR worker_row."container_image" IS DISTINCT FROM job_stage->>'containerImage'
     OR (
       SELECT count(*)
       FROM "foundry_job_worker_profiles" exact_link
       WHERE exact_link."job_id" = job_row."job_id"
     ) <> 1 THEN
    RAISE EXCEPTION 'derivative candidate stage and trusted worker binding are not exact and singleton'
      USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(
    to_jsonb(profile_digest."worker_profile_sha256")
    ORDER BY profile_digest."worker_profile_sha256" COLLATE "C"
  )
  INTO expected_worker_profile_sha256s
  FROM (
    SELECT DISTINCT link."worker_profile_sha256"
    FROM "foundry_job_worker_profiles" link
    WHERE link."job_id" = job_row."job_id"
  ) profile_digest;

  IF EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'schemaVersion', 'subjectId', 'projectId', 'jobSpecSha256',
         'executionEnvelopeSha256', 'ingestManifestSha256',
         'intakeAdmissionResultSha256', 'intakeStagingIndexSha256',
         'providerPlanSha256', 'executionPolicySha256',
         'executionConfirmationSha256', 'rightsApprovalSha256',
         'rightsPolicyEvidenceSha256', 'rightsPolicyDefinitionSha256',
         'providerKind', 'providerAdapterId', 'providerAdapterVersion',
         'providerAdapterArtifactSha256', 'providerDeploymentSha256',
         'pricingSnapshotSha256', 'pricingSnapshotExpiresAt', 'createdAt',
         'dispatchDeadline'
       ]) subject_string_key
       WHERE jsonb_typeof(
         NEW."base_execution_subject_json"->subject_string_key
       ) IS DISTINCT FROM 'string'
     )
     OR (
       job_row."compute_approval_id" IS NULL
       AND jsonb_typeof(
         NEW."base_execution_subject_json"->'computeApprovalSha256'
       ) IS DISTINCT FROM 'null'
     )
     OR (
       job_row."compute_approval_id" IS NOT NULL
       AND jsonb_typeof(
         NEW."base_execution_subject_json"->'computeApprovalSha256'
       ) IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(
          NEW."base_execution_subject_json"->'workerProfileSha256s'
        ) IS DISTINCT FROM 'array'
     OR jsonb_typeof(
          NEW."base_execution_subject_json"->'maximumAttempts'
        ) IS DISTINCT FROM 'number'
     OR jsonb_typeof(
          NEW."base_execution_subject_json"->'budgetPolicy'
        ) IS DISTINCT FROM 'object'
     OR jsonb_typeof(
          NEW."base_execution_subject_json"->'checkpointContract'
        ) IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'derivative candidate base V0 subject leaves have non-canonical JSON types'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."base_execution_subject_json") IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(NEW."base_execution_subject_json") <> 28
     OR NOT (NEW."base_execution_subject_json" ?& ARRAY[
       'schemaVersion', 'subjectId', 'projectId', 'jobSpecSha256',
       'executionEnvelopeSha256', 'ingestManifestSha256',
       'intakeAdmissionResultSha256', 'intakeStagingIndexSha256',
       'providerPlanSha256', 'executionPolicySha256',
       'executionConfirmationSha256', 'rightsApprovalSha256',
       'rightsPolicyEvidenceSha256', 'rightsPolicyDefinitionSha256',
       'computeApprovalSha256', 'providerKind', 'providerAdapterId',
       'providerAdapterVersion', 'providerAdapterArtifactSha256',
       'providerDeploymentSha256', 'workerProfileSha256s',
       'pricingSnapshotSha256', 'pricingSnapshotExpiresAt', 'createdAt',
       'dispatchDeadline', 'maximumAttempts', 'budgetPolicy',
       'checkpointContract'
     ])
     OR NEW."base_execution_subject_json"->>'schemaVersion'
          IS DISTINCT FROM 'omnitwin.foundry.execution-subject.v0'
     OR NEW."base_execution_subject_json"->>'subjectId'
          IS DISTINCT FROM job_row."envelope_id"
     OR NEW."base_execution_subject_json"->>'projectId'
          IS DISTINCT FROM job_row."project_id"
     OR NEW."base_execution_subject_json"->>'jobSpecSha256'
          IS DISTINCT FROM job_row."job_spec_sha256"
     OR NEW."base_execution_subject_json"->>'executionEnvelopeSha256'
          IS DISTINCT FROM job_row."execution_envelope_sha256"
     OR NEW."base_execution_subject_json"->>'ingestManifestSha256'
          IS DISTINCT FROM job_row."reviewed_ingest_manifest_sha256"
     OR NEW."base_execution_subject_json"->>'intakeAdmissionResultSha256'
          IS DISTINCT FROM job_row."intake_admission_result_sha256"
     OR NEW."base_execution_subject_json"->>'intakeStagingIndexSha256'
          IS DISTINCT FROM job_row."intake_staging_index_sha256"
     OR NEW."base_execution_subject_json"->>'providerPlanSha256'
          IS DISTINCT FROM job_row."provider_plan_sha256"
     OR NEW."base_execution_subject_json"->>'executionPolicySha256'
          IS DISTINCT FROM job_row."execution_policy_sha256"
     OR NEW."base_execution_subject_json"->>'providerKind'
          IS DISTINCT FROM job_row."provider_kind"
     OR NEW."base_execution_subject_json"->>'providerAdapterId'
          IS DISTINCT FROM job_row."provider_adapter_id"
     OR NEW."base_execution_subject_json"->>'providerAdapterVersion'
          IS DISTINCT FROM job_row."provider_adapter_version"
     OR NEW."base_execution_subject_json"->>'providerAdapterArtifactSha256'
          IS DISTINCT FROM job_row."provider_adapter_artifact_sha256"
     OR NEW."base_execution_subject_json"->>'providerDeploymentSha256'
          IS DISTINCT FROM job_row."provider_deployment_sha256"
     OR NEW."base_execution_subject_json"->'workerProfileSha256s'
          IS DISTINCT FROM expected_worker_profile_sha256s
     OR NEW."base_execution_subject_json"->>'pricingSnapshotSha256'
          IS DISTINCT FROM job_row."pricing_snapshot_sha256"
     OR NEW."base_execution_subject_json"->>'pricingSnapshotExpiresAt'
          IS DISTINCT FROM to_char(
            job_row."pricing_snapshot_expires_at" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
     OR NEW."base_execution_subject_json"->>'createdAt'
          IS DISTINCT FROM to_char(
            job_row."envelope_created_at" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
     OR NEW."base_execution_subject_json"->>'dispatchDeadline'
          IS DISTINCT FROM to_char(
            job_row."dispatch_deadline" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
     OR (NEW."base_execution_subject_json"->'maximumAttempts' #>> '{}')::numeric
          IS DISTINCT FROM 1::numeric
     OR NEW."base_execution_subject_sha256" IS DISTINCT FROM
       "foundry_nul_domain_jsonb_sha256"(
         'OMNITWIN_FOUNDRY_EXECUTION_SUBJECT_V0',
         NEW."base_execution_subject_json"
       ) THEN
    RAISE EXCEPTION 'derivative candidate base V0 execution subject is not exact and canonical'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM "foundry_rights_approvals" rights
       JOIN "foundry_rights_policy_versions" rights_policy
         ON rights_policy."policy_version" = rights."policy_version"
        AND rights_policy."policy_definition_sha256" =
              rights."policy_definition_sha256"
        AND rights_policy."policy_evidence_sha256" = rights."policy_evidence_sha256"
        AND rights_policy."generation" = rights."policy_generation"
       WHERE rights."job_id" = job_row."job_id"
         AND rights."project_id" = job_row."project_id"
         AND rights."execution_envelope_sha256" = job_row."execution_envelope_sha256"
         AND rights."job_spec_sha256" = job_row."job_spec_sha256"
         AND rights."reviewed_ingest_manifest_sha256" =
               job_row."reviewed_ingest_manifest_sha256"
         AND rights."execution_policy_sha256" = job_row."execution_policy_sha256"
         AND rights."rights_approval_sha256" =
               NEW."base_execution_subject_json"->>'rightsApprovalSha256'
         AND rights."policy_evidence_sha256" =
               NEW."base_execution_subject_json"->>'rightsPolicyEvidenceSha256'
         AND rights."policy_definition_sha256" =
               NEW."base_execution_subject_json"->>'rightsPolicyDefinitionSha256'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM "foundry_execution_confirmations" confirmation
       WHERE confirmation."job_id" = job_row."job_id"
         AND confirmation."project_id" = job_row."project_id"
         AND confirmation."execution_envelope_sha256" =
               job_row."execution_envelope_sha256"
         AND confirmation."job_spec_sha256" = job_row."job_spec_sha256"
         AND confirmation."confirmation_sha256" =
               NEW."base_execution_subject_json"->>'executionConfirmationSha256'
     )
     OR (
       job_row."compute_approval_id" IS NULL
       AND jsonb_typeof(
         NEW."base_execution_subject_json"->'computeApprovalSha256'
       ) IS DISTINCT FROM 'null'
     )
     OR (
       job_row."compute_approval_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM "foundry_compute_approvals" compute_approval
         WHERE compute_approval."approval_id" = job_row."compute_approval_id"
           AND compute_approval."job_id" = job_row."job_id"
           AND compute_approval."compute_approval_sha256" =
                 NEW."base_execution_subject_json"->>'computeApprovalSha256'
       )
     )
     OR NEW."base_execution_subject_json"->'budgetPolicy' IS DISTINCT FROM
       jsonb_build_object(
         'currency', 'USD',
         'costWarningMicroUsd', job_row."cost_warning_micro_usd"::text,
         'costHardStopMicroUsd', job_row."cost_hard_stop_micro_usd"::text,
         'terminationReserveMicroUsd', job_row."termination_reserve_micro_usd"::text,
         'absoluteCostCapMicroUsd', job_row."absolute_cost_cap_micro_usd"::text,
         'costObservationMaximumAgeSeconds',
           policy_cost_observation_maximum_age_seconds
       ) THEN
    RAISE EXCEPTION 'derivative candidate base subject loses exact authority or budget evidence'
      USING ERRCODE = '23514';
  END IF;

  -- This row is only an authority-none evidence reservation.  Mutable base
  -- dispatch-window, pricing-freshness, confirmation-expiry, base-rights
  -- expiry/revocation, kill-switch, and capacity gates intentionally remain
  -- the responsibility of a later atomic activation transaction.  Applying
  -- them here would make inert evidence look like a dispatch authorization.

  binding_id := approval_row."approval_id";
  full_attestation := attestation_row."registry_attestation_json" ||
    jsonb_build_object(
      'registryAttestationSha256',
      attestation_row."registry_attestation_sha256"
    );
  binding := jsonb_build_object(
    'bindingId', binding_id,
    'baseExecutionSubjectSha256', NEW."base_execution_subject_sha256",
    'projectId', job_row."project_id",
    'jobId', job_row."job_id",
    'jobSpecSha256', job_row."job_spec_sha256",
    'executionEnvelopeSha256', job_row."execution_envelope_sha256",
    'jobSubjectSha256', approval_row."job_subject_sha256",
    'ingestManifestSha256', approval_row."ingest_manifest_sha256",
    'workerProfileSha256', worker_row."worker_profile_sha256",
    'operationClass', 'deterministic_transformation',
    'stageId', approval_row."stage_id",
    'operationId', approval_row."operation_id",
    'derivativeClass', approval_row."derivative_class",
    'assetId', approval_row."asset_id",
    'policyVersion', approval_row."policy_version",
    'policyDefinitionSha256', approval_row."policy_definition_sha256",
    'policyGeneration', approval_row."policy_generation",
    'approvalId', approval_row."approval_id",
    'derivativeRightsApprovalSha256',
      approval_row."derivative_rights_approval_sha256",
    'reviewId', review_row."id"::text,
    'reviewReceiptSha256', review_row."review_receipt_sha256",
    'custodyId', custody_row."id"::text,
    'custodyReceiptSha256', custody_row."custody_receipt_sha256",
    'termsEvidenceArtifactId', custody_row."artifact_id",
    'termsEvidenceContentSha256', custody_row."sha256",
    'termsEvidenceSizeBytes', custody_row."size_bytes",
    'termsEvidenceMediaType', custody_row."media_type",
    'termsEvidenceCapturedAt', to_char(
      custody_row."captured_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256"
  );
  expected_binding_set := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-execution-binding-set.v1',
    'bindingIds', jsonb_build_array(binding_id),
    'assetIds', jsonb_build_array(approval_row."asset_id"),
    'bindings', jsonb_build_array(binding)
  );
  NEW."binding_set_json" := expected_binding_set;
  NEW."binding_set_sha256" := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-execution-binding-set.v1',
    expected_binding_set
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'assetId', approval_row."asset_id",
        'restriction', disposition.value,
        'lineageDisposition', 'preserve_on_quarantined_derivative'
      ) ORDER BY disposition.ordinality
    ),
    '[]'::jsonb
  )
  INTO expected_restriction_entries
  FROM jsonb_array_elements(
    approval_row."derivative_rights_approval_json"
      ->'assetRightsEvidence'->0->'restrictionDispositions'
  ) WITH ORDINALITY disposition(value, ordinality);

  expected_restriction_set := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-restriction-lineage-set.v1',
    'approvalId', approval_row."approval_id",
    'derivativeRightsApprovalSha256',
      approval_row."derivative_rights_approval_sha256",
    'reviewId', review_row."id"::text,
    'reviewReceiptSha256', review_row."review_receipt_sha256",
    'custodyId', custody_row."id"::text,
    'custodyReceiptSha256', custody_row."custody_receipt_sha256",
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'bindingSetSha256', NEW."binding_set_sha256",
    'assetIds', jsonb_build_array(approval_row."asset_id"),
    'entries', expected_restriction_entries
  );
  NEW."restriction_lineage_set_json" := expected_restriction_set;
  NEW."restriction_lineage_set_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-restriction-lineage-set.v1',
      expected_restriction_set
    );

  expected_output_policy := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-quarantine-output-policy.v1',
    'outputDisposition', 'quarantine_only',
    'releaseEligible', false,
    'publicationEligible', false,
    'redistributionEligible', false,
    'runtimePromotionEligible', false,
    'signingEligible', false,
    'restrictionLineageRequired', true,
    'authorityRevalidationRequiredAtOutputCommit', true
  );
  NEW."output_policy_json" := expected_output_policy;
  NEW."output_policy_sha256" := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-quarantine-output-policy.v1',
    expected_output_policy
  );

  expected_request := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-execution-authorization-candidate-reservation-request.v1',
    'baseExecutionSubjectSha256', NEW."base_execution_subject_sha256",
    'projectId', job_row."project_id",
    'jobId', job_row."job_id",
    'jobSpecSha256', job_row."job_spec_sha256",
    'executionEnvelopeSha256', job_row."execution_envelope_sha256",
    'ingestManifestSha256', approval_row."ingest_manifest_sha256",
    'jobSubjectSha256', approval_row."job_subject_sha256",
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'bindingSetSha256', NEW."binding_set_sha256",
    'restrictionLineageSetSha256', NEW."restriction_lineage_set_sha256",
    'outputPolicySha256', NEW."output_policy_sha256"
  );
  IF NEW."reservation_request_json" IS DISTINCT FROM expected_request
     OR NEW."reservation_request_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-execution-authorization-candidate-reservation-request.v1',
         expected_request
       ) THEN
    RAISE EXCEPTION 'derivative candidate reservation request is not exact'
      USING ERRCODE = '23514';
  END IF;

  expected_candidate_reservation_receipt := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-candidate-reservation-receipt.v1',
    'reservationId', NEW."reservation_id"::text,
    'reservationRequestSha256', NEW."reservation_request_sha256",
    'approvalId', approval_row."approval_id",
    'derivativeRightsApprovalSha256',
      approval_row."derivative_rights_approval_sha256",
    'reviewId', review_row."id"::text,
    'reviewReceiptSha256', review_row."review_receipt_sha256",
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'baseExecutionSubjectSha256', NEW."base_execution_subject_sha256",
    'projectId', job_row."project_id",
    'jobId', job_row."job_id",
    'jobSpecSha256', job_row."job_spec_sha256",
    'executionEnvelopeSha256', job_row."execution_envelope_sha256",
    'ingestManifestSha256', approval_row."ingest_manifest_sha256",
    'jobSubjectSha256', approval_row."job_subject_sha256",
    'bindingSetSha256', NEW."binding_set_sha256",
    'restrictionLineageSetSha256', NEW."restriction_lineage_set_sha256",
    'outputPolicySha256', NEW."output_policy_sha256",
    'reservationOrdinal', 1,
    'singleReservation', true,
    'reservationScope', 'authority_none_candidate_reservation',
    'executionActivationRecorded', false,
    'reservedByUserId', NEW."reserved_by_user_id"::text,
    'reservedAt', database_now_text,
    'authority', 'none',
    'executionEligible', false
  );
  NEW."candidate_reservation_receipt_json" := expected_candidate_reservation_receipt;
  NEW."candidate_reservation_receipt_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-candidate-reservation-receipt.v1',
      expected_candidate_reservation_receipt
    );
  full_candidate_reservation_receipt := expected_candidate_reservation_receipt ||
    jsonb_build_object(
      'reservationReceiptSha256',
      NEW."candidate_reservation_receipt_sha256"
    );

  NEW."project_id" := job_row."project_id";
  NEW."job_spec_sha256" := job_row."job_spec_sha256";
  NEW."execution_envelope_sha256" := job_row."execution_envelope_sha256";
  NEW."ingest_manifest_sha256" := approval_row."ingest_manifest_sha256";
  NEW."job_subject_sha256" := approval_row."job_subject_sha256";
  NEW."worker_profile_sha256" := worker_row."worker_profile_sha256";
  NEW."operation_class" := 'deterministic_transformation';
  NEW."assembled_at" := database_now;
  NEW."recorded_at" := database_now;

  expected_candidate := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-execution-authorization-candidate.v1',
    'candidateId', NEW."id"::text,
    'reservationRequestSha256', NEW."reservation_request_sha256",
    'baseExecutionSubjectSha256', NEW."base_execution_subject_sha256",
    'projectId', job_row."project_id",
    'jobId', job_row."job_id",
    'jobSpecSha256', job_row."job_spec_sha256",
    'executionEnvelopeSha256', job_row."execution_envelope_sha256",
    'ingestManifestSha256', approval_row."ingest_manifest_sha256",
    'jobSubjectSha256', approval_row."job_subject_sha256",
    'registryAttestation', full_attestation,
    'registryAttestationSha256',
      attestation_row."registry_attestation_sha256",
    'bindingSet', expected_binding_set,
    'bindingSetSha256', NEW."binding_set_sha256",
    'restrictionLineageSet', expected_restriction_set,
    'restrictionLineageSetSha256', NEW."restriction_lineage_set_sha256",
    'outputPolicy', expected_output_policy,
    'outputPolicySha256', NEW."output_policy_sha256",
    'candidateReservationReceipt', full_candidate_reservation_receipt,
    'candidateReservationReceiptSha256',
      NEW."candidate_reservation_receipt_sha256",
    'outputDisposition', 'quarantine_only',
    'authority', 'none',
    'executionEligible', false,
    'dispatchEnabled', false,
    'assembledAt', database_now_text
  );
  NEW."candidate_json" := expected_candidate;
  NEW."candidate_sha256" := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-execution-authorization-candidate.v1',
    expected_candidate
  );
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation
    OR numeric_value_out_of_range
    OR invalid_datetime_format
    OR datetime_field_overflow THEN
    RAISE EXCEPTION 'derivative candidate contains an invalid bounded value'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "foundry_derivative_registry_attestation_guard"
  BEFORE INSERT ON "foundry_derivative_rights_registry_attestations_v1"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_registry_attestation_v1"();

CREATE TRIGGER "foundry_derivative_registry_attestation_revocation_guard"
  BEFORE INSERT ON "foundry_derivative_rights_registry_attestation_revocations_v1"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_registry_attestation_revocation_v1"();

CREATE TRIGGER "foundry_derivative_execution_candidate_guard"
  BEFORE INSERT ON "foundry_derivative_execution_authorization_candidates_v1"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_execution_candidate_v1"();

CREATE TRIGGER "foundry_derivative_registry_attestations_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_registry_attestations_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_registry_attestations_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_registry_attestations_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_registry_attestations_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_registry_attestations_v1"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

CREATE TRIGGER "foundry_derivative_registry_attestation_revocations_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_registry_attestation_revocations_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_registry_attestation_revocations_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_registry_attestation_revocations_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_registry_attestation_revocations_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_registry_attestation_revocations_v1"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

CREATE TRIGGER "foundry_derivative_execution_candidates_no_update"
  BEFORE UPDATE ON "foundry_derivative_execution_authorization_candidates_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_execution_candidates_no_delete"
  BEFORE DELETE ON "foundry_derivative_execution_authorization_candidates_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_execution_candidates_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_execution_authorization_candidates_v1"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
