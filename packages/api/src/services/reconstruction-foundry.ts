import { randomUUID } from "node:crypto";
import {
  CanonicalJsonValueSchema,
  RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION,
  RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
  RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
  RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
  ReconstructionQaReportSchema,
  ReconstructionReviewEvidenceArtifactListSchema,
  ReconstructionReviewEvidenceArtifactSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  TWIN_EQUIRECT_LODS,
  TWIN_FACES,
  TWIN_LODS,
  TwinManifestSchema,
  ReconstructionReleaseAttestationMetadataSchema,
  ReconstructionReleaseChannelEventSchema,
  ReconstructionReleaseChannelSchema,
  ReconstructionReleaseDetailSchema,
  ReconstructionReleaseListSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleasePublicationSchema,
  ReconstructionReleasePublicActiveDescriptorSchema,
  ReconstructionReleaseRegistrationSchema,
  ReconstructionReleaseReviewSchema,
  ReconstructionReleaseSigningPayloadSchema,
  ReconstructionReleaseSigningStatementSchema,
  computeReconstructionReleaseReviewDigest,
  canonicalReconstructionReviewEvidenceArtifact,
  computeReconstructionReviewEvidenceArtifactDigest,
  parseReconstructionReviewEvidenceArtifact,
  reconstructionReviewEvidenceArtifactId,
  reconstructionReviewEvidenceArtifactSchemaVersion,
  sha256Hex,
  stableCanonicalJson,
  type ReconstructionCandidateVerificationInput,
  type ReconstructionDsseEnvelope,
  type ReconstructionQaReport,
  type ReconstructionReviewEvidenceArtifact,
  type ReconstructionReviewEvidenceArtifactBody,
  type ReconstructionReviewEvidenceArtifactKind,
  type ReconstructionReviewEvidenceArtifactList,
  type ReconstructionReviewEvidenceArtifactRegistrationInput,
  type ReconstructionSceneAuthorityMapV0,
  type ReconstructionReleaseAttestationMetadata,
  type ReconstructionReleaseAttestationVerificationInput,
  type ReconstructionReleaseChannel,
  type ReconstructionReleaseChannelEvent,
  type ReconstructionReleaseDetail,
  type ReconstructionReleaseKind,
  type ReconstructionReleaseList,
  type ReconstructionReleaseManifest,
  type ReconstructionReleasePromoteInput,
  type ReconstructionReleasePublication,
  type ReconstructionReleasePublicationInput,
  type ReconstructionReleasePublicActiveDescriptor,
  type ReconstructionReleaseRegistration,
  type ReconstructionReleaseReview,
  type ReconstructionReleaseReviewInput,
  type ReconstructionReleaseReviewMaterial,
  type ReconstructionReleaseArtifactRef,
  type ReconstructionReleaseRollbackInput,
  type ReconstructionReleaseSigningPayload,
  type ReconstructionReleaseSigningStatement,
  type ReconstructionReleaseState,
  type ReconstructionVisualEvidence,
  type RuntimeSlug,
  type TwinManifest,
  twinEquirectPath,
  twinTilePath,
} from "@omnitwin/types";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  reconstructionReleaseAttestations,
  reconstructionReleaseChannelEvents,
  reconstructionReleaseChannels,
  reconstructionReleasePublications,
  reconstructionReleaseQaRuns,
  reconstructionReleaseReviews,
  reconstructionReleases,
  reconstructionReviewEvidenceArtifacts,
} from "../db/schema.js";

type ReleaseRow = typeof reconstructionReleases.$inferSelect;
type QaRow = typeof reconstructionReleaseQaRuns.$inferSelect;
type ReviewRow = typeof reconstructionReleaseReviews.$inferSelect;
type AttestationRow = typeof reconstructionReleaseAttestations.$inferSelect;
type PublicationRow = typeof reconstructionReleasePublications.$inferSelect;
type ChannelRow = typeof reconstructionReleaseChannels.$inferSelect;
type ChannelEventRow = typeof reconstructionReleaseChannelEvents.$inferSelect;
type ReviewEvidenceArtifactRow = typeof reconstructionReviewEvidenceArtifacts.$inferSelect;

type FoundryDatabase = Pick<Database, "execute" | "insert" | "select" | "update">;

const RELEASE_KIND: ReconstructionReleaseKind = "venue_twin_v1";
const CHANNEL = "production";
const MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_VISUAL_EVIDENCE_PREVIEW_BYTES = 8 * 1024 * 1024;

export interface VerifiedReconstructionCandidate {
  readonly candidateBucket: string;
  readonly candidateR2Prefix: string;
  readonly candidateManifestR2Key: string;
  readonly qaReportR2Key: string;
  readonly releaseManifestSha256: string;
  readonly manifest: ReconstructionReleaseManifest;
  readonly qaReport: ReconstructionQaReport;
}

/**
 * This boundary must read the private candidate objects back, recompute every
 * digest and deterministic QA check, and return only verified evidence. The
 * API never accepts a manifest or QA result asserted by the browser.
 */
export interface ReconstructionCandidateVerifier {
  verifyCandidate(
    input: ReconstructionCandidateVerificationInput,
  ): Promise<VerifiedReconstructionCandidate>;
}

export interface ReconstructionPrivateEvidenceObjectInput {
  readonly key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly maxBytes: number;
}

/** Private immutable byte access used only for exact review evidence. */
export interface ReconstructionPrivateEvidenceStore {
  putIfAbsentAndVerify(input: ReconstructionPrivateEvidenceObjectInput & {
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }): Promise<"created" | "exists">;
  readVerified(input: ReconstructionPrivateEvidenceObjectInput): Promise<Uint8Array>;
}

export interface VerifyAndStoreReconstructionAttestationInput {
  readonly signingPayload: ReconstructionReleaseSigningPayload;
  readonly envelope: ReconstructionDsseEnvelope;
  readonly canonicalEnvelopeBytes: Uint8Array;
  readonly expectedEnvelopeSha256: string;
  readonly expectedPrivateR2Key: string;
}

export interface VerifiedStoredReconstructionAttestation {
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly qaReportDigest: string;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly payloadSha256: string;
  readonly envelopeSha256: string;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly r2Key: string;
  readonly verifiedAt: string;
}

/**
 * Implementations must verify DSSE PAE with a configured trusted Ed25519
 * public key, require the exact payload bytes supplied here, and perform an
 * immutable private-object put/readback before returning. It never signs.
 */
export interface ReconstructionAttestationVerifier {
  verifyAndStoreAttestation(
    input: VerifyAndStoreReconstructionAttestationInput,
  ): Promise<VerifiedStoredReconstructionAttestation>;
  reverifyStoredAttestation(input: {
    readonly signingPayload: ReconstructionReleaseSigningPayload;
    readonly metadata: ReconstructionReleaseAttestationMetadata;
  }): Promise<void>;
}

export interface PublishReconstructionReleaseInput {
  readonly registration: ReconstructionReleaseRegistration;
  readonly review: ReconstructionReleaseReview;
  readonly attestation: ReconstructionReleaseAttestationMetadata;
  readonly publicR2Prefix: string;
  readonly publicManifestR2Key: string;
}

export interface VerifiedReconstructionPublication {
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly qaReportDigest: string;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly attestationId: string;
  readonly attestationEnvelopeSha256: string;
  readonly candidateR2Prefix: string;
  readonly releaseBucket: string;
  readonly publicR2Prefix: string;
  readonly publicManifestR2Key: string;
  readonly publicBaseUrl: string;
  readonly publicManifestUrl: string;
  readonly manifestSha256: string;
  readonly verificationDigest: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly publishedAt: string;
  readonly verifiedAt: string;
}

/** Copies verified bytes to immutable digest-addressed public storage and readback-verifies them. */
export interface ReconstructionReleasePublisher {
  publishRelease(
    input: PublishReconstructionReleaseInput,
  ): Promise<VerifiedReconstructionPublication>;
}

export interface ReconstructionFoundryDependencies {
  readonly db: Database;
  readonly candidateVerifier?: ReconstructionCandidateVerifier;
  readonly attestationVerifier?: ReconstructionAttestationVerifier;
  readonly publisher?: ReconstructionReleasePublisher;
  readonly privateEvidenceStore?: ReconstructionPrivateEvidenceStore;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export class ReconstructionFoundryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconstructionFoundryNotFoundError";
  }
}

export class ReconstructionFoundryIdempotencyError extends Error {
  constructor(message = "The idempotency key was already used for a different request.") {
    super(message);
    this.name = "ReconstructionFoundryIdempotencyError";
  }
}

export class ReconstructionFoundryEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconstructionFoundryEvidenceError";
  }
}

export class ReconstructionFoundryEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconstructionFoundryEligibilityError";
  }
}

export class ReconstructionFoundryRevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly currentReleaseId: string | null;

  constructor(currentRevision: number, currentReleaseId: string | null) {
    super("The production channel changed; refresh it before trying again.");
    this.name = "ReconstructionFoundryRevisionConflictError";
    this.currentRevision = currentRevision;
    this.currentReleaseId = currentReleaseId;
  }
}

export class ReconstructionFoundryIntegrationUnavailableError extends Error {
  constructor(integration: string) {
    super(`${integration} is not configured.`);
    this.name = "ReconstructionFoundryIntegrationUnavailableError";
  }
}

export class ReconstructionFoundryProviderError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`${operation} provider is temporarily unavailable.`, { cause });
    this.name = "ReconstructionFoundryProviderError";
  }
}

function isCoreFoundryIntegrityError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "FoundryIntegrityError";
}

async function callFoundryProvider<T>(
  operation: string,
  evidenceFailureMessage: string,
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error: unknown) {
    if (
      error instanceof ReconstructionFoundryEvidenceError ||
      error instanceof ReconstructionFoundryEligibilityError ||
      error instanceof ReconstructionFoundryIntegrationUnavailableError ||
      error instanceof ReconstructionFoundryProviderError
    ) {
      throw error;
    }
    if (isCoreFoundryIntegrityError(error)) {
      throw new ReconstructionFoundryEvidenceError(evidenceFailureMessage);
    }
    throw new ReconstructionFoundryProviderError(operation, error);
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function canonicalJson(value: unknown): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
}

function digestJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function publicPrefix(releaseDigest: string): string {
  return `releases/sha256/${releaseDigest.slice(0, 2)}/${releaseDigest}`;
}

function attestationKey(candidatePrefix: string, envelopeSha256: string): string {
  return `${candidatePrefix}/attestations/${envelopeSha256}.dsse.json`;
}

function initialState(qa: ReconstructionQaReport): ReconstructionReleaseState {
  return qa.outcome === "passed" ? "awaiting_review" : "machine_qa_failed";
}

export function reconstructionVisualEvidenceExistsInManifest(
  manifest: ReconstructionReleaseManifest,
  visualEvidence: readonly ReconstructionVisualEvidence[],
): boolean {
  return visualEvidence.every((item) => manifest.files.some((file) =>
    file.path === item.objectKey &&
    file.sha256 === item.sha256 &&
    file.role === "imagery" &&
    file.mimeType === "image/webp" &&
    file.sizeBytes <= MAX_VISUAL_EVIDENCE_PREVIEW_BYTES
  ));
}

function serializeReviewEvidenceArtifact(
  row: ReviewEvidenceArtifactRow,
): ReconstructionReviewEvidenceArtifact {
  return ReconstructionReviewEvidenceArtifactSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    artifactKind: row.artifactKind,
    artifactId: row.artifactId,
    artifactDigest: row.artifactDigest,
    objectKey: row.objectKey,
    objectSha256: row.objectSha256,
    sizeBytes: row.sizeBytes,
    schemaVersion: row.schemaVersion,
    registeredBy: row.registeredBy,
    registeredAt: iso(row.registeredAt),
  });
}

function sceneAuthorityReleaseFilePaths(
  map: ReconstructionSceneAuthorityMapV0,
): readonly string[] {
  const paths: string[] = [];
  for (const region of map.regions) {
    for (const authority of Object.values(region.authorities)) {
      if (authority.kind === "release_file") paths.push(authority.ref);
    }
  }
  return paths;
}

function sameArtifactRef(
  left: ReconstructionReleaseArtifactRef,
  right: ReconstructionReleaseArtifactRef,
): boolean {
  return left.artifactId === right.artifactId && left.artifactDigest === right.artifactDigest;
}

function assertSceneAuthorityCoversRelease(input: {
  readonly map: ReconstructionSceneAuthorityMapV0;
  readonly twin: TwinManifest;
  readonly release: ReconstructionReleaseManifest;
  readonly selectedTransform: ReconstructionReleaseArtifactRef;
}): void {
  const nodes = new Map(input.twin.nodes.map((node) => [node.id, node]));
  const coveredNodeIds = new Set<string>();
  const releaseFiles = new Map(input.release.files.map((file) => [file.path, file]));
  for (const region of input.map.regions) {
    if (!sameArtifactRef(region.transformArtifactRef, input.selectedTransform)) {
      throw new ReconstructionFoundryEvidenceError(
        `Scene Authority region ${region.id} is not bound to the selected TransformArtifact.`,
      );
    }
    if (region.scope.kind === "whole_venue") {
      for (const nodeId of nodes.keys()) coveredNodeIds.add(nodeId);
    } else if (region.scope.kind === "twin_nodes") {
      for (const nodeId of region.scope.nodeIds) {
        if (!nodes.has(nodeId)) {
          throw new ReconstructionFoundryEvidenceError(
            `Scene Authority region ${region.id} references an unknown Twin node: ${nodeId}.`,
          );
        }
        coveredNodeIds.add(nodeId);
      }
    } else {
      let boundedNodeCount = 0;
      for (const node of nodes.values()) {
        const [x, y, z] = node.pose.t;
        if (
          x >= region.scope.min[0] && x <= region.scope.max[0] &&
          y >= region.scope.min[1] && y <= region.scope.max[1] &&
          z >= region.scope.min[2] && z <= region.scope.max[2]
        ) {
          boundedNodeCount += 1;
          coveredNodeIds.add(node.id);
        }
      }
      if (boundedNodeCount === 0) {
        throw new ReconstructionFoundryEvidenceError(
          `Scene Authority region ${region.id} bounds cover no Twin nodes.`,
        );
      }
    }

    for (const authority of Object.values(region.authorities)) {
      if (authority.kind !== "release_file" && authority.kind !== "none") {
        throw new ReconstructionFoundryEvidenceError(
          `Scene Authority region ${region.id} uses unresolved ${authority.kind} evidence.`,
        );
      }
    }
    const requiredAuthorities = [
      ["geometry", region.authorities.geometryAuthority, new Set(["geometry"])],
      ["appearance", region.authorities.appearanceAuthority, new Set(["imagery"])],
      ["semantic", region.authorities.semanticAuthority, new Set(["manifest", "geometry"])],
      ["interaction", region.authorities.interactionAuthority, new Set(["manifest", "geometry"])],
    ] as const;
    for (const [label, authority, allowedRoles] of requiredAuthorities) {
      if (authority.kind !== "release_file") {
        throw new ReconstructionFoundryEvidenceError(
          `Scene Authority region ${region.id} needs a release-backed ${label} authority.`,
        );
      }
      const file = releaseFiles.get(authority.ref);
      if (file === undefined || !allowedRoles.has(file.role)) {
        throw new ReconstructionFoundryEvidenceError(
          `Scene Authority region ${region.id} has an invalid ${label} release-file authority.`,
        );
      }
    }
  }
  if (coveredNodeIds.size !== nodes.size) {
    const missing = [...nodes.keys()].filter((id) => !coveredNodeIds.has(id));
    throw new ReconstructionFoundryEvidenceError(
      `Scene Authority Map does not cover every Twin node; missing ${missing.slice(0, 10).join(", ")}.`,
    );
  }
}

function assertVisualEvidenceCoversTwin(
  twin: TwinManifest,
  visualEvidence: readonly ReconstructionVisualEvidence[],
): void {
  const reviewedPaths = new Set(visualEvidence.map((evidence) => evidence.objectKey));
  const expectedPaths = twin.imagery === "equirect"
    ? twin.nodes.map((node) => twinEquirectPath(node.id, TWIN_EQUIRECT_LODS[0]))
    : twin.nodes.flatMap((node) => TWIN_FACES.map((face) =>
      twinTilePath(node.id, face, TWIN_LODS[0])
    ));
  const missing = expectedPaths.filter((path) => !reviewedPaths.has(path));
  if (missing.length > 0) {
    throw new ReconstructionFoundryEvidenceError(
      `Public approval must bind the complete low-LOD visual review board; ${String(missing.length)} image(s) are missing.`,
    );
  }
}

function reviewMaterial(row: ReviewRow): ReconstructionReleaseReviewMaterial {
  return {
    releaseId: row.releaseId,
    releaseDigest: row.releaseDigest,
    qaReportDigest: row.qaReportDigest,
    decision: row.decision,
    targetExposure: row.targetExposure,
    visualEvidence: [...row.visualEvidence],
    transformArtifactRef: row.transformArtifactRefs[0] ?? null,
    sceneAuthorityMapRef: row.sceneAuthorityRefs[0] ?? null,
    note: row.note,
    idempotencyKey: row.idempotencyKey,
    id: row.id,
    reviewerUserId: row.reviewerUserId,
    reviewerAuthority: row.reviewerAuthority,
    reviewedAt: iso(row.reviewedAt),
  };
}

function serializeReview(row: ReviewRow): ReconstructionReleaseReview {
  const material = reviewMaterial(row);
  const reviewDigest = computeReconstructionReleaseReviewDigest(material);
  if (reviewDigest !== row.requestDigest) {
    throw new ReconstructionFoundryEvidenceError(
      `Persisted review ${row.id} does not match its immutable digest.`,
    );
  }
  return ReconstructionReleaseReviewSchema.parse({ ...material, reviewDigest });
}

function reviewInput(review: ReconstructionReleaseReview): ReconstructionReleaseReviewInput {
  return {
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
  };
}

function serializeAttestation(row: AttestationRow): ReconstructionReleaseAttestationMetadata {
  return ReconstructionReleaseAttestationMetadataSchema.parse({
    id: row.id,
    releaseId: row.releaseId,
    releaseDigest: row.releaseDigest,
    qaReportDigest: row.qaReportDigest,
    reviewId: row.reviewId,
    reviewDigest: row.reviewDigest,
    format: "dsse_in_toto_v1",
    algorithm: "ed25519",
    keyId: row.keyId,
    publicKeyFingerprint: row.publicKeyFingerprint,
    statementSha256: row.statementSha256,
    envelopeSha256: row.envelopeSha256,
    r2Key: row.r2Key,
    verifiedAt: iso(row.verifiedAt),
    verifiedBy: row.verifiedBy,
  });
}

function serializePublication(row: PublicationRow): ReconstructionReleasePublication {
  return ReconstructionReleasePublicationSchema.parse({
    id: row.id,
    releaseId: row.releaseId,
    releaseDigest: row.releaseDigest,
    qaReportDigest: row.qaReportDigest,
    reviewId: row.reviewId,
    reviewDigest: row.reviewDigest,
    attestationId: row.attestationId,
    attestationEnvelopeSha256: row.attestationEnvelopeSha256,
    idempotencyKey: row.idempotencyKey,
    note: row.note,
    candidateR2Prefix: row.candidatePrefix,
    publicR2Prefix: row.releasePrefix,
    publicManifestR2Key: row.publicManifestKey,
    publicManifestUrl: row.manifestUrl,
    manifestSha256: row.manifestSha256,
    fileCount: row.objectCount,
    totalBytes: row.totalBytes,
    publishedBy: row.publishedBy,
    publishedAt: iso(row.publishedAt),
    verifiedAt: iso(row.verifiedAt),
  });
}

function serializeChannel(row: ChannelRow): ReconstructionReleaseChannel {
  return ReconstructionReleaseChannelSchema.parse({
    venueSlug: row.venueSlug,
    releaseKind: row.releaseKind,
    channel: row.channel,
    activeReleaseId: row.activeReleaseId,
    activeReleaseDigest: row.activeReleaseDigest,
    activePublicationId: row.activePublicationId,
    revision: row.revision,
    updatedBy: row.updatedBy,
    updatedAt: iso(row.updatedAt),
  });
}

function serializeChannelEvent(row: ChannelEventRow): ReconstructionReleaseChannelEvent {
  return ReconstructionReleaseChannelEventSchema.parse({
    id: row.id,
    venueSlug: row.venueSlug,
    releaseKind: row.releaseKind,
    channel: row.channel,
    action: row.action,
    fromReleaseId: row.fromReleaseId,
    fromReleaseDigest: row.fromReleaseDigest,
    fromPublicationId: row.fromPublicationId,
    toReleaseId: row.toReleaseId,
    toReleaseDigest: row.toReleaseDigest,
    toPublicationId: row.toPublicationId,
    expectedRevision: row.expectedRevision,
    resultingRevision: row.resultingRevision,
    actorUserId: row.actorUserId,
    idempotencyKey: row.idempotencyKey,
    reason: row.reason,
    createdAt: iso(row.createdAt),
  });
}

async function releaseById(db: FoundryDatabase, releaseId: string): Promise<ReleaseRow | null> {
  const [row] = await db
    .select()
    .from(reconstructionReleases)
    .where(eq(reconstructionReleases.id, releaseId))
    .limit(1);
  return row ?? null;
}

async function qaForRelease(db: FoundryDatabase, releaseId: string): Promise<QaRow | null> {
  const [row] = await db
    .select()
    .from(reconstructionReleaseQaRuns)
    .where(eq(reconstructionReleaseQaRuns.releaseId, releaseId))
    .orderBy(desc(reconstructionReleaseQaRuns.createdAt), desc(reconstructionReleaseQaRuns.id))
    .limit(1);
  return row ?? null;
}

async function reviewsForRelease(db: FoundryDatabase, releaseId: string): Promise<ReviewRow[]> {
  const rows = await db
    .select()
    .from(reconstructionReleaseReviews)
    .where(eq(reconstructionReleaseReviews.releaseId, releaseId));
  if (rows.length === 0) return rows;
  if (rows.length === 1) {
    if (rows[0]?.reviewSequence !== 1 || rows[0]?.supersedesReviewId !== null) {
      throw new ReconstructionFoundryEvidenceError(`Release ${releaseId} has an invalid root review.`);
    }
    return rows;
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const supersededIds = new Set<string>();
  for (const row of rows) {
    if (row.supersedesReviewId === null) continue;
    if (!rowsById.has(row.supersedesReviewId) || supersededIds.has(row.supersedesReviewId)) {
      throw new ReconstructionFoundryEvidenceError(
        `Release ${releaseId} has an invalid or branching review supersession chain.`,
      );
    }
    supersededIds.add(row.supersedesReviewId);
  }
  const heads = rows.filter((row) => !supersededIds.has(row.id));
  if (heads.length !== 1) {
    throw new ReconstructionFoundryEvidenceError(
      `Release ${releaseId} must have exactly one current review-chain head.`,
    );
  }
  const ordered: ReviewRow[] = [];
  const visited = new Set<string>();
  let current: ReviewRow | undefined = heads[0];
  while (current !== undefined) {
    if (visited.has(current.id)) {
      throw new ReconstructionFoundryEvidenceError(`Release ${releaseId} has a cyclic review chain.`);
    }
    const expectedSequence = rows.length - ordered.length;
    if (current.reviewSequence !== expectedSequence) {
      throw new ReconstructionFoundryEvidenceError(
        `Release ${releaseId} has a non-contiguous review sequence.`,
      );
    }
    visited.add(current.id);
    ordered.push(current);
    current = current.supersedesReviewId === null
      ? undefined
      : rowsById.get(current.supersedesReviewId);
  }
  if (ordered.length !== rows.length) {
    throw new ReconstructionFoundryEvidenceError(
      `Release ${releaseId} has disconnected review evidence.`,
    );
  }
  return ordered;
}

async function attestationsForRelease(
  db: FoundryDatabase,
  releaseId: string,
): Promise<AttestationRow[]> {
  return db
    .select()
    .from(reconstructionReleaseAttestations)
    .where(eq(reconstructionReleaseAttestations.releaseId, releaseId))
    .orderBy(
      desc(reconstructionReleaseAttestations.verifiedAt),
      desc(reconstructionReleaseAttestations.id),
    );
}

async function publicationForRelease(
  db: FoundryDatabase,
  releaseId: string,
): Promise<PublicationRow | null> {
  const [row] = await db
    .select()
    .from(reconstructionReleasePublications)
    .where(eq(reconstructionReleasePublications.releaseId, releaseId))
    .orderBy(
      desc(reconstructionReleasePublications.publishedAt),
      desc(reconstructionReleasePublications.id),
    )
    .limit(1);
  return row ?? null;
}

async function publicationForEvidence(
  db: FoundryDatabase,
  releaseId: string,
  reviewId: string,
  attestationId: string,
): Promise<PublicationRow | null> {
  const [row] = await db
    .select()
    .from(reconstructionReleasePublications)
    .where(and(
      eq(reconstructionReleasePublications.releaseId, releaseId),
      eq(reconstructionReleasePublications.reviewId, reviewId),
      eq(reconstructionReleasePublications.attestationId, attestationId),
    ))
    .orderBy(
      desc(reconstructionReleasePublications.publishedAt),
      desc(reconstructionReleasePublications.id),
    )
    .limit(1);
  return row ?? null;
}

async function channelForScope(
  db: FoundryDatabase,
  venueSlug: string,
  releaseKind: ReconstructionReleaseKind,
): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(reconstructionReleaseChannels)
    .where(and(
      eq(reconstructionReleaseChannels.venueSlug, venueSlug),
      eq(reconstructionReleaseChannels.releaseKind, releaseKind),
      eq(reconstructionReleaseChannels.channel, CHANNEL),
    ))
    .limit(1);
  return row ?? null;
}

async function lockRelease(db: FoundryDatabase, releaseId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${releaseId}, 0))`);
}

function serializeRegistration(
  release: ReleaseRow,
  qa: QaRow,
): ReconstructionReleaseRegistration {
  return ReconstructionReleaseRegistrationSchema.parse({
    id: release.id,
    manifest: release.manifestJson,
    candidateR2Prefix: release.candidatePrefix,
    candidateManifestR2Key: release.releaseManifestKey,
    qaReport: qa.reportJson,
    idempotencyKey: release.idempotencyKey,
    state: initialState(qa.reportJson),
    registeredBy: release.createdBy,
    registeredAt: iso(release.createdAt),
  });
}

function matchingAttestation(
  review: ReconstructionReleaseReview | null,
  attestations: readonly ReconstructionReleaseAttestationMetadata[],
): ReconstructionReleaseAttestationMetadata | null {
  if (review === null || review.decision !== "approved" || review.targetExposure !== "public") {
    return null;
  }
  return attestations.find((attestation) =>
    attestation.reviewId === review.id &&
    attestation.reviewDigest === review.reviewDigest &&
    attestation.releaseDigest === review.releaseDigest &&
    attestation.qaReportDigest === review.qaReportDigest
  ) ?? null;
}

export function deriveReconstructionReleaseState(input: {
  readonly qaOutcome: "passed" | "failed";
  readonly latestReview: ReconstructionReleaseReview | null;
  readonly matchingAttestation: ReconstructionReleaseAttestationMetadata | null;
  readonly matchingPublication: ReconstructionReleasePublication | null;
  readonly productionChannel: ReconstructionReleaseChannel | null;
  readonly releaseId: string;
}): ReconstructionReleaseState {
  if (input.qaOutcome === "failed") return "machine_qa_failed";
  if (input.latestReview === null) return "awaiting_review";
  if (input.latestReview.decision === "rejected") return "rejected";
  if (input.latestReview.targetExposure === "expert_review") return "expert_reviewed";
  if (input.matchingAttestation === null) return "awaiting_attestation";
  if (input.matchingPublication === null) return "ready_to_publish";
  if (
    input.productionChannel?.activeReleaseId === input.releaseId &&
    input.productionChannel.activePublicationId === input.matchingPublication.id
  ) {
    return "active";
  }
  return "published";
}

interface LoadedReleaseEvidence {
  readonly release: ReleaseRow;
  readonly qa: QaRow;
  readonly reviews: readonly ReviewRow[];
  readonly attestations: readonly AttestationRow[];
  readonly publication: PublicationRow | null;
  readonly channel: ChannelRow | null;
}

async function loadReleaseEvidence(
  db: FoundryDatabase,
  releaseId: string,
): Promise<LoadedReleaseEvidence> {
  const release = await releaseById(db, releaseId);
  if (release === null) {
    throw new ReconstructionFoundryNotFoundError("Reconstruction release not found.");
  }
  // Keep these reads sequential: Neon transactions use a single WebSocket
  // connection and must not have concurrent statements in flight.
  const qa = await qaForRelease(db, release.id);
  const reviews = await reviewsForRelease(db, release.id);
  const attestations = await attestationsForRelease(db, release.id);
  const publication = await publicationForRelease(db, release.id);
  const channel = await channelForScope(db, release.venueSlug, release.releaseKind);
  if (qa === null) {
    throw new ReconstructionFoundryEvidenceError(
      `Release ${release.id} has no immutable machine-QA record.`,
    );
  }
  return { release, qa, reviews, attestations, publication, channel };
}

export function currentReconstructionPublication(
  publication: ReconstructionReleasePublication | null,
  review: ReconstructionReleaseReview | null,
  attestation: ReconstructionReleaseAttestationMetadata | null,
): ReconstructionReleasePublication | null {
  if (
    publication === null ||
    review === null ||
    attestation === null ||
    publication.reviewId !== review.id ||
    publication.reviewDigest !== review.reviewDigest ||
    publication.attestationId !== attestation.id ||
    publication.attestationEnvelopeSha256 !== attestation.envelopeSha256
  ) {
    return null;
  }
  return publication;
}

export interface ReconstructionChannelTransitionTarget {
  readonly venueSlug: RuntimeSlug;
  readonly releaseKind: ReconstructionReleaseKind;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly publicationId: string;
}

export type ReconstructionChannelTransitionPlan =
  | {
    readonly kind: "idempotent";
    readonly event: ReconstructionReleaseChannelEvent;
  }
  | {
    readonly kind: "advance";
    readonly channel: ReconstructionReleaseChannel;
    readonly event: ReconstructionReleaseChannelEvent;
  };

export function planReconstructionChannelTransition(input: {
  readonly action: "promote" | "rollback";
  readonly request: ReconstructionReleasePromoteInput | ReconstructionReleaseRollbackInput;
  readonly requestDigest: string;
  readonly actorUserId: string;
  readonly target: ReconstructionChannelTransitionTarget;
  readonly targetEligible: boolean;
  readonly currentChannel: ReconstructionReleaseChannel | null;
  readonly idempotent: {
    readonly event: ReconstructionReleaseChannelEvent;
    readonly requestDigest: string;
  } | null;
  readonly rollbackTargetWasActive: boolean;
  readonly eventId: string;
  readonly updatedAt: string;
}): ReconstructionChannelTransitionPlan {
  if (input.idempotent !== null) {
    if (
      input.idempotent.requestDigest !== input.requestDigest ||
      input.idempotent.event.actorUserId !== input.actorUserId ||
      input.idempotent.event.idempotencyKey !== input.request.idempotencyKey
    ) {
      throw new ReconstructionFoundryIdempotencyError();
    }
    return { kind: "idempotent", event: input.idempotent.event };
  }
  if (!input.targetEligible) {
    throw new ReconstructionFoundryEligibilityError(
      "The target release is not currently eligible for production.",
    );
  }
  if (
    input.request.targetReleaseId !== input.target.releaseId ||
    input.request.targetReleaseDigest !== input.target.releaseDigest ||
    input.request.targetPublicationId !== input.target.publicationId
  ) {
    throw new ReconstructionFoundryEvidenceError(
      "The channel transition does not identify the eligible release publication exactly.",
    );
  }
  const current = input.currentChannel;
  if (
    current === null &&
    (input.request.expectedRevision !== 0 || input.request.expectedActiveReleaseId !== null)
  ) {
    throw new ReconstructionFoundryRevisionConflictError(0, null);
  }
  if (
    current !== null &&
    (
      current.revision !== input.request.expectedRevision ||
      current.activeReleaseId !== input.request.expectedActiveReleaseId
    )
  ) {
    throw new ReconstructionFoundryRevisionConflictError(
      current.revision,
      current.activeReleaseId,
    );
  }
  if (current?.activeReleaseId === input.target.releaseId) {
    throw new ReconstructionFoundryEligibilityError(
      "The target release is already active on the production channel.",
    );
  }
  if (input.action === "rollback" && (current === null || !input.rollbackTargetWasActive)) {
    throw new ReconstructionFoundryEligibilityError(
      current === null
        ? "Rollback requires an active source release."
        : "Rollback target was never active on this production channel.",
    );
  }
  const resultingRevision = input.request.expectedRevision + 1;
  const channel = ReconstructionReleaseChannelSchema.parse({
    venueSlug: input.target.venueSlug,
    releaseKind: input.target.releaseKind,
    channel: CHANNEL,
    activeReleaseId: input.target.releaseId,
    activeReleaseDigest: input.target.releaseDigest,
    activePublicationId: input.target.publicationId,
    revision: resultingRevision,
    updatedBy: input.actorUserId,
    updatedAt: input.updatedAt,
  });
  const event = ReconstructionReleaseChannelEventSchema.parse({
    id: input.eventId,
    venueSlug: input.target.venueSlug,
    releaseKind: input.target.releaseKind,
    channel: CHANNEL,
    action: input.action,
    fromReleaseId: current?.activeReleaseId ?? null,
    fromReleaseDigest: current?.activeReleaseDigest ?? null,
    fromPublicationId: current?.activePublicationId ?? null,
    toReleaseId: input.target.releaseId,
    toReleaseDigest: input.target.releaseDigest,
    toPublicationId: input.target.publicationId,
    expectedRevision: input.request.expectedRevision,
    resultingRevision,
    actorUserId: input.actorUserId,
    idempotencyKey: input.request.idempotencyKey,
    reason: input.request.reason,
    createdAt: input.updatedAt,
  });
  return { kind: "advance", channel, event };
}

export function buildActiveReconstructionReleaseDescriptor(input: {
  readonly requestedVenueSlug: RuntimeSlug;
  readonly requestedReleaseKind: ReconstructionReleaseKind;
  readonly eligible: boolean;
  readonly channel: ReconstructionReleaseChannel;
  readonly release: {
    readonly id: string;
    readonly venueSlug: RuntimeSlug;
    readonly releaseKind: ReconstructionReleaseKind;
    readonly releaseDigest: string;
  };
  readonly publication: ReconstructionReleasePublication;
  readonly publicBaseUrl: string;
}): ReconstructionReleasePublicActiveDescriptor {
  if (
    !input.eligible ||
    input.release.venueSlug !== input.requestedVenueSlug ||
    input.channel.venueSlug !== input.requestedVenueSlug ||
    input.channel.activeReleaseId !== input.release.id ||
    input.channel.activeReleaseDigest !== input.release.releaseDigest ||
    input.channel.activePublicationId !== input.publication.id ||
    input.publication.releaseId !== input.release.id ||
    input.publication.releaseDigest !== input.release.releaseDigest
  ) {
    throw new ReconstructionFoundryEligibilityError(
      "The active pointer does not resolve to an eligible immutable publication.",
    );
  }
  return ReconstructionReleasePublicActiveDescriptorSchema.parse({
    schemaVersion: RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION,
    venueSlug: input.requestedVenueSlug,
    releaseKind: input.requestedReleaseKind,
    channel: CHANNEL,
    releaseId: input.channel.activeReleaseId,
    releaseDigest: input.channel.activeReleaseDigest,
    publicationId: input.channel.activePublicationId,
    manifestSha256: input.publication.manifestSha256,
    manifestUrl: input.publication.publicManifestUrl,
    assetBaseUrl: input.publicBaseUrl,
    channelRevision: input.channel.revision,
  });
}

async function detailFromEvidence(
  db: FoundryDatabase,
  evidence: LoadedReleaseEvidence,
): Promise<ReconstructionReleaseDetail> {
  const registration = serializeRegistration(evidence.release, evidence.qa);
  const reviews = evidence.reviews.map(serializeReview);
  const attestations = evidence.attestations.map(serializeAttestation);
  const publication = evidence.publication === null
    ? null
    : serializePublication(evidence.publication);
  const productionChannel = evidence.channel === null ? null : serializeChannel(evidence.channel);
  const latestReview = reviews[0] ?? null;
  const attestation = matchingAttestation(latestReview, attestations);
  const currentPublication = currentReconstructionPublication(publication, latestReview, attestation);
  const state = deriveReconstructionReleaseState({
    qaOutcome: evidence.qa.outcome,
    latestReview,
    matchingAttestation: attestation,
    matchingPublication: currentPublication,
    productionChannel,
    releaseId: evidence.release.id,
  });
  const eventRows = evidence.channel === null
    ? []
    : await db
      .select()
      .from(reconstructionReleaseChannelEvents)
      .where(and(
        eq(reconstructionReleaseChannelEvents.channelId, evidence.channel.id),
        or(
          eq(reconstructionReleaseChannelEvents.fromReleaseId, evidence.release.id),
          eq(reconstructionReleaseChannelEvents.toReleaseId, evidence.release.id),
        ),
      ))
      .orderBy(
        desc(reconstructionReleaseChannelEvents.resultingRevision),
        desc(reconstructionReleaseChannelEvents.id),
      );
  return ReconstructionReleaseDetailSchema.parse({
    registration,
    reviews,
    attestations,
    publication: currentPublication,
    productionChannel,
    channelEvents: eventRows.map(serializeChannelEvent),
    state,
  });
}

interface EligibleRelease {
  readonly evidence: LoadedReleaseEvidence;
  readonly registration: ReconstructionReleaseRegistration;
  readonly review: ReconstructionReleaseReview;
  readonly attestation: ReconstructionReleaseAttestationMetadata;
  readonly publication: ReconstructionReleasePublication;
  readonly publicationRow: PublicationRow;
}

interface PublishableRelease {
  readonly evidence: LoadedReleaseEvidence;
  readonly registration: ReconstructionReleaseRegistration;
  readonly review: ReconstructionReleaseReview;
  readonly attestation: ReconstructionReleaseAttestationMetadata;
}

function assertExactPublicReview(
  release: ReleaseRow,
  qa: QaRow,
  review: ReconstructionReleaseReview | null,
): asserts review is ReconstructionReleaseReview {
  if (qa.outcome !== "passed") {
    throw new ReconstructionFoundryEligibilityError("Machine QA has not passed for this release.");
  }
  if (
    review === null ||
    review.decision !== "approved" ||
    review.targetExposure !== "public" ||
    review.releaseId !== release.id ||
    review.releaseDigest !== release.releaseDigest ||
    review.qaReportDigest !== qa.reportDigest ||
    review.transformArtifactRef === null ||
    review.sceneAuthorityMapRef === null ||
    review.visualEvidence.length === 0
  ) {
    throw new ReconstructionFoundryEligibilityError(
      "The latest review is not an exact, evidence-complete public approval.",
    );
  }
}

function validatePublicationBinding(
  release: ReleaseRow,
  qa: QaRow,
  review: ReconstructionReleaseReview,
  attestation: ReconstructionReleaseAttestationMetadata,
  publication: ReconstructionReleasePublication,
): void {
  const expectedPrefix = publicPrefix(release.releaseDigest);
  if (
    publication.releaseId !== release.id ||
    publication.releaseDigest !== release.releaseDigest ||
    publication.qaReportDigest !== qa.reportDigest ||
    publication.reviewId !== review.id ||
    publication.reviewDigest !== review.reviewDigest ||
    publication.attestationId !== attestation.id ||
    publication.attestationEnvelopeSha256 !== attestation.envelopeSha256 ||
    publication.candidateR2Prefix !== release.candidatePrefix ||
    publication.publicR2Prefix !== expectedPrefix ||
    publication.publicManifestR2Key !== `${expectedPrefix}/manifest.json` ||
    publication.manifestSha256 !== release.sourceManifestSha256 ||
    publication.fileCount !== release.fileCount ||
    publication.totalBytes !== release.totalBytes
  ) {
    throw new ReconstructionFoundryEligibilityError(
      "The immutable publication does not bind the latest approved evidence exactly.",
    );
  }
}

async function eligibleRelease(
  db: FoundryDatabase,
  releaseId: string,
): Promise<EligibleRelease> {
  const evidence = await loadReleaseEvidence(db, releaseId);
  const registration = serializeRegistration(evidence.release, evidence.qa);
  const reviews = evidence.reviews.map(serializeReview);
  const latestReview = reviews[0] ?? null;
  assertExactPublicReview(evidence.release, evidence.qa, latestReview);
  const attestations = evidence.attestations.map(serializeAttestation);
  const attestation = matchingAttestation(latestReview, attestations);
  if (attestation === null) {
    throw new ReconstructionFoundryEligibilityError(
      "No verified detached attestation binds the latest public approval.",
    );
  }
  const publicationRow = await publicationForEvidence(
    db,
    evidence.release.id,
    latestReview.id,
    attestation.id,
  );
  if (publicationRow === null) {
    throw new ReconstructionFoundryEligibilityError(
      "The release has not been copied and verified in immutable public storage.",
    );
  }
  const publication = serializePublication(publicationRow);
  validatePublicationBinding(
    evidence.release,
    evidence.qa,
    latestReview,
    attestation,
    publication,
  );
  return {
    evidence,
    registration,
    review: latestReview,
    attestation,
    publication,
    publicationRow,
  };
}

async function publishableRelease(
  db: FoundryDatabase,
  releaseId: string,
): Promise<PublishableRelease> {
  const evidence = await loadReleaseEvidence(db, releaseId);
  const registration = serializeRegistration(evidence.release, evidence.qa);
  const reviews = evidence.reviews.map(serializeReview);
  const latestReview = reviews[0] ?? null;
  assertExactPublicReview(evidence.release, evidence.qa, latestReview);
  const attestation = matchingAttestation(
    latestReview,
    evidence.attestations.map(serializeAttestation),
  );
  if (attestation === null) {
    throw new ReconstructionFoundryEligibilityError(
      "A verified detached attestation must bind the latest public approval before publication.",
    );
  }
  return { evidence, registration, review: latestReview, attestation };
}

function publicationInputFromRecord(
  publication: ReconstructionReleasePublication,
): ReconstructionReleasePublicationInput {
  return {
    releaseId: publication.releaseId,
    releaseDigest: publication.releaseDigest,
    qaReportDigest: publication.qaReportDigest,
    reviewId: publication.reviewId,
    reviewDigest: publication.reviewDigest,
    attestationId: publication.attestationId,
    attestationEnvelopeSha256: publication.attestationEnvelopeSha256,
    idempotencyKey: publication.idempotencyKey,
    note: publication.note,
  };
}

export function buildReconstructionReleaseSigningPayload(input: {
  readonly release: Pick<
    ReleaseRow,
    | "id"
    | "venueSlug"
    | "releaseKind"
    | "releaseDigest"
    | "sourceManifestSha256"
    | "releaseManifestSha256"
  >;
  readonly qaReportDigest: string;
  readonly review: ReconstructionReleaseReview;
}): ReconstructionReleaseSigningPayload {
  const { release, review } = input;
  if (
    review.decision !== "approved" ||
    review.targetExposure !== "public" ||
    review.releaseId !== release.id ||
    review.releaseDigest !== release.releaseDigest ||
    review.qaReportDigest !== input.qaReportDigest ||
    review.visualEvidence.length === 0 ||
    review.transformArtifactRef === null ||
    review.sceneAuthorityMapRef === null
  ) {
    throw new ReconstructionFoundryEligibilityError(
      "Public signing requires the exact evidence-complete public approval.",
    );
  }
  const statement: ReconstructionReleaseSigningStatement = {
    _type: RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
    subject: [{
      name: `reconstruction-release/${release.venueSlug}/${release.releaseDigest}`,
      digest: { sha256: release.releaseDigest },
    }],
    predicateType: RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
    predicate: {
      schemaVersion: RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
      venueSlug: release.venueSlug,
      releaseKind: release.releaseKind,
      releaseId: release.id,
      releaseDigest: release.releaseDigest,
      sourceManifestSha256: release.sourceManifestSha256,
      releaseManifestSha256: release.releaseManifestSha256,
      qaReportDigest: input.qaReportDigest,
      reviewId: review.id,
      reviewDigest: review.reviewDigest,
      reviewedAt: review.reviewedAt,
      reviewerUserId: review.reviewerUserId,
      decision: "approved",
      targetExposure: "public",
      visualEvidence: review.visualEvidence,
      transformArtifactRef: review.transformArtifactRef,
      sceneAuthorityMapRef: review.sceneAuthorityMapRef,
    },
  };
  const parsedStatement = ReconstructionReleaseSigningStatementSchema.parse(statement);
  // D-019 deliberately avoids a JSON canonical-form dependency: serialize
  // once, expose those exact bytes, and let DSSE PAE bind them verbatim.
  const payloadUtf8 = JSON.stringify(parsedStatement);
  const bytes = Buffer.from(payloadUtf8, "utf8");
  return ReconstructionReleaseSigningPayloadSchema.parse({
    schemaVersion: RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    releaseId: release.id,
    releaseDigest: release.releaseDigest,
    qaReportDigest: input.qaReportDigest,
    reviewId: review.id,
    reviewDigest: review.reviewDigest,
    statement: parsedStatement,
    payloadUtf8,
    payloadBase64: bytes.toString("base64"),
    payloadSha256: sha256Hex(bytes),
    payloadByteLength: bytes.byteLength,
  });
}

export interface ReconstructionFoundryServiceApi {
  listReviewEvidenceArtifacts(venueSlug: RuntimeSlug): Promise<ReconstructionReviewEvidenceArtifactList>;
  registerReviewEvidenceArtifact(
    input: ReconstructionReviewEvidenceArtifactRegistrationInput,
    actorUserId: string,
  ): Promise<ReconstructionReviewEvidenceArtifact>;
  getVisualEvidence(
    releaseId: string,
    objectPath: string,
  ): Promise<{ readonly contentType: "image/webp"; readonly bytes: Uint8Array; readonly sha256: string }>;
  listReleases(
    venueSlug: RuntimeSlug,
    releaseKind?: ReconstructionReleaseKind,
  ): Promise<ReconstructionReleaseList>;
  getRelease(releaseId: string): Promise<ReconstructionReleaseDetail>;
  verifyCandidate(
    input: ReconstructionCandidateVerificationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseRegistration>;
  reviewRelease(
    releaseId: string,
    input: ReconstructionReleaseReviewInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseReview>;
  getSigningPayload(
    releaseId: string,
    reviewId: string,
  ): Promise<ReconstructionReleaseSigningPayload>;
  verifyAttestation(
    releaseId: string,
    input: ReconstructionReleaseAttestationVerificationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseAttestationMetadata>;
  publishRelease(
    releaseId: string,
    input: ReconstructionReleasePublicationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleasePublication>;
  getProductionChannel(
    venueSlug: RuntimeSlug,
    releaseKind?: ReconstructionReleaseKind,
  ): Promise<ReconstructionReleaseChannel | null>;
  getProductionChannelHistory(
    venueSlug: RuntimeSlug,
    releaseKind?: ReconstructionReleaseKind,
  ): Promise<readonly ReconstructionReleaseChannelEvent[]>;
  promoteRelease(
    input: ReconstructionReleasePromoteInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseChannelEvent>;
  rollbackRelease(
    input: ReconstructionReleaseRollbackInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseChannelEvent>;
  getActiveRelease(
    venueSlug: RuntimeSlug,
    releaseKind?: ReconstructionReleaseKind,
  ): Promise<ReconstructionReleasePublicActiveDescriptor>;
}

export class ReconstructionFoundryService implements ReconstructionFoundryServiceApi {
  private readonly db: Database;
  private readonly candidateVerifier: ReconstructionCandidateVerifier | undefined;
  private readonly attestationVerifier: ReconstructionAttestationVerifier | undefined;
  private readonly publisher: ReconstructionReleasePublisher | undefined;
  private readonly privateEvidenceStore: ReconstructionPrivateEvidenceStore | undefined;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(dependencies: ReconstructionFoundryDependencies) {
    this.db = dependencies.db;
    this.candidateVerifier = dependencies.candidateVerifier;
    this.attestationVerifier = dependencies.attestationVerifier;
    this.publisher = dependencies.publisher;
    this.privateEvidenceStore = dependencies.privateEvidenceStore;
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async listReviewEvidenceArtifacts(
    venueSlug: RuntimeSlug,
  ): Promise<ReconstructionReviewEvidenceArtifactList> {
    const rows = await this.db
      .select()
      .from(reconstructionReviewEvidenceArtifacts)
      .where(eq(reconstructionReviewEvidenceArtifacts.venueSlug, venueSlug))
      .orderBy(
        desc(reconstructionReviewEvidenceArtifacts.registeredAt),
        desc(reconstructionReviewEvidenceArtifacts.id),
      );
    return ReconstructionReviewEvidenceArtifactListSchema.parse({
      venueSlug,
      artifacts: rows.map(serializeReviewEvidenceArtifact),
    });
  }

  async registerReviewEvidenceArtifact(
    input: ReconstructionReviewEvidenceArtifactRegistrationInput,
    actorUserId: string,
  ): Promise<ReconstructionReviewEvidenceArtifact> {
    const store = this.privateEvidenceStore;
    if (store === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Private review-evidence storage");
    }
    const artifact = parseReconstructionReviewEvidenceArtifact(input.artifactKind, input.artifact);
    const artifactId = reconstructionReviewEvidenceArtifactId(artifact);
    const artifactDigest = computeReconstructionReviewEvidenceArtifactDigest(artifact);
    const schemaVersion = reconstructionReviewEvidenceArtifactSchemaVersion(input.artifactKind);
    const bytes = Buffer.from(canonicalReconstructionReviewEvidenceArtifact(artifact), "utf8");
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES) {
      throw new ReconstructionFoundryEvidenceError("Review evidence artifact exceeds the 4 MiB bounded JSON limit.");
    }
    if (input.artifactKind === "scene_authority_map_v0") {
      const sceneMap = ReconstructionSceneAuthorityMapV0Schema.parse(artifact);
      for (const reference of new Map(sceneMap.regions.map((region) => [
        `${region.transformArtifactRef.artifactId}:${region.transformArtifactRef.artifactDigest}`,
        region.transformArtifactRef,
      ])).values()) {
        const [registeredTransform] = await this.db
          .select({ id: reconstructionReviewEvidenceArtifacts.id })
          .from(reconstructionReviewEvidenceArtifacts)
          .where(and(
            eq(reconstructionReviewEvidenceArtifacts.venueSlug, input.venueSlug),
            eq(reconstructionReviewEvidenceArtifacts.artifactKind, "transform_artifact_v0"),
            eq(reconstructionReviewEvidenceArtifacts.artifactId, reference.artifactId),
            eq(reconstructionReviewEvidenceArtifacts.artifactDigest, reference.artifactDigest),
          ))
          .limit(1);
        if (registeredTransform === undefined) {
          throw new ReconstructionFoundryEvidenceError(
            `Scene Authority Map references an unregistered TransformArtifact: ${reference.artifactId}.`,
          );
        }
      }
    }
    const objectKey = `candidates/review-evidence/${input.venueSlug}/${input.artifactKind}/${artifactDigest}.json`;
    const requestDigest = digestJson({
      venueSlug: input.venueSlug,
      artifactKind: input.artifactKind,
      artifactId,
      artifactDigest,
    });
    const [idempotent] = await this.db
      .select()
      .from(reconstructionReviewEvidenceArtifacts)
      .where(and(
        eq(reconstructionReviewEvidenceArtifacts.registeredBy, actorUserId),
        eq(reconstructionReviewEvidenceArtifacts.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (idempotent !== undefined) {
      if (idempotent.requestDigest !== requestDigest) throw new ReconstructionFoundryIdempotencyError();
      return serializeReviewEvidenceArtifact(idempotent);
    }
    const [existing] = await this.db
      .select()
      .from(reconstructionReviewEvidenceArtifacts)
      .where(and(
        eq(reconstructionReviewEvidenceArtifacts.venueSlug, input.venueSlug),
        eq(reconstructionReviewEvidenceArtifacts.artifactKind, input.artifactKind),
        eq(reconstructionReviewEvidenceArtifacts.artifactId, artifactId),
        eq(reconstructionReviewEvidenceArtifacts.artifactDigest, artifactDigest),
      ))
      .limit(1);
    if (existing !== undefined) return serializeReviewEvidenceArtifact(existing);

    await callFoundryProvider(
      "Private review-evidence storage",
      "Review evidence artifact failed immutable write or byte readback verification.",
      () => store.putIfAbsentAndVerify({
        key: objectKey,
        sha256: artifactDigest,
        sizeBytes: bytes.byteLength,
        maxBytes: MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES,
        contentType: "application/json",
        bytes,
      }),
    );
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${objectKey}, 0))`);
      const [retry] = await tx
        .select()
        .from(reconstructionReviewEvidenceArtifacts)
        .where(and(
          eq(reconstructionReviewEvidenceArtifacts.registeredBy, actorUserId),
          eq(reconstructionReviewEvidenceArtifacts.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (retry !== undefined) {
        if (retry.requestDigest !== requestDigest) throw new ReconstructionFoundryIdempotencyError();
        return serializeReviewEvidenceArtifact(retry);
      }
      const [sameArtifact] = await tx
        .select()
        .from(reconstructionReviewEvidenceArtifacts)
        .where(and(
          eq(reconstructionReviewEvidenceArtifacts.venueSlug, input.venueSlug),
          eq(reconstructionReviewEvidenceArtifacts.artifactKind, input.artifactKind),
          eq(reconstructionReviewEvidenceArtifacts.artifactId, artifactId),
          eq(reconstructionReviewEvidenceArtifacts.artifactDigest, artifactDigest),
        ))
        .limit(1);
      if (sameArtifact !== undefined) return serializeReviewEvidenceArtifact(sameArtifact);
      const [row] = await tx.insert(reconstructionReviewEvidenceArtifacts).values({
        id: this.createId(),
        venueSlug: input.venueSlug,
        artifactKind: input.artifactKind,
        artifactId,
        artifactDigest,
        objectKey,
        objectSha256: artifactDigest,
        sizeBytes: bytes.byteLength,
        schemaVersion,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        registeredBy: actorUserId,
        registeredAt: this.now(),
      }).returning();
      if (row === undefined) {
        throw new ReconstructionFoundryEvidenceError("Review evidence artifact receipt was not persisted.");
      }
      return serializeReviewEvidenceArtifact(row);
    });
  }

  async getVisualEvidence(
    releaseId: string,
    objectPath: string,
  ): Promise<{ readonly contentType: "image/webp"; readonly bytes: Uint8Array; readonly sha256: string }> {
    const store = this.privateEvidenceStore;
    if (store === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Private review-evidence storage");
    }
    const release = await releaseById(this.db, releaseId);
    if (release === null) throw new ReconstructionFoundryNotFoundError("Reconstruction release not found.");
    const file = release.manifestJson.files.find((candidate) =>
      candidate.path === objectPath &&
      candidate.role === "imagery" &&
      candidate.mimeType === "image/webp" &&
      candidate.sizeBytes <= MAX_VISUAL_EVIDENCE_PREVIEW_BYTES
    );
    if (file === undefined) {
      throw new ReconstructionFoundryNotFoundError("Reviewable visual evidence was not found.");
    }
    const bytes = await callFoundryProvider(
      "Private visual-evidence storage",
      "Visual evidence failed exact private-object readback verification.",
      () => store.readVerified({
        key: `${release.candidatePrefix}/${file.path}`,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        maxBytes: MAX_VISUAL_EVIDENCE_PREVIEW_BYTES,
      }),
    );
    return { contentType: "image/webp", bytes, sha256: file.sha256 };
  }

  private async resolveReviewEvidenceArtifact(
    venueSlug: RuntimeSlug,
    kind: ReconstructionReviewEvidenceArtifactKind,
    reference: ReconstructionReleaseArtifactRef,
  ): Promise<ReconstructionReviewEvidenceArtifactBody> {
    const store = this.privateEvidenceStore;
    if (store === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Private review-evidence storage");
    }
    const [row] = await this.db
      .select()
      .from(reconstructionReviewEvidenceArtifacts)
      .where(and(
        eq(reconstructionReviewEvidenceArtifacts.venueSlug, venueSlug),
        eq(reconstructionReviewEvidenceArtifacts.artifactKind, kind),
        eq(reconstructionReviewEvidenceArtifacts.artifactId, reference.artifactId),
        eq(reconstructionReviewEvidenceArtifacts.artifactDigest, reference.artifactDigest),
      ))
      .limit(1);
    if (row === undefined) {
      throw new ReconstructionFoundryEvidenceError(
        `${kind === "transform_artifact_v0" ? "TransformArtifact" : "Scene Authority Map"} is not in the verified immutable evidence registry.`,
      );
    }
    const bytes = await callFoundryProvider(
      "Private review-evidence storage",
      "Registered review evidence failed immutable byte readback verification.",
      () => store.readVerified({
        key: row.objectKey,
        sha256: row.objectSha256,
        sizeBytes: row.sizeBytes,
        maxBytes: MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES,
      }),
    );
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new ReconstructionFoundryEvidenceError("Registered review evidence is not valid UTF-8 JSON.");
    }
    const artifact = parseReconstructionReviewEvidenceArtifact(kind, raw);
    if (
      reconstructionReviewEvidenceArtifactId(artifact) !== reference.artifactId ||
      computeReconstructionReviewEvidenceArtifactDigest(artifact) !== reference.artifactDigest
    ) {
      throw new ReconstructionFoundryEvidenceError("Registered review evidence body does not match its immutable receipt.");
    }
    return artifact;
  }

  private async loadExactTwinManifestForReview(release: ReleaseRow): Promise<TwinManifest> {
    const store = this.privateEvidenceStore;
    if (store === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Private review-evidence storage");
    }
    const manifestFile = release.manifestJson.files.find((file) => file.path === "manifest.json");
    if (manifestFile === undefined || manifestFile.sizeBytes > MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES) {
      throw new ReconstructionFoundryEvidenceError("Release source manifest is unavailable for Scene Authority validation.");
    }
    const bytes = await callFoundryProvider(
      "Private source-manifest storage",
      "Source Twin manifest failed exact private-object readback verification.",
      () => store.readVerified({
        key: `${release.candidatePrefix}/manifest.json`,
        sha256: manifestFile.sha256,
        sizeBytes: manifestFile.sizeBytes,
        maxBytes: MAX_REVIEW_EVIDENCE_ARTIFACT_BYTES,
      }),
    );
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new ReconstructionFoundryEvidenceError("Source Twin manifest is not valid UTF-8 JSON.");
    }
    const twin = TwinManifestSchema.parse(raw);
    if (twin.venueSlug !== release.venueSlug) {
      throw new ReconstructionFoundryEvidenceError("Source Twin manifest venue does not match the release.");
    }
    return twin;
  }

  async listReleases(
    venueSlug: RuntimeSlug,
    releaseKind: ReconstructionReleaseKind = RELEASE_KIND,
  ): Promise<ReconstructionReleaseList> {
    const releaseRows = await this.db
      .select()
      .from(reconstructionReleases)
      .where(and(
        eq(reconstructionReleases.venueSlug, venueSlug),
        eq(reconstructionReleases.releaseKind, releaseKind),
      ))
      .orderBy(desc(reconstructionReleases.createdAt), desc(reconstructionReleases.id));
    const channelRow = await channelForScope(this.db, venueSlug, releaseKind);
    const productionChannel = channelRow === null ? null : serializeChannel(channelRow);
    const releases = await Promise.all(releaseRows.map(async (release) => {
      const evidence = await loadReleaseEvidence(this.db, release.id);
      const reviews = evidence.reviews.map(serializeReview);
      const attestations = evidence.attestations.map(serializeAttestation);
      const latestReview = reviews[0] ?? null;
      const attestation = matchingAttestation(latestReview, attestations);
      const publication = evidence.publication === null
        ? null
        : serializePublication(evidence.publication);
      const currentPublication = currentReconstructionPublication(publication, latestReview, attestation);
      const state = deriveReconstructionReleaseState({
        qaOutcome: evidence.qa.outcome,
        latestReview,
        matchingAttestation: attestation,
        matchingPublication: currentPublication,
        productionChannel,
        releaseId: release.id,
      });
      return {
        id: release.id,
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        releaseDigest: release.releaseDigest,
        sourceManifestSha256: release.sourceManifestSha256,
        fileCount: release.fileCount,
        totalBytes: release.totalBytes,
        qaOutcome: evidence.qa.outcome,
        qaReportDigest: evidence.qa.reportDigest,
        latestReviewDecision: latestReview?.decision ?? null,
        latestReviewTargetExposure: latestReview?.targetExposure ?? null,
        attested: attestation !== null,
        published: currentPublication !== null,
        active: state === "active",
        state,
        registeredAt: iso(release.createdAt),
      };
    }));
    return ReconstructionReleaseListSchema.parse({ releases, productionChannel });
  }

  async getRelease(releaseId: string): Promise<ReconstructionReleaseDetail> {
    return detailFromEvidence(this.db, await loadReleaseEvidence(this.db, releaseId));
  }

  async verifyCandidate(
    input: ReconstructionCandidateVerificationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseRegistration> {
    const candidateVerifier = this.candidateVerifier;
    if (candidateVerifier === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Candidate verification");
    }
    const verified = await callFoundryProvider(
      "Candidate object storage",
      "Private candidate verification failed an integrity or deterministic-QA check.",
      () => candidateVerifier.verifyCandidate(input),
    );
    const manifest = ReconstructionReleaseManifestSchema.parse(verified.manifest);
    const qaReport = ReconstructionQaReportSchema.parse(verified.qaReport);
    const expectedPrefix = `candidates/${manifest.venueSlug}/${manifest.releaseDigest}`;
    const expectedManifestKey = `${expectedPrefix}/release-manifest.json`;
    if (
      verified.candidateBucket.trim().length === 0 ||
      verified.candidateR2Prefix !== input.candidateR2Prefix ||
      verified.candidateR2Prefix !== expectedPrefix ||
      verified.candidateManifestR2Key !== expectedManifestKey ||
      verified.qaReportR2Key !== `${expectedPrefix}/qa-report.json` ||
      !/^[a-f0-9]{64}$/u.test(verified.releaseManifestSha256) ||
      qaReport.releaseDigest !== manifest.releaseDigest ||
      qaReport.sourceManifestSha256 !== manifest.sourceManifestSha256
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "Private candidate readback does not match its digest-addressed manifest and QA evidence.",
      );
    }
    const requestDigest = digestJson(input);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.candidateR2Prefix}, 0))`);
      const [idempotent] = await tx
        .select()
        .from(reconstructionReleases)
        .where(and(
          eq(reconstructionReleases.createdBy, actorUserId),
          eq(reconstructionReleases.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (idempotent !== undefined) {
        if (idempotent.requestDigest !== requestDigest) {
          throw new ReconstructionFoundryIdempotencyError();
        }
        const qa = await qaForRelease(tx, idempotent.id);
        if (qa === null) {
          throw new ReconstructionFoundryEvidenceError(
            `Release ${idempotent.id} has no immutable machine-QA record.`,
          );
        }
        return serializeRegistration(idempotent, qa);
      }
      const [existing] = await tx
        .select()
        .from(reconstructionReleases)
        .where(and(
          eq(reconstructionReleases.venueSlug, manifest.venueSlug),
          eq(reconstructionReleases.releaseKind, manifest.releaseKind),
          eq(reconstructionReleases.releaseDigest, manifest.releaseDigest),
        ))
        .limit(1);
      if (existing !== undefined) {
        const qa = await qaForRelease(tx, existing.id);
        if (
          qa === null ||
          existing.sourceManifestSha256 !== manifest.sourceManifestSha256 ||
          existing.releaseManifestSha256 !== verified.releaseManifestSha256 ||
          existing.candidatePrefix !== expectedPrefix ||
          !sameJson(existing.manifestJson, manifest) ||
          !sameJson(qa.reportJson, qaReport)
        ) {
          throw new ReconstructionFoundryEvidenceError(
            "The release digest is already registered with different immutable evidence.",
          );
        }
        return serializeRegistration(existing, qa);
      }
      const releaseId = this.createId();
      const registeredAt = this.now();
      const [release] = await tx.insert(reconstructionReleases).values({
        id: releaseId,
        venueSlug: manifest.venueSlug,
        releaseKind: manifest.releaseKind,
        releaseDigest: manifest.releaseDigest,
        sourceManifestSha256: manifest.sourceManifestSha256,
        releaseManifestSha256: verified.releaseManifestSha256,
        candidateBucket: verified.candidateBucket,
        candidatePrefix: expectedPrefix,
        releaseManifestKey: expectedManifestKey,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
        manifestJson: manifest,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        createdBy: actorUserId,
        createdAt: registeredAt,
      }).returning();
      if (release === undefined) {
        throw new ReconstructionFoundryEvidenceError("Candidate registration was not persisted.");
      }
      const [qa] = await tx.insert(reconstructionReleaseQaRuns).values({
        id: this.createId(),
        releaseId: release.id,
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        qaProfileVersion: qaReport.qaProfileVersion,
        qaProfileDigest: qaReport.qaProfileDigest,
        outcome: qaReport.outcome,
        reportDigest: qaReport.reportDigest,
        reportKey: verified.qaReportR2Key,
        reportJson: qaReport,
        createdAt: registeredAt,
      }).returning();
      if (qa === undefined) {
        throw new ReconstructionFoundryEvidenceError("Candidate QA record was not persisted.");
      }
      return serializeRegistration(release, qa);
    });
  }

  async reviewRelease(
    releaseId: string,
    input: ReconstructionReleaseReviewInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseReview> {
    if (input.releaseId !== releaseId) {
      throw new ReconstructionFoundryEvidenceError(
        "The review body does not identify the release in the route.",
      );
    }
    if (input.decision === "approved" && input.targetExposure === "public") {
      const release = await releaseById(this.db, releaseId);
      if (release === null) {
        throw new ReconstructionFoundryNotFoundError("Reconstruction release not found.");
      }
      const transformReference = input.transformArtifactRef;
      const sceneReference = input.sceneAuthorityMapRef;
      if (transformReference === null || sceneReference === null) {
        throw new ReconstructionFoundryEvidenceError(
          "Public approval requires registered TransformArtifact and Scene Authority Map evidence.",
        );
      }
      const [transformArtifact, sceneArtifact] = await Promise.all([
        this.resolveReviewEvidenceArtifact(
          release.venueSlug,
          "transform_artifact_v0",
          transformReference,
        ),
        this.resolveReviewEvidenceArtifact(
          release.venueSlug,
          "scene_authority_map_v0",
          sceneReference,
        ),
      ]);
      if (reconstructionReviewEvidenceArtifactId(transformArtifact) !== transformReference.artifactId) {
        throw new ReconstructionFoundryEvidenceError("Resolved TransformArtifact identity is inconsistent.");
      }
      const sceneMap = ReconstructionSceneAuthorityMapV0Schema.parse(sceneArtifact);
      if (
        sceneMap.venueSlug !== release.venueSlug ||
        !sceneMap.regions.some((region) => sameArtifactRef(region.transformArtifactRef, transformReference))
      ) {
        throw new ReconstructionFoundryEvidenceError(
          "Scene Authority Map must bind the selected registered TransformArtifact for this venue.",
        );
      }
      const releasePaths = new Set(release.manifestJson.files.map((file) => file.path));
      const missingAuthorityPath = sceneAuthorityReleaseFilePaths(sceneMap)
        .find((path) => !releasePaths.has(path));
      if (missingAuthorityPath !== undefined) {
        throw new ReconstructionFoundryEvidenceError(
          `Scene Authority Map references a file outside this immutable release: ${missingAuthorityPath}.`,
        );
      }
      const twin = await this.loadExactTwinManifestForReview(release);
      assertVisualEvidenceCoversTwin(twin, input.visualEvidence);
      assertSceneAuthorityCoversRelease({
        map: sceneMap,
        twin,
        release: release.manifestJson,
        selectedTransform: transformReference,
      });
    }
    return this.db.transaction(async (tx) => {
      await lockRelease(tx, releaseId);
      const evidence = await loadReleaseEvidence(tx, releaseId);
      const [idempotent] = await tx
        .select()
        .from(reconstructionReleaseReviews)
        .where(and(
          eq(reconstructionReleaseReviews.reviewerUserId, actorUserId),
          eq(reconstructionReleaseReviews.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (idempotent !== undefined) {
        const review = serializeReview(idempotent);
        if (!sameJson(reviewInput(review), input)) {
          throw new ReconstructionFoundryIdempotencyError();
        }
        return review;
      }
      if (evidence.qa.outcome !== "passed") {
        throw new ReconstructionFoundryEligibilityError(
          "A release that failed machine QA cannot receive a human approval.",
        );
      }
      if (
        input.releaseDigest !== evidence.release.releaseDigest ||
        input.qaReportDigest !== evidence.qa.reportDigest
      ) {
        throw new ReconstructionFoundryEvidenceError(
          "The review does not bind the release's exact persisted digests.",
        );
      }
      if (!reconstructionVisualEvidenceExistsInManifest(
        evidence.release.manifestJson,
        input.visualEvidence,
      )) {
        throw new ReconstructionFoundryEvidenceError(
          "Every visual review reference must identify an exact file and digest in the release manifest.",
        );
      }
      if (evidence.channel?.activeReleaseId === releaseId) {
        throw new ReconstructionFoundryEligibilityError(
          "Roll back the active release before superseding its public review.",
        );
      }
      const reviewedAt = this.now();
      const material: ReconstructionReleaseReviewMaterial = {
        ...input,
        id: this.createId(),
        reviewerUserId: actorUserId,
        reviewerAuthority: "platform_admin",
        reviewedAt: iso(reviewedAt),
      };
      const reviewDigest = computeReconstructionReleaseReviewDigest(material);
      const review = ReconstructionReleaseReviewSchema.parse({ ...material, reviewDigest });
      const [row] = await tx.insert(reconstructionReleaseReviews).values({
        id: review.id,
        releaseId: evidence.release.id,
        qaRunId: evidence.qa.id,
        venueSlug: evidence.release.venueSlug,
        releaseKind: evidence.release.releaseKind,
        reviewerUserId: actorUserId,
        reviewerAuthority: "platform_admin",
        decision: review.decision,
        targetExposure: review.targetExposure,
        releaseDigest: review.releaseDigest,
        releaseManifestSha256: evidence.release.releaseManifestSha256,
        qaReportDigest: review.qaReportDigest,
        visualEvidence: review.visualEvidence,
        transformArtifactRefs: review.transformArtifactRef === null
          ? []
          : [review.transformArtifactRef],
        sceneAuthorityRefs: review.sceneAuthorityMapRef === null
          ? []
          : [review.sceneAuthorityMapRef],
        note: review.note,
        idempotencyKey: review.idempotencyKey,
        requestDigest: review.reviewDigest,
        supersedesReviewId: evidence.reviews[0]?.id ?? null,
        reviewSequence: (evidence.reviews[0]?.reviewSequence ?? 0) + 1,
        reviewedAt,
      }).returning();
      if (row === undefined) {
        throw new ReconstructionFoundryEvidenceError("Human review was not persisted.");
      }
      return serializeReview(row);
    });
  }

  async getSigningPayload(
    releaseId: string,
    reviewId: string,
  ): Promise<ReconstructionReleaseSigningPayload> {
    const evidence = await loadReleaseEvidence(this.db, releaseId);
    const reviews = evidence.reviews.map(serializeReview);
    const latestReview = reviews[0] ?? null;
    assertExactPublicReview(evidence.release, evidence.qa, latestReview);
    if (latestReview.id !== reviewId) {
      throw new ReconstructionFoundryEligibilityError(
        "Signing is available only for the latest exact public approval.",
      );
    }
    return buildReconstructionReleaseSigningPayload({
      release: evidence.release,
      qaReportDigest: evidence.qa.reportDigest,
      review: latestReview,
    });
  }

  async verifyAttestation(
    releaseId: string,
    input: ReconstructionReleaseAttestationVerificationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseAttestationMetadata> {
    const attestationVerifier = this.attestationVerifier;
    if (attestationVerifier === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Detached attestation verification");
    }
    const requestDigest = digestJson({ releaseId, ...input });
    const [idempotent] = await this.db
      .select()
      .from(reconstructionReleaseAttestations)
      .where(and(
        eq(reconstructionReleaseAttestations.verifiedBy, actorUserId),
        eq(reconstructionReleaseAttestations.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (idempotent !== undefined) {
      if (idempotent.requestDigest !== requestDigest) {
        throw new ReconstructionFoundryIdempotencyError();
      }
      return serializeAttestation(idempotent);
    }
    const signingPayload = await this.getSigningPayload(releaseId, input.reviewId);
    if (
      input.envelope.payloadType !== signingPayload.payloadType ||
      input.envelope.payload !== signingPayload.payloadBase64
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "The DSSE envelope does not contain the exact server-issued signing payload bytes.",
      );
    }
    const canonicalEnvelope = canonicalJson(input.envelope);
    const canonicalEnvelopeBytes = Buffer.from(canonicalEnvelope, "utf8");
    const envelopeSha256 = sha256Hex(canonicalEnvelopeBytes);
    const evidence = await loadReleaseEvidence(this.db, releaseId);
    const expectedPrivateR2Key = attestationKey(evidence.release.candidatePrefix, envelopeSha256);
    const verified = await callFoundryProvider(
      "Attestation verification storage",
      "The detached envelope failed payload, digest, or trusted-signature verification.",
      () => attestationVerifier.verifyAndStoreAttestation({
        signingPayload,
        envelope: input.envelope,
        canonicalEnvelopeBytes,
        expectedEnvelopeSha256: envelopeSha256,
        expectedPrivateR2Key,
      }),
    );
    const verifiedAt = new Date(verified.verifiedAt);
    if (
      verified.releaseId !== signingPayload.releaseId ||
      verified.releaseDigest !== signingPayload.releaseDigest ||
      verified.qaReportDigest !== signingPayload.qaReportDigest ||
      verified.reviewId !== signingPayload.reviewId ||
      verified.reviewDigest !== signingPayload.reviewDigest ||
      verified.payloadSha256 !== signingPayload.payloadSha256 ||
      verified.envelopeSha256 !== envelopeSha256 ||
      verified.r2Key !== expectedPrivateR2Key ||
      !input.envelope.signatures.some((signature) => signature.keyid === verified.keyId) ||
      !/^[a-f0-9]{64}$/u.test(verified.publicKeyFingerprint) ||
      Number.isNaN(verifiedAt.valueOf()) ||
      verifiedAt.valueOf() < Date.parse(signingPayload.statement.predicate.reviewedAt) ||
      verifiedAt.valueOf() > this.now().valueOf() + 5 * 60_000
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "Trusted-key verification or private attestation readback returned inconsistent evidence.",
      );
    }
    return this.db.transaction(async (tx) => {
      await lockRelease(tx, releaseId);
      const [retry] = await tx
        .select()
        .from(reconstructionReleaseAttestations)
        .where(and(
          eq(reconstructionReleaseAttestations.verifiedBy, actorUserId),
          eq(reconstructionReleaseAttestations.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (retry !== undefined) {
        if (retry.requestDigest !== requestDigest) {
          throw new ReconstructionFoundryIdempotencyError();
        }
        return serializeAttestation(retry);
      }
      const currentPayload = await this.getSigningPayloadFromDb(tx, releaseId, input.reviewId);
      if (!sameJson(currentPayload, signingPayload)) {
        throw new ReconstructionFoundryEligibilityError(
          "The public approval changed while the detached attestation was being verified.",
        );
      }
      const [existing] = await tx
        .select()
        .from(reconstructionReleaseAttestations)
        .where(and(
          eq(reconstructionReleaseAttestations.releaseId, releaseId),
          eq(reconstructionReleaseAttestations.envelopeSha256, envelopeSha256),
        ))
        .limit(1);
      if (existing !== undefined) return serializeAttestation(existing);
      const release = await releaseById(tx, releaseId);
      if (release === null) {
        throw new ReconstructionFoundryNotFoundError("Reconstruction release not found.");
      }
      const [row] = await tx.insert(reconstructionReleaseAttestations).values({
        id: this.createId(),
        releaseId,
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        attestationType: "in_toto_dsse_ed25519",
        releaseDigest: signingPayload.releaseDigest,
        qaReportDigest: signingPayload.qaReportDigest,
        reviewId: signingPayload.reviewId,
        reviewDigest: signingPayload.reviewDigest,
        keyId: verified.keyId,
        publicKeyFingerprint: verified.publicKeyFingerprint,
        statementSha256: signingPayload.payloadSha256,
        envelopeSha256,
        r2Key: expectedPrivateR2Key,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        verifiedBy: actorUserId,
        verifiedAt,
      }).returning();
      if (row === undefined) {
        throw new ReconstructionFoundryEvidenceError("Verified attestation was not persisted.");
      }
      return serializeAttestation(row);
    });
  }

  private async getSigningPayloadFromDb(
    db: FoundryDatabase,
    releaseId: string,
    reviewId: string,
  ): Promise<ReconstructionReleaseSigningPayload> {
    const evidence = await loadReleaseEvidence(db, releaseId);
    const reviews = evidence.reviews.map(serializeReview);
    const latestReview = reviews[0] ?? null;
    assertExactPublicReview(evidence.release, evidence.qa, latestReview);
    if (latestReview.id !== reviewId) {
      throw new ReconstructionFoundryEligibilityError(
        "Signing is available only for the latest exact public approval.",
      );
    }
    return buildReconstructionReleaseSigningPayload({
      release: evidence.release,
      qaReportDigest: evidence.qa.reportDigest,
      review: latestReview,
    });
  }

  private async reverifyEligibleAttestation(
    eligible: Pick<EligibleRelease, "evidence" | "review" | "attestation">,
  ): Promise<void> {
    const verifier = this.attestationVerifier;
    if (verifier === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Current attestation trust verification");
    }
    const signingPayload = buildReconstructionReleaseSigningPayload({
      release: eligible.evidence.release,
      qaReportDigest: eligible.evidence.qa.reportDigest,
      review: eligible.review,
    });
    await callFoundryProvider(
      "Current attestation trust verification",
      "The stored detached attestation no longer verifies against the current trusted-key set.",
      () => verifier.reverifyStoredAttestation({
        signingPayload,
        metadata: eligible.attestation,
      }),
    );
  }

  async publishRelease(
    releaseId: string,
    input: ReconstructionReleasePublicationInput,
    actorUserId: string,
  ): Promise<ReconstructionReleasePublication> {
    if (input.releaseId !== releaseId) {
      throw new ReconstructionFoundryEvidenceError(
        "The publication body does not identify the release in the route.",
      );
    }
    const publisher = this.publisher;
    if (publisher === undefined) {
      throw new ReconstructionFoundryIntegrationUnavailableError("Immutable release publication");
    }
    const requestDigest = digestJson(input);
    const [idempotent] = await this.db
      .select()
      .from(reconstructionReleasePublications)
      .where(and(
        eq(reconstructionReleasePublications.publishedBy, actorUserId),
        eq(reconstructionReleasePublications.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (idempotent !== undefined) {
      if (idempotent.requestDigest !== requestDigest) {
        throw new ReconstructionFoundryIdempotencyError();
      }
      return serializePublication(idempotent);
    }
    const publishable = await publishableRelease(this.db, releaseId);
    if (
      input.releaseDigest !== publishable.evidence.release.releaseDigest ||
      input.qaReportDigest !== publishable.evidence.qa.reportDigest ||
      input.reviewId !== publishable.review.id ||
      input.reviewDigest !== publishable.review.reviewDigest ||
      input.attestationId !== publishable.attestation.id ||
      input.attestationEnvelopeSha256 !== publishable.attestation.envelopeSha256
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "Publication does not bind the latest approved review and verified attestation exactly.",
      );
    }
    await this.reverifyEligibleAttestation(publishable);
    const existingEvidencePublication = await publicationForEvidence(
      this.db,
      releaseId,
      input.reviewId,
      input.attestationId,
    );
    if (existingEvidencePublication !== null) {
      const publication = serializePublication(existingEvidencePublication);
      if (!sameJson(publicationInputFromRecord(publication), input)) {
        throw new ReconstructionFoundryEligibilityError(
          "This review and attestation already have a different immutable publication receipt.",
        );
      }
      return publication;
    }
    const expectedPublicPrefix = publicPrefix(input.releaseDigest);
    const expectedPublicManifestKey = `${expectedPublicPrefix}/manifest.json`;
    const receipt = await callFoundryProvider(
      "Immutable public object storage",
      "Public copy or readback verification failed an integrity check.",
      () => publisher.publishRelease({
        registration: publishable.registration,
        review: publishable.review,
        attestation: publishable.attestation,
        publicR2Prefix: expectedPublicPrefix,
        publicManifestR2Key: expectedPublicManifestKey,
      }),
    );
    const normalizedBaseUrl = receipt.publicBaseUrl.replace(/\/+$/u, "");
    if (
      receipt.releaseId !== input.releaseId ||
      receipt.releaseDigest !== input.releaseDigest ||
      receipt.qaReportDigest !== input.qaReportDigest ||
      receipt.reviewId !== input.reviewId ||
      receipt.reviewDigest !== input.reviewDigest ||
      receipt.attestationId !== input.attestationId ||
      receipt.attestationEnvelopeSha256 !== input.attestationEnvelopeSha256 ||
      receipt.candidateR2Prefix !== publishable.evidence.release.candidatePrefix ||
      receipt.releaseBucket.trim().length === 0 ||
      receipt.publicR2Prefix !== expectedPublicPrefix ||
      receipt.publicManifestR2Key !== expectedPublicManifestKey ||
      receipt.publicManifestUrl !== `${normalizedBaseUrl}/manifest.json` ||
      receipt.manifestSha256 !== publishable.evidence.release.sourceManifestSha256 ||
      receipt.fileCount !== publishable.evidence.release.fileCount ||
      receipt.totalBytes !== publishable.evidence.release.totalBytes ||
      !/^https:\/\//u.test(receipt.publicBaseUrl) ||
      !/^[a-f0-9]{64}$/u.test(receipt.verificationDigest)
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "Public storage copy or readback verification returned inconsistent evidence.",
      );
    }
    const publishedAt = new Date(receipt.publishedAt);
    const verifiedAt = new Date(receipt.verifiedAt);
    if (
      Number.isNaN(publishedAt.valueOf()) ||
      Number.isNaN(verifiedAt.valueOf()) ||
      verifiedAt.valueOf() < publishedAt.valueOf()
    ) {
      throw new ReconstructionFoundryEvidenceError(
        "Public storage verification timestamps are invalid.",
      );
    }
    return this.db.transaction(async (tx) => {
      await lockRelease(tx, releaseId);
      const [retry] = await tx
        .select()
        .from(reconstructionReleasePublications)
        .where(and(
          eq(reconstructionReleasePublications.publishedBy, actorUserId),
          eq(reconstructionReleasePublications.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (retry !== undefined) {
        if (retry.requestDigest !== requestDigest) {
          throw new ReconstructionFoundryIdempotencyError();
        }
        return serializePublication(retry);
      }
      const current = await publishableRelease(tx, releaseId);
      if (
        current.review.id !== publishable.review.id ||
        current.review.reviewDigest !== publishable.review.reviewDigest ||
        current.attestation.id !== publishable.attestation.id ||
        current.attestation.envelopeSha256 !== publishable.attestation.envelopeSha256
      ) {
        throw new ReconstructionFoundryEligibilityError(
          "The approved evidence changed while immutable public storage was being verified.",
        );
      }
      const existing = await publicationForEvidence(
        tx,
        releaseId,
        input.reviewId,
        input.attestationId,
      );
      if (existing !== null) {
        const publication = serializePublication(existing);
        if (!sameJson(publicationInputFromRecord(publication), input)) {
          throw new ReconstructionFoundryEligibilityError(
            "This review and attestation already have a different immutable publication receipt.",
          );
        }
        return publication;
      }
      const [row] = await tx.insert(reconstructionReleasePublications).values({
        id: this.createId(),
        releaseId,
        venueSlug: current.evidence.release.venueSlug,
        releaseKind: current.evidence.release.releaseKind,
        releaseDigest: input.releaseDigest,
        qaReportDigest: input.qaReportDigest,
        reviewId: input.reviewId,
        reviewDigest: input.reviewDigest,
        attestationId: input.attestationId,
        attestationEnvelopeSha256: input.attestationEnvelopeSha256,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        note: input.note,
        candidatePrefix: receipt.candidateR2Prefix,
        releaseBucket: receipt.releaseBucket,
        releasePrefix: receipt.publicR2Prefix,
        publicManifestKey: receipt.publicManifestR2Key,
        publicBaseUrl: normalizedBaseUrl,
        manifestUrl: receipt.publicManifestUrl,
        manifestSha256: receipt.manifestSha256,
        verificationDigest: receipt.verificationDigest,
        objectCount: receipt.fileCount,
        totalBytes: receipt.totalBytes,
        publishedBy: actorUserId,
        publishedAt,
        verifiedAt,
      }).returning();
      if (row === undefined) {
        throw new ReconstructionFoundryEvidenceError("Publication receipt was not persisted.");
      }
      return serializePublication(row);
    });
  }

  async getProductionChannel(
    venueSlug: RuntimeSlug,
    releaseKind: ReconstructionReleaseKind = RELEASE_KIND,
  ): Promise<ReconstructionReleaseChannel | null> {
    const row = await channelForScope(this.db, venueSlug, releaseKind);
    return row === null ? null : serializeChannel(row);
  }

  async getProductionChannelHistory(
    venueSlug: RuntimeSlug,
    releaseKind: ReconstructionReleaseKind = RELEASE_KIND,
  ): Promise<readonly ReconstructionReleaseChannelEvent[]> {
    const channel = await channelForScope(this.db, venueSlug, releaseKind);
    if (channel === null) return [];
    const rows = await this.db
      .select()
      .from(reconstructionReleaseChannelEvents)
      .where(eq(reconstructionReleaseChannelEvents.channelId, channel.id))
      .orderBy(
        desc(reconstructionReleaseChannelEvents.resultingRevision),
        desc(reconstructionReleaseChannelEvents.id),
      );
    return rows.map(serializeChannelEvent);
  }

  async promoteRelease(
    input: ReconstructionReleasePromoteInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseChannelEvent> {
    return this.transitionProductionChannel("promote", input, actorUserId);
  }

  async rollbackRelease(
    input: ReconstructionReleaseRollbackInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseChannelEvent> {
    return this.transitionProductionChannel("rollback", input, actorUserId);
  }

  private async transitionProductionChannel(
    action: "promote" | "rollback",
    input: ReconstructionReleasePromoteInput | ReconstructionReleaseRollbackInput,
    actorUserId: string,
  ): Promise<ReconstructionReleaseChannelEvent> {
    const requestDigest = digestJson({ action, ...input });
    const target = await releaseById(this.db, input.targetReleaseId);
    if (target === null) {
      throw new ReconstructionFoundryNotFoundError("Target reconstruction release not found.");
    }
    const existingChannel = await channelForScope(this.db, target.venueSlug, target.releaseKind);
    if (existingChannel !== null) {
      const [existingEvent] = await this.db
        .select()
        .from(reconstructionReleaseChannelEvents)
        .where(and(
          eq(reconstructionReleaseChannelEvents.channelId, existingChannel.id),
          eq(reconstructionReleaseChannelEvents.actorUserId, actorUserId),
          eq(reconstructionReleaseChannelEvents.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existingEvent !== undefined) {
        if (existingEvent.requestDigest !== requestDigest) throw new ReconstructionFoundryIdempotencyError();
        return serializeChannelEvent(existingEvent);
      }
    }
    const trustPreflight = await eligibleRelease(this.db, input.targetReleaseId);
    await this.reverifyEligibleAttestation(trustPreflight);
    try {
      return await this.db.transaction(async (tx) => {
        await lockRelease(tx, input.targetReleaseId);
        let current = await channelForScope(tx, target.venueSlug, target.releaseKind);
        if (current !== null) {
          const [idempotentRow] = await tx
            .select()
            .from(reconstructionReleaseChannelEvents)
            .where(and(
              eq(reconstructionReleaseChannelEvents.channelId, current.id),
              eq(reconstructionReleaseChannelEvents.actorUserId, actorUserId),
              eq(reconstructionReleaseChannelEvents.idempotencyKey, input.idempotencyKey),
            ))
            .limit(1);
          if (idempotentRow !== undefined) {
            const idempotentPlan = planReconstructionChannelTransition({
              action,
              request: input,
              requestDigest,
              actorUserId,
              target: {
                venueSlug: target.venueSlug,
                releaseKind: target.releaseKind,
                releaseId: target.id,
                releaseDigest: target.releaseDigest,
                publicationId: input.targetPublicationId,
              },
              targetEligible: false,
              currentChannel: serializeChannel(current),
              idempotent: {
                event: serializeChannelEvent(idempotentRow),
                requestDigest: idempotentRow.requestDigest,
              },
              rollbackTargetWasActive: false,
              eventId: idempotentRow.id,
              updatedAt: iso(idempotentRow.createdAt),
            });
            return idempotentPlan.event;
          }
        }
        const eligible = await eligibleRelease(tx, input.targetReleaseId);
        current = await channelForScope(
          tx,
          eligible.evidence.release.venueSlug,
          eligible.evidence.release.releaseKind,
        );
        let rollbackTargetWasActive = false;
        if (action === "rollback" && current !== null) {
          const [previousActivation] = await tx
            .select({ id: reconstructionReleaseChannelEvents.id })
            .from(reconstructionReleaseChannelEvents)
            .where(and(
              eq(reconstructionReleaseChannelEvents.channelId, current.id),
              eq(reconstructionReleaseChannelEvents.toReleaseId, input.targetReleaseId),
              eq(
                reconstructionReleaseChannelEvents.toPublicationId,
                input.targetPublicationId,
              ),
            ))
            .limit(1);
          rollbackTargetWasActive = previousActivation !== undefined;
        }
        const updatedAt = this.now();
        const transition = planReconstructionChannelTransition({
          action,
          request: input,
          requestDigest,
          actorUserId,
          target: {
            venueSlug: eligible.evidence.release.venueSlug,
            releaseKind: eligible.evidence.release.releaseKind,
            releaseId: eligible.evidence.release.id,
            releaseDigest: eligible.evidence.release.releaseDigest,
            publicationId: eligible.publication.id,
          },
          targetEligible: true,
          currentChannel: current === null ? null : serializeChannel(current),
          idempotent: null,
          rollbackTargetWasActive,
          eventId: this.createId(),
          updatedAt: iso(updatedAt),
        });
        if (transition.kind === "idempotent") return transition.event;
        let channel: ChannelRow;
        if (current === null) {
          const [inserted] = await tx.insert(reconstructionReleaseChannels).values({
            id: this.createId(),
            venueSlug: transition.channel.venueSlug,
            releaseKind: transition.channel.releaseKind,
            channel: transition.channel.channel,
            activeReleaseId: transition.event.toReleaseId,
            activeReleaseDigest: transition.event.toReleaseDigest,
            activePublicationId: transition.event.toPublicationId,
            revision: transition.channel.revision,
            updatedBy: actorUserId,
            updatedAt,
          }).returning();
          if (inserted === undefined) {
            throw new ReconstructionFoundryEvidenceError(
              "Production channel was not created.",
            );
          }
          channel = inserted;
        } else {
          const [updated] = await tx.update(reconstructionReleaseChannels).set({
            activeReleaseId: transition.event.toReleaseId,
            activeReleaseDigest: transition.event.toReleaseDigest,
            activePublicationId: transition.event.toPublicationId,
            revision: transition.channel.revision,
            updatedBy: actorUserId,
            updatedAt,
          }).where(and(
            eq(reconstructionReleaseChannels.id, current.id),
            eq(reconstructionReleaseChannels.revision, input.expectedRevision),
            eq(reconstructionReleaseChannels.activeReleaseId, current.activeReleaseId),
          )).returning();
          if (updated === undefined) {
            const concurrent = await channelForScope(
              tx,
              current.venueSlug,
              current.releaseKind,
            );
            throw new ReconstructionFoundryRevisionConflictError(
              concurrent?.revision ?? 0,
              concurrent?.activeReleaseId ?? null,
            );
          }
          channel = updated;
        }
        const [event] = await tx.insert(reconstructionReleaseChannelEvents).values({
          id: transition.event.id,
          channelId: channel.id,
          venueSlug: transition.event.venueSlug,
          releaseKind: transition.event.releaseKind,
          channel: transition.event.channel,
          action: transition.event.action,
          fromReleaseId: transition.event.fromReleaseId,
          fromReleaseDigest: transition.event.fromReleaseDigest,
          fromPublicationId: transition.event.fromPublicationId,
          toReleaseId: transition.event.toReleaseId,
          toReleaseDigest: transition.event.toReleaseDigest,
          toPublicationId: transition.event.toPublicationId,
          expectedRevision: transition.event.expectedRevision,
          resultingRevision: transition.event.resultingRevision,
          actorUserId: transition.event.actorUserId,
          idempotencyKey: transition.event.idempotencyKey,
          requestDigest,
          reason: transition.event.reason,
          createdAt: updatedAt,
        }).returning();
        if (event === undefined) {
          throw new ReconstructionFoundryEvidenceError(
            "Production channel event was not appended.",
          );
        }
        return serializeChannelEvent(event);
      });
    } catch (error: unknown) {
      if (error instanceof ReconstructionFoundryRevisionConflictError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const concurrent = await channelForScope(
          this.db,
          target.venueSlug,
          target.releaseKind,
        );
        throw new ReconstructionFoundryRevisionConflictError(
          concurrent?.revision ?? 0,
          concurrent?.activeReleaseId ?? null,
        );
      }
      throw error;
    }
  }

  async getActiveRelease(
    venueSlug: RuntimeSlug,
    releaseKind: ReconstructionReleaseKind = RELEASE_KIND,
  ): Promise<ReconstructionReleasePublicActiveDescriptor> {
    const channel = await channelForScope(this.db, venueSlug, releaseKind);
    if (channel === null) {
      throw new ReconstructionFoundryNotFoundError("No active reconstruction release exists.");
    }
    const eligible = await eligibleRelease(this.db, channel.activeReleaseId);
    await this.reverifyEligibleAttestation(eligible);
    return buildActiveReconstructionReleaseDescriptor({
      requestedVenueSlug: venueSlug,
      requestedReleaseKind: releaseKind,
      eligible: eligible.publicationRow.id === eligible.publication.id,
      channel: serializeChannel(channel),
      release: {
        id: eligible.evidence.release.id,
        venueSlug: eligible.evidence.release.venueSlug,
        releaseKind: eligible.evidence.release.releaseKind,
        releaseDigest: eligible.evidence.release.releaseDigest,
      },
      publication: eligible.publication,
      publicBaseUrl: eligible.publicationRow.publicBaseUrl,
    });
  }
}
