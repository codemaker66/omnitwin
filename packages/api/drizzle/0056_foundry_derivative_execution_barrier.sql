-- Additive fail-closed barrier for the legacy V0 execution path.
--
-- This migration creates no execution authority and no mutable registry. It
-- only prevents normalize_mesh_glb/v0 jobs (and recognizable variants) from
-- entering or advancing through activation-capable V0 boundaries. Existing
-- rows retain stop/poll/reconcile and terminal-completion paths so containment
-- remains possible.

CREATE FUNCTION "foundry_classify_normalize_mesh_glb_v0_job_spec"(
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
  relevant_stage_count integer := 0;
  exact_stage_count integer := 0;
BEGIN
  IF jsonb_typeof(job_spec_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(job_spec_input->'stages') IS DISTINCT FROM 'array' THEN
    RETURN 'malformed_job_spec';
  END IF;

  -- Treat the entire geometry lane as relevant before validating the
  -- surrounding stage. Command-token matching remains an additional signal,
  -- but an alias or shell wrapper cannot downgrade a geometry transformation
  -- to an unrelated job merely by hiding the reviewed token.
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(job_spec_input->'stages') stage(value)
    WHERE jsonb_typeof(stage.value) = 'object'
      AND (
        stage.value->>'kind' IS NOT DISTINCT FROM 'geometry'
        OR
        stage.value->'command' IS NOT DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
        OR (
          jsonb_typeof(stage.value->'command') = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(stage.value->'command') argument(value)
            WHERE jsonb_typeof(argument.value) = 'string'
              AND lower(argument.value #>> '{}') ~ 'normalize[_-]mesh[_-]glb'
          )
        )
      )
  )
  INTO has_relevant_stage;

  IF "foundry_jsonb_object_key_count"(job_spec_input) <> 16
     OR NOT (job_spec_input ?& ARRAY[
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
       WHERE jsonb_typeof(job_spec_input->string_leaf.key)
               IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(job_spec_input->'objectStorageProfile')
          NOT IN ('null', 'string')
     OR jsonb_typeof(job_spec_input->'estimatedCostUsd')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(job_spec_input->'budgetCapUsd')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(job_spec_input->'killSwitchEnabled')
          IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(job_spec_input->'computeApprovalId')
          NOT IN ('null', 'string')
     OR "foundry_is_job_stage_array"(job_spec_input->'stages') IS NOT TRUE THEN
    IF has_relevant_stage THEN
      RETURN 'normalize_mesh_glb_relevant_variant';
    END IF;
    RETURN 'malformed_job_spec';
  END IF;

  SELECT count(*)::integer
  INTO relevant_stage_count
  FROM jsonb_array_elements(job_spec_input->'stages') stage(value)
  WHERE stage.value->>'kind' IS NOT DISTINCT FROM 'geometry'
     OR stage.value->'command' IS NOT DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(stage.value->'command') argument(value)
       WHERE lower(argument.value #>> '{}') ~ 'normalize[_-]mesh[_-]glb'
     );

  IF relevant_stage_count = 0 THEN
    RETURN 'unrelated';
  END IF;

  SELECT count(*)::integer
  INTO exact_stage_count
  FROM jsonb_array_elements(job_spec_input->'stages') stage(value)
  WHERE stage.value->'command' IS NOT DISTINCT FROM
          '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb
    AND stage.value->>'kind' IS NOT DISTINCT FROM 'geometry'
    AND stage.value->>'networkAccess' IS NOT DISTINCT FROM 'none'
    AND stage.value->'rightsPurposes' IS NOT DISTINCT FROM
          '["commercial_internal_use"]'::jsonb
    AND jsonb_array_length(stage.value->'inputAssetIds') = 1;

  IF relevant_stage_count = 1 AND exact_stage_count = 1 THEN
    RETURN 'normalize_mesh_glb_v0_exact';
  END IF;
  RETURN 'normalize_mesh_glb_relevant_variant';
END;
$$;

CREATE FUNCTION "assert_foundry_legacy_v0_derivative_execution_denied"(
  job_id_input varchar,
  project_id_input varchar,
  boundary_input text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  immutable_job_spec jsonb;
  job_classification text;
  has_deterministic_transformation boolean;
BEGIN
  SELECT job."job_spec_json"
  INTO immutable_job_spec
  FROM "foundry_jobs" job
  WHERE job."job_id" = job_id_input
    AND job."project_id" = project_id_input;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy derivative execution barrier cannot resolve the immutable job'
      USING ERRCODE = '23503';
  END IF;

  job_classification :=
    "foundry_classify_normalize_mesh_glb_v0_job_spec"(immutable_job_spec);

  -- The immutable worker binding is the positive operation-class authority.
  -- This closes aliases, wrappers, and deliberately misleading stage kinds
  -- that no command-text classifier can identify semantically.
  SELECT EXISTS (
    SELECT 1
    FROM "foundry_job_worker_profiles" worker_binding
    WHERE worker_binding."job_id" = job_id_input
      AND worker_binding."project_id" = project_id_input
      AND worker_binding."operation_class" = 'deterministic_transformation'
  )
  INTO has_deterministic_transformation;

  IF has_deterministic_transformation
     AND job_classification IS NOT DISTINCT FROM 'unrelated' THEN
    job_classification := 'legacy_deterministic_transformation';
  END IF;
  IF job_classification IS DISTINCT FROM 'unrelated' THEN
    RAISE EXCEPTION
      'normalize_mesh_glb derivative job classification % cannot cross legacy V0 boundary %',
      job_classification,
      boundary_input
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_execution_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
    NEW."job_id", NEW."project_id", 'execution_insert'
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_attempt_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
    NEW."job_id", NEW."project_id", 'attempt_insert'
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_prepared_request_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."command_kind" IN ('provider_submit', 'provider_checkpoint') THEN
    PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
      NEW."job_id", NEW."project_id", 'activation_prepared_request_insert'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_provider_command_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."command_kind" IN ('provider_submit', 'provider_checkpoint') THEN
    PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
      NEW."job_id", NEW."project_id", 'activation_provider_command_insert'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_provider_command_claim"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."state" = 'pending'
     AND NEW."state" = 'claimed'
     AND OLD."command_kind" IN ('provider_submit', 'provider_checkpoint') THEN
    PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
      OLD."job_id", OLD."project_id", 'activation_provider_command_claim'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_derivative_v0_provider_invocation_event_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."event_kind" = 'provider_invocation_started'
     AND NEW."provider_command_kind" IN (
       'provider_submit', 'provider_checkpoint'
     ) THEN
    PERFORM "assert_foundry_legacy_v0_derivative_execution_denied"(
      NEW."job_id", NEW."project_id", 'activation_provider_invocation_started'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "foundry_derivative_v0_execution_insert_barrier"
  BEFORE INSERT ON "foundry_executions"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_v0_execution_insert"();

CREATE TRIGGER "foundry_derivative_v0_attempt_insert_barrier"
  BEFORE INSERT ON "foundry_attempts"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_v0_attempt_insert"();

CREATE TRIGGER "foundry_derivative_v0_prepared_request_insert_barrier"
  BEFORE INSERT ON "foundry_prepared_provider_requests"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_v0_prepared_request_insert"();

CREATE TRIGGER "foundry_derivative_v0_provider_command_insert_barrier"
  BEFORE INSERT ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_v0_provider_command_insert"();

CREATE TRIGGER "foundry_derivative_v0_provider_command_claim_barrier"
  BEFORE UPDATE ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_derivative_v0_provider_command_claim"();

CREATE TRIGGER "foundry_derivative_v0_provider_invocation_event_insert_barrier"
  BEFORE INSERT ON "foundry_execution_events"
  FOR EACH ROW EXECUTE FUNCTION
    "guard_foundry_derivative_v0_provider_invocation_event_insert"();
