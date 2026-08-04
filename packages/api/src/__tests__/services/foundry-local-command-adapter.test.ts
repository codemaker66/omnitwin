import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
  FoundryClaimedProviderCommandV0Schema,
  computeFoundryProviderCheckpointEvidenceSha256,
  computeFoundryProviderCommandPayloadSha256,
  computeFoundryProviderRequestSha256,
  validateFoundryProviderOutcomeForCommand,
  type FoundryClaimedProviderCommandV0,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
  FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0,
  computeFoundryLocalSandboxAdapterConfigurationSha256,
  computeFoundryLocalSandboxEnforcementReceiptSha256,
  createFoundryLocalCpuCommandAdapter,
  createFoundryLocalCudaCommandAdapter,
  type FoundryLocalSandboxEnforcementReceiptV0,
  type FoundryLocalSandboxBackend,
  type FoundryLocalSandboxExecutionRequestV0,
} from "../../services/foundry-local-command-adapter.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
  type FoundryProviderCommandKindV0,
  type FoundryProviderRequestAuthorizationV0,
} from "../../services/foundry-provider-request-authorization.js";

const EXECUTION_ID = "00000000-0000-4000-8000-000000000102";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000103";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000104";
const STOP_INTENT_ID = "00000000-0000-4000-8000-000000000105";
const COMMAND_IDS: Readonly<Record<FoundryProviderCommandKindV0, string>> = {
  provider_submit: "00000000-0000-4000-8000-000000000111",
  provider_reconcile: "00000000-0000-4000-8000-000000000112",
  provider_poll: "00000000-0000-4000-8000-000000000113",
  provider_checkpoint: "00000000-0000-4000-8000-000000000114",
  provider_stop: "00000000-0000-4000-8000-000000000115",
};
const SUBJECT_SHA256 = `sha256:${"a".repeat(64)}`;
const ENVELOPE_SHA256 = `sha256:${"b".repeat(64)}`;
const ARTIFACT_SHA256 = `sha256:${"c".repeat(64)}`;
const DEPLOYMENT_SHA256 = `sha256:${"e".repeat(64)}`;
const PROFILE_SHA256 = `sha256:${"f".repeat(64)}`;
const POLICY_SHA256 = `sha256:${"5".repeat(64)}`;
const SECURITY_PROFILE_SHA256 = `sha256:${"8".repeat(64)}`;
const TERMINAL_ENFORCEMENT = {
  mode: "required",
  policySha256: POLICY_SHA256,
  securityProfileSha256: SECURITY_PROFILE_SHA256,
} as const;
const CONFIGURATION_SHA256 =
  computeFoundryLocalSandboxAdapterConfigurationSha256({
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
    runnerProfileId: "sandbox-runner-001",
    terminalEnforcement: TERMINAL_ENFORCEMENT,
  });
const EVIDENCE_SHA256 = `sha256:${"1".repeat(64)}`;
const WORKER_SHA256 = `sha256:${"2".repeat(64)}`;
const ALIGN_IMAGE = `registry.example/align@sha256:${"3".repeat(64)}`;
const GEOMETRY_IMAGE = `registry.example/geometry@sha256:${"4".repeat(64)}`;
const SANDBOX_REF = "local-sandbox:attempt-000103";
const IDEMPOTENCY_KEY = deriveFoundryProviderIdempotencyKey(
  SUBJECT_SHA256,
  ATTEMPT_ID,
);
const FIXED_NOW = new Date("2026-07-13T10:00:30.000Z");
const VERIFIED_CHECKPOINT = {
  schemaVersion: FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0,
  checkpointKind: "stage_boundary",
  providerCheckpointId: "local-checkpoint-001",
  checkpointSha256: EVIDENCE_SHA256,
  evidenceRef: "local://checkpoint/attempt-000103/stage-boundary",
  providerCreatedAt: "2026-07-13T10:00:29.000Z",
} as const;

type LocalKind = "local_cpu" | "local_cuda";

interface AuthorizationOptions {
  readonly gpu?: boolean;
  readonly resourceOverflow?: boolean;
  readonly configurationSha256?: string;
  readonly runnerProfileId?: string;
  readonly remoteTarget?: boolean;
  readonly providerCommandRef?: string | null;
  readonly dispatchDeadline?: string;
}

function actionFor(
  commandKind: FoundryProviderCommandKindV0,
  providerCommandRef: string | null,
  submitAuthorizationSha256: string,
) {
  switch (commandKind) {
    case "provider_submit":
      return { kind: "provider_submit" as const, providerCommandRef: null };
    case "provider_reconcile":
      return {
        kind: "provider_reconcile" as const,
        providerCommandRef,
        submitCommandId: COMMAND_IDS.provider_submit,
        submitProviderRequestAuthorizationSha256: submitAuthorizationSha256,
      };
    case "provider_poll":
    case "provider_checkpoint":
      return {
        kind: commandKind,
        providerCommandRef: providerCommandRef ?? SANDBOX_REF,
      };
    case "provider_stop":
      return {
        kind: "provider_stop" as const,
        providerCommandRef: providerCommandRef ?? SANDBOX_REF,
        stopIntentId: STOP_INTENT_ID,
      };
  }
}

function authorization(
  providerKind: LocalKind,
  commandKind: FoundryProviderCommandKindV0,
  options: AuthorizationOptions = {},
): FoundryProviderRequestAuthorizationV0 {
  const gpu = options.gpu ?? providerKind === "local_cuda";
  const providerCommandRef = options.providerCommandRef ?? (
    commandKind === "provider_submit" || commandKind === "provider_reconcile"
      ? null
      : SANDBOX_REF
  );
  const submitAuthorizationSha256 = commandKind === "provider_submit"
    ? EVIDENCE_SHA256
    : computeFoundryProviderRequestSha256(
      authorization(providerKind, "provider_submit", { gpu }),
    );
  return FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind,
    commandId: COMMAND_IDS[commandKind],
    commandSequence: commandKind === "provider_submit" ? 1 : 2,
    preparedAt: "2026-07-13T09:59:00.000Z",
    execution: {
      executionId: EXECUTION_ID,
      attemptId: ATTEMPT_ID,
      attemptOrdinal: 1,
      fencingToken: "7",
      executionSubjectSha256: SUBJECT_SHA256,
      subjectId: "subject-001",
      projectId: "project-001",
      jobId: "job-001",
    },
    requestIdentity: {
      providerIdempotencyKey: IDEMPOTENCY_KEY,
      clientRequestId: deriveFoundryProviderClientRequestId(
        commandKind,
        COMMAND_IDS[commandKind],
      ),
      resourceMarker: {
        executionSubjectSha256: SUBJECT_SHA256,
        providerIdempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    evidence: {
      jobSpecSha256: EVIDENCE_SHA256,
      reviewedIngestManifestSha256: EVIDENCE_SHA256,
      intakeAdmissionResultSha256: EVIDENCE_SHA256,
      intakeStagingIndexSha256: `sha256:${"5".repeat(64)}`,
      executionEnvelopeSha256: ENVELOPE_SHA256,
      executionPolicySha256: EVIDENCE_SHA256,
      providerPlanSha256: EVIDENCE_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      workerProfileSha256s: [WORKER_SHA256],
      executionConfirmationSha256: EVIDENCE_SHA256,
      computeApprovalSha256: null,
    },
    provider: {
      providerKind,
      providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
      providerAdapterVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerAdapterConfigurationSha256:
        options.configurationSha256 ?? CONFIGURATION_SHA256,
      providerDeploymentId: "local-deployment-001",
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      accountProjectAlias: "omnitwin-local",
      region: "local",
      dataResidency: "local",
      providerRequestProfileId: "local-profile-001",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: PROFILE_SHA256,
      target: options.remoteTarget === true
        ? { targetKind: "remote_worker_pool", poolId: "forbidden-pool" }
        : {
          targetKind: "local_worker",
          runnerProfileId: options.runnerProfileId ?? "sandbox-runner-001",
        },
    },
    rights: {
      rightsApprovalSha256: EVIDENCE_SHA256,
      rightsPolicyEvidenceSha256: EVIDENCE_SHA256,
      rightsPolicyDefinitionSha256: EVIDENCE_SHA256,
      policyVersion: "rights-v1",
      policyGeneration: 1,
      decision: "allowed",
      stagePurposes: [
        { stageId: "align", purposes: ["commercial_internal_use"] },
        { stageId: "geometry", purposes: ["commercial_internal_use"] },
      ],
    },
    storage: {
      sourceMountMode: "read_only",
      objectStorageProfile: null,
      outputPrefix: "foundry/project-001/job-001",
    },
    runtime: {
      maximumApiCallSeconds: 30,
      maximumWallClockSeconds: 3_600,
      workerSelfDeadlineSeconds: 3_300,
      providerMaximumExecutionTtlSeconds: 3_600,
      dispatchDeadline:
        options.dispatchDeadline ?? "2026-07-13T11:00:00.000Z",
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
        stageId: "align",
        stageKind: "align",
        dependsOn: [],
        workerProfileId: "align-worker",
        workerProfileVersion: "1.0.0",
        workerProfileSha256: WORKER_SHA256,
        operationClass: "deterministic_transformation",
        containerImage: ALIGN_IMAGE,
        command: ["omnitwin-worker", "align", "--mode", "exact"],
        networkAccess: "none",
        inputAssetIds: ["asset-b", "asset-a"],
        outputNames: ["aligned-cloud"],
        rightsPurposes: ["commercial_internal_use"],
        checkpoint: "stage_boundary",
        resumable: true,
        capacityClass: gpu ? "local-gpu" : "local-cpu",
        requestedResources: {
          cpuCores: options.resourceOverflow === true ? 9 : 2,
          ramGiB: 8,
          gpuCount: 0,
          minimumGpuVramGiB: 0,
          scratchGiB: 40,
        },
        authorizedCapacity: {
          cpuCores: 8,
          ramGiB: 32,
          gpuCount: gpu ? 1 : 0,
          perGpuVramGiB: gpu ? 24 : 0,
          scratchGiB: 100,
        },
        estimatedCostMicroUsd: "100000",
        maximumRuntimeSeconds: 900,
      },
      {
        stageId: "geometry",
        stageKind: "geometry",
        dependsOn: ["align"],
        workerProfileId: "geometry-worker",
        workerProfileVersion: "1.0.0",
        workerProfileSha256: WORKER_SHA256,
        operationClass: "model_inference",
        containerImage: GEOMETRY_IMAGE,
        command: ["omnitwin-worker", "geometry", "--quality", "high"],
        networkAccess: "restricted",
        inputAssetIds: ["asset-c", "asset-b"],
        outputNames: ["mesh", "quality-report"],
        rightsPurposes: ["commercial_internal_use"],
        checkpoint: "periodic",
        resumable: true,
        capacityClass: gpu ? "local-gpu" : "local-cpu",
        requestedResources: {
          cpuCores: 4,
          ramGiB: 16,
          gpuCount: gpu ? 1 : 0,
          minimumGpuVramGiB: gpu ? 12 : 0,
          scratchGiB: 80,
        },
        authorizedCapacity: {
          cpuCores: 8,
          ramGiB: 32,
          gpuCount: gpu ? 1 : 0,
          perGpuVramGiB: gpu ? 24 : 0,
          scratchGiB: 100,
        },
        estimatedCostMicroUsd: "500000",
        maximumRuntimeSeconds: 1_800,
      },
    ],
    action: actionFor(
      commandKind,
      providerCommandRef,
      submitAuthorizationSha256,
    ),
  });
}

interface ClaimOptions extends AuthorizationOptions {
  readonly claimExpiresAt?: string;
}

function claim(
  providerKind: LocalKind,
  commandKind: FoundryProviderCommandKindV0,
  options: ClaimOptions = {},
): FoundryClaimedProviderCommandV0 {
  const providerRequest = authorization(providerKind, commandKind, options);
  const providerRequestSha256 = computeFoundryProviderRequestSha256(
    providerRequest,
  );
  const submitProviderRequestSha256 = computeFoundryProviderRequestSha256(
    authorization(providerKind, "provider_submit", {
      gpu: options.gpu ?? providerKind === "local_cuda",
    }),
  );
  const payload = {
    commandKind,
    executionSubjectSha256: SUBJECT_SHA256,
    providerRequest,
    providerRequestSha256,
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    stageIds: ["align", "geometry"],
    maximumApiCallSeconds: 30,
    providerCommandRef: providerRequest.action.providerCommandRef,
    submitLineage: commandKind === "provider_reconcile"
      ? {
        submitCommandId: COMMAND_IDS.provider_submit,
        executionSubjectSha256: SUBJECT_SHA256,
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
    executionEnvelopeSha256: ENVELOPE_SHA256,
    providerKind,
    providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
    providerAdapterVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
    providerAdapterArtifactSha256: ARTIFACT_SHA256,
    providerAdapterConfigurationSha256:
      providerRequest.provider.providerAdapterConfigurationSha256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    providerRequestProfileId: "local-profile-001",
    providerRequestProfileVersion: "1.0.0",
    providerRequestProfileSha256: PROFILE_SHA256,
    attemptOrdinal: 1,
    fencingToken: "7",
    commandSequence: commandKind === "provider_submit" ? 1 : 2,
    claimedBy: "local-executor-001",
    claimToken: CLAIM_TOKEN,
    claimedAt: "2026-07-13T10:00:00.000Z",
    claimExpiresAt:
      options.claimExpiresAt ?? "2026-07-13T10:01:00.000Z",
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  });
}

const binding = {
  providerAdapterConfigurationSha256: CONFIGURATION_SHA256,
  providerRequestProfileId: "local-profile-001",
  providerRequestProfileVersion: "1.0.0",
  providerRequestProfileSha256: PROFILE_SHA256,
  runnerProfileId: "sandbox-runner-001",
  terminalEnforcement: TERMINAL_ENFORCEMENT,
} as const;

type BackendOperation = keyof FoundryLocalSandboxBackend;

function backendHarness(
  handler: (
    operation: BackendOperation,
    request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => unknown,
) {
  const invoke = (
    operation: BackendOperation,
    request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise.resolve(handler(operation, request, signal));
  const backend: FoundryLocalSandboxBackend = {
    submitExact: vi.fn((request, signal) =>
      invoke("submitExact", request, signal)),
    reconcileExact: vi.fn((request, signal) =>
      invoke("reconcileExact", request, signal)),
    pollExact: vi.fn((request, signal) =>
      invoke("pollExact", request, signal)),
    checkpointExact: vi.fn((request, signal) =>
      invoke("checkpointExact", request, signal)),
    stopExact: vi.fn((request, signal) =>
      invoke("stopExact", request, signal)),
  };
  return backend;
}

function observedResult(
  request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
  lifecycle: "queued" | "running" | "exited" | "terminated",
  providerCommandRef = SANDBOX_REF,
) {
  return {
    kind: "observed" as const,
    providerKind: request.providerKind,
    durableResourceMarker: request.durableResourceMarker,
    providerCommandRef,
    lifecycle,
  };
}

type EnforcementReceiptPayload = Omit<
  FoundryLocalSandboxEnforcementReceiptV0,
  "receiptSha256"
>;

function enforcementReceipt(
  request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
  overrides: Partial<EnforcementReceiptPayload> = {},
): FoundryLocalSandboxEnforcementReceiptV0 {
  const payload: EnforcementReceiptPayload = {
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0,
    instanceSpecSha256: EVIDENCE_SHA256,
    policySha256: POLICY_SHA256,
    markerSha256: request.durableResourceMarker.markerSha256,
    providerCommandRef: SANDBOX_REF,
    engineIdentitySha256: `sha256:${"6".repeat(64)}`,
    containerIdentitySha256: `sha256:${"7".repeat(64)}`,
    securityProfileSha256: SECURITY_PROFILE_SHA256,
    inputVolumeReceiptSha256: `sha256:${"9".repeat(64)}`,
    outputVolumeReceiptSha256: `sha256:${"0".repeat(64)}`,
    exitCode: 0,
    oomKilled: false,
    deadlineExceeded: false,
    terminationIntent: "none",
    containerInitPidZero: true,
    processTreeEvidence: "docker_inspect_stopped_init_only",
    outputVerified: true,
    containerFinishedAt: "2026-07-13T10:00:29.000Z",
    ...overrides,
  };
  return {
    ...payload,
    receiptSha256:
      computeFoundryLocalSandboxEnforcementReceiptSha256(payload),
  };
}

function notFoundResult(
  request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
) {
  return {
    kind: "not_found" as const,
    providerKind: request.providerKind,
    durableResourceMarker: request.durableResourceMarker,
  };
}

function adapterOptions(backend: FoundryLocalSandboxBackend) {
  return {
    providerAdapterArtifactSha256: ARTIFACT_SHA256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    binding,
    backend,
    now: () => FIXED_NOW,
  };
}

function totalBackendCalls(backend: FoundryLocalSandboxBackend): number {
  return [
    backend.submitExact,
    backend.reconcileExact,
    backend.pollExact,
    backend.checkpointExact,
    backend.stopExact,
  ].reduce(
    (total, operation) => total + vi.mocked(operation).mock.calls.length,
    0,
  );
}

describe("Foundry provider-neutral local sandbox command adapter", () => {
  it("roots runner and terminal enforcement in the durable adapter configuration digest", () => {
    const backend = backendHarness(() => {
      throw new Error("backend must remain unreachable");
    });
    const options = adapterOptions(backend);

    expect(() => createFoundryLocalCpuCommandAdapter({
      ...options,
      binding: {
        ...options.binding,
        terminalEnforcement: { mode: "not_supported" },
      },
    })).toThrow(/durable adapter configuration digest/u);
    expect(() => createFoundryLocalCpuCommandAdapter({
      ...options,
      binding: {
        ...options.binding,
        terminalEnforcement: {
          ...TERMINAL_ENFORCEMENT,
          policySha256: EVIDENCE_SHA256,
        },
      },
    })).toThrow(/durable adapter configuration digest/u);
    expect(totalBackendCalls(backend)).toBe(0);
  });

  it("forwards the exact ordered CPU DAG and every sandbox constraint unchanged", async () => {
    const backend = backendHarness((_operation, request) =>
      observedResult(request, "queued"));
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const command = claim("local_cpu", "provider_submit");

    expect(adapter.validateClaimedCommand(command)).toEqual({ valid: true });
    const outcome = await adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      status: "succeeded",
      outcomeCode: "local_submit_accepted",
      providerLifecycle: "queued",
      providerCommandRef: SANDBOX_REF,
    });
    expect(validateFoundryProviderOutcomeForCommand(command, outcome)).toEqual({
      valid: true,
    });
    expect(backend.submitExact).toHaveBeenCalledTimes(1);
    const request = vi.mocked(backend.submitExact).mock.calls[0]?.[0];
    expect(request).toBeDefined();
    if (request === undefined) throw new Error("missing local submit request");
    expect(request.authorizationSha256).toBe(
      command.payload.providerRequestSha256,
    );
    expect(request.authorization).toEqual(command.payload.providerRequest);
    expect(request.sandbox.stageDag).toEqual(
      command.payload.providerRequest.stages,
    );
    expect(request.sandbox.stageDag.map((stage) => stage.stageId)).toEqual([
      "align",
      "geometry",
    ]);
    expect(request.sandbox.stageDag.map((stage) => stage.dependsOn)).toEqual([
      [],
      ["align"],
    ]);
    expect(request.sandbox.stageDag.map((stage) => stage.command)).toEqual([
      ["omnitwin-worker", "align", "--mode", "exact"],
      ["omnitwin-worker", "geometry", "--quality", "high"],
    ]);
    expect(request.sandbox.stageDag.map((stage) => stage.containerImage)).toEqual([
      ALIGN_IMAGE,
      GEOMETRY_IMAGE,
    ]);
    expect(request.sandbox.imagePolicy).toBe("pinned_digest_only");
    expect(request.sandbox.stagedInputs).toEqual({
      mountMode: "read_only",
      intakeStagingIndexSha256: `sha256:${"5".repeat(64)}`,
      reviewedIngestManifestSha256: EVIDENCE_SHA256,
      assetIds: ["asset-a", "asset-b", "asset-c"],
    });
    expect(request.sandbox.output.authorizedPrefix).toBe(
      command.payload.providerRequest.storage.outputPrefix,
    );
    expect(request.sandbox.output.isolatedPrefix).toBe(
      `${command.payload.providerRequest.storage.outputPrefix}/.foundry-sandbox/${request.durableResourceMarker.markerSha256.slice(7)}`,
    );
    expect(request.sandbox.networkPolicy).toEqual({
      enforcement: "per_stage_exact",
      stages: [
        { stageId: "align", networkAccess: "none" },
        { stageId: "geometry", networkAccess: "restricted" },
      ],
    });
    expect(request.sandbox.resourcePolicy.stages).toEqual(
      command.payload.providerRequest.stages.map((stage) => ({
        stageId: stage.stageId,
        requested: stage.requestedResources,
        limit: stage.authorizedCapacity,
      })),
    );
    expect(request.sandbox.deadlines).toEqual({
      ...command.payload.providerRequest.runtime,
      claimExpiresAt: command.claimExpiresAt,
    });
    expect(request.command.action).toEqual(command.payload.providerRequest.action);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.authorization)).toBe(true);
    expect(Object.isFrozen(request.sandbox.stageDag)).toBe(true);
    expect(Object.isFrozen(request.sandbox.stageDag[1]?.command)).toBe(true);
    expect(backend.reconcileExact).not.toHaveBeenCalled();
    expect(backend.pollExact).not.toHaveBeenCalled();
    expect(backend.checkpointExact).not.toHaveBeenCalled();
    expect(backend.stopExact).not.toHaveBeenCalled();
  });

  it("creates an exact CUDA adapter and preserves GPU requests and hard limits", async () => {
    const backend = backendHarness((_operation, request) =>
      observedResult(request, "running"));
    const adapter = createFoundryLocalCudaCommandAdapter(
      adapterOptions(backend),
    );
    const command = claim("local_cuda", "provider_submit");

    await expect(adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "succeeded",
      providerLifecycle: "running",
    });
    expect(adapter.providerKind).toBe("local_cuda");
    const request = vi.mocked(backend.submitExact).mock.calls[0]?.[0];
    expect(request?.sandbox.resourcePolicy.stages[1]).toMatchObject({
      requested: { gpuCount: 1, minimumGpuVramGiB: 12 },
      limit: { gpuCount: 1, perGpuVramGiB: 24 },
    });
  });

  it("allows a CPU-only medium workload on an exact local CUDA binding", async () => {
    const backend = backendHarness((_operation, request) =>
      observedResult(request, "running"));
    const adapter = createFoundryLocalCudaCommandAdapter(
      adapterOptions(backend),
    );
    const command = claim("local_cuda", "provider_submit", { gpu: false });

    expect(adapter.validateClaimedCommand(command)).toEqual({ valid: true });
    await expect(adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "succeeded",
      providerLifecycle: "running",
    });
    const request = vi.mocked(backend.submitExact).mock.calls[0]?.[0];
    expect(request?.sandbox.resourcePolicy.stages.every(
      (stage) =>
        stage.requested.gpuCount === 0 &&
        stage.requested.minimumGpuVramGiB === 0,
    )).toBe(true);
  });

  it("rejects mixed or local-ineligible payloads before backend I/O", async () => {
    const backend = backendHarness(() => {
      throw new Error("backend must remain unreachable");
    });
    const cpuAdapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const cases = [
      {
        adapter: cpuAdapter,
        command: claim("local_cpu", "provider_submit", { gpu: true }),
        reasonCode: "local_cpu_gpu_resource_rejected",
      },
      {
        adapter: cpuAdapter,
        command: claim("local_cpu", "provider_submit", {
          resourceOverflow: true,
        }),
        reasonCode: "local_resource_limit_exceeded",
      },
      {
        adapter: cpuAdapter,
        command: claim("local_cuda", "provider_submit"),
        reasonCode: "local_adapter_binding_mismatch",
      },
      {
        adapter: cpuAdapter,
        command: claim("local_cpu", "provider_submit", {
          remoteTarget: true,
        }),
        reasonCode: "local_request_binding_mismatch",
      },
      {
        adapter: cpuAdapter,
        command: claim("local_cpu", "provider_submit", {
          configurationSha256: EVIDENCE_SHA256,
        }),
        reasonCode: "local_request_binding_mismatch",
      },
      {
        adapter: cpuAdapter,
        command: claim("local_cpu", "provider_poll", {
          providerCommandRef: "foreign-sandbox:attempt-000103",
        }),
        reasonCode: "local_command_ref_namespace_mismatch",
      },
    ];

    for (const testCase of cases) {
      expect(testCase.adapter.validateClaimedCommand(testCase.command)).toEqual({
        valid: false,
        reasonCode: testCase.reasonCode,
      });
      await expect(testCase.adapter.executeClaimedCommand(
        testCase.command,
        new AbortController().signal,
      )).resolves.toMatchObject({
        status: "failed",
        outcomeCode: testCase.reasonCode,
        providerLifecycle: "not_observed",
      });
    }
    expect(totalBackendCalls(backend)).toBe(0);
  });

  it("uses the exact durable marker for retry and rejects marker drift", async () => {
    const requests: Readonly<FoundryLocalSandboxExecutionRequestV0>[] = [];
    const backend = backendHarness((_operation, request) => {
      requests.push(request);
      if (requests.length === 1) return observedResult(request, "queued");
      return {
        ...observedResult(request, "queued"),
        durableResourceMarker: {
          ...request.durableResourceMarker,
          executionSubjectSha256: EVIDENCE_SHA256,
        },
      };
    });
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const command = claim("local_cpu", "provider_submit");

    const first = await adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    );
    const second = await adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    );

    expect(first.status).toBe("succeeded");
    expect(requests[0]?.durableResourceMarker).toEqual(
      requests[1]?.durableResourceMarker,
    );
    expect(requests[0]?.sandbox.output.isolatedPrefix).toBe(
      requests[1]?.sandbox.output.isolatedPrefix,
    );
    expect(second).toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_result_unknown",
      providerLifecycle: "unknown",
    });
  });

  it.each([
    ["provider_poll", "pollExact", "running", "local_poll_running"],
    ["provider_checkpoint", "checkpointExact", "exited", "local_checkpoint_exited"],
    ["provider_stop", "stopExact", "terminated", "local_stop_terminated"],
  ] as const)(
    "normalizes exact %s observations and invokes only %s",
    async (commandKind, operation, lifecycle, outcomeCode) => {
      const backend = backendHarness((_operation, request) => ({
        ...observedResult(request, lifecycle),
        ...(lifecycle === "exited" || lifecycle === "terminated"
          ? { enforcementReceipt: enforcementReceipt(request) }
          : {}),
        ...(commandKind === "provider_checkpoint"
          ? { verifiedCheckpoint: VERIFIED_CHECKPOINT }
          : {}),
      }));
      const adapter = createFoundryLocalCpuCommandAdapter(
        adapterOptions(backend),
      );
      const command = claim("local_cpu", commandKind);
      const outcome = await adapter.executeClaimedCommand(
        command,
        new AbortController().signal,
      );

      expect(outcome).toMatchObject({
        status: "succeeded",
        outcomeCode,
        providerLifecycle: lifecycle,
        providerCommandRef: SANDBOX_REF,
      });
      expect(validateFoundryProviderOutcomeForCommand(command, outcome)).toEqual({
        valid: true,
      });
      if (commandKind === "provider_checkpoint") {
        expect(outcome.verifiedCheckpoint).toEqual({
          ...VERIFIED_CHECKPOINT,
          providerCreatedAt: "2026-07-13T10:00:29.000+00:00",
        });
        expect(outcome.evidenceSha256).toBe(
          computeFoundryProviderCheckpointEvidenceSha256(VERIFIED_CHECKPOINT),
        );
      }
      expect(backend[operation]).toHaveBeenCalledTimes(1);
      expect(totalBackendCalls(backend)).toBe(1);
    },
  );

  it("accepts only digest-valid, identity-bound successful exit receipts", async () => {
    const command = claim("local_cpu", "provider_poll");
    const executeWith = async (
      receiptFor: (
        request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
      ) => unknown,
    ) => {
      const backend = backendHarness((_operation, request) => {
        const enforcementReceipt = receiptFor(request);
        return {
          ...observedResult(request, "exited"),
          ...(enforcementReceipt === undefined ? {} : { enforcementReceipt }),
        };
      });
      return createFoundryLocalCpuCommandAdapter(
        adapterOptions(backend),
      ).executeClaimedCommand(command, new AbortController().signal);
    };

    await expect(executeWith((request) => enforcementReceipt(request)))
      .resolves.toMatchObject({
        status: "succeeded",
        outcomeCode: "local_poll_exited",
        providerLifecycle: "exited",
      });

    await expect(executeWith(() => undefined)).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_enforcement_receipt_required_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => ({
      ...enforcementReceipt(request),
      receiptSha256: EVIDENCE_SHA256,
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_result_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => enforcementReceipt(request, {
      markerSha256: `sha256:${"3".repeat(64)}`,
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_enforcement_receipt_identity_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => enforcementReceipt(request, {
      policySha256: `sha256:${"4".repeat(64)}`,
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_enforcement_receipt_identity_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => enforcementReceipt(request, {
      securityProfileSha256: `sha256:${"4".repeat(64)}`,
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_enforcement_receipt_identity_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => enforcementReceipt(request, {
      providerCommandRef: "local-sandbox:other",
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_enforcement_receipt_identity_unknown",
      providerLifecycle: "unknown",
    });

    await expect(executeWith((request) => enforcementReceipt(request, {
      exitCode: 17,
      outputVerified: false,
    }))).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_terminal_enforcement_failed_unknown",
      providerLifecycle: "unknown",
    });
  });

  it("treats absence as conclusive only for reconcile and stop semantics", async () => {
    const backend = backendHarness((_operation, request) =>
      notFoundResult(request));
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const reconcile = claim("local_cpu", "provider_reconcile");
    const stop = claim("local_cpu", "provider_stop");
    const poll = claim("local_cpu", "provider_poll");

    const reconcileOutcome = await adapter.executeClaimedCommand(
      reconcile,
      new AbortController().signal,
    );
    const stopOutcome = await adapter.executeClaimedCommand(
      stop,
      new AbortController().signal,
    );
    const pollOutcome = await adapter.executeClaimedCommand(
      poll,
      new AbortController().signal,
    );

    expect(reconcileOutcome).toMatchObject({
      status: "succeeded",
      outcomeCode: "local_reconcile_not_found",
      providerLifecycle: "not_found",
      providerCommandRef: null,
    });
    expect(stopOutcome).toMatchObject({
      status: "succeeded",
      outcomeCode: "local_stop_already_absent",
      providerLifecycle: "not_found",
      providerCommandRef: SANDBOX_REF,
    });
    expect(pollOutcome).toMatchObject({
      status: "failed",
      outcomeCode: "local_poll_not_found",
      providerLifecycle: "not_found",
      providerCommandRef: SANDBOX_REF,
    });
    expect(validateFoundryProviderOutcomeForCommand(
      reconcile,
      reconcileOutcome,
    )).toEqual({ valid: true });
    expect(validateFoundryProviderOutcomeForCommand(stop, stopOutcome)).toEqual({
      valid: true,
    });
    expect(validateFoundryProviderOutcomeForCommand(poll, pollOutcome)).toEqual({
      valid: true,
    });
  });

  it("makes mismatched references, incomplete stop and queued checkpoint uncertain", async () => {
    const backend = backendHarness((operation, request) => {
      if (operation === "pollExact") {
        return observedResult(request, "running", "local-sandbox:other");
      }
      if (operation === "stopExact") return observedResult(request, "running");
      return observedResult(request, "queued");
    });
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );

    await expect(adapter.executeClaimedCommand(
      claim("local_cpu", "provider_poll"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_identity_unknown",
      providerCommandRef: SANDBOX_REF,
    });
    await expect(adapter.executeClaimedCommand(
      claim("local_cpu", "provider_stop"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_stop_incomplete_unknown",
    });
    await expect(adapter.executeClaimedCommand(
      claim("local_cpu", "provider_checkpoint"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_checkpoint_not_reached_unknown",
    });
  });

  it("preserves recoverable unknown references only for submit under the frozen outcome contract", async () => {
    const backend = backendHarness((_operation, request) => ({
      kind: "unknown",
      providerKind: request.providerKind,
      durableResourceMarker: request.durableResourceMarker,
      reasonCode: "post_reservation_timeout",
      providerCommandRef: SANDBOX_REF,
    }));
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const submit = claim("local_cpu", "provider_submit");
    const reconcile = claim("local_cpu", "provider_reconcile");

    const submitOutcome = await adapter.executeClaimedCommand(
      submit,
      new AbortController().signal,
    );
    const reconcileOutcome = await adapter.executeClaimedCommand(
      reconcile,
      new AbortController().signal,
    );

    expect(submitOutcome).toMatchObject({
      status: "uncertain",
      outcomeCode: "local_submit_unknown",
      providerLifecycle: "unknown",
      providerCommandRef: SANDBOX_REF,
    });
    expect(reconcileOutcome).toMatchObject({
      status: "uncertain",
      outcomeCode: "local_reconcile_unknown",
      providerLifecycle: "unknown",
      providerCommandRef: null,
    });
    expect(validateFoundryProviderOutcomeForCommand(submit, submitOutcome)).toEqual({
      valid: true,
    });
    expect(validateFoundryProviderOutcomeForCommand(
      reconcile,
      reconcileOutcome,
    )).toEqual({ valid: true });
  });

  it("normalizes invalid results and backend exceptions to unknown effects", async () => {
    const invalidBackend = backendHarness(() => ({
      kind: "observed",
      providerCommandRef: SANDBOX_REF,
      lifecycle: "running",
    }));
    const throwingBackend = backendHarness(() => {
      throw new TypeError("fake sandbox failure");
    });
    const foreignUnknownBackend = backendHarness((_operation, request) => ({
      kind: "unknown",
      providerKind: request.providerKind,
      durableResourceMarker: request.durableResourceMarker,
      reasonCode: "backend_timeout",
      providerCommandRef: "runpod:foreign",
    }));
    const command = claim("local_cpu", "provider_submit");

    await expect(createFoundryLocalCpuCommandAdapter(
      adapterOptions(invalidBackend),
    ).executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_result_unknown",
      providerLifecycle: "unknown",
    });
    await expect(createFoundryLocalCpuCommandAdapter(
      adapterOptions(throwingBackend),
    ).executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_exception_unknown",
      providerLifecycle: "unknown",
    });
    await expect(createFoundryLocalCpuCommandAdapter(
      adapterOptions(foreignUnknownBackend),
    ).executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "local_backend_result_unknown",
      providerLifecycle: "unknown",
      providerCommandRef: null,
    });
  });

  it("enforces claim, dispatch and abort gates before backend I/O", async () => {
    const backend = backendHarness(() => {
      throw new Error("backend must remain unreachable");
    });
    const adapter = createFoundryLocalCpuCommandAdapter(
      adapterOptions(backend),
    );
    const expiredClaim = claim("local_cpu", "provider_poll", {
      claimExpiresAt: "2026-07-13T10:00:15.000Z",
    });
    const expiredDispatch = claim("local_cpu", "provider_submit", {
      dispatchDeadline: "2026-07-13T10:00:15.000Z",
    });
    const aborted = new AbortController();
    aborted.abort();

    await expect(adapter.executeClaimedCommand(
      expiredClaim,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "failed",
      outcomeCode: "local_claim_expired",
      providerLifecycle: "not_observed",
    });
    await expect(adapter.executeClaimedCommand(
      expiredDispatch,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "failed",
      outcomeCode: "local_dispatch_deadline_expired",
      providerLifecycle: "not_observed",
    });
    await expect(adapter.executeClaimedCommand(
      claim("local_cpu", "provider_submit"),
      aborted.signal,
    )).resolves.toMatchObject({
      status: "failed",
      outcomeCode: "local_call_aborted_before_backend",
      providerLifecycle: "not_observed",
    });
    expect(totalBackendCalls(backend)).toBe(0);
  });
});
