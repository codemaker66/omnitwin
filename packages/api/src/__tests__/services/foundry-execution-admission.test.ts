import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
  FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
  FOUNDRY_EXECUTION_ENVELOPE_V0,
  FOUNDRY_EXECUTION_POLICY_V0,
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
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
  FoundryIntakeAdmissionResultV0Schema,
  FoundryJobSpecV0Schema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryRightsApprovalSchema,
  FoundryRightsPolicyDefinitionV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryIntakeAdmissionResultSha256,
  computeFoundryJobApprovalSubjectSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
  type FoundryProviderKind,
} from "@omnitwin/types";
import {
  FOUNDRY_INTAKE_STAGING_INDEX_V0,
  FoundryIntakeStagingIndexV0Schema,
  computeFoundryExecutionSubjectSha256,
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0,
  FOUNDRY_EXECUTION_ADMISSION_STATE,
  FoundryExecutionAdmissionError,
  admitFoundryExecution,
  computeFoundryExecutionComputeApprovalEvidenceSha256,
  computeFoundryExecutionConfirmationEvidenceSha256,
  computeFoundryRightsApprovalEvidenceSha256,
  computeFoundryRightsPolicyEvidenceSha256,
  type FoundryAdmittedExecution,
  type FoundryExecutionAdmissionEvidence,
  type FoundryExecutionAdmissionInsert,
  type FoundryExecutionAdmissionRequestV0,
  type FoundryExecutionAdmissionStore,
  type LockedFoundryExecutionAdmissionStore,
} from "../../services/foundry-execution-admission.js";

const INTAKE_RECEIPT_SHA256 = "9".repeat(64);
const INTAKE_REVIEW_SHA256 = `sha256:${"8".repeat(64)}`;
const PRICING_SHA256 = `sha256:${"c".repeat(64)}`;
const ADAPTER_ARTIFACT_SHA256 = `sha256:${"e".repeat(64)}`;
const RIGHTS_POLICY_DEFINITION_SHA256 = `sha256:${"7".repeat(64)}`;
const NOW = new Date("2026-07-13T10:04:00.000Z");
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000101";

function fixture(providerKind: FoundryProviderKind = "runpod") {
  const remote = providerKind !== "local_cpu" && providerKind !== "local_cuda";
  const manifest = FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "project-001",
    createdAt: "2026-07-13T09:58:00.000Z",
    createdBy: "intake@example.test",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Read-only source",
      locationRedacted: "FOUNDRY_SOURCE_ROOT",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [{
      id: "venue-control",
      kind: "venue_control",
      units: "meters",
      handedness: "right",
      upAxis: "z",
      authority: "measured",
      provenanceAssetIds: ["source-001"],
      crs: null,
    }],
    transforms: [],
    assets: [{
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
    }],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
  const manifestSha256 = computeFoundryIngestManifestSha256(manifest);
  const intakeAdmissionPayload = {
    schemaVersion: "omnitwin.foundry.intake-admission-result.v0" as const,
    receiptSha256: INTAKE_RECEIPT_SHA256,
    reviewSha256: INTAKE_REVIEW_SHA256,
    manifestSha256,
    manifest,
    exclusions: [],
    authority: "none" as const,
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  };
  const intakeAdmissionResult = FoundryIntakeAdmissionResultV0Schema.parse({
    ...intakeAdmissionPayload,
    resultSha256: computeFoundryIntakeAdmissionResultSha256(
      intakeAdmissionPayload,
    ),
  });
  const stagingPayload = {
    schemaVersion: FOUNDRY_INTAKE_STAGING_INDEX_V0,
    receiptSha256: INTAKE_RECEIPT_SHA256,
    reviewSha256: INTAKE_REVIEW_SHA256,
    resultSha256: intakeAdmissionResult.resultSha256,
    manifestSha256,
    stagedAssetCount: 1,
    indexedFileCount: 6,
    totalBytes: 1_005,
    files: [
      { path: "evidence/admission-result.json", role: "admission_result", sizeBytes: 1, sha256: "1".repeat(64) },
      { path: "evidence/admission-review.json", role: "admission_review", sizeBytes: 1, sha256: "2".repeat(64) },
      { path: "evidence/exclusions.json", role: "exclusion_ledger", sizeBytes: 1, sha256: "3".repeat(64) },
      { path: "evidence/intake-receipt.json", role: "intake_receipt", sizeBytes: 1, sha256: "4".repeat(64) },
      { path: "manifest/foundry-ingest-manifest-v0.json", role: "ingest_manifest", sizeBytes: 1, sha256: "5".repeat(64) },
      { path: "source/source.e57", role: "staged_source", sizeBytes: 1_000, sha256: "f".repeat(64) },
    ],
    authority: "none" as const,
    capabilities: {
      localStaging: "completed_verified" as const,
      jobPlanning: "not_authorized" as const,
      execution: "not_authorized" as const,
      modelTraining: "not_authorized" as const,
      signing: "not_authorized" as const,
      publication: "not_authorized" as const,
      promotion: "not_authorized" as const,
    },
  };
  const intakeStagingIndex = FoundryIntakeStagingIndexV0Schema.parse({
    ...stagingPayload,
    stagingSha256: domainSeparatedSha256(
      "VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0",
      toCanonicalJson(stagingPayload),
    ),
  });
  const intakeStagingIndexSha256 = `sha256:${intakeStagingIndex.stagingSha256}`;
  const job = FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "job-001",
    projectId: "project-001",
    ingestManifestSha256: manifestSha256,
    executionIntent: "execute",
    providerKind,
    providerAdapterId: "foundry-runner",
    stages: [{
      id: "inspect",
      kind: "inspect",
      dependsOn: [],
      containerImage: `ghcr.io/omnitwin/inspect@sha256:${"1".repeat(64)}`,
      command: ["foundry-inspect", "--input", "/input"],
      inputAssetIds: ["source-001"],
      outputNames: ["inspection"],
      rightsPurposes: ["commercial_internal_use"],
      cpuCores: 4,
      ramGiB: 16,
      gpuCount: 0,
      minimumGpuVramGiB: 0,
      scratchGiB: 20,
      networkAccess: remote ? "object_storage_only" : "none",
      checkpoint: "stage_boundary",
      resumable: true,
    }],
    objectStorageProfile: remote ? "foundry-private" : null,
    sourceMountMode: "read_only",
    outputPrefix: "foundry/job-001",
    estimatedCostUsd: remote ? 1 : 0,
    budgetCapUsd: remote ? 3.5 : 0.000002,
    killSwitchEnabled: true,
    computeApprovalId: remote ? "approval-001" : null,
    createdAt: "2026-07-13T09:59:00.000Z",
  });
  const jobSha256 = computeFoundryJobSpecSha256(job);
  const policy = FoundryExecutionPolicyV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_POLICY_V0,
    policyId: "policy-001",
    maximumAttempts: 1,
    deterministicRetryDelaySeconds: [],
    maximumWallClockSeconds: 1_000,
    orchestrationOverheadSeconds: 30,
    workerSelfDeadlineSeconds: 1_100,
    providerMaximumExecutionTtlSeconds: 1_200,
    dispatchWindowTtlSeconds: 600,
    leaseTtlSeconds: 120,
    heartbeatIntervalSeconds: 30,
    observationIntervalSeconds: 20,
    checkpointIntervalSeconds: 300,
    cancelGracePeriodSeconds: 30,
    terminationGracePeriodSeconds: 30,
    terminationConfirmationTimeoutSeconds: 60,
    pricingSnapshotMaximumAgeSeconds: 600,
    costObservationMaximumAgeSeconds: 60,
    executionConfirmationTtlSeconds: 300,
    computeApprovalTtlSeconds: 300,
    costWarningMicroUsd: remote ? "2000000" : "1",
    costHardStopMicroUsd: remote ? "3000000" : "2",
    terminationReserveMicroUsd: remote ? "500000" : "0",
    absoluteCostCapMicroUsd: remote ? "3500000" : "2",
  });
  const workerProfile = FoundryTrustedWorkerProfileV0Schema.parse({
    schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
    profileId: "inspect-worker",
    profileVersion: "v1",
    operationClass: "read_only_inspection",
    containerImage: job.stages[0]?.containerImage,
    command: job.stages[0]?.command,
    networkAccess: job.stages[0]?.networkAccess,
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
    providerKind,
    providerAdapterId: job.providerAdapterId,
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    accountProjectAlias: "foundry-private",
    region: remote ? "eu-west-1" : "local",
    dataResidency: "gb",
    observedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
    capacityClasses: [{
      id: remote ? "cpu-remote-4" : "local-cpu-4",
      cpuCores: 4,
      ramGiB: 16,
      gpuCount: 0,
      perGpuVramGiB: 0,
      scratchGiB: 20,
    }],
  });
  const deploymentSha256 = computeFoundryProviderDeploymentEvidenceSha256(
    deployment,
  );
  const plan = FoundryProviderPlanEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
    executionIntent: "execute",
    authority: "none",
    planId: "plan-001",
    jobId: job.id,
    jobSpecSha256: jobSha256,
    reviewedIngestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: intakeAdmissionResult.resultSha256,
    intakeStagingIndexSha256,
    providerKind,
    providerAdapterId: job.providerAdapterId,
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingBasis: remote ? "metered_estimate" : "fixed_quote",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotObservedAt: "2026-07-13T10:00:00.000Z",
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    plannedAt: "2026-07-13T10:01:00.000Z",
    estimatedCostMicroUsd: remote ? "1000000" : "0",
    stages: [{
      stageId: "inspect",
      capacityClass: remote ? "cpu-remote-4" : "local-cpu-4",
      workerProfileSha256,
      estimatedCostMicroUsd: remote ? "1000000" : "0",
      maximumRuntimeSeconds: 900,
    }],
  });
  const envelope = FoundryExecutionEnvelopeV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_V0,
    executionIntent: "execute",
    authority: "none",
    envelopeId: "envelope-001",
    jobId: job.id,
    projectId: job.projectId,
    jobSpecSha256: jobSha256,
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(plan),
    reviewedIngestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: intakeAdmissionResult.resultSha256,
    intakeStagingIndexSha256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(policy),
    computeApprovalId: job.computeApprovalId,
    providerKind,
    providerAdapterId: job.providerAdapterId,
    providerAdapterVersion: plan.providerAdapterVersion,
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotExpiresAt: plan.pricingSnapshotExpiresAt,
    createdAt: "2026-07-13T10:02:00.000Z",
    dispatchDeadline: "2026-07-13T10:10:00.000Z",
  });
  const envelopeSha256 = computeFoundryExecutionEnvelopeSha256(envelope);
  const confirmation = FoundryExecutionEnvelopeConfirmationV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
    confirmationId: "confirmation-001",
    executionEnvelopeSha256: envelopeSha256,
    jobSpecSha256: jobSha256,
    jobId: job.id,
    confirmedBy: "operator@example.test",
    confirmedAt: "2026-07-13T10:03:00.000Z",
    expiresAt: "2026-07-13T10:08:00.000Z",
  });
  const approval = remote
    ? FoundryExecutionEnvelopeComputeApprovalV0Schema.parse({
      schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
      approvalId: "approval-001",
      executionEnvelopeSha256: envelopeSha256,
      jobSpecSha256: jobSha256,
      jobId: job.id,
      projectId: job.projectId,
      providerKind,
      providerAdapterId: job.providerAdapterId,
      providerAdapterVersion: plan.providerAdapterVersion,
      providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
      providerDeploymentSha256: deploymentSha256,
      maximumCostMicroUsd: policy.absoluteCostCapMicroUsd,
      approvedBy: "budget@example.test",
      approvedAt: "2026-07-13T10:03:00.000Z",
      expiresAt: "2026-07-13T10:08:00.000Z",
    })
    : null;
  const rightsPolicy = FoundryRightsPolicyDefinitionV0Schema.parse({
    schemaVersion: FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
    policyVersion: "rights-policy-001",
    policyDefinitionSha256: RIGHTS_POLICY_DEFINITION_SHA256,
    generation: 1,
    effectiveAt: "2026-07-13T09:00:00.000Z",
    revokedAt: null,
    maximumApprovalTtlSeconds: 3_600,
  });
  const rights = FoundryRightsApprovalSchema.parse({
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    ingestManifestSha256: manifestSha256,
    policyVersion: rightsPolicy.policyVersion,
    policyDefinitionSha256: rightsPolicy.policyDefinitionSha256,
    policyGeneration: rightsPolicy.generation,
    decision: "allowed",
    decidedBy: "rights@example.test",
    decidedAt: "2026-07-13T10:03:00.000Z",
    expiresAt: "2026-07-13T10:20:00.000Z",
  });
  const evidence: FoundryExecutionAdmissionEvidence = {
    jobId: job.id,
    jobSpec: { sha256: jobSha256, value: job },
    ingestManifest: { sha256: manifestSha256, value: manifest },
    intakeAdmissionResult: {
      sha256: intakeAdmissionResult.resultSha256,
      value: intakeAdmissionResult,
    },
    intakeStagingIndex: {
      sha256: intakeStagingIndexSha256,
      value: intakeStagingIndex,
    },
    executionEnvelopeId: envelope.envelopeId,
    executionEnvelope: { sha256: envelopeSha256, value: envelope },
    executionPolicy: {
      sha256: computeFoundryExecutionPolicySha256(policy),
      value: policy,
    },
    providerPlanEvidence: {
      sha256: computeFoundryProviderPlanEvidenceSha256(plan),
      value: plan,
    },
    providerDeploymentEvidence: {
      sha256: deploymentSha256,
      value: deployment,
    },
    trustedWorkerProfiles: [{
      sha256: workerProfileSha256,
      value: workerProfile,
    }],
    rightsApprovalId: "rights-001",
    rightsApproval: {
      sha256: computeFoundryRightsApprovalEvidenceSha256(rights),
      value: rights,
    },
    activeRightsPolicy: {
      sha256: computeFoundryRightsPolicyEvidenceSha256(rightsPolicy),
      value: rightsPolicy,
    },
    confirmationId: confirmation.confirmationId,
    confirmation: {
      sha256: computeFoundryExecutionConfirmationEvidenceSha256(confirmation),
      value: confirmation,
    },
    computeApprovalId: approval?.approvalId ?? null,
    computeApproval: approval === null
      ? null
      : {
        sha256: computeFoundryExecutionComputeApprovalEvidenceSha256(approval),
        value: approval,
      },
  };
  return {
    manifest,
    intakeAdmissionResult,
    intakeStagingIndex,
    job,
    policy,
    workerProfile,
    deployment,
    plan,
    envelope,
    confirmation,
    approval,
    rightsPolicy,
    rights,
    evidence,
  };
}

function request(computeApprovalId: string | null = "approval-001"):
FoundryExecutionAdmissionRequestV0 {
  return {
    schemaVersion: FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0,
    jobId: "job-001",
    executionEnvelopeId: "envelope-001",
    rightsApprovalId: "rights-001",
    confirmationId: "confirmation-001",
    computeApprovalId,
    idempotencyKey: "admit-001",
  };
}

interface HarnessOptions {
  readonly evidence?: FoundryExecutionAdmissionEvidence | null;
  readonly existing?: FoundryAdmittedExecution | null;
  readonly killSwitch?: { readonly id: string; readonly generation: number } | null;
  readonly now?: Date;
  readonly insertError?: Error;
}

function harness(options: HarnessOptions): {
  readonly store: FoundryExecutionAdmissionStore;
  readonly inserted: ReturnType<typeof vi.fn>;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const inserted = vi.fn((input: FoundryExecutionAdmissionInsert) => {
    if (options.insertError !== undefined) throw options.insertError;
    return {
      executionId: "execution-db-001",
      jobId: input.jobId,
      executionEnvelopeId: input.executionEnvelopeId,
      executionEnvelopeSha256: input.executionEnvelopeSha256,
      state: input.state,
      admittedByUserId: input.admittedByUserId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      admittedAt: options.now ?? NOW,
    } satisfies FoundryAdmittedExecution;
  });
  const locked: LockedFoundryExecutionAdmissionStore = {
    findIdempotentAdmission: () => {
      calls.push("idempotency");
      return Promise.resolve(options.existing ?? null);
    },
    currentDatabaseTime: () => {
      calls.push("clock");
      return Promise.resolve(options.now ?? NOW);
    },
    loadTrustedEvidence: () => {
      calls.push("evidence");
      return Promise.resolve(options.evidence === undefined ? fixture().evidence : options.evidence);
    },
    findActiveKillSwitch: () => {
      calls.push("kill-switch");
      return Promise.resolve(options.killSwitch ?? null);
    },
    insertAdmission: (input) => {
      calls.push("insert");
      return Promise.resolve(inserted(input));
    },
  };
  return {
    store: {
      withAdmissionLock: async (_jobId, _envelopeId, operation) => {
        calls.push("lock");
        return operation(locked);
      },
    },
    inserted,
    calls,
  };
}

describe("Foundry durable execution admission", () => {
  it("validates every exact evidence subject before recording an inert execution", async () => {
    const current = fixture();
    const test = harness({ evidence: current.evidence });
    const result = await admitFoundryExecution(test.store, request(), ADMIN_USER_ID);

    expect(result).toMatchObject({
      jobId: current.job.id,
      executionEnvelopeId: current.envelope.envelopeId,
      state: FOUNDRY_EXECUTION_ADMISSION_STATE,
    });
    expect(test.calls).toEqual([
      "lock",
      "idempotency",
      "clock",
      "evidence",
      "kill-switch",
      "insert",
    ]);
    expect(test.inserted).toHaveBeenCalledTimes(1);
    expect(test.inserted.mock.calls[0]?.[0]).toMatchObject({
      state: "admitted_awaiting_executor",
      reservedCostMicroUsd: current.policy.absoluteCostCapMicroUsd,
      confirmationId: current.confirmation.confirmationId,
      providerAdapterVersion: current.envelope.providerAdapterVersion,
      intakeAdmissionResultSha256:
        current.intakeAdmissionResult.resultSha256,
      intakeStagingIndexSha256:
        `sha256:${current.intakeStagingIndex.stagingSha256}`,
      providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
      providerDeploymentSha256:
        computeFoundryProviderDeploymentEvidenceSha256(current.deployment),
      rightsPolicyEvidenceSha256:
        computeFoundryRightsPolicyEvidenceSha256(current.rightsPolicy),
      trustedWorkerProfileSha256s: [
        computeFoundryTrustedWorkerProfileSha256(current.workerProfile),
      ],
    });
    const inserted = test.inserted.mock.calls[0]?.[0] as
      | FoundryExecutionAdmissionInsert
      | undefined;
    expect(inserted).toBeDefined();
    if (inserted === undefined) throw new Error("missing admission insert");
    expect(inserted.executionSubject).toMatchObject({
      subjectId: current.envelope.envelopeId,
      projectId: current.envelope.projectId,
      rightsPolicyEvidenceSha256:
        computeFoundryRightsPolicyEvidenceSha256(current.rightsPolicy),
      maximumAttempts: 1,
      checkpointContract: null,
    });
    expect(inserted.executionSubjectSha256).toBe(
      computeFoundryExecutionSubjectSha256(inserted.executionSubject),
    );
    expect(test.inserted.mock.calls[0]?.[0]).not.toHaveProperty("providerCommand");
  });

  it("returns an exact idempotent replay before reading the clock or evidence", async () => {
    const first = harness({ evidence: fixture().evidence });
    const admitted = await admitFoundryExecution(first.store, request(), ADMIN_USER_ID);
    const replay = harness({ existing: admitted, evidence: null });

    await expect(admitFoundryExecution(replay.store, request(), ADMIN_USER_ID))
      .resolves.toEqual(admitted);
    expect(replay.calls).toEqual(["lock", "idempotency"]);
    expect(replay.inserted).not.toHaveBeenCalled();
  });

  it("rejects reuse of an actor idempotency key for different request material", async () => {
    const first = harness({ evidence: fixture().evidence });
    const admitted = await admitFoundryExecution(first.store, request(), ADMIN_USER_ID);
    const replay = harness({ existing: admitted });

    await expect(admitFoundryExecution(
      replay.store,
      { ...request(), confirmationId: "confirmation-002" },
      ADMIN_USER_ID,
    )).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(replay.calls).toEqual(["lock", "idempotency"]);
  });

  it("rejects persisted evidence whose bytes no longer match its digest", async () => {
    const current = fixture();
    const evidence = {
      ...current.evidence,
      jobSpec: { ...current.evidence.jobSpec, sha256: `sha256:${"0".repeat(64)}` },
    };
    const test = harness({ evidence });

    await expect(admitFoundryExecution(test.store, request(), ADMIN_USER_ID))
      .rejects.toMatchObject({ code: "TRUSTED_EVIDENCE_INTEGRITY_FAILURE" });
    expect(test.inserted).not.toHaveBeenCalled();
  });

  it("rejects a separately valid staging index that no longer binds the loaded admission result", async () => {
    const current = fixture();
    const {
      stagingSha256: _stagingSha256,
      ...stagingPayload
    } = current.intakeStagingIndex;
    const driftedPayload = {
      ...stagingPayload,
      resultSha256: `sha256:${"0".repeat(64)}`,
    };
    const driftedIndex = FoundryIntakeStagingIndexV0Schema.parse({
      ...driftedPayload,
      stagingSha256: domainSeparatedSha256(
        "VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0",
        toCanonicalJson(driftedPayload),
      ),
    });
    const evidence = {
      ...current.evidence,
      intakeStagingIndex: {
        sha256: `sha256:${driftedIndex.stagingSha256}`,
        value: driftedIndex,
      },
    };
    const test = harness({ evidence });

    await expect(admitFoundryExecution(test.store, request(), ADMIN_USER_ID))
      .rejects.toMatchObject({ code: "TRUSTED_EVIDENCE_INTEGRITY_FAILURE" });
    expect(test.inserted).not.toHaveBeenCalled();
  });

  it("rejects a revoked or generation-mismatched active rights policy", async () => {
    const current = fixture();
    for (const policyPatch of [
      { revokedAt: "2026-07-13T10:03:30.000Z" },
      { generation: 2 },
    ]) {
      const policy = FoundryRightsPolicyDefinitionV0Schema.parse({
        ...current.rightsPolicy,
        ...policyPatch,
      });
      const evidence = {
        ...current.evidence,
        activeRightsPolicy: {
          sha256: computeFoundryRightsPolicyEvidenceSha256(policy),
          value: policy,
        },
      };
      const test = harness({ evidence });
      await expect(
        admitFoundryExecution(test.store, request(), ADMIN_USER_ID),
      ).rejects.toMatchObject({ code: "RIGHTS_APPROVAL_REJECTED" });
      expect(test.inserted).not.toHaveBeenCalled();
    }
  });

  it("rejects an expired rights decision without consuming the confirmation", async () => {
    const current = fixture();
    const rights = FoundryRightsApprovalSchema.parse({
      ...current.rights,
      expiresAt: "2026-07-13T10:03:30.000Z",
    });
    const evidence = {
      ...current.evidence,
      rightsApproval: {
        sha256: computeFoundryRightsApprovalEvidenceSha256(rights),
        value: rights,
      },
    };
    const test = harness({ evidence });

    await expect(admitFoundryExecution(test.store, request(), ADMIN_USER_ID))
      .rejects.toMatchObject({ code: "RIGHTS_APPROVAL_REJECTED" });
    expect(test.inserted).not.toHaveBeenCalled();
  });

  it("rejects a kill switch in the admission transaction", async () => {
    const test = harness({
      evidence: fixture().evidence,
      killSwitch: { id: "global-stop", generation: 4 },
    });

    await expect(admitFoundryExecution(test.store, request(), ADMIN_USER_ID))
      .rejects.toMatchObject({ code: "KILL_SWITCH_ACTIVE" });
    expect(test.inserted).not.toHaveBeenCalled();
  });

  it("admits bounded non-training local work without manufacturing a compute approval", async () => {
    const current = fixture("local_cpu");
    const test = harness({ evidence: current.evidence });

    const result = await admitFoundryExecution(
      test.store,
      request(null),
      ADMIN_USER_ID,
    );
    expect(result.state).toBe("admitted_awaiting_executor");
    expect(test.inserted.mock.calls[0]?.[0]).toMatchObject({
      providerKind: "local_cpu",
      computeApprovalId: null,
      computeApprovalSha256: null,
    });
  });

  it("propagates an atomic insert failure instead of claiming admission", async () => {
    const test = harness({
      evidence: fixture().evidence,
      insertError: new Error("confirmation already consumed"),
    });

    await expect(admitFoundryExecution(test.store, request(), ADMIN_USER_ID))
      .rejects.toThrow("confirmation already consumed");
    expect(test.inserted).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid requests before opening a transaction", async () => {
    const withAdmissionLock = vi.fn();
    await expect(admitFoundryExecution(
      { withAdmissionLock } as FoundryExecutionAdmissionStore,
      { ...request(), unknown: true },
      ADMIN_USER_ID,
    )).rejects.toBeInstanceOf(FoundryExecutionAdmissionError);
    expect(withAdmissionLock).not.toHaveBeenCalled();
    await expect(admitFoundryExecution(
      { withAdmissionLock } as FoundryExecutionAdmissionStore,
      request(),
      "admin\u202E-001",
    )).rejects.toBeInstanceOf(FoundryExecutionAdmissionError);
    expect(withAdmissionLock).not.toHaveBeenCalled();
  });
});
