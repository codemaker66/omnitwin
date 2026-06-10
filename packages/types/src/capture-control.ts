import { z } from "zod";

const SAFE_ID = /^[a-z][a-z0-9]*(?:[_:-][a-z0-9]+)*$/;
const SAFE_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const SAFE_REF = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/;

export const CAPTURE_CONTROL_SOURCE_CLASSES = [
  "raw_structured_e57_poses",
  "matterport_api_sdk_poses",
  "colmap_poses",
  "apriltags",
  "charuco_boards",
  "manual_landmarks",
  "control_distances",
  "artist_blender_alignment_refs",
  "known_pose_colmap_model",
] as const;
export const CaptureControlSourceClassSchema = z.enum(
  CAPTURE_CONTROL_SOURCE_CLASSES,
);
export type CaptureControlSourceClass = z.infer<
  typeof CaptureControlSourceClassSchema
>;

export const CAPTURE_POSE_AUTHORITY_LEVELS = [
  "measured_control",
  "validated_fiducial_control",
  "manual_landmark_control",
  "known_pose_colmap",
  "colmap_reconstructed",
  "visual_alignment_only",
] as const;
export const CapturePoseAuthorityLevelSchema = z.enum(
  CAPTURE_POSE_AUTHORITY_LEVELS,
);
export type CapturePoseAuthorityLevel = z.infer<
  typeof CapturePoseAuthorityLevelSchema
>;

export const CAPTURE_CONTROL_ALIGNMENT_METHODS = [
  "e57_pose_extraction",
  "matterport_pose_extraction",
  "fiducial_solve",
  "landmark_solve",
  "control_distance_scale_check",
  "icp",
  "known_pose_colmap",
  "unconstrained_colmap",
  "artist_blender_alignment",
  "visual_alignment",
] as const;
export const CaptureControlAlignmentMethodSchema = z.enum(
  CAPTURE_CONTROL_ALIGNMENT_METHODS,
);
export type CaptureControlAlignmentMethod = z.infer<
  typeof CaptureControlAlignmentMethodSchema
>;

export const CAPTURE_CONTROL_QA_STATUSES = [
  "source_registered",
  "machine_checked",
  "requires_human_review",
  "human_reviewed",
  "accepted",
  "rejected",
  "contested",
  "stale",
  "superseded",
] as const;
export const CaptureControlQaStatusSchema = z.enum(CAPTURE_CONTROL_QA_STATUSES);
export type CaptureControlQaStatus = z.infer<typeof CaptureControlQaStatusSchema>;

export const CAPTURE_CONTROL_STALENESS_TRIGGERS = [
  "capture_session_superseded",
  "venue_geometry_changed",
  "control_network_changed",
  "source_pose_rejected",
  "landmark_set_changed",
  "fiducial_marker_set_changed",
  "control_distance_changed",
  "runtime_package_changed",
  "scene_authority_map_changed",
  "annual_refresh_delta_exceeded",
  "review_expired",
  "manual_contestation",
] as const;
export const CaptureControlStalenessTriggerSchema = z.enum(
  CAPTURE_CONTROL_STALENESS_TRIGGERS,
);
export type CaptureControlStalenessTrigger = z.infer<
  typeof CaptureControlStalenessTriggerSchema
>;

export const CAPTURE_CONTROL_REFERENCE_TYPES = [
  "capture_session",
  "source_asset",
  "asset_version",
  "runtime_package",
  "transform_artifact",
  "control_network",
  "landmark_set",
  "fiducial_set",
  "control_distance_set",
  "qa_report",
  "review_record",
  "operator_note",
] as const;
export const CaptureControlReferenceTypeSchema = z.enum(
  CAPTURE_CONTROL_REFERENCE_TYPES,
);
export type CaptureControlReferenceType = z.infer<
  typeof CaptureControlReferenceTypeSchema
>;

export const CAPTURE_CONTROL_SOURCE_CLASS_AUTHORITY_LEVELS = {
  raw_structured_e57_poses: ["measured_control"],
  matterport_api_sdk_poses: ["measured_control"],
  colmap_poses: ["colmap_reconstructed"],
  apriltags: ["validated_fiducial_control"],
  charuco_boards: ["validated_fiducial_control"],
  manual_landmarks: ["manual_landmark_control"],
  control_distances: ["measured_control"],
  artist_blender_alignment_refs: ["visual_alignment_only"],
  known_pose_colmap_model: ["known_pose_colmap"],
} as const satisfies Record<
  CaptureControlSourceClass,
  readonly CapturePoseAuthorityLevel[]
>;

export const CAPTURE_CONTROL_SOURCE_CLASS_ALIGNMENT_METHODS = {
  raw_structured_e57_poses: ["e57_pose_extraction"],
  matterport_api_sdk_poses: ["matterport_pose_extraction"],
  colmap_poses: ["unconstrained_colmap"],
  apriltags: ["fiducial_solve"],
  charuco_boards: ["fiducial_solve"],
  manual_landmarks: ["landmark_solve"],
  control_distances: ["control_distance_scale_check"],
  artist_blender_alignment_refs: [
    "artist_blender_alignment",
    "visual_alignment",
  ],
  known_pose_colmap_model: ["known_pose_colmap"],
} as const satisfies Record<
  CaptureControlSourceClass,
  readonly CaptureControlAlignmentMethod[]
>;

const REVIEW_ROLE_QA_STATUSES = [
  "requires_human_review",
  "human_reviewed",
  "accepted",
  "rejected",
  "contested",
] as const satisfies readonly CaptureControlQaStatus[];

export const CaptureControlReferenceSchema = z
  .object({
    refType: CaptureControlReferenceTypeSchema,
    ref: z.string().trim().min(1).max(255).regex(SAFE_REF),
    role: z.string().trim().min(1).max(80).regex(SAFE_TOKEN),
  })
  .strict();
export type CaptureControlReference = z.infer<typeof CaptureControlReferenceSchema>;

export const CaptureControlSourceRecordSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(160).regex(SAFE_ID),
    sourceClass: CaptureControlSourceClassSchema,
    poseAuthorityLevel: CapturePoseAuthorityLevelSchema,
    alignmentMethods: z.array(CaptureControlAlignmentMethodSchema).min(1),
    qaStatus: CaptureControlQaStatusSchema,
    sourceRefs: z.array(CaptureControlReferenceSchema).min(1),
    transformArtifactRefs: z.array(CaptureControlReferenceSchema).default([]),
    residualMetricRefs: z.array(CaptureControlReferenceSchema).default([]),
    staleWhen: z.array(CaptureControlStalenessTriggerSchema).default([]),
    reviewerRole: z.string().trim().min(1).max(120).regex(SAFE_TOKEN).nullable(),
    notes: z.string().trim().max(1000).nullable().default(null),
  })
  .strict()
  .superRefine((record, ctx) => {
    const allowedAuthorityLevels: readonly CapturePoseAuthorityLevel[] =
      CAPTURE_CONTROL_SOURCE_CLASS_AUTHORITY_LEVELS[record.sourceClass];
    if (!allowedAuthorityLevels.includes(record.poseAuthorityLevel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["poseAuthorityLevel"],
        message:
          "Capture control source class cannot claim this pose authority level.",
      });
    }

    const allowedAlignmentMethods: readonly CaptureControlAlignmentMethod[] =
      CAPTURE_CONTROL_SOURCE_CLASS_ALIGNMENT_METHODS[record.sourceClass];
    for (const [index, alignmentMethod] of record.alignmentMethods.entries()) {
      if (!allowedAlignmentMethods.includes(alignmentMethod)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["alignmentMethods", index],
          message:
            "Capture control source class cannot claim this alignment method.",
        });
      }
    }

    const reviewRoleQaStatuses: readonly CaptureControlQaStatus[] = REVIEW_ROLE_QA_STATUSES;
    const needsReviewerRole = reviewRoleQaStatuses.includes(record.qaStatus);
    if (needsReviewerRole && record.reviewerRole === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewerRole"],
        message: "Reviewed or review-gated capture control sources need a reviewer role.",
      });
    }

    if (!needsReviewerRole && record.reviewerRole !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewerRole"],
        message:
          "Only reviewed or review-gated capture control sources may carry a reviewer role.",
      });
    }
  });
export type CaptureControlSourceRecord = z.infer<
  typeof CaptureControlSourceRecordSchema
>;

export function captureControlAuthorityLevelsForSource(
  sourceClass: CaptureControlSourceClass,
): readonly CapturePoseAuthorityLevel[] {
  return CAPTURE_CONTROL_SOURCE_CLASS_AUTHORITY_LEVELS[sourceClass];
}

export function captureControlAlignmentMethodsForSource(
  sourceClass: CaptureControlSourceClass,
): readonly CaptureControlAlignmentMethod[] {
  return CAPTURE_CONTROL_SOURCE_CLASS_ALIGNMENT_METHODS[sourceClass];
}
