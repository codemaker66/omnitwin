import { sql, type SQL } from "drizzle-orm";
import { FoundryCanonicalActorSchema, FoundryUtcInstantSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FoundryClaimedProviderCommandV0Schema,
  FoundryProviderAdapterOutcomeV0Schema,
  FoundryProviderAdapterClaimBindingsV0Schema,
  FoundryVerifiedCheckpointEvidenceV0Schema,
  computeFoundryProviderAdapterOutcomeSha256,
  computeFoundryProviderCommandInternalEvidenceSha256,
  computeFoundryProviderCheckpointEvidenceSha256,
  computeFoundryProviderCommandOutcomeSha256,
  validateFoundryProviderOutcomeForCommand,
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderAdapterOutcomeV0,
  type FoundryProviderAdapterClaimBindingsV0,
  type FoundryProviderCommandCompletionDisposition,
  type FoundryProviderCommandExecutorStore,
  type FoundryProviderCommandOutcomePayloadV0,
  type FoundryProviderResultClassificationDisposition,
  type FoundryProviderResultObservationDisposition,
  type FoundryProviderResultTerminalDisposition,
  type FoundryVerifiedCheckpointEvidenceV0,
} from "./foundry-provider-command-executor.js";

const INVOCATION_EVENT_SCHEMA_VERSION =
  "omnitwin.foundry.provider-invocation-started.v0";
const INVOCATION_EVENT_DIGEST_DOMAIN =
  "omnitwin.foundry.provider-invocation-started.v0";
const COMPLETION_EVENT_DIGEST_DOMAIN =
  "omnitwin.foundry.provider-command-completed.v0";

export type FoundryPostgresProviderCommandRow = Readonly<Record<string, unknown>>;

export interface FoundryPostgresProviderCommandQueryResult {
  readonly rows: readonly FoundryPostgresProviderCommandRow[];
}

export interface FoundryPostgresProviderCommandTransaction {
  execute(query: SQL): Promise<FoundryPostgresProviderCommandQueryResult>;
}

/**
 * Intentionally narrow so the store can be tested without a live database and
 * can wrap either the repository's Drizzle client or another PostgreSQL driver.
 */
export interface FoundryPostgresProviderCommandClient {
  transaction<T>(
    operation: (
      transaction: FoundryPostgresProviderCommandTransaction,
    ) => Promise<T>,
  ): Promise<T>;
}

export class FoundryPostgresProviderCommandStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundryPostgresProviderCommandStoreError";
  }
}

function singleRowOrNull(
  result: FoundryPostgresProviderCommandQueryResult,
  operation: string,
): FoundryPostgresProviderCommandRow | null {
  if (result.rows.length > 1) {
    throw new FoundryPostgresProviderCommandStoreError(
      `${operation} returned more than one row.`,
    );
  }
  return result.rows[0] ?? null;
}

function requireString(
  row: FoundryPostgresProviderCommandRow,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new FoundryPostgresProviderCommandStoreError(
      `PostgreSQL provider-command query returned an invalid ${key}.`,
    );
  }
  return value;
}

function requireSafeInteger(
  row: FoundryPostgresProviderCommandRow,
  key: string,
): number {
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
    throw new FoundryPostgresProviderCommandStoreError(
      `PostgreSQL provider-command query returned an invalid ${key}.`,
    );
  }
  return numberValue;
}

function requirePositiveBigintText(
  row: FoundryPostgresProviderCommandRow,
  key: string,
): string {
  const value = row[key];
  const text = typeof value === "bigint"
    ? value.toString()
    : typeof value === "number" && Number.isSafeInteger(value)
    ? value.toString()
    : typeof value === "string"
    ? value
    : null;
  if (text === null || !/^[1-9][0-9]*$/u.test(text)) {
    throw new FoundryPostgresProviderCommandStoreError(
      `PostgreSQL provider-command query returned an invalid ${key}.`,
    );
  }
  return text;
}

function requireInstant(
  row: FoundryPostgresProviderCommandRow,
  key: string,
): string {
  const value = row[key];
  const date = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string"
    ? new Date(value)
    : null;
  if (date === null || !Number.isFinite(date.getTime())) {
    throw new FoundryPostgresProviderCommandStoreError(
      `PostgreSQL provider-command query returned an invalid ${key}.`,
    );
  }
  return date.toISOString();
}

function requireJsonObject(
  row: FoundryPostgresProviderCommandRow,
  key: string,
): Readonly<Record<string, unknown>> {
  const raw = row[key];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new FoundryPostgresProviderCommandStoreError(
        `PostgreSQL provider-command query returned invalid JSON in ${key}.`,
      );
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FoundryPostgresProviderCommandStoreError(
      `PostgreSQL provider-command query returned a non-object ${key}.`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function mapClaimedCommand(
  row: FoundryPostgresProviderCommandRow,
): FoundryClaimedProviderCommandV0 {
  const attemptOrdinal = requireSafeInteger(row, "attempt_ordinal");
  if (attemptOrdinal !== 1) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned a provider command outside the immutable single-attempt contract.",
    );
  }
  return FoundryClaimedProviderCommandV0Schema.parse({
    schemaVersion: FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
    commandKind: requireString(row, "command_kind"),
    commandId: requireString(row, "command_id"),
    executionId: requireString(row, "execution_id"),
    attemptId: requireString(row, "attempt_id"),
    projectId: requireString(row, "project_id"),
    jobId: requireString(row, "job_id"),
    executionEnvelopeSha256: requireString(row, "execution_envelope_sha256"),
    providerKind: requireString(row, "provider_kind"),
    providerAdapterId: requireString(row, "provider_adapter_id"),
    providerAdapterVersion: requireString(row, "provider_adapter_version"),
    providerAdapterArtifactSha256: requireString(
      row,
      "provider_adapter_artifact_sha256",
    ),
    providerAdapterConfigurationSha256: requireString(
      row,
      "provider_adapter_configuration_sha256",
    ),
    providerDeploymentSha256: requireString(row, "provider_deployment_sha256"),
    providerRequestProfileId: requireString(row, "provider_request_profile_id"),
    providerRequestProfileVersion: requireString(
      row,
      "provider_request_profile_version",
    ),
    providerRequestProfileSha256: requireString(
      row,
      "provider_request_profile_sha256",
    ),
    attemptOrdinal,
    fencingToken: requirePositiveBigintText(row, "fencing_token"),
    commandSequence: requireSafeInteger(row, "command_sequence"),
    claimedBy: requireString(row, "claimed_by"),
    claimToken: requireString(row, "claim_token"),
    claimedAt: requireInstant(row, "claimed_at"),
    claimExpiresAt: requireInstant(row, "claim_expires_at"),
    payload: requireJsonObject(row, "payload"),
    payloadSha256: requireString(row, "payload_sha256"),
  });
}

function claimSelectColumns(): SQL {
  return sql`
    claimed."id"::text AS "command_id",
    claimed."execution_id"::text AS "execution_id",
    claimed."attempt_id"::text AS "attempt_id",
    claimed."project_id", claimed."job_id",
    claimed."execution_envelope_sha256", claimed."provider_kind",
    claimed."provider_adapter_id", claimed."provider_adapter_version",
    claimed."provider_adapter_artifact_sha256",
    claimed."provider_adapter_configuration_sha256",
    claimed."provider_deployment_sha256",
    claimed."provider_request_profile_id",
    claimed."provider_request_profile_version",
    claimed."provider_request_profile_sha256",
    claimed."attempt_ordinal", claimed."fencing_token"::text AS "fencing_token",
    claimed."command_sequence", claimed."command_kind", claimed."claimed_by",
    claimed."claim_token"::text AS "claim_token",
    date_trunc('milliseconds', claimed."claimed_at") AS "claimed_at",
    date_trunc('milliseconds', claimed."claim_expires_at") AS "claim_expires_at",
    claimed."payload", claimed."payload_sha256"
  `;
}

async function claimNextCommand(
  transaction: FoundryPostgresProviderCommandTransaction,
  workerId: string,
  eligibleBindings: FoundryProviderAdapterClaimBindingsV0,
): Promise<FoundryClaimedProviderCommandV0 | null> {
  // Deliberately pending-only. Expired claims need a separate command-aware
  // recovery coordinator; in particular, provider-submit must never be requeued.
  const result = await transaction.execute(sql`
    WITH eligible_bindings AS MATERIALIZED (
      SELECT binding.*
      FROM jsonb_to_recordset(${JSON.stringify(eligibleBindings)}::jsonb) AS binding(
        "providerKind" text,
        "providerAdapterId" text,
        "providerAdapterVersion" text,
        "providerAdapterArtifactSha256" text,
        "providerAdapterConfigurationSha256" text,
        "providerDeploymentSha256" text,
        "providerRequestProfileId" text,
        "providerRequestProfileVersion" text,
        "providerRequestProfileSha256" text,
        "targetKind" text,
        "targetId" text
      )
    ), database_clock AS MATERIALIZED (
      SELECT clock_timestamp() AS "now"
    ), candidate AS MATERIALIZED (
      SELECT command."id", command."revision", command."command_kind",
             command."maximum_api_call_seconds", execution."dispatch_deadline",
             policy."lease_ttl_seconds", database_clock."now"
      FROM "foundry_provider_commands" command
      JOIN eligible_bindings binding
        ON binding."providerKind" = command."provider_kind"
       AND binding."providerAdapterId" = command."provider_adapter_id"
       AND binding."providerAdapterVersion" = command."provider_adapter_version"
       AND binding."providerAdapterArtifactSha256" =
             command."provider_adapter_artifact_sha256"
       AND binding."providerAdapterConfigurationSha256" =
             command."provider_adapter_configuration_sha256"
       AND binding."providerDeploymentSha256" =
             command."provider_deployment_sha256"
       AND binding."providerRequestProfileId" =
             command."provider_request_profile_id"
       AND binding."providerRequestProfileVersion" =
             command."provider_request_profile_version"
       AND binding."providerRequestProfileSha256" =
             command."provider_request_profile_sha256"
       AND binding."targetKind" =
             command."payload"->'providerRequest'->'provider'->'target'->>'targetKind'
       AND binding."targetId" = COALESCE(
             command."payload"->'providerRequest'->'provider'->'target'->>'runnerProfileId',
             command."payload"->'providerRequest'->'provider'->'target'->>'poolId'
           )
      JOIN "foundry_attempts" attempt
        ON attempt."id" = command."attempt_id"
       AND attempt."execution_id" = command."execution_id"
       AND attempt."fencing_token" = command."fencing_token"
       JOIN "foundry_executions" execution
         ON execution."id" = command."execution_id"
        AND execution."fencing_token" = command."fencing_token"
        AND execution."execution_subject_sha256" = command."execution_subject_sha256"
       JOIN "foundry_jobs" job
         ON job."job_id" = execution."job_id"
        AND job."project_id" = execution."project_id"
        AND job."execution_envelope_sha256" = execution."execution_envelope_sha256"
        AND job."job_spec_sha256" = execution."job_spec_sha256"
       JOIN "foundry_execution_policies" policy
         ON policy."execution_policy_sha256" = execution."execution_policy_sha256"
      CROSS JOIN database_clock
      WHERE command."state" = 'pending'
        AND command."available_at" <= database_clock."now"
        AND policy."lease_ttl_seconds" >= command."maximum_api_call_seconds" + 2
        AND CASE command."command_kind"
          WHEN 'provider_submit' THEN
            attempt."state" = 'submit_pending'
            AND execution."state" = 'submit_pending'
            AND "foundry_classify_normalize_mesh_glb_v0_job_spec"(
                  job."job_spec_json"
                ) = 'unrelated'
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_job_worker_profiles" derivative_worker_binding
              WHERE derivative_worker_binding."job_id" = job."job_id"
                AND derivative_worker_binding."project_id" = job."project_id"
                AND derivative_worker_binding."operation_class" =
                      'deterministic_transformation'
            )
            AND NOT attempt."cancel_requested"
            AND NOT execution."cancel_requested"
            AND database_clock."now" < execution."dispatch_deadline"
            AND database_clock."now" + make_interval(
                  secs => command."maximum_api_call_seconds" + 2
                ) <= execution."dispatch_deadline"
            AND execution."total_cost_micro_usd" < execution."cost_hard_stop_micro_usd"
            AND execution."total_cost_micro_usd" + execution."termination_reserve_micro_usd"
                  <= execution."absolute_cost_cap_micro_usd"
            AND "foundry_execution_authority_is_current"(
                  execution."id",
                  database_clock."now" + make_interval(
                    secs => command."maximum_api_call_seconds" + 1
                  )
                )
            AND EXISTS (
              SELECT 1
              FROM "foundry_provider_request_profiles" profile
              WHERE profile."provider_request_profile_sha256" =
                      command."provider_request_profile_sha256"
                AND profile."profile_id" = command."provider_request_profile_id"
                AND profile."profile_version" = command."provider_request_profile_version"
                AND profile."provider_kind" = command."provider_kind"
                AND profile."provider_adapter_id" = command."provider_adapter_id"
                AND profile."provider_adapter_version" = command."provider_adapter_version"
                AND profile."provider_adapter_artifact_sha256" =
                      command."provider_adapter_artifact_sha256"
                AND profile."provider_adapter_configuration_sha256" =
                      command."provider_adapter_configuration_sha256"
                AND profile."provider_deployment_sha256" =
                      command."provider_deployment_sha256"
                AND profile."reviewed_at" <= database_clock."now"
                AND profile."expires_at" > database_clock."now" + make_interval(
                      secs => command."maximum_api_call_seconds" + 1
                    )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_kill_switches" kill
              WHERE kill."state" = 'active'
                AND (
                  kill."scope" = 'global'
                  OR (kill."scope" = 'provider'
                    AND kill."provider_kind" = execution."provider_kind"
                    AND kill."provider_adapter_id" = execution."provider_adapter_id"
                    AND kill."provider_adapter_version" = execution."provider_adapter_version")
                  OR (kill."scope" = 'project'
                    AND kill."project_id" = execution."project_id")
                  OR (kill."scope" = 'execution'
                    AND kill."execution_id" = execution."id")
                  OR (kill."scope" = 'attempt'
                    AND kill."attempt_id" = attempt."id")
                )
            )
          WHEN 'provider_reconcile' THEN
            attempt."state" IN ('provider_unknown', 'stop_pending')
            AND left(execution."state", 9) <> 'terminal_'
            AND command."target_provider_ref" IS NOT DISTINCT FROM
                  attempt."provider_execution_ref"
          WHEN 'provider_poll' THEN
            left(attempt."state", 9) <> 'terminal_'
            AND left(execution."state", 9) <> 'terminal_'
            AND attempt."provider_execution_ref" IS NOT NULL
            AND command."target_provider_ref" = attempt."provider_execution_ref"
          WHEN 'provider_checkpoint' THEN
            attempt."state" = 'running'
            AND left(execution."state", 9) <> 'terminal_'
            AND "foundry_classify_normalize_mesh_glb_v0_job_spec"(
                  job."job_spec_json"
                ) = 'unrelated'
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_job_worker_profiles" derivative_worker_binding
              WHERE derivative_worker_binding."job_id" = job."job_id"
                AND derivative_worker_binding."project_id" = job."project_id"
                AND derivative_worker_binding."operation_class" =
                      'deterministic_transformation'
            )
            AND NOT attempt."cancel_requested"
            AND attempt."provider_execution_ref" IS NOT NULL
            AND command."target_provider_ref" = attempt."provider_execution_ref"
            AND "foundry_rights_policy_is_active"(
                  execution."rights_policy_version",
                  execution."rights_policy_definition_sha256",
                  execution."rights_policy_generation",
                  database_clock."now" + make_interval(
                    secs => command."maximum_api_call_seconds" + 1
                  )
                )
            AND EXISTS (
              SELECT 1
              FROM "foundry_rights_approvals" rights
              WHERE rights."id" = execution."rights_approval_id"
                AND rights."rights_approval_sha256" = execution."rights_approval_sha256"
                AND rights."expires_at" > database_clock."now" + make_interval(
                      secs => command."maximum_api_call_seconds" + 1
                    )
            )
            AND EXISTS (
              SELECT 1
              FROM "foundry_provider_request_profiles" profile
              WHERE profile."provider_request_profile_sha256" =
                      command."provider_request_profile_sha256"
                AND profile."profile_id" = command."provider_request_profile_id"
                AND profile."profile_version" = command."provider_request_profile_version"
                AND profile."provider_kind" = command."provider_kind"
                AND profile."provider_adapter_id" = command."provider_adapter_id"
                AND profile."provider_adapter_version" = command."provider_adapter_version"
                AND profile."provider_adapter_artifact_sha256" =
                      command."provider_adapter_artifact_sha256"
                AND profile."provider_adapter_configuration_sha256" =
                      command."provider_adapter_configuration_sha256"
                AND profile."provider_deployment_sha256" =
                      command."provider_deployment_sha256"
                AND profile."reviewed_at" <= database_clock."now"
                AND profile."expires_at" > database_clock."now" + make_interval(
                      secs => command."maximum_api_call_seconds" + 1
                    )
            )
          WHEN 'provider_stop' THEN
            attempt."state" IN ('stop_pending', 'termination_unconfirmed')
            AND left(execution."state", 9) <> 'terminal_'
            AND attempt."cancel_requested"
            AND attempt."provider_execution_ref" IS NOT NULL
            AND command."target_provider_ref" = attempt."provider_execution_ref"
            AND command."stop_intent_id" IS NOT NULL
          ELSE false
        END
      ORDER BY
        CASE command."command_kind"
          WHEN 'provider_stop' THEN 0
          WHEN 'provider_reconcile' THEN 1
          ELSE 2
        END,
        command."available_at", command."created_at",
        command."command_sequence", command."id"
      FOR UPDATE OF command SKIP LOCKED
      LIMIT 1
    ), claimed AS (
      UPDATE "foundry_provider_commands" command
      SET "state" = 'claimed',
          "claimed_by" = ${workerId},
          "claim_token" = gen_random_uuid(),
          "claim_expires_at" = CASE candidate."command_kind"
            WHEN 'provider_submit' THEN LEAST(
              candidate."now" + make_interval(secs => candidate."lease_ttl_seconds"),
              candidate."dispatch_deadline"
            )
            ELSE candidate."now" + make_interval(secs => candidate."lease_ttl_seconds")
          END,
          "revision" = command."revision" + 1
      FROM candidate
      WHERE command."id" = candidate."id"
        AND command."state" = 'pending'
        AND command."revision" = candidate."revision"
      RETURNING command.*
    )
    SELECT ${claimSelectColumns()}
    FROM claimed
  `);
  const row = singleRowOrNull(result, "Foundry provider-command claim");
  return row === null ? null : mapClaimedCommand(row);
}

async function acquireFoundryExecutionControlRoot(
  transaction: FoundryPostgresProviderCommandTransaction,
): Promise<void> {
  const result = await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('foundry-kill:0:global', 0)
    ) AS "execution_control_root_lock"
  `);
  if (result.rows.length !== 1) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL did not acquire the Foundry execution-control root lock.",
    );
  }
}

function exactClaimIdentityPredicates(
  command: FoundryClaimedProviderCommandV0,
): SQL {
  return sql`
    stored."id" = ${command.commandId}::uuid
    AND stored."execution_id" = ${command.executionId}::uuid
    AND stored."attempt_id" = ${command.attemptId}::uuid
    AND stored."project_id" = ${command.projectId}
    AND stored."job_id" = ${command.jobId}
    AND stored."execution_envelope_sha256" = ${command.executionEnvelopeSha256}
    AND stored."execution_subject_sha256" = ${command.payload.executionSubjectSha256}
    AND stored."provider_kind" = ${command.providerKind}
    AND stored."provider_adapter_id" = ${command.providerAdapterId}
    AND stored."provider_adapter_version" = ${command.providerAdapterVersion}
    AND stored."provider_adapter_artifact_sha256" =
          ${command.providerAdapterArtifactSha256}
    AND stored."provider_adapter_configuration_sha256" =
          ${command.providerAdapterConfigurationSha256}
    AND stored."provider_deployment_sha256" = ${command.providerDeploymentSha256}
    AND stored."attempt_ordinal" = ${command.attemptOrdinal}
    AND stored."fencing_token" = ${command.fencingToken}::bigint
    AND stored."command_sequence" = ${command.commandSequence}
    AND stored."command_kind" = ${command.commandKind}
    AND stored."provider_request_profile_id" = ${command.providerRequestProfileId}
    AND stored."provider_request_profile_version" =
          ${command.providerRequestProfileVersion}
    AND stored."provider_request_profile_sha256" =
          ${command.providerRequestProfileSha256}
    AND stored."provider_request_sha256" = ${command.payload.providerRequestSha256}
    AND stored."provider_idempotency_key" = ${command.payload.providerIdempotencyKey}
    AND stored."provider_client_request_id" =
          ${command.payload.providerRequest.requestIdentity.clientRequestId}
    AND stored."maximum_api_call_seconds" = ${command.payload.maximumApiCallSeconds}
    AND stored."stage_ids" = ${JSON.stringify(command.payload.stageIds)}::jsonb
    AND stored."payload" = ${JSON.stringify(command.payload)}::jsonb
    AND stored."payload_sha256" = ${command.payloadSha256}
    AND stored."claimed_by" = ${command.claimedBy}
    AND stored."claim_token" = ${command.claimToken}::uuid
    AND date_trunc('milliseconds', stored."claimed_at") =
          ${command.claimedAt}::timestamptz
    AND date_trunc('milliseconds', stored."claim_expires_at") =
          ${command.claimExpiresAt}::timestamptz
  `;
}

function exactClaimPredicates(command: FoundryClaimedProviderCommandV0): SQL {
  return sql`
    ${exactClaimIdentityPredicates(command)}
    AND stored."state" = 'claimed'
  `;
}

async function authorizeAndRecordInvocationStart(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
): Promise<
  | { readonly authorized: true }
  | { readonly authorized: false; readonly reasonCode: string }
> {
  const result = await transaction.execute(sql`
    WITH database_clock AS MATERIALIZED (
      SELECT clock_timestamp() AS "now"
    ), locked AS MATERIALIZED (
      SELECT stored.*, prepared."id" AS "exact_prepared_request_id",
             execution."revision" AS "execution_revision", database_clock."now"
      FROM "foundry_provider_commands" stored
      JOIN "foundry_prepared_provider_requests" prepared
        ON prepared."id" = stored."prepared_provider_request_id"
       AND prepared."provider_command_id" = stored."id"
       AND prepared."execution_id" = stored."execution_id"
       AND prepared."attempt_id" = stored."attempt_id"
       AND prepared."execution_subject_sha256" = stored."execution_subject_sha256"
       AND prepared."command_sequence" = stored."command_sequence"
       AND prepared."command_kind" = stored."command_kind"
       AND prepared."provider_request_sha256" = stored."provider_request_sha256"
       AND prepared."provider_request_json" = stored."payload"->'providerRequest'
       AND prepared."provider_request_profile_id" = stored."provider_request_profile_id"
       AND prepared."provider_request_profile_version" =
             stored."provider_request_profile_version"
       AND prepared."provider_request_profile_sha256" =
             stored."provider_request_profile_sha256"
       AND prepared."provider_adapter_configuration_sha256" =
             stored."provider_adapter_configuration_sha256"
       AND prepared."provider_idempotency_key" = stored."provider_idempotency_key"
       AND prepared."provider_client_request_id" = stored."provider_client_request_id"
       AND prepared."stage_ids" = stored."stage_ids"
       AND prepared."maximum_api_call_seconds" = stored."maximum_api_call_seconds"
      JOIN "foundry_provider_request_profiles" profile
        ON profile."provider_request_profile_sha256" =
             stored."provider_request_profile_sha256"
       AND profile."profile_id" = stored."provider_request_profile_id"
       AND profile."profile_version" = stored."provider_request_profile_version"
       AND profile."provider_kind" = stored."provider_kind"
       AND profile."provider_adapter_id" = stored."provider_adapter_id"
       AND profile."provider_adapter_version" = stored."provider_adapter_version"
       AND profile."provider_adapter_artifact_sha256" =
             stored."provider_adapter_artifact_sha256"
       AND profile."provider_adapter_configuration_sha256" =
             stored."provider_adapter_configuration_sha256"
       AND profile."provider_deployment_sha256" = stored."provider_deployment_sha256"
      JOIN "foundry_attempts" attempt
        ON attempt."id" = stored."attempt_id"
       AND attempt."execution_id" = stored."execution_id"
       AND attempt."fencing_token" = stored."fencing_token"
       JOIN "foundry_executions" execution
         ON execution."id" = stored."execution_id"
        AND execution."fencing_token" = stored."fencing_token"
        AND execution."execution_subject_sha256" = stored."execution_subject_sha256"
       JOIN "foundry_jobs" job
         ON job."job_id" = execution."job_id"
        AND job."project_id" = execution."project_id"
        AND job."execution_envelope_sha256" = execution."execution_envelope_sha256"
        AND job."job_spec_sha256" = execution."job_spec_sha256"
      CROSS JOIN database_clock
      WHERE ${exactClaimPredicates(command)}
        AND stored."revision" > 0
        AND stored."claim_expires_at" > database_clock."now"
        AND database_clock."now" + make_interval(
              secs => stored."maximum_api_call_seconds" + 1
            ) <= stored."claim_expires_at"
        AND NOT EXISTS (
          SELECT 1
          FROM "foundry_execution_events" prior_invocation
          WHERE prior_invocation."provider_command_id" = stored."id"
            AND prior_invocation."claim_token" = stored."claim_token"
            AND prior_invocation."event_kind" = 'provider_invocation_started'
        )
        AND CASE stored."command_kind"
          WHEN 'provider_submit' THEN
            execution."state" = 'submit_pending'
            AND attempt."state" = 'submit_pending'
            AND "foundry_classify_normalize_mesh_glb_v0_job_spec"(
                  job."job_spec_json"
                ) = 'unrelated'
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_job_worker_profiles" derivative_worker_binding
              WHERE derivative_worker_binding."job_id" = job."job_id"
                AND derivative_worker_binding."project_id" = job."project_id"
                AND derivative_worker_binding."operation_class" =
                      'deterministic_transformation'
            )
            AND NOT execution."cancel_requested"
            AND NOT attempt."cancel_requested"
            AND database_clock."now" < execution."dispatch_deadline"
            AND execution."total_cost_micro_usd" < execution."cost_hard_stop_micro_usd"
            AND execution."total_cost_micro_usd" + execution."termination_reserve_micro_usd"
                  <= execution."absolute_cost_cap_micro_usd"
            AND "foundry_execution_authority_is_current"(
                  execution."id",
                  database_clock."now" + make_interval(
                    secs => stored."maximum_api_call_seconds" + 1
                  )
                )
            AND profile."reviewed_at" <= database_clock."now"
            AND profile."expires_at" > database_clock."now" + make_interval(
                  secs => stored."maximum_api_call_seconds" + 1
                )
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_kill_switches" kill
              WHERE kill."state" = 'active'
                AND (
                  kill."scope" = 'global'
                  OR (kill."scope" = 'provider'
                    AND kill."provider_kind" = execution."provider_kind"
                    AND kill."provider_adapter_id" = execution."provider_adapter_id"
                    AND kill."provider_adapter_version" = execution."provider_adapter_version")
                  OR (kill."scope" = 'project'
                    AND kill."project_id" = execution."project_id")
                  OR (kill."scope" = 'execution'
                    AND kill."execution_id" = execution."id")
                  OR (kill."scope" = 'attempt'
                    AND kill."attempt_id" = attempt."id")
                )
            )
          WHEN 'provider_reconcile' THEN
            attempt."state" IN ('provider_unknown', 'stop_pending')
            AND left(execution."state", 9) <> 'terminal_'
            AND stored."target_provider_ref" IS NOT DISTINCT FROM
                  attempt."provider_execution_ref"
          WHEN 'provider_poll' THEN
            left(attempt."state", 9) <> 'terminal_'
            AND left(execution."state", 9) <> 'terminal_'
            AND attempt."provider_execution_ref" IS NOT NULL
            AND stored."target_provider_ref" = attempt."provider_execution_ref"
          WHEN 'provider_checkpoint' THEN
            attempt."state" = 'checkpointing'
            AND left(execution."state", 9) <> 'terminal_'
            AND "foundry_classify_normalize_mesh_glb_v0_job_spec"(
                  job."job_spec_json"
                ) = 'unrelated'
            AND NOT EXISTS (
              SELECT 1
              FROM "foundry_job_worker_profiles" derivative_worker_binding
              WHERE derivative_worker_binding."job_id" = job."job_id"
                AND derivative_worker_binding."project_id" = job."project_id"
                AND derivative_worker_binding."operation_class" =
                      'deterministic_transformation'
            )
            AND NOT attempt."cancel_requested"
            AND attempt."provider_execution_ref" IS NOT NULL
            AND stored."target_provider_ref" = attempt."provider_execution_ref"
            AND "foundry_rights_policy_is_active"(
                  execution."rights_policy_version",
                  execution."rights_policy_definition_sha256",
                  execution."rights_policy_generation",
                  database_clock."now" + make_interval(
                    secs => stored."maximum_api_call_seconds" + 1
                  )
                )
            AND EXISTS (
              SELECT 1
              FROM "foundry_rights_approvals" rights
              WHERE rights."id" = execution."rights_approval_id"
                AND rights."rights_approval_sha256" = execution."rights_approval_sha256"
                AND rights."expires_at" > database_clock."now" + make_interval(
                      secs => stored."maximum_api_call_seconds" + 1
                    )
            )
            AND profile."reviewed_at" <= database_clock."now"
            AND profile."expires_at" > database_clock."now" + make_interval(
                  secs => stored."maximum_api_call_seconds" + 1
                )
          WHEN 'provider_stop' THEN
            attempt."state" = 'terminating'
            AND left(execution."state", 9) <> 'terminal_'
            AND attempt."cancel_requested"
            AND attempt."provider_execution_ref" IS NOT NULL
            AND stored."target_provider_ref" = attempt."provider_execution_ref"
            AND stored."stop_intent_id" IS NOT NULL
          ELSE false
        END
      FOR UPDATE OF stored, attempt, execution
    ), prior_event AS MATERIALIZED (
      SELECT COALESCE(MAX(event."sequence"), 0) + 1 AS "next_sequence",
             COALESCE(MAX(event."resulting_revision"), 0) AS "prior_revision"
      FROM "foundry_execution_events" event
      JOIN locked ON locked."execution_id" = event."execution_id"
    ), invocation_payload AS MATERIALIZED (
      SELECT locked.*,
             jsonb_build_object(
               'schemaVersion', ${INVOCATION_EVENT_SCHEMA_VERSION}::text,
               'commandId', locked."id"::text,
               'executionSubjectSha256', locked."execution_subject_sha256",
               'preparedProviderRequestId', locked."exact_prepared_request_id"::text,
               'providerRequestProfileSha256', locked."provider_request_profile_sha256",
               'providerRequestSha256', locked."provider_request_sha256",
               'providerIdempotencyKey', locked."provider_idempotency_key",
               'claimToken', locked."claim_token"::text,
               'fencingToken', locked."fencing_token"::text,
               'claimedBy', locked."claimed_by"
             ) AS "event_payload"
      FROM locked
    )
    INSERT INTO "foundry_execution_events" (
      "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "execution_subject_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "attempt_id", "attempt_ordinal",
      "fencing_token", "provider_command_id", "provider_command_kind",
      "claim_token", "provider_command_payload_sha256", "provider_request_sha256",
      "provider_idempotency_key", "maximum_api_call_seconds",
      "provider_command_state", "provider_command_outcome_sha256",
      "provider_lifecycle_state", "provider_was_invoked", "sequence",
      "event_kind", "advances_projection", "payload", "actor_kind", "actor_key",
      "actor_user_id", "idempotency_key", "causation_id", "correlation_id",
      "expected_revision", "resulting_revision", "request_digest"
    )
    SELECT
      invocation."execution_id", invocation."project_id", invocation."job_id",
      invocation."execution_envelope_sha256", invocation."execution_subject_sha256",
      invocation."provider_kind", invocation."provider_adapter_id",
      invocation."provider_adapter_version",
      invocation."provider_adapter_artifact_sha256",
      invocation."provider_deployment_sha256", invocation."attempt_id",
      invocation."attempt_ordinal", invocation."fencing_token", invocation."id",
      invocation."command_kind", invocation."claim_token", invocation."payload_sha256",
      invocation."provider_request_sha256", invocation."provider_idempotency_key",
      invocation."maximum_api_call_seconds", NULL, NULL, NULL, NULL,
      prior_event."next_sequence", 'provider_invocation_started', false,
      invocation."event_payload", 'service', invocation."claimed_by", NULL,
      'provider-invocation-start:' || invocation."id"::text || ':' ||
        invocation."claim_token"::text,
      invocation."id", invocation."correlation_id", prior_event."prior_revision",
      prior_event."prior_revision",
      "foundry_domain_jsonb_sha256"(
        ${INVOCATION_EVENT_DIGEST_DOMAIN}::text, invocation."event_payload"
      )
    FROM invocation_payload invocation
    CROSS JOIN prior_event
    WHERE invocation."execution_revision" = prior_event."prior_revision"
    RETURNING "provider_command_id"::text AS "command_id", "event_kind"
  `);
  const row = singleRowOrNull(result, "Foundry provider invocation authorization");
  if (row === null) {
    return { authorized: false, reasonCode: "claim_authority_not_current" };
  }
  if (
    requireString(row, "command_id") !== command.commandId ||
    requireString(row, "event_kind") !== "provider_invocation_started"
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned an ambiguous provider invocation-start receipt.",
    );
  }
  return { authorized: true };
}

interface TerminalCommandRow {
  readonly commandId: string;
  readonly state: string;
  readonly outcomeSha256: string;
  readonly replayed: boolean;
}

async function selectExactTerminalReplay(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  providerWasInvoked: boolean,
): Promise<TerminalCommandRow | null> {
  const invocationPredicate = providerWasInvoked
    ? sql`EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = stored."id"
          AND invocation."claim_token" = stored."claim_token"
          AND invocation."correlation_id" = stored."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`
    : sql`NOT EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = stored."id"
          AND invocation."claim_token" = stored."claim_token"
          AND invocation."correlation_id" = stored."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`;
  const result = await transaction.execute(sql`
    WITH exact_terminal AS MATERIALIZED (
      SELECT stored.*
      FROM "foundry_provider_commands" stored
      JOIN "foundry_attempts" attempt
        ON attempt."id" = stored."attempt_id"
       AND attempt."execution_id" = stored."execution_id"
       AND attempt."fencing_token" = stored."fencing_token"
      JOIN "foundry_executions" execution
        ON execution."id" = stored."execution_id"
       AND execution."fencing_token" = stored."fencing_token"
       AND execution."execution_subject_sha256" = stored."execution_subject_sha256"
      WHERE ${exactClaimIdentityPredicates(command)}
        AND stored."state" = ${outcome.status}
        AND stored."outcome_json" = ${JSON.stringify(outcome)}::jsonb
        AND stored."outcome_sha256" = ${outcomeSha256}
        AND stored."provider_lifecycle_state" = ${outcome.providerLifecycle}
        AND stored."provider_command_ref" IS NOT DISTINCT FROM
              ${outcome.providerCommandRef}
        AND stored."completed_by_actor_kind" = ${outcome.completedBy.actorKind}
        AND stored."completed_by_actor_key" = ${outcome.completedBy.actorKey}
        AND ${invocationPredicate}
      FOR UPDATE OF stored, attempt, execution
    )
    SELECT stored."id"::text AS "command_id", stored."state",
           stored."outcome_sha256"
    FROM exact_terminal stored
    WHERE EXISTS (
      SELECT 1
      FROM "foundry_execution_events" event
      WHERE event."provider_command_id" = stored."id"
        AND event."event_kind" = 'provider_command_completed'
        AND event."execution_id" = stored."execution_id"
        AND event."attempt_id" = stored."attempt_id"
        AND event."fencing_token" = stored."fencing_token"
        AND event."provider_command_kind" = stored."command_kind"
        AND event."claim_token" = stored."claim_token"
        AND event."provider_command_payload_sha256" = stored."payload_sha256"
        AND event."provider_request_sha256" = stored."provider_request_sha256"
        AND event."provider_idempotency_key" = stored."provider_idempotency_key"
        AND event."maximum_api_call_seconds" = stored."maximum_api_call_seconds"
        AND event."provider_command_state" = stored."state"
        AND event."provider_command_outcome_sha256" = stored."outcome_sha256"
        AND event."provider_lifecycle_state" = stored."provider_lifecycle_state"
        AND event."provider_was_invoked" = ${providerWasInvoked}
        AND event."payload" = stored."outcome_json"
        AND event."actor_kind" = stored."completed_by_actor_kind"
        AND event."actor_key" = stored."completed_by_actor_key"
        AND event."actor_user_id" IS NULL
        AND event."idempotency_key" =
              'provider-command-completion:' || stored."id"::text
        AND event."causation_id" = stored."id"
        AND event."correlation_id" = stored."correlation_id"
        AND event."recorded_at" = stored."completed_at"
        AND event."request_digest" = "foundry_domain_jsonb_sha256"(
              ${COMPLETION_EVENT_DIGEST_DOMAIN}::text, stored."outcome_json"
            )
    )
  `);
  const row = singleRowOrNull(result, "Foundry provider-command terminal replay");
  if (row === null) return null;
  const terminal = {
    commandId: requireString(row, "command_id"),
    state: requireString(row, "state"),
    outcomeSha256: requireString(row, "outcome_sha256"),
    replayed: true,
  };
  if (
    terminal.commandId !== command.commandId ||
    terminal.state !== outcome.status ||
    terminal.outcomeSha256 !== outcomeSha256
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned an ambiguous provider-command terminal replay receipt.",
    );
  }
  return terminal;
}

async function updateTerminalCommand(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  providerWasInvoked: boolean,
): Promise<TerminalCommandRow | null> {
  const invocationPredicate = providerWasInvoked
    ? sql`EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = stored."id"
          AND invocation."claim_token" = stored."claim_token"
          AND invocation."correlation_id" = stored."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`
    : sql`NOT EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = stored."id"
          AND invocation."claim_token" = stored."claim_token"
          AND invocation."correlation_id" = stored."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`;
  const result = await transaction.execute(sql`
    WITH locked AS MATERIALIZED (
      SELECT stored."id", stored."revision"
      FROM "foundry_provider_commands" stored
      JOIN "foundry_attempts" attempt
        ON attempt."id" = stored."attempt_id"
       AND attempt."execution_id" = stored."execution_id"
       AND attempt."fencing_token" = stored."fencing_token"
      JOIN "foundry_executions" execution
        ON execution."id" = stored."execution_id"
       AND execution."fencing_token" = stored."fencing_token"
       AND execution."execution_subject_sha256" = stored."execution_subject_sha256"
      WHERE ${exactClaimPredicates(command)}
        AND stored."revision" > 0
        AND ${invocationPredicate}
      FOR UPDATE OF stored, attempt, execution
    ), updated AS (
      UPDATE "foundry_provider_commands" stored
      SET "state" = ${outcome.status},
          "outcome_json" = ${JSON.stringify(outcome)}::jsonb,
          "outcome_sha256" = ${outcomeSha256},
          "provider_lifecycle_state" = ${outcome.providerLifecycle},
          "provider_command_ref" = ${outcome.providerCommandRef},
          "completed_by_actor_kind" = ${outcome.completedBy.actorKind},
          "completed_by_actor_key" = ${outcome.completedBy.actorKey},
          "revision" = stored."revision" + 1
      FROM locked
      WHERE stored."id" = locked."id"
        AND stored."revision" = locked."revision"
        AND stored."state" = 'claimed'
      RETURNING stored."id"::text AS "command_id", stored."state",
                stored."outcome_sha256"
    )
    SELECT * FROM updated
  `);
  const row = singleRowOrNull(result, "Foundry provider-command terminal CAS");
  if (row === null) {
    const replay = await selectExactTerminalReplay(
      transaction,
      command,
      outcome,
      outcomeSha256,
      providerWasInvoked,
    );
    if (replay !== null) return replay;
    return null;
  }
  const terminal = {
    commandId: requireString(row, "command_id"),
    state: requireString(row, "state"),
    outcomeSha256: requireString(row, "outcome_sha256"),
    replayed: false,
  };
  if (
    terminal.commandId !== command.commandId ||
    terminal.state !== outcome.status ||
    terminal.outcomeSha256 !== outcomeSha256
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned an ambiguous provider-command terminal CAS receipt.",
    );
  }
  return terminal;
}

async function insertCompletionEvent(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  providerWasInvoked: boolean,
): Promise<void> {
  const invocationPredicate = providerWasInvoked
    ? sql`EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = command."id"
          AND invocation."claim_token" = command."claim_token"
          AND invocation."correlation_id" = command."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`
    : sql`NOT EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = command."id"
          AND invocation."claim_token" = command."claim_token"
          AND invocation."correlation_id" = command."correlation_id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )`;
  const result = await transaction.execute(sql`
    WITH exact_command AS MATERIALIZED (
      SELECT command.*, execution."revision" AS "execution_revision"
      FROM "foundry_provider_commands" command
      JOIN "foundry_executions" execution
        ON execution."id" = command."execution_id"
       AND execution."fencing_token" = command."fencing_token"
       AND execution."execution_subject_sha256" = command."execution_subject_sha256"
      WHERE command."id" = ${command.commandId}::uuid
        AND command."execution_id" = ${command.executionId}::uuid
        AND command."attempt_id" = ${command.attemptId}::uuid
        AND command."execution_subject_sha256" =
              ${command.payload.executionSubjectSha256}
        AND command."fencing_token" = ${command.fencingToken}::bigint
        AND command."claim_token" = ${command.claimToken}::uuid
        AND command."claimed_by" = ${command.claimedBy}
        AND command."state" = ${outcome.status}
        AND command."outcome_json" = ${JSON.stringify(outcome)}::jsonb
        AND command."outcome_sha256" = ${outcomeSha256}
        AND command."provider_lifecycle_state" = ${outcome.providerLifecycle}
        AND command."provider_command_ref" IS NOT DISTINCT FROM
              ${outcome.providerCommandRef}
        AND command."completed_by_actor_kind" = ${outcome.completedBy.actorKind}
        AND command."completed_by_actor_key" = ${outcome.completedBy.actorKey}
        AND ${invocationPredicate}
      FOR UPDATE OF command, execution
    ), prior_event AS MATERIALIZED (
      SELECT COALESCE(MAX(event."sequence"), 0) + 1 AS "next_sequence",
             COALESCE(MAX(event."resulting_revision"), 0) AS "prior_revision"
      FROM "foundry_execution_events" event
      JOIN exact_command command
        ON command."execution_id" = event."execution_id"
    )
    INSERT INTO "foundry_execution_events" (
      "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "execution_subject_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "attempt_id", "attempt_ordinal",
      "fencing_token", "provider_command_id", "provider_command_kind",
      "claim_token", "provider_command_payload_sha256", "provider_request_sha256",
      "provider_idempotency_key", "maximum_api_call_seconds",
      "provider_command_state", "provider_command_outcome_sha256",
      "provider_lifecycle_state", "provider_was_invoked", "sequence",
      "event_kind", "advances_projection", "payload", "actor_kind", "actor_key",
      "actor_user_id", "idempotency_key", "causation_id", "correlation_id",
      "expected_revision", "resulting_revision", "request_digest", "recorded_at"
    )
    SELECT
      command."execution_id", command."project_id", command."job_id",
      command."execution_envelope_sha256", command."execution_subject_sha256",
      command."provider_kind", command."provider_adapter_id",
      command."provider_adapter_version", command."provider_adapter_artifact_sha256",
      command."provider_deployment_sha256", command."attempt_id",
      command."attempt_ordinal", command."fencing_token", command."id",
      command."command_kind", command."claim_token", command."payload_sha256",
      command."provider_request_sha256", command."provider_idempotency_key",
      command."maximum_api_call_seconds", command."state", command."outcome_sha256",
      command."provider_lifecycle_state", ${providerWasInvoked},
      prior_event."next_sequence", 'provider_command_completed',
      command."execution_revision" = prior_event."prior_revision" + 1,
      command."outcome_json", command."completed_by_actor_kind",
      command."completed_by_actor_key", NULL,
      'provider-command-completion:' || command."id"::text,
      command."id", command."correlation_id", prior_event."prior_revision",
      command."execution_revision",
      "foundry_domain_jsonb_sha256"(
        ${COMPLETION_EVENT_DIGEST_DOMAIN}::text, command."outcome_json"
      ),
      command."completed_at"
    FROM exact_command command
    CROSS JOIN prior_event
    WHERE command."execution_revision" - prior_event."prior_revision" IN (0, 1)
    RETURNING "provider_command_id"::text AS "command_id", "event_kind",
              "provider_command_outcome_sha256" AS "outcome_sha256",
              "provider_was_invoked"
  `);
  const row = singleRowOrNull(result, "Foundry provider-command completion event");
  if (row === null) {
    throw new FoundryPostgresProviderCommandStoreError(
      "The provider-command completion ledger CAS disappeared after its terminal update.",
    );
  }
  if (
    requireString(row, "command_id") !== command.commandId ||
    requireString(row, "event_kind") !== "provider_command_completed" ||
    requireString(row, "outcome_sha256") !== outcomeSha256 ||
    row["provider_was_invoked"] !== providerWasInvoked
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned an ambiguous provider-command completion event receipt.",
    );
  }
}

async function insertVerifiedCheckpoint(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  evidence: FoundryVerifiedCheckpointEvidenceV0,
): Promise<void> {
  const result = await transaction.execute(sql`
    WITH next_checkpoint AS MATERIALIZED (
      SELECT COALESCE(MAX(checkpoint."checkpoint_sequence"), 0) + 1 AS "sequence"
      FROM "foundry_verified_checkpoints" checkpoint
      WHERE checkpoint."attempt_id" = ${command.attemptId}::uuid
    )
    INSERT INTO "foundry_verified_checkpoints" (
      "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "provider_kind", "provider_adapter_id", "provider_adapter_version",
      "provider_adapter_artifact_sha256", "provider_deployment_sha256",
      "attempt_id", "attempt_ordinal", "fencing_token", "provider_command_id",
      "provider_command_outcome_sha256", "checkpoint_sequence", "checkpoint_kind",
      "provider_checkpoint_id", "checkpoint_sha256", "evidence_ref",
      "provider_created_at", "verified_by", "idempotency_key", "causation_id",
      "correlation_id", "request_digest"
    )
    SELECT
      command."execution_id", command."project_id", command."job_id",
      command."execution_envelope_sha256", command."provider_kind",
      command."provider_adapter_id", command."provider_adapter_version",
      command."provider_adapter_artifact_sha256", command."provider_deployment_sha256",
      command."attempt_id", command."attempt_ordinal", command."fencing_token",
      command."id", command."outcome_sha256", next_checkpoint."sequence",
      ${evidence.checkpointKind}, ${evidence.providerCheckpointId},
      ${evidence.checkpointSha256}, ${evidence.evidenceRef},
      ${evidence.providerCreatedAt}::timestamptz, ${outcome.completedBy.actorKey},
      ${`verified-checkpoint:${command.commandId}`}, command."id",
      command."correlation_id", ${outcomeSha256}
    FROM "foundry_provider_commands" command
    CROSS JOIN next_checkpoint
    WHERE command."id" = ${command.commandId}::uuid
      AND command."execution_id" = ${command.executionId}::uuid
      AND command."attempt_id" = ${command.attemptId}::uuid
      AND command."fencing_token" = ${command.fencingToken}::bigint
      AND command."command_kind" = 'provider_checkpoint'
      AND command."state" = 'succeeded'
      AND command."outcome_sha256" = ${outcomeSha256}
      AND command."completed_by_actor_kind" = 'service'
      AND command."completed_by_actor_key" = ${outcome.completedBy.actorKey}
    RETURNING "provider_command_id"::text AS "command_id",
              "provider_command_outcome_sha256" AS "outcome_sha256"
  `);
  const row = singleRowOrNull(result, "Foundry verified checkpoint insert");
  if (
    row === null ||
    requireString(row, "command_id") !== command.commandId ||
    requireString(row, "outcome_sha256") !== outcomeSha256
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "The exact succeeded checkpoint could not retain verified checkpoint evidence.",
    );
  }
}

type CustodySuccessorKind = "provider_reconcile" | "provider_stop";

async function insertCustodySuccessor(
  transaction: FoundryPostgresProviderCommandTransaction,
  sourceCommandId: string,
  successorKind: CustodySuccessorKind,
  actorKind: "service" | "watchdog" | "system",
  actorKey: string,
  stopIntentId: string | null,
): Promise<void> {
  const result = await transaction.execute(sql`
    WITH source AS MATERIALIZED (
      SELECT source.*,
             attempt."provider_execution_ref" AS "attempt_provider_execution_ref"
      FROM "foundry_provider_commands" source
      JOIN "foundry_attempts" attempt
        ON attempt."id" = source."attempt_id"
       AND attempt."execution_id" = source."execution_id"
       AND attempt."fencing_token" = source."fencing_token"
      WHERE source."id" = ${sourceCommandId}::uuid
        AND source."state" IN ('succeeded', 'failed', 'uncertain')
        AND source."completed_by_actor_kind" = ${actorKind}
        AND source."completed_by_actor_key" = ${actorKey}
      FOR UPDATE OF source, attempt
    ), original_submit AS MATERIALIZED (
      SELECT submit.*
      FROM "foundry_provider_commands" submit
      JOIN source ON source."attempt_id" = submit."attempt_id"
                 AND source."fencing_token" = submit."fencing_token"
      WHERE submit."command_kind" = 'provider_submit'
    ), selected_stop_intent AS MATERIALIZED (
      SELECT intent.*
      FROM "foundry_stop_intents" intent
      JOIN source ON source."attempt_id" = intent."attempt_id"
                 AND source."fencing_token" = intent."fencing_token"
      WHERE ${successorKind} = 'provider_stop'
        AND intent."id" = ${stopIntentId}::uuid
    ), next_sequence AS MATERIALIZED (
      SELECT COALESCE(MAX(command."command_sequence"), 0) + 1 AS "value"
      FROM "foundry_provider_commands" command
      JOIN source ON source."attempt_id" = command."attempt_id"
    ), identity_hashes AS MATERIALIZED (
      SELECT
        encode(sha256(convert_to(
          'omnitwin.foundry.provider-custody-command.v0' || E'\n' ||
          source."id"::text || E'\n' || ${successorKind}, 'UTF8'
        )), 'hex') AS "command_hash",
        encode(sha256(convert_to(
          'omnitwin.foundry.provider-custody-prepared.v0' || E'\n' ||
          source."id"::text || E'\n' || ${successorKind}, 'UTF8'
        )), 'hex') AS "prepared_hash"
      FROM source
    ), identity AS MATERIALIZED (
      SELECT
        (substr("command_hash", 1, 8) || '-' || substr("command_hash", 9, 4) ||
         '-5' || substr("command_hash", 14, 3) || '-a' ||
         substr("command_hash", 18, 3) || '-' || substr("command_hash", 21, 12))::uuid
          AS "command_id",
        (substr("prepared_hash", 1, 8) || '-' || substr("prepared_hash", 9, 4) ||
         '-5' || substr("prepared_hash", 14, 3) || '-a' ||
         substr("prepared_hash", 18, 3) || '-' || substr("prepared_hash", 21, 12))::uuid
          AS "prepared_id"
      FROM identity_hashes
    ), request_material AS MATERIALIZED (
      SELECT source.*, original_submit."id" AS "submit_id",
             original_submit."provider_request_sha256" AS "submit_request_sha256",
             original_submit."payload"->'providerRequest' AS "submit_authorization",
             next_sequence."value" AS "next_sequence", identity."command_id",
             identity."prepared_id", selected_stop_intent."id" AS "selected_stop_intent_id",
             'foundry-' || replace(${successorKind}, 'provider_', '') || '-' ||
               replace(identity."command_id"::text, '-', '') AS "client_request_id"
      FROM source
      CROSS JOIN original_submit
      CROSS JOIN next_sequence
      CROSS JOIN identity
      LEFT JOIN selected_stop_intent ON true
      WHERE (${successorKind} = 'provider_reconcile' AND ${stopIntentId}::uuid IS NULL)
         OR (${successorKind} = 'provider_stop' AND selected_stop_intent."id" IS NOT NULL)
    ), authorization_material AS MATERIALIZED (
      SELECT request_material.*,
        request_material."submit_authorization" || jsonb_build_object(
          'commandKind', ${successorKind},
          'commandId', request_material."command_id"::text,
          'commandSequence', request_material."next_sequence",
          'preparedAt', to_char(
            date_trunc('milliseconds', transaction_timestamp()) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'requestIdentity', request_material."submit_authorization"->'requestIdentity' ||
            jsonb_build_object('clientRequestId', request_material."client_request_id"),
          'action', CASE ${successorKind}
            WHEN 'provider_reconcile' THEN jsonb_build_object(
              'kind', 'provider_reconcile',
              'providerCommandRef',
                request_material."attempt_provider_execution_ref",
              'submitCommandId', request_material."submit_id"::text,
              'submitProviderRequestAuthorizationSha256',
                request_material."submit_request_sha256"
            )
            ELSE jsonb_build_object(
              'kind', 'provider_stop',
              'providerCommandRef',
                request_material."attempt_provider_execution_ref",
              'stopIntentId', request_material."selected_stop_intent_id"::text
            )
          END
        ) AS "authorization"
      FROM request_material
    ), request_digest AS MATERIALIZED (
      SELECT authorization_material.*,
        "foundry_domain_jsonb_sha256"(
          'omnitwin.foundry.provider-request-authorization.v0', "authorization"
        ) AS "authorization_sha256"
      FROM authorization_material
    ), command_material AS MATERIALIZED (
      SELECT request_digest.*,
        jsonb_build_object(
          'commandKind', ${successorKind},
          'executionSubjectSha256', "execution_subject_sha256",
          'providerRequest', "authorization",
          'providerRequestSha256', "authorization_sha256",
          'providerIdempotencyKey', "provider_idempotency_key",
          'stageIds', "stage_ids",
          'maximumApiCallSeconds', "maximum_api_call_seconds",
          'providerCommandRef', "attempt_provider_execution_ref",
          'submitLineage', CASE ${successorKind}
            WHEN 'provider_reconcile' THEN jsonb_build_object(
              'submitCommandId', "submit_id"::text,
              'executionSubjectSha256', "execution_subject_sha256",
              'providerIdempotencyKey', "provider_idempotency_key",
              'providerRequestSha256', "submit_request_sha256"
            ) ELSE NULL END,
          'stopIntentId', CASE ${successorKind}
            WHEN 'provider_stop' THEN to_jsonb("selected_stop_intent_id"::text)
            ELSE NULL END
        ) AS "command_payload"
      FROM request_digest
    ), command_digest AS MATERIALIZED (
      SELECT command_material.*,
        "foundry_domain_jsonb_sha256"(
          'omnitwin.foundry.provider-command-payload.v0', "command_payload"
        ) AS "command_payload_sha256"
      FROM command_material
    ), prepared AS (
      INSERT INTO "foundry_prepared_provider_requests" (
        "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
        "execution_subject_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version", "provider_adapter_artifact_sha256",
        "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
        "command_kind", "provider_command_id", "command_sequence", "stop_intent_id",
        "provider_request_sha256", "provider_request_json", "provider_request_profile_id",
        "provider_request_profile_version", "provider_request_profile_sha256",
        "provider_adapter_configuration_sha256", "provider_idempotency_key",
        "provider_client_request_id", "stage_ids", "maximum_api_call_seconds",
        "prepared_by_actor_kind", "prepared_by_actor_key", "prepared_by_user_id",
        "idempotency_key", "request_digest"
      )
      SELECT
        "prepared_id", "execution_id", "project_id", "job_id",
        "execution_envelope_sha256", "execution_subject_sha256", "provider_kind",
        "provider_adapter_id", "provider_adapter_version",
        "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_id",
        "attempt_ordinal", "fencing_token", ${successorKind}, "command_id",
        "next_sequence", "selected_stop_intent_id", "authorization_sha256",
        "authorization", "provider_request_profile_id", "provider_request_profile_version",
        "provider_request_profile_sha256", "provider_adapter_configuration_sha256",
        "provider_idempotency_key", "client_request_id", "stage_ids",
        "maximum_api_call_seconds", ${actorKind}, ${actorKey}, NULL,
        'custody-prepared-' || replace(${successorKind}, 'provider_', '') || '-' ||
          ${sourceCommandId}, "authorization_sha256"
      FROM command_digest
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "foundry_provider_commands" (
        "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
        "execution_subject_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version", "provider_adapter_artifact_sha256",
        "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
        "command_sequence", "command_kind", "prepared_provider_request_id",
        "stop_intent_id", "state", "payload", "payload_sha256",
        "provider_request_sha256", "provider_request_profile_id",
        "provider_request_profile_version", "provider_request_profile_sha256",
        "provider_adapter_configuration_sha256", "provider_idempotency_key",
        "provider_client_request_id", "stage_ids", "maximum_api_call_seconds",
        "target_provider_ref", "originating_submit_command_id",
        "originating_submit_provider_request_sha256",
        "originating_submit_provider_idempotency_key", "available_at",
        "created_by_actor_kind", "created_by_actor_key", "created_by_user_id",
        "idempotency_key", "causation_id", "correlation_id", "request_digest"
      )
      SELECT
        "command_id", "execution_id", "project_id", "job_id",
        "execution_envelope_sha256", "execution_subject_sha256", "provider_kind",
        "provider_adapter_id", "provider_adapter_version",
        "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_id",
        "attempt_ordinal", "fencing_token", "next_sequence", ${successorKind},
        "prepared_id", "selected_stop_intent_id", 'pending', "command_payload",
        "command_payload_sha256", "authorization_sha256", "provider_request_profile_id",
        "provider_request_profile_version", "provider_request_profile_sha256",
        "provider_adapter_configuration_sha256", "provider_idempotency_key",
        "client_request_id", "stage_ids", "maximum_api_call_seconds",
        "attempt_provider_execution_ref",
        CASE ${successorKind} WHEN 'provider_reconcile' THEN "submit_id" ELSE NULL END,
        CASE ${successorKind} WHEN 'provider_reconcile' THEN "submit_request_sha256" ELSE NULL END,
        CASE ${successorKind} WHEN 'provider_reconcile' THEN "provider_idempotency_key" ELSE NULL END,
        transaction_timestamp(), ${actorKind}, ${actorKey}, NULL,
        'custody-command-' || replace(${successorKind}, 'provider_', '') || '-' ||
          ${sourceCommandId},
        CASE ${successorKind}
          WHEN 'provider_stop' THEN "selected_stop_intent_id" ELSE ${sourceCommandId}::uuid END,
        "correlation_id", "command_payload_sha256"
      FROM command_digest
      JOIN prepared ON prepared."id" = command_digest."prepared_id"
      RETURNING "id"::text AS "command_id", "command_kind"
    )
    SELECT * FROM inserted
  `);
  const row = singleRowOrNull(result, `Foundry ${successorKind} custody insert`);
  if (row === null || requireString(row, "command_kind") !== successorKind) {
    throw new FoundryPostgresProviderCommandStoreError(
      `The terminal provider command could not retain exact ${successorKind} custody.`,
    );
  }
}

async function insertCheckpointUnknownStopIntent(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
): Promise<string> {
  const result = await transaction.execute(sql`
    WITH source AS MATERIALIZED (
      SELECT source.*,
        encode(sha256(convert_to(
          'omnitwin.foundry.checkpoint-unknown-stop-intent.v0' || E'\n' ||
          source."id"::text, 'UTF8'
        )), 'hex') AS "identity_hash"
      FROM "foundry_provider_commands" source
      WHERE source."id" = ${command.commandId}::uuid
        AND source."execution_id" = ${command.executionId}::uuid
        AND source."attempt_id" = ${command.attemptId}::uuid
        AND source."fencing_token" = ${command.fencingToken}::bigint
        AND source."command_kind" = 'provider_checkpoint'
        AND source."state" = 'uncertain'
        AND source."outcome_sha256" = ${outcomeSha256}
        AND source."completed_by_actor_kind" = ${outcome.completedBy.actorKind}
        AND source."completed_by_actor_key" = ${outcome.completedBy.actorKey}
    ), identified AS MATERIALIZED (
      SELECT source.*,
        (substr("identity_hash", 1, 8) || '-' || substr("identity_hash", 9, 4) ||
         '-5' || substr("identity_hash", 14, 3) || '-a' ||
         substr("identity_hash", 18, 3) || '-' || substr("identity_hash", 21, 12))::uuid
          AS "intent_id"
      FROM source
    )
    INSERT INTO "foundry_stop_intents" (
      "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
      "execution_subject_sha256", "provider_kind", "provider_adapter_id",
      "provider_adapter_version", "provider_adapter_artifact_sha256",
      "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
      "reason_code", "priority", "target_terminal_state", "source_kind", "source_id",
      "source_digest", "source_recorded_at", "actor_kind", "actor_key", "actor_user_id",
      "idempotency_key", "causation_id", "correlation_id", "request_digest"
    )
    SELECT
      "intent_id", "execution_id", "project_id", "job_id",
      "execution_envelope_sha256", "execution_subject_sha256", "provider_kind",
      "provider_adapter_id", "provider_adapter_version",
      "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_id",
      "attempt_ordinal", "fencing_token", 'checkpoint_effect_unknown', 390,
      'terminal_provider_lost', 'provider_command', "id", "outcome_sha256",
      "completed_at", "completed_by_actor_kind", "completed_by_actor_key", NULL,
      'checkpoint-unknown-stop-intent:' || "id"::text, "id", "correlation_id",
      "outcome_sha256"
    FROM identified
    RETURNING "id"::text AS "intent_id"
  `);
  const row = singleRowOrNull(result, "Foundry checkpoint-unknown stop intent");
  if (row === null) {
    throw new FoundryPostgresProviderCommandStoreError(
      "An uncertain provider checkpoint could not retain its exact containment intent.",
    );
  }
  return requireString(row, "intent_id");
}

async function needsCheckpointUnknownContainment(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
): Promise<boolean> {
  if (command.commandKind !== "provider_checkpoint" || outcome.status !== "uncertain") {
    return false;
  }
  const result = await transaction.execute(sql`
    SELECT attempt."id"::text AS "attempt_id"
    FROM "foundry_attempts" attempt
    WHERE attempt."id" = ${command.attemptId}::uuid
      AND attempt."execution_id" = ${command.executionId}::uuid
      AND attempt."fencing_token" = ${command.fencingToken}::bigint
      AND left(attempt."state", 9) <> 'terminal_'
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_provider_commands" terminal_stop
        JOIN "foundry_execution_events" terminal_stop_event
          ON terminal_stop_event."provider_command_id" = terminal_stop."id"
         AND terminal_stop_event."event_kind" = 'provider_command_completed'
         AND terminal_stop_event."provider_command_state" = terminal_stop."state"
         AND terminal_stop_event."provider_command_outcome_sha256" =
               terminal_stop."outcome_sha256"
         AND terminal_stop_event."payload" = terminal_stop."outcome_json"
        WHERE terminal_stop."attempt_id" = attempt."id"
          AND terminal_stop."fencing_token" = attempt."fencing_token"
          AND terminal_stop."command_kind" = 'provider_stop'
          AND terminal_stop."command_sequence" > ${command.commandSequence}
          AND terminal_stop."target_provider_ref" =
                ${command.payload.providerCommandRef}
          AND (
            terminal_stop."state" = 'succeeded'
            OR (
              terminal_stop."state" = 'failed'
              AND terminal_stop."provider_lifecycle_state" = 'not_found'
            )
          )
          AND terminal_stop."provider_lifecycle_state" IN (
            'exited', 'terminated', 'not_found'
          )
      )
    FOR UPDATE
  `);
  return singleRowOrNull(result, "Foundry checkpoint-unknown containment check") !== null;
}

async function requiredStopIntent(
  transaction: FoundryPostgresProviderCommandTransaction,
  sourceCommandId: string,
  exactCheckpointIntentId: string | null,
): Promise<string | null> {
  const result = await transaction.execute(sql`
    WITH source AS MATERIALIZED (
      SELECT source."id", source."attempt_id", source."fencing_token"
      FROM "foundry_provider_commands" source
      WHERE source."id" = ${sourceCommandId}::uuid
        AND source."state" IN ('succeeded', 'failed', 'uncertain')
    ), containment AS MATERIALIZED (
      SELECT attempt."id", attempt."fencing_token", attempt."provider_execution_ref"
      FROM "foundry_attempts" attempt
      JOIN source ON source."attempt_id" = attempt."id"
                 AND source."fencing_token" = attempt."fencing_token"
      WHERE attempt."cancel_requested"
        AND attempt."provider_execution_ref" IS NOT NULL
        AND attempt."state" IN ('stop_pending', 'termination_unconfirmed')
        AND NOT EXISTS (
          SELECT 1
          FROM "foundry_provider_commands" active_stop
          WHERE active_stop."attempt_id" = attempt."id"
            AND active_stop."fencing_token" = attempt."fencing_token"
            AND active_stop."command_kind" = 'provider_stop'
            AND active_stop."state" IN ('pending', 'claimed')
            AND active_stop."target_provider_ref" = attempt."provider_execution_ref"
        )
      FOR UPDATE OF attempt
    )
    SELECT intent."id"::text AS "intent_id"
    FROM "foundry_stop_intents" intent
    JOIN containment ON containment."id" = intent."attempt_id"
                    AND containment."fencing_token" = intent."fencing_token"
    WHERE ${exactCheckpointIntentId}::uuid IS NULL
       OR intent."id" = ${exactCheckpointIntentId}::uuid
    ORDER BY
      CASE WHEN intent."id" = ${exactCheckpointIntentId}::uuid THEN 0 ELSE 1 END,
      intent."priority" DESC, intent."recorded_at" ASC, intent."id" ASC
    LIMIT 1
  `);
  const row = singleRowOrNull(result, "Foundry required stop custody selection");
  return row === null ? null : requireString(row, "intent_id");
}

async function needsReconcileCustody(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
): Promise<boolean> {
  if (command.commandKind === "provider_submit") {
    return outcome.status === "uncertain";
  }
  if (
    command.commandKind !== "provider_reconcile" ||
    (outcome.status !== "failed" && outcome.status !== "uncertain")
  ) {
    return false;
  }
  const result = await transaction.execute(sql`
    SELECT attempt."id"::text AS "attempt_id"
    FROM "foundry_attempts" attempt
    WHERE attempt."id" = ${command.attemptId}::uuid
      AND attempt."execution_id" = ${command.executionId}::uuid
      AND attempt."fencing_token" = ${command.fencingToken}::bigint
      AND attempt."provider_execution_ref" IS NULL
      AND attempt."state" IN ('provider_unknown', 'stop_pending')
    FOR UPDATE
  `);
  return singleRowOrNull(result, "Foundry reconcile custody check") !== null;
}

function validateCompletionInput(
  commandInput: FoundryClaimedProviderCommandV0,
  outcomeInput: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  providerWasInvoked: boolean,
  expiredRecovery: boolean,
): {
  readonly command: FoundryClaimedProviderCommandV0;
  readonly outcome: FoundryProviderCommandOutcomePayloadV0;
} {
  const command = FoundryClaimedProviderCommandV0Schema.parse(commandInput);
  computeFoundryProviderCommandOutcomeSha256(outcomeInput);
  const outcome = outcomeInput;
  if (
    outcome.commandId !== command.commandId ||
    outcome.executionId !== command.executionId ||
    outcome.attemptId !== command.attemptId ||
    outcome.claimToken !== command.claimToken ||
    outcome.fencingToken !== command.fencingToken ||
    computeFoundryProviderCommandOutcomeSha256(outcome) !== outcomeSha256
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-command completion input does not bind the exact claim or canonical outcome digest.",
    );
  }
  if (
    (!expiredRecovery &&
      (outcome.completedBy.actorKind !== "service" ||
        outcome.completedBy.actorKey !== command.claimedBy)) ||
    (expiredRecovery &&
      outcome.completedBy.actorKind !== "watchdog" &&
      outcome.completedBy.actorKind !== "system")
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-command completion actor does not match live-worker or expired-lease custody.",
    );
  }
  if (
    !providerWasInvoked &&
    (outcome.status !== "failed" || outcome.providerLifecycle !== "not_observed")
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "An uninvoked provider command can close only as a not-observed failure.",
    );
  }
  if (
    expiredRecovery && providerWasInvoked &&
    (outcome.status !== "uncertain" || outcome.providerLifecycle !== "unknown")
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "An invoked expired provider command can close only as an unknown-effect outcome.",
    );
  }
  return { command, outcome };
}

function adapterOutcomeFromCompletion(
  outcome: FoundryProviderCommandOutcomePayloadV0,
  verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0 | null,
): FoundryProviderAdapterOutcomeV0 {
  const base = {
    status: outcome.status,
    outcomeCode: outcome.outcomeCode,
    providerLifecycle: outcome.providerLifecycle,
    providerCommandRef: outcome.providerCommandRef,
    evidenceSha256: outcome.evidenceSha256,
  };
  return FoundryProviderAdapterOutcomeV0Schema.parse(
    verifiedCheckpoint === null
      ? base
      : { ...base, verifiedCheckpoint },
  );
}

interface ValidatedProviderResultObservationInput {
  readonly command: FoundryClaimedProviderCommandV0;
  readonly adapterOutcome: FoundryProviderAdapterOutcomeV0;
  readonly adapterOutcomeSha256: string;
  readonly workerObservedAt: string;
}

function validateProviderResultObservationInput(
  commandInput: FoundryClaimedProviderCommandV0,
  adapterOutcomeInput: FoundryProviderAdapterOutcomeV0,
  adapterOutcomeSha256: string,
  workerObservedAtInput: string,
): ValidatedProviderResultObservationInput {
  const command = FoundryClaimedProviderCommandV0Schema.parse(commandInput);
  const adapterOutcome = FoundryProviderAdapterOutcomeV0Schema.parse(adapterOutcomeInput);
  const workerObservedAt = FoundryUtcInstantSchema.parse(workerObservedAtInput);
  const contract = validateFoundryProviderOutcomeForCommand(command, adapterOutcome);
  if (
    adapterOutcome.status === "uncertain" ||
    !contract.valid ||
    computeFoundryProviderAdapterOutcomeSha256(adapterOutcome) !== adapterOutcomeSha256
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-result observation evidence must be one exact conclusive canonical adapter outcome for the immutable command.",
    );
  }
  return { command, adapterOutcome, adapterOutcomeSha256, workerObservedAt };
}

function mapProviderResultClassification(
  row: FoundryPostgresProviderCommandRow,
): FoundryProviderResultClassificationDisposition {
  const disposition = requireString(row, "classification_disposition");
  if (![
    "late_eligible",
    "already_authoritative",
    "terminal_conflict",
    "not_eligible",
  ].includes(disposition)) {
    throw new FoundryPostgresProviderCommandStoreError(
      "PostgreSQL returned an unknown provider-result terminal disposition.",
    );
  }
  return {
    status: "classified",
    classificationId: requireString(row, "classification_id"),
    completionEventId: requireString(row, "completion_event_id"),
    disposition: disposition as FoundryProviderResultTerminalDisposition,
    classifiedAt: requireInstant(row, "classified_at"),
  };
}

async function classifyProviderResultObservation(
  transaction: FoundryPostgresProviderCommandTransaction,
  observationId: string,
): Promise<FoundryProviderResultClassificationDisposition | null> {
  const result = await transaction.execute(sql`
    WITH exact_observation AS MATERIALIZED (
      SELECT observation.*
      FROM "foundry_provider_command_result_observations" observation
      WHERE observation."id" = ${observationId}::uuid
      FOR UPDATE
    ), exact_completion AS MATERIALIZED (
      SELECT completion.*, command."outcome_sha256" AS "terminal_outcome_sha256"
      FROM exact_observation observation
      JOIN "foundry_provider_commands" command
        ON command."id" = observation."provider_command_id"
       AND command."claim_token" = observation."claim_token"
      JOIN "foundry_execution_events" completion
        ON completion."provider_command_id" = command."id"
       AND completion."event_kind" = 'provider_command_completed'
       AND completion."claim_token" = command."claim_token"
       AND completion."provider_command_outcome_sha256" = command."outcome_sha256"
       AND completion."payload" = command."outcome_json"
      FOR UPDATE OF command, completion
    ), candidate AS MATERIALIZED (
      SELECT observation."id" AS "observation_id",
             observation."provider_command_id", observation."correlation_id",
             completion."id" AS "completion_event_id",
             completion."terminal_outcome_sha256",
             "foundry_provider_result_terminal_disposition"(
               observation."id", completion."id"
             ) AS "disposition"
      FROM exact_observation observation
      JOIN exact_completion completion ON true
    ), inserted AS (
      INSERT INTO "foundry_provider_command_result_classifications" (
        "observation_id", "provider_command_id", "completion_event_id",
        "terminal_outcome_sha256", "disposition", "actor_kind", "actor_key",
        "idempotency_key", "causation_id", "correlation_id", "request_digest"
      )
      SELECT candidate."observation_id", candidate."provider_command_id",
             candidate."completion_event_id", candidate."terminal_outcome_sha256",
             candidate."disposition", 'system',
             'foundry-provider-result-classifier',
             'provider-command-result-classification:' || candidate."observation_id"::text,
             candidate."observation_id", candidate."correlation_id",
             candidate."terminal_outcome_sha256"
      FROM candidate
      WHERE candidate."disposition" IS NOT NULL
      ON CONFLICT ("observation_id") DO NOTHING
      RETURNING "id"::text AS "classification_id",
                "completion_event_id"::text AS "completion_event_id",
                "disposition" AS "classification_disposition", "classified_at"
    ), existing AS MATERIALIZED (
      SELECT classification."id"::text AS "classification_id",
             classification."completion_event_id"::text AS "completion_event_id",
             classification."disposition" AS "classification_disposition",
             classification."classified_at"
      FROM "foundry_provider_command_result_classifications" classification
      JOIN exact_observation observation
        ON observation."id" = classification."observation_id"
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM existing
    WHERE NOT EXISTS (SELECT 1 FROM inserted)
  `);
  const row = singleRowOrNull(result, "Foundry provider-result classification");
  return row === null ? null : mapProviderResultClassification(row);
}

async function classifyExactProviderResultObservation(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
): Promise<{
  readonly observationId: string;
  readonly classification: FoundryProviderResultClassificationDisposition;
} | null> {
  const selected = await transaction.execute(sql`
    SELECT observation."id"::text AS "observation_id"
    FROM "foundry_provider_command_result_observations" observation
    WHERE observation."provider_command_id" = ${command.commandId}::uuid
      AND observation."claim_token" = ${command.claimToken}::uuid
    FOR UPDATE
  `);
  const row = singleRowOrNull(
    selected,
    "Foundry exact provider-result observation selection",
  );
  if (row === null) return null;
  const observationId = requireString(row, "observation_id");
  const classification = await classifyProviderResultObservation(
    transaction,
    observationId,
  );
  return classification === null ? null : { observationId, classification };
}

async function retainProviderResultObservation(
  transaction: FoundryPostgresProviderCommandTransaction,
  input: ValidatedProviderResultObservationInput,
): Promise<FoundryProviderResultObservationDisposition> {
  const { command, adapterOutcome, adapterOutcomeSha256, workerObservedAt } = input;
  const adapterOutcomeJson = JSON.stringify(adapterOutcome);
  const result = await transaction.execute(sql`
    WITH exact_command AS MATERIALIZED (
      SELECT stored.*, invocation."id" AS "invocation_event_id"
      FROM "foundry_provider_commands" stored
      JOIN "foundry_execution_events" invocation
        ON invocation."provider_command_id" = stored."id"
       AND invocation."event_kind" = 'provider_invocation_started'
       AND invocation."claim_token" = stored."claim_token"
       AND invocation."execution_id" = stored."execution_id"
       AND invocation."attempt_id" = stored."attempt_id"
       AND invocation."fencing_token" = stored."fencing_token"
       AND invocation."provider_command_payload_sha256" = stored."payload_sha256"
       AND invocation."provider_request_sha256" = stored."provider_request_sha256"
       AND invocation."actor_kind" = 'service'
       AND invocation."actor_key" = stored."claimed_by"
       AND invocation."correlation_id" = stored."correlation_id"
      WHERE ${exactClaimIdentityPredicates(command)}
      FOR UPDATE OF stored, invocation
    ), inserted AS (
      INSERT INTO "foundry_provider_command_result_observations" (
        "provider_command_id", "invocation_event_id", "execution_id", "project_id", "job_id",
        "execution_envelope_sha256", "execution_subject_sha256", "provider_kind",
        "provider_adapter_id", "provider_adapter_version",
        "provider_adapter_artifact_sha256", "provider_adapter_configuration_sha256",
        "provider_deployment_sha256", "prepared_provider_request_id",
        "provider_request_profile_id", "provider_request_profile_version",
        "provider_request_profile_sha256", "provider_request_sha256",
        "provider_idempotency_key", "provider_client_request_id",
        "maximum_api_call_seconds", "command_payload_sha256",
        "attempt_id", "attempt_ordinal", "fencing_token", "command_sequence",
        "command_kind", "claim_token", "claimed_by", "adapter_outcome_json",
        "adapter_outcome_sha256", "worker_observed_at", "actor_kind", "actor_key",
        "idempotency_key", "causation_id", "correlation_id", "request_digest"
      )
      SELECT
        stored."id", stored."invocation_event_id", stored."execution_id",
        stored."project_id", stored."job_id",
        stored."execution_envelope_sha256", stored."execution_subject_sha256",
        stored."provider_kind", stored."provider_adapter_id",
        stored."provider_adapter_version", stored."provider_adapter_artifact_sha256",
        stored."provider_adapter_configuration_sha256",
        stored."provider_deployment_sha256", stored."prepared_provider_request_id",
        stored."provider_request_profile_id", stored."provider_request_profile_version",
        stored."provider_request_profile_sha256", stored."provider_request_sha256",
        stored."provider_idempotency_key", stored."provider_client_request_id",
        stored."maximum_api_call_seconds", stored."payload_sha256", stored."attempt_id",
        stored."attempt_ordinal", stored."fencing_token", stored."command_sequence",
        stored."command_kind", stored."claim_token", stored."claimed_by",
        ${adapterOutcomeJson}::jsonb, ${adapterOutcomeSha256},
        ${workerObservedAt}::timestamptz, 'service', stored."claimed_by",
        'provider-command-result-observation:' || stored."id"::text || ':' || stored."claim_token"::text,
        stored."invocation_event_id", stored."correlation_id", ${adapterOutcomeSha256}
      FROM exact_command stored
      ON CONFLICT ("provider_command_id", "claim_token") DO NOTHING
      RETURNING "id"::text AS "observation_id",
                "invocation_event_id"::text AS "invocation_event_id",
                "worker_observed_at", "recorded_at"
    ), existing AS MATERIALIZED (
      SELECT observation.*
      FROM "foundry_provider_command_result_observations" observation
      JOIN exact_command stored ON stored."id" = observation."provider_command_id"
      WHERE observation."claim_token" = stored."claim_token"
    ), replayable AS MATERIALIZED (
      SELECT existing.*
      FROM existing
      CROSS JOIN exact_command
      WHERE existing."invocation_event_id" = exact_command."invocation_event_id"
        AND existing."execution_id" = exact_command."execution_id"
        AND existing."project_id" = exact_command."project_id"
        AND existing."job_id" = exact_command."job_id"
        AND existing."execution_envelope_sha256" = exact_command."execution_envelope_sha256"
        AND existing."execution_subject_sha256" = exact_command."execution_subject_sha256"
        AND existing."provider_kind" = exact_command."provider_kind"
        AND existing."provider_adapter_id" = exact_command."provider_adapter_id"
        AND existing."provider_adapter_version" = exact_command."provider_adapter_version"
        AND existing."provider_adapter_artifact_sha256" = exact_command."provider_adapter_artifact_sha256"
        AND existing."provider_adapter_configuration_sha256" = exact_command."provider_adapter_configuration_sha256"
        AND existing."provider_deployment_sha256" = exact_command."provider_deployment_sha256"
        AND existing."prepared_provider_request_id" = exact_command."prepared_provider_request_id"
        AND existing."provider_request_profile_id" = exact_command."provider_request_profile_id"
        AND existing."provider_request_profile_version" = exact_command."provider_request_profile_version"
        AND existing."provider_request_profile_sha256" = exact_command."provider_request_profile_sha256"
        AND existing."provider_request_sha256" = exact_command."provider_request_sha256"
        AND existing."provider_idempotency_key" = exact_command."provider_idempotency_key"
        AND existing."provider_client_request_id" = exact_command."provider_client_request_id"
        AND existing."maximum_api_call_seconds" = exact_command."maximum_api_call_seconds"
        AND existing."command_payload_sha256" = exact_command."payload_sha256"
        AND existing."attempt_id" = exact_command."attempt_id"
        AND existing."attempt_ordinal" = exact_command."attempt_ordinal"
        AND existing."fencing_token" = exact_command."fencing_token"
        AND existing."command_sequence" = exact_command."command_sequence"
        AND existing."command_kind" = exact_command."command_kind"
        AND existing."claimed_by" = exact_command."claimed_by"
        AND existing."adapter_outcome_json" = ${adapterOutcomeJson}::jsonb
        AND existing."adapter_outcome_sha256" = ${adapterOutcomeSha256}
        AND date_trunc('milliseconds', existing."worker_observed_at") =
              ${workerObservedAt}::timestamptz
    ), disposition AS (
      SELECT 'observed'::text AS "disposition", inserted."observation_id",
             inserted."invocation_event_id", inserted."worker_observed_at",
             inserted."recorded_at"
      FROM inserted
      UNION ALL
      SELECT 'replayed', replayable."id"::text,
             replayable."invocation_event_id"::text, replayable."worker_observed_at",
             replayable."recorded_at"
      FROM replayable
      WHERE NOT EXISTS (SELECT 1 FROM inserted)
      UNION ALL
      SELECT 'conflict', existing."id"::text,
             existing."invocation_event_id"::text, existing."worker_observed_at",
             existing."recorded_at"
      FROM existing
      WHERE NOT EXISTS (SELECT 1 FROM inserted)
        AND NOT EXISTS (SELECT 1 FROM replayable)
    )
    SELECT * FROM disposition
  `);
  const row = singleRowOrNull(result, "Foundry provider-result observation");
  if (row === null) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-result observation returned no deterministic disposition.",
    );
  }
  const disposition = requireString(row, "disposition");
  if (disposition === "conflict") {
    throw new FoundryPostgresProviderCommandStoreError(
      "A contradictory provider-result observation already exists for this exact command claim and invocation.",
    );
  }
  if (disposition !== "observed" && disposition !== "replayed") {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-result observation returned an unknown disposition.",
    );
  }
  const observationId = requireString(row, "observation_id");
  const classification = await classifyProviderResultObservation(
    transaction,
    observationId,
  );
  return {
    status: disposition,
    observationId,
    invocationEventId: requireString(row, "invocation_event_id"),
    workerObservedAt: requireInstant(row, "worker_observed_at"),
    recordedAt: requireInstant(row, "recorded_at"),
    classification: classification ?? { status: "held" },
  };
}

async function completeCommand(
  transaction: FoundryPostgresProviderCommandTransaction,
  commandInput: FoundryClaimedProviderCommandV0,
  outcomeInput: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  providerWasInvoked: boolean,
  verifiedCheckpointInput: FoundryVerifiedCheckpointEvidenceV0 | null,
  workerObservedAtInput: string | null,
  expiredRecovery = false,
): Promise<FoundryProviderCommandCompletionDisposition> {
  const { command, outcome } = validateCompletionInput(
    commandInput,
    outcomeInput,
    outcomeSha256,
    providerWasInvoked,
    expiredRecovery,
  );
  const verifiedCheckpoint = verifiedCheckpointInput === null
    ? null
    : FoundryVerifiedCheckpointEvidenceV0Schema.parse(verifiedCheckpointInput);
  const checkpointSucceeded =
    command.commandKind === "provider_checkpoint" &&
    outcome.status === "succeeded";
  if (
    checkpointSucceeded !== (verifiedCheckpoint !== null) ||
    (verifiedCheckpoint !== null &&
      computeFoundryProviderCheckpointEvidenceSha256(verifiedCheckpoint) !==
        outcome.evidenceSha256)
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-checkpoint completion must bind one exact normalized evidence record and digest.",
    );
  }
  const adapterOutcome = adapterOutcomeFromCompletion(outcome, verifiedCheckpoint);
  const adapterContract = validateFoundryProviderOutcomeForCommand(
    command,
    adapterOutcome,
  );
  if (!adapterContract.valid) {
    throw new FoundryPostgresProviderCommandStoreError(
      `Provider-command completion violates the immutable command outcome contract: ${adapterContract.reasonCode}.`,
    );
  }
  const adapterOutcomeSha256 = computeFoundryProviderAdapterOutcomeSha256(adapterOutcome);
  const workerObservedAt = workerObservedAtInput === null
    ? null
    : FoundryUtcInstantSchema.parse(workerObservedAtInput);
  // All caller-controlled input is validated before SQL. From this point the
  // global predecessor is held before any observation, command, or event row.
  await acquireFoundryExecutionControlRoot(transaction);
  const conclusiveObservation =
    providerWasInvoked &&
      !expiredRecovery &&
      adapterOutcome.status !== "uncertain" &&
      workerObservedAt !== null
      ? await retainProviderResultObservation(
          transaction,
          { command, adapterOutcome, adapterOutcomeSha256, workerObservedAt },
        )
      : null;
  const terminal = await updateTerminalCommand(
    transaction,
    command,
    outcome,
    outcomeSha256,
    providerWasInvoked,
  );
  if (terminal === null) {
    if (conclusiveObservation !== null) {
      const classification = conclusiveObservation.classification.status === "classified"
        ? conclusiveObservation.classification
        : await classifyProviderResultObservation(
            transaction,
            conclusiveObservation.observationId,
          );
      if (classification !== null) {
        return {
          status: "result_observation_classified",
          observationId: conclusiveObservation.observationId,
          classification,
        };
      }
    }
    throw new FoundryPostgresProviderCommandStoreError(
      "The provider-command terminal CAS disappeared or no longer matched its exact claim and invocation disposition.",
    );
  }
  // A retry after a committed transaction whose acknowledgement was lost must
  // recognize the exact immutable terminal command and ledger event. All
  // custody artifacts are transactionally/deferred-constraint closed with that
  // event, so replaying their INSERTs would be both unnecessary and unsafe.
  if (terminal.replayed) {
    const classified = await classifyExactProviderResultObservation(transaction, command);
    if (
      conclusiveObservation !== null &&
      (classified === null ||
        classified.classification.disposition !== "already_authoritative")
    ) {
      throw new FoundryPostgresProviderCommandStoreError(
        "An exact conclusive completion replay did not classify its persisted observation as already authoritative.",
      );
    }
    return { status: "replayed" };
  }
  await insertCompletionEvent(
    transaction,
    command,
    outcome,
    outcomeSha256,
    providerWasInvoked,
  );
  if (verifiedCheckpoint !== null) {
    await insertVerifiedCheckpoint(
      transaction,
      command,
      outcome,
      outcomeSha256,
      verifiedCheckpoint,
    );
  }
  // If the conclusive response was observed before terminal completion, append
  // its immutable interpretation in this same transaction. This remains raw
  // audit evidence and does not advance any execution authority.
  const classified = await classifyExactProviderResultObservation(transaction, command);
  if (
    conclusiveObservation !== null &&
    (classified === null ||
      classified.classification.disposition !== "already_authoritative")
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "A conclusive completion did not classify its persisted observation as already authoritative.",
    );
  }
  if (await needsReconcileCustody(transaction, command, outcome)) {
    await insertCustodySuccessor(
      transaction,
      command.commandId,
      "provider_reconcile",
      outcome.completedBy.actorKind,
      outcome.completedBy.actorKey,
      null,
    );
  }
  const checkpointUnknownIntentId =
    await needsCheckpointUnknownContainment(transaction, command, outcome)
      ? await insertCheckpointUnknownStopIntent(
          transaction,
          command,
          outcome,
          outcomeSha256,
        )
      : null;
  const stopIntentId = await requiredStopIntent(
    transaction,
    command.commandId,
    checkpointUnknownIntentId,
  );
  if (stopIntentId !== null) {
    await insertCustodySuccessor(
      transaction,
      command.commandId,
      "provider_stop",
      outcome.completedBy.actorKind,
      outcome.completedBy.actorKey,
      stopIntentId,
    );
  }
  return { status: "completed" };
}

export type FoundryExpiredProviderCommandRecoveryResult =
  | { readonly status: "idle" }
  | {
      readonly status: "released";
      readonly commandId: string;
      readonly commandKind: FoundryClaimedProviderCommandV0["commandKind"];
    }
  | {
      readonly status: "completed";
      readonly commandId: string;
      readonly providerWasInvoked: boolean;
      readonly outcome: FoundryProviderCommandOutcomePayloadV0;
      readonly outcomeSha256: string;
    };

export interface FoundryExpiredProviderCommandRecovery {
  recoverNextExpiredClaim(
    recoveryActor: string,
  ): Promise<FoundryExpiredProviderCommandRecoveryResult>;
}

export interface FoundryExpiredProviderCommandDrainResult {
  readonly status: "drained" | "limit_reached";
  readonly processed: number;
  readonly released: number;
  readonly completed: number;
}

/**
 * Deterministic, bounded coordinator entry point for a separately scheduled
 * watchdog. It performs no provider I/O and deliberately does not auto-start;
 * external/provider execution remains quarantined until an operator wires an
 * explicit scheduler around this database-only drain.
 */
export async function drainExpiredFoundryProviderCommandClaims(
  recovery: FoundryExpiredProviderCommandRecovery,
  recoveryActorInput: string,
  maximumClaims = 100,
): Promise<FoundryExpiredProviderCommandDrainResult> {
  const recoveryActor = FoundryCanonicalActorSchema.parse(recoveryActorInput);
  if (!Number.isSafeInteger(maximumClaims) || maximumClaims < 1 || maximumClaims > 1_000) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Expired provider-command recovery drain must be bounded to 1..1000 claims.",
    );
  }
  let released = 0;
  let completed = 0;
  for (let processed = 0; processed < maximumClaims; processed += 1) {
    const result = await recovery.recoverNextExpiredClaim(recoveryActor);
    if (result.status === "idle") {
      return {
        status: "drained",
        processed,
        released,
        completed,
      };
    }
    if (result.status === "released") released += 1;
    else completed += 1;
  }
  return {
    status: "limit_reached",
    processed: maximumClaims,
    released,
    completed,
  };
}

function safeExpiredReleasePredicates(): SQL {
  return sql`
    stored."command_kind" <> 'provider_submit'
    AND policy."lease_ttl_seconds" >= stored."maximum_api_call_seconds" + 2
    AND CASE stored."command_kind"
      WHEN 'provider_reconcile' THEN
        attempt."state" IN ('provider_unknown', 'stop_pending')
        AND left(execution."state", 9) <> 'terminal_'
        AND (
          NOT attempt."cancel_requested"
          OR attempt."provider_execution_ref" IS NULL
        )
        AND stored."target_provider_ref" IS NOT DISTINCT FROM
              attempt."provider_execution_ref"
      WHEN 'provider_poll' THEN
        left(attempt."state", 9) <> 'terminal_'
        AND left(execution."state", 9) <> 'terminal_'
        AND attempt."provider_execution_ref" IS NOT NULL
        AND stored."target_provider_ref" = attempt."provider_execution_ref"
      WHEN 'provider_checkpoint' THEN
        attempt."state" = 'checkpointing'
        AND left(execution."state", 9) <> 'terminal_'
        AND NOT attempt."cancel_requested"
        AND attempt."provider_execution_ref" IS NOT NULL
        AND stored."target_provider_ref" = attempt."provider_execution_ref"
        AND "foundry_rights_policy_is_active"(
              execution."rights_policy_version",
              execution."rights_policy_definition_sha256",
              execution."rights_policy_generation",
              database_clock."now" + make_interval(
                secs => stored."maximum_api_call_seconds" + 1
              )
            )
        AND EXISTS (
          SELECT 1
          FROM "foundry_rights_approvals" rights
          WHERE rights."id" = execution."rights_approval_id"
            AND rights."rights_approval_sha256" = execution."rights_approval_sha256"
            AND rights."expires_at" > database_clock."now" + make_interval(
                  secs => stored."maximum_api_call_seconds" + 1
                )
        )
        AND EXISTS (
          SELECT 1
          FROM "foundry_provider_request_profiles" profile
          WHERE profile."provider_request_profile_sha256" =
                  stored."provider_request_profile_sha256"
            AND profile."profile_id" = stored."provider_request_profile_id"
            AND profile."profile_version" = stored."provider_request_profile_version"
            AND profile."provider_kind" = stored."provider_kind"
            AND profile."provider_adapter_id" = stored."provider_adapter_id"
            AND profile."provider_adapter_version" = stored."provider_adapter_version"
            AND profile."provider_adapter_artifact_sha256" =
                  stored."provider_adapter_artifact_sha256"
            AND profile."provider_adapter_configuration_sha256" =
                  stored."provider_adapter_configuration_sha256"
            AND profile."provider_deployment_sha256" =
                  stored."provider_deployment_sha256"
            AND profile."reviewed_at" <= database_clock."now"
            AND profile."expires_at" > database_clock."now" + make_interval(
                  secs => stored."maximum_api_call_seconds" + 1
                )
        )
      WHEN 'provider_stop' THEN
        attempt."state" = 'terminating'
        AND left(execution."state", 9) <> 'terminal_'
        AND attempt."cancel_requested"
        AND attempt."provider_execution_ref" IS NOT NULL
        AND stored."target_provider_ref" = attempt."provider_execution_ref"
        AND stored."stop_intent_id" IS NOT NULL
      ELSE false
    END
  `;
}

async function selectExpiredClaim(
  transaction: FoundryPostgresProviderCommandTransaction,
): Promise<{
  readonly command: FoundryClaimedProviderCommandV0;
  readonly providerWasInvoked: boolean;
  readonly releaseSafe: boolean;
} | null> {
  const result = await transaction.execute(sql`
    WITH database_clock AS MATERIALIZED (
      SELECT clock_timestamp() AS "now"
    ), claimed AS MATERIALIZED (
      SELECT stored.*,
        EXISTS (
          SELECT 1
          FROM "foundry_execution_events" invocation
          WHERE invocation."provider_command_id" = stored."id"
            AND invocation."claim_token" = stored."claim_token"
            AND invocation."correlation_id" = stored."correlation_id"
            AND invocation."event_kind" = 'provider_invocation_started'
        ) AS "provider_was_invoked",
        (${safeExpiredReleasePredicates()}) AS "release_safe"
      FROM "foundry_provider_commands" stored
      JOIN "foundry_attempts" attempt
        ON attempt."id" = stored."attempt_id"
       AND attempt."execution_id" = stored."execution_id"
       AND attempt."fencing_token" = stored."fencing_token"
      JOIN "foundry_executions" execution
        ON execution."id" = stored."execution_id"
       AND execution."fencing_token" = stored."fencing_token"
       AND execution."execution_subject_sha256" = stored."execution_subject_sha256"
      JOIN "foundry_execution_policies" policy
        ON policy."execution_policy_sha256" = execution."execution_policy_sha256"
      CROSS JOIN database_clock
      WHERE stored."state" = 'claimed'
        AND stored."claim_expires_at" <= database_clock."now"
        AND stored."revision" > 0
      ORDER BY
        CASE stored."command_kind"
          WHEN 'provider_stop' THEN 0
          WHEN 'provider_reconcile' THEN 1
          WHEN 'provider_submit' THEN 2
          ELSE 3
        END,
        stored."claim_expires_at", stored."created_at",
        stored."command_sequence", stored."id"
      FOR UPDATE OF stored, attempt, execution SKIP LOCKED
      LIMIT 1
    )
    SELECT ${claimSelectColumns()}, claimed."provider_was_invoked",
           claimed."release_safe"
    FROM claimed
  `);
  const row = singleRowOrNull(result, "Foundry expired provider-command selection");
  if (row === null) return null;
  if (typeof row["provider_was_invoked"] !== "boolean") {
    throw new FoundryPostgresProviderCommandStoreError(
      "Expired provider-command selection returned an invalid invocation disposition.",
    );
  }
  if (typeof row["release_safe"] !== "boolean") {
    throw new FoundryPostgresProviderCommandStoreError(
      "Expired provider-command selection returned an invalid release disposition.",
    );
  }
  return {
    command: mapClaimedCommand(row),
    providerWasInvoked: row["provider_was_invoked"],
    releaseSafe: row["release_safe"],
  };
}

async function releaseExpiredUninvokedClaim(
  transaction: FoundryPostgresProviderCommandTransaction,
  command: FoundryClaimedProviderCommandV0,
): Promise<void> {
  const result = await transaction.execute(sql`
    WITH database_clock AS MATERIALIZED (
      SELECT clock_timestamp() AS "now"
    ), releasable AS MATERIALIZED (
      SELECT stored."id", stored."revision"
      FROM "foundry_provider_commands" stored
      JOIN "foundry_attempts" attempt
        ON attempt."id" = stored."attempt_id"
       AND attempt."execution_id" = stored."execution_id"
       AND attempt."fencing_token" = stored."fencing_token"
      JOIN "foundry_executions" execution
        ON execution."id" = stored."execution_id"
       AND execution."fencing_token" = stored."fencing_token"
       AND execution."execution_subject_sha256" = stored."execution_subject_sha256"
      JOIN "foundry_execution_policies" policy
        ON policy."execution_policy_sha256" = execution."execution_policy_sha256"
      CROSS JOIN database_clock
      WHERE ${exactClaimPredicates(command)}
        AND stored."claim_expires_at" <= database_clock."now"
        AND ${safeExpiredReleasePredicates()}
        AND NOT EXISTS (
          SELECT 1
          FROM "foundry_execution_events" invocation
          WHERE invocation."provider_command_id" = stored."id"
            AND invocation."claim_token" = stored."claim_token"
            AND invocation."correlation_id" = stored."correlation_id"
            AND invocation."event_kind" = 'provider_invocation_started'
        )
      FOR UPDATE OF stored, attempt, execution
    ), released AS (
      UPDATE "foundry_provider_commands" stored
      SET "state" = 'pending',
          "claimed_by" = NULL,
          "claim_token" = NULL,
          "claimed_at" = NULL,
          "claim_expires_at" = NULL,
          "revision" = stored."revision" + 1
      FROM releasable
      WHERE stored."id" = releasable."id"
        AND stored."revision" = releasable."revision"
      RETURNING stored."id"::text AS "command_id", stored."state"
    )
    SELECT * FROM released
  `);
  const row = singleRowOrNull(result, "Foundry expired uninvoked claim release");
  if (
    row === null ||
    requireString(row, "command_id") !== command.commandId ||
    requireString(row, "state") !== "pending"
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Expired uninvoked provider command could not restore its exact pending projection.",
    );
  }
}

export function createPostgresFoundryExpiredProviderCommandRecovery(
  client: FoundryPostgresProviderCommandClient,
): FoundryExpiredProviderCommandRecovery {
  return {
    recoverNextExpiredClaim(recoveryActorInput) {
      const recoveryActor = FoundryCanonicalActorSchema.parse(recoveryActorInput);
      return client.transaction(async (transaction) => {
        await acquireFoundryExecutionControlRoot(transaction);
        const selected = await selectExpiredClaim(transaction);
        if (selected === null) return { status: "idle" } as const;
        const { command, providerWasInvoked, releaseSafe } = selected;
        if (
          !providerWasInvoked &&
          command.commandKind !== "provider_submit" &&
          releaseSafe
        ) {
          await releaseExpiredUninvokedClaim(transaction, command);
          return {
            status: "released",
            commandId: command.commandId,
            commandKind: command.commandKind,
          } as const;
        }
        const outcomeCode = providerWasInvoked
          ? "claim_lease_expired_effect_unknown"
          : "claim_lease_expired_not_invoked";
        const outcome: FoundryProviderCommandOutcomePayloadV0 = {
          schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
          commandId: command.commandId,
          executionId: command.executionId,
          attemptId: command.attemptId,
          claimToken: command.claimToken,
          fencingToken: command.fencingToken,
          status: providerWasInvoked ? "uncertain" : "failed",
          outcomeCode,
          providerLifecycle: providerWasInvoked ? "unknown" : "not_observed",
          providerCommandRef: command.payload.providerCommandRef,
          evidenceSha256: computeFoundryProviderCommandInternalEvidenceSha256(
            outcomeCode,
            command.commandId,
          ),
          completedBy: {
            actorKind: "watchdog",
            actorKey: recoveryActor,
          },
        };
        const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(outcome);
        await completeCommand(
          transaction,
          command,
          outcome,
          outcomeSha256,
          providerWasInvoked,
          null,
          null,
          true,
        );
        return {
          status: "completed",
          commandId: command.commandId,
          providerWasInvoked,
          outcome,
          outcomeSha256,
        } as const;
      });
    },
  };
}

export type FoundryProviderResultClassificationRecoveryResult =
  | { readonly status: "idle" }
  | {
      readonly status: "classified";
      readonly observationId: string;
      readonly classification: FoundryProviderResultClassificationDisposition;
    };

export interface FoundryProviderResultClassificationRecovery {
  recoverNextUnclassifiedObservation(): Promise<
    FoundryProviderResultClassificationRecoveryResult
  >;
}

export interface FoundryProviderResultClassificationDrainResult {
  readonly status: "drained" | "limit_reached";
  readonly processed: number;
  readonly classified: number;
}

/**
 * Bounded database-only recovery for durable observations whose command became
 * terminal after the observation transaction. It performs no provider I/O and
 * has no scheduler side effect.
 */
export async function drainUnclassifiedFoundryProviderResultObservations(
  recovery: FoundryProviderResultClassificationRecovery,
  maximumObservations = 100,
): Promise<FoundryProviderResultClassificationDrainResult> {
  if (
    !Number.isSafeInteger(maximumObservations) ||
    maximumObservations < 1 ||
    maximumObservations > 1_000
  ) {
    throw new FoundryPostgresProviderCommandStoreError(
      "Provider-result classification recovery must be bounded to 1..1000 observations.",
    );
  }
  for (let processed = 0; processed < maximumObservations; processed += 1) {
    const result = await recovery.recoverNextUnclassifiedObservation();
    if (result.status === "idle") {
      return { status: "drained", processed, classified: processed };
    }
  }
  return {
    status: "limit_reached",
    processed: maximumObservations,
    classified: maximumObservations,
  };
}

export function createPostgresFoundryProviderResultClassificationRecovery(
  client: FoundryPostgresProviderCommandClient,
): FoundryProviderResultClassificationRecovery {
  return {
    recoverNextUnclassifiedObservation() {
      return client.transaction(async (transaction) => {
        await acquireFoundryExecutionControlRoot(transaction);
        const selected = await transaction.execute(sql`
          SELECT observation."id"::text AS "observation_id"
          FROM "foundry_provider_command_result_observations" observation
          JOIN "foundry_provider_commands" command
            ON command."id" = observation."provider_command_id"
           AND command."claim_token" = observation."claim_token"
          JOIN "foundry_execution_events" completion
            ON completion."provider_command_id" = command."id"
           AND completion."event_kind" = 'provider_command_completed'
           AND completion."claim_token" = command."claim_token"
           AND completion."provider_command_outcome_sha256" = command."outcome_sha256"
           AND completion."payload" = command."outcome_json"
          LEFT JOIN "foundry_provider_command_result_classifications" classification
            ON classification."observation_id" = observation."id"
          WHERE classification."id" IS NULL
          ORDER BY observation."recorded_at", observation."id"
          FOR UPDATE OF observation SKIP LOCKED
          LIMIT 1
        `);
        const row = singleRowOrNull(
          selected,
          "Foundry unclassified provider-result observation recovery selection",
        );
        if (row === null) return { status: "idle" } as const;
        const observationId = requireString(row, "observation_id");
        const classification = await classifyProviderResultObservation(
          transaction,
          observationId,
        );
        if (classification === null) {
          throw new FoundryPostgresProviderCommandStoreError(
            "Selected provider-result observation lost its exact terminal completion before classification.",
          );
        }
        return { status: "classified", observationId, classification } as const;
      });
    },
  };
}

export function createPostgresFoundryProviderCommandExecutorStore(
  client: FoundryPostgresProviderCommandClient,
): FoundryProviderCommandExecutorStore {
  return {
    claimNextCommand(
      workerIdInput,
      eligibleBindingsInput,
    ): Promise<FoundryClaimedProviderCommandV0 | null> {
      const workerId = FoundryCanonicalActorSchema.parse(workerIdInput);
      const eligibleBindings = FoundryProviderAdapterClaimBindingsV0Schema.parse(
        eligibleBindingsInput,
      );
      return client.transaction((transaction) =>
        claimNextCommand(transaction, workerId, eligibleBindings)
      );
    },

    async authorizeAndRecordInvocationStart(commandInput) {
      const command = FoundryClaimedProviderCommandV0Schema.parse(commandInput);
      try {
        return await client.transaction(async (transaction) => {
          // Invocation authorization locks command/attempt/execution rows before
          // inserting its event. Take the global predecessor first so kill and
          // containment transactions cannot form a reverse row/advisory cycle.
          await acquireFoundryExecutionControlRoot(transaction);
          return authorizeAndRecordInvocationStart(transaction, command);
        });
      } catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: unknown }).code
          : undefined;
        if (code === "55000") {
          return {
            authorized: false,
            reasonCode: "database_authority_rejected",
          };
        }
        if (code === "40001") {
          return {
            authorized: false,
            reasonCode: "authorization_serialization_conflict",
          };
        }
        throw error;
      }
    },

    completeBeforeInvocation(command, outcome, outcomeSha256): Promise<void> {
      return client.transaction(async (transaction) => {
        await completeCommand(
          transaction,
          command,
          outcome,
          outcomeSha256,
          false,
          null,
          null,
        );
      });
    },

    completeAfterInvocation(
      command,
      outcome,
      outcomeSha256,
      verifiedCheckpoint,
      workerObservedAt,
    ): Promise<FoundryProviderCommandCompletionDisposition> {
      return client.transaction(async (transaction) => {
        return completeCommand(
          transaction,
          command,
          outcome,
          outcomeSha256,
          true,
          verifiedCheckpoint,
          workerObservedAt,
        );
      });
    },

    async retainProviderResultObservation(
      command,
      adapterOutcome,
      adapterOutcomeSha256,
      workerObservedAt,
    ): Promise<FoundryProviderResultObservationDisposition> {
      const input = validateProviderResultObservationInput(
        command,
        adapterOutcome,
        adapterOutcomeSha256,
        workerObservedAt,
      );
      return client.transaction(async (transaction) => {
        await acquireFoundryExecutionControlRoot(transaction);
        return retainProviderResultObservation(transaction, input);
      });
    },
  };
}

/** Production convenience adapter for the repository's Drizzle database. */
export function createDrizzleFoundryProviderCommandExecutorStore(
  database: Database,
): FoundryProviderCommandExecutorStore {
  return createPostgresFoundryProviderCommandExecutorStore(
    createDrizzleFoundryProviderCommandClient(database),
  );
}

/** Database-only recovery adapter; it does not start a worker or call a provider. */
export function createDrizzleFoundryExpiredProviderCommandRecovery(
  database: Database,
): FoundryExpiredProviderCommandRecovery {
  return createPostgresFoundryExpiredProviderCommandRecovery(
    createDrizzleFoundryProviderCommandClient(database),
  );
}

/** Bounded production coordinator hook for an explicitly configured watchdog. */
export function drainDrizzleFoundryExpiredProviderCommandClaims(
  database: Database,
  recoveryActor: string,
  maximumClaims = 100,
): Promise<FoundryExpiredProviderCommandDrainResult> {
  return drainExpiredFoundryProviderCommandClaims(
    createDrizzleFoundryExpiredProviderCommandRecovery(database),
    recoveryActor,
    maximumClaims,
  );
}

/** Database-only classifier for durable, unclassified provider observations. */
export function createDrizzleFoundryProviderResultClassificationRecovery(
  database: Database,
): FoundryProviderResultClassificationRecovery {
  return createPostgresFoundryProviderResultClassificationRecovery(
    createDrizzleFoundryProviderCommandClient(database),
  );
}

/** Bounded classifier hook; intentionally not wired to a scheduler. */
export function drainDrizzleUnclassifiedFoundryProviderResultObservations(
  database: Database,
  maximumObservations = 100,
): Promise<FoundryProviderResultClassificationDrainResult> {
  return drainUnclassifiedFoundryProviderResultObservations(
    createDrizzleFoundryProviderResultClassificationRecovery(database),
    maximumObservations,
  );
}

function createDrizzleFoundryProviderCommandClient(
  database: Database,
): FoundryPostgresProviderCommandClient {
  return {
    transaction<T>(operation: (
      transaction: FoundryPostgresProviderCommandTransaction,
    ) => Promise<T>): Promise<T> {
      return database.transaction((transaction) =>
        operation({
          async execute(query): Promise<FoundryPostgresProviderCommandQueryResult> {
            const result = await transaction.execute(query);
            return { rows: result.rows };
          },
        })
      );
    },
  };
}
