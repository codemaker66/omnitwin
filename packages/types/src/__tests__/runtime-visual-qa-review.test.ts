import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_VISUAL_QA_CHECK_KEYS,
  RUNTIME_VISUAL_QA_REVIEW_V0_SCHEMA_VERSION,
  RuntimeVisualQaReviewV0Schema,
  type RuntimeVisualQaReviewV0,
} from "../runtime-visual-qa-review.js";

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomVisualQaReview(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-visual-qa-review-2026-06-16.json",
  );
}

function parsedReview(): RuntimeVisualQaReviewV0 {
  return RuntimeVisualQaReviewV0Schema.parse(loadReceptionRoomVisualQaReview());
}

function withChecks(
  review: RuntimeVisualQaReviewV0,
  checks: RuntimeVisualQaReviewV0["checks"],
): RuntimeVisualQaReviewV0 {
  return {
    ...review,
    checks,
  };
}

function approvedReviewFixture(): RuntimeVisualQaReviewV0 {
  const review = parsedReview();
  const approvedEvidence = {
    kind: "runtime_qa_record",
    label: "Synthetic signed review evidence",
    ref: "docs/operations/test-signed-review.json",
  } satisfies RuntimeVisualQaReviewV0["checks"][number]["evidenceRefs"][number];

  return RuntimeVisualQaReviewV0Schema.parse({
    ...review,
    reviewerKind: "human_visual_reviewer",
    assetEvidenceStatus: "human_reviewed",
    reviewDisposition: "human_reviewed_public_candidate",
    transformDisposition: "signed_transform_verified",
    signedTransformArtifactId: "t-reception-room-signed",
    publicExposureDisposition: "approved_public",
    checks: review.checks.map((check) => {
      if (
        check.checkKey === "signed_transform_present" ||
        check.checkKey === "metric_scale_checked" ||
        check.checkKey === "floor_wall_alignment_checked" ||
        check.checkKey === "human_visual_review_recorded" ||
        check.checkKey === "public_exposure_approved"
      ) {
        return {
          ...check,
          status: "passed",
          summary: "Synthetic test evidence records this approval check.",
          evidenceRefs: [approvedEvidence],
        } satisfies RuntimeVisualQaReviewV0["checks"][number];
      }
      return check;
    }),
    blockers: [],
    requiredBeforeApproval: [],
  });
}

describe("Runtime visual QA review", () => {
  it("validates the Reception Room visual QA review artifact as blocked internal-only evidence", () => {
    const review = parsedReview();

    expect(review.schemaVersion).toBe(RUNTIME_VISUAL_QA_REVIEW_V0_SCHEMA_VERSION);
    expect(review.reviewId).toBe("reception-room-visual-qa-review-2026-06-16");
    expect(review.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(review.assetEvidenceStatus).toBe("unverified");
    expect(review.runtimeStatus).toBe("internal_ready");
    expect(review.reviewDisposition).toBe("blocked_needs_human_review");
    expect(review.transformDisposition).toBe("approximate_view_transform_only");
    expect(review.signedTransformArtifactId).toBeNull();
    expect(review.publicExposureDisposition).toBe("blocked_internal_only");
    expect(review.guardrails).toEqual({
      signedTransformCreated: false,
      runtimeQaRecordChanged: false,
      captureControlSourceChanged: false,
      humanReviewOverlayCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    });
  });

  it("pins every required visual QA check key in the artifact", () => {
    const review = parsedReview();
    const present = new Set(review.checks.map((check) => check.checkKey));

    for (const checkKey of RUNTIME_VISUAL_QA_CHECK_KEYS) {
      expect(present.has(checkKey)).toBe(true);
    }
  });

  it("rejects public approval without human-reviewed evidence and a signed transform", () => {
    const review = parsedReview();

    const result = RuntimeVisualQaReviewV0Schema.safeParse({
      ...review,
      publicExposureDisposition: "approved_public",
    });

    expect(result.success).toBe(false);
  });

  it("allows approved public posture only when all required review evidence is present", () => {
    const review = approvedReviewFixture();

    expect(review.publicExposureDisposition).toBe("approved_public");
    expect(review.assetEvidenceStatus).toBe("human_reviewed");
    expect(review.transformDisposition).toBe("signed_transform_verified");
    expect(review.signedTransformArtifactId).toBe("t-reception-room-signed");
    expect(review.blockers).toEqual([]);
  });

  it("rejects a passed visual check without evidence references", () => {
    const review = parsedReview();
    const checks = review.checks.map((check) =>
      check.checkKey === "camera_start_framed"
        ? {
            ...check,
            evidenceRefs: [],
          }
        : check,
    );

    const result = RuntimeVisualQaReviewV0Schema.safeParse(withChecks(review, checks));

    expect(result.success).toBe(false);
  });

  it("rejects reviews missing required visual check keys", () => {
    const review = parsedReview();
    const checks = review.checks.filter((check) =>
      check.checkKey !== "human_visual_review_recorded",
    );

    const result = RuntimeVisualQaReviewV0Schema.safeParse(withChecks(review, checks));

    expect(result.success).toBe(false);
  });

  it("rejects visual QA artifacts that claim public exposure side effects", () => {
    const review = parsedReview();

    const result = RuntimeVisualQaReviewV0Schema.safeParse({
      ...review,
      guardrails: {
        ...review.guardrails,
        publicExposureChanged: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported public claim wording in visual QA summaries", () => {
    const review = parsedReview();

    const result = RuntimeVisualQaReviewV0Schema.safeParse({
      ...review,
      limitations: ["This is a survey-grade runtime room."],
    });

    expect(result.success).toBe(false);
  });
});
