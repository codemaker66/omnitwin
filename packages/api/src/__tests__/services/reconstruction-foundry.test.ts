import {
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  ReconstructionReleaseAttestationMetadataSchema,
  ReconstructionReleaseChannelSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleasePublicationSchema,
  ReconstructionReleaseReviewSchema,
  computeReconstructionReleaseDigest,
  computeReconstructionReleaseReviewDigest,
  type ReconstructionReleaseReviewMaterial,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  buildReconstructionReleaseSigningPayload,
  buildActiveReconstructionReleaseDescriptor,
  currentReconstructionPublication,
  deriveReconstructionReleaseState,
  planReconstructionChannelTransition,
  reconstructionVisualEvidenceExistsInManifest,
  ReconstructionFoundryEligibilityError,
  ReconstructionFoundryRevisionConflictError,
} from "../../services/reconstruction-foundry.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const RELEASE_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_ID = "10000000-0000-4000-8000-000000000002";
const ACTOR_ID = "10000000-0000-4000-8000-000000000003";
const ATTESTATION_ID = "10000000-0000-4000-8000-000000000004";
const PUBLICATION_ID = "10000000-0000-4000-8000-000000000005";
const OTHER_RELEASE_ID = "10000000-0000-4000-8000-000000000006";
const OTHER_PUBLICATION_ID = "10000000-0000-4000-8000-000000000007";
const EVENT_ID = "10000000-0000-4000-8000-000000000008";

function manifest() {
  const files = [
    {
      path: "manifest.json",
      sha256: SHA_A,
      sizeBytes: 512,
      mimeType: "application/json",
      role: "manifest" as const,
    },
    {
      path: "tiles/scan_000/equirect_512.webp",
      sha256: SHA_B,
      sizeBytes: 1024,
      mimeType: "image/webp",
      role: "imagery" as const,
    },
  ];
  return ReconstructionReleaseManifestSchema.parse({
    schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
    releaseKind: "venue_twin_v1",
    venueSlug: "trades-hall",
    releaseDigest: computeReconstructionReleaseDigest(files),
    sourceManifestSha256: SHA_A,
    files,
    fileCount: files.length,
    totalBytes: 1536,
    generatedAt: "2026-07-11T08:00:00.000Z",
  });
}

function publicReview() {
  const release = manifest();
  const material: ReconstructionReleaseReviewMaterial = {
    releaseId: RELEASE_ID,
    releaseDigest: release.releaseDigest,
    qaReportDigest: SHA_C,
    decision: "approved",
    targetExposure: "public",
    visualEvidence: [{
      label: "Fixed camera comparison",
      objectKey: "tiles/scan_000/equirect_512.webp",
      sha256: SHA_B,
    }],
    transformArtifactRef: { artifactId: "e57-to-three-v1", artifactDigest: SHA_C },
    sceneAuthorityMapRef: { artifactId: "scene-authority-v1", artifactDigest: SHA_D },
    note: "Exact fixed-camera evidence and authority references were reviewed.",
    idempotencyKey: "review:trades-hall:one",
    id: REVIEW_ID,
    reviewerUserId: ACTOR_ID,
    reviewerAuthority: "platform_admin",
    reviewedAt: "2026-07-11T08:10:00.000Z",
  };
  return ReconstructionReleaseReviewSchema.parse({
    ...material,
    reviewDigest: computeReconstructionReleaseReviewDigest(material),
  });
}

function verifiedAttestation() {
  const release = manifest();
  const review = publicReview();
  return ReconstructionReleaseAttestationMetadataSchema.parse({
    id: ATTESTATION_ID,
    releaseId: RELEASE_ID,
    releaseDigest: release.releaseDigest,
    qaReportDigest: SHA_C,
    reviewId: REVIEW_ID,
    reviewDigest: review.reviewDigest,
    format: "dsse_in_toto_v1",
    algorithm: "ed25519",
    keyId: "trusted-key",
    publicKeyFingerprint: SHA_A,
    statementSha256: SHA_B,
    envelopeSha256: SHA_C,
    r2Key: `candidates/trades-hall/${release.releaseDigest}/attestations/${SHA_C}.dsse.json`,
    verifiedAt: "2026-07-11T08:20:00.000Z",
    verifiedBy: ACTOR_ID,
  });
}

function publishedRelease() {
  const release = manifest();
  const review = publicReview();
  const prefix = `releases/sha256/${release.releaseDigest.slice(0, 2)}/${release.releaseDigest}`;
  return ReconstructionReleasePublicationSchema.parse({
    id: PUBLICATION_ID,
    releaseId: RELEASE_ID,
    releaseDigest: release.releaseDigest,
    qaReportDigest: SHA_C,
    reviewId: REVIEW_ID,
    reviewDigest: review.reviewDigest,
    attestationId: ATTESTATION_ID,
    attestationEnvelopeSha256: SHA_C,
    idempotencyKey: "publish:trades-hall:one",
    note: "Verified immutable public publication for this exact evidence epoch.",
    candidateR2Prefix: `candidates/trades-hall/${release.releaseDigest}`,
    publicR2Prefix: prefix,
    publicManifestR2Key: `${prefix}/manifest.json`,
    publicManifestUrl: `https://twin.venviewer.com/${prefix}/manifest.json`,
    manifestSha256: SHA_A,
    fileCount: release.fileCount,
    totalBytes: release.totalBytes,
    publishedBy: ACTOR_ID,
    publishedAt: "2026-07-11T08:21:00.000Z",
    verifiedAt: "2026-07-11T08:22:00.000Z",
  });
}

function supersedingPublicReview() {
  const original = publicReview();
  const material: ReconstructionReleaseReviewMaterial = {
    releaseId: original.releaseId,
    releaseDigest: original.releaseDigest,
    qaReportDigest: original.qaReportDigest,
    decision: original.decision,
    targetExposure: original.targetExposure,
    visualEvidence: original.visualEvidence,
    transformArtifactRef: original.transformArtifactRef,
    sceneAuthorityMapRef: original.sceneAuthorityMapRef,
    note: "A newer exact public approval supersedes the previous evidence epoch.",
    idempotencyKey: "review:trades-hall:two",
    id: OTHER_RELEASE_ID,
    reviewerUserId: ACTOR_ID,
    reviewerAuthority: "platform_admin",
    reviewedAt: "2026-07-11T09:10:00.000Z",
  };
  return ReconstructionReleaseReviewSchema.parse({
    ...material,
    reviewDigest: computeReconstructionReleaseReviewDigest(material),
  });
}

describe("Reconstruction Foundry evidence gates", () => {
  it("builds one deterministic, timestamp-free in-toto payload from persisted evidence", () => {
    const release = manifest();
    const review = publicReview();
    const input = {
      release: {
        id: RELEASE_ID,
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        releaseDigest: release.releaseDigest,
        sourceManifestSha256: release.sourceManifestSha256,
        releaseManifestSha256: SHA_D,
      },
      qaReportDigest: SHA_C,
      review,
    };
    const first = buildReconstructionReleaseSigningPayload(input);
    const second = buildReconstructionReleaseSigningPayload(input);
    expect(second).toEqual(first);
    expect(Buffer.from(first.payloadBase64, "base64").toString("utf8")).toBe(first.payloadUtf8);
    expect(first.payloadByteLength).toBe(Buffer.byteLength(first.payloadUtf8, "utf8"));
    expect(first.statement.predicate.reviewDigest).toBe(review.reviewDigest);
    expect("signedAt" in first).toBe(false);
    expect("statementCreatedAt" in first.statement.predicate).toBe(false);
  });

  it("rejects typed visual evidence that is absent or digest-mismatched in the manifest", () => {
    const release = manifest();
    const evidence = publicReview().visualEvidence;
    expect(reconstructionVisualEvidenceExistsInManifest(release, evidence)).toBe(true);
    expect(reconstructionVisualEvidenceExistsInManifest(release, [{
      ...evidence[0]!,
      sha256: SHA_D,
    }])).toBe(false);
    expect(reconstructionVisualEvidenceExistsInManifest(release, [{
      ...evidence[0]!,
      objectKey: "evidence/not-in-release.png",
    }])).toBe(false);
  });

  it("derives state only from the latest exact evidence epoch", () => {
    const review = publicReview();
    const attestation = verifiedAttestation();
    const publication = publishedRelease();
    const base = {
      qaOutcome: "passed" as const,
      latestReview: review,
      matchingAttestation: null,
      matchingPublication: null,
      productionChannel: null,
      releaseId: RELEASE_ID,
    };
    expect(deriveReconstructionReleaseState({ ...base, latestReview: null })).toBe("awaiting_review");
    expect(deriveReconstructionReleaseState(base)).toBe("awaiting_attestation");
    expect(deriveReconstructionReleaseState({
      ...base,
      matchingAttestation: attestation,
    })).toBe("ready_to_publish");
    expect(deriveReconstructionReleaseState({
      ...base,
      matchingAttestation: attestation,
      matchingPublication: publication,
    })).toBe("published");
  });

  it("treats a publication as current only for its exact review and attestation epoch", () => {
    const publication = publishedRelease();
    const review = publicReview();
    const attestation = verifiedAttestation();
    expect(currentReconstructionPublication(publication, review, attestation)).toEqual(publication);
    expect(currentReconstructionPublication(
      publication,
      supersedingPublicReview(),
      attestation,
    )).toBeNull();
    expect(currentReconstructionPublication(publication, review, {
      ...attestation,
      id: OTHER_PUBLICATION_ID,
    })).toBeNull();
  });

  it("plans initial promotion, rejects stale CAS, and returns exact idempotent retries", () => {
    const release = manifest();
    const request = {
      targetReleaseId: RELEASE_ID,
      targetReleaseDigest: release.releaseDigest,
      targetPublicationId: PUBLICATION_ID,
      expectedRevision: 0,
      expectedActiveReleaseId: null,
      idempotencyKey: "promote:trades-hall:one",
      reason: "Promote the exact approved and verified publication to production.",
    } as const;
    const target = {
      venueSlug: release.venueSlug,
      releaseKind: release.releaseKind,
      releaseId: RELEASE_ID,
      releaseDigest: release.releaseDigest,
      publicationId: PUBLICATION_ID,
    };
    const initial = planReconstructionChannelTransition({
      action: "promote",
      request,
      requestDigest: SHA_D,
      actorUserId: ACTOR_ID,
      target,
      targetEligible: true,
      currentChannel: null,
      idempotent: null,
      rollbackTargetWasActive: false,
      eventId: EVENT_ID,
      updatedAt: "2026-07-11T08:30:00.000Z",
    });
    expect(initial.kind).toBe("advance");
    if (initial.kind !== "advance") throw new Error("expected an advancing transition");
    expect(initial.channel.revision).toBe(1);
    expect(initial.event.fromReleaseId).toBeNull();
    expect(() => planReconstructionChannelTransition({
      action: "promote",
      request,
      requestDigest: SHA_D,
      actorUserId: ACTOR_ID,
      target,
      targetEligible: true,
      currentChannel: initial.channel,
      idempotent: null,
      rollbackTargetWasActive: false,
      eventId: EVENT_ID,
      updatedAt: "2026-07-11T08:31:00.000Z",
    })).toThrow(ReconstructionFoundryRevisionConflictError);
    const retry = planReconstructionChannelTransition({
      action: "promote",
      request,
      requestDigest: SHA_D,
      actorUserId: ACTOR_ID,
      target,
      targetEligible: false,
      currentChannel: initial.channel,
      idempotent: { event: initial.event, requestDigest: SHA_D },
      rollbackTargetWasActive: false,
      eventId: EVENT_ID,
      updatedAt: "2026-07-11T08:32:00.000Z",
    });
    expect(retry).toEqual({ kind: "idempotent", event: initial.event });
  });

  it("rejects rollback targets that were never active and revalidates eligibility", () => {
    const release = manifest();
    const current = ReconstructionReleaseChannelSchema.parse({
      venueSlug: release.venueSlug,
      releaseKind: release.releaseKind,
      channel: "production",
      activeReleaseId: OTHER_RELEASE_ID,
      activeReleaseDigest: SHA_D,
      activePublicationId: OTHER_PUBLICATION_ID,
      revision: 2,
      updatedBy: ACTOR_ID,
      updatedAt: "2026-07-11T09:00:00.000Z",
    });
    const request = {
      targetReleaseId: RELEASE_ID,
      targetReleaseDigest: release.releaseDigest,
      targetPublicationId: PUBLICATION_ID,
      expectedRevision: 2,
      expectedActiveReleaseId: OTHER_RELEASE_ID,
      idempotencyKey: "rollback:trades-hall:one",
      reason: "Roll back to the previously verified immutable release publication.",
    } as const;
    const base = {
      action: "rollback" as const,
      request,
      requestDigest: SHA_C,
      actorUserId: ACTOR_ID,
      target: {
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        releaseId: RELEASE_ID,
        releaseDigest: release.releaseDigest,
        publicationId: PUBLICATION_ID,
      },
      currentChannel: current,
      idempotent: null,
      eventId: EVENT_ID,
      updatedAt: "2026-07-11T09:05:00.000Z",
    };
    expect(() => planReconstructionChannelTransition({
      ...base,
      targetEligible: true,
      rollbackTargetWasActive: false,
    })).toThrow(ReconstructionFoundryEligibilityError);
    expect(() => planReconstructionChannelTransition({
      ...base,
      targetEligible: false,
      rollbackTargetWasActive: true,
    })).toThrow(ReconstructionFoundryEligibilityError);
  });

  it("builds the public active descriptor only for an exact eligible pointer", () => {
    const release = manifest();
    const publication = publishedRelease();
    const channel = ReconstructionReleaseChannelSchema.parse({
      venueSlug: release.venueSlug,
      releaseKind: release.releaseKind,
      channel: "production",
      activeReleaseId: RELEASE_ID,
      activeReleaseDigest: release.releaseDigest,
      activePublicationId: PUBLICATION_ID,
      revision: 3,
      updatedBy: ACTOR_ID,
      updatedAt: "2026-07-11T09:20:00.000Z",
    });
    const input = {
      requestedVenueSlug: release.venueSlug,
      requestedReleaseKind: release.releaseKind,
      eligible: true,
      channel,
      release: {
        id: RELEASE_ID,
        venueSlug: release.venueSlug,
        releaseKind: release.releaseKind,
        releaseDigest: release.releaseDigest,
      },
      publication,
      publicBaseUrl: publication.publicManifestUrl.replace(/\/manifest\.json$/u, ""),
    };
    expect(buildActiveReconstructionReleaseDescriptor(input)).toMatchObject({
      releaseId: RELEASE_ID,
      publicationId: PUBLICATION_ID,
      channelRevision: 3,
    });
    expect(() => buildActiveReconstructionReleaseDescriptor({
      ...input,
      eligible: false,
    })).toThrow(ReconstructionFoundryEligibilityError);
    expect(() => buildActiveReconstructionReleaseDescriptor({
      ...input,
      channel: { ...channel, activePublicationId: OTHER_PUBLICATION_ID },
    })).toThrow(ReconstructionFoundryEligibilityError);
  });
});
