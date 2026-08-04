import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FoundryClaimedProviderCommandV0Schema,
  computeFoundryProviderCommandPayloadSha256,
  computeFoundryProviderRequestSha256,
  type FoundryClaimedProviderCommandV0,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FOUNDRY_PROVIDER_REQUEST_PROFILE_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  computeFoundryProviderRequestProfileSha256,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
  type FoundryProviderCommandKindV0,
  type FoundryProviderRequestAuthorizationV0,
  type FoundryProviderRequestProfileV0,
} from "../../services/foundry-provider-request-authorization.js";
import {
  RUNPOD_PODS_REST_V1_ADAPTER_ID,
  RUNPOD_PODS_REST_V1_ADAPTER_VERSION,
  RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0,
  RUNPOD_PODS_REST_V1_BASE_URL,
  RUNPOD_PODS_REST_V1_LOWERING_PROFILE_V0,
  computeRunPodPodsRestV1AdapterConfigurationSha256,
  computeRunPodPodsRestV1LoweringProfileSha256,
  createRunPodPodsRestV1Adapter,
  runPodPodsRestV1DeterministicPodName,
  type RunPodPodsRestV1HttpClient,
  type RunPodPodsRestV1AdapterConfigurationV0,
  type RunPodPodsRestV1LoweringProfileV0,
} from "../../services/foundry-runpod-pods-rest-adapter.js";

const EXECUTION_ID = "00000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000003";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000004";
const STOP_INTENT_ID = "00000000-0000-4000-8000-000000000005";
const SUBMIT_COMMAND_ID = "00000000-0000-4000-8000-000000000011";
const RECONCILE_COMMAND_ID = "00000000-0000-4000-8000-000000000012";
const POLL_COMMAND_ID = "00000000-0000-4000-8000-000000000013";
const CHECKPOINT_COMMAND_ID = "00000000-0000-4000-8000-000000000014";
const STOP_COMMAND_ID = "00000000-0000-4000-8000-000000000015";
const SUBJECT_SHA256 = `sha256:${"a".repeat(64)}`;
const ENVELOPE_SHA256 = `sha256:${"b".repeat(64)}`;
const ARTIFACT_SHA256 = `sha256:${"c".repeat(64)}`;
const DEPLOYMENT_SHA256 = `sha256:${"d".repeat(64)}`;
const WORKER_SHA256 = `sha256:${"f".repeat(64)}`;
const OTHER_SHA256 = `sha256:${"1".repeat(64)}`;
const WORKER_IMAGE = `registry.example/omnitwin-worker@sha256:${"2".repeat(64)}`;
const POOL_ID = "runpod-pool-eu-secure";

function reviewedAdapterConfiguration(): RunPodPodsRestV1AdapterConfigurationV0 {
  return {
    schemaVersion: RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0,
    capacityClasses: [{
      capacityClass: "gpu-l40s",
      computeType: "GPU",
      cloudType: "SECURE",
      interruptible: false,
      dataCenterIds: ["EU-RO-1", "EU-SE-1"],
      gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S"],
      allowedCudaVersions: ["12.8", "12.9"],
    }],
  };
}

const ADAPTER_CONFIGURATION_SHA256 =
  computeRunPodPodsRestV1AdapterConfigurationSha256(
    reviewedAdapterConfiguration(),
  );

function reviewedProviderRequestProfile(): FoundryProviderRequestProfileV0 {
  return {
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_PROFILE_V0,
    profileId: "runpod-request-profile-001",
    profileVersion: "1.0.0",
    providerKind: "runpod",
    providerAdapterId: RUNPOD_PODS_REST_V1_ADAPTER_ID,
    providerAdapterVersion: RUNPOD_PODS_REST_V1_ADAPTER_VERSION,
    providerAdapterArtifactSha256: ARTIFACT_SHA256,
    providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    target: { targetKind: "remote_worker_pool", poolId: POOL_ID },
    allowedContainerImages: [WORKER_IMAGE],
    allowedNetworkAccess: ["object_storage_only"],
    allowedCapacityClasses: ["gpu-l40s"],
    allowedObjectStorageProfiles: ["object-store-readonly-001"],
    supportedCommandKinds: [
      "provider_poll",
      "provider_reconcile",
      "provider_stop",
      "provider_submit",
    ],
    maximumApiCallSeconds: 30,
    reviewedAt: "2026-07-13T09:00:00.000Z",
    expiresAt: "2026-08-13T09:00:00.000Z",
  };
}
const PROFILE_SHA256 = computeFoundryProviderRequestProfileSha256(
  reviewedProviderRequestProfile(),
);
const REQUIRED_LIVE_BINDING = {
  providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
  providerRequestProfileSha256: PROFILE_SHA256,
};
const POD_ID = "pod_001";
const POD_REF = `runpod:${POD_ID}`;
const IDEMPOTENCY_KEY = deriveFoundryProviderIdempotencyKey(
  SUBJECT_SHA256,
  ATTEMPT_ID,
);
const EXPECTED_NAME = runPodPodsRestV1DeterministicPodName(
  SUBJECT_SHA256,
  IDEMPOTENCY_KEY,
);

const COMMAND_IDS: Readonly<Record<FoundryProviderCommandKindV0, string>> = {
  provider_submit: SUBMIT_COMMAND_ID,
  provider_reconcile: RECONCILE_COMMAND_ID,
  provider_poll: POLL_COMMAND_ID,
  provider_checkpoint: CHECKPOINT_COMMAND_ID,
  provider_stop: STOP_COMMAND_ID,
};

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
        submitCommandId: SUBMIT_COMMAND_ID,
        submitProviderRequestAuthorizationSha256: submitAuthorizationSha256,
      };
    case "provider_poll":
    case "provider_checkpoint":
      return { kind: commandKind, providerCommandRef: providerCommandRef ?? POD_REF };
    case "provider_stop":
      return {
        kind: "provider_stop" as const,
        providerCommandRef: providerCommandRef ?? POD_REF,
        stopIntentId: STOP_INTENT_ID,
      };
  }
}

function authorization(
  commandKind: FoundryProviderCommandKindV0,
  options: {
    readonly providerCommandRef?: string | null;
    readonly providerRequestProfileId?: string;
    readonly providerRequestProfileSha256?: string;
    readonly providerAdapterConfigurationSha256?: string;
    readonly remoteWorkerPoolId?: string;
    readonly capacityClass?: string;
    readonly containerImage?: string;
    readonly extra?: Readonly<Record<string, unknown>>;
  } = {},
): FoundryProviderRequestAuthorizationV0 {
  const commandId = COMMAND_IDS[commandKind];
  const providerCommandRef = options.providerCommandRef ?? (
    commandKind === "provider_submit" || commandKind === "provider_reconcile"
      ? null
      : POD_REF
  );
  const submitAuthorizationSha256 = commandKind === "provider_submit"
    ? OTHER_SHA256
    : computeFoundryProviderRequestSha256(authorization("provider_submit"));
  return FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind,
    commandId,
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
      clientRequestId: deriveFoundryProviderClientRequestId(commandKind, commandId),
      resourceMarker: {
        executionSubjectSha256: SUBJECT_SHA256,
        providerIdempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    evidence: {
      jobSpecSha256: OTHER_SHA256,
      reviewedIngestManifestSha256: OTHER_SHA256,
      intakeAdmissionResultSha256: OTHER_SHA256,
      intakeStagingIndexSha256: OTHER_SHA256,
      executionEnvelopeSha256: ENVELOPE_SHA256,
      executionPolicySha256: OTHER_SHA256,
      providerPlanSha256: OTHER_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      workerProfileSha256s: [WORKER_SHA256],
      executionConfirmationSha256: OTHER_SHA256,
      computeApprovalSha256: OTHER_SHA256,
    },
    provider: {
      providerKind: "runpod",
      providerAdapterId: RUNPOD_PODS_REST_V1_ADAPTER_ID,
      providerAdapterVersion: RUNPOD_PODS_REST_V1_ADAPTER_VERSION,
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerAdapterConfigurationSha256:
        options.providerAdapterConfigurationSha256 ??
        ADAPTER_CONFIGURATION_SHA256,
      providerDeploymentId: "runpod-deployment-001",
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      accountProjectAlias: "omnitwin-production",
      region: "eu",
      dataResidency: "eu",
      providerRequestProfileId:
        options.providerRequestProfileId ?? "runpod-request-profile-001",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256:
        options.providerRequestProfileSha256 ?? PROFILE_SHA256,
      target: {
        targetKind: "remote_worker_pool",
        poolId: options.remoteWorkerPoolId ?? POOL_ID,
      },
    },
    rights: {
      rightsApprovalSha256: OTHER_SHA256,
      rightsPolicyEvidenceSha256: OTHER_SHA256,
      rightsPolicyDefinitionSha256: OTHER_SHA256,
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
      checkpointIntervalSeconds: null,
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
      workerProfileSha256: WORKER_SHA256,
      operationClass: "deterministic_transformation",
      containerImage: options.containerImage ?? WORKER_IMAGE,
      command: ["omnitwin-worker", "geometry"],
      networkAccess: "object_storage_only",
      inputAssetIds: ["asset-001"],
      outputNames: ["mesh"],
      rightsPurposes: ["commercial_internal_use"],
      checkpoint: "none",
      resumable: false,
      capacityClass: options.capacityClass ?? "gpu-l40s",
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
    action: actionFor(
      commandKind,
      providerCommandRef,
      submitAuthorizationSha256,
    ),
    ...options.extra,
  });
}

function claim(
  commandKind: FoundryProviderCommandKindV0,
  options: Parameters<typeof authorization>[1] = {},
): FoundryClaimedProviderCommandV0 {
  const providerRequest = authorization(commandKind, options);
  const providerRequestSha256 = computeFoundryProviderRequestSha256(
    providerRequest,
  );
  const submitAuthorization = authorization("provider_submit");
  const submitProviderRequestSha256 = computeFoundryProviderRequestSha256(
    submitAuthorization,
  );
  const providerCommandRef = providerRequest.action.providerCommandRef;
  const payload = {
    commandKind,
    executionSubjectSha256: SUBJECT_SHA256,
    providerRequest,
    providerRequestSha256,
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    stageIds: ["geometry"],
    maximumApiCallSeconds: 30,
    providerCommandRef,
    submitLineage: commandKind === "provider_reconcile"
      ? {
          submitCommandId: SUBMIT_COMMAND_ID,
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
    providerKind: "runpod",
    providerAdapterId: RUNPOD_PODS_REST_V1_ADAPTER_ID,
    providerAdapterVersion: RUNPOD_PODS_REST_V1_ADAPTER_VERSION,
    providerAdapterArtifactSha256: ARTIFACT_SHA256,
    providerAdapterConfigurationSha256:
      providerRequest.provider.providerAdapterConfigurationSha256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    providerRequestProfileId:
      providerRequest.provider.providerRequestProfileId,
    providerRequestProfileVersion:
      providerRequest.provider.providerRequestProfileVersion,
    providerRequestProfileSha256:
      providerRequest.provider.providerRequestProfileSha256,
    attemptOrdinal: 1,
    fencingToken: "7",
    commandSequence: commandKind === "provider_submit" ? 1 : 2,
    claimedBy: "executor-001",
    claimToken: CLAIM_TOKEN,
    claimedAt: "2026-07-13T10:00:00.000Z",
    claimExpiresAt: "2026-07-13T10:01:00.000Z",
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  });
}

function loweringProfile(): RunPodPodsRestV1LoweringProfileV0 {
  return {
    schemaVersion: RUNPOD_PODS_REST_V1_LOWERING_PROFILE_V0,
    providerRequestProfile: reviewedProviderRequestProfile(),
    providerRequestProfileSha256: PROFILE_SHA256,
    capacityClasses: reviewedAdapterConfiguration().capacityClasses,
  };
}

function podObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: POD_ID,
    name: EXPECTED_NAME,
    env: {
      OMNITWIN_EXECUTION_SUBJECT_SHA256: SUBJECT_SHA256,
      OMNITWIN_PROVIDER_IDEMPOTENCY_KEY: IDEMPOTENCY_KEY,
      OMNITWIN_CLIENT_REQUEST_ID: deriveFoundryProviderClientRequestId(
        "provider_submit",
        SUBMIT_COMMAND_ID,
      ),
      OMNITWIN_PROVIDER_REQUEST_PROFILE_SHA256: PROFILE_SHA256,
      OMNITWIN_REMOTE_WORKER_POOL_ID: POOL_ID,
    },
    desiredStatus: "RUNNING",
    ...overrides,
  };
}

function harness(
  response: { readonly status: number; readonly bodyText: string },
  profile: RunPodPodsRestV1LoweringProfileV0 = loweringProfile(),
) {
  const requestOnce = vi.fn<RunPodPodsRestV1HttpClient["requestOnce"]>(
    () => Promise.resolve(response),
  );
  const httpClient: RunPodPodsRestV1HttpClient = { requestOnce };
  const adapter = createRunPodPodsRestV1Adapter({
    providerAdapterArtifactSha256: ARTIFACT_SHA256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    loweringProfiles: [{
      profile,
      loweringProfileSha256:
        computeRunPodPodsRestV1LoweringProfileSha256(profile),
    }],
    requiredLiveLoweringProfileBindings: [REQUIRED_LIVE_BINDING],
    httpClient,
  });
  return { adapter, requestOnce };
}

describe("Foundry RunPod Pods REST v1 closed-contract adapter", () => {
  it("derives a stable bounded pod name from the exact attempt identity", () => {
    expect(EXPECTED_NAME).toMatch(/^omnitwin-[a-f0-9]{16}-[a-f0-9]{16}$/u);
    expect(runPodPodsRestV1DeterministicPodName(
      SUBJECT_SHA256,
      IDEMPOTENCY_KEY,
    )).toBe(EXPECTED_NAME);
    expect(runPodPodsRestV1DeterministicPodName(
      SUBJECT_SHA256,
      `${IDEMPOTENCY_KEY}-other`,
    )).not.toBe(EXPECTED_NAME);
  });

  it("deterministically lowers one closed submit authorization to one credential-free POST", async () => {
    const test = harness({
      status: 201,
      bodyText: JSON.stringify(podObservation()),
    });
    const command = claim("provider_submit");

    expect(test.adapter.validateClaimedCommand(command)).toEqual({ valid: true });
    const outcome = await test.adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      status: "succeeded",
      outcomeCode: "runpod_submit_accepted",
      providerLifecycle: "queued",
      providerCommandRef: POD_REF,
    });
    expect(test.requestOnce).toHaveBeenCalledTimes(1);
    const request = test.requestOnce.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      method: "POST",
      url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(request?.headers).not.toHaveProperty("Authorization");
    const body = JSON.parse(request?.bodyText ?? "null");
    expect(body).toMatchObject({
      name: EXPECTED_NAME,
      imageName: WORKER_IMAGE,
      cloudType: "SECURE",
      computeType: "GPU",
      containerDiskInGb: 80,
      volumeInGb: 0,
      gpuCount: 1,
      minRAMPerGPU: 16,
      minVCPUPerGPU: 4,
      dataCenterIds: ["EU-RO-1", "EU-SE-1"],
      gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S"],
      env: {
        OMNITWIN_EXECUTION_SUBJECT_SHA256: SUBJECT_SHA256,
        OMNITWIN_PROVIDER_IDEMPOTENCY_KEY: IDEMPOTENCY_KEY,
        OMNITWIN_CLIENT_REQUEST_ID: deriveFoundryProviderClientRequestId(
          "provider_submit",
          SUBMIT_COMMAND_ID,
        ),
        OMNITWIN_PROVIDER_REQUEST_PROFILE_SHA256: PROFILE_SHA256,
        OMNITWIN_REMOTE_WORKER_POOL_ID: POOL_ID,
      },
      dockerEntrypoint: [],
      dockerStartCmd: [],
      locked: false,
    });
    expect(body).not.toHaveProperty("networkVolumeId");
    expect(body).not.toHaveProperty("schemaVersion");
    expect(body).not.toHaveProperty("rights");
    expect(request?.bodyText).not.toContain("Bearer");
  });

  it("treats a submit response with a different client request marker as unknown", async () => {
    const test = harness({
      status: 201,
      bodyText: JSON.stringify(podObservation({
        env: {
          ...podObservation().env,
          OMNITWIN_CLIENT_REQUEST_ID: "foundry-submit-different-command",
        },
      })),
    });

    await expect(test.adapter.executeClaimedCommand(
      claim("provider_submit"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "runpod_submit_response_identity_unknown",
      providerCommandRef: POD_REF,
    });
    expect(test.requestOnce).toHaveBeenCalledTimes(1);
  });

  it("requires the cryptographic lowering digest and snapshots constructor input", async () => {
    const profile = loweringProfile();
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [{
        profile,
        loweringProfileSha256: OTHER_SHA256,
      }],
      requiredLiveLoweringProfileBindings: [REQUIRED_LIVE_BINDING],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow("digest mismatch");

    const test = harness({
      status: 201,
      bodyText: JSON.stringify(podObservation()),
    }, profile);
    profile.capacityClasses[0]!.dataCenterIds[0] = "US-KS-1";
    await test.adapter.executeClaimedCommand(
      claim("provider_submit"),
      new AbortController().signal,
    );
    const body = JSON.parse(test.requestOnce.mock.calls[0]?.[0].bodyText ?? "null");
    expect(body.dataCenterIds).toEqual(["EU-RO-1", "EU-SE-1"]);
  });

  it("binds exact selectors to the durable adapter configuration digest", () => {
    const expected = reviewedAdapterConfiguration();
    expect(
      computeRunPodPodsRestV1AdapterConfigurationSha256(expected),
    ).toBe(ADAPTER_CONFIGURATION_SHA256);
    expect(
      computeRunPodPodsRestV1AdapterConfigurationSha256({
        ...expected,
        capacityClasses: [{
          ...expected.capacityClasses[0]!,
          dataCenterIds: ["US-KS-1"],
        }],
      }),
    ).not.toBe(ADAPTER_CONFIGURATION_SHA256);

    const profile = loweringProfile();
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [{
        profile: {
          ...profile,
          capacityClasses: [{
            ...profile.capacityClasses[0]!,
            dataCenterIds: ["US-KS-1"],
          }],
        },
        loweringProfileSha256: OTHER_SHA256,
      }],
      requiredLiveLoweringProfileBindings: [REQUIRED_LIVE_BINDING],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow(/selectors do not match the durable adapter configuration/u);
  });

  it("requires every sorted unique live config/profile pair while retaining expired historical lowering", () => {
    const profile = loweringProfile();
    const registration = {
      profile,
      loweringProfileSha256:
        computeRunPodPodsRestV1LoweringProfileSha256(profile),
    };
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [registration],
      requiredLiveLoweringProfileBindings: [{
        providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
        providerRequestProfileSha256: OTHER_SHA256,
      }],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow(/Required live RunPod lowering-profile binding is unavailable/u);
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [registration],
      requiredLiveLoweringProfileBindings: [
        REQUIRED_LIVE_BINDING,
        REQUIRED_LIVE_BINDING,
      ],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow(/must be unique and sorted/u);

    const historicalRequestProfile = {
      ...reviewedProviderRequestProfile(),
      profileVersion: "0.9.0",
      reviewedAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-02-01T00:00:00.000Z",
    };
    const historicalProfile = {
      ...profile,
      providerRequestProfile: historicalRequestProfile,
      providerRequestProfileSha256:
        computeFoundryProviderRequestProfileSha256(
          historicalRequestProfile,
        ),
    };
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [{
        profile: historicalProfile,
        loweringProfileSha256:
          computeRunPodPodsRestV1LoweringProfileSha256(historicalProfile),
      }],
      requiredLiveLoweringProfileBindings: [{
        providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
        providerRequestProfileSha256:
          historicalProfile.providerRequestProfileSha256,
      }],
      httpClient: { requestOnce: vi.fn() },
    })).not.toThrow();
  });

  it("rejects checkpoint-capable and wrong-adapter lowering registrations", () => {
    const base = loweringProfile();
    const checkpointRequestProfile = {
      ...base.providerRequestProfile,
      supportedCommandKinds: [
        "provider_checkpoint",
        "provider_poll",
        "provider_reconcile",
        "provider_stop",
        "provider_submit",
      ],
    };
    const checkpointProfile = {
      ...base,
      providerRequestProfile: checkpointRequestProfile,
      providerRequestProfileSha256:
        computeFoundryProviderRequestProfileSha256(checkpointRequestProfile),
    };
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [{
        profile: checkpointProfile,
        loweringProfileSha256: OTHER_SHA256,
      }],
      requiredLiveLoweringProfileBindings: [REQUIRED_LIVE_BINDING],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow(/does not support provider checkpoints/u);

    const wrongAdapterRequestProfile = {
      ...base.providerRequestProfile,
      providerAdapterId: "different-runpod-adapter",
    };
    const wrongAdapterProfile = {
      ...base,
      providerRequestProfile: wrongAdapterRequestProfile,
      providerRequestProfileSha256:
        computeFoundryProviderRequestProfileSha256(
          wrongAdapterRequestProfile,
        ),
    };
    expect(() => createRunPodPodsRestV1Adapter({
      providerAdapterArtifactSha256: ARTIFACT_SHA256,
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      loweringProfiles: [{
        profile: wrongAdapterProfile,
        loweringProfileSha256: OTHER_SHA256,
      }],
      requiredLiveLoweringProfileBindings: [REQUIRED_LIVE_BINDING],
      httpClient: { requestOnce: vi.fn() },
    })).toThrow(/requires this exact RunPod adapter/u);
  });

  it("rejects unavailable, identity-drifted, and unsupported capacity profiles before I/O", async () => {
    const test = harness({ status: 201, bodyText: "{}" });
    const commands = [
      claim("provider_submit", {
        providerRequestProfileSha256: `sha256:${"3".repeat(64)}`,
      }),
      claim("provider_submit", {
        providerAdapterConfigurationSha256: OTHER_SHA256,
      }),
      claim("provider_submit", { remoteWorkerPoolId: "attacker-pool" }),
      claim("provider_submit", { providerRequestProfileId: "drifted-profile" }),
      claim("provider_submit", { capacityClass: "gpu-unreviewed" }),
    ];
    expect(test.adapter.validateClaimedCommand(commands[0]!)).toEqual({
      valid: false,
      reasonCode: "runpod_lowering_profile_unavailable",
    });
    expect(test.adapter.validateClaimedCommand(commands[1]!)).toEqual({
      valid: false,
      reasonCode: "runpod_lowering_profile_unavailable",
    });
    expect(test.adapter.validateClaimedCommand(commands[2]!)).toEqual({
      valid: false,
      reasonCode: "runpod_lowering_profile_binding_mismatch",
    });
    expect(test.adapter.validateClaimedCommand(commands[3]!)).toEqual({
      valid: false,
      reasonCode: "runpod_lowering_profile_binding_mismatch",
    });
    expect(test.adapter.validateClaimedCommand(commands[4]!)).toEqual({
      valid: false,
      reasonCode: "runpod_authorization_outside_profile",
    });
    for (const command of commands) {
      await expect(test.adapter.executeClaimedCommand(
        command,
        new AbortController().signal,
      )).resolves.toMatchObject({ status: "failed" });
    }
    expect(test.requestOnce).not.toHaveBeenCalled();
  });

  it("rejects smuggled durable provider JSON, credentials, and stop-intent drift before I/O", async () => {
    const test = harness({ status: 201, bodyText: "{}" });
    const current = claim("provider_submit");
    const withOpenPod = {
      ...current,
      payload: {
        ...current.payload,
        providerRequest: {
          ...current.payload.providerRequest,
          pod: { imageName: "attacker/image:latest" },
        },
      },
    } as FoundryClaimedProviderCommandV0;
    const withCredential = {
      ...current,
      payload: {
        ...current.payload,
        providerRequest: {
          ...current.payload.providerRequest,
          authorization: "Bearer must-not-be-durable",
        },
      },
    } as FoundryClaimedProviderCommandV0;
    const stop = claim("provider_stop");
    const withStopDrift = {
      ...stop,
      payload: {
        ...stop.payload,
        stopIntentId: "00000000-0000-4000-8000-000000000099",
      },
    } as FoundryClaimedProviderCommandV0;

    for (const command of [withOpenPod, withCredential, withStopDrift]) {
      expect(test.adapter.validateClaimedCommand(command)).toEqual({
        valid: false,
        reasonCode: "runpod_claim_schema_rejected",
      });
      await expect(test.adapter.executeClaimedCommand(
        command,
        new AbortController().signal,
      )).resolves.toMatchObject({ status: "failed" });
    }
    expect(test.requestOnce).not.toHaveBeenCalled();
  });

  it("reconciles with one GET and honors an exact target reference", async () => {
    const test = harness({
      status: 200,
      bodyText: JSON.stringify([
        podObservation({ id: "pod_other" }),
        podObservation(),
      ]),
    });
    const outcome = await test.adapter.executeClaimedCommand(
      claim("provider_reconcile", { providerCommandRef: POD_REF }),
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({
      status: "succeeded",
      providerCommandRef: POD_REF,
      providerLifecycle: "queued",
    });
    expect(test.requestOnce).toHaveBeenCalledTimes(1);
    expect(test.requestOnce.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods`,
      bodyText: null,
    });
  });

  it("rejects a non-RunPod action reference and never follows it", async () => {
    const test = harness({ status: 200, bodyText: "[]" });
    const command = claim("provider_reconcile", {
      providerCommandRef:
        "https://bucket.example/job?X-Amz-Signature=must-not-be-durable",
    });
    expect(test.adapter.validateClaimedCommand(command)).toEqual({
      valid: false,
      reasonCode: "runpod_action_binding_mismatch",
    });
    await expect(test.adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({ status: "failed" });
    expect(test.requestOnce).not.toHaveBeenCalled();
  });

  it("polls and terminates only the exact provider reference", async () => {
    const poll = harness({
      status: 200,
      bodyText: JSON.stringify(podObservation()),
    });
    await expect(poll.adapter.executeClaimedCommand(
      claim("provider_poll"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "succeeded",
      providerCommandRef: POD_REF,
      providerLifecycle: "queued",
    });
    expect(poll.requestOnce.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods/${POD_ID}`,
    });

    const stop = harness({ status: 204, bodyText: "" });
    await expect(stop.adapter.executeClaimedCommand(
      claim("provider_stop"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "succeeded",
      outcomeCode: "runpod_terminate_accepted",
      providerCommandRef: POD_REF,
      providerLifecycle: "terminated",
    });
    expect(stop.requestOnce.mock.calls[0]?.[0]).toMatchObject({
      method: "DELETE",
      url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods/${POD_ID}`,
      bodyText: null,
    });
  });

  it("rejects unsupported checkpoints before provider invocation", async () => {
    const test = harness({ status: 200, bodyText: "{}" });
    const command = claim("provider_checkpoint");
    expect(test.adapter.validateClaimedCommand(command)).toEqual({
      valid: false,
      reasonCode: "runpod_checkpoint_unsupported",
    });
    await expect(test.adapter.executeClaimedCommand(
      command,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "failed",
      outcomeCode: "runpod_checkpoint_unsupported",
      providerLifecycle: "not_observed",
    });
    expect(test.requestOnce).not.toHaveBeenCalled();
  });

  it("keeps network ambiguity uncertain and performs no retry", async () => {
    const test = harness({ status: 201, bodyText: "{}" });
    test.requestOnce.mockRejectedValueOnce(new TypeError("socket reset"));
    await expect(test.adapter.executeClaimedCommand(
      claim("provider_submit"),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "uncertain",
      outcomeCode: "runpod_http_network_unknown",
      providerLifecycle: "unknown",
    });
    expect(test.requestOnce).toHaveBeenCalledTimes(1);
  });
});
