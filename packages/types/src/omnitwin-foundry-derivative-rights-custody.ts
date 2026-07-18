import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { FoundryUtcInstantSchema } from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";

/**
 * Review-only contracts for custody of the exact terms-evidence bytes bound by
 * a derivative-rights approval. Neither custody nor review creates execution,
 * registry, provider, signing, promotion, publication, or release authority.
 */
export const FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1 =
  "omnitwin.foundry.derivative-terms-evidence-custody-request.v1";
export const FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1 =
  "omnitwin.foundry.derivative-terms-evidence-custody-receipt.v1";
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1 =
  "omnitwin.foundry.derivative-rights-review-request.v1";
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1 =
  "omnitwin.foundry.derivative-rights-review-receipt.v1";
export const FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1 =
  "postgres_inline_bytea_v1";
export const FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_MAX_INLINE_BYTES_V1 = 4_194_304;
export const FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION =
  "accepted_for_registry_attestation";

export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_DECISIONS_V1 =
  [
    FOUNDRY_DERIVATIVE_RIGHTS_ACCEPTED_FOR_REGISTRY_ATTESTATION,
    "rejected",
  ] as const;
export const FoundryDerivativeRightsRegistryAttestationReviewDecisionSchema =
  z.enum(FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_DECISIONS_V1);
export type FoundryDerivativeRightsRegistryAttestationReviewDecision = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationReviewDecisionSchema
>;

/** Compatibility names retained while callers adopt the terms-evidence vocabulary. */
export const FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_REGISTRATION_REQUEST_V1 =
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1;
export const FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_RECEIPT_V1 =
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1;
export const FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_STORAGE_MODE_V1 =
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1;
export const FOUNDRY_DERIVATIVE_RIGHTS_CUSTODY_MAX_BYTES_V1 =
  FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_MAX_INLINE_BYTES_V1;
export const FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_DECISIONS =
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_DECISIONS_V1;

const LOWERCASE_RFC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const FoundryDerivativeRightsCanonicalUuidV1Schema = z
  .string()
  .uuid()
  .regex(LOWERCASE_RFC_UUID, "UUID must use canonical lowercase RFC form");

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

const MediaTypeSchema = boundedUnpaddedText(160, "mediaType");
const RationaleSchema = boundedUnpaddedText(2_000, "rationale");
const SizeBytesSchema = z
  .number()
  .int()
  .safe()
  .min(1)
  .max(FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_MAX_INLINE_BYTES_V1);

function domainSeparatedDigest(domain: string, input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

const CustodySubjectFields = {
  artifactId: RuntimeManifestKeySchema,
  mediaType: MediaTypeSchema,
  contentSha256: RuntimeSha256Schema,
  sizeBytes: SizeBytesSchema,
} as const;

/** Public upload metadata. The server derives digest and size from decoded bytes. */
export const FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema = z
  .object({
    artifactId: CustodySubjectFields.artifactId,
    mediaType: CustodySubjectFields.mediaType,
  })
  .strict();
export type FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1 = z.infer<
  typeof FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema
>;

const CustodyRegistrationRequestMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
  ),
  ...CustodySubjectFields,
} as const;

/** Server-derived material after hashing and counting the decoded raw bytes. */
export const FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema =
  z.object(CustodyRegistrationRequestMaterialFields).strict();
export type FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1 =
  z.infer<
    typeof FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema
  >;

export function computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
    material,
  );
}

const CustodyReceiptMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1,
  ),
  custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  registrationRequestSha256: RuntimeSha256Schema,
  ...CustodySubjectFields,
  storageMode: z.literal(FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_STORAGE_MODE_V1),
  capturedAt: FoundryUtcInstantSchema,
  registeredByUserId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  verifiedAt: FoundryUtcInstantSchema,
  authority: z.literal("none"),
  executionEligible: z.literal(false),
} as const;

const CustodyReceiptMaterialObjectSchema = z
  .object(CustodyReceiptMaterialFields)
  .strict();

export const FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1Schema =
  CustodyReceiptMaterialObjectSchema.superRefine((receipt, ctx) => {
    const expectedRequestSha256 =
      computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256({
        schemaVersion:
          FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_REGISTRATION_REQUEST_V1,
        artifactId: receipt.artifactId,
        mediaType: receipt.mediaType,
        contentSha256: receipt.contentSha256,
        sizeBytes: receipt.sizeBytes,
      });
    if (receipt.registrationRequestSha256 !== expectedRequestSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationRequestSha256"],
        message:
          "custody receipt must bind the exact server-derived registration request material",
      });
    }
    if (Date.parse(receipt.capturedAt) > Date.parse(receipt.verifiedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capturedAt"],
        message: "capturedAt must not be later than verifiedAt",
      });
    }
  });
export type FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1 = z.infer<
  typeof FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1Schema
>;

export function computeFoundryDerivativeTermsEvidenceCustodyReceiptSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1Schema.parse(input);
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1,
    material,
  );
}

export const FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema = z
  .object({
    ...CustodyReceiptMaterialFields,
    custodyReceiptSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const material = {
      schemaVersion: receipt.schemaVersion,
      custodyId: receipt.custodyId,
      registrationRequestSha256: receipt.registrationRequestSha256,
      artifactId: receipt.artifactId,
      mediaType: receipt.mediaType,
      contentSha256: receipt.contentSha256,
      sizeBytes: receipt.sizeBytes,
      storageMode: receipt.storageMode,
      capturedAt: receipt.capturedAt,
      registeredByUserId: receipt.registeredByUserId,
      verifiedAt: receipt.verifiedAt,
      authority: receipt.authority,
      executionEligible: receipt.executionEligible,
    };
    const parsedMaterial =
      FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1Schema.safeParse(
        material,
      );
    if (!parsedMaterial.success) {
      for (const issue of parsedMaterial.error.issues) ctx.addIssue(issue);
      return;
    }
    const expectedReceiptSha256 = domainSeparatedDigest(
      FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_CUSTODY_RECEIPT_V1,
      parsedMaterial.data,
    );
    if (receipt.custodyReceiptSha256 !== expectedReceiptSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custodyReceiptSha256"],
        message:
          "custody receipt digest must bind its exact canonical material",
      });
    }
  });
export type FoundryDerivativeTermsEvidenceCustodyReceiptV1 = z.infer<
  typeof FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema
>;

export const FoundryDerivativeTermsEvidenceCustodyRegistrationResultV1Schema =
  FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema;
export type FoundryDerivativeTermsEvidenceCustodyRegistrationResultV1 =
  FoundryDerivativeTermsEvidenceCustodyReceiptV1;

const ReviewInputFields = {
  approvalId: RuntimeManifestKeySchema,
  custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  custodyReceiptSha256: RuntimeSha256Schema,
  decision: FoundryDerivativeRightsRegistryAttestationReviewDecisionSchema,
  rationale: RationaleSchema,
} as const;

/** Public review input. Approval digest, actor, and time are server-resolved. */
export const FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema = z
  .object(ReviewInputFields)
  .strict();
export type FoundryDerivativeRightsRegistryAttestationReviewInputV1 = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema
>;

const ReviewRequestMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
  ),
  approvalId: ReviewInputFields.approvalId,
  derivativeRightsApprovalSha256: RuntimeSha256Schema,
  custodyId: ReviewInputFields.custodyId,
  custodyReceiptSha256: ReviewInputFields.custodyReceiptSha256,
  decision: ReviewInputFields.decision,
  rationale: ReviewInputFields.rationale,
} as const;

export const FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema =
  z.object(ReviewRequestMaterialFields).strict();
export type FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema
  >;

export function computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeRightsRegistryAttestationReviewRequestMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
    material,
  );
}

const ReviewReceiptMaterialFields = {
  schemaVersion: z.literal(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
  ),
  reviewId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reviewRequestSha256: RuntimeSha256Schema,
  approvalId: ReviewRequestMaterialFields.approvalId,
  derivativeRightsApprovalSha256:
    ReviewRequestMaterialFields.derivativeRightsApprovalSha256,
  custodyId: ReviewRequestMaterialFields.custodyId,
  custodyReceiptSha256: ReviewRequestMaterialFields.custodyReceiptSha256,
  decision: ReviewRequestMaterialFields.decision,
  rationale: ReviewRequestMaterialFields.rationale,
  reviewedByUserId: FoundryDerivativeRightsCanonicalUuidV1Schema,
  reviewedAt: FoundryUtcInstantSchema,
  authority: z.literal("none"),
  executionEligible: z.literal(false),
} as const;

const ReviewReceiptMaterialObjectSchema = z
  .object(ReviewReceiptMaterialFields)
  .strict();

export const FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1Schema =
  ReviewReceiptMaterialObjectSchema.superRefine((receipt, ctx) => {
    const expectedRequestSha256 =
      computeFoundryDerivativeRightsRegistryAttestationReviewRequestSha256({
        schemaVersion:
          FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_REQUEST_V1,
        approvalId: receipt.approvalId,
        derivativeRightsApprovalSha256: receipt.derivativeRightsApprovalSha256,
        custodyId: receipt.custodyId,
        custodyReceiptSha256: receipt.custodyReceiptSha256,
        decision: receipt.decision,
        rationale: receipt.rationale,
      });
    if (receipt.reviewRequestSha256 !== expectedRequestSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewRequestSha256"],
        message:
          "registry-attestation review receipt must bind the exact server-resolved review request material",
      });
    }
  });
export type FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1 =
  z.infer<
    typeof FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1Schema
  >;

export function computeFoundryDerivativeRightsRegistryAttestationReviewReceiptSha256(
  input: unknown,
): string {
  const material =
    FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1Schema.parse(
      input,
    );
  return domainSeparatedDigest(
    FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
    material,
  );
}

export const FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema = z
  .object({
    ...ReviewReceiptMaterialFields,
    reviewReceiptSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const material = {
      schemaVersion: receipt.schemaVersion,
      reviewId: receipt.reviewId,
      reviewRequestSha256: receipt.reviewRequestSha256,
      approvalId: receipt.approvalId,
      derivativeRightsApprovalSha256: receipt.derivativeRightsApprovalSha256,
      custodyId: receipt.custodyId,
      custodyReceiptSha256: receipt.custodyReceiptSha256,
      decision: receipt.decision,
      rationale: receipt.rationale,
      reviewedByUserId: receipt.reviewedByUserId,
      reviewedAt: receipt.reviewedAt,
      authority: receipt.authority,
      executionEligible: receipt.executionEligible,
    };
    const parsedMaterial =
      FoundryDerivativeRightsRegistryAttestationReviewReceiptMaterialV1Schema.safeParse(
        material,
      );
    if (!parsedMaterial.success) {
      for (const issue of parsedMaterial.error.issues) ctx.addIssue(issue);
      return;
    }
    const expectedReceiptSha256 = domainSeparatedDigest(
      FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REVIEW_RECEIPT_V1,
      parsedMaterial.data,
    );
    if (receipt.reviewReceiptSha256 !== expectedReceiptSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewReceiptSha256"],
        message:
          "registry-attestation review receipt digest must bind its exact canonical material",
      });
    }
  });
export type FoundryDerivativeRightsRegistryAttestationReviewReceiptV1 = z.infer<
  typeof FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema
>;

export const FoundryDerivativeRightsRegistryAttestationReviewResultV1Schema =
  FoundryDerivativeRightsRegistryAttestationReviewReceiptV1Schema;
export type FoundryDerivativeRightsRegistryAttestationReviewResultV1 =
  FoundryDerivativeRightsRegistryAttestationReviewReceiptV1;

/** Compatibility aliases for the initial, shorter custody symbol names. */
export const FoundryDerivativeRightsCustodyRegistrationInputV1Schema =
  FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema;
export type FoundryDerivativeRightsCustodyRegistrationInputV1 =
  FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1;
export const FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1Schema =
  FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1Schema;
export type FoundryDerivativeRightsCustodyRegistrationRequestMaterialV1 =
  FoundryDerivativeTermsEvidenceCustodyRegistrationRequestMaterialV1;
export const FoundryDerivativeRightsCustodyReceiptMaterialV1Schema =
  FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1Schema;
export type FoundryDerivativeRightsCustodyReceiptMaterialV1 =
  FoundryDerivativeTermsEvidenceCustodyReceiptMaterialV1;
export const FoundryDerivativeRightsCustodyReceiptV1Schema =
  FoundryDerivativeTermsEvidenceCustodyReceiptV1Schema;
export type FoundryDerivativeRightsCustodyReceiptV1 =
  FoundryDerivativeTermsEvidenceCustodyReceiptV1;
export const FoundryDerivativeRightsCustodyRegistrationResultV1Schema =
  FoundryDerivativeTermsEvidenceCustodyRegistrationResultV1Schema;
export type FoundryDerivativeRightsCustodyRegistrationResultV1 =
  FoundryDerivativeTermsEvidenceCustodyRegistrationResultV1;
export const computeFoundryDerivativeRightsCustodyRegistrationRequestSha256 =
  computeFoundryDerivativeTermsEvidenceCustodyRegistrationRequestSha256;
export const computeFoundryDerivativeRightsCustodyReceiptSha256 =
  computeFoundryDerivativeTermsEvidenceCustodyReceiptSha256;
