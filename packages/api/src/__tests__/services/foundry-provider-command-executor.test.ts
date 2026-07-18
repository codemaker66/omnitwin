import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FoundryClaimedProviderCommandV0Schema,
  FoundryProviderCommandExecutorError,
  executeNextFoundryProviderCommand,
  computeFoundryProviderCommandPayloadSha256,
  computeFoundryProviderRequestSha256,
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderAdapterOutcomeV0,
  type FoundryProviderCommandAdapter,
  type FoundryProviderCommandExecutorStore,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
  type FoundryProviderCommandKindV0,
  type FoundryProviderRequestAuthorizationV0,
} from "../../services/foundry-provider-request-authorization.js";

const COMMAND_ID = "00000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "00000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000003";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000004";
const STOP_INTENT_ID = "00000000-0000-4000-8000-000000000005";
const RECONCILE_COMMAND_ID = "00000000-0000-4000-8000-000000000006";
const POLL_COMMAND_ID = "00000000-0000-4000-8000-000000000007";
const CHECKPOINT_COMMAND_ID = "00000000-0000-4000-8000-000000000008";
const STOP_COMMAND_ID = "00000000-0000-4000-8000-000000000010";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const PROFILE_SHA256 = `sha256:${"1".repeat(64)}`;
const ADAPTER_CONFIGURATION_SHA256 = `sha256:${"3".repeat(64)}`;
const WORKER_IMAGE = `registry.example/omnitwin-worker@sha256:${"2".repeat(64)}`;
const PROVIDER_REF = "runpod:pod-001";
const IDEMPOTENCY_KEY = deriveFoundryProviderIdempotencyKey(
  DIGEST_A,
  ATTEMPT_ID,
);
const CLAIM_BINDINGS = [{
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

const COMMAND_IDS: Readonly<Record<FoundryProviderCommandKindV0, string>> = {
  provider_submit: COMMAND_ID,
  provider_reconcile: RECONCILE_COMMAND_ID,
  provider_poll: POLL_COMMAND_ID,
  provider_checkpoint: CHECKPOINT_COMMAND_ID,
  provider_stop: STOP_COMMAND_ID,
};

const COMMAND_SEQUENCES: Readonly<Record<FoundryProviderCommandKindV0, number>> = {
  provider_submit: 1,
  provider_reconcile: 2,
  provider_poll: 3,
  provider_checkpoint: 4,
  provider_stop: 5,
};

function providerAction(
  commandKind: FoundryProviderCommandKindV0,
  providerCommandRef: string | null,
  submitProviderRequestSha256: string,
) {
  switch (commandKind) {
    case "provider_submit":
      return { kind: "provider_submit" as const, providerCommandRef: null };
    case "provider_reconcile":
      return {
        kind: "provider_reconcile" as const,
        providerCommandRef,
        submitCommandId: COMMAND_ID,
        submitProviderRequestAuthorizationSha256:
          submitProviderRequestSha256,
      };
    case "provider_poll":
    case "provider_checkpoint":
      return { kind: commandKind, providerCommandRef: providerCommandRef ?? PROVIDER_REF };
    case "provider_stop":
      return {
        kind: "provider_stop" as const,
        providerCommandRef: providerCommandRef ?? PROVIDER_REF,
        stopIntentId: STOP_INTENT_ID,
      };
  }
}

function providerAuthorization(
  commandKind: FoundryProviderCommandKindV0,
  providerCommandRef: string | null,
  submitProviderRequestSha256: string,
) {
  const commandId = COMMAND_IDS[commandKind];
  return FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind,
    commandId,
    commandSequence: COMMAND_SEQUENCES[commandKind],
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
        commandKind,
        commandId,
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
      workerProfileSha256s: [DIGEST_E, DIGEST_F],
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
      stagePurposes: [
        { stageId: "geometry", purposes: ["commercial_internal_use"] },
        { stageId: "qa", purposes: ["commercial_internal_use"] },
      ],
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
    stages: [
      {
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
      },
      {
        stageId: "qa",
        stageKind: "qa",
        dependsOn: ["geometry"],
        workerProfileId: "qa-worker",
        workerProfileVersion: "1.0.0",
        workerProfileSha256: DIGEST_F,
        operationClass: "read_only_inspection",
        containerImage: WORKER_IMAGE,
        command: ["omnitwin-worker", "qa"],
        networkAccess: "object_storage_only",
        inputAssetIds: ["asset-001"],
        outputNames: ["qa-report"],
        rightsPurposes: ["commercial_internal_use"],
        checkpoint: "none",
        resumable: false,
        capacityClass: "gpu-l40s",
        requestedResources: {
          cpuCores: 2,
          ramGiB: 8,
          gpuCount: 0,
          minimumGpuVramGiB: 0,
          scratchGiB: 10,
        },
        authorizedCapacity: {
          cpuCores: 8,
          ramGiB: 32,
          gpuCount: 1,
          perGpuVramGiB: 24,
          scratchGiB: 100,
        },
        estimatedCostMicroUsd: "100000",
        maximumRuntimeSeconds: 600,
      },
    ],
    action: providerAction(
      commandKind,
      providerCommandRef,
      submitProviderRequestSha256,
    ),
  });
}

function exactClaim(
  commandKind: FoundryProviderCommandKindV0,
  providerCommandRef: string | null,
): FoundryClaimedProviderCommandV0 {
  const submitAuthorization = providerAuthorization(
    "provider_submit",
    null,
    DIGEST_A,
  );
  const submitProviderRequestSha256 = computeFoundryProviderRequestSha256(
    submitAuthorization,
  );
  const providerRequest = commandKind === "provider_submit"
    ? submitAuthorization
    : providerAuthorization(
        commandKind,
        providerCommandRef,
        submitProviderRequestSha256,
      );
  const payload = {
    commandKind,
    executionSubjectSha256: DIGEST_A,
    providerRequest,
    providerRequestSha256: computeFoundryProviderRequestSha256(providerRequest),
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    stageIds: ["geometry", "qa"],
    maximumApiCallSeconds: 30,
    providerCommandRef,
    submitLineage: commandKind === "provider_reconcile"
      ? {
          submitCommandId: COMMAND_ID,
          executionSubjectSha256: DIGEST_A,
          providerIdempotencyKey: IDEMPOTENCY_KEY,
          providerRequestSha256: submitProviderRequestSha256,
        }
      : null,
    stopIntentId: commandKind === "provider_stop" ? STOP_INTENT_ID : null,
  };
  return FoundryClaimedProviderCommandV0Schema.parse({
    schemaVersion: FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
    commandKind,
    commandId: COMMAND_IDS[commandKind],
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
    commandSequence: COMMAND_SEQUENCES[commandKind],
    claimedBy: "executor-001",
    claimToken: CLAIM_TOKEN,
    claimedAt: "2026-07-13T10:00:00.000Z",
    claimExpiresAt: "2026-07-13T10:01:00.000Z",
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  });
}

function claim(overrides: Partial<FoundryClaimedProviderCommandV0> = {}) {
  const current = exactClaim("provider_submit", null);
  return {
    ...current,
    ...overrides,
  } satisfies FoundryClaimedProviderCommandV0;
}

function reconciliationClaim(
  providerCommandRef: string | null = null,
): FoundryClaimedProviderCommandV0 {
  return exactClaim("provider_reconcile", providerCommandRef);
}

function referencedCommand(
  commandKind: "provider_poll" | "provider_checkpoint" | "provider_stop",
): FoundryClaimedProviderCommandV0 {
  return exactClaim(commandKind, PROVIDER_REF);
}

function claimWithReboundAuthorization(
  current: FoundryClaimedProviderCommandV0,
  mutate: (
    authorization: FoundryProviderRequestAuthorizationV0,
  ) => FoundryProviderRequestAuthorizationV0,
  payloadOverrides: Partial<FoundryClaimedProviderCommandV0["payload"]> = {},
): FoundryClaimedProviderCommandV0 {
  const providerRequest = FoundryProviderRequestAuthorizationV0Schema.parse(
    mutate(current.payload.providerRequest),
  );
  const payload = {
    ...current.payload,
    ...payloadOverrides,
    providerRequest,
    providerRequestSha256: computeFoundryProviderRequestSha256(providerRequest),
  };
  return {
    ...current,
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  };
}

function adapter() {
  return {
    providerKind: "runpod" as const,
    providerAdapterId: "runpod-v1",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: DIGEST_C,
    providerDeploymentSha256: DIGEST_D,
    claimBindings: CLAIM_BINDINGS,
    validateClaimedCommand: vi.fn<
      FoundryProviderCommandAdapter["validateClaimedCommand"]
    >(() => ({ valid: true })),
    executeClaimedCommand: vi.fn<
      FoundryProviderCommandAdapter["executeClaimedCommand"]
    >(() => Promise.resolve({
      status: "succeeded",
      outcomeCode: "provider_accepted",
      providerLifecycle: "queued",
      providerCommandRef: "runpod:pod-001",
      evidenceSha256: DIGEST_A,
    })),
  } satisfies FoundryProviderCommandAdapter;
}

function harness(options: {
  readonly command?: FoundryClaimedProviderCommandV0 | null;
  readonly authorized?: boolean;
  readonly completionError?: Error;
  readonly completionErrors?: readonly Error[];
  readonly lateRetentionError?: Error;
  readonly lateRetentionSteps?: readonly (
    | Awaited<ReturnType<FoundryProviderCommandExecutorStore["retainProviderResultObservation"]>>
    | Error
  )[];
} = {}) {
  const calls: string[] = [];
  const completeBeforeInvocation = vi.fn<
    FoundryProviderCommandExecutorStore["completeBeforeInvocation"]
  >((_command, _outcome, _outcomeSha256) => Promise.resolve());
  let completionAttempt = 0;
  const completeAfterInvocation = vi.fn<
    FoundryProviderCommandExecutorStore["completeAfterInvocation"]
  >((_command, _outcome, _outcomeSha256, _verifiedCheckpoint, _workerObservedAt) => {
    const sequencedError = options.completionErrors?.[completionAttempt];
    completionAttempt += 1;
    if (sequencedError !== undefined) return Promise.reject(sequencedError);
    if (options.completionError !== undefined) {
      return Promise.reject(options.completionError);
    }
    return Promise.resolve({ status: "completed" });
  });
  let lateRetentionAttempt = 0;
  const retainProviderResultObservation = vi.fn<
    FoundryProviderCommandExecutorStore["retainProviderResultObservation"]
  >(() => {
    const step = options.lateRetentionSteps?.[lateRetentionAttempt];
    lateRetentionAttempt += 1;
    if (step instanceof Error) return Promise.reject(step);
    if (step !== undefined) return Promise.resolve(step);
    if (options.lateRetentionError !== undefined) {
      return Promise.reject(options.lateRetentionError);
    }
    return Promise.resolve({
      status: "observed",
      observationId: "00000000-0000-4000-8000-000000000020",
      invocationEventId: "00000000-0000-4000-8000-000000000021",
      workerObservedAt: "2026-07-13T10:00:30.000Z",
      recordedAt: "2026-07-13T10:00:31.000Z",
      classification: { status: "held" },
    });
  });
  const store: FoundryProviderCommandExecutorStore = {
    claimNextCommand: () => {
      calls.push("claim");
      return Promise.resolve(options.command === undefined ? claim() : options.command);
    },
    authorizeAndRecordInvocationStart: () => {
      calls.push("authorize-start");
      return Promise.resolve(options.authorized === false
        ? { authorized: false as const, reasonCode: "kill_switch_active" }
        : { authorized: true as const });
    },
    completeBeforeInvocation: (...args) => {
      calls.push("complete-before");
      return completeBeforeInvocation(...args);
    },
    completeAfterInvocation: (...args) => {
      calls.push("complete-after");
      return completeAfterInvocation(...args);
    },
    retainProviderResultObservation: (...args) => {
      calls.push("observe-result");
      return retainProviderResultObservation(...args);
    },
  };
  return {
    store,
    calls,
    completeBeforeInvocation,
    completeAfterInvocation,
    retainProviderResultObservation,
  };
}

describe("Foundry guarded provider command executor", () => {
  it("returns idle without selecting or invoking an adapter", async () => {
    const test = harness({ command: null });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toEqual({ status: "idle" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim"]);
  });

  it("invokes once only after the database records an authorized start", async () => {
    const test = harness();
    const selected = adapter();
    const result = await executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    );
    expect(result).toMatchObject({
      status: "completed",
      commandId: COMMAND_ID,
      outcome: {
        status: "succeeded",
        providerLifecycle: "queued",
        providerCommandRef: "runpod:pod-001",
      },
    });
    expect(test.calls).toEqual([
      "claim",
      "authorize-start",
      "observe-result",
      "complete-after",
      "observe-result",
    ]);
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("fails before invocation when the immutable adapter deployment does not match", async () => {
    const test = harness();
    const selected = { ...adapter(), providerDeploymentSha256: DIGEST_A };
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "ADAPTER_BINDING_MISMATCH" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual([]);
    expect(test.completeBeforeInvocation).not.toHaveBeenCalled();
  });

  it("rechecks kill, rights, deadline, cost, fence, and claim authority before invocation", async () => {
    const test = harness({ authorized: false });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "INVOCATION_START_REJECTED" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim", "authorize-start", "complete-before"]);
  });

  it("completes a schema-rejected request before recording invocation start", async () => {
    const test = harness();
    const selected = adapter();
    selected.validateClaimedCommand.mockReturnValueOnce({
      valid: false,
      reasonCode: "runpod_request_schema_rejected",
    });
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "ADAPTER_REQUEST_REJECTED" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim", "complete-before"]);
  });

  it("turns an adapter exception into uncertain evidence without retrying", async () => {
    const test = harness();
    const selected = adapter();
    selected.executeClaimedCommand.mockRejectedValueOnce(new Error("socket reset"));
    const result = await executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    );
    expect(result).toMatchObject({
      status: "completed",
      outcome: {
        status: "uncertain",
        outcomeCode: "adapter_exception_unknown",
        providerLifecycle: "unknown",
      },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation.mock.calls[0]?.[1]).toMatchObject({
      status: "uncertain",
    });
  });

  it("normalizes an adapter's contradictory uncertain lifecycle back to unknown", async () => {
    const test = harness();
    const selected = adapter();
    selected.executeClaimedCommand.mockResolvedValueOnce({
      status: "uncertain",
      outcomeCode: "provider_effect_unknown",
      providerLifecycle: "queued",
      providerCommandRef: null,
      evidenceSha256: DIGEST_A,
    });

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        status: "uncertain",
        outcomeCode: "adapter_outcome_schema_unknown",
        providerLifecycle: "unknown",
      },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("durably converts submit success without a provider ref to uncertainty", async () => {
    const test = harness();
    const selected = adapter();
    selected.executeClaimedCommand.mockResolvedValueOnce({
      status: "succeeded",
      outcomeCode: "provider_accepted_without_identity",
      providerLifecycle: "queued",
      providerCommandRef: null,
      evidenceSha256: DIGEST_A,
    });

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        status: "uncertain",
        outcomeCode: "adapter_outcome_contract_unknown",
        providerLifecycle: "unknown",
        providerCommandRef: null,
      },
    });
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("durably converts submit failure with an observed lifecycle to uncertainty", async () => {
    const test = harness();
    const selected = adapter();
    selected.executeClaimedCommand.mockResolvedValueOnce({
      status: "failed",
      outcomeCode: "provider_rejected",
      providerLifecycle: "queued",
      providerCommandRef: null,
      evidenceSha256: DIGEST_A,
    });

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        status: "uncertain",
        outcomeCode: "adapter_outcome_contract_unknown",
        providerLifecycle: "unknown",
      },
    });
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("accepts conclusive reconciliation absence only as success with no ref", async () => {
    const command = reconciliationClaim();
    const test = harness({ command });
    const selected = adapter();
    selected.executeClaimedCommand.mockResolvedValueOnce({
      status: "succeeded",
      outcomeCode: "provider_reconcile_not_found",
      providerLifecycle: "not_found",
      providerCommandRef: null,
      evidenceSha256: DIGEST_A,
    });

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        status: "succeeded",
        providerLifecycle: "not_found",
        providerCommandRef: null,
      },
    });
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("never accepts provider-stop success that still reports running", async () => {
    const command = referencedCommand("provider_stop");
    const test = harness({ command });
    const selected = adapter();
    selected.executeClaimedCommand.mockResolvedValueOnce({
      status: "succeeded",
      outcomeCode: "provider_stop_accepted",
      providerLifecycle: "running",
      providerCommandRef: "runpod:pod-001",
      evidenceSha256: DIGEST_A,
    });

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        status: "uncertain",
        outcomeCode: "adapter_outcome_contract_unknown",
        providerLifecycle: "unknown",
        providerCommandRef: "runpod:pod-001",
      },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("surfaces a durable completion failure and never calls the adapter again", async () => {
    const test = harness({ completionError: new Error("database unavailable") });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "COMMAND_COMPLETION_FAILED" });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
  });

  it("retries one explicitly transient completion failure with identical custody input", async () => {
    const transient = Object.assign(new Error("completion acknowledgement unknown"), {
      code: "40003",
    });
    const test = harness({ completionErrors: [transient] });
    const selected = adapter();

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      completion: { status: "completed" },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(2);
    expect(test.completeAfterInvocation.mock.calls[1]).toEqual(
      test.completeAfterInvocation.mock.calls[0],
    );
  });

  it("finds a retryable completion SQLSTATE through a non-retryable wrapper", async () => {
    const transient = Object.assign(new Error("application wrapper"), {
      code: "APP_WRAPPER",
      cause: Object.assign(new Error("serialization outcome unknown"), {
        code: "40003",
      }),
    });
    const test = harness({ completionErrors: [transient] });
    const selected = adapter();

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      completion: { status: "completed" },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    expect(test.completeAfterInvocation).toHaveBeenCalledTimes(2);
    expect(test.completeAfterInvocation.mock.calls[1]).toEqual(
      test.completeAfterInvocation.mock.calls[0],
    );
  });

  it.each(["ECONNRESET", 1006] as const)(
    "retries append-only observation custody through nested transport code %s without reinvoking",
    async (transportCode) => {
      vi.useFakeTimers();
      try {
        const transient = Object.assign(new Error("application wrapper"), {
          code: "APP_WRAPPER",
          cause: Object.assign(new Error("observation transport interrupted"), {
            code: transportCode,
          }),
        });
        const test = harness({ lateRetentionSteps: [transient] });
        const selected = adapter();
        const execution = executeNextFoundryProviderCommand(
          test.store,
          [selected],
          "executor-001",
        );

        await vi.advanceTimersByTimeAsync(250);
        await expect(execution).resolves.toMatchObject({
          status: "completed",
          completion: { status: "completed" },
        });
        expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
        expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(3);
        expect(test.retainProviderResultObservation.mock.calls[1]).toEqual(
          test.retainProviderResultObservation.mock.calls[0],
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("retains a timeout-loser through a multi-second transient outage with identical custody input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      let resolveAdapter: ((outcome: FoundryProviderAdapterOutcomeV0) => void) | undefined;
      const deferred = new Promise<FoundryProviderAdapterOutcomeV0>((resolve) => {
        resolveAdapter = resolve;
      });
      const transient = Object.assign(new Error("Neon transport interrupted"), {
        code: "ECONNRESET",
      });
      const classified = {
        status: "observed" as const,
        observationId: "00000000-0000-4000-8000-000000000020",
        invocationEventId: "00000000-0000-4000-8000-000000000021",
        workerObservedAt: "2026-07-13T10:00:30.000Z",
        recordedAt: "2026-07-13T10:00:31.000Z",
        classification: {
          status: "classified" as const,
          classificationId: "00000000-0000-4000-8000-000000000022",
          completionEventId: "00000000-0000-4000-8000-000000000023",
          disposition: "late_eligible" as const,
          classifiedAt: "2026-07-13T10:00:32.000Z",
        },
      };
      const test = harness({
        lateRetentionSteps: [
          transient,
          transient,
          transient,
          transient,
          classified,
        ],
      });
      const selected = adapter();
      selected.executeClaimedCommand.mockReturnValueOnce(deferred);
      const execution = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await execution;
      if (result.status !== "completed" || result.lateResultCustody === null) {
        throw new Error("timeout did not expose inspectable late-result custody");
      }
      resolveAdapter?.({
        status: "succeeded",
        outcomeCode: "provider_accepted",
        providerLifecycle: "queued",
        providerCommandRef: PROVIDER_REF,
        evidenceSha256: DIGEST_A,
      });
      await vi.advanceTimersByTimeAsync(3_750);

      await expect(result.lateResultCustody).resolves.toEqual(classified);
      expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
      expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(5);
      for (const call of test.retainProviderResultObservation.mock.calls.slice(1)) {
        expect(call).toEqual(test.retainProviderResultObservation.mock.calls[0]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("attaches a long-horizon custody retry when timely custody and completion both fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      const transient = Object.assign(new Error("Neon transport interrupted"), {
        code: "EPIPE",
      });
      const recovered = {
        status: "observed" as const,
        observationId: "00000000-0000-4000-8000-000000000020",
        invocationEventId: "00000000-0000-4000-8000-000000000021",
        workerObservedAt: "2026-07-13T10:00:30.000Z",
        recordedAt: "2026-07-13T10:00:31.000Z",
        classification: { status: "held" as const },
      };
      const test = harness({
        completionError: new Error("completion database unavailable"),
        lateRetentionSteps: [
          transient,
          transient,
          transient,
          transient,
          transient,
          recovered,
        ],
      });
      const selected = adapter();
      const executionError = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      ).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(750);
      const error = await executionError;
      expect(error).toBeInstanceOf(FoundryProviderCommandExecutorError);
      expect(error).toMatchObject({ code: "PROVIDER_RESULT_CUSTODY_FAILED" });
      if (!(error instanceof FoundryProviderCommandExecutorError) ||
          error.lateResultCustody === null) {
        throw new Error("dual failure did not expose recovery custody");
      }
      await vi.advanceTimersByTimeAsync(750);
      await expect(error.lateResultCustody).resolves.toEqual(recovered);
      expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
      expect(test.completeAfterInvocation).toHaveBeenCalledTimes(1);
      expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(6);
      for (const call of test.retainProviderResultObservation.mock.calls.slice(1)) {
        expect(call).toEqual(test.retainProviderResultObservation.mock.calls[0]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops timeout-loser custody at the absolute lease/grace deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:02:00.000Z"));
    try {
      let resolveAdapter: ((outcome: FoundryProviderAdapterOutcomeV0) => void) | undefined;
      const deferred = new Promise<FoundryProviderAdapterOutcomeV0>((resolve) => {
        resolveAdapter = resolve;
      });
      const transient = Object.assign(new Error("Neon transport interrupted"), {
        code: "ETIMEDOUT",
      });
      const test = harness({ lateRetentionError: transient });
      const selected = adapter();
      selected.executeClaimedCommand.mockReturnValueOnce(deferred);
      const execution = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await execution;
      if (result.status !== "completed" || result.lateResultCustody === null) {
        throw new Error("timeout did not expose inspectable late-result custody");
      }
      resolveAdapter?.({
        status: "succeeded",
        outcomeCode: "provider_accepted",
        providerLifecycle: "queued",
        providerCommandRef: PROVIDER_REF,
        evidenceSha256: DIGEST_A,
      });
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(result.lateResultCustody).resolves.toMatchObject({
        status: "failed",
        message: expect.stringContaining("lease/grace retry deadline"),
      });
      expect(test.retainProviderResultObservation.mock.calls.length).toBeGreaterThan(3);
      expect(test.retainProviderResultObservation.mock.calls.length).toBeLessThan(72);
      expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hard-caps timeout-loser custody at 72 exact attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      let resolveAdapter: ((outcome: FoundryProviderAdapterOutcomeV0) => void) | undefined;
      const deferred = new Promise<FoundryProviderAdapterOutcomeV0>((resolve) => {
        resolveAdapter = resolve;
      });
      const transient = Object.assign(new Error("Neon transport interrupted"), {
        code: "EHOSTUNREACH",
      });
      const test = harness({
        command: claim({ claimExpiresAt: "2026-07-13T12:00:00.000Z" }),
        lateRetentionError: transient,
      });
      const selected = adapter();
      selected.executeClaimedCommand.mockReturnValueOnce(deferred);
      const execution = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await execution;
      if (result.status !== "completed" || result.lateResultCustody === null) {
        throw new Error("timeout did not expose inspectable late-result custody");
      }
      resolveAdapter?.({
        status: "succeeded",
        outcomeCode: "provider_accepted",
        providerLifecycle: "queued",
        providerCommandRef: PROVIDER_REF,
        evidenceSha256: DIGEST_A,
      });
      await vi.runAllTimersAsync();

      await expect(result.lateResultCustody).resolves.toMatchObject({
        status: "failed",
        message: expect.stringContaining("hard 72-attempt retry cap"),
      });
      expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(72);
      expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a nontransient timeout-loser custody error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    try {
      let resolveAdapter: ((outcome: FoundryProviderAdapterOutcomeV0) => void) | undefined;
      const deferred = new Promise<FoundryProviderAdapterOutcomeV0>((resolve) => {
        resolveAdapter = resolve;
      });
      const test = harness({ lateRetentionError: new Error("constraint violation") });
      const selected = adapter();
      selected.executeClaimedCommand.mockReturnValueOnce(deferred);
      const execution = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await execution;
      if (result.status !== "completed" || result.lateResultCustody === null) {
        throw new Error("timeout did not expose inspectable late-result custody");
      }
      resolveAdapter?.({
        status: "succeeded",
        outcomeCode: "provider_accepted",
        providerLifecycle: "queued",
        providerCommandRef: PROVIDER_REF,
        evidenceSha256: DIGEST_A,
      });
      await expect(result.lateResultCustody).resolves.toMatchObject({
        status: "failed",
        message: "constraint violation",
      });
      expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(1);
      expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains a conclusive losing adapter promise after the API timeout without rejecting detached work", async () => {
    vi.useFakeTimers();
    try {
      let resolveAdapter: ((outcome: FoundryProviderAdapterOutcomeV0) => void) | undefined;
      const deferred = new Promise<FoundryProviderAdapterOutcomeV0>((resolve) => {
        resolveAdapter = resolve;
      });
      const test = harness();
      const selected = adapter();
      selected.executeClaimedCommand.mockReturnValueOnce(deferred);
      const execution = executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await execution;
      expect(result).toMatchObject({
        status: "completed",
        outcome: {
          status: "uncertain",
          outcomeCode: "adapter_timeout_unknown",
        },
      });
      if (result.status !== "completed" || result.lateResultCustody === null) {
        throw new Error("timeout did not expose inspectable late-result custody");
      }
      resolveAdapter?.({
        status: "succeeded",
        outcomeCode: "provider_accepted",
        providerLifecycle: "queued",
        providerCommandRef: "runpod:pod-001",
        evidenceSha256: DIGEST_A,
      });
      await expect(result.lateResultCustody).resolves.toEqual({
        status: "observed",
        observationId: "00000000-0000-4000-8000-000000000020",
        invocationEventId: "00000000-0000-4000-8000-000000000021",
        workerObservedAt: "2026-07-13T10:00:30.000Z",
        recordedAt: "2026-07-13T10:00:31.000Z",
        classification: { status: "held" },
      });
      expect(test.retainProviderResultObservation).toHaveBeenCalledTimes(2);
      expect(test.retainProviderResultObservation.mock.calls[0]?.[1]).toMatchObject({
        status: "succeeded",
        providerCommandRef: "runpod:pod-001",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  const recomputedScopeDrifts: readonly {
    readonly label: string;
    readonly build: (
      current: FoundryClaimedProviderCommandV0,
    ) => FoundryClaimedProviderCommandV0;
  }[] = [
    {
      label: "command ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          commandId: "00000000-0000-4000-8000-000000000099",
        }),
      ),
    },
    {
      label: "command sequence",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({ ...authorization, commandSequence: 99 }),
      ),
    },
    {
      label: "execution ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          execution: {
            ...authorization.execution,
            executionId: "00000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    },
    {
      label: "attempt ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          execution: {
            ...authorization.execution,
            attemptId: "00000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    },
    {
      label: "fencing token",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          execution: { ...authorization.execution, fencingToken: "99" },
        }),
      ),
    },
    {
      label: "project ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          execution: { ...authorization.execution, projectId: "project-099" },
        }),
      ),
    },
    {
      label: "job ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          execution: { ...authorization.execution, jobId: "job-099" },
        }),
      ),
    },
    {
      label: "execution-envelope evidence",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          evidence: {
            ...authorization.evidence,
            executionEnvelopeSha256: DIGEST_C,
          },
        }),
      ),
    },
    {
      label: "provider adapter ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          provider: { ...authorization.provider, providerAdapterId: "runpod-v2" },
        }),
      ),
    },
    {
      label: "provider artifact",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          provider: {
            ...authorization.provider,
            providerAdapterArtifactSha256: DIGEST_A,
          },
        }),
      ),
    },
    {
      label: "provider adapter configuration",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          provider: {
            ...authorization.provider,
            providerAdapterConfigurationSha256: DIGEST_A,
          },
        }),
      ),
    },
    {
      label: "provider deployment",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          provider: {
            ...authorization.provider,
            providerDeploymentSha256: DIGEST_A,
          },
        }),
      ),
    },
    {
      label: "evidence provider deployment",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          evidence: {
            ...authorization.evidence,
            providerDeploymentSha256: DIGEST_A,
          },
        }),
      ),
    },
    {
      label: "provider request profile",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          provider: {
            ...authorization.provider,
            providerRequestProfileSha256: DIGEST_A,
          },
        }),
      ),
    },
    {
      label: "derived client request ID",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          requestIdentity: {
            ...authorization.requestIdentity,
            clientRequestId: "foundry-submit-attacker",
          },
        }),
      ),
    },
    {
      label: "derived provider idempotency key",
      build: (current) => claimWithReboundAuthorization(
        current,
        (authorization) => ({
          ...authorization,
          requestIdentity: {
            ...authorization.requestIdentity,
            providerIdempotencyKey: "foundry-attacker-attempt",
            resourceMarker: {
              ...authorization.requestIdentity.resourceMarker,
              providerIdempotencyKey: "foundry-attacker-attempt",
            },
          },
        }),
        { providerIdempotencyKey: "foundry-attacker-attempt" },
      ),
    },
  ];

  it.each(recomputedScopeDrifts)(
    "rejects recomputed closed-authorization $label drift before adapter selection",
    async ({ build }) => {
      const test = harness({ command: build(claim()) });
      const selected = adapter();
      await expect(executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
      expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
      expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
      expect(test.calls).toEqual(["claim"]);
    },
  );

  it("rejects a tampered claimed payload before adapter selection", async () => {
    const current = claim();
    const test = harness({
      command: {
        ...current,
        payload: { ...current.payload, stageIds: ["tampered"] },
      },
    });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim"]);
  });

  it("rejects an external command that binds no authorized stage", async () => {
    const current = claim();
    const test = harness({
      command: {
        ...current,
        payload: { ...current.payload, stageIds: [] },
      },
    });
    const selected = adapter();

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
    expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
  });

  it("rejects a claim owned by a different executor", async () => {
    const test = harness({ command: claim({ claimedBy: "executor-002" }) });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "CLAIM_OWNER_MISMATCH" });
    expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim"]);
  });

  it("rejects provider request drift before adapter selection", async () => {
    const current = claim();
    const payload = {
      ...current.payload,
      providerRequest: { ...current.payload.providerRequest, templateId: "template-002" },
    };
    const test = harness({
      command: {
        ...current,
        payload,
      },
    });
    const selected = adapter();
    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    expect(test.calls).toEqual(["claim"]);
  });

  it("rejects top-level command kind smuggling before adapter selection", async () => {
    const current = claim();
    const test = harness({
      command: { ...current, commandKind: "provider_stop" },
    });
    const selected = adapter();

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
    expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
  });

  it("allows no-ref reconciliation only with immutable original-submit lineage", async () => {
    const command = reconciliationClaim();
    const test = harness({ command });
    const selected = adapter();

    await expect(executeNextFoundryProviderCommand(
      test.store,
      [selected],
      "executor-001",
    )).resolves.toMatchObject({
      status: "completed",
      outcome: { providerLifecycle: "queued" },
    });
    expect(selected.executeClaimedCommand).toHaveBeenCalledTimes(1);
  });

  it.each(["provider_poll", "provider_checkpoint", "provider_stop"] as const)(
    "rejects a no-ref %s command before adapter selection",
    async (commandKind) => {
      const current = referencedCommand(commandKind);
      const providerRequest = {
        ...current.payload.providerRequest,
        action: {
          ...current.payload.providerRequest.action,
          providerCommandRef: null,
        },
      };
      const payload = {
        ...current.payload,
        providerRequest,
        providerCommandRef: null,
      };
      const test = harness({
        command: {
          ...current,
          payload: payload as FoundryClaimedProviderCommandV0["payload"],
        },
      });
      const selected = adapter();

      await expect(executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
      expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
      expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
    },
  );

  it("rejects no-ref reconciliation with missing or drifted submit lineage", async () => {
    const current = reconciliationClaim();
    const basePayload = {
      ...current.payload,
    };
    const invalidPayloads = [
      { ...basePayload, submitLineage: null },
      {
        ...basePayload,
        submitLineage: {
          submitCommandId: COMMAND_ID,
          executionSubjectSha256: DIGEST_C,
          providerIdempotencyKey: current.payload.providerIdempotencyKey,
          providerRequestSha256: current.payload.providerRequestSha256,
        },
      },
    ];
    const selected = adapter();

    for (const payload of invalidPayloads) {
      const test = harness({
        command: {
          ...current,
          payload: payload as FoundryClaimedProviderCommandV0["payload"],
        },
      });
      await expect(executeNextFoundryProviderCommand(
        test.store,
        [selected],
        "executor-001",
      )).rejects.toMatchObject({ code: "INVALID_CLAIMED_COMMAND" });
    }
    expect(selected.validateClaimedCommand).not.toHaveBeenCalled();
    expect(selected.executeClaimedCommand).not.toHaveBeenCalled();
  });

  it("requires an exact stop intent only on provider-stop payloads", () => {
    const stop = referencedCommand("provider_stop");
    expect(() => computeFoundryProviderCommandPayloadSha256({
      ...stop.payload,
      stopIntentId: null,
    })).toThrow();

    const submit = claim();
    expect(() => computeFoundryProviderCommandPayloadSha256({
      ...submit.payload,
      stopIntentId: STOP_INTENT_ID,
    })).toThrow();
  });

});
