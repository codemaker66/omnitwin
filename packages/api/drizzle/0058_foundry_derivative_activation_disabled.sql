-- OmniTwin Foundry derivative activation V1: inert generation-1 substrate.
--
-- This migration deliberately installs no enabled activation epoch and grants
-- no application, provider, network, object-storage, signing, release,
-- publication, or runtime authority.  The only epoch inserted here is the
-- closed disabled_sentinel bootstrap row required by the audited V1 contract.

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'omnitwin_api_activation',
    'omnitwin_foundry_claimer',
    'omnitwin_foundry_submit_gateway',
    'omnitwin_foundry_recovery_gateway',
    'omnitwin_foundry_output_broker',
    'omnitwin_foundry_output_custodian',
    'omnitwin_foundry_watchdog'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', role_name);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION "fdv1_is_sha256"(value_input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN value_input ~ '^sha256:[a-f0-9]{64}$';

CREATE FUNCTION "fdv1_is_raw_sha256"(value_input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN value_input ~ '^[a-f0-9]{64}$';

CREATE FUNCTION "fdv1_is_key"(value_input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN value_input ~ '^[a-z0-9][a-z0-9._-]{0,119}$';

CREATE FUNCTION "fdv1_time_text"(value_input timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
RETURN to_char(
  date_trunc('milliseconds', value_input AT TIME ZONE 'UTC'),
  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
);

CREATE TABLE "foundry_derivative_execution_activation_epochs_v1" (
  "generation" bigint PRIMARY KEY NOT NULL,
  "variant" varchar(32) NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "enabled" boolean NOT NULL,
  "reject_future_generation_while_live" boolean NOT NULL,
  "disabled_reason" varchar(24),
  "epoch_json" jsonb NOT NULL,
  "epoch_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "administrator_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_epoch_ref_uq" UNIQUE(
    "generation", "epoch_sha256", "effective_at", "enabled"
  ),
  CONSTRAINT "fdv1_epoch_actor_idem_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_epoch_generation_ck" CHECK ("generation" > 0),
  CONSTRAINT "fdv1_epoch_variant_ck" CHECK (
    ("variant" = 'disabled_sentinel' AND NOT "enabled"
      AND "disabled_reason" IN ('bootstrap', 'containment'))
    OR
    ("variant" = 'enabled_release' AND "enabled"
      AND "disabled_reason" IS NULL
      AND "reject_future_generation_while_live"
      AND "administrator_user_id" IS NOT NULL)
  ),
  CONSTRAINT "fdv1_epoch_shape_ck" CHECK (
    "fdv1_is_sha256"("epoch_sha256")
    AND jsonb_typeof("epoch_json") = 'object'
    AND "effective_at" = date_trunc('milliseconds', "effective_at")
    AND "recorded_at" = date_trunc('milliseconds', "recorded_at")
    AND "effective_at" <= "recorded_at"
    AND "actor_kind" IN ('operator', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_derivative_candidate_relational_closures_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL
    REFERENCES "foundry_derivative_execution_authorization_candidates_v1"("id")
    ON DELETE RESTRICT,
  "candidate_sha256" varchar(71) NOT NULL,
  "candidate_reservation_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL REFERENCES "foundry_jobs"("job_id") ON DELETE RESTRICT,
  "job_spec_sha256" varchar(71) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "ingest_manifest_sha256" varchar(71) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "operation_id" varchar(120) NOT NULL,
  "operation_class" varchar(40) NOT NULL,
  "derivative_class" varchar(80) NOT NULL,
  "rights_purposes_json" jsonb NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "source_asset_type" varchar(40) NOT NULL,
  "source_media_type" varchar(80) NOT NULL,
  "source_suffix" varchar(16) NOT NULL,
  "output_names_json" jsonb NOT NULL,
  "output_slot" varchar(40) NOT NULL,
  "output_filename" varchar(120) NOT NULL,
  "checkpoint_kind" varchar(40) NOT NULL,
  "resumable" boolean NOT NULL,
  "source_mount_mode" varchar(24) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "output_prefix" text NOT NULL,
  "maximum_attempts" integer NOT NULL,
  "output_disposition" varchar(40) NOT NULL,
  "worker_profile_id" varchar(120) NOT NULL,
  "worker_profile_sha256" varchar(71) NOT NULL,
  "container_image_digest" varchar(512) NOT NULL,
  "closure_json" jsonb NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_closure_candidate_uq" UNIQUE("candidate_id"),
  CONSTRAINT "fdv1_closure_ref_uq" UNIQUE("id", "closure_sha256"),
  CONSTRAINT "fdv1_closure_subject_uq" UNIQUE("candidate_sha256", "closure_sha256"),
  CONSTRAINT "fdv1_closure_exact_ck" CHECK (
    "operation_id" = 'normalize_mesh_glb/v0'
    AND "operation_class" = 'deterministic_transformation'
    AND "derivative_class" = 'lossless_internal_format_normalization'
    AND "rights_purposes_json" = '["commercial_internal_use"]'::jsonb
    AND "source_asset_type" = 'glb_gltf'
    AND "source_media_type" = 'model/gltf-binary'
    AND "source_suffix" = '.glb'
    AND "output_names_json" = '["normalized.glb"]'::jsonb
    AND "output_slot" = 'normalized_glb_v0'
    AND "output_filename" = 'normalized.glb'
    AND "checkpoint_kind" = 'none'
    AND NOT "resumable"
    AND "source_mount_mode" = 'read_only'
    AND "maximum_attempts" = 1
    AND "output_disposition" = 'quarantine_only'
  ),
  CONSTRAINT "fdv1_closure_shape_ck" CHECK (
    "fdv1_is_key"("project_id") AND "fdv1_is_key"("job_id")
    AND "fdv1_is_key"("stage_id") AND "fdv1_is_key"("source_asset_id")
    AND "fdv1_is_key"("storage_profile_id")
    AND "fdv1_is_key"("storage_profile_version")
    AND "fdv1_is_key"("worker_profile_id")
    AND "fdv1_is_sha256"("candidate_sha256")
    AND "fdv1_is_sha256"("job_spec_sha256")
    AND "fdv1_is_sha256"("execution_envelope_sha256")
    AND "fdv1_is_sha256"("ingest_manifest_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("worker_profile_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "foundry_is_safe_relative_path"("output_prefix")
    AND jsonb_typeof("closure_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_quarantine_storage_profiles_v1" (
  "profile_id" varchar(120) NOT NULL,
  "profile_version" varchar(120) NOT NULL,
  "profile_sha256" varchar(71) NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "root_prefix" text NOT NULL,
  "object_versioning_required" boolean NOT NULL,
  "object_lock_required" boolean NOT NULL,
  "create_if_absent_required" boolean NOT NULL,
  "broker_policy_sha256" varchar(71) NOT NULL,
  "custodian_policy_sha256" varchar(71) NOT NULL,
  "kms_configuration_sha256" varchar(71) NOT NULL,
  "retention_configuration_sha256" varchar(71) NOT NULL,
  "retention_days" bigint NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "profile_json" jsonb NOT NULL,
  "infrastructure_receipt_sha256" varchar(71) NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "registered_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_storage_pk" PRIMARY KEY("profile_id", "profile_version"),
  CONSTRAINT "fdv1_storage_ref_uq" UNIQUE(
    "profile_id", "profile_version", "profile_sha256"
  ),
  CONSTRAINT "fdv1_storage_sha_uq" UNIQUE("profile_sha256"),
  CONSTRAINT "fdv1_storage_namespace_uq" UNIQUE("bucket", "root_prefix"),
  CONSTRAINT "fdv1_storage_actor_idem_uq" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "fdv1_storage_closed_ck" CHECK (
    "object_versioning_required" AND "object_lock_required"
    AND "create_if_absent_required" AND "retention_days" > 0
    AND "valid_from" < "expires_at"
    AND "root_prefix" = btrim("root_prefix")
    AND right("root_prefix", 1) = '/'
    AND "root_prefix" !~ '(?:^|/)\.\.?(/|$)'
    AND "root_prefix" !~ '[\\?#]'
    AND lower("root_prefix") !~ '^[a-z][a-z0-9+.-]*://'
    AND "fdv1_is_key"("profile_id") AND "fdv1_is_key"("profile_version")
    AND "fdv1_is_sha256"("profile_sha256")
    AND "fdv1_is_sha256"("broker_policy_sha256")
    AND "fdv1_is_sha256"("custodian_policy_sha256")
    AND "fdv1_is_sha256"("kms_configuration_sha256")
    AND "fdv1_is_sha256"("retention_configuration_sha256")
    AND "fdv1_is_sha256"("infrastructure_receipt_sha256")
    AND jsonb_typeof("profile_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_quarantine_storage_profile_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" varchar(120) NOT NULL,
  "profile_version" varchar(120) NOT NULL,
  "profile_sha256" varchar(71) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_storage_revoke_one_uq" UNIQUE(
    "profile_id", "profile_version", "profile_sha256"
  ),
  CONSTRAINT "fdv1_storage_revoke_actor_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_storage_revoke_shape_ck" CHECK (
    "fdv1_is_sha256"("profile_sha256")
    AND "fdv1_is_sha256"("revocation_sha256")
    AND jsonb_typeof("revocation_json") = 'object'
    AND "actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND (("actor_kind" = 'operator') = ("actor_user_id" IS NOT NULL))
  )
);

CREATE TABLE "foundry_derivative_executor_authorizations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_sha256" varchar(71) NOT NULL,
  "issuer" varchar(240) NOT NULL,
  "subject" varchar(240) NOT NULL,
  "audience" varchar(240) NOT NULL,
  "credential_kind" varchar(40) NOT NULL,
  "executor_workload_identity_sha256" varchar(71) NOT NULL,
  "submit_gateway_workload_identity_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_target" varchar(240) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_adapter_configuration_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "request_profile_id" varchar(120) NOT NULL,
  "request_profile_version" varchar(120) NOT NULL,
  "request_profile_sha256" varchar(71) NOT NULL,
  "worker_profile_id" varchar(120) NOT NULL,
  "worker_profile_sha256" varchar(71) NOT NULL,
  "container_image_digest" varchar(512) NOT NULL,
  "command_json" jsonb NOT NULL,
  "operation_id" varchar(120) NOT NULL,
  "operation_class" varchar(40) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "administrator_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "authorization_json" jsonb NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_executor_sha_uq" UNIQUE("authorization_sha256"),
  CONSTRAINT "fdv1_executor_actor_idem_uq" UNIQUE(
    "administrator_user_id", "idempotency_key"
  ),
  CONSTRAINT "fdv1_executor_closed_ck" CHECK (
    "credential_kind" = 'workload_identity'
    AND "operation_id" = 'normalize_mesh_glb/v0'
    AND "operation_class" = 'deterministic_transformation'
    AND "command_json" = '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
    AND "valid_from" < "expires_at"
    AND "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("executor_workload_identity_sha256")
    AND "fdv1_is_sha256"("submit_gateway_workload_identity_sha256")
    AND "fdv1_is_sha256"("provider_adapter_artifact_sha256")
    AND "fdv1_is_sha256"("provider_adapter_configuration_sha256")
    AND "fdv1_is_sha256"("provider_deployment_sha256")
    AND "fdv1_is_sha256"("request_profile_sha256")
    AND "fdv1_is_sha256"("worker_profile_sha256")
    AND jsonb_typeof("authorization_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_executor_authorization_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_id" uuid NOT NULL
    REFERENCES "foundry_derivative_executor_authorizations_v1"("id") ON DELETE RESTRICT,
  "authorization_sha256" varchar(71) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_executor_revoke_one_uq" UNIQUE("authorization_id"),
  CONSTRAINT "fdv1_executor_revoke_actor_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_executor_revoke_shape_ck" CHECK (
    "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("revocation_sha256")
    AND jsonb_typeof("revocation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_output_broker_authorizations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_sha256" varchar(71) NOT NULL,
  "reservation_id" uuid NOT NULL,
  "reservation_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "issuer" varchar(240) NOT NULL,
  "subject" varchar(240) NOT NULL,
  "audience" varchar(240) NOT NULL,
  "credential_sha256" varchar(71) NOT NULL,
  "workload_identity_sha256" varchar(71) NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "object_key" text NOT NULL,
  "create_only_policy_sha256" varchar(71) NOT NULL,
  "broker_artifact_sha256" varchar(71) NOT NULL,
  "capability_sha256" varchar(71) NOT NULL,
  "planned_upload_operation_id" uuid NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "credential_expires_at" timestamptz NOT NULL,
  "maximum_put_seconds" integer NOT NULL,
  "authorization_json" jsonb NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_broker_reservation_uq" UNIQUE("reservation_id"),
  CONSTRAINT "fdv1_broker_sha_uq" UNIQUE("authorization_sha256"),
  CONSTRAINT "fdv1_broker_capability_uq" UNIQUE("capability_sha256"),
  CONSTRAINT "fdv1_broker_plan_uq" UNIQUE("planned_upload_operation_id"),
  CONSTRAINT "fdv1_broker_closed_ck" CHECK (
    "issued_at" < "expires_at" AND "issued_at" < "credential_expires_at"
    AND "maximum_put_seconds" BETWEEN 1 AND 300
    AND "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("reservation_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("credential_sha256")
    AND "fdv1_is_sha256"("workload_identity_sha256")
    AND "fdv1_is_sha256"("create_only_policy_sha256")
    AND "fdv1_is_sha256"("broker_artifact_sha256")
    AND "fdv1_is_sha256"("capability_sha256")
    AND jsonb_typeof("authorization_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_output_broker_authorization_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_id" uuid NOT NULL
    REFERENCES "foundry_derivative_output_broker_authorizations_v1"("id")
    ON DELETE RESTRICT,
  "authorization_sha256" varchar(71) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_broker_revoke_one_uq" UNIQUE("authorization_id"),
  CONSTRAINT "fdv1_broker_revoke_actor_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_broker_revoke_shape_ck" CHECK (
    "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("revocation_sha256")
    AND jsonb_typeof("revocation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_output_custodian_authorizations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_sha256" varchar(71) NOT NULL,
  "reservation_id" uuid NOT NULL,
  "reservation_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "broker_object_use_id" uuid NOT NULL,
  "create_receipt_id" uuid NOT NULL,
  "create_receipt_sha256" varchar(71) NOT NULL,
  "create_receipt_json" jsonb NOT NULL,
  "issuer" varchar(240) NOT NULL,
  "subject" varchar(240) NOT NULL,
  "audience" varchar(240) NOT NULL,
  "credential_sha256" varchar(71) NOT NULL,
  "workload_identity_sha256" varchar(71) NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "object_key" text NOT NULL,
  "object_version" varchar(240) NOT NULL,
  "version_read_only_policy_sha256" varchar(71) NOT NULL,
  "verifier_id" varchar(120) NOT NULL,
  "verifier_version" varchar(120) NOT NULL,
  "verifier_sha256" varchar(71) NOT NULL,
  "planned_read_receipt_id" uuid NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "authorization_json" jsonb NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_custodian_reservation_uq" UNIQUE("reservation_id"),
  CONSTRAINT "fdv1_custodian_sha_uq" UNIQUE("authorization_sha256"),
  CONSTRAINT "fdv1_custodian_create_uq" UNIQUE("create_receipt_id"),
  CONSTRAINT "fdv1_custodian_read_plan_uq" UNIQUE("planned_read_receipt_id"),
  CONSTRAINT "fdv1_custodian_object_uq" UNIQUE("bucket", "object_key", "object_version"),
  CONSTRAINT "fdv1_custodian_closed_ck" CHECK (
    "valid_from" < "expires_at"
    AND "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("reservation_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("create_receipt_sha256")
    AND "fdv1_is_sha256"("credential_sha256")
    AND "fdv1_is_sha256"("workload_identity_sha256")
    AND "fdv1_is_sha256"("version_read_only_policy_sha256")
    AND "fdv1_is_sha256"("verifier_sha256")
    AND jsonb_typeof("create_receipt_json") = 'object'
    AND jsonb_typeof("authorization_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_custodian_auth_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authorization_id" uuid NOT NULL
    REFERENCES "foundry_derivative_output_custodian_authorizations_v1"("id")
    ON DELETE RESTRICT,
  "authorization_sha256" varchar(71) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_custodian_revoke_one_uq" UNIQUE("authorization_id"),
  CONSTRAINT "fdv1_custodian_revoke_actor_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_custodian_revoke_shape_ck" CHECK (
    "fdv1_is_sha256"("authorization_sha256")
    AND "fdv1_is_sha256"("revocation_sha256")
    AND jsonb_typeof("revocation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_execution_activations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "candidate_id" uuid NOT NULL
    REFERENCES "foundry_derivative_execution_authorization_candidates_v1"("id")
    ON DELETE RESTRICT,
  "candidate_sha256" varchar(71) NOT NULL,
  "candidate_reservation_id" uuid NOT NULL,
  "approval_id" varchar(120) NOT NULL,
  "review_id" uuid NOT NULL,
  "attestation_id" uuid NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "ingest_manifest_sha256" varchar(71) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "worker_profile_id" varchar(120) NOT NULL,
  "worker_profile_sha256" varchar(71) NOT NULL,
  "restriction_lineage_sha256" varchar(71) NOT NULL,
  "output_policy_sha256" varchar(71) NOT NULL,
  "executor_authorization_id" uuid NOT NULL
    REFERENCES "foundry_derivative_executor_authorizations_v1"("id") ON DELETE RESTRICT,
  "executor_authorization_sha256" varchar(71) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "epoch_generation" bigint NOT NULL,
  "epoch_sha256" varchar(71) NOT NULL,
  "epoch_effective_at" timestamptz NOT NULL,
  "epoch_enabled" boolean NOT NULL,
  "authority" varchar(24) NOT NULL,
  "execution_eligible" boolean NOT NULL,
  "dispatch_enabled" boolean NOT NULL,
  "output_disposition" varchar(40) NOT NULL,
  "single_submit_redemption" boolean NOT NULL,
  "single_initial_start" boolean NOT NULL,
  "authority_not_after" timestamptz NOT NULL,
  "administrator_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "activation_json" jsonb NOT NULL,
  "activated_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_activation_candidate_uq" UNIQUE("candidate_id"),
  CONSTRAINT "fdv1_activation_execution_uq" UNIQUE("execution_id"),
  CONSTRAINT "fdv1_activation_sha_uq" UNIQUE("activation_sha256"),
  CONSTRAINT "fdv1_activation_ref_uq" UNIQUE("id", "activation_sha256"),
  CONSTRAINT "fdv1_activation_actor_idem_uq" UNIQUE(
    "administrator_user_id", "idempotency_key"
  ),
  CONSTRAINT "fdv1_activation_closed_ck" CHECK (
    "authority" = 'execute_once' AND "execution_eligible" AND "dispatch_enabled"
    AND "output_disposition" = 'quarantine_only'
    AND "single_submit_redemption" AND "single_initial_start"
    AND "epoch_enabled" AND "activated_at" < "authority_not_after"
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("candidate_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("execution_subject_sha256")
    AND "fdv1_is_sha256"("execution_envelope_sha256")
    AND "fdv1_is_sha256"("ingest_manifest_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("worker_profile_sha256")
    AND "fdv1_is_sha256"("restriction_lineage_sha256")
    AND "fdv1_is_sha256"("output_policy_sha256")
    AND "fdv1_is_sha256"("executor_authorization_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("epoch_sha256")
    AND jsonb_typeof("activation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_execution_activation_revocations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "activation_id" uuid NOT NULL
    REFERENCES "foundry_derivative_execution_activations_v1"("id") ON DELETE RESTRICT,
  "activation_sha256" varchar(71) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "revocation_json" jsonb NOT NULL,
  "revocation_sha256" varchar(71) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_activation_revoke_one_uq" UNIQUE("activation_id"),
  CONSTRAINT "fdv1_activation_revoke_actor_uq" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "fdv1_activation_revoke_shape_ck" CHECK (
    "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("revocation_sha256")
    AND jsonb_typeof("revocation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_prepared_request_sidecars_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prepared_request_id" uuid NOT NULL
    REFERENCES "foundry_prepared_provider_requests"("id") ON DELETE RESTRICT,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "command_kind" varchar(40) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "output_slot" varchar(40) NOT NULL,
  "output_filename" varchar(120) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "output_prefix" text NOT NULL,
  "provider_request_sha256" varchar(71) NOT NULL,
  "sidecar_json" jsonb NOT NULL,
  "sidecar_sha256" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_prepared_request_uq" UNIQUE("prepared_request_id"),
  CONSTRAINT "fdv1_prepared_ref_uq" UNIQUE("id", "sidecar_sha256"),
  CONSTRAINT "fdv1_prepared_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "command_kind" IN (
      'provider_submit', 'provider_poll', 'provider_reconcile', 'provider_stop'
    )
    AND "output_slot" = 'normalized_glb_v0'
    AND "output_filename" = 'normalized.glb'
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("provider_request_sha256")
    AND "fdv1_is_sha256"("sidecar_sha256")
    AND jsonb_typeof("sidecar_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_provider_command_sidecars_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_command_id" uuid NOT NULL
    REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT,
  "prepared_request_id" uuid NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "command_kind" varchar(40) NOT NULL,
  "command_payload_sha256" varchar(71) NOT NULL,
  "provider_request_sha256" varchar(71) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "output_slot" varchar(40) NOT NULL,
  "output_filename" varchar(120) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "output_prefix" text NOT NULL,
  "sidecar_json" jsonb NOT NULL,
  "sidecar_sha256" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_command_sidecar_command_uq" UNIQUE("provider_command_id"),
  CONSTRAINT "fdv1_command_sidecar_ref_uq" UNIQUE("id", "sidecar_sha256"),
  CONSTRAINT "fdv1_command_sidecar_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "command_kind" IN (
      'provider_submit', 'provider_poll', 'provider_reconcile', 'provider_stop'
    )
    AND "output_slot" = 'normalized_glb_v0'
    AND "output_filename" = 'normalized.glb'
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("command_payload_sha256")
    AND "fdv1_is_sha256"("provider_request_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("sidecar_sha256")
    AND jsonb_typeof("sidecar_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_output_reservations_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "output_slot" varchar(40) NOT NULL,
  "output_filename" varchar(120) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "output_prefix" text NOT NULL,
  "object_key" text NOT NULL,
  "spool_root_identity" varchar(240) NOT NULL,
  "spool_identity" varchar(240) NOT NULL,
  "relative_spool_path" text NOT NULL,
  "expected_broker_workload_sha256" varchar(71) NOT NULL,
  "expected_broker_policy_sha256" varchar(71) NOT NULL,
  "expected_custodian_workload_sha256" varchar(71) NOT NULL,
  "expected_custodian_policy_sha256" varchar(71) NOT NULL,
  "glb_verifier_id" varchar(120) NOT NULL,
  "glb_verifier_version" varchar(120) NOT NULL,
  "glb_verifier_sha256" varchar(71) NOT NULL,
  "reserved_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "authority_not_after" timestamptz NOT NULL,
  "reservation_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_reservation_sha_uq" UNIQUE("reservation_sha256"),
  CONSTRAINT "fdv1_reservation_ref_uq" UNIQUE("id", "reservation_sha256"),
  CONSTRAINT "fdv1_reservation_activation_slot_uq" UNIQUE("activation_id", "output_slot"),
  CONSTRAINT "fdv1_reservation_object_uq" UNIQUE("bucket", "object_key"),
  CONSTRAINT "fdv1_reservation_attempt_stage_uq" UNIQUE(
    "execution_id", "attempt_id", "fencing_token", "stage_id"
  ),
  CONSTRAINT "fdv1_reservation_spool_uq" UNIQUE("spool_root_identity", "spool_identity"),
  CONSTRAINT "fdv1_reservation_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "output_slot" = 'normalized_glb_v0'
    AND "output_filename" = 'normalized.glb'
    AND "relative_spool_path" = 'normalized.glb'
    AND "object_key" = "output_prefix" || '/normalized.glb'
    AND "foundry_is_safe_relative_path"("output_prefix")
    AND "reserved_at" < "expires_at"
    AND "reserved_at" < "authority_not_after"
    AND "fdv1_is_sha256"("reservation_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("execution_subject_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("expected_broker_workload_sha256")
    AND "fdv1_is_sha256"("expected_broker_policy_sha256")
    AND "fdv1_is_sha256"("expected_custodian_workload_sha256")
    AND "fdv1_is_sha256"("expected_custodian_policy_sha256")
    AND "fdv1_is_sha256"("glb_verifier_sha256")
    AND jsonb_typeof("reservation_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_submit_once_grants_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "grant_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "prepared_request_id" uuid NOT NULL,
  "provider_command_id" uuid NOT NULL,
  "command_payload_sha256" varchar(71) NOT NULL,
  "provider_request_sha256" varchar(71) NOT NULL,
  "provider_idempotency_key" varchar(120) NOT NULL,
  "claim_token" uuid NOT NULL,
  "claimed_by" varchar(160) NOT NULL,
  "executor_authorization_id" uuid NOT NULL,
  "executor_workload_identity_sha256" varchar(71) NOT NULL,
  "submit_gateway_workload_identity_sha256" varchar(71) NOT NULL,
  "token_sha256" varchar(71) NOT NULL,
  "planned_invocation_event_id" uuid NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "authority_not_after" timestamptz NOT NULL,
  "receipt_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_submit_grant_activation_uq" UNIQUE("activation_id"),
  CONSTRAINT "fdv1_submit_grant_sha_uq" UNIQUE("grant_sha256"),
  CONSTRAINT "fdv1_submit_grant_claim_uq" UNIQUE(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ),
  CONSTRAINT "fdv1_submit_grant_token_uq" UNIQUE("token_sha256"),
  CONSTRAINT "fdv1_submit_grant_event_uq" UNIQUE("planned_invocation_event_id"),
  CONSTRAINT "fdv1_submit_grant_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "issued_at" < "expires_at" AND "issued_at" < "authority_not_after"
    AND "foundry_is_canonical_actor"("claimed_by")
    AND "fdv1_is_sha256"("grant_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("command_payload_sha256")
    AND "fdv1_is_sha256"("provider_request_sha256")
    AND "fdv1_is_sha256"("executor_workload_identity_sha256")
    AND "fdv1_is_sha256"("submit_gateway_workload_identity_sha256")
    AND "fdv1_is_sha256"("token_sha256")
    AND jsonb_typeof("receipt_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_submit_once_redemptions_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "redemption_sha256" varchar(71) NOT NULL,
  "grant_id" uuid NOT NULL
    REFERENCES "foundry_derivative_submit_once_grants_v1"("id") ON DELETE RESTRICT,
  "grant_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "provider_command_id" uuid NOT NULL,
  "claim_token" uuid NOT NULL,
  "claimed_by" varchar(160) NOT NULL,
  "fencing_token" bigint NOT NULL,
  "token_sha256" varchar(71) NOT NULL,
  "invocation_event_id" uuid NOT NULL
    REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  "external_idempotency_key" varchar(120) NOT NULL,
  "redeemed_at" timestamptz NOT NULL,
  "receipt_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_submit_redeem_grant_uq" UNIQUE("grant_id"),
  CONSTRAINT "fdv1_submit_redeem_activation_uq" UNIQUE("activation_id"),
  CONSTRAINT "fdv1_submit_redeem_claim_uq" UNIQUE(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ),
  CONSTRAINT "fdv1_submit_redeem_token_uq" UNIQUE("token_sha256"),
  CONSTRAINT "fdv1_submit_redeem_event_uq" UNIQUE("invocation_event_id"),
  CONSTRAINT "fdv1_submit_redeem_external_uq" UNIQUE("external_idempotency_key"),
  CONSTRAINT "fdv1_submit_redeem_closed_ck" CHECK (
    "fencing_token" > 0 AND "foundry_is_canonical_actor"("claimed_by")
    AND "fdv1_is_sha256"("redemption_sha256")
    AND "fdv1_is_sha256"("grant_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("token_sha256")
    AND jsonb_typeof("receipt_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_recovery_authorities_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "fencing_token" bigint NOT NULL,
  "historical_source_kind" varchar(32) NOT NULL,
  "historical_source_id" uuid NOT NULL,
  "historical_source_sha256" varchar(71) NOT NULL,
  "provider_execution_ref" varchar(240),
  "recovery_gateway_workload_sha256" varchar(71) NOT NULL,
  "allowed_kinds_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  "retention_not_after" timestamptz NOT NULL,
  "authority_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_recovery_authority_source_uq" UNIQUE(
    "activation_id", "attempt_id", "fencing_token",
    "historical_source_kind", "historical_source_id"
  ),
  CONSTRAINT "fdv1_recovery_authority_sha_uq" UNIQUE("authority_sha256"),
  CONSTRAINT "fdv1_recovery_authority_closed_ck" CHECK (
    "fencing_token" > 0
    AND "historical_source_kind" IN ('submit_redemption', 'containment_event')
    AND (
      ("historical_source_kind" = 'submit_redemption'
        AND "allowed_kinds_json" = '["provider_poll","provider_reconcile","provider_stop"]'::jsonb)
      OR
      ("historical_source_kind" = 'containment_event'
        AND "allowed_kinds_json" = '["provider_stop"]'::jsonb)
    )
    AND "created_at" < "retention_not_after"
    AND "fdv1_is_sha256"("authority_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("historical_source_sha256")
    AND "fdv1_is_sha256"("recovery_gateway_workload_sha256")
    AND jsonb_typeof("authority_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_recovery_call_grants_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "grant_sha256" varchar(71) NOT NULL,
  "recovery_authority_id" uuid NOT NULL
    REFERENCES "foundry_derivative_recovery_authorities_v1"("id") ON DELETE RESTRICT,
  "recovery_authority_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "fencing_token" bigint NOT NULL,
  "provider_command_id" uuid NOT NULL,
  "claim_token" uuid NOT NULL,
  "claimed_by" varchar(160) NOT NULL,
  "call_kind" varchar(32) NOT NULL,
  "target_provider_ref" varchar(240),
  "stop_intent_id" uuid,
  "stop_intent_sha256" varchar(71),
  "token_sha256" varchar(71) NOT NULL,
  "planned_call_event_id" uuid NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "authority_not_after" timestamptz NOT NULL,
  "receipt_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_recovery_grant_sha_uq" UNIQUE("grant_sha256"),
  CONSTRAINT "fdv1_recovery_grant_claim_uq" UNIQUE(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ),
  CONSTRAINT "fdv1_recovery_grant_token_uq" UNIQUE("token_sha256"),
  CONSTRAINT "fdv1_recovery_grant_event_uq" UNIQUE("planned_call_event_id"),
  CONSTRAINT "fdv1_recovery_grant_closed_ck" CHECK (
    "fencing_token" > 0
    AND "call_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop')
    AND (("call_kind" = 'provider_stop') = ("stop_intent_id" IS NOT NULL))
    AND (("stop_intent_id" IS NULL) = ("stop_intent_sha256" IS NULL))
    AND ("stop_intent_sha256" IS NULL OR "fdv1_is_sha256"("stop_intent_sha256"))
    AND "issued_at" < "expires_at" AND "issued_at" < "authority_not_after"
    AND "foundry_is_canonical_actor"("claimed_by")
    AND "fdv1_is_sha256"("grant_sha256")
    AND "fdv1_is_sha256"("recovery_authority_sha256")
    AND "fdv1_is_sha256"("token_sha256")
    AND jsonb_typeof("receipt_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_recovery_call_redemptions_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "redemption_sha256" varchar(71) NOT NULL,
  "grant_id" uuid NOT NULL
    REFERENCES "foundry_derivative_recovery_call_grants_v1"("id") ON DELETE RESTRICT,
  "grant_sha256" varchar(71) NOT NULL,
  "recovery_authority_id" uuid NOT NULL,
  "provider_command_id" uuid NOT NULL,
  "claim_token" uuid NOT NULL,
  "claimed_by" varchar(160) NOT NULL,
  "fencing_token" bigint NOT NULL,
  "token_sha256" varchar(71) NOT NULL,
  "call_kind" varchar(32) NOT NULL,
  "call_event_id" uuid NOT NULL
    REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  "provider_idempotency_key" varchar(120) NOT NULL,
  "redeemed_at" timestamptz NOT NULL,
  "receipt_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_recovery_redeem_grant_uq" UNIQUE("grant_id"),
  CONSTRAINT "fdv1_recovery_redeem_claim_uq" UNIQUE(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ),
  CONSTRAINT "fdv1_recovery_redeem_token_uq" UNIQUE("token_sha256"),
  CONSTRAINT "fdv1_recovery_redeem_event_uq" UNIQUE("call_event_id"),
  CONSTRAINT "fdv1_recovery_redeem_provider_uq" UNIQUE("provider_idempotency_key"),
  CONSTRAINT "fdv1_recovery_redeem_closed_ck" CHECK (
    "fencing_token" > 0
    AND "call_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop')
    AND "foundry_is_canonical_actor"("claimed_by")
    AND "fdv1_is_sha256"("redemption_sha256")
    AND "fdv1_is_sha256"("grant_sha256")
    AND "fdv1_is_sha256"("token_sha256")
    AND jsonb_typeof("receipt_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_broker_object_uses_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "use_sha256" varchar(71) NOT NULL,
  "broker_authorization_id" uuid NOT NULL
    REFERENCES "foundry_derivative_output_broker_authorizations_v1"("id")
    ON DELETE RESTRICT,
  "broker_authorization_sha256" varchar(71) NOT NULL,
  "reservation_id" uuid NOT NULL,
  "reservation_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "closure_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "fencing_token" bigint NOT NULL,
  "capability_token_sha256" varchar(71) NOT NULL,
  "spool_root_identity" varchar(240) NOT NULL,
  "spool_identity" varchar(240) NOT NULL,
  "relative_spool_path" text NOT NULL,
  "local_sha256" varchar(71) NOT NULL,
  "local_byte_length" bigint NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "object_key" text NOT NULL,
  "upload_operation_id" uuid NOT NULL,
  "authorized_at" timestamptz NOT NULL,
  "put_not_after" timestamptz NOT NULL,
  "use_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_broker_use_auth_uq" UNIQUE("broker_authorization_id"),
  CONSTRAINT "fdv1_broker_use_token_uq" UNIQUE("capability_token_sha256"),
  CONSTRAINT "fdv1_broker_use_plan_uq" UNIQUE("upload_operation_id"),
  CONSTRAINT "fdv1_broker_use_sha_uq" UNIQUE("use_sha256"),
  CONSTRAINT "fdv1_broker_use_closed_ck" CHECK (
    "fencing_token" > 0 AND "relative_spool_path" = 'normalized.glb'
    AND "local_byte_length" > 0 AND "authorized_at" < "put_not_after"
    AND "fdv1_is_sha256"("use_sha256")
    AND "fdv1_is_sha256"("broker_authorization_sha256")
    AND "fdv1_is_sha256"("reservation_sha256")
    AND "fdv1_is_sha256"("capability_token_sha256")
    AND "fdv1_is_sha256"("local_sha256")
    AND jsonb_typeof("use_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_execution_containment_events_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "containment_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "source_kind" varchar(80) NOT NULL,
  "source_id" text NOT NULL,
  "source_sha256" varchar(71) NOT NULL,
  "target_terminal_state" varchar(40) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "correlation_id" uuid NOT NULL,
  "containment_json" jsonb NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_containment_source_uq" UNIQUE(
    "source_kind", "source_id", "attempt_id", "fencing_token"
  ),
  CONSTRAINT "fdv1_containment_sha_uq" UNIQUE("containment_sha256"),
  CONSTRAINT "fdv1_containment_ref_uq" UNIQUE(
    "id", "containment_sha256", "recorded_at"
  ),
  CONSTRAINT "fdv1_containment_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "source_kind" IN (
      'derivative_policy_revocation',
      'derivative_policy_generation_superseded',
      'base_policy_revocation',
      'base_policy_generation_superseded',
      'registry_attestation_revocation',
      'executor_authorization_revocation',
      'output_broker_authorization_revocation',
      'output_custodian_authorization_revocation',
      'quarantine_storage_profile_revocation',
      'activation_revocation',
      'activation_epoch_disabled',
      'activation_epoch_replaced',
      'derivative_authority_expired',
      'global_or_scoped_kill',
      'quarantine_security_event'
    )
    AND "target_terminal_state" = 'terminal_killed'
    AND "actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND (("actor_kind" = 'operator') = ("actor_user_id" IS NOT NULL))
    AND "foundry_is_canonical_actor"("actor_key")
    AND "fdv1_is_sha256"("containment_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("source_sha256")
    AND jsonb_typeof("containment_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_output_custody_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "custody_sha256" varchar(71) NOT NULL,
  "activation_id" uuid NOT NULL,
  "activation_sha256" varchar(71) NOT NULL,
  "closure_id" uuid NOT NULL,
  "closure_sha256" varchar(71) NOT NULL,
  "execution_id" uuid NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "source_asset_id" varchar(120) NOT NULL,
  "source_asset_sha256" varchar(71) NOT NULL,
  "output_slot" varchar(40) NOT NULL,
  "output_filename" varchar(120) NOT NULL,
  "reservation_id" uuid NOT NULL,
  "reservation_sha256" varchar(71) NOT NULL,
  "storage_profile_id" varchar(120) NOT NULL,
  "storage_profile_version" varchar(120) NOT NULL,
  "storage_profile_sha256" varchar(71) NOT NULL,
  "output_prefix" text NOT NULL,
  "submit_command_id" uuid NOT NULL,
  "submit_claim_token" uuid NOT NULL,
  "submit_claimed_by" varchar(160) NOT NULL,
  "submit_grant_id" uuid NOT NULL,
  "submit_redemption_id" uuid NOT NULL,
  "invocation_event_id" uuid NOT NULL,
  "executor_workload_identity_sha256" varchar(71) NOT NULL,
  "submit_gateway_workload_identity_sha256" varchar(71) NOT NULL,
  "broker_authorization_id" uuid NOT NULL,
  "broker_object_use_id" uuid NOT NULL,
  "broker_workload_identity_sha256" varchar(71) NOT NULL,
  "capability_sha256" varchar(71) NOT NULL,
  "create_receipt_id" uuid NOT NULL,
  "create_receipt_sha256" varchar(71) NOT NULL,
  "bucket" varchar(255) NOT NULL,
  "object_key" text NOT NULL,
  "object_version" varchar(240) NOT NULL,
  "etag" varchar(240) NOT NULL,
  "custodian_authorization_id" uuid NOT NULL,
  "custodian_workload_identity_sha256" varchar(71) NOT NULL,
  "read_receipt_id" uuid NOT NULL,
  "read_receipt_sha256" varchar(71) NOT NULL,
  "read_receipt_json" jsonb NOT NULL,
  "raw_sha256" char(64) NOT NULL,
  "prefixed_sha256" varchar(71) NOT NULL,
  "byte_length" bigint NOT NULL,
  "media_type" varchar(80) NOT NULL,
  "suffix" varchar(16) NOT NULL,
  "glb_magic" char(4) NOT NULL,
  "glb_version" integer NOT NULL,
  "glb_declared_length" bigint NOT NULL,
  "glb_structure_valid" boolean NOT NULL,
  "result_observation_id" uuid NOT NULL,
  "provider_command_outcome_sha256" varchar(71) NOT NULL,
  "completion_event_id" uuid NOT NULL,
  "result_classification_id" uuid NOT NULL,
  "worker_manifest_sha256" varchar(71) NOT NULL,
  "worker_manifest_json" jsonb NOT NULL,
  "restriction_lineage_sha256" varchar(71) NOT NULL,
  "restriction_lineage_json" jsonb NOT NULL,
  "output_policy_sha256" varchar(71) NOT NULL,
  "content_valid" boolean NOT NULL,
  "result_valid" boolean NOT NULL,
  "public_reverse_scan_clear" boolean NOT NULL,
  "authority_current" boolean NOT NULL,
  "disposition" varchar(48) NOT NULL,
  "worker_observed_at" timestamptz NOT NULL,
  "broker_authorized_at" timestamptz NOT NULL,
  "custodian_read_at" timestamptz NOT NULL,
  "committed_at" timestamptz NOT NULL,
  "release_authorized" boolean NOT NULL,
  "signing_authorized" boolean NOT NULL,
  "publication_authorized" boolean NOT NULL,
  "redistribution_authorized" boolean NOT NULL,
  "public_serving_authorized" boolean NOT NULL,
  "runtime_promotion_authorized" boolean NOT NULL,
  "custody_json" jsonb NOT NULL,
  CONSTRAINT "fdv1_custody_sha_uq" UNIQUE("custody_sha256"),
  CONSTRAINT "fdv1_custody_object_uq" UNIQUE("bucket", "object_key", "object_version"),
  CONSTRAINT "fdv1_custody_closed_ck" CHECK (
    "attempt_ordinal" = 1 AND "fencing_token" > 0
    AND "output_slot" = 'normalized_glb_v0'
    AND "output_filename" = 'normalized.glb'
    AND "media_type" = 'model/gltf-binary' AND "suffix" = '.glb'
    AND "glb_magic" = 'glTF' AND "glb_version" = 2
    AND "glb_declared_length" = "byte_length" AND "byte_length" > 0
    AND "prefixed_sha256" = 'sha256:' || "raw_sha256"
    AND "fdv1_is_raw_sha256"("raw_sha256")
    AND "disposition" IN (
      'quarantined_invalid', 'quarantined_conflict',
      'quarantined_late_authority', 'quarantined_current_authority'
    )
    AND NOT "release_authorized" AND NOT "signing_authorized"
    AND NOT "publication_authorized" AND NOT "redistribution_authorized"
    AND NOT "public_serving_authorized" AND NOT "runtime_promotion_authorized"
    AND "worker_observed_at" <= "broker_authorized_at"
    AND "broker_authorized_at" <= "custodian_read_at"
    AND "custodian_read_at" <= "committed_at"
    AND "fdv1_is_sha256"("custody_sha256")
    AND "fdv1_is_sha256"("activation_sha256")
    AND "fdv1_is_sha256"("closure_sha256")
    AND "fdv1_is_sha256"("execution_subject_sha256")
    AND "fdv1_is_sha256"("source_asset_sha256")
    AND "fdv1_is_sha256"("reservation_sha256")
    AND "fdv1_is_sha256"("storage_profile_sha256")
    AND "fdv1_is_sha256"("executor_workload_identity_sha256")
    AND "fdv1_is_sha256"("submit_gateway_workload_identity_sha256")
    AND "fdv1_is_sha256"("broker_workload_identity_sha256")
    AND "fdv1_is_sha256"("capability_sha256")
    AND "fdv1_is_sha256"("create_receipt_sha256")
    AND "fdv1_is_sha256"("custodian_workload_identity_sha256")
    AND "fdv1_is_sha256"("read_receipt_sha256")
    AND "fdv1_is_sha256"("provider_command_outcome_sha256")
    AND "fdv1_is_sha256"("worker_manifest_sha256")
    AND "fdv1_is_sha256"("restriction_lineage_sha256")
    AND "fdv1_is_sha256"("output_policy_sha256")
    AND jsonb_typeof("read_receipt_json") = 'object'
    AND jsonb_typeof("worker_manifest_json") = 'object'
    AND jsonb_typeof("restriction_lineage_json") = 'object'
    AND jsonb_typeof("custody_json") = 'object'
  )
);

CREATE TABLE "foundry_derivative_quarantine_security_events_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_sha256" varchar(71) NOT NULL,
  "event_kind" varchar(80) NOT NULL,
  "severity" varchar(16) NOT NULL,
  "state" varchar(24) NOT NULL,
  "offending_table" varchar(63) NOT NULL,
  "offending_row_id" text,
  "reason_code" varchar(80) NOT NULL,
  "namespace_identity" text,
  "custody_id" uuid,
  "activation_id" uuid,
  "execution_id" uuid,
  "attempt_id" uuid,
  "fencing_token" bigint,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "correlation_id" uuid NOT NULL,
  "event_json" jsonb NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "fdv1_security_event_sha_uq" UNIQUE("event_sha256"),
  CONSTRAINT "fdv1_security_event_dedupe_uq" UNIQUE(
    "offending_table", "offending_row_id", "reason_code",
    "custody_id", "namespace_identity"
  ),
  CONSTRAINT "fdv1_security_event_closed_ck" CHECK (
    "event_kind" = 'quarantine_security_event'
    AND "severity" IN ('high', 'critical')
    AND "state" IN ('detected', 'contained', 'retained')
    AND "actor_kind" IN ('service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND ("fencing_token" IS NULL OR "fencing_token" > 0)
    AND "fdv1_is_sha256"("event_sha256")
    AND jsonb_typeof("event_json") = 'object'
  )
);

-- Small, referencable natural keys.  Phase guards compare every duplicated
-- leaf after locking these compact identities; no wide composite exceeds the
-- reviewed 32-column ceiling.
ALTER TABLE "foundry_provider_commands"
  ADD CONSTRAINT "fdv1_command_claim_ref_uq"
  UNIQUE("id", "claim_token", "claimed_by", "fencing_token");

ALTER TABLE "foundry_derivative_candidate_relational_closures_v1"
  ADD CONSTRAINT "fdv1_closure_storage_fk" FOREIGN KEY(
    "storage_profile_id", "storage_profile_version", "storage_profile_sha256"
  ) REFERENCES "foundry_derivative_quarantine_storage_profiles_v1"(
    "profile_id", "profile_version", "profile_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_quarantine_storage_profile_revocations_v1"
  ADD CONSTRAINT "fdv1_storage_revoke_profile_fk" FOREIGN KEY(
    "profile_id", "profile_version", "profile_sha256"
  ) REFERENCES "foundry_derivative_quarantine_storage_profiles_v1"(
    "profile_id", "profile_version", "profile_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_execution_activations_v1"
  ADD CONSTRAINT "fdv1_activation_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_activation_execution_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"("id", "execution_subject_sha256")
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "fdv1_activation_epoch_fk" FOREIGN KEY(
    "epoch_generation", "epoch_sha256", "epoch_effective_at", "epoch_enabled"
  ) REFERENCES "foundry_derivative_execution_activation_epochs_v1"(
    "generation", "epoch_sha256", "effective_at", "enabled"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_activation_storage_fk" FOREIGN KEY(
    "storage_profile_id", "storage_profile_version", "storage_profile_sha256"
  ) REFERENCES "foundry_derivative_quarantine_storage_profiles_v1"(
    "profile_id", "profile_version", "profile_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_prepared_request_sidecars_v1"
  ADD CONSTRAINT "fdv1_prepared_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_prepared_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_provider_command_sidecars_v1"
  ADD CONSTRAINT "fdv1_command_sidecar_prepared_fk" FOREIGN KEY(
    "prepared_request_id"
  ) REFERENCES "foundry_derivative_prepared_request_sidecars_v1"(
    "prepared_request_id"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_command_sidecar_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_command_sidecar_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_output_reservations_v1"
  ADD CONSTRAINT "fdv1_reservation_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_reservation_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_reservation_execution_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"("id", "execution_subject_sha256")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_reservation_attempt_fk" FOREIGN KEY("attempt_id")
    REFERENCES "foundry_attempts"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_reservation_storage_fk" FOREIGN KEY(
    "storage_profile_id", "storage_profile_version", "storage_profile_sha256"
  ) REFERENCES "foundry_derivative_quarantine_storage_profiles_v1"(
    "profile_id", "profile_version", "profile_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_submit_once_grants_v1"
  ADD CONSTRAINT "fdv1_submit_grant_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_submit_grant_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_submit_grant_prepared_fk" FOREIGN KEY(
    "prepared_request_id"
  ) REFERENCES "foundry_derivative_prepared_request_sidecars_v1"(
    "prepared_request_id"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_submit_grant_claim_fk" FOREIGN KEY(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ) REFERENCES "foundry_provider_commands"(
    "id", "claim_token", "claimed_by", "fencing_token"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_submit_grant_executor_fk" FOREIGN KEY(
    "executor_authorization_id"
  ) REFERENCES "foundry_derivative_executor_authorizations_v1"("id")
    ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_submit_once_redemptions_v1"
  ADD CONSTRAINT "fdv1_submit_redeem_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_submit_redeem_claim_fk" FOREIGN KEY(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ) REFERENCES "foundry_provider_commands"(
    "id", "claim_token", "claimed_by", "fencing_token"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_recovery_call_grants_v1"
  ADD CONSTRAINT "fdv1_recovery_grant_claim_fk" FOREIGN KEY(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ) REFERENCES "foundry_provider_commands"(
    "id", "claim_token", "claimed_by", "fencing_token"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_recovery_grant_stop_fk" FOREIGN KEY("stop_intent_id")
    REFERENCES "foundry_stop_intents"("id") ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_recovery_call_redemptions_v1"
  ADD CONSTRAINT "fdv1_recovery_redeem_authority_fk" FOREIGN KEY(
    "recovery_authority_id"
  ) REFERENCES "foundry_derivative_recovery_authorities_v1"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_recovery_redeem_claim_fk" FOREIGN KEY(
    "provider_command_id", "claim_token", "claimed_by", "fencing_token"
  ) REFERENCES "foundry_provider_commands"(
    "id", "claim_token", "claimed_by", "fencing_token"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_output_broker_authorizations_v1"
  ADD CONSTRAINT "fdv1_broker_reservation_fk" FOREIGN KEY(
    "reservation_id", "reservation_sha256"
  ) REFERENCES "foundry_derivative_output_reservations_v1"(
    "id", "reservation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_broker_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_broker_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_broker_object_uses_v1"
  ADD CONSTRAINT "fdv1_broker_use_reservation_fk" FOREIGN KEY(
    "reservation_id", "reservation_sha256"
  ) REFERENCES "foundry_derivative_output_reservations_v1"(
    "id", "reservation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_broker_use_activation_fk" FOREIGN KEY("activation_id")
    REFERENCES "foundry_derivative_execution_activations_v1"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_broker_use_closure_fk" FOREIGN KEY("closure_id")
    REFERENCES "foundry_derivative_candidate_relational_closures_v1"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_broker_use_attempt_fk" FOREIGN KEY("attempt_id")
    REFERENCES "foundry_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_output_custodian_authorizations_v1"
  ADD CONSTRAINT "fdv1_custodian_reservation_fk" FOREIGN KEY(
    "reservation_id", "reservation_sha256"
  ) REFERENCES "foundry_derivative_output_reservations_v1"(
    "id", "reservation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custodian_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custodian_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custodian_use_fk" FOREIGN KEY("broker_object_use_id")
    REFERENCES "foundry_derivative_broker_object_uses_v1"("id") ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_execution_containment_events_v1"
  ADD CONSTRAINT "fdv1_containment_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_containment_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_containment_attempt_fk" FOREIGN KEY("attempt_id")
    REFERENCES "foundry_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE "foundry_derivative_output_custody_v1"
  ADD CONSTRAINT "fdv1_custody_activation_fk" FOREIGN KEY(
    "activation_id", "activation_sha256"
  ) REFERENCES "foundry_derivative_execution_activations_v1"(
    "id", "activation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_closure_fk" FOREIGN KEY(
    "closure_id", "closure_sha256"
  ) REFERENCES "foundry_derivative_candidate_relational_closures_v1"(
    "id", "closure_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_execution_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"("id", "execution_subject_sha256")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_attempt_fk" FOREIGN KEY("attempt_id")
    REFERENCES "foundry_attempts"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_reservation_fk" FOREIGN KEY(
    "reservation_id", "reservation_sha256"
  ) REFERENCES "foundry_derivative_output_reservations_v1"(
    "id", "reservation_sha256"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_submit_grant_fk" FOREIGN KEY("submit_grant_id")
    REFERENCES "foundry_derivative_submit_once_grants_v1"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_submit_redeem_fk" FOREIGN KEY("submit_redemption_id")
    REFERENCES "foundry_derivative_submit_once_redemptions_v1"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_invocation_fk" FOREIGN KEY("invocation_event_id")
    REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_broker_auth_fk" FOREIGN KEY("broker_authorization_id")
    REFERENCES "foundry_derivative_output_broker_authorizations_v1"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_broker_use_fk" FOREIGN KEY("broker_object_use_id")
    REFERENCES "foundry_derivative_broker_object_uses_v1"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_custodian_auth_fk" FOREIGN KEY(
    "custodian_authorization_id"
  ) REFERENCES "foundry_derivative_output_custodian_authorizations_v1"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_result_observation_fk" FOREIGN KEY(
    "result_observation_id"
  ) REFERENCES "foundry_provider_command_result_observations"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_completion_event_fk" FOREIGN KEY("completion_event_id")
    REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "fdv1_custody_result_class_fk" FOREIGN KEY(
    "result_classification_id"
  ) REFERENCES "foundry_provider_command_result_classifications"("id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "fdv1_command_one_submit_uq"
  ON "foundry_derivative_provider_command_sidecars_v1"("activation_id")
  WHERE "command_kind" = 'provider_submit';
CREATE INDEX "fdv1_activation_epoch_policy_idx"
  ON "foundry_derivative_execution_activations_v1"(
    "epoch_generation", "authority_not_after"
  );
CREATE INDEX "fdv1_activation_job_idx"
  ON "foundry_derivative_execution_activations_v1"("project_id", "job_id");
CREATE INDEX "fdv1_recovery_authority_attempt_idx"
  ON "foundry_derivative_recovery_authorities_v1"(
    "activation_id", "attempt_id", "fencing_token", "created_at"
  );
CREATE INDEX "fdv1_custody_activation_time_idx"
  ON "foundry_derivative_output_custody_v1"(
    "activation_id", "output_slot", "committed_at"
  );
CREATE INDEX "fdv1_custody_raw_sha_idx"
  ON "foundry_derivative_output_custody_v1"("raw_sha256");
CREATE INDEX "fdv1_custody_prefixed_sha_idx"
  ON "foundry_derivative_output_custody_v1"("prefixed_sha256");
CREATE INDEX "fdv1_custody_disposition_idx"
  ON "foundry_derivative_output_custody_v1"("disposition", "committed_at");
CREATE INDEX "fdv1_custody_observation_idx"
  ON "foundry_derivative_output_custody_v1"("result_observation_id");
CREATE INDEX "fdv1_custody_classification_idx"
  ON "foundry_derivative_output_custody_v1"("result_classification_id");
CREATE INDEX "fdv1_custody_lineage_idx"
  ON "foundry_derivative_output_custody_v1"("restriction_lineage_sha256");
CREATE UNIQUE INDEX "fdv1_custody_current_uq"
  ON "foundry_derivative_output_custody_v1"("activation_id", "output_slot")
  WHERE "disposition" = 'quarantined_current_authority';
CREATE INDEX "fdv1_containment_attempt_time_idx"
  ON "foundry_derivative_execution_containment_events_v1"(
    "attempt_id", "fencing_token", "recorded_at"
  );
CREATE INDEX "fdv1_security_state_idx"
  ON "foundry_derivative_quarantine_security_events_v1"(
    "severity", "state", "recorded_at"
  );

CREATE FUNCTION "fdv1_lock_root"()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('foundry-kill:0:global', 0)
  )
$$;

CREATE FUNCTION "fdv1_root_trigger"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."fdv1_lock_root"();
  RETURN NULL;
END;
$$;

CREATE FUNCTION "fdv1_lock_scopes"(
  epoch_generation_input bigint,
  activation_id_input uuid,
  execution_id_input uuid,
  attempt_id_input uuid,
  command_id_input uuid,
  output_slot_input text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."fdv1_lock_root"();
  IF epoch_generation_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:1:epoch:' || epoch_generation_input::text, 0
    ));
  END IF;
  IF activation_id_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:3:activation:' || activation_id_input::text, 0
    ));
  END IF;
  IF execution_id_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:4:execution:' || execution_id_input::text, 0
    ));
  END IF;
  IF attempt_id_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:5:attempt:' || attempt_id_input::text, 0
    ));
  END IF;
  IF command_id_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:6:command:' || command_id_input::text, 0
    ));
  END IF;
  IF activation_id_input IS NOT NULL AND output_slot_input IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'foundry-derivative:7:output:' || activation_id_input::text || ':' || output_slot_input,
      0
    ));
  END IF;
END;
$$;

CREATE FUNCTION "fdv1_disabled_evidence"()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'migration0058', 'not_installed',
    'migrationChain', 'not_installed',
    'applicationRelease', 'not_installed',
    'activationStore', 'not_installed',
    'claimer', 'not_installed',
    'submitGateway', 'not_installed',
    'recoveryGateway', 'not_installed',
    'workerRunner', 'not_installed',
    'workerImage', 'not_installed',
    'outputBroker', 'not_installed',
    'outputCustodian', 'not_installed',
    'watchdog', 'not_installed',
    'publicScanner', 'not_installed',
    'executorIam', 'not_installed',
    'brokerIam', 'not_installed',
    'custodianIam', 'not_installed',
    'quarantineIam', 'not_installed',
    'releaseIam', 'not_installed',
    'networkIsolation', 'not_installed',
    'kmsConfiguration', 'not_installed',
    'versioningConfiguration', 'not_installed',
    'retentionConfiguration', 'not_installed',
    'storageProfile', 'not_installed',
    'glbVerifier', 'not_installed',
    'livePostgresEvidence', 'not_installed',
    'concurrencyEvidence', 'not_installed',
    'adversarialEvidence', 'not_installed',
    'iamNegativeEvidence', 'not_installed',
    'spoolEvidence', 'not_installed',
    'custodyEvidence', 'not_installed',
    'reverseScanEvidence', 'not_installed',
    'publicDenialEvidence', 'not_installed',
    'independentAudit', 'not_installed'
  )
$$;

CREATE FUNCTION "fdv1_enabled_evidence_ok"(evidence_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  required_keys constant text[] := ARRAY[
    'migration0058', 'migrationChain', 'applicationRelease', 'activationStore',
    'claimer', 'submitGateway', 'recoveryGateway', 'workerRunner', 'workerImage',
    'outputBroker', 'outputCustodian', 'watchdog', 'publicScanner', 'executorIam',
    'brokerIam', 'custodianIam', 'quarantineIam', 'releaseIam', 'networkIsolation',
    'kmsConfiguration', 'versioningConfiguration', 'retentionConfiguration',
    'storageProfile', 'glbVerifier', 'livePostgresEvidence', 'concurrencyEvidence',
    'adversarialEvidence', 'iamNegativeEvidence', 'spoolEvidence', 'custodyEvidence',
    'reverseScanEvidence', 'publicDenialEvidence', 'independentAudit'
  ];
BEGIN
  RETURN jsonb_typeof(evidence_input) = 'object'
    AND public."foundry_jsonb_object_key_count"(evidence_input) = array_length(required_keys, 1)
    AND evidence_input ?& required_keys
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(required_keys) AS required_key(value)
      WHERE jsonb_typeof(evidence_input->required_key.value) IS DISTINCT FROM 'string'
         OR evidence_input->>required_key.value = 'not_installed'
         OR NOT public."fdv1_is_sha256"(evidence_input->>required_key.value)
    );
END;
$$;

CREATE FUNCTION "fdv1_guard_epoch"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior_generation bigint;
  prior_effective_at timestamptz;
  database_now timestamptz;
  expected_json jsonb;
  evidence_json jsonb;
BEGIN
  PERFORM public."fdv1_lock_root"();
  SELECT epoch."generation", epoch."effective_at"
  INTO prior_generation, prior_effective_at
  FROM public."foundry_derivative_execution_activation_epochs_v1" epoch
  ORDER BY epoch."generation" DESC
  LIMIT 1
  FOR UPDATE;

  database_now := date_trunc('milliseconds', clock_timestamp());
  IF prior_generation IS NULL THEN
    IF NEW."generation" IS DISTINCT FROM 1
       OR NEW."variant" IS DISTINCT FROM 'disabled_sentinel'
       OR NEW."disabled_reason" IS DISTINCT FROM 'bootstrap' THEN
      RAISE EXCEPTION '0058 bootstrap must insert only disabled_sentinel generation 1'
        USING ERRCODE = '23514';
    END IF;
    NEW."effective_at" := database_now;
    NEW."recorded_at" := database_now;
  ELSE
    IF NEW."generation" IS DISTINCT FROM prior_generation + 1 THEN
      RAISE EXCEPTION 'derivative activation epoch generation must be contiguous'
        USING ERRCODE = '40001';
    END IF;
    IF NEW."effective_at" <= prior_effective_at THEN
      RAISE EXCEPTION 'derivative activation epoch effective time must increase'
        USING ERRCODE = '23514';
    END IF;
    NEW."recorded_at" := database_now;
    IF NEW."effective_at" > database_now AND EXISTS (
      SELECT 1
      FROM public."foundry_derivative_execution_activations_v1" activation
      JOIN public."foundry_attempts" attempt
        ON attempt."execution_id" = activation."execution_id"
      WHERE left(attempt."state", 9) <> 'terminal_'
    ) THEN
      RAISE EXCEPTION 'future activation epoch replacement is denied while an affected attempt is live'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."variant" = 'disabled_sentinel' THEN
    IF NEW."enabled" OR NEW."disabled_reason" NOT IN ('bootstrap', 'containment') THEN
      RAISE EXCEPTION 'disabled_sentinel epoch shape is invalid' USING ERRCODE = '23514';
    END IF;
    NEW."actor_kind" := 'system';
    NEW."actor_key" := 'system:foundry-derivative-bootstrap';
    NEW."administrator_user_id" := NULL;
    evidence_json := public."fdv1_disabled_evidence"();
    expected_json := jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.derivative-execution-activation-epoch.v1',
      'generation', NEW."generation"::text,
      'variant', 'disabled_sentinel',
      'enabled', false,
      'rejectFutureGenerationWhileLive', NEW."reject_future_generation_while_live",
      'disabledReason', NEW."disabled_reason",
      'effectiveAt', public."fdv1_time_text"(NEW."effective_at"),
      'evidence', evidence_json
    );
    NEW."epoch_json" := expected_json;
    NEW."epoch_sha256" := public."foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-execution-activation-epoch.v1', expected_json
    );
  ELSIF NEW."variant" = 'enabled_release' THEN
    IF NOT NEW."enabled" OR NOT NEW."reject_future_generation_while_live"
       OR NEW."administrator_user_id" IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public."users" actor
         WHERE actor."id" = NEW."administrator_user_id"
           AND actor."platform_role" = 'admin'
       ) THEN
      RAISE EXCEPTION 'enabled_release requires strict mode and a current platform administrator'
        USING ERRCODE = '42501';
    END IF;
    IF public."foundry_jsonb_object_key_count"(NEW."epoch_json") <> 7
       OR NEW."epoch_json"->>'schemaVersion' IS DISTINCT FROM
            'omnitwin.foundry.derivative-execution-activation-epoch.v1'
       OR NEW."epoch_json"->>'generation' IS DISTINCT FROM NEW."generation"::text
       OR NEW."epoch_json"->>'variant' IS DISTINCT FROM 'enabled_release'
       OR NEW."epoch_json"->'enabled' IS DISTINCT FROM 'true'::jsonb
       OR NEW."epoch_json"->'rejectFutureGenerationWhileLive' IS DISTINCT FROM 'true'::jsonb
       OR NEW."epoch_json"->>'effectiveAt' IS DISTINCT FROM
            public."fdv1_time_text"(NEW."effective_at")
       OR NOT public."fdv1_enabled_evidence_ok"(NEW."epoch_json"->'evidence')
       OR NEW."epoch_sha256" IS DISTINCT FROM
            public."foundry_ecmascript_domain_jsonb_sha256"(
              'omnitwin.foundry.derivative-execution-activation-epoch.v1',
              NEW."epoch_json"
            ) THEN
      RAISE EXCEPTION 'enabled_release epoch evidence is not closed and exact'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported derivative activation epoch variant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_current_epoch"(database_now_input timestamptz)
RETURNS TABLE(
  generation bigint,
  variant varchar,
  effective_at timestamptz,
  enabled boolean,
  reject_future_generation_while_live boolean,
  epoch_sha256 varchar
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT epoch."generation", epoch."variant", epoch."effective_at", epoch."enabled",
         epoch."reject_future_generation_while_live", epoch."epoch_sha256"
  FROM public."foundry_derivative_execution_activation_epochs_v1" epoch
  WHERE epoch."effective_at" <= database_now_input
  ORDER BY epoch."effective_at" DESC, epoch."generation" DESC
  LIMIT 1
$$;

CREATE FUNCTION "fdv1_next_epoch_boundary"(database_now_input timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT min(epoch."effective_at")
  FROM public."foundry_derivative_execution_activation_epochs_v1" epoch
  WHERE epoch."effective_at" > database_now_input
$$;

CREATE FUNCTION "fdv1_current_derivative_generation"(
  policy_version_input text,
  database_now_input timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH latest AS MATERIALIZED (
    SELECT policy.*
    FROM public."foundry_derivative_rights_policy_versions" policy
    WHERE policy."policy_version" = policy_version_input
      AND policy."effective_at" <= database_now_input
    ORDER BY policy."effective_at" DESC, policy."generation" DESC
    LIMIT 1
  )
  SELECT latest."generation"
  FROM latest
  WHERE NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_rights_policy_revocations" revocation
      WHERE revocation."policy_version" = latest."policy_version"
        AND revocation."policy_definition_sha256" = latest."policy_definition_sha256"
        AND revocation."policy_generation" = latest."generation"
        AND revocation."revoked_at" <= database_now_input
  )
$$;

CREATE FUNCTION "fdv1_current_base_generation"(
  policy_version_input text,
  database_now_input timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH latest AS MATERIALIZED (
    SELECT policy.*
    FROM public."foundry_rights_policy_versions" policy
    WHERE policy."policy_version" = policy_version_input
      AND policy."effective_at" <= database_now_input
    ORDER BY policy."effective_at" DESC, policy."generation" DESC
    LIMIT 1
  )
  SELECT latest."generation"
  FROM latest
  WHERE (latest."revoked_at" IS NULL OR latest."revoked_at" > database_now_input)
    AND NOT EXISTS (
      SELECT 1
      FROM public."foundry_rights_policy_revocations" revocation
      WHERE revocation."policy_version" = latest."policy_version"
        AND revocation."policy_definition_sha256" = latest."policy_definition_sha256"
        AND revocation."policy_generation" = latest."generation"
        AND revocation."revoked_at" <= database_now_input
    )
$$;

CREATE FUNCTION "fdv1_next_derivative_policy_boundary"(
  policy_version_input text,
  generation_input bigint,
  database_now_input timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT min(boundary_at)
  FROM (
    SELECT policy."effective_at" AS boundary_at
    FROM public."foundry_derivative_rights_policy_versions" policy
    WHERE policy."policy_version" = policy_version_input
      AND policy."effective_at" > database_now_input
    UNION ALL
    SELECT revocation."revoked_at"
    FROM public."foundry_derivative_rights_policy_revocations" revocation
    WHERE revocation."policy_version" = policy_version_input
      AND revocation."policy_generation" = generation_input
      AND revocation."revoked_at" > database_now_input
  ) boundaries
$$;

CREATE FUNCTION "fdv1_next_base_policy_boundary"(
  policy_version_input text,
  generation_input bigint,
  database_now_input timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT min(boundary_at)
  FROM (
    SELECT policy."effective_at" AS boundary_at
    FROM public."foundry_rights_policy_versions" policy
    WHERE policy."policy_version" = policy_version_input
      AND policy."effective_at" > database_now_input
    UNION ALL
    SELECT policy."revoked_at"
    FROM public."foundry_rights_policy_versions" policy
    WHERE policy."policy_version" = policy_version_input
      AND policy."generation" = generation_input
      AND policy."revoked_at" > database_now_input
    UNION ALL
    SELECT revocation."revoked_at"
    FROM public."foundry_rights_policy_revocations" revocation
    WHERE revocation."policy_version" = policy_version_input
      AND revocation."policy_generation" = generation_input
      AND revocation."revoked_at" > database_now_input
  ) boundaries
$$;

CREATE FUNCTION "fdv1_assert_enabled"(phase_input text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  database_now timestamptz;
  selected_epoch record;
BEGIN
  PERFORM public."fdv1_lock_root"();
  database_now := date_trunc('milliseconds', clock_timestamp());
  SELECT * INTO selected_epoch FROM public."fdv1_current_epoch"(database_now);
  IF NOT FOUND
     OR selected_epoch.variant IS DISTINCT FROM 'enabled_release'
     OR selected_epoch.enabled IS DISTINCT FROM true
     OR selected_epoch.reject_future_generation_while_live IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'derivative phase % is denied by the latest effective disabled epoch', phase_input
      USING ERRCODE = '55000';
  END IF;
  RETURN database_now;
END;
$$;

CREATE OR REPLACE FUNCTION "foundry_classify_normalize_mesh_glb_v0_job_spec"(
  job_spec_input jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  has_relevant_stage boolean := false;
  stage_value jsonb;
BEGIN
  IF jsonb_typeof(job_spec_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(job_spec_input->'stages') IS DISTINCT FROM 'array' THEN
    RETURN 'malformed_job_spec';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(job_spec_input->'stages') stage(value)
    WHERE jsonb_typeof(stage.value) = 'object'
      AND (
        stage.value->>'kind' IS NOT DISTINCT FROM 'geometry'
        OR stage.value->'command' IS NOT DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
        OR (jsonb_typeof(stage.value->'command') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(stage.value->'command') argument(value)
          WHERE jsonb_typeof(argument.value) = 'string'
            AND lower(argument.value #>> '{}') ~ 'normalize[_-]mesh[_-]glb'
        ))
      )
  ) INTO has_relevant_stage;

  IF public."foundry_jsonb_object_key_count"(job_spec_input) <> 16
     OR NOT (job_spec_input ?& ARRAY[
       'schemaVersion', 'id', 'projectId', 'ingestManifestSha256',
       'executionIntent', 'providerKind', 'providerAdapterId', 'stages',
       'objectStorageProfile', 'sourceMountMode', 'outputPrefix',
       'estimatedCostUsd', 'budgetCapUsd', 'killSwitchEnabled',
       'computeApprovalId', 'createdAt'
     ])
     OR public."foundry_is_job_stage_array"(job_spec_input->'stages') IS NOT TRUE THEN
    RETURN CASE WHEN has_relevant_stage
      THEN 'normalize_mesh_glb_relevant_variant' ELSE 'malformed_job_spec' END;
  END IF;

  IF NOT has_relevant_stage THEN
    RETURN 'unrelated';
  END IF;
  IF jsonb_array_length(job_spec_input->'stages') <> 1 THEN
    RETURN 'normalize_mesh_glb_relevant_variant';
  END IF;

  stage_value := job_spec_input->'stages'->0;
  IF stage_value->>'kind' IS DISTINCT FROM 'geometry'
     OR stage_value->'command' IS DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
     OR stage_value->'dependsOn' IS DISTINCT FROM '[]'::jsonb
     OR jsonb_array_length(stage_value->'inputAssetIds') <> 1
     OR stage_value->'outputNames' IS DISTINCT FROM '["normalized.glb"]'::jsonb
     OR stage_value->'rightsPurposes' IS DISTINCT FROM
          '["commercial_internal_use"]'::jsonb
     OR stage_value->>'networkAccess' IS DISTINCT FROM 'none'
     OR stage_value->>'checkpoint' IS DISTINCT FROM 'none'
     OR stage_value->'resumable' IS DISTINCT FROM 'false'::jsonb
     OR job_spec_input->>'executionIntent' IS DISTINCT FROM 'execute'
     OR job_spec_input->>'sourceMountMode' IS DISTINCT FROM 'read_only'
     OR jsonb_typeof(job_spec_input->'objectStorageProfile') IS DISTINCT FROM 'string'
     OR NOT public."fdv1_is_key"(job_spec_input->>'objectStorageProfile')
     OR jsonb_typeof(job_spec_input->'outputPrefix') IS DISTINCT FROM 'string'
     OR public."foundry_is_safe_relative_path"(job_spec_input->>'outputPrefix') IS NOT TRUE THEN
    RETURN 'normalize_mesh_glb_relevant_variant';
  END IF;
  RETURN 'normalize_mesh_glb_v0_exact';
END;
$$;

CREATE OR REPLACE FUNCTION "assert_foundry_legacy_v0_derivative_execution_denied"(
  job_id_input varchar,
  project_id_input varchar,
  boundary_input text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  immutable_job_spec jsonb;
  job_classification text;
  has_deterministic_transformation boolean;
  database_now timestamptz;
BEGIN
  SELECT job."job_spec_json" INTO immutable_job_spec
  FROM public."foundry_jobs" job
  WHERE job."job_id" = job_id_input AND job."project_id" = project_id_input;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy derivative execution barrier cannot resolve the immutable job'
      USING ERRCODE = '23503';
  END IF;
  job_classification :=
    public."foundry_classify_normalize_mesh_glb_v0_job_spec"(immutable_job_spec);
  SELECT EXISTS (
    SELECT 1 FROM public."foundry_job_worker_profiles" worker_binding
    WHERE worker_binding."job_id" = job_id_input
      AND worker_binding."project_id" = project_id_input
      AND worker_binding."operation_class" = 'deterministic_transformation'
  ) INTO has_deterministic_transformation;
  IF has_deterministic_transformation
     AND job_classification IS NOT DISTINCT FROM 'unrelated' THEN
    job_classification := 'legacy_deterministic_transformation';
  END IF;
  IF job_classification IS DISTINCT FROM 'unrelated' THEN
    IF job_classification IS DISTINCT FROM 'normalize_mesh_glb_v0_exact' THEN
      RAISE EXCEPTION 'normalize_mesh_glb derivative variant cannot cross boundary %', boundary_input
        USING ERRCODE = '23514';
    END IF;
    database_now := public."fdv1_assert_enabled"(boundary_input);
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_execution_activations_v1" activation
      JOIN public."foundry_derivative_candidate_relational_closures_v1" closure
        ON closure."id" = activation."closure_id"
       AND closure."closure_sha256" = activation."closure_sha256"
      WHERE activation."project_id" = project_id_input
        AND activation."job_id" = job_id_input
        AND activation."authority_not_after" > database_now
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_derivative_execution_activation_revocations_v1" revocation
          WHERE revocation."activation_id" = activation."id"
        )
    ) THEN
      RAISE EXCEPTION 'exact derivative job lacks a current closed activation chain at %', boundary_input
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION "fdv1_job_classification"(
  job_id_input varchar,
  project_id_input varchar
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_spec_value jsonb;
  classification_value text;
BEGIN
  SELECT job."job_spec_json" INTO job_spec_value
  FROM public."foundry_jobs" job
  WHERE job."job_id" = job_id_input AND job."project_id" = project_id_input;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fdv1 cannot resolve immutable job' USING ERRCODE = '23503';
  END IF;
  classification_value :=
    public."foundry_classify_normalize_mesh_glb_v0_job_spec"(job_spec_value);
  IF classification_value = 'unrelated' AND EXISTS (
    SELECT 1 FROM public."foundry_job_worker_profiles" binding
    WHERE binding."job_id" = job_id_input
      AND binding."project_id" = project_id_input
      AND binding."operation_class" = 'deterministic_transformation'
  ) THEN
    RETURN 'legacy_deterministic_transformation';
  END IF;
  RETURN classification_value;
END;
$$;

CREATE FUNCTION "fdv1_assert_recovery_boundary"(
  job_id_input varchar,
  project_id_input varchar,
  execution_id_input uuid,
  attempt_id_input uuid,
  fencing_token_input bigint,
  command_kind_input text,
  boundary_input text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
  database_now timestamptz;
BEGIN
  classification_value := public."fdv1_job_classification"(
    job_id_input, project_id_input
  );
  IF classification_value = 'unrelated' THEN
    RETURN;
  END IF;
  IF classification_value <> 'normalize_mesh_glb_v0_exact' THEN
    RAISE EXCEPTION 'derivative variant cannot cross recovery boundary %', boundary_input
      USING ERRCODE = '23514';
  END IF;
  IF command_kind_input NOT IN ('provider_poll', 'provider_reconcile', 'provider_stop') THEN
    RAISE EXCEPTION 'derivative recovery is structurally submit/checkpoint incapable'
      USING ERRCODE = '23514';
  END IF;
  PERFORM public."fdv1_lock_scopes"(
    NULL, NULL, execution_id_input, attempt_id_input, NULL, NULL
  );
  database_now := date_trunc('milliseconds', clock_timestamp());
  IF NOT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_recovery_authorities_v1" recovery
    WHERE recovery."execution_id" = execution_id_input
      AND recovery."attempt_id" = attempt_id_input
      AND recovery."fencing_token" = fencing_token_input
      AND recovery."retention_not_after" > database_now
      AND recovery."allowed_kinds_json" @> jsonb_build_array(command_kind_input)
      AND (
        recovery."historical_source_kind" = 'submit_redemption'
        OR command_kind_input = 'provider_stop'
      )
  ) THEN
    RAISE EXCEPTION 'exact derivative recovery lacks its immutable historical source at %',
      boundary_input USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_execution_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  classification_value := public."fdv1_job_classification"(NEW."job_id", NEW."project_id");
  PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
    NEW."job_id", NEW."project_id", 'execution_insert'
  );
  IF classification_value = 'normalize_mesh_glb_v0_exact' AND NOT EXISTS (
    SELECT 1 FROM public."foundry_derivative_execution_activations_v1" activation
    WHERE activation."execution_id" = NEW."id"
      AND activation."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND activation."project_id" = NEW."project_id"
      AND activation."job_id" = NEW."job_id"
      AND activation."execution_envelope_sha256" = NEW."execution_envelope_sha256"
  ) THEN
    RAISE EXCEPTION 'exact derivative execution does not equal its activation projection'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_attempt_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  classification_value := public."fdv1_job_classification"(NEW."job_id", NEW."project_id");
  PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
    NEW."job_id", NEW."project_id", 'attempt_insert'
  );
  IF classification_value = 'normalize_mesh_glb_v0_exact' AND (
    NEW."attempt_ordinal" <> 1 OR NOT EXISTS (
      SELECT 1 FROM public."foundry_derivative_execution_activations_v1" activation
      WHERE activation."execution_id" = NEW."execution_id"
        AND activation."execution_subject_sha256" = NEW."execution_subject_sha256"
        AND activation."project_id" = NEW."project_id"
        AND activation."job_id" = NEW."job_id"
    )
  ) THEN
    RAISE EXCEPTION 'exact derivative attempt is not the single activated attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_prepared_request_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  classification_value := public."fdv1_job_classification"(NEW."job_id", NEW."project_id");
  IF classification_value <> 'unrelated' AND NEW."command_kind" = 'provider_checkpoint' THEN
    RAISE EXCEPTION 'checkpoints are structurally forbidden for derivative V1'
      USING ERRCODE = '23514';
  ELSIF NEW."command_kind" = 'provider_submit' THEN
    PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
      NEW."job_id", NEW."project_id", 'activation_prepared_request_insert'
    );
  ELSIF NEW."command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop') THEN
    PERFORM public."fdv1_assert_recovery_boundary"(
      NEW."job_id", NEW."project_id", NEW."execution_id", NEW."attempt_id",
      NEW."fencing_token", NEW."command_kind", 'recovery_prepared_request_insert'
    );
  ELSIF classification_value <> 'unrelated' THEN
    RAISE EXCEPTION 'unsupported derivative prepared command kind'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_provider_command_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  classification_value := public."fdv1_job_classification"(NEW."job_id", NEW."project_id");
  IF classification_value <> 'unrelated' AND NEW."command_kind" = 'provider_checkpoint' THEN
    RAISE EXCEPTION 'checkpoints are structurally forbidden for derivative V1'
      USING ERRCODE = '23514';
  ELSIF NEW."command_kind" = 'provider_submit' THEN
    PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
      NEW."job_id", NEW."project_id", 'activation_provider_command_insert'
    );
  ELSIF NEW."command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop') THEN
    PERFORM public."fdv1_assert_recovery_boundary"(
      NEW."job_id", NEW."project_id", NEW."execution_id", NEW."attempt_id",
      NEW."fencing_token", NEW."command_kind", 'recovery_provider_command_insert'
    );
  ELSIF classification_value <> 'unrelated' THEN
    RAISE EXCEPTION 'unsupported derivative provider command kind'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_provider_command_claim"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  IF OLD."state" = 'pending' AND NEW."state" = 'claimed' THEN
    classification_value := public."fdv1_job_classification"(OLD."job_id", OLD."project_id");
    IF classification_value <> 'unrelated' AND OLD."command_kind" = 'provider_checkpoint' THEN
      RAISE EXCEPTION 'checkpoints are structurally forbidden for derivative V1'
        USING ERRCODE = '23514';
    ELSIF OLD."command_kind" = 'provider_submit' THEN
      PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
        OLD."job_id", OLD."project_id", 'activation_provider_command_claim'
      );
    ELSIF OLD."command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop') THEN
      PERFORM public."fdv1_assert_recovery_boundary"(
        OLD."job_id", OLD."project_id", OLD."execution_id", OLD."attempt_id",
        OLD."fencing_token", OLD."command_kind", 'recovery_provider_command_claim'
      );
    ELSIF classification_value <> 'unrelated' THEN
      RAISE EXCEPTION 'unsupported derivative provider command claim'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_foundry_derivative_v0_provider_invocation_event_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  classification_value text;
BEGIN
  IF NEW."event_kind" = 'provider_invocation_started' THEN
    classification_value := public."fdv1_job_classification"(NEW."job_id", NEW."project_id");
    IF classification_value <> 'unrelated'
       AND NEW."provider_command_kind" = 'provider_checkpoint' THEN
      RAISE EXCEPTION 'checkpoints are structurally forbidden for derivative V1'
        USING ERRCODE = '23514';
    ELSIF NEW."provider_command_kind" = 'provider_submit' THEN
      PERFORM public."assert_foundry_legacy_v0_derivative_execution_denied"(
        NEW."job_id", NEW."project_id", 'activation_provider_invocation_started'
      );
    ELSIF NEW."provider_command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop') THEN
      PERFORM public."fdv1_assert_recovery_boundary"(
        NEW."job_id", NEW."project_id", NEW."execution_id", NEW."attempt_id",
        NEW."fencing_token", NEW."provider_command_kind",
        'recovery_provider_invocation_started'
      );
    ELSIF classification_value <> 'unrelated' THEN
      RAISE EXCEPTION 'unsupported derivative invocation event kind'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Canonical evidence is derived from the complete relational row rather than
-- accepted as a second, independently caller-controlled story.  Column names
-- are mapped to lower camel case, DB instants use the canonical millisecond-Z
-- form, and every SQL numeric leaf is encoded as decimal text so JavaScript
-- cannot round bigint-like identities.
CREATE FUNCTION "fdv1_camel_key"(key_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  parts text[] := string_to_array(key_input, '_');
  result_value text := parts[1];
  part_index integer;
BEGIN
  IF array_length(parts, 1) > 1 THEN
    FOR part_index IN 2..array_length(parts, 1) LOOP
      result_value := result_value || upper(left(parts[part_index], 1))
        || substr(parts[part_index], 2);
    END LOOP;
  END IF;
  RETURN result_value;
END;
$$;

CREATE FUNCTION "fdv1_closed_row_json"(
  row_input jsonb,
  json_column_input text,
  sha_column_input text,
  domain_tag_input text
)
RETURNS jsonb
LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object('schemaVersion', domain_tag_input) || COALESCE(
    jsonb_object_agg(
      public."fdv1_camel_key"(entry.key),
      CASE
        WHEN entry.value = 'null'::jsonb THEN 'null'::jsonb
        WHEN entry.key ~ '(?:_at|_from|_until|_not_after)$'
          THEN to_jsonb(public."fdv1_time_text"((entry.value #>> '{}')::timestamptz))
        WHEN jsonb_typeof(entry.value) = 'number'
          THEN to_jsonb(entry.value #>> '{}')
        ELSE entry.value
      END
      ORDER BY entry.key COLLATE "C"
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(row_input) entry
  WHERE entry.key NOT IN (json_column_input, sha_column_input)
$$;

CREATE FUNCTION "fdv1_guard_canonical_sha"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value jsonb := to_jsonb(NEW);
  json_column text;
  sha_column text;
  domain_tag text;
  expected_value jsonb;
  expected_sha text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'foundry_derivative_candidate_relational_closures_v1' THEN
      json_column := 'closure_json'; sha_column := 'closure_sha256';
      domain_tag := 'omnitwin.foundry.derivative-candidate-relational-closure.v1';
    WHEN 'foundry_derivative_quarantine_storage_profiles_v1' THEN
      json_column := 'profile_json'; sha_column := 'profile_sha256';
      domain_tag := 'omnitwin.foundry.derivative-quarantine-storage-profile.v1';
    WHEN 'foundry_derivative_quarantine_storage_profile_revocations_v1' THEN
      json_column := 'revocation_json'; sha_column := 'revocation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-quarantine-storage-profile-revocation.v1';
    WHEN 'foundry_derivative_executor_authorizations_v1' THEN
      json_column := 'authorization_json'; sha_column := 'authorization_sha256';
      domain_tag := 'omnitwin.foundry.derivative-executor-authorization.v1';
    WHEN 'foundry_derivative_executor_authorization_revocations_v1' THEN
      json_column := 'revocation_json'; sha_column := 'revocation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-executor-authorization-revocation.v1';
    WHEN 'foundry_derivative_output_broker_authorizations_v1' THEN
      json_column := 'authorization_json'; sha_column := 'authorization_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-broker-authorization.v1';
    WHEN 'foundry_derivative_output_broker_authorization_revocations_v1' THEN
      json_column := 'revocation_json'; sha_column := 'revocation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-broker-authorization-revocation.v1';
    WHEN 'foundry_derivative_output_custodian_authorizations_v1' THEN
      json_column := 'authorization_json'; sha_column := 'authorization_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-custodian-authorization.v1';
    WHEN 'foundry_derivative_custodian_auth_revocations_v1' THEN
      json_column := 'revocation_json'; sha_column := 'revocation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-custodian-authorization-revocation.v1';
    WHEN 'foundry_derivative_execution_activations_v1' THEN
      json_column := 'activation_json'; sha_column := 'activation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-execution-activation.v1';
    WHEN 'foundry_derivative_execution_activation_revocations_v1' THEN
      json_column := 'revocation_json'; sha_column := 'revocation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-execution-activation-revocation.v1';
    WHEN 'foundry_derivative_prepared_request_sidecars_v1' THEN
      json_column := 'sidecar_json'; sha_column := 'sidecar_sha256';
      domain_tag := 'omnitwin.foundry.derivative-prepared-request-sidecar.v1';
    WHEN 'foundry_derivative_provider_command_sidecars_v1' THEN
      json_column := 'sidecar_json'; sha_column := 'sidecar_sha256';
      domain_tag := 'omnitwin.foundry.derivative-provider-command-sidecar.v1';
    WHEN 'foundry_derivative_output_reservations_v1' THEN
      json_column := 'reservation_json'; sha_column := 'reservation_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-reservation.v1';
    WHEN 'foundry_derivative_submit_once_grants_v1' THEN
      json_column := 'receipt_json'; sha_column := 'grant_sha256';
      domain_tag := 'omnitwin.foundry.derivative-submit-once-grant.v1';
    WHEN 'foundry_derivative_submit_once_redemptions_v1' THEN
      json_column := 'receipt_json'; sha_column := 'redemption_sha256';
      domain_tag := 'omnitwin.foundry.derivative-submit-once-redemption.v1';
    WHEN 'foundry_derivative_recovery_authorities_v1' THEN
      json_column := 'authority_json'; sha_column := 'authority_sha256';
      domain_tag := 'omnitwin.foundry.derivative-recovery-authority.v1';
    WHEN 'foundry_derivative_recovery_call_grants_v1' THEN
      json_column := 'receipt_json'; sha_column := 'grant_sha256';
      domain_tag := 'omnitwin.foundry.derivative-recovery-call-grant.v1';
    WHEN 'foundry_derivative_recovery_call_redemptions_v1' THEN
      json_column := 'receipt_json'; sha_column := 'redemption_sha256';
      domain_tag := 'omnitwin.foundry.derivative-recovery-call-redemption.v1';
    WHEN 'foundry_derivative_broker_object_uses_v1' THEN
      json_column := 'use_json'; sha_column := 'use_sha256';
      domain_tag := 'omnitwin.foundry.derivative-broker-object-use.v1';
    WHEN 'foundry_derivative_execution_containment_events_v1' THEN
      json_column := 'containment_json'; sha_column := 'containment_sha256';
      domain_tag := 'omnitwin.foundry.derivative-execution-containment-event.v1';
    WHEN 'foundry_derivative_output_custody_v1' THEN
      json_column := 'custody_json'; sha_column := 'custody_sha256';
      domain_tag := 'omnitwin.foundry.derivative-output-custody.v1';
    WHEN 'foundry_derivative_quarantine_security_events_v1' THEN
      json_column := 'event_json'; sha_column := 'event_sha256';
      domain_tag := 'omnitwin.foundry.derivative-quarantine-security-event.v1';
    ELSE
      RAISE EXCEPTION 'unmapped fdv1 canonical row %', TG_TABLE_NAME
        USING ERRCODE = '23514';
  END CASE;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(row_value) entry
    WHERE entry.key ~ '(?:_at|_from|_until|_not_after)$'
      AND entry.value <> 'null'::jsonb
      AND (entry.value #>> '{}')::timestamptz IS DISTINCT FROM
        date_trunc('milliseconds', (entry.value #>> '{}')::timestamptz)
  ) THEN
    RAISE EXCEPTION 'fdv1 relational instants must have millisecond precision for %',
      TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  expected_value := public."fdv1_closed_row_json"(
    row_value, json_column, sha_column, domain_tag
  );
  expected_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
    domain_tag, expected_value
  );
  -- The row guard owns these two derived leaves.  Overwriting prevents a
  -- caller from choosing either an incomplete schema or a parallel digest.
  NEW := jsonb_populate_record(
    NEW,
    jsonb_build_object(json_column, expected_value, sha_column, expected_sha)
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_guard_closure"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate_row public."foundry_derivative_execution_authorization_candidates_v1"%ROWTYPE;
  job_row public."foundry_jobs"%ROWTYPE;
  worker_row public."foundry_trusted_worker_profiles"%ROWTYPE;
  stage_value jsonb;
  database_now timestamptz;
BEGIN
  PERFORM public."fdv1_lock_root"();
  SELECT * INTO candidate_row
  FROM public."foundry_derivative_execution_authorization_candidates_v1"
  WHERE "id" = NEW."candidate_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate closure cannot resolve candidate' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO job_row
  FROM public."foundry_jobs"
  WHERE "job_id" = candidate_row."job_id" AND "project_id" = candidate_row."project_id"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate closure cannot resolve immutable job' USING ERRCODE = '23503';
  END IF;
  SELECT worker.* INTO worker_row
  FROM public."foundry_job_worker_profiles" binding
  JOIN public."foundry_trusted_worker_profiles" worker
    ON worker."worker_profile_sha256" = binding."worker_profile_sha256"
   AND worker."operation_class" = binding."operation_class"
  WHERE binding."job_id" = job_row."job_id" AND binding."stage_id" = NEW."stage_id"
  FOR KEY SHARE OF worker;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate closure cannot resolve exact worker' USING ERRCODE = '23503';
  END IF;
  database_now := date_trunc('milliseconds', clock_timestamp());
  stage_value := job_row."job_spec_json"->'stages'->0;
  IF public."foundry_classify_normalize_mesh_glb_v0_job_spec"(job_row."job_spec_json")
       IS DISTINCT FROM 'normalize_mesh_glb_v0_exact'
     OR candidate_row."candidate_sha256" IS DISTINCT FROM NEW."candidate_sha256"
     OR candidate_row."reservation_id" IS DISTINCT FROM NEW."candidate_reservation_id"
     OR candidate_row."project_id" IS DISTINCT FROM NEW."project_id"
     OR candidate_row."job_id" IS DISTINCT FROM NEW."job_id"
     OR candidate_row."job_spec_sha256" IS DISTINCT FROM NEW."job_spec_sha256"
     OR candidate_row."execution_envelope_sha256" IS DISTINCT FROM NEW."execution_envelope_sha256"
     OR candidate_row."ingest_manifest_sha256" IS DISTINCT FROM NEW."ingest_manifest_sha256"
     OR stage_value->>'id' IS DISTINCT FROM NEW."stage_id"
     OR stage_value->'inputAssetIds' IS DISTINCT FROM jsonb_build_array(NEW."source_asset_id")
     OR stage_value->>'containerImage' IS DISTINCT FROM NEW."container_image_digest"
     OR job_row."job_spec_json"->>'objectStorageProfile' IS DISTINCT FROM NEW."storage_profile_id"
     OR job_row."job_spec_json"->>'outputPrefix' IS DISTINCT FROM NEW."output_prefix"
     OR candidate_row."base_execution_subject_json"->>'maximumAttempts' IS DISTINCT FROM '1'
     OR jsonb_typeof(candidate_row."base_execution_subject_json"->'checkpointContract')
          IS DISTINCT FROM 'null'
     OR worker_row."profile_id" IS DISTINCT FROM NEW."worker_profile_id"
     OR worker_row."worker_profile_sha256" IS DISTINCT FROM NEW."worker_profile_sha256"
     OR worker_row."container_image" IS DISTINCT FROM NEW."container_image_digest"
     OR worker_row."network_access" IS DISTINCT FROM 'none'
     OR worker_row."expires_at" <= database_now THEN
    RAISE EXCEPTION 'candidate closure duplicated leaves do not match the immutable exact subject'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_rights_approvals" derivative_approval
    JOIN public."foundry_derivative_rights_registry_attestations_v1" attestation
      ON attestation."id" = candidate_row."attestation_id"
     AND attestation."registry_attestation_sha256" =
       candidate_row."registry_attestation_sha256"
     AND attestation."approval_id" = derivative_approval."approval_id"
     AND attestation."derivative_rights_approval_sha256" =
       derivative_approval."derivative_rights_approval_sha256"
    JOIN public."foundry_rights_approvals" base_approval
      ON base_approval."job_id" = candidate_row."job_id"
     AND base_approval."project_id" = candidate_row."project_id"
     AND base_approval."execution_envelope_sha256" =
       candidate_row."execution_envelope_sha256"
     AND base_approval."job_spec_sha256" = candidate_row."job_spec_sha256"
     AND base_approval."rights_approval_sha256" =
       candidate_row."base_execution_subject_json"->>'rightsApprovalSha256'
     AND base_approval."policy_definition_sha256" =
       candidate_row."base_execution_subject_json"->>'rightsPolicyDefinitionSha256'
    WHERE derivative_approval."approval_id" = candidate_row."approval_id"
      AND derivative_approval."derivative_rights_approval_sha256" =
        candidate_row."derivative_rights_approval_sha256"
      AND attestation."policy_version" = derivative_approval."policy_version"
      AND attestation."policy_definition_sha256" =
        derivative_approval."policy_definition_sha256"
      AND attestation."policy_generation" = derivative_approval."policy_generation"
      AND derivative_approval."expires_at" > database_now
      AND attestation."approval_expires_at" > database_now
      AND derivative_approval."policy_generation" =
        public."fdv1_current_derivative_generation"(
          derivative_approval."policy_version", database_now
        )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_rights_registry_attestation_revocations_v1" revoked
        WHERE revoked."attestation_id" = attestation."id"
          AND revoked."revoked_at" <= database_now
      )
      AND base_approval."expires_at" > database_now
      AND public."foundry_rights_policy_is_active"(
        base_approval."policy_version",
        base_approval."policy_definition_sha256",
        base_approval."policy_generation",
        database_now
      ) IS TRUE
  ) THEN
    RAISE EXCEPTION 'candidate closure requires current exact derivative and base rights'
      USING ERRCODE = '23514';
  END IF;
  NEW."recorded_at" := database_now;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_assert_common_leaves"(
  expected_input jsonb,
  actual_input jsonb,
  context_input text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  key_value text;
BEGIN
  FOR key_value IN
    SELECT expected_key
    FROM jsonb_object_keys(expected_input) expected_key
    WHERE actual_input ? expected_key
      AND expected_key <> ALL (ARRAY[
        'id', 'recorded_at', 'created_at', 'updated_at', 'registered_at',
        'activated_at', 'reserved_at', 'issued_at', 'redeemed_at',
        'authorized_at', 'committed_at', 'valid_from', 'expires_at',
        'authority_not_after', 'retention_not_after', 'put_not_after',
        'actor_kind', 'actor_key', 'actor_user_id', 'administrator_user_id',
        'idempotency_key', 'correlation_id', 'request_digest', 'state',
        'closure_json', 'profile_json', 'authorization_json', 'revocation_json',
        'activation_json', 'sidecar_json', 'reservation_json', 'receipt_json',
        'authority_json', 'use_json', 'containment_json', 'custody_json',
        'event_json'
      ])
  LOOP
    IF expected_input->key_value IS DISTINCT FROM actual_input->key_value THEN
      RAISE EXCEPTION 'fdv1 % duplicated leaf % does not match its locked source',
        context_input, key_value USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION "fdv1_guard_phase_insert"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value jsonb := to_jsonb(NEW);
  activation_id_value uuid;
  execution_id_value uuid;
  attempt_id_value uuid;
  command_id_value uuid;
  database_now timestamptz;
  expected_value jsonb;
  closure_id_value uuid;
  reservation_id_value uuid;
  prepared_id_value uuid;
  grant_id_value uuid;
  recovery_authority_id_value uuid;
  broker_use_id_value uuid;
  redemption_recorded_at timestamptz;
BEGIN
  activation_id_value := NULLIF(row_value->>'activation_id', '')::uuid;
  execution_id_value := NULLIF(row_value->>'execution_id', '')::uuid;
  attempt_id_value := NULLIF(row_value->>'attempt_id', '')::uuid;
  command_id_value := NULLIF(row_value->>'provider_command_id', '')::uuid;
  PERFORM public."fdv1_lock_scopes"(
    NULL, activation_id_value, execution_id_value, attempt_id_value,
    command_id_value, row_value->>'output_slot'
  );
  database_now := date_trunc('milliseconds', clock_timestamp());

  -- Every duplicated relational leaf is compared after resolving and locking
  -- the smallest referencable source identity.  These checks are deliberately
  -- generic over the phase rows so a later column cannot silently become an
  -- unchecked parallel authority leaf.
  IF row_value ? 'closure_id' THEN
    closure_id_value := NULLIF(row_value->>'closure_id', '')::uuid;
    SELECT to_jsonb(source) || jsonb_build_object('closure_id', source."id")
    INTO expected_value
    FROM public."foundry_derivative_candidate_relational_closures_v1" source
    WHERE source."id" = closure_id_value
      AND source."closure_sha256" = row_value->>'closure_sha256'
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact closure' USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':closure'
    );
  END IF;

  IF row_value ? 'activation_id'
     AND TG_TABLE_NAME <> 'foundry_derivative_execution_activations_v1' THEN
    SELECT to_jsonb(source) || jsonb_build_object('activation_id', source."id")
    INTO expected_value
    FROM public."foundry_derivative_execution_activations_v1" source
    WHERE source."id" = activation_id_value
      AND (NOT (row_value ? 'activation_sha256')
        OR source."activation_sha256" = row_value->>'activation_sha256')
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact activation' USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':activation'
    );
  END IF;

  IF execution_id_value IS NOT NULL
     AND TG_TABLE_NAME <> 'foundry_derivative_execution_activations_v1' THEN
    SELECT to_jsonb(source) || jsonb_build_object('execution_id', source."id")
    INTO expected_value FROM public."foundry_executions" source
    WHERE source."id" = execution_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact execution' USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':execution'
    );
  END IF;

  IF attempt_id_value IS NOT NULL THEN
    SELECT to_jsonb(source) || jsonb_build_object('attempt_id', source."id")
    INTO expected_value FROM public."foundry_attempts" source
    WHERE source."id" = attempt_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact attempt' USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':attempt'
    );
  END IF;

  IF command_id_value IS NOT NULL THEN
    SELECT to_jsonb(source) || jsonb_build_object('provider_command_id', source."id")
    INTO expected_value FROM public."foundry_provider_commands" source
    WHERE source."id" = command_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact provider command'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':command'
    );
  END IF;

  IF row_value ? 'prepared_request_id' THEN
    prepared_id_value := NULLIF(row_value->>'prepared_request_id', '')::uuid;
    SELECT to_jsonb(source) || jsonb_build_object('prepared_request_id', source."id")
    INTO expected_value FROM public."foundry_prepared_provider_requests" source
    WHERE source."id" = prepared_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact prepared request'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':prepared'
    );
  END IF;

  IF row_value ? 'reservation_id' THEN
    reservation_id_value := NULLIF(row_value->>'reservation_id', '')::uuid;
    SELECT to_jsonb(source) || jsonb_build_object('reservation_id', source."id")
    INTO expected_value
    FROM public."foundry_derivative_output_reservations_v1" source
    WHERE source."id" = reservation_id_value
      AND (NOT (row_value ? 'reservation_sha256')
        OR source."reservation_sha256" = row_value->>'reservation_sha256')
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact output reservation'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':reservation'
    );
  END IF;

  IF row_value ? 'grant_id' THEN
    grant_id_value := NULLIF(row_value->>'grant_id', '')::uuid;
    IF TG_TABLE_NAME = 'foundry_derivative_submit_once_redemptions_v1' THEN
      SELECT to_jsonb(source) || jsonb_build_object('grant_id', source."id")
      INTO expected_value FROM public."foundry_derivative_submit_once_grants_v1" source
      WHERE source."id" = grant_id_value FOR KEY SHARE;
    ELSE
      SELECT to_jsonb(source) || jsonb_build_object('grant_id', source."id")
      INTO expected_value FROM public."foundry_derivative_recovery_call_grants_v1" source
      WHERE source."id" = grant_id_value FOR KEY SHARE;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact one-use grant'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':grant'
    );
  END IF;

  IF row_value ? 'recovery_authority_id' THEN
    recovery_authority_id_value := NULLIF(row_value->>'recovery_authority_id', '')::uuid;
    SELECT to_jsonb(source) || jsonb_build_object('recovery_authority_id', source."id")
    INTO expected_value FROM public."foundry_derivative_recovery_authorities_v1" source
    WHERE source."id" = recovery_authority_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact recovery authority'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':recovery-authority'
    );
  END IF;

  IF row_value ? 'broker_object_use_id' THEN
    broker_use_id_value := NULLIF(row_value->>'broker_object_use_id', '')::uuid;
    SELECT to_jsonb(source) || jsonb_build_object('broker_object_use_id', source."id")
    INTO expected_value FROM public."foundry_derivative_broker_object_uses_v1" source
    WHERE source."id" = broker_use_id_value FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fdv1 phase cannot resolve exact broker object use'
        USING ERRCODE = '23503';
    END IF;
    PERFORM public."fdv1_assert_common_leaves"(
      expected_value, row_value, TG_TABLE_NAME || ':broker-use'
    );
  END IF;

  IF TG_TABLE_NAME IN (
       'foundry_derivative_execution_activations_v1',
       'foundry_derivative_output_reservations_v1',
       'foundry_derivative_submit_once_grants_v1',
       'foundry_derivative_submit_once_redemptions_v1'
     ) OR (
       TG_TABLE_NAME IN (
         'foundry_derivative_prepared_request_sidecars_v1',
         'foundry_derivative_provider_command_sidecars_v1'
       ) AND row_value->>'command_kind' = 'provider_submit'
     ) THEN
    PERFORM public."fdv1_assert_enabled"(TG_TABLE_NAME);
  END IF;

  IF TG_TABLE_NAME IN (
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1'
  ) THEN
    NEW."recorded_at" := database_now;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_output_reservations_v1' THEN
    NEW."reserved_at" := database_now;
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_execution_activations_v1" activation
      JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
        ON profile."profile_id" = NEW."storage_profile_id"
       AND profile."profile_version" = NEW."storage_profile_version"
       AND profile."profile_sha256" = NEW."storage_profile_sha256"
      WHERE activation."id" = NEW."activation_id"
        AND activation."activation_sha256" = NEW."activation_sha256"
        AND activation."closure_id" = NEW."closure_id"
        AND activation."closure_sha256" = NEW."closure_sha256"
        AND activation."execution_id" = NEW."execution_id"
        AND activation."execution_subject_sha256" = NEW."execution_subject_sha256"
        AND profile."bucket" = NEW."bucket"
        AND NEW."output_prefix" LIKE rtrim(profile."root_prefix", '/') || '/%'
        AND NEW."expected_broker_policy_sha256" = profile."broker_policy_sha256"
        AND NEW."expected_custodian_policy_sha256" = profile."custodian_policy_sha256"
        AND NEW."authority_not_after" = LEAST(
          activation."authority_not_after", profile."expires_at", NEW."expires_at"
        )
        AND NEW."authority_not_after" > database_now
        AND profile."valid_from" <= database_now
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
          WHERE revoked."profile_id" = profile."profile_id"
            AND revoked."profile_version" = profile."profile_version"
        )
    ) THEN
      RAISE EXCEPTION 'output reservation is not the exact current closure/profile horizon'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_submit_once_grants_v1' THEN
    NEW."issued_at" := database_now;
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_execution_activations_v1" activation
      JOIN public."foundry_derivative_executor_authorizations_v1" executor
        ON executor."id" = activation."executor_authorization_id"
       AND executor."authorization_sha256" = activation."executor_authorization_sha256"
      JOIN public."foundry_provider_commands" command
        ON command."id" = NEW."provider_command_id"
      JOIN public."foundry_derivative_provider_command_sidecars_v1" sidecar
        ON sidecar."provider_command_id" = command."id"
       AND sidecar."activation_id" = activation."id"
      WHERE activation."id" = NEW."activation_id"
        AND activation."activation_sha256" = NEW."activation_sha256"
        AND activation."closure_id" = NEW."closure_id"
        AND activation."closure_sha256" = NEW."closure_sha256"
        AND NEW."executor_authorization_id" = executor."id"
        AND NEW."executor_workload_identity_sha256" =
          executor."executor_workload_identity_sha256"
        AND NEW."submit_gateway_workload_identity_sha256" =
          executor."submit_gateway_workload_identity_sha256"
        AND command."state" = 'claimed'
        AND command."command_kind" = 'provider_submit'
        AND command."claim_token" = NEW."claim_token"
        AND command."claimed_by" = NEW."claimed_by"
        AND command."fencing_token" = NEW."fencing_token"
        AND command."claim_expires_at" > database_now
        AND NEW."authority_not_after" = LEAST(
          activation."authority_not_after", executor."expires_at",
          command."claim_expires_at", NEW."expires_at"
        )
        AND NEW."authority_not_after" > database_now
        AND executor."valid_from" <= database_now
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_derivative_executor_authorization_revocations_v1" revoked
          WHERE revoked."authorization_id" = executor."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_execution_events" existing_event
          WHERE existing_event."id" = NEW."planned_invocation_event_id"
        )
    ) THEN
      RAISE EXCEPTION 'submit grant is not the exact first immutable current claim'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_submit_once_redemptions_v1' AND NOT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_submit_once_grants_v1" grant_row
    JOIN public."foundry_execution_events" event_row
      ON event_row."id" = NEW."invocation_event_id"
    WHERE grant_row."id" = NEW."grant_id"
      AND grant_row."planned_invocation_event_id" = NEW."invocation_event_id"
      AND grant_row."token_sha256" = NEW."token_sha256"
      AND grant_row."provider_command_id" = NEW."provider_command_id"
      AND grant_row."claim_token" = NEW."claim_token"
      AND grant_row."claimed_by" = NEW."claimed_by"
      AND grant_row."fencing_token" = NEW."fencing_token"
      AND grant_row."issued_at" <= database_now
      AND grant_row."expires_at" > database_now
      AND grant_row."authority_not_after" > database_now
      AND event_row."event_kind" = 'provider_invocation_started'
      AND event_row."provider_command_id" = grant_row."provider_command_id"
      AND event_row."provider_command_kind" = 'provider_submit'
      AND event_row."execution_id" = grant_row."execution_id"
      AND event_row."attempt_id" = grant_row."attempt_id"
      AND event_row."fencing_token" = grant_row."fencing_token"
      AND event_row."claim_token" = grant_row."claim_token"
      AND event_row."provider_idempotency_key" = grant_row."provider_idempotency_key"
      AND event_row."actor_kind" = 'service'
      AND event_row."actor_key" = NEW."claimed_by"
  ) THEN
    RAISE EXCEPTION 'submit redemption does not equal its one-use grant and planned event'
      USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'foundry_derivative_submit_once_redemptions_v1' THEN
    SELECT event_row."recorded_at" INTO redemption_recorded_at
    FROM public."foundry_execution_events" event_row
    WHERE event_row."id" = NEW."invocation_event_id";
    NEW."redeemed_at" := redemption_recorded_at;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_recovery_authorities_v1' AND (
    NEW."provider_execution_ref" IS DISTINCT FROM (
      SELECT attempt."provider_execution_ref"
      FROM public."foundry_attempts" attempt
      WHERE attempt."id" = NEW."attempt_id"
        AND attempt."execution_id" = NEW."execution_id"
        AND attempt."fencing_token" = NEW."fencing_token"
    )
    OR NOT (
    (NEW."historical_source_kind" = 'submit_redemption' AND EXISTS (
      SELECT 1
      FROM public."foundry_derivative_submit_once_redemptions_v1" source
      JOIN public."foundry_derivative_submit_once_grants_v1" source_grant
        ON source_grant."id" = source."grant_id"
      WHERE source."id" = NEW."historical_source_id"
        AND source."redemption_sha256" = NEW."historical_source_sha256"
        AND source."activation_id" = NEW."activation_id"
        AND source."activation_sha256" = NEW."activation_sha256"
        AND source_grant."activation_id" = NEW."activation_id"
        AND source_grant."activation_sha256" = NEW."activation_sha256"
        AND source_grant."closure_id" = NEW."closure_id"
        AND source_grant."closure_sha256" = NEW."closure_sha256"
        AND source_grant."execution_id" = NEW."execution_id"
        AND source_grant."attempt_id" = NEW."attempt_id"
        AND source_grant."fencing_token" = NEW."fencing_token"
        AND source."fencing_token" = NEW."fencing_token"
    )) OR
    (NEW."historical_source_kind" = 'containment_event' AND EXISTS (
      SELECT 1 FROM public."foundry_derivative_execution_containment_events_v1" source
      WHERE source."id" = NEW."historical_source_id"
        AND source."containment_sha256" = NEW."historical_source_sha256"
        AND source."activation_id" = NEW."activation_id"
        AND source."activation_sha256" = NEW."activation_sha256"
        AND source."closure_id" = NEW."closure_id"
        AND source."closure_sha256" = NEW."closure_sha256"
        AND source."execution_id" = NEW."execution_id"
        AND source."attempt_id" = NEW."attempt_id"
        AND source."fencing_token" = NEW."fencing_token"
    ))
    )
  ) THEN
    RAISE EXCEPTION 'recovery authority lacks an immutable historical source'
      USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'foundry_derivative_recovery_authorities_v1' THEN
    NEW."created_at" := database_now;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_recovery_call_grants_v1' THEN
    NEW."issued_at" := database_now;
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_recovery_authorities_v1" recovery
      JOIN public."foundry_provider_commands" command
        ON command."id" = NEW."provider_command_id"
      WHERE recovery."id" = NEW."recovery_authority_id"
        AND recovery."authority_sha256" = NEW."recovery_authority_sha256"
        AND recovery."activation_id" = NEW."activation_id"
        AND recovery."execution_id" = NEW."execution_id"
        AND recovery."attempt_id" = NEW."attempt_id"
        AND recovery."fencing_token" = NEW."fencing_token"
        AND NEW."target_provider_ref" IS NOT DISTINCT FROM
          recovery."provider_execution_ref"
        AND recovery."allowed_kinds_json" @> jsonb_build_array(NEW."call_kind")
        AND command."command_kind" = NEW."call_kind"
        AND command."execution_id" = NEW."execution_id"
        AND command."attempt_id" = NEW."attempt_id"
        AND command."target_provider_ref" IS NOT DISTINCT FROM
          recovery."provider_execution_ref"
        AND command."target_provider_ref" IS NOT DISTINCT FROM
          NEW."target_provider_ref"
        AND command."state" = 'claimed'
        AND command."claim_token" = NEW."claim_token"
        AND command."claimed_by" = NEW."claimed_by"
        AND command."fencing_token" = NEW."fencing_token"
        AND command."claim_expires_at" > database_now
        AND NEW."authority_not_after" = LEAST(
          recovery."retention_not_after", command."claim_expires_at", NEW."expires_at"
        )
        AND NEW."authority_not_after" > database_now
        AND command."stop_intent_id" IS NOT DISTINCT FROM NEW."stop_intent_id"
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_execution_events" existing_event
          WHERE existing_event."id" = NEW."planned_call_event_id"
        )
        AND (
          NEW."call_kind" <> 'provider_stop'
          OR EXISTS (
            SELECT 1 FROM public."foundry_stop_intents" intent
            WHERE intent."id" = NEW."stop_intent_id"
              AND intent."request_digest" = NEW."stop_intent_sha256"
              AND intent."execution_id" = NEW."execution_id"
              AND intent."attempt_id" = NEW."attempt_id"
              AND intent."fencing_token" = NEW."fencing_token"
              AND intent."target_terminal_state" = 'terminal_killed'
              AND (
                recovery."historical_source_kind" <> 'containment_event'
                OR (
                  intent."source_kind" = 'derivative_authority_event'
                  AND intent."source_id" = recovery."historical_source_id"
                  AND intent."source_digest" = recovery."historical_source_sha256"
                )
              )
          )
        )
    ) THEN
      RAISE EXCEPTION 'recovery grant is outside its historical exact-call boundary'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_recovery_call_redemptions_v1' AND NOT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_recovery_call_grants_v1" grant_row
    JOIN public."foundry_execution_events" event_row ON event_row."id" = NEW."call_event_id"
    WHERE grant_row."id" = NEW."grant_id"
      AND grant_row."planned_call_event_id" = NEW."call_event_id"
      AND grant_row."token_sha256" = NEW."token_sha256"
      AND grant_row."provider_command_id" = NEW."provider_command_id"
      AND grant_row."claim_token" = NEW."claim_token"
      AND grant_row."claimed_by" = NEW."claimed_by"
      AND grant_row."fencing_token" = NEW."fencing_token"
      AND grant_row."call_kind" = NEW."call_kind"
      AND grant_row."issued_at" <= database_now
      AND grant_row."expires_at" > database_now
      AND grant_row."authority_not_after" > database_now
      AND event_row."event_kind" = 'provider_invocation_started'
      AND event_row."execution_id" = grant_row."execution_id"
      AND event_row."attempt_id" = grant_row."attempt_id"
      AND event_row."fencing_token" = grant_row."fencing_token"
      AND event_row."provider_command_id" = NEW."provider_command_id"
      AND event_row."provider_command_kind" = NEW."call_kind"
      AND event_row."claim_token" = NEW."claim_token"
      AND event_row."actor_kind" = 'service'
      AND event_row."actor_key" = NEW."claimed_by"
      AND event_row."provider_idempotency_key" = NEW."provider_idempotency_key"
  ) THEN
    RAISE EXCEPTION 'recovery redemption does not equal its one-use grant and planned event'
      USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'foundry_derivative_recovery_call_redemptions_v1' THEN
    SELECT event_row."recorded_at" INTO redemption_recorded_at
    FROM public."foundry_execution_events" event_row
    WHERE event_row."id" = NEW."call_event_id";
    NEW."redeemed_at" := redemption_recorded_at;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_output_broker_authorizations_v1' THEN
    NEW."issued_at" := database_now;
    NEW."recorded_at" := database_now;
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_output_reservations_v1" reservation
      JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
        ON profile."profile_id" = reservation."storage_profile_id"
       AND profile."profile_version" = reservation."storage_profile_version"
       AND profile."profile_sha256" = reservation."storage_profile_sha256"
      WHERE reservation."id" = NEW."reservation_id"
        AND reservation."reservation_sha256" = NEW."reservation_sha256"
        AND reservation."activation_id" = NEW."activation_id"
        AND reservation."activation_sha256" = NEW."activation_sha256"
        AND reservation."closure_id" = NEW."closure_id"
        AND reservation."closure_sha256" = NEW."closure_sha256"
        AND reservation."bucket" = NEW."bucket"
        AND reservation."object_key" = NEW."object_key"
        AND reservation."expected_broker_workload_sha256" = NEW."workload_identity_sha256"
        AND reservation."expected_broker_policy_sha256" = NEW."create_only_policy_sha256"
        AND NEW."expires_at" <= reservation."expires_at"
        AND NEW."expires_at" <= profile."expires_at"
        AND NEW."credential_expires_at" > database_now
        AND EXISTS (
          SELECT 1
          FROM public."foundry_derivative_submit_once_redemptions_v1" redeemed
          WHERE redeemed."activation_id" = reservation."activation_id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
          WHERE revoked."profile_id" = profile."profile_id"
            AND revoked."profile_version" = profile."profile_version"
        )
    ) THEN
      RAISE EXCEPTION 'broker authorization lacks exact frozen-reservation authority'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_broker_object_uses_v1' THEN
    NEW."authorized_at" := database_now;
  END IF;
  IF TG_TABLE_NAME = 'foundry_derivative_broker_object_uses_v1' AND NOT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_output_broker_authorizations_v1" auth_row
    JOIN public."foundry_derivative_output_reservations_v1" reservation
      ON reservation."id" = auth_row."reservation_id"
    JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
      ON profile."profile_id" = reservation."storage_profile_id"
     AND profile."profile_version" = reservation."storage_profile_version"
     AND profile."profile_sha256" = reservation."storage_profile_sha256"
    WHERE auth_row."id" = NEW."broker_authorization_id"
      AND auth_row."authorization_sha256" = NEW."broker_authorization_sha256"
      AND auth_row."capability_sha256" = NEW."capability_token_sha256"
      AND auth_row."planned_upload_operation_id" = NEW."upload_operation_id"
      AND auth_row."bucket" = NEW."bucket"
      AND auth_row."object_key" = NEW."object_key"
      AND reservation."spool_root_identity" = NEW."spool_root_identity"
      AND reservation."spool_identity" = NEW."spool_identity"
      AND auth_row."issued_at" <= database_now
      AND LEAST(
        auth_row."expires_at", auth_row."credential_expires_at",
        reservation."expires_at", profile."expires_at",
        database_now + make_interval(secs => auth_row."maximum_put_seconds")
      ) = NEW."put_not_after"
      AND NEW."authorized_at" = database_now
      AND NOT EXISTS (
        SELECT 1 FROM public."foundry_derivative_output_broker_authorization_revocations_v1" revoked
        WHERE revoked."authorization_id" = auth_row."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
        WHERE revoked."profile_id" = profile."profile_id"
          AND revoked."profile_version" = profile."profile_version"
      )
  ) THEN
    RAISE EXCEPTION 'broker object use is outside its exact one-key DB-time horizon'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_output_custodian_authorizations_v1' THEN
    NEW."valid_from" := database_now;
    NEW."recorded_at" := database_now;
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_output_reservations_v1" reservation
      JOIN public."foundry_derivative_broker_object_uses_v1" broker_use
        ON broker_use."id" = NEW."broker_object_use_id"
       AND broker_use."reservation_id" = reservation."id"
      JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
        ON profile."profile_id" = reservation."storage_profile_id"
       AND profile."profile_version" = reservation."storage_profile_version"
       AND profile."profile_sha256" = reservation."storage_profile_sha256"
      WHERE reservation."id" = NEW."reservation_id"
        AND reservation."reservation_sha256" = NEW."reservation_sha256"
        AND reservation."activation_id" = NEW."activation_id"
        AND reservation."activation_sha256" = NEW."activation_sha256"
        AND reservation."closure_id" = NEW."closure_id"
        AND reservation."closure_sha256" = NEW."closure_sha256"
        AND broker_use."upload_operation_id" =
          (NEW."create_receipt_json"->>'uploadOperationId')::uuid
        AND NEW."create_receipt_json"->>'bucket' = NEW."bucket"
        AND NEW."create_receipt_json"->>'objectKey' = NEW."object_key"
        AND NEW."create_receipt_json"->>'objectVersion' = NEW."object_version"
        AND NEW."create_receipt_sha256" =
          public."foundry_ecmascript_domain_jsonb_sha256"(
            'omnitwin.foundry.derivative-object-create-receipt.v1',
            NEW."create_receipt_json"
          )
        AND reservation."expected_custodian_workload_sha256" =
          NEW."workload_identity_sha256"
        AND reservation."expected_custodian_policy_sha256" =
          NEW."version_read_only_policy_sha256"
        AND reservation."glb_verifier_id" = NEW."verifier_id"
        AND reservation."glb_verifier_version" = NEW."verifier_version"
        AND reservation."glb_verifier_sha256" = NEW."verifier_sha256"
        AND NEW."expires_at" <= profile."expires_at"
        AND NOT EXISTS (
          SELECT 1
          FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
          WHERE revoked."profile_id" = profile."profile_id"
            AND revoked."profile_version" = profile."profile_version"
        )
    ) THEN
      RAISE EXCEPTION 'custodian authorization lacks exact create-receipt/version authority'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'foundry_derivative_execution_containment_events_v1' THEN
    NEW."recorded_at" := database_now;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_guard_activation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  database_now timestamptz;
  selected_epoch record;
  candidate_row public."foundry_derivative_execution_authorization_candidates_v1"%ROWTYPE;
  closure_row public."foundry_derivative_candidate_relational_closures_v1"%ROWTYPE;
  profile_row public."foundry_derivative_quarantine_storage_profiles_v1"%ROWTYPE;
  executor_row public."foundry_derivative_executor_authorizations_v1"%ROWTYPE;
  approval_row public."foundry_derivative_rights_approvals"%ROWTYPE;
  review_row public."foundry_derivative_rights_reviews_v1"%ROWTYPE;
  attestation_row public."foundry_derivative_rights_registry_attestations_v1"%ROWTYPE;
  job_row public."foundry_jobs"%ROWTYPE;
  worker_row public."foundry_trusted_worker_profiles"%ROWTYPE;
  base_approval_row public."foundry_rights_approvals"%ROWTYPE;
  confirmation_row public."foundry_execution_confirmations"%ROWTYPE;
  compute_expires_at timestamptz := 'infinity'::timestamptz;
  minimum_horizon timestamptz;
BEGIN
  database_now := public."fdv1_assert_enabled"('activation');
  NEW."activated_at" := database_now;
  SELECT * INTO selected_epoch FROM public."fdv1_current_epoch"(database_now);
  SELECT * INTO candidate_row
  FROM public."foundry_derivative_execution_authorization_candidates_v1"
  WHERE "id" = NEW."candidate_id" FOR KEY SHARE;
  SELECT * INTO closure_row
  FROM public."foundry_derivative_candidate_relational_closures_v1"
  WHERE "id" = NEW."closure_id" AND "closure_sha256" = NEW."closure_sha256"
  FOR KEY SHARE;
  SELECT * INTO profile_row
  FROM public."foundry_derivative_quarantine_storage_profiles_v1" profile
  WHERE profile."profile_id" = NEW."storage_profile_id"
    AND profile."profile_version" = NEW."storage_profile_version"
    AND profile."profile_sha256" = NEW."storage_profile_sha256"
  FOR KEY SHARE;
  SELECT * INTO executor_row
  FROM public."foundry_derivative_executor_authorizations_v1" auth_row
  WHERE auth_row."id" = NEW."executor_authorization_id"
    AND auth_row."authorization_sha256" = NEW."executor_authorization_sha256"
  FOR KEY SHARE;
  SELECT * INTO approval_row
  FROM public."foundry_derivative_rights_approvals" approval
  WHERE approval."approval_id" = NEW."approval_id"
  FOR KEY SHARE;
  SELECT * INTO review_row
  FROM public."foundry_derivative_rights_reviews_v1" review
  WHERE review."id" = NEW."review_id"
  FOR KEY SHARE;
  SELECT * INTO attestation_row
  FROM public."foundry_derivative_rights_registry_attestations_v1" attestation
  WHERE attestation."id" = NEW."attestation_id"
  FOR KEY SHARE;
  SELECT * INTO job_row
  FROM public."foundry_jobs" job
  WHERE job."job_id" = NEW."job_id" AND job."project_id" = NEW."project_id"
  FOR KEY SHARE;
  SELECT * INTO worker_row
  FROM public."foundry_trusted_worker_profiles" worker
  WHERE worker."profile_id" = NEW."worker_profile_id"
    AND worker."worker_profile_sha256" = NEW."worker_profile_sha256"
  FOR KEY SHARE;
  SELECT * INTO base_approval_row
  FROM public."foundry_rights_approvals" base_approval
  WHERE base_approval."job_id" = NEW."job_id"
    AND base_approval."project_id" = NEW."project_id"
    AND base_approval."rights_approval_sha256" =
      candidate_row."base_execution_subject_json"->>'rightsApprovalSha256'
  FOR KEY SHARE;
  SELECT * INTO confirmation_row
  FROM public."foundry_execution_confirmations" confirmation
  WHERE confirmation."job_id" = NEW."job_id"
    AND confirmation."project_id" = NEW."project_id"
    AND confirmation."confirmation_sha256" =
      candidate_row."base_execution_subject_json"->>'executionConfirmationSha256'
  FOR KEY SHARE;
  IF job_row."compute_approval_id" IS NOT NULL THEN
    SELECT compute_approval."expires_at" INTO compute_expires_at
    FROM public."foundry_compute_approvals" compute_approval
    WHERE compute_approval."approval_id" = job_row."compute_approval_id"
      AND compute_approval."job_id" = job_row."job_id"
      AND compute_approval."project_id" = job_row."project_id"
      AND compute_approval."compute_approval_sha256" =
        candidate_row."base_execution_subject_json"->>'computeApprovalSha256'
    FOR KEY SHARE;
  END IF;
  minimum_horizon := LEAST(
    profile_row."expires_at", executor_row."expires_at", approval_row."expires_at",
    attestation_row."approval_expires_at", base_approval_row."expires_at",
    confirmation_row."expires_at", compute_expires_at, job_row."dispatch_deadline",
    job_row."pricing_snapshot_expires_at", worker_row."expires_at",
    COALESCE(public."fdv1_next_epoch_boundary"(database_now), 'infinity'::timestamptz),
    COALESCE(public."fdv1_next_derivative_policy_boundary"(
      approval_row."policy_version", approval_row."policy_generation", database_now
    ), 'infinity'::timestamptz),
    COALESCE(public."fdv1_next_base_policy_boundary"(
      base_approval_row."policy_version", base_approval_row."policy_generation", database_now
    ), 'infinity'::timestamptz)
  );
  IF candidate_row."id" IS NULL OR closure_row."id" IS NULL
     OR profile_row."profile_id" IS NULL OR executor_row."id" IS NULL
     OR approval_row."approval_id" IS NULL OR review_row."id" IS NULL
     OR attestation_row."id" IS NULL OR job_row."job_id" IS NULL
     OR worker_row."worker_profile_sha256" IS NULL
     OR base_approval_row."id" IS NULL OR confirmation_row."confirmation_id" IS NULL
     OR (job_row."compute_approval_id" IS NOT NULL AND compute_expires_at IS NULL)
     OR candidate_row."candidate_sha256" IS DISTINCT FROM NEW."candidate_sha256"
     OR candidate_row."reservation_id" IS DISTINCT FROM NEW."candidate_reservation_id"
     OR candidate_row."approval_id" IS DISTINCT FROM NEW."approval_id"
     OR candidate_row."review_id" IS DISTINCT FROM NEW."review_id"
     OR candidate_row."attestation_id" IS DISTINCT FROM NEW."attestation_id"
     OR candidate_row."base_execution_subject_sha256"
          IS DISTINCT FROM NEW."execution_subject_sha256"
     OR candidate_row."restriction_lineage_set_sha256"
          IS DISTINCT FROM NEW."restriction_lineage_sha256"
     OR candidate_row."output_policy_sha256" IS DISTINCT FROM NEW."output_policy_sha256"
     OR closure_row."candidate_id" IS DISTINCT FROM NEW."candidate_id"
     OR closure_row."project_id" IS DISTINCT FROM NEW."project_id"
     OR closure_row."job_id" IS DISTINCT FROM NEW."job_id"
     OR closure_row."execution_envelope_sha256" IS DISTINCT FROM NEW."execution_envelope_sha256"
     OR closure_row."ingest_manifest_sha256" IS DISTINCT FROM NEW."ingest_manifest_sha256"
     OR closure_row."stage_id" IS DISTINCT FROM NEW."stage_id"
     OR closure_row."source_asset_id" IS DISTINCT FROM NEW."source_asset_id"
     OR closure_row."source_asset_sha256" IS DISTINCT FROM NEW."source_asset_sha256"
     OR closure_row."worker_profile_id" IS DISTINCT FROM NEW."worker_profile_id"
     OR closure_row."worker_profile_sha256" IS DISTINCT FROM NEW."worker_profile_sha256"
     OR selected_epoch.generation IS DISTINCT FROM NEW."epoch_generation"
     OR selected_epoch.epoch_sha256 IS DISTINCT FROM NEW."epoch_sha256"
     OR selected_epoch.effective_at IS DISTINCT FROM NEW."epoch_effective_at"
     OR selected_epoch.enabled IS DISTINCT FROM NEW."epoch_enabled"
     OR NEW."authority_not_after" IS DISTINCT FROM minimum_horizon
     OR NEW."authority_not_after" <= database_now
     OR profile_row."valid_from" > database_now
     OR executor_row."valid_from" > database_now
     OR worker_row."reviewed_at" > database_now
     OR worker_row."registered_at" > database_now
     OR job_row."dispatch_deadline" <= database_now
     OR job_row."pricing_snapshot_expires_at" <= database_now
     OR base_approval_row."decision" IS DISTINCT FROM 'allowed'
     OR base_approval_row."expires_at" <= database_now
     OR base_approval_row."policy_generation" IS DISTINCT FROM
       public."fdv1_current_base_generation"(
         base_approval_row."policy_version", database_now
       )
     OR base_approval_row."policy_definition_sha256" IS DISTINCT FROM
       candidate_row."base_execution_subject_json"->>'rightsPolicyDefinitionSha256'
     OR base_approval_row."policy_evidence_sha256" IS DISTINCT FROM
       candidate_row."base_execution_subject_json"->>'rightsPolicyEvidenceSha256'
     OR confirmation_row."expires_at" <= database_now
     OR executor_row."provider_kind" IS DISTINCT FROM closure_row."provider_kind"
     OR executor_row."provider_adapter_id" IS DISTINCT FROM
       closure_row."provider_adapter_id"
     OR executor_row."provider_adapter_version" IS DISTINCT FROM
       closure_row."provider_adapter_version"
     OR executor_row."worker_profile_id" IS DISTINCT FROM NEW."worker_profile_id"
     OR executor_row."worker_profile_sha256" IS DISTINCT FROM NEW."worker_profile_sha256"
     OR executor_row."container_image_digest" IS DISTINCT FROM
       closure_row."container_image_digest"
     OR executor_row."stage_id" IS DISTINCT FROM NEW."stage_id"
     OR executor_row."operation_id" IS DISTINCT FROM closure_row."operation_id"
     OR executor_row."operation_class" IS DISTINCT FROM closure_row."operation_class"
     OR worker_row."container_image" IS DISTINCT FROM closure_row."container_image_digest"
     OR worker_row."operation_class" IS DISTINCT FROM closure_row."operation_class"
     OR worker_row."network_access" IS DISTINCT FROM 'none'
     OR NOT EXISTS (
       SELECT 1 FROM public."users" administrator
       WHERE administrator."id" = NEW."administrator_user_id"
         AND administrator."platform_role" = 'admin'
     )
     OR EXISTS (
       SELECT 1 FROM public."foundry_derivative_executor_authorization_revocations_v1" revoked
       WHERE revoked."authorization_id" = NEW."executor_authorization_id"
     )
     OR EXISTS (
       SELECT 1 FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
       WHERE revoked."profile_id" = NEW."storage_profile_id"
         AND revoked."profile_version" = NEW."storage_profile_version"
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public."foundry_derivative_rights_approvals" approval
       JOIN public."foundry_derivative_rights_reviews_v1" review
         ON review."id" = NEW."review_id"
        AND review."approval_id" = approval."approval_id"
       JOIN public."foundry_derivative_rights_registry_attestations_v1" attestation
         ON attestation."id" = NEW."attestation_id"
        AND attestation."approval_id" = approval."approval_id"
        AND attestation."review_id" = review."id"
       WHERE approval."approval_id" = NEW."approval_id"
         AND approval."job_id" = NEW."job_id"
         AND approval."project_id" = NEW."project_id"
         AND approval."job_spec_sha256" = closure_row."job_spec_sha256"
         AND approval."ingest_manifest_sha256" = NEW."ingest_manifest_sha256"
         AND approval."stage_id" = NEW."stage_id"
         AND approval."asset_id" = NEW."source_asset_id"
         AND approval."decision" = 'allowed'
         AND approval."expires_at" > database_now
         AND review."decision" = 'accepted_for_registry_attestation'
         AND review."derivative_rights_approval_sha256" =
           approval."derivative_rights_approval_sha256"
         AND attestation."registry_attestation_sha256" =
           candidate_row."registry_attestation_sha256"
         AND attestation."derivative_rights_approval_sha256" =
           approval."derivative_rights_approval_sha256"
         AND attestation."review_receipt_sha256" = review."review_receipt_sha256"
         AND attestation."job_subject_sha256" = approval."job_subject_sha256"
         AND attestation."ingest_manifest_sha256" = approval."ingest_manifest_sha256"
         AND attestation."stage_id" = approval."stage_id"
         AND attestation."operation_id" = approval."operation_id"
         AND attestation."derivative_class" = approval."derivative_class"
         AND attestation."asset_id" = approval."asset_id"
         AND attestation."policy_version" = approval."policy_version"
         AND attestation."policy_definition_sha256" =
           approval."policy_definition_sha256"
         AND attestation."approval_expires_at" > database_now
         AND attestation."policy_generation" =
           public."fdv1_current_derivative_generation"(
             attestation."policy_version", database_now
           )
         AND NOT EXISTS (
           SELECT 1
           FROM public."foundry_derivative_rights_policy_revocations" revoked
           WHERE revoked."policy_version" = attestation."policy_version"
             AND revoked."policy_definition_sha256" =
               attestation."policy_definition_sha256"
             AND revoked."policy_generation" = attestation."policy_generation"
             AND revoked."revoked_at" <= database_now
         )
         AND NOT EXISTS (
           SELECT 1
           FROM public."foundry_derivative_rights_registry_attestation_revocations_v1" revoked
           WHERE revoked."attestation_id" = attestation."id"
             AND revoked."revoked_at" <= database_now
         )
     ) THEN
    RAISE EXCEPTION 'activation does not bind one exact current closed authority chain'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_guard_command_claim"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."foundry_derivative_provider_command_sidecars_v1" sidecar
    WHERE sidecar."provider_command_id" = OLD."id"
  ) THEN
    PERFORM public."fdv1_lock_scopes"(
      NULL, NULL, OLD."execution_id", OLD."attempt_id", OLD."id", NULL
    );
    IF OLD."claim_token" IS NOT NULL AND (
      NEW."claim_token" IS DISTINCT FROM OLD."claim_token"
      OR NEW."claimed_by" IS DISTINCT FROM OLD."claimed_by"
      OR NEW."fencing_token" IS DISTINCT FROM OLD."fencing_token"
    ) THEN
      RAISE EXCEPTION 'derivative command claim tuple is immutable and non-retokenizable'
        USING ERRCODE = '23514';
    END IF;
    IF OLD."state" <> 'pending' AND NEW."state" = 'pending' THEN
      RAISE EXCEPTION 'derivative command cannot return to a claimable pending state'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_guard_checkpoint"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."fdv1_lock_root"();
  IF EXISTS (
    SELECT 1 FROM public."foundry_jobs" job
    WHERE job."job_id" = NEW."job_id" AND job."project_id" = NEW."project_id"
      AND (
        public."foundry_classify_normalize_mesh_glb_v0_job_spec"(job."job_spec_json")
          <> 'unrelated'
        OR EXISTS (
          SELECT 1 FROM public."foundry_job_worker_profiles" binding
          WHERE binding."job_id" = job."job_id"
            AND binding."operation_class" = 'deterministic_transformation'
        )
      )
  ) THEN
    RAISE EXCEPTION 'checkpoints are structurally forbidden for the derivative V1 subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_json_strings"(value_input jsonb)
RETURNS SETOF text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  child jsonb;
BEGIN
  CASE jsonb_typeof(value_input)
    WHEN 'string' THEN
      RETURN NEXT value_input #>> '{}';
    WHEN 'array' THEN
      FOR child IN SELECT value FROM jsonb_array_elements(value_input) LOOP
        RETURN QUERY SELECT * FROM public."fdv1_json_strings"(child);
      END LOOP;
    WHEN 'object' THEN
      FOR child IN SELECT value FROM jsonb_each(value_input) LOOP
        RETURN QUERY SELECT * FROM public."fdv1_json_strings"(child);
      END LOOP;
    ELSE
      NULL;
  END CASE;
  RETURN;
END;
$$;

CREATE FUNCTION "fdv1_normalize_ref"(value_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  normalized text := lower(btrim(value_input));
BEGIN
  normalized := replace(normalized, E'\\', '/');
  -- Decode the separators that can smuggle a bucket/key through a URL or JSON
  -- pointer.  Two passes also close the common double-encoding form.
  FOR pass IN 1..2 LOOP
    normalized := replace(normalized, '%25', '%');
    normalized := replace(normalized, '%2f', '/');
    normalized := replace(normalized, '%3a', ':');
    normalized := replace(normalized, '%5c', '/');
    normalized := replace(normalized, '%3f', '?');
    normalized := replace(normalized, '%23', '#');
  END LOOP;
  -- Any remaining percent-encoded octet is ambiguous at a security boundary.
  -- Failing closed also covers recursively encoded bucket/root characters,
  -- not only encoded separators.
  IF normalized ~ '%[0-9a-f]{2}' THEN
    RAISE EXCEPTION 'encoded object reference is denied'
      USING ERRCODE = '23514';
  END IF;
  RETURN regexp_replace(normalized, '/+', '/', 'g');
END;
$$;

CREATE FUNCTION "fdv1_public_projection"(table_input text, row_input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE table_input
    WHEN 'venues' THEN jsonb_build_array(row_input->'logo_url')
    WHEN 'spaces' THEN jsonb_build_array(row_input->'mesh_url', row_input->'thumbnail_url')
    WHEN 'asset_definitions' THEN jsonb_build_array(
      row_input->'mesh_url', row_input->'thumbnail_url'
    )
    WHEN 'configurations' THEN jsonb_build_array(
      row_input->'thumbnail_url', row_input->'lightmap_url'
    )
    WHEN 'configuration_sheet_snapshots' THEN jsonb_build_array(
      row_input->'diagram_url', row_input->'pdf_url', row_input->'source_hash',
      row_input->'payload'
    )
    WHEN 'photo_references' THEN jsonb_build_array(
      row_input->'image_url', row_input->'thumbnail_url'
    )
    WHEN 'files' THEN jsonb_build_array(
      row_input->'file_key', row_input->'sha256', row_input->'visibility'
    )
    WHEN 'website_embed_configs' THEN jsonb_build_array(row_input->'cta_url')
    WHEN 'asset_versions' THEN jsonb_build_array(
      row_input->'r2_key', row_input->'external_url', row_input->'sha256'
    )
    WHEN 'runtime_packages' THEN jsonb_build_array(
      row_input->'primary_visual_asset_version_id',
      row_input->'semantic_mesh_asset_version_id',
      row_input->'collision_asset_version_id',
      row_input->'point_cloud_asset_version_id', row_input->'manifest_json'
    )
    WHEN 'reconstruction_releases' THEN jsonb_build_array(
      row_input->'candidate_bucket', row_input->'candidate_prefix',
      row_input->'release_manifest_key', row_input->'release_manifest_sha256',
      row_input->'source_manifest_sha256', row_input->'release_digest',
      row_input->'manifest_json'
    )
    WHEN 'reconstruction_release_qa_runs' THEN jsonb_build_array(
      row_input->'report_key', row_input->'report_digest', row_input->'report_json'
    )
    WHEN 'reconstruction_release_reviews' THEN jsonb_build_array(
      row_input->'visual_evidence', row_input->'transform_artifact_refs',
      row_input->'scene_authority_refs', row_input->'request_digest'
    )
    WHEN 'reconstruction_review_evidence_artifacts' THEN jsonb_build_array(
      row_input->'object_key', row_input->'artifact_digest',
      row_input->'object_sha256', row_input->'artifact_id', row_input->'request_digest'
    )
    WHEN 'reconstruction_release_attestations' THEN jsonb_build_array(
      row_input->'r2_key', row_input->'statement_sha256', row_input->'envelope_sha256',
      row_input->'release_digest', row_input->'review_digest',
      row_input->'qa_report_digest', row_input->'request_digest'
    )
    WHEN 'reconstruction_release_publications' THEN jsonb_build_array(
      row_input->'release_bucket', row_input->'candidate_prefix', row_input->'release_prefix',
      row_input->'public_manifest_key', row_input->'public_base_url',
      row_input->'manifest_url', row_input->'manifest_sha256',
      row_input->'verification_digest', row_input->'release_digest',
      row_input->'review_digest', row_input->'attestation_envelope_sha256'
    )
    WHEN 'reconstruction_release_channels' THEN row_input
    WHEN 'reconstruction_release_channel_events' THEN row_input
    ELSE '[]'::jsonb
  END
$$;

CREATE FUNCTION "fdv1_public_refs"()
RETURNS TABLE(table_name text, row_identity text, reference_value text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH rows(table_name, row_identity, row_value) AS (
    SELECT 'venues', to_jsonb(value)->>'id', to_jsonb(value) FROM public."venues" value
    UNION ALL SELECT 'spaces', to_jsonb(value)->>'id', to_jsonb(value) FROM public."spaces" value
    UNION ALL SELECT 'asset_definitions', to_jsonb(value)->>'id', to_jsonb(value) FROM public."asset_definitions" value
    UNION ALL SELECT 'configurations', to_jsonb(value)->>'id', to_jsonb(value) FROM public."configurations" value
    UNION ALL SELECT 'configuration_sheet_snapshots', to_jsonb(value)->>'id', to_jsonb(value) FROM public."configuration_sheet_snapshots" value
    UNION ALL SELECT 'photo_references', to_jsonb(value)->>'id', to_jsonb(value) FROM public."photo_references" value
    UNION ALL SELECT 'files', to_jsonb(value)->>'id', to_jsonb(value) FROM public."files" value
    UNION ALL SELECT 'website_embed_configs', to_jsonb(value)->>'id', to_jsonb(value) FROM public."website_embed_configs" value
    UNION ALL SELECT 'asset_versions', to_jsonb(value)->>'id', to_jsonb(value) FROM public."asset_versions" value
    UNION ALL SELECT 'runtime_packages', to_jsonb(value)->>'id', to_jsonb(value) FROM public."runtime_packages" value
    UNION ALL SELECT 'reconstruction_releases', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_releases" value
    UNION ALL SELECT 'reconstruction_release_qa_runs', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_qa_runs" value
    UNION ALL SELECT 'reconstruction_release_reviews', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_reviews" value
    UNION ALL SELECT 'reconstruction_review_evidence_artifacts', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_review_evidence_artifacts" value
    UNION ALL SELECT 'reconstruction_release_attestations', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_attestations" value
    UNION ALL SELECT 'reconstruction_release_publications', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_publications" value
    UNION ALL SELECT 'reconstruction_release_channels', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_channels" value
    UNION ALL SELECT 'reconstruction_release_channel_events', to_jsonb(value)->>'id', to_jsonb(value) FROM public."reconstruction_release_channel_events" value
  )
  SELECT rows.table_name, COALESCE(rows.row_identity, '<unknown>'), string_value
  FROM rows
  CROSS JOIN LATERAL public."fdv1_json_strings"(
    public."fdv1_public_projection"(rows.table_name, rows.row_value)
  ) AS string_value
$$;

CREATE FUNCTION "fdv1_ref_matches_namespace"(
  value_input text,
  bucket_input text,
  root_prefix_input text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  normalized text := public."fdv1_normalize_ref"(value_input);
  bucket_value text := public."fdv1_normalize_ref"(bucket_input);
  root_value text := public."fdv1_normalize_ref"(root_prefix_input);
BEGIN
  RETURN position(root_value IN normalized) > 0
    AND (
      position(bucket_value IN normalized) > 0
      OR normalized = root_value
      OR normalized LIKE root_value || '%'
    );
END;
$$;

CREATE FUNCTION "fdv1_ref_is_quarantine"(value_input text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_quarantine_storage_profiles_v1" profile
    WHERE public."fdv1_ref_matches_namespace"(
      value_input, profile."bucket", profile."root_prefix"
    )
  ) OR EXISTS (
    SELECT 1
    FROM public."foundry_derivative_output_custody_v1" custody
    WHERE public."fdv1_normalize_ref"(value_input) IN (
      custody."raw_sha256"::text, custody."prefixed_sha256"
    )
  )
$$;

CREATE FUNCTION "fdv1_public_match_for_namespace"(
  bucket_input text,
  root_prefix_input text,
  raw_sha_input text DEFAULT NULL,
  prefixed_sha_input text DEFAULT NULL
)
RETURNS TABLE(table_name text, row_identity text, reference_value text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT ref.table_name, ref.row_identity, ref.reference_value
  FROM public."fdv1_public_refs"() ref
  WHERE public."fdv1_ref_matches_namespace"(
      ref.reference_value, bucket_input, root_prefix_input
    )
     OR (raw_sha_input IS NOT NULL
       AND public."fdv1_normalize_ref"(ref.reference_value) = raw_sha_input)
     OR (prefixed_sha_input IS NOT NULL
       AND public."fdv1_normalize_ref"(ref.reference_value) = prefixed_sha_input)
  ORDER BY ref.table_name COLLATE "C", ref.row_identity COLLATE "C"
$$;

CREATE FUNCTION "fdv1_security_event_json"(
  offending_table_input text,
  offending_row_input text,
  reason_input text,
  namespace_input text,
  correlation_input uuid,
  recorded_at_input timestamptz
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-quarantine-security-event.v1',
    'eventKind', 'quarantine_security_event',
    'severity', 'critical',
    'state', 'detected',
    'offendingTable', offending_table_input,
    'offendingRowId', offending_row_input,
    'reasonCode', reason_input,
    'namespaceIdentity', namespace_input,
    'actorKind', 'system',
    'actorKey', 'system:foundry-derivative-quarantine-guard',
    'correlationId', correlation_input::text,
    'recordedAt', public."fdv1_time_text"(recorded_at_input)
  )
$$;

CREATE FUNCTION "fdv1_public_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value jsonb := to_jsonb(NEW);
  projection jsonb;
  reference_value text;
  row_identity text;
  database_now timestamptz;
  correlation_value uuid := gen_random_uuid();
  event_value jsonb;
  event_sha text;
BEGIN
  PERFORM public."fdv1_lock_root"();
  projection := public."fdv1_public_projection"(TG_TABLE_NAME, row_value);
  SELECT candidate INTO reference_value
  FROM public."fdv1_json_strings"(projection) candidate
  WHERE public."fdv1_ref_is_quarantine"(candidate)
  ORDER BY candidate COLLATE "C"
  LIMIT 1;
  IF reference_value IS NULL THEN
    RETURN NEW;
  END IF;
  database_now := date_trunc('milliseconds', clock_timestamp());
  row_identity := COALESCE(row_value->>'id', row_value->>'slug', '<pending>');
  event_value := public."fdv1_security_event_json"(
    TG_TABLE_NAME, row_identity, 'quarantine_namespace_or_lineage_denied',
    public."fdv1_normalize_ref"(reference_value), correlation_value, database_now
  );
  event_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-quarantine-security-event.v1', event_value
  );
  INSERT INTO public."foundry_derivative_quarantine_security_events_v1"(
    "event_sha256", "event_kind", "severity", "state", "offending_table",
    "offending_row_id", "reason_code", "namespace_identity", "actor_kind",
    "actor_key", "correlation_id", "event_json", "recorded_at"
  ) VALUES (
    event_sha, 'quarantine_security_event', 'critical', 'detected', TG_TABLE_NAME,
    row_identity, 'quarantine_namespace_or_lineage_denied',
    public."fdv1_normalize_ref"(reference_value), 'system',
    'system:foundry-derivative-quarantine-guard', correlation_value,
    event_value, database_now
  ) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "fdv1_profile_pre_scan"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  matched record;
  database_now timestamptz;
  correlation_value uuid := gen_random_uuid();
  event_value jsonb;
  event_sha text;
BEGIN
  PERFORM public."fdv1_lock_root"();
  SELECT * INTO matched
  FROM public."fdv1_public_match_for_namespace"(NEW."bucket", NEW."root_prefix")
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  database_now := date_trunc('milliseconds', clock_timestamp());
  event_value := public."fdv1_security_event_json"(
    matched.table_name, matched.row_identity, 'quarantine_profile_namespace_overlap',
    NEW."bucket" || '/' || NEW."root_prefix", correlation_value, database_now
  );
  event_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-quarantine-security-event.v1', event_value
  );
  INSERT INTO public."foundry_derivative_quarantine_security_events_v1"(
    "event_sha256", "event_kind", "severity", "state", "offending_table",
    "offending_row_id", "reason_code", "namespace_identity", "actor_kind",
    "actor_key", "correlation_id", "event_json", "recorded_at"
  ) VALUES (
    event_sha, 'quarantine_security_event', 'critical', 'detected',
    matched.table_name, matched.row_identity, 'quarantine_profile_namespace_overlap',
    NEW."bucket" || '/' || NEW."root_prefix", 'system',
    'system:foundry-derivative-quarantine-guard', correlation_value,
    event_value, database_now
  ) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "fdv1_stop_request_sha"(
  containment_id_input uuid,
  execution_id_input uuid,
  attempt_id_input uuid,
  fencing_token_input bigint,
  reason_code_input text,
  priority_input integer,
  terminal_state_input text,
  actor_kind_input text,
  actor_key_input text,
  correlation_id_input uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-stop-intent.v1',
    jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.derivative-stop-intent.v1',
      'containmentId', containment_id_input::text,
      'executionId', execution_id_input::text,
      'attemptId', attempt_id_input::text,
      'fencingToken', fencing_token_input::text,
      'reasonCode', reason_code_input,
      'priority', priority_input,
      'targetTerminalState', terminal_state_input,
      'actorKind', actor_kind_input,
      'actorKey', actor_key_input,
      'correlationId', correlation_id_input::text
    )
  )
$$;

CREATE FUNCTION "fdv1_append_security_containment"(
  activation_id_input uuid,
  execution_id_input uuid,
  attempt_id_input uuid,
  fencing_token_input bigint,
  security_event_id_input uuid,
  security_event_sha_input text,
  correlation_id_input uuid,
  database_now_input timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  activation_row public."foundry_derivative_execution_activations_v1"%ROWTYPE;
  attempt_row public."foundry_attempts"%ROWTYPE;
  containment_id_value uuid := gen_random_uuid();
  containment_json_value jsonb;
  containment_sha_value text;
  stop_id_value uuid := gen_random_uuid();
BEGIN
  SELECT * INTO activation_row
  FROM public."foundry_derivative_execution_activations_v1"
  WHERE "id" = activation_id_input AND "execution_id" = execution_id_input
  FOR KEY SHARE;
  SELECT * INTO attempt_row
  FROM public."foundry_attempts"
  WHERE "id" = attempt_id_input AND "execution_id" = execution_id_input
    AND "fencing_token" = fencing_token_input
  FOR UPDATE;
  IF activation_row."id" IS NULL OR attempt_row."id" IS NULL
     OR left(attempt_row."state", 9) = 'terminal_' THEN
    RETURN;
  END IF;
  containment_json_value := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-execution-containment-event.v1',
    'activationId', activation_id_input::text,
    'executionId', execution_id_input::text,
    'attemptId', attempt_id_input::text,
    'attemptOrdinal', attempt_row."attempt_ordinal"::text,
    'fencingToken', fencing_token_input::text,
    'sourceKind', 'quarantine_security_event',
    'sourceId', security_event_id_input::text,
    'sourceSha256', security_event_sha_input,
    'targetTerminalState', 'terminal_killed',
    'actorKind', 'system',
    'actorKey', 'system:foundry-derivative-quarantine-guard',
    'correlationId', correlation_id_input::text,
    'recordedAt', public."fdv1_time_text"(database_now_input)
  );
  containment_sha_value := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-execution-containment-event.v1',
    containment_json_value
  );
  INSERT INTO public."foundry_derivative_execution_containment_events_v1"(
    "id", "containment_sha256", "activation_id", "activation_sha256",
    "closure_id", "closure_sha256", "execution_id", "attempt_id",
    "attempt_ordinal", "fencing_token", "source_kind", "source_id",
    "source_sha256", "target_terminal_state", "actor_kind", "actor_key",
    "correlation_id", "containment_json", "recorded_at"
  ) VALUES (
    containment_id_value, containment_sha_value, activation_row."id",
    activation_row."activation_sha256", activation_row."closure_id",
    activation_row."closure_sha256", execution_id_input, attempt_id_input,
    attempt_row."attempt_ordinal", fencing_token_input,
    'quarantine_security_event', security_event_id_input::text, security_event_sha_input,
    'terminal_killed', 'system', 'system:foundry-derivative-quarantine-guard',
    correlation_id_input, containment_json_value, database_now_input
  ) ON CONFLICT DO NOTHING
  RETURNING "containment_sha256" INTO containment_sha_value;

  IF FOUND THEN
    INSERT INTO public."foundry_stop_intents"(
      "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "execution_subject_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
      "reason_code", "priority", "target_terminal_state", "source_kind",
      "source_id", "source_digest", "source_recorded_at", "actor_kind", "actor_key",
      "actor_user_id", "idempotency_key", "causation_id", "correlation_id",
      "request_digest", "recorded_at"
    ) VALUES (
      stop_id_value, execution_id_input, attempt_row."project_id", attempt_row."job_id",
      attempt_row."execution_envelope_sha256", attempt_row."execution_subject_sha256",
      attempt_row."provider_kind", attempt_row."provider_adapter_id",
      attempt_row."provider_adapter_version", attempt_row."provider_adapter_artifact_sha256",
      attempt_row."provider_deployment_sha256", attempt_id_input,
      attempt_row."attempt_ordinal", fencing_token_input,
      'derivative_quarantine_breach', 490, 'terminal_killed',
      'derivative_authority_event', containment_id_value, containment_sha_value,
      database_now_input, 'system', 'system:foundry-derivative-quarantine-guard', NULL,
      'fdv1-security-' || security_event_id_input::text, containment_id_value,
      correlation_id_input,
      public."fdv1_stop_request_sha"(
        containment_id_value, execution_id_input, attempt_id_input,
        fencing_token_input, 'derivative_quarantine_breach', 490,
        'terminal_killed', 'system',
        'system:foundry-derivative-quarantine-guard', correlation_id_input
      ),
      database_now_input
    );
  END IF;
END;
$$;

CREATE FUNCTION "fdv1_guard_custody"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  database_now timestamptz;
  structural_ok boolean;
  public_match record;
  has_conflict boolean;
  action_history_ok boolean;
  content_ok boolean;
  result_ok boolean;
  glb_ok boolean;
  authority_current boolean;
  proof_value jsonb;
  expected_read_receipt jsonb;
  expected_worker_manifest jsonb;
  worker_time timestamptz;
  broker_time timestamptz;
  correlation_value uuid := gen_random_uuid();
  security_id_value uuid := gen_random_uuid();
  event_value jsonb;
  event_sha text;
BEGIN
  PERFORM public."fdv1_lock_scopes"(
    NULL, NEW."activation_id", NEW."execution_id", NEW."attempt_id", NULL,
    NEW."output_slot"
  );
  database_now := date_trunc('milliseconds', clock_timestamp());

  SELECT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_execution_activations_v1" activation
    JOIN public."foundry_derivative_execution_authorization_candidates_v1" candidate
      ON candidate."id" = activation."candidate_id"
     AND candidate."candidate_sha256" = activation."candidate_sha256"
    JOIN public."foundry_derivative_candidate_relational_closures_v1" closure
      ON closure."id" = activation."closure_id"
     AND closure."closure_sha256" = activation."closure_sha256"
    JOIN public."foundry_derivative_output_reservations_v1" reservation
      ON reservation."activation_id" = activation."id"
     AND reservation."closure_id" = closure."id"
    JOIN public."foundry_attempts" attempt
      ON attempt."id" = reservation."attempt_id"
     AND attempt."execution_id" = activation."execution_id"
    JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
      ON profile."profile_id" = reservation."storage_profile_id"
     AND profile."profile_version" = reservation."storage_profile_version"
     AND profile."profile_sha256" = reservation."storage_profile_sha256"
    JOIN public."foundry_derivative_submit_once_grants_v1" submit_grant
      ON submit_grant."activation_id" = activation."id"
    JOIN public."foundry_derivative_submit_once_redemptions_v1" submit_redemption
      ON submit_redemption."grant_id" = submit_grant."id"
    JOIN public."foundry_derivative_output_broker_authorizations_v1" broker_auth
      ON broker_auth."reservation_id" = reservation."id"
    JOIN public."foundry_derivative_broker_object_uses_v1" broker_use
      ON broker_use."broker_authorization_id" = broker_auth."id"
    JOIN public."foundry_derivative_output_custodian_authorizations_v1" custodian_auth
      ON custodian_auth."broker_object_use_id" = broker_use."id"
    JOIN public."foundry_provider_commands" command
      ON command."id" = submit_grant."provider_command_id"
    JOIN public."foundry_provider_command_result_observations" observation
      ON observation."id" = NEW."result_observation_id"
    JOIN public."foundry_provider_commands" result_command
      ON result_command."id" = observation."provider_command_id"
    JOIN public."foundry_derivative_provider_command_sidecars_v1" result_sidecar
      ON result_sidecar."provider_command_id" = result_command."id"
     AND result_sidecar."activation_id" = activation."id"
    JOIN public."foundry_execution_events" invocation
      ON invocation."id" = submit_redemption."invocation_event_id"
    JOIN public."foundry_execution_events" completion
      ON completion."id" = NEW."completion_event_id"
    JOIN public."foundry_provider_command_result_classifications" classification
      ON classification."id" = NEW."result_classification_id"
    WHERE activation."id" = NEW."activation_id"
      AND activation."activation_sha256" = NEW."activation_sha256"
      AND closure."id" = NEW."closure_id" AND closure."closure_sha256" = NEW."closure_sha256"
      AND activation."execution_id" = NEW."execution_id"
      AND activation."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND activation."restriction_lineage_sha256" =
        candidate."restriction_lineage_set_sha256"
      AND activation."output_policy_sha256" = candidate."output_policy_sha256"
      AND closure."stage_id" = NEW."stage_id"
      AND closure."source_asset_id" = NEW."source_asset_id"
      AND closure."source_asset_sha256" = NEW."source_asset_sha256"
      AND reservation."id" = NEW."reservation_id"
      AND reservation."reservation_sha256" = NEW."reservation_sha256"
      AND reservation."attempt_id" = NEW."attempt_id"
      AND reservation."attempt_ordinal" = NEW."attempt_ordinal"
      AND reservation."fencing_token" = NEW."fencing_token"
      AND reservation."stage_id" = NEW."stage_id"
      AND reservation."source_asset_id" = NEW."source_asset_id"
      AND reservation."source_asset_sha256" = NEW."source_asset_sha256"
      AND reservation."output_slot" = NEW."output_slot"
      AND reservation."output_filename" = NEW."output_filename"
      AND reservation."storage_profile_id" = NEW."storage_profile_id"
      AND reservation."storage_profile_version" = NEW."storage_profile_version"
      AND reservation."storage_profile_sha256" = NEW."storage_profile_sha256"
      AND reservation."output_prefix" = NEW."output_prefix"
      AND reservation."bucket" = NEW."bucket"
      AND reservation."object_key" = NEW."object_key"
      AND attempt."attempt_ordinal" = NEW."attempt_ordinal"
      AND attempt."fencing_token" = NEW."fencing_token"
      AND profile."profile_id" = NEW."storage_profile_id"
      AND profile."profile_version" = NEW."storage_profile_version"
      AND profile."profile_sha256" = NEW."storage_profile_sha256"
      AND profile."bucket" = NEW."bucket"
      AND submit_grant."id" = NEW."submit_grant_id"
      AND submit_grant."activation_id" = NEW."activation_id"
      AND submit_grant."closure_id" = NEW."closure_id"
      AND submit_grant."closure_sha256" = NEW."closure_sha256"
      AND submit_grant."execution_id" = NEW."execution_id"
      AND submit_grant."attempt_id" = NEW."attempt_id"
      AND submit_grant."attempt_ordinal" = NEW."attempt_ordinal"
      AND submit_grant."fencing_token" = NEW."fencing_token"
      AND submit_grant."provider_command_id" = NEW."submit_command_id"
      AND submit_grant."claim_token" = NEW."submit_claim_token"
      AND submit_grant."claimed_by" = NEW."submit_claimed_by"
      AND submit_grant."executor_workload_identity_sha256" =
        NEW."executor_workload_identity_sha256"
      AND submit_grant."submit_gateway_workload_identity_sha256" =
        NEW."submit_gateway_workload_identity_sha256"
      AND submit_redemption."id" = NEW."submit_redemption_id"
      AND submit_redemption."activation_id" = NEW."activation_id"
      AND submit_redemption."fencing_token" = NEW."fencing_token"
      AND submit_redemption."invocation_event_id" = NEW."invocation_event_id"
      AND submit_redemption."provider_command_id" = NEW."submit_command_id"
      AND submit_redemption."claim_token" = NEW."submit_claim_token"
      AND submit_redemption."claimed_by" = NEW."submit_claimed_by"
      AND submit_redemption."invocation_event_id" =
        submit_grant."planned_invocation_event_id"
      AND invocation."event_kind" = 'provider_invocation_started'
      AND invocation."provider_command_id" = NEW."submit_command_id"
      AND invocation."provider_command_kind" = 'provider_submit'
      AND invocation."claim_token" = NEW."submit_claim_token"
      AND invocation."actor_kind" = 'service'
      AND invocation."actor_key" = NEW."submit_claimed_by"
      AND broker_auth."id" = NEW."broker_authorization_id"
      AND broker_auth."activation_id" = NEW."activation_id"
      AND broker_auth."workload_identity_sha256" =
        NEW."broker_workload_identity_sha256"
      AND broker_auth."capability_sha256" = NEW."capability_sha256"
      AND broker_use."id" = NEW."broker_object_use_id"
      AND broker_use."activation_id" = NEW."activation_id"
      AND broker_use."attempt_id" = NEW."attempt_id"
      AND broker_use."fencing_token" = NEW."fencing_token"
      AND broker_use."reservation_id" = NEW."reservation_id"
      AND broker_use."reservation_sha256" = NEW."reservation_sha256"
      AND broker_use."closure_id" = NEW."closure_id"
      AND broker_use."capability_token_sha256" = NEW."capability_sha256"
      AND broker_use."bucket" = NEW."bucket"
      AND broker_use."object_key" = NEW."object_key"
      AND custodian_auth."id" = NEW."custodian_authorization_id"
      AND custodian_auth."reservation_id" = NEW."reservation_id"
      AND custodian_auth."activation_id" = NEW."activation_id"
      AND custodian_auth."closure_id" = NEW."closure_id"
      AND custodian_auth."broker_object_use_id" = NEW."broker_object_use_id"
      AND custodian_auth."workload_identity_sha256" =
        NEW."custodian_workload_identity_sha256"
      AND custodian_auth."create_receipt_id" = NEW."create_receipt_id"
      AND custodian_auth."create_receipt_sha256" = NEW."create_receipt_sha256"
      AND custodian_auth."bucket" = NEW."bucket"
      AND custodian_auth."object_key" = NEW."object_key"
      AND custodian_auth."object_version" = NEW."object_version"
      AND custodian_auth."planned_read_receipt_id" = NEW."read_receipt_id"
      AND command."claim_token" = NEW."submit_claim_token"
      AND command."claimed_by" = NEW."submit_claimed_by"
      AND command."command_kind" = 'provider_submit'
      AND result_command."execution_id" = NEW."execution_id"
      AND result_command."attempt_id" = NEW."attempt_id"
      AND result_command."fencing_token" = NEW."fencing_token"
      AND result_sidecar."closure_id" = NEW."closure_id"
      AND result_sidecar."closure_sha256" = NEW."closure_sha256"
      AND observation."execution_id" = NEW."execution_id"
      AND observation."attempt_id" = NEW."attempt_id"
      AND observation."fencing_token" = NEW."fencing_token"
      AND classification."observation_id" = observation."id"
      AND classification."provider_command_id" = result_command."id"
      AND classification."completion_event_id" = NEW."completion_event_id"
      AND completion."event_kind" = 'provider_command_completed'
      AND completion."provider_command_id" = result_command."id"
      AND completion."execution_id" = NEW."execution_id"
      AND completion."attempt_id" = NEW."attempt_id"
      AND completion."fencing_token" = NEW."fencing_token"
  ) INTO structural_ok;

  IF structural_ok IS DISTINCT FROM true THEN
    event_value := public."fdv1_security_event_json"(
      'foundry_derivative_output_custody_v1', NEW."id"::text,
      'custody_identity_envelope_denied', NEW."bucket" || '/' || NEW."object_key",
      correlation_value, database_now
    );
    event_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-quarantine-security-event.v1', event_value
    );
    INSERT INTO public."foundry_derivative_quarantine_security_events_v1"(
      "id", "event_sha256", "event_kind", "severity", "state", "offending_table",
      "offending_row_id", "reason_code", "namespace_identity", "custody_id",
      "activation_id", "execution_id", "attempt_id", "fencing_token", "actor_kind",
      "actor_key", "correlation_id", "event_json", "recorded_at"
    ) VALUES (
      security_id_value, event_sha, 'quarantine_security_event', 'critical', 'detected',
      'foundry_derivative_output_custody_v1', NEW."id"::text,
      'custody_identity_envelope_denied', NEW."bucket" || '/' || NEW."object_key",
      NEW."id", NEW."activation_id", NEW."execution_id", NEW."attempt_id",
      NEW."fencing_token", 'system', 'system:foundry-derivative-quarantine-guard',
      correlation_value, event_value, database_now
    ) ON CONFLICT DO NOTHING
    RETURNING "id", "event_sha256" INTO security_id_value, event_sha;
    IF NOT FOUND THEN
      SELECT prior."id", prior."event_sha256"
      INTO security_id_value, event_sha
      FROM public."foundry_derivative_quarantine_security_events_v1" prior
      WHERE prior."offending_table" = 'foundry_derivative_output_custody_v1'
        AND prior."offending_row_id" = NEW."id"::text
        AND prior."reason_code" = 'custody_identity_envelope_denied'
        AND prior."custody_id" = NEW."id"
        AND prior."namespace_identity" = NEW."bucket" || '/' || NEW."object_key"
      LIMIT 1;
    END IF;
    PERFORM public."fdv1_append_security_containment"(
      NEW."activation_id", NEW."execution_id", NEW."attempt_id", NEW."fencing_token",
      security_id_value, event_sha, correlation_value, database_now
    );
    RETURN NULL;
  END IF;

  -- The trigger owns every decision/time leaf.  External receipts contribute
  -- only their bounded verifier proof; identities and DB instants are rebuilt
  -- from the locked relational chain.
  SELECT observation."worker_observed_at", broker_use."authorized_at"
  INTO worker_time, broker_time
  FROM public."foundry_provider_command_result_observations" observation
  JOIN public."foundry_derivative_broker_object_uses_v1" broker_use
    ON broker_use."id" = NEW."broker_object_use_id"
  WHERE observation."id" = NEW."result_observation_id";
  NEW."worker_observed_at" := worker_time;
  NEW."broker_authorized_at" := broker_time;
  NEW."custodian_read_at" := database_now;
  NEW."committed_at" := database_now;
  SELECT candidate."restriction_lineage_set_json",
         candidate."restriction_lineage_set_sha256",
         candidate."output_policy_sha256"
  INTO NEW."restriction_lineage_json", NEW."restriction_lineage_sha256",
       NEW."output_policy_sha256"
  FROM public."foundry_derivative_execution_activations_v1" activation
  JOIN public."foundry_derivative_execution_authorization_candidates_v1" candidate
    ON candidate."id" = activation."candidate_id"
  WHERE activation."id" = NEW."activation_id";

  proof_value := NEW."read_receipt_json"->'glbProof';
  expected_read_receipt := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-exact-version-read-receipt.v1',
    'readReceiptId', NEW."read_receipt_id"::text,
    'custodianAuthorizationId', NEW."custodian_authorization_id"::text,
    'bucket', NEW."bucket",
    'objectKey', NEW."object_key",
    'objectVersion', NEW."object_version",
    'etag', NEW."etag",
    'rawSha256', NEW."raw_sha256"::text,
    'prefixedSha256', NEW."prefixed_sha256",
    'byteLength', NEW."byte_length"::text,
    'mediaType', NEW."media_type",
    'suffix', NEW."suffix",
    'workloadIdentitySha256', NEW."custodian_workload_identity_sha256",
    'observedAt', public."fdv1_time_text"(NEW."custodian_read_at"),
    'glbProof', jsonb_build_object(
      'magic', NEW."glb_magic"::text,
      'version', NEW."glb_version"::text,
      'declaredLength', NEW."glb_declared_length"::text,
      'chunkHeadersValid', proof_value->'chunkHeadersValid',
      'chunkBoundsValid', proof_value->'chunkBoundsValid',
      'alignmentValid', proof_value->'alignmentValid',
      'jsonChunkPresent', proof_value->'jsonChunkPresent',
      'noOverlaps', proof_value->'noOverlaps',
      'noTrailingBytes', proof_value->'noTrailingBytes'
    )
  );
  NEW."read_receipt_json" := expected_read_receipt;
  NEW."read_receipt_sha256" := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-exact-version-read-receipt.v1',
    expected_read_receipt
  );

  expected_worker_manifest := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.derivative-normalization-worker-manifest.v1',
    'activationId', NEW."activation_id"::text,
    'closureId', NEW."closure_id"::text,
    'executionId', NEW."execution_id"::text,
    'attemptId', NEW."attempt_id"::text,
    'fencingToken', NEW."fencing_token"::text,
    'stageId', NEW."stage_id",
    'sourceAssetId', NEW."source_asset_id",
    'sourceAssetSha256', NEW."source_asset_sha256",
    'outputSlot', NEW."output_slot",
    'outputFilename', NEW."output_filename",
    'reservationId', NEW."reservation_id"::text,
    'bucket', NEW."bucket",
    'objectKey', NEW."object_key",
    'rawSha256', NEW."raw_sha256"::text,
    'prefixedSha256', NEW."prefixed_sha256",
    'byteLength', NEW."byte_length"::text,
    'mediaType', NEW."media_type",
    'suffix', NEW."suffix",
    'resultObservationId', NEW."result_observation_id"::text,
    'providerCommandOutcomeSha256', NEW."provider_command_outcome_sha256",
    'restrictionLineageSha256', NEW."restriction_lineage_sha256",
    'outputPolicySha256', NEW."output_policy_sha256",
    'workerObservedAt', public."fdv1_time_text"(NEW."worker_observed_at")
  );
  NEW."worker_manifest_sha256" := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-normalization-worker-manifest.v1',
    NEW."worker_manifest_json"
  );

  glb_ok := jsonb_typeof(proof_value) = 'object'
    AND NEW."glb_magic" = 'glTF'
    AND NEW."glb_version" = 2
    AND NEW."glb_declared_length" = NEW."byte_length"
    AND proof_value->'chunkHeadersValid' = 'true'::jsonb
    AND proof_value->'chunkBoundsValid' = 'true'::jsonb
    AND proof_value->'alignmentValid' = 'true'::jsonb
    AND proof_value->'jsonChunkPresent' = 'true'::jsonb
    AND proof_value->'noOverlaps' = 'true'::jsonb
    AND proof_value->'noTrailingBytes' = 'true'::jsonb;
  NEW."glb_structure_valid" := COALESCE(glb_ok, false);

  SELECT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_output_reservations_v1" reservation
    JOIN public."foundry_derivative_submit_once_grants_v1" submit_grant
      ON submit_grant."id" = NEW."submit_grant_id"
    JOIN public."foundry_derivative_submit_once_redemptions_v1" submit_redemption
      ON submit_redemption."id" = NEW."submit_redemption_id"
     AND submit_redemption."grant_id" = submit_grant."id"
    JOIN public."foundry_provider_commands" submit_command
      ON submit_command."id" = NEW."submit_command_id"
    JOIN public."foundry_execution_events" invocation
      ON invocation."id" = NEW."invocation_event_id"
    JOIN public."foundry_derivative_output_broker_authorizations_v1" broker_auth
      ON broker_auth."id" = NEW."broker_authorization_id"
    JOIN public."foundry_derivative_broker_object_uses_v1" broker_use
      ON broker_use."id" = NEW."broker_object_use_id"
    JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
      ON profile."profile_id" = reservation."storage_profile_id"
     AND profile."profile_version" = reservation."storage_profile_version"
     AND profile."profile_sha256" = reservation."storage_profile_sha256"
    JOIN public."foundry_derivative_output_custodian_authorizations_v1" custodian_auth
      ON custodian_auth."id" = NEW."custodian_authorization_id"
    WHERE reservation."id" = NEW."reservation_id"
      AND submit_command."claim_token" = NEW."submit_claim_token"
      AND submit_command."claimed_by" = NEW."submit_claimed_by"
      AND submit_command."claimed_at" <= submit_redemption."redeemed_at"
      AND submit_grant."issued_at" <= submit_redemption."redeemed_at"
      AND submit_redemption."redeemed_at" < submit_grant."expires_at"
      AND submit_redemption."redeemed_at" < submit_grant."authority_not_after"
      AND invocation."recorded_at" = submit_redemption."redeemed_at"
      AND broker_auth."issued_at" <= broker_use."authorized_at"
      AND broker_use."authorized_at" < broker_auth."expires_at"
      AND broker_use."authorized_at" < broker_auth."credential_expires_at"
      AND broker_use."authorized_at" < reservation."expires_at"
      AND broker_use."authorized_at" < profile."expires_at"
      AND broker_use."authorized_at" < broker_use."put_not_after"
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_output_broker_authorization_revocations_v1" revoked
        WHERE revoked."authorization_id" = broker_auth."id"
          AND revoked."recorded_at" <= broker_use."authorized_at"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
        WHERE revoked."profile_id" = profile."profile_id"
          AND revoked."profile_version" = profile."profile_version"
          AND revoked."recorded_at" <= broker_use."authorized_at"
      )
      AND custodian_auth."valid_from" <= NEW."custodian_read_at"
      AND NEW."custodian_read_at" < custodian_auth."expires_at"
      AND profile."valid_from" <= NEW."custodian_read_at"
      AND NEW."custodian_read_at" < profile."expires_at"
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_custodian_auth_revocations_v1" revoked
        WHERE revoked."authorization_id" = custodian_auth."id"
          AND revoked."recorded_at" <= NEW."custodian_read_at"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_quarantine_storage_profile_revocations_v1" revoked
        WHERE revoked."profile_id" = profile."profile_id"
          AND revoked."profile_version" = profile."profile_version"
          AND revoked."recorded_at" <= NEW."custodian_read_at"
      )
  ) INTO action_history_ok;

  SELECT EXISTS (
    SELECT 1
    FROM public."foundry_derivative_execution_activations_v1" activation
    JOIN public."foundry_derivative_execution_authorization_candidates_v1" candidate
      ON candidate."id" = activation."candidate_id"
    JOIN public."foundry_derivative_output_reservations_v1" reservation
      ON reservation."id" = NEW."reservation_id"
    JOIN public."foundry_derivative_broker_object_uses_v1" broker_use
      ON broker_use."id" = NEW."broker_object_use_id"
    JOIN public."foundry_derivative_output_custodian_authorizations_v1" custodian_auth
      ON custodian_auth."id" = NEW."custodian_authorization_id"
    WHERE activation."id" = NEW."activation_id"
      AND broker_use."local_sha256" = NEW."prefixed_sha256"
      AND broker_use."local_byte_length" = NEW."byte_length"
      AND custodian_auth."create_receipt_json"->>'createReceiptId' =
        NEW."create_receipt_id"::text
      AND custodian_auth."create_receipt_json"->>'uploadOperationId' =
        broker_use."upload_operation_id"::text
      AND custodian_auth."create_receipt_json"->>'bucket' = NEW."bucket"
      AND custodian_auth."create_receipt_json"->>'objectKey' = NEW."object_key"
      AND custodian_auth."create_receipt_json"->>'objectVersion' = NEW."object_version"
      AND custodian_auth."create_receipt_json"->>'etag' = NEW."etag"
      AND custodian_auth."create_receipt_sha256" =
        public."foundry_ecmascript_domain_jsonb_sha256"(
          'omnitwin.foundry.derivative-object-create-receipt.v1',
          custodian_auth."create_receipt_json"
        )
      AND NEW."worker_manifest_json" = expected_worker_manifest
      AND NEW."restriction_lineage_json" = candidate."restriction_lineage_set_json"
      AND NEW."restriction_lineage_sha256" = candidate."restriction_lineage_set_sha256"
      AND NEW."output_policy_sha256" = candidate."output_policy_sha256"
      AND NEW."prefixed_sha256" = 'sha256:' || NEW."raw_sha256"::text
      AND NEW."media_type" = 'model/gltf-binary'
      AND NEW."suffix" = '.glb'
      AND action_history_ok
  ) INTO content_ok;
  NEW."content_valid" := COALESCE(content_ok, false);

  SELECT EXISTS (
    SELECT 1
    FROM public."foundry_provider_command_result_observations" observation
    JOIN public."foundry_provider_commands" result_command
      ON result_command."id" = observation."provider_command_id"
    JOIN public."foundry_attempts" attempt
      ON attempt."id" = result_command."attempt_id"
    JOIN public."foundry_execution_events" completion
      ON completion."id" = NEW."completion_event_id"
    JOIN public."foundry_provider_command_result_classifications" classification
      ON classification."id" = NEW."result_classification_id"
    JOIN public."foundry_derivative_recovery_call_redemptions_v1" recovery_redemption
      ON recovery_redemption."call_event_id" = observation."invocation_event_id"
    JOIN public."foundry_derivative_recovery_call_grants_v1" recovery_grant
      ON recovery_grant."id" = recovery_redemption."grant_id"
    WHERE observation."id" = NEW."result_observation_id"
      AND result_command."execution_id" = NEW."execution_id"
      AND result_command."attempt_id" = NEW."attempt_id"
      AND result_command."fencing_token" = NEW."fencing_token"
      AND result_command."command_kind" IN ('provider_poll', 'provider_reconcile')
      AND result_command."state" = 'succeeded'
      AND result_command."provider_lifecycle_state" = 'exited'
      AND result_command."provider_command_ref" = attempt."provider_execution_ref"
      AND (
        (result_command."command_kind" = 'provider_reconcile'
          AND (result_command."target_provider_ref" IS NULL
            OR result_command."target_provider_ref" = attempt."provider_execution_ref"))
        OR (result_command."command_kind" = 'provider_poll'
          AND result_command."target_provider_ref" = attempt."provider_execution_ref")
      )
      AND result_command."outcome_sha256" = NEW."provider_command_outcome_sha256"
      AND completion."event_kind" = 'provider_command_completed'
      AND completion."provider_command_id" = result_command."id"
      AND completion."provider_command_kind" = result_command."command_kind"
      AND completion."claim_token" = result_command."claim_token"
      AND completion."provider_command_state" = 'succeeded'
      AND completion."provider_lifecycle_state" = 'exited'
      AND completion."provider_was_invoked"
      AND completion."provider_command_outcome_sha256" = result_command."outcome_sha256"
      AND classification."observation_id" = observation."id"
      AND classification."provider_command_id" = result_command."id"
      AND classification."completion_event_id" = completion."id"
      AND classification."terminal_outcome_sha256" = result_command."outcome_sha256"
      AND classification."disposition" = 'already_authoritative'
      AND attempt."state" = 'validating'
      AND NOT attempt."cancel_requested"
      AND recovery_grant."provider_command_id" = result_command."id"
      AND recovery_grant."claim_token" = result_command."claim_token"
      AND recovery_grant."fencing_token" = result_command."fencing_token"
      AND recovery_grant."call_kind" = result_command."command_kind"
      AND recovery_redemption."provider_command_id" = result_command."id"
      AND recovery_redemption."claim_token" = result_command."claim_token"
      AND recovery_redemption."fencing_token" = result_command."fencing_token"
      AND recovery_redemption."call_kind" = result_command."command_kind"
      AND observation."worker_observed_at" = NEW."worker_observed_at"
  ) INTO result_ok;
  NEW."result_valid" := COALESCE(result_ok, false);

  NEW."public_reverse_scan_clear" := true;
  FOR public_match IN
    SELECT *
    FROM public."fdv1_public_match_for_namespace"(
      NEW."bucket", NEW."output_prefix", NEW."raw_sha256"::text,
      NEW."prefixed_sha256"
    )
  LOOP
    NEW."public_reverse_scan_clear" := false;
    security_id_value := gen_random_uuid();
    event_value := public."fdv1_security_event_json"(
      public_match.table_name, public_match.row_identity,
      'custody_public_reverse_scan_match', public_match.reference_value,
      correlation_value, database_now
    );
    event_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.derivative-quarantine-security-event.v1', event_value
    );
    INSERT INTO public."foundry_derivative_quarantine_security_events_v1"(
      "id", "event_sha256", "event_kind", "severity", "state", "offending_table",
      "offending_row_id", "reason_code", "namespace_identity", "custody_id",
      "activation_id", "execution_id", "attempt_id", "fencing_token", "actor_kind",
      "actor_key", "correlation_id", "event_json", "recorded_at"
    ) VALUES (
      security_id_value, event_sha, 'quarantine_security_event', 'critical', 'detected',
      public_match.table_name, public_match.row_identity,
      'custody_public_reverse_scan_match', public_match.reference_value, NEW."id",
      NEW."activation_id", NEW."execution_id", NEW."attempt_id", NEW."fencing_token",
      'system', 'system:foundry-derivative-quarantine-guard', correlation_value,
      event_value, database_now
    ) ON CONFLICT DO NOTHING
    RETURNING "id", "event_sha256" INTO security_id_value, event_sha;
    IF NOT FOUND THEN
      SELECT prior."id", prior."event_sha256"
      INTO security_id_value, event_sha
      FROM public."foundry_derivative_quarantine_security_events_v1" prior
      WHERE prior."offending_table" = public_match.table_name
        AND prior."offending_row_id" IS NOT DISTINCT FROM public_match.row_identity
        AND prior."reason_code" = 'custody_public_reverse_scan_match'
        AND prior."custody_id" = NEW."id"
        AND prior."namespace_identity" IS NOT DISTINCT FROM public_match.reference_value
      LIMIT 1;
    END IF;
    PERFORM public."fdv1_append_security_containment"(
      NEW."activation_id", NEW."execution_id", NEW."attempt_id", NEW."fencing_token",
      security_id_value, event_sha, correlation_value, database_now
    );
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public."foundry_derivative_output_custody_v1" prior
    WHERE prior."activation_id" = NEW."activation_id"
      AND prior."output_slot" = NEW."output_slot"
      AND prior."content_valid" AND prior."result_valid"
      AND prior."glb_structure_valid" AND prior."public_reverse_scan_clear"
      AND (prior."object_version" <> NEW."object_version"
        OR prior."prefixed_sha256" <> NEW."prefixed_sha256")
  ) INTO has_conflict;

  SELECT EXISTS (
    SELECT 1
    FROM public."fdv1_current_epoch"(database_now) epoch
    JOIN public."foundry_derivative_execution_activations_v1" activation
      ON activation."id" = NEW."activation_id"
     AND activation."epoch_generation" = epoch.generation
     AND activation."epoch_sha256" = epoch.epoch_sha256
    JOIN public."foundry_derivative_execution_authorization_candidates_v1" candidate
      ON candidate."id" = activation."candidate_id"
     AND candidate."candidate_sha256" = activation."candidate_sha256"
    JOIN public."foundry_derivative_rights_registry_attestations_v1" attestation
      ON attestation."id" = activation."attestation_id"
    JOIN public."foundry_derivative_rights_approvals" approval
      ON approval."approval_id" = activation."approval_id"
     AND approval."approval_id" = attestation."approval_id"
    JOIN public."foundry_derivative_executor_authorizations_v1" executor
      ON executor."id" = activation."executor_authorization_id"
     AND executor."authorization_sha256" = activation."executor_authorization_sha256"
    JOIN public."foundry_derivative_output_reservations_v1" reservation
      ON reservation."id" = NEW."reservation_id"
     AND reservation."activation_id" = activation."id"
    JOIN public."foundry_derivative_quarantine_storage_profiles_v1" profile
      ON profile."profile_id" = reservation."storage_profile_id"
     AND profile."profile_version" = reservation."storage_profile_version"
     AND profile."profile_sha256" = reservation."storage_profile_sha256"
    JOIN public."foundry_derivative_output_broker_authorizations_v1" broker_auth
      ON broker_auth."id" = NEW."broker_authorization_id"
    JOIN public."foundry_derivative_output_custodian_authorizations_v1" custodian_auth
      ON custodian_auth."id" = NEW."custodian_authorization_id"
    JOIN public."foundry_executions" execution
      ON execution."id" = activation."execution_id"
    JOIN public."foundry_attempts" attempt
      ON attempt."id" = NEW."attempt_id"
     AND attempt."execution_id" = activation."execution_id"
     AND attempt."fencing_token" = NEW."fencing_token"
    WHERE epoch.variant = 'enabled_release' AND epoch.enabled
      AND activation."epoch_effective_at" = epoch.effective_at
      AND activation."epoch_enabled" = epoch.enabled
      AND activation."authority_not_after" > database_now
      AND attestation."approval_id" = approval."approval_id"
      AND attestation."derivative_rights_approval_sha256" =
        approval."derivative_rights_approval_sha256"
      AND attestation."policy_version" = approval."policy_version"
      AND attestation."policy_definition_sha256" = approval."policy_definition_sha256"
      AND attestation."policy_generation" = approval."policy_generation"
      AND approval."expires_at" > database_now
      AND approval."policy_generation" =
        public."fdv1_current_derivative_generation"(
          approval."policy_version", database_now
        )
      AND attestation."approval_expires_at" > database_now
      AND executor."valid_from" <= database_now
      AND executor."expires_at" > database_now
      AND execution."rights_policy_generation" =
        public."fdv1_current_base_generation"(
          execution."rights_policy_version", database_now
        )
      AND public."foundry_execution_authority_is_current"(
        execution."id", database_now
      ) IS TRUE
      AND public."foundry_rights_policy_is_active"(
        execution."rights_policy_version",
        execution."rights_policy_definition_sha256",
        execution."rights_policy_generation",
        database_now
      ) IS TRUE
      AND attempt."state" = 'validating'
      AND NOT attempt."cancel_requested"
      AND result_ok
      AND NOT EXISTS (
        SELECT 1 FROM public."foundry_derivative_execution_activation_revocations_v1" revoked
        WHERE revoked."activation_id" = activation."id"
          AND revoked."recorded_at" <= database_now
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_rights_registry_attestation_revocations_v1" revoked
        WHERE revoked."attestation_id" = attestation."id"
          AND revoked."revoked_at" <= database_now
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_executor_authorization_revocations_v1" revoked
        WHERE revoked."authorization_id" = executor."id"
          AND revoked."recorded_at" <= database_now
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."foundry_derivative_execution_containment_events_v1" containment
        WHERE containment."activation_id" = activation."id"
          AND containment."attempt_id" = attempt."id"
          AND containment."fencing_token" = attempt."fencing_token"
          AND containment."recorded_at" <= database_now
      )
  ) INTO authority_current;
  NEW."authority_current" := COALESCE(authority_current, false);

  IF NOT NEW."content_valid" OR NOT NEW."result_valid"
     OR NOT NEW."glb_structure_valid" OR NOT NEW."public_reverse_scan_clear" THEN
    NEW."disposition" := 'quarantined_invalid';
  ELSIF has_conflict THEN
    NEW."disposition" := 'quarantined_conflict';
  ELSIF NOT NEW."authority_current" THEN
    NEW."disposition" := 'quarantined_late_authority';
  ELSE
    NEW."disposition" := 'quarantined_current_authority';
  END IF;
  NEW."release_authorized" := false;
  NEW."signing_authorized" := false;
  NEW."publication_authorized" := false;
  NEW."redistribution_authorized" := false;
  NEW."public_serving_authorized" := false;
  NEW."runtime_promotion_authorized" := false;
  RETURN NEW;
END;
$$;

ALTER TABLE "foundry_stop_intents"
  DROP CONSTRAINT "foundry_stop_intent_reason_mapping";
ALTER TABLE "foundry_stop_intents"
  ADD CONSTRAINT "foundry_stop_intent_reason_mapping" CHECK (
    CASE "reason_code"
      WHEN 'operator_cancel' THEN
        "priority" = 200 AND "target_terminal_state" = 'terminal_cancelled'
        AND "source_kind" = 'operator_request'
      WHEN 'kill_global' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_provider' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_project' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_execution' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_attempt' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'rights_revoked' THEN
        "priority" = 450 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'rights_policy_revocation'
      WHEN 'cost_hard_stop' THEN
        "priority" = 400 AND "target_terminal_state" = 'terminal_budget_exceeded'
        AND "source_kind" = 'cost_observation'
      WHEN 'wall_clock_deadline' THEN
        "priority" = 300 AND "target_terminal_state" = 'terminal_cancelled'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'cancel_deadline' THEN
        "priority" = 325 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'termination_deadline' THEN
        "priority" = 350 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'worker_self_deadline' THEN
        "priority" = 375 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'provider_ttl_deadline' THEN
        "priority" = 425 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'checkpoint_effect_unknown' THEN
        "priority" = 390 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'provider_command'
      WHEN 'derivative_authority_revoked' THEN
        "priority" = 475 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'derivative_authority_event'
      WHEN 'derivative_authority_expired' THEN
        "priority" = 475 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'derivative_authority_event'
      WHEN 'derivative_quarantine_breach' THEN
        "priority" = 490 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'derivative_authority_event'
      ELSE false
    END
  );

CREATE OR REPLACE FUNCTION "guard_foundry_stop_intent"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  intent_now timestamptz;
  attempt_state varchar(40);
  wall_clock_deadline timestamptz;
  cancel_deadline timestamptz;
  termination_deadline timestamptz;
  worker_self_deadline timestamptz;
  provider_ttl_deadline timestamptz;
  selected_deadline timestamptz;
  submit_invoked boolean;
  source_ok boolean;
  source_scope varchar(20);
  source_digest varchar(71);
  source_recorded_at timestamptz;
  source_actor_kind varchar(30);
  source_actor_key varchar(160);
  source_actor_user_id uuid;
  source_correlation_id uuid;
  containment_source_kind varchar(80);
  expected_derivative_reason text;
BEGIN
  PERFORM public."fdv1_lock_root"();
  PERFORM public."foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  intent_now := date_trunc('milliseconds', clock_timestamp());
  NEW."recorded_at" := intent_now;
  SELECT a."state", a."wall_clock_deadline", a."cancel_deadline",
         a."termination_deadline", a."worker_self_deadline", a."provider_ttl_deadline"
  INTO attempt_state, wall_clock_deadline, cancel_deadline,
       termination_deadline, worker_self_deadline, provider_ttl_deadline
  FROM public."foundry_attempts" a
  JOIN public."foundry_executions" e ON e."id" = a."execution_id"
  WHERE a."id" = NEW."attempt_id" AND a."execution_id" = NEW."execution_id"
    AND a."project_id" = NEW."project_id" AND a."job_id" = NEW."job_id"
    AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND a."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND a."provider_kind" = NEW."provider_kind"
    AND a."provider_adapter_id" = NEW."provider_adapter_id"
    AND a."provider_adapter_version" = NEW."provider_adapter_version"
    AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND a."attempt_ordinal" = NEW."attempt_ordinal"
    AND a."fencing_token" = NEW."fencing_token"
    AND e."fencing_token" = NEW."fencing_token"
  FOR UPDATE OF a, e;
  IF NOT FOUND OR left(attempt_state, 9) = 'terminal_' THEN
    RAISE EXCEPTION 'stop intent requires the exact live fenced attempt'
      USING ERRCODE = '55000';
  END IF;

  CASE NEW."source_kind"
    WHEN 'operator_request' THEN
      IF NEW."reason_code" <> 'operator_cancel' OR NEW."actor_kind" <> 'operator' THEN
        RAISE EXCEPTION 'operator stop intent requires an authenticated operator cancellation source'
          USING ERRCODE = '23514';
      END IF;
      SELECT true, ev."request_digest", ev."recorded_at", ev."actor_kind",
             ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_kind,
           source_actor_key, source_actor_user_id
      FROM public."foundry_execution_events" ev
      WHERE ev."id" = NEW."source_id" AND ev."execution_id" = NEW."execution_id"
        AND ev."attempt_id" = NEW."attempt_id" AND ev."fencing_token" = NEW."fencing_token"
        AND ev."event_kind" = 'operator_cancel_requested' AND NOT ev."advances_projection"
        AND ev."payload"->>'reasonCode' = NEW."reason_code";
      IF source_ok IS DISTINCT FROM true OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'operator stop intent does not exactly bind its append-only cancellation request'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'runtime_watchdog' THEN
      IF NEW."actor_kind" NOT IN ('service', 'watchdog', 'system') THEN
        RAISE EXCEPTION 'runtime stop intent requires a trusted watchdog actor'
          USING ERRCODE = '23514';
      END IF;
      selected_deadline := CASE NEW."reason_code"
        WHEN 'wall_clock_deadline' THEN wall_clock_deadline
        WHEN 'cancel_deadline' THEN cancel_deadline
        WHEN 'termination_deadline' THEN termination_deadline
        WHEN 'worker_self_deadline' THEN worker_self_deadline
        WHEN 'provider_ttl_deadline' THEN provider_ttl_deadline
        ELSE NULL
      END;
      IF selected_deadline IS NULL OR selected_deadline > intent_now THEN
        RAISE EXCEPTION 'runtime stop intent cannot precede its exact immutable deadline'
          USING ERRCODE = '55000';
      END IF;
      SELECT true, ev."request_digest", ev."recorded_at", ev."actor_kind",
             ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_kind,
           source_actor_key, source_actor_user_id
      FROM public."foundry_execution_events" ev
      WHERE ev."id" = NEW."source_id" AND ev."execution_id" = NEW."execution_id"
        AND ev."attempt_id" = NEW."attempt_id" AND ev."fencing_token" = NEW."fencing_token"
        AND ev."event_kind" = 'runtime_deadline_elapsed' AND NOT ev."advances_projection"
        AND ev."payload"->>'reasonCode' = NEW."reason_code"
        AND (ev."payload"->>'deadline')::timestamptz IS NOT DISTINCT FROM selected_deadline;
      IF source_ok IS DISTINCT FROM true OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'runtime stop intent does not exactly bind its elapsed-deadline event'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'kill_switch_event' THEN
      SELECT true, k."scope", ev."request_digest", ev."recorded_at",
             ev."actor_kind", ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_scope, source_digest, source_recorded_at,
           source_actor_kind, source_actor_key, source_actor_user_id
      FROM public."foundry_kill_switch_events" ev
      JOIN public."foundry_kill_switches" k ON k."id" = ev."kill_switch_id"
      WHERE ev."id" = NEW."source_id" AND ev."action" = 'activate'
        AND ev."resulting_revision" = k."revision" AND k."state" = 'active'
        AND (
          k."scope" = 'global'
          OR (k."scope" = 'provider' AND k."provider_kind" = NEW."provider_kind"
            AND k."provider_adapter_id" = NEW."provider_adapter_id"
            AND k."provider_adapter_version" = NEW."provider_adapter_version")
          OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
          OR (k."scope" = 'execution' AND k."execution_id" = NEW."execution_id")
          OR (k."scope" = 'attempt' AND k."attempt_id" = NEW."attempt_id")
        );
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" IS DISTINCT FROM 'kill_' || source_scope
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'kill stop intent does not exactly bind the active kill-switch event and scope'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'rights_policy_revocation' THEN
      SELECT true, r."request_digest", r."recorded_at", r."revoked_by_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_user_id
      FROM public."foundry_rights_policy_revocations" r
      JOIN public."foundry_executions" e
        ON e."id" = NEW."execution_id" AND e."rights_policy_version" = r."policy_version"
       AND e."rights_policy_definition_sha256" = r."policy_definition_sha256"
       AND e."rights_policy_generation" = r."policy_generation"
      WHERE r."id" = NEW."source_id";
      IF source_ok IS DISTINCT FROM true OR NEW."reason_code" <> 'rights_revoked'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" <> 'operator'
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'rights stop intent does not exactly bind its policy revocation'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'cost_observation' THEN
      SELECT true, c."request_digest", c."recorded_at", c."recorded_by"
      INTO source_ok, source_digest, source_recorded_at, source_actor_key
      FROM public."foundry_cost_observations" c
      JOIN public."foundry_executions" e ON e."id" = c."execution_id"
      WHERE c."id" = NEW."source_id" AND c."attempt_id" = NEW."attempt_id"
        AND c."fencing_token" = NEW."fencing_token"
        AND e."total_cost_micro_usd" >= e."cost_hard_stop_micro_usd";
      IF source_ok IS DISTINCT FROM true OR NEW."reason_code" <> 'cost_hard_stop'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" <> 'service' OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS NOT NULL THEN
        RAISE EXCEPTION 'cost stop intent does not exactly bind the hard-stop observation'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'provider_command' THEN
      SELECT true, c."outcome_sha256", c."completed_at",
             c."completed_by_actor_kind", c."completed_by_actor_key"
      INTO source_ok, source_digest, source_recorded_at,
           source_actor_kind, source_actor_key
      FROM public."foundry_provider_commands" c
      WHERE c."id" = NEW."source_id" AND c."execution_id" = NEW."execution_id"
        AND c."attempt_id" = NEW."attempt_id" AND c."fencing_token" = NEW."fencing_token"
        AND c."command_kind" = 'provider_checkpoint' AND c."state" = 'uncertain'
        AND c."provider_lifecycle_state" = 'unknown';
      IF source_ok IS DISTINCT FROM true OR NEW."reason_code" <> 'checkpoint_effect_unknown'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS NOT NULL THEN
        RAISE EXCEPTION 'checkpoint-unknown stop intent does not bind its terminal command'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'derivative_authority_event' THEN
      SELECT true, containment."containment_sha256", containment."recorded_at",
             containment."actor_kind", containment."actor_key",
             containment."actor_user_id", containment."correlation_id",
             containment."source_kind"
      INTO source_ok, source_digest, source_recorded_at, source_actor_kind,
           source_actor_key, source_actor_user_id, source_correlation_id,
           containment_source_kind
      FROM public."foundry_derivative_execution_containment_events_v1" containment
      WHERE containment."id" = NEW."source_id"
        AND containment."execution_id" = NEW."execution_id"
        AND containment."attempt_id" = NEW."attempt_id"
        AND containment."fencing_token" = NEW."fencing_token";
      expected_derivative_reason := CASE
        WHEN containment_source_kind = 'derivative_authority_expired'
          THEN 'derivative_authority_expired'
        WHEN containment_source_kind = 'quarantine_security_event'
          THEN 'derivative_quarantine_breach'
        ELSE 'derivative_authority_revoked'
      END;
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" IS DISTINCT FROM expected_derivative_reason
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id
         OR NEW."correlation_id" IS DISTINCT FROM source_correlation_id
         OR NEW."causation_id" IS DISTINCT FROM NEW."source_id"
         OR NEW."request_digest" IS DISTINCT FROM public."fdv1_stop_request_sha"(
           NEW."source_id", NEW."execution_id", NEW."attempt_id", NEW."fencing_token",
           NEW."reason_code", NEW."priority", NEW."target_terminal_state",
           NEW."actor_kind", NEW."actor_key", NEW."correlation_id"
         ) THEN
        RAISE EXCEPTION 'derivative stop intent does not bind its exact containment source'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported stop-intent source kind' USING ERRCODE = '23514';
  END CASE;

  SELECT EXISTS (
    SELECT 1 FROM public."foundry_execution_events" ev
    WHERE ev."attempt_id" = NEW."attempt_id" AND ev."fencing_token" = NEW."fencing_token"
      AND ev."event_kind" = 'provider_invocation_started'
      AND ev."provider_command_kind" = 'provider_submit'
  ) INTO submit_invoked;
  IF attempt_state IN ('authorized', 'validating')
     OR (attempt_state = 'submit_pending' AND NOT submit_invoked) THEN
    UPDATE public."foundry_attempts"
    SET "state" = NEW."target_terminal_state", "cancel_requested" = true,
        "finished_at" = intent_now, "revision" = "revision" + 1,
        "updated_at" = GREATEST(intent_now, "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."attempt_id" AND "fencing_token" = NEW."fencing_token";
  ELSIF attempt_state NOT IN ('stop_pending', 'terminating', 'termination_unconfirmed') THEN
    UPDATE public."foundry_attempts"
    SET "state" = 'stop_pending', "cancel_requested" = true,
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(intent_now, "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."attempt_id" AND "fencing_token" = NEW."fencing_token";
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_deferred_closure"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  relevant boolean;
BEGIN
  PERFORM public."fdv1_lock_root"();
  IF TG_TABLE_NAME = 'foundry_derivative_execution_activations_v1' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public."foundry_executions" execution
      JOIN public."foundry_execution_events" genesis
        ON genesis."execution_id" = execution."id"
       AND genesis."event_kind" = 'execution_admitted'
       AND genesis."sequence" = 1
      WHERE execution."id" = NEW."execution_id"
        AND execution."execution_subject_sha256" = NEW."execution_subject_sha256"
        AND execution."project_id" = NEW."project_id"
        AND execution."job_id" = NEW."job_id"
    ) THEN
      RAISE EXCEPTION 'activation must close bidirectionally against execution and admission genesis'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'foundry_attempts' THEN
    IF EXISTS (
      SELECT 1 FROM public."foundry_derivative_execution_activations_v1" activation
      WHERE activation."execution_id" = NEW."execution_id"
    ) AND (
      SELECT count(*) FROM public."foundry_derivative_output_reservations_v1" reservation
      WHERE reservation."execution_id" = NEW."execution_id"
        AND reservation."attempt_id" = NEW."id"
        AND reservation."fencing_token" = NEW."fencing_token"
    ) <> 1 THEN
      RAISE EXCEPTION 'derivative attempt must have exactly one output reservation'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."state" = 'terminal_succeeded'
       AND EXISTS (
         SELECT 1 FROM public."foundry_derivative_execution_activations_v1" activation
         WHERE activation."execution_id" = NEW."execution_id"
       ) AND NOT EXISTS (
         SELECT 1 FROM public."foundry_derivative_output_custody_v1" custody
         WHERE custody."execution_id" = NEW."execution_id"
           AND custody."attempt_id" = NEW."id"
           AND custody."fencing_token" = NEW."fencing_token"
           AND custody."disposition" = 'quarantined_current_authority'
           AND custody."content_valid" AND custody."result_valid"
       ) THEN
      RAISE EXCEPTION 'authoritative terminal success requires exact current custody'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'foundry_prepared_provider_requests' THEN
    SELECT public."foundry_classify_normalize_mesh_glb_v0_job_spec"(job."job_spec_json")
             <> 'unrelated'
    INTO relevant
    FROM public."foundry_jobs" job
    WHERE job."job_id" = NEW."job_id" AND job."project_id" = NEW."project_id";
    IF relevant AND NOT EXISTS (
      SELECT 1 FROM public."foundry_derivative_prepared_request_sidecars_v1" sidecar
      WHERE sidecar."prepared_request_id" = NEW."id"
        AND sidecar."execution_id" = NEW."execution_id"
        AND sidecar."attempt_id" = NEW."attempt_id"
        AND sidecar."fencing_token" = NEW."fencing_token"
        AND sidecar."command_kind" = NEW."command_kind"
    ) THEN
      RAISE EXCEPTION 'derivative prepared request lacks its exact sidecar'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'foundry_provider_commands' THEN
    IF EXISTS (
      SELECT 1 FROM public."foundry_derivative_provider_command_sidecars_v1" sidecar
      WHERE sidecar."provider_command_id" = NEW."id"
    ) THEN
      IF NEW."state" = 'claimed' AND NEW."command_kind" = 'provider_submit' AND (
        SELECT count(*) FROM public."foundry_derivative_submit_once_grants_v1" grant_row
        WHERE grant_row."provider_command_id" = NEW."id"
          AND grant_row."claim_token" = NEW."claim_token"
          AND grant_row."claimed_by" = NEW."claimed_by"
          AND grant_row."fencing_token" = NEW."fencing_token"
      ) <> 1 THEN
        RAISE EXCEPTION 'claimed derivative submit requires exactly one submit-once grant'
          USING ERRCODE = '23514';
      END IF;
      IF NEW."state" = 'claimed'
         AND NEW."command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop')
         AND (
           SELECT count(*) FROM public."foundry_derivative_recovery_call_grants_v1" grant_row
           WHERE grant_row."provider_command_id" = NEW."id"
             AND grant_row."claim_token" = NEW."claim_token"
             AND grant_row."claimed_by" = NEW."claimed_by"
             AND grant_row."fencing_token" = NEW."fencing_token"
         ) <> 1 THEN
        RAISE EXCEPTION 'claimed derivative recovery command requires exactly one call grant'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT public."foundry_classify_normalize_mesh_glb_v0_job_spec"(job."job_spec_json")
               <> 'unrelated'
      INTO relevant
      FROM public."foundry_jobs" job
      WHERE job."job_id" = NEW."job_id" AND job."project_id" = NEW."project_id";
      IF relevant THEN
        RAISE EXCEPTION 'derivative provider command lacks its exact pending sidecar'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'foundry_execution_events'
     AND NEW."event_kind" = 'provider_invocation_started' THEN
    SELECT EXISTS (
      SELECT 1 FROM public."foundry_derivative_provider_command_sidecars_v1" sidecar
      WHERE sidecar."provider_command_id" = NEW."provider_command_id"
    ) INTO relevant;
    IF relevant AND NEW."provider_command_kind" = 'provider_submit'
       AND NOT EXISTS (
         SELECT 1
         FROM public."foundry_derivative_submit_once_redemptions_v1" redemption
         JOIN public."foundry_derivative_submit_once_grants_v1" grant_row
           ON grant_row."id" = redemption."grant_id"
         WHERE redemption."invocation_event_id" = NEW."id"
           AND grant_row."planned_invocation_event_id" = NEW."id"
           AND redemption."provider_command_id" = NEW."provider_command_id"
       ) THEN
      RAISE EXCEPTION 'derivative submit invocation event lacks exact redemption'
        USING ERRCODE = '23514';
    ELSIF relevant
       AND NEW."provider_command_kind" IN ('provider_poll', 'provider_reconcile', 'provider_stop')
       AND NOT EXISTS (
         SELECT 1
         FROM public."foundry_derivative_recovery_call_redemptions_v1" redemption
         JOIN public."foundry_derivative_recovery_call_grants_v1" grant_row
           ON grant_row."id" = redemption."grant_id"
         WHERE redemption."call_event_id" = NEW."id"
           AND grant_row."planned_call_event_id" = NEW."id"
           AND redemption."provider_command_id" = NEW."provider_command_id"
           AND redemption."call_kind" = NEW."provider_command_kind"
       ) THEN
      RAISE EXCEPTION 'derivative recovery invocation event lacks exact redemption'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'foundry_derivative_execution_containment_events_v1' THEN
    IF NEW."source_kind" = 'global_or_scoped_kill' THEN
      relevant := EXISTS (
        SELECT 1 FROM public."foundry_stop_intents" intent
        WHERE intent."attempt_id" = NEW."attempt_id"
          AND intent."fencing_token" = NEW."fencing_token"
          AND intent."source_kind" = 'kill_switch_event'
          AND intent."priority" = 500
      );
    ELSIF NEW."source_kind" = 'base_policy_revocation' THEN
      relevant := EXISTS (
        SELECT 1 FROM public."foundry_stop_intents" intent
        WHERE intent."attempt_id" = NEW."attempt_id"
          AND intent."fencing_token" = NEW."fencing_token"
          AND intent."source_kind" = 'rights_policy_revocation'
          AND intent."reason_code" = 'rights_revoked'
      );
    ELSE
      relevant := EXISTS (
        SELECT 1 FROM public."foundry_stop_intents" intent
        WHERE intent."attempt_id" = NEW."attempt_id"
          AND intent."fencing_token" = NEW."fencing_token"
          AND intent."source_kind" = 'derivative_authority_event'
          AND intent."source_id" = NEW."id"
          AND intent."source_digest" = NEW."containment_sha256"
      );
    END IF;
    IF NOT relevant THEN
      RAISE EXCEPTION 'derivative containment lacks the exact ordered stop intent'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "fdv1_guard_future_policy"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  database_now timestamptz;
BEGIN
  PERFORM public."fdv1_lock_root"();
  database_now := date_trunc('milliseconds', clock_timestamp());
  IF NEW."effective_at" > database_now AND EXISTS (
    SELECT 1
    FROM public."foundry_derivative_execution_activations_v1" activation
    JOIN public."foundry_attempts" attempt ON attempt."execution_id" = activation."execution_id"
    WHERE left(attempt."state", 9) <> 'terminal_'
  ) THEN
    RAISE EXCEPTION 'future policy generation is denied while a derivative attempt is live'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "fdv1_deferred_source_containment"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value jsonb := to_jsonb(NEW);
  source_kind_value text;
  source_id_value text;
  source_sha_value text;
  missing_count bigint;
BEGIN
  PERFORM public."fdv1_lock_root"();
  CASE TG_TABLE_NAME
    WHEN 'foundry_derivative_rights_policy_versions' THEN
      source_kind_value := 'derivative_policy_generation_superseded';
      source_id_value := NEW."policy_version" || ':' || NEW."generation"::text;
      source_sha_value := NEW."policy_definition_sha256";
    WHEN 'foundry_derivative_rights_policy_revocations' THEN
      source_kind_value := 'derivative_policy_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_rights_policy_versions' THEN
      source_kind_value := 'base_policy_generation_superseded';
      source_id_value := NEW."policy_version" || ':' || NEW."generation"::text;
      source_sha_value := NEW."policy_definition_sha256";
    WHEN 'foundry_rights_policy_revocations' THEN
      source_kind_value := 'base_policy_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."request_digest";
    WHEN 'foundry_derivative_rights_registry_attestation_revocations_v1' THEN
      source_kind_value := 'registry_attestation_revocation';
      source_id_value := NEW."id"::text;
      source_sha_value := NEW."attestation_revocation_sha256";
    WHEN 'foundry_derivative_executor_authorization_revocations_v1' THEN
      source_kind_value := 'executor_authorization_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_derivative_output_broker_authorization_revocations_v1' THEN
      source_kind_value := 'output_broker_authorization_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_derivative_custodian_auth_revocations_v1' THEN
      source_kind_value := 'output_custodian_authorization_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_derivative_quarantine_storage_profile_revocations_v1' THEN
      source_kind_value := 'quarantine_storage_profile_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_derivative_execution_activation_revocations_v1' THEN
      source_kind_value := 'activation_revocation';
      source_id_value := NEW."id"::text; source_sha_value := NEW."revocation_sha256";
    WHEN 'foundry_derivative_execution_activation_epochs_v1' THEN
      source_kind_value := CASE WHEN NEW."enabled"
        THEN 'activation_epoch_replaced' ELSE 'activation_epoch_disabled' END;
      source_id_value := NEW."generation"::text; source_sha_value := NEW."epoch_sha256";
    WHEN 'foundry_kill_switch_events' THEN
      source_kind_value := 'global_or_scoped_kill';
      source_id_value := NEW."id"::text; source_sha_value := NEW."request_digest";
    ELSE
      RAISE EXCEPTION 'unmapped containment source %', TG_TABLE_NAME USING ERRCODE = '23514';
  END CASE;

  SELECT count(*) INTO missing_count
  FROM public."foundry_derivative_execution_activations_v1" activation
  JOIN public."foundry_attempts" attempt ON attempt."execution_id" = activation."execution_id"
  WHERE left(attempt."state", 9) <> 'terminal_'
    AND NOT EXISTS (
      SELECT 1
      FROM public."foundry_derivative_execution_containment_events_v1" containment
      WHERE containment."activation_id" = activation."id"
        AND containment."attempt_id" = attempt."id"
        AND containment."fencing_token" = attempt."fencing_token"
        AND containment."source_kind" = source_kind_value
        AND containment."source_id" = source_id_value
        AND containment."source_sha256" = source_sha_value
    );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'authority-loss source % requires exact containment for every live derivative attempt',
      source_kind_value USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "fdv1_epoch_insert_guard"
  BEFORE INSERT ON "foundry_derivative_execution_activation_epochs_v1"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_epoch"();
CREATE TRIGGER "fdv1_closure_exact_guard"
  BEFORE INSERT ON "foundry_derivative_candidate_relational_closures_v1"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_closure"();
CREATE TRIGGER "fdv1_profile_prescan_guard"
  BEFORE INSERT ON "foundry_derivative_quarantine_storage_profiles_v1"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_profile_pre_scan"();
CREATE TRIGGER "fdv1_activation_exact_guard"
  BEFORE INSERT ON "foundry_derivative_execution_activations_v1"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_activation"();
CREATE TRIGGER "fdv1_custody_classify_guard"
  BEFORE INSERT ON "foundry_derivative_output_custody_v1"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_custody"();
CREATE TRIGGER "fdv1_command_claim_immutable_guard"
  BEFORE UPDATE ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_command_claim"();
CREATE TRIGGER "fdv1_checkpoint_insert_guard"
  BEFORE INSERT ON "foundry_verified_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_checkpoint"();
CREATE TRIGGER "fdv1_checkpoint_update_guard"
  BEFORE UPDATE ON "foundry_verified_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_checkpoint"();
CREATE TRIGGER "fdv1_derivative_future_policy_guard"
  BEFORE INSERT ON "foundry_derivative_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_future_policy"();
CREATE TRIGGER "fdv1_base_future_policy_guard"
  BEFORE INSERT ON "foundry_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "fdv1_guard_future_policy"();

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_execution_activations_v1',
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1',
    'foundry_derivative_output_reservations_v1',
    'foundry_derivative_submit_once_grants_v1',
    'foundry_derivative_submit_once_redemptions_v1',
    'foundry_derivative_recovery_authorities_v1',
    'foundry_derivative_recovery_call_grants_v1',
    'foundry_derivative_recovery_call_redemptions_v1',
    'foundry_derivative_output_broker_authorizations_v1',
    'foundry_derivative_broker_object_uses_v1',
    'foundry_derivative_output_custodian_authorizations_v1',
    'foundry_derivative_execution_containment_events_v1'
  ] LOOP
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fdv1_guard_phase_insert()',
      'fdv1_phase_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_candidate_relational_closures_v1',
    'foundry_derivative_quarantine_storage_profiles_v1',
    'foundry_derivative_quarantine_storage_profile_revocations_v1',
    'foundry_derivative_executor_authorizations_v1',
    'foundry_derivative_executor_authorization_revocations_v1',
    'foundry_derivative_output_broker_authorizations_v1',
    'foundry_derivative_output_broker_authorization_revocations_v1',
    'foundry_derivative_output_custodian_authorizations_v1',
    'foundry_derivative_custodian_auth_revocations_v1',
    'foundry_derivative_execution_activations_v1',
    'foundry_derivative_execution_activation_revocations_v1',
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1',
    'foundry_derivative_output_reservations_v1',
    'foundry_derivative_submit_once_grants_v1',
    'foundry_derivative_submit_once_redemptions_v1',
    'foundry_derivative_recovery_authorities_v1',
    'foundry_derivative_recovery_call_grants_v1',
    'foundry_derivative_recovery_call_redemptions_v1',
    'foundry_derivative_broker_object_uses_v1',
    'foundry_derivative_execution_containment_events_v1',
    'foundry_derivative_output_custody_v1',
    'foundry_derivative_quarantine_security_events_v1'
  ] LOOP
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fdv1_guard_canonical_sha()',
      'fdv1_sha_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'venues', 'spaces', 'asset_definitions', 'configurations',
    'configuration_sheet_snapshots', 'photo_references', 'files',
    'website_embed_configs', 'asset_versions', 'runtime_packages',
    'reconstruction_releases', 'reconstruction_release_qa_runs',
    'reconstruction_release_reviews', 'reconstruction_review_evidence_artifacts',
    'reconstruction_release_attestations', 'reconstruction_release_publications',
    'reconstruction_release_channels', 'reconstruction_release_channel_events'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || quote_ident(relation_name)) IS NULL THEN
      RAISE EXCEPTION 'required public denial relation % is absent', relation_name;
    END IF;
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fdv1_public_guard()',
      'fdv1_public_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

CREATE CONSTRAINT TRIGGER "fdv1_activation_deferred_closure"
  AFTER INSERT ON "foundry_derivative_execution_activations_v1"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();
CREATE CONSTRAINT TRIGGER "fdv1_attempt_deferred_closure"
  AFTER INSERT OR UPDATE ON "foundry_attempts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();
CREATE CONSTRAINT TRIGGER "fdv1_prepared_deferred_closure"
  AFTER INSERT ON "foundry_prepared_provider_requests"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();
CREATE CONSTRAINT TRIGGER "fdv1_command_deferred_closure"
  AFTER INSERT OR UPDATE ON "foundry_provider_commands"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();
CREATE CONSTRAINT TRIGGER "fdv1_event_deferred_closure"
  AFTER INSERT ON "foundry_execution_events"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();
CREATE CONSTRAINT TRIGGER "fdv1_containment_deferred_closure"
  AFTER INSERT ON "foundry_derivative_execution_containment_events_v1"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fdv1_deferred_closure"();

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_rights_policy_versions',
    'foundry_derivative_rights_policy_revocations',
    'foundry_rights_policy_versions',
    'foundry_rights_policy_revocations',
    'foundry_derivative_rights_registry_attestation_revocations_v1',
    'foundry_derivative_executor_authorization_revocations_v1',
    'foundry_derivative_output_broker_authorization_revocations_v1',
    'foundry_derivative_custodian_auth_revocations_v1',
    'foundry_derivative_quarantine_storage_profile_revocations_v1',
    'foundry_derivative_execution_activation_revocations_v1',
    'foundry_derivative_execution_activation_epochs_v1',
    'foundry_kill_switch_events'
  ] LOOP
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fdv1_deferred_source_containment()',
      'fdv1_source_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_execution_activation_epochs_v1',
    'foundry_derivative_candidate_relational_closures_v1',
    'foundry_derivative_quarantine_storage_profiles_v1',
    'foundry_derivative_quarantine_storage_profile_revocations_v1',
    'foundry_derivative_executor_authorizations_v1',
    'foundry_derivative_executor_authorization_revocations_v1',
    'foundry_derivative_output_broker_authorizations_v1',
    'foundry_derivative_output_broker_authorization_revocations_v1',
    'foundry_derivative_output_custodian_authorizations_v1',
    'foundry_derivative_custodian_auth_revocations_v1',
    'foundry_derivative_execution_activations_v1',
    'foundry_derivative_execution_activation_revocations_v1',
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1',
    'foundry_derivative_output_reservations_v1',
    'foundry_derivative_submit_once_grants_v1',
    'foundry_derivative_submit_once_redemptions_v1',
    'foundry_derivative_recovery_authorities_v1',
    'foundry_derivative_recovery_call_grants_v1',
    'foundry_derivative_recovery_call_redemptions_v1',
    'foundry_derivative_broker_object_uses_v1',
    'foundry_derivative_execution_containment_events_v1',
    'foundry_derivative_output_custody_v1',
    'foundry_derivative_quarantine_security_events_v1'
  ] LOOP
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_foundry_append_only_mutation()',
      'fdv1_immutable_' || lpad(ordinal::text, 2, '0'), relation_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION deny_foundry_append_only_mutation()',
      'fdv1_no_truncate_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  relation_name text;
  ordinal integer := 0;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_execution_activation_epochs_v1',
    'foundry_derivative_candidate_relational_closures_v1',
    'foundry_derivative_quarantine_storage_profiles_v1',
    'foundry_derivative_quarantine_storage_profile_revocations_v1',
    'foundry_derivative_executor_authorizations_v1',
    'foundry_derivative_executor_authorization_revocations_v1',
    'foundry_derivative_output_broker_authorizations_v1',
    'foundry_derivative_output_broker_authorization_revocations_v1',
    'foundry_derivative_output_custodian_authorizations_v1',
    'foundry_derivative_custodian_auth_revocations_v1',
    'foundry_derivative_execution_activations_v1',
    'foundry_derivative_execution_activation_revocations_v1',
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1',
    'foundry_derivative_output_reservations_v1',
    'foundry_derivative_submit_once_grants_v1',
    'foundry_derivative_submit_once_redemptions_v1',
    'foundry_derivative_recovery_authorities_v1',
    'foundry_derivative_recovery_call_grants_v1',
    'foundry_derivative_recovery_call_redemptions_v1',
    'foundry_derivative_broker_object_uses_v1',
    'foundry_derivative_execution_containment_events_v1',
    'foundry_derivative_output_custody_v1',
    'foundry_derivative_quarantine_security_events_v1',
    'foundry_executions', 'foundry_attempts', 'foundry_prepared_provider_requests',
    'foundry_provider_commands', 'foundry_execution_events',
    'foundry_provider_command_result_observations',
    'foundry_provider_command_result_classifications', 'foundry_stop_intents',
    'foundry_verified_checkpoints', 'foundry_derivative_rights_policy_versions',
    'foundry_derivative_rights_policy_revocations', 'foundry_rights_policy_versions',
    'foundry_rights_policy_revocations',
    'foundry_derivative_rights_registry_attestation_revocations_v1',
    'foundry_kill_switch_events', 'venues', 'spaces', 'asset_definitions',
    'configurations', 'configuration_sheet_snapshots', 'photo_references', 'files',
    'website_embed_configs', 'asset_versions', 'runtime_packages',
    'reconstruction_releases', 'reconstruction_release_qa_runs',
    'reconstruction_release_reviews', 'reconstruction_review_evidence_artifacts',
    'reconstruction_release_attestations', 'reconstruction_release_publications',
    'reconstruction_release_channels', 'reconstruction_release_channel_events'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || quote_ident(relation_name)) IS NULL THEN
      RAISE EXCEPTION 'required root-locked relation % is absent', relation_name;
    END IF;
    ordinal := ordinal + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION fdv1_root_trigger()',
      'fdv1_root_' || lpad(ordinal::text, 2, '0'), relation_name
    );
  END LOOP;
END;
$$;

-- The sole migration-authored epoch.  Its trigger replaces every placeholder
-- with the DB-time, closed not_installed bootstrap receipt and its
-- domain-separated digest.  It intentionally has no user or future 0058 SHA.
INSERT INTO "foundry_derivative_execution_activation_epochs_v1"(
  "generation", "variant", "effective_at", "enabled",
  "reject_future_generation_while_live", "disabled_reason", "epoch_json",
  "epoch_sha256", "actor_kind", "actor_key", "administrator_user_id",
  "idempotency_key", "recorded_at"
) VALUES (
  1, 'disabled_sentinel', date_trunc('milliseconds', clock_timestamp()), false,
  true, 'bootstrap', '{}'::jsonb,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  'system', 'system:foundry-derivative-bootstrap', NULL,
  'bootstrap-generation-1', date_trunc('milliseconds', clock_timestamp())
);

DO $$
DECLARE
  bootstrap_count integer;
BEGIN
  SELECT count(*) INTO bootstrap_count
  FROM "foundry_derivative_execution_activation_epochs_v1"
  WHERE "generation" = 1 AND "variant" = 'disabled_sentinel'
    AND NOT "enabled" AND "disabled_reason" = 'bootstrap'
    AND "actor_kind" = 'system'
    AND "actor_key" = 'system:foundry-derivative-bootstrap'
    AND "administrator_user_id" IS NULL
    AND NOT ("epoch_json"::text ~ 'sha256:[a-f0-9]{64}')
    AND NOT ("epoch_json" ? 'epochSha256')
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each_text("epoch_json"->'evidence') evidence
      WHERE evidence.value <> 'not_installed'
    );
  IF bootstrap_count <> 1 THEN
    RAISE EXCEPTION '0058 did not install exactly one closed disabled bootstrap epoch';
  END IF;
END;
$$;

DO $$
DECLARE
  relation_name text;
  role_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'foundry_derivative_execution_activation_epochs_v1',
    'foundry_derivative_candidate_relational_closures_v1',
    'foundry_derivative_quarantine_storage_profiles_v1',
    'foundry_derivative_quarantine_storage_profile_revocations_v1',
    'foundry_derivative_executor_authorizations_v1',
    'foundry_derivative_executor_authorization_revocations_v1',
    'foundry_derivative_output_broker_authorizations_v1',
    'foundry_derivative_output_broker_authorization_revocations_v1',
    'foundry_derivative_output_custodian_authorizations_v1',
    'foundry_derivative_custodian_auth_revocations_v1',
    'foundry_derivative_execution_activations_v1',
    'foundry_derivative_execution_activation_revocations_v1',
    'foundry_derivative_prepared_request_sidecars_v1',
    'foundry_derivative_provider_command_sidecars_v1',
    'foundry_derivative_output_reservations_v1',
    'foundry_derivative_submit_once_grants_v1',
    'foundry_derivative_submit_once_redemptions_v1',
    'foundry_derivative_recovery_authorities_v1',
    'foundry_derivative_recovery_call_grants_v1',
    'foundry_derivative_recovery_call_redemptions_v1',
    'foundry_derivative_broker_object_uses_v1',
    'foundry_derivative_execution_containment_events_v1',
    'foundry_derivative_output_custody_v1',
    'foundry_derivative_quarantine_security_events_v1'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', relation_name);
    FOREACH role_name IN ARRAY ARRAY[
      'omnitwin_api_activation', 'omnitwin_foundry_claimer',
      'omnitwin_foundry_submit_gateway', 'omnitwin_foundry_recovery_gateway',
      'omnitwin_foundry_output_broker', 'omnitwin_foundry_output_custodian',
      'omnitwin_foundry_watchdog'
    ] LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', relation_name, role_name);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION "fdv1_lock_root"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_root_trigger"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_lock_scopes"(bigint, uuid, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_epoch"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_assert_enabled"(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "assert_foundry_legacy_v0_derivative_execution_denied"(varchar, varchar, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_execution_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_attempt_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_prepared_request_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_provider_command_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_provider_command_claim"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_derivative_v0_provider_invocation_event_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_canonical_sha"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_closure"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_phase_insert"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_activation"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_command_claim"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_checkpoint"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_public_guard"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_profile_pre_scan"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_append_security_containment"(uuid, uuid, uuid, bigint, uuid, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_custody"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "guard_foundry_stop_intent"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_deferred_closure"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_guard_future_policy"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "fdv1_deferred_source_containment"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "fdv1_current_epoch"(timestamptz)
  TO "omnitwin_api_activation", "omnitwin_foundry_claimer",
     "omnitwin_foundry_submit_gateway", "omnitwin_foundry_recovery_gateway",
     "omnitwin_foundry_output_broker", "omnitwin_foundry_output_custodian",
     "omnitwin_foundry_watchdog";
GRANT EXECUTE ON FUNCTION "fdv1_next_epoch_boundary"(timestamptz)
  TO "omnitwin_api_activation", "omnitwin_foundry_watchdog";

COMMENT ON TABLE "foundry_derivative_execution_activation_epochs_v1" IS
  'Inert V1 derivative activation epochs; 0058 installs generation 1 disabled only.';
COMMENT ON TABLE "foundry_derivative_output_custody_v1" IS
  'Append-only quarantine custody evidence; never release, signing, public, or runtime authority.';
