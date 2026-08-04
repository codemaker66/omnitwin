import { describe, expect, it } from "vitest";
import {
  FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0,
  FoundryOfflineReviewPackageV0Schema,
  buildFoundryOfflineReviewPackageV0,
  computeFoundryOfflineReviewPackageSha256,
  type FoundryOfflineReviewArtifactV0,
  type FoundryOfflineReviewPackageMaterialV0,
} from "../omnitwin-foundry-offline-review.js";
import { ReconstructionReleaseReviewInputSchema } from "../reconstruction-release.js";
import { ReconstructionReleaseSigningPayloadSchema } from "../reconstruction-release.js";
import { ReconstructionReviewEvidenceArtifactRegistrationInputSchema } from "../reconstruction-review-evidence.js";
import { TransformArtifactV0Schema } from "../runtime-venue-manifest.js";

const NOW = "2026-07-13T10:00:00.000Z";

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function artifact(
  id: string,
  kind: FoundryOfflineReviewArtifactV0["kind"],
  relativePath: string,
  digest: number,
): FoundryOfflineReviewArtifactV0 {
  return {
    id,
    kind,
    relativePath,
    sha256: sha(digest),
    byteLength: 100 + digest,
    mediaType: relativePath.endsWith(".png") ? "image/png" : "application/json",
  };
}

function artifacts(): FoundryOfflineReviewArtifactV0[] {
  return [
    artifact("fixed-view", "fixed_view", "fixed/identity-overview.png", 1),
    artifact("ingest", "ingest_manifest", "foundry-ingest-manifest-v0.json", 2),
    artifact("bundle", "phase1_bundle", "foundry-phase1-bundle-v0.json", 3),
    artifact("identity", "identity_review", "identity-review.json", 4),
    artifact("inspection", "source_inspection", "inspections/e57-inspection.json", 5),
    artifact(
      "proposal",
      "transform_proposal",
      "proposals/colmap-to-e57-transform.json",
      6,
    ),
    artifact(
      "residuals",
      "residual_report",
      "reports/colmap-to-e57-residual-report.json",
      7,
    ),
  ];
}

function material(): FoundryOfflineReviewPackageMaterialV0 {
  return {
    schemaVersion: FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0,
    packageId: "grand-hall-t486-offline-preflight",
    projectId: "grand-hall-phase1",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: NOW,
    createdBy: "codex:evidence-preparer",
    mode: "offline_unsigned_preflight",
    authority: "none",
    subjectArtifactId: "bundle",
    artifacts: artifacts(),
    readiness: {
      evidenceReview: { status: "ready", blockers: [] },
      publicApproval: {
        status: "not_ready_offline",
        requirements: [
          "Register a reviewed TransformArtifactV0 and Scene Authority Map through T-486.",
        ],
      },
      signing: {
        status: "not_ready_unsigned",
        requirements: [
          "Persist an evidence-complete public approval and obtain server-issued signing bytes.",
        ],
      },
    },
  };
}

describe("OmniTwin Foundry offline review package", () => {
  it("accepts a digest-bound phase-one evidence-review package", () => {
    const reviewPackage = buildFoundryOfflineReviewPackageV0(material());
    expect(FoundryOfflineReviewPackageV0Schema.parse(reviewPackage)).toEqual(reviewPackage);
    expect(reviewPackage.readiness).toMatchObject({
      evidenceReview: { status: "ready", blockers: [] },
      publicApproval: { status: "not_ready_offline" },
      signing: { status: "not_ready_unsigned" },
    });
  });

  it("rejects duplicate artifact IDs", () => {
    const candidate = material();
    const duplicate = candidate.artifacts[1];
    if (duplicate === undefined) throw new Error("fixture requires a second artifact");
    candidate.artifacts[1] = { ...duplicate, id: "fixed-view" };
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...candidate,
      packageSha256: sha(90),
    }).success).toBe(false);
  });

  it("rejects exact and case-folded path collisions", () => {
    for (const conflictingPath of [
      "fixed/identity-overview.png",
      "FIXED/IDENTITY-OVERVIEW.PNG",
    ]) {
      const candidate = material();
      candidate.artifacts.push(
        artifact("conflict", "supporting_evidence", conflictingPath, 20),
      );
      candidate.artifacts.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, "en-US"),
      );
      expect(FoundryOfflineReviewPackageV0Schema.safeParse({
        ...candidate,
        packageSha256: sha(91),
      }).success).toBe(false);
    }
  });

  it("rejects unsorted artifact paths", () => {
    const candidate = material();
    candidate.artifacts = [...candidate.artifacts].reverse();
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...candidate,
      packageSha256: sha(92),
    }).success).toBe(false);
  });

  it("requires canonical venue and room slugs", () => {
    for (const field of ["venueSlug", "roomSlug"] as const) {
      const candidate = material();
      candidate[field] = "Grand Hall";
      expect(FoundryOfflineReviewPackageV0Schema.safeParse({
        ...candidate,
        packageSha256: sha(921),
      }).success).toBe(false);
    }
  });

  it("rejects a missing or invalid subject", () => {
    const missing = material();
    missing.subjectArtifactId = "not-indexed";
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...missing,
      packageSha256: sha(93),
    }).success).toBe(false);

    const invalidKind = material();
    invalidKind.subjectArtifactId = "identity";
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...invalidKind,
      packageSha256: sha(94),
    }).success).toBe(false);
  });

  it("keeps ready and blocked evidence-review states internally consistent", () => {
    const readyWithBlocker = material();
    const malformedReady = {
      ...readyWithBlocker,
      readiness: {
        ...readyWithBlocker.readiness,
        evidenceReview: { status: "ready", blockers: ["unexpected blocker"] },
      },
      packageSha256: sha(95),
    };
    expect(FoundryOfflineReviewPackageV0Schema.safeParse(malformedReady).success).toBe(false);

    const blockedWithoutBlocker = material();
    const malformedBlocked = {
      ...blockedWithoutBlocker,
      readiness: {
        ...blockedWithoutBlocker.readiness,
        evidenceReview: { status: "blocked", blockers: [] },
      },
      packageSha256: sha(96),
    };
    expect(FoundryOfflineReviewPackageV0Schema.safeParse(malformedBlocked).success).toBe(false);
  });

  it("requires every phase-one review artifact kind before evidence-review-ready", () => {
    for (const kind of [
      "phase1_bundle",
      "ingest_manifest",
      "identity_review",
      "source_inspection",
      "residual_report",
      "transform_proposal",
      "fixed_view",
    ] as const) {
      const candidate = material();
      candidate.artifacts = candidate.artifacts.filter((entry) => entry.kind !== kind);
      if (kind === "phase1_bundle") candidate.subjectArtifactId = "identity";
      expect(FoundryOfflineReviewPackageV0Schema.safeParse({
        ...candidate,
        packageSha256: sha(97),
      }).success).toBe(false);
    }
  });

  it("does not permit offline elevation to public approval or signing", () => {
    const base = material();
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...base,
      readiness: {
        ...base.readiness,
        publicApproval: { status: "ready", requirements: [] },
      },
      packageSha256: sha(98),
    }).success).toBe(false);
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...base,
      readiness: {
        ...base.readiness,
        signing: { status: "ready", requirements: [] },
      },
      packageSha256: sha(99),
    }).success).toBe(false);
  });

  it("rejects review, authority, and signature fields from online workflows", () => {
    const reviewPackage = buildFoundryOfflineReviewPackageV0(material());
    for (const extra of [
      { reviewer: "someone" },
      { decision: "approved" },
      { reviewId: "review-1" },
      { signature: null },
      { payloadBase64: "AA==" },
    ]) {
      expect(FoundryOfflineReviewPackageV0Schema.safeParse({
        ...reviewPackage,
        ...extra,
      }).success).toBe(false);
    }
  });

  it("rejects digest tampering and changes identity when evidence or readiness changes", () => {
    const original = material();
    const originalDigest = computeFoundryOfflineReviewPackageSha256(original);
    const changedArtifact = structuredClone(original);
    const first = changedArtifact.artifacts[0];
    if (first === undefined) throw new Error("fixture requires an artifact");
    first.sha256 = sha(500);
    expect(computeFoundryOfflineReviewPackageSha256(changedArtifact)).not.toBe(originalDigest);

    const changedRequirement = structuredClone(original);
    changedRequirement.readiness.signing.requirements.push(
      "Require a separately authorized key-custodian ceremony.",
    );
    expect(computeFoundryOfflineReviewPackageSha256(changedRequirement)).not.toBe(originalDigest);

    const reviewPackage = buildFoundryOfflineReviewPackageV0(original);
    expect(FoundryOfflineReviewPackageV0Schema.safeParse({
      ...reviewPackage,
      packageSha256: sha(501),
    }).success).toBe(false);
  });

  it("cannot parse as transform, review mutation, evidence registration, or signing payload", () => {
    const reviewPackage = buildFoundryOfflineReviewPackageV0(material());
    expect(TransformArtifactV0Schema.safeParse(reviewPackage).success).toBe(false);
    expect(ReconstructionReleaseReviewInputSchema.safeParse(reviewPackage).success).toBe(false);
    expect(
      ReconstructionReviewEvidenceArtifactRegistrationInputSchema.safeParse(reviewPackage).success,
    ).toBe(false);
    expect(ReconstructionReleaseSigningPayloadSchema.safeParse(reviewPackage).success).toBe(false);
  });
});
