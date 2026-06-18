import { z } from "zod";
import {
  AssetEvidenceStatusSchema,
  CaptureControlFreshnessStatusSchema,
  RuntimeSlugSchema,
  RuntimePackageStatusSchema,
  ReviewedCaptureControlStatusSchema,
  TRADES_HALL_VENUE_SLUG,
  isTradesHallRuntimeRoomSlug,
} from "./asset-version.js";
import { RuntimeManifestKeySchema } from "./runtime-venue-manifest.js";

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

function validateCaptureControlRoom(
  venueSlug: string,
  roomSlug: string,
  ctx: z.RefinementCtx,
): void {
  if (venueSlug !== TRADES_HALL_VENUE_SLUG) return;
  if (isTradesHallRuntimeRoomSlug(roomSlug)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["roomSlug"],
    message: "Unsupported Trades Hall room slug.",
  });
}

function sourceReferencesTransformArtifact(
  source: CaptureControlSourceRecord,
  transformArtifactId: string,
): boolean {
  return source.transformArtifactRefs.some((ref) =>
    ref.refType === "transform_artifact" && ref.ref === transformArtifactId,
  );
}

export const CaptureControlSourceRegistrationSchema = z
  .object({
    id: z.string(),
    venueSlug: RuntimeSlugSchema,
    roomSlug: RuntimeSlugSchema,
    runtimePackageId: z.string().uuid().nullable(),
    transformArtifactId: RuntimeManifestKeySchema.nullable(),
    sourceId: z.string().trim().min(1).max(160).regex(SAFE_ID),
    sourceClass: CaptureControlSourceClassSchema,
    poseAuthorityLevel: CapturePoseAuthorityLevelSchema,
    qaStatus: CaptureControlQaStatusSchema,
    source: CaptureControlSourceRecordSchema,
    reviewNote: z.string().nullable(),
    registeredBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((row, ctx) => {
    validateCaptureControlRoom(row.venueSlug, row.roomSlug, ctx);

    if (row.source.sourceId !== row.sourceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "sourceId must match source.sourceId.",
      });
    }
    if (row.source.sourceClass !== row.sourceClass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceClass"],
        message: "sourceClass must match source.sourceClass.",
      });
    }
    if (row.source.poseAuthorityLevel !== row.poseAuthorityLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["poseAuthorityLevel"],
        message: "poseAuthorityLevel must match source.poseAuthorityLevel.",
      });
    }
    if (row.source.qaStatus !== row.qaStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qaStatus"],
        message: "qaStatus must match source.qaStatus.",
      });
    }
    if (
      row.transformArtifactId !== null &&
      !sourceReferencesTransformArtifact(row.source, row.transformArtifactId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "transformArtifactRefs"],
        message: "Linked transform artifacts must be referenced by the source record.",
      });
    }
  });
export type CaptureControlSourceRegistration = z.infer<
  typeof CaptureControlSourceRegistrationSchema
>;

export const RegisterCaptureControlSourceRecordInputSchema = z
  .object({
    venueSlug: RuntimeSlugSchema,
    roomSlug: RuntimeSlugSchema,
    runtimePackageId: z.string().uuid().nullable().optional(),
    transformArtifactId: RuntimeManifestKeySchema.nullable().optional(),
    source: CaptureControlSourceRecordSchema,
    reviewNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    validateCaptureControlRoom(input.venueSlug, input.roomSlug, ctx);

    const transformArtifactId = input.transformArtifactId ?? null;
    const runtimePackageId = input.runtimePackageId ?? null;
    if (transformArtifactId !== null && runtimePackageId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimePackageId"],
        message: "A transform-linked capture control source needs a runtime package id.",
      });
    }
    if (
      transformArtifactId !== null &&
      !sourceReferencesTransformArtifact(input.source, transformArtifactId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "transformArtifactRefs"],
        message: "Linked transform artifacts must be referenced by the source record.",
      });
    }
  });
export type RegisterCaptureControlSourceRecordInput = z.infer<
  typeof RegisterCaptureControlSourceRecordInputSchema
>;

export const CaptureControlSourceRecordQuerySchema = z
  .object({
    venue: RuntimeSlugSchema.default(TRADES_HALL_VENUE_SLUG),
    room: RuntimeSlugSchema.optional(),
    runtimePackageId: z.string().uuid().optional(),
    transformArtifactId: RuntimeManifestKeySchema.optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.room !== undefined) {
      validateCaptureControlRoom(query.venue, query.room, ctx);
    }
    if (query.transformArtifactId !== undefined && query.runtimePackageId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimePackageId"],
        message: "Filtering by transform artifact requires runtimePackageId.",
      });
    }
  });
export type CaptureControlSourceRecordQuery = z.infer<
  typeof CaptureControlSourceRecordQuerySchema
>;

export const CaptureControlRegistrationReportSchema = z
  .object({
    schemaVersion: z.literal("venviewer.capture-control-registration-report.v0"),
    generatedAt: z.string().datetime(),
    mode: z.enum(["dry_run", "registered"]),
    apiUrl: z.string().url(),
    payloadFile: z.string().trim().min(1),
    payload: z.object({
      venueSlug: RuntimeSlugSchema,
      roomSlug: RuntimeSlugSchema,
      sourceId: z.string().trim().min(1).max(160).regex(SAFE_ID),
      sourceClass: CaptureControlSourceClassSchema,
      poseAuthorityLevel: CapturePoseAuthorityLevelSchema,
      qaStatus: CaptureControlQaStatusSchema,
      runtimePackageId: z.string().uuid().nullable(),
      transformArtifactId: RuntimeManifestKeySchema.nullable(),
      staleWhen: z.array(CaptureControlStalenessTriggerSchema),
    }).strict(),
    preflight: z.object({
      payloadRuntimePackageId: z.string().uuid().nullable(),
      latestRuntimePackageId: z.string().uuid().nullable(),
      latestRuntimePackageRuntimeStatus: RuntimePackageStatusSchema.nullable(),
      latestRuntimePackageEvidenceStatus: AssetEvidenceStatusSchema.nullable(),
      runtimePackageMatchesLatest: z.boolean().nullable(),
      runtimePackageDriftAllowed: z.boolean(),
    }).strict(),
    registration: z.object({
      captureControlSourceId: z.string().min(1),
      sourceId: z.string().trim().min(1).max(160).regex(SAFE_ID),
      qaStatus: CaptureControlQaStatusSchema,
      registeredBy: z.string().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }).strict().nullable(),
    roomStatus: z.object({
      latestCaptureControlSourceRecordId: z.string().uuid().nullable(),
      latestCaptureControlSourceId: z.string().trim().min(1).max(160).regex(SAFE_ID).nullable(),
      latestCaptureControlSourceClass: CaptureControlSourceClassSchema.nullable(),
      latestCaptureControlPoseAuthorityLevel: CapturePoseAuthorityLevelSchema.nullable(),
      latestCaptureControlQaStatus: CaptureControlQaStatusSchema.nullable(),
      captureControlStatus: ReviewedCaptureControlStatusSchema,
      captureControlFreshnessStatus: CaptureControlFreshnessStatusSchema,
      activeStalenessTriggers: z.array(CaptureControlStalenessTriggerSchema),
      captureControlSafeCopy: z.string().min(1),
      captureControlAuthoritySafeCopy: z.string().min(1),
    }).strict().nullable(),
    guardrails: z.object({
      runtimePackageDriftAllowed: z.boolean(),
      staleReadbackAllowed: z.boolean(),
      signedTransformCreated: z.literal(false),
      publicExposureChanged: z.literal(false),
    }).strict(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.mode === "dry_run") {
      if (report.registration !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration"],
          message: "Dry-run reports cannot include a registration row.",
        });
      }
      if (report.roomStatus !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roomStatus"],
          message: "Dry-run reports cannot include room-status readback.",
        });
      }
    }

    if (report.mode === "registered") {
      if (report.registration === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration"],
          message: "Registered reports must include the persisted capture-control row.",
        });
      }
      if (report.roomStatus === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roomStatus"],
          message: "Registered reports must include room-status readback.",
        });
      }
    }

    const payloadPackageId = report.preflight.payloadRuntimePackageId;
    const latestPackageId = report.preflight.latestRuntimePackageId;
    if (report.payload.runtimePackageId !== payloadPackageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "payloadRuntimePackageId"],
        message: "Preflight payload runtime package id must match the report payload.",
      });
    }

    const expectedMatch = payloadPackageId === null
      ? null
      : latestPackageId !== null && payloadPackageId === latestPackageId;
    if (report.preflight.runtimePackageMatchesLatest !== expectedMatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "runtimePackageMatchesLatest"],
        message: "runtimePackageMatchesLatest must reflect payload/latest runtime package identity.",
      });
    }
    if (expectedMatch === false && !report.preflight.runtimePackageDriftAllowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "runtimePackageDriftAllowed"],
        message: "Runtime package drift reports require the explicit drift override.",
      });
    }
    if (report.guardrails.runtimePackageDriftAllowed !== report.preflight.runtimePackageDriftAllowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardrails", "runtimePackageDriftAllowed"],
        message: "Guardrail drift override must match preflight drift override.",
      });
    }
    if (report.registration !== null) {
      if (report.registration.sourceId !== report.payload.sourceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration", "sourceId"],
          message: "Registered source id must match the report payload source id.",
        });
      }
      if (report.registration.qaStatus !== report.payload.qaStatus) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration", "qaStatus"],
          message: "Registered QA status must match the report payload QA status.",
        });
      }
      if (
        report.roomStatus !== null &&
        report.roomStatus.latestCaptureControlSourceRecordId !== report.registration.captureControlSourceId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roomStatus", "latestCaptureControlSourceRecordId"],
          message: "Room-status readback source record id must match the registered capture-control row.",
        });
      }
      if (report.roomStatus !== null) {
        if (report.roomStatus.latestCaptureControlSourceId !== report.registration.sourceId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roomStatus", "latestCaptureControlSourceId"],
            message: "Room-status source id must match the registered capture-control source id.",
          });
        }
        if (report.roomStatus.latestCaptureControlSourceClass !== report.payload.sourceClass) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roomStatus", "latestCaptureControlSourceClass"],
            message: "Room-status source class must match the report payload source class.",
          });
        }
        if (report.roomStatus.latestCaptureControlPoseAuthorityLevel !== report.payload.poseAuthorityLevel) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roomStatus", "latestCaptureControlPoseAuthorityLevel"],
            message: "Room-status pose authority must match the report payload pose authority.",
          });
        }
        if (report.roomStatus.latestCaptureControlQaStatus !== report.registration.qaStatus) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roomStatus", "latestCaptureControlQaStatus"],
            message: "Room-status QA status must match the registered capture-control QA status.",
          });
        }
      }
    }
    if (
      report.roomStatus?.captureControlFreshnessStatus === "stale_for_runtime_package" &&
      !report.guardrails.staleReadbackAllowed
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardrails", "staleReadbackAllowed"],
        message: "Stale capture-control readback reports require the explicit stale-readback override.",
      });
    }
  });
export type CaptureControlRegistrationReport = z.infer<
  typeof CaptureControlRegistrationReportSchema
>;

export const CAPTURE_CONTROL_REGISTRATION_REPORT_INSPECTION_STATUSES = [
  "ready_for_live_registration",
  "not_ready_for_live_registration",
  "registered_report_verified",
  "invalid_report",
] as const;
export const CaptureControlRegistrationReportInspectionStatusSchema = z.enum(
  CAPTURE_CONTROL_REGISTRATION_REPORT_INSPECTION_STATUSES,
);
export type CaptureControlRegistrationReportInspectionStatus = z.infer<
  typeof CaptureControlRegistrationReportInspectionStatusSchema
>;

export const CaptureControlRegistrationReportInspectionSchema = z
  .object({
    schemaVersion: z.literal("venviewer.capture-control-registration-report-inspection.v0"),
    generatedAt: z.string().datetime(),
    inspectedReportFile: z.string().trim().min(1),
    inspectedReportGeneratedAt: z.string().datetime().nullable(),
    status: CaptureControlRegistrationReportInspectionStatusSchema,
    liveRegistrationReady: z.boolean(),
    mode: z.enum(["dry_run", "registered"]).nullable(),
    venueSlug: RuntimeSlugSchema.nullable(),
    roomSlug: RuntimeSlugSchema.nullable(),
    sourceId: z.string().trim().min(1).max(160).regex(SAFE_ID).nullable(),
    reportRuntimePackageId: z.string().uuid().nullable(),
    reportLatestRuntimePackageId: z.string().uuid().nullable(),
    reportRuntimePackageMatchesLatest: z.boolean().nullable(),
    reportRuntimePackageDriftAllowed: z.boolean().nullable(),
    reportStaleReadbackAllowed: z.boolean().nullable(),
    blockers: z.array(z.string().trim().min(1)),
    messages: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (inspection.liveRegistrationReady && inspection.status !== "ready_for_live_registration") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Only ready_for_live_registration inspections may set liveRegistrationReady.",
      });
    }
    if (inspection.status === "ready_for_live_registration") {
      if (!inspection.liveRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveRegistrationReady"],
          message: "Ready inspections must set liveRegistrationReady.",
        });
      }
      if (inspection.mode !== "dry_run") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "Ready inspections must come from dry-run reports.",
        });
      }
      if (
        inspection.venueSlug === null ||
        inspection.roomSlug === null ||
        inspection.sourceId === null ||
        inspection.inspectedReportGeneratedAt === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "Ready inspections must include report target identity.",
        });
      }
      if (inspection.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Ready inspections cannot include blockers.",
        });
      }
      if (inspection.reportRuntimePackageId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageId"],
          message: "Ready inspections must be scoped to a runtime package.",
        });
      }
      if (inspection.reportLatestRuntimePackageId !== inspection.reportRuntimePackageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportLatestRuntimePackageId"],
          message: "Ready inspections require the payload runtime package to match latest loadable package.",
        });
      }
      if (inspection.reportRuntimePackageMatchesLatest !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageMatchesLatest"],
          message: "Ready inspections require runtimePackageMatchesLatest true.",
        });
      }
      if (inspection.reportRuntimePackageDriftAllowed !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageDriftAllowed"],
          message: "Ready inspections cannot use runtime-package drift override.",
        });
      }
      if (inspection.reportStaleReadbackAllowed !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportStaleReadbackAllowed"],
          message: "Ready inspections cannot use stale-readback override.",
        });
      }
    }
    if (
      inspection.status === "not_ready_for_live_registration" &&
      inspection.blockers.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Not-ready inspections must include at least one blocker.",
      });
    }
    if (inspection.status === "registered_report_verified") {
      if (inspection.liveRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveRegistrationReady"],
          message: "Registered reports are audit evidence, not live-registration authorization.",
        });
      }
      if (inspection.mode !== "registered") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "Registered report inspections must cite registered mode.",
        });
      }
      if (inspection.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Registered report inspections must state why they are not live-registration-ready.",
        });
      }
    }
    if (inspection.status === "invalid_report") {
      if (inspection.liveRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveRegistrationReady"],
          message: "Invalid reports cannot be live-registration-ready.",
        });
      }
      if (inspection.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Invalid report inspections must include validation blockers.",
        });
      }
    }
  });
export type CaptureControlRegistrationReportInspection = z.infer<
  typeof CaptureControlRegistrationReportInspectionSchema
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
