import { createHash } from "node:crypto";
import {
  FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
  FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
  FOUNDRY_EXECUTION_ENVELOPE_V0,
  FOUNDRY_EXECUTION_POLICY_V0,
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
  FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
  FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryRightsApprovalSchema,
  FoundryRightsPolicyDefinitionV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryExecutionEnvelopeComputeApprovalSha256,
  computeFoundryExecutionEnvelopeConfirmationSha256,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
} from "@omnitwin/types";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  computeFoundryExecutionSubjectSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type FoundryExecutionSubjectV0,
} from "@omnitwin/reconstruction-foundry";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_PROVIDER_REQUEST_PROFILE_V0,
  FoundryProviderRequestAuthorizationError,
  FoundryProviderRequestAuthorizationV0Schema,
  FoundryProviderRequestProfileV0Schema,
  compileFoundryProviderRequestAuthorization,
  computeFoundryProviderRequestAuthorizationSha256,
  computeFoundryProviderRequestProfileSha256,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
  validateFoundryProviderRequestAuthorization,
  type FoundryProviderCommandKindV0,
  type FoundryProviderRequestAuthorizationCompilerInput,
} from "../../services/foundry-provider-request-authorization.js";

const INTAKE_ADMISSION_SHA256 = `sha256:${"a".repeat(64)}`;
const INTAKE_STAGING_SHA256 = `sha256:${"b".repeat(64)}`;
const PRICING_SHA256 = `sha256:${"c".repeat(64)}`;
const POLICY_DEFINITION_SHA256 = `sha256:${"d".repeat(64)}`;
const ADAPTER_ARTIFACT_SHA256 = `sha256:${"e".repeat(64)}`;
const ADAPTER_CONFIGURATION_SHA256 = `sha256:${"9".repeat(64)}`;
const IMAGE = `ghcr.io/omnitwin/geometry@sha256:${"1".repeat(64)}`;
const EXECUTION_ID = "00000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000002";
const SUBMIT_COMMAND_ID = "00000000-0000-4000-8000-000000000003";
const STOP_INTENT_ID = "00000000-0000-4000-8000-000000000008";

function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

function fixture(stageIds: readonly string[] = ["geometry"]) {
  const manifest = FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "project-001",
    createdAt: "2026-07-13T09:58:00.000Z",
    createdBy: "operator@example.test",
    sourceRoots: [
      {
        id: "source-root",
        kind: "local_directory",
        displayName: "Read-only source",
        locationRedacted: "FOUNDRY_SOURCE_ROOT",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [
      {
        id: "venue-control",
        kind: "venue_control",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "measured",
        provenanceAssetIds: ["source-001"],
        crs: null,
      },
    ],
    transforms: [],
    assets: [
      {
        id: "source-001",
        sourceRootId: "source-root",
        relativePath: "source.e57",
        inputType: "matterport_e57",
        mediaType: "model/e57",
        sizeBytes: 1_000,
        sha256: `sha256:${"f".repeat(64)}`,
        immutable: true,
        captureState: "official_export",
        accessState: "official_export",
        capturedAt: null,
        coordinateFrameId: "venue-control",
        calibrationAssetIds: [],
        parentAssetIds: [],
        rights: {
          basis: "customer_owned",
          commercialUse: "allowed",
          modelTrainingUse: "allowed",
          redistribution: "allowed",
          termsReviewedAt: "2026-07-13T09:58:00.000Z",
          termsReference: "https://rights.example/project-001",
          restrictions: [],
        },
        provenanceClass: "captured",
        evidenceKinds: [],
        inspection: {
          geometryValue: "high",
          appearanceValue: "medium",
          calibrationValue: "medium",
          scaleValue: "high",
          metadataKeys: ["data3D"],
          decisiveNextTest: "Verify poses and image links.",
        },
        notes: [],
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved",
    sourceMutationPermitted: false,
  });
  const manifestSha256 = computeFoundryIngestManifestSha256(manifest);
  const job = FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "job-001",
    projectId: "project-001",
    ingestManifestSha256: manifestSha256,
    executionIntent: "execute",
    providerKind: "runpod",
    providerAdapterId: "runpod-pods-rest-v1",
    stages: stageIds.map((stageId, index) =>
      ({
        id: stageId,
        kind: "geometry",
        dependsOn: [],
        containerImage: IMAGE,
        command: ["foundry-geometry", "--input", "/input"],
        inputAssetIds: ["source-001"],
        outputNames: [stageIds.length === 1 ? "geometry" : `output-${String(index)}`],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 1,
        minimumGpuVramGiB: 20,
        scratchGiB: 100,
        networkAccess: "object_storage_only",
        checkpoint: "stage_boundary",
        resumable: true,
      })
    ),
    objectStorageProfile: "foundry-private",
    sourceMountMode: "read_only",
    outputPrefix: "foundry/job-001",
    estimatedCostUsd: 1,
    budgetCapUsd: 3.5,
    killSwitchEnabled: true,
    computeApprovalId: "approval-001",
    createdAt: "2026-07-13T09:59:00.000Z",
  });
  const jobSpecSha256 = computeFoundryJobSpecSha256(job);
  const policy = FoundryExecutionPolicyV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_POLICY_V0,
    policyId: "foundry-execution-default-v0",
    maximumAttempts: 1,
    deterministicRetryDelaySeconds: [],
    maximumWallClockSeconds: 3_600,
    orchestrationOverheadSeconds: 60,
    workerSelfDeadlineSeconds: 3_900,
    providerMaximumExecutionTtlSeconds: 4_200,
    dispatchWindowTtlSeconds: 1_800,
    leaseTtlSeconds: 120,
    heartbeatIntervalSeconds: 30,
    observationIntervalSeconds: 20,
    checkpointIntervalSeconds: 300,
    cancelGracePeriodSeconds: 60,
    terminationGracePeriodSeconds: 120,
    terminationConfirmationTimeoutSeconds: 120,
    pricingSnapshotMaximumAgeSeconds: 600,
    costObservationMaximumAgeSeconds: 60,
    executionConfirmationTtlSeconds: 600,
    computeApprovalTtlSeconds: 600,
    costWarningMicroUsd: "2000000",
    costHardStopMicroUsd: "3000000",
    terminationReserveMicroUsd: "500000",
    absoluteCostCapMicroUsd: "3500000",
  });
  const workerProfile = FoundryTrustedWorkerProfileV0Schema.parse({
    schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
    profileId: "geometry-worker",
    profileVersion: "v1",
    operationClass: "deterministic_transformation",
    containerImage: IMAGE,
    command: job.stages[0]?.command,
    networkAccess: "object_storage_only",
    localExecutionAllowed: true,
    reviewedBy: "security@example.test",
    reviewedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
  });
  const workerProfileSha256 = computeFoundryTrustedWorkerProfileSha256(
    workerProfile,
  );
  const deployment = FoundryProviderDeploymentEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
    deploymentId: "deployment-001",
    providerKind: "runpod",
    providerAdapterId: "runpod-pods-rest-v1",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    accountProjectAlias: "foundry-private",
    region: "eu-west-1",
    dataResidency: "gb",
    observedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
    capacityClasses: [
      {
        id: "gpu-l40s-48gb",
        cpuCores: 16,
        ramGiB: 64,
        gpuCount: 1,
        perGpuVramGiB: 48,
        scratchGiB: 500,
      },
    ],
  });
  const deploymentSha256 =
    computeFoundryProviderDeploymentEvidenceSha256(deployment);
  const plan = FoundryProviderPlanEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
    executionIntent: "execute",
    authority: "none",
    planId: "plan-001",
    jobId: job.id,
    jobSpecSha256,
    reviewedIngestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    providerKind: "runpod",
    providerAdapterId: "runpod-pods-rest-v1",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingBasis: "metered_estimate",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotObservedAt: "2026-07-13T10:00:00.000Z",
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    plannedAt: "2026-07-13T10:01:00.000Z",
    estimatedCostMicroUsd: "1000000",
    stages: stageIds.map((stageId, index) => {
      const baseCost = Math.floor(1_000_000 / stageIds.length);
      const estimatedCostMicroUsd = index === stageIds.length - 1
        ? 1_000_000 - baseCost * (stageIds.length - 1)
        : baseCost;
      return {
        stageId,
        capacityClass: "gpu-l40s-48gb",
        workerProfileSha256,
        estimatedCostMicroUsd: String(estimatedCostMicroUsd),
        maximumRuntimeSeconds: 1_800,
      };
    }),
  });
  const providerPlanSha256 = computeFoundryProviderPlanEvidenceSha256(plan);
  const envelope = FoundryExecutionEnvelopeV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_V0,
    executionIntent: "execute",
    authority: "none",
    envelopeId: "envelope-001",
    jobId: job.id,
    projectId: job.projectId,
    jobSpecSha256,
    providerPlanSha256,
    reviewedIngestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(policy),
    computeApprovalId: "approval-001",
    providerKind: "runpod",
    providerAdapterId: "runpod-pods-rest-v1",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    createdAt: "2026-07-13T10:02:00.000Z",
    dispatchDeadline: "2026-07-13T10:20:00.000Z",
  });
  const envelopeSha256 = computeFoundryExecutionEnvelopeSha256(envelope);
  const confirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
    confirmationId: "confirmation-001",
    executionEnvelopeSha256: envelopeSha256,
    jobSpecSha256,
    jobId: job.id,
    confirmedBy: "operator@example.test",
    confirmedAt: "2026-07-13T10:03:00.000Z",
    expiresAt: "2026-07-13T10:10:00.000Z",
  });
  const computeApproval =
    FoundryExecutionEnvelopeComputeApprovalV0Schema.parse({
      schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
      approvalId: "approval-001",
      executionEnvelopeSha256: envelopeSha256,
      jobSpecSha256,
      jobId: job.id,
      projectId: job.projectId,
      providerKind: "runpod",
      providerAdapterId: "runpod-pods-rest-v1",
      providerAdapterVersion: "1.0.0",
      providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
      providerDeploymentSha256: deploymentSha256,
      maximumCostMicroUsd: "3500000",
      approvedBy: "budget-owner@example.test",
      approvedAt: "2026-07-13T10:03:00.000Z",
      expiresAt: "2026-07-13T10:10:00.000Z",
    });
  const rightsPolicy = FoundryRightsPolicyDefinitionV0Schema.parse({
    schemaVersion: FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
    policyVersion: "rights-v1",
    policyDefinitionSha256: POLICY_DEFINITION_SHA256,
    generation: 7,
    effectiveAt: "2026-07-13T09:00:00.000Z",
    revokedAt: null,
    maximumApprovalTtlSeconds: 3_600,
  });
  const rightsApproval = FoundryRightsApprovalSchema.parse({
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    ingestManifestSha256: manifestSha256,
    policyVersion: rightsPolicy.policyVersion,
    policyDefinitionSha256: rightsPolicy.policyDefinitionSha256,
    policyGeneration: rightsPolicy.generation,
    decision: "allowed",
    decidedBy: "rights@example.test",
    decidedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T10:30:00.000Z",
  });
  const rightsApprovalSha256 = digest(
    "omnitwin.foundry.rights-approval.v0",
    rightsApproval,
  );
  const rightsPolicyEvidenceSha256 = digest(
    FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
    rightsPolicy,
  );
  const subject: FoundryExecutionSubjectV0 = {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: envelope.envelopeId,
    projectId: envelope.projectId,
    jobSpecSha256,
    executionEnvelopeSha256: envelopeSha256,
    ingestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    providerPlanSha256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(policy),
    executionConfirmationSha256:
      computeFoundryExecutionEnvelopeConfirmationSha256(confirmation),
    rightsApprovalSha256,
    rightsPolicyEvidenceSha256,
    rightsPolicyDefinitionSha256: rightsPolicy.policyDefinitionSha256,
    computeApprovalSha256:
      computeFoundryExecutionEnvelopeComputeApprovalSha256(computeApproval),
    providerKind: envelope.providerKind,
    providerAdapterId: envelope.providerAdapterId,
    providerAdapterVersion: envelope.providerAdapterVersion,
    providerAdapterArtifactSha256: envelope.providerAdapterArtifactSha256,
    providerDeploymentSha256: deploymentSha256,
    workerProfileSha256s: [workerProfileSha256],
    pricingSnapshotSha256: envelope.pricingSnapshotSha256,
    pricingSnapshotExpiresAt: envelope.pricingSnapshotExpiresAt,
    createdAt: envelope.createdAt,
    dispatchDeadline: envelope.dispatchDeadline,
    maximumAttempts: FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: policy.costWarningMicroUsd,
      costHardStopMicroUsd: policy.costHardStopMicroUsd,
      terminationReserveMicroUsd: policy.terminationReserveMicroUsd,
      absoluteCostCapMicroUsd: policy.absoluteCostCapMicroUsd,
      costObservationMaximumAgeSeconds:
        policy.costObservationMaximumAgeSeconds,
    },
    checkpointContract: null,
  };
  const subjectSha256 = computeFoundryExecutionSubjectSha256(subject);
  const providerRequestProfile = FoundryProviderRequestProfileV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_PROFILE_V0,
    profileId: "runpod-private-l40s",
    profileVersion: "v1",
    providerKind: "runpod",
    providerAdapterId: "runpod-pods-rest-v1",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
    providerDeploymentSha256: deploymentSha256,
    target: {
      targetKind: "remote_worker_pool",
      poolId: "runpod-template-001",
    },
    allowedContainerImages: [IMAGE],
    allowedNetworkAccess: ["object_storage_only"],
    allowedCapacityClasses: ["gpu-l40s-48gb"],
    allowedObjectStorageProfiles: ["foundry-private"],
    supportedCommandKinds: [
      "provider_checkpoint",
      "provider_poll",
      "provider_reconcile",
      "provider_stop",
      "provider_submit",
    ],
    maximumApiCallSeconds: 30,
    reviewedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
  });
  const command = {
    commandKind: "provider_submit" as const,
    commandId: SUBMIT_COMMAND_ID,
    commandSequence: 1,
    executionId: EXECUTION_ID,
    attemptId: ATTEMPT_ID,
    attemptOrdinal: 1 as const,
    fencingToken: "7",
    stageIds: [...stageIds].sort(),
    providerIdempotencyKey: deriveFoundryProviderIdempotencyKey(
      subjectSha256,
      ATTEMPT_ID,
    ),
    clientRequestId: deriveFoundryProviderClientRequestId(
      "provider_submit",
      SUBMIT_COMMAND_ID,
    ),
    providerCommandRef: null,
    submitLineage: null,
    stopIntentId: null,
  };
  const input: FoundryProviderRequestAuthorizationCompilerInput = {
    preparedAt: "2026-07-13T10:04:00.000Z",
    command,
    executionSubject: subject,
    executionSubjectSha256: subjectSha256,
    jobSpec: job,
    ingestManifest: manifest,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    executionPolicy: policy,
    providerPlanEvidence: plan,
    trustedWorkerProfiles: [workerProfile],
    providerDeploymentEvidence: deployment,
    executionEnvelope: envelope,
    executionConfirmation: confirmation,
    computeApproval,
    rightsApproval,
    rightsApprovalSha256,
    activeRightsPolicy: rightsPolicy,
    rightsPolicyEvidenceSha256,
    providerRequestProfile,
  };
  return { input, subjectSha256, providerRequestProfile };
}

function commandInput(
  base: ReturnType<typeof fixture>,
  commandKind: FoundryProviderCommandKindV0,
  commandId: string,
  sequence: number,
) {
  const submit = compileFoundryProviderRequestAuthorization(base.input);
  return {
    ...base.input,
    command: {
      ...(base.input.command as Record<string, unknown>),
      commandKind,
      commandId,
      commandSequence: sequence,
      clientRequestId: deriveFoundryProviderClientRequestId(
        commandKind,
        commandId,
      ),
      providerCommandRef:
        commandKind === "provider_submit" ? null : "runpod:pod-001",
      submitLineage:
        commandKind === "provider_reconcile"
          ? {
              submitCommandId: SUBMIT_COMMAND_ID,
              submitProviderRequestAuthorizationSha256:
                submit.authorizationSha256,
            }
          : null,
      stopIntentId: commandKind === "provider_stop" ? STOP_INTENT_ID : null,
    },
  } satisfies FoundryProviderRequestAuthorizationCompilerInput;
}

describe("Foundry provider request authorization compiler", () => {
  it("compiles a deterministic, closed submit contract from exact trusted evidence", () => {
    const current = fixture();
    const first = compileFoundryProviderRequestAuthorization(current.input);
    const second = compileFoundryProviderRequestAuthorization(current.input);

    expect(second).toEqual(first);
    expect(first.authorizationSha256).toBe(
      computeFoundryProviderRequestAuthorizationSha256(first.authorization),
    );
    expect(first.authorization).toMatchObject({
      authority: "none",
      commandKind: "provider_submit",
      execution: {
        executionSubjectSha256: current.subjectSha256,
        attemptId: ATTEMPT_ID,
        fencingToken: "7",
      },
      provider: {
        providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
        target: {
          targetKind: "remote_worker_pool",
          poolId: "runpod-template-001",
        },
        providerRequestProfileSha256:
          computeFoundryProviderRequestProfileSha256(
            current.providerRequestProfile,
          ),
      },
      storage: {
        sourceMountMode: "read_only",
        objectStorageProfile: "foundry-private",
        outputPrefix: "foundry/job-001",
      },
      action: {
        kind: "provider_submit",
        providerCommandRef: null,
      },
    });
    expect(first.authorization.stages[0]).toMatchObject({
      stageId: "geometry",
      containerImage: IMAGE,
      command: ["foundry-geometry", "--input", "/input"],
      networkAccess: "object_storage_only",
      capacityClass: "gpu-l40s-48gb",
      requestedResources: {
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 1,
        minimumGpuVramGiB: 20,
        scratchGiB: 100,
      },
      authorizedCapacity: {
        cpuCores: 16,
        ramGiB: 64,
        gpuCount: 1,
        perGpuVramGiB: 48,
        scratchGiB: 500,
      },
      maximumRuntimeSeconds: 1_800,
    });
    expect("providerRequest" in first.authorization).toBe(false);
    expect(
      validateFoundryProviderRequestAuthorization(
        first.authorization,
        first.authorizationSha256,
        current.input,
      ),
    ).toEqual({ valid: true });
  });

  it("uses PostgreSQL C-compatible code-unit ordering for punctuation-heavy stage IDs", () => {
    const stageIds = ["a-1", "a.1", "a_1"];
    const compiled = compileFoundryProviderRequestAuthorization(
      fixture(stageIds).input,
    );
    expect(compiled.authorization.stages.map((stage) => stage.stageId)).toEqual(
      stageIds,
    );
  });

  it("requires launch profiles through dispatch and checkpoint authority through the API-call window", () => {
    const current = fixture();
    expect(() => compileFoundryProviderRequestAuthorization({
      ...current.input,
      providerRequestProfile: {
        ...current.providerRequestProfile,
        expiresAt: "2026-07-13T10:10:00.000Z",
      },
    })).toThrowError(/through the dispatch deadline/u);

    const checkpoint = commandInput(
      current,
      "provider_checkpoint",
      "00000000-0000-4000-8000-000000000018",
      6,
    );
    expect(() => compileFoundryProviderRequestAuthorization({
      ...checkpoint,
      providerRequestProfile: {
        ...current.providerRequestProfile,
        expiresAt: "2026-07-13T10:04:30.000Z",
      },
    })).toThrowError(/bounded API-call window/u);

    const expiringRightsApproval = {
      ...(current.input.rightsApproval as Record<string, unknown>),
      expiresAt: "2026-07-13T10:04:30.000Z",
    };
    expect(() => compileFoundryProviderRequestAuthorization({
      ...checkpoint,
      rightsApproval: expiringRightsApproval,
      rightsApprovalSha256: digest(
        "omnitwin.foundry.rights-approval.v0",
        expiringRightsApproval,
      ),
    })).toThrowError(/Live rights authorization rejected/u);
  });

  it.each([
    ["provider_submit", SUBMIT_COMMAND_ID, 1],
    ["provider_reconcile", "00000000-0000-4000-8000-000000000004", 2],
    ["provider_poll", "00000000-0000-4000-8000-000000000005", 3],
    ["provider_checkpoint", "00000000-0000-4000-8000-000000000006", 4],
    ["provider_stop", "00000000-0000-4000-8000-000000000007", 5],
  ] as const)(
    "emits the exact %s action shape",
    (commandKind, commandId, sequence) => {
      const current = fixture();
      const compiled = compileFoundryProviderRequestAuthorization(
        commandInput(current, commandKind, commandId, sequence),
      );
      expect(compiled.authorization.commandKind).toBe(commandKind);
      expect(compiled.authorization.action.kind).toBe(commandKind);
      if (commandKind === "provider_reconcile") {
        expect(compiled.authorization.action).toMatchObject({
          submitCommandId: SUBMIT_COMMAND_ID,
        });
      }
      if (commandKind === "provider_stop") {
        expect(compiled.authorization.action).toEqual({
          kind: "provider_stop",
          providerCommandRef: "runpod:pod-001",
          stopIntentId: STOP_INTENT_ID,
        });
      }
    },
  );

  it("lets reconciliation, polling, and stop retain the immutable profile after submit authority expires", () => {
    const current = fixture();
    for (const [kind, id] of [
      ["provider_reconcile", "00000000-0000-4000-8000-000000000014"],
      ["provider_poll", "00000000-0000-4000-8000-000000000015"],
      ["provider_stop", "00000000-0000-4000-8000-000000000016"],
    ] as const) {
      const input = commandInput(current, kind, id, 9);
      const compiled = compileFoundryProviderRequestAuthorization({
        ...input,
        preparedAt: "2026-07-13T12:00:00.000Z",
      });
      expect(compiled.authorization.action.kind).toBe(kind);
    }
  });

  it("rejects arbitrary provider JSON, extra keys, and non-derived request identities", () => {
    const current = fixture();
    expect(
      FoundryProviderRequestProfileV0Schema.safeParse({
        ...current.providerRequestProfile,
        providerJson: { arbitrary: true },
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderRequestAuthorizationV0Schema.safeParse({
        ...compileFoundryProviderRequestAuthorization(current.input)
          .authorization,
        providerRequest: { arbitrary: true },
      }).success,
    ).toBe(false);

    expect(() =>
      compileFoundryProviderRequestAuthorization({
        ...current.input,
        command: {
          ...(current.input.command as Record<string, unknown>),
          providerIdempotencyKey: "attacker-selected-key",
        },
      }),
    ).toThrowError(FoundryProviderRequestAuthorizationError);
  });

  it("rejects fractional and unsafe numeric leaves from the canonical authorization domain", () => {
    const current = fixture();
    const authorization = compileFoundryProviderRequestAuthorization(
      current.input,
    ).authorization;
    expect(
      FoundryProviderRequestAuthorizationV0Schema.safeParse({
        ...authorization,
        stages: authorization.stages.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                requestedResources: {
                  ...stage.requestedResources,
                  ramGiB: 32.5,
                },
              }
            : stage
        ),
      }).success,
    ).toBe(false);

    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;
    const unsafeAuthorizations = [
      {
        ...authorization,
        stages: authorization.stages.map((stage, index) =>
          index === 0
            ? { ...stage, maximumRuntimeSeconds: unsafeInteger }
            : stage
        ),
      },
      {
        ...authorization,
        runtime: {
          ...authorization.runtime,
          maximumWallClockSeconds: unsafeInteger,
        },
      },
      {
        ...authorization,
        runtime: {
          ...authorization.runtime,
          budgetPolicy: {
            ...authorization.runtime.budgetPolicy,
            costObservationMaximumAgeSeconds: unsafeInteger,
          },
        },
      },
    ];
    for (const unsafeAuthorization of unsafeAuthorizations) {
      expect(
        FoundryProviderRequestAuthorizationV0Schema.safeParse(
          unsafeAuthorization,
        ).success,
      ).toBe(false);
    }
  });

  it("requires stop intent causation only for provider_stop and rejects smuggling it elsewhere", () => {
    const current = fixture();
    const stop = commandInput(
      current,
      "provider_stop",
      "00000000-0000-4000-8000-000000000017",
      6,
    );
    expect(() =>
      compileFoundryProviderRequestAuthorization({
        ...stop,
        command: {
          ...(stop.command as Record<string, unknown>),
          stopIntentId: null,
        },
      }),
    ).toThrowError(/stop intent is required only for provider stop/u);

    expect(() =>
      compileFoundryProviderRequestAuthorization({
        ...current.input,
        command: {
          ...(current.input.command as Record<string, unknown>),
          stopIntentId: STOP_INTENT_ID,
        },
      }),
    ).toThrowError(/stop intent is required only for provider stop/u);
  });

  it("rejects rights generation drift and provider-profile allowlist drift", () => {
    const current = fixture();
    expect(() =>
      compileFoundryProviderRequestAuthorization({
        ...current.input,
        rightsApproval: {
          ...(current.input.rightsApproval as Record<string, unknown>),
          policyGeneration: 8,
        },
      }),
    ).toThrowError(/Rights approval and policy evidence/u);

    expect(() =>
      compileFoundryProviderRequestAuthorization({
        ...current.input,
        providerRequestProfile: {
          ...current.providerRequestProfile,
          allowedContainerImages: [
            `ghcr.io/omnitwin/other@sha256:${"2".repeat(64)}`,
          ],
        },
      }),
    ).toThrowError(/Provider request profile/u);
  });

  it("detects canonical authorization tampering even when the attacker recomputes its digest", () => {
    const current = fixture();
    const compiled = compileFoundryProviderRequestAuthorization(current.input);
    const tampered = {
      ...compiled.authorization,
      storage: {
        ...compiled.authorization.storage,
        outputPrefix: "foundry/attacker-selected-output",
      },
    };
    const tamperedSha256 = computeFoundryProviderRequestAuthorizationSha256(
      tampered,
    );
    expect(
      validateFoundryProviderRequestAuthorization(
        tampered,
        tamperedSha256,
        current.input,
      ),
    ).toEqual({
      valid: false,
      reasonCode: "authorization_content_mismatch",
    });
  });

  it("binds the provider target profile digest and rejects replay against a different trusted target", () => {
    const current = fixture();
    const compiled = compileFoundryProviderRequestAuthorization(current.input);
    const changedTrustedInput = {
      ...current.input,
      providerRequestProfile: {
        ...current.providerRequestProfile,
        target: {
          targetKind: "remote_worker_pool" as const,
          poolId: "runpod-template-002",
        },
      },
    };
    expect(
      validateFoundryProviderRequestAuthorization(
        compiled.authorization,
        compiled.authorizationSha256,
        changedTrustedInput,
      ),
    ).toEqual({
      valid: false,
      reasonCode: "authorization_content_mismatch",
    });
  });

  it("binds adapter selector configuration into both the profile and compiled provider scope", () => {
    const current = fixture();
    const compiled = compileFoundryProviderRequestAuthorization(current.input);
    expect(compiled.authorization.provider).toMatchObject({
      providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
      providerRequestProfileSha256:
        computeFoundryProviderRequestProfileSha256(
          current.providerRequestProfile,
        ),
    });

    const changedTrustedInput = {
      ...current.input,
      providerRequestProfile: {
        ...current.providerRequestProfile,
        providerAdapterConfigurationSha256: `sha256:${"8".repeat(64)}`,
      },
    };
    expect(
      validateFoundryProviderRequestAuthorization(
        compiled.authorization,
        compiled.authorizationSha256,
        changedTrustedInput,
      ),
    ).toEqual({
      valid: false,
      reasonCode: "authorization_content_mismatch",
    });
  });
});
