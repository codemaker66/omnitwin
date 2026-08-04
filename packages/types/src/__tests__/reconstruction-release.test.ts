import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION,
  RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
  RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
  RECONSTRUCTION_DSSE_MAX_SIGNATURES,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
  RECONSTRUCTION_QA_CHECK_KEYS,
  RECONSTRUCTION_QA_SCHEMA_VERSION,
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
  ReconstructionCandidateVerificationInputSchema,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionQaReportSchema,
  ReconstructionReleaseAttestationVerificationInputSchema,
  ReconstructionReleaseAttestationMetadataSchema,
  ReconstructionReleaseChannelConflictSchema,
  ReconstructionReleaseChannelEventSchema,
  ReconstructionReleaseChannelSchema,
  ReconstructionReleaseDetailSchema,
  ReconstructionReleaseListSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleasePromoteInputSchema,
  ReconstructionReleasePublicationSchema,
  ReconstructionReleasePublicActiveDescriptorSchema,
  ReconstructionReleaseRegistrationInputSchema,
  ReconstructionReleaseRegistrationSchema,
  ReconstructionReleaseReviewInputSchema,
  ReconstructionReleaseReviewSchema,
  ReconstructionReleaseRollbackInputSchema,
  ReconstructionReleaseSigningPayloadSchema,
  computeReconstructionQaReportDigest,
  computeReconstructionReleaseDigest,
  computeReconstructionReleaseReviewDigest,
  isSafeReconstructionReleasePath,
  type ReconstructionQaCheck,
  type ReconstructionQaReport,
  type ReconstructionQaReportMaterial,
  type ReconstructionReleaseAttestationMetadata,
  type ReconstructionReleaseChannel,
  type ReconstructionReleaseChannelEvent,
  type ReconstructionReleaseFile,
  type ReconstructionReleaseManifest,
  type ReconstructionReleasePublication,
  type ReconstructionReleaseRegistration,
  type ReconstructionReleaseReview,
  type ReconstructionReleaseReviewInput,
  type ReconstructionReleaseReviewMaterial,
} from "../reconstruction-release.js";
import {
  sha256Hex,
} from "../canonical-layout-snapshot.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

const RELEASE_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_ID = "10000000-0000-4000-8000-000000000002";
const ATTESTATION_ID = "10000000-0000-4000-8000-000000000003";
const PUBLICATION_ID = "10000000-0000-4000-8000-000000000004";
const ACTOR_ID = "10000000-0000-4000-8000-000000000005";
const EVENT_ID = "10000000-0000-4000-8000-000000000006";

function releaseFiles(): ReconstructionReleaseFile[] {
  return [
    {
      path: "manifest.json",
      sha256: SHA_A,
      sizeBytes: 512,
      mimeType: "application/json",
      role: "manifest",
    },
    {
      path: "mesh/dollhouse.glb",
      sha256: SHA_B,
      sizeBytes: 2048,
      mimeType: "model/gltf-binary",
      role: "geometry",
    },
    {
      path: "tiles/scan_000/equirect_512.webp",
      sha256: SHA_C,
      sizeBytes: 1024,
      mimeType: "image/webp",
      role: "imagery",
    },
  ];
}

function releaseManifest(): ReconstructionReleaseManifest {
  const files = releaseFiles();
  return ReconstructionReleaseManifestSchema.parse({
    schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
    releaseKind: "venue_twin_v1",
    venueSlug: "trades-hall",
    releaseDigest: computeReconstructionReleaseDigest(files),
    sourceManifestSha256: SHA_A,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    generatedAt: "2026-07-11T08:00:00.000Z",
  });
}

function qaChecks(status: "passed" | "failed" = "passed"): ReconstructionQaCheck[] {
  return RECONSTRUCTION_QA_CHECK_KEYS.map((checkKey, index) => ({
    checkKey,
    status: index === 0 ? status : "passed",
    messageKey: `foundry.${checkKey}.${index === 0 ? status : "passed"}`,
    evidence: [{ label: `${checkKey} evidence`, sha256: SHA_D }],
  }));
}

function qaReport(
  manifest: ReconstructionReleaseManifest,
  firstStatus: "passed" | "failed" = "passed",
): ReconstructionQaReport {
  const material: ReconstructionQaReportMaterial = {
    schemaVersion: RECONSTRUCTION_QA_SCHEMA_VERSION,
    releaseDigest: manifest.releaseDigest,
    sourceManifestSha256: manifest.sourceManifestSha256,
    qaProfileVersion: "twin-qa.v1",
    qaProfileDigest: SHA_E,
    outcome: firstStatus === "passed" ? "passed" : "failed",
    checks: qaChecks(firstStatus),
  };
  return ReconstructionQaReportSchema.parse({
    ...material,
    reportDigest: computeReconstructionQaReportDigest(material),
  });
}

function registration(
  firstStatus: "passed" | "failed" = "passed",
): ReconstructionReleaseRegistration {
  const manifest = releaseManifest();
  return ReconstructionReleaseRegistrationSchema.parse({
    id: RELEASE_ID,
    manifest,
    candidateR2Prefix: `candidates/trades-hall/${manifest.releaseDigest}`,
    candidateManifestR2Key:
      `candidates/trades-hall/${manifest.releaseDigest}/release-manifest.json`,
    qaReport: qaReport(manifest, firstStatus),
    idempotencyKey: "register:trades-hall:release-1",
    state: firstStatus === "passed" ? "awaiting_review" : "machine_qa_failed",
    registeredBy: ACTOR_ID,
    registeredAt: "2026-07-11T08:05:00.000Z",
  });
}

function publicReviewInput(
  registered: ReconstructionReleaseRegistration,
): ReconstructionReleaseReviewInput {
  return {
    releaseId: registered.id,
    releaseDigest: registered.manifest.releaseDigest,
    qaReportDigest: registered.qaReport.reportDigest,
    decision: "approved",
    targetExposure: "public",
    visualEvidence: [
      {
        label: "Reviewed fixed-camera matrix",
        objectKey: "evidence/t484/fixed-camera-matrix.png",
        sha256: SHA_F,
      },
    ],
    transformArtifactRef: {
      artifactId: "e57-to-three-v1",
      artifactDigest: SHA_B,
    },
    sceneAuthorityMapRef: {
      artifactId: "trades-hall-scene-authority-v1",
      artifactDigest: SHA_C,
    },
    note: "Reviewed against the fixed-camera matrix and exact evidence references.",
    idempotencyKey: "review:trades-hall:release-1",
  };
}

function publicReview(
  registered: ReconstructionReleaseRegistration,
): ReconstructionReleaseReview {
  const input = publicReviewInput(registered);
  const material: ReconstructionReleaseReviewMaterial = {
    ...input,
    id: REVIEW_ID,
    reviewerUserId: ACTOR_ID,
    reviewerAuthority: "reconstruction_reviewer",
    reviewedAt: "2026-07-11T08:10:00.000Z",
  };
  return ReconstructionReleaseReviewSchema.parse({
    ...material,
    reviewDigest: computeReconstructionReleaseReviewDigest(material),
  });
}

function attestation(
  registered: ReconstructionReleaseRegistration,
  review: ReconstructionReleaseReview,
): ReconstructionReleaseAttestationMetadata {
  return ReconstructionReleaseAttestationMetadataSchema.parse({
    id: ATTESTATION_ID,
    releaseId: registered.id,
    releaseDigest: registered.manifest.releaseDigest,
    qaReportDigest: registered.qaReport.reportDigest,
    reviewId: review.id,
    reviewDigest: review.reviewDigest,
    format: "dsse_in_toto_v1",
    algorithm: "ed25519",
    keyId: "venviewer-runtime-2026-q3",
    publicKeyFingerprint: SHA_A,
    statementSha256: SHA_B,
    envelopeSha256: SHA_C,
    r2Key: `candidates/trades-hall/${registered.manifest.releaseDigest}/attestations/runtime-package.dsse.json`,
    verifiedAt: "2026-07-11T08:16:00.000Z",
    verifiedBy: ACTOR_ID,
  });
}

function signingPayload(
  registered: ReconstructionReleaseRegistration,
  review: ReconstructionReleaseReview,
) {
  const statement = {
    _type: RECONSTRUCTION_IN_TOTO_STATEMENT_TYPE,
    subject: [{
      name: `reconstruction-release/${registered.manifest.venueSlug}/${registered.manifest.releaseDigest}`,
      digest: { sha256: registered.manifest.releaseDigest },
    }],
    predicateType: RECONSTRUCTION_ATTESTATION_PREDICATE_TYPE,
    predicate: {
      schemaVersion: RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
      venueSlug: registered.manifest.venueSlug,
      releaseKind: registered.manifest.releaseKind,
      releaseId: registered.id,
      releaseDigest: registered.manifest.releaseDigest,
      sourceManifestSha256: registered.manifest.sourceManifestSha256,
      releaseManifestSha256: SHA_D,
      qaReportDigest: registered.qaReport.reportDigest,
      reviewId: review.id,
      reviewDigest: review.reviewDigest,
      reviewedAt: review.reviewedAt,
      reviewerUserId: review.reviewerUserId,
      decision: "approved" as const,
      targetExposure: "public" as const,
      visualEvidence: review.visualEvidence,
      transformArtifactRef: review.transformArtifactRef,
      sceneAuthorityMapRef: review.sceneAuthorityMapRef,
    },
  };
  const payloadUtf8 = JSON.stringify(statement, null, 2);
  const bytes = Buffer.from(payloadUtf8, "utf8");
  return ReconstructionReleaseSigningPayloadSchema.parse({
    schemaVersion: RECONSTRUCTION_SIGNING_PAYLOAD_SCHEMA_VERSION,
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    releaseId: registered.id,
    releaseDigest: registered.manifest.releaseDigest,
    qaReportDigest: registered.qaReport.reportDigest,
    reviewId: review.id,
    reviewDigest: review.reviewDigest,
    statement,
    payloadUtf8,
    payloadBase64: bytes.toString("base64"),
    payloadSha256: sha256Hex(bytes),
    payloadByteLength: bytes.byteLength,
  });
}

function publication(
  registered: ReconstructionReleaseRegistration,
  review: ReconstructionReleaseReview,
  signed: ReconstructionReleaseAttestationMetadata,
): ReconstructionReleasePublication {
  const digest = registered.manifest.releaseDigest;
  const publicR2Prefix = `releases/sha256/${digest.slice(0, 2)}/${digest}`;
  return ReconstructionReleasePublicationSchema.parse({
    id: PUBLICATION_ID,
    releaseId: registered.id,
    releaseDigest: digest,
    qaReportDigest: registered.qaReport.reportDigest,
    reviewId: review.id,
    reviewDigest: review.reviewDigest,
    attestationId: signed.id,
    attestationEnvelopeSha256: signed.envelopeSha256,
    idempotencyKey: "publish:trades-hall:release-1",
    note: "Copy the approved candidate to immutable public delivery storage.",
    candidateR2Prefix: registered.candidateR2Prefix,
    publicR2Prefix,
    publicManifestR2Key: `${publicR2Prefix}/manifest.json`,
    publicManifestUrl: `https://twin.venviewer.com/${publicR2Prefix}/manifest.json`,
    manifestSha256: registered.manifest.sourceManifestSha256,
    fileCount: registered.manifest.fileCount,
    totalBytes: registered.manifest.totalBytes,
    publishedBy: ACTOR_ID,
    publishedAt: "2026-07-11T08:20:00.000Z",
    verifiedAt: "2026-07-11T08:22:00.000Z",
  });
}

function productionChannel(
  registered: ReconstructionReleaseRegistration,
  published: ReconstructionReleasePublication,
): ReconstructionReleaseChannel {
  return ReconstructionReleaseChannelSchema.parse({
    venueSlug: registered.manifest.venueSlug,
    releaseKind: registered.manifest.releaseKind,
    channel: "production",
    activeReleaseId: registered.id,
    activeReleaseDigest: registered.manifest.releaseDigest,
    activePublicationId: published.id,
    revision: 1,
    updatedBy: ACTOR_ID,
    updatedAt: "2026-07-11T08:25:00.000Z",
  });
}

function promotionEvent(
  registered: ReconstructionReleaseRegistration,
  published: ReconstructionReleasePublication,
): ReconstructionReleaseChannelEvent {
  return ReconstructionReleaseChannelEventSchema.parse({
    id: EVENT_ID,
    venueSlug: registered.manifest.venueSlug,
    releaseKind: registered.manifest.releaseKind,
    channel: "production",
    action: "promote",
    fromReleaseId: null,
    fromReleaseDigest: null,
    fromPublicationId: null,
    toReleaseId: registered.id,
    toReleaseDigest: registered.manifest.releaseDigest,
    toPublicationId: published.id,
    expectedRevision: 0,
    resultingRevision: 1,
    actorUserId: ACTOR_ID,
    idempotencyKey: "promote:trades-hall:release-1",
    reason: "Promote the reviewed immutable release to the production pointer.",
    createdAt: "2026-07-11T08:25:00.000Z",
  });
}

describe("Reconstruction Release Foundry contracts", () => {
  it("pins the release, QA, and channel vocabularies", () => {
    expect(RECONSTRUCTION_RELEASE_SCHEMA_VERSION).toBe("venviewer.reconstruction-release.v1");
    expect(RECONSTRUCTION_QA_SCHEMA_VERSION).toBe("venviewer.reconstruction-qa.v1");
    expect(RECONSTRUCTION_QA_CHECK_KEYS).toEqual([
      "manifest_schema",
      "exact_file_set",
      "content_hashes",
      "image_dimensions",
      "mesh_structure",
      "mesh_budget",
      "navigation_graph",
      "coordinate_frame",
    ]);
  });

  it("computes a deterministic release digest but requires canonical inventory order", () => {
    const manifest = releaseManifest();
    expect(computeReconstructionReleaseDigest([...manifest.files].reverse())).toBe(
      manifest.releaseDigest,
    );
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      files: [...manifest.files].reverse(),
    }).success).toBe(false);
  });

  it("rejects unsafe, duplicate, case-colliding, or digest-inconsistent inventory", () => {
    expect(isSafeReconstructionReleasePath("tiles/scan_000/pano.webp")).toBe(true);
    for (const unsafe of ["../secret", "/root/file", "a\\b", "a//b", "a?b", "a#b"]) {
      expect(isSafeReconstructionReleasePath(unsafe)).toBe(false);
    }

    const manifest = releaseManifest();
    const duplicate = [...manifest.files, manifest.files[0]!];
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      files: duplicate,
      fileCount: duplicate.length,
      totalBytes: duplicate.reduce((total, file) => total + file.sizeBytes, 0),
      releaseDigest: computeReconstructionReleaseDigest(duplicate),
    }).success).toBe(false);

    const caseCollision = manifest.files.map((file, index) =>
      index === 1 ? { ...file, path: "MANIFEST.JSON", role: "other" as const } : file,
    ).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      files: caseCollision,
      sourceManifestSha256: SHA_A,
      releaseDigest: computeReconstructionReleaseDigest(caseCollision),
    }).success).toBe(false);

    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      sourceManifestSha256: SHA_F,
    }).success).toBe(false);
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      fileCount: 99,
    }).success).toBe(false);
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      totalBytes: manifest.totalBytes + 1,
    }).success).toBe(false);
    expect(ReconstructionReleaseManifestSchema.safeParse({
      ...manifest,
      releaseDigest: SHA_F,
    }).success).toBe(false);
  });

  it("binds deterministic QA outcome, complete checks, and report digest", () => {
    const manifest = releaseManifest();
    const passed = qaReport(manifest);
    expect(passed.outcome).toBe("passed");
    expect(ReconstructionQaReportSchema.safeParse({
      ...passed,
      reportDigest: SHA_F,
    }).success).toBe(false);

    const duplicatedChecks = passed.checks.map((check, index) =>
      index === passed.checks.length - 1 ? passed.checks[0]! : check,
    );
    expect(ReconstructionQaReportSchema.safeParse({
      ...passed,
      checks: duplicatedChecks,
    }).success).toBe(false);
    expect(ReconstructionQaReportSchema.safeParse({
      ...passed,
      outcome: "failed",
    }).success).toBe(false);

    const failed = qaReport(manifest, "failed");
    expect(failed.outcome).toBe("failed");
  });

  it("keeps registration private, digest-addressed, and QA-bound", () => {
    const valid = registration();
    expect(valid.state).toBe("awaiting_review");
    expect(ReconstructionReleaseRegistrationInputSchema.safeParse({
      manifest: valid.manifest,
      candidateR2Prefix: valid.candidateR2Prefix,
      candidateManifestR2Key: valid.candidateManifestR2Key,
      qaReport: valid.qaReport,
      idempotencyKey: valid.idempotencyKey,
    }).success).toBe(true);

    expect(ReconstructionReleaseRegistrationInputSchema.safeParse({
      manifest: valid.manifest,
      candidateR2Prefix: "candidates/trades-hall/latest",
      candidateManifestR2Key: valid.candidateManifestR2Key,
      qaReport: valid.qaReport,
      idempotencyKey: valid.idempotencyKey,
    }).success).toBe(false);
    expect(ReconstructionReleaseRegistrationInputSchema.safeParse({
      manifest: valid.manifest,
      candidateR2Prefix: valid.candidateR2Prefix,
      candidateManifestR2Key: valid.candidateManifestR2Key,
      qaReport: { ...valid.qaReport, releaseDigest: SHA_F },
      idempotencyKey: valid.idempotencyKey,
    }).success).toBe(false);
    expect(registration("failed").state).toBe("machine_qa_failed");
  });

  it("requires visual, transform, and Scene Authority evidence for public approval", () => {
    const registered = registration();
    const input = publicReviewInput(registered);
    expect(ReconstructionReleaseReviewInputSchema.safeParse(input).success).toBe(true);
    expect(ReconstructionReleaseReviewInputSchema.safeParse({
      ...input,
      transformArtifactRef: null,
    }).success).toBe(false);
    expect(ReconstructionReleaseReviewInputSchema.safeParse({
      ...input,
      sceneAuthorityMapRef: null,
    }).success).toBe(false);
    expect(ReconstructionReleaseReviewInputSchema.safeParse({
      ...input,
      visualEvidence: [],
    }).success).toBe(false);

    expect(ReconstructionReleaseReviewInputSchema.safeParse({
      ...input,
      decision: "rejected",
      transformArtifactRef: null,
      sceneAuthorityMapRef: null,
    }).success).toBe(true);
  });

  it("makes the human review digest tamper-evident", () => {
    const review = publicReview(registration());
    expect(ReconstructionReleaseReviewSchema.safeParse(review).success).toBe(true);
    expect(ReconstructionReleaseReviewSchema.safeParse({
      ...review,
      note: `${review.note} Altered after review.`,
    }).success).toBe(false);
  });

  it("pins detached DSSE metadata without inventing a signing timestamp", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    expect(signed.format).toBe("dsse_in_toto_v1");
    expect(signed.algorithm).toBe("ed25519");
    expect(ReconstructionReleaseAttestationMetadataSchema.safeParse({
      ...signed,
      signedAt: "2026-07-11T08:15:00.000Z",
    }).success).toBe(false);
    expect(ReconstructionReleaseAttestationMetadataSchema.safeParse({
      ...signed,
      embeddedInManifest: true,
    }).success).toBe(false);
  });

  it("binds candidate verification and submitted DSSE envelopes to explicit idempotency keys", () => {
    const registered = registration();
    const review = publicReview(registered);
    const payload = signingPayload(registered, review);
    expect(ReconstructionCandidateVerificationInputSchema.safeParse({
      candidateR2Prefix: registered.candidateR2Prefix,
      idempotencyKey: "verify-candidate:release-1",
    }).success).toBe(true);
    expect(ReconstructionReleaseAttestationVerificationInputSchema.safeParse({
      reviewId: review.id,
      envelope: {
        payloadType: payload.payloadType,
        payload: payload.payloadBase64,
        signatures: [{
          keyid: "venviewer-runtime-2026-q3",
          sig: Buffer.alloc(64, 1).toString("base64"),
        }],
      },
      idempotencyKey: "verify-attestation:release-1",
    }).success).toBe(true);
  });

  it("rejects malleable, duplicate, oversized, or non-Ed25519 DSSE signature encodings", () => {
    const signature = Buffer.alloc(64, 1).toString("base64");
    const envelope = {
      payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
      payload: Buffer.from("payload", "utf8").toString("base64"),
      signatures: [{ keyid: "venviewer-runtime-2026-q3", sig: signature }],
    };
    expect(ReconstructionDsseEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      ...envelope,
      payload: "AAB=",
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      ...envelope,
      signatures: [{ ...envelope.signatures[0], sig: `${signature.slice(0, -4)}AR==` }],
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      ...envelope,
      signatures: [{ ...envelope.signatures[0], sig: "YQ==" }],
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      ...envelope,
      signatures: [envelope.signatures[0], envelope.signatures[0]],
    }).success).toBe(false);
    expect(ReconstructionDsseEnvelopeSchema.safeParse({
      ...envelope,
      signatures: Array.from(
        { length: RECONSTRUCTION_DSSE_MAX_SIGNATURES + 1 },
        (_, index) => ({ keyid: `key-${String(index)}`, sig: signature }),
      ),
    }).success).toBe(false);
  });

  it("makes every signing-payload byte representation self-verifying", () => {
    const registered = registration();
    const review = publicReview(registered);
    const payload = signingPayload(registered, review);
    expect(payload.payloadType).toBe(RECONSTRUCTION_DSSE_PAYLOAD_TYPE);
    for (const mutation of [
      { payloadUtf8: `${payload.payloadUtf8} ` },
      { payloadBase64: Buffer.from(`${payload.payloadUtf8} `, "utf8").toString("base64") },
      { payloadSha256: SHA_F },
      { payloadByteLength: payload.payloadByteLength + 1 },
    ]) {
      expect(ReconstructionReleaseSigningPayloadSchema.safeParse({
        ...payload,
        ...mutation,
      }).success).toBe(false);
    }
  });

  it("requires publication to use the immutable public digest prefix and verified HTTPS URL", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    expect(published.publicR2Prefix).toContain(registered.manifest.releaseDigest);

    expect(ReconstructionReleasePublicationSchema.safeParse({
      ...published,
      publicR2Prefix: "releases/latest/trades-hall",
    }).success).toBe(false);
    expect(ReconstructionReleasePublicationSchema.safeParse({
      ...published,
      publicManifestUrl: published.publicManifestUrl.replace("https://", "http://"),
    }).success).toBe(false);
    expect(ReconstructionReleasePublicationSchema.safeParse({
      ...published,
      verifiedAt: "2026-07-11T08:19:00.000Z",
    }).success).toBe(false);
  });

  it("enforces coherent production pointers and standard revision conflicts", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const channel = productionChannel(registered, published);
    expect(channel.revision).toBe(1);
    expect(ReconstructionReleaseChannelSchema.safeParse({
      ...channel,
      activePublicationId: null,
    }).success).toBe(false);

    expect(ReconstructionReleaseChannelConflictSchema.parse({
      code: "REVISION_CONFLICT",
      currentRevision: 2,
      currentReleaseId: registered.id,
    }).code).toBe("REVISION_CONFLICT");
  });

  it("validates promote and rollback commands before channel mutation", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const transition = {
      targetReleaseId: registered.id,
      targetReleaseDigest: registered.manifest.releaseDigest,
      targetPublicationId: published.id,
      expectedRevision: 0,
      expectedActiveReleaseId: null,
      idempotencyKey: "promote:release-1",
      reason: "Move the exact reviewed publication onto the production pointer.",
    };
    expect(ReconstructionReleasePromoteInputSchema.safeParse(transition).success).toBe(true);

    expect(ReconstructionReleaseRollbackInputSchema.safeParse({
      ...transition,
      expectedRevision: 2,
      expectedActiveReleaseId: registered.id,
    }).success).toBe(false);
  });

  it("requires channel events to describe exactly one CAS revision", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const event = promotionEvent(registered, published);
    expect(event.resultingRevision).toBe(1);
    expect(ReconstructionReleaseChannelEventSchema.safeParse({
      ...event,
      resultingRevision: 2,
    }).success).toBe(false);
    expect(ReconstructionReleaseChannelEventSchema.safeParse({
      ...event,
      action: "rollback",
    }).success).toBe(false);
  });

  it("binds detail publication and the active pointer to one exact evidence chain", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const channel = productionChannel(registered, published);
    const event = promotionEvent(registered, published);
    const detail = {
      registration: registered,
      reviews: [review],
      attestations: [signed],
      publication: published,
      productionChannel: channel,
      channelEvents: [event],
      state: "active" as const,
    };
    expect(ReconstructionReleaseDetailSchema.safeParse(detail).success).toBe(true);
    expect(ReconstructionReleaseDetailSchema.safeParse({
      ...detail,
      publication: { ...published, qaReportDigest: SHA_F },
    }).success).toBe(false);
    expect(ReconstructionReleaseDetailSchema.safeParse({
      ...detail,
      productionChannel: { ...channel, activeReleaseDigest: SHA_F },
    }).success).toBe(false);
  });

  it("provides a strict list summary without weakening publication gates", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const channel = productionChannel(registered, published);
    const list = ReconstructionReleaseListSchema.parse({
      releases: [{
        id: registered.id,
        venueSlug: registered.manifest.venueSlug,
        releaseKind: registered.manifest.releaseKind,
        releaseDigest: registered.manifest.releaseDigest,
        sourceManifestSha256: registered.manifest.sourceManifestSha256,
        fileCount: registered.manifest.fileCount,
        totalBytes: registered.manifest.totalBytes,
        qaOutcome: registered.qaReport.outcome,
        qaReportDigest: registered.qaReport.reportDigest,
        latestReviewDecision: review.decision,
        latestReviewTargetExposure: review.targetExposure,
        attested: true,
        published: true,
        active: true,
        state: "active",
        registeredAt: registered.registeredAt,
      }],
      productionChannel: channel,
    });
    expect(list.releases[0]?.active).toBe(true);
    expect(ReconstructionReleaseListSchema.safeParse({
      ...list,
      releases: [{ ...list.releases[0]!, attested: false }],
    }).success).toBe(false);
  });

  it("returns only an immutable digest-addressed public descriptor", () => {
    const registered = registration();
    const review = publicReview(registered);
    const signed = attestation(registered, review);
    const published = publication(registered, review, signed);
    const base = published.publicManifestUrl.replace(/\/manifest\.json$/u, "");
    const descriptor = ReconstructionReleasePublicActiveDescriptorSchema.parse({
      schemaVersion: RECONSTRUCTION_ACTIVE_RELEASE_SCHEMA_VERSION,
      venueSlug: registered.manifest.venueSlug,
      releaseKind: registered.manifest.releaseKind,
      channel: "production",
      releaseId: registered.id,
      releaseDigest: registered.manifest.releaseDigest,
      publicationId: published.id,
      manifestSha256: published.manifestSha256,
      manifestUrl: published.publicManifestUrl,
      assetBaseUrl: base,
      channelRevision: 1,
    });
    expect(descriptor.assetBaseUrl.endsWith(descriptor.releaseDigest)).toBe(true);
    expect(ReconstructionReleasePublicActiveDescriptorSchema.safeParse({
      ...descriptor,
      assetBaseUrl: "https://twin.venviewer.com/releases/latest",
    }).success).toBe(false);
    expect(ReconstructionReleasePublicActiveDescriptorSchema.safeParse({
      ...descriptor,
      manifestUrl: `${descriptor.assetBaseUrl}/other.json`,
    }).success).toBe(false);
  });
});
