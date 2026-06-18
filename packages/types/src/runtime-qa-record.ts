import { z } from "zod";
import {
  AssetEvidenceStatusSchema,
  RuntimePackageStatusSchema,
  RuntimeSlugSchema,
  TradesHallRuntimeRoomSlugSchema,
} from "./asset-version.js";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import { RuntimeManifestKeySchema, RuntimeVec3Schema } from "./runtime-venue-manifest.js";

export const RUNTIME_QA_RECORD_V0_SCHEMA_VERSION = "runtime-qa-record.v0";

export const RUNTIME_QA_CHECK_KEYS = [
  "runtime_package_resolves",
  "served_chunk_count",
  "spark_payload_loads",
  "camera_framing",
  "user_orbit_bounds",
  "approximate_view_transform_documented",
  "signed_transform_artifact",
  "metric_scale_alignment",
  "floor_wall_alignment",
  "lcc2_lod_graph",
  "public_exposure_review",
] as const;

export const RUNTIME_QA_CHECK_STATUSES = [
  "passed",
  "failed",
  "not_checked",
  "requires_human_review",
  "blocked",
] as const;

export const RUNTIME_QA_TRANSFORM_POSTURES = [
  "none",
  "approximate_view_transform",
  "signed_room_local_transform",
] as const;

export const RUNTIME_QA_PUBLIC_EXPOSURE_DECISIONS = [
  "blocked_internal_only",
  "approved_internal_preview",
  "approved_public",
] as const;

export const RuntimeQaCheckKeySchema = z.enum(RUNTIME_QA_CHECK_KEYS);
export const RuntimeQaCheckStatusSchema = z.enum(RUNTIME_QA_CHECK_STATUSES);
export const RuntimeQaTransformPostureSchema = z.enum(RUNTIME_QA_TRANSFORM_POSTURES);
export const RuntimeQaPublicExposureDecisionSchema = z.enum(RUNTIME_QA_PUBLIC_EXPOSURE_DECISIONS);

const RuntimeQaRecordIdSchema = z.string().trim().min(1).max(120).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  "Runtime QA record id must be lowercase kebab-case.",
);

export const RuntimeQaEvidenceRefSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(260),
  })
  .strict();

export const RuntimeQaCheckSchema = z
  .object({
    checkKey: RuntimeQaCheckKeySchema,
    status: RuntimeQaCheckStatusSchema,
    summary: SafePlanningWordingSchema,
    evidenceRefs: z.array(RuntimeQaEvidenceRefSchema).default([]),
  })
  .strict()
  .superRefine((check, ctx) => {
    if (check.status === "passed" && check.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Passed runtime QA checks need at least one evidence reference.",
      });
    }
  });

export const RuntimeQaViewTransformSchema = z
  .object({
    posture: RuntimeQaTransformPostureSchema,
    position: RuntimeVec3Schema,
    rotation: RuntimeVec3Schema,
    scale: z.number().finite().positive(),
    signedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
    note: SafePlanningWordingSchema,
  })
  .strict()
  .superRefine((transform, ctx) => {
    if (
      transform.posture === "signed_room_local_transform" &&
      transform.signedTransformArtifactId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signedTransformArtifactId"],
        message: "Signed runtime QA transforms need a signed TransformArtifactV0 reference.",
      });
    }

    if (
      transform.posture !== "signed_room_local_transform" &&
      transform.signedTransformArtifactId !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signedTransformArtifactId"],
        message: "Unsigned runtime QA transforms must not reference a signed transform artifact.",
      });
    }
  });

export const RuntimeQaCameraBoundsSchema = z
  .object({
    min: RuntimeVec3Schema,
    max: RuntimeVec3Schema,
  })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      const min = bounds.min[axis];
      const max = bounds.max[axis];
      if (min >= max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max", axis],
          message: "Runtime QA camera bounds max must be greater than min on every axis.",
        });
      }
    }
  });

export const RuntimeQaCameraProfileSchema = z
  .object({
    position: RuntimeVec3Schema,
    target: RuntimeVec3Schema,
    arrivalPosition: RuntimeVec3Schema.nullable(),
    arrivalTarget: RuntimeVec3Schema.nullable(),
    arrivalDurationMs: z.number().int().nonnegative(),
    fov: z.number().finite().positive(),
    targetBounds: RuntimeQaCameraBoundsSchema.nullable(),
    cameraBounds: RuntimeQaCameraBoundsSchema.nullable(),
    note: SafePlanningWordingSchema,
  })
  .strict();

export const RuntimeQaSparkLoadSchema = z
  .object({
    renderer: z.literal("@sparkjsdev/spark"),
    route: z.string().trim().min(1).max(240),
    loadStatus: z.enum(["loaded", "failed", "not_run"]),
    visualChunkCount: z.number().int().nonnegative(),
    excludedChunkCount: z.number().int().nonnegative(),
    loadedSplats: z.number().int().positive().nullable(),
    evidenceRefs: z.array(RuntimeQaEvidenceRefSchema).default([]),
  })
  .strict()
  .superRefine((load, ctx) => {
    if (load.loadStatus === "loaded" && load.loadedSplats === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loadedSplats"],
        message: "Loaded Spark runtime QA records need a positive loaded splat count.",
      });
    }

    if (load.loadStatus === "loaded" && load.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Loaded Spark runtime QA records need at least one evidence reference.",
      });
    }
  });

export const RuntimeQaSourceBundleSchema = z
  .object({
    sourceLabel: z.string().trim().min(1).max(180),
    sourceBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
    totalSourceFiles: z.number().int().positive(),
    totalSourceBytes: z.number().int().positive(),
    totalSplats: z.number().int().positive().nullable(),
  })
  .strict();

export const RuntimeQaPublicExposureSchema = z
  .object({
    decision: RuntimeQaPublicExposureDecisionSchema,
    reason: SafePlanningWordingSchema,
    requiredBeforeApproval: z.array(SafePlanningWordingSchema).min(1),
  })
  .strict();

export const RuntimeQaRecordV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_QA_RECORD_V0_SCHEMA_VERSION),
    recordId: RuntimeQaRecordIdSchema,
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    recordedAt: z.string().datetime({ offset: true }),
    recordedBy: z.string().trim().min(1).max(160),
    assetEvidenceStatus: AssetEvidenceStatusSchema,
    runtimeStatus: RuntimePackageStatusSchema,
    sourceBundle: RuntimeQaSourceBundleSchema,
    sparkLoad: RuntimeQaSparkLoadSchema,
    viewTransform: RuntimeQaViewTransformSchema,
    cameraProfile: RuntimeQaCameraProfileSchema,
    checks: z.array(RuntimeQaCheckSchema).min(RUNTIME_QA_CHECK_KEYS.length),
    limitations: z.array(SafePlanningWordingSchema).min(1),
    publicExposure: RuntimeQaPublicExposureSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    const seenChecks = new Set(record.checks.map((check) => check.checkKey));
    for (const requiredCheck of RUNTIME_QA_CHECK_KEYS) {
      if (!seenChecks.has(requiredCheck)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks"],
          message: `Runtime QA record is missing required check ${requiredCheck}.`,
        });
      }
    }

    const duplicateCheck = record.checks.find((check, index) =>
      record.checks.findIndex((candidate) => candidate.checkKey === check.checkKey) !== index,
    );
    if (duplicateCheck !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: `Runtime QA record has duplicate check ${duplicateCheck.checkKey}.`,
      });
    }

    const signedTransformCheck = record.checks.find((check) =>
      check.checkKey === "signed_transform_artifact",
    );
    if (
      record.viewTransform.posture !== "signed_room_local_transform" &&
      signedTransformCheck?.status === "passed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Unsigned runtime QA records cannot pass the signed transform artifact check.",
      });
    }

    if (
      record.publicExposure.decision === "approved_public" &&
      record.assetEvidenceStatus !== "human_reviewed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicExposure", "decision"],
        message: "Public runtime exposure requires human-reviewed asset evidence.",
      });
    }

    if (
      record.publicExposure.decision === "approved_public" &&
      record.viewTransform.posture !== "signed_room_local_transform"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicExposure", "decision"],
        message: "Public runtime exposure requires a signed room-local transform.",
      });
    }

    const publicExposureCheck = record.checks.find((check) =>
      check.checkKey === "public_exposure_review",
    );
    if (
      record.publicExposure.decision === "approved_public" &&
      publicExposureCheck?.status !== "passed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Public runtime exposure requires a passed public exposure review check.",
      });
    }
  });

export function runtimeQaRecordHasSignedRoomTransform(record: RuntimeQaRecordV0): boolean {
  return record.viewTransform.posture === "signed_room_local_transform" &&
    record.viewTransform.signedTransformArtifactId !== null;
}

export function runtimeQaRecordSignedTransformArtifactId(record: RuntimeQaRecordV0): string | null {
  return runtimeQaRecordHasSignedRoomTransform(record)
    ? record.viewTransform.signedTransformArtifactId
    : null;
}

export function runtimeQaRecordAllowsPublicExposure(record: RuntimeQaRecordV0): boolean {
  return record.publicExposure.decision === "approved_public" &&
    record.assetEvidenceStatus === "human_reviewed" &&
    runtimeQaRecordHasSignedRoomTransform(record);
}

export const RuntimeQaRecordRegistrationSchema = z
  .object({
    id: z.string(),
    runtimePackageId: z.string().uuid(),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    recordId: RuntimeQaRecordIdSchema,
    record: RuntimeQaRecordV0Schema,
    signedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
    publicExposureDecision: RuntimeQaPublicExposureDecisionSchema,
    assetEvidenceStatus: AssetEvidenceStatusSchema,
    runtimeStatus: RuntimePackageStatusSchema,
    reviewedBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.record.runtimePackageId !== row.runtimePackageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "runtimePackageId"],
        message: "Runtime QA record package id must match its registration row.",
      });
    }
    if (row.record.venueSlug !== row.venueSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "venueSlug"],
        message: "Runtime QA record venueSlug must match its registration row.",
      });
    }
    if (row.record.roomSlug !== row.roomSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "roomSlug"],
        message: "Runtime QA record roomSlug must match its registration row.",
      });
    }
    if (row.record.recordId !== row.recordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "recordId"],
        message: "Runtime QA record id must match its registration row.",
      });
    }
    if (runtimeQaRecordSignedTransformArtifactId(row.record) !== row.signedTransformArtifactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signedTransformArtifactId"],
        message: "Runtime QA signed transform artifact id must match the embedded record.",
      });
    }
    if (row.record.publicExposure.decision !== row.publicExposureDecision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicExposureDecision"],
        message: "Runtime QA public exposure decision must match the embedded record.",
      });
    }
    if (row.record.assetEvidenceStatus !== row.assetEvidenceStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetEvidenceStatus"],
        message: "Runtime QA asset evidence status must match the embedded record.",
      });
    }
    if (row.record.runtimeStatus !== row.runtimeStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeStatus"],
        message: "Runtime QA runtime status must match the embedded record.",
      });
    }
  });

export const RegisterRuntimeQaRecordInputSchema = z
  .object({
    runtimePackageId: z.string().uuid(),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    record: RuntimeQaRecordV0Schema,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.record.runtimePackageId !== body.runtimePackageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "runtimePackageId"],
        message: "Runtime QA record package id must match the request runtimePackageId.",
      });
    }
    if (body.record.venueSlug !== body.venueSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "venueSlug"],
        message: "Runtime QA record venueSlug must match the request venueSlug.",
      });
    }
    if (body.record.roomSlug !== body.roomSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["record", "roomSlug"],
        message: "Runtime QA record roomSlug must match the request roomSlug.",
      });
    }
  });

export const RuntimeQaRecordQuerySchema = z.object({
  runtimePackageId: z.string().uuid(),
}).strict();

export const RuntimeQaRecordRegistrationReportSchema = z
  .object({
    schemaVersion: z.literal("venviewer.runtime-qa-registration-report.v0"),
    generatedAt: z.string().datetime(),
    mode: z.enum(["dry_run", "registered"]),
    apiUrl: z.string().url(),
    payloadFile: z.string().trim().min(1),
    payload: z.object({
      venueSlug: RuntimeSlugSchema,
      roomSlug: TradesHallRuntimeRoomSlugSchema,
      runtimePackageId: z.string().uuid(),
      recordId: z.string().trim().min(1),
      assetEvidenceStatus: AssetEvidenceStatusSchema,
      runtimeStatus: RuntimePackageStatusSchema,
      transformPosture: RuntimeQaTransformPostureSchema,
      signedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
      publicExposureDecision: RuntimeQaPublicExposureDecisionSchema,
    }).strict(),
    preflight: z.object({
      payloadRuntimePackageId: z.string().uuid(),
      latestRuntimePackageId: z.string().uuid().nullable(),
      latestRuntimePackageRuntimeStatus: RuntimePackageStatusSchema.nullable(),
      latestRuntimePackageEvidenceStatus: AssetEvidenceStatusSchema.nullable(),
      runtimePackageMatchesLatest: z.boolean(),
      runtimePackageDriftAllowed: z.boolean(),
      signedTransformRequired: z.boolean(),
      signedTransformRegistered: z.boolean().nullable(),
    }).strict(),
    registration: z.object({
      runtimeQaRecordRowId: z.string().min(1),
      recordId: z.string().trim().min(1),
      signedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
      publicExposureDecision: RuntimeQaPublicExposureDecisionSchema,
      reviewedBy: z.string().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }).strict().nullable(),
    guardrails: z.object({
      runtimePackageDriftAllowed: z.boolean(),
      publicExposureAllowed: z.boolean(),
      publicExposureChanged: z.boolean(),
    }).strict(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.mode === "dry_run" && report.registration !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration"],
        message: "Dry-run reports cannot include a registration row.",
      });
    }
    if (report.mode === "registered" && report.registration === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration"],
        message: "Registered reports must include the persisted runtime QA row.",
      });
    }
    if (report.payload.runtimePackageId !== report.preflight.payloadRuntimePackageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "payloadRuntimePackageId"],
        message: "Preflight payload runtime package id must match the report payload.",
      });
    }
    const expectedMatch = report.preflight.latestRuntimePackageId !== null &&
      report.preflight.latestRuntimePackageId === report.preflight.payloadRuntimePackageId;
    if (report.preflight.runtimePackageMatchesLatest !== expectedMatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "runtimePackageMatchesLatest"],
        message: "runtimePackageMatchesLatest must reflect payload/latest runtime package identity.",
      });
    }
    if (!expectedMatch && !report.preflight.runtimePackageDriftAllowed) {
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
    const signedTransformRequired = report.payload.signedTransformArtifactId !== null;
    if (report.preflight.signedTransformRequired !== signedTransformRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "signedTransformRequired"],
        message: "Signed-transform preflight requirement must match the report payload.",
      });
    }
    if (signedTransformRequired && report.preflight.signedTransformRegistered !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "signedTransformRegistered"],
        message: "Signed-transform QA reports require registered signed-transform readback.",
      });
    }
    if (!signedTransformRequired && report.preflight.signedTransformRegistered !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "signedTransformRegistered"],
        message: "Unsigned QA reports must not claim signed-transform registration readback.",
      });
    }
    if (
      report.payload.publicExposureDecision === "approved_public" &&
      report.payload.transformPosture !== "signed_room_local_transform"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "transformPosture"],
        message: "Approved-public QA reports require a signed room-local transform posture.",
      });
    }
    if (
      report.payload.publicExposureDecision === "approved_public" &&
      report.payload.signedTransformArtifactId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "signedTransformArtifactId"],
        message: "Approved-public QA reports require a signed transform artifact id.",
      });
    }
    if (
      report.payload.publicExposureDecision === "approved_public" &&
      !report.guardrails.publicExposureAllowed
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardrails", "publicExposureAllowed"],
        message: "Approved-public QA reports require the explicit public-exposure override.",
      });
    }
    if (
      report.guardrails.publicExposureChanged !==
      (report.payload.publicExposureDecision === "approved_public")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardrails", "publicExposureChanged"],
        message: "publicExposureChanged must reflect whether this QA record approves public exposure.",
      });
    }
    if (report.registration !== null) {
      if (report.registration.recordId !== report.payload.recordId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration", "recordId"],
          message: "Registered QA record id must match the report payload record id.",
        });
      }
      if (report.registration.signedTransformArtifactId !== report.payload.signedTransformArtifactId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration", "signedTransformArtifactId"],
          message: "Registered QA signed transform artifact id must match the report payload.",
        });
      }
      if (report.registration.publicExposureDecision !== report.payload.publicExposureDecision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registration", "publicExposureDecision"],
          message: "Registered QA public exposure decision must match the report payload.",
        });
      }
    }
  });
export type RuntimeQaRecordRegistrationReport = z.infer<
  typeof RuntimeQaRecordRegistrationReportSchema
>;

export const RUNTIME_QA_REGISTRATION_REPORT_INSPECTION_STATUSES = [
  "ready_for_live_qa_registration",
  "not_ready_for_live_qa_registration",
  "registered_qa_report_verified",
  "invalid_report",
] as const;
export const RuntimeQaRecordRegistrationReportInspectionStatusSchema = z.enum(
  RUNTIME_QA_REGISTRATION_REPORT_INSPECTION_STATUSES,
);
export type RuntimeQaRecordRegistrationReportInspectionStatus = z.infer<
  typeof RuntimeQaRecordRegistrationReportInspectionStatusSchema
>;

export const RuntimeQaRecordRegistrationReportInspectionSchema = z
  .object({
    schemaVersion: z.literal("venviewer.runtime-qa-registration-report-inspection.v0"),
    generatedAt: z.string().datetime(),
    inspectedReportFile: z.string().trim().min(1),
    inspectedReportGeneratedAt: z.string().datetime().nullable(),
    status: RuntimeQaRecordRegistrationReportInspectionStatusSchema,
    liveQaRegistrationReady: z.boolean(),
    mode: z.enum(["dry_run", "registered"]).nullable(),
    venueSlug: RuntimeSlugSchema.nullable(),
    roomSlug: TradesHallRuntimeRoomSlugSchema.nullable(),
    recordId: z.string().trim().min(1).nullable(),
    publicExposureDecision: RuntimeQaPublicExposureDecisionSchema.nullable(),
    reportRuntimePackageId: z.string().uuid().nullable(),
    reportLatestRuntimePackageId: z.string().uuid().nullable(),
    reportRuntimePackageMatchesLatest: z.boolean().nullable(),
    reportRuntimePackageDriftAllowed: z.boolean().nullable(),
    reportSignedTransformRequired: z.boolean().nullable(),
    reportSignedTransformRegistered: z.boolean().nullable(),
    reportPublicExposureAllowed: z.boolean().nullable(),
    reportPublicExposureChanged: z.boolean().nullable(),
    blockers: z.array(z.string().trim().min(1)),
    messages: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (inspection.liveQaRegistrationReady && inspection.status !== "ready_for_live_qa_registration") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Only ready_for_live_qa_registration inspections may set liveQaRegistrationReady.",
      });
    }
    if (inspection.status === "ready_for_live_qa_registration") {
      if (!inspection.liveQaRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveQaRegistrationReady"],
          message: "Ready inspections must set liveQaRegistrationReady.",
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
        inspection.recordId === null ||
        inspection.publicExposureDecision === null ||
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
      if (
        inspection.reportSignedTransformRequired === true &&
        inspection.reportSignedTransformRegistered !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportSignedTransformRegistered"],
          message: "Ready signed-transform QA inspections require registered signed-transform readback.",
        });
      }
      if (
        inspection.publicExposureDecision === "approved_public" &&
        inspection.reportPublicExposureAllowed !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportPublicExposureAllowed"],
          message: "Ready approved-public QA inspections require the public-exposure override.",
        });
      }
    }
    if (
      inspection.status === "not_ready_for_live_qa_registration" &&
      inspection.blockers.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Not-ready inspections must include at least one blocker.",
      });
    }
    if (inspection.status === "registered_qa_report_verified") {
      if (inspection.liveQaRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveQaRegistrationReady"],
          message: "Registered QA reports are audit evidence, not live-registration authorization.",
        });
      }
      if (inspection.mode !== "registered") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "Registered QA report inspections must cite registered mode.",
        });
      }
      if (inspection.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Registered QA report inspections must state why they are not live-registration-ready.",
        });
      }
    }
    if (inspection.status === "invalid_report") {
      if (inspection.liveQaRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveQaRegistrationReady"],
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
export type RuntimeQaRecordRegistrationReportInspection = z.infer<
  typeof RuntimeQaRecordRegistrationReportInspectionSchema
>;

export type RuntimeQaCheckKey = z.infer<typeof RuntimeQaCheckKeySchema>;
export type RuntimeQaCheckStatus = z.infer<typeof RuntimeQaCheckStatusSchema>;
export type RuntimeQaTransformPosture = z.infer<typeof RuntimeQaTransformPostureSchema>;
export type RuntimeQaPublicExposureDecision = z.infer<typeof RuntimeQaPublicExposureDecisionSchema>;
export type RuntimeQaCheck = z.infer<typeof RuntimeQaCheckSchema>;
export type RuntimeQaEvidenceRef = z.infer<typeof RuntimeQaEvidenceRefSchema>;
export type RuntimeQaViewTransform = z.infer<typeof RuntimeQaViewTransformSchema>;
export type RuntimeQaCameraBounds = z.infer<typeof RuntimeQaCameraBoundsSchema>;
export type RuntimeQaCameraProfile = z.infer<typeof RuntimeQaCameraProfileSchema>;
export type RuntimeQaSparkLoad = z.infer<typeof RuntimeQaSparkLoadSchema>;
export type RuntimeQaSourceBundle = z.infer<typeof RuntimeQaSourceBundleSchema>;
export type RuntimeQaPublicExposure = z.infer<typeof RuntimeQaPublicExposureSchema>;
export type RuntimeQaRecordV0 = z.infer<typeof RuntimeQaRecordV0Schema>;
export type RuntimeQaRecordRegistration = z.infer<typeof RuntimeQaRecordRegistrationSchema>;
export type RegisterRuntimeQaRecordInput = z.infer<typeof RegisterRuntimeQaRecordInputSchema>;
export type RuntimeQaRecordQuery = z.infer<typeof RuntimeQaRecordQuerySchema>;
