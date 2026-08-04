import { describe, expect, it } from "vitest";
import {
  FOUNDRY_DERIVATIVE_AUTHORITY_NONE_CANDIDATE_RESERVATION_SCOPE_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
  FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
  FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
  FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1,
  FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_DISPOSITION_V1,
  FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
  FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
  FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema,
  FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema,
  FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema,
  FoundryDerivativeExecutionAuthorizationCandidateV1Schema,
  FoundryDerivativeExecutionBindingSetV1Schema,
  FoundryDerivativeQuarantineOutputPolicyV1Schema,
  FoundryDerivativeRestrictionLineageSetV1Schema,
  FoundryDerivativeCandidateReservationReceiptV1Schema,
  FoundryDerivativeRightsRegistryAttestationMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationV1Schema,
  FoundryDerivativeRightsRegistryAttestationV1Schema,
  computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256,
  computeFoundryDerivativeExecutionAuthorizationCandidateSha256,
  computeFoundryDerivativeExecutionBindingSetSha256,
  computeFoundryDerivativeQuarantineOutputPolicySha256,
  computeFoundryDerivativeRestrictionLineageSetSha256,
  computeFoundryDerivativeCandidateReservationReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationSha256,
  computeFoundryDerivativeRightsRegistryAttestationSha256,
  type FoundryDerivativeExecutionAuthorizationCandidateMaterialV1,
  type FoundryDerivativeExecutionBindingSetV1,
  type FoundryDerivativeQuarantineOutputPolicyV1,
  type FoundryDerivativeRestrictionLineageSetV1,
  type FoundryDerivativeCandidateReservationReceiptMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1,
} from "../omnitwin-foundry-derivative-execution-v1.js";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  computeFoundryDerivativeRightsCustodyReceiptSha256,
  computeFoundryDerivativeRightsCustodyRegistrationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256,
  computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256,
  type FoundryDerivativeRightsCustodyReceiptMaterialV1,
  type FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1,
} from "../omnitwin-foundry-derivative-rights-custody.js";
import {
  FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
  FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
  FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
  FoundryDerivativeRightsApprovalV0Schema,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsRestrictionSha256,
} from "../omnitwin-foundry-derivative-rights.js";

const REGISTERED_BY = "018f3e5a-6e3b-4d10-a4f1-001122334455";
const REVIEWED_BY = "018f3e5a-6e3b-4d10-a4f1-112233445566";
const ATTESTED_BY = "018f3e5a-6e3b-4d10-a4f1-223344556677";
const RESERVED_BY = "018f3e5a-6e3b-4d10-a4f1-334455667788";
const REVOKED_BY = "018f3e5a-6e3b-4d10-a4f1-445566778899";

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function derivativeApproval() {
  const restrictionText = "Internal lossless derivatives only.";
  const evidenceSha256 = sha(4);
  const asset = {
    id: "mesh-a",
    sourceRootId: "mesh-root",
    relativePath: "mesh-a.glb",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary",
    sizeBytes: 1_024,
    sha256: sha(1),
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
      termsReference: "https://rights.example/mesh-a",
      restrictions: [restrictionText],
    },
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "high" as const,
      appearanceValue: "high" as const,
      calibrationValue: "none" as const,
      scaleValue: "high" as const,
      metadataKeys: [],
      decisiveNextTest: "Validate decoded GLB semantic equality.",
    },
    notes: [],
  };
  return FoundryDerivativeRightsApprovalV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
    approvalId: "normalize-rights-approval",
    policyVersion: "derivative-rights-2026-07",
    policyDefinitionSha256: sha(2),
    policyGeneration: 1,
    jobSubjectSha256: sha(3),
    ingestManifestSha256: sha(5),
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
          artifactId: "terms-mesh-a",
          sha256: evidenceSha256,
          sizeBytes: 2_048,
          mediaType: "application/pdf",
          capturedAt: "2026-07-14T09:00:00.000Z",
        },
        restrictionsReviewed: true,
        restrictionDispositions: [
          {
            restrictionIndex: 0,
            restrictionText,
            restrictionSha256:
              computeFoundryDerivativeRightsRestrictionSha256({
                assetId: asset.id,
                restrictionIndex: 0,
                restrictionText,
              }),
            disposition: "satisfied",
            rationale:
              "The internal lossless normalization satisfies the restriction.",
            supportingEvidenceSha256: evidenceSha256,
          },
        ],
      },
    ],
    assetSnapshots: [asset],
    decision: "allowed",
    decidedBy: "rights-reviewer@example.test",
    decidedAt: "2026-07-14T09:20:00.000Z",
    expiresAt: "2026-07-14T12:00:00.000Z",
  });
}

function custodyReceipt() {
  const approval = derivativeApproval();
  const evidence = approval.assetRightsEvidence[0]!.termsEvidenceArtifact;
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
    registeredByUserId: REGISTERED_BY,
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

function acceptedReviewReceipt() {
  const approval = derivativeApproval();
  const custody = custodyReceipt();
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
  const material: FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1 =
    {
      ...request,
      schemaVersion:
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
      reviewId: "018f3e5a-6e3b-7d10-a4f1-667788990011",
      reviewRequestSha256:
        computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
          request,
        ),
      reviewedByUserId: REVIEWED_BY,
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

function attestationMaterial(): FoundryDerivativeRightsRegistryAttestationMaterialV1 {
  const approval = derivativeApproval();
  const review = acceptedReviewReceipt();
  const custody = custodyReceipt();
  const registrationRequest = {
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
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
    attestationId: "018f3e5a-6e3b-7d10-a4f1-778899001122",
    registrationRequestSha256:
      computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
        registrationRequest,
      ),
    derivativeRightsApproval: approval,
    acceptedReviewReceipt: review,
    termsEvidenceCustodyReceipt: custody,
    attestedByUserId: ATTESTED_BY,
    attestedAt: "2026-07-14T09:40:00.000Z",
    registryAuthority: FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1,
    executionEligible: false,
  };
}

function registryAttestation() {
  const material = attestationMaterial();
  return {
    ...material,
    registryAttestationSha256:
      computeFoundryDerivativeRightsRegistryAttestationSha256(material),
  };
}

function bindingSet(): FoundryDerivativeExecutionBindingSetV1 {
  const approval = derivativeApproval();
  const review = acceptedReviewReceipt();
  const custody = custodyReceipt();
  const attestation = registryAttestation();
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
    bindingIds: ["normalize-mesh--mesh-a"],
    assetIds: ["mesh-a"],
    bindings: [
      {
        bindingId: "normalize-mesh--mesh-a",
        baseExecutionSubjectSha256: sha(7),
        projectId: "grand-hall",
        jobId: "normalize-job",
        jobSpecSha256: sha(6),
        executionEnvelopeSha256: sha(8),
        jobSubjectSha256: approval.jobSubjectSha256,
        ingestManifestSha256: approval.ingestManifestSha256,
        workerProfileSha256: sha(9),
        operationClass: "deterministic_transformation",
        stageId: approval.stageId,
        operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
        derivativeClass:
          FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
        assetId: approval.assetIds[0]!,
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
        attestationId: attestation.attestationId,
        registryAttestationSha256:
          attestation.registryAttestationSha256,
      },
    ],
  };
}

function restrictionLineageSet(): FoundryDerivativeRestrictionLineageSetV1 {
  const approval = derivativeApproval();
  const review = acceptedReviewReceipt();
  const custody = custodyReceipt();
  const attestation = registryAttestation();
  const bindings = bindingSet();
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    reviewId: review.reviewId,
    reviewReceiptSha256: review.reviewReceiptSha256,
    custodyId: custody.custodyId,
    custodyReceiptSha256: custody.custodyReceiptSha256,
    attestationId: attestation.attestationId,
    registryAttestationSha256: attestation.registryAttestationSha256,
    bindingSetSha256:
      computeFoundryDerivativeExecutionBindingSetSha256(bindings),
    assetIds: [...approval.assetIds],
    entries: approval.assetRightsEvidence[0]!.restrictionDispositions.map(
      (restriction) => ({
        assetId: approval.assetIds[0]!,
        restriction,
        lineageDisposition:
          FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_DISPOSITION_V1,
      }),
    ),
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

function reservationRequestMaterial() {
  const attestation = registryAttestation();
  const bindings = bindingSet();
  const lineage = restrictionLineageSet();
  const policy = outputPolicy();
  return {
    schemaVersion:
      FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
    baseExecutionSubjectSha256: sha(7),
    projectId: "grand-hall",
    jobId: "normalize-job",
    jobSpecSha256: sha(6),
    executionEnvelopeSha256: sha(8),
    ingestManifestSha256: derivativeApproval().ingestManifestSha256,
    jobSubjectSha256: derivativeApproval().jobSubjectSha256,
    registryAttestationSha256: attestation.registryAttestationSha256,
    bindingSetSha256:
      computeFoundryDerivativeExecutionBindingSetSha256(bindings),
    restrictionLineageSetSha256:
      computeFoundryDerivativeRestrictionLineageSetSha256(lineage),
    outputPolicySha256:
      computeFoundryDerivativeQuarantineOutputPolicySha256(policy),
  };
}

function candidateReservationReceiptMaterial(): FoundryDerivativeCandidateReservationReceiptMaterialV1 {
  const request = reservationRequestMaterial();
  const approval = derivativeApproval();
  const review = acceptedReviewReceipt();
  const attestation = registryAttestation();
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
    reservationId: "018f3e5a-6e3b-7d10-a4f1-889900112233",
    reservationRequestSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        request,
      ),
    approvalId: approval.approvalId,
    derivativeRightsApprovalSha256:
      computeFoundryDerivativeRightsApprovalSha256(approval),
    reviewId: review.reviewId,
    reviewReceiptSha256: review.reviewReceiptSha256,
    attestationId: attestation.attestationId,
    registryAttestationSha256: attestation.registryAttestationSha256,
    baseExecutionSubjectSha256: request.baseExecutionSubjectSha256,
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
    reservedByUserId: RESERVED_BY,
    reservedAt: "2026-07-14T09:50:00.000Z",
    authority: "none",
    executionEligible: false,
  };
}

function candidateReservationReceipt() {
  const material = candidateReservationReceiptMaterial();
  return {
    ...material,
    reservationReceiptSha256:
      computeFoundryDerivativeCandidateReservationReceiptSha256(material),
  };
}

function candidateMaterial(): FoundryDerivativeExecutionAuthorizationCandidateMaterialV1 {
  const request = reservationRequestMaterial();
  const attestation = registryAttestation();
  const bindings = bindingSet();
  const lineage = restrictionLineageSet();
  const policy = outputPolicy();
  const reservationReceipt = candidateReservationReceipt();
  return {
    schemaVersion: FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
    candidateId: "018f3e5a-6e3b-7d10-a4f1-990011223344",
    reservationRequestSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        request,
      ),
    baseExecutionSubjectSha256: request.baseExecutionSubjectSha256,
    projectId: request.projectId,
    jobId: request.jobId,
    jobSpecSha256: request.jobSpecSha256,
    executionEnvelopeSha256: request.executionEnvelopeSha256,
    ingestManifestSha256: request.ingestManifestSha256,
    jobSubjectSha256: request.jobSubjectSha256,
    registryAttestation: attestation,
    registryAttestationSha256: request.registryAttestationSha256,
    bindingSet: bindings,
    bindingSetSha256: request.bindingSetSha256,
    restrictionLineageSet: lineage,
    restrictionLineageSetSha256: request.restrictionLineageSetSha256,
    outputPolicy: policy,
    outputPolicySha256: request.outputPolicySha256,
    candidateReservationReceipt: reservationReceipt,
    candidateReservationReceiptSha256:
      reservationReceipt.reservationReceiptSha256,
    outputDisposition:
      FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
    authority: "none",
    executionEligible: false,
    dispatchEnabled: false,
    assembledAt: "2026-07-14T10:00:00.000Z",
  };
}

function candidate() {
  const material = candidateMaterial();
  return {
    ...material,
    candidateSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateSha256(material),
  };
}

function revocationMaterial(): FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1 {
  const attestation = registryAttestation();
  const request = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
    attestationId: attestation.attestationId,
    registryAttestationSha256: attestation.registryAttestationSha256,
    reason: "The authenticated registry evidence was withdrawn.",
  };
  return {
    schemaVersion:
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1,
    revocationId: "018f3e5a-6e3b-7d10-a4f1-aabbccddeeff",
    revocationRequestSha256:
      computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256(
        request,
      ),
    attestationId: attestation.attestationId,
    registryAttestationSha256: attestation.registryAttestationSha256,
    registryAttestation: attestation,
    revokedByUserId: REVOKED_BY,
    revokedAt: "2026-07-14T10:10:00.000Z",
    reason: request.reason,
    registryAuthority: FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1,
    executionEligible: false,
  };
}

describe("OmniTwin Foundry derivative execution V1 contracts", () => {
  it("keeps public registration requests strict and free of caller authority", () => {
    const attestationRequest = {
      approvalId: derivativeApproval().approvalId,
      derivativeRightsApprovalSha256:
        computeFoundryDerivativeRightsApprovalSha256(derivativeApproval()),
      reviewId: acceptedReviewReceipt().reviewId,
      reviewReceiptSha256: acceptedReviewReceipt().reviewReceiptSha256,
      custodyId: custodyReceipt().custodyId,
      custodyReceiptSha256: custodyReceipt().custodyReceiptSha256,
    };
    expect(
      FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema.safeParse(
        attestationRequest,
      ).success,
    ).toBe(true);
    expect(
      FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema.safeParse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
          ...attestationRequest,
        },
      ).success,
    ).toBe(true);

    for (const smuggled of [
      { attestedByUserId: ATTESTED_BY },
      { attestedAt: "2026-07-14T09:40:00.000Z" },
      { registryAuthority: FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1 },
      { executionEligible: true },
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema.safeParse(
          { ...attestationRequest, ...smuggled },
        ).success,
      ).toBe(false);
    }
  });

  it("turns accepted review evidence into authenticated registry state, never execution authority", () => {
    expect(
      FoundryDerivativeRightsRegistryAttestationMaterialV1Schema.parse(
        attestationMaterial(),
      ),
    ).toEqual(attestationMaterial());
    expect(
      FoundryDerivativeRightsRegistryAttestationV1Schema.parse(
        registryAttestation(),
      ),
    ).toEqual(registryAttestation());
    expect(acceptedReviewReceipt()).toMatchObject({
      decision: "accepted_for_registry_attestation",
      authority: "none",
      executionEligible: false,
    });
    expect(registryAttestation()).toMatchObject({
      registryAuthority: "authenticated_registry_attestation_v1",
      executionEligible: false,
    });
  });

  it("rejects review, custody, request, digest, and authority substitution", () => {
    const valid = registryAttestation();
    for (const changed of [
      { ...valid, registrationRequestSha256: sha(91) },
      {
        ...valid,
        acceptedReviewReceipt: {
          ...valid.acceptedReviewReceipt,
          decision: "rejected",
        },
      },
      {
        ...valid,
        termsEvidenceCustodyReceipt: {
          ...valid.termsEvidenceCustodyReceipt,
          contentSha256: sha(92),
        },
      },
      { ...valid, registryAttestationSha256: sha(93) },
      { ...valid, registryAuthority: "execution_authority" },
      { ...valid, executionEligible: true },
      { ...valid, dispatchEnabled: true },
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationV1Schema.safeParse(changed)
          .success,
      ).toBe(false);
    }

  });

  it("defines a strict authenticated revocation with a separate public request", () => {
    const material = revocationMaterial();
    const revocation = {
      ...material,
      attestationRevocationSha256:
        computeFoundryDerivativeRightsRegistryAttestationRevocationSha256(
          material,
        ),
    };
    expect(
      FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema.safeParse(
        {
          attestationId: material.attestationId,
          registryAttestationSha256: material.registryAttestationSha256,
          reason: material.reason,
        },
      ).success,
    ).toBe(true);
    expect(
      FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema.safeParse(
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
          attestationId: material.attestationId,
          registryAttestationSha256: material.registryAttestationSha256,
          reason: material.reason,
        },
      ).success,
    ).toBe(true);
    expect(
      FoundryDerivativeRightsRegistryAttestationRevocationV1Schema.parse(
        revocation,
      ),
    ).toEqual(revocation);

    for (const changed of [
      { ...revocation, revocationRequestSha256: sha(80) },
      { ...revocation, registryAttestationSha256: sha(81) },
      { ...revocation, revokedAt: "2026-07-14T09:39:59.999Z" },
      { ...revocation, reason: " padded " },
      { ...revocation, executionEligible: true },
    ]) {
      expect(
        FoundryDerivativeRightsRegistryAttestationRevocationV1Schema.safeParse(
          changed,
        ).success,
      ).toBe(false);
    }

  });

  it("requires one canonical normalize_mesh_glb binding and exact ID arrays", () => {
    const valid = bindingSet();
    expect(FoundryDerivativeExecutionBindingSetV1Schema.parse(valid)).toEqual(
      valid,
    );
    for (const changed of [
      { ...valid, bindingIds: ["different-binding"] },
      { ...valid, assetIds: ["mesh-b"] },
      { ...valid, bindings: [] },
      {
        ...valid,
        bindings: [{ ...valid.bindings[0]!, operationId: "other/v0" }],
      },
      { ...valid, unexpectedAuthority: "execute" },
    ]) {
      expect(
        FoundryDerivativeExecutionBindingSetV1Schema.safeParse(changed).success,
      ).toBe(false);
    }
  });

  it("preserves the exact canonical restriction lineage into quarantine", () => {
    const valid = restrictionLineageSet();
    expect(
      FoundryDerivativeRestrictionLineageSetV1Schema.parse(valid),
    ).toEqual(valid);
    const wrongIndex = {
      ...valid,
      entries: [
        {
          ...valid.entries[0]!,
          restriction: {
            ...valid.entries[0]!.restriction,
            restrictionIndex: 1,
          },
        },
      ],
    };
    const wrongDigest = {
      ...valid,
      entries: [
        {
          ...valid.entries[0]!,
          restriction: {
            ...valid.entries[0]!.restriction,
            restrictionSha256: sha(55),
          },
        },
      ],
    };
    expect(
      FoundryDerivativeRestrictionLineageSetV1Schema.safeParse(wrongIndex)
        .success,
    ).toBe(false);
    expect(
      FoundryDerivativeRestrictionLineageSetV1Schema.safeParse(wrongDigest)
        .success,
    ).toBe(false);
    expect(
      FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema.safeParse(
        { ...candidateMaterial(), restrictionLineageSet: { ...valid, entries: [] } },
      ).success,
    ).toBe(false);
  });

  it("hard-codes a quarantine-only, non-release output policy", () => {
    const valid = outputPolicy();
    expect(FoundryDerivativeQuarantineOutputPolicyV1Schema.parse(valid)).toEqual(
      valid,
    );
    for (const forbidden of [
      { releaseEligible: true },
      { publicationEligible: true },
      { redistributionEligible: true },
      { runtimePromotionEligible: true },
      { signingEligible: true },
      { outputDisposition: "release" },
    ]) {
      expect(
        FoundryDerivativeQuarantineOutputPolicyV1Schema.safeParse({
          ...valid,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });

  it("separates an authority-none candidate reservation from execution activation", () => {
    const request = reservationRequestMaterial();
    const publicRequest = { ...request } as Record<string, unknown>;
    delete publicRequest.schemaVersion;
    expect(
      FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema.parse(
        publicRequest,
      ),
    ).toEqual(publicRequest);
    expect(
      FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema.parse(
        request,
      ),
    ).toEqual(request);

    for (const smuggled of [
      { reservedByUserId: RESERVED_BY },
      { reservedAt: "2026-07-14T09:50:00.000Z" },
      { authority: "none" },
      { executionEligible: false },
      { dispatchEnabled: false },
    ]) {
      expect(
        FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema.safeParse(
          { ...publicRequest, ...smuggled },
        ).success,
      ).toBe(false);
    }

    const receipt = candidateReservationReceipt();
    expect(
      FoundryDerivativeCandidateReservationReceiptV1Schema.parse(receipt),
    ).toEqual(receipt);
    expect(receipt).toMatchObject({
      reservationOrdinal: 1,
      singleReservation: true,
      reservationScope: "authority_none_candidate_reservation",
      executionActivationRecorded: false,
      authority: "none",
      executionEligible: false,
    });
  });

  it("accepts only an inert candidate with exact embedded identities and digests", () => {
    const valid = candidate();
    expect(
      FoundryDerivativeExecutionAuthorizationCandidateV1Schema.parse(valid),
    ).toEqual(valid);
    expect(valid).toMatchObject({
      authority: "none",
      executionEligible: false,
      dispatchEnabled: false,
      outputDisposition: "quarantine_only",
    });

    for (const changed of [
      { ...valid, reservationRequestSha256: sha(60) },
      { ...valid, baseExecutionSubjectSha256: sha(61) },
      { ...valid, jobSpecSha256: sha(62) },
      { ...valid, executionEnvelopeSha256: sha(63) },
      { ...valid, bindingSetSha256: sha(64) },
      { ...valid, restrictionLineageSetSha256: sha(65) },
      { ...valid, outputPolicySha256: sha(66) },
      { ...valid, candidateReservationReceiptSha256: sha(67) },
      { ...valid, candidateSha256: sha(68) },
      { ...valid, authority: "execution" },
      { ...valid, executionEligible: true },
      { ...valid, dispatchEnabled: true },
      { ...valid, outputDisposition: "release" },
      { ...valid, providerCommandId: "smuggled-command" },
    ]) {
      expect(
        FoundryDerivativeExecutionAuthorizationCandidateV1Schema.safeParse(
          changed,
        ).success,
      ).toBe(false);
    }

    expect(
      FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema.safeParse(
        {
          ...candidateMaterial(),
          assembledAt: derivativeApproval().expiresAt,
        },
      ).success,
    ).toBe(false);

    const lateReservationMaterial = {
      ...candidateReservationReceiptMaterial(),
      reservedAt: derivativeApproval().expiresAt,
    };
    const lateReservation = {
      ...lateReservationMaterial,
      reservationReceiptSha256:
        computeFoundryDerivativeCandidateReservationReceiptSha256(
          lateReservationMaterial,
        ),
    };
    expect(
      FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema.safeParse(
        {
          ...candidateMaterial(),
          candidateReservationReceipt: lateReservation,
          candidateReservationReceiptSha256:
            lateReservation.reservationReceiptSha256,
          assembledAt: "2026-07-14T12:00:00.001Z",
        },
      ).success,
    ).toBe(false);
  });

  it("domain-separates every SQL-mirrored request, registry, set, receipt, and candidate digest", () => {
    const attestation = registryAttestation();
    const revocation = revocationMaterial();
    const digests = [
      attestation.registrationRequestSha256,
      attestation.registryAttestationSha256,
      revocation.revocationRequestSha256,
      computeFoundryDerivativeRightsRegistryAttestationRevocationSha256(
        revocation,
      ),
      computeFoundryDerivativeExecutionBindingSetSha256(bindingSet()),
      computeFoundryDerivativeRestrictionLineageSetSha256(
        restrictionLineageSet(),
      ),
      computeFoundryDerivativeQuarantineOutputPolicySha256(outputPolicy()),
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        reservationRequestMaterial(),
      ),
      candidateReservationReceipt().reservationReceiptSha256,
      candidate().candidateSha256,
    ];
    expect(new Set(digests).size).toBe(digests.length);
    expect(digests).toEqual([
      "sha256:9bdb9454a55cc64e3de69b5143c46aa6764bbc896594d40f06302bb8c0a165cb",
      "sha256:d89241b55110b007c9385832fe98ad1ac1126ffbaabd2b7f0343a947dd554e05",
      "sha256:e7a109ae62d3b74bc1512a887b19ab248e3d19a2e33dcd0158a891da650e8a9d",
      "sha256:79e3c0d315c25632f19d8a73269cbc98fd7cceef039e8d4d9c4d24b492291cac",
      "sha256:d4a8a2d53ad8eb216de13dd47021bf0fbc658d446d6bcd97e506f1517f736ba4",
      "sha256:931e7bb5a64260660a96fbd9a2d40690c6885b935a5894149cce8f2f06faa91b",
      "sha256:47ef6ee316303369e75e872c3cbfebdfa8e6b25609b03fe14dc2721ea194476f",
      "sha256:a892f6a9bafb854f2551692a4da452ff91cffb21892fe5123f8a626231d470b5",
      "sha256:9a9e30fc01c2a6de89b86f93719049e350c06cf57ca1e47cf63b37900a2c1a14",
      "sha256:919c84eb1f40c53e6441207adcb4d6777b5ab53b8af4ca3600f42a123f9ee278",
    ]);
  });
});
