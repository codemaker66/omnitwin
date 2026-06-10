import { describe, expect, it } from "vitest";
import {
  EXPOSURE_ALLOWED_AUDIENCES,
  EXPOSURE_CLAIM_REVIEW_STATUSES,
  EXPOSURE_METADATA_V0_SCHEMA_VERSION,
  ExposureAllowedAudienceSchema,
  ExposureClaimReviewStatusSchema,
  ExposureMetadataV0Schema,
  internalOnlyExposureMetadata,
  type ExposureMetadataV0,
} from "../exposure-metadata.js";
import { ARTIFACT_EXPOSURE_TIERS } from "../artifact-manifest.js";
import { ARTIFACT_TYPES } from "../artifact-type.js";

const VALID_VENUE_ID = "33333333-3333-4333-8333-333333333333";

function validExposure(overrides: Partial<ExposureMetadataV0> = {}): ExposureMetadataV0 {
  return {
    schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
    artifactType: "runtime_package",
    exposureTier: "internal_only",
    ownerVenueId: VALID_VENUE_ID,
    ownerClientScope: null,
    subjectRefs: [
      {
        refType: "venue",
        ref: "trades-hall",
        role: "subject_venue",
      },
    ],
    allowedAudience: ["internal_team"],
    expiresAt: null,
    claimReviewStatus: "not_required",
    approvalRefs: [],
    sourceArtifactRefs: [],
    exportSafety: "internal_only",
    ...overrides,
  };
}

describe("ExposureMetadataV0", () => {
  it("pins metadata schema version and allowed audience vocabulary", () => {
    expect(EXPOSURE_METADATA_V0_SCHEMA_VERSION).toBe("venviewer.exposure-metadata.v0");
    expect(EXPOSURE_ALLOWED_AUDIENCES).toEqual([
      "internal_team",
      "venue_staff",
      "authenticated_client",
      "capture_partner",
      "implementation_partner",
      "expert_reviewer",
      "investor",
      "public",
    ]);

    for (const audience of EXPOSURE_ALLOWED_AUDIENCES) {
      expect(ExposureAllowedAudienceSchema.safeParse(audience).success).toBe(true);
    }
  });

  it("pins claim review statuses independently from exposure tiers", () => {
    expect(EXPOSURE_CLAIM_REVIEW_STATUSES).toEqual([
      "not_required",
      "not_started",
      "requires_review",
      "reviewed_current",
      "blocked",
      "stale",
    ]);

    for (const status of EXPOSURE_CLAIM_REVIEW_STATUSES) {
      expect(ExposureClaimReviewStatusSchema.safeParse(status).success).toBe(true);
      expect(ARTIFACT_EXPOSURE_TIERS.includes(status as never)).toBe(false);
    }
  });

  it("accepts every artifact type for generic exposure metadata", () => {
    for (const artifactType of ARTIFACT_TYPES) {
      expect(ExposureMetadataV0Schema.safeParse(
        validExposure({ artifactType }),
      ).success).toBe(true);
    }
  });

  it("defaults missing metadata callers to internal-only through the helper", () => {
    expect(internalOnlyExposureMetadata("runtime_package")).toEqual({
      schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
      artifactType: "runtime_package",
      exposureTier: "internal_only",
      ownerVenueId: null,
      ownerClientScope: null,
      subjectRefs: [],
      allowedAudience: ["internal_team"],
      expiresAt: null,
      claimReviewStatus: "not_required",
      approvalRefs: [],
      sourceArtifactRefs: [],
      exportSafety: "internal_only",
    });
  });

  it("rejects non-public exposure metadata with a public audience", () => {
    const result = ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "partner_preview",
        allowedAudience: ["public"],
        expiresAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("requires public-facing metadata to be public-safe and claim-reviewed", () => {
    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "public_marketing",
        allowedAudience: ["public"],
        claimReviewStatus: "requires_review",
        exportSafety: "safe_for_public_marketing",
      }),
    ).success).toBe(false);

    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "public_marketing",
        allowedAudience: ["public"],
        claimReviewStatus: "reviewed_current",
        exportSafety: "safe_for_partner_preview",
      }),
    ).success).toBe(false);

    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "public_marketing",
        allowedAudience: ["public"],
        claimReviewStatus: "reviewed_current",
        exportSafety: "safe_for_public_marketing",
      }),
    ).success).toBe(true);
  });

  it("requires case-study approval references", () => {
    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "published_case_study",
        allowedAudience: ["public"],
        claimReviewStatus: "reviewed_current",
        exportSafety: "safe_for_public_marketing",
        approvalRefs: [],
      }),
    ).success).toBe(false);

    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "published_case_study",
        allowedAudience: ["public"],
        claimReviewStatus: "reviewed_current",
        exportSafety: "safe_for_public_marketing",
        approvalRefs: [
          {
            refType: "evidence",
            ref: "venue-approval-2026-06",
            role: "venue_approval",
          },
        ],
      }),
    ).success).toBe(true);
  });

  it("requires partner previews to expire", () => {
    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "partner_preview",
        allowedAudience: ["venue_staff"],
        exportSafety: "safe_for_partner_preview",
        expiresAt: null,
      }),
    ).success).toBe(false);
  });

  it("requires authenticated-client metadata to declare venue or client scope", () => {
    expect(ExposureMetadataV0Schema.safeParse(
      validExposure({
        exposureTier: "authenticated_client",
        ownerVenueId: null,
        ownerClientScope: null,
        allowedAudience: ["authenticated_client"],
        exportSafety: "safe_to_export",
      }),
    ).success).toBe(false);
  });
});
