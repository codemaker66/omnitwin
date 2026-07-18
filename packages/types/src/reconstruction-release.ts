import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimeSlugSchema } from "./asset-version.js";

// ---------------------------------------------------------------------------
// Evidence-to-Runtime Reconstruction Foundry
//
// A candidate remains private until deterministic QA, human review, detached
// attestation verification, immutable public-bucket publication, and a final
// compare-and-swap production-channel promotion have all happened. These
// contracts bind every later decision to the exact release and QA digests.
// ---------------------------------------------------------------------------

export const RECONSTRUCTION_RELEASE_SCHEMA_VERSION =
  "venviewer.reconstruction-release.v1";
export const RECONSTRUCTION_QA_SCHEMA_VERSION =
  "venviewer.reconstruction-qa.v1";
export const RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION =
  "venviewer.reconstruction-active-release.v1";
export const RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION =
  "venviewer.reconstruction-signing-payload.v1";
export const RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION =
  "venviewer.reconstruction-attestation-predicate.v1";
export const RECONSTRUCTION_DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";
export const RECONSTRUCTION_DSSE_MAX_SIGNATURES = 16;
export const RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE =
  "https://venviewer.com/attestations/reconstruction-release/v1";

export const RECONSTRUCTION_RELEASE_KINDS = ["venue_twin_v1"] as const;
export const ReconstructionReleaseKindSchema = z.enum(RECONSTRUCTION_RELEASE_KINDS);
export type ReconstructionReleaseKind = z.infer<typeof ReconstructionReleaseKindSchema>;

export const RECONSTRUCTION_RELEASE_STATES = [
  "machine_qa_failed",
  "awaiting_review",
  "expert_reviewed",
  "rejected",
  "awaiting_attestation",
  "ready_to_publish",
  "published",
  "active",
] as const;
export const ReconstructionReleaseStateSchema = z.enum(RECONSTRUCTION_RELEASE_STATES);
export type ReconstructionReleaseState = z.infer<typeof ReconstructionReleaseStateSchema>;

export const ReconstructionReleaseSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "SHA-256 values must contain 64 lowercase hexadecimal characters.");
export type ReconstructionReleaseSha256 = z.infer<typeof ReconstructionReleaseSha256Schema>;

const SAFE_OBJECT_PATH = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/u;

export function isSafeReconstructionReleasePath(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.trim() !== value) return false;
  if (!SAFE_OBJECT_PATH.test(value) || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("\\") || value.includes("?") || value.includes("#") || value.includes("//")) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export const ReconstructionReleaseObjectPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeReconstructionReleasePath, "Object paths must be safe relative POSIX paths.");
export type ReconstructionReleaseObjectPath = z.infer<
  typeof ReconstructionReleaseObjectPathSchema
>;

export const RECONSTRUCTION_RELEASE_FILE_ROLES = [
  "manifest",
  "imagery",
  "geometry",
  "evidence",
  "other",
] as const;
export const ReconstructionReleaseFileRoleSchema = z.enum(
  RECONSTRUCTION_RELEASE_FILE_ROLES,
);
export type ReconstructionReleaseFileRole = z.infer<
  typeof ReconstructionReleaseFileRoleSchema
>;

export const ReconstructionReleaseFileSchema = z
  .object({
    path: ReconstructionReleaseObjectPathSchema,
    sha256: ReconstructionReleaseSha256Schema,
    sizeBytes: z.number().int().positive(),
    mimeType: z.string().trim().min(1).max(160),
    role: ReconstructionReleaseFileRoleSchema,
  })
  .strict();
export type ReconstructionReleaseFile = z.infer<typeof ReconstructionReleaseFileSchema>;

const RELEASE_DIGEST_DOMAIN = "venviewer.reconstruction-release.v1\n";
const QA_DIGEST_DOMAIN = "venviewer.reconstruction-qa.v1\n";
const REVIEW_DIGEST_DOMAIN = "venviewer.reconstruction-review.v1\n";

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function computeReconstructionReleaseDigest(
  files: readonly ReconstructionReleaseFile[],
): string {
  const inventory = [...files]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((file) => `${file.sha256}  ${String(file.sizeBytes)}  ${file.path}\n`)
    .join("");
  return sha256Hex(`${RELEASE_DIGEST_DOMAIN}${inventory}`);
}

export const ReconstructionReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(RECONSTRUCTION_RELEASE_SCHEMA_VERSION),
    releaseKind: ReconstructionReleaseKindSchema,
    venueSlug: RuntimeSlugSchema,
    releaseDigest: ReconstructionReleaseSha256Schema,
    sourceManifestSha256: ReconstructionReleaseSha256Schema,
    files: z.array(ReconstructionReleaseFileSchema).min(1),
    fileCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const paths = manifest.files.map((file) => file.path);
    const uniquePaths = new Set(paths);
    if (uniquePaths.size !== paths.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Release file paths must be unique.",
      });
    }

    const caseFoldedPaths = paths.map((path) => path.toLowerCase());
    if (new Set(caseFoldedPaths).size !== caseFoldedPaths.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Release file paths must remain unique on case-insensitive filesystems.",
      });
    }

    const sortedPaths = [...paths].sort(comparePaths);
    if (paths.some((path, index) => path !== sortedPaths[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Release files must be sorted by path.",
      });
    }

    const sourceManifest = manifest.files.filter((file) => file.path === "manifest.json");
    if (
      sourceManifest.length !== 1 ||
      sourceManifest[0]?.role !== "manifest" ||
      sourceManifest[0]?.sha256 !== manifest.sourceManifestSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceManifestSha256"],
        message: "sourceManifestSha256 must identify the sole manifest.json inventory entry.",
      });
    }

    if (manifest.fileCount !== manifest.files.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fileCount"],
        message: "fileCount must equal the inventory length.",
      });
    }

    const totalBytes = manifest.files.reduce((total, file) => total + file.sizeBytes, 0);
    if (!Number.isSafeInteger(totalBytes) || manifest.totalBytes !== totalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalBytes"],
        message: "totalBytes must equal the safe-integer sum of inventory bytes.",
      });
    }

    if (manifest.releaseDigest !== computeReconstructionReleaseDigest(manifest.files)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releaseDigest"],
        message: "releaseDigest must match the deterministic file inventory digest.",
      });
    }
  });
export type ReconstructionReleaseManifest = z.infer<
  typeof ReconstructionReleaseManifestSchema
>;

export const RECONSTRUCTION_QA_CHECK_KEYS = [
  "manifest_schema",
  "exact_file_set",
  "content_hashes",
  "image_dimensions",
  "mesh_structure",
  "mesh_budget",
  "navigation_graph",
  "coordinate_frame",
] as const;
export const ReconstructionQaCheckKeySchema = z.enum(RECONSTRUCTION_QA_CHECK_KEYS);
export type ReconstructionQaCheckKey = z.infer<typeof ReconstructionQaCheckKeySchema>;

export const ReconstructionQaEvidenceSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    sha256: ReconstructionReleaseSha256Schema,
  })
  .strict();
export type ReconstructionQaEvidence = z.infer<typeof ReconstructionQaEvidenceSchema>;

export const ReconstructionQaCheckSchema = z
  .object({
    checkKey: ReconstructionQaCheckKeySchema,
    status: z.enum(["passed", "failed"]),
    messageKey: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
    evidence: z.array(ReconstructionQaEvidenceSchema).min(1),
  })
  .strict();
export type ReconstructionQaCheck = z.infer<typeof ReconstructionQaCheckSchema>;

const ReconstructionQaReportMaterialSchema = z
  .object({
    schemaVersion: z.literal(RECONSTRUCTION_QA_SCHEMA_VERSION),
    releaseDigest: ReconstructionReleaseSha256Schema,
    sourceManifestSha256: ReconstructionReleaseSha256Schema,
    qaProfileVersion: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
    qaProfileDigest: ReconstructionReleaseSha256Schema,
    outcome: z.enum(["passed", "failed"]),
    checks: z.array(ReconstructionQaCheckSchema).length(RECONSTRUCTION_QA_CHECK_KEYS.length),
  })
  .strict();
export type ReconstructionQaReportMaterial = z.infer<
  typeof ReconstructionQaReportMaterialSchema
>;

export function computeReconstructionQaReportDigest(
  report: ReconstructionQaReportMaterial,
): string {
  const canonical = CanonicalJsonValueSchema.parse(report);
  return sha256Hex(`${QA_DIGEST_DOMAIN}${stableCanonicalJson(canonical)}`);
}

export const ReconstructionQaReportSchema = ReconstructionQaReportMaterialSchema.extend({
  reportDigest: ReconstructionReleaseSha256Schema,
}).superRefine((report, ctx) => {
  const seen = new Set(report.checks.map((check) => check.checkKey));
  if (
    seen.size !== RECONSTRUCTION_QA_CHECK_KEYS.length ||
    RECONSTRUCTION_QA_CHECK_KEYS.some((key) => !seen.has(key))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checks"],
      message: "QA reports must contain every deterministic check exactly once.",
    });
  }

  const expectedOutcome = report.checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";
  if (report.outcome !== expectedOutcome) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcome"],
      message: "QA outcome must reflect the complete check set.",
    });
  }

  const material: ReconstructionQaReportMaterial = {
    schemaVersion: report.schemaVersion,
    releaseDigest: report.releaseDigest,
    sourceManifestSha256: report.sourceManifestSha256,
    qaProfileVersion: report.qaProfileVersion,
    qaProfileDigest: report.qaProfileDigest,
    outcome: report.outcome,
    checks: report.checks,
  };
  if (report.reportDigest !== computeReconstructionQaReportDigest(material)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reportDigest"],
      message: "reportDigest must match the deterministic QA material.",
    });
  }
});
export type ReconstructionQaReport = z.infer<typeof ReconstructionQaReportSchema>;

export const ReconstructionVisualEvidenceSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    objectKey: ReconstructionReleaseObjectPathSchema,
    sha256: ReconstructionReleaseSha256Schema,
  })
  .strict();
export type ReconstructionVisualEvidence = z.infer<
  typeof ReconstructionVisualEvidenceSchema
>;

export const ReconstructionReleaseArtifactRefSchema = z
  .object({
    artifactId: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._-]*$/u),
    artifactDigest: ReconstructionReleaseSha256Schema,
  })
  .strict();
export type ReconstructionReleaseArtifactRef = z.infer<
  typeof ReconstructionReleaseArtifactRefSchema
>;

export const RECONSTRUCTION_RELEASE_REVIEWER_AUTHORITIES = [
  "venue_operations",
  "reconstruction_reviewer",
  "platform_admin",
] as const;
export const ReconstructionReleaseReviewerAuthoritySchema = z.enum(
  RECONSTRUCTION_RELEASE_REVIEWER_AUTHORITIES,
);

const reviewInputFields = {
  releaseId: z.string().uuid(),
  releaseDigest: ReconstructionReleaseSha256Schema,
  qaReportDigest: ReconstructionReleaseSha256Schema,
  decision: z.enum(["approved", "rejected"]),
  targetExposure: z.enum(["expert_review", "public"]),
  visualEvidence: z.array(ReconstructionVisualEvidenceSchema).min(1),
  transformArtifactRef: ReconstructionReleaseArtifactRefSchema.nullable(),
  sceneAuthorityMapRef: ReconstructionReleaseArtifactRefSchema.nullable(),
  note: z.string().trim().min(20).max(2000),
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
} as const;

interface ReviewEvidenceShape {
  readonly decision: "approved" | "rejected";
  readonly targetExposure: "expert_review" | "public";
  readonly transformArtifactRef: ReconstructionReleaseArtifactRef | null;
  readonly sceneAuthorityMapRef: ReconstructionReleaseArtifactRef | null;
}

function requirePublicApprovalEvidence(
  review: ReviewEvidenceShape,
  ctx: z.RefinementCtx,
): void {
  if (review.decision !== "approved" || review.targetExposure !== "public") return;
  if (review.transformArtifactRef === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifactRef"],
      message: "Public approval requires an exact TransformArtifact evidence reference.",
    });
  }
  if (review.sceneAuthorityMapRef === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sceneAuthorityMapRef"],
      message: "Public approval requires an exact Scene Authority Map evidence reference.",
    });
  }
}

export const ReconstructionReleaseReviewInputSchema = z
  .object(reviewInputFields)
  .strict()
  .superRefine(requirePublicApprovalEvidence);
export type ReconstructionReleaseReviewInput = z.infer<
  typeof ReconstructionReleaseReviewInputSchema
>;

export const ReconstructionReleaseReviewMaterialSchema = z
  .object({
    ...reviewInputFields,
    id: z.string().uuid(),
    reviewerUserId: z.string().uuid(),
    reviewerAuthority: ReconstructionReleaseReviewerAuthoritySchema,
    reviewedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine(requirePublicApprovalEvidence);
export type ReconstructionReleaseReviewMaterial = z.infer<
  typeof ReconstructionReleaseReviewMaterialSchema
>;

export function computeReconstructionReleaseReviewDigest(
  review: ReconstructionReleaseReviewMaterial,
): string {
  const canonical = CanonicalJsonValueSchema.parse(review);
  return sha256Hex(`${REVIEW_DIGEST_DOMAIN}${stableCanonicalJson(canonical)}`);
}

export const ReconstructionReleaseReviewSchema = z
  .object({
    ...reviewInputFields,
    id: z.string().uuid(),
    reviewerUserId: z.string().uuid(),
    reviewerAuthority: ReconstructionReleaseReviewerAuthoritySchema,
    reviewedAt: z.string().datetime({ offset: true }),
    reviewDigest: ReconstructionReleaseSha256Schema,
  })
  .strict()
  .superRefine((review, ctx) => {
    requirePublicApprovalEvidence(review, ctx);
    const material: ReconstructionReleaseReviewMaterial = {
      releaseId: review.releaseId,
      releaseDigest: review.releaseDigest,
      qaReportDigest: review.qaReportDigest,
      decision: review.decision,
      targetExposure: review.targetExposure,
      visualEvidence: review.visualEvidence,
      transformArtifactRef: review.transformArtifactRef,
      sceneAuthorityMapRef: review.sceneAuthorityMapRef,
      note: review.note,
      idempotencyKey: review.idempotencyKey,
      id: review.id,
      reviewerUserId: review.reviewerUserId,
      reviewerAuthority: review.reviewerAuthority,
      reviewedAt: review.reviewedAt,
    };
    if (review.reviewDigest !== computeReconstructionReleaseReviewDigest(material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewDigest"],
        message: "reviewDigest must match the exact review material.",
      });
    }
  });
export type ReconstructionReleaseReview = z.infer<
  typeof ReconstructionReleaseReviewSchema
>;

export const ReconstructionReleaseAttestationMetadataSchema = z
  .object({
    id: z.string().uuid(),
    releaseId: z.string().uuid(),
    releaseDigest: ReconstructionReleaseSha256Schema,
    qaReportDigest: ReconstructionReleaseSha256Schema,
    reviewId: z.string().uuid(),
    reviewDigest: ReconstructionReleaseSha256Schema,
    format: z.literal("dsse_in_toto_v1"),
    algorithm: z.literal("ed25519"),
    keyId: z.string().trim().min(1).max(160),
    publicKeyFingerprint: ReconstructionReleaseSha256Schema,
    statementSha256: ReconstructionReleaseSha256Schema,
    envelopeSha256: ReconstructionReleaseSha256Schema,
    r2Key: ReconstructionReleaseObjectPathSchema,
    verifiedAt: z.string().datetime({ offset: true }),
    verifiedBy: z.string().uuid(),
  })
  .strict();
export type ReconstructionReleaseAttestationMetadata = z.infer<
  typeof ReconstructionReleaseAttestationMetadataSchema
>;

const BASE64_SHAPE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function isCanonicalBase64(value: string): boolean {
  if (!BASE64_SHAPE.test(value)) return false;
  if (value.endsWith("==")) {
    const finalDataCharacter = value[value.length - 3];
    return finalDataCharacter !== undefined &&
      BASE64_ALPHABET.indexOf(finalDataCharacter) % 16 === 0;
  }
  if (value.endsWith("=")) {
    const finalDataCharacter = value[value.length - 2];
    return finalDataCharacter !== undefined &&
      BASE64_ALPHABET.indexOf(finalDataCharacter) % 4 === 0;
  }
  return true;
}

function canonicalBase64DecodedByteLength(value: string): number {
  const paddingBytes = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - paddingBytes;
}

function signingPayloadUtf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function canonicalBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(combined >>> 18) & 0x3f] ?? "";
    output += BASE64_ALPHABET[(combined >>> 12) & 0x3f] ?? "";
    output += second === undefined ? "=" : BASE64_ALPHABET[(combined >>> 6) & 0x3f] ?? "";
    output += third === undefined ? "=" : BASE64_ALPHABET[combined & 0x3f] ?? "";
  }
  return output;
}

export const ReconstructionDsseEnvelopeSchema = z
  .object({
    payloadType: z.string().trim().min(1).max(240),
    payload: z.string().min(1).refine(
      isCanonicalBase64,
      "DSSE payload must use canonical base64.",
    ),
    signatures: z.array(z.object({
      keyid: z.string().trim().min(1).max(200),
      sig: z.string().min(1)
        .refine(isCanonicalBase64, "DSSE signatures must use canonical base64.")
        .refine(
          (value) => canonicalBase64DecodedByteLength(value) === 64,
          "Ed25519 DSSE signatures must encode exactly 64 bytes.",
        ),
    }).strict()).min(1).max(RECONSTRUCTION_DSSE_MAX_SIGNATURES),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const keyIds = envelope.signatures.map((signature) => signature.keyid);
    if (new Set(keyIds).size !== keyIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatures"],
        message: "A DSSE envelope may contain at most one signature per key ID.",
      });
    }
  });
export type ReconstructionDsseEnvelope = z.infer<typeof ReconstructionDsseEnvelopeSchema>;

export const ReconstructionReleaseSigningStatementSchema = z
  .object({
    _type: z.literal(RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE),
    subject: z.array(z.object({
      name: z.string().trim().min(1).max(320),
      digest: z.object({
        sha256: ReconstructionReleaseSha256Schema,
      }).strict(),
    }).strict()).length(1),
    predicateType: z.literal(RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE),
    predicate: z.object({
      schemaVersion: z.literal(RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION),
      venueSlug: RuntimeSlugSchema,
      releaseKind: ReconstructionReleaseKindSchema,
      releaseId: z.string().uuid(),
      releaseDigest: ReconstructionReleaseSha256Schema,
      sourceManifestSha256: ReconstructionReleaseSha256Schema,
      releaseManifestSha256: ReconstructionReleaseSha256Schema,
      qaReportDigest: ReconstructionReleaseSha256Schema,
      reviewId: z.string().uuid(),
      reviewDigest: ReconstructionReleaseSha256Schema,
      reviewedAt: z.string().datetime({ offset: true }),
      reviewerUserId: z.string().uuid(),
      decision: z.literal("approved"),
      targetExposure: z.literal("public"),
      visualEvidence: z.array(ReconstructionVisualEvidenceSchema).min(1),
      transformArtifactRef: ReconstructionReleaseArtifactRefSchema,
      sceneAuthorityMapRef: ReconstructionReleaseArtifactRefSchema,
    }).strict(),
  })
  .strict()
  .superRefine((statement, ctx) => {
    const predicate = statement.predicate;
    const expectedSubjectName =
      `reconstruction-release/${predicate.venueSlug}/${predicate.releaseDigest}`;
    if (
      statement.subject[0]?.name !== expectedSubjectName ||
      statement.subject[0]?.digest.sha256 !== predicate.releaseDigest
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject", 0],
        message: "The in-toto subject must identify the exact digest-addressed reconstruction release.",
      });
    }
  });
export type ReconstructionReleaseSigningStatement = z.infer<
  typeof ReconstructionReleaseSigningStatementSchema
>;

export const ReconstructionReleaseSigningPayloadSchema = z
  .object({
    schemaVersion: z.literal(RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION),
    payloadType: z.literal(RECONSTRUCTION_DSSE_PAYLOAD_TYPE),
    releaseId: z.string().uuid(),
    releaseDigest: ReconstructionReleaseSha256Schema,
    qaReportDigest: ReconstructionReleaseSha256Schema,
    reviewId: z.string().uuid(),
    reviewDigest: ReconstructionReleaseSha256Schema,
    statement: ReconstructionReleaseSigningStatementSchema,
    payloadUtf8: z.string().min(1),
    payloadBase64: z.string().min(1).refine(
      isCanonicalBase64,
      "Signing payload must use canonical base64.",
    ),
    payloadSha256: ReconstructionReleaseSha256Schema,
    payloadByteLength: z.number().int().positive(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const predicate = payload.statement.predicate;
    if (
      payload.releaseId !== predicate.releaseId ||
      payload.releaseDigest !== predicate.releaseDigest ||
      payload.qaReportDigest !== predicate.qaReportDigest ||
      payload.reviewId !== predicate.reviewId ||
      payload.reviewDigest !== predicate.reviewDigest
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statement"],
        message: "Signing payload identity must match its exact persisted statement evidence.",
      });
    }
    let serializedStatement: ReconstructionReleaseSigningStatement | null = null;
    try {
      serializedStatement = ReconstructionReleaseSigningStatementSchema.parse(
        JSON.parse(payload.payloadUtf8) as unknown,
      );
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadUtf8"],
        message: "Signing payload UTF-8 text must contain the exact serialized in-toto Statement.",
      });
    }
    if (
      serializedStatement !== null &&
      stableCanonicalJson(CanonicalJsonValueSchema.parse(serializedStatement)) !==
        stableCanonicalJson(CanonicalJsonValueSchema.parse(payload.statement))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statement"],
        message: "The parsed exact payload bytes must equal the supplied in-toto Statement.",
      });
    }
    const exactBytes = signingPayloadUtf8Bytes(payload.payloadUtf8);
    if (payload.payloadBase64 !== canonicalBase64(exactBytes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadBase64"],
        message: "Signing payload base64 must encode the exact serialized statement bytes.",
      });
    }
    if (payload.payloadSha256 !== sha256Hex(exactBytes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadSha256"],
        message: "Signing payload digest must hash the exact serialized statement bytes.",
      });
    }
    if (payload.payloadByteLength !== exactBytes.byteLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadByteLength"],
        message: "Signing payload byte length must match the exact serialized statement bytes.",
      });
    }
  });
export type ReconstructionReleaseSigningPayload = z.infer<
  typeof ReconstructionReleaseSigningPayloadSchema
>;

export const ReconstructionReleaseAttestationVerificationInputSchema = z
  .object({
    reviewId: z.string().uuid(),
    envelope: ReconstructionDsseEnvelopeSchema,
    idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  })
  .strict();
export type ReconstructionReleaseAttestationVerificationInput = z.infer<
  typeof ReconstructionReleaseAttestationVerificationInputSchema
>;

export const ReconstructionCandidateVerificationInputSchema = z
  .object({
    candidateR2Prefix: ReconstructionReleaseObjectPathSchema.refine(
      (value) => /^candidates\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-f0-9]{64}$/u.test(value),
      "Candidate prefix must identify a digest-addressed private venue release.",
    ),
    idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  })
  .strict();
export type ReconstructionCandidateVerificationInput = z.infer<
  typeof ReconstructionCandidateVerificationInputSchema
>;

const registrationInputFields = {
  manifest: ReconstructionReleaseManifestSchema,
  candidateR2Prefix: ReconstructionReleaseObjectPathSchema,
  candidateManifestR2Key: ReconstructionReleaseObjectPathSchema,
  qaReport: ReconstructionQaReportSchema,
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
} as const;

interface RegistrationBindingShape {
  readonly manifest: ReconstructionReleaseManifest;
  readonly candidateR2Prefix: string;
  readonly candidateManifestR2Key: string;
  readonly qaReport: ReconstructionQaReport;
}

function validateRegistrationBindings(
  registration: RegistrationBindingShape,
  ctx: z.RefinementCtx,
): void {
  const expectedPrefix = `candidates/${registration.manifest.venueSlug}/${registration.manifest.releaseDigest}`;
  if (registration.candidateR2Prefix !== expectedPrefix) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidateR2Prefix"],
      message: "Candidate storage must use the release's digest-addressed private prefix.",
    });
  }
  if (registration.candidateManifestR2Key !== `${expectedPrefix}/release-manifest.json`) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidateManifestR2Key"],
      message: "Candidate manifest key must identify release-manifest.json under the private prefix.",
    });
  }
  if (registration.qaReport.releaseDigest !== registration.manifest.releaseDigest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qaReport", "releaseDigest"],
      message: "QA report release digest must match the registered manifest.",
    });
  }
  if (registration.qaReport.sourceManifestSha256 !== registration.manifest.sourceManifestSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qaReport", "sourceManifestSha256"],
      message: "QA report source manifest digest must match the registered manifest.",
    });
  }
}

export const ReconstructionReleaseRegistrationInputSchema = z
  .object(registrationInputFields)
  .strict()
  .superRefine(validateRegistrationBindings);
export type ReconstructionReleaseRegistrationInput = z.infer<
  typeof ReconstructionReleaseRegistrationInputSchema
>;

export const ReconstructionReleaseRegistrationSchema = z
  .object({
    ...registrationInputFields,
    id: z.string().uuid(),
    state: ReconstructionReleaseStateSchema,
    registeredBy: z.string().uuid(),
    registeredAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((registration, ctx) => {
    validateRegistrationBindings(registration, ctx);
    const expectedState = registration.qaReport.outcome === "passed"
      ? "awaiting_review"
      : "machine_qa_failed";
    if (registration.state !== expectedState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "Initial release state must reflect its machine-QA outcome.",
      });
    }
  });
export type ReconstructionReleaseRegistration = z.infer<
  typeof ReconstructionReleaseRegistrationSchema
>;

const publicationInputFields = {
  releaseId: z.string().uuid(),
  releaseDigest: ReconstructionReleaseSha256Schema,
  qaReportDigest: ReconstructionReleaseSha256Schema,
  reviewId: z.string().uuid(),
  reviewDigest: ReconstructionReleaseSha256Schema,
  attestationId: z.string().uuid(),
  attestationEnvelopeSha256: ReconstructionReleaseSha256Schema,
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  note: z.string().trim().min(20).max(2000),
} as const;

export const ReconstructionReleasePublicationInputSchema = z
  .object(publicationInputFields)
  .strict();
export type ReconstructionReleasePublicationInput = z.infer<
  typeof ReconstructionReleasePublicationInputSchema
>;

export const ReconstructionReleasePublicationSchema = z
  .object({
    ...publicationInputFields,
    id: z.string().uuid(),
    candidateR2Prefix: ReconstructionReleaseObjectPathSchema,
    publicR2Prefix: ReconstructionReleaseObjectPathSchema,
    publicManifestR2Key: ReconstructionReleaseObjectPathSchema,
    publicManifestUrl: z.string().url(),
    manifestSha256: ReconstructionReleaseSha256Schema,
    fileCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    publishedBy: z.string().uuid(),
    publishedAt: z.string().datetime({ offset: true }),
    verifiedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((publication, ctx) => {
    const expectedPrefix =
      `releases/sha256/${publication.releaseDigest.slice(0, 2)}/${publication.releaseDigest}`;
    if (publication.publicR2Prefix !== expectedPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicR2Prefix"],
        message: "Public storage must use the immutable digest-addressed release prefix.",
      });
    }
    if (publication.publicManifestR2Key !== `${expectedPrefix}/manifest.json`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicManifestR2Key"],
        message: "Public manifest must be manifest.json inside the immutable release prefix.",
      });
    }
    try {
      const url = new URL(publication.publicManifestUrl);
      if (
        url.protocol !== "https:" ||
        !url.pathname.endsWith(`/${publication.publicManifestR2Key}`)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["publicManifestUrl"],
          message: "Public manifest URL must be HTTPS and identify the declared public object key.",
        });
      }
    } catch {
      // The base URL schema reports malformed URLs.
    }
    if (Date.parse(publication.verifiedAt) < Date.parse(publication.publishedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verifiedAt"],
        message: "Public publication readback verification cannot precede publication.",
      });
    }
  });
export type ReconstructionReleasePublication = z.infer<
  typeof ReconstructionReleasePublicationSchema
>;

export const ReconstructionReleaseChannelSchema = z
  .object({
    venueSlug: RuntimeSlugSchema,
    releaseKind: ReconstructionReleaseKindSchema,
    channel: z.literal("production"),
    activeReleaseId: z.string().uuid().nullable(),
    activeReleaseDigest: ReconstructionReleaseSha256Schema.nullable(),
    activePublicationId: z.string().uuid().nullable(),
    revision: z.number().int().nonnegative(),
    updatedBy: z.string().uuid().nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((channel, ctx) => {
    const activeValues = [
      channel.activeReleaseId,
      channel.activeReleaseDigest,
      channel.activePublicationId,
    ];
    const populated = activeValues.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== activeValues.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeReleaseId"],
        message: "Production channel active release identity must be wholly null or wholly populated.",
      });
    }
    if (channel.revision === 0 && populated !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revision"],
        message: "An unmodified production channel cannot already identify an active release.",
      });
    }
  });
export type ReconstructionReleaseChannel = z.infer<
  typeof ReconstructionReleaseChannelSchema
>;

const channelTransitionFields = {
  targetReleaseId: z.string().uuid(),
  targetReleaseDigest: ReconstructionReleaseSha256Schema,
  targetPublicationId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  expectedActiveReleaseId: z.string().uuid().nullable(),
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  reason: z.string().trim().min(20).max(2000),
} as const;

export const ReconstructionReleasePromoteInputSchema = z
  .object(channelTransitionFields)
  .strict();
export type ReconstructionReleasePromoteInput = z.infer<
  typeof ReconstructionReleasePromoteInputSchema
>;

export const ReconstructionReleaseRollbackInputSchema = z
  .object({
    ...channelTransitionFields,
    expectedActiveReleaseId: z.string().uuid(),
  })
  .strict()
  .superRefine((rollback, ctx) => {
    if (rollback.targetReleaseId === rollback.expectedActiveReleaseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetReleaseId"],
        message: "Rollback target must differ from the currently active release.",
      });
    }
  });
export type ReconstructionReleaseRollbackInput = z.infer<
  typeof ReconstructionReleaseRollbackInputSchema
>;

export const ReconstructionReleaseChannelEventSchema = z
  .object({
    id: z.string().uuid(),
    venueSlug: RuntimeSlugSchema,
    releaseKind: ReconstructionReleaseKindSchema,
    channel: z.literal("production"),
    action: z.enum(["promote", "rollback"]),
    fromReleaseId: z.string().uuid().nullable(),
    fromReleaseDigest: ReconstructionReleaseSha256Schema.nullable(),
    fromPublicationId: z.string().uuid().nullable(),
    toReleaseId: z.string().uuid(),
    toReleaseDigest: ReconstructionReleaseSha256Schema,
    toPublicationId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    resultingRevision: z.number().int().positive(),
    actorUserId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
    reason: z.string().trim().min(20).max(2000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((event, ctx) => {
    const from = [event.fromReleaseId, event.fromReleaseDigest, event.fromPublicationId];
    const populatedFrom = from.filter((value) => value !== null).length;
    if (populatedFrom !== 0 && populatedFrom !== from.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromReleaseId"],
        message: "Channel-event source identity must be wholly null or wholly populated.",
      });
    }
    if (event.action === "rollback" && populatedFrom !== from.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromReleaseId"],
        message: "Rollback events require an active source release.",
      });
    }
    if (event.resultingRevision !== event.expectedRevision + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultingRevision"],
        message: "Channel events must advance the compare-and-swap revision exactly once.",
      });
    }
    if (event.fromReleaseId !== null && event.fromReleaseId === event.toReleaseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toReleaseId"],
        message: "Channel transitions must change the active release.",
      });
    }
  });
export type ReconstructionReleaseChannelEvent = z.infer<
  typeof ReconstructionReleaseChannelEventSchema
>;

export const ReconstructionReleaseChannelConflictSchema = z
  .object({
    code: z.literal("REVISION_CONFLICT"),
    currentRevision: z.number().int().nonnegative(),
    currentReleaseId: z.string().uuid().nullable(),
  })
  .strict();
export type ReconstructionReleaseChannelConflict = z.infer<
  typeof ReconstructionReleaseChannelConflictSchema
>;

export const ReconstructionReleaseListItemSchema = z
  .object({
    id: z.string().uuid(),
    venueSlug: RuntimeSlugSchema,
    releaseKind: ReconstructionReleaseKindSchema,
    releaseDigest: ReconstructionReleaseSha256Schema,
    sourceManifestSha256: ReconstructionReleaseSha256Schema,
    fileCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    qaOutcome: z.enum(["passed", "failed"]),
    qaReportDigest: ReconstructionReleaseSha256Schema,
    latestReviewDecision: z.enum(["approved", "rejected"]).nullable(),
    latestReviewTargetExposure: z.enum(["expert_review", "public"]).nullable(),
    attested: z.boolean(),
    published: z.boolean(),
    active: z.boolean(),
    state: ReconstructionReleaseStateSchema,
    registeredAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((item, ctx) => {
    if ((item.latestReviewDecision === null) !== (item.latestReviewTargetExposure === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latestReviewDecision"],
        message: "Latest review decision and target exposure must be present together.",
      });
    }
    if (item.active && (!item.published || item.state !== "active")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["active"],
        message: "Active releases must be published and use the active state.",
      });
    }
    if (item.published && !item.attested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["published"],
        message: "Published releases require a verified detached attestation.",
      });
    }
  });
export type ReconstructionReleaseListItem = z.infer<
  typeof ReconstructionReleaseListItemSchema
>;

export const ReconstructionReleaseListSchema = z
  .object({
    releases: z.array(ReconstructionReleaseListItemSchema),
    productionChannel: ReconstructionReleaseChannelSchema.nullable(),
  })
  .strict();
export type ReconstructionReleaseList = z.infer<typeof ReconstructionReleaseListSchema>;

export const ReconstructionReleaseDetailSchema = z
  .object({
    registration: ReconstructionReleaseRegistrationSchema,
    reviews: z.array(ReconstructionReleaseReviewSchema),
    attestations: z.array(ReconstructionReleaseAttestationMetadataSchema),
    publication: ReconstructionReleasePublicationSchema.nullable(),
    productionChannel: ReconstructionReleaseChannelSchema.nullable(),
    channelEvents: z.array(ReconstructionReleaseChannelEventSchema),
    state: ReconstructionReleaseStateSchema,
  })
  .strict()
  .superRefine((detail, ctx) => {
    const releaseId = detail.registration.id;
    const releaseDigest = detail.registration.manifest.releaseDigest;
    const qaReportDigest = detail.registration.qaReport.reportDigest;

    for (const [index, review] of detail.reviews.entries()) {
      if (
        review.releaseId !== releaseId ||
        review.releaseDigest !== releaseDigest ||
        review.qaReportDigest !== qaReportDigest
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviews", index],
          message: "Every review must bind the detail's exact release and QA digests.",
        });
      }
    }

    for (const [index, attestation] of detail.attestations.entries()) {
      const review = detail.reviews.find((candidate) => candidate.id === attestation.reviewId);
      if (
        attestation.releaseId !== releaseId ||
        attestation.releaseDigest !== releaseDigest ||
        attestation.qaReportDigest !== qaReportDigest ||
        review === undefined ||
        review.reviewDigest !== attestation.reviewDigest ||
        review.decision !== "approved" ||
        review.targetExposure !== "public"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attestations", index],
          message: "Attestations must bind an approved public review of this exact release and QA report.",
        });
      }
    }

    if (detail.publication !== null) {
      const publication = detail.publication;
      const review = detail.reviews.find((candidate) => candidate.id === publication.reviewId);
      const attestation = detail.attestations.find(
        (candidate) => candidate.id === publication.attestationId,
      );
      if (
        publication.releaseId !== releaseId ||
        publication.releaseDigest !== releaseDigest ||
        publication.qaReportDigest !== qaReportDigest ||
        publication.manifestSha256 !== detail.registration.manifest.sourceManifestSha256 ||
        publication.fileCount !== detail.registration.manifest.fileCount ||
        publication.totalBytes !== detail.registration.manifest.totalBytes ||
        review === undefined ||
        review.reviewDigest !== publication.reviewDigest ||
        review.decision !== "approved" ||
        review.targetExposure !== "public" ||
        attestation === undefined ||
        attestation.envelopeSha256 !== publication.attestationEnvelopeSha256
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["publication"],
          message: "Publication must bind this release, its public approval, and its verified attestation.",
        });
      }
    }

    if (detail.productionChannel?.activeReleaseId === releaseId) {
      if (
        detail.publication === null ||
        detail.productionChannel.activeReleaseDigest !== releaseDigest ||
        detail.productionChannel.activePublicationId !== detail.publication.id ||
        detail.state !== "active"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productionChannel"],
          message: "An active channel pointer must identify this exact published release.",
        });
      }
    }
  });
export type ReconstructionReleaseDetail = z.infer<
  typeof ReconstructionReleaseDetailSchema
>;

export const ReconstructionReleasePublicActiveDescriptorSchema = z
  .object({
    schemaVersion: z.literal(RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION),
    venueSlug: RuntimeSlugSchema,
    releaseKind: ReconstructionReleaseKindSchema,
    channel: z.literal("production"),
    releaseId: z.string().uuid(),
    releaseDigest: ReconstructionReleaseSha256Schema,
    publicationId: z.string().uuid(),
    manifestSha256: ReconstructionReleaseSha256Schema,
    manifestUrl: z.string().url(),
    assetBaseUrl: z.string().url(),
    channelRevision: z.number().int().positive(),
  })
  .strict()
  .superRefine((descriptor, ctx) => {
    try {
      const manifestUrl = new URL(descriptor.manifestUrl);
      const assetBaseUrl = new URL(descriptor.assetBaseUrl);
      if (manifestUrl.protocol !== "https:" || assetBaseUrl.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manifestUrl"],
          message: "Active public release URLs must use HTTPS.",
        });
      }
      const normalizedBase = descriptor.assetBaseUrl.replace(/\/+$/u, "");
      if (descriptor.manifestUrl !== `${normalizedBase}/manifest.json`) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manifestUrl"],
          message: "Active manifest URL must resolve from the exact immutable asset base.",
        });
      }
      if (!assetBaseUrl.pathname.endsWith(`/${descriptor.releaseDigest}`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assetBaseUrl"],
          message: "Active asset base must end with the release digest.",
        });
      }
    } catch {
      // URL schemas report malformed values.
    }
  });
export type ReconstructionReleasePublicActiveDescriptor = z.infer<
  typeof ReconstructionReleasePublicActiveDescriptorSchema
>;
