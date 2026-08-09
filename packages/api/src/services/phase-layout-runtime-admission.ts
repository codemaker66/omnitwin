import { createHash } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES,
  PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES,
  PhaseLayoutRuntimeBindingV1Schema,
  PhaseLayoutRuntimeVisualAssetSchema,
  RegisterRuntimePackageInputSchema,
  RuntimePackageManifestJsonSchema,
  RuntimeQaRecordV0Schema,
  TransformArtifactV0Schema,
  phaseLayoutRuntimeBindingDigest,
  phaseLayoutRuntimeCompositionDigest,
  runtimeQaRecordSignedTransformArtifactId,
  runtimeQaRecordSignedTransformArtifactSha256,
  stableCanonicalJson,
  type PhaseLayoutRuntimeAvailableBinding,
  type PhaseLayoutRuntimeBindingV1,
  type PhaseLayoutRuntimeUnavailableReason,
  type PhaseLayoutRuntimeVisualAsset,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  assetVersions,
  reconstructionReviewEvidenceArtifacts,
  runtimePackages,
  runtimePresentationAdmissionMembers,
  runtimePresentationAdmissions,
  runtimePresentationRightsEvidence,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { runtimePackageProfileManifestFingerprint } from "../lib/reception-reviewed-runtime-profile.js";
import { runtimeQaRecordSha256 } from "../lib/runtime-qa-record-receipt.js";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";
import { computeRuntimePackageRevisionDigest } from "./runtime-package-revisions.js";

type AdmissionReader = Pick<Database, "select" | "execute">;

interface RuntimeAdmissionScope {
  readonly venueId: string;
  readonly venueSlug: string;
  readonly spaceId: string;
  readonly spaceSlug: string;
  readonly expectedRuntimePackageId: string | null;
  readonly expectedRuntimeManifestDigest: string | null;
  readonly frozenAt: Date;
}

export interface RuntimeAdmissionUnavailableDecision {
  readonly availability: "unavailable";
  readonly unavailableReason: PhaseLayoutRuntimeUnavailableReason;
  readonly expectedRuntimePackageId: string | null;
  readonly expectedRuntimeManifestDigest: string | null;
}

export interface RuntimeAdmissionAvailableDecision {
  readonly availability: "available";
  readonly presentationAdmissionId: string;
  readonly presentationAdmissionDecision: "approved";
  readonly presentationAdmissionReviewedAt: string;
  readonly presentationAdmissionDigest: string;
  readonly runtimePackageId: string;
  readonly runtimePackageRevision: number;
  readonly runtimePackageContentDigest: string;
  readonly runtimeManifestDigest: string;
  readonly runtimePackageEvidenceStatus: "human_reviewed";
  readonly runtimePackageStatus: "internal_ready" | "published";
  readonly reviewedProfileId: string;
  readonly reviewedProfileManifestFingerprint: string;
  readonly rightsEvidenceDigest: string;
  readonly sceneAuthorityMapDigest: string;
  readonly runtimeQaRecordId: string;
  readonly runtimeQaRecordKey: string;
  readonly runtimeQaRecordDigest: string;
  readonly runtimeQaDecision: "approved_internal_preview" | "approved_public";
  readonly runtimeQaReviewedBy: string;
  readonly runtimeQaReviewedAt: string;
  readonly transformArtifactRowId: string;
  readonly transformArtifactId: string;
  readonly transformArtifactDigest: string;
  readonly transformArtifact: PhaseLayoutRuntimeAvailableBinding["transformArtifact"];
  readonly visualAssets: readonly PhaseLayoutRuntimeVisualAsset[];
  readonly compositionDigest: string;
}

export type RuntimeAdmissionDecision =
  | RuntimeAdmissionUnavailableDecision
  | RuntimeAdmissionAvailableDecision;

/** Exact per-member ceiling shared by freeze-time admission and authenticated delivery. */
export const MAX_HISTORICAL_RUNTIME_MEMBER_BYTES = PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES;
export const MAX_HISTORICAL_RUNTIME_TOTAL_BYTES = PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES;

interface RuntimeBindingEnvelope {
  readonly bindingId: string;
  readonly canonicalSnapshotId: string;
  readonly snapshotHash: string;
  readonly venueId: string;
  readonly venueSlug: string;
  readonly spaceId: string;
  readonly spaceSlug: string;
  readonly boundBy: string;
  readonly boundAt: Date;
}

function unavailable(
  scope: RuntimeAdmissionScope,
  unavailableReason: PhaseLayoutRuntimeUnavailableReason,
): RuntimeAdmissionUnavailableDecision {
  return {
    availability: "unavailable",
    unavailableReason,
    expectedRuntimePackageId: scope.expectedRuntimePackageId,
    expectedRuntimeManifestDigest: scope.expectedRuntimeManifestDigest,
  };
}

function canonicalSha256(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return createHash("sha256")
    .update(`${domain}${stableCanonicalJson(canonical)}`, "utf8")
    .digest("hex");
}

export function runtimePackageManifestDigest(manifest: unknown): string {
  const parsed = RuntimePackageManifestJsonSchema.parse(manifest);
  return createHash("sha256")
    .update(stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed)), "utf8")
    .digest("hex");
}

export const RuntimePresentationRightsEvidenceBodySchema = z.object({
  schemaVersion: z.literal("runtime-presentation-rights-evidence.v1"),
  evidenceId: z.string().uuid(),
  assetVersionId: z.string().uuid(),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  assetSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  decision: z.enum(["approved", "rejected"]),
  rightsBasis: z.string().trim().min(1).max(160),
  termsReference: z.string().trim().min(1).max(2_048),
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict();

export function runtimePresentationRightsEvidenceDigest(body: unknown): string {
  return canonicalSha256(
    "venviewer.runtime-presentation-rights-evidence.v1\n",
    RuntimePresentationRightsEvidenceBodySchema.parse(body),
  );
}

export const RuntimePresentationAdmissionBodySchema = z.object({
  schemaVersion: z.literal("runtime-presentation-admission.v1"),
  admissionId: z.string().uuid(),
  runtimePackageId: z.string().uuid(),
  runtimePackageContentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  runtimeManifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedProfileId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  reviewedProfileManifestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  runtimeQaRecordId: z.string().uuid(),
  runtimeQaRecordKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  runtimeQaRecordDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  runtimeQaDecision: z.enum(["approved_internal_preview", "approved_public"]),
  runtimeQaReviewedBy: z.string().uuid(),
  runtimeQaReviewedAt: z.string().datetime({ offset: true }),
  runtimeTransformArtifactRowId: z.string().uuid(),
  runtimeTransformArtifactId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  runtimeTransformArtifactDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sceneAuthorityArtifactRowId: z.string().uuid(),
  sceneAuthorityArtifactKind: z.literal("scene_authority_map_v0"),
  sceneAuthorityArtifactId: z.string().trim().min(1).max(160),
  sceneAuthorityMapDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  rightsEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  memberCount: z.number().int().positive().max(8),
  decision: z.enum(["approved", "rejected"]),
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict();

export function runtimePresentationAdmissionDigest(body: unknown): string {
  return canonicalSha256(
    "venviewer.runtime-presentation-admission.v1\n",
    RuntimePresentationAdmissionBodySchema.parse(body),
  );
}

export function runtimePresentationRightsSetDigest(
  members: readonly {
    readonly memberIndex: number;
    readonly assetVersionId: string;
    readonly rightsEvidenceDigest: string;
    readonly rightsDecision: string;
    readonly rightsReviewedBy: string;
    readonly rightsReviewedAt: Date;
  }[],
): string {
  return canonicalSha256(
    "venviewer.runtime-presentation-rights-set.v1\n",
    members.map((member) => ({
      memberIndex: member.memberIndex,
      assetVersionId: member.assetVersionId,
      rightsEvidenceDigest: member.rightsEvidenceDigest,
      rightsDecision: member.rightsDecision,
      rightsReviewedBy: member.rightsReviewedBy,
      rightsReviewedAt: member.rightsReviewedAt.toISOString(),
    })),
  );
}

const ASSET_LOCAL_FRAMES = new Set(["ARF", "G", "COLMAP_RDF"]);

/** v1 has one transform only: direct asset-local↔RRF is the complete contract. */
export function isDirectHistoricalPresentationTransform(artifact: {
  readonly sourceFrame: string;
  readonly targetFrame: string;
}): boolean {
  return (
    artifact.sourceFrame === "RRF" && ASSET_LOCAL_FRAMES.has(artifact.targetFrame)
  ) || (
    artifact.targetFrame === "RRF" && ASSET_LOCAL_FRAMES.has(artifact.sourceFrame)
  );
}

function packageInput(row: typeof runtimePackages.$inferSelect): unknown {
  return {
    venueSlug: row.venueSlug,
    roomSlug: row.roomSlug,
    primaryVisualAssetVersionId: row.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: row.semanticMeshAssetVersionId,
    collisionAssetVersionId: row.collisionAssetVersionId,
    pointCloudAssetVersionId: row.pointCloudAssetVersionId,
    manifestJson: row.manifestJson,
    evidenceStatus: row.evidenceStatus,
    runtimeStatus: row.runtimeStatus,
  };
}

/**
 * Resolves one freeze-time decision exclusively from exact persisted joins.
 * The new admission tables intentionally have no production seed; therefore
 * today's packages end at provenance_incomplete instead of inventing rights
 * or Scene Authority causality.
 */
export async function resolvePhaseLayoutRuntimeAdmission(
  db: AdmissionReader,
  scope: RuntimeAdmissionScope,
): Promise<RuntimeAdmissionDecision> {
  if (scope.expectedRuntimePackageId === null) return unavailable(scope, "runtime_not_declared");
  if (scope.expectedRuntimeManifestDigest === null) return unavailable(scope, "manifest_digest_missing");
  if (!z.string().uuid().safeParse(scope.expectedRuntimePackageId).success) {
    return unavailable(scope, "package_reference_invalid");
  }

  const [pkg] = await db.select().from(runtimePackages).where(
    eq(runtimePackages.id, scope.expectedRuntimePackageId),
  ).limit(1);
  if (pkg === undefined) return unavailable(scope, "package_not_found");
  if (
    scope.venueSlug !== "trades-hall" ||
    pkg.venueSlug !== scope.venueSlug ||
    pkg.roomSlug !== scope.spaceSlug
  ) {
    return unavailable(scope, "package_scope_mismatch");
  }

  const parsedPackageInput = RegisterRuntimePackageInputSchema.safeParse(packageInput(pkg));
  if (
    !parsedPackageInput.success ||
    pkg.identityKind !== "content_sha256" ||
    pkg.contentDigest === null ||
    computeRuntimePackageRevisionDigest(parsedPackageInput.data) !== pkg.contentDigest
  ) {
    return unavailable(scope, "package_identity_invalid");
  }
  const manifest = RuntimePackageManifestJsonSchema.safeParse(pkg.manifestJson);
  if (!manifest.success) return unavailable(scope, "composition_invalid");
  const manifestDigest = runtimePackageManifestDigest(manifest.data);
  if (manifestDigest !== scope.expectedRuntimeManifestDigest) {
    return unavailable(scope, "manifest_mismatch");
  }
  if (
    pkg.evidenceStatus !== "human_reviewed" ||
    (pkg.runtimeStatus !== "internal_ready" && pkg.runtimeStatus !== "published")
  ) {
    return unavailable(scope, "package_not_reviewed");
  }

  const [admission] = await db.select({
    admission: runtimePresentationAdmissions,
    qa: runtimeQaRecords,
    transform: runtimeTransformArtifacts,
    scene: reconstructionReviewEvidenceArtifacts,
  }).from(runtimePresentationAdmissions)
    .innerJoin(runtimeQaRecords, and(
      eq(runtimePresentationAdmissions.runtimeQaRecordId, runtimeQaRecords.id),
      eq(runtimePresentationAdmissions.runtimePackageId, runtimeQaRecords.runtimePackageId),
      eq(runtimePresentationAdmissions.venueSlug, runtimeQaRecords.venueSlug),
      eq(runtimePresentationAdmissions.roomSlug, runtimeQaRecords.roomSlug),
    ))
    .innerJoin(runtimeTransformArtifacts, and(
      eq(runtimePresentationAdmissions.runtimeTransformArtifactRowId, runtimeTransformArtifacts.id),
      eq(runtimePresentationAdmissions.runtimePackageId, runtimeTransformArtifacts.runtimePackageId),
      eq(runtimePresentationAdmissions.venueSlug, runtimeTransformArtifacts.venueSlug),
      eq(runtimePresentationAdmissions.roomSlug, runtimeTransformArtifacts.roomSlug),
    ))
    .innerJoin(reconstructionReviewEvidenceArtifacts, and(
      eq(
        runtimePresentationAdmissions.sceneAuthorityArtifactRowId,
        reconstructionReviewEvidenceArtifacts.id,
      ),
      eq(runtimePresentationAdmissions.venueSlug, reconstructionReviewEvidenceArtifacts.venueSlug),
    ))
    .where(and(
      eq(runtimePresentationAdmissions.runtimePackageId, pkg.id),
      eq(runtimePresentationAdmissions.runtimePackageContentDigest, pkg.contentDigest),
      eq(runtimePresentationAdmissions.venueSlug, scope.venueSlug),
      eq(runtimePresentationAdmissions.roomSlug, scope.spaceSlug),
      eq(runtimePresentationAdmissions.runtimeManifestDigest, manifestDigest),
      lte(runtimePresentationAdmissions.reviewedAt, scope.frozenAt),
    ))
    .orderBy(desc(runtimePresentationAdmissions.reviewedAt), desc(runtimePresentationAdmissions.id))
    .limit(1);
  if (admission === undefined) return unavailable(scope, "provenance_incomplete");
  await db.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`runtime-presentation-admission:${admission.admission.id}`}, 0)
    )
  `);
  const admissionBody = RuntimePresentationAdmissionBodySchema.safeParse(
    admission.admission.admissionBody,
  );
  if (
    !admissionBody.success ||
    runtimePresentationAdmissionDigest(admissionBody.data) !== admission.admission.admissionDigest ||
    admissionBody.data.admissionId !== admission.admission.id ||
    admissionBody.data.runtimePackageId !== admission.admission.runtimePackageId ||
    admissionBody.data.runtimePackageContentDigest !== admission.admission.runtimePackageContentDigest ||
    admissionBody.data.venueSlug !== admission.admission.venueSlug ||
    admissionBody.data.roomSlug !== admission.admission.roomSlug ||
    admissionBody.data.runtimeManifestDigest !== admission.admission.runtimeManifestDigest ||
    admissionBody.data.reviewedProfileId !== admission.admission.reviewedProfileId ||
    admissionBody.data.reviewedProfileManifestFingerprint !==
      admission.admission.reviewedProfileManifestFingerprint ||
    admissionBody.data.runtimeQaRecordId !== admission.admission.runtimeQaRecordId ||
    admissionBody.data.runtimeQaRecordKey !== admission.admission.runtimeQaRecordKey ||
    admissionBody.data.runtimeQaRecordDigest !== admission.admission.runtimeQaRecordDigest ||
    admissionBody.data.runtimeQaDecision !== admission.admission.runtimeQaDecision ||
    admissionBody.data.runtimeQaReviewedBy !== admission.admission.runtimeQaReviewedBy ||
    new Date(admissionBody.data.runtimeQaReviewedAt).getTime() !==
      admission.admission.runtimeQaReviewedAt.getTime() ||
    admissionBody.data.runtimeTransformArtifactRowId !==
      admission.admission.runtimeTransformArtifactRowId ||
    admissionBody.data.runtimeTransformArtifactId !==
      admission.admission.runtimeTransformArtifactId ||
    admissionBody.data.runtimeTransformArtifactDigest !==
      admission.admission.runtimeTransformArtifactDigest ||
    admissionBody.data.sceneAuthorityArtifactRowId !==
      admission.admission.sceneAuthorityArtifactRowId ||
    admissionBody.data.sceneAuthorityArtifactId !== admission.admission.sceneAuthorityArtifactId ||
    admissionBody.data.sceneAuthorityMapDigest !== admission.admission.sceneAuthorityMapDigest ||
    admissionBody.data.rightsEvidenceDigest !== admission.admission.rightsEvidenceDigest ||
    admissionBody.data.memberCount !== admission.admission.memberCount ||
    admissionBody.data.decision !== admission.admission.decision ||
    admissionBody.data.reviewedBy !== admission.admission.reviewedBy ||
    new Date(admissionBody.data.reviewedAt).getTime() !== admission.admission.reviewedAt.getTime() ||
    pkg.createdAt > admission.admission.reviewedAt ||
    admission.admission.createdAt > scope.frozenAt
  ) {
    return unavailable(scope, "presentation_admission_missing");
  }
  if (admission.admission.decision !== "approved") {
    return unavailable(scope, "presentation_admission_missing");
  }

  const declaredIds = manifest.data.assets.visualAssetVersionIds;
  const receipts = manifest.data.assets.visualAssetReceipts;
  const profileFingerprint = runtimePackageProfileManifestFingerprint(manifest.data);
  if (
    declaredIds === undefined || receipts === undefined || profileFingerprint === null ||
    declaredIds.length !== admission.admission.memberCount ||
    receipts.length !== declaredIds.length ||
    admission.admission.reviewedProfileManifestFingerprint !== profileFingerprint
  ) {
    return unavailable(scope, "reviewed_profile_missing");
  }

  const memberRows = await db.select({
    member: runtimePresentationAdmissionMembers,
    asset: assetVersions,
    rights: runtimePresentationRightsEvidence,
  }).from(runtimePresentationAdmissionMembers)
    .innerJoin(assetVersions, and(
      eq(runtimePresentationAdmissionMembers.assetVersionId, assetVersions.id),
      eq(runtimePresentationAdmissionMembers.venueSlug, assetVersions.venueSlug),
      eq(runtimePresentationAdmissionMembers.roomSlug, assetVersions.roomSlug),
      eq(runtimePresentationAdmissionMembers.fileName, assetVersions.fileName),
      eq(runtimePresentationAdmissionMembers.fileExt, assetVersions.fileExt),
      eq(runtimePresentationAdmissionMembers.mimeType, assetVersions.mimeType),
      eq(runtimePresentationAdmissionMembers.sha256, assetVersions.sha256),
      eq(runtimePresentationAdmissionMembers.sizeBytes, assetVersions.sizeBytes),
    ))
    .innerJoin(runtimePresentationRightsEvidence, and(
      eq(
        runtimePresentationAdmissionMembers.rightsEvidenceRowId,
        runtimePresentationRightsEvidence.id,
      ),
      eq(
        runtimePresentationAdmissionMembers.assetVersionId,
        runtimePresentationRightsEvidence.assetVersionId,
      ),
      eq(runtimePresentationAdmissionMembers.venueSlug, runtimePresentationRightsEvidence.venueSlug),
      eq(runtimePresentationAdmissionMembers.roomSlug, runtimePresentationRightsEvidence.roomSlug),
      eq(runtimePresentationAdmissionMembers.sha256, runtimePresentationRightsEvidence.assetSha256),
      eq(
        runtimePresentationAdmissionMembers.sizeBytes,
        runtimePresentationRightsEvidence.assetSizeBytes,
      ),
      eq(
        runtimePresentationAdmissionMembers.rightsEvidenceDigest,
        runtimePresentationRightsEvidence.evidenceDigest,
      ),
      eq(
        runtimePresentationAdmissionMembers.rightsDecision,
        runtimePresentationRightsEvidence.decision,
      ),
      eq(
        runtimePresentationAdmissionMembers.rightsReviewedBy,
        runtimePresentationRightsEvidence.reviewedBy,
      ),
      eq(
        runtimePresentationAdmissionMembers.rightsReviewedAt,
        runtimePresentationRightsEvidence.reviewedAt,
      ),
    ))
    .where(eq(runtimePresentationAdmissionMembers.admissionId, admission.admission.id))
    .orderBy(runtimePresentationAdmissionMembers.memberIndex);
  if (memberRows.length !== declaredIds.length) return unavailable(scope, "composition_invalid");

  const visualAssets: PhaseLayoutRuntimeVisualAsset[] = [];
  let totalVisualAssetBytes = 0;
  for (const [index, row] of memberRows.entries()) {
    const receipt = receipts[index];
    const asset = row.asset;
    const member = row.member;
    const rightsBody = RuntimePresentationRightsEvidenceBodySchema.safeParse(row.rights.evidenceBody);
    if (
      receipt === undefined || member.memberIndex !== index ||
      declaredIds[index] !== asset.id || receipt.assetVersionId !== asset.id ||
      member.runtimePackageId !== pkg.id ||
      member.runtimePackageContentDigest !== pkg.contentDigest ||
      member.venueSlug !== scope.venueSlug || member.roomSlug !== scope.spaceSlug ||
      asset.venueSlug !== scope.venueSlug || asset.roomSlug !== scope.spaceSlug ||
      asset.r2Key === null || asset.externalUrl !== null || asset.mimeType === null ||
      asset.sha256 === null || asset.sizeBytes === null ||
      asset.sizeBytes > MAX_HISTORICAL_RUNTIME_MEMBER_BYTES ||
      asset.evidenceStatus !== "human_reviewed" ||
      member.fileName !== asset.fileName || member.fileExt !== asset.fileExt ||
      member.mimeType !== asset.mimeType || member.sha256 !== asset.sha256 ||
      member.sizeBytes !== asset.sizeBytes ||
      member.storageKeySha256 !== runtimeAssetStorageKeySha256(asset.r2Key) ||
      receipt.fileName !== asset.fileName || receipt.fileExt !== asset.fileExt ||
      receipt.sha256 !== asset.sha256 || receipt.sizeBytes !== asset.sizeBytes ||
      receipt.storageKeySha256 !== member.storageKeySha256 ||
      !asset.fileName.endsWith(asset.fileExt) ||
      !rightsBody.success ||
      runtimePresentationRightsEvidenceDigest(rightsBody.data) !== row.rights.evidenceDigest ||
      member.rightsEvidenceRowId !== row.rights.id ||
      member.rightsEvidenceDigest !== row.rights.evidenceDigest ||
      member.rightsDecision !== row.rights.decision ||
      member.rightsReviewedBy !== row.rights.reviewedBy ||
      member.rightsReviewedAt.getTime() !== row.rights.reviewedAt.getTime() ||
      row.rights.assetSha256 !== asset.sha256 || row.rights.assetSizeBytes !== asset.sizeBytes ||
      rightsBody.data.evidenceId !== row.rights.id ||
      rightsBody.data.assetVersionId !== asset.id ||
      rightsBody.data.roomSlug !== scope.spaceSlug ||
      rightsBody.data.assetSha256 !== asset.sha256 || rightsBody.data.assetSizeBytes !== asset.sizeBytes ||
      rightsBody.data.decision !== row.rights.decision ||
      rightsBody.data.reviewedBy !== row.rights.reviewedBy ||
      new Date(rightsBody.data.reviewedAt).getTime() !== row.rights.reviewedAt.getTime() ||
      member.rightsDecision !== "approved" ||
      member.rightsReviewedAt > admission.admission.reviewedAt ||
      row.rights.createdAt > admission.admission.reviewedAt
    ) {
      return unavailable(scope, "composition_invalid");
    }
    if (
      totalVisualAssetBytes > MAX_HISTORICAL_RUNTIME_TOTAL_BYTES - asset.sizeBytes
    ) {
      return unavailable(scope, "composition_invalid");
    }
    totalVisualAssetBytes += asset.sizeBytes;
    const parsed = PhaseLayoutRuntimeVisualAssetSchema.safeParse({
      memberIndex: index,
      assetVersionId: asset.id,
      fileName: asset.fileName,
      fileExt: asset.fileExt,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      evidenceStatus: asset.evidenceStatus,
    });
    if (!parsed.success) return unavailable(scope, "composition_invalid");
    visualAssets.push(parsed.data);
  }
  if (
    runtimePresentationRightsSetDigest(memberRows.map((row) => row.member)) !==
    admission.admission.rightsEvidenceDigest
  ) {
    return unavailable(scope, "provenance_incomplete");
  }

  const qa = RuntimeQaRecordV0Schema.safeParse(admission.qa.recordJson);
  if (
    !qa.success || admission.qa.recordDigest === null || admission.qa.reviewedBy === null ||
    admission.qa.reviewedAt === null ||
    runtimeQaRecordSha256(qa.data) !== admission.qa.recordDigest ||
    qa.data.recordId !== admission.qa.recordId ||
    qa.data.runtimePackageId !== pkg.id ||
    qa.data.venueSlug !== scope.venueSlug || qa.data.roomSlug !== scope.spaceSlug ||
    admission.qa.recordId !== admission.admission.runtimeQaRecordKey ||
    admission.qa.recordDigest !== admission.admission.runtimeQaRecordDigest ||
    admission.qa.publicExposureDecision !== admission.admission.runtimeQaDecision ||
    admission.qa.reviewedBy !== admission.admission.runtimeQaReviewedBy ||
    admission.qa.reviewedAt.getTime() !== admission.admission.runtimeQaReviewedAt.getTime() ||
    admission.qa.reviewedAt > admission.admission.reviewedAt ||
    admission.qa.createdAt > admission.admission.reviewedAt ||
    new Date(qa.data.recordedAt).getTime() !== admission.qa.reviewedAt.getTime() ||
    qa.data.assetEvidenceStatus !== "human_reviewed" ||
    (qa.data.runtimeStatus !== "internal_ready" && qa.data.runtimeStatus !== "published") ||
    qa.data.publicExposure.decision !== admission.qa.publicExposureDecision ||
    qa.data.sparkLoad.loadStatus !== "loaded" ||
    qa.data.checks.some((check) => check.status !== "passed")
  ) {
    return unavailable(scope, "qa_review_missing");
  }

  const transform = TransformArtifactV0Schema.safeParse(admission.transform.transformArtifact);
  if (
    !transform.success || admission.transform.artifactDigest === null ||
    runtimeTransformArtifactSha256(transform.data) !== admission.transform.artifactDigest ||
    admission.transform.transformArtifactId !== admission.admission.runtimeTransformArtifactId ||
    admission.transform.artifactDigest !== admission.admission.runtimeTransformArtifactDigest ||
    runtimeQaRecordSignedTransformArtifactId(qa.data) !== admission.transform.transformArtifactId ||
    runtimeQaRecordSignedTransformArtifactSha256(qa.data) !== admission.transform.artifactDigest ||
    new Date(transform.data.date) > admission.admission.reviewedAt ||
    admission.transform.createdAt > admission.admission.reviewedAt ||
    !isDirectHistoricalPresentationTransform(transform.data)
  ) {
    return unavailable(scope, "signed_transform_missing");
  }
  if (
    admission.scene.artifactKind !== "scene_authority_map_v0" ||
    admission.scene.artifactId !== admission.admission.sceneAuthorityArtifactId ||
    admission.scene.artifactDigest !== admission.admission.sceneAuthorityMapDigest ||
    admission.scene.registeredAt > admission.admission.reviewedAt ||
    admission.admission.reviewedAt > scope.frozenAt
  ) {
    return unavailable(scope, "provenance_incomplete");
  }

  const compositionDigest = phaseLayoutRuntimeCompositionDigest({
    runtimePackageId: pkg.id,
    runtimePackageContentDigest: pkg.contentDigest,
    reviewedProfileId: admission.admission.reviewedProfileId,
    transformArtifactDigest: admission.transform.artifactDigest,
    visualAssets,
  });
  return {
    availability: "available",
    presentationAdmissionId: admission.admission.id,
    presentationAdmissionDecision: "approved",
    presentationAdmissionReviewedAt: admission.admission.reviewedAt.toISOString(),
    presentationAdmissionDigest: admission.admission.admissionDigest,
    runtimePackageId: pkg.id,
    runtimePackageRevision: pkg.revision,
    runtimePackageContentDigest: pkg.contentDigest,
    runtimeManifestDigest: manifestDigest,
    runtimePackageEvidenceStatus: "human_reviewed",
    runtimePackageStatus: pkg.runtimeStatus,
    reviewedProfileId: admission.admission.reviewedProfileId,
    reviewedProfileManifestFingerprint: profileFingerprint,
    rightsEvidenceDigest: admission.admission.rightsEvidenceDigest,
    sceneAuthorityMapDigest: admission.admission.sceneAuthorityMapDigest,
    runtimeQaRecordId: admission.qa.id,
    runtimeQaRecordKey: admission.qa.recordId,
    runtimeQaRecordDigest: admission.qa.recordDigest,
    runtimeQaDecision: admission.qa.publicExposureDecision,
    runtimeQaReviewedBy: admission.qa.reviewedBy,
    runtimeQaReviewedAt: admission.qa.reviewedAt.toISOString(),
    transformArtifactRowId: admission.transform.id,
    transformArtifactId: admission.transform.transformArtifactId,
    transformArtifactDigest: admission.transform.artifactDigest,
    transformArtifact: transform.data,
    visualAssets,
    compositionDigest,
  };
}

export function runtimeAdmissionDecisionDigest(decision: RuntimeAdmissionDecision): string {
  return canonicalSha256("venviewer.phase-layout-runtime-admission-decision.v1\n", decision);
}

export function buildPhaseLayoutRuntimeBinding(
  decision: RuntimeAdmissionDecision,
  envelope: RuntimeBindingEnvelope,
): PhaseLayoutRuntimeBindingV1 {
  const common = {
    schemaVersion: "phase-layout-runtime-binding.v1" as const,
    // Migration 0063's immutable snapshot constraint admits only the legacy
    // policy token. Until a separate activation migration exists, preserve
    // that forensic identity while forcing every newly frozen binding into an
    // unavailable state below.
    admissionPolicy: "trades-hall-reviewed-presentation.v1" as const,
    bindingId: envelope.bindingId,
    phaseLayoutSnapshotId: envelope.bindingId,
    canonicalSnapshotId: envelope.canonicalSnapshotId,
    snapshotHash: envelope.snapshotHash,
    venueId: envelope.venueId,
    venueSlug: envelope.venueSlug,
    spaceId: envelope.spaceId,
    spaceSlug: envelope.spaceSlug,
    boundBy: envelope.boundBy,
    boundAt: envelope.boundAt.toISOString(),
  };
  const unsigned = decision.availability === "unavailable"
    ? {
        ...common,
        availability: "unavailable" as const,
        unavailableReason: decision.unavailableReason,
        expectedRuntimePackageId: decision.expectedRuntimePackageId,
        expectedRuntimeManifestDigest: decision.expectedRuntimeManifestDigest,
      }
    : {
        ...common,
        availability: "unavailable" as const,
        unavailableReason: "runtime_activation_missing" as const,
        expectedRuntimePackageId: decision.runtimePackageId,
        expectedRuntimeManifestDigest: decision.runtimeManifestDigest,
      };
  return PhaseLayoutRuntimeBindingV1Schema.parse({
    ...unsigned,
    bindingDigest: phaseLayoutRuntimeBindingDigest(unsigned),
  });
}

export function admissionDecisionFromBinding(
  binding: PhaseLayoutRuntimeBindingV1,
  _admission: {
    readonly id: string;
    readonly decision: "approved";
    readonly reviewedAt: Date;
    readonly digest: string;
  },
): RuntimeAdmissionDecision {
  if (binding.availability === "unavailable") {
    return {
      availability: "unavailable",
      unavailableReason: binding.unavailableReason,
      expectedRuntimePackageId: binding.expectedRuntimePackageId,
      expectedRuntimeManifestDigest: binding.expectedRuntimeManifestDigest,
    };
  }
  return {
    availability: "unavailable",
    unavailableReason: "runtime_activation_missing",
    expectedRuntimePackageId: binding.runtimePackageId,
    expectedRuntimeManifestDigest: binding.runtimeManifestDigest,
  };
}
