import { z } from "zod";
import {
  ArtifactExposureTierSchema,
  ArtifactExportSafetySchema,
  ArtifactReferenceSchema,
  type ArtifactExposureTier,
  type ArtifactExportSafety,
} from "./artifact-manifest.js";
import { ArtifactTypeSchema, type ArtifactType } from "./artifact-type.js";
import { VenueIdSchema } from "./venue.js";

export const EXPOSURE_METADATA_V0_SCHEMA_VERSION = "venviewer.exposure-metadata.v0";

const SAFE_SCOPE = /^[a-z][a-z0-9]*(?:[_:-][a-z0-9]+)*$/;

export const EXPOSURE_ALLOWED_AUDIENCES = [
  "internal_team",
  "venue_staff",
  "authenticated_client",
  "capture_partner",
  "implementation_partner",
  "expert_reviewer",
  "investor",
  "public",
] as const;
export const ExposureAllowedAudienceSchema = z.enum(EXPOSURE_ALLOWED_AUDIENCES);
export type ExposureAllowedAudience = z.infer<typeof ExposureAllowedAudienceSchema>;

export const EXPOSURE_CLAIM_REVIEW_STATUSES = [
  "not_required",
  "not_started",
  "requires_review",
  "reviewed_current",
  "blocked",
  "stale",
] as const;
export const ExposureClaimReviewStatusSchema = z.enum(
  EXPOSURE_CLAIM_REVIEW_STATUSES,
);
export type ExposureClaimReviewStatus = z.infer<
  typeof ExposureClaimReviewStatusSchema
>;

export const ExposureMetadataV0Schema = z
  .object({
    schemaVersion: z.literal(EXPOSURE_METADATA_V0_SCHEMA_VERSION),
    artifactType: ArtifactTypeSchema,
    exposureTier: ArtifactExposureTierSchema,
    ownerVenueId: VenueIdSchema.nullable(),
    ownerClientScope: z.string().trim().min(1).max(160).regex(SAFE_SCOPE).nullable(),
    subjectRefs: z.array(ArtifactReferenceSchema).default([]),
    allowedAudience: z.array(ExposureAllowedAudienceSchema).min(1),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    claimReviewStatus: ExposureClaimReviewStatusSchema,
    approvalRefs: z.array(ArtifactReferenceSchema).default([]),
    sourceArtifactRefs: z.array(ArtifactReferenceSchema).default([]),
    exportSafety: ArtifactExportSafetySchema,
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (
      metadata.exposureTier !== "public_marketing" &&
      metadata.exposureTier !== "published_case_study" &&
      metadata.allowedAudience.includes("public")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedAudience"],
        message: "Non-public exposure tiers cannot include public audience.",
      });
    }

    if (
      (metadata.exposureTier === "public_marketing" ||
        metadata.exposureTier === "published_case_study") &&
      !metadata.allowedAudience.includes("public")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedAudience"],
        message: "Public-facing exposure tiers must include public audience.",
      });
    }

    if (
      metadata.exposureTier === "internal_only" &&
      metadata.exportSafety === "safe_for_public_marketing"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exportSafety"],
        message: "Internal-only exposure cannot be safe for public marketing.",
      });
    }

    if (
      (metadata.exposureTier === "public_marketing" ||
        metadata.exposureTier === "published_case_study") &&
      metadata.exportSafety !== "safe_for_public_marketing"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exportSafety"],
        message:
          "Public-facing exposure metadata requires public-marketing export safety.",
      });
    }

    if (
      (metadata.exposureTier === "public_marketing" ||
        metadata.exposureTier === "published_case_study") &&
      metadata.claimReviewStatus !== "reviewed_current"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimReviewStatus"],
        message: "Public-facing exposure metadata requires current claim review.",
      });
    }

    if (metadata.exposureTier === "published_case_study" && metadata.approvalRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvalRefs"],
        message: "Published case studies require approval references.",
      });
    }

    if (metadata.exposureTier === "partner_preview" && metadata.expiresAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Partner-preview exposure metadata needs an expiry.",
      });
    }

    if (
      metadata.exposureTier === "authenticated_client" &&
      metadata.ownerVenueId === null &&
      metadata.ownerClientScope === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerClientScope"],
        message:
          "Authenticated-client exposure metadata needs venue or client scope.",
      });
    }
  });
export type ExposureMetadataV0 = z.infer<typeof ExposureMetadataV0Schema>;

export function internalOnlyExposureMetadata(
  artifactType: ArtifactType,
): ExposureMetadataV0 {
  return ExposureMetadataV0Schema.parse({
    schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
    artifactType,
    exposureTier: "internal_only" satisfies ArtifactExposureTier,
    ownerVenueId: null,
    ownerClientScope: null,
    subjectRefs: [],
    allowedAudience: ["internal_team"],
    expiresAt: null,
    claimReviewStatus: "not_required",
    approvalRefs: [],
    sourceArtifactRefs: [],
    exportSafety: "internal_only" satisfies ArtifactExportSafety,
  });
}
