import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
  FoundryDerivativeRightsCanonicalUuidV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema,
  FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema,
} from "./omnitwin-foundry-derivative-rights-custody.js";
import {
  FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
  FoundryDerivativeRightsApprovalV0Schema,
  FoundryDerivativeRestrictionDispositionV0Schema,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsRestrictionSha256,
} from "./omnitwin-foundry-derivative-rights.js";
import { FoundryUtcInstantSchema } from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";

/**
 * Additive V1 registry and binding contracts for the one supported derivative
 * operation. These records are deliberately inert: parsing or hashing one does
 * not prove current registry state, atomic reservation uniqueness, or execution
 * authority.
 */
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1 =
  "omnitwin.foundry.derivative-rights-registry-attestation.v1";
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1 =
  "omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1";
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1 =
  "omnitwin.foundry.derivative-rights-registry-attestation-revocation.v1";
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1 =
  "omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1";
export const FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1 =
  "omnitwin.foundry.derivative-execution-binding-set.v1";
export const FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1 =
  "omnitwin.foundry.derivative-restriction-lineage-set.v1";
export const FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1 =
  "omnitwin.foundry.derivative-quarantine-output-policy.v1";
export const FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1 =
  "omnitwin.foundry.derivative-candidate-reservation-receipt.v1";
export const FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1 =
  "omnitwin.foundry.derivative-execution-authorization-candidate.v1";
export const FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1 =
  "omnitwin.foundry.derivative-execution-authorization-candidate-reservation-request.v1";

export const FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1 =
  "authenticated_registry_attestation_v1";
export const FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1 =
  "quarantine_only";
export const FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_DISPOSITION_V1 =
  "preserve_on_quarantined_derivative";
export const FOUNDRY_DERIVATIVE_AUTHORITY_NONE_CANDIDATE_RESERVATION_SCOPE_V1 =
  "authority_none_candidate_reservation";

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

function domainSeparatedDigest(domain: string, input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function isStrictlyAsciiSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || (values[index - 1] ?? value) < value,
  );
}

function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function boundedUnpaddedText(maxLength: number, label: string) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: `${label} must not contain leading or trailing whitespace`,
    })
    .refine(
      (value) => {
        if (value.includes("\u0000")) return false;
        for (let index = 0; index < value.length; index += 1) {
          const codeUnit = value.charCodeAt(index);
          if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
              return false;
            }
            index += 1;
          } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return false;
          }
        }
        return true;
      },
      {
        message: `${label} must contain only PostgreSQL/JSON-safe Unicode scalar values`,
      },
    );
}

const RegistryAttestationRegistrationInputFields = {
  approvalId: RuntimeManifestKeySchema,
  derivativeRightsApprovalSha256: RuntimeSha256Schema,
  reviewId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reviewReceiptSha256: RuntimeSha256Schema,
  custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  custodyReceiptSha256: RuntimeSha256Schema,
} as const;

/** Public request: the authenticated server resolves all evidence, actor, and time. */
export const FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema =
  z.object(RegistryAttestationRegistrationInputFields).strict();
export type FoundryDerivativeRightsRegistryAttestationRegistrationInputV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema
  >;

export const FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
      ),
      ...RegistryAttestationRegistrationInputFields,
    })
    .strict();
export type FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema
  >;

export function computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
  input: unknown,
): string {
  const request =
    FoundryDerivativeRightsRegistryAttestationRegistrationRequestMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
    request,
  );
}

const RegistryAttestationFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
  ),
  attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  registrationRequestSha256: RuntimeSha256Schema,
  derivativeRightsApproval: FoundryDerivativeRightsApprovalV0Schema,
  acceptedReviewReceipt:
    FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema,
  termsEvidenceCustodyReceipt:
    FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema,
  attestedByUserId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  attestedAt: FoundryUtcInstantSchema,
  registryAuthority: z.literal(FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1),
  executionEligible: z.literal(false),
} as const;

function refineRegistryAttestation(
  attestation: z.infer<z.ZodObject<typeof RegistryAttestationFields>>,
  ctx: z.RefinementCtx,
): void {
  const approval = attestation.derivativeRightsApproval;
  const review = attestation.acceptedReviewReceipt;
  const custody = attestation.termsEvidenceCustodyReceipt;
  const evidence = approval.assetRightsEvidence[0];

  const expectedRegistrationRequestSha256 =
    computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256({
      schemaVersion:
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
      approvalId: approval.approvalId,
      derivativeRightsApprovalSha256:
        computeFoundryDerivativeRightsApprovalSha256(approval),
      reviewId: review.reviewId,
      reviewReceiptSha256: review.reviewReceiptSha256,
      custodyId: custody.custodyId,
      custodyReceiptSha256: custody.custodyReceiptSha256,
    });
  if (
    attestation.registrationRequestSha256 !==
    expectedRegistrationRequestSha256
  ) {
    addIssue(
      ctx,
      ["registrationRequestSha256"],
      "registry attestation must bind the exact public registration request",
    );
  }

  if (
    approval.operation.operationId !== FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0 ||
    approval.operation.derivativeClass !==
      FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS
  ) {
    addIssue(
      ctx,
      ["derivativeRightsApproval", "operation"],
      "V1 registry attestation supports only normalize_mesh_glb/v0 lossless normalization",
    );
  }
  if (
    review.decision !==
    FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION
  ) {
    addIssue(
      ctx,
      ["acceptedReviewReceipt", "decision"],
      "registry attestation requires an accepted 0055 review receipt",
    );
  }
  if (
    review.approvalId !== approval.approvalId ||
    review.derivativeRightsApprovalSha256 !==
      computeFoundryDerivativeRightsApprovalSha256(approval)
  ) {
    addIssue(
      ctx,
      ["acceptedReviewReceipt"],
      "accepted review must bind the exact derivative-rights approval",
    );
  }
  if (
    review.custodyId !== custody.custodyId ||
    review.custodyReceiptSha256 !== custody.custodyReceiptSha256
  ) {
    addIssue(
      ctx,
      ["termsEvidenceCustodyReceipt"],
      "custody receipt must be the exact receipt accepted by the review",
    );
  }
  if (
    evidence === undefined ||
    evidence.termsEvidenceArtifact.artifactId !== custody.artifactId ||
    evidence.termsEvidenceArtifact.sha256 !== custody.contentSha256 ||
    evidence.termsEvidenceArtifact.sizeBytes !== custody.sizeBytes ||
    evidence.termsEvidenceArtifact.mediaType !== custody.mediaType ||
    evidence.termsEvidenceArtifact.capturedAt !== custody.capturedAt
  ) {
    addIssue(
      ctx,
      ["termsEvidenceCustodyReceipt"],
      "custody receipt must exactly match the approval terms-evidence artifact",
    );
  }
  if (
    Date.parse(approval.decidedAt) > Date.parse(review.reviewedAt) ||
    Date.parse(custody.verifiedAt) > Date.parse(review.reviewedAt) ||
    Date.parse(review.reviewedAt) > Date.parse(attestation.attestedAt)
  ) {
    addIssue(
      ctx,
      ["attestedAt"],
      "attestation chronology must follow approval, custody verification, and accepted review",
    );
  }
  if (Date.parse(attestation.attestedAt) >= Date.parse(approval.expiresAt)) {
    addIssue(
      ctx,
      ["attestedAt"],
      "registry attestation must be recorded before the approval expires",
    );
  }
}

const RegistryAttestationMaterialObjectSchema = z
  .object(RegistryAttestationFields)
  .strict();

export const FoundryDerivativeRightsRegistryAttestationMaterialV1Schema =
  RegistryAttestationMaterialObjectSchema.superRefine(refineRegistryAttestation);
export type FoundryDerivativeRightsRegistryAttestationMaterialV1 = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationMaterialV1Schema
>;

export function computeFoundryDerivativeRightsRegistryAttestationSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeRightsRegistryAttestationMaterialV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
    material,
  );
}

export const FoundryDerivativeRightsRegistryAttestationV1Schema = z
  .object({
    ...RegistryAttestationFields,
    registryAttestationSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((attestation, ctx) => {
    const material = {
      schemaVersion: attestation.schemaVersion,
      attestationId: attestation.attestationId,
      registrationRequestSha256: attestation.registrationRequestSha256,
      derivativeRightsApproval: attestation.derivativeRightsApproval,
      acceptedReviewReceipt: attestation.acceptedReviewReceipt,
      termsEvidenceCustodyReceipt: attestation.termsEvidenceCustodyReceipt,
      attestedByUserId: attestation.attestedByUserId,
      attestedAt: attestation.attestedAt,
      registryAuthority: attestation.registryAuthority,
      executionEligible: attestation.executionEligible,
    };
    const result =
      FoundryDerivativeRightsRegistryAttestationMaterialV1Schema.safeParse(
        material,
      );
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
      return;
    }
    const expected = domainSeparatedDigest(
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_V1,
      result.data,
    );
    if (attestation.registryAttestationSha256 !== expected) {
      addIssue(
        ctx,
        ["registryAttestationSha256"],
        "registry attestation digest must bind its exact canonical material",
      );
    }
  });
export type FoundryDerivativeRightsRegistryAttestationV1 = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationV1Schema
>;

const RegistryAttestationRevocationInputFields = {
  attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  registryAttestationSha256: RuntimeSha256Schema,
  reason: boundedUnpaddedText(2_000, "reason"),
} as const;

/** Public revocation request cannot supply actor, time, authority, or a digest. */
export const FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema =
  z.object(RegistryAttestationRevocationInputFields).strict();
export type FoundryDerivativeRightsRegistryAttestationRevocationInputV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema
  >;

export const FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
      ),
      ...RegistryAttestationRevocationInputFields,
    })
    .strict();
export type FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema
  >;

export function computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256(
  input: unknown,
): string {
  const request =
    FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
    request,
  );
}

const RegistryAttestationRevocationFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1,
  ),
  revocationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  revocationRequestSha256: RuntimeSha256Schema,
  attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  registryAttestationSha256: RuntimeSha256Schema,
  registryAttestation: FoundryDerivativeRightsRegistryAttestationV1Schema,
  revokedByUserId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  revokedAt: FoundryUtcInstantSchema,
  reason: boundedUnpaddedText(2_000, "reason"),
  registryAuthority: z.literal(FOUNDRY_DERIVATIVE_REGISTRY_AUTHORITY_V1),
  executionEligible: z.literal(false),
} as const;

const RegistryAttestationRevocationMaterialObjectSchema = z
  .object(RegistryAttestationRevocationFields)
  .strict();

export const FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1Schema =
  RegistryAttestationRevocationMaterialObjectSchema.superRefine(
    (revocation, ctx) => {
      if (
        revocation.attestationId !==
          revocation.registryAttestation.attestationId ||
        revocation.registryAttestationSha256 !==
          revocation.registryAttestation.registryAttestationSha256
      ) {
        addIssue(
          ctx,
          ["registryAttestation"],
          "revocation must bind the exact registry attestation identity and digest",
        );
      }
      const expectedRequestSha256 = domainSeparatedDigest(
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
        {
          schemaVersion:
            FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_REQUEST_V1,
          attestationId: revocation.attestationId,
          registryAttestationSha256:
            revocation.registryAttestationSha256,
          reason: revocation.reason,
        },
      );
      if (revocation.revocationRequestSha256 !== expectedRequestSha256) {
        addIssue(
          ctx,
          ["revocationRequestSha256"],
          "attestation revocation must bind the exact public revocation request",
        );
      }
      if (
        Date.parse(revocation.revokedAt) <
        Date.parse(revocation.registryAttestation.attestedAt)
      ) {
        addIssue(
          ctx,
          ["revokedAt"],
          "registry attestation cannot be revoked before it was recorded",
        );
      }
    },
  );
export type FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1Schema
  >;

export function computeFoundryDerivativeRightsRegistryAttestationRevocationSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1,
    material,
  );
}

export const FoundryDerivativeRightsRegistryAttestationRevocationV1Schema = z
  .object({
    ...RegistryAttestationRevocationFields,
    attestationRevocationSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((revocation, ctx) => {
    const material = {
      schemaVersion: revocation.schemaVersion,
      revocationId: revocation.revocationId,
      revocationRequestSha256: revocation.revocationRequestSha256,
      attestationId: revocation.attestationId,
      registryAttestationSha256: revocation.registryAttestationSha256,
      registryAttestation: revocation.registryAttestation,
      revokedByUserId: revocation.revokedByUserId,
      revokedAt: revocation.revokedAt,
      reason: revocation.reason,
      registryAuthority: revocation.registryAuthority,
      executionEligible: revocation.executionEligible,
    };
    const result =
      FoundryDerivativeRightsRegistryAttestationRevocationMaterialV1Schema.safeParse(
        material,
      );
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
      return;
    }
    const expected = domainSeparatedDigest(
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVOCATION_V1,
      result.data,
    );
    if (revocation.attestationRevocationSha256 !== expected) {
      addIssue(
        ctx,
        ["attestationRevocationSha256"],
        "attestation revocation digest must bind its exact canonical material",
      );
    }
  });
export type FoundryDerivativeRightsRegistryAttestationRevocationV1 = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationRevocationV1Schema
>;

export const FoundryDerivativeExecutionBindingV1Schema = z
  .object({
    bindingId: RuntimeManifestKeySchema,
    baseExecutionSubjectSha256: RuntimeSha256Schema,
    projectId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    jobSubjectSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    workerProfileSha256: RuntimeSha256Schema,
    operationClass: z.literal("deterministic_transformation"),
    stageId: RuntimeManifestKeySchema,
    operationId: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0),
    derivativeClass: z.literal(
      FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    ),
    assetId: RuntimeManifestKeySchema,
    policyVersion: RuntimeManifestKeySchema,
    policyDefinitionSha256: RuntimeSha256Schema,
    policyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    approvalId: RuntimeManifestKeySchema,
    derivativeRightsApprovalSha256: RuntimeSha256Schema,
    reviewId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    reviewReceiptSha256: RuntimeSha256Schema,
    custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    custodyReceiptSha256: RuntimeSha256Schema,
    termsEvidenceArtifactId: RuntimeManifestKeySchema,
    termsEvidenceContentSha256: RuntimeSha256Schema,
    termsEvidenceSizeBytes: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    termsEvidenceMediaType: boundedUnpaddedText(160, "termsEvidenceMediaType"),
    termsEvidenceCapturedAt: FoundryUtcInstantSchema,
    attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    registryAttestationSha256: RuntimeSha256Schema,
  })
  .strict();
export type FoundryDerivativeExecutionBindingV1 = z.infer<
  typeof FoundryDerivativeExecutionBindingV1Schema
>;

export const FoundryDerivativeExecutionBindingSetV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1),
    bindingIds: z.array(RuntimeManifestKeySchema).length(1),
    assetIds: z.array(RuntimeManifestKeySchema).length(1),
    bindings: z.array(FoundryDerivativeExecutionBindingV1Schema).length(1),
  })
  .strict()
  .superRefine((bindingSet, ctx) => {
    const bindingIds = bindingSet.bindings.map((binding) => binding.bindingId);
    const assetIds = bindingSet.bindings.map((binding) => binding.assetId);
    if (
      !isStrictlyAsciiSorted(bindingSet.bindingIds) ||
      !sameOrderedStrings(bindingSet.bindingIds, bindingIds)
    ) {
      addIssue(
        ctx,
        ["bindingIds"],
        "binding IDs must be unique, canonical ASCII-sorted, and exactly match bindings",
      );
    }
    if (
      !isStrictlyAsciiSorted(bindingSet.assetIds) ||
      !sameOrderedStrings(bindingSet.assetIds, assetIds)
    ) {
      addIssue(
        ctx,
        ["assetIds"],
        "asset IDs must be unique, canonical ASCII-sorted, and exactly match bindings",
      );
    }
  });
export type FoundryDerivativeExecutionBindingSetV1 = z.infer<
  typeof FoundryDerivativeExecutionBindingSetV1Schema
>;

export function computeFoundryDerivativeExecutionBindingSetSha256(
  input: unknown,
): string {
  const bindingSet = FoundryDerivativeExecutionBindingSetV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
    bindingSet,
  );
}

export const FoundryDerivativeRestrictionLineageEntryV1Schema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    restriction: FoundryDerivativeRestrictionDispositionV0Schema,
    lineageDisposition: z.literal(
      FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_DISPOSITION_V1,
    ),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const expected = computeFoundryDerivativeRightsRestrictionSha256({
      assetId: entry.assetId,
      restrictionIndex: entry.restriction.restrictionIndex,
      restrictionText: entry.restriction.restrictionText,
    });
    if (entry.restriction.restrictionSha256 !== expected) {
      addIssue(
        ctx,
        ["restriction", "restrictionSha256"],
        "restriction lineage must bind the exact ordered restriction subject",
      );
    }
  });
export type FoundryDerivativeRestrictionLineageEntryV1 = z.infer<
  typeof FoundryDerivativeRestrictionLineageEntryV1Schema
>;

export const FoundryDerivativeRestrictionLineageSetV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1),
    approvalId: RuntimeManifestKeySchema,
    derivativeRightsApprovalSha256: RuntimeSha256Schema,
    reviewId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    reviewReceiptSha256: RuntimeSha256Schema,
    custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    custodyReceiptSha256: RuntimeSha256Schema,
    attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
    registryAttestationSha256: RuntimeSha256Schema,
    bindingSetSha256: RuntimeSha256Schema,
    assetIds: z.array(RuntimeManifestKeySchema).length(1),
    entries: z.array(FoundryDerivativeRestrictionLineageEntryV1Schema).max(50),
  })
  .strict()
  .superRefine((lineageSet, ctx) => {
    if (!isStrictlyAsciiSorted(lineageSet.assetIds)) {
      addIssue(
        ctx,
        ["assetIds"],
        "restriction-lineage asset IDs must be unique and canonical ASCII-sorted",
      );
    }
    let previousAssetId: string | undefined;
    let previousRestrictionIndex: number | undefined;
    for (const [index, entry] of lineageSet.entries.entries()) {
      if (!lineageSet.assetIds.includes(entry.assetId)) {
        addIssue(
          ctx,
          ["entries", index, "assetId"],
          "restriction lineage entry references an asset outside the canonical asset set",
        );
      }
      if (
        previousAssetId !== undefined &&
        (entry.assetId < previousAssetId ||
          (entry.assetId === previousAssetId &&
            entry.restriction.restrictionIndex <=
              (previousRestrictionIndex ?? -1)))
      ) {
        addIssue(
          ctx,
          ["entries", index],
          "restriction lineage entries must be uniquely sorted by asset ID then restriction index",
        );
      }
      if (
        entry.assetId !== previousAssetId &&
        entry.restriction.restrictionIndex !== 0
      ) {
        addIssue(
          ctx,
          ["entries", index, "restriction", "restrictionIndex"],
          "restriction lineage for each asset must begin at index zero",
        );
      }
      if (
        entry.assetId === previousAssetId &&
        entry.restriction.restrictionIndex !==
          (previousRestrictionIndex ?? -1) + 1
      ) {
        addIssue(
          ctx,
          ["entries", index, "restriction", "restrictionIndex"],
          "restriction lineage indices must be contiguous for each asset",
        );
      }
      previousAssetId = entry.assetId;
      previousRestrictionIndex = entry.restriction.restrictionIndex;
    }
  });
export type FoundryDerivativeRestrictionLineageSetV1 = z.infer<
  typeof FoundryDerivativeRestrictionLineageSetV1Schema
>;

export function computeFoundryDerivativeRestrictionLineageSetSha256(
  input: unknown,
): string {
  const lineageSet =
    FoundryDerivativeRestrictionLineageSetV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
    lineageSet,
  );
}

export const FoundryDerivativeQuarantineOutputPolicyV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1),
    outputDisposition: z.literal(
      FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
    ),
    releaseEligible: z.literal(false),
    publicationEligible: z.literal(false),
    redistributionEligible: z.literal(false),
    runtimePromotionEligible: z.literal(false),
    signingEligible: z.literal(false),
    restrictionLineageRequired: z.literal(true),
    authorityRevalidationRequiredAtOutputCommit: z.literal(true),
  })
  .strict();
export type FoundryDerivativeQuarantineOutputPolicyV1 = z.infer<
  typeof FoundryDerivativeQuarantineOutputPolicyV1Schema
>;

export function computeFoundryDerivativeQuarantineOutputPolicySha256(
  input: unknown,
): string {
  const policy = FoundryDerivativeQuarantineOutputPolicyV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
    policy,
  );
}

const CandidateReservationReceiptMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
  ),
  reservationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reservationRequestSha256: RuntimeSha256Schema,
  approvalId: RuntimeManifestKeySchema,
  derivativeRightsApprovalSha256: RuntimeSha256Schema,
  reviewId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reviewReceiptSha256: RuntimeSha256Schema,
  attestationId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  registryAttestationSha256: RuntimeSha256Schema,
  baseExecutionSubjectSha256: RuntimeSha256Schema,
  projectId: RuntimeManifestKeySchema,
  jobId: RuntimeManifestKeySchema,
  jobSpecSha256: RuntimeSha256Schema,
  executionEnvelopeSha256: RuntimeSha256Schema,
  ingestManifestSha256: RuntimeSha256Schema,
  jobSubjectSha256: RuntimeSha256Schema,
  bindingSetSha256: RuntimeSha256Schema,
  restrictionLineageSetSha256: RuntimeSha256Schema,
  outputPolicySha256: RuntimeSha256Schema,
  reservationOrdinal: z.literal(1),
  singleReservation: z.literal(true),
  reservationScope: z.literal(
    FOUNDRY_DERIVATIVE_AUTHORITY_NONE_CANDIDATE_RESERVATION_SCOPE_V1,
  ),
  executionActivationRecorded: z.literal(false),
  reservedByUserId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reservedAt: FoundryUtcInstantSchema,
  authority: z.literal("none"),
  executionEligible: z.literal(false),
} as const;

export const FoundryDerivativeCandidateReservationReceiptMaterialV1Schema = z
  .object(CandidateReservationReceiptMaterialFields)
  .strict();
export type FoundryDerivativeCandidateReservationReceiptMaterialV1 = z.infer<
  typeof FoundryDerivativeCandidateReservationReceiptMaterialV1Schema
>;

export function computeFoundryDerivativeCandidateReservationReceiptSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeCandidateReservationReceiptMaterialV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_CANDIDATE_RESERVATION_RECEIPT_V1,
    material,
  );
}

export const FoundryDerivativeCandidateReservationReceiptV1Schema = z
  .object({
    ...CandidateReservationReceiptMaterialFields,
    reservationReceiptSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const material = {
      schemaVersion: receipt.schemaVersion,
      reservationId: receipt.reservationId,
      reservationRequestSha256: receipt.reservationRequestSha256,
      approvalId: receipt.approvalId,
      derivativeRightsApprovalSha256:
        receipt.derivativeRightsApprovalSha256,
      reviewId: receipt.reviewId,
      reviewReceiptSha256: receipt.reviewReceiptSha256,
      attestationId: receipt.attestationId,
      registryAttestationSha256: receipt.registryAttestationSha256,
      baseExecutionSubjectSha256: receipt.baseExecutionSubjectSha256,
      projectId: receipt.projectId,
      jobId: receipt.jobId,
      jobSpecSha256: receipt.jobSpecSha256,
      executionEnvelopeSha256: receipt.executionEnvelopeSha256,
      ingestManifestSha256: receipt.ingestManifestSha256,
      jobSubjectSha256: receipt.jobSubjectSha256,
      bindingSetSha256: receipt.bindingSetSha256,
      restrictionLineageSetSha256: receipt.restrictionLineageSetSha256,
      outputPolicySha256: receipt.outputPolicySha256,
      reservationOrdinal: receipt.reservationOrdinal,
      singleReservation: receipt.singleReservation,
      reservationScope: receipt.reservationScope,
      executionActivationRecorded: receipt.executionActivationRecorded,
      reservedByUserId: receipt.reservedByUserId,
      reservedAt: receipt.reservedAt,
      authority: receipt.authority,
      executionEligible: receipt.executionEligible,
    };
    const expected =
      computeFoundryDerivativeCandidateReservationReceiptSha256(material);
    if (receipt.reservationReceiptSha256 !== expected) {
      addIssue(
        ctx,
        ["reservationReceiptSha256"],
        "candidate reservation receipt digest must bind its exact canonical material",
      );
    }
  });
export type FoundryDerivativeCandidateReservationReceiptV1 = z.infer<
  typeof FoundryDerivativeCandidateReservationReceiptV1Schema
>;

const CandidateReservationInputFields = {
  baseExecutionSubjectSha256: RuntimeSha256Schema,
  projectId: RuntimeManifestKeySchema,
  jobId: RuntimeManifestKeySchema,
  jobSpecSha256: RuntimeSha256Schema,
  executionEnvelopeSha256: RuntimeSha256Schema,
  ingestManifestSha256: RuntimeSha256Schema,
  jobSubjectSha256: RuntimeSha256Schema,
  registryAttestationSha256: RuntimeSha256Schema,
  bindingSetSha256: RuntimeSha256Schema,
  restrictionLineageSetSha256: RuntimeSha256Schema,
  outputPolicySha256: RuntimeSha256Schema,
} as const;

/**
 * Public reservation request. A successful request can only reserve evidence
 * for an inert candidate; it is not the future execution activation step.
 */
export const FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema =
  z.object(CandidateReservationInputFields).strict();
export type FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1 =
  z.infer<
    typeof FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema
  >;

export const FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
      ),
      ...CandidateReservationInputFields,
    })
    .strict();
export type FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1 =
  z.infer<
    typeof FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema
  >;

export function computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
  input: unknown,
): string {
  const request =
    FoundryDerivativeExecutionAuthorizationCandidateReservationRequestMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
    request,
  );
}

const CandidateMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
  ),
  candidateId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reservationRequestSha256: RuntimeSha256Schema,
  baseExecutionSubjectSha256: RuntimeSha256Schema,
  projectId: RuntimeManifestKeySchema,
  jobId: RuntimeManifestKeySchema,
  jobSpecSha256: RuntimeSha256Schema,
  executionEnvelopeSha256: RuntimeSha256Schema,
  ingestManifestSha256: RuntimeSha256Schema,
  jobSubjectSha256: RuntimeSha256Schema,
  registryAttestation: FoundryDerivativeRightsRegistryAttestationV1Schema,
  registryAttestationSha256: RuntimeSha256Schema,
  bindingSet: FoundryDerivativeExecutionBindingSetV1Schema,
  bindingSetSha256: RuntimeSha256Schema,
  restrictionLineageSet: FoundryDerivativeRestrictionLineageSetV1Schema,
  restrictionLineageSetSha256: RuntimeSha256Schema,
  outputPolicy: FoundryDerivativeQuarantineOutputPolicyV1Schema,
  outputPolicySha256: RuntimeSha256Schema,
  candidateReservationReceipt:
    FoundryDerivativeCandidateReservationReceiptV1Schema,
  candidateReservationReceiptSha256: RuntimeSha256Schema,
  outputDisposition: z.literal(
    FOUNDRY_DERIVATIVE_QUARANTINE_ONLY_OUTPUT_DISPOSITION_V1,
  ),
  authority: z.literal("none"),
  executionEligible: z.literal(false),
  dispatchEnabled: z.literal(false),
  assembledAt: FoundryUtcInstantSchema,
} as const;

type CandidateMaterial = z.infer<z.ZodObject<typeof CandidateMaterialFields>>;

function refineCandidate(candidate: CandidateMaterial, ctx: z.RefinementCtx): void {
  const attestation = candidate.registryAttestation;
  const approval = attestation.derivativeRightsApproval;
  const review = attestation.acceptedReviewReceipt;
  const custody = attestation.termsEvidenceCustodyReceipt;
  const binding = candidate.bindingSet.bindings[0];
  const evidence = approval.assetRightsEvidence[0];

  const expectedReservationRequestSha256 =
    computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
      {
        schemaVersion:
          FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
        baseExecutionSubjectSha256: candidate.baseExecutionSubjectSha256,
        projectId: candidate.projectId,
        jobId: candidate.jobId,
        jobSpecSha256: candidate.jobSpecSha256,
        executionEnvelopeSha256: candidate.executionEnvelopeSha256,
        ingestManifestSha256: candidate.ingestManifestSha256,
        jobSubjectSha256: candidate.jobSubjectSha256,
        registryAttestationSha256: candidate.registryAttestationSha256,
        bindingSetSha256: candidate.bindingSetSha256,
        restrictionLineageSetSha256:
          candidate.restrictionLineageSetSha256,
        outputPolicySha256: candidate.outputPolicySha256,
      },
    );
  if (candidate.reservationRequestSha256 !== expectedReservationRequestSha256) {
    addIssue(
      ctx,
      ["reservationRequestSha256"],
      "candidate must bind the exact authority-none reservation request",
    );
  }

  const expectedAttestationSha256 = attestation.registryAttestationSha256;
  const expectedBindingSetSha256 =
    computeFoundryDerivativeExecutionBindingSetSha256(candidate.bindingSet);
  const expectedLineageSetSha256 =
    computeFoundryDerivativeRestrictionLineageSetSha256(
      candidate.restrictionLineageSet,
    );
  const expectedOutputPolicySha256 =
    computeFoundryDerivativeQuarantineOutputPolicySha256(
      candidate.outputPolicy,
    );
  if (
    candidate.registryAttestationSha256 !== expectedAttestationSha256 ||
    candidate.bindingSetSha256 !== expectedBindingSetSha256 ||
    candidate.restrictionLineageSetSha256 !== expectedLineageSetSha256 ||
    candidate.outputPolicySha256 !== expectedOutputPolicySha256 ||
    candidate.candidateReservationReceiptSha256 !==
      candidate.candidateReservationReceipt.reservationReceiptSha256
  ) {
    addIssue(
      ctx,
      ["bindingSetSha256"],
      "candidate component digests must bind the exact embedded canonical components",
    );
  }

  if (
    binding === undefined ||
    binding.baseExecutionSubjectSha256 !==
      candidate.baseExecutionSubjectSha256 ||
    binding.projectId !== candidate.projectId ||
    binding.jobId !== candidate.jobId ||
    binding.jobSpecSha256 !== candidate.jobSpecSha256 ||
    binding.executionEnvelopeSha256 !== candidate.executionEnvelopeSha256 ||
    binding.jobSubjectSha256 !== candidate.jobSubjectSha256 ||
    binding.ingestManifestSha256 !== candidate.ingestManifestSha256 ||
    binding.stageId !== approval.stageId ||
    binding.operationId !== approval.operation.operationId ||
    binding.derivativeClass !== approval.operation.derivativeClass ||
    binding.assetId !== approval.assetIds[0] ||
    binding.policyVersion !== approval.policyVersion ||
    binding.policyDefinitionSha256 !== approval.policyDefinitionSha256 ||
    binding.policyGeneration !== approval.policyGeneration ||
    binding.approvalId !== approval.approvalId ||
    binding.derivativeRightsApprovalSha256 !==
      computeFoundryDerivativeRightsApprovalSha256(approval) ||
    binding.reviewId !== review.reviewId ||
    binding.reviewReceiptSha256 !== review.reviewReceiptSha256 ||
    binding.custodyId !== custody.custodyId ||
    binding.custodyReceiptSha256 !== custody.custodyReceiptSha256 ||
    binding.attestationId !== attestation.attestationId ||
    binding.registryAttestationSha256 !==
      attestation.registryAttestationSha256 ||
    binding.termsEvidenceArtifactId !== custody.artifactId ||
    binding.termsEvidenceContentSha256 !== custody.contentSha256 ||
    binding.termsEvidenceSizeBytes !== custody.sizeBytes ||
    binding.termsEvidenceMediaType !== custody.mediaType ||
    binding.termsEvidenceCapturedAt !== custody.capturedAt
  ) {
    addIssue(
      ctx,
      ["bindingSet"],
      "singleton binding must exactly bind the execution subject and attested approval/review/custody identities",
    );
  }

  const lineage = candidate.restrictionLineageSet;
  if (
    lineage.approvalId !== approval.approvalId ||
    lineage.derivativeRightsApprovalSha256 !==
      computeFoundryDerivativeRightsApprovalSha256(approval) ||
    lineage.reviewId !== review.reviewId ||
    lineage.reviewReceiptSha256 !== review.reviewReceiptSha256 ||
    lineage.custodyId !== custody.custodyId ||
    lineage.custodyReceiptSha256 !== custody.custodyReceiptSha256 ||
    lineage.attestationId !== attestation.attestationId ||
    lineage.registryAttestationSha256 !==
      attestation.registryAttestationSha256 ||
    lineage.bindingSetSha256 !== expectedBindingSetSha256 ||
    !sameOrderedStrings(lineage.assetIds, approval.assetIds)
  ) {
    addIssue(
      ctx,
      ["restrictionLineageSet"],
      "restriction lineage must bind the exact attested approval and binding set",
    );
  }
  const expectedRestrictions = evidence?.restrictionDispositions ?? [];
  if (lineage.entries.length !== expectedRestrictions.length) {
    addIssue(
      ctx,
      ["restrictionLineageSet", "entries"],
      "restriction lineage must contain every approval restriction exactly once",
    );
  } else {
    for (const [index, entry] of lineage.entries.entries()) {
      const expected = expectedRestrictions[index];
      if (
        expected === undefined ||
        entry.assetId !== approval.assetIds[0] ||
        stableCanonicalJson(CanonicalJsonValueSchema.parse(entry.restriction)) !==
          stableCanonicalJson(CanonicalJsonValueSchema.parse(expected))
      ) {
        addIssue(
          ctx,
          ["restrictionLineageSet", "entries", index],
          "restriction lineage entry must exactly match the ordered approval disposition",
        );
      }
      if (
        entry.restriction.supportingEvidenceSha256 !== custody.contentSha256
      ) {
        addIssue(
          ctx,
          [
            "restrictionLineageSet",
            "entries",
            index,
            "restriction",
            "supportingEvidenceSha256",
          ],
          "restriction lineage must retain the attested custody content digest",
        );
      }
    }
  }

  const reservation = candidate.candidateReservationReceipt;
  if (
    reservation.approvalId !== approval.approvalId ||
    reservation.reservationRequestSha256 !==
      candidate.reservationRequestSha256 ||
    reservation.derivativeRightsApprovalSha256 !==
      computeFoundryDerivativeRightsApprovalSha256(approval) ||
    reservation.reviewId !== review.reviewId ||
    reservation.reviewReceiptSha256 !== review.reviewReceiptSha256 ||
    reservation.attestationId !== attestation.attestationId ||
    reservation.registryAttestationSha256 !==
      attestation.registryAttestationSha256 ||
    reservation.baseExecutionSubjectSha256 !==
      candidate.baseExecutionSubjectSha256 ||
    reservation.projectId !== candidate.projectId ||
    reservation.jobId !== candidate.jobId ||
    reservation.jobSpecSha256 !== candidate.jobSpecSha256 ||
    reservation.executionEnvelopeSha256 !== candidate.executionEnvelopeSha256 ||
    reservation.ingestManifestSha256 !== candidate.ingestManifestSha256 ||
    reservation.jobSubjectSha256 !== candidate.jobSubjectSha256 ||
    reservation.bindingSetSha256 !== expectedBindingSetSha256 ||
    reservation.restrictionLineageSetSha256 !== expectedLineageSetSha256 ||
    reservation.outputPolicySha256 !== expectedOutputPolicySha256
  ) {
    addIssue(
      ctx,
      ["candidateReservationReceipt"],
      "single reservation receipt must bind this exact candidate subject and all derivative components",
    );
  }
  if (
    Date.parse(reservation.reservedAt) < Date.parse(attestation.attestedAt) ||
    Date.parse(candidate.assembledAt) < Date.parse(reservation.reservedAt)
  ) {
    addIssue(
      ctx,
      ["assembledAt"],
      "candidate assembly must follow attestation and its reservation receipt",
    );
  }
  const approvalExpiresAt = Date.parse(approval.expiresAt);
  if (
    Date.parse(reservation.reservedAt) >= approvalExpiresAt ||
    Date.parse(candidate.assembledAt) >= approvalExpiresAt
  ) {
    addIssue(
      ctx,
      ["assembledAt"],
      "candidate reservation and assembly must complete before the derivative approval expires",
    );
  }
}

const CandidateMaterialObjectSchema = z
  .object(CandidateMaterialFields)
  .strict();

export const FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema =
  CandidateMaterialObjectSchema.superRefine(refineCandidate);
export type FoundryDerivativeExecutionAuthorizationCandidateMaterialV1 =
  z.infer<
    typeof FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema
  >;

export function computeFoundryDerivativeExecutionAuthorizationCandidateSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
    material,
  );
}

export const FoundryDerivativeExecutionAuthorizationCandidateV1Schema = z
  .object({
    ...CandidateMaterialFields,
    candidateSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((candidate, ctx) => {
    const material = {
      schemaVersion: candidate.schemaVersion,
      candidateId: candidate.candidateId,
      reservationRequestSha256: candidate.reservationRequestSha256,
      baseExecutionSubjectSha256: candidate.baseExecutionSubjectSha256,
      projectId: candidate.projectId,
      jobId: candidate.jobId,
      jobSpecSha256: candidate.jobSpecSha256,
      executionEnvelopeSha256: candidate.executionEnvelopeSha256,
      ingestManifestSha256: candidate.ingestManifestSha256,
      jobSubjectSha256: candidate.jobSubjectSha256,
      registryAttestation: candidate.registryAttestation,
      registryAttestationSha256: candidate.registryAttestationSha256,
      bindingSet: candidate.bindingSet,
      bindingSetSha256: candidate.bindingSetSha256,
      restrictionLineageSet: candidate.restrictionLineageSet,
      restrictionLineageSetSha256: candidate.restrictionLineageSetSha256,
      outputPolicy: candidate.outputPolicy,
      outputPolicySha256: candidate.outputPolicySha256,
      candidateReservationReceipt: candidate.candidateReservationReceipt,
      candidateReservationReceiptSha256:
        candidate.candidateReservationReceiptSha256,
      outputDisposition: candidate.outputDisposition,
      authority: candidate.authority,
      executionEligible: candidate.executionEligible,
      dispatchEnabled: candidate.dispatchEnabled,
      assembledAt: candidate.assembledAt,
    };
    const result =
      FoundryDerivativeExecutionAuthorizationCandidateMaterialV1Schema.safeParse(
        material,
      );
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
      return;
    }
    const expected = domainSeparatedDigest(
      FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_V1,
      result.data,
    );
    if (candidate.candidateSha256 !== expected) {
      addIssue(
        ctx,
        ["candidateSha256"],
        "candidate digest must bind its exact canonical material",
      );
    }
  });
export type FoundryDerivativeExecutionAuthorizationCandidateV1 = z.infer<
  typeof FoundryDerivativeExecutionAuthorizationCandidateV1Schema
>;
