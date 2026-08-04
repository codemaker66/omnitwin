import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
  computeFoundryProviderAdapterOutcomeSha256,
  computeFoundryProviderCheckpointEvidenceSha256,
  computeFoundryProviderCommandInternalEvidenceSha256,
  computeFoundryProviderCommandOutcomeSha256,
  computeFoundryProviderCommandPayloadSha256,
  computeFoundryProviderRequestSha256,
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderAdapterOutcomeV0,
  type FoundryProviderCommandOutcomePayloadV0,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
} from "../../services/foundry-provider-request-authorization.js";
import {
  FoundryPostgresProviderCommandStoreError,
  createPostgresFoundryExpiredProviderCommandRecovery,
  createPostgresFoundryProviderCommandExecutorStore,
  drainExpiredFoundryProviderCommandClaims,
  type FoundryExpiredProviderCommandRecovery,
  type FoundryPostgresProviderCommandClient,
  type FoundryPostgresProviderCommandQueryResult,
  type FoundryPostgresProviderCommandRow,
  type FoundryPostgresProviderCommandTransaction,
} from "../../services/foundry-postgres-provider-command-store.js";

const COMMAND_ID = "00000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "00000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000003";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000004";
const RECONCILE_COMMAND_ID = "00000000-0000-4000-8000-000000000005";
const POLL_COMMAND_ID = "00000000-0000-4000-8000-000000000006";
const CHECKPOINT_COMMAND_ID = "00000000-0000-4000-8000-000000000007";
const STOP_COMMAND_ID = "00000000-0000-4000-8000-000000000008";
const STOP_INTENT_ID = "00000000-0000-4000-8000-000000000009";
const OBSERVATION_ID = "00000000-0000-4000-8000-000000000010";
const INVOCATION_EVENT_ID = "00000000-0000-4000-8000-000000000011";
const CLASSIFICATION_ID = "00000000-0000-4000-8000-000000000012";
const COMPLETION_EVENT_ID = "00000000-0000-4000-8000-000000000013";
const PROVIDER_REF = "runpod:pod-001";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const PROFILE_SHA256 = `sha256:${"1".repeat(64)}`;
const ADAPTER_CONFIGURATION_SHA256 = `sha256:${"2".repeat(64)}`;
const WORKER_IMAGE = `registry.example/worker@sha256:${"3".repeat(64)}`;
const CLAIMED_AT = new Date("2026-07-13T10:00:00.000Z");
const CLAIM_EXPIRES_AT = new Date("2026-07-13T10:01:00.000Z");
const WORKER_OBSERVED_AT = "2026-07-13T10:00:30.000Z";
const IDEMPOTENCY_KEY = deriveFoundryProviderIdempotencyKey(
  DIGEST_A,
  ATTEMPT_ID,
);
const ELIGIBLE_BINDINGS = [{
  providerKind: "runpod" as const,
  providerAdapterId: "runpod-v1",
  providerAdapterVersion: "1.2.3",
  providerAdapterArtifactSha256: DIGEST_C,
  providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
  providerDeploymentSha256: DIGEST_D,
  providerRequestProfileId: "runpod-request-profile-001",
  providerRequestProfileVersion: "1.0.0",
  providerRequestProfileSha256: PROFILE_SHA256,
  targetKind: "remote_worker_pool" as const,
  targetId: "runpod-pool-eu-secure",
}] as const;

interface CapturedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

type QueryStep =
  | { readonly rows: readonly FoundryPostgresProviderCommandRow[] }
  | { readonly error: Error };

function observedResultRow(disposition: "observed" | "replayed" = "observed") {
  return { rows: [{
    disposition,
    observation_id: OBSERVATION_ID,
    invocation_event_id: INVOCATION_EVENT_ID,
    worker_observed_at: WORKER_OBSERVED_AT,
    recorded_at: "2026-07-13T10:00:31.000Z",
  }] } as const;
}

function classifiedResultRow(
  disposition: "late_eligible" | "already_authoritative" | "terminal_conflict" | "not_eligible",
) {
  return { rows: [{
    classification_id: CLASSIFICATION_ID,
    completion_event_id: COMPLETION_EVENT_ID,
    classification_disposition: disposition,
    classified_at: "2026-07-13T10:00:32.000Z",
  }] } as const;
}

interface ScriptedHarness {
  readonly client: FoundryPostgresProviderCommandClient;
  readonly queries: CapturedQuery[];
  readonly transactionEvents: string[];
}

function scriptedHarness(...steps: readonly QueryStep[]): ScriptedHarness {
  const dialect = new PgDialect();
  const queries: CapturedQuery[] = [];
  const transactionEvents: string[] = [];
  let nextStep = 0;
  const transaction: FoundryPostgresProviderCommandTransaction = {
    execute(query: SQL): Promise<FoundryPostgresProviderCommandQueryResult> {
      const compiled = dialect.sqlToQuery(query);
      queries.push({
        text: compiled.sql.replace(/\s+/gu, " ").trim(),
        params: compiled.params,
      });
      const step = steps[nextStep];
      nextStep += 1;
      if (step === undefined) {
        return Promise.reject(new Error("unexpected SQL query"));
      }
      if ("error" in step) return Promise.reject(step.error);
      return Promise.resolve({ rows: step.rows });
    },
  };
  return {
    queries,
    transactionEvents,
    client: {
      async transaction<T>(
        operation: (
          current: FoundryPostgresProviderCommandTransaction,
        ) => Promise<T>,
      ): Promise<T> {
        transactionEvents.push("begin");
        try {
          const result = await operation(transaction);
          transactionEvents.push("commit");
          return result;
        } catch (error: unknown) {
          transactionEvents.push("rollback");
          throw error;
        }
      },
    },
  };
}

function providerRequest() {
  return FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind: "provider_submit",
    commandId: COMMAND_ID,
    commandSequence: 1,
    preparedAt: "2026-07-13T09:59:00.000Z",
    execution: {
      executionId: EXECUTION_ID,
      attemptId: ATTEMPT_ID,
      attemptOrdinal: 1,
      fencingToken: "7",
      executionSubjectSha256: DIGEST_A,
      subjectId: "subject-001",
      projectId: "project-001",
      jobId: "job-001",
    },
    requestIdentity: {
      providerIdempotencyKey: IDEMPOTENCY_KEY,
      clientRequestId: deriveFoundryProviderClientRequestId(
        "provider_submit",
        COMMAND_ID,
      ),
      resourceMarker: {
        executionSubjectSha256: DIGEST_A,
        providerIdempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    evidence: {
      jobSpecSha256: DIGEST_E,
      reviewedIngestManifestSha256: DIGEST_E,
      intakeAdmissionResultSha256: DIGEST_E,
      intakeStagingIndexSha256: DIGEST_E,
      executionEnvelopeSha256: DIGEST_B,
      executionPolicySha256: DIGEST_E,
      providerPlanSha256: DIGEST_E,
      providerDeploymentSha256: DIGEST_D,
      workerProfileSha256s: [DIGEST_E],
      executionConfirmationSha256: DIGEST_E,
      computeApprovalSha256: DIGEST_E,
    },
    provider: {
      providerKind: "runpod",
      providerAdapterId: "runpod-v1",
      providerAdapterVersion: "1.2.3",
      providerAdapterArtifactSha256: DIGEST_C,
      providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
      providerDeploymentId: "runpod-deployment-001",
      providerDeploymentSha256: DIGEST_D,
      accountProjectAlias: "omnitwin-production",
      region: "eu",
      dataResidency: "eu",
      providerRequestProfileId: "runpod-request-profile-001",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: PROFILE_SHA256,
      target: {
        targetKind: "remote_worker_pool",
        poolId: "runpod-pool-eu-secure",
      },
    },
    rights: {
      rightsApprovalSha256: DIGEST_E,
      rightsPolicyEvidenceSha256: DIGEST_E,
      rightsPolicyDefinitionSha256: DIGEST_E,
      policyVersion: "rights-v1",
      policyGeneration: 1,
      decision: "allowed",
      stagePurposes: [{
        stageId: "geometry",
        purposes: ["commercial_internal_use"],
      }],
    },
    storage: {
      sourceMountMode: "read_only",
      objectStorageProfile: "object-store-readonly-001",
      outputPrefix: "foundry/project-001/job-001",
    },
    runtime: {
      maximumApiCallSeconds: 30,
      maximumWallClockSeconds: 3_600,
      workerSelfDeadlineSeconds: 3_300,
      providerMaximumExecutionTtlSeconds: 3_600,
      dispatchDeadline: "2026-07-13T11:00:00.000Z",
      observationIntervalSeconds: 15,
      checkpointIntervalSeconds: 300,
      cancelGracePeriodSeconds: 30,
      terminationGracePeriodSeconds: 60,
      terminationConfirmationTimeoutSeconds: 120,
      budgetPolicy: {
        currency: "USD",
        costWarningMicroUsd: "1000000",
        costHardStopMicroUsd: "2000000",
        terminationReserveMicroUsd: "100000",
        absoluteCostCapMicroUsd: "2500000",
        costObservationMaximumAgeSeconds: 60,
      },
      checkpointContract: null,
    },
    stages: [{
      stageId: "geometry",
      stageKind: "geometry",
      dependsOn: [],
      workerProfileId: "geometry-worker",
      workerProfileVersion: "1.0.0",
      workerProfileSha256: DIGEST_E,
      operationClass: "deterministic_transformation",
      containerImage: WORKER_IMAGE,
      command: ["omnitwin-worker", "geometry"],
      networkAccess: "object_storage_only",
      inputAssetIds: ["asset-001"],
      outputNames: ["mesh"],
      rightsPurposes: ["commercial_internal_use"],
      checkpoint: "periodic",
      resumable: true,
      capacityClass: "gpu-l40s",
      requestedResources: {
        cpuCores: 4,
        ramGiB: 16,
        gpuCount: 1,
        minimumGpuVramGiB: 12,
        scratchGiB: 80,
      },
      authorizedCapacity: {
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 1,
        perGpuVramGiB: 24,
        scratchGiB: 100,
      },
      estimatedCostMicroUsd: "500000",
      maximumRuntimeSeconds: 1_800,
    }],
    action: { kind: "provider_submit", providerCommandRef: null },
  });
}

function command(): FoundryClaimedProviderCommandV0 {
  const request = providerRequest();
  const payload = {
    commandKind: "provider_submit" as const,
    executionSubjectSha256: DIGEST_A,
    providerRequest: request,
    providerRequestSha256: computeFoundryProviderRequestSha256(request),
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    stageIds: ["geometry"],
    maximumApiCallSeconds: 30,
    providerCommandRef: null,
    submitLineage: null,
    stopIntentId: null,
  };
  return {
    schemaVersion: FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
    commandKind: "provider_submit",
    commandId: COMMAND_ID,
    executionId: EXECUTION_ID,
    attemptId: ATTEMPT_ID,
    projectId: "project-001",
    jobId: "job-001",
    executionEnvelopeSha256: DIGEST_B,
    providerKind: "runpod",
    providerAdapterId: "runpod-v1",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: DIGEST_C,
    providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
    providerDeploymentSha256: DIGEST_D,
    providerRequestProfileId: "runpod-request-profile-001",
    providerRequestProfileVersion: "1.0.0",
    providerRequestProfileSha256: PROFILE_SHA256,
    attemptOrdinal: 1,
    fencingToken: "7",
    commandSequence: 1,
    claimedBy: "executor-001",
    claimToken: CLAIM_TOKEN,
    claimedAt: CLAIMED_AT.toISOString(),
    claimExpiresAt: CLAIM_EXPIRES_AT.toISOString(),
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  };
}

function followupCommand(
  commandKind: "provider_reconcile" | "provider_poll" | "provider_checkpoint" | "provider_stop",
  providerCommandRef: string | null = PROVIDER_REF,
): FoundryClaimedProviderCommandV0 {
  const base = command();
  const submitAuthorizationSha256 = base.payload.providerRequestSha256;
  const commandId = {
    provider_reconcile: RECONCILE_COMMAND_ID,
    provider_poll: POLL_COMMAND_ID,
    provider_checkpoint: CHECKPOINT_COMMAND_ID,
    provider_stop: STOP_COMMAND_ID,
  }[commandKind];
  const action = commandKind === "provider_reconcile"
    ? {
        kind: commandKind,
        providerCommandRef,
        submitCommandId: COMMAND_ID,
        submitProviderRequestAuthorizationSha256: submitAuthorizationSha256,
      }
    : commandKind === "provider_stop"
    ? {
        kind: commandKind,
        providerCommandRef: providerCommandRef ?? PROVIDER_REF,
        stopIntentId: STOP_INTENT_ID,
      }
    : {
        kind: commandKind,
        providerCommandRef: providerCommandRef ?? PROVIDER_REF,
      };
  const providerRequest = FoundryProviderRequestAuthorizationV0Schema.parse({
    ...base.payload.providerRequest,
    commandKind,
    commandId,
    commandSequence: 2,
    requestIdentity: {
      ...base.payload.providerRequest.requestIdentity,
      clientRequestId: deriveFoundryProviderClientRequestId(commandKind, commandId),
    },
    action,
  });
  const payload = {
    commandKind,
    executionSubjectSha256: base.payload.executionSubjectSha256,
    providerRequest,
    providerRequestSha256: computeFoundryProviderRequestSha256(providerRequest),
    providerIdempotencyKey: base.payload.providerIdempotencyKey,
    stageIds: base.payload.stageIds,
    maximumApiCallSeconds: base.payload.maximumApiCallSeconds,
    providerCommandRef,
    submitLineage: commandKind === "provider_reconcile"
      ? {
          submitCommandId: COMMAND_ID,
          executionSubjectSha256: base.payload.executionSubjectSha256,
          providerIdempotencyKey: base.payload.providerIdempotencyKey,
          providerRequestSha256: submitAuthorizationSha256,
        }
      : null,
    stopIntentId: commandKind === "provider_stop" ? STOP_INTENT_ID : null,
  };
  return {
    ...base,
    commandKind,
    commandId,
    commandSequence: 2,
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  };
}

function claimedRow(current: FoundryClaimedProviderCommandV0) {
  return {
    command_id: current.commandId,
    execution_id: current.executionId,
    attempt_id: current.attemptId,
    project_id: current.projectId,
    job_id: current.jobId,
    execution_envelope_sha256: current.executionEnvelopeSha256,
    provider_kind: current.providerKind,
    provider_adapter_id: current.providerAdapterId,
    provider_adapter_version: current.providerAdapterVersion,
    provider_adapter_artifact_sha256: current.providerAdapterArtifactSha256,
    provider_adapter_configuration_sha256:
      current.providerAdapterConfigurationSha256,
    provider_deployment_sha256: current.providerDeploymentSha256,
    provider_request_profile_id: current.providerRequestProfileId,
    provider_request_profile_version: current.providerRequestProfileVersion,
    provider_request_profile_sha256: current.providerRequestProfileSha256,
    attempt_ordinal: 1,
    fencing_token: "7",
    command_sequence: current.commandSequence,
    command_kind: current.commandKind,
    claimed_by: current.claimedBy,
    claim_token: current.claimToken,
    claimed_at: CLAIMED_AT,
    claim_expires_at: CLAIM_EXPIRES_AT,
    payload: current.payload,
    payload_sha256: current.payloadSha256,
  };
}

function recoveryOutcome(
  current: FoundryClaimedProviderCommandV0,
  providerWasInvoked: boolean,
  actorKey = "watchdog-001",
): FoundryProviderCommandOutcomePayloadV0 {
  const outcomeCode = providerWasInvoked
    ? "claim_lease_expired_effect_unknown"
    : "claim_lease_expired_not_invoked";
  return {
    schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
    commandId: current.commandId,
    executionId: current.executionId,
    attemptId: current.attemptId,
    claimToken: current.claimToken,
    fencingToken: current.fencingToken,
    status: providerWasInvoked ? "uncertain" : "failed",
    outcomeCode,
    providerLifecycle: providerWasInvoked ? "unknown" : "not_observed",
    providerCommandRef: current.payload.providerCommandRef,
    evidenceSha256: computeFoundryProviderCommandInternalEvidenceSha256(
      outcomeCode,
      current.commandId,
    ),
    completedBy: { actorKind: "watchdog", actorKey },
  };
}

function outcome(
  status: "succeeded" | "failed" = "succeeded",
): FoundryProviderCommandOutcomePayloadV0 {
  const current = command();
  return {
    schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
    commandId: current.commandId,
    executionId: current.executionId,
    attemptId: current.attemptId,
    claimToken: current.claimToken,
    fencingToken: current.fencingToken,
    status,
    outcomeCode: status === "succeeded"
      ? "provider_accepted"
      : "adapter_binding_missing",
    providerLifecycle: status === "succeeded" ? "queued" : "not_observed",
    providerCommandRef: status === "succeeded" ? "runpod:pod-001" : null,
    evidenceSha256: DIGEST_A,
    completedBy: {
      actorKind: "service",
      actorKey: current.claimedBy,
    },
  };
}

describe("PostgreSQL Foundry provider-command executor store", () => {
  it("claims one exact pending command with DB time, SKIP LOCKED, and revision CAS", async () => {
    const current = command();
    const harness = scriptedHarness({ rows: [claimedRow(current)] });
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.claimNextCommand("executor-001", ELIGIBLE_BINDINGS),
    ).resolves.toEqual(current);

    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
    const query = harness.queries[0];
    expect(query?.text).toContain("clock_timestamp()");
    expect(query?.text).toContain("jsonb_to_recordset");
    expect(query?.text).toContain(
      "binding.\"providerRequestProfileSha256\" = command.\"provider_request_profile_sha256\"",
    );
    expect(query?.text).toContain(
      "binding.\"targetKind\" = command.\"payload\"->'providerRequest'->'provider'->'target'->>'targetKind'",
    );
    expect(query?.text).toContain("binding.\"targetId\" = COALESCE");
    expect(query?.text).toContain("FOR UPDATE OF command SKIP LOCKED");
    expect(query?.text).toContain("command.\"state\" = 'pending'");
    expect(query?.text).toContain(
      "execution.\"fencing_token\" = command.\"fencing_token\"",
    );
    expect(query?.text).toContain('JOIN "foundry_jobs" job');
    expect(query?.text).toContain(
      'foundry_classify_normalize_mesh_glb_v0_job_spec',
    );
    expect(query?.text).toContain("job.\"job_spec_json\"");
    expect(query?.text).toContain("= 'unrelated'");
    expect(query?.text).toContain('FROM "foundry_job_worker_profiles"');
    expect(query?.text).toContain(
      'derivative_worker_binding."operation_class" =',
    );
    expect(query?.text).toContain("'deterministic_transformation'");
    expect(query?.text).toContain("foundry_execution_authority_is_current");
    expect(query?.text).toContain("foundry_rights_policy_is_active");
    expect(query?.text).toContain("foundry_kill_switches");
    expect(query?.text).toContain(
      "command.\"revision\" = candidate.\"revision\"",
    );
    expect(query?.text).toContain("gen_random_uuid()");
    expect(query?.text).toContain("RETURNING command.*");
  });

  it("returns idle without mutating when no exact command is claimable", async () => {
    const harness = scriptedHarness({ rows: [] });
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.claimNextCommand("executor-001", ELIGIBLE_BINDINGS),
    ).resolves.toBeNull();
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("rejects an empty adapter-eligibility set before starting a transaction", () => {
    const harness = scriptedHarness();
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    expect(() => store.claimNextCommand("executor-001", [])).toThrow();
    expect(harness.queries).toHaveLength(0);
    expect(harness.transactionEvents).toEqual([]);
  });

  it("records invocation authority only after closing the full immutable graph", async () => {
    const current = command();
    const harness = scriptedHarness(
      { rows: [{}] },
      {
        rows: [{
          command_id: current.commandId,
          event_kind: "provider_invocation_started",
        }],
      },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.authorizeAndRecordInvocationStart(current)).resolves.toEqual({
      authorized: true,
    });

    expect(harness.queries[0]?.text).toContain("pg_advisory_xact_lock");
    const query = harness.queries[1];
    expect(query?.text).toContain("JOIN \"foundry_prepared_provider_requests\" prepared");
    expect(query?.text).toContain("JOIN \"foundry_provider_request_profiles\" profile");
    expect(query?.text).toContain("stored.\"payload\" =");
    expect(query?.text).toContain("stored.\"provider_request_sha256\" =");
    expect(query?.text).toContain("stored.\"provider_client_request_id\" =");
    expect(query?.text).toContain("stored.\"claim_token\" =");
    expect(query?.text).toContain(
      "date_trunc('milliseconds', stored.\"claimed_at\")",
    );
    expect(query?.text).toContain("stored.\"claim_expires_at\" > database_clock.\"now\"");
    expect(query?.text).toContain('JOIN "foundry_jobs" job');
    expect(query?.text).toContain(
      'foundry_classify_normalize_mesh_glb_v0_job_spec',
    );
    expect(query?.text).toContain("job.\"job_spec_json\"");
    expect(query?.text).toContain("= 'unrelated'");
    expect(query?.text).toContain('FROM "foundry_job_worker_profiles"');
    expect(query?.text).toContain(
      'derivative_worker_binding."operation_class" =',
    );
    expect(query?.text).toContain("'deterministic_transformation'");
    expect(query?.text).toContain("foundry_execution_authority_is_current");
    expect(query?.text).toContain("foundry_kill_switches");
    expect(query?.text).toContain("INSERT INTO \"foundry_execution_events\"");
    expect(query?.text).toContain("'provider_invocation_started'");
    expect(query?.text).toContain("provider-invocation-start:");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("returns a closed denial when invocation authority no longer selects a row", async () => {
    const harness = scriptedHarness({ rows: [{}] }, { rows: [] });
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.authorizeAndRecordInvocationStart(command())).resolves.toEqual({
      authorized: false,
      reasonCode: "claim_authority_not_current",
    });
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("turns a definite database authority race into a closed denial", async () => {
    const authorityError = Object.assign(new Error("authority changed"), {
      code: "55000",
    });
    const harness = scriptedHarness({ rows: [{}] }, { error: authorityError });
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.authorizeAndRecordInvocationStart(command())).resolves.toEqual({
      authorized: false,
      reasonCode: "database_authority_rejected",
    });
    expect(harness.transactionEvents).toEqual(["begin", "rollback"]);
  });

  it("completes before invocation only when no invocation evidence exists", async () => {
    const current = command();
    const terminal = outcome("failed");
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      { rows: [{
        command_id: current.commandId,
        state: "failed",
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: false,
      }] },
      { rows: [] },
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeBeforeInvocation(current, terminal, outcomeSha256),
    ).resolves.toBeUndefined();

    const root = harness.queries[0];
    const update = harness.queries[1];
    const event = harness.queries[2];
    expect(root?.text).toContain("foundry-kill:0:global");
    expect(update?.text).toContain("NOT EXISTS ( SELECT 1 FROM \"foundry_execution_events\" invocation");
    expect(update?.text).toContain("stored.\"revision\" = locked.\"revision\"");
    expect(update?.text).toContain("\"outcome_json\"");
    expect(event?.text).toContain("'provider_command_completed'");
    expect(event?.text).toContain("command.\"execution_revision\" - prior_event.\"prior_revision\" IN (0, 1)");
    expect(event?.params).toContain(false);
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("completes after invocation only with the matching invocation-start claim", async () => {
    const current = command();
    const terminal = outcome();
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      { rows: [] },
      { rows: [{
        command_id: current.commandId,
        state: "succeeded",
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: true,
      }] },
      { rows: [{ observation_id: OBSERVATION_ID }] },
      classifiedResultRow("already_authoritative"),
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeAfterInvocation(
        current, terminal, outcomeSha256, null, WORKER_OBSERVED_AT,
      ),
    ).resolves.toEqual({ status: "completed" });

    expect(harness.queries[0]?.text).toContain("foundry-kill:0:global");
    expect(harness.queries[1]?.text).toContain(
      "INSERT INTO \"foundry_provider_command_result_observations\"",
    );
    expect(harness.queries[3]?.text).toContain(
      "invocation.\"correlation_id\" = stored.\"correlation_id\"",
    );
    expect(harness.queries[4]?.text).toContain(
      "invocation.\"correlation_id\" = command.\"correlation_id\"",
    );
    expect(harness.queries[4]?.params).toContain(true);
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("classifies a conclusive observation when another terminal outcome wins the CAS", async () => {
    const current = command();
    const terminal = outcome();
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      classifiedResultRow("terminal_conflict"),
      { rows: [] },
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeAfterInvocation(
        current, terminal, outcomeSha256, null, WORKER_OBSERVED_AT,
      ),
    ).resolves.toEqual({
      status: "result_observation_classified",
      observationId: OBSERVATION_ID,
      classification: {
        status: "classified",
        classificationId: CLASSIFICATION_ID,
        completionEventId: COMPLETION_EVENT_ID,
        disposition: "terminal_conflict",
        classifiedAt: "2026-07-13T10:00:32.000Z",
      },
    });
    expect(harness.queries).toHaveLength(5);
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("recognizes an exact committed terminal replay without duplicating artifacts", async () => {
    const current = command();
    const terminal = outcome();
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      classifiedResultRow("already_authoritative"),
      { rows: [] },
      { rows: [{
        command_id: current.commandId,
        state: terminal.status,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{ observation_id: OBSERVATION_ID }] },
      classifiedResultRow("already_authoritative"),
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeAfterInvocation(
        current, terminal, outcomeSha256, null, WORKER_OBSERVED_AT,
      ),
    ).resolves.toEqual({ status: "replayed" });

    expect(harness.queries).toHaveLength(7);
    const replay = harness.queries[4];
    expect(replay?.text).toContain("event.\"event_kind\" = 'provider_command_completed'");
    expect(replay?.text).toContain(
      "event.\"idempotency_key\" = 'provider-command-completion:' || stored.\"id\"::text",
    );
    expect(replay?.text).toContain("event.\"causation_id\" = stored.\"id\"");
    expect(replay?.text).toContain("event.\"request_digest\" = \"foundry_domain_jsonb_sha256\"");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("atomically retains exact verified evidence for a succeeded checkpoint", async () => {
    const current = followupCommand("provider_checkpoint");
    const verifiedCheckpoint = {
      schemaVersion: FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
      checkpointKind: "stage_boundary",
      providerCheckpointId: "runpod-checkpoint-001",
      checkpointSha256: DIGEST_E,
      evidenceRef: "s3://foundry/checkpoints/runpod-checkpoint-001.json",
      providerCreatedAt: "2026-07-13T10:00:20.000Z",
    } as const;
    const terminal: FoundryProviderCommandOutcomePayloadV0 = {
      schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
      commandId: current.commandId,
      executionId: current.executionId,
      attemptId: current.attemptId,
      claimToken: current.claimToken,
      fencingToken: current.fencingToken,
      status: "succeeded",
      outcomeCode: "provider_checkpoint_verified",
      providerLifecycle: "running",
      providerCommandRef: PROVIDER_REF,
      evidenceSha256: computeFoundryProviderCheckpointEvidenceSha256(
        verifiedCheckpoint,
      ),
      completedBy: { actorKind: "service", actorKey: current.claimedBy },
    };
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      { rows: [] },
      { rows: [{
        command_id: current.commandId,
        state: terminal.status,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: true,
      }] },
      { rows: [{
        command_id: current.commandId,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{ observation_id: OBSERVATION_ID }] },
      classifiedResultRow("already_authoritative"),
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.completeAfterInvocation(
      current,
      terminal,
      outcomeSha256,
      verifiedCheckpoint,
      WORKER_OBSERVED_AT,
    )).resolves.toEqual({ status: "completed" });

    expect(harness.queries[5]?.text).toContain(
      "INSERT INTO \"foundry_verified_checkpoints\"",
    );
    expect(harness.queries[5]?.text).toContain(
      "command.\"completed_by_actor_kind\" = 'service'",
    );
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("creates checkpoint-unknown intent and exact stop custody in the same transaction", async () => {
    const current = followupCommand("provider_checkpoint");
    const terminal: FoundryProviderCommandOutcomePayloadV0 = {
      schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
      commandId: current.commandId,
      executionId: current.executionId,
      attemptId: current.attemptId,
      claimToken: current.claimToken,
      fencingToken: current.fencingToken,
      status: "uncertain",
      outcomeCode: "provider_checkpoint_effect_unknown",
      providerLifecycle: "unknown",
      providerCommandRef: PROVIDER_REF,
      evidenceSha256: computeFoundryProviderCommandInternalEvidenceSha256(
        "provider_checkpoint_effect_unknown",
        current.commandId,
      ),
      completedBy: { actorKind: "service", actorKey: current.claimedBy },
    };
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      { rows: [{
        command_id: current.commandId,
        state: terminal.status,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: true,
      }] },
      { rows: [] },
      { rows: [{ attempt_id: current.attemptId }] },
      { rows: [{ intent_id: STOP_INTENT_ID }] },
      { rows: [{ intent_id: STOP_INTENT_ID }] },
      { rows: [{
        command_id: STOP_COMMAND_ID,
        command_kind: "provider_stop",
      }] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeAfterInvocation(
        current, terminal, outcomeSha256, null, WORKER_OBSERVED_AT,
      ),
    ).resolves.toEqual({ status: "completed" });

    expect(harness.queries[5]?.text).toContain("'checkpoint_effect_unknown'");
    const successor = harness.queries[7];
    expect(successor?.text).toContain("JOIN prepared ON prepared.\"id\" = command_digest.\"prepared_id\"");
    expect(successor?.text).toContain("\"attempt_provider_execution_ref\"");
    expect(successor?.text).toContain("'provider_stop'");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("releases only an expired uninvoked non-submit whose projection is reclaimable", async () => {
    const current = followupCommand("provider_poll");
    const harness = scriptedHarness(
      { rows: [{}] },
      { rows: [{
        ...claimedRow(current),
        provider_was_invoked: false,
        release_safe: true,
      }] },
      { rows: [{ command_id: current.commandId, state: "pending" }] },
    );
    const recovery = createPostgresFoundryExpiredProviderCommandRecovery(
      harness.client,
    );

    await expect(recovery.recoverNextExpiredClaim("watchdog-001")).resolves
      .toEqual({
        status: "released",
        commandId: current.commandId,
        commandKind: current.commandKind,
      });

    expect(harness.queries[0]?.text).toContain("pg_advisory_xact_lock");
    expect(harness.queries[1]?.text).toContain("FOR UPDATE OF stored, attempt, execution SKIP LOCKED");
    expect(harness.queries[1]?.text).toContain("AS \"release_safe\"");
    expect(harness.queries[2]?.text).toContain("SET \"state\" = 'pending'");
    expect(harness.queries[2]?.text).not.toContain("safeExpiredReleasePredicates");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("terminal-fails an expired uninvoked follow-up when its projection is no longer reclaimable", async () => {
    const current = followupCommand("provider_poll");
    const terminal = recoveryOutcome(current, false);
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      { rows: [{
        ...claimedRow(current),
        provider_was_invoked: false,
        release_safe: false,
      }] },
      { rows: [{}] },
      { rows: [{
        command_id: current.commandId,
        state: terminal.status,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: false,
      }] },
      { rows: [] },
      { rows: [] },
    );
    const recovery = createPostgresFoundryExpiredProviderCommandRecovery(
      harness.client,
    );

    await expect(recovery.recoverNextExpiredClaim("watchdog-001")).resolves
      .toMatchObject({
        status: "completed",
        commandId: current.commandId,
        providerWasInvoked: false,
        outcome: terminal,
        outcomeSha256,
      });

    expect(harness.queries[3]?.params).toContain("watchdog");
    expect(harness.queries[3]?.params).toContain("watchdog-001");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("closes an expired invoked submit as uncertain and enqueues deterministic reconciliation", async () => {
    const current = command();
    const terminal = recoveryOutcome(current, true);
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      { rows: [{
        ...claimedRow(current),
        provider_was_invoked: true,
        release_safe: false,
      }] },
      { rows: [{}] },
      { rows: [{
        command_id: current.commandId,
        state: terminal.status,
        outcome_sha256: outcomeSha256,
      }] },
      { rows: [{
        command_id: current.commandId,
        event_kind: "provider_command_completed",
        outcome_sha256: outcomeSha256,
        provider_was_invoked: true,
      }] },
      { rows: [] },
      { rows: [{
        command_id: RECONCILE_COMMAND_ID,
        command_kind: "provider_reconcile",
      }] },
      { rows: [] },
    );
    const recovery = createPostgresFoundryExpiredProviderCommandRecovery(
      harness.client,
    );

    await expect(recovery.recoverNextExpiredClaim("watchdog-001")).resolves
      .toMatchObject({
        status: "completed",
        commandId: current.commandId,
        providerWasInvoked: true,
        outcome: terminal,
        outcomeSha256,
      });

    const successor = harness.queries[6];
    expect(successor?.text).toContain("'provider_reconcile'");
    expect(successor?.text).toContain(
      "JOIN prepared ON prepared.\"id\" = command_digest.\"prepared_id\"",
    );
    expect(successor?.text).toContain("source.\"id\"::text");
    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
  });

  it("drains expired claims deterministically until idle without provider I/O", async () => {
    const recovered: Awaited<ReturnType<
      FoundryExpiredProviderCommandRecovery["recoverNextExpiredClaim"]
    >>[] = [
      {
        status: "released",
        commandId: POLL_COMMAND_ID,
        commandKind: "provider_poll",
      },
      {
        status: "completed",
        commandId: COMMAND_ID,
        providerWasInvoked: true,
        outcome: recoveryOutcome(command(), true),
        outcomeSha256: computeFoundryProviderCommandOutcomeSha256(
          recoveryOutcome(command(), true),
        ),
      },
      { status: "idle" },
    ];
    const recoverNextExpiredClaim = vi.fn(() => Promise.resolve(
      recovered.shift() ?? { status: "idle" as const },
    ));
    const recovery: FoundryExpiredProviderCommandRecovery = {
      recoverNextExpiredClaim,
    };

    await expect(drainExpiredFoundryProviderCommandClaims(
      recovery,
      "watchdog-001",
      10,
    )).resolves.toEqual({
      status: "drained",
      processed: 2,
      released: 1,
      completed: 1,
    });
    expect(recoverNextExpiredClaim).toHaveBeenCalledTimes(3);
    expect(recoverNextExpiredClaim).toHaveBeenNthCalledWith(1, "watchdog-001");
  });

  it("bounds recovery drains and reports remaining work without auto-starting", async () => {
    const recoverNextExpiredClaim = vi.fn(() => Promise.resolve({
      status: "released" as const,
      commandId: POLL_COMMAND_ID,
      commandKind: "provider_poll" as const,
    }));
    const recovery: FoundryExpiredProviderCommandRecovery = {
      recoverNextExpiredClaim,
    };

    await expect(drainExpiredFoundryProviderCommandClaims(
      recovery,
      "watchdog-001",
      2,
    )).resolves.toEqual({
      status: "limit_reached",
      processed: 2,
      released: 2,
      completed: 0,
    });
    expect(recoverNextExpiredClaim).toHaveBeenCalledTimes(2);
    await expect(drainExpiredFoundryProviderCommandClaims(
      recovery,
      "watchdog-001",
      0,
    )).rejects.toBeInstanceOf(FoundryPostgresProviderCommandStoreError);
  });

  it("retains an exact raw observation behind the global lock without projection authority", async () => {
    const adapterOutcome: FoundryProviderAdapterOutcomeV0 = {
      status: "succeeded",
      outcomeCode: "provider_accepted",
      providerLifecycle: "queued",
      providerCommandRef: PROVIDER_REF,
      evidenceSha256: DIGEST_A,
    };
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.retainProviderResultObservation(
      command(),
      adapterOutcome,
      computeFoundryProviderAdapterOutcomeSha256(adapterOutcome),
      WORKER_OBSERVED_AT,
    )).resolves.toEqual({
      status: "observed",
      observationId: OBSERVATION_ID,
      invocationEventId: INVOCATION_EVENT_ID,
      workerObservedAt: WORKER_OBSERVED_AT,
      recordedAt: "2026-07-13T10:00:31.000Z",
      classification: { status: "held" },
    });
    expect(harness.queries[0]?.text).toContain("foundry-kill:0:global");
    expect(harness.queries[1]?.text).toContain(
      "INSERT INTO \"foundry_provider_command_result_observations\"",
    );
    expect(harness.queries[1]?.text).toContain("provider_invocation_started");
    expect(harness.queries[1]?.text).toContain("CROSS JOIN exact_command");
    expect(harness.queries[1]?.text).not.toContain("UPDATE \"foundry_provider_commands\"");
    expect(harness.queries[1]?.text).not.toContain("INSERT INTO \"foundry_execution_events\"");
  });

  it("rejects a non-canonical late-result digest before acquiring a DB lock", async () => {
    const adapterOutcome: FoundryProviderAdapterOutcomeV0 = {
      status: "succeeded",
      outcomeCode: "provider_accepted",
      providerLifecycle: "queued",
      providerCommandRef: PROVIDER_REF,
      evidenceSha256: DIGEST_A,
    };
    const harness = scriptedHarness();
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.retainProviderResultObservation(
      command(), adapterOutcome, DIGEST_B, WORKER_OBSERVED_AT,
    )).rejects.toBeInstanceOf(FoundryPostgresProviderCommandStoreError);
    expect(harness.queries).toHaveLength(0);
    expect(harness.transactionEvents).toEqual([]);
  });

  it("classifies a raw observation when a conflicting terminal wins the CAS", async () => {
    const current = command();
    const terminal = outcome();
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(terminal);
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow(),
      classifiedResultRow("terminal_conflict"),
      { rows: [] },
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.completeAfterInvocation(
      current, terminal, outcomeSha256, null, WORKER_OBSERVED_AT,
    )).resolves.toMatchObject({
      status: "result_observation_classified",
      observationId: OBSERVATION_ID,
      classification: {
        status: "classified",
        disposition: "terminal_conflict",
      },
    });
    expect(harness.queries[1]?.text).toContain(
      "INSERT INTO \"foundry_provider_command_result_observations\"",
    );
  });

  it("keeps a late checkpoint success as raw evidence without checkpoint authority", async () => {
    const current = followupCommand("provider_checkpoint");
    const verifiedCheckpoint = {
      schemaVersion: FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
      checkpointKind: "provider_snapshot",
      checkpointSha256: DIGEST_B,
      evidenceRef: "r2://foundry/checkpoints/checkpoint-001.json",
      providerCheckpointId: "checkpoint-001",
      providerCreatedAt: "2026-07-13T10:00:20.000+00:00",
    } as const;
    const adapterOutcome: FoundryProviderAdapterOutcomeV0 = {
      status: "succeeded",
      outcomeCode: "checkpoint_created",
      providerLifecycle: "running",
      providerCommandRef: PROVIDER_REF,
      evidenceSha256: computeFoundryProviderCheckpointEvidenceSha256(verifiedCheckpoint),
      verifiedCheckpoint,
    };
    const harness = scriptedHarness(
      { rows: [{}] },
      observedResultRow("replayed"),
      { rows: [] },
    );
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(store.retainProviderResultObservation(
      current,
      adapterOutcome,
      computeFoundryProviderAdapterOutcomeSha256(adapterOutcome),
      WORKER_OBSERVED_AT,
    )).resolves.toMatchObject({
      status: "replayed",
      classification: { status: "held" },
    });
    expect(harness.queries[1]?.params).toContain(JSON.stringify(adapterOutcome));
    expect(harness.queries[1]?.text).not.toContain(
      "INSERT INTO \"foundry_verified_checkpoints\"",
    );
    expect(harness.queries[1]?.text).not.toContain("INSERT INTO \"foundry_execution_events\"");
  });

  it.each([
    ["provider_poll", "succeeded", "queued"],
    ["provider_poll", "failed", "not_observed"],
    ["provider_checkpoint", "succeeded", "running"],
    ["provider_checkpoint", "failed", "not_observed"],
    ["provider_stop", "succeeded", "terminated"],
    ["provider_stop", "failed", "not_observed"],
  ] as const)(
    "rejects a null terminal provider reference for %s %s before issuing SQL",
    async (commandKind, status, providerLifecycle) => {
      const current = followupCommand(commandKind);
      const verifiedCheckpoint = commandKind === "provider_checkpoint" && status === "succeeded"
        ? {
            schemaVersion: FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
            checkpointKind: "provider_snapshot" as const,
            checkpointSha256: DIGEST_B,
            evidenceRef: "r2://foundry/checkpoints/null-ref-negative.json",
            providerCheckpointId: "null-ref-negative",
            providerCreatedAt: "2026-07-13T10:00:20.000Z",
          } as const
        : null;
      const terminal: FoundryProviderCommandOutcomePayloadV0 = {
        schemaVersion: "omnitwin.foundry.provider-command-outcome.v0",
        commandId: current.commandId,
        executionId: current.executionId,
        attemptId: current.attemptId,
        claimToken: current.claimToken,
        fencingToken: current.fencingToken,
        status,
        outcomeCode: `null_ref_${commandKind}_${status}`,
        providerLifecycle,
        providerCommandRef: null,
        evidenceSha256: verifiedCheckpoint === null
          ? DIGEST_A
          : computeFoundryProviderCheckpointEvidenceSha256(verifiedCheckpoint),
        completedBy: { actorKind: "service", actorKey: current.claimedBy },
      };
      const harness = scriptedHarness();
      const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

      await expect(store.completeAfterInvocation(
        current,
        terminal,
        computeFoundryProviderCommandOutcomeSha256(terminal),
        verifiedCheckpoint,
        WORKER_OBSERVED_AT,
      )).rejects.toThrow(/immutable command outcome contract/u);
      expect(harness.queries).toHaveLength(0);
      expect(harness.transactionEvents).toEqual(["begin", "rollback"]);
    },
  );

  it("rejects a non-canonical outcome digest before issuing SQL", async () => {
    const terminal = outcome();
    const harness = scriptedHarness();
    const store = createPostgresFoundryProviderCommandExecutorStore(harness.client);

    await expect(
      store.completeAfterInvocation(
        command(), terminal, DIGEST_B, null, WORKER_OBSERVED_AT,
      ),
    ).rejects.toBeInstanceOf(FoundryPostgresProviderCommandStoreError);
    expect(harness.queries).toHaveLength(0);
    expect(harness.transactionEvents).toEqual(["begin", "rollback"]);
  });
});
