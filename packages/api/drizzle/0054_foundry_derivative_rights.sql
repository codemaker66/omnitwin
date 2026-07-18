-- -----------------------------------------------------------------------------
-- 0054_foundry_derivative_rights
--
-- Append-only evidence registries for the exact, single-GLB
-- normalize_mesh_glb/v0 derivative-rights contract. These rows are evidence,
-- not execution capabilities: this migration does not alter foundry_executions,
-- provider commands, admission, workers, or any V0 execution subject.
-- -----------------------------------------------------------------------------

CREATE TABLE "foundry_derivative_rights_policy_versions" (
  "authority" varchar(20) NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "generation" bigint NOT NULL,
  "maximum_approval_ttl_seconds" integer NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "policy_definition_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_derivative_policy_pk" PRIMARY KEY("policy_version", "generation"),
  CONSTRAINT "foundry_derivative_policy_generation_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "generation"
  ),
  CONSTRAINT "foundry_derivative_policy_subject_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "generation",
    "maximum_approval_ttl_seconds"
  ),
  CONSTRAINT "foundry_derivative_policy_actor_idem_unique" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_derivative_policy_evidence_only" CHECK (
    "authority" = 'none'
  ),
  CONSTRAINT "foundry_derivative_policy_key_shape" CHECK (
    "policy_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_policy_digest_shapes" CHECK (
    "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_policy_generation_bounds" CHECK (
    "generation" BETWEEN 1 AND 9007199254740991
    AND "maximum_approval_ttl_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "foundry_derivative_policy_times" CHECK (
    "effective_at" = date_trunc('milliseconds', "effective_at")
    AND "effective_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "effective_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_policy_json_object" CHECK (
    jsonb_typeof("policy_definition_json") = 'object'
  ),
  CONSTRAINT "foundry_derivative_policy_idempotency_key" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_derivative_rights_policy_revocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority" varchar(20) NOT NULL,
  "revocation_id" varchar(120) NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_generation" bigint NOT NULL,
  "revoked_at" timestamptz NOT NULL,
  "revoked_by" varchar(160) NOT NULL,
  "reason" text NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_derivative_revocation_policy_fk" FOREIGN KEY(
    "policy_version", "policy_definition_sha256", "policy_generation"
  ) REFERENCES "foundry_derivative_rights_policy_versions"(
    "policy_version", "policy_definition_sha256", "generation"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_derivative_revocation_exact_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "policy_generation",
    "revocation_sha256"
  ),
  CONSTRAINT "foundry_derivative_revocation_id_unique" UNIQUE("revocation_id"),
  CONSTRAINT "foundry_derivative_revocation_actor_idem_unique" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_derivative_revocation_evidence_only" CHECK (
    "authority" = 'none'
  ),
  CONSTRAINT "foundry_derivative_revocation_key_shape" CHECK (
    "revocation_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "policy_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_revocation_digest_shapes" CHECK (
    "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "revocation_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_revocation_generation" CHECK (
    "policy_generation" BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT "foundry_derivative_revocation_times" CHECK (
    "revoked_at" = date_trunc('milliseconds', "revoked_at")
    AND "revoked_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "revoked_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_revocation_text" CHECK (
    "foundry_is_canonical_actor"("revoked_by")
    AND char_length(btrim("reason")) BETWEEN 1 AND 2000
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "foundry_derivative_revocation_json_object" CHECK (
    jsonb_typeof("revocation_json") = 'object'
  )
);

CREATE INDEX "foundry_derivative_revocation_effective_idx"
  ON "foundry_derivative_rights_policy_revocations"(
    "policy_version", "policy_definition_sha256", "policy_generation",
    "revoked_at", "recorded_at", "id"
  );

CREATE TABLE "foundry_derivative_rights_approvals" (
  "approval_id" varchar(120) PRIMARY KEY NOT NULL,
  "authority" varchar(20) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "job_subject_sha256" varchar(71) NOT NULL,
  "ingest_manifest_sha256" varchar(71) NOT NULL,
  "job_spec_json" jsonb NOT NULL,
  "ingest_manifest_json" jsonb NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_generation" bigint NOT NULL,
  "policy_maximum_approval_ttl_seconds" integer NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "operation_id" varchar(96) NOT NULL,
  "derivative_class" varchar(120) NOT NULL,
  "asset_id" varchar(120) NOT NULL,
  "rights_basis" varchar(40) NOT NULL,
  "terms_reference" text NOT NULL,
  "terms_reviewed_at" timestamptz NOT NULL,
  "terms_evidence_artifact_id" varchar(120) NOT NULL,
  "terms_evidence_sha256" varchar(71) NOT NULL,
  "terms_evidence_size_bytes" bigint NOT NULL,
  "terms_evidence_media_type" varchar(160) NOT NULL,
  "terms_evidence_captured_at" timestamptz NOT NULL,
  "decision" varchar(20) NOT NULL,
  "decided_by" varchar(160) NOT NULL,
  "decided_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "derivative_rights_approval_sha256" varchar(71) NOT NULL,
  "derivative_rights_approval_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_derivative_approval_policy_fk" FOREIGN KEY(
    "policy_version", "policy_definition_sha256", "policy_generation",
    "policy_maximum_approval_ttl_seconds"
  ) REFERENCES "foundry_derivative_rights_policy_versions"(
    "policy_version", "policy_definition_sha256", "generation",
    "maximum_approval_ttl_seconds"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_derivative_approval_actor_idem_unique" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_derivative_approval_exact_subject_unique" UNIQUE(
    "approval_id", "job_id", "project_id", "job_subject_sha256",
    "ingest_manifest_sha256", "policy_version",
    "policy_definition_sha256", "policy_generation", "stage_id",
    "operation_id", "asset_id", "derivative_rights_approval_sha256"
  ),
  CONSTRAINT "foundry_derivative_approval_evidence_only" CHECK (
    "authority" = 'none' AND "decision" = 'allowed'
  ),
  CONSTRAINT "foundry_derivative_approval_key_shapes" CHECK (
    "approval_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "job_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "project_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "policy_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "stage_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "asset_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "terms_evidence_artifact_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_derivative_approval_digest_shapes" CHECK (
    "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "terms_evidence_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "derivative_rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_derivative_approval_policy_bounds" CHECK (
    "policy_generation" BETWEEN 1 AND 9007199254740991
    AND "policy_maximum_approval_ttl_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "foundry_derivative_approval_terms_artifact" CHECK (
    "terms_evidence_size_bytes" BETWEEN 1 AND 9007199254740991
    AND "rights_basis" IN (
      'customer_owned', 'explicit_licence', 'vendor_export_terms',
      'written_permission', 'public_domain'
    )
    AND "terms_reference" ~* '^https://[^[:space:]]+$'
    AND char_length(btrim("terms_evidence_media_type")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "foundry_derivative_approval_times" CHECK (
    "terms_evidence_captured_at" <= "terms_reviewed_at"
    AND "terms_reviewed_at" <= "decided_at"
    AND "decided_at" < "expires_at"
    AND "decided_at" <= "registered_at"
    AND "expires_at" > "registered_at"
    AND "expires_at" <= "decided_at"
      + make_interval(secs => "policy_maximum_approval_ttl_seconds")
    AND "terms_evidence_captured_at" = date_trunc('milliseconds', "terms_evidence_captured_at")
    AND "terms_reviewed_at" = date_trunc('milliseconds', "terms_reviewed_at")
    AND "decided_at" = date_trunc('milliseconds', "decided_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "terms_evidence_captured_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_derivative_approval_operation" CHECK (
    "operation_id" = 'normalize_mesh_glb/v0'
    AND "derivative_class" = 'lossless_internal_format_normalization'
  ),
  CONSTRAINT "foundry_derivative_approval_text" CHECK (
    "foundry_is_canonical_actor"("decided_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "foundry_derivative_approval_json_object" CHECK (
    jsonb_typeof("job_spec_json") = 'object'
    AND jsonb_typeof("ingest_manifest_json") = 'object'
    AND jsonb_typeof("derivative_rights_approval_json") = 'object'
  )
);

CREATE FUNCTION "foundry_lock_derivative_rights_policy_version"(
  policy_version_input varchar
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'foundry-derivative-rights-policy-version:' || policy_version_input, 0
  ));
END;
$$;

CREATE FUNCTION "foundry_is_derivative_trimmed_text_v0"(
  value_input text,
  minimum_utf16_length_input integer,
  maximum_utf16_length_input integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "foundry_utf16_length"(value_input)
           BETWEEN minimum_utf16_length_input AND maximum_utf16_length_input
    AND NOT (
      left(value_input, 1) = ANY(
        ARRAY[
          chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160),
          chr(5760), chr(8232), chr(8233), chr(8239), chr(8287), chr(12288),
          chr(65279)
        ] || ARRAY(SELECT chr(codepoint) FROM generate_series(8192, 8202) codepoint)
      )
      OR right(value_input, 1) = ANY(
        ARRAY[
          chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160),
          chr(5760), chr(8232), chr(8233), chr(8239), chr(8287), chr(12288),
          chr(65279)
        ] || ARRAY(SELECT chr(codepoint) FROM generate_series(8192, 8202) codepoint)
      )
    );
$$;

CREATE FUNCTION "foundry_is_derivative_restriction_dispositions_v0"(
  dispositions_input jsonb,
  restrictions_input jsonb,
  asset_id_input varchar,
  supporting_evidence_sha256_input varchar
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  disposition_row record;
  expected_index bigint;
  parsed_index numeric;
  expected_text text;
BEGIN
  IF jsonb_typeof(dispositions_input) IS DISTINCT FROM 'array'
     OR jsonb_typeof(restrictions_input) IS DISTINCT FROM 'array'
     OR jsonb_array_length(dispositions_input) <> jsonb_array_length(restrictions_input)
     OR jsonb_array_length(dispositions_input) > 50 THEN
    RETURN false;
  END IF;

  FOR disposition_row IN
    SELECT item.value, item.ordinality
    FROM jsonb_array_elements(dispositions_input) WITH ORDINALITY item(value, ordinality)
  LOOP
    expected_index := disposition_row.ordinality - 1;
    IF jsonb_typeof(disposition_row.value) IS DISTINCT FROM 'object'
       OR "foundry_jsonb_object_key_count"(disposition_row.value) <> 6
       OR NOT (disposition_row.value ?& ARRAY[
         'restrictionIndex', 'restrictionText', 'restrictionSha256',
         'disposition', 'rationale', 'supportingEvidenceSha256'
       ])
       OR jsonb_typeof(disposition_row.value->'restrictionIndex') IS DISTINCT FROM 'number'
       OR jsonb_typeof(disposition_row.value->'restrictionText') IS DISTINCT FROM 'string'
       OR jsonb_typeof(disposition_row.value->'restrictionSha256') IS DISTINCT FROM 'string'
       OR jsonb_typeof(disposition_row.value->'disposition') IS DISTINCT FROM 'string'
       OR jsonb_typeof(disposition_row.value->'rationale') IS DISTINCT FROM 'string'
       OR jsonb_typeof(disposition_row.value->'supportingEvidenceSha256') IS DISTINCT FROM 'string'
       OR jsonb_typeof(restrictions_input->(expected_index::integer)) IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;

    parsed_index := (disposition_row.value->'restrictionIndex' #>> '{}')::numeric;
    expected_text := restrictions_input->>(expected_index::integer);
    IF parsed_index <> trunc(parsed_index)
       OR parsed_index IS DISTINCT FROM expected_index::numeric
       OR "foundry_is_derivative_trimmed_text_v0"(
         expected_text, 1, 500
       ) IS NOT TRUE
       OR disposition_row.value->>'restrictionText' IS DISTINCT FROM expected_text
       OR disposition_row.value->>'restrictionSha256' IS DISTINCT FROM
         "foundry_ecmascript_domain_jsonb_sha256"(
           'omnitwin.foundry.derivative-rights-restriction.v0',
           jsonb_build_object(
             'assetId', asset_id_input,
             'restrictionIndex', expected_index,
             'restrictionText', expected_text
           )
         )
       OR disposition_row.value->>'disposition' NOT IN (
         'not_applicable_to_operation', 'satisfied', 'superseded_by_permission'
       )
       OR "foundry_is_derivative_trimmed_text_v0"(
         disposition_row.value->>'rationale', 1, 2000
       ) IS NOT TRUE
       OR disposition_row.value->>'supportingEvidenceSha256'
         IS DISTINCT FROM supporting_evidence_sha256_input THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN false;
END;
$$;

-- Migration 0053's reusable manifest validator intentionally covers only the
-- execution envelope and asset baseline. Derivative approvals admit a narrow,
-- source-only subset of the frozen TypeScript manifest contract so every value
-- persisted here is valid under that contract without duplicating its complex
-- transform, provenance, and generated-region graph validator in SQL.
--
-- The TypeScript URL rule accepts HTTPS schemes case-insensitively, whereas the
-- 0053 helper checks a lowercase scheme. Normalize only a temporary validation
-- copy; the stored manifest and every subject digest remain byte-exact.
CREATE FUNCTION "foundry_is_derivative_execution_ingest_manifest_v0"(
  value_input jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  normalized_assets jsonb;
  normalized_manifest jsonb;
BEGIN
  IF jsonb_typeof(value_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(value_input->'assets') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(asset.value) = 'object'
         AND jsonb_typeof(asset.value->'rights') = 'object'
         AND jsonb_typeof(asset.value->'rights'->'termsReference') = 'string'
         AND asset.value->'rights'->>'termsReference' ~* '^https://'
        THEN jsonb_set(
          asset.value,
          '{rights,termsReference}',
          to_jsonb(
            'https://' || substr(
              asset.value->'rights'->>'termsReference', 9
            )
          ),
          false
        )
        ELSE asset.value
      END
      ORDER BY asset.ordinality
    ),
    '[]'::jsonb
  )
  INTO normalized_assets
  FROM jsonb_array_elements(value_input->'assets')
       WITH ORDINALITY asset(value, ordinality);

  normalized_manifest := jsonb_set(
    value_input, '{assets}', normalized_assets, false
  );

  IF "foundry_is_execution_ingest_manifest"(normalized_manifest) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- This source-only lane makes all graph refinements exact by construction:
  -- no frames, transforms, producing provenance edges, or generated regions;
  -- and every asset has null/empty frame, calibration, and parent references.
  IF "foundry_is_derivative_trimmed_text_v0"(
       value_input->>'createdBy', 1, 160
     ) IS NOT TRUE
     OR value_input->'coordinateFrames' IS DISTINCT FROM '[]'::jsonb
     OR value_input->'transforms' IS DISTINCT FROM '[]'::jsonb
     OR value_input->'provenanceEdges' IS DISTINCT FROM '[]'::jsonb
     OR value_input->'generatedRegions' IS DISTINCT FROM '[]'::jsonb THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input->'sourceRoots') root(value)
    WHERE jsonb_typeof(root.value) IS DISTINCT FROM 'object'
       OR CASE WHEN jsonb_typeof(root.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(root.value) <> 6
            OR NOT (root.value ?& ARRAY[
              'id', 'kind', 'displayName', 'locationRedacted',
              'caseSensitivity', 'readOnly'
            ])
            OR jsonb_typeof(root.value->'id') IS DISTINCT FROM 'string'
            OR jsonb_typeof(root.value->'kind') IS DISTINCT FROM 'string'
            OR jsonb_typeof(root.value->'displayName') IS DISTINCT FROM 'string'
            OR jsonb_typeof(root.value->'locationRedacted') IS DISTINCT FROM 'string'
            OR jsonb_typeof(root.value->'caseSensitivity') IS DISTINCT FROM 'string'
            OR root.value->'readOnly' IS DISTINCT FROM 'true'::jsonb
            OR root.value->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
            OR root.value->>'kind' NOT IN (
              'local_directory', 'removable_media',
              'object_prefix', 'vendor_workspace'
            )
            OR "foundry_is_derivative_trimmed_text_v0"(
                 root.value->>'displayName', 1, 160
               ) IS NOT TRUE
            OR "foundry_is_derivative_trimmed_text_v0"(
                 root.value->>'locationRedacted', 1, 500
               ) IS NOT TRUE
            OR root.value->>'caseSensitivity' NOT IN (
              'sensitive', 'insensitive'
            )
          ELSE true END
  ) THEN
    RETURN false;
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT root.value->>'id')
    FROM jsonb_array_elements(value_input->'sourceRoots') root(value)
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input->'assets') asset(value)
    WHERE "foundry_is_derivative_trimmed_text_v0"(
            asset.value->>'mediaType', 1, 160
          ) IS NOT TRUE
       -- ASCII-only relative paths make PostgreSQL lower() identical to the
       -- frozen contract's JavaScript case folding for locator uniqueness.
       OR asset.value->>'relativePath'
            !~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
       OR asset.value->>'captureState' NOT IN (
         'raw_capture', 'official_export', 'reference'
       )
       OR asset.value->>'provenanceClass' NOT IN (
         'captured', 'enhanced_captured'
       )
       OR asset.value->'coordinateFrameId' IS DISTINCT FROM 'null'::jsonb
       OR asset.value->'calibrationAssetIds' IS DISTINCT FROM '[]'::jsonb
       OR asset.value->'parentAssetIds' IS DISTINCT FROM '[]'::jsonb
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           asset.value->'rights'->'restrictions'
         ) restriction(value)
         WHERE "foundry_is_derivative_trimmed_text_v0"(
                 restriction.value, 1, 500
               ) IS NOT TRUE
       )
       OR (
         asset.value->'rights'->'termsReference' <> 'null'::jsonb
         AND asset.value->'rights'->>'termsReference' !~*
           '^https://[a-z0-9]{1,63}(\.[a-z0-9]{1,63})?\.[a-z]{2,63}(/[a-z0-9._~/-]*)?$'
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           asset.value->'inspection'->'metadataKeys'
         ) metadata_key(value)
         WHERE "foundry_is_derivative_trimmed_text_v0"(
                 metadata_key.value, 1, 160
               ) IS NOT TRUE
       )
       OR "foundry_is_derivative_trimmed_text_v0"(
            asset.value->'inspection'->>'decisiveNextTest', 1, 1000
          ) IS NOT TRUE
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(asset.value->'notes') note(value)
         WHERE "foundry_is_derivative_trimmed_text_v0"(
                 note.value, 1, 500
               ) IS NOT TRUE
       )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input->'assets') asset(value)
    LEFT JOIN jsonb_array_elements(value_input->'sourceRoots') root(value)
      ON root.value->>'id' = asset.value->>'sourceRootId'
    WHERE root.value IS NULL
  ) THEN
    RETURN false;
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT jsonb_build_array(
      asset.value->>'sourceRootId',
      CASE
        WHEN root.value->>'caseSensitivity' = 'insensitive'
          THEN lower(asset.value->>'relativePath')
        ELSE asset.value->>'relativePath'
      END
    ))
    FROM jsonb_array_elements(value_input->'assets') asset(value)
    JOIN jsonb_array_elements(value_input->'sourceRoots') root(value)
      ON root.value->>'id' = asset.value->>'sourceRootId'
  ) THEN
    RETURN false;
  END IF;

  IF value_input->>'legalReviewState' = 'approved'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(value_input->'assets') asset(value)
       WHERE asset.value->'rights'->>'commercialUse' <> 'allowed'
          OR asset.value->'rights'->>'modelTrainingUse' <> 'allowed'
          OR asset.value->'rights'->>'redistribution' <> 'allowed'
          OR asset.value->'rights'->>'basis' = 'unknown'
          OR asset.value->'rights'->'termsReviewedAt' = 'null'::jsonb
          OR asset.value->'rights'->'termsReference' = 'null'::jsonb
          OR asset.value->>'accessState' = 'blocked_legal'
     ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_approval"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  policy_effective_at timestamptz;
  current_policy_generation bigint;
  earliest_revoked_at timestamptz;
  job_created_at timestamptz;
  estimated_cost_usd double precision;
  budget_cap_usd double precision;
  approval_policy_generation numeric;
  artifact_size_bytes numeric;
  bound_stage jsonb;
  bound_asset jsonb;
  bound_evidence jsonb;
  bound_artifact jsonb;
  bound_snapshot jsonb;
BEGIN
  NEW."registered_at" := clock_timestamp();
  PERFORM "foundry_lock_derivative_rights_policy_version"(NEW."policy_version");

  SELECT policy."effective_at"
  INTO policy_effective_at
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = NEW."policy_version"
    AND policy."policy_definition_sha256" = NEW."policy_definition_sha256"
    AND policy."generation" = NEW."policy_generation"
    AND policy."maximum_approval_ttl_seconds" =
          NEW."policy_maximum_approval_ttl_seconds";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative-rights approval misses its exact policy definition'
      USING ERRCODE = '23503';
  END IF;

  SELECT policy."generation"
  INTO current_policy_generation
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = NEW."policy_version"
    AND policy."effective_at" <= NEW."registered_at"
  ORDER BY policy."effective_at" DESC, policy."generation" DESC
  LIMIT 1;
  IF NOT FOUND OR current_policy_generation IS DISTINCT FROM NEW."policy_generation" THEN
    RAISE EXCEPTION 'derivative-rights approval must use the current effective policy generation'
      USING ERRCODE = '23514';
  END IF;

  SELECT min(revocation."revoked_at")
  INTO earliest_revoked_at
  FROM "foundry_derivative_rights_policy_revocations" revocation
  WHERE revocation."policy_version" = NEW."policy_version"
    AND revocation."policy_definition_sha256" = NEW."policy_definition_sha256"
    AND revocation."policy_generation" = NEW."policy_generation";
  IF earliest_revoked_at IS NOT NULL
     AND (
       earliest_revoked_at <= NEW."registered_at"
       OR NEW."expires_at" > earliest_revoked_at
     ) THEN
    RAISE EXCEPTION 'derivative-rights approval cannot use or outlive the earliest revocation'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."job_spec_json") IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(NEW."job_spec_json") <> 16
     OR NOT (NEW."job_spec_json" ?& ARRAY[
       'schemaVersion', 'id', 'projectId', 'ingestManifestSha256',
       'executionIntent', 'providerKind', 'providerAdapterId', 'stages',
       'objectStorageProfile', 'sourceMountMode', 'outputPrefix',
       'estimatedCostUsd', 'budgetCapUsd', 'killSwitchEnabled',
       'computeApprovalId', 'createdAt'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('id'), ('projectId'), ('ingestManifestSha256'),
         ('executionIntent'), ('providerKind'), ('providerAdapterId'),
         ('sourceMountMode'), ('outputPrefix'), ('createdAt')
       ) string_leaf(key)
       WHERE jsonb_typeof(NEW."job_spec_json"->string_leaf.key)
               IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(NEW."job_spec_json"->'stages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."job_spec_json"->'objectStorageProfile')
          NOT IN ('null', 'string')
     OR jsonb_typeof(NEW."job_spec_json"->'estimatedCostUsd')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."job_spec_json"->'budgetCapUsd')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."job_spec_json"->'killSwitchEnabled')
          IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW."job_spec_json"->'computeApprovalId')
          NOT IN ('null', 'string')
     OR "foundry_is_job_stage_array"(NEW."job_spec_json"->'stages') IS NOT TRUE THEN
    RAISE EXCEPTION 'derivative-rights job specification must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;

  estimated_cost_usd :=
    (NEW."job_spec_json"->'estimatedCostUsd' #>> '{}')::double precision;
  budget_cap_usd :=
    (NEW."job_spec_json"->'budgetCapUsd' #>> '{}')::double precision;
  IF estimated_cost_usd < 0
     OR budget_cap_usd < 0
     OR estimated_cost_usd > budget_cap_usd
     OR estimated_cost_usd * 1000000::double precision <>
          trunc(estimated_cost_usd * 1000000::double precision)
     OR budget_cap_usd * 1000000::double precision <>
          trunc(budget_cap_usd * 1000000::double precision)
     OR estimated_cost_usd * 1000000::double precision >
          9007199254740991::double precision
     OR budget_cap_usd * 1000000::double precision >
          9007199254740991::double precision THEN
    RAISE EXCEPTION 'derivative-rights job costs must be exact safe integer micro-USD values'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_is_canonical_utc_millisecond_text"(
       NEW."job_spec_json"->>'createdAt'
     ) IS NOT TRUE
     OR NEW."job_spec_json"->>'schemaVersion'
          IS DISTINCT FROM 'omnitwin.foundry.job-spec.v0'
     OR NEW."job_spec_json"->>'id' IS DISTINCT FROM NEW."job_id"
     OR NEW."job_spec_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
     OR NEW."job_spec_json"->>'ingestManifestSha256'
          IS DISTINCT FROM NEW."ingest_manifest_sha256"
     OR NEW."job_spec_json"->>'executionIntent' NOT IN ('plan_only', 'execute')
     OR NEW."job_spec_json"->>'providerKind' NOT IN (
       'local_cpu', 'local_cuda', 'runpod', 'aws', 'azure', 'gcp',
       'self_hosted_cluster', 'other'
     )
     OR NEW."job_spec_json"->>'providerAdapterId'
          !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     OR NEW."job_spec_json"->>'sourceMountMode' IS DISTINCT FROM 'read_only'
     OR "foundry_is_safe_relative_path"(
          NEW."job_spec_json"->>'outputPrefix'
        ) IS NOT TRUE
     OR (
       NEW."job_spec_json"->'objectStorageProfile' <> 'null'::jsonb
       AND NEW."job_spec_json"->>'objectStorageProfile'
             !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     )
     OR NEW."job_spec_json"->'killSwitchEnabled' IS DISTINCT FROM 'true'::jsonb
     OR (
       NEW."job_spec_json"->>'executionIntent' = 'plan_only'
       AND NEW."job_spec_json"->'computeApprovalId' <> 'null'::jsonb
     )
     OR (
       NEW."job_spec_json"->>'executionIntent' = 'execute'
       AND NEW."job_spec_json"->>'providerKind' IN ('local_cpu', 'local_cuda')
       AND NEW."job_spec_json"->'computeApprovalId' <> 'null'::jsonb
     )
     OR (
       NEW."job_spec_json"->>'executionIntent' = 'execute'
       AND NEW."job_spec_json"->>'providerKind' NOT IN ('local_cpu', 'local_cuda')
       AND (
         NEW."job_spec_json"->'computeApprovalId' = 'null'::jsonb
         OR NEW."job_spec_json"->>'computeApprovalId'
              !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       )
     )
     OR NEW."job_spec_sha256" IS DISTINCT FROM "foundry_ecmascript_domain_jsonb_sha256"(
       'omnitwin.foundry.job-spec.v0', NEW."job_spec_json"
     )
     OR NEW."job_subject_sha256" IS DISTINCT FROM "foundry_ecmascript_domain_jsonb_sha256"(
       'omnitwin.foundry.job-approval-subject.v0', NEW."job_spec_json"
     ) THEN
    RAISE EXCEPTION 'derivative-rights job specification must bind its exact local subject'
      USING ERRCODE = '23514';
  END IF;
  job_created_at := (NEW."job_spec_json"->>'createdAt')::timestamptz;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value)
    WHERE stage.value->'rightsPurposes' ?| ARRAY[
      'model_training', 'redistribution', 'public_release'
    ]
  ) THEN
    RAISE EXCEPTION 'derivative-rights jobs cannot contain a forbidden downstream use'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_is_derivative_execution_ingest_manifest_v0"(
       NEW."ingest_manifest_json"
     ) IS NOT TRUE
     OR NEW."ingest_manifest_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
     OR NEW."ingest_manifest_json"->>'legalReviewState' = 'blocked'
     OR NEW."ingest_manifest_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.ingest-manifest.v0', NEW."ingest_manifest_json"
       ) THEN
    RAISE EXCEPTION 'derivative-rights ingest manifest must bind the exact unblocked project'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH referenced_input AS (
      SELECT stage.value AS stage_value, input_asset_id.value AS asset_id
      FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        stage.value->'inputAssetIds'
      ) input_asset_id(value)
    ), declared_asset AS (
      SELECT asset.value AS asset_value, asset.value->>'id' AS asset_id
      FROM jsonb_array_elements(NEW."ingest_manifest_json"->'assets') asset(value)
    )
    SELECT 1
    FROM referenced_input input
    LEFT JOIN declared_asset asset ON asset.asset_id = input.asset_id
    WHERE asset.asset_value IS NULL
       OR asset.asset_value->>'accessState' = 'blocked_legal'
       OR asset.asset_value->'rights'->>'basis' = 'unknown'
       OR asset.asset_value->'rights'->'termsReviewedAt' = 'null'::jsonb
       OR asset.asset_value->'rights'->'termsReference' = 'null'::jsonb
       OR asset.asset_value->'rights'->>'commercialUse' <> 'allowed'
       OR (
         input.stage_value->'rightsPurposes' @> '["model_training"]'::jsonb
         AND asset.asset_value->'rights'->>'modelTrainingUse' <> 'allowed'
       )
       OR (
         (
           input.stage_value->'rightsPurposes' @> '["redistribution"]'::jsonb
           OR input.stage_value->'rightsPurposes' @> '["public_release"]'::jsonb
         )
         AND asset.asset_value->'rights'->>'redistribution' <> 'allowed'
       )
  ) THEN
    RAISE EXCEPTION 'derivative-rights job inputs fail the static manifest rights gate'
      USING ERRCODE = '23514';
  END IF;

  SELECT stage.value
  INTO bound_stage
  FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value)
  WHERE stage.value->>'id' = NEW."stage_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative-rights approval stage is absent from the exact job subject'
      USING ERRCODE = '23514';
  END IF;
  IF bound_stage->>'kind' IS DISTINCT FROM 'geometry'
     OR bound_stage->'command' IS DISTINCT FROM
       '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
     OR bound_stage->>'networkAccess' IS DISTINCT FROM 'none'
     OR bound_stage->'rightsPurposes' IS DISTINCT FROM
       '["commercial_internal_use"]'::jsonb
     OR bound_stage->'inputAssetIds' IS DISTINCT FROM jsonb_build_array(NEW."asset_id") THEN
    RAISE EXCEPTION 'derivative-rights approval stage misses the exact singleton operation binding'
      USING ERRCODE = '23514';
  END IF;

  SELECT asset.value
  INTO bound_asset
  FROM jsonb_array_elements(NEW."ingest_manifest_json"->'assets') asset(value)
  WHERE asset.value->>'id' = NEW."asset_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative-rights approval asset is absent from the exact manifest'
      USING ERRCODE = '23514';
  END IF;
  IF bound_asset->>'inputType' IS DISTINCT FROM 'glb_gltf'
     OR bound_asset->>'mediaType' IS DISTINCT FROM 'model/gltf-binary'
     OR right(lower(bound_asset->>'relativePath'), 4) IS DISTINCT FROM '.glb' THEN
    RAISE EXCEPTION 'derivative-rights approval asset misses the exact GLB operation binding'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."derivative_rights_approval_json") IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(
          NEW."derivative_rights_approval_json"
        ) <> 18
     OR NOT (NEW."derivative_rights_approval_json" ?& ARRAY[
       'schemaVersion', 'approvalId', 'policyVersion',
       'policyDefinitionSha256', 'policyGeneration', 'jobSubjectSha256',
       'ingestManifestSha256', 'stageId', 'operation', 'authorizedActions',
       'forbiddenDownstreamUses', 'assetIds', 'assetRightsEvidence',
       'assetSnapshots', 'decision', 'decidedBy', 'decidedAt', 'expiresAt'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('approvalId'), ('policyVersion'),
         ('policyDefinitionSha256'), ('jobSubjectSha256'),
         ('ingestManifestSha256'), ('stageId'), ('decision'), ('decidedBy'),
         ('decidedAt'), ('expiresAt')
       ) string_leaf(key)
       WHERE jsonb_typeof(
         NEW."derivative_rights_approval_json"->string_leaf.key
       ) IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(
          NEW."derivative_rights_approval_json"->'policyGeneration'
        ) IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."derivative_rights_approval_json"->'operation')
          IS DISTINCT FROM 'object'
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('authorizedActions'), ('forbiddenDownstreamUses'), ('assetIds'),
         ('assetRightsEvidence'), ('assetSnapshots')
       ) array_leaf(key)
       WHERE jsonb_typeof(
         NEW."derivative_rights_approval_json"->array_leaf.key
       ) IS DISTINCT FROM 'array'
     ) THEN
    RAISE EXCEPTION 'derivative-rights approval must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  approval_policy_generation := (
    NEW."derivative_rights_approval_json"->'policyGeneration' #>> '{}'
  )::numeric;
  IF approval_policy_generation <> trunc(approval_policy_generation)
     OR approval_policy_generation NOT BETWEEN 1 AND 9007199254740991::numeric
     OR approval_policy_generation IS DISTINCT FROM NEW."policy_generation"::numeric
     OR "foundry_jsonb_object_key_count"(
          NEW."derivative_rights_approval_json"->'operation'
        ) <> 2
     OR NOT (NEW."derivative_rights_approval_json"->'operation' ?& ARRAY[
       'operationId', 'derivativeClass'
     ])
     OR jsonb_typeof(
          NEW."derivative_rights_approval_json"->'operation'->'operationId'
        ) IS DISTINCT FROM 'string'
     OR jsonb_typeof(
          NEW."derivative_rights_approval_json"->'operation'->'derivativeClass'
        ) IS DISTINCT FROM 'string'
     OR NEW."derivative_rights_approval_json"->'operation'
          IS DISTINCT FROM jsonb_build_object(
            'operationId', NEW."operation_id",
            'derivativeClass', NEW."derivative_class"
          )
     OR NEW."derivative_rights_approval_json"->'authorizedActions'
          IS DISTINCT FROM '["read_source","create_internal_derivative"]'::jsonb
     OR NEW."derivative_rights_approval_json"->'forbiddenDownstreamUses'
          IS DISTINCT FROM '["model_training","redistribution","public_release"]'::jsonb
     OR NEW."derivative_rights_approval_json"->'assetIds'
          IS DISTINCT FROM jsonb_build_array(NEW."asset_id")
     OR jsonb_array_length(
          NEW."derivative_rights_approval_json"->'assetRightsEvidence'
        ) <> 1
     OR jsonb_array_length(
          NEW."derivative_rights_approval_json"->'assetSnapshots'
        ) <> 1 THEN
    RAISE EXCEPTION 'derivative-rights approval misses an exact operation or singleton binding'
      USING ERRCODE = '23514';
  END IF;

  bound_evidence :=
    NEW."derivative_rights_approval_json"->'assetRightsEvidence'->0;
  bound_snapshot := NEW."derivative_rights_approval_json"->'assetSnapshots'->0;
  -- The snapshot is validated by byte-exact JSON equality with bound_asset,
  -- which already passed the stricter derivative manifest validator.
  IF jsonb_typeof(bound_evidence) IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(bound_evidence) <> 7
     OR NOT (bound_evidence ?& ARRAY[
       'assetId', 'basis', 'termsReference', 'reviewedAt',
       'termsEvidenceArtifact', 'restrictionsReviewed',
       'restrictionDispositions'
     ])
     OR jsonb_typeof(bound_evidence->'assetId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_evidence->'basis') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_evidence->'termsReference') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_evidence->'reviewedAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_evidence->'termsEvidenceArtifact')
          IS DISTINCT FROM 'object'
     OR jsonb_typeof(bound_evidence->'restrictionsReviewed')
          IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(bound_evidence->'restrictionDispositions')
          IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'derivative-rights evidence must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  bound_artifact := bound_evidence->'termsEvidenceArtifact';
  IF "foundry_jsonb_object_key_count"(bound_artifact) <> 5
     OR NOT (bound_artifact ?& ARRAY[
       'artifactId', 'sha256', 'sizeBytes', 'mediaType', 'capturedAt'
     ])
     OR jsonb_typeof(bound_artifact->'artifactId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_artifact->'sha256') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_artifact->'sizeBytes') IS DISTINCT FROM 'number'
     OR jsonb_typeof(bound_artifact->'mediaType') IS DISTINCT FROM 'string'
     OR jsonb_typeof(bound_artifact->'capturedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'derivative-rights terms artifact must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  artifact_size_bytes := (bound_artifact->'sizeBytes' #>> '{}')::numeric;
  IF artifact_size_bytes <> trunc(artifact_size_bytes)
     OR artifact_size_bytes NOT BETWEEN 1 AND 9007199254740991::numeric
     OR artifact_size_bytes IS DISTINCT FROM NEW."terms_evidence_size_bytes"::numeric
     OR bound_evidence->>'assetId' IS DISTINCT FROM NEW."asset_id"
     OR bound_evidence->>'basis' IS DISTINCT FROM NEW."rights_basis"
     OR bound_evidence->>'termsReference' IS DISTINCT FROM NEW."terms_reference"
     OR bound_evidence->>'termsReference' !~* '^https://[^[:space:]]+$'
     OR bound_evidence->>'reviewedAt' IS DISTINCT FROM to_char(
       NEW."terms_reviewed_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR "foundry_is_canonical_utc_millisecond_text"(
          bound_evidence->>'reviewedAt'
        ) IS NOT TRUE
     OR bound_evidence->'restrictionsReviewed' IS DISTINCT FROM 'true'::jsonb
     OR bound_artifact->>'artifactId'
          IS DISTINCT FROM NEW."terms_evidence_artifact_id"
     OR bound_artifact->>'artifactId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     OR bound_artifact->>'sha256' IS DISTINCT FROM NEW."terms_evidence_sha256"
     OR bound_artifact->>'sha256' !~ '^sha256:[a-f0-9]{64}$'
     OR bound_artifact->>'mediaType'
          IS DISTINCT FROM NEW."terms_evidence_media_type"
     OR "foundry_is_derivative_trimmed_text_v0"(
          bound_artifact->>'mediaType', 1, 160
        ) IS NOT TRUE
     OR bound_artifact->>'capturedAt' IS DISTINCT FROM to_char(
       NEW."terms_evidence_captured_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR "foundry_is_canonical_utc_millisecond_text"(
          bound_artifact->>'capturedAt'
        ) IS NOT TRUE
     OR "foundry_is_derivative_restriction_dispositions_v0"(
          bound_evidence->'restrictionDispositions',
          bound_asset->'rights'->'restrictions',
          NEW."asset_id",
          NEW."terms_evidence_sha256"
        ) IS NOT TRUE
     OR bound_snapshot IS DISTINCT FROM bound_asset
     OR bound_asset->'rights'->>'basis' IS DISTINCT FROM NEW."rights_basis"
     OR bound_asset->'rights'->>'termsReference'
          IS DISTINCT FROM NEW."terms_reference"
     OR bound_asset->'rights'->>'termsReviewedAt' IS DISTINCT FROM to_char(
       NEW."terms_reviewed_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     ) THEN
    RAISE EXCEPTION 'derivative-rights evidence must bind the exact asset, terms, and restrictions'
      USING ERRCODE = '23514';
  END IF;

  IF job_created_at > NEW."decided_at"
     OR policy_effective_at > NEW."decided_at"
     OR NEW."derivative_rights_approval_json"->>'schemaVersion'
          IS DISTINCT FROM 'omnitwin.foundry.derivative-rights-approval.v0'
     OR NEW."derivative_rights_approval_json"->>'approvalId'
          IS DISTINCT FROM NEW."approval_id"
     OR NEW."derivative_rights_approval_json"->>'policyVersion'
          IS DISTINCT FROM NEW."policy_version"
     OR NEW."derivative_rights_approval_json"->>'policyDefinitionSha256'
          IS DISTINCT FROM NEW."policy_definition_sha256"
     OR NEW."derivative_rights_approval_json"->>'jobSubjectSha256'
          IS DISTINCT FROM NEW."job_subject_sha256"
     OR NEW."derivative_rights_approval_json"->>'ingestManifestSha256'
          IS DISTINCT FROM NEW."ingest_manifest_sha256"
     OR NEW."derivative_rights_approval_json"->>'stageId'
          IS DISTINCT FROM NEW."stage_id"
     OR NEW."derivative_rights_approval_json"->>'decision'
          IS DISTINCT FROM NEW."decision"
     OR NEW."derivative_rights_approval_json"->>'decidedBy'
          IS DISTINCT FROM NEW."decided_by"
     OR NEW."derivative_rights_approval_json"->>'decidedAt' IS DISTINCT FROM to_char(
       NEW."decided_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR "foundry_is_canonical_utc_millisecond_text"(
          NEW."derivative_rights_approval_json"->>'decidedAt'
        ) IS NOT TRUE
     OR NEW."derivative_rights_approval_json"->>'expiresAt' IS DISTINCT FROM to_char(
       NEW."expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR "foundry_is_canonical_utc_millisecond_text"(
          NEW."derivative_rights_approval_json"->>'expiresAt'
        ) IS NOT TRUE
     OR NEW."derivative_rights_approval_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-approval.v0',
         NEW."derivative_rights_approval_json"
       )
     OR NEW."request_digest" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-approval-registration.v0',
         jsonb_build_object(
           'authority', NEW."authority",
           'approval', NEW."derivative_rights_approval_json",
           'idempotencyKey', NEW."idempotency_key",
           'ingestManifest', NEW."ingest_manifest_json",
           'jobSpec', NEW."job_spec_json",
           'registeredByUserId', NEW."registered_by_user_id"::text
         )
       ) THEN
    RAISE EXCEPTION 'derivative-rights approval must bind the exact policy, job, and evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation
    OR numeric_value_out_of_range
    OR invalid_datetime_format
    OR datetime_field_overflow THEN
    RAISE EXCEPTION 'derivative-rights approval contains an invalid bounded value'
      USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_policy_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_generation bigint;
  latest_effective_at timestamptz;
  generation_json numeric;
  maximum_ttl_json numeric;
BEGIN
  NEW."registered_at" := clock_timestamp();
  PERFORM "foundry_lock_derivative_rights_policy_version"(NEW."policy_version");

  SELECT max(policy."generation"), max(policy."effective_at")
  INTO latest_generation, latest_effective_at
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = NEW."policy_version";

  IF jsonb_typeof(NEW."policy_definition_json") IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(NEW."policy_definition_json") <> 11
     OR NOT (NEW."policy_definition_json" ?& ARRAY[
       'schemaVersion', 'policyVersion', 'generation', 'effectiveAt',
       'maximumApprovalTtlSeconds', 'requireNonUnknownRightsBasis',
       'requireHttpsTermsReference', 'requireTermsReviewedAt',
       'authorizedActions', 'forbiddenDownstreamUses', 'operations'
     ])
     OR jsonb_typeof(NEW."policy_definition_json"->'schemaVersion') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'policyVersion') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'generation') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."policy_definition_json"->'effectiveAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'maximumApprovalTtlSeconds') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."policy_definition_json"->'requireNonUnknownRightsBasis') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW."policy_definition_json"->'requireHttpsTermsReference') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW."policy_definition_json"->'requireTermsReviewedAt') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW."policy_definition_json"->'authorizedActions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."policy_definition_json"->'forbiddenDownstreamUses') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."policy_definition_json"->'operations') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'derivative-rights policy must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  generation_json := (NEW."policy_definition_json"->'generation' #>> '{}')::numeric;
  maximum_ttl_json :=
    (NEW."policy_definition_json"->'maximumApprovalTtlSeconds' #>> '{}')::numeric;
  IF generation_json <> trunc(generation_json)
     OR generation_json NOT BETWEEN 1 AND 9007199254740991::numeric
     OR maximum_ttl_json <> trunc(maximum_ttl_json)
     OR maximum_ttl_json NOT BETWEEN 1 AND 31536000::numeric
     OR generation_json IS DISTINCT FROM NEW."generation"::numeric
     OR maximum_ttl_json IS DISTINCT FROM NEW."maximum_approval_ttl_seconds"::numeric THEN
    RAISE EXCEPTION 'derivative-rights policy generation and TTL must be bounded exact integers'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."generation" <> COALESCE(latest_generation, 0) + 1
     OR (latest_effective_at IS NOT NULL AND NEW."effective_at" <= latest_effective_at)
     OR NEW."policy_definition_json"->>'schemaVersion'
       IS DISTINCT FROM 'omnitwin.foundry.derivative-rights-policy.v0'
     OR NEW."policy_definition_json"->>'policyVersion' IS DISTINCT FROM NEW."policy_version"
     OR NEW."policy_definition_json"->>'effectiveAt' IS DISTINCT FROM to_char(
       NEW."effective_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."policy_definition_json"->'requireNonUnknownRightsBasis'
       IS DISTINCT FROM 'true'::jsonb
     OR NEW."policy_definition_json"->'requireHttpsTermsReference'
       IS DISTINCT FROM 'true'::jsonb
     OR NEW."policy_definition_json"->'requireTermsReviewedAt'
       IS DISTINCT FROM 'true'::jsonb
     OR NEW."policy_definition_json"->'authorizedActions'
       IS DISTINCT FROM '["read_source","create_internal_derivative"]'::jsonb
     OR NEW."policy_definition_json"->'forbiddenDownstreamUses'
       IS DISTINCT FROM '["model_training","redistribution","public_release"]'::jsonb
     OR NEW."policy_definition_json"->'operations' IS DISTINCT FROM '[{
       "operationId":"normalize_mesh_glb/v0",
       "derivativeClass":"lossless_internal_format_normalization",
       "requiredStageKind":"geometry",
       "requiredInputType":"glb_gltf",
       "requiredMediaType":"model/gltf-binary",
       "requiredFileExtension":".glb",
       "requiredAssetCount":1,
       "requiredRightsPurposes":["commercial_internal_use"],
       "requiredCommand":["omnitwin-sealed-worker","normalize_mesh_glb","v0"],
       "requiredNetworkAccess":"none",
       "deterministic":true
     }]'::jsonb
     OR NEW."policy_definition_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.derivative-rights-policy.v0',
         NEW."policy_definition_json"
       )
     OR NEW."request_digest" IS DISTINCT FROM "foundry_ecmascript_domain_jsonb_sha256"(
       'omnitwin.foundry.derivative-rights-policy-registration.v0',
       jsonb_build_object(
         'authority', NEW."authority",
         'idempotencyKey', NEW."idempotency_key",
         'policyDefinition', NEW."policy_definition_json",
         'registeredByUserId', NEW."registered_by_user_id"::text
       )
     ) THEN
    RAISE EXCEPTION 'derivative-rights policy must bind the exact immutable definition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'derivative-rights policy contains an invalid bounded integer'
      USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_policy_revocation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  policy_effective_at timestamptz;
  generation_json numeric;
BEGIN
  NEW."id" := gen_random_uuid();
  NEW."recorded_at" := clock_timestamp();
  PERFORM "foundry_lock_derivative_rights_policy_version"(NEW."policy_version");

  SELECT policy."effective_at"
  INTO policy_effective_at
  FROM "foundry_derivative_rights_policy_versions" policy
  WHERE policy."policy_version" = NEW."policy_version"
    AND policy."policy_definition_sha256" = NEW."policy_definition_sha256"
    AND policy."generation" = NEW."policy_generation";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'derivative-rights revocation misses its exact policy definition'
      USING ERRCODE = '23503';
  END IF;
  IF NEW."revoked_at" <= policy_effective_at THEN
    RAISE EXCEPTION 'derivative-rights revocation must follow policy effectiveness'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."revocation_json") IS DISTINCT FROM 'object'
     OR "foundry_jsonb_object_key_count"(NEW."revocation_json") <> 8
     OR NOT (NEW."revocation_json" ?& ARRAY[
       'schemaVersion', 'revocationId', 'policyVersion',
       'policyDefinitionSha256', 'policyGeneration', 'revokedAt',
       'revokedBy', 'reason'
     ])
     OR jsonb_typeof(NEW."revocation_json"->'schemaVersion') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'revocationId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'policyVersion') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'policyDefinitionSha256') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'policyGeneration') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."revocation_json"->'revokedAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'revokedBy') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."revocation_json"->'reason') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'derivative-rights revocation must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  generation_json := (NEW."revocation_json"->'policyGeneration' #>> '{}')::numeric;
  IF generation_json <> trunc(generation_json)
     OR generation_json NOT BETWEEN 1 AND 9007199254740991::numeric
     OR generation_json IS DISTINCT FROM NEW."policy_generation"::numeric
     OR NEW."revocation_json"->>'schemaVersion' IS DISTINCT FROM
       'omnitwin.foundry.derivative-rights-policy-revocation.v0'
     OR NEW."revocation_json"->>'revocationId' IS DISTINCT FROM NEW."revocation_id"
     OR NEW."revocation_json"->>'policyVersion' IS DISTINCT FROM NEW."policy_version"
     OR NEW."revocation_json"->>'policyDefinitionSha256'
       IS DISTINCT FROM NEW."policy_definition_sha256"
     OR NEW."revocation_json"->>'revokedAt' IS DISTINCT FROM to_char(
       NEW."revoked_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."revocation_json"->>'revokedBy' IS DISTINCT FROM NEW."revoked_by"
     OR NEW."revocation_json"->>'reason' IS DISTINCT FROM NEW."reason"
     OR "foundry_is_derivative_trimmed_text_v0"(
       NEW."reason", 1, 2000
     ) IS NOT TRUE
     OR NEW."revocation_sha256" IS DISTINCT FROM "foundry_ecmascript_domain_jsonb_sha256"(
       'omnitwin.foundry.derivative-rights-policy-revocation.v0',
       NEW."revocation_json"
     )
     OR NEW."request_digest" IS DISTINCT FROM "foundry_ecmascript_domain_jsonb_sha256"(
       'omnitwin.foundry.derivative-rights-revocation-registration.v0',
       jsonb_build_object(
         'authority', NEW."authority",
         'idempotencyKey', NEW."idempotency_key",
         'registeredByUserId', NEW."registered_by_user_id"::text,
         'revocation', NEW."revocation_json"
       )
     ) THEN
    RAISE EXCEPTION 'derivative-rights revocation must bind its exact policy and evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'derivative-rights revocation contains an invalid generation'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "foundry_derivative_policy_version_guard"
  BEFORE INSERT ON "foundry_derivative_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_policy_version"();
CREATE TRIGGER "foundry_derivative_policy_revocation_guard"
  BEFORE INSERT ON "foundry_derivative_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_policy_revocation"();
CREATE TRIGGER "foundry_derivative_approval_guard"
  BEFORE INSERT ON "foundry_derivative_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_approval"();

-- These registry rows are evidence only and remain permanently append-only.
CREATE TRIGGER "foundry_derivative_policies_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_policies_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_policies_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_policy_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

CREATE TRIGGER "foundry_derivative_revocations_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_revocations_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_revocations_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_policy_revocations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

CREATE TRIGGER "foundry_derivative_approvals_no_update"
  BEFORE UPDATE ON "foundry_derivative_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_approvals_no_delete"
  BEFORE DELETE ON "foundry_derivative_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_derivative_approvals_no_truncate"
  BEFORE TRUNCATE ON "foundry_derivative_rights_approvals"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
