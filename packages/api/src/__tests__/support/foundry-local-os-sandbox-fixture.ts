import {
  computeFoundryProviderRequestSha256,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  deriveFoundryProviderIdempotencyKey,
} from "../../services/foundry-provider-request-authorization.js";
import {
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
  FOUNDRY_LOCAL_SANDBOX_EXECUTION_REQUEST_V0,
  FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0,
  FoundryLocalSandboxExecutionRequestV0Schema,
  computeFoundryLocalSandboxAdapterConfigurationSha256,
  computeFoundryLocalSandboxResourceMarkerSha256,
  type FoundryLocalSandboxExecutionRequestV0,
} from "../../services/foundry-local-command-adapter.js";
import {
  FOUNDRY_LOCAL_OS_SANDBOX_POLICY_V0,
  FoundryLocalOsSandboxPolicyV0Schema,
  computeFoundryLocalOsSandboxPolicySha256,
} from "../../services/foundry-local-os-sandbox-policy.js";

export const LOCAL_SANDBOX_FIXTURE_IMAGE =
  "postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
export const LOCAL_SANDBOX_FIXTURE_SOURCE = Buffer.from(
  "OmniTwin local OS sandbox fixture\n",
  "utf8",
);
export const LOCAL_SANDBOX_FIXTURE_SOURCE_SHA256 =
  "sha256:2e0c6c4981f15b98e5c46842db78936108441ad38742b7cc2b35539155fa93bd";

const EXECUTION_ID = "00000000-0000-4000-8000-000000001001";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000001002";
const COMMAND_ID = "00000000-0000-4000-8000-000000001003";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000001004";
const RESERVATION_ID = "00000000-0000-4000-8000-000000001005";
const SUBJECT_SHA256 = `sha256:${"a".repeat(64)}`;
const EVIDENCE_SHA256 = `sha256:${"b".repeat(64)}`;
const STAGING_SHA256 = `sha256:${"c".repeat(64)}`;
const WORKER_SHA256 = `sha256:${"d".repeat(64)}`;
const DEPLOYMENT_SHA256 = `sha256:${"e".repeat(64)}`;
const POLICY_ARTIFACT_SHA256 = `sha256:${"f".repeat(64)}`;
const IDEMPOTENCY_KEY = deriveFoundryProviderIdempotencyKey(
  SUBJECT_SHA256,
  ATTEMPT_ID,
);

export function createLocalOsSandboxFixtureRequest(
  overrides: {
    readonly stage?: Record<string, unknown>;
    readonly providerKind?: "local_cpu" | "local_cuda";
    readonly authorization?: Record<string, unknown>;
    readonly terminalEnforcement?: {
      readonly mode: "required";
      readonly policySha256: string;
      readonly securityProfileSha256: string;
    };
  } = {},
) {
  const providerKind = overrides.providerKind ?? "local_cpu";
  const defaultPolicy = createLocalOsSandboxFixturePolicy();
  const terminalEnforcement = overrides.terminalEnforcement ?? {
    mode: "required" as const,
    policySha256: defaultPolicy.policySha256,
    securityProfileSha256: defaultPolicy.securityProfileSha256,
  };
  const baseStage = {
    stageId: "normalize_mesh",
    stageKind: "geometry",
    dependsOn: [],
    workerProfileId: "normalize-mesh-worker",
    workerProfileVersion: "1.0.0",
    workerProfileSha256: WORKER_SHA256,
    operationClass: "deterministic_transformation",
    containerImage: LOCAL_SANDBOX_FIXTURE_IMAGE,
    command: [
      "/bin/bash",
      "-cu",
      [
        "test ! -e /output/extra || exit 80",
        "test ! -r /var/lib/postgresql/data || exit 81",
        "test ! -w /var/lib/postgresql/data || exit 82",
        "test ! -x /var/lib/postgresql/data || exit 83",
        "if printf '' > /output/extra 2>/dev/null; then exit 90; fi",
        "if printf '' > /input/forbidden 2>/dev/null; then exit 91; fi",
        "IFS= read -r payload < /input/source.glb || exit 92",
        "printf '%s\\n' \"$payload\" > /output/normalized.glb || exit 93",
        "exec /bin/sleep 3",
      ].join("; "),
    ],
    networkAccess: "none",
    inputAssetIds: ["mesh-source"],
    outputNames: ["normalized-mesh-glb"],
    rightsPurposes: ["commercial_internal_use"],
    checkpoint: "none",
    resumable: false,
    capacityClass: "local-cpu",
    requestedResources: {
      cpuCores: 1,
      ramGiB: 1,
      gpuCount: 0,
      minimumGpuVramGiB: 0,
      scratchGiB: 1,
    },
    authorizedCapacity: {
      cpuCores: 1,
      ramGiB: 1,
      gpuCount: 0,
      perGpuVramGiB: 0,
      scratchGiB: 1,
    },
    estimatedCostMicroUsd: "0",
    maximumRuntimeSeconds: 8,
    ...overrides.stage,
  };
  const authorization = FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind: "provider_submit",
    commandId: COMMAND_ID,
    commandSequence: 1,
    preparedAt: "2026-07-15T09:59:00.000Z",
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
      clientRequestId: "local-sandbox-fixture-submit",
      resourceMarker: {
        executionSubjectSha256: SUBJECT_SHA256,
        providerIdempotencyKey: IDEMPOTENCY_KEY,
      },
    },
    evidence: {
      jobSpecSha256: EVIDENCE_SHA256,
      reviewedIngestManifestSha256: EVIDENCE_SHA256,
      intakeAdmissionResultSha256: EVIDENCE_SHA256,
      intakeStagingIndexSha256: STAGING_SHA256,
      executionEnvelopeSha256: EVIDENCE_SHA256,
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
      providerAdapterArtifactSha256: POLICY_ARTIFACT_SHA256,
      providerAdapterConfigurationSha256:
        computeFoundryLocalSandboxAdapterConfigurationSha256({
          schemaVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
          runnerProfileId: "local-os-sandbox-runner",
          terminalEnforcement,
        }),
      providerDeploymentId: "local-deployment-001",
      providerDeploymentSha256: DEPLOYMENT_SHA256,
      accountProjectAlias: "omnitwin-local",
      region: "local",
      dataResidency: "local",
      providerRequestProfileId: "local-profile-001",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: EVIDENCE_SHA256,
      target: {
        targetKind: "local_worker",
        runnerProfileId: "local-os-sandbox-runner",
      },
    },
    rights: {
      rightsApprovalSha256: EVIDENCE_SHA256,
      rightsPolicyEvidenceSha256: EVIDENCE_SHA256,
      rightsPolicyDefinitionSha256: EVIDENCE_SHA256,
      policyVersion: "rights-v1",
      policyGeneration: 1,
      decision: "allowed",
      stagePurposes: [{
        stageId: "normalize_mesh",
        purposes: ["commercial_internal_use"],
      }],
    },
    storage: {
      sourceMountMode: "read_only",
      objectStorageProfile: null,
      outputPrefix: "foundry/project-001/job-001",
    },
    runtime: {
      maximumApiCallSeconds: 10,
      maximumWallClockSeconds: 10,
      workerSelfDeadlineSeconds: 8,
      providerMaximumExecutionTtlSeconds: 10,
      dispatchDeadline: "2026-07-15T11:00:00.000Z",
      observationIntervalSeconds: 1,
      checkpointIntervalSeconds: null,
      cancelGracePeriodSeconds: 1,
      terminationGracePeriodSeconds: 2,
      terminationConfirmationTimeoutSeconds: 3,
      budgetPolicy: {
        currency: "USD",
        costWarningMicroUsd: "0",
        costHardStopMicroUsd: "0",
        terminationReserveMicroUsd: "0",
        absoluteCostCapMicroUsd: "0",
        costObservationMaximumAgeSeconds: 1,
      },
      checkpointContract: null,
    },
    stages: [baseStage],
    action: { kind: "provider_submit", providerCommandRef: null },
    ...overrides.authorization,
  });
  const markerContent = {
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0,
    providerKind,
    executionSubjectSha256: SUBJECT_SHA256,
    providerIdempotencyKey: IDEMPOTENCY_KEY,
  } as const;
  const durableResourceMarker = {
    ...markerContent,
    markerSha256: computeFoundryLocalSandboxResourceMarkerSha256(markerContent),
  };
  return FoundryLocalSandboxExecutionRequestV0Schema.parse({
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_EXECUTION_REQUEST_V0,
    providerKind,
    command: {
      commandKind: "provider_submit",
      commandId: COMMAND_ID,
      commandSequence: 1,
      claimToken: CLAIM_TOKEN,
      fencingToken: "7",
      providerCommandRef: null,
      action: authorization.action,
    },
    authorizationSha256: computeFoundryProviderRequestSha256(authorization),
    authorization,
    durableResourceMarker,
    sandbox: {
      runnerProfileId: "local-os-sandbox-runner",
      imagePolicy: "pinned_digest_only",
      terminalEnforcement,
      stagedInputs: {
        mountMode: "read_only",
        intakeStagingIndexSha256: STAGING_SHA256,
        reviewedIngestManifestSha256: EVIDENCE_SHA256,
        assetIds: baseStage.inputAssetIds,
      },
      output: {
        writeMode: "isolated_exact_attempt_prefix",
        authorizedPrefix: "foundry/project-001/job-001",
        isolatedPrefix:
          `foundry/project-001/job-001/.foundry-sandbox/${durableResourceMarker.markerSha256.slice(7)}`,
      },
      stageDag: [baseStage],
      networkPolicy: {
        enforcement: "per_stage_exact",
        stages: [{
          stageId: "normalize_mesh",
          networkAccess: baseStage.networkAccess,
        }],
      },
      resourcePolicy: {
        enforcement: "hard_limits",
        stages: [{
          stageId: "normalize_mesh",
          requested: baseStage.requestedResources,
          limit: baseStage.authorizedCapacity,
        }],
      },
      deadlines: {
        ...authorization.runtime,
        claimExpiresAt: "2026-07-15T10:30:00.000Z",
      },
    },
  });
}

export function createLocalOsSandboxFixtureCommandRequest(
  commandKind:
    | "provider_submit"
    | "provider_reconcile"
    | "provider_poll"
    | "provider_checkpoint"
    | "provider_stop",
  providerCommandRef?: string,
  submitRequest?: FoundryLocalSandboxExecutionRequestV0,
) {
  const submit = submitRequest ?? createLocalOsSandboxFixtureRequest();
  if (commandKind === "provider_submit") return submit;
  const commandIdByKind = {
    provider_submit: COMMAND_ID,
    provider_reconcile: "00000000-0000-4000-8000-000000001013",
    provider_poll: "00000000-0000-4000-8000-000000001014",
    provider_checkpoint: "00000000-0000-4000-8000-000000001015",
    provider_stop: "00000000-0000-4000-8000-000000001016",
  } as const;
  const claimTokenByKind = {
    provider_submit: CLAIM_TOKEN,
    provider_reconcile: "00000000-0000-4000-8000-000000001023",
    provider_poll: "00000000-0000-4000-8000-000000001024",
    provider_checkpoint: "00000000-0000-4000-8000-000000001025",
    provider_stop: "00000000-0000-4000-8000-000000001026",
  } as const;
  const reference = providerCommandRef ??
    `local-sandbox:${submit.durableResourceMarker.markerSha256.slice(7, 31)}`;
  const action = commandKind === "provider_reconcile"
    ? {
        kind: commandKind,
        providerCommandRef: null,
        submitCommandId: COMMAND_ID,
        submitProviderRequestAuthorizationSha256:
          computeFoundryProviderRequestSha256(submit.authorization),
      }
    : commandKind === "provider_stop"
      ? {
          kind: commandKind,
          providerCommandRef: reference,
          stopIntentId: "00000000-0000-4000-8000-000000001017",
        }
      : { kind: commandKind, providerCommandRef: reference };
  const authorization = FoundryProviderRequestAuthorizationV0Schema.parse({
    ...submit.authorization,
    commandKind,
    commandId: commandIdByKind[commandKind],
    commandSequence: 2,
    requestIdentity: {
      ...submit.authorization.requestIdentity,
      clientRequestId: `local-sandbox-fixture-${commandKind.slice(9)}`,
    },
    action,
  });
  return FoundryLocalSandboxExecutionRequestV0Schema.parse({
    ...submit,
    command: {
      commandKind,
      commandId: commandIdByKind[commandKind],
      commandSequence: 2,
      claimToken: claimTokenByKind[commandKind],
      fencingToken: "7",
      providerCommandRef:
        commandKind === "provider_reconcile" ? null : reference,
      action,
    },
    authorization,
    authorizationSha256: computeFoundryProviderRequestSha256(authorization),
    sandbox: {
      ...submit.sandbox,
      deadlines: {
        ...authorization.runtime,
        claimExpiresAt: "2026-07-15T10:30:00.000Z",
      },
    },
  });
}

export function createLocalOsSandboxFixturePolicy(
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    schemaVersion: FOUNDRY_LOCAL_OS_SANDBOX_POLICY_V0,
    policyId: "docker-desktop-linux-proof",
    policyVersion: "0.1.0",
    runnerArtifactSha256: POLICY_ARTIFACT_SHA256,
    runnerConfigurationSha256: EVIDENCE_SHA256,
    securityProfileSha256: `sha256:${"1".repeat(64)}`,
    providerKind: "local_cpu",
    workerRole: "normalize_mesh",
    stageKind: "geometry",
    operationClass: "deterministic_transformation",
    expectedOutputName: "normalized-mesh-glb",
    persistentOutputFileName: "normalized.glb",
    containerPlatform: "linux/amd64",
    containerRuntime: "runc",
    imagePullPolicy: "never",
    rootFilesystem: "read_only",
    inputMount: "engine_volume_read_only",
    outputMount: "engine_volume_pre_reserved_single_file",
    networkMode: "none",
    socketSyscalls: "denied_by_pinned_seccomp",
    inheritedEnvironment: "cleared",
    stdin: "closed",
    tty: "disabled",
    logDriver: "none",
    stdioEnforcement: "persistence_disabled_emission_unmetered",
    healthcheck: "disabled",
    restartPolicy: "no",
    terminationSignal: "SIGTERM",
    userId: 65_534,
    groupId: 65_534,
    capabilities: ["ALL"],
    noNewPrivileges: true,
    ipcMode: "none",
    pidNamespace: "private_default",
    cgroupNamespace: "private",
    imageDeclaredVolumes: "rejected_or_shadowed_inaccessible",
    wallClockEnforcement: "reconcile_poll_only_not_continuous",
    processTreeEvidence: "docker_stopped_init_pid_only",
    nativeWindowsCustody: "not_proved",
    linuxSecurityModule: "not_proved",
    semanticNormalization: "not_proved_by_transport_fixture",
    hardLimits: {
      maximumCpuCores: 1,
      maximumMemoryBytes: 1_073_741_824,
      memorySwapMode: "disabled_equal_to_memory",
      maximumPids: 16,
      maximumPerProcessOpenFiles: 64,
      maximumFileBytes: 67_108_864,
      maximumPersistedStdoutBytes: 0,
      maximumPersistedStderrBytes: 0,
      maximumPerProcessCpuSeconds: 5,
      maximumObservedWallClockSeconds: 10,
      terminationGraceSeconds: 2,
      sharedMemoryBytes: 65_536,
    },
    proofScope: "docker_desktop_linux_transport_only",
    productionWiring: "not_authorized",
    ...overrides,
  };
  return FoundryLocalOsSandboxPolicyV0Schema.parse({
    ...payload,
    policySha256: computeFoundryLocalOsSandboxPolicySha256(payload),
  });
}

export const LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING = {
  assetId: "mesh-source",
  sourceRawSha256: LOCAL_SANDBOX_FIXTURE_SOURCE_SHA256,
  sourceByteLength: LOCAL_SANDBOX_FIXTURE_SOURCE.byteLength,
  sourceVersion: "fixture-v1",
} as const;

export const LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION = {
  reservationId: RESERVATION_ID,
  reservationSha256: EVIDENCE_SHA256,
  outputSlot: "normalized_mesh_glb",
  maximumOutputBytes: 67_108_864,
} as const;
