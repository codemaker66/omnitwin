import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  foundryAttempts,
  foundryComputeApprovals,
  foundryCostObservations,
  foundryExecutionConfirmations,
  foundryExecutionEvents,
  foundryExecutionPolicies,
  foundryExecutions,
  foundryJobWorkerProfiles,
  foundryJobs,
  foundryKillSwitchEvents,
  foundryKillSwitches,
  foundryPreparedProviderRequests,
  foundryProviderAdapterArtifacts,
  foundryProviderCommandResultClassifications,
  foundryProviderCommandResultObservations,
  foundryProviderCommands,
  foundryProviderDeployments,
  foundryProviderRequestProfiles,
  foundryRightsApprovals,
  foundryRightsPolicyRevocations,
  foundryRightsPolicyVersions,
  foundryStopIntents,
  foundryTrustedWorkerProfiles,
  foundryVerifiedCheckpoints,
} from "../db/schema.js";

const MIGRATION_TAG = "0053_foundry_execution_control";

const JournalSchema = z.object({
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    tag: z.string(),
  }).passthrough()),
}).passthrough();

const FOUNDRY_TABLES = [
  foundryExecutionPolicies,
  foundryProviderAdapterArtifacts,
  foundryProviderDeployments,
  foundryProviderRequestProfiles,
  foundryTrustedWorkerProfiles,
  foundryJobs,
  foundryJobWorkerProfiles,
  foundryRightsPolicyVersions,
  foundryRightsPolicyRevocations,
  foundryRightsApprovals,
  foundryComputeApprovals,
  foundryExecutionConfirmations,
  foundryExecutions,
  foundryAttempts,
  foundryStopIntents,
  foundryPreparedProviderRequests,
  foundryKillSwitches,
  foundryKillSwitchEvents,
  foundryExecutionEvents,
  foundryProviderCommands,
  foundryProviderCommandResultObservations,
  foundryProviderCommandResultClassifications,
  foundryCostObservations,
  foundryVerifiedCheckpoints,
] as const;

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const body = new RegExp(`CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`, "u")
    .exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gmu)].map((match) => match[1] ?? "");
}

function drizzleColumnNames(table: PgTable): string[] {
  return (Object.values(getTableColumns(table)) as AnyPgColumn[]).map((column) => column.name);
}

function extractFunction(sql: string, functionName: string): string {
  const body = new RegExp(`CREATE FUNCTION "${functionName}"\\([\\s\\S]*?\\n\\$\\$;`, "u")
    .exec(sql)?.[0];
  if (body === undefined) throw new Error(`Migration does not create function ${functionName}`);
  return body;
}

function foreignKeyShape(table: PgTable, name: string) {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  if (key === undefined) throw new Error(`Missing Drizzle foreign key ${name}`);
  const reference = key.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignColumns: reference.foreignColumns.map((column) => column.name),
  };
}

function partialUniqueIndexShape(table: PgTable, name: string) {
  const candidate = getTableConfig(table).indexes.find((indexValue) => indexValue.config.name === name);
  if (candidate === undefined) throw new Error(`Missing Drizzle index ${name}`);
  return {
    unique: candidate.config.unique,
    hasPredicate: candidate.config.where !== undefined,
    columns: candidate.config.columns.map((column) => "name" in column ? column.name : "sql"),
  };
}

async function migrationSql(): Promise<string> {
  return readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
}

describe("Foundry execution-control migration", () => {
  it("keeps every migration table column aligned with Drizzle", async () => {
    const sql = await migrationSql();
    for (const table of FOUNDRY_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(drizzleColumnNames(table));
    }
  });

  it("binds the complete immutable execution envelope rather than JobSpec alone", async () => {
    const sql = (await migrationSql()).replace(/\s+/gu, " ");
    for (const field of [
      "execution_envelope_sha256",
      "job_spec_sha256",
      "provider_plan_sha256",
      "reviewed_ingest_manifest_sha256",
      "reviewed_ingest_manifest_json",
      "intake_admission_result_sha256",
      "intake_staging_index_sha256",
      "execution_policy_sha256",
      "pricing_snapshot_sha256",
      "provider_adapter_version",
      "provider_adapter_artifact_sha256",
      "provider_deployment_sha256",
      "trusted_worker_profile_set_sha256",
      "pricing_snapshot_expires_at",
      "dispatch_deadline",
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
    expect(sql).toContain('CONSTRAINT "foundry_jobs_exact_envelope_unique" UNIQUE');
    expect(sql).toContain('CONSTRAINT "foundry_exec_job_fk" FOREIGN KEY');
    expect(sql).toContain('REFERENCES "foundry_jobs"');
    expect(sql).toContain("execution compute approval does not match its immutable envelope");
    expect(sql).toContain('"compute_approval_id"');
    expect(foreignKeyShape(foundryExecutions, "foundry_exec_job_fk").columns).toEqual([
      "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
      "provider_plan_sha256", "reviewed_ingest_manifest_sha256", "execution_policy_sha256",
      "intake_admission_result_sha256", "intake_staging_index_sha256", "pricing_snapshot_sha256",
      "provider_kind", "provider_adapter_id", "provider_adapter_version",
      "provider_adapter_artifact_sha256", "provider_deployment_sha256",
      "trusted_worker_profile_set_sha256", "trusted_worker_profile_count",
      "pricing_snapshot_expires_at", "budget_cap_micro_usd",
      "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
      "absolute_cost_cap_micro_usd", "max_wall_clock_seconds", "orchestration_overhead_seconds",
      "cancel_grace_seconds",
      "termination_grace_seconds", "worker_self_deadline_seconds",
      "termination_confirmation_timeout_seconds", "provider_maximum_execution_ttl_seconds",
      "dispatch_deadline",
    ]);
  });

  it("makes rights policy definitions trusted, effective, and revocable", async () => {
    const sql = await migrationSql();
    for (const boundary of [
      "foundry_rights_policy_versions",
      "foundry_rights_policy_revocations",
      "foundry_rights_policy_exact_unique",
      "foundry_rights_policy_revocation_fk",
      "foundry_rights_policy_one_revocation_unique",
      "foundry_rights_policy_is_active",
      "foundry_rights_revocation_guard",
      "pg_advisory_xact_lock",
      "policy_definition_sha256",
      "foundry_rights_policy_no_update",
      "foundry_rights_revocations_no_update",
      "provider submit is blocked by a revoked or ineffective rights policy",
    ]) {
      expect(sql).toContain(boundary);
    }
    expect(foreignKeyShape(foundryRightsApprovals, "foundry_rights_policy_fk")).toEqual({
      columns: [
        "policy_version", "policy_definition_sha256", "policy_evidence_sha256", "policy_generation",
        "policy_maximum_approval_ttl_seconds",
      ],
      foreignColumns: [
        "policy_version", "policy_definition_sha256", "policy_evidence_sha256", "generation",
        "maximum_approval_ttl_seconds",
      ],
    });
  });

  it("binds trusted policy, adapter artifact, deployment, and worker-profile registries", async () => {
    const sql = await migrationSql();
    for (const boundary of [
      "foundry_execution_policies",
      "foundry_provider_adapter_artifacts",
      "foundry_provider_deployments",
      "foundry_provider_request_profiles",
      "foundry_trusted_worker_profiles",
      "foundry_job_worker_profiles",
      "foundry_jobs_execution_policy_fk",
      "foundry_jobs_adapter_artifact_fk",
      "foundry_jobs_deployment_fk",
      "foundry_provider_request_profile_deployment_fk",
      "foundry_job_worker_profile_guard",
      "trusted worker-profile set is incomplete, stale, or not yet valid",
      "provider adapter artifact is absent, stale, or not yet valid",
      "provider deployment is absent, stale, or not yet valid",
    ]) {
      expect(sql).toContain(boundary);
    }
    expect(foreignKeyShape(foundryProviderDeployments, "foundry_deployment_adapter_fk")).toEqual({
      columns: [
        "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version",
      ],
      foreignColumns: [
        "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version",
      ],
    });
    expect(foreignKeyShape(
      foundryProviderRequestProfiles,
      "foundry_provider_request_profile_deployment_fk",
    )).toEqual({
      columns: [
        "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version", "provider_adapter_artifact_sha256",
      ],
      foreignColumns: [
        "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
        "provider_adapter_version", "provider_adapter_artifact_sha256",
      ],
    });
  });

  it("keeps every hardened identity immutable and rechecks it at guarded boundaries", async () => {
    const sql = await migrationSql();
    const executionGuard = extractFunction(sql, "guard_foundry_execution_projection");
    for (const field of [
      "execution_subject_sha256",
      "execution_subject_json",
      "intake_admission_result_sha256",
      "intake_staging_index_sha256",
      "provider_adapter_artifact_sha256",
      "provider_deployment_sha256",
      "trusted_worker_profile_set_sha256",
      "trusted_worker_profile_count",
      "orchestration_overhead_seconds",
      "rights_policy_generation",
      "rights_policy_evidence_sha256",
      "rights_policy_maximum_approval_ttl_seconds",
      "rights_approval_sha256",
      "compute_approval_sha256",
      "confirmation_sha256",
    ]) {
      expect(executionGuard).toContain(`NEW."${field}"`);
      expect(executionGuard).toContain(`OLD."${field}"`);
    }
    for (const functionName of [
      "guard_foundry_attempt_projection",
      "guard_foundry_kill_switch_projection",
      "guard_foundry_execution_event_sequence",
      "guard_foundry_provider_command",
      "apply_foundry_cost_observation",
      "guard_foundry_checkpoint_sequence",
    ]) {
      const guard = extractFunction(sql, functionName);
      expect(guard).toContain('"provider_adapter_artifact_sha256"');
      expect(guard).toContain('"provider_deployment_sha256"');
    }
  });

  it("materializes every admission evidence object beside its exact digest", async () => {
    const sql = await migrationSql();
    for (const field of [
      "reviewed_ingest_manifest_json",
      "policy_evidence_sha256",
      "rights_approval_json",
      "rights_approval_sha256",
      "compute_approval_json",
      "compute_approval_sha256",
      "confirmation_json",
      "confirmation_sha256",
      "execution_subject_json",
      "execution_subject_sha256",
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
    expect(foreignKeyShape(foundryExecutions, "foundry_exec_rights_fk").columns)
      .toContain("rights_approval_sha256");
    expect(foreignKeyShape(foundryExecutions, "foundry_exec_compute_fk").columns)
      .toContain("compute_approval_sha256");
    expect(foreignKeyShape(foundryExecutions, "foundry_exec_confirmation_fk").columns)
      .toContain("confirmation_sha256");
  });

  it("uses exact BIGINT micro-USD and policy deadline ladders", async () => {
    const sql = await migrationSql();
    for (const money of [
      "estimated_cost_micro_usd",
      "budget_cap_micro_usd",
      "cost_warning_micro_usd",
      "cost_hard_stop_micro_usd",
      "termination_reserve_micro_usd",
      "absolute_cost_cap_micro_usd",
      "maximum_cost_micro_usd",
      "incremental_cost_micro_usd",
      "cumulative_cost_micro_usd",
    ]) {
      expect(sql).toMatch(new RegExp(`"${money}" bigint`, "u"));
    }
    expect(sql).toContain("foundry_jobs_cost_ladder");
    expect(sql).toContain("foundry_jobs_deadline_ladder");
    expect(sql).toContain('"estimated_cost_micro_usd" < "cost_hard_stop_micro_usd"');
    expect(sql).toContain('"absolute_cost_cap_micro_usd" <= "budget_cap_micro_usd"');
    expect(sql).toContain('"worker_self_deadline_seconds" + "termination_confirmation_timeout_seconds" <= "provider_maximum_execution_ttl_seconds"');
    expect(sql).toContain("cost observation sequence or cumulative delta is invalid");
    expect(sql).toContain("foundry_cost_provider_observation_unique");
  });

  it("consumes a confirmation exactly once and leaves admission inert", async () => {
    const sql = await migrationSql();
    expect(sql).toContain("foundry_exec_confirmation_consumption_unique");
    expect(sql).toContain("execution admission must remain inert at revision zero");
    expect(sql).toContain("'admitted_awaiting_executor'");
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"foundry_provider_commands"/iu);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER[\s\S]{0,300}provider_submit/iu);
  });

  it("enforces fenced attempts, contiguous sequences, CAS revisions, and an inert outbox", async () => {
    const sql = await migrationSql();
    for (const boundary of [
      "foundry_attempt_execution_ordinal_unique",
      "foundry_attempt_execution_fence_unique",
      "foundry_attempt_one_nonterminal_unique",
      '"maximum_attempts" = 1',
      "immutable execution policy permits exactly one attempt",
      "attempt ordinal and fence advance only through attempt insertion",
      "foundry_event_execution_sequence_unique",
      "execution event sequence or revision is not contiguous",
      "foundry_command_attempt_sequence_unique",
      "provider command must enter the inert outbox as the next pending command",
      "foundry_command_one_active_kind_unique",
      "pending', 'claimed', 'succeeded', 'failed', 'uncertain",
      "provider_submit",
      "provider_reconcile",
      "provider_poll",
      "provider_checkpoint",
      "provider_stop",
      "claimed provider submit can never be made pending or resubmitted",
      "expired provider claim must close as invoked-uncertain or uninvoked-failed",
      "uncertain provider submit must enqueue a causally linked provider reconcile command",
      "foundry_uncertain_submit_reconcile_guard",
      "r.\"state\" IN ('pending', 'claimed')",
      "uncertain provider checkpoint must atomically retain active stop custody",
      "checkpoint_effect_unknown",
      "stop_intent_applied",
      "append_foundry_stop_intent_application_event",
      "stop-intent event must exactly account for its containment projection revision",
      "cost_observation_applied",
      "append_foundry_cost_observation_application_event",
      "cost-observation event must exactly account for its cost projection revision",
      "foundry_verified_checkpoint_evidence_sha256",
      "foundry_verified_checkpoint_request_digest",
      "completed_by_actor_kind",
      "created_by_actor_kind",
      "prepared_by_actor_kind",
      "provider command claim timestamps exceed the database-clock policy lease",
      '"provider_command_ref" IS NOT DISTINCT FROM "target_provider_ref"',
      "'provider-command-completion:' || NEW.\"id\"::text",
      "omnitwin.foundry.provider-command-completed.v0",
      "foundry_provider_command_result_observations",
      "foundry_provider_command_result_classifications",
      "foundry_provider_adapter_outcome_is_valid",
      "foundry_provider_result_observation_request_digest",
      "foundry_provider_result_classification_request_digest",
      "foundry_provider_result_terminal_disposition",
      "guard_foundry_provider_result_observation",
      "guard_foundry_provider_result_classification",
      "adapter_timeout_unknown",
      "claim_lease_expired_effect_unknown",
      "provider-command-result-observation:",
      "provider-command-result-classification:",
      "omnitwin.foundry.provider-adapter-outcome.v0",
      "IS DISTINCT FROM true",
    ]) {
      expect(sql).toContain(boundary);
    }
    for (const eventField of [
      "recorded_at", "actor_kind", "actor_key", "idempotency_key", "causation_id",
      "correlation_id", "expected_revision", "resulting_revision", "fencing_token",
      "execution_subject_sha256", "provider_command_id", "provider_command_kind",
      "claim_token", "provider_command_payload_sha256", "provider_request_sha256",
      "provider_idempotency_key", "maximum_api_call_seconds", "provider_command_state",
      "provider_command_outcome_sha256", "provider_lifecycle_state", "provider_was_invoked",
      "advances_projection",
    ]) {
      expect(sql).toContain(`"${eventField}"`);
    }
    for (const invocationBoundary of [
      "provider_invocation_started",
      "foundry_event_provider_command_fk",
      "foundry_event_one_invocation_start_unique",
      "provider invocation start must causally bind the exact live claimed command fence",
    ]) {
      expect(sql).toContain(invocationBoundary);
    }
    for (const admissionGenesisBoundary of [
      "event_kind\" = 'execution_admitted'",
      "resulting_revision\" = 0",
      "execution admission genesis event must bind the inert revision-zero projection",
    ]) {
      expect(sql).toContain(admissionGenesisBoundary);
    }
    expect(foreignKeyShape(foundryExecutionEvents, "foundry_event_provider_command_fk")).toEqual({
      columns: ["provider_command_id"],
      foreignColumns: ["id"],
    });
    expect(foreignKeyShape(foundryAttempts, "foundry_attempt_execution_subject_fk")).toEqual({
      columns: ["execution_id", "execution_subject_sha256"],
      foreignColumns: ["id", "execution_subject_sha256"],
    });
    expect(foreignKeyShape(foundryStopIntents, "foundry_stop_intent_subject_fk")).toEqual({
      columns: ["execution_id", "execution_subject_sha256"],
      foreignColumns: ["id", "execution_subject_sha256"],
    });
    expect(foreignKeyShape(
      foundryPreparedProviderRequests,
      "foundry_prepared_request_profile_fk",
    )).toEqual({
      columns: [
        "provider_request_profile_sha256", "provider_request_profile_id",
        "provider_request_profile_version", "provider_kind", "provider_adapter_id",
        "provider_adapter_version", "provider_adapter_artifact_sha256",
        "provider_adapter_configuration_sha256", "provider_deployment_sha256",
      ],
      foreignColumns: [
        "provider_request_profile_sha256", "profile_id", "profile_version", "provider_kind",
        "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
        "provider_adapter_configuration_sha256", "provider_deployment_sha256",
      ],
    });
    expect(foreignKeyShape(foundryProviderCommands, "foundry_command_prepared_request_fk")).toEqual({
      columns: [
        "prepared_provider_request_id", "id", "execution_id", "attempt_id",
        "execution_subject_sha256", "command_sequence", "command_kind",
        "provider_request_sha256", "provider_request_profile_id",
        "provider_request_profile_version", "provider_request_profile_sha256",
        "provider_adapter_configuration_sha256", "provider_idempotency_key",
        "provider_client_request_id", "maximum_api_call_seconds",
        "created_by_actor_kind", "created_by_actor_key",
      ],
      foreignColumns: [
        "id", "provider_command_id", "execution_id", "attempt_id",
        "execution_subject_sha256", "command_sequence", "command_kind",
        "provider_request_sha256", "provider_request_profile_id",
        "provider_request_profile_version", "provider_request_profile_sha256",
        "provider_adapter_configuration_sha256", "provider_idempotency_key",
        "provider_client_request_id", "maximum_api_call_seconds",
        "prepared_by_actor_kind", "prepared_by_actor_key",
      ],
    });
    expect(foreignKeyShape(foundryProviderCommands, "foundry_command_originating_submit_fk"))
      .toEqual({ columns: ["originating_submit_command_id"], foreignColumns: ["id"] });

    const compactSql = sql.replace(/\s+/gu, " ");
    for (const exactBinding of [
      '"payload"->>\'executionSubjectSha256\' IS NOT DISTINCT FROM "execution_subject_sha256"',
      '"payload"->>\'providerRequestSha256\' IS NOT DISTINCT FROM "provider_request_sha256"',
      '"payload"->\'stageIds\' IS NOT DISTINCT FROM "stage_ids"',
      '"outcome_json"->>\'commandId\' IS NOT DISTINCT FROM "id"::text',
      '"outcome_json"->>\'claimToken\' IS NOT DISTINCT FROM "claim_token"::text',
      '"outcome_json"->>\'providerLifecycle\' IS NOT DISTINCT FROM "provider_lifecycle_state"',
      '"outcome_json"->\'completedBy\'->>\'actorKind\' IS NOT DISTINCT FROM "completed_by_actor_kind"',
      '"outcome_json"->\'completedBy\'->>\'actorKey\' IS NOT DISTINCT FROM "completed_by_actor_key"',
      "provider command does not bind one exact immutable prepared provider request",
      "provider reconcile payload does not exactly bind its originating submit lineage",
    ]) {
      expect(compactSql).toContain(exactBinding);
    }

    for (const [table, name, columns] of [
      [foundryAttempts, "foundry_attempt_one_nonterminal_unique", ["execution_id"]],
      [foundryKillSwitches, "foundry_kill_one_global_unique", ["scope"]],
      [foundryKillSwitches, "foundry_kill_one_provider_unique", [
        "provider_kind", "provider_adapter_id", "provider_adapter_version",
      ]],
      [foundryKillSwitches, "foundry_kill_one_project_unique", ["project_id"]],
      [foundryKillSwitches, "foundry_kill_one_execution_unique", ["execution_id"]],
      [foundryKillSwitches, "foundry_kill_one_attempt_unique", ["attempt_id"]],
      [foundryProviderCommands, "foundry_command_one_active_kind_unique", [
        "attempt_id", "command_kind",
      ]],
      [foundryProviderCommands, "foundry_command_one_active_non_stop_unique", ["attempt_id"]],
      [foundryProviderCommands, "foundry_command_submit_provider_idempotency_unique", [
        "provider_kind", "provider_adapter_id", "provider_adapter_version",
        "provider_deployment_sha256", "provider_idempotency_key",
      ]],
      [foundryExecutionEvents, "foundry_event_one_invocation_start_unique", [
        "provider_command_id", "claim_token",
      ]],
      [foundryExecutionEvents, "foundry_event_one_command_completion_unique", [
        "provider_command_id",
      ]],
    ] as const) {
      expect(partialUniqueIndexShape(table, name)).toEqual({
        unique: true,
        hasPredicate: true,
        columns,
      });
    }
  });

  it("enforces global, provider, project, execution, and attempt kill scopes at submit and claim", async () => {
    const sql = await migrationSql();
    for (const scope of ["global", "provider", "project", "execution", "attempt"]) {
      expect(sql).toContain(`'${scope}'`);
      expect(sql).toContain(`foundry_kill_one_${scope}_unique`);
    }
    expect(sql.match(/provider submit is blocked by an active kill switch/gu)).toHaveLength(1);
    expect(sql).toContain("provider submit claim is blocked by state, cancellation, authority, deadline, cost, or kill switch");
    expect(sql).toContain("kill-switch projection changes require an append-only event");
  });

  it("keeps authority and evidence append-only while projections remain guarded mutable rows", async () => {
    const sql = (await migrationSql()).replace(/\s+/gu, " ");
    for (const table of [
      "foundry_jobs",
      "foundry_execution_policies",
      "foundry_provider_adapter_artifacts",
      "foundry_provider_deployments",
      "foundry_provider_request_profiles",
      "foundry_trusted_worker_profiles",
      "foundry_job_worker_profiles",
      "foundry_stop_intents",
      "foundry_prepared_provider_requests",
      "foundry_rights_policy_versions",
      "foundry_rights_policy_revocations",
      "foundry_rights_approvals",
      "foundry_compute_approvals",
      "foundry_execution_confirmations",
      "foundry_execution_events",
      "foundry_provider_command_result_observations",
      "foundry_provider_command_result_classifications",
      "foundry_cost_observations",
      "foundry_verified_checkpoints",
      "foundry_kill_switch_events",
    ]) {
      expect(sql).toContain(`BEFORE UPDATE ON "${table}"`);
      expect(sql).toContain(`BEFORE DELETE ON "${table}"`);
      expect(sql).toContain(`BEFORE TRUNCATE ON "${table}" FOR EACH STATEMENT`);
    }
    for (const table of [
      "foundry_executions",
      "foundry_attempts",
      "foundry_provider_commands",
      "foundry_kill_switches",
    ]) {
      expect(sql).not.toContain(`no_update" BEFORE UPDATE ON "${table}"`);
      expect(sql).toContain(`BEFORE DELETE ON "${table}"`);
      expect(sql).toContain(`BEFORE TRUNCATE ON "${table}" FOR EACH STATEMENT`);
    }
  });

  it("keeps every subject FK restrictive and migration identifiers collision-safe", async () => {
    const sql = await migrationSql();
    const foreignKeys = [...sql.matchAll(/FOREIGN KEY\([\s\S]*?\)\s+REFERENCES\s+"[^"]+"\([\s\S]*?\)\s+ON DELETE (\w+)/gu)];
    expect(foreignKeys.length).toBeGreaterThanOrEqual(15);
    expect(foreignKeys.every((match) => match[1] === "RESTRICT")).toBe(true);

    const identifiers = [...sql.matchAll(/CREATE (?:UNIQUE )?(?:INDEX|FUNCTION|(?:CONSTRAINT )?TRIGGER) "([^"]+)"|CONSTRAINT "([^"]+)"/gu)]
      .map((match) => match[1] ?? match[2] ?? "");
    expect(identifiers.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(true);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it("is the contiguous journaled migration tail", async () => {
    const journalText = await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8");
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);
    expect(journal.entries.at(-7)?.tag).toBe("0052_runtime_package_revisions");
    expect(journal.entries.at(-6)?.tag).toBe(MIGRATION_TAG);
    expect(journal.entries.at(-5)?.tag).toBe("0054_foundry_derivative_rights");
    expect(journal.entries.at(-4)?.tag).toBe("0055_foundry_derivative_rights_custody");
    expect(journal.entries.at(-3)?.tag).toBe("0056_foundry_derivative_execution_barrier");
    expect(journal.entries.at(-2)?.tag).toBe("0057_foundry_derivative_execution_candidates");
    expect(journal.entries.at(-1)?.tag).toBe("0058_foundry_derivative_activation_disabled");
    expect(journal.entries.at(-1)?.idx).toBe(journal.entries.length - 1);
  });
});
