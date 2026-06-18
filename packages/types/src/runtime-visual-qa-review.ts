import { z } from "zod";
import {
  AssetEvidenceStatusSchema,
  RuntimePackageStatusSchema,
  RuntimeSlugSchema,
  TradesHallRuntimeRoomSlugSchema,
} from "./asset-version.js";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import { RuntimeManifestKeySchema } from "./runtime-venue-manifest.js";

export const RUNTIME_VISUAL_QA_REVIEW_V0_SCHEMA_VERSION = "runtime-visual-qa-review.v0";

export const RUNTIME_VISUAL_QA_REVIEW_DISPOSITIONS = [
  "blocked_needs_human_review",
  "internal_visual_smoke_recorded",
  "human_reviewed_internal_preview",
  "human_reviewed_public_candidate",
] as const;
export const RuntimeVisualQaReviewDispositionSchema = z.enum(
  RUNTIME_VISUAL_QA_REVIEW_DISPOSITIONS,
);
export type RuntimeVisualQaReviewDisposition = z.infer<
  typeof RuntimeVisualQaReviewDispositionSchema
>;

export const RUNTIME_VISUAL_QA_TRANSFORM_DISPOSITIONS = [
  "approximate_view_transform_only",
  "signed_transform_required",
  "signed_transform_verified",
] as const;
export const RuntimeVisualQaTransformDispositionSchema = z.enum(
  RUNTIME_VISUAL_QA_TRANSFORM_DISPOSITIONS,
);
export type RuntimeVisualQaTransformDisposition = z.infer<
  typeof RuntimeVisualQaTransformDispositionSchema
>;

export const RUNTIME_VISUAL_QA_PUBLIC_EXPOSURE_DISPOSITIONS = [
  "blocked_internal_only",
  "candidate_requires_approval",
  "approved_public",
] as const;
export const RuntimeVisualQaPublicExposureDispositionSchema = z.enum(
  RUNTIME_VISUAL_QA_PUBLIC_EXPOSURE_DISPOSITIONS,
);
export type RuntimeVisualQaPublicExposureDisposition = z.infer<
  typeof RuntimeVisualQaPublicExposureDispositionSchema
>;

export const RUNTIME_VISUAL_QA_REVIEWER_KINDS = [
  "operator_evidence_record",
  "automated_smoke",
  "human_visual_reviewer",
] as const;
export const RuntimeVisualQaReviewerKindSchema = z.enum(
  RUNTIME_VISUAL_QA_REVIEWER_KINDS,
);
export type RuntimeVisualQaReviewerKind = z.infer<typeof RuntimeVisualQaReviewerKindSchema>;

export const RUNTIME_VISUAL_QA_EVIDENCE_REF_KINDS = [
  "runtime_qa_record",
  "runtime_qa_report",
  "runtime_qa_inspection",
  "capture_control_source",
  "capture_control_report",
  "capture_control_inspection",
  "composition_decision",
  "source_intake",
  "playwright_screenshot",
  "code_reference",
] as const;
export const RuntimeVisualQaEvidenceRefKindSchema = z.enum(
  RUNTIME_VISUAL_QA_EVIDENCE_REF_KINDS,
);
export type RuntimeVisualQaEvidenceRefKind = z.infer<
  typeof RuntimeVisualQaEvidenceRefKindSchema
>;

export const RUNTIME_VISUAL_QA_CHECK_KEYS = [
  "runtime_package_resolves",
  "all_room_chunks_load",
  "camera_start_framed",
  "bounded_orbit_smoke",
  "env_chunk_excluded",
  "composition_decision_recorded",
  "signed_transform_present",
  "metric_scale_checked",
  "floor_wall_alignment_checked",
  "human_visual_review_recorded",
  "public_exposure_approved",
] as const;
export const RuntimeVisualQaCheckKeySchema = z.enum(RUNTIME_VISUAL_QA_CHECK_KEYS);
export type RuntimeVisualQaCheckKey = z.infer<typeof RuntimeVisualQaCheckKeySchema>;

export const RUNTIME_VISUAL_QA_CHECK_STATUSES = [
  "passed",
  "failed",
  "not_checked",
  "requires_human_review",
  "blocked",
] as const;
export const RuntimeVisualQaCheckStatusSchema = z.enum(
  RUNTIME_VISUAL_QA_CHECK_STATUSES,
);
export type RuntimeVisualQaCheckStatus = z.infer<
  typeof RuntimeVisualQaCheckStatusSchema
>;

const REVIEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const RuntimeVisualQaEvidenceRefSchema = z
  .object({
    kind: RuntimeVisualQaEvidenceRefKindSchema,
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(300),
  })
  .strict();
export type RuntimeVisualQaEvidenceRef = z.infer<
  typeof RuntimeVisualQaEvidenceRefSchema
>;

export const RuntimeVisualQaCheckSchema = z
  .object({
    checkKey: RuntimeVisualQaCheckKeySchema,
    status: RuntimeVisualQaCheckStatusSchema,
    summary: SafePlanningWordingSchema,
    evidenceRefs: z.array(RuntimeVisualQaEvidenceRefSchema).default([]),
  })
  .strict()
  .superRefine((check, ctx) => {
    if (check.status === "passed" && check.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Passed visual QA checks need at least one evidence reference.",
      });
    }
  });
export type RuntimeVisualQaCheck = z.infer<typeof RuntimeVisualQaCheckSchema>;

export const RuntimeVisualQaReviewV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_VISUAL_QA_REVIEW_V0_SCHEMA_VERSION),
    reviewId: z.string().trim().min(1).max(160).regex(REVIEW_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    reviewedAt: z.string().datetime({ offset: true }),
    recordedBy: z.string().trim().min(1).max(160),
    reviewerKind: RuntimeVisualQaReviewerKindSchema,
    reviewerRole: z.string().trim().min(1).max(120),
    assetEvidenceStatus: AssetEvidenceStatusSchema,
    runtimeStatus: RuntimePackageStatusSchema,
    reviewDisposition: RuntimeVisualQaReviewDispositionSchema,
    transformDisposition: RuntimeVisualQaTransformDispositionSchema,
    signedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
    publicExposureDisposition: RuntimeVisualQaPublicExposureDispositionSchema,
    evidenceRefs: z.array(RuntimeVisualQaEvidenceRefSchema).min(1),
    checks: z.array(RuntimeVisualQaCheckSchema).min(RUNTIME_VISUAL_QA_CHECK_KEYS.length),
    limitations: z.array(SafePlanningWordingSchema).min(1),
    blockers: z.array(SafePlanningWordingSchema),
    requiredBeforeApproval: z.array(SafePlanningWordingSchema),
    guardrails: z
      .object({
        signedTransformCreated: z.literal(false),
        runtimeQaRecordChanged: z.literal(false),
        captureControlSourceChanged: z.literal(false),
        humanReviewOverlayCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((review, ctx) => {
    const seenChecks = new Set(review.checks.map((check) => check.checkKey));
    for (const requiredCheck of RUNTIME_VISUAL_QA_CHECK_KEYS) {
      if (!seenChecks.has(requiredCheck)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks"],
          message: `Runtime visual QA review is missing required check ${requiredCheck}.`,
        });
      }
    }

    const duplicateCheck = review.checks.find((check, index) =>
      review.checks.findIndex((candidate) => candidate.checkKey === check.checkKey) !== index,
    );
    if (duplicateCheck !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: `Runtime visual QA review has duplicate check ${duplicateCheck.checkKey}.`,
      });
    }

    if (
      review.transformDisposition !== "signed_transform_verified" &&
      review.signedTransformArtifactId !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signedTransformArtifactId"],
        message: "Unsigned visual QA reviews must not cite a signed transform artifact.",
      });
    }

    if (
      review.transformDisposition === "signed_transform_verified" &&
      review.signedTransformArtifactId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signedTransformArtifactId"],
        message: "Signed visual QA reviews must cite a signed transform artifact.",
      });
    }

    const signedTransformCheck = review.checks.find((check) =>
      check.checkKey === "signed_transform_present",
    );
    if (
      review.transformDisposition !== "signed_transform_verified" &&
      signedTransformCheck?.status === "passed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Unsigned visual QA reviews cannot pass the signed transform check.",
      });
    }

    const humanReviewCheck = review.checks.find((check) =>
      check.checkKey === "human_visual_review_recorded",
    );
    if (
      review.reviewDisposition.startsWith("human_reviewed_") &&
      humanReviewCheck?.status !== "passed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Human-reviewed visual QA dispositions require a passed human review check.",
      });
    }

    if (
      review.publicExposureDisposition === "approved_public" &&
      review.assetEvidenceStatus !== "human_reviewed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicExposureDisposition"],
        message: "Approved public visual exposure requires human-reviewed asset evidence.",
      });
    }

    if (
      review.publicExposureDisposition === "approved_public" &&
      review.transformDisposition !== "signed_transform_verified"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicExposureDisposition"],
        message: "Approved public visual exposure requires a signed transform.",
      });
    }

    const metricScaleCheck = review.checks.find((check) =>
      check.checkKey === "metric_scale_checked",
    );
    const floorWallCheck = review.checks.find((check) =>
      check.checkKey === "floor_wall_alignment_checked",
    );
    const publicExposureCheck = review.checks.find((check) =>
      check.checkKey === "public_exposure_approved",
    );
    if (
      review.publicExposureDisposition === "approved_public" &&
      (
        humanReviewCheck?.status !== "passed" ||
        metricScaleCheck?.status !== "passed" ||
        floorWallCheck?.status !== "passed" ||
        publicExposureCheck?.status !== "passed"
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Approved public visual exposure requires passed human, scale, floor/wall, and exposure checks.",
      });
    }

    if (
      review.publicExposureDisposition === "approved_public" &&
      review.blockers.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Approved public visual exposure cannot retain open blockers.",
      });
    }

    if (
      review.publicExposureDisposition !== "approved_public" &&
      review.requiredBeforeApproval.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredBeforeApproval"],
        message: "Non-public visual QA reviews must list requirements before approval.",
      });
    }

    if (
      review.reviewDisposition === "blocked_needs_human_review" &&
      review.blockers.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked visual QA reviews must list at least one blocker.",
      });
    }
  });
export type RuntimeVisualQaReviewV0 = z.infer<typeof RuntimeVisualQaReviewV0Schema>;
