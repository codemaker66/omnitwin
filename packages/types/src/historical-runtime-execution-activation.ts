import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimePackageContentDigestSchema } from "./asset-version.js";
import {
  PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS,
  PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES,
  PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES,
  PhaseLayoutRuntimeVisualAssetSchema,
  phaseLayoutRuntimeCompositionDigest,
} from "./phase-layout-runtime-binding.js";
import { ReconstructionDsseEnvelopeSchema } from "./reconstruction-release.js";
import { RuntimeManifestKeySchema } from "./runtime-venue-manifest.js";
import { SpaceIdSchema, SpaceSlugSchema } from "./space.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";

export const HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_SCHEMA_VERSION =
  "historical-runtime-execution-key-policy.v1";
export const HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_SCHEMA_VERSION =
  "historical-runtime-execution-activation.v1";
export const HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_PREDICATE_TYPE =
  "https://venviewer.com/attestations/historical-runtime-execution-activation/v1";
export const HISTORICAL_RUNTIME_EXECUTION_DSSE_PAYLOAD_TYPE =
  "application/vnd.in-toto+json";
export const HISTORICAL_RUNTIME_EXECUTION_IN_TOTO_STATEMENT_TYPE =
  "https://in-toto.io/Statement/v1";
export const HISTORICAL_RUNTIME_EXECUTION_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_PURPOSES = [
  "historical_runtime_execution_activation",
  "historical_runtime_capture_content_identity",
  "historical_runtime_role_attestation",
] as const;
export const HistoricalRuntimeExecutionKeyPolicyPurposeSchema = z.enum(
  HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_PURPOSES,
);
export type HistoricalRuntimeExecutionKeyPolicyPurpose = z.infer<
  typeof HistoricalRuntimeExecutionKeyPolicyPurposeSchema
>;

const SHA256 = RuntimePackageContentDigestSchema;
const PRINTABLE_ETAG = /^[\u0021-\u007e]{1,200}$/u;
const STORAGE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SAFE_FILE_NAME = /^[^/\\]+$/u;
const PRINTABLE_DSSE_KEY_ID = /^[\x20-\x7e]{1,128}$/u;

function canonicalDigest(domain: string, value: unknown): string {
  return sha256Hex(`${domain}${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}`);
}

const HistoricalRuntimeExecutionKeyPolicyUnsignedSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_KEY_POLICY_SCHEMA_VERSION),
  policyId: z.string().uuid(),
  purpose: HistoricalRuntimeExecutionKeyPolicyPurposeSchema,
  algorithm: z.literal("ed25519"),
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  publicKeyFingerprint: SHA256,
  registeredBy: UserIdSchema,
  registeredAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeExecutionKeyPolicyDigest(value: unknown): string {
  return canonicalDigest(
    "venviewer.historical-runtime-execution-key-policy.v1\n",
    HistoricalRuntimeExecutionKeyPolicyUnsignedSchema.parse(value),
  );
}

export const HistoricalRuntimeExecutionKeyPolicySchema =
  HistoricalRuntimeExecutionKeyPolicyUnsignedSchema.extend({
    policyDigest: SHA256,
  }).strict().superRefine((policy, context) => {
    const registeredAt = new Date(policy.registeredAt).getTime();
    const effectiveAt = new Date(policy.effectiveAt).getTime();
    const expiresAt = new Date(policy.expiresAt).getTime();
    if (effectiveAt < registeredAt || expiresAt <= effectiveAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Execution key policy time bounds must follow its server registration time.",
      });
    }
    const { policyDigest, ...unsigned } = policy;
    if (historicalRuntimeExecutionKeyPolicyDigest(unsigned) !== policyDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyDigest"],
        message: "Execution key policy digest must match its exact server-issued record.",
      });
    }
  });
export type HistoricalRuntimeExecutionKeyPolicy = z.infer<
  typeof HistoricalRuntimeExecutionKeyPolicySchema
>;

const HistoricalRuntimeExecutionObjectReceiptMaterialSchema = z.object({
  admissionId: z.string().uuid(),
  memberIndex: z.number().int().nonnegative().max(PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS - 1),
  assetVersionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  fileExt: z.enum([".sog", ".spz"]),
  mimeType: z.string().trim().min(1).max(120),
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES),
  evidenceStatus: z.literal("human_reviewed"),
  rightsEvidenceRowId: z.string().uuid(),
  rightsEvidenceDigest: SHA256,
  rightsDecision: z.literal("approved"),
  rightsReviewedBy: UserIdSchema,
  rightsReviewedAt: z.string().datetime({ offset: true }),
  storageKeySha256: SHA256,
  privateBucketSha256: SHA256,
  storageVersion: z.string().regex(STORAGE_VERSION),
  storageEtag: z.string().regex(PRINTABLE_ETAG),
}).strict();

export function historicalRuntimeExecutionObjectReceiptDigest(value: unknown): string {
  return canonicalDigest(
    "venviewer.historical-runtime-execution-object-receipt.v1\n",
    HistoricalRuntimeExecutionObjectReceiptMaterialSchema.parse(value),
  );
}

export const HistoricalRuntimeExecutionObjectReceiptSchema =
  HistoricalRuntimeExecutionObjectReceiptMaterialSchema.extend({
    objectReceiptDigest: SHA256,
  }).strict().superRefine((receipt, context) => {
    if (!receipt.fileName.endsWith(receipt.fileExt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileName"],
        message: "Runtime object receipt fileName must end with its exact fileExt.",
      });
    }
    const baseMember = {
      memberIndex: receipt.memberIndex,
      assetVersionId: receipt.assetVersionId,
      fileName: receipt.fileName,
      fileExt: receipt.fileExt,
      mimeType: receipt.mimeType,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
      evidenceStatus: receipt.evidenceStatus,
    };
    if (!PhaseLayoutRuntimeVisualAssetSchema.safeParse(baseMember).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetVersionId"],
        message: "Runtime object receipt must contain one valid historical visual member.",
      });
    }
    const { objectReceiptDigest, ...material } = receipt;
    if (historicalRuntimeExecutionObjectReceiptDigest(material) !== objectReceiptDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["objectReceiptDigest"],
        message: "Runtime object receipt digest must bind its exact private object identity.",
      });
    }
  });
export type HistoricalRuntimeExecutionObjectReceipt = z.infer<
  typeof HistoricalRuntimeExecutionObjectReceiptSchema
>;

const HistoricalRuntimeExecutionActivationPredicateObjectSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_SCHEMA_VERSION),
  activationId: z.string().uuid(),
  eventId: z.string().uuid(),
  phaseId: z.string().uuid(),
  configurationId: z.string().uuid(),
  canonicalSnapshotId: z.string().uuid(),
  snapshotHash: SHA256,
  proofDigest: SHA256,
  tenantBoundary: z.literal("venue_id_v1"),
  tenantId: VenueIdSchema,
  venueId: VenueIdSchema,
  venueSlug: VenueSlugSchema,
  spaceId: SpaceIdSchema,
  spaceSlug: SpaceSlugSchema,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  presentationAdmissionReviewedBy: UserIdSchema,
  presentationAdmissionReviewedAt: z.string().datetime({ offset: true }),
  runtimePackageId: z.string().uuid(),
  runtimePackageRevision: z.number().int().positive(),
  runtimePackageContentDigest: SHA256,
  runtimeManifestDigest: SHA256,
  runtimePackageEvidenceStatus: z.literal("human_reviewed"),
  runtimePackageStatus: z.enum(["internal_ready", "published"]),
  reviewedProfileId: RuntimeManifestKeySchema,
  reviewedProfileManifestFingerprint: SHA256,
  rightsEvidenceDigest: SHA256,
  sceneAuthorityMapDigest: SHA256,
  runtimeQaRecordId: z.string().uuid(),
  runtimeQaRecordKey: RuntimeManifestKeySchema,
  runtimeQaRecordDigest: SHA256,
  runtimeQaDecision: z.enum(["approved_internal_preview", "approved_public"]),
  runtimeQaReviewedBy: UserIdSchema,
  runtimeQaReviewedAt: z.string().datetime({ offset: true }),
  transformArtifactRowId: z.string().uuid(),
  transformArtifactId: RuntimeManifestKeySchema,
  transformArtifactDigest: SHA256,
  compositionDigest: SHA256,
  memberCount: z.number().int().positive().max(PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS),
  members: z.array(HistoricalRuntimeExecutionObjectReceiptSchema)
    .min(1)
    .max(PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS),
  keyPolicyId: z.string().uuid(),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  publicKeyFingerprint: SHA256,
  requestedBy: UserIdSchema,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
}).strict();

export const HistoricalRuntimeExecutionActivationPredicateSchema =
  HistoricalRuntimeExecutionActivationPredicateObjectSchema.superRefine((predicate, context) => {
    const issuedAt = new Date(predicate.issuedAt).getTime();
    const expiresAt = new Date(predicate.expiresAt).getTime();
    if (
      predicate.tenantId !== predicate.venueId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantId"],
        message: "The v1 tenant boundary is the exact authoritative venue identity.",
      });
    }
    if (
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > HISTORICAL_RUNTIME_EXECUTION_MAX_TTL_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Runtime activation expiry must be after issue and within the maximum TTL.",
      });
    }
    if (
      new Date(predicate.presentationAdmissionReviewedAt).getTime() > issuedAt ||
      new Date(predicate.runtimeQaReviewedAt).getTime() > issuedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedAt"],
        message: "Runtime activation cannot predate the evidence it authorizes.",
      });
    }
    if (
      predicate.requestedBy === predicate.presentationAdmissionReviewedBy ||
      predicate.requestedBy === predicate.runtimeQaReviewedBy ||
      predicate.members.some((member) => member.rightsReviewedBy === predicate.requestedBy)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedBy"],
        message: "Runtime activation requester must be independent of admission, QA, and rights reviewers.",
      });
    }
    if (predicate.memberCount !== predicate.members.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberCount"],
        message: "Runtime activation memberCount must match its exact member set.",
      });
    }
    let totalSizeBytes = 0;
    const assetIds = new Set<string>();
    for (const [index, member] of predicate.members.entries()) {
      if (member.memberIndex !== index || member.admissionId !== predicate.presentationAdmissionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", index],
          message: "Runtime activation members must preserve admission identity and exact order.",
        });
      }
      if (assetIds.has(member.assetVersionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", index, "assetVersionId"],
          message: "Runtime activation members must have unique asset identities.",
        });
      }
      assetIds.add(member.assetVersionId);
      totalSizeBytes += member.sizeBytes;
    }
    if (totalSizeBytes > PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "Runtime activation members exceed the historical viewer byte ceiling.",
      });
    }
    const visualAssets = predicate.members.map((member) => ({
      memberIndex: member.memberIndex,
      assetVersionId: member.assetVersionId,
      fileName: member.fileName,
      fileExt: member.fileExt,
      mimeType: member.mimeType,
      sha256: member.sha256,
      sizeBytes: member.sizeBytes,
      evidenceStatus: member.evidenceStatus,
    }));
    const expectedCompositionDigest = phaseLayoutRuntimeCompositionDigest({
      runtimePackageId: predicate.runtimePackageId,
      runtimePackageContentDigest: predicate.runtimePackageContentDigest,
      reviewedProfileId: predicate.reviewedProfileId,
      transformArtifactDigest: predicate.transformArtifactDigest,
      visualAssets,
    });
    if (expectedCompositionDigest !== predicate.compositionDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compositionDigest"],
        message: "Runtime activation composition digest must bind its exact ordered member set.",
      });
    }
  });
export type HistoricalRuntimeExecutionActivationPredicate = z.infer<
  typeof HistoricalRuntimeExecutionActivationPredicateSchema
>;

export function historicalRuntimeExecutionActivationSubjectDigest(value: unknown): string {
  return canonicalDigest(
    "venviewer.historical-runtime-execution-activation-subject.v1\n",
    HistoricalRuntimeExecutionActivationPredicateSchema.parse(value),
  );
}

const HistoricalRuntimeExecutionStatementObjectSchema = z.object({
  _type: z.literal(HISTORICAL_RUNTIME_EXECUTION_IN_TOTO_STATEMENT_TYPE),
  subject: z.array(z.object({
    name: z.string().trim().min(1).max(320),
    digest: z.object({ sha256: SHA256 }).strict(),
  }).strict()).length(1),
  predicateType: z.literal(HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_PREDICATE_TYPE),
  predicate: HistoricalRuntimeExecutionActivationPredicateSchema,
}).strict();

export const HistoricalRuntimeExecutionStatementSchema =
  HistoricalRuntimeExecutionStatementObjectSchema.superRefine((statement, context) => {
    const subject = statement.subject[0];
    const expectedName = `phase-layout-runtime-activation/${statement.predicate.activationId}`;
    const expectedDigest = historicalRuntimeExecutionActivationSubjectDigest(statement.predicate);
    if (subject?.name !== expectedName || subject.digest.sha256 !== expectedDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject", 0],
        message: "Runtime activation statement subject must bind its exact predicate.",
      });
    }
  });
export type HistoricalRuntimeExecutionStatement = z.infer<
  typeof HistoricalRuntimeExecutionStatementSchema
>;

export function createHistoricalRuntimeExecutionStatement(
  predicateInput: HistoricalRuntimeExecutionActivationPredicate,
): HistoricalRuntimeExecutionStatement {
  const predicate = HistoricalRuntimeExecutionActivationPredicateSchema.parse(predicateInput);
  return HistoricalRuntimeExecutionStatementSchema.parse({
    _type: HISTORICAL_RUNTIME_EXECUTION_IN_TOTO_STATEMENT_TYPE,
    subject: [{
      name: `phase-layout-runtime-activation/${predicate.activationId}`,
      digest: { sha256: historicalRuntimeExecutionActivationSubjectDigest(predicate) },
    }],
    predicateType: HISTORICAL_RUNTIME_EXECUTION_ACTIVATION_PREDICATE_TYPE,
    predicate,
  });
}

export const HistoricalRuntimeExecutionSigningPayloadSchema = z.object({
  payloadType: z.literal(HISTORICAL_RUNTIME_EXECUTION_DSSE_PAYLOAD_TYPE),
  statement: HistoricalRuntimeExecutionStatementSchema,
  payloadUtf8: z.string().min(1),
  payloadSha256: SHA256,
}).strict().superRefine((payload, context) => {
  const expectedUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(payload.statement));
  if (payload.payloadUtf8 !== expectedUtf8 || sha256Hex(expectedUtf8) !== payload.payloadSha256) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payloadSha256"],
      message: "DSSE signing payload must preserve the exact server-issued statement bytes.",
    });
  }
});
export type HistoricalRuntimeExecutionSigningPayload = z.infer<
  typeof HistoricalRuntimeExecutionSigningPayloadSchema
>;

export function createHistoricalRuntimeExecutionSigningPayload(
  statementInput: HistoricalRuntimeExecutionStatement,
): HistoricalRuntimeExecutionSigningPayload {
  const statement = HistoricalRuntimeExecutionStatementSchema.parse(statementInput);
  const payloadUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(statement));
  return HistoricalRuntimeExecutionSigningPayloadSchema.parse({
    payloadType: HISTORICAL_RUNTIME_EXECUTION_DSSE_PAYLOAD_TYPE,
    statement,
    payloadUtf8,
    payloadSha256: sha256Hex(payloadUtf8),
  });
}

export const SubmitHistoricalRuntimeExecutionActivationSchema = z.object({
  statement: HistoricalRuntimeExecutionStatementSchema,
  envelope: ReconstructionDsseEnvelopeSchema,
}).strict();
export type SubmitHistoricalRuntimeExecutionActivation = z.infer<
  typeof SubmitHistoricalRuntimeExecutionActivationSchema
>;
