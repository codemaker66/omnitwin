import {
  FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
  FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
  FOUNDRY_EXECUTION_ENVELOPE_V0,
  FOUNDRY_EXECUTION_POLICY_V0,
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
  FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
  type FoundryExecutionEnvelopeComputeApprovalV0,
  type FoundryExecutionEnvelopeConfirmationV0,
  type FoundryExecutionEnvelopeV0,
  type FoundryExecutionPolicyV0,
  type FoundryIngestManifestV0,
  type FoundryJobSpecV0,
  type FoundryProviderDeploymentEvidenceV0,
  type FoundryProviderPlanEvidenceV0,
  type FoundryTrustedWorkerProfileV0,
} from "@omnitwin/types";
import { describe, expect, it, vi } from "vitest";
import {
  LocalCudaExecutionAdapter,
  RunPodExecutionAdapter,
  commitFoundryExecutionDispatch,
  prepareFoundryExecutionDispatch,
  type FoundryDispatchReservationInput,
  type FoundryDispatchReservationResult,
  type FoundryDurableDispatchRecord,
  type FoundryExecutionDispatchEvidenceInput,
  type FoundryExecutionDispatchStore,
  type FoundryPreparedExecutionV0,
  type FoundryPreparedWriteResult,
  type FoundryProviderInvocation,
  type FoundryProviderInvocationReceipt,
} from "../execution-dispatch.js";
import { FoundryIntegrityError } from "../errors.js";

const INTAKE_ADMISSION_SHA256 = `sha256:${"a".repeat(64)}`;
const INTAKE_STAGING_SHA256 = `sha256:${"b".repeat(64)}`;
const PRICING_SHA256 = `sha256:${"c".repeat(64)}`;
const RIGHTS_SHA256 = `sha256:${"d".repeat(64)}`;
const RIGHTS_POLICY_EVIDENCE_SHA256 = `sha256:${"7".repeat(64)}`;
const RIGHTS_POLICY_DEFINITION_SHA256 = `sha256:${"8".repeat(64)}`;
const PROVIDER_REFERENCE_SHA256 = `sha256:${"e".repeat(64)}`;
const ADAPTER_ARTIFACT_SHA256 = `sha256:${"9".repeat(64)}`;
const IMAGE = `ghcr.io/omnitwin/geometry@sha256:${"1".repeat(64)}`;

const INGEST_MANIFEST = FoundryIngestManifestV0Schema.parse({
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
const MANIFEST_SHA256 = computeFoundryIngestManifestSha256(INGEST_MANIFEST);

interface Fixture {
  readonly input: FoundryExecutionDispatchEvidenceInput;
  readonly manifest: FoundryIngestManifestV0;
  readonly job: FoundryJobSpecV0;
  readonly policy: FoundryExecutionPolicyV0;
  readonly workerProfiles: readonly FoundryTrustedWorkerProfileV0[];
  readonly deployment: FoundryProviderDeploymentEvidenceV0;
  readonly plan: FoundryProviderPlanEvidenceV0;
  readonly envelope: FoundryExecutionEnvelopeV0;
  readonly confirmation: FoundryExecutionEnvelopeConfirmationV0;
  readonly approval: FoundryExecutionEnvelopeComputeApprovalV0 | null;
}

function fixture(providerKind: "local_cuda" | "runpod" = "runpod"): Fixture {
  const remote = providerKind === "runpod";
  const adapterId = remote ? "runpod-v0" : "local-cuda-v0";
  const estimatedCostMicroUsd = remote ? "1000000" : "0";
  const estimatedCostUsd = remote ? 1 : 0;
  const job = FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "job-001",
    projectId: "project-001",
    ingestManifestSha256: MANIFEST_SHA256,
    executionIntent: "execute",
    providerKind,
    providerAdapterId: adapterId,
    stages: [
      {
        id: "geometry",
        kind: "geometry",
        dependsOn: [],
        containerImage: IMAGE,
        command: ["foundry-geometry", "--input", "/input"],
        inputAssetIds: ["source-001"],
        outputNames: ["geometry"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 1,
        minimumGpuVramGiB: 20,
        scratchGiB: 100,
        networkAccess: remote ? "object_storage_only" : "none",
        checkpoint: "stage_boundary",
        resumable: true,
      },
    ],
    objectStorageProfile: remote ? "foundry-private" : null,
    sourceMountMode: "read_only",
    outputPrefix: "foundry/job-001",
    estimatedCostUsd,
    budgetCapUsd: 3.5,
    killSwitchEnabled: true,
    computeApprovalId: remote ? "approval-001" : null,
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
  const workerProfiles = [
    FoundryTrustedWorkerProfileV0Schema.parse({
      schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
      profileId: "geometry-worker",
      profileVersion: "v1",
      operationClass: "deterministic_transformation",
      containerImage: IMAGE,
      command: job.stages[0]?.command,
      networkAccess: job.stages[0]?.networkAccess,
      localExecutionAllowed: true,
      reviewedBy: "security@example.test",
      reviewedAt: "2026-07-13T10:00:00.000Z",
      expiresAt: "2026-07-13T11:00:00.000Z",
    }),
  ] as const;
  const capacityClass = remote ? "gpu-l40s-48gb" : "local-rtx4090-24gb";
  const deployment = FoundryProviderDeploymentEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
    deploymentId: "deployment-001",
    providerKind,
    providerAdapterId: adapterId,
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    accountProjectAlias: remote ? "foundry-private" : "local-workstation",
    region: remote ? "eu-west-1" : "local",
    dataResidency: "gb",
    observedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
    capacityClasses: [
      {
        id: capacityClass,
        cpuCores: 16,
        ramGiB: 64,
        gpuCount: 1,
        perGpuVramGiB: remote ? 48 : 24,
        scratchGiB: 500,
      },
    ],
  });
  const deploymentSha256 = computeFoundryProviderDeploymentEvidenceSha256(deployment);
  const plan = FoundryProviderPlanEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
    executionIntent: "execute",
    authority: "none",
    planId: "plan-001",
    jobId: job.id,
    jobSpecSha256,
    reviewedIngestManifestSha256: MANIFEST_SHA256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    providerKind,
    providerAdapterId: adapterId,
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingBasis: remote ? "metered_estimate" : "fixed_quote",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotObservedAt: "2026-07-13T10:00:00.000Z",
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    plannedAt: "2026-07-13T10:01:00.000Z",
    estimatedCostMicroUsd,
    stages: [
      {
        stageId: "geometry",
        capacityClass,
        workerProfileSha256: computeFoundryTrustedWorkerProfileSha256(workerProfiles[0]),
        estimatedCostMicroUsd,
        maximumRuntimeSeconds: 1_800,
      },
    ],
  });
  const envelope = FoundryExecutionEnvelopeV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_V0,
    executionIntent: "execute",
    authority: "none",
    envelopeId: "envelope-001",
    jobId: job.id,
    projectId: job.projectId,
    jobSpecSha256,
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(plan),
    reviewedIngestManifestSha256: MANIFEST_SHA256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(policy),
    computeApprovalId: job.computeApprovalId,
    providerKind,
    providerAdapterId: adapterId,
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotExpiresAt: plan.pricingSnapshotExpiresAt,
    createdAt: "2026-07-13T10:02:00.000Z",
    dispatchDeadline: "2026-07-13T10:20:00.000Z",
  });
  const executionEnvelopeSha256 = computeFoundryExecutionEnvelopeSha256(envelope);
  const confirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
    confirmationId: "confirmation-001",
    executionEnvelopeSha256,
    jobSpecSha256,
    jobId: job.id,
    confirmedBy: "operator@example.test",
    confirmedAt: "2026-07-13T10:03:00.000Z",
    expiresAt: "2026-07-13T10:10:00.000Z",
  });
  const approval = remote
    ? FoundryExecutionEnvelopeComputeApprovalV0Schema.parse({
        schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
        approvalId: "approval-001",
        executionEnvelopeSha256,
        jobSpecSha256,
        jobId: job.id,
        projectId: job.projectId,
        providerKind,
        providerAdapterId: adapterId,
        providerAdapterVersion: "1.0.0",
        providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
        providerDeploymentSha256: deploymentSha256,
        maximumCostMicroUsd: policy.absoluteCostCapMicroUsd,
        approvedBy: "budget-owner@example.test",
        approvedAt: "2026-07-13T10:03:00.000Z",
        expiresAt: "2026-07-13T10:10:00.000Z",
      })
    : null;
  return {
    input: {
      jobSpec: job,
      ingestManifest: INGEST_MANIFEST,
      intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
      intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
      executionPolicy: policy,
      providerPlanEvidence: plan,
      trustedWorkerProfiles: workerProfiles,
      providerDeploymentEvidence: deployment,
      executionEnvelope: envelope,
      executionConfirmation: confirmation,
      computeApproval: approval,
      rightsApprovalSha256: RIGHTS_SHA256,
      rightsPolicyEvidenceSha256: RIGHTS_POLICY_EVIDENCE_SHA256,
      rightsPolicyDefinitionSha256: RIGHTS_POLICY_DEFINITION_SHA256,
    },
    manifest: INGEST_MANIFEST,
    job,
    policy,
    workerProfiles,
    deployment,
    plan,
    envelope,
    confirmation,
    approval,
  };
}

function receipt(): FoundryProviderInvocationReceipt {
  return {
    status: "accepted",
    providerExecutionReferenceSha256: PROVIDER_REFERENCE_SHA256,
    acceptedAt: "2026-07-13T10:05:01.000Z",
  };
}

function rebindPlan(
  current: Fixture,
  providerPlanEvidence: FoundryProviderPlanEvidenceV0,
): FoundryExecutionDispatchEvidenceInput {
  const executionEnvelope = FoundryExecutionEnvelopeV0Schema.parse({
    ...current.envelope,
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(providerPlanEvidence),
    pricingSnapshotSha256: providerPlanEvidence.pricingSnapshotSha256,
    pricingSnapshotExpiresAt: providerPlanEvidence.pricingSnapshotExpiresAt,
  });
  const executionEnvelopeSha256 = computeFoundryExecutionEnvelopeSha256(executionEnvelope);
  const executionConfirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse({
    ...current.confirmation,
    executionEnvelopeSha256,
  });
  const computeApproval = current.approval === null
    ? null
    : FoundryExecutionEnvelopeComputeApprovalV0Schema.parse({
        ...current.approval,
        executionEnvelopeSha256,
      });
  return {
    ...current.input,
    providerPlanEvidence,
    executionEnvelope,
    executionConfirmation,
    computeApproval,
  };
}

class MemoryDispatchStore implements FoundryExecutionDispatchStore {
  readonly prepared = new Map<string, FoundryPreparedExecutionV0>();
  readonly dispatches = new Map<string, FoundryDurableDispatchRecord>();
  readonly ledgers = new Map<string, unknown[]>();
  readonly consumedConfirmations = new Map<string, string>();
  readonly reservedApprovals = new Map<string, { dispatchId: string; cost: bigint }>();
  reservedCostMicroUsd = 0n;

  putPreparedExecution(record: FoundryPreparedExecutionV0): Promise<FoundryPreparedWriteResult> {
    const existing = this.prepared.get(record.preparedId);
    if (existing === undefined) {
      this.prepared.set(record.preparedId, record);
      return Promise.resolve("created");
    }
    return Promise.resolve(
      existing.preparedExecutionSha256 === record.preparedExecutionSha256 ? "existing" : "conflict",
    );
  }

  getPreparedExecution(preparedId: string): Promise<FoundryPreparedExecutionV0 | null> {
    return Promise.resolve(this.prepared.get(preparedId) ?? null);
  }

  getDispatch(dispatchId: string): Promise<FoundryDurableDispatchRecord | null> {
    return Promise.resolve(this.dispatches.get(dispatchId) ?? null);
  }

  readExecutionLedger(executionSubjectSha256: string): Promise<readonly unknown[]> {
    return Promise.resolve([...(this.ledgers.get(executionSubjectSha256) ?? [])]);
  }

  reserveDispatchAtomically(
    input: FoundryDispatchReservationInput,
  ): Promise<FoundryDispatchReservationResult> {
    const existing = this.dispatches.get(input.dispatchId);
    if (existing !== undefined) return Promise.resolve({ status: "existing", record: existing });
    const prepared = this.prepared.get(input.preparedId);
    if (prepared?.preparedExecutionSha256 !== input.preparedExecutionSha256) {
      throw new Error("prepared digest mismatch");
    }
    const consumedBy = this.consumedConfirmations.get(input.executionConfirmationId);
    if (consumedBy !== undefined && consumedBy !== input.dispatchId) {
      throw new Error("confirmation already consumed");
    }
    if (input.computeApprovalId !== null) {
      const reserved = this.reservedApprovals.get(input.computeApprovalId);
      if (reserved !== undefined && reserved.dispatchId !== input.dispatchId) {
        throw new Error("approval already reserved");
      }
      if (
        input.approvedMaximumCostMicroUsd === null ||
        BigInt(input.reservedCostMicroUsd) > BigInt(input.approvedMaximumCostMicroUsd)
      ) {
        throw new Error("approval budget exceeded");
      }
    }
    const ledger = this.ledgers.get(input.executionSubjectSha256) ?? [];
    const currentHead = (ledger.at(-1) as { eventSha256?: string } | undefined)?.eventSha256 ?? null;
    if (currentHead !== input.expectedLedgerHeadSha256) throw new Error("ledger compare-and-append failed");
    const record: FoundryDurableDispatchRecord = {
      dispatchId: input.dispatchId,
      preparedExecutionSha256: input.preparedExecutionSha256,
      executionConfirmationId: input.executionConfirmationId,
      executionConfirmationSha256: input.executionConfirmationSha256,
      computeApprovalId: input.computeApprovalId,
      computeApprovalSha256: input.computeApprovalSha256,
      reservedCostMicroUsd: input.reservedCostMicroUsd,
      executionSubjectSha256: input.executionSubjectSha256,
      authorizationEventSha256: input.authorizationEvent.eventSha256,
      state: "reserved",
      receiptSha256: null,
    };
    this.consumedConfirmations.set(input.executionConfirmationId, input.dispatchId);
    if (input.computeApprovalId !== null) {
      this.reservedApprovals.set(input.computeApprovalId, {
        dispatchId: input.dispatchId,
        cost: BigInt(input.reservedCostMicroUsd),
      });
      this.reservedCostMicroUsd += BigInt(input.reservedCostMicroUsd);
    }
    this.ledgers.set(input.executionSubjectSha256, [...ledger, input.authorizationEvent]);
    this.dispatches.set(input.dispatchId, record);
    return Promise.resolve({ status: "acquired", record });
  }

  markInvocationStarted(input: {
    dispatchId: string;
    preparedExecutionSha256: string;
    expectedLedgerHeadSha256: string;
    startedAt: string;
  }): Promise<boolean> {
    const record = this.dispatches.get(input.dispatchId);
    const ledger = record === undefined ? [] : this.ledgers.get(record.executionSubjectSha256) ?? [];
    const head = (ledger.at(-1) as { eventSha256?: string } | undefined)?.eventSha256;
    if (
      record === undefined ||
      record.state !== "reserved" ||
      record.preparedExecutionSha256 !== input.preparedExecutionSha256 ||
      head !== input.expectedLedgerHeadSha256
    ) {
      return Promise.resolve(false);
    }
    this.dispatches.set(input.dispatchId, { ...record, state: "invoking" });
    return Promise.resolve(true);
  }

  markInvocationSucceeded(input: {
    dispatchId: string;
    preparedExecutionSha256: string;
    receiptSha256: string;
    completedAt: string;
  }): Promise<void> {
    const record = this.dispatches.get(input.dispatchId);
    if (record === undefined || record.state !== "invoking") throw new Error("not invoking");
    this.dispatches.set(input.dispatchId, { ...record, state: "succeeded", receiptSha256: input.receiptSha256 });
    return Promise.resolve();
  }

  markInvocationUncertain(input: {
    dispatchId: string;
    preparedExecutionSha256: string;
    failureCode: string;
    failedAt: string;
  }): Promise<void> {
    const record = this.dispatches.get(input.dispatchId);
    if (record === undefined || record.state === "succeeded") return Promise.resolve();
    this.dispatches.set(input.dispatchId, { ...record, state: "uncertain" });
    return Promise.resolve();
  }
}

function localAdapter(run = vi.fn<(invocation: FoundryProviderInvocation) => Promise<FoundryProviderInvocationReceipt>>()) {
  run.mockResolvedValue(receipt());
  return {
    run,
    adapter: new LocalCudaExecutionAdapter(
      {
        providerAdapterId: "local-cuda-v0",
        providerAdapterVersion: "1.0.0",
        capacity: { cpuCores: 16, ramGiB: 64, gpuCount: 1, perGpuVramGiB: 24, scratchGiB: 500 },
        allowedCapacityClasses: ["local-rtx4090-24gb"],
        allowedContainerImages: [IMAGE],
        allowedNetworkAccess: ["none"],
      },
      { run },
    ),
  };
}

function runPodAdapter(
  submit = vi.fn<(invocation: FoundryProviderInvocation) => Promise<FoundryProviderInvocationReceipt>>(),
) {
  submit.mockResolvedValue(receipt());
  return {
    submit,
    adapter: new RunPodExecutionAdapter(
      {
        providerAdapterId: "runpod-v0",
        providerAdapterVersion: "1.0.0",
        requestPath: "/v1/foundry/jobs",
        templateId: "omnitwin-a100-v1",
        capacityClasses: {
          "gpu-l40s-48gb": {
            cpuCores: 16,
            ramGiB: 64,
            gpuCount: 1,
            perGpuVramGiB: 48,
            scratchGiB: 500,
          },
        },
        allowedContainerImages: [IMAGE],
        allowedNetworkAccess: ["object_storage_only"],
      },
      { submit },
    ),
  };
}

const PREPARE_AT = new Date("2026-07-13T10:04:00.000Z");
const COMMIT_AT = new Date("2026-07-13T10:05:00.000Z");

async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
    throw new Error("Expected operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

describe("Foundry prepared/commit execution boundary", () => {
  it("calls an injected local CUDA runner exactly once after the durable one-use gate", async () => {
    const current = fixture("local_cuda");
    const store = new MemoryDispatchStore();
    const { adapter, run } = localAdapter();
    const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);

    expect(run).not.toHaveBeenCalled();
    const result = await commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT);

    expect(result.status).toBe("dispatched");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      dispatchId: expect.stringMatching(/^dispatch-/u),
      idempotencyKey: expect.stringMatching(/^dispatch-/u),
      adapterPlan: {
        schemaVersion: "omnitwin.foundry.local-cuda-adapter-plan.v0",
        sourceMountMode: "read_only",
      },
    });
    expect(store.consumedConfirmations.size).toBe(1);
    expect(store.reservedCostMicroUsd).toBe(0n);
  });

  it("constructs a deterministic RunPod request and kill budget, then calls only the injected client", async () => {
    const current = fixture("runpod");
    const store = new MemoryDispatchStore();
    const { adapter, submit } = runPodAdapter();
    const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);

    expect(submit).not.toHaveBeenCalled();
    expect(prepared.adapterPlan).toMatchObject({
      schemaVersion: "omnitwin.foundry.runpod-adapter-plan.v0",
      authority: "none",
      deterministicRequest: {
        method: "POST",
        path: "/v1/foundry/jobs",
        templateId: "omnitwin-a100-v1",
        sourceMountMode: "read_only",
      },
      killBudgetPolicy: {
        estimatedCostMicroUsd: "1000000",
        costHardStopMicroUsd: "3000000",
        absoluteCostCapMicroUsd: "3500000",
        killSwitchRequired: true,
      },
    });
    await commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.reservedCostMicroUsd).toBe(1_000_000n);
    expect(store.reservedApprovals.get("approval-001")).toMatchObject({ cost: 1_000_000n });
  });

  it("never invokes for a plan-only job", async () => {
    const current = fixture("local_cuda");
    const store = new MemoryDispatchStore();
    const { adapter, run } = localAdapter();
    const planOnly = {
      ...current.job,
      executionIntent: "plan_only",
      computeApprovalId: null,
    };
    await expectCode(
      prepareFoundryExecutionDispatch({ ...current.input, jobSpec: planOnly }, adapter, store, PREPARE_AT),
      "EXECUTION_BINDING_REJECTED",
    );
    expect(run).not.toHaveBeenCalled();
    expect(store.prepared.size).toBe(0);
  });

  it("never invokes for expired authorization or changed evidence", async () => {
    const cases = [
      {
        name: "expired confirmation",
        commitAt: new Date("2026-07-13T10:10:00.000Z"),
        patch: (current: Fixture): FoundryExecutionDispatchEvidenceInput => current.input,
      },
      {
        name: "changed cost evidence",
        commitAt: COMMIT_AT,
        patch: (current: Fixture): FoundryExecutionDispatchEvidenceInput => ({
          ...current.input,
          providerPlanEvidence: {
            ...current.plan,
            estimatedCostMicroUsd: "1000001",
            stages: [{ ...current.plan.stages[0]!, estimatedCostMicroUsd: "1000001" }],
          },
        }),
      },
    ];
    for (const testCase of cases) {
      const current = fixture("runpod");
      const store = new MemoryDispatchStore();
      const { adapter, submit } = runPodAdapter();
      const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);
      await expect(
        commitFoundryExecutionDispatch(
          prepared.preparedId,
          testCase.patch(current),
          adapter,
          store,
          testCase.commitAt,
        ),
        testCase.name,
      ).rejects.toBeInstanceOf(FoundryIntegrityError);
      expect(submit, testCase.name).not.toHaveBeenCalled();
    }
  });

  it("never invokes when a fully rebound pricing snapshot is stale", async () => {
    const current = fixture("runpod");
    const stalePlan = FoundryProviderPlanEvidenceV0Schema.parse({
      ...current.plan,
      pricingSnapshotObservedAt: "2026-07-13T09:40:00.000Z",
    });
    const store = new MemoryDispatchStore();
    const { adapter, submit } = runPodAdapter();

    await expectCode(
      prepareFoundryExecutionDispatch(rebindPlan(current, stalePlan), adapter, store, PREPARE_AT),
      "EXECUTION_BINDING_REJECTED",
    );
    expect(submit).not.toHaveBeenCalled();
    expect(store.prepared.size).toBe(0);
  });

  it("never invokes without remote approval or when its cost ceiling is too low", async () => {
    for (const computeApproval of [
      null,
      { ...fixture("runpod").approval, maximumCostMicroUsd: "3499999" },
    ]) {
      const current = fixture("runpod");
      const store = new MemoryDispatchStore();
      const { adapter, submit } = runPodAdapter();
      await expect(
        prepareFoundryExecutionDispatch(
          { ...current.input, computeApproval },
          adapter,
          store,
          PREPARE_AT,
        ),
      ).rejects.toBeInstanceOf(FoundryIntegrityError);
      expect(submit).not.toHaveBeenCalled();
      expect(store.reservedCostMicroUsd).toBe(0n);
    }
  });

  it("never invokes when the durable execution ledger is non-empty or corrupt", async () => {
    const current = fixture("runpod");
    const store = new MemoryDispatchStore();
    const { adapter, submit } = runPodAdapter();
    const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);
    store.ledgers.set(prepared.executionSubjectSha256, [{ forged: true }]);

    await expect(
      commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT),
    ).rejects.toBeInstanceOf(FoundryIntegrityError);
    expect(submit).not.toHaveBeenCalled();
    expect(store.consumedConfirmations.size).toBe(0);
  });

  it("rejects unknown or unpinned images during pure preparation", async () => {
    const current = fixture("local_cuda");
    const store = new MemoryDispatchStore();
    const { adapter, run } = localAdapter();
    const unknownImageJob = {
      ...current.job,
      stages: [{ ...current.job.stages[0]!, containerImage: `ghcr.io/omnitwin/other@sha256:${"2".repeat(64)}` }],
    };

    await expect(
      prepareFoundryExecutionDispatch(
        { ...current.input, jobSpec: unknownImageJob },
        adapter,
        store,
        PREPARE_AT,
      ),
    ).rejects.toBeInstanceOf(FoundryIntegrityError);
    expect(run).not.toHaveBeenCalled();
  });

  it("makes sequential and concurrent retries idempotent without a second spend", async () => {
    const current = fixture("runpod");
    const store = new MemoryDispatchStore();
    const { adapter, submit } = runPodAdapter();
    const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);

    const [first, second] = await Promise.all([
      commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT),
      commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT),
    ]);
    const third = await commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT);

    expect([first.status, second.status].sort()).toEqual(["already_committed", "dispatched"]);
    expect(third.status).toBe("already_committed");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.reservedCostMicroUsd).toBe(1_000_000n);
    expect(store.consumedConfirmations.size).toBe(1);
    expect(store.reservedApprovals.size).toBe(1);
  });

  it("marks an adapter error uncertain and forbids automatic replay", async () => {
    const current = fixture("runpod");
    const store = new MemoryDispatchStore();
    const { adapter, submit } = runPodAdapter();
    submit.mockRejectedValue(new Error("transport outcome unknown"));
    const prepared = await prepareFoundryExecutionDispatch(current.input, adapter, store, PREPARE_AT);

    await expectCode(
      commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT),
      "PROVIDER_INVOCATION_OUTCOME_UNCERTAIN",
    );
    const retry = await commitFoundryExecutionDispatch(prepared.preparedId, current.input, adapter, store, COMMIT_AT);

    expect(retry).toMatchObject({ status: "already_committed", durableState: "uncertain" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.reservedCostMicroUsd).toBe(1_000_000n);
  });
});
