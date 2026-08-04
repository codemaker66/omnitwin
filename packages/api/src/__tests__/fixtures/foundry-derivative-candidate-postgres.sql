-- Test-only disposable-PostgreSQL fixture for migrations 0053-0057.
--
-- This file is deliberately not a migration.  The live harness loads it only
-- after replaying the real migration chain into a throwaway PostgreSQL
-- container.  Every source row below is inserted with all production triggers
-- enabled; no trigger, constraint, or session replication setting is changed.

CREATE FUNCTION "foundry_test_sha256"(value_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(value_input, 'UTF8')), 'hex');
$$;

CREATE TABLE "foundry_test_derivative_graphs" (
  "suffix" varchar(40) PRIMARY KEY,
  "actor_user_id" uuid NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "approval_id" varchar(120) NOT NULL,
  "custody_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  "attestation_id" uuid,
  "base_execution_subject_sha256" varchar(71) NOT NULL,
  "base_execution_subject_json" jsonb NOT NULL
);

CREATE FUNCTION "foundry_test_create_derivative_graph"(
  suffix_input text,
  create_attestation_input boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id constant uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  graph_now timestamptz;
  old_time timestamptz;
  future_time timestamptz;
  job_created_at timestamptz;
  pricing_observed_at timestamptz;
  plan_time timestamptz;
  pricing_expires_at timestamptz;
  dispatch_deadline timestamptz;
  suffix_value varchar(40);
  suffix_uuid uuid;
  project_id_value varchar(120);
  job_id_value varchar(120);
  envelope_id_value varchar(120);
  stage_id_value varchar(120);
  asset_id_value varchar(120);
  source_root_id_value varchar(120);
  approval_id_value varchar(120);
  derivative_policy_version_value varchar(120);
  base_policy_version_value varchar(120);
  adapter_id_value varchar(120);
  deployment_id_value varchar(120);
  worker_profile_id_value varchar(120);
  container_image_value text;
  terms_reference_value text;
  evidence_bytes_value bytea;
  evidence_sha256_value varchar(71);
  evidence_size_value bigint;
  custody_row "foundry_derivative_terms_evidence_custody_v1"%ROWTYPE;
  review_row "foundry_derivative_rights_reviews_v1"%ROWTYPE;
  attestation_row "foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
  manifest_json jsonb;
  manifest_sha256 varchar(71);
  job_stage_json jsonb;
  job_spec_json jsonb;
  job_spec_sha256 varchar(71);
  job_subject_sha256 varchar(71);
  intake_capabilities jsonb;
  intake_result_payload jsonb;
  intake_result_json jsonb;
  intake_result_sha256 varchar(71);
  staging_capabilities jsonb;
  staging_files jsonb;
  staging_payload jsonb;
  staging_json jsonb;
  staging_sha256 varchar(71);
  execution_policy_json jsonb;
  execution_policy_sha256 varchar(71);
  adapter_artifact_sha256 varchar(71);
  deployment_json jsonb;
  deployment_sha256 varchar(71);
  worker_profile_json jsonb;
  worker_profile_sha256 varchar(71);
  worker_profile_set_sha256 varchar(71);
  pricing_snapshot_sha256 varchar(71);
  provider_plan_json jsonb;
  provider_plan_sha256 varchar(71);
  execution_envelope_json jsonb;
  execution_envelope_sha256 varchar(71);
  base_policy_definition_sha256 varchar(71);
  base_policy_evidence_sha256 varchar(71);
  base_policy_json jsonb;
  base_rights_approval_json jsonb;
  base_rights_approval_sha256 varchar(71);
  confirmation_json jsonb;
  confirmation_sha256 varchar(71);
  derivative_policy_json jsonb;
  derivative_policy_sha256 varchar(71);
  restriction_text_value text := 'Internal lossless derivatives only.';
  restriction_sha256 varchar(71);
  asset_json jsonb;
  restriction_disposition_json jsonb;
  derivative_approval_json jsonb;
  derivative_approval_sha256 varchar(71);
  custody_request_json jsonb;
  custody_request_sha256 varchar(71);
  review_request_json jsonb;
  review_request_sha256 varchar(71);
  attestation_request_json jsonb;
  attestation_request_sha256 varchar(71);
  base_subject_json jsonb;
  base_subject_sha256 varchar(71);
BEGIN
  IF suffix_input !~ '^[a-z0-9][a-z0-9-]{0,39}$' THEN
    RAISE EXCEPTION 'invalid disposable fixture suffix';
  END IF;
  suffix_value := suffix_input;
  suffix_uuid := (
    substr(md5('foundry-derivative-fixture:' || suffix_value), 1, 8) || '-' ||
    substr(md5('foundry-derivative-fixture:' || suffix_value), 9, 4) || '-4' ||
    substr(md5('foundry-derivative-fixture:' || suffix_value), 14, 3) || '-8' ||
    substr(md5('foundry-derivative-fixture:' || suffix_value), 18, 3) || '-' ||
    substr(md5('foundry-derivative-fixture:' || suffix_value), 21, 12)
  )::uuid;
  graph_now := date_trunc('milliseconds', clock_timestamp());
  old_time := graph_now - interval '2 minutes';
  future_time := graph_now + interval '2 hours';

  project_id_value := 'project-' || suffix_value;
  job_id_value := 'job-' || suffix_value;
  envelope_id_value := 'envelope-' || suffix_value;
  stage_id_value := 'normalize-' || suffix_value;
  asset_id_value := 'mesh-' || suffix_value;
  source_root_id_value := 'root-' || suffix_value;
  approval_id_value := 'derivative-approval-' || suffix_value;
  derivative_policy_version_value := 'derivative-policy-' || suffix_value;
  base_policy_version_value := 'base-rights-policy-' || suffix_value;
  adapter_id_value := 'local-adapter-' || suffix_value;
  deployment_id_value := 'local-deployment-' || suffix_value;
  worker_profile_id_value := 'normalize-worker-' || suffix_value;
  container_image_value :=
    'ghcr.io/omnitwin/normalize@sha256:' || repeat('1', 64);
  terms_reference_value := 'https://rights.example/' || suffix_value;

  INSERT INTO "users" (
    "id", "email", "name", "role", "platform_role"
  ) VALUES (
    actor_id, 'foundry-fixture-admin@example.test',
    'Foundry fixture administrator', 'admin', 'admin'
  ) ON CONFLICT ("id") DO NOTHING;

  -- Custody must be created first because its production trigger supplies the
  -- database-authenticated evidence capture instant bound by every later row.
  evidence_bytes_value := convert_to('fixture terms evidence:' || suffix_value, 'UTF8');
  evidence_size_value := octet_length(evidence_bytes_value);
  evidence_sha256_value :=
    'sha256:' || encode(sha256(evidence_bytes_value), 'hex');
  custody_request_json := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-terms-evidence-custody-request.v1',
    'artifactId', 'terms-' || asset_id_value,
    'mediaType', 'text/plain',
    'contentSha256', evidence_sha256_value,
    'sizeBytes', evidence_size_value
  );
  custody_request_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-terms-evidence-custody-request.v1',
    custody_request_json
  );
  INSERT INTO "foundry_derivative_terms_evidence_custody_v1" (
    "id", "authority", "execution_eligible", "artifact_id", "sha256",
    "size_bytes", "media_type", "evidence_bytes", "captured_at",
    "storage_mode", "custody_request_sha256", "custody_request_json",
    "custody_receipt_sha256", "custody_receipt_json",
    "registered_by_user_id", "idempotency_key", "recorded_at"
  ) VALUES (
    suffix_uuid, 'none', false, 'terms-' || asset_id_value,
    evidence_sha256_value, evidence_size_value, 'text/plain',
    evidence_bytes_value, graph_now, 'postgres_inline_bytea_v1',
    custody_request_sha256, custody_request_json,
    "foundry_test_sha256"('placeholder-custody-receipt:' || suffix_value),
    '{}'::jsonb, actor_id, 'custody-' || suffix_value, graph_now
  ) RETURNING * INTO custody_row;

  job_created_at := custody_row."captured_at";
  pricing_observed_at := job_created_at - interval '30 seconds';
  plan_time := job_created_at;
  pricing_expires_at := job_created_at + interval '30 minutes';
  dispatch_deadline := job_created_at + interval '10 minutes';

  derivative_policy_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-policy.v0',
    'policyVersion', derivative_policy_version_value,
    'generation', 1,
    'effectiveAt', to_char(
      (job_created_at - interval '1 minute') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'maximumApprovalTtlSeconds', 7200,
    'requireNonUnknownRightsBasis', true,
    'requireHttpsTermsReference', true,
    'requireTermsReviewedAt', true,
    'authorizedActions',
      '["read_source","create_internal_derivative"]'::jsonb,
    'forbiddenDownstreamUses',
      '["model_training","redistribution","public_release"]'::jsonb,
    'operations', '[{
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
  );
  derivative_policy_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-policy.v0', derivative_policy_json
  );
  INSERT INTO "foundry_derivative_rights_policy_versions" (
    "authority", "policy_version", "policy_definition_sha256", "generation",
    "maximum_approval_ttl_seconds", "effective_at", "policy_definition_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    'none', derivative_policy_version_value, derivative_policy_sha256, 1, 7200,
    job_created_at - interval '1 minute', derivative_policy_json, actor_id,
    'derivative-policy-' || suffix_value,
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-policy-registration.v0',
      jsonb_build_object(
        'authority', 'none',
        'idempotencyKey', 'derivative-policy-' || suffix_value,
        'policyDefinition', derivative_policy_json,
        'registeredByUserId', actor_id::text
      )
    )
  );

  asset_json := jsonb_build_object(
    'id', asset_id_value,
    'sourceRootId', source_root_id_value,
    'relativePath', 'input.glb',
    'inputType', 'glb_gltf',
    'mediaType', 'model/gltf-binary',
    'sizeBytes', 1024,
    'sha256', "foundry_test_sha256"('mesh-bytes:' || suffix_value),
    'immutable', true,
    'captureState', 'official_export',
    'accessState', 'official_export',
    'capturedAt', null,
    'coordinateFrameId', null,
    'calibrationAssetIds', '[]'::jsonb,
    'parentAssetIds', '[]'::jsonb,
    'rights', jsonb_build_object(
      'basis', 'customer_owned',
      'commercialUse', 'allowed',
      'modelTrainingUse', 'allowed',
      'redistribution', 'allowed',
      'termsReviewedAt', to_char(
        custody_row."captured_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'termsReference', terms_reference_value,
      'restrictions', jsonb_build_array(restriction_text_value)
    ),
    'provenanceClass', 'captured',
    'evidenceKinds', '[]'::jsonb,
    'inspection', jsonb_build_object(
      'geometryValue', 'high',
      'appearanceValue', 'high',
      'calibrationValue', 'none',
      'scaleValue', 'high',
      'metadataKeys', '[]'::jsonb,
      'decisiveNextTest', 'Validate decoded GLB semantic equality.'
    ),
    'notes', '[]'::jsonb
  );
  manifest_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.ingest-manifest.v0',
    'projectId', project_id_value,
    'createdAt', to_char(
      (job_created_at - interval '1 minute') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdBy', 'foundry-fixture-admin@example.test',
    'sourceRoots', jsonb_build_array(jsonb_build_object(
      'id', source_root_id_value,
      'kind', 'local_directory',
      'displayName', 'Read-only GLB fixture source',
      'locationRedacted', 'FOUNDRY_FIXTURE_SOURCE',
      'caseSensitivity', 'insensitive',
      'readOnly', true
    )),
    'coordinateFrames', '[]'::jsonb,
    'transforms', '[]'::jsonb,
    'assets', jsonb_build_array(asset_json),
    'provenanceEdges', '[]'::jsonb,
    'generatedRegions', '[]'::jsonb,
    'legalReviewState', 'requires_review',
    'sourceMutationPermitted', false
  );
  manifest_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.ingest-manifest.v0', manifest_json
  );

  job_stage_json := jsonb_build_object(
    'id', stage_id_value,
    'kind', 'geometry',
    'dependsOn', '[]'::jsonb,
    'containerImage', container_image_value,
    'command',
      '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb,
    'inputAssetIds', jsonb_build_array(asset_id_value),
    'outputNames', '["normalized-mesh"]'::jsonb,
    'rightsPurposes', '["commercial_internal_use"]'::jsonb,
    'cpuCores', 2,
    'ramGiB', 4,
    'gpuCount', 0,
    'minimumGpuVramGiB', 0,
    'scratchGiB', 10,
    'networkAccess', 'none',
    'checkpoint', 'none',
    'resumable', false
  );
  job_spec_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.job-spec.v0',
    'id', job_id_value,
    'projectId', project_id_value,
    'ingestManifestSha256', manifest_sha256,
    'executionIntent', 'execute',
    'providerKind', 'local_cpu',
    'providerAdapterId', adapter_id_value,
    'stages', jsonb_build_array(job_stage_json),
    'objectStorageProfile', null,
    'sourceMountMode', 'read_only',
    'outputPrefix', 'projects/' || project_id_value || '/' || job_id_value,
    'estimatedCostUsd', 0,
    'budgetCapUsd', 1,
    'killSwitchEnabled', true,
    'computeApprovalId', null,
    'createdAt', to_char(
      job_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  job_spec_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.job-spec.v0', job_spec_json
  );
  job_subject_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.job-approval-subject.v0', job_spec_json
  );

  intake_capabilities := '{
    "localStaging":"not_performed",
    "jobPlanning":"not_authorized",
    "execution":"not_authorized",
    "modelTraining":"not_authorized",
    "signing":"not_authorized",
    "publication":"not_authorized",
    "promotion":"not_authorized"
  }'::jsonb;
  intake_result_payload := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.intake-admission-result.v0',
    'receiptSha256', substr("foundry_test_sha256"('receipt:' || suffix_value), 8),
    'reviewSha256', "foundry_test_sha256"('intake-review:' || suffix_value),
    'manifestSha256', manifest_sha256,
    'manifest', manifest_json,
    'exclusions', '[]'::jsonb,
    'authority', 'none',
    'capabilities', intake_capabilities
  );
  intake_result_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.intake-admission-result.v0', intake_result_payload
  );
  intake_result_json := intake_result_payload || jsonb_build_object(
    'resultSha256', intake_result_sha256
  );

  staging_capabilities := jsonb_set(
    intake_capabilities, '{localStaging}', '"completed_verified"'::jsonb
  );
  staging_files := jsonb_build_array(
    jsonb_build_object(
      'path', 'evidence/admission-result.json', 'role', 'admission_result',
      'sizeBytes', 1, 'sha256', substr("foundry_test_sha256"('file:admission-result:' || suffix_value), 8)
    ),
    jsonb_build_object(
      'path', 'evidence/admission-review.json', 'role', 'admission_review',
      'sizeBytes', 1, 'sha256', substr("foundry_test_sha256"('file:admission-review:' || suffix_value), 8)
    ),
    jsonb_build_object(
      'path', 'evidence/exclusions.json', 'role', 'exclusion_ledger',
      'sizeBytes', 1, 'sha256', substr("foundry_test_sha256"('file:exclusions:' || suffix_value), 8)
    ),
    jsonb_build_object(
      'path', 'evidence/intake-receipt.json', 'role', 'intake_receipt',
      'sizeBytes', 1, 'sha256', substr("foundry_test_sha256"('file:intake-receipt:' || suffix_value), 8)
    ),
    jsonb_build_object(
      'path', 'manifest/foundry-ingest-manifest-v0.json', 'role', 'ingest_manifest',
      'sizeBytes', 1, 'sha256', substr("foundry_test_sha256"('file:manifest:' || suffix_value), 8)
    ),
    jsonb_build_object(
      'path', 'source/input.glb', 'role', 'staged_source',
      'sizeBytes', 1024, 'sha256', substr(asset_json->>'sha256', 8)
    )
  );
  staging_payload := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.intake-staging-index.v0',
    'receiptSha256', intake_result_json->>'receiptSha256',
    'reviewSha256', intake_result_json->>'reviewSha256',
    'resultSha256', intake_result_sha256,
    'manifestSha256', manifest_sha256,
    'stagedAssetCount', 1,
    'indexedFileCount', 6,
    'totalBytes', 1029,
    'files', staging_files,
    'authority', 'none',
    'capabilities', staging_capabilities
  );
  staging_sha256 := "foundry_nul_domain_jsonb_sha256"(
    'VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0', staging_payload
  );
  staging_json := staging_payload || jsonb_build_object(
    'stagingSha256', substr(staging_sha256, 8)
  );

  execution_policy_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.execution-policy.v0',
    'policyId', 'execution-policy-' || suffix_value,
    'maximumAttempts', 1,
    'deterministicRetryDelaySeconds', '[]'::jsonb,
    'maximumWallClockSeconds', 600,
    'orchestrationOverheadSeconds', 10,
    'workerSelfDeadlineSeconds', 660,
    'providerMaximumExecutionTtlSeconds', 720,
    'dispatchWindowTtlSeconds', 600,
    'leaseTtlSeconds', 60,
    'heartbeatIntervalSeconds', 10,
    'observationIntervalSeconds', 10,
    'checkpointIntervalSeconds', null,
    'cancelGracePeriodSeconds', 20,
    'terminationGracePeriodSeconds', 20,
    'terminationConfirmationTimeoutSeconds', 60,
    'pricingSnapshotMaximumAgeSeconds', 300,
    'costObservationMaximumAgeSeconds', 60,
    'executionConfirmationTtlSeconds', 300,
    'computeApprovalTtlSeconds', 300,
    'costWarningMicroUsd', '0',
    'costHardStopMicroUsd', '1000000',
    'terminationReserveMicroUsd', '0',
    'absoluteCostCapMicroUsd', '1000000'
  );
  execution_policy_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.execution-policy.v0', execution_policy_json
  );
  INSERT INTO "foundry_execution_policies" (
    "execution_policy_sha256", "policy_id", "schema_version",
    "maximum_attempts", "deterministic_retry_delay_seconds",
    "maximum_wall_clock_seconds", "orchestration_overhead_seconds",
    "worker_self_deadline_seconds", "provider_maximum_execution_ttl_seconds",
    "dispatch_window_ttl_seconds", "lease_ttl_seconds",
    "heartbeat_interval_seconds", "observation_interval_seconds",
    "checkpoint_interval_seconds", "cancel_grace_period_seconds",
    "termination_grace_period_seconds",
    "termination_confirmation_timeout_seconds",
    "pricing_snapshot_maximum_age_seconds",
    "cost_observation_maximum_age_seconds",
    "execution_confirmation_ttl_seconds", "compute_approval_ttl_seconds",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd",
    "termination_reserve_micro_usd", "absolute_cost_cap_micro_usd",
    "policy_json", "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    execution_policy_sha256, 'execution-policy-' || suffix_value,
    'omnitwin.foundry.execution-policy.v0', 1, '[]'::jsonb,
    600, 10, 660, 720, 600, 60, 10, 10, null, 20, 20, 60, 300, 60,
    300, 300, 0, 1000000, 0, 1000000, execution_policy_json, actor_id,
    'execution-policy-' || suffix_value,
    "foundry_test_sha256"('execution-policy-registration:' || suffix_value)
  );

  adapter_artifact_sha256 := "foundry_test_sha256"(
    'adapter-artifact:' || suffix_value
  );
  INSERT INTO "foundry_provider_adapter_artifacts" (
    "provider_adapter_artifact_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "artifact_ref",
    "artifact_json", "reviewed_by", "reviewed_at", "expires_at",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    adapter_artifact_sha256, 'local_cpu', adapter_id_value, '1.0.0',
    'fixture://local-adapter/' || suffix_value, '{}'::jsonb,
    'security@example.test', old_time, future_time, actor_id,
    'adapter-artifact-' || suffix_value,
    "foundry_test_sha256"('adapter-registration:' || suffix_value)
  );

  deployment_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.provider-deployment-evidence.v0',
    'deploymentId', deployment_id_value,
    'providerKind', 'local_cpu',
    'providerAdapterId', adapter_id_value,
    'providerAdapterVersion', '1.0.0',
    'providerAdapterArtifactSha256', adapter_artifact_sha256,
    'accountProjectAlias', 'local-fixture',
    'region', 'local',
    'dataResidency', 'gb',
    'observedAt', to_char(
      old_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      future_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'capacityClasses', '[{
      "id":"local-cpu-8",
      "cpuCores":8,
      "ramGiB":16,
      "gpuCount":0,
      "perGpuVramGiB":0,
      "scratchGiB":100
    }]'::jsonb
  );
  deployment_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-deployment-evidence.v0', deployment_json
  );
  INSERT INTO "foundry_provider_deployments" (
    "provider_deployment_sha256", "deployment_id", "provider_kind",
    "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "account_project_alias", "region",
    "data_residency", "observed_at", "expires_at", "deployment_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    deployment_sha256, deployment_id_value, 'local_cpu', adapter_id_value,
    '1.0.0', adapter_artifact_sha256, 'local-fixture', 'local', 'gb',
    old_time, future_time, deployment_json, actor_id,
    'deployment-' || suffix_value,
    "foundry_test_sha256"('deployment-registration:' || suffix_value)
  );

  worker_profile_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.trusted-worker-profile.v0',
    'profileId', worker_profile_id_value,
    'profileVersion', 'v1',
    'operationClass', 'deterministic_transformation',
    'containerImage', container_image_value,
    'command',
      '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb,
    'networkAccess', 'none',
    'localExecutionAllowed', true,
    'reviewedBy', 'security@example.test',
    'reviewedAt', to_char(
      old_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      future_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  worker_profile_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.trusted-worker-profile.v0', worker_profile_json
  );
  INSERT INTO "foundry_trusted_worker_profiles" (
    "worker_profile_sha256", "profile_id", "profile_version",
    "operation_class", "container_image", "network_access",
    "local_execution_allowed", "profile_json", "reviewed_by", "reviewed_at",
    "expires_at", "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    worker_profile_sha256, worker_profile_id_value, 'v1',
    'deterministic_transformation', container_image_value, 'none', true,
    worker_profile_json, 'security@example.test', old_time, future_time,
    actor_id, 'worker-profile-' || suffix_value,
    "foundry_test_sha256"('worker-profile-registration:' || suffix_value)
  );
  worker_profile_set_sha256 := "foundry_test_sha256"(
    'worker-profile-set:' || suffix_value
  );
  pricing_snapshot_sha256 := "foundry_test_sha256"(
    'pricing-snapshot:' || suffix_value
  );

  provider_plan_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.provider-plan-evidence.v0',
    'executionIntent', 'execute',
    'authority', 'none',
    'planId', 'plan-' || suffix_value,
    'jobId', job_id_value,
    'jobSpecSha256', job_spec_sha256,
    'reviewedIngestManifestSha256', manifest_sha256,
    'intakeAdmissionResultSha256', intake_result_sha256,
    'intakeStagingIndexSha256', staging_sha256,
    'providerKind', 'local_cpu',
    'providerAdapterId', adapter_id_value,
    'providerAdapterVersion', '1.0.0',
    'providerAdapterArtifactSha256', adapter_artifact_sha256,
    'providerDeploymentSha256', deployment_sha256,
    'pricingCurrency', 'USD',
    'pricingBasis', 'fixed_quote',
    'pricingSnapshotSha256', pricing_snapshot_sha256,
    'pricingSnapshotObservedAt', to_char(
      pricing_observed_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'pricingSnapshotExpiresAt', to_char(
      pricing_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'plannedAt', to_char(
      plan_time AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'estimatedCostMicroUsd', '0',
    'stages', jsonb_build_array(jsonb_build_object(
      'stageId', stage_id_value,
      'capacityClass', 'local-cpu-8',
      'workerProfileSha256', worker_profile_sha256,
      'estimatedCostMicroUsd', '0',
      'maximumRuntimeSeconds', 500
    ))
  );
  provider_plan_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-plan-evidence.v0', provider_plan_json
  );

  execution_envelope_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.execution-envelope.v0',
    'executionIntent', 'execute',
    'authority', 'none',
    'envelopeId', envelope_id_value,
    'jobId', job_id_value,
    'projectId', project_id_value,
    'jobSpecSha256', job_spec_sha256,
    'providerPlanSha256', provider_plan_sha256,
    'reviewedIngestManifestSha256', manifest_sha256,
    'intakeAdmissionResultSha256', intake_result_sha256,
    'intakeStagingIndexSha256', staging_sha256,
    'executionPolicySha256', execution_policy_sha256,
    'computeApprovalId', null,
    'providerKind', 'local_cpu',
    'providerAdapterId', adapter_id_value,
    'providerAdapterVersion', '1.0.0',
    'providerAdapterArtifactSha256', adapter_artifact_sha256,
    'providerDeploymentSha256', deployment_sha256,
    'pricingCurrency', 'USD',
    'pricingSnapshotSha256', pricing_snapshot_sha256,
    'pricingSnapshotExpiresAt', to_char(
      pricing_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      job_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'dispatchDeadline', to_char(
      dispatch_deadline AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  execution_envelope_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.execution-envelope.v0', execution_envelope_json
  );

  INSERT INTO "foundry_jobs" (
    "job_id", "envelope_id", "project_id", "schema_version",
    "execution_intent", "authority", "execution_envelope_sha256",
    "job_spec_sha256", "provider_plan_sha256",
    "reviewed_ingest_manifest_sha256", "intake_admission_result_sha256",
    "intake_staging_index_sha256", "execution_policy_sha256",
    "compute_approval_id", "pricing_snapshot_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256",
    "trusted_worker_profile_set_sha256", "trusted_worker_profile_count",
    "pricing_currency", "pricing_snapshot_observed_at",
    "provider_plan_planned_at", "pricing_snapshot_expires_at",
    "estimated_cost_micro_usd", "budget_cap_micro_usd",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd",
    "termination_reserve_micro_usd", "absolute_cost_cap_micro_usd",
    "max_wall_clock_seconds", "orchestration_overhead_seconds",
    "cancel_grace_seconds", "termination_grace_seconds",
    "worker_self_deadline_seconds",
    "termination_confirmation_timeout_seconds",
    "provider_maximum_execution_ttl_seconds", "kill_switch_enabled",
    "dispatch_deadline", "envelope_created_at", "execution_envelope_json",
    "job_spec_json", "reviewed_ingest_manifest_json", "provider_plan_json",
    "intake_admission_result_json", "intake_staging_index_json",
    "execution_policy_json", "pricing_snapshot_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    job_id_value, envelope_id_value, project_id_value,
    'omnitwin.foundry.execution-envelope.v0', 'execute', 'none',
    execution_envelope_sha256, job_spec_sha256, provider_plan_sha256,
    manifest_sha256, intake_result_sha256, staging_sha256,
    execution_policy_sha256, null, pricing_snapshot_sha256, 'local_cpu',
    adapter_id_value, '1.0.0', adapter_artifact_sha256, deployment_sha256,
    worker_profile_set_sha256, 1, 'USD', pricing_observed_at, plan_time,
    pricing_expires_at, 0, 1000000, 0, 1000000, 0, 1000000,
    600, 10, 20, 20, 660, 60, 720, true, dispatch_deadline,
    job_created_at, execution_envelope_json, job_spec_json, manifest_json,
    provider_plan_json, intake_result_json, staging_json, execution_policy_json,
    '{}'::jsonb, actor_id, 'job-' || suffix_value,
    "foundry_test_sha256"('job-registration:' || suffix_value)
  );

  INSERT INTO "foundry_job_worker_profiles" (
    "job_id", "project_id", "execution_envelope_sha256",
    "provider_plan_sha256", "trusted_worker_profile_set_sha256", "stage_id",
    "worker_profile_sha256", "operation_class", "registered_by_user_id",
    "idempotency_key", "request_digest", "registered_at"
  ) VALUES (
    job_id_value, project_id_value, execution_envelope_sha256,
    provider_plan_sha256, worker_profile_set_sha256, stage_id_value,
    worker_profile_sha256, 'deterministic_transformation', actor_id,
    'job-worker-' || suffix_value,
    "foundry_test_sha256"('job-worker-registration:' || suffix_value),
    clock_timestamp()
  );

  base_policy_definition_sha256 := "foundry_test_sha256"(
    'base-rights-definition:' || suffix_value
  );
  base_policy_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.rights-policy-definition.v0',
    'policyVersion', base_policy_version_value,
    'policyDefinitionSha256', base_policy_definition_sha256,
    'generation', 1,
    'effectiveAt', to_char(
      old_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'revokedAt', null,
    'maximumApprovalTtlSeconds', 7200
  );
  base_policy_evidence_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.rights-policy-definition.v0', base_policy_json
  );
  INSERT INTO "foundry_rights_policy_versions" (
    "policy_version", "policy_definition_sha256", "policy_evidence_sha256",
    "generation", "maximum_approval_ttl_seconds", "policy_definition_json",
    "effective_at", "revoked_at", "registered_by_user_id",
    "idempotency_key", "request_digest"
  ) VALUES (
    base_policy_version_value, base_policy_definition_sha256,
    base_policy_evidence_sha256, 1, 7200, base_policy_json, old_time, null,
    actor_id, 'base-rights-policy-' || suffix_value,
    "foundry_test_sha256"('base-rights-policy-registration:' || suffix_value)
  );

  base_rights_approval_json := jsonb_build_object(
    'jobSubjectSha256', "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.job-approval-subject.v0', job_spec_json
    ),
    'ingestManifestSha256', manifest_sha256,
    'policyVersion', base_policy_version_value,
    'policyDefinitionSha256', base_policy_definition_sha256,
    'policyGeneration', 1,
    'decision', 'allowed',
    'decidedBy', 'rights-reviewer@example.test',
    'decidedAt', to_char(
      job_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      (job_created_at + interval '1 hour') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  base_rights_approval_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.rights-approval.v0', base_rights_approval_json
  );
  INSERT INTO "foundry_rights_approvals" (
    "id", "job_id", "project_id", "execution_envelope_sha256",
    "job_spec_sha256", "reviewed_ingest_manifest_sha256",
    "execution_policy_sha256", "policy_version",
    "policy_definition_sha256", "policy_evidence_sha256",
    "policy_generation", "policy_maximum_approval_ttl_seconds", "decision",
    "decided_by", "decided_at", "expires_at", "rights_approval_sha256",
    "rights_approval_json", "registered_by_user_id", "idempotency_key",
    "request_digest"
  ) VALUES (
    'base-rights-approval-' || suffix_value, job_id_value, project_id_value,
    execution_envelope_sha256, job_spec_sha256, manifest_sha256,
    execution_policy_sha256, base_policy_version_value,
    base_policy_definition_sha256, base_policy_evidence_sha256, 1, 7200,
    'allowed', 'rights-reviewer@example.test', job_created_at,
    job_created_at + interval '1 hour', base_rights_approval_sha256,
    base_rights_approval_json, actor_id, 'base-rights-approval-' || suffix_value,
    "foundry_test_sha256"('base-rights-approval-registration:' || suffix_value)
  );

  confirmation_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.execution-envelope-confirmation.v0',
    'confirmationId', 'confirmation-' || suffix_value,
    'executionEnvelopeSha256', execution_envelope_sha256,
    'jobSpecSha256', job_spec_sha256,
    'jobId', job_id_value,
    'confirmedBy', 'operator@example.test',
    'confirmedAt', to_char(
      job_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      (job_created_at + interval '5 minutes') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  confirmation_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.execution-envelope-confirmation.v0', confirmation_json
  );
  INSERT INTO "foundry_execution_confirmations" (
    "confirmation_id", "job_id", "project_id",
    "execution_envelope_sha256", "job_spec_sha256", "confirmed_by",
    "confirmed_at", "expires_at", "confirmation_sha256", "confirmation_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    'confirmation-' || suffix_value, job_id_value, project_id_value,
    execution_envelope_sha256, job_spec_sha256, 'operator@example.test',
    job_created_at, job_created_at + interval '5 minutes', confirmation_sha256,
    confirmation_json, actor_id, 'confirmation-' || suffix_value,
    "foundry_test_sha256"('confirmation-registration:' || suffix_value)
  );

  restriction_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-restriction.v0',
    jsonb_build_object(
      'assetId', asset_id_value,
      'restrictionIndex', 0,
      'restrictionText', restriction_text_value
    )
  );
  restriction_disposition_json := jsonb_build_object(
    'restrictionIndex', 0,
    'restrictionText', restriction_text_value,
    'restrictionSha256', restriction_sha256,
    'disposition', 'satisfied',
    'rationale', 'The internal lossless normalization satisfies this restriction.',
    'supportingEvidenceSha256', evidence_sha256_value
  );
  derivative_approval_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-approval.v0',
    'approvalId', approval_id_value,
    'policyVersion', derivative_policy_version_value,
    'policyDefinitionSha256', derivative_policy_sha256,
    'policyGeneration', 1,
    'jobSubjectSha256', job_subject_sha256,
    'ingestManifestSha256', manifest_sha256,
    'stageId', stage_id_value,
    'operation', jsonb_build_object(
      'operationId', 'normalize_mesh_glb/v0',
      'derivativeClass', 'lossless_internal_format_normalization'
    ),
    'authorizedActions',
      '["read_source","create_internal_derivative"]'::jsonb,
    'forbiddenDownstreamUses',
      '["model_training","redistribution","public_release"]'::jsonb,
    'assetIds', jsonb_build_array(asset_id_value),
    'assetRightsEvidence', jsonb_build_array(jsonb_build_object(
      'assetId', asset_id_value,
      'basis', 'customer_owned',
      'termsReference', terms_reference_value,
      'reviewedAt', to_char(
        custody_row."captured_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'termsEvidenceArtifact', jsonb_build_object(
        'artifactId', custody_row."artifact_id",
        'sha256', custody_row."sha256",
        'sizeBytes', custody_row."size_bytes",
        'mediaType', custody_row."media_type",
        'capturedAt', to_char(
          custody_row."captured_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'restrictionsReviewed', true,
      'restrictionDispositions', jsonb_build_array(restriction_disposition_json)
    )),
    'assetSnapshots', jsonb_build_array(asset_json),
    'decision', 'allowed',
    'decidedBy', 'rights-reviewer@example.test',
    'decidedAt', to_char(
      custody_row."captured_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      (custody_row."captured_at" + interval '1 hour') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  derivative_approval_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-approval.v0',
    derivative_approval_json
  );
  INSERT INTO "foundry_derivative_rights_approvals" (
    "approval_id", "authority", "job_id", "project_id", "job_spec_sha256",
    "job_subject_sha256", "ingest_manifest_sha256", "job_spec_json",
    "ingest_manifest_json", "policy_version", "policy_definition_sha256",
    "policy_generation", "policy_maximum_approval_ttl_seconds", "stage_id",
    "operation_id", "derivative_class", "asset_id", "rights_basis",
    "terms_reference", "terms_reviewed_at", "terms_evidence_artifact_id",
    "terms_evidence_sha256", "terms_evidence_size_bytes",
    "terms_evidence_media_type", "terms_evidence_captured_at", "decision",
    "decided_by", "decided_at", "expires_at",
    "derivative_rights_approval_sha256", "derivative_rights_approval_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    approval_id_value, 'none', job_id_value, project_id_value, job_spec_sha256,
    job_subject_sha256, manifest_sha256, job_spec_json, manifest_json,
    derivative_policy_version_value, derivative_policy_sha256, 1, 7200,
    stage_id_value, 'normalize_mesh_glb/v0',
    'lossless_internal_format_normalization', asset_id_value, 'customer_owned',
    terms_reference_value, custody_row."captured_at", custody_row."artifact_id",
    custody_row."sha256", custody_row."size_bytes", custody_row."media_type",
    custody_row."captured_at", 'allowed', 'rights-reviewer@example.test',
    custody_row."captured_at", custody_row."captured_at" + interval '1 hour',
    derivative_approval_sha256, derivative_approval_json, actor_id,
    'derivative-approval-' || suffix_value,
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-approval-registration.v0',
      jsonb_build_object(
        'authority', 'none',
        'approval', derivative_approval_json,
        'idempotencyKey', 'derivative-approval-' || suffix_value,
        'ingestManifest', manifest_json,
        'jobSpec', job_spec_json,
        'registeredByUserId', actor_id::text
      )
    )
  );

  review_request_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-review-request.v1',
    'approvalId', approval_id_value,
    'derivativeRightsApprovalSha256', derivative_approval_sha256,
    'custodyId', custody_row."id"::text,
    'custodyReceiptSha256', custody_row."custody_receipt_sha256",
    'decision', 'accepted_for_registry_attestation',
    'rationale', 'Exact source, terms bytes, operation, and restrictions were reviewed.'
  );
  review_request_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-review-request.v1',
    review_request_json
  );
  INSERT INTO "foundry_derivative_rights_reviews_v1" (
    "authority", "execution_eligible", "approval_id",
    "derivative_rights_approval_sha256", "terms_custody_id",
    "terms_custody_receipt_sha256", "decision", "rationale",
    "review_request_sha256", "review_request_json", "review_receipt_sha256",
    "review_receipt_json", "reviewed_by_user_id", "idempotency_key",
    "reviewed_at", "recorded_at"
  ) VALUES (
    'none', false, approval_id_value, derivative_approval_sha256,
    custody_row."id", custody_row."custody_receipt_sha256",
    'accepted_for_registry_attestation',
    'Exact source, terms bytes, operation, and restrictions were reviewed.',
    review_request_sha256, review_request_json,
    "foundry_test_sha256"('placeholder-review-receipt:' || suffix_value),
    '{}'::jsonb, actor_id, 'review-' || suffix_value, graph_now, graph_now
  ) RETURNING * INTO review_row;

  IF create_attestation_input THEN
    attestation_request_json := jsonb_build_object(
      'schemaVersion',
        'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1',
      'approvalId', approval_id_value,
      'derivativeRightsApprovalSha256', derivative_approval_sha256,
      'reviewId', review_row."id"::text,
      'reviewReceiptSha256', review_row."review_receipt_sha256",
      'custodyId', custody_row."id"::text,
      'custodyReceiptSha256', custody_row."custody_receipt_sha256"
    );
    attestation_request_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1',
      attestation_request_json
    );
    INSERT INTO "foundry_derivative_rights_registry_attestations_v1" (
      "registry_authority", "execution_eligible", "approval_id",
      "derivative_rights_approval_sha256", "review_id",
      "review_receipt_sha256", "terms_custody_id",
      "terms_custody_receipt_sha256", "policy_version",
      "policy_definition_sha256", "policy_generation", "job_subject_sha256",
      "ingest_manifest_sha256", "stage_id", "operation_id",
      "derivative_class", "asset_id", "approval_expires_at",
      "registration_request_sha256", "registration_request_json",
      "registry_attestation_sha256", "registry_attestation_json",
      "attested_by_user_id", "idempotency_key", "attested_at", "recorded_at"
    ) VALUES (
      'authenticated_registry_attestation_v1', false, approval_id_value,
      derivative_approval_sha256, review_row."id", review_row."review_receipt_sha256",
      custody_row."id", custody_row."custody_receipt_sha256",
      derivative_policy_version_value, derivative_policy_sha256, 1,
      job_subject_sha256, manifest_sha256, stage_id_value,
      'normalize_mesh_glb/v0', 'lossless_internal_format_normalization',
      asset_id_value, custody_row."captured_at" + interval '1 hour',
      attestation_request_sha256, attestation_request_json,
      "foundry_test_sha256"('placeholder-attestation:' || suffix_value),
      '{}'::jsonb, actor_id, 'attestation-' || suffix_value,
      graph_now, graph_now
    ) RETURNING * INTO attestation_row;
  END IF;

  base_subject_json := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.execution-subject.v0',
    'subjectId', envelope_id_value,
    'projectId', project_id_value,
    'jobSpecSha256', job_spec_sha256,
    'executionEnvelopeSha256', execution_envelope_sha256,
    'ingestManifestSha256', manifest_sha256,
    'intakeAdmissionResultSha256', intake_result_sha256,
    'intakeStagingIndexSha256', staging_sha256,
    'providerPlanSha256', provider_plan_sha256,
    'executionPolicySha256', execution_policy_sha256,
    'executionConfirmationSha256', confirmation_sha256,
    'rightsApprovalSha256', base_rights_approval_sha256,
    'rightsPolicyEvidenceSha256', base_policy_evidence_sha256,
    'rightsPolicyDefinitionSha256', base_policy_definition_sha256,
    'computeApprovalSha256', null,
    'providerKind', 'local_cpu',
    'providerAdapterId', adapter_id_value,
    'providerAdapterVersion', '1.0.0',
    'providerAdapterArtifactSha256', adapter_artifact_sha256,
    'providerDeploymentSha256', deployment_sha256,
    'workerProfileSha256s', jsonb_build_array(worker_profile_sha256),
    'pricingSnapshotSha256', pricing_snapshot_sha256,
    'pricingSnapshotExpiresAt', to_char(
      pricing_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      job_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'dispatchDeadline', to_char(
      dispatch_deadline AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'maximumAttempts', 1,
    'budgetPolicy', jsonb_build_object(
      'currency', 'USD',
      'costWarningMicroUsd', '0',
      'costHardStopMicroUsd', '1000000',
      'terminationReserveMicroUsd', '0',
      'absoluteCostCapMicroUsd', '1000000',
      'costObservationMaximumAgeSeconds', 60
    ),
    'checkpointContract', null
  );
  base_subject_sha256 := "foundry_nul_domain_jsonb_sha256"(
    'OMNITWIN_FOUNDRY_EXECUTION_SUBJECT_V0', base_subject_json
  );

  INSERT INTO "foundry_test_derivative_graphs" (
    "suffix", "actor_user_id", "job_id", "approval_id", "custody_id",
    "review_id", "attestation_id", "base_execution_subject_sha256",
    "base_execution_subject_json"
  ) VALUES (
    suffix_value, actor_id, job_id_value, approval_id_value, custody_row."id",
    review_row."id", CASE WHEN create_attestation_input THEN attestation_row."id" ELSE null END,
    base_subject_sha256, base_subject_json
  );

  RETURN jsonb_build_object(
    'suffix', suffix_value,
    'jobId', job_id_value,
    'approvalId', approval_id_value,
    'custodyId', custody_row."id"::text,
    'reviewId', review_row."id"::text,
    'attestationId', CASE
      WHEN create_attestation_input THEN attestation_row."id"::text ELSE null
    END,
    'baseExecutionSubjectSha256', base_subject_sha256
  );
END;
$$;

CREATE FUNCTION "foundry_test_register_attestation"(suffix_input text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  graph_row "foundry_test_derivative_graphs"%ROWTYPE;
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  review_row "foundry_derivative_rights_reviews_v1"%ROWTYPE;
  custody_row "foundry_derivative_terms_evidence_custody_v1"%ROWTYPE;
  request_json jsonb;
  request_sha256 varchar(71);
  attestation_row "foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
BEGIN
  SELECT * INTO graph_row
  FROM "foundry_test_derivative_graphs"
  WHERE "suffix" = suffix_input
  FOR UPDATE;
  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = graph_row."approval_id";
  SELECT * INTO review_row
  FROM "foundry_derivative_rights_reviews_v1"
  WHERE "id" = graph_row."review_id";
  SELECT * INTO custody_row
  FROM "foundry_derivative_terms_evidence_custody_v1"
  WHERE "id" = graph_row."custody_id";
  request_json := jsonb_build_object(
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
  request_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1',
    request_json
  );
  INSERT INTO "foundry_derivative_rights_registry_attestations_v1" (
    "registry_authority", "execution_eligible", "approval_id",
    "derivative_rights_approval_sha256", "review_id", "review_receipt_sha256",
    "terms_custody_id", "terms_custody_receipt_sha256", "policy_version",
    "policy_definition_sha256", "policy_generation", "job_subject_sha256",
    "ingest_manifest_sha256", "stage_id", "operation_id",
    "derivative_class", "asset_id", "approval_expires_at",
    "registration_request_sha256", "registration_request_json",
    "registry_attestation_sha256", "registry_attestation_json",
    "attested_by_user_id", "idempotency_key", "attested_at", "recorded_at"
  ) VALUES (
    'authenticated_registry_attestation_v1', false, approval_row."approval_id",
    approval_row."derivative_rights_approval_sha256", review_row."id",
    review_row."review_receipt_sha256", custody_row."id",
    custody_row."custody_receipt_sha256", approval_row."policy_version",
    approval_row."policy_definition_sha256", approval_row."policy_generation",
    approval_row."job_subject_sha256", approval_row."ingest_manifest_sha256",
    approval_row."stage_id", approval_row."operation_id",
    approval_row."derivative_class", approval_row."asset_id",
    approval_row."expires_at", request_sha256, request_json,
    "foundry_test_sha256"('placeholder-attestation:' || suffix_input),
    '{}'::jsonb, graph_row."actor_user_id", 'attestation-' || suffix_input,
    clock_timestamp(), clock_timestamp()
  ) RETURNING * INTO attestation_row;
  UPDATE "foundry_test_derivative_graphs"
  SET "attestation_id" = attestation_row."id"
  WHERE "suffix" = suffix_input;
  RETURN attestation_row."registry_attestation_json" || jsonb_build_object(
    'registryAttestationSha256', attestation_row."registry_attestation_sha256"
  );
END;
$$;

CREATE FUNCTION "foundry_test_revoke_attestation"(
  suffix_input text,
  reason_input text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  graph_row "foundry_test_derivative_graphs"%ROWTYPE;
  attestation_row "foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
  request_json jsonb;
  request_sha256 varchar(71);
  revocation_row "foundry_derivative_rights_registry_attestation_revocations_v1"%ROWTYPE;
BEGIN
  SELECT * INTO graph_row
  FROM "foundry_test_derivative_graphs"
  WHERE "suffix" = suffix_input;
  SELECT * INTO attestation_row
  FROM "foundry_derivative_rights_registry_attestations_v1"
  WHERE "id" = graph_row."attestation_id";
  request_json := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1',
    'attestationId', attestation_row."id"::text,
    'registryAttestationSha256', attestation_row."registry_attestation_sha256",
    'reason', reason_input
  );
  request_sha256 := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1',
    request_json
  );
  INSERT INTO "foundry_derivative_rights_registry_attestation_revocations_v1" (
    "registry_authority", "execution_eligible", "attestation_id",
    "registry_attestation_sha256", "reason", "revocation_request_sha256",
    "revocation_request_json", "attestation_revocation_sha256",
    "attestation_revocation_json", "revoked_by_user_id", "idempotency_key",
    "revoked_at", "recorded_at"
  ) VALUES (
    'authenticated_registry_attestation_v1', false, attestation_row."id",
    attestation_row."registry_attestation_sha256", reason_input,
    request_sha256, request_json,
    "foundry_test_sha256"('placeholder-attestation-revocation:' || suffix_input),
    '{}'::jsonb, graph_row."actor_user_id", 'attestation-revocation-' || suffix_input,
    clock_timestamp(), clock_timestamp()
  ) RETURNING * INTO revocation_row;
  RETURN revocation_row."attestation_revocation_json" || jsonb_build_object(
    'attestationRevocationSha256',
      revocation_row."attestation_revocation_sha256"
  );
END;
$$;

CREATE FUNCTION "foundry_test_revoke_derivative_policy"(suffix_input text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  graph_row "foundry_test_derivative_graphs"%ROWTYPE;
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  revoked_at_value timestamptz;
  revocation_id_value varchar(120);
  revocation_json_value jsonb;
  revocation_sha256_value varchar(71);
  row_value "foundry_derivative_rights_policy_revocations"%ROWTYPE;
BEGIN
  SELECT * INTO graph_row
  FROM "foundry_test_derivative_graphs"
  WHERE "suffix" = suffix_input;
  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = graph_row."approval_id";
  revoked_at_value := date_trunc('milliseconds', clock_timestamp());
  revocation_id_value := 'derivative-revocation-' || suffix_input;
  revocation_json_value := jsonb_build_object(
    'schemaVersion',
      'omnitwin.foundry.derivative-rights-policy-revocation.v0',
    'revocationId', revocation_id_value,
    'policyVersion', approval_row."policy_version",
    'policyDefinitionSha256', approval_row."policy_definition_sha256",
    'policyGeneration', approval_row."policy_generation",
    'revokedAt', to_char(
      revoked_at_value AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'revokedBy', 'rights-reviewer@example.test',
    'reason', 'Fixture policy permission was withdrawn before activation.'
  );
  revocation_sha256_value := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-policy-revocation.v0',
    revocation_json_value
  );
  INSERT INTO "foundry_derivative_rights_policy_revocations" (
    "authority", "revocation_id", "policy_version",
    "policy_definition_sha256", "policy_generation", "revoked_at",
    "revoked_by", "reason", "revocation_sha256", "revocation_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    'none', revocation_id_value, approval_row."policy_version",
    approval_row."policy_definition_sha256", approval_row."policy_generation",
    revoked_at_value, 'rights-reviewer@example.test',
    'Fixture policy permission was withdrawn before activation.',
    revocation_sha256_value, revocation_json_value, graph_row."actor_user_id",
    revocation_id_value,
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-revocation-registration.v0',
      jsonb_build_object(
        'authority', 'none',
        'idempotencyKey', revocation_id_value,
        'registeredByUserId', graph_row."actor_user_id"::text,
        'revocation', revocation_json_value
      )
    )
  ) RETURNING * INTO row_value;
  RETURN row_value."revocation_json" || jsonb_build_object(
    'revocationSha256', row_value."revocation_sha256"
  );
END;
$$;

CREATE FUNCTION "foundry_test_add_derivative_policy_generation"(
  suffix_input text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  graph_row "foundry_test_derivative_graphs"%ROWTYPE;
  approval_row "foundry_derivative_rights_approvals"%ROWTYPE;
  effective_at_value timestamptz;
  policy_json_value jsonb;
  policy_sha256_value varchar(71);
BEGIN
  SELECT * INTO graph_row
  FROM "foundry_test_derivative_graphs"
  WHERE "suffix" = suffix_input;
  SELECT * INTO approval_row
  FROM "foundry_derivative_rights_approvals"
  WHERE "approval_id" = graph_row."approval_id";
  effective_at_value := date_trunc('milliseconds', clock_timestamp());
  policy_json_value := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-rights-policy.v0',
    'policyVersion', approval_row."policy_version",
    'generation', 2,
    'effectiveAt', to_char(
      effective_at_value AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'maximumApprovalTtlSeconds', 7200,
    'requireNonUnknownRightsBasis', true,
    'requireHttpsTermsReference', true,
    'requireTermsReviewedAt', true,
    'authorizedActions',
      '["read_source","create_internal_derivative"]'::jsonb,
    'forbiddenDownstreamUses',
      '["model_training","redistribution","public_release"]'::jsonb,
    'operations', '[{
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
  );
  policy_sha256_value := "foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-rights-policy.v0', policy_json_value
  );
  INSERT INTO "foundry_derivative_rights_policy_versions" (
    "authority", "policy_version", "policy_definition_sha256", "generation",
    "maximum_approval_ttl_seconds", "effective_at", "policy_definition_json",
    "registered_by_user_id", "idempotency_key", "request_digest"
  ) VALUES (
    'none', approval_row."policy_version", policy_sha256_value, 2, 7200,
    effective_at_value, policy_json_value, graph_row."actor_user_id",
    'derivative-policy-generation-2-' || suffix_input,
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-rights-policy-registration.v0',
      jsonb_build_object(
        'authority', 'none',
        'idempotencyKey',
          'derivative-policy-generation-2-' || suffix_input,
        'policyDefinition', policy_json_value,
        'registeredByUserId', graph_row."actor_user_id"::text
      )
    )
  );
  RETURN policy_json_value || jsonb_build_object(
    'policyDefinitionSha256', policy_sha256_value
  );
END;
$$;

CREATE VIEW "foundry_test_derivative_graph_material" AS
SELECT
  graph."suffix",
  graph."actor_user_id",
  graph."base_execution_subject_sha256",
  graph."base_execution_subject_json",
  job."project_id",
  job."job_id",
  job."job_spec_sha256",
  job."execution_envelope_sha256",
  approval."job_subject_sha256",
  approval."ingest_manifest_sha256",
  approval."stage_id",
  approval."operation_id",
  approval."derivative_class",
  approval."asset_id",
  approval."policy_version",
  approval."policy_definition_sha256",
  approval."policy_generation",
  approval."approval_id",
  approval."derivative_rights_approval_sha256",
  approval."derivative_rights_approval_json",
  custody."id" AS "custody_id",
  custody."artifact_id" AS "terms_evidence_artifact_id",
  custody."sha256" AS "terms_evidence_content_sha256",
  custody."size_bytes" AS "terms_evidence_size_bytes",
  custody."media_type" AS "terms_evidence_media_type",
  to_char(
    custody."captured_at" AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "terms_evidence_captured_at",
  custody."custody_receipt_sha256",
  custody."custody_receipt_json",
  review."id" AS "review_id",
  review."review_receipt_sha256",
  review."review_receipt_json",
  attestation."id" AS "attestation_id",
  attestation."registry_attestation_sha256",
  attestation."registry_attestation_json",
  worker."worker_profile_sha256"
FROM "foundry_test_derivative_graphs" graph
JOIN "foundry_jobs" job ON job."job_id" = graph."job_id"
JOIN "foundry_derivative_rights_approvals" approval
  ON approval."approval_id" = graph."approval_id"
JOIN "foundry_derivative_terms_evidence_custody_v1" custody
  ON custody."id" = graph."custody_id"
JOIN "foundry_derivative_rights_reviews_v1" review
  ON review."id" = graph."review_id"
LEFT JOIN "foundry_derivative_rights_registry_attestations_v1" attestation
  ON attestation."id" = graph."attestation_id"
JOIN "foundry_job_worker_profiles" worker
  ON worker."job_id" = graph."job_id"
 AND worker."stage_id" = approval."stage_id";
