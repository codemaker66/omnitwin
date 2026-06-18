import { z } from "zod";
import {
  RuntimeSlugSchema,
  TradesHallRuntimeRoomSlugSchema,
} from "./asset-version.js";
import {
  CaptureControlAlignmentMethodSchema,
  RegisterCaptureControlSourceRecordInputSchema,
  CaptureControlQaStatusSchema,
  CaptureControlSourceClassSchema,
  CapturePoseAuthorityLevelSchema,
  captureControlAlignmentMethodsForSource,
  captureControlAuthorityLevelsForSource,
  type CaptureControlReference,
  type CaptureControlStalenessTrigger,
  type RegisterCaptureControlSourceRecordInput,
} from "./capture-control.js";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import {
  RuntimeManifestKeySchema,
  RuntimeTransformFrameSchema,
  RuntimeVec3Schema,
} from "./runtime-venue-manifest.js";
import {
  RuntimeTransformReadinessDispositionSchema,
  type RuntimeTransformReadinessV0,
} from "./runtime-transform-readiness.js";

export const RUNTIME_CONTROL_EVIDENCE_PACKET_V0_SCHEMA_VERSION =
  "runtime-control-evidence-packet.v0";

export const RUNTIME_CONTROL_EVIDENCE_PACKET_DISPOSITIONS = [
  "requirements_recorded",
  "candidate_landmarks_recorded",
  "coordinate_pairs_recorded",
  "ready_for_capture_control_registration",
  "accepted_for_transform_solve",
  "rejected",
] as const;
export const RuntimeControlEvidencePacketDispositionSchema = z.enum(
  RUNTIME_CONTROL_EVIDENCE_PACKET_DISPOSITIONS,
);
export type RuntimeControlEvidencePacketDisposition = z.infer<
  typeof RuntimeControlEvidencePacketDispositionSchema
>;

export const RUNTIME_CONTROL_LANDMARK_STATUSES = [
  "candidate_visible_only",
  "source_coordinate_recorded",
  "target_coordinate_recorded",
  "paired_coordinates_recorded",
  "reviewed",
  "rejected",
] as const;
export const RuntimeControlLandmarkStatusSchema = z.enum(
  RUNTIME_CONTROL_LANDMARK_STATUSES,
);
export type RuntimeControlLandmarkStatus = z.infer<
  typeof RuntimeControlLandmarkStatusSchema
>;

export const RUNTIME_CONTROL_FEATURE_CLASSES = [
  "door_jamb",
  "threshold_corner",
  "column_plinth",
  "wall_floor_corner",
  "window_frame",
  "ceiling_corner",
  "fiducial_marker",
  "control_distance_endpoint",
  "architectural_detail",
] as const;
export const RuntimeControlFeatureClassSchema = z.enum(
  RUNTIME_CONTROL_FEATURE_CLASSES,
);
export type RuntimeControlFeatureClass = z.infer<
  typeof RuntimeControlFeatureClassSchema
>;

export const RUNTIME_CONTROL_EVIDENCE_REF_KINDS = [
  "runtime_package",
  "runtime_visual_qa_review",
  "runtime_qa_record",
  "playwright_screenshot",
  "source_intake",
  "capture_control_source",
  "operator_note",
  "measurement_record",
  "landmark_set",
  "architecture_decision",
] as const;
export const RuntimeControlEvidenceRefKindSchema = z.enum(
  RUNTIME_CONTROL_EVIDENCE_REF_KINDS,
);
export type RuntimeControlEvidenceRefKind = z.infer<
  typeof RuntimeControlEvidenceRefKindSchema
>;

export const RUNTIME_CONTROL_CAPTURE_CONTROL_PAYLOAD_BUILD_REPORT_V0_SCHEMA_VERSION =
  "runtime-control-capture-control-payload-build-report.v0";

export const RUNTIME_CONTROL_CAPTURE_CONTROL_PAYLOAD_BUILD_STATUSES = [
  "blocked_current_packet",
  "payload_built",
] as const;
export const RuntimeControlCaptureControlPayloadBuildStatusSchema = z.enum(
  RUNTIME_CONTROL_CAPTURE_CONTROL_PAYLOAD_BUILD_STATUSES,
);
export type RuntimeControlCaptureControlPayloadBuildStatus = z.infer<
  typeof RuntimeControlCaptureControlPayloadBuildStatusSchema
>;

export const RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_V0_SCHEMA_VERSION =
  "runtime-control-coordinate-pair-intake.v0";

export const RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_V0_SCHEMA_VERSION =
  "runtime-control-coordinate-pair-packet-build-report.v0";

export const RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_V0_SCHEMA_VERSION =
  "runtime-control-coordinate-pair-intake-inspection.v0";

export const RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_V0_SCHEMA_VERSION =
  "runtime-control-coordinate-pair-intake-request.v0";

export const RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_V0_SCHEMA_VERSION =
  "runtime-control-evidence-chain-status.v0";

export const RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_STATUSES = [
  "blocked_missing_coordinate_pair_intake",
  "blocked_incompatible_coordinate_pairs",
  "packet_built",
] as const;
export const RuntimeControlCoordinatePairPacketBuildStatusSchema = z.enum(
  RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_STATUSES,
);
export type RuntimeControlCoordinatePairPacketBuildStatus = z.infer<
  typeof RuntimeControlCoordinatePairPacketBuildStatusSchema
>;

export const RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_STATUSES = [
  "missing_intake_file",
  "invalid_intake",
  "blocked_incompatible_intake",
  "ready_for_reviewed_packet_build",
] as const;
export const RuntimeControlCoordinatePairIntakeInspectionStatusSchema = z.enum(
  RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_STATUSES,
);
export type RuntimeControlCoordinatePairIntakeInspectionStatus = z.infer<
  typeof RuntimeControlCoordinatePairIntakeInspectionStatusSchema
>;

export const RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_STATUSES = [
  "coordinate_pairs_required",
  "blocked_insufficient_landmark_candidates",
] as const;
export const RuntimeControlCoordinatePairIntakeRequestStatusSchema = z.enum(
  RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_STATUSES,
);
export type RuntimeControlCoordinatePairIntakeRequestStatus = z.infer<
  typeof RuntimeControlCoordinatePairIntakeRequestStatusSchema
>;

export const RUNTIME_CONTROL_COORDINATE_PAIR_REQUIRED_OBSERVATIONS = [
  "source_point_coordinate",
  "target_point_coordinate",
  "per_landmark_residual_m",
  "reviewer_role",
  "measurement_evidence_ref",
] as const;
export const RuntimeControlCoordinatePairRequiredObservationSchema = z.enum(
  RUNTIME_CONTROL_COORDINATE_PAIR_REQUIRED_OBSERVATIONS,
);
export type RuntimeControlCoordinatePairRequiredObservation = z.infer<
  typeof RuntimeControlCoordinatePairRequiredObservationSchema
>;

export const RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES = [
  "blocked_insufficient_landmark_candidates",
  "blocked_missing_coordinate_pair_intake",
  "blocked_invalid_coordinate_pair_intake",
  "blocked_incompatible_coordinate_pair_intake",
  "blocked_packet_build",
  "blocked_capture_control_payload",
  "capture_control_payload_ready",
  "chain_inconsistent",
] as const;
export const RuntimeControlEvidenceChainStatusSchema = z.enum(
  RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES,
);
export type RuntimeControlEvidenceChainStatus = z.infer<
  typeof RuntimeControlEvidenceChainStatusSchema
>;

export const MANUAL_LANDMARK_CAPTURE_CONTROL_STALENESS_TRIGGERS = [
  "runtime_package_changed",
  "landmark_set_changed",
  "review_expired",
  "manual_contestation",
] as const satisfies readonly CaptureControlStalenessTrigger[];

const PACKET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const RuntimeControlEvidenceRefSchema = z
  .object({
    kind: RuntimeControlEvidenceRefKindSchema,
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(320),
  })
  .strict();
export type RuntimeControlEvidenceRef = z.infer<
  typeof RuntimeControlEvidenceRefSchema
>;

export const RuntimeControlPointObservationSchema = z
  .object({
    frame: RuntimeTransformFrameSchema,
    coordinate: RuntimeVec3Schema,
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).min(1),
  })
  .strict();
export type RuntimeControlPointObservation = z.infer<
  typeof RuntimeControlPointObservationSchema
>;

export const RuntimeControlLandmarkObservationSchema = z
  .object({
    landmarkId: RuntimeManifestKeySchema,
    label: z.string().trim().min(1).max(160),
    featureClass: RuntimeControlFeatureClassSchema,
    status: RuntimeControlLandmarkStatusSchema,
    sourcePoint: RuntimeControlPointObservationSchema.nullable(),
    targetPoint: RuntimeControlPointObservationSchema.nullable(),
    residualM: z.number().finite().nonnegative().nullable(),
    reviewerRole: z.string().trim().min(1).max(120).nullable(),
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).default([]),
    note: SafePlanningWordingSchema,
  })
  .strict()
  .superRefine((landmark, ctx) => {
    const hasSource = landmark.sourcePoint !== null;
    const hasTarget = landmark.targetPoint !== null;
    const hasPair = hasSource && hasTarget;

    if (landmark.status === "candidate_visible_only") {
      if (hasSource || hasTarget || landmark.residualM !== null || landmark.reviewerRole !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "Visible-only landmark candidates cannot carry coordinates, residuals, or reviewer roles.",
        });
      }
      if (landmark.evidenceRefs.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceRefs"],
          message: "Visible-only landmark candidates need visual evidence references.",
        });
      }
    }

    if (landmark.status === "source_coordinate_recorded" && !hasSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePoint"],
        message: "source_coordinate_recorded landmarks need a source point.",
      });
    }

    if (landmark.status === "target_coordinate_recorded" && !hasTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPoint"],
        message: "target_coordinate_recorded landmarks need a target point.",
      });
    }

    if (
      (landmark.status === "paired_coordinates_recorded" || landmark.status === "reviewed") &&
      !hasPair
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Paired or reviewed landmarks need both source and target coordinates.",
      });
    }

    if (landmark.residualM !== null && !hasPair) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["residualM"],
        message: "Landmark residuals require paired source and target coordinates.",
      });
    }

    if (landmark.status === "reviewed") {
      if (landmark.reviewerRole === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewerRole"],
          message: "Reviewed landmark observations need a reviewer role.",
        });
      }
      if (landmark.residualM === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["residualM"],
          message: "Reviewed landmark observations need a residual.",
        });
      }
    }
  });
export type RuntimeControlLandmarkObservation = z.infer<
  typeof RuntimeControlLandmarkObservationSchema
>;

export const RuntimeControlCoordinatePairObservationSchema = z
  .object({
    landmarkId: RuntimeManifestKeySchema,
    sourcePoint: RuntimeControlPointObservationSchema,
    targetPoint: RuntimeControlPointObservationSchema,
    residualM: z.number().finite().nonnegative(),
    reviewerRole: z.string().trim().min(1).max(120),
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).min(1),
    note: SafePlanningWordingSchema,
  })
  .strict();
export type RuntimeControlCoordinatePairObservation = z.infer<
  typeof RuntimeControlCoordinatePairObservationSchema
>;

function residualRmse(residuals: readonly number[]): number | null {
  if (residuals.length === 0) return null;
  const squareSum = residuals.reduce((total, residual) => total + residual * residual, 0);
  return Math.sqrt(squareSum / residuals.length);
}

function maxResidual(residuals: readonly number[]): number | null {
  return residuals.length === 0 ? null : Math.max(...residuals);
}

function nearlyEqual(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <= tolerance;
}

export const RuntimeControlCoordinatePairIntakeV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_V0_SCHEMA_VERSION),
    intakeId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    sourcePacketId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    recordedAt: z.string().datetime({ offset: true }),
    recordedBy: z.string().trim().min(1).max(160),
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    qaStatus: z.enum(["human_reviewed", "accepted"]),
    coordinatePairs: z.array(RuntimeControlCoordinatePairObservationSchema).min(3),
    residualRmseM: z.number().finite().nonnegative(),
    maxResidualM: z.number().finite().nonnegative(),
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).min(1),
    guardrails: z
      .object({
        sourcePacketMutated: z.literal(false),
        reviewedPacketCreated: z.literal(false),
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((intake, ctx) => {
    if (intake.sourceFrame === intake.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Coordinate-pair intake must map between different frames.",
      });
    }

    const seenLandmarkIds = new Set<string>();
    for (const [index, pair] of intake.coordinatePairs.entries()) {
      if (seenLandmarkIds.has(pair.landmarkId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinatePairs", index, "landmarkId"],
          message: "Coordinate-pair intake cannot duplicate landmark ids.",
        });
      }
      seenLandmarkIds.add(pair.landmarkId);

      if (pair.sourcePoint.frame !== intake.sourceFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinatePairs", index, "sourcePoint", "frame"],
          message: "Coordinate-pair source frame must match intake source frame.",
        });
      }
      if (pair.targetPoint.frame !== intake.targetFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinatePairs", index, "targetPoint", "frame"],
          message: "Coordinate-pair target frame must match intake target frame.",
        });
      }
    }

    const residuals = intake.coordinatePairs.map((pair) => pair.residualM);
    const computedRmse = residualRmse(residuals);
    const computedMax = maxResidual(residuals);
    if (computedRmse !== null && !nearlyEqual(intake.residualRmseM, computedRmse)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["residualRmseM"],
        message: "Coordinate-pair residual RMSE must match the per-landmark residuals.",
      });
    }
    if (computedMax !== null && !nearlyEqual(intake.maxResidualM, computedMax)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxResidualM"],
        message: "Coordinate-pair max residual must match the per-landmark residuals.",
      });
    }
  });
export type RuntimeControlCoordinatePairIntakeV0 = z.infer<
  typeof RuntimeControlCoordinatePairIntakeV0Schema
>;

export const RuntimeControlEvidencePacketV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_CONTROL_EVIDENCE_PACKET_V0_SCHEMA_VERSION),
    packetId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    recordedAt: z.string().datetime({ offset: true }),
    recordedBy: z.string().trim().min(1).max(160),
    disposition: RuntimeControlEvidencePacketDispositionSchema,
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    intendedCaptureControl: z
      .object({
        sourceClass: CaptureControlSourceClassSchema,
        poseAuthorityLevel: CapturePoseAuthorityLevelSchema,
        alignmentMethods: z.array(CaptureControlAlignmentMethodSchema).min(1),
        qaStatus: CaptureControlQaStatusSchema,
      })
      .strict(),
    targetTransformArtifactId: RuntimeManifestKeySchema.nullable(),
    landmarks: z.array(RuntimeControlLandmarkObservationSchema).min(1),
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).min(1),
    blockers: z.array(SafePlanningWordingSchema),
    requiredBeforeRegistration: z.array(SafePlanningWordingSchema),
    guardrails: z
      .object({
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((packet, ctx) => {
    if (packet.sourceFrame === packet.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Control evidence packets must map between different frames.",
      });
    }

    const allowedAuthorities = captureControlAuthorityLevelsForSource(
      packet.intendedCaptureControl.sourceClass,
    );
    if (!allowedAuthorities.includes(packet.intendedCaptureControl.poseAuthorityLevel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intendedCaptureControl", "poseAuthorityLevel"],
        message: "Intended capture-control source class cannot claim this pose authority.",
      });
    }

    const allowedMethods = captureControlAlignmentMethodsForSource(
      packet.intendedCaptureControl.sourceClass,
    );
    for (const [index, method] of packet.intendedCaptureControl.alignmentMethods.entries()) {
      if (!allowedMethods.includes(method)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intendedCaptureControl", "alignmentMethods", index],
          message: "Intended capture-control source class cannot claim this alignment method.",
        });
      }
    }

    for (const [index, landmark] of packet.landmarks.entries()) {
      if (landmark.sourcePoint !== null && landmark.sourcePoint.frame !== packet.sourceFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarks", index, "sourcePoint", "frame"],
          message: "Landmark source-point frame must match the packet source frame.",
        });
      }
      if (landmark.targetPoint !== null && landmark.targetPoint.frame !== packet.targetFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarks", index, "targetPoint", "frame"],
          message: "Landmark target-point frame must match the packet target frame.",
        });
      }
    }

    const readyDisposition =
      packet.disposition === "ready_for_capture_control_registration" ||
      packet.disposition === "accepted_for_transform_solve";
    const reviewedLandmarks = packet.landmarks.filter((landmark) =>
      landmark.status === "reviewed",
    );

    if (readyDisposition && reviewedLandmarks.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["landmarks"],
        message: "Ready control evidence packets need at least three reviewed landmark observations.",
      });
    }

    if (readyDisposition && packet.intendedCaptureControl.qaStatus !== "human_reviewed" && packet.intendedCaptureControl.qaStatus !== "accepted") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intendedCaptureControl", "qaStatus"],
        message: "Ready control evidence packets need human-reviewed or accepted QA status.",
      });
    }

    if (readyDisposition && packet.blockers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Ready control evidence packets cannot retain open blockers.",
      });
    }

    if (!readyDisposition && packet.blockers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked control evidence packets must list at least one blocker.",
      });
    }

    if (!readyDisposition && packet.requiredBeforeRegistration.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredBeforeRegistration"],
        message: "Blocked control evidence packets must list requirements before registration.",
      });
    }

    if (packet.disposition === "accepted_for_transform_solve" && packet.targetTransformArtifactId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetTransformArtifactId"],
        message: "Accepted transform-solve packets must name the target transform artifact id.",
      });
    }
  });
export type RuntimeControlEvidencePacketV0 = z.infer<
  typeof RuntimeControlEvidencePacketV0Schema
>;

export const RuntimeControlLandmarkSetSummarySchema = z
  .object({
    totalLandmarks: z.number().int().nonnegative(),
    nonRejectedLandmarks: z.number().int().nonnegative(),
    reviewedLandmarks: z.number().int().nonnegative(),
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    residualRmseM: z.number().finite().nonnegative().nullable(),
    maxResidualM: z.number().finite().nonnegative().nullable(),
    allNonRejectedLandmarksReviewed: z.boolean(),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (summary.nonRejectedLandmarks > summary.totalLandmarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nonRejectedLandmarks"],
        message: "Non-rejected landmark count cannot exceed total landmark count.",
      });
    }
    if (summary.reviewedLandmarks > summary.nonRejectedLandmarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewedLandmarks"],
        message: "Reviewed landmark count cannot exceed non-rejected landmark count.",
      });
    }
    if (summary.reviewedLandmarks === 0) {
      if (summary.residualRmseM !== null || summary.maxResidualM !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["residualRmseM"],
          message: "Residual metrics require at least one reviewed landmark.",
        });
      }
    }
    if (summary.reviewedLandmarks > 0) {
      if (summary.residualRmseM === null || summary.maxResidualM === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["residualRmseM"],
          message: "Reviewed landmark summaries need residual RMSE and max residual values.",
        });
      }
    }
    if (
      summary.allNonRejectedLandmarksReviewed !==
      (summary.reviewedLandmarks === summary.nonRejectedLandmarks)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allNonRejectedLandmarksReviewed"],
        message: "Review completeness flag must match reviewed and non-rejected landmark counts.",
      });
    }
  });
export type RuntimeControlLandmarkSetSummary = z.infer<
  typeof RuntimeControlLandmarkSetSummarySchema
>;

export const RuntimeControlCoordinatePairIntakeSummarySchema = z
  .object({
    coordinatePairCount: z.number().int().nonnegative(),
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    qaStatus: z.enum(["human_reviewed", "accepted"]),
    residualRmseM: z.number().finite().nonnegative(),
    maxResidualM: z.number().finite().nonnegative(),
    reviewerRoles: z.array(z.string().trim().min(1).max(120)).min(1),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (summary.coordinatePairCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinatePairCount"],
        message: "Coordinate-pair intake summaries need at least one coordinate pair.",
      });
    }
    if (summary.sourceFrame === summary.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Coordinate-pair intake summaries must map between different frames.",
      });
    }
  });
export type RuntimeControlCoordinatePairIntakeSummary = z.infer<
  typeof RuntimeControlCoordinatePairIntakeSummarySchema
>;

export const RuntimeControlCoordinatePairLandmarkRequestSchema = z
  .object({
    landmarkId: RuntimeManifestKeySchema,
    label: z.string().trim().min(1).max(160),
    featureClass: RuntimeControlFeatureClassSchema,
    sourcePacketStatus: RuntimeControlLandmarkStatusSchema,
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    required: z.boolean(),
    requiredObservations: z.array(
      RuntimeControlCoordinatePairRequiredObservationSchema,
    ),
    evidenceRefs: z.array(RuntimeControlEvidenceRefSchema).min(1),
    note: SafePlanningWordingSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.sourceFrame === request.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Coordinate-pair landmark requests must map between different frames.",
      });
    }
    if (request.required) {
      for (const observation of RUNTIME_CONTROL_COORDINATE_PAIR_REQUIRED_OBSERVATIONS) {
        if (!request.requiredObservations.includes(observation)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["requiredObservations"],
            message: `Required landmark requests must include ${observation}.`,
          });
        }
      }
    } else if (request.requiredObservations.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredObservations"],
        message: "Non-required landmark requests cannot list required observations.",
      });
    }
  });
export type RuntimeControlCoordinatePairLandmarkRequest = z.infer<
  typeof RuntimeControlCoordinatePairLandmarkRequestSchema
>;

export const RuntimeControlCoordinatePairIntakeRequestV0Schema = z
  .object({
    schemaVersion: z.literal(
      RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_V0_SCHEMA_VERSION,
    ),
    generatedAt: z.string().datetime(),
    sourcePacketRef: z.string().trim().min(1).max(320),
    sourcePacketId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    status: RuntimeControlCoordinatePairIntakeRequestStatusSchema,
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    landmarkSetSummary: RuntimeControlLandmarkSetSummarySchema,
    requiredCoordinatePairCount: z.number().int().nonnegative(),
    landmarkRequests: z.array(RuntimeControlCoordinatePairLandmarkRequestSchema).min(1),
    acceptanceCriteria: z.array(SafePlanningWordingSchema).min(1),
    blockers: z.array(SafePlanningWordingSchema),
    messages: z.array(SafePlanningWordingSchema).min(1),
    guardrails: z
      .object({
        sourcePacketMutated: z.literal(false),
        coordinatePairIntakeCreated: z.literal(false),
        reviewedPacketCreated: z.literal(false),
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.sourceFrame === request.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "Coordinate-pair intake requests must map between different frames.",
      });
    }

    const requiredCount = request.landmarkRequests.filter((landmark) =>
      landmark.required
    ).length;
    if (request.requiredCoordinatePairCount !== requiredCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredCoordinatePairCount"],
        message: "Required coordinate-pair count must match required landmark requests.",
      });
    }

    for (const [index, landmark] of request.landmarkRequests.entries()) {
      if (landmark.sourceFrame !== request.sourceFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarkRequests", index, "sourceFrame"],
          message: "Landmark request source frame must match the request source frame.",
        });
      }
      if (landmark.targetFrame !== request.targetFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarkRequests", index, "targetFrame"],
          message: "Landmark request target frame must match the request target frame.",
        });
      }
    }

    if (request.status === "coordinate_pairs_required") {
      if (request.requiredCoordinatePairCount < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requiredCoordinatePairCount"],
          message: "Coordinate-pair intake requests need at least three required landmark pairs.",
        });
      }
      if (request.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Ready coordinate-pair intake requests cannot include blockers.",
        });
      }
    }

    if (
      request.status === "blocked_insufficient_landmark_candidates" &&
      request.blockers.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked coordinate-pair intake requests must include blockers.",
      });
    }
  });
export type RuntimeControlCoordinatePairIntakeRequestV0 = z.infer<
  typeof RuntimeControlCoordinatePairIntakeRequestV0Schema
>;

export const RuntimeControlCoordinatePairIntakeInspectionV0Schema = z
  .object({
    schemaVersion: z.literal(
      RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_V0_SCHEMA_VERSION,
    ),
    generatedAt: z.string().datetime(),
    sourcePacketRef: z.string().trim().min(1).max(320),
    coordinatePairIntakeRef: z.string().trim().min(1).max(320).nullable(),
    sourcePacketId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    status: RuntimeControlCoordinatePairIntakeInspectionStatusSchema,
    readyForReviewedPacketBuild: z.boolean(),
    sourcePacketSummary: RuntimeControlLandmarkSetSummarySchema,
    coordinatePairIntakeSummary: RuntimeControlCoordinatePairIntakeSummarySchema.nullable(),
    blockers: z.array(SafePlanningWordingSchema),
    messages: z.array(SafePlanningWordingSchema).min(1),
    guardrails: z
      .object({
        sourcePacketMutated: z.literal(false),
        reviewedPacketCreated: z.literal(false),
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (inspection.readyForReviewedPacketBuild !== (inspection.status === "ready_for_reviewed_packet_build")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readyForReviewedPacketBuild"],
        message: "Readiness flag must match ready_for_reviewed_packet_build status.",
      });
    }
    if (inspection.status === "ready_for_reviewed_packet_build") {
      if (inspection.coordinatePairIntakeSummary === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinatePairIntakeSummary"],
          message: "Ready coordinate-pair inspections need an intake summary.",
        });
      }
      if (inspection.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Ready coordinate-pair inspections cannot include blockers.",
        });
      }
    } else if (inspection.blockers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked coordinate-pair inspections must include blockers.",
      });
    }
    if (inspection.status === "missing_intake_file" && inspection.coordinatePairIntakeRef !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinatePairIntakeRef"],
        message: "Missing-intake inspections cannot name an intake ref.",
      });
    }
  });
export type RuntimeControlCoordinatePairIntakeInspectionV0 = z.infer<
  typeof RuntimeControlCoordinatePairIntakeInspectionV0Schema
>;

export const RuntimeControlCoordinatePairPacketBuildReportV0Schema = z
  .object({
    schemaVersion: z.literal(
      RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_V0_SCHEMA_VERSION,
    ),
    generatedAt: z.string().datetime(),
    sourcePacketRef: z.string().trim().min(1).max(320),
    coordinatePairIntakeRef: z.string().trim().min(1).max(320).nullable(),
    sourcePacketId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    status: RuntimeControlCoordinatePairPacketBuildStatusSchema,
    reviewedPacketFile: z.string().trim().min(1).max(500).nullable(),
    sourcePacketSummary: RuntimeControlLandmarkSetSummarySchema,
    reviewedPacketSummary: RuntimeControlLandmarkSetSummarySchema.nullable(),
    reviewedPacket: RuntimeControlEvidencePacketV0Schema.nullable(),
    blockers: z.array(SafePlanningWordingSchema),
    messages: z.array(SafePlanningWordingSchema).min(1),
    guardrails: z
      .object({
        sourcePacketMutated: z.literal(false),
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.status === "packet_built") {
      if (report.reviewedPacket === null || report.reviewedPacketSummary === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacket"],
          message: "Successful coordinate-pair packet-build reports must include the reviewed packet.",
        });
      }
      if (report.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Successful coordinate-pair packet-build reports cannot include blockers.",
        });
      }
      if (report.coordinatePairIntakeRef === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinatePairIntakeRef"],
          message: "Successful coordinate-pair packet-build reports need the coordinate-pair intake ref.",
        });
      }
    }

    if (report.status !== "packet_built") {
      if (report.reviewedPacket !== null || report.reviewedPacketSummary !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacket"],
          message: "Blocked coordinate-pair packet-build reports cannot include a reviewed packet.",
        });
      }
      if (report.reviewedPacketFile !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacketFile"],
          message: "Blocked coordinate-pair packet-build reports cannot name a written reviewed packet file.",
        });
      }
      if (report.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Blocked coordinate-pair packet-build reports must include blockers.",
        });
      }
    }

    if (report.reviewedPacket !== null) {
      if (report.reviewedPacket.venueSlug !== report.venueSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacket", "venueSlug"],
          message: "Reviewed packet venue must match the source packet venue.",
        });
      }
      if (report.reviewedPacket.roomSlug !== report.roomSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacket", "roomSlug"],
          message: "Reviewed packet room must match the source packet room.",
        });
      }
      if (report.reviewedPacket.runtimePackageId !== report.runtimePackageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedPacket", "runtimePackageId"],
          message: "Reviewed packet runtime package must match the source packet runtime package.",
        });
      }
    }
  });
export type RuntimeControlCoordinatePairPacketBuildReportV0 = z.infer<
  typeof RuntimeControlCoordinatePairPacketBuildReportV0Schema
>;

export const RuntimeControlCaptureControlPayloadBuildReportV0Schema = z
  .object({
    schemaVersion: z.literal(
      RUNTIME_CONTROL_CAPTURE_CONTROL_PAYLOAD_BUILD_REPORT_V0_SCHEMA_VERSION,
    ),
    generatedAt: z.string().datetime(),
    packetRef: z.string().trim().min(1).max(320),
    packetId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    landmarkSetSummary: RuntimeControlLandmarkSetSummarySchema,
    status: RuntimeControlCaptureControlPayloadBuildStatusSchema,
    payloadFile: z.string().trim().min(1).max(500).nullable(),
    payload: RegisterCaptureControlSourceRecordInputSchema.nullable(),
    blockers: z.array(SafePlanningWordingSchema),
    messages: z.array(SafePlanningWordingSchema).min(1),
    guardrails: z
      .object({
        captureControlSourceCreated: z.literal(false),
        liveRegistrationAttempted: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.status === "blocked_current_packet") {
      if (report.payload !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload"],
          message: "Blocked payload-build reports cannot include a capture-control payload.",
        });
      }
      if (report.payloadFile !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payloadFile"],
          message: "Blocked payload-build reports cannot name a written payload file.",
        });
      }
      if (report.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Blocked payload-build reports must include blockers.",
        });
      }
    }

    if (report.status === "payload_built") {
      if (report.payload === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload"],
          message: "Successful payload-build reports must include the capture-control payload.",
        });
      }
      if (report.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Successful payload-build reports cannot include blockers.",
        });
      }
    }

    if (report.payload !== null) {
      if (report.payload.venueSlug !== report.venueSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "venueSlug"],
          message: "Payload venue must match the source packet venue.",
        });
      }
      if (report.payload.roomSlug !== report.roomSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "roomSlug"],
          message: "Payload room must match the source packet room.",
        });
      }
      if ((report.payload.runtimePackageId ?? null) !== report.runtimePackageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "runtimePackageId"],
          message: "Payload runtime package must match the source packet runtime package.",
        });
      }
    }
  });
export type RuntimeControlCaptureControlPayloadBuildReportV0 = z.infer<
  typeof RuntimeControlCaptureControlPayloadBuildReportV0Schema
>;

export const RuntimeControlEvidenceChainStatusV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_V0_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    sourcePacketRef: z.string().trim().min(1).max(320),
    coordinatePairIntakeRequestRef: z.string().trim().min(1).max(320),
    coordinatePairIntakeInspectionRef: z.string().trim().min(1).max(320),
    coordinatePairPacketBuildReportRef: z.string().trim().min(1).max(320),
    captureControlPayloadBuildReportRef: z.string().trim().min(1).max(320),
    transformReadinessRef: z.string().trim().min(1).max(320),
    sourcePacketId: z.string().trim().min(1).max(160).regex(PACKET_ID),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    chainStatus: RuntimeControlEvidenceChainStatusSchema,
    sourcePacketSummary: RuntimeControlLandmarkSetSummarySchema,
    coordinatePairIntakeRequestStatus: RuntimeControlCoordinatePairIntakeRequestStatusSchema,
    coordinatePairIntakeInspectionStatus: RuntimeControlCoordinatePairIntakeInspectionStatusSchema,
    coordinatePairPacketBuildStatus: RuntimeControlCoordinatePairPacketBuildStatusSchema,
    captureControlPayloadBuildStatus: RuntimeControlCaptureControlPayloadBuildStatusSchema,
    transformReadinessDisposition: RuntimeTransformReadinessDispositionSchema,
    requiredCoordinatePairCount: z.number().int().nonnegative(),
    reviewedCoordinatePairCount: z.number().int().nonnegative(),
    captureControlPayloadReady: z.boolean(),
    consistencyIssues: z.array(SafePlanningWordingSchema),
    blockers: z.array(SafePlanningWordingSchema),
    nextActions: z.array(SafePlanningWordingSchema).min(1),
    messages: z.array(SafePlanningWordingSchema).min(1),
    guardrails: z
      .object({
        sourcePacketMutated: z.literal(false),
        coordinatePairIntakeCreated: z.literal(false),
        reviewedPacketCreated: z.literal(false),
        captureControlSourceCreated: z.literal(false),
        transformPayloadCreated: z.literal(false),
        signedTransformCreated: z.literal(false),
        assetEvidencePromoted: z.literal(false),
        publicExposureChanged: z.literal(false),
        operationalGeometryCreated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((status, ctx) => {
    if (status.chainStatus === "chain_inconsistent") {
      if (status.consistencyIssues.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consistencyIssues"],
          message: "Inconsistent chain reports must include consistency issues.",
        });
      }
    } else if (status.consistencyIssues.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consistencyIssues"],
        message: "Consistent chain reports cannot include consistency issues.",
      });
    }

    if (status.chainStatus !== "capture_control_payload_ready" && status.blockers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Blocked chain reports must include blockers.",
      });
    }

    if (status.chainStatus === "capture_control_payload_ready") {
      if (!status.captureControlPayloadReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["captureControlPayloadReady"],
          message: "Ready chain reports must mark the capture-control payload ready.",
        });
      }
      if (status.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Ready chain reports cannot include blockers.",
        });
      }
    }
  });
export type RuntimeControlEvidenceChainStatusV0 = z.infer<
  typeof RuntimeControlEvidenceChainStatusV0Schema
>;

type ReviewedRuntimeControlLandmarkObservation = RuntimeControlLandmarkObservation & {
  readonly sourcePoint: RuntimeControlPointObservation;
  readonly targetPoint: RuntimeControlPointObservation;
  readonly residualM: number;
  readonly reviewerRole: string;
};

export interface BuildManualLandmarksCaptureControlSourcePayloadOptions {
  readonly sourceId?: string;
  readonly packetRef?: string;
  readonly reviewerRole?: string;
  readonly reviewNote?: string | null;
}

export interface BuildRuntimeControlCaptureControlPayloadReportParams
  extends BuildManualLandmarksCaptureControlSourcePayloadOptions {
  readonly generatedAt: string;
  readonly packetRef: string;
  readonly payloadFile?: string | null;
}

export interface BuildReviewedRuntimeControlPacketOptions {
  readonly packetId?: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly targetTransformArtifactId?: string | null;
}

export interface BuildRuntimeControlCoordinatePairIntakeRequestParams {
  readonly generatedAt: string;
  readonly sourcePacketRef: string;
}

export interface BuildRuntimeControlCoordinatePairPacketReportParams
  extends BuildReviewedRuntimeControlPacketOptions {
  readonly generatedAt: string;
  readonly sourcePacketRef: string;
  readonly coordinatePairIntakeRef?: string | null;
  readonly reviewedPacketFile?: string | null;
}

export interface BuildRuntimeControlEvidenceChainStatusParams {
  readonly generatedAt: string;
  readonly sourcePacketRef: string;
  readonly coordinatePairIntakeRequestRef: string;
  readonly coordinatePairIntakeInspectionRef: string;
  readonly coordinatePairPacketBuildReportRef: string;
  readonly captureControlPayloadBuildReportRef: string;
  readonly transformReadinessRef: string;
}

function isReviewedRuntimeControlLandmark(
  landmark: RuntimeControlLandmarkObservation,
): landmark is ReviewedRuntimeControlLandmarkObservation {
  return landmark.status === "reviewed" &&
    landmark.sourcePoint !== null &&
    landmark.targetPoint !== null &&
    landmark.residualM !== null &&
    landmark.reviewerRole !== null;
}

function packetHasReadyDisposition(packet: RuntimeControlEvidencePacketV0): boolean {
  return packet.disposition === "ready_for_capture_control_registration" ||
    packet.disposition === "accepted_for_transform_solve";
}

function packetHasReviewedQa(packet: RuntimeControlEvidencePacketV0): boolean {
  return packet.intendedCaptureControl.qaStatus === "human_reviewed" ||
    packet.intendedCaptureControl.qaStatus === "accepted";
}

function deriveReviewerRole(
  landmarks: readonly ReviewedRuntimeControlLandmarkObservation[],
): string {
  const roles = Array.from(new Set(landmarks.map((landmark) => landmark.reviewerRole)));
  const onlyRole = roles.length === 1 ? roles[0] : undefined;
  return onlyRole ?? "multi_role_landmark_review";
}

function reviewedLandmarks(packet: RuntimeControlEvidencePacketV0): readonly ReviewedRuntimeControlLandmarkObservation[] {
  return packet.landmarks.filter(isReviewedRuntimeControlLandmark);
}

export function runtimeControlLandmarkSetSummary(
  packet: RuntimeControlEvidencePacketV0,
): RuntimeControlLandmarkSetSummary {
  const reviewed = reviewedLandmarks(packet);
  const nonRejectedLandmarks = packet.landmarks.filter((landmark) =>
    landmark.status !== "rejected",
  ).length;
  const residualSquares = reviewed.map((landmark) => landmark.residualM * landmark.residualM);
  const residualRmseM = residualSquares.length === 0
    ? null
    : Math.sqrt(residualSquares.reduce((total, value) => total + value, 0) / residualSquares.length);
  const residualValues = reviewed.map((landmark) => landmark.residualM);
  const maxResidualM = residualValues.length === 0 ? null : Math.max(...residualValues);

  return RuntimeControlLandmarkSetSummarySchema.parse({
    totalLandmarks: packet.landmarks.length,
    nonRejectedLandmarks,
    reviewedLandmarks: reviewed.length,
    sourceFrame: packet.sourceFrame,
    targetFrame: packet.targetFrame,
    residualRmseM,
    maxResidualM,
    allNonRejectedLandmarksReviewed: reviewed.length === nonRejectedLandmarks,
  });
}

export function runtimeControlCoordinatePairIntakeSummary(
  intake: RuntimeControlCoordinatePairIntakeV0,
): RuntimeControlCoordinatePairIntakeSummary {
  const reviewerRoles = Array.from(new Set(intake.coordinatePairs.map((pair) => pair.reviewerRole)));
  return RuntimeControlCoordinatePairIntakeSummarySchema.parse({
    coordinatePairCount: intake.coordinatePairs.length,
    sourceFrame: intake.sourceFrame,
    targetFrame: intake.targetFrame,
    qaStatus: intake.qaStatus,
    residualRmseM: intake.residualRmseM,
    maxResidualM: intake.maxResidualM,
    reviewerRoles,
  });
}

function requiredCoordinatePairLandmarks(
  packet: RuntimeControlEvidencePacketV0,
): readonly RuntimeControlLandmarkObservation[] {
  return packet.landmarks.filter((landmark) => landmark.status !== "rejected");
}

export function runtimeControlCoordinatePairIntakeRequestBlockers(
  packet: RuntimeControlEvidencePacketV0,
): readonly string[] {
  const requiredCount = requiredCoordinatePairLandmarks(packet).length;
  if (requiredCount >= 3) return [];
  return [
    `At least three non-rejected landmark candidates are required; the source packet has ${String(requiredCount)}.`,
  ];
}

function coordinatePairLandmarkRequest(
  packet: RuntimeControlEvidencePacketV0,
  landmark: RuntimeControlLandmarkObservation,
): RuntimeControlCoordinatePairLandmarkRequest {
  const required = landmark.status !== "rejected";
  return RuntimeControlCoordinatePairLandmarkRequestSchema.parse({
    landmarkId: landmark.landmarkId,
    label: landmark.label,
    featureClass: landmark.featureClass,
    sourcePacketStatus: landmark.status,
    sourceFrame: packet.sourceFrame,
    targetFrame: packet.targetFrame,
    required,
    requiredObservations: required
      ? [...RUNTIME_CONTROL_COORDINATE_PAIR_REQUIRED_OBSERVATIONS]
      : [],
    evidenceRefs: landmark.evidenceRefs,
    note: required
      ? `Record reviewed ${packet.sourceFrame} and ${packet.targetFrame} coordinate observations, residual, reviewer role, and measurement evidence for ${landmark.landmarkId}.`
      : `No coordinate pair is requested for rejected landmark ${landmark.landmarkId}.`,
  });
}

export function buildRuntimeControlCoordinatePairIntakeRequest(
  packet: RuntimeControlEvidencePacketV0,
  params: BuildRuntimeControlCoordinatePairIntakeRequestParams,
): RuntimeControlCoordinatePairIntakeRequestV0 {
  const blockers = runtimeControlCoordinatePairIntakeRequestBlockers(packet);
  const requiredCount = requiredCoordinatePairLandmarks(packet).length;
  return RuntimeControlCoordinatePairIntakeRequestV0Schema.parse({
    schemaVersion: RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_V0_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    sourcePacketRef: params.sourcePacketRef,
    sourcePacketId: packet.packetId,
    venueSlug: packet.venueSlug,
    roomSlug: packet.roomSlug,
    runtimePackageId: packet.runtimePackageId,
    status: blockers.length === 0
      ? "coordinate_pairs_required"
      : "blocked_insufficient_landmark_candidates",
    sourceFrame: packet.sourceFrame,
    targetFrame: packet.targetFrame,
    landmarkSetSummary: runtimeControlLandmarkSetSummary(packet),
    requiredCoordinatePairCount: requiredCount,
    landmarkRequests: packet.landmarks.map((landmark) =>
      coordinatePairLandmarkRequest(packet, landmark),
    ),
    acceptanceCriteria: [
      "Create a separate runtime-control-coordinate-pair-intake.v0 file; do not edit the source packet.",
      "Include every required landmark id exactly once with source and target coordinates in the requested frames.",
      "Include per-landmark residuals, residual RMSE, max residual, reviewer role, and measurement evidence refs.",
      "Keep all coordinate-pair intake guardrails false until a later command builds downstream artifacts.",
    ],
    blockers,
    messages: blockers.length === 0
      ? [
          "Coordinate-pair intake measurements are required before a reviewed runtime-control packet can be built.",
          "This request created no coordinate-pair intake, reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry.",
        ]
      : [
          "The source packet does not contain enough non-rejected landmark candidates for a coordinate-pair intake request.",
          "This request created no coordinate-pair intake, reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry.",
        ],
    guardrails: {
      sourcePacketMutated: false,
      coordinatePairIntakeCreated: false,
      reviewedPacketCreated: false,
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

function nonRejectedLandmarks(
  packet: RuntimeControlEvidencePacketV0,
): readonly RuntimeControlLandmarkObservation[] {
  return packet.landmarks.filter((landmark) => landmark.status !== "rejected");
}

function coordinatePairsByLandmarkId(
  intake: RuntimeControlCoordinatePairIntakeV0,
): ReadonlyMap<string, RuntimeControlCoordinatePairObservation> {
  return new Map(intake.coordinatePairs.map((pair) => [pair.landmarkId, pair]));
}

export function runtimeControlCoordinatePairPacketBuildBlockers(
  sourcePacket: RuntimeControlEvidencePacketV0,
  intake: RuntimeControlCoordinatePairIntakeV0 | null,
): readonly string[] {
  if (intake === null) {
    return ["No reviewed coordinate-pair intake file was provided."];
  }

  const blockers: string[] = [];
  if (intake.sourcePacketId !== sourcePacket.packetId) {
    blockers.push("Coordinate-pair intake source packet id does not match the source packet.");
  }
  if (intake.venueSlug !== sourcePacket.venueSlug) {
    blockers.push("Coordinate-pair intake venue does not match the source packet.");
  }
  if (intake.roomSlug !== sourcePacket.roomSlug) {
    blockers.push("Coordinate-pair intake room does not match the source packet.");
  }
  if (intake.runtimePackageId !== sourcePacket.runtimePackageId) {
    blockers.push("Coordinate-pair intake runtime package id does not match the source packet.");
  }
  if (intake.sourceFrame !== sourcePacket.sourceFrame) {
    blockers.push("Coordinate-pair intake source frame does not match the source packet.");
  }
  if (intake.targetFrame !== sourcePacket.targetFrame) {
    blockers.push("Coordinate-pair intake target frame does not match the source packet.");
  }

  const pairsById = coordinatePairsByLandmarkId(intake);
  const sourceLandmarkIds = new Set(sourcePacket.landmarks.map((landmark) => landmark.landmarkId));
  for (const landmark of nonRejectedLandmarks(sourcePacket)) {
    if (!pairsById.has(landmark.landmarkId)) {
      blockers.push(`Missing reviewed coordinate pair for landmark ${landmark.landmarkId}.`);
    }
  }
  for (const pair of intake.coordinatePairs) {
    if (!sourceLandmarkIds.has(pair.landmarkId)) {
      blockers.push(`Coordinate-pair intake references unknown landmark ${pair.landmarkId}.`);
    }
  }

  return blockers;
}

export function inspectRuntimeControlCoordinatePairIntake(
  sourcePacket: RuntimeControlEvidencePacketV0,
  intake: RuntimeControlCoordinatePairIntakeV0 | null,
  params: {
    readonly generatedAt: string;
    readonly sourcePacketRef: string;
    readonly coordinatePairIntakeRef?: string | null;
    readonly invalidIntakeBlockers?: readonly string[];
  },
): RuntimeControlCoordinatePairIntakeInspectionV0 {
  const invalidBlockers = params.invalidIntakeBlockers ?? [];
  const blockers = invalidBlockers.length > 0
    ? [...invalidBlockers]
    : runtimeControlCoordinatePairPacketBuildBlockers(sourcePacket, intake);
  const status: RuntimeControlCoordinatePairIntakeInspectionStatus =
    invalidBlockers.length > 0
      ? "invalid_intake"
      : intake === null
        ? "missing_intake_file"
        : blockers.length === 0
          ? "ready_for_reviewed_packet_build"
          : "blocked_incompatible_intake";

  return RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse({
    schemaVersion: RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_V0_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    sourcePacketRef: params.sourcePacketRef,
    coordinatePairIntakeRef: params.coordinatePairIntakeRef ?? null,
    sourcePacketId: sourcePacket.packetId,
    venueSlug: sourcePacket.venueSlug,
    roomSlug: sourcePacket.roomSlug,
    runtimePackageId: sourcePacket.runtimePackageId,
    status,
    readyForReviewedPacketBuild: status === "ready_for_reviewed_packet_build",
    sourcePacketSummary: runtimeControlLandmarkSetSummary(sourcePacket),
    coordinatePairIntakeSummary: intake === null
      ? null
      : runtimeControlCoordinatePairIntakeSummary(intake),
    blockers,
    messages: status === "ready_for_reviewed_packet_build"
      ? [
          "Coordinate-pair intake is ready to build a reviewed runtime-control packet.",
          "No reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created by this inspection.",
        ]
      : [
          "Coordinate-pair intake is not ready to build a reviewed runtime-control packet.",
          "No reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created by this inspection.",
        ],
    guardrails: {
      sourcePacketMutated: false,
      reviewedPacketCreated: false,
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

function reviewedLandmarkFromCoordinatePair(
  landmark: RuntimeControlLandmarkObservation,
  pair: RuntimeControlCoordinatePairObservation,
): RuntimeControlLandmarkObservation {
  return RuntimeControlLandmarkObservationSchema.parse({
    ...landmark,
    status: "reviewed",
    sourcePoint: pair.sourcePoint,
    targetPoint: pair.targetPoint,
    residualM: pair.residualM,
    reviewerRole: pair.reviewerRole,
    evidenceRefs: pair.evidenceRefs,
    note: pair.note,
  });
}

export function buildReviewedRuntimeControlPacketFromCoordinatePairIntake(
  sourcePacket: RuntimeControlEvidencePacketV0,
  intake: RuntimeControlCoordinatePairIntakeV0,
  options: BuildReviewedRuntimeControlPacketOptions,
): RuntimeControlEvidencePacketV0 {
  const blockers = runtimeControlCoordinatePairPacketBuildBlockers(sourcePacket, intake);
  if (blockers.length > 0) {
    throw new Error(`Coordinate-pair intake cannot build a reviewed runtime-control packet: ${blockers.join(" ")}`);
  }

  const pairsById = coordinatePairsByLandmarkId(intake);
  return RuntimeControlEvidencePacketV0Schema.parse({
    ...sourcePacket,
    packetId: options.packetId ?? `${sourcePacket.packetId}-reviewed-pairs`,
    recordedAt: options.recordedAt,
    recordedBy: options.recordedBy,
    disposition: "ready_for_capture_control_registration",
    intendedCaptureControl: {
      ...sourcePacket.intendedCaptureControl,
      qaStatus: intake.qaStatus,
    },
    targetTransformArtifactId: options.targetTransformArtifactId ?? sourcePacket.targetTransformArtifactId,
    landmarks: sourcePacket.landmarks.map((landmark) => {
      if (landmark.status === "rejected") return landmark;
      const pair = pairsById.get(landmark.landmarkId);
      if (pair === undefined) return landmark;
      return reviewedLandmarkFromCoordinatePair(landmark, pair);
    }),
    evidenceRefs: [
      ...sourcePacket.evidenceRefs,
      ...intake.evidenceRefs,
    ],
    blockers: [],
    requiredBeforeRegistration: [],
    guardrails: {
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

export function buildRuntimeControlCoordinatePairPacketReport(
  sourcePacket: RuntimeControlEvidencePacketV0,
  intake: RuntimeControlCoordinatePairIntakeV0 | null,
  params: BuildRuntimeControlCoordinatePairPacketReportParams,
): RuntimeControlCoordinatePairPacketBuildReportV0 {
  const blockers = runtimeControlCoordinatePairPacketBuildBlockers(sourcePacket, intake);
  const reviewedPacket = blockers.length === 0 && intake !== null
    ? buildReviewedRuntimeControlPacketFromCoordinatePairIntake(sourcePacket, intake, params)
    : null;
  const status: RuntimeControlCoordinatePairPacketBuildStatus = reviewedPacket === null
    ? intake === null
      ? "blocked_missing_coordinate_pair_intake"
      : "blocked_incompatible_coordinate_pairs"
    : "packet_built";

  return RuntimeControlCoordinatePairPacketBuildReportV0Schema.parse({
    schemaVersion: RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_V0_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    sourcePacketRef: params.sourcePacketRef,
    coordinatePairIntakeRef: params.coordinatePairIntakeRef ?? null,
    sourcePacketId: sourcePacket.packetId,
    venueSlug: sourcePacket.venueSlug,
    roomSlug: sourcePacket.roomSlug,
    runtimePackageId: sourcePacket.runtimePackageId,
    status,
    reviewedPacketFile: reviewedPacket === null ? null : params.reviewedPacketFile ?? null,
    sourcePacketSummary: runtimeControlLandmarkSetSummary(sourcePacket),
    reviewedPacketSummary: reviewedPacket === null
      ? null
      : runtimeControlLandmarkSetSummary(reviewedPacket),
    reviewedPacket,
    blockers,
    messages: reviewedPacket === null
      ? [
          "Reviewed coordinate-pair intake is not ready to build a reviewed runtime-control packet.",
          "No reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created.",
        ]
      : [
          "Reviewed runtime-control packet was built from the coordinate-pair intake.",
          "Run the manual-landmarks capture-control payload builder before any registration dry-run.",
        ],
    guardrails: {
      sourcePacketMutated: false,
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

export function runtimeControlPacketManualLandmarkPayloadBlockers(
  packet: RuntimeControlEvidencePacketV0,
): readonly string[] {
  const blockers: string[] = [];
  const reviewed = reviewedLandmarks(packet);
  const nonRejectedCount = packet.landmarks.filter((landmark) =>
    landmark.status !== "rejected",
  ).length;

  if (packet.intendedCaptureControl.sourceClass !== "manual_landmarks") {
    blockers.push("Packet intended source class is not manual_landmarks.");
  }
  if (packet.intendedCaptureControl.poseAuthorityLevel !== "manual_landmark_control") {
    blockers.push("Packet intended pose authority is not manual_landmark_control.");
  }
  if (!packet.intendedCaptureControl.alignmentMethods.includes("landmark_solve")) {
    blockers.push("Packet intended alignment methods do not include landmark_solve.");
  }
  if (!packetHasReadyDisposition(packet)) {
    blockers.push("Packet disposition is not ready for capture-control registration.");
  }
  if (!packetHasReviewedQa(packet)) {
    blockers.push("Packet QA status is not human_reviewed or accepted.");
  }
  if (packet.blockers.length > 0) {
    blockers.push("Packet still lists open blockers.");
  }
  if (packet.requiredBeforeRegistration.length > 0) {
    blockers.push("Packet still lists requirements before capture-control registration.");
  }
  if (reviewed.length < 3) {
    blockers.push("Fewer than three reviewed landmark coordinate pairs are present.");
  }
  if (reviewed.length !== nonRejectedCount) {
    blockers.push("Every non-rejected landmark must be reviewed before payload build.");
  }
  if (reviewed.some((landmark) => landmark.sourcePoint.frame !== packet.sourceFrame)) {
    blockers.push("At least one reviewed source point uses a frame different from the packet source frame.");
  }
  if (reviewed.some((landmark) => landmark.targetPoint.frame !== packet.targetFrame)) {
    blockers.push("At least one reviewed target point uses a frame different from the packet target frame.");
  }

  return blockers;
}

function packetReference(
  packet: RuntimeControlEvidencePacketV0,
  options: BuildManualLandmarksCaptureControlSourcePayloadOptions,
): string {
  return options.packetRef ?? packet.packetId;
}

function captureControlSourceReferences(
  packet: RuntimeControlEvidencePacketV0,
  packetRef: string,
): readonly CaptureControlReference[] {
  return [
    {
      refType: "landmark_set",
      ref: packetRef,
      role: "reviewed_landmark_packet",
    },
    {
      refType: "runtime_package",
      ref: packet.runtimePackageId,
      role: "runtime_package",
    },
  ];
}

function captureControlTransformReferences(
  packet: RuntimeControlEvidencePacketV0,
): readonly CaptureControlReference[] {
  if (packet.targetTransformArtifactId === null) return [];
  return [
    {
      refType: "transform_artifact",
      ref: packet.targetTransformArtifactId,
      role: "target_transform",
    },
  ];
}

function captureControlResidualReferences(packetRef: string): readonly CaptureControlReference[] {
  return [
    {
      refType: "landmark_set",
      ref: packetRef,
      role: "residual_metrics",
    },
  ];
}

export function buildManualLandmarksCaptureControlSourcePayload(
  packet: RuntimeControlEvidencePacketV0,
  options: BuildManualLandmarksCaptureControlSourcePayloadOptions = {},
): RegisterCaptureControlSourceRecordInput {
  const blockers = runtimeControlPacketManualLandmarkPayloadBlockers(packet);
  if (blockers.length > 0) {
    throw new Error(`Runtime control packet cannot build a manual_landmarks payload: ${blockers.join(" ")}`);
  }

  const reviewed = reviewedLandmarks(packet);
  const packetRef = packetReference(packet, options);
  const sourceId = options.sourceId ?? `${packet.packetId}-manual-landmarks`;
  const reviewerRole = options.reviewerRole ?? deriveReviewerRole(reviewed);

  return RegisterCaptureControlSourceRecordInputSchema.parse({
    venueSlug: packet.venueSlug,
    roomSlug: packet.roomSlug,
    runtimePackageId: packet.runtimePackageId,
    transformArtifactId: packet.targetTransformArtifactId,
    source: {
      sourceId,
      sourceClass: "manual_landmarks",
      poseAuthorityLevel: "manual_landmark_control",
      alignmentMethods: ["landmark_solve"],
      qaStatus: packet.intendedCaptureControl.qaStatus,
      sourceRefs: captureControlSourceReferences(packet, packetRef),
      transformArtifactRefs: captureControlTransformReferences(packet),
      residualMetricRefs: captureControlResidualReferences(packetRef),
      staleWhen: MANUAL_LANDMARK_CAPTURE_CONTROL_STALENESS_TRIGGERS,
      reviewerRole,
      notes: `Manual landmark control source built from reviewed packet ${packet.packetId}; source frame ${packet.sourceFrame}; target frame ${packet.targetFrame}; reviewed landmark pairs ${String(reviewed.length)}.`,
    },
    reviewNote: options.reviewNote ??
      "Manual landmark capture-control payload built from reviewed runtime-control packet; no live registration or public exposure change was performed.",
  });
}

export function buildRuntimeControlCaptureControlPayloadReport(
  packet: RuntimeControlEvidencePacketV0,
  params: BuildRuntimeControlCaptureControlPayloadReportParams,
): RuntimeControlCaptureControlPayloadBuildReportV0 {
  const blockers = runtimeControlPacketManualLandmarkPayloadBlockers(packet);
  const payload = blockers.length === 0
    ? buildManualLandmarksCaptureControlSourcePayload(packet, params)
    : null;

  return RuntimeControlCaptureControlPayloadBuildReportV0Schema.parse({
    schemaVersion: RUNTIME_CONTROL_CAPTURE_CONTROL_PAYLOAD_BUILD_REPORT_V0_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    packetRef: params.packetRef,
    packetId: packet.packetId,
    venueSlug: packet.venueSlug,
    roomSlug: packet.roomSlug,
    runtimePackageId: packet.runtimePackageId,
    landmarkSetSummary: runtimeControlLandmarkSetSummary(packet),
    status: payload === null ? "blocked_current_packet" : "payload_built",
    payloadFile: payload === null ? null : params.payloadFile ?? null,
    payload,
    blockers,
    messages: payload === null
      ? [
          "Runtime control packet is not ready to build a manual_landmarks capture-control payload.",
          "No capture-control source, signed transform, public exposure change, or operational geometry was created.",
        ]
      : [
          "Manual landmark capture-control payload was built from reviewed runtime-control evidence.",
          "Run the capture-control registration script in dry-run mode before any live registration.",
        ],
    guardrails: {
      captureControlSourceCreated: false,
      liveRegistrationAttempted: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

interface RuntimeControlArtifactIdentity {
  readonly venueSlug: string;
  readonly roomSlug: string;
  readonly runtimePackageId: string;
}

function appendIdentityIssues(
  issues: string[],
  label: string,
  sourcePacket: RuntimeControlEvidencePacketV0,
  artifact: RuntimeControlArtifactIdentity,
): void {
  if (artifact.venueSlug !== sourcePacket.venueSlug) {
    issues.push(`${label} venue does not match the source packet.`);
  }
  if (artifact.roomSlug !== sourcePacket.roomSlug) {
    issues.push(`${label} room does not match the source packet.`);
  }
  if (artifact.runtimePackageId !== sourcePacket.runtimePackageId) {
    issues.push(`${label} runtime package id does not match the source packet.`);
  }
}

function runtimeControlEvidenceChainConsistencyIssues(
  sourcePacket: RuntimeControlEvidencePacketV0,
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
  readiness: RuntimeTransformReadinessV0,
): readonly string[] {
  const issues: string[] = [];
  appendIdentityIssues(issues, "Coordinate-pair intake request", sourcePacket, request);
  appendIdentityIssues(issues, "Coordinate-pair intake inspection", sourcePacket, inspection);
  appendIdentityIssues(issues, "Coordinate-pair packet-build report", sourcePacket, packetReport);
  appendIdentityIssues(issues, "Capture-control payload-build report", sourcePacket, payloadReport);
  appendIdentityIssues(issues, "Runtime transform readiness", sourcePacket, readiness);

  appendPacketReferenceIssues(issues, sourcePacket, request, inspection, packetReport, payloadReport);
  appendStageOrderIssues(issues, inspection, packetReport, payloadReport);
  return issues;
}

function appendPacketReferenceIssues(
  issues: string[],
  sourcePacket: RuntimeControlEvidencePacketV0,
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
): void {
  if (request.sourcePacketId !== sourcePacket.packetId) {
    issues.push("Coordinate-pair intake request source packet id does not match the source packet.");
  }
  if (inspection.sourcePacketId !== sourcePacket.packetId) {
    issues.push("Coordinate-pair intake inspection source packet id does not match the source packet.");
  }
  if (packetReport.sourcePacketId !== sourcePacket.packetId) {
    issues.push("Coordinate-pair packet-build report source packet id does not match the source packet.");
  }

  const expectedPayloadPacketIds = new Set([sourcePacket.packetId]);
  if (packetReport.reviewedPacket !== null) {
    expectedPayloadPacketIds.add(packetReport.reviewedPacket.packetId);
  }
  if (!expectedPayloadPacketIds.has(payloadReport.packetId)) {
    issues.push("Capture-control payload-build report packet id does not match the source or reviewed packet.");
  }
}

function appendStageOrderIssues(
  issues: string[],
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
): void {
  if (
    inspection.status === "ready_for_reviewed_packet_build" &&
    packetReport.status !== "packet_built"
  ) {
    issues.push("Coordinate-pair intake inspection is ready, but packet-build report has not built a reviewed packet.");
  }
  if (
    inspection.status !== "ready_for_reviewed_packet_build" &&
    packetReport.status === "packet_built"
  ) {
    issues.push("Packet-build report built a reviewed packet before intake inspection was ready.");
  }
  if (packetReport.status !== "packet_built" && payloadReport.status === "payload_built") {
    issues.push("Capture-control payload was built before the reviewed packet-build report succeeded.");
  }
}

function runtimeControlEvidenceChainStatusValue(
  consistencyIssues: readonly string[],
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
): RuntimeControlEvidenceChainStatus {
  if (consistencyIssues.length > 0) return "chain_inconsistent";
  if (request.status === "blocked_insufficient_landmark_candidates") {
    return "blocked_insufficient_landmark_candidates";
  }
  if (inspection.status === "missing_intake_file") return "blocked_missing_coordinate_pair_intake";
  if (inspection.status === "invalid_intake") return "blocked_invalid_coordinate_pair_intake";
  if (inspection.status === "blocked_incompatible_intake") {
    return "blocked_incompatible_coordinate_pair_intake";
  }
  if (packetReport.status !== "packet_built") return "blocked_packet_build";
  if (payloadReport.status !== "payload_built") return "blocked_capture_control_payload";
  return "capture_control_payload_ready";
}

function uniquePlanningMessages(messages: readonly string[]): readonly string[] {
  return Array.from(new Set(messages));
}

function runtimeControlEvidenceChainBlockers(
  chainStatus: RuntimeControlEvidenceChainStatus,
  consistencyIssues: readonly string[],
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
  readiness: RuntimeTransformReadinessV0,
): readonly string[] {
  if (chainStatus === "capture_control_payload_ready") return [];
  if (chainStatus === "chain_inconsistent") return consistencyIssues;
  return uniquePlanningMessages([
    ...request.blockers,
    ...inspection.blockers,
    ...packetReport.blockers,
    ...payloadReport.blockers,
    ...readiness.blockers,
  ]);
}

function runtimeControlEvidenceChainNextActions(
  chainStatus: RuntimeControlEvidenceChainStatus,
): readonly string[] {
  switch (chainStatus) {
    case "blocked_insufficient_landmark_candidates":
      return ["Record at least three non-rejected landmark candidates before requesting coordinate pairs."];
    case "blocked_missing_coordinate_pair_intake":
      return ["Create the reviewed coordinate-pair intake file from the requested ARF and CVF landmark measurements."];
    case "blocked_invalid_coordinate_pair_intake":
      return ["Fix the coordinate-pair intake schema errors, then rerun the intake inspection."];
    case "blocked_incompatible_coordinate_pair_intake":
      return ["Resolve coordinate-pair intake drift against the source packet, then rerun the packet builder."];
    case "blocked_packet_build":
      return ["Rerun the coordinate-pair packet builder after intake inspection reports ready_for_reviewed_packet_build."];
    case "blocked_capture_control_payload":
      return ["Build the manual_landmarks capture-control payload from the reviewed runtime-control packet."];
    case "capture_control_payload_ready":
      return ["Run the capture-control registration script in dry-run mode before any live registration."];
    case "chain_inconsistent":
      return ["Regenerate stale runtime-control reports so every artifact references the same source packet and package."];
  }
}

export function buildRuntimeControlEvidenceChainStatus(
  sourcePacket: RuntimeControlEvidencePacketV0,
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
  packetReport: RuntimeControlCoordinatePairPacketBuildReportV0,
  payloadReport: RuntimeControlCaptureControlPayloadBuildReportV0,
  readiness: RuntimeTransformReadinessV0,
  params: BuildRuntimeControlEvidenceChainStatusParams,
): RuntimeControlEvidenceChainStatusV0 {
  const consistencyIssues = runtimeControlEvidenceChainConsistencyIssues(
    sourcePacket,
    request,
    inspection,
    packetReport,
    payloadReport,
    readiness,
  );
  const chainStatus = runtimeControlEvidenceChainStatusValue(
    consistencyIssues,
    request,
    inspection,
    packetReport,
    payloadReport,
  );
  const blockers = runtimeControlEvidenceChainBlockers(
    chainStatus,
    consistencyIssues,
    request,
    inspection,
    packetReport,
    payloadReport,
    readiness,
  );

  return RuntimeControlEvidenceChainStatusV0Schema.parse({
    schemaVersion: RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_V0_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    sourcePacketRef: params.sourcePacketRef,
    coordinatePairIntakeRequestRef: params.coordinatePairIntakeRequestRef,
    coordinatePairIntakeInspectionRef: params.coordinatePairIntakeInspectionRef,
    coordinatePairPacketBuildReportRef: params.coordinatePairPacketBuildReportRef,
    captureControlPayloadBuildReportRef: params.captureControlPayloadBuildReportRef,
    transformReadinessRef: params.transformReadinessRef,
    sourcePacketId: sourcePacket.packetId,
    venueSlug: sourcePacket.venueSlug,
    roomSlug: sourcePacket.roomSlug,
    runtimePackageId: sourcePacket.runtimePackageId,
    chainStatus,
    sourcePacketSummary: runtimeControlLandmarkSetSummary(sourcePacket),
    coordinatePairIntakeRequestStatus: request.status,
    coordinatePairIntakeInspectionStatus: inspection.status,
    coordinatePairPacketBuildStatus: packetReport.status,
    captureControlPayloadBuildStatus: payloadReport.status,
    transformReadinessDisposition: readiness.readinessDisposition,
    requiredCoordinatePairCount: request.requiredCoordinatePairCount,
    reviewedCoordinatePairCount: inspection.coordinatePairIntakeSummary?.coordinatePairCount ??
      packetReport.reviewedPacketSummary?.reviewedLandmarks ??
      0,
    captureControlPayloadReady: payloadReport.status === "payload_built",
    consistencyIssues,
    blockers,
    nextActions: runtimeControlEvidenceChainNextActions(chainStatus),
    messages: [
      "Runtime-control evidence chain status is derived from existing source artifacts.",
      "No coordinate-pair intake, reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created by this chain-status report.",
    ],
    guardrails: {
      sourcePacketMutated: false,
      coordinatePairIntakeCreated: false,
      reviewedPacketCreated: false,
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}
