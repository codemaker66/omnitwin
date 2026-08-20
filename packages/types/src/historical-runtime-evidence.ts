import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimePackageContentDigestSchema } from "./asset-version.js";
import {
  HistoricalRuntimeDomainSha256Schema,
  HistoricalRuntimeEvidenceProviderProfileSchema,
  HistoricalRuntimeExactObjectReceiptSchema,
  HistoricalRuntimeProductionExactObjectReceiptSchema,
} from "./historical-runtime-object-receipt.js";
import {
  VenueInvitationRoleSchema,
  WorkspaceIdSchema,
  WorkspaceMemberRoleSchema,
  WorkspaceMembershipIdSchema,
} from "./onboarding.js";
import { RuntimeManifestKeySchema } from "./runtime-venue-manifest.js";
import {
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseSigningStatementSchema,
} from "./reconstruction-release.js";
import { SpaceIdSchema, SpaceSlugSchema } from "./space.js";
import {
  PlatformRoleSchema,
  UserIdSchema,
  UserRoleSchema,
} from "./user.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";

export {
  HISTORICAL_RUNTIME_ANONYMOUS_DENIAL_MAX_TTL_MS,
  HISTORICAL_RUNTIME_EVIDENCE_PROVIDER_PROFILES,
  HISTORICAL_RUNTIME_MAX_EVIDENCE_OBJECT_BYTES,
  HISTORICAL_RUNTIME_PROVIDER_CAPABILITY_MAX_TTL_MS,
  HistoricalRuntimeAnonymousAccessDenialSchema,
  HistoricalRuntimeDomainSha256Schema,
  HistoricalRuntimeEvidenceObjectIdentitySchema,
  HistoricalRuntimeEvidenceProviderKindSchema,
  HistoricalRuntimeEvidenceProviderProfileSchema,
  HistoricalRuntimeEvidenceVersionKindSchema,
  HistoricalRuntimeExactObjectReceiptSchema,
  HistoricalRuntimeObjectActorAuthoritySchema,
  HistoricalRuntimeProductionExactObjectReceiptSchema,
  HistoricalRuntimeProductionProviderCapabilitySchema,
  HistoricalRuntimeProviderCapabilitySchema,
  historicalRuntimeExactObjectReceiptDigest,
  historicalRuntimeObjectActorAuthorityDigest,
  historicalRuntimeProviderCapabilityDigest,
  type HistoricalRuntimeAnonymousAccessDenial,
  type HistoricalRuntimeEvidenceObjectIdentity,
  type HistoricalRuntimeEvidenceProviderKind,
  type HistoricalRuntimeEvidenceProviderProfile,
  type HistoricalRuntimeEvidenceVersionKind,
  type HistoricalRuntimeExactObjectReceipt,
  type HistoricalRuntimeObjectActorAuthority,
  type HistoricalRuntimeProviderCapability,
} from "./historical-runtime-object-receipt.js";

export const HISTORICAL_RUNTIME_CAPTURE_CONTENT_IDENTITY_SCHEMA_VERSION =
  "historical-runtime-capture-content-identity.v1";
export const HISTORICAL_RUNTIME_CAPTURE_CONTENT_IDENTITY_PAYLOAD_TYPE =
  "application/vnd.venviewer.historical-runtime-capture-content-identity.v1+json";
export const HISTORICAL_RUNTIME_ROLE_ATTESTATION_PAYLOAD_TYPE =
  "application/vnd.venviewer.historical-runtime-role-attestation.v1+json";
export const HISTORICAL_RUNTIME_CAPTURE_ROOT_EVIDENCE_SCHEMA_VERSION =
  "historical-runtime-capture-root-evidence.v1";
export const HISTORICAL_RUNTIME_DERIVATION_EVIDENCE_SCHEMA_VERSION =
  "historical-runtime-derivation-evidence.v1";
export const HISTORICAL_RUNTIME_SCENE_AUTHORITY_RECEIPT_SCHEMA_VERSION =
  "historical-runtime-scene-authority-receipt.v1";
export const HISTORICAL_RUNTIME_REVIEWED_PROFILE_EVIDENCE_SCHEMA_VERSION =
  "historical-runtime-reviewed-profile-evidence.v1";
export const HISTORICAL_RUNTIME_EXECUTION_V2_SUBJECT_SCHEMA_VERSION =
  "historical-runtime-execution-activation-subject.v2";
export const HISTORICAL_RUNTIME_EXECUTION_V2_PREDICATE_SCHEMA_VERSION =
  "historical-runtime-execution-activation.v2";
export const HISTORICAL_RUNTIME_EXECUTION_V2_STATEMENT_SCHEMA_VERSION =
  "historical-runtime-execution-activation-statement.v2";
export const HISTORICAL_RUNTIME_EXECUTION_V2_RECEIPT_SCHEMA_VERSION =
  "historical-runtime-execution-activation-receipt.v2";
export const HISTORICAL_RUNTIME_EXECUTION_V2_PAYLOAD_TYPE =
  "application/vnd.venviewer.historical-runtime-execution-activation.v2+json";

const SHA256 = RuntimePackageContentDigestSchema;
const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/u;
const SAFE_FILE_NAME = /^[^/\\]+$/u;
const PRINTABLE_DSSE_KEY_ID = /^[\x20-\x7e]{1,128}$/u;
const MAX_NORMALIZED_BYTES = Number.MAX_SAFE_INTEGER;
const MAX_INDEXED_IDENTITY_TEXT_BYTES = 512;
export const HISTORICAL_RUNTIME_ROLE_ATTESTATION_MAX_TTL_MS =
  365 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_CAPTURE_CONTENT_IDENTITY_MAX_TTL_MS =
  365 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_SCENE_AUTHORITY_MAX_TTL_MS =
  30 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_VERIFIED_TWIN_RELEASE_AUTHORITY_MAX_TTL_MS =
  30 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_REVIEWED_PROFILE_MAX_TTL_MS =
  90 * 24 * 60 * 60 * 1_000;
export const HISTORICAL_RUNTIME_EXECUTION_V2_MAX_TTL_MS =
  90 * 24 * 60 * 60 * 1_000;

function canonicalDigest(domain: string, value: unknown): string | null {
  try {
    return sha256Hex(`${domain}${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}`);
  } catch {
    return null;
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function canonicalBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(combined >>> 18) & 0x3f] ?? "";
    output += BASE64_ALPHABET[(combined >>> 12) & 0x3f] ?? "";
    output += second === undefined
      ? "="
      : BASE64_ALPHABET[(combined >>> 6) & 0x3f] ?? "";
    output += third === undefined
      ? "="
      : BASE64_ALPHABET[combined & 0x3f] ?? "";
  }
  return output;
}

function digest<T>(domain: string, schema: z.ZodType<T>, value: unknown): string {
  const parsed: T = schema.parse(value);
  const result = canonicalDigest(domain, parsed);
  if (result === null) throw new TypeError("Evidence material is not canonical JSON.");
  return result;
}

function isSafeStorageKey(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

export const HISTORICAL_RUNTIME_EVIDENCE_SUBJECT_KINDS = [
  "capture_import",
  "derivation",
  "transform_review",
  "rights_clearance",
  "scene_validation",
  "reviewed_profile",
  "execution_activation",
] as const;
export const HistoricalRuntimeEvidenceSubjectKindSchema = z.enum(
  HISTORICAL_RUNTIME_EVIDENCE_SUBJECT_KINDS,
);
export type HistoricalRuntimeEvidenceSubjectKind = z.infer<
  typeof HistoricalRuntimeEvidenceSubjectKindSchema
>;

export const HISTORICAL_RUNTIME_EVIDENCE_ROLES = [
  "capture_operator",
  "source_custodian",
  "owner_authorizer",
  "privacy_reviewer",
  "movable_content_reviewer",
  "normalizer",
  "capture_final_reviewer",
  "derivative_producer",
  "derivative_custodian",
  "derivative_reviewer",
  "package_custodian",
  "qa_reviewer",
  "transform_reviewer",
  "rights_reviewer",
  "scene_reviewer",
  "admission_reviewer",
  "profile_final_reviewer",
  "execution_reviewer",
] as const;
export const HistoricalRuntimeEvidenceRoleSchema = z.enum(
  HISTORICAL_RUNTIME_EVIDENCE_ROLES,
);
export type HistoricalRuntimeEvidenceRole = z.infer<
  typeof HistoricalRuntimeEvidenceRoleSchema
>;

const HistoricalRuntimeWorkspaceMembershipSnapshotSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("active"),
    membershipId: WorkspaceMembershipIdSchema,
    workspaceId: WorkspaceIdSchema,
    workspaceRole: WorkspaceMemberRoleSchema,
    venueRole: VenueInvitationRoleSchema,
    membershipStatus: z.literal("active"),
    membershipUpdatedAt: z.string().datetime({ offset: true }),
    membershipVersionDigest: SHA256,
  }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: z.literal("platform_authority"),
  }).strict(),
]);

const HistoricalRuntimeAuthoritySnapshotMaterialSchema = z.object({
  authenticationSource: z.enum(["clerk_session", "local_test_fixture"]),
  platformRole: PlatformRoleSchema,
  userRole: UserRoleSchema,
  userVenueId: VenueIdSchema.nullable(),
  venueId: VenueIdSchema,
  workspaceMembership: HistoricalRuntimeWorkspaceMembershipSnapshotSchema,
  snapshottedAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeAuthoritySnapshotDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-authority-snapshot.v1\n",
    HistoricalRuntimeAuthoritySnapshotMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeAuthoritySnapshotSchema =
  HistoricalRuntimeAuthoritySnapshotMaterialSchema.extend({
  authorityDigest: SHA256,
  }).strict().superRefine((snapshot, context) => {
    const { authorityDigest, ...material } = snapshot;
    const membershipUpdatedAfterSnapshot =
      snapshot.workspaceMembership.state === "active" &&
      new Date(snapshot.workspaceMembership.membershipUpdatedAt).getTime() >
        new Date(snapshot.snapshottedAt).getTime();
    if (
      snapshot.platformRole === "none" && snapshot.userVenueId !== snapshot.venueId ||
      membershipUpdatedAfterSnapshot ||
      canonicalDigest("venviewer.historical-runtime-authority-snapshot.v1\n", material) !==
        authorityDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorityDigest"],
        message: "Authority snapshot must preserve the canonical account and venue-membership state at action time.",
      });
    }
  });
export type HistoricalRuntimeAuthoritySnapshot = z.infer<
  typeof HistoricalRuntimeAuthoritySnapshotSchema
>;

const HistoricalRuntimeEvidenceEnvironmentMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-evidence-environment.v1"),
  environmentId: z.string().uuid(),
  mode: z.enum(["production", "test"]),
  configuredBy: UserIdSchema,
  configuredAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeEvidenceEnvironmentDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-evidence-environment.v1\n",
    HistoricalRuntimeEvidenceEnvironmentMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeEvidenceEnvironmentSchema =
  HistoricalRuntimeEvidenceEnvironmentMaterialSchema.extend({
    environmentDigest: SHA256,
  }).strict().superRefine((environment, context) => {
    const { environmentDigest, ...material } = environment;
    if (
      canonicalDigest(
        "venviewer.historical-runtime-evidence-environment.v1\n",
        material,
      ) !== environmentDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environmentDigest"],
        message: "The evidence environment must be a canonical DB-issued singleton.",
      });
    }
  });
export type HistoricalRuntimeEvidenceEnvironment = z.infer<
  typeof HistoricalRuntimeEvidenceEnvironmentSchema
>;

const HistoricalRuntimeScopeEpochMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-scope-epoch.v1"),
  epochId: z.string().uuid(),
  environmentId: z.string().uuid(),
  environmentMode: z.enum(["production", "test"]),
  environmentDigest: SHA256,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  epoch: z.number().int().positive(),
  issuedBy: UserIdSchema,
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeScopeEpochDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-scope-epoch.v1\n",
    HistoricalRuntimeScopeEpochMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeScopeEpochSchema =
  HistoricalRuntimeScopeEpochMaterialSchema.extend({
    epochDigest: SHA256,
  }).strict().superRefine((epoch, context) => {
    const { epochDigest, ...material } = epoch;
    const ttl = new Date(epoch.expiresAt).getTime() -
      new Date(epoch.effectiveAt).getTime();
    if (
      ttl <= 0 ||
      ttl > 365 * 24 * 60 * 60 * 1_000 ||
      canonicalDigest(
        "venviewer.historical-runtime-scope-epoch.v1\n",
        material,
      ) !== epochDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["epochDigest"],
        message: "A scope epoch must be a finite, canonical DB-issued authority window.",
      });
    }
  });
export type HistoricalRuntimeScopeEpoch = z.infer<
  typeof HistoricalRuntimeScopeEpochSchema
>;

const EvidenceDocumentReceiptSchema = z.object({
  documentReceipt: HistoricalRuntimeExactObjectReceiptSchema,
  scopeDigest: SHA256,
}).strict();

const CaptureTimeKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("known"),
    capturedAt: z.string().datetime({ offset: true }),
    evidenceDocumentDigest: SHA256,
  }).strict(),
  z.object({
    state: z.literal("owner_attested_unknown"),
    reason: z.string().trim().min(1).max(500),
    evidenceDocumentDigest: SHA256,
  }).strict(),
]);

const CaptureDeviceKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("known"),
    device: z.string().trim().min(1).max(240),
    evidenceDocumentDigest: SHA256,
  }).strict(),
  z.object({
    state: z.literal("owner_attested_unknown"),
    reason: z.string().trim().min(1).max(500),
    evidenceDocumentDigest: SHA256,
  }).strict(),
]);

export const HistoricalRuntimeRoleEvidenceSchema = z.discriminatedUnion("role", [
  z.object({
    schemaVersion: z.literal("historical-runtime-role-capture-operator.v1"),
    role: z.literal("capture_operator"),
    captureClass: z.enum(["owner_authorized_existing_capture", "venue_operator_direct_camera"]),
    lineageStartKind: z.enum([
      "raw_capture_object",
      "direct_camera_capture_bundle",
      "processed_capture_package",
    ]),
    ancestorState: z.enum(["exact_private_receipt", "owner_attested_unavailable_ancestor"]),
    captureTime: CaptureTimeKnowledgeSchema,
    captureDevice: CaptureDeviceKnowledgeSchema,
    lineageDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-source-custodian.v1"),
    role: z.literal("source_custodian"),
    sourceReceiptSetDigest: SHA256,
    custodyDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-owner-authorization.v1"),
    role: z.literal("owner_authorizer"),
    decision: z.literal("approved"),
    sourceReceiptSetDigest: SHA256,
    authorizedOperations: z.tuple([
      z.literal("store_private"),
      z.literal("convert"),
      z.literal("render"),
      z.literal("generate_derivatives"),
      z.literal("internal_planning"),
      z.literal("customer_presentation"),
    ]),
    authorizationDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-privacy-review.v1"),
    role: z.literal("privacy_reviewer"),
    decision: z.literal("approved"),
    sourceReceiptSetDigest: SHA256,
    reviewedCategories: z.tuple([
      z.literal("faces"),
      z.literal("personal_documents"),
      z.literal("vehicle_registrations"),
      z.literal("access_credentials"),
      z.literal("private_conversations"),
    ]),
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-movable-content-review.v1"),
    role: z.literal("movable_content_reviewer"),
    decision: z.literal("approved"),
    sourceReceiptSetDigest: SHA256,
    treatment: z.enum(["accepted_as_captured", "masked", "removed", "segmented_non_authoritative"]),
    reviewedCategories: z.tuple([
      z.literal("furniture"),
      z.literal("decor"),
      z.literal("event_dressing"),
      z.literal("people"),
      z.literal("temporary_equipment"),
    ]),
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-normalizer.v1"),
    role: z.literal("normalizer"),
    captureContentSubjectDigest: SHA256,
    normalizationDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-capture-final-review.v1"),
    role: z.literal("capture_final_reviewer"),
    decision: z.literal("approved"),
    captureRootEvidenceDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-derivative-producer.v1"),
    role: z.literal("derivative_producer"),
    conversionRecipeDigest: SHA256,
    producerDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-derivative-custodian.v1"),
    role: z.literal("derivative_custodian"),
    outputReceiptSetDigest: SHA256,
    custodyDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-derivative-review.v1"),
    role: z.literal("derivative_reviewer"),
    decision: z.literal("approved"),
    outputReceiptSetDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-package-custodian.v1"),
    role: z.literal("package_custodian"),
    runtimePackageContentDigest: SHA256,
    runtimeManifestDigest: SHA256,
    custodyDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-qa-review.v1"),
    role: z.literal("qa_reviewer"),
    decision: z.enum(["approved_internal_preview", "approved_public"]),
    runtimeQaRecordId: z.string().uuid(),
    runtimeQaRecordDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-transform-review.v1"),
    role: z.literal("transform_reviewer"),
    decision: z.literal("approved"),
    transformReviewSubjectDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-rights-review.v1"),
    role: z.literal("rights_reviewer"),
    decision: z.literal("approved"),
    rightsClearanceSubjectDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-scene-review.v1"),
    role: z.literal("scene_reviewer"),
    decision: z.literal("approved"),
    sceneValidationSubjectDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-admission-review.v1"),
    role: z.literal("admission_reviewer"),
    decision: z.literal("approved"),
    presentationAdmissionId: z.string().uuid(),
    presentationAdmissionDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-profile-final-review.v1"),
    role: z.literal("profile_final_reviewer"),
    decision: z.literal("approved"),
    reviewedProfileSubjectDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal("historical-runtime-role-execution-review.v1"),
    role: z.literal("execution_reviewer"),
    decision: z.literal("approved"),
    executionActivationSubjectDigest: SHA256,
    reviewDocument: EvidenceDocumentReceiptSchema,
  }).strict(),
]);
export type HistoricalRuntimeRoleEvidence = z.infer<typeof HistoricalRuntimeRoleEvidenceSchema>;

function roleEvidenceDocumentReceipt(
  evidence: HistoricalRuntimeRoleEvidence,
) {
  switch (evidence.role) {
    case "capture_operator":
      return evidence.lineageDocument.documentReceipt;
    case "source_custodian":
      return evidence.custodyDocument.documentReceipt;
    case "owner_authorizer":
      return evidence.authorizationDocument.documentReceipt;
    case "privacy_reviewer":
    case "movable_content_reviewer":
    case "capture_final_reviewer":
    case "derivative_reviewer":
    case "qa_reviewer":
    case "transform_reviewer":
    case "rights_reviewer":
    case "scene_reviewer":
    case "admission_reviewer":
    case "profile_final_reviewer":
    case "execution_reviewer":
      return evidence.reviewDocument.documentReceipt;
    case "normalizer":
      return evidence.normalizationDocument.documentReceipt;
    case "derivative_producer":
      return evidence.producerDocument.documentReceipt;
    case "derivative_custodian":
    case "package_custodian":
      return evidence.custodyDocument.documentReceipt;
  }
}

const ROLE_SUBJECT_KIND: Readonly<Record<HistoricalRuntimeEvidenceRole, HistoricalRuntimeEvidenceSubjectKind>> = {
  capture_operator: "capture_import",
  source_custodian: "capture_import",
  owner_authorizer: "capture_import",
  privacy_reviewer: "capture_import",
  movable_content_reviewer: "capture_import",
  normalizer: "capture_import",
  capture_final_reviewer: "capture_import",
  derivative_producer: "derivation",
  derivative_custodian: "derivation",
  derivative_reviewer: "derivation",
  package_custodian: "reviewed_profile",
  qa_reviewer: "reviewed_profile",
  transform_reviewer: "transform_review",
  rights_reviewer: "rights_clearance",
  scene_reviewer: "scene_validation",
  admission_reviewer: "reviewed_profile",
  profile_final_reviewer: "reviewed_profile",
  execution_reviewer: "execution_activation",
};

function authoritySnapshotAllowsRole(
  snapshot: HistoricalRuntimeAuthoritySnapshot,
  role: HistoricalRuntimeEvidenceRole,
): boolean {
  const membership = snapshot.workspaceMembership;
  if (role === "owner_authorizer") {
    return membership.state === "active" && (
      membership.workspaceRole === "owner" || membership.workspaceRole === "admin"
    );
  }
  if (snapshot.platformRole === "operator" || snapshot.platformRole === "admin") return true;
  if (membership.state !== "active") return false;
  if (
    role === "source_custodian" ||
    role === "package_custodian" ||
    role === "capture_operator"
  ) {
    return membership.workspaceRole === "owner" ||
      membership.workspaceRole === "admin" ||
      membership.workspaceRole === "staff" ||
      membership.venueRole === "hallkeeper";
  }
  return (
    snapshot.userRole === "admin" ||
    snapshot.userRole === "staff" ||
    snapshot.userRole === "hallkeeper"
  ) && (
    membership.workspaceRole === "owner" ||
    membership.workspaceRole === "admin" ||
    membership.workspaceRole === "staff" ||
    membership.workspaceRole === "hallkeeper"
  );
}

const HistoricalRuntimeRoleAttestationSubjectMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-role-attestation.v1"),
  attestationId: z.string().uuid(),
  subjectId: z.string().uuid(),
  subjectKind: HistoricalRuntimeEvidenceSubjectKindSchema,
  tenantBoundary: z.literal("venue_id_v1"),
  tenantId: VenueIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  role: HistoricalRuntimeEvidenceRoleSchema,
  evidence: HistoricalRuntimeRoleEvidenceSchema,
  actorId: UserIdSchema,
  authoritySnapshot: HistoricalRuntimeAuthoritySnapshotSchema,
  keyPolicyId: z.string().uuid(),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  recordedAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
}).strict();

export function historicalRuntimeRoleAttestationSubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-role-attestation-subject.v1\n",
    HistoricalRuntimeRoleAttestationSubjectMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeRoleAttestationSubjectSchema =
  HistoricalRuntimeRoleAttestationSubjectMaterialSchema.extend({
    roleAttestationSubjectDigest: SHA256,
  }).strict().superRefine((subject, context) => {
    const { roleAttestationSubjectDigest, ...material } = subject;
    if (
      subject.tenantId !== subject.venueId ||
      subject.authoritySnapshot.venueId !== subject.venueId ||
      new Date(subject.authoritySnapshot.snapshottedAt).getTime() >
        new Date(subject.recordedAt).getTime() ||
      subject.role !== subject.evidence.role ||
      ROLE_SUBJECT_KIND[subject.role] !== subject.subjectKind ||
      !authoritySnapshotAllowsRole(subject.authoritySnapshot, subject.role) ||
      canonicalDigest("venviewer.historical-runtime-role-attestation-subject.v1\n", material) !==
        roleAttestationSubjectDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roleAttestationSubjectDigest"],
        message: "Role-attestation subject must bind its exact scope, action-time authority, purpose, actor, key policy, and evidence.",
      });
    }
    const recordedAt = new Date(subject.recordedAt).getTime();
    const effectiveAt = new Date(subject.effectiveAt).getTime();
    const expiresAt = new Date(subject.expiresAt).getTime();
    if (
      effectiveAt < recordedAt ||
      expiresAt <= effectiveAt ||
      expiresAt - effectiveAt > HISTORICAL_RUNTIME_ROLE_ATTESTATION_MAX_TTL_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Role authority must become effective after recording and expire within the maximum TTL.",
      });
    }
  });

const HistoricalRuntimeRoleAttestationStatementPredicateSchema = z.object({
  attestationId: z.string().uuid(),
  roleAttestationSubjectDigest: SHA256,
  subjectKind: HistoricalRuntimeEvidenceSubjectKindSchema,
  role: HistoricalRuntimeEvidenceRoleSchema,
  actorId: UserIdSchema,
  tenantId: VenueIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  keyPolicyId: z.string().uuid(),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  issuedAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
}).strict();

export const HistoricalRuntimeRoleAttestationStatementSchema = z.object({
  authority: z.literal("venue_evidence"),
  evidenceKind: z.literal("historical_runtime_role_attestation"),
  schemaVersion: z.literal("historical-runtime-role-attestation-statement.v1"),
  subjectName: z.string().trim().min(1).max(320),
  subjectDigest: SHA256,
  predicate: HistoricalRuntimeRoleAttestationStatementPredicateSchema,
}).strict().superRefine((statement, context) => {
  if (
    statement.subjectName !==
      `historical-runtime-role-attestation/${statement.predicate.attestationId}` ||
    statement.subjectDigest !== statement.predicate.roleAttestationSubjectDigest
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectDigest"],
      message: "Role-attestation statement must bind the exact server-issued subject digest.",
    });
  }
});

export function createHistoricalRuntimeRoleAttestationSigningPayload(
  statementInput: unknown,
): { readonly payloadUtf8: string; readonly payloadSha256: string } {
  const statement = HistoricalRuntimeRoleAttestationStatementSchema.parse(statementInput);
  const payloadUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(statement));
  return { payloadUtf8, payloadSha256: sha256Hex(payloadUtf8) };
}

const HistoricalRuntimeRawDsseEvidenceBytesSchema = z.object({
  payloadType: z.literal(HISTORICAL_RUNTIME_ROLE_ATTESTATION_PAYLOAD_TYPE),
  payloadUtf8: z.string().min(1).max(512 * 1024),
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
  payloadSha256: SHA256,
  receiptSha256: HistoricalRuntimeDomainSha256Schema,
  envelopeSha256: HistoricalRuntimeDomainSha256Schema,
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  payloadByteLength: z.string().regex(DECIMAL_UINT),
  envelopeByteLength: z.string().regex(DECIMAL_UINT),
  verifiedAt: z.string().datetime({ offset: true }),
}).strict();

const HistoricalRuntimeRoleAttestationMaterialSchema = z.object({
  subject: HistoricalRuntimeRoleAttestationSubjectSchema,
  statement: HistoricalRuntimeRoleAttestationStatementSchema,
  rawEvidence: HistoricalRuntimeRawDsseEvidenceBytesSchema,
}).strict();

export function historicalRuntimeRoleAttestationDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-role-attestation-receipt.v1\n",
    HistoricalRuntimeRoleAttestationMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeRoleAttestationSchema =
  HistoricalRuntimeRoleAttestationMaterialSchema.extend({
    attestationDigest: SHA256,
  }).strict().superRefine((attestation, context) => {
    const { attestationDigest, ...material } = attestation;
    const subject = attestation.subject;
    const predicate = attestation.statement.predicate;
    const expectedPayloadUtf8 = stableCanonicalJson(
      CanonicalJsonValueSchema.parse(attestation.statement),
    );
    const expectedReceiptSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-role-attestation.v1\n${expectedPayloadUtf8}`,
    )}`;
    const expectedEnvelopeSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-role-attestation.v1.dsse-envelope\n${attestation.rawEvidence.envelopeUtf8}`,
    )}`;
    if (
      attestation.statement.subjectDigest !== subject.roleAttestationSubjectDigest ||
      predicate.attestationId !== subject.attestationId ||
      predicate.subjectKind !== subject.subjectKind ||
      predicate.role !== subject.role ||
      predicate.actorId !== subject.actorId ||
      predicate.tenantId !== subject.tenantId ||
      predicate.venueId !== subject.venueId ||
      predicate.spaceId !== subject.spaceId ||
      predicate.keyPolicyId !== subject.keyPolicyId ||
      predicate.keyPolicyDigest !== subject.keyPolicyDigest ||
      predicate.keyId !== subject.keyId ||
      predicate.signerPublicKeySha256 !== subject.signerPublicKeySha256 ||
      predicate.issuedAt !== subject.recordedAt ||
      predicate.effectiveAt !== subject.effectiveAt ||
      predicate.expiresAt !== subject.expiresAt ||
      predicate.nonce !== subject.nonce ||
      attestation.rawEvidence.payloadUtf8 !== expectedPayloadUtf8 ||
      attestation.rawEvidence.payloadSha256 !== sha256Hex(expectedPayloadUtf8) ||
      attestation.rawEvidence.receiptSha256 !== expectedReceiptSha256 ||
      attestation.rawEvidence.envelopeSha256 !== expectedEnvelopeSha256 ||
      attestation.rawEvidence.signerPublicKeySha256 !== subject.signerPublicKeySha256 ||
      attestation.rawEvidence.payloadByteLength !== String(utf8ByteLength(expectedPayloadUtf8)) ||
      attestation.rawEvidence.envelopeByteLength !==
        String(utf8ByteLength(attestation.rawEvidence.envelopeUtf8)) ||
      new Date(attestation.rawEvidence.verifiedAt).getTime() <
        new Date(subject.recordedAt).getTime() ||
      new Date(attestation.rawEvidence.verifiedAt).getTime() >=
        new Date(subject.expiresAt).getTime() ||
      canonicalDigest("venviewer.historical-runtime-role-attestation-receipt.v1\n", material) !==
        attestationDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attestationDigest"],
        message: "Role attestation must retain and bind the exact canonical payload, DSSE envelope, signer identity, and typed action subject.",
      });
    }
  });
export type HistoricalRuntimeRoleAttestation = z.infer<
  typeof HistoricalRuntimeRoleAttestationSchema
>;

export const HistoricalRuntimeProductionRoleAttestationSchema:
  z.ZodType<HistoricalRuntimeRoleAttestation> =
  HistoricalRuntimeRoleAttestationSchema.superRefine((attestation, context) => {
    if (attestation.subject.authoritySnapshot.authenticationSource === "local_test_fixture") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authoritySnapshot", "authenticationSource"],
        message: "Production evidence actions cannot use local-fixture authentication authority.",
      });
    }
    if (
      !HistoricalRuntimeProductionExactObjectReceiptSchema.safeParse(
        roleEvidenceDocumentReceipt(attestation.subject.evidence),
      ).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "Production evidence actions must bind a production-private versioned evidence document.",
      });
    }
  });

export const CreateHistoricalRuntimeEvidenceSubjectSchema = z.object({
  subjectId: z.string().uuid(),
  subjectKind: HistoricalRuntimeEvidenceSubjectKindSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
}).strict();

export const RecordHistoricalRuntimeRoleAttestationSchema = z.object({
  attestationId: z.string().uuid(),
  evidence: HistoricalRuntimeRoleEvidenceSchema,
  keyPolicyId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(
    HISTORICAL_RUNTIME_ROLE_ATTESTATION_MAX_TTL_MS / 1_000,
  ),
}).strict();

export const AcceptHistoricalRuntimeRoleAttestationSchema = z.object({
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
}).strict();

export const RevokeHistoricalRuntimeRoleAttestationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const HistoricalRuntimeSourceObjectCandidateSchema = z.object({
  componentIndex: z.number().int().nonnegative().max(255),
  role: z.enum([
    "raw_capture",
    "inventory_manifest",
    "processed_package_archive",
    "processed_package_member",
    "supporting_capture_metadata",
  ]),
  providerProfile: HistoricalRuntimeEvidenceProviderProfileSchema,
  storageKey: z.string().min(1).max(1024).refine(isSafeStorageKey, "Storage keys must be safe relative object paths."),
  relativePath: z.string().min(1).max(1024).refine(
    isSafeStorageKey,
    "Relative paths must be safe normalized object paths.",
  ).refine(
    (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
    "Relative paths must fit the exact database identity index.",
  ),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  mimeType: z.string().trim().min(1).max(160),
  expectedSha256: SHA256,
  expectedSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const HistoricalRuntimeSourceReceiptMemberSchema = z.object({
  componentIndex: z.number().int().nonnegative().max(255),
  role: HistoricalRuntimeSourceObjectCandidateSchema.shape.role,
  relativePath: z.string().min(1).max(1024).refine(
    isSafeStorageKey,
    "Relative paths must be safe normalized object paths.",
  ).refine(
    (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
    "Relative paths must fit the exact database identity index.",
  ),
  receipt: HistoricalRuntimeExactObjectReceiptSchema,
}).strict();

const HistoricalRuntimeSourceReceiptSetMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-source-receipt-set.v1"),
  receiptSetId: z.string().uuid(),
  lineageStartKind: z.enum([
    "raw_capture_object",
    "direct_camera_capture_bundle",
    "processed_capture_package",
  ]),
  ancestorState: z.enum(["exact_private_receipt", "owner_attested_unavailable_ancestor"]),
  unavailableAncestorAttestationId: z.string().uuid().nullable(),
  unavailableAncestorAttestationDigest: SHA256.nullable(),
  rootComponentIndex: z.number().int().nonnegative().max(255),
  members: z.array(HistoricalRuntimeSourceReceiptMemberSchema).min(1).max(256),
}).strict();

export function historicalRuntimeSourceReceiptSetDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-source-receipt-set.v1\n",
    HistoricalRuntimeSourceReceiptSetMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeSourceReceiptSetSchema =
  HistoricalRuntimeSourceReceiptSetMaterialSchema.extend({
    receiptSetDigest: SHA256,
  }).strict().superRefine((receiptSet, context) => {
    const { receiptSetDigest, ...material } = receiptSet;
    const contiguous = receiptSet.members.every((member, index) => member.componentIndex === index);
    const root = receiptSet.members[receiptSet.rootComponentIndex];
    const rawRoles = receiptSet.members.filter((member) => member.role === "raw_capture");
    const receiptIds = new Set(receiptSet.members.map((member) => member.receipt.receiptId));
    const receiptDigests = new Set(receiptSet.members.map((member) => member.receipt.receiptDigest));
    const relativePaths = new Set(receiptSet.members.map((member) => member.relativePath));
    const objectIdentities = new Set(receiptSet.members.map((member) => {
      const object = member.receipt.object;
      return [
        object.providerKind,
        object.providerAccountSha256,
        object.privateBucketSha256,
        object.storageKeySha256,
        object.versionKind,
        object.storageVersion,
      ].join("|");
    }));
    if (
      !contiguous || root === undefined ||
      receiptIds.size !== receiptSet.members.length ||
      receiptDigests.size !== receiptSet.members.length ||
      relativePaths.size !== receiptSet.members.length ||
      objectIdentities.size !== receiptSet.members.length ||
      canonicalDigest("venviewer.historical-runtime-source-receipt-set.v1\n", material) !==
        receiptSetDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "Source receipts must be contiguous, contain their declared root, and match their aggregate digest.",
      });
    }
    if (
      receiptSet.lineageStartKind === "raw_capture_object" &&
      (rawRoles.length !== 1 || root?.role !== "raw_capture" ||
        receiptSet.ancestorState !== "exact_private_receipt")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineageStartKind"],
        message: "A raw-capture root requires exactly one receipted raw object as its root.",
      });
    }
    if (
      receiptSet.lineageStartKind === "direct_camera_capture_bundle" &&
      (rawRoles.length < 1 || root?.role !== "raw_capture" ||
        receiptSet.ancestorState !== "exact_private_receipt")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineageStartKind"],
        message: "A direct-camera bundle requires an exact private raw-capture root.",
      });
    }
    if (
      receiptSet.lineageStartKind === "processed_capture_package" &&
      root?.role !== "inventory_manifest" &&
      root?.role !== "processed_package_archive"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "A processed package must bind an inventory manifest or deterministic package archive.",
      });
    }
    if (
      receiptSet.lineageStartKind === "processed_capture_package" &&
      root?.role === "inventory_manifest" &&
      !receiptSet.members.some((member) => member.role === "processed_package_member")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "An inventory-rooted processed package must also receipt every declared package member; use one deterministic archive receipt for an archive root.",
      });
    }
    const unavailable = receiptSet.ancestorState === "owner_attested_unavailable_ancestor";
    if (
      unavailable !== (receiptSet.unavailableAncestorAttestationId !== null) ||
      unavailable !== (receiptSet.unavailableAncestorAttestationDigest !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailableAncestorAttestationId"],
        message: "Unavailable ancestors require an exact authenticated gap attestation and receipted ancestors must not claim one.",
      });
    }
  });
export type HistoricalRuntimeSourceReceiptSet = z.infer<
  typeof HistoricalRuntimeSourceReceiptSetSchema
>;

const NormalizedBaseSchema = z.object({
  normalizationProfileVersion: z.literal("historical-runtime-normalization-profile.v1"),
  conformanceTestVectorSetDigest: SHA256,
  normalizedSha256: SHA256,
  normalizedSizeBytes: z.number().int().positive().max(MAX_NORMALIZED_BYTES),
  decoderName: z.string().trim().min(1).max(120),
  decoderVersion: z.string().trim().min(1).max(120),
  decoderBinarySha256: SHA256,
});

const HistoricalRuntimeInventoryIdentityMemberSchema = z.object({
  componentIndex: z.number().int().nonnegative().max(255),
  relativePath: z.string().min(1).max(1024).refine(
    isSafeStorageKey,
    "Relative paths must be safe normalized object paths.",
  ).refine(
    (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
    "Relative paths must fit the exact database identity index.",
  ),
  role: HistoricalRuntimeSourceObjectCandidateSchema.shape.role,
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const HistoricalRuntimeDetectedSourceFormatSchema = z.enum([
  "e57",
  "panorama_jpeg",
  "panorama_png",
  "panorama_tiff",
  "video_mp4",
  "video_quicktime",
  "ply",
  "obj",
  "sog",
  "spz",
  "processed_package_inventory",
]);

export const HistoricalRuntimeNormalizationPolicySchema = z.discriminatedUnion(
  "detectedSourceFormat",
  [
    z.object({ detectedSourceFormat: z.literal("e57"), requiredNormalizationSpec: z.literal("e57-cartesian-points-f64.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("panorama_jpeg"), requiredNormalizationSpec: z.literal("panorama-rgb8-srgb-top-left.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("panorama_png"), requiredNormalizationSpec: z.literal("panorama-rgb8-srgb-top-left.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("panorama_tiff"), requiredNormalizationSpec: z.literal("panorama-rgb8-srgb-top-left.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("video_mp4"), requiredNormalizationSpec: z.literal("video-frame-sequence-rgb8-srgb-top-left.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("video_quicktime"), requiredNormalizationSpec: z.literal("video-frame-sequence-rgb8-srgb-top-left.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("ply"), requiredNormalizationSpec: z.literal("ply-binary-little-endian-records.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("obj"), requiredNormalizationSpec: z.literal("obj-indexed-geometry-f64.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("sog"), requiredNormalizationSpec: z.literal("raw-bytes-exact.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("spz"), requiredNormalizationSpec: z.literal("raw-bytes-exact.v1") }).strict(),
    z.object({ detectedSourceFormat: z.literal("processed_package_inventory"), requiredNormalizationSpec: z.literal("ordered-object-inventory.v1") }).strict(),
  ],
);

export const HistoricalRuntimeNormalizedContentIdentitySchema = z.discriminatedUnion(
  "normalizationSpec",
  [
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("raw-bytes-exact.v1"),
      formatTag: z.enum(["sog", "spz"]),
      exactBinaryReason: z.literal("no-approved-deterministic-decoder-use-exact-versioned-bytes"),
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("ordered-object-inventory.v1"),
      objectCount: z.number().int().positive().max(256),
      orderingRule: z.literal("component-index-ascending"),
      inventoryEncoding: z.literal("utf8-sha256-size-role-path-lines-v1"),
      inventoryByteLength: z.number().int().positive().max(MAX_NORMALIZED_BYTES),
      inventoryMembers: z.array(HistoricalRuntimeInventoryIdentityMemberSchema).min(1).max(256),
      inventoryMembersDigest: SHA256,
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("panorama-rgb8-srgb-top-left.v1"),
      widthPixels: z.number().int().positive(),
      heightPixels: z.number().int().positive(),
      rowStrideBytes: z.number().int().positive(),
      frameByteLength: z.number().int().positive().max(MAX_NORMALIZED_BYTES),
      orientationRule: z.literal("apply-exif-1-to-8-then-top-left"),
      colourRule: z.literal("embedded-icc-to-srgb-relative-colorimetric-or-assume-srgb"),
      alphaRule: z.literal("reject-non-opaque-alpha"),
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("video-frame-sequence-rgb8-srgb-top-left.v1"),
      widthPixels: z.number().int().positive(),
      heightPixels: z.number().int().positive(),
      rowStrideBytes: z.number().int().positive(),
      frameCount: z.number().int().positive().max(1_000_000),
      frameByteLength: z.number().int().positive().max(MAX_NORMALIZED_BYTES),
      frameOrder: z.literal("presentation-timestamp-then-decode-index"),
      orientationRule: z.literal("container-display-matrix-then-top-left"),
      colourRule: z.literal("embedded-icc-to-srgb-relative-colorimetric-or-assume-srgb"),
      alphaRule: z.literal("reject-non-opaque-alpha"),
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("e57-cartesian-points-f64.v1"),
      pointCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      scanCount: z.number().int().positive().max(1_000_000),
      recordLayout: z.literal("xyz-f64-little-endian-valid-points-only"),
      invalidPointPolicy: z.literal("reject-non-finite-drop-explicit-invalid-state"),
      recordStrideBytes: z.literal(24),
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("ply-binary-little-endian-records.v1"),
      recordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      headerSizeBytes: z.number().int().nonnegative().max(MAX_NORMALIZED_BYTES),
      recordStrideBytes: z.number().int().positive().max(65_536),
      headerSha256: SHA256,
      propertyLayoutDigest: SHA256,
      recordOrder: z.literal("file-order"),
    }).strict(),
    NormalizedBaseSchema.extend({
      normalizationSpec: z.literal("obj-indexed-geometry-f64.v1"),
      vertexCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      indexCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      topology: z.enum(["triangles", "mixed-polygons-preserved"]),
      numericEncoding: z.literal("ieee754-f64-little-endian"),
      vertexRecordStrideBytes: z.literal(24),
      indexRecordStrideBytes: z.literal(4),
    }).strict(),
  ],
).superRefine((identity, context) => {
  let expectedSize: number | null = null;
  if (identity.normalizationSpec === "panorama-rgb8-srgb-top-left.v1") {
    expectedSize = identity.rowStrideBytes * identity.heightPixels;
    if (identity.frameByteLength !== expectedSize) expectedSize = -1;
  } else if (identity.normalizationSpec === "video-frame-sequence-rgb8-srgb-top-left.v1") {
    const frameSize = identity.rowStrideBytes * identity.heightPixels;
    expectedSize = frameSize * identity.frameCount;
    if (identity.frameByteLength !== frameSize) expectedSize = -1;
  } else if (identity.normalizationSpec === "e57-cartesian-points-f64.v1") {
    expectedSize = identity.pointCount * identity.recordStrideBytes;
  } else if (identity.normalizationSpec === "ply-binary-little-endian-records.v1") {
    expectedSize = identity.headerSizeBytes + identity.recordCount * identity.recordStrideBytes;
  } else if (identity.normalizationSpec === "obj-indexed-geometry-f64.v1") {
    expectedSize = identity.vertexCount * identity.vertexRecordStrideBytes +
      identity.indexCount * identity.indexRecordStrideBytes;
  } else if (identity.normalizationSpec === "ordered-object-inventory.v1") {
    const ordered = identity.inventoryMembers.every((member, index) => member.componentIndex === index);
    const uniquePaths = new Set(identity.inventoryMembers.map((member) => member.relativePath));
    if (
      !ordered ||
      uniquePaths.size !== identity.inventoryMembers.length ||
      identity.objectCount !== identity.inventoryMembers.length ||
      identity.inventoryByteLength !== identity.normalizedSizeBytes ||
      canonicalDigest(
        "venviewer.historical-runtime-normalized-inventory-members.v1\n",
        identity.inventoryMembers,
      ) !== identity.inventoryMembersDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inventoryMembersDigest"],
        message: "Inventory normalization must bind every unique relative path in exact component order.",
      });
    }
  }
  if (
    (identity.normalizationSpec === "panorama-rgb8-srgb-top-left.v1" ||
      identity.normalizationSpec === "video-frame-sequence-rgb8-srgb-top-left.v1") &&
    identity.rowStrideBytes !== identity.widthPixels * 3
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rowStrideBytes"],
      message: "RGB8 normalization requires a tightly packed three-byte row stride.",
    });
  }
  if (
    expectedSize !== null &&
    (!Number.isSafeInteger(expectedSize) || expectedSize !== identity.normalizedSizeBytes)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["normalizedSizeBytes"],
      message: "Normalized byte length must equal the closed format-specific record equation.",
    });
  }
});
export type HistoricalRuntimeNormalizedContentIdentity = z.infer<
  typeof HistoricalRuntimeNormalizedContentIdentitySchema
>;

export function historicalRuntimeNormalizedContentIdentityDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-normalized-content-identity.v1\n",
    HistoricalRuntimeNormalizedContentIdentitySchema,
    value,
  );
}

const HistoricalRuntimeCaptureContentSubjectMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-capture-content-subject.v1"),
  captureRootId: z.string().uuid(),
  tenantBoundary: z.literal("venue_id_v1"),
  tenantId: VenueIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  sourceReceiptSetId: z.string().uuid(),
  sourceReceiptSetDigest: SHA256,
  normalizedContentDigest: SHA256,
  normalizedBy: UserIdSchema,
}).strict().superRefine((subject, context) => {
  if (subject.tenantId !== subject.venueId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tenantId"],
      message: "Capture content subject tenant scope must equal the authoritative venue.",
    });
  }
});

export function historicalRuntimeCaptureContentSubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-capture-content-subject.v1\n",
    HistoricalRuntimeCaptureContentSubjectMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeCaptureContentIdentityPredicateSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_CAPTURE_CONTENT_IDENTITY_SCHEMA_VERSION),
  captureContentSubject: HistoricalRuntimeCaptureContentSubjectMaterialSchema,
  captureContentSubjectDigest: SHA256,
  keyPolicyId: z.string().uuid(),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  normalizerAttestationId: z.string().uuid(),
  normalizerAttestationDigest: SHA256,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
}).strict().superRefine((predicate, context) => {
  if (
    predicate.captureContentSubjectDigest !== canonicalDigest(
      "venviewer.historical-runtime-capture-content-subject.v1\n",
      predicate.captureContentSubject,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["captureContentSubjectDigest"],
      message: "Capture identity predicate must bind the pre-normalizer-review content subject.",
    });
  }
  const issuedAt = new Date(predicate.issuedAt).getTime();
  const expiresAt = new Date(predicate.expiresAt).getTime();
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > HISTORICAL_RUNTIME_CAPTURE_CONTENT_IDENTITY_MAX_TTL_MS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Capture identity signing authority must expire within the finite maximum TTL after issuance.",
    });
  }
});
export type HistoricalRuntimeCaptureContentIdentityPredicate = z.infer<
  typeof HistoricalRuntimeCaptureContentIdentityPredicateSchema
>;

export function historicalRuntimeCaptureContentIdentitySubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-capture-content-identity-subject.v1\n",
    HistoricalRuntimeCaptureContentIdentityPredicateSchema,
    value,
  );
}

export const HistoricalRuntimeCaptureContentIdentityStatementSchema = z.object({
  authority: z.literal("venue_evidence"),
  evidenceKind: z.literal("historical_runtime_capture_content_identity"),
  schemaVersion: z.literal("historical-runtime-capture-content-identity-statement.v1"),
  subjectName: z.string().trim().min(1).max(320),
  subjectDigest: SHA256,
  predicate: HistoricalRuntimeCaptureContentIdentityPredicateSchema,
}).strict().superRefine((statement, context) => {
  if (
    statement.subjectName !==
      `historical-runtime-capture-root/${statement.predicate.captureContentSubject.captureRootId}` ||
    statement.subjectDigest !== canonicalDigest(
      "venviewer.historical-runtime-capture-content-identity-subject.v1\n",
      statement.predicate,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectDigest"],
      message: "Capture content statement must bind the exact server-issued predicate.",
    });
  }
});
export type HistoricalRuntimeCaptureContentIdentityStatement = z.infer<
  typeof HistoricalRuntimeCaptureContentIdentityStatementSchema
>;

export function createHistoricalRuntimeCaptureContentIdentitySigningPayload(
  statementInput: unknown,
): { readonly payloadUtf8: string; readonly payloadSha256: string } {
  const statement = HistoricalRuntimeCaptureContentIdentityStatementSchema.parse(statementInput);
  const payloadUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(statement));
  return { payloadUtf8, payloadSha256: sha256Hex(payloadUtf8) };
}

export const IssueHistoricalRuntimeCaptureRootDraftSchema = z.object({
  captureRootId: z.string().uuid(),
  captureContentSubjectDigest: SHA256,
  normalizerAttestationId: z.string().uuid(),
  keyPolicyId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(
    HISTORICAL_RUNTIME_ROLE_ATTESTATION_MAX_TTL_MS / 1_000,
  ),
}).strict();

export const PrepareHistoricalRuntimeCaptureContentSubjectSchema = z.object({
  captureRootId: z.string().uuid(),
  sourceReceiptSetId: z.string().uuid(),
  captureClass: z.enum(["owner_authorized_existing_capture", "venue_operator_direct_camera"]),
  lineageStartKind: HistoricalRuntimeSourceReceiptSetMaterialSchema.shape.lineageStartKind,
  ancestorState: HistoricalRuntimeSourceReceiptSetMaterialSchema.shape.ancestorState,
  rootComponentIndex: z.number().int().nonnegative().max(255),
  sourceObjects: z.array(HistoricalRuntimeSourceObjectCandidateSchema).min(1).max(256),
  normalizedContent: HistoricalRuntimeNormalizedContentIdentitySchema,
  normalizationPolicy: HistoricalRuntimeNormalizationPolicySchema,
  captureOperatorAttestationId: z.string().uuid(),
  sourceCustodianAttestationId: z.string().uuid(),
}).strict().superRefine((input, context) => {
  const uniquePaths = new Set(input.sourceObjects.map((member) => member.relativePath));
  const uniqueKeys = new Set(input.sourceObjects.map((member) =>
    `${member.providerProfile}|${member.storageKey}`));
  const detectedFormat = input.normalizationPolicy.detectedSourceFormat;
  const root = input.sourceObjects[input.rootComponentIndex];
  const directCameraLineageMatches = input.captureClass !== "venue_operator_direct_camera" ||
    input.lineageStartKind === "direct_camera_capture_bundle" &&
      input.ancestorState === "exact_private_receipt" && root?.role === "raw_capture";
  const existingCaptureLineageMatches = input.captureClass !== "owner_authorized_existing_capture" ||
    input.lineageStartKind !== "direct_camera_capture_bundle";
  const exactBinaryFormatMatches =
    detectedFormat !== "sog" && detectedFormat !== "spz" ||
    input.normalizedContent.normalizationSpec === "raw-bytes-exact.v1" &&
      input.normalizedContent.formatTag === detectedFormat;
  if (
    !input.sourceObjects.every((member, index) => member.componentIndex === index) ||
    uniquePaths.size !== input.sourceObjects.length ||
    uniqueKeys.size !== input.sourceObjects.length ||
    !directCameraLineageMatches ||
    !existingCaptureLineageMatches ||
    !exactBinaryFormatMatches ||
    input.normalizationPolicy.requiredNormalizationSpec !== input.normalizedContent.normalizationSpec
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceObjects"],
      message: "Source candidates must be unique and ordered, and the server-detected format policy must select their exact normalization profile.",
    });
  }
});

export const AcceptHistoricalRuntimeCaptureRootSchema = z.object({
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
}).strict();

const HistoricalRuntimeCaptureRootEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_CAPTURE_ROOT_EVIDENCE_SCHEMA_VERSION),
  captureRootId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  captureClass: z.enum(["owner_authorized_existing_capture", "venue_operator_direct_camera"]),
  sourceReceiptSetId: z.string().uuid(),
  sourceReceiptSetDigest: SHA256,
  normalizedContentDigest: SHA256,
  captureOperatorAttestationId: z.string().uuid(),
  captureOperatorAttestationDigest: SHA256,
  sourceCustodianAttestationId: z.string().uuid(),
  sourceCustodianAttestationDigest: SHA256,
  captureContentSubjectDigest: SHA256,
  captureContentStatement: HistoricalRuntimeCaptureContentIdentityStatementSchema,
  captureContentPayloadUtf8: z.string().min(1).max(512 * 1024),
  captureContentEnvelopeUtf8: z.string().min(1).max(1024 * 1024),
  captureContentPredicateDigest: SHA256,
  captureContentPayloadSha256: SHA256,
  captureContentReceiptSha256: HistoricalRuntimeDomainSha256Schema,
  captureContentEnvelopeSha256: HistoricalRuntimeDomainSha256Schema,
  captureContentSignerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  captureContentPayloadByteLength: z.string().regex(DECIMAL_UINT),
  captureContentEnvelopeByteLength: z.string().regex(DECIMAL_UINT),
  captureContentVerifiedAt: z.string().datetime({ offset: true }),
  normalizerAttestationId: z.string().uuid(),
  normalizerAttestationDigest: SHA256,
  normalizedBy: UserIdSchema,
  normalizedAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeCaptureRootEvidenceDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-capture-root-evidence.v1\n",
    HistoricalRuntimeCaptureRootEvidenceMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeCaptureRootEvidenceSchema =
  HistoricalRuntimeCaptureRootEvidenceMaterialSchema.extend({
    captureRootEvidenceDigest: SHA256,
  }).strict().superRefine((root, context) => {
    const { captureRootEvidenceDigest, ...material } = root;
    const predicate = root.captureContentStatement.predicate;
    const contentSubject = predicate.captureContentSubject;
    const expectedPayloadUtf8 = stableCanonicalJson(
      CanonicalJsonValueSchema.parse(root.captureContentStatement),
    );
    const expectedReceiptSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-capture-content-identity.v1\n${expectedPayloadUtf8}`,
    )}`;
    const expectedEnvelopeSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-capture-content-identity.v1.dsse-envelope\n${root.captureContentEnvelopeUtf8}`,
    )}`;
    if (
      root.captureRootId !== contentSubject.captureRootId ||
      root.venueId !== contentSubject.venueId ||
      root.spaceId !== contentSubject.spaceId ||
      root.sourceReceiptSetId !== contentSubject.sourceReceiptSetId ||
      root.sourceReceiptSetDigest !== contentSubject.sourceReceiptSetDigest ||
      root.normalizedContentDigest !== contentSubject.normalizedContentDigest ||
      root.normalizedBy !== contentSubject.normalizedBy ||
      root.captureContentSubjectDigest !== predicate.captureContentSubjectDigest ||
      root.captureContentPredicateDigest !== root.captureContentStatement.subjectDigest ||
      root.normalizerAttestationId !== predicate.normalizerAttestationId ||
      root.normalizerAttestationDigest !== predicate.normalizerAttestationDigest ||
      root.captureContentPayloadUtf8 !== expectedPayloadUtf8 ||
      root.captureContentPayloadSha256 !== sha256Hex(expectedPayloadUtf8) ||
      root.captureContentReceiptSha256 !== expectedReceiptSha256 ||
      root.captureContentEnvelopeSha256 !== expectedEnvelopeSha256 ||
      root.captureContentSignerPublicKeySha256 !== predicate.signerPublicKeySha256 ||
      root.captureContentPayloadByteLength !== String(utf8ByteLength(expectedPayloadUtf8)) ||
      root.captureContentEnvelopeByteLength !==
        String(utf8ByteLength(root.captureContentEnvelopeUtf8)) ||
      new Date(root.captureContentVerifiedAt).getTime() < new Date(predicate.issuedAt).getTime() ||
      new Date(root.captureContentVerifiedAt).getTime() >= new Date(predicate.expiresAt).getTime() ||
      canonicalDigest("venviewer.historical-runtime-capture-root-evidence.v1\n", material) !==
        captureRootEvidenceDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureRootEvidenceDigest"],
        message: "Capture root evidence digest must bind the exact source receipts and raw DSSE identities.",
      });
    }
  });

export const FinalizeHistoricalRuntimeCaptureClearanceSchema = z.object({
  clearanceId: z.string().uuid(),
  captureRootId: z.string().uuid(),
  ownerAuthorizationAttestationId: z.string().uuid(),
  privacyReviewAttestationId: z.string().uuid(),
  movableContentReviewAttestationId: z.string().uuid(),
  finalReviewAttestationId: z.string().uuid(),
}).strict();

const HistoricalRuntimeCaptureClearanceMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-capture-clearance.v1"),
  clearanceId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  captureRootId: z.string().uuid(),
  captureRootEvidenceDigest: SHA256,
  sourceReceiptSetId: z.string().uuid(),
  sourceReceiptSetDigest: SHA256,
  ownerAuthorizationAttestationId: z.string().uuid(),
  ownerAuthorizationAttestationDigest: SHA256,
  ownerAuthorizerActorId: UserIdSchema,
  privacyReviewAttestationId: z.string().uuid(),
  privacyReviewAttestationDigest: SHA256,
  privacyReviewerActorId: UserIdSchema,
  movableContentReviewAttestationId: z.string().uuid(),
  movableContentReviewAttestationDigest: SHA256,
  movableContentReviewerActorId: UserIdSchema,
  finalReviewAttestationId: z.string().uuid(),
  finalReviewAttestationDigest: SHA256,
  finalReviewerActorId: UserIdSchema,
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  registeredAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeCaptureClearanceDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-capture-clearance.v1\n",
    HistoricalRuntimeCaptureClearanceMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeCaptureClearanceSchema =
  HistoricalRuntimeCaptureClearanceMaterialSchema.extend({
    captureClearanceDigest: SHA256,
  }).strict().superRefine((clearance, context) => {
    const { captureClearanceDigest, ...material } = clearance;
    const registeredAt = new Date(clearance.registeredAt).getTime();
    const effectiveAt = new Date(clearance.effectiveAt).getTime();
    const expiresAt = new Date(clearance.expiresAt).getTime();
    if (
      effectiveAt < registeredAt ||
      expiresAt <= effectiveAt ||
      canonicalDigest("venviewer.historical-runtime-capture-clearance.v1\n", material) !==
        captureClearanceDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureClearanceDigest"],
        message: "Capture clearance must bind current owner, privacy, movable-content, and final review authority.",
      });
    }
  });

export const RegisterHistoricalRuntimeDerivationSchema = z.object({
  derivationId: z.string().uuid(),
  captureRootId: z.string().uuid(),
  captureClearanceId: z.string().uuid(),
  inputNormalizedContentDigest: SHA256,
  conversionTool: z.string().trim().min(1).max(160),
  conversionVersion: z.string().trim().min(1).max(120),
  conversionBinarySha256: SHA256,
  conversionCommandSha256: SHA256,
  conversionParametersDigest: SHA256,
  conversionEnvironmentDigest: SHA256,
  producerAttestationId: z.string().uuid(),
  custodianAttestationId: z.string().uuid(),
  reviewerAttestationId: z.string().uuid(),
  outputs: z.array(z.object({
    memberIndex: z.number().int().nonnegative().max(7),
    assetVersionId: z.string().uuid(),
    providerProfile: HistoricalRuntimeEvidenceProviderProfileSchema,
    storageKey: z.string().min(1).max(1024).refine(isSafeStorageKey, "Storage keys must be safe relative object paths."),
  }).strict()).min(1).max(8),
}).strict().superRefine((input, context) => {
  if (!input.outputs.every((output, index) => output.memberIndex === index)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outputs"],
      message: "Derivation outputs must be dense and ordered by memberIndex.",
    });
  }
});

export const HistoricalRuntimeConversionRecipeMaterialSchema = z.object({
  conversionTool: z.string().trim().min(1).max(160),
  conversionVersion: z.string().trim().min(1).max(120),
  conversionBinarySha256: SHA256,
  conversionCommandSha256: SHA256,
  conversionParametersDigest: SHA256,
  conversionEnvironmentDigest: SHA256,
}).strict();

export function historicalRuntimeConversionRecipeDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-conversion-recipe.v1\n",
    HistoricalRuntimeConversionRecipeMaterialSchema,
    value,
  );
}

const HistoricalRuntimeDerivationMemberSchema = z.object({
  memberIndex: z.number().int().nonnegative().max(7),
  assetVersionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  fileExt: z.enum([".sog", ".spz"]),
  mimeType: z.string().trim().min(1).max(160),
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(16 * 1024 * 1024),
  outputReceipt: HistoricalRuntimeExactObjectReceiptSchema,
}).strict();

const HistoricalRuntimeDerivationEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_DERIVATION_EVIDENCE_SCHEMA_VERSION),
  derivationId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  captureRootId: z.string().uuid(),
  captureRootEvidenceDigest: SHA256,
  inputNormalizedContentDigest: SHA256,
  captureClearanceId: z.string().uuid(),
  captureClearanceDigest: SHA256,
  conversionTool: z.string().trim().min(1).max(160),
  conversionVersion: z.string().trim().min(1).max(120),
  conversionBinarySha256: SHA256,
  conversionCommandSha256: SHA256,
  conversionParametersDigest: SHA256,
  conversionEnvironmentDigest: SHA256,
  conversionRecipeDigest: SHA256,
  producerAttestationId: z.string().uuid(),
  producerAttestationDigest: SHA256,
  custodianAttestationId: z.string().uuid(),
  custodianAttestationDigest: SHA256,
  reviewerAttestationId: z.string().uuid(),
  reviewerAttestationDigest: SHA256,
  memberCount: z.number().int().positive().max(8),
  totalBytes: z.number().int().positive().max(96 * 1024 * 1024),
  members: z.array(HistoricalRuntimeDerivationMemberSchema).min(1).max(8),
  membersDigest: SHA256,
  registeredAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeDerivationMembersDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-derivation-members.v1\n",
    z.array(HistoricalRuntimeDerivationMemberSchema).min(1).max(8),
    value,
  );
}

export function historicalRuntimeDerivationEvidenceDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-derivation-evidence.v1\n",
    HistoricalRuntimeDerivationEvidenceMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeDerivationEvidenceSchema =
  HistoricalRuntimeDerivationEvidenceMaterialSchema.extend({
    derivationEvidenceDigest: SHA256,
  }).strict().superRefine((derivation, context) => {
    const { derivationEvidenceDigest, ...material } = derivation;
    const conversionRecipe = {
      conversionTool: derivation.conversionTool,
      conversionVersion: derivation.conversionVersion,
      conversionBinarySha256: derivation.conversionBinarySha256,
      conversionCommandSha256: derivation.conversionCommandSha256,
      conversionParametersDigest: derivation.conversionParametersDigest,
      conversionEnvironmentDigest: derivation.conversionEnvironmentDigest,
    };
    const totalBytes = derivation.members.reduce((sum, member) => sum + member.sizeBytes, 0);
    const assetIds = new Set(derivation.members.map((member) => member.assetVersionId));
    const receiptIds = new Set(derivation.members.map((member) => member.outputReceipt.receiptId));
    const receiptDigests = new Set(derivation.members.map((member) => member.outputReceipt.receiptDigest));
    const exactReceiptBindings = derivation.members.every((member) =>
      member.fileName === member.outputReceipt.object.fileName &&
      member.mimeType === member.outputReceipt.object.mimeType &&
      member.sha256 === member.outputReceipt.object.sha256 &&
      member.sizeBytes === member.outputReceipt.object.sizeBytes &&
      member.fileName.endsWith(member.fileExt));
    if (
      !derivation.members.every((member, index) => member.memberIndex === index) ||
      assetIds.size !== derivation.members.length ||
      receiptIds.size !== derivation.members.length ||
      receiptDigests.size !== derivation.members.length ||
      !exactReceiptBindings ||
      derivation.memberCount !== derivation.members.length ||
      derivation.totalBytes !== totalBytes ||
      derivation.conversionRecipeDigest !== canonicalDigest(
        "venviewer.historical-runtime-conversion-recipe.v1\n",
        conversionRecipe,
      ) ||
      derivation.membersDigest !== canonicalDigest(
        "venviewer.historical-runtime-derivation-members.v1\n",
        derivation.members,
      ) ||
      derivationEvidenceDigest !== canonicalDigest(
        "venviewer.historical-runtime-derivation-evidence.v1\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["derivationEvidenceDigest"],
        message: "Derivation evidence must bind one root and its exact ordered output bytes and lineage.",
      });
    }
  });
export type HistoricalRuntimeDerivationEvidence = z.infer<
  typeof HistoricalRuntimeDerivationEvidenceSchema
>;

export const RegisterHistoricalRuntimeTransformReviewSchema = z.object({
  transformReviewId: z.string().uuid(),
  presentationAdmissionId: z.string().uuid(),
  reviewerAttestationId: z.string().uuid(),
}).strict();

const HistoricalRuntimeTransformReviewSubjectSchema = z.object({
  schemaVersion: z.literal("historical-runtime-transform-review-subject.v1"),
  transformReviewId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  runtimePackageId: z.string().uuid(),
  runtimePackageContentDigest: SHA256,
  transformArtifactRowId: z.string().uuid(),
  transformArtifactId: RuntimeManifestKeySchema,
  transformArtifactDigest: SHA256,
}).strict();

export function historicalRuntimeTransformReviewSubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-transform-review-subject.v1\n",
    HistoricalRuntimeTransformReviewSubjectSchema,
    value,
  );
}

const HistoricalRuntimeTransformReviewMaterialSchema = z.object({
  subject: HistoricalRuntimeTransformReviewSubjectSchema,
  subjectDigest: SHA256,
  reviewerAttestationId: z.string().uuid(),
  reviewerAttestationDigest: SHA256,
  reviewerActorId: UserIdSchema,
  decision: z.literal("approved"),
  reviewedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeTransformReviewDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-transform-review.v1\n",
    HistoricalRuntimeTransformReviewMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeTransformReviewSchema =
  HistoricalRuntimeTransformReviewMaterialSchema.extend({
    transformReviewDigest: SHA256,
  }).strict().superRefine((review, context) => {
    const { transformReviewDigest, ...material } = review;
    if (
      review.subjectDigest !== canonicalDigest(
        "venviewer.historical-runtime-transform-review-subject.v1\n",
        review.subject,
      ) ||
      new Date(review.expiresAt).getTime() <= new Date(review.reviewedAt).getTime() ||
      canonicalDigest("venviewer.historical-runtime-transform-review.v1\n", material) !==
        transformReviewDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformReviewDigest"],
        message: "Transform review must bind its exact artifact subject and independent reviewer attestation.",
      });
    }
  });

export const RegisterHistoricalRuntimeRightsClearanceSchema = z.object({
  rightsClearanceId: z.string().uuid(),
  derivationId: z.string().uuid(),
  memberIndex: z.number().int().nonnegative().max(7),
  presentationAdmissionId: z.string().uuid(),
  rightsEvidenceRowId: z.string().uuid(),
  reviewerAttestationId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(
    HISTORICAL_RUNTIME_ROLE_ATTESTATION_MAX_TTL_MS / 1_000,
  ),
}).strict();

const HistoricalRuntimeRightsClearanceSubjectSchema = z.object({
  schemaVersion: z.literal("historical-runtime-rights-clearance-subject.v1"),
  rightsClearanceId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  derivationId: z.string().uuid(),
  derivationEvidenceDigest: SHA256,
  memberIndex: z.number().int().nonnegative().max(7),
  assetVersionId: z.string().uuid(),
  outputReceiptId: z.string().uuid(),
  outputReceiptDigest: SHA256,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  rightsEvidenceRowId: z.string().uuid(),
  rightsEvidenceDigest: SHA256,
  rightsDecision: z.literal("approved"),
  rightsReviewedBy: UserIdSchema,
  rightsReviewedAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeRightsClearanceSubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-rights-clearance-subject.v1\n",
    HistoricalRuntimeRightsClearanceSubjectSchema,
    value,
  );
}

const HistoricalRuntimeRightsClearanceMaterialSchema = z.object({
  subject: HistoricalRuntimeRightsClearanceSubjectSchema,
  subjectDigest: SHA256,
  reviewerAttestationId: z.string().uuid(),
  reviewerAttestationDigest: SHA256,
  reviewerActorId: UserIdSchema,
  effectiveAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  registeredAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeRightsClearanceDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-rights-clearance.v1\n",
    HistoricalRuntimeRightsClearanceMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeRightsClearanceSchema =
  HistoricalRuntimeRightsClearanceMaterialSchema.extend({
    rightsClearanceDigest: SHA256,
  }).strict().superRefine((clearance, context) => {
    const { rightsClearanceDigest, ...material } = clearance;
    if (
      clearance.subjectDigest !== canonicalDigest(
        "venviewer.historical-runtime-rights-clearance-subject.v1\n",
        clearance.subject,
      ) ||
      new Date(clearance.effectiveAt).getTime() < new Date(clearance.registeredAt).getTime() ||
      new Date(clearance.expiresAt).getTime() <= new Date(clearance.effectiveAt).getTime() ||
      canonicalDigest("venviewer.historical-runtime-rights-clearance.v1\n", material) !==
        rightsClearanceDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rightsClearanceDigest"],
        message: "Rights clearance must bind one exact derivation member, legacy review leaf, and current authenticated reviewer.",
      });
    }
  });

const HistoricalRuntimeTwinReleaseAuthorityMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-twin-release-authority.v1"),
  authorityId: z.string().uuid(),
  sceneValidationId: z.string().uuid(),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  releaseId: z.string().uuid(),
  releaseKind: z.literal("venue_twin_v1"),
  releaseDigest: SHA256,
  releaseManifestSha256: SHA256,
  releaseCreatedBy: UserIdSchema,
  releaseCreatedAt: z.string().datetime({ offset: true }),
  releaseReviewId: z.string().uuid(),
  releaseQaReportDigest: SHA256,
  releaseReviewDigest: SHA256,
  releaseReviewerActorId: UserIdSchema,
  releaseReviewerAuthority: z.literal("platform_admin"),
  releaseReviewDecision: z.literal("approved"),
  releaseTargetExposure: z.enum(["expert_review", "public"]),
  releaseReviewSequence: z.number().int().positive(),
  releaseSupersedesReviewId: z.string().uuid().nullable(),
  releaseReviewedAt: z.string().datetime({ offset: true }),
  releaseAttestationId: z.string().uuid(),
  releaseAttestationEnvelopeSha256: SHA256,
  releaseAttestationVerifiedBy: UserIdSchema,
  releaseAttestationVerifiedAt: z.string().datetime({ offset: true }),
  authoritySnapshotId: z.string().uuid(),
  authoritySnapshot: HistoricalRuntimeAuthoritySnapshotSchema,
  approvedByActorId: UserIdSchema,
  approvedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeTwinReleaseAuthorityDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-twin-release-authority.v1\n",
    HistoricalRuntimeTwinReleaseAuthorityMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeTwinReleaseAuthoritySchema =
  HistoricalRuntimeTwinReleaseAuthorityMaterialSchema.extend({
    twinReleaseAuthorityDigest: SHA256,
  }).strict().superRefine((authority, context) => {
    const { twinReleaseAuthorityDigest, ...material } = authority;
    const createdAt = new Date(authority.releaseCreatedAt).getTime();
    const reviewedAt = new Date(authority.releaseReviewedAt).getTime();
    const attestedAt = new Date(authority.releaseAttestationVerifiedAt).getTime();
    const approvedAt = new Date(authority.approvedAt).getTime();
    const expiresAt = new Date(authority.expiresAt).getTime();
    const actors = new Set([
      authority.releaseCreatedBy,
      authority.releaseReviewerActorId,
      authority.releaseAttestationVerifiedBy,
      authority.approvedByActorId,
    ]);
    if (
      authority.authoritySnapshot.platformRole !== "admin" ||
      actors.size !== 4 ||
      createdAt > reviewedAt ||
      reviewedAt > attestedAt ||
      attestedAt > approvedAt ||
      approvedAt >= expiresAt ||
      canonicalDigest(
        "venviewer.historical-runtime-twin-release-authority.v1\n",
        material,
      ) !== twinReleaseAuthorityDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["twinReleaseAuthorityDigest"],
        message: "The test-only legacy twin wrapper must bind its complete sequenced review, attestation, and independent platform-admin authority.",
      });
    }
  });
export type HistoricalRuntimeTwinReleaseAuthority = z.infer<
  typeof HistoricalRuntimeTwinReleaseAuthoritySchema
>;

const HistoricalRuntimeTwinReleaseApprovalAuthoritySchema = z.object({
  actionAuthoritySnapshotId: z.string().uuid(),
  actionKind: z.literal("twin_release_authority_approval"),
  actionId: z.string().uuid(),
  actionParametersDigest: SHA256,
  actorId: UserIdSchema,
  authorityRole: z.literal("twin_release_approver"),
  authorityDigest: SHA256,
  snapshottedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

const HistoricalRuntimeTwinReleaseVerificationReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(
    "historical-runtime-twin-release-verification-receipt.v1",
  ),
  verificationBoundary: z.literal("ed25519_dsse_verified_by_service_v1"),
  verifiedByDatabasePrincipal: z.literal(
    "omnitwin_historical_evidence_verifier",
  ),
  envelopeSha256: SHA256,
  payloadSha256: SHA256,
  signingKeyAuthorityId: z.string().uuid(),
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  publicKeyFingerprint: SHA256,
  verifiedAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeTwinReleaseVerificationReceiptDigest(
  value: unknown,
): string {
  return digest(
    "venviewer.historical-runtime-twin-release-verification-receipt.v1\n",
    HistoricalRuntimeTwinReleaseVerificationReceiptMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeTwinReleaseVerificationReceiptSchema =
  HistoricalRuntimeTwinReleaseVerificationReceiptMaterialSchema.extend({
    verificationReceiptDigest: SHA256,
  }).strict().superRefine((receipt, context) => {
    const { verificationReceiptDigest, ...material } = receipt;
    if (
      canonicalDigest(
        "venviewer.historical-runtime-twin-release-verification-receipt.v1\n",
        material,
      ) !== verificationReceiptDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationReceiptDigest"],
        message: "Twin-release verification receipt must bind the exact raw envelope, payload, key, verifier principal, and verification time.",
      });
    }
  });

const HistoricalRuntimeVerifiedTwinReleaseAuthorityMaterialSchema = z.object({
  schemaVersion: z.literal(
    "historical-runtime-verified-twin-release-authority.v1",
  ),
  authorityId: z.string().uuid(),
  sceneValidationId: z.string().uuid(),
  venueId: VenueIdSchema,
  venueSlug: VenueSlugSchema,
  spaceId: SpaceIdSchema,
  spaceSlug: SpaceSlugSchema,
  releaseId: z.string().uuid(),
  releaseKind: z.literal("venue_twin_v1"),
  releaseDigest: SHA256,
  sourceManifestSha256: SHA256,
  releaseManifestSha256: SHA256,
  releaseCreatedBy: UserIdSchema,
  releaseCreatedAt: z.string().datetime({ offset: true }),
  releaseReviewId: z.string().uuid(),
  releaseQaReportDigest: SHA256,
  releaseReviewDigest: SHA256,
  releaseReviewerActorId: UserIdSchema,
  releaseReviewerAuthority: z.literal("platform_admin"),
  releaseReviewDecision: z.literal("approved"),
  releaseTargetExposure: z.literal("public"),
  releaseReviewSequence: z.number().int().positive(),
  releaseSupersedesReviewId: z.string().uuid().nullable(),
  releaseReviewedAt: z.string().datetime({ offset: true }),
  releaseAttestationId: z.string().uuid(),
  legacyAttestationEnvelopeSha256: SHA256,
  legacyAttestationObjectKeySha256: SHA256,
  legacyAttestationVerifiedBy: UserIdSchema,
  legacyAttestationVerifiedAt: z.string().datetime({ offset: true }),
  envelopeObjectReceipt: HistoricalRuntimeExactObjectReceiptSchema,
  envelope: ReconstructionDsseEnvelopeSchema,
  envelopeUtf8: z.string().min(1).max(2 * 1024 * 1024),
  envelopeSha256: SHA256,
  envelopeByteLength: z.string().regex(DECIMAL_UINT),
  payloadType: z.literal(RECONSTRUCTION_DSSE_PAYLOAD_TYPE),
  payloadUtf8: z.string().min(1).max(1024 * 1024),
  payloadSha256: SHA256,
  payloadByteLength: z.string().regex(DECIMAL_UINT),
  statement: ReconstructionReleaseSigningStatementSchema,
  signingKeyAuthorityId: z.string().uuid(),
  keyPolicyId: z.string().uuid(),
  keyPurpose: z.literal("historical_runtime_twin_release_attestation"),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  publicKeyFingerprint: SHA256,
  keyExpiresAt: z.string().datetime({ offset: true }),
  verificationReceipt: HistoricalRuntimeTwinReleaseVerificationReceiptSchema,
  approvalAuthority: HistoricalRuntimeTwinReleaseApprovalAuthoritySchema,
  approvedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeVerifiedTwinReleaseAuthorityDigest(
  value: unknown,
): string {
  return digest(
    "venviewer.historical-runtime-verified-twin-release-authority.v1\n",
    HistoricalRuntimeVerifiedTwinReleaseAuthorityMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema =
  HistoricalRuntimeVerifiedTwinReleaseAuthorityMaterialSchema.extend({
    twinReleaseAuthorityDigest: SHA256,
  }).strict().superRefine((authority, context) => {
    const { twinReleaseAuthorityDigest, ...material } = authority;
    const statement = authority.statement;
    const predicate = statement.predicate;
    const parsedEnvelope = (() => {
      try {
        return ReconstructionDsseEnvelopeSchema.safeParse(
          JSON.parse(authority.envelopeUtf8) as unknown,
        );
      } catch {
        return { success: false } as const;
      }
    })();
    const parsedStatement = (() => {
      try {
        return ReconstructionReleaseSigningStatementSchema.safeParse(
          JSON.parse(authority.payloadUtf8) as unknown,
        );
      } catch {
        return { success: false } as const;
      }
    })();
    const createdAt = new Date(authority.releaseCreatedAt).getTime();
    const reviewedAt = new Date(authority.releaseReviewedAt).getTime();
    const legacyVerifiedAt = new Date(
      authority.legacyAttestationVerifiedAt,
    ).getTime();
    const approvalSnapshottedAt = new Date(
      authority.approvalAuthority.snapshottedAt,
    ).getTime();
    const approvalAuthorityExpiresAt = new Date(
      authority.approvalAuthority.expiresAt,
    ).getTime();
    const envelopeProbedAt = new Date(
      authority.envelopeObjectReceipt.anonymousAccessDenial.probedAt,
    ).getTime();
    const verifiedAt = new Date(
      authority.verificationReceipt.verifiedAt,
    ).getTime();
    const approvedAt = new Date(authority.approvedAt).getTime();
    const expiresAt = new Date(authority.expiresAt).getTime();
    const actors = new Set([
      authority.releaseCreatedBy,
      authority.releaseReviewerActorId,
      authority.legacyAttestationVerifiedBy,
      authority.approvalAuthority.actorId,
    ]);
    const exactEnvelope = parsedEnvelope.success &&
      stableCanonicalJson(CanonicalJsonValueSchema.parse(parsedEnvelope.data)) ===
        stableCanonicalJson(CanonicalJsonValueSchema.parse(authority.envelope));
    const exactStatement = parsedStatement.success &&
      stableCanonicalJson(CanonicalJsonValueSchema.parse(parsedStatement.data)) ===
        stableCanonicalJson(CanonicalJsonValueSchema.parse(statement));
    if (
      !HistoricalRuntimeProductionExactObjectReceiptSchema.safeParse(
        authority.envelopeObjectReceipt,
      ).success ||
      authority.envelopeObjectReceipt.object.sha256 !== authority.envelopeSha256 ||
      authority.envelopeObjectReceipt.object.sizeBytes !==
        utf8ByteLength(authority.envelopeUtf8) ||
      authority.envelopeSha256 !== sha256Hex(authority.envelopeUtf8) ||
      authority.envelopeByteLength !==
        String(utf8ByteLength(authority.envelopeUtf8)) ||
      !exactEnvelope ||
      authority.envelope.payloadType !== authority.payloadType ||
      authority.envelope.payload !== canonicalBase64Utf8(authority.payloadUtf8) ||
      !authority.envelope.signatures.some(
        (signature) => signature.keyid === authority.keyId,
      ) ||
      authority.payloadSha256 !== sha256Hex(authority.payloadUtf8) ||
      authority.payloadByteLength !== String(utf8ByteLength(authority.payloadUtf8)) ||
      !exactStatement ||
      statement.subject[0]?.digest.sha256 !== authority.releaseDigest ||
      predicate.venueSlug !== authority.venueSlug ||
      predicate.releaseId !== authority.releaseId ||
      predicate.releaseKind !== authority.releaseKind ||
      predicate.releaseDigest !== authority.releaseDigest ||
      predicate.sourceManifestSha256 !== authority.sourceManifestSha256 ||
      predicate.releaseManifestSha256 !== authority.releaseManifestSha256 ||
      predicate.qaReportDigest !== authority.releaseQaReportDigest ||
      predicate.reviewId !== authority.releaseReviewId ||
      predicate.reviewDigest !== authority.releaseReviewDigest ||
      predicate.reviewedAt !== authority.releaseReviewedAt ||
      predicate.reviewerUserId !== authority.releaseReviewerActorId ||
      predicate.decision !== authority.releaseReviewDecision ||
      predicate.targetExposure !== authority.releaseTargetExposure ||
      authority.legacyAttestationEnvelopeSha256 !== authority.envelopeSha256 ||
      authority.legacyAttestationObjectKeySha256 !==
        authority.envelopeObjectReceipt.object.storageKeySha256 ||
      authority.verificationReceipt.envelopeSha256 !== authority.envelopeSha256 ||
      authority.verificationReceipt.payloadSha256 !== authority.payloadSha256 ||
      authority.verificationReceipt.signingKeyAuthorityId !==
        authority.signingKeyAuthorityId ||
      authority.verificationReceipt.keyId !== authority.keyId ||
      authority.verificationReceipt.publicKeyFingerprint !==
        authority.publicKeyFingerprint ||
      actors.size !== 4 ||
      createdAt > reviewedAt ||
      reviewedAt > legacyVerifiedAt ||
      approvalSnapshottedAt > verifiedAt ||
      verifiedAt >= approvalAuthorityExpiresAt ||
      verifiedAt < envelopeProbedAt ||
      verifiedAt !== approvedAt ||
      approvedAt >= expiresAt ||
      expiresAt > new Date(authority.keyExpiresAt).getTime() ||
      expiresAt > new Date(
        authority.envelopeObjectReceipt.anonymousAccessDenial.expiresAt,
      ).getTime() ||
      expiresAt - approvedAt >
        HISTORICAL_RUNTIME_VERIFIED_TWIN_RELEASE_AUTHORITY_MAX_TTL_MS ||
      canonicalDigest(
        "venviewer.historical-runtime-verified-twin-release-authority.v1\n",
        material,
      ) !== twinReleaseAuthorityDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["twinReleaseAuthorityDigest"],
        message: "Production twin authority must bind the latest approved release review, exact private raw DSSE envelope, current purpose-scoped key, trusted verifier receipt, and independent platform-admin action.",
      });
    }
  });
export type HistoricalRuntimeVerifiedTwinReleaseAuthority = z.infer<
  typeof HistoricalRuntimeVerifiedTwinReleaseAuthoritySchema
>;

export const RevokeHistoricalRuntimeEvidenceRecordSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const RegisterHistoricalRuntimeSceneValidationSchema = z.object({
  sceneValidationId: z.string().uuid(),
  presentationAdmissionId: z.string().uuid(),
  derivationId: z.string().uuid(),
  transformReviewId: z.string().uuid(),
  providerProfile: z.enum(["runtime_private", "foundry_candidate", "local_fixture"]),
  memberAuthorityReferences: z.array(z.object({
    memberIndex: z.number().int().nonnegative().max(7),
    authorityReference: z.string().trim().min(1).max(1024).refine(
      (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
      "Scene authority references must fit the exact database identity index.",
    ),
  }).strict()).min(1).max(8),
}).strict().superRefine((input, context) => {
  const references = new Set(input.memberAuthorityReferences.map((member) => member.authorityReference));
  if (
    !input.memberAuthorityReferences.every((member, index) => member.memberIndex === index) ||
    references.size !== input.memberAuthorityReferences.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["memberAuthorityReferences"],
      message: "Scene authority member references must be unique, contiguous, and ordered.",
    });
  }
});

export const FinalizeHistoricalRuntimeSceneValidationSchema = z.object({
  sceneValidationSubjectDigest: SHA256,
  reviewerAttestationId: z.string().uuid(),
}).strict();

export const HistoricalRuntimeRoomScopeBasisSchema = z.object({
  schemaVersion: z.literal("historical-runtime-room-scope-basis.v1"),
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  runtimePackageId: z.string().uuid(),
  runtimePackageContentDigest: SHA256,
  runtimeManifestDigest: SHA256,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  derivationId: z.string().uuid(),
  derivationEvidenceDigest: SHA256,
  transformReviewId: z.string().uuid(),
  transformReviewDigest: SHA256,
  twinReleaseId: z.string().uuid(),
  twinReleaseManifestDigest: SHA256,
  sceneArtifactRowId: z.string().uuid(),
  sceneArtifactDigest: SHA256,
}).strict();

export function historicalRuntimeRoomScopeBasisDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-room-scope-basis.v1\n",
    HistoricalRuntimeRoomScopeBasisSchema,
    value,
  );
}

export const HistoricalRuntimeSceneAuthorityCoverageSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  runtimePackageId: z.string().uuid(),
  runtimePackageContentDigest: SHA256,
  runtimeManifestDigest: SHA256,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  derivationId: z.string().uuid(),
  derivationEvidenceDigest: SHA256,
  transformReviewId: z.string().uuid(),
  transformReviewDigest: SHA256,
  twinReleaseId: z.string().uuid(),
  twinReleaseManifestDigest: SHA256,
  roomScopeBasis: HistoricalRuntimeRoomScopeBasisSchema,
  roomScopeBasisDigest: SHA256,
  coverageDecision: z.literal("whole_room_and_all_runtime_members_covered"),
  wholeVenueRegionIds: z.array(RuntimeManifestKeySchema).min(1).max(2_000),
  orderedMembers: z.array(z.object({
    memberIndex: z.number().int().nonnegative().max(7),
    assetVersionId: z.string().uuid(),
    derivationOutputReceiptId: z.string().uuid(),
    derivationMemberReceiptDigest: SHA256,
    authorityReference: z.string().trim().min(1).max(1024).refine(
      (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
      "Scene authority references must fit the exact database identity index.",
    ),
    coveredRegionIds: z.array(RuntimeManifestKeySchema).min(1).max(2_000),
  }).strict()).min(1).max(8),
}).strict().superRefine((coverage, context) => {
  const assetIds = new Set(coverage.orderedMembers.map((member) => member.assetVersionId));
  const receiptDigests = new Set(
    coverage.orderedMembers.map((member) => member.derivationMemberReceiptDigest),
  );
  const receiptIds = new Set(
    coverage.orderedMembers.map((member) => member.derivationOutputReceiptId),
  );
  const references = new Set(
    coverage.orderedMembers.map((member) => member.authorityReference),
  );
  const wholeRegionSet = new Set(coverage.wholeVenueRegionIds);
  const coveredRegionSet = new Set(
    coverage.orderedMembers.flatMap((member) => member.coveredRegionIds),
  );
  const exactRegionCoverage =
    wholeRegionSet.size === coveredRegionSet.size &&
    [...wholeRegionSet].every((regionId) => coveredRegionSet.has(regionId));
  if (
    coverage.roomScopeBasis.venueId !== coverage.venueId ||
    coverage.roomScopeBasis.spaceId !== coverage.spaceId ||
    coverage.roomScopeBasis.runtimePackageId !== coverage.runtimePackageId ||
    coverage.roomScopeBasis.runtimePackageContentDigest !==
      coverage.runtimePackageContentDigest ||
    coverage.roomScopeBasis.runtimeManifestDigest !== coverage.runtimeManifestDigest ||
    coverage.roomScopeBasis.presentationAdmissionId !== coverage.presentationAdmissionId ||
    coverage.roomScopeBasis.presentationAdmissionDigest !==
      coverage.presentationAdmissionDigest ||
    coverage.roomScopeBasis.derivationId !== coverage.derivationId ||
    coverage.roomScopeBasis.derivationEvidenceDigest !==
      coverage.derivationEvidenceDigest ||
    coverage.roomScopeBasis.transformReviewId !== coverage.transformReviewId ||
    coverage.roomScopeBasis.transformReviewDigest !== coverage.transformReviewDigest ||
    coverage.roomScopeBasis.twinReleaseId !== coverage.twinReleaseId ||
    coverage.roomScopeBasis.twinReleaseManifestDigest !==
      coverage.twinReleaseManifestDigest ||
    coverage.roomScopeBasisDigest !== canonicalDigest(
      "venviewer.historical-runtime-room-scope-basis.v1\n",
      coverage.roomScopeBasis,
    ) ||
    !coverage.orderedMembers.every((member, index) => member.memberIndex === index) ||
    assetIds.size !== coverage.orderedMembers.length ||
    receiptIds.size !== coverage.orderedMembers.length ||
    receiptDigests.size !== coverage.orderedMembers.length ||
    references.size !== coverage.orderedMembers.length ||
    !exactRegionCoverage ||
    new Set(coverage.wholeVenueRegionIds).size !== coverage.wholeVenueRegionIds.length ||
    coverage.orderedMembers.some((member) =>
      new Set(member.coveredRegionIds).size !== member.coveredRegionIds.length)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orderedMembers"],
      message: "Scene coverage must uniquely bind every ordered runtime member and covered authority region.",
    });
  }
});

export function historicalRuntimeSceneAuthorityCoverageDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-scene-authority-coverage.v1\n",
    HistoricalRuntimeSceneAuthorityCoverageSchema,
    value,
  );
}

const HistoricalRuntimeSceneAuthoritySubjectMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-scene-authority-subject.v1"),
  sceneValidationId: z.string().uuid(),
  sceneArtifactRowId: z.string().uuid(),
  sceneArtifactId: RuntimeManifestKeySchema,
  sceneArtifactDigest: SHA256,
  sceneRegistryObjectSha256: SHA256,
  sceneRegistryObjectSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sceneObjectReceipt: HistoricalRuntimeExactObjectReceiptSchema,
  parsedMapDigest: SHA256,
  coverage: HistoricalRuntimeSceneAuthorityCoverageSchema,
  coverageDigest: SHA256,
  validatedAt: z.string().datetime({ offset: true }),
  presentationAdmissionReviewerAttestationId: z.string().uuid(),
  presentationAdmissionReviewerAttestationDigest: SHA256,
  presentationAdmissionReviewerActorId: UserIdSchema,
  presentationAdmissionReviewerAttestationExpiresAt: z.string().datetime({ offset: true }),
  transformReviewExpiresAt: z.string().datetime({ offset: true }),
  derivationExpiresAt: z.string().datetime({ offset: true }),
  twinReleaseAuthorityReceiptId: z.string().uuid(),
  twinReleaseAuthorityDigest: SHA256,
  twinReleaseDigest: SHA256,
  twinReleaseAuthorityExpiresAt: z.string().datetime({ offset: true }),
  providerCapabilityReceiptId: z.string().uuid(),
  providerCapabilityDigest: SHA256,
  providerCapabilityExpiresAt: z.string().datetime({ offset: true }),
  authorityExpiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeSceneAuthoritySubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-scene-authority-subject.v1\n",
    HistoricalRuntimeSceneAuthoritySubjectMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeSceneAuthoritySubjectSchema =
  HistoricalRuntimeSceneAuthoritySubjectMaterialSchema.extend({
    sceneValidationSubjectDigest: SHA256,
  }).strict().superRefine((subject, context) => {
    const { sceneValidationSubjectDigest, ...material } = subject;
    const validatedAt = new Date(subject.validatedAt).getTime();
    const constituentExpiryTimes = [
      subject.presentationAdmissionReviewerAttestationExpiresAt,
      subject.transformReviewExpiresAt,
      subject.derivationExpiresAt,
      subject.twinReleaseAuthorityExpiresAt,
      subject.providerCapabilityExpiresAt,
      subject.sceneObjectReceipt.anonymousAccessDenial.expiresAt,
    ].map((value) => new Date(value).getTime());
    const minimumConstituentExpiry = Math.min(...constituentExpiryTimes);
    if (
      subject.sceneRegistryObjectSha256 !== subject.sceneObjectReceipt.object.sha256 ||
      subject.sceneRegistryObjectSizeBytes !== subject.sceneObjectReceipt.object.sizeBytes ||
      subject.sceneArtifactDigest !== subject.parsedMapDigest ||
      subject.providerCapabilityReceiptId !==
        subject.sceneObjectReceipt.object.immutabilityCapabilityReceiptId ||
      subject.providerCapabilityDigest !==
        subject.sceneObjectReceipt.object.immutabilityCapabilityDigest ||
      validatedAt <
        new Date(subject.sceneObjectReceipt.anonymousAccessDenial.probedAt).getTime() ||
      constituentExpiryTimes.some((expiresAt) => expiresAt <= validatedAt) ||
      new Date(subject.authorityExpiresAt).getTime() !== minimumConstituentExpiry ||
      subject.coverageDigest !== canonicalDigest(
        "venviewer.historical-runtime-scene-authority-coverage.v1\n",
        subject.coverage,
      ) ||
      sceneValidationSubjectDigest !== canonicalDigest(
        "venviewer.historical-runtime-scene-authority-subject.v1\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sceneValidationSubjectDigest"],
        message: "Scene subject must bind registry bytes, strict parsed semantics, room/package scope, transform, and every member.",
      });
    }
  });

const HistoricalRuntimeSceneAuthorityReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_SCENE_AUTHORITY_RECEIPT_SCHEMA_VERSION),
  subject: HistoricalRuntimeSceneAuthoritySubjectSchema,
  sceneValidationSubjectDigest: SHA256,
  reviewerAttestationId: z.string().uuid(),
  reviewerAttestationDigest: SHA256,
  reviewerActorId: UserIdSchema,
  reviewerAttestationExpiresAt: z.string().datetime({ offset: true }),
  reviewedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeSceneAuthorityReceiptDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-scene-authority-receipt.v1\n",
    HistoricalRuntimeSceneAuthorityReceiptMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeSceneAuthorityReceiptSchema =
  HistoricalRuntimeSceneAuthorityReceiptMaterialSchema.extend({
    sceneValidationDigest: SHA256,
  }).strict().superRefine((receipt, context) => {
    const { sceneValidationDigest, ...material } = receipt;
    const reviewedAt = new Date(receipt.reviewedAt).getTime();
    const expiresAt = new Date(receipt.expiresAt).getTime();
    const minimumAuthorityExpiry = Math.min(
      new Date(receipt.subject.authorityExpiresAt).getTime(),
      new Date(receipt.reviewerAttestationExpiresAt).getTime(),
    );
    if (
      receipt.sceneValidationSubjectDigest !== receipt.subject.sceneValidationSubjectDigest ||
      reviewedAt < new Date(receipt.subject.validatedAt).getTime() ||
      reviewedAt >= new Date(receipt.subject.authorityExpiresAt).getTime() ||
      expiresAt !== minimumAuthorityExpiry ||
      expiresAt <= reviewedAt ||
      expiresAt - reviewedAt > HISTORICAL_RUNTIME_SCENE_AUTHORITY_MAX_TTL_MS ||
      sceneValidationDigest !== canonicalDigest(
        "venviewer.historical-runtime-scene-authority-receipt.v1\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sceneValidationDigest"],
        message: "Scene receipt must bind a pre-review subject and a later independent review attestation without a digest cycle.",
      });
    }
  });
export type HistoricalRuntimeSceneAuthorityReceipt = z.infer<
  typeof HistoricalRuntimeSceneAuthorityReceiptSchema
>;

export const RegisterHistoricalRuntimeReviewedProfileSchema = z.object({
  reviewedProfileEvidenceId: z.string().uuid(),
  reviewedProfileId: RuntimeManifestKeySchema,
  presentationAdmissionId: z.string().uuid(),
  captureClearanceId: z.string().uuid(),
  derivationId: z.string().uuid(),
  transformReviewId: z.string().uuid(),
  sceneValidationId: z.string().uuid(),
  rightsClearanceIds: z.array(z.string().uuid()).min(1).max(8),
  packageCustodianAttestationId: z.string().uuid(),
  qaReviewerAttestationId: z.string().uuid(),
  admissionReviewerAttestationId: z.string().uuid(),
  designatedFinalReviewerActorId: UserIdSchema,
}).strict().superRefine((input, context) => {
  if (new Set(input.rightsClearanceIds).size !== input.rightsClearanceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rightsClearanceIds"],
      message: "Reviewed-profile rights clearances must be unique and ordered.",
    });
  }
});

export const FinalizeHistoricalRuntimeReviewedProfileSchema = z.object({
  reviewedProfileSubjectDigest: SHA256,
  finalReviewerAttestationId: z.string().uuid(),
}).strict();

const HistoricalRuntimeReviewedProfileMemberSchema = z.object({
  memberIndex: z.number().int().nonnegative().max(7),
  assetVersionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  fileExt: z.enum([".sog", ".spz"]),
  mimeType: z.string().trim().min(1).max(160),
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(16 * 1024 * 1024),
  derivationOutputReceiptId: z.string().uuid(),
  derivationMemberReceiptDigest: SHA256,
  rightsClearanceId: z.string().uuid(),
  rightsClearanceDigest: SHA256,
  rightsReviewerActorId: UserIdSchema,
  sceneCoverageDigest: SHA256,
  sceneAuthorityReference: z.string().trim().min(1).max(1024).refine(
    (value) => utf8ByteLength(value) <= MAX_INDEXED_IDENTITY_TEXT_BYTES,
    "Scene authority references must fit the exact database identity index.",
  ),
}).strict();

const HistoricalRuntimeReviewedProfileActorMapSchema = z.object({
  captureCreatorActorId: UserIdSchema,
  sourceCustodianActorId: UserIdSchema,
  ownerAuthorizerActorId: UserIdSchema,
  privacyReviewerActorId: UserIdSchema,
  movableContentReviewerActorId: UserIdSchema,
  normalizerActorId: UserIdSchema,
  captureFinalReviewerActorId: UserIdSchema,
  derivativeProducerActorId: UserIdSchema,
  derivativeCustodianActorId: UserIdSchema,
  derivativeReviewerActorId: UserIdSchema,
  packageCustodianActorId: UserIdSchema,
  qaReviewerActorId: UserIdSchema,
  transformReviewerActorId: UserIdSchema,
  sceneReviewerActorId: UserIdSchema,
  admissionReviewerActorId: UserIdSchema,
  rightsReviewerActorIds: z.array(UserIdSchema).min(1).max(8),
  designatedFinalReviewerActorId: UserIdSchema,
}).strict();

export function historicalRuntimeReviewedProfileActorMapDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-reviewed-profile-actor-map.v1\n",
    HistoricalRuntimeReviewedProfileActorMapSchema,
    value,
  );
}

const HistoricalRuntimeReviewedProfileConstituentExpiriesSchema = z.object({
  captureClearanceExpiresAt: z.string().datetime({ offset: true }),
  derivationReviewExpiresAt: z.string().datetime({ offset: true }),
  runtimeQaAuthorityExpiresAt: z.string().datetime({ offset: true }),
  transformReviewExpiresAt: z.string().datetime({ offset: true }),
  sceneValidationExpiresAt: z.string().datetime({ offset: true }),
  packageCustodianAttestationExpiresAt: z.string().datetime({ offset: true }),
  admissionReviewerAttestationExpiresAt: z.string().datetime({ offset: true }),
  rightsClearanceExpiresAt: z.array(
    z.string().datetime({ offset: true }),
  ).min(1).max(8),
}).strict();

const HistoricalRuntimeReviewedProfileSubjectMaterialSchema = z.object({
  schemaVersion: z.literal("historical-runtime-reviewed-profile-subject.v1"),
  reviewedProfileEvidenceId: z.string().uuid(),
  reviewedProfileId: RuntimeManifestKeySchema,
  reviewedProfileManifestFingerprint: SHA256,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  presentationAdmissionId: z.string().uuid(),
  presentationAdmissionDigest: SHA256,
  presentationAdmissionReviewedBy: UserIdSchema,
  presentationAdmissionReviewedAt: z.string().datetime({ offset: true }),
  admissionReviewerAttestationId: z.string().uuid(),
  admissionReviewerAttestationDigest: SHA256,
  runtimePackageId: z.string().uuid(),
  runtimePackageRevision: z.number().int().positive(),
  runtimePackageContentDigest: SHA256,
  runtimeManifestDigest: SHA256,
  captureRootId: z.string().uuid(),
  captureContentSubjectDigest: SHA256,
  captureRootEvidenceDigest: SHA256,
  captureClearanceId: z.string().uuid(),
  captureClearanceDigest: SHA256,
  derivationId: z.string().uuid(),
  derivationEvidenceDigest: SHA256,
  runtimeQaRecordId: z.string().uuid(),
  runtimeQaRecordKey: RuntimeManifestKeySchema,
  runtimeQaRecordDigest: SHA256,
  runtimeQaDecision: z.enum(["approved_internal_preview", "approved_public"]),
  runtimeQaReviewedBy: UserIdSchema,
  runtimeQaReviewedAt: z.string().datetime({ offset: true }),
  qaReviewerAttestationId: z.string().uuid(),
  qaReviewerAttestationDigest: SHA256,
  transformReviewId: z.string().uuid(),
  transformReviewDigest: SHA256,
  sceneValidationId: z.string().uuid(),
  sceneValidationDigest: SHA256,
  packageCustodianAttestationId: z.string().uuid(),
  packageCustodianAttestationDigest: SHA256,
  memberCount: z.number().int().positive().max(8),
  totalBytes: z.number().int().positive().max(96 * 1024 * 1024),
  members: z.array(HistoricalRuntimeReviewedProfileMemberSchema).min(1).max(8),
  membersDigest: SHA256,
  actorMap: HistoricalRuntimeReviewedProfileActorMapSchema,
  actorMapDigest: SHA256,
  constituentExpiries: HistoricalRuntimeReviewedProfileConstituentExpiriesSchema,
  preparedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeReviewedProfileMembersDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-reviewed-profile-members.v1\n",
    z.array(HistoricalRuntimeReviewedProfileMemberSchema).min(1).max(8),
    value,
  );
}

export function historicalRuntimeReviewedProfileSubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-reviewed-profile-subject.v1\n",
    HistoricalRuntimeReviewedProfileSubjectMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeReviewedProfileSubjectSchema =
  HistoricalRuntimeReviewedProfileSubjectMaterialSchema.extend({
    reviewedProfileSubjectDigest: SHA256,
  }).strict().superRefine((profile, context) => {
    const { reviewedProfileSubjectDigest, ...material } = profile;
    const totalBytes = profile.members.reduce((sum, member) => sum + member.sizeBytes, 0);
    const assetIds = new Set(profile.members.map((member) => member.assetVersionId));
    const receiptIds = new Set(profile.members.map((member) => member.derivationOutputReceiptId));
    const receiptDigests = new Set(profile.members.map((member) => member.derivationMemberReceiptDigest));
    const rightsIds = new Set(profile.members.map((member) => member.rightsClearanceId));
    const rightsDigests = new Set(profile.members.map((member) => member.rightsClearanceDigest));
    const actorIds = [
      profile.actorMap.captureCreatorActorId,
      profile.actorMap.sourceCustodianActorId,
      profile.actorMap.ownerAuthorizerActorId,
      profile.actorMap.privacyReviewerActorId,
      profile.actorMap.movableContentReviewerActorId,
      profile.actorMap.normalizerActorId,
      profile.actorMap.captureFinalReviewerActorId,
      profile.actorMap.derivativeProducerActorId,
      profile.actorMap.derivativeCustodianActorId,
      profile.actorMap.derivativeReviewerActorId,
      profile.actorMap.packageCustodianActorId,
      profile.actorMap.qaReviewerActorId,
      profile.actorMap.transformReviewerActorId,
      profile.actorMap.sceneReviewerActorId,
      profile.actorMap.admissionReviewerActorId,
      ...profile.actorMap.rightsReviewerActorIds,
      profile.actorMap.designatedFinalReviewerActorId,
    ];
    const memberRightsActors = [...new Set(
      profile.members.map((member) => member.rightsReviewerActorId),
    )].sort();
    const mappedRightsActors = [...profile.actorMap.rightsReviewerActorIds].sort();
    const preparedAt = new Date(profile.preparedAt).getTime();
    const constituentExpiryTimes = [
      profile.constituentExpiries.captureClearanceExpiresAt,
      profile.constituentExpiries.derivationReviewExpiresAt,
      profile.constituentExpiries.runtimeQaAuthorityExpiresAt,
      profile.constituentExpiries.transformReviewExpiresAt,
      profile.constituentExpiries.sceneValidationExpiresAt,
      profile.constituentExpiries.packageCustodianAttestationExpiresAt,
      profile.constituentExpiries.admissionReviewerAttestationExpiresAt,
      ...profile.constituentExpiries.rightsClearanceExpiresAt,
    ].map((value) => new Date(value).getTime());
    const minimumConstituentExpiry = Math.min(...constituentExpiryTimes);
    if (
      !profile.members.every((member, index) => member.memberIndex === index) ||
      profile.members.some((member) => !member.fileName.endsWith(member.fileExt)) ||
      profile.memberCount !== profile.members.length ||
      profile.totalBytes !== totalBytes ||
      assetIds.size !== profile.members.length ||
      receiptIds.size !== profile.members.length ||
      receiptDigests.size !== profile.members.length ||
      rightsIds.size !== profile.members.length ||
      rightsDigests.size !== profile.members.length ||
      new Set(profile.actorMap.rightsReviewerActorIds).size !==
        profile.actorMap.rightsReviewerActorIds.length ||
      new Set(actorIds).size !== actorIds.length ||
      memberRightsActors.join("|") !== mappedRightsActors.join("|") ||
      profile.presentationAdmissionReviewedBy !== profile.actorMap.admissionReviewerActorId ||
      profile.runtimeQaReviewedBy !== profile.actorMap.qaReviewerActorId ||
      profile.constituentExpiries.rightsClearanceExpiresAt.length !== profile.memberCount ||
      constituentExpiryTimes.some((expiresAt) => expiresAt <= preparedAt) ||
      new Date(profile.expiresAt).getTime() !== minimumConstituentExpiry ||
      profile.membersDigest !== canonicalDigest(
        "venviewer.historical-runtime-reviewed-profile-members.v1\n",
        profile.members,
      ) ||
      profile.actorMapDigest !== canonicalDigest(
        "venviewer.historical-runtime-reviewed-profile-actor-map.v1\n",
        profile.actorMap,
      ) ||
      new Date(profile.presentationAdmissionReviewedAt).getTime() >
        new Date(profile.preparedAt).getTime() ||
      new Date(profile.runtimeQaReviewedAt).getTime() > new Date(profile.preparedAt).getTime() ||
      new Date(profile.expiresAt).getTime() <= new Date(profile.preparedAt).getTime() ||
      reviewedProfileSubjectDigest !== canonicalDigest(
        "venviewer.historical-runtime-reviewed-profile-subject.v1\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewedProfileSubjectDigest"],
        message: "Reviewed-profile subject must bind exact evidence leaves, sums, unique ordered members, and the mandated separated actor graph.",
      });
    }
  });

const HistoricalRuntimeReviewedProfileEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_REVIEWED_PROFILE_EVIDENCE_SCHEMA_VERSION),
  subject: HistoricalRuntimeReviewedProfileSubjectSchema,
  reviewedProfileSubjectDigest: SHA256,
  finalReviewerAttestationId: z.string().uuid(),
  finalReviewerAttestationDigest: SHA256,
  finalReviewerActorId: UserIdSchema,
  finalReviewerAttestationExpiresAt: z.string().datetime({ offset: true }),
  reviewedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeReviewedProfileEvidenceDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-reviewed-profile-evidence.v1\n",
    HistoricalRuntimeReviewedProfileEvidenceMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeReviewedProfileEvidenceSchema =
  HistoricalRuntimeReviewedProfileEvidenceMaterialSchema.extend({
    reviewedProfileEvidenceDigest: SHA256,
  }).strict().superRefine((profile, context) => {
    const { reviewedProfileEvidenceDigest, ...material } = profile;
    const reviewedAt = new Date(profile.reviewedAt).getTime();
    const expiresAt = new Date(profile.expiresAt).getTime();
    const minimumAuthorityExpiry = Math.min(
      new Date(profile.subject.expiresAt).getTime(),
      new Date(profile.finalReviewerAttestationExpiresAt).getTime(),
    );
    if (
      profile.reviewedProfileSubjectDigest !== profile.subject.reviewedProfileSubjectDigest ||
      profile.finalReviewerActorId !== profile.subject.actorMap.designatedFinalReviewerActorId ||
      reviewedAt < new Date(profile.subject.preparedAt).getTime() ||
      reviewedAt >= new Date(profile.subject.expiresAt).getTime() ||
      expiresAt !== minimumAuthorityExpiry ||
      expiresAt <= reviewedAt ||
      expiresAt - reviewedAt > HISTORICAL_RUNTIME_REVIEWED_PROFILE_MAX_TTL_MS ||
      reviewedProfileEvidenceDigest !== canonicalDigest(
        "venviewer.historical-runtime-reviewed-profile-evidence.v1\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewedProfileEvidenceDigest"],
        message: "Reviewed-profile receipt must bind the pre-review subject and later designated independent final-review attestation.",
      });
    }
  });
export type HistoricalRuntimeReviewedProfileEvidence = z.infer<
  typeof HistoricalRuntimeReviewedProfileEvidenceSchema
>;

export const HistoricalRuntimeRawDsseSubmissionSchema = z.object({
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
}).strict();

export const HistoricalRuntimeUnsignedDecimalSchema = z.string().regex(DECIMAL_UINT);

const HistoricalRuntimeExecutionV2RequesterAuthoritySchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("platform_authority"),
    platformRole: z.enum(["operator", "admin"]),
    userRole: UserRoleSchema,
    userVenueId: VenueIdSchema.nullable(),
  }).strict(),
  z.object({
    state: z.literal("active_workspace_membership"),
    platformRole: PlatformRoleSchema,
    userRole: UserRoleSchema,
    userVenueId: VenueIdSchema,
    membershipId: WorkspaceMembershipIdSchema,
    workspaceId: WorkspaceIdSchema,
    workspaceRole: WorkspaceMemberRoleSchema,
    venueRole: VenueInvitationRoleSchema,
    membershipUpdatedAt: z.string().datetime({ offset: true }),
  }).strict(),
]);

const HistoricalRuntimeExecutionV2SubjectMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_V2_SUBJECT_SCHEMA_VERSION),
  activationId: z.string().uuid(),
  environmentId: z.string().uuid(),
  environmentMode: z.enum(["production", "test"]),
  environmentDigest: SHA256,
  scopeEpochId: z.string().uuid(),
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
  reviewedProfileEvidenceId: z.string().uuid(),
  reviewedProfileSubjectDigest: SHA256,
  reviewedProfileEvidenceDigest: SHA256,
  reviewedProfileFinalReviewerActorId: UserIdSchema,
  reviewedProfileExpiresAt: z.string().datetime({ offset: true }),
  requestedBy: UserIdSchema,
  requesterAuthority: HistoricalRuntimeExecutionV2RequesterAuthoritySchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeExecutionV2SubjectDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-execution-activation-subject.v2\n",
    HistoricalRuntimeExecutionV2SubjectMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeExecutionV2SubjectSchema =
  HistoricalRuntimeExecutionV2SubjectMaterialSchema.extend({
    executionActivationSubjectDigest: SHA256,
  }).strict().superRefine((subject, context) => {
    const { executionActivationSubjectDigest, ...material } = subject;
    const requestedAt = new Date(subject.requestedAt).getTime();
    const expiresAt = new Date(subject.expiresAt).getTime();
    if (
      subject.tenantId !== subject.venueId ||
      subject.requestedBy === subject.reviewedProfileFinalReviewerActorId ||
      (subject.requesterAuthority.state === "active_workspace_membership" &&
        (subject.requesterAuthority.userVenueId !== subject.venueId ||
          !(
            ["owner", "admin", "staff", "hallkeeper"].includes(
              subject.requesterAuthority.workspaceRole,
            ) || subject.requesterAuthority.venueRole === "hallkeeper"
          ))) ||
      expiresAt <= requestedAt ||
      expiresAt - requestedAt > HISTORICAL_RUNTIME_EXECUTION_V2_MAX_TTL_MS ||
      expiresAt > new Date(subject.reviewedProfileExpiresAt).getTime() ||
      executionActivationSubjectDigest !== canonicalDigest(
        "venviewer.historical-runtime-execution-activation-subject.v2\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionActivationSubjectDigest"],
        message: "Execution V2 subject must bind one exact scope, snapshot, current reviewed profile, independent requester, and finite authority window.",
      });
    }
  });
export type HistoricalRuntimeExecutionV2Subject = z.infer<
  typeof HistoricalRuntimeExecutionV2SubjectSchema
>;

const HistoricalRuntimeExecutionV2PredicateMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_V2_PREDICATE_SCHEMA_VERSION),
  activationId: z.string().uuid(),
  executionActivationSubject: HistoricalRuntimeExecutionV2SubjectSchema,
  executionActivationSubjectDigest: SHA256,
  reviewedProfileEvidenceId: z.string().uuid(),
  reviewedProfileEvidenceDigest: SHA256,
  executionReviewerAttestationId: z.string().uuid(),
  executionReviewerAttestationDigest: SHA256,
  executionReviewerActorId: UserIdSchema,
  keyPolicyId: z.string().uuid(),
  keyPolicyDigest: SHA256,
  keyId: z.string().regex(PRINTABLE_DSSE_KEY_ID),
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
}).strict().superRefine((predicate, context) => {
  const subject = predicate.executionActivationSubject;
  const issuedAt = new Date(predicate.issuedAt).getTime();
  const expiresAt = new Date(predicate.expiresAt).getTime();
  if (
    predicate.activationId !== subject.activationId ||
    predicate.executionActivationSubjectDigest !==
      subject.executionActivationSubjectDigest ||
    predicate.reviewedProfileEvidenceId !== subject.reviewedProfileEvidenceId ||
    predicate.reviewedProfileEvidenceDigest !==
      subject.reviewedProfileEvidenceDigest ||
    predicate.executionReviewerActorId === subject.requestedBy ||
    predicate.executionReviewerActorId ===
      subject.reviewedProfileFinalReviewerActorId ||
    issuedAt < new Date(subject.requestedAt).getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > HISTORICAL_RUNTIME_EXECUTION_V2_MAX_TTL_MS ||
    expiresAt > new Date(subject.expiresAt).getTime()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executionActivationSubjectDigest"],
      message: "Execution V2 predicate must bind the exact server-issued subject, independent reviewer, key policy, and bounded signing window.",
    });
  }
});

export function historicalRuntimeExecutionV2PredicateDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-execution-activation-predicate.v2\n",
    HistoricalRuntimeExecutionV2PredicateMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeExecutionV2StatementSchema = z.object({
  authority: z.literal("execution_authority"),
  evidenceKind: z.literal("historical_runtime_execution_activation_v2"),
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_V2_STATEMENT_SCHEMA_VERSION),
  subjectName: z.string().trim().min(1).max(320),
  subjectDigest: SHA256,
  predicate: HistoricalRuntimeExecutionV2PredicateMaterialSchema,
}).strict().superRefine((statement, context) => {
  const expectedDigest = historicalRuntimeExecutionV2PredicateDigest(statement.predicate);
  if (
    statement.subjectName !==
      `historical-runtime-execution-activation/${statement.predicate.activationId}` ||
    statement.subjectDigest !== expectedDigest
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectDigest"],
      message: "Execution V2 statement must bind the exact canonical predicate.",
    });
  }
});
export type HistoricalRuntimeExecutionV2Statement = z.infer<
  typeof HistoricalRuntimeExecutionV2StatementSchema
>;

export function createHistoricalRuntimeExecutionV2SigningPayload(
  statementInput: unknown,
): { readonly payloadUtf8: string; readonly payloadSha256: string } {
  const statement = HistoricalRuntimeExecutionV2StatementSchema.parse(statementInput);
  const payloadUtf8 = stableCanonicalJson(CanonicalJsonValueSchema.parse(statement));
  return { payloadUtf8, payloadSha256: sha256Hex(payloadUtf8) };
}

const HistoricalRuntimeExecutionV2RawDsseEvidenceSchema = z.object({
  payloadType: z.literal(HISTORICAL_RUNTIME_EXECUTION_V2_PAYLOAD_TYPE),
  payloadUtf8: z.string().min(1).max(512 * 1024),
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
  payloadSha256: SHA256,
  receiptSha256: HistoricalRuntimeDomainSha256Schema,
  envelopeSha256: HistoricalRuntimeDomainSha256Schema,
  signerPublicKeySha256: HistoricalRuntimeDomainSha256Schema,
  payloadByteLength: z.string().regex(DECIMAL_UINT),
  envelopeByteLength: z.string().regex(DECIMAL_UINT),
  verifiedAt: z.string().datetime({ offset: true }),
}).strict();

const HistoricalRuntimeExecutionV2ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_RUNTIME_EXECUTION_V2_RECEIPT_SCHEMA_VERSION),
  activationId: z.string().uuid(),
  subject: HistoricalRuntimeExecutionV2SubjectSchema,
  executionActivationSubjectDigest: SHA256,
  statement: HistoricalRuntimeExecutionV2StatementSchema,
  predicateDigest: SHA256,
  reviewedProfileEvidenceId: z.string().uuid(),
  reviewedProfileEvidenceDigest: SHA256,
  executionReviewerAttestationId: z.string().uuid(),
  executionReviewerAttestationDigest: SHA256,
  executionReviewerActorId: UserIdSchema,
  rawEvidence: HistoricalRuntimeExecutionV2RawDsseEvidenceSchema,
  issuedAt: z.string().datetime({ offset: true }),
  verifiedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export function historicalRuntimeExecutionV2ReceiptDigest(value: unknown): string {
  return digest(
    "venviewer.historical-runtime-execution-activation-receipt.v2\n",
    HistoricalRuntimeExecutionV2ReceiptMaterialSchema,
    value,
  );
}

export const HistoricalRuntimeExecutionV2ReceiptSchema =
  HistoricalRuntimeExecutionV2ReceiptMaterialSchema.extend({
    activationDigest: SHA256,
  }).strict().superRefine((receipt, context) => {
    const { activationDigest, ...material } = receipt;
    const subject = receipt.subject;
    const predicate = receipt.statement.predicate;
    const expectedPayloadUtf8 = stableCanonicalJson(
      CanonicalJsonValueSchema.parse(receipt.statement),
    );
    const expectedReceiptSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-execution-activation.v2\n${expectedPayloadUtf8}`,
    )}`;
    const expectedEnvelopeSha256 = `sha256:${sha256Hex(
      `venviewer.historical-runtime-execution-activation.v2.dsse-envelope\n${receipt.rawEvidence.envelopeUtf8}`,
    )}`;
    const issuedAt = new Date(receipt.issuedAt).getTime();
    const verifiedAt = new Date(receipt.verifiedAt).getTime();
    const expiresAt = new Date(receipt.expiresAt).getTime();
    if (
      receipt.activationId !== subject.activationId ||
      receipt.executionActivationSubjectDigest !==
        subject.executionActivationSubjectDigest ||
      receipt.reviewedProfileEvidenceId !== subject.reviewedProfileEvidenceId ||
      receipt.reviewedProfileEvidenceDigest !==
        subject.reviewedProfileEvidenceDigest ||
      receipt.predicateDigest !== receipt.statement.subjectDigest ||
      predicate.executionActivationSubjectDigest !==
        receipt.executionActivationSubjectDigest ||
      receipt.executionReviewerAttestationId !==
        predicate.executionReviewerAttestationId ||
      receipt.executionReviewerAttestationDigest !==
        predicate.executionReviewerAttestationDigest ||
      receipt.executionReviewerActorId !== predicate.executionReviewerActorId ||
      receipt.issuedAt !== predicate.issuedAt ||
      receipt.expiresAt !== predicate.expiresAt ||
      receipt.rawEvidence.payloadUtf8 !== expectedPayloadUtf8 ||
      receipt.rawEvidence.payloadSha256 !== sha256Hex(expectedPayloadUtf8) ||
      receipt.rawEvidence.payloadByteLength !==
        String(utf8ByteLength(expectedPayloadUtf8)) ||
      receipt.rawEvidence.envelopeByteLength !==
        String(utf8ByteLength(receipt.rawEvidence.envelopeUtf8)) ||
      receipt.rawEvidence.receiptSha256 !== expectedReceiptSha256 ||
      receipt.rawEvidence.envelopeSha256 !== expectedEnvelopeSha256 ||
      receipt.rawEvidence.signerPublicKeySha256 !==
        predicate.signerPublicKeySha256 ||
      issuedAt < new Date(subject.requestedAt).getTime() ||
      verifiedAt < issuedAt ||
      verifiedAt >= expiresAt ||
      receipt.rawEvidence.verifiedAt !== receipt.verifiedAt ||
      activationDigest !== canonicalDigest(
        "venviewer.historical-runtime-execution-activation-receipt.v2\n",
        material,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activationDigest"],
        message: "Execution V2 receipt must retain the exact subject, canonical statement bytes, verified DSSE envelope identity, signer, reviewer, and current authority window.",
      });
    }
  });
export type HistoricalRuntimeExecutionV2Receipt = z.infer<
  typeof HistoricalRuntimeExecutionV2ReceiptSchema
>;

export const HistoricalRuntimeExecutionV2RawSubmissionSchema = z.object({
  activationId: z.string().uuid(),
  envelopeUtf8: z.string().min(1).max(1024 * 1024),
}).strict();
