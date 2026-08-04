-- -----------------------------------------------------------------------------
-- 0055_foundry_derivative_rights_custody
--
-- Bounded, authenticated-review evidence custody for the derivative-rights
-- registry. This migration deliberately grants no execution capability and
-- has no foreign key, trigger, or function path into executions, attempts,
-- provider commands, workers, releases, or publications.
--
-- The V0 rows in 0054 remain evidence-only. A V1 review records that an
-- authenticated platform administrator inspected an exact V0 approval and
-- exact bytes held inline by PostgreSQL; it is only eligible for a later,
-- separately authenticated registry attestation.
-- -----------------------------------------------------------------------------

CREATE TABLE "foundry_derivative_terms_evidence_custody_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority" varchar(20) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "artifact_id" varchar(120) NOT NULL,
  "sha256" varchar(71) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "media_type" varchar(160) NOT NULL,
  "evidence_bytes" bytea NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "storage_mode" varchar(40) NOT NULL,
  "custody_request_sha256" varchar(71) NOT NULL,
  "custody_request_json" jsonb NOT NULL,
  "custody_receipt_sha256" varchar(71) NOT NULL,
  "custody_receipt_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(120) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "foundry_derivative_terms_custody_artifact_unique" UNIQUE("artifact_id"),
  CONSTRAINT "foundry_derivative_terms_custody_receipt_unique" UNIQUE("custody_receipt_sha256"),
  CONSTRAINT "foundry_derivative_terms_custody_id_receipt_unique" UNIQUE(
    "id", "custody_receipt_sha256"
  ),
  CONSTRAINT "foundry_derivative_terms_custody_exact_unique" UNIQUE(
    "id", "artifact_id", "sha256", "size_bytes", "media_type", "captured_at",
    "custody_receipt_sha256"
  ),
  CONSTRAINT "foundry_derivative_terms_custody_actor_idem_unique" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_derivative_terms_custody_authority_none" CHECK (
    "authority" = 'none'
    AND "execution_eligible" = false
    AND "storage_mode" = 'postgres_inline_bytea_v1'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_artifact_shape" CHECK (
    "artifact_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_uuid_shapes" CHECK (
    "id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "registered_by_user_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_digest_shapes" CHECK (
    "sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "custody_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "custody_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_bounded_bytes" CHECK (
    "size_bytes" BETWEEN 1 AND 4194304
    AND octet_length("evidence_bytes") = "size_bytes"
    AND "sha256" = 'sha256:' || encode(sha256("evidence_bytes"), 'hex')
  ),
  CONSTRAINT "foundry_derivative_terms_custody_text" CHECK (
    "foundry_is_derivative_trimmed_text_v0"("media_type", 1, 160)
    AND "idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_times" CHECK (
    "captured_at" = date_trunc('milliseconds', "captured_at")
    AND "recorded_at" = date_trunc('milliseconds', "recorded_at")
    AND "captured_at" = "recorded_at"
    AND "captured_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "captured_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_terms_custody_json_objects" CHECK (
    jsonb_typeof("custody_request_json") = 'object'
    AND jsonb_typeof("custody_receipt_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_rights_reviews_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority" varchar(20) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "approval_id" varchar(120) NOT NULL REFERENCES "foundry_derivative_rights_approvals"("approval_id") ON DELETE RESTRICT,
  "derivative_rights_approval_sha256" varchar(71) NOT NULL,
  "terms_custody_id" uuid NOT NULL,
  "terms_custody_receipt_sha256" varchar(71) NOT NULL,
  "decision" varchar(48) NOT NULL,
  "rationale" text NOT NULL,
  "review_request_sha256" varchar(71) NOT NULL,
  "review_request_json" jsonb NOT NULL,
  "review_receipt_sha256" varchar(71) NOT NULL,
  "review_receipt_json" jsonb NOT NULL,
  "reviewed_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(120) NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "foundry_derivative_rights_review_custody_fk" FOREIGN KEY(
    "terms_custody_id", "terms_custody_receipt_sha256"
  ) REFERENCES "foundry_derivative_terms_evidence_custody_v1"(
    "id", "custody_receipt_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_derivative_rights_review_approval_unique" UNIQUE("approval_id"),
  CONSTRAINT "foundry_derivative_rights_review_receipt_unique" UNIQUE("review_receipt_sha256"),
  CONSTRAINT "foundry_derivative_rights_review_actor_idem_unique" UNIQUE(
    "reviewed_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_derivative_rights_review_authority_none" CHECK (
    "authority" = 'none' AND "execution_eligible" = false
  ),
  CONSTRAINT "foundry_derivative_rights_review_uuid_shapes" CHECK (
    "id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "terms_custody_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "reviewed_by_user_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "foundry_derivative_rights_review_digest_shapes" CHECK (
    "derivative_rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "terms_custody_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "review_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "review_receipt_sha256" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_rights_review_decision" CHECK (
    "decision" IN ('accepted_for_registry_attestation', 'rejected')
  ),
  CONSTRAINT "foundry_derivative_rights_review_text" CHECK (
    "foundry_is_derivative_trimmed_text_v0"("rationale", 1, 2000)
    AND "idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_rights_review_times" CHECK (
    "reviewed_at" = date_trunc('milliseconds', "reviewed_at")
    AND "recorded_at" = date_trunc('milliseconds', "recorded_at")
    AND "reviewed_at" = "recorded_at"
    AND "reviewed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "reviewed_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_rights_review_json_objects" CHECK (
    jsonb_typeof("review_request_json") = 'object'
    AND jsonb_typeof("review_receipt_json") = 'object'
  )
);

CREATE INDEX "foundry_derivative_terms_custody_digest_idx"
  ON "foundry_derivative_terms_evidence_custody_v1"("sha256", "size_bytes", "recorded_at");

CREATE INDEX "foundry_derivative_rights_review_custody_idx"
  ON "foundry_derivative_rights_reviews_v1"("terms_custody_id", "reviewed_at");

CREATE FUNCTION "guard_foundry_derivative_terms_custody_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_request jsonb;
  expected_receipt jsonb;
  recorded_at_text text;
  database_now timestamptz;
  actor_platform_role varchar;
BEGIN
  SELECT actor."platform_role"
  INTO actor_platform_role
  FROM "users" actor
  WHERE actor."id" = NEW."registered_by_user_id"
  FOR SHARE;
  IF NOT FOUND OR actor_platform_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'derivative terms custody requires a current platform administrator actor'
      USING ERRCODE = '42501';
  END IF;

  database_now := date_trunc('milliseconds', clock_timestamp());
  NEW."captured_at" := database_now;
  NEW."recorded_at" := database_now;
  recorded_at_text := to_char(
    database_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  expected_request := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-terms-evidence-custody-request.v1',
    'artifactId', NEW."artifact_id",
    'mediaType', NEW."media_type",
    'contentSha256', NEW."sha256",
    'sizeBytes', NEW."size_bytes"
  );

  expected_receipt := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-terms-evidence-custody-receipt.v1',
    'custodyId', NEW."id"::text,
    'registrationRequestSha256', NEW."custody_request_sha256",
    'artifactId', NEW."artifact_id",
    'mediaType', NEW."media_type",
    'contentSha256', NEW."sha256",
    'sizeBytes', NEW."size_bytes",
    'storageMode', 'postgres_inline_bytea_v1',
    'capturedAt', recorded_at_text,
    'registeredByUserId', NEW."registered_by_user_id"::text,
    'verifiedAt', recorded_at_text,
    'authority', 'none',
    'executionEligible', false
  );

  IF NEW."authority" IS DISTINCT FROM 'none'
     OR NEW."execution_eligible" IS DISTINCT FROM false
     OR NEW."storage_mode" IS DISTINCT FROM 'postgres_inline_bytea_v1'
     OR NEW."sha256" IS DISTINCT FROM
       'sha256:' || encode(sha256(NEW."evidence_bytes"), 'hex')
     OR octet_length(NEW."evidence_bytes") IS DISTINCT FROM NEW."size_bytes"
     OR NEW."custody_request_json" IS DISTINCT FROM expected_request
     OR NEW."custody_request_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-terms-evidence-custody-request.v1',
         expected_request
       ) THEN
    RAISE EXCEPTION 'derivative terms custody row does not bind exact server-verified bytes and receipt'
      USING ERRCODE = '23514';
  END IF;

  NEW."custody_receipt_json" := expected_receipt;
  NEW."custody_receipt_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-terms-evidence-custody-receipt.v1',
      expected_receipt
    );

  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_rights_review_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  custody_row "foundry_derivative_terms_evidence_custody_v1"%ROWTYPE;
  expected_request jsonb;
  expected_receipt jsonb;
  reviewed_at_text text;
  database_now timestamptz;
  actor_platform_role varchar;
  current_policy_generation bigint;
BEGIN
  SELECT actor."platform_role"
  INTO actor_platform_role
  FROM "users" actor
  WHERE actor."id" = NEW."reviewed_by_user_id"
  FOR SHARE;
  IF NOT FOUND OR actor_platform_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'derivative-rights review requires a current platform administrator actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = NEW."approval_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative-rights approval does not exist' USING ERRCODE = '23503';
  END IF;

  PERFORM "foundry_lock_derivative_rights_policy_version"(
    approval_row."policy_version"
  );

  database_now := date_trunc('milliseconds', clock_timestamp());
  NEW."reviewed_at" := database_now;
  NEW."recorded_at" := database_now;

  SELECT policy."generation"
  INTO current_policy_generation
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = approval_row."policy_version"
    AND policy."effective_at" <= database_now
  ORDER BY policy."effective_at" DESC, policy."generation" DESC
  LIMIT 1;

  SELECT * INTO custody_row
  FROM "foundry_derivative_terms_evidence_custody_v1"
  WHERE "id" = NEW."terms_custody_id"
    AND "custody_receipt_sha256" = NEW."terms_custody_receipt_sha256"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative terms custody receipt does not exist' USING ERRCODE = '23503';
  END IF;

  reviewed_at_text := to_char(
    database_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  expected_request := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-review-request.v1',
    'approvalId', NEW."approval_id",
    'derivativeRightsApprovalSha256', NEW."derivative_rights_approval_sha256",
    'custodyId', NEW."terms_custody_id"::text,
    'custodyReceiptSha256', NEW."terms_custody_receipt_sha256",
    'decision', NEW."decision",
    'rationale', NEW."rationale"
  );

  expected_receipt := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-review-receipt.v1',
    'reviewId', NEW."id"::text,
    'reviewRequestSha256', NEW."review_request_sha256",
    'approvalId', NEW."approval_id",
    'derivativeRightsApprovalSha256', NEW."derivative_rights_approval_sha256",
    'custodyId', NEW."terms_custody_id"::text,
    'custodyReceiptSha256', NEW."terms_custody_receipt_sha256",
    'decision', NEW."decision",
    'rationale', NEW."rationale",
    'reviewedByUserId', NEW."reviewed_by_user_id"::text,
    'reviewedAt', reviewed_at_text,
    'authority', 'none',
    'executionEligible', false
  );

  IF NEW."authority" IS DISTINCT FROM 'none'
     OR NEW."execution_eligible" IS DISTINCT FROM false
     OR NEW."derivative_rights_approval_sha256"
       IS DISTINCT FROM approval_row."derivative_rights_approval_sha256"
     OR custody_row."artifact_id"
       IS DISTINCT FROM approval_row."terms_evidence_artifact_id"
     OR custody_row."sha256"
       IS DISTINCT FROM approval_row."terms_evidence_sha256"
     OR custody_row."size_bytes"
       IS DISTINCT FROM approval_row."terms_evidence_size_bytes"
     OR custody_row."media_type"
       IS DISTINCT FROM approval_row."terms_evidence_media_type"
     OR custody_row."captured_at"
       IS DISTINCT FROM approval_row."terms_evidence_captured_at"
     OR NEW."review_request_json" IS DISTINCT FROM expected_request
     OR NEW."review_request_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-review-request.v1',
         expected_request
       ) THEN
    RAISE EXCEPTION 'derivative-rights review does not bind the exact approval, custody bytes, actor, and receipt'
      USING ERRCODE = '23514';
  END IF;

  NEW."review_receipt_json" := expected_receipt;
  NEW."review_receipt_sha256" :=
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-review-receipt.v1',
      expected_receipt
    );

  IF NEW."decision" = 'accepted_for_registry_attestation' THEN
    IF current_policy_generation IS DISTINCT FROM approval_row."policy_generation" THEN
      RAISE EXCEPTION 'superseded derivative-rights approval cannot be accepted for registry attestation'
        USING ERRCODE = '23514';
    END IF;
    IF approval_row."expires_at" <= database_now THEN
      RAISE EXCEPTION 'expired derivative-rights approval cannot be accepted for registry attestation'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "foundry_derivative_rights_policy_revocations" revocation
      WHERE revocation."policy_version" = approval_row."policy_version"
        AND revocation."policy_definition_sha256" = approval_row."policy_definition_sha256"
        AND revocation."policy_generation" = approval_row."policy_generation"
        AND revocation."revoked_at" <= database_now
    ) THEN
      RAISE EXCEPTION 'revoked derivative-rights policy cannot be accepted for registry attestation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "foundry_derivative_terms_custody_guard"
  BEFORE INSERT ON "foundry_derivative_terms_evidence_custody_v1"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_terms_custody_v1"();

CREATE TRIGGER "foundry_derivative_rights_review_guard"
  BEFORE INSERT ON "foundry_derivative_rights_reviews_v1"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_rights_review_v1"();

CREATE TRIGGER "foundry_derivative_terms_custody_no_update"
  BEFORE UPDATE ON "foundry_derivative_terms_evidence_custody_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_terms_custody_no_delete"
  BEFORE DELETE ON "foundry_derivative_terms_evidence_custody_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_terms_custody_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_terms_evidence_custody_v1"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

CREATE TRIGGER "foundry_derivative_rights_reviews_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_reviews_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_rights_reviews_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_reviews_v1"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_rights_reviews_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_reviews_v1"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
