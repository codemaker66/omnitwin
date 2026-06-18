import { z } from "zod";
import {
  AssetEvidenceStatusSchema,
  RuntimePackageStatusSchema,
  RuntimeSlugSchema,
  TradesHallRuntimeRoomSlugSchema,
} from "./asset-version.js";
import {
  CaptureControlAlignmentMethodSchema,
  CaptureControlQaStatusSchema,
  CaptureControlSourceClassSchema,
  CapturePoseAuthorityLevelSchema,
} from "./capture-control.js";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import {
  RuntimeManifestKeySchema,
  RuntimeTransformAlignmentMethodSchema,
  RuntimeTransformFrameSchema,
  RuntimeTransformReferenceTypeSchema,
} from "./runtime-venue-manifest.js";

export const RUNTIME_TRANSFORM_READINESS_V0_SCHEMA_VERSION = "runtime-transform-readiness.v0";

export const RUNTIME_TRANSFORM_READINESS_DISPOSITIONS = [
  "blocked_missing_control_evidence",
  "blocked_visual_alignment_only",
  "ready_for_signed_transform_payload",
  "signed_transform_payload_preflighted",
] as const;
export const RuntimeTransformReadinessDispositionSchema = z.enum(
  RUNTIME_TRANSFORM_READINESS_DISPOSITIONS,
);
export type RuntimeTransformReadinessDisposition = z.infer<
  typeof RuntimeTransformReadinessDispositionSchema
>;

export const RUNTIME_TRANSFORM_CHAIN_PURPOSES = [
  "room_local_metric_alignment",
  "renderer_frame_mapping",
  "capture_pose_to_room_frame",
] as const;
export const RuntimeTransformChainPurposeSchema = z.enum(
  RUNTIME_TRANSFORM_CHAIN_PURPOSES,
);
export type RuntimeTransformChainPurpose = z.infer<
  typeof RuntimeTransformChainPurposeSchema
>;

export const RUNTIME_TRANSFORM_CHAIN_REQUIREMENT_STATUSES = [
  "missing",
  "candidate_needed",
  "candidate_recorded",
  "reviewed",
] as const;
export const RuntimeTransformChainRequirementStatusSchema = z.enum(
  RUNTIME_TRANSFORM_CHAIN_REQUIREMENT_STATUSES,
);
export type RuntimeTransformChainRequirementStatus = z.infer<
  typeof RuntimeTransformChainRequirementStatusSchema
>;

export const RUNTIME_TRANSFORM_READINESS_EVIDENCE_KINDS = [
  "capture_control_source",
  "control_evidence_intake",
  "control_coordinate_pair_intake_request",
  "control_coordinate_pair_intake_inspection",
  "control_coordinate_pair_packet_build_report",
  "capture_control_payload_build_report",
  "runtime_control_evidence_chain_status",
  "capture_control_report",
  "capture_control_inspection",
  "runtime_qa_record",
  "runtime_visual_qa_review",
  "runtime_composition_decision",
  "transform_artifact_payload",
  "transform_dry_run_report",
  "architecture_decision",
  "code_reference",
] as const;
export const RuntimeTransformReadinessEvidenceKindSchema = z.enum(
  RUNTIME_TRANSFORM_READINESS_EVIDENCE_KINDS,
);
export type RuntimeTransformReadinessEvidenceKind = z.infer<
  typeof RuntimeTransformReadinessEvidenceKindSchema
>;

const READINESS_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const RuntimeTransformReadinessEvidenceRefSchema = z
  .object({
    kind: RuntimeTransformReadinessEvidenceKindSchema,
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(320),
  })
  .strict();
export type RuntimeTransformReadinessEvidenceRef = z.infer<
  typeof RuntimeTransformReadinessEvidenceRefSchema
>;

export const RuntimeTransformReadinessCaptureControlPostureSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(160),
    sourceClass: CaptureControlSourceClassSchema,
    poseAuthorityLevel: CapturePoseAuthorityLevelSchema,
    alignmentMethods: z.array(CaptureControlAlignmentMethodSchema).min(1),
    qaStatus: CaptureControlQaStatusSchema,
    linkedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
    evidenceRefs: z.array(RuntimeTransformReadinessEvidenceRefSchema).min(1),
  })
  .strict();
export type RuntimeTransformReadinessCaptureControlPosture = z.infer<
  typeof RuntimeTransformReadinessCaptureControlPostureSchema
>;

export const RuntimeTransformCandidateSummarySchema = z
  .object({
    transformArtifactId: RuntimeManifestKeySchema,
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    alignmentMethod: RuntimeTransformAlignmentMethodSchema,
    provenanceRefTypes: z.array(RuntimeTransformReferenceTypeSchema).min(1),
    residualRmseM: z.number().finite().nonnegative().nullable(),
    landmarkCount: z.number().int().nonnegative(),
    evidenceRefs: z.array(RuntimeTransformReadinessEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (candidate.sourceFrame === candidate.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Candidate signed transforms must map between different frames.",
      });
    }

    if (candidate.alignmentMethod === "landmark_solve") {
      if (candidate.landmarkCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarkCount"],
          message: "Landmark-solve candidates need at least one landmark pair.",
        });
      }
      if (candidate.residualRmseM === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["residualRmseM"],
          message: "Landmark-solve candidates need an aggregate residual RMSE.",
        });
      }
    }

    if (
      candidate.alignmentMethod === "visual_alignment" ||
      candidate.alignmentMethod === "unconstrained_colmap"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alignmentMethod"],
        message: "Signed transform readiness cannot use visual-only or unconstrained alignment methods.",
      });
    }
  });
export type RuntimeTransformCandidateSummary = z.infer<
  typeof RuntimeTransformCandidateSummarySchema
>;

export const RuntimeTransformChainRequirementSchema = z
  .object({
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    purpose: RuntimeTransformChainPurposeSchema,
    status: RuntimeTransformChainRequirementStatusSchema,
    reason: SafePlanningWordingSchema,
    evidenceRefs: z.array(RuntimeTransformReadinessEvidenceRefSchema).default([]),
  })
  .strict()
  .superRefine((requirement, ctx) => {
    if (requirement.sourceFrame === requirement.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Runtime transform chain requirements must map between different frames.",
      });
    }

    if (
      (requirement.status === "candidate_recorded" || requirement.status === "reviewed") &&
      requirement.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Recorded or reviewed transform chain requirements need evidence references.",
      });
    }
  });
export type RuntimeTransformChainRequirement = z.infer<
  typeof RuntimeTransformChainRequirementSchema
>;

function hasReviewableCaptureControl(posture: RuntimeTransformReadinessCaptureControlPosture): boolean {
  return posture.poseAuthorityLevel !== "visual_alignment_only" &&
    posture.qaStatus !== "source_registered" &&
    posture.qaStatus !== "machine_checked" &&
    posture.qaStatus !== "requires_human_review" &&
    posture.qaStatus !== "rejected" &&
    posture.qaStatus !== "contested" &&
    posture.qaStatus !== "stale" &&
    posture.qaStatus !== "superseded";
}

export const RuntimeTransformReadinessV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_TRANSFORM_READINESS_V0_SCHEMA_VERSION),
    readinessId: z.string().trim().min(1).max(160).regex(READINESS_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    recordedAt: z.string().datetime({ offset: true }),
    recordedBy: z.string().trim().min(1).max(160),
    assetEvidenceStatus: AssetEvidenceStatusSchema,
    runtimeStatus: RuntimePackageStatusSchema,
    readinessDisposition: RuntimeTransformReadinessDispositionSchema,
    captureControlPosture: RuntimeTransformReadinessCaptureControlPostureSchema,
    candidateTransformArtifact: RuntimeTransformCandidateSummarySchema.nullable(),
    requiredTransformChain: z.array(RuntimeTransformChainRequirementSchema).min(1),
    evidenceRefs: z.array(RuntimeTransformReadinessEvidenceRefSchema).min(1),
    blockers: z.array(SafePlanningWordingSchema),
    requiredBeforeSignedRegistration: z.array(SafePlanningWordingSchema),
    guardrails: z
      .object({
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        captureControlSourceChanged: z.literal(false),
        runtimeQaRecordChanged: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((readiness, ctx) => {
    const captureControlIsReviewable = hasReviewableCaptureControl(
      readiness.captureControlPosture,
    );

    if (
      readiness.captureControlPosture.poseAuthorityLevel === "visual_alignment_only" &&
      readiness.readinessDisposition !== "blocked_visual_alignment_only" &&
      readiness.readinessDisposition !== "blocked_missing_control_evidence"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readinessDisposition"],
        message: "Visual-alignment-only sources cannot be ready for signed transform payloads.",
      });
    }

    const readyDisposition =
      readiness.readinessDisposition === "ready_for_signed_transform_payload" ||
      readiness.readinessDisposition === "signed_transform_payload_preflighted";
    if (readyDisposition && readiness.candidateTransformArtifact === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateTransformArtifact"],
        message: "Ready transform readiness records need a candidate TransformArtifactV0 summary.",
      });
    }

    if (readyDisposition && !captureControlIsReviewable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureControlPosture", "qaStatus"],
        message: "Ready transform readiness requires reviewed or accepted capture-control evidence.",
      });
    }

    if (readyDisposition && readiness.blockers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Ready transform readiness records cannot retain open blockers.",
      });
    }

    if (!readyDisposition && readiness.blockers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked transform readiness records must list at least one blocker.",
      });
    }

    if (!readyDisposition && readiness.requiredBeforeSignedRegistration.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredBeforeSignedRegistration"],
        message: "Blocked transform readiness records must list requirements before signed registration.",
      });
    }

    if (
      readyDisposition &&
      readiness.requiredTransformChain.some((requirement) => requirement.status !== "reviewed")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredTransformChain"],
        message: "Ready transform readiness requires every transform-chain requirement to be reviewed.",
      });
    }
  });
export type RuntimeTransformReadinessV0 = z.infer<typeof RuntimeTransformReadinessV0Schema>;
