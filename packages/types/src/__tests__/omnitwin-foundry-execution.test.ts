import { describe, expect, it } from "vitest";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "../canonical-layout-snapshot.js";
import {
  FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
  FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
  FOUNDRY_EXECUTION_ENVELOPE_V0,
  FOUNDRY_EXECUTION_POLICY_V0,
  FOUNDRY_MAX_MICRO_USD,
  FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
  FOUNDRY_PROVIDER_PLAN_EVIDENCE_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryMicroUsdSchema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryExecutionEnvelopeComputeApprovalSha256,
  computeFoundryExecutionEnvelopeConfirmationSha256,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
  validateFoundryExecutionAuthorizations,
  validateFoundryExecutionEnvelopeBindings,
  type FoundryExecutionEnvelopeComputeApprovalV0,
  type FoundryExecutionEnvelopeConfirmationV0,
  type FoundryExecutionEnvelopeV0,
  type FoundryExecutionPolicyV0,
  type FoundryProviderPlanEvidenceV0,
  type FoundryProviderDeploymentEvidenceV0,
  type FoundryTrustedWorkerProfileV0,
} from "../omnitwin-foundry-execution.js";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  type FoundryIngestManifestV0,
  type FoundryJobSpecV0,
  type FoundryProviderKind,
} from "../omnitwin-foundry.js";

const INTAKE_ADMISSION_SHA256 = `sha256:${"a".repeat(64)}`;
const INTAKE_STAGING_SHA256 = `sha256:${"b".repeat(64)}`;
const PRICING_SHA256 = `sha256:${"c".repeat(64)}`;
const OTHER_SHA256 = `sha256:${"d".repeat(64)}`;
const ADAPTER_ARTIFACT_SHA256 = `sha256:${"e".repeat(64)}`;

interface Fixture {
  readonly manifest: FoundryIngestManifestV0;
  readonly job: FoundryJobSpecV0;
  readonly policy: FoundryExecutionPolicyV0;
  readonly workerProfiles: readonly FoundryTrustedWorkerProfileV0[];
  readonly deployment: FoundryProviderDeploymentEvidenceV0;
  readonly plan: FoundryProviderPlanEvidenceV0;
  readonly envelope: FoundryExecutionEnvelopeV0;
  readonly confirmation: FoundryExecutionEnvelopeConfirmationV0;
  readonly approval: FoundryExecutionEnvelopeComputeApprovalV0;
}

function fixture(providerKind: FoundryProviderKind = "runpod"): Fixture {
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
    providerKind,
    providerAdapterId: "foundry-runner",
    stages: [
      {
        id: "geometry",
        kind: "geometry",
        dependsOn: [],
        containerImage: `ghcr.io/omnitwin/geometry@sha256:${"1".repeat(64)}`,
        command: ["foundry-geometry", "--input", "/input"],
        inputAssetIds: ["source-001"],
        outputNames: ["geometry"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 0,
        minimumGpuVramGiB: 0,
        scratchGiB: 100,
        networkAccess: "object_storage_only",
        checkpoint: "stage_boundary",
        resumable: true,
      },
      {
        id: "qa",
        kind: "qa",
        dependsOn: ["geometry"],
        containerImage: `ghcr.io/omnitwin/qa@sha256:${"2".repeat(64)}`,
        command: ["foundry-qa", "--input", "/input/geometry"],
        inputAssetIds: ["source-001"],
        outputNames: ["qa-report"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 8,
        ramGiB: 16,
        gpuCount: 0,
        minimumGpuVramGiB: 0,
        scratchGiB: 50,
        networkAccess: "object_storage_only",
        checkpoint: "stage_boundary",
        resumable: true,
      },
    ],
    objectStorageProfile: "foundry-private",
    sourceMountMode: "read_only",
    outputPrefix: "foundry/job-001",
    estimatedCostUsd: 1,
    budgetCapUsd: 3.5,
    killSwitchEnabled: true,
    computeApprovalId:
      providerKind === "local_cpu" || providerKind === "local_cuda"
        ? null
        : "approval-001",
    createdAt: "2026-07-13T09:59:00.000Z",
  });
  const jobSha256 = computeFoundryJobSpecSha256(job);
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
      containerImage: job.stages[0]?.containerImage,
      command: job.stages[0]?.command,
      networkAccess: job.stages[0]?.networkAccess,
      localExecutionAllowed: true,
      reviewedBy: "security@example.test",
      reviewedAt: "2026-07-13T10:00:00.000Z",
      expiresAt: "2026-07-13T11:00:00.000Z",
    }),
    FoundryTrustedWorkerProfileV0Schema.parse({
      schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
      profileId: "qa-worker",
      profileVersion: "v1",
      operationClass: "read_only_inspection",
      containerImage: job.stages[1]?.containerImage,
      command: job.stages[1]?.command,
      networkAccess: job.stages[1]?.networkAccess,
      localExecutionAllowed: true,
      reviewedBy: "security@example.test",
      reviewedAt: "2026-07-13T10:00:00.000Z",
      expiresAt: "2026-07-13T11:00:00.000Z",
    }),
  ] as const;
  const deployment = FoundryProviderDeploymentEvidenceV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_DEPLOYMENT_EVIDENCE_V0,
    deploymentId: "deployment-001",
    providerKind,
    providerAdapterId: job.providerAdapterId,
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    accountProjectAlias: "foundry-private",
    region: providerKind.startsWith("local_") ? "local" : "eu-west-1",
    dataResidency: "gb",
    observedAt: "2026-07-13T10:00:00.000Z",
    expiresAt: "2026-07-13T11:00:00.000Z",
    capacityClasses: [
      {
        id: "cpu-8",
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 0,
        perGpuVramGiB: 0,
        scratchGiB: 100,
      },
      {
        id: "gpu-l40s-48gb",
        cpuCores: 16,
        ramGiB: 64,
        gpuCount: 1,
        perGpuVramGiB: 48,
        scratchGiB: 200,
      },
    ],
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
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    providerKind,
    providerAdapterId: job.providerAdapterId,
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingBasis: "metered_estimate",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotObservedAt: "2026-07-13T10:00:00.000Z",
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    plannedAt: "2026-07-13T10:01:00.000Z",
    estimatedCostMicroUsd: "1000000",
    stages: [
      {
        stageId: "geometry",
        capacityClass: "gpu-l40s-48gb",
        workerProfileSha256: computeFoundryTrustedWorkerProfileSha256(
          workerProfiles[0],
        ),
        estimatedCostMicroUsd: "400000",
        maximumRuntimeSeconds: 1_800,
      },
      {
        stageId: "qa",
        capacityClass: "cpu-8",
        workerProfileSha256: computeFoundryTrustedWorkerProfileSha256(
          workerProfiles[1],
        ),
        estimatedCostMicroUsd: "600000",
        maximumRuntimeSeconds: 900,
      },
    ],
  });
  const envelope = FoundryExecutionEnvelopeV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_V0,
    executionIntent: "execute",
    authority: "none",
    envelopeId: "envelope-001",
    jobId: plan.jobId,
    projectId: job.projectId,
    jobSpecSha256: jobSha256,
    providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(plan),
    reviewedIngestManifestSha256: manifestSha256,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    executionPolicySha256: computeFoundryExecutionPolicySha256(policy),
    computeApprovalId: job.computeApprovalId,
    providerKind,
    providerAdapterId: plan.providerAdapterId,
    providerAdapterVersion: plan.providerAdapterVersion,
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    pricingCurrency: "USD",
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotExpiresAt: plan.pricingSnapshotExpiresAt,
    createdAt: "2026-07-13T10:02:00.000Z",
    dispatchDeadline: "2026-07-13T10:20:00.000Z",
  });
  const envelopeSha256 = computeFoundryExecutionEnvelopeSha256(envelope);
  const confirmation =
    FoundryExecutionEnvelopeConfirmationV0Schema.parse({
      schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_CONFIRMATION_V0,
      confirmationId: "confirmation-001",
      executionEnvelopeSha256: envelopeSha256,
      jobSpecSha256: jobSha256,
      jobId: plan.jobId,
      confirmedBy: "operator@example.test",
      confirmedAt: "2026-07-13T10:03:00.000Z",
      expiresAt: "2026-07-13T10:10:00.000Z",
    });
  const approval = FoundryExecutionEnvelopeComputeApprovalV0Schema.parse({
    schemaVersion: FOUNDRY_EXECUTION_ENVELOPE_COMPUTE_APPROVAL_V0,
    approvalId: "approval-001",
    executionEnvelopeSha256: envelopeSha256,
    jobSpecSha256: jobSha256,
    jobId: plan.jobId,
    projectId: envelope.projectId,
    providerKind,
    providerAdapterId: plan.providerAdapterId,
    providerAdapterVersion: plan.providerAdapterVersion,
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: deploymentSha256,
    maximumCostMicroUsd: policy.absoluteCostCapMicroUsd,
    approvedBy: "budget-owner@example.test",
    approvedAt: "2026-07-13T10:03:00.000Z",
    expiresAt: "2026-07-13T10:10:00.000Z",
  });
  return {
    manifest,
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

function bindingContext(current: Fixture): {
  jobSpec: FoundryJobSpecV0;
  ingestManifest: FoundryIngestManifestV0;
  intakeAdmissionResultSha256: string;
  intakeStagingIndexSha256: string;
  executionPolicy: FoundryExecutionPolicyV0;
  providerPlanEvidence: FoundryProviderPlanEvidenceV0;
  trustedWorkerProfiles: readonly FoundryTrustedWorkerProfileV0[];
  providerDeploymentEvidence: FoundryProviderDeploymentEvidenceV0;
} {
  return {
    jobSpec: current.job,
    ingestManifest: current.manifest,
    intakeAdmissionResultSha256: INTAKE_ADMISSION_SHA256,
    intakeStagingIndexSha256: INTAKE_STAGING_SHA256,
    executionPolicy: current.policy,
    providerPlanEvidence: current.plan,
    trustedWorkerProfiles: current.workerProfiles,
    providerDeploymentEvidence: current.deployment,
  };
}

describe("FoundryMicroUsdSchema", () => {
  it("accepts exact canonical integer strings through the signed BIGINT ceiling", () => {
    expect(FoundryMicroUsdSchema.parse("0")).toBe("0");
    expect(FoundryMicroUsdSchema.parse("1")).toBe("1");
    expect(FoundryMicroUsdSchema.parse(FOUNDRY_MAX_MICRO_USD)).toBe(
      FOUNDRY_MAX_MICRO_USD,
    );
  });

  it.each([
    "",
    "00",
    "01",
    "+1",
    "-1",
    "1.0",
    "1e6",
    " 1",
    "1 ",
    "9223372036854775808",
    "99999999999999999999",
  ])("rejects non-canonical or out-of-range micro-USD %j", (value) => {
    expect(FoundryMicroUsdSchema.safeParse(value).success).toBe(false);
  });

  it("rejects JSON numbers so precision cannot be lost before validation", () => {
    expect(FoundryMicroUsdSchema.safeParse(1_000_000).success).toBe(false);
  });
});

describe("FoundryExecutionPolicyV0Schema", () => {
  it("pins V0 to one attempt, no retries, and an explicit bounded control policy", () => {
    const { policy } = fixture();
    expect(policy.maximumAttempts).toBe(1);
    expect(policy.deterministicRetryDelaySeconds).toEqual([]);
    expect(FoundryExecutionPolicyV0Schema.safeParse(policy).success).toBe(true);
  });

  it("rejects retries, unknown authority-bearing fields, and non-UTC timestamps by construction", () => {
    const { policy } = fixture();
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({
        ...policy,
        maximumAttempts: 2,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({
        ...policy,
        deterministicRetryDelaySeconds: [10],
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({
        ...policy,
        providerCredentials: "secret",
      }).success,
    ).toBe(false);
  });

  it("requires warning < hard-stop and hard-stop + reserve <= absolute cap", () => {
    const { policy } = fixture();
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({
        ...policy,
        costWarningMicroUsd: policy.costHardStopMicroUsd,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({
        ...policy,
        absoluteCostCapMicroUsd: "3499999",
      }).success,
    ).toBe(false);
  });

  it.each([
    { heartbeatIntervalSeconds: 120 },
    { observationIntervalSeconds: 120 },
    { costObservationMaximumAgeSeconds: 19 },
    { checkpointIntervalSeconds: 3_601 },
    { workerSelfDeadlineSeconds: 3_779 },
    { providerMaximumExecutionTtlSeconds: 4_019 },
    { terminationConfirmationTimeoutSeconds: 301 },
    { executionConfirmationTtlSeconds: 1_801 },
    { computeApprovalTtlSeconds: 1_801 },
  ])("rejects an incoherent watchdog policy %o", (patch) => {
    const { policy } = fixture();
    expect(
      FoundryExecutionPolicyV0Schema.safeParse({ ...policy, ...patch }).success,
    ).toBe(false);
  });

  it("hashes the exact strict policy with an explicit domain separator", () => {
    const { policy } = fixture();
    const canonical = CanonicalJsonValueSchema.parse(policy);
    const expected = `sha256:${sha256Hex(
      `${FOUNDRY_EXECUTION_POLICY_V0}\n${stableCanonicalJson(canonical)}`,
    )}`;
    expect(computeFoundryExecutionPolicySha256(policy)).toBe(expected);
    expect(
      computeFoundryExecutionPolicySha256({ ...policy, checkpointIntervalSeconds: null }),
    ).not.toBe(expected);
    expect(() =>
      computeFoundryExecutionPolicySha256({ ...policy, unreviewed: true }),
    ).toThrow();
  });
});

describe("FoundryProviderPlanEvidenceV0Schema", () => {
  it("accepts only typed planning evidence and hashes every stage fact", () => {
    const { plan } = fixture();
    const digest = computeFoundryProviderPlanEvidenceSha256(plan);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      computeFoundryProviderPlanEvidenceSha256({
        ...plan,
        stages: plan.stages.map((stage, index) =>
          index === 0 ? { ...stage, maximumRuntimeSeconds: 1_801 } : stage,
        ),
      }),
    ).not.toBe(digest);
  });

  it("rejects duplicate, unsorted, or arithmetically inconsistent stage evidence", () => {
    const { plan } = fixture();
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        stages: [...plan.stages].reverse(),
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        stages: [plan.stages[0], plan.stages[0]],
        estimatedCostMicroUsd: "800000",
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        estimatedCostMicroUsd: "1000001",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid pricing chronology, offsets, raw responses, and credentials", () => {
    const { plan } = fixture();
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        pricingSnapshotObservedAt: "2026-07-13T10:01:01.000Z",
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        pricingSnapshotExpiresAt: plan.plannedAt,
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        plannedAt: "2026-07-13T10:01:00+00:00",
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        rawProviderResponse: { token: "secret" },
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...plan,
        stages: [
          { ...plan.stages[0], credentials: "secret" },
          plan.stages[1],
        ],
      }).success,
    ).toBe(false);
  });
});

describe("FoundryExecutionEnvelopeV0Schema", () => {
  it("binds all execution subjects and hashes the exact envelope", () => {
    const { envelope } = fixture();
    const digest = computeFoundryExecutionEnvelopeSha256(envelope);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    for (const patch of [
      { jobSpecSha256: OTHER_SHA256 },
      { providerPlanSha256: OTHER_SHA256 },
      { reviewedIngestManifestSha256: OTHER_SHA256 },
      { executionPolicySha256: OTHER_SHA256 },
      { providerAdapterVersion: "1.2.4" },
      { pricingSnapshotSha256: OTHER_SHA256 },
      { dispatchDeadline: "2026-07-13T10:19:59.000Z" },
    ]) {
      expect(computeFoundryExecutionEnvelopeSha256({ ...envelope, ...patch })).not.toBe(
        digest,
      );
    }
  });

  it("rejects expired-at-creation windows, pricing overrun, offsets, and extra fields", () => {
    const { envelope } = fixture();
    expect(
      FoundryExecutionEnvelopeV0Schema.safeParse({
        ...envelope,
        dispatchDeadline: envelope.createdAt,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeV0Schema.safeParse({
        ...envelope,
        dispatchDeadline: "2026-07-13T11:00:00.001Z",
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeV0Schema.safeParse({
        ...envelope,
        createdAt: "2026-07-13T10:02:00+00:00",
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeV0Schema.safeParse({
        ...envelope,
        providerApiKey: "secret",
      }).success,
    ).toBe(false);
  });

  it("validates every duplicated field against exact policy and provider evidence", () => {
    const current = fixture();
    expect(
      validateFoundryExecutionEnvelopeBindings(
        current.envelope,
        bindingContext(current),
      ),
    ).toEqual({ valid: true });
  });

  it("derives digest, identity, provider, ingest, and stage facts from the exact JobSpec", () => {
    const current = fixture();
    expect(
      validateFoundryExecutionEnvelopeBindings(
        { ...current.envelope, jobId: "job-999" },
        bindingContext(current),
      ),
    ).toEqual({ valid: false, reason: "job_spec_identity_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        { ...current.envelope, projectId: "project-999" },
        bindingContext(current),
      ),
    ).toEqual({ valid: false, reason: "job_spec_identity_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        { ...current.envelope, providerAdapterId: "other-adapter" },
        bindingContext(current),
      ),
    ).toEqual({ valid: false, reason: "job_spec_identity_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        jobSpec: { ...current.job, budgetCapUsd: 3.6 },
      }),
    ).toEqual({ valid: false, reason: "job_spec_digest_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        ingestManifest: {
          ...current.manifest,
          createdBy: "other-operator@example.test",
        },
      }),
    ).toEqual({
      valid: false,
      reason: "reviewed_ingest_manifest_digest_mismatch",
    });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        jobSpec: {
          ...current.job,
          executionIntent: "plan_only",
          computeApprovalId: null,
        },
      }),
    ).toEqual({ valid: false, reason: "job_not_executable" });
  });

  it.each([
    ["jobSpecSha256", "job_spec_digest_mismatch"],
    ["reviewedIngestManifestSha256", "reviewed_ingest_manifest_digest_mismatch"],
    ["intakeAdmissionResultSha256", "provider_plan_subject_mismatch"],
    ["intakeStagingIndexSha256", "provider_plan_subject_mismatch"],
    ["executionPolicySha256", "execution_policy_digest_mismatch"],
    ["providerPlanSha256", "provider_plan_digest_mismatch"],
  ] as const)("fails closed on a changed %s", (field, reason) => {
    const current = fixture();
    expect(
      validateFoundryExecutionEnvelopeBindings(
        { ...current.envelope, [field]: OTHER_SHA256 },
        bindingContext(current),
      ),
    ).toEqual({ valid: false, reason });
  });

  it("detects provider, pricing, plan-subject, freshness, deadline, runtime, and cost drift", () => {
    const current = fixture();
    const firstStage = current.plan.stages[0];
    const secondStage = current.plan.stages[1];
    if (firstStage === undefined || secondStage === undefined) {
      throw new Error("Execution fixture must contain two provider-plan stages.");
    }
    const cases: readonly [
      FoundryExecutionEnvelopeV0,
      ReturnType<typeof bindingContext>,
      string,
    ][] = [
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            providerAdapterVersion: "2.0.0",
          },
        },
        "provider_binding_mismatch",
      ],
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            pricingSnapshotSha256: OTHER_SHA256,
          },
        },
        "pricing_binding_mismatch",
      ],
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            jobId: "job-002",
          },
        },
        "provider_plan_subject_mismatch",
      ],
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            pricingSnapshotObservedAt: "2026-07-13T09:51:59.000Z",
          },
        },
        "pricing_snapshot_too_old",
      ],
      [
        { ...current.envelope, dispatchDeadline: "2026-07-13T10:32:01.000Z" },
        bindingContext(current),
        "dispatch_window_exceeds_policy",
      ],
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            stages: current.plan.stages.map((stage, index) =>
              index === 0
                ? { ...stage, maximumRuntimeSeconds: 3_601 }
                : stage,
            ),
          },
        },
        "provider_critical_path_exceeds_policy",
      ],
      [
        current.envelope,
        {
          ...bindingContext(current),
          providerPlanEvidence: {
            ...current.plan,
            estimatedCostMicroUsd: "3000000",
            stages: [
              {
                ...firstStage,
                estimatedCostMicroUsd: "2400000",
              },
              secondStage,
            ],
          },
        },
        "provider_plan_estimate_mismatch",
      ],
    ];
    for (const [envelope, context, reason] of cases) {
      const reboundEnvelope = {
        ...envelope,
        providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(
          context.providerPlanEvidence,
        ),
      };
      expect(
        validateFoundryExecutionEnvelopeBindings(reboundEnvelope, context),
      ).toEqual({ valid: false, reason });
    }
  });

  it("requires the provider plan to cover the exact JobSpec stage-ID set", () => {
    const current = fixture();
    const incompletePlan = FoundryProviderPlanEvidenceV0Schema.parse({
      ...current.plan,
      estimatedCostMicroUsd: current.plan.stages[0]?.estimatedCostMicroUsd,
      stages: [current.plan.stages[0]],
    });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        {
          ...current.envelope,
          providerPlanSha256:
            computeFoundryProviderPlanEvidenceSha256(incompletePlan),
        },
        {
          ...bindingContext(current),
          providerPlanEvidence: incompletePlan,
        },
      ),
    ).toEqual({ valid: false, reason: "provider_plan_stage_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        jobSpec: {
          ...current.job,
          stages: [current.job.stages[0], current.job.stages[0]],
        },
      }),
    ).toEqual({ valid: false, reason: "invalid_execution_binding_input" });
  });

  it("rejects unused worker evidence and immutable adapter/deployment drift", () => {
    const current = fixture();
    const extraProfile = FoundryTrustedWorkerProfileV0Schema.parse({
      ...current.workerProfiles[0],
      profileId: "unused-worker",
      containerImage: `ghcr.io/omnitwin/unused@sha256:${"9".repeat(64)}`,
      command: ["unused-worker"],
    });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        trustedWorkerProfiles: [...current.workerProfiles, extraProfile],
      }),
    ).toEqual({ valid: false, reason: "worker_profile_subject_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        { ...current.envelope, providerAdapterArtifactSha256: OTHER_SHA256 },
        bindingContext(current),
      ),
    ).toEqual({ valid: false, reason: "provider_binding_mismatch" });
    expect(
      validateFoundryExecutionEnvelopeBindings(current.envelope, {
        ...bindingContext(current),
        providerDeploymentEvidence: {
          ...current.deployment,
          accountProjectAlias: "other-account",
        },
      }),
    ).toEqual({ valid: false, reason: "provider_deployment_mismatch" });
  });

  it("derives model-training rights from the trusted worker profile", () => {
    const current = fixture("local_cuda");
    const trainingProfile = FoundryTrustedWorkerProfileV0Schema.parse({
      ...current.workerProfiles[0],
      operationClass: "model_training",
      localExecutionAllowed: false,
    });
    const trainingProfileSha256 = computeFoundryTrustedWorkerProfileSha256(
      trainingProfile,
    );
    const plan = FoundryProviderPlanEvidenceV0Schema.parse({
      ...current.plan,
      stages: current.plan.stages.map((stage, index) =>
        index === 0
          ? { ...stage, workerProfileSha256: trainingProfileSha256 }
          : stage
      ),
    });
    const envelope = {
      ...current.envelope,
      providerPlanSha256: computeFoundryProviderPlanEvidenceSha256(plan),
    };
    expect(
      validateFoundryExecutionEnvelopeBindings(envelope, {
        ...bindingContext(current),
        providerPlanEvidence: plan,
        trustedWorkerProfiles: [trainingProfile, current.workerProfiles[1]],
      }),
    ).toEqual({ valid: false, reason: "worker_operation_rights_mismatch" });
  });

  it("rejects a plan created before the exact JobSpec and policy caps above its budget", () => {
    const current = fixture();
    const predatingPlan = FoundryProviderPlanEvidenceV0Schema.parse({
      ...current.plan,
      pricingSnapshotObservedAt: "2026-07-13T09:58:00.000Z",
      plannedAt: "2026-07-13T09:58:30.000Z",
    });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        {
          ...current.envelope,
          providerPlanSha256:
            computeFoundryProviderPlanEvidenceSha256(predatingPlan),
        },
        {
          ...bindingContext(current),
          providerPlanEvidence: predatingPlan,
        },
      ),
    ).toEqual({ valid: false, reason: "provider_plan_predates_job" });

    const overBudgetPolicy = FoundryExecutionPolicyV0Schema.parse({
      ...current.policy,
      absoluteCostCapMicroUsd: "3600000",
    });
    expect(
      validateFoundryExecutionEnvelopeBindings(
        {
          ...current.envelope,
          executionPolicySha256:
            computeFoundryExecutionPolicySha256(overBudgetPolicy),
        },
        {
          ...bindingContext(current),
          executionPolicy: overBudgetPolicy,
        },
      ),
    ).toEqual({ valid: false, reason: "execution_policy_exceeds_job_budget" });
  });

  it("marks plans and envelopes as execution candidates with no standalone authority", () => {
    const current = fixture();
    expect(current.plan).toMatchObject({
      executionIntent: "execute",
      authority: "none",
      pricingCurrency: "USD",
      pricingBasis: "metered_estimate",
    });
    expect(current.envelope).toMatchObject({
      executionIntent: "execute",
      authority: "none",
      pricingCurrency: "USD",
    });
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...current.plan,
        authority: "execute",
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeV0Schema.safeParse({
        ...current.envelope,
        pricingCurrency: "GBP",
      }).success,
    ).toBe(false);
    expect(
      FoundryProviderPlanEvidenceV0Schema.safeParse({
        ...current.plan,
        providerAdapterVersion: "latest",
      }).success,
    ).toBe(false);
  });
});

describe("execution-envelope authorizations", () => {
  it("uses the envelope digest—not the legacy job-only subject—for both grants", () => {
    const current = fixture();
    const subject = computeFoundryExecutionEnvelopeSha256(current.envelope);
    expect(current.confirmation.executionEnvelopeSha256).toBe(subject);
    expect(current.approval.executionEnvelopeSha256).toBe(subject);
    expect(
      computeFoundryExecutionEnvelopeConfirmationSha256(current.confirmation),
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      computeFoundryExecutionEnvelopeComputeApprovalSha256(current.approval),
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        current.approval,
        new Date("2026-07-13T10:05:00.000Z"),
      ),
    ).toEqual({ allowed: true });
  });

  it("keeps confirmation and approval payloads strict and credential-free", () => {
    const current = fixture();
    expect(
      FoundryExecutionEnvelopeConfirmationV0Schema.safeParse({
        ...current.confirmation,
        consumed: false,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeComputeApprovalV0Schema.safeParse({
        ...current.approval,
        providerCredentials: { token: "secret" },
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeConfirmationV0Schema.safeParse({
        ...current.confirmation,
        confirmedAt: current.confirmation.expiresAt,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeComputeApprovalV0Schema.safeParse({
        ...current.approval,
        approvedAt: current.approval.expiresAt,
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeConfirmationV0Schema.safeParse({
        ...current.confirmation,
        confirmedBy: " operator@example.test",
      }).success,
    ).toBe(false);
    expect(
      FoundryExecutionEnvelopeConfirmationV0Schema.safeParse({
        ...current.confirmation,
        confirmedBy: "operator\u202E@example.test",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["executionEnvelopeSha256", "operator_confirmation_subject_mismatch"],
    ["jobSpecSha256", "operator_confirmation_subject_mismatch"],
    ["jobId", "operator_confirmation_subject_mismatch"],
  ] as const)("rejects confirmation drift in %s", (field, reason) => {
    const current = fixture();
    const replacement = field === "jobId" ? "job-999" : OTHER_SHA256;
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        { ...current.confirmation, [field]: replacement },
        current.approval,
        new Date("2026-07-13T10:05:00.000Z"),
      ),
    ).toEqual({ allowed: false, reason });
  });

  it("rejects missing, mismatched, or underfunded remote compute approval", () => {
    const current = fixture();
    const now = new Date("2026-07-13T10:05:00.000Z");
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        null,
        now,
      ),
    ).toEqual({ allowed: false, reason: "compute_approval_required" });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        { ...current.approval, providerAdapterVersion: "2.0.0" },
        now,
      ),
    ).toEqual({ allowed: false, reason: "compute_approval_subject_mismatch" });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        { ...current.approval, maximumCostMicroUsd: "3499999" },
        now,
      ),
    ).toEqual({ allowed: false, reason: "compute_approval_below_absolute_cap" });
    for (const approvalPatch of [
      { approvalId: "approval-999" },
      { providerAdapterArtifactSha256: OTHER_SHA256 },
      { providerDeploymentSha256: OTHER_SHA256 },
    ]) {
      expect(
        validateFoundryExecutionAuthorizations(
          current.envelope,
          current.job,
          current.policy,
          current.confirmation,
          { ...current.approval, ...approvalPatch },
          now,
        ),
      ).toEqual({
        allowed: false,
        reason: "compute_approval_subject_mismatch",
      });
    }
  });

  it("requires the authorization JobSpec to be the exact envelope subject", () => {
    const current = fixture();
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        { ...current.job, budgetCapUsd: 3.6 },
        current.policy,
        current.confirmation,
        current.approval,
        new Date("2026-07-13T10:05:00.000Z"),
      ),
    ).toEqual({ allowed: false, reason: "job_spec_subject_mismatch" });
  });

  it("rejects stale, future, overlong, and post-deadline grants", () => {
    const current = fixture();
    const now = new Date("2026-07-13T10:05:00.000Z");
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        { ...current.confirmation, confirmedAt: "2026-07-13T10:06:00.000Z" },
        current.approval,
        now,
      ),
    ).toEqual({
      allowed: false,
      reason: "operator_confirmation_outside_validity_window",
    });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        { ...current.confirmation, expiresAt: "2026-07-13T10:14:01.000Z" },
        current.approval,
        now,
      ),
    ).toEqual({
      allowed: false,
      reason: "operator_confirmation_ttl_exceeds_policy",
    });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        { ...current.approval, expiresAt: "2026-07-13T10:20:01.000Z" },
        now,
      ),
    ).toEqual({
      allowed: false,
      reason: "compute_approval_outside_validity_window",
    });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        current.approval,
        new Date(current.envelope.dispatchDeadline),
      ),
    ).toEqual({ allowed: false, reason: "dispatch_deadline_reached" });
  });

  it("requires null approval for local execution and still requires confirmation", () => {
    const current = fixture("local_cuda");
    const now = new Date("2026-07-13T10:05:00.000Z");
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        null,
        now,
      ),
    ).toEqual({ allowed: true });
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        current.approval,
        now,
      ),
    ).toEqual({
      allowed: false,
      reason: "local_execution_compute_approval_forbidden",
    });
  });

  it("rejects a non-finite authorization clock and never consumes confirmation state", () => {
    const current = fixture();
    expect(
      validateFoundryExecutionAuthorizations(
        current.envelope,
        current.job,
        current.policy,
        current.confirmation,
        current.approval,
        new Date(Number.NaN),
      ),
    ).toEqual({ allowed: false, reason: "invalid_authorization_time" });
    expect("consumedAt" in current.confirmation).toBe(false);
  });
});
