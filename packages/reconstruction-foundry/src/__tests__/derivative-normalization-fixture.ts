import {
  FOUNDRY_DERIVATIVE_AUTHORITY_NONE_CANDIDATE_RESERVATION_SCOPE_V1,
  FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
  FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
  FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
  FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
  FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
  FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1,
  FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
  FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryDerivativeRightsApprovalV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryDerivativeCandidateReservationReceiptSha256,
  computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256,
  computeFoundryDerivativeExecutionAuthorizationCandidateSha256,
  computeFoundryDerivativeExecutionBindingSetSha256,
  computeFoundryDerivativeQuarantineOutputPolicySha256,
  computeFoundryDerivativeRestrictionLineageSetSha256,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsCustodyReceiptSha256,
  computeFoundryDerivativeRightsCustodyRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationSha256,
  computeFoundryTrustedWorkerProfileSha256,
  type FoundryDerivativeCandidateReservationReceiptMaterialV1,
  type FoundryDerivativeExecutionAuthorizationCandidateMaterialV1,
  type FoundryDerivativeExecutionBindingSetV1,
  type FoundryDerivativeQuarantineOutputPolicyV1,
  type FoundryDerivativeRestrictionLineageSetV1,
  type FoundryDerivativeRightsCustodyReceiptMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1,
} from "@omnitwin/types";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  FOUNDRY_DERIVATIVE_NORMALIZATION_EXPECTED_EXECUTOR_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_BUNDLE_INVOCATION_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_SEALED_COMMAND,
  FoundryDerivativeNormalizationOutputBundleInvocationV0Schema,
  computeFoundryDerivativeNormalizationQuarantineProfileSha256,
  createFoundryDerivativeNormalizationQuarantineProfileV0,
  type FoundryDerivativeNormalizationOutputBundleInvocationV0,
} from "../derivative-normalization-output-contract.js";
import {
  __testOnlyWriteFoundryDerivativeNormalizationOutputBundle,
  type FoundryDerivativeNormalizationOutputBundleResult,
} from "../derivative-normalization-output-bundle.js";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  computeFoundryExecutionSubjectSha256,
  type FoundryExecutionSubjectV0,
} from "../execution-control.js";
import { sha256Bytes } from "../hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
  __testOnlyNormalizeMeshGlbBytes,
  type FoundryNormalizeMeshGlbInvocationV0,
  type FoundryNormalizeMeshGlbProofResult,
} from "../normalize-mesh-glb-worker.js";
import { glbFixture } from "./fixture.js";

export function createDerivativeNormalizationGlbSourceFixture(): Buffer {
  return glbFixture();
}

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

export interface DerivativeNormalizationFixtureOverrides {
  readonly assetId?: string;
  readonly sourceRootId?: string;
  readonly relativePath?: string;
  readonly subjectId?: string;
  readonly projectId?: string;
  readonly jobId?: string;
  readonly jobSubjectSha256?: string;
  readonly jobSpecSha256?: string;
  readonly executionEnvelopeSha256?: string;
  readonly ingestManifestSha256?: string;
  readonly intakeAdmissionResultSha256?: string;
  readonly intakeStagingIndexSha256?: string;
  readonly providerPlanSha256?: string;
  readonly executionPolicySha256?: string;
  readonly executionConfirmationSha256?: string;
  readonly rightsApprovalSha256?: string;
  readonly rightsPolicyEvidenceSha256?: string;
  readonly rightsPolicyDefinitionSha256?: string;
  readonly providerAdapterArtifactSha256?: string;
  readonly providerDeploymentSha256?: string;
  readonly executionId?: string;
  readonly attemptId?: string;
  readonly fencingToken?: string;
}

interface FixtureBindings {
  readonly assetId: string;
  readonly sourceRootId: string;
  readonly relativePath: string;
  readonly subjectId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobSubjectSha256: string;
  readonly jobSpecSha256: string;
  readonly executionEnvelopeSha256: string;
  readonly ingestManifestSha256: string;
  readonly intakeAdmissionResultSha256: string;
  readonly intakeStagingIndexSha256: string;
  readonly providerPlanSha256: string;
  readonly executionPolicySha256: string;
  readonly executionConfirmationSha256: string;
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
  readonly rightsPolicyDefinitionSha256: string;
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly fencingToken: string;
}

function bindings(
  overrides: DerivativeNormalizationFixtureOverrides = {},
): FixtureBindings {
  return {
    assetId: overrides.assetId ?? "fixture-mesh",
    sourceRootId: overrides.sourceRootId ?? "fixture-root",
    relativePath: overrides.relativePath ?? "fixture-mesh.glb",
    subjectId: overrides.subjectId ?? "normalize-subject",
    projectId: overrides.projectId ?? "grand-hall",
    jobId: overrides.jobId ?? "normalize-job",
    jobSubjectSha256: overrides.jobSubjectSha256 ?? sha(3),
    jobSpecSha256: overrides.jobSpecSha256 ?? sha(6),
    executionEnvelopeSha256: overrides.executionEnvelopeSha256 ?? sha(8),
    ingestManifestSha256: overrides.ingestManifestSha256 ?? sha(5),
    intakeAdmissionResultSha256:
      overrides.intakeAdmissionResultSha256 ?? sha(10),
    intakeStagingIndexSha256:
      overrides.intakeStagingIndexSha256 ?? sha(11),
    providerPlanSha256: overrides.providerPlanSha256 ?? sha(12),
    executionPolicySha256: overrides.executionPolicySha256 ?? sha(13),
    executionConfirmationSha256:
      overrides.executionConfirmationSha256 ?? sha(14),
    rightsApprovalSha256: overrides.rightsApprovalSha256 ?? sha(15),
    rightsPolicyEvidenceSha256:
      overrides.rightsPolicyEvidenceSha256 ?? sha(16),
    rightsPolicyDefinitionSha256:
      overrides.rightsPolicyDefinitionSha256 ?? sha(17),
    providerAdapterArtifactSha256:
      overrides.providerAdapterArtifactSha256 ?? sha(18),
    providerDeploymentSha256:
      overrides.providerDeploymentSha256 ?? sha(19),
    executionId:
      overrides.executionId ?? "018f3e5a-6e3b-7d10-a4f1-aabbccddeeff",
    attemptId:
      overrides.attemptId ?? "018f3e5a-6e3b-7d10-a4f1-bbccddeeff00",
    fencingToken: overrides.fencingToken ?? "1",
  };
}

export function createNormalizeInvocation(
  bytes: Uint8Array,
  overrides: DerivativeNormalizationFixtureOverrides = {},
): FoundryNormalizeMeshGlbInvocationV0 {
  const fixture = bindings(overrides);
  return {
    schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: "test_only_pure_core_proof",
    source: {
      assetId: fixture.assetId,
      inputType: "glb_gltf",
      mediaType: "model/gltf-binary",
      sizeBytes: bytes.byteLength,
      sha256: `sha256:${sha256Bytes(bytes)}`,
    },
    authority: "none",
  };
}

export function createDerivativeNormalizationWorkerProfile() {
  return FoundryTrustedWorkerProfileV0Schema.parse({
    schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
    profileId: "sealed-normalize-mesh-glb",
    profileVersion: "v0",
    operationClass: "deterministic_transformation",
    containerImage: `registry.example/omnitwin-normalize@${sha(90)}`,
    command: [...FOUNDRY_DERIVATIVE_NORMALIZATION_SEALED_COMMAND],
    networkAccess: "none",
    localExecutionAllowed: true,
    reviewedBy: "worker-reviewer@example.test",
    reviewedAt: "2026-07-14T07:00:00.000Z",
    expiresAt: "2026-07-15T07:00:00.000Z",
  });
}

function baseSubject(
  profileSha256: string,
  fixture: FixtureBindings,
): FoundryExecutionSubjectV0 {
  return {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: fixture.subjectId,
    projectId: fixture.projectId,
    jobSpecSha256: fixture.jobSpecSha256,
    executionEnvelopeSha256: fixture.executionEnvelopeSha256,
    ingestManifestSha256: fixture.ingestManifestSha256,
    intakeAdmissionResultSha256: fixture.intakeAdmissionResultSha256,
    intakeStagingIndexSha256: fixture.intakeStagingIndexSha256,
    providerPlanSha256: fixture.providerPlanSha256,
    executionPolicySha256: fixture.executionPolicySha256,
    executionConfirmationSha256: fixture.executionConfirmationSha256,
    rightsApprovalSha256: fixture.rightsApprovalSha256,
    rightsPolicyEvidenceSha256: fixture.rightsPolicyEvidenceSha256,
    rightsPolicyDefinitionSha256: fixture.rightsPolicyDefinitionSha256,
    computeApprovalSha256: null,
    providerKind: "local_cpu",
    providerAdapterId: "local-sandbox",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: fixture.providerAdapterArtifactSha256,
    providerDeploymentSha256: fixture.providerDeploymentSha256,
    workerProfileSha256s: [profileSha256],
    pricingSnapshotSha256: sha(20),
    pricingSnapshotExpiresAt: "2026-07-14T14:00:00.000Z",
    createdAt: "2026-07-14T08:00:00.000Z",
    dispatchDeadline: "2026-07-14T13:00:00.000Z",
    maximumAttempts: FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: "100",
      costHardStopMicroUsd: "200",
      terminationReserveMicroUsd: "50",
      absoluteCostCapMicroUsd: "250",
      costObservationMaximumAgeSeconds: 60,
    },
    checkpointContract: null,
  };
}

function derivativeApproval(source: Uint8Array, fixture: FixtureBindings) {
  const evidenceSha256 = sha(4);
  const asset = {
    id: fixture.assetId,
    sourceRootId: fixture.sourceRootId,
    relativePath: fixture.relativePath,
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary",
    sizeBytes: source.byteLength,
    sha256: `sha256:${sha256Bytes(source)}`,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned" as const,
      commercialUse: "allowed" as const,
      modelTrainingUse: "allowed" as const,
      redistribution: "allowed" as const,
      termsReviewedAt: "2026-07-14T09:10:00.000Z",
      termsReference: "https://rights.example/fixture-mesh",
      restrictions: [],
    },
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "high" as const,
      appearanceValue: "high" as const,
      calibrationValue: "none" as const,
      scaleValue: "high" as const,
      metadataKeys: [],
      decisiveNextTest: "Verify exact decoded GLB semantic equality.",
    },
    notes: [],
  };
  return FoundryDerivativeRightsApprovalV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
    approvalId: "normalize-rights-approval",
    policyVersion: "derivative-rights-2026-07",
    policyDefinitionSha256: sha(2),
    policyGeneration: 1,
    jobSubjectSha256: fixture.jobSubjectSha256,
    ingestManifestSha256: fixture.ingestManifestSha256,
    stageId: "normalize-mesh",
    operation: {
      operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
      derivativeClass:
        FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    },
    authorizedActions: FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
    forbiddenDownstreamUses: FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
    assetIds: [asset.id],
    assetRightsEvidence: [
      {
        assetId: asset.id,
        basis: asset.rights.basis,
        termsReference: asset.rights.termsReference,
        reviewedAt: asset.rights.termsReviewedAt,
        termsEvidenceArtifact: {
          artifactId: "terms-fixture-mesh",
          sha256: evidenceSha256,
          sizeBytes: 2_048,
          mediaType: "application/pdf",
          capturedAt: "2026-07-14T09:00:00.000Z",
        },
        restrictionsReviewed: true,
        restrictionDispositions: [],
      },
    ],
    assetSnapshots: [asset],
    decision: "allowed",
    decidedBy: "rights-reviewer@example.test",
    decidedAt: "2026-07-14T09:20:00.000Z",
    expiresAt: "2026-07-14T15:00:00.000Z",
  });
}

function custodyReceipt(source: Uint8Array, fixture: FixtureBindings) {
  const evidence = derivativeApproval(source, fixture).assetRightsEvidence[0]!
    .termsEvidenceArtifact;
  const request = {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1,
    artifactId: evidence.artifactId,
    mediaType: evidence.mediaType,
    contentSha256: evidence.sha256,
    sizeBytes: evidence.sizeBytes,
  };
  const material: FoundryDerivativeRightsCustodyReceiptMaterialV1 = {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1,
    custodyId: "018f3e5a-6e3b-7d10-a4f1-556677889900",
    registrationRequestSha256:
      computeFoundryDerivativeRightsCustodyRegistrationRequestSha256(request),
    artifactId: evidence.artifactId,
    mediaType: evidence.mediaType,
    contentSha256: evidence.sha256,
    sizeBytes: evidence.sizeBytes,
    storageMode: FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1,
    capturedAt: evidence.capturedAt,
    registeredByUserId: "018f3e5a-6e3b-4d10-a4f1-001122334455",
    verifiedAt: evidence.capturedAt,
    authority: "none",
    executionEligible: false,
  };
  return {
    ...material,
    custodyReceiptSha256:
      computeFoundryDerivativeRightsCustodyReceiptSha256(material),
  };
}

function reviewReceipt(source: Uint8Array, fixture: FixtureBindings) {
  const approval = derivativeApproval(source, fixture);
  const custody = custodyReceipt(source, fixture);
  const request = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    custodyId: custody.custodyId,
    custodyReceiptSha256: custody.custodyReceiptSha256,
    decision: FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    rationale: "The exact custody bytes match the approval evidence metadata.",
  } as const;
  const material: FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1 = {
    ...request,
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
    reviewId: "018f3e5a-6e3b-7d10-a4f1-667788990011",
    reviewRequestSha256:
      computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
        request,
      ),
    reviewedByUserId: "018f3e5a-6e3b-4d10-a4f1-112233445566",
    reviewedAt: "2026-07-14T09:30:00.000Z",
    authority: "none",
    executionEligible: false,
  };
  return {
    ...material,
    reviewReceiptSha256:
      computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256(
        material,
      ),
  };
}

function attestation(source: Uint8Array, fixture: FixtureBindings) {
  const approval = derivativeApproval(source, fixture);
  const review = reviewReceipt(source, fixture);
  const custody = custodyReceipt(source, fixture);
  const request = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    reviewId: review.reviewId,
    reviewReceiptSha256: review.reviewReceiptSha256,
    custodyId: custody.custodyId,
    custodyReceiptSha256: custody.custodyReceiptSha256,
  };
  const material: FoundryDerivativeRightsRegistryAttestationMaterialV1 = {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
    attestationId: "018f3e5a-6e3b-7d10-a4f1-778899001122",
    registrationRequestSha256:
      computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
        request,
      ),
    derivativeRightsApproval: approval,
    acceptedReviewReceipt: review,
    termsEvidenceCustodyReceipt: custody,
    attestedByUserId: "018f3e5a-6e3b-4d10-a4f1-223344556677",
    attestedAt: "2026-07-14T09:40:00.000Z",
    registryAuthority: FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1,
    executionEligible: false,
  };
  return {
    ...material,
    registryAttestationSha256:
      computeFoundryDerivativeRightsRegistryAttestationSha256(material),
  };
}

function bindingSet(
  source: Uint8Array,
  baseExecutionSubjectSha256: string,
  profileSha256: string,
  fixture: FixtureBindings,
): FoundryDerivativeExecutionBindingSetV1 {
  const approval = derivativeApproval(source, fixture);
  const review = reviewReceipt(source, fixture);
  const custody = custodyReceipt(source, fixture);
  const registry = attestation(source, fixture);
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
    bindingIds: [`normalize-mesh--${fixture.assetId}`],
    assetIds: [fixture.assetId],
    bindings: [
      {
        bindingId: `normalize-mesh--${fixture.assetId}`,
        baseExecutionSubjectSha256,
        projectId: fixture.projectId,
        jobId: fixture.jobId,
        jobSpecSha256: fixture.jobSpecSha256,
        executionEnvelopeSha256: fixture.executionEnvelopeSha256,
        jobSubjectSha256: approval.jobSubjectSha256,
        ingestManifestSha256: approval.ingestManifestSha256,
        workerProfileSha256: profileSha256,
        operationClass: "deterministic_transformation",
        stageId: approval.stageId,
        operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
        derivativeClass:
          FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
        assetId: fixture.assetId,
        policyVersion: approval.policyVersion,
        policyDefinitionSha256: approval.policyDefinitionSha256,
        policyGeneration: approval.policyGeneration,
        approvalId: approval.approvalId,
        derivativeRightsApprovalSha256:
          computeFoundryDerivativeRightsApprovalSha256(approval),
        reviewId: review.reviewId,
        reviewReceiptSha256: review.reviewReceiptSha256,
        custodyId: custody.custodyId,
        custodyReceiptSha256: custody.custodyReceiptSha256,
        termsEvidenceArtifactId: custody.artifactId,
        termsEvidenceContentSha256: custody.contentSha256,
        termsEvidenceSizeBytes: custody.sizeBytes,
        termsEvidenceMediaType: custody.mediaType,
        termsEvidenceCapturedAt: custody.capturedAt,
        attestationId: registry.attestationId,
        registryAttestationSha256: registry.registryAttestationSha256,
      },
    ],
  };
}

function lineageSet(
  source: Uint8Array,
  baseExecutionSubjectSha256: string,
  profileSha256: string,
  fixture: FixtureBindings,
): FoundryDerivativeRestrictionLineageSetV1 {
  const approval = derivativeApproval(source, fixture);
  const review = reviewReceipt(source, fixture);
  const custody = custodyReceipt(source, fixture);
  const registry = attestation(source, fixture);
  const currentBindings = bindingSet(
    source,
    baseExecutionSubjectSha256,
    profileSha256,
    fixture,
  );
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    reviewId: review.reviewId,
    reviewReceiptSha256: review.reviewReceiptSha256,
    custodyId: custody.custodyId,
    custodyReceiptSha256: custody.custodyReceiptSha256,
    attestationId: registry.attestationId,
    registryAttestationSha256: registry.registryAttestationSha256,
    bindingSetSha256:
      computeFoundryDerivativeExecutionBindingSetSha256(currentBindings),
    assetIds: [fixture.assetId],
    entries: [],
  };
}

function outputPolicy(): FoundryDerivativeQuarantineOutputPolicyV1 {
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
    outputDisposition:
      FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
    releaseEligible: false,
    publicationEligible: false,
    redistributionEligible: false,
    runtimePromotionEligible: false,
    signingEligible: false,
    restrictionLineageRequired: true,
    authorityRevalidationRequiredAtOutputCommit: true,
  };
}

function candidate(
  source: Uint8Array,
  baseExecutionSubjectSha256: string,
  profileSha256: string,
  fixture: FixtureBindings,
) {
  const approval = derivativeApproval(source, fixture);
  const registry = attestation(source, fixture);
  const currentBindings = bindingSet(
    source,
    baseExecutionSubjectSha256,
    profileSha256,
    fixture,
  );
  const lineage = lineageSet(
    source,
    baseExecutionSubjectSha256,
    profileSha256,
    fixture,
  );
  const policy = outputPolicy();
  const request = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
    baseExecutionSubjectSha256,
    projectId: fixture.projectId,
    jobId: fixture.jobId,
    jobSpecSha256: fixture.jobSpecSha256,
    executionEnvelopeSha256: fixture.executionEnvelopeSha256,
    ingestManifestSha256: approval.ingestManifestSha256,
    jobSubjectSha256: approval.jobSubjectSha256,
    registryAttestationSha256: registry.registryAttestationSha256,
    bindingSetSha256:
      computeFoundryDerivativeExecutionBindingSetSha256(currentBindings),
    restrictionLineageSetSha256:
      computeFoundryDerivativeRestrictionLineageSetSha256(lineage),
    outputPolicySha256:
      computeFoundryDerivativeQuarantineOutputPolicySha256(policy),
  };
  const reservationMaterial: FoundryDerivativeCandidateReservationReceiptMaterialV1 = {
    schemaVersion: FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
    reservationId: "018f3e5a-6e3b-7d10-a4f1-889900112233",
    reservationRequestSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        request,
      ),
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    reviewId: registry.acceptedReviewReceipt.reviewId,
    reviewReceiptSha256: registry.acceptedReviewReceipt.reviewReceiptSha256,
    attestationId: registry.attestationId,
    registryAttestationSha256: registry.registryAttestationSha256,
    baseExecutionSubjectSha256,
    projectId: request.projectId,
    jobId: request.jobId,
    jobSpecSha256: request.jobSpecSha256,
    executionEnvelopeSha256: request.executionEnvelopeSha256,
    ingestManifestSha256: request.ingestManifestSha256,
    jobSubjectSha256: request.jobSubjectSha256,
    bindingSetSha256: request.bindingSetSha256,
    restrictionLineageSetSha256: request.restrictionLineageSetSha256,
    outputPolicySha256: request.outputPolicySha256,
    reservationOrdinal: 1,
    singleReservation: true,
    reservationScope:
      FOUNDRY_DERIVATIVE_AUTHORITY_NONE_CANDIDATE_RESERVATION_SCOPE_V1,
    executionActivationRecorded: false,
    reservedByUserId: "018f3e5a-6e3b-4d10-a4f1-334455667788",
    reservedAt: "2026-07-14T09:50:00.000Z",
    authority: "none",
    executionEligible: false,
  };
  const reservation = {
    ...reservationMaterial,
    reservationReceiptSha256:
      computeFoundryDerivativeCandidateReservationReceiptSha256(
        reservationMaterial,
      ),
  };
  const material: FoundryDerivativeExecutionAuthorizationCandidateMaterialV1 = {
    schemaVersion: FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
    candidateId: "018f3e5a-6e3b-7d10-a4f1-990011223344",
    reservationRequestSha256: reservation.reservationRequestSha256,
    baseExecutionSubjectSha256,
    projectId: request.projectId,
    jobId: request.jobId,
    jobSpecSha256: request.jobSpecSha256,
    executionEnvelopeSha256: request.executionEnvelopeSha256,
    ingestManifestSha256: request.ingestManifestSha256,
    jobSubjectSha256: request.jobSubjectSha256,
    registryAttestation: registry,
    registryAttestationSha256: registry.registryAttestationSha256,
    bindingSet: currentBindings,
    bindingSetSha256: request.bindingSetSha256,
    restrictionLineageSet: lineage,
    restrictionLineageSetSha256: request.restrictionLineageSetSha256,
    outputPolicy: policy,
    outputPolicySha256: request.outputPolicySha256,
    candidateReservationReceipt: reservation,
    candidateReservationReceiptSha256: reservation.reservationReceiptSha256,
    outputDisposition:
      FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
    authority: "none",
    executionEligible: false,
    dispatchEnabled: false,
    assembledAt: "2026-07-14T10:00:00.000Z",
  };
  return {
    ...material,
    candidateSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateSha256(material),
  };
}

export function createDerivativeNormalizationBundleInvocation(
  source: Uint8Array,
  overrides: DerivativeNormalizationFixtureOverrides = {},
): FoundryDerivativeNormalizationOutputBundleInvocationV0 {
  const fixture = bindings(overrides);
  const profile = createDerivativeNormalizationWorkerProfile();
  const profileSha256 = computeFoundryTrustedWorkerProfileSha256(profile);
  const subject = baseSubject(profileSha256, fixture);
  const baseExecutionSubjectSha256 =
    computeFoundryExecutionSubjectSha256(subject);
  const authorizationCandidate = candidate(
    source,
    baseExecutionSubjectSha256,
    profileSha256,
    fixture,
  );
  const quarantineProfile =
    createFoundryDerivativeNormalizationQuarantineProfileV0();
  return FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.parse({
    schemaVersion:
      FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_BUNDLE_INVOCATION_V0,
    purpose: "authority_none_pre_activation_output_custody",
    candidate: authorizationCandidate,
    candidateSha256: authorizationCandidate.candidateSha256,
    candidateReservationReceiptSha256:
      authorizationCandidate.candidateReservationReceiptSha256,
    baseExecutionSubject: subject,
    baseExecutionSubjectSha256,
    claimedRuntimeContext: {
      jobId: fixture.jobId,
      executionId: fixture.executionId,
      attemptId: fixture.attemptId,
      attemptOrdinal: 1,
      stageId: "normalize-mesh",
      fencingToken: fixture.fencingToken,
      bindingAuthority: "caller_claim_only_not_activated",
      executionAdmission: "not_established",
      fenceOwnership: "not_established",
    },
    expectedExecutor: {
      schemaVersion: FOUNDRY_DERIVATIVE_NORMALIZATION_EXPECTED_EXECUTOR_V0,
      sealedCommand: [...FOUNDRY_DERIVATIVE_NORMALIZATION_SEALED_COMMAND],
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
      workerProfile: profile,
      workerProfileSha256: profileSha256,
      bindingAuthority: "candidate_expected_not_runtime_attested",
      executorAuthentication: "not_established",
    },
    activation: {
      state: "absent_not_recorded",
      activationId: null,
      activationSha256: null,
      activationReceiptSha256: null,
      executionActivationRecorded: false,
      executionAuthority: "none",
    },
    quarantineProfile,
    quarantineProfileSha256:
      computeFoundryDerivativeNormalizationQuarantineProfileSha256(
        quarantineProfile,
      ),
    authority: "none",
    executionEligible: false,
    dispatchEnabled: false,
  });
}

export async function createDerivativeNormalizationProofFixture(
  source: Uint8Array = glbFixture(),
  overrides: DerivativeNormalizationFixtureOverrides = {},
): Promise<{
  readonly source: Uint8Array;
  readonly invocation: FoundryNormalizeMeshGlbInvocationV0;
  readonly normalizedGlb: FoundryNormalizeMeshGlbProofResult["normalizedGlb"];
  readonly report: FoundryNormalizeMeshGlbProofResult["report"];
}> {
  const invocation = createNormalizeInvocation(source, overrides);
  const proof = await __testOnlyNormalizeMeshGlbBytes(invocation, source);
  return { source, invocation, ...proof };
}

export async function createDerivativeNormalizationConformanceFixture(
  source: Uint8Array,
  overrides: DerivativeNormalizationFixtureOverrides = {},
) {
  const proof = await createDerivativeNormalizationProofFixture(
    source,
    overrides,
  );
  return {
    source: proof.source,
    normalizeInvocation: proof.invocation,
    normalizedGlb: proof.normalizedGlb,
    normalizeReport: proof.report,
    bundleInvocation: createDerivativeNormalizationBundleInvocation(
      proof.source,
      overrides,
    ),
  };
}

export async function writeDerivativeNormalizationConformanceBundle(
  outputDirectory: string,
  source: Uint8Array,
  overrides: DerivativeNormalizationFixtureOverrides = {},
) {
  const fixture = await createDerivativeNormalizationConformanceFixture(
    source,
    overrides,
  );
  const result =
    await __testOnlyWriteFoundryDerivativeNormalizationOutputBundle({
      outputDirectory,
      bundleInvocation: fixture.bundleInvocation,
      normalizeInvocation: fixture.normalizeInvocation,
      normalizeReport: fixture.normalizeReport,
      sourceBytes: fixture.source,
      normalizedGlb: fixture.normalizedGlb,
    });
  return { ...fixture, outputDirectory, result };
}

export async function writeDerivativeNormalizationBundleFixture(
  root: string,
  overrides: DerivativeNormalizationFixtureOverrides = {},
): Promise<{
  readonly source: Uint8Array;
  readonly invocation: FoundryDerivativeNormalizationOutputBundleInvocationV0;
  readonly normalizedGlb: FoundryNormalizeMeshGlbProofResult["normalizedGlb"];
  readonly report: FoundryNormalizeMeshGlbProofResult["report"];
  readonly outputDirectory: string;
  readonly result: FoundryDerivativeNormalizationOutputBundleResult;
}> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const proof = await createDerivativeNormalizationProofFixture(
    glbFixture(),
    overrides,
  );
  const invocation = createDerivativeNormalizationBundleInvocation(
    proof.source,
    overrides,
  );
  const outputDirectory = join(root, "bundle");
  const result =
    await __testOnlyWriteFoundryDerivativeNormalizationOutputBundle({
      outputDirectory,
      bundleInvocation: invocation,
      normalizeInvocation: proof.invocation,
      normalizeReport: proof.report,
      sourceBytes: proof.source,
      normalizedGlb: proof.normalizedGlb,
    });
  return { ...proof, invocation, outputDirectory, result };
}
