import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  FOUNDRY_EXECUTION_ADMISSION_STATE,
  type FoundryAdmittedExecution,
  type FoundryExecutionAdmissionEvidence,
  type FoundryExecutionAdmissionInsert,
  type FoundryExecutionAdmissionRequestV0,
  type FoundryExecutionAdmissionStore,
  type FoundryStoredEvidence,
  type LockedFoundryExecutionAdmissionStore,
} from "./foundry-execution-admission.js";

const ADMISSION_LOCK_DOMAIN = "omnitwin.foundry.execution-admission.v0";
const ADMISSION_IDEMPOTENCY_LOCK_DOMAIN =
  "omnitwin.foundry.execution-admission-idempotency.v0";
const ADMISSION_EVENT_SCHEMA_VERSION =
  "omnitwin.foundry.execution-admitted-event.v0";

export type FoundryPostgresRow = Readonly<Record<string, unknown>>;

export interface FoundryPostgresQueryResult {
  readonly rows: readonly FoundryPostgresRow[];
}

export interface FoundryPostgresAdmissionTransaction {
  execute(query: SQL): Promise<FoundryPostgresQueryResult>;
}

/**
 * Deliberately smaller than Drizzle's Database type. Tests can provide a
 * deterministic executor while production wraps the real Drizzle transaction.
 */
export interface FoundryPostgresAdmissionClient {
  transaction<T>(
    operation: (transaction: FoundryPostgresAdmissionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class FoundryPostgresExecutionAdmissionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryPostgresExecutionAdmissionStoreError";
  }
}

function admissionLockKey(jobId: string, executionEnvelopeId: string): string {
  return `${ADMISSION_LOCK_DOMAIN}\u001f${jobId}\u001f${executionEnvelopeId}`;
}

function admissionIdempotencyLockKey(
  admittedByUserId: string,
  idempotencyKey: string,
): string {
  return `${ADMISSION_IDEMPOTENCY_LOCK_DOMAIN}\u001f${admittedByUserId}\u001f${idempotencyKey}`;
}

function requireString(row: FoundryPostgresRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `PostgreSQL admission query returned an invalid ${key}.`,
    );
  }
  return value;
}

function requireDate(row: FoundryPostgresRow, key: string): Date {
  const value = row[key];
  const date = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string"
    ? new Date(value)
    : null;
  if (date === null || !Number.isFinite(date.getTime())) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `PostgreSQL admission query returned an invalid ${key}.`,
    );
  }
  return date;
}

function requireSafeInteger(row: FoundryPostgresRow, key: string): number {
  const value = row[key];
  const numberValue = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string"
    ? Number(value)
    : value;
  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0
  ) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `PostgreSQL admission query returned an invalid ${key}.`,
    );
  }
  return numberValue;
}

function requireStoredEvidence(
  row: FoundryPostgresRow,
  sha256Key: string,
  valueKey: string,
): FoundryStoredEvidence {
  const value = row[valueKey];
  if (value === undefined || value === null) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `PostgreSQL admission query returned no ${valueKey}.`,
    );
  }
  return { sha256: requireString(row, sha256Key), value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStoredEvidenceArray(value: unknown): readonly FoundryStoredEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "PostgreSQL admission query returned no trusted worker-profile evidence.",
    );
  }
  const members: readonly unknown[] = value;
  return members.map((member) => {
    if (!isRecord(member)) {
      throw new FoundryPostgresExecutionAdmissionStoreError(
        "PostgreSQL admission query returned malformed worker-profile evidence.",
      );
    }
    if (typeof member["sha256"] !== "string" || !("value" in member)) {
      throw new FoundryPostgresExecutionAdmissionStoreError(
        "PostgreSQL admission query returned malformed worker-profile evidence.",
      );
    }
    return { sha256: member["sha256"], value: member["value"] };
  });
}

function singleRowOrNull(
  result: FoundryPostgresQueryResult,
  queryName: string,
): FoundryPostgresRow | null {
  if (result.rows.length > 1) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `${queryName} returned more than one row.`,
    );
  }
  return result.rows[0] ?? null;
}

function readProjectId(evidence: FoundryExecutionAdmissionEvidence): string {
  const value = evidence.jobSpec.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "Trusted JobSpec evidence does not expose a project identity.",
    );
  }
  const projectId = (value as Record<string, unknown>)["projectId"];
  if (typeof projectId !== "string") {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "Trusted JobSpec evidence does not expose a project identity.",
    );
  }
  return projectId;
}

function mapAdmittedExecution(row: FoundryPostgresRow): FoundryAdmittedExecution {
  const state = requireString(row, "state");
  if (state !== FOUNDRY_EXECUTION_ADMISSION_STATE) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "PostgreSQL admission lookup returned a non-admission receipt state.",
    );
  }
  return {
    executionId: requireString(row, "execution_id"),
    jobId: requireString(row, "job_id"),
    executionEnvelopeId: requireString(row, "execution_envelope_id"),
    executionEnvelopeSha256: requireString(row, "execution_envelope_sha256"),
    state,
    admittedByUserId: requireString(row, "admitted_by_user_id"),
    idempotencyKey: requireString(row, "idempotency_key"),
    requestDigest: requireString(row, "request_digest"),
    admittedAt: requireDate(row, "admitted_at"),
  };
}

function mapAdmissionEvidence(
  row: FoundryPostgresRow,
): FoundryExecutionAdmissionEvidence {
  const computeApprovalIdValue = row["compute_approval_id"];
  const computeApprovalSha256Value = row["compute_approval_sha256"];
  const computeApprovalJson = row["compute_approval_json"];
  const computeApprovalId = computeApprovalIdValue === null
    ? null
    : requireString(row, "compute_approval_id");
  if (
    (computeApprovalId === null) !==
      (computeApprovalSha256Value === null && computeApprovalJson === null)
  ) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "PostgreSQL admission query returned incoherent compute-approval evidence.",
    );
  }
  return {
    jobId: requireString(row, "job_id"),
    jobSpec: requireStoredEvidence(row, "job_spec_sha256", "job_spec_json"),
    ingestManifest: requireStoredEvidence(
      row,
      "reviewed_ingest_manifest_sha256",
      "reviewed_ingest_manifest_json",
    ),
    intakeAdmissionResult: requireStoredEvidence(
      row,
      "intake_admission_result_sha256",
      "intake_admission_result_json",
    ),
    intakeStagingIndex: requireStoredEvidence(
      row,
      "intake_staging_index_sha256",
      "intake_staging_index_json",
    ),
    executionEnvelopeId: requireString(row, "execution_envelope_id"),
    executionEnvelope: requireStoredEvidence(
      row,
      "execution_envelope_sha256",
      "execution_envelope_json",
    ),
    executionPolicy: requireStoredEvidence(
      row,
      "execution_policy_sha256",
      "execution_policy_json",
    ),
    providerPlanEvidence: requireStoredEvidence(
      row,
      "provider_plan_sha256",
      "provider_plan_json",
    ),
    providerDeploymentEvidence: requireStoredEvidence(
      row,
      "provider_deployment_sha256",
      "provider_deployment_json",
    ),
    trustedWorkerProfiles: requireStoredEvidenceArray(
      row["trusted_worker_profiles"],
    ),
    rightsApprovalId: requireString(row, "rights_approval_id"),
    rightsApproval: requireStoredEvidence(
      row,
      "rights_approval_sha256",
      "rights_approval_json",
    ),
    activeRightsPolicy: requireStoredEvidence(
      row,
      "rights_policy_evidence_sha256",
      "rights_policy_json",
    ),
    confirmationId: requireString(row, "confirmation_id"),
    confirmation: requireStoredEvidence(
      row,
      "confirmation_sha256",
      "confirmation_json",
    ),
    computeApprovalId,
    computeApproval: computeApprovalId === null
      ? null
      : {
        sha256: requireString(row, "compute_approval_sha256"),
        value: computeApprovalJson,
      },
  };
}

async function findIdempotentAdmission(
  transaction: FoundryPostgresAdmissionTransaction,
  admittedByUserId: string,
  idempotencyKey: string,
): Promise<FoundryAdmittedExecution | null> {
  // The database uniqueness scope is actor + idempotency key, not job. Take
  // that exact transaction lock before the lookup so concurrent requests for
  // different jobs cannot both observe absence and race into a raw 23505.
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${admissionIdempotencyLockKey(admittedByUserId, idempotencyKey)},
        0
      )
    )
  `);
  const result = await transaction.execute(sql`
    SELECT
      execution."id"::text AS "execution_id",
      execution."job_id",
      job."envelope_id" AS "execution_envelope_id",
      execution."execution_envelope_sha256",
      ${FOUNDRY_EXECUTION_ADMISSION_STATE}::text AS "state",
      execution."admitted_by_user_id"::text AS "admitted_by_user_id",
      execution."idempotency_key",
      execution."request_digest",
      execution."admitted_at"
    FROM "foundry_executions" execution
    JOIN "foundry_jobs" job
      ON job."job_id" = execution."job_id"
     AND job."project_id" = execution."project_id"
     AND job."execution_envelope_sha256" = execution."execution_envelope_sha256"
    WHERE execution."admitted_by_user_id" = ${admittedByUserId}::uuid
      AND execution."idempotency_key" = ${idempotencyKey}
    LIMIT 2
  `);
  const row = singleRowOrNull(result, "Foundry idempotency lookup");
  return row === null ? null : mapAdmittedExecution(row);
}

async function currentDatabaseTime(
  transaction: FoundryPostgresAdmissionTransaction,
): Promise<Date> {
  const result = await transaction.execute(sql`
    SELECT clock_timestamp() AS "database_time"
  `);
  const row = singleRowOrNull(result, "Foundry database clock lookup");
  if (row === null) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "PostgreSQL did not return an admission validation time.",
    );
  }
  return requireDate(row, "database_time");
}

async function loadTrustedEvidence(
  transaction: FoundryPostgresAdmissionTransaction,
  request: FoundryExecutionAdmissionRequestV0,
): Promise<FoundryExecutionAdmissionEvidence | null> {
  const result = await transaction.execute(sql`
    SELECT
      job."job_id",
      job."envelope_id" AS "execution_envelope_id",
      job."job_spec_sha256",
      job."job_spec_json",
      job."reviewed_ingest_manifest_sha256",
      job."reviewed_ingest_manifest_json",
      job."intake_admission_result_sha256",
      job."intake_admission_result_json",
      job."intake_staging_index_sha256",
      job."intake_staging_index_json",
      job."execution_envelope_sha256",
      job."execution_envelope_json",
      policy."execution_policy_sha256",
      policy."policy_json" AS "execution_policy_json",
      job."provider_plan_sha256",
      job."provider_plan_json",
      deployment."provider_deployment_sha256",
      deployment."deployment_json" AS "provider_deployment_json",
      workers."trusted_worker_profiles",
      rights."id" AS "rights_approval_id",
      rights."rights_approval_sha256",
      rights."rights_approval_json",
      rights_policy."policy_evidence_sha256" AS "rights_policy_evidence_sha256",
      rights_policy."policy_definition_json" AS "rights_policy_json",
      confirmation."confirmation_id",
      confirmation."confirmation_sha256",
      confirmation."confirmation_json",
      compute_approval."approval_id" AS "compute_approval_id",
      compute_approval."compute_approval_sha256",
      compute_approval."compute_approval_json"
    FROM "foundry_jobs" job
    JOIN "foundry_execution_policies" policy
      ON policy."execution_policy_sha256" = job."execution_policy_sha256"
    JOIN "foundry_provider_deployments" deployment
      ON deployment."provider_deployment_sha256" = job."provider_deployment_sha256"
     AND deployment."provider_kind" = job."provider_kind"
     AND deployment."provider_adapter_id" = job."provider_adapter_id"
     AND deployment."provider_adapter_version" = job."provider_adapter_version"
     AND deployment."provider_adapter_artifact_sha256" =
           job."provider_adapter_artifact_sha256"
    JOIN "foundry_rights_approvals" rights
      ON rights."id" = ${request.rightsApprovalId}
     AND rights."job_id" = job."job_id"
     AND rights."project_id" = job."project_id"
     AND rights."execution_envelope_sha256" = job."execution_envelope_sha256"
     AND rights."job_spec_sha256" = job."job_spec_sha256"
     AND rights."reviewed_ingest_manifest_sha256" =
           job."reviewed_ingest_manifest_sha256"
     AND rights."execution_policy_sha256" = job."execution_policy_sha256"
    JOIN "foundry_rights_policy_versions" rights_policy
      ON rights_policy."policy_version" = rights."policy_version"
     AND rights_policy."policy_definition_sha256" =
           rights."policy_definition_sha256"
     AND rights_policy."policy_evidence_sha256" = rights."policy_evidence_sha256"
     AND rights_policy."generation" = rights."policy_generation"
     AND rights_policy."maximum_approval_ttl_seconds" =
           rights."policy_maximum_approval_ttl_seconds"
    JOIN "foundry_execution_confirmations" confirmation
      ON confirmation."confirmation_id" = ${request.confirmationId}
     AND confirmation."job_id" = job."job_id"
     AND confirmation."project_id" = job."project_id"
     AND confirmation."execution_envelope_sha256" =
           job."execution_envelope_sha256"
     AND confirmation."job_spec_sha256" = job."job_spec_sha256"
    LEFT JOIN "foundry_compute_approvals" compute_approval
      ON compute_approval."approval_id" = ${request.computeApprovalId}
     AND compute_approval."job_id" = job."job_id"
     AND compute_approval."project_id" = job."project_id"
     AND compute_approval."execution_envelope_sha256" =
           job."execution_envelope_sha256"
     AND compute_approval."job_spec_sha256" = job."job_spec_sha256"
     AND compute_approval."provider_kind" = job."provider_kind"
     AND compute_approval."provider_adapter_id" = job."provider_adapter_id"
     AND compute_approval."provider_adapter_version" =
           job."provider_adapter_version"
     AND compute_approval."provider_adapter_artifact_sha256" =
           job."provider_adapter_artifact_sha256"
     AND compute_approval."provider_deployment_sha256" =
           job."provider_deployment_sha256"
    JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'sha256', profile."worker_profile_sha256",
          'value', profile."profile_json"
        ) ORDER BY profile."worker_profile_sha256" COLLATE "C"
      ) AS "trusted_worker_profiles",
      count(*) AS "profile_count"
      FROM (
        SELECT DISTINCT
          trusted_profile."worker_profile_sha256",
          trusted_profile."profile_json"
        FROM "foundry_job_worker_profiles" job_profile
        JOIN "foundry_trusted_worker_profiles" trusted_profile
          ON trusted_profile."worker_profile_sha256" =
               job_profile."worker_profile_sha256"
         AND trusted_profile."operation_class" = job_profile."operation_class"
        WHERE job_profile."job_id" = job."job_id"
          AND job_profile."project_id" = job."project_id"
          AND job_profile."execution_envelope_sha256" =
                job."execution_envelope_sha256"
          AND job_profile."provider_plan_sha256" = job."provider_plan_sha256"
          AND job_profile."trusted_worker_profile_set_sha256" =
                job."trusted_worker_profile_set_sha256"
      ) profile
    ) workers ON workers."profile_count" = job."trusted_worker_profile_count"
    WHERE job."job_id" = ${request.jobId}
      AND job."envelope_id" = ${request.executionEnvelopeId}
      AND job."compute_approval_id" IS NOT DISTINCT FROM ${request.computeApprovalId}
      AND "foundry_rights_policy_is_active"(
        rights."policy_version",
        rights."policy_definition_sha256",
        rights."policy_generation",
        clock_timestamp()
      )
      AND (
        (job."compute_approval_id" IS NULL AND compute_approval."approval_id" IS NULL)
        OR compute_approval."approval_id" = job."compute_approval_id"
      )
    LIMIT 2
  `);
  const row = singleRowOrNull(result, "Foundry trusted-evidence lookup");
  return row === null ? null : mapAdmissionEvidence(row);
}

async function findActiveKillSwitch(
  transaction: FoundryPostgresAdmissionTransaction,
  evidence: FoundryExecutionAdmissionEvidence,
): Promise<{ readonly id: string; readonly generation: number } | null> {
  const projectId = readProjectId(evidence);
  const envelope = evidence.executionEnvelope.value;
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "Trusted execution-envelope evidence does not expose its provider scope.",
    );
  }
  const provider = envelope as Record<string, unknown>;
  const providerKind = provider["providerKind"];
  const providerAdapterId = provider["providerAdapterId"];
  const providerAdapterVersion = provider["providerAdapterVersion"];
  if (
    typeof providerKind !== "string" ||
    typeof providerAdapterId !== "string" ||
    typeof providerAdapterVersion !== "string"
  ) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "Trusted execution-envelope evidence does not expose its provider scope.",
    );
  }

  await transaction.execute(sql`
    SELECT "foundry_lock_execution_control_scopes"(
      ${providerKind}::varchar,
      ${providerAdapterId}::varchar,
      ${providerAdapterVersion}::varchar,
      ${projectId}::varchar,
      NULL::uuid,
      NULL::uuid
    )
  `);
  const result = await transaction.execute(sql`
    WITH "existing_execution" AS (
      SELECT execution."id"
      FROM "foundry_executions" execution
      WHERE execution."job_id" = ${evidence.jobId}
        AND execution."project_id" = ${projectId}
    )
    SELECT
      kill_switch."id"::text AS "id",
      kill_switch."revision" AS "generation"
    FROM "foundry_kill_switches" kill_switch
    WHERE kill_switch."state" = 'active'
      AND (
        kill_switch."scope" = 'global'
        OR (
          kill_switch."scope" = 'provider'
          AND kill_switch."provider_kind" = ${providerKind}
          AND kill_switch."provider_adapter_id" = ${providerAdapterId}
          AND kill_switch."provider_adapter_version" = ${providerAdapterVersion}
        )
        OR (
          kill_switch."scope" = 'project'
          AND kill_switch."project_id" = ${projectId}
        )
        OR (
          kill_switch."scope" = 'execution'
          AND kill_switch."execution_id" IN (SELECT "id" FROM "existing_execution")
        )
        OR (
          kill_switch."scope" = 'attempt'
          AND kill_switch."execution_id" IN (SELECT "id" FROM "existing_execution")
        )
      )
    ORDER BY CASE kill_switch."scope"
      WHEN 'global' THEN 0
      WHEN 'provider' THEN 1
      WHEN 'project' THEN 2
      WHEN 'execution' THEN 3
      WHEN 'attempt' THEN 4
      ELSE 5
    END, kill_switch."id"
    LIMIT 1
  `);
  const row = singleRowOrNull(result, "Foundry active kill-switch lookup");
  return row === null
    ? null
    : { id: requireString(row, "id"), generation: requireSafeInteger(row, "generation") };
}

interface InsertedExecutionScope {
  readonly executionId: string;
  readonly projectId: string;
  readonly providerKind: string;
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  readonly admittedAt: Date;
}

function assertReturnedIdentity(
  row: FoundryPostgresRow,
  key: string,
  expected: string,
): void {
  if (requireString(row, key) !== expected) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      `PostgreSQL returned a mismatched admitted execution ${key}.`,
    );
  }
}

async function insertExecutionProjection(
  transaction: FoundryPostgresAdmissionTransaction,
  input: FoundryExecutionAdmissionInsert,
): Promise<InsertedExecutionScope> {
  const executionSubjectJson = JSON.stringify(input.executionSubject);
  const workerProfileSha256sJson = JSON.stringify(
    input.trustedWorkerProfileSha256s,
  );
  const result = await transaction.execute(sql`
    WITH "admission_clock" AS MATERIALIZED (
      SELECT clock_timestamp() AS "admitted_at"
    ),
    "worker_set" AS (
      SELECT
        job_profile."job_id",
        jsonb_agg(
          to_jsonb(job_profile."worker_profile_sha256")
          ORDER BY job_profile."worker_profile_sha256" COLLATE "C"
        ) AS "worker_profile_sha256s"
      FROM (
        SELECT DISTINCT
          link."job_id",
          link."worker_profile_sha256"
        FROM "foundry_job_worker_profiles" link
        WHERE link."job_id" = ${input.jobId}
      ) job_profile
      GROUP BY job_profile."job_id"
    )
    INSERT INTO "foundry_executions" (
      "job_id", "project_id", "execution_envelope_sha256",
      "execution_subject_sha256", "execution_subject_json",
      "job_spec_sha256", "provider_plan_sha256",
      "reviewed_ingest_manifest_sha256", "intake_admission_result_sha256",
      "intake_staging_index_sha256", "execution_policy_sha256",
      "pricing_snapshot_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "trusted_worker_profile_set_sha256",
      "trusted_worker_profile_count", "pricing_currency",
      "pricing_snapshot_expires_at", "budget_cap_micro_usd",
      "cost_warning_micro_usd", "cost_hard_stop_micro_usd",
      "termination_reserve_micro_usd", "absolute_cost_cap_micro_usd",
      "max_wall_clock_seconds", "orchestration_overhead_seconds",
      "cancel_grace_seconds", "termination_grace_seconds",
      "worker_self_deadline_seconds", "termination_confirmation_timeout_seconds",
      "provider_maximum_execution_ttl_seconds", "dispatch_deadline",
      "rights_approval_id", "rights_approval_sha256", "rights_policy_version",
      "rights_policy_definition_sha256", "rights_policy_evidence_sha256",
      "rights_policy_generation", "rights_policy_maximum_approval_ttl_seconds",
      "compute_approval_id", "compute_approval_sha256",
      "compute_approval_maximum_cost_micro_usd", "confirmation_id",
      "confirmation_sha256", "state", "last_attempt_ordinal", "fencing_token",
      "total_cost_micro_usd", "cancel_requested", "revision",
      "admitted_by_user_id", "idempotency_key", "request_digest",
      "admitted_at", "updated_at"
    )
    SELECT
      job."job_id", job."project_id", job."execution_envelope_sha256",
      ${input.executionSubjectSha256}, ${executionSubjectJson}::jsonb,
      job."job_spec_sha256", job."provider_plan_sha256",
      job."reviewed_ingest_manifest_sha256", job."intake_admission_result_sha256",
      job."intake_staging_index_sha256", job."execution_policy_sha256",
      job."pricing_snapshot_sha256", job."provider_kind", job."provider_adapter_id",
      job."provider_adapter_version", job."provider_adapter_artifact_sha256",
      job."provider_deployment_sha256", job."trusted_worker_profile_set_sha256",
      job."trusted_worker_profile_count", job."pricing_currency",
      job."pricing_snapshot_expires_at", job."budget_cap_micro_usd",
      job."cost_warning_micro_usd", job."cost_hard_stop_micro_usd",
      job."termination_reserve_micro_usd", job."absolute_cost_cap_micro_usd",
      job."max_wall_clock_seconds", job."orchestration_overhead_seconds",
      job."cancel_grace_seconds", job."termination_grace_seconds",
      job."worker_self_deadline_seconds", job."termination_confirmation_timeout_seconds",
      job."provider_maximum_execution_ttl_seconds", job."dispatch_deadline",
      rights."id", rights."rights_approval_sha256", rights."policy_version",
      rights."policy_definition_sha256", rights."policy_evidence_sha256",
      rights."policy_generation", rights."policy_maximum_approval_ttl_seconds",
      compute_approval."approval_id", compute_approval."compute_approval_sha256",
      compute_approval."maximum_cost_micro_usd", confirmation."confirmation_id",
      confirmation."confirmation_sha256", ${input.state}, 0, 0, 0, false, 0,
      ${input.admittedByUserId}::uuid, ${input.idempotencyKey}, ${input.requestDigest},
      admission_clock."admitted_at", admission_clock."admitted_at"
    FROM "foundry_jobs" job
    JOIN "foundry_execution_policies" policy
      ON policy."execution_policy_sha256" = job."execution_policy_sha256"
    JOIN "foundry_provider_deployments" deployment
      ON deployment."provider_deployment_sha256" = job."provider_deployment_sha256"
     AND deployment."provider_kind" = job."provider_kind"
     AND deployment."provider_adapter_id" = job."provider_adapter_id"
     AND deployment."provider_adapter_version" = job."provider_adapter_version"
     AND deployment."provider_adapter_artifact_sha256" =
           job."provider_adapter_artifact_sha256"
    JOIN "foundry_rights_approvals" rights
      ON rights."id" = ${input.rightsApprovalId}
     AND rights."job_id" = job."job_id"
     AND rights."project_id" = job."project_id"
     AND rights."execution_envelope_sha256" = job."execution_envelope_sha256"
     AND rights."job_spec_sha256" = job."job_spec_sha256"
     AND rights."reviewed_ingest_manifest_sha256" =
           job."reviewed_ingest_manifest_sha256"
     AND rights."execution_policy_sha256" = job."execution_policy_sha256"
     AND rights."rights_approval_sha256" = ${input.rightsApprovalSha256}
     AND rights."policy_definition_sha256" =
           ${input.rightsPolicyDefinitionSha256}
     AND rights."policy_evidence_sha256" = ${input.rightsPolicyEvidenceSha256}
    JOIN "foundry_rights_policy_versions" rights_policy
      ON rights_policy."policy_version" = rights."policy_version"
     AND rights_policy."policy_definition_sha256" =
           rights."policy_definition_sha256"
     AND rights_policy."policy_evidence_sha256" = rights."policy_evidence_sha256"
     AND rights_policy."generation" = rights."policy_generation"
     AND rights_policy."maximum_approval_ttl_seconds" =
           rights."policy_maximum_approval_ttl_seconds"
    JOIN "foundry_execution_confirmations" confirmation
      ON confirmation."confirmation_id" = ${input.confirmationId}
     AND confirmation."job_id" = job."job_id"
     AND confirmation."project_id" = job."project_id"
     AND confirmation."execution_envelope_sha256" =
           job."execution_envelope_sha256"
     AND confirmation."job_spec_sha256" = job."job_spec_sha256"
     AND confirmation."confirmation_sha256" = ${input.confirmationSha256}
    LEFT JOIN "foundry_compute_approvals" compute_approval
      ON compute_approval."approval_id" = ${input.computeApprovalId}
     AND compute_approval."job_id" = job."job_id"
     AND compute_approval."project_id" = job."project_id"
     AND compute_approval."execution_envelope_sha256" =
           job."execution_envelope_sha256"
     AND compute_approval."job_spec_sha256" = job."job_spec_sha256"
     AND compute_approval."provider_kind" = job."provider_kind"
     AND compute_approval."provider_adapter_id" = job."provider_adapter_id"
     AND compute_approval."provider_adapter_version" =
           job."provider_adapter_version"
     AND compute_approval."provider_adapter_artifact_sha256" =
           job."provider_adapter_artifact_sha256"
     AND compute_approval."provider_deployment_sha256" =
           job."provider_deployment_sha256"
     AND compute_approval."compute_approval_sha256" = ${input.computeApprovalSha256}
    JOIN "worker_set" worker_set
      ON worker_set."job_id" = job."job_id"
     AND worker_set."worker_profile_sha256s" = ${workerProfileSha256sJson}::jsonb
    CROSS JOIN "admission_clock" admission_clock
    WHERE job."job_id" = ${input.jobId}
      AND job."envelope_id" = ${input.executionEnvelopeId}
      AND job."execution_envelope_sha256" = ${input.executionEnvelopeSha256}
      AND job."job_spec_sha256" = ${input.jobSpecSha256}
      AND job."provider_plan_sha256" = ${input.providerPlanSha256}
      AND job."reviewed_ingest_manifest_sha256" =
            ${input.reviewedIngestManifestSha256}
      AND job."intake_admission_result_sha256" =
            ${input.intakeAdmissionResultSha256}
      AND job."intake_staging_index_sha256" = ${input.intakeStagingIndexSha256}
      AND job."execution_policy_sha256" = ${input.executionPolicySha256}
      AND job."provider_kind" = ${input.providerKind}
      AND job."provider_adapter_id" = ${input.providerAdapterId}
      AND job."provider_adapter_version" = ${input.providerAdapterVersion}
      AND job."provider_adapter_artifact_sha256" =
            ${input.providerAdapterArtifactSha256}
      AND job."provider_deployment_sha256" = ${input.providerDeploymentSha256}
      AND job."dispatch_deadline" = ${input.dispatchDeadline}
      AND job."absolute_cost_cap_micro_usd" = ${input.reservedCostMicroUsd}::bigint
      AND job."compute_approval_id" IS NOT DISTINCT FROM ${input.computeApprovalId}
      AND (
        (
          job."compute_approval_id" IS NULL
          AND ${input.computeApprovalSha256}::text IS NULL
          AND compute_approval."approval_id" IS NULL
        )
        OR (
          compute_approval."approval_id" = job."compute_approval_id"
          AND compute_approval."compute_approval_sha256" =
                ${input.computeApprovalSha256}
        )
      )
    RETURNING
      "id"::text AS "execution_id", "job_id", "project_id",
      "execution_envelope_sha256", "execution_subject_sha256", "provider_kind",
      "provider_adapter_id", "provider_adapter_version",
      "provider_adapter_artifact_sha256", "provider_deployment_sha256",
      "admitted_by_user_id"::text AS "admitted_by_user_id", "idempotency_key",
      "request_digest", "admitted_at"
  `);
  const row = singleRowOrNull(result, "Foundry execution admission insert");
  if (row === null) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "Exact trusted evidence disappeared before execution admission.",
    );
  }
  assertReturnedIdentity(row, "job_id", input.jobId);
  assertReturnedIdentity(
    row,
    "execution_envelope_sha256",
    input.executionEnvelopeSha256,
  );
  assertReturnedIdentity(row, "execution_subject_sha256", input.executionSubjectSha256);
  assertReturnedIdentity(row, "admitted_by_user_id", input.admittedByUserId);
  assertReturnedIdentity(row, "idempotency_key", input.idempotencyKey);
  assertReturnedIdentity(row, "request_digest", input.requestDigest);
  return {
    executionId: requireString(row, "execution_id"),
    projectId: requireString(row, "project_id"),
    providerKind: requireString(row, "provider_kind"),
    providerAdapterId: requireString(row, "provider_adapter_id"),
    providerAdapterVersion: requireString(row, "provider_adapter_version"),
    providerAdapterArtifactSha256: requireString(
      row,
      "provider_adapter_artifact_sha256",
    ),
    providerDeploymentSha256: requireString(row, "provider_deployment_sha256"),
    admittedAt: requireDate(row, "admitted_at"),
  };
}

async function insertAdmissionGenesisEvent(
  transaction: FoundryPostgresAdmissionTransaction,
  input: FoundryExecutionAdmissionInsert,
  scope: InsertedExecutionScope,
): Promise<void> {
  const payload = JSON.stringify({
    schemaVersion: ADMISSION_EVENT_SCHEMA_VERSION,
    jobId: input.jobId,
    executionEnvelopeId: input.executionEnvelopeId,
    executionEnvelopeSha256: input.executionEnvelopeSha256,
    executionSubjectSha256: input.executionSubjectSha256,
    state: FOUNDRY_EXECUTION_ADMISSION_STATE,
  });
  const result = await transaction.execute(sql`
    INSERT INTO "foundry_execution_events" (
      "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "execution_subject_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "sequence", "event_kind",
      "advances_projection", "payload", "actor_kind", "actor_key",
      "actor_user_id", "idempotency_key", "causation_id", "correlation_id",
      "expected_revision", "resulting_revision", "request_digest", "recorded_at"
    )
    SELECT
      execution."id", execution."project_id", execution."job_id",
      execution."execution_envelope_sha256", execution."execution_subject_sha256",
      execution."provider_kind", execution."provider_adapter_id",
      execution."provider_adapter_version",
      execution."provider_adapter_artifact_sha256",
      execution."provider_deployment_sha256", 1, 'execution_admitted', false,
      ${payload}::jsonb, 'operator', ${input.admittedByUserId},
      ${input.admittedByUserId}::uuid, ${input.idempotencyKey}, NULL,
      execution."id", 0, 0, ${input.requestDigest}, execution."admitted_at"
    FROM "foundry_executions" execution
    WHERE execution."id" = ${scope.executionId}::uuid
      AND execution."project_id" = ${scope.projectId}
      AND execution."job_id" = ${input.jobId}
      AND execution."execution_envelope_sha256" =
            ${input.executionEnvelopeSha256}
      AND execution."execution_subject_sha256" = ${input.executionSubjectSha256}
      AND execution."provider_kind" = ${scope.providerKind}
      AND execution."provider_adapter_id" = ${scope.providerAdapterId}
      AND execution."provider_adapter_version" = ${scope.providerAdapterVersion}
      AND execution."provider_adapter_artifact_sha256" =
            ${scope.providerAdapterArtifactSha256}
      AND execution."provider_deployment_sha256" =
            ${scope.providerDeploymentSha256}
      AND execution."admitted_by_user_id" = ${input.admittedByUserId}::uuid
      AND execution."idempotency_key" = ${input.idempotencyKey}
      AND execution."request_digest" = ${input.requestDigest}
      AND execution."state" = ${FOUNDRY_EXECUTION_ADMISSION_STATE}
      AND execution."revision" = 0
    RETURNING "execution_id"::text AS "execution_id", "event_kind"
  `);
  const row = singleRowOrNull(result, "Foundry admission genesis-event insert");
  if (
    row === null ||
    requireString(row, "execution_id") !== scope.executionId ||
    requireString(row, "event_kind") !== "execution_admitted"
  ) {
    throw new FoundryPostgresExecutionAdmissionStoreError(
      "PostgreSQL did not return the exact execution-admitted genesis event.",
    );
  }
}

async function insertAdmission(
  transaction: FoundryPostgresAdmissionTransaction,
  input: FoundryExecutionAdmissionInsert,
): Promise<FoundryAdmittedExecution> {
  const scope = await insertExecutionProjection(transaction, input);
  await insertAdmissionGenesisEvent(transaction, input, scope);
  return {
    executionId: scope.executionId,
    jobId: input.jobId,
    executionEnvelopeId: input.executionEnvelopeId,
    executionEnvelopeSha256: input.executionEnvelopeSha256,
    state: FOUNDRY_EXECUTION_ADMISSION_STATE,
    admittedByUserId: input.admittedByUserId,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    admittedAt: scope.admittedAt,
  };
}

function createLockedStore(
  transaction: FoundryPostgresAdmissionTransaction,
): LockedFoundryExecutionAdmissionStore {
  return {
    findIdempotentAdmission: (admittedByUserId, idempotencyKey) =>
      findIdempotentAdmission(transaction, admittedByUserId, idempotencyKey),
    currentDatabaseTime: () => currentDatabaseTime(transaction),
    loadTrustedEvidence: (request) => loadTrustedEvidence(transaction, request),
    findActiveKillSwitch: (evidence) =>
      findActiveKillSwitch(transaction, evidence),
    insertAdmission: (input) => insertAdmission(transaction, input),
  };
}

export function createPostgresFoundryExecutionAdmissionStore(
  client: FoundryPostgresAdmissionClient,
): FoundryExecutionAdmissionStore {
  return {
    withAdmissionLock<T>(
      jobId: string,
      executionEnvelopeId: string,
      operation: (store: LockedFoundryExecutionAdmissionStore) => Promise<T>,
    ): Promise<T> {
      return client.transaction(async (transaction) => {
        await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${admissionLockKey(jobId, executionEnvelopeId)}, 0)
          )
        `);
        return operation(createLockedStore(transaction));
      });
    },
  };
}

/** Production convenience adapter for the repository's Neon-backed Drizzle DB. */
export function createDrizzleFoundryExecutionAdmissionStore(
  database: Database,
): FoundryExecutionAdmissionStore {
  return createPostgresFoundryExecutionAdmissionStore({
    transaction<T>(operation: (
      transaction: FoundryPostgresAdmissionTransaction,
    ) => Promise<T>): Promise<T> {
      return database.transaction((transaction) =>
        operation({
          async execute(query): Promise<FoundryPostgresQueryResult> {
            const result = await transaction.execute(query);
            return { rows: result.rows };
          },
        })
      );
    },
  });
}
